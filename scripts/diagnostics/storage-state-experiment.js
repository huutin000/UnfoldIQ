"use strict";

/**
 * POST-PHASE-2 D2 — storageState feasibility experiment (spec §11.3/Case M).
 *
 * BASELINE: persistent pw-flow-profile. CANDIDATE: isolated browser context
 * + restored storageState exported from the same profile. Probes whether the
 * Google Flow login survives WITHOUT the full persistent profile.
 * Readiness-only: page load + login-state probe — never clicks Generate,
 * never consumes credits.
 *
 * Usage: node scripts/diagnostics/storage-state-experiment.js [--timeout 45000]
 * Output: STORAGE_STATE_SUFFICIENT | PERSISTENT_PROFILE_REQUIRED | NOT_PROVEN
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const timeoutMs = Number(args[args.indexOf("--timeout") + 1]) || 45000;
const PROFILE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".unfoldiq"), "UNFOLDIQ", "pw-flow-profile");
const FLOW_URL = "https://labs.google/fx/tools/flow";
const OUT = path.join(__dirname, "..", "..", "Report", "hardening", "storage-state-experiment.json");

const SIGN_IN_MARKERS = ["sign in", "đăng nhập", "log in", "sign-in"];
const LOGGED_IN_MARKERS = ["new project", "create", "flow"];

function probeLoginState(html) {
  const text = String(html).toLowerCase();
  const signIn = SIGN_IN_MARKERS.find((m) => text.includes(m));
  if (signIn) return { loggedIn: false, marker: signIn };
  const ok = LOGGED_IN_MARKERS.find((m) => text.includes(m));
  return { loggedIn: !!ok, marker: ok || null };
}

(async () => {
  const result = { experiment: "storageState-vs-persistent-profile", at: new Date().toISOString(), profile: PROFILE, flowUrl: FLOW_URL };
  if (!fs.existsSync(PROFILE)) {
    result.decision = "NOT_PROVEN";
    result.reason = `profile not found: ${PROFILE}`;
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  let browser;
  try {
    // BASELINE: persistent context — export storageState + probe login.
    const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, timeout: 60000 });
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(3000);
    const baselineState = probeLoginState(await page.content());
    const storageState = await ctx.storageState();
    await ctx.close();
    result.baseline = {
      loggedIn: baselineState.loggedIn,
      marker: baselineState.marker,
      cookieCount: storageState.cookies.length,
      googleCookieCount: storageState.cookies.filter((c) => c.domain.includes("google")).length,
    };
    result.baseline.note = "persistent context login probe (readiness only — no generation)";

    // CANDIDATE: isolated context + restored storageState.
    browser = await chromium.launch({ headless: true, timeout: 60000 });
    const iso = await browser.newContext({ storageState });
    const isoPage = await iso.newPage();
    await isoPage.goto(FLOW_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await isoPage.waitForTimeout(3000);
    const candidateState = probeLoginState(await isoPage.content());
    result.candidate = {
      loggedIn: candidateState.loggedIn,
      marker: candidateState.marker,
      finalUrl: isoPage.url().slice(0, 120),
    };
    await iso.close();
    await browser.close();
    browser = null;

    // Decision (§11.3): candidate must preserve the baseline login state.
    if (result.baseline.loggedIn && result.candidate.loggedIn) {
      result.decision = "STORAGE_STATE_SUFFICIENT";
    } else if (!result.baseline.loggedIn) {
      result.decision = "NOT_PROVEN";
      result.reason = "baseline itself is not logged in — run a real Flow session first, then re-run this experiment";
    } else {
      result.decision = "PERSISTENT_PROFILE_REQUIRED";
    }
  } catch (e) {
    result.decision = "NOT_PROVEN";
    result.reason = `experiment error: ${String(e.message).slice(0, 300)}`;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.decision === "NOT_PROVEN" ? 2 : 0);
})();
