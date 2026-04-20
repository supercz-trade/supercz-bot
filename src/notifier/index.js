// src/notifier/index.js
// Format backend (wsServer.js):
//   subscribe  : { action: "subscribe", channel: "token_update" }
//   response   : { ok: true, action: "subscribed", channel }
//   publish    : { channel, data: { ... }, ts }

import WebSocket from "ws";
import { handleTokenUpdate } from "./handler.js";
import { loadExistingMigrated } from "./state.js";

let _ws = null;

function connect() {
  _ws = new WebSocket(process.env.WS_URL);

  _ws.on("open", () => {
    console.log("[NOTIFIER] WS connected:", process.env.WS_URL);
    // [FIX] backend pakai action, bukan type
    _ws.send(JSON.stringify({ action: "subscribe", channel: "token_update" }));
    _ws.send(JSON.stringify({ action: "subscribe", channel: "migrate" }));
  });

  _ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // [FIX] format publish backend: { channel, data, ts }
    const { channel, data } = msg;

    // skip welcome, ack, error — tidak ada field data
    if (!channel || !data) return;

    if (channel === "token_update") {
      if (!data.tokenAddress) return;
      await handleTokenUpdate(data);
      return;
    }

    if (channel === "migrate") {
      if (!data.tokenAddress) return;
      // migrate event → treat sebagai mode=dex
      await handleTokenUpdate({ ...data, mode: "dex" });
      return;
    }
  });

  _ws.on("close", () => {
    console.warn("[NOTIFIER] WS disconnected — reconnect in 5s...");
    setTimeout(connect, 5000);
  });

  _ws.on("error", (err) => {
    console.error("[NOTIFIER] WS error:", err.message);
  });
}

export async function startNotifier() {
  await loadExistingMigrated();
  connect();
}