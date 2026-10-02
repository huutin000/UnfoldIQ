"use strict";

/**
 * Flow Companion content-script command dispatcher (POST-v1B live run).
 * Pure and node-testable: operates on an adapter module + a DOM root.
 * NEVER touches the DOM directly — all page access goes through the
 * centralized flow-page-adapter. (This file must not contain direct DOM
 * access calls; FP15 enforces it.)
 *
 * Commands (all responses are plain JSON):
 *   PING                  → handshake + versions
 *   GET_STATE             → live diagnostics bundle
 *   GET_GENERATION_STATE  → POST-v1C read-only generation readiness (never clicks)
 *   INSERT_PROMPT_DRYRUN  → zero-credit prompt insert, never clicks Generate
 *   PREPARE_GENERATION    → POST-v1E stall fix: full zero-credit preparation
 *                           pipeline (prompt → STANDARD → IMAGE → 1:1 →
 *                           output=1 → model/cost → Generate verified)
 *   SUBMIT_GENERATE       → requires matching fresh approval, else throws
 *   READ_RESULT           → result URLs + refusal observation
 *   FETCH_RESULT_BYTES    → in-page fetch of first result URL → base64
 *   TRIGGER_DOWNLOAD      → clicks Flow's own Download control (if found)
 *   PROBE_DOM             → safe candidate-control metadata (no user content)
 */

// Build identity of THIS file. Reported by PING and by stale-approval errors so
// a live run can never be attributed to the wrong extension build.
const CONTENT_COMMANDS_VERSION = "0.4.11-postv1f-cmds2";

/**
 * POST-v1F: base64 without Node `Buffer` (a content script has none) and
 * without building one giant string — chunked so a 60 MB video stays cheap.
 */
function bytesToBase64(bytes) {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    let part = "";
    for (let j = 0; j < slice.length; j++) part += String.fromCharCode(slice[j]);
    binary += part;
  }
  return btoa(binary);
}

const COMMAND_TYPES = new Set([
  "PING",
  "GET_STATE",
  "GET_GENERATION_STATE",
  "INSERT_PROMPT_DRYRUN",
  "PREPARE_GENERATION",
  "SUBMIT_GENERATE",
  "AWAIT_SUBMIT_ACCEPTANCE",
  "READ_RESULT",
  "FETCH_RESULT_BYTES",
  "TRIGGER_DOWNLOAD",
  "READ_RESULT",
  "PROBE_DOM",
  "COMPOSER_PROBE",
]);

// POST-v1F: baselines for the read-only acceptance poll, keyed by job+attempt.
const AWAIT_BASELINES = new Map();
const acceptancePolls = new Map();

function checkCommand(msg) {
  if (!msg || typeof msg !== "object") throw new Error("SCHEMA_INVALID: command must be an object");
  if (!COMMAND_TYPES.has(msg.type)) throw new Error(`SCHEMA_INVALID: unknown command ${msg.type}`);
  return true;
}

function checkApproval(approval, jobId, attempt) {
  if (!approval || approval.approved !== true) {
    throw new Error("APPROVAL_REQUIRED: no generation before explicit approval");
  }
  if (approval.jobId !== jobId || approval.attempt !== attempt) {
    throw new Error("APPROVAL_MISMATCH: approval must match jobId+attempt");
  }
  if (approval.used === true) throw new Error("APPROVAL_REQUIRED: approval already consumed");
  return true;
}

/**
 * POST-v1E §24 revalidation (adapter-mediated, no direct DOM here).
 * Compares live Flow state against the frozen approval snapshot:
 * same prompt visible, IMAGE, aspect/outputs/model/cost unchanged,
 * Generate present + enabled. Returns { ok, changed[] }.
 */
