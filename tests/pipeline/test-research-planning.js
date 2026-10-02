"use strict";

/**
 * UNFOLDIQ PHASE 1G.1 Prompt 01 — Research Required gate (B1-B5), Research
 * Plan builder/validator (C1-C10), and full-chain integration tests.
 * Deterministic fixtures only. No network, no paid calls, no fake evidence.
 */

var fs = require("fs");
var os = require("os");
var path = require("path");
var Ajv = require("ajv");
var addFormats = require("ajv-formats");
var rp = require("../../lib/research-plan.js");

var passed = 0;
var failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error("ASSERTION FAILED: " + message);
  console.log("  ✓ " + message);
  passed++;
}

function runTest(name, fn) {
  console.log("\n[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
  } catch (e) {
    console.log("[FAIL] " + name + ": " + e.message);
    failed++;
  }
}

function loadSchema(file) {
  var content = fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8");
  return JSON.parse(content.replace(/^\uFEFF/, ""));
}

function schemaValid(plan) {
  var ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  var validate = ajv.compile(loadSchema("research-plan.schema.json"));
  return validate(plan);
}

console.log("=== RESEARCH GATE + PLAN TESTS (B1-B5, C1-C10, integration) ===\n");

// ---- B: Research Required gate ----

runTest("B1 FACTUAL -> REQUIRED", function () {
  var r = rp.resolveResearchRequirement("FACTUAL", {});
  assert(r.ok === true && r.decision === "REQUIRED", "FACTUAL gates REQUIRED");
});

runTest("B2 HYBRID -> REQUIRED", function () {
  var r = rp.resolveResearchRequirement("HYBRID", {});
  assert(r.ok === true && r.decision === "REQUIRED", "HYBRID gates REQUIRED (folklore/testimony basis researched)");
});

runTest("B3 FICTION default -> NOT_REQUIRED", function () {
  var r = rp.resolveResearchRequirement("FICTION", {});
  assert(r.ok === true && r.decision === "NOT_REQUIRED", "original fiction needs no research");
});

runTest("B4 FICTION + world accuracy target -> OPTIONAL_TARGETED", function () {
  var r = rp.resolveResearchRequirement("FICTION", {
    targetedResearchTopics: ["Vietnamese provincial hospital architecture in the 1980s", "Vietnamese funeral customs"]
  });
  assert(r.ok === true && r.decision === "OPTIONAL_TARGETED", "targeted need gates OPTIONAL_TARGETED");
  assert(r.fictionalCore === true, "fictionalCore preserved");
  assert(r.targetedResearchTopics.length === 2, "targeted topics echoed");
});

runTest("B5 targeted fiction does not become FACTUAL", function () {
  var out = rp.planResearch({
    projectId: "t", topic: "Original ghost story in a 1980s hospital",
    contentClass: "FICTION",
    targetedResearchTopics: ["Vietnamese provincial hospital architecture in the 1980s"]
  });
  assert(out.ok === true, "targeted plan builds");
  assert(out.contentClass === "FICTION", "project stays FICTION");
  assert(out.researchRequired === "OPTIONAL_TARGETED", "requirement stays OPTIONAL_TARGETED");
  assert(out.fictionalCore === true, "fictionalCore preserved on facade result");
});

runTest("B6 factual research cannot be skipped", function () {
  var r = rp.resolveResearchRequirement("FACTUAL", { skipResearch: true });
  assert(r.ok === false && r.code === "RESEARCH_BYPASS_REJECTED", "skipResearch rejected for FACTUAL");
  var r2 = rp.resolveResearchRequirement("HYBRID", { skipResearch: true });
  assert(r2.ok === false && r2.code === "RESEARCH_BYPASS_REJECTED", "skipResearch rejected for HYBRID");
});

// ---- C: Research Plan ----

runTest("C1 required factual plan carries goal/questions/stop/budget", function () {
  var out = rp.planResearch({
    projectId: "t", topic: "History of Hoi An trading port",
    contentMode: "historical-documentary", platform: "youtube", audience: "general"
  });
  assert(out.ok === true && out.plan !== null, "factual plan produced");
  var p = out.plan;
  assert(typeof p.researchGoal === "string" && p.researchGoal.length >= 24, "researchGoal specific");
  assert(p.criticalQuestions.length > 0, "criticalQuestions non-empty");
  assert(Array.isArray(p.sourcePriority) && p.sourcePriority.length > 0, "sourcePriority present");
  assert(typeof p.stopCriteria === "string" && p.stopCriteria.length > 0, "stopCriteria present");
  assert(typeof p.researchBudget === "string" && p.researchBudget.length > 0, "budget represented");
  assert(typeof p.deepResearchAllowed === "boolean", "deepResearchAllowed is planning intent only");
  assert(schemaValid(p) === true, "plan passes research-plan.schema.json");
  var sem = rp.validateResearchPlanSemantics(p, { researchRequired: "REQUIRED" });
  assert(sem.status === "VALID", "plan semantically VALID");
});

runTest("C2 hybrid plan separates fact/folklore/testimony/uncertainty", function () {
  var out = rp.planResearch({
    projectId: "t", topic: "The haunted villa of Da Lat",
    contentMode: "urban-legend-documentary", platform: "tiktok"
  });
  assert(out.ok === true && out.contentClass === "HYBRID", "hybrid path resolves");
  var text = out.plan.criticalQuestions.concat(out.plan.supportingQuestions).join(" ").toLowerCase();
  assert(text.indexOf("documented") !== -1, "covers documented fact");
  assert(text.indexOf("folklore") !== -1 || text.indexOf("legend") !== -1, "covers folklore basis");
  assert(text.indexOf("testimony") !== -1 || text.indexOf("first-hand") !== -1, "covers testimony");
  assert(text.indexOf("alternative") !== -1 || text.indexOf("independent support") !== -1, "covers uncertainty");
  assert(/paranormal claims (are|is) (true|proven|real)/i.test(text) === false, "never assumes paranormal truth");
  assert(rp.validateResearchPlanSemantics(out.plan, { researchRequired: "REQUIRED" }).status === "VALID", "hybrid plan VALID");
});

runTest("C3 targeted fiction plan scopes only world-building", function () {
  var out = rp.planResearch({
    projectId: "t", topic: "Original ghost story in a 1980s hospital",
    contentClass: "FICTION", platform: "youtube",
    targetedResearchTopics: ["Vietnamese provincial hospital architecture in the 1980s", "period hospital equipment"]
  });
  assert(out.ok === true, "targeted plan builds");
  var text = out.plan.criticalQuestions.join(" ").toLowerCase();
  assert(text.indexOf("hospital architecture") !== -1 || text.indexOf("1980s") !== -1, "covers targeted factual subset");
  assert(text.indexOf("ghost really exist") === -1 && text.indexOf("did the fictional") === -1, "never asks for proof of fiction");
  assert(rp.validateResearchPlanSemantics(out.plan, { researchRequired: "OPTIONAL_TARGETED" }).status === "VALID", "targeted plan VALID");
});

runTest("C4 duplicate questions rejected or normalized", function () {
  var dup = {
    version: "1.0.0", projectId: "t", topic: "T", researchGoal: "Establish the documented timeline and evidence for T in depth.",
    contentClass: "FACTUAL", researchRequired: "REQUIRED",
    criticalQuestions: ["What is the timeline of T?", "What is the timeline of T?"],
    stopCriteria: "all critical answered"
  };
  var sem = rp.validateResearchPlanSemantics(dup, {});
  assert(sem.status === "INVALID" && sem.errors.some(function (e) { return e.code === "RESEARCH_PLAN_DUPLICATE_QUESTIONS"; }), "validator rejects duplicates");
  var built = rp.buildResearchPlan({ projectId: "t", topic: "T", contentClass: "FACTUAL", contentMode: "tutorial" });
  var all = built.plan.criticalQuestions.concat(built.plan.supportingQuestions || [], built.plan.optionalQuestions || []);
  var norm = all.map(function (q) { return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); });
  assert(new Set(norm).size === norm.length, "builder output contains no duplicates (normalized)");
});

runTest("C5 empty critical questions fail for REQUIRED", function () {
  var bad = {
    version: "1.0.0", projectId: "t", topic: "T", researchGoal: "Establish the documented timeline and evidence for T in depth.",
    contentClass: "FACTUAL", researchRequired: "REQUIRED", criticalQuestions: [],
    stopCriteria: "all critical answered"
  };
  var sem = rp.validateResearchPlanSemantics(bad, {});
  assert(sem.status === "INVALID" && sem.errors.some(function (e) { return e.code === "RESEARCH_PLAN_MISSING_CRITICAL_QUESTIONS"; }), "empty critical rejected");
});

runTest("C6 missing stop criteria fail", function () {
  var bad = {
    version: "1.0.0", projectId: "t", topic: "T", researchGoal: "Establish the documented timeline and evidence for T in depth.",
    contentClass: "FACTUAL", researchRequired: "REQUIRED", criticalQuestions: ["What is documented about T?"]
  };
  var sem = rp.validateResearchPlanSemantics(bad, {});
  assert(sem.status === "INVALID" && sem.errors.some(function (e) { return e.code === "RESEARCH_PLAN_INVALID_STOP_CRITERIA"; }), "missing stopCriteria rejected");
});

