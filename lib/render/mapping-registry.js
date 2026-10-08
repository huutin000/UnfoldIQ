"use strict";

/**
 * Phase 4B §11–§14 — Render Mapping Registry (UNFOLDIQ CORE).
 *
 * Centralized planning→renderer mapping (no scattered switches):
 * MasterTimeline track → render layer kind; 3B MotionPrimitive →
 * renderer MotionPreset/transition; ResponsiveVariant → geometry.
 * Unsupported primitives BLOCK preflight — never silent STATIC.
 */

const REGISTRY_VERSION = "1.0.0";

const TRACK_LAYER_MAP = {
  VIDEO: { rendererComponent: "VideoLayer", supportedTrackTypes: ["VIDEO"], parameterAdapterRef: "video-trim-fit@1.0.0", fallbackPolicy: "BLOCK_IF_MISSING" },
  IMAGE: { rendererComponent: "ImageLayer", supportedTrackTypes: ["IMAGE"], parameterAdapterRef: "image-fit-motion@1.0.0", fallbackPolicy: "BLOCK_IF_MISSING" },
  CHART: { rendererComponent: "ShapeLayer+TextLayer", supportedTrackTypes: ["CHART"], parameterAdapterRef: "chart-text-shape@1.0.0", fallbackPolicy: "TEXT_SHAPE_FALLBACK_DOCUMENTED" },
  MAP: { rendererComponent: "ImageLayer+TextLayer", supportedTrackTypes: ["MAP"], parameterAdapterRef: "map-label-overlay@1.0.0", fallbackPolicy: "LABEL_OVERLAY_DOCUMENTED" },
  DIAGRAM: { rendererComponent: "ShapeLayer+TextLayer", supportedTrackTypes: ["DIAGRAM"], parameterAdapterRef: "diagram-text-shape@1.0.0", fallbackPolicy: "TEXT_SHAPE_FALLBACK_DOCUMENTED" },
  OVERLAY: { rendererComponent: "TextLayer|ShapeLayer", supportedTrackTypes: ["OVERLAY"], parameterAdapterRef: "overlay-passthrough@1.0.0", fallbackPolicy: "BLOCK_IF_MISSING" },
  TITLE: { rendererComponent: "TextLayer", supportedTrackTypes: ["TITLE"], parameterAdapterRef: "title-typography@1.0.0", fallbackPolicy: "BLOCK_IF_MISSING" },
  CAPTION: { rendererComponent: "CaptionTrack", supportedTrackTypes: ["CAPTION"], parameterAdapterRef: "caption-sidecar-burnin@1.0.0", fallbackPolicy: "SIDECAR_IF_BURNIN_UNSUPPORTED" },
  NARRATION: { rendererComponent: "AudioTrack", supportedTrackTypes: ["NARRATION"], parameterAdapterRef: "final-audio-embed@1.0.0", fallbackPolicy: "BLOCK_IF_MISSING" },
  MUSIC: { rendererComponent: "AudioTrack", supportedTrackTypes: ["MUSIC", "SFX", "AMBIENCE"], parameterAdapterRef: "mix-plan-embed@1.0.0", fallbackPolicy: "OMIT_IF_UNMIXED_DOCUMENTED" },
};

