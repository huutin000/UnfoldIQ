"use strict";

/**
 * scripts/cli/fss-canonicalize.js in an isolated temp repo (shared lib/schemas are
 * linked, projects/ is private to the test): first version, version bump with
 * previous-version immutability, rerun, pronunciation-profile mismatch and invalid
 * input. Failure cases must leave the project byte-for-byte unchanged.
 * Uses the Phase 7 GPS evidence files as fixtures and the local quiet phonemizer
 * (no audio, no network, no paid call).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const REPO = path.join(__dirname, "..", "..");
const gate = require(REPO + "/lib/script-qa/gate.js");
const SCRIPT_DIR = "Report/evidence/phase-7/script";
const P = "phase7-gps-explainer"; // registered in projects/registry.json; the temp repo has its own projects/

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " - " + e.message); }
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fss-canon-"));
  for (const d of ["lib", "schemas", "node_modules"]) {
    if (fs.existsSync(path.join(REPO, d))) fs.symlinkSync(path.join(REPO, d), path.join(root, d), "junction");
  }
  const copy = (rel) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  };
  copy("scripts/cli/fss-canonicalize.js");
  copy("projects/registry.json");
  copy("Report/evidence/phase-7/research/claim-ledger.json");
  copy("tests/fixtures/script-qa/golden-cases.json");
  copy("tests/fixtures/script-qa/ledger.json");
  copy("projects/phase2-1-validation/voice/voice-bible/vb-19f4fd6a4596.json");
  for (const f of ["gps-script-v3.md", "gps-script-v4.md", "script-meta.json", "fss-config.json", "fss-config-v4.json",
    "qa/editorial-v3.json", "qa/editorial-v4.json", "qa/dispositions-v3.json", "qa/dispositions-v4.json",
    "qa/tts-calibration.json", "qa/tts-calibration-v4.json"]) copy(`${SCRIPT_DIR}/${f}`);
  for (const [cfg, extra] of [["fss-config.json", {}], ["fss-config-v4.json", {}]]) {
    const p = path.join(root, SCRIPT_DIR, cfg);
    const c = { ...JSON.parse(fs.readFileSync(p, "utf8")), resultOut: `${SCRIPT_DIR}/qa/result-${cfg}`, ...extra };
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
  }
  return root;
}

function run(root, cfgName) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts/cli/fss-canonicalize.js"), "--config", `${SCRIPT_DIR}/${cfgName}`], { cwd: root, encoding: "utf8", timeout: 240000 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function snapshot(root) {
  const base = path.join(root, "projects", P);
  const snap = {};
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else snap[path.relative(base, f)] = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    }
  };
  walk(base);
  return snap;
}
const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, "projects", P, rel), "utf8"));

const root = makeRepo();
let afterV1;
let afterV2;

runTest("first version canonicalizes and keeps production TTS blocked", () => {
  const r = run(root, `fss-config.json`);
  assert(r.code === 0, "exit 0 (stderr: " + r.err.slice(0, 200) + ")");
  assert(fs.existsSync(path.join(root, "projects", P, "input/final-spoken-script/fss-phase7-gps-explainer-v1.json")), "FSS v1 written");
  assert(fs.existsSync(path.join(root, "projects", P, "script.json")), "source script.json written");
  assert(JSON.parse(r.out).steps.ttsReadyPlan.productionTtsBlocked === true, "TTS blocked pending owner approval");
  afterV1 = snapshot(root);
});

runTest("version bump keeps every v1 file byte-identical and points manifest/DAG at v2", () => {
  const r = run(root, "fss-config-v4.json");
  assert(r.code === 0, "exit 0 (stderr: " + r.err.slice(0, 200) + ")");
  afterV2 = snapshot(root);
  const changed = Object.keys(afterV1).filter((k) => afterV2[k] !== afterV1[k]);
  assert(changed.every((k) => /^(dependency-dag|manifest\/project-manifest|telemetry\/events)\.json$/.test(k.replace(/\\/g, "/"))),
    "only DAG, manifest and telemetry changed: " + changed.join(","));
  assert(Object.keys(afterV2).some((k) => /fss-phase7-gps-explainer-v2\.json$/.test(k)), "FSS v2 written");
  assert(JSON.stringify(read(root, "manifest/project-manifest.json")).includes("fss-phase7-gps-explainer@v2"), "manifest references @v2");
  const dag = read(root, "dependency-dag.json");
  assert(dag.nodes.FINAL_SPOKEN_SCRIPT.versionRef === "fss-phase7-gps-explainer@v2", "DAG FINAL_SPOKEN_SCRIPT is @v2");
  assert(dag.nodes.SCRIPT_QA_DECISION.versionRef === "fss-phase7-gps-explainer@v2" && dag.nodes.SCRIPT_QA_DECISION.state === "CLEAN", "DAG SCRIPT_QA_DECISION is @v2 and CLEAN");
  assert(["FINAL_SPOKEN_SCRIPT", "SCRIPT_QA_DECISION", "NARRATION_DIRECTION", "PRONUNCIATION_RUNTIME_PASS", "TTS_READY_PLAN"].every((k) => dag.nodes[k].state === "CLEAN"), "all v2 chain nodes CLEAN");
  const fss = read(root, "input/final-spoken-script/fss-phase7-gps-explainer-v2.json");
  const dec = read(root, "script-qa/fss-phase7-gps-explainer@v2.json");
  assert(dec.scriptTextHash === gate.scriptTextHash(fss.segments), "QA decision hash equals hash of the FSS v2 text");
  assert(dec.scriptTextHash !== read(root, "script-qa/fss-phase7-gps-explainer@v1.json").scriptTextHash, "v2 hash differs from v1 hash");
  assert(JSON.parse(r.out).steps.ttsReadyPlan.productionTtsBlocked === true, "TTS still blocked");
});

runTest("rerunning the same version does not alter the v1 or v2 artifacts", () => {
  const r = run(root, "fss-config-v4.json");
  const now = snapshot(root);
  // the unapproved QA decision may be rewritten (new decidedAt); every other versioned artifact must be identical
  const mutated = Object.keys(afterV2).filter((k) => !/telemetry|dependency-dag|project-manifest|script-qa/.test(k) && now[k] !== afterV2[k]);
  assert(mutated.length === 0, `no versioned artifact mutated (exit ${r.code}; changed: ${mutated.join(",") || "none"})`);
});

runTest("a version that already has an owner approval is never overwritten by a rerun", () => {
  const rel = "script-qa/fss-phase7-gps-explainer@v2.json";
  const dp = path.join(root, "projects", P, rel);
  const decision = JSON.parse(fs.readFileSync(dp, "utf8"));
  fs.writeFileSync(dp, JSON.stringify(gate.withOwnerApproval(decision, { approvedBy: "owner", source: "test fixture" }), null, 2) + "\n");
  const before = snapshot(root);
  const r = run(root, "fss-config-v4.json");
  assert(r.code === 1 && /already has an owner approval/.test(r.err), "exit 1 with the owner-approval message");
  assert(JSON.stringify(snapshot(root)) === JSON.stringify(before), "approval record and project unchanged");
});

runTest("pronunciation entries that differ from the existing profile fail before any write", () => {
  const p = path.join(root, SCRIPT_DIR, "fss-config-v4.json");
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.pronunciation = c.pronunciation.filter((e) => e.displayTerm !== "L5");
  c.fssVersion = 3;
  fs.writeFileSync(path.join(root, SCRIPT_DIR, "fss-config-mismatch.json"), JSON.stringify(c));
  const before = snapshot(root);
  const r = run(root, "fss-config-mismatch.json");
  assert(r.code === 1 && /pronunciation entries differ/.test(r.err), "exit 1 with the profile-mismatch message");
  assert(JSON.stringify(snapshot(root)) === JSON.stringify(before), "project unchanged (no partial state)");
});

runTest("invalid input (missing script file) fails without touching the project", () => {
  const p = path.join(root, SCRIPT_DIR, "fss-config-v4.json");
  const c = JSON.parse(fs.readFileSync(p, "utf8"));
  c.scriptMd = `${SCRIPT_DIR}/does-not-exist.md`;
  c.fssVersion = 3;
  fs.writeFileSync(path.join(root, SCRIPT_DIR, "fss-config-missing.json"), JSON.stringify(c));
  const before = snapshot(root);
  const r = run(root, "fss-config-missing.json");
  assert(r.code !== 0, "non-zero exit");
  assert(JSON.stringify(snapshot(root)) === JSON.stringify(before), "project unchanged");
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n=== fss-canonicalize-versioning: ${failed} failed, ${passed} passed ===`);
process.exit(failed ? 1 : 0);
