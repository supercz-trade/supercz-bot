// src/notifier/handler.js

import { db } from "../db.js";
import {
  sendMomentumAlert,
  sendMultiplierUpdate,
} from "./messages.js";

// =========================
// CONFIG
// =========================
const MOMENTUM_WINDOW_MS = 60_000;
const MOMENTUM_MIN_TX    = 10;
const MOMENTUM_MIN_VOL   = 500;
const MOMENTUM_MIN_MCAP  = 5_000;
const MOMENTUM_COOLDOWN  = 5 * 60_000;

const MIN_HOLDERS         = 50;
const MIN_TX_COUNT        = 30;
const MAX_DEV_HOLD_PCT    = 5;
const MIN_PAPERHAND_PCT   = 30;
const MAX_PAPERHAND_PCT   = 70;
const MAX_TOP10_PCT       = 60;
const MAX_TOP1_PCT        = 20;
const MAX_TX_HOLDER_RATIO = 20;
const MIN_VOL_MCAP_RATIO  = 0.1;

const BASE_MULTIPLIER_LEVELS = [2, 5, 10, 25, 50, 100, 200, 500, 1000];

const momentumState = new Map();
export const entrySignals = new Map();
const filterLogCooldown = new Map(); // suppress repeat filter logs

// =========================
// GET NEXT MULTIPLIER LEVEL
// =========================
function getNextLevel(idx) {
  if (idx < BASE_MULTIPLIER_LEVELS.length) {
    return BASE_MULTIPLIER_LEVELS[idx];
  }
  const last  = BASE_MULTIPLIER_LEVELS[BASE_MULTIPLIER_LEVELS.length - 1];
  const extra = idx - BASE_MULTIPLIER_LEVELS.length;
  return last * Math.pow(2, extra + 1);
}

// =========================
// LOAD SIGNALS FROM DB
// =========================
export async function loadExistingSignals() {
  try {
    const { rows } = await db.query(`
      SELECT token_address, message_id, entry_mcap, next_level_idx, image_url
      FROM notifier_signals
    `);

    for (const r of rows) {
      entrySignals.set(r.token_address.toLowerCase(), {
        messageId    : r.message_id,
        entryMcap    : Number(r.entry_mcap),
        nextLevelIdx : r.next_level_idx,
        imageUrl     : r.image_url || null,
      });
    }

    console.log(`[NOTIFIER] loaded ${rows.length} existing signals from DB`);
  } catch (err) {
    console.error("[NOTIFIER] loadExistingSignals error:", err.message);
  }
}

// =========================
// SAVE SIGNAL TO DB
// =========================
async function saveSignal(tokenAddress, entry) {
  try {
    await db.query(`
      INSERT INTO notifier_signals (token_address, message_id, entry_mcap, next_level_idx, image_url, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (token_address) DO UPDATE
        SET message_id     = EXCLUDED.message_id,
            entry_mcap     = EXCLUDED.entry_mcap,
            next_level_idx = EXCLUDED.next_level_idx,
            image_url      = EXCLUDED.image_url,
            updated_at     = NOW()
    `, [tokenAddress, entry.messageId, entry.entryMcap, entry.nextLevelIdx, entry.imageUrl]);
  } catch (err) {
    console.error("[NOTIFIER] saveSignal error:", err.message);
  }
}

