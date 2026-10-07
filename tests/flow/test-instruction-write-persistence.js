"use strict";

/**
 * PHASE 1G.9 FIX 03 — write-persistence suite (task §25).
 * WP1–WP12 contract tests + MW (main-world write function) + SV (bridge sync
 * transitions). Deterministic, no browser, 0 credits, 0 Flow mutations.
 * The LIVE gate itself is proven on the operator's Flow project — never here.
 *
 * Root cause encoded by FIX 03 (FIX 02 live evidence): isolated-world DOM
 * writes never reach the page framework's state, so Done/save silently
 * persists stale text. FIX 03 gates Done behind a framework-verifiable
 * app-state acknowledgement and proves persistence by close/reopen readback.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const ai = require("../../lib/agent-instructions/index.js");
const bridgeSync = require("../../flow-companion/bridge/instruction-sync.js");
const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
const mw = require("../../flow-companion/extension/src/content/main-world-write.js");
const sw = require("../../flow-companion/extension/src/background/service-worker.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-fix03-${tag}-`));
}

// ---- fake DOM (same shape as the FIX 02 plumbing suite) ----

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

const EDITOR_SEL = 'textarea[aria-label="Instruction description"]';
const COMPILED = "PROJECT INVARIANTS:\n- keep the sky-blue system";

function baseMap() {
  return {
    '[aria-label*="agent instructions" i]': fel({ attrs: { "aria-label": "Agent Instructions" } }),
    '[data-testid="flow-instruction-add"]': fel({}),
    [EDITOR_SEL]: fel({ tagName: "TEXTAREA", value: "" }),
    '[data-testid="flow-instruction-done"]': fel({}),
    '[data-testid="flow-instruction-readback"]': fel({ textContent: "" }),
    '[data-testid="flow-agent-mode"]': fel({ attrs: { role: "switch", "aria-checked": "true" } }),
  };
}

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
    compiledText: COMPILED,
    desiredFingerprint: "fp-test",
    referenceBindings: [],
    ...over,
  };
}

// React-like editor: framework props live on the node and the framework's own
// handler commits input events into props.value (simulated state commit).
function reactEditor(initial) {
  const ed = fel({ tagName: "TEXTAREA", value: initial });
  ed.focus = () => {};
  ed.select = () => {};
  const props = { value: initial };
  ed["__reactProps$test"] = props;
  ed.dispatchEvent = function (ev) {
    if (ev && ev.type === "input") props.value = ed.value;
  };
  ed.__propsRef = props;
  return ed;
}

// Wire an explicit save+reopen lifecycle onto a manually built map: Done
// unmounts the editor; the second trigger click remounts the persisted text.
function wireLifecycle(map, reopenText) {
  const done = map['[data-testid="flow-instruction-done"]'];
  const origDone = done.click.bind(done);
  done.click = () => { origDone(); delete map[EDITOR_SEL]; };
  const trig = map['[aria-label*="agent instructions" i]'];
  const origTrig = trig.click.bind(trig);
  let opens = 0;
  trig.click = () => { origTrig(); opens += 1; if (opens >= 2 && reopenText != null) map[EDITOR_SEL] = reactEditor(reopenText); };
}

// Simulated panel lifecycle for the apply chain: the FIRST trigger click
// opens the panel with an empty editor; the Done click closes it (editor
// unmounts); the SECOND trigger click reopens with the PERSISTED provider
// text (what Flow itself would show after a real save).
function simulatedFlowPage(persistedText, extra = {}) {
  const map = baseMap();
  const ed = reactEditor("");
  map[EDITOR_SEL] = ed;
  let opens = 0;
  map['[data-testid="flow-instruction-done"]'] = fel({
    onClick: () => { if (extra.doneCloses !== false) delete map[EDITOR_SEL]; },
  });
  const remount = () => { if (opens >= 2 && persistedText !== null) map[EDITOR_SEL] = reactEditor(persistedText); };
  map['[aria-label*="agent instructions" i]'] = fel({
    attrs: { "aria-label": "Agent Instructions" },
    onClick: () => { opens += 1; if (extra.hydrateDelayMs) setTimeout(remount, extra.hydrateDelayMs); else remount(); },
  });
  Object.assign(map, extra.map || {});
  const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
  return { map, root, ed };
}

// Runs the REAL main-world write function under stubbed browser globals,
// pointed at the given editor. Globals are restored afterwards.
function realWriterFor(editor) {
  return async (spec) => {
    const g = global;
    const prev = { document: g.document, Event: g.Event, InputEvent: g.InputEvent, HTMLTextAreaElement: g.HTMLTextAreaElement, HTMLInputElement: g.HTMLInputElement };
    try {
      g.document = { querySelectorAll: (sel) => (sel === spec.selector ? [editor] : []), documentElement: { getAttribute: () => null } };
      g.Event = class E { constructor(type, opts) { this.type = type; if (opts) Object.assign(this, opts); } };
      g.InputEvent = class I extends g.Event {};
      return await mw.instructionMainWorldWrite(spec);
    } finally {
      for (const k of Object.keys(prev)) {
        if (prev[k] === undefined) delete g[k]; else g[k] = prev[k];
      }
    }
  };
}

// Writer stub that only sets the DOM value and reports NO framework ack —
// models the FIX 02 observed failure mode (DOM write ok, framework never saw it).
function domOnlyWriter(map) {
  return async (spec) => {
    const ed = map[spec.selector];
    if (ed) ed.value = spec.text;
    return { ok: true, writePath: "MAIN_WORLD_INPUT_SEQUENCE", appStateAck: false, ackBasis: "NO_FRAMEWORK_ACK", valueMatches: true, valueLength: spec.text.length, propsValueLength: null, fingerprint: {}, version: "stub" };
  };
}

async function main() {
  // ---------------- MW — MAIN-WORLD WRITE FUNCTION ----------------
  await runTest("MW1 main-world input sequence reaches framework state (REACT_PROPS ack)", async () => {
    const ed = reactEditor("");
    const write = realWriterFor(ed);
    const res = await write({ selector: EDITOR_SEL, index: 0, text: COMPILED });
    assert(res.ok === true && res.appStateAck === true, "write accepted by framework state");
    assert(res.writePath === "MAIN_WORLD_INPUT_SEQUENCE", `writePath=${res.writePath}`);
    assert(res.ackBasis === "REACT_PROPS", `ackBasis=${res.ackBasis}`);
    assert(res.valueMatches === true, "editor value matches after write");
  });

  await runTest("MW2 DOM-only match without framework ack is rejected (WP1 write layer)", async () => {
    const ed = fel({ tagName: "TEXTAREA", value: "" });
    ed.focus = () => {};
    ed.select = () => {};
    const write = realWriterFor(ed);
    const res = await write({ selector: EDITOR_SEL, index: 0, text: COMPILED });
    assert(res.ok === false && res.appStateAck === false, "no framework ack → not ok, despite DOM value");
    assert(res.valueMatches === true, "DOM value did land (honestly reported, never acked)");
  });

  await runTest("MW3 missing editor fails precisely", async () => {
    const write = realWriterFor(null);
    const res = await write({ selector: EDITOR_SEL, index: 0, text: COMPILED });
    assert(res.ok === false && res.code === "EDITOR_NOT_FOUND", `code=${res.code}`);
  });

  await runTest("MW4 write result never echoes instruction text (bounded evidence)", async () => {
    const ed = reactEditor("");
    const write = realWriterFor(ed);
    const res = await write({ selector: EDITOR_SEL, index: 0, text: COMPILED });
    assert(!JSON.stringify(res).includes("sky-blue"), "result carries lengths/fingerprints, not text");
  });

  // ---------------- WP — APPLY COMMAND PERSISTENCE GATES ----------------
  await runTest("WP1 DOM-only write cannot count as persisted — VERIFIED requires reopen readback", async () => {
    const restore = adoptSelectors();
    try {
      const { map, root, ed } = simulatedFlowPage(null); // provider DISCARDS: reopen mounts nothing
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400 });
      // Live-evidence revision: the chain proceeds to Done even without a
      // framework ack, but the verdict is decided ONLY by the persistence
      // boundary — a discarded write can never read VERIFIED.
      assert(res.ok === true && res.status === "APPLIED", "apply reported with save boundary executed");
      assert(res.readback && res.readback.available === false, "discarded write reads back unavailable");
      const next = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED", automationMode: "HANDS_FREE", operatorTextEntry: false });
      assert(next.syncStatus === "READBACK_PENDING", "DOM-only write stays READBACK_PENDING, never VERIFIED");
      assert(map['[data-testid="flow-instruction-add"]'].clicked === 0, "no duplicate row");
    } finally { restore(); }
  });

  await runTest("WP2 framework-compatible write updates real app state → acked", async () => {
    const restore = adoptSelectors();
    try {
      const { map, root, ed } = simulatedFlowPage(COMPILED);
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "APPLIED" && res.syncStatus === "APPLIED", "apply returns APPLIED, never VERIFIED");
      assert(res.appStateAck === true && res.ackBasis === "REACT_PROPS", "framework ack recorded");
      assert(res.writeTransport === "MAIN_WORLD_INPUT_SEQUENCE", `transport=${res.writeTransport}`);
      assert(map['[data-testid="flow-instruction-done"]'].clicked === 2, "Done clicked twice (save + close after readback)");
      assert(res.saveConfirmed === true, "editor unmounted after Done (save acknowledged)");
      assert(res.clickedGenerate === false && res.creditsConsumed === false, "zero-generate, zero-credit");
    } finally { restore(); }
  });

  await runTest("WP3 write that never lands in DOM withholds Done (GUIDELINES_VERIFY_FAILED)", async () => {
    const restore = adoptSelectors();
    try {
      const map = baseMap();
      // An editor that refuses every write (value setter is a no-op): all
      // transports fail their verify — nothing may be saved.
      const stubborn = fel({ tagName: "TEXTAREA", value: "" });
      Object.defineProperty(stubborn, "value", { get: () => "", set: () => {}, configurable: true });
      stubborn.focus = () => {};
      stubborn.select = () => {};
      map[EDITOR_SEL] = stubborn;
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionTrustedInput: async () => ({ ok: true, op: "keyText" }) });
      assert(res.ok === false && (res.code === "GUIDELINES_VERIFY_FAILED" || res.code === "INSTRUCTION_TEXT_EMPTY" || res.code === "INSTRUCTION_EDITOR_MISSING"), `code=${res.code}`);
      assert(map['[data-testid="flow-instruction-done"]'].clicked === 0 && res.mutated === false, "Done withheld, nothing saved");
    } finally { restore(); }
  });

  await runTest("WP4 reopen returns persisted provider text (persistence boundary)", async () => {
    const restore = adoptSelectors();
    try {
      const { root, ed } = simulatedFlowPage(COMPILED);
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "APPLIED", "apply+save confirmed");
      assert(res.saveConfirmed === true && res.persistenceBoundary === "CLOSE_REOPEN", "editor unmounted after Done (save acknowledged)");
      assert(res.readback && res.readback.available === true, "readback after reopen is available");
      assert(res.readback.text === COMPILED, "reopened provider text equals canonical (provider-derived)");
    } finally { restore(); }
  });

  await runTest("WP4b delayed provider hydration is read by the bounded poll (live round 5 evidence)", async () => {
    const restore = adoptSelectors();
    try {
      // Reopen mounts the editor but the provider value hydrates 400ms later —
      // a single immediate read reports READBACK_EMPTY (live round 5);
      // the bounded poll must wait it out honestly.
      const { root, ed } = simulatedFlowPage(COMPILED, { hydrateDelayMs: 400 });
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400, readbackTimeoutMs: 2000 });
      assert(res.ok === true && res.status === "APPLIED", "apply+save confirmed");
      assert(res.readback && res.readback.available === true && res.readback.text === COMPILED, "poll read the hydrated provider text");
    } finally { restore(); }
  });

  await runTest("WP5 attempted payload cannot fake readback (drift passes through honestly)", async () => {
    const restore = adoptSelectors();
    try {
      const DRIFTED = "PROJECT INVARIANTS:\n- keep the red system";
      const { root, ed } = simulatedFlowPage(DRIFTED);
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.readback.available === true, "readback taken from provider surface");
      assert(res.readback.text === DRIFTED && res.readback.text !== COMPILED, "readback is the PROVIDER text, not the attempted payload");
      const next = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED", automationMode: "HANDS_FREE", operatorTextEntry: false, readback: { available: true, referenceIds: [] }, compare: { status: "DRIFT", differences: [] } });
      assert(next.syncStatus === "DRIFT", "drifted provider state can never verify (bridge gate)");
    } finally { restore(); }
  });

  await runTest("WP6 failed save (editor still mounted) is not APPLIED", async () => {
    const restore = adoptSelectors();
    try {
      const { root, ed } = simulatedFlowPage(COMPILED, { doneCloses: false });
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 60 });
      assert(res.ok === false && res.code === "INSTRUCTION_SAVE_NOT_CONFIRMED", `code=${res.code}`);
    } finally { restore(); }
  });

  await runTest("WP7 failed readback keeps sync at READBACK_PENDING, never VERIFIED", async () => {
    const restore = adoptSelectors();
    try {
      const { root, ed } = simulatedFlowPage(null);
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "APPLIED", "apply+save still confirmed honestly");
      assert(res.readback && res.readback.available === false, `readback unavailable: ${(res.readback && res.readback.reason) || "?"}`);
      const next = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED", automationMode: "HANDS_FREE", operatorTextEntry: false });
      assert(next.syncStatus === "READBACK_PENDING", `transition=${next.syncStatus} (never VERIFIED without readback)`);
    } finally { restore(); }
  });

  await runTest("WP8 identical second apply → NO_OP_ALREADY_SYNCED, no duplicate", async () => {
    const restore = adoptSelectors();
    try {
      const map = baseMap();
      const ed = reactEditor(COMPILED);
      map[EDITOR_SEL] = ed;
      // §13 (live round 13): even a NO_OP must prove persistence through the
      // save + close/reopen boundary — never read the still-mounted editor.
      wireLifecycle(map, COMPILED);
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      let writerCalls = 0;
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: async (s) => { writerCalls++; return domOnlyWriter(map)(s); }, saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "NO_OP_ALREADY_SYNCED", `status=${res.status}`);
      assert(writerCalls === 0, "writer never invoked for identical text");
      assert(res.mutated === true && map['[data-testid="flow-instruction-done"]'].clicked === 2, "save boundary executed even for NO_OP (save + close)");
      assert(map['[data-testid="flow-instruction-add"]'].clicked === 0, "no duplicate row added");
      assert(res.readback && res.readback.available === true && res.readback.text === COMPILED, "idempotent apply still proves provider state");
    } finally { restore(); }
  });

  await runTest("WP8b provider-whitespace normalization still reuses the same slot (no clobber refusal)", async () => {
    const restore = adoptSelectors();
    try {
      const map = baseMap();
      // Flow normalized whitespace inside the persisted guideline (live
      // round 10 evidence path): same instruction, different bytes.
      map[EDITOR_SEL] = reactEditor("PROJECT INVARIANTS:\n - keep the  sky-blue system ");
      wireLifecycle(map, COMPILED);
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "NO_OP_ALREADY_SYNCED", `status=${res.status}`);
      assert(map['[data-testid="flow-instruction-add"]'].clicked === 0, "same instruction reused, nothing rewritten");
      assert(res.readback && res.readback.available === true, "post-save readback proves persisted state");
    } finally { restore(); }
  });

  await runTest("WP9 operator-assisted flag cannot satisfy hands-free gate", async () => {
    const check = bridgeSync.validateSyncEvidence({ applyStatus: "APPLIED", automationMode: "HANDS_FREE", operatorTextEntry: true });
    assert(check.ok === false && check.blockers.some((b) => b.startsWith("OPERATOR_TEXT_ENTRY_CONTRADICTS_HANDS_FREE")), "contradiction blocked at validation");
    const next = bridgeSync.transitionSync({ referenceBindings: [] }, { applyStatus: "APPLIED", automationMode: "HANDS_FREE", operatorTextEntry: true, readback: { available: true, referenceIds: [] }, compare: { status: "MATCH", differences: [] } });
    assert(next.syncStatus === "BLOCKED", `transition=${next.syncStatus} (MATCH + readback still cannot verify)`);
  });

  await runTest("WP10 wrong project cannot write", async () => {
    const restore = adoptSelectors();
    try {
      const map = baseMap();
      const root = fakeRoot(map, "https://flow.google.com/project/other-proj");
      let writerCalls = 0;
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: async (s) => { writerCalls++; return domOnlyWriter(map)(s); } });
      assert(res.ok === false && res.code === "BLOCKED_PROJECT_MISMATCH", `code=${res.code}`);
      assert(writerCalls === 0 && res.mutated === false, "no writer call, no mutation");
    } finally { restore(); }
  });

  await runTest("WP11 ambiguous selector cannot write", async () => {
    const restore = adoptSelectors();
    try {
      const map = baseMap();
      map[EDITOR_SEL] = [fel({ tagName: "TEXTAREA", value: "" }), fel({ tagName: "TEXTAREA", value: "" })];
      const root = fakeRoot(map, "https://flow.google.com/project/proj-live-1");
      let writerCalls = 0;
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: async (s) => { writerCalls++; return domOnlyWriter(map)(s); } });
      assert(res.ok === false && (res.code === "INSTRUCTION_CONTROL_AMBIGUOUS" || res.code === "INSTRUCTION_EDITOR_MISSING"), `code=${res.code}`);
      assert(writerCalls === 0 && res.mutated === false, "never picks blind, never writes");
    } finally { restore(); }
  });

  await runTest("WP12 no generation control touched", async () => {
    const restore = adoptSelectors();
    try {
      const { root, ed, map } = simulatedFlowPage(COMPILED, { map: {
        '[data-testid="flow-generate"]': fel({ attrs: { "aria-label": "Generate" } }),
        '[data-testid="flow-model-select"]': fel({ attrs: { "aria-label": "Model" } }),
      } });
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: realWriterFor(ed), saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.clickedGenerate === false && res.creditsConsumed === false, "apply chain generation-free");
      assert(map['[data-testid="flow-generate"]'].clicked === 0 && map['[data-testid="flow-model-select"]'].clicked === 0, "generate/model controls untouched");
    } finally { restore(); }
  });

  // Static security scan of the new main-world module (task §22 spirit —
  // no debugger/CDP/network/storage surface exists in this fallback-free build).
  await runTest("WP13 main-world module surface stays narrow (static scan)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../flow-companion/extension/src/content/main-world-write.js"), "utf8");
    for (const banned of ["chrome.debugger", "Input.dispatchKeyEvent", "Input.insertText", "fetch(", "XMLHttpRequest", "localStorage", "document.cookie", "Runtime.evaluate", "Network.", "Storage."]) {
      assert(!src.includes(banned), `absent: ${banned}`);
    }
  });

  // ---------------- SV — BRIDGE SYNC CONTRACT (FIX 03 metadata) ----------------
  await runTest("SV1 hands-free chain → VERIFIED (ack + reopen readback + MATCH)", () => {
    const next = bridgeSync.transitionSync({ referenceBindings: [] }, {
      applyStatus: "APPLIED",
      automationMode: "HANDS_FREE",
      operatorTextEntry: false,
      writeTransport: "MAIN_WORLD_INPUT_SEQUENCE",
      readback: { available: true, referenceIds: [] },
      compare: { status: "MATCH", differences: [] },
    });
    assert(next.syncStatus === "VERIFIED", `transition=${next.syncStatus}`);
  });

  await runTest("SV2 store persists hands-free lineage metadata (previousSyncRef, transport)", () => {
    const root = tmpRoot("store");
    try {
      const set = { version: "1.0.0", instructionSetId: "is-fix03test01", instructionVersion: "iv-fix03test01", compiledText: COMPILED, compiledFingerprint: "fp-fix03", referenceIds: [], referenceBindings: [], createdAt: new Date().toISOString() };
      const started = ai.startInstructionSync(root, "p-fix03", set, { name: "GOOGLE_FLOW", projectRef: "proj-live-1" }, { automationMode: "HANDS_FREE", previousSyncRef: "sy-4f2e4f010241" });
      assert(started.ok === true && started.sync.automationMode === "HANDS_FREE", "automationMode recorded at sync start");
      assert(started.sync.previousSyncRef === "sy-4f2e4f010241", "previousSyncRef lineage recorded");
      assert(ai.latestVerifiedSync(root, "p-fix03").sync === null, "no VERIFIED sync before evidence");
      const fin = ai.recordSyncEvidence(root, "p-fix03", started.sync.syncId, { syncStatus: "VERIFIED", writeTransport: "MAIN_WORLD_INPUT_SEQUENCE", operatorTextEntry: false });
      assert(fin.ok === true && fin.sync.writeTransport === "MAIN_WORLD_INPUT_SEQUENCE" && fin.sync.operatorTextEntry === false, "transport + operatorTextEntry persisted");
      const prior = ai.latestVerifiedSync(root, "p-fix03");
      assert(prior.sync && prior.sync.syncId === started.sync.syncId, "latestVerifiedSync finds the verified record");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("SV3 identical set+ref applied twice gets DISTINCT sync ids (FIX 03-R1 collision guard)", () => {
    const root = tmpRoot("collide");
    try {
      const set = { version: "1.0.0", instructionSetId: "is-fix03col1", instructionVersion: "iv-fix03col1", compiledText: COMPILED, compiledFingerprint: "fp-col", referenceIds: [], referenceBindings: [], createdAt: new Date().toISOString() };
      const a = ai.startInstructionSync(root, "p-col", set, { name: "GOOGLE_FLOW", projectRef: "proj-live-1" }, { automationMode: "HANDS_FREE" });
      const b = ai.startInstructionSync(root, "p-col", set, { name: "GOOGLE_FLOW", projectRef: "proj-live-1" }, { automationMode: "HANDS_FREE" });
      assert(a.ok === true && b.ok === true, "both syncs start");
      assert(a.sync.syncId !== b.sync.syncId, `distinct ids: ${a.sync.syncId} vs ${b.sync.syncId}`);
      const ra = ai.loadSync(root, "p-col", a.sync.syncId);
      assert(ra.ok && ra.sync && ra.sync.syncStatus === "DRAFT", "first record intact (never overwritten)");
      assert(ai.latestVerifiedSync(root, "p-col").sync === null, "neither is VERIFIED, lineage unaffected");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("WP2b CDP transport preferred over insufficient ack; isolated fallback still bounded by persistence", async () => {
    const restore = adoptSelectors();
    try {
      const { map, root, ed } = simulatedFlowPage(COMPILED);
      // Main-world execCommand "succeeds" with a DOM re-read ack — proven not
      // to survive reliably; the CDP transport is preferred when available.
      const mainWorldWrite = async (spec) => {
        ed.value = spec.text;
        return { ok: true, writePath: "MAIN_WORLD_EXEC_COMMAND", appStateAck: true, ackBasis: "BROWSER_INPUT_EVENTS", valueMatches: true, valueLength: spec.text.length, propsValueLength: null, fingerprint: {}, version: "stub" };
      };
      const trustedInputWrite = async (spec) => { ed.value = spec.text; return { ok: true, op: "keyText" }; };
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionMainWorldWrite: mainWorldWrite, instructionTrustedInput: trustedInputWrite, saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.writeTransport === "CDP_KEY_EVENTS" && res.ackBasis === "CDP_TRUSTED_INPUT", `transport=${res.writeTransport} basis=${res.ackBasis}`);
      assert(res.readback && res.readback.available === true, "full chain completes through the trusted transport");
      // Without a trusted transport the insufficient main-world write is
      // cleared (never concatenated) and the isolated transport re-writes it;
      // the persistence boundary (reopen readback) keeps the verdict honest.
      const { root: root2, ed: ed2 } = simulatedFlowPage(COMPILED);
      const res2 = await cmds.dispatchContentCommand(adapter, root2, applyMsg(), { instructionMainWorldWrite: async (spec) => { ed2.value = spec.text; return { ok: true, writePath: "MAIN_WORLD_EXEC_COMMAND", appStateAck: true, ackBasis: "BROWSER_INPUT_EVENTS", valueMatches: true, valueLength: spec.text.length, fingerprint: {}, version: "stub" }; }, saveConfirmTimeoutMs: 400 });
      assert(res2.ok === true && res2.writeTransport === "ISOLATED_SYNTHETIC_EVENTS", `transport=${res2.writeTransport}`);
      assert(res2.readback && res2.readback.available === true && res2.readback.text === COMPILED, "persistence boundary decides, not the ack");
    } finally { restore(); }
  });

  // ---------------- TI — TRUSTED-INPUT FALLBACK (§10/§22) ----------------
  await runTest("TI1 exact verified tab only (sender tab + Flow origin + project URL recheck)", () => {
    const good = { op: "insertText", projectRef: "8221824c-a1a6-4aa9-8d6b-fac24860d49e", text: COMPILED };
    const sender = { tab: { id: 1 }, url: "https://flow.google.com/project/8221824c-a1a6-4aa9-8d6b-fac24860d49e" };
    assert(sw.validateTrustedInputSpec(good, sender).ok === true, "valid request accepted");
    const noTab = sw.validateTrustedInputSpec(good, { url: sender.url });
    assert(noTab.ok === false && noTab.code.startsWith("SCHEMA_INVALID"), "missing sender tab refused");
    const badOrigin = sw.validateTrustedInputSpec(good, { tab: { id: 1 }, url: "https://evil.example/x" });
    assert(badOrigin.ok === false && badOrigin.code === "FLOW_ORIGIN_NOT_ALLOWED", "non-Flow sender refused");
    const badRef = sw.validateTrustedInputSpec({ ...good, projectRef: "../etc" }, sender);
    assert(badRef.ok === false, "malformed projectRef refused");
    const badOp = sw.validateTrustedInputSpec({ ...good, op: "Runtime.evaluate" }, sender);
    assert(badOp.ok === false, "non-Input op refused at the gate");
  });

  await runTest("TI2+TI6 debugger surface allowlisted (static scan: Input only, no network/storage/cookie)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../flow-companion/extension/src/background/service-worker.js"), "utf8");
    assert(src.includes('"Input.insertText"') && src.includes('"Input.dispatchKeyEvent"'), "exactly the two allowed Input commands present");
    // Command literals only (quoted) — doc-comment mentions are not surface.
    const commandLiterals = [...src.matchAll(/sendCommand\(\{ tabId \}, "([^"]+)"/g)].map((m) => m[1]);
    assert(commandLiterals.length === 3, `three sendCommand call sites (insertText + keyDown + keyUp), got ${commandLiterals.length}`);
    for (const cmd of commandLiterals) {
      assert(cmd === "Input.insertText" || cmd === "Input.dispatchKeyEvent", `allowlisted command only: ${cmd}`);
    }
    const realAttach = (src.match(/await chrome\.debugger\.attach/g) || []).length;
    const realDetach = (src.match(/await chrome\.debugger\.detach/g) || []).length;
    assert(realAttach === 1 && realDetach === 1, "one attach site, one finally-detach site");
  });

  await runTest("TI3 canonical text typed via per-char key events (adapter strategy C, ack recorded)", async () => {
    const restore = adoptSelectors();
    try {
      const { map, root, ed } = simulatedFlowPage(COMPILED);
      const trustedInputWrite = async (spec) => {
        assert(spec.op === "keyText" && spec.text === COMPILED, "canonical text typed key-by-key (operator-typing equivalent)");
        ed.value = spec.text; // browser-level key events land in the editor
        return { ok: true, op: "keyText" };
      };
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionTrustedInput: trustedInputWrite, saveConfirmTimeoutMs: 400 });
      assert(res.ok === true && res.status === "APPLIED", "apply+save confirmed via trusted input");
      assert(res.writeTransport === "CDP_KEY_EVENTS" && res.ackBasis === "CDP_TRUSTED_INPUT", `transport=${res.writeTransport} basis=${res.ackBasis}`);
      assert(res.appStateAck === true && res.saveConfirmed === true, "ack + save acknowledgement recorded");
      assert(res.readback && res.readback.available === true && res.readback.text === COMPILED, "post-reopen provider readback");
    } finally { restore(); }
  });

  await runTest("TI3b key-event miss falls back to insertText (CDP_INPUT_INSERT_TEXT)", async () => {
    const restore = adoptSelectors();
    try {
      const { root, ed } = simulatedFlowPage(COMPILED);
      const calls = [];
      const trustedInputWrite = async (spec) => {
        calls.push(spec.op);
        if (spec.op === "insertText") ed.value = spec.text;
        return { ok: true, op: spec.op };
      };
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionTrustedInput: trustedInputWrite, saveConfirmTimeoutMs: 400 });
      assert(calls[0] === "keyText" && calls[1] === "insertText", "keyText tried first, insertText second");
      assert(res.ok === true && res.writeTransport === "CDP_INPUT_INSERT_TEXT", `transport=${res.writeTransport}`);
    } finally { restore(); }
  });

  await runTest("TI5 permission-blocked trusted input surfaces the refusal, chain stays honest", async () => {
    const restore = adoptSelectors();
    try {
      const { root, ed } = simulatedFlowPage(COMPILED);
      const trustedInputWrite = async () => { throw new Error("TRUSTED_INPUT_PERMISSION_BLOCKED: debugger API unavailable"); };
      const res = await cmds.dispatchContentCommand(adapter, root, applyMsg(), { instructionTrustedInput: trustedInputWrite, saveConfirmTimeoutMs: 400 });
      // §10: the blocked fallback is reported; the remaining authorized
      // transports still run and the persistence boundary keeps the verdict.
      assert(res.ok === true && res.status === "APPLIED" && res.writeTransport === "ISOLATED_SYNTHETIC_EVENTS", `transport=${res.writeTransport}`);
      assert(res.trustedInputCode === "TRUSTED_INPUT_PERMISSION_BLOCKED", "refusal code surfaced");
      assert(res.readback && res.readback.available === true && res.readback.text === COMPILED, "persistence boundary decides (provider readback)");
    } finally { restore(); }
  });

  console.log(`\n=== FIX 03 write-persistence: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
