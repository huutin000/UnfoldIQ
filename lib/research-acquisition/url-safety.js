"use strict";

/**
 * UNFOLDIQ URL safety / SSRF guard (PHASE 1G.1 Prompt 02, work item 1G.1F gate).
 *
 * Production defaults: only http/https; no credentials in URL; no localhost,
 * private, link-local, or cloud-metadata targets. DNS is resolved and EVERY
 * resolved address is checked (DNS-rebinding awareness); every redirect
 * destination is re-checked by validateRedirectChain().
 *
 * Test-only localhost bypass: { allowLocalForTest: true } is a programmatic
 * flag passed by test code only. It is NOT a general allowPrivateNetwork
 * option and cannot be enabled by normal production user input. The scheme
 * allowlist still applies even with the bypass.
 */

const dns = require("dns").promises;
const net = require("net");

const ALLOWED_SCHEMES = ["http:", "https:"];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
];

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".localdomain",
  ".home.arpa",
  ".invalid",
];

function ipv4ToInt(ip) {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function inCidrV4(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === "0" ? 0 : (0xffffffff - (2 ** (32 - parseInt(bits, 10)) - 1)) >>> 0;
  return ((ipInt & mask) >>> 0) === ((baseInt & mask) >>> 0);
}

const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16", // link-local incl. cloud metadata 169.254.169.254
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24", // TEST-NET-1 documentation
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2 documentation
  "203.0.113.0/24", // TEST-NET-3 documentation
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved
];

function expandV6(ip) {
  // Returns 8 groups of 4 hex digits, or null. Handles ::ffff:a.b.c.d mapping.
  let addr = ip.toLowerCase();
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const n = ipv4ToInt(mapped[1]);
    if (n === null) return null;
    addr = `::ffff:${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...new Array(missing).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups;
}

function v6PrefixMatch(groups, prefix, bits) {
  const pGroups = expandV6(prefix);
  if (!pGroups) return false;
  const full = Math.floor(bits / 16);
  for (let i = 0; i < full; i++) {
    if (parseInt(groups[i], 16) !== parseInt(pGroups[i], 16)) return false;
  }
  const rest = bits % 16;
  if (rest > 0) {
    const mask = (0xffff - (2 ** (16 - rest) - 1)) & 0xffff;
    if ((parseInt(groups[full], 16) & mask) !== (parseInt(pGroups[full], 16) & mask)) return false;
  }
  return true;
}

function isBlockedIpLiteral(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    return BLOCKED_V4.some((cidr) => inCidrV4(ip, cidr));
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped: judge the embedded IPv4 address.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIpLiteral(mapped[1]);
    const groups = expandV6(lower);
    if (!groups) return true; // unparseable: fail closed
    if (v6PrefixMatch(groups, "::1", 128)) return true;
    if (v6PrefixMatch(groups, "::", 128)) return true;
    if (v6PrefixMatch(groups, "fe80::", 10)) return true; // link-local
    if (v6PrefixMatch(groups, "fc00::", 7)) return true; // unique-local
    if (v6PrefixMatch(groups, "ff00::", 8)) return true; // multicast
    if (v6PrefixMatch(groups, "2001:db8::", 32)) return true; // documentation
    if (v6PrefixMatch(groups, "64:ff9b::", 96)) return true; // translation prefix
    if (v6PrefixMatch(groups, "100::", 64)) return true; // discard
    return false;
  }
  return true; // not an IP at all: fail closed (caller checks hostnames first)
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.includes(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (host.indexOf(".") === -1) return true; // unqualified single-label = internal
  return false;
}

function normalizeUrlString(urlString) {
  const u = new URL(urlString);
  if (!ALLOWED_SCHEMES.includes(u.protocol)) {
    return { ok: false, code: "UNSAFE_URL", message: `unsupported scheme '${u.protocol}' (allowed: http, https)` };
  }
  if (u.username || u.password) {
    return { ok: false, code: "UNSAFE_URL", message: "credentials in URL are rejected" };
  }
  u.hash = "";
  return { ok: true, url: u };
}

/**
 * Full safety check for one URL. Resolves DNS and checks every address.
 * Returns { ok:true, normalizedUrl, host, ipAddresses } or
 * { ok:false, code, message } with code UNSAFE_URL | PRIVATE_HOST | DNS_ERROR.
 */
async function checkUrlSafety(urlString, opts = {}) {
  const allowLocal = opts.allowLocalForTest === true;
  const lookup = opts.dnsLookup || dns.lookup;
  let parsed;
  try {
    parsed = normalizeUrlString(urlString);
  } catch {
    return { ok: false, code: "UNSAFE_URL", message: `unparseable URL: ${String(urlString).slice(0, 200)}` };
  }
  if (!parsed.ok) return parsed;
  const u = parsed.url;
  const host = u.hostname;

  if (net.isIP(host)) {
    if (!allowLocal && isBlockedIpLiteral(host)) {
      return { ok: false, code: "PRIVATE_HOST", message: `blocked IP literal: ${host}` };
    }
    return { ok: true, normalizedUrl: u.toString(), host, ipAddresses: [host] };
  }

  if (!allowLocal && isBlockedHostname(host)) {
    return { ok: false, code: "PRIVATE_HOST", message: `blocked internal hostname: ${host}` };
  }

  let records;
  try {
    records = await lookup(host, { all: true });
  } catch (e) {
    return { ok: false, code: "DNS_ERROR", message: `DNS resolution failed for ${host}: ${e.message}` };
  }
  const addresses = (records || []).map((r) => r.address).filter(Boolean);
  if (addresses.length === 0) {
    return { ok: false, code: "DNS_ERROR", message: `no DNS addresses for ${host}` };
  }
  if (!allowLocal) {
    for (const addr of addresses) {
      if (isBlockedIpLiteral(addr)) {
        return { ok: false, code: "PRIVATE_HOST", message: `${host} resolves to blocked address ${addr}` };
      }
    }
  }
  return { ok: true, normalizedUrl: u.toString(), host, ipAddresses: addresses };
}

/**
 * Every redirect destination is re-checked. redirectUrls are the hops in
 * order; finalUrl is where acquisition would land.
 */
async function validateRedirectChain(requestedUrl, redirectUrls, opts = {}) {
  const hops = [...(redirectUrls || [])];
  for (const hop of hops) {
    const r = await checkUrlSafety(hop, opts);
    if (!r.ok) {
      return { ok: false, code: r.code, message: `redirect target blocked: ${r.message}`, blockedUrl: hop };
    }
  }
  return { ok: true };
}

module.exports = {
  ALLOWED_SCHEMES,
  checkUrlSafety,
  validateRedirectChain,
  isBlockedIpLiteral,
  isBlockedHostname,
};