runTest("C7 FICTION + NOT_REQUIRED needs no fake plan", function () {
  var out = rp.planResearch({ projectId: "t", topic: "Original supernatural fiction", contentClass: "FICTION" });
  assert(out.ok === true && out.plan === null, "no plan required");
  assert(out.next === "STORY_DEVELOPMENT", "continues toward story development");
  var denied = rp.buildResearchPlan({ projectId: "t", topic: "T", contentClass: "FICTION" });
  assert(denied.ok === false && denied.code === "RESEARCH_NOT_REQUIRED", "builder refuses fake plan for pure fiction");
});

runTest("C8 platform propagation (youtube/tiktok/alias/invalid)", function () {
  var yt = rp.planResearch({ projectId: "t", topic: "T", contentMode: "news-explainer", platform: "youtube" });
  assert(yt.ok === true && yt.plan.platform === "youtube", "youtube retained");
  var tt = rp.planResearch({ projectId: "t", topic: "T", contentMode: "news-explainer", platform: "TT" });
  assert(tt.ok === true && tt.plan.platform === "tiktok", "TT alias normalized to tiktok");
  var bad = rp.planResearch({ projectId: "t", topic: "T", contentMode: "news-explainer", platform: "reels" });
  assert(bad.ok === false && bad.code === "INVALID_PLATFORM", "unknown platform rejected");
});

runTest("C9 content mode propagation; tutorial asks procedural questions", function () {
  var out = rp.planResearch({ projectId: "t", topic: "React Server Components", contentMode: "technical-explainer", platform: "youtube" });
  assert(out.ok === true && out.plan.contentMode === "technical-explainer", "mode propagated");
  var text = out.plan.criticalQuestions.join(" ").toLowerCase();
  assert(text.indexOf("steps") !== -1 || text.indexOf("official documentation") !== -1, "tutorial mode asks procedural questions, not documentary timeline");
});

runTest("C10 backward compatibility: pre-V5 input without contentClass", function () {
  var out = rp.planResearch({ projectId: "t", topic: "Ancient Human Fire Use", contentMode: "historical-documentary", platform: "youtube" });
  assert(out.ok === true && out.contentClass === "FACTUAL" && out.classSource === "MODE_MAP", "pre-V5 input loads via canonical mode mapping");
});

// ---- semantic mismatch layer ----

runTest("Semantic mismatches rejected with precise codes", function () {
  function basePlan() {
    return {
      version: "1.0.0", projectId: "t", topic: "T", researchGoal: "Establish the documented timeline and evidence for T in depth.",
      contentClass: "FACTUAL", researchRequired: "REQUIRED",
      criticalQuestions: ["What is documented about T?"], stopCriteria: "all critical answered"
    };
  }
  var mismatch = basePlan();
  mismatch.researchRequired = "NOT_REQUIRED";
  assert(rp.validateResearchPlanSemantics(mismatch, {}).errors.some(function (e) { return e.code === "RESEARCH_REQUIREMENT_MISMATCH" || e.code === "RESEARCH_NOT_REQUIRED"; }), "FACTUAL + NOT_REQUIRED rejected");
  var generic = basePlan();
  generic.researchGoal = "Research this topic.";
  assert(rp.validateResearchPlanSemantics(generic, {}).errors.some(function (e) { return e.code === "RESEARCH_PLAN_INVALID"; }), "generic goal rejected");
  var badClass = basePlan();
  badClass.contentClass = "DOCU";
  assert(rp.validateResearchPlanSemantics(badClass, {}).errors.some(function (e) { return e.code === "INVALID_CONTENT_CLASS"; }), "invalid class rejected");
  var conflict = basePlan();
  conflict.contentClass = "FICTION";
  conflict.contentMode = "historical-documentary";
  conflict.researchRequired = "OPTIONAL_TARGETED";
  var cr = rp.validateResearchPlanSemantics(conflict, {});
  assert(cr.status === "REVIEW_REQUIRED" && cr.errors[0].code === "CONTENT_MODE_CLASS_CONFLICT", "class/mode conflict -> REVIEW_REQUIRED");
  var badFiction = {
    version: "1.0.0", projectId: "t", topic: "Ghost tale", researchGoal: "Verify only the historical details needed to make the fictional setting plausible.",
    contentClass: "FICTION", researchRequired: "OPTIONAL_TARGETED",
    criticalQuestions: ["Did the fictional ghost really exist?"], stopCriteria: "scope done"
  };
  assert(rp.validateResearchPlanSemantics(badFiction, {}).errors.some(function (e) { return e.code === "FICTION_SCOPE_VIOLATION"; }), "fiction proof-seeking rejected");
});

