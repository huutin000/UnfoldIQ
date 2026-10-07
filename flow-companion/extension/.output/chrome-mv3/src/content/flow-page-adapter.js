"use strict";

/**
 * UNFOLDIQ Flow Companion — centralized Flow page adapter (STEP 10B + POST-v1B).
 * ALL Google Flow DOM interaction lives in this file. Nothing else in the
 * extension, bridge, or provider adapter may touch Flow DOM directly.
 *
 * Selectors below are BEST-EFFORT PLACEHOLDERS (NOT_VERIFIED against live
 * Flow UI). Any missing selector fails safe to MANUAL_ASSIST_REQUIRED —
 * never blind clicks, never fixed-sleep success assumptions.
 *
 * POST-v1B additions (same file, no second adapter):
 * - per-control primary + constrained fallback lists (role/aria → structural
 *   attributes → constrained text → structural fallback);
 * - selector-health contract (PASS / DEGRADED / FAIL / NOT_APPLICABLE);
 * - standard-vs-agent mode detection, model/cost/aspect read helpers;
 * - zero-credit dry-run prompt insertion (never clicks Generate);
 * - observable result observation (MutationObserver when available, else
 *   bounded polling); success is never a fixed sleep.
 *
 * DOM-abstracted: every function takes a `root` exposing
 * querySelector/querySelectorAll, so logic is unit-testable with a mock.
 */

const ADAPTER_VERSION = "0.4.13-fix03";
// POST-v1E.1: selector candidate set version — bump when candidates change.
const SELECTORS_VERSION = 6;

const SELECTORS = {
  PROMPT_INPUT: {
    selector: '[data-testid="flow-prompt-input"]',
    status: "NOT_VERIFIED",
    fallbacks: ['textarea[aria-label*="prompt" i]', '[role="textbox"][aria-label*="prompt" i]', 'textarea[placeholder*="prompt" i]', '[contenteditable="true"]'],
  },
  GENERATE_BUTTON: {
    selector: '[data-testid="flow-generate-button"]',
    status: "NOT_VERIFIED",
    fallbacks: [
      'button[aria-label*="generate" i]',
      'button[aria-label*="create" i]',
      'button[aria-label*="send" i]',
      'button[aria-label*="submit" i]',
      'button[type="submit"]',
      '[role="button"][aria-label*="generate" i]',
      '[role="button"][aria-label*="create" i]',
      '[role="button"][aria-label*="send" i]',
      'button[data-action="generate"]',
    ],
  },
  MODE_IMAGE: {
    selector: '[data-testid="flow-mode-image"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[role="tab"][aria-label*="image" i]', 'button[aria-label*="image" i]', '[role="tab"][aria-selected="true"]'],
  },
  MODE_VIDEO: {
    selector: '[data-testid="flow-mode-video"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[role="tab"][aria-label*="video" i]', 'button[aria-label*="video" i]', '[role="tab"][aria-selected="true"]'],
  },
  GENERATION_TYPE: {
    selector: '[data-testid="flow-generation-type"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[role="tablist"][aria-label*="generation" i]', '[role="tablist"]', '[role="tab"]', '[aria-label*="text to image" i]', '[aria-label*="text to video" i]'],
  },
  MODEL_CONTROL: {
    selector: '[data-testid="flow-model-control"]',
    status: "NOT_VERIFIED",
    fallbacks: [
      '[aria-label*="model" i]',
      '[aria-label*="veo" i]',
      '[aria-label*="imagen" i]',
      '[data-testid="model-picker"]',
      'button[aria-haspopup="listbox"]',
      'button[aria-haspopup="dialog"]',
      '[role="combobox"]',
      '[role="button"][aria-haspopup="listbox"]',
    ],
  },
  ASPECT_CONTROL: {
    selector: '[data-testid="flow-aspect-control"]',
    status: "NOT_VERIFIED",
    fallbacks: [
      '[aria-label*="aspect" i]',
      '[aria-label*="ratio" i]',
      '[aria-label*="orientation" i]',
      '[aria-label*="landscape" i]',
      '[aria-label*="portrait" i]',
      '[aria-label*="16:9" i]',
      '[aria-label*="9:16" i]',
      '[aria-label*="square" i]',
    ],
  },
  OUTPUT_COUNT: {
    selector: '[data-testid="flow-output-count"]',
    status: "NOT_VERIFIED",
    fallbacks: [
      '[aria-label*="output" i]',
      '[aria-label*="number of results" i]',
      '[aria-label*="per prompt" i]',
      '[aria-label*="results per" i]',
      '[aria-label*="count" i]',
      '[role="spinbutton"]',
      'input[type="number"]',
      '[role="radiogroup"][aria-label*="output" i]',
      '[role="listbox"][aria-label*="output" i]',
    ],
  },
  LENGTH_CONTROL: {
    selector: '[data-testid="flow-length-control"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="duration" i]', '[aria-label*="length" i]'],
  },
  CREDIT_DISPLAY: {
    selector: '[data-testid="flow-credit-display"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="credit" i]', '[data-testid="credit-cost"]', 'button[aria-label*="credit" i]', '[title*="credit" i]'],
  },
  REFERENCE_INPUT: {
    selector: '[data-testid="flow-reference-input"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="ingredient" i]', '[aria-label*="reference" i]', 'input[type="file"][accept*="image"]'],
  },
  START_FRAME_INPUT: {
    selector: '[data-testid="flow-start-frame-input"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="start frame" i]'],
  },
  END_FRAME_INPUT: {
    selector: '[data-testid="flow-end-frame-input"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="end frame" i]'],
  },
  RESULT_CONTAINER: {
    selector: '[data-testid="flow-result-container"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[role="feed"][aria-label*="result" i]', '[aria-label*="outputs" i]', '[aria-live="polite"]'],
  },
  RESULT_MEDIA: {
    selector: '[data-testid="flow-result-media"]',
    status: "NOT_VERIFIED",
    // POST-v1F: `flow.google.com/asb/` is where Flow actually serves project
    // and generated media. Without it the detector could only ever see the
    // account avatar, which is how a 32x32 header image got imported as the
    // result. `googleusercontent` stays for older/other surfaces but is guarded.
    fallbacks: ['img[src^="blob:"]', 'video[src^="blob:"]', 'img[src*="flow.google.com/asb/"]', 'video[src*="flow.google.com/asb/"]', 'img[src*="googleusercontent"]', 'video[src]', 'img[alt*="generated" i]'],
  },
  DOWNLOAD_CONTROL: {
    selector: '[data-testid="flow-download-control"]',
    status: "NOT_VERIFIED",
    fallbacks: [
      'button[aria-label*="download" i]',
      'button[aria-label*="save" i]',
      'button[aria-label*="export" i]',
      'button[title*="download" i]',
      '[role="menuitem"][aria-label*="download" i]',
      '[role="menuitem"][aria-label*="save" i]',
      'a[download]',
    ],
  },
  AGENT_MODE: {
    selector: '[data-testid="flow-agent-mode"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="flow agent" i]', '[role="switch"][aria-label*="agent" i]'],
  },
  // 1G.9 Agent Instructions surface (official UI per Flow Help 17093911:
  // prompt box → "Agent Instructions" → "Add instruction" → guidelines +
  // reference image → "Done"). BEST-EFFORT PLACEHOLDERS, NOT_VERIFIED
  // against live UI; missing surface fails safe, never blind-clicks.
  AGENT_INSTRUCTIONS_BUTTON: {
    // FIX 02 §9 ADOPTED 2026-10-03: element with this aria-label observed live
    // on the operator tab (diagnostics + probe, Agent panel context, twice).
    selector: '[aria-label*="agent instructions" i]',
    status: "VERIFIED",
    fallbacks: ['[data-testid="flow-agent-instructions"]', 'button[aria-label*="instructions" i]'],
  },
  INSTRUCTION_ADD: {
    // FIX 02 §9 ADOPTED 2026-10-03 via text channel: visible "Add instruction"
    // control observed live (diagnostics text-evidence + official chain
    // "Agent Instructions → Add instruction"). Primary placeholder kept;
    // live matches arrive through TEXT_FALLBACKS and must be unique (§13 gate).
    selector: '[data-testid="flow-instruction-add"]',
    status: "VERIFIED",
    fallbacks: ['[aria-label*="add instruction" i]', 'button[aria-label*="add instruction" i]'],
  },
  INSTRUCTION_EDITOR: {
    // FIX 02 §9 ADOPTED 2026-10-03: textarea[aria-label="Instruction
    // description"] observed live in the open Instructions panel (probe).
    selector: 'textarea[aria-label="Instruction description"]',
    status: "VERIFIED",
    fallbacks: ['[data-testid="flow-instruction-editor"]', 'textarea[aria-label*="instruction" i]', '[role="textbox"][aria-label*="instruction" i]', '[role="dialog"] textarea'],
  },
  INSTRUCTION_DONE: {
    // FIX 02 §9 ADOPTED 2026-10-03 via text channel: visible "Done" observed
    // live (diagnostics text-evidence + official "Click Done"). Same
    // uniqueness rule as INSTRUCTION_ADD.
    selector: '[data-testid="flow-instruction-done"]',
    status: "VERIFIED",
    fallbacks: ['button[aria-label*="done" i][aria-label*="instruction" i]', '[role="dialog"] button[aria-label*="done" i]'],
  },
  INSTRUCTION_READBACK: {
    selector: '[data-testid="flow-instruction-readback"]',
    status: "NOT_VERIFIED",
    fallbacks: ['[aria-label*="agent instructions" i]', '[role="dialog"] [aria-label*="instruction" i]'],
  },
  INSTRUCTION_REFERENCE_ATTACH: {
    selector: '[data-testid="flow-instruction-reference-attach"]',
    status: "NOT_VERIFIED",
    fallbacks: ['input[type="file"][aria-label*="reference" i]', 'input[type="file"][aria-label*="instruction" i]', 'button[aria-label*="attach reference" i]', 'button[aria-label*="add reference" i]'],
  },
  SAFETY_MESSAGE: { selector: '[data-testid="flow-safety-message"]', status: "NOT_VERIFIED", fallbacks: ['[role="alert"]'] },
  POLICY_STATE: { selector: '[data-testid="flow-policy-state"]', status: "NOT_VERIFIED", fallbacks: [] },
  FAILURE_STATE: { selector: '[data-testid="flow-failure-state"]', status: "NOT_VERIFIED", fallbacks: ['[data-state="error"]'] },
};

function candidatesFor(key) {
  const def = SELECTORS[key];
  if (!def) return [];
  return [def.selector, ...((def && def.fallbacks) || [])];
}

/**
 * Constrained visible-text fallbacks (last resort, always DEGRADED).
 * Each entry scans only button-like controls, requires a short label
 * (maxLen) matching a narrow pattern — never arbitrary page text, never
 * generated class names, nth-child, coordinates, or sleeps.
 */
const TEXT_FALLBACKS = {
  GENERATE_BUTTON: { selectors: ["button", '[role="button"]'], pattern: /generat|creat\w*\s+(image|video|clip)|^(send|go|render)$/i, maxLen: 28 },
  MODE_IMAGE: { selectors: ['[role="tab"]', "button"], pattern: /\bimage\b/i, maxLen: 24 },
  MODE_VIDEO: { selectors: ['[role="tab"]', "button"], pattern: /\bvideo\b/i, maxLen: 24 },
  GENERATION_TYPE: { selectors: ['[role="tab"]'], pattern: /image|video/i, maxLen: 24 },
  MODEL_CONTROL: { selectors: ["button", '[role="button"]'], pattern: /veo|imagen|\bmodel\b/i, maxLen: 40 },
  ASPECT_CONTROL: { selectors: ["button", '[role="button"]'], pattern: /16:9|9:16|1:1|landscape|portrait|\baspect\b/i, maxLen: 24 },
  OUTPUT_COUNT: { selectors: ["button", '[role="button"]', '[role="spinbutton"]'], pattern: /output|per prompt/i, maxLen: 28 },
  DOWNLOAD_CONTROL: { selectors: ["button", '[role="menuitem"]', "a"], pattern: /download|\bsave\b|export/i, maxLen: 24 },
  CREDIT_DISPLAY: { selectors: ["button", '[role="button"]', "span"], pattern: /credit/i, maxLen: 40 },
  // FIX 02 live evidence (operator tab 2026-10-03): the Agent pill and the
  // instruction buttons carry visible text but no stable test/aria hooks, and
  // the generic probe caps button output. Constrained text match is the only
  // honest channel — always DEGRADED, adoption still needs §9 evidence.
  AGENT_MODE: { selectors: ["button", '[role="button"]'], pattern: /^\s*agent\s*$/i, maxLen: 16 },
  AGENT_INSTRUCTIONS_BUTTON: { selectors: ["button", '[role="button"]', '[role="menuitem"]'], pattern: /agent instructions/i, maxLen: 32 },
  INSTRUCTION_ADD: { selectors: ["button", '[role="button"]', '[role="menuitem"]'], pattern: /add instruction/i, maxLen: 32 },
  INSTRUCTION_DONE: { selectors: ["button", '[role="button"]'], pattern: /^\s*done\s*$/i, maxLen: 16 },
};

function shortControlLabel(el, maxLen) {
  let t = "";
  try {
    if (typeof el.textContent === "string" && el.textContent) t = el.textContent;
    else if (typeof el.innerText === "string" && el.innerText) t = el.innerText;
  } catch {
    t = "";
  }
  t = String(t || "").replace(/\s+/g, " ").trim();
  if (!t && el && typeof el.getAttribute === "function") {
    try {
      t = String(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("value") || "");
    } catch {
      t = "";
    }
    t = t.replace(/\s+/g, " ").trim();
  }
  if (!t || t.length > maxLen) return null;
  return t;
}

function findControlByText(root, spec) {
  for (const sel of spec.selectors) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      const label = shortControlLabel(el, spec.maxLen || 28);
      if (label && spec.pattern.test(label)) return { el, label };
    }
  }
  return null;
}

/** Primary + fallback lookup. Returns { el, matchedSelector, fallbackUsed }. */
function queryWithFallback(root, key) {
  const cands = candidatesFor(key);
  for (let i = 0; i < cands.length; i++) {
    let el = null;
    try {
      el = root.querySelector(cands[i]);
    } catch {
      el = null;
    }
    if (el) return { el, matchedSelector: cands[i], fallbackUsed: i > 0 };
  }
  const tf = TEXT_FALLBACKS[key];
  if (tf) {
    const hit = findControlByText(root, tf);
    if (hit) return { el: hit.el, matchedSelector: `text:${tf.pattern}`, fallbackUsed: true };
  }
  return { el: null, matchedSelector: null, fallbackUsed: false };
}

function query(root, key) {
  return queryWithFallback(root, key).el;
}

function requireEl(root, key) {
  const found = queryWithFallback(root, key);
  if (!found.el) throw new Error(`SELECTOR_MISSING: ${key}`);
  return found.el;
}

function selectorHealth(root) {
  const out = {};
  for (const key of Object.keys(SELECTORS)) {
    out[key] = query(root, key) ? "OK" : "MISSING";
  }
  return out;
}

/**
 * POST-v1B selector-health contract (§12).
 * PASS: primary matched. DEGRADED: fallback matched (fallbackUsed reported).
 * FAIL: nothing matched. NOT_APPLICABLE: control not required for this job
 * (e.g. video-only controls on an image job, or agent indicator when the
 * page has no agent feature — caller decides via `applicability`).
 */
function selectorHealthContract(root, applicability = {}) {
  const out = {};
  for (const key of Object.keys(SELECTORS)) {
    if (applicability[key] === false) {
      out[key] = { status: "NOT_APPLICABLE", primary: SELECTORS[key].selector, fallbackUsed: null };
      continue;
    }
    const found = queryWithFallback(root, key);
    if (found.el && !found.fallbackUsed) {
      out[key] = { status: "PASS", primary: SELECTORS[key].selector, fallbackUsed: null };
    } else if (found.el && found.fallbackUsed) {
      out[key] = { status: "DEGRADED", primary: SELECTORS[key].selector, fallbackUsed: found.matchedSelector };
    } else {
      out[key] = { status: "FAIL", primary: SELECTORS[key].selector, fallbackUsed: null };
    }
  }
  return out;
}

function missingSelectors(root, keys) {
  return keys.filter((k) => !query(root, k));
}

/**
 * prepareJob(root, job) → { ok:true } | { manualAssist:true, missing:[...] }
 * Fails safe before touching anything when required controls are absent.
 */
function prepareJob(root, job) {
  const need = ["PROMPT_INPUT", job.capability === "video" ? "MODE_VIDEO" : "MODE_IMAGE", "GENERATE_BUTTON", "RESULT_CONTAINER"];
  if ((job.referenceAssets || []).length > 0 || (job.ingredients || []).length > 0) need.push("REFERENCE_INPUT");
  if (job.startFrame) need.push("START_FRAME_INPUT");
  if (job.endFrame) need.push("END_FRAME_INPUT");
  const missing = missingSelectors(root, need);
  if (missing.length > 0) return { manualAssist: true, missing };
  return { ok: true };
}

function detectPromptControl(root) {
  return query(root, "PROMPT_INPUT");
}

/** Standard Flow prompt UI vs Flow Agent UI detection (§9). Never toggles settings. */
function detectFlowAgentMode(root) {
  const found = queryWithFallback(root, "AGENT_MODE");
  const agent = found.el;
  if (!agent) return { detected: false, mode: "STANDARD" };
  let enabled = null;
  try {
    const aria = agent.getAttribute && (agent.getAttribute("aria-checked") || agent.getAttribute("aria-pressed"));
    if (aria === "true") enabled = true;
    else if (aria === "false") enabled = false;
    else if (typeof agent.checked === "boolean") enabled = agent.checked;
  } catch {
    enabled = null;
  }
  return { detected: true, mode: enabled === true ? "AGENT" : enabled === false ? "STANDARD" : "AGENT_UI_PRESENT", enabled, via: found.fallbackUsed ? "text" : "selector" };
}

/**
 * 1G.9 Agent Instructions surface detection (read-only, never clicks).
 * Returns which controls of the official apply chain are present:
 * instructions button → add → editor → done, plus the readback surface.
 * Anything missing fails safe to MANUAL_ASSIST_REQUIRED upstream.
 */
function detectInstructionsSurface(root) {
  const present = (key) => !!query(root, key);
  return {
    instructionsButton: present("AGENT_INSTRUCTIONS_BUTTON"),
    addControl: present("INSTRUCTION_ADD"),
    editor: present("INSTRUCTION_EDITOR"),
    doneControl: present("INSTRUCTION_DONE"),
    readbackSurface: present("INSTRUCTION_READBACK"),
  };
}

/**
 * 1G.9 provider readback extractor (read-only). Reads guideline VALUES from
 * actual editor fields across every match — never container text (icon
 * ligatures like material-symbol names are not guidelines). Returns
 * { available, text, referenceIds, rawEvidence } or { available:false,
 * reason } with reason READBACK_SURFACE_MISSING (no editor/surface at all)
 * vs READBACK_EMPTY (fields exist but hold no text). Never the attempted
 * payload.
 */
function extractInstructionReadback(root) {
  const seen = new Set();
  const texts = [];
  for (const sel of candidatesFor("INSTRUCTION_EDITOR")) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const ed of list) {
      if (seen.has(ed)) continue;
      seen.add(ed);
      const t = readInstructionEditorText(ed);
      if (t && t.trim()) texts.push(t.trim().slice(0, 8000));
    }
  }
  const referenceIds = [];
  try {
    const scopes = [];
    for (const sel of [...candidatesFor("INSTRUCTION_READBACK"), ...candidatesFor("INSTRUCTION_EDITOR")]) {
      try {
        for (const el of root.querySelectorAll(sel) || []) scopes.push(el);
      } catch { /* next selector */ }
    }
    for (const scope of scopes) {
      const imgs = (scope.querySelectorAll && scope.querySelectorAll("img[alt], [data-reference-id], [data-asset-id]")) || [];
      for (const img of imgs) {
        const id = (img.getAttribute && (img.getAttribute("data-reference-id") || img.getAttribute("data-asset-id") || img.getAttribute("alt"))) || null;
        if (id) referenceIds.push(String(id).slice(0, 128));
      }
    }
  } catch {
    /* reference extraction is best-effort; text readback stands alone */
  }
  if (texts.length > 0) {
    return { available: true, text: texts[0], referenceIds, rawEvidence: `dom-readback:${texts.length}` };
  }
  let anyField = seen.size > 0;
  if (!anyField) {
    try {
      anyField = !!query(root, "INSTRUCTION_READBACK");
    } catch {
      anyField = false;
    }
  }
  if (!anyField) return { available: false, reason: "READBACK_SURFACE_MISSING", text: "", referenceIds };
  return { available: false, reason: "READBACK_EMPTY", text: "", referenceIds };
}

/** Shared instruction-editor text reader (value → innerText → textContent). */
function readInstructionEditorText(editor) {
  try {
    if (editor && typeof editor.value === "string" && editor.value.trim()) return editor.value;
    if (editor && editor.innerText && editor.innerText.trim()) return editor.innerText;
    if (editor && editor.textContent && editor.textContent.trim()) return editor.textContent;
  } catch {
    return "";
  }
  return "";
}

/**
 * FIX 02 §5 — read-only provider project identity extraction.
 * Preferred: stable provider project ref from URL/router pathname
 * (query strings are stripped before matching so no tokens leak into
 * evidence). No DOM project-name selector is known, so projectName stays
 * null rather than invented; tab title is never identity.
 * Returns { available, providerProjectRef, projectName, source,
 * confidence, evidence }. confidence: HIGH (router id) | UNKNOWN.
 */
function extractFlowProjectIdentity(root, hrefOverride) {
  let href = typeof hrefOverride === "string" ? hrefOverride : null;
  if (!href) {
    try {
      href = (root && root.location && root.location.href) || null;
    } catch {
      href = null;
    }
  }
  let pathname = null;
  if (href) {
    try {
      pathname = new URL(href).pathname || null;
    } catch {
      pathname = null;
    }
  }
  if (pathname) {
    const m = pathname.match(/^\/(?:project|projects)\/([A-Za-z0-9-_]{1,128})(?:\/|$)/);
    if (m) {
      return { available: true, providerProjectRef: m[1], projectName: null, source: "url-router", confidence: "HIGH", evidence: "pathname:/project(s)/<ref>" };
    }
  }
  return { available: false, providerProjectRef: "UNKNOWN", projectName: null, source: "none", confidence: "UNKNOWN", evidence: "no-router-id" };
}

/**
 * FIX 02 §7 — pure project-identity gate. No DOM, no mutation.
 * VERIFIED only when expected and observed refs are both known and equal.
 */
function verifyProjectIdentity(expectedRef, observedRef) {
  if (!expectedRef || !observedRef || observedRef === "UNKNOWN") {
    return { verified: false, code: "BLOCKED_PROJECT_IDENTITY_UNKNOWN" };
  }
  if (expectedRef !== observedRef) return { verified: false, code: "BLOCKED_PROJECT_MISMATCH" };
  return { verified: true, code: "PROJECT_IDENTITY_VERIFIED" };
}

/**
 * FIX 02 round 6 — select the guideline editor slot without duplicating rows.
 * Rules: exact text present → reuse it (idempotent, no new row); else a single
 * empty editor → use it; multiple empties → AMBIGUOUS (never pick one blind);
 * all occupied differently → OCCUPIED (never clobber); none → ABSENT (caller
 * may Add once, then select again).
 */
function findGuidelineTarget(root, desired) {
  const want = String(desired || "");
  // Provider-side normalization guard (FIX 03): Flow may normalize
  // whitespace inside a persisted guideline, which would make a byte-exact
  // comparison classify our own synced text as "occupied differently" and
  // refuse every re-apply (idempotency broken). A slot whose text equals the
  // desired text after harmless whitespace normalization is the SAME
  // instruction — reuse it (mirrors compare.js harmless normalization).
  const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const wantNorm = normalize(want);
  const seen = new Set();
  const editors = [];
  for (const sel of candidatesFor("INSTRUCTION_EDITOR")) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const ed of list) {
      if (!seen.has(ed)) {
        seen.add(ed);
        editors.push(ed);
      }
    }
  }
  if (editors.length === 0) return { error: "INSTRUCTION_EDITOR_ABSENT" };
  if (want) {
    const exact = editors.find((ed) => readInstructionEditorText(ed) === want);
    if (exact) return { el: exact, exact: true };
    const normalizedExact = editors.find((ed) => normalize(readInstructionEditorText(ed)) === wantNorm);
    if (normalizedExact) return { el: normalizedExact, exact: true, normalized: true };
  }
  const empties = editors.filter((ed) => !readInstructionEditorText(ed));
  if (empties.length === 1) return { el: empties[0], exact: false };
  if (empties.length > 1) return { error: "INSTRUCTION_CONTROL_AMBIGUOUS" };
  return { error: "INSTRUCTION_SLOT_OCCUPIED" };
}

/**
 * Native value setter for React-controlled fields (FIX 02 round 3). Assigning
 * .value directly updates the DOM but not React state, so a later save can
 * persist stale text. The prototype setter + input event keeps both in sync.
 * Returns null outside real browsers (node tests use direct assignment).
 */
function nativeValueSetter(editor) {
  try {
    const tag = editor && editor.tagName;
    const ctor = tag === "TEXTAREA"
      ? (typeof HTMLTextAreaElement !== "undefined" ? HTMLTextAreaElement : null)
      : tag === "INPUT"
        ? (typeof HTMLInputElement !== "undefined" ? HTMLInputElement : null)
        : null;
    if (!ctor || !ctor.prototype) return null;
    const desc = Object.getOwnPropertyDescriptor(ctor.prototype, "value");
    return (desc && typeof desc.set === "function") ? desc.set : null;
  } catch {
    return null;
  }
}

/**
 * FIX 02 §10 — set instruction guidelines text with verified re-read.
 * Single safe retry, exact comparison, precise codes. Never clicks Generate,
 * never touches models/outputs/settings. Refuses to clobber a different
 * existing text (INSTRUCTION_SLOT_OCCUPIED); identical text is a no-op success
 * (idempotent re-apply creates no duplicates). No timers: DOM writes are
 * synchronous; a controlled component that reverts on its own fails here
 * instead of being chased.
 */
function setInstructionGuidelines(root, text) {
  const desired = String(text || "");
  if (!desired) return { ok: false, code: "INSTRUCTION_TEXT_EMPTY", verified: false };
  const target = findGuidelineTarget(root, desired);
  if (target.error) {
    return { ok: false, code: target.error === "INSTRUCTION_EDITOR_ABSENT" ? "INSTRUCTION_EDITOR_MISSING" : target.error, verified: false };
  }
  if (target.exact) return { ok: true, verified: true, attempts: 0, unchanged: true, writePath: "none" };
  const editor = target.el;
  let writePath = "synthetic";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Focus → native set → input + change → blur: covers React-controlled
      // (needs the native setter + input) and uncontrolled hybrids (read on
      // change/blur). Live round 3 proved setter+input alone does not survive
      // Flow's Done/save.
      if (typeof editor.focus === "function") {
        try {
          editor.focus();
        } catch { /* focus is best-effort */ }
      }
      // Live round 5: even insertText-semantics synthetic events did not
      // survive — Flow's editor state likely ignores untrusted events.
      // document.execCommand('insertText') makes the BROWSER emit trusted
      // input events, the closest automation gets to real keystrokes.
      // Absent outside real browsers (node) or on failure, fall through to
      // the synthetic path below.
      let trustedWrote = false;
      if (typeof document !== "undefined" && document && typeof document.execCommand === "function") {
        try {
          // Guard: only emit into the focused editor — a missed focus would
          // land keystrokes in whatever field actually has the caret.
          if (document.activeElement === editor) trustedWrote = document.execCommand("insertText", false, desired) === true;
        } catch {
          trustedWrote = false;
        }
      }
      if (trustedWrote) writePath = "trusted-execCommand";
      if (!trustedWrote) {
        const setter = nativeValueSetter(editor);
        if (setter) setter.call(editor, desired);
        else if (typeof editor.value === "string" || (editor.tagName && (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT"))) editor.value = desired;
        else editor.textContent = desired;
      }
      // Live round 4: plain Event('input') does not register with Flow's
      // editor state (manual keystrokes persist, synthetic plain input did
      // not). Emit an input event carrying insertText semantics when the
      // constructor exists; plain Event remains the fallback.
      const emit = (type, extra) => {
        if (typeof Event === "undefined" || !editor || typeof editor.dispatchEvent !== "function") return;
        try {
          if (type === "input" && typeof InputEvent !== "undefined") {
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: desired, ...(extra || {}) }));
          } else {
            editor.dispatchEvent(new Event(type, { bubbles: true }));
          }
        } catch { /* events are best-effort; the re-read below decides */ }
      };
      emit("input");
      emit("change");
      // No explicit blur: focus stays in the field until the real Done click,
      // mirroring the manual flow (a programmatic blur risks committing or
      // discarding through a stale frame before Done runs).
    } catch {
      return { ok: false, code: "INSTRUCTION_EDITOR_NOT_WRITABLE", verified: false };
    }
    if (readInstructionEditorText(editor) === desired) return { ok: true, verified: true, attempts: attempt, writePath };
  }
  return { ok: false, code: "GUIDELINES_VERIFY_FAILED", verified: false };
}

/**
 * FIX 03 §8/§10 — least-privileged guidelines write with app-state
 * acknowledgement. FIX 02 + FIX 03 live evidence: isolated-world writes AND
 * main-world browser-emitted events verify in-DOM but never survive Done/save
 * (the page framework never accepts the value). Strategy order, each gated by
 * a framework-verifiable acknowledgement, never by the DOM text:
 *   1. MAIN_WORLD_INPUT_SEQUENCE — page-world native setter + input/change;
 *      accepted ONLY on REACT_PROPS (the framework's own state).
 *   2. CDP trusted input (§10 last resort) — chrome.debugger Input commands
 *      through the browser's real input pipeline, gated + detached in the
 *      service worker; accepted on the post-insert value re-read.
 *   3. ISOLATED_SYNTHETIC — legacy isolated-world path
 *      (setInstructionGuidelines); diagnostics only, appStateAck always false.
 * opts.mainWorldWrite / opts.trustedInputWrite: async transports injected by
 * the content runtime (service-worker round-trips). Absent (node tests
 * without a writer stub) → falls straight through to the isolated path.
 */
/**
 * FIX 03 (live round 9–11 evidence): reset the guideline editor to empty
 * between failed write strategies. Without this, a later transport's insert
 * can CONCATENATE onto the previous strategy's DOM text (live round 9
 * produced a doubled instruction). Only ever called on a slot that was
 * empty or exact at selection time, so resetting restores the gate precondition.
 */
function clearInstructionEditor(editor) {
  try {
    const setter = nativeValueSetter(editor);
    if (setter) setter.call(editor, "");
    else if (typeof editor.value === "string") editor.value = "";
    else return readInstructionEditorText(editor) === "";
  } catch {
    return false;
  }
  return readInstructionEditorText(editor) === "";
}

async function applyInstructionGuidelines(root, text, opts = {}) {
  const desired = String(text || "");
  if (!desired) return { ok: false, code: "INSTRUCTION_TEXT_EMPTY", verified: false, appStateAck: false };
  const target = findGuidelineTarget(root, desired);
  if (target.error) {
    return { ok: false, code: target.error === "INSTRUCTION_EDITOR_ABSENT" ? "INSTRUCTION_EDITOR_MISSING" : target.error, verified: false, appStateAck: false };
  }
  if (target.exact) {
    return { ok: true, verified: true, attempts: 0, unchanged: true, writePath: "none", writeTransport: "NONE", appStateAck: true, ackBasis: "ALREADY_SYNCED" };
  }
  const primary = (SELECTORS.INSTRUCTION_EDITOR && SELECTORS.INSTRUCTION_EDITOR.selector) || null;
  let specIndex = -1;
  if (primary) {
    let primaries = [];
    try {
      primaries = Array.prototype.slice.call(root.querySelectorAll(primary) || []);
    } catch {
      primaries = [];
    }
    specIndex = primaries.indexOf(target.el);
  }
  let mainWorldTried = null;
  if (typeof opts.mainWorldWrite === "function" && specIndex >= 0) {
    let mw = null;
    try {
      mw = await opts.mainWorldWrite({ selector: primary, index: specIndex, text: desired });
    } catch (e) {
      mw = { ok: false, code: "MAIN_WORLD_WRITE_FAILED" };
    }
    // Main-world result is only accepted when the FRAMEWORK's own state
    // acknowledged the value. Live rounds 5–7 (2026-10-04) proved
    // BROWSER_INPUT_EVENTS (execCommand DOM re-read) does NOT survive Flow's
    // save: Done accepts and closes, provider discards, reopen reads empty.
    // Only REACT_PROPS is sufficient evidence from this transport.
    if (mw && mw.ok === true && readInstructionEditorText(target.el) === desired && mw.ackBasis === "REACT_PROPS") {
      return {
        ok: true,
        verified: true,
        attempts: 1,
        writePath: mw.writePath || "MAIN_WORLD_INPUT_SEQUENCE",
        writeTransport: mw.writePath || "MAIN_WORLD_INPUT_SEQUENCE",
        appStateAck: true,
        ackBasis: mw.ackBasis,
        mainWorld: {
          valueMatches: mw.valueMatches === true,
          valueLength: typeof mw.valueLength === "number" ? mw.valueLength : null,
          propsValueLength: typeof mw.propsValueLength === "number" ? mw.propsValueLength : null,
          fingerprint: mw.fingerprint || null,
        },
      };
    }
    // Otherwise fall through so the next strategy runs and diagnostics stay
    // honest (the insufficient ack is never treated as a saveable write).
    mainWorldTried = { writePath: mw.writePath || null, ackBasis: mw.ackBasis || null, appStateAck: mw.appStateAck === true };
    // Never let a failed strategy's DOM text concat onto the next one.
    clearInstructionEditor(target.el);
  }
  // FIX 03 §10 — trusted browser-level input (LAST RESORT, live-evidence
  // backed): main-world input sequences and browser-emitted execCommand
  // events both update the DOM but never reach Flow's editor state (rounds
  // 5–6: Done accepts and closes, provider discards, reopen reads empty).
  // The debugger transport inserts through the browser's real input
  // pipeline; the service worker gates attach (verified tab + project URL
  // recheck) and always detaches. The value re-read here decides.
  let trustedInputCode = null;
  if (typeof opts.trustedInputWrite === "function" && specIndex >= 0 && opts.projectRef) {
    try {
      if (typeof target.el.focus === "function") target.el.focus();
      if (typeof target.el.select === "function") target.el.select();
    } catch { /* focus/selection best-effort */ }
    // Real per-character key events FIRST (what FIX 02's persisted operator
    // typing actually produced); drop-in insertText is the fallback.
    let ti = null;
    let keyErr = null;
    try {
      ti = await opts.trustedInputWrite({ op: "keyText", projectRef: opts.projectRef, text: desired });
    } catch (e) {
      ti = { ok: false, code: String((e && e.message) || e).split(":")[0] };
    }
    if (!(ti && ti.ok === true && readInstructionEditorText(target.el) === desired)) {
      // Key events did not land (or were refused): one insertText pass.
      keyErr = ti && ti.ok === true ? "KEYTEXT_VERIFY_FAILED" : ti && ti.code ? ti.code : "KEYTEXT_FAILED";
      let ti2 = null;
      try {
        ti2 = await opts.trustedInputWrite({ op: "insertText", projectRef: opts.projectRef, text: desired });
      } catch (e) {
        ti2 = { ok: false, code: String((e && e.message) || e).split(":")[0] };
      }
      ti = ti2 && ti2.ok === true ? ti2 : ti;
    }
    if (ti && ti.ok === true && readInstructionEditorText(target.el) === desired) {
      return {
        ok: true,
        verified: true,
        attempts: 1,
        writePath: ti.op === "keyText" ? "CDP_KEY_EVENTS" : "CDP_INPUT_INSERT_TEXT",
        writeTransport: ti.op === "keyText" ? "CDP_KEY_EVENTS" : "CDP_INPUT_INSERT_TEXT",
        appStateAck: true,
        ackBasis: "CDP_TRUSTED_INPUT",
      };
    }
    // Trusted input refused/failed (e.g. TRUSTED_INPUT_PERMISSION_BLOCKED):
    // fall through to the isolated path; the persistence boundary downstream
    // keeps the verdict honest either way.
    trustedInputCode = keyErr || (ti && ti.code) || "TRUSTED_INPUT_FAILED";
    // Never let a failed strategy's DOM text concat onto the next one.
    clearInstructionEditor(target.el);
  }
  const legacy = setInstructionGuidelines(root, desired);
  if (!legacy.ok) {
    return { ok: false, code: legacy.code || "GUIDELINES_VERIFY_FAILED", verified: false, appStateAck: false, attempts: legacy.attempts };
  }
  return {
    ok: true,
    verified: true,
    attempts: legacy.attempts || 1,
    unchanged: legacy.unchanged === true,
    writePath: "ISOLATED_SYNTHETIC",
    writeTransport: "ISOLATED_SYNTHETIC_EVENTS",
    appStateAck: false,
    ackBasis: legacy.unchanged ? "ALREADY_SYNCED" : "NO_FRAMEWORK_ACK",
    mainWorldTried,
    trustedInputCode: typeof trustedInputCode === "string" ? trustedInputCode : null,
  };
}

/**
 * FIX 02 §8 — instruction surface diagnostics (read-only).
 * Per-control { status, selectorEvidence }; status: VERIFIED (primary hit
 * on an adopted selector) | MISSING (no element) | UNKNOWN (fallback-only
 * hit on a NOT_VERIFIED placeholder — purpose unconfirmed).
 */
function instructionControlState(root, key) {
  const def = SELECTORS[key] || { selector: null, status: "NOT_VERIFIED" };
  const found = queryWithFallback(root, key);
  const evidence = { matchedSelector: found.matchedSelector, fallbackUsed: found.fallbackUsed, tableStatus: def.status };
  if (!found.el) return { status: "MISSING", selectorEvidence: evidence };
  // VERIFIED = adopted table entry reached through its primary selector, or
  // through the adopted text channel (exact visible labels observed live).
  // Any other fallback on any table state stays UNKNOWN: purpose unconfirmed.
  if (def.status === "VERIFIED" && (!found.fallbackUsed || (found.matchedSelector || "").startsWith("text:"))) {
    return { status: "VERIFIED", selectorEvidence: evidence };
  }
  return { status: "UNKNOWN", selectorEvidence: evidence };
}

/**
 * FIX 02 §13 — count live matches behind an instruction control lookup.
 * Mutation requires exactly one (INSTRUCTION_CONTROL_AMBIGUOUS otherwise):
 * clicking the first of several same-labeled controls is never acceptable.
 */
function countInstructionMatches(root, key) {
  const found = queryWithFallback(root, key);
  if (!found.el || !found.matchedSelector) return { channel: "none", count: 0, matchedSelector: null };
  if (found.matchedSelector.startsWith("text:")) {
    const tf = TEXT_FALLBACKS[key];
    let n = 0;
    if (tf) {
      for (const sel of tf.selectors) {
        let list = [];
        try {
          list = root.querySelectorAll(sel) || [];
        } catch {
          list = [];
        }
        for (const el of list) {
          const label = shortControlLabel(el, tf.maxLen || 28);
          if (label && tf.pattern.test(label)) n++;
        }
      }
    }
    return { channel: "text", count: n, matchedSelector: found.matchedSelector };
  }
  let n = 0;
  try {
    const list = root.querySelectorAll(found.matchedSelector) || [];
    n = list.length;
  } catch {
    n = 0;
  }
  return { channel: found.fallbackUsed ? "fallback" : "primary", count: n, matchedSelector: found.matchedSelector };
}

function buildInstructionDiagnostics(root) {
  return {
    agentMode: detectFlowAgentMode(root),
    projectIdentity: extractFlowProjectIdentity(root),
    agentInstructionsTrigger: instructionControlState(root, "AGENT_INSTRUCTIONS_BUTTON"),
    addInstructionControl: instructionControlState(root, "INSTRUCTION_ADD"),
    instructionEditor: instructionControlState(root, "INSTRUCTION_EDITOR"),
    referenceAttachmentControl: instructionControlState(root, "INSTRUCTION_REFERENCE_ATTACH"),
    doneSaveControl: instructionControlState(root, "INSTRUCTION_DONE"),
    readbackSurface: instructionControlState(root, "INSTRUCTION_READBACK"),
  };
}

function elementTextValue(el) {
  if (!el) return null;
  if (typeof el.value === "string" && el.value) return el.value;
  if (typeof el.textContent === "string" && el.textContent.trim()) return el.textContent.trim().slice(0, 200);
  if (typeof el.innerText === "string" && el.innerText.trim()) return el.innerText.trim().slice(0, 200);
  if (el.getAttribute) {
    const labelled = el.getAttribute("aria-label") || el.getAttribute("value") || el.getAttribute("title");
    if (labelled) return String(labelled).slice(0, 200);
  }
  return null;
}

/** Read-only observers: model label, credit/cost, aspect — never hard-coded. */

/**
 * POST-v1C: icon/label artifacts that must NEVER be treated as real
 * aspect ratios, model labels, or settings values (live-observed
 * `arrow_forward` was a Material-Symbols ligature, not a setting).
 */
const ICON_GARBAGE_RE =
  /^(arrow_forward|arrow_back|expand_more|expand_less|chevron_right|chevron_left|chevron_down|arrow_drop_down|settings|tune|more_vert|more_horiz|close|menu|search|filter_list|info|help)(\s*[\w\s]*)?$/i;

const GENERIC_MODEL_RE = /^(model|select model|choose model|models?)$/i;

function isIconGarbage(t) {
  if (!t) return true;
  return ICON_GARBAGE_RE.test(String(t).trim());
}

/**
 * POST-v1C aspect validation (§8). Returns a normalized aspect label or
 * null (caller reports UNKNOWN — never fabricates from job metadata).
 * Allowed: explicit ratios (1:1, 16:9, 9:16, 4:3, 3:4, …) or orientation
 * keywords (landscape, portrait, square).
 */
function normalizeAspectLabel(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (!t || t.length > 40 || isIconGarbage(t)) return null;
  const ratio = t.match(/(\d{1,2}\s*:\s*\d{1,2})/);
  if (ratio) return ratio[1].replace(/\s+/g, "");
  const low = t.toLowerCase();
  if (/\blandscape\b/.test(low)) return "landscape";
  if (/\bportrait\b/.test(low)) return "portrait";
  if (/\bsquare\b/.test(low) || low === "1:1") return low === "1:1" ? "1:1" : "square";
  if (/^(1:1|16:9|9:16|4:3|3:4)$/.test(low.replace(/\s+/g, ""))) return low.replace(/\s+/g, "");
  return null;
}

/**
 * POST-v1C model-label validation (§9). Live UI label only; returns the
 * trimmed live label or null (caller reports UNKNOWN). Rejects icon text
 * and bare generic "model" placeholders.
 */
function normalizeModelLabel(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (!t || t.length > 80 || isIconGarbage(t)) return null;
  if (GENERIC_MODEL_RE.test(t)) return null;
  return t.slice(0, 80);
}

function normalizeCreditLabel(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (!t || t.length > 60 || isIconGarbage(t)) return null;
  return t;
}

/**
 * POST-v1E.2D P1 — modelLabel only from VERIFIED model-semantic evidence.
 * The live UI once surfaced "Sep 28 - 20:48" (project/session dropdown) as
 * the model: a generic structural fallback match is NOT model evidence.
 * Accepted only when the control matched the primary selector or a
 * model-semantic selector (model/veo/imagen); otherwise UNKNOWN.
 */
function readModelLabel(root) {
  const found = queryWithFallback(root, "MODEL_CONTROL");
  if (!found.el) return null;
  const strong = !found.fallbackUsed || /model|veo|imagen/i.test(String(found.matchedSelector || ""));
  if (!strong) return null;
  return normalizeModelLabel(elementTextValue(found.el));
}

function readCreditCost(root) {
  return normalizeCreditLabel(elementTextValue(query(root, "CREDIT_DISPLAY")));
}

function readAspectSetting(root) {
  return normalizeAspectLabel(elementTextValue(query(root, "ASPECT_CONTROL")));
}

function readAspectSettingRaw(root) {
  return elementTextValue(query(root, "ASPECT_CONTROL"));
}

function detectGenerateButton(root) {
  const found = queryWithFallback(root, "GENERATE_BUTTON");
  if (!found.el) return { found: false, enabled: false, fallbackUsed: false };
  let enabled = true;
  try {
    if (found.el.disabled === true) enabled = false;
    else if (found.el.getAttribute && found.el.getAttribute("aria-disabled") === "true") enabled = false;
  } catch {
    enabled = true;
  }
  return { found: true, enabled, fallbackUsed: found.fallbackUsed };
}

function detectDownloadControl(root) {
  const found = queryWithFallback(root, "DOWNLOAD_CONTROL");
  return { found: Boolean(found.el), fallbackUsed: found.fallbackUsed, matchedSelector: found.matchedSelector };
}

/**
 * POST-v1C output-count reader (§10). Returns { value, raw } where value
 * is an integer 1..8 or null (UNKNOWN). Never infers success from a click.
 */
function readOutputCount(root) {
  const found = queryWithFallback(root, "OUTPUT_COUNT");
  if (!found.el) return { value: null, raw: null, found: false };
  const raw = elementTextValue(found.el);
  if (raw === null || raw === undefined) return { value: null, raw: null, found: true };
  const t = String(raw).replace(/\s+/g, " ").trim();
  if (!t || isIconGarbage(t)) return { value: null, raw: t.slice(0, 40) || null, found: true };
  const m = t.match(/\b([1-8])\b/);
  if (m) return { value: parseInt(m[1], 10), raw: t.slice(0, 40), found: true };
  return { value: null, raw: t.slice(0, 40), found: true };
}