// 3B primitive → renderer MotionPreset / transition. Fallback policies:
// DIRECT (1:1) | DOCUMENTED_APPROXIMATION | BLOCKED_NO_SILENT_STATIC.
const PRIMITIVE_RENDER_MAP = {
  PAN: { rendererComponent: "motion:PAN_LEFT|PAN_RIGHT", mapping: "direction-aware pan preset", fallbackPolicy: "DIRECT" },
  ZOOM: { rendererComponent: "motion:SLOW_ZOOM_IN|OUT", mapping: "scale-direction preset", fallbackPolicy: "DIRECT" },
  KEN_BURNS: { rendererComponent: "motion:SLOW_ZOOM_IN", mapping: "slow zoom preset", fallbackPolicy: "DIRECT" },
  PUSH: { rendererComponent: "motion:SLOW_ZOOM_IN", mapping: "push as slow zoom", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  PULL: { rendererComponent: "motion:SLOW_ZOOM_OUT", mapping: "pull as slow zoom out", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  HANDHELD: { rendererComponent: null, mapping: "no handheld renderer", fallbackPolicy: "BLOCKED_NO_SILENT_STATIC" },
  PARALLAX: { rendererComponent: null, mapping: "no layered-depth renderer in V1", fallbackPolicy: "BLOCKED_NO_SILENT_STATIC" },
  REVEAL: { rendererComponent: "transition:FADE", mapping: "reveal as short fade", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  MASK_REVEAL: { rendererComponent: "transition:FADE", mapping: "mask reveal as short fade", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  BLUR_TO_FOCUS: { rendererComponent: "transition:FADE", mapping: "focus pull as fade", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  FOCUS_TO_BLUR: { rendererComponent: "transition:FADE", mapping: "defocus as fade", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  LIGHT_SWEEP: { rendererComponent: null, mapping: "no light-sweep renderer in V1", fallbackPolicy: "BLOCKED_NO_SILENT_STATIC" },
  PARTICLES: { rendererComponent: null, mapping: "no particle renderer in V1", fallbackPolicy: "BLOCKED_NO_SILENT_STATIC" },
  CHART_REVEAL: { rendererComponent: "ShapeLayer+TextLayer stepped", mapping: "step reveal via scene layering", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  CHART_HIGHLIGHT: { rendererComponent: "TextLayer emphasis", mapping: "highlight via text emphasis", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  DIAGRAM_STEP_REVEAL: { rendererComponent: "ShapeLayer+TextLayer stepped", mapping: "step reveal via scene layering", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  PATH_DRAW: { rendererComponent: "ShapeLayer stepped", mapping: "path as stepped shape", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  CUT: { rendererComponent: "transition:CUT", mapping: "hard cut", fallbackPolicy: "DIRECT" },
  FADE: { rendererComponent: "transition:FADE", mapping: "fade", fallbackPolicy: "DIRECT" },
  CROSSFADE: { rendererComponent: "transition:FADE", mapping: "crossfade as fade overlap", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
  SLIDE_PUSH: { rendererComponent: "transition:SLIDE", mapping: "slide", fallbackPolicy: "DIRECT" },
  WIPE: { rendererComponent: "transition:SLIDE", mapping: "wipe as slide", fallbackPolicy: "DOCUMENTED_APPROXIMATION" },
};

function getTrackMapping(trackType) {
  const m = TRACK_LAYER_MAP[trackType];
  return m ? { mappingId: `track:${trackType}`, version: REGISTRY_VERSION, sourceType: `TRACK_${trackType}`, ...m } : null;
}

function getPrimitiveMapping(primitiveId) {
  const m = PRIMITIVE_RENDER_MAP[primitiveId];
  return m ? { mappingId: `primitive:${primitiveId}`, version: REGISTRY_VERSION, sourceType: `PRIMITIVE_${primitiveId}`, ...m } : null;
}

/**
 * Check every motion primitive in a MotionPlan renders or blocks honestly.
 * Returns { ok, unsupported[] } — unsupported must fail preflight (Case B).
 */
function checkPlanRenderable(motionPlan) {
  const unsupported = [];
  for (const item of (motionPlan && motionPlan.items) || []) {
    if (!item.primitiveRef) continue;
    const m = getPrimitiveMapping(item.primitiveRef);
    if (!m) unsupported.push({ primitiveRef: item.primitiveRef, timelineItemId: item.timelineItemId, reason: "unknown primitive" });
    else if (m.fallbackPolicy === "BLOCKED_NO_SILENT_STATIC") {
      unsupported.push({ primitiveRef: item.primitiveRef, timelineItemId: item.timelineItemId, reason: m.mapping });
    }
  }
  for (const tr of (motionPlan && motionPlan.transitions) || []) {
    const m = getPrimitiveMapping(tr.primitiveRef);
    if (!m || m.fallbackPolicy === "BLOCKED_NO_SILENT_STATIC") {
      unsupported.push({ primitiveRef: tr.primitiveRef, transitionId: tr.transitionId, reason: (m && m.mapping) || "unknown transition" });
    }
  }
  return { ok: unsupported.length === 0, unsupported };
}

module.exports = { REGISTRY_VERSION, TRACK_LAYER_MAP, PRIMITIVE_RENDER_MAP, getTrackMapping, getPrimitiveMapping, checkPlanRenderable };
