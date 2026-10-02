"use strict";
// scripts/cli/render-plan-cli.js — STEP-12 Branch A (Node side).
// Usage: node scripts/cli/render-plan-cli.js --project <id> [--json] [--stage-assets]
// Derives the frame-quantized render plan from the render input and writes
// projects/<id>/render/render-plan.json. Never renders.
// Exit: 0 READY, 2 BLOCKED, 1 usage/IO.

var fs = require("fs");
var path = require("path");
var Builder = require("../../lib/render-input-builder.js");
var Time = require("../../lib/render-time.js");
var InputCheck = require("../../lib/render-input-check.js");
var GapCheck = require("../../lib/render-gap-check.js");
var Stager = require("../../lib/asset-stager.js");
var RenderErrors = require("../../lib/render-errors.js");

var ROOT = path.join(__dirname, "..", "..");

function usage() {
  return "Usage: node scripts/cli/render-plan-cli.js --project <id> [--json] [--stage-assets]";
}

function parseArgs(argv) {
  var o = { project: null, json: false, stageAssets: false };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === "--project" && i + 1 < argv.length) {
      o.project = argv[i + 1];
      i++;
    } else if (a.indexOf("--project=") === 0) {
      o.project = a.slice("--project=".length);
    } else if (a === "--json") {
      o.json = true;
    } else if (a === "--stage-assets") {
      o.stageAssets = true;
    } else {
      return { error: "unknown argument: " + a };
    }
  }
  if (!o.project) return { error: "missing --project <id>" };
  return o;
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function existsFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (e) {
    return false;
  }
}

function derivePlan(input, opts) {
  opts = opts || {};
  var fps = input.composition.fps;
  var total = input.composition.durationInFrames;
  var assetMap = {};
  Object.keys(input.assets || {}).forEach(function (id) {
    var a = input.assets[id];
    var e = {
      assetId: a.assetId,
      type: a.type,
      stagedPath: a.stagedPath,
      staticFilePath: a.staticFilePath
    };
    if (opts.sourcePathById && opts.sourcePathById[id]) e.sourcePath = opts.sourcePathById[id];
    if (a.unstaged) e.unstaged = true;
    assetMap[id] = e;
  });

  var scenes = (input.scenes || []).map(function (s) {
    var sr = Time.msRangeToFrames(s.startMs, s.endMs, fps);
    var layers = (s.layers || []).map(function (l) {
      var gs = s.startMs + l.startMs;
      var ge = s.startMs + l.endMs;
      var lr = Time.msRangeToFrames(gs, ge, fps);
      var o = { layerId: l.layerId, kind: l.kind, startFrame: lr.startFrame, endFrame: lr.endFrame };
      if ((l.kind === "IMAGE" || l.kind === "VIDEO") && l.assetId && assetMap[l.assetId]) {
        o.assetStaticPath = assetMap[l.assetId].staticFilePath;
      }
      if (l.kind === "TEXT" && typeof l.text === "string") o.text = l.text;
      return o;
    });
    return { sceneId: s.sceneId, startFrame: sr.startFrame, endFrame: sr.endFrame, layers: layers };
  });

  function clipFrames(clips) {
    return (Array.isArray(clips) ? clips : []).map(function (c) {
      var startFrame = Time.msToFrameStart(c.fromMs || 0, fps);
      var endFrame;
      if (typeof c.trimEndMs === "number" && typeof c.trimStartMs === "number" && c.trimEndMs > c.trimStartMs) {
        endFrame = Time.msRangeToFrames(c.fromMs || 0, (c.fromMs || 0) + (c.trimEndMs - c.trimStartMs), fps).endFrame;
      } else {
        endFrame = total;
      }
      if (!(endFrame > startFrame)) endFrame = startFrame + 1;
      if (endFrame > total) endFrame = total;
      var o = { clipId: c.clipId, startFrame: startFrame, endFrame: endFrame };
      if (c.path) o.path = c.path;
      return o;
    });
  }

  var audio = input.audio || {};
  var captions = input.captions || {};
  var plan = {
    version: "1.0.0",
    projectId: input.projectId,
    platform: input.platform,
    generatedAt: new Date().toISOString(),
    composition: Builder.resolveCompositionMeta(input),
    scenes: scenes,
    audioTracks: {
      voice: clipFrames(audio.voice),
      music: clipFrames(audio.music),
      sfx: clipFrames(audio.sfx)
    },
    captionTrack: {
      mode: captions.mode || "NONE",
      frames: (Array.isArray(captions.items) ? captions.items : []).map(function (it) {
        var r = Time.msRangeToFrames(it.startMs, it.endMs, fps);
        return { captionId: it.captionId, startFrame: r.startFrame, endFrame: r.endFrame };
      })
    },
    assetMap: assetMap,
    styleTokens: JSON.parse(JSON.stringify(input.visualSystem || {})),
    validation: { preflightStatus: "unknown", timelineStatus: "unknown", checks: [] },
    planHash: "",
    status: "READY"
  };

  // Validation evidence.
  var inputCheck = InputCheck.checkRenderInput(input);
  var gapCheck = GapCheck.checkRenderGaps(input);
  plan.validation.checks.push({
    name: "render-input-check",
    status: inputCheck.status,
    detail: inputCheck.issues.length + " issue(s)"
  });
  plan.validation.checks.push({
    name: "render-gap-check",
    status: gapCheck.status,
    detail: gapCheck.gaps.length + " gap(s)"
  });
  if (opts.preflightStatus) plan.validation.preflightStatus = opts.preflightStatus;
  if (opts.timelineStatus) plan.validation.timelineStatus = opts.timelineStatus;
  if (inputCheck.status === "BLOCKED" || gapCheck.status === "BLOCKED") {
    plan.status = "BLOCKED";
  } else if (inputCheck.status === "REVIEW_REQUIRED" || gapCheck.status === "REVIEW") {
    plan.status = "REVIEW_REQUIRED";
  }
  var hashable = JSON.parse(JSON.stringify(plan));
  delete hashable.planHash;
  delete hashable.generatedAt;
  plan.planHash = Builder.hashObject(hashable).slice(0, 16);
  return plan;
}

