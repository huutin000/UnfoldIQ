"use strict";
/* UNFOLDIQ Flow Companion side panel — POST-v1D (STEP 10B → POST-v1C → POST-v1D).
 * Task focused UX: one main screen (job + one primary action + progress),
 * Settings screen separated, Developer Tools gated behind Developer Mode.
 *
 * Automation architecture UNCHANGED (bridge, tab resolver, FlowPageAdapter,
 * zero-credit preparation, approval gate, generation state, download/import,
 * reference metadata, security policy). Only the presentation layer changed.
 * Low-risk steps run automatically on open: restore safe config → resolve
 * Flow tab → check connectivity → fetch job → canonical auto-preparation
 * (ensureCurrentJobPrepared) → zero-credit PREPARE_GENERATION. Generate is
 * NEVER auto-clicked.
 */
(function () {
  if (typeof chrome === "undefined" || !chrome.runtime) return;

  const T = window.FlowUIStrings || {};
  const UIState = window.FlowUIState || null;
  const JobCard = window.FlowJobCard || null;
  const Stepper = window.FlowStepper || null;
  const RefSummary = window.FlowReference || null;
  const DevTools = window.FlowDevTools || null;
  const Toast = window.FlowToast || null;
  const Icons = window.FlowIcons || null;
  const Snapshot = window.FlowApprovalSnapshot || null;
  const AutoPrepare = window.FlowAutoPrepare || null;

  const $ = (id) => document.getElementById(id);
  const toastBox = $("toast-container");
  const viewMain = $("view-main");
  const viewSettings = $("view-settings");
  const statusChip = $("status-chip");
  const statusText = $("status-text");
  const jobCardEl = $("job-card");
  const stepperSlot = $("stepper-slot");
  const refSlot = $("reference-slot");
  const errorSlot = $("error-slot");
  const resultSlot = $("result-slot");
  const ctaBtn = $("primary-action");
  const secondaryBtn = $("secondary-action");
  const devModeBox = $("dev-mode");
  const devToolsSection = $("dev-tools");
  const diagEl = $("diagnostics");
  const selectorListEl = $("selector-list");
  const rawJobEl = $("raw-job");
  const logEl = $("log");

  let cfg = { bridgeUrl: "http://127.0.0.1:4317", bridgeToken: "", projectId: "postv1b-flow-companion-live", jobId: "" };
  let currentJob = null;
  let lastDiagnostics = null;
  let lastResolution = null; // canonical action-time resolver evidence (§12/§13)
  let lastGenerationState = null;
  let lastPromptVerified = false;
  let lastApprovalSnapshot = null; // POST-v1E §22 frozen packet (single-use)
  let lastError = null; // { title, body, code }
  let lastResult = null; // { artifactPath, sha256, detectedAt }
  // FIX 02 live instruction apply (single-project scope): the canonical set
  // lives under this local project; the provider ref always comes from live
  // GET_STATE identity, never typed. Memory-only; cleared on job switch.
  const INSTRUCTION_PROJECT_ID = "channel-mascot";
  let lastInstructionApply = null; // { projectId, syncId, providerProjectRef, applyStatus, appliedAt }
  let uiState = "CONNECTING";
  let connected = false;
  let devMode = false;
  const inFlight = new Set();

  /* ---------------- log (developer only) ---------------- */
  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    if (logEl) logEl.textContent += `${line}\n`;
  }

  /* ---------------- toast ---------------- */
  function toast(message, type, timeoutMs) {
    if (Toast && toastBox) Toast.showToast(toastBox, message, type, timeoutMs);
    else log(message);
  }

  /* ---------------- loading / double-click guard ---------------- */
  function setCtaLoading(loading, label) {
    if (!ctaBtn) return;
    if (loading) {
      ctaBtn.disabled = true;
      ctaBtn.innerHTML = "";
      const spin = document.createElement("span");
      spin.className = "spin";
      spin.setAttribute("aria-hidden", "true");
      ctaBtn.appendChild(spin);
      ctaBtn.appendChild(document.createTextNode(label || T.ctaPreparing || "Đang chuẩn bị…"));
    }
  }

  async function guard(key, fn) {
    if (inFlight.has(key)) return null;
    inFlight.add(key);
    try {
      return await fn();
    } finally {
      inFlight.delete(key);
      render();
    }
  }

  /* ---------------- bridge / relay (UNCHANGED logic) ---------------- */
  function normalizeBridgeUrl(raw) {
    const u = new URL(raw);
    if (u.protocol !== "http:") throw new Error("BRIDGE_URL_REJECTED: chỉ cho phép http loopback");
    if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("BRIDGE_URL_REJECTED: chỉ máy cục bộ");
    return `${u.protocol}//${u.host}`;
  }

  async function bridgeCall(method, path, body, opts = {}) {
    if (!cfg.bridgeToken) throw new Error("BRIDGE_TOKEN_REQUIRED: nhập mã truy cập Bridge trước");
    // Hardening sweep (B-2): a hung loopback bridge must never leave a credit
    // action (approve/generate/import) in a dead silent wait — abort after a
    // bounded timeout and surface an explicit, retryable error instead.
    const timeoutMs = opts.timeoutMs || 15000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(`${normalizeBridgeUrl(cfg.bridgeUrl)}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "x-bridge-token": cfg.bridgeToken },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw new Error(`BRIDGE_TIMEOUT: Bridge không phản hồi trong ${Math.round(timeoutMs / 1000)}s tại ${cfg.bridgeUrl}${path}`);
      }
      throw new Error(`BRIDGE_UNREACHABLE: không thể kết nối Bridge tại ${cfg.bridgeUrl} (${e && e.message ? e.message : "network error"})`);
    } finally {
      clearTimeout(timer);
    }
    let parsed = null;
    try {
      parsed = await res.json();
    } catch (e) {
      void e;
    }
    if (!res.ok) throw new Error((parsed && parsed.error) || `BRIDGE_HTTP_${res.status}`);
    return parsed;
  }

  function swMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp || resp.ok !== true) return reject(new Error((resp && resp.error) || "WORKER_ERROR"));
        if (resp.resolution) {
          const r = resp.resolution;
          // POST-v1E stall fix §12/§13: the canonical action-time resolver
          // (tabs.query → origin verify → PING) is the source of truth for
          // content-script connectivity. Port presence is supplementary only
          // and can never contradict this signal.
          lastResolution = {
            tabId: r.selectedTabId ?? null,
            origin: r.selectedOrigin ?? null,
            ping: r.pingSuccess === true,
            source: r.source || null,
            lastError: r.lastError || null,
            at: new Date().toISOString(),
          };
          log(`liveTab: matched=${r.queryMatchedTabs} tabId=${r.selectedTabId} origin=${r.selectedOrigin} ping=${r.pingSuccess} source=${r.source}${r.lastError ? ` err=${r.lastError}` : ""}`);
          applyContentScriptStatus();
        }
        resolve(resp.result);
        // Phase 5C §22 (GAP-030): forward worker trace spans to the bridge
        // ingestor. Best-effort only — failures never break panel UX.
        try {
          if (resp && Array.isArray(resp.trace) && resp.trace.length > 0) {
            const traceJobId = (msg && ((msg.cmd && msg.cmd.jobId) || (msg.approval && msg.approval.jobId))) || null;
            if (traceJobId && typeof bridgeCall === "function") {
              bridgeCall("POST", `/jobs/${encodeURIComponent(traceJobId)}/trace`, { spans: resp.trace }, { timeoutMs: 8000 }).catch(() => {});
            }
          }
        } catch (e) { void e; }
      });
    });
  }

  /* §13: content-script connection diagnostic fields from the canonical ping. */
  function applyContentScriptStatus() {
    if (!lastResolution) return;
    if (!lastDiagnostics) lastDiagnostics = {};
    lastDiagnostics.contentScriptStatus = lastResolution.ping ? "CONNECTED" : "NOT_CONNECTED";
    lastDiagnostics.contentScriptTabId = lastResolution.tabId;
    lastDiagnostics.contentScriptOrigin = lastResolution.origin;
    lastDiagnostics.contentScriptSource = lastResolution.source;
    lastDiagnostics.contentScriptLastPingAt = lastResolution.at;
    renderDevTools();
  }

  function tabRelay(cmd, timeoutMs) {
    return swMessage({ kind: "TAB_RELAY", cmd, timeoutMs });
  }

  /* ---------------- reference fields (same IDs, now in Settings) ---------------- */
  function readReferenceFields() {
    const val = (id) => {
      const n = $(id);
      return n ? n.value.trim() : "";
    };
    const lines = (id) => val(id).split("\n").map((s) => s.trim()).filter(Boolean);
    const path = val("ref-image");
    const semanticRole = val("ref-desc-role");
    const identityTraits = lines("ref-desc-traits");
    const continuityConstraints = lines("ref-desc-constraints");
    const allowedVariation = lines("ref-desc-variation");
    const hasAny = Boolean(path || semanticRole || identityTraits.length || continuityConstraints.length || allowedVariation.length);
    if (!hasAny) return null;
    return {
      referenceAsset: path ? { id: path, path } : null,
      referenceDescription: { semanticRole: semanticRole || null, identityTraits, continuityConstraints, allowedVariation },
    };
  }

  /* ---------------- friendly errors (raw codes → Chi tiết kỹ thuật) ---------------- */
  function friendlyError(e) {
    // POST-v1E.1 P2: never render an object as "[object Object]".
    const code = JobCard && JobCard.errorText ? JobCard.errorText(e && e.message !== undefined ? e.message : e) : String((e && e.message) || e || "UNKNOWN");
    if (/FLOW_TAB_NOT_FOUND|CONTENT_SCRIPT_NOT_INJECTED|receiving end|FLOW_PAGE_NOT_READY/i.test(code)) {
      return { title: T.errFlowTitle, body: T.errFlowBody, code };
    }
    if (/TOKEN_REJECTED|BRIDGE_HTTP_401/i.test(code)) {
      return { title: "Mã truy cập Bridge không còn hợp lệ.", body: "Hãy lấy mã mới từ Bridge và nhập lại.", code };
    }
    if (/BRIDGE_UNREACHABLE|BRIDGE_TOKEN_REQUIRED|BRIDGE_HTTP|BRIDGE_URL/i.test(code)) {
      return { title: T.errBridgeTitle, body: T.errBridgeBody, code };
    }
    // POST-v1E stall fix §17: precise preparation failures keep their exact
    // code and get a dedicated friendly message (never a generic spinner).
    if (/GENERATION_[A-Z_]+|IMAGE_OPTION_NOT_FOUND|PROMPT_[A-Z_]+|FLOW_COMPOSER_READY_TIMEOUT|MODEL_CONTROL_NOT_FOUND|SETTINGS_POPOVER_NOT_OBSERVED|TARGET_ASPECT_NOT_AVAILABLE|ASPECT_VERIFY_FAILED|OUTPUT_COUNT_NOT_AVAILABLE|OUTPUT_COUNT_VERIFY_FAILED|GENERATE_CONTROL_NOT_FOUND|GENERATE_STILL_DISABLED|AGENT_MODE_DETECTED|PREPARATION_TIMEOUT/i.test(code)) {
      if (/PROMPT_TEXT_MISMATCH|PROMPT_VERIFY_TIMEOUT|PROMPT_APP_STATE_NOT_COMMITTED|PROMPT_EDITOR_REPLACED_EMPTY/i.test(code)) {
        return { title: T.errPreparationTitle || "Không thể hoàn tất chuẩn bị.", body: "Không thể xác minh nội dung prompt sau khi nhập vào Google Flow.", code };
      }
      return { title: T.errPreparationTitle || "Không thể hoàn tất chuẩn bị.", body: T.errPreparationBody || "Flow chưa sẵn sàng theo yêu cầu công việc. Hãy thử lại.", code };
    }
    return { title: T.errGenericTitle, body: T.errGenericBody, code };
  }

  /* ---------------- render (task focused; single CTA source of truth) ---------------- */
  // Hardening sweep (B-3): the polling loops re-render every cycle, which
  // rewrote jobCard.innerHTML and dropped keyboard focus to <body> while the
  // user was interacting with the card. Region-scoped swap: each region is
  // only rewritten when its rendered HTML actually changes.
  const lastRegionHtml = { jobCard: null, stepper: null, reference: null };
  function setRegionHtml(el, key, html) {
    if (!el) return;
    if (lastRegionHtml[key] === html && el.innerHTML === html) return;
    lastRegionHtml[key] = html;
    el.innerHTML = html;
  }
  function render() {
    const mapped = UIState ? UIState.resolveUIState(uiState) : null;
    // Status chip.
    if (statusText && mapped) statusText.textContent = mapped.status;
    if (statusChip && mapped) statusChip.setAttribute("data-tone", mapped.statusTone || "busy");
    // Job card.
    if (jobCardEl && JobCard) {
      const cardHtml = JobCard.renderJobCard(currentJob, lastDiagnostics, T, lastApprovalSnapshot);
      if (lastRegionHtml.jobCard === cardHtml && jobCardEl.innerHTML === cardHtml) {
        // unchanged: keep the live DOM (and any keyboard focus inside it)
      } else {
        lastRegionHtml.jobCard = cardHtml;
        jobCardEl.innerHTML = cardHtml;
        const btn = jobCardEl.querySelector('[data-action="toggle-prompt"]');
        if (btn) {
          btn.addEventListener("click", () => {
            const p = jobCardEl.querySelector("[data-prompt]");
            const expanded = p && p.classList.toggle("expanded");
            btn.textContent = expanded ? T.showLess : T.viewFull;
            btn.setAttribute("aria-expanded", expanded ? "true" : "false");
          });
        }
        const details = jobCardEl.querySelector("details.tech-details summary");
        if (details) {
          details.addEventListener("click", () => {
            setTimeout(() => {
              details.textContent = jobCardEl.querySelector("details.tech-details").open ? T.hideDetails : T.viewDetails;
            }, 0);
          });
        }
      }
    }
    // Stepper.
    if (stepperSlot && Stepper && mapped) setRegionHtml(stepperSlot, "stepper", Stepper.renderStepper(mapped.stepper, T));
    // Reference (conditional — hidden when the job needs none).
    if (refSlot && RefSummary) {
      setRegionHtml(refSlot, "reference", RefSummary.renderReferenceSummary(readReferenceFields(), T));
      const edit = refSlot.querySelector('[data-action="edit-reference"]');
      if (edit) edit.addEventListener("click", () => showSettings());
    }
    // Error card (human first, code under details).
    if (errorSlot) {
      if (lastError && (uiState === "ERROR_RETRYABLE" || uiState === "NEED_ATTENTION" || uiState === "BLOCKED" || uiState === "NEED_FLOW" || uiState === "NEED_CONFIG")) {
        errorSlot.innerHTML =
          `<div class="error-card" role="alert"><strong>${JobCard ? JobCard.esc(lastError.title) : lastError.title}</strong>` +
          `<p>${JobCard ? JobCard.esc(lastError.body) : lastError.body}</p>` +
          `<details class="tech-details"><summary>${T.techDetails || "Chi tiết kỹ thuật"}</summary>` +
          `<p>${JobCard ? JobCard.esc(lastError.code) : lastError.code}</p></details></div>`;
      } else {
        errorSlot.innerHTML = "";
      }
    }
    // Result card.
    if (resultSlot) {
      resultSlot.innerHTML = lastResult
        ? `<section class="card result-card" aria-label="Kết quả"><div class="card-title">${T.statusDone || "Hoàn tất"}</div>` +
          `<div>${T.toastImported || "Đã nhập asset vào UNFOLDIQ"}</div><code>${JobCard ? JobCard.esc(lastResult.artifactPath) : lastResult.artifactPath}</code></section>`
        : "";
    }
    // Primary CTA — exactly one per state.
    if (ctaBtn && mapped) {
      const busy = inFlight.size > 0;
      ctaBtn.textContent = mapped.cta;
      ctaBtn.disabled = !mapped.ctaEnabled || busy;
    }
    // Quiet secondary: reject only while awaiting approval.
    if (secondaryBtn) {
      if (uiState === "AWAITING_USER_APPROVAL") {
        secondaryBtn.hidden = false;
        secondaryBtn.textContent = T.secondaryReject || "Từ chối";
        secondaryBtn.disabled = inFlight.size > 0;
      } else {
        secondaryBtn.hidden = true;
      }
    }
    renderDevTools();
  }

  function renderDevTools() {
    // §12: never leave the stale placeholder visible — gate on the section's
    // real visibility, not on a possibly-divergent devMode flag.
    if (!devMode || !devToolsSection || devToolsSection.hidden) return;
    if (diagEl && DevTools) {
      diagEl.textContent = lastDiagnostics
        ? DevTools.renderDiagnosticsText(lastDiagnostics)
        : DevTools.renderContentScriptPending(lastResolution);
    }
    if (selectorListEl && DevTools && lastDiagnostics) {
      selectorListEl.innerHTML = DevTools.renderSelectorList(lastDiagnostics.selectorHealth);
    }
    if (rawJobEl) rawJobEl.textContent = currentJob ? JSON.stringify(currentJob, null, 2) : "—";
  }

  /* ---------------- views ---------------- */
  function showSettings() {
    if (viewMain) viewMain.hidden = true;
    if (viewSettings) viewSettings.hidden = false;
    if (viewSettings) viewSettings.scrollTop = 0;
  }
  function showMain() {
    if (viewSettings) viewSettings.hidden = true;
    if (viewMain) viewMain.hidden = false;
    render();
  }

  /* ---------------- pipeline steps (same safety semantics) ---------------- */
  function rememberChecked() {
    const box = $("remember-token");
    return Boolean(box && box.checked === true);
  }

  /* Read-modify-write so a bridge outage can never erase a remembered token:
   * the token key is only removed when the user explicitly unchecks "Nhớ". */
  async function saveConfigSilent() {
    cfg = {
      bridgeUrl: $("bridge-url").value.trim(),
      bridgeToken: $("bridge-token").value || cfg.bridgeToken || "",
      projectId: $("project-id").value.trim(),
      jobId: $("job-id").value.trim(),
    };
    try {
      const prev = (await chrome.storage.local.get("flowCompanionBridge")).flowCompanionBridge || {};
      const stored = {
        ...prev,
        bridgeUrl: cfg.bridgeUrl,
        projectId: cfg.projectId,
        jobId: cfg.jobId,
        rememberToken: rememberChecked(),
        schemaVersion: 1,
      };
      if (!stored.rememberToken) delete stored.bridgeToken;
      await chrome.storage.local.set({ flowCompanionBridge: stored });
    } catch (e) {
      void e;
    }
  }

  /* Called only AFTER an authenticated bridge call succeeded — an unverified
   * token is never persisted. */
  async function persistRememberedToken() {
    if (!rememberChecked() || !cfg.bridgeToken) return;
    try {
      const prev = (await chrome.storage.local.get("flowCompanionBridge")).flowCompanionBridge || {};
      await chrome.storage.local.set({
        flowCompanionBridge: { ...prev, rememberToken: true, bridgeToken: cfg.bridgeToken, schemaVersion: 1 },
      });
      log("bridge token remembered on this device (storage.local)");
    } catch (e) {
      void e;
    }
  }

  /* "Quên mã truy cập": removes the remembered token locally only — the
   * Bridge-side token is rotated separately via npm run flow:bridge:reset-token. */
  async function onForgetToken() {
    cfg.bridgeToken = "";
    const box = $("remember-token");
    if (box) box.checked = false;
    const field = $("bridge-token");
    if (field) field.value = "";
    try {
      const prev = (await chrome.storage.local.get("flowCompanionBridge")).flowCompanionBridge || {};
      const stored = { ...prev, rememberToken: false, schemaVersion: 1 };
      delete stored.bridgeToken;
      await chrome.storage.local.set({ flowCompanionBridge: stored });
    } catch (e) {
      void e;
    }
    toast("Đã quên mã truy cập trên thiết bị này", "info");
  }

  async function resolveFlow() {
    const r = await swMessage({ kind: "FLOW_TABS" });
    log(`connected Flow tabs: ${r.connectedTabs}`);
    if (!r || r.connectedTabs === 0) throw new Error("FLOW_TAB_NOT_FOUND: no open tab matches the allowed Flow origins");
    connected = true;
    try {
      const res = await tabRelay({ type: "GET_STATE", jobId: currentJob ? currentJob.jobId : null, jobState: currentJob ? currentJob.status : null }, 30000);
      if (res && res.diagnostics) {
        res.diagnostics.bridgeReachable = true;
        lastDiagnostics = res.diagnostics;
      }
    } catch (e) {
      log(`diagnostics unavailable: ${e.message}`);
    }
  }

  async function fetchJob() {
    await saveConfigSilent();
    const job = (await bridgeCall("GET", `/jobs/${encodeURIComponent(cfg.jobId)}?projectId=${encodeURIComponent(cfg.projectId)}`)).job;
    await persistRememberedToken(); // token verified by the authenticated call above
    currentJob = job;
    lastPromptVerified = false;
    lastGenerationState = null;
    lastApprovalSnapshot = null;
    lastResult = null;
    lastInstructionApply = null;
    // A READY job imported in an earlier session carries its artifact on the
    // bridge record — hydrate so the result card + "Xem kết quả" work here too.
    if (job && job.status === "READY" && job.deliveredArtifact) {
      lastResult = { artifactPath: job.deliveredArtifact, sha256: job.artifactSha256 || null, detectedAt: null };
    }
    lastError = null;
    try {
      const d = await tabRelay({ type: "GET_STATE", jobId: job.jobId, jobState: job.status }, 30000).catch(() => null);
      if (d && d.diagnostics) {
        d.diagnostics.bridgeReachable = true;
        lastDiagnostics = d.diagnostics;
      }
    } catch (e) {
      void e;
    }
    log(`job fetched: ${job.jobId} (${job.status})`);
  }

  function syncUIState() {
    if (!UIState) return;
    if (!currentJob) {
      uiState = connected ? "NO_JOB" : uiState;
      return;
    }
    const ready = lastGenerationState && lastGenerationState.ready === true;
    uiState = UIState.uiStateForJob(currentJob, {
      connected,
      generationReady: ready,
      preparationActive: uiState === "PREPARING",
      preparationFailed: uiState === "NEED_ATTENTION",
    });
  }

  function makeNonce() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch {
      /* fallback below */
    }
    return `nonce-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }

  /* POST-v1E §22: freeze the approval packet the user actually sees. */
  function freezeApprovalSnapshot() {
    lastApprovalSnapshot = null;
    if (!Snapshot || !currentJob || !lastGenerationState) return;
    lastApprovalSnapshot = Snapshot.buildApprovalSnapshot({
      job: currentJob,
      generationState: lastGenerationState,
      reference: readReferenceFields(),
      nonce: makeNonce(),
    });
    log(`approval snapshot frozen: fingerprint=${lastApprovalSnapshot.fingerprint.slice(0, 48)}… at=${lastApprovalSnapshot.timestamp}`);
  }

  async function markAwaitingApproval() {
    // POST-v1E §40: explicit bridge transition PREPARED →
    // AWAITING_USER_APPROVAL once GENERATION_READY is verified live.
    if (!currentJob || currentJob.status === "AWAITING_USER_APPROVAL") return;
    try {
      const updated = await bridgeCall("POST", `/jobs/${encodeURIComponent(currentJob.jobId)}/await-approval?projectId=${encodeURIComponent(currentJob.projectId)}`, {});
      currentJob.status = updated.status || currentJob.status;
      log(`bridge state: ${updated.status}`);
    } catch (e) {
      log(`await-approval not recorded: ${e.message}`);
    }
  }

  /* CTA dispatch — one obvious action per state, nothing else competes. */
  async function onPrimary() {
    const mapped = UIState ? UIState.resolveUIState(uiState) : null;
    const mode = (mapped && mapped.ctaMode) || "find";
    if (mode === "settings") {
      showSettings();
      return;
    }
    if (mode === "result") {
      const card = resultSlot && resultSlot.querySelector(".result-card");
      if (card && card.scrollIntoView) {
        card.scrollIntoView({ block: "nearest" });
        return;
      }
      // No rendered card (e.g. READY without a bridge artifact): never fail silent.
      if (lastResult && lastResult.artifactPath) toast(`Asset: ${lastResult.artifactPath}`, "info", 8000);
      else toast("Công việc HOÀN TẤT nhưng chưa có artifact để hiển thị", "warning");
      return;
    }
    if (mode === "issue") {
      if (!devMode && devModeBox) {
        devModeBox.checked = true;
        devMode = true;
        persistDevMode();
      }
      showSettings();
      return;
    }
    if (mode === "approve") {
      await guard("primary", onApprove);
      return;
    }
    // find / retry / busy-safe re-run of the automated pipeline.
    await guard("primary", runPipeline);
  }

  /* POST-v1E.2B P1: preparation notification lifecycle. ONE persistent keyed
   * notification owned by the run attempt — never stacked, never auto-dismissed,
   * stale attempts can never touch the current one. */
  const prepStatus =
    Toast && Toast.createPreparationStatus
      ? Toast.createPreparationStatus(toastBox, {
          labels: { preparing: T.toastPreparing || "Đang chuẩn bị…", done: T.prepDone || "Đã chuẩn bị xong", failed: T.prepFailed || "Không thể hoàn tất chuẩn bị" },
        })
      : null;

  /* POST-v1E stall fix §5: the single canonical orchestrator instance.
   * It is the ONLY normal-mode entry point after current-job resolution:
   * PREPARED auto-advances (§6), failures map honestly (§11), single-flight
   * by material key (§8), bounded watchdog (§10). */
  const preparer = AutoPrepare
    ? AutoPrepare.createAutoPreparer({
        log,
        watchdogMs: 120000,
        resolveLiveTab: async () => {
          const r = await swMessage({ kind: "FLOW_TABS" });
          log(`connected Flow tabs: ${r.connectedTabs}`);
          if (!r || r.connectedTabs === 0) throw new Error("FLOW_TAB_NOT_FOUND: no open tab matches the allowed Flow origins");
          const res = r.resolution || null;
          // FIX 02 §3: canonical `ping` field everywhere — resolver reports
          // pingSuccess; autoPrepare + diagnostics read `ping`.
          if (res) res.ping = res.pingSuccess === true;
          return res;
        },
        sendPrepare: ({ prompt, capability, approvalState }) =>
          tabRelay({ type: "PREPARE_GENERATION", prompt, capability, approvalState }, 60000),
        probeGenerationState: async ({ promptVerified, approvalState }) => {
          const gs = await tabRelay({ type: "GET_GENERATION_STATE", promptVerified, approvalState }, 60000);
          return (gs && gs.generationState) || null;
        },
        freezeSnapshot: async (generationState) => {
          if (generationState) lastGenerationState = generationState;
          freezeApprovalSnapshot();
        },
        markAwaitingApproval: async () => {
          await markAwaitingApproval();
        },
        onState: (s) => {
          if (s === "SYNC") syncUIState();
          else uiState = s;
          render();
        },
        onError: (err) => {
          lastError = friendlyError(err);
        },
      })
    : null;

  async function runPipeline() {
    lastError = null;
    uiState = "CONNECTING";
    render();
    // POST-v1E.2B P1: retry starts a fresh preparation lifecycle — stale
    // notifications from the previous attempt are replaced by exactly one
    // persistent "Đang chuẩn bị…".
    const attempt = prepStatus ? prepStatus.begin() : null;
    try {
      await saveConfigSilent();
      await resolveFlow();
      toast(T.toastConnected || "Đã kết nối Google Flow", "success");
    } catch (e) {
      connected = false;
      lastError = friendlyError(e);
      uiState = /BRIDGE/i.test(String((e && e.message) || e)) ? "NEED_CONFIG" : "NEED_FLOW";
      log(`resolve failed: ${e.message}`);
      if (attempt !== null) prepStatus.failure(attempt);
      render();
      return;
    }
    try {
      await fetchJob();
      toast(T.toastJobLoaded || "Đã tải công việc", "success");
    } catch (e) {
      lastError = friendlyError(e);
      uiState = /BRIDGE_TOKEN_REQUIRED/i.test(String((e && e.message) || e)) ? "NEED_CONFIG" : "ERROR_RETRYABLE";
      log(`fetch job failed: ${e.message}`);
      if (attempt !== null) prepStatus.failure(attempt);
      render();
      return;
    }
    // §6: PREPARED must auto-advance — no infrastructure click allowed here.
    let outcome = null;
    if (preparer && currentJob) {
      outcome = await preparer.ensureCurrentJobPrepared(currentJob);
      if (outcome && outcome.resumed && uiState === "GENERATING") {
        if (attempt !== null) prepStatus.clear(attempt); // attempt already generating — no preparing status left behind
        await resumeGenerationPoll(currentJob);
        return;
      }
    } else {
      log("autoPrepare: orchestrator unavailable (FlowAutoPrepare not loaded)");
    }
    if (uiState === "AWAITING_USER_APPROVAL") {
      if (attempt !== null) prepStatus.success(attempt); // "Đang chuẩn bị…" → "Đã chuẩn bị xong"
      toast(T.toastReady || "Đã sẵn sàng", "success");
    } else if (attempt !== null) {
      // A job that needed no preparation (already READY/resumed/mapped) never
      // failed — clear the attempt instead of painting a phantom failure.
      const action = AutoPrepare && typeof AutoPrepare.prepToastAction === "function"
        ? AutoPrepare.prepToastAction(outcome, uiState)
        : "failure";
      if (action === "clear") prepStatus.clear(attempt);
      else prepStatus.failure(attempt); // "Đang chuẩn bị…" → "Không thể hoàn tất chuẩn bị"
    }
    render();
  }

  async function resumeGenerationPoll(job) {
    // POST-v1F §6: resume NEVER adopts whatever is currently visible. The only
    // admissible source is the candidate set the bridge persisted at
    // RESULT_DETECTED. Without that record the attempt cannot be correlated, so
    // we stop instead of importing an arbitrary image.
    const startedAt = new Date().toISOString();
    const persisted = Array.isArray(currentJob && currentJob.resultCandidates) ? currentJob.resultCandidates : [];
    if (persisted.length === 0) {
      log("resume: RESULT_CORRELATION_REQUIRED — no candidates persisted at RESULT_DETECTED, refusing to adopt current page media");
      lastError = {
        title: "Không chứng minh được kết quả thuộc lần thử này.",
        body: "Không có bản ghi ứng viên được lưu khi phát hiện kết quả, nên không thể nhập kết quả.",
        code: "RESULT_CORRELATION_REQUIRED",
      };
      uiState = "ERROR_RETRYABLE";
      render();
      return;
    }
    const adoptable = persisted.find((c) => c && c.isNew === true);
    if (!adoptable) {
      log("resume: RESULT_CORRELATION_REQUIRED — no persisted candidate was new vs the pre-submit baseline");
      lastError = { title: "Không chứng minh được kết quả thuộc lần thử này.", body: "Ứng viên đã lưu không mới so với baseline.", code: "RESULT_CORRELATION_REQUIRED" };
      uiState = "ERROR_RETRYABLE";
      render();
      return;
    }
    log(`resume: adopting PERSISTED candidate ${adoptable.candidateId} (assetId=${adoptable.assetId || "n/a"}, ${adoptable.naturalWidth}x${adoptable.naturalHeight}) from RESULT_DETECTED`);
    await importResult(job, startedAt, adoptable);
    return;
  }

  /**
   * POST-v1F — wait for the ONE trusted user gesture (Google Flow's Start
   * generation) while polling READ-ONLY for acceptance. Returns the acceptance
   * timestamp, or null when the bounded budget expires. This never clicks.
   */
  async function awaitSubmitAcceptanceFromUser(job) {
    const deadline = Date.now() + 10 * 60 * 1000;
    let poll = 0;
    while (Date.now() < deadline) {
      poll += 1;
      let res = null;
      try {
        res = await tabRelay({ type: "AWAIT_SUBMIT_ACCEPTANCE", jobId: job.jobId, attempt: job.attempt, timeoutMs: 4000 }, 20000);
      } catch (e) {
        log(`acceptance poll #${poll}: tab unreachable (${e.message})`);
        continue;
      }
      if (res && res.submitAcceptedByFlow === true) {
        log(`acceptance poll #${poll}: ACCEPTED signal=${res.acceptanceSignal}`);
        return res.submitAcceptedAt || new Date().toISOString();
      }
      if (poll % 6 === 0) log(`acceptance poll #${poll}: still waiting for the user's Start generation click`);
      uiState = "AWAITING_USER_APPROVAL";
      render();
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  async function onApprove() {
    if (!currentJob) return;
    if (!["AWAITING_USER_APPROVAL", "PREPARED", "VALIDATED"].includes(currentJob.status)) {
      toast(`Công việc ở trạng thái ${currentJob.status} — không thể duyệt`, "warning");
      log(`approve refused: job status ${currentJob.status} is not approvable (idempotency guard)`);
      return;
    }
    try {
      log(`recording explicit APPROVE for ${currentJob.jobId} attempt ${currentJob.attempt}`);
      toast(T.toastCreating || "Đang tạo nội dung…", "info");
      setCtaLoading(true, T.ctaCreating);
      const approval = { jobId: currentJob.jobId, attempt: currentJob.attempt, approvedBy: "user" };
      if (lastApprovalSnapshot) {
        approval.nonce = lastApprovalSnapshot.nonce;
        approval.fingerprint = lastApprovalSnapshot.fingerprint;
        approval.snapshot = lastApprovalSnapshot;
      }
      // Hardening sweep (C-2): a lost-ACK retry must REUSE the bridge's still-
      // unused approval (same nonce) instead of silently re-arming the gate —
      // the bridge refuses an overwrite without an explicit supersede nonce.
      const priorApproval = currentJob.approval;
      const reusablePrior = priorApproval && priorApproval.used !== true && priorApproval.attempt === currentJob.attempt
        && (!approval.nonce || !priorApproval.nonce || priorApproval.nonce === approval.nonce)
        && (!approval.fingerprint || !priorApproval.fingerprint || priorApproval.fingerprint === approval.fingerprint);
      if (reusablePrior) {
        approval.nonce = approval.nonce || priorApproval.nonce;
        approval.fingerprint = approval.fingerprint || priorApproval.fingerprint;
        log(`reusing unused bridge approval (nonce=${approval.nonce || "legacy"}) — no re-record`);
      } else {
        if (priorApproval && priorApproval.used !== true && priorApproval.nonce && approval.nonce && priorApproval.nonce !== approval.nonce) {
          approval.supersedesNonce = priorApproval.nonce;
        }
        // POST-v1F: approve RECORDS the approval only. The job stays
        // AWAITING_USER_APPROVAL until the browser proves Google Flow accepted
        // the submit — a click alone proves nothing.
        const approved = await bridgeCall("POST", `/jobs/${encodeURIComponent(currentJob.jobId)}/approve?projectId=${encodeURIComponent(currentJob.projectId)}`, approval);
        log(`bridge approval recorded, status=${approved.status}`);
        currentJob.status = approved.status || currentJob.status;
        currentJob.approval = { ...approval, used: false };
      }
      await swMessage({ kind: "APPROVE_RECORD", approval: { ...approval } });
      if (approval.nonce) {
        // Durable submit-issued record (bridge hardening): idempotent for the
        // same nonce; a different unresolved submit is rejected — the second
        // credit action is blocked at the source, not by page heuristics.
        const issued = await bridgeCall("POST", `/jobs/${encodeURIComponent(currentJob.jobId)}/submit-issued?projectId=${encodeURIComponent(currentJob.projectId)}`, { approvalNonce: approval.nonce });
        log(`submit-issued recorded: status=${issued.status} at=${issued.submitIssuedAt || "already"}`);
      }
      const submitted = await tabRelay(
        { type: "SUBMIT_GENERATE", jobId: currentJob.jobId, attempt: currentJob.attempt, approval: { ...approval, approved: true } },
        180000
      );
      log(`submit issued at ${new Date().toISOString()} (issued=${Boolean(submitted && submitted.submitIssued)})`);
      const accepted = Boolean(submitted && submitted.submitAcceptedByFlow === true);
      let startedAt = null;
      let resultBaseline = null;
      if (accepted) {
        startedAt = submitted.submitAcceptedAt || submitted.at || new Date().toISOString();
        resultBaseline = (submitted && submitted.resultBaseline) || null;
        log(`submit accepted by Flow at ${startedAt} (signal=${submitted.acceptanceSignal}, confirmation=${(submitted.confirmation && submitted.confirmation.clicked) || "none"})`);
      } else {
        // POST-v1F: Google Flow ignores a synthetic click from a content
        // script. Never GENERATING, never poll, never spend the budget on a
        // submit Flow did not take — request the ONE trusted user gesture and
        // keep everything after it automated.
        log(
          `synthetic submit NOT accepted: code=${(submitted && submitted.code) || "unknown"} ` +
            `signal=${(submitted && submitted.acceptanceSignal) || "none"} ` +
            `confirmation=${((submitted && submitted.confirmation && submitted.confirmation.clicked) || "none")} ` +
            `observed=${JSON.stringify((submitted && submitted.acceptanceObserved) || null)}`
        );
        uiState = "AWAITING_USER_APPROVAL";
        toast("Bấm Start generation trong Google Flow để tiếp tục", "info", 0);
        log("awaiting the user's Start generation click in Google Flow (read-only poll)");
        render();
        startedAt = await awaitSubmitAcceptanceFromUser(currentJob);
        if (!startedAt) throw new Error("SUBMIT_NOT_ACCEPTED: user gesture never confirmed by Google Flow");
        log(`submit accepted by Flow at ${startedAt} (user gesture)`);
      }
      const generating = await bridgeCall("POST", `/jobs/${encodeURIComponent(currentJob.jobId)}/generate?projectId=${encodeURIComponent(currentJob.projectId)}`, { approvalNonce: (currentJob.approval && currentJob.approval.nonce) || (approval && approval.nonce) || undefined });
      log(`bridge generation started, status=${generating.status} generationCount=${generating.generationCount}`);
      currentJob.status = generating.status || "GENERATING";
      uiState = "GENERATING";
      render();
      await pollResultLoop(currentJob, startedAt, resultBaseline);
    } catch (e) {
      lastError = friendlyError(e);
      uiState = "ERROR_RETRYABLE";
      log(`approval/generation failed: ${JobCard && JobCard.errorText ? JobCard.errorText(e) : String((e && e.message) || e)}`);
      toast(`${T.errGenericTitle || "Có lỗi xảy ra."} ${JobCard && JobCard.errorText ? JobCard.errorText(e && e.message !== undefined ? e.message : e) : String((e && e.message) || e)}`, "error", 0);
      render();
    }
  }

  async function pollResultLoop(job, startedAt, resultBaseline = null) {
    const deadline = Date.now() + 10 * 60 * 1000;
    let attempt = 0;
    let unreachableStreak = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      await new Promise((r) => setTimeout(r, 5000));
      let read;
      try {
        // POST-v1E §28: correlate only NEW results against the pre-Generate
        // baseline (pre-existing media never matches this attempt).
        read = await tabRelay({ type: "READ_RESULT", baseline: resultBaseline }, 30000);
        unreachableStreak = 0;
      } catch (e) {
        // Hardening sweep (B-4): a closed/moved Flow tab is immediately
        // diagnosable — surface it instead of spinning "Đang xử lý" until the
        // 10-minute deadline with no message.
        unreachableStreak += 1;
        log(`result poll #${attempt}: tab unreachable (${e.message})`);
        if (unreachableStreak >= 3 || /FLOW_TAB_NOT_FOUND|NO_FLOW_TAB/.test(String((e && e.message) || ""))) {
          lastError = { title: "Mất kết nối với tab Google Flow.", body: "Mở lại tab Flow (cùng project) rồi bấm thử lại.", code: (e && e.message) || "FLOW_TAB_UNREACHABLE" };
          uiState = "NEED_FLOW";
          toast("Mất kết nối với tab Google Flow", "error", 0);
          render();
          return;
        }
        continue;
      }
      if (read && read.refusal && read.refusal.refused) {
        log(`provider refusal observed: ${read.refusal.kind} ${read.refusal.message || ""}`);
        lastError = { title: "Nhà cung cấp từ chối yêu cầu.", body: "Hãy điều chỉnh prompt rồi thử lại.", code: `${read.refusal.kind} ${read.refusal.message || ""}` };
        uiState = "BLOCKED";
        render();
        return;
      }
      const urls = (read && read.urls) || [];
      const fresh = Array.isArray(read && read.newUrls) ? read.newUrls : null;
      const candidates = fresh !== null ? fresh : urls;
      if (candidates.length === 0) {
        log(`result poll #${attempt}: GENERATING, no new result yet${fresh !== null ? " (baseline-filtered)" : ""}`);
        continue;
      }
      const detectedAt = (read && read.at) || new Date().toISOString();
      log(`RESULT_DETECTED at ${detectedAt} (started ${startedAt}), urls=${urls.length} new=${candidates.length}`);
      uiState = "PROCESSING";
      render();
      // POST-v1F §5: persist the exact candidate set NOW, while it is still
      // attributable, so a later resume/import can be gated on it.
      const rich = Array.isArray(read && read.candidates) ? read.candidates : [];
      const adoptable = rich.find((c) => c && c.isNew === true) || null;
      if (rich.length > 0) {
        try {
          const persisted = await bridgeCall("POST", `/jobs/${encodeURIComponent(job.jobId)}/result-candidates?projectId=${encodeURIComponent(job.projectId)}`, {
            candidates: rich,
            detectedAt,
            submitAcceptedAt: (currentJob && currentJob.submitAcceptedAt) || null,
          });
          log(`RESULT_CANDIDATES persisted: ${persisted.persisted} candidate(s) at ${detectedAt}`);
          currentJob = persisted.job || currentJob;
        } catch (e) {
          log(`result-candidates persist failed: ${e.message}`);
        }
      }
      if (!adoptable) {
        log("RESULT_CORRELATION_REQUIRED: no new candidate to adopt at RESULT_DETECTED");
        lastError = { title: "Không chứng minh được kết quả thuộc lần thử này.", body: "Không có ứng viên mới so với baseline.", code: "RESULT_CORRELATION_REQUIRED" };
        uiState = "ERROR_RETRYABLE";
        render();
        return;
      }
      await importResult(job, detectedAt, adoptable);
      return;
    }
    lastError = { title: T.errGenericTitle, body: "Hết thời gian chờ kết quả.", code: "RESULT_TIMEOUT" };
    uiState = "ERROR_RETRYABLE";
    log("RESULT_TIMEOUT: no result within 10 minutes (classified RESULT_TIMEOUT, no retry submitted)");
    toast("Hết thời gian chờ kết quả", "error", 0);
    render();
  }

  async function importResult(job, detectedAt, candidate) {
    try {
      toast(T.toastResult || "Đã tải kết quả", "info");
      // POST-v1F §4/§6: fetch the CORRELATED candidate, never "the first
      // media currently on the page".
      const picked = candidate || null;
      if (!picked || !picked.url) throw new Error("RESULT_CORRELATION_REQUIRED: no correlated candidate to import");
      const fetched = await tabRelay({ type: "FETCH_RESULT_BYTES", url: picked.url, candidateId: picked.candidateId }, 120000);
      if (!fetched || !fetched.ok) throw new Error((fetched && fetched.code) || "RESULT_NOT_DETECTED");
      log(`bytes fetched in-page for candidate ${picked.candidateId}: mime=${fetched.mime} bytes=${fetched.bytes}`);
      const promptFingerprint = await sha256Hex(job.prompt);
      const res = await bridgeCall("POST", `/jobs/${encodeURIComponent(job.jobId)}/artifact?projectId=${encodeURIComponent(job.projectId)}`, {
        filename: `flow-result.${fetched.mime === "video/mp4" ? "mp4" : fetched.mime === "video/webm" ? "webm" : fetched.mime === "image/jpeg" ? "jpg" : fetched.mime === "image/webp" ? "webp" : "png"}`,
        mime: fetched.mime,
        contentBase64: fetched.contentBase64,
        promptFingerprint,
        candidateId: picked.candidateId,
      });
      log(`DOWNLOADING → IMPORTED → READY: ${res.artifactPath} sha256=${res.sha256} bytes=${res.bytes}`);
      try {
        const dl = await tabRelay({ type: "TRIGGER_DOWNLOAD" }, 30000);
        log(`Flow Download-UI copy: ${dl && dl.ok ? "triggered" : (dl && dl.code) || "skipped"}`);
      } catch (e) {
        log(`Flow Download-UI copy skipped: ${e.message}`);
      }
      currentJob.status = "READY";
      lastResult = { artifactPath: res.artifactPath, sha256: res.sha256, detectedAt };
      uiState = "READY";
      toast(T.toastDone || "Đã hoàn tất", "success");
      toast(T.toastImported || "Đã nhập asset vào UNFOLDIQ", "success");
      render();
    } catch (e) {
      lastError = friendlyError(e);
      uiState = "ERROR_RETRYABLE";
      log(`import failed: ${e.message}`);
      toast(`${T.errGenericTitle || "Có lỗi xảy ra."}`, "error", 0);
      render();
    }
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function onProbeDom() {
    await guard("probe", async () => {
      try {
        log("DOM probe starting (metadata only — no prompt/media/account content collected)");
        const res = await tabRelay({ type: "PROBE_DOM", max: 60 }, 60000);
        if (!res || !res.ok) throw new Error("probe failed");
        const probe = res.probe;
        log(`DOM probe: ${probe.controls.length} candidates, truncated=${probe.truncated}`);
        log(`counts: ${JSON.stringify(probe.counts)}`);
        for (const c of probe.controls) log(`candidate: ${JSON.stringify(c)}`);
        toast("Đã cập nhật chẩn đoán giao diện", "success");
      } catch (e) {
        log(`DOM probe failed: ${e.message}`);
        toast(`Kiểm tra giao diện thất bại: ${e.message}`, "error", 0);
      }
    });
  }

  async function onApplyInstructions() {
    await guard("apply-instructions", async () => {
      try {
        // Observed identity only — the expected ref is never typed or guessed.
        const st = await tabRelay({ type: "GET_STATE" }, 30000);
        const ident = st && st.diagnostics && st.diagnostics.projectIdentity;
        const ref = ident && ident.available ? ident.providerProjectRef : null;
        if (!ref || ref === "UNKNOWN") throw new Error("BLOCKED_PROJECT_IDENTITY_UNKNOWN: mở đúng Flow project rồi thử lại");
        const reg = await bridgeCall("POST", `/instruction/apply?projectId=${encodeURIComponent(INSTRUCTION_PROJECT_ID)}`, { providerProjectRef: ref });
        log(`instruction apply registered: attempt=${reg.applyAttemptId} version=${reg.instructionVersion} binding=${reg.bindingState}${reg.previousSyncRef ? ` previousSync=${reg.previousSyncRef}` : ""}`);
        const ap = await tabRelay({
          type: "APPLY_AGENT_INSTRUCTIONS",
          providerProjectRef: ref,
          instructionSetId: reg.instructionSetId,
          instructionVersion: reg.instructionVersion,
          compiledText: reg.compiledText,
          referenceBindings: reg.referenceBindings || [],
          desiredFingerprint: reg.desiredFingerprint,
          applyAttemptId: reg.applyAttemptId,
        }, 120000);
        log(`instruction apply result: ok=${ap && ap.ok} status=${ap && ap.status} code=${ap && ap.code} detail=${ap && ap.detail} transport=${ap && ap.writeTransport} ackBasis=${ap && ap.ackBasis} appStateAck=${ap && ap.appStateAck} saveConfirmed=${ap && ap.saveConfirmed}`);
        if (ap && ap.agentMode) log(`instruction agentMode: ${JSON.stringify(ap.agentMode)}`);
        if (ap && ap.surface) {
          const s = ap.surface;
          log(`instruction surface: trigger=${s.agentInstructionsTrigger && s.agentInstructionsTrigger.status} editor=${s.instructionEditor && s.instructionEditor.status} done=${s.doneSaveControl && s.doneSaveControl.status} add=${s.addInstructionControl && s.addInstructionControl.status}`);
        }
        if (ap && ap.readback) log(`instruction readback-after-save: available=${ap.readback.available} reason=${ap.readback.reason || "n/a"}`);
        if (ap && ap.guidelines && ap.guidelines.writePath !== "none") log(`instruction strategies: ${JSON.stringify(ap.guidelines).slice(0, 400)}`);
        // FIX 03 §12: one hands-free chain — the evidence call carries the
        // post-reopen provider readback (ap.readback, provider-derived only,
        // never the attempted payload) plus non-secret transport metadata.
        // A failed/unacked apply reports FAILED honestly (sync never faked).
        const evBody = {
          syncId: reg.applyAttemptId,
          applyResult: {
            applyAttemptId: reg.applyAttemptId,
            status: ap && ap.ok ? "APPLIED" : "FAILED",
            appliedAt: ap && ap.appliedAt ? ap.appliedAt : new Date().toISOString(),
            automationMode: "HANDS_FREE",
            operatorTextEntry: false,
            writeTransport: (ap && ap.writeTransport) || null,
          },
        };
        if (ap && !ap.ok) evBody.applyResult.applyError = ap.code || "APPLY_FAILED";
        if (ap && ap.ok && ap.readback && ap.readback.available) {
          evBody.readback = {
            visibleGuidelines: ap.readback.text,
            providerReferences: ap.readback.referenceIds || [],
            readbackAt: ap.readback.readbackAt,
          };
        }
        lastInstructionApply = { projectId: INSTRUCTION_PROJECT_ID, syncId: reg.applyAttemptId, providerProjectRef: ref, applyStatus: evBody.applyResult.status, appliedAt: evBody.applyResult.appliedAt };
        const ev = await bridgeCall("POST", `/instruction/evidence?projectId=${encodeURIComponent(INSTRUCTION_PROJECT_ID)}`, evBody);
        log(`instruction sync: status=${ev.syncStatus} compare=${ev.semanticCompareStatus} verifiedAt=${ev.verifiedAt || "n/a"}`);
        if (ev.differences && ev.differences.length > 0) log(`instruction differences: ${JSON.stringify(ev.differences).slice(0, 500)}`);
        if (ev.syncStatus === "VERIFIED") {
          toast("Instructions VERIFIED hands-free (write → save → reopen → readback → MATCH)", "success", 8000);
        } else if (ap && ap.ok && ev.syncStatus === "READBACK_PENDING") {
          log(`readback unavailable post-reopen: ${(ap.readback && ap.readback.reason) || "unknown"}`);
          toast(`Apply APPLIED nhưng readback chưa xác nhận (${ev.syncStatus}). Bấm Đọc sau khi đóng/mở Agent Instructions.`, "warning", 8000);
        } else {
          toast(`Sync: ${ev.syncStatus} (${ev.semanticCompareStatus || "PENDING"})`, ev.syncStatus === "FAILED" ? "error" : "warning", 8000);
        }
        render();
      } catch (e) {
        log(`instruction apply failed: ${e.message}`);
        toast(`Apply instructions thất bại: ${e.message}`, "error", 0);
      }
    });
  }

  async function onReadInstructions() {
    await guard("read-instructions", async () => {
      try {
        log("instruction readback starting (visible provider state only — never the local payload)");
        const res = await tabRelay({ type: "READ_AGENT_INSTRUCTIONS" }, 30000);
        if (!res || !res.ok) throw new Error((res && (res.code || res.reason)) || "read failed");
        log(`instruction readback: project=${res.providerProjectRef} refs=${(res.providerReferences || []).length} at=${res.readbackAt}`);
        log(`instruction guidelines: ${res.visibleGuidelines}`);
        log(`instruction references: ${JSON.stringify(res.providerReferences || [])}`);
        // FIX 02 §§17–19: a readback following our own APPLIED attempt closes
        // the loop server-side (compare + transition + persist). Read-only
        // otherwise — no pending attempt, no evidence call.
        if (lastInstructionApply && lastInstructionApply.providerProjectRef === res.providerProjectRef) {
          const ev = await bridgeCall("POST", `/instruction/evidence?projectId=${encodeURIComponent(lastInstructionApply.projectId)}`, {
            syncId: lastInstructionApply.syncId,
            applyResult: { applyAttemptId: lastInstructionApply.syncId, status: lastInstructionApply.applyStatus, appliedAt: lastInstructionApply.appliedAt },
            readback: { visibleGuidelines: res.visibleGuidelines, providerReferences: res.providerReferences || [], readbackAt: res.readbackAt },
          });
          log(`instruction sync: status=${ev.syncStatus} compare=${ev.semanticCompareStatus} verifiedAt=${ev.verifiedAt || "n/a"}`);
          if (ev.differences && ev.differences.length > 0) log(`instruction differences: ${JSON.stringify(ev.differences).slice(0, 500)}`);
          toast(ev.syncStatus === "VERIFIED" ? "Instructions VERIFIED khớp provider" : `Sync: ${ev.syncStatus} (${ev.semanticCompareStatus})`, ev.syncStatus === "VERIFIED" ? "success" : "warning", 8000);
        } else {
          toast("Đã đọc instructions từ Flow", "success");
        }
      } catch (e) {
        log(`instruction readback failed: ${e.message}`);
        toast(`Đọc instructions thất bại: ${e.message}`, "error", 0);
      }
    });
  }

  async function onReject() {
    if (!currentJob) return;
    await guard("reject", async () => {
      try {
        await bridgeCall("POST", `/jobs/${encodeURIComponent(currentJob.jobId)}/cancel?projectId=${encodeURIComponent(currentJob.projectId)}`, {});
        log(`job ${currentJob.jobId} CANCELLED by user`);
        currentJob.status = "CANCELLED";
        uiState = "CANCELLED";
        toast(T.toastRejected || "Đã từ chối công việc", "info");
      } catch (e) {
        log(`reject failed: ${e.message}`);
        toast(`Từ chối thất bại: ${e.message}`, "error", 0);
      }
    });
  }

  /* ---------------- developer mode (persisted, non-secret) ---------------- */
  async function persistDevMode() {
    try {
      await chrome.storage.local.set({ flowCompanionDevMode: devMode === true });
    } catch (e) {
      void e;
    }
    if (devToolsSection) devToolsSection.hidden = !devMode;
    renderDevTools();
  }

  /* ---------------- wiring ---------------- */
  if (ctaBtn) ctaBtn.addEventListener("click", onPrimary);
  if (secondaryBtn) secondaryBtn.addEventListener("click", onReject);
  if (statusChip) statusChip.addEventListener("click", () => showSettings());
  const openSettingsBtn = $("open-settings");
  if (openSettingsBtn) openSettingsBtn.addEventListener("click", showSettings);
  const backBtn = $("back-main");
  if (backBtn) backBtn.addEventListener("click", showMain);
  if (devModeBox) devModeBox.addEventListener("change", () => {
    devMode = devModeBox.checked === true;
    persistDevMode();
  });
  const probeBtn = $("probe-dom");
  if (probeBtn) probeBtn.addEventListener("click", onProbeDom);
  const readBtn = $("read-instructions");
  if (readBtn) readBtn.addEventListener("click", onReadInstructions);
  const applyBtn = $("apply-instructions");
  if (applyBtn) applyBtn.addEventListener("click", onApplyInstructions);
  const forgetBtn = $("forget-token");
  if (forgetBtn) forgetBtn.addEventListener("click", () => guard("forget", onForgetToken));

  /* POST-v1E stall fix §7: recovery after BRIDGE_TOKEN_REQUIRED. Entering a
   * valid token must clear the latched bootstrap state and continue the
   * pipeline automatically — no panel reload, no infrastructure click. */
  let tokenRecoveryTimer = null;
  function onTokenInput() {
    const tokenField = $("bridge-token");
    if (!tokenField || !tokenField.value) return;
    if (tokenRecoveryTimer) clearTimeout(tokenRecoveryTimer);
    tokenRecoveryTimer = setTimeout(async () => {
      tokenRecoveryTimer = null;
      const tokenFailure = lastError && /BRIDGE_TOKEN_REQUIRED/i.test(String(lastError.code || ""));
      const needsRecovery = tokenFailure || !currentJob || uiState === "NEED_CONFIG" || uiState === "NEED_FLOW" || uiState === "ERROR_RETRYABLE";
      if (!needsRecovery) return;
      log("autoPrepare: bridge token entered — recovering without reload");
      if (preparer) preparer.reset();
      await guard("primary", runPipeline);
    }, 500);
  }
  const tokenField = $("bridge-token");
  if (tokenField) {
    tokenField.addEventListener("input", onTokenInput);
    tokenField.addEventListener("change", onTokenInput);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && viewSettings && !viewSettings.hidden) showMain();
  });

  // Static icons (decorative; buttons carry accessible labels).
  try {
    if (Icons) {
      if ($("settings-icon")) $("settings-icon").innerHTML = Icons.svg("settings");
      if ($("back-icon")) $("back-icon").innerHTML = Icons.svg("chevronLeft");
    }
  } catch (e) {
    void e;
  }
  try {
    const about = $("about-version");
    if (about) {
      const v = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "unknown";
      about.textContent = `UNFOLDIQ Flow Companion v${v}`;
    }
  } catch (e) {
    void e;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "DIAGNOSTICS_UPDATE" && msg.diagnostics) {
      lastDiagnostics = msg.diagnostics;
      renderDevTools();
    }
  });

  /* ---------------- auto-bootstrap: everything low-risk runs on open ---------------- */
  (async () => {
    try {
      const saved = await chrome.storage.local.get(["flowCompanionBridge", "flowCompanionDevMode"]);
      const s = saved && saved.flowCompanionBridge;
      if (s) {
        if (s.bridgeUrl) $("bridge-url").value = s.bridgeUrl;
        if (s.projectId) $("project-id").value = s.projectId;
        if (s.jobId) $("job-id").value = s.jobId;
      }
      // Remembered token: kept internal (never echoed back into the field);
      // the bootstrap pipeline below authenticates with it automatically.
      if (s && s.rememberToken === true && s.bridgeToken) {
        cfg.bridgeToken = s.bridgeToken;
        const box = $("remember-token");
        if (box) box.checked = true;
        const field = $("bridge-token");
        if (field) field.placeholder = "•••••••••••••• (đã nhớ trên thiết bị này)";
      }
      devMode = saved && saved.flowCompanionDevMode === true;
      // §12 fix: the checkbox, the section, and the devMode flag must agree —
      // a visible section with a stale "waiting" placeholder is what made the
      // diagnostics lie while ping=true.
      if (devModeBox) devModeBox.checked = devMode;
      if (devToolsSection) devToolsSection.hidden = !devMode;
    } catch (e) {
      void e;
    }
    uiState = "CONNECTING";
    render();
    await runPipeline();
  })();
})();
