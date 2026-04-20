// index.js
// Entry point SuperCZ Bot

import dotenv from "dotenv";
dotenv.config();

import { bot } from "./src/bot.js";
import { db } from "./src/db.js";

import "./src/handlers/start.js";
import "./src/handlers/login.js";

import { startNotifier } from "./src/notifier/index.js";

console.log("[BOT] SuperCZ Bot starting...");

startNotifier();

process.on("SIGINT",  () => { db.end(); process.exit(0); });
process.on("SIGTERM", () => { db.end(); process.exit(0); });
