// src/utils/format.js
// Shared formatting helpers

export function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function fmtNumber(num, decimals = 2) {
  if (!num || isNaN(num)) return "0";
  const n = Number(num);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(decimals) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(decimals) + "K";
  return n.toFixed(decimals);
}

export function fmtUSD(num) {
  return "$" + fmtNumber(num);
}

export function fmtBNB(num, decimals = 4) {
  return Number(num || 0).toFixed(decimals) + " BNB";
}

export function shortAddr(address) {
  if (!address) return "";
  return address.slice(0, 6) + "..." + address.slice(-4);
}

export function progressBar(pct, len = 10) {
  const clamped = Math.min(100, Math.max(0, pct)); // clamp 0-100
  const filled = Math.round((clamped / 100) * len);
  return "█".repeat(filled) + "░".repeat(len - filled);
}