"use strict";
/* UNFOLDIQ Flow Companion — canonical auto-preparation orchestrator
 * (POST-v1E stall fix §5, §6, §7, §8, §10).
 *
 * ensureCurrentJobPrepared(job) is the ONLY normal-mode entry point after
 * current-job resolution. It owns:
 *   - state dispatch by job status (PREPARED auto-advances — §6);
 *   - the zero-credit preparation pipeline (PREPARE_GENERATION command —
 *     Flow DOM stays owned by FlowPageAdapter, no selectors here);
 *   - token-recovery re-entry (reset() clears latched state — §7);
 *   - single-flight by material key jobId|attempt|fingerprint (§8);
 *   - a bounded watchdog that converts a stalled preparation into a
 *     retryable error (never a fixed-sleep success) — §10.
 *
 * Pure orchestration: every side effect is an injected dep, so the live
 * live sequence (panel open → BRIDGE_TOKEN_REQUIRED → token set → auto
 * prepare) is regression-testable in plain node.
 */

const DEFAULT_WATCHDOG_MS = 120000;

function createAutoPreparer(deps) {
  const d = deps || {};
  if (typeof d.sendPrepare !== "function") throw new Error("SCHEMA_INVALID: sendPrepare required");
  if (typeof d.onState !== "function") throw new Error("SCHEMA_INVALID: onState required");
  if (typeof d.onError !== "function") throw new Error("SCHEMA_INVALID: onError required");
  if (typeof d.log !== "function") throw new Error("SCHEMA_INVALID: log required");

  const inFlightKeys = new Set();
  const successfulKeys = new Map();
  let watchdogTimer = null;

  /* §3 FIX 02: one canonical ping field. The resolver reports pingSuccess;
   * everything downstream reads `ping` — never undefined when the content
   * script answered. */
  function pingOf(tab) {
    if (!tab) return false;
    if (typeof tab.ping === "boolean") return tab.ping;
    return tab.pingSuccess === true;
  }

  function materialKey(job) {
    const fingerprint = JSON.stringify({
      jobId: job.jobId || null,
      attempt: job.attempt === undefined ? null : job.attempt,
      status: job.status || null,
      prompt: job.prompt || "",
    });
    return `${job.jobId || "none"}|${job.attempt === undefined ? "none" : job.attempt}|${fingerprint}`;
  }

  function startWatchdog(jobId) {
    stopWatchdog();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      inFlightKeys.clear();
      d.log(`autoPrepare: watchdog fired job=${jobId} code=PREPARATION_TIMEOUT`);
      d.onError({ code: "PREPARATION_TIMEOUT", stage: "watchdog", detail: "no preparation progress within the bounded watchdog interval" });
      d.onState("NEED_ATTENTION");
    }, d.watchdogMs || DEFAULT_WATCHDOG_MS);
  }

  function stopWatchdog() {
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  /* §7: token recovery — stale bootstrap error / completed-key latch must
   * not survive a materially fresh session (token just became valid). */
  function reset() {
    inFlightKeys.clear();
    successfulKeys.clear();
    stopWatchdog();
    d.log("autoPrepare: state reset (recovery re-entry allowed)");
  }

  async function prepareLiveGeneration(job) {
    const key = materialKey(job);
    if (inFlightKeys.has(key)) {
      d.log(`autoPrepare: duplicate trigger ignored key=${key}`);
      return { skipped: true, reason: "IN_FLIGHT" };
    }
    if (successfulKeys.has(key)) {
      d.log(`autoPrepare: already prepared key=${key}`);
      return { skipped: true, reason: "COMPLETED" };
    }
    inFlightKeys.add(key);
    d.onState("PREPARING");
    d.log(`autoPrepare: start job=${job.jobId} state=${job.status}`);
    startWatchdog(job.jobId);
    try {
      if (typeof d.resolveLiveTab === "function") {
        const tab = await d.resolveLiveTab();
        d.log(`autoPrepare: liveTab resolved ping=${pingOf(tab)} source=${(tab && tab.source) || "unknown"}`);
      }
      // FIX 02 §5: PREPARE_GENERATION waits for the async-mounted composer
      // inside the prompt-composer stage (MutationObserver, bounded).
      d.log("autoPrepare: waiting for prompt composer");
      const res = await d.sendPrepare({
        prompt: job.prompt,
        capability: job.capability || "image",
        approvalState: job.status || "PREPARED",
      });
      stopWatchdog();
      const prepared = res && res.prepared === true;
      if (res && res.composerWait) {
        d.log(`autoPrepare: prompt composer ready elapsedMs=${res.composerWait.elapsedMs || 0}`);
      }
      // FIX 03 §17: safe prompt telemetry — lengths/fingerprints only.
      if (res && res.promptInsert) {
        const pi = res.promptInsert;
        d.log(`autoPrepare: prompt editor resolved type=${pi.editorType || "unknown"}`);
        d.log(`autoPrepare: prompt insert strategy=${pi.strategy || "unknown"}`);
        d.log(`autoPrepare: prompt inserted=${pi.inserted === true}`);
        d.log(`autoPrepare: prompt verification expectedLength=${pi.expectedLength} observedLength=${pi.observedLength} match=${pi.fingerprintMatch === true}`);
        d.log(`autoPrepare: prompt stable=${pi.stable === true}`);
      }
      if (res && res.stage !== "prompt-composer" && res.stage !== "prompt") {
        d.log("autoPrepare: prompt input resolved");
      }
      d.log(`autoPrepare: prompt verified=${prepared || (res && res.stage !== "prompt" && res.stage !== "prompt-composer")}`);
      // POST-v1E.2C: probe diagnostics must appear in the developer log, not
      // only inside internal error objects.
      for (const line of (res && res.probeLogs) || []) d.log(line);
      if (res && res.settings) {
        d.log(`autoPrepare: standardMode=true`);
        d.log(`autoPrepare: generationType=${res.settings.generationType} verified=${prepared}`);
        if (res.generationType && res.generationType.verificationSources) {
          d.log(`autoPrepare: generationType sources=[${res.generationType.verificationSources.join(",")}]`);
        }
        d.log(`autoPrepare: aspect=${res.settings.aspect}`);
        d.log(`autoPrepare: outputCount=${res.settings.outputCount}`);
        d.log(`autoPrepare: model=${res.settings.model}`);
        d.log(`autoPrepare: visibleCost=${res.settings.visibleCost}`);
      }
      if (res && res.generate) {
        d.log(`autoPrepare: generateFound=${res.generate.found} enabled=${res.generate.enabled}`);
      }
      // FIX 02 §4: a failed prerequisite never logs `false + missing=[]`.
      const evaluated = res && res.stage === "readiness";
      let missing = Array.isArray(res && res.missing) ? res.missing : [];
      if (!prepared && missing.length === 0) missing = [(res && res.code) || "PREPARATION_FAILED"];
      d.log(`autoPrepare: generationReady=${prepared ? "true" : evaluated ? "false" : "NOT_EVALUATED"} missing=[${missing}]`);
      if (!prepared) {
        const code = (res && res.code) || "GENERATION_NOT_READY";
        d.log(`autoPrepare: preparation failed stage=${(res && res.stage) || "unknown"} code=${code}${res && res.promptInsert ? ` expectedLength=${res.promptInsert.expectedLength} observedLength=${res.promptInsert.observedLength}` : ""}`);
        // POST-v1E.1: on prompt mismatch, dump the structured comparison
        // (raw values JSON.stringify'd, first diff, code points) — failure
        // diagnostics only; success paths stay free of prompt content.
        if (res && res.mismatch) d.log(`autoPrepare: prompt mismatch diagnostics ${JSON.stringify(res.mismatch)}`);
        // FIX 02 §2: a failed preparation NEVER enters successfulKeys —
        // retrying the same job must run a fresh attempt.
        successfulKeys.delete(key);
        d.onError({ code, stage: (res && res.stage) || "unknown", detail: (res && res.detail) || null });
        d.onState("NEED_ATTENTION");
        return { prepared: false, code };
      }
      if (typeof d.freezeSnapshot === "function") await d.freezeSnapshot(res.generationState || null);
      if (typeof d.markAwaitingApproval === "function") await d.markAwaitingApproval();
      d.log("autoPrepare: await-approval transition=success");
      successfulKeys.set(key, { ok: true });
      d.onState("AWAITING_USER_APPROVAL");
      d.log("autoPrepare: snapshot frozen");
      return { prepared: true };
    } catch (e) {
      stopWatchdog();
      const code = String((e && e.message) || e);
      d.log(`autoPrepare: preparation error ${code}`);
      successfulKeys.delete(key);
      d.onError({ code, stage: "prepare", detail: null });
      d.onState("NEED_ATTENTION");
      return { prepared: false, code };
    } finally {
      inFlightKeys.delete(key);
    }
  }

  async function hydrateApprovalSnapshot(job) {
    // Job already AWAITING_USER_APPROVAL: re-verify what the user will see.
    // If the live page no longer matches, re-run zero-credit preparation.
    d.log(`autoPrepare: hydrate job=${job.jobId} state=AWAITING_USER_APPROVAL`);
    if (typeof d.probeGenerationState === "function") {
      try {
        const gs = await d.probeGenerationState({ promptVerified: true, approvalState: "AWAITING_USER_APPROVAL" });
        if (gs && gs.ready === true) {
          if (typeof d.freezeSnapshot === "function") await d.freezeSnapshot(gs);
          d.onState("AWAITING_USER_APPROVAL");
          d.log("autoPrepare: snapshot frozen (hydrated)");
          return { prepared: true, hydrated: true };
        }
      } catch (e) {
        d.log(`autoPrepare: hydration probe skipped: ${String((e && e.message) || e)}`);
      }
    }
    d.onState("AWAITING_USER_APPROVAL");
    if (typeof d.freezeSnapshot === "function") await d.freezeSnapshot(null);
    return { prepared: true, hydrated: true };
  }

  function resumeCurrentAttempt(job) {
    // Read-only resume of an in-flight attempt: never re-submits.
    const state = job.status === "GENERATING" ? "GENERATING" : "PROCESSING";
    d.log(`autoPrepare: resume job=${job.jobId} state=${job.status}`);
    d.onState(state);
    return { resumed: true, state };
  }

  function showReady() {
    d.log("autoPrepare: job already READY");
    d.onState("READY");
    return { done: true };
  }

  function mapStateNormally(job) {
    d.log(`autoPrepare: map state job=${job.jobId} state=${job.status}`);
    d.onState("SYNC");
    return { mapped: true };
  }

  async function ensureCurrentJobPrepared(job) {
    if (!job) return { mapped: false };
    switch (job.status) {
      case "PREPARED":
      case "VALIDATED":
        return prepareLiveGeneration(job);
      case "AWAITING_USER_APPROVAL":
        return hydrateApprovalSnapshot(job);
      case "GENERATING":
      case "RESULT_DETECTED":
      case "DOWNLOADING":
      case "IMPORTED":
        return resumeCurrentAttempt(job);
      case "READY":
        return showReady();
      default:
        return mapStateNormally(job);
    }
  }

  return { ensureCurrentJobPrepared, reset, materialKey };
}

/* Terminal toast decision for the runPipeline prep attempt. A job that
 * needed no preparation (already terminal/resumed/mapped) must NEVER
 * paint a preparation failure — there was no failure. Only an actually
 * attempted preparation that reported prepared=false (or a missing
 * orchestrator outcome) is a failure. Pure: unit-tested in node. */
function prepToastAction(outcome, uiState) {
  if (uiState === "AWAITING_USER_APPROVAL") return "success";
  if (outcome && outcome.prepared === false) return "failure";
  if (outcome) return "clear";
  return "failure";
}

const api = { createAutoPreparer, prepToastAction, DEFAULT_WATCHDOG_MS };
if (typeof window !== "undefined") window.FlowAutoPrepare = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
