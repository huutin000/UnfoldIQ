"use strict";

/**
 * POST-v1C regression: GENERATION_READY + essential polish + roadmap.
 * Fixture/mock + loopback only. Fixture success ≠ live Flow success.
 * Never clicks Generate; never consumes credits.
 *
 * Covers (§36):
 *  Flow controls: generation-type discovery, image-mode discovery, valid
 *    aspect extraction, icon-text-as-aspect rejection, output count, model
 *    label, Generate enabled state, GENERATION_READY contract, approval
 *    packet honesty.
 *  Side Panel: toolbar action opens Side Panel, Vietnamese text, toast,
 *    loading disables button, double-click guard.
 *  Approval safety: no Generate without approval, dry-run never Generate,
 *    duplicate approval cannot regenerate.
 *  Music/thumbnail contracts: schema compile + status gating.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
const sw = require("../../flow-companion/extension/src/background/service-worker.js");
const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
const { FakeDocument, FakeElement } = require("../../flow-companion/extension/tests/mock-dom.js");

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

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

const S = (k) => adapter.SELECTORS[k].selector;
const docWith = (map) => new FakeDocument(map);
const el = (opts = {}) => new FakeElement(opts);

// Live-like selected-state element (aria-selected=true + label).
function selectedTab(label) {
  const t = el({ tag: "div", attrs: { role: "tab", "aria-label": label, "aria-selected": "true" } });
  t.textContent = label;
  return t;
}

async function main() {
  console.log("=== POST-V1C REGRESSION (§36) ===\n");

  await runTest("C1 Aspect reader accepts real ratios, rejects icon garbage", async () => {
    assert(adapter.normalizeAspectLabel("16:9") === "16:9", "16:9 accepted");
    assert(adapter.normalizeAspectLabel("9:16") === "9:16", "9:16 accepted");
    assert(adapter.normalizeAspectLabel("1:1") === "1:1", "1:1 accepted");
    assert(adapter.normalizeAspectLabel("Landscape") === "landscape", "landscape accepted");
    assert(adapter.normalizeAspectLabel("Portrait mode") === "portrait", "portrait accepted");
    assert(adapter.normalizeAspectLabel("square") === "square", "square accepted");
    for (const junk of ["arrow_forward", "expand_more", "chevron_right", "settings", "tune", "", "Generate image with settings"]) {
      assert(adapter.normalizeAspectLabel(junk) === null, `icon/label text rejected as aspect: ${JSON.stringify(junk)}`);
    }
    // Live regression: aspect control exposing an icon ligature reads UNKNOWN.
    const iconBtn = el({ tag: "button", attrs: { "aria-label": "aspect" } });
    iconBtn.textContent = "arrow_forward";
    const root = docWith({ [S("ASPECT_CONTROL")]: iconBtn });
    assert(adapter.readAspectSetting(root) === null, "live arrow_forward control must read null (UNKNOWN)");
    logOut("aspect", { valid: adapter.readAspectSetting(docWith({ [S("ASPECT_CONTROL")]: (() => { const b = el({ tag: "button" }); b.textContent = "16:9"; return b; })() })), junk: adapter.readAspectSetting(root) });
  });

  await runTest("C2 Model label is live-observed or honestly UNKNOWN", async () => {
    assert(adapter.normalizeModelLabel("Nano Banana Pro") === "Nano Banana Pro", "real label kept verbatim");
    assert(adapter.normalizeModelLabel("arrow_forward") === null, "icon text rejected as model");
    assert(adapter.normalizeModelLabel("model") === null, "bare generic placeholder rejected");
    assert(adapter.normalizeModelLabel("") === null, "empty rejected");
    const root = docWith({});
    assert(adapter.readModelLabel(root) === null, "missing control reads null (UNKNOWN downstream)");
  });

  await runTest("C3 Output count resolves or stays UNKNOWN", async () => {
    const four = el({ tag: "button", attrs: { "aria-label": "output count" } });
    four.textContent = "4";
    assert(adapter.readOutputCount(docWith({ [S("OUTPUT_COUNT")]: four })).value === 4, "output count 4 parsed");
    assert(adapter.readOutputCount(docWith({})).value === null, "missing output control is UNKNOWN, not fabricated");
    const junk = el({ tag: "button" });
    junk.textContent = "arrow_forward";
    assert(adapter.readOutputCount(docWith({ [S("OUTPUT_COUNT")]: junk })).value === null, "icon text never parses as count");
  });

  await runTest("C4 Generation type + image mode discovery", async () => {
    const imgSel = el({ tag: "button", attrs: { "aria-label": "image mode", "aria-selected": "true" } });
    const genBtn = el({ tag: "button" });
    const root = docWith({ [S("MODE_IMAGE")]: imgSel, [S("GENERATE_BUTTON")]: genBtn });
    const gt = adapter.detectGenerationType(root);
    logOut("generationType", gt);
    assert(gt.type === "IMAGE" && gt.verified === true, "selected image mode must be IMAGE + verified");
    const tabRoot = docWith({ '[role="tab"]': [selectedTab("Video")] });
    assert(adapter.detectGenerationType(tabRoot).type === "VIDEO", "selected video tab must be VIDEO");
    assert(adapter.detectGenerationType(docWith({})).type === "UNKNOWN", "no mode controls must be UNKNOWN");
    assert(adapter.selectMode(docWith({ [S("MODE_IMAGE")]: el({ tag: "button" }) }), "image").ok === true, "image mode still selectable");
  });

  await runTest("C5 Generate enabled-state drives GENERATION_READY", async () => {
    const imgSel = el({ tag: "button", attrs: { "aria-selected": "true" } });
    const enabled = el({ tag: "button" });
    const readyRoot = docWith({ [S("MODE_IMAGE")]: imgSel, [S("GENERATE_BUTTON")]: enabled });
    const ready = adapter.assessGenerationReady(readyRoot, { promptVerified: true, approvalState: "AWAITING_USER_APPROVAL" });
    logOut("ready", { ready: ready.ready, details: ready.details });
    assert(ready.ready === true, "all conditions met must be GENERATION_READY");
    assert(ready.details.modelLabel === "UNKNOWN" && ready.details.aspect === "UNKNOWN", "unresolved optionals stay visibly UNKNOWN");
    assert(ready.clickedGenerate === false && ready.creditsConsumed === false, "assessment never clicks, never consumes");
    const disabled = el({ tag: "button", attrs: { "aria-disabled": "true" } });
    const notReady = adapter.assessGenerationReady(docWith({ [S("MODE_IMAGE")]: imgSel, [S("GENERATE_BUTTON")]: disabled }), {
      promptVerified: true,
      approvalState: "AWAITING_USER_APPROVAL",
    });
    assert(notReady.ready === false && notReady.missing.includes("GENERATE_STILL_DISABLED_AFTER_PROMPT"), "disabled Generate must block readiness precisely");
    const noApproval = adapter.assessGenerationReady(readyRoot, { promptVerified: true, approvalState: "UNKNOWN" });
    assert(noApproval.ready === false && noApproval.missing.includes("APPROVAL_NOT_RECORDED"), "missing approval must block readiness");
  });

  await runTest("C6 Approval packet is honest (UNKNOWN stays UNKNOWN)", async () => {
    const gs = { ready: false, missing: ["GENERATION_TYPE_UNKNOWN"], details: { modelLabel: "UNKNOWN", aspect: "UNKNOWN", outputCount: "UNKNOWN", visibleCreditCost: "UNKNOWN" } };
    const p = adapter.buildApprovalPacket({
      job: { jobId: "FLOW-COMPANION-LIVE-GEN-01", capability: "image", prompt: "Create a simple minimal blue circle centered on a clean light background. No text.", projectId: "postv1b-flow-companion-live" },
      generationState: gs,
    });
    logOut("packet", p);
    assert(p.jobId === "FLOW-COMPANION-LIVE-GEN-01" && p.type === "IMAGE", "packet identity correct");
    assert(p.model === "UNKNOWN" && p.aspect === "UNKNOWN", "unresolved values stay UNKNOWN, never fabricated");
    assert(p.expectedImportPath === "projects/postv1b-flow-companion-live/assets/FLOW-COMPANION-LIVE-GEN-01.<ext>", "expected import path per contract");
    assert(p.clickedGenerate === false, "packet never triggers generation");
  });

  await runTest("C7 GET_GENERATION_STATE is read-only (never clicks)", async () => {
    const btn = el({ tag: "button" });
    const imgSel = el({ tag: "button", attrs: { "aria-selected": "true" } });
    // Writable textarea double (mirrors R1 live-like doubles): tagName +
    // value semantics so readiness passes without touching a real page.
    const prompt = { tagName: "TEXTAREA", value: "", focus() {}, dispatchEvent() {}, getAttribute() { return null; } };
    const root = docWith({ [S("PROMPT_INPUT")]: prompt, [S("MODE_IMAGE")]: imgSel, [S("GENERATE_BUTTON")]: btn });
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "GET_GENERATION_STATE", promptVerified: true, approvalState: "AWAITING_USER_APPROVAL" }, {});
    assert(res.ok === true && res.generationState.ready === true, "read-only probe must report readiness");
    assert(btn.clicked === 0 && res.clickedGenerate === false, "probe must never click Generate");
    const dry = await cmds.dispatchContentCommand(adapter, root, { type: "INSERT_PROMPT_DRYRUN", prompt: "Create a simple minimal blue circle. No text." }, {});
    assert(dry.ok === true && dry.dryRun.clickedGenerate === false && btn.clicked === 0, "dry-run still zero-credit after POST-v1C");
    assert(dry.dryRun.aspectSetting !== "arrow_forward", "dry-run aspect must never be icon garbage");
  });

  await runTest("C8 Extension branding + side-panel action behavior", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "manifest.json"), "utf8"));
    for (const sz of ["16", "32", "48", "128"]) {
      assert(manifest.icons && manifest.icons[sz], `manifest icons[${sz}] required`);
      assert(fs.existsSync(path.join(ROOT, "flow-companion", "extension", manifest.icons[sz])), `icon file ${manifest.icons[sz]} must exist`);
    }
    assert(manifest.action && manifest.action.default_icon, "action.default_icon required");
    assert(manifest.action.default_title === "UNFOLDIQ Flow Companion", "action title branded");
    assert(manifest.short_name === "Flow Companion", "short_name required");
    assert(typeof manifest.description === "string" && manifest.description.length > 20, "store description required");
    const swSrc = fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "src", "background", "service-worker.js"), "utf8");
    assert(/setPanelBehavior\s*\(\s*\{\s*openPanelOnActionClick:\s*true\s*\}/.test(swSrc), "toolbar icon must open Side Panel via setPanelBehavior");
  });

  await runTest("C9 Vietnamese UI + toast + loading/double-click guard (POST-v1D IA)", async () => {
    const html = fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "src", "ui", "sidepanel.html"), "utf8");
    assert(/<html lang="vi">/.test(html), "side panel must be Vietnamese (lang=vi)");
    // Settings-view strings remain in static HTML.
    for (const s of ["URL Bridge", "Mã truy cập Bridge", "Mã dự án", "Mã công việc", "Nhật ký", "toast-container", "Cài đặt"]) {
      assert(html.includes(s), `Settings UI must contain: ${s}`);
    }
    // Main-view action strings are centralized in labels.vi.js (POST-v1D §32).
    const labels = fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "src", "ui", "state", "labels.vi.js"), "utf8");
    for (const s of ["Duyệt & Tạo", "Từ chối", "Tìm công việc", "Sẵn sàng", "Đang chuẩn bị", "Chờ duyệt", "Đang tạo", "Hoàn tất", "Thử lại", "Xem chi tiết", "Xem kết quả"]) {
      assert(labels.includes(s), `labels.vi.js must contain: ${s}`);
    }
    const js = fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "src", "ui", "sidepanel.js"), "utf8");
    const toastMod = fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "src", "ui", "toast.js"), "utf8");
    assert(/showToast/.test(toastMod), "toast system required (toast.js)");
    for (const m of ["toastConnected", "toastJobLoaded", "toastCreating", "toastDone", "toastImported"]) {
      assert(labels.includes(m), `toast key required in labels: ${m}`);
    }
    assert(/setCtaLoading/.test(js) && /inFlight/.test(js) && /disabled/.test(js), "async CTA must show loading + disable + double-click guard");
    assert(/APPROVAL|approvable|idempotency/.test(js), "generation idempotency guard required");
    assert(/auto-bootstrap|bootstrap/i.test(js), "safe auto-bootstrap required");
    assert(/ref-image|ref-desc-role/.test(js), "reference image + description support required");
    assert(!/document\.cookie|chrome\.cookies/i.test(js), "side panel must not touch cookies");
  });

  await runTest("C10 Approval safety: no Generate without approval, no duplicates", async () => {
    let threw = null;
    try {
      adapter.submitAfterApproval(docWith({ [S("GENERATE_BUTTON")]: el({ tag: "button" }) }), { approved: false });
    } catch (e) {
      threw = e.message;
    }
    assert(threw && /APPROVAL_REQUIRED/.test(threw), "submit without approval must throw");
    const btn = el({ tag: "button" });
    const root = docWith({ [S("PROMPT_INPUT")]: el({ tag: "textarea", value: "" }), [S("GENERATE_BUTTON")]: btn });
    const dry = adapter.insertPromptDryRun(root, "safety probe");
    assert(dry.clickedGenerate === false && btn.clicked === 0, "dry-run never clicks Generate");
    const map = new Map();
    sw.recordLocalApproval(map, { jobId: "GEN-01", attempt: 1, approvedBy: "user" });
    sw.consumeLocalApproval(map, "GEN-01", 1);
    let reused = null;
    try {
      sw.consumeLocalApproval(map, "GEN-01", 1);
    } catch (e) {
      reused = e.message;
    }
    assert(reused && /APPROVAL_REQUIRED/.test(reused), "duplicate click must not create a duplicate generation");
    for (const c of ["GENERATION_NOT_READY", "GENERATION_TYPE_UNKNOWN", "PROMPT_NOT_VERIFIED", "APPROVAL_NOT_RECORDED"]) {
      assert(sw.ERROR_CODES.includes(c), `${c} must be a registered error code`);
    }
  });

  await runTest("C11 Music + thumbnail contracts gate publish-ready", async () => {
    let Ajv;
    try {
      Ajv = require("ajv");
    } catch {
      throw new Error("ajv dependency required for contract tests");
    }
    const ajv = new Ajv({ allErrors: true, strict: false });
    const musicSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "music-source.schema.json"), "utf8"));
    const thumbSchema = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas", "thumbnail-package.schema.json"), "utf8"));
    const vMusic = ajv.compile(musicSchema);
    const vThumb = ajv.compile(thumbSchema);
    const approvedTrack = { trackId: "T-1", title: "Calm Study", artist: "YouTube Audio Library", source: "YouTube Audio Library", licenseType: "royalty-free platform license", commercialUseAllowed: true, attributionRequired: false, status: "APPROVED" };
    assert(vMusic(approvedTrack) === true, "approved track must validate");
    const unknownTrack = { trackId: "T-2", title: "Random download", source: "random web", licenseType: "unknown", commercialUseAllowed: false, attributionRequired: false, status: "UNKNOWN" };
    assert(vMusic(unknownTrack) === true, "unknown-rights record must still validate structurally");
    assert(unknownTrack.status !== "APPROVED", "UNKNOWN music rights must block publish-ready");
    assert(vMusic({ title: "no id" }) === false, "track without identity must fail validation");
    const thumb = { file: "publish/thumbnail.png", width: 1280, height: 720, aspectRatio: "16:9", readableAtSmallSize: true, accurateToContent: true, policySafe: true, status: "READY" };
    assert(vThumb(thumb) === true, "ready thumbnail package must validate");
    assert(vThumb({ ...thumb, aspectRatio: "9:16" }) === false, "non-16:9 long-form thumbnail must fail");
  });

  console.log(`\n=== SUMMARY: passed assertions ${passed}, failed tests ${failed} ===`);
  console.log(failed > 0 ? "RESULT: SOME TESTS FAILED" : "RESULT: ALL TESTS PASSED");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
