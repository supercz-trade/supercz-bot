// src/notifier/messages.js

import { bot }  from "../bot.js";
import { db }   from "../db.js";
import { escapeHTML, fmtUSD, fmtBNB, progressBar } from "../utils/format.js";

const CHANNEL_ID = process.env.NOTIFY_CHANNEL_ID;

// =========================
// LAUNCHPAD URL HELPER
// =========================
function launchpadLink(source, tokenAddress) {
  const addr = tokenAddress.toLowerCase();
  if (source === "four_meme")
    return `<a href="https://four.meme/en/token/${addr}">${source === "four_meme" ? "Four.meme" : source}</a>`;
  if (source === "flap")
    return `<a href="https://flap.sh/bnb/${addr}">Flap.sh</a>`;
  return escapeHTML(source || "unknown");
}

// =========================
// FETCH TOKEN INFO
// =========================
async function getTokenInfo(tokenAddress) {
  try {
    const { rows } = await db.query(`
      SELECT
        lt.name, lt.symbol, lt.source_from, lt.image_url,
        ts.price_usdt, ts.marketcap, ts.volume_24h,
        ts.tx_count, ts.holder_count
      FROM launch_tokens lt
      LEFT JOIN token_stats ts
        ON LOWER(ts.token_address) = LOWER(lt.token_address)
      WHERE LOWER(lt.token_address) = LOWER($1)
      LIMIT 1
    `, [tokenAddress]);
    return rows[0] || null;
  } catch (err) {
    console.error("[NOTIFIER] getTokenInfo error:", err.message);
    return null;
  }
}

// =========================
// SEND HELPER
// =========================
async function send(imageUrl, caption, keyboard, extraOpts = {}) {
  const opts = {
    parse_mode             : "HTML",
    disable_web_page_preview: true,
    reply_markup           : { inline_keyboard: keyboard },
    ...extraOpts,
  };

  if (imageUrl) {
    return bot.sendPhoto(CHANNEL_ID, imageUrl, { caption, ...opts })
      .catch(async (err) => {
        console.warn("[NOTIFIER] sendPhoto failed, fallback:", err.message);
        return bot.sendMessage(CHANNEL_ID, caption, opts);
      });
  }

  return bot.sendMessage(CHANNEL_ID, caption, opts);
}

// =========================
// EMOJI MONEY SCALER
// =========================
function moneyEmoji(multiplier) {
  return "💸".repeat(Math.min(multiplier * 2, 100));
}

// =========================
// MIGRATED ALERT
// =========================
export async function sendMigratedAlert(tokenAddress, data) {
  const info = await getTokenInfo(tokenAddress);

  const name       = escapeHTML(info?.name        || "Unknown");
  const symbol     = escapeHTML(info?.symbol      || "???");
  const source = launchpadLink(info?.source_from || "", tokenAddress);
  const mcap       = fmtUSD(info?.marketcap       || data.marketcap || 0);
  const vol        = fmtUSD(info?.volume_24h      || data.volume24h || 0);
  const holders    = info?.holder_count           || 0;
  const liqUSD     = fmtUSD(data.liquidity?.usd   || 0);
  const liqBase    = fmtBNB(data.liquidity?.base  || 0);
  const baseSymbol = data.baseSymbol              || "BNB";
  const platform   = launchpadLink(info?.source_from || data.platform || "", tokenAddress);
  const imageUrl   = info?.image_url              || null;

  const tokenUrl = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
  const bscUrl   = `https://bscscan.com/address/${tokenAddress}`;
  const dexUrl   = `https://dexscreener.com/bsc/${tokenAddress}`;

  const caption = [
    `🚀  <b>Token Migrated to DEX</b>`,
    ``,
    `<b>${name}</b>  <code>$${symbol}</code>`,
    `<code>${tokenAddress}</code>`,
    ``,
    `──────────────────`,
    `💧  <b>Liquidity</b>`,
    `    ${liqBase.replace("BNB", baseSymbol)}  ≈  ${liqUSD}`,
    ``,
    `💹  <b>Market Cap</b>     ${mcap}`,
    `📊  <b>Volume 24h</b>     ${vol}`,
    `👥  <b>Holders</b>        ${holders}`,
    ``,
    `🏭  <b>From</b>           ${source}`,
    `🔀  <b>DEX</b>            ${platform}`,
    `──────────────────`,
    `<i>Now trading on decentralized exchange. DYOR.</i>`,
  ].join("\n");

  await send(imageUrl, caption, [
    [{ text: "Trade on SuperCZ  →", url: tokenUrl }],
    [
      { text: "DexScreener", url: dexUrl },
      { text: "BSCScan", url: bscUrl }
    ]
  ]).catch(err => console.error("[NOTIFIER] sendMigratedAlert error:", err.message));

  console.log(`[NOTIFIER] MIGRATED sent: ${symbol}`);
}