function selectedStateOf(el) {
  try {
    if (!el) return false;
    if (el.getAttribute) {
      for (const a of ["aria-selected", "aria-pressed", "aria-checked"]) {
        try {
          if (el.getAttribute(a) === "true") return true;
        } catch {
          /* best-effort */
        }
      }
      try {
        const ce = el.getAttribute("aria-current");
        if (ce === "true" || ce === "page") return true;
      } catch {
        /* best-effort */
      }
    }
    if (el.checked === true) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * POST-v1C generation-type detection (§11), POST-v1E.2 rewrite: EVIDENCE-based.
 * A global text match (e.g. text:/\bvideo\b/i) is NEVER positive current-state
 * evidence — it may be an inactive option, hidden DOM, history, or unrelated
 * UI. Verified IMAGE/VIDEO requires strong semantics: a selected mode control,
 * a selected tab, a selected choice inside an OPEN generation menu, or a
 * Generate label naming image generation. Everything else stays UNKNOWN with
 * the evidence list attached.
 */
function detectGenerationType(root) {
  const evidence = [];
  const textMatched = (f) => Boolean(f && f.fallbackUsed && String(f.matchedSelector || "").startsWith("text:"));
  const img = queryWithFallback(root, "MODE_IMAGE");
  const vid = queryWithFallback(root, "MODE_VIDEO");
  if (img.el && selectedStateOf(img.el)) {
    evidence.push({ source: "mode-control-selected", value: "IMAGE" });
    return { type: "IMAGE", verified: true, method: "mode-control", evidence };
  }
  if (vid.el && selectedStateOf(vid.el) && !textMatched(vid)) {
    evidence.push({ source: "mode-control-selected", value: "VIDEO" });
    return { type: "VIDEO", verified: true, method: "mode-control", evidence };
  }
  // Generation-type tablist: look for a selected tab whose label names
  // image or video (bounded to tab roles only).
  try {
    const tabs = root.querySelectorAll('[role="tab"]') || [];
    for (const tab of tabs) {
      if (!selectedStateOf(tab)) continue;
      let label = "";
      try {
        label = String(tab.textContent || tab.innerText || (tab.getAttribute && (tab.getAttribute("aria-label") || "")) || "");
      } catch {
        label = "";
      }
      label = label.replace(/\s+/g, " ").trim().toLowerCase();
      if (/\bimage\b/.test(label) && !/\bvideo\b/.test(label)) {
        evidence.push({ source: "tab-selected", value: "IMAGE" });
        return { type: "IMAGE", verified: true, method: "tab-selected", evidence };
      }
      if (/\bvideo\b/.test(label) && !/\bimage\b/.test(label)) {
        evidence.push({ source: "tab-selected", value: "VIDEO" });
        return { type: "VIDEO", verified: true, method: "tab-selected", evidence };
      }
    }
  } catch {
    /* tab scan is best-effort */
  }
  // Already-open generation menu with a selected choice (observe-only).
  const menu = findOpenGenerationMenu(root);
  if (menu) {
    evidence.push({ source: "generation-menu-open", value: (menu.choices.names || []).join("|").slice(0, 60) || "open" });
    if (menu.choices.image && selectedStateOf(menu.choices.image)) {
      evidence.push({ source: "menu-option-selected", value: "IMAGE" });
      return { type: "IMAGE", verified: true, method: "menu-selection", evidence };
    }
    if (menu.choices.video && selectedStateOf(menu.choices.video)) {
      evidence.push({ source: "menu-option-selected", value: "VIDEO" });
      return { type: "VIDEO", verified: true, method: "menu-selection", evidence };
    }
  }
  // POST-v1E.2A: the Generate label ("Generate Image") appears in BOTH the
  // image and video workflows — it is NOT a generation-type discriminator.
  // Telemetry only; it must NEVER by itself produce verified IMAGE.
  const genFound = queryWithFallback(root, "GENERATE_BUTTON");
  if (genFound.el) {
    let label = shortControlLabel(genFound.el, 40);
    if (!label) label = safeAttr(genFound.el, "aria-label", 80);
    if (label && /generate/i.test(label)) {
      evidence.push({ source: "generate-label", value: label.slice(0, 40), informational: true });
    }
  }
  // Informational only: image-specific preference controls present.
  if (query(root, "ASPECT_CONTROL") || query(root, "OUTPUT_COUNT")) {
    evidence.push({ source: "image-prefs-available", value: "true" });
  }
  const anyMode = Boolean(img.el || vid.el);
  return { type: "UNKNOWN", verified: false, method: anyMode ? "mode-controls-unselected" : menu ? "menu-unselected" : "no-evidence", evidence };
}

/**
 * POST-v1C GENERATION_READY assessment (§12). Pure + DOM-mediated only.
 * Required: promptVerified=true, generationType=IMAGE, Generate found +
 * enabled, approvalState=AWAITING_USER_APPROVAL. Optional-but-reported:
 * modelLabel, aspect, outputCount, visibleCreditCost (UNKNOWN allowed).
 * NEVER clicks Generate.
 * POST-v1E stall fix: opts.approvalPendingExpected=true marks the
 * pre-approval preparation stage — APPROVAL_NOT_RECORDED is then expected
 * (the bridge transition happens only after readiness) and is NOT counted
 * as a missing readiness condition.
 */
function assessGenerationReady(root, opts = {}) {
  const promptVerified = opts.promptVerified === true;
  const approvalState = opts.approvalState || "UNKNOWN";
  const approvalPendingExpected = opts.approvalPendingExpected === true;
  const genType = detectGenerationType(root);
  const generate = detectGenerateButton(root);
  const modelLabel = readModelLabel(root);
  const aspect = readAspectSetting(root);
  const output = readOutputCount(root);
  const credit = readCreditCost(root);
  const missing = [];
  if (!promptVerified) missing.push("PROMPT_NOT_VERIFIED");
  if (genType.type !== "IMAGE") missing.push(genType.type === "UNKNOWN" ? "GENERATION_TYPE_UNKNOWN" : "GENERATION_TYPE_NOT_IMAGE");
  else if (genType.verified !== true) missing.push("GENERATION_TYPE_NOT_VERIFIED");
  if (!generate.found) missing.push("GENERATE_CONTROL_NOT_FOUND");
  else if (!generate.enabled) missing.push("GENERATE_STILL_DISABLED_AFTER_PROMPT");
  if (approvalState !== "AWAITING_USER_APPROVAL" && !approvalPendingExpected) missing.push("APPROVAL_NOT_RECORDED");
  return {
    ready: missing.length === 0,
    missing,
    checks: {
      promptVerified,
      generationType: genType.type,
      generationTypeVerified: genType.verified,
      generateFound: generate.found,
      generateEnabled: generate.enabled,
      approvalState,
    },
    details: {
      modelLabel: modelLabel || "UNKNOWN",
      aspect: aspect || "UNKNOWN",
      outputCount: output.value === null ? "UNKNOWN" : output.value,
      outputCountRaw: output.raw,
      visibleCreditCost: credit || "UNKNOWN",
    },
    clickedGenerate: false,
    creditsConsumed: false,
  };
}

/**
 * POST-v1C approval-packet builder (§13). Pure formatting — no DOM, no
 * Generate click. Optional values stay visibly UNKNOWN when unresolved.
 */
function buildApprovalPacket({ job = {}, generationState = {} } = {}) {
  const d = (generationState && generationState.details) || {};
  const capability = String(job.capability || "image").toUpperCase();
  return {
    jobId: job.jobId || "UNKNOWN",
    type: capability,
    prompt: job.prompt || "",
    model: d.modelLabel || "UNKNOWN",
    aspect: d.aspect || "UNKNOWN",
    outputs: d.outputCount === undefined || d.outputCount === null ? "UNKNOWN" : d.outputCount,
    visibleCreditCost: d.visibleCreditCost || "UNKNOWN",
    expectedImportPath: `projects/${job.projectId || "unknown"}/assets/${job.jobId || "UNKNOWN"}.<ext>`,
    readiness: generationState.ready === true ? "GENERATION_READY" : "NOT_READY",
    missing: generationState.missing || [],
    clickedGenerate: false,
  };
}

function selectMode(root, capability) {
  const key = capability === "video" ? "MODE_VIDEO" : "MODE_IMAGE";
  const el = requireEl(root, key);
  if (typeof el.click === "function") el.click();
  return { ok: true, mode: capability };
}

function applySettings(root, settings = {}) {
  const applied = [];
  if (settings.aspectRatio !== undefined) {
    const el = requireEl(root, "ASPECT_CONTROL");
    el.value = settings.aspectRatio;
    applied.push("aspectRatio");
  }
  if (settings.generationLength !== undefined) {
    const el = requireEl(root, "LENGTH_CONTROL");
    el.value = settings.generationLength;
    applied.push("generationLength");
  }
  return { applied };
}

function attachReferences(root, refs = []) {
  if (refs.length === 0) return { attached: 0 };
  requireEl(root, "REFERENCE_INPUT");
  return { attached: refs.length };
}

function attachFrame(root, kind, frame) {
  if (!frame) return { attached: 0 };
  const key = kind === "end" ? "END_FRAME_INPUT" : "START_FRAME_INPUT";
  requireEl(root, key);
  return { attached: 1, kind };
}

/**
 * POST-v1E settings popover + verified selection (§10, §14–§16).
 * Flow settings may live inside a popover/menu: open the model/settings
 * trigger first, then discover options by role + accessible name + short
 * constrained labels. Every select re-reads live state afterward — a click
 * alone is never success.
 */
const OPTION_SELECTORS = [
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="radio"]',
  "option",
  // POST-v1E.2H: native form controls ARE options. Live Agent Settings
  // renders Always/Never as <input type=radio> with no ARIA role.
  'input[type="radio"]',
  'input[type="checkbox"]',
];

function triggerExpandedState(el) {
  try {
    if (!el || !el.getAttribute) return null;
    return el.getAttribute("aria-expanded");
  } catch {
    return null;
  }
}

function openGenerationSettings(root) {
  const trigger = queryWithFallback(root, "MODEL_CONTROL").el;
  if (!trigger) return { opened: false, code: "MODEL_CONTROL_NOT_FOUND" };
  if (triggerExpandedState(trigger) === "true") {
    return { opened: true, method: "already-open" };
  }
  if (typeof trigger.click === "function") trigger.click();
  // Verify: trigger reports expanded, or a menu/listbox/dialog surfaced.
  const expanded = triggerExpandedState(trigger) === "true";
  let surfaced = false;
  for (const sel of ['[role="menu"]', '[role="listbox"]', '[role="dialog"]']) {
    try {
      if (root.querySelector(sel)) {
        surfaced = true;
        break;
      }
    } catch {
      /* best-effort */
    }
  }
  if (expanded || surfaced) return { opened: true, method: "trigger-click" };
  return { opened: false, code: "SETTINGS_POPOVER_NOT_OBSERVED" };
}

function closeGenerationSettings(root) {
  try {
    const GlobalRef = typeof globalThis !== "undefined" ? globalThis : {};
    const KE = GlobalRef.KeyboardEvent;
    if (KE && root && typeof root.dispatchEvent === "function") {
      root.dispatchEvent(new KE("keydown", { key: "Escape", bubbles: true }));
      return { closed: true, method: "escape" };
    }
  } catch {
    /* best-effort */
  }
  return { closed: false, method: "unavailable" };
}

/** Bounded option scan: role options first, then short-labelled buttons. */
function scanSettingOptions(root, { maxScan = 200 } = {}) {
  const out = [];
  for (const sel of OPTION_SELECTORS) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      if (out.length >= maxScan) return out;
      out.push(el);
    }
  }
  // Constrained fallback: buttons with short labels only (never page text).
  let buttons = [];
  try {
    buttons = root.querySelectorAll("button") || [];
  } catch {
    buttons = [];
  }
  for (const el of buttons) {
    if (out.length >= maxScan) break;
    const label = shortControlLabel(el, 24);
    if (label) out.push(el);
  }
  return out;
}

function optionLabel(el) {
  let t = "";
  try {
    if (typeof el.textContent === "string" && el.textContent) t = el.textContent;
    else if (typeof el.innerText === "string" && el.innerText) t = el.innerText;
  } catch {
    t = "";
  }
  if (!t && el && typeof el.getAttribute === "function") {
    try {
      t = el.getAttribute("aria-label") || accessibleLabelOf(el) || el.getAttribute("title") || el.getAttribute("value") || "";
    } catch {
      t = "";
    }
  }
  return String(t || "").replace(/\s+/g, " ").trim();
}

/**
 * POST-v1E.2H: accessible label of a control that carries no text of its own
 * (native radio/checkbox) or that names a group. Standard ARIA/HTML only:
 * aria-label -> aria-labelledby -> associated <label> (first short chunk).
 * Live Agent Settings: <input type=radio value=1> labelled
 * "Always Agent will ask for confirmation..." -> "Always".
 */
function accessibleLabelOf(el) {
  if (!el || typeof el.getAttribute !== "function") return "";
  try {
    const direct = String(el.getAttribute("aria-label") || "").trim();
    if (direct) return direct;
    const ids = String(el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    for (const id of ids) {
      const ref = el.ownerDocument && el.ownerDocument.getElementById(id);
      const t = ref ? String(ref.textContent || "").replace(/\s+/g, " ").trim() : "";
      if (t) return t;
    }
    const labels = el.labels;
    if (labels && typeof labels.length === "number") {
      for (let i = 0; i < Math.min(labels.length, 3); i++) {
        const t = firstShortTextChunk(labels[i]);
        if (t) return t;
      }
    }
  } catch {
    /* best-effort */
  }
  return "";
}

/** First own-text chunk of at most maxLen chars, depth-first (label name, not its description). */
function firstShortTextChunk(el, maxLen = 24) {
  const walk = (node) => {
    let kids = [];
    try {
      kids = Array.from(node.children || []);
    } catch {
      return "";
    }
    for (const child of kids) {
      let own = "";
      try {
        own = Array.from(child.childNodes || [])
          .filter((n) => n.nodeType === 3)
          .map((n) => n.nodeValue || "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      } catch {
        own = "";
      }
      if (own && own.length <= maxLen) return own;
      const deep = walk(child);
      if (deep) return deep;
    }
    return "";
  };
  return walk(el);
}

/**
 * POST-v1E.2H — semantic label of an Agent Settings control. Live Flow renders
 * an emoji and/or a Material-Symbols ligature beside the value, sometimes glued
 * to it: "🍌 Nano Banana 2 arrow_drop_down", "crop_square1:1".
 */
function agentSemanticLabel(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t
    .split(/\s+/)
    .filter((tok) => tok && !isIconGarbage(tok))
    .join(" ");
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
  // ligature glued to a ratio value: "crop_square1:1" -> "1:1"
  const glued = t.match(/^[a-z]+_[a-z0-9_]*?(\d{1,2}\s*:\s*\d{1,2})$/i);
  if (glued) t = glued[1].replace(/\s+/g, "");
  return t.trim();
}

/**
 * POST-v1E.2H: ARIA-named groups inside a container. Live Flow sections are
 * plain text, but they are named by standard ARIA:
 * <mat-radio-group role="radiogroup" aria-labelledby="...-label"> and
 * <flow-toggles aria-label="Image generation default aspect ratio">.
 */
function labelledGroupTextsOf(node) {
  if (!node || typeof node.querySelectorAll !== "function") return [];
  const out = [];
  try {
    const hosts = node.querySelectorAll("[aria-labelledby],[aria-label]") || [];
    for (const host of Array.from(hosts).slice(0, 24)) {
      const t = agentSemanticLabel(accessibleLabelOf(host));
      if (t && !out.includes(t)) out.push(t);
    }
  } catch {
    return out;
  }
  return out;
}

/** Every label a section-scoped search should consider for `node`. */
function sectionLabelTextsOf(node) {
  const out = scanSettingOptions(node).map((el) => agentSemanticLabel(optionLabel(el)));
  for (const t of labelledGroupTextsOf(node)) if (!out.includes(t)) out.push(t);
  return out;
}

function clickOption(el) {
  if (!el || typeof el.click !== "function") throw new Error("OPTION_CLICK_FAILED: option not clickable");
  el.click();
}

/**
 * POST-v1E.2 — generation-type LIVE RESOLVER.
 * Generation type is selected from the model/generation settings control in
 * the prompt box (composer → settings trigger → Image/Video menu), NOT from
 * independent always-visible MODE_* controls.
 *
 * Discovery is scoped to the CURRENT composer root, bounded, and safe:
 * opening a menu generates nothing and spends no credits. Only the freshly
 * opened popover surface is inspected; a surface without BOTH Image and
 * Video choices is closed and the next candidate probed. Selection uses
 * exact accessible names inside the VERIFIED menu only — never a global
 * text match. A click is not success: post-click state is re-read and must
 * positively verify. Generate is never clicked during discovery.
 */
const GENERATION_TRIGGER_SELECTORS = [
  '[role="button"][aria-haspopup]',
  "button[aria-haspopup]",
  '[role="combobox"]',
  '[role="button"][aria-expanded]',
  "button[aria-expanded]",
];
const GENERATION_TRIGGER_MAX = 6;
const FLOW_GENERATION_MENU_TIMEOUT_MS = 2000;
const FLOW_GENERATION_VERIFY_TIMEOUT_MS = 2500;
const FLOW_PROBE_CLEANUP_TIMEOUT_MS = 1500;

/** Composer root if resolvable, else the page root ("in or adjacent"). */
function generationScopeRoot(root) {
  try {
    const resolved = resolvePromptComposer(root);
    if (resolved && resolved.composerRoot) return resolved.composerRoot;
  } catch {
    /* fall through to root scope */
  }
  return root;
}

/**
 * POST-v1E.2D P0 — runtime negative evidence, session-scoped: an element that
 * verifiably opened an Asset Picker is never probed again on this page
 * session (WeakSet — no DOM indexes persisted). Classification stays
 * runtime/context-based: a button merely NAMED "add" is not globally
 * blacklisted without runtime evidence.
 */
const sessionPickerTriggers = new WeakSet();

const TOOLBAR_CONTROL_SELECTORS = ["button", '[role="button"]', "input", '[role="combobox"]', '[role="switch"]', "textarea"];

/** Every interactive element inside a container (bounded, deduped). */
function interactiveControlsIn(container) {
  const out = [];
  const seen = new Set();
  for (const sel of TOOLBAR_CONTROL_SELECTORS) {
    let list = [];
    try {
      list = (container && typeof container.querySelectorAll === "function" && container.querySelectorAll(sel)) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      if (el && !seen.has(el)) {
        seen.add(el);
        out.push(el);
      }
      if (out.length >= 24) return out;
    }
  }
  return out;
}

/**
 * POST-v1E.2D P0 — smallest stable composer toolbar/control cluster containing
 * the Generate control: nearest ancestor of Generate holding ≥2 interactive
 * controls (bounded walk). Never a button index, never CSS classes.
 */
function findComposerToolbar(root, generateEl) {
  let node = generateEl;
  for (let level = 0; node && level < 5; level++) {
    try {
      if (typeof node.querySelectorAll === "function" && interactiveControlsIn(node).length >= 2) return node;
    } catch {
      /* keep walking */
    }
    try {
      node = node.parentElement;
    } catch {
      node = null;
    }
  }
  return null;
}

function isEditorControl(el) {
  try {
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return true;
    return el.isContentEditable === true || el.getAttribute("contenteditable") === "true";
  } catch {
    return false;
  }
}

/**
 * POST-v1E.2D P0 — inventory EVERY interactive control in the verified
 * composer toolbar BEFORE candidate filtering (diagnostic evidence AND
 * candidate input). Broadened eligibility inside the toolbar only: buttons
 * without aria-haspopup/expanded/combobox semantics are eligible UNKNOWN
 * probes because probing is transactional. Still excluded: Generate/submit,
 * editor/input controls, known asset/reference controls (static semantics OR
 * session runtime negative evidence), forbidden/account/search controls,
 * disabled controls.
 */
/**
 * POST-v1E.2E P0 - canonical semantic identity. Real DOM semantics
 * (aria-label, title) outrank visible text; the icon/material-symbol ligature
 * text (e.g. "tune", "article_spark") is recorded SEPARATELY and never used
 * as the accessible name when a real aria-label/title exists. The source of
 * every semantic label is logged.
 */
function semanticIdentity(el) {
  const ariaLabel = safeAttr(el, "aria-label", 80);
  const title = safeAttr(el, "title", 80);
  let textContent = "";
  try {
    textContent = String((typeof el.textContent === "string" && el.textContent) || "").replace(/\s+/g, " ").trim();
  } catch {
    textContent = "";
  }
  const shortText = textContent && textContent.length <= 30 ? textContent : "";
  let accessibleName = null;
  let accessibleSource = null;
  if (ariaLabel) {
    accessibleName = ariaLabel;
    accessibleSource = "aria-label";
  } else if (title) {
    accessibleName = title;
    accessibleSource = "title";
  } else if (shortText) {
    accessibleName = shortText;
    accessibleSource = "visible-text";
  }
  return { ariaLabel, title, textContent: shortText || null, iconText: shortText || null, accessibleName, accessibleSource };
}

/**
 * POST-v1E.2E P0 - classification with evidence. Normalized evidence is taken
 * from aria-label first, then title, then short visible text; the winning
 * source is returned as categoryEvidence. A control with ariaLabel="Settings"
 * no longer stays UNKNOWN merely because its icon text is "tune" - but
 * "Settings" semantics are a stronger CANDIDATE signal, never verification.
 */
function classifyWithEvidence(el) {
  const identity = semanticIdentity(el);
  const sources = [
    { source: "aria-label", value: identity.ariaLabel },
    { source: "title", value: identity.title },
    { source: "visible-text", value: identity.textContent },
  ];
  for (const src of sources) {
    if (!src.value) continue;
    const cat = classifyGenerationTrigger({ accessibleName: src.value });
    if (cat !== "UNKNOWN") {
      return { category: cat, categoryEvidence: { source: src.source, value: redactSafe(String(src.value)) }, identity };
    }
  }
  return { category: "UNKNOWN", categoryEvidence: null, identity };
}

function composerToolbarInventory(toolbar, generateEl) {
  const inv = [];
  const eligible = [];
  const seen = new Set();
  let index = 0;
  for (const el of interactiveControlsIn(toolbar)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const ev = classifyWithEvidence(el);
    const cand = {
      el,
      index,
      selectorSource: "composer-toolbar",
      ...ev.identity,
      tag: String((el && el.tagName) || "").toLowerCase() || null,
      role: safeAttr(el, "role", 30) || String((el && el.tagName) || "").toLowerCase() || null,
      hasPopup: safeAttr(el, "aria-haspopup", 20),
      expanded: safeAttr(el, "aria-expanded", 10),
      disabled: false,
      nearGenerate: nearGenerate(el, generateEl),
      categoryEvidence: ev.categoryEvidence,
    };
    cand.semanticSources = [cand.ariaLabel && `aria-label:${redactSafe(cand.ariaLabel)}`, cand.title && `title:${redactSafe(cand.title)}`, cand.textContent && `icon-text:${redactSafe(cand.textContent)}`].filter(Boolean);
    index += 1;
    try {
      cand.disabled = el.disabled === true || (el.getAttribute && el.getAttribute("aria-disabled") === "true") || false;
    } catch {
      cand.disabled = false;
    }
    let exclusionReason = null;
    if (generateEl && el === generateEl) {
      cand.category = "SUBMIT";
      exclusionReason = "generate-control";
    } else if (sessionPickerTriggers.has(el)) {
      cand.category = "ASSET_REFERENCE";
      exclusionReason = "runtime-negative-asset-picker";
    } else {
      cand.category = ev.category;
      if (cand.category === "SUBMIT") exclusionReason = "submit-semantics";
      else if (cand.category === "ASSET_REFERENCE") exclusionReason = "asset-reference-semantics";
      else if (cand.category === "AGENT") exclusionReason = "agent-control";
    }
    if (isForbiddenControl(el)) {
      cand.category = cand.category === "SUBMIT" ? "SUBMIT" : "FORBIDDEN";
      exclusionReason = exclusionReason || "forbidden-control";
    }
    if (isEditorControl(el)) {
      cand.category = "EDITOR_INPUT";
      exclusionReason = exclusionReason || "editor-input";
    }
    if (cand.disabled) exclusionReason = exclusionReason || "disabled";
    cand.eligible = !exclusionReason;
    cand.exclusionReason = exclusionReason || "none";
    inv.push(cand);
    if (cand.eligible) eligible.push(cand);
  }
  return { inv, eligible };
}

function composerToolbarLog(toolbarFound, inv) {
  if (!toolbarFound) return ["composerToolbar: found=false controlCount=0"];
  const lines = [`composerToolbar: found=true controlCount=${inv.length}`];
  for (const c of inv) {
    lines.push(
      `composerControl[${c.index}]: tag=${c.tag || "button"} role=${c.role || "button"} accessibleName="${redactSafe(String(c.accessibleName || ""))}" nameSource=${c.accessibleSource || "none"} ariaLabel="${redactSafe(String(c.ariaLabel || ""))}" title="${redactSafe(String(c.title || ""))}" textContent="${redactSafe(String(c.textContent || ""))}" iconText="${redactSafe(String(c.iconText || ""))}" semanticSources=[${(c.semanticSources || []).join(",")}] hasPopup=${c.hasPopup || "false"} expanded=${c.expanded || "false"} disabled=${c.disabled} nearGenerate=${c.nearGenerate} category=${c.category} categoryEvidence=${c.categoryEvidence ? `${c.categoryEvidence.source}:${redactSafe(String(c.categoryEvidence.value))}` : "none"} eligible=${c.eligible} exclusionReason=${c.exclusionReason}`
    );
  }
  return lines;
}

/** Observe-only: bounded trigger candidates in/adjacent to the composer. */
function findGenerationTriggerCandidates(root, excludeEl = null) {
  const scan = (scopeEl) => {
    const out = [];
    const seen = new Set();
    for (const sel of GENERATION_TRIGGER_SELECTORS) {
      if (out.length >= GENERATION_TRIGGER_MAX) break;
      let list = [];
      try {
        list = (scopeEl && typeof scopeEl.querySelectorAll === "function" && scopeEl.querySelectorAll(sel)) || [];
      } catch {
        list = [];
      }
      for (const el of list) {
        if (out.length >= GENERATION_TRIGGER_MAX) break;
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (excludeEl && el === excludeEl) continue;
        if (isForbiddenControl(el) || isHiddenControl(el)) continue;
        if (sessionPickerTriggers.has(el)) continue;
        const ev = classifyWithEvidence(el);
        const cand = {
          el,
          selectorSource: sel,
          ...ev.identity,
          role: safeAttr(el, "role", 30) || String((el && el.tagName) || "").toLowerCase() || null,
          hasPopup: safeAttr(el, "aria-haspopup", 20),
          categoryEvidence: ev.categoryEvidence,
        };
        cand.category = ev.category;
        cand.nearGenerate = nearGenerate(el, excludeEl);
        cand.rankingSignals = [];
        if (cand.category === "GENERATION_SETTINGS") cand.rankingSignals.push("generation-settings-name");
        if (cand.hasPopup) cand.rankingSignals.push(`has-popup:${cand.hasPopup}`);
        if (cand.nearGenerate) cand.rankingSignals.push("near-generate");
        if (cand.category === "ASSET_REFERENCE") cand.rankingSignals.push("asset-reference-semantics");
        out.push(cand);
      }
    }
    return out;
  };
  // POST-v1E.2D P0: toolbar inventory FIRST — the smallest stable cluster
  // containing Generate. Inside the verified toolbar, eligibility is broadened
  // (no aria-haspopup required); probing remains transactional. When no
  // toolbar can be resolved, the bounded composer-scope selector scan applies.
  // Never broadened outside the composer toolbar.
  const toolbar = findComposerToolbar(root, excludeEl);
  let found;
  let toolbarFound = false;
  let inv = null;
  if (toolbar) {
    toolbarFound = true;
    const r = composerToolbarInventory(toolbar, excludeEl);
    inv = r.inv;
    found = r.eligible;
  } else {
    found = scan(generationScopeRoot(root));
  }
  // POST-v1E.2B P1: semantic + structural ranking. Proximity to Generate and
  // settings semantics are RANKING evidence only — never verification.
  const score = (c) => {
    // POST-v1E.2E P0: real DOM semantic evidence outranks inferred/synthetic
    // labels; an exact settings/model keyword outranks a compound name.
    const name = String(c.accessibleName || "").toLowerCase();
    const exactKeyword = /^(settings|generation settings|model|preferences)$/.test(name) ? 6 : 0;
    const sourceBonus = c.accessibleSource === "aria-label" ? 6 : c.accessibleSource === "title" ? 4 : c.accessibleSource === "visible-text" ? 2 : 0;
    return (
      (c.category === "GENERATION_SETTINGS" ? 30 : c.category === "ASSET_REFERENCE" ? -50 : c.category === "SUBMIT" ? -60 : c.category === "AGENT" ? -40 : 0) +
      sourceBonus +
      exactKeyword +
      (c.hasPopup ? 5 : 0) +
      (c.nearGenerate ? 10 : 0)
    );
  };
  const ranked = found.sort((a, b) => score(b) - score(a));
  ranked.toolbarFound = toolbarFound;
  ranked.toolbarControlCount = inv ? inv.length : 0;
  ranked.toolbarLog = composerToolbarLog(toolbarFound, inv);
  return ranked;
}

/**
 * POST-v1E.2B P0 — candidate classification. A candidate whose accessible
 * semantics indicate asset/reference/media behavior is NEVER a
 * generation-settings candidate (live-confirmed: the Asset Picker modal was
 * opened by probing such a control). Classification uses accessible
 * metadata, not CSS classes and not a bare text blacklist alone.
 */
const ASSET_SEMANTICS_RE = /add\s*(image|media|video|audio|asset|voice|character|avatar)|^media$|\bassets?\b|upload|referenc|ingredient|attach|search\s+assets/i;
const GENERATION_SETTINGS_RE = /generation|settings|preferences|\bmodel\b|sliders|quality|advanced/i;

function classifyGenerationTrigger(cand) {
  const name = String((cand && cand.accessibleName) || "").toLowerCase();
  if (/\bgenerate\b|\bcreate\b|\bsubmit\b|\bt\u1ea1o\b/.test(name)) return "SUBMIT";
  // POST-v1E.2E: Agent Instructions / agent controls are never generation
  // settings unless live evidence proves otherwise.
  if (/\bagent\b/.test(name)) return "AGENT";
  if (/add\s*(image|media|video|audio|asset|voice|character|avatar)|^media$|\bassets?\b|upload|referenc|ingredient|attach|search\s+assets/i.test(name)) return "ASSET_REFERENCE";
  if (/generation|settings|preferences|\bmodel\b|sliders|quality|advanced/i.test(name)) return "GENERATION_SETTINGS";
  return "UNKNOWN";
}

function nearGenerate(el, genEl) {
  if (!genEl || !el || !el.parentElement) return false;
  if (el.parentElement === genEl.parentElement) return true;
  try {
    return el.parentElement.contains(genEl) === true;
  } catch {
    return false;
  }
}

/** Exact-name generation choices inside ONE resolved surface (never global). */
function generationChoicesIn(surface) {
  const choices = { image: null, video: null, names: [] };
  if (!surface || typeof surface.querySelectorAll !== "function") return choices;
  for (const opt of scanSettingOptions(surface)) {
    const label = optionLabel(opt);
    if (!label || label.length > 24 || isIconGarbage(label)) continue;
    const low = label.toLowerCase();
    if (!choices.image && low === "image") choices.image = opt;
    else if (!choices.video && low === "video") choices.video = opt;
    if (choices.names.length < 12) choices.names.push(label);
  }
  return choices;
}

/** Observe-only: an ALREADY-open surface holding generation choices. */
function findOpenGenerationMenu(root) {
  for (const sel of ['[role="menu"]', '[role="listbox"]', '[role="dialog"]']) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const surface of list) {
      const choices = generationChoicesIn(surface);
      if (choices.image || choices.video) {
        return { surface, role: safeAttr(surface, "role", 20) || sel, choices };
      }
    }
  }
  return null;
}

