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

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// URL.origin is "null" for chrome-extension:, so build the origin by hand.
function normalizeOrigin(u) {
  if (u.protocol === "chrome-extension:") return `chrome-extension://${u.host}`;
  return u.origin;
}

// Allowlist entries are normalised once per array (cached), through the same
// URL parse as the request origin; unparseable entries are dropped.
const normalizedAllowlists = new WeakMap();
function normalizeAllowlist(allowed) {
  let set = normalizedAllowlists.get(allowed);
  if (!set) {
    set = new Set();
    for (const entry of allowed) {
      try {
        const n = normalizeOrigin(new URL(String(entry).trim()));
        if (n !== "null") set.add(n); // opaque origin (moz-extension:, file:, ...): never matchable
      } catch {
        // dropped
      }
    }
    normalizedAllowlists.set(allowed, set);
  }
  return set;
}

function validateOrigin(origin, allowed) {
  if (!origin || typeof origin !== "string" || origin === "null") return false;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (allowed && allowed.length > 0) {
    // Explicit allowlist: exact match on the normalized origin, never a prefix.
    // If every entry is unparseable the set is empty, so everything is rejected
    // (fail-closed; it does NOT fall back to the default loopback policy).
    const n = normalizeOrigin(u);
    return n !== "null" && normalizeAllowlist(allowed).has(n);
  }
  if (u.protocol === "http:") return LOOPBACK_HOSTNAMES.has(u.hostname);
  if (u.protocol === "chrome-extension:") return u.host !== "";
  return false;
}

// DNS-rebinding guard: the Host header must name a loopback host (any port).
function validateHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== "string") return false;
  let u;
  try {
    u = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (u.username || u.password || u.pathname !== "/" || u.search || u.hash) return false;
  return LOOPBACK_HOSTNAMES.has(u.hostname);
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

module.exports = { isLoopbackAddress, assertLoopbackBind, validateOrigin, validateHost, tokenMatches, findSecrets, stripSecrets };
