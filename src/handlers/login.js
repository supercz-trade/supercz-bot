// src/handlers/login.js
// /start {token} — Telegram login verification flow

import axios from "axios";
import { bot } from "../bot.js";
import { db }  from "../db.js";
import { escapeHTML } from "../utils/format.js";

bot.onText(/\/start (.+)/, async (msg, match) => {
  const chatId     = msg.chat.id;
  const token      = match[1];
  const telegramId = msg.from.id;

  try {

    // =========================
    // VALIDASI TOKEN
    // =========================

    const res = await db.query(
      "SELECT * FROM telegram_login_tokens WHERE token=$1",
      [token]
    );

    if (!res.rows.length)
      return bot.sendMessage(chatId, "❌ Invalid login link.");

    const record = res.rows[0];

    if (new Date() > new Date(record.expires_at + "Z"))
      return bot.sendMessage(chatId, "❌ This link has expired.");

    if (record.used)
      return bot.sendMessage(chatId, "❌ This link has already been used.");

    if (record.telegram_id && record.telegram_id !== telegramId)
      return bot.sendMessage(chatId, "❌ This link belongs to a different account.");

    // =========================
    // MARK TOKEN USED
    // =========================

    // used=true di-set oleh /auth/telegram/verify setelah JWT issued
    await db.query(
      "UPDATE telegram_login_tokens SET telegram_id=$1 WHERE token=$2",
      [telegramId, token]
    );

    // =========================
    // FETCH USER PREVIEW
    // =========================

    let preview = { username: "New User", wallet: null, bnb: 0 };

    try {
      const { data } = await axios.post(
        `${process.env.AUTH_BASE_URL}/auth/telegram/preview`,
        { token }
      );
      preview = data;
    } catch (err) {
      console.error("[LOGIN] preview fetch error:", err.message);
    }

    // =========================
    // BUILD MESSAGE
    // =========================

    const loginUrl   = `${process.env.FRONTEND_URL}/tglogin?token=${token}`;
    const username   = escapeHTML(preview.username);
    const bnb        = Number(preview.bnb || 0).toFixed(4);
    const isNewUser  = !preview.wallet;

    const walletLine = preview.wallet
      ? `💼  <b>Wallet</b>\n<code>${escapeHTML(preview.wallet)}</code>`
      : `💼  <b>Wallet</b>\n<i>Will be created on first login</i>`;

    const message = [
      `✅  <b>Identity Confirmed</b>`,
      ``,
      `Hello, <b>${username}</b>!`,
      `Your Telegram account has been verified.`,
      ``,
      `──────────────────`,
      `👤  <b>Username</b>`,
      `<code>${username}</code>`,
      ``,
      walletLine,
      ``,
      `💰  <b>BNB Balance</b>`,
      `<code>${bnb} BNB</code>`,
      `──────────────────`,
      ``,
      isNewUser
        ? `🆕  A new account will be set up automatically.`
        : `🔓  Tap the button below to open SuperCZ.`,
      ``,
      `⚠️  <i>This link is single-use and expires shortly.</i>`
    ].join("\n");

    await bot.sendMessage(chatId, message, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open SuperCZ  →", url: loginUrl }]
        ]
      }
    });

  } catch (err) {
    console.error("[LOGIN] error:", err);
    bot.sendMessage(chatId, "❌ Something went wrong. Please try again.");
  }
});