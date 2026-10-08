"use strict";

/**
 * UNFOLDIQ Flow Companion service worker (STEP 10B).
 * Validates sender origin + message schema, polls job state with a bounded
 * deadline, and NEVER auto-submits a credit-consuming generation.
 */

// FLOW BRIDGE security: restrict chrome.storage.local to trusted extension
// contexts (service worker + side panel) so content scripts cannot read the
// remembered Bridge token directly. Guarded — runtimes without storage
// setAccessLevel simply skip the hardening (lastError swallowed; the failure
// must never break startup).
try {
  if (typeof chrome !== "undefined" && chrome.storage && typeof chrome.storage.local.setAccessLevel === "function") {
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, () => void (chrome.runtime.lastError && true));
  }
} catch (e) {
  void e; // setAccessLevel unavailable: default behavior, token ownership unchanged
}

const JOB_MESSAGE_TYPES = new Set(["JOB_PREPARE", "JOB_APPROVE", "JOB_CANCEL", "JOB_STATUS"]);

const FLOW_ORIGIN_PREFIXES = ["https://labs.google/fx/", "https://flow.google/", "https://flow.google.com/"];

function validateSender(sender) {
  const url = (sender && (sender.url || sender.origin)) || "";
  // Extension-page senders must be THIS extension (hardening sweep C-6) —
  // a bare chrome-extension:// prefix trusted any co-installed extension.
  if (url.startsWith("chrome-extension://")) {
    const ownId = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) || null;
    const senderId = (sender && sender.id) || "";
    if (!ownId || senderId !== ownId) {
      throw new Error(`SENDER_REJECTED: foreign extension origin ${url}`);
    }
    return true;
  }
  const allowed = FLOW_ORIGIN_PREFIXES.some((p) => url.startsWith(p));
  if (!allowed) {
    throw new Error(`SENDER_REJECTED: ${url}`);
  }
  return true;
}

function validateMessage(msg) {
  if (!msg || typeof msg !== "object") throw new Error("SCHEMA_INVALID: message must be an object");
  if (!JOB_MESSAGE_TYPES.has(msg.type)) throw new Error(`SCHEMA_INVALID: unknown type ${msg.type}`);
  if (!msg.jobId) throw new Error("SCHEMA_INVALID: jobId required");
  return true;
}

/**
 * Bounded status poll. Returns the last observed state or a timeout marker.
 * Timeout reports RETRYABLE_ERROR/MANUAL_ASSIST upstream — never a new submit.
 */
function pollJobState(getState, { deadlineMs = 60000, nowMs = 0 } = {}) {
  const step = 1000;
  let t = nowMs;
  let last = null;
  while (t - nowMs <= deadlineMs) {
    last = getState(t);
    if (last && (last.status === "RESULT_DETECTED" || last.status === "FAILED")) return { done: true, state: last };
    t += step;
  }
  return { timeout: true, last };
}

function handleMessage(msg, sender) {
  validateSender(sender);
  validateMessage(msg);
  return { accepted: true, type: msg.type, jobId: msg.jobId };
}

/**
 * POST-v1B: correlate a chrome.downloads item to a Flow Job (pure helper).
 * Prefers explicit downloadId/filename evidence; a latest-file fallback must
 * be bounded by time window + MIME check and reported via fallbackUsed.
 * Never guesses from "latest file" alone without those bounds.
 * POST-v1E §33: explicit-id matches are DIRECT; bounded latest-file
 * fallbacks are additionally marked FALLBACK_CORRELATION.
 */
function correlateDownload(job, downloadItem, { maxAgeMs = 5 * 60 * 1000, nowMs = Date.now() } = {}) {
  if (!job || !job.jobId) throw new Error("JOB_IDENTITY_REQUIRED: job.jobId");
  if (!downloadItem) return { correlated: false, code: "DOWNLOAD_NOT_FOUND", fallbackUsed: false };
  const startedAt = Date.parse(downloadItem.startTime || "") || 0;
  const ageMs = nowMs - startedAt;
  const withinWindow = !startedAt || ageMs <= maxAgeMs;
  const mime = downloadItem.mime || downloadItem.mimeType || "";
  const looksMedia = /image|video|png|jpe?g|webp|mp4|webm/i.test(`${mime} ${downloadItem.filename || ""}`);
  if (!withinWindow) return { correlated: false, code: "DOWNLOAD_STALE", fallbackUsed: Boolean(downloadItem.fallbackUsed) };
  if (!looksMedia) return { correlated: false, code: "DOWNLOAD_MIME_MISMATCH", fallbackUsed: Boolean(downloadItem.fallbackUsed) };
  const fallback = Boolean(downloadItem.fallbackUsed);
  return {
    correlated: true,
    jobId: job.jobId,
    downloadId: downloadItem.id ?? null,
    filename: downloadItem.filename || null,
    mime: mime || null,
    fallbackUsed: fallback,
    correlation: fallback ? "FALLBACK_CORRELATION" : "DIRECT",
  };
}

