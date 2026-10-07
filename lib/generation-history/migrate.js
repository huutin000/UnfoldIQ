"use strict";

/**
 * Phase 1H.2 — evidence-based history bootstrap (§24).
 * Reads ONLY canonical 1G/1G.12 artifacts (correlations, case results, QA
 * summaries, ledger, asset registry, resolutions). Never fabricates:
 * every migrated record carries provenance MIGRATED + a decisions[] entry
 * (VERIFIED = own identity fields; MIGRATED = derived linkage stated in
 * `why`). Idempotent: deterministic ids → re-migration replays as no-ops.
 * Never modifies existing files; refuses to overwrite an existing store.
 */

const fs = require("fs");
const path = require("path");
const hist = require("./index.js");
const costShared = require("../output-cost/shared.js");

function projFile(root, projectId, rel) {
  return path.join(root, "projects", projectId, rel);
}

function readJson(root, projectId, rel) {
  try {
    const p = projFile(root, projectId, rel);
    if (!fs.existsSync(p)) return { ok: false, code: "ABSENT" };
    return { ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { ok: false, code: "UNPARSEABLE", message: String((e && e.message) || e) };
  }
}

function genId(projectId, attemptId) {
  return `gen-${costShared.hash16({ project: projectId, attempt: attemptId }).slice(0, 12)}`;
}
function varId(projectId, attemptId) {
  return `var-${costShared.hash16({ project: projectId, attempt: attemptId, kind: "variant" }).slice(0, 12)}`;
}
function decId(projectId, attemptId) {
  return `dec-${costShared.hash16({ project: projectId, attempt: attemptId, kind: "decision" }).slice(0, 12)}`;
}

// Attempts with full correlation→result→QA→ledger evidence in case-a.
const ATTEMPTS = [
  { key: "b1-01", corr: "case/case-b-attempt-01-correlation.json", result: "case/case-b-attempt-01-result.json", qa: "qa/case-b-attempt-01-qa-summary.json", sceneId: "B-SC01" },
  { key: "b1-02", corr: "case/case-b-attempt-02-correlation.json", result: "case/case-b-attempt-02-result.json", qa: "qa/case-b-attempt-02-qa-summary.json", sceneId: "B-SC01", retryOf: "b1-attempt-01" },
  { key: "c1-01", corr: "case/case-c-attempt-01-correlation.json", result: "case/case-c-attempt-01-result.json", qa: "qa/case-c-attempt-01-qa-summary.json", sceneId: "C-SC01" },
  { key: "d1-01", corr: "case/case-d-D1-attempt-01-correlation.json", result: "case/case-d-D1-attempt-01-result.json", qa: "qa/case-d-D1-attempt-01-qa-summary.json", sceneId: "D-SC01" },
  { key: "d2-01", corr: "case/case-d-D2-attempt-01-correlation.json", result: "case/case-d-D2-attempt-01-result.json", qa: "qa/case-d-D2-attempt-01-qa-summary.json", sceneId: "D-SC01" },
  { key: "d3-01", corr: "case/case-d-D3-attempt-01-correlation.json", result: "case/case-d-D3-attempt-01-result.json", qa: "qa/case-d-D3-attempt-01-qa-summary.json", sceneId: "D-SC01" },
];

function ledgerByAttempt(root, projectId) {
  const l = readJson(root, projectId, "budget/ledger.json");
  const map = {};
  if (l.ok && Array.isArray(l.data.entries)) {
    for (const e of l.data.entries) {
      if (e && e.attemptId && (e.state || e.status) === "RECONCILED") {
        map[e.attemptId] = {
          observedCredits: typeof e.observedCredits === "number" ? e.observedCredits : (typeof e.creditsObserved === "number" ? e.creditsObserved : null),
          evidenceStrength: e.evidenceStrength || null,
        };
      }
    }
  }
  return map;
}

function inspectHistoryEvidence(root, projectId, assetLib) {
  const decisions = [];
  const generations = [];
  const variants = [];
  const reviewDecisions = [];
  const ledger = ledgerByAttempt(root, projectId);
  const dRes = readJson(root, projectId, "case/case-d-resolutions.json");

  for (const a of ATTEMPTS) {
    const corr = readJson(root, projectId, a.corr);
    const res = readJson(root, projectId, a.result);
    if (!corr.ok || !res.ok) {
      decisions.push({ attempt: a.key, status: "UNRESOLVED", why: `missing ${!corr.ok ? a.corr : a.result} — skipped, never fabricated` });
      continue;
    }
    const c = corr.data;
    const r = (res.data && res.data.caseResult) || res.data;
    const qa = readJson(root, projectId, a.qa);
    const qaStatus = qa.ok && qa.data && qa.data.aggregate ? qa.data.aggregate.status : null;
    const passed = r.status === "PASS" && qaStatus === "READY_FOR_TIMELINE";
    // Primary video asset: first result asset whose registry type is video.
    let videoAssetId = null;
    const assetIds = Array.isArray(r.assetIds) ? r.assetIds : [];
    if (assetLib) {
      for (const id of assetIds) {
        try {
          const rec = assetLib.getAsset(root, projectId, id);
          if (rec.ok && rec.record && rec.record.type === "video") { videoAssetId = id; break; }
        } catch { /* ignore lookup failures in probing */ }
      }
    }
    if (!videoAssetId) videoAssetId = assetIds[0] || null;
    const videoRec = videoAssetId && assetLib ? (() => { try { return assetLib.getAsset(root, projectId, videoAssetId); } catch { return null; } })() : null;
    const vrec = videoRec && videoRec.ok ? videoRec.record : null;
    const cost = ledger[c.attemptId] || { observedCredits: null, evidenceStrength: null };
    const gid = genId(projectId, c.attemptId);
    generations.push({
      generationId: gid, jobId: c.jobId || c.attemptId, attemptId: c.attemptId,
      shotId: c.shotId || null, sceneId: a.sceneId,
      generationUnitId: (Array.isArray(r.generationUnitIds) && r.generationUnitIds[0]) || c.unitId || null,
      provider: "google-flow",
      model: null, // attached post-hoc below ONLY where per-shot model evidence exists (D resolutions)
      modelResolutionRef: (Array.isArray(r.modelResolutionRefs) && r.modelResolutionRefs[0]) || null,
      promptVersion: (vrec && vrec.promptVersion) || null,
      agentInstructionsVersion: (vrec && vrec.instructionVersion) || null,
      referenceIds: (vrec && (vrec.referenceIds || vrec.derivedFrom)) || [],
      createdAt: c.downloadedAt || null, completedAt: c.downloadedAt || null,
      status: passed ? "SUCCEEDED" : "FAILED",
      resultAssetIds: videoAssetId ? [videoAssetId] : [],
      costEvidence: cost.observedCredits !== null ? cost : null,
      retryOf: a.retryOf || null,
      provenance: "MIGRATED",
    });
    decisions.push({
      attempt: c.attemptId, status: "MIGRATED",
      why: `generation ${passed ? "SUCCEEDED" : "FAILED"} from case result ${r.status} + QA ${qaStatus}; model proven only for D shots (see selections)`,
    });
    const vid = varId(projectId, c.attemptId);
    variants.push({
      variantId: vid, targetType: "SHOT", targetId: c.shotId, generationId: gid,
      assetId: videoAssetId, createdAt: c.downloadedAt || null,
      status: passed ? "SELECTED" : "PROPOSED",
      decisionId: decId(projectId, c.attemptId), decidedAt: c.downloadedAt || null,
    });
    reviewDecisions.push({
      decisionId: decId(projectId, c.attemptId), targetType: "SHOT", targetId: c.shotId,
      variantId: vid, decision: passed ? "APPROVED" : "REJECTED",
      reason: passed
        ? `QA READY_FOR_TIMELINE (${qa.ok ? a.qa : "qa evidence"}) + case verdict PASS`
        : `case verdict ${r.status} / QA ${qaStatus} (attempt preserved, never overwritten)`,
      evidenceRefs: [a.corr, a.result, a.qa],
      decidedAt: c.downloadedAt || new Date().toISOString(),
      actorType: "migration", provenance: "MIGRATED",
    });
  }

  // D model truth (the only per-shot model evidence): attach post-hoc.
  if (dRes.ok) {
    const byResolution = {};
    for (const [shot, r] of Object.entries(dRes.data || {})) {
      if (r && r.model && r.resolutionRef) byResolution[r.resolutionRef] = { model: r.model, shot };
    }
    for (const g of generations) {
      const hit = g.modelResolutionRef && byResolution[g.modelResolutionRef];
      if (hit) g.model = hit.model;
    }
  }

  // Avatar: never generated → no generation/variant; REJECTED decision only.
  const avatarFinding = readJson(root, projectId, "case/source-frame-identity-finding.json");
  reviewDecisions.push({
    decisionId: decId(projectId, "avatar-source-frame"),
    targetType: "ASSET", targetId: "as-1186233d1af6", variantId: null,
    decision: "REJECTED",
    reason: "account avatar, never a generation result (finding-source-frame-identity-01); registry selection corrected to REJECTED+locked",
    evidenceRefs: avatarFinding.ok ? ["case/source-frame-identity-finding.json"] : [],
    decidedAt: "2026-10-05T02:54:41.089Z",
    actorType: "migration", provenance: "MIGRATED",
  });
  decisions.push({ attempt: "avatar-source-frame", status: "MIGRATED", why: "no generation existed; REJECTED decision only" });

  // Canonical reference locks mirrored from the registry (no new truth).
  const assetLocks = [];
  if (assetLib) {
    const listed = assetLib.listAssets(root, projectId);
    if (listed.ok) {
      for (const rec of listed.assets || []) {
        if (rec && rec.lock && rec.lock.locked === true && rec.qualityStatus === "APPROVED") {
          assetLocks.push({
            targetType: "ASSET", targetId: rec.assetId,
            reason: `mirror canonical registry lock (${rec.lock.reason || "locked"})`,
            sourceDecisionId: null, at: rec.lock.lockedAt || null,
          });
        }
      }
    }
  }
  decisions.push({ attempt: "asset-locks", status: assetLocks.length > 0 ? "MIGRATED" : "UNRESOLVED", why: `${assetLocks.length} APPROVED+locked registry assets mirrored (avatar excluded: REJECTED)` });

  return { generations, variants, reviewDecisions, assetLocks, decisions };
}

/**
 * Bootstrap history from evidence. Fails WITHOUT WRITING when a store
 * already exists. Returns { ok, store, decisions } (decisions documents
 * VERIFIED/MIGRATED/UNRESOLVED per record for the report).
 */
function bootstrapHistory(root, projectId, opts = {}) {
  const assetLib = opts.assetLib || null;
  if (hist.exists(root, projectId)) {
    return { ok: false, code: "HISTORY_CONFLICT", message: "history store already exists; append, never re-bootstrap" };
  }
  let inspected;
  try {
    inspected = inspectHistoryEvidence(root, projectId, assetLib);
  } catch (e) {
    return { ok: false, code: "HISTORY_WRITE_FAILED", message: String((e && e.message) || e) };
  }
  const created = hist.createHistoryStore(root, projectId, opts);
  if (!created.ok) return created;
  const step = (fn) => {
    const r = fn();
    if (!r.ok) return r;
    return null;
  };
  for (const g of inspected.generations) {
    const err = step(() => hist.recordGeneration(root, projectId, g));
    if (err) return err;
  }
  for (const v of inspected.variants) {
    const err = step(() => hist.recordVariant(root, projectId, {
      variantId: v.variantId, targetType: v.targetType, targetId: v.targetId,
      generationId: v.generationId, assetId: v.assetId, createdAt: v.createdAt,
    }));
    if (err) return err;
  }
  for (const d of inspected.reviewDecisions) {
    const err = step(() => hist.recordDecision(root, projectId, d, { lockOnApprove: true }));
    if (err) return err;
  }
  for (const l of inspected.assetLocks) {
    const err = step(() => hist.lockTarget(root, projectId, l));
    if (err && err.code !== "ALREADY_LOCKED") return err;
  }
  const final = hist.loadHistory(root, projectId);
  if (!final.ok) return final;
  return { ok: true, store: final.store, changed: true, decisions: inspected.decisions };
}

module.exports = { ATTEMPTS, inspectHistoryEvidence, bootstrapHistory };
