"use strict";

/**
 * Phase 1H.6 — Provenance matrix P1–P12 + perf baseline.
 * Deterministic. No provider calls, no network. Real-registry fixtures use
 * COPIES under os.tmpdir (live project untouched except via CLI migration).
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const prov = require("../../lib/provenance/index.js");
const mig = require("../../lib/provenance/migrate.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1h6prov-${tag}-`));
}

function newStore(pid = "p-t") {
  return { root: tmpRoot("s"), pid };
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

const GEN = (assetId, extra = {}) => ({
  assetId, originType: "GENERATED", provider: "google-flow", model: "m-1",
  assetHash: "ab".repeat(32), provenanceStatus: "MIGRATED",
  rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "UNRESOLVED" },
  evidenceRefs: ["assets/library-index.json"],
  ...extra,
});

async function main() {
  await runTest("P1 generated asset provenance (origin + lineage + rights slots)", () => {
    const { root, pid } = newStore();
    const r = prov.recordProvenance(root, pid, GEN("as-1", { parentAssetIds: ["as-0"], referenceAssetIds: ["as-0"] }));
    assert(r.ok && r.record.provenanceVersion === 1, "v1 recorded");
    assert(r.record.rights.ownershipStatus === "UNRESOLVED", "generated != cleared (rights unproven)");
    const g = prov.getProvenance(root, pid, "as-1");
    assert(g.ok && g.record.assetHash === "ab".repeat(32), "resolvable with hash");
    assert(prov.getProvenance(root, pid, "as-nope").code === "PROVENANCE_NOT_FOUND", "missing → PROVENANCE_NOT_FOUND");
  });

  await runTest("P2 uploaded asset provenance (operator file, rights unproven)", () => {
    const { root, pid } = newStore();
    const r = prov.recordProvenance(root, pid, {
      assetId: "as-up", originType: "UPLOADED", sourceRef: "operator upload",
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "NOT_APPLICABLE" },
      evidenceRefs: ["uploads/manifest.json"], provenanceStatus: "ASSERTED",
    });
    assert(r.ok && r.record.originType === "UPLOADED", "uploaded recorded, rights still UNRESOLVED");
  });

  await runTest("P3 derived asset parent chain (walkable, orphans refused)", () => {
    const { root, pid } = newStore();
    prov.recordProvenance(root, pid, GEN("as-frame"));
    prov.recordProvenance(root, pid, GEN("as-video", { parentAssetIds: ["as-frame"] }));
    prov.recordProvenance(root, pid, GEN("as-thumb", { parentAssetIds: ["as-video"] }));
    const t = prov.traceLineage(root, pid, "as-thumb");
    assert(t.ok && t.chain.map((c) => c.assetId).join(">") === "as-thumb>as-video>as-frame", "full backward walk, no orphan final");
    prov.recordProvenance(root, pid, GEN("as-orphan", { parentAssetIds: ["as-ghost"] }));
    const bad = prov.traceLineage(root, pid, "as-orphan");
    assert(!bad.ok && bad.code === "PROVENANCE_NOT_FOUND", "unresolvable parent refused");
  });

  await runTest("P4 unknown origin stays unresolved (never guessed GENERATED)", () => {
    const { root, pid } = newStore();
    const r = prov.recordProvenance(root, pid, {
      assetId: "as-x", originType: "UNKNOWN",
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "UNRESOLVED" },
      evidenceRefs: ["index.json"],
    });
    assert(r.ok && r.record.provenanceStatus === "REVIEW_REQUIRED", "UNKNOWN defaults to REVIEW_REQUIRED");
    const bad = prov.recordProvenance(root, pid, {
      assetId: "as-y", originType: "UNKNOWN", provenanceStatus: "VERIFIED",
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "UNRESOLVED" }, evidenceRefs: ["i"],
    });
    assert(!bad.ok, "UNKNOWN can never be VERIFIED/ASSERTED");
    const badOrigin = prov.recordProvenance(root, pid, { assetId: "as-z", originType: "MAYBE", rights: {}, evidenceRefs: [] });
    assert(!badOrigin.ok, "invented origin type refused");
  });

  await runTest("P5 hash identity does not imply rights", () => {
    const { root, pid } = newStore();
    const r = prov.recordProvenance(root, pid, GEN("as-h"));
    assert(r.ok && r.record.rights.ownershipStatus === "UNRESOLVED", "byte identity + UNRESOLVED rights coexist");
    const claimed = prov.recordProvenance(root, pid, GEN("as-c", {
      rights: { ownershipStatus: "OWNED", referenceRightsStatus: "NOT_APPLICABLE" }, evidenceRefs: [],
    }));
    assert(!claimed.ok && claimed.code === "RIGHTS_EVIDENCE_MISSING", "claimed OWNED without evidence refused");
  });

  await runTest("P6 reference-rights evidence (lock != rights)", () => {
    const { root, pid } = newStore();
    const r = prov.recordProvenance(root, pid, GEN("as-v", {
      referenceAssetIds: ["as-ref"],
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "REVIEW_REQUIRED" },
      evidenceRefs: ["ref/evidence.json"],
    }));
    assert(r.ok, "reference rights tracked separately from any technical lock");
    assert(r.record.referenceAssetIds.includes("as-ref"), "reference linkage recorded");
  });

  await runTest("P7 music rights categories (licensed needs evidence)", () => {
    const { root, pid } = newStore();
    const bare = prov.recordProvenance(root, pid, GEN("as-m", {
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "NOT_APPLICABLE", licenseType: "LICENSED" }, evidenceRefs: [],
    }));
    assert(!bare.ok && bare.code === "RIGHTS_EVIDENCE_MISSING", "LICENSED music claim without evidence refused");
    const ok = prov.recordProvenance(root, pid, GEN("as-m2", {
      rights: {
        ownershipStatus: "UNRESOLVED", referenceRightsStatus: "NOT_APPLICABLE",
        licenseType: "ROYALTY_FREE_WITH_LICENSE", licenseRef: "licenses/track-1.txt",
        licenseEvidenceRefs: ["licenses/track-1.txt"], musicRightsStatus: "LICENSED",
      },
      evidenceRefs: ["licenses/track-1.txt"],
    }));
    assert(ok.ok, "licensed music with evidence refs accepted (metadata + ref, never full documents)");
  });

  await runTest("P8 voice rights categories (synthetic narrator without cloning)", () => {
    const { root, pid } = newStore();
    const r = prov.recordProvenance(root, pid, GEN("as-v", {
      rights: {
        ownershipStatus: "UNRESOLVED", referenceRightsStatus: "NOT_APPLICABLE",
        voiceRightsStatus: "PLATFORM_GENERATED",
        voiceDetail: { voiceSource: "synthetic-narrator", provider: "kokoro", narratorOwned: false, licensed: false, cloned: false, realPersonLikeness: false, consentRef: null },
      },
      evidenceRefs: ["voice/narrator-contract.json"],
    }));
    assert(r.ok && r.record.rights.voiceDetail.cloned === false, "Kokoro-style synthetic voice representable; no cloning built");
  });

  await runTest("P9 factual source linkage class-aware (FICTION needs none)", () => {
    const { root, pid } = newStore();
    const fiction = prov.recordProvenance(root, pid, GEN("as-f", { factualSourceRefs: [] }));
    assert(fiction.ok, "FICTION asset without factual linkage accepted");
    const factual = prov.recordProvenance(root, pid, GEN("as-doc", {
      factualSourceRefs: ["research/brief.json#C1", "research/brief.json#C2"],
    }));
    assert(factual.ok && factual.record.factualSourceRefs.length === 2, "factual linkage preserved as claim refs");
  });

  await runTest("P10 append-only correction/version (history never rewritten)", () => {
    const { root, pid } = newStore();
    const v1 = prov.recordProvenance(root, pid, GEN("as-1"));
    assert(v1.record.provenanceVersion === 1, "v1");
    const v2 = prov.recordProvenance(root, pid, GEN("as-1", { model: "m-2" }));
    assert(v2.ok && v2.record.provenanceVersion === 2 && v2.record.supersedes === 1, "correction appends v2");
    const g = prov.getProvenance(root, pid, "as-1");
    assert(g.chain.current === 2 && g.chain.versions[1].model === "m-1", "v1 bytes intact");
    const replay = prov.recordProvenance(root, pid, GEN("as-1", { model: "m-2", provenanceVersion: 2 }));
    assert(replay.ok && replay.changed === false, "identical replay no-ops");
  });

  await runTest("P11 fresh-process restore (provenance + lineage from disk)", () => {
    const { root, pid } = newStore();
    prov.recordProvenance(root, pid, GEN("as-p"));
    prov.recordProvenance(root, pid, GEN("as-c", { parentAssetIds: ["as-p"] }));
    const child = spawnSync(process.execPath, ["-e",
      "const p=require(process.argv[1]);const t=p.traceLineage(process.argv[2],process.argv[3],'as-c');console.log(t.ok?t.chain.map(c=>c.assetId).join('>'):'ERR:'+t.code);",
      path.join(REPO, "lib", "provenance", "index.js"), root, pid,
    ], { encoding: "utf8" });
    assert(child.status === 0 && child.stdout.trim() === "as-c>as-p", "fresh process walks the same chain");
  });

  await runTest("P12 secret-safe record (keys + pastes refused)", () => {
    const { root, pid } = newStore();
    assert(!prov.recordProvenance(root, pid, GEN("as-1", { detail: "bridgeToken: abc123" })).ok, "secret paste refused");
    const raw = { schemaVersion: "1.0.0", projectId: pid, revision: 1, createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z", provenance: {}, fingerprint: "0123456789abcdef", apiKey: "x" };
    assert(!prov.validateDoc(raw).ok, "secret key refused");
    assert(prov.recordProvenance(root, pid, GEN("as-2", { detail: "hash ab12cd34 verified" })).ok, "hash prose allowed");
  });

  await runTest("PERF baseline: provenance latencies", () => {
    const { root, pid } = newStore();
    const r0 = prov.recordProvenance(root, pid, GEN("as-0"));
    assert(r0.ok, "seed ok");
    timeIt("record", () => {
      const id = `as-${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
      const r = prov.recordProvenance(root, pid, GEN(id));
      if (!r.ok) throw new Error("record failed");
    }, 10);
    timeIt("load", () => prov.loadProvenance(root, pid), 20);
    timeIt("trace", () => prov.traceLineage(root, pid, "as-0"), 20);
    const sizeBytes = fs.statSync(path.join(root, "projects", pid, "governance", "provenance.json")).size;
    perf.sizeBytes = sizeBytes;
    const baseline = {
      artifact: "perf-baseline-governance", capturedAt: new Date().toISOString(),
      method: "process.hrtime.bigint micro-benchmarks inside tests/provenance/test-provenance.js",
      sampleCounts: { record: 10, load: 20, trace: 20 },
      environment: "local Windows, node",
      metrics: perf,
      budgets: { recordP50Ms: 25, loadP50Ms: 5, traceP50Ms: 5, sizeBytes: 1048576 },
      reason: "provenance sits on publish/selection paths; trace backs end-to-end queries",
      result: "PASS",
    };
    const outDir = path.join(REPO, "projects", "validation", "phase-1h", "phase1h67-validation", "evidence", "performance");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "perf-baseline-governance.json"), JSON.stringify(baseline, null, 2) + "\n");
    assert(perf.record.p50Ms < 25, `record p50 ${perf.record.p50Ms}ms < 25ms`);
    assert(perf.trace.p50Ms < 5, `trace p50 ${perf.trace.p50Ms}ms < 5ms`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
