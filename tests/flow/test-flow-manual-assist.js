"use strict";

/**
 * Flow Companion manual-assist tests (STEP 10B): MA1–MA6.
 * No browser, no generation. Packet built from a persisted TEST-ONLY job.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__flow10b_ma__";

const store = require("../../flow-companion/bridge/job-store.js");
const { buildManualAssistPacket } = require("../../flow-companion/bridge/manual-assist.js");
const flowWeb = require("../../providers/runtime/adapters/flow-web.js");
const { registerCoreProviders } = require("../../providers/runtime/bootstrap.js");

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

async function main() {
  registerCoreProviders();
  flowWeb.registerFlowWeb();
  console.log("=== FLOW MANUAL ASSIST TESTS (MA1-MA6) ===\n");

  // MA1 — missing selector generates a manual-assist packet (bridge unreachable).
  await runTest("MA1 Fallback packet generated", async () => {
    const r = await flowWeb.execute(
      {
        version: "1.0.0", requestId: "MA1", projectId: TEST_PROJECT, sceneId: "S05",
        capability: "video", input: { prompt: "TEST-ONLY manual fallback" },
        outputRequirements: { aspectRatio: "16:9", generationLength: "8s" },
      },
      { projectRoot: REPO_ROOT, flowBridgeReachable: false }
    );
    logOut("result", { status: r.status, handoffPath: r.handoffPath });
    assert(r.status === "HANDOFF_REQUIRED", "unreachable bridge must yield manual-assist handoff");
    assert(r.handoffPath, "packet must persist with a handoff path");
    const packet = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "projects", TEST_PROJECT, r.handoffPath), "utf8"));
    globalThis.__maPacket = packet;
  });

  const packet = () => globalThis.__maPacket;

  // MA2 — packet includes prompt.
  await runTest("MA2 Packet includes prompt", async () => {
    logOut("prompt", packet().prompt);
    assert(typeof packet().prompt === "string" && packet().prompt.length > 0, "packet must include the prompt");
  });

  // MA3 — packet includes references.
  await runTest("MA3 Packet includes references", async () => {
    const r = await flowWeb.execute(
      {
        version: "1.0.0", requestId: "MA3", projectId: TEST_PROJECT, sceneId: "S05",
        capability: "video", input: { prompt: "x" }, outputRequirements: {},
        flowAttempt: 2,
        continuityContext: { continuityStrictness: "NORMAL", requiredEntities: ["CHAR_MOTHER_01"], requiredReferences: ["REF_MOTHER_MASTER"] },
      },
      { projectRoot: REPO_ROOT, flowBridgeReachable: false, manualAssist: true }
    );
    const p = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "projects", TEST_PROJECT, r.handoffPath), "utf8"));
    logOut("references", p.references);
    assert(Array.isArray(p.references) && p.references.length === 1 && p.references[0].assetId === "REF_MOTHER_MASTER", "packet must include references");
  });

  // MA4 — packet includes aspect/duration/model preference.
  await runTest("MA4 Packet includes settings", async () => {
    const p = packet();
    logOut("settings", { aspectRatio: p.aspectRatio, generationLength: p.generationLength, outputCount: p.outputCount });
    assert(p.aspectRatio === "16:9" || p.aspectRatio === null, "packet must include aspect ratio field");
    assert(p.generationLength === "8s" || p.generationLength === null, "packet must include duration field");
    assert(typeof p.outputCount === "number", "packet must include output count");
  });

  // MA5 — packet includes expected filename/path.
  await runTest("MA5 Packet includes filename/path", async () => {
    const p = packet();
    logOut("destination", { file: p.expectedFilename, dest: p.expectedDestination });
    assert(/S05_attempt-0\d\.mp4/.test(p.expectedFilename), "packet must include deterministic filename");
    assert(typeof p.expectedDestination === "string" && p.expectedDestination.length > 0, "packet must include expected destination");
    assert(typeof p.jobId === "string", "packet must include jobId");
  });

  // MA6 — manually supplied result can resume to import/READY.
  await runTest("MA6 Manual result resumes pipeline", async () => {
    const { importResult } = require("../../flow-companion/bridge/importer.js");
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, packet().jobId);
    assert(job && job.status === "MANUAL_ASSIST_REQUIRED", "job must wait in MANUAL_ASSIST_REQUIRED");
    const src = path.join(REPO_ROOT, "projects", TEST_PROJECT, "_manual", "user-video.mp4");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, Buffer.from("TEST-ONLY-USER-DELIVERED"));
    const adapted = { ...job, capability: "video", sceneId: job.sceneId, attempt: job.attempt, continuityContext: { requiredEntities: [], referenceAssetIds: [] } };
    const { result } = importResult({ projectRoot: REPO_ROOT, job: adapted, sourceAbsPath: src });
    logOut("import", { status: result.status, provider: result.providerId });
    assert(result.status === "READY" && result.providerId === "flow-web", "manual result must resume to import/READY");
  });

  fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
  registerCoreProviders();
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  try {
    fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
    registerCoreProviders();
  } catch {}
  process.exit(1);
});
