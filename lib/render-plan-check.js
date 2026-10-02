"use strict";
// lib/render-plan-check.js — STEP-12 Branch A (Node side).
// Frame-level validation of a render plan. End-exclusive convention:
// every scene/layer/caption/audio range satisfies endFrame > startFrame and
// the final scene endFrame must equal composition durationInFrames.

var fs = require("fs");
var path = require("path");

function issue(code, message, extra) {
  var o = { code: code, message: message, blocking: true };
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
  }
  return o;
}

function warn(code, message, extra) {
  var o = issue(code, message, extra);
  o.blocking = false;
  return o;
}

function checkRange(list, label, issues, opts) {
  var maxEnd = opts && typeof opts.maxEnd === "number" ? opts.maxEnd : null;
  (Array.isArray(list) ? list : []).forEach(function (r) {
    if (!r) return;
    var id = r.sceneId || r.layerId || r.captionId || r.clipId || "?";
    if (typeof r.startFrame !== "number" || typeof r.endFrame !== "number" ||
        r.startFrame < 0 || !(r.endFrame > r.startFrame)) {
      issues.push(issue("INVALID_FRAME_RANGE", label + " " + id + ": need 0 <= startFrame < endFrame"));
      return;
    }
    if (maxEnd !== null && r.endFrame > maxEnd) {
      issues.push(issue("INVALID_FRAME_RANGE", label + " " + id + ": endFrame " + r.endFrame + " exceeds durationInFrames " + maxEnd));
    }
  });
}

function checkRenderPlan(plan, opts) {
  opts = opts || {};
  var checkExists = opts.checkExists !== false;
  var projectRoot = opts.projectRoot || path.join(__dirname, "..");
  var issues = [];
  if (!plan || typeof plan !== "object") {
    return { status: "BLOCKED", issues: [issue("RENDER_PROP_INVALID", "render plan must be an object")] };
  }
  var comp = plan.composition || {};
  var total = comp.durationInFrames;

  var scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  checkRange(scenes, "scene", issues, { maxEnd: typeof total === "number" ? total : null });

  // Ordered scenes, monotonic except explicit overlap (endFrame > next startFrame only when noted).
  var prevEnd = null;
  scenes.forEach(function (s, idx) {
    if (!s) return;
    if (prevEnd !== null && typeof s.startFrame === "number") {
      if (s.startFrame < prevEnd) {
        issues.push(warn("SCENE_OVERLAP", "scene " + s.sceneId + " starts before previous end (explicit overlap preserved)"));
      } else if (idx > 0 && s.startFrame > prevEnd) {
        issues.push(warn("SCENE_GAP", "gap of " + (s.startFrame - prevEnd) + " frames before scene " + s.sceneId));
      }
    }
    if (typeof s.endFrame === "number") prevEnd = s.endFrame;
    checkRange(s.layers, "layer", issues, { maxEnd: typeof total === "number" ? total : null });
    (Array.isArray(s.layers) ? s.layers : []).forEach(function (l) {
      if (!l) return;
      if (typeof s.startFrame === "number" && typeof s.endFrame === "number" &&
          (l.startFrame < s.startFrame || l.endFrame > s.endFrame)) {
        issues.push(issue("INVALID_FRAME_RANGE", "layer " + l.layerId + " exceeds scene " + s.sceneId + " frame bounds"));
      }
    });
  });

  // Coverage: every frame 0..finalFrame covered by a scene block that carries
  // a background or visual layer. Gaps -> VISUAL_GAP.
  if (typeof total === "number" && total > 0 && scenes.length) {
    var covered = new Array(total).fill(false);
    scenes.forEach(function (s) {
      if (!s || !Array.isArray(s.layers) || !s.layers.length) return;
      var from = Math.max(0, s.startFrame);
      var to = Math.min(total, s.endFrame);
      for (var f = from; f < to; f++) covered[f] = true;
    });
    var gapStart = -1;
    for (var g = 0; g <= total; g++) {
      var isCovered = g < total ? covered[g] : true;
      if (!isCovered && gapStart === -1) gapStart = g;
      if ((isCovered || g === total) && gapStart !== -1) {
        issues.push(issue("VISUAL_GAP", "frames " + gapStart + ".." + g + " have no background/scene-visual coverage"));
        gapStart = -1;
      }
    }
    // Background coverage at frame 0.
    if (!covered[0]) {
      issues.push(issue("VISUAL_GAP", "frame 0 has no background coverage"));
    }
    // Final frame convention: last scene endFrame === durationInFrames.
    var lastEnd = scenes.length ? scenes[scenes.length - 1].endFrame : null;
    if (lastEnd !== total) {
      issues.push(issue("INVALID_FRAME_RANGE", "final scene endFrame " + lastEnd + " must equal durationInFrames " + total));
    }
  } else if (typeof total === "number" && total > 0 && !scenes.length) {
    issues.push(issue("VISUAL_GAP", "no scenes cover 0.." + total));
  }

  // Staged refs: must end with a filename and (optionally) exist on disk.
  var assetMap = (plan.assetMap && typeof plan.assetMap === "object") ? plan.assetMap : {};
  Object.keys(assetMap).forEach(function (id) {
    var a = assetMap[id];
    if (!a || typeof a.stagedPath !== "string") {
      issues.push(issue("ASSET_NOT_STAGED", "assetMap entry " + id + " missing stagedPath"));
      return;
    }
    var rel = a.stagedPath.split(path.sep).join("/");
    var base = rel.split("/").pop();
    if (!base || base === "." || base === "..") {
      issues.push(issue("ASSET_NOT_STAGED", "assetMap entry " + id + " stagedPath has no filename"));
      return;
    }
    if (checkExists) {
      var abs = path.resolve(projectRoot, "remotion", "public", rel.split("/").join(path.sep));
      var ok = false;
      try {
        ok = fs.statSync(abs).isFile();
      } catch (e) {
        ok = false;
      }
      if (!ok) {
        issues.push(issue("ASSET_NOT_STAGED", "staged file missing for " + id + ": remotion/public/" + rel, { assetId: id }));
      }
    }
  });

  // Caption + audio frames valid and within total.
  var captionTrack = plan.captionTrack || {};
  checkRange(captionTrack.frames, "caption", issues, { maxEnd: typeof total === "number" ? total : null });
  var tracks = plan.audioTracks || {};
  ["voice", "music", "sfx"].forEach(function (t) {
    checkRange(tracks[t], "audio(" + t + ")", issues, { maxEnd: typeof total === "number" ? total : null });
  });

  if (plan.status === "BLOCKED") {
    issues.push(issue("RENDER_INPUT_BLOCKED", "render plan carries status BLOCKED"));
  }

  var blocked = issues.some(function (i) { return i.blocking; });
  var review = issues.some(function (i) { return !i.blocking; });
  return { status: blocked ? "BLOCKED" : (review ? "REVIEW_REQUIRED" : "READY"), issues: issues };
}

module.exports = {
  checkRenderPlan: checkRenderPlan
};