function main() {
  var args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(usage());
    console.error("error: " + args.error);
    process.exitCode = 1;
    return;
  }
  var projectId = args.project;
  var projectDir = path.join(ROOT, "projects", projectId);
  var renderDir = path.join(projectDir, "render");

  var input;
  try {
    input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: projectId });
  } catch (e) {
    if (RenderErrors.isRenderError(e) && e.code === "RENDER_INPUT_BLOCKED") {
      console.error("BLOCKED: " + e.message);
      process.exitCode = 2;
      return;
    }
    console.error("IO error: " + (e && e.message));
    process.exitCode = 1;
    return;
  }

  var sourcePathById = {};
  try {
    var manifest = readJson(path.join(projectDir, "asset-manifest.json"));
    (Array.isArray(manifest.assets) ? manifest.assets : []).forEach(function (a) {
      if (a && a.assetId && typeof a.path === "string") sourcePathById[a.assetId] = a.path.split(path.sep).join("/");
    });
  } catch (e) {
    sourcePathById = {};
  }
  var preflightStatus = "unknown";
  var timelineStatus = "unknown";
  try {
    preflightStatus = readJson(path.join(projectDir, "preflight", "media-preflight.json")).status || "unknown";
  } catch (e) {}
  try {
    timelineStatus = readJson(path.join(projectDir, "timing", "timeline-measured.json")).status || "unknown";
  } catch (e) {}

  var plan = derivePlan(input, { sourcePathById: sourcePathById, preflightStatus: preflightStatus, timelineStatus: timelineStatus });

  if (args.stageAssets) {
    var stageList = Object.keys(plan.assetMap).map(function (id) {
      var e = plan.assetMap[id];
      if (!e.sourcePath) return null;
      return { assetId: id, sourcePath: e.sourcePath, type: e.type };
    }).filter(Boolean);
    try {
      var entries = Stager.stageAssets({ projectRoot: ROOT, projectId: projectId, assets: stageList });
      var manifestOut = {
        version: "1.0.0",
        projectId: projectId,
        generatedAt: new Date().toISOString(),
        root: Stager.STAGING_ROOT,
        entries: entries
      };
      fs.mkdirSync(renderDir, { recursive: true });
      fs.writeFileSync(path.join(renderDir, "staging-manifest.json"), JSON.stringify(manifestOut, null, 2));
      var byId = {};
      entries.forEach(function (e) { byId[e.assetId] = e; });
      Object.keys(plan.assetMap).forEach(function (id) {
        if (byId[id]) {
          plan.assetMap[id].stagedPath = byId[id].stagedPath;
          plan.assetMap[id].staticFilePath = byId[id].staticFilePath;
          delete plan.assetMap[id].unstaged;
        }
      });
      // Refresh layer assetStaticPath refs after staging.
      plan.scenes.forEach(function (s) {
        (s.layers || []).forEach(function (l) {
          if (l.assetStaticPath) {
            var match = Object.keys(byId).filter(function (id) {
              return plan.assetMap[id] && plan.assetMap[id].staticFilePath === l.assetStaticPath;
            })[0];
            if (match) l.assetStaticPath = byId[match].staticFilePath;
          }
        });
      });
      var hashable = JSON.parse(JSON.stringify(plan));
      delete hashable.planHash;
      delete hashable.generatedAt;
      plan.planHash = Builder.hashObject(hashable).slice(0, 16);
    } catch (e) {
      console.error("stage error: " + (e && e.message));
      process.exitCode = e && e.code === "ASSET_STAGE_FAILED" ? 2 : 1;
      return;
    }
  }

  try {
    fs.mkdirSync(renderDir, { recursive: true });
    fs.writeFileSync(path.join(renderDir, "render-plan.json"), JSON.stringify(plan, null, 2));
  } catch (e) {
    console.error("IO error writing render plan: " + e.message);
    process.exitCode = 1;
    return;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } else {
    process.stdout.write("render-plan " + plan.status + " for " + projectId + ": projects/" + projectId + "/render/render-plan.json (planHash=" + plan.planHash + ")\n");
  }
  process.exitCode = plan.status === "READY" ? 0 : (plan.status === "BLOCKED" ? 2 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  derivePlan: derivePlan
};
