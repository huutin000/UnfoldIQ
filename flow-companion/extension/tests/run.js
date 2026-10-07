"use strict";

/**
 * Flow Companion extension test runner (STEP 10B + POST-v1E stall fix).
 * Plain node, zero dependencies. Run via `npm test` in this directory.
 */

const path = require("path");
const adapter = require("../src/content/flow-page-adapter");
const detector = require("../src/core/capability-detector");
const commands = require("../src/content/content-commands");
const UIState = require("../src/ui/state/ui-state");
const AutoPrepare = require("../src/ui/state/auto-prepare");
const DevTools = require("../src/ui/components/developer-tools");
const { fullPage, S } = require("../../harness/mock-flow-page");
const creditGate = require("../src/background/service-worker");
const { FakeElement, FakeDocument } = require("./mock-dom");

let passed = 0;
let failed = 0;

// POST-v1E.2B: node lacks KeyboardEvent — minimal shim so the Escape cleanup
// path in closeGenerationSettings is exercised by tests (browser unaffected).
if (typeof globalThis.KeyboardEvent === "undefined") {
  globalThis.KeyboardEvent = class {
    constructor(type, opts = {}) {
      this.type = type;
      this.key = opts.key;
      this.bubbles = opts.bubbles;
    }
  };
}

function assert(c, m) {
  if (!c) throw new Error(m);
  passed++;
}

async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

/* ---------- fixtures ---------- */

// Flow page whose live state already reads as an image job with 1:1
// selected — assessGenerationReady should report READY.
function imageReadyPage() {
  const doc = fullPage();
  doc.map[S("MODE_IMAGE")].attrs["aria-selected"] = "true";
  doc.map[S("ASPECT_CONTROL")].value = "1:1";
  return doc;
}

// Flow page a real preparation pipeline can drive to ready: IMAGE already
// selected, aspect 16:9 with a clickable "1:1" option (click updates the
// control, like a real popover), output count exposed and already 1.
function prepareablePage() {
  const doc = fullPage();
  doc.map[S("MODE_IMAGE")].attrs["aria-selected"] = "true";
  doc.map[S("ASPECT_CONTROL")].value = "16:9";
  const aspectOpt = new FakeElement({ tag: "div", attrs: { role: "option", "aria-label": "1:1" } });
  aspectOpt.click = () => {
    aspectOpt.clicked += 1;
    doc.map[S("ASPECT_CONTROL")].value = "1:1";
  };
  doc.map['[role="option"]'] = [aspectOpt];
  doc.map[S("OUTPUT_COUNT")] = new FakeElement({ tag: "button", attrs: {}, value: "1" });
  doc.map[S("MODEL_CONTROL")] = new FakeElement({ tag: "button", attrs: { "aria-label": "Veo 3.1" } });
  doc.map[S("CREDIT_DISPLAY")] = new FakeElement({ tag: "button", attrs: { "aria-label": "10 credits" } });
  return doc;
}

function makePreparer(overrides = {}) {
  const calls = { prepare: 0, snapshot: 0, awaitApproval: 0 };
  const states = [];
  const errors = [];
  const logs = [];
  const deps = {
    log: (m) => logs.push(m),
    onState: (s) => states.push(s),
    onError: (e) => errors.push(e),
    resolveLiveTab: async () => ({ ping: true, source: "SESSION_REVALIDATED", tabId: 1, origin: "https://flow.google.com" }),
    sendPrepare: async () => {
      calls.prepare += 1;
      return {
        ok: true,
        prepared: true,
        stage: "readiness",
        missing: [],
        settings: { generationType: "IMAGE", aspect: "1:1", outputCount: 1, model: "Veo 3.1", visibleCost: "10 credits" },
        generate: { found: true, enabled: true },
        generationState: { ready: true, missing: [], checks: {}, details: {} },
        clickedGenerate: false,
        creditsConsumed: false,
      };
    },
    freezeSnapshot: async () => {
      calls.snapshot += 1;
    },
    markAwaitingApproval: async () => {
      calls.awaitApproval += 1;
    },
    ...overrides,
  };
  return { prep: AutoPrepare.createAutoPreparer(deps), calls, states, errors, logs };
}

const PREPARED_JOB = { jobId: "FLOW-COMPANION-LIVE-GEN-01", attempt: 1, status: "PREPARED", capability: "image", prompt: "Create a simple minimal blue circle centered on a clean light background. No text." };

/* ---------- adapter + commands (existing + PREPARE_GENERATION) ---------- */

console.log("=== FLOW COMPANION EXTENSION TESTS ===");

