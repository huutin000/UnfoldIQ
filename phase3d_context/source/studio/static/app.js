/**
 * UnfoldIQ TTS Studio — Professional Workstation Client Logic
 * Modular workspace routing, persistent audio transport, optimized batch list rendering
 */

document.addEventListener("DOMContentLoaded", () => {
  // ==============================================================================
  // 1. DOM ELEMENTS INVENTORY
  // ==============================================================================

  // Script Workspace Elements
  const scriptInput = document.getElementById("script-input");
  const charCountEl = document.getElementById("char-count");
  const wordCountEl = document.getElementById("word-count");
  const estDurationEl = document.getElementById("est-duration");
  const projectNameInput = document.getElementById("project-name-input");
  const slugPreviewEl = document.getElementById("slug-preview");
  const activeProjectNameEl = document.getElementById("active-project-name");
  const btnCloseProject = document.getElementById("btn-close-project");
  const voiceSelect = document.getElementById("voice-select");
  const languageSelect = document.getElementById("language-select");
  const speedSlider = document.getElementById("speed-slider");
  const speedValueEl = document.getElementById("speed-value");
  const chkMp3 = document.getElementById("chk-mp3");
  const btnGenerate = document.getElementById("btn-generate");
  const btnStop = document.getElementById("btn-stop");

  // Audio / Render Dashboard Elements
  const jobStatePill = document.getElementById("job-state-pill");
  const progressFill = document.getElementById("progress-fill");
  const progressPct = document.getElementById("progress-pct");
  const chunkMetric = document.getElementById("chunk-metric");
  const elapsedMetric = document.getElementById("elapsed-metric");
  const reuseMetricEl = document.getElementById("reuse-metric");
  const chunkSnippetBox = document.getElementById("chunk-snippet-box");
  const chunkSnippetText = document.getElementById("chunk-snippet-text");
  const errorAlert = document.getElementById("error-alert");
  const errorAlertText = document.getElementById("error-alert-text");
  const finalDurationText = document.getElementById("final-duration-text");
  const btnExportWav = document.getElementById("btn-export-wav");
  const btnExportMp3 = document.getElementById("btn-export-mp3");
  const insAudioStatus = document.getElementById("ins-audio-status");

  // Global Audio Transport Elements
  const audioPlayer = document.getElementById("audio-player");
  const btnGlobalPlay = document.getElementById("btn-global-play");
  const playerCurrentTime = document.getElementById("player-current-time");
  const playerTotalDuration = document.getElementById("player-total-duration");
  const playerScrubber = document.getElementById("player-scrubber");
  const playerVolumeSlider = document.getElementById("player-volume-slider");
  const btnPlayerMute = document.getElementById("btn-player-mute");
  const playerContextLabel = document.getElementById("player-context-label");

  // Timestamps Elements
  const tsStatusPill = document.getElementById("ts-status-pill");
  const tsModelBadge = document.getElementById("ts-model-badge");
  const tsDeviceBadge = document.getElementById("ts-device-badge");
  const tsCoverageBadge = document.getElementById("ts-coverage-badge");
  const tsCuesBadge = document.getElementById("ts-cues-badge");
  const tsProgressContainer = document.getElementById("ts-progress-container");
  const tsProgressFill = document.getElementById("ts-progress-fill");
  const tsProgressPct = document.getElementById("ts-progress-pct");
  const tsProgressMsg = document.getElementById("ts-progress-msg");
  const tsProgressElapsed = document.getElementById("ts-progress-elapsed");
  const btnGenerateTs = document.getElementById("btn-generate-ts");
  const btnCancelTs = document.getElementById("btn-cancel-ts");
  const btnDownloadSrt = document.getElementById("btn-download-srt");
  const btnDownloadTsJson = document.getElementById("btn-download-ts-json");
  const tsErrorAlert = document.getElementById("ts-error-alert");
  const tsErrorText = document.getElementById("ts-error-text");
  const tsPreviewCount = document.getElementById("ts-preview-count");
  const tsCuesList = document.getElementById("ts-cues-list");

  // Voice QA Elements (Phase 8.1)
  const qaStatusPill = document.getElementById("qa-status-pill");
  const valQaVerdict = document.getElementById("val-qa-verdict");
  const subQaVerdict = document.getElementById("sub-qa-verdict");
  const cardQaVerdict = document.getElementById("card-qa-verdict");
  const valQaMatch = document.getElementById("val-qa-match");
  const subQaWer = document.getElementById("sub-qa-wer");
  const valQaWpm = document.getElementById("val-qa-wpm");
  const subQaWpm = document.getElementById("sub-qa-wpm");
  const valQaIssuesCount = document.getElementById("val-qa-issues-count");
  const subQaBreakdown = document.getElementById("sub-qa-breakdown");
  const qaProgressContainer = document.getElementById("qa-progress-container");
  const qaProgressMessage = document.getElementById("qa-progress-message");
  const qaProgressPercent = document.getElementById("qa-progress-percent");
  const qaProgressBar = document.getElementById("qa-progress-bar");
  const qaIssuesList = document.getElementById("qa-issues-list");
  const qaSelectedDetail = document.getElementById("qa-selected-detail");
  const btnRunVoiceQa = document.getElementById("btn-run-voice-qa");
  const btnCancelVoiceQa = document.getElementById("btn-cancel-voice-qa");
  const btnForceVoiceQa = document.getElementById("btn-force-voice-qa");
  const btnGotoTimestamp = document.getElementById("btn-goto-timestamp");
  const insQaStatus = document.getElementById("ins-qa-status");
  const insQaMatch = document.getElementById("ins-qa-match");
  const insQaWer = document.getElementById("ins-qa-wer");
  const insQaWpm = document.getElementById("ins-qa-wpm");
  const insQaIssues = document.getElementById("ins-qa-issues");
  const tsQaGateWarning = document.getElementById("ts-qa-gate-warning");
  const tsQaGateTitle = document.getElementById("ts-qa-gate-title");
  const tsQaGateMsg = document.getElementById("ts-qa-gate-msg");
  const btnForceTs = document.getElementById("btn-force-ts");

  // Scene Planner Elements
  const spStatusPill = document.getElementById("sp-status-pill");
  const spCountBadge = document.getElementById("sp-count-badge");
  const spCoverageBadge = document.getElementById("sp-coverage-badge");
  const btnGenerateScenes = document.getElementById("btn-generate-scenes");
  const btnRefreshScenes = document.getElementById("btn-refresh-scenes");
  const btnExportScenesJson = document.getElementById("btn-export-scenes-json");
  const btnExportScenesMd = document.getElementById("btn-export-scenes-md");
  const spStaleAlert = document.getElementById("sp-stale-alert");
  const spStaleText = document.getElementById("sp-stale-text");
  const spErrorAlert = document.getElementById("sp-error-alert");
  const spErrorText = document.getElementById("sp-error-text");
  const spMetaDuration = document.getElementById("sp-meta-duration");
  const spTimelineList = document.getElementById("sp-timeline-list");
  const spRowsContainer = document.getElementById("sp-rows-container");
  const spSelectedDetail = document.getElementById("sp-selected-detail");
  const spSearchInput = document.getElementById("sp-search-input");
  const spFilterCategory = document.getElementById("sp-filter-category");
  const spRowCountBadge = document.getElementById("sp-row-count-badge");

  // Scene Edit Modal Elements
  const spEditModal = document.getElementById("sp-edit-modal");
  const spModalTitle = document.getElementById("sp-modal-title");
  const spModalCloseBtn = document.getElementById("sp-modal-close-btn");
  const spModalCancelBtn = document.getElementById("sp-modal-cancel-btn");
  const spModalSaveBtn = document.getElementById("sp-modal-save-btn");
  const spEditCategory = document.getElementById("sp-edit-category");
  const spEditEvidence = document.getElementById("sp-edit-evidence");
  const spEditShotType = document.getElementById("sp-edit-shot-type");
  const spEditCameraMotion = document.getElementById("sp-edit-camera-motion");
  const spEditContinuity = document.getElementById("sp-edit-continuity");
  const spEditSummary = document.getElementById("sp-edit-summary");
  const spEditPrompt = document.getElementById("sp-edit-prompt");
  const spEditNegativePrompt = document.getElementById("sp-edit-negative-prompt");

  // Veo Prompt Generator Elements
  const veoCountBadge = document.getElementById("veo-count-badge");
  const veoCoverageBadge = document.getElementById("veo-coverage-badge");
  const veoStatusPill = document.getElementById("veo-status-pill");
  const btnGenerateVeo = document.getElementById("btn-generate-veo");
  const btnRegenerateAllVeo = document.getElementById("btn-regenerate-all-veo");
  const btnRefreshVeo = document.getElementById("btn-refresh-veo");
  const btnExportVeoJson = document.getElementById("btn-export-veo-json");
  const btnExportVeoMd = document.getElementById("btn-export-veo-md");
  const veoStaleAlert = document.getElementById("veo-stale-alert");
  const veoStaleText = document.getElementById("veo-stale-text");
  const veoErrorAlert = document.getElementById("veo-error-alert");
  const veoErrorText = document.getElementById("veo-error-text");
  const veoMetaDuration = document.getElementById("veo-meta-duration");
  const veoTimelineList = document.getElementById("veo-timeline-list");
  const veoRowsContainer = document.getElementById("veo-rows-container");
  const veoSelectedDetail = document.getElementById("veo-selected-detail");
  const veoSearchInput = document.getElementById("veo-search-input");
  const veoFilterTone = document.getElementById("veo-filter-tone");
  const veoRowCountBadge = document.getElementById("veo-row-count-badge");

  // Production Export Elements (Phase 11 — contextual to Veo workspace)
  const prodStatusBadge = document.getElementById("prod-status-badge");
  const prodSceneCount = document.getElementById("prod-scene-count");
  const prodShotCount = document.getElementById("prod-shot-count");
  const prodBlockerCount = document.getElementById("prod-blocker-count");
  const prodReadinessList = document.getElementById("prod-readiness-list");
  const prodBlockersList = document.getElementById("prod-blockers-list");
  const btnProductionExport = document.getElementById("btn-production-export");
  const prodResult = document.getElementById("prod-result");
  const prodResultActions = document.getElementById("prod-result-actions");
  const btnProductionOpenFolder = document.getElementById("btn-production-open-folder");
  const btnProductionCopyPath = document.getElementById("btn-production-copy-path");
  const prodHistoryList = document.getElementById("prod-history-list");

  // Veo Modal Elements
  const veoEditModal = document.getElementById("veo-edit-modal");
  const veoModalTitle = document.getElementById("veo-modal-title");
  const veoModalCloseBtn = document.getElementById("veo-modal-close-btn");
  const veoModalCancelBtn = document.getElementById("veo-modal-cancel-btn");
  const veoModalSaveBtn = document.getElementById("veo-modal-save-btn");
  const veoEditShotId = document.getElementById("veo-edit-shot-id");
  const veoEditFraming = document.getElementById("veo-edit-framing");
  const veoEditCameraMotion = document.getElementById("veo-edit-camera-motion");
  const veoEditShotType = document.getElementById("veo-edit-shot-type");
  const veoEditAspectRatio = document.getElementById("veo-edit-aspect-ratio");
  const veoEditSubjectAction = document.getElementById("veo-edit-subject-action");
  const veoEditEnvironmentalAction = document.getElementById("veo-edit-environmental-action");
  const veoEditLighting = document.getElementById("veo-edit-lighting");
  const veoEditContinuityAnchor = document.getElementById("veo-edit-continuity-anchor");
  const veoEditPrompt = document.getElementById("veo-edit-prompt");
  const veoEditNegativePrompt = document.getElementById("veo-edit-negative-prompt");

  // Projects & Pronunciation Elements
  const projectsList = document.getElementById("projects-list");
  const btnRefreshHistory = document.getElementById("btn-refresh-history");
  const pronCountBadge = document.getElementById("pron-count-badge");
  const pronSearchInput = document.getElementById("pron-search-input");
  const btnToggleAddPron = document.getElementById("btn-toggle-add-pron");
  const pronFormContainer = document.getElementById("pron-form-container");
  const pronOrigInput = document.getElementById("pron-orig-input");
  const pronSpokenInput = document.getElementById("pron-spoken-input");
  const pronEnabledInput = document.getElementById("pron-enabled-input");
  const btnSavePron = document.getElementById("btn-save-pron");
  const btnCancelPron = document.getElementById("btn-cancel-pron");
  const btnTestFormAudio = document.getElementById("btn-test-form-audio");
  const pronFormError = document.getElementById("pron-form-error");
  const pronFormErrorText = document.getElementById("pron-form-error-text");
  const pronTableBody = document.getElementById("pron-table-body");
  const pronAudioPlayer = document.getElementById("pron-audio-player");

  // App Shell Elements
  const statusBadge = document.getElementById("service-status-badge");
  const statusText = document.getElementById("service-status-text");
  const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
  const btnToggleInspector = document.getElementById("btn-toggle-inspector");
  const pipelineSidebar = document.getElementById("pipeline-sidebar");
  const workspaceInspector = document.getElementById("workspace-inspector");
  const btnOpenSettings = document.getElementById("btn-open-settings");
  const btnOpenTour = document.getElementById("btn-open-tour");
  const workflowStepper = document.getElementById("workflow-stepper");

  // Confirm Modal Elements
  const confirmModal = document.getElementById("confirm-dialog-modal");
  const confirmModalTitle = document.getElementById("confirm-modal-title");
  const confirmModalMsg = document.getElementById("confirm-modal-message");
  const confirmBtnCancel = document.getElementById("confirm-btn-cancel");
  const confirmBtnConfirm = document.getElementById("confirm-btn-confirm");
  const confirmModalCloseBtn = document.getElementById("confirm-modal-close-btn");

  // Tour Elements
  const tourOverlay = document.getElementById("onboarding-tour-overlay");
  const tourSpotlight = document.getElementById("tour-spotlight");
  const tourCard = document.getElementById("tour-card");
  const tourStepBadge = document.getElementById("tour-step-badge");
  const tourBtnSkip = document.getElementById("tour-btn-skip");
  const tourCardTitle = document.getElementById("tour-card-title");
  const tourCardBody = document.getElementById("tour-card-body");
  const tourBtnPrev = document.getElementById("tour-btn-prev");
  const tourBtnNext = document.getElementById("tour-btn-next");

  // Contextual Help Elements
  const helpModal = document.getElementById("contextual-help-modal");
  const helpModalTitle = document.getElementById("help-modal-title");
  const helpModalCloseBtn = document.getElementById("help-modal-close-btn");
  const helpModalBody = document.getElementById("help-modal-body");
  const helpModalActionBtn = document.getElementById("help-modal-action-btn");

  // ==============================================================================
  // 2. STATE MANAGEMENT & UTILITIES
  // ==============================================================================
  let activeWorkspaceId = "script";
  let currentJobId = null;
  let currentProjectDir = null;
  let activeEventSource = null;
  let dictionaryEntries = [];
  let editingEntryId = null;
  let projectScenes = [];
  let editingSceneId = null;
  let projectVeoShots = [];
  let editingVeoShotId = null;
  let tsPollInterval = null;
  let statsDebounceTimer = null;
  let isSeeking = false;

  // Dependency & Invalidation State
  let tsOutdated = false;
  let scenesOutdated = false;
  let veoOutdated = false;
  // P0.2: scene ids whose Veo shots are outdated (empty = all / whole dataset).
  let veoOutdatedScenes = [];
  let projectCues = [];

  // Voice QA State (Phase 8.1)
  let voiceQAData = null;
  let voiceQAPollTimer = null;
  let selectedIssueFingerprint = null;
  let voiceQAFilter = "all";

  // Production Export State (Phase 11)
  let productionStatus = null;
  let productionExporting = false;
  let lastExportPath = null;

  // Modal & Tour State
  let confirmCallback = null;
  let lastFocusedElement = null;
  let currentTourIndex = 0;

  // Master-Detail State & Lightweight Rendering Cache
  let selectedSceneId = null;
  let spSearchQuery = "";
  let spFilterCategoryVal = "all";
  let spScrollTop = 0;

  let selectedShotId = null;
  let veoSearchQuery = "";
  let veoFilterToneVal = "all";
  let veoScrollTop = 0;

  // Make currentProjectDir accessible globally for test hooks
  window.currentProjectDir = currentProjectDir;

  // Debounce utility
  function debounce(fn, delay = 100) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Focus Trapping & Accessibility Utilities (WCAG AA Compliance)
  let activeFocusTrapCleanup = null;

  function trapFocus(modalEl) {
    if (activeFocusTrapCleanup) {
      activeFocusTrapCleanup();
      activeFocusTrapCleanup = null;
    }
    if (!modalEl) return;
    const focusableSelectors = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = Array.from(modalEl.querySelectorAll(focusableSelectors));
    if (focusableElements.length === 0) return;

    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    // Focus first interactive control
    setTimeout(() => firstEl.focus(), 50);

    function handleTabTrap(e) {
      if (e.key === "Tab") {
        if (e.shiftKey) {
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      } else if (e.key === "Escape") {
        if (modalEl === spEditModal) closeEditSceneModal();
        else if (modalEl === veoEditModal) closeEditVeoModal();
        else if (modalEl === confirmModal) closeConfirmDialog();
        else if (modalEl === helpModal) closeModuleHelp();
      }
    }

    modalEl.addEventListener("keydown", handleTabTrap);
    activeFocusTrapCleanup = () => modalEl.removeEventListener("keydown", handleTabTrap);
  }

  function releaseActiveFocus() {
    if (activeFocusTrapCleanup) {
      activeFocusTrapCleanup();
      activeFocusTrapCleanup = null;
    }
  }

  // P1 (§8 FINAL-GAPS): single modal helper — focus vào, trap Tab, body scroll
  // lock, restore focus khi đóng (kể cả khi trigger bị re-render → fallback).
  let uqOpenModals = [];
  function uqLockBody() {
    try {
      document.body.style.overflow = uqOpenModals.length ? "hidden" : "";
    } catch (e) {}
  }
  function uqModalOpen(modalEl, trigger) {
    if (!modalEl) return;
    if (trigger === undefined) trigger = document.activeElement;
    if (!uqOpenModals.includes(modalEl)) {
      uqOpenModals.push({ el: modalEl, trigger: trigger });
    }
    modalEl.style.display = "flex";
    modalEl.classList.add("open");
    uqLockBody();
    trapFocus(modalEl);
  }
  function uqModalClose(modalEl) {
    if (!modalEl) return;
    const idx = uqOpenModals.findIndex(m => m.el === modalEl);
    const rec = idx >= 0 ? uqOpenModals[idx] : null;
    if (idx >= 0) uqOpenModals.splice(idx, 1);
    modalEl.style.display = "none";
    modalEl.classList.remove("open");
    uqLockBody();
    releaseActiveFocus();
    const t = rec && rec.trigger;
    try {
      if (t && t.isConnected && typeof t.focus === "function") t.focus();
      else {
        const fb = document.querySelector("#btn-open-tour, .nav-item, .stepper-item");
        if (fb && typeof fb.focus === "function") fb.focus();
      }
    } catch (e) {}
  }
  window.UQModal = { open: uqModalOpen, close: uqModalClose };

  // HTML Escape utility
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  window.escapeHtml = escapeHtml;

  // Toast Notification System (replaces native alert) — with dedup (§6):
  // identical (message+type) within 4s updates the existing toast instead of stacking.
  let lastToastKey = "";
  let lastToastAt = 0;
  function showNotification(message, type = "info") {
    const key = `${type}::${message}`;
    const now = Date.now();
    if (key === lastToastKey && now - lastToastAt < 4000) return;
    lastToastKey = key;
    lastToastAt = now;
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast-item toast-${type}`;
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
      <span class="toast-message">${escapeHtml(message)}</span>
      <button type="button" class="toast-close" aria-label="Đóng">&times;</button>
    `;
    container.appendChild(toast);
    // Cap stacked toasts: drop oldest beyond 4 so one root cause never floods the screen.
    while (container.children.length > 4) container.firstChild.remove();

    const removeToast = () => {
      toast.classList.add("toast-fade-out");
      setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector(".toast-close").addEventListener("click", removeToast);
    setTimeout(removeToast, 4000);
  }
  window.showNotification = showNotification;

  // Reusable Confirmation Dialog Modal (replaces native confirm)
  // Supports chained confirms: a new showConfirmDialog inside onConfirm
  // keeps the modal open for the inner dialog (generation token).
  let confirmGeneration = 0;
  function showConfirmDialog({
    title = "Xác nhận",
    message = "Bạn có chắc chắn muốn thực hiện hành động này?",
    confirmText = "Xác nhận",
    cancelText = "Hủy",
    variant = "danger",
    onConfirm = null
  }) {
    if (!confirmModal || !confirmModalTitle || !confirmModalMsg || !confirmBtnCancel || !confirmBtnConfirm) {
      if (onConfirm) onConfirm();
      return;
    }

    lastFocusedElement = document.activeElement;
    confirmModalTitle.textContent = title;
    confirmModalMsg.textContent = message;
    confirmBtnConfirm.textContent = confirmText;
    confirmBtnCancel.textContent = cancelText;

    confirmBtnConfirm.disabled = false;
    confirmBtnCancel.disabled = false;

    // Set variant classes
    confirmBtnConfirm.className = "btn";
    if (variant === "danger") {
      confirmBtnConfirm.classList.add("btn-danger");
    } else if (variant === "warning") {
      confirmBtnConfirm.classList.add("btn-warning");
    } else {
      confirmBtnConfirm.classList.add("btn-primary");
    }

    confirmCallback = onConfirm;
    confirmGeneration++;
    uqModalOpen(confirmModal);

    setTimeout(() => {
      if (confirmBtnCancel) confirmBtnCancel.focus();
    }, 60);
  }
  window.showConfirmDialog = showConfirmDialog;

  function closeConfirmDialog() {
    uqModalClose(confirmModal);
    confirmCallback = null;
  }
  window.closeConfirmDialog = closeConfirmDialog;

  if (confirmBtnCancel) confirmBtnCancel.addEventListener("click", closeConfirmDialog);
  if (confirmModalCloseBtn) confirmModalCloseBtn.addEventListener("click", closeConfirmDialog);
  if (confirmModal) {
    confirmModal.addEventListener("click", (e) => {
      if (e.target === confirmModal) closeConfirmDialog();
    });
  }

  if (confirmBtnConfirm) {
    confirmBtnConfirm.addEventListener("click", async () => {
      if (confirmCallback) {
        const cb = confirmCallback;
        const gen = confirmGeneration;
        confirmBtnConfirm.disabled = true;
        confirmBtnCancel.disabled = true;
        try {
          await cb();
        } catch (err) {
          console.error("Error executing confirm action:", err);
          showNotification(`Lỗi thao tác: ${err.message}`, "error");
        } finally {
          if (gen === confirmGeneration) {
            closeConfirmDialog();
          } else {
            // A chained dialog took over; keep it interactive.
            confirmBtnConfirm.disabled = false;
            confirmBtnCancel.disabled = false;
          }
        }
      } else {
        closeConfirmDialog();
      }
    });
  }

  // Pipeline Dependency & Invalidation Management
  // P1 (§10): diagnostic một lần cho critical target thiếu — không silent-fail.
  const uqMissingWarned = new Set();
  function uqRequireEl(id, critical) {
    const el = document.getElementById(id);
    if (!el && critical && !uqMissingWarned.has(id)) {
      uqMissingWarned.add(id);
      if (window.console && console.warn) console.warn("[UQ] thiếu control production-critical:", id);
    }
    return el;
  }

  function updateDependencyState() {
    const hasScript = Boolean(scriptInput && scriptInput.value.trim().length > 0);
    const hasAudio = Boolean(currentProjectDir && (audioPlayer.src || (finalDurationText && finalDurationText.textContent !== "--")));
    const hasTs = Boolean(currentProjectDir && projectCues && projectCues.length > 0);
    const hasScenes = Boolean(currentProjectDir && projectScenes && projectScenes.length > 0);
    const hasVeo = Boolean(currentProjectDir && projectVeoShots && projectVeoShots.length > 0);

    const sScript = uqRequireEl("step-status-script", true);
    const sAudio = uqRequireEl("step-status-audio", true);
    const sQa = uqRequireEl("step-status-voice-qa", true);
    const badgeStepQa = uqRequireEl("badge-step-voice-qa", true);
    const sTs = uqRequireEl("step-status-timestamp", true);
    const sScenes = uqRequireEl("step-status-scenes", true);
    const sVeo = uqRequireEl("step-status-veo", true);

    if (sScript) {
      sScript.textContent = hasScript ? "✓" : "●";
      sScript.className = `step-status-icon ${hasScript ? "status-complete" : ""}`;
    }
    if (sAudio) {
      sAudio.textContent = hasAudio ? "✓" : (btnGenerate && btnGenerate.disabled && btnStop && !btnStop.disabled ? "◐" : "○");
      sAudio.className = `step-status-icon ${hasAudio ? "status-complete" : ""}`;
    }
    if (sQa) {
      if (voiceQAData && voiceQAData.is_stale) {
        sQa.textContent = "⚠";
        sQa.className = "step-status-icon status-outdated";
      } else if (voiceQAData && voiceQAData.status === "pass") {
        sQa.textContent = "✓";
        sQa.className = "step-status-icon status-complete";
      } else if (voiceQAData && voiceQAData.status === "review") {
        sQa.textContent = "!";
        sQa.className = "step-status-icon";
      } else if (voiceQAData && voiceQAData.status === "fail") {
        sQa.textContent = "✕";
        sQa.className = "step-status-icon";
      } else {
        sQa.textContent = "○";
        sQa.className = "step-status-icon";
      }
    }
    if (badgeStepQa) {
      if (voiceQAData && voiceQAData.is_stale) {
        badgeStepQa.textContent = "⚠";
        badgeStepQa.style.color = "var(--text-muted)";
      } else if (voiceQAData && voiceQAData.status === "pass") {
        badgeStepQa.textContent = "✓";
        badgeStepQa.style.color = "var(--success)";
      } else if (voiceQAData && voiceQAData.status === "review") {
        badgeStepQa.textContent = "!";
        badgeStepQa.style.color = "var(--warning)";
      } else if (voiceQAData && voiceQAData.status === "fail") {
        badgeStepQa.textContent = "✕";
        badgeStepQa.style.color = "var(--danger)";
      } else {
        badgeStepQa.textContent = "○";
        badgeStepQa.style.color = "";
      }
    }
    if (sTs) {
      if (tsOutdated) {
        sTs.textContent = "⚠";
        sTs.className = "step-status-icon status-outdated";
      } else if (hasTs) {
        sTs.textContent = "✓";
        sTs.className = "step-status-icon status-complete";
      } else {
        sTs.textContent = "○";
        sTs.className = "step-status-icon";
      }
    }
    if (sScenes) {
      if (scenesOutdated) {
        sScenes.textContent = "⚠";
        sScenes.className = "step-status-icon status-outdated";
      } else if (hasScenes) {
        sScenes.textContent = "✓";
        sScenes.className = "step-status-icon status-complete";
      } else {
        sScenes.textContent = "○";
        sScenes.className = "step-status-icon";
      }
    }
    if (sVeo) {
      if (veoOutdated) {
        sVeo.textContent = "⚠";
        sVeo.className = "step-status-icon status-outdated";
      } else if (hasVeo) {
        sVeo.textContent = "✓";
        sVeo.className = "step-status-icon status-complete";
      } else {
        sVeo.textContent = "○";
        sVeo.className = "step-status-icon";
      }
    }

    if (spStaleAlert) {
      spStaleAlert.style.display = scenesOutdated ? "flex" : "none";
    }
    if (veoStaleAlert) {
      veoStaleAlert.style.display = veoOutdated ? "flex" : "none";
    }
    renderProjectHealth(hasScript, hasAudio, hasTs, hasScenes, hasVeo);
  }
  window.updateDependencyState = updateDependencyState;

  // P1.4: consolidated Project Health panel (lightweight, in-memory only —
  // no extra hydration; runs on every dependency-state refresh).
  function renderProjectHealth(hasScript, hasAudio, hasTs, hasScenes, hasVeo) {
    const body = document.getElementById("project-health-body");
    if (!body) return;
    if (!currentProjectDir) {
      body.textContent = "Chưa mở dự án.";
      return;
    }
    const st = (ok, label) => ok ? label : "TRỐNG";
    const healthVi = { VALID: "Hợp lệ", OUTDATED: "Cần đồng bộ", PARTIALLY_OUTDATED: "Một phần cần đồng bộ" };
    const hv = (v) => healthVi[v] || v;
    const qa = voiceQAData
      ? (voiceQAData.is_stale ? "OUTDATED"
        : (voiceQAData.status || "REVIEW").toUpperCase())
      : "TRỐNG";
    const qaVi = { FAIL: "Lỗi", REVIEW: "Cần xem xét", PASS: "Đạt", OUTDATED: "Cần đồng bộ", TRỐNG: "TRỐNG" };
    const ts = !hasTs ? "TRỐNG" : (tsOutdated ? "OUTDATED" : "VALID");
    const sp = !hasScenes ? "TRỐNG" : (scenesOutdated ? "OUTDATED" : "VALID");
    const veo = !hasVeo ? "TRỐNG"
      : (veoOutdated ? (veoOutdatedScenes.length > 0 ? "PARTIALLY_OUTDATED" : "OUTDATED") : "VALID");

    // Metrics from loaded data (strict equality duplicate heuristic).
    let gap = 0, ov = 0, dup = 0, badParent = 0, covered = 0;
    const TOL = 0.005;
    const sceneIds = new Set((projectScenes || []).map(s => s.scene_id));
    const withShots = new Set();
    const byScene = {};
    (projectVeoShots || []).forEach(s => {
      const pid = s.parentSceneId || s.parent_scene_id || s.scene_id;
      if (!sceneIds.has(pid)) { badParent++; return; }
      withShots.add(pid);
      (byScene[pid] = byScene[pid] || []).push(s);
    });
    covered = withShots.size;
    Object.values(byScene).forEach(ch => {
      ch.sort((a, b) => a.start - b.start);
      for (let i = 0; i < ch.length; i++) {
        if (!(ch[i].end > ch[i].start)) { gap += 1; continue; }
        if (i > 0) {
          const d = ch[i].start - ch[i - 1].end;
          if (d > TOL) gap += d; else if (d < -TOL) ov += -d;
          const a = ch[i - 1], b = ch[i];
          if ((a.shotPurpose || a.shot_purpose) === (b.shotPurpose || b.shot_purpose) &&
              (a.subject_action || "") === (b.subject_action || "") &&
              (a.camera_framing || "") === (b.camera_framing || "") &&
              (a.camera_motion || "") === (b.camera_motion || "")) dup++;
        }
      }
    });
    const sceneCov = (projectScenes || []).length
      ? Math.round(covered / projectScenes.length * 100) : 0;

    const narrVi = { READY: "Sẵn sàng", EMPTY: "Trống", OUTDATED: "Cần đồng bộ", ERROR: "Lỗi", REVIEW: "Cần xem xét" };
    const rows = [
      ["Kịch bản", hv(st(hasScript, "VALID"))],
      ["Diễn cảm", narrVi[String(narrationHealth || "").toUpperCase()] || narrationHealth],
      ["Âm thanh", hv(st(hasAudio, "VALID"))],
      ["Kiểm âm", qaVi[qa] || qa],
      ["Mốc thời gian", hv(ts)],
      ["Kế hoạch cảnh", hv(sp)],
      ["Liên tục hình ảnh", uqStatusVi(visualContinuityStatus || "NOT GENERATED")],
      ["Prompt Veo", hv(veo)],
      ["Độ phủ cảnh", sceneCov + "%"],
      ["Độ phủ cảnh quay", hasVeo ? "100%" : "—"],
      ["Cảnh quay trùng lặp", String(dup)],
      ["Ánh xạ cha không hợp lệ", String(badParent)],
      ["Khoảng trống timeline", gap.toFixed(3) + "s"],
      ["Chồng lấn timeline", ov.toFixed(3) + "s"],
    ];
    const gate = hasScript && hasAudio && hasTs && hasScenes && hasVeo &&
      qa !== "FAIL" && !tsOutdated && !scenesOutdated && !veoOutdated &&
      visualContinuityStatus !== "ERROR" && !visualContinuityIssues.some(i => i.severity === "ERROR") &&
      sceneCov === 100 && dup === 0 && badParent === 0 && gap <= TOL && ov <= TOL;
    body.innerHTML = rows.map(([k, v]) =>
      `<div class="veo-action-row"><span class="veo-action-label">${escapeHtml(k)}:</span>` +
      `<span class="veo-action-val">${escapeHtml(v)}</span></div>`).join("") +
      `<div class="veo-action-row"><span class="veo-action-label">Gate:</span>` +
      `<span class="veo-action-val">${gate ? "SẴN SÀNG SẢN XUẤT HÌNH ẢNH" : "CHƯA SẴN SÀNG"}</span></div>`;
  }

  // P0.1: canonical script of the opened project ("") when blank.
  // Editor content is compared against this to detect unsaved typing.
  let openedScriptText = "";

  function isScriptDirty() {
    if (!scriptInput) return false;
    return (scriptInput.value || "") !== openedScriptText;
  }

  function hydrateScriptEditor(canonicalText) {
    openedScriptText = canonicalText || "";
    if (scriptInput) {
      scriptInput.value = openedScriptText;
      updateTextStats();
    }
  }

  // Returns true if the caller may proceed (clean, or user confirmed discard).
  function confirmDiscardScriptIfDirty(actionLabel, onProceed) {
    if (!isScriptDirty()) {
      onProceed();
      return;
    }
    showConfirmDialog({
      variant: "warning",
      title: "Bỏ thay đổi script chưa lưu?",
      message: `Script trên editor có thay đổi chưa được tạo thành audio. ${actionLabel} sẽ xóa nội dung đang nhập. Bạn có muốn tiếp tục?`,
      confirmText: "Bỏ thay đổi",
      cancelText: "Hủy",
      onConfirm: () => {
        onProceed();
      }
    });
  }

  // Gate E: Navigation & Window Safety — warn before accidental tab close/reload if script is dirty
  window.addEventListener("beforeunload", function (e) {
    if (typeof isScriptDirty === "function" && isScriptDirty()) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  });

  // P0.2: realtime dependency reconciliation (shared by open + regen flows).
  function refreshDependencyStatus(dirName) {
    if (!dirName) return;
    fetch(`/api/projects/${encodeURIComponent(dirName)}/status`)
      .then(res => res.ok ? res.json() : null)
      .then(statusData => {
        if (!statusData || currentProjectDir !== dirName) return;
        tsOutdated = (statusData.timestamp === "OUTDATED");
        scenesOutdated = (statusData.scenePlan === "OUTDATED");
        veoOutdated = (statusData.veo === "STALE" || statusData.veo === "OUTDATED");
        veoOutdatedScenes = (statusData.veoPartial && Array.isArray(statusData.veoOutdatedScenes))
          ? statusData.veoOutdatedScenes : [];
        updateDependencyState();
        updateVeoPartialAlert();
        loadProductionStatus(dirName);
      })
      .catch(err => console.warn("Failed to fetch dependency status:", err));
  }

  // P0.2: "N Shot cần tạo lại / M Shot hợp lệ" for partial invalidation.
  function updateVeoPartialAlert() {
    if (!veoStaleAlert) return;
    if (veoOutdated && veoOutdatedScenes.length > 0 && projectVeoShots.length > 0) {
      const staleSet = new Set(veoOutdatedScenes);
      const staleCount = projectVeoShots.filter(
        s => staleSet.has(s.parentSceneId || s.parent_scene_id || s.scene_id)).length;
      const validCount = projectVeoShots.length - staleCount;
      veoStaleAlert.style.display = "flex";
      if (veoStaleText) veoStaleText.textContent =
        `⚠ ${staleCount} cảnh quay cần tạo lại (Cảnh ${veoOutdatedScenes.join(", ")}). ` +
        `${validCount} / ${projectVeoShots.length} Shot hợp lệ.`;
    }
  }

  function resetWorkstationToCleanState() {
    currentProjectDir = null;
    window.currentProjectDir = null;
    try { localStorage.removeItem("unfoldiq_project"); } catch (e) {}
    // Phase 9: clear transient narration state (plan file stays in project).
    narrationGen++;
    narrationPlan = null;
    narrationSummary = null;
    narrationSelectedBeat = null;
    narrationReviewOnly = false;
    narrationHealth = "TRỐNG";
    closeNarrationModal();
    updateNarrationSummary();

    // Phase 10: clear transient visual continuity state
    visualBibleGen++;
    visualBibleData = null;
    window.currentVisualBible = null;
    window.currentVeoPlan = null;
    visualContinuityStatus = "Not Generated";
    visualContinuityIssues = [];
    visualBibleSelectedEntityId = null;
    visualBibleSearchFilter = "";
    visualBibleIssueFilter = "all";
    if (typeof closeVisualBibleModal === "function") closeVisualBibleModal();
    if (typeof updateVisualContinuityUI === "function") updateVisualContinuityUI();
    // P0.1: truly blank — editor cleared, no previous project data visible.
    hydrateScriptEditor("");
    if (activeProjectNameEl) activeProjectNameEl.textContent = "Chưa chọn dự án";
    if (slugPreviewEl) slugPreviewEl.textContent = "";
    if (playerContextLabel) playerContextLabel.textContent = "Không có dự án nào được chọn";

    if (audioPlayer) {
      audioPlayer.pause();
      audioPlayer.removeAttribute("src");
      audioPlayer.load();
    }
    if (btnCloseProject) btnCloseProject.style.display = "none";
    if (finalDurationText) finalDurationText.textContent = "--";
    if (btnExportWav) btnExportWav.disabled = true;
    if (btnExportMp3) btnExportMp3.disabled = true;
    if (btnRegenerateAllVeo) btnRegenerateAllVeo.disabled = true;

    projectCues = [];
    if (tsCuesList) tsCuesList.innerHTML = `<p class="empty-state">Chưa có dữ liệu timestamp. Hãy tạo giọng đọc và bấm "Tạo Timestamp".</p>`;
    if (tsPreviewCount) tsPreviewCount.textContent = "0 đoạn";
    if (tsCuesBadge) tsCuesBadge.textContent = "0";
    if (tsCoverageBadge) tsCoverageBadge.textContent = "--";
    setTsStatus("idle", "Chưa tạo");

    projectScenes = [];
    selectedSceneId = null;
    if (spRowsContainer) spRowsContainer.innerHTML = `<p class="empty-state">Chưa có Scene Plan. Bấm "Tạo Scene Plan" để phân bổ storyboard.</p>`;
    if (spSelectedDetail) spSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chưa có dữ liệu cảnh</p></div>`;
    if (spRowCountBadge) spRowCountBadge.textContent = "0/0";
    if (spCountBadge) spCountBadge.textContent = "0 cảnh";
    if (spCoverageBadge) spCoverageBadge.textContent = "Độ phủ 0%";
    if (spMetaDuration) spMetaDuration.textContent = "Thời lượng: --";
    setSpStatus("idle", "Chưa sẵn sàng");

    projectVeoShots = [];
    selectedShotId = null;
    if (veoRowsContainer) veoRowsContainer.innerHTML = `<p class="empty-state">Chưa có Veo Prompt. Bấm "Tạo Veo Prompt" để dựng prompt video.</p>`;
    if (veoSelectedDetail) veoSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chưa có dữ liệu cảnh quay</p></div>`;
    if (veoRowCountBadge) veoRowCountBadge.textContent = "0/0";
    if (veoCountBadge) veoCountBadge.textContent = "0 cảnh quay";
    if (veoCoverageBadge) veoCoverageBadge.textContent = "Độ phủ 0%";
    if (veoMetaDuration) veoMetaDuration.textContent = "Thời lượng: --";
    setVeoStatus("idle", "Chưa sẵn sàng");

    tsOutdated = false;
    scenesOutdated = false;
    veoOutdated = false;
    veoOutdatedScenes = [];
    updateDependencyState();

    // Phase 11: blank Production card — no path/status leakage.
    clearProductionCard();
    // Phase 12: blank Editorial QA card.
    if (typeof clearEditorialCard === "function") clearEditorialCard();
  }
  window.resetWorkstationToCleanState = resetWorkstationToCleanState;

  if (btnCloseProject) {
    btnCloseProject.addEventListener("click", () => {
      // P0.1: dirty check FIRST — nested confirm dialogs would be closed
      // immediately by the shared modal manager, so chain explicitly.
      if (isScriptDirty()) {
        confirmDiscardScriptIfDirty("Đóng dự án", () => doCloseProject());
      } else {
        doCloseProject();
      }
    });
  }

  function doCloseProject() {
    showConfirmDialog({
      variant: "warning",
      title: "Đóng dự án hiện tại?",
      message: "Bạn có muốn đóng dự án hiện tại và đưa Workstation về trạng thái ban đầu? Các thay đổi đã lưu trong tệp dự án không bị mất.",
      confirmText: "Đóng dự án",
      cancelText: "Hủy",
      onConfirm: () => {
        resetWorkstationToCleanState();
        showNotification("Đã đóng dự án.", "info");
      }
    });
  }

  // Contextual Help System
  const MODULE_HELP_CONTENT = {
    script: {
      title: "1. Kịch bản lồng tiếng",
      sections: [
        { label: "Mục đích", text: "Nhập nội dung văn bản kịch bản tiếng Việt hoặc tiếng Anh để tạo giọng đọc lồng tiếng và phân tích thị giác." },
        { label: "Khi nào sử dụng", text: "Bước đầu tiên của mọi dự án sản xuất video UnfoldIQ." },
        { label: "Điều kiện tiên quyết", text: "Không có. Bạn có thể gõ trực tiếp hoặc dán kịch bản từ clipboard." },
        { label: "Đầu ra (Output)", text: "Văn bản được tính toán ký tự, số từ, thời lượng ước tính và tự động phân tách câu chuẩn xác." },
        { label: "Bước tiếp theo", text: "Kiểm tra phát âm nếu có từ viết tắt, cấu hình giọng đọc và bấm 'Tạo giọng đọc'." }
      ]
    },
    audio: {
      title: "2. Audio Studio & Kết xuất (Audio QA)",
      sections: [
        { label: "Mục đích", text: "Theo dõi tiến độ kết xuất giọng đọc theo từng đoạn (chunk streaming), kiểm tra cache reuse và nghe thử âm thanh chất lượng cao." },
        { label: "Khi nào sử dụng", text: "Sau khi bấm 'Tạo giọng đọc' hoặc khi mở lại một dự án đã có audio." },
        { label: "Điều kiện tiên quyết", text: "Đã có kịch bản và dịch vụ Kokoro TTS Server đang hoạt động." },
        { label: "Đầu ra (Output)", text: "Tệp âm thanh WAV (24kHz studio master) và MP3 (320kbps) trong thư mục dự án." },
        { label: "Bước tiếp theo", text: "Chuyển sang bước 'Voice QA' để kiểm định chất lượng phát âm." }
      ]
    },
    "voice-qa": {
      title: "3. Voice QA (Kiểm định giọng đọc)",
      sections: [
        { label: "Mục đích", text: "Kiểm tra tính chính xác của âm thanh narration đối chiếu với văn bản gốc kịch bản trước khi tạo Timestamp." },
        { label: "Khi nào sử dụng", text: "Tự động chạy sau khi tạo giọng đọc hoặc chạy thủ công bất cứ lúc nào." },
        { label: "Phát hiện", text: "Thiếu từ, thừa từ, từ thay thế, lặp đoạn/câu, WPM bất thường, khoảng lặng quá dài và câu bị cắt ngắn." },
        { label: "Thao tác sửa lỗi", text: "Nghe từng đoạn nghi vấn, Chấp nhận (nếu phát âm đúng), Sửa phát âm qua Từ điển, hoặc Render lại riêng đoạn đó." },
        { label: "Bước tiếp theo", text: "Sau khi kiểm định đạt PASS hoặc giải quyết xong các cảnh báo, tiếp tục sang bước Timestamp." }
      ]
    },
    timestamp: {
      title: "4. Mốc thời gian phụ đề (Whisper Alignment)",
      sections: [
        { label: "Mục đích", text: "Sử dụng mô hình Whisper để nhận dạng và gán mốc thời gian bắt đầu - kết thúc chính xác cho từng câu và từng từ." },
        { label: "Khi nào sử dụng", text: "Sau khi đã tạo xong file audio WAV." },
        { label: "Điều kiện tiên quyết", text: "Dự án đã có file audio master." },
        { label: "Đầu ra (Output)", text: "File phụ đề chuẩn SRT (subtitles.srt) và mảng câu thời gian JSON (timestamps.json)." },
        { label: "Bước tiếp theo", text: "Chuyển sang 'Scene Planner' để storyboard phân cảnh khớp từng giây với lời đọc." }
      ]
    },
    scenes: {
      title: "4. Phân bổ storyboard (Visual Scene Planner)",
      sections: [
        { label: "Mục đích", text: "Tự động phân bổ kịch bản thành các cảnh quay (storyboard) ngắn có mục tiêu thị giác, thể loại, góc máy và prompt sinh ảnh." },
        { label: "Khi nào sử dụng", text: "Sau khi đã có mốc thời gian timestamp hoàn chỉnh." },
        { label: "Điều kiện tiên quyết", text: "Dự án đã hoàn tất bước Audio và Timestamp." },
        { label: "Đầu ra (Output)", text: "Danh sách scene chi tiết, file scenes.json và storyboard.md xuất bản." },
        { label: "Bước tiếp theo", text: "Chuyển sang 'Veo Prompt' để sinh bộ câu lệnh tạo video AI chuyển động." }
      ]
    },
    veo: {
      title: "5. Câu lệnh video AI (Veo Prompt Generator)",
      sections: [
        { label: "Mục đích", text: "Dựng câu lệnh sinh video AI độ phân giải cao tương thích Google Veo 2, Runway Gen-3 với đầy đủ framing, camera motion, lighting và negative prompt." },
        { label: "Khi nào sử dụng", text: "Sau khi đã hoàn tất phân bổ storyboard scenes." },
        { label: "Điều kiện tiên quyết", text: "Đã có Scene Plan hợp lệ." },
        { label: "Đầu ra (Output)", text: "Danh sách shot video chi tiết, file veo_prompts.json và export markdown." },
        { label: "Bước tiếp theo", text: "Sao chép prompt vào công cụ tạo video AI hoặc xuất bản gói dự án." }
      ]
    },
    projects: {
      title: "6. Lịch sử dự án & Quản lý an toàn (Project Manager)",
      sections: [
        { label: "Mục đích", text: "Duyệt danh sách các dự án sản xuất đã tạo, mở nghe lại audio và xóa vĩnh viễn các dự án không còn sử dụng." },
        { label: "Khi nào sử dụng", text: "Khi muốn chuyển đổi qua lại giữa các dự án hoặc dọn dẹp dung lượng đĩa." },
        { label: "Điều kiện tiên quyết", text: "Không có. Danh sách tự động quét thư mục projects/." },
        { label: "Đầu ra (Output)", text: "Xem nhanh thông tin giọng đọc, số ký tự, thời lượng audio và nút xóa an toàn." },
        { label: "Bước tiếp theo", text: "Bấm 'Mở dự án' để nạp toàn bộ dữ liệu vào workstation." }
      ]
    },
    pronunciation: {
      title: "7. Từ điển phát âm (Pronunciation Dictionary)",
      sections: [
        { label: "Mục đích", text: "Định nghĩa quy tắc thay thế cho từ viết tắt, thuật ngữ khoa học hoặc tên riêng tiếng nước ngoài (ví dụ: AI → ây ai, CPU → xi pi u)." },
        { label: "Khi nào sử dụng", text: "Trước khi tạo giọng đọc để đảm bảo AI đọc chuẩn xác không vấp." },
        { label: "Điều kiện tiên quyết", text: "Không có. Quy tắc được lưu trong từ điển toàn cục hệ thống." },
        { label: "Đầu ra (Output)", text: "Kịch bản tự động được chuẩn hóa trước khi đưa vào Kokoro engine." },
        { label: "Bước tiếp theo", text: "Bấm 'Nghe thử' để kiểm âm phát âm của từ vừa thêm." }
      ]
    },
    voice: {
      title: "8. Cấu hình Giọng đọc & Tốc độ (Voice Settings)",
      sections: [
        { label: "Mục đích", text: "Lựa chọn giọng đọc AI yêu thích và tinh chỉnh tốc độ đọc phù hợp với phong cách và nhịp điệu của video." },
        { label: "Khi nào sử dụng", text: "Khi bắt đầu một kịch bản mới hoặc thử nghiệm các phong cách đọc khác nhau." },
        { label: "Điều kiện tiên quyết", text: "Kokoro TTS Server đang chạy." },
        { label: "Đầu ra (Output)", text: "Giọng đọc và tốc độ mong muốn được áp dụng cho bản thu âm tiếp theo." },
        { label: "Bước tiếp theo", text: "Bấm 'Tạo giọng đọc' để bắt đầu kết xuất." }
      ]
    }
  };

  function showModuleHelp(moduleId) {
    const data = MODULE_HELP_CONTENT[moduleId];
    if (!data || !helpModal || !helpModalTitle || !helpModalBody) return;
    lastFocusedElement = document.activeElement;
    helpModalTitle.textContent = data.title;
    helpModalBody.innerHTML = `
      <div class="help-sections-list">
        ${data.sections.map(s => `
          <div class="help-section">
            <div class="help-section-title">${escapeHtml(s.label)}</div>
            <div class="help-section-content">${escapeHtml(s.text)}</div>
          </div>
        `).join("")}
      </div>
    `;
    helpModal.style.display = "flex";
    helpModal.classList.add("open");
    uqOpenModals.push({ el: helpModal, trigger: lastFocusedElement });
    uqLockBody();
    trapFocus(helpModal);
  }
  window.showModuleHelp = showModuleHelp;

  function closeModuleHelp() {
    uqModalClose(helpModal);
  }
  window.closeModuleHelp = closeModuleHelp;

  if (helpModalCloseBtn) helpModalCloseBtn.addEventListener("click", closeModuleHelp);
  if (helpModalActionBtn) helpModalActionBtn.addEventListener("click", closeModuleHelp);
  if (helpModal) {
    helpModal.addEventListener("click", (e) => {
      if (e.target === helpModal) closeModuleHelp();
    });
  }

  // Attach contextual help button listeners
  document.querySelectorAll(".btn-module-help").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mod = btn.dataset.module;
      if (mod) showModuleHelp(mod);
    });
  });

  // Guided Onboarding Tour System — DEPRECATED (12 bước cũ đã gỡ nội dung).
  // Nội dung tour mới nằm trong guide.js (window.UQGuide). Mảng TOUR_STEPS cũ bị xóa để
  // tránh nhầm lẫn; DOM overlay (#onboarding-tour-overlay) được UQGuide tái sử dụng.

  // ---------------------------------------------------------------------------
  // DEPRECATED: tour 12 bước cũ (onboarding revamp spec 04 §15).
  // Hệ mới: window.UQGuide trong guide.js (product-overview ≤6 bước + mini tours,
  // Help Center, per-tour versioning unfoldiq.onboarding.v2, migration giữ state cũ).
  // Các hàm dưới chỉ còn là shim tương thích, không auto-run tour cũ nữa.
  // ---------------------------------------------------------------------------
  function startTour(stepIndex = 0) {
    if (window.UQGuide && typeof window.UQGuide.start === "function") {
      window.UQGuide.start("product-overview", 0);
      return;
    }
    if (tourOverlay) {
      tourOverlay.style.display = "block";
      tourOverlay.classList.add("open");
    }
  }
  window.startTour = startTour;

  function closeTour() {
    if (window.UQGuide && typeof window.UQGuide.dismiss === "function") {
      try { window.UQGuide.dismiss(); } catch (e) {}
    }
    if (tourOverlay) {
      tourOverlay.style.display = "none";
      tourOverlay.classList.remove("open");
    }
    try { localStorage.setItem("unfoldiq_tour_completed", "true"); } catch (e) {}
  }
  window.closeTour = closeTour;

  function renderTourStep(index) {
    // No-op: tour cũ đã deprecated, render do UQGuide đảm nhiệm.
    if (window.UQGuide) return;
    closeTour();
  }

  // Universal fast copy helper with inline confirmation
  async function copyTextToClipboard(text, btnEl) {
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      if (btnEl) {
        const span = btnEl.querySelector("span") || btnEl;
        const orig = span.textContent;
        span.textContent = "Đã sao chép!";
        setTimeout(() => { span.textContent = orig; }, 1500);
      }
    } catch (err) {
      console.warn("Clipboard copy fallback:", err);
      if (btnEl) {
        const span = btnEl.querySelector("span") || btnEl;
        span.textContent = "Đã sao chép!";
        setTimeout(() => { span.textContent = "Sao chép Prompt"; }, 1500);
      }
    }
  }

  // Global Escape Key Listener for Modals & Mobile Drawers
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (spEditModal && spEditModal.style.display !== "none") {
        closeEditSceneModal();
      } else if (veoEditModal && veoEditModal.style.display !== "none") {
        closeEditVeoModal();
      } else if (pipelineSidebar && pipelineSidebar.classList.contains("open")) {
        pipelineSidebar.classList.remove("open");
      } else if (workspaceInspector && workspaceInspector.classList.contains("open")) {
        workspaceInspector.classList.remove("open");
        syncShellButtons();
      }
    }
  });

  // ==============================================================================
  // 3. WORKSPACE ROUTING & NAVIGATION
  // ==============================================================================
  const WORKSPACE_INSPECTOR_MAP = {
    overview: "inspector-default",
    research: "inspector-default",
    script: "inspector-script",
    audio: "inspector-audio",
    "voice-qa": "inspector-voice-qa",
    timestamp: "inspector-timestamp",
    scenes: "inspector-scenes",
    veo: "inspector-veo",
    library: "inspector-default",
    timeline: "inspector-default",
    review: "inspector-default",
    export: "inspector-default",
    activity: "inspector-default",
    projects: "inspector-default",
    pronunciation: "inspector-default",
    settings: "inspector-default"
  };

  function switchWorkspace(targetId) {
    if (!targetId) return;
    let actualTargetId = targetId;
    if (targetId === "content" || targetId === "script") actualTargetId = "story";
    if (targetId === "studio") actualTargetId = "timeline";
    if (targetId === "audio" || targetId === "voice" || targetId === "voice-qa" || targetId === "timestamp" || targetId === "pronunciation") actualTargetId = "voice";

    const previousWorkspaceId = activeWorkspaceId;
    activeWorkspaceId = actualTargetId;
    document.body.dataset.activeWorkspace = actualTargetId;

    // 1. Active-Only DOM Management: Unmount heavy rows from leaving workspace
    if (previousWorkspaceId === "scenes" && actualTargetId !== "scenes") {
      if (spRowsContainer) {
        spScrollTop = spRowsContainer.scrollTop;
        spRowsContainer.innerHTML = `<div class="unmounted-placeholder" style="padding: 24px; text-align: center; color: var(--text-muted); font-size: var(--font-size-xs);">Workspace tạm dừng hiển thị (giải phóng DOM)</div>`;
      }
    } else if (previousWorkspaceId === "veo" && actualTargetId !== "veo") {
      if (veoRowsContainer) {
        veoScrollTop = veoRowsContainer.scrollTop;
        veoRowsContainer.innerHTML = `<div class="unmounted-placeholder" style="padding: 24px; text-align: center; color: var(--text-muted); font-size: var(--font-size-xs);">Workspace tạm dừng hiển thị (giải phóng DOM)</div>`;
      }
    }

    const WORKSPACE_GROUPS = {
      content: ["content", "research", "script", "story"],
      story: ["story", "script"],
      voice: ["voice", "audio", "voice-qa", "timestamp", "pronunciation"],
      studio: ["studio", "timeline", "veo", "audio", "voice", "voice-qa", "timestamp"]
    };

    // 2. Update Sidebar Active Item
    document.querySelectorAll(".pipeline-nav .nav-item").forEach(btn => {
      const ws = btn.dataset.workspace;
      const isMatch = (ws === actualTargetId) ||
        (ws === "voice" && WORKSPACE_GROUPS.voice.includes(actualTargetId)) ||
        (ws === "audio" && WORKSPACE_GROUPS.voice.includes(actualTargetId)) ||
        (ws === "content" && WORKSPACE_GROUPS.content.includes(actualTargetId)) ||
        (ws === "studio" && WORKSPACE_GROUPS.studio.includes(actualTargetId));
      if (isMatch) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 3. Update Main Workspace View
    document.querySelectorAll(".workspace-view").forEach(view => {
      view.classList.remove("active");
    });
    const targetView = document.getElementById(`ws-${actualTargetId}`);
    if (targetView) {
      targetView.classList.add("active");
    }

    // 3b. Update Workflow Stepper Item Active State
    document.querySelectorAll(".stepper-item").forEach(step => {
      const ws = step.dataset.workspace;
      const isMatch = (ws === actualTargetId) ||
        (ws === "voice" && WORKSPACE_GROUPS.voice.includes(actualTargetId)) ||
        (ws === "audio" && WORKSPACE_GROUPS.voice.includes(actualTargetId)) ||
        (ws === "content" && WORKSPACE_GROUPS.content.includes(actualTargetId)) ||
        (ws === "studio" && WORKSPACE_GROUPS.studio.includes(actualTargetId));
      if (isMatch) {
        step.classList.add("active");
      } else {
        step.classList.remove("active");
      }
    });

    // 4. Mount heavy rows on entering active scenes or veo workspace, or load voice QA
    if (window.Phase14 && typeof window.Phase14.handleWorkspaceSwitch === "function") {
      window.Phase14.handleWorkspaceSwitch(targetId);
    }
    if (actualTargetId === "voice" && currentProjectDir) {
      loadVoiceWorkbench(currentProjectDir);
    } else if (actualTargetId === "scenes" && currentProjectDir) {
      loadVisualWorkbench(currentProjectDir);
    } else if (targetId === "voice-qa" && currentProjectDir) {
      loadVoiceQA(currentProjectDir);
    } else if (targetId === "timestamp" && currentProjectDir) {
      loadTimestampsForProject(currentProjectDir);
    } else if (targetId === "scenes" && projectScenes.length > 0) {
      renderScenesList(projectScenes);
      if (spRowsContainer && spScrollTop > 0) {
        spRowsContainer.scrollTop = spScrollTop;
      }
    } else if (targetId === "veo" && projectVeoShots.length > 0) {
      renderVeoShotsList(projectVeoShots);
      if (veoRowsContainer && veoScrollTop > 0) {
        veoRowsContainer.scrollTop = veoScrollTop;
      }
    }

    // 5. Update Contextual Inspector
    const targetInspectorId = WORKSPACE_INSPECTOR_MAP[targetId] || "inspector-default";
    document.querySelectorAll(".inspector-panel").forEach(panel => {
      panel.classList.remove("active");
    });
    const targetPanel = document.getElementById(targetInspectorId);
    if (targetPanel) {
      targetPanel.classList.add("active");
    }

    // Close drawers on switch khi chúng đang ở chế độ drawer
    if (window.innerWidth < 1280) {
      closeAllDrawers();
    }
  }
  window.switchWorkspace = switchWorkspace;

  const drawerBackdrop = document.getElementById("drawer-backdrop");

  function closeAllDrawers() {
    if (pipelineSidebar) pipelineSidebar.classList.remove("open");
    if (workspaceInspector) workspaceInspector.classList.remove("open");
    if (drawerBackdrop) drawerBackdrop.classList.remove("active");
    syncShellButtons();
  }

  function syncDrawerBackdrop() {
    if (!drawerBackdrop) return;
    const sidebarDrawerOpen = pipelineSidebar && pipelineSidebar.classList.contains("open") && window.innerWidth < 1024;
    const inspectorDrawerOpen = workspaceInspector && workspaceInspector.classList.contains("open") && window.innerWidth < 1280;
    if (sidebarDrawerOpen || inspectorDrawerOpen) {
      drawerBackdrop.classList.add("active");
    } else {
      drawerBackdrop.classList.remove("active");
    }
  }

  // Attach Navigation Listeners
  document.querySelectorAll(".pipeline-nav .nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      switchWorkspace(btn.dataset.workspace);
    });
  });

  // Attach Stepper Item Navigation Listeners (§14: div stepper phải keyboard-reachable).
  document.querySelectorAll(".stepper-item").forEach(step => {
    if (step.dataset.workspace) {
      step.setAttribute("tabindex", "0");
      step.setAttribute("role", "button");
      step.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          switchWorkspace(step.dataset.workspace);
        }
      });
    }
    step.addEventListener("click", () => {
      if (step.dataset.workspace) {
        switchWorkspace(step.dataset.workspace);
      }
    });
  });

  if (btnOpenSettings) {
    btnOpenSettings.addEventListener("click", () => {
      switchWorkspace("script");
      const adv = document.querySelector(".advanced-settings-collapse");
      if (adv) adv.open = true;
    });
  }

  // 02A §10: appearance single owner — system | light | dark, persist, no flash.
  const APPEAR_KEY = "unfoldiq_appearance";
  const appearSelect = document.getElementById("appearance-select");
  function resolveAppearance(ap) {
    if (ap === "light") return "light";
    if (ap === "dark") return "dark";
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch (e) { return "dark"; }
  }
  function applyAppearance(ap, persist = true) {
    const mode = (ap === "light" || ap === "dark" || ap === "system") ? ap : "dark";
    if (persist) { try { localStorage.setItem(APPEAR_KEY, mode); } catch (e) {} }
    document.documentElement.dataset.theme = resolveAppearance(mode);
    if (appearSelect && appearSelect.value !== mode) appearSelect.value = mode;
  }
  window.setAppearance = (ap) => applyAppearance(ap, true);
  (function initAppearance() {
    let saved = "dark";
    try { saved = localStorage.getItem(APPEAR_KEY) || "dark"; } catch (e) {}
    applyAppearance(saved, false);
    if (appearSelect) {
      appearSelect.addEventListener("change", () => applyAppearance(appearSelect.value, true));
    }
    try {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onSys = () => {
        let cur = "dark";
        try { cur = localStorage.getItem(APPEAR_KEY) || "dark"; } catch (e) {}
        if (cur === "system") document.documentElement.dataset.theme = resolveAppearance("system");
      };
      if (mq.addEventListener) mq.addEventListener("change", onSys);
      else if (mq.addListener) mq.addListener(onSys);
    } catch (e) {}
  })();

  // Toggle Sidebar / Inspector — single owner (01B).
  // Sidebar collapse trong flow từ 1024; inspector collapse từ 1280, dưới đó là drawer.
  // Mỗi control luôn có tác dụng ở mọi viewport (không dead control).
  const SHELL_KEY = "unfoldiq_shell";
  function readShellState() {
    try { return JSON.parse(localStorage.getItem(SHELL_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function writeShellState(patch) {
    try { localStorage.setItem(SHELL_KEY, JSON.stringify({ ...readShellState(), ...patch })); }
    catch (e) { /* private mode: bỏ qua persist */ }
  }
  const sidebarInFlow = () => window.innerWidth >= 1024;
  const inspectorInFlow = () => window.innerWidth >= 1280;
  function syncShellButtons() {
    if (btnToggleSidebar) {
      const collapsed = document.body.classList.contains("sidebar-collapsed");
      const open = pipelineSidebar ? pipelineSidebar.classList.contains("open") : false;
      const expanded = sidebarInFlow() ? !collapsed : open;
      btnToggleSidebar.classList.toggle("active", expanded);
      btnToggleSidebar.setAttribute("aria-expanded", String(expanded));
    }
    if (btnToggleInspector) {
      const collapsed = document.body.classList.contains("inspector-collapsed");
      const open = workspaceInspector ? workspaceInspector.classList.contains("open") : false;
      const expanded = inspectorInFlow() ? !collapsed : open;
      btnToggleInspector.classList.toggle("active", expanded);
      btnToggleInspector.setAttribute("aria-expanded", String(expanded));
    }
  }
  // Áp dụng state đã persist khi khởi động (theo breakpoint hiện tại).
  (function applyPersistedShell() {
    const saved = readShellState();
    if (sidebarInFlow() && saved.sidebarCollapsed) document.body.classList.add("sidebar-collapsed");
    if (inspectorInFlow() && saved.inspectorCollapsed) document.body.classList.add("inspector-collapsed");
  })();
  if (btnToggleSidebar && pipelineSidebar) {
    btnToggleSidebar.addEventListener("click", () => {
      if (sidebarInFlow()) {
        document.body.classList.toggle("sidebar-collapsed");
        writeShellState({ sidebarCollapsed: document.body.classList.contains("sidebar-collapsed") });
      } else {
        pipelineSidebar.classList.toggle("open");
        if (workspaceInspector && pipelineSidebar.classList.contains("open")) {
          workspaceInspector.classList.remove("open");
        }
      }
      syncDrawerBackdrop();
      syncShellButtons();
    });
  }

  if (btnToggleInspector && workspaceInspector) {
    btnToggleInspector.addEventListener("click", () => {
      if (inspectorInFlow()) {
        document.body.classList.toggle("inspector-collapsed");
        writeShellState({ inspectorCollapsed: document.body.classList.contains("inspector-collapsed") });
      } else {
        workspaceInspector.classList.toggle("open");
        if (pipelineSidebar && workspaceInspector.classList.contains("open")) {
          pipelineSidebar.classList.remove("open");
        }
      }
      syncDrawerBackdrop();
      syncShellButtons();
    });
  }
  syncShellButtons();

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener("click", closeAllDrawers);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeAllDrawers();
    }
  });

  // Chỉ đóng drawer khi breakpoint đổi mode (tránh giật khi resize liên tục).
  let lastShellMode = (sidebarInFlow() ? "S" : "s") + (inspectorInFlow() ? "I" : "i");
  let shellResizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(shellResizeT);
    shellResizeT = setTimeout(() => {
      const mode = (sidebarInFlow() ? "S" : "s") + (inspectorInFlow() ? "I" : "i");
      if (mode !== lastShellMode) {
        lastShellMode = mode;
        closeAllDrawers();
      }
      syncShellButtons();
      syncDrawerBackdrop();
    }, 150);
  });

  // ==============================================================================
  // 4. PERSISTENT BOTTOM AUDIO TRANSPORT
  // ==============================================================================
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds == null || seconds < 0) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  function formatQATime(seconds, precision = 2) {
    if (isNaN(seconds) || seconds == null || seconds < 0) return precision === 1 ? "00:00.0" : "00:00.00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const frac = Math.floor((seconds % 1) * Math.pow(10, precision));
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${frac.toString().padStart(precision, "0")}`;
  }

  function updateAudioTransportState() {
    if (!audioPlayer) return;
    const isPlaying = !audioPlayer.paused && !audioPlayer.ended && audioPlayer.readyState > 2;
    const playIcon = btnGlobalPlay?.querySelector(".play-icon");
    const pauseIcon = btnGlobalPlay?.querySelector(".pause-icon");

    if (playIcon && pauseIcon) {
      if (isPlaying) {
        playIcon.style.display = "none";
        pauseIcon.style.display = "block";
      } else {
        playIcon.style.display = "block";
        pauseIcon.style.display = "none";
      }
    }
    if (btnGlobalPlay) {
      btnGlobalPlay.setAttribute("aria-label", isPlaying ? "Tạm dừng" : "Phát");
    }
  }

  // 02A §26: single playback state — media element là source of truth duy nhất.
  // Scene button + bottom player + timeline đều render từ state này.
  const UQAudio = { state: "idle", pending: false };
  window.UQAudio = UQAudio;
  function uqScenePlaying(kind, id) {
    if (UQAudio.state !== "playing" || !audioPlayer) return false;
    const t = audioPlayer.currentTime || 0;
    if (kind === "scene") {
      const sc = (projectScenes || []).find(s => s.scene_id === id);
      return !!(sc && t >= sc.start && t < sc.end);
    }
    const sh = (projectVeoShots || []).find(s => s.shot_id === id);
    return !!(sh && t >= sh.start && t < sh.end);
  }
  function setPlayBtn(btn, playing, baseLabel) {
    if (!btn) return;
    const svg = btn.querySelector("svg.icon, svg.ui-icon");
    const label = btn.querySelector("span:last-child");
    const use = svg ? svg.querySelector("use") : null;
    if (use) use.setAttribute("href", playing ? "#icon-pause" : "#icon-play");
    if (svg) svg.setAttribute("aria-hidden", "true");
    // Một icon duy nhất: không bao giờ thêm ký hiệu text vào label.
    if (label) label.textContent = UQAudio.pending ? "Đang tải…" : (playing ? "Tạm dừng" : baseLabel);
    const name = btn.getAttribute("data-uq-name") || baseLabel;
    btn.setAttribute("aria-label", UQAudio.pending ? `Đang tải ${name}` : (playing ? `Tạm dừng ${name}` : `Phát ${name}`));
    btn.classList.toggle("is-playing", playing);
  }
  function syncPlaybackUI() {
    updateAudioTransportState();
    const scBtn = document.querySelector("#sp-selected-detail .btn-seek-scene");
    if (scBtn) {
      if (!scBtn.hasAttribute("data-uq-name")) {
        scBtn.setAttribute("data-uq-name", (scBtn.getAttribute("aria-label") || "cảnh").replace(/^Phát\s+/, ""));
      }
      const scene = (projectScenes || []).find(s => s.scene_id === selectedSceneId);
      setPlayBtn(scBtn, !!(scene && uqScenePlaying("scene", scene.scene_id)), "Phát");
    }
    const shBtn = document.querySelector("#veo-selected-detail .btn-seek-shot");
    if (shBtn) {
      if (!shBtn.hasAttribute("data-uq-name")) {
        shBtn.setAttribute("data-uq-name", (shBtn.getAttribute("aria-label") || "cảnh quay").replace(/^Phát\s+/, ""));
      }
      const shot = (projectVeoShots || []).find(s => s.shot_id === selectedShotId);
      setPlayBtn(shBtn, !!(shot && uqScenePlaying("shot", shot.shot_id)), "Phát từ đây");
    }
  }

  // P1 (§11): phát từ đầu sau ended — reset về start hợp lệ trước khi play.
  function uqReplayFromStart() {
    try {
      const dur = audioPlayer.duration || 0;
      if (audioPlayer.ended || (dur > 0 && audioPlayer.currentTime >= dur - 0.05)) {
        audioPlayer.currentTime = 0;
      }
    } catch (e) {}
  }
  if (btnGlobalPlay && audioPlayer) {
    btnGlobalPlay.addEventListener("click", () => {
      if (!audioPlayer.src) return;
      if (window._qaPlaybackTimeUpdateHandler) {
        audioPlayer.removeEventListener("timeupdate", window._qaPlaybackTimeUpdateHandler);
        window._qaPlaybackTimeUpdateHandler = null;
        const spanEl = document.querySelector("#btn-qa-play-range span");
        if (spanEl) spanEl.textContent = "Nghe đoạn này";
      }
      if (audioPlayer.paused) {
        uqReplayFromStart();
        UQAudio.pending = true;
        syncPlaybackUI();
        audioPlayer.play().then(null, () => {
          UQAudio.pending = false;
          UQAudio.state = "error";
          syncPlaybackUI();
          showNotification("Không phát được âm thanh. Hãy thử lại.", "error");
        });
      } else {
        audioPlayer.pause();
      }
    });
  }

  if (audioPlayer) {
    audioPlayer.addEventListener("play", () => { UQAudio.pending = false; syncPlaybackUI(); });
    audioPlayer.addEventListener("playing", () => { UQAudio.state = "playing"; UQAudio.pending = false; syncPlaybackUI(); });
    audioPlayer.addEventListener("waiting", () => { UQAudio.state = "loading"; syncPlaybackUI(); });
    audioPlayer.addEventListener("pause", () => {
      if (UQAudio.state !== "error") UQAudio.state = "paused";
      UQAudio.pending = false;
      syncPlaybackUI();
      if (window._qaPlaybackTimeUpdateHandler) {
        audioPlayer.removeEventListener("timeupdate", window._qaPlaybackTimeUpdateHandler);
        window._qaPlaybackTimeUpdateHandler = null;
        const spanEl = document.querySelector("#btn-qa-play-range span");
        if (spanEl) spanEl.textContent = "Nghe đoạn này";
      }
    });
    audioPlayer.addEventListener("ended", () => {
      UQAudio.state = "ended";
      UQAudio.pending = false;
      syncPlaybackUI();
      if (window._qaPlaybackTimeUpdateHandler) {
        audioPlayer.removeEventListener("timeupdate", window._qaPlaybackTimeUpdateHandler);
        window._qaPlaybackTimeUpdateHandler = null;
        const spanEl = document.querySelector("#btn-qa-play-range span");
        if (spanEl) spanEl.textContent = "Nghe đoạn này";
      }
    });
    audioPlayer.addEventListener("error", () => {
      UQAudio.state = "error";
      UQAudio.pending = false;
      syncPlaybackUI();
      showNotification("Không tải được âm thanh (lỗi media). Hãy thử lại.", "error");
    });

    let lastSyncRangeKey = "";
    audioPlayer.addEventListener("timeupdate", () => {
      if (isSeeking) return;
      const cur = audioPlayer.currentTime || 0;
      const dur = audioPlayer.duration || 0;
      if (playerCurrentTime) playerCurrentTime.textContent = formatTime(cur);
      if (dur > 0 && playerScrubber) {
        playerScrubber.value = (cur / dur) * 100;
      }
      // Re-sync scene buttons khi time đi qua ranh giới scene (tránh stale Pause).
      const key = `${Math.floor(cur)}|${UQAudio.state}`;
      if (key !== lastSyncRangeKey) {
        lastSyncRangeKey = key;
        syncPlaybackUI();
      }

      // Targeted playback marker updates (sub-1ms class toggle, zero list rebuilding)
      if (activeWorkspaceId === "scenes" && spRowsContainer && projectScenes.length > 0) {
        const activeScene = projectScenes.find(s => cur >= s.start && cur < s.end);
        const prev = spRowsContainer.querySelector(".is-active-playback");
        const curId = activeScene ? `sp-card-${activeScene.scene_id}` : null;
        if (prev && prev.id !== curId) prev.classList.remove("is-active-playback");
        if (curId) {
          const curEl = document.getElementById(curId);
          if (curEl && !curEl.classList.contains("is-active-playback")) {
            curEl.classList.add("is-active-playback");
          }
        }
      } else if (activeWorkspaceId === "veo" && veoRowsContainer && projectVeoShots.length > 0) {
        const activeShot = projectVeoShots.find(s => cur >= s.start && cur < s.end);
        const prev = veoRowsContainer.querySelector(".is-active-playback");
        const curId = activeShot ? `veo-card-${activeShot.shot_id}` : null;
        if (prev && prev.id !== curId) prev.classList.remove("is-active-playback");
        if (curId) {
          const curEl = document.getElementById(curId);
          if (curEl && !curEl.classList.contains("is-active-playback")) {
            curEl.classList.add("is-active-playback");
          }
        }
      }
      // 02A §6: timeline (Phase14) highlight theo global time — cùng source of truth.
      const tlList = document.getElementById("timeline-clips-list");
      if (tlList) {
        const rows = tlList.querySelectorAll("[data-tl-start]");
        let activeRow = null;
        rows.forEach(r => {
          const s = parseFloat(r.getAttribute("data-tl-start") || "0");
          const e = parseFloat(r.getAttribute("data-tl-end") || "0");
          if (cur >= s && cur < e) activeRow = r;
        });
        const prevTl = tlList.querySelector(".is-active-playback");
        if (prevTl && prevTl !== activeRow) prevTl.classList.remove("is-active-playback");
        if (activeRow && !activeRow.classList.contains("is-active-playback")) {
          activeRow.classList.add("is-active-playback");
        }
      }
    });

    audioPlayer.addEventListener("durationchange", () => {
      const dur = audioPlayer.duration || 0;
      if (playerTotalDuration) playerTotalDuration.textContent = formatTime(dur);
    });

    audioPlayer.addEventListener("loadedmetadata", () => {
      const dur = audioPlayer.duration || 0;
      if (playerTotalDuration) playerTotalDuration.textContent = formatTime(dur);
    });
  }

  if (playerScrubber && audioPlayer) {
    playerScrubber.addEventListener("input", () => {
      isSeeking = true;
      const dur = audioPlayer.duration || 0;
      if (dur > 0 && playerCurrentTime) {
        const previewTime = (playerScrubber.value / 100) * dur;
        playerCurrentTime.textContent = formatTime(previewTime);
      }
    });

    playerScrubber.addEventListener("change", () => {
      isSeeking = false;
      const dur = audioPlayer.duration || 0;
      if (window._qaPlaybackTimeUpdateHandler) {
        audioPlayer.removeEventListener("timeupdate", window._qaPlaybackTimeUpdateHandler);
        window._qaPlaybackTimeUpdateHandler = null;
        const spanEl = document.querySelector("#btn-qa-play-range span");
        if (spanEl) spanEl.textContent = "Nghe đoạn này";
      }
      if (dur > 0) {
        audioPlayer.currentTime = (playerScrubber.value / 100) * dur;
      }
    });
  }

  if (playerVolumeSlider && audioPlayer) {
    playerVolumeSlider.addEventListener("input", () => {
      audioPlayer.volume = parseFloat(playerVolumeSlider.value);
      updateMuteIcons();
    });
  }

  function updateMuteIcons() {
    if (!btnPlayerMute || !audioPlayer) return;
    const volIcon = btnPlayerMute.querySelector(".vol-icon");
    const muteIcon = btnPlayerMute.querySelector(".mute-icon");
    const isMuted = audioPlayer.muted || audioPlayer.volume === 0;
    if (volIcon && muteIcon) {
      volIcon.style.display = isMuted ? "none" : "block";
      muteIcon.style.display = isMuted ? "block" : "none";
    }
  }

  if (btnPlayerMute && audioPlayer) {
    btnPlayerMute.addEventListener("click", () => {
      audioPlayer.muted = !audioPlayer.muted;
      updateMuteIcons();
    });
  }

  // Keyboard Play/Pause Shortcut (Space) — không cướp phím khi focus ở control tương tác.
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const t = e.target;
    const tag = (t && t.tagName) || "";
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || tag === "BUTTON" ||
        (t && t.isContentEditable) || (t && t.closest && t.closest("a, button, select, [contenteditable='true']"))) {
      return;
    }
    if (audioPlayer.src) {
      e.preventDefault();
      if (audioPlayer.paused) {
        uqReplayFromStart();
        UQAudio.pending = true;
        syncPlaybackUI();
        audioPlayer.play().then(null, () => {
          UQAudio.pending = false;
          UQAudio.state = "error";
          syncPlaybackUI();
        });
      }
      else audioPlayer.pause();
    }
  });

  // Global Seek & Audition Utility
  window.seekGlobalAudio = function(startTime, contextLabel) {
    if (!audioPlayer || !audioPlayer.src) return;
    audioPlayer.currentTime = startTime;
    UQAudio.pending = true;
    syncPlaybackUI();
    audioPlayer.play().then(null, () => {
      UQAudio.pending = false;
      UQAudio.state = "error";
      syncPlaybackUI();
      showNotification("Không phát được âm thanh. Hãy thử lại.", "error");
    });
    if (contextLabel && playerContextLabel) {
      playerContextLabel.textContent = contextLabel;
    }
  };

  // ==============================================================================
  // 5. SCRIPT INPUT & DERIVED STATISTICS (DEBOUNCED)
  // ==============================================================================
  function updateTextStats() {
    const text = scriptInput.value || "";
    const charCount = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const speed = parseFloat(speedSlider.value) || 1.0;

    charCountEl.textContent = charCount.toLocaleString();
    wordCountEl.textContent = words.toLocaleString();

    // Duration estimate: 150 wpm adjusted for speed
    const totalSecs = words > 0 ? Math.round((words / 150.0) * 60.0 / speed) : 0;
    if (totalSecs < 60) {
      estDurationEl.textContent = `~${totalSecs}s`;
    } else {
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      estDurationEl.textContent = `~${mins}ph ${secs}s`;
    }
    updateDependencyState();
  }

  scriptInput.addEventListener("input", () => {
    if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
    statsDebounceTimer = setTimeout(updateTextStats, 150);
  });

  function updateSlugPreview() {
    const raw = projectNameInput.value.trim() || "unfoldiq_project";
    const slug = raw.toLowerCase().replace(/[^a-z0-9_\-]/g, "_").replace(/_+/g, "_");
    slugPreviewEl.textContent = slug;
    // 02A: typing a name never fakes a selection — active label only changes
    // on real open/close/reset.
  }
  projectNameInput.addEventListener("input", updateSlugPreview);

  speedSlider.addEventListener("input", () => {
    const val = parseFloat(speedSlider.value).toFixed(2);
    speedValueEl.textContent = `${parseFloat(val)}x`;
    updateTextStats();
    saveUserSettings();
  });

  // ==============================================================================
  // 6. HEALTH CHECK & VOICES
  // ==============================================================================
  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.kokoro && data.kokoro.healthy) {
        statusBadge.className = "status-indicator status-online";
        statusText.textContent = "Kokoro GPU ●";
      } else {
        statusBadge.className = "status-indicator status-offline";
        statusText.textContent = "Kokoro ngoại tuyến";
      }
    } catch (err) {
      statusBadge.className = "status-indicator status-offline";
      statusText.textContent = "Mất kết nối Kokoro";
    }
  }

  async function loadVoicesAndSettings() {
    try {
      const [voicesRes, settingsRes] = await Promise.all([
        fetch("/api/voices"),
        fetch("/api/settings")
      ]);

      const voicesData = await voicesRes.json();
      const settingsData = await settingsRes.json();

      if (voicesData.voices && voicesData.voices.length > 0) {
        voiceSelect.innerHTML = "";
        const VOICE_LANG_VI = { "American English": "Tiếng Anh (Mỹ)", "British English": "Tiếng Anh (Anh)", "Spanish": "Tiếng Tây Ban Nha", "French": "Tiếng Pháp", "Hindi": "Tiếng Hindi", "Italian": "Tiếng Ý", "Japanese": "Tiếng Nhật", "Portuguese": "Tiếng Bồ Đào Nha", "Mandarin": "Tiếng Trung (Quan thoại)", "Chinese": "Tiếng Trung" };
        voicesData.voices.forEach(v => {
          const opt = document.createElement("option");
          opt.value = v.id;
          const langVi = VOICE_LANG_VI[v.language] || v.language;
          opt.textContent = `${v.id} (${langVi}, Hạng ${v.grade}) ${v.is_default ? "[Mặc định]" : ""}`;
          voiceSelect.appendChild(opt);
        });
      }

      if (settingsData) {
        if (settingsData.selected_voice && voiceSelect.querySelector(`option[value="${settingsData.selected_voice}"]`)) {
          voiceSelect.value = settingsData.selected_voice;
        } else if (voicesData.voices) {
          const defVoice = voicesData.voices.find(v => v.is_default);
          if (defVoice) voiceSelect.value = defVoice.id;
        }

        if (settingsData.selected_language) {
          languageSelect.value = settingsData.selected_language;
        }

        if (settingsData.speed) {
          speedSlider.value = settingsData.speed;
          speedValueEl.textContent = `${parseFloat(settingsData.speed).toFixed(2)}x`;
        }

        if (settingsData.output_formats) {
          chkMp3.checked = settingsData.output_formats.includes("mp3");
        }

        if (settingsData.render_mode) {
          const r = document.querySelector(`input[name="render-mode"][value="${settingsData.render_mode}"]`);
          if (r) r.checked = true;
        }

        if (settingsData.narration_mode) {
          const n = document.querySelector(`input[name="narration-mode"][value="${settingsData.narration_mode}"]`);
          if (n) n.checked = true;
        }
        if (settingsData.narration_profile) {
          const np = document.getElementById("narration-profile-select");
          if (np && [...np.options].some(o => o.value === settingsData.narration_profile)) {
            np.value = settingsData.narration_profile;
          }
        }
      }
    } catch (err) {
      console.error("Failed to load voices or settings:", err);
    }
  }

  async function saveUserSettings() {
    const formats = ["wav"];
    if (chkMp3.checked) formats.push("mp3");
    const renderModeEl = document.querySelector('input[name="render-mode"]:checked');
    const narrModeEl = document.querySelector('input[name="narration-mode"]:checked');
    const narrProfileEl = document.getElementById("narration-profile-select");
    const payload = {
      selected_voice: voiceSelect.value,
      selected_language: languageSelect.value,
      speed: parseFloat(speedSlider.value),
      output_formats: formats,
      render_mode: renderModeEl ? renderModeEl.value : "balanced",
      narration_mode: narrModeEl ? narrModeEl.value : "auto",
      narration_profile: narrProfileEl ? narrProfileEl.value : "DOCUMENTARY_CINEMATIC"
    };

    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  }

  voiceSelect.addEventListener("change", saveUserSettings);
  languageSelect.addEventListener("change", saveUserSettings);
  chkMp3.addEventListener("change", saveUserSettings);
  document.querySelectorAll('input[name="render-mode"]').forEach(el => {
    el.addEventListener("change", saveUserSettings);
  });

  // ==============================================================================
  // 7. TTS GENERATION & PROGRESS SSE
  // ==============================================================================
  function setJobState(state, errorMsg) {
    const stateLabels = {
      idle: "Chờ",
      queued: "Đang xếp hàng",
      processing: "Đang xử lý",
      completed: "Sẵn sàng",
      failed: "Lỗi",
      cancelled: "Đã hủy",
      cancelling: "Đang hủy"
    };
    jobStatePill.className = `state-pill state-${state}`;
    jobStatePill.textContent = stateLabels[state] || state;
    if (insAudioStatus) insAudioStatus.textContent = stateLabels[state] || state;

    const stepAudioBadge = document.getElementById("badge-step-audio");
    if (stepAudioBadge) {
      if (state === "completed") {
        stepAudioBadge.textContent = "✓";
        stepAudioBadge.style.color = "var(--success)";
      } else if (state === "processing") {
        stepAudioBadge.textContent = "◐";
        stepAudioBadge.style.color = "var(--accent)";
      } else if (state === "failed") {
        stepAudioBadge.textContent = "×";
        stepAudioBadge.style.color = "var(--danger)";
      }
    }

    if (errorMsg) {
      errorAlert.style.display = "flex";
      errorAlertText.textContent = errorMsg;
    } else {
      errorAlert.style.display = "none";
    }
  }

  async function doGenerateAudio() {
    const text = scriptInput.value.trim();
    if (!text) {
      showNotification("Vui lòng nhập kịch bản trước khi tạo giọng đọc.", "warning");
      return;
    }

    const formats = ["wav"];
    if (chkMp3.checked) formats.push("mp3");
    const renderModeEl = document.querySelector('input[name="render-mode"]:checked');
    const narrModeEl2 = document.querySelector('input[name="narration-mode"]:checked');
    const narrProfileEl2 = document.getElementById("narration-profile-select");
    const payload = {
      text: text,
      project_name: projectNameInput.value.trim() || undefined,
      voice: voiceSelect.value,
      language: languageSelect.value,
      speed: parseFloat(speedSlider.value),
      output_formats: formats,
      render_mode: renderModeEl ? renderModeEl.value : "balanced",
      narration_mode: narrModeEl2 ? narrModeEl2.value : "auto",
      narration_profile: narrProfileEl2 ? narrProfileEl2.value : "DOCUMENTARY_CINEMATIC"
    };

    btnGenerate.disabled = true;
    btnStop.disabled = false;
    btnExportWav.disabled = true;
    btnExportMp3.disabled = true;
    progressFill.style.width = "0%";
    progressPct.textContent = "0%";
    chunkMetric.textContent = "Đang bắt đầu...";
    elapsedMetric.textContent = "Đã chạy: 0.0s";
    if (reuseMetricEl) reuseMetricEl.textContent = "";
    chunkSnippetBox.style.display = "none";
    finalDurationText.textContent = "--";

    setJobState("queued");
    switchWorkspace("audio");

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể khởi tạo job");
      }

      const data = await res.json();
      currentJobId = data.job_id;
      listenToJobProgress(currentJobId);
    } catch (err) {
      setJobState("failed", err.message);
      btnGenerate.disabled = false;
      btnStop.disabled = true;
      showNotification(`Lỗi tạo giọng đọc: ${err.message}`, "error");
    }
  }

  btnGenerate.addEventListener("click", () => {
    const text = scriptInput.value.trim();
    if (!text) {
      showNotification("Vui lòng nhập kịch bản trước khi tạo giọng đọc.", "warning");
      return;
    }

    const hasExistingAudio = Boolean(currentProjectDir && (audioPlayer.src || (finalDurationText && finalDurationText.textContent !== "--")));
    if (hasExistingAudio) {
      showConfirmDialog({
        variant: "warning",
        title: "Tạo lại giọng đọc audio?",
        message: "Dự án đã có bản thu âm hiện tại. Tạo lại audio sẽ làm thay đổi độ dài và căn chỉnh, các bước Timestamp, Scene Plan và Veo Prompts phía sau sẽ cần được tạo lại. Bạn có chắc chắn muốn tiếp tục?",
        confirmText: "Tạo lại audio",
        cancelText: "Hủy",
        onConfirm: () => doGenerateAudio()
      });
      return;
    }
    doGenerateAudio();
  });

  function listenToJobProgress(jobId) {
    if (activeEventSource) {
      activeEventSource.close();
    }

    activeEventSource = new EventSource(`/api/jobs/${jobId}/events`);
    activeEventSource.onmessage = (e) => {
      try {
        const job = JSON.parse(e.data);
        handleJobUpdate(job);
      } catch (err) {
        console.error("Failed to parse SSE job update:", err);
      }
    };

    activeEventSource.onerror = () => {
      console.warn("SSE connection error. Reconnecting or closed.");
    };
  }

  function handleJobUpdate(job) {
    setJobState(job.state, job.error_message);

    progressFill.style.width = `${job.progress_percent || 0}%`;
    progressPct.textContent = `${job.progress_percent || 0}%`;

    if (job.total_chunks > 0) {
      const done = (job.completed_chunks || 0);
      chunkMetric.textContent = `${done} / ${job.total_chunks} phần hoàn thành`;
    }

    if (job.elapsed_seconds !== undefined) {
      elapsedMetric.textContent = `Đã chạy: ${job.elapsed_seconds}s`;
    }

    if (reuseMetricEl && job.total_chunks > 0) {
      const reused = job.reused_chunks || 0;
      const rendered = job.rendered_chunks || 0;
      reuseMetricEl.textContent = `Đã tái sử dụng: ${reused} · Đã render mới: ${rendered}`;
    }

    if (job.current_chunk_text) {
      chunkSnippetBox.style.display = "flex";
      chunkSnippetText.textContent = job.current_chunk_text;
    }

    if (job.state === "completed") {
      if (activeEventSource) activeEventSource.close();
      btnGenerate.disabled = false;
      btnStop.disabled = true;
      btnExportWav.disabled = false;
      btnExportMp3.disabled = false;

      currentProjectDir = job.project_name;
      window.currentProjectDir = currentProjectDir;
      // P0.1: the editor now represents the new current project.
      openedScriptText = scriptInput ? (scriptInput.value || "") : openedScriptText;
      if (activeProjectNameEl) activeProjectNameEl.textContent = currentProjectDir;
      finalDurationText.textContent = `${job.final_duration_seconds} giây`;
      if (playerContextLabel) playerContextLabel.textContent = `${currentProjectDir} • Sẵn sàng`;

      audioPlayer.src = `${job.audio_url}?t=${Date.now()}`;
      audioPlayer.play().catch(() => {});

      // Invalidation: Audio regenerated -> downstream steps outdated!
      if (projectCues && projectCues.length > 0) tsOutdated = true;
      if (projectScenes && projectScenes.length > 0) scenesOutdated = true;
      if (projectVeoShots && projectVeoShots.length > 0) veoOutdated = true;
      updateDependencyState();

      loadProjects();
      loadVoiceQA(currentProjectDir);
      loadTimestampsForProject(currentProjectDir);
      loadScenesForProject(currentProjectDir);
      loadVeoForProject(currentProjectDir);
      refreshNarrationPlan(currentProjectDir);
    } else if (job.state === "cancelled" || job.state === "failed") {
      if (activeEventSource) activeEventSource.close();
      btnGenerate.disabled = false;
      btnStop.disabled = true;
      loadProjects();
    }
  }

  btnStop.addEventListener("click", () => {
    if (!currentJobId) return;
    showConfirmDialog({
      variant: "warning",
      title: "Dừng tiến trình tạo audio?",
      message: "Bạn có chắc chắn muốn dừng tiến trình kết xuất giọng đọc đang chạy? Các phần âm thanh chưa hoàn thành sẽ bị hủy.",
      confirmText: "Dừng tiến trình",
      cancelText: "Tiếp tục chạy",
      onConfirm: async () => {
        setJobState("cancelling");
        btnStop.disabled = true;
        try {
          await fetch(`/api/jobs/${currentJobId}/cancel`, { method: "POST" });
        } catch (err) {
          console.error("Failed to cancel job:", err);
          showNotification(`Lỗi dừng tiến trình: ${err.message}`, "error");
        }
      }
    });
  });

  async function triggerExport(format) {
    if (!currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: format })
      });
      const data = await res.json();
      if (data.status === "success") {
        const downloadLink = document.createElement("a");
        downloadLink.href = `/api/projects/${currentProjectDir}/audio/${format}`;
        downloadLink.download = `${currentProjectDir}.${format}`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
      }
    } catch (err) {
      showNotification(`Xuất file thất bại: ${err.message}`, "error");
    }
  }

  btnExportWav.addEventListener("click", () => triggerExport("wav"));
  btnExportMp3.addEventListener("click", () => triggerExport("mp3"));

  // ==============================================================================
  // 8. PRONUNCIATION DICTIONARY (PHASE 3)
  // ==============================================================================
  async function loadPronunciations() {
    try {
      const res = await fetch("/api/pronunciations");
      const data = await res.json();
      dictionaryEntries = data.entries || [];
      renderPronunciations();
    } catch (err) {
      console.error("Failed to load pronunciation dictionary:", err);
    }
  }

  function renderPronunciations(filter = "") {
    if (!pronTableBody) return;
    const filtered = dictionaryEntries.filter(e =>
      e.original.toLowerCase().includes(filter.toLowerCase()) ||
      e.spoken_form.toLowerCase().includes(filter.toLowerCase())
    );

    pronCountBadge.textContent = `${dictionaryEntries.length} mục`;
    if (filtered.length === 0) {
      pronTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">Chưa có từ phát âm tùy chỉnh nào.</td></tr>`;
      return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(entry => {
      const tr = document.createElement("tr");
      tr.dataset.entryId = entry.id;
      tr.innerHTML = `
        <td><strong>${escapeHtml(entry.original)}</strong></td>
        <td><code>${escapeHtml(entry.spoken_form)}</code></td>
        <td>
          <button class="state-pill ${entry.enabled ? 'state-ready' : 'state-idle'} btn-toggle-entry" style="cursor: pointer; border: none;">
            ${entry.enabled ? 'Bật' : 'Tắt'}
          </button>
        </td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm btn-edit-entry" title="Sửa">Sửa</button>
          <button class="btn btn-danger btn-sm btn-delete-entry" title="Xóa">Xóa</button>
        </td>
      `;
      frag.appendChild(tr);
    });
    pronTableBody.innerHTML = "";
    pronTableBody.appendChild(frag);
  }

  if (pronSearchInput) {
    pronSearchInput.addEventListener("input", (e) => {
      renderPronunciations(e.target.value);
    });
  }

  if (pronTableBody) {
    pronTableBody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const entryId = tr.dataset.entryId;
      if (e.target.closest(".btn-toggle-entry")) {
        window.togglePronEntry(entryId);
      } else if (e.target.closest(".btn-edit-entry")) {
        window.openEditPronForm(entryId);
      } else if (e.target.closest(".btn-delete-entry")) {
        window.deletePronEntry(entryId);
      }
    });
  }

  if (btnToggleAddPron) {
    btnToggleAddPron.addEventListener("click", () => {
      editingEntryId = null;
      pronOrigInput.value = "";
      pronSpokenInput.value = "";
      pronEnabledInput.checked = true;
      pronFormError.style.display = "none";
      pronFormContainer.style.display = (pronFormContainer.style.display === "none") ? "flex" : "none";
      if (pronFormContainer.style.display !== "none") {
        pronOrigInput.focus();
      }
    });
  }

  if (btnCancelPron) {
    btnCancelPron.addEventListener("click", () => {
      pronFormContainer.style.display = "none";
      pronFormError.style.display = "none";
      editingEntryId = null;
    });
  }

  if (btnSavePron) {
    btnSavePron.addEventListener("click", async () => {
      const orig = pronOrigInput.value.trim();
      const spoken = pronSpokenInput.value.trim();
      const enabled = pronEnabledInput.checked;

      pronFormError.style.display = "none";
      if (!orig || !spoken) {
        pronFormError.style.display = "flex";
        pronFormErrorText.textContent = "Vui lòng nhập cả từ gốc và cách đọc.";
        return;
      }

      try {
        let res;
        if (editingEntryId) {
          res = await fetch(`/api/pronunciations/${editingEntryId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ original: orig, spoken_form: spoken, enabled: enabled })
          });
        } else {
          res = await fetch("/api/pronunciations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ original: orig, spoken_form: spoken, enabled: enabled })
          });
        }

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Không thể lưu cách đọc.");
        }

        pronFormContainer.style.display = "none";
        editingEntryId = null;
        loadPronunciations();
      } catch (e) {
        pronFormError.style.display = "flex";
        pronFormErrorText.textContent = e.message;
      }
    });
  }

  if (btnTestFormAudio) {
    btnTestFormAudio.addEventListener("click", () => {
      const textToTest = pronSpokenInput.value.trim() || pronOrigInput.value.trim();
      if (textToTest) auditionPronText(textToTest);
    });
  }

  async function auditionPronText(text) {
    if (!text) return;
    try {
      const voice = voiceSelect.value;
      const speed = parseFloat(speedSlider.value) || 1.0;
      const res = await fetch("/api/pronunciations/test-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, voice: voice, speed: speed })
      });
      if (!res.ok) throw new Error("Không thể tạo audio nghe thử.");
      const blob = await res.blob();
      if (pronAudioPlayer.src && pronAudioPlayer.src.startsWith("blob:")) {
        URL.revokeObjectURL(pronAudioPlayer.src);
      }
      pronAudioPlayer.src = URL.createObjectURL(blob);
      pronAudioPlayer.play().catch(() => {});
    } catch (err) {
      showNotification(`Lỗi nghe thử: ${err.message}`, "error");
    }
  }

  window.togglePronEntry = async function(entryId) {
    const entry = dictionaryEntries.find(e => e.id === entryId);
    if (!entry) return;
    try {
      await fetch(`/api/pronunciations/${entryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !entry.enabled })
      });
      loadPronunciations();
    } catch (e) {
      console.error("Toggle error:", e);
    }
  };

  window.openEditPronForm = function(entryId) {
    const entry = dictionaryEntries.find(e => e.id === entryId);
    if (!entry) return;
    editingEntryId = entry.id;
    pronOrigInput.value = entry.original;
    pronSpokenInput.value = entry.spoken_form;
    pronEnabledInput.checked = entry.enabled;
    pronFormError.style.display = "none";
    pronFormContainer.style.display = "flex";
    pronOrigInput.focus();
  };

  window.deletePronEntry = function(entryId) {
    const entry = dictionaryEntries.find(e => e.id === entryId);
    const orig = entry ? `"${entry.original}"` : "cách đọc này";
    showConfirmDialog({
      variant: "default",
      title: "Xóa quy tắc phát âm?",
      message: `Bạn có chắc chắn muốn xóa quy tắc phát âm cho ${orig} khỏi từ điển hệ thống?`,
      confirmText: "Xóa quy tắc",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          await fetch(`/api/pronunciations/${entryId}`, { method: "DELETE" });
          showNotification("Đã xóa quy tắc phát âm thành công.", "success");
          loadPronunciations();
        } catch (e) {
          showNotification(`Xóa thất bại: ${e.message}`, "error");
        }
      }
    });
  };

  // ==============================================================================
  // 8.1 VOICE QA (PHASE 8.1)
  // ==============================================================================

  function setQaStatus(state, label) {
    if (!qaStatusPill) return;
    const cleanState = (state || "idle").toLowerCase().replace(/[^a-z0-9]/g, '-');
    qaStatusPill.className = `state-pill state-${cleanState}`;
    qaStatusPill.textContent = label || state.toUpperCase();

    const badgeStepQa = document.getElementById("badge-step-voice-qa");
    const stepStatusQa = document.getElementById("step-status-voice-qa");
    let iconChar = "○";
    let iconColor = "";

    if (cleanState === "pass") {
      iconChar = "✓";
      iconColor = "var(--success)";
    } else if (cleanState === "review") {
      iconChar = "!";
      iconColor = "var(--warning)";
    } else if (cleanState === "fail") {
      iconChar = "✕";
      iconColor = "var(--danger)";
    } else if (cleanState === "running") {
      iconChar = "◐";
      iconColor = "var(--accent)";
    } else if (cleanState === "stale") {
      iconChar = "⚠";
      iconColor = "var(--text-muted)";
    }

    if (badgeStepQa) {
      badgeStepQa.textContent = iconChar;
      if (iconColor) badgeStepQa.style.color = iconColor;
    }
    if (stepStatusQa) {
      stepStatusQa.textContent = iconChar;
      stepStatusQa.className = `step-status-icon ${cleanState === 'pass' ? 'status-complete' : cleanState === 'stale' ? 'status-outdated' : ''}`;
    }
  }

  function renderQAMetrics(data) {
    if (!data) return;
    const status = (data.status || "idle").toUpperCase();
    const isStale = Boolean(data.is_stale);
    const metrics = data.metrics || {};
    const summary = data.summary || {};

    if (cardQaVerdict) {
      cardQaVerdict.className = `qa-metric-card verdict-${status.toLowerCase()}`;
    }
    if (valQaVerdict) valQaVerdict.textContent = isStale ? "Cần đồng bộ" : status;
    if (subQaVerdict) subQaVerdict.textContent = isStale ? "Audio đã thay đổi, cần chạy lại" : (status === "PASS" ? "Đạt chuẩn chất lượng" : (status === "REVIEW" ? "Cần người dùng xem lại" : (status === "FAIL" ? "Lỗi nghiêm trọng cần xử lý" : "Chưa kiểm định")));

    if (valQaMatch) valQaMatch.textContent = `${(metrics.transcript_match_pct || 0).toFixed(1)}%`;
    if (subQaWer) subQaWer.textContent = `WER: ${(metrics.wer_pct || 0).toFixed(1)}%`;

    if (valQaWpm) valQaWpm.textContent = `${Math.round(metrics.overall_wpm || 0)}`;
    if (subQaWpm) subQaWpm.textContent = `WPM (Chuẩn 130-180)`;

    const unresolvedCount = (summary.unresolved_fail_count || 0) + (summary.unresolved_review_count || 0);
    if (valQaIssuesCount) valQaIssuesCount.textContent = unresolvedCount;
    if (subQaBreakdown) subQaBreakdown.textContent = `${summary.unresolved_fail_count || 0} lỗi · ${summary.unresolved_review_count || 0} cần xem`;

    // Update inspector
    if (insQaStatus) insQaStatus.textContent = isStale ? "Cần đồng bộ" : status;
    if (insQaMatch) insQaMatch.textContent = `${(metrics.transcript_match_pct || 0).toFixed(1)}%`;
    if (insQaWer) insQaWer.textContent = `${(metrics.wer_pct || 0).toFixed(1)}%`;
    if (insQaWpm) insQaWpm.textContent = `${Math.round(metrics.overall_wpm || 0)} WPM`;
    if (insQaIssues) insQaIssues.textContent = unresolvedCount;

    setQaStatus(isStale ? "stale" : status.toLowerCase(), isStale ? "Cần chạy lại" : status);
  }

  // P1 (§9): Voice QA labels VI — value/enum giữ nguyên, hiển thị dịch.
  // P1 (§9): status hệ thống hiển thị tiếng Việt (dùng chung toàn app).
  function uqStatusVi(raw) {
    const m = { "READY": "Sẵn sàng", "PASS": "Đạt", "REVIEW": "Cần xem xét", "NOT GENERATED": "Chưa tạo", "OUTDATED": "Cần tạo lại", "STALE": "Cần tạo lại", "ERROR": "Lỗi", "LOCKED": "Đã khóa" };
    const k = String(raw || "").toUpperCase();
    return m[k] || String(raw || "");
  }

  // P1 (§9): tone cảnh quay hiển thị tiếng Việt.
  function veoToneVi(t) {
    const m = { neutral: "trung tính", mysterious: "bí ẩn", tense: "căng thẳng", ominous: "u ám", awe: "kinh ngạc", curious: "tò mò", calm: "êm dịu", urgent: "khẩn trương" };
    const v = String(t || "neutral").toLowerCase();
    return m[v] || String(t || "trung tính");
  }

  function qaSeverityVi(s) {
    const v = String(s || "").toLowerCase();
    if (v === "fail") return "Lỗi";
    if (v === "review") return "Cần xem";
    return String(s || "");
  }
  function qaResolutionVi(r) {
    const m = { ACCEPTED: "Đã chấp nhận", WAIVED: "Đã bỏ qua", UNRESOLVED: "Chưa xử lý" };
    return m[String(r || "").toUpperCase()] || String(r || "");
  }
  function qaCategoryVi(c) {
    const m = {
      missing_word: "Thiếu từ", extra_word: "Thừa từ", mispronounced: "Phát âm sai",
      pacing: "Nhịp đọc", truncation: "Cụt câu", duplication: "Lặp từ", pause: "Khoảng nghỉ"
    };
    return m[String(c || "").toLowerCase()] || String(c || "");
  }

  function renderQAIssues(issues) {
    if (!qaIssuesList) return;
    const allCount = issues.length;
    const failCount = issues.filter(i => i.severity === "fail").length;
    const reviewCount = issues.filter(i => i.severity === "review").length;
    const countAllEl = document.getElementById("count-filter-all");
    const countFailEl = document.getElementById("count-filter-fail");
    const countReviewEl = document.getElementById("count-filter-review");
    if (countAllEl) countAllEl.textContent = allCount;
    if (countFailEl) countFailEl.textContent = failCount;
    if (countReviewEl) countReviewEl.textContent = reviewCount;

    let filtered = issues;
    if (voiceQAFilter === "fail") filtered = issues.filter(i => i.severity === "fail");
    else if (voiceQAFilter === "review") filtered = issues.filter(i => i.severity === "review");
    else if (voiceQAFilter === "unresolved") filtered = issues.filter(i => !i.resolution || i.resolution === "unresolved");

    if (filtered.length === 0) {
      qaIssuesList.innerHTML = `<div class="qa-empty-state"><p>${issues.length === 0 ? "Không có vấn đề nào được phát hiện! Giọng đọc khớp hoàn toàn với kịch bản." : "Không có mục nào trong bộ lọc này."}</p></div>`;
      if (qaSelectedDetail) {
        qaSelectedDetail.innerHTML = `<div class="qa-detail-empty"><p>${issues.length === 0 ? "Tuyệt vời! Không có lỗi cần xử lý." : "Chọn một mục từ danh sách bên trái."}</p></div>`;
      }
      return;
    }

    qaIssuesList.innerHTML = filtered.map(issue => {
      const isSelected = (selectedIssueFingerprint === issue.fingerprint);
      const isResolved = issue.resolution && issue.resolution !== "unresolved";
      const badgeClass = issue.severity === "fail" ? "qa-badge-fail" : "qa-badge-review";
      const startSec = (issue.start_time !== undefined) ? Number(issue.start_time) : (Number(issue.start_seconds) || 0);
      const endSec = (issue.end_time !== undefined) ? Number(issue.end_time) : (Number(issue.end_seconds) || startSec);
      const isShort = (endSec - startSec) < 2.0 || Math.floor(startSec) === Math.floor(endSec);
      const startFmt = isShort ? formatQATime(startSec, 1) : formatTime(startSec);
      const endFmt = isShort ? formatQATime(endSec, 1) : formatTime(endSec);

      return `
        <div class="qa-issue-item ${isSelected ? 'active' : ''}" data-fingerprint="${escapeHtml(issue.fingerprint)}">
          <div class="qa-issue-header">
            <div class="qa-issue-tags">
              <span class="qa-badge ${badgeClass}">${qaSeverityVi(issue.severity)}</span>
              <span class="qa-badge qa-badge-category">${escapeHtml(qaCategoryVi(issue.category))}</span>
              ${isResolved ? `<span class="qa-badge qa-badge-resolved">${escapeHtml(qaResolutionVi(issue.resolution))}</span>` : ''}
            </div>
            <span class="qa-time-range">${startFmt} - ${endFmt}</span>
          </div>
          <div class="qa-issue-msg">${escapeHtml(issue.description)}</div>
          ${issue.expected_text ? `<div class="qa-issue-snippet">Gốc: "${escapeHtml(issue.expected_text.slice(0, 80))}"</div>` : ''}
        </div>
      `;
    }).join("");

    // Attach click handlers
    qaIssuesList.querySelectorAll(".qa-issue-item").forEach(item => {
      item.addEventListener("click", () => {
        const fp = item.dataset.fingerprint;
        const targetIssue = filtered.find(i => i.fingerprint === fp) || issues.find(i => i.fingerprint === fp);
        if (targetIssue) {
          selectedIssueFingerprint = fp;
          qaIssuesList.querySelectorAll(".qa-issue-item").forEach(el => el.classList.remove("active"));
          item.classList.add("active");
          selectQAIssue(targetIssue);
        }
      });
    });

    // Auto-select: search in 'filtered' first so filter tabs never keep a ghost item
    let toSelect = filtered.find(i => i.fingerprint === selectedIssueFingerprint);
    if (!toSelect && filtered.length > 0) {
      toSelect = filtered[0];
      selectedIssueFingerprint = toSelect.fingerprint;
    }
    if (toSelect) {
      const activeEl = qaIssuesList.querySelector(`[data-fingerprint="${toSelect.fingerprint}"]`);
      if (activeEl) activeEl.classList.add("active");
      selectQAIssue(toSelect);
    }
  }

  function selectQAIssue(issue) {
    if (!qaSelectedDetail || !issue) return;

    // Remove any active segment timeupdate handler to prevent playback collisions
    if (window._qaPlaybackTimeUpdateHandler && audioPlayer) {
      audioPlayer.removeEventListener("timeupdate", window._qaPlaybackTimeUpdateHandler);
      window._qaPlaybackTimeUpdateHandler = null;
    }

    const isResolved = issue.resolution && issue.resolution !== "unresolved";
    const startSec = (issue.start_time !== undefined) ? Number(issue.start_time) : (Number(issue.start_seconds) || 0);
    const endSec = (issue.end_time !== undefined) ? Number(issue.end_time) : (Number(issue.end_seconds) || Math.max(startSec + 0.5, startSec));
    const isShort = (endSec - startSec) < 2.0 || Math.floor(startSec) === Math.floor(endSec);
    const startFmt = isShort ? formatQATime(startSec, 2) : formatTime(startSec);
    const endFmt = isShort ? formatQATime(endSec, 2) : formatTime(endSec);

    qaSelectedDetail.innerHTML = `
      <div class="qa-detail-view">
        <div class="qa-detail-header-card">
          <div class="qa-issue-tags">
            <span class="qa-badge ${issue.severity === 'fail' ? 'qa-badge-fail' : 'qa-badge-review'}">${issue.severity === 'fail' ? 'Lỗi' : 'Cần xem'}</span>
            <span class="qa-badge qa-badge-category">${escapeHtml(qaCategoryVi(issue.category))}</span>
            ${isResolved ? `<span class="qa-badge qa-badge-resolved">ĐÃ XỬ LÝ: ${escapeHtml(qaResolutionVi(issue.resolution))}</span>` : '<span class="qa-badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">CHƯA XỬ LÝ</span>'}
            <span class="qa-time-range" style="margin-left: auto;">${startFmt} - ${endFmt}</span>
          </div>
          <div style="font-size: 0.9rem; color: var(--text-primary); font-weight: 500; margin-top: 4px;">
            ${escapeHtml(issue.description)}
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">
            Đoạn #${issue.chunk_index ?? '--'} · Câu #${issue.sentence_index ?? '--'} · Mã: ${issue.fingerprint.slice(0, 12)}...
          </div>
        </div>

        <div class="qa-diff-box">
          <div class="qa-diff-row expected">
            <div class="qa-diff-label">Kịch bản gốc</div>
            <div class="qa-diff-text">${escapeHtml(issue.expected_text || "—")}</div>
          </div>
          <div class="qa-diff-row actual">
            <div class="qa-diff-label">Kết quả nhận dạng từ âm thanh</div>
            <div class="qa-diff-text">${escapeHtml(issue.recognized_text || "—")}</div>
          </div>
        </div>

        <div class="qa-playback-bar">
          <div class="qa-playback-info">
            <button type="button" id="btn-qa-play-range" class="btn btn-primary btn-sm">
              <svg class="ui-icon"><use href="#icon-play"/></svg>
              <span>Nghe đoạn này</span>
            </button>
            <span class="qa-playback-time">${startFmt} &rarr; ${endFmt}</span>
            <span style="font-size: 0.76rem; color: var(--text-muted);">(kèm ±0.4s ngữ cảnh)</span>
          </div>
        </div>

        <div class="qa-decision-actions">
          <div class="qa-pane-title" style="margin-bottom: 0;">Thao tác giải quyết lỗi</div>
          <div class="qa-decision-row">
            <button type="button" id="btn-qa-accept" class="btn btn-secondary btn-sm qa-btn-action" title="Chấp nhận phát âm này đúng âm vị thực tế">
              <span>✓ Chấp nhận (khớp âm thanh)</span>
            </button>
            <button type="button" id="btn-qa-pronunciation" class="btn btn-secondary btn-sm qa-btn-action" title="Thêm từ này vào Từ điển Phát âm">
              <span>Sửa phát âm</span>
            </button>
            <button type="button" id="btn-qa-rerender-chunk" class="btn btn-secondary btn-sm qa-btn-action" title="Render lại riêng chunk này">
              <span>Render lại đoạn</span>
            </button>
            <button type="button" id="btn-qa-waive" class="btn btn-secondary btn-sm qa-btn-action" title="Bỏ qua cảnh báo này">
              <span>Bỏ qua</span>
            </button>
          </div>
        </div>
      </div>
    `;

    // Attach playback listener
    const playBtn = document.getElementById("btn-qa-play-range");
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        if (!audioPlayer) return;

        const playSelectedSegment = () => {
          const start = Math.max(0, startSec - 0.4);
          const end = Math.max(start + 0.3, endSec + 0.4);

          // Clear any active playback listener
          if (window._qaPlaybackTimeUpdateHandler) {
            audioPlayer.removeEventListener("timeupdate", window._qaPlaybackTimeUpdateHandler);
            window._qaPlaybackTimeUpdateHandler = null;
          }

          const spanEl = playBtn.querySelector("span");
          if (spanEl) spanEl.textContent = "Đang phát...";

          audioPlayer.currentTime = start;
          const p = audioPlayer.play();
          if (p !== undefined) {
            p.catch(err => {
              console.warn("QA range play interrupted:", err);
              if (spanEl) spanEl.textContent = "Nghe đoạn này";
            });
          }

          const onTimeUpdate = () => {
            if (audioPlayer.currentTime >= end) {
              audioPlayer.pause();
              audioPlayer.removeEventListener("timeupdate", onTimeUpdate);
              window._qaPlaybackTimeUpdateHandler = null;
              if (spanEl) spanEl.textContent = "Nghe đoạn này";
            }
          };
          window._qaPlaybackTimeUpdateHandler = onTimeUpdate;
          audioPlayer.addEventListener("timeupdate", onTimeUpdate);
        };

        // If audioPlayer has no valid source yet, load project audio
        if ((!audioPlayer.src || audioPlayer.src === "" || audioPlayer.src.includes("undefined")) && currentProjectDir) {
          audioPlayer.src = `/api/projects/${currentProjectDir}/audio/wav?t=${Date.now()}`;
          audioPlayer.addEventListener("canplay", () => {
            playSelectedSegment();
          }, { once: true });
        } else {
          playSelectedSegment();
        }
      });
    }

    // Attach decision actions
    const btnAccept = document.getElementById("btn-qa-accept");
    if (btnAccept) {
      btnAccept.addEventListener("click", () => acceptQAIssue(issue.fingerprint));
    }

    const btnWaive = document.getElementById("btn-qa-waive");
    if (btnWaive) {
      btnWaive.addEventListener("click", () => waiveQAIssue(issue.fingerprint));
    }

    const btnPron = document.getElementById("btn-qa-pronunciation");
    if (btnPron) {
      btnPron.addEventListener("click", () => {
        switchWorkspace("pronunciation");
        const origInput = document.getElementById("dict-original-input");
        if (origInput && issue.expected_text) {
          origInput.value = issue.expected_text.trim();
          origInput.focus();
        }
      });
    }

    const btnRerender = document.getElementById("btn-qa-rerender-chunk");
    if (btnRerender) {
      btnRerender.addEventListener("click", () => {
        const cIdx = issue.chunk_index != null ? issue.chunk_index : 1;
        showConfirmDialog({
          variant: "warning",
          title: `Render lại Chunk #${cIdx}?`,
          message: `Thao tác này sẽ chỉ tổng hợp lại âm thanh riêng cho Chunk #${cIdx} và tự động ghép lại vào master audio.wav. Các chunk hợp lệ khác vẫn được giữ nguyên. Tiếp tục?`,
          confirmText: "Render lại Chunk",
          cancelText: "Hủy",
          onConfirm: () => rerenderQAChunk(cIdx)
        });
      });
    }
  }

  async function acceptQAIssue(fingerprint) {
    if (!currentProjectDir || !fingerprint) return;
    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/voice-qa/issues/${fingerprint}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "User confirmed acoustic match" })
      });
      if (!res.ok) throw new Error("Không thể lưu quyết định chấp nhận.");
      showNotification("Đã chấp nhận phát âm (Acoustic Match).", "success");
      loadVoiceQA(currentProjectDir, true);
    } catch (err) {
      showNotification(`Lỗi: ${err.message}`, "error");
    }
  }

  async function waiveQAIssue(fingerprint) {
    if (!currentProjectDir || !fingerprint) return;
    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/voice-qa/issues/${fingerprint}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "User waived issue" })
      });
      if (!res.ok) throw new Error("Không thể lưu quyết định bỏ qua.");
      showNotification("Đã bỏ qua mục kiểm định này.", "info");
      loadVoiceQA(currentProjectDir, true);
    } catch (err) {
      showNotification(`Lỗi: ${err.message}`, "error");
    }
  }

  async function rerenderQAChunk(chunkIndex) {
    if (!currentProjectDir) return;
    const chunkId = (typeof chunkIndex === "string" && chunkIndex.startsWith("c_")) ? chunkIndex : `c_${String(chunkIndex).padStart(2, '0')}`;
    showNotification(`Đang render lại Chunk #${chunkId}...`, "info");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/voice/chunks/${encodeURIComponent(chunkId)}/regenerate`, {
        method: "POST"
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = (err.detail && typeof err.detail === "object") ? err.detail.message : (err.detail || "Render lại chunk thất bại.");
        throw new Error(msg);
      }
      showNotification(`Chunk #${chunkIndex} đã được render và ghép lại audio thành công! Đang chạy lại Voice QA...`, "success");
      runVoiceQA(currentProjectDir, false);
    } catch (err) {
      showNotification(`Lỗi render lại chunk: ${err.message}`, "error");
    }
  }

  async function runVoiceQA(dirName, forceTranscribe = false) {
    if (!dirName) return;
    showQAProgress(5, "Khởi động Voice QA...");
    try {
      const res = await fetch(`/api/projects/${dirName}/voice-qa/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_transcribe: forceTranscribe })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể khởi động Voice QA.");
      }
      loadVoiceQA(dirName);
    } catch (err) {
      hideQAProgress();
      showNotification(`Lỗi chạy Voice QA: ${err.message}`, "error");
    }
  }

  async function cancelVoiceQA(dirName) {
    if (!dirName) return;
    try {
      await fetch(`/api/projects/${dirName}/voice-qa/cancel`, { method: "POST" });
      showNotification("Đã yêu cầu hủy Voice QA.", "info");
      hideQAProgress();
      setQaStatus("idle", "Đã hủy");
    } catch (err) {
      console.error("Failed to cancel Voice QA:", err);
    }
  }

  function showQAProgress(pct, msg) {
    if (qaProgressContainer) qaProgressContainer.style.display = "block";
    if (qaProgressPercent) qaProgressPercent.textContent = `${pct}%`;
    if (qaProgressBar) qaProgressBar.style.width = `${pct}%`;
    if (qaProgressMessage) qaProgressMessage.textContent = msg || "Đang kiểm định...";
    if (btnRunVoiceQa) btnRunVoiceQa.disabled = true;
    if (btnCancelVoiceQa) btnCancelVoiceQa.style.display = "inline-flex";
    setQaStatus("running", "Đang phân tích...");
  }

  function hideQAProgress() {
    if (qaProgressContainer) qaProgressContainer.style.display = "none";
    if (btnRunVoiceQa) btnRunVoiceQa.disabled = false;
    if (btnCancelVoiceQa) btnCancelVoiceQa.style.display = "none";
  }

  function updateTimestampGate(qaData) {
    if (!tsQaGateWarning) return;
    if (qaData && (qaData.status === "fail" || qaData.summary?.unresolved_fail_count > 0)) {
      tsQaGateWarning.style.display = "flex";
      if (tsQaGateTitle) tsQaGateTitle.textContent = "Voice QA có lỗi nghiêm trọng";
      if (tsQaGateMsg) tsQaGateMsg.textContent = "Voice QA phát hiện lỗi sai lệch kịch bản. Bạn hãy sửa hoặc xác nhận bỏ qua trước khi tiếp tục.";
      const forceBtn = document.getElementById("btn-force-ts");
      if (forceBtn) forceBtn.style.display = "inline-flex";
    } else if (qaData && qaData.status === "review" && (qaData.summary?.unresolved_review_count > 0)) {
      tsQaGateWarning.style.display = "flex";
      tsQaGateWarning.style.borderColor = "rgba(245, 158, 11, 0.4)";
      tsQaGateWarning.style.background = "rgba(245, 158, 11, 0.08)";
      if (tsQaGateTitle) {
        tsQaGateTitle.textContent = "Voice QA cần kiểm tra";
        tsQaGateTitle.style.color = "#f59e0b";
      }
      if (tsQaGateMsg) tsQaGateMsg.textContent = `Voice QA còn ${qaData.summary.unresolved_review_count} mục cần xem xét. Timestamp vẫn có thể tạo bình thường.`;
      const forceBtn = document.getElementById("btn-force-ts");
      if (forceBtn) forceBtn.style.display = "none";
    } else {
      tsQaGateWarning.style.display = "none";
    }
  }

  async function loadVoiceQA(dirName, autoSelect = true) {
    if (!dirName) return;
    const targetDir = dirName;
    try {
      const res = await fetch(`/api/projects/${dirName}/voice-qa`);
      if (currentProjectDir !== targetDir) return;
      if (!res.ok) return;
      const data = await res.json();
      if (currentProjectDir !== targetDir) return;
      voiceQAData = data;

      if (data.status === "running") {
        showQAProgress(data.progress || 0, data.message || "Đang kiểm định...");
        if (!voiceQAPollTimer) {
          voiceQAPollTimer = setInterval(() => loadVoiceQA(dirName, false), 1500);
        }
        return;
      }

      if (voiceQAPollTimer) {
        clearInterval(voiceQAPollTimer);
        voiceQAPollTimer = null;
      }
      hideQAProgress();
      renderQAMetrics(data);
      renderQAIssues(data.issues || []);
      updateTimestampGate(data);
      updateDependencyState();
    } catch (err) {
      console.error("Failed to load Voice QA:", err);
    }
  }
  window.loadVoiceQA = loadVoiceQA;

  // Filter tabs click listeners
  document.querySelectorAll(".qa-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".qa-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      voiceQAFilter = tab.dataset.filter || "all";
      if (voiceQAData && voiceQAData.issues) {
        renderQAIssues(voiceQAData.issues);
      }
    });
  });

  if (btnRunVoiceQa) {
    btnRunVoiceQa.addEventListener("click", () => {
      if (currentProjectDir) runVoiceQA(currentProjectDir, false);
    });
  }

  if (btnCancelVoiceQa) {
    btnCancelVoiceQa.addEventListener("click", () => {
      if (currentProjectDir) cancelVoiceQA(currentProjectDir);
    });
  }

  if (btnForceVoiceQa) {
    btnForceVoiceQa.addEventListener("click", () => {
      if (currentProjectDir) {
        showConfirmDialog({
          variant: "warning",
          title: "Chạy lại Voice QA (Bỏ qua cache)?",
          message: "Thao tác này sẽ thực hiện nhận dạng ASR Faster-Whisper mới hoàn toàn từ file audio.wav mà không tái sử dụng cache. Tiếp tục?",
          confirmText: "Chạy lại hoàn toàn",
          cancelText: "Hủy",
          onConfirm: () => runVoiceQA(currentProjectDir, true)
        });
      }
    });
  }

  if (btnGotoTimestamp) {
    btnGotoTimestamp.addEventListener("click", () => {
      switchWorkspace("timestamp");
    });
  }

  if (btnForceTs) {
    btnForceTs.addEventListener("click", () => {
      showConfirmDialog({
        variant: "warning",
        title: "Bỏ qua cảnh báo Voice QA?",
        message: "Bạn có chắc chắn muốn bỏ qua các lỗi phát hiện bởi Voice QA và tiếp tục tạo Timestamp không?",
        confirmText: "Xác nhận & Tạo Timestamp",
        cancelText: "Hủy",
        onConfirm: () => doGenerateTimestamps(true)
      });
    });
  }


  // ==============================================================================
  // 9. TIMESTAMPS & SUBTITLES (PHASE 4)
  // ==============================================================================
  function setTsStatus(state, label) {
    tsStatusPill.className = `state-pill state-${state.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    tsStatusPill.textContent = label || state;
    const stepTsBadge = document.getElementById("badge-step-timestamp");
    if (stepTsBadge) {
      if (state === "ready" || state === "completed") {
        stepTsBadge.textContent = "✓";
        stepTsBadge.style.color = "var(--success)";
      } else if (state === "processing" || state === "generating") {
        stepTsBadge.textContent = "◐";
        stepTsBadge.style.color = "var(--accent)";
      }
    }
  }

  async function loadTimestampsForProject(dirName) {
    if (!dirName) return;
    const targetDir = dirName;
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;
    if (tsPollInterval) {
      clearInterval(tsPollInterval);
      tsPollInterval = null;
    }

    try {
      const res = await fetch(`/api/projects/${dirName}/timestamps/status`);
      if (currentProjectDir !== targetDir) return;
      if (!res.ok) return;
      const status = await res.json();
      if (currentProjectDir !== targetDir) return;

      if (status.model) tsModelBadge.textContent = status.model;
      if (status.device) tsDeviceBadge.textContent = status.device.toUpperCase();

      const rawState = (status.state || "").toLowerCase();
      const rawStatus = (status.status || "").toLowerCase();
      const isProcessing = rawStatus === "processing" ||
        ["preparing", "loading_model", "transcribing", "aligning", "writing", "processing"].includes(rawState) ||
        ["preparing", "loading_model", "transcribing", "aligning", "writing"].includes(rawStatus);

      if (status.status === "Ready" || (!isProcessing && rawState === "completed")) {
        setTsStatus("ready", "Sẵn sàng");
        btnGenerateTs.disabled = false;
        btnCancelTs.style.display = "none";
        btnDownloadSrt.disabled = false;
        btnDownloadTsJson.disabled = false;
        tsProgressContainer.style.display = "none";

        const covVal = (status.coverage != null) ? status.coverage : status.coverage_pct;
        if (covVal != null) tsCoverageBadge.textContent = `${Number(covVal).toFixed(1)}%`;
        if (status.total_sentences != null) tsCuesBadge.textContent = `${status.total_sentences}`;
        loadCuesList(dirName);
      } else if (isProcessing) {
        setTsStatus("processing", "Đang xử lý");
        btnGenerateTs.disabled = true;
        btnCancelTs.style.display = "inline-flex";
        btnDownloadSrt.disabled = true;
        btnDownloadTsJson.disabled = true;
        tsProgressContainer.style.display = "flex";
        const pct = (status.progress != null) ? status.progress : ((status.percent != null) ? status.percent : 0);
        tsProgressFill.style.width = `${pct}%`;
        tsProgressPct.textContent = `${pct}%`;
        if (status.message) tsProgressMsg.textContent = status.message;
        pollTimestampStatus(dirName);
      } else {
        setTsStatus("idle", "Chưa tạo");
        btnGenerateTs.disabled = false;
        btnCancelTs.style.display = "none";
        btnDownloadSrt.disabled = true;
        btnDownloadTsJson.disabled = true;
        tsProgressContainer.style.display = "none";
        tsCuesList.innerHTML = `<p class="empty-state">Bấm "Tạo Timestamp" để phân tích câu.</p>`;
      }
    } catch (err) {
      console.error("Failed to load timestamp status:", err);
    }
  }

  function pollTimestampStatus(dirName) {
    if (tsPollInterval) clearInterval(tsPollInterval);
    const targetDir = dirName;
    tsPollInterval = setInterval(async () => {
      if (currentProjectDir !== targetDir) {
        clearInterval(tsPollInterval);
        tsPollInterval = null;
        return;
      }
      try {
        const res = await fetch(`/api/projects/${dirName}/timestamps/status`);
        if (currentProjectDir !== targetDir) return;
        if (!res.ok) return;
        const s = await res.json();
        if (currentProjectDir !== targetDir) return;
        const pct = (s.progress != null) ? s.progress : ((s.percent != null) ? s.percent : 0);
        tsProgressFill.style.width = `${pct}%`;
        tsProgressPct.textContent = `${pct}%`;
        if (s.message) tsProgressMsg.textContent = s.message;
        if (s.elapsed_seconds != null) tsProgressElapsed.textContent = `Đã chạy: ${s.elapsed_seconds}s`;

        const rawState = (s.state || "").toLowerCase();
        const rawStatus = (s.status || "").toLowerCase();
        const isFinished = s.status === "Ready" || rawState === "completed" || s.status === "Failed" || rawState === "failed" || s.status === "Cancelled" || rawState === "cancelled";

        if (isFinished) {
          clearInterval(tsPollInterval);
          tsPollInterval = null;
          if (s.status === "Ready" || rawState === "completed") {
            tsOutdated = false;
            if (projectScenes && projectScenes.length > 0) scenesOutdated = true;
            if (projectVeoShots && projectVeoShots.length > 0) veoOutdated = true;
            updateDependencyState();
            showNotification("Tạo Timestamp thành công!", "success");
          } else if (s.status === "Failed" || rawState === "failed") {
            showNotification(`Lỗi tạo Timestamp: ${s.error || s.message || "Thất bại"}`, "error");
          }
          loadTimestampsForProject(dirName);
          loadScenesForProject(dirName);
        }
      } catch (err) {
        clearInterval(tsPollInterval);
      }
    }, 1000);
  }

  async function loadCuesList(dirName) {
    try {
      const res = await fetch(`/api/projects/${dirName}/timestamps`);
      if (!res.ok) return;
      const data = await res.json();
      const sentences = data.segments || data.sentences || [];
      projectCues = sentences;
      updateDependencyState();
      tsPreviewCount.textContent = `${sentences.length} đoạn`;

      if (sentences.length === 0) {
        tsCuesList.innerHTML = `<p class="empty-state">Không có câu nào được ghi nhận.</p>`;
        return;
      }

      const frag = document.createDocumentFragment();
      sentences.forEach((cue, idx) => {
        const card = document.createElement("div");
        card.className = "cue-card";
        const sFmt = formatTime(cue.start);
        const eFmt = formatTime(cue.end);
        card.innerHTML = `
          <span class="cue-time">${sFmt} - ${eFmt}</span>
          <span class="cue-text">${escapeHtml(cue.text)}</span>
          <button class="cue-play-btn" data-start="${cue.start}" aria-label="Phát đoạn audio lúc ${sFmt}"><svg class="icon" aria-hidden="true"><use href="#icon-play" /></svg></button>
        `;
        frag.appendChild(card);
      });
      tsCuesList.innerHTML = "";
      tsCuesList.appendChild(frag);
    } catch (err) {
      console.error("Failed to load sentences list:", err);
    }
  }

  if (tsCuesList) {
    tsCuesList.addEventListener("click", (e) => {
      const playBtn = e.target.closest(".cue-play-btn");
      if (playBtn) {
        const startTime = parseFloat(playBtn.dataset.start) || 0;
        window.seekGlobalAudio(startTime, `Đoạn audio (${formatTime(startTime)})`);
      }
    });
  }

  async function doGenerateTimestamps(force = false) {
    if (!currentProjectDir) return;
    btnGenerateTs.disabled = true;
    tsErrorAlert.style.display = "none";
    setTsStatus("processing", "Đang xử lý");
    btnCancelTs.style.display = "inline-flex";
    tsProgressContainer.style.display = "flex";
    tsProgressFill.style.width = "0%";
    tsProgressPct.textContent = "0%";
    tsProgressMsg.textContent = "Đang khởi động Whisper Aligner...";
    showNotification("Bắt đầu phân tích và tạo Timestamp...", "info");

    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/timestamps/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: force })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể khởi động aligner.");
      }
      pollTimestampStatus(currentProjectDir);
    } catch (err) {
      tsErrorAlert.style.display = "flex";
      tsErrorText.textContent = err.message;
      btnGenerateTs.disabled = false;
      btnCancelTs.style.display = "none";
      tsProgressContainer.style.display = "none";
      setTsStatus("idle", "Lỗi tạo");
      showNotification(`Lỗi tạo timestamp: ${err.message}`, "error");
    }
  }

  btnGenerateTs.addEventListener("click", () => {
    if (!currentProjectDir) return;

    // Check Voice QA gating: if unresolved FAIL, block and prompt
    if (voiceQAData && (voiceQAData.status === "fail" || voiceQAData.summary?.unresolved_fail_count > 0)) {
      showConfirmDialog({
        variant: "danger",
        title: "Voice QA phát hiện lỗi nghiêm trọng!",
        message: "Voice QA phát hiện lỗi sai lệch kịch bản (FAIL) chưa giải quyết. Bạn nên kiểm tra và khắc phục ở bước Voice QA trước khi tạo Timestamp.\n\nBạn có muốn bỏ qua cảnh báo này và tiếp tục tạo Timestamp không?",
        confirmText: "Bỏ qua & Tiếp tục",
        cancelText: "Xem Voice QA",
        onConfirm: () => doGenerateTimestamps(true),
        onCancel: () => switchWorkspace("voice-qa")
      });
      return;
    }

    if (projectCues && projectCues.length > 0) {
      showConfirmDialog({
        variant: "warning",
        title: "Tạo lại Timestamp (Aligner)?",
        message: "Dự án đã có dữ liệu mốc thời gian phụ đề. Tạo lại timestamp sẽ ghi đè các mốc thời gian hiện tại, các bước Scene Plan và Veo Prompts phía sau sẽ cần được tạo lại để đồng bộ. Tiếp tục?",
        confirmText: "Tạo lại Timestamp",
        cancelText: "Hủy",
        onConfirm: () => doGenerateTimestamps()
      });
      return;
    }
    doGenerateTimestamps();
  });

  btnCancelTs.addEventListener("click", () => {
    if (!currentProjectDir) return;
    showConfirmDialog({
      variant: "warning",
      title: "Hủy tiến trình tạo Timestamp?",
      message: "Bạn có chắc chắn muốn dừng tiến trình căn chỉnh phụ đề Whisper đang chạy?",
      confirmText: "Dừng tiến trình",
      cancelText: "Tiếp tục",
      onConfirm: async () => {
        try {
          await fetch(`/api/projects/${currentProjectDir}/timestamps/cancel`, { method: "POST" });
          showNotification("Đã yêu cầu hủy tiến trình timestamp.", "info");
        } catch (err) {
          console.error("Failed to cancel timestamping:", err);
          showNotification(`Lỗi hủy timestamp: ${err.message}`, "error");
        }
      }
    });
  });

  btnDownloadSrt.addEventListener("click", () => {
    if (currentProjectDir) window.location.href = `/api/projects/${currentProjectDir}/subtitles.srt`;
  });

  btnDownloadTsJson.addEventListener("click", () => {
    if (currentProjectDir) window.location.href = `/api/projects/${currentProjectDir}/timestamps.json`;
  });

  // ==============================================================================
  // 10. SCENE PLANNER (PHASE 5)
  // ==============================================================================
  function setSpStatus(state, label) {
    spStatusPill.className = `state-pill state-${state}`;
    spStatusPill.textContent = label || state;
    const stepScenesBadge = document.getElementById("badge-step-scenes");
    if (stepScenesBadge) {
      if (state === "ready" || state === "completed") {
        stepScenesBadge.textContent = "✓";
        stepScenesBadge.style.color = "var(--success)";
      } else if (state === "generating") {
        stepScenesBadge.textContent = "◐";
        stepScenesBadge.style.color = "var(--accent)";
      }
    }
  }

  async function loadScenesForProject(dirName) {
    if (!dirName) return;
    const targetDir = dirName;
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;

    try {
      const res = await fetch(`/api/projects/${dirName}/scenes`);
      if (currentProjectDir !== targetDir) return;
      if (!res.ok) {
        setSpStatus("idle", "Chưa sẵn sàng");
        btnGenerateScenes.disabled = true;
        btnRefreshScenes.disabled = true;
        btnExportScenesJson.disabled = true;
        btnExportScenesMd.disabled = true;
        return;
      }

      const data = await res.json();
      if (currentProjectDir !== targetDir) return;
      projectScenes = data.scenes || [];
      const status = data.status || "Not Generated";
      const sceneCount = data.scene_count || projectScenes.length;
      const coverage = data.coverage != null ? data.coverage : (sceneCount > 0 ? 100.0 : 0.0);
      const duration = data.audio_duration || 0.0;

      if (spCountBadge) spCountBadge.textContent = `${sceneCount} cảnh`;
      if (spCoverageBadge) spCoverageBadge.textContent = (status === "Not Generated" || sceneCount === 0) ? "Độ phủ 0%" : `Độ phủ ${coverage.toFixed(0)}%`;
      if (spMetaDuration) spMetaDuration.textContent = duration > 0 ? `Thời lượng: ${duration.toFixed(2)}s` : "Thời lượng: --";

      btnGenerateScenes.disabled = false;
      btnRefreshScenes.disabled = false;

      if (status === "Ready") {
        setSpStatus("ready", "Sẵn sàng");
        btnExportScenesJson.disabled = projectScenes.length === 0;
        btnExportScenesMd.disabled = projectScenes.length === 0;
        spStaleAlert.style.display = "none";
      } else if (status === "Stale") {
        setSpStatus("stale", "Cần tạo lại");
        spStaleAlert.style.display = "flex";
        spStaleText.textContent = `Scene Plan đã cũ (${data.stale_reason || 'dữ liệu đã thay đổi'}). Hãy tạo lại để cập nhật.`;
        btnExportScenesJson.disabled = projectScenes.length === 0;
        btnExportScenesMd.disabled = projectScenes.length === 0;
      } else {
        setSpStatus("idle", "Chưa tạo");
        btnExportScenesJson.disabled = true;
        btnExportScenesMd.disabled = true;
        spStaleAlert.style.display = "none";
      }

      renderScenesList(projectScenes);
    } catch (err) {
      console.error("Failed to load project scenes:", err);
      setSpStatus("failed", "Lỗi");
    }
  }

  function renderScenesList(scenes) {
    if (!spTimelineList || !spRowsContainer || !spSelectedDetail) return;
    if (!scenes || scenes.length === 0) {
      spRowsContainer.innerHTML = `<p class="empty-state">Chưa có Scene Plan. Bấm "Tạo Scene Plan" để phân bổ storyboard.</p>`;
      spSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chưa có dữ liệu cảnh</p></div>`;
      if (spRowCountBadge) spRowCountBadge.textContent = "0/0";
      return;
    }

    const q = (spSearchQuery || "").trim().toLowerCase();
    const cat = spFilterCategoryVal || "all";

    const filtered = scenes.filter(sc => {
      if (cat !== "all" && (sc.category || "").toLowerCase() !== cat.toLowerCase()) return false;
      if (!q) return true;
      const matchText = `${sc.index} ${sc.scene_id} ${sc.narration || ''} ${sc.visual_summary || ''} ${sc.image_prompt || ''}`.toLowerCase();
      return matchText.includes(q);
    });

    if (spRowCountBadge) {
      spRowCountBadge.textContent = `${filtered.length}/${scenes.length}`;
    }

    if (filtered.length === 0) {
      spRowsContainer.innerHTML = `<p class="empty-state">Không tìm thấy cảnh phù hợp với bộ lọc.</p>`;
      spSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Không có cảnh nào được chọn</p></div>`;
      return;
    }

    // Ensure selectedSceneId points to a valid item in filtered list
    if (!selectedSceneId || !filtered.some(s => s.scene_id === selectedSceneId)) {
      selectedSceneId = filtered[0].scene_id;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(sc => {
      const row = document.createElement("div");
      // Critical: include both 'sp-scene-card' and 'compact-row' for backwards compatibility
      row.className = `sp-scene-card compact-row ${sc.scene_id === selectedSceneId ? "selected" : ""}`;
      row.id = `sp-card-${sc.scene_id}`;
      row.dataset.sceneId = sc.scene_id;
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `Cảnh ${sc.index}, ${sc.category || 'reconstruction'}`);

      const sFmt = formatTime(sc.start);
      const eFmt = formatTime(sc.end);
      const preview = sc.visual_summary || sc.narration || sc.image_prompt || "";

      row.innerHTML = `
        <div class="row-meta">
          <div class="row-meta-left">
            <span class="sp-scene-num row-id">Cảnh ${sc.index}</span>
            <span class="sp-scene-time row-time">${sFmt} &rarr; ${eFmt}</span>
            <span class="scene-dur-badge">${sc.duration}s</span>
          </div>
          <div class="row-meta-right">
            <span class="cat-badge">${escapeHtml(sc.category || 'reconstruction')}</span>
          </div>
        </div>
        <div class="row-preview">${escapeHtml(preview)}</div>
        ${preview.length > 80 ? `<button type="button" class="btn-toggle-expand" aria-label="Xem thêm hoặc thu gọn">Xem thêm</button>` : ''}
      `;
      frag.appendChild(row);
    });

    spRowsContainer.innerHTML = "";
    spRowsContainer.appendChild(frag);

    const selectedScene = scenes.find(s => s.scene_id === selectedSceneId) || filtered[0];
    renderSelectedSceneDetail(selectedScene);
  }

  // Phase 15B Optimization: Incremental Scene Update (avoids full 79-scene DOM re-render)
  function updateSceneInStateAndDom(sc) {
    if (!sc || !sc.scene_id) return;
    const idx = (projectScenes || []).findIndex(s => s.scene_id === sc.scene_id);
    if (idx !== -1) {
      projectScenes[idx] = Object.assign({}, projectScenes[idx], sc);
    }

    const card = document.getElementById(`sp-card-${sc.scene_id}`);
    if (card) {
      const sFmt = formatTime(sc.start);
      const eFmt = formatTime(sc.end);
      const preview = sc.visual_summary || sc.narration || sc.image_prompt || "";

      card.setAttribute("aria-label", `Cảnh ${sc.index}, ${sc.category || 'reconstruction'}`);
      const catBadge = card.querySelector(".cat-badge");
      if (catBadge) catBadge.textContent = sc.category || 'reconstruction';

      const durBadge = card.querySelector(".scene-dur-badge");
      if (durBadge) durBadge.textContent = `${sc.duration}s`;

      const previewEl = card.querySelector(".row-preview");
      if (previewEl) previewEl.textContent = preview;

      const timeEl = card.querySelector(".sp-scene-time");
      if (timeEl) timeEl.innerHTML = `${sFmt} &rarr; ${eFmt}`;
    }

    if (selectedSceneId === sc.scene_id) {
      const current = idx !== -1 ? projectScenes[idx] : sc;
      renderSelectedSceneDetail(current);
    }
  }

  function renderSelectedSceneDetail(sc) {
    if (!spSelectedDetail) return;
    if (!sc) {
      spSelectedDetail.innerHTML = `<div class="empty-detail-state"><p>Chọn một cảnh từ danh sách bên trái để xem chi tiết</p></div>`;
      return;
    }

    const sFmt = formatTime(sc.start);
    const eFmt = formatTime(sc.end);

    spSelectedDetail.innerHTML = `
      <div class="detail-header-card">
        <div class="detail-identity-row">
          <div class="detail-title-time">
            <span class="sp-scene-num detail-title">Cảnh ${sc.index}</span>
            <span class="sp-scene-time detail-time">${sFmt} &rarr; ${eFmt} (${sc.duration}s)</span>
          </div>
          <div class="detail-tags">
            <span class="cat-badge">${escapeHtml(sc.category || 'reconstruction')}</span>
            <span class="sp-evidence-pill">${escapeHtml(sc.evidence_mode || 'reconstruction')}</span>
            <span class="sp-framing-pill">${escapeHtml(sc.shot_type || 'medium wide')}</span>
            ${sc.continuity_group ? `<span class="veo-pill-tag continuity-tag">${escapeHtml(sc.continuity_group)}</span>` : ''}
          </div>
        </div>
        <div class="detail-actions-bar">
          <button class="btn btn-secondary btn-sm btn-seek-scene uq-playbtn" data-action="seek" data-start="${sc.start}" aria-label="Phát cảnh ${sc.index}">
            <svg class="icon" aria-hidden="true"><use href="#icon-play" /></svg>
            <span>Phát</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-edit-scene" data-action="edit">
            <svg class="icon"><use href="#icon-edit" /></svg>
            <span>Chỉnh sửa</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-regen-scene-veo" data-action="regen-scene-veo" title="Tạo lại các cảnh quay cho cảnh này">
            <svg class="icon"><use href="#icon-refresh" /></svg>
            <span>Tạo lại cảnh quay</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-copy-prompt" data-action="copy-image">
            <svg class="icon"><use href="#icon-export" /></svg>
            <span>Sao chép Prompt</span>
          </button>
        </div>
      </div>

      <div class="detail-prose-card">
        <div class="detail-prose-label">Lời bình Narration</div>
        <div class="detail-prose-content narration-quote">&ldquo;${escapeHtml(sc.narration || '')}&rdquo;</div>
      </div>

      <div class="detail-prose-card">
        <div class="detail-prose-label">Tóm tắt hình ảnh</div>
        <div class="detail-prose-content">${escapeHtml(sc.visual_summary || '')}</div>
      </div>

      <div class="prompt-section-card">
        <div class="prompt-section-header">
          <div class="prompt-header-title-group">
            <span class="prompt-section-title">Prompt hình ảnh</span>
            <span class="prompt-tag">SDXL / Midjourney</span>
          </div>
          <div class="prompt-header-actions">
            <button class="btn btn-secondary btn-sm" data-action="copy-image" title="Sao chép Image Prompt">
              <svg class="icon"><use href="#icon-export" /></svg>
              <span>Sao chép</span>
            </button>
            <button class="btn btn-secondary btn-sm" data-action="edit" title="Chỉnh sửa cảnh">
              <svg class="icon"><use href="#icon-edit" /></svg>
              <span>Sửa</span>
            </button>
          </div>
        </div>
        <div class="prompt-section-content">
          <code>${escapeHtml(sc.image_prompt || '')}</code>
        </div>
      </div>

      ${sc.negative_prompt ? `
      <div class="prompt-section-card negative-prompt-card">
        <div class="prompt-section-header">
          <div class="prompt-header-title-group">
            <span class="prompt-section-title">Prompt loại trừ</span>
            <span class="prompt-tag negative-tag">Loại trừ</span>
          </div>
          <div class="prompt-header-actions">
            <button class="btn btn-secondary btn-sm" data-action="copy-negative" title="Sao chép prompt loại trừ">
              <svg class="icon"><use href="#icon-export" /></svg>
              <span>Sao chép</span>
            </button>
          </div>
        </div>
        <div class="prompt-section-content negative-content">
          <code>${escapeHtml(sc.negative_prompt)}</code>
        </div>
      </div>
      ` : ''}

      <div class="prompt-section-card" id="sp-scene-visual-block" aria-live="polite">
        <div class="prompt-section-header">
          <div class="prompt-header-title-group">
            <span class="prompt-section-title">Sản xuất hình ảnh (Visual)</span>
            <span class="prompt-tag">Phase 13</span>
          </div>
        </div>
        <div class="prompt-section-content"><p class="empty-state">Đang tải visual refs…</p></div>
      </div>
    `;
    loadSceneVisual(sc.scene_id);
    syncPlaybackUI();
  }

  async function loadSceneVisual(sceneId) {
    const targetDir = currentProjectDir;
    const el = document.getElementById("sp-scene-visual-block");
    if (!targetDir || !el) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetDir)}/scenes/${encodeURIComponent(sceneId)}/visual`);
      if (currentProjectDir !== targetDir || !res.ok) return;
      const data = await res.json();
      if (currentProjectDir !== targetDir || selectedSceneId !== sceneId) return;
      const sc = data.scene || {};
      const entry = data.visualEntry;
      const eff = data.effectiveOutputType || data.recommendedOutputType;
      const tag = (t) => `<span class="vb-tag">${escapeHtml(t)}</span>`;
      el.querySelector(".prompt-section-content").innerHTML = `
        <div class="prod-history-meta" title="category = phân loại dựng hình gốc; visualType = loại visual sản xuất; output = cách sản xuất clip">Loại dựng: ${escapeHtml(data.scene?.category || sc.category || "—")} · Visual: ${escapeHtml(sc.visualType || "—")} · Sản xuất: ${escapeHtml(eff || "—")}</div>
        <div class="prod-readiness-list">
          <div class="prod-readiness-row"><span>Loại visual</span><span class="prod-readiness-val is-ok">${escapeHtml(sc.visualType || "—")}</span></div>
          <div class="prod-readiness-row"><span>Chủ thể / nhóm</span><span>${(sc.subjectIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Nhân vật đại diện</span><span>${(sc.characterIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Bối cảnh</span><span>${sc.environmentId ? tag(sc.environmentId) : "—"}</span></div>
          <div class="prod-readiness-row"><span>Vật thể</span><span>${(sc.objectIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Đề xuất</span><span title="${escapeHtml((data.recommendationReasons || []).join("; "))}">${escapeHtml(data.recommendedOutputType || "—")}</span></div>
          <div class="prod-readiness-row"><span>Sản xuất chọn</span>
            <select id="sp-visual-override" class="form-select form-input-sm" aria-label="Loại sản xuất đã chọn">
              <option value="">Theo đề xuất (${escapeHtml(data.recommendedOutputType || "")})</option>
              ${["STATIC_IMAGE", "EDITOR_MOTION", "VEO"].map(o => `<option value="${o}" ${sc.selectedOutputType === o ? "selected" : ""}>${o}</option>`).join("")}
            </select>
          </div>
          <div class="prod-readiness-row"><span>Hiệu lực</span><span class="prod-readiness-val is-ok">${escapeHtml(eff || "—")}</span></div>
          <div class="prod-readiness-row"><span>Prompt hình ảnh</span><span>${(function(){ const st = entry ? entry.status : "NOT_STARTED"; return window.I18N ? window.I18N.renderBadge(st) : escapeHtml(st); })()}</span></div>
          <div class="prod-readiness-row"><span>Gán cast (IDs, cách nhau bởi dấu phẩy)</span>
            <span><input id="sp-cast-edit" class="form-input form-input-sm" value="${escapeHtml((sc.characterIds || []).join(", "))}" aria-label="Mã nhân vật" style="min-width: 12rem;">
            <button class="btn btn-secondary btn-sm" id="sp-cast-save-btn"><span>Lưu cast</span></button></span>
          </div>
        </div>
        ${entry ? `<div class="prompt-section-content" style="margin-top:0.5rem;"><code style="white-space:pre-wrap;">${escapeHtml(entry.prompt || "")}</code>
          <div style="margin-top:0.4rem;"><button class="btn btn-secondary btn-sm" id="sp-visual-copy-btn"><span>Sao chép Visual Prompt</span></button></div></div>` : ""}
        ${(data.veoInheritance || []).length ? `<div class="prod-history-meta" style="margin-top:0.4rem;">Veo kế thừa: ${(data.veoInheritance || []).map(v => `${escapeHtml(v.shotId)}→${escapeHtml(v.continuityStrategy)}${v.outdated ? " (cũ)" : ""}`).join(" · ")}</div>` : ""}`;
      const ov = document.getElementById("sp-visual-override");
      if (ov) ov.addEventListener("change", async () => {
        if (!currentProjectDir) return;
        // Corrective §48: empty = reset to AUTO (explicit null clears override).
        const val = ov.value || null;
        const r = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/scenes/${encodeURIComponent(sceneId)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOutputType: val })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          showNotification("Lỗi override: " + (e.detail || "thất bại"), "error");
          return;
        }
        const resData = await r.json().catch(() => ({}));
        showNotification(val ? "Đã lưu loại sản xuất (cập nhật tức thời)." : "Đã reset theo đề xuất.", "success");
        if (resData && resData.scene) {
          updateSceneInStateAndDom(resData.scene);
        } else {
          loadScenesForProject(currentProjectDir);
        }
        loadSceneVisual(sceneId);
      });
      const castSave = document.getElementById("sp-cast-save-btn");
      if (castSave) castSave.addEventListener("click", async () => {
        if (!currentProjectDir) return;
        const raw = document.getElementById("sp-cast-edit")?.value || "";
        const ids = raw.split(",").map(s => s.trim()).filter(Boolean);
        const r = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/scenes/${encodeURIComponent(sceneId)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterIds: ids })
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          showNotification("Lỗi gán cast: " + (e.detail || "thất bại"), "error");
          return;
        }
        const resData = await r.json().catch(() => ({}));
        showNotification("Đã lưu cast (cập nhật tức thời).", "success");
        if (resData && resData.scene) {
          updateSceneInStateAndDom(resData.scene);
        }
        loadSceneVisual(sceneId);
        refreshDependencyStatus(currentProjectDir);
      });
      const cp = document.getElementById("sp-visual-copy-btn");
      if (cp && entry) cp.addEventListener("click", () => {
        if (navigator.clipboard) navigator.clipboard.writeText(entry.prompt || "")
          .then(() => showNotification("Đã sao chép Visual Prompt.", "success"));
      });
    } catch (err) {
      console.warn("Failed to load scene visual:", err);
    }
  }

  function selectSceneById(sceneId) {
    if (selectedSceneId === sceneId) return;
    selectedSceneId = sceneId;
    if (spRowsContainer) {
      spRowsContainer.querySelectorAll(".compact-row").forEach(r => {
        if (r.dataset.sceneId === sceneId) {
          r.classList.add("selected");
          r.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
          r.classList.remove("selected");
        }
      });
    }
    const scene = projectScenes.find(s => s.scene_id === sceneId);
    if (scene) renderSelectedSceneDetail(scene);
  }
  window.selectSceneById = selectSceneById;
  window.getProjectScenes = () => projectScenes;

  // Row selection in Scene List
  if (spRowsContainer) {
    spRowsContainer.addEventListener("click", (e) => {
      const expandBtn = e.target.closest(".btn-toggle-expand");
      if (expandBtn) {
        e.stopPropagation();
        const row = expandBtn.closest(".compact-row");
        const preview = row ? row.querySelector(".row-preview") : null;
        if (preview) {
          preview.classList.toggle("expanded");
          expandBtn.textContent = preview.classList.contains("expanded") ? "Thu gọn" : "Xem thêm";
        }
        return;
      }

      const row = e.target.closest(".compact-row");
      if (!row) return;
      const sceneId = row.dataset.sceneId;
      selectSceneById(sceneId);
      const scene = projectScenes.find(s => s.scene_id === sceneId);
      if (scene) {
        window.seekGlobalAudio(scene.start, `Cảnh ${scene.index}`);
      }
    });

    spRowsContainer.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = Array.from(spRowsContainer.querySelectorAll(".compact-row"));
        if (rows.length === 0) return;
        const curIdx = rows.findIndex(r => r.dataset.sceneId === selectedSceneId);
        let targetIdx = curIdx;
        if (e.key === "ArrowDown") {
          targetIdx = Math.min(rows.length - 1, curIdx + 1);
        } else if (e.key === "ArrowUp") {
          targetIdx = Math.max(0, curIdx - 1);
        }
        if (targetIdx !== curIdx && targetIdx >= 0) {
          const targetId = rows[targetIdx].dataset.sceneId;
          selectSceneById(targetId);
          rows[targetIdx].focus();
        }
      }
    });
  }

  // Detail Actions in Scene Selected Detail Pane
  if (spSelectedDetail) {
    spSelectedDetail.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const scene = projectScenes.find(s => s.scene_id === selectedSceneId);
      if (!scene) return;

      if (action === "seek") {
        window.seekGlobalAudio(scene.start, `Cảnh ${scene.index} (${formatTime(scene.start)})`);
      } else if (action === "copy" || action === "copy-image") {
        await copyTextToClipboard(scene.image_prompt, btn);
      } else if (action === "copy-negative") {
        await copyTextToClipboard(scene.negative_prompt, btn);
      } else if (action === "regen-scene-veo") {
        doRegenerateSceneVeo(scene.scene_id);
      } else if (action === "edit") {
        openEditSceneModal(scene);
      }
    });
  }

  // Search & Filter event handlers for Scene Planner (debounced 100ms)
  if (spSearchInput) {
    spSearchInput.addEventListener("input", debounce(() => {
      spSearchQuery = spSearchInput.value.trim().toLowerCase();
      renderScenesList(projectScenes);
    }, 100));
  }

  if (spFilterCategory) {
    spFilterCategory.addEventListener("change", () => {
      spFilterCategoryVal = spFilterCategory.value;
      renderScenesList(projectScenes);
    });
  }

  function openEditSceneModal(scene) {
    if (!spEditModal) return;
    editingSceneId = scene.scene_id;
    if (spModalTitle) spModalTitle.textContent = `Chỉnh sửa cảnh ${scene.index} (${scene.scene_id})`;
    if (spEditCategory) spEditCategory.value = scene.category || "reconstruction";
    if (spEditEvidence) spEditEvidence.value = scene.evidence_mode || "reconstruction";
    if (spEditShotType) spEditShotType.value = scene.shot_type || "medium wide";
    if (spEditCameraMotion) spEditCameraMotion.value = scene.camera_motion || "static";
    if (spEditContinuity) spEditContinuity.value = scene.continuity_group || "";
    if (spEditSummary) spEditSummary.value = scene.visual_summary || "";
    if (spEditPrompt) spEditPrompt.value = scene.image_prompt || "";
    if (spEditNegativePrompt) spEditNegativePrompt.value = scene.negative_prompt || "";
    spEditModal.style.display = "flex";
    spEditModal.classList.add("open");
    uqOpenModals.push({ el: spEditModal, trigger: document.activeElement });
    uqLockBody();
    trapFocus(spEditModal);
  }

  function closeEditSceneModal() {
    uqModalClose(spEditModal);
    editingSceneId = null;
  }

  if (spModalCloseBtn) spModalCloseBtn.addEventListener("click", closeEditSceneModal);
  if (spModalCancelBtn) spModalCancelBtn.addEventListener("click", closeEditSceneModal);

  if (spModalSaveBtn) {
    spModalSaveBtn.addEventListener("click", async () => {
      if (!currentProjectDir || !editingSceneId) return;
      spModalSaveBtn.disabled = true;
      spModalSaveBtn.textContent = "Đang lưu...";

      const payload = {
        category: spEditCategory ? spEditCategory.value : "reconstruction",
        evidence_mode: spEditEvidence ? spEditEvidence.value : "reconstruction",
        shot_type: spEditShotType ? spEditShotType.value : "medium wide",
        camera_motion: spEditCameraMotion ? spEditCameraMotion.value : "static",
        continuity_group: (spEditContinuity && spEditContinuity.value.trim()) ? spEditContinuity.value.trim() : null,
        visual_summary: spEditSummary ? spEditSummary.value.trim() : "",
        image_prompt: spEditPrompt ? spEditPrompt.value.trim() : "",
        negative_prompt: spEditNegativePrompt ? spEditNegativePrompt.value.trim() : ""
      };

      try {
        const res = await fetch(`/api/projects/${currentProjectDir}/scenes/${editingSceneId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Không thể cập nhật scene.");
        }
        const resData = await res.json().catch(() => ({}));
        closeEditSceneModal();
        if (resData && resData.scene) {
          updateSceneInStateAndDom(resData.scene);
          showNotification("Đã cập nhật cảnh thành công (tối ưu tức thì).", "success");
        } else {
          await loadScenesForProject(currentProjectDir);
        }
      } catch (err) {
        showNotification(`Lỗi lưu: ${err.message}`, "error");
      } finally {
        spModalSaveBtn.disabled = false;
        spModalSaveBtn.textContent = "Lưu thay đổi";
      }
    });
  }

  async function doGenerateScenes() {
    if (!currentProjectDir) return;
    btnGenerateScenes.disabled = true;
    if (spErrorAlert) spErrorAlert.style.display = "none";
    setSpStatus("generating", "Đang tạo");

    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/scenes/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo Scene Plan.");
      }
      scenesOutdated = false;
      if (projectVeoShots && projectVeoShots.length > 0) veoOutdated = true;
      updateDependencyState();
      await loadScenesForProject(currentProjectDir);
    } catch (err) {
      if (spErrorAlert) {
        spErrorAlert.style.display = "flex";
        spErrorText.textContent = err.message;
      }
      setSpStatus("failed", "Thất bại");
      showNotification(`Lỗi tạo Scene Plan: ${err.message}`, "error");
    } finally {
      btnGenerateScenes.disabled = false;
    }
  }

  btnGenerateScenes.addEventListener("click", () => {
    if (!currentProjectDir) return;
    if (projectScenes.length > 0) {
      const hasEdits = projectScenes.some(s => s.status === "edited");
      const msg = hasEdits
        ? "Bạn đã chỉnh sửa cảnh thủ công. Phiên bản hiện tại sẽ được lưu trữ (archive) trước khi tạo lại. Bạn có chắc chắn muốn tiếp tục?"
        : "Scene Plan hiện tại sẽ được thay thế (bản sao lưu tự động sẽ được giữ lại). Bước Veo Prompts phía sau sẽ cần tạo lại. Tiếp tục?";
      showConfirmDialog({
        variant: "warning",
        title: "Tạo lại Scene Plan?",
        message: msg,
        confirmText: "Tạo lại Scene Plan",
        cancelText: "Hủy",
        onConfirm: () => doGenerateScenes()
      });
      return;
    }
    doGenerateScenes();
  });

  btnRefreshScenes.addEventListener("click", () => {
    if (currentProjectDir) loadScenesForProject(currentProjectDir);
  });

  // P1 (§12): export navigation có feedback (toast), không im lặng.
  function downloadWithFeedback(url, label) {
    if (!currentProjectDir || !url) return;
    showNotification(`Đang tải ${label}…`, "info");
    window.location.href = url;
  }
  btnExportScenesJson.addEventListener("click", () => {
    downloadWithFeedback(`/api/projects/${currentProjectDir}/scenes/prompts.json`, "tệp JSON Scene Plan");
  });

  btnExportScenesMd.addEventListener("click", () => {
    downloadWithFeedback(`/api/projects/${currentProjectDir}/scenes/prompts.md`, "tệp Markdown Scene Plan");
  });

  // ==============================================================================
  // 11. VEO PROMPT GENERATOR (PHASE 6)
  // ==============================================================================
  function setVeoStatus(state, label) {
    veoStatusPill.className = `state-pill state-${state}`;
    veoStatusPill.textContent = label || state;
    const stepVeoBadge = document.getElementById("badge-step-veo");
    if (stepVeoBadge) {
      if (state === "ready" || state === "completed") {
        stepVeoBadge.textContent = "✓";
        stepVeoBadge.style.color = "var(--success)";
      } else if (state === "generating") {
        stepVeoBadge.textContent = "◐";
        stepVeoBadge.style.color = "var(--accent)";
      }
    }
  }

  async function loadVeoForProject(dirName) {
    if (!dirName) return;
    const targetDir = dirName;
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;

    try {
      const res = await fetch(`/api/projects/${dirName}/veo`);
      if (currentProjectDir !== targetDir) return;
      if (!res.ok) {
        setVeoStatus("idle", "Chưa sẵn sàng");
        btnGenerateVeo.disabled = true;
        btnRefreshVeo.disabled = true;
        btnExportVeoJson.disabled = true;
        btnExportVeoMd.disabled = true;
        return;
      }

      const data = await res.json();
      if (currentProjectDir !== targetDir) return;
      projectVeoShots = data.shots || [];
      window.currentVeoPlan = data;
      const status = data.status || "Not Generated";
      const shotCount = data.shot_count || projectVeoShots.length;
      const coverage = data.coverage != null ? data.coverage : (shotCount > 0 ? 100.0 : 0.0);
      const duration = data.audio_duration || 0.0;

      if (veoCountBadge) veoCountBadge.textContent = `${shotCount} cảnh quay`;
      if (veoCoverageBadge) veoCoverageBadge.textContent = (status === "Not Generated" || shotCount === 0) ? "Độ phủ 0%" : `Độ phủ ${coverage.toFixed(0)}% thời lượng`;
      if (veoMetaDuration) veoMetaDuration.textContent = duration > 0 ? `Thời lượng: ${duration.toFixed(2)}s` : "Thời lượng: --";

      btnGenerateVeo.disabled = false;
      btnRefreshVeo.disabled = false;

      if (status === "Ready") {
        setVeoStatus("completed", "Sẵn sàng");
        btnExportVeoJson.disabled = projectVeoShots.length === 0;
        btnExportVeoMd.disabled = projectVeoShots.length === 0;
        veoStaleAlert.style.display = "none";
      } else if (status === "Stale") {
        setVeoStatus("stale", "Cần tạo lại");
        veoStaleAlert.style.display = "flex";
        veoStaleText.textContent = `Veo Prompt đã cũ (${data.stale_reason || 'dữ liệu đã thay đổi'}). Hãy tạo lại để cập nhật.`;
        // P0.2: refresh may replace this with the granular partial message.
        refreshDependencyStatus(dirName);
        btnExportVeoJson.disabled = projectVeoShots.length === 0;
        btnExportVeoMd.disabled = projectVeoShots.length === 0;
      } else {
        setVeoStatus("idle", "Chưa tạo");
        btnExportVeoJson.disabled = true;
        btnExportVeoMd.disabled = true;
        veoStaleAlert.style.display = "none";
      }

      renderVeoShotsList(projectVeoShots);
      loadProductionStatus(targetDir);
    } catch (err) {
      console.error("Failed to load project Veo prompts:", err);
      window.__lastVeoError = (err && err.stack) || String(err);
      setVeoStatus("failed", "Lỗi");
    }
  }

  // ==========================================================================
  // PRODUCTION EXPORT / FLOW HANDOFF (Phase 11 — contextual to Veo workspace)
  // ==========================================================================
  const PROD_READINESS_LABELS = [
    ["audio", "Audio"],
    ["voiceQa", "Voice QA"],
    ["timestamp", "Timestamp"],
    ["scenePlan", "Scene Plan"],
    ["visualContinuity", "Visual Continuity"],
    ["veo", "Veo Prompt"],
  ];

  function clearProductionCard() {
    productionStatus = null;
    productionExporting = false;
    lastExportPath = null;
    if (prodStatusBadge) {
      prodStatusBadge.className = "state-pill state-idle";
      prodStatusBadge.textContent = "CHƯA SẴN SÀNG";
    }
    if (prodSceneCount) prodSceneCount.textContent = "0";
    if (prodShotCount) prodShotCount.textContent = "0";
    if (prodBlockerCount) prodBlockerCount.textContent = "0";
    if (prodReadinessList) prodReadinessList.innerHTML = "";
    if (prodBlockersList) {
      prodBlockersList.style.display = "none";
      prodBlockersList.innerHTML = "";
    }
    if (prodResult) {
      prodResult.style.display = "none";
      prodResult.innerHTML = "";
    }
    if (prodResultActions) prodResultActions.style.display = "none";
    if (btnProductionExport) btnProductionExport.disabled = true;
    if (prodHistoryList) prodHistoryList.innerHTML = `<p class="empty-state">Chưa có lần xuất nào.</p>`;
  }
  window.clearProductionCard = clearProductionCard;

  function renderProductionStatus(data) {
    if (!data) {
      clearProductionCard();
      return;
    }
    productionStatus = data;
    if (prodSceneCount) prodSceneCount.textContent = String(data.sceneCount || 0);
    if (prodShotCount) prodShotCount.textContent = String(data.shotCount || 0);
    if (prodBlockerCount) prodBlockerCount.textContent = String(data.blockerCount || 0);
    if (prodStatusBadge) {
      if (data.ready) {
        prodStatusBadge.className = "state-pill state-pass";
        prodStatusBadge.textContent = "SẴN SÀNG SẢN XUẤT";
      } else {
        prodStatusBadge.className = "state-pill state-fail";
        prodStatusBadge.textContent = "CHƯA SẴN SÀNG";
      }
    }
    if (prodReadinessList) {
      const readiness = data.readiness || {};
      prodReadinessList.innerHTML = PROD_READINESS_LABELS.map(([key, label]) => {
        const val = String(readiness[key] || "—").toUpperCase();
        const ok = (val === "READY" || val === "PASS");
        return `<div class="prod-readiness-row"><span>${label}</span>` +
          `<span class="prod-readiness-val ${ok ? "is-ok" : "is-bad"}">${ok ? "✓" : "✕"} ${val}</span></div>`;
      }).join("");
    }
    if (prodBlockersList) {
      const blockers = data.blockers || [];
      if (blockers.length > 0) {
        prodBlockersList.style.display = "block";
        prodBlockersList.innerHTML = `<div class="prod-blockers-title">Lỗi chặn (${blockers.length}):</div>` +
          "<ul>" + blockers.map(b => `<li>${String(b).replace(/</g, "&lt;")}</li>`).join("") + "</ul>";
      } else {
        prodBlockersList.style.display = "none";
        prodBlockersList.innerHTML = "";
      }
    }
    if (btnProductionExport) btnProductionExport.disabled = productionExporting;
    renderProductionHistory(data.exports || []);
  }

  function renderProductionHistory(exports) {
    if (!prodHistoryList) return;
    if (!exports || exports.length === 0) {
      prodHistoryList.innerHTML = `<p class="empty-state">Chưa có lần xuất nào.</p>`;
      return;
    }
    prodHistoryList.innerHTML = exports.map(e => {
      const when = e.createdAt ? new Date(e.createdAt).toLocaleString("vi-VN") : "—";
      const snap = e.snapshot === "OLDER SNAPSHOT"
        ? `<span class="prod-snapshot-stale">Bản cũ</span>` : "";
      return `<div class="prod-history-item"><div><strong>${e.exportId}</strong> ${snap}<br>` +
        `<span class="prod-history-meta">${when} · ${e.sceneCount} cảnh · ${e.shotCount} cảnh quay</span></div></div>`;
    }).join("");
  }

  async function loadProductionStatus(dirName) {
    if (!dirName) {
      clearProductionCard();
      return;
    }
    const targetDir = dirName;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/production/status`);
      if (currentProjectDir !== targetDir) return; // async ownership guard
      if (!res.ok) {
        clearProductionCard();
        return;
      }
      const data = await res.json();
      if (currentProjectDir !== targetDir) return; // async ownership guard
      renderProductionStatus(data);
    } catch (err) {
      console.warn("Failed to load production status:", err);
    }
  }
  window.loadProductionStatus = loadProductionStatus;

  async function runProductionExport() {
    if (!currentProjectDir || productionExporting) return;
    const targetDir = currentProjectDir;
    if (prodResult) prodResult.style.display = "none";
    if (prodResultActions) prodResultActions.style.display = "none";
    // Client-side gate: surface exact blockers without a futile server call.
    if (!productionStatus || !productionStatus.ready) {
      const blockers = (productionStatus && productionStatus.blockers) || ["Dự án chưa sẵn sàng sản xuất."];
      if (prodResult) {
        prodResult.style.display = "block";
        prodResult.className = "prod-result is-error";
        prodResult.innerHTML = `<strong>Không thể xuất gói sản xuất</strong><ul>` +
          blockers.map(b => `<li>${String(b).replace(/</g, "&lt;")}</li>`).join("") + "</ul>";
      }
      showNotification("Không thể xuất gói sản xuất.", "error");
      return;
    }
    productionExporting = true;
    if (btnProductionExport) {
      btnProductionExport.disabled = true;
      btnProductionExport.querySelector("span").textContent = "Đang xuất...";
    }
    if (prodResult) prodResult.style.display = "none";
    if (prodResultActions) prodResultActions.style.display = "none";
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetDir)}/production/export`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (currentProjectDir !== targetDir) return; // async ownership guard (§58)
      if (!res.ok) {
        const blockers = (payload.detail && payload.detail.blockers) || [payload.detail || "Không thể xuất gói sản xuất."];
        if (prodResult) {
          prodResult.style.display = "block";
          prodResult.className = "prod-result is-error";
          prodResult.innerHTML = `<strong>Không thể xuất gói sản xuất</strong><ul>` +
            blockers.map(b => `<li>${String(b).replace(/</g, "&lt;")}</li>`).join("") + "</ul>";
        }
        showNotification("Không thể xuất gói sản xuất.", "error");
      } else {
        lastExportPath = payload.exportPath || null;
        if (prodResult) {
          prodResult.style.display = "block";
          prodResult.className = "prod-result is-ok";
          prodResult.innerHTML = `<strong>Xuất gói sản xuất thành công</strong><br>` +
            `${payload.sceneCount} cảnh · ${payload.shotCount} cảnh quay<br>` +
            `<span class="prod-history-meta">Audio ✓ · Subtitle ✓ · Prompt Pack ✓ · Manifest ✓ · Checklist ✓</span>`;
        }
        if (prodResultActions) prodResultActions.style.display = "flex";
        showNotification(`Xuất gói sản xuất thành công (${payload.exportId}).`, "success");
      }
    } catch (err) {
      if (currentProjectDir !== targetDir) return;
      if (prodResult) {
        prodResult.style.display = "block";
        prodResult.className = "prod-result is-error";
        prodResult.textContent = `Không thể xuất gói sản xuất: ${err.message}`;
      }
    } finally {
      productionExporting = false;
      if (btnProductionExport && currentProjectDir === targetDir) {
        btnProductionExport.querySelector("span").textContent = "Xuất gói sản xuất";
      }
      if (currentProjectDir === targetDir) loadProductionStatus(targetDir);
    }
  }

  async function openProductionExportFolder() {
    if (!currentProjectDir || !productionStatus || !productionStatus.latestExport) {
      showNotification("Chưa có gói sản xuất nào để mở.", "warning");
      return;
    }
    const exportId = productionStatus.latestExport.exportId;
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(currentProjectDir)}/production/exports/${encodeURIComponent(exportId)}/open`,
        { method: "POST" });
      const data = await res.json();
      if (!data.opened) {
        showNotification(`Không mở được Explorer. Đường dẫn: ${data.path}`, "warning");
      }
    } catch (err) {
      showNotification(`Lỗi mở thư mục: ${err.message}`, "error");
    }
  }

  function copyProductionExportPath() {
    const path = lastExportPath || (productionStatus && productionStatus.latestExport && productionStatus.latestExport.path);
    if (!path) {
      showNotification("Chưa có đường dẫn export.", "warning");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(path)
        .then(() => showNotification("Đã sao chép đường dẫn.", "success"))
        .catch(() => showNotification(path, "info"));
    } else {
      showNotification(path, "info");
    }
  }

  function renderVeoShotsList(shots) {
    if (!veoTimelineList || !veoRowsContainer || !veoSelectedDetail) return;
    if (!shots || shots.length === 0) {
      veoRowsContainer.innerHTML = `<p class="empty-state">Chưa có Veo Prompt. Bấm "Tạo Veo Prompt" để dựng prompt video.</p>`;
      veoSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chưa có dữ liệu cảnh quay</p></div>`;
      if (veoRowCountBadge) veoRowCountBadge.textContent = "0/0";
      return;
    }

    const q = (veoSearchQuery || "").trim().toLowerCase();
    const tone = veoFilterToneVal || "all";

    const filtered = shots.filter(sh => {
      if (tone !== "all" && (sh.tone || "").toLowerCase() !== tone.toLowerCase()) return false;
      if (!q) return true;
      const matchText = `${sh.index} ${sh.shot_id} ${sh.narration || ''} ${sh.subject_action || ''} ${sh.veo_prompt || ''}`.toLowerCase();
      return matchText.includes(q);
    });

    if (veoRowCountBadge) {
      veoRowCountBadge.textContent = `${filtered.length}/${shots.length}`;
    }

    if (filtered.length === 0) {
      veoRowsContainer.innerHTML = `<p class="empty-state">Không tìm thấy cảnh quay phù hợp với bộ lọc.</p>`;
      veoSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Không có cảnh quay nào được chọn</p></div>`;
      return;
    }

    // Ensure selectedShotId points to a valid item in filtered list
    if (!selectedShotId || !filtered.some(s => s.shot_id === selectedShotId)) {
      selectedShotId = filtered[0].shot_id;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(sh => {
      const row = document.createElement("div");
      // Critical: include both 'veo-shot-card' and 'compact-row' for backwards compatibility
      row.className = `veo-shot-card compact-row ${sh.shot_id === selectedShotId ? "selected" : ""}`;
      row.id = `veo-card-${sh.shot_id}`;
      row.dataset.shotId = sh.shot_id;
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `Cảnh quay ${sh.index}, ${veoToneVi(sh.tone)}`);

      const sFmt = formatTime(sh.start);
      const eFmt = formatTime(sh.end);
      const preview = sh.subject_action || sh.narration || sh.veo_prompt || "";

      row.innerHTML = `
        <div class="row-meta">
          <div class="row-meta-left">
            <span class="veo-shot-num row-id">Cảnh quay ${sh.index}</span>
            <span class="veo-shot-time row-time">${sFmt} &rarr; ${eFmt}</span>
            <span class="shot-dur-badge">${sh.duration ? `${sh.duration}s` : '--'}</span>
          </div>
          <div class="row-meta-right">
            <span class="tone-tag">${escapeHtml(veoToneVi(sh.tone))}</span>
          </div>
        </div>
        <div class="row-preview">${escapeHtml(preview)}</div>
        ${preview.length > 80 ? `<button type="button" class="btn-toggle-expand" aria-label="Xem thêm hoặc thu gọn">Xem thêm</button>` : ''}
      `;
      frag.appendChild(row);
    });

    veoRowsContainer.innerHTML = "";
    veoRowsContainer.appendChild(frag);

    const selectedShot = shots.find(s => s.shot_id === selectedShotId) || filtered[0];
    renderSelectedShotDetail(selectedShot);
  }

  function renderSelectedShotDetail(sh) {
    if (!veoSelectedDetail) return;
    if (!sh) {
      veoSelectedDetail.innerHTML = `<div class="empty-detail-state"><p>Chọn một cảnh quay từ danh sách bên trái để xem chi tiết</p></div>`;
      return;
    }

    const sFmt = formatTime(sh.start);
    const eFmt = formatTime(sh.end);
    const splitInfo = (sh.shot_split_total && sh.shot_split_total > 1)
      ? `Cảnh ${sh.parent_scene_index} (Cảnh quay ${sh.shot_split_index}/${sh.shot_split_total})`
      : `Cảnh ${sh.parent_scene_index}`;

    veoSelectedDetail.innerHTML = `
      <div class="detail-header-card">
        <div class="detail-identity-row">
          <div class="detail-title-time">
            <span class="veo-shot-num detail-title">Cảnh quay ${sh.index} &bull; ${escapeHtml(sh.shot_id)}</span>
            <span class="veo-shot-parent detail-subtitle">${escapeHtml(splitInfo)}</span>
            <span class="veo-shot-time detail-time">${sFmt} &rarr; ${eFmt} (${sh.duration}s)</span>
          </div>
          <div class="detail-tags">
            <span class="veo-pill-tag purpose-tag">${escapeHtml(sh.shotPurpose || sh.shot_purpose || 'ESTABLISH')}</span>
            <span class="veo-pill-tag tone-tag">${escapeHtml(veoToneVi(sh.tone))}</span>
            <span class="veo-pill-tag aspect-tag">${escapeHtml(sh.aspect_ratio || '16:9')}</span>
            ${sh.continuity_anchor ? `<span class="veo-pill-tag continuity-tag">${escapeHtml(sh.continuity_anchor)}</span>` : ''}
          </div>
        </div>
        <div class="detail-actions-bar">
          <button class="btn btn-secondary btn-sm btn-seek-shot uq-playbtn" data-action="seek" data-start="${sh.start}" aria-label="Phát cảnh quay ${sh.index} từ đây">
            <svg class="icon" aria-hidden="true"><use href="#icon-play" /></svg>
            <span>Phát từ đây</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-edit-veo-shot" data-action="edit">
            <svg class="icon"><use href="#icon-edit" /></svg>
            <span>Chỉnh sửa Prompt</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-regen-parent-scene" data-action="regen-parent-scene" title="Tạo lại các cảnh quay cho cảnh này">
            <svg class="icon"><use href="#icon-refresh" /></svg>
            <span>Tạo lại Scene</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-copy-veo-prompt" data-action="copy">
            <svg class="icon"><use href="#icon-export" /></svg>
            <span>Sao chép Prompt</span>
          </button>
        </div>
      </div>

      <div class="detail-prose-card">
        <div class="detail-prose-label">Lời bình Narration</div>
        <div class="detail-prose-content narration-quote">&ldquo;${escapeHtml(sh.narration || '')}&rdquo;</div>
      </div>

      <div class="detail-prose-card veo-action-details">
        <div class="detail-prose-label">Chi tiết kịch bản thị giác</div>
        <div class="veo-action-row">
          <span class="veo-action-label">Hành động:</span>
          <span class="veo-action-val">${escapeHtml(sh.subject_action || '')}</span>
        </div>
        <div class="veo-action-row">
          <span class="veo-action-label">Camera:</span>
          <span class="veo-action-val">${escapeHtml(sh.camera_motion || '')} (${escapeHtml(sh.camera_framing || '')})</span>
        </div>
        <div class="veo-action-row">
          <span class="veo-action-label">Môi trường:</span>
          <span class="veo-action-val">${escapeHtml(sh.environmental_action || '')}</span>
        </div>
        <div class="veo-action-row">
          <span class="veo-action-label">Ánh sáng:</span>
          <span class="veo-action-val">${escapeHtml(sh.lighting_atmosphere || '')}</span>
        </div>
      </div>

      <div class="prompt-section-card">
        <div class="prompt-section-header">
          <div class="prompt-header-title-group">
            <span class="prompt-section-title">Prompt video Veo</span>
            <span class="prompt-tag">Veo 2 Sẵn sàng sản xuất</span>
          </div>
          <div class="prompt-header-actions">
            <button class="btn btn-secondary btn-sm" data-action="copy" title="Sao chép Prompt">
              <svg class="icon"><use href="#icon-export" /></svg>
              <span>Sao chép</span>
            </button>
            <button class="btn btn-secondary btn-sm" data-action="edit" title="Chỉnh sửa cảnh quay">
              <svg class="icon"><use href="#icon-edit" /></svg>
              <span>Sửa</span>
            </button>
          </div>
        </div>
        <div class="prompt-section-content veo-content">
          <code>${escapeHtml(sh.veo_prompt || '')}</code>
        </div>
      </div>

      ${sh.negative_prompt ? `
      <div class="prompt-section-card negative-prompt-card">
        <div class="prompt-section-header">
          <div class="prompt-header-title-group">
            <span class="prompt-section-title">Prompt loại trừ</span>
            <span class="prompt-tag negative-tag">Loại trừ</span>
          </div>
          <div class="prompt-header-actions">
            <button class="btn btn-secondary btn-sm" data-action="copy-negative" title="Sao chép prompt loại trừ">
              <svg class="icon"><use href="#icon-export" /></svg>
              <span>Sao chép</span>
            </button>
          </div>
        </div>
        <div class="prompt-section-content negative-content">
          <code>${escapeHtml(sh.negative_prompt)}</code>
        </div>
      </div>
      ` : ''}

      <div class="prompt-section-card" id="veo-inheritance-block" aria-live="polite">
        <div class="prompt-section-header">
          <div class="prompt-header-title-group">
            <span class="prompt-section-title">Kế thừa hình ảnh</span>
            <span class="prompt-tag">tham chiếu chuẩn</span>
          </div>
        </div>
        <div class="prompt-section-content"><p class="empty-state">Đang tải refs kế thừa…</p></div>
      </div>
    `;
    loadVeoInheritance(sh.shot_id);
    syncPlaybackUI();
  }

  async function loadVeoInheritance(shotId) {
    const targetDir = currentProjectDir;
    const el = document.getElementById("veo-inheritance-block");
    if (!targetDir || !el || !shotId) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetDir)}/veo/shots/${encodeURIComponent(shotId)}/inheritance`);
      if (currentProjectDir !== targetDir || selectedShotId !== shotId || !res.ok) return;
      const inh = await res.json();
      if (currentProjectDir !== targetDir || selectedShotId !== shotId) return;
      const tag = (t) => `<span class="vb-tag">${escapeHtml(t)}</span>`;
      el.querySelector(".prompt-section-content").innerHTML = `
        <div class="prod-readiness-list">
          <div class="prod-readiness-row"><span>Chủ thể / nhóm</span><span>${(inh.subjectIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Nhân vật đại diện</span><span>${(inh.characterIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Bối cảnh</span><span>${inh.environmentId ? tag(inh.environmentId) : "—"}</span></div>
          <div class="prod-readiness-row"><span>Vật thể</span><span>${(inh.objectIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Ref assets</span><span>${(inh.referenceAssetIds || []).map(tag).join(" ") || "—"}</span></div>
          <div class="prod-readiness-row"><span>Continuity strategy</span><span class="prod-readiness-val is-ok">${escapeHtml(inh.continuityStrategy || "—")}</span></div>
          <div class="prod-readiness-row"><span>VB version</span><span>${escapeHtml(inh.visualBibleVersion || "—")}</span></div>
        </div>
        <div class="prod-history-meta" style="margin-top:0.3rem;">Canonical identity nằm ở Visual Bible V2 — shot không tự định nghĩa lại.</div>`;
    } catch (err) {
      console.warn("Failed to load Veo inheritance:", err);
    }
  }

  function selectShotById(shotId) {
    if (selectedShotId === shotId) return;
    selectedShotId = shotId;
    if (veoRowsContainer) {
      veoRowsContainer.querySelectorAll(".compact-row").forEach(r => {
        if (r.dataset.shotId === shotId) {
          r.classList.add("selected");
          r.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
          r.classList.remove("selected");
        }
      });
    }
    const shot = projectVeoShots.find(s => s.shot_id === shotId);
    if (shot) renderSelectedShotDetail(shot);
  }
  window.selectShotById = selectShotById;
  window.getProjectVeoShots = () => projectVeoShots;
  window.loadVeoForProject = loadVeoForProject;
  window.refreshDependencyStatus = refreshDependencyStatus;

  // Row Selection in Veo Shot List
  if (veoRowsContainer) {
    veoRowsContainer.addEventListener("click", (e) => {
      const expandBtn = e.target.closest(".btn-toggle-expand");
      if (expandBtn) {
        e.stopPropagation();
        const row = expandBtn.closest(".compact-row");
        const preview = row ? row.querySelector(".row-preview") : null;
        if (preview) {
          preview.classList.toggle("expanded");
          expandBtn.textContent = preview.classList.contains("expanded") ? "Thu gọn" : "Xem thêm";
        }
        return;
      }

      const row = e.target.closest(".compact-row");
      if (!row) return;
      const shotId = row.dataset.shotId;
      selectShotById(shotId);
      const shot = projectVeoShots.find(s => s.shot_id === shotId);
      if (shot) {
        window.seekGlobalAudio(shot.start, `Cảnh quay ${shot.index}`);
      }
    });

    // Arrow Key Navigation in Shot List
    veoRowsContainer.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const rows = Array.from(veoRowsContainer.querySelectorAll(".compact-row"));
        if (rows.length === 0) return;
        const curIdx = rows.findIndex(r => r.dataset.shotId === selectedShotId);
        let targetIdx = curIdx;
        if (e.key === "ArrowDown") {
          targetIdx = Math.min(rows.length - 1, curIdx + 1);
        } else if (e.key === "ArrowUp") {
          targetIdx = Math.max(0, curIdx - 1);
        }
        if (targetIdx !== curIdx && targetIdx >= 0) {
          const targetId = rows[targetIdx].dataset.shotId;
          selectShotById(targetId);
          rows[targetIdx].focus();
        }
      }
    });
  }

  // Detail Actions in Veo Selected Detail Pane
  if (veoSelectedDetail) {
    veoSelectedDetail.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const shot = projectVeoShots.find(s => s.shot_id === selectedShotId);
      if (!shot) return;

      if (action === "seek") {
        window.seekGlobalAudio(shot.start, `Cảnh quay ${shot.index} (${formatTime(shot.start)})`);
      } else if (action === "copy" || action === "copy-image") {
        await copyTextToClipboard(shot.veo_prompt, btn);
      } else if (action === "copy-negative") {
        await copyTextToClipboard(shot.negative_prompt, btn);
      } else if (action === "regen-parent-scene") {
        doRegenerateSceneVeo(shot.parentSceneId || shot.parent_scene_id);
      } else if (action === "edit") {
        openEditVeoModal(shot);
      }
    });
  }

  // Search & Filter event handlers for Veo Prompt Generator (debounced 100ms)
  if (veoSearchInput) {
    veoSearchInput.addEventListener("input", debounce(() => {
      veoSearchQuery = veoSearchInput.value.trim().toLowerCase();
      renderVeoShotsList(projectVeoShots);
    }, 100));
  }

  if (veoFilterTone) {
    veoFilterTone.addEventListener("change", () => {
      veoFilterToneVal = veoFilterTone.value;
      renderVeoShotsList(projectVeoShots);
    });
  }

  function openEditVeoModal(shot) {
    if (!veoEditModal) return;
    editingVeoShotId = shot.shot_id;
    if (veoModalTitle) veoModalTitle.textContent = `Chỉnh sửa cảnh quay ${shot.index} (${shot.shot_id})`;
    if (veoEditShotId) veoEditShotId.value = shot.shot_id;
    if (veoEditFraming) veoEditFraming.value = shot.camera_framing || "medium wide documentary shot";
    if (veoEditCameraMotion) veoEditCameraMotion.value = shot.camera_motion || "static cinematic camera";
    if (veoEditShotType) veoEditShotType.value = shot.shot_type || "medium wide";
    if (veoEditAspectRatio) veoEditAspectRatio.value = shot.aspect_ratio || "16:9";
    if (veoEditSubjectAction) veoEditSubjectAction.value = shot.subject_action || "";
    if (veoEditEnvironmentalAction) veoEditEnvironmentalAction.value = shot.environmental_action || "";
    if (veoEditLighting) veoEditLighting.value = shot.lighting_atmosphere || "";
    if (veoEditContinuityAnchor) veoEditContinuityAnchor.value = shot.continuity_anchor || "";
    let currentEditingOriginalPrompt = (shot.veo_prompt || "").trim();
    veoEditModal.dataset.originalPrompt = currentEditingOriginalPrompt;
    if (veoEditPrompt) veoEditPrompt.value = shot.veo_prompt || "";
    const altPrompt = document.getElementById("veo-edit-veo-prompt");
    if (altPrompt) altPrompt.value = shot.veo_prompt || "";
    if (veoEditNegativePrompt) veoEditNegativePrompt.value = shot.negative_prompt || "";
    veoEditModal.style.display = "flex";
    veoEditModal.classList.add("open");
    uqOpenModals.push({ el: veoEditModal, trigger: document.activeElement });
    uqLockBody();
    trapFocus(veoEditModal);
  }

  function closeEditVeoModal() {
    uqModalClose(veoEditModal);
    editingVeoShotId = null;
  }

  if (veoModalCloseBtn) veoModalCloseBtn.addEventListener("click", closeEditVeoModal);
  if (veoModalCancelBtn) veoModalCancelBtn.addEventListener("click", closeEditVeoModal);

  if (veoModalSaveBtn) {
    veoModalSaveBtn.addEventListener("click", async () => {
      if (!currentProjectDir || !editingVeoShotId) return;
      veoModalSaveBtn.disabled = true;
      veoModalSaveBtn.textContent = "Đang lưu...";

      const origPrompt = (veoEditModal.dataset.originalPrompt || "").trim();
      const p1 = veoEditPrompt ? veoEditPrompt.value.trim() : "";
      const p2 = document.getElementById("veo-edit-veo-prompt") ? document.getElementById("veo-edit-veo-prompt").value.trim() : "";
      let promptVal = origPrompt;
      if (p1 && p1 !== origPrompt) {
        promptVal = p1;
      } else if (p2 && p2 !== origPrompt) {
        promptVal = p2;
      } else {
        promptVal = p1 || p2 || origPrompt;
      }

      const payload = {
        camera_framing: veoEditFraming ? veoEditFraming.value : undefined,
        camera_motion: veoEditCameraMotion ? veoEditCameraMotion.value : undefined,
        shot_type: veoEditShotType ? veoEditShotType.value.trim() : undefined,
        aspect_ratio: veoEditAspectRatio ? veoEditAspectRatio.value : undefined,
        subject_action: veoEditSubjectAction ? veoEditSubjectAction.value.trim() : undefined,
        environmental_action: veoEditEnvironmentalAction ? veoEditEnvironmentalAction.value.trim() : undefined,
        lighting_atmosphere: veoEditLighting ? veoEditLighting.value.trim() : undefined,
        continuity_anchor: (veoEditContinuityAnchor && veoEditContinuityAnchor.value.trim()) ? veoEditContinuityAnchor.value.trim() : null,
        veo_prompt: promptVal || undefined,
        negative_prompt: veoEditNegativePrompt ? veoEditNegativePrompt.value.trim() : undefined,
      };

      try {
        const res = await fetch(`/api/projects/${currentProjectDir}/veo/shots/${editingVeoShotId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Không thể cập nhật shot.");
        }
        closeEditVeoModal();
        await loadVeoForProject(currentProjectDir);
      } catch (err) {
        showNotification(`Lỗi lưu: ${err.message}`, "error");
      } finally {
        veoModalSaveBtn.disabled = false;
        veoModalSaveBtn.textContent = "Lưu thay đổi";
      }
    });
  }

  async function doGenerateVeo() {
    if (!currentProjectDir) return;
    btnGenerateVeo.disabled = true;
    if (veoErrorAlert) veoErrorAlert.style.display = "none";
    setVeoStatus("generating", "Đang tạo");

    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/veo/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo Veo Prompt.");
      }
      veoOutdated = false;
      updateDependencyState();
      await loadVeoForProject(currentProjectDir);
    } catch (err) {
      if (veoErrorAlert) {
        veoErrorAlert.style.display = "flex";
        veoErrorText.textContent = err.message;
      }
      setVeoStatus("failed", "Thất bại");
      showNotification(`Lỗi tạo Veo Prompt: ${err.message}`, "error");
    } finally {
      btnGenerateVeo.disabled = false;
    }
  }

  btnGenerateVeo.addEventListener("click", () => {
    if (!currentProjectDir) return;
    if (projectVeoShots.length > 0) {
      const hasEdits = projectVeoShots.some(s => s.status === "edited");
      const msg = hasEdits
        ? "Bạn đã chỉnh sửa Prompt thủ công. Phiên bản hiện tại sẽ được lưu trữ (archive) trước khi tạo lại. Bạn có chắc chắn muốn tiếp tục?"
        : "Veo Prompt hiện tại sẽ được thay thế (bản sao lưu tự động sẽ được giữ lại). Tiếp tục?";
      showConfirmDialog({
        variant: "warning",
        title: "Tạo lại Veo Prompt?",
        message: msg,
        confirmText: "Tạo lại Veo Prompt",
        cancelText: "Hủy",
        onConfirm: () => doGenerateVeo()
      });
      return;
    }
    doGenerateVeo();
  });

  btnRefreshVeo.addEventListener("click", () => {
    if (currentProjectDir) loadVeoForProject(currentProjectDir);
  });

  if (btnProductionExport) {
    btnProductionExport.addEventListener("click", () => {
      if (currentProjectDir) runProductionExport();
    });
  }
  if (btnProductionOpenFolder) {
    btnProductionOpenFolder.addEventListener("click", () => openProductionExportFolder());
  }
  if (btnProductionCopyPath) {
    btnProductionCopyPath.addEventListener("click", () => copyProductionExportPath());
  }

  async function doRegenerateAllVeo() {
    if (!currentProjectDir) return;
    const targetDir = currentProjectDir;
    btnRegenerateAllVeo.disabled = true;
    if (veoErrorAlert) veoErrorAlert.style.display = "none";
    setVeoStatus("generating", "Đang tạo");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetDir)}/veo/regenerate-all`, {
        method: "POST"
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Không thể tạo lại toàn bộ cảnh quay.");
      }
      const data = await res.json().catch(() => ({}));
      if (currentProjectDir !== targetDir) return;
      veoOutdated = false;
      veoOutdatedScenes = [];
      updateDependencyState();
      const count = (data.shot_count != null) ? data.shot_count : ((data.shots || []).length || "");
        showNotification(`Đã tạo lại toàn bộ cảnh quay${count !== "" ? ` (${count} cảnh quay)` : ""} và lưu archive bản cũ.`, "success");
      await loadVeoForProject(targetDir);
      refreshDependencyStatus(targetDir);
    } catch (err) {
      if (currentProjectDir !== targetDir) return;
      if (veoErrorAlert) {
        veoErrorAlert.style.display = "flex";
        veoErrorText.textContent = err.message;
      }
      setVeoStatus("failed", "Thất bại");
        showNotification(`Lỗi tạo lại toàn bộ cảnh quay: ${err.message}`, "error");
    } finally {
      if (btnRegenerateAllVeo && currentProjectDir === targetDir) btnRegenerateAllVeo.disabled = false;
    }
  }

  if (btnRegenerateAllVeo) {
    btnRegenerateAllVeo.addEventListener("click", () => {
      if (!currentProjectDir) return;
      showConfirmDialog({
        variant: "warning",
        title: "Tạo lại toàn bộ cảnh quay?",
        message: "Toàn bộ Veo Shot sẽ được tạo lại từ Scene Plan hiện tại. Bản Veo Prompt hiện tại sẽ được lưu archive trước khi thay thế. Bạn có chắc chắn muốn tiếp tục?",
        confirmText: "Tạo lại toàn bộ",
        cancelText: "Hủy",
        onConfirm: () => doRegenerateAllVeo()
      });
    });
  }

  async function doRegenerateSceneVeo(sceneId) {
    if (!currentProjectDir || !sceneId) return;
    const targetDir = currentProjectDir;
    const targetScene = sceneId;
    showConfirmDialog({
      variant: "warning",
      title: "Tạo lại cảnh quay của cảnh này?",
      message: `Chỉ các cảnh quay thuộc cảnh "${targetScene}" sẽ được tạo lại. Các cảnh khác được giữ nguyên. Bản hiện tại sẽ được lưu archive trước khi thay thế.`,
      confirmText: "Tạo lại cảnh quay",
      cancelText: "Hủy",
      onConfirm: async () => {
        setVeoStatus("generating", "Đang tạo");
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(targetDir)}/veo/regenerate-scene/${encodeURIComponent(targetScene)}`, {
            method: "POST"
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Không thể tạo lại cảnh quay của cảnh.");
          }
          if (currentProjectDir !== targetDir) return;
          veoOutdated = false;
          veoOutdatedScenes = [];
          updateDependencyState();
          showNotification(`Đã tạo lại cảnh quay cho cảnh "${targetScene}".`, "success");
          await loadVeoForProject(targetDir);
          refreshDependencyStatus(targetDir);
        } catch (err) {
          if (currentProjectDir !== targetDir) return;
          if (veoErrorAlert) {
            veoErrorAlert.style.display = "flex";
            veoErrorText.textContent = err.message;
          }
          setVeoStatus("failed", "Thất bại");
          showNotification(`Lỗi tạo lại cảnh quay: ${err.message}`, "error");
        }
      }
    });
  }
  window.doRegenerateSceneVeo = doRegenerateSceneVeo;

  btnExportVeoJson.addEventListener("click", () => {
    downloadWithFeedback(`/api/projects/${currentProjectDir}/veo/prompts.json`, "tệp JSON Veo Prompt");
  });

  btnExportVeoMd.addEventListener("click", () => {
    downloadWithFeedback(`/api/projects/${currentProjectDir}/veo/prompts.md`, "tệp Markdown Veo Prompt");
  });

  // ==============================================================================
  // 12. PROJECTS BROWSER & AUDITION
  // ==============================================================================
  let projectsDeleteListenerAttached = false;

  async function loadProjects(autoSelect = false) {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      const projects = (data.projects && data.projects.length > 0) ? data.projects : [];
      if (data.projects && data.projects.length > 0) {
        const frag = document.createDocumentFragment();
        data.projects.slice(0, 15).forEach(p => {
          const item = document.createElement("div");
          item.className = "project-item";
          const dur = p.duration_seconds ? `${p.duration_seconds} giây` : "--";
          const safeDir = escapeHtml(p.directory_name);
          const safeName = escapeHtml(p.project_name || p.directory_name);
          item.innerHTML = `
            <div class="project-info">
              <span class="project-title">${safeName}</span>
              <span class="project-details">${escapeHtml(p.voice)} &bull; ${p.character_count} ký tự &bull; ${dur}</span>
            </div>
            <div class="project-actions">
              <button class="btn btn-secondary btn-sm" onclick="loadPreviewAudio('${safeDir}', ${p.duration_seconds || 0})">
                <span>Mở dự án</span>
              </button>
              <button class="btn btn-secondary btn-sm btn-project-complete" data-dir="${safeDir}" data-name="${safeName}" title="Đánh dấu hoàn tất dự án">
                <span>Hoàn tất</span>
              </button>
              <button class="btn btn-project-delete" data-dir="${safeDir}" data-name="${safeName}" onclick="confirmDeleteProject('${safeDir}', '${safeName}', event)" title="Xóa dự án vĩnh viễn" aria-label="Xóa dự án ${safeName}">
                <svg class="ui-icon" style="pointer-events: none;"><use href="#icon-trash"></use></svg>
                <span style="pointer-events: none;">Xóa</span>
              </button>
            </div>
          `;
          frag.appendChild(item);
        });
        projectsList.innerHTML = "";
        projectsList.appendChild(frag);

        if (autoSelect && !currentProjectDir && data.projects.length > 0) {
          loadPreviewAudio(data.projects[0].directory_name, data.projects[0].duration_seconds || 0, false);
        }
      } else {
        projectsList.innerHTML = `<p class="empty-state">Chưa có dự án nào trong hệ thống. Hãy nhập kịch bản và bấm "Tạo giọng đọc" để bắt đầu.</p>`;
      }
      return projects;
    } catch (err) {
      console.error("Failed to list projects:", err);
      if (projectsList) projectsList.innerHTML = `<p class="empty-state">Không tải được danh sách dự án. <button class="btn btn-secondary btn-sm" onclick="window.retryLoadProjects()">Thử lại</button></p>`;
      return [];
    }
  }
  window.retryLoadProjects = () => loadProjects(false);

  // 02A §3: real project resolution — validate persisted/default selection,
  // clear stale slugs, never call downstream APIs with an invalid project.
  async function resolveStartupProject() {
    const projects = await loadProjects(false);
    let pick = null;
    try {
      const persisted = localStorage.getItem("unfoldiq_project");
      if (persisted) pick = projects.find(p => p.directory_name === persisted) || null;
    } catch (e) {}
    if (!pick && activeProjectNameEl) {
      const label = (activeProjectNameEl.textContent || "").trim();
      if (label && label !== "Chưa chọn dự án") {
        pick = projects.find(p => p.directory_name === label || (p.project_name || "") === label) || null;
      }
    }
    if (pick) {
      loadPreviewAudio(pick.directory_name, pick.duration_seconds || 0, false);
    } else {
      // No valid project: clean state, no downstream fetch storm.
      resetWorkstationToCleanState();
      await loadProjects(false);
    }
  }

  function confirmDeleteProject(dirName, projName, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const cleanDir = dirName || "";
    const cleanName = projName || cleanDir;
    if (!cleanDir) return;

    showConfirmDialog({
      variant: "danger",
      title: "Xóa vĩnh viễn dự án?",
      message: `Bạn có chắc chắn muốn xóa thư mục dự án "${cleanName}" (${cleanDir})? Hành động này sẽ xóa toàn bộ audio, timestamp, storyboard scene plan và veo prompts và KHÔNG THỂ KHÔI PHỤC.`,
      confirmText: "Xóa vĩnh viễn",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          // If this project's audio is currently loaded in player, release it first so Windows doesn't lock the file
          if (currentProjectDir === cleanDir && audioPlayer) {
            try {
              audioPlayer.pause();
              audioPlayer.removeAttribute("src");
              audioPlayer.load();
            } catch (_) {}
          }

          const res = await fetch(`/api/projects/${encodeURIComponent(cleanDir)}`, {
            method: "DELETE"
          });
          if (res.status === 409) {
            const err = await res.json().catch(() => ({}));
            showNotification(err.detail || "Không thể xóa: Dự án đang có tiến trình xử lý ngầm.", "error");
            return;
          }
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showNotification(err.detail || "Xóa dự án thất bại.", "error");
            return;
          }
          showNotification(`Đã xóa dự án "${cleanName}" thành công.`, "success");
          if (currentProjectDir === cleanDir) {
            resetWorkstationToCleanState();
          }
          await loadProjects();
        } catch (err) {
          console.error("Delete project error:", err);
          showNotification(`Lỗi khi xóa dự án: ${err.message}`, "error");
        }
      }
    });
  }
  window.confirmDeleteProject = confirmDeleteProject;

  if (projectsList && !projectsDeleteListenerAttached) {
    projectsDeleteListenerAttached = true;
    projectsList.addEventListener("click", (e) => {
      const completeBtn = e.target.closest(".btn-project-complete");
      if (completeBtn) {
        e.stopPropagation();
        doCompleteProject(completeBtn.dataset.dir, completeBtn.dataset.name || completeBtn.dataset.dir, e);
        return;
      }
      const delBtn = e.target.closest(".btn-project-delete");
      if (!delBtn) return;
      e.stopPropagation();
      const dirName = delBtn.dataset.dir;
      const projName = delBtn.dataset.name || dirName;
      confirmDeleteProject(dirName, projName, e);
    });
  }

  async function doCompleteProject(dirName, projName, event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (!dirName) return;
    showConfirmDialog({
      variant: "warning",
      title: "Hoàn tất dự án?",
      message: `Hoàn tất dự án "${projName || dirName}"? Audio master sẽ được lưu sang thư mục outputs/.`,
      confirmText: "Hoàn tất dự án",
      cancelText: "Hủy",
      onConfirm: async () => {
        try {
          const doComplete = async () => {
            const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/complete`, {
              method: "POST"
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              showNotification(err.detail || "Hoàn tất dự án thất bại.", "error");
              return;
            }
            if (currentProjectDir === dirName) {
              resetWorkstationToCleanState();
            }
            showNotification(`Đã hoàn tất dự án "${projName || dirName}".`, "success");
            await loadProjects(false);
          };
          // P0.1: dirty check first (nested confirms would be auto-closed).
          if (dirName === currentProjectDir && isScriptDirty()) {
            confirmDiscardScriptIfDirty("Hoàn tất dự án", () => { doComplete(); });
          } else {
            await doComplete();
          }
        } catch (err) {
          console.error("Complete project error:", err);
          showNotification(`Lỗi khi hoàn tất dự án: ${err.message}`, "error");
        }
      }
    });
  }
  window.doCompleteProject = doCompleteProject;

  window.loadPreviewAudio = function(dirName, duration, autoPlay = true) {
    // P0.1: switching projects with unsaved typing needs explicit discard.
    if (dirName !== currentProjectDir && isScriptDirty()) {
      confirmDiscardScriptIfDirty("Mở dự án khác", () => {
        window.loadPreviewAudio(dirName, duration, autoPlay);
      });
      return;
    }
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;
    try { localStorage.setItem("unfoldiq_project", dirName); } catch (e) {}
    if (activeProjectNameEl) activeProjectNameEl.textContent = dirName;
    if (slugPreviewEl) slugPreviewEl.textContent = dirName;
    if (playerContextLabel) playerContextLabel.textContent = `${dirName} • Sẵn sàng`;

    audioPlayer.src = `/api/projects/${dirName}/audio/wav?t=${Date.now()}`;
    if (autoPlay) {
      audioPlayer.play().catch(() => {});
    }

    finalDurationText.textContent = duration ? `${duration} giây` : "--";
    btnExportWav.disabled = false;
    btnExportMp3.disabled = false;

    if (btnCloseProject) btnCloseProject.style.display = "inline-flex";
    if (btnRegenerateAllVeo) btnRegenerateAllVeo.disabled = false;

    // P0.1: hydrate editor with the canonical project script.
    fetch(`/api/projects/${encodeURIComponent(dirName)}/script`)
      .then(res => res.ok ? res.json() : null)
      .then(scriptData => {
        if (!scriptData || currentProjectDir !== dirName) return;
        hydrateScriptEditor(scriptData.script || "");
      })
      .catch(err => console.warn("Failed to load project script:", err));

    tsOutdated = false;
    scenesOutdated = false;
    veoOutdated = false;
    veoOutdatedScenes = [];
    updateDependencyState();

    // Realtime dependency reconciliation for the opened project.
    refreshDependencyStatus(dirName);
    // Phase 9: narration plan summary for the Voice workspace.
    refreshNarrationPlan(dirName);

    loadVoiceQA(dirName);
    loadTimestampsForProject(dirName);
    loadScenesForProject(dirName);
    loadVeoForProject(dirName);
    loadVisualBible(dirName);
    loadEditorial(dirName);
    loadStorySlice(dirName);
    loadVoiceWorkbench(dirName);
    loadVisualWorkbench(dirName);
    loadNextBestAction(dirName);
    // 02A: nếu đang đứng ở workspace do Phase14 quản lý, tải lại để thoát empty cũ.
    try {
      if (window.Phase14 && activeWorkspaceId === "overview") window.Phase14.loadOverviewData(dirName);
    } catch (e) {}
  };

  btnRefreshHistory.addEventListener("click", loadProjects);

  // ==========================================================================
  // 13a. SCRIPT EDITORIAL QA (Phase 12 — inside Script workspace, no new stage)
  // ==========================================================================
  const edqStatusBadge = document.getElementById("edq-status-badge");
  const edqScore = document.getElementById("edq-score");
  const edqIssueCount = document.getElementById("edq-issue-count");
  const edqProtectedCount = document.getElementById("edq-protected-count");
  const edqSummary = document.getElementById("edq-summary");
  const btnEdqAnalyze = document.getElementById("btn-edq-analyze");
  const btnEdqView = document.getElementById("btn-edq-view");
  const edqModal = document.getElementById("edq-modal");
  const edqIssuesList = document.getElementById("edq-issues-list");
  const edqIssueDetail = document.getElementById("edq-issue-detail");
  const edqModalCounts = document.getElementById("edq-modal-counts");
  const edqModalScore = document.getElementById("edq-modal-score");

  let editorialData = null;
  let editorialProtection = [];
  let edqFilter = "all";
  let edqSelectedId = null;

  function clearEditorialCard() {
    editorialData = null;
    edqSelectedId = null;
    if (edqStatusBadge) {
      edqStatusBadge.className = "state-pill state-idle";
      edqStatusBadge.textContent = "Chưa bắt đầu";
    }
    if (edqScore) edqScore.textContent = "—";
    if (edqIssueCount) edqIssueCount.textContent = "0";
    if (edqProtectedCount) edqProtectedCount.textContent = "0";
    if (edqSummary) edqSummary.textContent = "";
    if (btnEdqAnalyze) btnEdqAnalyze.disabled = true;
    if (btnEdqView) btnEdqView.disabled = true;
    closeEdqModal();
  }
  window.clearEditorialCard = clearEditorialCard;

  function renderEditorialCard() {
    const hasProject = !!currentProjectDir;
    if (btnEdqAnalyze) btnEdqAnalyze.disabled = !hasProject;
    if (!editorialData || !editorialData.exists) {
      if (edqStatusBadge) {
        edqStatusBadge.className = "state-pill state-idle";
        edqStatusBadge.textContent = editorialData && editorialData.stale ? "Cần đồng bộ" : "Chưa bắt đầu";
      }
      if (btnEdqView) btnEdqView.disabled = true;
      return;
    }
    const st = (editorialData.status || "REVIEW").toUpperCase();
    if (edqStatusBadge) {
      edqStatusBadge.className = "state-pill " + (st === "READY" ? "state-pass" : st === "ERROR" ? "state-fail" : "state-review");
      edqStatusBadge.textContent = st + (editorialData.stale ? " (cần đồng bộ)" : "");
    }
    if (edqScore) edqScore.textContent = String(editorialData.score ?? "—");
    if (edqIssueCount) edqIssueCount.textContent = String(editorialData.openCount ?? 0);
    if (edqProtectedCount) edqProtectedCount.textContent = String(editorialData.protectedSpanCount ?? 0);
    if (edqSummary) {
      const issues = editorialData.issues || [];
      const byType = {};
      issues.filter(i => i.status === "OPEN").forEach(i => {
        const k = (/TTS|READ|NUMBER|NOUN|ABBREV/.test(i.type)) ? "TTS readability" : (/BLOCK|FACT|PROTECT/.test(i.type) ? "factual-protection" : "rhythm/repetition");
        byType[k] = (byType[k] || 0) + 1;
      });
      edqSummary.textContent = Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(" · ") || "Không còn vấn đề mở.";
    }
    if (btnEdqView) btnEdqView.disabled = false;
  }

  async function loadEditorial(dirName) {
    if (!dirName) {
      clearEditorialCard();
      return;
    }
    const targetDir = dirName;
    try {
      const [resEdq, resProt] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(dirName)}/editorial`),
        fetch(`/api/projects/${encodeURIComponent(dirName)}/protection`)
      ]);
      if (currentProjectDir !== targetDir || !resEdq.ok) return;
      editorialData = await resEdq.json();
      if (resProt.ok) {
        const pj = await resProt.json();
        editorialProtection = pj.protectedSpans || [];
      }
      if (currentProjectDir !== targetDir) return;
      renderEditorialCard();
    } catch (err) {
      console.warn("Failed to load editorial QA:", err);
    }
  }
  window.loadEditorial = loadEditorial;

  async function analyzeEditorial() {
    if (!currentProjectDir) return;
    const targetDir = currentProjectDir;
    btnEdqAnalyze.disabled = true;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(targetDir)}/editorial/analyze`, { method: "POST" });
      if (currentProjectDir !== targetDir) return;
      if (!res.ok) throw new Error("Phân tích thất bại.");
      editorialData = await res.json();
      renderEditorialCard();
      showNotification(`Editorial QA: ${editorialData.score} điểm, ${editorialData.openCount} vấn đề mở.`, "success");
    } catch (err) {
      showNotification(err.message, "error");
    } finally {
      if (currentProjectDir === targetDir) btnEdqAnalyze.disabled = false;
    }
  }

  function openEdqModal() {
    if (!edqModal || !editorialData || !editorialData.exists) return;
    uqModalOpen(edqModal);
    renderEdqList();
  }
  function closeEdqModal() {
    uqModalClose(edqModal);
  }

  function renderEdqList() {
    if (!edqIssuesList || !editorialData) return;
    const issues = editorialData.issues || [];
    const filtered = issues.filter(i => {
      if (edqFilter === "review") return i.severity === "REVIEW";
      if (edqFilter === "block") return i.severity === "BLOCK";
      if (edqFilter === "open") return i.status === "OPEN";
      return true;
    });
    if (edqModalScore) {
      edqModalScore.className = "state-pill state-review";
      edqModalScore.textContent = `${editorialData.score} điểm`;
    }
    if (edqModalCounts) edqModalCounts.textContent = `${filtered.length}/${issues.length} vấn đề`;
    if (!edqSelectedId || !filtered.some(i => i.issueId === edqSelectedId)) {
      edqSelectedId = filtered.length ? filtered[0].issueId : null;
    }
    edqIssuesList.innerHTML = filtered.length ? filtered.map(i => `
      <div class="compact-row ${i.issueId === edqSelectedId ? 'selected' : ''}" data-id="${i.issueId}">
        <span class="badge">${i.severity}</span>
        <span style="flex:1;">${escapeHtml(i.message)}</span>
        <span class="prod-history-meta">${i.status}</span>
      </div>`).join("") : `<p class="empty-state">Không có vấn đề nào.</p>`;
    edqIssuesList.querySelectorAll(".compact-row").forEach(row => {
      row.addEventListener("click", () => {
        edqSelectedId = row.getAttribute("data-id");
        renderEdqList();
      });
    });
    renderEdqDetail(filtered.find(i => i.issueId === edqSelectedId));
  }

  function renderEdqDetail(issue) {
    if (!edqIssueDetail) return;
    if (!issue) {
      edqIssueDetail.innerHTML = `<p class="empty-state">Chọn một vấn đề để xem Trước/Sau.</p>`;
      return;
    }
    const overlapping = (editorialProtection || []).filter(s =>
      !(s.endOffset <= issue.startOffset || s.startOffset >= issue.endOffset));
    const protHtml = overlapping.length
      ? `<div class="prod-history-meta">Vùng được bảo vệ: ${overlapping.map(s =>
          `<span class="vb-tag" style="${s.locked ? "" : "opacity:0.6;"}">${escapeHtml(s.type)}: ${escapeHtml(s.text)}${s.locked ? " 🔒" : ""}</span>`).join(" ")}</div>`
      : "";
    edqIssueDetail.innerHTML = `
      <div class="detail-prose-card">
        <div class="detail-prose-label">${escapeHtml(issue.issueId)} · ${escapeHtml(issue.type)} · ${escapeHtml(issue.severity)}</div>
        <div class="detail-prose-content">${escapeHtml(issue.message)}</div>
      </div>
      <div class="detail-prose-card">
        <div class="detail-prose-label">Trước</div>
        <div class="detail-prose-content narration-quote">${escapeHtml(issue.text || "")}</div>
      </div>
      ${issue.suggestion ? `
      <div class="detail-prose-card">
        <div class="detail-prose-label">Sau (đề xuất)</div>
        <div class="detail-prose-content">${escapeHtml(issue.suggestion)}</div>
      </div>` : `<p class="empty-state">Không có đề xuất tự động — cần xem thủ công.</p>`}
      ${issue.blockReason ? `<div class="prod-result is-error" style="display:block;"><strong>BỊ CHẶN:</strong> ${escapeHtml(issue.blockReason)}</div>` : ""}
      ${protHtml}
      <div class="detail-actions-bar">
        ${issue.suggestion && issue.status === "OPEN" ? `<button class="btn btn-primary btn-sm" id="edq-apply-btn"><span>Áp dụng</span></button>` : ""}
        ${issue.status === "OPEN" ? `<button class="btn btn-secondary btn-sm" id="edq-ignore-btn"><span>Bỏ qua</span></button>` : `<span class="prod-history-meta">${issue.status}</span>`}
      </div>`;
    const applyBtn = document.getElementById("edq-apply-btn");
    if (applyBtn) applyBtn.addEventListener("click", () => edqApplyIssue(issue.issueId));
    const ignoreBtn = document.getElementById("edq-ignore-btn");
    if (ignoreBtn) ignoreBtn.addEventListener("click", () => edqIgnoreIssue(issue.issueId));
  }

  async function edqApplyIssue(issueId) {
    if (!currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/editorial/issues/${issueId}/apply`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.detail) || "Apply thất bại.");
      editorialData = await (await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/editorial`)).json();
      renderEditorialCard();
      renderEdqList();
      hydrateScriptEditor("");
      fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/script`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) hydrateScriptEditor(d.script || ""); });
      refreshDependencyStatus(currentProjectDir);
      showNotification("Đã áp dụng đề xuất (script đã đổi → downstream stale theo chain).", "success");
    } catch (err) {
      showNotification(err.message, "error");
      if (/BLOCKED/.test(err.message)) loadEditorial(currentProjectDir);
    }
  }

  async function edqIgnoreIssue(issueId) {
    if (!currentProjectDir) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/editorial/issues/${issueId}/ignore`, { method: "POST" });
    if (res.ok) {
      editorialData = await res.json().then(() => fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/editorial`).then(r => r.json()));
      renderEditorialCard();
      renderEdqList();
    }
  }

  if (btnEdqAnalyze) btnEdqAnalyze.addEventListener("click", analyzeEditorial);
  if (btnEdqView) btnEdqView.addEventListener("click", openEdqModal);
  const edqModalCloseBtn = document.getElementById("edq-modal-close-btn");
  if (edqModalCloseBtn) edqModalCloseBtn.addEventListener("click", closeEdqModal);
  const edqModalDoneBtn = document.getElementById("edq-modal-done-btn");
  if (edqModalDoneBtn) edqModalDoneBtn.addEventListener("click", closeEdqModal);
  [["edq-filter-all", "all"], ["edq-filter-review", "review"], ["edq-filter-block", "block"], ["edq-filter-open", "open"]].forEach(([id, val]) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", () => { edqFilter = val; renderEdqList(); });
  });

  // ==============================================================================
  // 13b. NARRATION DIRECTOR (Phase 9 — hidden inside Voice, no sidebar step)
  // ==============================================================================
  let narrationPlan = null;
  let narrationSummary = null;
  let narrationSelectedBeat = null;
  let narrationReviewOnly = false;
  let narrationGen = 0;
  let narrationHealth = "TRỐNG";

  const narrationModal = document.getElementById("narration-beats-modal");
  const narrationList = document.getElementById("narration-beats-list");
  const narrationDetail = document.getElementById("narration-beat-detail");
  const narrationCounts = document.getElementById("narration-modal-counts");
  const narrationSummaryEl = document.getElementById("narration-summary");
  const narrationPreviewPlayer = document.getElementById("narration-preview-player");

  function selectedNarrationMode() {
    const r = document.querySelector('input[name="narration-mode"]:checked');
    return r ? r.value : "auto";
  }
  function selectedNarrationProfile() {
    const s = document.getElementById("narration-profile-select");
    return (s && s.value) || "DOCUMENTARY_CINEMATIC";
  }

  function updateNarrationSummary() {
    if (!narrationSummaryEl) return;
    if (!currentProjectDir || !narrationSummary) {
      narrationSummaryEl.textContent = currentProjectDir
        ? "Chưa phân tích narration." : "Chưa mở dự án.";
      return;
    }
    const st = narrationSummary.stats || {};
    narrationSummaryEl.textContent =
      `${st.beat_count || 0} beat · ` +
      `${(st.beat_count || 0) - (narrationSummary.review || 0)} tự động chấp nhận · ` +
      `${narrationSummary.review || 0} cần kiểm tra`;
  }

  async function refreshNarrationPlan(dirName) {
    const gen = ++narrationGen;
    narrationPlan = null;
    narrationSummary = null;
    narrationHealth = "TRỐNG";
    updateNarrationSummary();
    if (!dirName) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/narration/plan`);
      if (!res.ok) return;
      const data = await res.json();
      if (currentProjectDir !== dirName || gen !== narrationGen) return; // stale guard
      narrationHealth = data.status || "EMPTY";
      if (data.plan) {
        narrationPlan = data.plan;
        const planBeats = data.plan.beats || [];
        // keep selection if the beat still exists
        if (narrationSelectedBeat && !planBeats.some(b => b.beatId === narrationSelectedBeat)) {
          narrationSelectedBeat = null;
        }
        const review = planBeats.filter(b => (b.confidence ?? 1) < 0.55 ||
          (["OMINOUS", "URGENT", "SOMBER", "AWE", "EXCITED", "REVEAL"].includes(b.style)
            && (b.intensity ?? 0) >= 0.6)).length;
        narrationSummary = { stats: data.summary?.stats || {}, review };
      }
      updateNarrationSummary();
      updateDependencyState();
    } catch (err) {
      console.warn("Failed to load narration plan:", err);
    }
  }

  function closeNarrationModal() {
    uqModalClose(narrationModal);
    if (narrationPreviewPlayer) {
      try { narrationPreviewPlayer.pause(); } catch (_) {}
      const old = narrationPreviewPlayer.dataset.blobUrl;
      if (old) {
        try { URL.revokeObjectURL(old); } catch (_) {}
        delete narrationPreviewPlayer.dataset.blobUrl;
      }
      narrationPreviewPlayer.removeAttribute("src");
    }
    narrationSelectedBeat = null;
  }

  function openNarrationModal() {
    if (!currentProjectDir) {
      showNotification("Hãy mở một dự án trước.", "warning");
      return;
    }
    if (!narrationPlan) {
      showNotification("Chưa có Narration Plan. Bấm “Phân tích lại” để tạo.", "warning");
      return;
    }
    renderNarrationList();
    uqModalOpen(narrationModal);
  }

  function narrationBeatsFiltered() {
    const beats = (narrationPlan && narrationPlan.beats) || [];
    if (!narrationReviewOnly) return beats;
    return beats.filter(b => (b.confidence ?? 1) < 0.55 ||
      (["OMINOUS", "URGENT", "SOMBER", "AWE", "EXCITED", "REVEAL"].includes(b.style)
        && (b.intensity ?? 0) >= 0.6) || b.manualEdited);
  }

  function renderNarrationList() {
    if (!narrationList) return;
    const beats = narrationBeatsFiltered();
    const all = (narrationPlan && narrationPlan.beats) || [];
    if (narrationCounts) narrationCounts.textContent = `${beats.length}/${all.length} beat`;
    if (!beats.length) {
      narrationList.innerHTML = `<p class="empty-state">Không có beat nào.</p>`;
      return;
    }
    narrationList.innerHTML = "";
    beats.forEach((b) => {
      const row = document.createElement("div");
      row.className = "ts-cue-card" + (b.beatId === narrationSelectedBeat ? " selected" : "");
      row.setAttribute("role", "option");
      row.setAttribute("tabindex", "0");
      const flag = b.manualEdited ? " · ✎" : "";
      row.innerHTML = `<div class="ts-cue-time"><span>${escapeHtml(b.beatId)} · ` +
        `${escapeHtml(b.style || "")}${flag}</span>` +
        `<span style="color: var(--text-dim); font-size: 0.7rem;">${Math.round((b.confidence ?? 0) * 100)}%</span></div>` +
        `<div class="ts-cue-text">${escapeHtml((b.text || "").slice(0, 90))}</div>`;
      row.addEventListener("click", () => {
        narrationSelectedBeat = b.beatId;
        renderNarrationList();
        renderNarrationDetail();
      });
      narrationList.appendChild(row);
    });
  }

  function renderNarrationDetail() {
    if (!narrationDetail) return;
    const b = ((narrationPlan && narrationPlan.beats) || [])
      .find(x => x.beatId === narrationSelectedBeat);
    if (!b) {
      narrationDetail.innerHTML = `<p class="empty-state">Chọn một beat để xem và chỉnh.</p>`;
      return;
    }
    const styleVi = { NEUTRAL: "Trung tính", AUTHORITATIVE: "Dẫn dắt", CURIOUS: "Tò mò", MYSTERIOUS: "Bí ẩn", OMINOUS: "U ám", TENSE: "Căng thẳng", URGENT: "Khẩn trương", SOMBER: "Trầm buồn", REFLECTIVE: "Suy ngẫm", AWE: "Kinh ngạc", EXCITED: "Hào hứng", REVEAL: "Hé lộ" };
    const styleOpts = ["NEUTRAL", "AUTHORITATIVE", "CURIOUS", "MYSTERIOUS", "OMINOUS",
      "TENSE", "URGENT", "SOMBER", "REFLECTIVE", "AWE", "EXCITED", "REVEAL"]
      .map(s => `<option value="${s}"${s === b.style ? " selected" : ""}>${styleVi[s] || s}</option>`).join("");
    narrationDetail.innerHTML =
      `<div class="form-group"><span class="form-label">Vai trò kể chuyện</span>` +
      `<div class="form-hint">${escapeHtml(b.role || "")}</div></div>` +
      `<div class="form-group"><label class="form-label" for="nb-style">Phong cách đọc</label>` +
      `<select id="nb-style" class="form-select">${styleOpts}</select></div>` +
      `<div class="form-group"><label class="form-label" for="nb-intensity">Cường độ (${Number(b.intensity ?? 0).toFixed(2)})</label>` +
      `<input id="nb-intensity" class="form-slider" type="range" min="0" max="1" step="0.01" value="${b.intensity ?? 0.3}" aria-label="Cường độ"></div>` +
      `<div class="form-group"><label class="form-label" for="nb-rate">Tốc độ (${Number(b.rate ?? 1).toFixed(2)})</label>` +
      `<input id="nb-rate" class="form-slider" type="range" min="0.85" max="1.15" step="0.01" value="${b.rate ?? 1}" aria-label="Tốc độ"></div>` +
      `<div class="modal-grid-2"><div class="form-group"><label class="form-label" for="nb-pb">Nghỉ trước (s)</label>` +
      `<input id="nb-pb" class="form-input" type="number" min="0" max="2" step="0.05" value="${b.pauseBefore ?? 0}"></div>` +
      `<div class="form-group"><label class="form-label" for="nb-pa">Nghỉ sau (s)</label>` +
      `<input id="nb-pa" class="form-input" type="number" min="0" max="2" step="0.05" value="${b.pauseAfter ?? 0}"></div></div>` +
      `<div class="form-group"><label class="form-label" for="nb-emph">Nhấn mạnh (phân tách dấu phẩy)</label>` +
      `<input id="nb-emph" class="form-input" value="${escapeHtml((b.emphasis || []).join(", "))}"></div>` +
      `<div class="form-group"><span class="form-label">Độ tin cậy</span>` +
      `<div class="form-hint">${Math.round((b.confidence ?? 0) * 100)}%${b.manualEdited ? " · đã chỉnh tay" : ""}</div></div>` +
      `<div class="form-group"><span class="form-label">Lý do</span>` +
      `<div class="form-hint">${escapeHtml(b.reason || "")}</div></div>` +
      `<div class="form-group"><span class="form-label">Bằng chứng</span>` +
      `<div class="form-hint">${escapeHtml((b.evidence || []).join(" · "))}</div></div>` +
      `<div class="pron-btn-group">` +
      `<button id="nb-preview" class="btn btn-sm btn-secondary" type="button"><svg class="icon" aria-hidden="true"><use href="#icon-play" /></svg><span>Nghe thử</span></button>` +
      `<button id="nb-accept" class="btn btn-sm btn-secondary" type="button"><span>Chấp nhận</span></button>` +
      `<button id="nb-reset" class="btn btn-sm btn-secondary" type="button"><span>Đặt lại Auto</span></button>` +
      `<button id="nb-save" class="btn btn-sm btn-primary" type="button"><span>Lưu thay đổi</span></button>` +
      `</div>`;
    const val = id => { const el = document.getElementById(id); return el ? el.value : null; };
    document.getElementById("nb-preview").addEventListener("click", () => previewBeat(b.beatId, false));
    document.getElementById("nb-accept").addEventListener("click", () => saveBeat(b.beatId, { accepted: true }));
    document.getElementById("nb-reset").addEventListener("click", async () => {
      if (!currentProjectDir) return;
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/narration/analyze`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "auto", force: true })
        });
        if (!res.ok) throw new Error("Không thể đặt lại.");
        await refreshNarrationPlan(currentProjectDir);
        renderNarrationList();
        renderNarrationDetail();
        showNotification("Đã đặt lại beat theo Auto.", "success");
      } catch (err) { showNotification(`Lỗi: ${err.message}`, "error"); }
    });
    document.getElementById("nb-save").addEventListener("click", () => {
      const emph = (val("nb-emph") || "").split(",").map(s => s.trim()).filter(Boolean);
      saveBeat(b.beatId, {
        style: val("nb-style"),
        intensity: parseFloat(val("nb-intensity")),
        rate: parseFloat(val("nb-rate")),
        pauseBefore: parseFloat(val("nb-pb")),
        pauseAfter: parseFloat(val("nb-pa")),
        emphasis: emph,
      });
    });
  }

  async function saveBeat(beatId, patch) {
    if (!currentProjectDir) return;
    const dirName = currentProjectDir;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/narration/beats/${encodeURIComponent(beatId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Không thể lưu beat.");
      }
      await refreshNarrationPlan(dirName);
      renderNarrationList();
      renderNarrationDetail();
      showNotification("Đã lưu beat.", "success");
    } catch (err) {
      if (currentProjectDir !== dirName) return;
      showNotification(`Lỗi lưu beat: ${err.message}`, "error");
    }
  }

  async function previewBeat(beatId, isSummary) {
    if (!currentProjectDir || !narrationPreviewPlayer) return;
    const dirName = currentProjectDir;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/narration/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isSummary ? {} : { beat_id: beatId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Không thể tạo preview.");
      }
      if (currentProjectDir !== dirName) return; // stale guard: never hydrate wrong project
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const old = narrationPreviewPlayer.dataset.blobUrl;
      if (old) URL.revokeObjectURL(old);
      narrationPreviewPlayer.dataset.blobUrl = url;
      narrationPreviewPlayer.src = url;
      narrationPreviewPlayer.play().catch(() => {});
    } catch (err) {
      if (currentProjectDir !== dirName) return;
      showNotification(`Lỗi preview: ${err.message}`, "error");
    }
  }

  async function reanalyzeNarration() {
    if (!currentProjectDir) {
      showNotification("Hãy mở một dự án trước.", "warning");
      return;
    }
    const dirName = currentProjectDir;
    try {
      const cur = await (await fetch(`/api/projects/${encodeURIComponent(dirName)}/narration/plan`)).json();
      const manual = (cur.plan?.beats || []).filter(b => b.manualEdited).length;
      const go = async () => {
        const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/narration/analyze`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: selectedNarrationMode(), force: true })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Không thể phân tích lại.");
        }
        if (currentProjectDir !== dirName) return;
        await refreshNarrationPlan(dirName);
        renderNarrationList();
        showNotification("Đã phân tích lại narration.", "success");
      };
      if (manual > 0) {
        showConfirmDialog({
          variant: "warning",
          title: "Phân tích lại Narration?",
          message: `Có ${manual} beat chỉnh tay. Các chỉnh sửa diễn cảm thủ công có thể bị thay thế.`,
          confirmText: "Phân tích lại",
          cancelText: "Hủy",
          onConfirm: () => { go(); }
        });
      } else {
        await go();
      }
    } catch (err) {
      showNotification(`Lỗi: ${err.message}`, "error");
    }
  }

  const btnOpenNarration = document.getElementById("btn-open-narration");
  if (btnOpenNarration) btnOpenNarration.addEventListener("click", openNarrationModal);
  const btnReanalyze = document.getElementById("btn-reanalyze-narration");
  if (btnReanalyze) btnReanalyze.addEventListener("click", reanalyzeNarration);
  const narrationModalClose = document.getElementById("narration-modal-close-btn");
  if (narrationModalClose) narrationModalClose.addEventListener("click", closeNarrationModal);
  const narrationModalDone = document.getElementById("narration-modal-done-btn");
  if (narrationModalDone) narrationModalDone.addEventListener("click", closeNarrationModal);
  const narrFilterAll = document.getElementById("narration-filter-all");
  if (narrFilterAll) narrFilterAll.addEventListener("click", () => {
    narrationReviewOnly = false; renderNarrationList();
  });
  const narrFilterReview = document.getElementById("narration-filter-review");
  if (narrFilterReview) narrFilterReview.addEventListener("click", () => {
    narrationReviewOnly = true; renderNarrationList();
  });
  document.querySelectorAll('input[name="narration-mode"]').forEach(el => {
    el.addEventListener("change", saveUserSettings);
  });
  const narrationProfileSelect = document.getElementById("narration-profile-select");
  if (narrationProfileSelect) narrationProfileSelect.addEventListener("change", saveUserSettings);

  // ==============================================================================
  // 13c. VISUAL CONTINUITY DIRECTOR & VISUAL BIBLE (Phase 10 — hidden, no sidebar step)
  // ==============================================================================
  let visualBibleData = null;
  let visualContinuityStatus = "Not Generated";
  let visualContinuityIssues = [];
  let visualBibleGen = 0;
  let visualBibleSelectedTab = "subjects";
  let visualBibleSelectedEntityId = null;
  let visualBibleSearchFilter = "";
  let visualBibleIssueFilter = "all";

  const vbModal = document.getElementById("visual-bible-modal");
  const vbModalCloseBtn = document.getElementById("vb-modal-close-btn");
  const vbModalDoneBtn = document.getElementById("vb-modal-done-btn");
  const vbBtnRederive = document.getElementById("vb-btn-rederive");
  const vbEntitySearch = document.getElementById("vb-entity-search");
  const vbTabContentEntities = document.getElementById("vb-tab-content-entities");
  const vbTabContentIssues = document.getElementById("vb-tab-content-issues");
  const vbEntityItems = document.getElementById("vb-entity-items");
  const vbEntityInspector = document.getElementById("vb-entity-inspector");
  const vbIssuesList = document.getElementById("vb-issues-list");
  const vbIssuesSummaryText = document.getElementById("vb-issues-summary-text");
  const vbFooterHash = document.getElementById("vb-footer-hash");
  const vbModalStatusPill = document.getElementById("vb-modal-status-pill");

  async function loadVisualBible(dirName) {
    const gen = ++visualBibleGen;
    if (!dirName) {
      visualBibleData = null;
      visualContinuityStatus = "Not Generated";
      visualContinuityIssues = [];
      updateVisualContinuityUI();
      return;
    }
    try {
      const [resVb, resIss, resV2] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(dirName)}/visual-bible`),
        fetch(`/api/projects/${encodeURIComponent(dirName)}/visual-bible/issues`),
        fetch(`/api/projects/${encodeURIComponent(dirName)}/visual-bible/v2`)
      ]);

      if (currentProjectDir !== dirName || gen !== visualBibleGen) return;

      if (resVb.ok) {
        const vbJson = await resVb.json();
        visualBibleData = vbJson.visual_bible || null;
        visualContinuityStatus = vbJson.status || (visualBibleData ? "Ready" : "Not Generated");
      } else {
        visualBibleData = null;
        visualContinuityStatus = "Not Generated";
      }
      // Phase 13: merge V2 summary (migration flag, style, presets, completeness).
      try {
        if (resV2 && resV2.ok) {
          const v2j = await resV2.json();
          if (visualBibleData && v2j.exists) {
            visualBibleData._v2 = v2j;
            if ((v2j.characters || []).length) visualBibleData.characters = v2j.characters;
            if ((v2j.objects || []).length) visualBibleData.objects = v2j.objects;
          } else if (visualBibleData) {
            visualBibleData._v2 = v2j;
          }
        }
      } catch (e) { console.warn("VB v2 merge skipped:", e); }
      window.currentVisualBible = visualBibleData;

      if (resIss.ok) {
        const issJson = await resIss.json();
        visualContinuityIssues = issJson.issues || [];
        if (issJson.blocking_count > 0) {
          visualContinuityStatus = "Review";
        }
      } else {
        visualContinuityIssues = [];
      }

      updateVisualContinuityUI();
      updateDependencyState();
    } catch (err) {
      console.warn("Failed to load visual bible:", err);
    }
  }

  function updateVisualContinuityUI() {
    const subs = (visualBibleData?.subjects || []).length;
    const envs = (visualBibleData?.environments || []).length;
    const pers = (visualBibleData?.periods || []).length;
    const props = (visualBibleData?.props || []).length;
    const grps = (visualBibleData?.continuityGroups || []).length;
    const blockingConflicts = visualContinuityIssues.filter(i => i.severity === "ERROR").length;
    const warnConflicts = visualContinuityIssues.filter(i => i.severity === "WARNING").length;

    const pillClass = (visualContinuityStatus === "Ready" || visualContinuityStatus === "PASS")
      ? "state-ready"
      : (visualContinuityStatus === "Outdated" || visualContinuityStatus === "OUTDATED")
      ? "state-stale"
      : (visualContinuityStatus === "Review" || visualContinuityStatus === "ERROR" || blockingConflicts > 0)
      ? "state-error"
      : "state-idle";

    const rawStatus = (visualContinuityStatus === "Ready" && blockingConflicts > 0)
      ? "REVIEW"
      : (visualContinuityStatus || "NOT GENERATED").toUpperCase();
    const viStatusMap = { "READY": "Sẵn sàng", "PASS": "Đạt", "REVIEW": "Cần xem xét", "NOT GENERATED": "Chưa tạo", "OUTDATED": "Cần tạo lại", "STALE": "Cần tạo lại", "ERROR": "Lỗi", "LOCKED": "Đã khóa" };
    const displayStatus = viStatusMap[rawStatus] || rawStatus;

    // Contextual Inspector Badges & Counts
    ["scenes", "veo"].forEach(prefix => {
      const badge = document.getElementById(`vc-status-badge-${prefix}`);
      if (badge) {
        badge.className = `state-pill ${pillClass}`;
        badge.textContent = displayStatus;
      }
      const sEl = document.getElementById(`vc-subjects-count-${prefix}`);
      if (sEl) sEl.textContent = subs;
      const eEl = document.getElementById(`vc-envs-count-${prefix}`);
      if (eEl) eEl.textContent = envs;
      const gEl = document.getElementById(`vc-groups-count-${prefix}`);
      if (gEl) gEl.textContent = grps;
      const cEl = document.getElementById(`vc-conflicts-count-${prefix}`);
      if (cEl) {
        cEl.textContent = blockingConflicts;
        cEl.style.color = blockingConflicts > 0 ? "#ef4444" : "inherit";
      }
    });

    // Modal counts & status
    if (vbModalStatusPill) {
      vbModalStatusPill.className = `state-pill ${pillClass}`;
      vbModalStatusPill.textContent = displayStatus;
    }
    const setTabCount = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    };
    setTabCount("vb-tab-count-subjects", subs);
    setTabCount("vb-tab-count-environments", envs);
    setTabCount("vb-tab-count-periods", pers);
    setTabCount("vb-tab-count-props", props);
    setTabCount("vb-tab-count-groups", grps);
    setTabCount("vb-tab-count-issues", blockingConflicts + warnConflicts);
    // Phase 13 V2 counts + corrective cast count
    const v2 = visualBibleData?._v2 || {};
    setTabCount("vb-tab-count-characters", (v2.characters || []).length || subs);
    setTabCount("vb-tab-count-objects", (v2.objects || []).length || props);
    setTabCount("vb-tab-count-references", (v2.referenceAssets || []).length);
    setTabCount("vb-tab-count-cast",
      ((visualBibleData?.characters || []).filter(c =>
        (c.entityKind || "SUBJECT_GROUP") === "REPRESENTATIVE_CHARACTER")).length);
    updateVbTabVisibility();

    if (vbFooterHash) {
      const h = visualBibleData?.visualBibleHash;
      vbFooterHash.textContent = h ? `Hash: ${h.slice(0, 16)}...` : "Chưa tạo Visual Bible";
    }

    // If modal open, refresh current tab
    if (vbModal && vbModal.style.display !== "none") {
      if (visualBibleSelectedTab === "issues") {
        renderVisualBibleIssues();
      } else if (visualBibleSelectedTab === "style") {
        renderVbStylePane();
      } else if (visualBibleSelectedTab === "references") {
        renderVbReferencesPane();
      } else {
        renderVisualBibleEntities();
      }
    }
  }

  function openVisualBibleModal() {
    if (!vbModal) return;
    uqModalOpen(vbModal);
    if (visualBibleSelectedTab === "issues") {
      renderVisualBibleIssues();
    } else if (visualBibleSelectedTab === "style") {
      renderVbStylePane();
    } else if (visualBibleSelectedTab === "references") {
      renderVbReferencesPane();
    } else {
      renderVisualBibleEntities();
    }
  }

  function closeVisualBibleModal() {
    uqModalClose(vbModal);
  }

  // Hook tab switching
  // P1 (§13): tablist keyboard — Arrow/Home/End + aria-selected động.
  const vbTabBtns = Array.from(document.querySelectorAll(".vb-tab-btn"));
  vbTabBtns.forEach((btn, i) => {
    if (!btn.hasAttribute("tabindex")) btn.setAttribute("tabindex", i === 0 ? "0" : "-1");
    btn.addEventListener("keydown", (e) => {
      let j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % vbTabBtns.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + vbTabBtns.length) % vbTabBtns.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = vbTabBtns.length - 1;
      if (j !== null && vbTabBtns[j]) {
        e.preventDefault();
        vbTabBtns.forEach(b => b.setAttribute("tabindex", "-1"));
        vbTabBtns[j].setAttribute("tabindex", "0");
        vbTabBtns[j].focus();
        vbTabBtns[j].click();
      }
    });
  });
  document.querySelectorAll(".vb-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".vb-tab-btn").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      visualBibleSelectedTab = btn.getAttribute("data-tab");
      visualBibleSelectedEntityId = null;

      const vbStylePane = document.getElementById("vb-tab-content-style");
      const vbRefPane = document.getElementById("vb-tab-content-references");
      if (visualBibleSelectedTab === "issues") {
        if (vbTabContentEntities) vbTabContentEntities.style.display = "none";
        if (vbTabContentIssues) vbTabContentIssues.style.display = "flex";
        if (vbStylePane) vbStylePane.style.display = "none";
        if (vbRefPane) vbRefPane.style.display = "none";
        renderVisualBibleIssues();
      } else if (visualBibleSelectedTab === "style") {
        if (vbTabContentEntities) vbTabContentEntities.style.display = "none";
        if (vbTabContentIssues) vbTabContentIssues.style.display = "none";
        if (vbStylePane) vbStylePane.style.display = "block";
        if (vbRefPane) vbRefPane.style.display = "none";
        renderVbStylePane();
      } else if (visualBibleSelectedTab === "references") {
        if (vbTabContentEntities) vbTabContentEntities.style.display = "none";
        if (vbTabContentIssues) vbTabContentIssues.style.display = "none";
        if (vbStylePane) vbStylePane.style.display = "none";
        if (vbRefPane) vbRefPane.style.display = "block";
        renderVbReferencesPane();
      } else {
        if (vbTabContentEntities) vbTabContentEntities.style.display = "grid";
        if (vbTabContentIssues) vbTabContentIssues.style.display = "none";
        if (vbStylePane) vbStylePane.style.display = "none";
        if (vbRefPane) vbRefPane.style.display = "none";
        renderVisualBibleEntities();
      }
    });
  });

  if (vbEntitySearch) {
    vbEntitySearch.addEventListener("input", (e) => {
      visualBibleSearchFilter = e.target.value.toLowerCase().trim();
      renderVisualBibleEntities();
    });
  }

  function getEntitiesForTab(tab) {
    if (!visualBibleData) return [];
    switch (tab) {
      case "subjects": return visualBibleData.subjects || [];
      case "environments": return visualBibleData.environments || [];
      case "periods": return visualBibleData.periods || [];
      case "props": return visualBibleData.props || [];
      case "groups": return visualBibleData.continuityGroups || [];
      // Corrective: cast = representative individuals only (never groups).
      case "cast":
        return (visualBibleData.characters || []).filter(c =>
          (c.entityKind || "SUBJECT_GROUP") === "REPRESENTATIVE_CHARACTER");
      // Phase 13 V2 views with legacy fallback (non-mutating).
      case "characters":
        if ((visualBibleData.characters || []).length) return visualBibleData.characters;
        return (visualBibleData.subjects || []).map(s => ({ ...s, characterId: s.subjectId }));
      case "objects":
        if ((visualBibleData.objects || []).length) return visualBibleData.objects;
        return (visualBibleData.props || []).map(p => ({ ...p, objectId: p.propId }));
      default: return [];
    }
  }

  function getEntityIdKey(tab) {
    switch (tab) {
      case "subjects": return "subjectId";
      case "environments": return "environmentId";
      case "periods": return "periodId";
      case "props": return "propId";
      case "groups": return "continuityGroupId";
      case "characters": return "characterId";
      case "cast": return "characterId";
      case "objects": return "objectId";
      default: return "id";
    }
  }

  function isMigratedV2() {
    return String(visualBibleData?.schemaVersion || "1.0.0").startsWith("2.");
  }

  function isV2Tab(tab) {
    return (tab === "characters" || tab === "objects" || tab === "cast") && isMigratedV2();
  }

  // Corrective §15–16: legacy + V2 tabs coexist in DOM; only the canonical
  // set is shown. Legacy tabs stay for unmigrated projects.
  function updateVbTabVisibility() {
    const migrated = isMigratedV2();
    document.querySelectorAll(".vb-tab-btn[data-legacy-tab]").forEach(b => {
      b.style.display = migrated ? "none" : "";
    });
    const castBtn = document.querySelector('.vb-tab-btn[data-tab="cast"]');
    if (castBtn) castBtn.style.display = "";
    if (migrated && (visualBibleSelectedTab === "props" || visualBibleSelectedTab === "characters")) {
      visualBibleSelectedTab = "cast";
      document.querySelectorAll(".vb-tab-btn").forEach(b => {
        const on = b.getAttribute("data-tab") === "cast";
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
  }

  function renderVisualBibleEntities() {
    if (!vbEntityItems || !vbEntityInspector) return;
    // Corrective: cast suggestions box only on the cast tab.
    const suggestBox = document.getElementById("vb-cast-suggest-box");
    if (suggestBox) {
      suggestBox.style.display = visualBibleSelectedTab === "cast" ? "block" : "none";
      if (visualBibleSelectedTab === "cast") renderCastSuggestBox();
    }
    const entities = getEntitiesForTab(visualBibleSelectedTab);
    const idKey = getEntityIdKey(visualBibleSelectedTab);

    const filtered = entities.filter(ent => {
      if (!visualBibleSearchFilter) return true;
      const text = JSON.stringify(ent).toLowerCase();
      return text.includes(visualBibleSearchFilter);
    });

    if (filtered.length === 0) {
      vbEntityItems.innerHTML = `<p class="empty-state" style="padding: 1.5rem 0.5rem;">Không có mục nào trong danh mục này.</p>`;
      vbEntityInspector.innerHTML = `<div class="empty-state">Chọn một thực thể để xem chi tiết.</div>`;
      return;
    }

    if (!visualBibleSelectedEntityId || !filtered.some(e => e[idKey] === visualBibleSelectedEntityId)) {
      visualBibleSelectedEntityId = filtered[0][idKey];
    }

    vbEntityItems.innerHTML = filtered.map(ent => {
      const id = ent[idKey];
      const isAct = id === visualBibleSelectedEntityId;
      const title = ent.name || ent.locationName || ent.label || id;
      const desc = ent.canonicalDescription || ent.visualDescription || ent.description || ent.biome || ent.terrain || (ent.visualAnchors ? ent.visualAnchors[0] : "") || "";
      const isManual = ent.manualEdited ? `<span class="badge" style="background: rgba(56,189,248,0.2); color:#38bdf8; margin-left: 4px;">Thủ công</span>` : "";
      // Corrective §15: explicit kind badge so groups are never read as individuals.
      const lookupKind = (visualBibleData.characters || []).find(c =>
        (c.characterId || c.subjectId) === (ent.subjectId || ent.characterId));
      const kind = ent.entityKind
        || (lookupKind ? (lookupKind.entityKind || "") : "")
        || (ent.type === "GROUP" ? "SUBJECT_GROUP" : "")
        || (visualBibleSelectedTab === "subjects" ? "SUBJECT_GROUP" : "");
      const kindBadge = kind ? `<span class="badge" style="background: rgba(245,158,11,0.15); color:#f59e0b; margin-left: 4px;">${escapeHtml(kind)}</span>` : "";
      const histBadge = ent.historicalStatus ? `<span class="badge" style="background: rgba(16,185,129,0.15); color:#34d399; margin-left: 4px;">${escapeHtml(ent.historicalStatus)}</span>` : "";

      return `
        <div class="vb-entity-card ${isAct ? 'active' : ''}" data-id="${escapeHtml(id)}" title="${escapeHtml(desc)}">
          <div class="vb-card-header">
            <span class="vb-card-title">${escapeHtml(title)}</span>
            ${isManual}${kindBadge}${histBadge}
          </div>
          <div class="vb-card-desc" title="${escapeHtml(desc)}">${escapeHtml(desc)}</div>
        </div>
      `;
    }).join("");

    vbEntityItems.querySelectorAll(".vb-entity-card").forEach(card => {
      card.addEventListener("click", () => {
        visualBibleSelectedEntityId = card.getAttribute("data-id");
        renderVisualBibleEntities();
      });
    });

    const activeEnt = filtered.find(e => e[idKey] === visualBibleSelectedEntityId);
    if (activeEnt) {
      renderVisualBibleInspector(activeEnt, visualBibleSelectedTab);
    }
  }

  function renderVisualBibleInspector(ent, tab) {
    if (!vbEntityInspector) return;
    const idKey = getEntityIdKey(tab);
    const id = ent[idKey];
    const name = ent.name || ent.locationName || ent.label || id;
    const anchors = ent.visualAnchors || [];
    const forbidden = ent.forbiddenModernElements || [];
    const scenes = ent.sourceSceneIds || ent.sceneIds || [];
    const manual = ent.manualEdited;

    const singType = tab === "groups" ? "continuityGroup" : tab.replace(/s$/, "");
    const isCast = tab === "cast";
    const v2 = isV2Tab(tab);
    const tax = ent.taxonomy || {};
    const demo = ent.demographics || {};
    const v2line = [tax.speciesOrPopulation, demo.ageGroup, demo.sex, ent.role].filter(Boolean).join(" · ");
    const v2status = ent.status || "REVIEW";
    // Corrective §17: canonical description fallback — migration stores identity
    // in visualDescription/bodyCharacteristics; never show a blank box when data exists.
    const canDesc = ent.canonicalDescription || ent.visualDescription
      || ent.description || ent.bodyCharacteristics || ent.biome || "";
    const canDescSource = ent.canonicalDescription ? "canonical (đã duyệt)"
      : (ent.visualDescription || ent.bodyCharacteristics) ? "kế thừa từ mô tả visual (chưa duyệt canonical)"
      : "trống — cần nhập (REVIEW)";

    vbEntityInspector.innerHTML = `
      <div class="vb-detail-section">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem;">
          <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--uq-ink-1); margin: 0;">${escapeHtml(name)}</h4>
          <span class="badge" style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(id)}</span>
        </div>
        ${manual ? '<div style="margin-bottom: 0.75rem;"><span class="badge" style="background: rgba(56,189,248,0.25); color: #38bdf8;">Đã chỉnh sửa thủ công</span></div>' : ''}
      </div>

      <div class="vb-detail-section">
        <div class="vb-detail-title">Mô tả quy chuẩn (Canonical Description)</div>
        <div class="prod-history-meta" style="margin-bottom:0.25rem;">Nguồn: ${escapeHtml(canDescSource)}</div>
        <textarea id="vb-edit-desc" class="form-textarea" rows="3" style="width: 100%; font-size: 0.82rem;">${escapeHtml(canDesc)}</textarea>
      </div>

      ${isCast ? `
        <div class="vb-detail-section">
          <div class="vb-detail-title">Đại diện sản xuất (§40)</div>
          <div class="prod-readiness-list">
            <div class="prod-readiness-row"><span>Dựa trên</span><span>${escapeHtml(ent.sourceSubjectId || "—")}</span></div>
            <div class="prod-readiness-row"><span>Lịch sử</span><span>${escapeHtml(ent.historicalStatus || "—")}</span></div>
            <div class="prod-readiness-row"><span>Vai trò</span><span>${escapeHtml(ent.role || "—")}</span></div>
          </div>
          <div class="prod-history-meta" style="margin-top:0.25rem;">Nhân vật tái hiện sản xuất — không phải cá thể lịch sử đã xác minh.</div>
        </div>
        <div class="vb-detail-section" id="vb-cast-refsetup">
          <div class="vb-detail-title">Reference setup (§22)</div>
          <div class="prod-readiness-list" id="vb-cast-refreadiness">
            <div class="prod-readiness-row"><span>Canonical identity</span><span>…</span></div>
          </div>
          <div class="detail-actions-bar" style="margin-top:0.4rem;">
            <button class="btn btn-secondary btn-sm" data-refcopy="FRONT"><span>Sao chép prompt chính diện</span></button>
            <button class="btn btn-secondary btn-sm" data-refcopy="THREE_QUARTER"><span>Sao chép prompt góc 3/4</span></button>
            <button class="btn btn-secondary btn-sm" data-refcopy="PROFILE"><span>Sao chép prompt góc nghiêng</span></button>
          </div>
          <div class="prod-history-meta">Import ảnh tại tab Tham chiếu (chọn đúng nhân vật này).</div>
        </div>
      ` : ''}

      ${anchors.length > 0 ? `
        <div class="vb-detail-section">
          <div class="vb-detail-title">Visual Anchors</div>
          <div class="vb-tag-list">
            ${anchors.map(a => `<span class="vb-tag">${escapeHtml(a)}</span>`).join("")}
          </div>
        </div>
      ` : ''}

      ${forbidden.length > 0 ? `
        <div class="vb-detail-section">
          <div class="vb-detail-title">Forbidden Elements (Yếu tố cấm kỵ)</div>
          <div class="vb-tag-list">
            ${forbidden.map(f => `<span class="vb-tag vb-tag-warning">${escapeHtml(f)}</span>`).join("")}
          </div>
        </div>
      ` : ''}

      ${scenes.length > 0 ? `
        <div class="vb-detail-section">
          <div class="vb-detail-title">Liên kết Scene</div>
          <div class="vb-tag-list">
            ${scenes.map(s => `<span class="vb-tag" style="background: rgba(16,185,129,0.15); color: #34d399;">${escapeHtml(s)}</span>`).join("")}
          </div>
        </div>
      ` : ''}

      ${v2 ? `
        <div class="vb-detail-section">
          <div class="vb-detail-title">Canonical V2 (Phase 13)</div>
          ${v2line ? `<div class="prod-history-meta" style="margin-bottom:0.3rem;">${escapeHtml(v2line)}</div>` : ""}
          <label class="form-label" for="vb-edit-status">Trạng thái</label>
          <select id="vb-edit-status" class="form-select form-input-sm">
            ${["NOT_STARTED", "REVIEW", "READY"].map(o => `<option value="${o}" ${v2status === o ? "selected" : ""}>${o}</option>`).join("")}
          </select>
          <div class="prod-history-meta" id="vb-v2-refs" style="margin-top:0.3rem;">Đang tính refs…</div>
          <div class="prod-history-meta" id="vb-v2-impact" style="margin-top:0.2rem;"></div>
        </div>
      ` : ''}

      <div class="vb-detail-section">
        <div class="vb-detail-title">Ghi chú bổ sung (Notes)</div>
        <input type="text" id="vb-edit-notes" class="form-input form-input-sm" value="${escapeHtml(ent.notes || '')}" placeholder="Ghi chú thêm cho thực thể...">
      </div>

      <div class="vb-inspector-actions">
        <button type="button" id="vb-btn-save-entity" class="btn btn-primary btn-sm">
          <span>Lưu thay đổi</span>
        </button>
        <button type="button" id="vb-btn-reset-entity" class="btn btn-secondary btn-sm" ${!manual ? 'disabled' : ''}>
          <span>Đặt lại Auto</span>
        </button>
      </div>
    `;

    // Save entity listener
    const btnSave = document.getElementById("vb-btn-save-entity");
    if (btnSave) {
      // Phase 13: show canonical refs + affected downstream for V2 entities.
      if (v2 && currentProjectDir) {
        const kind = (tab === "characters" || tab === "cast") ? "character" : "object";
        fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/dependencies/impact`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, id })
        }).then(r => r.ok ? r.json() : null).then(imp => {
          const refsEl = document.getElementById("vb-v2-refs");
          const impEl = document.getElementById("vb-v2-impact");
          if (!imp) return;
          if (refsEl) refsEl.textContent = `Scenes tham chiếu: ${imp.affectedScenes.length ? imp.affectedScenes.slice(0, 8).join(", ") + (imp.affectedScenes.length > 8 ? "…" : "") : "—"}`;
          if (impEl) impEl.textContent = `Sửa identity → ${imp.affectedScenes.length} scenes / ${imp.affectedShots.length} shots stale (chỉ downstream liên quan).`;
        }).catch(() => {});
      }
      btnSave.addEventListener("click", async () => {
        if (!currentProjectDir) return;
        const newDesc = document.getElementById("vb-edit-desc")?.value?.trim();
        const newNotes = document.getElementById("vb-edit-notes")?.value?.trim();
        const newStatus = document.getElementById("vb-edit-status")?.value;

        btnSave.disabled = true;
        btnSave.innerHTML = `<span>Đang lưu...</span>`;

        try {
          if (v2) {
            const kind = (tab === "characters" || tab === "cast") ? "character" : "object";
            const updates = { notes: newNotes };
            // Corrective §18: cast edits canonical identity; others edit visual description.
            if (newDesc) {
              if (tab === "cast") updates.canonicalDescription = newDesc;
              else updates.visualDescription = newDesc;
            }
            if (newStatus) updates.status = newStatus;
            const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual-bible/v2/entities/${encodeURIComponent(id)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind, entity_id: id, updates })
            });
            if (res.ok) {
              const data = await res.json();
              const aff = data.applied || {};
              showNotification(`Đã lưu V2 (${aff.affectedScenes ? aff.affectedScenes.length : 0} scenes stale).`, "success");
              await loadVisualBible(currentProjectDir);
              refreshDependencyStatus(currentProjectDir);
            } else {
              const err = await res.json();
              showNotification("Lỗi khi cập nhật thực thể V2: " + (err.detail || "Thao tác thất bại"), "error");
            }
            return;
          }
          const updates = {};
          if (ent.canonicalDescription !== undefined || ent.description !== undefined) {
            updates.canonicalDescription = newDesc;
          } else {
            updates.description = newDesc;
          }
          if (newNotes !== undefined) updates.notes = newNotes;

          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual-bible/entity`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity_type: singType,
              entity_id: id,
              updates
            })
          });

          if (res.ok) {
            await loadVisualBible(currentProjectDir);
          } else {
            const err = await res.json();
            alert("Lỗi khi cập nhật thực thể: " + (err.detail || "Thao tác thất bại"));
          }
        } catch (e) {
          console.error("Save entity error:", e);
        } finally {
          btnSave.disabled = false;
          btnSave.innerHTML = `<span>Lưu thay đổi</span>`;
        }
      });
    }

    // Reset entity listener
    const btnReset = document.getElementById("vb-btn-reset-entity");    if (btnReset && manual) {
      btnReset.addEventListener("click", async () => {
        if (!currentProjectDir) return;
        btnReset.disabled = true;
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual-bible/entity`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity_type: singType,
              entity_id: id,
              updates: { manualEdited: false }
            })
          });
          if (res.ok) {
            await loadVisualBible(currentProjectDir);
          }
        } catch (e) {
          console.error("Reset entity error:", e);
        }
      });
    }

    // Corrective §22: cast reference readiness + prompt copy wiring.
    if (isCast && currentProjectDir) {
      loadCastRefReadiness(id);
      document.querySelectorAll("#vb-cast-refsetup [data-refcopy]").forEach(btn => {
        btn.addEventListener("click", () => copyCastRefPrompt(id, btn.getAttribute("data-refcopy")));
      });
    }
  }

  async function loadCastRefReadiness(characterId) {
    const el = document.getElementById("vb-cast-refreadiness");
    if (!el || !currentProjectDir) return;
    try {
      const v2 = visualBibleData?._v2 || {};
      const comp = (v2.completeness || {})[characterId] || { status: "NOT_STARTED", viewsPresent: [], viewsMissing: ["FRONT", "THREE_QUARTER", "PROFILE"] };
      const hasCanon = !!(visualBibleData?.characters || []).find(c => c.characterId === characterId)?.canonicalDescription;
      const row = (k, v, ok) => `<div class="prod-readiness-row"><span>${k}</span><span class="prod-readiness-val ${ok ? "is-ok" : "is-bad"}">${v}</span></div>`;
      el.innerHTML =
        row("Canonical identity", hasCanon ? "READY" : "MISSING", hasCanon) +
        ["FRONT", "THREE_QUARTER", "PROFILE"].map(vv => {
          const has = (comp.viewsPresent || []).includes(vv);
          return row(vv, has ? "READY" : "MISSING", has);
        }).join("") +
        row("Completeness", comp.status || "NOT_STARTED", comp.status === "READY");
    } catch (err) {
      console.warn("cast readiness failed:", err);
    }
  }

  async function copyCastRefPrompt(characterId, view) {
    if (!currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/cast/${encodeURIComponent(characterId)}/ref-prompts`);
      if (!res.ok) throw new Error("Không tải được prompt pack.");
      const pack = await res.json();
      const text = pack[view] || "";
      if (navigator.clipboard) await navigator.clipboard.writeText(text);
      showNotification(`Đã sao chép ${view} prompt (${characterId}).`, "success");
    } catch (err) {
      showNotification(err.message, "error");
    }
  }

  function renderVisualBibleIssues() {
    if (!vbIssuesList) return;
    const issues = visualContinuityIssues || [];

    const filtered = issues.filter(iss => {
      if (visualBibleIssueFilter === "blocking") return iss.severity === "ERROR";
      if (visualBibleIssueFilter === "warnings") return iss.severity === "WARNING";
      return true;
    });

    if (vbIssuesSummaryText) {
      const errCount = issues.filter(i => i.severity === "ERROR").length;
      const warnCount = issues.filter(i => i.severity === "WARNING").length;
      vbIssuesSummaryText.textContent = `${errCount} lỗi chặn, ${warnCount} cảnh báo`;
    }

    if (filtered.length === 0) {
      vbIssuesList.innerHTML = `<p class="empty-state" style="padding: 2rem;">Tuyệt vời! Không phát hiện xung đột liên tục hình ảnh nào.</p>`;
      return;
    }

    vbIssuesList.innerHTML = filtered.map(iss => {
      const sevClass = iss.severity === "ERROR" ? "severity-error" : (iss.severity === "WARNING" ? "severity-warning" : "severity-pass");
      const sevBadge = iss.severity === "ERROR" ? `<span class="badge" style="background:#ef4444;color:#fff;">Lỗi</span>` : `<span class="badge" style="background:#f59e0b;color:#000;">Cần xem</span>`;
      const ref = iss.shotId ? `Cảnh quay ${iss.shotId}` : (iss.sceneId ? `Cảnh ${iss.sceneId}` : "");

      return `
        <div class="vb-issue-card ${sevClass}">
          <div class="vb-issue-content">
            <div class="vb-issue-header">
              ${sevBadge}
              <span style="font-size: 0.76rem; font-weight: 600; color: var(--uq-ink-3); text-transform: uppercase;">${escapeHtml(iss.category || 'Continuity')}</span>
              ${ref ? `<span class="badge" style="font-family: monospace; font-size: 0.72rem;">${escapeHtml(ref)}</span>` : ''}
            </div>
            <div class="vb-issue-msg">${escapeHtml(iss.message)}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  // Wire issues filter buttons
  ["all", "blocking", "warnings"].forEach(filt => {
    const btn = document.getElementById(`vb-filter-issue-${filt}`);
    if (btn) {
      btn.addEventListener("click", () => {
        ["all", "blocking", "warnings"].forEach(f => {
          document.getElementById(`vb-filter-issue-${f}`)?.classList.remove("active");
        });
        btn.classList.add("active");
        visualBibleIssueFilter = filt;
        renderVisualBibleIssues();
      });
    }
  });

  // Wire re-derive button
  if (vbBtnRederive) {
    vbBtnRederive.addEventListener("click", async () => {
      if (!currentProjectDir) return;
      if (!confirm("Phân tích lại Visual Bible từ Scene Plan? Các chỉnh sửa thủ công sẽ được lưu trữ dự phòng.")) return;
      vbBtnRederive.disabled = true;
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual-bible/generate?force=true`, { method: "POST" });
        if (res.ok) {
          await loadVisualBible(currentProjectDir);
        } else {
          const err = await res.json();
          alert("Lỗi phân tích lại: " + (err.detail || "Thao tác thất bại"));
        }
      } catch (e) {
        console.error("Rederive visual bible error:", e);
      } finally {
        vbBtnRederive.disabled = false;
      }
    });
  }

  // Modal open & close buttons
  document.querySelectorAll(".btn-open-visual-bible").forEach(btn => {
    btn.addEventListener("click", openVisualBibleModal);
  });
  if (vbModalCloseBtn) vbModalCloseBtn.addEventListener("click", closeVisualBibleModal);
  if (vbModalDoneBtn) vbModalDoneBtn.addEventListener("click", closeVisualBibleModal);

  window.openVisualBibleModal = openVisualBibleModal;
  window.closeVisualBibleModal = closeVisualBibleModal;
  window.renderVisualBibleEntities = renderVisualBibleEntities;
  window.renderVisualBibleIssues = renderVisualBibleIssues;
  window.selectVisualBibleEntity = (tab, entityId) => {
    visualBibleSelectedTab = tab;
    visualBibleSelectedEntityId = entityId;
    document.querySelectorAll(".vb-tab-btn").forEach(b => {
      const isMatch = b.getAttribute("data-tab") === tab;
      b.classList.toggle("active", isMatch);
      b.setAttribute("aria-selected", isMatch ? "true" : "false");
    });
    if (vbTabContentEntities) vbTabContentEntities.style.display = "grid";
    if (vbTabContentIssues) vbTabContentIssues.style.display = "none";
    renderVisualBibleEntities();
  };
  window.saveCurrentVisualBibleEntity = () => {
    const btnSave = document.getElementById("vb-btn-save-entity");
    if (btnSave) btnSave.click();
  };
  window.getVisualBibleData = () => visualBibleData;

  window.saveCurrentVisualBibleEntity = () => {
    const btnSave = document.getElementById("vb-btn-save-entity");
    if (btnSave) btnSave.click();
  };
  window.getVisualBibleData = () => visualBibleData;

  // ==========================================================================
  // Phase 13 — Style pane + Reference assets pane
  // ==========================================================================
  function renderVbStylePane() {
    const pane = document.getElementById("vb-style-pane");
    if (!pane) return;
    const v2 = visualBibleData?._v2 || {};
    if (!visualBibleData) {
      pane.innerHTML = `<p class="empty-state">Chưa có Visual Bible.</p>`;
      return;
    }
    if (!v2.migrated) {
      pane.innerHTML = `
        <div class="detail-prose-card">
          <div class="detail-prose-label">Visual Bible V2 chưa khởi tạo</div>
          <div class="detail-prose-content">Schema hiện tại: ${escapeHtml(visualBibleData.schemaVersion || "1.x")}.
          Migration giữ nguyên IDs, manual edits và continuity groups (in-place, một nguồn canonical duy nhất).</div>
          <div class="detail-actions-bar" style="margin-top:0.5rem;">
            <button class="btn btn-primary btn-sm" id="vb-migrate-btn"><span>Khởi tạo Visual Bible V2</span></button>
          </div>
        </div>`;
      const mb = document.getElementById("vb-migrate-btn");
      if (mb) mb.addEventListener("click", async () => {
        if (!currentProjectDir) return;
        mb.disabled = true;
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual-bible/v2/migrate`, { method: "POST" });
        if (res.ok) {
          showNotification("Đã migrate Visual Bible V2 (IDs giữ nguyên).", "success");
          await loadVisualBible(currentProjectDir);
          renderVbStylePane();
        } else {
          const e = await res.json().catch(() => ({}));
          showNotification("Migration thất bại: " + (e.detail || ""), "error");
          mb.disabled = false;
        }
      });
      return;
    }
    const style = v2.projectStyle || {};
    const story = style.storyStyle || {};
    const presets = v2.presets || [];
    pane.innerHTML = `
      <div class="detail-prose-card">
        <div class="detail-prose-label">Project Style — ${escapeHtml(style.styleName || "")}</div>
        <div class="prod-readiness-list">
          <div class="prod-readiness-row"><span>Preset</span><span>${escapeHtml(style.presetId || "—")} v${escapeHtml(style.presetVersion || "")}</span></div>
          <div class="prod-readiness-row"><span>Render</span><span>${escapeHtml(story.renderStyle || "—")}</span></div>
          <div class="prod-readiness-row"><span>Palette</span><span>${escapeHtml(story.palette || "—")}</span></div>
          <div class="prod-readiness-row"><span>Lighting</span><span>${escapeHtml(story.lighting || "—")}</span></div>
        </div>
        <div class="prod-history-meta" style="margin-top:0.3rem;">Negative: ${(style.negativeStyleRules || []).map(escapeHtml).join(" · ")}</div>
        <div class="detail-actions-bar" style="margin-top:0.5rem;">
          <select id="vb-preset-select" class="form-select form-input-sm" aria-label="Global preset">
            ${presets.map(p => `<option value="${p.presetId}" ${p.presetId === style.presetId ? "selected" : ""}>${escapeHtml(p.name)} (${p.presetVersion})</option>`).join("")}
          </select>
          <button class="btn btn-secondary btn-sm" id="vb-preset-apply-btn"><span>Áp dụng preset (explicit)</span></button>
        </div>
        <div class="prod-history-meta">Đổi style → mọi visual downstream stale (audio/QA/timestamp không đổi).</div>
      </div>`;
    const ab = document.getElementById("vb-preset-apply-btn");
    if (ab) ab.addEventListener("click", async () => {
      if (!currentProjectDir) return;
      const pid = document.getElementById("vb-preset-select")?.value;
      if (!pid) return;
      ab.disabled = true;
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual-bible/v2/style/apply-preset`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: pid })
      });
      if (res.ok) {
        const data = await res.json();
        showNotification(`Đã áp preset (${(data.applied?.affectedScenes || []).length} scenes stale).`, "success");
        await loadVisualBible(currentProjectDir);
        renderVbStylePane();
      } else {
        showNotification("Áp preset thất bại.", "error");
        ab.disabled = false;
      }
    });
  }

  function renderVbReferencesPane() {
    const grid = document.getElementById("vb-ref-grid");
    const sel = document.getElementById("vb-ref-entity-select");
    if (!grid) return;
    renderValidationGuide();
    const v2 = visualBibleData?._v2 || {};
    if (!v2.migrated) {
      grid.innerHTML = `<p class="empty-state">Khởi tạo Visual Bible V2 (tab Phong cách) trước.</p>`;
      return;
    }
    // Corrective: CHARACTER options are representatives only (never groups).
    const chars = (v2.characters || []).filter(c =>
      (c.entityKind || "SUBJECT_GROUP") === "REPRESENTATIVE_CHARACTER");
    const envs = (visualBibleData?.environments || []).map(e => ({ id: e.environmentId, type: "ENVIRONMENT", label: `${e.environmentId} (env)` }));
    const objs = (v2.objects || []).map(o => ({ id: o.objectId, type: "OBJECT", label: `${o.objectId} (obj)` }));
    const options = [
      ...chars.map(c => ({ id: c.characterId, type: "CHARACTER", label: `${c.characterId} (${(v2.completeness || {})[c.characterId]?.status || "?"})` })),
      ...envs, ...objs
    ];
    if (sel) {
      sel.innerHTML = options.map(o => `<option value="${o.type}:${o.id}">${escapeHtml(o.label)}</option>`).join("");
    }
    const assets = v2.referenceAssets || [];
    grid.innerHTML = assets.length ? assets.map(a => `
      <div class="vb-ref-card">
        <img src="/api/projects/${encodeURIComponent(currentProjectDir)}/references/${encodeURIComponent(a.assetId)}/preview" alt="${escapeHtml(a.assetId)}" loading="lazy" class="vb-ref-img">
        <div class="vb-ref-meta"><strong>${escapeHtml(a.assetId)}</strong><br>
        <span class="prod-history-meta">${escapeHtml(a.entityId)} · ${escapeHtml(a.view)}</span></div>
        <div class="detail-actions-bar">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer;"><span>Thay thế</span>
            <input type="file" data-replace="${escapeHtml(a.assetId)}" accept=".png,.jpg,.jpeg,.webp" style="display:none;">
          </label>
          <button class="btn btn-secondary btn-sm" data-remove="${escapeHtml(a.assetId)}"><span>Xóa</span></button>
        </div>
      </div>`).join("") : `<p class="empty-state">Chưa có reference asset. Tải ảnh front / three-quarter / profile cho nhân vật chính.</p>`;
    grid.querySelectorAll("input[data-replace]").forEach(inp => {
      inp.addEventListener("change", () => vbReplaceAsset(inp.getAttribute("data-replace"), inp.files[0]));
    });
    grid.querySelectorAll("button[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => vbRemoveAsset(btn.getAttribute("data-remove"), false));
    });
  }

  async function vbUploadAsset() {
    if (!currentProjectDir) { showNotification("Hãy chọn một dự án trước.", "warning"); return; }
    const sel = document.getElementById("vb-ref-entity-select");
    const view = document.getElementById("vb-ref-view-select")?.value || "FRONT";
    const fileInput = document.getElementById("vb-ref-file");
    const file = fileInput?.files?.[0];
    if (!sel || !sel.value || !file) {
      showNotification("Chọn thực thể và file ảnh (PNG/JPG/WebP).", "warning");
      return;
    }
    const [entityType, ...rest] = sel.value.split(":");
    const entityId = rest.join(":");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/references/upload?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}&view=${encodeURIComponent(view)}`, {
      method: "POST", body: fd
    });
    if (res.ok) {
      const data = await res.json();
      showNotification(`Đã thêm ${data.asset.assetId} (${(data.applied?.affectedScenes || []).length} cảnh cần đồng bộ lại).`, "success");
      fileInput.value = "";
      await loadVisualBible(currentProjectDir);
      renderVbReferencesPane();
    } else {
      const e = await res.json().catch(() => ({}));
      showNotification("Tải lên thất bại: " + (e.detail || ""), "error");
    }
  }

  async function vbReplaceAsset(assetId, file) {
    if (!currentProjectDir || !file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/references/${encodeURIComponent(assetId)}/replace`, {
      method: "POST", body: fd
    });
    if (res.ok) {
      showNotification(`Đã thay thế ${assetId} (dependents stale).`, "success");
      await loadVisualBible(currentProjectDir);
      renderVbReferencesPane();
    } else {
      const e = await res.json().catch(() => ({}));
      showNotification("Thay thế thất bại: " + (e.detail || ""), "error");
    }
  }

  async function vbRemoveAsset(assetId, confirmed) {
    if (!currentProjectDir) return;
    const note = document.getElementById("vb-ref-impact-note");
    const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/references/${encodeURIComponent(assetId)}?force=${confirmed ? "true" : "false"}`, {
      method: "DELETE"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotification("Xóa thất bại: " + (data.detail || ""), "error");
      return;
    }
    if (!data.removed) {
      const imp = data.impact || {};
      if (note) {
        note.style.display = "block";
        note.innerHTML = `Xóa <strong>${escapeHtml(assetId)}</strong> ảnh hưởng ${imp.affectedScenes ? imp.affectedScenes.length : 0} scenes / ${imp.affectedShots ? imp.affectedShots.length : 0} shots.
          <button class="btn btn-sm btn-danger" id="vb-ref-remove-confirm"><span>Xác nhận xóa</span></button>`;
        const cb = document.getElementById("vb-ref-remove-confirm");
        if (cb) cb.addEventListener("click", () => vbRemoveAsset(assetId, true));
      }
      return;
    }
    if (note) note.style.display = "none";
    showNotification(`Đã xóa ${assetId}.`, "success");
    await loadVisualBible(currentProjectDir);
    renderVbReferencesPane();
  }

  const vbRefUploadBtn = document.getElementById("vb-ref-upload-btn");
  if (vbRefUploadBtn) vbRefUploadBtn.addEventListener("click", vbUploadAsset);

  // ==========================================================================
  // Corrective §9–10 — Cast suggestions (suggestion-first)
  // ==========================================================================
  async function renderCastSuggestBox() {
    const list = document.getElementById("vb-cast-suggest-list");
    if (!list || !currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/cast/suggestions`);
      if (!res.ok) return;
      const data = await res.json();
      const suggs = data.suggestions || [];
      if (!suggs.length) {
        list.innerHTML = `<p class="empty-state">Chưa có gợi ý. Bấm "Phân tích vai diễn".</p>`;
        return;
      }
      list.innerHTML = suggs.map(s => `
        <div class="vb-ref-card" style="margin-bottom:0.4rem;">
          <div><strong>${escapeHtml(s.label)}</strong>
            <span class="badge">${escapeHtml(s.strength || "")}</span>
            <span class="prod-history-meta">${s.matchCount} scenes · ${escapeHtml(s.status || "OPEN")}</span></div>
          <div class="prod-history-meta">Từ: ${escapeHtml(s.sourceSubjectId || "—")} · ${(s.sceneIds || []).slice(0, 6).map(escapeHtml).join(", ")}</div>
          ${(s.evidence || []).slice(0, 2).map(e => `<div class="prod-history-meta">“${escapeHtml(e.snippet || "")}”</div>`).join("")}
          ${s.status === "OPEN" ? `
          <div class="detail-actions-bar" style="margin-top:0.3rem;">
            <button class="btn btn-primary btn-sm" data-cast-create="${escapeHtml(s.suggestionId)}"><span>Tạo</span></button>
            <button class="btn btn-secondary btn-sm" data-cast-ignore="${escapeHtml(s.suggestionId)}"><span>Bỏ qua</span></button>
            <button class="btn btn-secondary btn-sm" data-cast-merge="${escapeHtml(s.suggestionId)}"><span>Gộp + bind</span></button>
          </div>` : `<div class="prod-history-meta">→ ${escapeHtml(s.createdCharacterId || s.mergedInto || s.status)}</div>`}
        </div>`).join("");
      list.querySelectorAll("[data-cast-create]").forEach(b => b.addEventListener("click", () => castSuggestionAction(b, "create")));
      list.querySelectorAll("[data-cast-ignore]").forEach(b => b.addEventListener("click", () => castSuggestionAction(b, "ignore")));
      list.querySelectorAll("[data-cast-merge]").forEach(b => b.addEventListener("click", () => castSuggestionAction(b, "merge")));
    } catch (err) {
      console.warn("cast suggestions failed:", err);
    }
  }

  async function castSuggestionAction(btn, action) {
    if (!currentProjectDir) return;
    const sid = btn.getAttribute(action === "create" ? "data-cast-create" : action === "ignore" ? "data-cast-ignore" : "data-cast-merge");
    btn.disabled = true;
    try {
      let url, opts = { method: "POST", headers: { "Content-Type": "application/json" } };
      if (action === "create") {
        url = `/api/projects/${encodeURIComponent(currentProjectDir)}/cast/suggestions/${encodeURIComponent(sid)}/create`;
        opts.body = JSON.stringify({});
      } else if (action === "ignore") {
        url = `/api/projects/${encodeURIComponent(currentProjectDir)}/cast/suggestions/${encodeURIComponent(sid)}/ignore`;
      } else {
        const reps = (visualBibleData?.characters || []).filter(c => (c.entityKind || "") === "REPRESENTATIVE_CHARACTER");
        if (!reps.length) {
          showNotification("Chưa có nhân vật đại diện để gộp — hãy Tạo trước.", "warning");
          btn.disabled = false;
          return;
        }
        const target = reps[0].characterId;
        url = `/api/projects/${encodeURIComponent(currentProjectDir)}/cast/suggestions/${encodeURIComponent(sid)}/merge`;
        opts.body = JSON.stringify({ character_id: target, bind_scenes: true });
      }
      const res = await fetch(url, opts);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail || "Thao tác thất bại.");
      }
      showNotification(action === "create" ? "Đã tạo nhân vật đại diện (chưa bind scenes)." : action === "ignore" ? "Đã bỏ qua gợi ý." : "Đã gộp + bind scenes.", "success");
      await loadVisualBible(currentProjectDir);
      renderCastSuggestBox();
    } catch (err) {
      showNotification(err.message, "error");
      btn.disabled = false;
    }
  }

  const vbCastAnalyzeBtn = document.getElementById("vb-cast-analyze-btn");
  if (vbCastAnalyzeBtn) vbCastAnalyzeBtn.addEventListener("click", async () => {
    if (!currentProjectDir) return;
    vbCastAnalyzeBtn.disabled = true;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/cast/suggestions/analyze`, { method: "POST" });
      if (!res.ok) throw new Error("Phân tích thất bại.");
      renderCastSuggestBox();
    } catch (err) {
      showNotification(err.message, "error");
    } finally {
      vbCastAnalyzeBtn.disabled = false;
    }
  });

  // Corrective §52 — guided external validation checklist in References pane.
  async function renderValidationGuide() {
    const el = document.getElementById("vb-validation-guide");
    if (!el || !currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/validation/readiness`);
      if (!res.ok) return;
      const r = await res.json();
      const badge = (v) => (window.I18N ? window.I18N.renderBadge(v) : escapeHtml(v));
      const steps = ["1. Dàn nhân vật đại diện", "2. Định danh chuẩn", "3. Ảnh tham chiếu mặt trước",
        "4. Ảnh tham chiếu ba phần tư", "5. Ảnh tham chiếu nghiêng", "6. Gắn cảnh",
        "7. Tạo mẫu kiểm tra", "8. Soát tính nhất quán"];
      el.innerHTML = `
        <div class="detail-prose-card">
          <div class="detail-prose-label">Mức sẵn sàng kiểm định ngoài (§52)</div>
          <div class="form-hint" style="margin-bottom:0.35rem;">Các góc tham chiếu (mặt trước, ba phần tư, nghiêng) là ảnh của <strong>cùng một nhân vật</strong>, hệ thống tự chọn góc phù hợp cho từng cảnh.</div>
          <div class="prod-readiness-list">
            <div class="prod-readiness-row"><span>Nền tảng hình ảnh</span>${badge(r.visualFoundation)}</div>
            <div class="prod-readiness-row"><span>Dàn nhân vật đại diện</span>${badge(r.representativeCast)}</div>
            <div class="prod-readiness-row"><span>Độ phủ tham chiếu</span>${badge(r.referenceCoverage)}</div>
            <div class="prod-readiness-row"><span>Kiểm định ngoài</span>${badge(r.externalValidation)}</div>
          </div>
          ${(r.blockers || []).length ? `<div class="prod-blockers-list" style="display:block;"><div class="prod-blockers-title">Đang bị chặn:</div><ul>${r.blockers.slice(0, 8).map(b => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>` : ""}
          <div class="prod-history-meta" style="margin-top:0.3rem;">${steps.map(escapeHtml).join(" → ")}</div>
        </div>`;
    } catch (err) {
      console.warn("validation guide failed:", err);
    }
  }

  // ==============================================================================
  // 13c. SUBPHASE 3A: STORY WORKBENCH & OVERVIEW ENHANCEMENTS
  // ==============================================================================
  let currentStoryData = null;
  let selectedStoryBeatId = null;
  let inlineEdqFilter = "all";
  let selectedInlineEdqIssueId = null;

  const storySaveBadge = document.getElementById("story-save-badge");
  const btnSaveStoryScript = document.getElementById("btn-save-story-script");
  const storyBeatsCount = document.getElementById("story-beats-count");
  const storyBeatsContainer = document.getElementById("story-beats-container");
  const storyInspectorBeatId = document.getElementById("story-inspector-beat-id");
  const storySelectedBeatDetails = document.getElementById("story-selected-beat-details");
  const storyEdqScoreBadge = document.getElementById("story-edq-score-badge");
  const storyEdqIssuesList = document.getElementById("story-edq-issues-list");
  const storyEdqDetailPanel = document.getElementById("story-edq-detail-panel");
  const btnStoryEdqAnalyze = document.getElementById("btn-story-edq-analyze");

  function updateScriptSaveStatus(isDirty) {
    if (!storySaveBadge) return;
    if (isDirty) {
      storySaveBadge.textContent = "Chưa lưu";
      storySaveBadge.className = "save-status-badge unsaved";
    } else {
      storySaveBadge.textContent = "Đã lưu";
      storySaveBadge.className = "save-status-badge saved";
    }
  }

  if (scriptInput) {
    scriptInput.addEventListener("input", () => {
      updateScriptSaveStatus(isScriptDirty());
    });
  }

  async function saveStoryScript() {
    if (!currentProjectDir) {
      showNotification("Chưa mở dự án nào để lưu kịch bản.", "warning");
      return;
    }
    const newScript = scriptInput ? scriptInput.value : "";
    if (btnSaveStoryScript) {
      btnSaveStoryScript.disabled = true;
      btnSaveStoryScript.textContent = "Đang lưu...";
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: newScript })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Lỗi máy chủ (${res.status})`);
      }
      const data = await res.json();
      openedScriptText = newScript;
      updateScriptSaveStatus(false);
      refreshDependencyStatus(currentProjectDir);
      showNotification("Đã lưu kịch bản thành công.", "success");
      // Reload story slice to sync beats & metrics
      loadStorySlice(currentProjectDir);
    } catch (err) {
      showNotification(`Không thể lưu kịch bản: ${err.message}`, "error");
    } finally {
      if (btnSaveStoryScript) {
        btnSaveStoryScript.disabled = false;
        btnSaveStoryScript.innerHTML = `<svg class="ui-icon" style="width: 12px; height: 12px; margin-right: 4px;"><use href="#icon-check"/></svg> Lưu kịch bản`;
      }
    }
  }

  if (btnSaveStoryScript) {
    btnSaveStoryScript.addEventListener("click", saveStoryScript);
  }

  async function loadStorySlice(dirName) {
    if (!dirName) {
      if (storyBeatsContainer) {
        storyBeatsContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;">Chưa có đoạn kịch bản. Vui lòng chọn hoặc mở một dự án.</div>`;
      }
      return;
    }
    if (storyBeatsContainer) {
      storyBeatsContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;"><span class="inline-spinner"></span> Đang tải danh sách nhịp truyện...</div>`;
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/story`);
      if (!res.ok) {
        if (storyBeatsContainer) {
          storyBeatsContainer.innerHTML = `
            <div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem; color: var(--uq-bad, #ef4444);">
              Không thể tải dữ liệu kịch bản (mã ${res.status}).
              <button class="btn btn-xs btn-secondary" style="margin-top: 8px; display: inline-block;" onclick="window.loadStorySlice && window.loadStorySlice(window.currentProjectDir)">Thử lại</button>
            </div>`;
        }
        return;
      }
      currentStoryData = await res.json();
      if (currentProjectDir !== dirName) return;

      if (scriptInput && !isScriptDirty()) {
        hydrateScriptEditor(currentStoryData.script || "");
        updateScriptSaveStatus(false);
      }

      renderStoryBeatsList(currentStoryData.beats || []);
      renderInlineEditorialQA();
    } catch (err) {
      console.warn("Failed to load story slice:", err);
      if (storyBeatsContainer) {
        storyBeatsContainer.innerHTML = `
          <div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem; color: var(--uq-bad, #ef4444);">
            Lỗi khi tải dữ liệu kịch bản: ${escapeHtml(err.message || 'Lỗi không xác định')}.
            <button class="btn btn-xs btn-secondary" style="margin-top: 8px; display: inline-block;" onclick="window.loadStorySlice && window.loadStorySlice(window.currentProjectDir)">Thử lại</button>
          </div>`;
      }
    }
  }
  window.loadStorySlice = loadStorySlice;

  function renderStoryBeatsList(beats) {
    if (!storyBeatsContainer) return;
    if (storyBeatsCount) storyBeatsCount.textContent = String(beats.length);

    if (!beats || beats.length === 0) {
      storyBeatsContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;">Chưa có đoạn kịch bản nào được phân tích.</div>`;
      if (storyInspectorBeatId) storyInspectorBeatId.textContent = "—";
      if (storySelectedBeatDetails) storySelectedBeatDetails.innerHTML = `<p class="empty-state" style="font-size: 0.85rem;">Chưa có nhịp truyện.</p>`;
      return;
    }

    if (!selectedStoryBeatId || !beats.some(b => b.beat_id === selectedStoryBeatId)) {
      selectedStoryBeatId = beats[0].beat_id;
    }

    const styleLabels = {
      NEUTRAL: "Trung tính", AUTHORITATIVE: "Dẫn dắt", CURIOUS: "Tò mò", MYSTERIOUS: "Bí ẩn",
      OMINOUS: "U ám", TENSE: "Căng thẳng", URGENT: "Khẩn trương", SOMBER: "Trầm buồn",
      REFLECTIVE: "Suy ngẫm", AWE: "Kinh ngạc", EXCITED: "Hào hứng", REVEAL: "Hé lộ"
    };

    storyBeatsContainer.innerHTML = beats.map(b => {
      const isSel = b.beat_id === selectedStoryBeatId;
      const conf = Math.round((b.confidence ?? 1) * 100);
      const styleName = styleLabels[b.style] || b.style || "Trung tính";
      return `
        <div class="story-beat-item ${isSel ? 'selected' : ''}" data-beat-id="${escapeHtml(b.beat_id)}" role="option" aria-selected="${isSel}" tabindex="${isSel ? '0' : '-1'}">
          <div class="story-beat-header">
            <span class="story-beat-id">${escapeHtml(b.beat_id)}</span>
            <span class="story-beat-tag">${escapeHtml(styleName)} · ${conf}%</span>
          </div>
          <div class="story-beat-snippet">${escapeHtml((b.text || "").slice(0, 95))}</div>
        </div>
      `;
    }).join("");

    storyBeatsContainer.querySelectorAll(".story-beat-item").forEach(item => {
      item.addEventListener("click", () => {
        const bid = item.dataset.beatId;
        selectStoryBeat(bid, false);
      });
    });

    // Gate B: Listbox keyboard navigation (ArrowDown, ArrowUp, Home, End) with roving tabindex
    storyBeatsContainer.onkeydown = function (e) {
      const beatList = (currentStoryData && currentStoryData.beats) || [];
      if (!beatList.length) return;
      const currIdx = beatList.findIndex(b => b.beat_id === selectedStoryBeatId);

      let targetIdx = -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        targetIdx = currIdx < beatList.length - 1 ? currIdx + 1 : 0;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        targetIdx = currIdx > 0 ? currIdx - 1 : beatList.length - 1;
      } else if (e.key === "Home") {
        e.preventDefault();
        targetIdx = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        targetIdx = beatList.length - 1;
      }

      if (targetIdx >= 0 && targetIdx < beatList.length) {
        selectStoryBeat(beatList[targetIdx].beat_id, true);
      }
    };

    const activeBeat = beats.find(b => b.beat_id === selectedStoryBeatId);
    renderSelectedBeatDetails(activeBeat);
  }

  function selectStoryBeat(beatId, focus = false) {
    selectedStoryBeatId = beatId;
    if (storyBeatsContainer) {
      storyBeatsContainer.querySelectorAll(".story-beat-item").forEach(item => {
        const isMatch = item.dataset.beatId === beatId;
        item.classList.toggle("selected", isMatch);
        item.setAttribute("aria-selected", String(isMatch));
        item.setAttribute("tabindex", isMatch ? "0" : "-1");
        if (isMatch) {
          if (typeof item.scrollIntoView === "function") {
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
          if (focus && typeof item.focus === "function") {
            item.focus();
          }
        }
      });
    }
    const beats = (currentStoryData && currentStoryData.beats) || [];
    const beat = beats.find(b => b.beat_id === beatId);
    renderSelectedBeatDetails(beat);
  }

  function renderSelectedBeatDetails(beat) {
    if (!storySelectedBeatDetails) return;
    if (!beat) {
      if (storyInspectorBeatId) storyInspectorBeatId.textContent = "—";
      storySelectedBeatDetails.innerHTML = `<p class="empty-state" style="font-size: 0.85rem;">Chọn một nhịp ở cột trái để xem chi tiết.</p>`;
      return;
    }
    if (storyInspectorBeatId) storyInspectorBeatId.textContent = beat.beat_id;

    const styleLabels = {
      NEUTRAL: "Trung tính", AUTHORITATIVE: "Dẫn dắt", CURIOUS: "Tò mò", MYSTERIOUS: "Bí ẩn",
      OMINOUS: "U ám", TENSE: "Căng thẳng", URGENT: "Khẩn trương", SOMBER: "Trầm buồn",
      REFLECTIVE: "Suy ngẫm", AWE: "Kinh ngạc", EXCITED: "Hào hứng", REVEAL: "Hé lộ"
    };
    const styleName = styleLabels[beat.style] || beat.style || "Trung tính";

    storySelectedBeatDetails.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.83rem;">
        <div>
          <span style="color: var(--color-text-muted, #94a3b8);">Phong cách &amp; Nhịp độ:</span>
          <strong>${escapeHtml(styleName)}</strong> (Cường độ: ${Number(beat.intensity ?? 0.3).toFixed(2)}, Tốc độ: ${Number(beat.rate ?? 1.0).toFixed(2)}x)
        </div>
        <div>
          <span style="color: var(--color-text-muted, #94a3b8);">Thời lượng dự kiến:</span>
          <strong>~${Number(beat.estimated_duration_sec ?? 0).toFixed(1)} giây</strong>
        </div>
        <div style="background: var(--color-bg-subtle, #1e293b); padding: 8px; border-radius: 6px; border: 1px solid var(--color-border, #334155); margin-top: 4px;">
          <div style="font-size: 0.75rem; color: var(--color-text-muted, #94a3b8); margin-bottom: 2px;">Nội dung câu:</div>
          <div style="line-height: 1.45; font-style: italic;">"${escapeHtml(beat.text || "")}"</div>
        </div>
        ${(beat.emphasis && beat.emphasis.length > 0) ? `
          <div>
            <span style="color: var(--color-text-muted, #94a3b8);">Nhấn âm:</span>
            ${beat.emphasis.map(w => `<span class="vb-tag" style="display: inline-block; margin: 2px 4px;">${escapeHtml(w)}</span>`).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderInlineEditorialQA() {
    if (!storyEdqScoreBadge || !storyEdqIssuesList) return;
    if (!editorialData || !editorialData.exists) {
      storyEdqScoreBadge.textContent = "—";
      storyEdqScoreBadge.className = "state-pill state-idle";
      storyEdqIssuesList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem; padding: 1rem 0;">Chưa có cảnh báo nội dung. Bấm "Phân tích lại" để kiểm tra kịch bản.</p>`;
      if (storyEdqDetailPanel) storyEdqDetailPanel.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Không có dữ liệu đề xuất.</p>`;
      return;
    }

    const sc = editorialData.score ?? 0;
    storyEdqScoreBadge.textContent = `${sc} điểm`;
    storyEdqScoreBadge.className = `state-pill ${sc >= 80 ? 'state-ready' : sc >= 50 ? 'state-review' : 'state-danger'}`;

    const issues = editorialData.issues || [];
    const filtered = issues.filter(i => {
      if (inlineEdqFilter === "review") return i.severity === "REVIEW";
      if (inlineEdqFilter === "block") return i.severity === "BLOCK";
      return true;
    });

    if (filtered.length === 0) {
      storyEdqIssuesList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem; padding: 1rem 0;">✓ Chưa có cảnh báo nội dung trong bộ lọc này.</p>`;
      if (storyEdqDetailPanel) storyEdqDetailPanel.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Chọn một vấn đề biên tập để xem chi tiết.</p>`;
      return;
    }

    if (!selectedInlineEdqIssueId || !filtered.some(i => i.issueId === selectedInlineEdqIssueId)) {
      selectedInlineEdqIssueId = filtered[0].issueId;
    }

    storyEdqIssuesList.innerHTML = filtered.map(i => {
      const isSel = i.issueId === selectedInlineEdqIssueId;
      const isBlock = i.severity === "BLOCK";
      return `
        <div class="story-edq-issue-item ${isSel ? 'selected' : ''}" data-issue-id="${escapeHtml(i.issueId)}" role="option" aria-selected="${isSel}">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span class="badge ${isBlock ? 'badge-danger' : 'badge-warning'}" style="font-size: 10px;">${escapeHtml(i.severity)}</span>
            <span style="font-size: 10.5px; color: var(--color-text-muted, #94a3b8);">${escapeHtml(i.status)}</span>
          </div>
          <div style="font-size: 12px; font-weight: 500; color: var(--color-text, #f1f5f9);">${escapeHtml(i.message)}</div>
        </div>
      `;
    }).join("");

    storyEdqIssuesList.querySelectorAll(".story-edq-issue-item").forEach(item => {
      item.addEventListener("click", () => {
        selectedInlineEdqIssueId = item.dataset.issueId;
        renderInlineEditorialQA();
      });
    });

    const activeIssue = filtered.find(i => i.issueId === selectedInlineEdqIssueId);
    renderInlineEdqDetail(activeIssue);
  }

  function renderInlineEdqDetail(issue) {
    if (!storyEdqDetailPanel) return;
    if (!issue) {
      storyEdqDetailPanel.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Chọn một vấn đề biên tập để xem Trước / Sau.</p>`;
      return;
    }

    storyEdqDetailPanel.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="font-size: 11px; font-weight: 600; color: #60a5fa;">${escapeHtml(issue.issueId)} · ${escapeHtml(issue.type)}</div>
        <div style="font-size: 11.5px; color: var(--color-text-muted, #94a3b8);">${escapeHtml(issue.message)}</div>
        <div style="background: rgba(239, 68, 68, 0.08); border-left: 2px solid #ef4444; padding: 4px 6px; font-size: 11.5px;">
          <strong style="color: #ef4444;">Trước:</strong> ${escapeHtml(issue.text || "")}
        </div>
        ${issue.suggestion ? `
          <div style="background: rgba(16, 185, 129, 0.08); border-left: 2px solid #10b981; padding: 4px 6px; font-size: 11.5px;">
            <strong style="color: #10b981;">Sau (đề xuất):</strong> ${escapeHtml(issue.suggestion)}
          </div>
        ` : ""}
        <div style="display: flex; gap: 6px; margin-top: 4px;">
          ${issue.suggestion && issue.status === "OPEN" ? `
            <button class="btn btn-primary btn-xs" id="btn-inline-edq-apply">Áp dụng sửa câu</button>
          ` : ""}
          ${issue.status === "OPEN" ? `
            <button class="btn btn-secondary btn-xs" id="btn-inline-edq-ignore">Bỏ qua</button>
          ` : `<span style="font-size: 11px; color: var(--color-text-muted, #94a3b8);">${issue.status}</span>`}
        </div>
      </div>
    `;

    const btnApply = document.getElementById("btn-inline-edq-apply");
    if (btnApply) {
      btnApply.addEventListener("click", () => {
        edqApplyIssue(issue.issueId).then(() => {
          renderInlineEditorialQA();
        });
      });
    }

    const btnIgnore = document.getElementById("btn-inline-edq-ignore");
    if (btnIgnore) {
      btnIgnore.addEventListener("click", () => {
        edqIgnoreIssue(issue.issueId).then(() => {
          renderInlineEditorialQA();
        });
      });
    }
  }

  // Filter buttons for inline Editorial QA
  const btnEdqFilterAll = document.getElementById("story-edq-filter-all");
  const btnEdqFilterReview = document.getElementById("story-edq-filter-review");
  const btnEdqFilterBlock = document.getElementById("story-edq-filter-block");
  if (btnEdqFilterAll) {
    btnEdqFilterAll.addEventListener("click", () => {
      inlineEdqFilter = "all";
      btnEdqFilterAll.classList.add("active");
      if (btnEdqFilterReview) btnEdqFilterReview.classList.remove("active");
      if (btnEdqFilterBlock) btnEdqFilterBlock.classList.remove("active");
      renderInlineEditorialQA();
    });
  }
  if (btnEdqFilterReview) {
    btnEdqFilterReview.addEventListener("click", () => {
      inlineEdqFilter = "review";
      btnEdqFilterReview.classList.add("active");
      if (btnEdqFilterAll) btnEdqFilterAll.classList.remove("active");
      if (btnEdqFilterBlock) btnEdqFilterBlock.classList.remove("active");
      renderInlineEditorialQA();
    });
  }
  if (btnEdqFilterBlock) {
    btnEdqFilterBlock.addEventListener("click", () => {
      inlineEdqFilter = "block";
      btnEdqFilterBlock.classList.add("active");
      if (btnEdqFilterAll) btnEdqFilterAll.classList.remove("active");
      if (btnEdqFilterReview) btnEdqFilterReview.classList.remove("active");
      renderInlineEditorialQA();
    });
  }
  if (btnStoryEdqAnalyze) {
    btnStoryEdqAnalyze.addEventListener("click", () => {
      analyzeEditorial().then(() => {
        renderInlineEditorialQA();
      });
    });
  }

  // Embedded Storage Maintenance Drawer Logic
  const btnToggleSystemDrawer = document.getElementById("btn-toggle-system-drawer");
  const systemDrawerContent = document.getElementById("system-drawer-content");
  const btnSystemDrawerToggleText = document.getElementById("btn-system-drawer-toggle-text");
  if (btnToggleSystemDrawer && systemDrawerContent) {
    btnToggleSystemDrawer.addEventListener("click", () => {
      const isVisible = systemDrawerContent.style.display !== "none";
      systemDrawerContent.style.display = isVisible ? "none" : "block";
      if (btnSystemDrawerToggleText) {
        btnSystemDrawerToggleText.textContent = isVisible ? "Mở rộng ▼" : "Thu gọn ▲";
      }
    });
  }

  async function loadEmbeddedStorageOverview() {
    const grid = document.getElementById("storage-overview-grid-embedded");
    if (!grid) return;
    try {
      const res = await fetch("/api/storage/overview");
      if (!res.ok) return;
      const data = await res.json();
      let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;">';
      for (const [key, cat] of Object.entries(data.categories || {})) {
        html += `
          <div style="padding: 8px 10px; border-radius: 6px; background: var(--color-bg-subtle, #1e293b); border: 1px solid var(--color-border, #334155);">
            <div style="font-size: 0.72rem; color: var(--color-text-muted, #94a3b8);">${escapeHtml(cat.labelVi)}</div>
            <div style="font-size: 1rem; font-weight: 700; margin-top: 2px;">${cat.mb} MB</div>
          </div>
        `;
      }
      if (data.disk) {
        html += `
          <div style="padding: 8px 10px; border-radius: 6px; background: var(--color-bg-subtle, #1e293b); border: 1px solid var(--color-success, #10b981);">
            <div style="font-size: 0.72rem; color: var(--color-text-muted, #94a3b8);">${escapeHtml(data.disk.labelVi)}</div>
            <div style="font-size: 1rem; font-weight: 700; color: var(--color-success, #10b981); margin-top: 2px;">${data.disk.freeGb} GB</div>
          </div>
        `;
      }
      html += '</div>';
      grid.innerHTML = html;
    } catch (e) {
      grid.innerHTML = `<div style="font-size: 12px; color: #ef4444;">Lỗi tải bộ nhớ: ${escapeHtml(e.message)}</div>`;
    }
  }
  window.loadEmbeddedStorageOverview = loadEmbeddedStorageOverview;

  const btnEmbeddedCleanupPreview = document.getElementById("btn-embedded-cleanup-preview");
  const btnEmbeddedCleanupExecute = document.getElementById("btn-embedded-cleanup-execute");
  const embeddedCleanupPreviewContainer = document.getElementById("storage-cleanup-preview-embedded");

  if (btnEmbeddedCleanupPreview) {
    btnEmbeddedCleanupPreview.addEventListener("click", async () => {
      if (embeddedCleanupPreviewContainer) embeddedCleanupPreviewContainer.innerHTML = '<div style="font-size: 12px;">⏳ Đang quét các tệp đệm...</div>';
      try {
        const res = await fetch("/api/storage/cleanup/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: ["renderCache", "tempFiles", "testCache"], confirmed: false })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const preview = await res.json();
        if (embeddedCleanupPreviewContainer) {
          embeddedCleanupPreviewContainer.innerHTML = `
            <div style="padding: 6px 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.08); border: 1px solid #ef4444; font-size: 11.5px; margin-top: 6px;">
              <strong style="color: #ef4444;">BẢO VỆ DỮ LIỆU:</strong> ${preview.protectedWarningVi} — Phát hiện <strong>${preview.candidateCount} tệp đệm</strong> (${preview.reclaimableMb} MB).
            </div>
          `;
        }
        if (btnEmbeddedCleanupExecute) btnEmbeddedCleanupExecute.disabled = (preview.candidateCount === 0);
      } catch (e) {
        if (embeddedCleanupPreviewContainer) embeddedCleanupPreviewContainer.innerHTML = `<div style="font-size: 12px; color: #ef4444;">Lỗi: ${e.message}</div>`;
      }
    });
  }

  if (btnEmbeddedCleanupExecute) {
    btnEmbeddedCleanupExecute.addEventListener("click", async () => {
      if (!confirm("Bạn có chắc chắn muốn dọn dẹp các tệp đệm tạm thời an toàn?")) return;
      try {
        const res = await fetch("/api/storage/cleanup/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: ["renderCache", "tempFiles", "testCache"], confirmed: true })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const report = await res.json();
        showNotification(`Đã dọn dẹp ${report.deletedCount} tệp, giải phóng ${report.freedMb} MB.`, "success");
        loadEmbeddedStorageOverview();
        if (embeddedCleanupPreviewContainer) embeddedCleanupPreviewContainer.innerHTML = "";
        btnEmbeddedCleanupExecute.disabled = true;
      } catch (e) {
        showNotification(`Lỗi dọn dẹp: ${e.message}`, "error");
      }
    });
  }

  // Next Best Action Card Loader
  async function loadNextBestAction(dirName) {
    const card = document.getElementById("overview-next-action-card");
    const targetActionText = document.getElementById("next-action-title");
    const targetActionReason = document.getElementById("next-action-reason");
    const btnExecuteAction = document.getElementById("btn-next-action-cta");
    if (!card) return;
    if (!dirName) {
      if (targetActionText) targetActionText.textContent = "Chưa có dữ liệu tổng quan";
      if (targetActionReason) targetActionReason.textContent = "Vui lòng mở hoặc chọn một dự án để tính toán bước tiếp theo.";
      if (btnExecuteAction) {
        btnExecuteAction.textContent = "Mở dự án →";
        btnExecuteAction.onclick = () => switchWorkspace("projects");
      }
      return;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/next-action`);
      if (!res.ok) {
        if (targetActionText) targetActionText.textContent = "Không tải được bước tiếp theo";
        if (targetActionReason) targetActionReason.textContent = `Lỗi kết nối máy chủ khi tính toán bước tiếp theo (mã ${res.status}).`;
        return;
      }
      const data = await res.json();
      const action = data.next_action;
      if (!action) return;

      if (targetActionText) targetActionText.textContent = action.title || "Hành động đề xuất";
      if (targetActionReason) targetActionReason.textContent = action.reason || "";
      if (btnExecuteAction) {
        btnExecuteAction.textContent = action.label || "Thực hiện ngay →";
        btnExecuteAction.onclick = () => {
          if (action.target_workbench) {
            switchWorkspace(action.target_workbench);
          }
        };
      }
    } catch (err) {
      console.warn("Failed to load next action:", err);
      if (targetActionText) targetActionText.textContent = "Lỗi tính toán bước tiếp theo";
      if (targetActionReason) targetActionReason.textContent = "Không thể kết nối đến dịch vụ bước tiếp theo. Vui lòng thử lại.";
    }
  }
  window.loadNextBestAction = loadNextBestAction;

  // ==============================================================================
  // SUBPHASE 3B: VOICE WORKBENCH CLIENT MODULE
  // ==============================================================================
  let currentVoiceData = null;
  let selectedVoiceChunkId = null;
  let isVoiceScrubberSeeking = false;
  let voiceActiveCueIndex = -1;
  let voiceSttPollInterval = null;

  // DOM Elements
  const voiceChunksCount = document.getElementById("voice-chunks-count");
  const voiceChunkSearch = document.getElementById("voice-chunk-search");
  const voiceChunkFilter = document.getElementById("voice-chunk-filter");
  const voiceChunksContainer = document.getElementById("voice-chunks-container");

  const voiceAudioStatusPill = document.getElementById("voice-audio-status-pill");
  const btnVoiceDownloadMenu = document.getElementById("btn-voice-download-menu");
  const voiceDownloadDropdown = document.getElementById("voice-download-dropdown");
  const voiceDlWav = document.getElementById("voice-dl-wav");
  const voiceDlMp3 = document.getElementById("voice-dl-mp3");
  const voiceDlSrt = document.getElementById("voice-dl-srt");
  const voiceDlTs = document.getElementById("voice-dl-ts");

  const voiceBtnPlayPause = document.getElementById("voice-btn-play-pause");
  const voiceCurTime = document.getElementById("voice-cur-time");
  const voiceTotDur = document.getElementById("voice-tot-dur");
  const voiceScrubber = document.getElementById("voice-scrubber");
  const voicePlaybackRate = document.getElementById("voice-playback-rate");
  const voicePlayingContext = document.getElementById("voice-playing-context");
  const btnPlaySelectedChunk = document.getElementById("btn-play-selected-chunk");

  const voiceCuesCount = document.getElementById("voice-cues-count");
  const btnRunWhisperAlignment = document.getElementById("btn-run-whisper-alignment");
  const btnCancelWhisperAlignment = document.getElementById("btn-cancel-whisper-alignment");
  const voiceSttProgress = document.getElementById("voice-stt-progress");
  const voiceSttProgressFill = document.getElementById("voice-stt-progress-fill");
  const voiceSttProgressMsg = document.getElementById("voice-stt-progress-msg");
  const voiceSttProgressPct = document.getElementById("voice-stt-progress-pct");
  const voiceCuesContainer = document.getElementById("voice-cues-container");

  const voiceProviderBadge = document.getElementById("voice-provider-badge");
  const voiceSelectModel = document.getElementById("voice-select-model");
  const voiceTtsSpeed = document.getElementById("voice-tts-speed");
  const voiceTtsSpeedVal = document.getElementById("voice-tts-speed-val");
  const btnGenerateSelectedChunk = document.getElementById("btn-generate-selected-chunk");
  const btnGenerateAllVoice = document.getElementById("btn-generate-all-voice");

  const voiceQaVerdictBadge = document.getElementById("voice-qa-verdict-badge");
  const voiceQaMatch = document.getElementById("voice-qa-match");
  const voiceQaWer = document.getElementById("voice-qa-wer");
  const voiceQaWpm = document.getElementById("voice-qa-wpm");
  const voiceQaIssuesCount = document.getElementById("voice-qa-issues-count");
  const btnRunVoiceQaWorkbench = document.getElementById("btn-run-voice-qa-workbench");
  const voiceQaIssuesList = document.getElementById("voice-qa-issues-list");

  const voicePronCount = document.getElementById("voice-pron-count");
  const voicePronAddForm = document.getElementById("voice-pron-add-form");
  const voicePronTerm = document.getElementById("voice-pron-term");
  const voicePronSpoken = document.getElementById("voice-pron-spoken");
  const btnPronTestAudio = document.getElementById("btn-pron-test-audio");
  const voicePronList = document.getElementById("voice-pron-list");

  const voiceChunkLockStatus = document.getElementById("voice-chunk-lock-status");
  const btnToggleChunkLock = document.getElementById("btn-toggle-chunk-lock");
  const voiceHistoryList = document.getElementById("voice-history-list");

  // Toggle download dropdown
  if (btnVoiceDownloadMenu && voiceDownloadDropdown) {
    btnVoiceDownloadMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = voiceDownloadDropdown.style.display === "block";
      voiceDownloadDropdown.style.display = isVisible ? "none" : "block";
    });
    document.addEventListener("click", () => {
      if (voiceDownloadDropdown) voiceDownloadDropdown.style.display = "none";
    });
  }

  // Speed slider display
  if (voiceTtsSpeed && voiceTtsSpeedVal) {
    voiceTtsSpeed.addEventListener("input", () => {
      voiceTtsSpeedVal.textContent = `${parseFloat(voiceTtsSpeed.value).toFixed(2)}x`;
    });
  }

  // Playback rate (preview only, no generation invalidation)
  if (voicePlaybackRate && audioPlayer) {
    voicePlaybackRate.addEventListener("change", () => {
      const rate = parseFloat(voicePlaybackRate.value) || 1.0;
      audioPlayer.playbackRate = rate;
    });
  }

  // Play/Pause button
  if (voiceBtnPlayPause && audioPlayer) {
    voiceBtnPlayPause.addEventListener("click", () => {
      if (!audioPlayer.src || audioPlayer.src.includes("undefined") || !audioPlayer.src.includes("/")) {
        if (currentProjectDir) {
          audioPlayer.src = `/api/projects/${encodeURIComponent(currentProjectDir)}/audio/wav?t=${Date.now()}`;
        }
      }
      if (audioPlayer.paused) {
        audioPlayer.play().catch(err => {
          showNotification("Không thể phát âm thanh: " + err.message, "error");
        });
      } else {
        audioPlayer.pause();
      }
    });
  }

  // Scrubber seeking
  if (voiceScrubber && audioPlayer) {
    voiceScrubber.addEventListener("input", () => {
      isVoiceScrubberSeeking = true;
      const dur = audioPlayer.duration || (currentVoiceData ? currentVoiceData.total_duration_seconds : 0);
      const previewTime = (parseFloat(voiceScrubber.value) / 100) * dur;
      if (voiceCurTime) voiceCurTime.textContent = formatTime(previewTime);
    });
    voiceScrubber.addEventListener("change", () => {
      const dur = audioPlayer.duration || (currentVoiceData ? currentVoiceData.total_duration_seconds : 0);
      audioPlayer.currentTime = (parseFloat(voiceScrubber.value) / 100) * dur;
      isVoiceScrubberSeeking = false;
    });
  }

  // Sync Voice Transport with audioPlayer events
  if (audioPlayer) {
    audioPlayer.addEventListener("timeupdate", () => {
      const cur = audioPlayer.currentTime || 0;
      const dur = audioPlayer.duration || (currentVoiceData ? currentVoiceData.total_duration_seconds : 0);

      if (voiceCurTime) voiceCurTime.textContent = formatTime(cur);
      if (voiceTotDur) voiceTotDur.textContent = formatTime(dur);

      if (voiceScrubber && !isVoiceScrubberSeeking && dur > 0) {
        voiceScrubber.value = (cur / dur) * 100;
      }

      // Sync active word cue highlight (Zero network traffic)
      syncVoiceWordCuesHighlight(cur);
    });

    const syncTransportButtons = () => {
      if (!voiceBtnPlayPause) return;
      const isPlaying = !audioPlayer.paused && !audioPlayer.ended && audioPlayer.readyState > 2;
      const playIcon = voiceBtnPlayPause.querySelector(".play-icon");
      const pauseIcon = voiceBtnPlayPause.querySelector(".pause-icon");
      if (playIcon && pauseIcon) {
        playIcon.style.display = isPlaying ? "none" : "inline-block";
        pauseIcon.style.display = isPlaying ? "inline-block" : "none";
      }
    };

    audioPlayer.addEventListener("play", syncTransportButtons);
    audioPlayer.addEventListener("playing", syncTransportButtons);
    audioPlayer.addEventListener("pause", syncTransportButtons);
    audioPlayer.addEventListener("ended", syncTransportButtons);
  }

  function syncVoiceWordCuesHighlight(currentTime) {
    if (!currentVoiceData || !currentVoiceData.words || currentVoiceData.words.length === 0) return;
    const words = currentVoiceData.words;
    
    // O(log N) Binary search across sorted word cues
    let newIndex = -1;
    let low = 0;
    let high = words.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const w = words[mid];
      if (currentTime < w.start) {
        high = mid - 1;
      } else if (currentTime > w.end) {
        low = mid + 1;
      } else {
        newIndex = mid;
        break;
      }
    }

    if (newIndex !== voiceActiveCueIndex) {
      if (voiceActiveCueIndex >= 0) {
        const prevEl = document.getElementById(`vw-cue-${voiceActiveCueIndex}`);
        if (prevEl) prevEl.classList.remove("active");
      }
      if (newIndex >= 0) {
        const nextEl = document.getElementById(`vw-cue-${newIndex}`);
        if (nextEl) {
          nextEl.classList.add("active");
          nextEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
      voiceActiveCueIndex = newIndex;
    }
  }

  // Load Voice Slice
  async function loadVoiceWorkbench(dirName) {
    if (!dirName) {
      if (voiceChunksContainer) {
        voiceChunksContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;">Chưa có dữ liệu giọng đọc. Vui lòng chọn hoặc mở một dự án.</div>`;
      }
      if (voiceCuesContainer) {
        voiceCuesContainer.innerHTML = `<p class="empty-state">Chưa có dữ liệu mốc thời gian.</p>`;
      }
      return;
    }

    if (voiceChunksContainer) {
      voiceChunksContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;"><span class="inline-spinner"></span> Đang tải dữ liệu giọng đọc...</div>`;
    }
    if (voiceCuesContainer) {
      voiceCuesContainer.innerHTML = `<p class="empty-state"><span class="inline-spinner"></span> Đang tải bản chép lời và mốc thời gian...</p>`;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(dirName)}/v2/voice`);
      if (!res.ok) {
        throw new Error(`Mã lỗi ${res.status}`);
      }
      currentVoiceData = await res.json();
      if (currentProjectDir !== dirName) return;

      // Update audio source
      if (audioPlayer) {
        const wavUrl = `/api/projects/${encodeURIComponent(dirName)}/audio/wav`;
        if (currentVoiceData.has_audio) {
          if (!audioPlayer.src || !audioPlayer.src.includes(encodeURIComponent(dirName))) {
            audioPlayer.src = `${wavUrl}?t=${Date.now()}`;
          }
        }
      }

      // Update download links based on real file availability (Gate L)
      if (voiceDlWav) {
        if (currentVoiceData.has_audio) {
          voiceDlWav.href = `/api/projects/${encodeURIComponent(dirName)}/audio/wav`;
          voiceDlWav.style.display = "block";
        } else {
          voiceDlWav.style.display = "none";
        }
      }
      if (voiceDlMp3) {
        if (currentVoiceData.has_mp3) {
          voiceDlMp3.href = `/api/projects/${encodeURIComponent(dirName)}/audio/mp3`;
          voiceDlMp3.style.display = "block";
        } else {
          voiceDlMp3.style.display = "none";
        }
      }
      if (voiceDlSrt) {
        if (currentVoiceData.segments && currentVoiceData.segments.length > 0) {
          voiceDlSrt.href = `/api/projects/${encodeURIComponent(dirName)}/timestamps/srt`;
          voiceDlSrt.style.display = "block";
        } else {
          voiceDlSrt.style.display = "none";
        }
      }
      if (voiceDlTs) {
        if (currentVoiceData.words && currentVoiceData.words.length > 0) {
          voiceDlTs.href = `/api/projects/${encodeURIComponent(dirName)}/timestamps.json`;
          voiceDlTs.style.display = "block";
        } else {
          voiceDlTs.style.display = "none";
        }
      }

      // Update status pill & total duration
      if (voiceAudioStatusPill) {
        if (currentVoiceData.audio_status === "READY") {
          voiceAudioStatusPill.className = "state-pill state-ready";
          voiceAudioStatusPill.textContent = "Sẵn sàng";
        } else if (currentVoiceData.audio_status === "OUTDATED") {
          voiceAudioStatusPill.className = "state-pill state-warning";
          voiceAudioStatusPill.textContent = "Cần cập nhật";
        } else {
          voiceAudioStatusPill.className = "state-pill state-idle";
          voiceAudioStatusPill.textContent = "Chưa tạo";
        }
      }

      if (voiceTotDur) {
        voiceTotDur.textContent = formatTime(currentVoiceData.total_duration_seconds || 0);
      }

      // Update Voice Settings
      if (voiceSelectModel && currentVoiceData.voice_id) {
        voiceSelectModel.value = currentVoiceData.voice_id;
      }
      if (voiceTtsSpeed && currentVoiceData.speed != null) {
        voiceTtsSpeed.value = currentVoiceData.speed;
        if (voiceTtsSpeedVal) voiceTtsSpeedVal.textContent = `${parseFloat(currentVoiceData.speed).toFixed(2)}x`;
      }

      // Render Chunks
      renderVoiceChunks();

      // Render Word Cues
      renderVoiceWordCues();

      // Render Voice QA
      renderVoiceQAData();

      // Render Pronunciations
      renderVoicePronunciations();

      // Auto-select first chunk if none selected
      if (currentVoiceData.chunks && currentVoiceData.chunks.length > 0) {
        if (!selectedVoiceChunkId || !currentVoiceData.chunks.some(c => c.chunk_id === selectedVoiceChunkId)) {
          selectVoiceChunk(currentVoiceData.chunks[0].chunk_id);
        } else {
          selectVoiceChunk(selectedVoiceChunkId);
        }
      }
    } catch (err) {
      if (voiceChunksContainer) {
        voiceChunksContainer.innerHTML = `
          <div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem; color: var(--uq-bad, #ef4444);">
            Không thể tải dữ liệu giọng đọc (${err.message}).
            <button class="btn btn-xs btn-secondary" style="margin-top: 8px; display: inline-block;" onclick="window.loadVoiceWorkbench && window.loadVoiceWorkbench(window.currentProjectDir)">Thử lại</button>
          </div>`;
      }
      if (voiceCuesContainer) {
        voiceCuesContainer.innerHTML = `<p class="empty-state" style="color: var(--uq-bad, #ef4444);">Không thể tải mốc thời gian.</p>`;
      }
    }
  }
  window.loadVoiceWorkbench = loadVoiceWorkbench;

  function renderVoiceChunks() {
    if (!voiceChunksContainer || !currentVoiceData) return;
    const chunks = currentVoiceData.chunks || [];
    if (voiceChunksCount) voiceChunksCount.textContent = chunks.length;

    if (chunks.length === 0) {
      voiceChunksContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;">Dự án chưa có đoạn kịch bản hoặc chưa phân đoạn.</div>`;
      return;
    }

    const searchTerm = (voiceChunkSearch ? voiceChunkSearch.value : "").toLowerCase().trim();
    const filterVal = voiceChunkFilter ? voiceChunkFilter.value : "all";

    const filtered = chunks.filter(c => {
      if (searchTerm) {
        const textMatch = (c.text || "").toLowerCase().includes(searchTerm);
        const idMatch = (c.chunk_id || "").toLowerCase().includes(searchTerm);
        if (!textMatch && !idMatch) return false;
      }
      if (filterVal === "ready" && c.status !== "READY") return false;
      if (filterVal === "empty" && c.status !== "EMPTY") return false;
      if (filterVal === "locked" && !c.is_locked) return false;
      if (filterVal === "qa_issue" && (!c.qa_issues_count || c.qa_issues_count === 0)) return false;
      return true;
    });

    if (filtered.length === 0) {
      voiceChunksContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;">Không tìm thấy đoạn đọc phù hợp với bộ lọc.</div>`;
      return;
    }

    voiceChunksContainer.innerHTML = filtered.map((c) => {
      const isSelected = c.chunk_id === selectedVoiceChunkId;
      const lockBadge = c.is_locked ? `<span class="badge" title="Đoạn đã được bảo vệ">🔒 Đã khóa</span>` : "";
      const qaBadge = (c.qa_issues_count && c.qa_issues_count > 0)
        ? `<span class="state-pill state-warning" style="font-size: 10px; padding: 1px 4px;" title="${c.qa_issues_count} cảnh báo kiểm định">⚠️ ${c.qa_issues_count}</span>`
        : "";
      const statusClass = c.status === "READY" ? "state-ready" : (c.status === "OUTDATED" ? "state-warning" : "state-idle");
      const statusLabel = c.status === "READY" ? "Sẵn sàng" : (c.status === "OUTDATED" ? "Cần cập nhật" : "Chưa có audio");

      return `
        <div
          class="voice-chunk-item ${isSelected ? 'selected' : ''}"
          id="vw-chunk-${c.chunk_id}"
          data-chunk-id="${c.chunk_id}"
          role="option"
          aria-selected="${isSelected ? 'true' : 'false'}"
          tabindex="${isSelected ? '0' : '-1'}"
        >
          <div class="voice-chunk-header">
            <span class="voice-chunk-id">#${c.chunk_id}</span>
            <div class="voice-chunk-badges">
              ${lockBadge}
              ${qaBadge}
              <span class="state-pill ${statusClass}" style="font-size: 10px; padding: 1px 5px;">${statusLabel}</span>
            </div>
          </div>
          <div class="voice-chunk-text">${escapeHtml(c.text || '')}</div>
          <div class="voice-chunk-meta">
            <span>${c.voice || 'af_heart'}</span>
            <span>${c.duration ? `${c.duration.toFixed(1)}s` : '~'}</span>
          </div>
        </div>
      `;
    }).join("");

    // Attach click handlers
    voiceChunksContainer.querySelectorAll(".voice-chunk-item").forEach(el => {
      el.addEventListener("click", () => {
        selectVoiceChunk(el.dataset.chunkId);
      });
    });
  }

  function selectVoiceChunk(chunkId) {
    if (!currentVoiceData || !currentVoiceData.chunks) return;
    const chunk = currentVoiceData.chunks.find(c => c.chunk_id === chunkId);
    if (!chunk) return;
    selectedVoiceChunkId = chunkId;

    // Update navigator items
    if (voiceChunksContainer) {
      voiceChunksContainer.querySelectorAll(".voice-chunk-item").forEach(el => {
        const isTarget = el.dataset.chunkId === chunkId;
        if (isTarget) {
          el.classList.add("selected");
          el.setAttribute("aria-selected", "true");
          el.setAttribute("tabindex", "0");
          el.focus();
        } else {
          el.classList.remove("selected");
          el.setAttribute("aria-selected", "false");
          el.setAttribute("tabindex", "-1");
        }
      });
    }

    // Update Transport context
    if (voicePlayingContext) {
      voicePlayingContext.textContent = `Đoạn #${chunk.chunk_id} (${chunk.duration ? chunk.duration.toFixed(1) + 's' : 'Chưa có thời lượng'})`;
    }
    if (btnPlaySelectedChunk) {
      btnPlaySelectedChunk.style.display = "inline-block";
      btnPlaySelectedChunk.onclick = () => {
        // Play single chunk or seek to its segment start
        const seg = currentVoiceData.segments && currentVoiceData.segments[chunk.index - 1];
        if (seg && seg.start != null) {
          window.seekGlobalAudio(parseFloat(seg.start), `Đoạn #${chunk.chunk_id}`);
        } else {
          showNotification(`Đang phát đoạn #${chunk.chunk_id}...`, "info");
        }
      };
    }

    // Update Lock & History card
    if (voiceChunkLockStatus) {
      voiceChunkLockStatus.textContent = chunk.is_locked ? "Đã khóa" : "Mở khóa";
      voiceChunkLockStatus.className = chunk.is_locked ? "state-pill state-ready" : "state-pill state-idle";
    }
    if (btnToggleChunkLock) {
      btnToggleChunkLock.textContent = chunk.is_locked ? "Mở khóa đoạn này" : "Khóa đoạn này (Tránh ghi đè)";
      btnToggleChunkLock.onclick = () => toggleChunkLock(chunk.chunk_id, !chunk.is_locked);
    }
    loadChunkHistory(chunk.chunk_id);
  }

  // Keyboard navigation on Voice Navigator listbox
  if (voiceChunksContainer) {
    voiceChunksContainer.addEventListener("keydown", (e) => {
      const items = Array.from(voiceChunksContainer.querySelectorAll(".voice-chunk-item"));
      if (items.length === 0) return;
      const currentIndex = items.findIndex(el => el.dataset.chunkId === selectedVoiceChunkId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) < items.length ? currentIndex + 1 : 0;
        selectVoiceChunk(items[nextIndex].dataset.chunkId);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = (currentIndex - 1) >= 0 ? currentIndex - 1 : items.length - 1;
        selectVoiceChunk(items[prevIndex].dataset.chunkId);
      } else if (e.key === "Home") {
        e.preventDefault();
        selectVoiceChunk(items[0].dataset.chunkId);
      } else if (e.key === "End") {
        e.preventDefault();
        selectVoiceChunk(items[items.length - 1].dataset.chunkId);
      }
    });
  }

  // Filters change
  if (voiceChunkSearch) voiceChunkSearch.addEventListener("input", renderVoiceChunks);
  if (voiceChunkFilter) voiceChunkFilter.addEventListener("change", renderVoiceChunks);

  function renderVoiceWordCues() {
    if (!voiceCuesContainer || !currentVoiceData) return;
    const words = currentVoiceData.words || [];
    if (voiceCuesCount) voiceCuesCount.textContent = `${words.length} từ`;

    if (words.length === 0) {
      const scriptText = currentVoiceData.transcript_text || "";
      if (scriptText) {
        voiceCuesContainer.innerHTML = `
          <div style="line-height: 1.8; color: var(--uq-ink-2); white-space: pre-wrap;">${escapeHtml(scriptText)}</div>
          <div class="empty-state" style="margin-top: 1rem;">Chưa có mốc thời gian từng từ. Nhấn <strong>"Căn chỉnh thời gian (Whisper)"</strong> để tạo.</div>
        `;
      } else {
        voiceCuesContainer.innerHTML = `<p class="empty-state">Chưa có kịch bản hoặc mốc thời gian.</p>`;
      }
      return;
    }

    voiceCuesContainer.setAttribute("tabindex", "0");
    voiceCuesContainer.innerHTML = words.map((w, idx) => {
      return `<span
        class="word-cue"
        id="vw-cue-${idx}"
        data-index="${idx}"
        data-start="${w.start}"
        data-end="${w.end}"
        role="button"
        tabindex="-1"
        aria-label="${escapeHtml(w.word)} tại ${w.start} giây"
        title="${w.word} (${w.start}s - ${w.end}s)"
      >${escapeHtml(w.word)}</span>`;
    }).join(" ");

    // Ensure first cue has tabindex 0 for roving entry
    const firstCue = voiceCuesContainer.querySelector(".word-cue");
    if (firstCue) firstCue.setAttribute("tabindex", "0");

    // Click-to-seek handler on all word cues
    voiceCuesContainer.querySelectorAll(".word-cue").forEach(el => {
      el.addEventListener("click", () => {
        const start = parseFloat(el.dataset.start);
        if (!isNaN(start)) {
          window.seekGlobalAudio(start, `Từ: ${el.textContent.trim()} (${start.toFixed(2)}s)`);
        }
      });
    });

    // Keyboard navigation within word cues container (Left/Right arrow seek, Enter/Space trigger, Tab exits)
    voiceCuesContainer.onkeydown = (e) => {
      const cues = Array.from(voiceCuesContainer.querySelectorAll(".word-cue"));
      if (cues.length === 0) return;
      const focusedCue = document.activeElement && document.activeElement.classList.contains("word-cue") ? document.activeElement : null;
      let currIdx = focusedCue ? parseInt(focusedCue.dataset.index, 10) : (voiceActiveCueIndex >= 0 ? voiceActiveCueIndex : 0);

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(cues.length - 1, currIdx + 1);
        cues.forEach(c => c.setAttribute("tabindex", "-1"));
        cues[nextIdx].setAttribute("tabindex", "0");
        cues[nextIdx].focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(0, currIdx - 1);
        cues.forEach(c => c.setAttribute("tabindex", "-1"));
        cues[prevIdx].setAttribute("tabindex", "0");
        cues[prevIdx].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        if (focusedCue) {
          e.preventDefault();
          const start = parseFloat(focusedCue.dataset.start);
          if (!isNaN(start)) {
            window.seekGlobalAudio(start, `Từ: ${focusedCue.textContent.trim()} (${start.toFixed(2)}s)`);
          }
        }
      }
    };
  }

  function renderVoiceQAData() {
    if (!currentVoiceData) return;
    const qa = currentVoiceData.qa_summary;
    if (!qa) {
      if (voiceQaVerdictBadge) voiceQaVerdictBadge.textContent = "Chưa chạy";
      if (voiceQaMatch) voiceQaMatch.textContent = "—";
      if (voiceQaWer) voiceQaWer.textContent = "—";
      if (voiceQaWpm) voiceQaWpm.textContent = "—";
      if (voiceQaIssuesCount) voiceQaIssuesCount.textContent = "0";
      if (voiceQaIssuesList) voiceQaIssuesList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem; padding: 0.5rem 0;">Chưa chạy kiểm tra Voice QA.</p>`;
      return;
    }

    const m = qa.metrics || {};
    if (voiceQaVerdictBadge) {
      voiceQaVerdictBadge.textContent = qa.status === "pass" ? "Đạt chuẩn" : (qa.status === "review" ? "Cần xem lại" : "Chưa đạt");
      voiceQaVerdictBadge.className = qa.status === "pass" ? "state-pill state-ready" : "state-pill state-warning";
    }
    if (voiceQaMatch) voiceQaMatch.textContent = `${(m.transcript_match_pct || m.transcript_match_percent || 0).toFixed(1)}%`;
    if (voiceQaWer) voiceQaWer.textContent = `${(m.wer_pct || (m.wer ? m.wer * 100 : 0)).toFixed(1)}%`;
    if (voiceQaWpm) voiceQaWpm.textContent = `${(m.overall_wpm || 0).toFixed(0)} WPM`;
    if (voiceQaIssuesCount) voiceQaIssuesCount.textContent = `${qa.total_issues || 0}`;

    const issues = qa.issues || [];
    if (!voiceQaIssuesList) return;
    if (issues.length === 0) {
      voiceQaIssuesList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem; padding: 0.5rem 0; color: var(--uq-good, #10b981);">✓ Không có lỗi phát âm hay ngữ điệu nào.</p>`;
      return;
    }

    voiceQaIssuesList.innerHTML = issues.slice(0, 50).map(iss => {
      const typeLabel = iss.type || iss.category || "Cảnh báo";
      const startSec = iss.start_seconds || iss.start_time || 0;
      return `
        <div class="voice-qa-issue-item" data-start="${startSec}" data-sentence="${iss.sentence_index || ''}" title="Bấm để tua đến điểm phát hiện">
          <div style="display: flex; justify-content: space-between; font-weight: 600; color: var(--uq-ink-2);">
            <span>${escapeHtml(typeLabel)}</span>
            <span style="font-family: var(--uq-font-mono);">${startSec.toFixed(1)}s</span>
          </div>
          <div style="color: var(--uq-ink-1); margin-top: 2px;">${escapeHtml(iss.description || iss.reason || iss.context || '')}</div>
        </div>
      `;
    }).join("");

    voiceQaIssuesList.querySelectorAll(".voice-qa-issue-item").forEach(el => {
      el.addEventListener("click", () => {
        const start = parseFloat(el.dataset.start);
        if (!isNaN(start)) {
          window.seekGlobalAudio(start, `Vấn đề QA (${start.toFixed(1)}s)`);
        }
      });
    });
  }

  // Pronunciation List rendering
  async function renderVoicePronunciations() {
    if (!voicePronList) return;
    try {
      const res = await fetch("/api/pronunciations");
      if (!res.ok) return;
      const data = await res.json();
      const entries = data.entries || data || [];
      if (voicePronCount) voicePronCount.textContent = entries.length;

      if (entries.length === 0) {
        voicePronList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Chưa có từ thay thế phát âm nào.</p>`;
        return;
      }

      voicePronList.innerHTML = entries.map(e => `
        <div class="voice-pron-item" id="vw-pron-${e.id}">
          <div>
            <strong>${escapeHtml(e.original)}</strong> → <span style="color: var(--uq-accent-ink);">${escapeHtml(e.spoken_form)}</span>
          </div>
          <button class="btn btn-xs btn-outline" onclick="window.deletePronunciationEntry('${e.id}')" title="Xóa quy tắc">✕</button>
        </div>
      `).join("");
    } catch (e) {
      console.warn("Failed to load pronunciations:", e);
    }
  }

  // Add pronunciation entry
  if (voicePronAddForm) {
    voicePronAddForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const orig = voicePronTerm ? voicePronTerm.value.trim() : "";
      const spoken = voicePronSpoken ? voicePronSpoken.value.trim() : "";
      if (!orig || !spoken) return;

      try {
        const res = await fetch("/api/pronunciations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ original: orig, spoken_form: spoken })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Lỗi ${res.status}`);
        }
        if (voicePronTerm) voicePronTerm.value = "";
        if (voicePronSpoken) voicePronSpoken.value = "";
        showNotification("Đã thêm từ phát âm vào từ điển.", "success");
        renderVoicePronunciations();

        // Check chunk impact
        if (currentVoiceData && currentVoiceData.chunks) {
          const impacted = currentVoiceData.chunks.filter(c => (c.text || "").toLowerCase().includes(orig.toLowerCase()));
          if (impacted.length > 0) {
            showNotification(`Có ${impacted.length} đoạn kịch bản bị ảnh hưởng (cần tạo lại giọng đọc khi sẵn sàng).`, "warning");
          }
        }
      } catch (err) {
        showNotification(`Lỗi thêm phát âm: ${err.message}`, "error");
      }
    });
  }

  // Delete pronunciation helper
  window.deletePronunciationEntry = async function(id) {
    if (!confirm("Bạn có chắc chắn muốn xóa quy tắc phát âm này?")) return;
    try {
      const res = await fetch(`/api/pronunciations/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Lỗi ${res.status}`);
      showNotification("Đã xóa quy tắc phát âm.", "info");
      renderVoicePronunciations();
    } catch (err) {
      showNotification(`Lỗi: ${err.message}`, "error");
    }
  };

  // Test Pronunciation audio
  if (btnPronTestAudio) {
    btnPronTestAudio.addEventListener("click", async () => {
      const spoken = voicePronSpoken ? voicePronSpoken.value.trim() : (voicePronTerm ? voicePronTerm.value.trim() : "");
      if (!spoken) {
        showNotification("Vui lòng nhập từ hoặc cách đọc để nghe thử.", "warning");
        return;
      }
      try {
        const res = await fetch("/api/pronunciations/test-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: spoken, voice: voiceSelectModel ? voiceSelectModel.value : "af_heart" })
        });
        if (!res.ok) throw new Error(`Lỗi ${res.status}`);
        const data = await res.json();
        if (data.audio_url) {
          const snd = new Audio(`${data.audio_url}?t=${Date.now()}`);
          snd.play();
        }
      } catch (err) {
        showNotification(`Lỗi nghe thử: ${err.message}`, "error");
      }
    });
  }

  // Lock toggle
  async function toggleChunkLock(chunkId, newLockedState) {
    if (!currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/lock/audio_chunk/${encodeURIComponent(chunkId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_locked: newLockedState })
      });
      if (!res.ok) throw new Error(`Lỗi ${res.status}`);
      showNotification(newLockedState ? `Đã khóa đoạn #${chunkId}` : `Đã mở khóa đoạn #${chunkId}`, "success");
      loadVoiceWorkbench(currentProjectDir);
    } catch (err) {
      showNotification(`Lỗi đổi trạng thái khóa: ${err.message}`, "error");
    }
  }

  // Chunk revision history
  async function loadChunkHistory(chunkId) {
    if (!voiceHistoryList || !currentProjectDir) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/history/audio_chunk/${encodeURIComponent(chunkId)}`);
      if (!res.ok) {
        voiceHistoryList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Không có lịch sử sửa đổi.</p>`;
        return;
      }
      const data = await res.json();
      const revs = data.revisions || [];
      if (revs.length === 0) {
        voiceHistoryList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Chưa có bản sửa đổi nào.</p>`;
        return;
      }
      voiceHistoryList.innerHTML = revs.map(r => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px; font-size: 11px; border-bottom: 1px solid var(--uq-line);">
          <span>${new Date(r.timestamp).toLocaleTimeString()}</span>
          <button class="btn btn-xs btn-outline" onclick="window.restoreChunkRevision('${r.revision_id}')">Khôi phục</button>
        </div>
      `).join("");
    } catch (e) {
      voiceHistoryList.innerHTML = `<p class="empty-state" style="font-size: 0.82rem;">Không thể tải lịch sử.</p>`;
    }
  }

  window.restoreChunkRevision = async function(revId) {
    if (!currentProjectDir || !confirm("Khôi phục bản lưu này?")) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/history/${encodeURIComponent(revId)}/restore`, {
        method: "POST"
      });
      if (!res.ok) throw new Error(`Lỗi ${res.status}`);
      showNotification("Đã khôi phục bản lưu thành công.", "success");
      loadVoiceWorkbench(currentProjectDir);
    } catch (err) {
      showNotification(`Lỗi khôi phục: ${err.message}`, "error");
    }
  };
  window.loadVoiceWorkbench = loadVoiceWorkbench;

  // Run Voice QA button in workbench
  if (btnRunVoiceQaWorkbench) {
    btnRunVoiceQaWorkbench.addEventListener("click", () => {
      if (!currentProjectDir) return;
      runVoiceQA(currentProjectDir, false);
      setTimeout(() => loadVoiceWorkbench(currentProjectDir), 2000);
    });
  }

  // STT Faster-Whisper alignment button
  if (btnRunWhisperAlignment) {
    btnRunWhisperAlignment.addEventListener("click", async () => {
      if (!currentProjectDir) {
        showNotification("Vui lòng mở dự án trước khi chạy Whisper.", "warning");
        return;
      }
      try {
        btnRunWhisperAlignment.disabled = true;
        if (btnCancelWhisperAlignment) btnCancelWhisperAlignment.style.display = "inline-block";
        if (voiceSttProgress) voiceSttProgress.style.display = "block";
        if (voiceSttProgressMsg) voiceSttProgressMsg.textContent = "Khởi động Faster-Whisper...";

        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/timestamps/generate`, {
          method: "POST"
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Lỗi ${res.status}`);
        }

        // Poll Whisper status
        if (voiceSttPollInterval) clearInterval(voiceSttPollInterval);
        voiceSttPollInterval = setInterval(async () => {
          try {
            const sRes = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/timestamps/status`);
            if (!sRes.ok) return;
            const sData = await sRes.json();
            const pct = sData.progress || sData.percent || 0;
            if (voiceSttProgressFill) voiceSttProgressFill.style.width = `${pct}%`;
            if (voiceSttProgressPct) voiceSttProgressPct.textContent = `${pct}%`;
            if (voiceSttProgressMsg && sData.message) voiceSttProgressMsg.textContent = sData.message;

            const isDone = sData.status === "Ready" || sData.state === "completed" || sData.status === "Failed" || sData.state === "failed";
            if (isDone) {
              clearInterval(voiceSttPollInterval);
              voiceSttPollInterval = null;
              btnRunWhisperAlignment.disabled = false;
              if (btnCancelWhisperAlignment) btnCancelWhisperAlignment.style.display = "none";
              if (voiceSttProgress) voiceSttProgress.style.display = "none";

              if (sData.status === "Ready" || sData.state === "completed") {
                showNotification("Căn chỉnh thời gian (Faster-Whisper) hoàn tất!", "success");
              } else {
                showNotification(`Lỗi Whisper: ${sData.error || "Thất bại"}`, "error");
              }
              loadVoiceWorkbench(currentProjectDir);
            }
          } catch (e) {
            console.warn("Poll whisper error:", e);
          }
        }, 1500);
      } catch (err) {
        btnRunWhisperAlignment.disabled = false;
        if (btnCancelWhisperAlignment) btnCancelWhisperAlignment.style.display = "none";
        if (voiceSttProgress) voiceSttProgress.style.display = "none";
        showNotification(`Lỗi Whisper: ${err.message}`, "error");
      }
    });
  }

  if (btnCancelWhisperAlignment) {
    btnCancelWhisperAlignment.addEventListener("click", async () => {
      if (!currentProjectDir) return;
      try {
        await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/timestamps/cancel`, { method: "POST" });
        if (voiceSttPollInterval) {
          clearInterval(voiceSttPollInterval);
          voiceSttPollInterval = null;
        }
        btnRunWhisperAlignment.disabled = false;
        btnCancelWhisperAlignment.style.display = "none";
        if (voiceSttProgress) voiceSttProgress.style.display = "none";
        showNotification("Đã yêu cầu hủy Whisper.", "info");
      } catch (e) {
        showNotification("Lỗi hủy Whisper: " + e.message, "error");
      }
    });
  }

  // TTS Generate All Voice
  if (btnGenerateAllVoice) {
    btnGenerateAllVoice.addEventListener("click", async () => {
      if (!currentProjectDir) return;
      if (!confirm("Bạn có chắc chắn muốn tạo lại toàn bộ giọng đọc kịch bản? Thao tác này sẽ ghi nhận cài đặt mới và tạo lại các đoạn audio.")) {
        return;
      }
      const voice = voiceSelectModel ? voiceSelectModel.value : "af_heart";
      const speed = voiceTtsSpeed ? parseFloat(voiceTtsSpeed.value) : 1.1;

      btnGenerateAllVoice.disabled = true;
      btnGenerateAllVoice.textContent = "Đang tạo giọng đọc...";
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_dir: currentProjectDir,
            voice: voice,
            speed: speed
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Lỗi ${res.status}`);
        }
        const data = await res.json();
        showNotification("Đã khởi động tiến trình tạo giọng đọc toàn bộ!", "success");
        // Reload after a delay
        setTimeout(() => {
          loadVoiceWorkbench(currentProjectDir);
          if (btnGenerateAllVoice) {
            btnGenerateAllVoice.disabled = false;
            btnGenerateAllVoice.textContent = "Tạo lại toàn bộ giọng đọc";
          }
        }, 3000);
      } catch (err) {
        if (btnGenerateAllVoice) {
          btnGenerateAllVoice.disabled = false;
          btnGenerateAllVoice.textContent = "Tạo lại toàn bộ giọng đọc";
        }
        showNotification(`Lỗi tạo giọng đọc: ${err.message}`, "error");
      }
    });
  }

  // TTS Generate Selected Chunk
  if (btnGenerateSelectedChunk) {
    btnGenerateSelectedChunk.addEventListener("click", async () => {
      if (!currentProjectDir || !selectedVoiceChunkId) {
        showNotification("Vui lòng chọn một đoạn đọc để tạo lại.", "warning");
        return;
      }
      const chunk = currentVoiceData && currentVoiceData.chunks && currentVoiceData.chunks.find(c => c.chunk_id === selectedVoiceChunkId);
      const chunkIndex = chunk ? chunk.index : 1;

      btnGenerateSelectedChunk.disabled = true;
      btnGenerateSelectedChunk.textContent = "Đang tạo...";
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/voice/chunks/${encodeURIComponent(selectedVoiceChunkId)}/regenerate`, {
          method: "POST"
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg = (err.detail && typeof err.detail === "object") ? err.detail.message : (err.detail || `Lỗi ${res.status}`);
          throw new Error(msg);
        }
        showNotification(`Đã tạo lại đoạn #${selectedVoiceChunkId} thành công!`, "success");
        loadVoiceWorkbench(currentProjectDir);
      } catch (err) {
        showNotification(`Lỗi tạo đoạn #${selectedVoiceChunkId}: ${err.message}`, "error");
      } finally {
        btnGenerateSelectedChunk.disabled = false;
        btnGenerateSelectedChunk.textContent = "Tạo giọng đoạn đang chọn";
      }
    });
  }

  // ==============================================================================
  // 13d. SUBPHASE 3C: VISUAL WORKBENCH (SCENES, SHOTS & VISUAL BIBLE)
  // ==============================================================================
  let visualWorkbenchSummary = null;
  let visualScenesList = [];
  let visualSelectedSceneId = null;
  let visualSelectedShotId = null;
  let visualCurrentScene = null;
  let visualCurrentShot = null;
  let visualBibleSliceData = null;
  let visualExpandedSceneIds = new Set();
  let visualDirtyPrompts = { image: false, veo: false };

  const spFilterStatus = document.getElementById("sp-filter-status");
  const vwBindingsContainer = document.getElementById("vw-bindings-container");
  const vwBindingsCountBadge = document.getElementById("vw-bindings-count-badge");
  const vwLockCard = document.getElementById("vw-lock-card");
  const vwLockStatusBadge = document.getElementById("vw-lock-status-badge");
  const btnLockShot = document.getElementById("btn-lock-shot");
  const btnLockShotText = document.getElementById("btn-lock-shot-text");
  const vwRevisionsContainer = document.getElementById("vw-revisions-container");
  const vwRevisionsCountBadge = document.getElementById("vw-revisions-count-badge");

  async function loadVisualWorkbench(dirName) {
    if (!dirName) {
      if (spRowsContainer) {
        spRowsContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;">Chưa có dữ liệu cảnh quay. Vui lòng chọn một dự án.</div>`;
      }
      if (spSelectedDetail) {
        spSelectedDetail.innerHTML = `<div class="empty-detail-state"><svg class="ui-icon ui-icon-lg"><use href="#icon-scene"/></svg><span>Chọn một cảnh từ danh sách để xem và chỉnh sửa chi tiết</span></div>`;
      }
      return;
    }

    if (spRowsContainer) {
      spRowsContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; font-size: 0.85rem;"><span class="inline-spinner"></span> Đang tải danh sách cảnh &amp; cảnh quay...</div>`;
    }

    try {
      const [sumRes, scenesRes, vbRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(dirName)}/visual/summary`),
        fetch(`/api/projects/${encodeURIComponent(dirName)}/visual/scenes`),
        fetch(`/api/projects/${encodeURIComponent(dirName)}/visual/bible`)
      ]);

      if (!scenesRes.ok) {
        throw new Error(`Mã lỗi tải cảnh: ${scenesRes.status}`);
      }

      visualWorkbenchSummary = sumRes.ok ? await sumRes.json() : null;
      visualScenesList = await scenesRes.json();
      visualBibleSliceData = vbRes.ok ? await vbRes.json() : null;

      if (currentProjectDir !== dirName) return;

      // Update counters
      if (spCountBadge && visualWorkbenchSummary) {
        spCountBadge.textContent = `${visualWorkbenchSummary.total_scenes} cảnh / ${visualWorkbenchSummary.total_shots} cảnh quay`;
      }
      if (spCoverageBadge) {
        spCoverageBadge.textContent = "Độ phủ 100%";
      }
      if (spStatusPill && visualWorkbenchSummary) {
        const isReady = visualWorkbenchSummary.visual_status === "READY" || visualWorkbenchSummary.visual_status === "Ready";
        spStatusPill.className = isReady ? "state-pill state-ready" : "state-pill state-idle";
        spStatusPill.textContent = isReady ? "Sẵn sàng" : (visualWorkbenchSummary.visual_status || "Chưa sẵn sàng");
      }

      // Populate Category Filter dropdown
      if (spFilterCategory) {
        const currentVal = spFilterCategory.value;
        const categories = Array.from(new Set(visualScenesList.map(s => s.category).filter(Boolean)));
        spFilterCategory.innerHTML = `<option value="">Tất cả thể loại</option>` +
          categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
        if (categories.includes(currentVal)) {
          spFilterCategory.value = currentVal;
        }
      }

      // Render Scene Navigator tree
      renderVisualSceneNavigator();

      // Restore or initialize selection
      let targetSceneId = visualSelectedSceneId;
      let targetShotId = visualSelectedShotId;
      const sceneExists = visualScenesList.some(s => s.scene_id === targetSceneId);
      if (!targetSceneId || !sceneExists) {
        if (visualScenesList.length > 0) {
          targetSceneId = visualScenesList[0].scene_id;
          targetShotId = (visualScenesList[0].shot_ids && visualScenesList[0].shot_ids[0]) || `${targetSceneId}_sh1`;
        }
      }

      if (targetSceneId && targetShotId) {
        selectVisualShot(targetShotId, targetSceneId);
      }
    } catch (err) {
      console.error("Failed to load visual workbench:", err);
      if (spRowsContainer) {
        spRowsContainer.innerHTML = `<div class="empty-state" style="padding: 1.5rem 1rem; color: var(--color-error);"><p>Lỗi tải danh sách cảnh: ${escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  function renderVisualSceneNavigator() {
    if (!spRowsContainer) return;
    if (!visualScenesList || visualScenesList.length === 0) {
      spRowsContainer.innerHTML = `<p class="empty-state">Chưa có Scene Plan.<br>Sau khi có Timestamp, bấm "Tạo Scene Plan".</p>`;
      if (spRowCountBadge) spRowCountBadge.textContent = "0/0";
      return;
    }

    const query = (spSearchInput && spSearchInput.value) ? spSearchInput.value.trim().toLowerCase() : "";
    const filterCat = (spFilterCategory && spFilterCategory.value) ? spFilterCategory.value : "";
    const filterStatus = (spFilterStatus && spFilterStatus.value) ? spFilterStatus.value : "";

    const filteredScenes = visualScenesList.filter(sc => {
      if (filterCat && sc.category !== filterCat) return false;
      if (filterStatus === "locked" && !sc.is_locked) return false;
      if (filterStatus === "outdated" && sc.status !== "outdated") return false;
      if (filterStatus === "ready" && (sc.is_locked || sc.status === "outdated")) return false;

      if (query) {
        const matchId = sc.scene_id.toLowerCase().includes(query);
        const matchIdx = String(sc.index).includes(query);
        const matchCat = (sc.category || "").toLowerCase().includes(query);
        const matchSum = (sc.visual_summary || "").toLowerCase().includes(query);
        const matchShot = (sc.shot_ids || []).some(sh => sh.toLowerCase().includes(query));
        if (!matchId && !matchIdx && !matchCat && !matchSum && !matchShot) return false;
      }
      return true;
    });

    if (spRowCountBadge) {
      spRowCountBadge.textContent = `${filteredScenes.length}/${visualScenesList.length}`;
    }

    if (filteredScenes.length === 0) {
      spRowsContainer.innerHTML = `<p class="empty-state" style="padding: 1.5rem 1rem;">Không tìm thấy cảnh nào phù hợp với bộ lọc.</p>`;
      return;
    }

    let html = "";
    filteredScenes.forEach(sc => {
      const isExpanded = visualExpandedSceneIds.has(sc.scene_id) || sc.scene_id === visualSelectedSceneId;
      const isSceneSelected = sc.scene_id === visualSelectedSceneId;
      const sFmt = formatTime(sc.start);
      const eFmt = formatTime(sc.end);
      const shots = sc.shot_ids || [];

      html += `
        <div class="visual-scene-group ${isExpanded ? 'is-expanded' : ''} ${isSceneSelected ? 'is-selected' : ''}" data-scene-id="${escapeHtml(sc.scene_id)}">
          <button type="button" class="visual-scene-header-btn" data-action="select-scene" data-scene-id="${escapeHtml(sc.scene_id)}" aria-expanded="${isExpanded}">
            <span class="visual-scene-expander" data-action="toggle-expand" data-scene-id="${escapeHtml(sc.scene_id)}" title="${isExpanded ? 'Thu gọn cảnh' : 'Mở rộng cảnh'}">&#9654;</span>
            <span class="visual-scene-title">Cảnh ${sc.index}</span>
            <span class="cat-badge">${escapeHtml(sc.category || 'reconstruction')}</span>
            <span class="counter-chip" style="font-size: 0.65rem;">${shots.length} shot</span>
            ${sc.is_locked ? '<span title="Cảnh đã khóa">🔒</span>' : ''}
            ${sc.status === 'outdated' ? '<span title="Cảnh cần cập nhật">⚠️</span>' : ''}
            <span class="visual-scene-time">${sFmt} &rarr; ${eFmt}</span>
          </button>
          <div class="visual-shots-tree" role="group" aria-label="Cảnh quay của Cảnh ${sc.index}">
            ${shots.map(shotId => {
              const isShotActive = shotId === visualSelectedShotId;
              const durText = sc.duration ? (sc.duration / (shots.length || 1)).toFixed(1) + 's' : '';
              return `
                <button type="button" class="visual-shot-tree-btn ${isShotActive ? 'is-active' : ''}" data-action="select-shot" data-shot-id="${escapeHtml(shotId)}" data-scene-id="${escapeHtml(sc.scene_id)}" aria-pressed="${isShotActive}">
                  <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-video"/></svg>
                  <span class="visual-shot-tree-id">${escapeHtml(shotId)}</span>
                  <span class="visual-shot-tree-dur">${durText}</span>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      `;
    });

    spRowsContainer.innerHTML = html;
  }

  async function selectVisualShot(shotId, sceneId) {
    // Gate L: Dirty-state navigation guard — warn before discarding unsaved prompts
    if ((visualDirtyPrompts.image || visualDirtyPrompts.veo) &&
        (shotId !== visualSelectedShotId || sceneId !== visualSelectedSceneId)) {
      const ok = confirm(
        'Bạn có thay đổi prompt chưa lưu (Chưa lưu).\nNếu tiếp tục, các thay đổi sẽ bị mất.\nBạn có chắc muốn chuyển sang cảnh quay khác không?'
      );
      if (!ok) return;
    }
    visualSelectedSceneId = sceneId;
    visualSelectedShotId = shotId;
    visualExpandedSceneIds.add(sceneId);

    // Update active highlight classes in DOM
    if (spRowsContainer) {
      spRowsContainer.querySelectorAll(".visual-scene-group").forEach(group => {
        const isMatch = group.dataset.sceneId === sceneId;
        group.classList.toggle("is-selected", isMatch);
        if (isMatch) group.classList.add("is-expanded");
      });
      spRowsContainer.querySelectorAll(".visual-shot-tree-btn").forEach(btn => {
        const isMatch = btn.dataset.shotId === shotId;
        btn.classList.toggle("is-active", isMatch);
        btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
      });
    }

    if (spSelectedDetail) {
      spSelectedDetail.innerHTML = `
        <div class="empty-detail-state">
          <span class="inline-spinner"></span>
          <span>Đang tải thông tin Cảnh ${escapeHtml(sceneId)} &rarr; Cảnh quay ${escapeHtml(shotId)}...</span>
        </div>
      `;
    }

    try {
      const [scRes, shRes, revRes] = await Promise.all([
        fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual/scenes/${encodeURIComponent(sceneId)}`),
        fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual/shots/${encodeURIComponent(shotId)}`),
        fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/history/shot/${encodeURIComponent(shotId)}`).catch(() => null)
      ]);

      if (!scRes.ok || !shRes.ok) {
        throw new Error(`Không thể tải chi tiết: Cảnh (${scRes.status}), Shot (${shRes.status})`);
      }

      visualCurrentScene = await scRes.json();
      visualCurrentShot = await shRes.json();
      const revisions = revRes && revRes.ok ? await revRes.json() : [];

      renderVisualShotWorkspace(visualCurrentShot, visualCurrentScene);
      renderVisualInspector(visualCurrentShot, visualCurrentScene, revisions);
    } catch (err) {
      console.error("Failed to load visual shot detail:", err);
      if (spSelectedDetail) {
        spSelectedDetail.innerHTML = `
          <div class="empty-detail-state" style="color: var(--color-error);">
            <svg class="ui-icon ui-icon-lg"><use href="#icon-alert"/></svg>
            <span>Lỗi tải chi tiết: ${escapeHtml(err.message)}</span>
          </div>
        `;
      }
    }
  }

  function renderVisualShotWorkspace(shot, scene) {
    if (!spSelectedDetail) return;
    const sFmt = formatTime(shot.start != null ? shot.start : scene.start);
    const eFmt = formatTime(shot.end != null ? shot.end : scene.end);
    const durSec = (shot.duration != null ? shot.duration : scene.duration || 0).toFixed(2);

    visualDirtyPrompts.image = false;
    visualDirtyPrompts.veo = false;

    spSelectedDetail.innerHTML = `
      <div class="visual-shot-identity-card">
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div class="visual-shot-breadcrumbs">
            <span>Cảnh ${scene.index} (${escapeHtml(scene.scene_id)})</span>
            <span style="color: var(--text-muted);">&rarr;</span>
            <span style="color: var(--accent-primary);">Cảnh quay ${shot.index} (${escapeHtml(shot.shot_id)})</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px;">
            <span class="visual-shot-timing-pill">${sFmt} &rarr; ${eFmt} (${durSec}s)</span>
            <span class="cat-badge">${escapeHtml(shot.category || scene.category || 'reconstruction')}</span>
            <span class="sp-evidence-pill">${escapeHtml(shot.shot_purpose || shot.shot_type || scene.shot_type || 'medium wide')}</span>
            <span class="sp-framing-pill">Router: ${escapeHtml(scene.visualType || 'ENVIRONMENT')}</span>
            ${shot.outdated ? '<span class="state-pill state-stale">⚠️ Cần cập nhật</span>' : '<span class="state-pill state-ready">✓ Sẵn sàng</span>'}
            ${shot.is_locked ? '<span class="state-pill state-locked">🔒 Đã khóa</span>' : '<span class="state-pill state-idle">🔓 Có thể sửa</span>'}
          </div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary btn-sm btn-seek-scene uq-playbtn" data-start="${shot.start != null ? shot.start : scene.start}" title="Phát âm thanh tại thời điểm này">
            <svg class="ui-icon" aria-hidden="true"><use href="#icon-play"/></svg>
            <span>Phát</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-regen-veo-shot" title="Tạo lại các cảnh quay cho Cảnh này">
            <svg class="ui-icon"><use href="#icon-refresh"/></svg>
            <span>Tạo lại</span>
          </button>
        </div>
      </div>

      <div class="visual-workspace-grid">
        <!-- Narration Card -->
        <div class="detail-prose-card" style="margin-bottom: 0;">
          <div class="detail-prose-label">Lời bình Narration</div>
          <div class="detail-prose-content narration-quote">&ldquo;${escapeHtml(shot.narration || scene.narration || 'Chưa có lời bình')}&rdquo;</div>
        </div>

        <!-- Card A: Bản thiết kế hình ảnh (Visual Blueprint) -->
        <div class="visual-blueprint-card">
          <div class="visual-card-header">
            <div class="visual-card-title">
              <svg class="ui-icon" style="color: var(--accent-primary);"><use href="#icon-scene"/></svg>
              <span>Bản thiết kế hình ảnh (Visual Blueprint)</span>
              <span class="cat-badge" style="font-size: 0.68rem;">Google Flow / Midjourney / SDXL</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-xs" id="btn-copy-image-prompt" title="Sao chép prompt hình ảnh">
                <svg class="ui-icon"><use href="#icon-copy"/></svg>
                <span>Sao chép prompt</span>
              </button>
              <button type="button" class="btn btn-primary btn-xs" id="btn-save-image-prompt" title="Lưu prompt hình ảnh">
                <span>Lưu prompt</span>
              </button>
            </div>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;">
            <strong>Bản thiết kế hình ảnh (kế hoạch ngữ nghĩa):</strong> ${escapeHtml(shot.visual_objective || scene.visual_summary || 'Chưa có tóm tắt thị giác')}
          </div>
          <div>
            <label class="form-label" for="vw-image-prompt-input" style="font-size: 0.76rem; font-weight: 600; margin-bottom: 4px;">Prompt hình ảnh (Start frame) — văn bản gửi nhà cung cấp, tách biệt khỏi Bản thiết kế</label>
            <textarea id="vw-image-prompt-input" class="form-textarea" rows="4" placeholder="Nhập prompt hình ảnh...">${escapeHtml((shot.image_prompt != null && String(shot.image_prompt).trim() !== '') ? shot.image_prompt : (scene.image_prompt || ''))}</textarea>
          </div>
          <div>
            <label class="form-label" for="vw-negative-prompt-input" style="font-size: 0.76rem; font-weight: 600; margin-bottom: 4px;">Prompt phủ định (Negative prompt)</label>
            <textarea id="vw-negative-prompt-input" class="form-textarea" rows="2" placeholder="Nhập prompt loại trừ...">${escapeHtml(shot.negative_prompt || scene.negative_prompt || '')}</textarea>
          </div>
        </div>

        <!-- Card B: Bản thiết kế chuyển động (Motion Blueprint) -->
        <div class="motion-blueprint-card">
          <div class="visual-card-header">
            <div class="visual-card-title">
              <svg class="ui-icon" style="color: #10b981;"><use href="#icon-video"/></svg>
              <span>Bản thiết kế chuyển động (Motion Blueprint)</span>
              <span class="cat-badge" style="font-size: 0.68rem; background: rgba(16, 185, 129, 0.15); color: #10b981;">Google Veo / Flow Motion</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-xs" id="btn-copy-motion-prompt" title="Sao chép prompt chuyển động">
                <svg class="ui-icon"><use href="#icon-copy"/></svg>
                <span>Sao chép prompt</span>
              </button>
              <button type="button" class="btn btn-primary btn-xs" id="btn-save-motion-prompt" title="Lưu prompt chuyển động">
                <span>Lưu prompt</span>
              </button>
            </div>
          </div>
          <div class="visual-param-grid">
            <div class="visual-param-item">
              <span class="visual-param-label">Hành động chủ thể</span>
              <span class="visual-param-val">${escapeHtml(shot.subject_action || 'Không có')}</span>
            </div>
            <div class="visual-param-item">
              <span class="visual-param-label">Chuyển động bối cảnh</span>
              <span class="visual-param-val">${escapeHtml(shot.environmental_action || shot.environment_motion || 'Tự nhiên')}</span>
            </div>
            <div class="visual-param-item">
              <span class="visual-param-label">Chuyển động máy quay</span>
              <span class="visual-param-val">${escapeHtml(shot.camera_motion || 'static cinematic camera')}</span>
            </div>
            <div class="visual-param-item">
              <span class="visual-param-label">Ánh sáng &amp; Khí quyển</span>
              <span class="visual-param-val">${escapeHtml(shot.lighting_atmosphere || shot.lighting || 'Tự nhiên')}</span>
            </div>
            <div class="visual-param-item" style="grid-column: 1 / -1;">
              <span class="visual-param-label">Điểm neo liên tục (Continuity Anchor)</span>
              <span class="visual-param-val">${escapeHtml(shot.continuity_anchor || 'Không có')}</span>
            </div>
          </div>
            <div>
              <label class="form-label" for="vw-veo-prompt-input" style="font-size: 0.76rem; font-weight: 600; margin-bottom: 4px;">Prompt chuyển động Veo (Motion Prompt) — văn bản gửi nhà cung cấp, tách biệt khỏi Bản thiết kế chuyển động ở trên</label>
            <textarea id="vw-veo-prompt-input" class="form-textarea" rows="4" placeholder="Nhập prompt chuyển động...">${escapeHtml(shot.veo_prompt || '')}</textarea>
          </div>
        </div>

        <!-- Card C: Quy trình phối hợp Google Flow / Veo (Handoff Checklist) -->
        <div class="handoff-checklist-card">
          <div class="visual-card-header">
            <div class="visual-card-title">
              <svg class="ui-icon"><use href="#icon-script"/></svg>
              <span>Quy trình tạo hình ngoài (Manual Generation Handoff)</span>
            </div>
            <button type="button" class="btn btn-secondary btn-xs" id="btn-copy-flow-package" title="Sao chép gói tham chiếu cho Flow">
              <svg class="ui-icon"><use href="#icon-copy"/></svg>
              <span>Sao chép gói tham chiếu</span>
            </button>
          </div>
          <ol style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; padding-left: 1.2rem; margin: 0;">
            <li>Sao chép <strong>Prompt hình ảnh</strong> và đưa vào <strong>Google Flow</strong> kèm các thành phần tham chiếu (ingredients) đã liệt kê ở Inspector.</li>
            <li>Xem lại kết quả ảnh tạo ra, tải ảnh start-frame đạt tiêu chuẩn về máy và duyệt.</li>
            <li>Sao chép <strong>Prompt chuyển động Veo</strong>, đưa ảnh start-frame vào Veo để tạo hoạt cảnh video.</li>
          </ol>
        </div>
      </div>
    `;

    // Wire up events in Shot Workspace
    const imgPromptInput = document.getElementById("vw-image-prompt-input");
    const negPromptInput = document.getElementById("vw-negative-prompt-input");
    const veoPromptInput = document.getElementById("vw-veo-prompt-input");

    if (imgPromptInput) {
      imgPromptInput.addEventListener("input", () => {
        visualDirtyPrompts.image = true;
        imgPromptInput.classList.add("is-dirty");
      });
    }
    if (negPromptInput) {
      negPromptInput.addEventListener("input", () => {
        visualDirtyPrompts.image = true;
        negPromptInput.classList.add("is-dirty");
      });
    }
    if (veoPromptInput) {
      veoPromptInput.addEventListener("input", () => {
        visualDirtyPrompts.veo = true;
        veoPromptInput.classList.add("is-dirty");
      });
    }

    // Play seek button
    const playBtn = spSelectedDetail.querySelector(".btn-seek-scene");
    if (playBtn) {
      playBtn.addEventListener("click", () => {
        const startSec = parseFloat(playBtn.dataset.start || "0");
        if (audioPlayer && audioPlayer.duration) {
          audioPlayer.currentTime = startSec;
          audioPlayer.play().catch(() => {});
        }
      });
    }

    // Regenerate Veo shots for this scene
    const regenBtn = document.getElementById("btn-regen-veo-shot");
    if (regenBtn) {
      regenBtn.addEventListener("click", async () => {
        if (!confirm(`Tạo lại toàn bộ các cảnh quay cho Cảnh ${scene.index} (${scene.scene_id})?`)) return;
        regenBtn.disabled = true;
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/veo/regenerate-scene/${encodeURIComponent(scene.scene_id)}`, {
            method: "POST"
          });
          if (!res.ok) throw new Error(`Lỗi ${res.status}`);
          showNotification(`Đã tạo lại cảnh quay cho Cảnh ${scene.index} thành công!`, "success");
          loadVisualWorkbench(currentProjectDir);
        } catch (err) {
          showNotification(`Lỗi tạo lại cảnh quay: ${err.message}`, "error");
        } finally {
          regenBtn.disabled = false;
        }
      });
    }

    // Copy Image Prompt button — Gate B: shot-level first, scene fallback
    const btnCopyImagePrompt = document.getElementById("btn-copy-image-prompt");
    if (btnCopyImagePrompt) {
      btnCopyImagePrompt.addEventListener("click", () => {
        const text = imgPromptInput ? imgPromptInput.value : ((shot.image_prompt != null && String(shot.image_prompt).trim() !== '') ? shot.image_prompt : (scene.image_prompt || ""));
        copyToClipboard(text, "Prompt hình ảnh");
      });
    }

    // Save Image Prompt button — Gate B: writes to shot-level PATCH, NOT scene PUT
    const btnSaveImagePrompt = document.getElementById("btn-save-image-prompt");
    if (btnSaveImagePrompt) {
      btnSaveImagePrompt.addEventListener("click", async () => {
        // Gate H: locked shots need explicit confirmation — do not silently overwrite.
        if (shot.is_locked && !confirm(`Cảnh quay ${shot.shot_id} đang bị khóa (Đã khóa).\nBạn có chắc muốn ghi đè prompt đã khóa không?`)) return;
        btnSaveImagePrompt.disabled = true;
        try {
          // Gate B: PATCH /visual/shots/{shot_id} writes only to this shot, sibling shots unaffected
          const payload = {
            image_prompt: imgPromptInput ? imgPromptInput.value : (shot.image_prompt || scene.image_prompt),
            negative_prompt: negPromptInput ? negPromptInput.value : (shot.negative_prompt || scene.negative_prompt)
          };
          if (shot.is_locked) payload.override_lock = true;
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual/shots/${encodeURIComponent(shot.shot_id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.status === 409) throw new Error("Cảnh quay đang bị khóa — hãy mở khóa trước khi lưu");
          if (!res.ok) throw new Error(`Lỗi ${res.status}`);
          // Update local shot cache to reflect saved value
          if (visualCurrentShot) {
            visualCurrentShot.image_prompt = payload.image_prompt;
            visualCurrentShot.negative_prompt = payload.negative_prompt;
          }
          showNotification("Đã lưu prompt hình ảnh thành công!", "success");
          visualDirtyPrompts.image = false;
          if (imgPromptInput) imgPromptInput.classList.remove("is-dirty");
          if (negPromptInput) negPromptInput.classList.remove("is-dirty");
        } catch (err) {
          showNotification(`Lỗi lưu prompt hình ảnh: ${err.message}`, "error");
        } finally {
          btnSaveImagePrompt.disabled = false;
        }
      });
    }

    // Copy Motion Prompt button
    const btnCopyMotionPrompt = document.getElementById("btn-copy-motion-prompt");
    if (btnCopyMotionPrompt) {
      btnCopyMotionPrompt.addEventListener("click", () => {
        const text = veoPromptInput ? veoPromptInput.value : (shot.veo_prompt || "");
        copyToClipboard(text, "Prompt chuyển động");
      });
    }

    // Save Motion Prompt button — Gate D: shot-level PATCH (provider prompt, not Blueprint)
    const btnSaveMotionPrompt = document.getElementById("btn-save-motion-prompt");
    if (btnSaveMotionPrompt) {
      btnSaveMotionPrompt.addEventListener("click", async () => {
        if (shot.is_locked && !confirm(`Cảnh quay ${shot.shot_id} đang bị khóa (Đã khóa).\nBạn có chắc muốn ghi đè prompt chuyển động đã khóa không?`)) return;
        btnSaveMotionPrompt.disabled = true;
        try {
          const payload = {
            veo_prompt: veoPromptInput ? veoPromptInput.value : shot.veo_prompt
          };
          if (shot.is_locked) payload.override_lock = true;
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/visual/shots/${encodeURIComponent(shot.shot_id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.status === 409) throw new Error("Cảnh quay đang bị khóa — hãy mở khóa trước khi lưu");
          if (!res.ok) throw new Error(`Lỗi ${res.status}`);
          if (visualCurrentShot) visualCurrentShot.veo_prompt = payload.veo_prompt;
          showNotification("Đã lưu prompt chuyển động thành công!", "success");
          visualDirtyPrompts.veo = false;
          if (veoPromptInput) veoPromptInput.classList.remove("is-dirty");
        } catch (err) {
          showNotification(`Lỗi lưu prompt chuyển động: ${err.message}`, "error");
        } finally {
          btnSaveMotionPrompt.disabled = false;
        }
      });
    }

    // Copy Flow package — Gate G: surfaces actual bound references (stable entity IDs),
    // approved/start-frame context and motion plan. Manual only — never uploads.
    const btnCopyFlowPackage = document.getElementById("btn-copy-flow-package");
    if (btnCopyFlowPackage) {
      btnCopyFlowPackage.addEventListener("click", () => {
        const imgP = imgPromptInput ? imgPromptInput.value : ((shot.image_prompt != null && String(shot.image_prompt).trim() !== '') ? shot.image_prompt : (scene.image_prompt || ''));
        const negP = negPromptInput ? negPromptInput.value : (shot.negative_prompt || scene.negative_prompt || '');
        const subjList = (shot.subjectIds || shot.subject_ids || []).join(", ") || "Không có";
        const envStr = shot.environmentId || shot.environment_id || "Không có";
        const propList = (shot.propIds || shot.prop_ids || []).join(", ") || "Không có";

        const text = [
          `# UNFOLDIQ FLOW HANDOFF — SHOT: ${shot.shot_id} (SCENE: ${scene.scene_id})`,
          `## Image Prompt (provider text — tách biệt Bản thiết kế hình ảnh):`,
          imgP,
          `## Negative Prompt:`,
          negP,
          `## Required Reference Ingredients (stable entity IDs):`,
          `- Characters: ${subjList}`,
          `- Environment: ${envStr}`,
          `- Props: ${propList}`,
          `## Motion Blueprint (for Veo step):`,
          `- Camera: ${shot.camera_motion || 'static cinematic camera'}`,
          `- Subject: ${shot.subject_action || 'Không có'}`,
          `- Environment: ${shot.environmental_action || shot.environment_motion || 'Tự nhiên'}`,
          `- Veo Prompt: ${veoPromptInput ? veoPromptInput.value : (shot.veo_prompt || '')}`,
          `## Shot State: ${shot.is_locked ? 'Đã khóa' : 'Có thể sửa'} / ${shot.outdated ? 'Cần cập nhật (OUTDATED)' : 'Sẵn sàng'} / ${shot.status || 'generated'}`,
          `## Target Aspect Ratio: 16:9`,
          `## Manual only — copy by hand into Google Flow/Veo. Nothing is uploaded automatically.`
        ].join("\n\n");

        copyToClipboard(text, "Gói tham chiếu Flow");
      });
    }
  }

  function renderVisualInspector(shot, scene, revisions) {
    // 1. Visual Bible Bindings
    if (vwBindingsContainer) {
      const vb = (visualBibleSliceData && visualBibleSliceData.visual_bible) || {};
      const allSubjects = vb.subjects || vb.characters || [];
      const allEnvs = vb.environments || [];
      const allProps = vb.props || vb.objects || [];

      const boundSubjIds = shot.subjectIds || shot.subject_ids || [];
      const boundEnvId = shot.environmentId || shot.environment_id;
      const boundPropIds = shot.propIds || shot.prop_ids || [];

      let bindingCardsHtml = "";
      let boundCount = 0;

      boundSubjIds.forEach(id => {
        // Gate K: match by characterId, subjectId, or entity_id (stable ID) — not display name
        const found = allSubjects.find(s =>
          s.characterId === id || s.subjectId === id || s.entity_id === id || s.id === id
        );
        boundCount++;
        bindingCardsHtml += `
          <div class="vw-binding-item">
            <div class="vw-binding-top">
              <span class="vw-binding-name">${escapeHtml(found ? found.name : id)}</span>
              <span class="vw-binding-type">Nhân vật</span>
            </div>
            <div class="vw-binding-anchors">
              ${found && found.species ? `<span>Loài: ${escapeHtml(found.species)}</span><br>` : ''}
              ${found && found.visualAnchors && found.visualAnchors.length ? `<span>Điểm neo: ${escapeHtml(found.visualAnchors[0])}</span>` : `<span>ID: ${escapeHtml(id)}</span>`}
            </div>
          </div>
        `;
      });

      if (boundEnvId) {
        // Gate K: match by stable entity ID, not display name
        const found = allEnvs.find(e =>
          e.environmentId === boundEnvId || e.entity_id === boundEnvId || e.id === boundEnvId
        );
        boundCount++;
        bindingCardsHtml += `
          <div class="vw-binding-item">
            <div class="vw-binding-top">
              <span class="vw-binding-name">${escapeHtml(found ? found.name : boundEnvId)}</span>
              <span class="vw-binding-type">Bối cảnh</span>
            </div>
            <div class="vw-binding-anchors">
              ${found && found.atmosphere ? `<span>Khí quyển: ${escapeHtml(found.atmosphere)}</span>` : `<span>ID: ${escapeHtml(boundEnvId)}</span>`}
            </div>
          </div>
        `;
      }

      boundPropIds.forEach(id => {
        // Gate F: match by stable entity ID only — propId/objectId/id, never display name.
        const found = allProps.find(p => p.propId === id || p.objectId === id || p.id === id);
        boundCount++;
        bindingCardsHtml += `
          <div class="vw-binding-item">
            <div class="vw-binding-top">
              <span class="vw-binding-name">${escapeHtml(found ? found.name : id)}</span>
              <span class="vw-binding-type">Vật thể</span>
            </div>
            <div class="vw-binding-anchors">
              <span>ID: ${escapeHtml(id)}</span>
            </div>
          </div>
        `;
      });

      if (vwBindingsCountBadge) {
        vwBindingsCountBadge.textContent = `${boundCount} liên kết`;
      }
      vwBindingsContainer.innerHTML = boundCount > 0 ? bindingCardsHtml : `<p class="empty-state" style="padding: 8px 0; font-size: 0.8rem;">Cảnh quay này chưa có thực thể Visual Bible nào được liên kết.</p>`;
    }

    // 2. Lock & Protection Card
    if (vwLockStatusBadge) {
      vwLockStatusBadge.className = shot.is_locked ? "state-pill state-locked" : "state-pill state-idle";
      vwLockStatusBadge.textContent = shot.is_locked ? "Đã khóa" : "Mở khóa";
    }
    if (btnLockShotText) {
      btnLockShotText.textContent = shot.is_locked ? "Mở khóa cảnh quay" : "Khóa cảnh quay";
    }
    if (btnLockShot) {
      btnLockShot.disabled = false;
      btnLockShot.onclick = async () => {
        const newLockState = !shot.is_locked;
        btnLockShot.disabled = true;
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/lock/shot/${encodeURIComponent(shot.shot_id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              locked: newLockState,
              reason: "Thao tác người dùng tại Visual Workbench"
            })
          });
          if (!res.ok) throw new Error(`Lỗi ${res.status}`);
          showNotification(`Đã ${newLockState ? 'khóa' : 'mở khóa'} cảnh quay ${shot.shot_id} thành công!`, "success");
          shot.is_locked = newLockState;
          renderVisualShotWorkspace(shot, scene);
          renderVisualInspector(shot, scene, revisions);
        } catch (err) {
          showNotification(`Lỗi khóa cảnh quay: ${err.message}`, "error");
        } finally {
          btnLockShot.disabled = false;
        }
      };
    }

    // 3. Revision History Card
    if (vwRevisionsContainer && vwRevisionsCountBadge) {
      const revList = Array.isArray(revisions) ? revisions : [];
      vwRevisionsCountBadge.textContent = `${revList.length}`;
      if (revList.length === 0) {
        vwRevisionsContainer.innerHTML = `<p class="empty-state" style="padding: 8px 0; font-size: 0.8rem;">Chưa có bản sửa đổi nào.</p>`;
      } else {
        vwRevisionsContainer.innerHTML = revList.map(r => `
          <div class="vw-revision-item">
            <div class="vw-revision-info">
              <span style="font-weight: 600;">${escapeHtml(r.reason || 'Sửa đổi prompt')}</span>
              <span class="vw-revision-time">${escapeHtml(r.created_at ? r.created_at.slice(0, 19).replace('T', ' ') : '')}</span>
            </div>
            <button type="button" class="btn btn-secondary btn-xs btn-restore-shot-rev" data-rev-id="${escapeHtml(r.revision_id || r.id)}" title="Khôi phục phiên bản này">
              Khôi phục
            </button>
          </div>
        `).join("");

        vwRevisionsContainer.querySelectorAll(".btn-restore-shot-rev").forEach(btn => {
          btn.addEventListener("click", async () => {
            const revId = btn.dataset.revId;
            if (!confirm(`Khôi phục cảnh quay về phiên bản ${revId}?`)) return;
            try {
              const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectDir)}/history/${encodeURIComponent(revId)}/restore`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ override_lock: true })
              });
              if (!res.ok) throw new Error(`Lỗi ${res.status}`);
              showNotification(`Đã khôi phục phiên bản ${revId} thành công!`, "success");
              selectVisualShot(shot.shot_id, scene.scene_id);
            } catch (err) {
              showNotification(`Lỗi khôi phục phiên bản: ${err.message}`, "error");
            }
          });
        });
      }
    }
  }

  function copyToClipboard(text, label) {
    if (!text) {
      showNotification(`Không có nội dung để sao chép cho ${label}`, "warning");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showNotification(`Đã sao chép ${label} vào bộ nhớ tạm!`, "success"))
        .catch(() => copyFallback(text, label));
    } else {
      copyFallback(text, label);
    }
  }

  function copyFallback(text, label) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      showNotification(`Đã sao chép ${label} vào bộ nhớ tạm!`, "success");
    } catch (e) {
      showNotification(`Không thể sao chép ${label}`, "error");
    }
    document.body.removeChild(ta);
  }

  // Hook up filter and search inputs for Scene Navigator
  if (spSearchInput) {
    let searchDebounceTimer = null;
    spSearchInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(renderVisualSceneNavigator, 150);
    });
  }
  if (spFilterCategory) {
    spFilterCategory.addEventListener("change", renderVisualSceneNavigator);
  }
  if (spFilterStatus) {
    spFilterStatus.addEventListener("change", renderVisualSceneNavigator);
  }

  // Event delegation on spRowsContainer for clicks & keydowns
  if (spRowsContainer) {
    spRowsContainer.addEventListener("click", (e) => {
      // 1. Toggle expander button
      const expander = e.target.closest("[data-action='toggle-expand']");
      if (expander) {
        e.stopPropagation();
        const scId = expander.dataset.sceneId;
        if (visualExpandedSceneIds.has(scId)) {
          visualExpandedSceneIds.delete(scId);
        } else {
          visualExpandedSceneIds.add(scId);
        }
        renderVisualSceneNavigator();
        return;
      }

      // 2. Select shot item
      const shotBtn = e.target.closest("[data-action='select-shot']");
      if (shotBtn) {
        e.stopPropagation();
        const shotId = shotBtn.dataset.shotId;
        const sceneId = shotBtn.dataset.sceneId;
        if (shotId && sceneId) {
          selectVisualShot(shotId, sceneId);
        }
        return;
      }

      // 3. Select scene header
      const sceneBtn = e.target.closest("[data-action='select-scene']");
      if (sceneBtn) {
        const sceneId = sceneBtn.dataset.sceneId;
        const sc = visualScenesList.find(s => s.scene_id === sceneId);
        if (sc) {
          const firstShotId = (sc.shot_ids && sc.shot_ids[0]) || `${sceneId}_sh1`;
          selectVisualShot(firstShotId, sceneId);
        }
        return;
      }
    });

    // Keyboard navigation — Gate K: Scene Navigator uses disclosure buttons
    // (aria-expanded / aria-pressed), NOT role=tree. Support full keyboard:
    // ArrowUp/Down move, ArrowRight expands, ArrowLeft collapses,
    // Home/End jump, Enter/Space activates natively via button semantics.
    spRowsContainer.addEventListener("keydown", (e) => {
      const focusables = Array.from(spRowsContainer.querySelectorAll("button"));
      const currentIndex = focusables.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (currentIndex === -1) {
          if (focusables.length > 0) focusables[0].focus();
        } else {
          const nextIndex = e.key === "ArrowDown"
            ? Math.min(currentIndex + 1, focusables.length - 1)
            : Math.max(currentIndex - 1, 0);
          focusables[nextIndex].focus();
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        if (focusables.length > 0) focusables[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        if (focusables.length > 0) focusables[focusables.length - 1].focus();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const active = document.activeElement;
        const group = active ? active.closest(".visual-scene-group") : null;
        const scId = group ? group.dataset.sceneId : (active ? active.dataset.sceneId : null);
        if (!scId) return;
        e.preventDefault();
        const isExpanded = visualExpandedSceneIds.has(scId) || scId === visualSelectedSceneId;
        if (e.key === "ArrowRight" && !isExpanded) {
          visualExpandedSceneIds.add(scId);
          renderVisualSceneNavigator();
          const btn = spRowsContainer.querySelector(`[data-shot-id][data-scene-id="${CSS.escape(scId)}"]`);
          if (btn) btn.focus();
        } else if (e.key === "ArrowLeft" && isExpanded) {
          visualExpandedSceneIds.delete(scId);
          renderVisualSceneNavigator();
          const hdr = spRowsContainer.querySelector(`[data-action="select-scene"][data-scene-id="${CSS.escape(scId)}"]`);
          if (hdr) hdr.focus();
        }
      }
    });
  }

  // Export functions globally for browser testing and automation
  window.loadVisualWorkbench = loadVisualWorkbench;
  window.selectVisualShot = selectVisualShot;
  window.renderVisualSceneNavigator = renderVisualSceneNavigator;


  // ==============================================================================
  // 14. INITIALIZATION
  // ==============================================================================
  checkHealth();
  loadVoicesAndSettings();
  loadPronunciations();
  resolveStartupProject();
  updateTextStats();
  updateSlugPreview();
  updateDependencyState();
  loadEmbeddedStorageOverview();
  setInterval(checkHealth, 15000);

  // Onboarding first-run do UQGuide (guide.js) đảm nhiệm: welcome + migration
  // tour cũ, Help Center. Không auto-run tour cũ tại đây nữa.
});

