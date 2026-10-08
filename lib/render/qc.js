"use strict";

/**
 * Phase 4B §21–§35, §48–§51 — Final Render Technical QC (UNFOLDIQ CORE).
 *
 * All detectors are context-aware: black/freeze/silence candidates are
 * correlated against timeline intent (RULES 6–9). Intent ranges use seconds.
 * Findings are machine-readable with corrective actions; repair is bounded.
 */

const profiles = require("./export-profile.js");

const QC_VERSION = "1.0.0";
const REPAIR_BUDGET = { maxAttempts: 3, timeBudgetMs: 30000 };

function finding(code, extra = {}) {
  return {
    code,
    severity: extra.severity || "BLOCK",
    timeRange: extra.timeRange || null,
    frameRange: extra.frameRange || null,
    sceneRef: extra.sceneRef || null,
    reason: extra.reason || code,
    correctiveAction: extra.correctiveAction || null,
    evidenceRefs: extra.evidenceRefs || [],
  };
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function inIntent(ranges, start, end, cover = 0.8) {
  // Candidate [start,end] is intended if ≥cover fraction sits in intent ranges.
  const dur = Math.max(end - start, 1e-6);
  let covered = 0;
  for (const r of ranges || []) covered += overlap(start, end, r.start, r.end);
  return covered / dur >= cover;
}

// ---------- profile validation (§21) ----------

function validateProfile(effectiveProfile, evidence) {
  const findings = [];
  const p = effectiveProfile;
  const v = evidence.video;
  const a = evidence.audio;
  if (!v) findings.push(finding("WRONG_VIDEO_CODEC", { reason: "no video stream" }));
  else {
    if (v.codec !== p.video.codec) findings.push(finding("WRONG_VIDEO_CODEC", { reason: `got ${v.codec}, want ${p.video.codec}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
    if (v.width !== p.video.width || v.height !== p.video.height) {
      findings.push(finding("WRONG_RESOLUTION", { reason: `got ${v.width}x${v.height}, want ${p.video.width}x${p.video.height}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
    }
    const wantAspect = p.video.width / p.video.height;
    const gotAspect = v.width / v.height;
    if (Math.abs(gotAspect - wantAspect) / wantAspect > 0.02) {
      findings.push(finding("WRONG_ASPECT_RATIO", { reason: `aspect ${gotAspect.toFixed(3)} ≠ ${wantAspect.toFixed(3)}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
    }
    if (p.video.frameRate) {
      const wantFps = p.video.frameRate.numerator / p.video.frameRate.denominator;
      const gotFps = v.fps && v.fps.includes("/") ? (Number(v.fps.split("/")[0]) / Number(v.fps.split("/")[1])) : Number(v.fps);
      if (!(Math.abs(gotFps - wantFps) < 0.02)) {
        findings.push(finding("WRONG_FRAME_RATE", { reason: `got ${v.fps}, want ${wantFps}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
      }
    }
    if (v.pixFmt !== p.video.pixelFormat) {
      findings.push(finding("WRONG_PIXEL_FORMAT", { reason: `got ${v.pixFmt}, want ${p.video.pixelFormat}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
    }
    // Color tags (GAP-005): missing → REVIEW, mismatch → BLOCK.
    const want = { primaries: p.color.primaries, transfer: p.color.transfer, space: p.color.matrix };
    const tags = { primaries: v.colorPrimaries, transfer: v.colorTransfer, space: v.colorSpace };
    const missing = Object.values(tags).some((t) => !t || t === "unknown");
    if (missing) {
      findings.push(finding("COLOR_TAG_MISSING", { severity: "REVIEW", reason: `encoded color tags incomplete: ${JSON.stringify(tags)}`, correctiveAction: "REVIEW" }));
    } else {
      const norm = (s) => String(s || "").toLowerCase();
      if (norm(tags.primaries) !== norm(want.primaries) || norm(tags.transfer) !== norm(want.transfer) || norm(tags.space) !== norm(want.space)) {
        findings.push(finding("COLOR_TAG_MISMATCH", { reason: `got ${JSON.stringify(tags)}, want BT.709 family`, correctiveAction: "FIX_EXPORT_PROFILE" }));
      }
    }
    if (v.colorRange && v.colorRange !== "unknown" && v.colorRange !== p.color.range && !(p.color.range === "tv" && v.colorRange === "tv")) {
      findings.push(finding("COLOR_RANGE_UNEXPECTED", { severity: "REVIEW", reason: `color range ${v.colorRange}`, correctiveAction: "REVIEW" }));
    }
  }
  if (!a) findings.push(finding("MISSING_AUDIO_CHANNEL", { reason: "no audio stream" }));
  else {
    if (a.codec !== p.audio.codec) findings.push(finding("WRONG_AUDIO_CODEC", { reason: `got ${a.codec}, want ${p.audio.codec}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
    if (a.sampleRate !== p.audio.sampleRate) findings.push(finding("WRONG_AUDIO_SAMPLE_RATE", { reason: `got ${a.sampleRate}, want ${p.audio.sampleRate}`, correctiveAction: "FIX_EXPORT_PROFILE" }));
    if (a.channels !== p.audio.channels) findings.push(finding("MISSING_AUDIO_CHANNEL", { reason: `got ${a.channels}ch, want ${p.audio.channels}ch`, correctiveAction: "FIX_EXPORT_PROFILE" }));
  }
  const fmt = (evidence.format && evidence.format.formatName) || "";
  if (!/mp4|mov/.test(fmt)) findings.push(finding("WRONG_CONTAINER", { reason: `got ${fmt}, want mp4`, correctiveAction: "FIX_EXPORT_PROFILE" }));
  return findings;
}

function validateDuration(evidence, canonicalDurationMs, toleranceSec = 0.6) {
  const got = evidence.format ? evidence.format.duration : null;
  const want = canonicalDurationMs / 1000;
  if (got === null || got === undefined || Number.isNaN(got)) {
    return [finding("DURATION_MISMATCH", { reason: "encoded duration unreadable" })];
  }
  if (Math.abs(got - want) > toleranceSec) {
    return [finding("DURATION_MISMATCH", { reason: `encoded ${got.toFixed(2)}s ≠ canonical ${want.toFixed(2)}s`, correctiveAction: "FIX_RENDER_TIMING" })];
  }
  return [];
}

// ---------- context-aware detectors (§24–§26, §30) ----------

function checkBlack(candidates, intent) {
  const findings = [];
  for (const c of candidates) {
    if (inIntent(intent.expectedBlackRanges, c.start, c.end)) continue; // RULE 9
    findings.push(finding("UNEXPECTED_BLACK_FRAME", { timeRange: c, reason: `black [${c.start.toFixed(2)}, ${c.end.toFixed(2)}]s not in intent`, correctiveAction: "IDENTIFY_MISSING_VISUAL" }));
  }
  return findings;
}

function checkFreeze(candidates, intent) {
  const findings = [];
  for (const c of candidates) {
    if (inIntent(intent.staticRanges, c.start, c.end)) continue; // RULE 7
    findings.push(finding("UNEXPECTED_FREEZE", { timeRange: c, reason: `freeze [${c.start.toFixed(2)}, ${c.end.toFixed(2)}]s where motion expected`, correctiveAction: "REPLACE_SOURCE" }));
  }
  return findings;
}

function checkSilence(candidates, intent) {
  const findings = [];
  for (const c of candidates) {
    if (inIntent(intent.expectedSilenceRanges, c.start, c.end)) continue; // RULE 8
    findings.push(finding("UNEXPECTED_SILENCE", { timeRange: c, reason: `silence [${c.start.toFixed(2)}, ${c.end.toFixed(2)}]s not in intent`, correctiveAction: "REVIEW_INTENT" }));
  }
  return findings;
}

function checkDuplicates(timelineItems) {
  // Adjacent same-asset repeats without narrative reason.
  const findings = [];
  const visuals = (timelineItems || []).filter((i) => ["VIDEO", "IMAGE", "CHART", "MAP", "DIAGRAM"].includes(i.trackType));
  for (let k = 1; k < visuals.length; k++) {
    if (visuals[k].assetId && visuals[k].assetId === visuals[k - 1].assetId && !visuals[k].intentionalRepeat) {
      findings.push(finding("ACCIDENTAL_DUPLICATE_SHOT", { sceneRef: visuals[k].sceneId || null, reason: `asset ${visuals[k].assetId} repeated adjacently without reason`, correctiveAction: "PATCH_SCENE" }));
    }
  }
  return findings;
}

// ---------- audio (§29) ----------

function checkAudio(volume, evidence, intent) {
  const findings = [];
  if (volume.noAudio) {
    findings.push(finding("MISSING_AUDIO_CHANNEL", { reason: "no decodable audio content", correctiveAction: "FIX_RENDER_TIMING" }));
    return findings;
  }
  if (volume.maxVolumeDb !== null && volume.maxVolumeDb >= -0.5) {
    findings.push(finding("AUDIO_CLIPPING", { severity: "REVIEW", reason: `max volume ${volume.maxVolumeDb}dBFS near/over full scale`, correctiveAction: "REVIEW_INTENT" }));
  }
  const dur = evidence.audio && evidence.audio.duration;
  if (dur !== null && dur !== undefined && intent.expectedAudioDurationSec !== undefined) {
    if (Math.abs(dur - intent.expectedAudioDurationSec) > 1.0) {
      findings.push(finding("DURATION_MISMATCH", { reason: `audio ${dur.toFixed(2)}s ≠ expected ${intent.expectedAudioDurationSec.toFixed(2)}s`, correctiveAction: "FIX_RENDER_TIMING" }));
    }
  }
  return findings;
}

// ---------- A/V sync (§31) ----------

function checkAVSync(evidence, intent) {
  const findings = [];
  const v = evidence.video;
  const a = evidence.audio;
  if (!v || !a) return findings;
  if (v.duration !== null && a.duration !== null && Math.abs(v.duration - a.duration) > 0.6) {
    findings.push(finding("ENCODED_AV_DRIFT", { reason: `video ${v.duration.toFixed(2)}s vs audio ${a.duration.toFixed(2)}s`, correctiveAction: "FIX_RENDER_TIMING" }));
  }
  if (intent.expectedAudioDurationSec !== undefined && a.duration !== null && Math.abs(a.duration - intent.expectedAudioDurationSec) > 0.6) {
    findings.push(finding("ENCODED_AV_DRIFT", { reason: `encoded audio ${a.duration.toFixed(2)}s drifted from FinalAudio ${intent.expectedAudioDurationSec.toFixed(2)}s`, correctiveAction: "FIX_RENDER_TIMING" }));
  }
  return findings;
}

// ---------- captions (§32) ----------

function checkCaptions(sidecar, evidence, safeZone) {
  const findings = [];
  const dur = evidence.format ? evidence.format.duration : Infinity;
  const cues = (sidecar && sidecar.cues) || [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.endMs / 1000 > dur + 0.5) {
      findings.push(finding("CAPTION_SYNC_FAIL", { reason: `cue ${c.cueId || i} ends beyond video`, correctiveAction: "PATCH_CAPTIONS" }));
    }
    if (i > 0 && cues[i - 1].text === c.text && c.startMs - cues[i - 1].endMs < 120) {
      findings.push(finding("CAPTION_FLICKER", { severity: "REVIEW", reason: `cue ${c.cueId || i} duplicates previous within 120ms`, correctiveAction: "PATCH_CAPTIONS" }));
    }
  }
  if (safeZone && Array.isArray(safeZone.violations)) {
    for (const t of safeZone.violations) {
      findings.push(finding("CAPTION_SAFE_ZONE_FAIL", { reason: t, correctiveAction: "PATCH_RESPONSIVE_LAYOUT" }));
    }
  }
  return findings;
}

// ---------- outro (§33) ----------

function checkOutro(evidence, intent) {
  const findings = [];
  const dur = evidence.format ? evidence.format.duration : null;
  if (dur === null) return findings;
  if (intent.lastSpeechEndSec !== undefined && intent.lastSpeechEndSec > dur + 0.5) {
    findings.push(finding("OUTRO_CUTOFF", { reason: `speech ends ${intent.lastSpeechEndSec.toFixed(2)}s but video ends ${dur.toFixed(2)}s`, correctiveAction: "FIX_RENDER_TIMING" }));
  }
  if (intent.lastCaptionEndSec !== undefined && intent.lastCaptionEndSec > dur + 0.5) {
    findings.push(finding("OUTRO_CUTOFF", { reason: `caption ends beyond video end`, correctiveAction: "PATCH_CAPTIONS" }));
  }
  return findings;
}

// ---------- safe zone final (GAP-018, §34) ----------

function checkSafeZoneFinal(evidence, effectiveProfile, layoutRects, profileZones) {
  const findings = [];
  if (evidence.video && (evidence.video.width !== effectiveProfile.video.width || evidence.video.height !== effectiveProfile.video.height)) {
    findings.push(finding("SAFE_ZONE_VIOLATION", { reason: "rendered dimensions differ from profile — zone geometry invalid", correctiveAction: "FIX_EXPORT_PROFILE" }));
    return findings;
  }
  for (const r of layoutRects || []) {
    const zone = (profileZones || {})[r.zone];
    if (!zone) continue;
    const inside = r.x >= zone.x && r.y >= zone.y && (r.x + r.width) <= zone.x + zone.width && (r.y + r.height) <= zone.y + zone.height;
    if (!inside) {
      findings.push(finding("SAFE_ZONE_VIOLATION", { sceneRef: r.sceneRef || null, reason: `${r.role} rect outside ${r.zone} safe zone`, correctiveAction: "PATCH_RESPONSIVE_LAYOUT" }));
    }
  }
  return findings;
}

// ---------- flash final (GAP-013, §35; conservative, no certification claim) ----------

function checkFlashFinal(luma) {
  if (!luma.ok) return [finding("FLASH_SAFETY_REVIEW", { severity: "REVIEW", reason: "luminance analysis unavailable", correctiveAction: "REVIEW" })];
  if (luma.maxInWindow > 3) {
    return [finding("FLASH_SAFETY_FAIL", { reason: `${luma.maxInWindow} large luminance transitions within 1s (conservative limit 3)`, correctiveAction: "REPLACE_EFFECT" })];
  }
  if (luma.bigCount > 0) {
    return [finding("FLASH_SAFETY_REVIEW", { severity: "REVIEW", reason: `${luma.bigCount} large luminance transitions detected, inside conservative limit`, correctiveAction: "REVIEW" })];
  }
  return [];
}

// ---------- aggregation + repair routing (§48–§51) ----------

const REPAIR_ROUTE = {
  WRONG_CONTAINER: "FIX_EXPORT_PROFILE", WRONG_VIDEO_CODEC: "FIX_EXPORT_PROFILE", WRONG_AUDIO_CODEC: "FIX_EXPORT_PROFILE",
  WRONG_RESOLUTION: "FIX_EXPORT_PROFILE", WRONG_ASPECT_RATIO: "FIX_EXPORT_PROFILE", WRONG_FRAME_RATE: "FIX_EXPORT_PROFILE",
  WRONG_PIXEL_FORMAT: "FIX_EXPORT_PROFILE", WRONG_AUDIO_SAMPLE_RATE: "FIX_EXPORT_PROFILE", MISSING_AUDIO_CHANNEL: "FIX_EXPORT_PROFILE",
  DURATION_MISMATCH: "FIX_RENDER_TIMING", COLOR_TAG_MISMATCH: "FIX_EXPORT_PROFILE",
  CORRUPT_OUTPUT: "RERENDER", UNEXPECTED_BLACK_FRAME: "IDENTIFY_MISSING_VISUAL", UNEXPECTED_FREEZE: "REPLACE_SOURCE",
  ACCIDENTAL_DUPLICATE_SHOT: "PATCH_SCENE", PLACEHOLDER_RENDERED: "PATCH_SCENE", MISSING_ASSET_RENDERED: "PATCH_SCENE",
  AUDIO_CLIPPING: "REVIEW_INTENT", UNEXPECTED_SILENCE: "REVIEW_INTENT", ENCODED_AV_DRIFT: "FIX_RENDER_TIMING",
  CAPTION_SYNC_FAIL: "PATCH_CAPTIONS", CAPTION_FLICKER: "PATCH_CAPTIONS", CAPTION_SAFE_ZONE_FAIL: "PATCH_RESPONSIVE_LAYOUT",
  OUTRO_CUTOFF: "FIX_RENDER_TIMING", SAFE_ZONE_VIOLATION: "PATCH_RESPONSIVE_LAYOUT",
  FLASH_SAFETY_FAIL: "REPLACE_EFFECT", SEMANTIC_ALIGNMENT_FAIL: "PATCH_VISUAL", FINAL_CONTENT_FAIL: "PATCH_SCENE",
  FINAL_PACKAGING_VIDEO_MISMATCH: "PATCH_PACKAGING",
};

function summarize(findings) {
  const blocks = findings.filter((f) => f.severity === "BLOCK");
  return { status: blocks.length ? "FAIL" : findings.length ? "REVIEW_REQUIRED" : "PASS", blocks: blocks.length, reviews: findings.length - blocks.length };
}

module.exports = {
  QC_VERSION, REPAIR_BUDGET, REPAIR_ROUTE,
  validateProfile, validateDuration,
  checkBlack, checkFreeze, checkSilence, checkDuplicates, checkAudio, checkAVSync,
  checkCaptions, checkOutro, checkSafeZoneFinal, checkFlashFinal,
  summarize,
};
