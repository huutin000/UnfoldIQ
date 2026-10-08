"use strict";

/**
 * Phase 4B §36–§40 — A/V Semantic Alignment QA (UNFOLDIQ CORE).
 *
 * Compares approved semantics (script claims, asset intent metadata,
 * on-screen text, chart/map/diagram data) against each other and against
 * rendered evidence. Metadata cross-checks with machine-readable findings —
 * never a bare numeric score. Local repair preferred; full rerender only
 * when the renderer cannot stitch safely (recorded for Phase 5).
 */

const SEMANTIC_VERSION = "1.0.0";

function finding(code, extra = {}) {
  return {
    code, severity: extra.severity || "BLOCK",
    timeRange: extra.timeRange || null, sceneRef: extra.sceneRef || null,
    reason: extra.reason || code, correctiveAction: extra.correctiveAction || null,
    evidenceRefs: extra.evidenceRefs || [],
  };
}

function norm(s) {
  return String(s || "").toLowerCase();
}

/**
 * Beat review unit: { beatId?, sceneId, phraseIds?, narration, captionText?,
 *   onScreenText?, visual: { entity?, action?, assetId?, trend?, quantity?,
 *   location?, timePeriod?, labels? }, chartData?, mapData?, sceneIntent }
 * Asset intents: { [assetId]: { entity?, action?, trend?, ... } }
 */
function checkBeatSemantic(beat, assetIntents = {}) {
  const findings = [];
  const scene = beat.sceneId || "?";
  const intent = assetIntents[beat.visual.assetId] || {};
  const vx = (k) => beat.visual[k] !== undefined ? beat.visual[k] : intent[k];

  // Narration ↔ Visual entity/action.
  if (beat.narrationEntity && vx("entity") && norm(beat.narrationEntity) !== norm(vx("entity"))) {
    findings.push(finding("ENTITY_MISMATCH", { sceneRef: scene, reason: `narration says ${beat.narrationEntity}, visual shows ${vx("entity")}`, correctiveAction: "PATCH_VISUAL" }));
  }
  if (beat.narrationAction && vx("action") && norm(beat.narrationAction) !== norm(vx("action"))) {
    findings.push(finding("ACTION_MISMATCH", { sceneRef: scene, reason: `narration action ${beat.narrationAction} ≠ visual ${vx("action")}`, correctiveAction: "PATCH_VISUAL" }));
  }
  // Narration ↔ caption meaning (caption must carry the same words, not paraphrase).
  if (beat.captionText && beat.narration) {
    const nw = new Set(norm(beat.narration).split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...nw].filter((w) => norm(beat.captionText).includes(w));
    if (nw.size > 0 && overlap.length / nw.size < 0.5) {
      findings.push(finding("SEMANTIC_ALIGNMENT_FAIL", { sceneRef: scene, reason: "caption diverges from spoken meaning", correctiveAction: "PATCH_CAPTIONS" }));
    }
  }
  // Narration ↔ on-screen text contradiction.
  if (beat.onScreenText && beat.narrationContradictedByText === true) {
    findings.push(finding("ONSCREEN_TEXT_CONTRADICTION", { sceneRef: scene, reason: `on-screen "${beat.onScreenText}" contradicts narration`, correctiveAction: "PATCH_VISUAL" }));
  }
  // Narration ↔ chart/map/diagram truth.
  if (beat.chartData && beat.narrationTrend && norm(beat.chartData.trend) !== norm(beat.narrationTrend)) {
    findings.push(finding("TREND_MISMATCH", { sceneRef: scene, reason: `narration says ${beat.narrationTrend}, chart shows ${beat.chartData.trend}`, correctiveAction: "PATCH_CHART" }));
  }
  if (beat.chartData && Array.isArray(beat.chartData.hiddenLabels) && beat.chartData.hiddenLabels.length) {
    findings.push(finding("LABEL_MISMATCH", { sceneRef: scene, reason: `chart hides labels: ${beat.chartData.hiddenLabels.join(",")}`, correctiveAction: "PATCH_CHART" }));
  }
  if (beat.mapData && beat.narrationLocation && norm(beat.mapData.highlight) !== norm(beat.narrationLocation)) {
    findings.push(finding("LOCATION_MISMATCH", { sceneRef: scene, reason: `narration says ${beat.narrationLocation}, map highlights ${beat.mapData.highlight}`, correctiveAction: "PATCH_VISUAL" }));
  }
  if (beat.narrationQuantity && vx("quantity") && norm(beat.narrationQuantity) !== norm(vx("quantity"))) {
    findings.push(finding("QUANTITY_MISMATCH", { sceneRef: scene, reason: `narration quantity ${beat.narrationQuantity} ≠ visual ${vx("quantity")}`, correctiveAction: "PATCH_VISUAL" }));
  }
  if (beat.narrationDirection && vx("direction") && norm(beat.narrationDirection) !== norm(vx("direction"))) {
    findings.push(finding("DIRECTION_MISMATCH", { sceneRef: scene, reason: `direction ${beat.narrationDirection} ≠ ${vx("direction")}`, correctiveAction: "PATCH_VISUAL" }));
  }
  if (beat.narrationTimePeriod && vx("timePeriod") && norm(beat.narrationTimePeriod) !== norm(vx("timePeriod"))) {
    findings.push(finding("TIME_PERIOD_MISMATCH", { sceneRef: scene, reason: `period ${beat.narrationTimePeriod} ≠ ${vx("timePeriod")}`, correctiveAction: "PATCH_VISUAL" }));
  }
  // Scene intent ↔ visual support.
  if (beat.sceneIntent && beat.visualSupportsIntent === false) {
    findings.push(finding("VISUAL_NOT_SUPPORTING_SCENE_INTENT", { sceneRef: scene, reason: `visual does not support intent: ${beat.sceneIntent}`, correctiveAction: "PATCH_VISUAL" }));
  }
  return findings;
}

function checkSemanticBeats(beats = [], assetIntents = {}) {
  const findings = [];
  for (const b of beats) findings.push(...checkBeatSemantic(b, assetIntents));
  const blocks = findings.filter((f) => f.severity === "BLOCK");
  return { status: blocks.length ? "FAIL" : findings.length ? "REVIEW_REQUIRED" : "PASS", findings };
}

module.exports = { SEMANTIC_VERSION, checkBeatSemantic, checkSemanticBeats };
