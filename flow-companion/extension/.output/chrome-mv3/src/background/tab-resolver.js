"use strict";

/**
 * Flow Companion canonical live-tab resolver (POST-v1B live fix).
 * ONE source of truth for every live path (Check tab, Probe, Dry-run,
 * Generate, Result poll, Download): query current Chrome tabs by the exact
 * allowed Flow URL patterns, then accept a tab ONLY if its content script
 * answers a PING. In-memory port registries are hints at best — MV3 service
 * workers restart and wipe them, so action time always revalidates.
 *
 * Safe session metadata only (tabId, origin, lastHandshakeAt, extension
 * version). Never cookies, tokens, auth/session data, page content.
 */

const FLOW_TAB_URL_PATTERNS = [
  "https://flow.google.com/*",
  "https://flow.google/*",
  "https://labs.google/fx/*",
];

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function urlMatchesAllowlist(url) {
  if (typeof url !== "string") return false;
  return (
    url.startsWith("https://flow.google.com/") ||
    url === "https://flow.google.com" ||
    url.startsWith("https://flow.google/") ||
    url === "https://flow.google" ||
    url.startsWith("https://labs.google/fx/") ||
    url === "https://labs.google/fx"
  );
}

function isReceivingEndMissing(err) {
  const m = String((err && err.message) || err || "");
  return /receiving end does not exist/i.test(m);
}

function preferTabOrder(tabs) {
  const list = (tabs || []).filter((t) => t && typeof t.id === "number" && urlMatchesAllowlist(t.url));
  list.sort((a, b) => {
    const act = (b.active ? 1 : 0) - (a.active ? 1 : 0);
    if (act !== 0) return act;
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });
  return list;
}

/**
 * resolveLiveFlowTab(deps, opts) → resolution diagnostics + live tab.
 * deps: { tabsQuery(patterns), sendPing(tabId, msg), sessionGet(),
 *         sessionSet(obj), reinject(tabId), nowMs() } — injected so the
 * same logic runs in the MV3 worker (real chrome.*) and node tests (fakes).
 */
async function resolveLiveFlowTab(deps, opts = {}) {
  const { allowReinject = true } = opts;
  if (!deps || typeof deps.tabsQuery !== "function" || typeof deps.sendPing !== "function") {
    throw new Error("SCHEMA_INVALID: tabsQuery + sendPing required");
  }
  const now = typeof deps.nowMs === "function" ? deps.nowMs() : Date.now();
  const diag = {
    queryMatchedTabs: 0,
    selectedTabId: null,
    selectedOrigin: null,
    pingSuccess: false,
    source: null,
    lastError: null,
  };
  const ping = async (tabId) => {
    try {
      const res = await deps.sendPing(tabId, { type: "PING", id: `resolve-ping-${now}` });
      if (res && (res.ok === true || res.adapterVersion)) return { ok: true };
      return { ok: false, error: "PING_REJECTED" };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), receivingEndMissing: isReceivingEndMissing(e) };
    }
  };
  const reinjectOnce = async (tabId) => {
    if (!allowReinject || typeof deps.reinject !== "function") return { ok: false, error: "REINJECT_UNAVAILABLE" };
    try {
      await deps.reinject(tabId);
    } catch (e) {
      return { ok: false, error: `REINJECT_FAILED: ${String((e && e.message) || e)}` };
    }
    return ping(tabId);
  };
  const accept = async (tab, source) => {
    let r = await ping(tab.id);
    let finalSource = source;
    if (!r.ok && r.receivingEndMissing) {
      r = await reinjectOnce(tab.id);
      if (r.ok) finalSource = "REINJECTED";
    }
    if (!r.ok) {
      diag.lastError = r.error;
      return null;
    }
    diag.selectedTabId = tab.id;
    diag.selectedOrigin = originOf(tab.url);
    diag.pingSuccess = true;
    diag.source = finalSource;
    diag.lastError = null;
    if (typeof deps.sessionSet === "function") {
      try {
        await deps.sessionSet({ tabId: tab.id, origin: diag.selectedOrigin, lastHandshakeAt: new Date(now).toISOString(), source: finalSource });
      } catch {
        /* session metadata is best-effort */
      }
    }
    return { tabId: tab.id, origin: diag.selectedOrigin, resolution: { ...diag } };
  };

  // 1. Session hint first (fast path after warm restart), but NEVER trusted
  //    without a fresh ping.
  if (typeof deps.sessionGet === "function") {
    let hint = null;
    try {
      hint = await deps.sessionGet();
    } catch {
      hint = null;
    }
    if (hint && typeof hint.tabId === "number") {
      const tabs = await deps.tabsQuery(FLOW_TAB_URL_PATTERNS);
      const same = (tabs || []).find((t) => t && t.id === hint.tabId && urlMatchesAllowlist(t.url));
      if (same) {
        diag.queryMatchedTabs = preferTabOrder(tabs).length;
        const accepted = await accept(same, "SESSION_REVALIDATED");
        if (accepted) return accepted;
      }
    }
  }

  // 2. Full query + ping in preference order (canonical path).
  const tabs = await deps.tabsQuery(FLOW_TAB_URL_PATTERNS);
  const ordered = preferTabOrder(tabs);
  diag.queryMatchedTabs = ordered.length;
  if (ordered.length === 0) {
    diag.lastError = "FLOW_TAB_NOT_FOUND: no open tab matches the allowed Flow origins";
    throw new Error(diag.lastError);
  }
  for (const tab of ordered) {
    const accepted = await accept(tab, "QUERY");
    if (accepted) return accepted;
  }
  if (!diag.lastError) diag.lastError = "CONTENT_SCRIPT_NOT_INJECTED: Flow tab(s) open but no content script answered, even after re-inject";
  throw new Error(diag.lastError);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FLOW_TAB_URL_PATTERNS, originOf, urlMatchesAllowlist, isReceivingEndMissing, preferTabOrder, resolveLiveFlowTab };
}

// Browser namespace for the MV3 service worker (loaded via importScripts).
// `var` attaches to the worker global so service-worker.js sees TabResolver.
try {
  if (typeof importScripts === "function" || typeof window !== "undefined") {
    var TabResolver = { FLOW_TAB_URL_PATTERNS, originOf, urlMatchesAllowlist, isReceivingEndMissing, preferTabOrder, resolveLiveFlowTab };
    void TabResolver;
  }
} catch (e) {
  void e;
}
