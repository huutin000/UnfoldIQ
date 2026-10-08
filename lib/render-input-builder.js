"use strict";
// lib/render-input-builder.js — STEP-12 Branch A (Node side).
// Builds the deterministic render input consumed by both the Node pipeline
// and the Remotion TSX branch. Pure/deterministic: same inputs produce
// deep-equal output. No timestamps in the render input (generatedAt lives
// only in the render plan). No network, no AI, no rendering.
//
// Reads projects/<id>/: scene-script.json, asset-manifest.json,
// preflight/media-preflight.json, audio/audio-mix-plan.json (optional),
// captions/captions.json (optional), timing/timeline-measured.json,
// planning/duration-contract.json (target reference only),
// video-spec.json (explicit composition override, optional),
// continuity-registry.json (version, optional), visual-bible.json
// (style tokens, optional), render/staging-manifest.json (optional),
// plus platforms/<platform>/PROFILE.yaml for canvas dims/fps.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var RenderErrors = require("./render-errors");
var Time = require("./render-time");

var VISUAL_DEFAULTS = {
  background: "#0b0e14",
  foreground: "#f5f7fa",
  muted: "#8a93a6",
  accent: "#4da3ff",
  fontFamily: "system-ui, sans-serif",
  titleSize: 64,
  bodySize: 32,
  captionSize: 28,
  cornerRadius: 8,
  spacing: 16,
  overlayOpacity: 0.55
};

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

function loadYaml(abs) {
  var yaml = require("js-yaml");
  return yaml.load(fs.readFileSync(abs, "utf8"));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  var keys = Object.keys(value).sort();
  return "{" + keys.map(function (k) {
    return JSON.stringify(k) + ":" + stableStringify(value[k]);
  }).join(",") + "}";
}

function hashObject(obj) {
  return crypto.createHash("sha256").update(stableStringify(obj), "utf8").digest("hex");
}

function hash8(obj) {
  return hashObject(obj === undefined ? null : obj).slice(0, 8);
}

