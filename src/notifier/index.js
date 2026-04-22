// src/notifier/index.js

import WebSocket                from "ws";
import { handleTokenUpdate, loadExistingSignals } from "./handler.js";
import { startTrending }        from "./trending.js";

let _ws = null;

function connect() {
  _ws = new WebSocket(process.env.WS_URL);

  _ws.on("open", () => {
    console.log("[NOTIFIER] WS connected:", process.env.WS_URL);
    _ws.send(JSON.stringify({ action: "subscribe", channel: "token_update" }));
  });

  _ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    const { channel, data } = msg;
    if (!channel || !data) return;

    if (channel === "token_update") {
      if (!data.tokenAddress) return;
      await handleTokenUpdate(data);
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
  await loadExistingSignals();
  connect();
  startTrending();
}