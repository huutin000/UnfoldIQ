"use strict";
/* UNFOLDIQ Flow Companion — single source of truth for primary action
 * state machine (POST-v1D §31/§37). Internal state → user-facing status →
 * CTA → visual style. UI code must not duplicate this mapping.
 *
 * UI states: NO_JOB | CONNECTING | NEED_FLOW | NEED_CONFIG | PREPARING |
 * AWAITING_USER_APPROVAL | GENERATING | PROCESSING | READY |
 * NEED_ATTENTION | ERROR_RETRYABLE | BLOCKED | CANCELLED
 */
(function () {
  function strings() {
    if (typeof window !== "undefined" && window.FlowUIStrings) return window.FlowUIStrings;
    try {
      return require("./labels.vi.js");
    } catch {
      return null;
    }
  }

  function resolveUIState(state) {
    const t = strings() || {};
    switch (state) {
      case "NO_JOB":
        return { status: t.statusNeedConfig || "Cần cấu hình", statusTone: "warn", cta: t.ctaFindJob || "Tìm công việc", ctaEnabled: true, ctaMode: "find", stepper: [] };
      case "CONNECTING":
        return { status: t.statusConnecting || "Đang kết nối", statusTone: "busy", cta: t.ctaConnecting || "Đang kết nối…", ctaEnabled: false, ctaMode: "busy", stepper: ["prepare"] };
      case "NEED_FLOW":
        return { status: t.statusNeedFlow || "Cần mở Google Flow", statusTone: "warn", cta: t.ctaRetry || "Thử lại", ctaEnabled: true, ctaMode: "retry", stepper: ["prepare"] };
      case "NEED_CONFIG":
        return { status: t.statusNeedConfig || "Cần cấu hình", statusTone: "warn", cta: t.ctaOpenSettings || "Mở cài đặt", ctaEnabled: true, ctaMode: "settings", stepper: [] };
      case "PREPARING":
        return { status: t.statusPreparing || "Đang chuẩn bị", statusTone: "busy", cta: t.ctaPreparing || "Đang chuẩn bị…", ctaEnabled: false, ctaMode: "busy", stepper: ["prepare"] };
      case "NEED_ATTENTION":
        return { status: t.statusAttention || "Cần xử lý", statusTone: "bad", cta: t.ctaRetry || "Thử lại", ctaEnabled: true, ctaMode: "retry", stepper: ["prepare"] };
      case "AWAITING_USER_APPROVAL":
        return { status: t.statusAwaiting || "Chờ duyệt", statusTone: "busy", cta: t.ctaApproveCreate || "Duyệt & Tạo", ctaEnabled: true, ctaMode: "approve", stepper: ["prepare", "await"] };
      case "GENERATING":
        return { status: t.statusGenerating || "Đang tạo", statusTone: "busy", cta: t.ctaCreating || "Đang tạo…", ctaEnabled: false, ctaMode: "busy", stepper: ["prepare", "await", "create"] };
      case "PROCESSING":
        return { status: t.statusProcessing || "Đang xử lý", statusTone: "busy", cta: t.ctaProcessing || "Đang xử lý…", ctaEnabled: false, ctaMode: "busy", stepper: ["prepare", "await", "create"] };
      case "READY":
        return { status: t.statusDone || "Hoàn tất", statusTone: "ok", cta: t.ctaViewResult || "Xem kết quả", ctaEnabled: true, ctaMode: "result", stepper: ["prepare", "await", "create", "done"] };
      case "ERROR_RETRYABLE":
        return { status: t.statusError || "Có lỗi", statusTone: "bad", cta: t.ctaRetry || "Thử lại", ctaEnabled: true, ctaMode: "retry", stepper: ["prepare"] };
      case "BLOCKED":
        return { status: t.statusError || "Có lỗi", statusTone: "bad", cta: t.ctaViewIssue || "Xem vấn đề", ctaEnabled: true, ctaMode: "issue", stepper: ["prepare"] };
      case "CANCELLED":
        return { status: t.statusNeedConfig || "Cần cấu hình", statusTone: "warn", cta: t.ctaFindNewJob || "Tìm công việc mới", ctaEnabled: true, ctaMode: "find", stepper: [] };
      default:
        return { status: t.statusConnecting || "Đang kết nối", statusTone: "busy", cta: t.ctaConnecting || "Đang kết nối…", ctaEnabled: false, ctaMode: "busy", stepper: [] };
    }
  }

  /* Maps bridge job status → UI state (approval-gated; GENERATING and
   * beyond never auto-advance without observed evidence).
   * POST-v1E stall fix (§11): the map must not lie. PREPARED only reads
   * "Đang chuẩn bị" while a real preparation is active; a finished but
   * unready or failed preparation reads "Cần xử lý" (retryable). */
  function uiStateForJob(job, opts = {}) {
    if (!job) return opts.connected === false ? "NEED_FLOW" : "NO_JOB";
    const failed = opts.preparationFailed === true;
    switch (job.status) {
      case "AWAITING_USER_APPROVAL":
        if (failed) return "NEED_ATTENTION";
        if (opts.generationReady === false && opts.preparationActive === true) return "PREPARING";
        return "AWAITING_USER_APPROVAL";
      case "AWAITING_PROVIDER_ACCEPTANCE":
        // Submit issued, acceptance pending (hardening sweep): the user may
        // need to click Start — same human action as awaiting approval, but
        // the approval must NOT be re-recordable (bridge enforces it).
        return "AWAITING_USER_APPROVAL";
      case "PREPARED":
      case "VALIDATED":
        if (opts.preparationActive === true) return "PREPARING";
        if (opts.generationReady === true) return "AWAITING_USER_APPROVAL";
        if (failed) return "NEED_ATTENTION";
        return "NEED_ATTENTION";
      case "GENERATING":
        return "GENERATING";
      case "RESULT_DETECTED":
      case "DOWNLOADING":
      case "IMPORTED":
        return "PROCESSING";
      case "READY":
        return "READY";
      case "FAILED":
      case "RETRYABLE_ERROR":
        return "ERROR_RETRYABLE";
      case "CANCELLED":
      case "REJECTED_BY_USER":
        return "CANCELLED";
      case "MANUAL_ASSIST_REQUIRED":
      case "PROVIDER_SAFETY_REFUSED":
        return "BLOCKED";
      default:
        return "NEED_ATTENTION";
    }
  }

  const api = { resolveUIState, uiStateForJob };
  if (typeof window !== "undefined") window.FlowUIState = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
