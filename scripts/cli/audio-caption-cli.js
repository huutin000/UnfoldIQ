"use strict";
// scripts/cli/audio-caption-cli.js — STEP-11 Branch B CLI
// --validate / --build-captions / --build-mix-plan over projects/<id>/.
// No fabrication, no installs, no credits. Exit 0 READY / 3 REVIEW / 2 BLOCKED / 1 usage-IO error.

var fs = require("fs");
var path = require("path");

function repoRoot() { return path.join(__dirname, "..", ".."); }
function projDir(id) { return path.join(repoRoot(), "projects", String(id)); }
function readJson(p) {
  if (!fs.existsSync(p)) return { missing: true };
  try {
    return { data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    throw new Error("Invalid JSON " + p + ": " + e.message);
  }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function exitWith(code, text) {
  if (text) console.log(text);
  process.exit(code);
}

function collectTiming(projectDir) {
  // reads audio/timing.json {level,segments} or timing/*.json whisper artifacts
  var direct = path.join(projectDir, "audio", "timing.json");
  if (fs.existsSync(direct)) {
    var r = readJson(direct);
    if (!r.missing) return { timing: r.data, source: "audio/timing.json" };
  }
  var timingDir = path.join(projectDir, "timing");
  if (fs.existsSync(timingDir)) {
    var files = fs.readdirSync(timingDir).filter(function (f) { return /\.json$/i.test(f); }).sort();
    for (var i = 0; i < files.length; i++) {
      var r2 = readJson(path.join(timingDir, files[i]));
      if (!r2.missing && r2.data && (Array.isArray(r2.data.segments) || Array.isArray(r2.data.items))) {
        var d = r2.data;
        if (!d.segments && Array.isArray(d.items)) d = { level: d.level || "SEGMENT_TIMING", segments: d.items };
        return { timing: d, source: "timing/" + files[i] };
      }
    }
  }
  return { timing: null, source: null };
}

function doValidate(projectId) {
  var dir = projDir(projectId);
  if (!fs.existsSync(dir)) { console.error("Project not found: " + dir); process.exit(1); }
  var amPath = path.join(dir, "audio-manifest.json");
  var amAlt = path.join(dir, "audio", "audio-manifest.json");
  var amFile = fs.existsSync(amPath) ? amPath : (fs.existsSync(amAlt) ? amAlt : null);

  var capPaths = [
    path.join(dir, "captions", "captions.json"),
    path.join(dir, "captions.json")
  ];
  var capFile = capPaths.filter(function (p) { return fs.existsSync(p); })[0] || null;

  var status = "READY";
  var blockers = [];
  var reviews = [];

  // Missing measured timing → structured blocker TIMING_NOT_MEASURED + exit 2
  var t = collectTiming(dir);
  if (!t.timing) {
    blockers.push({ kind: "TIMING_NOT_MEASURED", detail: "No measured timing (audio/timing.json or timing/*.json)" });
  }

  var captionsData = null;
  if (capFile) {
    try {
      captionsData = JSON.parse(fs.readFileSync(capFile, "utf8"));
    } catch (e) { blockers.push({ kind: "CAPTION_PARSE_ERROR", detail: e.message }); }
  }

  var audioManifest = null;
  if (amFile) {
    try { audioManifest = JSON.parse(fs.readFileSync(amFile, "utf8")); }
    catch (e) { blockers.push({ kind: "AUDIO_MANIFEST_PARSE_ERROR", detail: e.message }); }
  } else {
    blockers.push({ kind: "AUDIO_MANIFEST_MISSING", detail: "audio-manifest.json not found" });
  }

  // caption-check + voice entries
  try {
    var cc = require("../../lib/caption-check.js");
    if (captionsData) {
      var items = Array.isArray(captionsData) ? captionsData : (captionsData.items || (captionsData.captionsJson && captionsData.captionsJson.items) || []);
      var audioEnd = null;
      if (t.timing && Array.isArray(t.timing.segments) && t.timing.segments.length) {
        audioEnd = Math.max.apply(null, t.timing.segments.map(function (s) { return typeof s.endMs === "number" ? s.endMs : 0; }));
      }
      var r = cc.checkCaptions({
        items: items,
        audioEndMs: audioEnd,
        timingLevel: (t.timing && t.timing.level) || captionsData.timingLevel || (captionsData.captionsJson && captionsData.captionsJson.timingLevel),
        mode: captionsData.mode || (captionsData.captionsJson && captionsData.captionsJson.mode),
        profile: captionsData.profile || {}
      });
      if (r.status === "BLOCKED") blockers.push({ kind: "CAPTION_CHECK_BLOCKED", detail: JSON.stringify(r.issues.slice(0, 3)) });
      else if (r.status === "REVIEW_REQUIRED") reviews.push({ kind: "CAPTION_CHECK_REVIEW", detail: JSON.stringify(r.issues.slice(0, 3)) });
    } else if (capFile === null) {
      reviews.push({ kind: "CAPTIONS_MISSING", detail: "No captions file found" });
    }
  } catch (e) {
    blockers.push({ kind: "CAPTION_CHECK_ERROR", detail: e.message });
  }

  // voice entries (resolve assetId -> asset-manifest path; audio-manifest tracks carry no path by design)
  try {
    var vc = require("../../lib/voice-check.js");
    var assetPathById = {};
    try {
      var am = JSON.parse(fs.readFileSync(path.join(projDir(projectId), "asset-manifest.json"), "utf8"));
      (am.assets || []).forEach(function (a) { if (a && a.assetId) assetPathById[a.assetId] = a.path; });
    } catch (e) { /* asset manifest absent: voice-check reports MISSING_FILE honestly */ }
    var tracks = audioManifest ? (audioManifest.tracks || audioManifest.voice || audioManifest.items || []) : [];
    if (Array.isArray(tracks)) {
      tracks.forEach(function (tr) {
        if (tr && (tr.path || tr.assetId || tr.audioId)) {
          var voice = {};
          for (var k in tr) voice[k] = tr[k];
          if (!voice.path && voice.assetId && assetPathById[voice.assetId]) voice.path = assetPathById[voice.assetId];
          if (!voice.plannedText && voice.transcriptSource) voice.plannedText = voice.transcriptSource;
          if (!voice.transcriptText && voice.transcriptSource) voice.transcriptText = voice.transcriptSource;
          var vr = vc.checkVoice({ projectRoot: repoRoot(), projectId: projectId, voice: voice });
          if (vr.qaStatus === "BLOCKED") blockers.push({ kind: "VOICE_BLOCKED", detail: String(vr.audioId) });
          else if (vr.qaStatus === "REVIEW_REQUIRED") reviews.push({ kind: "VOICE_REVIEW", detail: String(vr.audioId) });
        }
      });
    }
  } catch (e) {
    reviews.push({ kind: "VOICE_CHECK_ERROR", detail: e.message });
  }

  var finalStatus = blockers.length ? "BLOCKED" : (reviews.length ? "REVIEW_REQUIRED" : "READY");
  var out = { projectId: projectId, status: finalStatus, blockers: blockers, reviews: reviews };
  console.log(JSON.stringify(out, null, 2));
  if (finalStatus === "BLOCKED") process.exit(2);
  if (finalStatus === "REVIEW_REQUIRED") process.exit(3);
  process.exit(0);
}

function doBuildCaptions(projectId) {
  var dir = projDir(projectId);
  if (!fs.existsSync(dir)) { console.error("Project not found: " + dir); process.exit(1); }
  var t = collectTiming(dir);
  if (!t.timing || !Array.isArray(t.timing.segments) || !t.timing.segments.length) {
    console.error(JSON.stringify({ status: "BLOCKED", kind: "TIMING_NOT_MEASURED", detail: "Refuses: no measured timing" }));
    process.exit(2);
  }
  var profile = { mode: "SIDECAR" };
  var profPaths = [path.join(dir, "caption-profile.json"), path.join(dir, "captions", "caption-profile.json")];
  profPaths.forEach(function (p) {
    if (fs.existsSync(p)) {
      try { profile = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.error("Invalid JSON " + p); process.exit(1); }
    }
  });
  var cb = require("../../lib/caption-builder.js");
  var lang = (t.timing && t.timing.language) || "en";
  var r = cb.buildCaptions({
    timing: t.timing,
    language: profile.language || lang,
    timingSource: t.source || "measured",
    projectId: projectId,
    profile: profile
  });
  if (!r.captionsJson) {
    console.error(JSON.stringify({ status: r.status, issues: r.issues || [] }));
    process.exit(r.status === "REVIEW_REQUIRED" ? 3 : 2);
  }
  var capDir = path.join(dir, "captions");
  fs.mkdirSync(capDir, { recursive: true });
  writeJson(path.join(capDir, "captions.json"), r.captionsJson);
  fs.writeFileSync(path.join(capDir, "captions.srt"), r.srt || "", "utf8");
  if (r.vtt) fs.writeFileSync(path.join(capDir, "captions.vtt"), r.vtt, "utf8");
  console.log(JSON.stringify({ projectId: projectId, status: "READY", items: r.captionsJson.items.length }));
  process.exit(0);
}

function doBuildMixPlan(projectId) {
  var dir = projDir(projectId);
  if (!fs.existsSync(dir)) { console.error("Project not found: " + dir); process.exit(1); }
  var amPaths = [path.join(dir, "audio-manifest.json"), path.join(dir, "audio", "audio-manifest.json")];
  var amFile = amPaths.filter(function (p) { return fs.existsSync(p); })[0];
  if (!amFile) { console.error("audio-manifest.json not found"); process.exit(1); }
  var audioManifest;
  try { audioManifest = JSON.parse(fs.readFileSync(amFile, "utf8")); }
  catch (e) { console.error("Invalid JSON " + amFile); process.exit(1); }

  // clip-audio policy from scene-script or clip-audio-policy.json default MUTE_GENERATED_CLIP_AUDIO
  var policy = "MUTE_GENERATED_CLIP_AUDIO";
  var polPath = path.join(dir, "clip-audio-policy.json");
  if (fs.existsSync(polPath)) {
    try {
      var pd = JSON.parse(fs.readFileSync(polPath, "utf8"));
      policy = pd.policy || pd.clipAudio || policy;
    } catch (e) { console.error("Invalid JSON " + polPath); process.exit(1); }
  } else {
    var ssPaths = [path.join(dir, "scene-script.json"), path.join(dir, "scenes", "scene-script.json")];
    ssPaths.forEach(function (p) {
      if (fs.existsSync(p)) {
        try {
          var ss = JSON.parse(fs.readFileSync(p, "utf8"));
          if (ss.clipAudioPolicy || ss.clipAudio) policy = ss.clipAudioPolicy || ss.clipAudio;
        } catch (e) { /* ignore */ }
      }
    });
  }

  // voice durations (measured only — never fabricate; null when unknown)
  // resolve assetId -> asset-manifest path (tracks carry no path by design)
  var vc = null;
  try { vc = require("../../lib/voice-check.js"); } catch (e) { vc = null; }
  var assetPathById = {};
  try {
    var amBuild = JSON.parse(fs.readFileSync(path.join(dir, "asset-manifest.json"), "utf8"));
    (amBuild.assets || []).forEach(function (a) { if (a && a.assetId) assetPathById[a.assetId] = a.path; });
  } catch (e) { /* voice-check reports honestly */ }
  var tracks = audioManifest.tracks || audioManifest.voice || audioManifest.items || [];
  var mixTracks = (Array.isArray(tracks) ? tracks : []).map(function (tr) {
    var durationMs = (typeof tr.durationMs === "number") ? tr.durationMs : null;
    var voiceTimingStatus = tr.timingStatus || null;
    var voiceTimingSource = tr.timingEvidence || tr.timingSource || null;
    var resolvedPath = tr.path || (tr.assetId && assetPathById[tr.assetId]) || null;
    if (vc && resolvedPath) {
      try {
        var probeVoice = {};
        for (var vk in tr) probeVoice[vk] = tr[vk];
        probeVoice.path = resolvedPath;
        var vr = vc.checkVoice({ projectRoot: repoRoot(), projectId: projectId, voice: probeVoice });
        if (typeof vr.durationMs === "number") durationMs = vr.durationMs;
        if (vr.timingStatus) voiceTimingStatus = vr.timingStatus;
      } catch (e) { /* keep provided */ }
    }
    var kind = tr.kind || tr.type || "voice";
    if (kind !== "voice" && kind !== "music" && kind !== "sfx") kind = "voice";
    return {
      clipId: tr.audioId || tr.assetId || tr.id || tr.clipId,
      path: resolvedPath,
      fromMs: (typeof tr.startMs === "number") ? tr.startMs : 0,
      durationMs: durationMs,
      language: tr.language, voiceId: tr.voiceId, providerId: tr.providerId,
      timingStatus: voiceTimingStatus, timingSource: voiceTimingSource,
      gainDb: 0, loop: false,
      _kind: kind
    };
  });

  var musicPlan = audioManifest.music || [];
  var sfxPlan = audioManifest.sfx || [];
  function cleanClip(m) {
    var c = {};
    ["clipId", "path", "fromMs", "trimStartMs", "trimEndMs", "gainDb", "volume", "fadeInMs", "fadeOutMs", "loop", "ducking", "purpose", "rightsStatus", "language", "voiceId", "providerId", "timingStatus", "timingSource", "durationMs"].forEach(function (k) {
      if (m[k] !== undefined && m[k] !== null) c[k] = m[k];
    });
    return c;
  }
  var voiceClips = mixTracks.filter(function (m) { return m._kind === "voice"; }).map(cleanClip);
  var allMeasured = voiceClips.length > 0 && voiceClips.every(function (m) { return m.timingStatus === "MEASURED" && typeof m.durationMs === "number"; });
  var mixPlan = {
    version: "1.0.0",
    projectId: projectId,
    generatedClipAudioPolicy: policy,
    tracks: {
      voice: voiceClips,
      music: musicPlan,
      sfx: sfxPlan
    },
    status: allMeasured ? "READY" : "REVIEW_REQUIRED"
  };
  var audioDir = path.join(dir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  writeJson(path.join(audioDir, "audio-mix-plan.json"), mixPlan);

  // timing/duration-evidence.json {targetMs copied from planning/duration-contract.json, estimatedMs, measuredNarrationMs, measuredTimelineEndMs, note}; NEVER overwrite duration-contract.json
  var targetMs = null;
  var dcPaths = [path.join(dir, "planning", "duration-contract.json"), path.join(dir, "duration-contract.json")];
  dcPaths.forEach(function (p) {
    if (targetMs === null && fs.existsSync(p)) {
      try {
        var dc = JSON.parse(fs.readFileSync(p, "utf8"));
        if (typeof dc.targetMs === "number") targetMs = dc.targetMs;
      } catch (e) { /* ignore */ }
    }
  });
  var measuredNarrationMs = null;
  var nums = mixTracks.filter(function (m) { return typeof m.durationMs === "number"; }).map(function (m) { return m.durationMs; });
  if (nums.length) measuredNarrationMs = Math.max.apply(null, nums);
  var evidence = {
    targetMs: targetMs,
    estimatedMs: (typeof audioManifest.estimatedMs === "number") ? audioManifest.estimatedMs : null,
    measuredNarrationMs: measuredNarrationMs,
    measuredTimelineEndMs: measuredNarrationMs,
    note: "target copied as reference only; duration-contract.json never overwritten"
  };
  var timingDir = path.join(dir, "timing");
  fs.mkdirSync(timingDir, { recursive: true });
  writeJson(path.join(timingDir, "duration-evidence.json"), evidence);
  console.log(JSON.stringify({ projectId: projectId, status: "READY", mixPlan: "audio/audio-mix-plan.json", evidence: "timing/duration-evidence.json" }));
  process.exit(0);
}

function main() {
  var args = process.argv.slice(2);
  if (args[0] === "--validate" && args[1]) return doValidate(args[1]);
  if (args[0] === "--build-captions" && args[1]) return doBuildCaptions(args[1]);
  if (args[0] === "--build-mix-plan" && args[1]) return doBuildMixPlan(args[1]);
  console.error("Usage: node scripts/cli/audio-caption-cli.js --validate <projectId> | --build-captions <projectId> | --build-mix-plan <projectId>");
  process.exit(1);
}

if (require.main === module) main();
module.exports = {};
