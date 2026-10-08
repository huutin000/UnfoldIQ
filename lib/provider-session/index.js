"use strict";
// lib/provider-session/index.js — Phase 5C (5.4): provider/Flow session
// contract. Exclusive per-profile leases, reset-to-known-state before reuse,
// stale-auth/drift classification, reconcile-before-resubmit after restart.
// Pure logic + injected page probes: no live provider calls here.

const VERSION = "1.0.0";

const FINDINGS = [
  "PROVIDER_SESSION_STALE",
  "PROVIDER_DRIFT",
  "PROVIDER_PROFILE_CONFLICT",
  "PROVIDER_REAUTH_REQUIRED",
];

// Classify an observed provider page snapshot. Pure: callers supply facts.
function classifyPageState(obs = {}) {
  if (obs.captchaPresent) return { verdict: "REVIEW_REQUIRED", reason: "captcha/challenge present; never bypass" };
  if (obs.loginPage) return { verdict: "SESSION_STALE", reason: "login page shown" };
  if (obs.sessionExpired) return { verdict: "SESSION_STALE", reason: "expired session marker" };
  if (obs.expectedAccount && obs.accountId && obs.expectedAccount !== obs.accountId) {
    return { verdict: "PROVIDER_DRIFT", reason: `account mismatch: ${obs.accountId}` };
  }
  if (obs.unexpectedUi) return { verdict: "PROVIDER_DRIFT", reason: String(obs.unexpectedUi).slice(0, 160) };
  if (obs.quotaBanner) return { verdict: "REVIEW_REQUIRED", reason: "quota banner shown" };
  if (obs.generationInProgress) return { verdict: "REVIEW_REQUIRED", reason: "generation already in progress" };
  if (obs.promptText || obs.oldResultSelected || obs.uploadQueueLength > 0) {
    return { verdict: "RESET_REQUIRED", reason: "prior job residue present" };
  }
  if (obs.selectorsOk === false) return { verdict: "PROVIDER_DRIFT", reason: "selector/state drift" };
  return { verdict: "VALID", reason: null };
}

// Required clean-slate facts after a reset attempt.
function resetChecklist() {
  return ["knownUrl", "noPromptText", "noOldResult", "noUploadQueue", "noGenerationInProgress"];
}

function createRegistry(opts = {}) {
  const now = opts.now || (() => Date.now());
  const maxAgeMs = opts.maxAgeMs ?? 4 * 60 * 60 * 1000;
  const maxJobs = opts.maxJobs ?? 50;
  const sessions = new Map(); // profileScope -> record
  let seq = 0;
  const metrics = { acquired: 0, reused: 0, stale: 0, reauth: 0, drift: 0, resets: 0, resetFailures: 0, conflicts: 0, revoked: 0, reconciled: 0 };

  function get(profileScope) { return sessions.get(profileScope) || null; }

  // Exclusive lease: one active owner per user-data dir (RULE 3).
  function acquire({ providerId, accountScope, profileScope }) {
    if (!providerId || !accountScope || !profileScope) throw new Error("SCHEMA_INVALID: providerId+accountScope+profileScope required");
    const cur = sessions.get(profileScope);
    if (cur && cur.leaseState === "LEASED") {
      metrics.conflicts++;
      throw new Error("PROVIDER_PROFILE_CONFLICT: profile already leased");
    }
    if (cur && cur.leaseState === "IDLE") {
      if (cur.revoked) throw new Error("PROVIDER_REAUTH_REQUIRED: session revoked");
      if (cur.authState === "STALE" || cur.authState === "REAUTH_REQUIRED") {
        throw new Error("PROVIDER_REAUTH_REQUIRED: revalidate authentication before reuse");
      }
      if (now() - cur.createdAt > maxAgeMs || cur.jobsCompleted >= maxJobs) {
        sessions.delete(profileScope);
      } else {
        cur.leaseState = "LEASED";
        metrics.reused++;
        return { session: cur, reused: true };
      }
    }
    const rec = {
      sessionId: `ps-${++seq}`, providerId, accountScope, profileScope,
      createdAt: now(), lastUsedAt: now(), jobsCompleted: 0,
      authState: "VALID", health: "HEALTHY", leaseState: "LEASED",
    };
    sessions.set(profileScope, rec);
    metrics.acquired++;
    return { session: rec, reused: false };
  }

  function release(profileScope, { jobsCompleted = 1 } = {}) {
    const cur = sessions.get(profileScope);
    if (!cur) return;
    cur.leaseState = "IDLE";
    cur.lastUsedAt = now();
    cur.jobsCompleted += jobsCompleted;
    if (now() - cur.createdAt > maxAgeMs || cur.jobsCompleted >= maxJobs) {
      sessions.delete(profileScope); // retire: next acquire recreates
    }
  }

  // Reset to known state before reuse. resetter returns {ok, facts}.
  // Unprovable reset => discard + recreate (never reuse dirty state).
  async function resetForReuse(profileScope, resetter) {
    const cur = sessions.get(profileScope);
    if (!cur) throw new Error("PROVIDER_SESSION_STALE: no session to reset");
    let proof = null;
    try { proof = await resetter(cur); } catch { proof = null; }
    metrics.resets++;
    const facts = (proof && proof.facts) || {};
    const missing = resetChecklist().filter((k) => facts[k] !== true);
    if (!proof || proof.ok !== true || missing.length > 0) {
      metrics.resetFailures++;
      sessions.delete(profileScope);
      return { ok: false, reason: `reset unproven (${missing.join(",") || "error"}): discarded`, facts };
    }
    cur.health = "HEALTHY";
    cur.lastUsedAt = now();
    return { ok: true, facts };
  }

  function markStale(profileScope, reason) {
    const cur = sessions.get(profileScope);
    if (cur) { cur.authState = "STALE"; cur.health = "DEGRADED"; }
    metrics.stale++;
    return { finding: "PROVIDER_SESSION_STALE", reason };
  }

  function requireReauth(profileScope) {
    const cur = sessions.get(profileScope);
    if (cur) { cur.authState = "REAUTH_REQUIRED"; cur.health = "UNHEALTHY"; }
    metrics.reauth++;
  }

  function revoke(profileScope) {
    sessions.delete(profileScope);
    metrics.revoked++;
  }

  // Restart recovery: unknown provider-side state reconciles, never resubmits.
  function reconcile(profileScope, observed) {
    const verdict = classifyPageState(observed);
    metrics.reconciled++;
    if (verdict.verdict === "VALID") return { action: "RESUME", verdict };
    return { action: "RECONCILE", verdict };
  }

  function snapshot() {
    return {
      version: VERSION,
      sessions: [...sessions.values()].map((s) => ({ ...s })),
      metrics,
    };
  }

  return { VERSION, FINDINGS, acquire, release, get, resetForReuse, markStale, requireReauth, revoke, reconcile, classifyPageState, resetChecklist, snapshot };
}

module.exports = { VERSION, FINDINGS, createRegistry, classifyPageState, resetChecklist };
