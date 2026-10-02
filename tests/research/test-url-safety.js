"use strict";

/**
 * URL safety / SSRF guard tests (§57). Deterministic via injected DNS.
 * Production rule stays strict; localhost bypass is test-only and explicit.
 */

const safety = require("../../lib/research-acquisition/url-safety.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

function dnsFor(map) {
  return async (host) => {
    if (Object.prototype.hasOwnProperty.call(map, host)) {
      return map[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    }
    throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  };
}

const PUBLIC_DNS = dnsFor({ "example.com": ["93.184.215.14"], "docs.example": ["2001:db8::99"] });

async function main() {
  console.log("=== URL SAFETY TESTS ===\n");

  await runTest("public https/http allowed", async () => {
    const a = await safety.checkUrlSafety("https://example.com/docs?a=1#frag", { dnsLookup: PUBLIC_DNS });
    assert(a.ok === true && a.host === "example.com", "public https allowed, fragment stripped");
    assert(a.ipAddresses.includes("93.184.215.14"), "resolved addresses reported");
    const b = await safety.checkUrlSafety("http://example.com/", { dnsLookup: PUBLIC_DNS });
    assert(b.ok === true, "public http allowed");
  });

  await runTest("unsupported schemes rejected", async () => {
    for (const u of ["file:///etc/passwd", "data:text/html,x", "javascript:alert(1)", "ftp://example.com/f", "chrome://settings", "about:blank"]) {
      const r = await safety.checkUrlSafety(u, { dnsLookup: PUBLIC_DNS });
      assert(r.ok === false && r.code === "UNSAFE_URL", `${u} blocked`);
    }
  });

  await runTest("localhost / loopback blocked", async () => {
    for (const u of ["http://localhost/", "http://localhost:3000/x", "http://127.0.0.1/", "http://127.1.2.3:8080/", "http://[::1]/", "http://[::ffff:127.0.0.1]/"]) {
      const r = await safety.checkUrlSafety(u, { dnsLookup: PUBLIC_DNS });
      assert(r.ok === false && (r.code === "PRIVATE_HOST" || r.code === "UNSAFE_URL"), `${u} blocked (${r.code})`);
    }
  });

  await runTest("private ranges blocked (v4+v6)", async () => {
    for (const u of ["http://10.0.0.5/", "http://172.16.9.9/", "http://172.31.255.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://0.0.0.0/", "http://[fc00::1]/", "http://[fe80::1]/", "http://[::]/"]) {
      const r = await safety.checkUrlSafety(u, { dnsLookup: PUBLIC_DNS });
      assert(r.ok === false && r.code === "PRIVATE_HOST", `${u} blocked`);
    }
    // 172.32.0.1 is PUBLIC (just outside 172.16/12)
    const edge = await safety.checkUrlSafety("http://172.32.0.1/", { dnsLookup: dnsFor({ "172.32.0.1": ["172.32.0.1"] }) });
    assert(edge.ok === true, "172.32.0.1 (outside 172.16/12) allowed");
  });

  await runTest("internal hostnames + userinfo blocked", async () => {
    for (const u of ["http://intranet/", "http://db.internal/", "http://x.local/", "http://host.lan/", "http://metadata.google.internal/", "https://user:pass@example.com/"]) {
      const r = await safety.checkUrlSafety(u, { dnsLookup: PUBLIC_DNS });
      assert(r.ok === false, `${u} blocked (${r.code})`);
    }
  });

  await runTest("DNS rebinding: public name resolving private is blocked", async () => {
    const evil = dnsFor({ "rebind.example": ["93.184.215.14", "10.9.9.9"] });
    const r = await safety.checkUrlSafety("https://rebind.example/", { dnsLookup: evil });
    assert(r.ok === false && r.code === "PRIVATE_HOST", "mixed resolution blocked");
    const docPrivate = dnsFor({ "docs.example": ["2001:db8::99"] });
    const r2 = await safety.checkUrlSafety("https://docs.example/", { dnsLookup: docPrivate });
    assert(r2.ok === false && r2.code === "PRIVATE_HOST", "documentation-range IPv6 blocked");
  });

  await runTest("DNS failure blocks (fail closed)", async () => {
    const r = await safety.checkUrlSafety("https://nonexistent.invalid-name/", { dnsLookup: PUBLIC_DNS });
    assert(r.ok === false && (r.code === "DNS_ERROR" || r.code === "PRIVATE_HOST"), `DNS failure blocks (${r.code})`);
  });

  await runTest("redirect chain: public->public ok, public->private blocked", async () => {
    const okChain = await safety.validateRedirectChain("https://example.com/a", ["https://example.com/b"], { dnsLookup: PUBLIC_DNS });
    assert(okChain.ok === true, "public chain passes");
    const evil = dnsFor({ "example.com": ["93.184.215.14"], "evil.example": ["10.1.2.3"] });
    const bad = await safety.validateRedirectChain("https://example.com/a", ["https://evil.example/b"], { dnsLookup: evil });
    assert(bad.ok === false && bad.code === "PRIVATE_HOST", "redirect to private blocked");
    const meta = await safety.validateRedirectChain("https://example.com/a", ["http://169.254.169.254/x"], { dnsLookup: PUBLIC_DNS });
    assert(meta.ok === false, "redirect to metadata endpoint blocked");
  });

  await runTest("test-only localhost bypass is explicit and still scheme-gated", async () => {
    const local = await safety.checkUrlSafety("http://127.0.0.1:4242/x", { allowLocalForTest: true, dnsLookup: PUBLIC_DNS });
    assert(local.ok === true, "bypass allows loopback for fixtures");
    const stillBad = await safety.checkUrlSafety("file:///127.0.0.1/x", { allowLocalForTest: true, dnsLookup: PUBLIC_DNS });
    assert(stillBad.ok === false && stillBad.code === "UNSAFE_URL", "scheme gate intact under bypass");
    const prod = await safety.checkUrlSafety("http://127.0.0.1:4242/x", { dnsLookup: PUBLIC_DNS });
    assert(prod.ok === false, "production defaults still block loopback");
  });

  // all runTest calls above are awaited; summarize directly
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main();
