"use strict";

/**
 * UNFOLDIQ context-routing tests (STEP 09 V2): C1-C7.
 * No network calls. Resolves routes only; never reads full doc contents.
 */

const { resolveRoute } = require("../../scripts/cli/context-resolver.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

console.log("=== CONTEXT ROUTING TESTS (C1-C7) ===\n");

// C1 — Topic Discovery: Stage 3A TikTok
runTest("C1 Stage 3A TikTok includes discovery/registry + profile, excludes render", () => {
  const r = resolveRoute("3A", "tiktok");
  assert(!r.error, "route 3A resolves");
  assert(r.required.includes("core/TOPIC_DISCOVERY.md"), "includes core/TOPIC_DISCOVERY.md");
  assert(r.required.includes("core/TOPIC_REGISTRY.md"), "includes core/TOPIC_REGISTRY.md");
  assert(r.required.includes("projects/TOPIC_REGISTRY.json"), "includes projects/TOPIC_REGISTRY.json");
  assert(r.required.some((p) => p.includes("tiktok") && p.includes("PROFILE")), "includes TikTok profile");
  assert(!r.required.some((p) => p.toLowerCase().includes("remotion")), "excludes Remotion/render docs from required");
  assert(!r.required.some((p) => p.startsWith("Report/")), "excludes Report/ from required");
});

// C2 — Research: Stage 3B
runTest("C2 Stage 3B includes RESEARCH_QUALITY, excludes provider impl by default", () => {
  const r = resolveRoute("3B", "youtube");
  assert(!r.error, "route 3B resolves");
  assert(r.required.includes("core/RESEARCH_QUALITY.md"), "includes core/RESEARCH_QUALITY.md");
  assert(r.required.includes("schemas/research-brief.schema.json"), "includes research-brief contract");
  assert(!r.required.some((p) => p.startsWith("providers/")), "excludes provider implementation from required");
});

// C3 — Story: Stage 4
runTest("C3 Stage 4 includes STORYTELLING + inputs, excludes Report/", () => {
  const r = resolveRoute("4", "youtube");
  assert(!r.error, "route 4 resolves");
  assert(r.required.includes("core/STORYTELLING.md"), "includes core/STORYTELLING.md");
  assert(r.required.includes("research-brief.json"), "includes research brief input");
  assert(r.required.includes("content-mode.json"), "includes content mode input");
  assert(r.required.includes("editorial-strategy.json"), "includes editorial strategy input");
  assert(!r.required.concat(r.conditional.map((c) => c.path)).some((p) => p.startsWith("Report/")), "excludes Report/");
});

// C4 — Asset Generation: Stage 10
runTest("C4 Stage 10 includes provider/creative/visual, discovery not required", () => {
  const r = resolveRoute("10", "tiktok");
  assert(!r.error, "route 10 resolves");
  assert(r.required.includes("providers/INDEX.md"), "includes provider router");
  assert(r.required.includes("core/CREATIVE_DIRECTION.md"), "includes creative direction");
  assert(r.required.includes("core/VISUAL_BIBLE.md"), "includes visual bible");
  assert(!r.required.includes("core/TOPIC_DISCOVERY.md"), "Topic Discovery is not REQUIRED at stage 10");
});

// C5 — Remotion Build: Stage 14
runTest("C5 Stage 14 includes video spec/contracts + Remotion, excludes Report/", () => {
  const r = resolveRoute("14", "youtube");
  assert(!r.error, "route 14 resolves");
  assert(r.required.includes("video-spec.json"), "includes video-spec.json");
  assert(r.required.includes("core/PRODUCTION_CONTRACTS.md"), "includes production contracts");
  assert(r.required.some((p) => p.toLowerCase().includes("remotion")), "includes Remotion context");
  assert(!r.required.some((p) => p.startsWith("Report/")), "excludes Report/");
});

// C6 — Final Policy QA: Stage 17
runTest("C6 Stage 17 includes policy router/sources + final inputs", () => {
  const r = resolveRoute("17", "youtube");
  assert(!r.error, "route 17 resolves");
  assert(r.required.includes("policy/ROUTER.md"), "includes policy router");
  assert(r.required.includes("policy/SOURCES.yaml"), "includes policy source registry");
  assert(r.required.includes("asset-manifest.json"), "includes final asset manifest input");
  assert(r.required.includes("render evidence"), "includes final render evidence input");
  assert(r.required.includes("core/POLICY_RIGHTS.md"), "includes rights invariants");
});

// C7 — Development history exclusion
runTest("C7 Report/archive/phase-1/STEP-08_FIX_2_REPORT.md never in runtime route", () => {
  const stages = ["1", "2", "3A", "3B", "3C", "3D", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];
  for (const s of stages) {
    const r = resolveRoute(s, "youtube");
    const all = r.required.concat(r.conditional.map((c) => c.path));
    if (all.some((p) => p.includes("Report/") || p.includes("STEP-") || p.includes("setup/history"))) {
      throw new Error(`stage ${s} leaks development history into runtime route`);
    }
  }
  console.log("  ✓ Report/archive/phase-1/STEP-08_FIX_2_REPORT.md absent from all 22 runtime routes");
  passed++;
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
