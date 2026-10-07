"use strict";

/**
 * Phase 1G.9 FIX 02 — live instruction plumbing tests (§21).
 * Deterministic. No browser, no generation, 0 credits, 0 Flow mutations.
 * PJ (project identity) · DG (diagnostics) · AP (apply command) ·
 * RB (readback) · SV (semantic verification). Fixture evidence only —
 * the LIVE gate itself is proven on the operator's Flow project, never here.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const ai = require("../../lib/agent-instructions/index.js");
const bridgeSync = require("../../flow-companion/bridge/instruction-sync.js");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
const cmds = require("../../flow-companion/extension/src/content/content-commands.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-fix02-${tag}-`));
}

// Fake DOM element: attributes, click counting, editor value.
function fel(o = {}) {
  const el = {
    tagName: o.tagName || "DIV",
    value: o.value !== undefined ? o.value : "",
    textContent: o.textContent || "",
    innerText: o.innerText !== undefined ? o.innerText : (o.textContent || ""),
    attrs: Object.assign({}, o.attrs),
    clicked: 0,
    getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
    click() { this.clicked++; if (typeof o.onClick === "function") o.onClick(this); },
    querySelectorAll: () => [],
  };
  return el;
}

// Fake root mapping exact selector strings → elements. href fakes location.
// querySelectorAll("button") exposes BUTTON-tagged fakes so the constrained
// text-fallback path is exercisable; everything else stays empty.
function fakeRoot(map, href) {
  const all = [];
  for (const v of Object.values(map)) {
    if (Array.isArray(v)) all.push(...v);
    else if (v) all.push(v);
  }
  const root = {
    querySelector: (sel) => {
      const v = map[sel];
      if (Array.isArray(v)) return v[0] || null;
      return v || null;
    },
    // Exact-key hits first (simulates selector match); "button" exposes
    // BUTTON-tagged fakes so the constrained text-fallback path is exercisable.
    querySelectorAll: (sel) => {
      const v = map[sel];
      if (v !== undefined) return Array.isArray(v) ? v : [v];
      if (sel === "button") return all.filter((e) => e && e.tagName === "BUTTON");
      return [];
    },
  };
  if (href) root.location = { href };
  return root;
}

function instructionSelectors() {
  return {
    '[aria-label*="agent instructions" i]': fel({}),
    '[data-testid="flow-instruction-add"]': fel({}),
    'textarea[aria-label="Instruction description"]': fel({ tagName: "TEXTAREA", value: "" }),
    '[data-testid="flow-instruction-done"]': fel({}),
    '[data-testid="flow-instruction-readback"]': fel({ textContent: "  keep the sky-blue system  " }),
  };
}

// Re-affirm adopted table statuses mid-test (simulates post-§9 live adoption).
// Shipped state after FIX 02 adoption round 1: trigger/add/editor/done are
// VERIFIED (observed live 2026-10-03); readback/reference-attach stay
// NOT_VERIFIED. Restored after each use.
const INSTRUCTION_KEYS = ["AGENT_INSTRUCTIONS_BUTTON", "INSTRUCTION_ADD", "INSTRUCTION_EDITOR", "INSTRUCTION_DONE", "INSTRUCTION_READBACK"];
function adoptSelectors() {
  const prev = {};
  for (const k of INSTRUCTION_KEYS) { prev[k] = adapter.SELECTORS[k].status; adapter.SELECTORS[k].status = "VERIFIED"; }
  return () => { for (const k of INSTRUCTION_KEYS) adapter.SELECTORS[k].status = prev[k]; };
}

function applyMsg(over = {}) {
  return {
    type: "APPLY_AGENT_INSTRUCTIONS",
    providerProjectRef: "proj-live-1",
    instructionSetId: "is-test",
    instructionVersion: "iv-test",
    compiledText: "PROJECT INVARIANTS:\n- keep the sky-blue system",
    desiredFingerprint: "fp-test",
    referenceBindings: [],
    ...over,
  };
}

// FIX 03 contract helpers. Live rounds 3–5 proved isolated DOM writes never
// survive Done, so the apply chain now requires a writer reporting a
// framework app-state acknowledgement before Done; Done unmounts the editor
// and the reopen mounts the persisted text (persistence boundary).
function ackedWriter(map) {
  return async (spec) => {
    const ed = map[spec.selector];
    if (ed && typeof ed.value === "string") ed.value = spec.text;
    return { ok: true, writePath: "MAIN_WORLD_INPUT_SEQUENCE", appStateAck: true, ackBasis: "REACT_PROPS", valueMatches: true, valueLength: spec.text.length, propsValueLength: spec.text.length, fingerprint: {}, version: "fixture-stub" };
  };
}
function wirePanelLifecycle(map, reopenText) {
  const ED = 'textarea[aria-label="Instruction description"]';
  const done = map['[data-testid="flow-instruction-done"]'];
  const origDone = done.click.bind(done);
  done.click = () => { origDone(); delete map[ED]; };
  const trig = map['[aria-label*="agent instructions" i]'];
  const origTrig = trig.click.bind(trig);
  let opens = 0;
  trig.click = () => { origTrig(); opens += 1; if (opens >= 2 && reopenText != null) map[ED] = fel({ tagName: "TEXTAREA", value: reopenText }); };
}

async function main() {
  // ---------------- PJ — PROJECT IDENTITY ----------------
  await runTest("PJ1 stable provider project ref extracted", () => {
    const id = adapter.extractFlowProjectIdentity(fakeRoot({}), "https://flow.google.com/project/abc123");
    assert(id.available === true && id.providerProjectRef === "abc123", "router ref extracted");
    assert(id.confidence === "HIGH" && id.source === "url-router", "high-confidence source");
    const gate = adapter.verifyProjectIdentity("abc123", id.providerProjectRef);
    assert(gate.verified === true && gate.code === "PROJECT_IDENTITY_VERIFIED", "matching refs verify");
  });
  await runTest("PJ2 missing identity blocks", () => {
    const id = adapter.extractFlowProjectIdentity(fakeRoot({}), "https://flow.google.com/about");
    assert(id.available === false && id.providerProjectRef === "UNKNOWN", "no router id → UNKNOWN, never invented");
    const gate = adapter.verifyProjectIdentity("proj-live-1", id.providerProjectRef);
    assert(gate.verified === false && gate.code === "BLOCKED_PROJECT_IDENTITY_UNKNOWN", "unknown ref blocks");
  });
  await runTest("PJ3 mismatched identity blocks", () => {
    const gate = adapter.verifyProjectIdentity("proj-A", "proj-B");
    assert(gate.verified === false && gate.code === "BLOCKED_PROJECT_MISMATCH", "cross-project mutation refused");
  });
  await runTest("PJ4 binding persists without secrets", () => {
    const root = tmpRoot("binding");
    const bad = ai.saveProjectBinding(root, { projectId: "p", provider: "GOOGLE_FLOW", providerProjectRef: "abc", apiKey: "x" });
    assert(bad.ok === false && bad.code === "BINDING_SECRET_REJECTED", "secret-like keys refused");
    const unk = ai.saveProjectBinding(root, { projectId: "p", provider: "GOOGLE_FLOW", providerProjectRef: "UNKNOWN" });
    assert(unk.ok === false, "UNKNOWN ref never bound");
    const ok = ai.saveProjectBinding(root, { projectId: "p", provider: "GOOGLE_FLOW", providerProjectRef: "abc", verifiedAt: "t", evidenceRef: "e" });
    assert(ok.ok === true, "valid binding persists");
    const loaded = ai.loadProjectBinding(root, "p");
    assert(loaded.ok === true && loaded.binding.providerProjectRef === "abc", "binding round-trips");
    fs.rmSync(path.join(root, "projects"), { recursive: true, force: true });
  });

  // ---------------- DG — DIAGNOSTICS ----------------
  await runTest("DG1 instruction controls all observable", () => {
    const d = adapter.buildInstructionDiagnostics(fakeRoot(instructionSelectors()));
    for (const k of ["agentInstructionsTrigger", "addInstructionControl", "instructionEditor", "doneSaveControl", "readbackSurface", "referenceAttachmentControl"]) {
      assert(d[k] && typeof d[k].status === "string" && d[k].selectorEvidence, `${k} reported with evidence`);
    }
    // Adopted table (FIX 02 round 1): observed primaries read VERIFIED.
    assert(d.instructionEditor.status === "VERIFIED", "adopted editor primary reads VERIFIED");
    assert(d.agentInstructionsTrigger.status === "VERIFIED", "adopted trigger primary reads VERIFIED");
    // Unadopted keys stay honest: present-but-unadopted is UNKNOWN, absent is MISSING.
    assert(d.readbackSurface.status === "UNKNOWN", "unadopted presence is UNKNOWN, not VERIFIED");
    assert(d.referenceAttachmentControl.status === "MISSING", "absent attach reads MISSING");
  });
  await runTest("DG2 missing editor detected", () => {
    const map = instructionSelectors();
    delete map['textarea[aria-label="Instruction description"]'];
    const d = adapter.buildInstructionDiagnostics(fakeRoot(map));
    assert(d.instructionEditor.status === "MISSING", "absent editor reads MISSING");
  });
  await runTest("DG3 missing Done/save detected", () => {
    const map = instructionSelectors();
    delete map['[data-testid="flow-instruction-done"]'];
    const d = adapter.buildInstructionDiagnostics(fakeRoot(map));
    assert(d.doneSaveControl.status === "MISSING", "absent Done reads MISSING");
  });
  await runTest("DG4 diagnostics remain read-only", () => {
    const map = instructionSelectors();
    map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { "aria-checked": "false" } });
    const before = Object.values(map).map((e) => e.clicked);
    adapter.buildInstructionDiagnostics(fakeRoot(map));
    adapter.buildLiveDiagnostics(fakeRoot(map));
    assert(Object.values(map).every((e, i) => e.clicked === before[i]), "diagnostics click nothing");
  });

  // ---------------- AP — APPLY COMMAND ----------------
  // FIX 03 helpers (module scope below main's fixtures): ackedWriter +
  // wirePanelLifecycle simulate the framework ack + panel persistence cycle.

  await runTest("AP1 correct project + adopted selectors → apply executes", async () => {
    const restore = adoptSelectors();
    try {
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      wirePanelLifecycle(map, applyMsg().compiledText);
      const edRef = map['textarea[aria-label="Instruction description"]'];
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: ackedWriter(map), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "APPLIED" && res.syncStatus === "APPLIED", "apply returns APPLIED, never VERIFIED");
      assert(res.appStateAck === true && res.writeTransport === "MAIN_WORLD_INPUT_SEQUENCE", "framework-acked main-world write recorded");
      assert(res.mutated === true && res.clickedGenerate === false && res.creditsConsumed === false, "zero-credit, zero-generate");
      assert(edRef.value.includes("sky-blue"), "guidelines actually set");
      assert(map['[data-testid="flow-instruction-done"]'].clicked === 2, "Done clicked twice (save + close after readback)");
      assert(map['[data-testid="flow-instruction-add"]'].clicked === 0, "no duplicate row: Add skipped, empty slot reused");
      assert(res.readback && res.readback.available === true && res.readback.text === applyMsg().compiledText, "post-reopen readback is provider-derived");
    } finally { restore(); }
  });
  await runTest("AP2 wrong project → no mutation", async () => {
    const restore = adoptSelectors();
    try {
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      const root = fakeRoot(map, "https://flow.google.com/project/other-proj");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
      assert(res.ok === false && res.code === "BLOCKED_PROJECT_MISMATCH", "mismatch refused");
      assert(res.mutated === false && map['[data-testid="flow-instruction-done"]'].clicked === 0, "nothing touched");
    } finally { restore(); }
  });
  await runTest("AP3 unknown Agent state → no mutation", async () => {
    const restore = adoptSelectors();
    try {
      const root = fakeRoot(instructionSelectors(), "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
      assert(res.ok === false && res.code === "BLOCKED_AGENT_STATE_UNKNOWN" && res.mutated === false, "unknown agent blocks");
    } finally { restore(); }
  });
  await runTest("AP4 Agent OFF → enable + re-read", async () => {
    const restore = adoptSelectors();
    try {
      const agentEl = fel({ attrs: { role: "switch", "aria-checked": "false" } });
      agentEl.click = () => { agentEl.clicked++; agentEl.attrs["aria-checked"] = "true"; };
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = agentEl;
      wirePanelLifecycle(map, applyMsg().compiledText);
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: ackedWriter(map), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.agentSwitchedOn === true, "agent enabled then re-read before mutation");
    } finally { restore(); }
  });
  await runTest("AP5 forbidden settings payload rejected", async () => {
    const root = fakeRoot(instructionSelectors(), "https://flow.google.com/project/proj-live-1");
    for (const poison of [{ defaultModel: "x" }, { outputCount: 4 }, { confirmBeforeGenerating: "Never" }, { generate: true }]) {
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(poison), {});
      assert(res.ok === false && res.code === "FORBIDDEN_INSTRUCTION_PAYLOAD" && res.mutated === false, `rejected: ${Object.keys(poison)[0]}`);
    }
  });
  await runTest("AP6 no generation command reachable", () => {
    assert(![...cmds.COMMAND_TYPES].some((t) => /GENERATE/.test(t) && /INSTRUCTION/.test(t)), "no instruction-scoped generation command exists");
  });
  await runTest("AP7 zero-reference set valid; bindings refused honestly", async () => {
    const restore = adoptSelectors();
    try {
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg({ referenceBindings: [{ referenceId: "r1", role: "STYLE", reason: "x" }] }), {});
      assert(res.ok === false && res.code === "REFERENCE_ATTACH_NOT_SUPPORTED" && res.mutated === false, "non-empty bindings never faked");
    } finally { restore(); }
  });
  await runTest("AP8 missing editor fails after add (nothing saved)", async () => {
    const map = instructionSelectors();
    delete map['textarea[aria-label="Instruction description"]'];
    map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
    const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
    assert(res.ok === false && res.code === "INSTRUCTION_EDITOR_MISSING" && res.mutated === false, "absent editor never mutates");
  });
  await runTest("AP11 panel-closed root fails at open (bounded, no blind click)", async () => {
    const agentEl = fel({ attrs: { role: "switch", "aria-checked": "true" } });
    const trigger = fel({ attrs: { "aria-label": "Agent Instructions" } });
    const root = {
      location: { href: "https://flow.google.com/project/proj-live-1" },
      querySelector: (sel) => {
        if (sel === '[aria-label*="agent instructions" i]') return trigger;
        if (sel === '[data-testid="flow-agent-mode"]') return agentEl;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '[aria-label*="agent instructions" i]') return [trigger];
        if (sel === '[data-testid="flow-agent-mode"]') return [agentEl];
        return [];
      },
    };
    const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
    assert(res.ok === false && res.code === "INSTRUCTIONS_OPEN_FAILED" && res.mutated === false, "unmounted panel fails precisely");
    assert(trigger.clicked === 1, "trigger clicked once before the bounded wait");
  });
  await runTest("AP12 missing add is irrelevant when a slot exists (done still gated)", async () => {
    const trigger = fel({ attrs: { "aria-label": "Agent Instructions" } });
    const editor = fel({ tagName: "TEXTAREA", value: "" });
    const agentEl = fel({ attrs: { role: "switch", "aria-checked": "true" } });
    const root = {
      location: { href: "https://flow.google.com/project/proj-live-1" },
      querySelector: (sel) => {
        if (sel === '[aria-label*="agent instructions" i]') return trigger;
        if (sel === 'textarea[aria-label="Instruction description"]') return editor;
        if (sel === '[data-testid="flow-agent-mode"]') return agentEl;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === '[aria-label*="agent instructions" i]') return [trigger];
        if (sel === 'textarea[aria-label="Instruction description"]') return [editor];
        if (sel === '[data-testid="flow-agent-mode"]') return [agentEl];
        return [];
      },
    };
    const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
    assert(res.ok === false && res.code === "INSTRUCTION_SELECTORS_NOT_VERIFIED" && /doneSaveControl/.test(res.detail) && res.mutated === false, "missing done reported by key, add never needed");
  });
  await runTest("AP9 duplicate same-labeled control blocks (no first-of-many click)", async () => {
    const restore = adoptSelectors();
    try {
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      delete map['[data-testid="flow-instruction-done"]'];
      // Two visible "Done" buttons, no css hook: text channel counts 2 → ambiguous.
      const root2 = fakeRoot({ ...map, button: [fel({ tagName: "BUTTON", textContent: "Done" }), fel({ tagName: "BUTTON", textContent: "Done" })] }, "https://flow.google.com/project/proj-live-1");
      const c = adapter.countInstructionMatches(root2, "INSTRUCTION_DONE");
      assert(c.channel === "text" && c.count === 2, "text duplicates counted");
      const res = await cmds.dispatchContentCommand(adapter, root2, applyMsg(), {});
      assert(res.ok === false && res.code === "INSTRUCTION_CONTROL_AMBIGUOUS" && res.mutated === false, "ambiguity never mutates");
    } finally { restore(); }
  });
  await runTest("AP10 css duplicates block too", () => {
    const two = [fel({}), fel({})];
    const root = fakeRoot({ '[aria-label*="agent instructions" i]': two }, "https://flow.google.com/project/x");
    const c = adapter.countInstructionMatches(root, "AGENT_INSTRUCTIONS_BUTTON");
    assert(c.channel === "primary" && c.count === 2, "css duplicates counted");
  });

  // ---------------- RB — READBACK ----------------
  await runTest("RB1 provider readback returns actual UI state", async () => {
    const map = instructionSelectors();
    map['textarea[aria-label="Instruction description"]'] = fel({ tagName: "TEXTAREA", value: "  keep the sky-blue system  " });
    const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS" }, {});
    assert(res.ok === true && res.visibleGuidelines === "keep the sky-blue system", "reads editor value, trimmed");
    assert(res.providerProjectRef === "proj-live-1", "project ref from page, not payload");
  });
  await runTest("RB2 attempted payload never used as fallback", async () => {
    const root = fakeRoot({}, "https://flow.google.com/project/proj-live-1");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS", visibleGuidelines: "forged text" }, {});
    assert(res.ok === false, "unavailable surface fails instead of echoing any payload");
  });
  await runTest("RB3 missing surface → UNVERIFIABLE", async () => {
    const root = fakeRoot({}, "https://flow.google.com/project/proj-live-1");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS" }, {});
    assert(res.ok === false && res.code === "READBACK_SURFACE_MISSING", "precise missing-surface code");
  });
  await runTest("RB4 post-save reopen readback persists", async () => {
    const map = instructionSelectors();
    map['textarea[aria-label="Instruction description"]'] = fel({ tagName: "TEXTAREA", value: "keep the sky-blue system" });
    const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const first = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS" }, {});
    const second = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS" }, {});
    assert(first.ok === true && second.ok === true && first.visibleGuidelines === second.visibleGuidelines, "re-read is stable");
  });
  await runTest("RB5 icon/container text never reads as guidelines", async () => {
    // Live defect round 2: an icon ligature ("article_spark") was returned as
    // guidelines. Only editor values count now.
    const map = instructionSelectors();
    map['[data-testid="flow-instruction-readback"]'] = fel({ textContent: "article_spark" });
    const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS" }, {});
    assert(res.ok === false && res.code === "READBACK_EMPTY", "container text is not guidelines");
  });
  await runTest("RB6 first non-empty editor wins across cards", async () => {
    const map = instructionSelectors();
    delete map['[data-testid="flow-instruction-readback"]'];
    map['textarea[aria-label="Instruction description"]'] = [
      fel({ tagName: "TEXTAREA", value: "" }),
      fel({ tagName: "TEXTAREA", value: "second card text" }),
    ];
    const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const res = await cmds.dispatchContentCommand(adapter, root, { type: "READ_AGENT_INSTRUCTIONS" }, {});
    assert(res.ok === true && res.visibleGuidelines === "second card text", "skips empties, reads actual value");
  });
  await runTest("RB7 occupied slot refuses clobber; identical text is idempotent", async () => {
    const map = instructionSelectors();
    map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
    map['textarea[aria-label="Instruction description"]'] = fel({ tagName: "TEXTAREA", value: "someone else's text" });
    const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const clobber = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
    assert(clobber.ok === false && clobber.code === "INSTRUCTION_SLOT_OCCUPIED" && clobber.mutated === false, "different text never overwritten");
    map['textarea[aria-label="Instruction description"]'] = fel({ tagName: "TEXTAREA", value: applyMsg().compiledText });
    wirePanelLifecycle(map, applyMsg().compiledText);
    const root2 = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
    const same = await cmds.dispatchContentCommand(adapter, root2, applyMsg(), { saveConfirmTimeoutMs: 400 });
    // FIX 03 §17 + §13: identical text is a NO_OP — same provider entry
    // reused, no duplicate row — and the save+reopen boundary still runs so
    // the readback is genuinely persisted state, not the mounted editor.
    assert(same.ok === true && same.status === "NO_OP_ALREADY_SYNCED", "identical text re-applies without duplicating");
    assert(map['[data-testid="flow-instruction-add"]'].clicked === 0, "no duplicate row added");
    assert(same.readback && same.readback.available === true && same.readback.text === applyMsg().compiledText, "post-save readback is provider-derived");
  });

  // ---------------- SV — SEMANTIC VERIFICATION ----------------
  await runTest("SV1 MATCH → VERIFIED", () => {
    const t = bridgeSync.transitionSync({ referenceBindings: [] }, {
      applyStatus: "APPLIED",
      readback: { available: true, referenceIds: [] },
      compare: { status: "MATCH" },
    });
    assert(t.syncStatus === "VERIFIED", "match verifies");
  });
  await runTest("SV2 EQUIVALENT → VERIFIED", () => {
    const t = bridgeSync.transitionSync({ referenceBindings: [] }, {
      applyStatus: "APPLIED",
      readback: { available: true, referenceIds: [] },
      compare: { status: "EQUIVALENT" },
    });
    assert(t.syncStatus === "VERIFIED", "equivalent verifies");
  });
  await runTest("SV3 DRIFT → not VERIFIED", () => {
    const t = bridgeSync.transitionSync({ referenceBindings: [] }, {
      applyStatus: "APPLIED",
      readback: { available: true, referenceIds: [] },
      compare: { status: "DRIFT", differences: [{ class: "MISSING_RULE", detail: "identity" }] },
    });
    assert(t.syncStatus === "DRIFT", "drift never verifies");
  });
  await runTest("SV4 no readback → not VERIFIED", () => {
    const t = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED" });
    assert(t.syncStatus !== "VERIFIED", "apply alone never verifies");
  });

  // ---------------- TX — TEXT-FALLBACK DETECTION (live pill/buttons) ----------------
  await runTest("TX1 Agent pill found by visible text, state honest", () => {
    const pill = fel({ tagName: "BUTTON", textContent: "Agent" });
    const m1 = adapter.detectFlowAgentMode(fakeRoot({ button: [pill] }));
    assert(m1.detected === true && m1.mode === "AGENT_UI_PRESENT", "pill detected, state unconfirmed (never guessed)");
    const on = fel({ tagName: "BUTTON", textContent: "Agent", attrs: { "aria-pressed": "true" } });
    const m2 = adapter.detectFlowAgentMode(fakeRoot({ button: [on] }));
    assert(m2.mode === "AGENT" && m2.enabled === true, "aria-pressed=true reads AGENT");
  });
  await runTest("TX2 instruction buttons found by visible text", () => {
    const root = fakeRoot({
      button: [
        fel({ tagName: "BUTTON", textContent: "Agent Instructions" }),
        fel({ tagName: "BUTTON", textContent: "Add instruction" }),
        fel({ tagName: "BUTTON", textContent: "Done" }),
      ],
    });
    const d = adapter.buildInstructionDiagnostics(root);
    // Adopted table + text channel → VERIFIED with the channel named.
    assert(d.agentInstructionsTrigger.status === "VERIFIED", "trigger text-channel adopted");
    assert((d.addInstructionControl.selectorEvidence.matchedSelector || "").startsWith("text:"), "evidence names the text channel");
    assert(d.addInstructionControl.status === "VERIFIED" && d.doneSaveControl.status === "VERIFIED", "add/done text-channel adopted");
  });
  await runTest("TX3 pill never auto-clicked by standard path", () => {
    const pill = fel({ tagName: "BUTTON", textContent: "Agent" });
    const root = fakeRoot({ button: [pill] });
    const r = adapter.ensureStandardMode(root);
    assert(r.standard === false && r.code === "AGENT_MODE_DETECTED" && pill.clicked === 0, "refuses without touching the pill");
  });
  await runTest("TX4 full apply through live-observed channels (aria + text, no testids)", async () => {
    const restore = adoptSelectors();
    try {
      const trigger = fel({ attrs: { "aria-label": "Agent Instructions" } });
      const editor = fel({ tagName: "TEXTAREA", value: "" });
      const addBtn = fel({ tagName: "BUTTON", textContent: "Add instruction" });
      const doneBtn = fel({ tagName: "BUTTON", textContent: "Done" });
      const agentEl = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      // FIX 03 panel lifecycle: Done unmounts the editor; the second trigger
      // click reopens it with the persisted provider text.
      let editorMounted = true;
      let opens = 0;
      const origDone = doneBtn.click.bind(doneBtn);
      doneBtn.click = () => { origDone(); editorMounted = false; };
      const origTrig = trigger.click.bind(trigger);
      trigger.click = () => { origTrig(); opens += 1; if (opens >= 2) { editorMounted = true; editor.value = applyMsg().compiledText; } };
      // querySelector must resolve the aria primaries; text channel via buttons.
      const root = {
        location: { href: "https://flow.google.com/project/proj-live-1" },
        querySelector: (sel) => {
          if (sel === '[aria-label*="agent instructions" i]') return trigger;
          if (sel === 'textarea[aria-label="Instruction description"]') return editorMounted ? editor : null;
          if (sel === '[data-testid="flow-agent-mode"]') return agentEl;
          return null;
        },
        querySelectorAll: (sel) => {
          if (sel === '[aria-label*="agent instructions" i]') return [trigger];
          if (sel === 'textarea[aria-label="Instruction description"]') return editorMounted ? [editor] : [];
          if (sel === '[data-testid="flow-agent-mode"]') return [agentEl];
          if (sel === "button") return [addBtn, doneBtn];
          return [];
        },
      };
      const writer = async (spec) => {
        const list = root.querySelectorAll(spec.selector);
        const ed = list[spec.index];
        if (ed) ed.value = spec.text;
        return { ok: true, writePath: "MAIN_WORLD_INPUT_SEQUENCE", appStateAck: true, ackBasis: "REACT_PROPS", valueMatches: true, valueLength: spec.text.length, propsValueLength: spec.text.length, fingerprint: {}, version: "fixture-stub" };
      };
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: writer, saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "APPLIED", "live-channel apply executes end to end");
      assert(editor.value.includes("sky-blue") && doneBtn.clicked >= 1, "guidelines set + Done clicked (save + close)");
      assert(addBtn.clicked === 0, "existing empty slot reused, no duplicate row");
      assert(res.readback && res.readback.available === true && res.readback.text === applyMsg().compiledText, "reopened readback returns persisted provider text");
    } finally { restore(); }
  });
  await runTest("AP13 multiple empty editors block (never pick blind)", async () => {
    const restore = adoptSelectors();
    try {
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      map['textarea[aria-label="Instruction description"]'] = [fel({ tagName: "TEXTAREA", value: "" }), fel({ tagName: "TEXTAREA", value: "" })];
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
      assert(res.ok === false && res.code === "INSTRUCTION_CONTROL_AMBIGUOUS" && res.mutated === false, "multi-empty never mutates");
    } finally { restore(); }
  });
  await runTest("AP14 all slots occupied differently blocks (never clobber)", async () => {
    const restore = adoptSelectors();
    try {
      const map = instructionSelectors();
      map['[data-testid="flow-agent-mode"]'] = fel({ attrs: { role: "switch", "aria-checked": "true" } });
      map['textarea[aria-label="Instruction description"]'] = [fel({ tagName: "TEXTAREA", value: "other text A" }), fel({ tagName: "TEXTAREA", value: "other text B" })];
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), {});
      assert(res.ok === false && res.code === "INSTRUCTION_SLOT_OCCUPIED" && res.mutated === false, "occupied slots never overwritten");
    } finally { restore(); }
  });

  await runTest("TX5 trusted insertText path writes when browser offers it", () => {
    const ed = fel({ tagName: "TEXTAREA", value: "" });
    const doc = {
      activeElement: null,
      execCalls: 0,
      execCommand(cmd, ui, text) {
        this.execCalls++;
        if (cmd === "insertText" && this.activeElement === ed) {
          ed.value = String(text);
          return true;
        }
        return false;
      },
    };
    ed.focus = () => { doc.activeElement = ed; };
    const hadDocument = typeof globalThis.document !== "undefined";
    globalThis.document = doc;
    try {
      const root = fakeRoot({ 'textarea[aria-label="Instruction description"]': ed });
      const r = adapter.setInstructionGuidelines(root, "hello-directions");
      assert(r.ok === true && r.verified === true, "trusted path verifies");
      assert(doc.execCalls >= 1 && ed.value === "hello-directions", "browser insertText carried the text");
    } finally {
      if (!hadDocument) delete globalThis.document;
    }
  });

  console.log(`\n=== FIX 02 live-instruction-plumbing: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });
