// src/handlers/track.js
// /start token_0x... — show detailed token info in private chat

import { bot } from "../bot.js";
import { db }  from "../db.js";
import { escapeHTML, fmtUSD, fmtBNB, progressBar } from "../utils/format.js";
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

bot.onText(/\/start token_(0x[a-fA-F0-9]{40})/, async (msg, match) => {
  const chatId       = msg.chat.id;
  const tokenAddress = match[1].toLowerCase();

  try {
    // ── Fetch token info ──────────────────────────────────────
    const { rows } = await db.query(`
      SELECT
        lt.name, lt.symbol, lt.source_from, lt.image_url,
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

    const info = rows[0];

    // ── Fetch top 20 holders ──────────────────────────────────
    const { rows: holders } = await db.query(`
      SELECT holder_address, balance
      FROM token_holders
      WHERE LOWER(token_address) = $1 AND balance > 0
      ORDER BY balance DESC
      LIMIT 10
    `, [tokenAddress]);

    // ── Fetch buy/sell volume breakdown ───────────────────────
    const { rows: vol } = await db.query(`
      SELECT
        COALESCE(SUM(in_usdt_payable) FILTER (WHERE position='BUY'),  0) AS buy_vol,
        COALESCE(SUM(in_usdt_payable) FILTER (WHERE position='SELL'), 0) AS sell_vol,
        COUNT(*) FILTER (WHERE position='BUY')  AS buy_count,
        COUNT(*) FILTER (WHERE position='SELL') AS sell_count
      FROM token_transactions
      WHERE LOWER(token_address) = $1
        AND position IN ('BUY','SELL')
    `, [tokenAddress]);

    // ── Fetch dev wallet activity ─────────────────────────────
    const devAddr = info.developer_address?.toLowerCase();
    let devLine = "";
    if (devAddr) {
      const { rows: devTx } = await db.query(`
        SELECT
          COALESCE(SUM(amount_base_payable) FILTER (WHERE position='BUY'),  0) AS dev_buy,
          COALESCE(SUM(amount_base_payable) FILTER (WHERE position='SELL'), 0) AS dev_sell
        FROM token_transactions
        WHERE LOWER(token_address) = $1
          AND LOWER(address_message_sender) = $2
          AND position IN ('BUY','SELL')
      `, [tokenAddress, devAddr]);

      if (devTx.length) {
        const devBuy  = Number(devTx[0].dev_buy  || 0).toFixed(4);
        const devSell = Number(devTx[0].dev_sell || 0).toFixed(4);
        const bs      = info.base_symbol || info.base_pair || "BNB";
        devLine = `Dev bought ${devBuy} ${bs} · sold ${devSell} ${bs}`;
      }
    }

    // ── Build message ─────────────────────────────────────────
    const name       = escapeHTML(info.name   || "Unknown");
    const symbol     = escapeHTML(info.symbol || "???");
    const mcap       = fmtUSD(info.marketcap  || 0);
    const vol24h     = fmtUSD(info.volume_24h || 0);
    const holders_n  = info.holder_count || 0;
    const txCount    = info.tx_count     || 0;
    const paperhand  = Number(info.paperhand_pct || 0).toFixed(1);
    const mode       = info.mode || "bonding";
    const baseSymbol = info.base_symbol || info.base_pair || "BNB";
    const buyVol     = fmtUSD(Number(vol[0]?.buy_vol  || 0));
    const sellVol    = fmtUSD(Number(vol[0]?.sell_vol || 0));
    const buyCount   = vol[0]?.buy_count  || 0;
    const sellCount  = vol[0]?.sell_count || 0;

    const tokenUrl  = `${process.env.FRONTEND_URL}/trade/${tokenAddress}`;
    const bscUrl    = `https://bscscan.com/address/${tokenAddress}`;
    const dexUrl    = `https://dexscreener.com/bsc/${tokenAddress}`;

    // Multiplier
    const xReached = getReachedMultiplier(tokenAddress);
    const entry    = entrySignals.get(tokenAddress);
    const xLine    = xReached
      ? `📈  <b>Signal Performance</b>   ${xReached}X  (entry: ${fmtUSD(entry?.entryMcap || 0)})`
      : `📈  <b>Signal Performance</b>   Tracking...`;

    // Liquidity
    let liqLine = "";
    if (mode === "dex") {
      const liqBase = Number(info.base_liquidity || 0).toFixed(4);
      const liqUSD  = fmtUSD(info.liquidity_usd || 0);
      liqLine = `💧  <b>Liquidity</b>         ${liqBase} ${baseSymbol}  ≈  ${liqUSD}`;
    } else {
      const progress = Number(info.progress || 0) * 100;
      const bar      = progressBar(progress);
      const bondBase = Number(info.bonding_base || 0).toFixed(2);
      const target   = fmtUSD(info.target || 10000);
      liqLine = `💧  <b>Bonding</b>           ${bar}  ${progress.toFixed(1)}%\n    ${bondBase} ${baseSymbol}  /  ${target}`;
    }

    // Top 20 holders
    const totalSupply  = 1_000_000_000;
    const holdersLines = holders.map((h, i) => {
      const pct   = ((Number(h.balance) / totalSupply) * 100).toFixed(1);
      const addr  = h.holder_address;
      const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      const url   = `https://bscscan.com/address/${addr}`;
      return `    ${(i + 1).toString().padStart(2)}. <a href="${url}">${short}</a>  ${pct}%`;
    }).join("\n");

    const lines = [
      `🔍  <b>Token Details</b>`,
      ``,
      `<b>${name}</b>  <code>$${symbol}</code>`,
      `<code>${tokenAddress}</code>`,
      ``,
      `──────────────────`,
      xLine,
      ``,
      `💹  <b>Market Cap</b>       ${mcap}`,
      `📊  <b>Volume 24h</b>       ${vol24h}`,
      liqLine,
      ``,
      `👥  <b>Holders</b>          ${holders_n}`,
      `🔄  <b>Transactions</b>     ${txCount}`,
      `🤝  <b>Paperhand</b>        ${paperhand}%`,
      ``,
      `──────────────────`,
      `📥  <b>Buy Volume</b>        ${buyVol}  (${buyCount} tx)`,
      `📤  <b>Sell Volume</b>       ${sellVol}  (${sellCount} tx)`,
      devLine ? `👨‍💻  <b>Dev Wallet</b>        ${devLine}` : null,
      ``,
      `──────────────────`,
      `🐋  <b>Top 10 Holders</b>`,
      holdersLines,
      `──────────────────`,
    ].filter(l => l !== null).join("\n");

    const imageUrl = info.image_url || null;
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
});