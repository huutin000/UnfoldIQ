"use strict";

/**
 * m1: validateOrigin must normalise allowlist ENTRIES once (new URL +
 * normalizeOrigin) and drop entries that cannot be parsed. Operators write
 * entries like "http://localhost:5173/" or "HTTP://LOCALHOST"; the browser
 * always sends the canonical origin, so a raw string compare silently rejects
 * a legitimate client. RED until security.js normalises entries.
 */

const { validateOrigin } = require("../../flow-companion/bridge/security.js");

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

runTest("allowlist entry with trailing slash matches the canonical origin", () => {
  eq(validateOrigin("http://localhost:5173", ["http://localhost:5173/"]), true, "entry has trailing slash");
});

runTest("allowlist entry with uppercase scheme/host matches the canonical origin", () => {
  eq(validateOrigin("http://localhost:5173", ["HTTP://LOCALHOST:5173"]), true, "uppercase entry");
});

runTest("allowlist entry with explicit default port matches the canonical origin", () => {
  eq(validateOrigin("http://localhost", ["http://localhost:80"]), true, "http :80 entry");
  eq(validateOrigin("https://app.example", ["https://app.example:443"]), true, "https :443 entry");
});

runTest("chrome-extension allowlist entry with trailing slash matches", () => {
  eq(validateOrigin("chrome-extension://abcdefghijklmnop", ["chrome-extension://abcdefghijklmnop/"]), true, "extension entry with slash");
});

runTest("normalised entries still never match a prefix or other origin", () => {
  const allowed = ["http://localhost:5173/"];
  eq(validateOrigin("http://localhost:51730", allowed), false, "port prefix");
  eq(validateOrigin("http://localhost:5173.evil.example", allowed), false, "host suffix");
  eq(validateOrigin("http://evil.example", allowed), false, "foreign origin");
});

runTest("unparseable and non-string entries are dropped without throwing; valid entries keep working", () => {
  const allowed = ["not a url", "", null, undefined, 42, {}, "http://localhost:5173/"];
  let r;
  try { r = validateOrigin("http://localhost:5173", allowed); } catch (e) { throw new Error(`ASSERTION FAILED: validateOrigin threw ${e.message}`); }
  eq(r, true, "valid entry still matches next to garbage entries");
  eq(validateOrigin("http://evil.example", allowed), false, "foreign origin still rejected");
});

runTest("allowlist entry with surrounding whitespace is normalised by the URL parser", () => {
  eq(validateOrigin("http://localhost:5173", [" http://localhost:5173 "]), true, "padded entry matches");
});

// F1: non-special schemes / scheme-less typos parse with origin "null"; such
// entries must be dropped and a "null"-normalising request origin must be rejected.
runTest("opaque-origin allowlist entry does not admit other opaque request origins", () => {
  eq(validateOrigin("moz-extension://other", ["moz-extension://abc"]), false, "moz-extension other id vs moz entry");
  eq(validateOrigin("moz-extension://abc", ["moz-extension://abc"]), false, "opaque origins never match, even the same entry");
});

runTest("scheme-less typo entry 'localhost:5173' does not admit foo://x", () => {
  eq(validateOrigin("foo://x", ["localhost:5173"]), false, "foo://x vs typo entry");
});

runTest("file:// and the literal 'null' origin are rejected", () => {
  const allowed = ["moz-extension://abc", "localhost:5173", "null", "file:///tmp/x"];
  eq(validateOrigin("file://x", allowed), false, "file://x");
  eq(validateOrigin("null", allowed), false, "literal null origin");
  eq(validateOrigin("foo://x", allowed), false, "foo://x");
});

runTest("mixed list: typo entry is dropped, valid entry still works", () => {
  const allowed = ["localhost:5173", "http://127.0.0.1:5173"];
  eq(validateOrigin("http://127.0.0.1:5173", allowed), true, "valid entry accepted");
  eq(validateOrigin("foo://x", allowed), false, "opaque origin rejected");
  eq(validateOrigin("http://localhost:5173", allowed), false, "typo entry does not become localhost");
});

console.log(`\n=== allowlist-normalize: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
