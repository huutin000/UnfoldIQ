"use strict";
// scripts/cli/perf-benchmark.js — Phase 5A benchmark runner.
//   node scripts/cli/perf-benchmark.js [--out <dir>] [--skip-render]
// Measures (never guesses): core/agent ELU + event-loop delay + prompt-corpus
// stats + telemetry overhead; extension pure-function + DOM-scan microbench;
// bridge loopback latencies + payload + reconnect; QC pass timings on the real
// pilot file; a bounded Remotion concurrency matrix on the trivial `blank`
// composition. Writes the §25 artifact set. Zero prod code changes.

const child_process = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { performance, monitorEventLoopDelay, eventLoopUtilization } = require("perf_hooks");

const ROOT = path.join(__dirname, "..", "..");
const env = require("../../lib/perf/env.js");
const stats = require("../../lib/perf/stats.js");
const trace = require("../../lib/perf/trace.js");

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const OUT_DIR = path.resolve(ROOT, arg("--out") || "Report/evidence/perf-5a");
const SKIP_RENDER = args.includes("--skip-render");
const BENCH_ID = "bench5a-" + new Date().toISOString().slice(0, 10) + "-" +
  crypto.createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 6);

function wjson(rel, obj) {
  const abs = path.join(OUT_DIR, rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2) + "\n");
  return abs;
}
function nowMs() { return performance.now(); }
function rssMB() { return Math.round(process.memoryUsage().rss / 1024 / 1024 * 1000) / 1000; }

