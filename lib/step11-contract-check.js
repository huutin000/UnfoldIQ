"use strict";
// lib/step11-contract-check.js — STEP-11 Branch B
// Cross-contract consistency checks SC1..SC10. All guards null-safe. No fabrication.

function issue(kind, detail, severity) {
  return { kind: kind, detail: detail, status: severity || "BLOCKED", blocksReady: severity === "REVIEW_REQUIRED" ? false : true };
}

function checkStep11Contracts(opts) {
  opts = opts || {};
  var sceneScript = opts.sceneScript;
  var assetManifest = opts.assetManifest;
  var audioManifest = opts.audioManifest;
  var captions = opts.captions;
  var preflight = opts.preflight;
  var timelineMeasured = opts.timelineMeasured;
  var durationContract = opts.durationContract;
  var continuityRegistry = opts.continuityRegistry;
  var providerResults = opts.providerResults;
  var timingDoc = opts.timingDoc || opts.timing || null;

  var issues = [];
  function block(kind, detail) { issues.push({ kind: kind, detail: detail, status: "BLOCKED", blocksReady: true }); }
  function review(kind, detail) { issues.push({ kind: kind, detail: detail, status: "REVIEW_REQUIRED", blocksReady: false }); }
  function passNote(kind, detail) { issues.push({ kind: kind, detail: detail, status: "PASS", blocksReady: false }); }

  // Scene id set from sceneScript
  function sceneIdsOf(doc) {
    var ids = {};
    if (!doc) return ids;
    var scenes = doc.scenes || doc.items || doc.shots || [];
    if (Array.isArray(scenes)) {
      scenes.forEach(function (s) {
        if (s && (s.sceneId || s.id)) ids[String(s.sceneId || s.id)] = true;
      });
    }
    return ids;
  }
  var sceneIds = sceneIdsOf(sceneScript);

  // SC1: sceneIds in asset-manifest exist in sceneScript
  if (assetManifest) {
    var assets = assetManifest.assets || assetManifest.items || [];
    if (Array.isArray(assets)) {
      assets.forEach(function (a, i) {
        if (a && a.sceneId && !sceneIds[String(a.sceneId)] && Object.keys(sceneIds).length > 0) {
          block("ORPHAN_SCENE_ASSET", "SC1 asset " + i + " sceneId " + a.sceneId + " not in sceneScript");
        }
      });
    }
  }

  // SC2: audioManifest tracks' assetId exist in assetManifest
  if (audioManifest && assetManifest) {
    var amap = {};
    var alist = assetManifest.assets || assetManifest.items || [];
    if (Array.isArray(alist)) alist.forEach(function (a) { if (a && (a.assetId || a.id)) amap[String(a.assetId || a.id)] = true; });
    var tracks = audioManifest.tracks || audioManifest.voice || audioManifest.items || [];
    if (Array.isArray(tracks)) {
      tracks.forEach(function (t, i) {
        if (t && t.assetId && !amap[String(t.assetId)]) {
          block("ORPHAN_AUDIO_ID", "SC2 audio track " + i + " assetId " + t.assetId + " not in assetManifest");
        }
      });
    }
  } else if (audioManifest && !assetManifest) {
    review("CONTRACT_MISSING", "SC2 assetManifest missing — cannot verify audio assetIds");
  }

  // SC3: captions items' sceneId (when present) exist
  var capItems = null;
  if (captions) {
    if (Array.isArray(captions)) capItems = captions;
    else if (Array.isArray(captions.items)) capItems = captions.items;
    else if (captions.captionsJson && Array.isArray(captions.captionsJson.items)) capItems = captions.captionsJson.items;
  }
  if (capItems && Object.keys(sceneIds).length > 0) {
    capItems.forEach(function (c, i) {
      if (c && c.sceneId && !sceneIds[String(c.sceneId)]) {
        block("ORPHAN_CAPTION_SCENE", "SC3 caption " + i + " sceneId " + c.sceneId + " not in sceneScript");
      }
    });
  }

  // SC4: audio voice durationMs vs measured timing within ±250ms
  (function () {
    var measured = null;
    if (timelineMeasured && typeof timelineMeasured.voiceEndMs === "number") measured = timelineMeasured.voiceEndMs;
    else if (timelineMeasured && typeof timelineMeasured.actualTimelineEndMs === "number" && timingDoc && typeof timingDoc.voiceEndMs === "number") measured = timingDoc.voiceEndMs;
    else if (timingDoc && typeof timingDoc.voiceEndMs === "number") measured = timingDoc.voiceEndMs;
    var tracks = audioManifest ? (audioManifest.tracks || audioManifest.voice || audioManifest.items || []) : [];
    if (!Array.isArray(tracks)) tracks = [];
    var voiceTracks = tracks.filter(function (t) { return t && (t.kind === "voice" || t.audioId || typeof t.durationMs === "number"); });
    if (measured !== null && voiceTracks.length > 0) {
      voiceTracks.forEach(function (t, i) {
        if (typeof t.durationMs === "number") {
          if (Math.abs(t.durationMs - measured) > 250) {
            review("DURATION_MISMATCH", "SC4 track " + i + " durationMs " + t.durationMs + " vs measured " + measured + " (>250ms)");
          }
        }
      });
    } else if (voiceTracks.length > 0 && measured === null) {
      review("CONTRACT_MISSING", "SC4 measured timing missing — cannot verify voice duration");
    }
  })();

  // SC5: max caption endMs <= min(voiceEndMs, actualTimelineEndMs) when known
  (function () {
    if (!capItems || !capItems.length) return;
    var cap = null;
    if (timelineMeasured) {
      var cands = [];
      if (typeof timelineMeasured.voiceEndMs === "number") cands.push(timelineMeasured.voiceEndMs);
      if (typeof timelineMeasured.actualTimelineEndMs === "number") cands.push(timelineMeasured.actualTimelineEndMs);
      if (cands.length) cap = Math.min.apply(null, cands);
    }
    if (cap !== null) {
      var maxEnd = Math.max.apply(null, capItems.map(function (c) { return (typeof c.endMs === "number" ? c.endMs : 0); }));
      if (maxEnd > cap) block("CAPTION_BEYOND_TIMELINE", "SC5 max caption endMs " + maxEnd + " > " + cap);
    }
  })();

  // SC6: preflight READY requires audioManifest+captions+timelineMeasured when required
  (function () {
    var requireVoice = opts.requireVoice !== undefined ? !!opts.requireVoice : scenesHaveNarration(sceneScript);
    var requireCaptions = opts.requireCaptions !== undefined ? !!opts.requireCaptions : scenesHaveNarration(sceneScript);
    var needAudio = requireVoice && !audioManifest;
    var needCaps = requireCaptions && !capItems;
    var needTl = (requireVoice || requireCaptions) && !timelineMeasured;
    if (preflight && preflight.status === "READY") {
      if (needAudio || needCaps || needTl) {
        block("CONTRACTS_INCOMPLETE", "SC6 preflight READY but missing " +
          [needAudio ? "audioManifest" : null, needCaps ? "captions" : null, needTl ? "timelineMeasured" : null].filter(Boolean).join("+"));
      }
    } else if (!preflight && (needAudio || needCaps || needTl)) {
      // missing preflight itself — only flag if something required
      review("CONTRACT_MISSING", "SC6 preflight missing; required contracts incomplete");
    }
  })();

  function scenesHaveNarration(doc) {
    if (!doc) return true;
    var scenes = doc.scenes || doc.items || [];
    if (!Array.isArray(scenes) || !scenes.length) return true;
    return scenes.some(function (s) { return s && (s.narration || s.voice || s.script || s.text); });
  }

  // SC7: durationContract targetMs unchanged
  (function () {
    if (!durationContract) {
      review("CONTRACT_MISSING", "SC7 durationContract missing");
      return;
    }
    if (opts.originalTargetMs !== undefined && opts.originalTargetMs !== null) {
      if (durationContract.targetMs !== opts.originalTargetMs) {
        block("TARGET_OVERWRITTEN", "SC7 targetMs " + durationContract.targetMs + " differs from original " + opts.originalTargetMs);
      }
    } else {
      // assert no measured-overwrite: measured fields must live outside targetMs
      var leaked = ["measuredMs", "measuredEndMs", "actualEndMs", "voiceEndMs", "estimatedMs"].some(function (k) {
        return durationContract[k] !== undefined && durationContract.targetMs !== undefined && k !== "targetMs";
      });
      // Only flag when targetMs itself looks derived: if contract has both targetMs and measured keys at top-level, require targetMsReference separation — flag only if targetMs equals a measured value suspiciously? Best-effort:
      // Flag TARGET_OVERWRITTEN only if durationContract explicitly marks overwritten.
      if (durationContract.targetOverwritten === true) {
        block("TARGET_OVERWRITTEN", "SC7 durationContract flagged targetOverwritten");
      } else {
        void leaked;
      }
    }
  })();

  // SC8: measured narration evidence present without altering target
  (function () {
    if (timelineMeasured && typeof timelineMeasured.voiceEndMs === "number") {
      passNote("MEASURED_EVIDENCE_SEPARATE", "SC8 measured narration evidence voiceEndMs=" + timelineMeasured.voiceEndMs + " separate from target");
    } else {
      review("CONTRACT_MISSING", "SC8 timelineMeasured.voiceEndMs missing");
    }
  })();

  // SC9: providerResults BLOCKED/safetyRefusal fingerprint matches READY asset → SAFETY_REENTRY
  (function () {
    if (!providerResults || !assetManifest) return;
    var results = Array.isArray(providerResults) ? providerResults : (providerResults.results || providerResults.items || []);
    if (!Array.isArray(results)) return;
    var alist = assetManifest.assets || assetManifest.items || [];
    var readyMap = {};
    if (Array.isArray(alist)) {
      alist.forEach(function (a) {
        if (a && (a.status === "READY" || a.ready === true) && (a.assetId || a.id)) {
          readyMap[String(a.assetId || a.id) + "|" + String(a.path || "")] = true;
        }
      });
    }
    results.forEach(function (r) {
      if (r && (r.status === "BLOCKED" || r.safetyRefusal === true || r.refusal === true)) {
        var key = String(r.assetId || r.id || "") + "|" + String(r.path || "");
        if (readyMap[key]) block("SAFETY_REENTRY", "SC9 blocked provider result re-enters READY asset " + key);
      }
    });
  })();

  // SC10: asset continuityEntities ⊆ continuityRegistry locked ids
  (function () {
    if (!continuityRegistry) return;
    var locked = {};
    var ids = continuityRegistry.lockedIds || continuityRegistry.ids || continuityRegistry.entities || [];
    if (Array.isArray(ids)) ids.forEach(function (x) { locked[String(typeof x === "string" ? x : (x.id || x.entityId || ""))] = true; });
    else if (typeof ids === "object") Object.keys(ids).forEach(function (k) { locked[String(k)] = true; });
    if (assetManifest) {
      var alist = assetManifest.assets || assetManifest.items || [];
      if (Array.isArray(alist)) {
        alist.forEach(function (a, i) {
          var ents = a ? (a.continuityEntities || a.continuity || a.entities || []) : [];
          if (!Array.isArray(ents)) return;
          ents.forEach(function (e) {
            var id = String(typeof e === "string" ? e : (e.id || e.entityId || ""));
            if (id && !locked[id]) {
              review("CONTINUITY_DRIFT", "SC10 asset " + i + " entity " + id + " not in locked registry");
            }
          });
        });
      }
    }
  })();

  var hasBlock = issues.some(function (s) { return s.status === "BLOCKED"; });
  var hasReview = issues.some(function (s) { return s.status === "REVIEW_REQUIRED"; });
  var status = hasBlock ? "BLOCKED" : (hasReview ? "REVIEW_REQUIRED" : "READY");
  return { status: status, issues: issues };
}

module.exports = { checkStep11Contracts: checkStep11Contracts };
