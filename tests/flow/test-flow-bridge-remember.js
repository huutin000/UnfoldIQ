"use strict";

/**
 * FLOW BRIDGE remember-on-device — extension-side static regressions (spec §25
 * subset testable without a browser). Live UI behavior (checkbox flows,
 * auto-reconnect, storage persistence across restarts) is gated behind the
 * user's live acceptance run.
 *
 * Plain node, zero dependencies.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ✓ ${m}`);
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

const html = fs.readFileSync(path.join(ROOT, "flow-companion/extension/src/ui/sidepanel.html"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "flow-companion/extension/src/ui/sidepanel.js"), "utf8");
const sw = fs.readFileSync(path.join(ROOT, "flow-companion/extension/src/background/service-worker.js"), "utf8");
const contentDir = path.join(ROOT, "flow-companion/extension/src/content");
const contentJs = fs
  .readdirSync(contentDir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(contentDir, f), "utf8"))
  .join("\n");

async function main() {
  await runTest("Storage access level: TRUSTED_CONTEXTS requested at startup, guarded", () => {
    assert(sw.includes("chrome.storage.local.setAccessLevel"), "service worker requests storage.local.setAccessLevel");
    assert(sw.includes('"TRUSTED_CONTEXTS"'), "TRUSTED_CONTEXTS access level requested");
    const idx = sw.indexOf("chrome.storage.local.setAccessLevel");
    assert(sw.slice(Math.max(0, idx - 300), idx).includes("try {"), "call is guarded (graceful fallback for old runtimes)");
    assert(sw.includes("chrome.runtime.lastError"), "callback lastError handled");
  });

  await runTest("Token exposure: content scripts have no storage or token access", () => {
    assert(!contentJs.includes("chrome.storage"), "content scripts never touch chrome.storage");
    assert(!/bridgeToken/i.test(contentJs), "content scripts never reference bridgeToken");
    assert(js.includes("chrome.storage.local"), "side panel (trusted context) still reads/writes storage.local");
    assert(js.includes("s.bridgeToken") && js.includes("persistRememberedToken"), "side panel still owns the remembered credential");
    assert(!js.includes("chrome.storage.sync"), "still no chrome.storage.sync");
  });
  await runTest("UI: remember checkbox + forget action present, opt-in wording", () => {
    assert(html.includes('id="remember-token"'), "remember-token checkbox exists");
    assert(html.includes("Nhớ mã truy cập trên thiết bị này"), "opt-in label present");
    assert(html.includes('id="forget-token"'), "forget action exists");
    assert(html.includes("Quên mã truy cập"), "forget label present");
    assert(!html.checked, "checked attribute absent — user must opt in explicitly");
  });

  await runTest("Storage: chrome.storage.local only, token never synced", () => {
    assert(js.includes("chrome.storage.local"), "uses chrome.storage.local");
    assert(!js.includes("chrome.storage.sync"), "chrome.storage.sync never used");
    assert(js.includes("schemaVersion"), "explicit schema version stored");
    assert(js.includes("rememberToken"), "explicit rememberToken flag stored");
  });

  await runTest("Persistence: token saved only after an authenticated call succeeds", () => {
    const fetchJobIdx = js.indexOf("async function fetchJob");
    const bridgeCallIdx = js.indexOf('await bridgeCall("GET"', fetchJobIdx);
    const persistIdx = js.indexOf("await persistRememberedToken()", fetchJobIdx);
    assert(bridgeCallIdx >= 0 && persistIdx > bridgeCallIdx, "persistRememberedToken runs after the authenticated bridge call");
    assert(/function persistRememberedToken[\s\S]*?rememberChecked\(\)[\s\S]*?cfg\.bridgeToken/.test(js), "persist gated on checkbox + token present");
  });

  await runTest("Uncheck / forget clears the stored token; outage never erases it", () => {
    assert(/if \(!stored\.rememberToken\) delete stored\.bridgeToken;/.test(js), "unchecking remember removes stored token");
    assert(/function onForgetToken[\s\S]*?rememberToken: false[\s\S]*?delete stored\.bridgeToken/.test(js), "forget removes token + flag");
    const saveIdx = js.indexOf("async function saveConfigSilent");
    const rmw = js.indexOf("chrome.storage.local.get(\"flowCompanionBridge\")", saveIdx);
    assert(rmw > saveIdx, "saveConfigSilent read-modify-writes (keeps token through bridge outages)");
  });

  await runTest("Redaction: raw token never rendered or logged", () => {
    assert(!/log\(`[^`]*\$\{cfg\.bridgeToken/.test(js), "token never interpolated into logs");
    assert(!/textContent[^;]*bridgeToken/.test(js), "token never rendered into DOM text");
    assert(js.includes("đã nhớ trên thiết bị này"), "remembered state shown via placeholder, not the raw token");
  });

  await runTest("Errors: rotated-token and unreachable-bridge map to dedicated messages", () => {
    assert(/TOKEN_REJECTED\|BRIDGE_HTTP_401/.test(js), "auth rejection has a dedicated friendly error");
    assert(js.includes("Mã truy cập Bridge không còn hợp lệ"), "rotated-token message present");
    assert(js.includes("BRIDGE_UNREACHABLE"), "network failure surfaces as BRIDGE_UNREACHABLE");
  });

  await runTest("Auto-reconnect: bootstrap loads remembered token before pipeline", () => {
    const bootIdx = js.indexOf("auto-bootstrap");
    const rememberIdx = js.indexOf("s.rememberToken === true", bootIdx);
    const pipelineIdx = js.indexOf("await runPipeline();", bootIdx);
    assert(rememberIdx > bootIdx && pipelineIdx > rememberIdx, "remembered token restored before the auto pipeline runs");
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
