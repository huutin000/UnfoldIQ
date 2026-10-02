"use strict";

/**
 * Flow Companion content-script runtime (POST-v1B live run).
 * Manifest load order: flow-page-adapter.js → content-commands.js → this file.
 * All three share the isolated-world global scope; this file only wires
 * messaging. Page access stays exclusively adapter-mediated (see FP15:
 * this file performs no direct page access calls).
 *
 * Protocol: opens a "flow-tab" port to the service worker, posts
 * CONTENT_HELLO, then answers routed commands and replies on the port.
 */
(function () {
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.connect) return;

  var EXT_VERSION = "unknown";
  try {
    EXT_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "unknown";
  } catch (e) {
    void e;
  }
  var FLOW_ORIGIN = "unknown";
  try {
    FLOW_ORIGIN = (typeof location !== "undefined" && location.origin) || "unknown";
  } catch (e) {
    void e;
  }

  function resolveAdapter() {
    try {
      if (typeof window !== "undefined" && window.FlowPageAdapter) return window.FlowPageAdapter;
    } catch (e) {
      void e;
    }
    return null;
  }

  function resolveDispatcher() {
    try {
      if (typeof dispatchContentCommand === "function") return dispatchContentCommand;
    } catch (e) {
      void e;
    }
    try {
      if (typeof window !== "undefined" && window.FlowContentCommands) return window.FlowContentCommands.dispatchContentCommand;
    } catch (e) {
      void e;
    }
    return null;
  }

  function resolveRoot() {
    try {
      if (typeof document !== "undefined") return document;
    } catch (e) {
      void e;
    }
    return null;
  }

  function boot() {
    var adapter = resolveAdapter();
    var dispatch = resolveDispatcher();
    var root = resolveRoot();
    if (!adapter || !dispatch || !root) {
      return { connected: false, error: "FLOW_PAGE_NOT_READY: adapter, dispatcher, or document unavailable" };
    }
    function answer(msg) {
      var ctx = { extensionVersion: EXT_VERSION, flowOrigin: FLOW_ORIGIN, bridgeReachable: null };
      return dispatch(adapter, root, msg, ctx);
    }
    // Canonical transport: direct messages (chrome.tabs.sendMessage from the
    // worker after resolveLiveFlowTab). Same dispatcher as the port path —
    // one tab identity, one command surface.
    if (chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        var done;
        try {
          done = answer(msg);
        } catch (err) {
          sendResponse({ ok: false, id: (msg && msg.id) || null, type: (msg && msg.type) || null, error: String((err && err.message) || err) });
          return undefined;
        }
        Promise.resolve(done).then(
          function (result) {
            sendResponse({ ok: true, id: (msg && msg.id) || null, type: (msg && msg.type) || null, result: result });
          },
          function (err) {
            sendResponse({ ok: false, id: (msg && msg.id) || null, type: (msg && msg.type) || null, error: String((err && err.message) || err) });
          }
        );
        return true;
      });
    }
    var port;
    try {
      port = chrome.runtime.connect({ name: "flow-tab" });
    } catch (e) {
      return { connected: false, error: String((e && e.message) || e) };
    }
    try {
      port.postMessage({
        type: "CONTENT_HELLO",
        adapterVersion: adapter.ADAPTER_VERSION || "unknown",
        extensionVersion: EXT_VERSION,
        flowOrigin: FLOW_ORIGIN,
      });
    } catch (e) {
      void e;
    }
    port.onMessage.addListener(function (msg) {
      var ctx = { extensionVersion: EXT_VERSION, flowOrigin: FLOW_ORIGIN, bridgeReachable: null };
      var done;
      try {
        done = dispatch(adapter, root, msg, ctx);
      } catch (err) {
        try {
          port.postMessage({ ok: false, id: (msg && msg.id) || null, type: (msg && msg.type) || null, error: String((err && err.message) || err) });
        } catch (e) {
          void e;
        }
        return;
      }
      Promise.resolve(done).then(
        function (result) {
          try {
            port.postMessage({ ok: true, id: (msg && msg.id) || null, type: (msg && msg.type) || null, result: result });
          } catch (e) {
            void e;
          }
        },
        function (err) {
          try {
            port.postMessage({ ok: false, id: (msg && msg.id) || null, type: (msg && msg.type) || null, error: String((err && err.message) || err) });
          } catch (e) {
            void e;
          }
        }
      );
    });
    var info = { connected: true, extensionVersion: EXT_VERSION, flowOrigin: FLOW_ORIGIN };
    try {
      if (typeof window !== "undefined") window.__UNFOLDIQ_FLOW_COMPANION__ = info;
    } catch (e) {
      void e;
    }
    return info;
  }

  try {
    boot();
  } catch (e) {
    void e;
  }
})();
