"use strict";

/**
 * Authenticated extraction tests A1-A5 (PHASE 1G.1 Prompt 02).
 * Local login fixture with fixture-only credentials. Real Chromium.
 * Auth state lives under the OS temp dir — never in the repo.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const acquisition = require("../../lib/research-acquisition/acquisition.js");
const fixtures = require("../fixtures/research-servers.js");

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

const LOCAL = { allowLocalForTest: true };

async function loginAndSaveState(origin, savePath) {
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/login`, { timeout: 30000 });
    await page.fill("#u", fixtures.FIXTURE_USER);
    await page.fill("#p", fixtures.FIXTURE_PASSWORD);
    await page.click("#go");
    await page.waitForURL("**/protected", { timeout: 15000 });
    await context.storageState({ path: savePath });
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("=== AUTH EXTRACTION TESTS (A1-A5) ===\n");
  const fx = await fixtures.startServer(fixtures.authHandler());
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-auth-"));
  const statePath = path.join(stateDir, "fixture.json");

  await runTest("A1 unauthenticated protected page is denied", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/protected`, {
      safetyOpts: LOCAL, route: "browser", browser: { requireAuth: true },
    });
    assert(res.ok === false && res.code === "AUTH_REQUIRED", `denied with AUTH_REQUIRED (${res.code})`);
  });

  await runTest("A2 authorized fixture session acquires the article", async () => {
    await loginAndSaveState(fx.origin, statePath);
    assert(fs.existsSync(statePath), "test session state saved locally");
    const res = await acquisition.acquireUrl(`${fx.origin}/protected`, {
      safetyOpts: LOCAL, route: "browser",
      browser: { requireAuth: true, authStatePath: statePath },
      authorizedSession: "fixture-login",
    });
    assert(res.ok === true, `authorized acquisition ok (${res.code || res.message || "no error"})`);
    assert(res.document.rawMarkdown.includes("Members article"), "protected content acquired");
  });

  await runTest("A3 auth state is not in the report/result surface", async () => {
    const secret = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const cookieValue = (secret.cookies || []).map((c) => c.value).join("|");
    const res = await acquisition.acquireUrl(`${fx.origin}/protected`, {
      safetyOpts: LOCAL, route: "browser",
      browser: { requireAuth: true, authStatePath: statePath },
      authorizedSession: "fixture-login",
    });
    const surface = JSON.stringify(res.document) + JSON.stringify(res.summary);
    assert(!surface.includes("fixture-session-abc123"), "session value absent from document+summary");
    assert(!surface.includes(fixtures.FIXTURE_PASSWORD), "password absent from document+summary");
    assert(cookieValue && !surface.includes(cookieValue), "no cookie value leaked");
  });

  await runTest("A4 auth state lives outside source control", async () => {
    const guard = acquisition.ensureOutsideRepo(statePath);
    assert(guard.ok === true, "fixture state path is outside the repo");
    const repoProbe = acquisition.ensureOutsideRepo(path.join("projects", "x", "auth.json"));
    assert(repoProbe.ok === false && repoProbe.code === "AUTH_STATE_IN_REPO", "in-repo auth state rejected");
    const def = acquisition.defaultAuthStateDir();
    assert(acquisition.ensureOutsideRepo(path.join(def, "x.json")).ok === true, "default auth dir resolves outside the repo");
  });

  await runTest("A5 no credential logging", async () => {
    const res = await acquisition.acquireUrl(`${fx.origin}/protected`, {
      safetyOpts: LOCAL, route: "browser",
      browser: { requireAuth: true, authStatePath: statePath },
      authorizedSession: "fixture-login",
    });
    const logged = JSON.stringify(res.summary);
    assert(!logged.includes(fixtures.FIXTURE_PASSWORD), "summary carries no password");
    assert(!logged.includes("fixture-session-abc123"), "summary carries no session");
    assert(!logged.includes("cookie"), "summary carries no cookie material");
  });

  await fixtures.stopServer(fx);
  fs.rmSync(stateDir, { recursive: true, force: true });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`[FAIL] harness: ${e.message}`);
  process.exit(1);
});
