"use strict";

/**
 * Flow Companion job tests (STEP 10B): FJ1–FJ15.
 * Executable, deterministic, TEST-ONLY fixtures under projects/__flow10b__/
 * (removed in teardown). No Flow calls, no credits, no network.
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__flow10b__";

const { registerCoreProviders } = require("../../providers/runtime/bootstrap.js");
const flowWeb = require("../../providers/runtime/adapters/flow-web.js");
const store = require("../../flow-companion/bridge/job-store.js");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const { findSecrets } = require("../../flow-companion/bridge/security.js");

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

function mkRequest(overrides = {}) {
  return {
    version: "1.0.0",
    requestId: overrides.requestId || "FJ-REQ",
    projectId: TEST_PROJECT,
    sceneId: overrides.sceneId || "S03",
    platform: "youtube",
    capability: overrides.capability || "image",
    input: overrides.input || { prompt: "TEST-ONLY flow prompt" },
    outputRequirements: overrides.outputRequirements || { aspectRatio: "16:9" },
    ...(overrides.continuityContext ? { continuityContext: overrides.continuityContext } : {}),
    ...(overrides.flowJobId ? { flowJobId: overrides.flowJobId } : {}),
    ...(overrides.flowAttempt ? { flowAttempt: overrides.flowAttempt } : {}),
  };
}

function lockedRegistry() {
  const ent = (id, type) => ({
    entityId: id,
    type,
    name: `TEST-ONLY ${id}`,
    description: "TEST-ONLY fixture",
    lockStatus: "LOCKED",
    referenceAssets: [{ assetId: `REF-${id}`, path: `continuity/refs/${id}.png`, role: "MASTER", status: "APPROVED" }],
    attributes: {},
  });
  return {
    version: "1.0.0",
    projectId: TEST_PROJECT,
    visualBibleVersion: "vb-test-1",
    entities: [ent("CHAR_MOTHER_01", "CHARACTER"), ent("CHAR_INFANT_01", "CHARACTER"), ent("WARDROBE_MOTHER_01", "WARDROBE"), ent("LOC_CAMP_01", "LOCATION")],
    relationships: [{ from: "CHAR_MOTHER_01", relation: "wears", to: "WARDROBE_MOTHER_01" }],
    lockStatus: "LOCKED",
  };
}

function writeRegistry(reg) {
  const rel = "continuity/continuity-registry.json";
  artifactStore.writeArtifactAtomic(REPO_ROOT, TEST_PROJECT, rel, JSON.stringify(reg));
  return rel;
}

function validateJobSchema(job) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "schemas", "flow-job.schema.json"), "utf8"));
  const validate = ajv.compile(schema);
  const valid = validate(job);
  return { valid, errors: validate.errors || [] };
}

function setup() {
  registerCoreProviders();
  flowWeb.registerFlowWeb();
}

function teardown() {
  fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
  registerCoreProviders();
}

async function main() {
  setup();
  console.log("=== FLOW JOB TESTS (FJ1-FJ15) ===\n");

  // FJ1 — valid image job accepted.
  await runTest("FJ1 Valid image job accepted", async () => {
    const r = await flowWeb.execute(mkRequest({ requestId: "FJ1", flowJobId: "FJ1-JOB" }), { projectRoot: REPO_ROOT, flowBridgeReachable: false });
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, "FJ1-JOB");
    logOut("result/job", { status: r.status, provider: r.providerId, jobStatus: job && job.status });
    assert(r.providerId === "flow-web", "provider must be flow-web");
    assert(job !== null, "job must persist");
    const v = validateJobSchema(job);
    assert(v.valid === true, `persisted job must validate: ${JSON.stringify(v.errors)}`);
  });

  // FJ2 — valid video job accepted.
  await runTest("FJ2 Valid video job accepted", async () => {
    const r = await flowWeb.execute(
      mkRequest({ requestId: "FJ2", capability: "video", sceneId: "S05", flowJobId: "FJ2-JOB", input: { prompt: "TEST-ONLY video" } }),
      { projectRoot: REPO_ROOT, flowBridgeReachable: true }
    );
    logOut("result", { status: r.status, approval: !!r.approval });
    assert(r.status === "AWAITING_USER_APPROVAL", "reachable bridge must yield AWAITING_USER_APPROVAL");
    assert(r.approval && r.approval.jobId === "FJ2-JOB", "approval metadata must carry jobId");
  });

  // FJ3 — path traversal rejected.
  await runTest("FJ3 Path traversal rejected", async () => {
    let code = null;
    try {
      await flowWeb.execute(
        mkRequest({ requestId: "FJ3", flowJobId: "FJ3-JOB", continuityContext: { continuityStrictness: "STRICT", requiredEntities: ["CHAR_MOTHER_01"], registryPath: "../../evil.json" } }),
        { projectRoot: REPO_ROOT }
      );
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /TRAVERSAL|BLOCKED/i.test(code), "traversal registryPath must be rejected");
  });

  // FJ4 — STRICT with unlocked entity rejected before Flow.
  await runTest("FJ4 STRICT unlocked rejected", async () => {
    const reg = lockedRegistry();
    reg.entities[0].lockStatus = "DRAFT";
    const rel = writeRegistry(reg);
    let code = null;
    try {
      await flowWeb.execute(
        mkRequest({ requestId: "FJ4", flowJobId: "FJ4-JOB", continuityContext: { continuityStrictness: "STRICT", requiredEntities: ["CHAR_MOTHER_01"], registryPath: rel } }),
        { projectRoot: REPO_ROOT }
      );
    } catch (e) {
      code = e.errorCode || e.message;
    }
    logOut("rejection", code);
    assert(code === "CONTINUITY_PRECONDITION_UNMET", "unlocked STRICT entity must block before Flow");
  });

  // FJ5 — STRICT with locked references accepted.
  await runTest("FJ5 STRICT locked accepted", async () => {
    const rel = writeRegistry(lockedRegistry());
    const r = await flowWeb.execute(
      mkRequest({
        requestId: "FJ5", capability: "video", sceneId: "S05", flowJobId: "FJ5-JOB",
        continuityContext: { continuityStrictness: "STRICT", requiredEntities: ["CHAR_MOTHER_01", "WARDROBE_MOTHER_01", "LOC_CAMP_01"], registryPath: rel, registryVersion: "cr-test-1" },
      }),
      { projectRoot: REPO_ROOT, flowBridgeReachable: true }
    );
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, "FJ5-JOB");
    logOut("result/job", { status: r.status, entities: (job.continuityContext || {}).requiredEntities });
    assert(r.status === "AWAITING_USER_APPROVAL", "locked STRICT job must be accepted");
    assert((job.continuityContext.requiredEntities || []).length === 3, "entity IDs must survive into the job");
    assert(r.continuity.continuityStatus === "REVIEW_REQUIRED", "recurring output must be REVIEW_REQUIRED");
  });

  // FJ6 — duplicate jobId rejected.
  await runTest("FJ6 Duplicate jobId rejected", async () => {
    let code = null;
    try {
      await flowWeb.execute(mkRequest({ requestId: "FJ6B", flowJobId: "FJ1-JOB" }), { projectRoot: REPO_ROOT });
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /DUPLICATE_JOB_ID/.test(code), "duplicate jobId must be rejected");
  });

  // FJ7 — same fingerprint with accepted READY reuses artifact.
  await runTest("FJ7 Fingerprint reuse, no new job", async () => {
    const { fingerprintRequest } = require("../../providers/runtime/request-fingerprint.js");
    const req = mkRequest({ requestId: "FJ7", capability: "video", sceneId: "S06", providerPreference: ["flow-web"] });
    const rel = artifactStore.writeArtifactAtomic(REPO_ROOT, TEST_PROJECT, "assets/video/S06/accepted.mp4", Buffer.from("TEST-ONLY-ACCEPTED"));
    artifactStore.recordFingerprint(REPO_ROOT, TEST_PROJECT, rel, fingerprintRequest(req));
    const { resolve } = require("../../providers/runtime/resolver.js");
    const r = await resolve({ ...req, requestId: "FJ7B" }, { projectRoot: REPO_ROOT });
    logOut("reuse", { status: r.status, reused: r.metadata && r.metadata.reused, artifactPath: r.artifactPath });
    assert(r.status === "READY" && r.metadata && r.metadata.reused === true, "accepted READY artifact must be reused");
    assert(r.artifactPath === rel, "reuse must return the accepted artifact");
  });

  // FJ8 — changed reference version creates new attempt/job.
  await runTest("FJ8 Changed refs create new attempt", async () => {
    const rel = writeRegistry(lockedRegistry());
    const base = {
      capability: "video", sceneId: "S05",
      continuityContext: { continuityStrictness: "STRICT", requiredEntities: ["CHAR_MOTHER_01"], registryPath: rel, registryVersion: "cr-test-2" },
    };
    const r = await flowWeb.execute(mkRequest({ requestId: "FJ8", flowJobId: "FJ8-JOB", flowAttempt: 2, ...base }), { projectRoot: REPO_ROOT, flowBridgeReachable: true });
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, "FJ8-JOB");
    logOut("job", { jobId: job.jobId, attempt: job.attempt, status: r.status });
    assert(job.attempt === 2, "changed refs must create a new attempt, not reuse the old job");
    assert(r.status === "AWAITING_USER_APPROVAL", "new attempt enters approval flow");
  });

  // FJ9 — credit-consuming request enters AWAITING_USER_APPROVAL.
  await runTest("FJ9 Approval gate entered", async () => {
    const r = await flowWeb.execute(mkRequest({ requestId: "FJ9", capability: "video", sceneId: "S07", flowJobId: "FJ9-JOB" }), { projectRoot: REPO_ROOT, flowBridgeReachable: true });
    logOut("approval", r.approval);
    assert(r.status === "AWAITING_USER_APPROVAL", "must enter AWAITING_USER_APPROVAL");
    assert(r.approval && /UNKNOWN/.test(r.approval.creditNote), "unknown cost must be UNKNOWN, never 0");
  });

  // FJ10 — no approval ⇒ cannot GENERATING.
  await runTest("FJ10 No approval blocks GENERATING", async () => {
    let code = null;
    try {
      store.transitionJob(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", "GENERATING", { actor: "test" });
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /APPROVAL_REQUIRED/.test(code), "GENERATING without approval must be rejected");
  });

  // FJ11 — approval allows GENERATING.
  await runTest("FJ11 Approval allows GENERATING", async () => {
    store.recordApproval(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", { jobId: "FJ9-JOB", attempt: 1, approvedBy: "test-user" });
    const next = store.transitionJob(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", "GENERATING", { actor: "test-user" });
    logOut("status", next.status);
    assert(next.status === "GENERATING", "fresh approval must allow GENERATING");
  });

  // FJ12 — retry generation requires new approval.
  await runTest("FJ12 Retry needs new approval", async () => {
    store.transitionJob(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", "RETRYABLE_ERROR", { actor: "test" });
    store.transitionJob(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", "PREPARED", { actor: "test" });
    const pre = store.transitionJob(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", "AWAITING_USER_APPROVAL", { actor: "test" });
    assert(pre.approval === null || pre.approval === undefined, "retry path must clear the used approval");
    let code = null;
    try {
      store.transitionJob(REPO_ROOT, TEST_PROJECT, "FJ9-JOB", "GENERATING", { actor: "test" });
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /APPROVAL_REQUIRED/.test(code), "generation retry must require a NEW approval");
  });

  // FJ13 — no arbitrary output path.
  await runTest("FJ13 Output path confined", async () => {
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, "FJ2-JOB");
    const p = require("path");
    logOut("expectedOutputPath", job.expectedOutputPath);
    assert(!p.isAbsolute(job.expectedOutputPath), "expected path must be project-relative");
    assert(!job.expectedOutputPath.includes(".."), "expected path must not traverse");
    assert(job.expectedOutputPath.startsWith("assets/video/S05/"), "expected path must follow deterministic layout");
  });

  // FJ14 — no credentials/tokens serialized.
  await runTest("FJ14 No credential serialization", async () => {
    const r = await flowWeb.execute(
      mkRequest({ requestId: "FJ14", flowJobId: "FJ14-JOB", input: { prompt: "x", apiKey: "sk-should-never-persist", token: "Bearer abc" } }),
      { projectRoot: REPO_ROOT }
    );
    void r;
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, "FJ14-JOB");
    const hits = findSecrets(job);
    logOut("secretHits", hits);
    assert(hits.length === 0, "job must not serialize credentials/tokens");
  });

  // FJ15 — manual assist packet completeness.
  await runTest("FJ15 Manual packet complete", async () => {
    const { buildManualAssistPacket } = require("../../flow-companion/bridge/manual-assist.js");
    const job = store.getJob(REPO_ROOT, TEST_PROJECT, "FJ5-JOB");
    const packet = buildManualAssistPacket(job);
    logOut("packetKeys", Object.keys(packet));
    for (const k of ["prompt", "references", "aspectRatio", "generationLength", "expectedFilename", "expectedDestination", "jobId", "continuity"]) {
      assert(packet[k] !== undefined, `packet must include ${k}`);
    }
    assert(packet.continuity.requiredEntities.length === 3, "packet must carry continuity entities");
  });

  teardown();
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
    teardown();
  } catch {}
  process.exit(1);
});
