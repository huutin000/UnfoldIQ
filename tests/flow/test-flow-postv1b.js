"use strict";

/**
 * POST-v1B Flow Companion live-automation regression (§25).
 * Fixture/mock + loopback-bridge only. Fixture success ≠ live Flow success.
 * Live statuses (CONTENT_SCRIPT_LIVE_VERIFIED, BRIDGE_LIVE_VERIFIED) require
 * the authenticated-browser run and are reported in the POST-v1B report.
 *
 * Covers:
 *  M1–M4 manifest (exact hosts, no <all_urls>, minimal perms, no cookies)
 *  A1–A3 adapter (fallback→DEGRADED, health contract, no fixed-sleep success)
 *  S1–S3 state machine (approval gate, no silent retry, result/download/import)
 *  B1–B3 bridge (live handshake contract, invalid token rejected, job ack)
 *  D1–D3 download (job correlation, timeout/error, duplicate guard)
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
const sw = require("../../flow-companion/extension/src/background/service-worker.js");
const { FakeDocument, FakeElement } = require("../../flow-companion/extension/tests/mock-dom.js");
const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
const store = require("../../flow-companion/bridge/job-store.js");
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

function el(opts = {}) {
  return new FakeElement(opts);
}

function docWith(map) {
  return new FakeDocument(map);
}

async function main() {
  console.log("=== POST-v1B REGRESSION (§25) ===\n");
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "flow-companion", "extension", "manifest.json"), "utf8"));

  // M1 — exact host matching for both Flow origins.
  await runTest("M1 Exact Flow host matching", async () => {
    const hosts = manifest.host_permissions || [];
    const matches = (manifest.content_scripts || []).flatMap((c) => c.matches || []);
    logOut("hosts", hosts);
    logOut("matches", matches);
    assert(hosts.includes("https://labs.google/fx/*"), "labs.google/fx host permission required");
    assert(hosts.includes("https://flow.google/*"), "flow.google host permission required");
    assert(hosts.includes("https://flow.google.com/*"), "flow.google.com host permission required (live-observed origin)");
    assert(matches.includes("https://labs.google/fx/*"), "labs.google/fx content-script match required");
    assert(matches.includes("https://flow.google/*"), "flow.google content-script match required");
    assert(matches.includes("https://flow.google.com/*"), "flow.google.com content-script match required");
  });

  // M2 — no <all_urls>, no broad hosts.
  await runTest("M2 No broad permissions", async () => {
    const blob = JSON.stringify([manifest.host_permissions, manifest.permissions, manifest.content_scripts]);
    assert(!blob.includes("<all_urls>"), "must not request <all_urls>");
    assert(!/\*:\/\*\/\*/.test(blob), "must not request broad host pattern");
  });

  // M3 — required permissions only (scripting/storage/downloads + sidePanel UI).
  await runTest("M3 Minimal permissions", async () => {
    const perms = manifest.permissions || [];
    for (const p of ["scripting", "storage", "downloads"]) assert(perms.includes(p), `permission ${p} required`);
    for (const p of ["cookies", "webRequest", "declarativeNetRequest", "nativeMessaging"]) {
      assert(!perms.includes(p), `permission ${p} must not be requested`);
    }
    assert(manifest.manifest_version === 3, "manifest_version must be 3");
  });

  // M4 — no cookie access.
  await runTest("M4 No cookie access", async () => {
    const blob = JSON.stringify(manifest);
    assert(!/cookies/i.test(blob), "manifest must not mention cookies");
    const srcFiles = [
      "flow-companion/extension/src/content/flow-page-adapter.js",
      "flow-companion/extension/src/background/service-worker.js",
      "flow-companion/extension/src/ui/sidepanel.js",
    ];
    for (const f of srcFiles) {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      assert(!/document\.cookie|chrome\.cookies/i.test(src), `${f} must not touch cookies`);
    }
  });

  // A1 — selector fallback behavior marks DEGRADED, never silent primary.
  await runTest("A1 Fallback marks DEGRADED", async () => {
    const primary = adapter.SELECTORS.PROMPT_INPUT.selector;
    const fallback = adapter.SELECTORS.PROMPT_INPUT.fallbacks[0];
    const root = docWith({ [fallback]: el({ tag: "textarea", value: "" }) });
    assert(root.querySelector(primary) === null, "primary must be absent in this fixture");
    const found = adapter.queryWithFallback(root, "PROMPT_INPUT");
    logOut("lookup", { matched: found.matchedSelector, fallbackUsed: found.fallbackUsed });
    assert(found.el !== null && found.fallbackUsed === true, "fallback must resolve the control");
    const health = adapter.selectorHealthContract(root, { PROMPT_INPUT: true });
    assert(health.PROMPT_INPUT.status === "DEGRADED", "fallback resolution must be DEGRADED");
    assert(health.PROMPT_INPUT.fallbackUsed === fallback, "fallback selector must be reported");
  });

  // A2 — health contract statuses incl. NOT_APPLICABLE.
  await runTest("A2 Health contract statuses", async () => {
    const root = docWith({});
    const health = adapter.selectorHealthContract(root, { AGENT_MODE: false });
    const statuses = new Set(Object.values(health).map((h) => h.status));
    logOut("statuses", [...statuses]);
    assert(health.AGENT_MODE.status === "NOT_APPLICABLE", "opt-out control must be NOT_APPLICABLE");
    assert(health.PROMPT_INPUT.status === "FAIL", "absent required control must be FAIL");
    for (const h of Object.values(health)) {
      assert(["PASS", "DEGRADED", "FAIL", "NOT_APPLICABLE"].includes(h.status), `status ${h.status} must be in contract`);
      assert(typeof h.primary === "string", "primary selector must be reported");
    }
  });

  // A3 — no fixed-sleep success assumption.
  await runTest("A3 Observable state required", async () => {
    const never = adapter.pollResult(() => ({ ready: false, items: [] }), { deadlineMs: 2000, nowMs: 0 });
    assert(never.timeout === true, "no observable state must be timeout, never success");
    const late = adapter.pollResult((t) => (t >= 2000 ? { ready: true, items: ["blob:x"] } : { ready: false, items: [] }), {
      deadlineMs: 5000,
      nowMs: 0,
    });
    assert(late.found === true, "observable ready state must be honored");
    const obs = await adapter.observeResults(docWith({}), { timeoutMs: 1500 });
    assert(obs.timeout === true, "observeResults without UI change must time out");
  });

  // A4 — dry-run inserts prompt, never clicks Generate.
  await runTest("A4 Dry-run is zero-credit", async () => {
    const S = (k) => adapter.SELECTORS[k].selector;
    const btn = el({ tag: "button" });
    const root = docWith({ [S("PROMPT_INPUT")]: el({ tag: "textarea", value: "" }), [S("GENERATE_BUTTON")]: btn });
    const r = adapter.insertPromptDryRun(root, "UNFOLDIQ Flow Companion live automation dry-run.");
    logOut("dryrun", { inserted: r.inserted, clickedGenerate: r.clickedGenerate, creditsConsumed: r.creditsConsumed });
    assert(r.inserted === true, "prompt must be inserted");
    assert(r.clickedGenerate === false && btn.clicked === 0, "Generate must never be clicked in dry-run");
    assert(r.creditsConsumed === false, "dry-run must consume zero credits");
  });

  // S1 — approval required before GENERATING.
  await runTest("S1 Approval gate", async () => {
    const proj = "__postv1b_s1__";
    const job = store.createJob(ROOT, {
      projectId: proj, jobId: "S1-JOB", requestId: "R", sceneId: "S", capability: "image",
      mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" },
      outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1,
    });
    let threw = null;
    try {
      store.transitionJob(ROOT, proj, "S1-JOB", "VALIDATED", {});
      store.transitionJob(ROOT, proj, "S1-JOB", "PREPARED", {});
      store.transitionJob(ROOT, proj, "S1-JOB", "AWAITING_USER_APPROVAL", {});
      store.transitionJob(ROOT, proj, "S1-JOB", "GENERATING", { actor: "user" });
    } catch (e) {
      threw = e.message;
    }
    logOut("rejection", threw);
    assert(threw && /APPROVAL_REQUIRED/.test(threw), "GENERATING without approval must throw APPROVAL_REQUIRED");
    void job;
    fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
  });

  // S2/S3 + B1–B3 — live bridge handshake contract over loopback.
  await runTest("B1 Bridge live handshake + invalid token rejected + job ack", async () => {
    const TOKEN = "TEST-ONLY-POSTV1B-TOKEN";
    const proj = "__postv1b_b1__";
    const bridge = createBridgeServer({ projectRoot: ROOT, token: TOKEN });
    const addr = await bridge.listen(0);
    const call = (method, p, body = null, token = TOKEN) =>
      new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": token } },
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
      assert(bridge.host === "127.0.0.1", "bridge must bind loopback only");
      const health = await call("GET", "/health");
      assert(health.status === 200 && health.body.ok === true, "health handshake must succeed");
      const badToken = await call("GET", "/health", null, "WRONG-TOKEN");
      assert(badToken.status === 401, "invalid token must be rejected");
      const created = await call("POST", "/jobs", {
        projectId: proj,
        job: {
          projectId: proj, jobId: "B1-JOB", requestId: "R", sceneId: "S", capability: "image",
          mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" },
          outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1,
        },
      });
      assert(created.status === 201, "job create must be acknowledged");
      const fetched = await call("GET", "/jobs/B1-JOB?projectId=" + proj);
      assert(fetched.status === 200 && fetched.body.job.jobId === "B1-JOB", "extension job poll must receive the job");
      logOut("handshake", { health: health.status, created: created.body, fetched: fetched.body.job.jobId });
    } finally {
      await bridge.close();
      fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
    }
  });

  // D1 — download correlation to job.
  await runTest("D1 Download correlated to job", async () => {
    const r = sw.correlateDownload(
      { jobId: "FLOW-COMPANION-LIVE-GEN-01" },
      { id: 7, filename: "gen.png", mime: "image/png", startTime: new Date().toISOString() },
      { nowMs: Date.now() }
    );
    logOut("correlation", r);
    assert(r.correlated === true && r.jobId === "FLOW-COMPANION-LIVE-GEN-01", "download must correlate to job");
    assert(r.downloadId === 7, "download ID must be recorded");
  });

  // D2 — stale/MIME download not correlated.
  await runTest("D2 Download timeout/error path", async () => {
    const stale = sw.correlateDownload(
      { jobId: "J" },
      { id: 1, filename: "old.png", mime: "image/png", startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      { nowMs: Date.now() }
    );
    assert(stale.correlated === false && stale.code === "DOWNLOAD_STALE", "stale download must not correlate");
    const badMime = sw.correlateDownload(
      { jobId: "J" },
      { id: 2, filename: "notes.txt", mime: "text/plain", startTime: new Date().toISOString() },
      { nowMs: Date.now() }
    );
    assert(badMime.correlated === false, "MIME mismatch must not correlate");
    const missing = sw.correlateDownload({ jobId: "J" }, null);
    assert(missing.correlated === false && missing.code === "DOWNLOAD_NOT_FOUND", "missing download must report NOT_FOUND");
  });

  // D3 — duplicate result guard.
  await runTest("D3 Duplicate result guard", async () => {
    const seen = new Set(["blob:one"]);
    const r = adapter.filterNewResults("J1", ["blob:one", "blob:two"], seen);
    logOut("fresh", r.fresh);
    assert(r.fresh.length === 1 && r.fresh[0] === "blob:two", "only unseen URLs must be reported");
    const again = adapter.filterNewResults("J1", ["blob:two"], r.seen);
    assert(again.fresh.length === 0, "re-delivery of the same URL must be suppressed");
  });

  // E1 — error classification is precise, never collapsed to manual-assist.
  await runTest("E1 Precise error classification", async () => {
    const e = sw.classifyError("RESULT_TIMEOUT", "no result card within 120s");
    assert(e.code === "RESULT_TIMEOUT" && e.manualAssistFallback === false, "diagnostic category must stay precise");
    let threw = false;
    try {
      sw.classifyError("MANUAL_ASSIST_REQUIRED");
    } catch {
      threw = true;
    }
    assert(threw, "manual assist must not be accepted as an error category");
  });

  // L1 — content commands: unknown command rejected, approval enforced.
  await runTest("L1 Content command validation", async () => {
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    const harness = require("../../flow-companion/harness/mock-flow-page.js");
    let threw = false;
    try {
      await cmds.dispatchContentCommand(adapter, harness.fullPage(), { type: "NOPE" }, {});
    } catch {
      threw = true;
    }
    assert(threw, "unknown command must be rejected");
    const ping = await cmds.dispatchContentCommand(adapter, harness.fullPage(), { type: "PING" }, { extensionVersion: "0.2.0" });
    assert(ping.ok === true && ping.adapterVersion === adapter.ADAPTER_VERSION, "PING must answer with adapter version");
    let approvalThrew = null;
    try {
      await cmds.dispatchContentCommand(adapter, harness.fullPage(), { type: "SUBMIT_GENERATE", jobId: "J", attempt: 1, approval: { approved: false } }, {});
    } catch (e) {
      approvalThrew = e.message;
    }
    assert(approvalThrew && /APPROVAL_REQUIRED/.test(approvalThrew), "SUBMIT without approval must throw");
    let mismatch = null;
    try {
      await cmds.dispatchContentCommand(adapter, harness.fullPage(), { type: "SUBMIT_GENERATE", jobId: "J", attempt: 2, approval: { approved: true, jobId: "J", attempt: 1 } }, {});
    } catch (e) {
      mismatch = e.message;
    }
    assert(mismatch && /APPROVAL_MISMATCH/.test(mismatch), "approval for another attempt must be rejected");
    const submitted = await cmds.dispatchContentCommand(adapter, harness.fullPage(), { type: "SUBMIT_GENERATE", jobId: "J", attempt: 1, approval: { approved: true, jobId: "J", attempt: 1 } }, {});
    assert(submitted.ok === true && submitted.submitted === true, "matching fresh approval must submit");
  });

  // L2 — relay hub resolves replies, times out when tab is silent.
  await runTest("L2 Relay hub request/reply", async () => {
    let sink = null;
    const hub = sw.createRelayHub({ postToTab: (m) => { sink = m; } });
    const p = hub.send({ type: "PING" }, { timeoutMs: 5000 });
    assert(sink && sink.id, "relay must tag an id");
    assert(hub.onReply({ ok: true, id: sink.id, result: { ok: true } }) === true, "matching reply must resolve");
    const out = await p;
    assert(out.ok === true, "resolved value must arrive");
    const hanging = hub.send({ type: "PING" }, { timeoutMs: 50 });
    let timedOut = null;
    try {
      await hanging;
    } catch (e) {
      timedOut = e.message;
    }
    assert(timedOut && /JOB_POLL_FAILED/.test(timedOut), "silent tab must time out, never hang");
  });

  // L3 — local approval is single-use and attempt-bound.
  await runTest("L3 Single-use local approval", async () => {
    const map = new Map();
    sw.recordLocalApproval(map, { jobId: "LJ", attempt: 1, approvedBy: "user" });
    const ap = sw.consumeLocalApproval(map, "LJ", 1);
    assert(ap.approvedBy === "user", "approval must be consumable once");
    let reused = null;
    try {
      sw.consumeLocalApproval(map, "LJ", 1);
    } catch (e) {
      reused = e.message;
    }
    assert(reused && /APPROVAL_REQUIRED/.test(reused), "reused approval must be rejected");
  });

  // L4 — bridge client only speaks loopback.
  await runTest("L4 Bridge URL loopback-only", async () => {
    const bc = require("../../flow-companion/extension/src/background/bridge-client.js");
    assert(bc.normalizeBridgeUrl("http://127.0.0.1:4317/") === "http://127.0.0.1:4317", "loopback URL accepted");
    for (const bad of ["http://192.168.1.10:4317", "https://example.com", "file:///etc/passwd"]) {
      let threw = false;
      try {
        bc.normalizeBridgeUrl(bad);
      } catch {
        threw = true;
      }
      assert(threw, `non-loopback URL must be rejected: ${bad}`);
    }
    assert(bc.actionForJobStatus("GENERATING") === "POLL_RESULT", "GENERATING must map to POLL_RESULT");
    assert(bc.actionForJobStatus("READY") === "DONE", "READY must map to DONE");
  });

  // L5 — artifact endpoint: happy path imports READY with sha256.
  await runTest("L5 Artifact import to READY", async () => {
    const TOKEN = "TEST-ONLY-POSTV1B-ART";
    const proj = "__postv1b_art__";
    const bridge = createBridgeServer({ projectRoot: ROOT, token: TOKEN });
    const addr = await bridge.listen(0);
    const call = (method, p, body = null, token = TOKEN) =>
      new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request(
          { hostname: "127.0.0.1", port: addr.port, path: p, method, headers: { "Content-Type": "application/json", "x-bridge-token": token } },
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
        job: {
          projectId: proj, jobId: "ART-JOB", requestId: "R", sceneId: "S", capability: "image",
          mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" },
          outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1,
        },
      });
      store.transitionJob(ROOT, proj, "ART-JOB", "VALIDATED", {});
      store.transitionJob(ROOT, proj, "ART-JOB", "PREPARED", {});
      store.transitionJob(ROOT, proj, "ART-JOB", "AWAITING_USER_APPROVAL", {});
      store.recordApproval(ROOT, proj, "ART-JOB", { jobId: "ART-JOB", attempt: 1, approvedBy: "user" });
      store.transitionJob(ROOT, proj, "ART-JOB", "GENERATING", { actor: "user" });
      // POST-v1F: an artifact is importable only when attributable to a
      // candidate persisted at RESULT_DETECTED.
      const res = await call("POST", "/jobs/ART-JOB/result-candidates?projectId=" + proj, {
        detectedAt: new Date().toISOString(),
        candidates: [{ candidateId: "c1", url: "https://flow.google.com/asb/ART=s512-rw", assetId: "ART", mediaType: "IMAGE", naturalWidth: 512, naturalHeight: 512, isNew: true, sameAgentTurn: true }],
      });
      assert(res.status === 200 && res.body.persisted === 1, "candidates persisted at RESULT_DETECTED");
      const art = await call("POST", "/jobs/ART-JOB/artifact?projectId=" + proj, {
        filename: "flow-result.png", mime: "image/png", contentBase64: makePng(512, 512).toString("base64"), downloadId: 7, promptFingerprint: "fp", candidateId: "c1",
      });
      logOut("artifact", art.body);
      assert(art.status === 200 && art.body.status === "READY", "valid correlated artifact must reach READY");
      assert(typeof art.body.sha256 === "string" && art.body.sha256.length === 64, "sha256 must be recorded");
      assert((art.body.artifactPath || "").startsWith("assets/image/"), "artifact must land under assets/");
      const job = store.getJob(ROOT, proj, "ART-JOB");
      const states = job.history.map((h) => h.to);
      for (const s of ["RESULT_DETECTED", "DOWNLOADING", "IMPORTED", "READY"]) {
        assert(states.includes(s), `history must include ${s}`);
      }
    } finally {
      await bridge.close();
      fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
    }
  });

  // L6 — artifact endpoint rejects wrong MIME/magic/state.
  await runTest("L6 Artifact rejection paths", async () => {
    const TOKEN = "TEST-ONLY-POSTV1B-ART2";
    const proj = "__postv1b_art2__";
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
        job: {
          projectId: proj, jobId: "ART2-JOB", requestId: "R", sceneId: "S", capability: "image",
          mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" },
          outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1,
        },
      });
      const early = await call("POST", "/jobs/ART2-JOB/artifact?projectId=" + proj, {
        filename: "r.png", mime: "image/png", contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      });
      assert(early.status === 400 && /ARTIFACT_STATE_REJECTED/.test(early.body.error), "artifact before GENERATING must be rejected");
      store.transitionJob(ROOT, proj, "ART2-JOB", "VALIDATED", {});
      store.transitionJob(ROOT, proj, "ART2-JOB", "PREPARED", {});
      store.transitionJob(ROOT, proj, "ART2-JOB", "AWAITING_USER_APPROVAL", {});
      store.recordApproval(ROOT, proj, "ART2-JOB", { jobId: "ART2-JOB", attempt: 1, approvedBy: "user" });
      store.transitionJob(ROOT, proj, "ART2-JOB", "GENERATING", { actor: "user" });
      const badMime = await call("POST", "/jobs/ART2-JOB/artifact?projectId=" + proj, {
        filename: "r.exe", mime: "application/octet-stream", contentBase64: "AAAA",
      });
      assert(badMime.status === 400 && /ARTIFACT_MIME_REJECTED/.test(badMime.body.error), "non-allowlist MIME must be rejected");
      const badMagic = await call("POST", "/jobs/ART2-JOB/artifact?projectId=" + proj, {
        filename: "r.png", mime: "image/png", contentBase64: Buffer.from("hello, not a png file....").toString("base64"),
      });
      assert(badMagic.status === 400 && /ARTIFACT_MAGIC_MISMATCH/.test(badMagic.body.error), "magic mismatch must be rejected");
    } finally {
      await bridge.close();
      fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
    }
  });

  // L7 — constrained text fallback resolves Generate, reported DEGRADED.
  await runTest("L7 Generate text fallback", async () => {
    const { FakeDocument, FakeElement } = require("../../flow-companion/extension/tests/mock-dom.js");
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Generate image" } });
    const root = new FakeDocument({ button: [genBtn] });
    const found = adapter.queryWithFallback(root, "GENERATE_BUTTON");
    assert(found.el !== null && found.fallbackUsed === true, "text fallback must resolve the Generate button");
    assert(String(found.matchedSelector).startsWith("text:"), "text fallback must be labelled, never promoted to primary");
    const health = adapter.selectorHealthContract(root, { GENERATE_BUTTON: true });
    assert(health.GENERATE_BUTTON.status === "DEGRADED", "text-resolved control must be DEGRADED");
    const det = adapter.detectGenerateButton(root);
    assert(det.found === true, "Generate detection must use the fallback");
  });

  // L8 — DOM probe collects metadata only, never user content.
  await runTest("L8 Probe privacy boundary", async () => {
    const { FakeDocument } = require("../../flow-companion/extension/tests/mock-dom.js");
    const attr = (a) => (n) => a[n] || null;
    const secretArea = { tag: "textarea", attrs: { "aria-label": "prompt" }, value: "SECRET-USER-PROMPT-TEXT", getAttribute: attr({ "aria-label": "prompt" }), textContent: "SECRET-USER-PROMPT-TEXT" };
    const media = { tag: "img", attrs: {}, src: "https://secret-media-host/user-image.png", getAttribute: attr({}) };
    const longBtn = { tag: "button", attrs: { "aria-label": "Generate" }, getAttribute: attr({ "aria-label": "Generate" }), textContent: `Generate ${"X".repeat(200)}` };
    const root = new FakeDocument({ textarea: [secretArea], img: [media], button: [longBtn] });
    const probe = adapter.probeCandidateControls(root, { max: 60 });
    const blob = JSON.stringify(probe);
    assert(!blob.includes("SECRET-USER-PROMPT-TEXT"), "probe must never record prompt/textarea content");
    assert(!blob.includes("secret-media-host"), "probe must never record media sources");
    const btnEntry = probe.controls.find((c) => c.tag === "button");
    assert(btnEntry && btnEntry.ariaLabel === "Generate", "probe must record safe aria-labels");
    assert(!btnEntry.label || btnEntry.label.length <= 41, "button labels must be truncated to 40 chars");
    assert(probe.counts.textarea === 1 && probe.counts.img === 1, "probe must report per-selector counts");
  });

  // L10 — REGRESSION: MV3 worker restart must not break dry-run tab resolution.
  // Old bug: Check Flow tab found 1 tab (port map), worker restarted, dry-run
  // trusted the wiped in-memory map → "no Flow tab connected". Canonical fix:
  // every action re-resolves by tabs.query + PING.
  await runTest("L10 Restart-safe live-tab resolution", async () => {
    const resolver = require("../../flow-companion/extension/src/background/tab-resolver.js");
    const liveTab = { id: 42, url: "https://flow.google.com/project/abc", active: true };
    const session = {};
    const mkDeps = ({ tabs = [liveTab], ping = null, reinject = null } = {}) => ({
      tabsQuery: async (patterns) => {
        assert(patterns.includes("https://flow.google.com/*"), "resolver must query the live-observed origin");
        return tabs;
      },
      sendPing: ping || (async () => ({ ok: true, adapterVersion: "0.2.0-postv1b" })),
      sessionGet: async () => session.live || null,
      sessionSet: async (meta) => {
        assert(typeof meta.tabId === "number" && typeof meta.origin === "string", "session stores tab identity only");
        assert(!("token" in meta) && !("cookie" in meta), "session must never hold secrets");
        session.live = meta;
      },
      reinject: reinject || (async () => { throw new Error("unexpected reinject"); }),
      nowMs: () => 0,
    });
    // Restart 1: empty session → QUERY finds the tab, dry-run would proceed.
    const first = await resolver.resolveLiveFlowTab(mkDeps(), {});
    assert(first.tabId === 42 && first.origin === "https://flow.google.com", "query+ping must resolve the live tab");
    assert(first.resolution.source === "QUERY" && first.resolution.pingSuccess === true, "resolution must report QUERY + ping");
    assert(first.resolution.queryMatchedTabs === 1, "one matched tab expected");
    // Restart 2: session hints the tab → revalidated, still no in-memory map.
    const second = await resolver.resolveLiveFlowTab(mkDeps(), {});
    assert(second.tabId === 42 && second.resolution.source === "SESSION_REVALIDATED", "warm session must revalidate by ping");
    // Restart 3: stale session (tab closed, new tab id) → falls back to query.
    session.live = { tabId: 999, origin: "https://flow.google.com" };
    const third = await resolver.resolveLiveFlowTab(mkDeps(), {});
    assert(third.tabId === 42 && third.resolution.source === "QUERY", "stale session must fall back to query, never fail");
    // Receiving-end missing once → single re-inject → success.
    let pings = 0;
    let shots = 0;
    const re = await resolver.resolveLiveFlowTab(mkDeps({
      ping: async () => {
        pings += 1;
        if (pings === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
        return { ok: true };
      },
      reinject: async (tabId) => {
        shots += 1;
        assert(tabId === 42, "re-inject targets the resolved tab only");
      },
    }), {});
    assert(re.resolution.source === "REINJECTED" && shots === 1, "exactly one re-inject, then success");
    // Disallowed tabs never selected; empty query classifies precisely.
    const evil = await resolver.resolveLiveFlowTab(mkDeps({ tabs: [{ id: 1, url: "https://evil.example/", active: true }, liveTab] }), {});
    assert(evil.tabId === 42, "non-allowlisted tabs must be filtered");
    let emptyErr = null;
    try {
      await resolver.resolveLiveFlowTab(mkDeps({ tabs: [] }), {});
    } catch (e) {
      emptyErr = e.message;
    }
    assert(emptyErr && /FLOW_TAB_NOT_FOUND/.test(emptyErr), "no Flow tab must classify FLOW_TAB_NOT_FOUND");
  });

  // L9 — result media fallback (hosted image URL) without primary selector.
  await runTest("L9 Hosted media fallback", async () => {
    const { FakeDocument, FakeElement } = require("../../flow-companion/extension/tests/mock-dom.js");
    const img = new FakeElement({ tag: "img", src: "https://lh3.googleusercontent.com/gen123", attrs: { src: "https://lh3.googleusercontent.com/gen123" } });
    const root = new FakeDocument({ 'img[src*="googleusercontent"]': [img] });
    const urls = adapter.detectResults(root);
    assert(urls.length === 1 && urls[0] === "https://lh3.googleusercontent.com/gen123", "hosted result media must be detected via fallback");
  });

  // ===== READINESS REGRESSIONS R1–R7 (fix FLOW_PAGE_NOT_READY) =====
  // Capability-scoped dry-run readiness: DRY_RUN_READY requires ONLY
  // PROMPT_READY (found + writable) + Generate control FOUND (disabled OK).

  // R1 — optional selectors fail but dry-run is ready.
  await runTest("R1 Optional controls missing, dry-run still ready", async () => {
    // Live-like page: prompt via contenteditable fallback, Generate via
    // button[type=submit] disabled; MODEL/GEN-TYPE/OUTPUT/CREDIT missing.
    const ce = {
      tag: "DIV",
      attrs: { contenteditable: "true" },
      textContent: "",
      focus() {},
      dispatchEvent() {},
      getAttribute(n) {
        return this.attrs[n] || null;
      },
    };
    const btn = new FakeElement({ tag: "button", attrs: { type: "submit", "aria-disabled": "true" } });
    const root = docWith({ '[contenteditable="true"]': ce, 'button[type="submit"]': btn });
    const rd = adapter.assessDryRunReadiness(root);
    logOut("readiness", { promptFound: rd.prompt.found, writable: rd.prompt.writable, genFound: rd.generate.found, genEnabled: rd.generate.enabled, DRY_RUN_READY: rd.DRY_RUN_READY });
    assert(rd.prompt.found === true && rd.prompt.writable === true, "prompt must be PROMPT_READY");
    assert(rd.generate.found === true, "Generate control must be found");
    assert(rd.DRY_RUN_READY === true, "optional-control failures must not block DRY_RUN_READY");
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "INSERT_PROMPT_DRYRUN", prompt: "UNFOLDIQ dry-run readiness probe." }, {});
    logOut("dryrun", { ok: res.ok, verified: res.dryRun && res.dryRun.verified, enabledAfter: res.dryRun && res.dryRun.generateEnabledAfterPrompt });
    assert(res.ok === true, "INSERT_PROMPT_DRYRUN must succeed without optional controls");
    assert(res.dryRun.verified === true, "prompt must be verified in the control");
    assert(res.dryRun.generateEnabledAfterPrompt === false, "disabled-after-prompt must be reported");
    assert(res.dryRun.generateStillDisabledAfterPrompt === "GENERATE_STILL_DISABLED_AFTER_PROMPT", "still-disabled classification must be an observation, not a failure");
  });

  // R2 — Generate disabled BEFORE prompt insertion is not a readiness failure.
  await runTest("R2 Generate disabled before prompt is allowed", async () => {
    const ce = { tag: "DIV", attrs: { contenteditable: "true" }, textContent: "", focus() {}, dispatchEvent() {}, getAttribute(n) { return this.attrs[n] || null; } };
    const btn = new FakeElement({ tag: "button", attrs: { "aria-disabled": "true" } });
    const root = docWith({ '[contenteditable="true"]': ce, 'button[type="submit"]': btn });
    const rd = adapter.assessDryRunReadiness(root);
    assert(rd.DRY_RUN_READY === true, "disabled Generate before prompt must NOT make the page not-ready");
    assert(rd.generate.enabled === false, "disabled state must be observable");
  });

  // R3 — contenteditable prompt populated and verified via ordinary editing.
  await runTest("R3 Contenteditable insert + verify", async () => {
    const ce = { tag: "DIV", attrs: { contenteditable: "true" }, textContent: "", focus() {}, dispatchEvent() {}, getAttribute(n) { return this.attrs[n] || null; } };
    ce.ownerDocument = {
      getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
      createRange: () => ({ selectNodeContents() {} }),
      execCommand: (cmd, _ui, text) => {
        ce.textContent = text; // real browsers mutate the DOM here
        return true;
      },
    };
    const root = docWith({ '[contenteditable="true"]': ce });
    const r = adapter.insertPromptDryRun(root, "Create a simple minimal blue circle on a clean light background.\nNo text.");
    logOut("insert", { method: r.insertMethod, verified: r.verified, text: ce.textContent });
    assert(r.inserted === true && r.insertMethod === "execCommand:insertText", "insert must use ordinary editing semantics");
    assert(r.verified === true, "contenteditable text must verify");
    assert(r.clickedGenerate === false && r.creditsConsumed === false, "dry-run must stay zero-credit");
    // Fallback path (no execCommand): textContent assignment still verifies.
    const ce2 = { tag: "DIV", attrs: { contenteditable: "true" }, textContent: "", focus() {}, dispatchEvent() {}, getAttribute(n) { return this.attrs[n] || null; } };
    const root2 = docWith({ '[contenteditable="true"]': ce2 });
    const r2 = adapter.insertPromptDryRun(root2, "fallback probe");
    assert(r2.insertMethod === "textContent" && r2.verified === true, "textContent fallback must still insert + verify");
  });

  // R4 — dry-run NEVER clicks Generate.
  await runTest("R4 Dry-run never clicks Generate", async () => {
    const btn = new FakeElement({ tag: "button", attrs: { "aria-disabled": "true" } });
    const ce = { tag: "DIV", attrs: { contenteditable: "true" }, textContent: "", focus() {}, dispatchEvent() {}, getAttribute(n) { return this.attrs[n] || null; } };
    const root = docWith({ '[contenteditable="true"]': ce, 'button[type="submit"]': btn });
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "INSERT_PROMPT_DRYRUN", prompt: "no click probe" }, {});
    assert(res.ok === true && res.dryRun.clickedGenerate === false, "evidence must report clickedGenerate=false");
    assert(btn.clicked === 0, "Generate button must have zero clicks");
  });

  // R5 — prompt missing classifies PROMPT_INPUT_NOT_FOUND.
  await runTest("R5 Prompt missing classification", async () => {
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    const res = await cmds.dispatchContentCommand(adapter, docWith({}), { type: "INSERT_PROMPT_DRYRUN", prompt: "x" }, {});
    assert(res.ok === false && res.code === "PROMPT_INPUT_NOT_FOUND", `expected PROMPT_INPUT_NOT_FOUND, got ${res && res.code}`);
    assert(res.readiness && res.readiness.prompt.found === false, "readiness must report prompt not found");
  });

  // R6 — Generate control missing classifies GENERATE_CONTROL_NOT_FOUND.
  await runTest("R6 Generate missing classification", async () => {
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    const ce = { tag: "DIV", attrs: { contenteditable: "true" }, textContent: "", focus() {}, dispatchEvent() {}, getAttribute(n) { return this.attrs[n] || null; } };
    const res = await cmds.dispatchContentCommand(adapter, docWith({ '[contenteditable="true"]': ce }), { type: "INSERT_PROMPT_DRYRUN", prompt: "x" }, {});
    assert(res.ok === false && res.code === "GENERATE_CONTROL_NOT_FOUND", `expected GENERATE_CONTROL_NOT_FOUND, got ${res && res.code}`);
  });

  // R7 — tab-resolver regression (L10) still passes + verifier failure classifies.
  await runTest("R7 Resolver regression intact + verify failure classification", async () => {
    const resolver = require("../../flow-companion/extension/src/background/tab-resolver.js");
    assert(typeof resolver.resolveLiveFlowTab === "function", "canonical resolveLiveFlowTab must remain (L10 covers restart safety)");
    // Unverifiable control: execCommand reports success but the text never
    // becomes visible in the control → PROMPT_VERIFY_FAILED, not insert failure.
    const ce = {
      tag: "DIV", attrs: { contenteditable: "true" }, textContent: "", focus() {}, dispatchEvent() {},
      getAttribute(n) { return this.attrs[n] || null; },
      ownerDocument: {
        getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
        createRange: () => ({ selectNodeContents() {} }),
        execCommand: () => true, // claims success, DOM never changes
      },
    };
    const root = docWith({ '[contenteditable="true"]': ce, 'button[type="submit"]': new FakeElement({ tag: "button", attrs: { "aria-disabled": "true" } }) });
    const r = adapter.insertPromptDryRun(root, "verify probe");
    assert(r.inserted === true && r.verified === false, "insert without visible text must report unverified");
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "INSERT_PROMPT_DRYRUN", prompt: "verify probe" }, {});
    assert(res.ok === false && res.code === "PROMPT_VERIFY_FAILED", `expected PROMPT_VERIFY_FAILED, got ${res && res.code}`);
    // New precise codes must be registered error categories.
    for (const c of ["PROMPT_INPUT_NOT_WRITABLE", "PROMPT_INSERT_FAILED", "PROMPT_VERIFY_FAILED", "GENERATE_STILL_DISABLED_AFTER_PROMPT", "FLOW_TAB_NOT_FOUND"]) {
      assert(sw.ERROR_CODES.includes(c), `${c} must be a registered error code`);
    }
  });

  console.log(`\n=== SUMMARY: passed assertions ${passed}, failed tests ${failed} ===`);  console.log(failed > 0 ? "RESULT: SOME TESTS FAILED" : "RESULT: ALL TESTS PASSED");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