/**
 * POST-v1B: precise error classification (§22). Manual assist is a fallback
 * route, never the diagnostic category.
 */
const ERROR_CODES = [
  "FLOW_TAB_NOT_FOUND",
  "FLOW_ORIGIN_NOT_ALLOWED",
  "CONTENT_SCRIPT_NOT_INJECTED",
  "BRIDGE_UNREACHABLE",
  "JOB_POLL_FAILED",
  "FLOW_PAGE_NOT_READY",
  "PROMPT_INPUT_NOT_FOUND",
  "PROMPT_INPUT_NOT_WRITABLE",
  "PROMPT_INSERT_FAILED",
  "PROMPT_VERIFY_FAILED",
  "MODEL_CONTROL_NOT_FOUND",
  "GENERATE_CONTROL_NOT_FOUND",
  "GENERATE_STILL_DISABLED_AFTER_PROMPT",
  "GENERATION_SETTINGS_NOT_RESOLVED",
  "GENERATION_NOT_READY",
  "GENERATION_TYPE_UNKNOWN",
  "GENERATION_TYPE_NOT_IMAGE",
  "PROMPT_NOT_VERIFIED",
  "APPROVAL_NOT_RECORDED",
  "RESULT_TIMEOUT",
  "RESULT_NOT_DETECTED",
  "GENERATION_START_NOT_CONFIRMED",
  "GENERATE_CLICK_FAILED",
  "APPROVAL_STALE_CHANGED",
  "APPROVAL_MISMATCH",
  "AGENT_MODE_DETECTED",
  "TARGET_ASPECT_NOT_AVAILABLE",
  "OUTPUT_COUNT_NOT_AVAILABLE",
  "SETTINGS_POPOVER_NOT_OBSERVED",
  "DOWNLOAD_CONTROL_NOT_FOUND",
  "DOWNLOAD_FAILED",
  "IMPORT_FAILED",
  "PROVIDER_SAFETY_REFUSED",
  "FLOW_UI_CHANGED",
];

function classifyError(code, detail = null) {
  if (!ERROR_CODES.includes(code)) throw new Error(`SCHEMA_INVALID: unknown error code ${code}`);
  return { code, detail, manualAssistFallback: false };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { validateSender, validateMessage, pollJobState, handleMessage, JOB_MESSAGE_TYPES, correlateDownload, classifyError, ERROR_CODES, FLOW_ORIGIN_PREFIXES, createRelayHub, recordLocalApproval, consumeLocalApproval, validateTrustedInputSpec };
  var TraceContractMod = null;
  try { TraceContractMod = require("../contracts/trace-contract.js"); } catch (e) { TraceContractMod = null; }
  module.exports.TraceContract = TraceContractMod;
  module.exports.buildSwSpan = function (kind, jobId, tStart, tEnd) {
    if (!TraceContractMod) return null;
    try {
      return TraceContractMod.buildTraceSpan({ source: "extension", kind, jobId, tStart, tEnd });
    } catch (e) { return null; }
  };
}

/**
 * POST-v1B live runtime (browser only; inert under node).
 * - Tracks connected Flow tabs (content-script "flow-tab" ports).
 * - Relays side-panel TAB_RELAY commands to the latest Flow tab with
 *   id-correlation and bounded timeouts (createRelayHub — pure, tested).
 * - Gates SUBMIT_GENERATE behind a fresh single-use local approval that
 *   must match jobId+attempt (recordLocalApproval/consumeLocalApproval).
 * Bridge HTTP itself is driven by the side panel (extension page, covered
 * by host_permissions); the worker never holds the bridge token.
 */