async function revalidateBeforeGenerate(adapter, root, snapshot) {
  const changed = [];
  if (!snapshot || typeof snapshot !== "object") return { ok: false, changed: ["SNAPSHOT_MISSING"] };
  const promptChanged = () => {
    try {
      const promptEl = typeof adapter.detectPromptControl === "function" ? adapter.detectPromptControl(root) : null;
      const pv = promptEl && typeof adapter.verifyPromptContent === "function"
        ? adapter.verifyPromptContent(promptEl, snapshot.prompt || "")
        : { verified: false };
      return !pv.verified;
    } catch {
      return true;
    }
  };
  const generateChanged = () => {
    try {
      const gen = typeof adapter.detectGenerateButton === "function" ? adapter.detectGenerateButton(root) : { found: false, enabled: false };
      return !gen.found || !gen.enabled;
    } catch {
      return true;
    }
  };
  // POST-v1F: AGENT mode freezes aspect/output/model from the Agent Settings
  // surface, not from composer controls. Comparing with the Standard readers
  // would report UNKNOWN and invalidate a fresh approval (APPROVAL_STALE_CHANGED).
  let agent = null;
  let agentError = null;
  try {
    agent = typeof adapter.readAgentMaterial === "function" ? await adapter.readAgentMaterial(root) : "MISSING_ADAPTER_FN";
  } catch (e) {
    agent = null;
    // Never swallow silently: a failed Agent read silently downgrades to the
    // Standard path, which then reports four bogus "changed" fields.
    agentError = String((e && e.message) || e).split(":")[0];
  }
  if (!agentError && !agent) agentError = "NO_AGENT_SURFACE";
  if (agent === "MISSING_ADAPTER_FN") agentError = "MISSING_ADAPTER_FN";
  // POST-v1F: the Agent read can explain WHY it refused — surface it instead of
  // degrading to a Standard comparison that reports four bogus "changed" fields.
  if (agent && agent.surfaceFound === false && agent.code) agentError = agent.code;
  if (agent && agent.surfaceFound) {
    if (promptChanged()) changed.push("prompt");
    if (String(agent.aspect) !== String(snapshot.aspect === undefined || snapshot.aspect === null ? "UNKNOWN" : snapshot.aspect)) changed.push("aspect");
    if (String(agent.outputCount) !== String(snapshot.outputCount === undefined || snapshot.outputCount === null ? "UNKNOWN" : snapshot.outputCount)) changed.push("outputCount");
    if (String(agent.model) !== String(snapshot.model === undefined || snapshot.model === null ? "UNKNOWN" : snapshot.model)) changed.push("model");
    if (generateChanged()) changed.push("generate");
    return { ok: changed.length === 0, changed, flowMode: "AGENT", agentMaterial: agent };
  }
  try {
    if (promptChanged()) changed.push("prompt");
  } catch {
    changed.push("prompt");
  }
  try {
    const gt = typeof adapter.detectGenerationType === "function" ? adapter.detectGenerationType(root) : { type: "UNKNOWN" };
    if (gt.type !== (snapshot.type || "IMAGE")) changed.push("type");
  } catch {
    changed.push("type");
  }
  const current = {};
  try {
    current.aspect = typeof adapter.readAspectSetting === "function" ? adapter.readAspectSetting(root) || "UNKNOWN" : "UNKNOWN";
  } catch {
    current.aspect = "UNKNOWN";
  }
  try {
    const oc = typeof adapter.readOutputCount === "function" ? adapter.readOutputCount(root) : { value: null };
    current.outputCount = oc.value === null ? "UNKNOWN" : oc.value;
  } catch {
    current.outputCount = "UNKNOWN";
  }
  try {
    current.model = typeof adapter.readModelLabel === "function" ? adapter.readModelLabel(root) || "UNKNOWN" : "UNKNOWN";
  } catch {
    current.model = "UNKNOWN";
  }
  try {
    current.visibleCost = typeof adapter.readCreditCost === "function" ? adapter.readCreditCost(root) || "UNKNOWN" : "UNKNOWN";
  } catch {
    current.visibleCost = "UNKNOWN";
  }
  for (const f of ["aspect", "outputCount", "model", "visibleCost"]) {
    if (String(current[f]) !== String(snapshot[f] === undefined || snapshot[f] === null ? "UNKNOWN" : snapshot[f])) changed.push(f);
  }
  try {
    const gen = typeof adapter.detectGenerateButton === "function" ? adapter.detectGenerateButton(root) : { found: false, enabled: false };
    if (!gen.found || !gen.enabled) changed.push("generate");
  } catch {
    changed.push("generate");
  }
  return { ok: changed.length === 0, changed, agentError };
}

/**
 * POST-v1E.2F - AGENT-mode preparation path. No Image/Video generation-type
 * switch exists here: Agent routes by prompt and uses configured defaults.
 * Readiness = prompt verified + flowMode AGENT verified + requestedCapability
 * IMAGE + confirmation ALWAYS + image aspect + image outputs + Start control
 * found and enabled. Model is informational. Never clicks Start generation.
 */
