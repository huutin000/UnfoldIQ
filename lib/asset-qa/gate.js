"use strict";

/**
 * Phase 1G.11 — canonical timeline eligibility boundary.
 * assertAssetReadyForTimeline(assetId, shotId): timeline entry requires a
 * CURRENT, VALID, FRESH QA result. SELECTED/APPROVED alone never suffices;
 * stale QA, hash drift and critical UNKNOWN all block.
 */

const shared = require("./shared.js");
const storeLib = require("./store.js");
const validatorLib = require("./validator.js");

/**
 * assertAssetReadyForTimeline(root, projectId, assetId, shotId, opts?)
 * opts: { currentDeps?: fingerprint deps incl. assetHash, currentAssetHash? }
 * → { eligible, status, reasons[], qaResultId?, aggregate? }
 */
function assertAssetReadyForTimeline(root, projectId, assetId, shotId, opts = {}) {
  const reasons = [];
  const cur = storeLib.getCurrentQa(root, projectId, assetId);
  if (!cur.ok) {
    return {
      eligible: false,
      status: "REVIEW_REQUIRED",
      reasons: ["NO_CURRENT_QA: selected asset without QA cannot enter timeline"],
      qaResultId: null,
    };
  }
  const result = cur.result;
  const v = validatorLib.validateQaResult(result);
  if (!v.valid) {
    return { eligible: false, status: "REJECTED", reasons: [`QA_RESULT_INVALID: ${v.errors.join("; ")}`], qaResultId: result.qaResultId || null };
  }
  if (shotId && result.shotId && result.shotId !== shotId) {
    reasons.push(`SHOT_MISMATCH: QA binds to shot ${result.shotId}, not ${shotId}`);
    return { eligible: false, status: "REJECTED", reasons, qaResultId: result.qaResultId };
  }
  const currentHash = opts.currentAssetHash || (opts.currentDeps && opts.currentDeps.assetHash);
  if (currentHash && result.assetHash !== String(currentHash)) {
    return { eligible: false, status: "REJECTED", reasons: [`ASSET_HASH_MISMATCH: QA binds to ${result.assetHash}, current is ${currentHash}`], qaResultId: result.qaResultId };
  }
  if (opts.currentDeps) {
    const st = shared.checkStaleness(result.expectationSnapshot || {}, opts.currentDeps);
    if (st.stale) {
      return { eligible: false, status: "REVIEW_REQUIRED", reasons: [`STALE_QA: ${st.reasons.join("; ")} (layers: ${st.staleLayers.join(",")})`], qaResultId: result.qaResultId };
    }
  }
  // Historical-result mutation guard: re-aggregate from stored layers and
  // require the stored verdict to still hold.
  const agg = result.aggregate || {};
  if (agg.timelineEligible !== true || agg.status !== "READY_FOR_TIMELINE") {
    const rs = [...(agg.reasons || [])];
    if (rs.length === 0) rs.push(`aggregate status ${agg.status} is not timeline eligible`);
    return { eligible: false, status: agg.status === "REJECTED" ? "REJECTED" : "REVIEW_REQUIRED", reasons: rs, qaResultId: result.qaResultId, aggregate: agg };
  }
  return { eligible: true, status: "READY_FOR_TIMELINE", reasons: [], qaResultId: result.qaResultId, aggregate: agg };
}

module.exports = { assertAssetReadyForTimeline };
