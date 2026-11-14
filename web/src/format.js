import { NEAR, ONE } from "./config.js";

/** Splits a big integer amount into a readable decimal with at most `digits` decimals. */
function decimal(value, unit, digits) {
  const scale = 10n ** BigInt(digits);
  const scaled = (BigInt(value) * scale) / unit;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(digits, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** Base units as crackers: whole numbers once there are a hundred, one decimal below that. */
export function crackers(units) {
  const value = BigInt(units);
  return decimal(value, ONE, value >= 100n * ONE || value % ONE === 0n ? 0 : 1);
}

/** yoctoNEAR as NEAR, with enough decimals to show a small tip. */
export function near(yocto, digits) {
  const value = BigInt(yocto);
  if (digits === undefined) digits = value >= 100n * NEAR ? 1 : value >= NEAR ? 2 : value >= NEAR / 100n ? 3 : 4;
  return decimal(value, NEAR, digits);
}

/** "12.5" crackers to base units, or null if it isn't a number. */
export function parseCrackers(text) {
  return parseDecimal(text, 18);
}

/** "0.25" NEAR to yocto, or null. */
export function parseNear(text) {
  return parseDecimal(text, 24);
}

function parseDecimal(text, decimals) {
  const clean = String(text).trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") return null;
  const [whole, fraction = ""] = clean.split(".");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

export function percent(bps) {
  const value = Number(bps) / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** Milliseconds as a countdown: 3:07:45, or 4:59 inside the last hour. */
export function countdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** A span of time in plain words: "5 minutes", "1 day". */
export function span(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** How long ago something happened: "just now", "4 min ago", "3 h ago", "2 days ago". */
export function ago(ms, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Number(ms)) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  const days = Math.round(seconds / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** A long account id cut in the middle, so tables stay readable. */
export function short(accountId, max = 28) {
  if (accountId.length <= max) return accountId;
  return `${accountId.slice(0, max - 9)}...${accountId.slice(-6)}`;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Text from the chain or from near.social is never trusted as HTML. */
export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}
