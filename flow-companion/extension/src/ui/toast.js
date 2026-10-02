"use strict";
/* UNFOLDIQ Flow Companion — toast host (POST-v1D).
 * Simplified copy from FlowUIStrings; start + success/error feedback per
 * async action; no duplicates; raw exceptions never shown as primary UI.
 */
(function () {
  function icons() {
    if (typeof window !== "undefined" && window.FlowIcons) return window.FlowIcons;
    return null;
  }

  function showToast(container, message, type = "info", timeoutMs = 4000) {
    if (!container || typeof document === "undefined") return null;
    const allowed = ["success", "info", "warning", "error"];
    const kind = allowed.includes(type) ? type : "info";
    // No duplicate notifications: drop identical visible toast.
    for (const child of container.children) {
      if (child.getAttribute && child.getAttribute("data-toast-msg") === message) return child;
    }
    // POST-v1E.2B: the persistent preparation-status element (stable key) is
    // never trimmed away by transient toasts — its lifetime belongs to the
    // preparation lifecycle, not to toast timing.
    let guard = 0;
    while (container.children.length >= 3 && guard++ < 10) {
      let victim = null;
      for (const child of container.children) {
        if (!(child.getAttribute && child.getAttribute("data-toast-key") === PREP_STATUS_KEY)) {
          victim = child;
          break;
        }
      }
      if (!victim) break;
      container.removeChild(victim);
    }
    const div = document.createElement("div");
    div.className = `toast ${kind}`;
    div.setAttribute("role", "status");
    div.setAttribute("data-toast-msg", message);
    const ic = icons();
    if (ic && ic.svg) {
      const wrap = document.createElement("span");
      wrap.setAttribute("aria-hidden", "true");
      wrap.innerHTML = ic.svg(kind === "success" ? "check" : kind === "error" ? "alert" : kind === "warning" ? "alert" : "info");
      const svg = wrap.firstChild;
      if (svg) div.appendChild(svg);
    }
    const span = document.createElement("span");
    span.textContent = message;
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Đóng thông báo");
    close.addEventListener("click", () => div.remove());
    div.appendChild(span);
    div.appendChild(close);
    container.appendChild(div);
    if (kind !== "error" && timeoutMs > 0) setTimeout(() => div.remove(), timeoutMs);
    return div;
  }

  /**
   * POST-v1E.2B P1 — preparation notification lifecycle. ONE persistent,
   * keyed ("auto-prepare-status") element owned by the preparation lifecycle:
   * begin() → persistent "Đang chuẩn bị…" with an attempt id; success/
   * failure replace it with the terminal outcome; a stale attempt id can
   * never touch the current attempt's notification. No auto-dismiss timer —
   * the lifetime follows the async operation. `createEl` is injectable so
   * the lifecycle is unit-testable without a DOM.
   */
  const PREP_STATUS_KEY = "auto-prepare-status";

  function createPreparationStatus(container, opts = {}) {
    const labels = opts.labels || {};
    const mkEl =
      opts.createEl ||
      (typeof document !== "undefined"
        ? (cls, text) => {
            const d = document.createElement("div");
            d.className = cls;
            const s = document.createElement("span");
            s.textContent = text;
            d.appendChild(s);
            return d;
          }
        : null);
    let currentEl = null;
    let currentAttempt = 0;
    function removeCurrent() {
      if (!currentEl) return;
      try {
        if (typeof currentEl.remove === "function") currentEl.remove();
        else if (container && typeof container.removeChild === "function") container.removeChild(currentEl);
      } catch (e) {
        void e;
      }
      currentEl = null;
    }
    function show(kind, text) {
      removeCurrent();
      if (!mkEl || !container) return null;
      const el = mkEl("div", text);
      el.className = `toast ${kind} persistent`;
      try {
        el.setAttribute("role", "status");
        el.setAttribute("data-toast-key", PREP_STATUS_KEY);
      } catch (e) {
        void e;
      }
      container.appendChild(el);
      currentEl = el;
      return el;
    }
    function owns(attemptId) {
      return attemptId === undefined || attemptId === currentAttempt;
    }
    return {
      key: PREP_STATUS_KEY,
      begin() {
        currentAttempt += 1;
        show("info", labels.preparing || "Đang chuẩn bị…");
        return currentAttempt;
      },
      isActive() {
        return currentEl !== null;
      },
      clear(attemptId) {
        if (!owns(attemptId)) return false;
        removeCurrent();
        return true;
      },
      success(attemptId) {
        if (!owns(attemptId)) return false;
        show("success", labels.done || "Đã chuẩn bị xong");
        return true;
      },
      failure(attemptId) {
        if (!owns(attemptId)) return false;
        show("error", labels.failed || "Không thể hoàn tất chuẩn bị");
        return true;
      },
    };
  }

  const api = { showToast, createPreparationStatus, PREP_STATUS_KEY };
  if (typeof window !== "undefined") window.FlowToast = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
