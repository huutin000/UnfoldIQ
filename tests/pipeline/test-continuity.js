"use strict";

/**
 * UNFOLDIQ continuity tests (STEP 10A): CQ1–CQ12.
 * Executable, deterministic, TEST-ONLY registry fixtures (in-memory;
 * one path-based case under projects/__test10a__/continuity/, removed after).
 * No media generation. No image comparison (structural invariants only).
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__test10a__";

const { validateContinuityRegistry, checkContinuityPrecondition } = require("../../lib/continuity-check.js");

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

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

function ref(assetId, role, status, extra = {}) {
  return { assetId, path: `continuity/characters/${assetId}.png`, role, status, ...extra };
}

function lockedCharacter(id = "CHAR_MOTHER_01") {
  return {
    entityId: id,
    type: "CHARACTER",
    name: "Test mother",
    description: "TEST-ONLY recurring mother character",
    lockStatus: "LOCKED",
    referenceAssets: [ref("REF-MOTHER-MASTER", "MASTER", "APPROVED")],
    attributes: { ageRange: "30s", hair: "black bun", wardrobeIds: ["WARDROBE_MOTHER_01"] },
  };
}

function baseRegistry(entities, relationships = []) {
  return {
    version: "1.0.0",
    projectId: TEST_PROJECT,
    visualBibleVersion: "vb-1",
    entities,
    relationships,
    lockStatus: "LOCKED",
  };
}

const OPTS = { projectRoot: REPO_ROOT, projectId: TEST_PROJECT };

console.log("=== CONTINUITY TESTS (CQ1-CQ12) ===\n");

// CQ1 — LOCKED character + approved master → PASS.
runTest("CQ1 Locked character with approved master → PASS", () => {
  const v = validateContinuityRegistry(baseRegistry([lockedCharacter()]), OPTS);
  logOut("valid", v.valid);
  assert(v.valid === true, "locked character with approved master must PASS");
});

// CQ2 — LOCKED without approved reference → REJECT.
runTest("CQ2 Locked character without approved reference → REJECT", () => {
  const c = lockedCharacter();
  c.referenceAssets = [ref("REF-CAND", "MASTER", "CANDIDATE")];
  const v = validateContinuityRegistry(baseRegistry([c]), OPTS);
  logOut("codes", v.errors.map((e) => e.code));
  assert(v.valid === false, "locked without approved reference must be REJECTED");
  assert(v.errors.some((e) => e.code === "LOCKED_WITHOUT_APPROVED_REFERENCE"), "must carry LOCKED_WITHOUT_APPROVED_REFERENCE");
});

// CQ3 — STRICT scene requiring unlocked character → REJECT precondition.
runTest("CQ3 Strict scene with unlocked character → REJECT", () => {
  const c = lockedCharacter();
  c.lockStatus = "DRAFT";
  const pre = checkContinuityPrecondition(
    { requiredEntities: ["CHAR_MOTHER_01"], strictness: "STRICT" },
    baseRegistry([c]),
    OPTS
  );
  logOut("precondition", pre);
  assert(pre.ok === false, "STRICT with unlocked character must fail precondition");
});

// CQ4 — STRICT with locked character + wardrobe + location → PASS.
runTest("CQ4 Full locked continuity → PASS", () => {
  const wardrobe = {
    entityId: "WARDROBE_MOTHER_01",
    type: "WARDROBE",
    name: "Mother wardrobe",
    description: "TEST-ONLY earth-tone wrap dress",
    lockStatus: "LOCKED",
    referenceAssets: [{ assetId: "REF-WARD", path: "continuity/wardrobe/ref-ward.png", role: "WARDROBE_REFERENCE", status: "APPROVED" }],
    attributes: {},
  };
  const location = {
    entityId: "LOC_CAMP_01",
    type: "LOCATION",
    name: "Camp",
    description: "TEST-ONLY riverside camp",
    lockStatus: "LOCKED",
    referenceAssets: [{ assetId: "REF-LOC", path: "continuity/locations/ref-loc.png", role: "LOCATION_REFERENCE", status: "APPROVED" }],
    attributes: {},
  };
  const reg = baseRegistry([lockedCharacter(), wardrobe, location], [
    { from: "CHAR_MOTHER_01", relation: "wears", to: "WARDROBE_MOTHER_01" },
  ]);
  const v = validateContinuityRegistry(reg, OPTS);
  assert(v.valid === true, "full registry must validate");
  const pre = checkContinuityPrecondition(
    { requiredEntities: ["CHAR_MOTHER_01", "WARDROBE_MOTHER_01", "LOC_CAMP_01"], strictness: "STRICT" },
    reg,
    OPTS
  );
  logOut("precondition", pre);
  assert(pre.ok === true, "STRICT with all entities LOCKED must pass precondition");
});

// CQ5 — missing wardrobe relationship target → REJECT.
runTest("CQ5 Missing wardrobe relation target → REJECT", () => {
  const v = validateContinuityRegistry(
    baseRegistry([lockedCharacter()], [{ from: "CHAR_MOTHER_01", relation: "wears", to: "WARDROBE_GHOST" }]),
    OPTS
  );
  logOut("codes", v.errors.map((e) => e.code));
  assert(v.valid === false, "dangling wardrobe relation must be REJECTED");
  assert(v.errors.some((e) => e.code === "WARDROBE_RELATION_TARGET_MISSING"), "must carry WARDROBE_RELATION_TARGET_MISSING");
});

// CQ6 — path traversal reference → REJECT.
runTest("CQ6 Traversal reference → REJECT", () => {
  const c = lockedCharacter();
  c.referenceAssets = [{ assetId: "REF-EVIL", path: "../../evil.png", role: "MASTER", status: "APPROVED" }];
  const v = validateContinuityRegistry(baseRegistry([c]), OPTS);
  logOut("codes", v.errors.map((e) => e.code));
  assert(v.valid === false, "traversal reference must be REJECTED");
  assert(v.errors.some((e) => e.code === "REFERENCE_PATH_TRAVERSAL"), "must carry REFERENCE_PATH_TRAVERSAL");
});

// CQ7 — duplicate entity ID → REJECT.
runTest("CQ7 Duplicate entityId → REJECT", () => {
  const v = validateContinuityRegistry(baseRegistry([lockedCharacter(), lockedCharacter()]), OPTS);
  logOut("codes", v.errors.map((e) => e.code));
  assert(v.valid === false, "duplicate entityId must be REJECTED");
  assert(v.errors.some((e) => e.code === "DUPLICATE_ENTITY_ID"), "must carry DUPLICATE_ENTITY_ID");
});

// CQ8 — RETIRED reference for strict scene → REJECT.
runTest("CQ8 Retired reference for strict scene → REJECT", () => {
  const c = lockedCharacter();
  c.referenceAssets = [ref("REF-OLD", "MASTER", "RETIRED")];
  c.lockStatus = "RETIRED";
  const pre = checkContinuityPrecondition(
    { requiredEntities: ["CHAR_MOTHER_01"], strictness: "STRICT" },
    baseRegistry([c]),
    OPTS
  );
  logOut("precondition", pre);
  assert(pre.ok === false, "RETIRED entity must not satisfy STRICT requirement");
});

// CQ9 — AI historical reconstruction master labeled EVIDENCE_ASSET → REJECT.
runTest("CQ9 Reconstruction-as-evidence → REJECT", () => {
  const c = lockedCharacter();
  c.referenceAssets = [
    { assetId: "REF-AI-MASTER", path: "continuity/characters/ai-master.png", role: "MASTER", status: "APPROVED", aiGenerated: true, assetClassification: "EVIDENCE_ASSET" },
  ];
  const v = validateContinuityRegistry(baseRegistry([c]), OPTS);
  logOut("codes", v.errors.map((e) => e.code));
  assert(v.valid === false, "AI master labeled EVIDENCE_ASSET must be REJECTED");
  assert(v.errors.some((e) => e.code === "RECONSTRUCTION_AS_EVIDENCE"), "must carry RECONSTRUCTION_AS_EVIDENCE");
});

// CQ10 — same recurring IDs reusable across scene requests (S01 + S05).
runTest("CQ10 Recurring refs reusable across scenes", () => {
  const reg = baseRegistry([lockedCharacter()]);
  const s01 = checkContinuityPrecondition({ requiredEntities: ["CHAR_MOTHER_01"], strictness: "STRICT" }, reg, OPTS);
  const s05 = checkContinuityPrecondition({ requiredEntities: ["CHAR_MOTHER_01"], strictness: "STRICT" }, reg, OPTS);
  logOut("S01/S05", { s01: s01.ok, s05: s05.ok });
  assert(s01.ok === true && s05.ok === true, "same entity/reference IDs must satisfy both S01 and S05");
  // Registry also loads from a project-relative path (stable reference assets).
  const relPath = "continuity/continuity-registry.json";
  const absDir = path.join(REPO_ROOT, "projects", TEST_PROJECT, "continuity");
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(absDir, "continuity-registry.json"), JSON.stringify(reg));
  const viaPath = checkContinuityPrecondition({ requiredEntities: ["CHAR_MOTHER_01"], strictness: "STRICT" }, relPath, OPTS);
  assert(viaPath.ok === true, "registry resolvable by stable project-relative path");
  fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
});

// CQ11 — intentional wardrobe variant explicit → PASS.
runTest("CQ11 Explicit wardrobe variant → PASS", () => {
  const w = {
    entityId: "WARDROBE_MOTHER_01",
    type: "WARDROBE",
    name: "Mother wardrobe",
    description: "TEST-ONLY wardrobe",
    lockStatus: "LOCKED",
    referenceAssets: [{ assetId: "REF-W", path: "continuity/wardrobe/ref-w.png", role: "WARDROBE_REFERENCE", status: "APPROVED" }],
    attributes: { color: "ochre", material: "hide" },
    masterSnapshot: { color: "ochre", material: "hide" },
    variants: [{ variantId: "NIGHT", description: "Night variant", attributeOverrides: { color: "dark-ochre" } }],
  };
  w.attributes = { color: "dark-ochre", material: "hide" };
  const v = validateContinuityRegistry(baseRegistry([w]), OPTS);
  logOut("valid", v.valid);
  assert(v.valid === true, "explicit variant must PASS");
});

// CQ12 — silent master wardrobe overwrite → REJECT.
runTest("CQ12 Silent master overwrite → REJECT", () => {
  const w = {
    entityId: "WARDROBE_MOTHER_01",
    type: "WARDROBE",
    name: "Mother wardrobe",
    description: "TEST-ONLY wardrobe",
    lockStatus: "LOCKED",
    referenceAssets: [{ assetId: "REF-W", path: "continuity/wardrobe/ref-w.png", role: "WARDROBE_REFERENCE", status: "APPROVED" }],
    attributes: { color: "red", material: "hide" },
    masterSnapshot: { color: "ochre", material: "hide" },
    variants: [],
  };
  const v = validateContinuityRegistry(baseRegistry([w]), OPTS);
  logOut("codes", v.errors.map((e) => e.code));
  assert(v.valid === false, "silent master change must be REJECTED");
  assert(v.errors.some((e) => e.code === "SILENT_MASTER_OVERWRITE"), "must carry SILENT_MASTER_OVERWRITE");
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
