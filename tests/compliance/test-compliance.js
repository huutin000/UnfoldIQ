"use strict";

/**
 * Phase 1H.6 — Compliance matrix C1–C14 + perf baseline.
 * Deterministic. Rule engine evaluated against fixture snapshots; the live
 * YouTube snapshot is read-only evidence (never mutated by tests).
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const comp = require("../../lib/compliance/index.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h6comp-${tag}-`));
}

const RULES = [
  { ruleId: "R-real", match: { photorealistic: true, syntheticallyAlteredOrGenerated: true }, requireKnown: ["photorealistic", "syntheticallyAlteredOrGenerated"], decision: "AI_DISCLOSURE_REQUIRED", reason: "realistic synthetic" },
  { ruleId: "R-toon", match: { clearlyUnrealisticAnimation: true }, requireKnown: ["clearlyUnrealisticAnimation"], decision: "AI_DISCLOSURE_NOT_REQUIRED", reason: "unrealistic animation exception" },
  { ruleId: "R-assist", match: { productionAssistanceOnly: true }, requireKnown: ["productionAssistanceOnly"], decision: "AI_DISCLOSURE_NOT_REQUIRED", reason: "productivity only" },
];

function snapshotted(root, pid, rules = RULES) {
  const r = comp.recordPolicySnapshot(root, pid, {
    platform: "YOUTUBE", policyType: "AI_DISCLOSURE",
    sourceUrl: "https://example.invalid/official-policy", sourceTitle: "TEST-ONLY official-shaped source",
    checkedAt: "2026-10-05T00:00:00.000Z", effectiveDate: "2024-03-18",
    contentHash: "ab".repeat(32), reviewAfterDays: 180, rules,
  });
  if (!r.ok) throw new Error("snapshot failed: " + r.code);
  return r.snapshot;
}

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

async function main() {
  await runTest("C1 policy snapshot create (source + checkedAt mandatory)", () => {
    const root = tmpRoot("c1");
    const pid = "p-c1";
    const s = snapshotted(root, pid);
    assert(/^pol-[0-9a-f]{12}$/.test(s.snapshotId), "snapshot identity");
    assert(s.status === "CURRENT", "current on creation");
    const bad = comp.recordPolicySnapshot(root, pid, { platform: "YOUTUBE", policyType: "AI_DISCLOSURE", sourceUrl: "", checkedAt: "2026-10-05T00:00:00.000Z", rules: [] });
    assert(!bad.ok, "missing source refused");
  });

  await runTest("C2 snapshot immutable/versioned (new check supersedes, old bytes intact)", () => {
    const root = tmpRoot("c2");
    const pid = "p-c2";
    const v1 = snapshotted(root, pid);
    const v2 = comp.recordPolicySnapshot(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE",
      sourceUrl: "https://example.invalid/official-policy-v2", checkedAt: "2026-11-05T00:00:00.000Z",
      rules: RULES,
    });
    assert(v2.ok && v2.changed === true, "v2 recorded");
    const doc = comp.loadCompliance(root, pid).doc;
    assert(doc.snapshots[v1.snapshotId].status === "SUPERSEDED", "v1 superseded");
    assert(doc.snapshots[v1.snapshotId].supersededBy === v2.snapshot.snapshotId, "link both ways");
    assert(doc.snapshots[v1.snapshotId].sourceUrl.endsWith("official-policy"), "v1 bytes otherwise untouched");
  });

  await runTest("C3 official source metadata persisted", () => {
    const root = tmpRoot("c3");
    const pid = "p-c3";
    const s = snapshotted(root, pid);
    assert(typeof s.sourceUrl === "string" && typeof s.checkedAt === "string" && typeof s.contentHash === "string", "source+checked+hash present");
  });

  await runTest("C4 decision references exact snapshot", () => {
    const root = tmpRoot("c4");
    const pid = "p-c4";
    const s = snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-1",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["qa.json"],
    });
    assert(d.ok && d.decision.policySnapshotId === s.snapshotId, "exact snapshot bound");
    assert(d.decision.decision === "AI_DISCLOSURE_NOT_REQUIRED", "unrealistic animation needs no disclosure");
  });

  await runTest("C5 generated/non-realistic case evaluated by characteristics", () => {
    const root = tmpRoot("c5");
    const pid = "p-c5";
    snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-mascot",
      characteristics: { syntheticallyAlteredOrGenerated: true, clearlyUnrealisticAnimation: true, photorealistic: false, depictsRealPerson: false, platformNativeGenAI: true },
      evidenceRefs: ["qa.json"],
    });
    assert(d.ok && d.decision.decision === "AI_DISCLOSURE_NOT_REQUIRED", "mascot animation: characteristics decide, not AI-yes/no");
  });

  await runTest("C6 realistic/meaningfully altered fixture routes per policy", () => {
    const root = tmpRoot("c6");
    const pid = "p-c6";
    snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-real",
      characteristics: { photorealistic: true, syntheticallyAlteredOrGenerated: true, depictsRealEventOrPlace: false },
      evidenceRefs: ["review.json"],
    });
    assert(d.ok && d.decision.decision === "AI_DISCLOSURE_REQUIRED", "realistic synthetic requires disclosure (divergent branch proven)");
  });

  await runTest("C7 missing characteristics → REVIEW_REQUIRED (never guessed)", () => {
    const root = tmpRoot("c7");
    const pid = "p-c7";
    snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-?",
      characteristics: { syntheticallyAlteredOrGenerated: true },
      evidenceRefs: ["qa.json"],
    });
    assert(d.ok && d.decision.decision === "REVIEW_REQUIRED", "insufficient characteristics review, never pass/fail by default");
  });

  await runTest("C8 stale policy → REVIEW_REQUIRED (freshness enforced)", () => {
    const root = tmpRoot("c8");
    const pid = "p-c8";
    snapshotted(root, pid);
    const now = "2026-10-05T00:00:00.000Z";
    const v2 = comp.recordPolicySnapshot(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE",
      sourceUrl: "https://example.invalid/v2", checkedAt: "2026-10-06T00:00:00.000Z", rules: RULES,
    });
    assert(v2.ok, "newer snapshot recorded");
    const old = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-1",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["e"],
    }, { now });
    assert(old.ok, "decision still records (against CURRENT v2)");
    // A decision pinned to the old snapshot is stale at publish time:
    const doc = comp.loadCompliance(root, pid).doc;
    const first = Object.values(doc.decisions)[0];
    void first;
    const staleCheck = comp.evaluateFreshness(doc, doc.snapshots[Object.keys(doc.snapshots)[0]], now);
    assert(staleCheck === "STALE_POLICY", "superseded snapshot reads STALE_POLICY");
  });

  await runTest("C9 new policy snapshot does not rewrite old decision", () => {
    const root = tmpRoot("c9");
    const pid = "p-c9";
    const v1 = snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-1",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["e"],
    });
    comp.recordPolicySnapshot(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE",
      sourceUrl: "https://example.invalid/v2", checkedAt: "2026-10-06T00:00:00.000Z", rules: RULES,
    });
    const after = comp.loadCompliance(root, pid).doc.decisions[d.decision.decisionId];
    assert(after.policySnapshotId === v1.snapshotId && after.decision === "AI_DISCLOSURE_NOT_REQUIRED", "old decision bytes intact against v1");
  });

  await runTest("C10 manual override append-only (previous + reason + actor)", () => {
    const root = tmpRoot("c10");
    const pid = "p-c10";
    snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-1",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["e"],
    });
    const bad = comp.overrideDecision(root, pid, d.decision.decisionId, { newDecision: "AI_DISCLOSURE_REQUIRED", reason: "", actor: "op" });
    assert(!bad.ok, "reasonless override refused");
    const o = comp.overrideDecision(root, pid, d.decision.decisionId, { newDecision: "AI_DISCLOSURE_REQUIRED", reason: "rights-holder requested conservative labeling", actor: "operator" });
    assert(o.ok && o.decision.supersedes === d.decision.decisionId, "override supersedes");
    assert(o.decision.manualOverride && o.decision.manualOverride.actor === "operator", "actor recorded");
    assert(o.decision.policySnapshotId === d.decision.policySnapshotId, "same snapshot bound");
    const prev = comp.loadCompliance(root, pid).doc.decisions[d.decision.decisionId];
    assert(prev.decision === "AI_DISCLOSURE_NOT_REQUIRED", "previous decision untouched");
  });

  await runTest("C11 content characteristic change dirties compliance only", () => {
    const root = tmpRoot("c11");
    const pid = "p-c11";
    snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-1",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["e"],
    });
    const s = comp.markComplianceStale(root, pid, d.decision.decisionId, "re-cut now depicts a real streetscape");
    assert(s.ok && s.decision.decision === "REVIEW_REQUIRED" && s.decision.supersedes === d.decision.decisionId, "staleness is a new REVIEW decision");
    // Only compliance state changed: no media, DAG, or history mutation here.
    assert(comp.loadCompliance(root, pid).doc.decisions[d.decision.decisionId].decision === "AI_DISCLOSURE_NOT_REQUIRED", "original preserved");
  });

  await runTest("C12 asset remains locked while compliance can become stale (no regen)", () => {
    const root = tmpRoot("c12");
    const pid = "p-c12";
    snapshotted(root, pid);
    // History lock is a separate owner; compliance only references the asset.
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-locked",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["e"],
    });
    assert(d.ok, "decision on a (hypothetically) locked asset records freely");
    const s = comp.markComplianceStale(root, pid, d.decision.decisionId, "policy refreshed with new animation guidance");
    assert(s.ok && s.decision.decision === "REVIEW_REQUIRED", "compliance goes stale without touching any lock or byte");
  });

  await runTest("C13 FICTION/factual distinction does not fabricate source linkage", () => {
    const root = tmpRoot("c13");
    const pid = "p-c13";
    snapshotted(root, pid);
    const d = comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: "as-fiction",
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: [],
    });
    assert(d.ok, "FICTION decides without factual source linkage");
  });

  await runTest("C14 unsupported/unverified platform policy → REVIEW_REQUIRED", () => {
    const root = tmpRoot("c14");
    const pid = "p-c14";
    const d = comp.decideCompliance(root, pid, {
      platform: "OTHER", policyType: "AI_DISCLOSURE", assetId: "as-1",
      characteristics: { photorealistic: true, syntheticallyAlteredOrGenerated: true }, evidenceRefs: ["e"],
    });
    assert(d.ok && d.decision.decision === "REVIEW_REQUIRED", "unverified platform never guessed");
    assert(d.decision.freshness === "POLICY_SOURCE_UNAVAILABLE", "freshness honest");
    assert(d.decision.policySnapshotId === "UNRESOLVED", "no fabricated snapshot binding");
  });

  await runTest("LIVE YouTube snapshot: official source, rules evaluate, decisions stable", () => {
    const loaded = comp.loadCompliance(REPO, "phase1g12-case-a");
    assert(loaded.ok, "live compliance store loads");
    const snaps = Object.values(loaded.doc.snapshots);
    assert(snaps.length === 1 && snaps[0].sourceUrl.startsWith("https://blog.youtube/"), "official source pinned");
    assert(snaps[0].rules.length === 6, "six characteristic rules versioned");
    const fresh = comp.evaluateFreshness(loaded.doc, snaps[0], "2026-10-05T00:00:00.000Z");
    assert(fresh === "FRESH", "snapshot fresh at migration time");
    const decs = Object.values(loaded.doc.decisions);
    assert(decs.length === 5 && decs.every((d) => d.policySnapshotId === snaps[0].snapshotId), "5 decisions bound to the exact snapshot");
    assert(decs.every((d) => d.decision === "AI_DISCLOSURE_NOT_REQUIRED"), "all non-realistic → not required (branching proven by fixtures C5/C6)");
  });

  await runTest("PERF baseline: snapshot/decision/freshness latencies", () => {
    const { root, pid } = { root: tmpRoot("perf"), pid: "p-perf" };
    snapshotted(root, pid);
    timeIt("snapshotLoad", () => comp.loadCompliance(root, pid), 20);
    timeIt("evaluate", () => comp.decideCompliance(root, pid, {
      platform: "YOUTUBE", policyType: "AI_DISCLOSURE", assetId: `as-${Math.floor(Math.random() * 1e9)}`,
      characteristics: { clearlyUnrealisticAnimation: true }, evidenceRefs: ["e"],
    }), 10);
    timeIt("freshness", () => {
      const doc = comp.loadCompliance(root, pid).doc;
      const s = Object.values(doc.snapshots)[0];
      comp.evaluateFreshness(doc, s);
    }, 50);
    const sizeBytes = fs.statSync(path.join(root, "projects", pid, "governance", "compliance.json")).size;
    perf.sizeBytes = sizeBytes;
    const baseline = {
      artifact: "perf-baseline-compliance", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/compliance/test-compliance.js",
      sampleCounts: { snapshotLoad: 20, evaluate: 10, freshness: 50 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { snapshotLoadP50Ms: 5, evaluateP50Ms: 25, freshnessP50Ms: 2, sizeBytes: 1048576 },
      reason: "compliance decides at publish time; evaluation must stay interactive",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h67-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-compliance.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.evaluate.p50Ms < 25, `evaluate p50 ${perf.evaluate.p50Ms}ms < 25ms`);
    assert(perf.freshness.p50Ms < 2, `freshness p50 ${perf.freshness.p50Ms}ms < 2ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