function createRelayHub({ postToTab }) {
  if (typeof postToTab !== "function") throw new Error("SCHEMA_INVALID: postToTab required");
  const pending = new Map();
  let seq = 0;
  function send(cmd, { timeoutMs = 60000 } = {}) {
    const id = `relay-${Date.now()}-${(seq += 1)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("JOB_POLL_FAILED: flow tab reply timeout"));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        },
      });
      try {
        postToTab({ ...cmd, id });
      } catch (e) {
        pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }
  function onReply(msg) {
    if (!msg || !msg.id || !pending.has(msg.id)) return false;
    const slot = pending.get(msg.id);
    if (msg.ok) slot.resolve(msg.result);
    else slot.reject(new Error((msg && msg.error) || "FLOW_TAB_ERROR"));
    return true;
  }
  return { send, onReply, pendingCount: () => pending.size };
}

function recordLocalApproval(map, { jobId, attempt, approvedBy, nonce = null, fingerprint = null }) {
  if (!jobId || attempt === undefined || !approvedBy) throw new Error("SCHEMA_INVALID: jobId+attempt+approvedBy required");
  map.set(jobId, { jobId, attempt, approvedBy, approvedAt: new Date().toISOString(), used: false, nonce, fingerprint });
  return { recorded: true, jobId, attempt };
}

function consumeLocalApproval(map, jobId, attempt, expected = {}) {
  const ap = map.get(jobId);
  if (!ap || ap.used === true) throw new Error("APPROVAL_REQUIRED: no unused approval for this job");
  if (ap.attempt !== attempt) throw new Error("APPROVAL_MISMATCH: approval attempt does not match");
  // POST-v1E §23: when the submitter presents a nonce/fingerprint, it must
  // match the recorded approval (double-click, rerender, worker-restart
  // replays and cross-packet submits cannot consume it). Absent expectations
  // keep backward compatibility (approval still single-use).
  const want = expected || {};
  if ((want.nonce !== undefined && want.nonce !== null) || (want.fingerprint !== undefined && want.fingerprint !== null)) {
    if (want.nonce !== undefined && want.nonce !== null && ap.nonce !== undefined && ap.nonce !== null && want.nonce !== ap.nonce) {
      throw new Error("APPROVAL_MISMATCH: approval nonce does not match");
    }
    if (want.fingerprint !== undefined && want.fingerprint !== null && ap.fingerprint !== undefined && ap.fingerprint !== null && want.fingerprint !== ap.fingerprint) {
      throw new Error("APPROVAL_STALE_CHANGED: approval fingerprint does not match");
    }
  }
  ap.used = true;
  return ap;
}

/**
 * PHASE 1G.9 FIX 03 §10/§22 — pure gate for the trusted-input fallback.
 * Node-testable (TI group): op allowlist, text bound, projectRef shape,
 * sender-tab requirement, Flow-origin-only senders.
 */
function validateTrustedInputSpec(spec, sender) {
  if (!spec || typeof spec !== "object") return { ok: false, code: "SCHEMA_INVALID: spec object required" };
  if (spec.op !== "insertText" && spec.op !== "keyText") return { ok: false, code: "SCHEMA_INVALID: op must be insertText|keyText" };
  if (typeof spec.text !== "string" || !spec.text || spec.text.length > 20000) return { ok: false, code: "SCHEMA_INVALID: spec.text invalid" };
  const ref = typeof spec.projectRef === "string" ? spec.projectRef : "";
  if (!/^[0-9a-f][0-9a-f-]{15,63}$/i.test(ref)) return { ok: false, code: "SCHEMA_INVALID: projectRef invalid" };
  if (!sender || !sender.tab || typeof sender.tab.id !== "number") return { ok: false, code: "SCHEMA_INVALID: sender tab required" };
  const senderUrl = String(sender.url || sender.origin || "");
  if (!FLOW_ORIGIN_PREFIXES.some((p) => senderUrl.startsWith(p))) return { ok: false, code: "FLOW_ORIGIN_NOT_ALLOWED" };
  return { ok: true };
}

(function initBrowserRuntime() {
  const hasChrome = typeof chrome !== "undefined" && chrome && chrome.runtime;
  if (!hasChrome || typeof module !== "undefined") return;
  // POST-v1C: toolbar icon opens the Side Panel (MV3 Side Panel API).
  try {
    if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === "function") {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    }
  } catch (e) {
    void e;
  }
  if (typeof importScripts === "function") {
    try {
      importScripts("tab-resolver.js");
    } catch (e) {
      void e;
    }
    try {
      // Phase 5C §22 (GAP-030): cross-boundary trace spans. Best-effort load;
      // span emission is skipped (never fatal) when the contract is absent.
      importScripts("../contracts/trace-contract.js");
    } catch (e) {
      void e;
    }
    try {
      // PHASE 1G.9 FIX 03: page-world instruction write transport (see
      // mainWorldInstructionWrite below). Browser global: InstructionMainWorldWrite.
      importScripts("../content/main-world-write.js");
    } catch (e) {
      void e;
    }
  }
  const Resolver = (typeof TabResolver !== "undefined" && TabResolver) || null;
  // Port registry is informational ONLY (hello presence). Routing always
  // goes through the canonical resolver — never trust this map at action time.
  const helloPorts = [];
  const approvals = new Map();
  // MV3 hardening (sweep B-1): the approval gate survives worker termination.
  // The in-memory map stays the fast path; every mutation is mirrored to
  // chrome.storage.session (non-secret: jobId/attempt/nonce/fingerprint only)
  // and rehydrated lazily on first use after a wake. Fail-safe direction is
  // unchanged: a missing approval BLOCKS submit, it can never duplicate one.
  let approvalsHydrated = false;
  async function persistApproval(jobId, entry) {
    try {
      if (!chrome.storage || !chrome.storage.session) return;
      const all = await chrome.storage.session.get("flowCompanionApprovals");
      const store = (all && all.flowCompanionApprovals) || {};
      if (entry === null) delete store[jobId];
      else store[jobId] = entry;
      await chrome.storage.session.set({ flowCompanionApprovals: store });
    } catch (e) {
      void e; // persistence is best-effort; the in-memory gate remains authoritative
    }
  }
  async function hydrateApprovals() {
    if (approvalsHydrated) return;
    approvalsHydrated = true;
    try {
      if (!chrome.storage || !chrome.storage.session) return;
      const all = await chrome.storage.session.get("flowCompanionApprovals");
      const store = (all && all.flowCompanionApprovals) || {};
      for (const [jobId, entry] of Object.entries(store)) {
        if (!approvals.has(jobId)) approvals.set(jobId, entry);
      }
    } catch (e) {
      void e; // rehydration is best-effort; absent approvals block submit (fail-safe)
    }
  }

  function resolverDeps() {
    return {
      tabsQuery: (patterns) => {
        if (!chrome.tabs || !chrome.tabs.query) return Promise.reject(new Error("TABS_API_UNAVAILABLE"));
        return chrome.tabs.query({ url: patterns });
      },
      sendPing: (tabId, msg) => sendTabMessage(tabId, msg, 15000),
      sessionGet: async () => {
        try {
          if (!chrome.storage || !chrome.storage.session) return null;
          const s = await chrome.storage.session.get("flowCompanionLiveTab");
          return (s && s.flowCompanionLiveTab) || null;
        } catch {
          return null;
        }
      },
      sessionSet: async (meta) => {
        if (!chrome.storage || !chrome.storage.session) return;
        const safe = { tabId: meta.tabId, origin: meta.origin, lastHandshakeAt: meta.lastHandshakeAt, source: meta.source };
        await chrome.storage.session.set({ flowCompanionLiveTab: safe });
      },
      reinject: async (tabId) => {
        if (!chrome.scripting || !chrome.scripting.executeScript) throw new Error("REINJECT_UNAVAILABLE: scripting API missing");
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["src/content/flow-page-adapter.js", "src/content/content-commands.js", "src/content/content-runtime.js"],
        });
      },
      nowMs: () => Date.now(),
    };
  }

  function sendTabMessage(tabId, msg, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!chrome.tabs || !chrome.tabs.sendMessage) return reject(new Error("TABS_API_UNAVAILABLE"));
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error("JOB_POLL_FAILED: flow tab reply timeout"));
        }
      }, timeoutMs || 60000);
      try {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp || resp.ok !== true) return reject(new Error((resp && resp.error) || "FLOW_TAB_ERROR"));
          resolve(resp.result);
        });
      } catch (e) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(e);
        }
      }
    });
  }

  async function relayToLiveTab(cmd, timeoutMs) {
    if (!Resolver) throw new Error("RESOLVER_UNAVAILABLE");
    const found = await Resolver.resolveLiveFlowTab(resolverDeps(), {});
    const result = await sendTabMessage(found.tabId, cmd, timeoutMs || 60000);
    return { result, resolution: found.resolution };
  }

  /**
   * PHASE 1G.9 FIX 03 §10 — trusted browser-input fallback (LAST RESORT).
   * Live evidence (rounds 5–6, 2026-10-04): even main-world browser-emitted
   * input events (execCommand insertText) update the DOM but never reach
   * Flow's editor state — the provider discards the text on save. Flow's
   * editor therefore requires browser-level input via the Chrome debugging
   * transport. Scope (§10/§22, all mandatory):
   *   - attach ONLY to the sender content script's own verified Flow tab;
   *   - re-check project identity from the tab URL immediately before write;
   *   - allowlist exactly two Input commands (insertText, per-char keyDown/
   *     keyUp) — no Network/Storage/Cookie/DOM/Runtime/Page domains, no
   *     arbitrary methods from any caller;
   *   - detach on success, failure and timeout (finally);
   *   - the bridge can never reach this route (content-script kind only).
   */
  async function trustedInputWrite(sender, spec) {
    const check = validateTrustedInputSpec(spec, sender);
    if (!check.ok) throw new Error(check.code);
    const tabId = sender.tab.id;
    const tab = await chrome.tabs.get(tabId);
    const tabUrl = (tab && tab.url) || "";
    if (!FLOW_ORIGIN_PREFIXES.some((p) => tabUrl.startsWith(p))) {
      throw new Error("FLOW_ORIGIN_NOT_ALLOWED: trusted input only on Flow tabs");
    }
    if (!tabUrl.includes(`/project/${spec.projectRef}`)) {
      throw new Error("BLOCKED_PROJECT_MISMATCH: tab URL does not match the verified project ref");
    }
    if (!chrome.debugger || !chrome.debugger.attach) {
      throw new Error("TRUSTED_INPUT_PERMISSION_BLOCKED: debugger API unavailable");
    }
    await chrome.debugger.attach({ tabId }, "1.3");
    try {
      if (spec.op === "insertText") {
        await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: spec.text });
      } else {
        // op === "keyText": per-character trusted key events (round-trip
        // bounded by spec text length validated above).
        for (const ch of String(spec.text)) {
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyDown", text: ch });
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyUp", text: ch });
        }
      }
      return { ok: true, op: spec.op };
    } finally {
      try {
        await chrome.debugger.detach({ tabId });
      } catch (e) {
        void e; // already detached / tab gone — nothing to clean up
      }
    }
  }

  /**
   * PHASE 1G.9 FIX 03 — main-world instruction write transport.
   * Narrowly scoped (task §9): the page-world function is the fixed,
   * hard-coded InstructionMainWorldWrite.write (no arbitrary code, no
   * Runtime.evaluate surface for bridge callers); the request carries data
   * only (selector/index/text). Allowed ONLY for the content script on the
   * same verified Flow tab (sender.tab + Flow origin). No network, storage,
   * cookie, or credential access exists in the injected function.
   */
  async function mainWorldInstructionWrite(sender, spec) {
    if (!spec || typeof spec !== "object") throw new Error("SCHEMA_INVALID: spec object required");
    if (typeof spec.selector !== "string" || !spec.selector || spec.selector.length > 200) throw new Error("SCHEMA_INVALID: spec.selector invalid");
    if (!Number.isInteger(spec.index) || spec.index < 0 || spec.index > 63) throw new Error("SCHEMA_INVALID: spec.index invalid");
    if (typeof spec.text !== "string" || !spec.text || spec.text.length > 20000) throw new Error("SCHEMA_INVALID: spec.text invalid");
    if (!sender || !sender.tab || typeof sender.tab.id !== "number") throw new Error("SCHEMA_INVALID: sender tab required");
    const senderUrl = (sender.url || sender.origin || "");
    if (!FLOW_ORIGIN_PREFIXES.some((p) => senderUrl.startsWith(p))) {
      throw new Error("FLOW_ORIGIN_NOT_ALLOWED: main-world write only on verified Flow tabs");
    }
    if (typeof InstructionMainWorldWrite === "undefined" || !InstructionMainWorldWrite || typeof InstructionMainWorldWrite.write !== "function") {
      throw new Error("MAIN_WORLD_WRITE_UNAVAILABLE: main-world-write module not loaded");
    }
    if (!chrome.scripting || !chrome.scripting.executeScript) throw new Error("MAIN_WORLD_WRITE_UNAVAILABLE: scripting API missing");
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: "MAIN",
        func: InstructionMainWorldWrite.write,
        args: [spec],
      });
      return (injection && injection.result) || { ok: false, code: "MAIN_WORLD_INJECTION_EMPTY" };
    } catch (e) {
      return { ok: false, code: "MAIN_WORLD_INJECTION_FAILED", detail: String((e && e.message) || e) };
    }
  }

  if (chrome.runtime.onConnect) {
    chrome.runtime.onConnect.addListener((port) => {
      if (!port || port.name !== "flow-tab") return;
      helloPorts.push(port);
      port.onDisconnect.addListener(() => {
        const i = helloPorts.indexOf(port);
        if (i >= 0) helloPorts.splice(i, 1);
      });
    });
  }
  if (chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      // Phase 5C §22: cross-boundary trace span (best-effort, never fatal).
      // tStart at receipt; kind from message; attached to the response for the
      // side panel to forward to the bridge /trace ingestor.
      const swSpanT0 = Date.now();
      const swSpanJobId = (msg && ((msg.cmd && msg.cmd.jobId) || (msg.approval && msg.approval.jobId))) || null;
      // GAP-030 causal linkage: a caller may attach {trace:{traceId, parentSpanId}}
      // so the emitted span joins an existing cross-boundary chain. Absent →
      // standalone root span (backward compatible).
      const swTraceCtx = (msg && msg.trace) || {};
      const swSpanKind = !msg || msg.kind === "TAB_RELAY"
        ? (msg && msg.cmd && msg.cmd.type === "SUBMIT_GENERATE" ? "SUBMIT_RELAYED" : "TAB_RELAY")
        : msg.kind === "APPROVE_RECORD" ? "APPROVAL_RECORDED"
        : msg.kind === "FLOW_TABS" ? "EXTENSION_WAKE" : null;
      (async () => {
        try {
          validateSender(sender);
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
        try {
          if (msg.kind === "MAIN_WORLD_INSTRUCTION_WRITE") {
            return { ok: true, result: await mainWorldInstructionWrite(sender, msg.spec) };
          }
          if (msg.kind === "INSTRUCTION_TRUSTED_INPUT") {
            return { ok: true, result: await trustedInputWrite(sender, msg.spec) };
          }
          if (!msg || msg.kind === "TAB_RELAY") {
            if (msg && msg.cmd && msg.cmd.type === "SUBMIT_GENERATE") {
              // POST-v1E §23: single-use approval bound to jobId+attempt and,
              // when presented, to the approval nonce + snapshot fingerprint.
              await hydrateApprovals();
              const ap = (msg.cmd && msg.cmd.approval) || {};
              const consumed = consumeLocalApproval(approvals, msg.cmd.jobId, msg.cmd.attempt, { nonce: ap.nonce ?? null, fingerprint: (ap.snapshot && ap.snapshot.fingerprint) || ap.fingerprint || null });
              await persistApproval(msg.cmd.jobId, { ...consumed, used: true });
              const relayed = await relayToLiveTab(msg.cmd, msg.timeoutMs || 60000);
              return { ok: true, result: relayed.result, resolution: relayed.resolution };
            }
            const relayed = await relayToLiveTab((msg && msg.cmd) || {}, (msg && msg.timeoutMs) || 60000);
            return { ok: true, result: relayed.result, resolution: relayed.resolution };
          }
          if (msg.kind === "APPROVE_RECORD") {
            const recorded = recordLocalApproval(approvals, msg.approval || {});
            await persistApproval(recorded.jobId, approvals.get(recorded.jobId) || null);
            return { ok: true, result: recorded };
          }
          if (msg.kind === "FLOW_TABS") {
            if (!Resolver) throw new Error("RESOLVER_UNAVAILABLE");
            const found = await Resolver.resolveLiveFlowTab(resolverDeps(), {});
            return { ok: true, result: { connectedTabs: 1, helloPorts: helloPorts.length, resolution: found.resolution } };
          }
          return { ok: false, error: `SCHEMA_INVALID: unknown kind ${(msg && msg.kind) || "none"}` };
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      })().then((resp) => {
        try {
          const TC = (typeof TraceContract !== "undefined" && TraceContract) || null;
          if (TC && resp && resp.ok === true && swSpanKind && swSpanJobId) {
            resp.trace = [TC.buildTraceSpan({
              source: "extension", kind: swSpanKind, jobId: swSpanJobId,
              tStart: swSpanT0, tEnd: Date.now(),
              traceId: swTraceCtx.traceId || undefined,
              parentSpanId: swTraceCtx.parentSpanId || null,
            })];
          }
        } catch (e) { void e; }
        sendResponse(resp);
      });
      return true;
    });
  }
})();
