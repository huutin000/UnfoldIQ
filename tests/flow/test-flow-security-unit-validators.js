"use strict";

/**
 * Unit tests for the group A bridge validators (no server, no network):
 * validateOrigin / validateHost (flow-companion/bridge/security.js) and
 * assertSafeId (flow-companion/bridge/path-policy.js).
 * They describe CURRENT behaviour and must be green.
 */

const { validateOrigin, validateHost } = require("../../flow-companion/bridge/security.js");
const { assertSafeId } = require("../../flow-companion/bridge/path-policy.js");

let failed = 0;
let passed = 0;

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try { fn(); console.log("[PASS]"); passed++; } catch (e) { console.log(`[FAIL] ${e.message}`); failed++; }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error(`ASSERTION FAILED: ${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  console.log(`  ok ${label}`);
}
function throwsInvalid(fn, label) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err || !/^INVALID_ID/.test(err.message)) throw new Error(`ASSERTION FAILED: ${label} should throw INVALID_ID (got ${err ? err.message : "no throw"})`);
  console.log(`  ok ${label}`);
}

// ---- validateOrigin, default policy (no allowlist) ----
runTest("validateOrigin default policy accepts loopback http and chrome-extension", () => {
  eq(validateOrigin("http://127.0.0.1:5173"), true, "127.0.0.1 with port");
  eq(validateOrigin("http://localhost"), true, "localhost without port");
  eq(validateOrigin("http://[::1]:3000"), true, "[::1] with port");
  eq(validateOrigin("chrome-extension://abcdefghijklmnop"), true, "chrome-extension id");
});

runTest("validateOrigin default policy is case-insensitive on scheme and host", () => {
  eq(validateOrigin("HTTP://LOCALHOST:5173"), true, "uppercase scheme+host");
});

runTest("validateOrigin default policy rejects userinfo, lookalike hosts and prefix tricks", () => {
  eq(validateOrigin("http://localhost@evil.example"), false, "userinfo then evil host");
  eq(validateOrigin("http://evil.example@127.0.0.1"), true, "userinfo naming evil but host is 127.0.0.1 (URL parser host wins)");
  eq(validateOrigin("http://localhost.evil.example"), false, "localhost. prefix lookalike");
  eq(validateOrigin("http://127.0.0.1.evil.example"), false, "127.0.0.1 prefix lookalike");
  eq(validateOrigin("http://evil.example/http://localhost"), false, "loopback only in path");
  eq(validateOrigin("http://evil.example?http://localhost"), false, "loopback only in query");
});

runTest("validateOrigin default policy: trailing dot on localhost", () => {
  // Documenting current behaviour: "localhost." is NOT in the loopback set.
  eq(validateOrigin("http://localhost.:5173"), false, "trailing dot localhost rejected");
});

runTest("validateOrigin default policy rejects non-http(s) schemes, null, empty and non-strings", () => {
  eq(validateOrigin("https://localhost"), false, "https is not in default loopback policy");
  eq(validateOrigin("ftp://localhost"), false, "ftp");
  eq(validateOrigin("file:///etc/passwd"), false, "file");
  eq(validateOrigin("javascript:alert(1)"), false, "javascript");
  eq(validateOrigin("null"), false, "literal null origin");
  eq(validateOrigin(""), false, "empty");
  eq(validateOrigin(undefined), false, "undefined");
  eq(validateOrigin(null), false, "null");
  eq(validateOrigin(42), false, "number");
  eq(validateOrigin({}), false, "object");
  eq(validateOrigin(["http://localhost"]), false, "array");
  eq(validateOrigin("not a url"), false, "garbage");
});

runTest("validateOrigin rejects comma-separated lists", () => {
  eq(validateOrigin("http://localhost, http://evil.example"), false, "comma list loopback first");
  eq(validateOrigin("http://evil.example,http://localhost"), false, "comma list loopback last");
});

// ---- validateOrigin with an explicit allowlist ----
runTest("validateOrigin allowlist: exact match only, never a prefix", () => {
  const allowed = ["http://localhost:5173", "chrome-extension://abcdefghijklmnop"];
  eq(validateOrigin("http://localhost:5173", allowed), true, "exact entry");
  eq(validateOrigin("http://localhost:5173/", allowed), true, "origin with trailing slash normalises to entry");
  eq(validateOrigin("http://localhost:51730", allowed), false, "port prefix");
  eq(validateOrigin("http://localhost:5173.evil.example", allowed), false, "host suffix");
  eq(validateOrigin("http://localhost:5173@evil.example", allowed), false, "userinfo trick");
  eq(validateOrigin("http://localhost:5174", allowed), false, "other port");
  eq(validateOrigin("https://localhost:5173", allowed), false, "other scheme");
  eq(validateOrigin("chrome-extension://abcdefghijklmnop", allowed), true, "extension exact");
  eq(validateOrigin("chrome-extension://abcdefghijklmnopq", allowed), false, "extension prefix");
  eq(validateOrigin("http://127.0.0.1:5173", allowed), false, "loopback not in allowlist is rejected (allowlist replaces default)");
});

runTest("validateOrigin allowlist: default port and case normalisation of the incoming origin", () => {
  const allowed = ["http://localhost"];
  eq(validateOrigin("http://localhost:80", allowed), true, "explicit default port normalises to entry");
  eq(validateOrigin("HTTP://LOCALHOST", allowed), true, "uppercase normalises to entry");
  const allowedS = ["https://app.example"];
  eq(validateOrigin("https://app.example:443", allowedS), true, "https default port");
  eq(validateOrigin("https://app.example:8443", allowedS), false, "non-default port differs");
});

runTest("validateOrigin allowlist: IPv6 loopback and comma lists", () => {
  const allowed = ["http://[::1]:5173"];
  eq(validateOrigin("http://[::1]:5173", allowed), true, "[::1] exact");
  eq(validateOrigin("http://[::1]:5173, http://evil.example", allowed), false, "comma list after allowed origin");
});

// ---- validateHost ----
runTest("validateHost accepts loopback hosts with or without port, any case", () => {
  eq(validateHost("127.0.0.1"), true, "127.0.0.1");
  eq(validateHost("127.0.0.1:4317"), true, "127.0.0.1:port");
  eq(validateHost("localhost"), true, "localhost");
  eq(validateHost("LOCALHOST:8080"), true, "uppercase localhost");
  eq(validateHost("[::1]"), true, "[::1]");
  eq(validateHost("[::1]:8080"), true, "[::1]:port");
});

runTest("validateHost rejects foreign hosts, lookalikes and malformed values", () => {
  eq(validateHost("evil.example"), false, "foreign host");
  eq(validateHost("evil.example:80"), false, "foreign host:port");
  eq(validateHost("localhost.evil.example"), false, "localhost prefix lookalike");
  eq(validateHost("127.0.0.1.evil.example"), false, "ip prefix lookalike");
  eq(validateHost("localhost@evil.example"), false, "userinfo then evil host");
  eq(validateHost("evil.example@localhost"), false, "userinfo before loopback host");
  eq(validateHost("localhost/evil"), false, "path");
  eq(validateHost("localhost?x=1"), false, "query");
  eq(validateHost("localhost#x"), false, "hash");
  eq(validateHost("localhost, evil.example"), false, "comma-separated list");
  eq(validateHost("localhost.:8080"), false, "trailing dot (documented current behaviour)");
  eq(validateHost("localhost:99999"), false, "port out of range");
  eq(validateHost("localhost:abc"), false, "non-numeric port");
});

runTest("validateHost rejects empty and non-string values", () => {
  eq(validateHost(""), false, "empty");
  eq(validateHost(undefined), false, "undefined");
  eq(validateHost(null), false, "null");
  eq(validateHost(["localhost"]), false, "array");
  eq(validateHost(123), false, "number");
  eq(validateHost({}), false, "object");
});

// ---- assertSafeId ----
runTest("assertSafeId accepts conservative ids and returns them", () => {
  eq(assertSafeId("projectId", "abc"), "abc", "plain");
  eq(assertSafeId("projectId", "A_b-9"), "A_b-9", "mixed charset");
  eq(assertSafeId("projectId", "_leading"), "_leading", "leading underscore");
  eq(assertSafeId("projectId", "9"), "9", "single digit");
  eq(assertSafeId("jobId", "__flow10b_fx__"), "__flow10b_fx__", "fixture-style id");
});

runTest("assertSafeId length boundary: 128 accepted, 129 rejected", () => {
  eq(assertSafeId("jobId", "a".repeat(128)), "a".repeat(128), "128 chars");
  throwsInvalid(() => assertSafeId("jobId", "a".repeat(129)), "129 chars");
});

runTest("assertSafeId rejects traversal, separators, leading dash/dot and whitespace", () => {
  for (const bad of ["", "..", ".", "../x", "a/b", "a\\b", "-lead", ".hidden", "a b", "a.b", "a%2Fb", "..%2F", "a\0b", "é", "a‮b"]) {
    throwsInvalid(() => assertSafeId("projectId", bad), `reject ${JSON.stringify(bad)}`);
  }
});

runTest("assertSafeId rejects trailing newline (regex $ must not allow it)", () => {
  throwsInvalid(() => assertSafeId("projectId", "abc\n"), "abc\\n");
  throwsInvalid(() => assertSafeId("projectId", "abc\r\n"), "abc\\r\\n");
});

runTest("assertSafeId rejects non-string ids", () => {
  for (const bad of [undefined, null, 0, 1, true, {}, [], ["abc"], { toString: () => "abc" }, Symbol.iterator]) {
    throwsInvalid(() => assertSafeId("projectId", bad), `reject ${typeof bad} ${Array.isArray(bad) ? "array" : ""}`);
  }
});

runTest("assertSafeId error names the kind and does not echo the value", () => {
  let err = null;
  try { assertSafeId("jobId", "../secret-value"); } catch (e) { err = e; }
  eq(err && err.message, "INVALID_ID: jobId", "message");
});

console.log(`\n=== unit-validators: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
