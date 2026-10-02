"use strict";
// pipeline/auto-fix.js — STEP-13 Branch B (orchestration side).
// planFix({projectRoot,projectId,attempt,issues,qaResults}) -> fix-plan object.
// applyFix({projectRoot,projectId,plan}) executes SAFE_AUTOMATIC actions only,
// each with before/after evidence. No AI, no provider calls, no network.
//
// riskClass is SAFE_AUTOMATIC only when ALL actions are in the allowed set
// AND their preconditions hold; otherwise REVIEW_REQUIRED (human decision
// needed) or UPSTREAM_REQUIRED (a pipeline stage must re-run / fix inputs).

var fs = require("fs");
var path = require("path");

var ALLOWED_ACTIONS = [
  "RESTAGE_ASSET",
  "REBUILD_STAGING_MANIFEST",
  "REBUILD_RENDER_PLAN",
  "REGENERATE_SRT_VTT",
  "LOWER_CONCURRENCY",
  "RAISE_TIMEOUT",
  "CLEAN_TEMP",
  "REPROBE_OUTPUT",
  "REBUILD_METADATA_CACHE"
];

var FORBIDDEN_ACTIONS = [
  "SCRIPT_REWRITE",
  "AI_REGENERATE",
  "PROVIDER_CALL",
  "DROP_CAPTION",
  "MUTE_NARRATION",
  "SHORTEN_DURATION",
  "FILLER_PAD"
];

function tryRequire(abs) {
  try {
    return require(abs);
  } catch (e) {
    return null;
  }
}

function renderConfigModule() {
  return tryRequire(path.join(__dirname, "render-config.js"));
}

function defaultBounds() {
  var mod = renderConfigModule();
  if (mod && typeof mod.resolveConfig === "function") return { via: "render-config" };
  return { via: "local", concurrencyMax: 8, timeoutMaxMs: 600000 };
}

function existsFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (e) {
    return false;
  }
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(abs, obj) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2), "utf8");
}

function loadStateDoc(projectRoot, projectId) {
  try {
    var SS = tryRequire(path.join(__dirname, "state-store.js"));
    if (SS && typeof SS.loadState === "function") return SS.loadState(projectRoot, projectId);
  } catch (e) {}
  try {
    var abs = path.join(projectRoot, "projects", projectId, "render", "pipeline-state.json");
    if (!existsFile(abs)) return null;
    return readJson(abs);
  } catch (e) {
    return null;
  }
}

// fixCycles is derived (Branch A schema top-level is closed): attempts
// carrying a fixPlan.
function fixCountOf(state) {
  var list = (state && Array.isArray(state.attempts)) ? state.attempts : [];
  return list.filter(function (a) { return a && a.fixPlan; }).length;
}

var fixPlanSeq = 0;

function basePlan(attempt) {
  fixPlanSeq += 1;
  return {
    version: "1.0.0",
    planId: "fix-" + Date.now() + "-" + (fixPlanSeq),
    attemptId: (attempt && attempt.attemptId) || null,
    projectId: (attempt && attempt.projectId) || null,
    createdAt: new Date().toISOString(),
    riskClass: "SAFE_AUTOMATIC",
    requiresApproval: false,
    actions: [],
    reason: null,
    cyclesUsed: null
  };
}

function setRisk(plan, riskClass, reason) {
  var order = { SAFE_AUTOMATIC: 0, REVIEW_REQUIRED: 1, UPSTREAM_REQUIRED: 2 };
  if ((order[riskClass] || 0) >= (order[plan.riskClass] || 0)) {
    plan.riskClass = riskClass;
    if (reason && !plan.reason) plan.reason = reason;
    else if (reason) plan.reason += "; " + reason;
  }
  plan.requiresApproval = plan.riskClass !== "SAFE_AUTOMATIC";
  return plan;
}

function errorClassOf(attempt, issues) {
  if (attempt && attempt.error && attempt.error.errorClass) return attempt.error.errorClass;
  var codes = (Array.isArray(issues) ? issues : []).map(function (i) { return i && i.code; });
  if (codes.indexOf("TIMEOUT") !== -1) return "TIMEOUT";
  if (codes.indexOf("TARGET_CLOSED") !== -1 || codes.indexOf("CHROME_CRASH") !== -1) return codes.indexOf("TARGET_CLOSED") !== -1 ? "TARGET_CLOSED" : "CHROME_CRASH";
  if (codes.indexOf("OUT_OF_MEMORY") !== -1) return "OUT_OF_MEMORY";
  if (codes.indexOf("ASSET_MISSING") !== -1 || codes.indexOf("ASSET_NOT_STAGED") !== -1 ||
      codes.indexOf("ASSET_STAGE_FAILED") !== -1) return "ASSET_MISSING";
  if (codes.indexOf("RENDER_PROP_INVALID") !== -1 || codes.indexOf("RENDER_PROP_ERROR") !== -1) return "RENDER_PROP_ERROR";
  return "UNKNOWN";
}