async function dispatchAgentPreparation(adapter, root, msg, { modeResult, probeLogs, stages }) {
  stages.flowMode = "AGENT";
  const requestedCapability = String(msg.capability || "image").toUpperCase();
  const agent = await adapter.prepareAgentSettings(root, {
    confirmationPolicy: "ALWAYS", // ASSISTED_APPROVAL: Flow must never auto-generate
    aspectRatio: msg.aspectRatio || "1:1",
    outputCount: Number(msg.outputCount) || 1,
  });
  if (Array.isArray(agent.probeLog)) probeLogs.push(...agent.probeLog);
  stages.agentSettings = agent.verified ? "VERIFIED" : agent.code || "FAILED";
  if (!agent.verified) {
    return { ok: true, prepared: false, stage: "agent-settings", code: agent.code || "AGENT_SETTINGS_NOT_VERIFIED", flowMode: modeResult, agentSettings: agent, probeLogs, stages };
  }
  // Readiness gate (Agent mode): no generationType=IMAGE requirement.
  const gen = adapter.detectGenerateButton(root);
  const missing = [];
  if (!gen.found) missing.push("GENERATE_CONTROL_NOT_FOUND");
  else if (!gen.enabled) missing.push("GENERATE_STILL_DISABLED_AFTER_PROMPT");
  const generationState = {
    ready: missing.length === 0,
    missing,
    checks: {
      promptVerified: true,
      flowMode: "AGENT",
      requestedCapability,
      agentConfirmation: agent.confirmation,
      imageAspect: agent.aspect,
      imageOutputCount: agent.outputCount,
      generateFound: gen.found,
      generateEnabled: gen.enabled,
    },
    details: {
      modelLabel: agent.modelLabel || "UNKNOWN",
      aspect: agent.aspect,
      outputCount: agent.outputCount,
      visibleCreditCost: "UNKNOWN",
    },
    clickedGenerate: false,
    creditsConsumed: false,
  };
  return {
    ok: true,
    prepared: generationState.ready === true,
    stage: "readiness",
    code: generationState.ready === true ? null : "GENERATION_NOT_READY",
    missing: generationState.missing || [],
    flowMode: modeResult,
    requestedCapability,
    stages,
    generationRoute: { mode: "AGENT", capability: requestedCapability, verified: agent.verified === true },
    agentSettings: agent,
    generationState,
    settings: { generationType: "NOT_APPLICABLE", aspect: agent.aspect, outputCount: agent.outputCount, model: agent.modelLabel || "UNKNOWN", visibleCost: "UNKNOWN" },
    generate: { found: gen.found, enabled: gen.enabled },
    clickedGenerate: false,
    creditsConsumed: false,
  };
}