/**
 * POST-v1E.2C P0 — surface classification (observe-only). An asset picker
 * (live-confirmed: "Search assets / All / Images / Videos / Voices /
 * Characters / Avatars / Uploads / Upload media") must NEVER produce
 * generation state: the PLURAL "Images"/"Videos" never matches the exact
 * generation choices "Image"/"Video", and ≥2 asset markers classify the
 * surface as ASSET_PICKER.
 */
const ASSET_PICKER_MARKERS = ["search assets", "upload media", "uploads", "voices", "characters", "avatars", "images", "videos"];

/** POST-v1E.2D: marker sources include aria-label, title, PLACEHOLDER, and short visible text. */
const MARKER_SOURCE_SELECTORS = ["button", '[role="button"]', '[role="menuitem"]', '[role="tab"]', '[role="option"]', '[role="menuitemradio"]', "input", '[role="combobox"]'];

function markerLabelOf(el) {
  for (const attr of ["aria-label", "title", "placeholder"]) {
    const v = safeAttr(el, attr, 60);
    if (v) return v.toLowerCase();
  }
  try {
    const t = String((typeof el.textContent === "string" && el.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (t && t.length <= 30) return t;
  } catch {
    /* text is best-effort */
  }
  return "";
}

function classifySurface(surface, choices) {
  const c = choices || { image: null, video: null, names: [] };
  if (c.image && c.video) return "GENERATION_MENU";
  let names = (c.names || []).map((n) => String(n).toLowerCase());
  // POST-v1F: live Flow names its Agent Settings with PLAIN TEXT and ARIA group
  // labels (h2 "Agent settings", span "Confirm before generating",
  // flow-toggles[aria-label="Image generation default aspect ratio"]). None of
  // those reach the bounded option-name scan above, so the panel classified
  // UNKNOWN and the transactional opener could never open it. Fall back to the
  // richer section/ARIA labels before giving up.
  if (!AGENT_SETTINGS_MARKERS.some((m) => names.some((n) => n === m || n.includes(m)))) {
    try {
      names = names.concat(sectionLabelTextsOf(surface).map((n) => String(n).toLowerCase()));
    } catch {
      /* best-effort */
    }
  }
  // POST-v1E.2F: Agent Settings surface - never rolled back as UNKNOWN.
  const agentHits = AGENT_SETTINGS_MARKERS.filter((m) => names.some((n) => n === m || n.includes(m)));
  if (agentHits.length >= 2) return "AGENT_SETTINGS";
  const assetHits = ASSET_PICKER_MARKERS.filter((m) => names.some((n) => n === m || n.includes(m)));
  if (assetHits.length >= 2) return "ASSET_PICKER";
  return "UNKNOWN";
}

/** Observe-only: every currently open popover/menu/dialog/listbox surface. */
function openSurfaces(root) {
  const out = [];
  for (const sel of ['[role="menu"]', '[role="listbox"]', '[role="dialog"]']) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const s of list) if (!out.includes(s)) out.push(s);
  }
  return out;
}

function captureOpenSurfaces(root) {
  return new Set(openSurfaces(root));
}

/** POST-v1E.2C: surface resolution is handled by resolveProbeSurface (below). */

/**
 * POST-v1E.2D P0 — real Asset Picker marker detection (observe-only, ZERO
 * clicks). Marker hits come from aria-label, title, PLACEHOLDER and short
 * visible text across interactive/tab elements; the common container is the
 * bounded ancestor holding the most distinct markers (deepest wins on ties)
 * — no fixed ≤5 level cap; bounded at 30 ancestor levels and 300 scanned
 * elements. A container with BOTH exact Image and Video choices is a
 * generation menu, not an asset picker.
 */
function findMarkerContainer(root, { maxAncestors = 30, maxScan = 300 } = {}) {
  const hits = [];
  const seen = new Set();
  outer: for (const sel of MARKER_SOURCE_SELECTORS) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (hits.length >= maxScan) break outer;
      const label = markerLabelOf(el);
      if (!label) continue;
      let matched = null;
      for (const m of ASSET_PICKER_MARKERS) {
        if (label === m || label.includes(m)) {
          matched = m;
          break;
        }
      }
      if (matched) hits.push({ el, matched });
    }
  }
  const counts = new Map();
  for (const { el, matched } of hits) {
    let node = el;
    for (let level = 0; node && level <= maxAncestors; level++) {
      if (node !== root) {
        if (!counts.has(node)) counts.set(node, { markers: new Set(), minDepth: level });
        counts.get(node).markers.add(matched);
      }
      try {
        node = node.parentElement;
      } catch {
        node = null;
      }
    }
  }
  let best = null;
  let bestMarkers = 0;
  let bestDepth = -1;
  for (const [container, info] of counts) {
    if (info.markers.size > bestMarkers || (info.markers.size === bestMarkers && info.minDepth > bestDepth)) {
      best = container;
      bestMarkers = info.markers.size;
      bestDepth = info.minDepth;
    }
  }
  if (!best || bestMarkers < 2) return null;
  const choices = generationChoicesIn(best);
  if (choices.image && choices.video) return null; // an exact generation menu is not an asset picker
  return { surface: best, role: safeAttr(best, "role", 20) || "overlay", choices };
}

/**
 * POST-v1E.2C P0 — mutation-based surface ownership. Records nodes added
 * during a probe window (real MutationObserver on document.body in the
 * browser; `recordNode` is the driver/test seam elsewhere). Ownership by
 * mutation-add naturally excludes pre-existing portals.
 */
function startSurfaceMutationCapture(root) {
  const added = [];
  const GlobalRef = typeof globalThis !== "undefined" ? globalThis : {};
  const MO = GlobalRef.MutationObserver;
  let obs = null;
  if (typeof MO === "function") {
    try {
      const target = (typeof document !== "undefined" && document && document.body) || root;
      obs = new MO((muts) => {
        for (const m of muts || []) {
          for (const n of (m && m.addedNodes) || []) {
            if (n && n.nodeType !== 3) added.push(n);
          }
        }
      });
      obs.observe(target, { childList: true, subtree: true });
    } catch {
      obs = null;
    }
  }
  return {
    addedNodes: added,
    recordNode: (n) => {
      if (n && n.nodeType !== 3) added.push(n);
    },
    stop() {
      try {
        if (obs) obs.disconnect();
      } catch {
        /* noop */
      }
    },
  };
}

/** Walk mutation-added nodes to bounded visible container ancestors (deduped). */
function mutationOwnedContainers(mutation, root, before, beforeMarkerContainer) {
  const containers = [];
  const seen = new Set();
  for (const node of mutation.addedNodes) {
    let cur = node;
    for (let level = 0; cur && level < 6; level++) {
      if (!seen.has(cur)) {
        seen.add(cur);
        if (cur !== root && !before.has(cur) && cur !== beforeMarkerContainer) containers.push(cur);
      }
      try {
        cur = cur.parentElement;
      } catch {
        cur = null;
      }
    }
  }
  return containers;
}

/**
 * POST-v1E.2C P0 — resolve the surface introduced by ONE probe from multiple
 * evidence sources, in order: ARIA roles → mutation-owned portal containers →
 * (bounded window over) observe-only asset-picker fallback. Always returns a
 * structured result (never null) so cleanup can never be bypassed.
 */
/**
 * POST-v1E.2E P0 - generation side-effect guard helpers. Discovery must never
 * trigger generation; if a probe introduces a generation-running state, stop
 * immediately. A stop/cancel-generation control is recognized only by exact
 * conservative accessible semantics (never guessed, never a coordinate).
 */
function findStopControl(root) {
  const seen = new Set();
  for (const sel of MARKER_SOURCE_SELECTORS) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const identity = semanticIdentity(el);
      const name = String(identity.accessibleName || "").toLowerCase();
      if (/^(stop|cancel|hu\u1ef7)( generation| t\u1ea1o)?$/.test(name) || /^(stop|cancel|hu\u1ef7) generation$/.test(name)) return el;
    }
  }
  return null;
}

function captureGenerationRunState(root) {
  const start = queryWithFallback(root, "GENERATE_BUTTON");
  const startState = { present: Boolean(start.el), label: start.el ? semanticIdentity(start.el).accessibleName : null };
  return { startState, stopControlPresent: Boolean(findStopControl(root)) };
}

function detectGenerationRunning(root, before, flowMode) {
  const stop = findStopControl(root);
  if (stop && !before.stopControlPresent) return { detected: true, reason: "stop-control-appeared", stopEl: stop };
  const start = queryWithFallback(root, "GENERATE_BUTTON");
  if (start.el) {
    const label = String(semanticIdentity(start.el).accessibleName || "").toLowerCase();
    const beforeLabel = String((before.startState && before.startState.label) || "").toLowerCase();
    if (beforeLabel && /start/.test(beforeLabel) && /stop|cancel|hu\u1ef7/.test(label)) {
      // POST-v1E.2F mode-awareness: an Agent query may enter a busy/Stop state
      // before any credit-consuming media generation. With AGENT mode (and
      // confirmation Always), Start->Stop alone is agentState=BUSY, never
      // proof of media generation. The probe-click guard (new stop control)
      // still applies in every mode.
      if (flowMode === "AGENT") return { detected: false, agentState: "BUSY", mediaGenerationState: "IDLE", reason: "start-replaced-by-stop" };
      return { detected: true, reason: "start-replaced-by-stop", stopEl: null };
    }
  }
  return { detected: false };
}

