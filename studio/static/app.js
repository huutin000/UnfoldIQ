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
        if (btnToggleInspector) btnToggleInspector.classList.remove("active");
      }
    }
  });

  // ==============================================================================
  // 3. WORKSPACE ROUTING & NAVIGATION
  // ==============================================================================
  const WORKSPACE_INSPECTOR_MAP = {
    script: "inspector-script",
    audio: "inspector-audio",
    timestamp: "inspector-timestamp",
    scenes: "inspector-scenes",
    veo: "inspector-veo",
    projects: "inspector-default",
    pronunciation: "inspector-default",
    settings: "inspector-default"
  };

  function switchWorkspace(targetId) {
    if (!targetId) return;
    const previousWorkspaceId = activeWorkspaceId;
    activeWorkspaceId = targetId;

    // 1. Active-Only DOM Management: Unmount heavy rows from leaving workspace
    if (previousWorkspaceId === "scenes" && targetId !== "scenes") {
      if (spRowsContainer) {
        spScrollTop = spRowsContainer.scrollTop;
        spRowsContainer.innerHTML = `<div class="unmounted-placeholder" style="padding: 24px; text-align: center; color: var(--text-muted); font-size: var(--font-size-xs);">Workspace tạm dừng hiển thị (giải phóng DOM)</div>`;
      }
    } else if (previousWorkspaceId === "veo" && targetId !== "veo") {
      if (veoRowsContainer) {
        veoScrollTop = veoRowsContainer.scrollTop;
        veoRowsContainer.innerHTML = `<div class="unmounted-placeholder" style="padding: 24px; text-align: center; color: var(--text-muted); font-size: var(--font-size-xs);">Workspace tạm dừng hiển thị (giải phóng DOM)</div>`;
      }
    }

    // 2. Update Sidebar Active Item
    document.querySelectorAll(".pipeline-nav .nav-item").forEach(btn => {
      if (btn.dataset.workspace === targetId) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 3. Update Main Workspace View
    document.querySelectorAll(".workspace-view").forEach(view => {
      view.classList.remove("active");
    });
    const targetView = document.getElementById(`ws-${targetId}`);
    if (targetView) {
      targetView.classList.add("active");
    }

    // 4. Mount heavy rows on entering active scenes or veo workspace
    if (targetId === "scenes" && projectScenes.length > 0) {
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

    // Close mobile drawers on switch
    if (window.innerWidth <= 1024 && pipelineSidebar) {
      pipelineSidebar.classList.remove("open");
    }
  }
  window.switchWorkspace = switchWorkspace;

  // Attach Navigation Listeners
  document.querySelectorAll(".pipeline-nav .nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      switchWorkspace(btn.dataset.workspace);
    });
  });

  if (btnOpenSettings) {
    btnOpenSettings.addEventListener("click", () => {
      switchWorkspace("script");
      const adv = document.querySelector(".advanced-settings-collapse");
      if (adv) adv.open = true;
    });
  }

  // Toggle Sidebar / Inspector on small screens
  if (btnToggleSidebar && pipelineSidebar) {
    btnToggleSidebar.addEventListener("click", () => {
      pipelineSidebar.classList.toggle("open");
    });
  }

  if (btnToggleInspector && workspaceInspector) {
    btnToggleInspector.addEventListener("click", () => {
      workspaceInspector.classList.toggle("open");
      btnToggleInspector.classList.toggle("active");
    });
  }

  // ==============================================================================
  // 4. PERSISTENT BOTTOM AUDIO TRANSPORT
  // ==============================================================================
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds == null || seconds < 0) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
  }

  if (btnGlobalPlay && audioPlayer) {
    btnGlobalPlay.addEventListener("click", () => {
      if (!audioPlayer.src) return;
      if (audioPlayer.paused) {
        audioPlayer.play().catch(() => {});
      } else {
        audioPlayer.pause();
      }
    });
  }

  if (audioPlayer) {
    audioPlayer.addEventListener("play", updateAudioTransportState);
    audioPlayer.addEventListener("pause", updateAudioTransportState);
    audioPlayer.addEventListener("ended", updateAudioTransportState);

    audioPlayer.addEventListener("timeupdate", () => {
      if (isSeeking) return;
      const cur = audioPlayer.currentTime || 0;
      const dur = audioPlayer.duration || 0;
      if (playerCurrentTime) playerCurrentTime.textContent = formatTime(cur);
      if (dur > 0 && playerScrubber) {
        playerScrubber.value = (cur / dur) * 100;
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

  // Keyboard Play/Pause Shortcut (Space)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
      e.preventDefault();
      if (audioPlayer.src) {
        if (audioPlayer.paused) audioPlayer.play().catch(() => {});
        else audioPlayer.pause();
      }
    }
  });

  // Global Seek & Audition Utility
  window.seekGlobalAudio = function(startTime, contextLabel) {
    if (!audioPlayer || !audioPlayer.src) return;
    audioPlayer.currentTime = startTime;
    audioPlayer.play().catch(() => {});
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
      estDurationEl.textContent = `~${totalSecs}s dự kiến`;
    } else {
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      estDurationEl.textContent = `~${mins}ph ${secs}s dự kiến`;
    }
  }

  scriptInput.addEventListener("input", () => {
    if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
    statsDebounceTimer = setTimeout(updateTextStats, 150);
  });

  function updateSlugPreview() {
    const raw = projectNameInput.value.trim() || "unfoldiq_project";
    const slug = raw.toLowerCase().replace(/[^a-z0-9_\-]/g, "_").replace(/_+/g, "_");
    slugPreviewEl.textContent = slug;
    if (activeProjectNameEl) activeProjectNameEl.textContent = slug;
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
        voicesData.voices.forEach(v => {
          const opt = document.createElement("option");
          opt.value = v.id;
          opt.textContent = `${v.id} (${v.language}, Grade ${v.grade}) ${v.is_default ? "[Default]" : ""}`;
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
      }
    } catch (err) {
      console.error("Failed to load voices or settings:", err);
    }
  }

  async function saveUserSettings() {
    const formats = ["wav"];
    if (chkMp3.checked) formats.push("mp3");
    const renderModeEl = document.querySelector('input[name="render-mode"]:checked');
    const payload = {
      selected_voice: voiceSelect.value,
      selected_language: languageSelect.value,
      speed: parseFloat(speedSlider.value),
      output_formats: formats,
      render_mode: renderModeEl ? renderModeEl.value : "balanced"
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

  btnGenerate.addEventListener("click", async () => {
    const text = scriptInput.value.trim();
    if (!text) {
      alert("Vui lòng nhập kịch bản trước khi tạo giọng đọc.");
      return;
    }

    const formats = ["wav"];
    if (chkMp3.checked) formats.push("mp3");
    const renderModeEl = document.querySelector('input[name="render-mode"]:checked');
    const payload = {
      text: text,
      project_name: projectNameInput.value.trim() || undefined,
      voice: voiceSelect.value,
      language: languageSelect.value,
      speed: parseFloat(speedSlider.value),
      output_formats: formats,
      render_mode: renderModeEl ? renderModeEl.value : "balanced"
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
    }
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
      if (activeProjectNameEl) activeProjectNameEl.textContent = currentProjectDir;
      finalDurationText.textContent = `${job.final_duration_seconds} giây`;
      if (playerContextLabel) playerContextLabel.textContent = `${currentProjectDir} • Sẵn sàng`;

      audioPlayer.src = `${job.audio_url}?t=${Date.now()}`;
      audioPlayer.play().catch(() => {});

      loadProjects();
      loadTimestampsForProject(currentProjectDir);
      loadScenesForProject(currentProjectDir);
      loadVeoForProject(currentProjectDir);
    } else if (job.state === "cancelled" || job.state === "failed") {
      if (activeEventSource) activeEventSource.close();
      btnGenerate.disabled = false;
      btnStop.disabled = true;
      loadProjects();
    }
  }

  btnStop.addEventListener("click", async () => {
    if (!currentJobId) return;
    setJobState("cancelling");
    btnStop.disabled = true;

    try {
      await fetch(`/api/jobs/${currentJobId}/cancel`, { method: "POST" });
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
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
      alert(`Xuất file thất bại: ${err.message}`);
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
      pronAudioPlayer.src = URL.createObjectURL(blob);
      pronAudioPlayer.play().catch(() => {});
    } catch (err) {
      alert(`Lỗi nghe thử: ${err.message}`);
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

  window.deletePronEntry = async function(entryId) {
    if (!confirm("Xóa cách đọc này?")) return;
    try {
      await fetch(`/api/pronunciations/${entryId}`, { method: "DELETE" });
      loadPronunciations();
    } catch (e) {
      alert(`Xóa thất bại: ${e.message}`);
    }
  };

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
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;
    if (tsPollInterval) {
      clearInterval(tsPollInterval);
      tsPollInterval = null;
    }

    try {
      const res = await fetch(`/api/projects/${dirName}/timestamps/status`);
      if (!res.ok) return;
      const status = await res.json();

      if (status.model) tsModelBadge.textContent = status.model;
      if (status.device) tsDeviceBadge.textContent = status.device.toUpperCase();

      if (status.status === "Ready") {
        setTsStatus("ready", "Sẵn sàng");
        btnGenerateTs.disabled = false;
        btnCancelTs.style.display = "none";
        btnDownloadSrt.disabled = false;
        btnDownloadTsJson.disabled = false;
        tsProgressContainer.style.display = "none";

        if (status.coverage != null) tsCoverageBadge.textContent = `${status.coverage.toFixed(1)}%`;
        if (status.total_sentences != null) tsCuesBadge.textContent = `${status.total_sentences}`;
        loadCuesList(dirName);
      } else if (status.status === "Processing") {
        setTsStatus("processing", "Đang xử lý");
        btnGenerateTs.disabled = true;
        btnCancelTs.style.display = "inline-flex";
        btnDownloadSrt.disabled = true;
        btnDownloadTsJson.disabled = true;
        tsProgressContainer.style.display = "flex";
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
    tsPollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${dirName}/timestamps/status`);
        if (!res.ok) return;
        const s = await res.json();
        if (s.progress != null) {
          tsProgressFill.style.width = `${s.progress}%`;
          tsProgressPct.textContent = `${s.progress}%`;
        }
        if (s.message) tsProgressMsg.textContent = s.message;
        if (s.elapsed_seconds != null) tsProgressElapsed.textContent = `Đã chạy: ${s.elapsed_seconds}s`;

        if (s.status === "Ready" || s.status === "Failed" || s.status === "Cancelled") {
          clearInterval(tsPollInterval);
          tsPollInterval = null;
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
      const res = await fetch(`/api/projects/${dirName}/timestamps.json`);
      if (!res.ok) return;
      const data = await res.json();
      const sentences = data.sentences || [];
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
          <button class="cue-play-btn" data-start="${cue.start}">▶</button>
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

  btnGenerateTs.addEventListener("click", async () => {
    if (!currentProjectDir) return;
    btnGenerateTs.disabled = true;
    tsErrorAlert.style.display = "none";
    try {
      const res = await fetch(`/api/projects/${currentProjectDir}/timestamps/generate`, {
        method: "POST"
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể khởi động aligner.");
      }
      loadTimestampsForProject(currentProjectDir);
    } catch (err) {
      tsErrorAlert.style.display = "flex";
      tsErrorText.textContent = err.message;
      btnGenerateTs.disabled = false;
    }
  });

  btnCancelTs.addEventListener("click", async () => {
    if (!currentProjectDir) return;
    try {
      await fetch(`/api/projects/${currentProjectDir}/timestamps/cancel`, { method: "POST" });
    } catch (err) {
      console.error("Failed to cancel timestamping:", err);
    }
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
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;

    try {
      const res = await fetch(`/api/projects/${dirName}/scenes`);
      if (!res.ok) {
        setSpStatus("idle", "Chưa sẵn sàng");
        btnGenerateScenes.disabled = true;
        btnRefreshScenes.disabled = true;
        btnExportScenesJson.disabled = true;
        btnExportScenesMd.disabled = true;
        return;
      }

      const data = await res.json();
      projectScenes = data.scenes || [];
      const status = data.status || "Not Generated";
      const sceneCount = data.scene_count || projectScenes.length;
      const coverage = data.coverage != null ? data.coverage : (sceneCount > 0 ? 100.0 : 0.0);
      const duration = data.audio_duration || 0.0;

      if (spCountBadge) spCountBadge.textContent = `${sceneCount} scene`;
      if (spCoverageBadge) spCoverageBadge.textContent = (status === "Not Generated" || sceneCount === 0) ? "Coverage 0%" : `Coverage ${coverage.toFixed(0)}%`;
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
      spSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chưa có dữ liệu scene</p></div>`;
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
      spRowsContainer.innerHTML = `<p class="empty-state">Không tìm thấy scene phù hợp với bộ lọc.</p>`;
      spSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Không có scene nào được chọn</p></div>`;
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
      row.setAttribute("aria-label", `Scene ${sc.index}, ${sc.category || 'reconstruction'}`);

      const sFmt = formatTime(sc.start);
      const eFmt = formatTime(sc.end);
      const preview = sc.visual_summary || sc.narration || sc.image_prompt || "";

      row.innerHTML = `
        <div class="row-meta">
          <span class="sp-scene-num row-id">Scene ${sc.index}</span>
          <span class="sp-scene-time row-time">${sFmt} &rarr; ${eFmt}</span>
          <span class="cat-badge">${escapeHtml(sc.category || 'reconstruction')}</span>
        </div>
        <div class="row-preview">${escapeHtml(preview)}</div>
      `;
      frag.appendChild(row);
    });

    spRowsContainer.innerHTML = "";
    spRowsContainer.appendChild(frag);

    const selectedScene = scenes.find(s => s.scene_id === selectedSceneId) || filtered[0];
    renderSelectedSceneDetail(selectedScene);
  }

  function renderSelectedSceneDetail(sc) {
    if (!spSelectedDetail) return;
    if (!sc) {
      spSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chọn một scene từ danh sách bên trái để xem chi tiết</p></div>`;
      return;
    }

    const sFmt = formatTime(sc.start);
    const eFmt = formatTime(sc.end);

    spSelectedDetail.innerHTML = `
      <div class="detail-header-card">
        <div class="detail-topbar">
          <div class="detail-identity">
            <span class="sp-scene-num detail-title">Scene ${sc.index}</span>
            <span class="sp-scene-time detail-time">${sFmt} &rarr; ${eFmt} (${sc.duration}s)</span>
          </div>
          <div class="detail-tags">
            <span class="cat-badge">${escapeHtml(sc.category || 'reconstruction')}</span>
            <span class="sp-evidence-pill">${escapeHtml(sc.evidence_mode || 'reconstruction')}</span>
            <span class="sp-framing-pill">${escapeHtml(sc.shot_type || 'medium wide')}</span>
            ${sc.continuity_group ? `<span class="veo-pill-tag continuity-tag">${escapeHtml(sc.continuity_group)}</span>` : ''}
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary btn-sm btn-seek-scene" data-action="seek" data-start="${sc.start}">
            <svg class="icon"><use href="#icon-play" /></svg>
            <span>▶ Phát</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-copy-prompt" data-action="copy">
            <svg class="icon"><use href="#icon-export" /></svg>
            <span>Sao chép Prompt</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-edit-scene" data-action="edit">
            <svg class="icon"><use href="#icon-edit" /></svg>
            <span>Chỉnh sửa</span>
          </button>
        </div>
      </div>

      <div class="detail-prose-box">
        <div class="detail-prose-label">Lời bình Narration</div>
        <div class="sp-narration-box">&ldquo;${escapeHtml(sc.narration || '')}&rdquo;</div>
      </div>

      <div class="detail-prose-box">
        <div class="detail-prose-label">Visual Summary</div>
        <div class="sp-visual-summary"><span class="sp-vs-prefix">Visual:</span> <span>${escapeHtml(sc.visual_summary || '')}</span></div>
      </div>

      <div class="detail-prompt-box sp-prompt-box">
        <div class="detail-prompt-label">Image Prompt</div>
        <code>${escapeHtml(sc.image_prompt || '')}</code>
      </div>

      ${sc.negative_prompt ? `
      <div class="detail-prompt-box sp-negative-prompt-box" style="margin-top: 10px;">
        <div class="detail-prompt-label">Negative Prompt</div>
        <code style="color: var(--text-muted);">${escapeHtml(sc.negative_prompt)}</code>
      </div>
      ` : ''}
    `;
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
      const row = e.target.closest(".compact-row");
      if (!row) return;
      const sceneId = row.dataset.sceneId;
      selectSceneById(sceneId);
      const scene = projectScenes.find(s => s.scene_id === sceneId);
      if (scene) {
        window.seekGlobalAudio(scene.start, `Scene ${scene.index}`);
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
        window.seekGlobalAudio(scene.start, `Scene ${scene.index} (${formatTime(scene.start)})`);
      } else if (action === "copy") {
        await copyTextToClipboard(scene.image_prompt, btn);
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
    if (spModalTitle) spModalTitle.textContent = `Chỉnh sửa Scene ${scene.index} (${scene.scene_id})`;
    if (spEditCategory) spEditCategory.value = scene.category || "reconstruction";
    if (spEditEvidence) spEditEvidence.value = scene.evidence_mode || "reconstruction";
    if (spEditShotType) spEditShotType.value = scene.shot_type || "medium wide";
    if (spEditCameraMotion) spEditCameraMotion.value = scene.camera_motion || "static";
    if (spEditContinuity) spEditContinuity.value = scene.continuity_group || "";
    if (spEditSummary) spEditSummary.value = scene.visual_summary || "";
    if (spEditPrompt) spEditPrompt.value = scene.image_prompt || "";
    if (spEditNegativePrompt) spEditNegativePrompt.value = scene.negative_prompt || "";
    spEditModal.style.display = "flex";
    trapFocus(spEditModal);
  }

  function closeEditSceneModal() {
    if (spEditModal) spEditModal.style.display = "none";
    releaseActiveFocus();
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
        closeEditSceneModal();
        await loadScenesForProject(currentProjectDir);
      } catch (err) {
        alert(`Lỗi lưu: ${err.message}`);
      } finally {
        spModalSaveBtn.disabled = false;
        spModalSaveBtn.textContent = "Lưu thay đổi";
      }
    });
  }

  btnGenerateScenes.addEventListener("click", async () => {
    if (!currentProjectDir) return;
    if (projectScenes.length > 0) {
      const hasEdits = projectScenes.some(s => s.status === "edited");
      const msg = hasEdits
        ? "Tạo lại Scene Plan?\n\nBạn đã chỉnh sửa Scene thủ công. Phiên bản hiện tại sẽ được lưu archive trước khi tạo lại.\n\nBạn có muốn tiếp tục?"
        : "Tạo lại Scene Plan?\n\nBản hiện tại sẽ được thay thế (bản sao lưu tự động sẽ được giữ lại). Tiếp tục?";
      if (!confirm(msg)) return;
    }

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
      await loadScenesForProject(currentProjectDir);
    } catch (err) {
      if (spErrorAlert) {
        spErrorAlert.style.display = "flex";
        spErrorText.textContent = err.message;
      }
      setSpStatus("failed", "Thất bại");
    } finally {
      btnGenerateScenes.disabled = false;
    }
  });

  btnRefreshScenes.addEventListener("click", () => {
    if (currentProjectDir) loadScenesForProject(currentProjectDir);
  });

  btnExportScenesJson.addEventListener("click", () => {
    if (currentProjectDir) window.location.href = `/api/projects/${currentProjectDir}/scenes/prompts.json`;
  });

  btnExportScenesMd.addEventListener("click", () => {
    if (currentProjectDir) window.location.href = `/api/projects/${currentProjectDir}/scenes/prompts.md`;
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
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;

    try {
      const res = await fetch(`/api/projects/${dirName}/veo`);
      if (!res.ok) {
        setVeoStatus("idle", "Chưa sẵn sàng");
        btnGenerateVeo.disabled = true;
        btnRefreshVeo.disabled = true;
        btnExportVeoJson.disabled = true;
        btnExportVeoMd.disabled = true;
        return;
      }

      const data = await res.json();
      projectVeoShots = data.shots || [];
      const status = data.status || "Not Generated";
      const shotCount = data.shot_count || projectVeoShots.length;
      const coverage = data.coverage != null ? data.coverage : (shotCount > 0 ? 100.0 : 0.0);
      const duration = data.audio_duration || 0.0;

      if (veoCountBadge) veoCountBadge.textContent = `${shotCount} shot`;
      if (veoCoverageBadge) veoCoverageBadge.textContent = (status === "Not Generated" || shotCount === 0) ? "Coverage 0%" : `${coverage.toFixed(0)}% Time`;
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
        btnExportVeoJson.disabled = projectVeoShots.length === 0;
        btnExportVeoMd.disabled = projectVeoShots.length === 0;
      } else {
        setVeoStatus("idle", "Chưa tạo");
        btnExportVeoJson.disabled = true;
        btnExportVeoMd.disabled = true;
        veoStaleAlert.style.display = "none";
      }

      renderVeoShotsList(projectVeoShots);
    } catch (err) {
      console.error("Failed to load project Veo prompts:", err);
      window.__lastVeoError = (err && err.stack) || String(err);
      setVeoStatus("failed", "Lỗi");
    }
  }

  function renderVeoShotsList(shots) {
    if (!veoTimelineList || !veoRowsContainer || !veoSelectedDetail) return;
    if (!shots || shots.length === 0) {
      veoRowsContainer.innerHTML = `<p class="empty-state">Chưa có Veo Prompt. Bấm "Tạo Veo Prompt" để dựng prompt video.</p>`;
      veoSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chưa có dữ liệu shot</p></div>`;
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
      veoRowsContainer.innerHTML = `<p class="empty-state">Không tìm thấy shot phù hợp với bộ lọc.</p>`;
      veoSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Không có shot nào được chọn</p></div>`;
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
      row.setAttribute("aria-label", `Shot ${sh.index}, ${sh.tone || 'neutral'}`);

      const sFmt = formatTime(sh.start);
      const eFmt = formatTime(sh.end);
      const preview = sh.subject_action || sh.narration || sh.veo_prompt || "";

      row.innerHTML = `
        <div class="row-meta">
          <span class="veo-shot-num row-id">Shot ${sh.index}</span>
          <span class="veo-shot-time row-time">${sFmt} &rarr; ${eFmt}</span>
          <span class="tone-tag">${escapeHtml(sh.tone || 'neutral')}</span>
        </div>
        <div class="row-preview">${escapeHtml(preview)}</div>
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
      veoSelectedDetail.innerHTML = `<div class="detail-empty-state"><p>Chọn một shot từ danh sách bên trái để xem chi tiết</p></div>`;
      return;
    }

    const sFmt = formatTime(sh.start);
    const eFmt = formatTime(sh.end);
    const splitInfo = (sh.shot_split_total && sh.shot_split_total > 1)
      ? `Scene ${sh.parent_scene_index} (Shot ${sh.shot_split_index}/${sh.shot_split_total})`
      : `Scene ${sh.parent_scene_index}`;

    veoSelectedDetail.innerHTML = `
      <div class="detail-header-card">
        <div class="detail-topbar">
          <div class="detail-identity">
            <span class="veo-shot-num detail-title">Shot ${sh.index} &bull; ${escapeHtml(sh.shot_id)}</span>
            <span class="veo-shot-parent detail-subtitle">${escapeHtml(splitInfo)}</span>
            <span class="veo-shot-time detail-time">${sFmt} &rarr; ${eFmt} (${sh.duration}s)</span>
          </div>
          <div class="detail-tags">
            <span class="veo-pill-tag tone-tag">${escapeHtml(sh.tone || 'neutral')}</span>
            <span class="veo-pill-tag aspect-tag">${escapeHtml(sh.aspect_ratio || '16:9')}</span>
            ${sh.continuity_anchor ? `<span class="veo-pill-tag continuity-tag">${escapeHtml(sh.continuity_anchor)}</span>` : ''}
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary btn-sm btn-seek-shot" data-action="seek" data-start="${sh.start}">
            <svg class="icon"><use href="#icon-play" /></svg>
            <span>▶ Phát từ đây</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-copy-veo-prompt" data-action="copy">
            <svg class="icon"><use href="#icon-export" /></svg>
            <span>Sao chép Prompt</span>
          </button>
          <button class="btn btn-secondary btn-sm btn-edit-veo-shot" data-action="edit">
            <svg class="icon"><use href="#icon-edit" /></svg>
            <span>Chỉnh sửa Prompt</span>
          </button>
        </div>
      </div>

      <div class="detail-prose-box">
        <div class="detail-prose-label">Lời bình Narration</div>
        <div class="veo-narration-box">&ldquo;${escapeHtml(sh.narration || '')}&rdquo;</div>
      </div>

      <div class="veo-action-details detail-prose-box">
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

      <div class="detail-prompt-box veo-prompt-box">
        <div class="detail-prompt-label">Veo Video Prompt (Production-Ready)</div>
        <code>${escapeHtml(sh.veo_prompt || '')}</code>
      </div>

      ${sh.negative_prompt ? `
      <div class="detail-prompt-box veo-negative-prompt-box" style="margin-top: 10px;">
        <div class="detail-prompt-label">Negative Prompt</div>
        <code style="color: var(--text-muted);">${escapeHtml(sh.negative_prompt)}</code>
      </div>
      ` : ''}
    `;
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

  // Row Selection in Veo Shot List
  if (veoRowsContainer) {
    veoRowsContainer.addEventListener("click", (e) => {
      const row = e.target.closest(".compact-row");
      if (!row) return;
      const shotId = row.dataset.shotId;
      selectShotById(shotId);
      const shot = projectVeoShots.find(s => s.shot_id === shotId);
      if (shot) {
        window.seekGlobalAudio(shot.start, `Shot ${shot.index}`);
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
        window.seekGlobalAudio(shot.start, `Shot ${shot.index} (${formatTime(shot.start)})`);
      } else if (action === "copy") {
        await copyTextToClipboard(shot.veo_prompt, btn);
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
    if (veoModalTitle) veoModalTitle.textContent = `Chỉnh sửa Shot ${shot.index} (${shot.shot_id})`;
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
    trapFocus(veoEditModal);
  }

  function closeEditVeoModal() {
    if (veoEditModal) veoEditModal.style.display = "none";
    releaseActiveFocus();
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
        alert(`Lỗi lưu: ${err.message}`);
      } finally {
        veoModalSaveBtn.disabled = false;
        veoModalSaveBtn.textContent = "Lưu thay đổi";
      }
    });
  }

  btnGenerateVeo.addEventListener("click", async () => {
    if (!currentProjectDir) return;
    if (projectVeoShots.length > 0) {
      const hasEdits = projectVeoShots.some(s => s.status === "edited");
      const msg = hasEdits
        ? "Tạo lại Veo Prompt?\n\nBạn đã chỉnh sửa Prompt thủ công. Phiên bản hiện tại sẽ được lưu archive trước khi tạo lại.\n\nBạn có muốn tiếp tục?"
        : "Tạo lại Veo Prompt?\n\nBản hiện tại sẽ được thay thế (bản sao lưu tự động sẽ được giữ lại). Tiếp tục?";
      if (!confirm(msg)) return;
    }

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
      await loadVeoForProject(currentProjectDir);
    } catch (err) {
      if (veoErrorAlert) {
        veoErrorAlert.style.display = "flex";
        veoErrorText.textContent = err.message;
      }
      setVeoStatus("failed", "Thất bại");
    } finally {
      btnGenerateVeo.disabled = false;
    }
  });

  btnRefreshVeo.addEventListener("click", () => {
    if (currentProjectDir) loadVeoForProject(currentProjectDir);
  });

  btnExportVeoJson.addEventListener("click", () => {
    if (currentProjectDir) window.location.href = `/api/projects/${currentProjectDir}/veo/prompts.json`;
  });

  btnExportVeoMd.addEventListener("click", () => {
    if (currentProjectDir) window.location.href = `/api/projects/${currentProjectDir}/veo/prompts.md`;
  });

  // ==============================================================================
  // 12. PROJECTS BROWSER & AUDITION
  // ==============================================================================
  async function loadProjects() {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (data.projects && data.projects.length > 0) {
        const frag = document.createDocumentFragment();
        data.projects.slice(0, 15).forEach(p => {
          const item = document.createElement("div");
          item.className = "project-item";
          const dur = p.duration_seconds ? `${p.duration_seconds} giây` : "--";
          item.innerHTML = `
            <div class="project-info">
              <span class="project-title">${escapeHtml(p.project_name)}</span>
              <span class="project-details">${escapeHtml(p.voice)} &bull; ${p.character_count} ký tự &bull; ${dur}</span>
            </div>
            <div class="project-actions">
              <button class="btn btn-secondary btn-sm" onclick="loadPreviewAudio('${p.directory_name}', ${p.duration_seconds || 0})">
                <span>Mở dự án</span>
              </button>
            </div>
          `;
          frag.appendChild(item);
        });
        projectsList.innerHTML = "";
        projectsList.appendChild(frag);

        if (!currentProjectDir && data.projects.length > 0) {
          loadPreviewAudio(data.projects[0].directory_name, data.projects[0].duration_seconds || 0, false);
        }
      } else {
        projectsList.innerHTML = `<p class="empty-state">Chưa có dự án nào trong hệ thống.</p>`;
      }
    } catch (err) {
      console.error("Failed to list projects:", err);
    }
  }

  window.loadPreviewAudio = function(dirName, duration, autoPlay = true) {
    currentProjectDir = dirName;
    window.currentProjectDir = currentProjectDir;
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

    loadTimestampsForProject(dirName);
    loadScenesForProject(dirName);
    loadVeoForProject(dirName);
  };

  btnRefreshHistory.addEventListener("click", loadProjects);

  // ==============================================================================
  // 13. UTILITIES
  // ==============================================================================
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ==============================================================================
  // 14. INITIALIZATION
  // ==============================================================================
  checkHealth();
  loadVoicesAndSettings();
  loadPronunciations();
  loadProjects();
  updateTextStats();
  updateSlugPreview();
  setInterval(checkHealth, 15000);
});
