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
  const allowed = url.startsWith("chrome-extension://") || FLOW_ORIGIN_PREFIXES.some((p) => url.startsWith(p));
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
  module.exports = { validateSender, validateMessage, pollJobState, handleMessage, JOB_MESSAGE_TYPES, correlateDownload, classifyError, ERROR_CODES, FLOW_ORIGIN_PREFIXES, createRelayHub, recordLocalApproval, consumeLocalApproval };
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
  }
  const Resolver = (typeof TabResolver !== "undefined" && TabResolver) || null;
  // Port registry is informational ONLY (hello presence). Routing always
  // goes through the canonical resolver — never trust this map at action time.
  const helloPorts = [];
  const approvals = new Map();

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
      (async () => {
        try {
          validateSender(sender);
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
        try {
          if (!msg || msg.kind === "TAB_RELAY") {
            if (msg && msg.cmd && msg.cmd.type === "SUBMIT_GENERATE") {
              // POST-v1E §23: single-use approval bound to jobId+attempt and,
              // when presented, to the approval nonce + snapshot fingerprint.
              const ap = (msg.cmd && msg.cmd.approval) || {};
              consumeLocalApproval(approvals, msg.cmd.jobId, msg.cmd.attempt, { nonce: ap.nonce ?? null, fingerprint: (ap.snapshot && ap.snapshot.fingerprint) || ap.fingerprint || null });
              const relayed = await relayToLiveTab(msg.cmd, msg.timeoutMs || 60000);
              return { ok: true, result: relayed.result, resolution: relayed.resolution };
            }
            const relayed = await relayToLiveTab((msg && msg.cmd) || {}, (msg && msg.timeoutMs) || 60000);
            return { ok: true, result: relayed.result, resolution: relayed.resolution };
          }
          if (msg.kind === "APPROVE_RECORD") {
            return { ok: true, result: recordLocalApproval(approvals, msg.approval || {}) };
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
      })().then(sendResponse);
      return true;
    });
  }
})();
