// src/handlers/start.js
// /start (tanpa token)
// - User sudah terdaftar → tampil info akun
// - User baru → welcome message

import { bot } from "../bot.js";
import { db }  from "../db.js";
import { escapeHTML } from "../utils/format.js";

bot.onText(/\/start$/, async (msg) => {
  const chatId     = msg.chat.id;
  const telegramId = msg.from.id;

  // cek apakah user sudah terdaftar
  const userRes = await db.query(
    `SELECT u.username, u.referral_code, w.address, w.balance_bnb
     FROM users u
     LEFT JOIN wallets w ON w.user_id = u.id
     WHERE u.telegram_id = $1
     ORDER BY w.created_at ASC
     LIMIT 1`,
    [telegramId]
  );

  // =========================
  // USER SUDAH TERDAFTAR
  // =========================
  if (userRes.rows.length) {
    const u          = userRes.rows[0];
    const username   = escapeHTML(u.username || "Unknown");
    const referral   = u.referral_code || "-";
    const bnb        = Number(u.balance_bnb || 0).toFixed(4);
    const walletLine = u.address
      ? `💼  <b>Wallet</b>\n<code>${escapeHTML(u.address)}</code>`
      : `💼  <b>Wallet</b>\n<i>Not created yet</i>`;

    const message = [
      `👤  <b>Your Account</b>`,
      ``,
      `Hello, <b>${username}</b>!`,
      ``,
      `──────────────────`,
      `👤  <b>Username</b>`,
      `<code>${username}</code>`,
      ``,
      walletLine,
      ``,
      `💰  <b>BNB Balance</b>`,
      `<code>${bnb} BNB</code>`,
      ``,
      `🎁  <b>Referral Code</b>`,
      `<code>${referral}</code>`,
      `──────────────────`,
    ].join("\n");

    return bot.sendMessage(chatId, message, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open SuperCZ  →", url: process.env.FRONTEND_URL }]
        ]
      }
    });
  }

  // =========================
  // USER BARU
  // =========================
  const welcome = [
    `👋  <b>Welcome to SuperCZ</b>`,
    ``,
    `SuperCZ is a BSC token trading platform.`,
    `Trade, track, and grow your portfolio on-chain.`,
    ``,
    `──────────────────`,
    `To get started:`,
    `1. Visit the SuperCZ website`,
    `2. Click <b>Login with Telegram</b>`,
    `3. This bot will confirm your identity`,
    `──────────────────`,
    ``,
    `<i>Do not share any login links you receive here.</i>`
  ].join("\n");

  bot.sendMessage(chatId, welcome, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open SuperCZ  →", url: process.env.FRONTEND_URL }]
      ]
    }
  });
});