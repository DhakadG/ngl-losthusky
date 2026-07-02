// Admin auth: PBKDF2 password verification + stateless HMAC session cookies.
// No secrets live in code — ADMIN_PASSWORD_HASH and SESSION_SECRET are Worker
// secrets, so the GitHub repo never contains anything that unlocks the admin.

const enc = new TextEncoder();
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

// hash format: pbkdf2$<iterations>$<saltB64url>$<hashB64url>
export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("pbkdf2$")) return false;
  const [, iterStr, saltB64, hashB64] = stored.split("$");
  const iterations = parseInt(iterStr, 10);
  const salt = b64urlToBytes(saltB64);
  const expected = b64urlToBytes(hashB64);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

export async function createSession(secret) {
  const payload = bytesToB64url(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL })));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token, secret) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = await hmac(secret, payload);
  if (!timingSafeEqual(enc.encode(sig), enc.encode(expected))) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