// =========================
// QUALITY FILTER
// =========================
function passesQualityFilter(data) {
  const holderCount  = Number(data.holderCount  || 0);
  const txCount      = Number(data.txCount      || 0);
  const mcap         = Number(data.marketcap    || 0);
  const vol24h       = Number(data.volume24h    || 0);
  const devHoldPct   = Number(data.holderStats?.devHoldPct   ?? data.devHoldPct   ?? 0);
  const paperHandPct = Number(data.holderStats?.paperHandPct ?? data.paperHandPct ?? 0);
  const top10        = data.holderStats?.top10  || data.top10 || [];

  if (holderCount < MIN_HOLDERS)
    return { pass: false, reason: `holders ${holderCount} < ${MIN_HOLDERS}` };

  if (txCount < MIN_TX_COUNT)
    return { pass: false, reason: `txCount ${txCount} < ${MIN_TX_COUNT}` };

  if (devHoldPct > MAX_DEV_HOLD_PCT)
    return { pass: false, reason: `devHoldPct ${devHoldPct.toFixed(1)}% > ${MAX_DEV_HOLD_PCT}%` };

  if (paperHandPct < MIN_PAPERHAND_PCT || paperHandPct > MAX_PAPERHAND_PCT)
    return { pass: false, reason: `paperHandPct ${paperHandPct.toFixed(1)}% not in [${MIN_PAPERHAND_PCT}%–${MAX_PAPERHAND_PCT}%]` };

  if (top10.length > 0) {
    const top10Sum = top10.reduce((s, h) => s + Number(h.pct || 0), 0);
    if (top10Sum > MAX_TOP10_PCT)
      return { pass: false, reason: `top10 ${top10Sum.toFixed(1)}% > ${MAX_TOP10_PCT}%` };

    const top1Pct = Number(top10[0]?.pct || 0);
    if (top1Pct > MAX_TOP1_PCT)
      return { pass: false, reason: `top1 holder ${top1Pct.toFixed(1)}% > ${MAX_TOP1_PCT}%` };
  }

  if (holderCount > 0 && txCount / holderCount > MAX_TX_HOLDER_RATIO)
    return { pass: false, reason: `tx/holder ratio ${(txCount/holderCount).toFixed(1)} > ${MAX_TX_HOLDER_RATIO}` };

  if (mcap > 0 && vol24h / mcap < MIN_VOL_MCAP_RATIO)
    return { pass: false, reason: `vol/mcap ratio ${(vol24h/mcap).toFixed(2)} < ${MIN_VOL_MCAP_RATIO}` };

  return { pass: true };
}

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
  const nextLevel  = getNextLevel(entry.nextLevelIdx);

  if (multiplier >= nextLevel) {
    entry.nextLevelIdx++;
    await saveSignal(addr, entry);
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

  await checkMultiplier(addr, data);

  if (entrySignals.has(addr)) return;

  const s = track(addr, data);
  if (!s) return;

  const now      = Date.now();
  const hotTx    = s.windowTx  >= MOMENTUM_MIN_TX;
  const hotVol   = s.windowVol >= MOMENTUM_MIN_VOL;
  const hotMcap  = mcap        >= MOMENTUM_MIN_MCAP;
  const cooldown = (now - s.lastNotif) > MOMENTUM_COOLDOWN;

  if (!cooldown || !hotTx || !hotVol || !hotMcap) return;

  const { pass, reason } = passesQualityFilter(data);
  if (!pass) {
    const lastLog = filterLogCooldown.get(addr) || 0;
    if (Date.now() - lastLog > 5 * 60_000) {
      console.log(`[NOTIFIER] FILTERED: ${addr} — ${reason}`);
      filterLogCooldown.set(addr, Date.now());
    }
    return;
  }

  console.log(`[NOTIFIER] ENTRY SIGNAL: ${addr} tx+${s.windowTx} vol+$${s.windowVol.toFixed(0)} mcap:$${mcap.toFixed(0)}`);
  s.lastNotif   = now;
  s.windowTx    = 0;
  s.windowVol   = 0;
  s.windowStart = now;

  const sentMsg = await sendMomentumAlert(addr, data);

  if (sentMsg) {
    const entry = {
      messageId    : sentMsg.message_id,
      entryMcap    : mcap,
      nextLevelIdx : 0,
      imageUrl     : sentMsg._imageUrl || null,
    };
    entrySignals.set(addr, entry);
    await saveSignal(addr, entry);
  }
}