// utils.js
// Minimal helpers for hashing the ID/BC locally (MVP).
// NOTE: In production, move hashing to a Supabase Edge Function with a secret salt.

const ID_SALT = "lcm_local_dev_salt_change_me"; // <-- change this to any random string in your copy

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * hashGovId(raw)
 * @param {string} raw - the user-entered ID/BC number
 * @returns {Promise<string>} hex string SHA-256 hash of (salt:normalized_id)
 */
async function hashGovId(raw) {
  const normalized = (raw || "").trim().toUpperCase();
  return await sha256Hex(`${ID_SALT}:${normalized}`);
}
