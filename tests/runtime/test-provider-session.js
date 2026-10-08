"use strict";
// tests/runtime/test-provider-session.js — Phase 5C Cases H–K (+reconcile).
// Pure registry logic with fixture page states. No live provider calls
// (cost policy blocks spend: allowPaidCloud=false).

const ps = require("../../lib/provider-session/index.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("[PASS] " + name); },
    (e) => { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); });
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
const id = { providerId: "flow-web", accountScope: "acct-1", profileScope: "prof-1" };

(async () => {
await runTest("H same profile cannot be double-leased", () => {
  const r = ps.createRegistry();
  const a = r.acquire(id);
  assert(a.reused === false, "first lease creates");
  let threw = null;
  try { r.acquire(id); } catch (e) { threw = e; }
  assert(threw && /PROVIDER_PROFILE_CONFLICT/.test(threw.message), "second owner blocked");
  r.release(id.profileScope);
  const b = r.acquire(id);
  assert(b.reused === true && b.session.sessionId === a.session.sessionId, "release allows re-lease");
});

await runTest("different profiles are independent leases", () => {
  const r = ps.createRegistry();
  r.acquire(id);
  const b = r.acquire({ ...id, profileScope: "prof-2", accountScope: "acct-2" });
  assert(b.reused === false, "separate scope, separate session");
});

await runTest("I reset clears prior state; unprovable reset discards", async () => {
  const r = ps.createRegistry();
  r.acquire(id);
  r.release(id.profileScope);
  const good = await r.resetForReuse(id.profileScope, async () => ({
    ok: true, facts: { knownUrl: true, noPromptText: true, noOldResult: true, noUploadQueue: true, noGenerationInProgress: true },
  }));
  assert(good.ok === true, "proven reset reuses");
  const bad = await r.resetForReuse(id.profileScope, async () => ({ ok: true, facts: { knownUrl: true } }));
  assert(bad.ok === false && /discarded/.test(bad.reason), "unproven reset discards: " + bad.reason);
  const gone = r.get(id.profileScope);
  assert(gone === null, "discarded session not reused");
});

await runTest("J stale auth detected before expensive action", () => {
  const r = ps.createRegistry();
  const v1 = r.classifyPageState({ loginPage: true });
  assert(v1.verdict === "SESSION_STALE", "login page => stale");
  const v2 = r.classifyPageState({ sessionExpired: true });
  assert(v2.verdict === "SESSION_STALE", "expired => stale");
  const v3 = r.classifyPageState({ captchaPresent: true });
  assert(v3.verdict === "REVIEW_REQUIRED", "captcha => review, never bypass");
  const m = r.markStale(id.profileScope, "login page");
  assert(m.finding === "PROVIDER_SESSION_STALE", "finding taxonomy");
  const r2 = ps.createRegistry();
  r2.acquire(id);
  r2.requireReauth(id.profileScope);
  r2.release(id.profileScope);
  let threw = null;
  try { r2.acquire(id); } catch (e) { threw = e; }
  assert(threw && /REAUTH_REQUIRED/.test(threw.message), "revoked/stale session never reused silently");
});

await runTest("K drift is structured failure, no infinite loop", () => {
  const r = ps.createRegistry();
  const v1 = r.classifyPageState({ expectedAccount: "a1", accountId: "a2" });
  assert(v1.verdict === "PROVIDER_DRIFT", "account mismatch => drift");
  const v2 = r.classifyPageState({ selectorsOk: false });
  assert(v2.verdict === "PROVIDER_DRIFT", "selector drift => drift");
  const v3 = r.classifyPageState({ unexpectedUi: "new consent dialog" });
  assert(v3.verdict === "PROVIDER_DRIFT", "unexpected UI => drift");
  const v4 = r.classifyPageState({});
  assert(v4.verdict === "VALID", "clean state valid");
});

await runTest("AD restart: unknown provider work reconciles, never resubmits", () => {
  const r = ps.createRegistry();
  const ok = r.reconcile(id.profileScope, {});
  assert(ok.action === "RESUME", "known-good resumes");
  const unk = r.reconcile(id.profileScope, { generationInProgress: true });
  assert(unk.action === "RECONCILE", "uncertain reconciles before submit");
  const stale = r.reconcile(id.profileScope, { loginPage: true });
  assert(stale.action === "RECONCILE" && stale.verdict.verdict === "SESSION_STALE", "stale reconciles");
});

await runTest("revoke + max-age retirement bound session lifetime", () => {
  let t = 5000;
  const r = ps.createRegistry({ now: () => t, maxAgeMs: 1000, maxJobs: 100 });
  r.acquire(id);
  r.release(id.profileScope);
  t += 2000;
  const b = r.acquire(id); // expired => recreated
  assert(b.reused === false, "aged session retired");
  r.release(id.profileScope);
  r.revoke(id.profileScope);
  assert(r.get(id.profileScope) === null, "revoked gone");
});

console.log("\n=== provider-session: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
