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
    return `<a href="https://four.meme/en/token/${addr}">Four.meme</a>`;
  if (source === "flap")
    return `<a href="https://flap.sh/bnb/${addr}">Flap.sh</a>`;
  return escapeHTML(source || "unknown");
}

// =========================
// FETCH TOKEN INFO (lengkap)
// =========================
async function getTokenInfo(tokenAddress) {
  try {
    const { rows } = await db.query(`
      SELECT
        lt.name, lt.symbol, lt.source_from, lt.image_url,
        lt.base_pair,
        ts.price_usdt, ts.marketcap, ts.volume_24h,
        ts.tx_count, ts.holder_count, ts.paperhand_pct,
        tls.progress, tls.target, tls.mode,
        tls.bonding_base, tls.base_symbol,
        tls.base_liquidity, tls.liquidity_usd
      FROM launch_tokens lt
      LEFT JOIN token_stats ts
        ON LOWER(ts.token_address) = LOWER(lt.token_address)
      LEFT JOIN token_liquidity_state tls
        ON LOWER(tls.token_address) = LOWER(lt.token_address)
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
// FETCH TOP HOLDERS
// =========================
async function getTopHolders(tokenAddress) {
  try {
    const { rows } = await db.query(`
      SELECT holder_address, balance
      FROM token_holders
      WHERE LOWER(token_address) = LOWER($1)
        AND balance > 0
      ORDER BY balance DESC
      LIMIT 5
    `, [tokenAddress]);
    return rows;
  } catch { return []; }
}

// =========================
// SEND HELPER
// =========================
async function send(imageUrl, caption, keyboard, extraOpts = {}) {
  const opts = {
    parse_mode              : "HTML",
    disable_web_page_preview: true,
    reply_markup            : { inline_keyboard: keyboard },
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
  if (multiplier >= 100) return "💎🚀🔥";
  if (multiplier >= 50)  return "💎🚀";
  if (multiplier >= 10)  return "🚀🔥";
  return "📈💸";
}

// =========================
// MOMENTUM ALERT — Entry Signal
// =========================
export async function sendMomentumAlert(tokenAddress, data) {
  const info    = await getTokenInfo(tokenAddress);
  const holders = await getTopHolders(tokenAddress);

  const name        = escapeHTML(info?.name        || "Unknown");
  const symbol      = escapeHTML(info?.symbol      || "???");
  const source      = launchpadLink(info?.source_from || "", tokenAddress);
  const mcap        = fmtUSD(info?.marketcap       || data.marketcap || 0);
  const vol         = fmtUSD(info?.volume_24h      || data.volume24h || 0);
  const holderCount = info?.holder_count           || data.holderCount || 0;
  const txCount     = info?.tx_count               || data.txCount    || 0;
  const paperhand   = Number(info?.paperhand_pct   || data.paperHandPct || 0).toFixed(1);
  const mode        = info?.mode                   || data.mode || "bonding";
  const imageUrl    = info?.image_url              || null;
  const baseSymbol  = info?.base_symbol            || info?.base_pair || data.baseSymbol || "BNB";

  // Progress (bonding)
  const progress    = Number(info?.progress || data.progress || 0) * 100;
  const bar         = mode !== "dex" ? progressBar(progress) : null;

  // Liquidity
  let liqLine = "";
  if (mode === "dex") {
    const liqBase = fmtBNB(info?.base_liquidity || data.liquidity?.base || 0);
    const liqUSD  = fmtUSD(info?.liquidity_usd  || data.liquidity?.usd  || 0);
    liqLine = `💧  <b>Liquidity</b>       ${liqBase.replace("BNB", baseSymbol)}  ≈  ${liqUSD}`;
  } else {
    const bondingBase = Number(info?.bonding_base || data.bondingLiquidity?.base || 0).toFixed(2);
    const target      = fmtUSD(info?.target || data.targetUSD || 10000);
    liqLine = `💧  <b>Bonding</b>         ${bondingBase} ${baseSymbol}  /  ${target}`;
  }

  // Top 5 holders
  let holdersLine = "";
  if (holders.length > 0) {
    const totalSupply = 1_000_000_000;
    holdersLine = holders.map((h, i) => {
      const pct   = ((Number(h.balance) / totalSupply) * 100).toFixed(1);
      const addr  = h.holder_address;
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      const url   = `https://bscscan.com/address/${addr}`;
      return `    ${i + 1}. <a href="${url}">${short}</a>  ${pct}%`;
    }).join("\n");
  }

  const tokenUrl = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
  const bscUrl   = `https://bscscan.com/address/${tokenAddress}`;
  const dexUrl   = `https://dexscreener.com/bsc/${tokenAddress}`;

  const lines = [
    `⚡️  <b>Entry Signal</b>`,
    ``,
    `<b>${name}</b>  <code>$${symbol}</code>`,
    `<code>${tokenAddress}</code>`,
    ``,
    `──────────────────`,
  ];

  if (bar) {
    lines.push(`📈  <b>Bonding Progress</b>`);
    lines.push(`${bar}  <b>${progress.toFixed(1)}%</b>`);
    lines.push(``);
  }

  lines.push(
    `💹  <b>Market Cap</b>     ${mcap}`,
    `📊  <b>Volume 24h</b>     ${vol}`,
    liqLine,
    ``,
    `👥  <b>Holders</b>        ${holderCount}`,
    `🔄  <b>Transactions</b>   ${txCount}`,
    `🤝  <b>Paperhand</b>      ${paperhand}%`,
    ``,
    `🏭  <b>Launchpad</b>      ${source}`,
  );

  if (holdersLine) {
    lines.push(``);
    lines.push(`🐋  <b>Top 5 Holders</b>`);
    lines.push(holdersLine);
  }

  lines.push(`──────────────────`);
  lines.push(`<i>High activity detected in the last 60 seconds.</i>`);

  const caption = lines.join("\n");

  try {
    const trackUrl = `https://t.me/superczpro_bot?start=token_${tokenAddress}`;
    const sentMsg = await send(imageUrl, caption, [
      [{ text: "🚀 Trade on SuperCZ", url: tokenUrl }],
      [
        { text: "🔍 Track", url: trackUrl },
        { text: "📊 DexScreener", url: dexUrl },
        { text: "🔗 BSCScan", url: bscUrl }
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
// MULTIPLIER UPDATE — Reply ke Entry Signal (tanpa batas)
// =========================
export async function sendMultiplierUpdate({ tokenAddress, data, entryMcap, currentMcap, multiplier, replyMsgId, imageUrl }) {
  const info = await getTokenInfo(tokenAddress);

  const name        = escapeHTML(info?.name        || "Unknown");
  const symbol      = escapeHTML(info?.symbol      || "???");
  const holderCount = info?.holder_count           || 0;
  const txCount     = info?.tx_count               || data.txCount || 0;
  const vol         = fmtUSD(info?.volume_24h      || data.volume24h || 0);
  const paperhand   = Number(info?.paperhand_pct   || 0).toFixed(1);
  const img         = imageUrl || info?.image_url  || null;
  const mode        = info?.mode                   || data.mode || "bonding";
  const baseSymbol  = info?.base_symbol            || info?.base_pair || "BNB";

  const entryFmt   = fmtUSD(entryMcap);
  const currentFmt = fmtUSD(currentMcap);
  const tokenUrl   = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
  const bscUrl     = `https://bscscan.com/address/${tokenAddress}`;

  const channelUsername = (process.env.NOTIFY_CHANNEL_ID || "").replace("@", "");
  const entrySignalUrl  = `https://t.me/${channelUsername}/${replyMsgId}`;

  // Liquidity
  let liqLine = "";
  if (mode === "dex") {
    const liqBase = fmtBNB(info?.base_liquidity || data.liquidity?.base || 0);
    const liqUSD  = fmtUSD(info?.liquidity_usd  || data.liquidity?.usd  || 0);
    liqLine = `💧  <b>Liquidity</b>       ${liqBase.replace("BNB", baseSymbol)}  ≈  ${liqUSD}`;
  } else {
    const bondingBase = Number(info?.bonding_base || 0).toFixed(2);
    const target      = fmtUSD(info?.target || 10000);
    liqLine = `💧  <b>Bonding</b>         ${bondingBase} ${baseSymbol}  /  ${target}`;
  }

  const badge = multiplier >= 100 ? `💎 ${multiplier}X`
              : multiplier >= 50  ? `🔥 ${multiplier}X`
              : multiplier >= 10  ? `🚀 ${multiplier}X`
              : `📈 ${multiplier}X`;

  const caption = [
    `${badge}  <b>${name}</b>  <code>$${symbol}</code>`,
    `is up <b>${multiplier}X</b> from <a href="${entrySignalUrl}">entry signal</a>`,
    ``,
    `──────────────────`,
    `💹  <b>Market Cap</b>`,
    `    ${entryFmt}  →  <b>${currentFmt}</b>`,
    ``,
    `📊  <b>Volume 24h</b>     ${vol}`,
    liqLine,
    `👥  <b>Holders</b>        ${holderCount}`,
    `🔄  <b>Transactions</b>   ${txCount}`,
    `🤝  <b>Paperhand</b>      ${paperhand}%`,
    `──────────────────`,
    ``,
    moneyEmoji(multiplier),
  ].join("\n");

  try {
    const trackUrl = `https://t.me/superczpro_bot?start=token_${tokenAddress}`;
    const sentMsg = await send(img, caption, [
      [{ text: "🚀 Trade on SuperCZ", url: tokenUrl }],
      [
        { text: "🔍 Track", url: trackUrl },
        { text: "🔗 BSCScan", url: bscUrl }
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