// =========================
// MOMENTUM ALERT — Entry Signal
// =========================
export async function sendMomentumAlert(tokenAddress, data) {
  const info = await getTokenInfo(tokenAddress);

  const name     = escapeHTML(info?.name        || "Unknown");
  const symbol   = escapeHTML(info?.symbol      || "???");
  const source = launchpadLink(info?.source_from || "", tokenAddress);
  const mcap     = fmtUSD(info?.marketcap       || data.marketcap || 0);
  const vol      = fmtUSD(info?.volume_24h      || data.volume24h || 0);
  const holders  = info?.holder_count           || 0;
  const txCount  = info?.tx_count               || data.txCount   || 0;
  const progress = Number(data.progress         || 0);
  const bar      = progressBar(progress);
  const imageUrl = info?.image_url              || null;

  const tokenUrl = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
  const bscUrl   = `https://bscscan.com/address/${tokenAddress}`;

  const caption = [
    `⚡️  <b>Entry Signal</b>`,
    ``,
    `<b>${name}</b>  <code>$${symbol}</code>`,
    `<code>${tokenAddress}</code>`,
    ``,
    `──────────────────`,
    `📈  <b>Bonding Progress</b>`,
    `${bar}  <b>${progress.toFixed(1)}%</b>`,
    ``,
    `💹  <b>Market Cap</b>     ${mcap}`,
    `📊  <b>Volume 24h</b>     ${vol}`,
    `👥  <b>Holders</b>        ${holders}`,
    `🔄  <b>Transactions</b>   ${txCount}`,
    ``,
    `🏭  <b>Launchpad</b>      ${source}`,
    `──────────────────`,
    `<i>High activity detected in the last 60 seconds.</i>`,
  ].join("\n");

  try {
    const sentMsg = await send(imageUrl, caption, [
      [
        { text: "Trade on SuperCZ  →", url: tokenUrl },
        { text: "BSCScan", url: bscUrl }
      ]
    ]);
    if (sentMsg) sentMsg._imageUrl = imageUrl;
    console.log(`[NOTIFIER] ENTRY SIGNAL sent: ${symbol} msgId:${sentMsg?.message_id}`);
    return sentMsg;
  } catch (err) {
    console.error("[NOTIFIER] sendMomentumAlert error:", err.message);
    return null;
  }
}

// =========================
// MULTIPLIER UPDATE — Reply ke Entry Signal
// =========================
export async function sendMultiplierUpdate({ tokenAddress, data, entryMcap, currentMcap, multiplier, replyMsgId, imageUrl }) {
  const info = await getTokenInfo(tokenAddress);

  const name    = escapeHTML(info?.name   || "Unknown");
  const symbol  = escapeHTML(info?.symbol || "???");
  const holders = info?.holder_count      || 0;
  const vol     = fmtUSD(info?.volume_24h || data.volume24h || 0);
  const img     = imageUrl || info?.image_url || null;

  const entryFmt   = fmtUSD(entryMcap);
  const currentFmt = fmtUSD(currentMcap);
  const tokenUrl   = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
  const bscUrl     = `https://bscscan.com/address/${tokenAddress}`;

  const badge = multiplier >= 50 ? `🔥 ${multiplier}X`
              : multiplier >= 10 ? `🚀 ${multiplier}X`
              : `📈 ${multiplier}X`;

  const channelUsername = (process.env.NOTIFY_CHANNEL_ID || "").replace("@", "");
  const entrySignalUrl  = `https://t.me/${channelUsername}/${replyMsgId}`;

  const caption = [
    `${badge}  <b>${name}</b>  <code>$${symbol}</code>`,
    `is up <b>${multiplier}X</b> from <a href="${entrySignalUrl}">entry signal</a>`,
    ``,
    `──────────────────`,
    `💹  <b>Market Cap</b>`,
    `    ${entryFmt}  →  <b>${currentFmt}</b>`,
    ``,
    `📊  <b>Volume 24h</b>     ${vol}`,
    `👥  <b>Holders</b>        ${holders}`,
    `──────────────────`,
    ``,
    moneyEmoji(multiplier),
  ].join("\n");

  try {
    const sentMsg = await send(img, caption, [
      [
        { text: "Trade on SuperCZ  →", url: tokenUrl },
        { text: "BSCScan", url: bscUrl }
      ]
    ], {
      reply_parameters: { message_id: replyMsgId }
    });
    console.log(`[NOTIFIER] ${multiplier}X UPDATE sent: ${symbol}`);
    return sentMsg;
  } catch (err) {
    console.error("[NOTIFIER] sendMultiplierUpdate error:", err.message);
    return null;
  }
}

// =========================
// MIGRATING ALERT (90%+)
// =========================
export async function sendMigratingAlert(tokenAddress, data) {
  const info = await getTokenInfo(tokenAddress);

  const name     = escapeHTML(info?.name        || "Unknown");
  const symbol   = escapeHTML(info?.symbol      || "???");
  const source = launchpadLink(info?.source_from || "", tokenAddress);
  const mcap     = fmtUSD(info?.marketcap       || data.marketcap || 0);
  const vol      = fmtUSD(info?.volume_24h      || data.volume24h || 0);
  const holders  = info?.holder_count           || 0;
  const txCount  = info?.tx_count               || 0;
  const progress = Number(data.progress         || 0);
  const bar      = progressBar(progress);
  const imageUrl = info?.image_url              || null;

  const tokenUrl = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
  const bscUrl   = `https://bscscan.com/address/${tokenAddress}`;

  const caption = [
    `⚡️  <b>Token About to Migrate</b>`,
    ``,
    `<b>${name}</b>  <code>$${symbol}</code>`,
    `<code>${tokenAddress}</code>`,
    ``,
    `──────────────────`,
    `📈  <b>Bonding Progress</b>`,
    `${bar}  <b>${progress.toFixed(1)}%</b>`,
    ``,
    `💹  <b>Market Cap</b>     ${mcap}`,
    `📊  <b>Volume 24h</b>     ${vol}`,
    `👥  <b>Holders</b>        ${holders}`,
    `🔄  <b>Transactions</b>   ${txCount}`,
    ``,
    `🏭  <b>Launchpad</b>      ${source}`,
    `──────────────────`,
    `<i>Migration imminent — approaching graduation threshold.</i>`,
  ].join("\n");

  await send(imageUrl, caption, [
    [
      { text: "Trade on SuperCZ  →", url: tokenUrl },
      { text: "BSCScan", url: bscUrl }
    ]
  ]).catch(err => console.error("[NOTIFIER] sendMigratingAlert error:", err.message));

  console.log(`[NOTIFIER] MIGRATING sent: ${symbol}`);
}