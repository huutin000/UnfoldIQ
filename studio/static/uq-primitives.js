/**
 * UnfoldIQ — UQ Shared Primitives (Phase 5)
 * Vanilla JS render helpers for the 7 canonical UI primitives.
 * No dependencies. Vietnamese-first strings. No raw-enum leaks
 * (callers pass already-mapped Vietnamese labels).
 *
 * Consumers: phase14_ui (export preflight, empty/error states),
 * uq-palette (empty state), virtual-list hosts (spacers via CSS).
 * app.js inline builders are intentionally retained (blast radius) —
 * see PHASE_05_IMPLEMENTATION_REPORT §12.
 */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // UQ empty state: title + message + optional action buttons HTML.
  function emptyState(title, message, actionsHtml) {
    return '<div class="overview-empty" role="status">' +
      "<h3>" + esc(title) + "</h3><p>" + esc(message) + "</p>" +
      (actionsHtml ? '<div class="empty-actions">' + actionsHtml + "</div>" : "") +
      "</div>";
  }

  // UQ error state with recovery action (retry JS expression).
  function errorState(message, retryJs) {
    return '<div class="overview-empty" role="alert">' +
      "<h3>Không tải được dữ liệu</h3><p>" + esc(message || "Lỗi không xác định") + "</p>" +
      (retryJs ? '<div class="empty-actions"><button class="btn btn-secondary btn-sm" onclick="' +
        esc(retryJs) + '">Thử lại</button></div>' : "") +
      "</div>";
  }

  // UQ status badge: pre-mapped Vietnamese label + tone class.
  function statusBadge(label, tone) {
    var t = tone === "ok" ? "status-ready" : tone === "bad" ? "status-blocked"
      : tone === "warn" ? "status-review" : "status-idle";
    return '<span class="ui-status-badge ' + t + '">' + esc(label) + "</span>";
  }

  // UQ-Preflight-Checklist row: label + state text + optional CTA button HTML.
  // Presentation only — business rules stay in backend/domain services.
  function checkRow(o) {
    o = o || {};
    var badge = statusBadge((o.ok ? "✓ " : "✕ ") + (o.stateLabel || ""), o.ok ? "ok" : "bad");
    return '<div class="uq-check-row" role="listitem">' +
      '<div class="uq-check-row-main"><div class="uq-check-row-title">' + esc(o.title || "") + "</div>" +
      '<div class="uq-check-row-sub">Trạng thái: ' + esc(o.stateLabel || "") + "</div></div>" +
      '<div class="uq-check-row-side">' + badge + (o.actionHtml || "") + "</div>" +
      "</div>";
  }

  window.UQ = {
    esc: esc,
    emptyState: emptyState,
    errorState: errorState,
    statusBadge: statusBadge,
    checkRow: checkRow,
  };
})();