// planFix maps failure evidence -> bounded remediation actions.
// The planner never invents content: every action repairs pipeline state
// (staging, manifests, plans, sidecars, local knobs) from approved sources.
function planFix(args) {
  args = args || {};
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var attempt = args.attempt || null;
  var issues = Array.isArray(args.issues) ? args.issues : [];
  if (!projectRoot || !projectId) throw new Error("planFix: projectRoot + projectId required");

  var plan = basePlan(attempt);
  plan.projectId = projectId;

  // Refuse to plan past the cycle budget (derived from state; enforced in applyFix too).
  var cyclesUsed = fixCountOf(loadStateDoc(projectRoot, projectId));
  plan.cyclesUsed = cyclesUsed;
  var maxCycles = 2;
  try {
    var rc = renderConfigModule();
    if (rc && rc.AUTO_FIX_POLICY && typeof rc.AUTO_FIX_POLICY.maxAutoFixCycles === "number") {
      maxCycles = rc.AUTO_FIX_POLICY.maxAutoFixCycles;
    }
  } catch (e) {}
  if (cyclesUsed >= maxCycles) {
    plan.actions = [];
    setRisk(plan, "REVIEW_REQUIRED", "MAX_FIX_CYCLES: fixCycles=" + cyclesUsed + " >= " + maxCycles);
    return plan;
  }

  var cls = errorClassOf(attempt, issues);

  function push(action) {
    if (ALLOWED_ACTIONS.indexOf(action.type) === -1) {
      var err = new Error("FORBIDDEN_FIX: action type not allowed: " + action.type);
      err.code = "FORBIDDEN_FIX";
      throw err;
    }
    plan.actions.push(action);
  }

  if (cls === "TIMEOUT") {
    push({ type: "RAISE_TIMEOUT", params: {}, evidence: "errorClass=TIMEOUT" });
    push({ type: "LOWER_CONCURRENCY", params: {}, evidence: "errorClass=TIMEOUT" });
  } else if (cls === "TARGET_CLOSED" || cls === "CHROME_CRASH" || cls === "OUT_OF_MEMORY") {
    push({ type: "LOWER_CONCURRENCY", params: {}, evidence: "errorClass=" + cls });
    push({ type: "CLEAN_TEMP", params: {}, evidence: "errorClass=" + cls });
  } else if (cls === "ASSET_MISSING") {
    // RESTAGE_ASSET needs a valid approved source path present; otherwise
    // the fix is upstream (asset must be provided/fixed first).
    var missingIds = [];
    issues.forEach(function (i) {
      if (i && i.assetId && missingIds.indexOf(i.assetId) === -1) missingIds.push(i.assetId);
    });
    var manifest = null;
    try {
      manifest = readJson(path.join(projectRoot, "projects", projectId, "asset-manifest.json"));
    } catch (e) {}
    var byId = {};
    (manifest && Array.isArray(manifest.assets) ? manifest.assets : []).forEach(function (a) {
      if (a && a.assetId) byId[a.assetId] = a;
    });
    if (attempt && attempt.error && attempt.error.detail) {
      var m = String(attempt.error.detail).match(/[A-Za-z0-9_-]+(?:\.(?:png|jpg|jpeg|mp4|wav|mp3|webm|mov|gif))?/g) || [];
      m.forEach(function (id) {
        if (missingIds.indexOf(id) !== -1 || id.length <= 2) return;
        // Prose noise guard: free-text detail ("source missing for ...")
        // tokenizes into English words; only manifest assetIds or
        // filename-like tokens count as missing-asset evidence.
        if (Object.prototype.hasOwnProperty.call(byId, id)) {
          missingIds.push(id);
        } else if (/\.(?:png|jpg|jpeg|mp4|wav|mp3|webm|mov|gif)$/i.test(id)) {
          missingIds.push(id);
        }
      });
    }
    push({ type: "REBUILD_STAGING_MANIFEST", params: {}, evidence: "errorClass=ASSET_MISSING" });
    if (!missingIds.length) {
      setRisk(plan, "UPSTREAM_REQUIRED", "ASSET_MISSING with no identifiable assetId; upstream must supply the asset");
    } else {
      var unresolvable = [];
      missingIds.slice(0, 8).forEach(function (id) {
        var entry = byId[id];
        var okSource = entry && typeof entry.path === "string" && entry.path.length > 0 &&
          existsFile(path.join(projectRoot, "projects", projectId, String(entry.path).split("/").join(path.sep)));
        if (okSource) {
          push({ type: "RESTAGE_ASSET", params: { assetId: id }, evidence: "approved source present: " + entry.path });
        } else {
          unresolvable.push(id);
        }
      });
      if (unresolvable.length) {
        setRisk(plan, "UPSTREAM_REQUIRED", "no approved source present for: " + unresolvable.join(","));
      }
    }
  } else if (cls === "RENDER_PROP_ERROR" || cls === "RENDER_PROP_INVALID") {
    push({ type: "REBUILD_RENDER_PLAN", params: {}, evidence: "errorClass=" + cls });
    setRisk(plan, "REVIEW_REQUIRED", "prop errors need input review after plan rebuild");
  } else if (cls === "FFMPEG_ERROR" || cls === "ASSET_DECODE_ERROR") {
    push({ type: "REPROBE_OUTPUT", params: {}, evidence: "errorClass=" + cls });
    setRisk(plan, "REVIEW_REQUIRED", cls + " needs human/agent review of the failing asset or encode");
  } else if (cls === "DISK_FULL" || cls === "PERMISSION_ERROR") {
    setRisk(plan, "UPSTREAM_REQUIRED", cls + " is environmental; operator must free space or fix permissions");
  } else if (cls === "CANCELLED") {
    setRisk(plan, "REVIEW_REQUIRED", "cancelled work is never auto-fixed");
  } else {
    push({ type: "REBUILD_METADATA_CACHE", params: {}, evidence: "errorClass=UNKNOWN diagnostic" });
    setRisk(plan, "REVIEW_REQUIRED", "UNKNOWN error class: diagnose before retry");
  }

  // Caption-sidecar staleness (from QA results) maps to regeneration from
  // canonical captions.json — never dropped, never muted.
  var qa = args.qaResults || (attempt && attempt.technicalQa) || null;
  if (qa && (qa.captionsStale === true || qa.captionSidecarStale === true)) {
    var capAbs = path.join(projectRoot, "projects", projectId, "captions", "captions.json");
    if (existsFile(capAbs)) {
      push({ type: "REGENERATE_SRT_VTT", params: {}, evidence: "qa flagged stale caption sidecar" });
    } else {
      setRisk(plan, "UPSTREAM_REQUIRED", "caption sidecar stale but canonical captions.json absent");
    }
  }

  if (!plan.actions.length && plan.riskClass === "SAFE_AUTOMATIC") {
    setRisk(plan, "REVIEW_REQUIRED", "no safe remediation derived from evidence");
  }
  plan.requiresApproval = plan.riskClass !== "SAFE_AUTOMATIC";
  void defaultBounds;
  return plan;
}