async function dispatchContentCommand(adapter, root, msg, ctx = {}) {
  checkCommand(msg);
  const extVersion = ctx.extensionVersion || "unknown";
  switch (msg.type) {
    case "PING":
      return { ok: true, adapterVersion: adapter.ADAPTER_VERSION, commandsVersion: CONTENT_COMMANDS_VERSION, extensionVersion: extVersion };
    case "GET_STATE": {
      const diag = adapter.buildLiveDiagnostics(root, {
        extensionVersion: extVersion,
        flowOrigin: ctx.flowOrigin || null,
        contentScriptInjected: true,
        bridgeReachable: ctx.bridgeReachable ?? null,
        currentJobId: msg.jobId || null,
        jobState: msg.jobState || null,
        lastError: null,
      });
      return { ok: true, diagnostics: diag };
    }
    case "GET_GENERATION_STATE": {
      // POST-v1C read-only readiness probe. Never inserts, never clicks.
      // promptVerified comes from the caller's last verified dry-run
      // observation; approvalState from the bridge job status mapping.
      const generationState =
        typeof adapter.assessGenerationReady === "function"
          ? adapter.assessGenerationReady(root, {
              promptVerified: msg.promptVerified === true,
              approvalState: msg.approvalState || "UNKNOWN",
            })
          : { ready: false, missing: ["GENERATION_READY_UNSUPPORTED"], checks: {}, details: {} };
      return { ok: true, generationState, clickedGenerate: false, creditsConsumed: false };
    }
    case "INSERT_PROMPT_DRYRUN": {
      if (typeof msg.prompt !== "string" || msg.prompt.length === 0) {
        throw new Error("SCHEMA_INVALID: prompt required");
      }
      // Capability-scoped readiness (fix FLOW_PAGE_NOT_READY): dry-run requires
      // ONLY PROMPT_READY (found + writable) + Generate control found.
      // Disabled Generate before prompt insertion is ALLOWED. Optional controls
      // (MODE_*, MODEL_CONTROL, OUTPUT_COUNT, CREDIT_DISPLAY, RESULT_*,
      // DOWNLOAD_CONTROL) are deliberately NOT part of DRY_RUN_READY.
      const readiness = adapter.assessDryRunReadiness(root);
      if (!readiness.prompt.found) {
        return { ok: false, code: "PROMPT_INPUT_NOT_FOUND", readiness };
      }
      if (!readiness.prompt.writable) {
        return { ok: false, code: "PROMPT_INPUT_NOT_WRITABLE", readiness };
      }
      if (!readiness.generate.found) {
        return { ok: false, code: "GENERATE_CONTROL_NOT_FOUND", readiness };
      }
      let evidence;
      try {
        evidence = adapter.insertPromptDryRun(root, msg.prompt);
      } catch (e) {
        return { ok: false, code: "PROMPT_INSERT_FAILED", detail: String((e && e.message) || e), readiness };
      }
      if (!evidence.verified) {
        return { ok: false, code: "PROMPT_VERIFY_FAILED", readiness, dryRun: evidence };
      }
      // Record Generate enabled/disabled AFTER insertion. Still-disabled is an
      // observation (settings may need resolution), never a dry-run failure.
      // POST-v1C: attach the read-only generation-state snapshot (honest
      // UNKNOWNs, never fabricated from job metadata).
      const gen = evidence.generate || adapter.detectGenerateButton(root);
      let generationState = null;
      try {
        generationState =
          typeof adapter.assessGenerationReady === "function"
            ? adapter.assessGenerationReady(root, { promptVerified: evidence.verified === true, approvalState: "UNKNOWN" })
            : null;
      } catch {
        generationState = null;
      }
      return {
        ok: true,
        readiness: { PROMPT_READY: "PASS", DRY_RUN_READY: "PASS" },
        dryRun: {
          ...evidence,
          generateEnabledAfterPrompt: gen.enabled === true,
          generateStillDisabledAfterPrompt: gen.enabled !== true ? "GENERATE_STILL_DISABLED_AFTER_PROMPT" : null,
          generationState,
          clickedGenerate: false,
          creditsConsumed: false,
        },
      };
    }
    case "PREPARE_GENERATION": {
      // POST-v1E stall fix (§4, §15): the ONLY normal-mode preparation
      // pipeline. Zero-credit: inserts the prompt, ensures STANDARD mode,
      // selects IMAGE, 1:1, output=1 (each verified by re-reading live
      // state), reads model/cost, and verifies Generate is enabled.
      // STOPS before Generate — never clicks it. Every failure returns a
      // precise per-stage code (§17), never a generic PREPARATION_FAILED.
      if (typeof msg.prompt !== "string" || msg.prompt.length === 0) {
        throw new Error("SCHEMA_INVALID: prompt required");
      }
      const stages = {};
      const probeLogs = [];
      // Stage: prompt-composer — the composer mounts asynchronously after a
      // UI transition (live race, POST-v1E FIX 02). Wait for it on fresh DOM
      // (MutationObserver) instead of failing on the first lookup.
      const composerWait = await adapter.waitForPromptComposer(root, {
        timeoutMs: Number(msg.composerTimeoutMs) || adapter.FLOW_COMPOSER_READY_TIMEOUT_MS,
      });
      if (!composerWait.ready) {
        return {
          ok: true,
          prepared: false,
          stage: "prompt-composer",
          code: "FLOW_COMPOSER_READY_TIMEOUT",
          detail: `composer not mounted within ${composerWait.elapsedMs}ms (while waiting: FLOW_COMPOSER_NOT_READY)`,
          elapsedMs: composerWait.elapsedMs,
          stages,
        };
      }
      stages.promptComposer = composerWait.waited ? `READY_WAITED_${composerWait.elapsedMs}ms` : "READY";
      // Stage: prompt — verified insertion on the live composer (FIX 03,
      // POST-v1E.1). Normalized EXACT comparison, structured evidence, one
      // safe insertion retry, precise codes. No raw prompt on success paths.
      const readiness = adapter.assessDryRunReadiness(root);
      if (!readiness.prompt.found) return { ok: true, prepared: false, stage: "prompt", code: "PROMPT_INPUT_NOT_FOUND", stages };
      if (!readiness.prompt.writable) return { ok: true, prepared: false, stage: "prompt", code: "PROMPT_INPUT_NOT_WRITABLE", stages };
      const readObservedRaw = () => {
        try {
          const r = adapter.resolvePromptComposer(root);
          return r && r.editor ? adapter.readPromptEditorText(r.editor) : "";
        } catch {
          return "";
        }
      };
      // POST-v1E.2G P0 - mismatch readback diagnostic: raw textContent vs
      // logical reconstruction (BR/blocks -> newlines) so a dropped <br> in
      // textContent is distinguishable from a writer that truly failed to
      // insert the newline. Failure paths only.
      const promptReadback = () => {
        try {
          const r = adapter.resolvePromptComposer(root);
          const ed = r && r.editor;
          if (!ed) return null;
          const textContent = typeof ed.textContent === "string" ? ed.textContent : null;
          const innerText = typeof ed.innerText === "string" ? ed.innerText : null;
          const logicalText = adapter.readContentEditableLogicalText(ed);
          return {
            textContent: JSON.stringify(textContent === null ? "" : textContent),
            innerText: JSON.stringify(innerText === null ? "" : innerText),
            logicalText: JSON.stringify(logicalText),
            logicalLength: logicalText.length,
            domShape: adapter.domShapeOf(ed),
          };
        } catch {
          return null;
        }
      };
      const promptInsert = {
        inserted: false,
        editorType: null,
        strategy: null,
        beforeLength: null,
        expectedLength: null,
        observedLength: null,
        fingerprintMatch: false,
        editorReplaced: false,
        stable: false,
        verified: false,
        elapsedMs: 0,
        attempts: 0,
      };
      const MAX_ATTEMPTS = 2; // insertion itself + at most one safe retry
      let insertInfo = null;
      let verify = null;
      let lastCode = "PROMPT_INSERT_FAILED";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        promptInsert.attempts = attempt;
        try {
          insertInfo = adapter.insertPromptText(root, msg.prompt);
        } catch (e) {
          // Keep the deeper failure code if a verify already ran this stage.
          if (!verify) lastCode = String((e && e.message) || e).split(":")[0] || "PROMPT_INSERT_FAILED";
          break;
        }
        promptInsert.editorType = insertInfo.editorType;
        promptInsert.strategy = insertInfo.strategy;
        promptInsert.beforeLength = insertInfo.beforeLength;
        if (insertInfo.afterObservedLength === 0) {
          // Case A: insertion mechanism changed nothing — allow one retry.
          if (!verify) lastCode = "PROMPT_INSERT_FAILED";
          continue;
        }
        promptInsert.inserted = true;
        stages.prompt = "INSERTED";
        verify = await adapter.waitForPromptValue(root, msg.prompt, {
          timeoutMs: Number(msg.promptVerifyTimeoutMs) || adapter.FLOW_PROMPT_VERIFY_TIMEOUT_MS,
          pollMs: Number(msg.promptVerifyPollMs) || 250,
          originalEditor: insertInfo.insertedEditor,
        });
        promptInsert.expectedLength = verify.expectedLength;
        promptInsert.observedLength = verify.observedLength;
        promptInsert.fingerprintMatch = verify.fingerprintMatch === true;
        promptInsert.editorReplaced = verify.editorReplaced === true;
        promptInsert.elapsedMs = verify.elapsedMs || 0;
        if (verify.matched) {
          lastCode = null;
          break;
        }
        lastCode = verify.observedLength > 0 ? "PROMPT_TEXT_MISMATCH" : verify.editorReplaced ? "PROMPT_EDITOR_REPLACED_EMPTY" : "PROMPT_VERIFY_TIMEOUT";
      }
      if (lastCode !== null) {
        // POST-v1E.1: failure carries the full comparison evidence (raw values
        // JSON.stringify'd, first differing index, code points) so the next
        // live run pins the cause instead of guessing.
        const mismatch = adapter.diffPromptText(msg.prompt, readObservedRaw());
        return { ok: true, prepared: false, stage: "prompt", code: lastCode, promptInsert, mismatch, promptReadback: promptReadback(), stages };
      }
      promptInsert.verified = true;
      // §15: verify Flow actually kept the prompt (did not immediately revert).
      const stability = await adapter.confirmPromptStable(root, msg.prompt, {
        stabilityMs: Number(msg.promptStabilityMs) || adapter.FLOW_PROMPT_STABILITY_MS,
        originalEditor: insertInfo ? insertInfo.insertedEditor : null,
      });
      promptInsert.stable = stability.stable === true;
      promptInsert.observedLength = stability.observedLength;
      if (!stability.stable) {
        return { ok: true, prepared: false, stage: "prompt", code: "PROMPT_APP_STATE_NOT_COMMITTED", promptInsert, mismatch: adapter.diffPromptText(msg.prompt, readObservedRaw()), promptReadback: promptReadback(), stages };
      }
      stages.prompt = "PASS";
      // Stage: flow-mode routing (POST-v1E.2F). AGENT mode has NO Image/Video
      // generation-type switch: Agent routes by prompt and uses configured
      // defaults. STANDARD keeps the existing pipeline unchanged.
      const modeResult = await adapter.resolveFlowMode(root, {});
      stages.flowMode = modeResult.value;
      if (Array.isArray(modeResult.probeLog)) probeLogs.push(...modeResult.probeLog);
      if (modeResult.value === "UNKNOWN" || modeResult.verified !== true) {
        return { ok: true, prepared: false, stage: "flow-mode", code: "FLOW_MODE_UNKNOWN", flowMode: modeResult, probeLogs, stages };
      }
      if (modeResult.value === "AGENT") {
        return await dispatchAgentPreparation(adapter, root, msg, { modeResult, probeLogs, stages });
      }
      // Stage: standard mode — never enables Agent; one bounded toggle-off.
      let standard;
      try {
        standard = adapter.ensureStandardMode(root);
      } catch (e) {
        return { ok: true, prepared: false, stage: "standard-mode", code: "AGENT_MODE_DETECTED", detail: String((e && e.message) || e), stages };
      }
      if (!standard.standard) {
        return { ok: true, prepared: false, stage: "standard-mode", code: standard.code || "AGENT_MODE_DETECTED", detail: standard.message || null, stages };
      }
      stages.standardMode = "PASS";
      // Stage: generation type = IMAGE — POST-v1E.2 live resolver: trigger
      // discovery scoped to the composer, verified menu, exact-name choice,
      // mandatory post-click state verification. Precise per-stage codes.
      let typeSelected;
      try {
        typeSelected = await adapter.selectGenerationType(root, "IMAGE");
      } catch (e) {
        return {
          ok: true,
          prepared: false,
          stage: "generation-type",
          code: String((e && e.message) || e).split(":")[0] || "GENERATION_TYPE_NOT_VERIFIED",
          detail: e && e.diagnostics ? JSON.stringify(e.diagnostics) : e && e.evidence ? JSON.stringify(e.evidence) : String((e && e.message) || e),
          probeLogs: probeLogs.concat((e && e.probeLog) || []),
          stages,
        };
      }
      stages.generationType = typeSelected.type;
      // Stage: aspect 1:1 — only where the live UI exposes the control.
      let aspect = "UNKNOWN";
      if (adapter.queryWithFallback(root, "ASPECT_CONTROL").el) {
        try {
          aspect = adapter.selectAspect(root, "1:1").aspect;
        } catch (e) {
          return { ok: true, prepared: false, stage: "aspect", code: String((e && e.message) || e).split(":")[0] || "TARGET_ASPECT_NOT_AVAILABLE", detail: String((e && e.message) || e), stages };
        }
      }
      stages.aspect = aspect;
      // Stage: output count = 1 — only where the live UI exposes the control.
      let outputCount = "UNKNOWN";
      if (adapter.queryWithFallback(root, "OUTPUT_COUNT").el) {
        try {
          outputCount = adapter.selectOutputCount(root, 1).outputCount;
        } catch (e) {
          return { ok: true, prepared: false, stage: "output-count", code: String((e && e.message) || e).split(":")[0] || "OUTPUT_COUNT_NOT_AVAILABLE", detail: String((e && e.message) || e), stages };
        }
      }
      stages.outputCount = outputCount;
      // Stage: readiness — approval is expected to be pending here (the
      // bridge transition happens only after readiness), so
      // APPROVAL_NOT_RECORDED is not a missing condition at this stage.
      const generationState =
        typeof adapter.assessGenerationReady === "function"
          ? adapter.assessGenerationReady(root, {
              promptVerified: true,
              approvalState: msg.approvalState || "PREPARING",
              approvalPendingExpected: true,
            })
          : { ready: false, missing: ["GENERATION_READY_UNSUPPORTED"], checks: {}, details: {} };
      const gen = adapter.detectGenerateButton(root);
      stages.generationReadiness = generationState.ready === true ? "PASS" : generationState.missing.join(",");
      return {
        ok: true,
        prepared: generationState.ready === true,
        stage: "readiness",
        code: generationState.ready === true ? null : "GENERATION_NOT_READY",
        missing: generationState.missing || [],
        stages,
        composerWait: { waited: composerWait.waited === true, elapsedMs: composerWait.elapsedMs || 0 },
        promptInsert,
        generationState,
        generationType: {
          value: typeSelected.value,
          verified: typeSelected.verified === true,
          verificationSources: (typeSelected.evidence || []).map((x) => x.source),
          evidence: typeSelected.evidence || [],
          trigger: typeSelected.trigger,
          menu: typeSelected.menu,
          detection: typeSelected.detection,
          switch: typeSelected.switch,
        },
        probeLogs: probeLogs.concat(typeSelected.probeLog || []),
        settings: {
          generationType: typeSelected.type,
          aspect,
          outputCount,
          model: (generationState.details && generationState.details.modelLabel) || "UNKNOWN",
          visibleCost: (generationState.details && generationState.details.visibleCreditCost) || "UNKNOWN",
        },
        generate: { found: gen.found, enabled: gen.enabled },
        clickedGenerate: false,
        creditsConsumed: false,
      };
    }
    case "SUBMIT_GENERATE": {
      checkApproval(msg.approval, msg.jobId, msg.attempt);
      // POST-v1E §24: revalidate immediately before Generate when the
      // approval carries a snapshot. Any material change (prompt, type,
      // aspect, outputs, model, cost) STOPS the submit and requires a
      // fresh approval — never a silent second attempt.
      if (msg.approval && msg.approval.snapshot) {
        const reval = await revalidateBeforeGenerate(adapter, root, msg.approval.snapshot);
if (!reval.ok) {
        const err = new Error(
          `APPROVAL_STALE_CHANGED: ${reval.changed.join(",")} [cmds=${CONTENT_COMMANDS_VERSION} agent-read=${reval.agentError || "ok"}]`
        );
        err.changed = reval.changed;
        throw err;
      }
      }
      // Disabled Generate is never clicked, even with approval.
      const preState = typeof adapter.detectGenerateButton === "function" ? adapter.detectGenerateButton(root) : { found: true, enabled: true };
      if (!preState.found) throw new Error("GENERATE_CONTROL_NOT_FOUND: Generate disappeared before submit");
      if (!preState.enabled) throw new Error("GENERATE_STILL_DISABLED_AFTER_PROMPT: Generate disabled at submit time");
      const baseline = typeof adapter.captureResultBaseline === "function" ? adapter.captureResultBaseline(root) : null;
      let submitBaseline = null;
      const res = adapter.submitAfterApproval(root, {
        approved: true,
        // POST-v1F: the acceptance baseline MUST be captured BEFORE the click,
        // otherwise every acceptance signal looks pre-existing.
        beforeSubmit: () => {
          if (typeof adapter.captureSubmitBaseline === "function") submitBaseline = adapter.captureSubmitBaseline(root);
        },
      });
      // POST-v1F: positive submit-acceptance handshake. Start was CLICKED; that
      // proves nothing. Until the page shows acceptance evidence the caller must
      // NOT treat the job as GENERATING and must NOT poll for results.
      let acceptance = { accepted: false, code: "SUBMIT_HANDSHAKE_UNSUPPORTED" };
      if (typeof adapter.awaitSubmitAcceptance === "function") {
        try {
          acceptance = await adapter.awaitSubmitAcceptance(root, {
            baseline: submitBaseline,
            timeoutMs: Number(msg.acceptTimeoutMs) || 15000,
          });
        } catch (e) {
          acceptance = { accepted: false, code: String((e && e.message) || e).split(":")[0] };
        }
      }
      // POST-v1F: the click was issued but Flow did not accept it. Ask for the
      // one trusted user gesture instead of failing the whole run.
      if (!acceptance.accepted) AWAIT_BASELINES.set(`${msg.jobId || "?"}|${msg.attempt || "?"}`, submitBaseline);
      return {
        ok: true,
        submitted: res.submitted === true,
        submitIssued: true,
        submitAcceptedByFlow: acceptance.accepted === true,
        submitAcceptedAt: acceptance.accepted ? acceptance.at : null,
        acceptanceSignal: acceptance.signal || null,
        acceptanceObserved: acceptance.observed || null,
        confirmation: { clicked: acceptance.confirmClicked || null },
        code: acceptance.accepted ? null : acceptance.code,
        at: new Date().toISOString(),
        resultBaseline: baseline,
      };
    }
    case "AWAIT_SUBMIT_ACCEPTANCE": {
      // POST-v1F: read-only. Google Flow does not act on a synthetic
      // HTMLElement.click() from a content script (proven live: drawer closed,
      // composer visible, Start enabled, prompt in BOTH the DOM and the
      // ProseMirror model — yet no acceptance signal). The ONE trusted user
      // gesture is therefore requested, and everything after it stays
      // automated. This command NEVER clicks; it only observes.
      if (typeof adapter.awaitSubmitAcceptance !== "function") return { ok: false, code: "ACCEPTANCE_PROBE_UNSUPPORTED" };
      const key = `${msg.jobId || "?"}|${msg.attempt || "?"}`;
      if (!AWAIT_BASELINES.has(key)) {
        AWAIT_BASELINES.set(key, adapter.captureSubmitBaseline(root));
        acceptancePolls.set(key, 0);
      }
      acceptancePolls.set(key, (acceptancePolls.get(key) || 0) + 1);
      const poll = Number(msg.timeoutMs) || 4000;
      const res = await adapter.awaitSubmitAcceptance(root, { baseline: AWAIT_BASELINES.get(key), timeoutMs: poll, pollMs: 400, mayClick: false });
      return { ok: true, poll: acceptancePolls.get(key), submitAcceptedByFlow: res.accepted === true, submitAcceptedAt: res.at, acceptanceSignal: res.signal || null, acceptanceObserved: res.observed || null, code: res.accepted ? null : res.code };
    }
    case "READ_RESULT": {
      const urls = adapter.detectResults(root);
      const refusal = adapter.detectRefusal(root);
      // POST-v1E §28: when the caller passes the pre-Generate baseline,
      // only NEW results correlate to this attempt (pre-existing ignored).
      let newUrls = null;
      if (msg.baseline && typeof adapter.diffNewResults === "function") {
        newUrls = adapter.diffNewResults(msg.baseline, urls);
      }
      // POST-v1F §5: the exact candidate set, with the identity/geometry/turn
      // evidence the bridge persists so a later resume can still prove
      // correlation instead of re-reading whatever is on the page.
      let candidates = null;
      if (typeof adapter.collectResultCandidates === "function") {
        try {
          candidates = adapter.collectResultCandidates(root, {
            baselineUrls: msg.baseline && msg.baseline.urls ? msg.baseline.urls : [],
            promptNeedle: msg.promptNeedle || "",
          });
        } catch {
          candidates = null;
        }
      }
      return { ok: true, urls, newUrls, candidates, refusal, at: new Date().toISOString() };
    }
    case "FETCH_RESULT_BYTES": {
      // POST-v1F §6: bytes are fetched for an EXPLICIT, already-correlated
      // candidate. Taking "the first URL currently on the page" is exactly how
      // a 32x32 account avatar got imported as the generated result.
      const target = String(msg.url || "");
      if (!target) return { ok: false, code: "RESULT_CORRELATION_REQUIRED: no correlated candidate url provided" };
      const fetchImpl = ctx.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
      if (!fetchImpl) throw new Error("FETCH_UNAVAILABLE: no fetch implementation in this context");
      const maxBytes = ctx.maxBytes || 60 * 1024 * 1024;
      const resp = await fetchImpl(target, { credentials: "include" });
      if (!resp || typeof resp.arrayBuffer !== "function") throw new Error("FETCH_FAILED: bad response");
      // POST-v1F: a content script has NO Node `Buffer`. The live run failed
      // here with "Buffer is not defined" AFTER the generation had succeeded.
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (bytes.length === 0 || bytes.length > maxBytes) throw new Error(`ARTIFACT_SIZE_REJECTED: ${bytes.length} bytes`);
      const mime = (resp.headers && typeof resp.headers.get === "function" && resp.headers.get("content-type")) || msg.mime || "application/octet-stream";
      return { ok: true, url: target, mime: String(mime).split(";")[0].trim(), contentBase64: bytesToBase64(bytes), bytes: bytes.length };
    }
    case "TRIGGER_DOWNLOAD": {
      const found = adapter.detectDownloadControl(root);
      if (!found.found) return { ok: false, code: "DOWNLOAD_CONTROL_NOT_FOUND", fallbackUsed: false };
      const el = adapter.queryWithFallback(root, "DOWNLOAD_CONTROL").el;
      if (el && typeof el.click === "function") el.click();
      return { ok: true, clicked: true, fallbackUsed: found.fallbackUsed };
    }
    case "PROBE_DOM": {
      if (typeof adapter.probeCandidateControls !== "function") {
        throw new Error("SCHEMA_INVALID: probe unavailable in this adapter build");
      }
      return { ok: true, probe: adapter.probeCandidateControls(root, { max: msg.max || 60 }) };
    }
    case "COMPOSER_PROBE": {
      // POST-v1E FIX 02 §10: scoped composer diagnostic. Booleans + a type
      // label only — never prompt content, never account metadata.
      return { ok: true, composerProbe: adapter.composerProbe(root) };
    }
    default:
      throw new Error(`SCHEMA_INVALID: unhandled command ${msg.type}`);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CONTENT_COMMANDS_VERSION, bytesToBase64, COMMAND_TYPES, checkCommand, checkApproval, revalidateBeforeGenerate, dispatchContentCommand };
}

// POST-v1B: browser namespace for the isolated-world content runtime.
try {
  if (typeof window !== "undefined" && !window.FlowContentCommands) {
    window.FlowContentCommands = { COMMAND_TYPES, checkCommand, checkApproval, revalidateBeforeGenerate, dispatchContentCommand };
  }
} catch (e) {
  void e;
}