/** POST-v1E.2E P0: a mutation container is a rollback artifact only with surface evidence. */
function isRollbackArtifact(c) {
  try {
    const choices = generationChoicesIn(c);
    if (classifySurface(c, choices) !== "UNKNOWN") return true;
    if (safeAttr(c, "aria-modal", 10) === "true") return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * POST-v1E.2E P0: an unexpected generation-running state STOPS discovery.
 * Cancellation is attempted ONLY for a reliably identified new stop control
 * caused by this probe, and only when cancellation verifies. Never guessed.
 */
async function generationSideEffectError(root, sideEffect, runBefore, probeLog) {
  let cancellationAttempted = false;
  let cancellationVerified = false;
  const stopAppeared = sideEffect.reason === "stop-control-appeared" && Boolean(sideEffect.stopEl);
  if (stopAppeared) {
    cancellationAttempted = true;
    try {
      sideEffect.stopEl.click();
      cancellationVerified = (await waitUntilFreshDOM(root, () => (findStopControl(root) ? null : true), { timeoutMs: 2000, pollMs: 100 })) === true;
    } catch {
      cancellationVerified = false;
    }
  }
  const after = captureGenerationRunState(root);
  probeLog.push(
    `generationSideEffect: detected=true reason=${sideEffect.reason} beforeStartState=${JSON.stringify(runBefore.startState)} afterStartState=${JSON.stringify(after.startState)} stopControlAppeared=${stopAppeared} cancellationAttempted=${cancellationAttempted} cancellationVerified=${cancellationVerified}`
  );
  const err = new Error("GENERATION_PROBE_UNEXPECTED_GENERATION: candidate probe triggered a generation-running state; discovery stopped immediately");
  err.sideEffect = {
    detected: true,
    beforeStartState: runBefore.startState,
    afterStartState: after.startState,
    stopControlAppeared: stopAppeared,
    cancellationAttempted,
    cancellationVerified,
  };
  err.probeLog = probeLog;
  return err;
}

async function resolveProbeSurface(root, before, mutation, beforeMarkerContainer, timeoutMs) {
  const stats = { addedNodeCount: 0, visibleContainerCount: 0 };
  const containersNow = () => {
    const c = mutationOwnedContainers(mutation, root, before, beforeMarkerContainer);
    stats.visibleContainerCount = c.length;
    return c;
  };
  const hit = await waitUntilFreshDOM(
    root,
    () => {
      stats.addedNodeCount = mutation.addedNodes.length;
      for (const s of openSurfaces(root)) {
        if (before.has(s)) continue;
        const choices = generationChoicesIn(s);
        const classification = classifySurface(s, choices);
        if (classification !== "UNKNOWN") {
          return { resolved: true, surface: s, classification, source: "ARIA", choices, role: safeAttr(s, "role", 20) || "surface", names: choices.names, ownedContainer: s, mutationContainerList: containersNow(), mutationStats: stats };
        }
      }
      for (const c of containersNow()) {
        // POST-v1E.2D-A: classify only VISIBLE containers — a disconnected
        // stale node is never a UI region introduced by this probe.
        if (!elementStillVisible(c, root)) continue;
        const choices = generationChoicesIn(c);
        const classification = classifySurface(c, choices);
        if (classification !== "UNKNOWN") {
          return { resolved: true, surface: c, classification, source: "MUTATION", choices, role: safeAttr(c, "role", 20) || "overlay", names: choices.names, ownedContainer: c, mutationContainerList: containersNow(), mutationStats: stats };
        }
      }
      return null;
    },
    { timeoutMs, pollMs: 100 }
  );
  if (hit) return hit;
  // Bounded window over: own ANY newly introduced UI for rollback — semantic
  // surfaces first, then mutation-owned containers. Resolution may have failed
  // but cleanup must still know what this probe introduced.
  const anyNewSemantic = openSurfaces(root).find((s) => !before.has(s));
  if (anyNewSemantic) {
    return { resolved: false, surface: null, classification: "UNKNOWN", source: "ARIA", choices: null, role: null, names: [], ownedContainer: anyNewSemantic, mutationStats: stats };
  }
  const containers = containersNow();
  if (containers.length > 0) {
    return { resolved: false, surface: null, classification: "UNKNOWN", source: "MUTATION", choices: null, role: null, names: [], ownedContainer: containers[0], mutationContainerList: containers, mutationStats: stats };
  }
  const marker = findMarkerContainer(root);
  if (marker) {
    return { resolved: true, surface: marker.surface, classification: "ASSET_PICKER", source: "OBSERVE_FALLBACK", choices: marker.choices, role: marker.role, names: marker.choices.names, ownedContainer: marker.surface, mutationContainerList: containers, mutationStats: stats };
  }
  return { resolved: false, surface: null, classification: "UNKNOWN", source: "NONE", choices: null, role: null, names: [], ownedContainer: null, mutationContainerList: containers, mutationStats: stats };
}

/**
 * POST-v1E.2D P0 — element visibility without coordinates: disconnected →
 * gone; zero client rects (real DOM, incl. display:none portals) → gone; not
 * contained by the root → gone; otherwise assume present (conservative —
 * cleanup must actively verify).
 */
/**
 * POST-v1E.2D-A — visibility with DOCUMENT-level ownership boundary. Flow
 * portals render under document.body OUTSIDE the composer root while fully
 * connected and visible: `composerRoot.contains(portal) === false` must NEVER
 * imply "gone". Ownership boundary = document containment or isConnected;
 * visibility additionally excludes zero client rects, display:none /
 * visibility:hidden, and hidden/aria-hidden semantics. Conservative: an
 * artifact is "present" unless proven gone.
 */
function elementStillVisible(el, root) {
  if (!el) return false;
  try {
    const doc = typeof document !== "undefined" && document && typeof document.contains === "function" ? document : null;
    if (doc) {
      // Live boundary: the DOCUMENT. Flow portals live under document.body
      // outside the composer root — document containment never implies "gone"
      // for connected portals.
      if (!doc.contains(el)) return false;
    } else if (root && typeof root.contains === "function" && !root.contains(el)) {
      // Mock/legacy fallback (root is the page-level document there).
      return false;
    }
  } catch {
    /* fall through to connectivity */
  }
  try {
    if (typeof el.isConnected === "boolean" && el.isConnected === false) return false;
  } catch {
    /* not a real node */
  }
  try {
    if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
  } catch {
    /* mocked elements */
  }
  try {
    if (el.getAttribute) {
      if (el.getAttribute("hidden") !== null) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      const st = el.style;
      if (st && (st.display === "none" || st.visibility === "hidden")) return false;
    }
  } catch {
    /* best-effort */
  }
  return true;
}

/**
 * POST-v1E.2D P0 — snapshot-comparison disappearance check: owned surface
 * identity, mutation-owned visible containers, and NEW asset-picker marker
 * containers must all be gone. A marker container that was already visible
 * BEFORE the probe is baseline-exempt.
 */
async function artifactGone(root, artifacts, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const semanticStill = artifacts.ownedSurface && openSurfaces(root).includes(artifacts.ownedSurface);
    const containerStill = (artifacts.containers || []).some((c) => elementStillVisible(c, root));
    const markerNow = findMarkerContainer(root);
    const markerStill = markerNow && markerNow.surface !== artifacts.beforeMarkerContainer;
    if (!semanticStill && !containerStill && !markerStill) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * POST-v1E.2D P0 — probe cleanup contract with snapshot comparison.
 * `method=none` + verifiedClosed=true is allowed ONLY when the probe
 * introduced no persistent visible artifact. Otherwise: surface-local Close →
 * Escape → re-scan markers → re-check mutation-owned containers → verify
 * composer usable. Any probe-owned wrong UI remaining → verifiedClosed=false
 * (caller stops with GENERATION_PROBE_CLEANUP_FAILED).
 */
async function closeProbeArtifacts(root, artifacts, { timeoutMs = FLOW_PROBE_CLEANUP_TIMEOUT_MS, composerResolvedBefore = false } = {}) {
  const a = artifacts || {};
  const result = { attempted: true, method: "none", verifiedClosed: false, composerUsable: false };
  try {
    const ownedSurface = a.ownedSurface;
    if (ownedSurface) {
      let closeBtn = null;
      try {
        if (typeof ownedSurface.querySelector === "function") {
          closeBtn = ownedSurface.querySelector('button[aria-label*="close" i], [role="button"][aria-label*="close" i], button[title*="close" i]') || null;
        }
      } catch {
        closeBtn = null;
      }
      if (closeBtn && typeof closeBtn.click === "function") {
        closeBtn.click();
        result.method = "CLOSE_BUTTON";
      }
    }
    if (!(await artifactGone(root, a, 300))) {
      closeGenerationSettings(root);
      result.method = result.method === "none" ? "ESCAPE" : `${result.method}+ESCAPE`;
    }
    result.verifiedClosed = await artifactGone(root, a, timeoutMs);
    let resolvedNow = false;
    try {
      resolvedNow = Boolean(resolvePromptComposer(root));
    } catch {
      resolvedNow = false;
    }
    result.composerUsable = resolvedNow || !composerResolvedBefore;
  } catch (e) {
    result.method = `${result.method}+error:${String((e && e.message) || e).slice(0, 60)}`;
  }
  return result;
}

async function selectGenerationType(root, type = "IMAGE", opts = {}) {
  const want = String(type).toUpperCase();
  if (want !== "IMAGE" && want !== "VIDEO") throw new Error(`SCHEMA_INVALID: unknown generation type ${type}`);
  const probeLog = [];
  // 1. Already in the requested mode? Strong semantic evidence → no clicks.
  //    POST-v1E.2D P1: current-mode detection is tracked SEPARATELY from
  //    switching proof — this path never claims generation switching.
  const current = detectGenerationType(root);
  probeLog.push(`generationTypeDetection: value=${current.type} verified=${current.verified === true} method=${current.verified ? current.method : "unknown"}`);
  if (current.type === want && current.verified) {
    probeLog.push(`generationTypeSwitch: attempted=false`);
    return { ok: true, type: want, value: want, verified: true, method: "already-selected", evidence: current.evidence, trigger: null, menu: null, detection: { value: want, verified: true, method: "already-selected" }, switch: { attempted: false, verified: false }, probeLog };
  }
  // 2. Legacy direct mode control (older Flow UIs) — click + re-verify.
  //    A text-matched VIDEO control is never clicked: global text match is
  //    informational only (POST-v1E.2).
  const key = want === "IMAGE" ? "MODE_IMAGE" : "MODE_VIDEO";
  const directFound = queryWithFallback(root, key);
  const textOnly = want === "VIDEO" && textMatched(directFound);
  if (directFound.el && !textOnly && typeof directFound.el.click === "function") {
    directFound.el.click();
    const after = detectGenerationType(root);
    if (after.type === want && after.verified) {
      return { ok: true, type: want, value: want, verified: true, method: "mode-control", evidence: after.evidence, trigger: null, menu: null };
    }
  }
  // 3. Discovery: bounded candidate probing — transaction-like per probe.
  //    Asset/reference/submit candidates are EXCLUDED before any interaction
  //    (POST-v1E.2B). POST-v1E.2C: surface resolution no longer depends on
  //    ARIA roles alone — mutation-owned portal subtrees and an observe-only
  //    asset-picker fallback are included, and cleanup can NEVER be bypassed:
  //    every probe that does not end in a verified generation interaction is
  //    rolled back, resolved surface or not. Generate is never clicked.
  const generateEl = queryWithFallback(root, "GENERATE_BUTTON").el;
  const composerResolvedBefore = (() => {
    try {
      return Boolean(resolvePromptComposer(root));
    } catch {
      return false;
    }
  })();
  const allCandidates = findGenerationTriggerCandidates(root, generateEl);
  const candidateSummary = allCandidates.map((c) => ({ accessibleName: c.accessibleName, role: c.role, hasPopup: c.hasPopup, category: c.category, nearGenerate: c.nearGenerate, rankingSignals: c.rankingSignals }));
  const candidates = allCandidates.filter((c) => c.category === "GENERATION_SETTINGS" || c.category === "UNKNOWN");
  const negativeEls = new Set(); // confirmed-wrong candidates, this run only
  const runBefore = captureGenerationRunState(root); // side-effect baseline
  // POST-v1E.2D P0: toolbar inventory diagnostics FIRST — every interactive
  // control observed before filtering, in the developer log.
  for (const line of allCandidates.toolbarLog || []) probeLog.push(line);
  if (candidates.length === 0) {
    const err = new Error("GENERATION_TRIGGER_NOT_FOUND: no probe-able generation candidate in the composer scope");
    err.diagnostics = { candidates: candidateSummary, scope: allCandidates.toolbarFound ? "composer-toolbar" : "composer" };
    err.probeLog = probeLog;
    throw err;
  }
  let sawVerifiedMenu = false;
  let sawWrongSurface = false;
  let sawAnySurface = false;
  const attempts = [];
  let attemptNo = 0;
  for (const cand of candidates) {
    if (negativeEls.has(cand.el)) continue;
    attemptNo += 1;
    probeLog.push(`generationProbe: candidates=${candidates.length} attempt=${attemptNo}`);
    probeLog.push(`generationCandidate: role=${cand.role || "button"} accessibleName="${redactSafe(String(cand.accessibleName || ""))}" nameSource=${cand.accessibleSource || "none"} iconText="${redactSafe(String(cand.iconText || ""))}" semanticSources=[${(cand.semanticSources || []).join(",")}] category=${cand.category} categoryEvidence=${cand.categoryEvidence ? `${cand.categoryEvidence.source}:${redactSafe(String(cand.categoryEvidence.value))}` : "none"} hasPopup=${cand.hasPopup || "false"} rankingSignals=[${(cand.rankingSignals || []).join(",")}]`);
    const before = captureOpenSurfaces(root);
    const beforeMarker = findMarkerContainer(root);
    const mutation = startSurfaceMutationCapture(root);
    let opened = null;
    let verifiedSuccess = false;
    let failure = null;
    const attemptArtifacts = { ownedSurface: null, containers: [], beforeMarkerContainer: beforeMarker };
    try {
      try {
        if (typeof cand.el.click !== "function") continue;
        cand.el.click();
      } catch {
        continue;
      }
      // POST-v1E.2E P0: generation side-effect guard - right after the click.
      const sideEffect1 = detectGenerationRunning(root, runBefore, "STANDARD");
      if (sideEffect1.detected) throw await generationSideEffectError(root, sideEffect1, runBefore, probeLog);
      opened = await resolveProbeSurface(root, before, mutation, beforeMarker, Number(opts.menuTimeoutMs) || FLOW_GENERATION_MENU_TIMEOUT_MS);
      const sideEffect2 = detectGenerationRunning(root, runBefore, "STANDARD");
      if (sideEffect2.detected) throw await generationSideEffectError(root, sideEffect2, runBefore, probeLog);
      // POST-v1E.2E P0: only EVIDENCE-BACKED mutation containers are rollback
      // artifacts - ordinary re-render nodes never fail cleanup merely by
      // remaining visible.
      attemptArtifacts.containers = (opened.mutationContainerList || []).filter((c) => isRollbackArtifact(c));
      probeLog.push(`generationMutation: addedNodeCount=${opened.mutationStats.addedNodeCount} visibleContainerCount=${opened.mutationStats.visibleContainerCount}`);
      probeLog.push(`openedSurface: resolved=${opened.resolved} resolutionSource=${opened.source || "NONE"} classification=${opened.classification || "NONE"} visibleOptionNames=[${(opened.names || []).join("|")}]`);
      if (!opened.resolved || opened.classification === "UNKNOWN") {
        failure = { openedSurface: opened.resolved || opened.ownedContainer ? { role: opened.role, classification: opened.classification, resolutionSource: opened.source } : null };
        continue; // rollback guaranteed by finally — even when unresolved
      }
      if (opened.classification === "ASSET_PICKER") {
        sawWrongSurface = true;
        // POST-v1E.2C/2D negative evidence: never probe this candidate again
        // in this run (element set) nor in this page session (WeakSet).
        negativeEls.add(cand.el);
        sessionPickerTriggers.add(cand.el);
        cand.category = "ASSET_REFERENCE";
        failure = { openedSurface: { role: opened.role, classification: "ASSET_PICKER", resolutionSource: opened.source, visibleOptionNames: opened.names } };
        continue; // closed in finally, next candidate probed
      }
      sawVerifiedMenu = true;
      const choice = want === "IMAGE" ? opened.choices.image : opened.choices.video;
      try {
        if (typeof choice.click === "function") choice.click();
      } catch (e) {
        throw new Error(`IMAGE_OPTION_NOT_FOUND: ${String((e && e.message) || e)}`);
      }
      const verified = await waitUntilFreshDOM(
        root,
        () => {
          const d = detectGenerationType(root);
          if (d.type === want && d.verified) return d;
          // Owned portal surface without ARIA roles: verify selected
          // semantics directly inside the surface this probe opened.
          if (opened && opened.choices) {
            const owned = want === "IMAGE" ? opened.choices.image : opened.choices.video;
            if (owned && selectedStateOf(owned)) {
              return { type: want, verified: true, method: "menu-selection", evidence: [{ source: "menu-option-selected", value: want }] };
            }
          }
          return null;
        },
        { timeoutMs: Number(opts.verifyTimeoutMs) || FLOW_GENERATION_VERIFY_TIMEOUT_MS, pollMs: 100 }
      );
      const triggerInfo = { selectorSource: cand.selectorSource, accessibleName: cand.accessibleName, role: cand.role, hasPopup: cand.hasPopup, category: cand.category, rankingSignals: cand.rankingSignals };
      const menuInfo = { role: opened.role, visibleOptionNames: opened.choices.names, classification: opened.classification, resolutionSource: opened.source };
      if (verified) {
        verifiedSuccess = true; // the verified generation interaction persists
        probeLog.push(`generationTypeDetection: value=${want} verified=true method=menu-selection`);
        probeLog.push(`generationTypeSwitch: attempted=true verified=true`);
        probeLog.push(`cleanup: attempted=false reason=verified-generation-persists`);
        return { ok: true, type: want, value: want, verified: true, method: "generation-menu", evidence: verified.evidence, trigger: triggerInfo, menu: menuInfo, detection: { value: want, verified: true, method: "menu-selection" }, switch: { attempted: true, verified: true }, probeLog };
      }
      // A click on the verified menu without positive post-state evidence is a
      // FAIL — never assumed success, never retried against other candidates.
      probeLog.push(`generationTypeSwitch: attempted=true verified=false`);
      const err = new Error(`GENERATION_TYPE_NOT_IMAGE: click on verified generation menu produced no positive ${want} state evidence`);
      err.evidence = { trigger: triggerInfo, openedSurface: menuInfo };
      err.probeLog = probeLog;
      throw err;
    } finally {
      mutation.stop();
      // Cleanup contract: ANYTHING this probe introduced is rolled back unless
      // a VERIFIED generation interaction intentionally persists — resolved
      // surface or not (snapshot comparison: markers + mutation containers +
      // owned surface vs the pre-click baseline).
      if (!verifiedSuccess) {
        if (opened && (opened.resolved || opened.ownedContainer)) sawAnySurface = true;
        if (opened && opened.resolved) attemptArtifacts.ownedSurface = opened.surface;
        else if (opened && opened.ownedContainer) attemptArtifacts.ownedSurface = opened.ownedContainer; // unresolved-but-introduced UI is still rolled back
        const cleanup = await closeProbeArtifacts(root, attemptArtifacts, { timeoutMs: Number(opts.cleanupTimeoutMs) || FLOW_PROBE_CLEANUP_TIMEOUT_MS, composerResolvedBefore });
        probeLog.push(`cleanup: attempted=true method=${cleanup.method} verifiedClosed=${cleanup.verifiedClosed}`);
        attempts.push({ accessibleName: cand.accessibleName, category: cand.category, openedSurface: failure ? failure.openedSurface : null, cleanup: { attempted: cleanup.attempted, method: cleanup.method, verifiedClosed: cleanup.verifiedClosed } });
        if (!cleanup.verifiedClosed || !cleanup.composerUsable) {
          const err = new Error(`GENERATION_PROBE_CLEANUP_FAILED: probe-introduced UI could not be safely closed (method=${cleanup.method})`);
          err.diagnostics = { candidates: candidateSummary, attempts };
          err.probeLog = probeLog;
          throw err;
        }
      }
    }
  }
  probeLog.push(`generationTypeSwitch: attempted=true verified=false`);
  if (sawVerifiedMenu) {
    const err = new Error(`IMAGE_OPTION_NOT_FOUND: verified generation surface did not yield a verified ${want.toLowerCase()} selection`);
    err.diagnostics = { candidates: candidateSummary, attempts };
    err.probeLog = probeLog;
    throw err;
  }
  if (sawWrongSurface) {
    const err = new Error("GENERATION_WRONG_SURFACE: candidate(s) opened a confirmed non-generation surface (ASSET_PICKER); no verified generation menu found");
    err.diagnostics = { candidates: candidateSummary, attempts };
    err.probeLog = probeLog;
    throw err;
  }
  const err = new Error(sawAnySurface ? "GENERATION_SURFACE_NOT_RESOLVED: candidate clicked but no newly opened surface could be reliably resolved" : "GENERATION_SURFACE_NOT_RESOLVED: no candidate produced a newly opened surface");
  err.diagnostics = { candidates: candidateSummary, attempts };
  err.probeLog = probeLog;
  throw err;
}

/**
 * POST-v1E.2F — Flow mode routing + Agent Settings preparation.
 * flowMode = AGENT | STANDARD | UNKNOWN. AGENT evidence: Agent Instructions
 * control in the verified composer toolbar AND a verified Agent Settings
 * surface ("Agent settings" / "Confirm before generating" / "Image generation
 * default" / "Video generation default" / "Save"). Arbitrary page text never
 * verifies the mode. In AGENT mode there is NO Image/Video generation-type
 * switch: Agent routes by prompt and uses the configured defaults.
 */
const AGENT_SETTINGS_MARKERS = ["agent settings", "confirm before generating", "image generation default", "video generation default", "save"];
// POST-v1E.2H: live Agent Settings labels the panel with a plain heading.
const AGENT_HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/** POST-v1E.2F P0: AGENT_SETTINGS surface classification (observe-only). */
function classifyAgentSettingsSurface(surface) {
  const names = scanSettingOptions(surface).map(optionLabel).map((n) => n.toLowerCase());
  const agentHits = AGENT_SETTINGS_MARKERS.filter((m) => names.some((n) => n === m || n.includes(m)));
  return agentHits.length >= 2;
}

/** Walk a choice element to an ancestor section whose labels match sectionRe. */
function agentSectionChoice(surface, sectionRe, choiceRe) {
  const hits = [];
  for (const el of scanSettingOptions(surface)) {
    if (choiceRe.test(agentSemanticLabel(optionLabel(el)))) hits.push(el);
  }
  for (const hit of hits) {
    let node = hit;
    for (let level = 0; node && level <= 15; level++) {
      try {
        if (typeof node.querySelectorAll === "function" && node !== surface) {
          const labels = sectionLabelTextsOf(node);
          if (labels.some((l) => sectionRe.test(l))) return { choice: hit, section: node };
        }
      } catch {
        /* keep walking */
      }
      try {
        node = node.parentElement;
      } catch {
        node = null;
      }
    }
  }
  return null;
}

function inSectionWithLabel(el, sectionRe) {
  let node = el;
  for (let level = 0; node && level <= 15; level++) {
    try {
      if (typeof node.querySelectorAll === "function") {
        const labels = sectionLabelTextsOf(node);
        if (labels.some((l) => sectionRe.test(l))) return true;
      }
    } catch {
      /* keep walking */
    }
    try {
      node = node.parentElement;
    } catch {
      node = null;
    }
  }
  return false;
}

/** POST-v1E.2F P0: confirmation state from selected Always/Never semantics. */
function agentConfirmationState(surface) {
  for (const el of scanSettingOptions(surface)) {
    const label = agentSemanticLabel(optionLabel(el)).toLowerCase();
    if (label === "always" || label === "never") {
      if (!inSectionWithLabel(el, /confirm before generating/i)) continue;
      if (selectedStateOf(el)) return label === "always" ? "ALWAYS" : "NEVER";
    }
  }
  return null;
}

/**
 * POST-v1E.2G P0 - observe-only, role-less Agent Settings resolution. The
 * live panel carries NO role=dialog/menu/listbox, so ARIA scanning alone
 * misses it. Markers come from visible short text / accessible names /
 * aria-labels / button text; verification requires the exact "agent settings"
 * heading marker AND >= 2 additional Agent Settings markers inside ONE
 * visible common container (bounded ancestor walk, no CSS classes, ZERO
 * clicks). Random page text elsewhere never verifies the mode.
 */
function findAgentSettingsMarkerContainer(root, { maxAncestors = 30, maxScan = 300 } = {}) {
  const hits = [];
  const seen = new Set();
  // POST-v1E.2H: the live "Agent settings" title is a plain <h2 class=
  // "header-title">, not an interactive control, so heading text is part of
  // the marker source. The heading alone still never verifies (>=3 markers in
  // ONE container are still required).
  outer: for (const sel of [...MARKER_SOURCE_SELECTORS, AGENT_HEADING_SELECTOR]) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (hits.length >= maxScan) break outer;
      const label = markerLabelOf(el);
      if (!label) continue;
      for (const m of AGENT_SETTINGS_MARKERS) {
        if (label === m || label.includes(m)) {
          hits.push({ el, matched: m });
          break;
        }
      }
    }
  }
  const counts = new Map();
  for (const { el, matched } of hits) {
    let node = el;
    for (let level = 0; node && level <= maxAncestors; level++) {
      if (node !== root) {
        if (!counts.has(node)) counts.set(node, new Set());
        counts.get(node).add(matched);
      }
      try {
        node = node.parentElement;
      } catch {
        node = null;
      }
    }
  }
  let best = null;
  let bestCount = 0;
  for (const [container, markers] of counts) {
    if (markers.size > bestCount) {
      best = container;
      bestCount = markers.size;
    }
  }
  if (!best) return null;
  const markers = [...bestMarkerSet(best, counts)];
  const hasHeading = markers.includes("agent settings");
  if (!hasHeading || markers.length < 3) return null; // heading + >=2 additional markers
  return { surface: best, markers, role: safeAttr(best, "role", 20) || "panel" };
}

function bestMarkerSet(container, counts) {
  return counts.get(container) || new Set();
}

/**
 * POST-v1E.2G P0 - an already-open Agent Settings surface: ARIA roles first,
 * then role-less VISIBLE_MARKERS resolution. Returns
 * { surface, resolutionSource, markers } or null. Never clicks.
 */
function findAgentSettingsSurface(root) {
  for (const s of openSurfaces(root)) {
    if (classifyAgentSettingsSurface(s)) {
      return { surface: s, resolutionSource: "ARIA", markers: AGENT_SETTINGS_MARKERS.filter((m) => scanSettingOptions(s).map(optionLabel).map((x) => x.toLowerCase()).some((x) => x === m || x.includes(m))) };
    }
  }
  const marker = findAgentSettingsMarkerContainer(root);
  if (marker) return { surface: marker.surface, resolutionSource: "VISIBLE_MARKERS", markers: marker.markers };
  return null;
}

/** POST-v1E.2F P0: flowMode detection. Opening Settings is safe (no credits). */
async function resolveFlowMode(root, opts = {}) {
  const probeLog = [];
  // Already-open Agent Settings surface (ARIA or role-less VISIBLE_MARKERS).
  const openSurface = findAgentSettingsSurface(root);
  if (openSurface) {
    probeLog.push(`agentSettingsSurface: found=true resolutionSource=${openSurface.resolutionSource} markers=[${(openSurface.markers || []).join("|")}] verified=true`);
    probeLog.push("flowMode: value=AGENT verified=true evidence=[agent-settings-surface]");
    return { value: "AGENT", verified: true, evidence: ["agent-settings-surface"], resolutionSource: openSurface.resolutionSource, probeLog };
  }
  // Cheap current-mode evidence (no clicks): a verified Standard generation type.
  const gt = detectGenerationType(root);
  if (gt.verified && (gt.type === "IMAGE" || gt.type === "VIDEO")) {
    probeLog.push(`flowMode: value=STANDARD verified=true evidence=[generation-type:${gt.type}]`);
    return { value: "STANDARD", verified: true, evidence: [`generation-type-${gt.type}`], probeLog };
  }
  // Transactional Settings probes: AGENT_SETTINGS → AGENT, exact Image+Video
  // generation menu → STANDARD; anything else stays UNKNOWN. Page text never
  // verifies the mode.
  const generateEl = queryWithFallback(root, "GENERATE_BUTTON").el;
  const allCandidates = findGenerationTriggerCandidates(root, generateEl);
  const agentCtl = allCandidates.find((c) => /agent instructions/i.test(`${c.ariaLabel || ""} ${c.accessibleName || ""}`));
  const settingsCands = allCandidates.filter((c) => c.category === "GENERATION_SETTINGS").slice(0, 3);
  const evidence = [];
  if (agentCtl) evidence.push("agent-instructions-control");
  for (const cand of settingsCands) {
    const before = captureOpenSurfaces(root);
    const beforeMarker = findMarkerContainer(root);
    const mutation = startSurfaceMutationCapture(root);
    let opened = null;
    try {
      try {
        if (typeof cand.el.click !== "function") continue;
        cand.el.click();
      } catch {
        continue;
      }
      opened = await resolveProbeSurface(root, before, mutation, beforeMarker, Number(opts.menuTimeoutMs) || FLOW_GENERATION_MENU_TIMEOUT_MS);
      if (opened.resolved && opened.classification === "AGENT_SETTINGS") {
        evidence.push("agent-settings-surface");
        probeLog.push("flowMode: value=AGENT verified=true evidence=[agent-settings-surface]");
        return { value: "AGENT", verified: true, evidence, probeLog };
      }
      if (opened.resolved && opened.classification === "GENERATION_MENU") {
        evidence.push("generation-menu-image-video");
        probeLog.push("flowMode: value=STANDARD verified=true evidence=[generation-menu-image-video]");
        return { value: "STANDARD", verified: true, evidence, probeLog };
      }
    } finally {
      mutation.stop();
      if (opened) {
        await closeProbeArtifacts(
          root,
          { ownedSurface: opened.resolved ? opened.surface : opened.ownedContainer, containers: [], beforeMarkerContainer: beforeMarker },
          { timeoutMs: 800, composerResolvedBefore: true }
        );
      }
    }
  }
  probeLog.push("flowMode: value=UNKNOWN verified=false evidence=[...]");
  return { value: "UNKNOWN", verified: false, evidence, probeLog };
}

/**
 * POST-v1E.2H: model-control candidates on an Agent Settings surface. The
 * option scan skips controls whose visible text is long (icon + name +
 * ligature), so every button/role control that NAMES a model is added too.
 */
function agentModelCandidates(surface) {
  const out = scanSettingOptions(surface);
  try {
    const list = surface.querySelectorAll("button,[role='button'],[role='menuitem'],[role='tab']") || [];
    for (const el of Array.from(list)) {
      if (out.includes(el)) continue;
      if (/model/i.test(String(el.getAttribute("aria-label") || "")) || /model\s*:/i.test(optionLabel(el))) out.push(el);
    }
  } catch {
    /* best-effort */
  }
  return out;
}

/**
 * POST-v1F — the material settings an AGENT-mode approval actually froze.
 * In Agent mode there is no composer generation-type/aspect/output control: the
 * values live in the Agent Settings surface, so re-reading them with the
 * Standard readers reports UNKNOWN and would invalidate a perfectly fresh
 * approval. Returns null when no Agent Settings surface is open (→ the caller
 * must use the Standard path).
 */
/**
 * POST-v1F: a preparation/revalidation step must never leave the Agent Settings
 * drawer open over the composer. Observed live: the drawer stayed open, the
 * subsequent Start click was swallowed, and the approved generation produced
 * nothing. Restore the composer, using the drawer's OWN close control when
 * Escape is not enough, and report honestly when it cannot be restored.
 */
/**
 * POST-v1F: is the Agent Settings drawer really closed?
 *
 * `elementStillVisible` is true for a control that merely sits UNDER an open
 * drawer, which is exactly how the previous submit was swallowed. A visibility
 * test therefore cannot prove the composer is usable. The semantic condition
 * can: while the drawer is open its content is mounted and its markers resolve.
 * No coordinates, no hit-testing (forbidden by the adapter contract).
 */
function agentSettingsDrawerOpen(root) {
  return findAgentSettingsSurface(root) !== null;
}

async function restoreComposer(root, { timeoutMs = 4000, pollMs = 200 } = {}) {
  const ready = () => {
    const gen = queryWithFallback(root, "GENERATE_BUTTON").el;
    const prompt = query(root, "PROMPT_INPUT");
    return Boolean(prompt && elementStillVisible(prompt, root) && gen && elementStillVisible(gen, root) && !agentSettingsDrawerOpen(root));
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (ready()) return { restored: true };
    const surface = findAgentSettingsSurface(root);
    const options = surface && surface.surface ? scanSettingOptions(surface.surface) : [];
    const closer =
      options.find((el) => /^(close|back)$/i.test(safeAttr(el, "aria-label", 20))) || options.find((el) => /^(close|back)$/i.test(optionLabel(el)));
    closeGenerationSettings(root);
    if (closer && typeof closer.click === "function") {
      try {
        closer.click();
      } catch {
        /* best-effort */
      }
    }
    if (Date.now() >= deadline) return { restored: ready() };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** POST-v1F: is this composer the Agent composer? Direct control scan — the
 *  trigger-candidate ranking deliberately excludes the Agent control, so it
 *  must not be used as the precondition for probing. */
function hasAgentComposerControls(root) {
  let list = [];
  try {
    list = root.querySelectorAll("button,[role='button']") || [];
  } catch {
    return false;
  }
  for (const el of Array.from(list)) {
    if (!elementStillVisible(el, root)) continue;
    let name = "";
    try {
      name = `${safeAttr(el, "aria-label", 60) || ""} ${semanticIdentity(el).accessibleName || ""}`.toLowerCase();
    } catch {
      name = "";
    }
    if (/\bagent\b/.test(name)) return true;
  }
  return false;
}

/**
 * POST-v1F: the material settings an AGENT-mode approval actually froze.
 * The Agent Settings surface is usually closed by approval time, so it is
 * opened transactionally before reading.
 */
async function readAgentMaterial(root, opts = {}) {
  // Never probe unless Agent mode is actually indicated (the composer shows the
  // Agent controls, or the settings surface is already open). Otherwise this
  // would click Standard-mode controls just to answer a revalidation question.
  const alreadyOpen = findAgentSettingsSurface(root);
  if (!alreadyOpen && !hasAgentComposerControls(root)) return { surfaceFound: false, code: "NO_AGENT_CONTROLS" };
  const opened = await openAgentSettingsSurface(root, opts);
  if (!opened) return { surfaceFound: false, code: "AGENT_SURFACE_NOT_OPENED" };
  const s = opened.surface;
  // Pick the SELECTED choice, not merely the first name match: the live panel
  // lists every ratio/output and only one carries the checked state.
  const picked = (choiceRe) => {
    for (const el of scanSettingOptions(s)) {
      if (!choiceRe.test(agentSemanticLabel(optionLabel(el)))) continue;
      if (!inSectionWithLabel(el, /image generation default/i)) continue;
      if (!selectedStateOf(el)) continue;
      return agentSemanticLabel(optionLabel(el));
    }
    return "UNKNOWN";
  };
  let model = "UNKNOWN";
  for (const el of agentModelCandidates(s)) {
    const label = optionLabel(el);
    if (!/model\s*:/i.test(label) && !/\bmodel$/i.test(safeAttr(el, "aria-label", 60))) continue;
    if (!inSectionWithLabel(el, /image generation default/i)) continue;
    const m = label.match(/model\s*:\s*(.+)/i);
    model = agentSemanticLabel(m ? m[1] : label) || "UNKNOWN";
    break;
  }
  const material = {
    surfaceFound: true,
    resolutionSource: opened.resolutionSource,
    trigger: opened.trigger === null ? "reused-open-surface" : "opened",
    confirmation: agentConfirmationState(s),
    aspect: picked(/^\d{1,2}\s*:\s*\d{1,2}$/i),
    outputCount: picked(/^x\d+$/i).replace(/^x/i, ""),
    model,
  };
  // POST-v1F: restore the composer BEFORE returning. Leaving the drawer open
  // made the following Start click a no-op (live: approved generation produced
  // nothing). When the composer cannot be restored, report it instead of
  // silently handing a submit path that cannot work.
  const restored = await restoreComposer(root);
  material.composerRestored = restored.restored === true;
  if (!material.composerRestored) return { ...material, surfaceFound: false, code: "COMPOSER_NOT_RESTORED" };
  return material;
}

/** POST-v1E.2F P0 — open the verified Agent Settings surface (transactional).
 * Only a surface classified AGENT_SETTINGS is accepted; anything else is
 * rolled back and the next settings candidate probed.
 */
async function openAgentSettingsSurface(root, opts = {}) {
  // POST-v1E.2G P0: reuse an already-open verified surface - never close and
  // reopen merely to detect/prepare. Only open Settings when none is open.
  const alreadyOpen = findAgentSettingsSurface(root);
  if (alreadyOpen) return { surface: alreadyOpen.surface, trigger: null, resolutionSource: alreadyOpen.resolutionSource };
  const generateEl = queryWithFallback(root, "GENERATE_BUTTON").el;
  const cands = findGenerationTriggerCandidates(root, generateEl).filter((c) => c.category === "GENERATION_SETTINGS").slice(0, 3);
  for (const cand of cands) {
    const before = captureOpenSurfaces(root);
    const beforeMarker = findMarkerContainer(root);
    const mutation = startSurfaceMutationCapture(root);
    let opened = null;
    try {
      try {
        if (typeof cand.el.click !== "function") continue;
        cand.el.click();
      } catch {
        continue;
      }
      opened = await resolveProbeSurface(root, before, mutation, beforeMarker, Number(opts.menuTimeoutMs) || FLOW_GENERATION_MENU_TIMEOUT_MS);
      if (opened.resolved && opened.classification === "AGENT_SETTINGS") {
        return { surface: opened.surface, trigger: cand.el, resolutionSource: opened.source };
      }
    } finally {
      mutation.stop();
      if (!opened || !opened.resolved || opened.classification !== "AGENT_SETTINGS") {
        await closeProbeArtifacts(
          root,
          { ownedSurface: opened && opened.resolved ? opened.surface : opened && opened.ownedContainer, containers: [], beforeMarkerContainer: beforeMarker },
          { timeoutMs: 800, composerResolvedBefore: true }
        );
      }
    }
  }
  return null;
}

/**
 * POST-v1E.2F P0 — Agent Settings preparation for an image job.
 * confirmationPolicy defaults to ALWAYS (ASSISTED_APPROVAL). Image aspect and
 * output count are resolved ONLY inside the "Image generation default"
 * section; the Video section is never touched. The image model is observed
 * read-only. Changes are Saved and verified by close/reopen reread.
 */
async function prepareAgentSettings(root, params = {}) {
  const confirmationPolicy = String(params.confirmationPolicy || "ALWAYS").toUpperCase();
  const aspectRatio = String(params.aspectRatio || "1:1");
  const outputCount = Number(params.outputCount || 1);
  const result = { verified: false, confirmation: confirmationPolicy, observedConfirmation: null, confirmationChanged: false, aspect: null, outputCount: null, modelLabel: null, changed: false, saved: false, probeLog: [] };
  const runBefore = captureGenerationRunState(root);
  const open = () => openAgentSettingsSurface(root, params);
  let opened = await open();
  if (!opened) {
    result.code = "AGENT_SETTINGS_NOT_RESOLVED";
    return result;
  }
  let surface = opened.surface;
  const ensureChoice = (sectionRe, choiceRe, code) => {
    const found = agentSectionChoice(surface, sectionRe, choiceRe);
    if (!found) return { ok: false };
    if (!selectedStateOf(found.choice)) {
      try {
        if (typeof found.choice.click !== "function") return { ok: false };
        found.choice.click();
        result.changed = true;
      } catch {
        return { ok: false };
      }
      if (!selectedStateOf(found.choice)) return { ok: false };
    }
    return { ok: true, el: found.choice };
  };
  // Confirmation policy (ASSISTED_APPROVAL → Always; never silently Never).
  const observedConf = agentConfirmationState(surface);
  result.observedConfirmation = observedConf;
  if (observedConf !== confirmationPolicy) {
    const wantRe = confirmationPolicy === "ALWAYS" ? /^always$/i : /^never$/i;
    const r = ensureChoice(/confirm before generating/i, wantRe);
    if (!r.ok) {
      result.code = "AGENT_CONFIRMATION_NOT_SET";
      return result;
    }
    result.confirmationChanged = true;
    result.changed = true;
  }
  // Image aspect — Image generation default section only.
  const rAspect = ensureChoice(/image generation default/i, new RegExp(`^${aspectRatio}$`, "i"));
  if (!rAspect.ok) {
    result.code = "AGENT_IMAGE_ASPECT_NOT_SET";
    return result;
  }
  result.aspect = aspectRatio;
  // Image output count — xN maps to outputCount=N, Image section only.
  const rOut = ensureChoice(/image generation default/i, new RegExp(`^x${outputCount}$`, "i"));
  if (!rOut.ok) {
    result.code = "AGENT_IMAGE_OUTPUT_NOT_SET";
    return result;
  }
  result.outputCount = outputCount;
  // Model: observe only, from the verified Image section, never changed.
  // POST-v1E.2H: live Flow names the control by its accessible name
  // (aria-label "Image generation default model"), not by a "model:" prefix,
  // and its visible text carries icon glyphs — so the candidate list is the
  // option scan PLUS every ARIA/model-named control on the surface.
  for (const el of agentModelCandidates(surface)) {
    const label = optionLabel(el);
    const isModelControl = /model\s*:/i.test(label) || /\bmodel$/i.test(safeAttr(el, "aria-label", 60));
    if (isModelControl && inSectionWithLabel(el, /image generation default/i)) {
      const m = label.match(/model\s*:\s*(.+)/i);
      const semantic = agentSemanticLabel(m ? m[1] : label);
      result.modelLabel = semantic ? redactSafe(semantic.slice(0, 60)) : null;
      break;
    }
  }
  // Save + persistence verification (close/reopen/reread) when changed.
  if (result.changed) {
    const saveEl = scanSettingOptions(surface).find((el) => /^save$/i.test(agentSemanticLabel(optionLabel(el))));
    if (!saveEl || typeof saveEl.click !== "function") {
      result.code = "AGENT_SAVE_NOT_FOUND";
      return result;
    }
    saveEl.click();
    result.saved = true;
    closeGenerationSettings(root);
    opened = await open();
    if (!opened) {
      result.code = "AGENT_SETTINGS_NOT_PERSISTED";
      return result;
    }
    surface = opened.surface;
  }
  // Reread equality → agentSettingsVerified.
  const conf2 = agentConfirmationState(surface);
  const asp2 = agentSectionChoice(surface, /image generation default/i, new RegExp(`^${aspectRatio}$`, "i"));
  const out2 = agentSectionChoice(surface, /image generation default/i, new RegExp(`^x${outputCount}$`, "i"));
  result.observedConfirmation = conf2;
  result.verified = conf2 === confirmationPolicy && Boolean(asp2 && selectedStateOf(asp2.choice)) && Boolean(out2 && selectedStateOf(out2.choice));
  if (!result.verified) result.code = "AGENT_SETTINGS_NOT_PERSISTED";
  result.probeLog.push(`agentConfirmation: expected=${confirmationPolicy} observed=${conf2 || "NONE"} changed=${result.confirmationChanged} verified=${result.verified}`);
  result.probeLog.push(`agentImageDefaults: aspect=${result.aspect} outputCount=${result.outputCount} model=${result.modelLabel || "UNKNOWN"} verified=${result.verified}`);
  // Restore the UI so the composer (and Start) are usable again. A bare Escape
  // does NOT close the live drawer — it stayed open over the composer and the
  // following Start click was swallowed. Verified restoration, not a guess.
  const restored = await restoreComposer(root);
  result.composerRestored = restored.restored === true;
  if (!result.composerRestored) result.code = "COMPOSER_NOT_RESTORED";
  // POST-v1E.2E mode-awareness: an Agent query may legitimately enter a busy
  // Stop state — that is agentState=BUSY, never proof of credit-spending
  // media generation.
  const runAfter = captureGenerationRunState(root);
  if (runBefore.startState.label && /start/i.test(String(runBefore.startState.label)) && /stop|cancel/i.test(String(runAfter.startState.label || ""))) {
    result.agentState = "BUSY";
    result.mediaGenerationState = "IDLE";
    result.probeLog.push("agentState: BUSY mediaGenerationState: IDLE (Start→Stop alone is not credit-spending media generation)");
  }
  return result;
}

/** POST-v1E.2 observe-only diagnostics bundle for generation type. */
function generationTypeDiagnostics(root) {
  const d = detectGenerationType(root);
  let menu = null;
  try {
    menu = findOpenGenerationMenu(root);
  } catch {
    menu = null;
  }
  let trigger = null;
  try {
    trigger = findGenerationTriggerCandidates(root, queryWithFallback(root, "GENERATE_BUTTON").el)[0] || null;
  } catch {
    trigger = null;
  }
  return {
    type: d.type,
    value: d.type,
    verified: d.verified === true,
    method: d.method,
    verificationSources: (d.evidence || []).map((e) => e.source),
    evidence: d.evidence || [],
    generationTrigger: trigger
      ? { found: true, selectorSource: trigger.selectorSource, accessibleName: trigger.accessibleName, role: trigger.role, hasPopup: trigger.hasPopup }
      : { found: false },
    generationMenu: menu ? { found: true, role: menu.role, visibleOptionNames: menu.choices.names } : { found: false },
  };
}

function selectAspect(root, target = "1:1") {
  const want = normalizeAspectLabel(target);
  if (!want) throw new Error(`SCHEMA_INVALID: invalid target aspect ${target}`);
  const current = readAspectSetting(root);
  if (current === want) return { ok: true, aspect: want, method: "already-selected" };
  for (const opt of scanSettingOptions(root)) {
    const label = optionLabel(opt);
    if (!label || isIconGarbage(label)) continue;
    if (normalizeAspectLabel(label) === want) {
      clickOption(opt);
      const after = readAspectSetting(root);
      if (after === want) return { ok: true, aspect: want, method: "option" };
      throw new Error(`ASPECT_VERIFY_FAILED: clicked ${want} but live aspect reads ${after || "UNKNOWN"}`);
    }
  }
  throw new Error(`TARGET_ASPECT_NOT_AVAILABLE: ${want} not offered by live UI`);
}

function selectOutputCount(root, target = 1) {
  const want = parseInt(target, 10);
  if (!Number.isInteger(want) || want < 1 || want > 8) throw new Error(`SCHEMA_INVALID: invalid target output count ${target}`);
  const current = readOutputCount(root);
  if (current.value === want) return { ok: true, outputCount: want, method: "already-selected" };
  for (const opt of scanSettingOptions(root)) {
    const label = optionLabel(opt);
    if (!label || isIconGarbage(label)) continue;
    const m = label.match(/\b([1-8])\b/);
    if (m && parseInt(m[1], 10) === want) {
      clickOption(opt);
      const after = readOutputCount(root);
      if (after.value === want) return { ok: true, outputCount: want, method: "option" };
      throw new Error(`OUTPUT_COUNT_VERIFY_FAILED: clicked ${want} but live count reads ${after.value === null ? "UNKNOWN" : after.value}`);
    }
  }
  throw new Error(`OUTPUT_COUNT_NOT_AVAILABLE: ${want} not offered by live UI`);
}

/**
 * POST-v1E standard-mode baseline (§8). STANDARD only; never enables Agent.
 * If Agent is enabled AND the control is a plain switch, one zero-credit
 * toggle-off is attempted + verified. Otherwise returns
 * AGENT_MODE_DETECTED with an actionable message and does NOT Generate.
 */
function ensureStandardMode(root) {
  const mode = detectFlowAgentMode(root);
  if (!mode.detected || mode.mode === "STANDARD") return { standard: true, agentMode: mode };
  const control = query(root, "AGENT_MODE");
  let toggleable = false;
  try {
    if (control && control.getAttribute) {
      const role = control.getAttribute("role");
      toggleable =
        role === "switch" ||
        control.getAttribute("aria-checked") === "true" ||
        control.getAttribute("aria-pressed") === "true" ||
        control.checked === true;
    } else if (control && control.checked === true) {
      toggleable = true;
    }
  } catch {
    toggleable = false;
  }
  if (toggleable && control && typeof control.click === "function") {
    control.click();
    const after = detectFlowAgentMode(root);
    if (!after.detected || after.mode === "STANDARD") {
      return { standard: true, agentMode: after, switchedOff: true };
    }
  }
  return {
    standard: false,
    code: "AGENT_MODE_DETECTED",
    agentMode: mode,
    message: "Flow Agent đang bật. Hãy tắt Flow Agent trong giao diện Flow rồi chuẩn bị lại. Extension không tự tạo khi Agent bật.",
  };
}

/**
 * FIX 02 §11 — forbidden keys inside an instruction-apply payload.
 * Any payload carrying model/output/settings/generation/credential material
 * is rejected before any DOM is touched. Single owner: this adapter
 * (provider-side); the bridge evidence validator owns the sync-evidence side.
 */
const INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS = [
  "model",
  "outputcount",
  "confirmbefore",
  "generate",
  "cookie",
  "authtoken",
  "sessiontoken",
  "apikey",
  "password",
  "credential",
  "authorization",
];

function rejectForbiddenInstructionPayload(payload) {
  const hits = [];
  const walk = (v, trail) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${trail}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        const kl = String(k).toLowerCase().replace(/[_-]/g, "");
        if (INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS.some((f) => kl.includes(f))) hits.push(`${trail}.${k}`);
        walk(val, `${trail}.${k}`);
      }
    }
  };
  walk(payload, "$");
  return hits;
}