function block(reasons, ctx) {
  var c = ctx && typeof ctx === "object" ? ctx : {};
  c.reasons = reasons;
  throw RenderErrors.make("RENDER_INPUT_BLOCKED", "render input blocked: " + reasons.join("; "), c);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function toForward(p) {
  return String(p).split(path.sep).join("/");
}

function resolveCompositionMeta(input) {
  var c = (input && input.composition) || {};
  return {
    id: c.id,
    width: c.width,
    height: c.height,
    fps: c.fps,
    durationMs: c.durationMs,
    durationInFrames: c.durationInFrames,
    background: c.background,
    outputName: c.outputName
  };
}

function buildRenderInput(opts) {
  opts = opts || {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  if (!isNonEmptyString(projectRoot)) {
    throw RenderErrors.make("RENDER_PROP_INVALID", "projectRoot required", { projectId: projectId });
  }
  if (!isNonEmptyString(projectId)) {
    throw RenderErrors.make("RENDER_PROP_INVALID", "projectId required");
  }
  var projDir = path.join(projectRoot, "projects", projectId);
  var reasons = [];
  var warnings = [];

  function need(rel) {
    var abs = path.join(projDir, rel.split("/").join(path.sep));
    if (!existsFile(abs)) {
      reasons.push("missing required input: " + rel);
      return null;
    }
    try {
      return readJson(abs);
    } catch (e) {
      reasons.push("unreadable JSON: " + rel + " (" + e.message + ")");
      return null;
    }
  }

  function optional(rel) {
    var abs = path.join(projDir, rel.split("/").join(path.sep));
    if (!existsFile(abs)) return null;
    try {
      return readJson(abs);
    } catch (e) {
      reasons.push("unreadable JSON: " + rel + " (" + e.message + ")");
      return null;
    }
  }

  var sceneScript = need("scene-script.json");
  var assetManifest = need("asset-manifest.json");
  var preflight = need("preflight/media-preflight.json");
  var timeline = need("timing/timeline-measured.json");
  var mixPlan = optional("audio/audio-mix-plan.json");
  var captionsDoc = optional("captions/captions.json");
  var durationContract = optional("planning/duration-contract.json");
  var videoSpec = optional("video-spec.json");
  var continuityRegistry = optional("continuity-registry.json");
  var visualBible = optional("visual-bible.json");
  var stagingManifest = optional("render/staging-manifest.json");

  if (reasons.length) block(reasons, { projectId: projectId });

  // --- Preflight gates ---
  if (!preflight || preflight.status !== "READY") {
    block(["preflight missing or status != READY (got " + (preflight && preflight.status) + ")"], { projectId: projectId });
  }
  var blockingIssues = Array.isArray(preflight.blockingIssues) ? preflight.blockingIssues : [];
  var preflightIssues = blockingIssues.concat(Array.isArray(preflight.warnings) ? preflight.warnings : []);
  var summary = preflight.timelineSummary || {};
  if (typeof summary.missingRequired === "number" && summary.missingRequired > 0) {
    block(["required asset missing: preflight missingRequired=" + summary.missingRequired], { projectId: projectId });
  }
  var missingIssue = blockingIssues.filter(function (i) {
    return i && typeof i.code === "string" && /MISSING|REQUIRED|NOT_FOUND|ASSET_MISSING/.test(i.code);
  });
  if (missingIssue.length) {
    block(["required asset missing: " + missingIssue.map(function (i) { return i.code; }).join(",")], { projectId: projectId });
  }

  // --- Timeline gate: duration comes ONLY from actualTimelineEndMs ---
  if (!timeline || timeline.status !== "MEASURED") {
    block(["timeline-measured missing or status not MEASURED (got " + (timeline && timeline.status) + ")"], { projectId: projectId });
  }
  var durationMs = timeline.actualTimelineEndMs;
  if (typeof durationMs !== "number" || !isFinite(durationMs) || durationMs <= 0) {
    block(["durationMs underivable from timeline.actualTimelineEndMs"], { projectId: projectId });
  }

  // --- Platform + composition meta ---
  var platform = sceneScript.platform;
  if (platform !== "youtube" && platform !== "tiktok") {
    block(["invalid platform in scene-script: " + String(platform)], { projectId: projectId });
  }
  var width = null;
  var height = null;
  var fps = null;
  var profileVersion = "1.0.0";
  try {
    var profile = loadYaml(path.join(projectRoot, "platforms", platform, "PROFILE.yaml"));
    var defaults = (profile && profile.projectDefaults) || {};
    width = defaults.width;
    height = defaults.height;
    fps = defaults.fps;
    if (profile && profile.captionProfile && isNonEmptyString(profile.captionProfile.profileVersion)) {
      profileVersion = profile.captionProfile.profileVersion;
    }
  } catch (e) {
    block(["cannot load platform PROFILE.yaml for " + platform + ": " + e.message], { projectId: projectId });
  }
  if (videoSpec && videoSpec.composition && typeof videoSpec.composition === "object") {
    var override = videoSpec.composition;
    if (override.width !== undefined) width = override.width;
    if (override.height !== undefined) height = override.height;
    if (override.fps !== undefined) fps = override.fps;
  }
  var dimsValid = [width, height, fps].every(function (n) {
    return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n > 0;
  });
  if (!dimsValid) {
    block(["invalid dims/fps: width=" + width + " height=" + height + " fps=" + fps], { projectId: projectId });
  }

  // --- Scene-script sanity ---
  var scriptScenes = Array.isArray(sceneScript.scenes) ? sceneScript.scenes.slice() : [];
  if (!scriptScenes.length) {
    block(["scene-script has no scenes"], { projectId: projectId });
  }
  scriptScenes.sort(function (a, b) {
    return (a.order || 0) - (b.order || 0);
  });

  // --- Rights gate: BLOCKED asset included in render ---
  var sceneIds = scriptScenes.map(function (s) { return s.sceneId; });
  var preflightAssets = Array.isArray(preflight.assets) ? preflight.assets : [];
  var rightsBlocked = preflightAssets.filter(function (a) {
    if (!a || a.rightsStatus !== "BLOCKED") return false;
    if (a.required === true) return true;
    return isNonEmptyString(a.sceneId) && sceneIds.indexOf(a.sceneId) !== -1;
  });
  if (rightsBlocked.length) {
    block(["rights BLOCKED asset included: " + rightsBlocked.map(function (a) { return a.assetId; }).join(",")], { projectId: projectId });
  }

  // --- STRICT continuity gate ---
  var continuityBlocked = blockingIssues.filter(function (i) {
    return i && typeof i.code === "string" && i.code.indexOf("CONTINUITY") !== -1;
  });
  if (continuityBlocked.length) {
    block(["STRICT continuity unresolved: " + continuityBlocked.map(function (i) { return i.code; }).join(",")], { projectId: projectId });
  }

  // --- Transcript mismatch gate ---
  var mismatch = false;
  if (captionsDoc && captionsDoc.meta && captionsDoc.meta.transcriptMismatch === true && captionsDoc.meta.resolved !== true) {
    mismatch = true;
  }
  if (captionsDoc && captionsDoc.transcriptStatus === "MISMATCH" && captionsDoc.transcriptResolved !== true) {
    mismatch = true;
  }
  if (preflightIssues.some(function (i) {
    return i && typeof i.code === "string" && i.code.indexOf("TRANSCRIPT_MISMATCH") !== -1;
  })) {
    mismatch = true;
  }
  if (mismatch) {
    block(["captions flagged TRANSCRIPT_MISMATCH unresolved"], { projectId: projectId });
  }

  // --- Voice gate ---
  var needsVoice = scriptScenes.some(function (s) {
    return typeof s.narration === "string" && s.narration.trim().length > 0;
  });
  var voiceClips = (mixPlan && mixPlan.tracks && Array.isArray(mixPlan.tracks.voice)) ? mixPlan.tracks.voice : [];
  if (!mixPlan) {
    warnings.push({ code: "AUDIO_MIX_MISSING", message: "audio/audio-mix-plan.json absent: voice/music/sfx empty" });
  }
  if (needsVoice) {
    var measuredVoice = voiceClips.filter(function (c) { return c && c.timingStatus === "MEASURED"; });
    if (!measuredVoice.length) {
      block(["voice required (scenes have narration) but no MEASURED voice track"], { projectId: projectId });
    }
  }

  // --- Visual system ---
  var visualSystem = {};
  Object.keys(VISUAL_DEFAULTS).forEach(function (k) {
    visualSystem[k] = VISUAL_DEFAULTS[k];
  });
  var tokenSource = null;
  if (visualBible && typeof visualBible === "object") {
    if (visualBible.tokens && typeof visualBible.tokens === "object") tokenSource = visualBible.tokens;
    else if (visualBible.style && typeof visualBible.style === "object") tokenSource = visualBible.style;
    else tokenSource = visualBible;
  }
  if (tokenSource) {
    Object.keys(VISUAL_DEFAULTS).forEach(function (k) {
      if (tokenSource[k] !== undefined && tokenSource[k] !== null) visualSystem[k] = tokenSource[k];
    });
  }

  // --- Staged-path resolution ---
  var stagedByAsset = {};
  var stagedBySource = {};
  if (stagingManifest && Array.isArray(stagingManifest.entries)) {
    stagingManifest.entries.forEach(function (e) {
      if (!e) return;
      if (isNonEmptyString(e.assetId)) stagedByAsset[e.assetId] = e;
      if (isNonEmptyString(e.sourcePath)) stagedBySource[e.sourcePath] = e;
    });
  }
  function resolveAssetPath(assetId, projectRelPath) {
    var hit = stagedByAsset[assetId] || stagedBySource[toForward(projectRelPath)];
    if (hit && isNonEmptyString(hit.stagedPath)) {
      return { stagedPath: hit.stagedPath, staticFilePath: hit.staticFilePath || hit.stagedPath, unstaged: false };
    }
    warnings.push({ code: "ASSET_UNSTAGED", message: "asset " + assetId + " not staged: using project-relative path" });
    return { stagedPath: toForward(projectRelPath), staticFilePath: toForward(projectRelPath), unstaged: true };
  }

  // --- Assets map ---
  var manifestAssets = Array.isArray(assetManifest.assets) ? assetManifest.assets : [];
  var assets = {};
  var readyVisualByScene = {};
  manifestAssets.forEach(function (a) {
    if (!a || a.status !== "READY" || !isNonEmptyString(a.assetId)) return;
    var kind = null;
    if (a.type === "image") kind = "image";
    else if (a.type === "video") kind = "video";
    else if (a.type === "voice" || a.type === "music" || a.type === "sfx") kind = "audio";
    else return;
    if (!isNonEmptyString(a.path)) return;
    var r = resolveAssetPath(a.assetId, a.path);
    var entry = {
      assetId: a.assetId,
      type: kind,
      stagedPath: r.stagedPath,
      staticFilePath: r.staticFilePath
    };
    if (typeof a.width === "number" && a.width > 0) entry.width = a.width;
    if (typeof a.height === "number" && a.height > 0) entry.height = a.height;
    if (typeof a.durationMs === "number" && a.durationMs >= 0) entry.durationMs = a.durationMs;
    if (r.unstaged) entry.unstaged = true;
    assets[a.assetId] = entry;
    if ((kind === "image" || kind === "video") && Array.isArray(a.sceneIds)) {
      a.sceneIds.forEach(function (sid) {
        if (!readyVisualByScene[sid]) readyVisualByScene[sid] = entry;
      });
    }
  });
  // Fallback: preflight scene linkage for visuals lacking sceneIds.
  if (Object.keys(readyVisualByScene).length < sceneIds.length) {
    preflightAssets.forEach(function (p) {
      if (!p || (p.type !== "image" && p.type !== "video")) return;
      if (!isNonEmptyString(p.sceneId) || readyVisualByScene[p.sceneId]) return;
      var m = manifestAssets.filter(function (a) { return a && a.assetId === p.assetId && a.status === "READY"; })[0];
      if (m && assets[m.assetId]) readyVisualByScene[p.sceneId] = assets[m.assetId];
    });
  }

  // --- Audio ---
  function mapClip(c, trackName) {
    c = c || {};
    var clipPath = isNonEmptyString(c.path) ? c.path : "";
    var hit = clipPath && stagedBySource[toForward(clipPath)];
    var out = {
      clipId: c.clipId,
      path: hit ? (hit.stagedPath) : toForward(clipPath),
      fromMs: typeof c.fromMs === "number" && c.fromMs >= 0 ? c.fromMs : 0,
      trimStartMs: typeof c.trimStartMs === "number" && c.trimStartMs >= 0 ? c.trimStartMs : 0,
      trimEndMs: typeof c.trimEndMs === "number" && c.trimEndMs >= 0 ? c.trimEndMs : 0,
      gainDb: typeof c.gainDb === "number" ? c.gainDb : 0,
      fadeInMs: typeof c.fadeInMs === "number" && c.fadeInMs >= 0 ? c.fadeInMs : 0,
      fadeOutMs: typeof c.fadeOutMs === "number" && c.fadeOutMs >= 0 ? c.fadeOutMs : 0,
      loop: c.loop === true
    };
    if (typeof c.durationMs === "number" && c.durationMs >= 0) out.durationMs = c.durationMs;
    if (!hit && clipPath) {
      out.unstaged = true;
      warnings.push({ code: "AUDIO_UNSTAGED", message: "audio clip " + c.clipId + " (" + trackName + ") not staged" });
    }
    if (c.ducking && typeof c.ducking === "object") out.ducking = c.ducking;
    return out;
  }
  var audio = {
    voice: voiceClips.map(function (c) { return mapClip(c, "voice"); }),
    music: ((mixPlan && mixPlan.tracks && Array.isArray(mixPlan.tracks.music)) ? mixPlan.tracks.music : []).map(function (c) { return mapClip(c, "music"); }),
    sfx: ((mixPlan && mixPlan.tracks && Array.isArray(mixPlan.tracks.sfx)) ? mixPlan.tracks.sfx : []).map(function (c) { return mapClip(c, "sfx"); }),
    generatedClipAudioPolicy: (mixPlan && mixPlan.generatedClipAudioPolicy) ||
      preflight.generatedClipAudioPolicy || "MUTE_GENERATED_CLIP_AUDIO"
  };

  // --- Captions ---
  var captionMode = "SIDECAR";
  var captionItems = [];
  if (!captionsDoc) {
    captionMode = "NONE";
    warnings.push({ code: "CAPTIONS_MISSING", message: "captions/captions.json absent: mode NONE" });
  } else {
    if (captionsDoc.mode === "NONE" || captionsDoc.mode === "SIDECAR" ||
        captionsDoc.mode === "BURNED_IN" || captionsDoc.mode === "BOTH") {
      captionMode = captionsDoc.mode;
    }
    captionItems = (Array.isArray(captionsDoc.items) ? captionsDoc.items : []).map(function (it) {
      var o = {
        captionId: it.captionId,
        startMs: it.startMs,
        endMs: it.endMs,
        text: it.text
      };
      if (it.sceneId !== undefined) o.sceneId = it.sceneId;
      if (it.words !== undefined) o.words = it.words;
      return o;
    });
  }

  // --- Scenes + layers ---
  var clipPolicy = audio.generatedClipAudioPolicy;
  var scenes = scriptScenes.map(function (s) {
    var t = s.timing || {};
    var startMs = typeof t.startMs === "number" ? t.startMs : null;
    var endMs = typeof t.endMs === "number" ? t.endMs : null;
    if (startMs === null || startMs < 0) startMs = 0;
    if (endMs === null && typeof t.durationMs === "number" && t.durationMs >= 0) {
      endMs = startMs + t.durationMs;
    }
    if (typeof endMs !== "number" || !(endMs > startMs)) {
      block(["invalid scene timing for " + s.sceneId + ": startMs=" + t.startMs + " endMs=" + t.endMs], { projectId: projectId, sceneId: s.sceneId });
    }
    var sceneDur = endMs - startMs;
    var layers = [];
    layers.push({
      layerId: s.sceneId + "_bg",
      kind: "BACKGROUND",
      fill: { kind: "solid", color: visualSystem.background },
      startMs: 0,
      endMs: sceneDur
    });
    var visual = readyVisualByScene[s.sceneId] || null;
    if (visual) {
      var fit = /contain/i.test(String(s.assetRequirement || "")) ? "contain" : "cover";
      if (visual.type === "image") {
        // Phase 4B: optional per-scene camera motion (MotionPlan execution).
        // Absent/invalid → NONE (prior behavior preserved exactly).
        var presetList = ["NONE", "SLOW_ZOOM_IN", "SLOW_ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT", "PAN_UP", "PAN_DOWN", "CUSTOM"];
        var sceneMotion = typeof s.motion === "string" && presetList.indexOf(s.motion) !== -1 ? s.motion : "NONE";
        layers.push({
          layerId: s.sceneId + "_visual",
          kind: "IMAGE",
          assetId: visual.assetId,
          fit: fit,
          position: { x: 0.5, y: 0.5 },
          opacity: 1,
          scale: 1,
          motion: sceneMotion,
          startMs: 0,
          endMs: sceneDur
        });
      } else {
        var trimEnd = typeof visual.durationMs === "number" && visual.durationMs > 0
          ? Math.min(visual.durationMs, sceneDur) : sceneDur;
        layers.push({
          layerId: s.sceneId + "_visual",
          kind: "VIDEO",
          assetId: visual.assetId,
          fit: fit,
          position: { x: 0.5, y: 0.5 },
          opacity: 1,
          trimStartMs: 0,
          trimEndMs: trimEnd,
          muted: clipPolicy !== "USE_AS_PLANNED",
          audioPolicy: clipPolicy === "USE_AS_PLANNED" ? "USE_AS_PLANNED" : "MUTED",
          loop: false,
          startMs: 0,
          endMs: sceneDur
        });
      }
    }
    if (typeof s.onScreenText === "string" && s.onScreenText.length > 0) {
      layers.push({
        layerId: s.sceneId + "_text",
        kind: "TEXT",
        text: s.onScreenText,
        position: { xPct: 50, yPct: 68 },
        widthPct: 80,
        align: "center",
        typographyToken: "body",
        startMs: 0,
        endMs: sceneDur
      });
    }
    var intent = String(s.transitionIntent || "");
    var transition = { type: "CUT" };
    if (/fade/i.test(intent)) {
      transition = { type: "FADE", durationMs: Math.min(300, sceneDur) };
    } else if (/slide/i.test(intent)) {
      transition = { type: "SLIDE", durationMs: Math.min(300, sceneDur) };
    }
    var scene = {
      sceneId: s.sceneId,
      startMs: startMs,
      endMs: endMs,
      durationMs: sceneDur,
      background: visualSystem.background,
      layers: layers,
      transition: transition
    };
    if (typeof s.purpose === "string" && s.purpose.length > 0) scene.purpose = s.purpose;
    if (typeof s.overlapMs === "number" && s.overlapMs >= 0) scene.overlapMs = Math.floor(s.overlapMs);
    return scene;
  });

  // --- Composition + provenance ---
  var durationInFrames = Time.durationMsToFrames(durationMs, fps);
  var composition = {
    id: "UNFOLDIQVideo",
    width: width,
    height: height,
    fps: fps,
    durationMs: durationMs,
    durationInFrames: durationInFrames,
    background: visualSystem.background,
    outputName: projectId
  };

  var remotionVersions = {};
  try {
    var rpj = readJson(path.join(projectRoot, "remotion", "package.json"));
    ["remotion", "@remotion/renderer", "@remotion/bundler", "@remotion/cli"].forEach(function (k) {
      if (rpj.dependencies && rpj.dependencies[k]) remotionVersions[k] = rpj.dependencies[k];
      else if (rpj.devDependencies && rpj.devDependencies[k]) remotionVersions[k] = rpj.devDependencies[k];
    });
  } catch (e) {
    remotionVersions = {};
  }

  var provenance = {
    preflightVersion: isNonEmptyString(preflight.version) ? preflight.version : "unknown",
    timelineHash: hash8(timeline),
    assetManifestHash: hash8(assetManifest),
    audioMixHash: hash8(mixPlan || null),
    captionsHash: hash8(captionsDoc || null),
    visualBibleVersion: (continuityRegistry && isNonEmptyString(continuityRegistry.visualBibleVersion))
      ? continuityRegistry.visualBibleVersion
      : (visualBible && isNonEmptyString(visualBible.version) ? visualBible.version : "default"),
    continuityRegistryVersion: (continuityRegistry && isNonEmptyString(continuityRegistry.version))
      ? continuityRegistry.version : "none",
    durationContractVersion: (durationContract && isNonEmptyString(durationContract.version))
      ? durationContract.version
      : (isNonEmptyString(sceneScript.durationContractVersion) ? sceneScript.durationContractVersion : "none"),
    platformProfileVersion: profileVersion,
    remotionVersions: remotionVersions
  };

  return {
    version: "1.0.0",
    projectId: projectId,
    platform: platform,
    composition: composition,
    timeline: {
      actualTimelineEndMs: durationMs,
      sources: Array.isArray(timeline.sources) ? timeline.sources.slice() : []
    },
    scenes: scenes,
    assets: assets,
    audio: audio,
    captions: { mode: captionMode, items: captionItems },
    visualSystem: visualSystem,
    provenance: provenance,
    warnings: warnings,
    status: "READY"
  };
}

module.exports = {
  buildRenderInput: buildRenderInput,
  resolveCompositionMeta: resolveCompositionMeta,
  hashObject: hashObject
};
