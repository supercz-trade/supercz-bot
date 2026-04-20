// src/notifier/state.js

import { db } from "../db.js";

export const sentMigrating = new Set();
export const sentMigrated  = new Set();

export async function loadExistingMigrated() {
  try {
    const { rows } = await db.query(
      "SELECT token_address FROM launch_tokens WHERE migrated = true"
    );
    for (const r of rows) {
      sentMigrated.add(r.token_address.toLowerCase());
    }
    console.log(`[NOTIFIER] pre-loaded ${rows.length} migrated tokens`);
  } catch (err) {
    console.error("[NOTIFIER] loadExistingMigrated error:", err.message);
  }
}