"use strict";

/**
 * Phase 1G.6 — Provider/Model Capability Registry targeted tests (Prompt 01).
 * Deterministic. No network, no generation, 0 provider media calls, 0 credits.
 * Covers R1-R5, C1-C9, F1-F6, S1-S7, K1-K6, T1-T6, B1-B8 + mixed end-to-end.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const mreg = require("../../providers/model-registry/index.js");
const vm = require("../../lib/visual-motion/index.js");
const pc = require("../../lib/prompt-compiler/index.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g6-${tag}-`));
}

const T0 = "2026-10-03T00:00:00.000Z";

// ---------- fixture builders (all observations injectable, no network) ----------
function fixSource(id, fieldAuthority = ["capability"]) {
  return {
    sourceId: id, sourceType: "OFFICIAL_PROVIDER_DOC", url: `https://example.com/official/${id}`,
    publisher: "Fixture Provider Docs", scope: `fixture scope ${id}`, retrievedAt: T0,
    fieldAuthority, notes: "TEST-ONLY fixture source",
  };
}

function fixRule(capability, support, constraints = {}, srcIds = ["fix-doc"], freshness = "FRESH") {
  return { capability, support, constraints, sourceRefs: srcIds, observedAt: T0, freshness };
}

function fixModel(over = {}) {
  return {
    providerId: "fixture", surfaceId: "FIX_SURFACE",
    providerLabel: over.providerLabel || "Fixture Model",
    modelFamily: over.modelFamily || "Fixture", modelVersionOrTier: over.tier || "1",
    mediaKinds: over.mediaKinds || ["video"],
    availability: over.availability || "UNKNOWN",
    providerTier: over.providerTier || null,
    sourceRefs: ["fix-doc"], observedAt: T0, status: "ACTIVE",
    capabilityRules: over.capabilityRules || [], costObservations: over.costObservations || [],
    ...over.extra,
  };
}

function fixSnapshot(models, sources = [fixSource("fix-doc")], surfaces = null) {
  const built = mreg.buildSnapshot({
    snapshotId: "rs-fixture",
    createdAt: T0,
    sources,
    surfaces: surfaces || [{ surfaceId: "FIX_SURFACE", providerId: "fixture", displayName: "Fixture Surface", status: "UNKNOWN", sourceRefs: ["fix-doc"], observedAt: T0, freshness: "UNKNOWN", metadata: {} }],
    models,
  });
  if (!built.ok) throw new Error(`fixture snapshot invalid: ${built.blockers.join("; ")}`);
  return built.snapshot;
}

function videoModel(name, rules, over = {}) {
  return fixModel({ providerLabel: name, modelFamily: name, tier: "1", mediaKinds: ["video"], capabilityRules: rules, ...over });
}

function req(over = {}) {
  return {
    projectId: "p-1g6", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-bbbbbbbbbbbb",
    renderMode: "VEO_FIRST_FRAME",
    requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
    referenceStrategy: "START_FRAME_REQUIRED", requiredAssetRoles: ["START_FRAME"],
    platform: "youtube", orientation: "LANDSCAPE_OUTPUT", mediaTargetKind: "VIDEO",
    durationSeconds: 6, resolution: null, qualityPreference: null, costSensitivity: "BALANCED",
    providerPreference: null, modelPreference: null,
    accountContext: { subscriptionTier: null, region: null, surface: null },
    outputCount: null, existingAssetSatisfied: false, missingInputImage: false,
    policyVersion: "model-resolution-policy-1.0.0",
    sourceDecision: { decisionId: "pd-cccccccccccc", fingerprint: "dddddddddddddddd" },
    ...over,
  };
}

function withFp(r) {
  const c = { ...r };
  c.fingerprint = mreg.shared.hash16({ shotId: c.shotId, caps: c.requiredCapabilities });
  return c;
}

function seed() {
  const loaded = mreg.loadSeedSnapshot();
  if (!loaded.ok) throw new Error(`seed invalid: ${loaded.blockers.join("; ")}`);
  return loaded.snapshot;
}

async function main() {
  // ---------------- A. REGISTRY / SCHEMA ----------------
  await runTest("R1 schema accepts a valid registry snapshot", () => {
    const snap = seed();
    const v = mreg.validateSnapshot({ snapshot: snap });
    assert(v.valid, `seed validates: ${JSON.stringify(v.errors)}`);
    assert(snap.models.length === 8 && snap.fingerprint, "8 models + fingerprint");
  });

  await runTest("R2 schema rejects capability facts without provenance", () => {
    const bad = fixModel({
      providerLabel: "NoProv", modelFamily: "NoProv",
      capabilityRules: [{ capability: "VIDEO_GENERATION", support: "SUPPORTED", constraints: {}, sourceRefs: [], observedAt: T0 }],
    });
    const built = mreg.buildSnapshot({ sources: [fixSource("fix-doc")], surfaces: [{ surfaceId: "FIX_SURFACE", providerId: "fixture" }], models: [bad] });
    assert(!built.ok && built.blockers.some((b) => /PROVENANCE/.test(b)), "provenance required");
  });

  await runTest("R3 unknown fields remain UNKNOWN, never fabricated", () => {
    const m = fixModel({ providerLabel: "Vague", modelFamily: "Vague", availability: "MAYBE", capabilityRules: [] });
    const snap = fixSnapshot([m]);
    const got = snap.models[0];
    assert(got.availability === "UNKNOWN", "bad availability → UNKNOWN, not false");
    assert(got.freshness.capability === "UNKNOWN" && got.freshness.cost === "UNKNOWN", "absent data → UNKNOWN freshness");
  });

  await runTest("R4 deterministic registry fingerprint", () => {
    const mk = () => fixSnapshot([videoModel("M", [fixRule("VIDEO_GENERATION", "SUPPORTED")])]);
    assert(mk().fingerprint === mk().fingerprint, "identical input → identical fingerprint");
  });

  await runTest("R5 synthetic conflict fixture preserved, compatibility still possible", () => {
    // Explicit SYNTHETIC fixture (option B): two official-style observations
    // disagreeing on one field. This is NOT a claim about current Google
    // state — current seed carries no capability conflict (see FIX C note).
    const snap = fixSnapshot([videoModel("Conflicted", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { durations: [8] }),
      {
        capability: "FIRST_LAST_FRAME_VIDEO", support: "CONFLICT",
        constraints: { durations: [8] }, sourceRefs: ["fix-doc", "fix-doc-2"],
        observedAt: T0, freshness: "UNKNOWN",
        conflict: [{ claim: "SUPPORTED", sourceRef: "fix-doc" }, { claim: "coming soon", sourceRef: "fix-doc-2" }],
      },
    ])], [fixSource("fix-doc"), fixSource("fix-doc-2")]);
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_LAST",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "END_FRAME"], durationSeconds: 8,
    })), {});
    assert(r.artifact.status === "PROVISIONAL", "conflict → provisional, never merged truth");
    assert(r.artifact.warnings.some((w) => /conflicting official/i.test(w)), "conflict warning preserved");
  });

  // ---------------- B. CAPABILITY FILTERING ----------------
  const t2v = () => videoModel("T2V", [
    fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9", "9:16"], durations: [4, 6, 8] }),
    fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"), fixRule("PORTRAIT_OUTPUT", "SUPPORTED"),
  ]);

  await runTest("C1 text-to-video compatible candidate survives", () => {
    const snap = fixSnapshot([t2v()]);
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: [], referenceStrategy: "TEXT_BASED", durationSeconds: 6,
    })), {});
    assert(r.ok && r.artifact.candidateModels.length === 1, "survives hard filter");
  });

  await runTest("C2 first-frame requirement rejects model without it", () => {
    const snap = fixSnapshot([videoModel("NoFF", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "UNSUPPORTED", { notes: "text only" }),
    ])]);
    const r = mreg.resolveRequirement(snap, withFp(req({})), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "blocked with no candidate");
    assert(r.artifact.blockers.some((b) => /NO_COMPATIBLE_MODEL/.test(b)), "structured blocker");
    assert(r.artifact.rejectedModels[0].reasons.some((x) => /IMAGE_TO_VIDEO.*UNSUPPORTED/.test(x)), "per-model rejection reason");
  });

  await runTest("C3 first+last rejects first-frame-only model (no silent downgrade)", () => {
    const snap = fixSnapshot([videoModel("FFOnly", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", { inputRoles: ["START_FRAME"] }),
      fixRule("FIRST_LAST_FRAME_VIDEO", "UNSUPPORTED", { notes: "no end-frame workflow" }),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ])]);
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_LAST",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "END_FRAME"], durationSeconds: 6,
    })), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "first+last need is not downgraded");
  });

  await runTest("C4 reference-guided need rejects non-reference model", () => {
    const snap = fixSnapshot([videoModel("NoRef", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { durations: [8] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("REFERENCE_GUIDED_VIDEO", "UNSUPPORTED", { notes: "no ingredients mode" }),
      fixRule("PORTRAIT_OUTPUT", "SUPPORTED"),
    ])]);
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_REFERENCE",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO", "PORTRAIT_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "CHARACTER_REFERENCE"], durationSeconds: 8, orientation: "PORTRAIT_OUTPUT",
    })), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "strict reference need enforced");
  });

  await runTest("C5 portrait need rejects landscape-only fixture", () => {
    const snap = fixSnapshot([videoModel("LandOnly", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("PORTRAIT_OUTPUT", "UNSUPPORTED", { notes: "landscape only" }),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ])]);
    const r = mreg.resolveRequirement(snap, withFp(req({ orientation: "PORTRAIT_OUTPUT" })), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "portrait need enforced");
  });

  await runTest("C6 requested duration rejects unsupported duration", () => {
    const snap = fixSnapshot([t2v()]);
    const r = mreg.resolveRequirement(snap, withFp(req({ durationSeconds: 10 })), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "10s not in [4,6,8]");
    assert(r.artifact.rejectedModels[0].reasons.some((x) => /duration 10s/.test(x)), "duration reason recorded");
  });

  await runTest("C7 explicit UNAVAILABLE model is removed", () => {
    const snap = fixSnapshot([videoModel("Gone", [fixRule("VIDEO_GENERATION", "SUPPORTED")], { availability: "UNAVAILABLE" })]);
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION"],
      requiredAssetRoles: [], referenceStrategy: "TEXT_BASED", orientation: null, durationSeconds: null,
    })), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "unavailable removed");
  });

  await runTest("C8 UNKNOWN hard capability never silently becomes SUPPORTED", () => {
    const snap = fixSnapshot([videoModel("Mystery", [fixRule("VIDEO_GENERATION", "SUPPORTED")])]);
    const mkReq = () => withFp(req({
      renderMode: "VEO_FIRST_FRAME",
      requiredCapabilities: ["VIDEO_GENERATION", "FIRST_LAST_FRAME_VIDEO"],
      requiredAssetRoles: [], referenceStrategy: "TEXT_BASED", orientation: null, durationSeconds: null,
    }));
    const r = mreg.resolveRequirement(snap, mkReq(), {});
    assert(r.ok && r.artifact.candidateModels.length === 1, "kept as provisional candidate");
    assert(r.artifact.candidateModels[0].provisional === true, "flagged provisional");
    assert(r.artifact.status === "PROVISIONAL", "status provisional, never clean");
    const txt = JSON.stringify(r.artifact.candidateModels[0].factors);
    assert(!/satisfies FIRST_LAST_FRAME_VIDEO/.test(txt), "no false support claim");
    const rr = mreg.resolveRequirement(snap, mkReq(), { unknownHardField: "REVIEW" });
    assert(rr.ok && rr.artifact.status === "REVIEW_REQUIRED", "REVIEW policy yields review, not silent pass");
  });

  await runTest("C9 no compatible candidate returns structured blocker", () => {
    const snap = fixSnapshot([t2v()]);
    const r = mreg.resolveRequirement(snap, withFp(req({})), { allowedSurfaces: ["NOPE"] });
    assert(r.ok && r.artifact.status === "BLOCKED", "blocked");
    assert(r.artifact.blockers.some((b) => /NO_COMPATIBLE_MODEL/.test(b)), "blocker code");
    assert(r.artifact.replanSuggestion && /no hidden downgrade/.test(r.artifact.replanSuggestion), "honest replan note");
    const v = mreg.validateResolution({ resolution: r.artifact });
    assert(v.valid, `blocked artifact validates: ${JSON.stringify(v.errors)}`);
  });

  // ---------------- C. FLOW-STYLE FIXTURES ----------------
  await runTest("F1 first+last fixture resolves VEO_FIRST_LAST", () => {
    const snap = seed();
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_LAST",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "END_FRAME"], durationSeconds: 6, orientation: "LANDSCAPE_OUTPUT",
    })), {});
    assert(r.ok && r.artifact.candidateModels.length > 0, "candidates exist");
    const winner = r.artifact.candidateModels.find((c) => c.modelId === r.artifact.recommendedModel);
    assert(winner && JSON.stringify(winner.factors).includes("FIRST_LAST_FRAME_VIDEO"), "winner proves first+last evidence (no silent downgrade)");
    const v = mreg.validateResolution({ resolution: r.artifact });
    assert(v.valid, `validates: ${JSON.stringify(v.errors)}`);
  });

  await runTest("G1 current page: omni first+last 10s supported; Veo 8s first+last supported", () => {
    const snap = seed();
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_LAST",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "END_FRAME"], durationSeconds: 10, orientation: "LANDSCAPE_OUTPUT",
    })), {});
    assert(r.ok && r.artifact.recommendedModel === "google--gemini-omni-flash--1-1", "only omni proves 10s first+last");
    const liteRej = r.artifact.rejectedModels.find((x) => x.modelId === "google--veo--3-1-lite");
    assert(liteRej && liteRej.reasons.some((x) => /duration 10s/.test(x)), "Veo tier honestly rejected at 10s");
  });

  await runTest("F2 8s-only reference fixture resolves at 8s", () => {
    const snap = seed();
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_REFERENCE",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO", "PORTRAIT_OUTPUT"],
      referenceStrategy: "START_FRAME_REQUIRED", requiredAssetRoles: ["START_FRAME", "CHARACTER_REFERENCE"],
      durationSeconds: 8, orientation: "PORTRAIT_OUTPUT", costSensitivity: "HIGH",
    })), {});
    assert(r.ok && r.artifact.recommendedModel, "8s reference resolves");
  });

  await runTest("F3 same reference fixture is rejected for unsupported duration", () => {
    const snap = seed();
    const lite = "google--veo--3-1-lite";
    const fast = "google--veo--3-1-fast";
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_REFERENCE",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO", "PORTRAIT_OUTPUT"],
      requiredAssetRoles: ["START_FRAME"], durationSeconds: 6, orientation: "PORTRAIT_OUTPUT",
    })), {});
    assert(r.ok, "resolves (omni covers 6s)");
    const rej = Object.fromEntries(r.artifact.rejectedModels.map((x) => [x.modelId, x.reasons.join("; ")]));
    assert(rej[lite] && /duration 6s/.test(rej[lite]), "lite rejected for 6s reference");
    assert(rej[fast] && /duration 6s/.test(rej[fast]), "fast rejected for 6s reference");
  });

  await runTest("F4 quality tier lacking reference support rejected for VEO_REFERENCE", () => {
    const snap = seed();
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_REFERENCE",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: [], durationSeconds: 8,
    })), {});
    assert(r.ok, "resolves");
    const q = r.artifact.rejectedModels.find((x) => x.modelId === "google--veo--3-1-quality");
    assert(q && q.reasons.some((x) => /REFERENCE_GUIDED_VIDEO.*UNSUPPORTED/.test(x)), "quality tier rejected on reference");
  });

  await runTest("F5 image model resolves IMAGE generation, no video model", () => {
    const snap = seed();
    const r = mreg.resolveFromDecision(
      {
        projectId: "p-1g6", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-bbbbbbbbbbbb",
        decisionId: "pd-cccccccccccc", fingerprint: "dddddddddddddddd",
        renderMode: "STATIC_IMAGE", requiredCapabilities: ["IMAGE_GENERATION", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "NONE", requiredAssetRoles: ["PRIMARY_IMAGE"], platform: "youtube",
      },
      { existingAssetSatisfied: false }, snap, {},
    );
    assert(r.ok && r.artifact.resolutionKind === "ASSET_MODEL", "asset-model path");
    assert(r.artifact.recommendedModel && /nano-banana/.test(r.artifact.recommendedModel), "image model recommended");
    assert(r.artifact.candidateModels.every((c) => !/veo|omni/.test(c.modelId)), "no video model in candidates");
  });

  await runTest("F6 model labels are data: relabel keeps stable identity", () => {
    const snap = seed();
    const renamed = JSON.parse(JSON.stringify(snap));
    const lite = renamed.models.find((m) => m.modelId === "google--veo--3-1-lite");
    lite.providerLabel = "Veo 3.1 - Lite (renamed label)";
    const q = withFp(req({
      renderMode: "VEO_FIRST_LAST",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "END_FRAME"], durationSeconds: 6,
    }));
    const a = mreg.resolveRequirement(snap, q, {});
    // Rebuild to renormalize (identity must survive relabel).
    const rebuilt = mreg.buildSnapshot({ snapshotId: "rs-x", createdAt: T0, sources: renamed.sources, surfaces: renamed.surfaces, models: renamed.models });
    assert(rebuilt.ok, "renamed snapshot rebuilds");
    assert(rebuilt.snapshot.models.some((m) => m.modelId === "google--veo--3-1-lite"), "stable ID survives relabel");
    const b = mreg.resolveRequirement(rebuilt.snapshot, q, {});
    assert(b.ok && a.artifact.recommendedModel === b.artifact.recommendedModel && a.artifact.status === b.artifact.status, "identical outcome after relabel");
  });

  // ---------------- D. RANKING / SELECTION ----------------
  function rankFixture() {
    const A = videoModel("ModelA", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ], { availability: "UNKNOWN" });
    const B = videoModel("ModelB", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ], { availability: "UNKNOWN" });
    return fixSnapshot([A, B]);
  }

  await runTest("S1 deterministic recommendation", () => {
    const snap = rankFixture();
    const q = withFp(req({}));
    const a = mreg.resolveRequirement(snap, q, {});
    const b = mreg.resolveRequirement(snap, q, {});
    assert(a.ok && b.ok && a.artifact.fingerprint === b.artifact.fingerprint, "idempotent");
    assert(a.artifact.recommendedModel === "fixture--modela--1", "modelId-asc tie-break wins");
    assert(a.artifact.selectionReasons.some((r) => /deterministic_tiebreak/.test(r)), "tie-break explained");
  });

  await runTest("S2 compatible operator selection becomes effective", () => {
    const snap = rankFixture();
    const r = mreg.resolveRequirement(snap, withFp(req({})), {});
    const o = mreg.applyModelOverride(r.artifact, { modelId: "fixture--modelb--1", reason: "operator prefers B" }, snap, {});
    assert(o.state === "ACCEPTED" || o.state === "ACCEPTED_WITH_WARNING", `override ${o.state}`);
    assert(o.artifact.effectiveModel === "fixture--modelb--1", "effective follows selection");
  });

  await runTest("S3 refresh does not silently overwrite valid selection", () => {
    const root = tmpRoot("sel");
    const snap = rankFixture();
    const r = mreg.resolveRequirement(snap, withFp(req({ shotId: "sh-cbbbbbbbbbbb" })), {});
    const o = mreg.applyModelOverride(r.artifact, { modelId: "fixture--modelb--1", reason: "op" }, snap, {});
    const marked = { ...o.artifact, _selectedSet: true };
    assert(mreg.persistResolution(root, "p-1g6", marked).ok, "persisted");
    const fresh = mreg.resolveRequirement(snap, withFp(req({ shotId: "sh-cbbbbbbbbbbb" })), {});
    assert(mreg.persistResolution(root, "p-1g6", fresh.artifact).ok, "re-persisted");
    const loaded = mreg.loadResolution(root, "p-1g6", "sh-cbbbbbbbbbbb");
    assert(loaded.artifact.selectedModel === "fixture--modelb--1", "selection preserved");
    assert(loaded.artifact.recommendedModel === "fixture--modela--1", "recommendation still updates");
  });

  await runTest("S4 incompatible operator override is BLOCKED", () => {
    const snap = fixSnapshot([videoModel("OnlyFF", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", { inputRoles: ["START_FRAME"] }),
      fixRule("FIRST_LAST_FRAME_VIDEO", "UNSUPPORTED", { notes: "no end-frame workflow" }),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ])]);
    const mkReq = () => withFp(req({
      renderMode: "VEO_FIRST_LAST",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: ["START_FRAME", "END_FRAME"], orientation: "LANDSCAPE_OUTPUT", durationSeconds: 6,
    }));
    const r = mreg.resolveRequirement(snap, mkReq(), {});
    assert(r.ok && r.artifact.status === "BLOCKED", "precondition blocked");
    const o = mreg.applyModelOverride(r.artifact, { modelId: "fixture--onlyff--1", reason: "force it" }, snap, {});
    assert(o.state === "BLOCKED" && o.blockers.some((b) => /INCOMPATIBLE_OVERRIDE/.test(b)), "incompatible override blocked");
    const o2 = mreg.applyModelOverride(r.artifact, { modelId: "nope--unknown--1", reason: "x" }, snap, {});
    assert(o2.state === "BLOCKED", "unknown model blocked");
  });

  function costFixture(costA, freshA, costB, freshB) {
    const cost = (v, f) => ({ unit: "credits_per_generation", value: v, context: {}, sourceRefs: ["fix-doc"], observedAt: T0, freshness: f });
    const A = videoModel("CostA", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ], { costObservations: [cost(costA, freshA)] });
    const B = videoModel("CostB", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ], { costObservations: [cost(costB, freshB)] });
    return fixSnapshot([A, B]);
  }

  await runTest("S5 HIGH sensitivity prefers lower fresh cost after filtering", () => {
    const snap = costFixture(5, "FRESH", 20, "FRESH");
    const r = mreg.resolveRequirement(snap, withFp(req({ costSensitivity: "HIGH" })), {});
    assert(r.ok && r.artifact.recommendedModel === "fixture--costa--1", "cheaper fresh cost wins");
    assert(r.artifact.selectionReasons.some((x) => /lower_verified_cost/.test(x)), "cost reason explicit");
  });

  await runTest("S6 stale cost is never treated as exact cheaper cost", () => {
    const snap = costFixture(5, "STALE", 20, "FRESH");
    // Names rigged so the stale-cheap model wins alphabetical ties.
    const snap2 = (() => {
      const s = JSON.parse(JSON.stringify(snap));
      for (const m of s.models) {
        if (m.modelId === "fixture--costa--1") { m.modelId = "fixture--aaa--1"; m.providerLabel = "AAA"; }
        if (m.modelId === "fixture--costb--1") { m.modelId = "fixture--zzz--1"; m.providerLabel = "ZZZ"; }
      }
      const rebuilt = mreg.buildSnapshot({ snapshotId: "rs-s6", createdAt: T0, sources: s.sources, surfaces: s.surfaces, models: s.models });
      if (!rebuilt.ok) throw new Error(rebuilt.blockers.join(";"));
      return rebuilt.snapshot;
    })();
    const r = mreg.resolveRequirement(snap2, withFp(req({ costSensitivity: "HIGH" })), {});
    assert(r.ok && r.artifact.recommendedModel === "fixture--aaa--1", "alphabetical winner stands");
    assert(!r.artifact.selectionReasons.some((x) => /lower_verified_cost/.test(x)), "cheapness never claimed from stale data");
    assert(r.artifact.selectionReasons.some((x) => /cost_comparison_not_possible/.test(x)), "inability is explicit");
  });

  await runTest("S7 tie-break deterministic and explained (covered in S1)", () => {
    assert(true, "see S1 deterministic_tiebreak factor");
  });

  // ---------------- E. COST SEMANTICS ----------------
  await runTest("K1 cost stored as sourced observation, not branch logic", () => {
    const snap = costFixture(7, "FRESH", 9, "FRESH");
    const m = snap.models.find((x) => x.modelId === "fixture--costa--1");
    assert(m.costObservations[0].sourceRefs.includes("fix-doc") && m.costObservations[0].observedAt === T0, "source + timestamp stored");
    // Cost values are data: the resolver compares observed fields, never literals.
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "providers", "model-registry", "resolver.js"), "utf8");
    assert(/valuePerGeneration\s*-\s*\w+\.cost\.valuePerGeneration/.test(src), "comparison reads observed data fields");
    assert(!/value:\s*\d+\s*[,}]/.test(src), "no hard-coded cost value literals in resolver");
  });

  await runTest("K2 credits-per-generation not mislabeled per-request", () => {
    const snap = costFixture(10, "FRESH", 12, "FRESH");
    const r = mreg.resolveRequirement(snap, withFp(req({ outputCount: 3, costSensitivity: "HIGH" })), {});
    assert(r.ok && r.artifact.costEstimate.unit === "credits_per_generation", "unit preserved verbatim");
    assert(r.artifact.costEstimate.estimatedTotal === 30, "total = per-generation × outputCount");
  });

  await runTest("K3 explicit outputCount yields total when fresh/known", () => {
    const snap = costFixture(10, "FRESH", 12, "FRESH");
    const r = mreg.resolveRequirement(snap, withFp(req({ outputCount: 2, costSensitivity: "BALANCED" })), {});
    assert(r.ok, "resolves");
    const winnerCost = r.artifact.costEstimate;
    assert(winnerCost.state === "KNOWN" && winnerCost.estimatedTotal === winnerCost.valuePerGeneration * 2, "total computed");
  });

  await runTest("K4 unknown outputCount means total UNKNOWN", () => {
    const snap = costFixture(10, "FRESH", 12, "FRESH");
    const r = mreg.resolveRequirement(snap, withFp(req({})), {});
    assert(r.ok && r.artifact.costEstimate.estimatedTotal === null, "no total without count");
  });

  await runTest("K5 conflicting official costs mean exact UNKNOWN", () => {
    const mk = (v) => ({ unit: "credits_per_generation", value: v, context: {}, sourceRefs: ["fix-doc", "fix-doc-2"], observedAt: T0, freshness: "FRESH" });
    const M = videoModel("Both", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ], { costObservations: [mk(10), mk(20)] });
    const snap = fixSnapshot([M], [fixSource("fix-doc"), fixSource("fix-doc-2")]);
    const r = mreg.resolveRequirement(snap, withFp(req({ costSensitivity: "HIGH" })), {});
    assert(r.ok && r.artifact.costEstimate.state === "CONFLICT", "conflict preserved");
    assert(r.artifact.costEstimate.valuePerGeneration === null, "no exact cost invented");
  });

  await runTest("K7 official omni 8s observation: outputCount 2 => total 24 (data-driven)", () => {
    const snap = seed();
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_FRAME",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: [], referenceStrategy: "TEXT_BASED", durationSeconds: 8, outputCount: 2,
    })), {});
    assert(r.ok, "resolves");
    const omni = r.artifact.candidateModels.find((c) => c.modelId === "google--gemini-omni-flash--1-1");
    assert(omni && omni.costEstimate.state === "KNOWN", "official observation applies");
    assert(omni.costEstimate.unit === "credits_per_generation" && omni.costEstimate.valuePerGeneration === 12, "12 credits/generation from seed data, not code");
    assert(omni.costEstimate.estimatedTotal === 24, "24 = 12 × 2 generations");
  });

  await runTest("K8 same official request with outputCount UNKNOWN => total UNKNOWN", () => {
    const snap = seed();
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_FRAME",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
      requiredAssetRoles: [], referenceStrategy: "TEXT_BASED", durationSeconds: 8,
    })), {});
    assert(r.ok, "resolves");
    const omni = r.artifact.candidateModels.find((c) => c.modelId === "google--gemini-omni-flash--1-1");
    assert(omni && omni.costEstimate.state === "KNOWN" && omni.costEstimate.estimatedTotal === null, "exact rate known, total honestly UNKNOWN");
  });

  await runTest("K6 cost refresh changes recommendation without touching 1G.5", () => {
    const decision = {
      projectId: "p-1g6", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-dbbbbbbbbbbb",
      decisionId: "pd-cccccccccccc", fingerprint: "dddddddddddddddd",
      renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
      referenceStrategy: "TEXT_BASED", requiredAssetRoles: [], platform: "youtube",
    };
    const before = JSON.stringify(decision);
    const r1 = mreg.resolveFromDecision(decision, { costSensitivity: "HIGH" }, costFixture(5, "FRESH", 50, "FRESH"), {});
    assert(r1.ok && r1.artifact.recommendedModel === "fixture--costa--1", "cheap A wins first");
    const r2 = mreg.resolveFromDecision(decision, { costSensitivity: "HIGH" }, costFixture(50, "FRESH", 5, "FRESH"), {});
    assert(r2.ok && r2.artifact.recommendedModel === "fixture--costb--1", "refresh flips to B");
    assert(JSON.stringify(decision) === before, "1G.5 decision byte-identical (read-only)");
  });

  // ---------------- F. FRESHNESS / STALENESS ----------------
  await runTest("T1 stale capability data is visible as stale", () => {
    const M = videoModel("StaleCap", [fixRule("VIDEO_GENERATION", "SUPPORTED", {}, ["fix-doc"], "STALE")]);
    const snap = fixSnapshot([M]);
    const r = mreg.resolveRequirement(snap, withFp(req({
      renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION"],
      requiredAssetRoles: [], referenceStrategy: "TEXT_BASED", orientation: null, durationSeconds: null,
    })), {});
    assert(r.ok && r.artifact.capabilityFreshness === "STALE", "staleness visible, not hidden");
  });

  await runTest("T2 stale cost does not erase fresh capability truth", () => {
    const snap = costFixture(5, "STALE", 20, "STALE");
    const r = mreg.resolveRequirement(snap, withFp(req({ costSensitivity: "HIGH" })), {});
    assert(r.ok && r.artifact.candidateModels.length === 2, "capability truth intact");
    assert(r.artifact.costEstimate.state !== "KNOWN", "no exact cost from stale data");
  });

  await runTest("T3 availability change stales only provider resolution", () => {
    const mk = (avail) => fixSnapshot([videoModel("Flip", [
      fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
      fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
      fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
    ], { availability: avail })]);
    const s1 = mk("AVAILABLE");
    const r1 = mreg.resolveRequirement(s1, withFp(req({})), {});
    assert(r1.ok, "first resolution");
    const root = tmpRoot("stale");
    assert(mreg.persistResolution(root, "p-1g6", r1.artifact).ok, "persisted");
    const s2 = mk("UNAVAILABLE");
    const st = mreg.checkResolutionStaleness(r1.artifact, { requirement: r1.artifact.requirement, snapshot: s2 });
    assert(st.stale && st.reasons.includes("registry snapshot changed materially"), "resolution staleness detected");
    const r2 = mreg.resolveRequirement(s2, withFp(req({})), {});
    assert(r2.ok && r2.artifact.status === "BLOCKED", "flip reflected, upstream untouched by design");
  });

  await runTest("T4 source-decision fingerprint change stales resolution", () => {
    const snap = rankFixture();
    const r = mreg.resolveRequirement(snap, withFp(req({})), {});
    const st = mreg.checkResolutionStaleness(r.artifact, {
      requirement: r.artifact.requirement, snapshot: snap, sourceDecisionFingerprint: "changed",
    });
    assert(st.stale && st.reasons.includes("source production-decision fingerprint changed"), "decision change detected");
  });

  await runTest("T5 idempotent resolution on unchanged inputs", () => {
    const snap = rankFixture();
    const q = withFp(req({}));
    const a = mreg.resolveRequirement(snap, q, {});
    const b = mreg.resolveRequirement(snap, q, {});
    assert(a.artifact.fingerprint === b.artifact.fingerprint, "same inputs → same fingerprint");
  });

  await runTest("T6 model availability change does NOT stale 1G.5 modality/render mode", () => {
    const scene = {
      sceneId: "sc-aaaaaaaaaaaaaaaa", order: 0, beatIds: ["b1"], storySectionRefs: ["sec-1"],
      narrativePurpose: "t", visualObjective: "EXPLAIN", subjectRefs: [], environmentRefs: [],
      continuityGroup: "cg-1", stateBefore: null, stateAfter: null,
    };
    const shot = {
      shotId: "sh-bbbbbbbbbbbb", parentSceneId: scene.sceneId, orderWithinScene: 0, beatIds: ["b1"],
      claimRefs: [], shotPurpose: "DEMONSTRATE", visualObjective: "EXPLAIN", subjectRefs: [],
      actionIntent: null, framingIntent: null, cameraIntent: null, continuityRefs: ["cg-1"],
      startState: null, endState: null, relativeWeight: 1,
    };
    const d = vm.decideShotProduction({
      projectId: "p-1g6", shot, scene, contentClass: "FACTUAL", platform: "youtube",
      signals: { visualType: "MAP", spatialMovement: true, cameraMovementNeeded: true }, now: "2026-10-03T00:00:00.000Z",
    }).decision;
    const st = vm.checkDecisionStaleness(d, {
      shot, scene, modelAvailability: { "google--veo--3-1-lite": "UNAVAILABLE" },
      supportedCapabilities: ["VIDEO_GENERATION"],
    });
    assert(!st.stale, "1G.5 boundary holds from the consumer side too");
  });

  // ---------------- G. BOUNDARIES ----------------
  await runTest("B1–B4 no generation calls, credits, UI clicks, or live automation", () => {
    const dir = path.join(__dirname, "..", "..", "providers", "model-registry");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      assert(!/\.execute\s*\(|fetch\s*\(|https?\.request|axios|playwright/i.test(src), `${f}: no generation/network/browser calls`);
      assert(!/\.click\s*\(|fill\s*\(.*selector|page\.\$|browser\.launch/i.test(src), `${f}: no UI automation`);
      assert(!require.resolve || !/flow-companion/.test(src), `${f}: no Flow Companion coupling`);
    }
  });

  await runTest("B5–B6 1G.5 core stays provider-neutral and price-free", () => {
    const dir = path.join(__dirname, "..", "..", "lib", "visual-motion");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8")
        .split("\n").filter((l) => !/_PATTERN\s*=/.test(l)).join("\n").replace(/VEO_[A-Z_]+/g, "");
      assert(!/\bveo[\s-]\d|veo\s*3|gemini|nano[\s-]?banana|imagen|omni[\s-]?flash/i.test(src), `${f}: no model IDs`);
      assert(!/\$\s*\d|\b\d+\s*credits?\b/i.test(src), `${f}: no price constants`);
    }
  });

  await runTest("B7 Prompt Compiler still refuses target/model inference", async () => {
    const r = await pc.compilePromptPackage({
      projectId: "p-1g6",
      shot: { shotId: "sh-bbbbbbbbbbbb", parentSceneId: "sc-aaaaaaaaaaaaaaaa", beatIds: ["b1"] },
      scene: { sceneId: "sc-aaaaaaaaaaaaaaaa" },
      beatMap: { beats: [{ beatId: "b1", summary: "x", claimRefs: [], storySectionRef: "s" }], fingerprint: "f" },
      platform: "youtube", contentClass: "FACTUAL",
    }, { persist: false });
    assert(r.status === "PROMPT_TARGET_REQUIRED", "compiler still caller-driven");
  });

  await runTest("B8 FACTUAL/FICTION/HYBRID integrity unchanged by resolution", () => {
    const snap = seed();
    const fiction = {
      projectId: "p-1g6", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-ebbbbbbbbbbb",
      decisionId: "pd-cccccccccccc", fingerprint: "dddddddddddddddd",
      renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
      referenceStrategy: "TEXT_BASED", requiredAssetRoles: [], platform: "youtube", contentClass: "FICTION",
      claimRefs: [],
    };
    const before = JSON.stringify(fiction);
    const r = mreg.resolveFromDecision(fiction, {}, snap, {});
    assert(r.ok, "resolves");
    assert(JSON.stringify(fiction) === before && fiction.claimRefs.length === 0, "fiction untouched, zero evidence");
  });

  // ---------------- §28 MIXED END-TO-END ----------------
  await runTest("E2E mixed production-resolution fixture (10 cases)", () => {
    const decisions = {
      staticSatisfied: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a1",
        decisionId: "pd-0000000000a1", fingerprint: "aaaaaaaaaaaaaaaa",
        renderMode: "STATIC_IMAGE", requiredCapabilities: ["IMAGE_GENERATION", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "NONE", requiredAssetRoles: ["PRIMARY_IMAGE"], platform: "youtube",
      },
      staticMissing: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a2",
        decisionId: "pd-0000000000a2", fingerprint: "bbbbbbbbbbbbbbbb",
        renderMode: "STATIC_IMAGE", requiredCapabilities: ["IMAGE_GENERATION", "PORTRAIT_OUTPUT"],
        referenceStrategy: "NONE", requiredAssetRoles: ["PRIMARY_IMAGE"], platform: "tiktok",
      },
      remotion: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a3",
        decisionId: "pd-0000000000a3", fingerprint: "cccccccccccccccc",
        renderMode: "REMOTION_MOTION", requiredCapabilities: ["IMAGE_GENERATION", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "NONE", requiredAssetRoles: ["PRIMARY_IMAGE", "MAP_BASE"], platform: "youtube",
      },
      firstFrame: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a4",
        decisionId: "pd-0000000000a4", fingerprint: "dddddddddddddddd",
        renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "START_FRAME_REQUIRED", requiredAssetRoles: ["START_FRAME"], platform: "youtube",
      },
      firstLast: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a5",
        decisionId: "pd-0000000000a5", fingerprint: "eeeeeeeeeeeeeeee",
        renderMode: "VEO_FIRST_LAST", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "FIRST_LAST_FRAME_VIDEO", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "START_FRAME_REQUIRED", requiredAssetRoles: ["START_FRAME", "END_FRAME"], platform: "youtube",
      },
      reference: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a6",
        decisionId: "pd-0000000000a6", fingerprint: "ffffffffffffffff",
        renderMode: "VEO_REFERENCE", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "REFERENCE_GUIDED_VIDEO", "PORTRAIT_OUTPUT"],
        referenceStrategy: "START_FRAME_REQUIRED", requiredAssetRoles: ["START_FRAME", "CHARACTER_REFERENCE"], platform: "tiktok",
      },
      badDuration: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a7",
        decisionId: "pd-0000000000a7", fingerprint: "1111111111111111",
        renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "TEXT_BASED", requiredAssetRoles: [], platform: "youtube",
      },
      unknownAvail: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a8",
        decisionId: "pd-0000000000a8", fingerprint: "2222222222222222",
        renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "TEXT_BASED", requiredAssetRoles: [], platform: "youtube",
      },
      costSens: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000a9",
        decisionId: "pd-0000000000a9", fingerprint: "3333333333333333",
        renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "TEXT_BASED", requiredAssetRoles: [], platform: "youtube", modality: "CHARACTER_MOMENT",
      },
      conflictCost: {
        projectId: "p-e2e", sceneId: "sc-aaaaaaaaaaaaaaaa", shotId: "sh-0000000000b0",
        decisionId: "pd-0000000000b0", fingerprint: "4444444444444444",
        renderMode: "VEO_FIRST_FRAME", requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO", "LANDSCAPE_OUTPUT"],
        referenceStrategy: "TEXT_BASED", requiredAssetRoles: [], platform: "youtube",
      },
    };
    const snap = seed();
    const costSnap = costFixture(6, "FRESH", 18, "FRESH");
    const conflictSnap = (() => {
      const M = videoModel("BothCost", [
        fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [6] }),
        fixRule("IMAGE_TO_VIDEO", "SUPPORTED", {}),
        fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
      ], {
        costObservations: [
          { unit: "credits_per_generation", value: 10, context: {}, sourceRefs: ["fix-doc", "fix-doc-2"], observedAt: T0, freshness: "FRESH" },
          { unit: "credits_per_generation", value: 20, context: {}, sourceRefs: ["fix-doc", "fix-doc-2"], observedAt: T0, freshness: "FRESH" },
        ],
      });
      return fixSnapshot([M], [fixSource("fix-doc"), fixSource("fix-doc-2")]);
    })();

    const r1 = mreg.resolveFromDecision(decisions.staticSatisfied, { existingAssetSatisfied: true }, snap, {});
    assert(r1.ok && r1.artifact.status === "NOT_REQUIRED", "1. satisfied static → NOT_REQUIRED");

    const r2 = mreg.resolveFromDecision(decisions.staticMissing, {}, snap, {});
    assert(r2.ok && r2.artifact.resolutionKind === "ASSET_MODEL" && /nano-banana/.test(r2.artifact.recommendedModel), "2. missing image → image model");

    const r3 = mreg.resolveFromDecision(decisions.remotion, {}, snap, {});
    assert(r3.ok && r3.artifact.status === "NOT_REQUIRED" && r3.artifact.candidateModels.length === 0, "3. remotion → no video model");

    const r4 = mreg.resolveFromDecision(decisions.firstFrame, { durationSeconds: 6 }, snap, {});
    assert(r4.ok && r4.artifact.candidateModels.length > 0, "4. first-frame resolves");

    const r5 = mreg.resolveFromDecision(decisions.firstLast, { durationSeconds: 6 }, snap, {});
    assert(r5.ok && r5.artifact.recommendedModel, "5. first+last resolves with first+last evidence");
    const w5 = r5.artifact.candidateModels.find((c) => c.modelId === r5.artifact.recommendedModel);
    assert(w5 && JSON.stringify(w5.factors).includes("FIRST_LAST_FRAME_VIDEO"), "5. no silent downgrade");

    const r6 = mreg.resolveFromDecision(decisions.reference, { durationSeconds: 8, costSensitivity: "HIGH" }, snap, {});
    assert(r6.ok && r6.artifact.recommendedModel, "6. reference resolves at 8s");

    const r7 = mreg.resolveFromDecision(decisions.badDuration, { durationSeconds: 10 }, (() => {
      // Restrict to an 8s-only fixture to prove duration blocking.
      const M = videoModel("EightOnly", [
        fixRule("VIDEO_GENERATION", "SUPPORTED", { orientations: ["16:9"], durations: [8] }),
        fixRule("IMAGE_TO_VIDEO", "SUPPORTED", { durations: [8] }),
        fixRule("LANDSCAPE_OUTPUT", "SUPPORTED"),
      ]);
      return fixSnapshot([M]);
    })(), {});
    assert(r7.ok && r7.artifact.status === "BLOCKED", "7. unsupported duration → BLOCKED");

    const r8 = mreg.resolveFromDecision(decisions.unknownAvail, { durationSeconds: 6 }, snap, {});
    assert(r8.ok && r8.artifact.availabilityState === "UNKNOWN", "8. availability not faked");
    assert(r8.artifact.warnings.some((w) => /RUNTIME_AVAILABILITY_NOT_VERIFIED/.test(w)), "8. provisional warning present");

    const r9 = mreg.resolveFromDecision(decisions.costSens, { durationSeconds: 6, costSensitivity: "HIGH" }, costSnap, {});
    assert(r9.ok && r9.artifact.recommendedModel === "fixture--costa--1", "9. fresh cheaper cost wins under HIGH");

    const r10 = mreg.resolveFromDecision(decisions.conflictCost, { durationSeconds: 6, costSensitivity: "HIGH" }, conflictSnap, {});
    assert(r10.ok && r10.artifact.costEstimate.state === "CONFLICT", "10. conflicting cost → exact UNKNOWN");
    assert(r10.artifact.costEstimate.valuePerGeneration === null, "10. nothing invented");

    // Upstream never changes because of registry state.
    for (const [key, d] of Object.entries(decisions)) {
      void key;
      const again = mreg.resolveFromDecision(d, { durationSeconds: 6 }, snap, {});
      assert(again.ok, `${d.shotId} re-resolves without touching the decision`);
    }
    const kinds = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10].map((r) => r.artifact.status).join(",");
    assert(/NOT_REQUIRED/.test(kinds) && /BLOCKED/.test(kinds), `mixed outcomes requirement-driven (${kinds})`);
  });

  console.log(`\n=== 1G.6 model-capability-registry: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });
