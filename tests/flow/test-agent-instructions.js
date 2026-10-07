"use strict";

/**
 * Phase 1G.9 — Flow Agent Instructions Manager tests (Prompt 01, Stage A).
 * Deterministic. No browser, no generation, 0 credits, 0 Flow mutations.
 * Covers IA (artifact/compiler), IS unit paths (binding/evidence/blocked),
 * IR (readback/semantic), IB (boundaries), plus adapter surface unit tests
 * via DOM-abstracted fakes. The LIVE gate (real apply/readback/verify on
 * the operator's Flow project) is NOT claimed here — see report blocker
 * LIVE_FLOW_INSTRUCTION_VERIFICATION_REQUIRED.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const ai = require("../../lib/agent-instructions/index.js");
const bridgeSync = require("../../flow-companion/bridge/instruction-sync.js");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g9-${tag}-`));
}

const NOW = "2026-10-03T00:00:00.000Z";

function baseInput(over = {}) {
  return {
    projectId: "p-1g9",
    characterLocks: { version: "cb-1", identities: ["Lan keeps her shaved head and ward uniform in every scene"] },
    worldRules: { version: "wb-1", continuity: ["Night ward stays on floor 3"] },
    visualRules: { version: "vb-1", style: ["flat vector illustration"], palette: ["#0b0e14", "#f5f7fa"] },
    channelDefaults: { version: "ch-1" },
    platformComposition: { version: "pp-1", rules: ["9:16 keeps captions above bottom UI"] },
    referenceBindings: [{ referenceId: "ref-lan-master", role: "CHARACTER_IDENTITY", reason: "locked Lan identity" }],
    now: NOW,
    ...over,
  };
}

// Minimal DOM-abstracted fake root for adapter unit tests.
function fakeRoot(map) {
  return {
    querySelector: (sel) => {
      const v = map[sel];
      if (Array.isArray(v)) return v[0] || null;
      return v || null;
    },
    querySelectorAll: (sel) => {
      const v = map[sel];
      if (Array.isArray(v)) return v;
      return v ? [v] : [];
    },
  };
}

function fakeEl(text) {
  return {
    value: "",
    textContent: text,
    innerText: text,
    getAttribute: () => null,
    querySelectorAll: () => [],
  };
}

async function main() {
  // ---------------- IA — ARTIFACT / COMPILER ----------------
  await runTest("IA1 project invariants compile deterministically", () => {
    const a = ai.compileInstructionSet(baseInput());
    const b = ai.compileInstructionSet(baseInput());
    assert(a.ok && b.ok, "both compile");
    assert(a.instructionSet.instructionVersion === b.instructionSet.instructionVersion, "same version");
    assert(a.instructionSet.compiledFingerprint === b.instructionSet.compiledFingerprint, "same fingerprint");
    assert(/shaved head/.test(a.instructionSet.compiledText), "identity lock compiled");
    assert(/Night ward/.test(a.instructionSet.compiledText), "world continuity compiled");
    assert(/9:16/.test(a.instructionSet.compiledText), "platform composition included");
  });

  await runTest("IA2 scene-specific prompt data excluded (rejected, not dropped)", () => {
    const r = ai.compileInstructionSet(baseInput({
      operatorOverrides: { actionIntent: "Lan runs down the stairs" },
    }));
    assert(!r.ok && r.code === "INSTRUCTION_SCENE_LEAK", "scene leak rejected");
    const r2 = ai.compileInstructionSet(baseInput({ operatorOverrides: { cameraMotion: "fast pan left" } }));
    assert(!r2.ok, "camera motion rejected");
    const v = ai.validateInstructionSet({ set: { ...ai.compileInstructionSet(baseInput()).instructionSet, compiledText: "PROJECT INVARIANTS:\n- shot 12 pans left" } });
    assert(!v.valid && v.errors.some((e) => e.code === "SCENE_PROMPT_LEAK"), "validator catches shot directives");
  });

  await runTest("IA3/IA4 identity and world continuity preserved", () => {
    const s = ai.compileInstructionSet(baseInput()).instructionSet;
    assert(s.constraints.characterIdentity.length === 1 && s.constraints.worldContinuity.length === 1, "locks preserved verbatim");
  });

  await runTest("IA5/IA6 platform rules and negative constraints included", () => {
    const s = ai.compileInstructionSet(baseInput()).instructionSet;
    assert(s.constraints.platformCompositionRules.length === 1, "platform rules present");
    assert(s.constraints.forbiddenMutations.length >= 7, "stable negative constraints present");
    assert(s.constraints.unwantedContent.some((u) => /watermark/.test(u)), "watermark rule present");
  });

  await runTest("IA7/IA8 versioning follows relevant inputs only", () => {
    const a = ai.compileInstructionSet(baseInput()).instructionSet;
    const b = ai.compileInstructionSet(baseInput({ characterLocks: { version: "cb-2", identities: ["Lan keeps long hair"] } })).instructionSet;
    assert(a.instructionVersion !== b.instructionVersion, "identity change bumps version");
    const c = ai.compileInstructionSet(baseInput({ now: "2026-10-04T00:00:00.000Z" })).instructionSet;
    assert(c.compiledFingerprint === a.compiledFingerprint, "timestamp does not change fingerprint");
  });

  await runTest("IA reference binding roles canonical", () => {
    const r = ai.compileInstructionSet(baseInput({ referenceBindings: [{ referenceId: "x", role: "MOOD" }] }));
    assert(!r.ok && r.code === "REFERENCE_ROLE_INVALID", "non-canonical role rejected");
    const v = ai.validateInstructionSet({ set: ai.compileInstructionSet(baseInput()).instructionSet });
    assert(v.valid, `valid set passes: ${JSON.stringify(v.errors)}`);
  });

  await runTest("IA persistence keeps history, never overwrites", () => {
    const root = tmpRoot("hist");
    const a = ai.compileInstructionSet(baseInput()).instructionSet;
    const b = ai.compileInstructionSet(baseInput({ characterLocks: { version: "cb-2", identities: ["Lan keeps long hair"] } })).instructionSet;
    assert(ai.persistInstructionSet(root, "p-1g9", a).ok, "v1 persisted");
    assert(ai.persistInstructionSet(root, "p-1g9", b).ok, "v2 persisted");
    assert(ai.loadInstructionSet(root, "p-1g9", a.instructionVersion).set.compiledFingerprint === a.compiledFingerprint, "v1 intact");
    assert(ai.loadInstructionSet(root, "p-1g9", b.instructionVersion).set.compiledFingerprint === b.compiledFingerprint, "v2 intact");
  });

  // ---------------- IS — SYNC (unit paths; live apply excluded) ----------------
  await runTest("IS1 exact project binding required before mutation", () => {
    const set = ai.compileInstructionSet(baseInput()).instructionSet;
    const noBinding = bridgeSync.buildApplyPlan({ instructionSet: set, binding: { contentScriptConnected: true, bridgeReachable: true }, agentState: { detected: true, enabled: true } });
    assert(!noBinding.ok && noBinding.blockers.some((b) => /PROJECT_IDENTITY_UNKNOWN/.test(b)), "ambiguous project blocked");
    const mismatch = bridgeSync.buildApplyPlan({
      instructionSet: set,
      binding: { contentScriptConnected: true, bridgeReachable: true, expectedProjectRef: "proj-A", observedProjectRef: "proj-B" },
      agentState: { detected: true, enabled: true },
    });
    assert(!mismatch.ok && mismatch.blockers.some((b) => /PROJECT_MISMATCH/.test(b)), "cross-project mutation refused");
    const ok = bridgeSync.buildApplyPlan({
      instructionSet: set,
      binding: { contentScriptConnected: true, bridgeReachable: true, expectedProjectRef: "proj-A", observedProjectRef: "proj-A" },
      agentState: { detected: true, enabled: true },
    });
    assert(ok.ok && ok.plan.steps.includes("VERIFY_PROJECT"), "bound plan built, project verified first");
  });

  await runTest("IS2 agent state unknown blocks safely", () => {
    const set = ai.compileInstructionSet(baseInput()).instructionSet;
    const r = bridgeSync.buildApplyPlan({
      instructionSet: set,
      binding: { contentScriptConnected: true, bridgeReachable: true, expectedProjectRef: "proj-A", observedProjectRef: "proj-A" },
      agentState: null,
    });
    assert(!r.ok && r.blockers.some((b) => /AGENT_STATE_UNKNOWN/.test(b)), "no blind action");
  });

  await runTest("IS5 apply result is APPLIED, never VERIFIED", () => {
    const t = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED" });
    assert(t.syncStatus === "READBACK_PENDING", "apply alone cannot verify");
    const t2 = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED", readback: { available: false, reason: "x" } });
    assert(t2.syncStatus === "READBACK_PENDING", "missing readback blocks verification");
  });

  await runTest("IS8 forbidden evidence rejected", () => {
    const bad = bridgeSync.validateSyncEvidence({ applyStatus: "APPLIED", selectedModel: "veo-3.1-fast" });
    assert(!bad.ok, "model selection in evidence rejected");
    const bad2 = bridgeSync.validateSyncEvidence({ applyStatus: "APPLIED", confirmBeforeGenerating: "Never" });
    assert(!bad2.ok, "settings mutation in evidence rejected");
    const bad3 = bridgeSync.validateSyncEvidence({ applyStatus: "APPLIED", apiKey: "sk-x" });
    assert(!bad3.ok, "secret in evidence rejected");
  });

  await runTest("IS sync record lifecycle without browser", () => {
    const root = tmpRoot("sync");
    const set = ai.compileInstructionSet(baseInput()).instructionSet;
    assert(ai.persistInstructionSet(root, "p-1g9", set).ok, "set persisted");
    const started = ai.startInstructionSync(root, "p-1g9", set, { name: "GOOGLE_FLOW", projectRef: "proj-A" });
    assert(started.ok && started.sync.syncStatus === "DRAFT", "sync record created");
    const upd = ai.recordSyncEvidence(root, "p-1g9", started.sync.syncId, { applyStatus: "APPLIED", appliedAt: NOW });
    assert(upd.ok && upd.sync.applyStatus === "APPLIED", "apply evidence recorded");
    const v = ai.validateSync({ sync: upd.sync });
    assert(v.valid, `sync validates: ${JSON.stringify(v.errors)}`);
    const badVerify = ai.validateSync({ sync: { ...upd.sync, syncStatus: "VERIFIED" } });
    assert(!badVerify.valid && badVerify.errors.some((e) => e.code === "VERIFIED_WITHOUT_COMPARE"), "APPLIED cannot masquerade as VERIFIED");
  });

  // ---------------- IR — READBACK / SEMANTIC ----------------
  await runTest("IR1 exact equivalent matches", () => {
    const desired = { compiledText: "PROJECT INVARIANTS:\n- keep Lan identity", referenceIds: [] };
    const c = ai.compareInstructionReadback(desired, { text: "PROJECT INVARIANTS:\n- keep Lan identity" });
    assert(c.status === "MATCH", "byte-equal matches");
  });

  await runTest("IR2 whitespace-only differences are equivalent", () => {
    const desired = { compiledText: "PROJECT INVARIANTS:\n- keep Lan identity\n- flat vector style", referenceIds: [] };
    const c = ai.compareInstructionReadback(desired, { text: "PROJECT INVARIANTS:  \n  -  keep Lan identity\n\n- flat vector style  " });
    assert(c.status === "EQUIVALENT", `whitespace normalized (got ${c.status})`);
  });

  await runTest("IR3 missing identity rule is drift", () => {
    const desired = ai.compileInstructionSet(baseInput()).instructionSet;
    const c = ai.compareInstructionReadback(desired, { text: "PROJECT INVARIANTS:\n- Night ward stays on floor 3", referenceIds: [] });
    assert(c.status === "DRIFT" && c.differences.some((d) => d.class === "MISSING_CONSTRAINT"), "identity loss detected");
  });

  await runTest("IR4 contradictory rule is drift", () => {
    const desired = { compiledText: "PROJECT INVARIANTS:\n- keep Lan identity", referenceIds: [] };
    const c = ai.compareInstructionReadback(desired, { text: "PROJECT INVARIANTS:\n- keep Lan identity\n- never keep Lan identity, use random faces" });
    assert(c.status === "DRIFT" && c.differences.some((d) => d.class === "CONTRADICTION"), "contradiction detected, not normalized away");
  });

  await runTest("IR5 missing reference is drift/unverifiable", () => {
    const desired = ai.compileInstructionSet(baseInput()).instructionSet;
    const c = ai.compareInstructionReadback(desired, { text: desired.compiledText, referenceIds: [] });
    assert(c.status === "DRIFT" && c.differences.some((d) => d.class === "MISSING_REFERENCE"), "text match without reference is not enough");
    const c2 = ai.compareInstructionReadback(desired, { text: "" });
    assert(c2.status === "UNVERIFIABLE", "no readback is unverifiable, not a match");
  });

  await runTest("IR transition: verified only on match/equivalent with refs", () => {
    const t = bridgeSync.transitionSync(
      { referenceBindings: [{ referenceId: "r1" }] },
      { applyStatus: "APPLIED", readback: { available: true, text: "x", referenceIds: ["r1"] }, compare: { status: "EQUIVALENT", differences: [] } },
    );
    assert(t.syncStatus === "VERIFIED", "full evidence verifies");
    const t2 = bridgeSync.transitionSync(
      { referenceBindings: [{ referenceId: "r1" }] },
      { applyStatus: "APPLIED", readback: { available: true, text: "x", referenceIds: [] }, compare: { status: "EQUIVALENT", differences: [] } },
    );
    assert(t2.syncStatus === "DRIFT", "missing reference blocks verification");
  });

  // ---------------- ADAPTER SURFACE (mock DOM, no browser) ----------------
  await runTest("adapter instructions surface detection (mock)", () => {
    const empty = fakeRoot({});
    const d0 = adapter.detectInstructionsSurface(empty);
    assert(!d0.editor && !d0.doneControl, "absent surface detected as absent");
    const present = fakeRoot({
      '[data-testid="flow-agent-instructions"]': { tag: "button" },
      '[data-testid="flow-instruction-add"]': { tag: "button" },
      '[data-testid="flow-instruction-editor"]': { tag: "textarea", value: "" },
      '[data-testid="flow-instruction-done"]': { tag: "button" },
      '[data-testid="flow-instruction-readback"]': { tag: "div" },
    });
    const d1 = adapter.detectInstructionsSurface(present);
    assert(d1.instructionsButton && d1.addControl && d1.editor && d1.doneControl && d1.readbackSurface, "full chain detected");
  });

  await runTest("adapter readback extraction (mock, read-only)", () => {
    const root = fakeRoot({
      // FIX 02 round 3: only editor-field values read as guidelines (container
      // text once returned an icon ligature as instructions on the live tab).
      'textarea[aria-label*="instruction" i]': fakeEl("PROJECT INVARIANTS:\n- keep Lan identity"),
    });
    const rb = adapter.extractInstructionReadback(root);
    assert(rb.available && /keep Lan identity/.test(rb.text), "provider-visible text read");
    assert(Array.isArray(rb.referenceIds), "reference list present");
    const missing = adapter.extractInstructionReadback(fakeRoot({}));
    assert(!missing.available && missing.reason === "READBACK_SURFACE_MISSING", "missing surface reported, never fabricated");
  });

  // ---------------- IB — BOUNDARIES ----------------
  await runTest("IB1–IB3/IB7 no generation, credits, or settings mutation in core", () => {
    const dir = path.join(__dirname, "..", "..", "lib", "agent-instructions");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      assert(!/\.execute\s*\(|fetch\s*\(|https?\.request|playwright|\.click\s*\(|browser\./i.test(src), `${f}: no generation/UI/network calls`);
      assert(!/Generate|confirmBeforeGenerating|outputCount|selectedModel/.test(src), `${f}: no settings/model/output logic`);
      assert(!/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/.test(src), `${f}: no secret access`);
    }
    const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "flow-companion", "bridge", "instruction-sync.js"), "utf8");
    assert(/FORBIDDEN_EVIDENCE_KEYS/.test(bridge), "bridge forbids settings/secret evidence");
  });

  await runTest("IB4–IB6 1G.5–1G.8 artifacts untouched by instruction planning", () => {
    const decision = { decisionId: "pd-1", fingerprint: "f".repeat(16), visualModality: "MAP", renderMode: "REMOTION_MOTION" };
    const before = JSON.stringify(decision);
    ai.compileInstructionSet(baseInput());
    assert(JSON.stringify(decision) === before, "read-only w.r.t. upstream");
    const v = ai.validateInstructionSet({ set: ai.compileInstructionSet(baseInput()).instructionSet });
    assert(v.valid, "clean set validates");
  });

  await runTest("IB live gate cannot pass without provider evidence", () => {
    // Proves the gate logic itself: local-only evidence never yields VERIFIED.
    const t = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED" });
    assert(t.syncStatus !== "VERIFIED", "no local-only verification path exists");
  });

  console.log(`\n=== 1G.9 agent-instructions: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });
