"use strict";

/**
 * Phase 3C §14–§32 — Responsive Timeline Variants (UNFOLDIQ CORE).
 *
 * BASE MASTER TIMELINE → derived variant (layout/reframe plan + variant-only
 * overrides). Variants never mutate base; base changes rebase only affected
 * branches. Layout is data (rects/crops/scales), never component CSS.
 * Full executable rendering stays Phase 4 ownership.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const profiles = require("./profiles.js");

const VARIANT_VERSION = "1.0.0";
const BASE_CANVAS = { width: 1920, height: 1080 }; // canonical 16:9 base

const ROLE_BY_TRACK = {
  VIDEO: "PRIMARY_SUBJECT",
  IMAGE: "PRIMARY_SUBJECT",
  CHART: "CHART",
  MAP: "MAP",
  DIAGRAM: "DIAGRAM",
  OVERLAY: "OVERLAY",
  TITLE: "TITLE",
  CAPTION: "CAPTION",
};
const ROLE_PRIORITY = {
  PRIMARY_SUBJECT: 1, SECONDARY_SUBJECT: 2, CAPTION: 3, TITLE: 4,
  CHART: 5, MAP: 5, DIAGRAM: 5, OVERLAY: 6, BACKGROUND: 7, DECORATIVE: 8,
};
const FIT_POLICIES = ["CONTAIN", "COVER", "SMART_CROP"];
const REPAIR_BUDGET = { maxAttempts: 5, timeBudgetMs: 5000 };

function sha12(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 12);
}
function nowIso() { return new Date().toISOString(); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function finding(code, extra = {}) {
  return { code, severity: extra.severity || "REVIEW", target: extra.target || null, frameRange: extra.frameRange || null, reason: extra.reason || code, correctiveAction: extra.correctiveAction || null };
}
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---------- subject framing (§20–§22) ----------

/**
 * Resolve framing for one item. Decision order: operator override >
 * trusted metadata (DETECTED/EXISTING_METADATA w/ confidence ≥ 0.5) >
 * static bounds > fallback (ASSUMED + REVIEW when critical risk).
 * Never claims tracking without a trackingPath.
 */
function resolveFraming(timelineItemId, subjectMeta = null, operatorAnchor = null) {
  if (operatorAnchor) {
    return { source: "OPERATOR", anchor: operatorAnchor.anchor || "CENTER", bounds: operatorAnchor.bounds || null, trackingPath: operatorAnchor.trackingPath || null, confidence: 1 };
  }
  if (subjectMeta && (subjectMeta.source === "DETECTED" || subjectMeta.source === "EXISTING_METADATA")
    && (subjectMeta.confidence === null || subjectMeta.confidence >= 0.5)
    && (subjectMeta.sourceBounds || subjectMeta.trackingPath)) {
    return {
      source: subjectMeta.source,
      anchor: anchorFromBounds(subjectMeta.sourceBounds),
      bounds: subjectMeta.sourceBounds || null,
      trackingPath: subjectMeta.trackingPath || null,
      confidence: subjectMeta.confidence,
    };
  }
  if (subjectMeta && subjectMeta.sourceBounds) {
    return { source: "ASSUMED", anchor: anchorFromBounds(subjectMeta.sourceBounds), bounds: subjectMeta.sourceBounds, trackingPath: null, confidence: subjectMeta.confidence ?? 0.3 };
  }
  return { source: "FALLBACK", anchor: "CENTER", bounds: null, trackingPath: null, confidence: null };
}

function anchorFromBounds(b) {
  if (!b) return "CENTER";
  const cx = b.x + b.width / 2;
  if (cx < 0.33) return "LEFT";
  if (cx > 0.67) return "RIGHT";
  return "CENTER";
}

/** Smooth a tracking path: moving-average (w=5) + per-step clamp. Returns {path, maxStep, jitter}. */
function smoothPath(raw, maxStep = 0.015) {
  if (!raw || raw.length === 0) return { path: [], maxStep: 0, jitter: 0 };
  const avg = raw.map((p, i) => {
    const win = raw.slice(Math.max(0, i - 2), Math.min(raw.length, i + 3));
    const cx = win.reduce((a, q) => a + q.centerX, 0) / win.length;
    const cy = win.reduce((a, q) => a + q.centerY, 0) / win.length;
    return { frame: p.frame, centerX: cx, centerY: cy, confidence: p.confidence ?? null };
  });
  const path = [avg[0]];
  for (let i = 1; i < avg.length; i++) {
    const prev = path[i - 1];
    const dx = clamp(avg[i].centerX - prev.centerX, -maxStep, maxStep);
    const dy = clamp(avg[i].centerY - prev.centerY, -maxStep, maxStep);
    path.push({ frame: avg[i].frame, centerX: prev.centerX + dx, centerY: prev.centerY + dy, confidence: avg[i].confidence });
  }
  let maxS = 0;
  let jit = 0;
  for (let i = 1; i < path.length; i++) {
    maxS = Math.max(maxS, Math.abs(path[i].centerX - path[i - 1].centerX), Math.abs(path[i].centerY - path[i - 1].centerY));
  }
  for (let i = 2; i < path.length; i++) {
    jit += Math.abs(path[i].centerX - 2 * path[i - 1].centerX + path[i - 2].centerX);
  }
  jit = path.length > 2 ? jit / (path.length - 2) : 0;
  return { path, maxStep: maxS, jitter: jit };
}

function rawJitter(raw) {
  if (!raw || raw.length < 3) return 0;
  let j = 0;
  for (let i = 2; i < raw.length; i++) j += Math.abs(raw[i].centerX - 2 * raw[i - 1].centerX + raw[i - 2].centerX);
  return j / (raw.length - 2);
}

// ---------- geometry ----------

/** Crop window (normalized base-frame coords) for target aspect around anchor. */
function cropWindowFor(profile, anchorX) {
  const baseAspect = BASE_CANVAS.width / BASE_CANVAS.height;
  const targetAspect = profile.width / profile.height;
  if (targetAspect >= baseAspect) return { x: 0, y: 0, w: 1, h: 1 }; // contain/identity
  const cropW = (BASE_CANVAS.height * targetAspect) / BASE_CANVAS.width; // normalized width
  const cx = clamp(anchorX, cropW / 2, 1 - cropW / 2);
  return { x: cx - cropW / 2, y: 0, w: cropW, h: 1 };
}

/** Map a base-frame normalized point into target pixels via crop window. */
function mapToTarget(profile, crop, nx, ny) {
  return {
    x: ((nx - crop.x) / crop.w) * profile.width,
    y: ((ny - crop.y) / crop.h) * profile.height,
  };
}

// ---------- captions (consume Phase 2 intent; reflow only) ----------

function reflowCaption(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? w : w; // overlong single word stays (overflow flagged, never paraphrased)
    }
  }
  if (cur) lines.push(cur);
  return { lines, overflow: lines.length > maxLines || lines.some((l) => l.length > maxChars), wordIdentity: words.join(" ") };
}

// ---------- derivation ----------

/**
 * Derive a responsive variant. Inputs:
 * { projectId, timelineManifest, motionPlan?, profileRef,
 *   subjectMetadataByItem?, operatorAnchorsByItem?, captionCuesByItem?,
 *   titleCuesByItem?, chartMetaByItem?, mapMetaByItem?, variantOverrides? }
 */
function deriveResponsiveVariant(input = {}) {
  const t0 = Date.now();
  const { projectId, timelineManifest, profileRef } = input;
  const profile = profiles.getResponsiveProfile(profileRef);
  if (!projectId || !timelineManifest || !profile) {
    return { ok: false, code: "INPUT_INVALID", message: "projectId + timelineManifest + known profileRef required" };
  }
  const budgets = profiles.captionBudgets();
  const budgetKey = profile.orientation === "PORTRAIT" ? "tiktok" : "youtube";
  const maxChars = (budgets[budgetKey] || { maxChars: 42 }).maxChars;
  const maxLines = 2;

  const variantId = `var-${sha12({ p: projectId, prof: profileRef, rev: timelineManifest.revision || 0, items: timelineManifest.items.map((i) => i.timelineItemId) }).slice(0, 12)}`;
  const layoutItems = [];
  const reframePlans = [];
  const captionLayouts = [];
  const titleLayouts = [];
  const dataLayouts = [];
  const variantOverrides = (input.variantOverrides || []).slice();

  for (const item of timelineManifest.items) {
    const role = ROLE_BY_TRACK[item.trackType];
    if (!role) continue;
    const tid = item.timelineItemId;
    const framing = resolveFraming(tid, (input.subjectMetadataByItem || {})[tid], (input.operatorAnchorsByItem || {})[tid]);
    const anchorX = framing.bounds ? framing.bounds.x + framing.bounds.width / 2 : 0.5;
    const crop = cropWindowFor(profile, anchorX);
    // Operator crop override wins over generated window.
    const opCrop = variantOverrides.find((o) => o.operation === "SET_CROP" && o.target && o.target.timelineItemId === tid);
    const finalCrop = opCrop ? { ...crop, ...opCrop.payload.crop } : crop;
    const fitPolicy = (opCrop && opCrop.payload.fitPolicy) || profile.defaultFitPolicy;

    layoutItems.push({
      timelineItemId: tid,
      role,
      priority: ROLE_PRIORITY[role],
      fitPolicy,
      cropWindow: finalCrop,
      frameRange: { startFrame: item.timelineRange.startFrame, endFrameExclusive: item.timelineRange.endFrameExclusive },
      framingSource: framing.source,
      confidence: framing.confidence,
      operatorOverridden: !!opCrop,
    });

    if (role === "PRIMARY_SUBJECT") {
      const smoothed = framing.trackingPath ? smoothPath(framing.trackingPath) : null;
      const trackedCenter = smoothed && smoothed.path.length
        ? { nx: smoothed.path[Math.floor(smoothed.path.length / 2)].centerX, ny: smoothed.path[Math.floor(smoothed.path.length / 2)].centerY }
        : framing.bounds
          ? { nx: framing.bounds.x + framing.bounds.width / 2, ny: framing.bounds.y + framing.bounds.height / 2 }
          : { nx: 0.5, ny: 0.45 };
      reframePlans.push({
        reframePlanId: `rf-${sha12({ v: variantId, t: tid }).slice(0, 12)}`,
        timelineItemId: tid,
        source: framing.source,
        anchor: framing.anchor,
        subjectCenter: trackedCenter,
        cropWindow: finalCrop,
        trackingPath: smoothed ? smoothed.path : null,
        maxStep: smoothed ? smoothed.maxStep : 0,
        jitter: smoothed ? smoothed.jitter : 0,
        rawJitter: framing.trackingPath ? rawJitter(framing.trackingPath) : 0,
        confidence: framing.confidence,
      });
    }

    const cue = (input.captionCuesByItem || {})[tid];
    if (cue) {
      const rf = reflowCaption(cue.text, maxChars, maxLines);
      const zone = profiles.safeRect(profile, "caption");
      captionLayouts.push({
        timelineItemId: tid,
        lines: rf.lines,
        overflow: rf.overflow,
        wordIdentity: rf.wordIdentity,
        position: { x: zone.x, y: zone.y + zone.height - 2 * 64, width: zone.width, anchor: "BOTTOM_CENTER" },
        fontScale: 1,
        fontScaleRange: { min: 0.8, max: 1.1 },
        safeZone: "caption",
      });
    }
    const tc = (input.titleCuesByItem || {})[tid];
    if (tc || role === "TITLE") {
      const zone = profiles.safeRect(profile, "title");
      titleLayouts.push({
        timelineItemId: tid,
        text: tc ? tc.text : null,
        anchor: (tc && tc.preferredAnchor) || "TOP_CENTER",
        position: { x: zone.x, y: zone.y, width: zone.width, anchor: "TOP_CENTER" },
        fontScale: 1,
        fontScaleRange: { min: 0.85, max: 1.2 },
        canWrap: true,
        canStack: true,
        canReposition: true,
        safeZone: "title",
      });
    }
    if (["CHART", "MAP", "DIAGRAM"].includes(role)) {
      const meta = (input.chartMetaByItem || input.mapMetaByItem || {})[tid] || {};
      const labels = meta.labels || [];
      const longest = labels.reduce((a, l) => Math.max(a, String(l).length), 0);
      const zoneW = profiles.safeRect(profile, "title").width;
      const estLabelPx = longest * 22; // conservative char width at fontScale 1
      dataLayouts.push({
        timelineItemId: tid,
        role,
        strategy: profile.orientation === "PORTRAIT" ? "RE_STACK" : "RESCALE",
        labelPlacement: profile.orientation === "PORTRAIT" ? "BELOW" : "SIDE",
        availableWidthPx: zoneW,
        estimatedLabelPx: estLabelPx,
        readable: estLabelPx <= zoneW,
        legendPreserved: true,
      });
    }
  }

  // Variant-specific motion/transition adaptation (data only; base untouched).
  const motionAdjustments = [];
  if (input.motionPlan) {
    for (const m of input.motionPlan.items) {
      if (!m.primitiveRef) continue;
      const adj = { timelineItemId: m.timelineItemId, basePrimitive: m.primitiveRef, adjustments: {}, reason: "portrait geometry adaptation" };
      if (profile.orientation === "PORTRAIT") {
        if (["PAN", "PUSH", "PULL"].includes(m.primitiveRef)) adj.adjustments.panAmplitudeScale = 0.6;
        if (m.primitiveRef === "PARALLAX") adj.adjustments.parallaxAmplitudeScale = 0.7;
      }
      if (Object.keys(adj.adjustments).length) motionAdjustments.push(adj);
    }
  }
  const transitionAdjustments = [];
  if (input.motionPlan) {
    for (const tr of input.motionPlan.transitions || []) {
      if (tr.primitiveRef === "SLIDE_PUSH" && profile.orientation === "PORTRAIT") {
        transitionAdjustments.push({ transitionId: tr.transitionId, basePrimitive: "SLIDE_PUSH", geometry: { direction: "VERTICAL" }, timingUnchanged: true, reason: "portrait slide axis" });
      }
    }
  }

  const variant = {
    version: VARIANT_VERSION,
    variantId,
    projectId,
    sourceTimelineId: timelineManifest.timelineId || timelineManifest.projectId || projectId,
    sourceTimelineRevision: timelineManifest.revision || 0,
    sourceMotionPlanRevision: input.motionPlan ? input.motionPlan.revision || 0 : 0,
    responsiveProfileRef: profileRef,
    layoutItems,
    reframePlans,
    captionLayouts,
    titleLayouts,
    dataLayouts,
    motionAdjustments,
    transitionAdjustments,
    variantOverrides: variantOverrides.map((o) => o.overrideId || o.operation),
    revision: 1,
    qaStatus: "REVIEW_REQUIRED",
    dependencyHashes: {
      timeline: sha12({ rev: timelineManifest.revision, dur: timelineManifest.canonicalDuration }),
      motionPlan: input.motionPlan ? String(input.motionPlan.revision || 0) : "none",
      profile: profiles.PROFILE_VERSION,
    },
    appliedPatchIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    elapsedMs: Date.now() - t0,
  };
  const qa = validateResponsiveVariant(variant, { timelineManifest, motionPlan: input.motionPlan, profileRef });
  variant.qaStatus = qa.status;
  variant.qa = { status: qa.status, findings: qa.findings };
  return { ok: true, variant, qa };
}

// ---------- QA (§35) ----------

function validateResponsiveVariant(variant, context = {}) {
  const findings = [];
  const profile = profiles.getResponsiveProfile(variant.responsiveProfileRef);
  const man = context.timelineManifest || null;
  if (!profile) {
    return { status: "FAIL", findings: [finding("VARIANT_STALE", { severity: "BLOCK", reason: `unknown profile ${variant.responsiveProfileRef}`, correctiveAction: "REBASE" })] };
  }
  if (man && variant.sourceTimelineRevision !== (man.revision || 0)) {
    findings.push(finding("VARIANT_STALE", { severity: "BLOCK", reason: `variant built for timeline rev ${variant.sourceTimelineRevision}, base is ${man.revision}`, correctiveAction: "REBASE" }));
  }
  const critZone = profiles.safeRect(profile, "criticalSubject");

  for (const rf of variant.reframePlans || []) {
    const meta = (context.subjectMetadataByItem || {})[rf.timelineItemId];
    const subjCenter = rf.subjectCenter
      || (meta && meta.sourceBounds
        ? { nx: meta.sourceBounds.x + meta.sourceBounds.width / 2, ny: meta.sourceBounds.y + meta.sourceBounds.height / 2 }
        : { nx: 0.5, ny: 0.45 });
    const tp = mapToTarget(profile, rf.cropWindow, subjCenter.nx, subjCenter.ny);
    const inCanvas = tp.x >= 0 && tp.x <= profile.width && tp.y >= 0 && tp.y <= profile.height;
    if (!inCanvas) {
      findings.push(finding("SUBJECT_OUT_OF_FRAME", { severity: "BLOCK", target: rf.timelineItemId, reason: "subject center outside variant canvas", correctiveAction: "RECENTER" }));
      continue;
    }
    if (!profiles.pointInRect(tp.x, tp.y, critZone) && rf.source !== "FALLBACK") {
      findings.push(finding("CRITICAL_CONTENT_CROPPED", { severity: "REVIEW", target: rf.timelineItemId, reason: "subject outside critical safe zone", correctiveAction: "APPLY_SUBJECT_ANCHOR" }));
    }
    if (rf.source === "FALLBACK" || rf.confidence === null || (typeof rf.confidence === "number" && rf.confidence < 0.5)) {
      findings.push(finding("REFRAME_LOW_CONFIDENCE", { severity: "REVIEW", target: rf.timelineItemId, reason: `framing source ${rf.source} is not reliable tracking evidence`, correctiveAction: "REVIEW" }));
    }
    if (rf.jitter !== undefined && rf.rawJitter !== undefined && rf.rawJitter > 0.004 && rf.jitter >= rf.rawJitter) {
      findings.push(finding("REFRAME_JITTER", { severity: "REVIEW", target: rf.timelineItemId, reason: `smoothing did not reduce jitter (${rf.jitter.toFixed(5)} vs raw ${rf.rawJitter.toFixed(5)})`, correctiveAction: "INCREASE_SMOOTHING" }));
    }
  }

  for (const lay of variant.layoutItems || []) {
    if (lay.framingSource === "FALLBACK" && lay.role === "PRIMARY_SUBJECT") {
      const cropCoversMost = lay.cropWindow.w >= 0.9;
      if (!cropCoversMost && profile.orientation === "PORTRAIT") {
        findings.push(finding("RESPONSIVE_LAYOUT_CONFLICT", { severity: "REVIEW", target: lay.timelineItemId, reason: "portrait crop without subject evidence risks critical content", correctiveAction: "REVIEW" }));
      }
    }
  }

  for (const c of variant.captionLayouts || []) {
    if (c.overflow) {
      findings.push(finding("CAPTION_OVERFLOW", { severity: "REVIEW", target: c.timelineItemId, reason: `caption exceeds ${c.lines.length} lines / width budget`, correctiveAction: "REFLOW" }));
    }
    const zone = profiles.safeRect(profile, "caption");
    if (c.position.y < zone.y || c.position.y > zone.y + zone.height) {
      findings.push(finding("CAPTION_SAFE_ZONE_FAIL", { severity: "REVIEW", target: c.timelineItemId, reason: "caption position outside caption safe zone", correctiveAction: "REPOSITION" }));
    }
  }
  for (const t of variant.titleLayouts || []) {
    const zone = profiles.safeRect(profile, "title");
    if (t.position.width > zone.width || t.position.y < zone.y) {
      findings.push(finding("TITLE_SAFE_ZONE_FAIL", { severity: "REVIEW", target: t.timelineItemId, reason: "title outside title safe zone", correctiveAction: "REPOSITION" }));
    }
    if (t.fontScale < (t.fontScaleRange ? t.fontScaleRange.min : 0.85)) {
      findings.push(finding("TITLE_OVERFLOW", { severity: "BLOCK", target: t.timelineItemId, reason: "title shrunk below readability bound", correctiveAction: "REVIEW" }));
    }
  }
  for (const d of variant.dataLayouts || []) {
    if (!d.readable) {
      const code = d.role === "CHART" ? "CHART_UNREADABLE" : d.role === "MAP" ? "MAP_LABEL_CROPPED" : "DIAGRAM_LABEL_CROPPED";
      findings.push(finding(code, { severity: "REVIEW", target: d.timelineItemId, reason: `${d.role} labels exceed responsive width (${d.estimatedLabelPx}px > ${d.availableWidthPx}px)`, correctiveAction: "SWITCH_LAYOUT" }));
    }
  }
  // Safe-zone validation for overlays/titles against action zone.
  for (const lay of variant.layoutItems || []) {
    if ((lay.role === "OVERLAY" || lay.role === "TITLE") && lay.cropWindow.w * profile.width < 200) {
      findings.push(finding("SAFE_ZONE_VIOLATION", { severity: "REVIEW", target: lay.timelineItemId, reason: "overlay/title effective width below legibility bound", correctiveAction: "REPOSITION" }));
    }
  }

  const blocks = findings.filter((f) => f.severity === "BLOCK");
  const status = blocks.length ? "FAIL" : findings.length ? "REVIEW_REQUIRED" : "PASS";
  return { status, findings, blocks: blocks.length, reviews: findings.length - blocks.length };
}

// ---------- repair (§36–§37, bounded) ----------

function repairResponsiveVariant(variant, context = {}, budget = {}) {
  const maxAttempts = budget.maxAttempts || REPAIR_BUDGET.maxAttempts;
  const deadline = Date.now() + (budget.timeBudgetMs || REPAIR_BUDGET.timeBudgetMs);
  const applied = [];
  const working = clone(variant);
  let attempts = 0;
  for (; attempts < maxAttempts; attempts++) {
    if (Date.now() > deadline) break;
    const qa = validateResponsiveVariant(working, context);
    const f = qa.findings.find((x) => REPAIRABLE[x.code]);
    if (!f) return { ok: qa.status !== "FAIL", variant: working, qa, applied, attempts: attempts + 1, unresolved: qa.findings };
    if (!REPAIRABLE[f.code](working, f, context)) {
      return { ok: false, variant: working, qa, applied, attempts: attempts + 1, unresolved: qa.findings, stopped: f.code };
    }
    applied.push({ code: f.code, target: f.target });
    working.revision += 1;
    working.updatedAt = nowIso();
  }
  const qa = validateResponsiveVariant(working, context);
  return { ok: qa.status !== "FAIL", variant: working, qa, applied, attempts, unresolved: qa.findings };
}

function recenterCrop(working, f, context) {
  const rf = (working.reframePlans || []).find((r) => r.timelineItemId === f.target);
  const lay = (working.layoutItems || []).find((l) => l.timelineItemId === f.target);
  const meta = (context.subjectMetadataByItem || {})[f.target];
  if (!rf || !lay || !meta || !meta.sourceBounds) return false;
  const profile = profiles.getResponsiveProfile(working.responsiveProfileRef);
  const cx = meta.sourceBounds.x + meta.sourceBounds.width / 2;
  lay.cropWindow = cropWindowFor(profile, cx);
  rf.cropWindow = lay.cropWindow;
  return true;
}

const REPAIRABLE = {
  SUBJECT_OUT_OF_FRAME: (w, f, c) => recenterCrop(w, f, c),
  CRITICAL_CONTENT_CROPPED: (w, f, c) => recenterCrop(w, f, c),
  REFRAME_JITTER: (w, f, c) => {
    const rf = (w.reframePlans || []).find((r) => r.timelineItemId === f.target);
    const meta = (c.subjectMetadataByItem || {})[f.target];
    if (!rf || !meta || !meta.trackingPath) return false;
    const s = smoothPath(meta.trackingPath, 0.008); // increased smoothing
    rf.trackingPath = s.path; rf.maxStep = s.maxStep; rf.jitter = s.jitter;
    return s.jitter < rf.rawJitter || s.maxStep <= 0.008;
  },
  CAPTION_OVERFLOW: (w, f) => {
    const cap = (w.captionLayouts || []).find((x) => x.timelineItemId === f.target);
    if (!cap) return false;
    if (cap.fontScale > cap.fontScaleRange.min) {
      cap.fontScale = Math.max(cap.fontScaleRange.min, +(cap.fontScale - 0.1).toFixed(2));
      return true;
    }
    return false; // never shrink below readability — stays REVIEW_REQUIRED
  },
  CAPTION_SAFE_ZONE_FAIL: (w, f) => {
    const cap = (w.captionLayouts || []).find((x) => x.timelineItemId === f.target);
    const profile = profiles.getResponsiveProfile(w.responsiveProfileRef);
    if (!cap || !profile) return false;
    const zone = profiles.safeRect(profile, "caption");
    cap.position = { x: zone.x, y: zone.y + zone.height - 128, width: zone.width, anchor: "BOTTOM_CENTER" };
    return true;
  },
  TITLE_SAFE_ZONE_FAIL: (w, f) => {
    const t = (w.titleLayouts || []).find((x) => x.timelineItemId === f.target);
    const profile = profiles.getResponsiveProfile(w.responsiveProfileRef);
    if (!t || !profile) return false;
    const zone = profiles.safeRect(profile, "title");
    t.position = { x: zone.x, y: zone.y, width: zone.width, anchor: "TOP_CENTER" };
    return true;
  },
  CHART_UNREADABLE: (w, f) => {
    const d = (w.dataLayouts || []).find((x) => x.timelineItemId === f.target);
    if (!d) return false;
    d.strategy = "SWITCH_RESPONSIVE";
    d.labelPlacement = "BELOW_STACKED";
    d.estimatedLabelPx = Math.round(d.estimatedLabelPx * 0.7);
    d.readable = d.estimatedLabelPx <= d.availableWidthPx;
    return true;
  },
  MAP_LABEL_CROPPED: (w, f) => REPAIRABLE.CHART_UNREADABLE(w, f),
  DIAGRAM_LABEL_CROPPED: (w, f) => REPAIRABLE.CHART_UNREADABLE(w, f),
  SAFE_ZONE_VIOLATION: (w, f) => {
    const lay = (w.layoutItems || []).find((l) => l.timelineItemId === f.target);
    if (!lay) return false;
    lay.cropWindow = { x: 0, y: 0, w: 1, h: 1 };
    return true;
  },
};

// ---------- variant patch (§31–§32) ----------

const VARIANT_PATCH_OPS = ["SET_CROP", "SET_LAYOUT", "SET_SCALE", "SET_POSITION", "SET_SUBJECT_ANCHOR"];

function patchResponsiveVariant(variant, patch = {}) {
  if (!patch.patchId || !VARIANT_PATCH_OPS.includes(patch.op)) {
    return { ok: false, code: "VARIANT_OVERRIDE_CONFLICT", message: `op must be ${VARIANT_PATCH_OPS.join("|")}` };
  }
  if ((variant.appliedPatchIds || []).includes(patch.patchId)) {
    return { ok: true, variant, idempotent: true, applied: { patchId: patch.patchId } };
  }
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== variant.revision) {
    return { ok: false, code: "VARIANT_STALE", message: `expected revision ${patch.expectedRevision}, variant is ${variant.revision}` };
  }
  const working = clone(variant);
  const lay = (working.layoutItems || []).find((l) => l.timelineItemId === patch.targetId);
  if (!lay) return { ok: false, code: "VARIANT_OVERRIDE_CONFLICT", message: "target layout item not found" };
  if (patch.op === "SET_CROP" && patch.crop) lay.cropWindow = { ...lay.cropWindow, ...patch.crop };
  else if (patch.op === "SET_LAYOUT" && patch.fitPolicy) {
    if (!FIT_POLICIES.includes(patch.fitPolicy)) return { ok: false, code: "VARIANT_OVERRIDE_CONFLICT", message: "unknown fit policy" };
    lay.fitPolicy = patch.fitPolicy;
  } else if (patch.op === "SET_SUBJECT_ANCHOR" && patch.anchor) {
    const rf = (working.reframePlans || []).find((r) => r.timelineItemId === patch.targetId);
    if (rf) { rf.anchor = patch.anchor; rf.source = "OPERATOR"; rf.confidence = 1; }
    lay.operatorOverridden = true;
  } else if ((patch.op === "SET_SCALE" || patch.op === "SET_POSITION") && patch.value) {
    lay.operatorLayout = { ...(lay.operatorLayout || {}), [patch.op === "SET_SCALE" ? "scale" : "position"]: patch.value };
    lay.operatorOverridden = true;
  } else {
    return { ok: false, code: "VARIANT_OVERRIDE_CONFLICT", message: "patch payload incomplete" };
  }
  working.appliedPatchIds = [...(working.appliedPatchIds || []), patch.patchId];
  working.revision += 1;
  working.updatedAt = nowIso();
  return { ok: true, variant: working, applied: { patchId: patch.patchId, op: patch.op } };
}

/** Base change → local rebase: recompute affected branches, keep compatible overrides. */
function rebaseVariant(variant, newManifest, newMotionPlan, variantOverrideRecords = []) {
  const working = clone(variant);
  const conflicts = [];
  const preserved = [];
  const newIds = new Set(newManifest.items.map((i) => i.timelineItemId));
  // Drop layout branches whose timeline item is gone; keep the rest.
  working.layoutItems = (working.layoutItems || []).filter((l) => newIds.has(l.timelineItemId));
  working.reframePlans = (working.reframePlans || []).filter((r) => newIds.has(r.timelineItemId));
  for (const rec of variantOverrideRecords) {
    if (!rec.target || !rec.target.timelineItemId) continue;
    if (!newIds.has(rec.target.timelineItemId)) {
      conflicts.push(rec.overrideId);
    } else {
      preserved.push(rec.overrideId);
    }
  }
  if (conflicts.length) {
    working.qaStatus = "REVIEW_REQUIRED";
  }
  working.sourceTimelineRevision = newManifest.revision || 0;
  working.sourceMotionPlanRevision = newMotionPlan ? newMotionPlan.revision || 0 : working.sourceMotionPlanRevision;
  working.dependencyHashes.timeline = sha12({ rev: newManifest.revision, dur: newManifest.canonicalDuration });
  working.revision += 1;
  working.updatedAt = nowIso();
  return { ok: true, variant: working, preserved, conflicts };
}

function resolveVariantInvalidation(change = {}) {
  // change: { scope: "VARIANT_ONLY"|"BASE", variantId? }
  if (change.scope === "VARIANT_ONLY") {
    return {
      variantLayoutBranchDirty: true, variantRenderQADirty: true,
      baseTimelineClean: true, siblingVariantsClean: true,
      finalAudioClean: true, alignmentClean: true, captionsTimingClean: true, sourceMediaClean: true,
    };
  }
  return {
    affectedVariantBranchesDirty: true,
    baseTimelineClean: false,
    finalAudioClean: true, alignmentClean: true, captionsTimingClean: true,
  };
}

// ---------- persistence (workspace governance) ----------

function persistVariant(root, projectId, variant) {
  const ws = require("../workspace/index.js");
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: `variant-${variant.variantId}.json` });
  if (!resolved.ok) return resolved;
  const guard = ws.validateWorkspacePath(root, resolved.path, { projectId });
  if (!guard.ok) return guard;
  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  const tmp = `${resolved.path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(variant, null, 2), "utf8");
  fs.renameSync(tmp, resolved.path);
  return { ok: true, path: resolved.path };
}

function loadVariant(root, projectId, variantId) {
  const ws = require("../workspace/index.js");
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: `variant-${variantId}.json` });
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.path)) return { ok: false, code: "NOT_FOUND", message: "no persisted variant" };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(resolved.path, "utf8")); }
  catch (e) { return { ok: false, code: "REGISTRY_INVALID", message: String((e && e.message) || e) }; }
  if (!raw || raw.variantId !== variantId || !Array.isArray(raw.layoutItems)) {
    return { ok: false, code: "SCHEMA_INVALID", message: "variant shape invalid" };
  }
  return { ok: true, variant: raw, path: resolved.path };
}

// ---------- store ----------

function createVariantStore() {
  const byId = new Map();
  return {
    derive(input, context) {
      const r = deriveResponsiveVariant(input);
      if (r.ok) byId.set(r.variant.variantId, { variant: r.variant });
      return r;
    },
    get(variantId) {
      const e = byId.get(variantId);
      return e ? { ok: true, variant: e.variant } : { ok: false, code: "NOT_FOUND" };
    },
    validate(variantId, context) {
      const e = byId.get(variantId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      return validateResponsiveVariant(e.variant, context || {});
    },
    patch(variantId, patch) {
      const e = byId.get(variantId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const r = patchResponsiveVariant(e.variant, patch);
      if (r.ok && !r.idempotent) byId.set(variantId, { variant: r.variant });
      return r;
    },
    rebase(variantId, newManifest, newMotionPlan, records) {
      const e = byId.get(variantId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const r = rebaseVariant(e.variant, newManifest, newMotionPlan, records || []);
      if (r.ok) byId.set(variantId, { variant: r.variant });
      return r;
    },
  };
}

module.exports = {
  VARIANT_VERSION,
  ROLE_BY_TRACK,
  FIT_POLICIES,
  resolveFraming,
  smoothPath,
  rawJitter,
  cropWindowFor,
  mapToTarget,
  reflowCaption,
  deriveResponsiveVariant,
  validateResponsiveVariant,
  repairResponsiveVariant,
  patchResponsiveVariant,
  rebaseVariant,
  resolveVariantInvalidation,
  persistVariant,
  loadVariant,
  createVariantStore,
};
