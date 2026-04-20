// src/bot.js
// Singleton bot instance — diimport di semua handler & notifier

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config(); // ← tambah di sini

export const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true
});

console.log("[BOT] Telegram bot initialized");