/**
 * FIX 02 §13 — click one instruction control by selector key.
 * Centralized here so the dispatcher never touches DOM directly (FP15).
 * Throws SELECTOR_MISSING / INSTRUCTION_CONTROL_NOT_CLICKABLE.
 */
function clickInstructionControl(root, key) {
  const found = queryWithFallback(root, key);
  if (!found.el) throw new Error(`SELECTOR_MISSING: ${key}`);
  if (typeof found.el.click !== "function") throw new Error(`INSTRUCTION_CONTROL_NOT_CLICKABLE: ${key}`);
  found.el.click();
  return { clicked: true, key, matchedSelector: found.matchedSelector, fallbackUsed: found.fallbackUsed };
}

/**
 * FIX 02 §12 — Agent ON control (instruction path only). If Agent is already
 * on, no click. Otherwise one toggle attempt on a plain switch control,
 * then Agent state is RE-READ before anything else runs. Touches nothing
 * else: no models, no outputs, no Confirm-before-generating.
 */
function ensureAgentOn(root) {
  const before = detectFlowAgentMode(root);
  if (before.detected && before.mode === "AGENT") return { agent: true, agentMode: before, alreadyOn: true };
  if (!before.detected) {
    return { agent: false, code: "BLOCKED_AGENT_STATE_UNKNOWN", agentMode: before, message: "Không thấy điều khiển Agent trên trang Flow." };
  }
  const control = query(root, "AGENT_MODE");
  let toggleable = false;
  try {
    if (control && control.getAttribute) {
      const role = control.getAttribute("role");
      toggleable =
        role === "switch" ||
        control.getAttribute("aria-checked") === "false" ||
        control.getAttribute("aria-pressed") === "false" ||
        control.checked === false;
    } else if (control && control.checked === false) {
      toggleable = true;
    }
  } catch {
    toggleable = false;
  }
  if (toggleable && control && typeof control.click === "function") {
    control.click();
    const after = detectFlowAgentMode(root);
    if (after.detected && after.mode === "AGENT") {
      return { agent: true, agentMode: after, switchedOn: true };
    }
    return { agent: false, code: "BLOCKED_AGENT_STATE_UNKNOWN", agentMode: after, message: "Đã thử bật Agent nhưng trạng thái sau đó không xác nhận được." };
  }
  return { agent: false, code: "BLOCKED_AGENT_STATE_UNKNOWN", agentMode: before, message: "Không bật được Agent một cách an toàn (điều khiển không phải công tắc)." };
}

/**
 * POST-v1E result baseline + generation-start evidence (§27–§28).
 * Baseline captured BEFORE Generate; only NEW results correlate.
 */
function captureResultBaseline(root) {
  const urls = detectResults(root);
  let at = null;
  try {
    at = new Date().toISOString();
  } catch {
    at = "unknown";
  }
  return { urls: urls.slice(), count: urls.length, at };
}

function diffNewResults(baseline, currentUrls) {
  const seen = new Set(((baseline && baseline.urls) || []).map(String));
  return (currentUrls || []).map(String).filter((u) => !seen.has(u));
}

function readGenerateState(root) {
  const det = detectGenerateButton(root);
  let busy = false;
  let label = null;
  if (det.found) {
    const found = queryWithFallback(root, "GENERATE_BUTTON");
    const el = found.el;
    try {
      if (el.getAttribute) {
        if (el.getAttribute("aria-busy") === "true") busy = true;
        if (el.getAttribute("data-loading") === "true") busy = true;
      }
    } catch {
      /* best-effort */
    }
    label = shortControlLabel(el, 40);
    if (label && /loading|generating|creating|đang tạo/i.test(label)) busy = true;
  }
  return { found: det.found, enabled: det.enabled, busy, label };
}

/** Pure: did generation observably start between two states? */
function assessGenerationStart(before, after, { baselineUrls = [], currentUrls = [] } = {}) {
  const evidence = [];
  if (before && before.enabled === true && after && after.found === true && after.enabled === false) {
    evidence.push("generate-disabled-after-submit");
  }
  if (after && after.busy === true) evidence.push("generate-busy");
  const fresh = diffNewResults({ urls: baselineUrls }, currentUrls);
  if (fresh.length > 0) evidence.push("new-result-appeared");
  return { started: evidence.length > 0, evidence, newUrls: fresh };
}

/**
 * POST-v1B capability-scoped readiness (fix FLOW_PAGE_NOT_READY).
 * PROMPT_READY: prompt input found AND writable/interactable.
 * DRY_RUN_READY: PROMPT_READY + Generate control found (DISABLED IS ALLOWED —
 * Generate typically enables only after prompt insertion). Optional controls
 * (MODE_*, MODEL_CONTROL, OUTPUT_COUNT, CREDIT_DISPLAY, RESULT_*, DOWNLOAD_*)
 * are deliberately NOT required for dry-run readiness.
 */
function isPromptWritable(el) {
  if (!el) return false;
  try {
    if (el.disabled === true) return false;
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return false;
    if (el.readOnly === true) return false;
  } catch {
    return false;
  }
  try {
    if (el.isContentEditable === true) return true;
    const ce = el.getAttribute && el.getAttribute("contenteditable");
    if (ce === "true" || ce === "") return true;
  } catch {
    /* fall through to tag check */
  }
  try {
    const tag = String(el.tagName || "").toLowerCase();
    return tag === "textarea" || tag === "input";
  } catch {
    return false;
  }
}

function normalizePromptText(t) {
  // POST-v1E.1 P0 canonical normalization — applied SYMMETRICALLY to expected
  // and observed text. NFC first, then formatting noise, then ONLY the
  // whitespace the editor itself appends at the end. Internal whitespace and
  // newlines are preserved — a broad collapse would hide real corruption.
  let s = String(t === null || t === undefined ? "" : t);
  s = s.normalize("NFC");
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/\u00A0/g, " ");
  s = s.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  s = s.split("\n").map((line) => line.replace(/[ \t]+$/, "")).join("\n");
  return s.replace(/\s+$/, "");
}

/** Short non-crypto fingerprint for match evidence (never raw text). */
function fingerprintText(t) {
  const s = String(t || "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${s.length}`;
}

function codePointTag(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * POST-v1E.1 P0 mismatch diagnostics (never guess): where exactly do the
 * normalized strings diverge, and what did the editor append? Raw values are
 * reported only on FAILURE, JSON.stringify'd, per the live-fix contract.
 */
function diffPromptText(expectedRaw, observedRaw) {
  const expected = normalizePromptText(expectedRaw);
  const observed = normalizePromptText(observedRaw);
  let firstDiffIndex = -1;
  let firstDiffCodePoint = null;
  const minLen = Math.min(expected.length, observed.length);
  for (let i = 0; i < minLen; i++) {
    if (expected[i] !== observed[i]) {
      firstDiffIndex = i;
      firstDiffCodePoint = codePointTag(observed.codePointAt(i));
      break;
    }
  }
  if (firstDiffIndex === -1 && expected.length !== observed.length) {
    firstDiffIndex = minLen;
    firstDiffCodePoint = observed.length > expected.length ? codePointTag(observed.codePointAt(minLen)) : codePointTag((expected.codePointAt(minLen) || 0));
  }
  const trailing = [];
  const tail = observedRaw.slice(-4);
  for (const ch of tail) trailing.push(codePointTag(ch.codePointAt(0)));
  return {
    expectedRaw: JSON.stringify(String(expectedRaw === null || expectedRaw === undefined ? "" : expectedRaw)),
    observedRaw: JSON.stringify(String(observedRaw === null || observedRaw === undefined ? "" : observedRaw)),
    rawExpectedLength: String(expectedRaw === null || expectedRaw === undefined ? "" : expectedRaw).length,
    rawObservedLength: String(observedRaw === null || observedRaw === undefined ? "" : observedRaw).length,
    expectedLength: expected.length,
    observedLength: observed.length,
    firstDiffIndex,
    firstDiffCodePoint,
    observedTrailingCodePoints: trailing,
  };
}

/**
 * POST-v1E.2G P0 - logical contenteditable reader. Raw textContent DROPS the
 * newline a <br> represents (live evidence: expected "...background.\nNo
 * text." observed "...background.No text." after dom-replace insertion), so
 * textContent is never the canonical contenteditable value. The logical text
 * is reconstructed from the DOM: text nodes -> their text, <br> -> "\n",
 * block boundaries (div/p/...) -> one logical newline (no duplicates at
 * adjacent boundaries). CRLF/CR -> LF afterwards; NBSP/zero-width remain the
 * job of normalizePromptText (no internal whitespace collapse).
 */
const LOGICAL_BLOCK_TAGS = new Set(["div", "p", "li", "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"]);

function readContentEditableLogicalText(editor) {
  if (!editor) return "";
  let out = "";
  const appendBoundary = () => {
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
  };
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      out += String(node.data || "");
      return;
    }
    let tag = "";
    try {
      tag = String(node.tagName || node.tag || "").toLowerCase();
    } catch {
      tag = "";
    }
    if (tag === "br") {
      out += "\n";
      return;
    }
    const children = (typeof node.childNodes !== "undefined" && node.childNodes) || node.children || [];
    const isBlock = LOGICAL_BLOCK_TAGS.has(tag);
    if (isBlock) appendBoundary();
    for (const child of Array.from(children)) walk(child);
    if (isBlock && out.length > 0 && !out.endsWith("\n")) out += "\n";
  };
  try {
    walk(editor);
  } catch {
    return "";
  }
  return out.replace(/\r\n?/g, "\n");
}

/** POST-v1E.2G P0 - diagnostic DOM shape (first 12 nodes), failure logging only. */
function domShapeOf(editor) {
  if (!editor) return [];
  const children = (typeof editor.childNodes !== "undefined" && editor.childNodes) || editor.children || [];
  const shape = [];
  for (const node of Array.from(children).slice(0, 12)) {
    if (node.nodeType === 3) shape.push("TEXT");
    else {
      const tag = String((node.tagName || node.tag || "")).toLowerCase();
      shape.push(tag === "br" ? "BR" : `BLOCK(${tag})`);
    }
  }
  return shape;
}

/** FIX 03 §6 canonical prompt reader — scoped editor only, never page-wide. */
function readPromptEditorText(editor) {
  if (!editor) return "";
  try {
    const tag = String(editor.tagName || "").toLowerCase();
    if ((tag === "input" || tag === "textarea") && typeof editor.value === "string") return editor.value;
  } catch {
    /* fall through to editable read */
  }
  // POST-v1E.2G: contenteditable is read LOGICALLY (br/blocks -> newlines);
  // innerText/textContent are fallbacks only (real-DOM innerText may be
  // unavailable in portals; textContent drops <br> newlines).
  if (isContentEditableEl(editor)) {
    const logical = readContentEditableLogicalText(editor);
    if (logical) return logical;
  }
  for (const prop of ["innerText", "textContent"]) {
    try {
      const v = editor[prop];
      if (typeof v === "string" && v) return v;
    } catch {
      /* best-effort */
    }
  }
  return "";
}

/** Visible-DOM verification that the prompt control actually contains the text. */
function verifyPromptContent(el, expectedText) {
  if (!el) return { verified: false, actual: null };
  const actual = normalizePromptText(readPromptEditorText(el));
  const expected = normalizePromptText(expectedText);
  return { verified: expected.length > 0 && actual === expected, actual: actual.slice(0, 200) };
}

/** Normal input/change events so the page's own handlers observe the edit. */
function dispatchEditEvents(el) {
  const win = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : {};
  try {
    if (typeof el.dispatchEvent === "function") {
      const InputEventCtor = typeof win.InputEvent === "function" ? win.InputEvent : null;
      const inputEvt = InputEventCtor ? new InputEventCtor("input", { bubbles: true }) : new win.Event("input", { bubbles: true });
      el.dispatchEvent(inputEvt);
      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input") {
        el.dispatchEvent(new win.Event("change", { bubbles: true }));
      }
    }
  } catch {
    /* event dispatch is best-effort in mocked DOMs */
  }
}

function assessDryRunReadiness(root) {
  const promptFound = queryWithFallback(root, "PROMPT_INPUT");
  const prompt = {
    found: Boolean(promptFound.el),
    writable: isPromptWritable(promptFound.el),
    matchedSelector: promptFound.matchedSelector,
    fallbackUsed: promptFound.fallbackUsed,
  };
  const generate = detectGenerateButton(root);
  const PROMPT_READY = prompt.found && prompt.writable;
  const DRY_RUN_READY = PROMPT_READY && generate.found;
  return { prompt, generate, PROMPT_READY, DRY_RUN_READY };
}