// applyFix executes SAFE_AUTOMATIC actions only, each with before/after
// evidence. Forbidden types throw FORBIDDEN_FIX. Cycle budget is enforced
// against derived state fix count (attempts carrying a fixPlan).
function applyFix(args) {
  args = args || {};
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var plan = args.plan;
  if (!projectRoot || !projectId) throw new Error("applyFix: projectRoot + projectId required");
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.actions)) {
    throw new Error("applyFix: plan with actions[] required");
  }

  var state = loadStateDoc(projectRoot, projectId);
  var cyclesUsed = fixCountOf(state);
  var maxCycles = 2;
  var rc = renderConfigModule();
  if (rc && rc.AUTO_FIX_POLICY && typeof rc.AUTO_FIX_POLICY.maxAutoFixCycles === "number") {
    maxCycles = rc.AUTO_FIX_POLICY.maxAutoFixCycles;
  }
  if (cyclesUsed >= maxCycles) {
    var merr = new Error("MAX_FIX_CYCLES: fixCycles=" + cyclesUsed + " >= " + maxCycles);
    merr.code = "MAX_FIX_CYCLES";
    throw merr;
  }

  if (plan.riskClass !== "SAFE_AUTOMATIC") {
    var rerr = new Error("applyFix refused: riskClass=" + plan.riskClass + " requires approval");
    rerr.code = "APPROVAL_REQUIRED";
    throw rerr;
  }

  var applied = [];
  var evidence = [];
  var renderDir = path.join(projectRoot, "projects", projectId, "render");

  plan.actions.forEach(function (action) {
    action = action || {};
    if (ALLOWED_ACTIONS.indexOf(action.type) === -1 ||
        FORBIDDEN_ACTIONS.indexOf(action.type) !== -1) {
      var ferr = new Error("FORBIDDEN_FIX: action type not executable: " + String(action.type));
      ferr.code = "FORBIDDEN_FIX";
      throw ferr;
    }
    var before = { t: new Date().toISOString() };
    var after = { t: null };

    if (action.type === "RESTAGE_ASSET" || action.type === "REBUILD_STAGING_MANIFEST") {
      var Stager = tryRequire(path.join(__dirname, "..", "lib/asset-stager.js"));
      if (!Stager) throw new Error("applyFix: lib/asset-stager.js unavailable");
      var manifest = readJson(path.join(projectRoot, "projects", projectId, "asset-manifest.json"));
      var list = (Array.isArray(manifest.assets) ? manifest.assets : [])
        .filter(function (a) {
          if (!a || a.status !== "READY" || typeof a.path !== "string") return false;
          if (action.type === "RESTAGE_ASSET" && a.assetId !== action.params.assetId) return false;
          return a.type === "image" || a.type === "video" || a.type === "voice" ||
            a.type === "music" || a.type === "sfx";
        })
        .map(function (a) {
          return { assetId: a.assetId, sourcePath: a.path,
            type: (a.type === "image" || a.type === "video") ? a.type : "audio" };
        });
      before.assets = list.length;
      var entries = Stager.stageAssets({ projectRoot: projectRoot, projectId: projectId, assets: list });
      writeJson(path.join(renderDir, "staging-manifest.json"), { version: "1.0.0",
        projectId: projectId, generatedAt: new Date().toISOString(), entries: entries });
      after.entries = entries.length;
    } else if (action.type === "REBUILD_RENDER_PLAN") {
      var PlanCLI = tryRequire(path.join(__dirname, "..", "scripts/cli/render-plan-cli.js"));
      var Builder = tryRequire(path.join(__dirname, "..", "lib/render-input-builder.js"));
      if (!PlanCLI || !Builder) throw new Error("applyFix: plan rebuild deps unavailable");
      var input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
      before.planHash = null;
      try {
        before.planHash = readJson(path.join(renderDir, "render-plan.json")).planHash || null;
      } catch (e) {}
      var fresh = PlanCLI.derivePlan(input, {});
      writeJson(path.join(renderDir, "render-plan.json"), fresh);
      after.planHash = fresh.planHash;
    } else if (action.type === "REGENERATE_SRT_VTT") {
      var Captions = tryRequire(path.join(__dirname, "..", "lib/caption-builder.js"));
      if (!Captions) throw new Error("applyFix: lib/caption-builder.js unavailable");
      var doc = readJson(path.join(projectRoot, "projects", projectId, "captions", "captions.json"));
      var items = Array.isArray(doc.items) ? doc.items : [];
      before.items = items.length;
      var capDir = path.join(projectRoot, "projects", projectId, "captions");
      fs.writeFileSync(path.join(capDir, "captions.srt"), Captions.toSrt(items), "utf8");
      fs.writeFileSync(path.join(capDir, "captions.vtt"), Captions.toVtt(items), "utf8");
      after.srt = "captions.srt";
      after.vtt = "captions.vtt";
    } else if (action.type === "LOWER_CONCURRENCY" || action.type === "RAISE_TIMEOUT") {
      // Concurrency/timeout are per-attempt render knobs: record the
      // directive as evidence; the orchestrator applies lowered values to
      // the next attempt's renderConfig. Persist the intent file.
      before.note = "knob applied to next attempt config";
      var intentAbs = path.join(renderDir, "fix-knobs.json");
      var intents = {};
      try {
        if (existsFile(intentAbs)) intents = readJson(intentAbs);
      } catch (e) {}
      intents[action.type] = { at: new Date().toISOString(), params: action.params || {} };
      writeJson(intentAbs, intents);
      after.intentRecorded = true;
    } else if (action.type === "CLEAN_TEMP") {
      var Cleanup = tryRequire(path.join(__dirname, "cleanup.js"));
      before.tmp = "render/tmp";
      var res = Cleanup && typeof Cleanup.cleanManaged === "function"
        ? Cleanup.cleanManaged({ projectRoot: projectRoot, projectId: projectId })
        : (function () {
          var target = path.join(renderDir, "tmp");
          try {
            var st = fs.statSync(target);
            if (!st.isDirectory()) return { removed: 0 };
          } catch (e) {
            return { removed: 0 };
          }
          fs.rmSync(target, { recursive: true, force: true });
          return { removed: 1 };
        })();
      after.removed = Array.isArray(res.removed) ? res.removed.length : res.removed;
    } else if (action.type === "REPROBE_OUTPUT" || action.type === "REBUILD_METADATA_CACHE") {
      before.note = "diagnostic action: no state mutated";
      writeJson(path.join(renderDir, "reprobe-" + Date.now() + ".json"),
        { at: new Date().toISOString(), action: action.type, attemptId: plan.attemptId });
      after.recorded = true;
    }

    after.t = new Date().toISOString();
    applied.push(action.type);
    evidence.push({ type: action.type, before: before, after: after });
  });

  return { ok: true, planId: plan.planId, applied: applied, evidence: evidence };
}

module.exports = {
  planFix: planFix,
  applyFix: applyFix,
  ALLOWED_ACTIONS: ALLOWED_ACTIONS,
  FORBIDDEN_ACTIONS: FORBIDDEN_ACTIONS
};
