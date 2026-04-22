// src/notifier/trending.js

import { bot }         from "../bot.js";
import { db }          from "../db.js";
import { entrySignals } from "./handler.js";
import { escapeHTML, fmtUSD } from "../utils/format.js";

const CHANNEL_ID       = process.env.NOTIFY_CHANNEL_ID;
const TRENDING_MSG_ID  = 638;
const UPDATE_INTERVAL  = 5 * 60_000; // 5 menit

// =========================
// HOT SCORE
// score = (volume_1h / mcap) * holder_count * tx_count_1h
// =========================
async function getHotScores(tokenAddresses) {
  if (!tokenAddresses.length) return [];

  const { rows } = await db.query(`
    SELECT
      lt.token_address,
      lt.name,
      lt.symbol,
      ts.marketcap,
      ts.volume_24h,
      ts.tx_count,
      ts.holder_count,
      COALESCE(vol1h.vol, 0)  AS vol_1h,
      COALESCE(tx1h.cnt,  0)  AS tx_1h
    FROM launch_tokens lt
    LEFT JOIN token_stats ts
      ON LOWER(ts.token_address) = LOWER(lt.token_address)
    LEFT JOIN (
      SELECT token_address, SUM(in_usdt_payable) AS vol
      FROM token_transactions
      WHERE time > NOW() - INTERVAL '1 hour'
        AND position IN ('BUY','SELL')
      GROUP BY token_address
    ) vol1h ON LOWER(vol1h.token_address) = LOWER(lt.token_address)
    LEFT JOIN (
      SELECT token_address, COUNT(*) AS cnt
      FROM token_transactions
      WHERE time > NOW() - INTERVAL '1 hour'
        AND position IN ('BUY','SELL')
      GROUP BY token_address
    ) tx1h ON LOWER(tx1h.token_address) = LOWER(lt.token_address)
    WHERE LOWER(lt.token_address) = ANY($1)
  `, [tokenAddresses.map(a => a.toLowerCase())]);

  return rows.map(r => {
    const mcap      = Number(r.marketcap  || 0);
    const vol1h     = Number(r.vol_1h     || 0);
    const holderCnt = Number(r.holder_count || 0);
    const tx1h      = Number(r.tx_1h      || 0);

    const score = mcap > 0
      ? (vol1h / mcap) * holderCnt * tx1h
      : 0;

    return {
      tokenAddress : r.token_address,
      name         : r.name         || "Unknown",
      symbol       : r.symbol       || "???",
      marketcap    : mcap,
      volume24h    : Number(r.volume_24h || 0),
      txCount      : Number(r.tx_count   || 0),
      holderCount  : holderCnt,
      vol1h,
      tx1h,
      score,
    };
  });
}

// =========================
// FORMAT NUMBER
// =========================
function fmtNum(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

// =========================
// RANK MEDAL
// =========================
function rankLabel(i) {
  if (i === 0) return "🥇";
  if (i === 1) return "🥈";
  if (i === 2) return "🥉";
  return `${i + 1}.`;
}

// =========================
// MULTIPLIER BADGE
// =========================
function multiplierBadge(addr) {
  const entry = entrySignals.get(addr.toLowerCase());
  if (!entry || entry.nextLevelIdx === 0) return "";

  const levels = [2, 5, 10, 25, 50, 100, 200, 500, 1000];
  const reached = entry.nextLevelIdx - 1;
  const x = reached < levels.length
    ? levels[reached]
    : levels[levels.length - 1] * Math.pow(2, reached - levels.length + 1);

  return ` · ${x}X`;
}

// =========================
// BUILD MESSAGE
// =========================
function buildMessage(tokens, updatedAt) {
  const lines = [
    `🔥  <b>Trending Now</b>`,
    `<i>Top 10 tokens from our signals · ranked by activity</i>`,
    ``,
    `──────────────────`,
  ];

  if (!tokens.length) {
    lines.push(`<i>No signals yet. Check back soon.</i>`);
  } else {
    for (let i = 0; i < tokens.length; i++) {
      const t      = tokens[i];
      const rank   = rankLabel(i);
      const name   = escapeHTML(t.name);
      const symbol = escapeHTML(t.symbol);
      const mcap   = fmtNum(t.marketcap);
      const vol    = fmtNum(t.volume24h);
      const tx     = fmtCount(t.txCount);
      const h      = fmtCount(t.holderCount);
      const xbadge = multiplierBadge(t.tokenAddress);
      const url    = `${process.env.FRONTEND_URL}/trade/${t.tokenAddress}`;

      lines.push(
        `${rank}  <a href="${url}"><b>${name}</b></a>  <code>$${symbol}</code>${xbadge}`,
        `    Vol ${vol}  ·  ${tx} tx  ·  ${h} holders  ·  MCap ${mcap}`,
      );
    }
  }

  lines.push(
    `──────────────────`,
    `<a href="${process.env.FRONTEND_URL}">Trade on SuperCZ →</a>`,
    ``,
    `<i>Updated: ${updatedAt} UTC</i>`,
  );

  return lines.join("\n");
}

// =========================
// UPDATE TRENDING
// =========================
async function updateTrending() {
  try {
    const addrs = Array.from(entrySignals.keys());

    if (!addrs.length) {
      console.log("[TRENDING] no signals yet, skip");
      return;
    }

    const scores = await getHotScores(addrs);
    const top10  = scores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const now = new Date().toISOString().replace("T", " ").slice(0, 16);
    const text = buildMessage(top10, now);

    await bot.editMessageText(text, {
      chat_id    : CHANNEL_ID,
      message_id : TRENDING_MSG_ID,
      parse_mode : "HTML",
      disable_web_page_preview: true,
    });

    console.log(`[TRENDING] updated — ${top10.length} tokens`);

  } catch (err) {
    // Telegram throws jika text tidak berubah — ignore
    if (err.message?.includes("message is not modified")) return;
    console.error("[TRENDING] update error:", err.message);
  }
}

// =========================
// START
// =========================
export function startTrending() {
  updateTrending();
  setInterval(updateTrending, UPDATE_INTERVAL);
  console.log(`[TRENDING] started — update every ${UPDATE_INTERVAL / 60_000} min`);
}