// ---- integration ----

runTest("Integration: five paths end to end", function () {
  var factual = rp.planResearch({ projectId: "p1", topic: "History of Hoi An", contentMode: "historical-documentary", platform: "youtube" });
  assert(factual.ok === true && factual.researchRequired === "REQUIRED" && factual.plan !== null, "FACTUAL path: class -> REQUIRED -> plan");
  var fiction = rp.planResearch({ projectId: "p2", topic: "Original horror story", contentClass: "FICTION", platform: "tiktok" });
  assert(fiction.ok === true && fiction.researchRequired === "NOT_REQUIRED" && fiction.plan === null, "FICTION path: no-research -> story");
  var targeted = rp.planResearch({
    projectId: "p3", topic: "Ghost story set in 1980s Hanoi", contentClass: "FICTION",
    targetedResearchTopics: ["Hanoi architecture in the 1980s"], platform: "youtube"
  });
  assert(targeted.ok === true && targeted.researchRequired === "OPTIONAL_TARGETED" && targeted.plan !== null, "targeted path: scoped plan");
  var hybrid = rp.planResearch({ projectId: "p4", topic: "Urban legend of the Da Lat villa", contentMode: "urban-legend-documentary", platform: "tiktok" });
  assert(hybrid.ok === true && hybrid.contentClass === "HYBRID" && hybrid.researchRequired === "REQUIRED", "HYBRID path: REQUIRED plan");
  var ambiguous = rp.planResearch({ projectId: "p5", topic: "The Room 304 Mystery", platform: "youtube" });
  assert(ambiguous.ok === false && ambiguous.code === "AMBIGUOUS_CONTENT_CLASS", "ambiguous path: explicit unresolved, no fabricated plan");
});

runTest("Integration: YouTube/TikTok share core, platform shapes only scope", function () {
  var matrix = [
    ["youtube", "historical-documentary", "FACTUAL", "REQUIRED"],
    ["tiktok", "historical-documentary", "FACTUAL", "REQUIRED"],
    ["youtube", "horror-fiction", "FICTION", "NOT_REQUIRED"],
    ["tiktok", "urban-legend-documentary", "HYBRID", "REQUIRED"]
  ];
  matrix.forEach(function (row) {
    var out = rp.planResearch({ projectId: "m", topic: "T-" + row[1], contentMode: row[1], platform: row[0] });
    assert(out.ok === true && out.contentClass === row[2] && out.researchRequired === row[3], row[0] + " " + row[1] + " -> " + row[2] + "/" + row[3]);
    if (out.plan) assert(out.plan.platform === row[0], "platform propagated, truth class unchanged");
  });
});

runTest("No fake acquisition: plans carry questions, never sources/evidence", function () {
  var out = rp.planResearch({ projectId: "t", topic: "History of Hoi An", contentMode: "historical-documentary", platform: "youtube" });
  var raw = JSON.stringify(out.plan);
  assert(raw.indexOf("http") === -1, "no URLs in plan");
  assert(out.plan.sources === undefined && out.plan.claims === undefined, "no source/claim records in plan");
  assert(out.plan.researchMode === "STANDARD", "default STANDARD; DEEP only as later escalation intent");
  assert(out.plan.deepResearchAllowed === false, "deep research not executed here");
});

runTest("Persistence: idempotent project-state write", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-plan-"));
  var out = rp.planResearch({ projectId: "t", topic: "History of Hoi An", contentMode: "historical-documentary", platform: "youtube" });
  var first = rp.saveResearchPlan(dir, out.plan);
  assert(first.saved === true && first.path === path.join(dir, "research", "research-plan.json"), "plan persisted to research/research-plan.json");
  assert(JSON.parse(fs.readFileSync(first.path, "utf8")).topic === "History of Hoi An", "persisted artifact round-trips");
  var second = rp.saveResearchPlan(dir, out.plan);
  assert(second.saved === false && second.code === "UNCHANGED", "identical rerun writes no duplicate artifact");
  var changed = JSON.parse(JSON.stringify(out.plan));
  changed.audience = "academic";
  var third = rp.saveResearchPlan(dir, changed);
  assert(third.saved === true, "changed plan persists");
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log("\n=== SUMMARY ===");
console.log("Passed assertions: " + passed + ", Failed tests: " + failed);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
