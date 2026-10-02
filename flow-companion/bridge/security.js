"use strict";

/**
 * Flow Companion bridge security helpers (STEP 10B).
 * Loopback-only binding, origin allowlist, schema-checked payloads,
 * no arbitrary commands, no credential transport.
 */

const crypto = require("crypto");

const SECRET_KEY_PATTERN = /secret|token|api[_-]?key|password|passwd|cookie|session|bearer|credential|auth/i;
const SECRET_VALUE_PATTERN = /^(sk-|xox[bpas]-|ghp_|gsk_|Bearer\s+[A-Za-z0-9._-]+|AIza[0-9A-Za-z_-]{10,})/;

function isLoopbackAddress(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}

function assertLoopbackBind(host) {
  const h = String(host || "127.0.0.1");
  if (h === "0.0.0.0" || h === "::" || h === "") {
    throw new Error("BIND_REJECTED: public/LAN binding disabled by default; use 127.0.0.1");
  }
  if (!isLoopbackAddress(h)) {
    throw new Error(`BIND_REJECTED: only loopback hosts allowed, got ${h}`);
  }
  return h;
}

// Constant-time bridge-token comparison (digest first so lengths never leak).
function tokenMatches(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function validateOrigin(origin, allowed) {
  if (!origin) return false;
  const list = allowed && allowed.length > 0 ? allowed : ["http://127.0.0.1", "http://localhost", "chrome-extension://"];
  return list.some((prefix) => String(origin).startsWith(prefix));
}

function findSecrets(value, trail = "$") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSecrets(v, `${trail}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) hits.push(`${trail}.${k}`);
      hits.push(...findSecrets(v, `${trail}.${k}`));
    }
    return hits;
  }
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) hits.push(trail);
  return hits;
}

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) return "[REDACTED]";
  return value;
}

module.exports = { isLoopbackAddress, assertLoopbackBind, validateOrigin, tokenMatches, findSecrets, stripSecrets };