/**
 * POST-v1E FIX 02 — prompt-composer readiness. Live evidence: the Flow
 * prompt composer mounts asynchronously after a UI transition (at one probe
 * moment 0 editors, seconds later 1 contenteditable + 2 inputs), so a single
 * missing-DOM lookup is NOT "does not exist".
 *
 * Canonical anchor (live-observed): button[aria-label="Add ingredients to
 * the prompt box"]. It scopes the composer container; the interactable
 * editor is resolved INSIDE that scope. Hard-excluded everywhere: Search
 * input, g-recaptcha-response / CAPTCHA subtrees, account/profile UI,
 * hidden or disabled editors.
 */
const FLOW_COMPOSER_READY_TIMEOUT_MS = 10000;
const COMPOSER_ANCHOR_SELECTOR = 'button[aria-label="Add ingredients to the prompt box"]';
const SEMANTIC_EDITOR_SELECTOR = 'input[aria-label="Editable text"]';
const ACCOUNT_UI_RE = /google\s*account|account\s+details|membership|profile|signed\s+in/i;
const FORBIDDEN_CONTROL_RE = /g-recaptcha|recaptcha|captcha|^search$/i;

/** True when the element self-identifies as Search / CAPTCHA / account UI. */
function isForbiddenControl(el) {
  if (!el || !el.getAttribute) return false;
  for (const a of ["aria-label", "title", "name"]) {
    let v = null;
    try {
      v = el.getAttribute(a);
    } catch {
      v = null;
    }
    if (typeof v === "string" && v) {
      const t = v.replace(/\s+/g, " ").trim();
      if (FORBIDDEN_CONTROL_RE.test(t) || ACCOUNT_UI_RE.test(t)) return true;
    }
  }
  return false;
}

function isHiddenControl(el) {
  try {
    if (el.getAttribute) {
      if (el.getAttribute("hidden") !== null) return true;
      if (el.getAttribute("aria-hidden") === "true") return true;
      if (String(el.getAttribute("type") || "").toLowerCase() === "hidden") return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
}

/** Constrained editor candidates, best-first, inside a composer container. */
const COMPOSER_EDITOR_SELECTORS = [SEMANTIC_EDITOR_SELECTOR, '[contenteditable="true"]', ...SELECTORS.PROMPT_INPUT.fallbacks];

function findPromptEditorIn(container) {
  for (const sel of COMPOSER_EDITOR_SELECTORS) {
    let list = [];
    try {
      list = container.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const el of list) {
      if (isForbiddenControl(el) || isHiddenControl(el) || !isPromptWritable(el)) continue;
      return el;
    }
  }
  return null;
}

/**
 * Resolve the live prompt composer. Preferred: anchor button → nearest
 * ancestor holding a real editor. Fallback (no anchor / UI revamp): the
 * existing constrained PROMPT_INPUT candidates. Returns
 * { composerRoot, editor, via } or null.
 */
function resolvePromptComposer(root) {
  let anchor = null;
  try {
    anchor = root.querySelector(COMPOSER_ANCHOR_SELECTOR);
  } catch {
    anchor = null;
  }
  if (anchor) {
    // ponytail: bounded 10-level ancestor walk instead of full tree
    // analysis; widen only if a live layout nests the composer deeper.
    let node = anchor;
    for (let i = 0; i < 10 && node && node.parentElement; i++) {
      node = node.parentElement;
      const editor = findPromptEditorIn(node);
      if (editor) return { composerRoot: node, editor, via: "anchor" };
    }
  }
  const found = queryWithFallback(root, "PROMPT_INPUT");
  if (found.el && !isForbiddenControl(found.el) && !isHiddenControl(found.el) && isPromptWritable(found.el)) {
    return { composerRoot: null, editor: found.el, via: "fallback" };
  }
  return null;
}

/**
 * Shared bounded wait on fresh DOM: checkFn runs immediately, on every
 * relevant mutation (MutationObserver), and on poll fallback ticks. Resolves
 * checkFn's first truthy result, or null at the bounded deadline (timeout is
 * ONLY a safety boundary). Observer always disconnected.
 */
function waitUntilFreshDOM(root, checkFn, { timeoutMs, pollMs = 250 } = {}) {
  const startedAt = Date.now();
  const first = checkFn();
  if (first) return Promise.resolve(first);
  const GlobalRef = typeof globalThis !== "undefined" ? globalThis : {};
  const MO = GlobalRef.MutationObserver;
  if (typeof MO === "function") {
    return new Promise((resolve) => {
      let done = false;
      let obs = null;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          if (obs) obs.disconnect();
        } catch {
          /* noop */
        }
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      try {
        obs = new MO(() => {
          const hit = checkFn();
          if (hit) finish(hit);
        });
      } catch {
        obs = null;
      }
      if (obs) {
        try {
          const target = typeof document !== "undefined" && document ? document : root;
          obs.observe(target, { childList: true, subtree: true, attributes: true });
        } catch {
          obs = null;
        }
      }
      if (!obs) {
        // No usable observer here: bounded poll on fresh DOM, same semantics.
        clearTimeout(timer);
        const poll = () => {
          const hit = checkFn();
          if (hit) return resolve(hit);
          if (Date.now() - startedAt >= timeoutMs) return resolve(null);
          setTimeout(poll, pollMs);
        };
        poll();
      }
    });
  }
  return new Promise((resolve) => {
    const poll = () => {
      const hit = checkFn();
      if (hit) return resolve(hit);
      if (Date.now() - startedAt >= timeoutMs) return resolve(null);
      setTimeout(poll, pollMs);
    };
    poll();
  });
}

/**
 * Wait for the async-mounted prompt composer. Immediate lookup first; then
 * MutationObserver re-resolving from fresh DOM on every relevant mutation;
 * bounded timeout is ONLY a safety boundary. Always stops the observer.
 * Resolves { ready:true, composerRoot, editor, waited, elapsedMs } or
 * { ready:false, code:"FLOW_COMPOSER_READY_TIMEOUT", elapsedMs, waited }.
 */
function waitForPromptComposer(root, { timeoutMs = FLOW_COMPOSER_READY_TIMEOUT_MS, ...rest } = {}) {
  const startedAt = Date.now();
  const immediate = resolvePromptComposer(root);
  if (immediate) return Promise.resolve({ ready: true, ...immediate, waited: false, elapsedMs: 0 });
  return waitUntilFreshDOM(
    root,
    () => {
      const hit = resolvePromptComposer(root);
      return hit ? { ready: true, ...hit, waited: true, elapsedMs: Date.now() - startedAt } : null;
    },
    { timeoutMs, ...rest }
  ).then((hit) => hit || { ready: false, code: "FLOW_COMPOSER_READY_TIMEOUT", elapsedMs: Date.now() - startedAt, waited: true });
}

/**
 * FIX 03 §12 — wait for the live composer editor to hold the expected prompt.
 * Flow may re-render after the edit, so every check re-resolves the composer
 * from fresh DOM and reads the CURRENT editor. Resolves structured evidence
 * (no raw text): { matched, editorReplaced, expectedLength, observedLength,
 * fingerprintMatch, elapsedMs } or { matched:false, code:"PROMPT_VERIFY_TIMEOUT", ... }.
 */
const FLOW_PROMPT_VERIFY_TIMEOUT_MS = 4000;

function waitForPromptValue(root, expectedText, { timeoutMs = FLOW_PROMPT_VERIFY_TIMEOUT_MS, pollMs = 250, originalEditor = null } = {}) {
  const expected = normalizePromptText(expectedText);
  const startedAt = Date.now();
  const readFresh = () => {
    let editor = null;
    try {
      const resolved = resolvePromptComposer(root);
      editor = resolved && resolved.editor ? resolved.editor : null;
    } catch {
      editor = null;
    }
    return { editor, observed: editor ? normalizePromptText(readPromptEditorText(editor)) : "" };
  };
  const shape = (matched, r) => ({
    matched,
    editorReplaced: Boolean(originalEditor && r.editor && r.editor !== originalEditor),
    expectedLength: expected.length,
    observedLength: r.observed.length,
    fingerprintMatch: matched && expected.length > 0 && fingerprintText(r.observed) === fingerprintText(expected),
    elapsedMs: Date.now() - startedAt,
  });
  const first = readFresh();
  if (expected.length > 0 && first.observed === expected) return Promise.resolve(shape(true, first));
  return waitUntilFreshDOM(
    root,
    () => {
      const r = readFresh();
      if (expected.length > 0 && r.observed === expected) return shape(true, r);
      return null;
    },
    { timeoutMs, pollMs }
  ).then((hit) => hit || { ...shape(false, readFresh()), matched: false, code: "PROMPT_VERIFY_TIMEOUT" });
}

/**
 * FIX 03 §15 — app-state commit check: after DOM verification, re-read the
 * live editor after a short bounded stability window. Flow reverting the
 * prompt is PROMPT_APP_STATE_NOT_COMMITTED (Generate-enabled is NOT the
 * commit signal — it may stay disabled until settings resolve).
 */
const FLOW_PROMPT_STABILITY_MS = 500;

async function confirmPromptStable(root, expectedText, { stabilityMs = FLOW_PROMPT_STABILITY_MS, originalEditor = null } = {}) {
  const expected = normalizePromptText(expectedText);
  await new Promise((resolve) => setTimeout(resolve, stabilityMs));
  let editor = null;
  try {
    const resolved = resolvePromptComposer(root);
    editor = resolved && resolved.editor ? resolved.editor : null;
  } catch {
    editor = null;
  }
  const observed = editor ? normalizePromptText(readPromptEditorText(editor)) : "";
  return {
    stable: expected.length > 0 && observed === expected,
    observedLength: observed.length,
    editorReplaced: Boolean(originalEditor && editor && editor !== originalEditor),
  };
}

/** FIX 03 §14 — contenteditable detection shared by insertion paths. */
function isContentEditableEl(el) {
  try {
    return el.isContentEditable === true || el.getAttribute("contenteditable") === "true";
  } catch {
    return false;
  }
}

/**
 * FIX 03 §9 Strategy 2 — DOM replacement with text nodes + <br> for line
 * breaks (ordinary editing semantics, no framework-private state). Falls
 * back to plain textContent where DOM APIs are unavailable (mocked DOMs).
 */
function replaceEditableContents(el, doc, text) {
  const lines = String(text).split("\n");
  if (doc && typeof el.appendChild === "function" && typeof doc.createElement === "function" && typeof doc.createTextNode === "function") {
    try {
      el.textContent = "";
      lines.forEach((line, i) => {
        if (i > 0) el.appendChild(doc.createElement("br"));
        if (line) el.appendChild(doc.createTextNode(line));
      });
      return;
    } catch {
      /* fall through to plain assignment */
    }
  }
  el.textContent = text;
}

/**
 * POST-v1E.1 PromptWriter abstraction. One writer per editor type; the
 * contenteditable writer treats execCommand("insertText") as a COMPATIBILITY
 * FALLBACK only (live evidence: execCommand left an extra trailing character
 * in the Flow editor) — ordinary DOM replacement + input event is primary.
 * No writer may assume acceptance: the caller always waits for editor/UI
 * stabilization, rereads, normalizes and verifies (waitForPromptValue +
 * confirmPromptStable).
 */
const PROMPT_WRITERS = {
  version: 2,
  native: writePromptToNativeInput,
  contenteditable: writePromptToContenteditable,
};

function writePromptToNativeInput(el, promptText) {
  let nativeSetter = null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    if (descriptor && typeof descriptor.set === "function") nativeSetter = descriptor.set;
  } catch {
    nativeSetter = null;
  }
  if (typeof el.focus === "function") el.focus();
  if (nativeSetter) nativeSetter.call(el, promptText);
  else el.value = promptText;
  dispatchEditEvents(el);
  return nativeSetter ? "native-value-setter" : "value";
}

function writePromptToContenteditable(el, promptText) {
  const doc = (typeof el.ownerDocument !== "undefined" && el.ownerDocument) || (typeof document !== "undefined" ? document : null);
  // Primary: ordinary DOM replacement (text nodes + <br>) + input event.
  if (typeof el.focus === "function") el.focus();
  replaceEditableContents(el, doc, promptText);
  dispatchEditEvents(el);
  if (normalizePromptText(readPromptEditorText(el)).length > 0) return "dom-replace";
  // Compatibility fallback: deprecated execCommand path, still verified by
  // the caller — its success boolean is never acceptance.
  if (doc && typeof doc.execCommand === "function" && typeof doc.getSelection === "function" && typeof doc.createRange === "function") {
    if (typeof el.focus === "function") el.focus();
    const sel = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    if (doc.execCommand("insertText", false, promptText) === true && normalizePromptText(readPromptEditorText(el)).length > 0) {
      return "execCommand-insertText";
    }
  }
  return null;
}

/**
 * Insert the prompt into the CURRENT resolved composer editor via the
 * matching PromptWriter. Returns safe telemetry only (lengths, strategy,
 * editor identity) — never the prompt body.
 */
function insertPromptText(root, promptText) {
  const resolved = resolvePromptComposer(root);
  if (!resolved || !resolved.editor) throw new Error("SELECTOR_MISSING: PROMPT_INPUT");
  const el = resolved.editor;
  if (!isPromptWritable(el)) throw new Error("PROMPT_EDITOR_NOT_WRITABLE: composer editor is not interactable");
  const tag = String(el.tagName || "").toLowerCase();
  const isCE = isContentEditableEl(el);
  const editorType = isCE ? (tag === "input" ? "input[contenteditable]" : "contenteditable") : tag;
  const writer = isCE ? PROMPT_WRITERS.contenteditable : PROMPT_WRITERS.native;
  const beforeLength = normalizePromptText(readPromptEditorText(el)).length;
  let strategy = null;
  try {
    strategy = writer(el, promptText);
  } catch (e) {
    throw new Error(`PROMPT_INSERT_FAILED: ${String((e && e.message) || e)}`);
  }
  return {
    insertedEditor: el,
    editorType,
    strategy: strategy || "none",
    beforeLength,
    afterObservedLength: normalizePromptText(readPromptEditorText(el)).length,
  };
}

/** §10 safe composer diagnostic — counts and booleans only, never content. */
function composerProbe(root) {
  let anchorFound = false;
  try {
    anchorFound = Boolean(root.querySelector(COMPOSER_ANCHOR_SELECTOR));
  } catch {
    anchorFound = false;
  }
  const resolved = resolvePromptComposer(root);
  const editor = resolved && resolved.editor;
  let type = null;
  if (editor) {
    try {
      const tag = String(editor.tagName || "").toLowerCase();
      type = editor.isContentEditable === true || editor.getAttribute("contenteditable") === "true" ? (tag === "input" ? "input[contenteditable]" : "contenteditable") : tag;
    } catch {
      type = null;
    }
  }
  return {
    composerAnchorFound: anchorFound,
    composerRootFound: Boolean(resolved && resolved.composerRoot),
    promptEditableFound: Boolean(editor),
    promptEditableType: type,
    promptVisible: editor ? !isHiddenControl(editor) : false,
    promptWritable: editor ? isPromptWritable(editor) : false,
  };
}

/**
 * POST-v1B zero-credit dry-run insertion (§13). Inserts a harmless validation
 * prompt, observes settings/cost read-only, and STOPS BEFORE Generate.
 * Never clicks any button.
 *
 * Contenteditable support (live Flow resolves via [contenteditable="true"]):
 * focus → select existing contents → insert via execCommand("insertText")
 * (ordinary editing semantics the page's own handlers observe); falls back to
 * textContent assignment when execCommand is unavailable (mocked DOMs).
 * Never touches framework-private properties.
 */
function insertPromptDryRun(root, promptText) {
  const found = queryWithFallback(root, "PROMPT_INPUT");
  if (!found.el) throw new Error("SELECTOR_MISSING: PROMPT_INPUT");
  const el = found.el;
  const tag = String(el.tagName || "").toLowerCase();
  const contentEditable = (() => {
    try {
      return el.isContentEditable === true || el.getAttribute("contenteditable") === "true";
    } catch {
      return false;
    }
  })();
  let insertMethod = null;
  if (contentEditable) {
    try {
      if (typeof el.focus === "function") el.focus();
      const doc = (typeof el.ownerDocument !== "undefined" && el.ownerDocument) || (typeof document !== "undefined" ? document : null);
      let insertedViaExec = false;
      if (doc && typeof doc.execCommand === "function" && typeof doc.getSelection === "function" && typeof doc.createRange === "function") {
        const sel = doc.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        insertedViaExec = doc.execCommand("insertText", false, promptText) === true;
      }
      if (!insertedViaExec) el.textContent = promptText;
      insertMethod = insertedViaExec ? "execCommand:insertText" : "textContent";
    } catch (e) {
      throw new Error(`PROMPT_INSERT_FAILED: ${String((e && e.message) || e)}`);
    }
  } else if ("value" in el) {
    try {
      if (typeof el.focus === "function") el.focus();
      el.value = promptText;
      insertMethod = "value";
    } catch (e) {
      throw new Error(`PROMPT_INSERT_FAILED: ${String((e && e.message) || e)}`);
    }
  } else if (typeof el.textContent === "string" || "textContent" in el) {
    try {
      if (typeof el.focus === "function") el.focus();
      el.textContent = promptText;
      insertMethod = "textContent";
    } catch (e) {
      throw new Error(`PROMPT_INSERT_FAILED: ${String((e && e.message) || e)}`);
    }
  } else {
    throw new Error("PROMPT_INSERT_FAILED: unsupported prompt control type" + (tag ? ` (${tag})` : ""));
  }
  dispatchEditEvents(el);
  const verification = verifyPromptContent(el, promptText);
  const agent = detectFlowAgentMode(root);
  const outputCount = readOutputCount(root);
  return {
    inserted: true,
    verified: verification.verified,
    insertMethod,
    matchedSelector: found.matchedSelector,
    fallbackUsed: found.fallbackUsed,
    agentMode: agent,
    modelLabel: readModelLabel(root) || "UNKNOWN",
    aspectSetting: readAspectSetting(root) || "UNKNOWN",
    aspectRaw: readAspectSettingRaw(root),
    outputCount: outputCount.value === null ? "UNKNOWN" : outputCount.value,
    outputCountRaw: outputCount.raw,
    generationType: detectGenerationType(root),
    creditCost: readCreditCost(root) || "UNKNOWN",
    generate: detectGenerateButton(root),
    clickedGenerate: false,
    creditsConsumed: false,
  };
}

function submitAfterApproval(root, { approved, beforeSubmit }) {
  if (!approved) throw new Error("APPROVAL_REQUIRED: no generation before explicit approval");
  // POST-v1F: the "new control" baseline MUST be captured before the click,
  // otherwise a gate that appears as a result of the submit looks pre-existing.
  if (typeof beforeSubmit === "function") beforeSubmit();
  const btn = requireEl(root, "GENERATE_BUTTON");
  if (typeof btn.click === "function") btn.click();
  return { submitted: true };
}

/* ---------------------------------------------------------------------------
 * POST-v1F — Flow's own "Confirm before generating" gate.
 *
 * With `Confirm before generating = Always` (the ASSISTED_APPROVAL setting
 * POST-v1E.2F/2G enforces), clicking Start only ASKS Flow for permission; no
 * credit is spent until that ask is confirmed. So the submit path owns the
 * confirmation too, otherwise one approved attempt never completes.
 *
 * Safety rails, all mandatory:
 *   - at most ONE confirmation click, ever;
 *   - only a control that did not exist before the submit (a new element);
 *   - only a control whose accessible name positively names a confirmation
 *     action, and never one that names a stop/cancel/dismiss action;
 *   - never the Start/Generate control itself (that would be a 2nd generation);
 *   - never inside the Agent Settings surface;
 *   - bounded wait, and an unresolved gate is reported, never guessed.
 * ------------------------------------------------------------------------- */
const FLOW_CONFIRM_NAME_RE = /^(confirm|generate|yes|ok|okay|continue|proceed|do it|go ahead|run|create|start|submit)([\s.!:,-].*)?$/i;
const FLOW_CONFIRM_DENY_RE = /\b(stop|cancel|dismiss|close|not now|later|skip|discard|back|edit|settings|save)\b/i;

function confirmationCandidates(root) {
  const out = [];
  let list = [];
  try {
    list = root.querySelectorAll("button,[role='button'],[role='menuitem'],[role='tab']") || [];
  } catch {
    return out;
  }
  const settings = findAgentSettingsSurface(root);
  for (const el of Array.from(list)) {
    if (settings && settings.surface && isInside(settings.surface, el)) continue;
    if (!elementStillVisible(el, root)) continue;
    let name = "";
    try {
      name = String(semanticIdentity(el).accessibleName || "").replace(/\s+/g, " ").trim();
    } catch {
      name = "";
    }
    if (!name || name.length > 40) continue;
    if (FLOW_CONFIRM_DENY_RE.test(name)) continue;
    if (!FLOW_CONFIRM_NAME_RE.test(name)) continue;
    out.push({ el, name });
  }
  return out;
}

function isInside(ancestor, el) {
  let node = el;
  for (let i = 0; node && i <= 30; i++) {
    if (node === ancestor) return true;
    try {
      node = node.parentElement;
    } catch {
      return false;
    }
  }
  return false;
}

/** POST-v1F: the pre-submit baseline of confirmable controls (see awaitSubmitAcceptance). */
function snapshotConfirmCandidates(root) {
  return confirmationCandidates(root).map((c) => c.el);
}

/**
 * POST-v1F: everything the acceptance handshake needs, captured BEFORE the
 * Start click. Taking it afterwards would make the very signals it looks for
 * ("a Stop control appeared", "the prompt left the composer") look
 * pre-existing, i.e. it would always answer "not accepted".
 */
function captureSubmitBaseline(root) {
  return {
    knownClickables: snapshotConfirmCandidates(root),
    runBefore: captureGenerationRunState(root),
    promptBefore: promptLogicalText(root),
  };
}

function promptLogicalText(root) {
  try {
    const r = resolvePromptComposer(root);
    const editor = (r && r.editor) || query(root, "PROMPT_INPUT");
    return editor ? normalizePromptText(readPromptEditorText(editor)) : "";
  } catch {
    return "";
  }
}

/**
 * POST-v1F — the submit-acceptance handshake.
 *
 * Clicking Start proves nothing: the click can be absorbed by an overlay (that
 * happened live) and Flow can sit on its own confirmation gate. The job may only
 * be treated as truly GENERATING once the page shows POSITIVE evidence that
 * Google Flow took the request. One bounded loop does both jobs:
 *   - resolve Flow's confirmation gate at most once (same rails as before);
 *   - then wait for an acceptance signal.
 *
 * Acceptance signals, strongest first:
 *   stop-control-appeared | start-replaced-by-stop | composer-cleared
 * Nothing else counts. On timeout it returns `SUBMIT_NOT_ACCEPTED` — never a
 * RESULT_TIMEOUT, because no generation was ever accepted.
 */
const FLOW_SUBMIT_ACCEPT_TIMEOUT_MS = 45000;