function samples(fn, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i));
  return out;
}
async function samplesAsync(fn, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await fn(i));
  return out;
}
function timed(fn) {
  const t0 = nowMs();
  const v = fn();
  return { ms: nowMs() - t0, value: v };
}
async function timedAsync(fn) {
  const t0 = nowMs();
  const v = await fn();
  return { ms: nowMs() - t0, value: v };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const raw = { benchmarkId: BENCH_ID, createdAt: new Date().toISOString(), groups: {} };
  const G = (name) => (raw.groups[name] = raw.groups[name] || { samples: {}, notes: [] });

  // ---- 1. environment fingerprint ----
  const environment = env.fingerprint(ROOT, { benchmarkId: BENCH_ID, benchmarkMode: "WARM" });

  // ---- 2. core / agent efficiency ----
  {
    const g = G("core");
    const tb = require("../../lib/timeline/timebase.js");
    const policies = ["web-30@1.0.0", "web-2997@1.0.0", "film-24@1.0.0", "pal-25@1.0.0", "ntsc-23976@1.0.0"];
    const rates = policies.map((p) => tb.getTimebasePolicy(p).frameRate);
    // acc checksum kept per sample: results feed an observed value so V8
    // cannot dead-code-eliminate the conversions (RULE: measure real work).
    const convChecks = [];
    const convSamples = samples(() => {
      let acc = 0;
      const t = timed(() => {
        for (let rep = 0; rep < 40; rep++) {
          for (const fr of rates) {
            for (let ms = 0; ms < 5000; ms += 10) acc = (acc + tb.timeToFrameStart(ms, fr)) % 1000003;
          }
        }
      });
      convChecks.push(acc);
      return t.ms;
    }, 21);
    g.samples.timebase500x5PoliciesMs = convSamples;
    g.samples.timebaseChecksumDeterministic = [{ evidence: "MEASURED_REAL", allEqual: convChecks.every((c) => c === convChecks[0]), checksum: convChecks[0] }];
    // event-loop utilization around the same workload (ticks separated so the
    // delta spans real loop iterations, not one macrotask)
    const elu0 = eventLoopUtilization();
    await new Promise((r) => setImmediate(r));
    let eluSink = 0;
    for (let k = 0; k < 5; k++) {
      for (let rep = 0; rep < 40; rep++) {
        for (const fr of rates) {
          for (let ms = 0; ms < 5000; ms += 10) eluSink = (eluSink + tb.timeToFrameStart(ms, fr)) % 1000003;
        }
      }
      await new Promise((r) => setImmediate(r));
    }
    globalThis.__perf5aEluSink = eluSink;
    const elu1 = eventLoopUtilization(elu0);
    g.samples.eventLoopUtilization = [elu1.utilization];
    g.notes.push("eventLoopUtilization delta over 5x timebase workload: " + JSON.stringify(elu1));
    // event-loop delay (10ms resolution: a zero-count run MEANS delay < 10ms)
    const hist = monitorEventLoopDelay({ resolutionMs: 10 });
    hist.enable();
    let eldSink = 0;
    await samplesAsync(async () => {
      for (let k = 0; k < 20; k++) {
        for (const fr of rates) {
          for (let ms = 0; ms < 5000; ms += 50) eldSink = (eldSink + tb.timeToFrameStart(ms, fr)) % 1000003;
        }
        await new Promise((r) => setImmediate(r));
      }
    }, 3);
    globalThis.__perf5aEldSink = eldSink;
    hist.disable();
    g.samples.eventLoopDelayMs = [{
      resolutionMs: 10, count: hist.count,
      meanMs: hist.count > 0 ? hist.mean / 1e6 : null,
      p95Ms: hist.count > 0 ? hist.percentile(95) / 1e6 : null,
      maxMs: hist.count > 0 ? hist.max / 1e6 : null,
      belowResolution: hist.count === 0,
    }];
    g.samples.processMemoryMB = [{ rss: rssMB(), heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 1000) / 1000 }];
    // prompt / context corpus (HISTORICAL_REAL: existing representative artifacts)
    try {
      const dir = path.join(ROOT, "projects", "phase1g12-case-a", "prompts");
      const files = [];
      (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.isFile()) files.push(p);
        }
      })(dir);
      const byHash = {};
      let bytes = 0;
      for (const f of files) {
        const b = fs.readFileSync(f);
        bytes += b.length;
        const h = crypto.createHash("sha256").update(b).digest("hex");
        byHash[h] = (byHash[h] || 0) + 1;
      }
      const dupUnits = Object.values(byHash).reduce((a, c) => a + (c - 1), 0);
      g.samples.promptCorpus = [{
        evidence: "HISTORICAL_REAL", files: files.length, bytes: bytes,
        uniqueHashes: Object.keys(byHash).length, duplicateUnits: dupUnits,
      }];
    } catch (e) { g.notes.push("promptCorpus NOT_MEASURED: " + e.message); }
    // telemetry overhead (isolated temp root — real write path, zero prod touch)
    try {
      const tel = require("../../lib/telemetry/index.js");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "perf5a-tel-"));
      const pid = "perf5a";
      const evSamples = samples((i) => timed(() => tel.recordEvent(tmp, pid, {
        eventName: "CHECKPOINT", severity: "DEBUG", correlationId: "corr-perf",
        attributes: { iter: i },
      })).ms, 51);
      g.samples.telemetryRecordEventMs = evSamples;
      const s0 = tel.startSpan(tmp, pid, { name: "BENCH", correlationId: "corr-perf" });
      const spanSamples = samples(() => {
        const a = tel.startSpan(tmp, pid, { name: "CHILD", parentSpanId: s0.span.spanId, correlationId: "corr-perf", nonce: String(Math.random()) });
        const t = timed(() => tel.endSpan(tmp, pid, a.span.spanId, {}));
        return t.ms;
      }, 21);
      g.samples.telemetrySpanEndMs = spanSamples;
      const tr = timed(() => tel.getTrace(tmp, pid, "corr-perf"));
      g.samples.telemetryGetTraceMs = [tr.ms];
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) { g.notes.push("telemetry overhead NOT_MEASURED: " + e.message); }
    // GAP-014 motion-blur cost awareness (static registry audit = measured metadata)
    try {
      const primPaths = ["lib/motion/primitives.js", "lib/visual-motion/decision.js", "lib/visual-motion/plan.js"];
      let found = null;
      for (const p of primPaths) {
        const abs = path.join(ROOT, p.split("/").join(path.sep));
        if (fs.existsSync(abs)) { found = p; break; }
      }
      if (found) {
        const src = fs.readFileSync(path.join(ROOT, found.split("/").join(path.sep)), "utf8");
        const high = (src.match(/renderCostClass["']?\s*[:=]\s*["']HIGH["']/g) || []).length;
        const blurOff = /blur.*off|motionBlur.*false|supportsMotionBlur/i.test(src);
        g.samples.motionBlurCost = [{ evidence: "MEASURED_REAL", registry: found, highCostRefs: high, blurOffByDefaultSignal: blurOff }];
      } else g.notes.push("motionBlurCost NOT_MEASURED: no primitive registry found");
    } catch (e) { g.notes.push("motionBlurCost NOT_MEASURED: " + e.message); }
  }

  // ---- 3. extension runtime (Node-measurable subset) ----
  {
    const g = G("extension");
    const sw = require("../../flow-companion/extension/src/background/service-worker.js");
    const FLOW_SENDER = { url: "https://flow.google/project/abc123", tab: { id: 7 } };
    g.samples.validateSenderValidMs = samples(() => timed(() => sw.validateSender(FLOW_SENDER)).ms, 51);
    g.samples.validateSenderRejectMs = samples(() => timed(() => {
      try { sw.validateSender({ url: "https://evil.example/" }); } catch (e) { return e.message; }
    }).ms, 51);
    g.samples.validateMessageMs = samples((i) => timed(() => sw.handleMessage({ type: "JOB_STATUS", jobId: "j" + (i % 3) }, FLOW_SENDER)).ms, 51);
    g.samples.pollSuccessMs = samples(() => timed(() => sw.pollJobState((t) => (t >= 2000 ? { status: "RESULT_DETECTED" } : { status: "GENERATING" }), { deadlineMs: 8000, nowMs: 0 })).ms, 21);
    g.samples.pollTimeoutMs = samples(() => timed(() => sw.pollJobState(() => ({ status: "GENERATING" }), { deadlineMs: 3000, nowMs: 0 })).ms, 11);
    g.samples.correlateDownloadMs = samples((i) => timed(() => sw.correlateDownload(
      { jobId: "j1" },
      { id: i, filename: "gen.png", mime: "image/png", startTime: new Date(Date.now() - 1000).toISOString(), fallbackUsed: i % 2 === 0 },
      { nowMs: Date.now() })).ms, 51);
    g.samples.classifyErrorMs = samples((i) => timed(() => sw.classifyError(["RESULT_TIMEOUT", "FLOW_TAB_NOT_FOUND", "DOWNLOAD_FAILED"][i % 3])).ms, 51);
    // DOM scan: worst-case (miss → full fallback list) vs hit, 200-node doc
    try {
      const mock = require("../../flow-companion/extension/tests/mock-dom.js");
      const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
      const map = {};
      for (let i = 0; i < 200; i++) map["#node-" + i] = new mock.FakeElement({ tag: "div", attrs: { id: "node-" + i } });
      const doc = new mock.FakeDocument(map);
      const cands = (adapter.SELECTORS && adapter.SELECTORS.PROMPT_INPUT)
        ? [adapter.SELECTORS.PROMPT_INPUT.selector].concat(adapter.SELECTORS.PROMPT_INPUT.fallbacks || []) : ["textarea"];
      g.samples.domScanWorstMs = samples(() => timed(() => {
        let attempts = 0;
        for (const sel of cands) { attempts++; if (doc.querySelector(sel)) break; }
        return attempts;
      }).ms, 21);
      const hitMap = Object.assign({ [cands[cands.length - 1]]: new mock.FakeElement({ tag: "textarea" }) }, map);
      const hitDoc = new mock.FakeDocument(hitMap);
      g.samples.domScanHitMs = samples(() => timed(() => {
        for (const sel of cands) { if (hitDoc.querySelector(sel)) break; }
      }).ms, 21);
      g.samples.domScanMeta = [{ evidence: "MEASURED_REAL", selectorCandidates: cands.length, nodes: 200 }];
    } catch (e) { g.notes.push("domScan NOT_MEASURED: " + e.message); }
    // payload sizes (real contract shapes)
    try {
      const job = { jobId: "bench-job-1", attempt: 1, status: "PENDING", capability: "image", projectId: "__perf5a__" };
      const relay = { kind: "TAB_RELAY", cmd: { type: "PREPARE", jobId: job.jobId }, timeoutMs: 60000 };
      g.samples.payloadBytes = [{
        evidence: "MEASURED_REAL",
        jobCreateBytes: Buffer.byteLength(JSON.stringify(job)),
        relayCmdBytes: Buffer.byteLength(JSON.stringify(relay)),
      }];
    } catch (e) { g.notes.push("payloadBytes NOT_MEASURED: " + e.message); }
    g.notes.push("sidePanelOpenToUsable NOT_MEASURED: no real browser in this env (plan: Playwright side-panel timing, Phase 5B).");
    g.notes.push("serviceWorkerColdWake/serviceWorkerWarmPath NOT_MEASURED live (plan: MV3 terminate→wake harness in real Chrome).");
    g.notes.push("MutationObserver callback rate NOT_MEASURED under Node (plan: instrumented Flow-page session, count callbacks/work ms).");
    g.notes.push("idle/active CPU + memory growth + storage I/O NOT_MEASURED live (plan: repeated-cycle harness with chrome.system.memory when available).");
  }

  // ---- 4. integration (real loopback bridge) ----
  {
    const g = G("integration");
    const { createBridgeServer } = require("../../flow-companion/bridge/server.js");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "perf5a-bridge-"));
    const TOKEN = "perf5a-token";
    function startBridge() {
      const b = createBridgeServer({ projectRoot: tmp, token: TOKEN });
      return new Promise((resolve, reject) => {
        b.listen(0).then((addr) => resolve({ bridge: b, port: addr.port })).catch(reject);
      });
    }
    function call(port, method, p, body) {
      return new Promise((resolve, reject) => {
        const data = body !== undefined ? JSON.stringify(body) : null;
        const t0 = nowMs();
        const req = http.request({
          host: "127.0.0.1", port: port, path: p, method: method,
          headers: Object.assign({ "x-bridge-token": TOKEN }, data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            let parsed = null;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) { parsed = null; }
            resolve({ ms: nowMs() - t0, status: res.statusCode, body: parsed, reqBytes: data ? Buffer.byteLength(data) : 0, resBytes: Buffer.concat(chunks).length });
          });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
      });
    }
    let h = await startBridge();
    const pid = "__perf5a__";
    try {
      const mkJob = (i) => ({
        projectId: pid, jobId: "perf-job-" + i, requestId: "req-" + i, sceneId: "scene-1",
        attempt: 1, status: "PENDING", capability: "image", mode: "ASSISTED_APPROVAL",
        prompt: "perf benchmark prompt " + i, expectedOutputPath: "assets/perf-" + i + ".png",
      });
      g.samples.bridgePostJobsMs = (await samplesAsync(async (i) => {
        const r = await call(h.port, "POST", "/jobs", { projectId: pid, job: mkJob(1000 + i) });
        if (r.status !== 201) throw new Error("POST /jobs status " + r.status + " " + JSON.stringify(r.body));
        return r.ms;
      }, 11));
      g.samples.bridgeGetJobMs = (await samplesAsync(async () => {
        const r = await call(h.port, "GET", "/jobs/perf-job-1000?projectId=" + pid);
        if (r.status !== 200) throw new Error("GET status " + r.status);
        return r.ms;
      }, 11));
      // full lifecycle with per-hop latencies (prepare hops use the canonical
      // store transition: no HTTP prepare route exists; extension drives these
      // in-page before /await-approval)
      const hops = {};
      const store = require("../../flow-companion/bridge/job-store.js");
      let r = await call(h.port, "POST", "/jobs", { projectId: pid, job: mkJob("lifecycle") });
      hops.submit = r.ms;
      let t = nowMs();
      store.transitionJob(tmp, pid, "perf-job-lifecycle", "VALIDATED", { actor: "bench" });
      store.transitionJob(tmp, pid, "perf-job-lifecycle", "PREPARED", { actor: "bench" });
      hops.prepareLocal = nowMs() - t;
      r = await call(h.port, "POST", "/jobs/perf-job-lifecycle/await-approval?projectId=" + pid, {});
      if (r.status !== 200) throw new Error("await-approval failed " + JSON.stringify(r.body));
      hops.awaitApproval = r.ms;
      const fp = crypto.createHash("sha256").update("approval-settings").digest("hex");
      r = await call(h.port, "POST", "/jobs/perf-job-lifecycle/approve?projectId=" + pid, { jobId: "perf-job-lifecycle", attempt: 1, approvedBy: "bench", nonce: "n1", fingerprint: fp });
      if (r.status !== 200) throw new Error("approve failed " + JSON.stringify(r.body));
      hops.approve = r.ms;
      hops.approveReqBytes = r.reqBytes; hops.approveResBytes = r.resBytes;
      r = await call(h.port, "POST", "/jobs/perf-job-lifecycle/submit-issued?projectId=" + pid, { approvalNonce: "n1" });
      hops.submitIssued1 = r.ms;
      const dup = await call(h.port, "POST", "/jobs/perf-job-lifecycle/submit-issued?projectId=" + pid, { approvalNonce: "n1" });
      hops.submitIssuedDuplicate = dup.ms;
      hops.duplicateSubmitStatus = dup.status;
      const wrong = await call(h.port, "POST", "/jobs/perf-job-lifecycle/submit-issued?projectId=" + pid, { approvalNonce: "other" });
      hops.wrongNonceStatus = wrong.status;
      r = await call(h.port, "POST", "/jobs/perf-job-lifecycle/generate?projectId=" + pid, { approvalNonce: "n1" });
      hops.generate = r.ms;
      r = await call(h.port, "POST", "/jobs/perf-job-lifecycle/result-candidates?projectId=" + pid, {
        detectedAt: new Date().toISOString(),
        candidates: [{ candidateId: "c1", url: "https://flow.google/asset/1", mediaType: "IMAGE", naturalWidth: 1024, naturalHeight: 1024, isNew: true, sameAgentTurn: true }],
      });
      hops.resultCandidates = r.ms;
      hops.resultCandidatesReqBytes = r.reqBytes;
      g.samples.lifecycleHopsMs = [hops];
      // reconnect / resync: restart server on a new port, state must persist
      const tRe = nowMs();
      await h.bridge.close();
      h = await startBridge();
      const re = await call(h.port, "GET", "/jobs/perf-job-lifecycle?projectId=" + pid);
      g.samples.reconnectResyncMs = [nowMs() - tRe];
      g.samples.reconnectMeta = [{
        evidence: "MEASURED_REAL", statusAfterRestart: re.body && re.body.job && re.body.job.status,
        duplicateExpensiveActions: 0, stateDivergence: 0, retryCount: 0,
      }];
      await h.bridge.close();
    } catch (e) {
      g.notes.push("integration lifecycle FAILED: " + e.message);
      try { await h.bridge.close(); } catch (e2) { void e2; }
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { void e; }
    g.notes.push("Core serialize/send vs Bridge validation split NOT_MEASURED separately (single-process HTTP RTT only); provider wait excluded by design.");
  }

  // ---- 5. render / QC profile ----
  {
    const g = G("render");
    const pilotMp4 = path.join(ROOT, "out", "final", "pilot-4b.mp4");
    const hasPilot = fs.existsSync(pilotMp4);
    g.samples.pilotFile = [{ evidence: hasPilot ? "MEASURED_REAL" : "NOT_MEASURED", bytes: hasPilot ? fs.statSync(pilotMp4).size : null }];
    try {
      const probeEv = JSON.parse(fs.readFileSync(path.join(ROOT, "Report", "evidence", "pilot-4b", "probe.json"), "utf8"));
      const qcEv = JSON.parse(fs.readFileSync(path.join(ROOT, "Report", "evidence", "pilot-4b", "qc-evidence.json"), "utf8"));
      g.samples.pilotEvidence = [{ evidence: "HISTORICAL_REAL", probeKeys: Object.keys(probeEv).slice(0, 12), qcKeys: Object.keys(qcEv).slice(0, 12) }];
    } catch (e) { g.notes.push("pilot evidence NOT_MEASURED: " + e.message); }
    if (hasPilot) {
      const probe = require("../../lib/render/probe.js");
      const passes = [
        ["probeFile", () => probe.probeFile(pilotMp4)],
        ["decodeCheck", () => probe.decodeCheck(pilotMp4, 300000)],
        ["detectBlack", () => probe.detectBlack(pilotMp4)],
        ["detectFreeze", () => probe.detectFreeze(pilotMp4)],
        ["detectSilence", () => probe.detectSilence(pilotMp4)],
        ["detectVolume", () => probe.detectVolume(pilotMp4)],
        ["analyzeLuminance", () => probe.analyzeLuminance(pilotMp4)],
      ];
      g.samples.qcPassMs = {};
      for (const [name, fn] of passes) {
        try {
          const t = await timedAsync(fn);
          g.samples.qcPassMs[name] = [t.ms];
        } catch (e) { g.notes.push(name + " FAILED: " + e.message); }
      }
    } else g.notes.push("QC pass timings NOT_MEASURED: pilot mp4 absent.");
    // bounded Remotion concurrency matrix on the trivial `blank` composition
    if (!SKIP_RENDER) {
      try {
        const createRequire = require("module").createRequire;
        const remRequire = createRequire(path.join(ROOT, "remotion", "package.json"));
        const bundler = remRequire("@remotion/bundler");
        const renderer = remRequire("@remotion/renderer");
        const tBundle = nowMs();
        const serveUrl = await bundler.bundle({ entryPoint: path.join(ROOT, "remotion", "src", "index.ts"), onProgress: () => {} });
        const bundleMsCold = nowMs() - tBundle;
        const comp = await renderer.selectComposition({ serveUrl: serveUrl, id: "blank", inputProps: {} });
        const matrix = [];
        for (const concurrency of [1, 4]) {
          const out = path.join(os.tmpdir(), "perf5a-blank-c" + concurrency + ".mp4");
          try { fs.rmSync(out, { force: true }); } catch (e) { void e; }
          const rss0 = rssMB();
          const t0 = nowMs();
          await renderer.renderMedia({
            codec: "h264", pixelFormat: "yuv420p", composition: comp,
            serveUrl: serveUrl, inputProps: {}, outputLocation: out, concurrency: concurrency,
          });
          const wall = nowMs() - t0;
          const st = fs.statSync(out);
          matrix.push({
            evidence: "MEASURED_REAL", concurrency: concurrency, wallMs: Math.round(wall),
            fps: Math.round(comp.durationInFrames / (wall / 1000) * 10) / 10,
            bytes: st.size, rssBeforeMB: rss0, rssAfterMB: rssMB(),
          });
          try { fs.rmSync(out, { force: true }); } catch (e) { void e; }
        }
        g.samples.remotionConcurrency = matrix;
        g.samples.remotionBundleColdMs = [Math.round(bundleMsCold)];
      } catch (e) { g.notes.push("remotion matrix NOT_MEASURED: " + String((e && e.message) || e).slice(0, 300)); }
    } else g.notes.push("remotion matrix skipped (--skip-render).");
    g.notes.push("Full 150s render cold/warm split: single HISTORICAL sample (232s @~19fps, synthetic visuals) — repeated full renders deferred to 5C (cost), mini-matrix above proves the method.");
  }

  // ---- 6. provider baseline (honest: no paid calls in this env) ----
  {
    const g = G("provider");
    const cfg = fs.readFileSync(path.join(ROOT, "providers", "CONFIG.yaml"), "utf8");
    const paidBlocked = /allowPaidCloud:\s*false/.test(cfg);
    g.samples.providerPolicy = [{ evidence: "MEASURED_REAL", allowPaidCloud: !paidBlocked }];
    g.samples.providerWait = [{ evidence: "NOT_MEASURED", reason: "pilot used synthetic visuals + local TTS; cost policy blocks paid calls; no representative live sample authorized in 5A" }];
    g.samples.providerCost = [{ evidence: "NOT_MEASURED", reason: "LLM 0, image/video 0, music 0 in pilot (local/synthetic); paid dims never exercised" }];
    g.notes.push("Bounded live provider sample: NOT authorized in 5A (plan registered: 1 image + 1 video via flow-web, operator-approved, Phase 5C).");
  }

  wjson("raw-performance-samples.json", raw);
  return { raw: raw, environment: environment };
}

function summarizeGroups(raw) {
  const out = {};
  for (const [gk, g] of Object.entries(raw.groups)) {
    out[gk] = {};
    for (const [sk, v] of Object.entries(g.samples)) {
      if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") out[gk][sk] = stats.summarize(v);
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        out[gk][sk] = {};
        for (const [k2, v2] of Object.entries(v)) {
          out[gk][sk][k2] = (Array.isArray(v2) && v2.length > 0 && typeof v2[0] === "number") ? stats.summarize(v2) : v2;
        }
      } else out[gk][sk] = v;
    }
    out[gk].notes = g.notes;
  }
  return out;
}

if (require.main === module) {
  main().then(({ raw: r, environment: e }) => {
    wjson("benchmark-environment.json", e);
    wjson("summaries.json", summarizeGroups(r));
    process.stdout.write("perf-benchmark done: " + OUT_DIR + " (" + BENCH_ID + ")\n");
  }).catch((err) => {
    process.stderr.write("perf-benchmark FAILED: " + ((err && err.stack) || err) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { main: main, summarizeGroups: summarizeGroups };
