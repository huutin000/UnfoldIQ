"use strict";
// lib/render-input-check.js — STEP-12 Branch A (Node side).
// Structural + referential validation of a render input. No rendering.

var fs = require("fs");
var path = require("path");
var Ajv = require("ajv");
var addFormats = require("ajv-formats");
var Time = require("./render-time");

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

function badPath(p) {
  if (typeof p !== "string" || p.length === 0) return true;
  var v = p.split(path.sep).join("/");
  if (v.indexOf("file://") === 0) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return true;
  if (path.isAbsolute(p) || v.charAt(0) === "/") return true;
  var parts = v.split("/");
  return parts.indexOf("..") !== -1;
}

function eachLayer(layers, fn) {
  (Array.isArray(layers) ? layers : []).forEach(function (l) {
    if (!l) return;
    fn(l);
    if (l.kind === "GROUP" && Array.isArray(l.children)) eachLayer(l.children, fn);
  });
}

function checkRenderInput(input) {
  var issues = [];
  if (!input || typeof input !== "object") {
    return { status: "BLOCKED", issues: [issue("RENDER_PROP_INVALID", "render input must be an object")] };
  }

  // Schema structural check.
  try {
    var schemaPath = path.join(__dirname, "..", "schemas", "render-input.schema.json");
    var schema = JSON.parse(fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, ""));
    var ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    var validate = ajv.compile(schema);
    var valid = validate(input);
    if (!valid) {
      (validate.errors || []).forEach(function (e) {
        issues.push(issue("RENDER_PROP_INVALID", "schema: " + (e.instancePath || "/") + " " + e.message));
      });
    }
  } catch (e) {
    issues.push(issue("RENDER_PROP_INVALID", "schema load/compile failed: " + e.message));
  }

  var c = input.composition || {};
  if (!(c.width > 0) || !(c.height > 0) || !(c.fps > 0)) {
    issues.push(issue("COMPOSITION_METADATA_INVALID", "composition dims/fps must be > 0"));
  } else if (typeof c.durationMs === "number") {
    var expected = null;
    try {
      expected = Time.durationMsToFrames(c.durationMs, c.fps);
    } catch (e) {
      issues.push(issue("COMPOSITION_METADATA_INVALID", "duration/frame conversion failed: " + e.message));
    }
    if (expected !== null && c.durationInFrames !== expected) {
      issues.push(issue("INVALID_FRAME_RANGE", "durationInFrames " + c.durationInFrames + " != durationMsToFrames(" + c.durationMs + "," + c.fps + ")=" + expected));
    }
  }
  if (input.timeline && typeof input.timeline.actualTimelineEndMs === "number" &&
      typeof c.durationMs === "number" && input.timeline.actualTimelineEndMs !== c.durationMs) {
    issues.push(issue("COMPOSITION_METADATA_INVALID", "composition.durationMs must equal timeline.actualTimelineEndMs"));
  }

  // Scene ordering / overlap.
  var scenes = Array.isArray(input.scenes) ? input.scenes : [];
  var sceneById = {};
  var prevEnd = null;
  scenes.forEach(function (s, idx) {
    if (!s || typeof s.sceneId !== "string") return;
    sceneById[s.sceneId] = s;
    if (!(s.endMs > s.startMs)) {
      issues.push(issue("RENDER_PROP_INVALID", "scene " + s.sceneId + " endMs must exceed startMs", { sceneId: s.sceneId }));
    }
    if (typeof s.durationMs === "number" && s.durationMs !== s.endMs - s.startMs) {
      issues.push(issue("RENDER_PROP_INVALID", "scene " + s.sceneId + " durationMs mismatch", { sceneId: s.sceneId }));
    }
    if (prevEnd !== null && typeof s.startMs === "number") {
      if (s.startMs < prevEnd) {
        var overlap = scenes[idx - 1] && scenes[idx - 1].overlapMs;
        var cur = s.overlapMs;
        if (typeof overlap === "number" || typeof cur === "number") {
          issues.push(warn("SCENE_OVERLAP", "scene " + s.sceneId + " overlaps previous (explicit overlapMs preserved)", { sceneId: s.sceneId }));
        } else {
          issues.push(issue("RENDER_PROP_INVALID", "scene " + s.sceneId + " overlaps previous scene without explicit overlapMs", { sceneId: s.sceneId }));
        }
      }
    }
    if (typeof s.endMs === "number") prevEnd = s.endMs;
  });

  // Layer times within scene (scene-LOCAL ms) + asset refs.
  var assetMap = (input.assets && typeof input.assets === "object") ? input.assets : {};
  Object.keys(assetMap).forEach(function (id) {
    var a = assetMap[id];
    if (!a) return;
    if (badPath(a.stagedPath) || badPath(a.staticFilePath)) {
      issues.push(issue("ASSET_NOT_STAGED", "asset " + id + " has traversal/absolute/file:// staged path", { assetId: id }));
    }
  });
  scenes.forEach(function (s) {
    if (!s) return;
    var sceneDur = (typeof s.endMs === "number" && typeof s.startMs === "number") ? s.endMs - s.startMs : null;
    eachLayer(s.layers, function (l) {
      if (typeof l.startMs !== "number" || typeof l.endMs !== "number" || !(l.endMs >= l.startMs)) {
        issues.push(issue("RENDER_PROP_INVALID", "layer " + l.layerId + " has invalid local time range", { sceneId: s.sceneId, layerId: l.layerId }));
        return;
      }
      if (sceneDur !== null && (l.startMs < 0 || l.endMs > sceneDur)) {
        issues.push(issue("INVALID_FRAME_RANGE", "layer " + l.layerId + " exceeds scene-local bounds [0," + sceneDur + "]", { sceneId: s.sceneId, layerId: l.layerId }));
      }
      if ((l.kind === "IMAGE" || l.kind === "VIDEO") && l.assetId) {
        if (!Object.prototype.hasOwnProperty.call(assetMap, l.assetId)) {
          issues.push(issue("ASSET_NOT_STAGED", "layer " + l.layerId + " references unknown asset " + l.assetId, { sceneId: s.sceneId, layerId: l.layerId, assetId: l.assetId }));
        }
      }
    });
  });

  // Audio clip refs.
  var audio = input.audio || {};
  ["voice", "music", "sfx"].forEach(function (track) {
    (Array.isArray(audio[track]) ? audio[track] : []).forEach(function (clip) {
      if (!clip) return;
      if (!clip.clipId || !clip.path) {
        issues.push(issue("AUDIO_PLAN_INVALID", "audio clip in " + track + " missing clipId/path"));
      } else if (badPath(clip.path)) {
        issues.push(issue("AUDIO_PLAN_INVALID", "audio clip " + clip.clipId + " has traversal/absolute/file:// path"));
      }
      if (typeof clip.trimEndMs === "number" && typeof clip.trimStartMs === "number" &&
          clip.trimEndMs < clip.trimStartMs) {
        issues.push(issue("AUDIO_PLAN_INVALID", "audio clip " + clip.clipId + " trimEndMs < trimStartMs"));
      }
    });
  });

  // Caption refs.
  var captions = input.captions || {};
  (Array.isArray(captions.items) ? captions.items : []).forEach(function (it) {
    if (!it) return;
    if (!(it.endMs > it.startMs)) {
      issues.push(issue("CAPTION_PLAN_INVALID", "caption " + it.captionId + " endMs must exceed startMs"));
    }
    if (it.sceneId && !Object.prototype.hasOwnProperty.call(sceneById, it.sceneId)) {
      issues.push(issue("CAPTION_PLAN_INVALID", "caption " + it.captionId + " references unknown scene " + it.sceneId));
    }
  });

  if (input.status === "BLOCKED") {
    issues.push(issue("RENDER_INPUT_BLOCKED", "render input carries status BLOCKED"));
  } else if (input.status !== "READY") {
    issues.push(issue("RENDER_INPUT_BLOCKED", "render input status must be READY (got " + input.status + ")"));
  }

  var blocked = issues.some(function (i) { return i.blocking; });
  var review = issues.some(function (i) { return !i.blocking; });
  return { status: blocked ? "BLOCKED" : (review ? "REVIEW_REQUIRED" : "READY"), issues: issues };
}

module.exports = {
  checkRenderInput: checkRenderInput
};
