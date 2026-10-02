"use strict";
// lib/render-gap-check.js — STEP-12 Branch A (Node side).
// Visual-coverage analysis over a render input in milliseconds.
// Designed background (composition.background or a scene background) is
// required; anonymous black tails are never accepted as coverage.

function hasVisualLayer(scene) {
  var found = false;
  function visit(layers) {
    (Array.isArray(layers) ? layers : []).forEach(function (l) {
      if (!l || found) return;
      if (l.kind === "IMAGE" || l.kind === "VIDEO" || l.kind === "BACKGROUND") {
        found = true;
        return;
      }
      if (l.kind === "GROUP" && Array.isArray(l.children)) visit(l.children);
    });
  }
  visit(scene.layers);
  return found;
}

function hasBackgroundHold(scene) {
  var found = false;
  (Array.isArray(scene.layers) ? scene.layers : []).forEach(function (l) {
    if (l && (l.kind === "BACKGROUND" || l.purpose === "background-hold" || l.purpose === "outro-hold")) {
      found = true;
    }
  });
  return found;
}

function clipEndMs(clip) {
  if (!clip || typeof clip.fromMs !== "number") return null;
  if (typeof clip.trimEndMs === "number" && typeof clip.trimStartMs === "number" &&
      clip.trimEndMs > clip.trimStartMs) {
    return clip.fromMs + (clip.trimEndMs - clip.trimStartMs);
  }
  return null;
}

function checkRenderGaps(renderInput) {
  var gaps = [];
  if (!renderInput || typeof renderInput !== "object") {
    return { status: "BLOCKED", gaps: [{ kind: "INVALID_INPUT", message: "render input must be an object" }] };
  }
  var comp = renderInput.composition || {};
  var durationMs = comp.durationMs;
  if (typeof durationMs !== "number" || !(durationMs > 0)) {
    return { status: "BLOCKED", gaps: [{ kind: "INVALID_DURATION", message: "composition.durationMs must be > 0" }] };
  }
  var scenes = Array.isArray(renderInput.scenes) ? renderInput.scenes.slice() : [];
  scenes.sort(function (a, b) { return a.startMs - b.startMs; });

  if (!comp.background && !scenes.some(function (s) { return !!s.background; })) {
    gaps.push({ kind: "NO_DESIGNED_BACKGROUND", startMs: 0, endMs: durationMs, message: "no designed background (composition.background or scene background) required" });
    return { status: "BLOCKED", gaps: gaps };
  }

  // Missing required scene visual -> VISUAL_GAP BLOCKED.
  scenes.forEach(function (s) {
    if (!hasVisualLayer(s)) {
      gaps.push({
        kind: "VISUAL_GAP",
        sceneId: s.sceneId,
        startMs: s.startMs,
        endMs: s.endMs,
        message: "scene " + s.sceneId + " has no IMAGE/VIDEO/BACKGROUND layer"
      });
    }
  });

  // Coverage 0 -> durationMs from scene spans carrying a visual layer.
  var covered = scenes
    .filter(hasVisualLayer)
    .map(function (s) { return { startMs: s.startMs, endMs: s.endMs }; })
    .sort(function (a, b) { return a.startMs - b.startMs; });
  var cursor = 0;
  covered.forEach(function (span) {
    if (span.startMs > cursor) {
      gaps.push({ kind: "UNCOVERED_RANGE", startMs: cursor, endMs: Math.min(span.startMs, durationMs), message: "no scene visual covers " + cursor + ".." + span.startMs + "ms" });
    }
    if (span.endMs > cursor) cursor = span.endMs;
  });
  if (cursor < durationMs) {
    gaps.push({ kind: "UNCOVERED_RANGE", startMs: cursor, endMs: durationMs, message: "no scene visual covers " + cursor + ".." + durationMs + "ms (tail)" });
  }

  // Narration/music extending beyond final visual without explicit outro.
  var lastScene = scenes.length ? scenes[scenes.length - 1] : null;
  var finalVisualEnd = lastScene ? lastScene.endMs : 0;
  var isOutro = !!lastScene && (lastScene.purpose === "outro" || hasBackgroundHold(lastScene));
  var audio = renderInput.audio || {};
  var overruns = [];
  (Array.isArray(audio.voice) ? audio.voice : []).forEach(function (clip) {
    var end = clipEndMs(clip);
    if (end !== null && end > finalVisualEnd) {
      overruns.push({ clipId: clip.clipId, endMs: end });
    }
  });
  (Array.isArray(audio.music) ? audio.music : []).forEach(function (clip) {
    var end = clipEndMs(clip);
    if (end !== null && end > finalVisualEnd) {
      overruns.push({ clipId: clip.clipId, endMs: end });
    }
  });
  if (overruns.length && !isOutro) {
    overruns.forEach(function (o) {
      gaps.push({
        kind: "NARRATION_BEYOND_VISUAL",
        startMs: finalVisualEnd,
        endMs: o.endMs,
        message: "clip " + o.clipId + " ends at " + o.endMs + "ms beyond final visual " + finalVisualEnd + "ms with no explicit outro scene"
      });
    });
  }

  var blocked = gaps.some(function (g) {
    return g.kind === "VISUAL_GAP" || g.kind === "NARRATION_BEYOND_VISUAL" || g.kind === "NO_DESIGNED_BACKGROUND";
  });
  var review = !blocked && gaps.length > 0;
  return { status: blocked ? "BLOCKED" : (review ? "REVIEW" : "CLEAN"), gaps: gaps };
}

module.exports = {
  checkRenderGaps: checkRenderGaps
};
