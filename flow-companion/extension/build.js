"use strict";

/**
 * Flow Companion extension build (STEP 10B). Zero dependencies.
 * Validates manifest.json + required files, then stages an unpacked
 * build into .output/chrome-mv3/. Run via `npm run build`.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname);
const OUT = path.join(ROOT, ".output", "chrome-mv3");

const REQUIRED_FILES = [
  "manifest.json",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "src/content/flow-page-adapter.js",
  "src/content/content-commands.js",
  "src/content/content-runtime.js",
  "src/core/capability-detector.js",
  "src/background/service-worker.js",
  "src/background/bridge-client.js",
  "src/background/tab-resolver.js",
  "src/security/sender-check.js",
  "src/contracts/job-contract.js",
  "src/contracts/approval-snapshot.js",
  "src/ui/sidepanel.html",
  "src/ui/sidepanel.js",
  "src/ui/styles/tokens.css",
  "src/ui/styles/base.css",
  "src/ui/styles/components.css",
  "src/ui/state/labels.vi.js",
  "src/ui/state/ui-state.js",
  "src/ui/state/auto-prepare.js",
  "src/ui/toast.js",
  "src/ui/components/icons.js",
  "src/ui/components/job-card.js",
  "src/ui/components/stepper.js",
  "src/ui/components/reference-summary.js",
  "src/ui/components/developer-tools.js",
];

function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3) throw new Error("BUILD_FAILED: manifest_version must be 3");
  // POST-v1C branding + side-panel regression evidence.
  for (const sz of ["16", "32", "48", "128"]) {
    if (!manifest.icons || !manifest.icons[sz]) throw new Error(`BUILD_FAILED: manifest icons[${sz}] missing`);
  }
  if (!manifest.action || !manifest.action.default_icon) throw new Error("BUILD_FAILED: action.default_icon missing");
  if (!manifest.short_name) throw new Error("BUILD_FAILED: short_name missing");
  if (!manifest.description) throw new Error("BUILD_FAILED: description missing");
  const swSrc = fs.readFileSync(path.join(ROOT, "src/background/service-worker.js"), "utf8");
  if (!/setPanelBehavior\s*\(\s*\{\s*openPanelOnActionClick:\s*true\s*\}/.test(swSrc)) {
    throw new Error("BUILD_FAILED: sidePanel openPanelOnActionClick not configured in service-worker.js");
  }
  // POST-v1D UX regression evidence: responsive shell, no fixed narrow
  // wrapper, Vietnamese strings centralized, single CTA state machine.
  const html = fs.readFileSync(path.join(ROOT, "src/ui/sidepanel.html"), "utf8");
  if (!/<html lang="vi">/.test(html)) throw new Error("BUILD_FAILED: side panel must be Vietnamese (lang=vi)");
  if (/width:\s*370px|width:\s*360px|max-width:\s*450px/.test(html)) {
    throw new Error("BUILD_FAILED: fixed narrow app width forbidden (responsive shell required)");
  }
  if (!/styles\/tokens\.css/.test(html) || !/styles\/base\.css/.test(html) || !/styles\/components\.css/.test(html)) {
    throw new Error("BUILD_FAILED: design-token stylesheets must be linked");
  }
  const baseCss = fs.readFileSync(path.join(ROOT, "src/ui/styles/base.css"), "utf8");
  if (!/overflow-x:\s*hidden/.test(baseCss)) throw new Error("BUILD_FAILED: app shell must guard overflow-x");
  if (!/letter-spacing/.test(baseCss) || !/line-height/.test(baseCss)) {
    throw new Error("BUILD_FAILED: readable Vietnamese typography (letter-spacing + line-height) required");
  }
  const uiStateSrc = fs.readFileSync(path.join(ROOT, "src/ui/state/ui-state.js"), "utf8");
  if (!/resolveUIState/.test(uiStateSrc) || !/AWAITING_USER_APPROVAL/.test(uiStateSrc)) {
    throw new Error("BUILD_FAILED: single CTA state machine (resolveUIState) required");
  }
  const perms = manifest.permissions || [];
  if (perms.includes("<all_urls>")) throw new Error("BUILD_FAILED: <all_urls> forbidden");
  const hosts = (manifest.host_permissions || []).join(" ");
  if (/<all_urls>/.test(hosts) || /\*:\/\*\/\*/.test(hosts)) throw new Error("BUILD_FAILED: broad host permissions forbidden");

  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`BUILD_FAILED: missing ${f}`);
  }
  // No credential-like literals in shipped sources.
  const suspect = [];
  for (const f of REQUIRED_FILES.filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (/sk-|xox[bpas]-|ghp_|password\s*[:=]\s*["'][^"']+["']|api[_-]?key\s*[:=]\s*["'][^"']+["']/i.test(src)) suspect.push(f);
  }
  if (suspect.length > 0) throw new Error(`BUILD_FAILED: credential-like literals in ${suspect.join(",")}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  for (const f of REQUIRED_FILES) {
    const dest = path.join(OUT, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dest);
  }
  console.log(`BUILD_OK: ${OUT} (${REQUIRED_FILES.length} files, MV3, minimal permissions)`);
}

main();