(async () => {
  await t("prompt detected on full page", () => assert(adapter.detectPromptControl(fullPage()) !== null, "prompt expected"));

  await t("missing prompt fails safe", () => {
    const doc = fullPage();
    delete doc.map[S("PROMPT_INPUT")];
    const r = adapter.prepareJob(doc, { capability: "image" });
    assert(r.manualAssist === true, "manual assist expected");
  });

  await t("image + video modes selectable", () => {
    assert(adapter.selectMode(fullPage(), "image").ok === true, "image");
    assert(adapter.selectMode(fullPage(), "video").ok === true, "video");
  });

  await t("approval gate blocks submit", async () => {
    let threw = false;
    try {
      adapter.submitAfterApproval(fullPage(), { approved: false });
    } catch {
      threw = true;
    }
    assert(threw, "submit without approval must throw");
  });

  await t("uncertain capabilities recommend manual assist", () => {
    assert(detector.recommendMode(detector.detectCapabilities({})) === "MANUAL_ASSIST", "manual assist expected");
  });

  // POST-v1E stall fix: readiness must not deadlock on the pending approval.
  await t("assessGenerationReady: approval pending is not a missing condition when expected", () => {
    const gs = adapter.assessGenerationReady(imageReadyPage(), { promptVerified: true, approvalState: "PREPARED", approvalPendingExpected: true });
    assert(gs.ready === true, `expected ready, missing=${gs.missing}`);
  });
  await t("assessGenerationReady: APPROVAL_NOT_RECORDED still reported when not expected", () => {
    const gs = adapter.assessGenerationReady(imageReadyPage(), { promptVerified: true, approvalState: "PREPARED" });
    assert(gs.ready === false && gs.missing.includes("APPROVAL_NOT_RECORDED"), "APPROVAL_NOT_RECORDED expected");
  });

  await t("PREPARE_GENERATION: drives prompt+IMAGE+1:1+output to ready, never clicks Generate", async () => {
    const doc = prepareablePage();
    const genBtn = doc.map[S("GENERATE_BUTTON")];
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED" }, {});
    assert(res.ok === true && res.prepared === true, `expected prepared, got code=${res.code} missing=${res.missing}`);
    assert(res.settings.generationType === "IMAGE", "IMAGE expected");
    assert(res.settings.aspect === "1:1", "1:1 expected");
    assert(res.settings.outputCount === 1, "output=1 expected");
    assert(res.settings.model === "Veo 3.1", "live model label expected");
    assert(res.settings.visibleCost === "10 credits", "live cost expected");
    assert(res.generate.found === true && res.generate.enabled === true, "Generate found+enabled expected");
    assert(res.clickedGenerate === false && res.creditsConsumed === false, "zero-credit expected");
    assert(genBtn.clicked === 0, "Generate must never be clicked during preparation");
  });

  await t("PREPARE_GENERATION: returns precise stage code when aspect target missing", async () => {
    const doc = prepareablePage();
    doc.map['[role="option"]'] = [];
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED" }, {});
    assert(res.prepared === false && res.stage === "aspect" && res.code === "TARGET_ASPECT_NOT_AVAILABLE", `expected precise aspect code, got ${res.stage}/${res.code}`);
  });

  await t("PREPARE_GENERATION: unknown command still rejected", async () => {
    let threw = false;
    try {
      await commands.dispatchContentCommand(adapter, fullPage(), { type: "NOT_A_COMMAND" }, {});
    } catch {
      threw = true;
    }
    assert(threw, "unknown command must throw");
  });

  // §21 — PREPARED auto-advance.
  await t("§21 PREPARED auto-advances into zero-credit preparation", async () => {
    const { prep, calls, states } = makePreparer();
    const out = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(out.prepared === true, "prepared expected");
    assert(calls.prepare === 1, "PREPARE called exactly once");
    assert(calls.awaitApproval === 1, "await-approval transition recorded");
    assert(calls.snapshot === 1, "approval snapshot frozen");
    assert(states.includes("PREPARING") && states.includes("AWAITING_USER_APPROVAL"), `states=${states}`);
  });

  // §25 — successful preparation end state.
  await t("§25 successful preparation freezes snapshot and opens approval gate only", async () => {
    const { prep, calls, errors } = makePreparer();
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(calls.awaitApproval === 1 && calls.snapshot === 1, "transition+snapshot expected");
    assert(errors.length === 0, `no errors expected: ${JSON.stringify(errors)}`);
  });

  // §22 — single-flight.
  await t("§22 concurrent triggers prepare exactly once", async () => {
    const { prep, calls } = makePreparer();
    await Promise.all([
      prep.ensureCurrentJobPrepared({ ...PREPARED_JOB }),
      prep.ensureCurrentJobPrepared({ ...PREPARED_JOB }),
      prep.ensureCurrentJobPrepared({ ...PREPARED_JOB }),
    ]);
    assert(calls.prepare === 1, `PREPARE called ${calls.prepare} times, expected 1`);
  });

  await t("§8 material job change produces a new prepare key", async () => {
    const { prep, calls } = makePreparer();
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB, attempt: 2 });
    assert(calls.prepare === 2, "new attempt must re-prepare");
  });

  // §20 — token recovery: error latch must not poison re-entry.
  await t("§20 token recovery: reset clears latch, preparation runs once, no reload", async () => {
    let calls = 0;
    let fail = true;
    const { prep, states } = makePreparer({
      sendPrepare: async () => {
        calls += 1;
        if (fail) throw new Error("BRIDGE_TOKEN_REQUIRED: nhập mã truy cập Bridge trước");
        return { ok: true, prepared: true, stage: "readiness", missing: [], generationState: { ready: true, missing: [], checks: {}, details: {} }, clickedGenerate: false, creditsConsumed: false };
      },
    });
    const first = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(first.prepared === false, "first run must fail (token absent)");
    assert(states.includes("NEED_ATTENTION"), "failed state reported");
    // Token becomes valid → recovery: clear stale state, re-run.
    fail = false;
    prep.reset();
    const second = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(second.prepared === true, "second run must succeed after recovery");
    assert(calls === 2 && fail === false, "exactly one real prepare after recovery");
  });

  // §24 — failed preparation.
  await t("§24 failed preparation maps to Cần xử lý + Thử lại with precise code", async () => {
    const { prep, states, errors, calls } = makePreparer({
      sendPrepare: async () => ({ ok: true, prepared: false, stage: "settings", code: "SETTINGS_POPOVER_NOT_OBSERVED", missing: [] }),
    });
    const out = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(out.prepared === false, "not prepared");
    assert(errors.length === 1 && errors[0].code === "SETTINGS_POPOVER_NOT_OBSERVED", `precise code preserved: ${JSON.stringify(errors)}`);
    assert(states.includes("NEED_ATTENTION"), `NEED_ATTENTION expected, states=${states}`);
    assert(!states.includes("AWAITING_USER_APPROVAL"), "must not reach approval");
    assert(calls.awaitApproval === 0, "no bridge transition on failure");
    const mapped = UIState.resolveUIState("NEED_ATTENTION");
    assert(mapped.status === "Cần xử lý" && mapped.cta === "Thử lại", `UI=${mapped.status}/${mapped.cta}`);
  });

  // §11 — honest state mapping.
  await t("§11 PREPARED without active preparation never reads Đang chuẩn bị", () => {
    assert(UIState.uiStateForJob({ status: "PREPARED" }, {}) === "NEED_ATTENTION", "idle PREPARED → Cần xử lý");
    assert(UIState.uiStateForJob({ status: "PREPARED" }, { preparationActive: true }) === "PREPARING", "active prep → Đang chuẩn bị");
    assert(UIState.uiStateForJob({ status: "PREPARED" }, { generationReady: true }) === "AWAITING_USER_APPROVAL", "ready → Sẵn sàng");
    assert(UIState.uiStateForJob({ status: "AWAITING_USER_APPROVAL" }, {}) === "AWAITING_USER_APPROVAL", "awaiting → Sẵn sàng");
  });

  // §23 — diagnostic consistency: canonical ping wins over port presence.
  await t("§23 canonical ping=true renders content script connected", () => {
    const text = DevTools.renderDiagnosticsText({
      contentScriptStatus: "CONNECTED",
      contentScriptTabId: 1466562279,
      contentScriptOrigin: "https://flow.google.com",
      contentScriptSource: "SESSION_REVALIDATED",
      contentScriptLastPingAt: "2026-09-30T02:03:30.200Z",
    });
    assert(/Đã kết nối/.test(text), "connected expected");
    assert(/1466562279/.test(text) && /SESSION_REVALIDATED/.test(text), "tabId+source expected");
  });

  // §10 — watchdog converts a stalled preparation into a retryable error.
  await t("§10 watchdog fires PREPARATION_TIMEOUT on stalled preparation", async () => {
    const { prep, states, errors } = makePreparer({
      watchdogMs: 40,
      sendPrepare: () => new Promise(() => {}), // never settles
    });
    // The stuck promise is deliberately not awaited: the watchdog is what
    // must rescue the UI from an indefinite "Đang chuẩn bị…" state.
    void prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    await new Promise((r) => setTimeout(r, 80));
    assert(errors.some((e) => e.code === "PREPARATION_TIMEOUT"), `watchdog error expected: ${JSON.stringify(errors)}`);
    assert(states.includes("NEED_ATTENTION"), "NEED_ATTENTION after watchdog");
  });

  /* ---------- POST-v1E FIX 02: composer readiness race ---------- */

  const ANCHOR_SEL = 'button[aria-label="Add ingredients to the prompt box"]';

  // Live DOM shape: anchor button nested in a composer container holding the
  // editor (FakeElement gets a manual parentElement chain — the mock has no
  // real tree).
  function composerPage() {
    const doc = new FakeDocument({});
    const editor = new FakeElement({ tag: "input", attrs: { "aria-label": "Editable text" } });
    const composer = new FakeElement({ tag: "div" });
    composer.querySelectorAll = (sel) => (sel === 'input[aria-label="Editable text"]' ? [editor] : []);
    const anchor = new FakeElement({ tag: "button", attrs: { "aria-label": "Add ingredients to the prompt box" } });
    anchor.parentElement = composer;
    doc.map[ANCHOR_SEL] = anchor;
    return { doc, editor, composer, anchor };
  }

  await t("FIX02 resolvePromptComposer: anchor scopes the composer container", () => {
    const { doc, editor } = composerPage();
    const r = adapter.resolvePromptComposer(doc);
    assert(r && r.editor === editor, "editor resolved via anchor scope");
    assert(r.composerRoot && r.via === "anchor", "composer root scoped by anchor");
  });

  await t("FIX02 async composer mount: observer/poll resolves once mounted", async () => {
    const doc = new FakeDocument({});
    setTimeout(() => {
      doc.map['[contenteditable="true"]'] = new FakeElement({ tag: "div", attrs: { contenteditable: "true" } });
    }, 60);
    const r = await adapter.waitForPromptComposer(doc, { timeoutMs: 3000, pollMs: 25 });
    assert(r.ready === true, `expected ready, got ${JSON.stringify(r)}`);
    assert(r.waited === true && r.elapsedMs >= 0, "waited evidence expected");
  });

  await t("FIX02 composer timeout: bounded failure, never an immediate miss", async () => {
    const t0 = Date.now();
    const r = await adapter.waitForPromptComposer(new FakeDocument({}), { timeoutMs: 80, pollMs: 20 });
    assert(r.ready === false && r.code === "FLOW_COMPOSER_READY_TIMEOUT", `expected timeout, got ${JSON.stringify(r)}`);
    assert(Date.now() - t0 >= 80 && Date.now() - t0 < 2000, `bounded wait expected, took ${Date.now() - t0}ms`);
  });

  await t("FIX02 PREPARE_GENERATION waits for the async-mounted composer", async () => {
    const doc = prepareablePage();
    delete doc.map[S("PROMPT_INPUT")];
    setTimeout(() => {
      doc.map[S("PROMPT_INPUT")] = new FakeElement({ tag: "textarea", value: "" });
    }, 60);
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", composerTimeoutMs: 3000 }, {});
    assert(res.ok === true && res.prepared === true, `expected prepared, got code=${res.code}`);
    assert(res.composerWait && res.composerWait.waited === true, "composerWait evidence expected");
  });

  await t("FIX02 PREPARE_GENERATION: composer never mounts → bounded FLOW_COMPOSER_READY_TIMEOUT", async () => {
    const res = await commands.dispatchContentCommand(adapter, new FakeDocument({}), { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", composerTimeoutMs: 60 }, {});
    assert(res.ok === true && res.prepared === false && res.stage === "prompt-composer" && res.code === "FLOW_COMPOSER_READY_TIMEOUT", `got ${JSON.stringify(res)}`);
    assert(typeof res.elapsedMs === "number" && res.elapsedMs < 2000, "timeout metadata expected");
  });

  await t("FIX02 failure never latches: retry of the same job runs a fresh attempt", async () => {
    let calls = 0;
    let fail = true;
    const { prep, states, logs } = makePreparer({
      sendPrepare: async () => {
        calls += 1;
        if (fail) return { ok: true, prepared: false, stage: "prompt", code: "PROMPT_INPUT_NOT_FOUND" };
        return { ok: true, prepared: true, stage: "readiness", missing: [], generationState: { ready: true, missing: [], checks: {}, details: {} }, clickedGenerate: false, creditsConsumed: false };
      },
    });
    const first = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(first.prepared === false, "first attempt must fail");
    assert(states.includes("NEED_ATTENTION"), "NEED_ATTENTION after failure");
    fail = false;
    const second = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(second.prepared === true, "retry must run (Thử lại works)");
    assert(calls === 2, `PREPARE called ${calls} times, expected 2`);
    assert(!logs.some((l) => l.includes("already prepared")), "forbidden: already prepared after failure");
  });

  await t("FIX02 failed prerequisite never logs generationReady=false missing=[]", async () => {
    const { prep, logs } = makePreparer({
      sendPrepare: async () => ({ ok: true, prepared: false, stage: "prompt", code: "PROMPT_INPUT_NOT_FOUND" }),
    });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    const line = logs.find((l) => l.includes("generationReady="));
    assert(line && /generationReady=NOT_EVALUATED/.test(line), `honest readiness line expected, got: ${line}`);
    assert(line && !/missing=\[\]/.test(line), `missing must be non-empty on failure, got: ${line}`);
  });

  await t("FIX02 successful prep still dedupes (already prepared only after success)", async () => {
    const { prep, calls, logs } = makePreparer();
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    const second = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(second.skipped === true && second.reason === "COMPLETED", "successful dedupe expected");
    assert(calls.prepare === 1, "no second prepare after success");
    assert(logs.some((l) => l.includes("already prepared")), "dedupe log allowed only after success");
  });

  await t("FIX02 ping telemetry: resolver pingSuccess shape reads ping=true", async () => {
    const { prep, logs } = makePreparer({
      resolveLiveTab: async () => ({ pingSuccess: true, source: "QUERY", tabId: 7, origin: "https://flow.google.com" }),
    });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(logs.some((l) => /liveTab resolved ping=true source=QUERY/.test(l)), `ping=true expected, got: ${logs.join(" | ")}`);
    assert(!logs.some((l) => l.includes("ping=undefined")), "ping=undefined forbidden");
  });

  /* ---------- POST-v1E FIX 02: safe probe privacy ---------- */

  function privacyPage() {
    const doc = fullPage();
    // Stored under the exact selectors the probe queries (mock DOM is a
    // flat selector→element map).
    doc.map["button"] = [
      new FakeElement({ tag: "button", attrs: { "aria-label": "Google Account: Tuan Huynh" } }),
      new FakeElement({ tag: "button", attrs: { title: "Manage membership" } }),
      new FakeElement({ tag: "button", attrs: { title: "Contact john.doe@corp.com" } }),
      new FakeElement({ tag: "button", attrs: { "aria-label": "Add ingredients to the prompt box" } }),
      new FakeElement({ tag: "button", attrs: { "aria-label": "Generate" } }),
    ];
    doc.map["textarea"] = [new FakeElement({ tag: "textarea", attrs: { name: "g-recaptcha-response" } })];
    doc.map["input"] = [new FakeElement({ tag: "input", attrs: { "aria-label": "Search" } })];
    return doc;
  }

  await t("FIX02 probe privacy: account/CAPTCHA/search excluded, PII redacted", () => {
    const probe = adapter.probeCandidateControls(privacyPage(), { max: 100, perSelector: 50 });
    const raw = JSON.stringify(probe);
    assert(!raw.includes("@corp.com"), "raw email leaked");
    assert(!raw.includes("Google Account"), "account aria-label leaked");
    assert(!raw.includes("membership"), "membership text leaked");
    assert(!raw.includes("g-recaptcha"), "CAPTCHA element leaked");
    assert(!probe.controls.some((c) => c.ariaLabel === "Search" || c.tag === "textarea" && c.name === "g-recaptcha-response"), "search/captcha candidate present");
    // Still useful: safe Flow controls remain observable.
    assert(probe.controls.some((c) => c.ariaLabel === "Add ingredients to the prompt box"), "composer anchor must remain visible to the probe");
    assert(probe.controls.some((c) => c.ariaLabel && /generate/i.test(c.ariaLabel)), "Generate control must remain visible to the probe");
  });

  await t("FIX02 redactSafe: emails and token-like strings", () => {
    assert(adapter.redactSafe("mail john.doe@corp.com end") === "mail [REDACTED_EMAIL] end", "email redaction");
    assert(adapter.redactSafe("aA9_-".repeat(6)) === "[REDACTED_TOKEN]", "token redaction");
    assert(adapter.redactSafe("Add ingredients to the prompt box") === "Add ingredients to the prompt box", "normal labels untouched");
  });

  await t("FIX02 composerProbe: counts only, useful on both page shapes", () => {
    const anchored = adapter.composerProbe(composerPage().doc);
    assert(anchored.composerAnchorFound === true && anchored.composerRootFound === true, "anchor+root expected");
    assert(anchored.promptEditableFound === true && anchored.promptEditableType === "input", `editor type: ${anchored.promptEditableType}`);
    assert(anchored.promptWritable === true && anchored.promptVisible === true, "writable+visible expected");
    const legacy = adapter.composerProbe(fullPage());
    assert(legacy.promptEditableFound === true && legacy.promptWritable === true, "fallback editor expected on legacy page");
    assert(legacy.composerAnchorFound === false, "no anchor on legacy page");
  });

  /* ---------- POST-v1E FIX 03: prompt insert + verify ---------- */

  const SECRET_PROMPT = "CONFIDENTIAL-prompt-body-XYZ-987";

  function ceEditor() {
    return new FakeElement({ tag: "div", attrs: { contenteditable: "true" } });
  }

  // §19 — contenteditable success (mock: no execCommand → dom-replace).
  await t("FIX03 contenteditable insert+verify success", async () => {
    const doc = prepareablePage();
    doc.map[S("PROMPT_INPUT")] = ceEditor();
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    assert(res.ok === true && res.prepared === true, `expected prepared, got code=${res.code}`);
    const pi = res.promptInsert;
    assert(pi.inserted === true && pi.verified === true && pi.fingerprintMatch === true, `evidence: ${JSON.stringify(pi)}`);
    assert(pi.editorType === "contenteditable" && pi.strategy === "dom-replace", `type/strategy: ${pi.editorType}/${pi.strategy}`);
    assert(pi.stable === true, "app-state stability expected");
    assert(res.stages && res.stages.prompt === "PASS", "prompt stage PASS");
  });

  // §20 — input success: value updated, input event observed, verified.
  await t("FIX03 input insert: value updated + input event + verified", async () => {
    const doc = prepareablePage();
    const input = new FakeElement({ tag: "input", attrs: { "aria-label": "Editable text" } });
    const events = [];
    input.dispatchEvent = (e) => events.push(e);
    doc.map[S("PROMPT_INPUT")] = input;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    assert(input.value === "blue circle", `value updated expected, got "${input.value}"`);
    assert(events.some((e) => e && e.type === "input"), "input event observed expected");
    assert(res.ok === true && res.prepared === true && res.promptInsert.verified === true, `got code=${res.code}`);
  });

  // §21 — editor replaced after insert: verification lands on the fresh editor.
  await t("FIX03 editor replaced after insert: verified via re-resolved editor", async () => {
    const doc = new FakeDocument({});
    const editorA = ceEditor();
    editorA.textContent = "stale pre-insert text";
    const editorB = ceEditor();
    editorB.textContent = "blue circle";
    doc.map['[contenteditable="true"]'] = editorA;
    setTimeout(() => {
      doc.map['[contenteditable="true"]'] = editorB;
    }, 40);
    const r = await adapter.waitForPromptValue(doc, "blue circle", { timeoutMs: 3000, originalEditor: editorA });
    assert(r.matched === true, `matched expected: ${JSON.stringify(r)}`);
    assert(r.editorReplaced === true, "editorReplaced evidence expected");
    assert(r.fingerprintMatch === true, "fingerprintMatch expected");
  });

  // §22 — editor replaced with an EMPTY editor that stays empty: precise code
  // after the safe retry, no settings stage.
  await t("FIX03 editor replaced empty → PROMPT_EDITOR_REPLACED_EMPTY, no settings stage", async () => {
    const doc = prepareablePage();
    let reads = 0;
    const editorA = ceEditor();
    Object.defineProperty(editorA, "textContent", {
      get() {
        reads += 1;
        return reads <= 3 ? "blue circle" : "";
      },
      set() {},
    });
    doc.map[S("PROMPT_INPUT")] = editorA;
    setTimeout(() => {
      const emptyB = ceEditor();
      Object.defineProperty(emptyB, "textContent", { get() { return ""; }, set() {} });
      doc.map[S("PROMPT_INPUT")] = emptyB;
    }, 20);
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 150, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.stage === "prompt" && res.code === "PROMPT_EDITOR_REPLACED_EMPTY", `got ${res.stage}/${res.code}`);
    assert(res.promptInsert.editorReplaced === true, "editorReplaced evidence expected");
    assert(res.promptInsert.attempts === 2, "safe retry consumed");
    assert(res.settings === undefined, "must not enter generation-settings stage");
  });

  // POST-v1E.1 — retry recovery after a re-render: attempt 1 lands on a
  // replaced editor; the safe retry re-inserts into the fresh editor.
  await t("v1E1 re-render recovery: retry lands on the fresh editor and verifies", async () => {
    const doc = prepareablePage();
    let reads = 0;
    const editorA = ceEditor();
    Object.defineProperty(editorA, "textContent", {
      get() {
        reads += 1;
        return reads <= 3 ? "blue circle" : "";
      },
      set() {},
    });
    doc.map[S("PROMPT_INPUT")] = editorA;
    setTimeout(() => {
      const editorB = ceEditor();
      doc.map[S("PROMPT_INPUT")] = editorB;
    }, 20);
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 300, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.ok === true && res.prepared === true, `retry should verify on fresh editor, got ${res.code}`);
    assert(res.promptInsert.attempts === 2, `attempts=2 expected, got ${res.promptInsert.attempts}`);
    assert(res.promptInsert.verified === true && res.promptInsert.stable === true, "verified+stable on the fresh editor");
  });

  // §23 — normalization: formatting noise equal, real differences not.
  await t("FIX03 normalization: CRLF/NBSP/zero-width/trailing newline equal; different text not", () => {
    const n = adapter.normalizePromptText;
    assert(n("a\r\nb\rc") === n("a\nb\nc"), "CRLF/CR vs LF");
    assert(n("a\u00A0b") === n("a b"), "NBSP vs space");
    assert(n("a\u200Bb\u200Cc\u200Dd\uFEFF") === n("abcd"), "zero-width removed");
    assert(n("text\n") === n("text"), "single trailing browser newline collapsed");
    assert(n("text  ") === n("text"), "trailing whitespace collapsed");
    assert(n("line one\nline two") === "line one\nline two", "line structure preserved");
    assert(n("blue circle") !== n("red circle"), "genuinely different text stays different");
  });

  // §24 — observed text intentionally different → PROMPT_TEXT_MISMATCH.
  await t("FIX03 mismatched observed text → PROMPT_TEXT_MISMATCH with lengths", async () => {
    const doc = prepareablePage();
    let reads = 0;
    const editorA = ceEditor();
    Object.defineProperty(editorA, "textContent", {
      get() {
        reads += 1;
        return reads <= 3 ? "blue circle" : "totally corrupted prompt text";
      },
      set() {},
    });
    doc.map[S("PROMPT_INPUT")] = editorA;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 150, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.stage === "prompt" && res.code === "PROMPT_TEXT_MISMATCH", `got ${res.stage}/${res.code}`);
    assert(res.promptInsert.observedLength > 0 && res.promptInsert.fingerprintMatch === false, `evidence: ${JSON.stringify(res.promptInsert)}`);
  });

  // §25 — insertion claims success but editor never matches → bounded timeout,
  // single-flight cleared, retryable UI.
  await t("FIX03 verify timeout → PROMPT_VERIFY_TIMEOUT, retryable, no latch", async () => {
    const doc = prepareablePage();
    let reads = 0;
    const editorA = ceEditor();
    Object.defineProperty(editorA, "textContent", {
      get() {
        reads += 1;
        return reads <= 3 ? "blue circle" : "";
      },
      set() {},
    });
    doc.map[S("PROMPT_INPUT")] = editorA;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 100, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.stage === "prompt" && res.code === "PROMPT_VERIFY_TIMEOUT", `got ${res.stage}/${res.code}`);
    const { prep, states, logs, errors } = makePreparer({
      sendPrepare: async () => ({ ok: true, prepared: false, stage: "prompt", code: "PROMPT_VERIFY_TIMEOUT" }),
    });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(errors.some((e) => e.code === "PROMPT_VERIFY_TIMEOUT"), "precise code surfaced");
    assert(states.includes("NEED_ATTENTION"), "NEED_ATTENTION expected");
    const mapped = UIState.resolveUIState("NEED_ATTENTION");
    assert(mapped.status === "Cần xử lý" && mapped.cta === "Thử lại", `UI=${mapped.status}/${mapped.cta}`);
    assert(!logs.some((l) => l.includes("already prepared")), "no latch after verify timeout");
  });

  // §26 — no raw prompt body in any diagnostics surface.
  await t("FIX03 no raw prompt in diagnostics (insert/verify/probe/state)", async () => {
    const doc = prepareablePage();
    doc.map[S("PROMPT_INPUT")] = ceEditor();
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: SECRET_PROMPT, approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    assert(res.ok === true && res.prepared === true, `expected prepared, got code=${res.code}`);
    const surfaces =
      JSON.stringify(res) +
      JSON.stringify(adapter.probeCandidateControls(doc, { max: 100 })) +
      JSON.stringify(adapter.composerProbe(doc)) +
      JSON.stringify(adapter.buildLiveDiagnostics(doc, {}));
    assert(!surfaces.includes(SECRET_PROMPT), "raw prompt leaked into diagnostics");
  });

  await t("FIX03 precise codes preserved through root-cause matrix (insert did nothing)", async () => {
    const doc = prepareablePage();
    const editorA = ceEditor();
    // Insert writes; every read sees nothing — Case A at the wait boundary.
    Object.defineProperty(editorA, "textContent", { get() { return ""; }, set() {} });
    doc.map[S("PROMPT_INPUT")] = editorA;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 80, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.stage === "prompt", `got ${res.stage}/${res.code}`);
    assert(["PROMPT_INSERT_FAILED", "PROMPT_VERIFY_TIMEOUT", "PROMPT_EDITOR_REPLACED_EMPTY"].includes(res.code), `case-A code: ${res.code}`);
    assert(res.code !== "PROMPT_VERIFY_FAILED", "generic PROMPT_VERIFY_FAILED is forbidden");
  });

  /* ---------- POST-v1E.1: normalization + PromptWriter + P2 error UI ---------- */

  // P0 unit — canonical normalization, symmetric, NFC, end-whitespace only.
  await t("v1E1 normalization: exact, trailing LF/CRLF, NBSP, zero-width", () => {
    const n = adapter.normalizePromptText;
    assert(n("Create a circle.") === "Create a circle.", "exact text");
    assert(n("Create a circle.\n") === n("Create a circle."), "trailing LF removed");
    assert(n("Create a circle.\r\n") === n("Create a circle."), "trailing CRLF removed");
    assert(n("blue\u00A0circle") === n("blue circle"), "NBSP vs space");
    assert(n("blue\u200Bcircle") === "bluecircle", "zero-width removed");
  });

  await t("v1E1 normalization: internal newlines preserved, corruption detected", () => {
    const n = adapter.normalizePromptText;
    assert(n("line one\nline two") === "line one\nline two", "meaningful internal newline preserved");
    assert(n("blue circle") !== n("blue square"), "real character mismatch");
    assert(n("blue  circle") !== n("blue circle"), "extra internal space is corruption, not noise");
  });

  await t("v1E1 normalization: Unicode NFC equivalence", () => {
    const n = adapter.normalizePromptText;
    assert(n("e\u0301xample") === n("\u00e9xample"), "decomposed vs composed NFC forms");
    assert(n("d\u0323".normalize("NFD")) === n("\u1e0d"), "NFD input normalizes back to NFC");
  });

  await t("v1E1 mismatch diagnostics: firstDiffIndex + code points + raw evidence", async () => {
    const doc = prepareablePage();
    let reads = 0;
    const editorA = ceEditor();
    Object.defineProperty(editorA, "textContent", {
      get() {
        reads += 1;
        return reads <= 3 ? "blue circle" : "blue circlex";
      },
      set() {},
    });
    doc.map[S("PROMPT_INPUT")] = editorA;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 150, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.code === "PROMPT_TEXT_MISMATCH", `got ${res.code}`);
    const m = res.mismatch;
    assert(m, "mismatch diagnostics required");
    assert(typeof m.expectedRaw === "string" && JSON.parse(m.expectedRaw) === "blue circle", "expectedRaw JSON.stringify'd");
    assert(typeof m.observedRaw === "string" && JSON.parse(m.observedRaw) === "blue circlex", "observedRaw JSON.stringify'd");
    assert(m.rawExpectedLength === 11 && m.rawObservedLength === 12, `raw lengths: ${m.rawExpectedLength}/${m.rawObservedLength}`);
    assert(m.firstDiffIndex === 11 && m.firstDiffCodePoint === "U+0078", `first diff: ${m.firstDiffIndex}/${m.firstDiffCodePoint}`);
    assert(Array.isArray(m.observedTrailingCodePoints) && m.observedTrailingCodePoints.length > 0, "trailing code points reported");
    assert(res.promptInsert.attempts === 2, `one safe retry expected, attempts=${res.promptInsert.attempts}`);
  });

  await t("v1E1 trailing-newline mismatch (live 82 vs 83 case) normalizes away", () => {
    const d = adapter.diffPromptText("blue circle", "blue circle\n");
    assert(d.expectedLength === 11 && d.observedLength === 11, `normalized equal lengths: ${d.expectedLength}/${d.observedLength}`);
    assert(d.firstDiffIndex === -1, "no first diff after normalization");
    assert(d.rawObservedLength === 12, "raw observed length carries the extra LF for evidence");
  });

  await t("v1E1 PromptWriter: versioned, dom-replace primary, execCommand fallback", () => {
    assert(adapter.PROMPT_WRITERS.version === 2, "writer set versioned");
    assert(typeof adapter.PROMPT_WRITERS.native === "function" && typeof adapter.PROMPT_WRITERS.contenteditable === "function", "two writers registered");
  });

  await t("v1E1 generate remains blocked on mismatch: no settings, no approval", async () => {
    const doc = prepareablePage();
    let reads = 0;
    const editorA = ceEditor();
    Object.defineProperty(editorA, "textContent", {
      get() {
        reads += 1;
        return reads <= 3 ? "blue circle" : "corrupted body";
      },
      set() {},
    });
    doc.map[S("PROMPT_INPUT")] = editorA;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 150, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.stage === "prompt", "never reaches generation settings");
    assert(res.settings === undefined, "settings absent on mismatch");
    const { prep, states } = makePreparer({
      sendPrepare: async () => ({ ok: true, prepared: false, stage: "prompt", code: "PROMPT_TEXT_MISMATCH", promptInsert: { attempts: 2 }, mismatch: { firstDiffIndex: 11 } }),
    });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(!states.includes("AWAITING_USER_APPROVAL"), "no approval on mismatch — Generate blocked");
  });

  await t("v1E1 retry recovery: mismatch once, then fresh attempt succeeds", async () => {
    let calls = 0;
    let fail = true;
    const { prep, logs } = makePreparer({
      sendPrepare: async () => {
        calls += 1;
        if (fail) return { ok: true, prepared: false, stage: "prompt", code: "PROMPT_TEXT_MISMATCH", promptInsert: { attempts: 2 }, mismatch: { expectedLength: 82, observedLength: 83 } };
        return { ok: true, prepared: true, stage: "readiness", missing: [], generationState: { ready: true, missing: [], checks: {}, details: {} }, clickedGenerate: false, creditsConsumed: false };
      },
    });
    await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    fail = false;
    const second = await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
    assert(second.prepared === true && calls === 2, "Thử lại runs a fresh attempt");
    assert(!logs.some((l) => l.includes("already prepared")), "no latch after mismatch");
  });

  await t("v1E1 disabled Generate is never force-clicked", async () => {
    const doc = fullPage();
    const genBtn = doc.map[S("GENERATE_BUTTON")];
    genBtn.attrs["aria-disabled"] = "true";
    let threw = null;
    try {
      await commands.dispatchContentCommand(adapter, doc, { type: "SUBMIT_GENERATE", jobId: "j1", attempt: 1, approval: { jobId: "j1", attempt: 1, approved: true } }, {});
    } catch (e) {
      threw = String((e && e.message) || e);
    }
    assert(threw && threw.startsWith("GENERATE_STILL_DISABLED"), `disabled Generate must throw, got: ${threw}`);
    assert(genBtn.clicked === 0, "Generate was never clicked");
  });

  await t("v1E1 error details never render [object Object]", () => {
    const { errorText } = require("../src/ui/components/job-card");
    assert(errorText({ code: "PROMPT_TEXT_MISMATCH" }) === "PROMPT_TEXT_MISMATCH", "object with code");
    assert(errorText({ error: "BRIDGE_HTTP_500" }) === "BRIDGE_HTTP_500", "object with error");
    assert(errorText(new Error("boom")) === "boom", "Error instance");
    assert(errorText({ a: 1 }).includes('"a":1'), "plain object → JSON, not String()");
    assert(errorText(null) === "UNKNOWN" && errorText("") === "UNKNOWN", "empty → UNKNOWN");
    assert(errorText({}) !== "[object Object]" && errorText({ f: () => 1 }) !== "[object Object]", "no [object Object] anywhere");
  });

  /* ---------- POST-v1E.2: generation type live resolver ---------- */

  function generationMenuPage(targetDoc = null) {
    const doc = targetDoc || new FakeDocument({});
    // Escape cleanup path: keydown Escape removes open surfaces (mock).
    doc.dispatchEvent = (evt) => {
      if (evt && evt.type === "keydown" && evt.key === "Escape") {
        delete doc.map['[role="menu"]'];
        delete doc.map['[role="dialog"]'];
      }
    };
    const trigger = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "Generation settings" } });
    const imageOpt = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } });
    const videoOpt = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } });
    const menuSurface = new FakeElement({ tag: "div", attrs: { role: "menu" } });
    menuSurface.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [imageOpt, videoOpt] : []);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map['[role="menu"]'] = menuSurface;
      trigger.attrs["aria-expanded"] = "true";
    };
    imageOpt.click = () => {
      imageOpt.clicked += 1;
      imageOpt.attrs["aria-selected"] = "true";
      trigger.attrs["aria-label"] = "Image settings";
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    return { doc, trigger, imageOpt, videoOpt, menuSurface };
  }

  // 1 — already in Image mode: strong evidence, no clicks at all.
  await t("v1E2 already Image mode → verified without any click", async () => {
    const doc = prepareablePage();
    const { doc: tdoc, trigger, imageOpt } = generationMenuPage();
    doc.map["button[aria-haspopup]"] = tdoc.map["button[aria-haspopup]"];
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.ok === true && r.verified === true && r.method === "already-selected", `got ${r.method}`);
    assert(r.evidence.some((e) => e.source === "mode-control-selected" && e.value === "IMAGE"), "mode-control evidence");
    assert(trigger.clicked === 0 && imageOpt.clicked === 0, "no UI state change when already Image");
  });

  // 2+3 — trigger opens a menu containing Image + Video; Image selected with
  // selected semantics as verification evidence.
  await t("v1E2 trigger opens verified menu; Image selected + semantics verified", async () => {
    const { doc, trigger, imageOpt } = generationMenuPage();
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.ok === true && r.verified === true && r.method === "generation-menu", `got ${r.method}`);
    assert(r.trigger && r.trigger.hasPopup === "menu" && r.trigger.selectorSource === "button[aria-haspopup]", `trigger: ${JSON.stringify(r.trigger)}`);
    assert(r.menu && r.menu.visibleOptionNames.includes("Image") && r.menu.visibleOptionNames.includes("Video"), "menu option names");
    assert(r.evidence.some((e) => e.source === "menu-option-selected" && e.value === "IMAGE"), "selected semantics evidence");
    assert(trigger.clicked === 1 && imageOpt.clicked === 1, "exactly one trigger + one option click");
  });

  // 4 — global unrelated "Video" text is informational only, never VIDEO.
  await t("v1E2 global Video text match does not make current type VIDEO", async () => {
    const doc = prepareablePage();
    delete doc.map[S("MODE_IMAGE")].attrs["aria-selected"];
    delete doc.map[S("MODE_VIDEO")];
    const noise = new FakeElement({ tag: "button" });
    noise.textContent = "My video history";
    doc.map["button"] = [noise];
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "UNKNOWN" && d.verified === false, `text match must not verify: ${d.type}/${d.verified}`);
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 60, verifyTimeoutMs: 60 });
    } catch (e) {
      err = String((e && e.message) || e);
    }
    assert(err && err.startsWith("GENERATION_TRIGGER_NOT_FOUND"), `no trigger → precise code, got: ${err}`);
  });

  // 5 — hidden "Image" text anywhere does not make IMAGE verified.
  await t("v1E2 hidden/unrelated Image text does not verify IMAGE", () => {
    const doc = prepareablePage();
    delete doc.map[S("MODE_IMAGE")].attrs["aria-selected"];
    const decoy = new FakeElement({ tag: "div", attrs: { "aria-hidden": "true" } });
    decoy.textContent = "Image";
    doc.map["div.decoy-image"] = decoy;
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "UNKNOWN" && d.verified === false, `decoy verified IMAGE: ${d.type}`);
  });

  // 6 — the Image choice is scoped to the opened popover surface only.
  await t("v1E2 Image option resolved inside the opened popover only", async () => {
    const { doc } = generationMenuPage();
    const surfaceNoise = new FakeElement({ tag: "button" });
    surfaceNoise.textContent = "Image";
    const { doc: tdoc, menuSurface } = generationMenuPage();
    void tdoc;
    void surfaceNoise;
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.verified === true, "verified via menu");
    assert(r.menu && r.menu.role === "menu", "menu surface identity recorded");
    assert(r.evidence.every((e) => !/global|document-wide/i.test(e.source || "")), "no global text evidence source");
  });

  // 7 — a wrong candidate opens a non-generation surface: closed, next probed.
  // (Both candidates carry equal ranking signals so probing order follows the
  // DOM order — the wrong one is probed first.)
  await t("v1E2 wrong candidate closed, next candidate probed", async () => {
    const { doc, trigger } = generationMenuPage();
    const wrong = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
    const wrongSurface = new FakeElement({ tag: "div", attrs: { role: "dialog" } });
    wrongSurface.querySelectorAll = (sel) =>
      sel === '[role="menuitem"]' ? [new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Project settings" } })] : [];
    wrong.click = () => {
      wrong.clicked += 1;
      doc.map['[role="dialog"]'] = wrongSurface;
    };
    doc.map["button[aria-haspopup]"] = [wrong, trigger];
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.verified === true, "resolved via the second candidate");
    assert(wrong.clicked === 1 && trigger.clicked === 1, "wrong probed then correct trigger used");
  });

  // 8 — the search is bounded.
  await t("v1E2 trigger discovery is bounded", () => {
    const doc = new FakeDocument({});
    doc.map["button[aria-haspopup]"] = Array.from({ length: 12 }, () => new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu" } }));
    const cands = adapter.findGenerationTriggerCandidates(doc, null);
    assert(cands.length === adapter.GENERATION_TRIGGER_MAX && cands.length <= 6, `bounded expected, got ${cands.length}`);
  });

  // 9 — Generate is never clicked during discovery.
  await t("v1E2 Generate never clicked during discovery", async () => {
    const { doc } = generationMenuPage();
    const genBtn = new FakeElement({ tag: "button" });
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.verified === true, "resolution succeeded");
    assert(genBtn.clicked === 0, "Generate untouched");
  });

  // 10+14 — enabled Generate alone does not verify IMAGE; unresolved type
  // cannot become READY.
  await t("v1E2 enabled Generate alone never verifies IMAGE nor READY", () => {
    const doc = fullPage();
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "UNKNOWN" && d.verified === false, `Generate enabled must not prove IMAGE: ${d.type}`);
    const gs = adapter.assessGenerationReady(doc, { promptVerified: true, approvalState: "PREPARED", approvalPendingExpected: true });
    assert(gs.ready === false && gs.missing.includes("GENERATION_TYPE_UNKNOWN"), `gate holds: ${JSON.stringify(gs.missing)}`);
  });

  // 11 — Image click without post-state evidence = FAIL.
  await t("v1E2 click without post-state evidence fails precisely", async () => {
    const { doc, imageOpt } = generationMenuPage();
    imageOpt.click = () => {
      imageOpt.clicked += 1;
    };
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 100, verifyTimeoutMs: 120 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_TYPE_NOT_IMAGE"), `got: ${err}`);
    assert(err.evidence && err.evidence.trigger && err.evidence.openedSurface, "failure carries trigger+surface evidence");
  });

  // 12+13 — Image verified → pipeline advances to aspect stage; no model forced.
  await t("v1E2 Image verified via menu → pipeline advances; no model forced", async () => {
    const doc = prepareablePage();
    delete doc.map[S("MODE_IMAGE")].attrs["aria-selected"];
    delete doc.map[S("MODEL_CONTROL")];
    const { trigger, imageOpt } = generationMenuPage(doc);
    void trigger;
    void imageOpt;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    assert(res.ok === true && res.prepared === true, `prepared expected, got stage=${res.stage} code=${res.code}`);
    assert(res.settings.generationType === "IMAGE" && res.settings.aspect === "1:1" && res.settings.outputCount === 1, `settings: ${JSON.stringify(res.settings)}`);
    assert(res.generationType && res.generationType.verified === true && res.generationType.verificationSources.includes("menu-option-selected"), "verification sources recorded");
    assert(res.settings.model === "UNKNOWN", `no model forced: ${res.settings.model}`);
    assert(res.stages.aspect === "1:1", "advanced beyond generation type into aspect");
  });

  /* ---------- POST-v1E.2A: verification safety corrections ---------- */

  // Anchor-scoped composer (real composerRoot via parentElement chain) with
  // the generation trigger inside it, plus a page-level decoy that must never
  // be probed.
  function anchoredComposerPage({ withTrigger = true } = {}) {
    const doc = new FakeDocument({});
    const editor = ceEditor();
    const trigger = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu", "aria-label": "Generation settings" } });
    const imageOpt = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } });
    const videoOpt = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } });
    const menuSurface = new FakeElement({ tag: "div", attrs: { role: "menu" } });
    menuSurface.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [imageOpt, videoOpt] : []);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map['[role="menu"]'] = menuSurface;
    };
    imageOpt.click = () => {
      imageOpt.clicked += 1;
      imageOpt.attrs["aria-selected"] = "true";
    };
    const composer = new FakeElement({ tag: "div" });
    composer.querySelectorAll = (sel) => {
      if (sel === '[contenteditable="true"]') return [editor];
      if (withTrigger && sel === "button[aria-haspopup]") return [trigger];
      return [];
    };
    const anchor = new FakeElement({ tag: "button", attrs: { "aria-label": "Add ingredients to the prompt box" } });
    anchor.parentElement = composer;
    doc.map[ANCHOR_SEL] = anchor;
    const outside = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu" } });
    outside.click = () => {
      outside.clicked += 1;
    };
    doc.map["button[aria-haspopup]"] = [outside];
    return { doc, trigger, imageOpt, outside };
  }

  // 1+3 — "Generate Image" label is NOT strong IMAGE evidence.
  await t("v1E2A Generate label alone never verifies IMAGE; telemetry only", () => {
    const doc = prepareablePage();
    delete doc.map[S("MODE_IMAGE")].attrs["aria-selected"];
    doc.map[S("GENERATE_BUTTON")].attrs["aria-label"] = "Generate Image";
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "UNKNOWN" && d.verified === false, `Generate label verified IMAGE: ${d.type}/${d.verified}`);
    const gl = d.evidence.find((e) => e.source === "generate-label");
    assert(gl && gl.informational === true, "generate-label appears as informational evidence only");
    assert(!d.evidence.some((e) => e.source === "generate-label" && e.informational !== true), "no strong generate-label evidence entry");
  });

  // 2 — VIDEO selected stays VIDEO even with a "Generate Image" label.
  await t("v1E2A VIDEO selected remains VIDEO despite Generate Image label", () => {
    const doc = prepareablePage();
    delete doc.map[S("MODE_IMAGE")].attrs["aria-selected"];
    doc.map[S("MODE_VIDEO")].attrs["aria-selected"] = "true";
    doc.map[S("GENERATE_BUTTON")].attrs["aria-label"] = "Generate Image";
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "VIDEO" && d.verified === true, `expected VIDEO, got ${d.type}`);
    assert(d.type !== "IMAGE", "Generate label must not override selected semantics");
  });

  // 4 — no candidate in the composer → NOT_FOUND, page button never clicked.
  await t("v1E2A no composer candidate → NOT_FOUND; page controls never probed", async () => {
    const { doc, outside } = anchoredComposerPage({ withTrigger: false });
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 60, verifyTimeoutMs: 60 });
    } catch (e) {
      err = String((e && e.message) || e);
    }
    assert(err && err.startsWith("GENERATION_TRIGGER_NOT_FOUND"), `got: ${err}`);
    assert(outside.clicked === 0, "page-level button outside composer must never be clicked");
  });

  // 5 — composer-adjacent verified settings trigger still resolves.
  await t("v1E2A verified settings trigger inside composer still resolves", async () => {
    const { doc, trigger, imageOpt, outside } = anchoredComposerPage({ withTrigger: true });
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.ok === true && r.verified === true && r.method === "generation-menu", `got ${r.method}`);
    assert(r.trigger && r.trigger.accessibleName === "Generation settings", "in-composer trigger used");
    assert(trigger.clicked === 1 && imageOpt.clicked === 1, "exactly one trigger + one choice click");
    assert(outside.clicked === 0, "page decoy untouched");
  });

  // 6 — probing remains bounded (composer scope + hard candidate cap).
  await t("v1E2A probing stays bounded in composer scope", () => {
    const { doc } = anchoredComposerPage({ withTrigger: false });
    const cands = adapter.findGenerationTriggerCandidates(doc, null);
    assert(cands.length === 0, "composer without trigger yields no candidates");
    assert(adapter.GENERATION_TRIGGER_MAX <= 6, "candidate cap enforced");
  });

  /* ---------- POST-v1E.2B: trigger misclassification + cleanup + notifications ---------- */

  const fs = require("fs");
  const Toast = require("../src/ui/toast");

  function assetPickerSurface() {
    const picker = new FakeElement({ tag: "div", attrs: { role: "dialog", "aria-label": "Upload media" } });
    const items = ["Search assets", "All", "Images", "Videos", "Voices", "Characters", "Avatars", "Uploads", "Upload media"].map(
      (n) => new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": n } })
    );
    picker.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? items : []);
    return picker;
  }

  function escapeCloser(doc, keys) {
    doc.dispatchEvent = (evt) => {
      if (evt && evt.type === "keydown" && evt.key === "Escape") {
        for (const k of keys) delete doc.map[k];
      }
    };
  }

  function menuTriggerFixture(doc, name = "Generation settings") {
    const trigger = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu", "aria-label": name } });
    const imageOpt = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } });
    const videoOpt = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } });
    const menuSurface = new FakeElement({ tag: "div", attrs: { role: "menu" } });
    menuSurface.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [imageOpt, videoOpt] : []);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map['[role="menu"]'] = menuSurface;
    };
    imageOpt.click = () => {
      imageOpt.clicked += 1;
      imageOpt.attrs["aria-selected"] = "true";
    };
    return { trigger, imageOpt, videoOpt };
  }

  // 1 — asset/reference candidate excluded BEFORE any interactive probing.
  await t("v1E2B asset candidate excluded; generation trigger probed; Generate untouched", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const genBtn = new FakeElement({ tag: "button" });
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    const assetBtn = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu", "aria-label": "Add media" } });
    assetBtn.click = () => {
      assetBtn.clicked += 1;
      doc.map['[role="dialog"]'] = assetPickerSurface();
    };
    const { trigger, imageOpt } = menuTriggerFixture(doc);
    doc.map["button[aria-haspopup]"] = [assetBtn, trigger];
    assert(adapter.classifyGenerationTrigger({ accessibleName: "Add media" }) === "ASSET_REFERENCE", "asset semantics classified");
    const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 300, verifyTimeoutMs: 300 });
    assert(r.ok === true && r.verified === true, `got ${r.method}`);
    assert(assetBtn.clicked === 0, "asset/reference candidate never clicked");
    assert(trigger.clicked === 1 && imageOpt.clicked === 1, "generation trigger probed once");
    assert(genBtn.clicked === 0, "Generate never clicked");
    assert(r.trigger.category === "GENERATION_SETTINGS", `trigger category recorded: ${r.trigger.category}`);
  });

  // 2 — asset picker surface (Images/Videos plural) is NOT a generation menu.
  await t("v1E2B asset picker surface never produces generation state", () => {
    const doc = new FakeDocument({});
    doc.map['[role="dialog"]'] = assetPickerSurface();
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "UNKNOWN" && d.verified === false, `asset picker verified generation: ${d.type}/${d.verified}`);
    const cls = adapter.classifySurface(new FakeElement({ tag: "div" }), {
      image: null,
      video: null,
      names: ["Search assets", "All", "Images", "Videos", "Voices", "Characters", "Avatars", "Uploads", "Upload media"],
    });
    assert(cls === "ASSET_PICKER", `classification: ${cls}`);
  });

  // 3 — wrong candidate opens the Asset Picker → closed → next probed.
  await t("v1E2B asset picker opened by wrong candidate is closed; next candidate resolves", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const wrong = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
    wrong.click = () => {
      wrong.clicked += 1;
      doc.map['[role="dialog"]'] = assetPickerSurface();
    };
    const { trigger } = menuTriggerFixture(doc);
    doc.map["button[aria-haspopup]"] = [wrong, trigger];
    const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 300, verifyTimeoutMs: 300 });
    assert(r.verified === true, "resolved via the next candidate");
    assert(wrong.clicked === 1 && trigger.clicked === 1, "wrong probed once, then real trigger");
    assert(!doc.map['[role="dialog"]'], "asset picker closed");
  });

  // 4 — Escape closes the wrong modal (final state: precise error, no leak).
  await t("v1E2B Escape closes wrong modal; GENERATION_WRONG_SURFACE reported", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const { trigger } = menuTriggerFixture(doc);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map['[role="dialog"]'] = assetPickerSurface();
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `got: ${err}`);
    assert(!doc.map['[role="dialog"]'], "picker not left open");
    assert(err.diagnostics && Array.isArray(err.diagnostics.attempts), "attempt diagnostics recorded");
  });

  // 5 — surface-local Close button cleanup path (Escape unavailable).
  await t("v1E2B surface-local Close button cleanup", async () => {
    const doc = new FakeDocument({}); // no dispatchEvent → Escape unavailable
    const { trigger } = menuTriggerFixture(doc);
    const picker = assetPickerSurface();
    const closeBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Close" } });
    closeBtn.click = () => {
      delete doc.map['[role="dialog"]'];
    };
    picker.querySelector = (sel) => (/close/i.test(sel) ? closeBtn : null);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map['[role="dialog"]'] = picker;
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200, cleanupTimeoutMs: 400 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `close-button cleanup failed: ${err}`);
    assert(!doc.map['[role="dialog"]'], "surface closed via its own Close button");
  });

  // 6 — cleanup failure stops probing with GENERATION_PROBE_CLEANUP_FAILED.
  await t("v1E2B cleanup failure stops with GENERATION_PROBE_CLEANUP_FAILED", async () => {
    const doc = new FakeDocument({}); // no Escape, no close button
    const { trigger } = menuTriggerFixture(doc);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map['[role="dialog"]'] = assetPickerSurface();
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 100, verifyTimeoutMs: 100, cleanupTimeoutMs: 120 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_PROBE_CLEANUP_FAILED"), `got: ${err}`);
    assert(doc.map['[role="dialog"]'], "uncloseable surface still open — probing stopped");
  });

  // 7 — the wait-timeout path still performs cleanup and continues.
  await t("v1E2B timeout path still cleans up the unclassified surface", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const unknown = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
    unknown.click = () => {
      unknown.clicked += 1;
      const plain = new FakeElement({ tag: "div", attrs: { role: "dialog" } });
      plain.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Whisk" } })] : []);
      doc.map['[role="dialog"]'] = plain;
    };
    const { trigger } = menuTriggerFixture(doc);
    doc.map["button[aria-haspopup]"] = [unknown, trigger];
    const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 100, verifyTimeoutMs: 200 });
    assert(r.verified === true, "resolution continued to the real trigger");
    assert(unknown.clicked === 1 && trigger.clicked === 1, "both candidates probed in order");
    assert(!doc.map['[role="dialog"]'], "unclassified surface cleaned up after timeout");
  });

  // 8 — a pre-existing dialog is never mistaken for a newly opened surface.
  await t("v1E2B pre-existing dialog not mistaken for probe surface", async () => {
    const { doc, trigger } = generationMenuPage();
    const preExisting = new FakeElement({ tag: "div", attrs: { role: "dialog", "aria-label": "Pre-existing" } });
    preExisting.querySelectorAll = (sel) =>
      sel === '[role="menuitem"]'
        ? [new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } }), new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } })]
        : [];
    doc.map['[role="dialog"]'] = preExisting;
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.verified === true, "verified via the NEWLY opened menu");
    assert(doc.map['[role="dialog"]'] === preExisting, "pre-existing surface never closed or consumed");
  });

  // 9 — settings candidate next to Generate ranks above unrelated candidate.
  await t("v1E2B ranking: settings+proximity candidate first", () => {
    const doc = new FakeDocument({});
    const genBtn = new FakeElement({ tag: "button" });
    const toolbar = new FakeElement({ tag: "div" });
    genBtn.parentElement = toolbar;
    const settingsBtn = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu", "aria-label": "Generation settings" } });
    settingsBtn.parentElement = toolbar;
    const unrelated = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "menu", "aria-label": "Extras" } });
    unrelated.parentElement = new FakeElement({ tag: "div" });
    doc.map["button[aria-haspopup]"] = [unrelated, settingsBtn];
    const cands = adapter.findGenerationTriggerCandidates(doc, genBtn);
    assert(cands[0].accessibleName === "Generation settings", `ranking first: ${cands[0].accessibleName}`);
    assert(cands[0].rankingSignals.includes("near-generate"), "proximity signal recorded");
    assert(cands[1].accessibleName === "Extras", "unrelated candidate ranked below");
  });

  // 10 — proximity alone never verifies a generation trigger.
  await t("v1E2B proximity alone does not verify", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const genBtn = new FakeElement({ tag: "button" });
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    const near = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Extras" } });
    near.parentElement = genBtn.parentElement = new FakeElement({ tag: "div" });
    doc.map["button[aria-haspopup]"] = [near];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 80, verifyTimeoutMs: 80, cleanupTimeoutMs: 100 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_SURFACE_NOT_RESOLVED"), `got: ${err}`);
  });

  // 11 — no positional/index/coordinate dependency in adapter CODE (comments excluded).
  await t("v1E2B no nth-child/index/coordinate dependency", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "content", "flow-page-adapter.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    assert(!/nth-child|nth-last-child|getBoundingClientRect|clientX|clientY|offsetX|offsetY/.test(code), "positional selectors/coordinates forbidden");
  });

  /* ---------- POST-v1E.2B: preparation notification lifecycle (tests 15–24) ---------- */

  function makeToastHost() {
    const children = [];
    const host = {
      children,
      appendChild(c) {
        children.push(c);
      },
      removeChild(c) {
        const i = children.indexOf(c);
        if (i >= 0) children.splice(i, 1);
      },
    };
    const createEl = (cls, text) => ({
      className: cls,
      toastText: text,
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      getAttribute(k) {
        return this.attrs[k] || null;
      },
      appendChild() {},
      remove() {
        const i = children.indexOf(this);
        if (i >= 0) children.splice(i, 1);
      },
    });
    return { host, createEl, children };
  }

  const keyed = (children) => children.filter((c) => c.attrs && c.attrs["data-toast-key"] === Toast.PREP_STATUS_KEY);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 15+21 — retry shows exactly one persistent preparing notification; no stacking.
  await t("v1E2B retry → exactly one persistent Đang chuẩn bị… (no duplicate stacking)", () => {
    const { host, createEl, children } = makeToastHost();
    const st = Toast.createPreparationStatus(host, { createEl });
    st.begin();
    st.begin(); // user hammers Thử lại
    st.begin();
    assert(keyed(children).length === 1, `one keyed notification expected, got ${keyed(children).length}`);
    assert(keyed(children)[0].toastText === "Đang chuẩn bị…", "preparing text");
  });

  // 16+23 — no fixed timeout: the notification persists while the async op runs.
  await t("v1E2B preparing status persists with no auto-dismiss timer", async () => {
    const { host, createEl, children } = makeToastHost();
    const st = Toast.createPreparationStatus(host, { createEl });
    st.begin();
    await sleep(120);
    assert(st.isActive() && keyed(children).length === 1, "still visible while pending");
  });

  // 17+18 — intermediate info toasts (connection/job-loaded) never remove it.
  await t("v1E2B intermediate toasts never remove the preparation status", () => {
    const hadDocument = typeof globalThis.document !== "undefined";
    if (!hadDocument) {
      globalThis.document = {
        createElement: () => ({
          children: [],
          attrs: {},
          className: "",
          textContent: "",
          setAttribute(k, v) {
            this.attrs[k] = v;
          },
          getAttribute(k) {
            return this.attrs[k] || null;
          },
          appendChild(c) {
            this.children.push(c);
          },
          addEventListener() {},
          remove() {},
        }),
      };
    }
    try {
      const { host, createEl, children } = makeToastHost();
      const st = Toast.createPreparationStatus(host, { createEl });
      st.begin();
      Toast.showToast(host, "Đã kết nối Google Flow", "success", 0);
      Toast.showToast(host, "Đã tải công việc", "success", 0);
      Toast.showToast(host, "extra 3", "info", 0);
      Toast.showToast(host, "extra 4", "info", 0); // forces trim — keyed element must survive
      assert(keyed(children).length === 1 && keyed(children)[0].toastText === "Đang chuẩn bị…", "preparing status survived transient toasts + trim");
      assert(children.some((c) => c.attrs && c.attrs["data-toast-msg"]), "transient info toasts still render alongside");
    } finally {
      if (!hadDocument) delete globalThis.document;
    }
  });

  // 19+20+24 — terminal outcomes replace the preparing notification; nothing left behind.
  await t("v1E2B success/failure replace Đang chuẩn bị… with the terminal outcome", () => {
    const { host, createEl, children } = makeToastHost();
    const st = Toast.createPreparationStatus(host, { createEl });
    const id = st.begin();
    st.success(id);
    assert(keyed(children).length === 1 && keyed(children)[0].toastText === "Đã chuẩn bị xong", "success replacement");
    const id2 = st.begin();
    st.failure(id2);
    assert(keyed(children).length === 1 && keyed(children)[0].toastText === "Không thể hoàn tất chuẩn bị", "failure replacement");
    st.clear();
    assert(keyed(children).length === 0 && !st.isActive(), "nothing left behind after terminal state");
  });

  // 22 — stale attempt completion cannot touch the current attempt.
  await t("v1E2B stale retry attempt cannot close the current notification", () => {
    const { host, createEl, children } = makeToastHost();
    const st = Toast.createPreparationStatus(host, { createEl });
    const old = st.begin();
    st.begin(); // superseding retry
    assert(st.success(old) === false, "stale success ignored");
    assert(st.failure(old) === false, "stale failure ignored");
    assert(st.clear(old) === false, "stale clear ignored");
    assert(keyed(children).length === 1 && keyed(children)[0].toastText === "Đang chuẩn bị…", "current attempt notification intact");
  });

  // FIX: a job that needed no preparation must never paint a preparation
  // failure — opening the panel on an already-READY job repainted the red
  // banner every time (runPipeline fell through to prepStatus.failure).
  await t("prepToastAction: already-READY job clears the attempt (no phantom failure)", () => {
    assert(AutoPrepare.prepToastAction({ done: true }, "READY") === "clear", "READY + done → clear");
  });
  await t("prepToastAction: resumed/mapped outcomes clear, real failures fail", () => {
    assert(AutoPrepare.prepToastAction({ resumed: true, state: "PROCESSING" }, "PROCESSING") === "clear", "resumed → clear");
    assert(AutoPrepare.prepToastAction({ mapped: true }, "SYNC") === "clear", "mapped → clear");
    assert(AutoPrepare.prepToastAction({ prepared: false, code: "GENERATION_NOT_READY" }, "NEED_ATTENTION") === "failure", "attempted + not prepared → failure");
    assert(AutoPrepare.prepToastAction(null, "NEED_ATTENTION") === "failure", "missing outcome → failure (legacy)");
    assert(AutoPrepare.prepToastAction({ prepared: true }, "AWAITING_USER_APPROVAL") === "success", "awaiting approval → success");
  });

  /* ---------- POST-v1E.2C: portal surfaces + guaranteed rollback ---------- */

  let lastMutationObserver = null;
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      lastMutationObserver = this;
    }
    observe() {
      this.observing = true;
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  // 1+2 — a role-less portal overlay is owned through the MutationObserver
  // and becomes the verified probe surface.
  await t("v1E2C portal without dialog role detected via MutationObserver", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
      const genBtn = new FakeElement({ tag: "button" });
      doc.map[S("GENERATE_BUTTON")] = genBtn;
      const { trigger } = menuTriggerFixture(doc);
      const portal = new FakeElement({ tag: "div" }); // no role anywhere
      portal.__connected = true; // portal lives under document.body
      const pImg = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } });
      const pVid = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } });
      portal.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [pImg, pVid] : []);
      pImg.click = () => {
        pImg.clicked += 1;
        pImg.attrs["aria-selected"] = "true";
      };
      let captureObs = null;
      trigger.click = () => {
        trigger.clicked += 1;
        captureObs = lastMutationObserver;
        captureObs.cb([{ addedNodes: [portal] }]);
      };
      doc.map["button[aria-haspopup]"] = [trigger];
      await withDocumentShim(async () => {
        const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 300, verifyTimeoutMs: 300 });
        assert(r.ok === true && r.verified === true && r.method === "generation-menu", `got ${r.method}`);
        assert(r.menu.resolutionSource === "MUTATION", `source: ${r.menu.resolutionSource}`);
      });
      assert(captureObs && captureObs.observing === true, "observer attached during probe");
      assert(captureObs.disconnected === true, "observer always stopped (finally)");
      assert(genBtn.clicked === 0, "Generate never clicked");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // 3 — a pre-existing portal is never considered opened by the probe.
  await t("v1E2C pre-existing portal ignored; new menu used", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
      const prePortal = new FakeElement({ tag: "div" });
      prePortal.querySelectorAll = (sel) =>
        sel === '[role="menuitem"]'
          ? [new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } }), new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } })]
          : [];
      doc.map["div.portal"] = prePortal;
      const { trigger } = menuTriggerFixture(doc);
      doc.map["button[aria-haspopup]"] = [trigger];
      const r = await adapter.selectGenerationType(doc, "IMAGE");
      assert(r.verified === true && r.menu.resolutionSource === "ARIA", `got ${r.menu.resolutionSource}`);
      assert(doc.map["div.portal"] === prePortal, "pre-existing portal never consumed or closed");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // 4+8+9 — role-less Asset Picker classified via mutation ownership; Escape
  // cleanup verifies MARKER disappearance.
  await t("v1E2C role-less asset picker classified; Escape cleanup verifies markers", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      const container = new FakeElement({ tag: "div" }); // picker portal, no role
      container.__connected = true; // lives under document.body
      const items = ["Search assets", "All", "Images", "Videos", "Voices", "Characters", "Avatars", "Uploads", "Upload media"].map((n) => {
        const b = new FakeElement({ tag: "button", attrs: { "aria-label": n } });
        b.parentElement = container;
        return b;
      });
      container.querySelectorAll = (sel) => (sel === "button" ? items : []);
      doc.map["button"] = items;
      doc.dispatchEvent = (evt) => {
        if (evt && evt.type === "keydown" && evt.key === "Escape") {
          delete doc.map["button"];
          container.__connected = false; // Escape removes the portal
        }
      };
      const wrong = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
      wrong.click = () => {
        wrong.clicked += 1;
        lastMutationObserver.cb([{ addedNodes: [container] }]);
      };
      doc.map["button[aria-haspopup]"] = [wrong];
      let err = null;
      await withDocumentShim(async () => {
        try {
          await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
        } catch (e) {
          err = e;
        }
      });
      assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `got: ${err}`);
      assert(wrong.clicked === 1, "probed exactly once");
      assert(items.every((b) => b.clicked === 0), "picker items never clicked");
      assert(adapter.findMarkerContainer(doc) === null, "cleanup verified marker disappearance");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // 5+6 — observe-only page-wide fallback works with ZERO extra clicks.
  await t("v1E2C observe-only asset picker fallback (zero clicks)", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ["button"]);
      const container = new FakeElement({ tag: "div" });
      const markerNames = ["Search assets", "All", "Images", "Videos", "Voices", "Characters", "Avatars", "Uploads", "Upload media"];
      const markerBtns = markerNames.map((n) => {
        const b = new FakeElement({ tag: "button", attrs: { "aria-label": n } });
        b.parentElement = container;
        return b;
      });
      doc.map["button"] = markerBtns;
      const trigger = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
      doc.map["button[aria-haspopup]"] = [trigger];
      let err = null;
      try {
        await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 120, verifyTimeoutMs: 100 });
      } catch (e) {
        err = e;
      }
      assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `got: ${err}`);
      assert(err.probeLog.some((l) => l.includes("resolutionSource=OBSERVE_FALLBACK")), "fallback source in probe log");
      assert(trigger.clicked === 1, "candidate probed once");
      assert(markerBtns.every((b) => b.clicked === 0), "observe-only fallback performed zero clicks");
      assert(adapter.findMarkerContainer(doc) === null, "markers gone after cleanup");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // 7 — unresolved surface still enters rollback (nothing leaks).
  await t("v1E2C unresolved semantic surface still rolled back", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="dialog"]', '[role="menu"]']);
    const { trigger } = menuTriggerFixture(doc);
    trigger.click = () => {
      trigger.clicked += 1;
      const plain = new FakeElement({ tag: "div", attrs: { role: "dialog" } });
      plain.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Whisk" } })] : []);
      doc.map['[role="dialog"]'] = plain;
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 120, verifyTimeoutMs: 100 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_SURFACE_NOT_RESOLVED"), `got: ${err}`);
    assert(!doc.map['[role="dialog"]'], "unresolved surface still closed (rollback ran)");
  });

  // 10 — failed cleanup stops immediately with GENERATION_PROBE_CLEANUP_FAILED.
  await t("v1E2C failed cleanup stops with GENERATION_PROBE_CLEANUP_FAILED", async () => {
    const doc = new FakeDocument({}); // no Escape, no close button
    const container = new FakeElement({ tag: "div" });
    const markerBtns = ["Search assets", "Upload media", "Voices", "Characters"].map((n) => {
      const b = new FakeElement({ tag: "button", attrs: { "aria-label": n } });
      b.parentElement = container;
      return b;
    });
    doc.map["button"] = markerBtns;
    const trigger = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 120, verifyTimeoutMs: 100, cleanupTimeoutMs: 150 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_PROBE_CLEANUP_FAILED"), `got: ${err}`);
    assert(adapter.findMarkerContainer(doc) !== null, "markers still visible — probing stopped");
  });

  // 11+12 — confirmed Asset Picker candidate not retried; wrong cleanup then
  // valid settings candidate succeeds.
  await t("v1E2B wrong candidate closed, next candidate probed", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
      const wrong = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
      wrong.click = () => {
        wrong.clicked += 1;
        doc.map['[role="dialog"]'] = assetPickerSurface();
      };
      const { trigger } = menuTriggerFixture(doc);
      doc.map["button[aria-haspopup]"] = [wrong, trigger];
      const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
      assert(r.verified === true, "resolved via the next candidate");
      assert(wrong.clicked === 1 && trigger.clicked === 1, "wrong probed once, then real trigger");
      assert(!doc.map['[role="dialog"]'], "asset picker closed");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  await t("v1E2C negative evidence: picker candidate never re-probed in same run", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const picker = assetPickerSurface();
    const a = new FakeElement({ tag: "button", attrs: { "aria-haspopup": "true", "aria-label": "Generation settings" } });
    a.click = () => {
      a.clicked += 1;
      doc.map['[role="dialog"]'] = picker;
    };
    const { trigger } = menuTriggerFixture(doc);
    doc.map["button[aria-haspopup]"] = [a, trigger];
    const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
    assert(r.verified === true, "valid candidate resolved after the wrong one");
    assert(a.clicked === 1 && trigger.clicked === 1, "each candidate probed at most once");
    assert(!doc.map['[role="dialog"]'], "picker closed between candidates");
  });

  // 13 — probe diagnostics appear in the developer log, not only error objects.
  await t("v1E2C probe diagnostics surfaced in developer log", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
      const { trigger } = menuTriggerFixture(doc);
      doc.map["button[aria-haspopup]"] = [trigger];
      const r = await adapter.selectGenerationType(doc, "IMAGE");
      for (const prefix of ["generationProbe:", "generationCandidate:", "generationMutation:", "openedSurface:", "cleanup:"]) {
        assert(r.probeLog.some((l) => l.startsWith(prefix)), `probe log missing ${prefix}: ${JSON.stringify(r.probeLog)}`);
      }
      const { prep, logs } = makePreparer({
        sendPrepare: async () => ({
          ok: true,
          prepared: true,
          stage: "readiness",
          missing: [],
          probeLogs: ["generationProbe: candidates=1", "openedSurface: resolved=true resolutionSource=ARIA classification=GENERATION_MENU"],
          generationState: { ready: true, missing: [], checks: {}, details: {} },
          clickedGenerate: false,
          creditsConsumed: false,
        }),
      });
      await prep.ensureCurrentJobPrepared({ ...PREPARED_JOB });
      assert(logs.some((l) => l === "generationProbe: candidates=1"), "probe diagnostics in developer log");
      assert(logs.some((l) => l.includes("openedSurface: resolved=true")), "surface diagnostics in developer log");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  /* ---------- POST-v1E.2D: composer toolbar discovery + model gate ---------- */

  function toolbarPage({ withSettings = true, withAdd = true } = {}) {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]', "button"]);
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Generate" } });
    const addBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "add", "aria-haspopup": "true" } });
    addBtn.click = () => {
      addBtn.clicked += 1;
      doc.map['[role="dialog"]'] = assetPickerSurface();
    };
    const settingsBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } }); // NO aria-haspopup
    settingsBtn.click = () => {
      settingsBtn.clicked += 1;
      const menu = new FakeElement({ tag: "div", attrs: { role: "menu" } });
      const img = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Image" } });
      const vid = new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Video" } });
      menu.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [img, vid] : []);
      img.click = () => {
        img.clicked += 1;
        img.attrs["aria-selected"] = "true";
      };
      doc.map['[role="menu"]'] = menu;
    };
    const toolbar = new FakeElement({ tag: "div" });
    const buttons = [addBtn, settingsBtn, genBtn].filter((b, i) => (i === 0 ? withAdd : i === 1 ? withSettings : true));
    toolbar.querySelectorAll = (sel) => (sel === "button" ? buttons : []);
    for (const b of buttons) b.parentElement = toolbar;
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    return { doc, toolbar, addBtn, settingsBtn, genBtn };
  }

  // 1+2+13+17 — toolbar inventory observes every control; the settings button
  // WITHOUT aria-haspopup is still eligible and resolves the verified menu.
  await t("v1E2D toolbar inventory + settings eligible without hasPopup", async () => {
    const { doc, addBtn, settingsBtn, genBtn } = toolbarPage();
    const cands = adapter.findGenerationTriggerCandidates(doc, genBtn);
    assert(cands.toolbarFound === true && cands.toolbarControlCount === 3, `toolbar: ${cands.toolbarFound}/${cands.toolbarControlCount}`);
    assert(cands.toolbarLog.some((l) => l.startsWith("composerToolbar: found=true")), "toolbar log line");
    assert(cands.some((c) => c.accessibleName === "Settings" && c.category === "GENERATION_SETTINGS"), "settings candidate eligible");
    const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 300, verifyTimeoutMs: 300 });
    assert(r.ok === true && r.verified === true && r.method === "generation-menu", `got ${r.method}`);
    assert(settingsBtn.clicked === 1 && addBtn.clicked === 0, "settings probed first; add untouched");
    assert(genBtn.clicked === 0, "Generate never clicked");
    assert(r.probeLog.some((l) => l.includes("exclusionReason=generate-control")), "Generate excluded in inventory");
    assert(r.switch.attempted === true && r.switch.verified === true, "switch tracked");
  });

  // 3+4 — the "add" control opens the Asset Picker → runtime reclassified
  // ASSET_REFERENCE and never probed again in the session.
  await t("v1E2D add control runtime-reclassified and never re-probed", async () => {
    const { doc, addBtn } = toolbarPage({ withSettings: false });
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `got: ${err}`);
    assert(addBtn.clicked === 1, "probed once");
    assert(err.diagnostics.attempts[0].category === "ASSET_REFERENCE", "runtime reclassification recorded");
    let err2 = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 100, verifyTimeoutMs: 100 });
    } catch (e) {
      err2 = e;
    }
    assert(err2 && String(err2.message).startsWith("GENERATION_TRIGGER_NOT_FOUND"), `got: ${err2}`);
    assert(addBtn.clicked === 1, "never probed again");
  });

  // 5+6 — marker extraction: placeholder + deep descendants resolve a common container.
  await t("v1E2D placeholder + deep descendants resolve asset picker container", () => {
    const doc = new FakeDocument({});
    const container = new FakeElement({ tag: "div" });
    const search = new FakeElement({ tag: "input", attrs: { placeholder: "Search assets" } });
    search.parentElement = container;
    let node = container;
    for (let i = 0; i < 10; i++) {
      const parent = new FakeElement({ tag: "div" });
      node.parentElement = parent;
      node = parent;
    }
    const upload = new FakeElement({ tag: "button", attrs: { "aria-label": "Upload media" } });
    upload.parentElement = node;
    doc.map["button"] = [upload];
    doc.map["input"] = [search];
    const found = adapter.findMarkerContainer(doc);
    assert(found && found.surface === node, "common deep container resolved");
    const clean = new FakeDocument({});
    assert(adapter.findMarkerContainer(clean) === null, "no markers → no container");
  });

  // 7 — plural Images/Videos are asset-picker markers, never generation choices.
  await t("v1E2D plural Images/Videos never become Image/Video choices", () => {
    const doc = new FakeDocument({});
    const picker = new FakeElement({ tag: "div", attrs: { role: "dialog" } });
    picker.querySelectorAll = (sel) =>
      sel === '[role="menuitem"]'
        ? [new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Images" } }), new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Videos" } }), new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Voices" } }), new FakeElement({ tag: "div", attrs: { role: "menuitem", "aria-label": "Uploads" } })]
        : [];
    doc.map['[role="dialog"]'] = picker;
    const d = adapter.detectGenerationType(doc);
    assert(d.type === "UNKNOWN" && d.verified === false, `plural verified generation: ${d.type}`);
    const cls = adapter.classifySurface(picker, { image: null, video: null, names: ["Images", "Videos", "Voices", "Uploads"] });
    assert(cls === "ASSET_PICKER", `classification: ${cls}`);
  });

  // 8+10 — Escape closes a role-less marker-based Asset Picker; cleanup
  // verified with method=ESCAPE.
  await t("v1E2D Escape closes role-less asset picker; cleanup verified", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ["button", '[role="menu"]', '[role="dialog"]']);
    const container = new FakeElement({ tag: "div" });
    const markerBtns = ["Search assets", "Upload media", "Voices", "Characters"].map((n) => {
      const b = new FakeElement({ tag: "button", attrs: { "aria-label": n } });
      b.parentElement = container;
      return b;
    });
    const { trigger } = menuTriggerFixture(doc);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map["button"] = markerBtns; // picker appears during the probe
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 150, verifyTimeoutMs: 150 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `got: ${err}`);
    assert(err.probeLog.some((l) => l.includes("method=ESCAPE verifiedClosed=true")), `cleanup: ${err.probeLog.filter((l) => l.startsWith("cleanup:")).join(" | ")}`);
    assert(adapter.findMarkerContainer(doc) === null, "markers gone after cleanup");
  });

  // 9 — mutation-owned visible artifact forces cleanup attempts.
  await t("v1E2D mutation-owned artifact causes cleanup attempts", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
      const { trigger } = menuTriggerFixture(doc);
      trigger.click = () => {
        trigger.clicked += 1;
        lastMutationObserver.cb([{ addedNodes: [new FakeElement({ tag: "div" })] }]); // inert portal
      };
      doc.map["button[aria-haspopup]"] = [trigger];
      let err = null;
      try {
        await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 120, verifyTimeoutMs: 100 });
      } catch (e) {
        err = e;
      }
      assert(err && String(err.message).startsWith("GENERATION_SURFACE_NOT_RESOLVED"), `got: ${err}`);
      assert(err.probeLog.some((l) => l.includes("addedNodeCount=1")), "mutation recorded");
      assert(err.probeLog.some((l) => l.startsWith("cleanup: attempted=true")), "cleanup attempted");
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // 11 — a leaked picker (markers remain, no escape possible) fails cleanup.
  await t("v1E2D leaked picker → GENERATION_PROBE_CLEANUP_FAILED", async () => {
    const doc = new FakeDocument({}); // no Escape capability
    const container = new FakeElement({ tag: "div" });
    const markerBtns = ["Search assets", "Upload media", "Voices", "Characters"].map((n) => {
      const b = new FakeElement({ tag: "button", attrs: { "aria-label": n } });
      b.parentElement = container;
      return b;
    });
    const { trigger } = menuTriggerFixture(doc);
    trigger.click = () => {
      trigger.clicked += 1;
      doc.map["button"] = markerBtns;
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 120, verifyTimeoutMs: 100, cleanupTimeoutMs: 150 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_PROBE_CLEANUP_FAILED"), `got: ${err}`);
    assert(adapter.findMarkerContainer(doc) !== null, "leaked picker detected — no false pass");
  });

  // 12 — clean rollback lets the next toolbar candidate succeed.
  await t("v1E2D clean rollback allows next toolbar candidate", async () => {
    const { doc, addBtn, settingsBtn } = toolbarPage({ withSettings: true });
    settingsBtn.attrs["aria-label"] = "Options"; // equalize ranking → add probed first
    const r = await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 300, verifyTimeoutMs: 300 });
    assert(r.verified === true, `resolved after rollback, got ${r.method}`);
    assert(addBtn.clicked === 1 && settingsBtn.clicked === 1, "add rolled back, next candidate probed");
    assert(!doc.map['[role="dialog"]'], "picker closed between candidates");
  });

  // 14 — already-selected IMAGE tracked separately from switching.
  await t("v1E2D already-selected detection separate from switching", async () => {
    const doc = prepareablePage();
    const r = await adapter.selectGenerationType(doc, "IMAGE");
    assert(r.method === "already-selected" && r.switch.attempted === false && r.detection.method === "already-selected", "no switching claimed");
    assert(r.probeLog.some((l) => l.includes("generationTypeSwitch: attempted=false")), "switch=false logged");
  });

  // 15+16 — modelLabel only from verified model-semantic evidence.
  await t("v1E2D generic dropdown text never becomes modelLabel", () => {
    const doc = new FakeDocument({});
    doc.map['button[aria-haspopup="listbox"]'] = new FakeElement({ tag: "button", attrs: { "aria-label": "Sep 28 - 20:48" } });
    const diag = adapter.buildLiveDiagnostics(doc, {});
    assert(diag.modelLabel === "UNKNOWN", `model gate: ${diag.modelLabel}`);
    const doc2 = new FakeDocument({});
    doc2.map['[data-testid="flow-model-control"]'] = new FakeElement({ tag: "button", attrs: { "aria-label": "Veo 3.1" } });
    assert(adapter.buildLiveDiagnostics(doc2, {}).modelLabel === "Veo 3.1", "verified model control still populates");
  });

  /* ---------- POST-v1E.2D-A: portal cleanup containment safety ---------- */

  // Fixture: composerRoot > toolbar(+trigger); the Asset Picker portal lives
  // under document.body OUTSIDE the composer root (root.contains === false).
  function portalCleanupFixture() {
    const doc = new FakeDocument({});
    const portal = new FakeElement({ tag: "div" });
    portal.__connected = true; // document-level connectivity (shim below)
    const items = ["Search assets", "Upload media", "Voices", "Characters"].map((n) => {
      const b = new FakeElement({ tag: "button", attrs: { "aria-label": n } });
      b.parentElement = portal;
      return b;
    });
    portal.querySelectorAll = (sel) => (sel === "button" ? items : []);
    const genBtn = new FakeElement({ tag: "button" });
    const composerRoot = new FakeElement({ tag: "div" });
    genBtn.parentElement = composerRoot;
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    const { trigger } = menuTriggerFixture(doc);
    trigger.parentElement = composerRoot;
    trigger.click = () => {
      trigger.clicked += 1;
      lastMutationObserver.cb([{ addedNodes: [portal] }]);
    };
    doc.map["button[aria-haspopup]"] = [trigger];
    return { doc, portal, composerRoot };
  }

  async function withDocumentShim(fn) {
    const hadDocument = typeof globalThis.document !== "undefined";
    const prevDocument = globalThis.document;
    try {
      globalThis.document = {
        contains: (el) => Boolean(el && el.__connected === true),
      };
      return await fn(); // shim must live through the whole async operation
    } finally {
      if (hadDocument) globalThis.document = prevDocument;
      else delete globalThis.document;
    }
  }

  // Regression 1 — portal connected+visible OUTSIDE the composer root stays
  // "present": composerRoot.contains(portal)===false must NOT imply gone.
  await t("v1E2DA external connected portal → GENERATION_PROBE_CLEANUP_FAILED", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const { doc, portal, composerRoot } = portalCleanupFixture();
      assert(!portal.parentElement && portal.__connected === true, "portal lives under document.body, outside the composer tree");
      let err = null;
      await withDocumentShim(async () => {
        try {
          await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200, cleanupTimeoutMs: 200 });
        } catch (e) {
          err = e;
        }
      });
      assert(err && String(err.message).startsWith("GENERATION_PROBE_CLEANUP_FAILED"), `got: ${err}`);
      assert(err.probeLog.some((l) => l.includes("verifiedClosed=false")), `cleanup false-passed: ${err.probeLog.filter((l) => l.startsWith("cleanup:")).join(" | ")}`);
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // Regression 2 — same external portal, Escape successfully hides it.
  await t("v1E2DA Escape hiding the external portal verifies cleanup", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const { doc, portal } = portalCleanupFixture();
      doc.dispatchEvent = (evt) => {
        if (evt && evt.type === "keydown" && evt.key === "Escape") portal.__connected = false; // Escape hides the portal
      };
      let err = null;
      await withDocumentShim(async () => {
        try {
          await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
        } catch (e) {
          err = e;
        }
      });
      assert(err && String(err.message).startsWith("GENERATION_WRONG_SURFACE"), `got: ${err}`);
      assert(err.probeLog.some((l) => l.includes("method=ESCAPE verifiedClosed=true")), `cleanup: ${err.probeLog.filter((l) => l.startsWith("cleanup:")).join(" | ")}`);
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // Regression 3 — a disconnected stale portal node is correctly gone.
  await t("v1E2DA disconnected stale portal is considered gone", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const { doc, portal } = portalCleanupFixture();
      portal.isConnected = false; // stale node already detached
      let err = null;
      await withDocumentShim(async () => {
        try {
          await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
        } catch (e) {
          err = e;
        }
      });
      // The stale node is never classified (invisible containers are skipped)
      // and cleanup trivially verifies — nothing is attributed to it.
      assert(err && String(err.message).startsWith("GENERATION_SURFACE_NOT_RESOLVED"), `got: ${err}`);
      assert(err.probeLog.some((l) => l.includes("verifiedClosed=true")), `stale node treated as gone: ${err.probeLog.filter((l) => l.startsWith("cleanup:")).join(" | ")}`);
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  /* ---------- POST-v1E.2E: candidate identity + side-effect safety ---------- */

  function identityToolbarPage() {
    const doc = new FakeDocument({});
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Start generation" } });
    const tune = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } });
    tune.textContent = "tune"; // material icon ligature
    const synthetic = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings trigger" } });
    const agent = new FakeElement({ tag: "button", attrs: { "aria-label": "Agent instructions" } });
    agent.textContent = "article_spark"; // material icon ligature
    agent.click = () => {
      agent.clicked += 1;
    };
    const toolbar = new FakeElement({ tag: "div" });
    toolbar.querySelectorAll = (sel) => (sel === "button" ? [tune, synthetic, agent, genBtn] : []);
    [tune, synthetic, agent, genBtn].forEach((b) => (b.parentElement = toolbar));
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    return { doc, tune, synthetic, agent, genBtn };
  }

  // 1+3 — icon text "tune" + ariaLabel "Settings" yields generation-settings
  // candidate evidence sourced from aria-label; sources are logged.
  await t("v1E2E iconText=tune + ariaLabel=Settings → settings candidate with evidence", () => {
    const { doc, tune, genBtn } = identityToolbarPage();
    const cands = adapter.findGenerationTriggerCandidates(doc, genBtn);
    const settingsCand = cands.find((c) => c.accessibleName === "Settings");
    assert(settingsCand, "settings candidate found despite icon text");
    assert(settingsCand.category === "GENERATION_SETTINGS", `category: ${settingsCand.category}`);
    assert(settingsCand.categoryEvidence && settingsCand.categoryEvidence.source === "aria-label" && settingsCand.categoryEvidence.value === "Settings", `evidence: ${JSON.stringify(settingsCand.categoryEvidence)}`);
    assert(settingsCand.iconText === "tune", "icon text recorded separately");
    assert(cands.toolbarLog.some((l) => l.includes("nameSource=aria-label") && l.includes('iconText="tune"') && l.includes("categoryEvidence=aria-label:Settings")), "semantic source logged");
    void genBtn;
  });

  // 2 — real ariaLabel=Settings outranks a compound/inferred "Settings trigger".
  await t("v1E2E real Settings ranks above synthetic Settings trigger", () => {
    const { doc, genBtn } = identityToolbarPage();
    const cands = adapter.findGenerationTriggerCandidates(doc, genBtn);
    assert(cands[0].accessibleName === "Settings", `first: ${cands[0].accessibleName}`);
    assert(cands[1].accessibleName === "Settings trigger", "synthetic still a candidate, ranked lower");
  });

  // 4 — Agent Instructions is excluded, never probed before stronger candidates.
  await t("v1E2E Agent Instructions never probed", async () => {
    const { doc, agent, tune, synthetic } = identityToolbarPage();
    const genBtn = doc.map[S("GENERATE_BUTTON")];
    const cands = adapter.findGenerationTriggerCandidates(doc, genBtn);
    assert(!cands.some((c) => c.accessibleName === "Agent instructions"), "agent control not a candidate");
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 150, verifyTimeoutMs: 150 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_SURFACE_NOT_RESOLVED"), `got: ${err}`);
    assert(agent.clicked === 0 && tune.clicked === 1 && synthetic.clicked === 1, "agent skipped; other candidates probed");
  });

  // 5+6 — a probe that flips Start→Stop stops discovery immediately.
  await t("v1E2E Start→Stop side effect stops discovery (UNEXPECTED_GENERATION)", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]', "button"]);
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Start generation" } });
    const c1 = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } });
    c1.click = () => {
      c1.clicked += 1;
      genBtn.attrs["aria-label"] = "Stop"; // probe caused a running generation
    };
    const c2 = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } });
    const toolbar = new FakeElement({ tag: "div" });
    toolbar.querySelectorAll = (sel) => (sel === "button" ? [c1, c2, genBtn] : []);
    [c1, c2, genBtn].forEach((b) => (b.parentElement = toolbar));
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_PROBE_UNEXPECTED_GENERATION"), `got: ${err}`);
    assert(err.sideEffect.detected === true && err.sideEffect.cancellationAttempted === false, `sideEffect: ${JSON.stringify(err.sideEffect)}`);
    assert(c1.clicked === 1 && c2.clicked === 0, "discovery stopped — no further probing");
    assert(genBtn.clicked === 0, "Generate never clicked");
  });

  // 7 — a separate new Stop control is cancelled and the cancellation verifies.
  await t("v1E2E appeared Stop control is cancelled with verification", async () => {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]', "button"]);
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Start generation" } });
    const c1 = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } });
    c1.click = () => {
      c1.clicked += 1;
      const stop = new FakeElement({ tag: "button", attrs: { "aria-label": "Stop" } });
      stop.click = () => {
        doc.map["button"] = [];
      };
      doc.map["button"] = [stop]; // a separate Stop control appeared
    };
    const toolbar = new FakeElement({ tag: "div" });
    toolbar.querySelectorAll = (sel) => (sel === "button" ? [c1, genBtn] : []);
    [c1, genBtn].forEach((b) => (b.parentElement = toolbar));
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    let err = null;
    try {
      await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 200, verifyTimeoutMs: 200 });
    } catch (e) {
      err = e;
    }
    assert(err && String(err.message).startsWith("GENERATION_PROBE_UNEXPECTED_GENERATION"), `got: ${err}`);
    assert(err.sideEffect.stopControlAppeared === true && err.sideEffect.cancellationAttempted === true && err.sideEffect.cancellationVerified === true, `sideEffect: ${JSON.stringify(err.sideEffect)}`);
    assert(genBtn.clicked === 0, "Generate never clicked");
  });

  // 8 — ordinary re-render mutation containers remaining visible do NOT fail cleanup.
  await t("v1E2E inert re-render containers never fail cleanup", async () => {
    globalThis.MutationObserver = FakeMutationObserver;
    try {
      const doc = new FakeDocument({});
      escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
      const { trigger } = menuTriggerFixture(doc);
      trigger.click = () => {
        trigger.clicked += 1;
        lastMutationObserver.cb([{ addedNodes: [new FakeElement({ tag: "div" })] }]); // inert re-render node, stays "visible"
      };
      doc.map["button[aria-haspopup]"] = [trigger];
      let err = null;
      try {
        await adapter.selectGenerationType(doc, "IMAGE", { menuTimeoutMs: 120, verifyTimeoutMs: 100 });
      } catch (e) {
        err = e;
      }
      assert(err && String(err.message).startsWith("GENERATION_SURFACE_NOT_RESOLVED"), `got: ${err}`);
      assert(err.probeLog.some((l) => l.includes("verifiedClosed=true")), `cleanup verified: ${err.probeLog.filter((l) => l.startsWith("cleanup:")).join(" | ")}`);
    } finally {
      delete globalThis.MutationObserver;
    }
  });

  // 9 + 11 — real portal remaining visible still fails cleanup (2D-A suite
  // regression) and Generate is never clicked (asserted across the suite).
  /* ---------- POST-v1E.2F: Agent mode routing + Agent Settings preparation ---------- */

  function agentSettingsSurfaceFixture() {
    const surface = new FakeElement({ tag: "div", attrs: { role: "dialog" } });
    const mkOpt = (label, parent) => {
      const el = new FakeElement({ tag: "div", attrs: { role: "option", "aria-label": label } });
      if (parent) el.parentElement = parent;
      el.click = () => {
        el.clicked = (el.clicked || 0) + 1;
        el.attrs["aria-selected"] = "true"; // Flow updates selection on click
      };
      return el;
    };
    const heading = mkOpt("Agent settings");
    const confirmSection = new FakeElement({ tag: "div" });
    const confirmLabel = mkOpt("Confirm before generating", confirmSection);
    const always = mkOpt("Always", confirmSection);
    const never = mkOpt("Never", confirmSection);
    const imgSection = new FakeElement({ tag: "div" });
    const imgLabel = mkOpt("Image generation default", imgSection);
    const img169 = mkOpt("16:9", imgSection);
    const img43 = mkOpt("4:3", imgSection);
    const img11 = mkOpt("1:1", imgSection);
    const img34 = mkOpt("3:4", imgSection);
    const img916 = mkOpt("9:16", imgSection);
    const imgX1 = mkOpt("x1", imgSection);
    const imgX2 = mkOpt("x2", imgSection);
    const imgModel = mkOpt("model: Nano Banana 2", imgSection);
    const vidSection = new FakeElement({ tag: "div" });
    const vidLabel = mkOpt("Video generation default", vidSection);
    const vid169 = mkOpt("16:9", vidSection);
    const vid916 = mkOpt("9:16", vidSection);
    const vidX1 = mkOpt("x1", vidSection);
    const save = new FakeElement({ tag: "button", attrs: { "aria-label": "Save" } });
    save.parentElement = surface;
    const allOptions = [heading, confirmLabel, always, never, imgLabel, img169, img43, img11, img34, img916, imgX1, imgX2, imgModel, vidLabel, vid169, vid916, vidX1];
    surface.querySelectorAll = (sel) => (sel === '[role="option"]' ? allOptions : sel === "button" ? [save] : []);
    confirmSection.querySelectorAll = (sel) => (sel === '[role="option"]' ? [confirmLabel, always, never] : []);
    imgSection.querySelectorAll = (sel) => (sel === '[role="option"]' ? [imgLabel, img169, img43, img11, img34, img916, imgX1, imgX2, imgModel] : []);
    vidSection.querySelectorAll = (sel) => (sel === '[role="option"]' ? [vidLabel, vid169, vid916, vidX1] : []);
    [confirmSection, imgSection, vidSection].forEach((sec) => (sec.parentElement = surface));
    return { surface, always, never, img11, imgX1, vidX1, vid169, imgModel, save };
  }

  function agentFlowPage() {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Start generation" } });
    const agentCtl = new FakeElement({ tag: "button", attrs: { "aria-label": "Agent instructions" } });
    agentCtl.textContent = "article_spark";
    const settingsBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } });
    const surfaceF = agentSettingsSurfaceFixture();
    settingsBtn.click = () => {
      settingsBtn.clicked = (settingsBtn.clicked || 0) + 1;
      doc.map['[role="dialog"]'] = surfaceF.surface;
    };
    doc.map[S("PROMPT_INPUT")] = new FakeElement({ tag: "textarea", value: "" });
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    doc.map["button[aria-haspopup]"] = [settingsBtn];
    return { doc, settingsBtn, genBtn, agentCtl, ...surfaceF };
  }

  // 1 — Agent Instructions control + verified Agent Settings surface → AGENT.
  await t("v1E2F Agent Instructions + Agent Settings surface → flowMode AGENT", async () => {
    const { doc, agentCtl, settingsBtn } = agentFlowPage();
    const mode = await adapter.resolveFlowMode(doc, { menuTimeoutMs: 300 });
    assert(mode.value === "AGENT" && mode.verified === true, `mode: ${mode.value}/${mode.verified}`);
    assert(mode.evidence.includes("agent-settings-surface"), "settings-surface evidence");
    void agentCtl;
    void settingsBtn;
  });

  // 2 — random page text "Agent settings" outside the composer never verifies.
  await t("v1E2F page text alone never verifies AGENT mode", async () => {
    const doc = new FakeDocument({});
    const decoy = new FakeElement({ tag: "div" });
    decoy.textContent = "Agent settings";
    doc.map["div.random-text"] = decoy;
    const mode = await adapter.resolveFlowMode(doc, { menuTimeoutMs: 120 });
    assert(mode.value === "UNKNOWN" && mode.verified === false, `text verified mode: ${mode.value}`);
  });

  // 3 — Agent Settings surface classified correctly.
  await t("v1E2F AGENT_SETTINGS surface classification", () => {
    const { surface } = agentSettingsSurfaceFixture();
    assert(adapter.classifyAgentSettingsSurface(surface) === true, "agent settings markers");
    const cls = adapter.classifySurface(surface, { image: null, video: null, names: ["Agent settings", "Confirm before generating", "Image generation default", "Video generation default", "Save"] });
    assert(cls === "AGENT_SETTINGS", `classifySurface: ${cls}`);
  });

  // 4+12+15 — Agent mode skips the Standard Image/Video switch entirely and
  // readiness is READY without generationType=IMAGE; Start never clicked.
  await t("v1E2F AGENT mode skips Standard switch; READY without generationType", async () => {
    const { doc, genBtn, img11, imgX1, always } = agentFlowPage();
    const orig = adapter.selectGenerationType;
    adapter.selectGenerationType = () => {
      throw new Error("STANDARD_SWITCH_CALLED");
    };
    let res = null;
    try {
      res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    } finally {
      adapter.selectGenerationType = orig;
    }
    assert(res.ok === true && res.prepared === true, `prepared expected, got ${res.stage}/${res.code}`);
    assert(res.generationRoute && res.generationRoute.mode === "AGENT" && res.generationRoute.capability === "IMAGE" && res.generationRoute.verified === true, `route: ${JSON.stringify(res.generationRoute)}`);
    assert(res.requestedCapability === "IMAGE", "requestedCapability IMAGE");
    assert(res.stages.generationType === undefined, "no Standard generation-type switch stage");
    assert(res.settings.generationType === "NOT_APPLICABLE", "generationType not applicable in AGENT mode");
    assert(always.clicked === 1 && img11.clicked === 1 && imgX1.clicked === 1, "agent defaults configured");
    assert(genBtn.clicked === 0, "Start generation never clicked during preparation");
  });

  // 5 — ASSISTED_APPROVAL with Always already selected → no unnecessary click.
  await t("v1E2F Always already selected → no click, still verified", async () => {
    const { doc, always } = agentFlowPage();
    always.attrs["aria-selected"] = "true";
    const agent = await adapter.prepareAgentSettings(doc, {});
    assert(agent.verified === true && agent.confirmationChanged === false && always.clicked === 0, `changed=${agent.confirmationChanged}`);
  });

  // 6 — Never → changes to Always and verifies.
  await t("v1E2F Never → switched to Always and verified", async () => {
    const { doc, always, never } = agentFlowPage();
    never.attrs["aria-selected"] = "true";
    const agent = await adapter.prepareAgentSettings(doc, {});
    assert(agent.verified === true && agent.confirmationChanged === true, "policy changed to Always");
    assert(always.clicked === 1 && never.clicked === 0, "Always clicked, Never untouched");
    assert(always.attrs["aria-selected"] === "true", "selected semantics verified");
  });

  // 7+8+9+10 — image defaults scoped to the Image section; video untouched;
  // x1 maps to outputCount=1; model observed read-only.
  await t("v1E2F image section scoping: 1:1 + x1 only; video untouched; model observed", async () => {
    const { doc, img11, imgX1, vidX1, vid169, imgModel } = agentFlowPage();
    const agent = await adapter.prepareAgentSettings(doc, {});
    assert(agent.verified === true, `verified: ${agent.code}`);
    assert(img11.clicked === 1 && agent.aspect === "1:1", "image 1:1 selected");
    assert(imgX1.clicked === 1 && agent.outputCount === 1, "x1 maps to outputCount=1");
    assert(vidX1.clicked === 0 && vid169.clicked === 0, "video section never touched");
    assert(agent.modelLabel === "Nano Banana 2" && imgModel.clicked === 0, `model observed read-only: ${agent.modelLabel}`);
  });

  // 11 — Save + close/reopen persistence verification.
  await t("v1E2F Save + reopen persistence verification", async () => {
    const { doc, save } = agentFlowPage();
    const agent = await adapter.prepareAgentSettings(doc, {});
    assert(agent.changed === true && agent.saved === true && save.clicked === 1, "saved after changes");
    assert(agent.verified === true, `persistence reread verified: ${agent.code}`);
  });

  // 14 — Agent Start→Stop is agentState=BUSY, never credit-spending proof.
  await t("v1E2F Agent Start→Stop = BUSY, not media generation", async () => {
    const { doc, genBtn, settingsBtn } = agentFlowPage();
    const origClick = settingsBtn.click;
    settingsBtn.click = () => {
      origClick();
      genBtn.attrs["aria-label"] = "Stop"; // Agent query enters busy state
    };
    const agent = await adapter.prepareAgentSettings(doc, {});
    assert(agent.verified === true, `preparation succeeded: ${agent.code}`);
    assert(agent.agentState === "BUSY" && agent.mediaGenerationState === "IDLE", `state: ${agent.agentState}/${agent.mediaGenerationState}`);
    assert(agent.probeLog.some((l) => l.includes("agentState: BUSY")), "busy state logged");
    assert(!String(agent.code || "").includes("UNEXPECTED_GENERATION"), "not treated as credit-spending generation");
  });

  // 13 — STANDARD mode still requires generationType IMAGE verification
  // (covered by the v1E.2/v1E.2D Standard suites; explicit gate check here).
  await t("v1E2F STANDARD readiness still demands verified generation type", () => {
    const doc = fullPage(); // Generate enabled but NO generation-type evidence
    const gs = adapter.assessGenerationReady(doc, { promptVerified: true, approvalState: "PREPARED", approvalPendingExpected: true });
    assert(gs.ready === false && gs.missing.includes("GENERATION_TYPE_UNKNOWN"), `standard gate intact: ${JSON.stringify(gs.missing)}`);
  });

  // ---------------- POST-v1E.2G — Agent surface + logical prompt text ----------------

  // ARIA Agent Settings fixture with the role STRIPPED (live Blocker-A shape:
  // the panel carries no role=dialog/menu/listbox) and the options registered
  // at doc level so the observe-only role-less marker resolver can find them.
  function rolelessAgentPage() {
    const page = agentFlowPage(); // dialog NOT registered (settingsBtn unclicked)
    const surface = page.surface;
    surface.attrs = {}; // no role attribute — ARIA resolver must miss it
    const allOptions = surface.querySelectorAll('[role="option"]');
    allOptions[0].parentElement = surface; // heading must walk to the common container
    page.doc.map['[role="option"]'] = allOptions;
    return { ...page, allOptions };
  }
  const mockText = (data) => ({ nodeType: 3, data });
  const mockBr = () => new FakeElement({ tag: "br" });
  const mockBlock = (tag, kids) => new FakeElement({ tag, children: kids });

  // 1 — already-open role-less panel → AGENT verified, observe-only (zero clicks).
  await t("v1E2G role-less Agent Settings panel → AGENT verified without click", async () => {
    const page = rolelessAgentPage();
    const mode = await adapter.resolveFlowMode(page.doc, { menuTimeoutMs: 120 });
    assert(mode.value === "AGENT" && mode.verified === true, `mode: ${mode.value}/${mode.verified}`);
    assert(mode.resolutionSource === "VISIBLE_MARKERS", `resolutionSource: ${mode.resolutionSource}`);
    assert(mode.probeLog.some((l) => l.includes("agentSettingsSurface") && l.includes("VISIBLE_MARKERS")), "marker resolution logged");
    assert(page.settingsBtn.clicked === 0 && page.allOptions.every((o) => !o.clicked), "observe-only: zero clicks");
  });

  // 2 — a lone heading marker (even an interactive button) never verifies.
  await t("v1E2G heading marker alone does NOT verify Agent mode", async () => {
    const doc = new FakeDocument({});
    const heading = new FakeElement({ tag: "button", attrs: { "aria-label": "Agent settings" } });
    doc.map["button"] = [heading];
    const decoy = new FakeElement({ tag: "div" });
    decoy.textContent = "agent settings confirm before generating"; // random page text
    doc.map["div.random-text"] = [decoy];
    assert(adapter.findAgentSettingsMarkerContainer(doc) === null, "heading alone fails the >=3-marker gate");
    const mode = await adapter.resolveFlowMode(doc, { menuTimeoutMs: 120 });
    assert(mode.value === "UNKNOWN" && mode.verified === false, `text/lone-heading verified mode: ${mode.value}`);
    assert(heading.clicked === 0, "lone heading never clicked");
  });

  // 3 — heading + confirmation + image-default markers in ONE container → verifies.
  await t("v1E2G heading + 2 additional markers in one container verify AGENT", () => {
    const doc = new FakeDocument({});
    const panel = new FakeElement({ tag: "div" });
    const mk = (label) => {
      const el = new FakeElement({ tag: "button", attrs: { "aria-label": label } });
      el.parentElement = panel;
      return el;
    };
    const buttons = [mk("Agent settings"), mk("Confirm before generating"), mk("Image generation default")];
    doc.map["button"] = buttons;
    const found = adapter.findAgentSettingsMarkerContainer(doc);
    assert(found && found.surface === panel, "one visible common container resolved");
    assert(found.markers.includes("agent settings") && found.markers.length >= 3, `markers: [${found.markers.join("|")}]`);
  });

  // 4 — already-open ARIA surface reused by prepareAgentSettings (no close/reopen).
  await t("v1E2G already-open surface reused by prepareAgentSettings (no reopen click)", async () => {
    const page = agentFlowPage();
    page.settingsBtn.click(); // operator pre-opened the panel
    page.always.attrs["aria-selected"] = "true";
    page.img11.attrs["aria-selected"] = "true";
    page.imgX1.attrs["aria-selected"] = "true";
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.changed === false && agent.saved === false, "nothing to change → no save/reopen phase");
    assert(page.settingsBtn.clicked === 1, `reuse must not click Settings again: clicked=${page.settingsBtn.clicked}`);
  });

  // 5 — already-open ROLE-LESS panel reused: detection AND preparation run
  // with zero clicks (a probe would have clicked the decoy Settings trigger).
  await t("v1E2G role-less open panel prepared with zero clicks (reuse)", async () => {
    const page = rolelessAgentPage();
    page.always.attrs["aria-selected"] = "true";
    page.img11.attrs["aria-selected"] = "true";
    page.imgX1.attrs["aria-selected"] = "true";
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.changed === false && agent.saved === false, "no changes expected");
    assert(page.settingsBtn.clicked === 0, "decoy Settings trigger never clicked (reuse, not probe)");
    assert(page.allOptions.every((o) => !o.clicked), "zero clicks on the open panel");
  });

  // 6 — TEXT+BR+TEXT logical read reconstructs the BR newline; domShape diagnostic.
  await t("v1E2G TEXT+BR+TEXT logical read keeps the BR newline; domShape", () => {
    const editor = new FakeElement({
      tag: "div",
      attrs: { contenteditable: "true" },
      children: [mockText("line one"), mockBr(), mockText("line two")],
    });
    const logical = adapter.readContentEditableLogicalText(editor);
    assert(logical === "line one\nline two\n", `logical read: ${JSON.stringify(logical)}`);
    assert(JSON.stringify(adapter.domShapeOf(editor)) === JSON.stringify(["TEXT", "BR", "TEXT"]), `domShape: ${JSON.stringify(adapter.domShapeOf(editor))}`);
  });

  // 7 — flat textContent (live Blocker B) does not override the logical readback.
  await t("v1E2G textContent without newline does not override logical readback", () => {
    const editor = new FakeElement({
      tag: "div",
      attrs: { contenteditable: "true" },
      children: [mockText("line one"), mockBr(), mockText("line two")],
    });
    editor.textContent = "line oneline two"; // textContent drops the <br>
    const read = adapter.readPromptEditorText(editor);
    assert(read === "line one\nline two\n", `logical readback must win: ${JSON.stringify(read)}`);
    assert(!read.includes("line oneline two"), "flat textContent never leaks through");
  });

  // 8 — two blocks produce exactly ONE logical newline (no duplicate boundaries).
  await t("v1E2G two blocks → exactly one logical newline", () => {
    const editor = new FakeElement({
      tag: "div",
      attrs: { contenteditable: "true" },
      children: [mockBlock("div", [mockText("A")]), mockBlock("div", [mockText("B")])],
    });
    const logical = adapter.readContentEditableLogicalText(editor);
    assert(logical === "A\nB\n", `blocks: ${JSON.stringify(logical)}`);
    assert(!logical.includes("\n\n"), "no duplicate block boundaries");
  });

  // 9 — no internal-whitespace collapse in the logical reader.
  await t("v1E2G logical reader preserves internal whitespace", () => {
    const editor = new FakeElement({
      tag: "div",
      attrs: { contenteditable: "true" },
      children: [mockText("a  b\tc")],
    });
    const logical = adapter.readContentEditableLogicalText(editor);
    assert(logical === "a  b\tc\n", `no internal collapse: ${JSON.stringify(logical)}`);
  });

  // 10 — arbitrary multiline round-trip: writer (text nodes + <br>) then the
  // logical reader verify the exact prompt through the real pipeline.
  await t("v1E2G multiline round-trip preserves internal newlines (writer→reader)", async () => {
    const doc = prepareablePage();
    const editor = new FakeElement({ tag: "div", attrs: { contenteditable: "true" }, children: [] });
    editor.appendChild = (child) => editor.children.push(child);
    Object.defineProperty(editor, "textContent", {
      get() {
        return editor.children.map((c) => (c.nodeType === 3 ? c.data : "")).join("");
      },
      set() {
        editor.children = [];
      },
    });
    doc.createElement = (tag) => new FakeElement({ tag });
    doc.createTextNode = (data) => mockText(data);
    editor.ownerDocument = doc;
    doc.map[S("PROMPT_INPUT")] = editor;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "line one\nline two", approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    assert(res.ok === true && res.prepared === true, `expected prepared, got code=${res.code}`);
    assert(res.promptInsert.editorType === "contenteditable" && res.promptInsert.strategy === "dom-replace", `type/strategy: ${res.promptInsert.editorType}/${res.promptInsert.strategy}`);
    assert(editor.children.filter((c) => String(c.tagName || "").toLowerCase() === "br").length === 1, "one <br> for one internal newline");
  });

  // 11 — a DOM that truly lacks the newline still fails exact verification
  // (the logical reader never fabricates the missing newline).
  await t("v1E2G truly missing newline still fails exact verification", () => {
    const flat = new FakeElement({
      tag: "div",
      attrs: { contenteditable: "true" },
      children: [mockText("...background.No text.")],
    });
    const v = adapter.verifyPromptContent(flat, "...background.\nNo text.");
    assert(v.verified === false, `flat DOM must fail: ${JSON.stringify(v)}`);
    const withBr = new FakeElement({
      tag: "div",
      attrs: { contenteditable: "true" },
      children: [mockText("...background."), mockBr(), mockText("No text.")],
    });
    const v2 = adapter.verifyPromptContent(withBr, "...background.\nNo text.");
    assert(v2.verified === true, `BR-respecting read must pass: ${JSON.stringify(v2)}`);
  });

  // 12 — model label strips Material-Symbol ligature tokens (live: "Nano
  // Banana 2 arrow_drop_down" → "Nano Banana 2").
  await t("v1E2G model label strips icon ligature from live label", async () => {
    const page = agentFlowPage();
    page.imgModel.attrs["aria-label"] = "model: Nano Banana 2 arrow_drop_down";
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.modelLabel === "Nano Banana 2", `ligature stripped: ${agent.modelLabel}`);
    assert(page.imgModel.clicked === 0, "model observed read-only");
  });

  // 13 — model label extraction works for a different future value.
  await t("v1E2G model label works for a different future model value", async () => {
    const page = agentFlowPage();
    page.imgModel.attrs["aria-label"] = "model: Flux Pro Ultra expand_more";
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.modelLabel === "Flux Pro Ultra", `future value: ${agent.modelLabel}`);
  });

  // 14 — promptReadback diagnostic on BOTH mismatch failures: raw textContent
  // vs logical reconstruction distinguish writer failure from readback loss.
  await t("v1E2G promptReadback diagnostic attached to mismatch failure", async () => {
    const doc = prepareablePage();
    const editor = new FakeElement({ tag: "div", attrs: { contenteditable: "true" }, children: [mockText("totally corrupted prompt text")] });
    editor.textContent = "totally corrupted prompt text";
    doc.map[S("PROMPT_INPUT")] = editor;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptVerifyTimeoutMs: 150, promptVerifyPollMs: 40, promptStabilityMs: 30 }, {});
    assert(res.prepared === false && res.stage === "prompt" && res.code === "PROMPT_TEXT_MISMATCH", `got ${res.stage}/${res.code}`);
    const rb = res.promptReadback;
    assert(rb && typeof rb.logicalText === "string" && Array.isArray(rb.domShape), `readback present: ${JSON.stringify(rb)}`);
    assert(JSON.parse(rb.logicalText).includes("totally corrupted prompt text"), "logicalText carries the DOM-logical observed text");
    assert(JSON.parse(rb.textContent) === "blue circle", "textContent carries the writer value — mismatch source is the DOM, not the writer");
    assert(typeof rb.logicalLength === "number" && rb.logicalLength > 0, "logicalLength reported");
  });

  // ---------------- POST-v1E.2H — real Google Flow Agent Settings DOM -------
  // Captured live 2026-10-01 from flow.google.com Agent settings: the panel
  // has NO role, the title is a plain <h2>, Always/Never are native
  // <input type=radio> with <span class="radio-label"> text, the aspect/output
  // toggles carry Material ligatures glued to their value ("crop_square1:1"),
  // sections are named by ARIA group labels, and the model trigger is a button
  // with aria-label "Image generation default model".

  const t3 = (data) => ({ nodeType: 3, nodeValue: data });
  const ownText = (data) => ({ children: [], childNodes: [t3(data)] });

  function liveAgentSettingsPage({ neverSelected = true, decoyAlways = false } = {}) {
    const doc = new FakeDocument({});
    escapeCloser(doc, ['[role="menu"]', '[role="dialog"]']);
    const surface = new FakeElement({ tag: "div" }); // flow-agent-panel: no role

    const heading = new FakeElement({ tag: "h2" });
    heading.textContent = "Agent settings";
    heading.parentElement = surface;

    // Confirm policy: <span id=..>Confirm before generating</span> +
    // <mat-radio-group role=radiogroup aria-labelledby=..> + native radios.
    const confirmSection = new FakeElement({ tag: "div" });
    confirmSection.parentElement = surface;
    const confirmLabelSpan = new FakeElement({ tag: "span" });
    confirmLabelSpan.textContent = "Confirm before generating";
    confirmLabelSpan.id = "confirm-label";
    const confirmGroup = new FakeElement({ tag: "mat-radio-group", attrs: { role: "radiogroup", "aria-labelledby": "confirm-label" } });
    confirmGroup.parentElement = confirmSection;
    confirmGroup.ownerDocument = { getElementById: (id) => (id === "confirm-label" ? confirmLabelSpan : null) };
    const mkRadio = (name, sub, checked) => {
      const nameSpan = ownText(name);
      const subSpan = ownText(sub);
      const wrap = new FakeElement({ tag: "label" });
      wrap.children = [{ children: [nameSpan, subSpan] }];
      const inp = new FakeElement({ tag: "input", attrs: { type: "radio" } });
      inp.labels = [wrap];
      inp.checked = checked;
      inp.parentElement = confirmGroup;
      inp.click = () => {
        inp.clicked += 1;
        inp.checked = true;
      };
      return inp;
    };
    const always = mkRadio("Always", "Agent will ask for confirmation before generating media.", !neverSelected);
    const never = mkRadio("Never", "Agent will generate media and spend credits automatically.", neverSelected);

    // Image / Video default sections: ARIA-named toggle groups + a model button.
    const mkToggle = (tagText, value, checked, group) => {
      const b = new FakeElement({ tag: "button", attrs: { role: "radio", "aria-checked": checked ? "true" : "false" } });
      b.textContent = tagText + value; // live: ligature glued to the value
      b.parentElement = group;
      b.click = () => {
        b.clicked += 1;
        b.attrs["aria-checked"] = "true";
      };
      return b;
    };
    const mkSection = (labelPrefix, modelName, modelIcon) => {
      const sec = new FakeElement({ tag: "div" });
      sec.parentElement = surface;
      const aspectGroup = new FakeElement({ tag: "flow-toggles", attrs: { "aria-label": `${labelPrefix} aspect ratio` } });
      aspectGroup.parentElement = sec;
      const outGroup = new FakeElement({ tag: "flow-toggles", attrs: { "aria-label": `${labelPrefix} output count` } });
      outGroup.parentElement = sec;
      const aspects = {
        "16:9": mkToggle("crop_16_9", "16:9", false, aspectGroup),
        "4:3": mkToggle("crop_landscape", "4:3", false, aspectGroup),
        "1:1": mkToggle("crop_square", "1:1", true, aspectGroup),
        "3:4": mkToggle("crop_portrait", "3:4", false, aspectGroup),
        "9:16": mkToggle("crop_9_16", "9:16", false, aspectGroup),
      };
      const outs = {
        x1: mkToggle("", "x1", true, outGroup),
        x2: mkToggle("", "x2", false, outGroup),
        x3: mkToggle("", "x3", false, outGroup),
        x4: mkToggle("", "x4", false, outGroup),
      };
      const model = new FakeElement({ tag: "button", attrs: { "aria-label": `${labelPrefix} model` } });
      model.textContent = `${modelIcon} ${modelName} arrow_drop_down`;
      model.parentElement = sec;
      const allToggles = [...Object.values(aspects), ...Object.values(outs)];
      sec.querySelectorAll = (sel) => {
        if (sel === '[role="radio"]') return allToggles;
        if (sel === "button") return [model];
        if (sel === "[aria-labelledby],[aria-label]") return [aspectGroup, outGroup, model];
        return [];
      };
      for (const g of [aspectGroup, outGroup]) {
        g.querySelectorAll = (sel) => {
          if (sel === '[role="radio"]') return g === aspectGroup ? Object.values(aspects) : Object.values(outs);
          return [];
        };
      }
      return { sec, aspects, outs, model };
    };
    const img = mkSection("Image generation default", "Nano Banana 2", "\u{1F34C}");
    const vid = mkSection("Video generation default", "Omni 1.1 Flash", "");
    const save = new FakeElement({ tag: "button" });
    save.textContent = "Save";
    save.parentElement = surface;

    confirmSection.querySelectorAll = (sel) => {
      if (sel === 'input[type="radio"]') return [always, never];
      if (sel === "[aria-labelledby],[aria-label]") return [confirmGroup];
      return [];
    };

    let decoy = null;
    if (decoyAlways) {
      // An "Always" radio OUTSIDE the confirm section must never satisfy it.
      const other = new FakeElement({ tag: "div" });
      other.parentElement = surface;
      const wrap = new FakeElement({ tag: "label" });
      wrap.children = [{ children: [ownText("Always")] }];
      decoy = new FakeElement({ tag: "input", attrs: { type: "radio" } });
      decoy.labels = [wrap];
      decoy.checked = true;
      decoy.parentElement = other;
      other.querySelectorAll = (sel) => (sel === 'input[type="radio"]' ? [decoy] : []);
      surface.__decoySection = other;
    }

    const allToggles = [...Object.values(img.aspects), ...Object.values(img.outs), ...Object.values(vid.aspects), ...Object.values(vid.outs)];
    surface.querySelectorAll = (sel) => {
      if (sel === '[role="radio"]') return allToggles;
      if (sel === 'input[type="radio"]') return decoy ? [always, never, decoy] : [always, never];
      if (sel === "button") return [img.model, vid.model, save];
      if (sel === "button,[role='button'],[role='menuitem'],[role='tab']") return [img.model, vid.model, save];
      if (sel === "[aria-labelledby],[aria-label]") return [confirmGroup, ...img.sec.querySelectorAll(sel), ...vid.sec.querySelectorAll(sel)];
      return [];
    };
    doc.map["button"] = [img.model, vid.model, save];
    doc.map['[role="radio"]'] = allToggles;
    doc.map['input[type="radio"]'] = decoy ? [always, never, decoy] : [always, never];
    doc.map["h1, h2, h3, h4, h5, h6"] = [heading];
    doc.map[S("PROMPT_INPUT")] = new FakeElement({ tag: "textarea", value: "" });
    doc.map[S("GENERATE_BUTTON")] = new FakeElement({ tag: "button", attrs: { "aria-label": "Start generation" } });
    return { doc, surface, heading, always, never, decoy, img, vid, save };
  }

  // 1 — the plain <h2> title is a valid marker: AGENT resolves with ZERO clicks.
  await t("v1E2H live plain-heading Agent Settings panel → AGENT verified without click", async () => {
    const page = liveAgentSettingsPage();
    const mode = await adapter.resolveFlowMode(page.doc, { menuTimeoutMs: 120 });
    assert(mode.value === "AGENT" && mode.verified === true, `mode: ${mode.value}/${mode.verified}`);
    assert(mode.resolutionSource === "VISIBLE_MARKERS", `resolutionSource: ${mode.resolutionSource}`);
    assert(page.always.clicked === 0 && page.save.clicked === 0, "observe-only: zero clicks");
  });

  // 2 — native radios: Never is switched to Always, then verified by reread.
  await t("v1E2H native radio Never → Always set, saved and re-verified", async () => {
    const page = liveAgentSettingsPage({ neverSelected: true });
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.observedConfirmation === "ALWAYS", `observed: ${agent.observedConfirmation}`);
    assert(agent.confirmationChanged === true, "Never was switched to Always");
    assert(page.always.clicked === 1 && page.never.clicked === 0, "only Always clicked");
    assert(page.save.clicked === 1, "changed settings saved");
  });

  // 3 — Always already selected: nothing changes, nothing is saved.
  await t("v1E2H native radio Always already selected → no click, no save", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.confirmationChanged === false && agent.changed === false && agent.saved === false, "no-op on already-correct settings");
    assert(page.always.clicked === 0 && page.save.clicked === 0, "zero clicks");
  });

  // 4 — an "Always" radio outside the confirm section never satisfies the policy.
  await t("v1E2H Always outside the confirm section does not satisfy the policy", async () => {
    const page = liveAgentSettingsPage({ neverSelected: true, decoyAlways: true });
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared via the scoped radio: ${agent.code}`);
    assert(page.never.clicked === 0, "the scoped Never radio is never clicked");
    assert(page.decoy.clicked === 0, "decoy radio never clicked");
  });

  // 5 — ligature-glued aspect ("crop_square1:1") resolves to 1:1, video untouched.
  await t("v1E2H ligature-glued aspect + x1 resolved in the Image section only", async () => {
    const page = liveAgentSettingsPage();
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.aspect === "1:1" && agent.outputCount === 1, `defaults: ${agent.aspect}/${agent.outputCount}`);
    const vidClicks = [...Object.values(page.vid.aspects), ...Object.values(page.vid.outs)].reduce((n, b) => n + b.clicked, 0);
    assert(vidClicks === 0, "video section never touched");
    assert(page.img.aspects["1:1"].clicked === 0, "already-selected 1:1 never re-clicked");
  });

  // 6 — model label from the ARIA-named model button, icon glyph + ligature stripped.
  await t("v1E2H model label read from the ARIA-named control, glyphs stripped", async () => {
    const page = liveAgentSettingsPage();
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.verified === true, `prepared: ${agent.code}`);
    assert(agent.modelLabel === "Nano Banana 2", `modelLabel: ${agent.modelLabel}`);
    assert(page.img.model.clicked === 0 && page.vid.model.clicked === 0, "model observed read-only");
  });

  // 7 — a different future model name still normalizes (no hard-coded names).
  await t("v1E2H model label works for a different future model value", async () => {
    const page = liveAgentSettingsPage();
    page.img.model.textContent = "Flux Pro Ultra expand_more";
    page.img.model.attrs["aria-label"] = "Image generation default model";
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.modelLabel === "Flux Pro Ultra", `future model: ${agent.modelLabel}`);
  });

  // 8 — the whole PREPARE_GENERATION route resolves on the live DOM shape.
  await t("v1E2H PREPARE_GENERATION → AGENT/IMAGE READY on the live panel shape", async () => {
    const doc = liveAgentSettingsPage().doc;
    const res = await commands.dispatchContentCommand(adapter, doc, { type: "PREPARE_GENERATION", prompt: "blue circle", approvalState: "PREPARED", promptStabilityMs: 30 }, {});
    assert(res.prepared === true, `expected prepared, got ${res.stage}/${res.code} missing=${JSON.stringify(res.missing)}`);
    assert(res.generationRoute.mode === "AGENT" && res.generationRoute.capability === "IMAGE" && res.generationRoute.verified === true, `route: ${JSON.stringify(res.generationRoute)}`);
    assert(res.settings.aspect === "1:1" && res.settings.outputCount === 1, `settings: ${JSON.stringify(res.settings)}`);
    assert(res.settings.model === "Nano Banana 2", `model: ${res.settings.model}`);
    assert(res.clickedGenerate === false && res.creditsConsumed === false, "zero credits");
  });

  // ---------------- POST-v1F — Flow's own "Confirm before generating" gate ----
  // With `Confirm before generating = Always`, clicking Start only ASKS Flow
  // for permission; the credit is spent when that ask is confirmed. The submit
  // path therefore owns one bounded confirmation click — and only ever one.

  const CLICKABLE_SEL = "button,[role='button'],[role='menuitem'],[role='tab']";

  /** Start button that reveals `pending` controls, exactly like Flow's gate. */
  function confirmationGatePage({ gateButtons = [], preexisting = [] } = {}) {
    const doc = new FakeDocument({});
    const genBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Start generation" } });
    let revealed = false;
    genBtn.click = () => {
      genBtn.clicked += 1;
      revealed = true;
    };
    doc.map[S("GENERATE_BUTTON")] = genBtn;
    doc.map[CLICKABLE_SEL] = [...preexisting];
    doc.map[S("PROMPT_INPUT")] = new FakeElement({ tag: "textarea", value: "blue circle" });
    return {
      doc,
      genBtn,
      reveal: () => {
        revealed = true;
        doc.map[CLICKABLE_SEL] = [...preexisting, ...gateButtons];
      },
      get revealed() {
        return revealed;
      },
    };
  }
  const mkBtn = (name) => {
    const b = new FakeElement({ tag: "button", attrs: { "aria-label": name } });
    b.parentElement = new FakeElement({ tag: "div" });
    return b;
  };
  /** Flow committed the turn: the prompt left the composer. */
  const clearPrompt = (page) => {
    page.doc.map[S("PROMPT_INPUT")].value = "";
  };

  await t("v1F a new confirm gate is clicked once, then acceptance is proven", async () => {
    const confirm = mkBtn("Confirm generation");
    const page = confirmationGatePage({ gateButtons: [confirm] });
    page.genBtn.click = () => {
      page.genBtn.clicked += 1;
      page.doc.map[CLICKABLE_SEL] = [confirm];
    };
    confirm.click = () => {
      confirm.clicked += 1;
      page.doc.map[CLICKABLE_SEL] = [];
      clearPrompt(page); // Flow committed the turn
    };
    const knownClickables = adapter.snapshotConfirmCandidates(page.doc);
    page.genBtn.click();
    const res = await adapter.awaitSubmitAcceptance(page.doc, { knownClickables, timeoutMs: 300, pollMs: 10 });
    assert(res.accepted === true, `accepted: ${JSON.stringify(res)}`);
    assert(res.signal === "composer-cleared", `signal: ${res.signal}`);
    assert(res.confirmClicked === "Confirm generation", `gate: ${res.confirmClicked}`);
    assert(confirm.clicked === 1, `exactly one confirmation click: ${confirm.clicked}`);
    assert(typeof res.at === "string" && res.at.length > 10, `submitAcceptedAt recorded: ${res.at}`);
  });

  await t("v1F a cancel-named control is never clicked as confirmation", async () => {
    const cancelish = mkBtn("Cancel generation");
    const page = confirmationGatePage({ gateButtons: [cancelish] });
    page.genBtn.click = () => {
      page.genBtn.clicked += 1;
      page.doc.map[CLICKABLE_SEL] = [cancelish];
    };
    const res = await adapter.awaitSubmitAcceptance(page.doc, { timeoutMs: 120, pollMs: 10 });
    assert(res.accepted === false && cancelish.clicked === 0, `cancel must stay untouched: ${JSON.stringify(res)}`);
    assert(res.code === "SUBMIT_NOT_ACCEPTED", `code: ${res.code}`);
  });

  await t("v1F a confirm control that existed before the submit is never clicked", async () => {
    const stale = mkBtn("Confirm generation");
    const page = confirmationGatePage({ preexisting: [stale] });
    const knownClickables = adapter.snapshotConfirmCandidates(page.doc);
    const res = await adapter.awaitSubmitAcceptance(page.doc, { knownClickables, timeoutMs: 120, pollMs: 10 });
    assert(res.accepted === false && stale.clicked === 0, `pre-existing control must stay untouched: ${JSON.stringify(res)}`);
  });

  await t("v1F no acceptance evidence → SUBMIT_NOT_ACCEPTED, never a second Generate click", async () => {
    const page = confirmationGatePage();
    const before = page.genBtn.clicked;
    const res = await adapter.awaitSubmitAcceptance(page.doc, { timeoutMs: 120, pollMs: 10 });
    assert(res.accepted === false && res.code === "SUBMIT_NOT_ACCEPTED", `code: ${res.code}`);
    assert(res.observed && res.observed.promptBeforeLength > 0, `observations attached: ${JSON.stringify(res.observed)}`);
    assert(page.genBtn.clicked === before, "resolver never clicks Generate itself");
  });

  await t("v1F a Stop control appearing is positive acceptance evidence", async () => {
    const page = confirmationGatePage();
    const stop = mkBtn("Stop generation");
    page.genBtn.click = () => {
      page.genBtn.clicked += 1;
      page.doc.map[CLICKABLE_SEL] = [stop];
      page.doc.map["button"] = [stop]; // findStopControl scans the marker selectors
    };
    const baseline = adapter.captureSubmitBaseline(page.doc); // BEFORE the click
    page.genBtn.click(); // the submit click
    const res = await adapter.awaitSubmitAcceptance(page.doc, { baseline, timeoutMs: 200, pollMs: 10 });
    assert(res.accepted === true, `stop-control must prove acceptance: ${JSON.stringify(res)}`);
    assert(res.signal === "stop-control-appeared", `signal: ${res.signal}`);
  });

  await t("v1F the acceptance baseline is captured before the click, never after", async () => {
    const page = confirmationGatePage();
    const stop = mkBtn("Stop generation");
    const baseline = adapter.captureSubmitBaseline(page.doc);
    assert(baseline.runBefore.stopControlPresent === false, "no stop control before the click");
    assert(baseline.promptBefore === "blue circle", `prompt captured before the click: ${JSON.stringify(baseline.promptBefore)}`);
    page.genBtn.click = () => {
      page.genBtn.clicked += 1;
      page.doc.map["button"] = [stop];
    };
    page.genBtn.click();
    const late = adapter.captureSubmitBaseline(page.doc);
    assert(late.runBefore.stopControlPresent === true, "capturing after the click would lose the signal — this is why it is pre-click");
  });

  // POST-v1F §3/§4 — the job must never be GENERATING on a click alone.
  await t("v1F SUBMIT_GENERATE reports submitIssued but not accepted when Flow ignores the click", async () => {
    const page = confirmationGatePage();
    const res = await commands.dispatchContentCommand(
      adapter,
      page.doc,
      { type: "SUBMIT_GENERATE", jobId: "j1", attempt: 1, approval: { jobId: "j1", attempt: 1, approved: true }, acceptTimeoutMs: 120 },
      {}
    );
    assert(res.ok === true, "command itself succeeds (evidence, not a throw)");
    assert(res.submitIssued === true, "the click was issued");
    assert(res.submitAcceptedByFlow === false, `must not claim acceptance: ${JSON.stringify(res)}`);
    assert(res.code === "SUBMIT_NOT_ACCEPTED", `precise submit-stage code: ${res.code}`);
    assert(res.submitAcceptedAt === null, "no acceptance timestamp without evidence");
  });

  await t("v1F SUBMIT_GENERATE reports acceptance evidence when Flow commits the turn", async () => {
    const page = confirmationGatePage();
    page.genBtn.click = () => {
      page.genBtn.clicked += 1;
      // Flow commits the turn asynchronously; the handshake must see the
      // prompt present first and cleared later.
      setTimeout(() => clearPrompt(page), 20);
    };
    const res = await commands.dispatchContentCommand(
      adapter,
      page.doc,
      { type: "SUBMIT_GENERATE", jobId: "j1", attempt: 1, approval: { jobId: "j1", attempt: 1, approved: true }, acceptTimeoutMs: 500 },
      {}
    );
    assert(res.submitAcceptedByFlow === true, `accepted: ${JSON.stringify(res)}`);
    assert(res.acceptanceSignal === "composer-cleared" && res.code === null, `signal/code: ${res.acceptanceSignal}/${res.code}`);
    assert(typeof res.submitAcceptedAt === "string", "submitAcceptedAt present");
    assert(page.genBtn.clicked === 1, `Start clicked exactly once: ${page.genBtn.clicked}`);
  });

  await t("v1F a baseline is captured even when the submit is not accepted", async () => {
    const page = confirmationGatePage();
    const res = await commands.dispatchContentCommand(
      adapter,
      page.doc,
      { type: "SUBMIT_GENERATE", jobId: "j1", attempt: 1, approval: { jobId: "j1", attempt: 1, approved: true }, acceptTimeoutMs: 120 },
      {}
    );
    assert(res.resultBaseline && typeof res.resultBaseline.count === "number", `baseline attached: ${JSON.stringify(res.resultBaseline)}`);
  });

  // POST-v1F live bug: the frozen AGENT approval was invalidated by Standard-mode
  // re-reads (aspect/output/model UNKNOWN, no generation-type control in Agent
  // mode) → APPROVAL_STALE_CHANGED with a perfectly fresh approval.
  await t("v1F AGENT approval revalidates against the Agent Settings surface", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    wireDrawerClose(page);
    const mat = await adapter.readAgentMaterial(page.doc);
    assert(mat && mat.surfaceFound === true, "agent material read from the open surface");
    assert(mat.aspect === "1:1" && String(mat.outputCount) === "1", `aspect/output: ${mat.aspect}/${mat.outputCount}`);
    assert(mat.model === "Nano Banana 2", `model: ${mat.model}`);
    assert(mat.confirmation === "ALWAYS", `confirmation: ${mat.confirmation}`);
  });

  await t("v1F a fresh AGENT approval is NOT stale; a changed default IS", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    wireDrawerClose(page);
    page.doc.map[S("PROMPT_INPUT")].value = "blue circle";
    const snapshot = { prompt: "blue circle", type: "IMAGE", aspect: "1:1", outputCount: 1, model: "Nano Banana 2", visibleCost: "UNKNOWN" };
    const ok = await commands.revalidateBeforeGenerate(adapter, page.doc, snapshot);
    assert(ok.ok === true, `fresh approval must pass: ${JSON.stringify(ok.changed)}`);
    assert(ok.flowMode === "AGENT", `routed to the Agent path: ${ok.flowMode}`);
    // a real change in the live Agent Settings invalidates it
    page.img.aspects["1:1"].attrs["aria-checked"] = "false";
    page.img.aspects["16:9"].attrs["aria-checked"] = "true";
    const stale = await commands.revalidateBeforeGenerate(adapter, page.doc, snapshot);
    assert(stale.ok === false && stale.changed.includes("aspect"), `changed aspect must invalidate: ${JSON.stringify(stale.changed)}`);
  });

  await t("v1F no Agent Settings surface → Standard revalidation path", async () => {
    const doc = prepareablePage();
    doc.map[S("PROMPT_INPUT")].value = "blue circle";
    const snapshot = { prompt: "blue circle", type: "IMAGE", aspect: "16:9", outputCount: 1, model: "Veo 3.1", visibleCost: "10 credits" };
    const res = await commands.revalidateBeforeGenerate(adapter, doc, snapshot);
    assert(res.ok === true && res.flowMode !== "AGENT", `standard path unchanged: ${JSON.stringify(res.changed)}`);
  });

  await t("v1F no Agent controls in the composer → Agent material is never probed", async () => {
    const doc = prepareablePage();
    let probed = false;
    const orig = adapter.openAgentSettingsSurface;
    adapter.openAgentSettingsSurface = async () => {
      probed = true;
      return null;
    };
    let mat = null;
    try {
      mat = await adapter.readAgentMaterial(doc);
    } finally {
      adapter.openAgentSettingsSurface = orig;
    }
    assert(!mat || mat.surfaceFound === false, `Standard composer must not be probed: ${JSON.stringify(mat)}`);
    assert(probed === false, `Standard composer must not be probed (probed=${probed})`);
    assert(mat && mat.code === "NO_AGENT_CONTROLS", `precise reason: ${mat && mat.code}`);
  });

  // POST-v1F: the drawer is CLOSED at approval time, so the Agent composer must
  // be detected from its own toolbar controls. The trigger-candidate ranking
  // deliberately excludes that control, which made an earlier guard refuse and
  // cost a live cycle.
  await t("v1F Agent composer is detected from its toolbar controls", () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    const agentBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Agent instructions" } });
    agentBtn.textContent = "article_spark";
    page.doc.map["button,[role='button']"] = [agentBtn];
    assert(adapter.hasAgentComposerControls(page.doc) === true, "Agent instructions control detected");

    const standard = prepareablePage();
    standard.map["button,[role='button']"] = [new FakeElement({ tag: "button", attrs: { "aria-label": "Settings" } })];
    assert(adapter.hasAgentComposerControls(standard) === false, "a Standard composer is not an Agent composer");
  });

  // POST-v1F live lesson: the adapter has TWO export surfaces — `module.exports`
  // (node) and `window.FlowPageAdapter` (the isolated world the content script
  // actually uses). A new function added to only one of them is silently
  // MISSING in the browser (`MISSING_ADAPTER_FN`), which cost several live
  // cycles. They must expose the identical key set.
  await t("v1F browser namespace exports exactly what module.exports does", () => {
    const fs = require("fs");
    const vm = require("vm");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "content", "flow-page-adapter.js"), "utf8");
    const win = {};
    vm.runInNewContext(src, { window: win, globalThis: {}, console, setTimeout, clearTimeout, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Map, Set, Buffer, URL });
    const browserKeys = Object.keys(win.FlowPageAdapter || {}).sort();
    const nodeKeys = Object.keys(adapter).sort();
    const missingInBrowser = nodeKeys.filter((k) => !browserKeys.includes(k));
    const missingInNode = browserKeys.filter((k) => !nodeKeys.includes(k));
    assert(browserKeys.length > 0, "browser namespace was populated");
    assert(missingInBrowser.length === 0, `missing from window.FlowPageAdapter: ${missingInBrowser.join(",")}`);
    assert(missingInNode.length === 0, `missing from module.exports: ${missingInNode.join(",")}`);
    // the functions POST-v1F depends on at runtime must be in BOTH
    for (const fn of ["readAgentMaterial", "awaitSubmitAcceptance", "snapshotConfirmCandidates", "submitAfterApproval"]) {
      assert(typeof adapter[fn] === "function", `${fn} exported for node`);
      assert(typeof win.FlowPageAdapter[fn] === "function", `${fn} exported to the browser`);
    }
  });

  // POST-v1F live lesson #2: in a REAL document querySelectorAll returns a
  // NodeList (no .map/.filter). The mock DOM returns arrays, so only the live
  // run surfaced `medias.map is not a function` — thrown from
  // captureResultBaseline, i.e. one step BEFORE Start is ever clicked.
  await t("v1F detectResults works against a real NodeList, not just arrays", () => {
    const img = { src: "https://lh3.googleusercontent.com/a/one" };
    const nodeList = { length: 1, 0: img, [Symbol.iterator]: function* () { yield img; } };
    const root = {
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'img[src*="googleusercontent"]' ? nodeList : []),
    };
    const urls = adapter.detectResults(root);
    assert(urls.length === 1 && urls[0] === img.src, `NodeList results: ${JSON.stringify(urls)}`);
    const baseline = adapter.captureResultBaseline(root);
    assert(baseline.count === 1, `baseline from NodeList: ${JSON.stringify(baseline)}`);
    assert(adapter.diffNewResults(baseline, [img.src, "https://lh3.googleusercontent.com/a/two"]).length === 1, "diffNewResults on real data");
  });

  // POST-v1F live regression: reading the Agent material opened the settings
  // drawer and left it covering the composer, so the following Start click was
  // swallowed (approved generation → nothing happened, 10 min RESULT_TIMEOUT).
  await t("v1F revalidation restores the composer after reading agent material", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    const closeBtn = wireDrawerClose(page);
    const mat = await adapter.readAgentMaterial(page.doc);
    assert(closeBtn.clicked >= 1, `drawer close control used (clicked=${closeBtn.clicked})`);
    assert(mat && mat.composerRestored === true, `composer restored: ${JSON.stringify(mat)}`);
  });

  await t("v1F a composer that cannot be restored → no submit path", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    // the drawer never really closes: composer stays hidden
    page.doc.map[S("PROMPT_INPUT")].attrs.hidden = "hidden";
    page.doc.map[S("GENERATE_BUTTON")].attrs.hidden = "hidden";
    const mat = await adapter.readAgentMaterial(page.doc);
    assert(mat && mat.surfaceFound === false, `must refuse instead of handing a broken submit: ${JSON.stringify(mat)}`);
    assert(mat.code === "COMPOSER_NOT_RESTORED", `precise reason: ${mat.code}`);
  });

  // POST-v1F live lesson: a control that is merely VISIBLE can still sit under
  // the open drawer and swallow the click. Restoration must require the drawer
  // to be unmounted, not just "visible".
  await t("v1F a visible-but-covered composer is not accepted as restored", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    const promptEl = page.doc.map[S("PROMPT_INPUT")];
    const genEl = page.doc.map[S("GENERATE_BUTTON")];
    // composer "visible", drawer still mounted (its markers still resolve)
    assert(adapter.agentSettingsDrawerOpen(page.doc) === true, "drawer is still mounted in this fixture");
    const closeBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Close" } });
    closeBtn.textContent = "close";
    // closing detaches the settings content entirely (live behaviour)
    closeBtn.click = () => {
      closeBtn.clicked += 1;
      page.doc.map["button"] = [];
      page.surface.parentElement = null;
    };
    page.surface.querySelectorAll = ((orig) => (sel) => (sel === "button" ? [page.img.model, page.vid.model, page.save, closeBtn] : orig(sel)))(page.surface.querySelectorAll);
    page.surface.parentElement = new FakeElement({ tag: "div" });
    const restored = await adapter.restoreComposer(page.doc, { timeoutMs: 300, pollMs: 10 });
    assert(restored.restored === true, `restoration must complete: ${JSON.stringify(restored)}`);
    assert(closeBtn.clicked >= 1, `drawer close control used (clicked=${closeBtn.clicked})`);
    assert(promptEl && genEl, "composer still registered");
  });

  // POST-v1F §5: preparation must leave the composer usable. Live, a bare
  // Escape did not close the Agent Settings drawer and Start stayed covered.
  await t("v1F preparation restores the composer after Agent Settings", async () => {
    const page = liveAgentSettingsPage();
    const closeBtn = wireDrawerClose(page);
    page.always.attrs["aria-checked"] = "true";
    page.img.aspects["1:1"].attrs["aria-checked"] = "true";
    page.img.outs.x1.attrs["aria-checked"] = "true";
    const agent = await adapter.prepareAgentSettings(page.doc, {});
    assert(agent.composerRestored === true, `composer must be restored: ${JSON.stringify(agent)}`);
    assert(closeBtn.clicked >= 1, `drawer closed via its own control (clicked=${closeBtn.clicked})`);
    assert(adapter.agentSettingsDrawerOpen(page.doc) === false, "drawer actually unmounted");
  });

  /**
   * Live behaviour of the Agent Settings drawer: closing it UNMOUNTS its
   * content, which is the only way restoration can be proven without
   * coordinates (forbidden by the adapter contract).
   */
  function wireDrawerClose(page) {
    const closeBtn = new FakeElement({ tag: "button", attrs: { "aria-label": "Close" } });
    closeBtn.textContent = "close";
    closeBtn.click = () => {
      closeBtn.clicked += 1;
      page.doc.map["button"] = [];
      page.doc.map["h1, h2, h3, h4, h5, h6"] = [];
      page.doc.map[CLICKABLE_SEL] = [];
      page.drawerOpen = false;
    };
    page.surface.querySelectorAll = ((orig) => (sel) => (sel === "button" ? [page.img.model, page.vid.model, page.save, closeBtn] : orig(sel)))(page.surface.querySelectorAll);
    return closeBtn;
  }

  await t("v1F a visible-but-covered composer is not accepted as restored", async () => {
    const page = liveAgentSettingsPage({ neverSelected: false });
    assert(adapter.agentSettingsDrawerOpen(page.doc) === true, "drawer is mounted before closing");
    const closeBtn = wireDrawerClose(page);
    const restored = await adapter.restoreComposer(page.doc, { timeoutMs: 300, pollMs: 10 });
    assert(restored.restored === true, `restoration must complete: ${JSON.stringify(restored)}`);
    assert(closeBtn.clicked >= 1, `drawer close control used (clicked=${closeBtn.clicked})`);
    assert(adapter.agentSettingsDrawerOpen(page.doc) === false, "drawer unmounted after closing");
  });

  await t("v1F AWAIT_SUBMIT_ACCEPTANCE is read-only: it never clicks, it only observes", async () => {
    const page = confirmationGatePage();
    const confirm = mkBtn("Confirm generation");
    page.genBtn.click = () => {
      page.genBtn.clicked += 1;
      page.doc.map[CLICKABLE_SEL] = [confirm];
    };
    // baseline captured by the command itself, as it would be at approve time
    const before = adapter.captureSubmitBaseline(page.doc);
    const res = await commands.dispatchContentCommand(
      adapter,
      page.doc,
      { type: "AWAIT_SUBMIT_ACCEPTANCE", jobId: "j1", attempt: 1, timeoutMs: 100 },
      {}
    );
    assert(res.ok === true, `poll must answer: ${JSON.stringify(res)}`);
    assert(res.poll === 1, `first poll: ${res.poll}`);
    assert(res.submitAcceptedByFlow === false && res.code === "SUBMIT_NOT_ACCEPTED", `not accepted yet: ${JSON.stringify(res)}`);
    assert(confirm.clicked === 0, `the read-only poll must NEVER click a confirmation (clicked=${confirm.clicked})`);
    assert(page.genBtn.clicked === 0, `the read-only poll must never click Generate (clicked=${page.genBtn.clicked})`);
    void before;
  });

  await t("v1F AWAIT_SUBMIT_ACCEPTANCE reports acceptance once the user commits the turn", async () => {
    const page = confirmationGatePage();
    const res1 = await commands.dispatchContentCommand(adapter, page.doc, { type: "AWAIT_SUBMIT_ACCEPTANCE", jobId: "j2", attempt: 1, timeoutMs: 80 }, {});
    assert(res1.submitAcceptedByFlow === false, "still waiting");
    clearPrompt(page); // the user's own Start click committed the turn
    const res2 = await commands.dispatchContentCommand(adapter, page.doc, { type: "AWAIT_SUBMIT_ACCEPTANCE", jobId: "j2", attempt: 1, timeoutMs: 200 }, {});
    assert(res2.submitAcceptedByFlow === true, `accepted after the gesture: ${JSON.stringify(res2)}`);
    assert(res2.acceptanceSignal === "composer-cleared", `signal: ${res2.acceptanceSignal}`);
    assert(res2.poll === 2, `poll counter: ${res2.poll}`);
  });

  // POST-v1F live bug: the live run reached RESULT_DETECTED and then died with
  // "Buffer is not defined" — a content script has no Node Buffer.
  await t("v1F result bytes are base64-encoded without Node Buffer", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bin = Buffer.from(png, "base64");
    const got = commands.bytesToBase64(new Uint8Array(bin));
    assert(got === png, `round-trip must be exact: ${got.slice(0, 24)}…`);
    // a large payload must chunk, not build one giant string path
    const big = new Uint8Array(0x8000 * 2 + 7).fill(65);
    assert(commands.bytesToBase64(big).length === Math.ceil(big.length / 3) * 4, `chunked length: ${commands.bytesToBase64(big).length}`);
  });

  await t("v1F FETCH_RESULT_BYTES works without Buffer in the isolated world", async () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bin = Buffer.from(png, "base64");
    const doc = new FakeDocument({});
    doc.map[S("RESULT_CONTAINER")] = new FakeElement({ tag: "div" });
    doc.map[S("RESULT_CONTAINER")].querySelectorAll = (sel) => (sel === "img" ? [{ src: "https://lh3.googleusercontent.com/a/one" }] : []);
    const savedBuffer = global.Buffer;
    try {
      global.Buffer = undefined; // simulate the content-script world
      // POST-v1F: bytes are fetched for an EXPLICIT correlated candidate, never
      // for "the first media currently on the page".
      const unproven = await commands.dispatchContentCommand(adapter, doc, { type: "FETCH_RESULT_BYTES" }, {
        fetchImpl: async () => {
          throw new Error("must not fetch without a correlated candidate");
        },
      });
      assert(unproven.ok === false && /RESULT_CORRELATION_REQUIRED/.test(unproven.code), `no candidate url refused: ${JSON.stringify(unproven).slice(0, 160)}`);
      const target = "https://flow.google.com/asb/AAA=s512-rw";
      const res = await commands.dispatchContentCommand(adapter, doc, { type: "FETCH_RESULT_BYTES", url: target, candidateId: "c1" }, {
        fetchImpl: async (url, opts) => {
          assert(url === target, "fetches the correlated candidate url, not the first page media");
          assert(opts && opts.credentials === "include", "authenticated media fetch keeps credentials");
          return {
            arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
            headers: { get: () => "image/png" },
          };
        },
      });
      assert(res.ok === true && res.mime === "image/png", `fetch: ${JSON.stringify(res).slice(0, 160)}`);
      assert(res.url === target, "the fetched url is the correlated candidate");
      assert(res.bytes === bin.length, `bytes: ${res.bytes}`);
      assert(res.contentBase64 === png, "base64 content is exact without Buffer");
    } finally {
      global.Buffer = savedBuffer;
    }
  });

  // POST-v1F live bug: the broad RESULT_MEDIA fallback also matches the signed-in
  // ACCOUNT AVATAR, so a header image can be imported as "the result".
  await t("v1F the account avatar is never a result candidate", () => {
    const avatar = { src: "https://lh3.googleusercontent.com/ogw/AF2bZyga0_kwainzDxR7rvbvrJyaZoOqT3XV97bdjg5rvqJ_Gg=s64-c-mo", naturalWidth: 32, naturalHeight: 32, getAttribute: () => null };
    const root = {
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'img[src*="googleusercontent"]' ? [avatar] : []),
    };
    assert(adapter.detectResults(root).length === 0, "avatar must not be detected as a result");
    assert(adapter.isGeneratedResultCandidate(avatar, avatar.src) === false, "avatar rejected by chrome naming");
    // POST-v1F: the guard must run in the PRIMARY branch too. It used to run
    // only in the fallback scan, so the avatar walked straight through.
    const chromeImg = { src: avatar.src, naturalWidth: 32, naturalHeight: 32, getAttribute: () => null };
    const primaryRoot = {
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'img' ? [chromeImg] : []),
    };
    assert(adapter.detectResults(primaryRoot).length === 0, "avatar rejected in the primary branch too");
  });

  await t("v1F generated-media detection and full-resolution selection", () => {
    const asb = (id, suffix = "=s512-rw") => `https://flow.google.com/asb/${id}${suffix}`;
    const real = { src: asb("REAL"), naturalWidth: 1024, naturalHeight: 1024, getAttribute: () => null };
    assert(adapter.isGeneratedResultCandidate(real, real.src) === true, "Flow /asb/ output accepted");
    const labelled = { src: "https://example.invalid/x.png", naturalWidth: 1024, naturalHeight: 1024, getAttribute: (n) => (n === "alt" ? "Google Account: someone" : null) };
    assert(adapter.isGeneratedResultCandidate(labelled, labelled.src) === false, "account-labelled element rejected");
    assert(adapter.resultAssetId(asb("REAL")) === "REAL", "stable asset id extracted from a /asb/ url");
    assert(adapter.resultAssetId("https://lh3.googleusercontent.com/ogw/x=s32-c-mo") === null, "no asset id for avatar chrome");

    // A small /asb/ element is still a CANDIDATE: the minimum-resolution policy
    // lives once in the bridge so the two can never disagree. Chrome is refused
    // here on naming, not on a duplicated pixel threshold.
    const small = { src: asb("SMALL", "=s64-rw"), naturalWidth: 64, naturalHeight: 64, getAttribute: () => null };
    assert(adapter.isGeneratedResultCandidate(small, small.src) === true, "small /asb/ media stays a candidate for the bridge to judge");

    // Full-resolution selection: the 512px original beats its 64px sibling.
    const full = { src: asb("SAME"), naturalWidth: 512, naturalHeight: 512, getAttribute: () => null, currentSrc: asb("SAME") };
    const thumb = { src: asb("SAME", "=s64-rw"), naturalWidth: 64, naturalHeight: 64, getAttribute: () => null, currentSrc: asb("SAME", "=s64-rw") };
    const avatarEl = { src: "https://lh3.googleusercontent.com/ogw/x=s32-c-mo", naturalWidth: 32, naturalHeight: 32, getAttribute: () => null };
    const root = {
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel === "img" || sel === "video") return [full, thumb, avatarEl];
        if (sel === 'img[src*="flow.google.com/asb/"]') return [full, thumb];
        if (sel === 'img[src*="googleusercontent"]') return [avatarEl];
        return [];
      },
    };
    const cands = adapter.collectResultCandidates(root, { baselineUrls: [] });
    assert(cands.length === 1, `one candidate per logical asset (got ${cands.length})`);
    assert(cands[0].url === asb("SAME") && cands[0].naturalWidth === 512, "the full-resolution variant is selected");
    assert(cands[0].isNew === true, "new-vs-baseline decision recorded");
    assert(typeof cands[0].candidateId === "string" && cands[0].candidateId.length > 0, "stable candidate id assigned");
  });

  // ---- Hardening sweep (B-12): credit-gate helper semantics (the single most
  // credit-sensitive logic in the extension was exported but untested).
  await t("TI recordLocalApproval stores jobId+attempt+nonce+fingerprint single-use", () => {
    const map = new Map();
    creditGate.recordLocalApproval(map, { jobId: "J", attempt: 1, approvedBy: "user", nonce: "n1", fingerprint: "f1" });
    const ap = map.get("J");
    assert(ap && ap.used === false && ap.nonce === "n1" && ap.fingerprint === "f1", "approval recorded unused with binding");
  });
  await t("TI consumeLocalApproval is single-use (replay rejected)", () => {
    const map = new Map();
    creditGate.recordLocalApproval(map, { jobId: "J", attempt: 1, approvedBy: "user", nonce: "n1" });
    creditGate.consumeLocalApproval(map, "J", 1, { nonce: "n1" });
    let threw = null;
    try { creditGate.consumeLocalApproval(map, "J", 1, { nonce: "n1" }); } catch (e) { threw = e.message; }
    assert(threw && /APPROVAL_REQUIRED/.test(threw), `replay must throw APPROVAL_REQUIRED (${threw})`);
  });
  await t("TI consumeLocalApproval rejects attempt mismatch", () => {
    const map = new Map();
    creditGate.recordLocalApproval(map, { jobId: "J", attempt: 1, approvedBy: "user" });
    let threw = null;
    try { creditGate.consumeLocalApproval(map, "J", 2, {}); } catch (e) { threw = e.message; }
    assert(threw && /APPROVAL_MISMATCH/.test(threw), `attempt mismatch must throw (${threw})`);
  });
  await t("TI consumeLocalApproval rejects a different nonce when one is recorded", () => {
    const map = new Map();
    creditGate.recordLocalApproval(map, { jobId: "J", attempt: 1, approvedBy: "user", nonce: "n1" });
    let threw = null;
    try { creditGate.consumeLocalApproval(map, "J", 1, { nonce: "n2" }); } catch (e) { threw = e.message; }
    assert(threw && /APPROVAL_MISMATCH/.test(threw), `nonce mismatch must throw (${threw})`);
  });
  await t("TI consumeLocalApproval rejects a different fingerprint (APPROVAL_STALE_CHANGED)", () => {
    const map = new Map();
    creditGate.recordLocalApproval(map, { jobId: "J", attempt: 1, approvedBy: "user", fingerprint: "f1" });
    let threw = null;
    try { creditGate.consumeLocalApproval(map, "J", 1, { fingerprint: "f2" }); } catch (e) { threw = e.message; }
    assert(threw && /APPROVAL_STALE_CHANGED/.test(threw), `fingerprint mismatch must throw (${threw})`);
  });
  await t("TI consumeLocalApproval stays backward compatible when neither side carries nonce/fingerprint", () => {
    const map = new Map();
    creditGate.recordLocalApproval(map, { jobId: "J", attempt: 1, approvedBy: "user" });
    const ap = creditGate.consumeLocalApproval(map, "J", 1, {});
    assert(ap && ap.used === true, "both-absent legacy consume still works");
  });
  await t("TI validateSender rejects foreign chrome-extension senders (C-6)", () => {
    // validateSender lives on the SW module surface; simulate a foreign id.
    const foreign = { id: "someotherextension", origin: "chrome-extension://someotherextension/index.html", url: "chrome-extension://someotherextension/index.html" };
    // chrome.runtime.id is absent in node — the guard must reject foreign ids.
    let threw = null;
    try { creditGate.validateSender(foreign); } catch (e) { threw = e.message; }
    assert(threw && /SENDER_REJECTED/.test(threw), `foreign extension sender must be rejected (${threw})`);
    const flowSender = { id: "x", url: "https://flow.google.com/about" };
    assert(creditGate.validateSender(flowSender) === true, "Flow content-script sender still accepted");
  });

  console.log(`passed=${passed} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(`runner crashed: ${e.stack || e}`);
  process.exit(1);
});