async function awaitSubmitAcceptance(root, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || FLOW_SUBMIT_ACCEPT_TIMEOUT_MS;
  const pollMs = Number(opts.pollMs) || 400;
  const base = opts.baseline || null;
  const known = new Set(
    Array.isArray(opts.knownClickables) ? opts.knownClickables : base ? base.knownClickables : snapshotConfirmCandidates(root)
  );
  const generateEl = queryWithFallback(root, "GENERATE_BUTTON").el;
  const before = base ? base.runBefore : captureGenerationRunState(root);
  const promptBefore = base && typeof base.promptBefore === "string" ? base.promptBefore : promptLogicalText(root);
  const at = () => {
    try {
      return new Date().toISOString();
    } catch {
      return "unknown";
    }
  };
  const accepted = (signal) => ({ accepted: true, signal, at: at(), confirmClicked: confirmClicked });
  const deadline = Date.now() + timeoutMs;
  // POST-v1F: `mayClick:false` makes this a pure observer (used by the
  // AWAIT_SUBMIT_ACCEPTANCE poll while the user performs the one trusted
  // gesture). It must never click anything on its own.
  const mayClick = opts.mayClick !== false;
  let confirmClicked = null;
  for (;;) {
    // 1. Flow's own confirmation gate (at most once).
    if (mayClick && confirmClicked === null) {
      let fresh = [];
      try {
        fresh = confirmationCandidates(root).filter((c) => !known.has(c.el) && c.el !== generateEl);
      } catch {
        fresh = [];
      }
      if (fresh.length > 0) {
        confirmClicked = fresh[0].name;
        try {
          fresh[0].el.click();
        } catch {
          return { accepted: false, signal: null, at: at(), confirmClicked, code: "FLOW_CONFIRMATION_CLICK_FAILED" };
        }
      }
    }
    // 2. Positive acceptance evidence.
    const stop = findStopControl(root);
    if (stop && !before.stopControlPresent) return accepted("stop-control-appeared");
    const start = queryWithFallback(root, "GENERATE_BUTTON").el;
    const label = start ? String(semanticIdentity(start).accessibleName || "").toLowerCase() : "";
    const beforeLabel = String((before.startState && before.startState.label) || "").toLowerCase();
    if (beforeLabel && /start/.test(beforeLabel) && /stop|cancel/.test(label)) return accepted("start-replaced-by-stop");
    if (promptBefore && !promptLogicalText(root)) return accepted("composer-cleared");
    if (Date.now() >= deadline) {
      return {
        accepted: false,
        signal: null,
        at: at(),
        confirmClicked,
        code: "SUBMIT_NOT_ACCEPTED",
        observed: { promptBeforeLength: promptBefore.length, startLabel: label || null, stopControlPresent: Boolean(stop) },
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function mediaSrc(m) {
  if (!m) return "";
  if (typeof m.src === "string" && m.src) return m.src;
  try {
    if (m.getAttribute) return m.getAttribute("src") || "";
  } catch {
    return "";
  }
  return "";
}

/**
 * POST-v1F: is this media element plausibly a GENERATED result?
 *
 * The broad RESULT_MEDIA fallbacks also match page chrome — above all the
 * signed-in account avatar (`…googleusercontent.com/ogw/…=s32-c-mo`), which is
 * a 32 px image sitting in the header. Importing that as "the result" is a
 * correlation failure, so chrome is refused here.
 *
 * Deliberately NOT a size threshold: the authoritative minimum-resolution
 * policy lives once in the bridge (`bridge/media-quality.js`) and is enforced
 * on the candidate as measured at detection time. A second copy of the number
 * here would only be able to drift out of sync with it.
 */
const RESULT_CHROME_HINT_RE = /(^|[\/_-])(avatar|profile|account|ogw)([\/_-]|$)|\/ob4\/|\/ggpht\//i;

/** POST-v1F: Flow serves project/generated media from flow.google.com/asb/*. */
const GENERATED_MEDIA_RE = /(^|\/\/)flow\.google\.com\/asb\//i;

function isGeneratedResultCandidate(el, src) {
  const s = String(src || "");
  if (!s) return false;
  if (RESULT_CHROME_HINT_RE.test(s)) return false;
  try {
    if (el && el.getAttribute) {
      const alt = `${el.getAttribute("alt") || ""} ${el.getAttribute("aria-label") || ""} ${el.className || ""}`;
      if (/avatar|profile picture|account/i.test(String(alt))) return false;
    }
  } catch {
    /* best-effort */
  }
  return true;
}

function detectResults(root) {
  const container = query(root, "RESULT_CONTAINER");
  // Preferred: media scoped inside the detected result container (real DOM
  // elements support scoped lookup; mock DOMs fall through to root-level).
  if (container && typeof container.querySelectorAll === "function") {
    const scoped = [];
    for (const sel of ["img", "video"]) {
      let list = [];
      try {
        list = container.querySelectorAll(sel) || [];
      } catch {
        list = [];
      }
      for (const m of list) {
        const src = mediaSrc(m);
        // POST-v1F: the guard used to run ONLY in the fallback branch, so the
        // account avatar walked straight through the scoped/primary path and
        // was imported as the result. Guard every branch.
        if (src && !scoped.includes(src) && isGeneratedResultCandidate(m, src)) scoped.push(src);
      }
    }
    if (scoped.length > 0) return scoped;
  }
  // POST-v1F: querySelectorAll returns a NodeList in a real document (no .map);
  // the mock DOM returns arrays, which is why only live runs exposed this.
  const medias = Array.from(root.querySelectorAll(SELECTORS.RESULT_MEDIA.selector) || []);
  const primary = medias
    .filter((m) => isGeneratedResultCandidate(m, mediaSrc(m)))
    .map(mediaSrc)
    .filter(Boolean);
  if (primary.length > 0) return primary;
  // Constrained fallback scan across registered fallback selectors.
  // POST-v1F: these selectors are deliberately broad (`img[src*="googleusercontent"]`
  // also matches the ACCOUNT AVATAR), so every candidate must look like a
  // generated result: a plausible output size and no avatar/chrome naming.
  const seen = new Set(primary);
  for (const sel of SELECTORS.RESULT_MEDIA.fallbacks || []) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const m of list) {
      const src = mediaSrc(m);
      if (!src || seen.has(src)) continue;
      if (!isGeneratedResultCandidate(m, src)) continue;
      seen.add(src);
      primary.push(src);
    }
  }
  return primary;
}

/** POST-v1F: stable identity for a Flow `/asb/<assetId>` media URL. */
function resultAssetId(src) {
  const m = /\/(?:a)?sb\/([^=?#]+)/i.exec(String(src || ""));
  return m ? m[1] : null;
}

/**
 * POST-v1F §5/§7/§8: the EXACT candidate set, as measured at RESULT_DETECTED.
 *
 * `detectResults` returns bare URLs, which is enough for a baseline diff but
 * not enough to prove later that a downloaded artifact belongs to this attempt.
 * This records the identity, geometry and turn scoping of every guarded
 * candidate so the bridge can persist it and gate the import on it.
 *
 * @param {Document|Element} root
 * @param {{baselineUrls?:string[], promptNeedle?:string}} [opts]
 */
function collectResultCandidates(root, opts = {}) {
  const baseline = new Set((opts.baselineUrls || []).map(String));
  const needle = String(opts.promptNeedle || "").trim();
  // POST-v1F: the agent turn that contains the sent prompt is the strongest
  // correlation signal available — media inside it was produced by that turn.
  let turnEl = null;
  if (needle && root && typeof root.querySelectorAll === "function") {
    try {
      const holders = Array.from(root.querySelectorAll("*")).filter((e) => String(e.textContent || "").includes(needle));
      const deepest = holders.length ? holders[holders.length - 1] : null;
      let t = deepest;
      for (let i = 0; i < 12 && t; i++) {
        if (t.querySelectorAll && t.querySelectorAll("img,video").length > 0) break;
        t = t.parentElement;
      }
      turnEl = t && t.querySelectorAll && t.querySelectorAll("img,video").length > 0 ? t : null;
    } catch {
      turnEl = null;
    }
  }
  const els = [];
  const selectors = [SELECTORS.RESULT_MEDIA.selector, ...(SELECTORS.RESULT_MEDIA.fallbacks || []), "img", "video"];
  for (const sel of selectors) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    for (const m of list) if (!els.includes(m)) els.push(m);
  }
  const out = [];
  for (const el of els) {
    const url = mediaSrc(el);
    if (!url || !isGeneratedResultCandidate(el, url)) continue;
    const naturalWidth = Number(el.naturalWidth) || null;
    const naturalHeight = Number(el.naturalHeight) || null;
    let sameAgentTurn = false;
    try {
      sameAgentTurn = !!(turnEl && typeof turnEl.contains === "function" && turnEl.contains(el));
    } catch {
      sameAgentTurn = false;
    }
    let container = null;
    try {
      const host = el.closest ? el.closest('[class]') : null;
      if (host) container = String(host.className || "").slice(0, 80) || host.tagName;
    } catch {
      container = null;
    }
    out.push({
      candidateId: null,
      url,
      assetId: resultAssetId(url),
      currentSrc: (() => { try { return el.currentSrc || null; } catch { return null; } })(),
      src: (() => { try { return el.getAttribute ? el.getAttribute("src") : null; } catch { return null; } })(),
      srcset: (() => { try { return el.getAttribute ? el.getAttribute("srcset") : null; } catch { return null; } })(),
      naturalWidth,
      naturalHeight,
      mediaType: String(el.tagName || "").toLowerCase() === "video" ? "VIDEO" : "IMAGE",
      isNew: !baseline.has(String(url)),
      sameAgentTurn,
      container,
      alt: (() => { try { return el.getAttribute ? el.getAttribute("alt") : null; } catch { return null; } })(),
    });
  }
  // POST-v1F §7: group variants of one logical asset and keep the largest, so
  // a thumbnail can never win over the full-resolution sibling.
  const byAsset = new Map();
  for (const c of out) {
    const key = c.assetId || c.url;
    const prev = byAsset.get(key);
    const area = (c.naturalWidth || 0) * (c.naturalHeight || 0);
    const prevArea = prev ? (prev.naturalWidth || 0) * (prev.naturalHeight || 0) : -1;
    if (!prev || area > prevArea) byAsset.set(key, c);
  }
  const best = [...byAsset.values()];
  best.forEach((c, i) => { c.candidateId = `c${i + 1}`; });
  return best;
}

/**
 * pollResult(stateProvider, { deadlineMs, nowMs }) — observable-state polling.
 * stateProvider(nowMs) → { ready:boolean, items:string[] }.
 * Returns { found:true, items } or { timeout:true }. NEVER triggers generation.
 */
function pollResult(stateProvider, { deadlineMs = 120000, nowMs = 0 } = {}) {
  const step = 1000;
  let t = nowMs;
  while (t - nowMs <= deadlineMs) {
    const s = stateProvider(t);
    if (s && s.ready) return { found: true, items: s.items || [] };
    t += step;
  }
  return { timeout: true };
}

/**
 * POST-v1B observable result observation (§11). Prefers MutationObserver on
 * the live result container; falls back to bounded polling. Resolves with
 * { found:true, items } or { timeout:true }. Never assumes success by sleep.
 */
function observeResults(root, { timeoutMs = 120000 } = {}) {
  const readNow = () => detectResults(root);
  if (readNow().length > 0) return Promise.resolve({ found: true, items: readNow(), method: "immediate" });
  const GlobalRef = typeof globalThis !== "undefined" ? globalThis : {};
  const MO = GlobalRef.MutationObserver;
  const container = query(root, "RESULT_CONTAINER");
  if (typeof MO === "function" && container && typeof container.addEventListener !== "undefined") {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (!done) {
          done = true;
          try {
            obs.disconnect();
          } catch {
            /* noop */
          }
          resolve(value);
        }
      };
      const timer = setTimeout(() => finish({ timeout: true, method: "mutation-observer" }), timeoutMs);
      const obs = new MO(() => {
        const items = readNow();
        if (items.length > 0) {
          clearTimeout(timer);
          finish({ found: true, items, method: "mutation-observer" });
        }
      });
      try {
        obs.observe(container, { childList: true, subtree: true, attributes: true });
      } catch {
        clearTimeout(timer);
        finish({ timeout: true, method: "mutation-observer-unavailable" });
      }
    });
  }
  // Bounded synchronous poll fallback (mock DOMs / no MutationObserver).
  const steps = Math.max(1, Math.floor(timeoutMs / 1000));
  for (let i = 0; i <= steps; i++) {
    const items = readNow();
    if (items.length > 0) return Promise.resolve({ found: true, items, method: "poll" });
  }
  return Promise.resolve({ timeout: true, method: "poll" });
}

/** Duplicate-result guard: only report URLs not already seen for this job. */
function filterNewResults(jobId, urls, seen) {
  if (!jobId) throw new Error("JOB_IDENTITY_REQUIRED: jobId");
  const set = seen instanceof Set ? seen : new Set(seen || []);
  const fresh = (urls || []).filter((u) => !set.has(u));
  for (const u of fresh) set.add(u);
  return { fresh, seen: set };
}

/**
 * detectRefusal(root) — safe refusal/failure detection (STEP 10B-FIX).
 * Reports structured observations; classification happens bridge-side in
 * safety-refusal.js (creative/policy reasoning stays in UNFOLDIQ, not DOM).
 * Never matches one exact English string: checks known message patterns via
 * element presence + text capture, DOM status structure, and generic failure.
 * No private APIs inspected.
 */
function elementText(el) {
  if (!el) return "";
  if (typeof el.textContent === "string") return el.textContent;
  if (typeof el.innerText === "string") return el.innerText;
  return "";
}

function detectRefusal(root) {
  const safetyEl = query(root, "SAFETY_MESSAGE");
  const policyEl = query(root, "POLICY_STATE");
  const failureEl = query(root, "FAILURE_STATE");
  const message = [elementText(safetyEl), elementText(policyEl)].filter(Boolean).join(" ").trim();
  if (safetyEl || (policyEl && /polic|safety|block|refus|restrict/i.test(message))) {
    return { refused: true, kind: "SAFETY_SIGNAL", message: message || null };
  }
  if (failureEl) {
    return { refused: true, kind: "FAILURE_STATE", message: elementText(failureEl).trim() || null };
  }
  return { refused: false, kind: "NONE", message: null };
}

/**
 * POST-v1B safe live DOM probe (§live-fix).
 * Collects candidate-control metadata to identify the current Generate /
 * model / settings controls WITHOUT collecting sensitive content.
 * Records per candidate ONLY: tagName, role, aria-label, title, type,
 * disabled state, short UI-control label (button-like, ≤40 chars), and
 * safe stable attributes (aria-expanded/haspopup/checked/selected, name).
 * NEVER records: input values, textarea/contenteditable text, prompt
 * content, media src/href, account data, cookies, tokens, alt text,
 * placeholders, or arbitrary page text.
 */
const PROBE_SELECTORS = [
  "button",
  '[role="button"]',
  "input",
  "textarea",
  "select",
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="switch"]',
  '[role="spinbutton"]',
  '[contenteditable="true"]',
  "a[download]",
  "video",
  "img",
];

function safeAttr(el, name, maxLen) {
  try {
    const v = el.getAttribute ? el.getAttribute(name) : null;
    if (typeof v !== "string" || !v) return null;
    const t = v.replace(/\s+/g, " ").trim();
    if (!t) return null;
    return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
  } catch {
    return null;
  }
}

/**
 * POST-v1E FIX 02 probe privacy: generic redaction applied to every probe
 * string BEFORE it leaves the adapter (so UI logs are covered too).
 * Emails → [REDACTED_EMAIL]; long opaque token-like runs → [REDACTED_TOKEN].
 */
function redactSafe(v) {
  if (typeof v !== "string" || !v) return v;
  let t = v.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
  t = t.replace(/[A-Za-z0-9_-]{25,}/g, "[REDACTED_TOKEN]");
  return t;
}

function probeCandidateControls(root, { max = 60, perSelector = 15 } = {}) {
  const controls = [];
  const counts = {};
  let truncated = false;
  for (const sel of PROBE_SELECTORS) {
    let list = [];
    try {
      list = root.querySelectorAll(sel) || [];
    } catch {
      list = [];
    }
    counts[sel] = list.length;
    let taken = 0;
    for (const el of list) {
      if (controls.length >= max || taken >= perSelector) {
        truncated = true;
        break;
      }
      // POST-v1E FIX 02: hard-exclude CAPTCHA, Search, and account/profile
      // chrome — live probe output once leaked account-identifying
      // aria-labels. ponytail: own-attribute exclusion only (no ancestor
      // subtree walk); add ancestor check if a live leak ever shows up.
      if (isForbiddenControl(el)) continue;
      taken += 1;
      let tag = "";
      try {
        tag = String(el.tagName || el.tag || "").toLowerCase();
      } catch {
        tag = "";
      }
      const isButtonLike = tag === "button" || tag === "a" || safeAttr(el, "role", 20) === "button" || safeAttr(el, "role", 20) === "menuitem" || safeAttr(el, "role", 20) === "tab";
      const entry = { tag: tag || null, via: sel, role: redactSafe(safeAttr(el, "role", 30)), ariaLabel: redactSafe(safeAttr(el, "aria-label", 80)), title: redactSafe(safeAttr(el, "title", 80)) };
      const type = safeAttr(el, "type", 20);
      if (type) entry.type = type;
      try {
        if (el.disabled === true) entry.disabled = true;
        else if (el.getAttribute && el.getAttribute("aria-disabled") === "true") entry.disabled = true;
      } catch {
        /* disabled is best-effort */
      }
      for (const a of ["aria-expanded", "aria-haspopup", "aria-checked", "aria-selected", "name"]) {
        const v = redactSafe(safeAttr(el, a, 20));
        if (v) entry[a.replace(/^aria-/, "")] = v;
      }
      // Short visible label for button-like controls only; values, media
      // sources, alt text, and placeholders are deliberately never read.
      if (isButtonLike) {
        let label = "";
        try {
          if (typeof el.textContent === "string" && el.textContent) label = el.textContent;
          else if (typeof el.innerText === "string" && el.innerText) label = el.innerText;
        } catch {
          label = "";
        }
        label = String(label || "").replace(/\s+/g, " ").trim();
        if (label) {
          // Account/profile concepts can live in visible text too — exclude.
          if (ACCOUNT_UI_RE.test(label)) continue;
          entry.label = redactSafe(label.length > 40 ? `${label.slice(0, 40)}…` : label);
        }
      }
      controls.push(entry);
    }
  }
  return { controls, counts, truncated, max };
}

/**
 * POST-v1B live diagnostics bundle (§21). Reflects LIVE queried state —
 * never fixture claims. `env` carries host-side facts (extension version,
 * origin, bridge reachability, job id/state, last error).
 */
function buildLiveDiagnostics(root, env = {}) {
  const health = selectorHealthContract(root);
  const outputCount = readOutputCount(root);
  return {
    adapterVersion: ADAPTER_VERSION,
    extensionVersion: env.extensionVersion || null,
    flowOrigin: env.flowOrigin || null,
    contentScriptInjected: env.contentScriptInjected ?? null,
    bridgeReachable: env.bridgeReachable ?? null,
    currentJobId: env.currentJobId || null,
    jobState: env.jobState || null,
    selectorHealth: health,
    promptControlFound: Boolean(query(root, "PROMPT_INPUT")),
    generateControlFound: detectGenerateButton(root),
    resultControlFound: Boolean(query(root, "RESULT_CONTAINER")),
    downloadControlFound: detectDownloadControl(root),
    agentMode: detectFlowAgentMode(root),
    modelLabel: readModelLabel(root) || "UNKNOWN",
    aspectSetting: readAspectSetting(root) || "UNKNOWN",
    outputCount: outputCount.value === null ? "UNKNOWN" : outputCount.value,
    generationType: generationTypeDiagnostics(root),
    creditCost: readCreditCost(root) || "UNKNOWN",
    composerProbe: composerProbe(root),
    projectIdentity: extractFlowProjectIdentity(root),
    instructionSurface: buildInstructionDiagnostics(root),
    lastError: env.lastError || null,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ADAPTER_VERSION,
    SELECTORS_VERSION,
    SELECTORS,
    TEXT_FALLBACKS,
    ICON_GARBAGE_RE,
    queryWithFallback,
    selectorHealth,
    selectorHealthContract,
    prepareJob,
    detectPromptControl,
    detectFlowAgentMode,
    normalizeAspectLabel,
    normalizeModelLabel,
    normalizeCreditLabel,
    readModelLabel,
    readCreditCost,
    readAspectSetting,
    readAspectSettingRaw,
    readOutputCount,
    detectGenerationType,
    generationTypeDiagnostics,
    findGenerationTriggerCandidates,
    classifyGenerationTrigger,
    classifySurface,
    startSurfaceMutationCapture,
    findMarkerContainer,
    resolveFlowMode,
    prepareAgentSettings,
    readContentEditableLogicalText,
    domShapeOf,
    findAgentSettingsMarkerContainer,
    agentSectionChoice,
    classifyAgentSettingsSurface,
    generationChoicesIn,
    findOpenGenerationMenu,
    GENERATION_TRIGGER_MAX,
    FLOW_GENERATION_MENU_TIMEOUT_MS,
    FLOW_GENERATION_VERIFY_TIMEOUT_MS,
    assessGenerationReady,
    buildApprovalPacket,
    detectGenerateButton,
    detectDownloadControl,
    selectMode,
    applySettings,
    attachReferences,
    attachFrame,
    isPromptWritable,
    FLOW_COMPOSER_READY_TIMEOUT_MS,
    resolvePromptComposer,
    waitForPromptComposer,
    composerProbe,
    redactSafe,
    normalizePromptText,
    readPromptEditorText,
    fingerprintText,
    diffPromptText,
    PROMPT_WRITERS,
    FLOW_PROMPT_VERIFY_TIMEOUT_MS,
    FLOW_PROMPT_STABILITY_MS,
    insertPromptText,
    waitForPromptValue,
    confirmPromptStable,
    assessDryRunReadiness,
    verifyPromptContent,
    insertPromptDryRun,
    detectInstructionsSurface,
    extractInstructionReadback,
    readInstructionEditorText,
    extractFlowProjectIdentity,
    verifyProjectIdentity,
    setInstructionGuidelines,
    applyInstructionGuidelines,
    buildInstructionDiagnostics,
    countInstructionMatches,
    findGuidelineTarget,
    ensureAgentOn,
    INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS,
    rejectForbiddenInstructionPayload,
    clickInstructionControl,
    submitAfterApproval,
awaitSubmitAcceptance,
    snapshotConfirmCandidates,
    captureSubmitBaseline,
    hasAgentComposerControls,
    agentSettingsDrawerOpen,
    isGeneratedResultCandidate,
    resultAssetId,
    collectResultCandidates,
    readAgentMaterial,
    restoreComposer,
      detectResults,
    pollResult,
    observeResults,
    filterNewResults,
    detectRefusal,
    probeCandidateControls,
    buildLiveDiagnostics,
    openGenerationSettings,
    closeGenerationSettings,
    selectGenerationType,
    selectAspect,
    selectOutputCount,
    ensureStandardMode,
    captureResultBaseline,
    diffNewResults,
    readGenerateState,
    assessGenerationStart,
  };
}

// POST-v1B: browser namespace for the isolated-world content runtime
// (content-runtime.js). Invisible to page scripts; no DOM touched here.
try {
  if (typeof window !== "undefined" && !window.FlowPageAdapter) {
    window.FlowPageAdapter = {
      ADAPTER_VERSION,
      SELECTORS_VERSION,
      SELECTORS,
      TEXT_FALLBACKS,
      ICON_GARBAGE_RE,
      queryWithFallback,
      selectorHealth,
      selectorHealthContract,
      prepareJob,
      detectPromptControl,
      detectFlowAgentMode,
      normalizeAspectLabel,
      normalizeModelLabel,
      normalizeCreditLabel,
      readModelLabel,
      readCreditCost,
      readAspectSetting,
      readAspectSettingRaw,
      readOutputCount,
      detectGenerationType,
    generationTypeDiagnostics,
    findGenerationTriggerCandidates,
    classifyGenerationTrigger,
    classifySurface,
    startSurfaceMutationCapture,
    findMarkerContainer,
    resolveFlowMode,
    prepareAgentSettings,
    readContentEditableLogicalText,
    domShapeOf,
    findAgentSettingsMarkerContainer,
    agentSectionChoice,
    classifyAgentSettingsSurface,
    generationChoicesIn,
    findOpenGenerationMenu,
    GENERATION_TRIGGER_MAX,
    FLOW_GENERATION_MENU_TIMEOUT_MS,
    FLOW_GENERATION_VERIFY_TIMEOUT_MS,
      assessGenerationReady,
      buildApprovalPacket,
      detectGenerateButton,
      detectDownloadControl,
      selectMode,
      applySettings,
      attachReferences,
      attachFrame,
      isPromptWritable,
      FLOW_COMPOSER_READY_TIMEOUT_MS,
      resolvePromptComposer,
      waitForPromptComposer,
      composerProbe,
      redactSafe,
      normalizePromptText,
      readPromptEditorText,
      fingerprintText,
      diffPromptText,
      PROMPT_WRITERS,
      FLOW_PROMPT_VERIFY_TIMEOUT_MS,
      FLOW_PROMPT_STABILITY_MS,
      insertPromptText,
      waitForPromptValue,
      confirmPromptStable,
    assessDryRunReadiness,
    verifyPromptContent,
    insertPromptDryRun,
      detectInstructionsSurface,
      extractInstructionReadback,
      readInstructionEditorText,
      extractFlowProjectIdentity,
      verifyProjectIdentity,
      setInstructionGuidelines,
      applyInstructionGuidelines,
      buildInstructionDiagnostics,
      countInstructionMatches,
      findGuidelineTarget,
      ensureAgentOn,
      INSTRUCTION_FORBIDDEN_PAYLOAD_KEYS,
      rejectForbiddenInstructionPayload,
      clickInstructionControl,
      submitAfterApproval,
awaitSubmitAcceptance,
    snapshotConfirmCandidates,
    captureSubmitBaseline,
    hasAgentComposerControls,
    agentSettingsDrawerOpen,
    isGeneratedResultCandidate,
    resultAssetId,
    collectResultCandidates,
    readAgentMaterial,
    restoreComposer,
    openAgentSettingsSurface,
      detectResults,
      pollResult,
      observeResults,
      filterNewResults,
      detectRefusal,
      probeCandidateControls,
      buildLiveDiagnostics,
      openGenerationSettings,
      closeGenerationSettings,
      selectGenerationType,
      selectAspect,
      selectOutputCount,
      ensureStandardMode,
      captureResultBaseline,
      diffNewResults,
      readGenerateState,
      assessGenerationStart,
    };
  }
} catch (e) {
  void e;
}
