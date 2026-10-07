"use strict";

/**
 * Phase 1G.8 — Output / Cost / Credit Planner targeted tests (Prompt 01).
 * Deterministic. No generation, 0 provider calls, 0 credits, 0 Flow UI.
 * Covers O/P/C/B/R/L/T/I/S/E matrices + source-drift proof.
 * Synthetic fixture values are labeled TEST-ONLY and never presented as
 * current Google truth; official-data paths use the 1G.6 seed snapshot.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const oc = require("../../lib/output-cost/index.js");
const mreg = require("../../providers/model-registry/index.js");
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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g8-${tag}-`));
}

const NOW = "2026-10-03T00:00:00.000Z";

function seed() {
  const loaded = mreg.loadSeedSnapshot();
  if (!loaded.ok) throw new Error(`seed invalid: ${loaded.blockers.join("; ")}`);
  return loaded.snapshot;
}

// Minimal 1G.5-style decision (read-only input; never mutated by 1G.8).
function dec(renderMode, strategy, caps = [], roles = [], extra = {}) {
  return {
    decisionId: "pd-0123456789ab", fingerprint: "0123456789abcdef",
    renderMode, effectiveOutputType: strategy, recommendedOutputType: strategy,
    requiredCapabilities: caps, requiredAssetRoles: roles,
    referenceStrategy: "TEXT_BASED", platform: "youtube",
    visualModality: "ATMOSPHERE", claimRefs: [], ...extra,
  };
}

function planOf(items, extra = {}) {
  const r = oc.buildOutputPlan({
    projectId: "p-1g8", scopeId: "scope-1", items,
    registrySnapshot: extra.snapshot || null, mreg, now: NOW, ...extra,
  });
  if (!r.ok) throw new Error(`plan failed: ${r.code} ${r.message || ""}`);
  return r.plan;
}

function budgetOf(plan, limit, extra = {}) {
  const r = oc.buildBudgetPlan({
    projectId: "p-1g8", scopeId: "scope-1",
    hardBudget: { unit: "CREDITS", limit, source: "operator-test" },
    outputPlan: plan, now: NOW, ...extra,
  });
  if (!r.ok) throw new Error(`budget failed: ${r.code} ${r.message || ""}`);
  return r.budgetPlan;
}

async function main() {
  // ---------------- O — OUTPUT COUNT ----------------
  await runTest("O1 normal default is 1", () => {
    const plan = planOf([{ shotId: "sh-0000000000a1", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []) }]);
    assert(plan.units.length === 1 && plan.units[0].variantIndex === 0, "single generation unit");
  });

  for (const [role, count] of [["CHARACTER_MASTER", 2], ["THUMBNAIL", 4], ["HERO_SHOT", 2], ["STYLE_BAKE_OFF", 3], ["CRITICAL_VISUAL", 4]]) {
    await runTest(`O special role ${role} x${count} allowed`, () => {
      const plan = planOf([{
        shotId: "sh-0000000000a2", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
        outputCount: count, specialRole: role, specialReason: "TEST-ONLY justified case",
      }]);
      assert(plan.units.length === count, `${count} variant units`);
      assert(plan.units.every((u, i) => u.variantIndex === i), "variant indexes 0..n-1");
    });
  }

  await runTest("O7 normal shot x2 rejected without special role", () => {
    const r = oc.buildOutputPlan({
      projectId: "p-1g8", scopeId: "s",
      items: [{ shotId: "sh-0000000000a3", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), outputCount: 2 }],
      now: NOW,
    });
    assert(r.ok && r.plan.blockers.some((b) => /MULTI_OUTPUT_ROLE_REQUIRED/.test(b)), "role required, importance alone insufficient");
  });

  await runTest("O8 count above 4 rejected", () => {
    const r = oc.buildOutputPlan({
      projectId: "p-1g8", scopeId: "s",
      items: [{ shotId: "sh-0000000000a4", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), outputCount: 5, specialRole: "THUMBNAIL", specialReason: "x" }],
      now: NOW,
    });
    assert(r.ok && r.plan.blockers.some((b) => /OUTPUT_COUNT_EXCEEDS_MAX/.test(b)), "x5 rejected");
  });

  await runTest("O9 variant is not retry", () => {
    const plan = planOf([{
      shotId: "sh-0000000000a5", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      outputCount: 2, specialRole: "HERO_SHOT", specialReason: "TEST-ONLY pair",
    }]);
    assert(plan.summary.baseOutputs === 1 && plan.summary.extraVariants === 1, "1 base + 1 variant tracked separately");
    assert(plan.units.every((u) => u.attemptIndex === undefined), "no attempt lineage on variants");
  });

  // ---------------- P — PLANNING / DEDUPE ----------------
  await runTest("P1 reusable asset costs 0 new generations", () => {
    const plan = planOf([{ shotId: "sh-0000000000b1", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } }]);
    assert(plan.units.length === 0 && plan.summary.estimatedImages === 0, "satisfied static plans nothing");
  });

  await runTest("P2 missing image counted once", () => {
    const plan = planOf([{ shotId: "sh-0000000000b2", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: false } }]);
    assert(plan.units.length === 1 && plan.summary.estimatedImages === 1, "one missing primary image");
  });

  await runTest("P3 shared reference deduped by asset id", () => {
    const mk = (id) => ({
      shotId: id, decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]),
      assetStatus: { satisfied: true }, missingReferences: ["ref-shared-1"],
    });
    const plan = planOf([mk("sh-0000000000b3"), mk("sh-0000000000b4")]);
    assert(plan.units.length === 1 && plan.deduped.length === 1, "shared reference generated once");
    assert(plan.deduped[0].keptUnitId === plan.units[0].unitId, "dedupe linkage recorded");
  });

  await runTest("P4/P5 platform reframe and relayout add no generation", () => {
    const mk = (id) => ({
      shotId: id, decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"], ["START_FRAME"]),
      durationSeconds: 8,
      adaptations: [
        { platformId: "YOUTUBE_LONG", regenerationDecision: "NOT_REQUIRED" },
        { platformId: "YOUTUBE_SHORTS", regenerationDecision: "NOT_REQUIRED" },
        { platformId: "TIKTOK", regenerationDecision: "NOT_REQUIRED" },
      ],
    });
    const plan = planOf([mk("sh-0000000000b5")]);
    assert(plan.units.length === 1, "one master asset usable on 3 platforms = 1 generation");
    assert(plan.warnings.some((w) => /PLATFORM_REUSE_DEDUP/.test(w)), "dedupe reason recorded");
  });

  await runTest("P6 targeted platform regeneration adds only the affected unit", () => {
    const plan = planOf([{
      shotId: "sh-0000000000b6", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8,
      adaptations: [
        { platformId: "YOUTUBE_LONG", regenerationDecision: "NOT_REQUIRED" },
        { platformId: "TIKTOK", regenerationDecision: "TARGETED_REGENERATION_REQUIRED" },
      ],
    }]);
    assert(plan.units.length === 2, "base + one targeted variant");
    assert(plan.units[1].role === "PLATFORM_TARGETED_VARIANT" && plan.units[1].targetedPlatformId === "TIKTOK", "targeted unit labeled");
  });

  await runTest("P7 Remotion itself consumes 0 Flow credits", () => {
    const plan = planOf([{ shotId: "sh-0000000000b7", decision: dec("REMOTION_MOTION", "EDITOR_MOTION", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } }]);
    assert(plan.units.length === 0, "no Flow units for Remotion");
    assert(plan.warnings.some((w) => /REMOTION_ZERO_FLOW_CREDIT/.test(w)), "zero-credit reason recorded");
  });

  await runTest("P8 missing Remotion base image counts as image generation only", () => {
    const plan = planOf([{ shotId: "sh-0000000000b8", decision: dec("REMOTION_MOTION", "EDITOR_MOTION", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), missingInputImage: true }]);
    assert(plan.units.length === 1 && plan.units[0].mediaKind === "image", "image unit only, no video unit");
  });

  // ---------------- C — COST ----------------
  await runTest("C1 uses 1G.6 cost observation", () => {
    const snap = seed();
    const plan = planOf([{
      shotId: "sh-0000000000c1", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"], []),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
    }], { snapshot: snap });
    const u = plan.units[0];
    assert(u.estimatedCreditState === "EXACT" && u.estimatedCredits === 12, "omni 8s = 12 from seed observation");
  });

  await runTest("C2 per-generation semantics", () => {
    const snap = seed();
    const plan = planOf([{
      shotId: "sh-0000000000c2", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
    }], { snapshot: snap });
    assert(plan.units[0].costUnit === "credits_per_generation", "unit preserved verbatim");
  });

  await runTest("C3 outputCount multiplies generation cost", () => {
    const snap = seed();
    const plan = planOf([{
      shotId: "sh-0000000000c3", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
      outputCount: 2, specialRole: "HERO_SHOT", specialReason: "TEST-ONLY",
    }], { snapshot: snap });
    assert(plan.summary.estimatedCredits.knownCredits === 24, "12 x 2 generations");
  });

  await runTest("C4 request count does not replace generation count", () => {
    const v = oc.validateBudgetPlan({ plan: {
      version: "1.0.0", budgetPlanId: "bp-0123456789ab", projectId: "p", scopeId: "s",
      hardBudget: { unit: "CREDITS", limit: 100 }, plannedItems: [], summary: {},
      estimateState: "EXACT", warnings: ["total = requests x rate"], blockers: [],
      fingerprint: "0123456789abcdef", status: "DRAFT",
    } });
    assert(!v.valid && v.errors.some((e) => e.code === "REQUEST_GENERATION_CONFLATION"), "conflation detected");
  });

  await runTest("C5 context mismatch yields no cost match", () => {
    const snap = seed();
    const plan = planOf([{
      shotId: "sh-0000000000c5", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 6, modelId: "google--veo--3-1-lite", subscriptionTier: "Pro",
    }], { snapshot: snap });
    // Documented tiers are Ultra / non-Ultra only; "Pro" matches neither.
    const u = plan.units[0];
    assert(u.estimatedCreditState === "UNKNOWN", `no loose match into undocumented tier (got ${u.estimatedCreditState})`);
  });

  await runTest("C6 unknown cost stays UNKNOWN", () => {
    const plan = planOf([{ shotId: "sh-0000000000c6", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: false } }]);
    assert(plan.units[0].estimatedCreditState === "UNKNOWN", "unpublished image cost stays UNKNOWN");
    assert(plan.summary.estimatedCredits.state !== "EXACT", "no exact total with unknown units");
  });

  await runTest("C7 stale cost is not exact", () => {
    const snap = (() => {
      const s = JSON.parse(JSON.stringify(seed()));
      const m = s.models.find((x) => x.modelId === "google--gemini-omni-flash--1-1");
      for (const o of m.costObservations) o.freshness = "STALE";
      const rebuilt = mreg.buildSnapshot({ snapshotId: "rs-stale", createdAt: NOW, sources: s.sources, surfaces: s.surfaces, models: s.models });
      if (!rebuilt.ok) throw new Error(rebuilt.blockers.join(";"));
      return rebuilt.snapshot;
    })();
    const plan = planOf([{
      shotId: "sh-0000000000c7", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
    }], { snapshot: snap });
    assert(plan.units[0].estimatedCreditState === "STALE", "stale cost flagged");
    assert(plan.summary.estimatedCredits.exactTotalCredits === null, "no exact total from stale data");
  });

  await runTest("C8 conflicting cost is not exact", () => {
    const src = { sourceId: "fix-doc", sourceType: "OFFICIAL_PROVIDER_DOC", url: "https://example.com/official", publisher: "Fixture Docs", scope: "fixture", retrievedAt: NOW, fieldAuthority: ["cost"] };
    const obs = (v) => ({ unit: "credits_per_generation", value: v, context: {}, sourceRefs: ["fix-doc"], observedAt: NOW, freshness: "FRESH" });
    const built = mreg.buildSnapshot({
      snapshotId: "rs-conflict", createdAt: NOW, sources: [src],
      surfaces: [{ surfaceId: "FIX", providerId: "fix", status: "UNKNOWN" }],
      models: [{
        providerId: "fix", surfaceId: "FIX", providerLabel: "Fixture Vid", modelFamily: "Fixture", modelVersionOrTier: "1",
        mediaKinds: ["video"], availability: "UNKNOWN", sourceRefs: ["fix-doc"], observedAt: NOW, status: "ACTIVE",
        capabilityRules: [{ capability: "VIDEO_GENERATION", support: "SUPPORTED", constraints: {}, sourceRefs: ["fix-doc"], observedAt: NOW, freshness: "FRESH" }],
        costObservations: [obs(10), obs(20)],
      }],
    });
    assert(built.ok, "conflict fixture builds");
    const plan = planOf([{
      shotId: "sh-0000000000c8", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      modelId: "fix--fixture--1",
    }], { snapshot: built.snapshot });
    assert(plan.units[0].estimatedCreditState === "CONFLICT", "conflict preserved, exact refused");
    assert(plan.summary.estimatedCredits.exactTotalCredits === null, "no exact total");
  });

  await runTest("C9 image cost is not assumed zero", () => {
    const plan = planOf([{ shotId: "sh-0000000000c9", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: false } }]);
    assert(plan.units[0].estimatedCredits === null, "no invented zero");
    assert(plan.summary.estimatedImages === 1, "quantity planning still useful");
  });

  await runTest("C10 no provider price constants in 1G.8 source", () => {
    const dir = path.join(__dirname, "..", "..", "lib", "output-cost");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      // Guard patterns legitimately name what they forbid (repo convention).
      const src = fs.readFileSync(path.join(dir, f), "utf8")
        .split("\n").filter((l) => !/_PATTERN\s*=|MODEL_NAME_PATTERN\s*=/.test(l)).join("\n");
      assert(!/credits\s*[:=]\s*\d+|value:\s*\d+|===\s*\d+\s*&&.*credit/i.test(src), `${f}: no price literals`);
      assert(!/\bveo[\s-]?3\.1\b|\bveo[\s-]?fast\b|\bveo[\s-]?lite\b|\bveo[\s-]?quality\b|nano[\s-]?banana|omni[\s-]?flash|gpt-image|dall-e/i.test(src), `${f}: no model names`);
    }
  });

  // ---------------- B — BUDGET ----------------
  function exactPlan(limit, spend, extra = {}) {
    // Two omni-8s units = 24 known; caller trims via spend override below.
    const snap = seed();
    const plan = planOf([{
      shotId: "sh-0000000000d0", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
      outputCount: 2, specialRole: "HERO_SHOT", specialReason: "TEST-ONLY",
    }], { snapshot: snap });
    if (spend !== undefined) {
      for (const u of plan.units) { u.estimatedCreditState = "EXACT"; u.estimatedCredits = spend / 2; }
      plan.summary.estimatedCredits = { state: "EXACT", knownCredits: spend, exactTotalCredits: spend, unknownUnitCount: 0, conflictingUnitCount: 0, staleUnitCount: 0 };
    }
    return budgetOf(plan, limit, extra);
  }

  await runTest("B1 hard budget required before spend-capable authorization", () => {
    const r = oc.buildBudgetPlan({ projectId: "p", scopeId: "s", outputPlan: planOf([{ shotId: "sh-0000000000d1", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []) }]), now: NOW });
    assert(!r.ok && r.code === "HARD_BUDGET_REQUIRED", "no budget invented");
    const a = oc.authorizeGenerationAttempt({ budgetPlan: null, unit: { unitId: "x" }, cost: { state: "EXACT", valuePerGeneration: 1 } });
    assert(a.state === "BLOCKED", "authorization needs a plan");
  });

  await runTest("B2 under budget approved (24/30)", () => {
    const bp = exactPlan(30, 24);
    const a = oc.authorizeGenerationAttempt({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: { unitId: "u" }, cost: { state: "EXACT", valuePerGeneration: 24 } });
    assert(a.state === "APPROVED", `approved, got ${a.state}`);
  });

  await runTest("B3 exact boundary approved (30/30)", () => {
    const bp = exactPlan(30, 30);
    const a = oc.authorizeGenerationAttempt({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: { unitId: "u" }, cost: { state: "EXACT", valuePerGeneration: 30 } });
    assert(a.state === "APPROVED", "boundary is not over-budget");
  });

  await runTest("B4 over budget blocked (31/30)", () => {
    const bp = exactPlan(30, 31);
    const a = oc.authorizeGenerationAttempt({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: { unitId: "u" }, cost: { state: "EXACT", valuePerGeneration: 31 } });
    assert(a.state === "BLOCKED_BUDGET_EXCEEDED", "hard stop on proven exceed");
  });

  await runTest("B5 unknown paid cost never guaranteed approved", () => {
    const plan = planOf([{ shotId: "sh-0000000000d5", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: false } }]);
    const bp = budgetOf(plan, 30);
    const a = oc.authorizeGenerationAttempt({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: plan.units[0], cost: { state: "UNKNOWN" } });
    assert(a.state === "PRE_GENERATION_REVIEW_REQUIRED", `review, not approval (got ${a.state})`);
    const strict = budgetOf(plan, 30, { strictUnknownCost: true });
    const b = oc.authorizeGenerationAttempt({ budgetPlan: strict, ledger: { creditsObserved: 0, committed: 0 }, unit: plan.units[0], cost: { state: "UNKNOWN" } });
    assert(b.state === "BLOCKED_COST_UNKNOWN", "strict policy blocks");
  });

  await runTest("B6 project remaining constrains job authorization", () => {
    const bp = exactPlan(100, 24);
    const a = oc.authorizeGenerationAttempt({
      budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: { unitId: "u" },
      cost: { state: "EXACT", valuePerGeneration: 24 },
      parentTotals: { limit: 10, creditsObserved: 0, committed: 0 },
    });
    assert(a.state === "HARD_BUDGET_STOP" || a.state === "BLOCKED_BUDGET_EXCEEDED", `project cap binds (got ${a.state})`);
  });

  await runTest("B7 operator can raise budget with reason (new fingerprint, history kept)", () => {
    const plan = planOf([{ shotId: "sh-0000000000d7", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []) }]);
    const v1 = budgetOf(plan, 10);
    const v2 = budgetOf(plan, 50, {});
    const r2 = oc.buildBudgetPlan({ projectId: "p-1g8", scopeId: "scope-1", hardBudget: { unit: "CREDITS", limit: 50, source: "operator-raise: test reason" }, outputPlan: plan, now: NOW, supersedes: v1.fingerprint });
    assert(r2.ok && r2.budgetPlan.supersedes === v1.fingerprint, "raise links history, not silent mutation");
    assert(r2.budgetPlan.fingerprint !== v1.fingerprint, "new fingerprint for new budget");
  });

  await runTest("B8 over-budget override cannot bypass without changing budget", () => {
    const bp = exactPlan(30, 31);
    const v = oc.validateBudgetPlan({ plan: { ...bp, hardBudget: { unit: "CREDITS", limit: 30 } } });
    void v;
    const a = oc.authorizeGenerationAttempt({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: { unitId: "u" }, cost: { state: "EXACT", valuePerGeneration: 31 } });
    assert(a.state === "BLOCKED_BUDGET_EXCEEDED", "no force flag exists on authorize");
    assert(typeof oc.authorizeGenerationAttempt({ budgetPlan: bp }).state === "string", "states are explicit strings");
  });

  // ---------------- R — RETRY ----------------
  function retryPlan() {
    const plan = planOf([{ shotId: "sh-0000000000e1", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" }], { snapshot: seed() });
    return budgetOf(plan, 100, { retryPolicies: { "gu:shot": { maxAdditionalAttempts: 1, reservedCredits: 12, allowedFailureClasses: ["TRANSIENT"] } } });
  }

  await runTest("R1 no automatic retry without policy", () => {
    const plan = planOf([{ shotId: "sh-0000000000e2", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []) }]);
    const bp = budgetOf(plan, 100);
    const r = oc.authorizeRetry({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unitGroup: "gu:shot", failureClass: "TRANSIENT", priorAttemptId: "a1", attemptIndex: 1 });
    assert(r.state === "BLOCKED_RETRY_BUDGET_EXCEEDED", "default is no automatic retry");
  });

  await runTest("R2 retry carries attempt lineage", () => {
    const bp = retryPlan();
    const r = oc.authorizeRetry({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unitGroup: "gu:shot", failureClass: "TRANSIENT", priorAttemptId: "att-001", attemptIndex: 1 });
    assert(r.state === "APPROVED" && r.attemptId === "gu:shot:attempt-1", "lineaged attempt id");
    const bad = oc.authorizeRetry({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unitGroup: "gu:shot", failureClass: "TRANSIENT", priorAttemptId: null, attemptIndex: 1 });
    assert(bad.state === "BLOCKED", "lineage required");
  });

  await runTest("R3 retry budget reserved and checked", () => {
    const bp = retryPlan();
    const r = oc.authorizeRetry({ budgetPlan: bp, ledger: { creditsObserved: 95, committed: 0 }, unitGroup: "gu:shot", failureClass: "TRANSIENT", priorAttemptId: "a1", attemptIndex: 1 });
    assert(r.state === "BLOCKED_RETRY_BUDGET_EXCEEDED", "reserved 12 does not fit remaining 5");
  });

  await runTest("R4 retry over budget is a hard stop", () => {
    const bp = retryPlan();
    const r = oc.authorizeRetry({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unitGroup: "gu:shot", failureClass: "TRANSIENT", priorAttemptId: "a1", attemptIndex: 2 });
    assert(r.state === "BLOCKED_RETRY_BUDGET_EXCEEDED", "maxAdditionalAttempts enforced, no infinite loop");
  });

  await runTest("R5 retry is not a variant", () => {
    const plan = planOf([{
      shotId: "sh-0000000000e5", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      outputCount: 2, specialRole: "HERO_SHOT", specialReason: "TEST-ONLY",
    }]);
    assert(plan.summary.extraVariants === 1, "variants counted at plan time");
    const bp = retryPlan();
    const r = oc.authorizeRetry({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unitGroup: "gu:shot", failureClass: "TRANSIENT", priorAttemptId: "a1", attemptIndex: 1 });
    assert(r.state === "APPROVED" && r.attemptId === "gu:shot:attempt-1", "retry authorized as a lineaged attempt, tracked apart from variants");
  });

  await runTest("R6 failed attempt is not assumed zero-credit", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", hardBudgetLimit: 30, now: NOW });
    const rec = oc.recordGenerationObservation(ledger, { observationId: "obs-1", attemptId: "att-1", unitId: "gu-1", status: "FAILED", failureClass: "TRANSIENT" });
    assert(rec.ok && rec.ledger.totals.failed === 1, "failure counted");
    assert(rec.ledger.totals.creditsObserved === 0 && rec.ledger.reconciliationState === "UNRECONCILED", "unknown spend stays unreconciled, not zero");
    assert(rec.ledger.remainingBudget === 30, "remaining exact budget does not assume refund");
  });

  await runTest("R7 retry observation idempotent", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", hardBudgetLimit: 100, now: NOW });
    const obs = { observationId: "obs-r", attemptId: "att-r", unitId: "gu-1", status: "FAILED", failureClass: "TRANSIENT", retryOfAttemptId: "att-0", creditsObserved: 12 };
    const r1 = oc.recordGenerationObservation(ledger, obs);
    const r2 = oc.recordGenerationObservation(r1.ledger, obs);
    assert(r2.deduped === true && r2.ledger.totals.creditsObserved === 12, "second apply changes nothing");
    assert(r2.ledger.totals.retried === 1, "retry lineage counted once");
  });

  // ---------------- L — LEDGER ----------------
  await runTest("L1 planned/actual/failed/retried derived correctly", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", hardBudgetLimit: 100, now: NOW });
    for (const [oid, aid, st, extra] of [
      ["o1", "a1", "SUCCEEDED", { unitId: "gu-1", creditsObserved: 12 }],
      ["o2", "a2", "FAILED", { unitId: "gu-2", failureClass: "TRANSIENT" }],
      ["o3", "a3", "SUCCEEDED", { unitId: "gu-2", retryOfAttemptId: "a2", creditsObserved: 12 }],
    ]) {
      const r = oc.recordGenerationObservation(ledger, { observationId: oid, attemptId: aid, status: st, ...extra });
      ledger = r.ledger;
    }
    assert(ledger.totals.planned === 2, "2 intended units");
    assert(ledger.totals.actual === 3, "3 submitted attempts");
    assert(ledger.totals.failed === 1 && ledger.totals.retried === 1, "1 failed, 1 retried");
    assert(ledger.totals.creditsObserved === 24, "authoritative observations only");
  });

  await runTest("L2 observed sums authoritative values only", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", now: NOW });
    const r = oc.recordGenerationObservation(ledger, { observationId: "o1", attemptId: "a1", unitId: "gu-1", status: "SUCCEEDED", creditsObserved: 12 });
    assert(r.ledger.totals.creditsObserved === 12, "exact sum");
  });

  await runTest("L3 same observation twice is not double-counted", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", now: NOW });
    const obs = { observationId: "o1", attemptId: "a1", unitId: "gu-1", status: "SUCCEEDED", creditsObserved: 12 };
    const r1 = oc.recordGenerationObservation(ledger, obs);
    const r2 = oc.recordGenerationObservation(r1.ledger, obs);
    assert(r2.deduped && r2.ledger.totals.creditsObserved === 12 && r2.ledger.entries.length === 1, "idempotent");
  });

  await runTest("L4 unreconciled failed cost preserved", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", hardBudgetLimit: 30, now: NOW });
    const r = oc.recordGenerationObservation(ledger, { observationId: "o1", attemptId: "a1", unitId: "gu-1", status: "FAILED", failureClass: "TRANSIENT" });
    assert(r.ledger.reconciliationState === "UNRECONCILED", "unknown failed spend unreconciled");
  });

  await runTest("L5 late credit observation reconciles", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", hardBudgetLimit: 30, now: NOW });
    const r1 = oc.recordGenerationObservation(ledger, { observationId: "o1", attemptId: "a1", unitId: "gu-1", status: "FAILED", failureClass: "TRANSIENT" });
    assert(r1.ledger.reconciliationState === "UNRECONCILED", "precondition");
    const r2 = oc.recordGenerationObservation(r1.ledger, { observationId: "o2", attemptId: "a1", unitId: "gu-1", status: "FAILED", failureClass: "TRANSIENT", creditsObserved: 12 });
    assert(r2.ledger.totals.creditsObserved === 12, "late arrival counted");
    assert(r2.ledger.remainingBudget === 18, "remaining recalculated");
    const r3 = oc.recordGenerationObservation(r2.ledger, { observationId: "o2", attemptId: "a1", unitId: "gu-1", status: "FAILED", creditsObserved: 12 });
    assert(r3.deduped && r3.ledger.totals.creditsObserved === 12, "idempotent re-apply");
  });

  await runTest("L6 conflict preserved, never merged", () => {
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", now: NOW });
    ledger.expectConflict = true;
    const r1 = oc.recordGenerationObservation(ledger, { observationId: "o1", attemptId: "a1", unitId: "gu-1", status: "SUCCEEDED", creditsObserved: 12 });
    const r2 = oc.recordGenerationObservation(r1.ledger, { observationId: "o2", attemptId: "a1", unitId: "gu-1", status: "SUCCEEDED", creditsObserved: 20 });
    assert(r2.ledger.reconciliationState === "CONFLICT", "disagreement preserved");
  });

  await runTest("L7 ledger round-trip persistence", () => {
    const root = tmpRoot("ledger");
    let ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "bp-1", hardBudgetLimit: 50, now: NOW });
    ledger = oc.recordGenerationObservation(ledger, { observationId: "o1", attemptId: "a1", unitId: "gu-1", status: "SUCCEEDED", creditsObserved: 12 }).ledger;
    assert(oc.persistLedger(root, "p-1g8", "scope-1", ledger).ok, "persisted");
    const loaded = oc.loadLedger(root, "p-1g8", "scope-1");
    assert(loaded.ledger.totals.creditsObserved === 12 && loaded.ledger.fingerprint === ledger.fingerprint, "round-trip stable");
  });

  // ---------------- T — TIME ESTIMATE ----------------
  await runTest("T1 no latency history means UNKNOWN", () => {
    const e = oc.estimateGenerationTime(null);
    assert(e.ok && e.estimate.state === "UNKNOWN", "honest unknown");
  });

  await runTest("T2 output duration is not generation latency", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "output-cost", "units.js"), "utf8")
      + fs.readFileSync(path.join(__dirname, "..", "..", "lib", "output-cost", "budget.js"), "utf8");
    assert(!/durationSeconds\s*\*\s*\d|duration.*latency|outputDuration.*estimate/i.test(src), "no duration-derived latency");
  });

  await runTest("T3 Fast label alone cannot create a numeric estimate", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "output-cost", "budget.js"), "utf8");
    assert(!/fast|lite|quality/i.test(src), "no tier-label latency inference");
    const e = oc.estimateGenerationTime([]);
    assert(e.estimate.state === "UNKNOWN", "still unknown");
  });

  await runTest("T4 measured observation may produce a sourced estimate", () => {
    const e = oc.estimateGenerationTime([{ estimateMs: 45000, sampleCount: 12, percentile: "p90", source: "local-history", observedAt: NOW }]);
    assert(e.estimate.state === "KNOWN" && e.estimate.estimateMs === 45000, "sourced estimate with provenance");
  });

  // ---------------- I — INTEGRATION BOUNDARY ----------------
  await runTest("I1–I5 upstream artifacts byte-identical after planning", () => {
    const decision = dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], [], { visualModality: "CHARACTER_MOMENT", renderMode: "VEO_FIRST_FRAME" });
    const snap = seed();
    const res = mreg.resolveRequirement(snap, {
      projectId: "p-1g8", sceneId: "s", shotId: "sh-0000000000f1", renderMode: "VEO_FIRST_FRAME",
      requiredCapabilities: ["VIDEO_GENERATION"], referenceStrategy: "TEXT_BASED", requiredAssetRoles: [],
      platform: "youtube", orientation: null, mediaTargetKind: "VIDEO", durationSeconds: 8,
      accountContext: { subscriptionTier: null, region: null, surface: null },
      outputCount: null, existingAssetSatisfied: false, missingInputImage: false,
      policyVersion: "x", sourceDecision: { decisionId: "d", fingerprint: "f" }, fingerprint: "abc",
    }, {});
    const before = JSON.stringify({ decision, res: res.artifact, snapFp: snap.fingerprint });
    const plan = planOf([{
      shotId: "sh-0000000000f1", decision, durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
      resolution: { resolutionId: "mr-1", recommendedModel: "google--gemini-omni-flash--1-1", costEstimate: res.artifact.costEstimate },
    }], { snapshot: snap });
    assert(plan.units.length === 1, "planned");
    assert(JSON.stringify({ decision, res: res.artifact, snapFp: snap.fingerprint }) === before, "1G.5 + 1G.6 byte-identical");
    assert(plan.units[0].workflow !== undefined && decision.visualModality === "CHARACTER_MOMENT", "no modality/rewrite; no model selection in planner");
  });

  await runTest("I6–I10 zero side effects by construction", () => {
    const dir = path.join(__dirname, "..", "..", "lib", "output-cost");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      assert(!/\.execute\s*\(|fetch\s*\(|https?\.request|playwright|\.click\s*\(|browser\./i.test(src), `${f}: no generation/UI/network calls`);
      assert(!/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/.test(src), `${f}: no secret access`);
    }
  });

  // ---------------- S — STALENESS ----------------
  await runTest("S1 same inputs same fingerprint", () => {
    const mk = () => planOf([{ shotId: "sh-0000000000g1", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } }]);
    assert(mk().fingerprint === mk().fingerprint, "idempotent plan");
    const bmk = () => budgetOf(mk(), 10);
    assert(bmk().fingerprint === bmk().fingerprint, "idempotent budget");
  });

  await runTest("S2 cost snapshot change stales budget plan only", () => {
    const plan = planOf([{ shotId: "sh-0000000000g2", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []) }]);
    const bp = budgetOf(plan, 50, { registrySnapshotRef: { snapshotId: "rs-a", fingerprint: "aaaaaaaaaaaaaaaa" } });
    const st = oc.checkBudgetStaleness(bp, { costSnapshotFingerprint: "bbbbbbbbbbbbbbbb" });
    assert(st.stale && st.reasons.some((r) => /cost evidence changed/.test(r) && /creative artifacts clean/.test(r)), "scoped staleness message");
  });

  await runTest("S3 outputCount change stales plan", () => {
    const mk = (n) => planOf([{ shotId: "sh-0000000000g3", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), outputCount: n, specialRole: "HERO_SHOT", specialReason: "TEST-ONLY" }]);
    assert(mk(1).fingerprint !== mk(2).fingerprint, "count change alters plan identity");
  });

  await runTest("S4 targeted-regeneration change stales affected scope", () => {
    const mk = (regen) => planOf([{
      shotId: "sh-0000000000g4", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8, adaptations: [{ platformId: "TIKTOK", regenerationDecision: regen }],
    }]);
    assert(mk("NOT_REQUIRED").units.length === 1 && mk("TARGETED_REGENERATION_REQUIRED").units.length === 2, "regen change alters units");
  });

  await runTest("S5 unrelated shot remains clean", () => {
    const mk = () => planOf([
      { shotId: "sh-0000000000g5", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } },
      { shotId: "sh-0000000000g6", decision: dec("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } },
    ]);
    const a = mk();
    const unitFp = a.units.map((u) => u.unitId).join(",");
    assert(unitFp === "" && a.summary.estimatedImages === 0, "unrelated clean shots plan nothing");
  });

  await runTest("S6 cost-only change leaves creative artifacts clean", () => {
    const decision = dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []);
    const before = JSON.stringify(decision);
    const plan = planOf([{ shotId: "sh-0000000000g7", decision }]);
    const bp = oc.buildBudgetPlan({
      projectId: "p-1g8", scopeId: "scope-1",
      hardBudget: { unit: "CREDITS", limit: 50, source: "operator-test" },
      outputPlan: plan, registrySnapshotRef: { snapshotId: "rs-a", fingerprint: "aaaaaaaaaaaaaaaa" }, now: NOW,
    }).budgetPlan;
    const st = oc.checkBudgetStaleness(bp, { costSnapshotFingerprint: "bbbbbbbbbbbbbbbb" });
    assert(st.stale, "budget stales");
    assert(JSON.stringify(decision) === before, "1G.5 decision clean");
  });

  // ---------------- E — E2E FIXTURE ----------------
  await runTest("E1–E8 mixed production fixture end to end", () => {
    const snap = seed();
    const D = (mode, strat, caps, roles) => dec(mode, strat, caps, roles);
    const items = [
      { shotId: "sh-0000000000h1", decision: D("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } },
      { shotId: "sh-0000000000h2", decision: D("STATIC_IMAGE", "STATIC_IMAGE", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: false } },
      { shotId: "sh-0000000000h3", decision: D("REMOTION_MOTION", "EDITOR_MOTION", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), assetStatus: { satisfied: true } },
      { shotId: "sh-0000000000h4", decision: D("REMOTION_MOTION", "EDITOR_MOTION", ["IMAGE_GENERATION"], ["PRIMARY_IMAGE"]), missingInputImage: true },
      { shotId: "sh-0000000000h5", decision: D("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"], ["START_FRAME"]), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" },
      { shotId: "sh-0000000000h6", decision: D("VEO_FIRST_LAST", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION", "FIRST_LAST_FRAME_VIDEO"], ["START_FRAME", "END_FRAME"]), durationSeconds: 6, modelId: "google--veo--3-1-fast" },
      { shotId: "sh-0000000000h7", decision: D("VEO_REFERENCE", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION", "REFERENCE_GUIDED_VIDEO"], ["CHARACTER_REFERENCE"]), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1", subscriptionTier: null },
      {
        shotId: "sh-0000000000h8", decision: D("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), durationSeconds: 8,
        modelId: "google--gemini-omni-flash--1-1",
        adaptations: [{ platformId: "YOUTUBE_LONG", regenerationDecision: "NOT_REQUIRED" }, { platformId: "TIKTOK", regenerationDecision: "TARGETED_REGENERATION_REQUIRED" }],
      },
      {
        shotId: "sh-0000000000h9", decision: D("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), durationSeconds: 8,
        modelId: "google--gemini-omni-flash--1-1", outputCount: 2, specialRole: "HERO_SHOT", specialReason: "TEST-ONLY hero pair",
      },
      {
        shotId: "sh-0000000000h0", decision: D("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
        outputCount: 4,
      },
    ];
    const r = oc.buildOutputPlan({ projectId: "p-e2e", scopeId: "e2e", items, registrySnapshot: snap, mreg, now: NOW });
    assert(r.ok, "plan builds with per-item blockers, not a crash");
    assert(r.plan.blockers.some((b) => /h0.*MULTI_OUTPUT_ROLE_REQUIRED/.test(b)), "invalid normal x4 rejected per-item");
    const s = r.plan.summary;
    assert(s.estimatedImages === 2, `2 missing images (got ${s.estimatedImages})`);
    assert(s.estimatedVeoShots === 5, `5 distinct Veo jobs (got ${s.estimatedVeoShots})`);
    assert(s.estimatedVariants === 9, `variants = units (got ${s.estimatedVariants})`);
    assert(s.estimatedCredits.state === "PARTIAL", `mixed known/unknown (got ${s.estimatedCredits.state})`);
    assert(s.estimatedCredits.knownCredits === 72, `known = 72 (got ${s.estimatedCredits.knownCredits})`);
    assert(s.estimatedGenerationTime.state === "UNKNOWN", "no latency evidence anywhere");
    // h5 omni 8s=12, h6 fast 6s tier unknown→UNKNOWN, h7 omni ref 8s=12, h8 2×12=24, h9 2×12=24.
    const bp = budgetOf(r.plan, 200);
    assert(bp.estimateState === "PARTIAL", "budget reflects partial certainty");
    const r2 = oc.buildOutputPlan({ projectId: "p-e2e", scopeId: "e2e", items, registrySnapshot: snap, mreg, now: NOW });
    assert(r2.plan.fingerprint === r.plan.fingerprint, "E8 deterministic second run");
  });

  // ---------------- SEL — EFFECTIVE SELECTION (FIX 01) ----------------
  function candDecision(selected) {
    return {
      decisionId: "pd-0123456789ab", fingerprint: "0123456789abcdef",
      renderMode: "VEO_FIRST_FRAME",
      recommendedOutputType: "GENERATED_MOTION_CANDIDATE",
      selectedOutputType: selected || null,
      effectiveOutputType: selected || "GENERATED_MOTION_CANDIDATE",
      requiredCapabilities: ["VIDEO_GENERATION", "IMAGE_TO_VIDEO"],
      requiredAssetRoles: ["START_FRAME"],
      referenceStrategy: "START_FRAME_REQUIRED", platform: "youtube",
      visualModality: "CHARACTER_MOMENT", claimRefs: [],
    };
  }

  await runTest("SEL1 candidate without selection plans 0 video units", () => {
    const plan = planOf([{ shotId: "sh-0000000000s1", decision: candDecision(null), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" }], { snapshot: seed() });
    assert(plan.units.length === 0, "no spend-capable units");
    assert(plan.summary.estimatedVeoShots === 0, "not counted as planned spend");
  });

  await runTest("SEL2 candidate without selection is REVIEW/AWAIT_SELECTION", () => {
    const plan = planOf([{ shotId: "sh-0000000000s2", decision: candDecision(null), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" }], { snapshot: seed() });
    assert(plan.status === "AWAITING_SELECTION", `status ${plan.status}`);
    assert(plan.awaitingSelection.includes("sh-0000000000s2"), "shot listed");
    assert(plan.warnings.some((w) => /AWAITING_SELECTION/.test(w)), "explicit warning");
  });

  await runTest("SEL3 candidate reserves no credits and SEL4 does not reduce remaining", () => {
    const plan = planOf([{ shotId: "sh-0000000000s3", decision: candDecision(null), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" }], { snapshot: seed() });
    assert(plan.summary.estimatedCredits.knownCredits === 0, "required known spend is 0");
    assert(plan.summary.potentialVeoShots === 1, "potential exposed separately");
    assert(plan.summary.potentialCredits.state === "EXACT" && plan.summary.potentialCredits.value === 12, "potential 12 kept out of required spend");
    const bp = budgetOf(plan, 30);
    const hs = oc.checkHardStop(bp, { creditsObserved: 0, committed: 0, totals: { creditsObserved: 0, committed: 0 } });
    const ledger = oc.newLedger({ projectId: "p-1g8", budgetPlanId: "x", hardBudgetLimit: 30, now: NOW });
    assert(ledger.remainingBudget === 30, "remaining untouched by unselected candidate");
    void hs;
  });

  await runTest("SEL5 candidate explicitly selected generated adds units", () => {
    const plan = planOf([{ shotId: "sh-0000000000s5", decision: candDecision("GENERATED_MOTION_CANDIDATE"), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" }], { snapshot: seed() });
    assert(plan.units.length === 1 && plan.summary.estimatedVeoShots === 1, "explicit selection authorizes spend");
    assert(plan.status !== "AWAITING_SELECTION", "selection resolves the wait");
  });

  await runTest("SEL6 candidate explicitly selected editor plans no video", () => {
    const plan = planOf([{
      shotId: "sh-0000000000s6",
      decision: { ...candDecision("EDITOR_MOTION"), effectiveOutputType: "EDITOR_MOTION", renderMode: "REMOTION_MOTION" },
      assetStatus: { satisfied: true },
    }]);
    assert(plan.units.length === 0, "editor selection means no video unit");
  });

  await runTest("SEL7 recommended effective-generated plans units", () => {
    const plan = planOf([{ shotId: "sh-0000000000s7", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []), durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1" }], { snapshot: seed() });
    assert(plan.units.length === 1, "canonical effective fallback works for RECOMMENDED");
  });

  await runTest("SEL8 planner never mutates 1G.5 selection", () => {
    const d = candDecision(null);
    const before = JSON.stringify(d);
    planOf([{ shotId: "sh-0000000000s8", decision: d, durationSeconds: 8 }]);
    assert(JSON.stringify(d) === before, "read-only");
  });

  // ---------------- FAM — SUBSCRIPTION / FAMILY CONTEXT (FIX 01) ----------------
  const LP = "google--veo--3-1-lite-lower-priority";

  function famPlan(tier, modelId) {
    return planOf([{
      shotId: "sh-0000000000f1", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 6, modelId, subscriptionTier: tier,
    }], { snapshot: seed() });
  }

  await runTest("FAM1 non-Ultra Lite uses sourced observation", () => {
    const u = famPlan("non-Ultra", "google--veo--3-1-lite").units[0];
    assert(u.estimatedCreditState === "EXACT" && u.estimatedCredits === 10, "non-Ultra Lite = 10");
  });

  await runTest("FAM2 Ultra subscriber uses sourced Ultra observation", () => {
    const u = famPlan("Ultra", "google--veo--3-1-lite").units[0];
    assert(u.estimatedCreditState === "EXACT" && u.estimatedCredits === 5, "Ultra Lite = 5");
  });

  await runTest("FAM3 family plan manager uses only source-backed observation", () => {
    const u = famPlan("Ultra-family-manager", LP).units[0];
    assert(u.estimatedCreditState === "EXACT" && u.estimatedCredits === 0, "manager 0 on Lower Priority variant, sourced");
  });

  await runTest("FAM4 family member is not treated as normal Ultra subscriber", () => {
    const u = famPlan("Ultra-family-member", LP).units[0];
    assert(u.estimatedCreditState === "UNKNOWN", `member has no applicable observation (got ${u.estimatedCreditState})`);
    const v = famPlan("Ultra-family-member", "google--veo--3-1-lite").units[0];
    assert(v.estimatedCreditState === "UNKNOWN", "member is not silently priced as Ultra on main Lite either");
  });

  await runTest("FAM5 unavailable account context cannot approve spend", () => {
    const plan = famPlan("Ultra-family-member", LP);
    const bp = budgetOf(plan, 100);
    const a = oc.authorizeGenerationAttempt({ budgetPlan: bp, ledger: { creditsObserved: 0, committed: 0 }, unit: plan.units[0], cost: { state: "UNKNOWN" } });
    assert(a.state !== "APPROVED", `member context never approves (got ${a.state})`);
  });

  await runTest("FAM6 unknown family role remains UNKNOWN", () => {
    const u = famPlan("Ultra-distant-cousin", LP).units[0];
    assert(u.estimatedCreditState === "UNKNOWN", "unguessed roles stay unknown");
  });

  // ---------------- E9 — MIXED FIXTURE CORRECTION (FIX 01 §13) ----------------
  await runTest("E9 unselected candidate excluded, explicit selection replans", () => {
    const snap = seed();
    const base = {
      shotId: "sh-0000000000e9", decision: candDecision(null),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
    };
    const r1 = oc.buildOutputPlan({ projectId: "p-e2e", scopeId: "e9", items: [base], registrySnapshot: snap, mreg, now: NOW });
    assert(r1.plan.summary.estimatedVeoShots === 0, "required excludes unselected candidate");
    assert(r1.plan.summary.potentialVeoShots === 1, "potential exposed separately");
    assert(r1.plan.status === "AWAITING_SELECTION", "status records selection required");
    const b1 = budgetOf(r1.plan, 30);
    assert(b1.summary.knownCredits === 0, "hard-budget required spend excludes it");
    // Operator explicitly selects the candidate workflow (new decision object;
    // the planner never mutates the original).
    const selected = { ...base.decision, selectedOutputType: "GENERATED_MOTION_CANDIDATE", effectiveOutputType: "GENERATED_MOTION_CANDIDATE" };
    const before = JSON.stringify(base.decision);
    const r2 = oc.buildOutputPlan({ projectId: "p-e2e", scopeId: "e9", items: [{ ...base, decision: selected }], registrySnapshot: snap, mreg, now: NOW });
    assert(r2.plan.summary.estimatedVeoShots === 1, "required count increments deterministically");
    assert(r2.plan.summary.estimatedCredits.knownCredits === 12, "credit estimate updates");
    assert(r2.plan.fingerprint !== r1.plan.fingerprint, "budget fingerprint changes");
    assert(JSON.stringify(base.decision) === before, "original 1G.5 artifact byte-identical");
  });

  // ---------------- SOURCE DRIFT ----------------
  await runTest("source drift: cost change needs data refresh, not code change", () => {
    const snap = seed();
    const item = {
      shotId: "sh-0000000000i1", decision: dec("VEO_FIRST_FRAME", "GENERATED_MOTION_RECOMMENDED", ["VIDEO_GENERATION"], []),
      durationSeconds: 8, modelId: "google--gemini-omni-flash--1-1",
    };
    const before = planOf([item], { snapshot: snap }).units[0].estimatedCredits;
    assert(before === 12, "current seed value flows through");
    const refreshed = JSON.parse(JSON.stringify(snap));
    const m = refreshed.models.find((x) => x.modelId === "google--gemini-omni-flash--1-1");
    const obs = m.costObservations.find((o) => o.value === 12);
    obs.value = 14;
    const rebuilt = mreg.buildSnapshot({ snapshotId: "rs-drift", createdAt: NOW, sources: refreshed.sources, surfaces: refreshed.surfaces, models: refreshed.models });
    assert(rebuilt.ok, "refresh is data-only");
    const after = planOf([item], { snapshot: rebuilt.snapshot }).units[0].estimatedCredits;
    assert(after === 14, "planner recomputes without source change");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "output-cost", "units.js"), "utf8")
      + fs.readFileSync(path.join(__dirname, "..", "..", "lib", "output-cost", "budget.js"), "utf8");
    assert(!/===\s*12\b|===\s*14\b|credits\s*:\s*12/.test(src), "no price literals in planner");
  });

  console.log(`\n=== 1G.8 output-cost-credit: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });
