// src/db.js
import pkg from "pg";
import dotenv from "dotenv";
dotenv.config(); // ← tambah di sini

const { Pool } = pkg;
export const db = new Pool({
  connectionString: process.env.DATABASE_URL
});