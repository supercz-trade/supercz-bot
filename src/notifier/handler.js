// src/notifier/handler.js

import { sentMigrating, sentMigrated } from "./state.js";
import {
  sendMigratingAlert,
  sendMigratedAlert,
  sendMomentumAlert,
  sendMultiplierUpdate,
} from "./messages.js";

// =========================
// CONFIG
// =========================
const MIGRATING_THRESHOLD = 90;

const MOMENTUM_WINDOW_MS = 60_000;
const MOMENTUM_MIN_TX    = 5;
const MOMENTUM_MIN_VOL   = 200;    // $200 dalam 60 detik
const MOMENTUM_MIN_MCAP  = 5_000;  // mcap > $5K
const MOMENTUM_COOLDOWN  = 5 * 60_000;

const MULTIPLIER_LEVELS = [2, 5, 10, 25, 50, 100];

const momentumState = new Map();
export const entrySignals = new Map();

// =========================
// TRACK MOMENTUM DELTA
// =========================
function track(addr, data) {
  const now     = Date.now();
  const txCount = Number(data.txCount   || 0);
  const vol     = Number(data.volume24h || 0);

  let s = momentumState.get(addr);

  if (!s) {
    momentumState.set(addr, {
      lastTxCount : txCount,
      lastVol     : vol,
      windowTx    : 0,
      windowVol   : 0,
      windowStart : now,
      lastNotif   : 0,
    });
    return null;
  }

  if ((now - s.windowStart) > MOMENTUM_WINDOW_MS) {
    s.windowTx    = 0;
    s.windowVol   = 0;
    s.windowStart = now;
  }

  s.windowTx  += Math.max(0, txCount - s.lastTxCount);
  s.windowVol += Math.max(0, vol     - s.lastVol);
  s.lastTxCount = txCount;
  s.lastVol     = vol;

  return s;
}

// =========================
// CEK MULTIPLIER UPDATE
// =========================
async function checkMultiplier(addr, data) {
  const entry = entrySignals.get(addr);
  if (!entry) return;

  const currentMcap = Number(data.marketcap || 0);
  if (!currentMcap || !entry.entryMcap) return;

  const multiplier = currentMcap / entry.entryMcap;
  const nextLevel  = MULTIPLIER_LEVELS[entry.nextLevelIdx];
  if (!nextLevel) return;

  if (multiplier >= nextLevel) {
    entry.nextLevelIdx++;
    await sendMultiplierUpdate({
      tokenAddress : addr,
      data,
      entryMcap    : entry.entryMcap,
      currentMcap,
      multiplier   : nextLevel,
      replyMsgId   : entry.messageId,
      imageUrl     : entry.imageUrl,
    });
  }
}

// =========================
// MAIN HANDLER
// =========================
export async function handleTokenUpdate(data) {
  const addr = data.tokenAddress.toLowerCase();
  const mcap = Number(data.marketcap || 0);

  // MIGRATED
  if (data.mode === "dex") {
    if (sentMigrated.has(addr)) return;
    sentMigrated.add(addr);
    await sendMigratedAlert(addr, data);
    return;
  }

  // MIGRATING (90%+)
  if (typeof data.progress === "number" && data.progress >= MIGRATING_THRESHOLD) {
    if (!sentMigrating.has(addr)) {
      sentMigrating.add(addr);
      await sendMigratingAlert(addr, data);
    }
    return;
  }

  // CEK MULTIPLIER
  await checkMultiplier(addr, data);

  // Kalau sudah punya entry signal — hanya track multiplier, tidak kirim entry baru
  if (entrySignals.has(addr)) return;

  // MOMENTUM — harus ketiga terpenuhi
  const s = track(addr, data);
  if (!s) return;

  const now      = Date.now();
  const hotTx    = s.windowTx  >= MOMENTUM_MIN_TX;
  const hotVol   = s.windowVol >= MOMENTUM_MIN_VOL;
  const hotMcap  = mcap        >= MOMENTUM_MIN_MCAP;
  const cooldown = (now - s.lastNotif) > MOMENTUM_COOLDOWN;

  if (cooldown && hotTx && hotVol && hotMcap) {
    console.log(`[NOTIFIER] ENTRY SIGNAL: ${addr} tx+${s.windowTx} vol+$${s.windowVol.toFixed(0)} mcap:$${mcap.toFixed(0)}`);
    s.lastNotif   = now;
    s.windowTx    = 0;
    s.windowVol   = 0;
    s.windowStart = now;

    const sentMsg = await sendMomentumAlert(addr, data);

    if (sentMsg) {
      entrySignals.set(addr, {
        messageId    : sentMsg.message_id,
        entryMcap    : mcap,
        nextLevelIdx : 0,
        imageUrl     : sentMsg._imageUrl || null,
      });
    }
  }
}