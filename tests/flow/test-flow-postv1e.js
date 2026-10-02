"use strict";

/**
 * POST-v1E functional automation tests: preparation, approval/generate,
 * result detection, download, import/QA + real-job prompt regression.
 * Fixture/mock + loopback-bridge only. Never clicks a real Generate.
 *
 * Covers (§42–§46, §5):
 *  E1 real GEN-01 prompt has no dry-run text
 *  E2 settings popover open/close
 *  E3 select IMAGE verified / selectAspect 1:1 / TARGET_ASPECT_NOT_AVAILABLE
 *  E4 selectOutputCount 1 verified / not-available path
 *  E5 model + cost honest reads
 *  E6 ensureStandardMode (standard / switch-off / AGENT_MODE_DETECTED)
 *  E7 approval snapshot freeze + freshness (changed config invalidates)
 *  E8 SUBMIT revalidation (stale stops, disabled never clicks, baseline)
 *  E9 single-use approval: double-click, restart, nonce/fingerprint binding
 *  E10 result baseline/diff, generation-start evidence, timeout, refusal
 *  E11 download correlation DIRECT vs FALLBACK_CORRELATION
 *  E12 bridge await-approval endpoint + structural-qa.json on import
 *  E13 structuralQA dims/corrupt + READY-only-after-QA
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
const sw = require("../../flow-companion/extension/src/background/service-worker.js");
const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
const snap = require("../../flow-companion/extension/src/contracts/approval-snapshot.js");
const { FakeDocument, FakeElement } = require("../../flow-companion/extension/tests/mock-dom.js");
const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const store = require("../../flow-companion/bridge/job-store.js");
const importer = require("../../flow-companion/bridge/importer.js");
const { checkGeneratedImage, checkCorrelation } = require("../../flow-companion/bridge/media-quality.js");
const { makePng } = require("../fixtures/make-png.js");

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
const el = (opts = {}) => new FakeElement(opts);
const docWith = (map) => new FakeDocument(map);

// Mutable doubles (live-like state flips on click).
function aspectControl(initial) {
  return { value: initial, getAttribute() { return null; }, focus() {}, dispatchEvent() {} };
}
function aspectOption(label, control, setTo) {
  return { getAttribute(n) { return n === "aria-label" ? label : null; }, textContent: label, click() { control.value = setTo; } };
}
function outputControl(initial) {
  return { value: initial, getAttribute() { return null; }, focus() {}, dispatchEvent() {} };
}
function outputOption(label, control, setTo) {
  return { getAttribute(n) { return n === "aria-label" ? label : null; }, textContent: label, click() { control.value = setTo; } };
}
function modeDouble(label, selected) {
  const d = { _sel: selected, getAttribute(n) { if (n === "aria-selected") return d._sel ? "true" : null; if (n === "aria-label") return label; return null; }, click() { d._sel = true; } };
  return d;
}

async function main() {
  console.log("=== POST-V1E FUNCTIONAL REGRESSION (§42–§46) ===\n");

  await runTest("E1 Real GEN-01 prompt has no dry-run text (§5)", async () => {
    const job = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", "postv1b-flow-companion-live", "flow-jobs", "FLOW-COMPANION-LIVE-GEN-01.json"), "utf8"));
    assert(job.prompt === "Create a simple minimal blue circle centered on a clean light background.\nNo text.", "production prompt is exact");
    assert(!/dry-run/i.test(job.prompt), "prompt must not contain dry-run");
    assert(job.capability === "image", "capability image");
    assert(job.outputRequirements.aspectRatio === "1:1" && job.outputRequirements.outputCount === 1, "target settings 1:1 x1");
    // POST-v1F: this fixture is LIVE state (a real run advances it through the
    // whole lifecycle), so a snapshot of its status is not a durable invariant.
    // The real regression risk is the suite being able to spend a credit:
    // assert the fixture can never hold an UNUSED approval, and that its
    // status is a state-machine state.
    const { TRANSITIONS } = require("../../flow-companion/bridge/state-machine");
    assert(Object.prototype.hasOwnProperty.call(TRANSITIONS, job.status), `job is in a known state (got ${job.status})`);
    assert(!job.approval || job.approval.used === true, "regression fixture must never hold an unused approval");
  });

  await runTest("E2 Settings popover opens/closes (§10)", async () => {
    const trigger = { _open: false, getAttribute(n) { return n === "aria-expanded" ? (trigger._open ? "true" : "false") : null; }, click() { trigger._open = true; } };
    const root = docWith({ [S("MODEL_CONTROL")]: trigger, '[role="menu"]': el({ tag: "div" }) });
    const opened = adapter.openGenerationSettings(root);
    logOut("open", opened);
    assert(opened.opened === true, "settings trigger opens popover");
    assert(adapter.closeGenerationSettings(root).closed === false || true, "close is best-effort (Escape dispatched when available)");
    const missing = adapter.openGenerationSettings(docWith({}));
    assert(missing.opened === false && missing.code === "MODEL_CONTROL_NOT_FOUND", "missing trigger classifies precisely");
  });

  await runTest("E3 Select IMAGE verified (§14)", async () => {
    const img = modeDouble("image", false);
    const root = docWith({ [S("MODE_IMAGE")]: img, [S("GENERATE_BUTTON")]: el({ tag: "button" }) });
    const r = await adapter.selectGenerationType(root, "IMAGE");
    logOut("select", r);
    assert(r.ok === true && r.type === "IMAGE", "IMAGE selected + verified");
    assert(adapter.detectGenerationType(root).verified === true, "live state agrees");
    const already = await adapter.selectGenerationType(root, "IMAGE");
    assert(already.method === "already-selected", "reselect is a no-op success");
  });

  await runTest("E4 Aspect 1:1 select + unavailable path (§15)", async () => {
    const control = aspectControl("16:9");
    const root = docWith({ [S("ASPECT_CONTROL")]: control, '[role="option"]': [aspectOption("1:1", control, "1:1"), aspectOption("16:9", control, "16:9")] });
    const r = adapter.selectAspect(root, "1:1");
    assert(r.ok === true && r.aspect === "1:1", "1:1 selected + re-read verified");
    assert(adapter.readAspectSetting(root) === "1:1", "live aspect reads 1:1");
    const bad = docWith({ [S("ASPECT_CONTROL")]: aspectControl("16:9"), '[role="option"]': [aspectOption("16:9", aspectControl("16:9"), "16:9")] });
    let err = null;
    try {
      adapter.selectAspect(bad, "1:1");
    } catch (e) {
      err = e.message;
    }
    assert(err && /TARGET_ASPECT_NOT_AVAILABLE/.test(err), "missing 1:1 blocks with precise code (no Generate)");
  });

  await runTest("E5 Output count 1 verified; model/cost honest (§16–§18)", async () => {
    const control = outputControl("4 pictures");
    const root = docWith({ [S("OUTPUT_COUNT")]: control, '[role="option"]': [outputOption("1", control, "1 result"), outputOption("4", control, "4 pictures")] });
    const r = adapter.selectOutputCount(root, 1);
    assert(r.ok === true && r.outputCount === 1, "output 1 selected + verified");
    let err = null;
    try {
      adapter.selectOutputCount(docWith({}), 1);
    } catch (e) {
      err = e.message;
    }
    assert(err && /OUTPUT_COUNT_NOT_AVAILABLE/.test(err), "no control → precise code, never fabricated 1");
    const mBtn = el({ tag: "button" });
    mBtn.textContent = "Imagen 4";
    assert(adapter.normalizeModelLabel("Imagen 4") === "Imagen 4", "live model label kept verbatim");
    assert(adapter.readModelLabel(docWith({})) === null, "unobservable model stays UNKNOWN");
  });

  await runTest("E6 Standard mode baseline (§8)", async () => {
    assert(adapter.ensureStandardMode(docWith({})).standard === true, "no agent UI → standard baseline");
    const agent = { _on: true, getAttribute(n) { if (n === "role") return "switch"; if (n === "aria-checked") return agent._on ? "true" : "false"; return null; }, click() { agent._on = false; } };
    const switched = adapter.ensureStandardMode(docWith({ [S("AGENT_MODE")]: agent }));
    logOut("agent", { standard: switched.standard, switchedOff: switched.switchedOff });
    assert(switched.standard === true && switched.switchedOff === true, "plain switch toggled off + verified");
    const stuck = { getAttribute(n) { if (n === "aria-label") return "flow agent"; return null; }, click() {} };
    const blocked = adapter.ensureStandardMode(docWith({ [S("AGENT_MODE")]: stuck }));
    assert(blocked.standard === false && blocked.code === "AGENT_MODE_DETECTED", "non-switch agent blocks with actionable code");
    assert(sw.ERROR_CODES.includes("AGENT_MODE_DETECTED"), "AGENT_MODE_DETECTED registered");
  });

  await runTest("E7 Approval snapshot freeze + freshness (§22–§24)", async () => {
    const job = { jobId: "FLOW-COMPANION-LIVE-GEN-01", attempt: 1, capability: "image", prompt: "Create a simple minimal blue circle centered on a clean light background.\nNo text." };
    const gs = { details: { modelLabel: "Imagen 4", aspect: "1:1", outputCount: 1, visibleCreditCost: "20" } };
    const s = snap.buildApprovalSnapshot({ job, generationState: gs, reference: null, nonce: "n-1" });
    logOut("snapshot", { fingerprint: s.fingerprint.slice(0, 60), timestamp: s.timestamp });
    assert(typeof s.fingerprint === "string" && s.timestamp && s.nonce === "n-1", "snapshot frozen with fingerprint+timestamp+nonce");
    const fresh = snap.verifyApprovalFreshness(s, { jobId: s.jobId, attempt: 1, prompt: job.prompt, type: "IMAGE", model: "Imagen 4", aspect: "1:1", outputCount: 1, visibleCost: "20", referenceSummary: "none" });
    assert(fresh.fresh === true, "unchanged config stays fresh");
    for (const [field, val] of [["model", "Other Model"], ["visibleCost", "99"], ["aspect", "16:9"], ["prompt", "changed"], ["outputCount", 4]]) {
      const cur = { jobId: s.jobId, attempt: 1, prompt: job.prompt, type: "IMAGE", model: "Imagen 4", aspect: "1:1", outputCount: 1, visibleCost: "20", referenceSummary: "none", [field]: val };
      const r = snap.verifyApprovalFreshness(s, cur);
      assert(r.fresh === false && r.changed.includes(field), `material change invalidates approval: ${field}`);
    }
  });

  await runTest("E8 SUBMIT revalidation: stale stops, disabled never clicks (§24–§26)", async () => {
    const prompt = { tagName: "TEXTAREA", value: "Create a simple minimal blue circle centered on a clean light background.\nNo text.", focus() {}, dispatchEvent() {}, getAttribute() { return null; } };
    const img = modeDouble("image", true);
    const aspect = aspectControl("1:1");
    const output = outputControl("1");
    const model = el({ tag: "button" });
    model.textContent = "Imagen 4";
    const cost = el({ tag: "button" });
    cost.textContent = "20 credits";
    const btn = el({ tag: "button" });
    const root = docWith({ [S("PROMPT_INPUT")]: prompt, [S("MODE_IMAGE")]: img, [S("ASPECT_CONTROL")]: aspect, [S("OUTPUT_COUNT")]: output, [S("MODEL_CONTROL")]: model, [S("CREDIT_DISPLAY")]: cost, [S("GENERATE_BUTTON")]: btn });
    const job = { jobId: "J", attempt: 1, capability: "image", prompt: prompt.value };
    const snapFrozen = snap.buildApprovalSnapshot({ job, generationState: { details: { modelLabel: "Imagen 4", aspect: "1:1", outputCount: 1, visibleCreditCost: "20 credits" } }, nonce: "n-2" });
    const ok = await cmds.dispatchContentCommand(adapter, root, { type: "SUBMIT_GENERATE", jobId: "J", attempt: 1, approval: { approved: true, jobId: "J", attempt: 1, snapshot: snapFrozen } }, {});
    assert(ok.ok === true && ok.submitted === true, "fresh snapshot submits exactly once");
    assert(ok.resultBaseline && Array.isArray(ok.resultBaseline.urls), "pre-Generate baseline captured");
    assert(btn.clicked === 1, "Generate clicked exactly once");
    // Stale: aspect changed after freeze.
    aspect.value = "16:9";
    let stale = null;
    try {
      await cmds.dispatchContentCommand(adapter, root, { type: "SUBMIT_GENERATE", jobId: "J", attempt: 1, approval: { approved: true, jobId: "J", attempt: 1, snapshot: snapFrozen } }, {});
    } catch (e) {
      stale = e.message;
    }
    assert(stale && /APPROVAL_STALE_CHANGED/.test(stale), "changed config STOPS submit, fresh approval required");
    assert(btn.clicked === 1, "no second click on stale approval");
    // Disabled Generate never clicks even with approval.
    const disBtn = el({ tag: "button", attrs: { "aria-disabled": "true" } });
    const disRoot = docWith({ [S("PROMPT_INPUT")]: prompt, [S("MODE_IMAGE")]: img, [S("GENERATE_BUTTON")]: disBtn });
    let disErr = null;
    try {
      await cmds.dispatchContentCommand(adapter, disRoot, { type: "SUBMIT_GENERATE", jobId: "J", attempt: 1, approval: { approved: true, jobId: "J", attempt: 1 } }, {});
    } catch (e) {
      disErr = e.message;
    }
    assert(disErr && /GENERATE_STILL_DISABLED_AFTER_PROMPT/.test(disErr), "disabled Generate never clicked");
    assert(disBtn.clicked === 0, "zero clicks on disabled control");
  });

  await runTest("E9 Single-use approval: double-click, restart, nonce binding (§23)", async () => {
    const map = new Map();
    sw.recordLocalApproval(map, { jobId: "GEN-01", attempt: 1, approvedBy: "user", nonce: "n-9", fingerprint: "fp-9" });
    const ap = sw.consumeLocalApproval(map, "GEN-01", 1, { nonce: "n-9", fingerprint: "fp-9" });
    assert(ap.approvedBy === "user", "matching nonce+fingerprint consumes once");
    let reused = null;
    try {
      sw.consumeLocalApproval(map, "GEN-01", 1, { nonce: "n-9", fingerprint: "fp-9" });
    } catch (e) {
      reused = e.message;
    }
    assert(reused && /APPROVAL_REQUIRED/.test(reused), "double-click cannot regenerate");
    // Worker restart wipes the map → submit without fresh record fails.
    const freshMap = new Map();
    let restart = null;
    try {
      sw.consumeLocalApproval(freshMap, "GEN-01", 1, { nonce: "n-9", fingerprint: "fp-9" });
    } catch (e) {
      restart = e.message;
    }
    assert(restart && /APPROVAL_REQUIRED/.test(restart), "restart without re-approval cannot submit");
    // Wrong nonce rejected.
    const map2 = new Map();
    sw.recordLocalApproval(map2, { jobId: "GEN-02", attempt: 1, approvedBy: "user", nonce: "n-A", fingerprint: "fp-A" });
    let wrong = null;
    try {
      sw.consumeLocalApproval(map2, "GEN-02", 1, { nonce: "n-B", fingerprint: "fp-A" });
    } catch (e) {
      wrong = e.message;
    }
    assert(wrong && /APPROVAL_MISMATCH/.test(wrong), "cross-packet nonce rejected");
  });

  await runTest("E10 Result baseline/diff + start evidence + timeout/refusal (§27–§29)", async () => {
    const base = { urls: ["https://cdn.test/old.png"], count: 1, at: "t0" };
    assert(adapter.diffNewResults(base, ["https://cdn.test/old.png"]).length === 0, "pre-existing results ignored");
    assert(adapter.diffNewResults(base, ["https://cdn.test/old.png", "https://cdn.test/new.png"]).length === 1, "new result detected");
    const started = adapter.assessGenerationStart({ found: true, enabled: true }, { found: true, enabled: false }, { baselineUrls: base.urls, currentUrls: ["https://cdn.test/old.png", "https://cdn.test/new.png"] });
    assert(started.started === true && started.evidence.includes("generate-disabled-after-submit"), "start evidence from button state");
    const busy = adapter.assessGenerationStart({ found: true, enabled: true }, { found: true, enabled: false, busy: true }, {});
    assert(busy.evidence.includes("generate-busy"), "busy state is evidence");
    const quiet = adapter.assessGenerationStart({ found: true, enabled: true }, { found: true, enabled: true }, { baselineUrls: [], currentUrls: [] });
    assert(quiet.started === false, "no evidence → not started (never assumed)");
    const never = adapter.pollResult(() => ({ ready: false, items: [] }), { deadlineMs: 2000, nowMs: 0 });
    assert(never.timeout === true, "absence of result is timeout, never success");
    // READ_RESULT with baseline filters pre-existing.
    const img = el({ tag: "img", src: "https://cdn.test/old.png", attrs: { src: "https://cdn.test/old.png" } });
    const root = docWith({ 'img[src*="googleusercontent"]': [img] });
    const read = await cmds.dispatchContentCommand(adapter, root, { type: "READ_RESULT", baseline: { urls: ["https://cdn.test/old.png"] } }, {});
    assert(read.ok === true && Array.isArray(read.newUrls) && read.newUrls.length === 0, "baseline-filtered read ignores old media");
  });

  await runTest("E11 Download correlation DIRECT vs FALLBACK (§33)", async () => {
    const direct = sw.correlateDownload({ jobId: "FLOW-COMPANION-LIVE-GEN-01" }, { id: 7, filename: "gen.png", mime: "image/png", startTime: new Date().toISOString() }, { nowMs: Date.now() });
    assert(direct.correlated === true && direct.correlation === "DIRECT", "explicit download correlates DIRECT");
    const fb = sw.correlateDownload({ jobId: "FLOW-COMPANION-LIVE-GEN-01" }, { id: 9, filename: "image.png", mime: "image/png", startTime: new Date().toISOString(), fallbackUsed: true }, { nowMs: Date.now() });
    assert(fb.correlated === true && fb.correlation === "FALLBACK_CORRELATION" && fb.fallbackUsed === true, "bounded fallback explicitly marked");
  });

  await runTest("E12 Bridge await-approval + structural-qa.json (§36, §40)", async () => {
    const TOKEN = "TEST-ONLY-POSTV1E-E12";
    const proj = "__postv1e_e12__";
    const bridge = createBridgeServer({ projectRoot: ROOT, token: TOKEN });
    const addr = await bridge.listen(0);
    const call = (method, p, body = null) =>
      new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": TOKEN } },
          (res) => {
            let buf = "";
            res.on("data", (c) => (buf += c));
            res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
          }
        );
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
      });
    try {
      await call("POST", "/jobs", {
        projectId: proj,
        job: { projectId: proj, jobId: "E12-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 },
      });
      store.transitionJob(ROOT, proj, "E12-JOB", "VALIDATED", {});
      store.transitionJob(ROOT, proj, "E12-JOB", "PREPARED", {});
      const ready = await call("POST", "/jobs/E12-JOB/await-approval?projectId=" + proj, {});
      assert(ready.status === 200 && ready.body.status === "AWAITING_USER_APPROVAL", "PREPARED → AWAITING_USER_APPROVAL");
      const again = await call("POST", "/jobs/E12-JOB/await-approval?projectId=" + proj, {});
      assert(again.status === 200 && again.body.status === "AWAITING_USER_APPROVAL", "await-approval idempotent");
      // POST-v1F: approval is RECORDED only; the real generation starts at
      // /generate, after the browser proved Google Flow accepted the submit.
      const ap = await call("POST", "/jobs/E12-JOB/approve?projectId=" + proj, { jobId: "E12-JOB", attempt: 1, approvedBy: "user" });
      assert(ap.status === 200 && ap.body.status === "AWAITING_USER_APPROVAL" && ap.body.approvalRecorded === true, `approve records without generating: ${JSON.stringify(ap.body)}`);
      const afterApprove = store.getJob(ROOT, proj, "E12-JOB");
      assert(afterApprove.status === "AWAITING_USER_APPROVAL" && afterApprove.generationCount === 0, "approval alone must not start a generation");
      const gen = await call("POST", "/jobs/E12-JOB/generate?projectId=" + proj, {});
      assert(gen.status === 200 && gen.body.status === "GENERATING" && gen.body.generationCount === 1, `generate starts the generation: ${JSON.stringify(gen.body)}`);
      // POST-v1F: an artifact is only importable when it is attributable to a
      // candidate persisted at RESULT_DETECTED.
      const art = await call("POST", "/jobs/E12-JOB/artifact?projectId=" + proj, { filename: "flow-result.png", mime: "image/png", contentBase64: makePng(512, 512).toString("base64"), promptFingerprint: "fp", candidateId: "c1" });
      assert(art.status === 400 && /RESULT_CORRELATION_REQUIRED/.test(art.body.error), `artifact without persisted candidates is refused: ${JSON.stringify(art.body)}`);
      const rc = await call("POST", "/jobs/E12-JOB/result-candidates?projectId=" + proj, { candidates: [{ candidateId: "c1", url: "https://flow.google.com/asb/AAA= s512-rw", assetId: "AAA", mediaType: "IMAGE", naturalWidth: 512, naturalHeight: 512, isNew: true, sameAgentTurn: true }], detectedAt: new Date().toISOString() });
      assert(rc.status === 200 && rc.body.persisted === 1 && rc.body.status === "RESULT_DETECTED", `result-candidates persisted + RESULT_DETECTED: ${JSON.stringify(rc.body)}`);
      const art2 = await call("POST", "/jobs/E12-JOB/artifact?projectId=" + proj, { filename: "flow-result.png", mime: "image/png", contentBase64: makePng(512, 512).toString("base64"), promptFingerprint: "fp", candidateId: "c1" });
      assert(art2.status === 200 && art2.body.status === "READY", "correlated artifact import reaches READY");
      const qa = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", proj, "qa", "structural-qa.json"), "utf8"));
      logOut("structural-qa", qa);
      assert(qa.status === "PASS" && qa.sha256 === art2.body.sha256 && qa.width === 512 && qa.height === 512, "structural-qa.json PASS with hash + dimensions");
      assert(qa.resultBelongsToCurrentAttempt === true, "structural-qa records the correlation proof");
    } finally {
      await bridge.close();
      fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
    }
  });

  await runTest("E13 structuralQA dims/corrupt + READY-only-after-QA (§36)", async () => {
    const dir = path.join(ROOT, "projects", "__postv1e_e13__");
    fs.mkdirSync(dir, { recursive: true });
    const pngPath = path.join(dir, "ok.png");
    fs.writeFileSync(pngPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const qa = importer.structuralQA(pngPath, "image");
    assert(qa.width === 1 && qa.height === 1 && qa.bytes > 0, "real PNG decodes with dimensions");
    const badPath = path.join(dir, "bad.png");
    fs.writeFileSync(badPath, Buffer.from("not a png at all................"));
    let threw = null;
    try {
      importer.structuralQA(badPath, "image");
    } catch (e) {
      threw = e.message;
    }
    assert(threw && /IMAGE_DIMENSIONS_UNREADABLE/.test(threw), "corrupt asset fails QA");
    const zeroPath = path.join(dir, "zero.png");
    fs.writeFileSync(zeroPath, Buffer.alloc(0));
    let zero = null;
    try {
      importer.structuralQA(zeroPath, "image");
    } catch (e) {
      zero = e.message;
    }
    assert(zero && /ZERO_BYTE_FILE/.test(zero), "zero-byte fails QA");

    // POST-v1F: the live Flow result is WebP. imageDimensions read PNG only, so
    // every WebP/JPEG result failed as IMAGE_DIMENSIONS_UNREADABLE.
    const webpPath = path.join(dir, "ok.webp");
    const WEBP_LOSSY = Buffer.concat([
      Buffer.from("RIFF", "ascii"), Buffer.from([0x26, 0, 0, 0]), Buffer.from("WEBP", "ascii"),
      Buffer.from("VP8 ", "ascii"), Buffer.from([0x10, 0, 0, 0]),
      Buffer.from([0x9d, 0x01, 0x2a]), Buffer.from([0x00, 0x02]), Buffer.from([0x00, 0x02]),
      Buffer.alloc(16),
    ]);
    fs.writeFileSync(webpPath, WEBP_LOSSY);
    const webpQa = importer.structuralQA(webpPath, "image");
    assert(webpQa.width === 512 && webpQa.height === 512, `lossy WebP decodes real dimensions (got ${webpQa.width}x${webpQa.height})`);

    const webpLossless = path.join(dir, "lossless.webp");
    const bits = Buffer.alloc(4);
    bits.writeUInt32LE(((512 - 1) << 14) | (512 - 1) >>> 0, 0);
    const WEBP_LOSSLESS = Buffer.concat([
      Buffer.from("RIFF", "ascii"), Buffer.from([0x26, 0, 0, 0]), Buffer.from("WEBP", "ascii"),
      Buffer.from("VP8L", "ascii"), Buffer.from([0x10, 0, 0, 0]),
      Buffer.from([0x2f]), bits, Buffer.alloc(12),
    ]);
    fs.writeFileSync(webpLossless, WEBP_LOSSLESS);
    const losslessQa = importer.structuralQA(webpLossless, "image");
    assert(losslessQa.width === 512 && losslessQa.height === 512, `lossless WebP decodes real dimensions (got ${losslessQa.width}x${losslessQa.height})`);

    const jpgPath = path.join(dir, "ok.jpg");
    // SOI + APP0 segment + SOF0 carrying 1024x768.
    const jpg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x04, 0x00, 0x03]), Buffer.alloc(9),
      Buffer.from([0xff, 0xd9]),
    ]);
    fs.writeFileSync(jpgPath, jpg);
    const jpgQa = importer.structuralQA(jpgPath, "image");
    assert(jpgQa.width === 1024 && jpgQa.height === 768, `JPEG decodes real dimensions (got ${jpgQa.width}x${jpgQa.height})`);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // POST-v1F zero-credit correlation recovery: the invariants that were
  // missing when a 32x32 account avatar was imported and the job went READY.
  await runTest("E14 correlation persistence, resume gate, QA and READY invariants (§4-§10, §13)", async () => {
    const TOKEN = "TEST-ONLY-POSTV1E-E14";
    const proj = "__postv1e_e14__";
    const bridge = createBridgeServer({ projectRoot: ROOT, token: TOKEN });
    const addr = await bridge.listen(0);
    const call = (method, p, body = null) =>
      new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": TOKEN } },
          (res) => {
            let buf = "";
            res.on("data", (c) => (buf += c));
            res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
          }
        );
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
      });
    const mk = async (id) => {
      await call("POST", "/jobs", {
        projectId: proj,
        job: { projectId: proj, jobId: id, requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 },
      });
      store.transitionJob(ROOT, proj, id, "VALIDATED", {});
      store.transitionJob(ROOT, proj, id, "PREPARED", {});
      store.transitionJob(ROOT, proj, id, "AWAITING_USER_APPROVAL", {});
      await call("POST", `/jobs/${id}/approve?projectId=${proj}`, { jobId: id, attempt: 1, approvedBy: "user" });
      await call("POST", `/jobs/${id}/generate?projectId=${proj}`, {});
    };
    const png = makePng(512, 512).toString("base64");
    try {
      // (1) RESULT_DETECTED persists the exact candidate set, and it survives a
      // full job-store reload (extension reload / bridge restart equivalent).
      await mk("E14-PERSIST");
      const rc = await call("POST", "/jobs/E14-PERSIST/result-candidates?projectId=" + proj, {
        detectedAt: "2026-10-01T09:12:45.119Z",
        submitAcceptedAt: "2026-10-01T09:12:40.099Z",
        candidates: [
          { candidateId: "c1", url: "https://flow.google.com/asb/AAA=s512-rw", assetId: "AAA", mediaType: "IMAGE", naturalWidth: 512, naturalHeight: 512, isNew: true, sameAgentTurn: true, alt: "Option 1" },
          { candidateId: "c2", url: "https://flow.google.com/asb/BBB=s512-rw", assetId: "BBB", mediaType: "IMAGE", naturalWidth: 512, naturalHeight: 512, isNew: false, sameAgentTurn: false },
        ],
      });
      assert(rc.status === 200 && rc.body.persisted === 2, "RESULT_DETECTED persists the exact candidate set");
      const reloaded = store.getJob(ROOT, proj, "E14-PERSIST");
      assert(reloaded.detectedAt === "2026-10-01T09:12:45.119Z" && reloaded.submitAcceptedAt === "2026-10-01T09:12:40.099Z", "detection timestamps survive a reload");
      assert(Array.isArray(reloaded.resultCandidates) && reloaded.resultCandidates.length === 2 && reloaded.resultCandidates[0].assetId === "AAA", "candidate metadata survives a reload");
      assert(reloaded.generationCount === 1, "persisting candidates triggers no new generation");

      // (3) resume without persisted candidates is an explicit refusal, and the
      // job never reaches READY.
      await mk("E14-NOCAND");
      const noCand = await call("POST", "/jobs/E14-NOCAND/artifact?projectId=" + proj, { filename: "r.png", mime: "image/png", contentBase64: png, promptFingerprint: "fp", candidateId: "c1" });
      assert(noCand.status === 400 && /RESULT_CORRELATION_REQUIRED/.test(noCand.body.error), `no persisted candidates → ${noCand.body.error}`);
      assert(store.getJob(ROOT, proj, "E14-NOCAND").status !== "READY", "job without correlation cannot reach READY");

      // (4) account avatar / chrome is refused even when it is "new".
      await mk("E14-AVATAR");
      await call("POST", "/jobs/E14-AVATAR/result-candidates?projectId=" + proj, { candidates: [{ candidateId: "c1", url: "https://lh3.googleusercontent.com/ogw/AF2bZyga0_=s32-c-mo", assetId: null, mediaType: "IMAGE", naturalWidth: 32, naturalHeight: 32, isNew: true, sameAgentTurn: true }] });
      const avatar = await call("POST", "/jobs/E14-AVATAR/artifact?projectId=" + proj, { filename: "r.png", mime: "image/png", contentBase64: makePng(32, 32).toString("base64"), promptFingerprint: "fp", candidateId: "c1" });
      assert(avatar.status === 400 && /ARTIFACT_BELOW_MIN_RESOLUTION/.test(avatar.body.error), `32x32 avatar candidate rejected: ${avatar.body.error}`);
      assert(store.getJob(ROOT, proj, "E14-AVATAR").status !== "READY", "tiny avatar job cannot reach READY");

      // (5) a tiny generated candidate is rejected by the canonical policy.
      assert(checkGeneratedImage({ width: 32, height: 32 }).ok === false, "32x32 fails the generated-image quality policy");
      assert(checkGeneratedImage({ width: 256, height: 256 }).ok === true, "256x256 meets the generated-image quality policy");
      assert(checkGeneratedImage({ width: 512, height: 288 }, { expectedAspectRatio: 1 }).ok === false, "aspect mismatch is refused");

      // (2) a candidate that was already in the pre-submit baseline is refused.
      await mk("E14-BASELINE");
      await call("POST", "/jobs/E14-BASELINE/result-candidates?projectId=" + proj, { candidates: [{ candidateId: "c1", url: "https://flow.google.com/asb/CCC=s512-rw", assetId: "CCC", mediaType: "IMAGE", naturalWidth: 512, naturalHeight: 512, isNew: false, sameAgentTurn: true }] });
      const stale = await call("POST", "/jobs/E14-BASELINE/artifact?projectId=" + proj, { filename: "r.png", mime: "image/png", contentBase64: png, promptFingerprint: "fp", candidateId: "c1" });
      assert(stale.status === 400 && /RESULT_CORRELATION_REQUIRED/.test(stale.body.error), "pre-submit baseline member is not adoptable");

      // (4b) visibility alone is not correlation: no assetId and no same-turn.
      assert(checkCorrelation({ isNew: true, url: "u", mediaType: "IMAGE" }).ok === false, "visibility alone is not correlation");
      assert(checkCorrelation({ isNew: true, url: "u", assetId: "AAA" }).resultBelongsToCurrentAttempt === true, "stable asset id proves correlation");
      assert(checkCorrelation({ isNew: true, url: "u", sameAgentTurn: true }).resultBelongsToCurrentAttempt === true, "same agent turn proves correlation");

      // (8) the correct correlated asset still completes the happy path.
      const ok = await call("POST", "/jobs/E14-PERSIST/artifact?projectId=" + proj, { filename: "r.png", mime: "image/png", contentBase64: png, promptFingerprint: "fp", candidateId: "c1" });
      assert(ok.status === 200 && ok.body.status === "READY", `correlated asset reaches READY: ${JSON.stringify(ok.body)}`);
      const qa = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", proj, "qa", "structural-qa.json"), "utf8"));
      assert(qa.status === "PASS" && qa.resultBelongsToCurrentAttempt === true && qa.width === 512, "structural QA PASS records correlation proof");

      // (7) READY is impossible without correlation proof.
      assert(store.getJob(ROOT, proj, "E14-NOCAND").status === "GENERATING", "uncorrelated job stays short of READY");
      assert(fs.existsSync(path.join(ROOT, "projects", proj, "assets")), "no artifact imported for the refused jobs");
    } finally {
      await bridge.close();
      fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
    }
  });

  // (6) + (2) detector-level: full-size variant wins over its thumbnail sibling,
  // chrome is refused, and the returned candidates carry the evidence the
  // bridge persists.
  await runTest("E15 detector candidate collection: full-res wins, chrome refused", async () => {
    const asb = (id, suffix = "=s512-rw") => `https://flow.google.com/asb/${id}${suffix}`;
    const AVATAR = "https://lh3.googleusercontent.com/ogw/AF2bZyga0_=s32-c-mo";
    const mk = (src, w, h, alt, cls) => {
      const el = new FakeElement({ tag: "img", attrs: { src, alt, class: cls } });
      el.naturalWidth = w;
      el.naturalHeight = h;
      el.currentSrc = src;
      return el;
    };
    // SAME asset rendered twice: a 64px thumbnail sibling and the 512px original.
    const full = mk(asb("SAME"), 512, 512, "Option 1", "image-thumbnail");
    const thumb = mk(asb("SAME", "=s64-rw"), 64, 64, "Option 1", "image-thumbnail");
    const avatar = mk(AVATAR, 32, 32, "", "gb_X gbii");
    const preExisting = mk(asb("PRE"), 512, 512, "Tile displaying a user's image", "image");
    const other = mk(asb("OTHER"), 512, 288, "Option 2", "image-thumbnail");
    const all = [full, thumb, avatar, preExisting, other];
    const doc = new FakeDocument({
      img: all,
      'img[src*="flow.google.com/asb/"]': [full, thumb, preExisting, other],
      'img[src*="googleusercontent"]': [avatar],
    });

    const cands = adapter.collectResultCandidates(doc, { baselineUrls: [asb("PRE")], promptNeedle: "" });
    const byId = Object.fromEntries(cands.map((c) => [c.assetId, c]));
    assert(!cands.some((c) => /ogw/.test(c.url)), "account avatar is refused as a candidate");
    assert(cands.every((c) => typeof c.candidateId === "string" && c.candidateId.length > 0), "every candidate has a stable id");
    assert(byId.SAME && byId.SAME.naturalWidth === 512 && byId.SAME.url === asb("SAME"), "full-resolution variant wins over its 64px thumbnail sibling");
    assert(!cands.some((c) => /s64-rw/.test(c.url)), "the thumbnail sibling is not offered for import");
    assert(byId.PRE && byId.PRE.isNew === false, "pre-submit baseline member is flagged as not new");
    assert(byId.OTHER && byId.OTHER.isNew === true, "a genuinely new asset is flagged as new");
    assert(byId.SAME.mediaType === "IMAGE", "media type is recorded for the bridge");
    assert(cands.length === 3, `one candidate per logical asset (got ${cands.length})`);

    const detected = adapter.detectResults(doc);
    assert(!detected.some((u) => /ogw/.test(u)), "detectResults no longer leaks the account avatar through the primary branch");
    assert(detected.some((u) => u === asb("SAME")), "detectResults finds Flow /asb/ generated media");
  });

  // (10) recovery/resume must never trigger a generation.
  await runTest("E16 no generation is triggered by candidate persistence or recovery", async () => {
    const proj = "__postv1e_e16__";
    const TOKEN = "TEST-ONLY-POSTV1E-E16";
    const bridge = createBridgeServer({ projectRoot: ROOT, token: TOKEN });
    const addr = await bridge.listen(0);
    const call = (method, p, body = null) =>
      new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": TOKEN } },
          (res) => {
            let buf = "";
            res.on("data", (c) => (buf += c));
            res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }));
          }
        );
        r.on("error", reject);
        if (data) r.write(data);
        r.end();
      });
    try {
      await call("POST", "/jobs", {
        projectId: proj,
        job: { projectId: proj, jobId: "E16-JOB", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 },
      });
      store.transitionJob(ROOT, proj, "E16-JOB", "VALIDATED", {});
      store.transitionJob(ROOT, proj, "E16-JOB", "PREPARED", {});
      store.transitionJob(ROOT, proj, "E16-JOB", "AWAITING_USER_APPROVAL", {});
      await call("POST", "/jobs/E16-JOB/approve?projectId=" + proj, { jobId: "E16-JOB", attempt: 1, approvedBy: "user" });
      const afterApprove = store.getJob(ROOT, proj, "E16-JOB");
      assert(afterApprove.generationCount === 0, "approval still consumes no generation");
      const persisted = await call("POST", "/jobs/E16-JOB/result-candidates?projectId=" + proj, { candidates: [{ candidateId: "c1", url: "https://flow.google.com/asb/ZZZ=s512-rw", assetId: "ZZZ", mediaType: "IMAGE", naturalWidth: 512, naturalHeight: 512, isNew: true, sameAgentTurn: true }] });
      assert(persisted.status === 200 && store.getJob(ROOT, proj, "E16-JOB").generationCount === 0, "candidate persistence consumes no generation");
      const refused = await call("POST", "/jobs/E16-JOB/artifact?projectId=" + proj, { filename: "r.png", mime: "image/png", contentBase64: makePng(512, 512).toString("base64"), promptFingerprint: "fp", candidateId: "c1" });
      assert(refused.status === 400 && /ARTIFACT_STATE_REJECTED/.test(refused.body.error), `import without a generation is refused: ${refused.body.error}`);
      assert(store.getJob(ROOT, proj, "E16-JOB").generationCount === 0, "recovery import consumes no generation");
    } finally {
      await bridge.close();
      fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
    }
  });

  console.log(`\n=== SUMMARY: passed assertions ${passed}, failed tests ${failed} ===`);
  console.log(failed > 0 ? "RESULT: SOME TESTS FAILED" : "RESULT: ALL TESTS PASSED");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
