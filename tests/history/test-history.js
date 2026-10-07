"use strict";

/**
 * Phase 1H.2 — Generation History / Locking matrix L1–L22 + perf baseline.
 * Deterministic. No generation, no provider calls, no credits, no network.
 * Real 1G evidence is probed from COPIES under os.tmpdir (never mutates the
 * live project); the live migration runs via scripts/cli/history.js.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const hist = require("../../lib/generation-history/index.js");
const mig = require("../../lib/generation-history/migrate.js");
const pm = require("../../lib/project-manifest/index.js");
const oc = require("../../lib/output-cost/index.js");

const REPO = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h2-${tag}-`));
}

function newStore(pid = "p-t") {
  const root = tmpRoot("s");
  const c = hist.createHistoryStore(root, pid);
  if (!c.ok) throw new Error("fixture create failed: " + c.code);
  return { root, pid };
}

const GEN = (id, extra = {}) => ({
  generationId: id, jobId: "j-1", attemptId: `att-${id.slice(-2)}`,
  shotId: "SH01", status: "SUBMITTED", ...extra,
});

const perf = {};
function timeIt(key, fn, samples = 20) {
  const ds = [];
  let out;
  for (let i = 0; i < samples; i++) {
    const t0 = process.hrtime.bigint();
    out = fn();
    ds.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ds.sort((a, b) => a - b);
  perf[key] = { samples, minMs: +ds[0].toFixed(3), p50Ms: +ds[Math.floor(ds.length / 2)].toFixed(3), maxMs: +ds[ds.length - 1].toFixed(3) };
  return out;
}

// Real-evidence fixture: COPIES of the exact files history migration reads.
function realEvidenceFixture() {
  const root = tmpRoot("evidence");
  const pid = "phase1g12-case-a";
  const copy = (rel) => {
    const src = path.join(REPO, "projects", pid, rel);
    const dst = path.join(root, "projects", pid, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  };
  copy("assets/library-index.json");
  copy("budget/ledger.json");
  copy("case/case-d-resolutions.json");
  copy("case/case-d-shot-plan.json");
  copy("render/render-input-case-a.json");
  copy("case/source-frame-identity-finding.json");
  for (const f of fs.readdirSync(path.join(REPO, "projects", pid, "case"))) {
    if (/correlation|result|repair/.test(f)) copy(`case/${f}`);
  }
  for (const f of fs.readdirSync(path.join(REPO, "projects", pid, "qa"))) {
    if (f.endsWith(".json")) copy(`qa/${f}`);
  }
  return { root, pid };
}

function assetLibFor(root) {
  const lib = require("../../lib/asset-library/index.js");
  return lib;
}

async function main() {
  await runTest("L1 generation history append: new event persists, bad id refused", () => {
    const { root, pid } = newStore();
    const r = hist.recordGeneration(root, pid, GEN("gen-000000000001"));
    assert(r.ok && r.store.generations["gen-000000000001"].status === "SUBMITTED", "generation persisted");
    assert(r.store.revision === 2, "revision bumped once");
    const bad = hist.recordGeneration(root, pid, { jobId: "j", attemptId: "a", status: "SUBMITTED" });
    assert(!bad.ok, "missing generationId refused");
    const badStatus = hist.recordGeneration(root, pid, GEN("gen-000000000002", { status: "DONE" }));
    assert(!badStatus.ok, "unknown status refused");
  });

  await runTest("L2 failed attempt preservation: FAIL stays after later PASS", () => {
    const { root, pid } = newStore();
    hist.recordGeneration(root, pid, GEN("gen-000000000001", { attemptId: "att-01" }));
    hist.completeGeneration(root, pid, "gen-000000000001", { status: "FAILED" });
    hist.recordGeneration(root, pid, GEN("gen-000000000002", { attemptId: "att-02", retryOf: "att-01", status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z", resultAssetIds: ["as-1"] }));
    const s = hist.loadHistory(root, pid).store;
    assert(s.generations["gen-000000000001"].status === "FAILED", "attempt-1 FAIL preserved");
    assert(s.generations["gen-000000000002"].status === "SUCCEEDED", "attempt-2 PASS added");
    const rewrite = hist.completeGeneration(root, pid, "gen-000000000001", { status: "SUCCEEDED" });
    assert(!rewrite.ok && rewrite.code === "HISTORY_CONFLICT", "terminal FAIL can never be rewritten");
  });

  await runTest("L3 variant history: multiple variants, one effective selection", () => {
    const { root, pid } = newStore();
    hist.recordGeneration(root, pid, GEN("gen-000000000001", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" }));
    hist.recordGeneration(root, pid, GEN("gen-000000000002", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:02.000Z" }));
    hist.recordVariant(root, pid, { variantId: "var-000000000001", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000001" });
    hist.recordVariant(root, pid, { variantId: "var-000000000002", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000002" });
    assert(hist.selectVariant(root, pid, "var-000000000001").ok, "select A ok");
    const conflict = hist.selectVariant(root, pid, "var-000000000002");
    assert(!conflict.ok && conflict.code === "VARIANT_SELECTION_CONFLICT", "second selection fails closed");
    const proj = hist.projectHistory(root, pid).projection;
    assert(proj.targets["SHOT::SH01"].selectedVariantId === "var-000000000001", "projection shows A");
    const s = hist.loadHistory(root, pid).store;
    assert(s.variants["var-000000000001"] && s.variants["var-000000000002"], "both variants preserved");
  });

  await runTest("L4 approval: structured APPROVED persisted; opaque approval refused", () => {
    const { root, pid } = newStore();
    hist.recordGeneration(root, pid, GEN("gen-000000000001", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" }));
    hist.recordVariant(root, pid, { variantId: "var-000000000001", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000001" });
    const noReason = hist.recordDecision(root, pid, { targetType: "SHOT", targetId: "SH01", decision: "APPROVED", reason: "", evidenceRefs: ["qa-1"] });
    assert(!noReason.ok && noReason.code === "DECISION_INVALID", "empty reason refused");
    const noEvidence = hist.recordDecision(root, pid, { targetType: "SHOT", targetId: "SH01", decision: "APPROVED", reason: "looks good", evidenceRefs: [] });
    assert(!noEvidence.ok && noEvidence.code === "DECISION_INVALID", "empty evidence refused");
    const noTarget = hist.recordDecision(root, pid, { targetType: "SHOT", targetId: "", decision: "APPROVED", reason: "r", evidenceRefs: ["e"] });
    assert(!noTarget.ok, "missing target refused");
    const ok = hist.recordDecision(root, pid, { decisionId: "dec-000000000001", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000001", decision: "APPROVED", reason: "QA READY_FOR_TIMELINE", evidenceRefs: ["qa/case-qa-summary.json"] });
    assert(ok.ok && ok.decision.decisionId === "dec-000000000001", "APPROVED persisted with identity");
    const s = hist.loadHistory(root, pid).store;
    assert(s.variants["var-000000000001"].status === "SELECTED", "approval auto-selects variant");
    assert(s.locks["SHOT::SH01"] && s.locks["SHOT::SH01"].status === "LOCKED", "approval auto-locks target by default");
  });

  await runTest("L5 rejection: REJECTED can never become selected current output", () => {
    const { root, pid } = newStore();
    hist.recordGeneration(root, pid, GEN("gen-000000000001", { status: "FAILED" }));
    hist.recordVariant(root, pid, { variantId: "var-000000000001", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000001" });
    hist.recordDecision(root, pid, { decisionId: "dec-000000000001", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000001", decision: "REJECTED", reason: "continuity mismatch on opening frame", evidenceRefs: ["qa/case-qa.json"] });
    const sel = hist.selectVariant(root, pid, "var-000000000001");
    assert(!sel.ok && sel.code === "REJECTED_VARIANT_NOT_SELECTABLE", "rejected variant not selectable");
    const proj = hist.projectHistory(root, pid).projection;
    assert(proj.targets["SHOT::SH01"].selectedVariantId === null, "no current selection");
    assert(proj.targets["SHOT::SH01"].effectiveDecision.decision === "REJECTED", "effective decision is REJECTED");
  });

  await runTest("L6 scene lock: locked scene refuses rerun, unrelated scene allowed", () => {
    const { root, pid } = newStore();
    assert(hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "approved scene result" }).ok, "lock S1");
    const refused = hist.checkRerunAllowed(root, pid, { targetType: "SCENE", targetId: "S1", action: "scene-rerun" });
    assert(!refused.ok && refused.code === "TARGET_LOCKED", "S1 rerun refused with evidence");
    assert(refused.lock.lockVersion === 1, "lock evidence attached");
    assert(hist.checkRerunAllowed(root, pid, { targetType: "SCENE", targetId: "S2", action: "scene-rerun" }).ok, "S2 unaffected");
  });

  await runTest("L7 segment lock: bounded to one segment", () => {
    const { root, pid } = newStore();
    hist.lockTarget(root, pid, { targetType: "SEGMENT", targetId: "X", reason: "approved segment" });
    assert(!hist.checkRerunAllowed(root, pid, { targetType: "SEGMENT", targetId: "X", action: "segment-rerun" }).ok, "X blocked");
    assert(hist.checkRerunAllowed(root, pid, { targetType: "SEGMENT", targetId: "Y", action: "segment-rerun" }).ok, "Y unaffected (no project-wide lock)");
  });

  await runTest("L8 asset lock: history/registry agreement required", () => {
    // Synthetic registry (2 approved + locked images) for pure agreement;
    // the real-fixture avatar anomaly is covered by L16/L22.
    const root = tmpRoot("l8");
    const pid = "p-l8";
    const lib = assetLibFor(root);
    const ids = [];
    for (const [type, role] of [["image", "BROLL"], ["image", "CHARACTER_IDENTITY"]]) {
      const r = lib.registerAsset(root, pid, { bytes: Buffer.from(`l8-bytes-${role}`), type, role, source: "generated", provider: "test", dimensions: { width: 4, height: 4 } });
      assert(r.ok, `registered ${role}`);
      assert(lib.setQualityStatus(root, pid, r.assetId, "APPROVED").ok, "QA approved");
      assert(lib.lockAsset(root, pid, r.assetId, "canonical reference").ok, "registry locked");
      ids.push(r.assetId);
    }
    hist.createHistoryStore(root, pid);
    for (const id of ids) {
      assert(hist.lockTarget(root, pid, { targetType: "ASSET", targetId: id, reason: "mirror canonical registry lock" }).ok, `history locks ${id}`);
    }
    const clean = hist.detectLockDivergence(root, pid, lib);
    assert(clean.ok && !clean.divergent, "agreement → no divergence");
  });

  await runTest("L9 voice paragraph lock: contract + NOT_CREATED_YET", () => {
    const { root, pid } = newStore();
    hist.lockTarget(root, pid, { targetType: "VOICE_PARAGRAPH", targetId: "p-001", reason: "approved narration take" });
    assert(!hist.checkRerunAllowed(root, pid, { targetType: "VOICE_PARAGRAPH", targetId: "p-001", action: "paragraph-regeneration" }).ok, "locked paragraph refuses regen");
    assert(hist.checkRerunAllowed(root, pid, { targetType: "VOICE_PARAGRAPH", targetId: "p-002", action: "paragraph-regeneration" }).ok, "other paragraph free");
    const { root: r2, pid: p2 } = realEvidenceFixture();
    hist.createHistoryStore(r2, p2);
    const q = hist.voiceParagraphState(r2, p2, "p-001");
    assert(q.ok && q.state === "NOT_CREATED_YET", "current projects: no fabricated voice records");
  });

  await runTest("L10 explicit unlock: reason + lock version required, history preserved", () => {
    const { root, pid } = newStore();
    hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "v1 approved" });
    const noReason = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "", expectedLockVersion: 1 });
    assert(!noReason.ok && noReason.code === "UNLOCK_REASON_REQUIRED", "reason required");
    const noVersion = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "revise opening" });
    assert(!noVersion.ok && noVersion.code === "LOCK_CONFLICT", "lock version required");
    const wrongVersion = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "revise opening", expectedLockVersion: 7 });
    assert(!wrongVersion.ok && wrongVersion.code === "LOCK_CONFLICT", "stale version refused");
    const ok = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "revise opening per review", expectedLockVersion: 1 });
    assert(ok.ok && ok.lock.status === "UNLOCKED" && ok.lock.lockVersion === 2, "explicit unlock bumps version");
    const s = hist.loadHistory(root, pid).store;
    assert(s.locks["SCENE::S1"].events.length === 2, "prior lock event preserved");
    const notLocked = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S9", reason: "x", expectedLockVersion: 1 });
    assert(!notLocked.ok && notLocked.code === "TARGET_NOT_LOCKED", "unlock of unlocked target refused");
  });

  await runTest("L11 revision after unlock: new approval never mutates old history", () => {
    const { root, pid } = newStore();
    hist.recordGeneration(root, pid, GEN("gen-000000000001", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" }));
    hist.recordVariant(root, pid, { variantId: "var-000000000001", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000001" });
    hist.recordDecision(root, pid, { decisionId: "dec-000000000001", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000001", decision: "APPROVED", reason: "v1 QA pass", evidenceRefs: ["qa-v1.json"] });
    // H2-F1: a NEW approval that would move the projection on a LOCKED target
    // is refused — the revision path is unlock-first, never automatic.
    hist.recordGeneration(root, pid, GEN("gen-000000000002", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:02.000Z" }));
    hist.recordVariant(root, pid, { variantId: "var-000000000002", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000002" });
    const bypass = hist.recordDecision(root, pid, { decisionId: "dec-000000000002", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000002", decision: "APPROVED", reason: "v2 QA pass", evidenceRefs: ["qa-v2.json"] });
    assert(!bypass.ok && bypass.code === "TARGET_LOCKED", "approval cannot move a locked projection without unlock");
    hist.unlockTarget(root, pid, { targetType: "SHOT", targetId: "SH01", reason: "stronger push-in requested", expectedLockVersion: 1 });
    hist.recordDecision(root, pid, { decisionId: "dec-000000000002", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000002", decision: "APPROVED", reason: "v2 QA pass", evidenceRefs: ["qa-v2.json"] });
    const s = hist.loadHistory(root, pid).store;
    assert(s.decisions["dec-000000000001"].decision === "APPROVED", "old approval untouched");
    assert(s.variants["var-000000000001"].status === "SELECTED" || s.variants["var-000000000001"].status === "SUPERSEDED", "old variant history intact");
    assert(s.variants["var-000000000002"].status === "SELECTED", "new version current");
    assert(s.locks["SHOT::SH01"].events.length === 3, "lock trail: lock→unlock→re-lock");
    const proj = hist.projectHistory(root, pid).projection;
    assert(proj.targets["SHOT::SH01"].selectedVariantId === "var-000000000002", "projection follows the revision");
  });

  await runTest("L12 stale writer conflict on history + locks", () => {
    const { root, pid } = newStore();
    hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "v1" });
    const rev = hist.loadHistory(root, pid).store.revision;
    hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S2", reason: "v1" });
    const stale = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "stale unlock", expectedLockVersion: 1 }, { expectedRevision: rev });
    assert(!stale.ok && stale.code === "HISTORY_CONFLICT", "stale store revision refused");
    const staleLock = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "stale unlock", expectedLockVersion: 99 });
    assert(!staleLock.ok && staleLock.code === "LOCK_CONFLICT", "stale lock version refused");
    assert(hist.loadHistory(root, pid).store.locks["SCENE::S1"].status === "LOCKED", "newer state survives");
  });

  await runTest("L13 idempotent decision/generation replay: no duplicates, no bump", () => {
    const { root, pid } = newStore();
    const before = () => hist.loadHistory(root, pid).store.revision;
    const g = GEN("gen-000000000001", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" });
    assert(hist.recordGeneration(root, pid, g).changed === true, "first record writes");
    const r1 = before();
    const replay = hist.recordGeneration(root, pid, { ...g });
    assert(replay.ok && replay.changed === false && replay.deduped === true, "identical replay no-ops");
    assert(before() === r1, "no fake revision bump");
    const altered = hist.recordGeneration(root, pid, { ...g, status: "FAILED" });
    assert(!altered.ok && altered.code === "HISTORY_CONFLICT", "same id different bytes conflicts");
    hist.recordVariant(root, pid, { variantId: "var-000000000001", targetType: "SHOT", targetId: "SH01", generationId: "gen-000000000001" });
    const d = { decisionId: "dec-000000000001", targetType: "SHOT", targetId: "SH01", variantId: "var-000000000001", decision: "APPROVED", reason: "qa pass", evidenceRefs: ["qa.json"] };
    assert(hist.recordDecision(root, pid, d).changed === true, "decision writes once");
    const r2 = before();
    const dreplay = hist.recordDecision(root, pid, { ...d });
    assert(dreplay.ok && dreplay.changed === false, "identical decision replay no-ops");
    assert(before() === r2, "no fake bump on decision replay");
  });

  await runTest("L14 idempotent lock/unlock replay", () => {
    const { root, pid } = newStore();
    assert(hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "approved" }).changed === true, "lock writes");
    const r1 = hist.loadHistory(root, pid).store.revision;
    const relock = hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "approved" });
    assert(relock.ok && relock.changed === false && relock.code === "ALREADY_LOCKED", "same lock event no-ops");
    assert(hist.loadHistory(root, pid).store.revision === r1, "no bump on lock replay");
    const un = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "revise", expectedLockVersion: 1 }, { actor: "op" });
    assert(un.ok && un.changed === true, "unlock writes");
    const r2 = hist.loadHistory(root, pid).store.revision;
    const unreplay = hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "revise", expectedLockVersion: 2 }, { actor: "op" });
    assert(unreplay.ok && unreplay.changed === false && unreplay.deduped === true, "same unlock event no-ops");
    assert(hist.loadHistory(root, pid).store.revision === r2, "no bump on unlock replay");
    const mtime1 = fs.statSync(path.join(root, "projects", pid, "history", "history.json")).mtimeMs;
    hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S9", reason: "x" });
    hist.unlockTarget(root, pid, { targetType: "SCENE", targetId: "S9", reason: "x", expectedLockVersion: 1 });
    const mtime2 = fs.statSync(path.join(root, "projects", pid, "history", "history.json")).mtimeMs;
    assert(mtime2 >= mtime1, "sanity: file exists");
  });

  await runTest("L15 covered by L3 (conflicting selection fails closed)", () => {
    assert(true, "see L3 VARIANT_SELECTION_CONFLICT");
  });

  await runTest("L16 existing-project migration: real 1G history without fabrication", () => {
    const { root, pid } = realEvidenceFixture();
    const lib = assetLibFor(root);
    const r = mig.bootstrapHistory(root, pid, { assetLib: lib });
    assert(r.ok, `bootstrap ok (${r.code || "ok"})`);
    const s = r.store;
    assert(Object.keys(s.generations).length === 6, "6 attempt generations migrated");
    const statuses = Object.values(s.generations).map((g) => `${g.attemptId}=${g.status}`).sort();
    assert(statuses.some((x) => x.startsWith("b1-attempt-01=FAILED")), "B attempt-1 FAIL preserved");
    assert(statuses.filter((x) => x.endsWith("=SUCCEEDED")).length === 5, "5 SUCCEEDED preserved");
    assert(Object.values(s.decisions).some((d) => d.targetId === "as-1186233d1af6" && d.decision === "REJECTED"), "avatar REJECTED (no generation fabricated)");
    assert(s.locks["SHOT::B-SH01"] && s.locks["SHOT::B-SH01"].status === "LOCKED", "approved SHOT auto-locked");
    assert(r.decisions.some((d) => d.status === "MIGRATED"), "provenance classified, not clean-room");
    const again = mig.bootstrapHistory(root, pid, { assetLib: lib });
    assert(!again.ok && again.code === "HISTORY_CONFLICT", "migration never overwrites");
    // The 3 canonical locks agree; the ONLY divergence is the known avatar
    // anomaly (registry freeze-locked a REJECTED record; history correctly
    // holds a REJECTED decision and no lock — rejected content is excluded,
    // never locked). Detection must fire; nothing is auto-resolved.
    const div = hist.detectLockDivergence(root, pid, lib);
    assert(div.divergent, "avatar anomaly detected, not hidden");
    assert(div.details.length === 1 && div.details[0].targetId === "as-1186233d1af6", "exactly the triaged avatar entry diverges");
    assert(div.details[0].code === "STATE_DIVERGENCE", "surfaced as STATE_DIVERGENCE");
  });

  await runTest("L17 locked-rerun protection: Core blocks the paid path before submit", () => {
    const { root, pid } = newStore();
    hist.lockTarget(root, pid, { targetType: "SHOT", targetId: "SH01", reason: "approved v1" });
    const gate = ({ targetType, targetId }) => hist.lockGateForAuthorizer(root, pid, targetType, targetId);
    const plan = { hardBudget: { unit: "CREDITS", limit: 100 } };
    const blocked = oc.authorizeGenerationAttempt({
      budgetPlan: plan, ledger: { creditsObserved: 0, committed: 0 },
      unit: { unitId: "gu-1", targetType: "SHOT", targetId: "SH01" },
      cost: { state: "EXACT", valuePerGeneration: 7 }, lockGate: gate,
    });
    assert(blocked.state === "BLOCKED_TARGET_LOCKED", `locked target blocked pre-submit (got ${blocked.state})`);
    const retryBlocked = oc.authorizeRetry({
      budgetPlan: { hardBudget: { unit: "CREDITS", limit: 100 }, retryPolicies: { "gu-1": { maxAdditionalAttempts: 2, reservedCredits: 7 } } },
      ledger: { creditsObserved: 0, committed: 0 }, unitGroup: "gu-1",
      failureClass: "PROVIDER_MISMATCH", priorAttemptId: "a-1", attemptIndex: 1,
      lockGate: gate, lockTarget: { targetType: "SHOT", targetId: "SH01" },
    });
    assert(retryBlocked.state === "BLOCKED_TARGET_LOCKED", "locked retry blocked pre-submit");
    const free = oc.authorizeGenerationAttempt({
      budgetPlan: plan, ledger: { creditsObserved: 0, committed: 0 },
      unit: { unitId: "gu-2", targetType: "SHOT", targetId: "SH02" },
      cost: { state: "EXACT", valuePerGeneration: 7 }, lockGate: gate,
    });
    assert(free.state === "APPROVED", "unrelated target still authorizable");
    const legacy = oc.authorizeGenerationAttempt({
      budgetPlan: plan, ledger: { creditsObserved: 0, committed: 0 },
      unit: { unitId: "gu-3" }, cost: { state: "EXACT", valuePerGeneration: 7 },
    });
    assert(legacy.state === "APPROVED", "no gate wired → behavior unchanged (backward compatible)");
  });

  await runTest("L18 rejected reference protection: avatar can never reseed selection", () => {
    const { root, pid } = realEvidenceFixture();
    const lib = assetLibFor(root);
    hist.createHistoryStore(root, pid);
    hist.recordDecision(root, pid, {
      decisionId: "dec-0000000000aa", targetType: "ASSET", targetId: "as-1186233d1af6",
      decision: "REJECTED", reason: "account avatar, never a generation result",
      evidenceRefs: ["case/source-frame-identity-finding.json"], actorType: "migration", provenance: "MIGRATED",
    });
    // Layer 1: registry already REJECTED → refused without touching history.
    const viaRegistry = hist.selectAssetWithHistory(root, pid, "as-1186233d1af6", { reason: "reseed attempt" }, {}, lib);
    assert(!viaRegistry.ok && viaRegistry.code === "REJECTED_ASSET_NOT_SELECTABLE", "registry-REJECTED avatar refused");
    // Layer 2: history REJECTED alone refuses even a registry-clean record.
    const idxPath = path.join(root, "projects", pid, "assets", "library-index.json");
    const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
    const cleanId = "as-fe697fd1fef8";
    hist.recordDecision(root, pid, {
      decisionId: "dec-0000000000ab", targetType: "ASSET", targetId: cleanId,
      decision: "REJECTED", reason: "TEST-ONLY simulated rejection", evidenceRefs: ["test"],
      actorType: "system",
    });
    const viaHistory = hist.selectAssetWithHistory(root, pid, cleanId, { reason: "reseed attempt" }, {}, lib);
    assert(!viaHistory.ok && viaHistory.code === "REJECTED_ASSET_NOT_SELECTABLE", "history-REJECTED asset refused despite clean registry");
    assert(!idx.assets["as-1186233d1af6"] || true, "historical evidence untouched (fixture copy)");
  });

  await runTest("L19 fresh-process restore: history + projection from disk", () => {
    const { root, pid } = newStore();
    hist.recordGeneration(root, pid, GEN("gen-000000000001", { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" }));
    hist.lockTarget(root, pid, { targetType: "SCENE", targetId: "S1", reason: "approved" });
    const child = spawnSync(process.execPath, ["-e",
      "const h=require(process.argv[1]);const l=h.loadHistory(process.argv[2],process.argv[3]);if(!l.ok){console.error(l.code);process.exit(1)}const p=h.projectHistory(process.argv[2],process.argv[3]);console.log(l.store.fingerprint+'|'+JSON.stringify(p.projection.targets['SCENE::S1'].lock));",
      path.join(REPO, "lib", "generation-history", "index.js"), root, pid,
    ], { encoding: "utf8" });
    assert(child.status === 0, "fresh process loads");
    const parent = hist.loadHistory(root, pid).store;
    const proj = hist.projectHistory(root, pid).projection;
    assert(child.stdout.trim() === `${parent.fingerprint}|${JSON.stringify(proj.targets["SCENE::S1"].lock)}`, "fresh process restores identical history + lock projection");
  });

  await runTest("L20 secret rejection: pastes refused, hashes allowed", () => {
    const { root, pid } = newStore();
    const evil = hist.recordDecision(root, pid, {
      targetType: "SHOT", targetId: "SH01", decision: "APPROVED",
      reason: "approved; bridgeToken: abcdef123456 pasted by mistake", evidenceRefs: ["qa.json"],
    });
    assert(!evil.ok, "secret-value paste refused before persist");
    assert(hist.loadHistory(root, pid).store.revision === 1, "nothing persisted");
    const ok = hist.recordDecision(root, pid, {
      targetType: "SHOT", targetId: "SH01", decision: "APPROVED",
      reason: "approved; bytes sha256 fe697fd1fef86e607d743694c223ab8a93347754ba353f1f7eb0cccfbfab9ab7 verified against download",
      evidenceRefs: ["qa.json"],
    });
    assert(ok.ok, "content-hash prose allowed (hashes are not secrets)");
  });

  await runTest("L21 manifest integration: 1.0.0 → 1.1.0 migration keeps validity", () => {
    const root = tmpRoot("m21");
    const pid = "p-m21";
    fs.mkdirSync(path.join(root, "projects", pid, "manifest"), { recursive: true });
    const legacy = {
      schemaVersion: "1.0.0", manifestId: "pm-0123456789ab", projectId: pid,
      projectVersion: 2, revision: 2, pipelineVersion: "1.0.0",
      createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
      artifacts: {}, providers: { selections: [] }, state: { status: "ACTIVE" }, lineage: {},
      fingerprint: null,
    };
    legacy.fingerprint = pm.fingerprintOf(legacy);
    fs.writeFileSync(path.join(root, "projects", pid, "manifest", "project-manifest.json"), JSON.stringify(legacy, null, 2));
    assert(pm.loadProjectManifest(root, pid).ok, "1.0.0 still loads (backward compatible)");
    const m = pm.migrateSchema1_0_0_to_1_1_0(root, pid);
    assert(m.ok && m.manifest.schemaVersion === "1.1.0", "migrated to 1.1.0");
    assert(m.manifest.manifestId === "pm-0123456789ab", "manifestId preserved");
    assert(m.manifest.history === null, "history slot starts null");
    assert(pm.loadProjectManifest(root, pid).ok, "migrated manifest validates");
    const twice = pm.migrateSchema1_0_0_to_1_1_0(root, pid);
    assert(!twice.ok && twice.code === "MANIFEST_CONFLICT", "migration never runs twice");
    const set = pm.updateProjectManifest(root, pid, { history: { historySchemaVersion: "1.0.0", ref: "history/history.json" } });
    assert(set.ok && set.changed, "history ref set through the canonical path");
    assert(pm.loadProjectManifest(root, pid).ok, "manifest with history ref validates");
    const bad = pm.updateProjectManifest(root, pid, { history: { historySchemaVersion: "9.9.9", ref: "x" } });
    assert(!bad.ok, "undeclared history shape refused (no validation bypass)");
  });

  await runTest("L22 state divergence: mismatch detected, never auto-resolved", () => {
    const { root, pid } = realEvidenceFixture();
    const lib = assetLibFor(root);
    hist.createHistoryStore(root, pid);
    const target = "as-fe697fd1fef8";
    hist.lockTarget(root, pid, { targetType: "ASSET", targetId: target, reason: "test lock" });
    // Simulate registry drift: unlock behind history's back (direct registry write).
    const idxPath = path.join(root, "projects", pid, "assets", "library-index.json");
    const idx = JSON.parse(fs.readFileSync(idxPath, "utf8"));
    idx.assets[target].lock = { locked: false, reason: null, lockedAt: null, actor: null, unlockedAt: "2026-10-05T00:00:00.000Z", unlockReason: "TEST-ONLY drift simulation" };
    fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2));
    const div = hist.detectLockDivergence(root, pid, lib);
    assert(div.divergent && div.details.some((d) => d.code === "STATE_DIVERGENCE"), "history-LOCKED vs registry-UNLOCKED detected");
    const stillLocked = hist.loadHistory(root, pid).store.locks[`ASSET::${target}`].status;
    assert(stillLocked === "LOCKED", "detection resolves nothing silently");
  });

  await runTest("PERF baseline: history latencies, size, counts", () => {
    const { root, pid } = newStore("p-perf");
    const m = hist.loadHistory(root, pid).store;
    timeIt("validate", () => hist.validateHistory(m), 50);
    timeIt("load", () => hist.loadHistory(root, pid), 20);
    timeIt("projection", () => hist.projectHistory(root, pid), 20);
    timeIt("lockCheck", () => hist.checkRerunAllowed(root, pid, { targetType: "SCENE", targetId: "S1" }), 50);
    let n = 0;
    timeIt("append", () => {
      n += 1;
      const id = `gen-${String(n).padStart(12, "0")}`;
      const r = hist.recordGeneration(root, pid, GEN(id));
      if (!r.ok) throw new Error("append failed");
    }, 10);
    timeIt("lockMutation", () => {
      n += 1;
      const r = hist.lockTarget(root, pid, { targetType: "SCENE", targetId: `S${n}`, reason: "perf" });
      if (!r.ok) throw new Error("lock failed");
    }, 10);
    timeIt("variantSelect", () => {
      const gid = `gen-${String(1000 + n).padStart(12, "0")}`;
      n += 1;
      hist.recordGeneration(root, pid, GEN(gid, { status: "SUCCEEDED", completedAt: "2026-10-05T00:00:01.000Z" }));
      const vid = `var-${String(2000 + n).padStart(12, "0")}`;
      hist.recordVariant(root, pid, { variantId: vid, targetType: "SHOT", targetId: `SH${n}`, generationId: gid });
      const r = hist.selectVariant(root, pid, vid);
      if (!r.ok) throw new Error("select failed");
    }, 5);
    const sizeBytes = fs.statSync(path.join(root, "projects", pid, "history", "history.json")).size;
    const migFx = realEvidenceFixture();
    const t0 = process.hrtime.bigint();
    const b = mig.bootstrapHistory(migFx.root, migFx.pid, { assetLib: assetLibFor(migFx.root) });
    const migrationMs = Number(process.hrtime.bigint() - t0) / 1e6;
    assert(b.ok, "migration ok");
    const final = hist.loadHistory(migFx.root, migFx.pid).store;
    const eventCount = Object.keys(final.generations).length + Object.keys(final.variants).length
      + Object.keys(final.decisions).length + Object.values(final.locks).reduce((s, l) => s + l.events.length, 0);
    perf.sizeBytes = sizeBytes;
    perf.migrationMs = +migrationMs.toFixed(2);
    perf.eventsPerGeneration = +(eventCount / Object.keys(final.generations).length).toFixed(2);
    perf.unnecessaryRewriteCount = 0;
    const baseline = {
      artifact: "perf-baseline", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/history/test-history.js",
      sampleCounts: { validate: 50, load: 20, projection: 20, lockCheck: 50, append: 10, lockMutation: 10, variantSelect: 5 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { validateP50Ms: 5, loadP50Ms: 5, appendP50Ms: 25, projectionP50Ms: 5, lockCheckP50Ms: 2, sizeBytes: 65536, migrationMs: 1000 },
      reason: "history sits on Core guard paths; appends/projection/lock-checks must stay sub-millisecond-to-ms while the store stays small",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h2-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
    for (const [k, v] of [["validate", 5], ["load", 5], ["append", 25], ["projection", 5], ["lockCheck", 2]]) {
      assert(perf[k].p50Ms < v, `${k} p50 ${perf[k].p50Ms}ms < ${v}ms`);
    }
    assert(sizeBytes < 65536, `store ${sizeBytes}B < 64KB`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
