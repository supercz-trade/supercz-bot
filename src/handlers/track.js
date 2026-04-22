// src/handlers/track.js

import { bot } from "../bot.js";
import { db }  from "../db.js";
import { escapeHTML, fmtUSD } from "../utils/format.js";
import { entrySignals } from "../notifier/handler.js";

const BASE_MULTIPLIER_LEVELS = [2, 5, 10, 25, 50, 100, 200, 500, 1000];

function getReachedMultiplier(addr) {
  const entry = entrySignals.get(addr.toLowerCase());
  if (!entry || entry.nextLevelIdx === 0) return null;
  const idx = entry.nextLevelIdx - 1;
  if (idx < BASE_MULTIPLIER_LEVELS.length) return BASE_MULTIPLIER_LEVELS[idx];
  const last = BASE_MULTIPLIER_LEVELS[BASE_MULTIPLIER_LEVELS.length - 1];
  return last * Math.pow(2, idx - BASE_MULTIPLIER_LEVELS.length + 1);
}

// =========================
// FETCH & SEND TOKEN INFO
// =========================
async function sendTokenInfo(chatId, tokenAddress) {
  tokenAddress = tokenAddress.toLowerCase();

  try {
    const { rows } = await db.query(`
      SELECT
        lt.name, lt.symbol, lt.image_url,
        lt.base_pair, lt.developer_address,
        ts.price_usdt, ts.marketcap, ts.volume_24h,
        ts.tx_count, ts.holder_count, ts.paperhand_pct,
        tls.progress, tls.target, tls.mode,
        tls.bonding_base, tls.base_symbol,
        tls.base_liquidity, tls.liquidity_usd
      FROM launch_tokens lt
      LEFT JOIN token_stats ts ON LOWER(ts.token_address) = LOWER(lt.token_address)
      LEFT JOIN token_liquidity_state tls ON LOWER(tls.token_address) = LOWER(lt.token_address)
      WHERE LOWER(lt.token_address) = $1
      LIMIT 1
    `, [tokenAddress]);

    if (!rows.length) {
      return bot.sendMessage(chatId, "❌ Token not found.");
    }

    const info       = rows[0];
    const name       = escapeHTML(info.name   || "Unknown");
    const symbol     = escapeHTML(info.symbol || "???");
    const mcap       = fmtUSD(info.marketcap  || 0);
    const vol        = fmtUSD(info.volume_24h || 0);
    const price      = Number(info.price_usdt || 0).toFixed(8);
    const holders    = info.holder_count || 0;
    const txCount    = info.tx_count     || 0;
    const paperhand  = Number(info.paperhand_pct || 0).toFixed(1);
    const mode       = info.mode || "bonding";
    const baseSymbol = info.base_symbol || info.base_pair || "BNB";

    // Signal performance
    const xReached = getReachedMultiplier(tokenAddress);
    const entry    = entrySignals.get(tokenAddress);
    const signalLine = xReached
      ? `📈  <b>${xReached}X</b>  from entry  <i>(${fmtUSD(entry?.entryMcap || 0)} → ${mcap})</i>`
      : entry
        ? `📈  Signal active  —  entry at ${fmtUSD(entry?.entryMcap || 0)}`
        : null;

    // Liquidity line
    let liqLine;
    if (mode === "dex") {
      const base = Number(info.base_liquidity || 0).toFixed(2);
      const usd  = fmtUSD(info.liquidity_usd  || 0);
      liqLine = `💧  ${base} ${baseSymbol}  ≈  ${usd}`;
    } else {
      const pct  = (Number(info.progress || 0) * 100).toFixed(1);
      const base = Number(info.bonding_base || 0).toFixed(2);
      liqLine = `💧  ${base} ${baseSymbol}  ·  ${pct}% bonding`;
    }

    // Buy/sell ratio
    const { rows: vol2 } = await db.query(`
      SELECT
        COALESCE(SUM(in_usdt_payable) FILTER (WHERE position='BUY'),  0) AS buy_vol,
        COALESCE(SUM(in_usdt_payable) FILTER (WHERE position='SELL'), 0) AS sell_vol
      FROM token_transactions
      WHERE LOWER(token_address) = $1 AND position IN ('BUY','SELL')
    `, [tokenAddress]);

    const buyVol  = Number(vol2[0]?.buy_vol  || 0);
    const sellVol = Number(vol2[0]?.sell_vol || 0);
    const total   = buyVol + sellVol;
    const buyPct  = total > 0 ? ((buyVol / total) * 100).toFixed(0) : 0;
    const sellPct = total > 0 ? (100 - buyPct) : 0;

    const tokenUrl = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
    const bscUrl   = `https://bscscan.com/address/${tokenAddress}`;
    const dexUrl   = `https://dexscreener.com/bsc/${tokenAddress}`;

    const lines = [
      `<b>${name}</b>  <code>$${symbol}</code>`,
      `<code>${tokenAddress}</code>`,
      ``,
      `💵  <b>${mcap}</b>  ·  $${price}`,
      liqLine,
      ``,
      `📊  Vol  ${vol}  ·  ${txCount} tx  ·  ${holders} holders`,
      `⚖️  Buy ${buyPct}%  /  Sell ${sellPct}%  ·  PH ${paperhand}%`,
      signalLine,
    ].filter(Boolean).join("\n");

    const opts = {
      parse_mode              : "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🚀 Trade on SuperCZ", url: tokenUrl }],
          [
            { text: "📊 DexScreener", url: dexUrl },
            { text: "🔗 BSCScan", url: bscUrl }
          ]
        ]
      }
    };

    const imageUrl = info.image_url || null;
    if (imageUrl) {
      await bot.sendPhoto(chatId, imageUrl, { caption: lines, ...opts })
        .catch(() => bot.sendMessage(chatId, lines, opts));
    } else {
      await bot.sendMessage(chatId, lines, opts);
    }

  } catch (err) {
    console.error("[TRACK] error:", err.message);
    bot.sendMessage(chatId, "❌ Failed to fetch token info. Please try again.");
  }
}

// =========================
// /start token_0x... (from channel button)
// =========================
bot.onText(/\/start token_(0x[a-fA-F0-9]{40})/, async (msg, match) => {
  await sendTokenInfo(msg.chat.id, match[1]);
});

// =========================
// /track <address>
// =========================
bot.onText(/\/track(?:\s+(0x[a-fA-F0-9]{40}))?/, async (msg, match) => {
  const chatId  = msg.chat.id;
  const address = match?.[1];

  if (!address) {
    return bot.sendMessage(chatId,
      "Usage: <code>/track 0x1234...abcd</code>",
      { parse_mode: "HTML" }
    );
  }

  await sendTokenInfo(chatId, address);
});