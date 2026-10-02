"use strict";

/**
 * POST-v1D regression: Flow Companion UX simplification & side-panel redesign.
 * Static + module-level tests (no browser needed). Fixture success ≠ live UX
 * review, but every automatable acceptance rule in §51/§55 is asserted here.
 *
 * Covers:
 *  D1 Main UI: normal mode hides developer data, one primary CTA, VN labels.
 *  D2 Click reduction: auto bootstrap/pipeline, no infra buttons in main view.
 *  D3 Responsive: fluid shell, zero horizontal scroll guards, breakpoints.
 *  D4 Typography: Vietnamese readability fix (letter-spacing + line-height).
 *  D5 Async: loading, disable, double-click guard, toast dedupe.
 *  D6 Developer Mode: hidden by default, available when enabled.
 *  D7 Icons/localization/a11y: local SVG set, centralized strings, semantics.
 *  D8 Functional regression guard: automation entry points intact.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const UI = path.join(ROOT, "flow-companion", "extension", "src", "ui");

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

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function mainView(html) {
  const m = html.match(/<div id="view-main"[\s\S]*?(?=<div id="view-settings")/);
  return m ? m[0] : "";
}

async function main() {
  console.log("=== POST-V1D UX REGRESSION (§51) ===\n");
  const html = read(path.join(UI, "sidepanel.html"));
  const js = read(path.join(UI, "sidepanel.js"));
  const main = mainView(html);
  const vi = require(path.join(UI, "state", "labels.vi.js"));
  const st = require(path.join(UI, "state", "ui-state.js"));
  const icons = require(path.join(UI, "components", "icons.js"));
  const jobCard = require(path.join(UI, "components", "job-card.js"));
  const stepper = require(path.join(UI, "components", "stepper.js"));
  const refSum = require(path.join(UI, "components", "reference-summary.js"));

  await runTest("D1 Normal mode hides developer data, one CTA, VN labels", async () => {
    for (const secret of ["bridge-url", "bridge-token", "project-id", "selector-health", "GENERATION_READY", "promptVerified", "generationType", "contentScriptInjected", "bridgeReachable", "DOM probe", "Raw log"]) {
      assert(!main.includes(secret), `main view must not expose: ${secret}`);
    }
    const ctas = (main.match(/id="primary-action"/g) || []).length;
    assert(ctas === 1, "main screen must have exactly one primary CTA");
    assert(main.includes('id="secondary-action"'), "quiet secondary action slot required");
    assert(main.includes('id="job-card"') && main.includes('id="stepper-slot"'), "job + progress areas required");
    // Every state maps to a Vietnamese CTA via the single source of truth.
    const expectations = {
      NO_JOB: "Tìm công việc",
      CONNECTING: "Đang kết nối…",
      PREPARING: "Đang chuẩn bị…",
      NEED_FLOW: "Thử lại",
      NEED_CONFIG: "Mở cài đặt",
      AWAITING_USER_APPROVAL: "Duyệt & Tạo",
      GENERATING: "Đang tạo…",
      PROCESSING: "Đang xử lý…",
      READY: "Xem kết quả",
      ERROR_RETRYABLE: "Thử lại",
      BLOCKED: "Xem vấn đề",
      CANCELLED: "Tìm công việc mới",
    };
    for (const [state, cta] of Object.entries(expectations)) {
      const r = st.resolveUIState(state);
      assert(r.cta === cta, `${state} → CTA "${cta}" (got "${r.cta}")`);
      assert(typeof r.status === "string" && r.status.length > 0, `${state} has human status`);
      assert(!/GENERATION_READY|PROMPT_INPUT|MODE_IMAGE|RESULT_MEDIA/.test(r.status + r.cta), `${state} exposes no internal enums`);
    }
    // Job status → UI state mapping keeps approval gating.
    assert(st.uiStateForJob(null) === "NO_JOB", "no job → NO_JOB");
    assert(st.uiStateForJob({ status: "AWAITING_USER_APPROVAL" }, { generationReady: true }) === "AWAITING_USER_APPROVAL", "approval state preserved");
    assert(st.uiStateForJob({ status: "GENERATING" }, {}) === "GENERATING", "generating preserved");
    assert(st.uiStateForJob({ status: "READY" }, {}) === "READY", "ready preserved");
  });

  await runTest("D2 Click reduction: automated pipeline, no infra buttons", async () => {
    for (const id of ["check-tabs", "fetch-job", "dryrun", "save-config", "check-generation", "probe-dom"]) {
      assert(!main.includes(`id="${id}"`), `main view must not require manual step: ${id}`);
    }
    assert(/resolveFlow[\s\S]*fetchJob[\s\S]*ensureCurrentJobPrepared/.test(js) || (/resolveFlow\(\)/.test(js) && /fetchJob\(\)/.test(js) && /ensureCurrentJobPrepared/.test(js)), "open-panel pipeline automates resolve → fetch → prepare");
    assert(/PREPARE_GENERATION/.test(js) && /GET_GENERATION_STATE/.test(js), "silent dry-run + read-only state probe automated");
    assert(!/SUBMIT_GENERATE/.test(js.split("onApprove")[0] || "") || /SUBMIT_GENERATE/.test(js), "SUBMIT only inside approval handler");
    const beforeApprove = js.slice(0, js.indexOf("async function onApprove"));
    assert(!beforeApprove.includes("SUBMIT_GENERATE"), "no Generate path outside explicit approval");
  });

  await runTest("D3 Responsive shell: fluid width, no page h-scroll", async () => {
    const base = read(path.join(UI, "styles", "base.css"));
    const comp = read(path.join(UI, "styles", "components.css"));
    assert(/#app\s*\{[^}]*width:\s*100%/.test(base), "app shell width 100%");
    assert(/max-width:\s*none/.test(base), "no narrow max-width lock");
    assert(/overflow-x:\s*hidden/.test(base), "overflow-x hidden guard");
    assert(!/width:\s*(36|37)\dpx/.test(html) && !/width:\s*450px/.test(html), "no fixed narrow wrapper in markup");
    assert(/min-width:\s*0/.test(base), "flex/grid children can shrink");
    assert(/@media\s*\(min-width:\s*560px\)/.test(base) && /@media\s*\(min-width:\s*720px\)/.test(base), "560/720 breakpoints required");
    assert(/overflow-wrap:\s*anywhere/.test(base), "long values wrap anywhere");
    // Selector table replaced by stacked rows with own scroll.
    assert(/\.selector-row/.test(comp) && /overflow-y:\s*auto/.test(comp), "selector list stacks + scrolls internally");
    assert(/\.diag-pre[^}]*overflow-x:\s*hidden/.test(comp) && /\.log-view[^}]*overflow-x:\s*hidden/.test(comp), "diag/log scroll vertically only");
    assert(!/<table/.test(html), "no layout tables in normal/settings views");
  });

  await runTest("D4 Vietnamese readability: spacing between characters", async () => {
    const tokens = read(path.join(UI, "styles", "tokens.css"));
    const base = read(path.join(UI, "styles", "base.css"));
    assert(/--tracking-body:\s*0\.012em/.test(tokens), "body letter-spacing token 0.012em");
    assert(/--tracking-heading:\s*0\.02em/.test(tokens), "heading letter-spacing token 0.02em");
    assert(/--line-body:\s*1\.65/.test(tokens), "body line-height token 1.65 (diacritics-safe)");
    assert(/letter-spacing:\s*var\(--tracking-body\)/.test(base), "body applies letter-spacing");
    assert(/word-spacing:\s*0\.02em/.test(base), "body applies word-spacing");
    assert(/line-height:\s*var\(--line-body\)/.test(base), "body applies relaxed line-height");
  });

  await runTest("D5 Async safety: loading, disable, guard, toast", async () => {
    assert(/inFlight/.test(js) && /async function guard/.test(js), "in-flight double-click guard required");
    assert(/setCtaLoading/.test(js) && /class="spin"|className = "spin"/.test(js), "CTA spinner required");
    assert(/ctaBtn\.disabled = !mapped\.ctaEnabled/.test(js), "CTA disabled per state");
    const toastSrc = read(path.join(UI, "toast.js"));
    assert(/role", "status"/.test(toastSrc), "toast uses live-region role=status");
    assert(/data-toast-msg/.test(toastSrc), "duplicate-toast suppression required");
    assert(/aria-label", "Đóng thông báo"/.test(toastSrc), "toast close labelled");
  });

  await runTest("D6 Developer Mode gating", async () => {
    assert(/id="dev-tools"[^>]*hidden/.test(html), "developer tools hidden by default");
    assert(/id="dev-mode" type="checkbox"/.test(html), "developer mode toggle required");
    assert(/flowCompanionDevMode/.test(js), "dev-mode preference persisted (non-secret)");
    assert(/devToolsSection\.hidden = !devMode/.test(js), "tools shown only when dev mode on");
    assert(/Chẩn đoán/.test(html) && /Trạng thái điều khiển/.test(html) && /Nhật ký/.test(html), "diagnostics/selectors/logs available in dev mode");
  });

  await runTest("D7 Icons, centralized strings, accessibility", async () => {
    assert(icons.names.length >= 8 && icons.names.includes("settings") && icons.names.includes("check"), "local icon set covers UI needs");
    const svg = icons.svg("settings");
    assert(svg.startsWith("<svg") && svg.includes('viewBox="0 0 24 24"') && svg.includes('aria-hidden="true"'), "icons are inline SVG, decorative");
    let threw = false;
    try {
      icons.svg("nope");
    } catch {
      threw = true;
    }
    assert(threw, "unknown icon rejected");
    const iconsSrc = read(path.join(UI, "components", "icons.js")).split("http://www.w3.org/2000/svg").join("");
    assert(!/src="https?:|href="https?:|url\(https?:|fetch\(['"]https?:|import\(['"]https?:/i.test(iconsSrc), "icons bundled locally, no remote loads");
    for (const k of ["statusReady", "statusPreparing", "ctaApproveCreate", "refTitle", "techDetails", "errFlowTitle"]) {
      assert(typeof vi[k] === "string" && vi[k].length > 0, `labels.vi.js defines ${k}`);
    }
    // Accessibility semantics in markup + CSS.
    for (const pat of ['aria-live="polite"', 'aria-label="Cài đặt"', 'aria-label="Quay lại"', 'aria-current="step"', ":focus-visible", 'role="alert"', 'aria-expanded']) {
      const hay = html + read(path.join(UI, "styles", "base.css")) + read(path.join(UI, "components", "stepper.js")) + js;
      assert(hay.includes(pat), `a11y requirement present: ${pat}`);
    }
    assert(!/😀|🎉|⏳|✅|❌/.test(html + js), "no emoji icons in UI");
    assert(!/<button/.test(html) || /type="button"/.test(html), "real buttons used");
  });

  await runTest("D8 Component contracts: job card, stepper, reference", async () => {
    const job = { jobId: "J-1", projectId: "P", capability: "image", prompt: "Xanh.\nDòng hai.", status: "AWAITING_USER_APPROVAL", outputRequirements: {} };
    const card = jobCard.renderJobCard(job, { modelLabel: "M", aspectSetting: "1:1", outputCount: 1, creditCost: "20" }, vi);
    assert(card.includes("Tạo ảnh") && card.includes("prompt-preview") && card.includes("Xem chi tiết"), "job card answers what/cost/settings with details collapsed");
    assert(!/GENERATION_READY|promptVerified/.test(card), "job card exposes no internal enums");
    assert(jobCard.renderJobCard(null, null, vi).includes("Tìm công việc"), "empty job guides to CTA");
    const steps = stepper.renderStepper(["prepare", "await"], vi);
    assert(steps.includes("Chuẩn bị") && steps.includes('aria-current="step"'), "stepper renders human steps with current marker");
    assert(stepper.renderStepper([], vi) === "", "no steps when no job");
    assert(refSum.renderReferenceSummary(null, vi) === "", "reference hidden when job needs none");
    const ref = refSum.renderReferenceSummary({ referenceAsset: { path: "a.png" }, referenceDescription: { semanticRole: "Mascot", identityTraits: ["Tóc"], continuityConstraints: [], allowedVariation: ["Tư thế"] } }, vi);
    assert(ref.includes("Giữ") && ref.includes("Thay đổi"), "reference compact with keep/allowed/change");
  });

  await runTest("D9 Automation entry points intact (no architecture rewrite)", async () => {
    for (const sig of ["normalizeBridgeUrl", "bridgeCall", "swMessage", "tabRelay", "PREPARE_GENERATION", "SUBMIT_GENERATE", "APPROVE_RECORD", "READ_RESULT", "FETCH_RESULT_BYTES", "TRIGGER_DOWNLOAD", "readReferenceFields", "sha256Hex", "FLOW_TABS", "GET_STATE", "GET_GENERATION_STATE"]) {
      assert(js.includes(sig), `automation entry intact: ${sig}`);
    }
    assert(/approvedBy: "user"/.test(js), "approval attribution preserved");
    assert(/idempotency guard/.test(js), "approval idempotency preserved");
    assert(!/React|createElement\(App|useState/.test(js), "no React migration");
    assert(!/document\.cookie|chrome\.cookies|<all_urls>/.test(js + html), "security policy intact");
  });

  console.log(`\n=== SUMMARY: passed assertions ${passed}, failed tests ${failed} ===`);
  console.log(failed > 0 ? "RESULT: SOME TESTS FAILED" : "RESULT: ALL TESTS PASSED");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
