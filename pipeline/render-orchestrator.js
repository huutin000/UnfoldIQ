"use strict";
// pipeline/render-orchestrator.js — STEP-13 Branch B (orchestration side).
// orchestrate({ projectRoot, projectId, op, opts }) with op in
// prepare|render|resume|cancel|qa|attempts (+ internal finalizeOp helper).
//
// Branch A contract modules (state-store.js, pipeline-lock.js,
// input-fingerprint.js, invalidation.js, reconcile.js, render-config.js,
// cleanup.js) are consumed GUARDED via a local Store facade that adapts
// their exact export shapes (state paths, transition signatures,
// schema-closed issue/blocker/history/checkpoint objects, {config,note}
// retry records, copy-on-write invalidation/reconcile). If a Branch A
// module is absent, the facade falls back to an embedded minimal
// implementation. Branch A files are never edited here — only required.
//
// Policy: TEST-ONLY fixture renders only — the orchestrator never invents
// production work. Every render derives its inputProps exclusively from
// buildRenderInput() over real project files after prepare() passed; there
// is no synthetic-input path. No network, no AI, no provider calls.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

function tryRequire(abs) {
  try {
    return require(abs);
  } catch (e) {
    return null;
  }
}

var Builder = tryRequire(path.join(__dirname, "..", "lib/render-input-builder.js"));
var InputCheck = tryRequire(path.join(__dirname, "..", "lib/render-input-check.js"));
var GapCheck = tryRequire(path.join(__dirname, "..", "lib/render-gap-check.js"));
var Stager = tryRequire(path.join(__dirname, "..", "lib/asset-stager.js"));
var RenderErrors = tryRequire(path.join(__dirname, "..", "lib/render-errors.js"));
var PlanCLI = tryRequire(path.join(__dirname, "..", "scripts/cli/render-plan-cli.js"));
var Time = tryRequire(path.join(__dirname, "..", "lib/render-time.js"));
var Classifier = tryRequire(path.join(__dirname, "render-error-classifier.js"));
var Runner = tryRequire(path.join(__dirname, "remotion-render-runner.js"));

// Branch A contract modules (exact exports per STEP-13 brief).
var RealStore = tryRequire(path.join(__dirname, "state-store.js"));
var RealLock = tryRequire(path.join(__dirname, "pipeline-lock.js"));
var RealFp = tryRequire(path.join(__dirname, "input-fingerprint.js"));
var RealInv = tryRequire(path.join(__dirname, "invalidation.js"));
var RealRec = tryRequire(path.join(__dirname, "reconcile.js"));
var RealCfg = tryRequire(path.join(__dirname, "render-config.js"));
var RealCleanup = tryRequire(path.join(__dirname, "cleanup.js"));

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

function nowIso() {
  return new Date().toISOString();
}

function pad3(n) {
  var s = String(n);
  while (s.length < 3) s = "0" + s;
  return s;
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(abs, obj) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  var tmp = abs + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, abs);
}

function existsFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (e) {
    return false;
  }
}

function assertProjectId(projectId) {
  if (typeof projectId !== "string" || projectId.length === 0 ||
      projectId.indexOf("/") !== -1 || projectId.indexOf("\\") !== -1 ||
      projectId === "." || projectId === "..") {
    throw new Error("orchestrator: invalid projectId: " + String(projectId));
  }
}

function defaultRoot() {
  return path.join(__dirname, "..");
}

function renderDirFor(projectRoot, projectId) {
  return path.join(projectRoot, "projects", projectId, "render");
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function hashObjectLocal(obj) {
  if (Builder && typeof Builder.hashObject === "function") return Builder.hashObject(obj);
  var stable = function (v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ":" + stable(v[k]);
    }).join(",") + "}";
  };
  return crypto.createHash("sha256").update(stable(obj), "utf8").digest("hex");
}

/* ------------------------------------------------------------------ */
/* Fallback enums (used only when Branch A state-store.js is absent)   */
/* ------------------------------------------------------------------ */

var FB_STATUSES = ["NEW", "PREPARING", "READY_TO_RENDER", "RENDERING", "RENDERED",
  "QA_RUNNING", "FINAL_RENDER_READY", "BLOCKED", "CANCELLED", "FAILED"];
var FB_STAGES = ["VALIDATE_INPUTS", "STAGE_ASSETS", "BUILD_RENDER_PLAN", "PRE_RENDER_QA",
  "RENDER", "POST_RENDER_TECHNICAL_QA", "GENERATE_VISUAL_QA_EVIDENCE", "VISUAL_QA",
  "FIX_CLASSIFICATION", "AUTO_FIX", "RE_RENDER", "FINAL_ACCEPTANCE"];
var FB_TRANSITIONS = {
  NEW: ["PREPARING"],
  PREPARING: ["READY_TO_RENDER", "BLOCKED", "CANCELLED", "FAILED"],
  READY_TO_RENDER: ["RENDERING", "BLOCKED", "CANCELLED"],
  RENDERING: ["RENDERED", "BLOCKED", "CANCELLED", "FAILED"],
  RENDERED: ["QA_RUNNING", "BLOCKED", "CANCELLED", "FAILED"],
  QA_RUNNING: ["FINAL_RENDER_READY", "QA_REVIEW_REQUIRED", "FIX_REQUIRED", "BLOCKED", "FAILED"],
  FINAL_RENDER_READY: [],
  BLOCKED: ["PREPARING", "CANCELLED"],
  FAILED: ["PREPARING", "CANCELLED"],
  CANCELLED: ["PREPARING"]
};
var FB_STATE_REL = "render/pipeline-state.json";

/* ------------------------------------------------------------------ */
/* Store facade: schema-safe adaptation over Branch A state-store.js   */
/* ------------------------------------------------------------------ */

function fbStatePath(projectRoot, projectId) {
  return path.join(renderDirFor(projectRoot, projectId), "pipeline-state.json");
}

function fbNewState(projectId) {
  var t = nowIso();
  return {
    version: "1.0.0", projectId: projectId, createdAt: t, updatedAt: t,
    status: "NEW", currentStage: null, inputFingerprint: null,
    checkpoints: {}, attempts: [], qa: null, issues: [], blockers: [], history: []
  };
}

var Store = {
  STATUSES: (RealStore && RealStore.STATUSES) || FB_STATUSES,
  STAGES: (RealStore && RealStore.STAGES) || FB_STAGES,
  TRANSITIONS: (RealStore && RealStore.TRANSITIONS) || FB_TRANSITIONS,

  loadState: function (projectRoot, projectId) {
    if (RealStore) return RealStore.loadState(projectRoot, projectId); // skeleton, never null
    if (!existsFile(fbStatePath(projectRoot, projectId))) return null;
    return readJson(fbStatePath(projectRoot, projectId));
  },

  saveState: function (projectRoot, projectId, state) {
    if (RealStore) return RealStore.saveState(projectRoot, projectId, state);
    state.updatedAt = nowIso();
    writeJson(fbStatePath(projectRoot, projectId), state);
    return state;
  },

  isFreshSkeleton: function (state) {
    return !!state && state.status === "NEW" && (!state.attempts || !state.attempts.length);
  },

  // Real transition(projectRoot, projectId, to, event, detail) reloads from
  // disk: flush in-memory mutations first, then copy the result back into
  // the caller's reference. Illegal transitions fall back to a documented
  // forced assignment (used only for explicit CANCELLED -> PREPARE restart).
  transition: function (projectRoot, projectId, state, to, reason) {
    if (!RealStore) {
      var allowed = FB_TRANSITIONS[state.status] || [];
      if (allowed.indexOf(to) === -1 && state.status !== to) {
        state.status = to;
        Store.appendHistory(state, "TRANSITION_FORCED", { to: to, reason: reason || null });
      } else {
        state.status = to;
        Store.appendHistory(state, "TRANSITION_" + to, { reason: reason || null });
      }
      state.updatedAt = nowIso();
      return state;
    }
    RealStore.saveState(projectRoot, projectId, state);
    try {
      var fresh = RealStore.transition(projectRoot, projectId, to, "TRANSITION_" + to, reason || null);
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(fresh).forEach(function (k) { state[k] = fresh[k]; });
    } catch (e) {
      if (/INVALID_PIPELINE_TRANSITION/.test((e && e.message) || "")) {
        state.status = to;
        Store.appendHistory(state, "TRANSITION_FORCED", { to: to, reason: reason || null });
        RealStore.saveState(projectRoot, projectId, state);
      } else {
        throw e;
      }
    }
    return state;
  },

  // Accepts {event, ...detail} objects (Branch B call style) or plain names.
  appendHistory: function (state, event, detail) {
    if (RealStore) {
      if (event && typeof event === "object") {
        var name = event.event || "EVENT";
        var rest = {};
        Object.keys(event).forEach(function (k) {
          if (k !== "event" && k !== "t" && k !== "at") rest[k] = event[k];
        });
        if (detail !== undefined) rest.extra = detail;
        return RealStore.appendHistory(state, String(name), rest);
      }
      return RealStore.appendHistory(state, String(event), detail);
    }
    var entry = { t: nowIso(), event: null };
    if (event && typeof event === "object") {
      Object.keys(event).forEach(function (k) { entry[k] = event[k]; });
      if (!entry.event) entry.event = "EVENT";
      if (!entry.t) entry.t = nowIso();
    } else {
      entry.event = String(event);
      if (detail !== undefined) entry.detail = detail;
    }
    state.history.push(entry);
    state.updatedAt = nowIso();
    return state;
  },

  // Schema-shaped checkpoint: {stage,status,inputHash,artifactPaths,completedAt,metadata}.
  setCheckpoint: function (state, name, opts) {
    opts = opts || {};
    var cp = {
      stage: String(name),
      status: opts.status || "VALID",
      inputHash: (opts.inputHash !== undefined ? opts.inputHash : null),
      artifactPaths: Array.isArray(opts.artifactPaths) ? opts.artifactPaths : [],
      completedAt: opts.completedAt || nowIso(),
      metadata: (opts.metadata && typeof opts.metadata === "object") ? opts.metadata : {}
    };
    if (RealStore) return RealStore.setCheckpoint(state, String(name), cp);
    state.checkpoints[String(name)] = cp;
    state.updatedAt = nowIso();
    return state;
  },

  addAttempt: function (state, attempt) {
    if (RealStore) return RealStore.addAttempt(state, attempt);
    state.attempts.push(attempt);
    state.updatedAt = nowIso();
    return attempt;
  },

  // Branch A updateAttempt only permits MUTABLE_ATTEMPT_KEYS; write every
  // immutable field (ids, hashes, config, output path) at creation time.
  updateAttempt: function (state, attemptId, patch) {
    if (RealStore) return RealStore.updateAttempt(state, attemptId, patch || {});
    var found = null;
    state.attempts.forEach(function (a) {
      if (a && a.attemptId === attemptId) {
        Object.keys(patch || {}).forEach(function (k) { a[k] = patch[k]; });
        found = a;
      }
    });
    if (!found) throw new Error("state-store: unknown attempt " + attemptId);
    state.updatedAt = nowIso();
    return found;
  },

  // Schema-shaped issue: {issueId,category,severity,status,note}.
  addIssue: function (state, issue) {
    issue = issue && typeof issue === "object" ? issue : { message: String(issue) };
    var blocking = issue.blocking === true;
    var code = issue.code || issue.category || "UNKNOWN";
    var severity = blocking ? "BLOCKER" : (/ERROR|FAIL/i.test(code) ? "ERROR" : "INFO");
    var adapted = {
      issueId: issue.issueId || ("issue-" + (state.issues.length + 1)),
      category: String(issue.source || code),
      severity: severity,
      status: issue.status || "OPEN",
      note: String(issue.message || issue.note || code).slice(0, 2000)
    };
    if (RealStore) return RealStore.addIssue(state, adapted);
    state.issues.push(adapted);
    state.updatedAt = nowIso();
    return adapted;
  },

  // Schema-shaped blocker: {code,detail}.
  addBlocker: function (state, blocker) {
    blocker = blocker && typeof blocker === "object" ? blocker : { message: String(blocker) };
    var adapted = {
      code: String(blocker.code || "BLOCKED"),
      detail: String(blocker.detail || blocker.message || "blocked").slice(0, 2000)
    };
    if (RealStore) return RealStore.addBlocker(state, adapted);
    state.blockers.push(adapted);
    state.updatedAt = nowIso();
    return adapted;
  }
};

function openIssues(state) {
  return (state.issues || []).filter(function (i) { return i && i.status === "OPEN"; });
}
function severeIssues(state) {
  return openIssues(state).filter(function (i) {
    return i.severity === "BLOCKER" || i.severity === "ERROR";
  });
}
// fixCycles is derived (schema top-level is closed): attempts carrying a fixPlan.
function fixCycleCount(state) {
  return (state.attempts || []).filter(function (a) { return a && a.fixPlan; }).length;
}

/* ------------------------------------------------------------------ */
/* Lock facade (Branch A pipeline-lock.js: {stale,lock} + LOCK_HELD)   */
/* ------------------------------------------------------------------ */

var Lock = {
  acquire: function (projectRoot, projectId, operation) {
    if (!RealLock) {
      var abs = path.join(renderDirFor(projectRoot, projectId), "pipeline.lock");
      if (existsFile(abs)) {
        try {
          var ex = readJson(abs);
          if (ex && Date.now() - Date.parse(ex.heartbeat || ex.at) < 120000) {
            var err = new Error("pipeline locked by op=" + ex.operation);
            err.code = "LOCKED";
            throw err;
          }
        } catch (e) {
          if (e && e.code === "LOCKED") throw e;
        }
      }
      var lock = { pid: process.pid, operation: operation || "unknown", at: nowIso(), heartbeat: nowIso() };
      writeJson(abs, lock);
      return { stale: false, lock: lock };
    }
    var acq = RealLock.acquire(projectRoot, projectId, operation);
    if (acq && acq.stale && !RealLock.isFresh(acq.lock)) {
      // Reconcile-confirmed stale (heartbeat dead by isFresh): remove with
      // the required explicit confirmation, then acquire cleanly.
      try {
        RealLock.clearStale(projectRoot, projectId, { confirmedStale: true });
      } catch (e) {}
      acq = RealLock.acquire(projectRoot, projectId, operation);
    }
    return acq;
  },
  heartbeat: function (projectRoot, projectId) {
    if (!RealLock) return null;
    return RealLock.heartbeat(projectRoot, projectId);
  },
  release: function (projectRoot, projectId) {
    if (!RealLock) {
      try {
        fs.unlinkSync(path.join(renderDirFor(projectRoot, projectId), "pipeline.lock"));
      } catch (e) {}
      return;
    }
    return RealLock.release(projectRoot, projectId);
  },
  isLockedError: function (e) {
    if (!e) return false;
    if (e.code === "LOCKED" || e.code === "LOCK_HELD") return true;
    return /LOCK_HELD/.test((e && e.message) || "");
  }
};

/* ------------------------------------------------------------------ */
/* Render-config facade (real: timeoutMs + {config,note} lowering)     */
/* ------------------------------------------------------------------ */

var Cfg = {
  RENDER_RETRY_POLICY: (RealCfg && RealCfg.RENDER_RETRY_POLICY) || { maxTotalAttempts: 3 },
  AUTO_FIX_POLICY: (RealCfg && RealCfg.AUTO_FIX_POLICY) || { maxAutoFixCycles: 2 },
  PRESSURE_CLASSES: (RealCfg && RealCfg.PRESSURE_ERROR_CLASSES) ||
    ["TARGET_CLOSED", "CHROME_CRASH", "OUT_OF_MEMORY"],
  defaultConfig: function () {
    if (RealCfg) return RealCfg.defaultConfig();
    return { codec: "h264", concurrency: 4, timeoutMs: 600000, logLevel: "info" };
  },
  resolveConfig: function (overrides) {
    if (RealCfg) return RealCfg.resolveConfig(overrides || {});
    var o = overrides && typeof overrides === "object" ? overrides : {};
    var c = {
      codec: typeof o.codec === "string" && o.codec ? o.codec : "h264",
      concurrency: typeof o.concurrency === "number" ? o.concurrency : 4,
      timeoutMs: typeof o.timeoutMs === "number" ? o.timeoutMs :
        (typeof o.timeoutInMilliseconds === "number" ? o.timeoutInMilliseconds : 600000),
      logLevel: typeof o.logLevel === "string" && o.logLevel ? o.logLevel : "info"
    };
    c.concurrency = Math.max(1, Math.min(8, Math.floor(c.concurrency) || 4));
    c.timeoutMs = Math.max(60000, Math.min(3600000, Math.floor(c.timeoutMs) || 600000));
    return c;
  },
  // Always normalized to {config, note}.
  lowerConcurrencyForRetry: function (config, errorClass) {
    if (RealCfg) return RealCfg.lowerConcurrencyForRetry(config, errorClass);
    var base = clone(config || Cfg.defaultConfig());
    base.concurrency = Math.max(1, Math.floor(base.concurrency / 2));
    return { config: base, note: "concurrency lowered to " + base.concurrency };
  }
};
// Retryable = Branch A pressure classes + classifier TIMEOUT (raised timeout).
function isRetryableClass(cls, retryableFlag) {
  if (cls === "TIMEOUT") return retryableFlag !== false;
  return Cfg.PRESSURE_CLASSES.indexOf(cls) !== -1 && retryableFlag !== false;
}

/* ------------------------------------------------------------------ */
/* Fingerprint facade (real: computeFingerprint(root,id,docs))         */
/* ------------------------------------------------------------------ */

var Fp = {
  compute: function (projectRoot, projectId, parts) {
    parts = parts || {};
    if (RealFp) {
      return RealFp.computeFingerprint(projectRoot, projectId, {
        renderInput: parts.input || null,
        renderPlan: parts.plan || null,
        stagingManifest: parts.staging || null
      });
    }
    var prov = ((parts.input && parts.input.provenance) || {});
    var stagingHashes = [];
    if (parts.staging && Array.isArray(parts.staging.entries)) {
      stagingHashes = parts.staging.entries.map(function (e) {
        return (e && (e.contentHash || e.stagedPath)) || "?";
      }).sort();
    }
    var p = {
      timelineHash: prov.timelineHash || null,
      assetManifestHash: prov.assetManifestHash || null,
      audioMixHash: prov.audioMixHash || null,
      captionsHash: prov.captionsHash || null,
      planHash: (parts.plan && parts.plan.planHash) || null,
      staging: stagingHashes
    };
    return { hash: hashObjectLocal(p).slice(0, 16), at: nowIso(), parts: p };
  },
  id: function (fp) {
    if (!fp) return null;
    if (typeof fp.fingerprintId === "string") return fp.fingerprintId;
    if (typeof fp.hash === "string") return fp.hash;
    try {
      if (RealFp) return RealFp.fingerprintIdOf(fp);
    } catch (e) {}
    return hashObjectLocal(fp).slice(0, 16);
  },
  changedKeys: function (a, b) {
    if (!a || !b) return ["missing"];
    if (RealFp) {
      try {
        return RealFp.compareFingerprint(a, b).changedKeys || [];
      } catch (e) {}
    }
    if (a.hash && b.hash) {
      if (a.hash === b.hash) return [];
      var changed = [];
      var pa = a.parts || {};
      var pb = b.parts || {};
      var keys = {};
      Object.keys(pa).forEach(function (k) { keys[k] = true; });
      Object.keys(pb).forEach(function (k) { keys[k] = true; });
      Object.keys(keys).forEach(function (k) {
        if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) changed.push(k);
      });
      return changed;
    }
    return ["unknown"];
  }
};

// changedKeys -> Branch A invalidation change kinds.
function changeKindsFor(changedKeys) {
  var kinds = [];
  function add(k) {
    if (kinds.indexOf(k) === -1) kinds.push(k);
  }
  (changedKeys || []).forEach(function (k) {
    if (k === "captions") add("captions");
    else if (k === "audioMix") add("voice-timing");
    else if (k === "stagingManifest" || k === "staging") add("image-asset");
    else if (k === "renderPlan" || k === "planHash") add("image-asset");
    else add("platform-dims"); // broadest: revalidates inputs + everything downstream
  });
  return kinds;
}

function applyInvalidations(projectRoot, projectId, state, kinds) {
  var changed = false;
  (kinds || []).forEach(function (kind) {
    if (RealInv) {
      var next = RealInv.applyInvalidation(state, kind); // copy-on-write: use return value
      Object.keys(state).forEach(function (k) { delete state[k]; });
      Object.keys(next).forEach(function (k) { state[k] = next[k]; });
      changed = true;
    }
  });
  if (!changed && kinds && kinds.length && !RealInv) {
    Store.appendHistory(state, "CHECKPOINTS_INVALIDATED", { changeKinds: kinds });
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Cleanup facade                                                      */
/* ------------------------------------------------------------------ */

function cleanTemp(projectRoot, projectId) {
  if (RealCleanup) return RealCleanup.cleanManaged({ projectRoot: projectRoot, projectId: projectId });
  var target = path.join(renderDirFor(projectRoot, projectId), "tmp");
  try {
    var st = fs.statSync(target);
    if (!st.isDirectory()) return { removed: [] };
  } catch (e) {
    return { removed: [] };
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { removed: [target] };
}
function removedCount(res) {
  if (!res) return 0;
  if (Array.isArray(res.removed)) return res.removed.length;
  if (typeof res.removed === "number") return res.removed;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Plan derivation: reuse scripts/cli/render-plan-cli.js when requirable, else     */
/* minimal frame derivation via lib/render-time.js.                        */
/* ------------------------------------------------------------------ */

function derivePlanWithFallback(input, opts) {
  opts = opts || {};
  if (PlanCLI && typeof PlanCLI.derivePlan === "function") {
    return PlanCLI.derivePlan(input, opts);
  }
  if (!Time || !Builder) throw new Error("orchestrator: cannot derive plan (no render-plan-cli, no render-time)");
  var fps = input.composition.fps;
  var scenes = (input.scenes || []).map(function (s) {
    var sr = Time.msRangeToFrames(s.startMs, s.endMs, fps);
    return { sceneId: s.sceneId, startFrame: sr.startFrame, endFrame: sr.endFrame,
      layers: [{ layerId: s.sceneId + "_bg", kind: "BACKGROUND", startFrame: sr.startFrame, endFrame: sr.endFrame }] };
  });
  var plan = {
    version: "1.0.0",
    projectId: input.projectId,
    platform: input.platform,
    generatedAt: nowIso(),
    composition: Builder.resolveCompositionMeta(input),
    scenes: scenes,
    audioTracks: { voice: [], music: [], sfx: [] },
    captionTrack: { mode: (input.captions && input.captions.mode) || "NONE", frames: [] },
    assetMap: {},
    styleTokens: JSON.parse(JSON.stringify(input.visualSystem || {})),
    validation: { preflightStatus: opts.preflightStatus || "unknown",
      timelineStatus: opts.timelineStatus || "unknown", checks: [{ name: "orchestrator-minimal", status: "READY" }] },
    planHash: "",
    status: "READY"
  };
  var hashable = JSON.parse(JSON.stringify(plan));
  delete hashable.planHash;
  delete hashable.generatedAt;
  plan.planHash = hashObjectLocal(hashable).slice(0, 16);
  return plan;
}

/* ------------------------------------------------------------------ */
/* Disk-space precheck (<1GB -> BLOCKED DISK_SPACE_LOW)                */
/* ------------------------------------------------------------------ */

function diskPrecheck(projectRoot, projectId) {
  try {
    if (typeof fs.statfsSync !== "function") return { ok: true, skipped: true };
    var target = renderDirFor(projectRoot, projectId);
    fs.mkdirSync(target, { recursive: true });
    var st = fs.statfsSync(target);
    var free = (typeof st.bfree === "number" && typeof st.bsize === "number") ? st.bfree * st.bsize : null;
    if (free === null) return { ok: true, skipped: true };
    if (free < 1024 * 1024 * 1024) {
      return { ok: false, code: "DISK_SPACE_LOW", freeBytes: free };
    }
    return { ok: true, freeBytes: free };
  } catch (e) {
    return { ok: true, skipped: true, reason: e.message };
  }
}

/* ------------------------------------------------------------------ */
/* prepareOp                                                           */
/* ------------------------------------------------------------------ */

async function prepareOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var opts = args.opts || {};
  assertProjectId(projectId);
  if (!Builder) throw new Error("orchestrator: lib/render-input-builder.js unavailable");

  var state = Store.loadState(projectRoot, projectId);
  if (!state) state = fbNewState(projectId);
  reconcileLocalMarks(projectRoot, projectId, state);
  Store.transition(projectRoot, projectId, state, "PREPARING", "prepare requested");
  state.currentStage = "VALIDATE_INPUTS";
  Store.saveState(projectRoot, projectId, state);

  // 1. Validate inputs (buildRenderInput + checks + gap check).
  var input;
  try {
    input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
  } catch (e) {
    var msg = (e && e.message) || String(e);
    Store.addBlocker(state, { code: "PREPARE_INPUT_BLOCKED", message: msg });
    Store.transition(projectRoot, projectId, state, "BLOCKED", "render input blocked");
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, status: "BLOCKED", reason: msg };
  }

  var inputCheck = InputCheck ? InputCheck.checkRenderInput(input) : { status: "READY", issues: [] };
  var gapCheck = GapCheck ? GapCheck.checkRenderGaps(input) : { status: "CLEAN", gaps: [] };
  Store.setCheckpoint(state, "INPUT_VALIDATION", {
    inputHash: null,
    artifactPaths: [],
    metadata: { inputCheck: inputCheck.status, gapCheck: gapCheck.status }
  });
  (inputCheck.issues || []).forEach(function (i) {
    Store.addIssue(state, { code: i.code, message: i.message, blocking: i.blocking !== false,
      source: "render-input-check" });
  });
  (gapCheck.gaps || []).forEach(function (g) {
    Store.addIssue(state, { code: g.kind, message: g.message, blocking: true, source: "render-gap-check" });
  });

  if (inputCheck.status === "BLOCKED" || gapCheck.status === "BLOCKED") {
    Store.addBlocker(state, { code: "PREPARE_CHECKS_BLOCKED",
      message: "inputCheck=" + inputCheck.status + " gapCheck=" + gapCheck.status });
    Store.transition(projectRoot, projectId, state, "BLOCKED", "prepare checks blocked");
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, status: "BLOCKED",
      inputCheck: inputCheck.status, gapCheck: gapCheck.status };
  }

  // 2. Stage assets (READY manifest assets).
  var renderDir = renderDirFor(projectRoot, projectId);
  var staging = null;
  state.currentStage = "STAGE_ASSETS";
  try {
    var manifest = readJson(path.join(projectRoot, "projects", projectId, "asset-manifest.json"));
    var stageList = (Array.isArray(manifest.assets) ? manifest.assets : [])
      .filter(function (a) {
        return a && a.status === "READY" && typeof a.path === "string" &&
          (a.type === "image" || a.type === "video" || a.type === "voice" || a.type === "music" || a.type === "sfx");
      })
      .map(function (a) {
        var t = (a.type === "image" || a.type === "video") ? a.type : "audio";
        return { assetId: a.assetId, sourcePath: a.path, type: t };
      });
    var entries = Stager ? Stager.stageAssets({ projectRoot: projectRoot, projectId: projectId, assets: stageList }) : [];
    staging = { version: "1.0.0", projectId: projectId, generatedAt: nowIso(), entries: entries };
    writeJson(path.join(renderDir, "staging-manifest.json"), staging);
  } catch (e) {
    var smsg = (e && e.message) || String(e);
    Store.addBlocker(state, { code: "PREPARE_STAGE_FAILED", message: smsg });
    Store.transition(projectRoot, projectId, state, "BLOCKED", "staging failed");
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, status: "BLOCKED", reason: smsg };
  }

  // Rebuild so staged paths feed plan + renderer.
  try {
    input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
  } catch (e) {
    var rmsg = (e && e.message) || String(e);
    Store.addBlocker(state, { code: "PREPARE_INPUT_BLOCKED", message: rmsg });
    Store.transition(projectRoot, projectId, state, "BLOCKED", "render input blocked after staging");
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, status: "BLOCKED", reason: rmsg };
  }

  // 3. Derive plan.
  state.currentStage = "BUILD_RENDER_PLAN";
  var sourcePathById = {};
  try {
    var am = readJson(path.join(projectRoot, "projects", projectId, "asset-manifest.json"));
    (Array.isArray(am.assets) ? am.assets : []).forEach(function (a) {
      if (a && a.assetId && typeof a.path === "string") sourcePathById[a.assetId] = String(a.path).split(path.sep).join("/");
    });
  } catch (e) {}
  function readStatus(rel) {
    try {
      var doc = readJson(path.join(projectRoot, "projects", projectId, rel.split("/").join(path.sep)));
      return doc.status || "unknown";
    } catch (e) {
      return "unknown";
    }
  }
  var plan = derivePlanWithFallback(input, {
    sourcePathById: sourcePathById,
    preflightStatus: readStatus("preflight/media-preflight.json"),
    timelineStatus: readStatus("timing/timeline-measured.json")
  });
  writeJson(path.join(renderDir, "render-plan.json"), plan);

  // 4. Fingerprint + checkpoint reconciliation / invalidation.
  var fp = Fp.compute(projectRoot, projectId, { input: input, plan: plan, staging: staging });
  var fpId = Fp.id(fp);
  var prevFp = state.inputFingerprint;
  var kinds = [];
  if (prevFp && Fp.id(prevFp) && Fp.id(prevFp) !== fpId) {
    kinds = changeKindsFor(Fp.changedKeys(prevFp, fp));
  }
  // Stored checkpoint inputHash mismatch also triggers invalidation.
  ["INPUT_VALIDATION", "ASSET_STAGING", "RENDER_PLAN"].forEach(function (cp) {
    var ck = state.checkpoints[cp];
    if (ck && ck.inputHash && ck.inputHash !== fpId && !kinds.length) {
      kinds = ["platform-dims"];
    }
  });
  if (kinds.length) {
    applyInvalidations(projectRoot, projectId, state, kinds);
  }

  state.inputFingerprint = fp;
  Store.setCheckpoint(state, "INPUT_VALIDATION", { inputHash: fpId,
    artifactPaths: [], metadata: { status: inputCheck.status } });
  Store.setCheckpoint(state, "ASSET_STAGING", { inputHash: fpId,
    artifactPaths: [ ["projects", projectId, "render", "staging-manifest.json"].join("/") ],
    metadata: { entries: staging ? staging.entries.length : 0 } });
  Store.setCheckpoint(state, "RENDER_PLAN", { inputHash: fpId,
    artifactPaths: [ ["projects", projectId, "render", "render-plan.json"].join("/") ],
    metadata: { planHash: plan.planHash, planStatus: plan.status } });
  state.currentStage = "BUILD_RENDER_PLAN";
  Store.transition(projectRoot, projectId, state, "READY_TO_RENDER", "prepare ok planHash=" + plan.planHash);
  Store.appendHistory(state, "PREPARED", { planHash: plan.planHash, fingerprintId: fpId, invalidatedBy: kinds });
  Store.saveState(projectRoot, projectId, state);

  void opts;
  return { ok: plan.status !== "BLOCKED", projectId: projectId, status: state.status,
    planHash: plan.planHash, fingerprintId: fpId, invalidatedBy: kinds,
    inputCheck: inputCheck.status, gapCheck: gapCheck.status };
}

// Mark RUNNING attempts INTERRUPTED when no live renderer owns this process
// invocation (prepare/resume entry). Uses Branch A reconcile when present.
function reconcileLocalMarks(projectRoot, projectId, state) {
  if (RealRec) {
    try {
      var res = RealRec.reconcileInterrupted({ projectRoot: projectRoot, projectId: projectId,
        state: state, activePidAlive: false });
      if (res && res.state) {
        Object.keys(state).forEach(function (k) { delete state[k]; });
        Object.keys(res.state).forEach(function (k) { state[k] = res.state[k]; });
      }
      return res;
    } catch (e) {
      return null;
    }
  }
  var recovered = [];
  (state.attempts || []).forEach(function (a) {
    if (a && (a.status === "RUNNING" || a.status === "PENDING")) {
      a.status = "INTERRUPTED";
      a.endedAt = a.endedAt || nowIso();
      recovered.push(a.attemptId);
    }
  });
  if (recovered.length) {
    Store.appendHistory(state, "RENDER_MARKED_INTERRUPTED", { attempts: recovered });
  }
  if (state.status === "RENDERING") state.status = "RENDER_INTERRUPTED";
  return { recovered: recovered };
}

/* ------------------------------------------------------------------ */
/* render internals                                                    */
/* ------------------------------------------------------------------ */

function latestAttempt(state) {
  if (!state || !Array.isArray(state.attempts) || !state.attempts.length) return null;
  return state.attempts[state.attempts.length - 1];
}

function cancelRequested(projectRoot, projectId, sinceIso) {
  var abs = path.join(renderDirFor(projectRoot, projectId), "cancel-requested.json");
  if (!existsFile(abs)) return null;
  try {
    var doc = readJson(abs);
    if (sinceIso && doc.at && Date.parse(doc.at) < Date.parse(sinceIso)) return null;
    return doc;
  } catch (e) {
    return null;
  }
}

function runTechnicalQaHook(projectRoot, projectId, attempt) {
  var hook = tryRequire(path.join(__dirname, "..", "qa", "technical-qa.js"));
  if (!hook) return { deferred: true, reason: "QA_DEFERRED: qa/technical-qa.js absent (Branch C)" };
  try {
    if (typeof hook.runTechnicalQa === "function") {
      return { deferred: false, result: hook.runTechnicalQa({ projectRoot: projectRoot,
        projectId: projectId, attempt: attempt }) };
    }
    if (typeof hook.check === "function") {
      return { deferred: false, result: hook.check({ projectRoot: projectRoot,
        projectId: projectId, attempt: attempt }) };
    }
    return { deferred: true, reason: "QA_DEFERRED: technical-qa hook has no runnable export" };
  } catch (e) {
    return { deferred: false, error: (e && e.message) || String(e) };
  }
}

function runVisualEvidenceHook(projectRoot, projectId, attempt) {
  var hook = tryRequire(path.join(__dirname, "..", "qa", "visual-evidence.js")) ||
    tryRequire(path.join(__dirname, "..", "qa", "visual-qa.js"));
  if (!hook) return { deferred: true, reason: "QA_DEFERRED: visual QA module absent (Branch C)" };
  try {
    var fn = hook.collectEvidence || hook.runVisualQa || hook.check;
    if (typeof fn === "function") {
      return { deferred: false, result: fn({ projectRoot: projectRoot, projectId: projectId, attempt: attempt }) };
    }
    return { deferred: true, reason: "QA_DEFERRED: visual QA hook has no runnable export" };
  } catch (e) {
    return { deferred: false, error: (e && e.message) || String(e) };
  }
}

function freshAutoFix() {
  try {
    return require(path.join(__dirname, "auto-fix.js"));
  } catch (e) {
    return null;
  }
}
function freshFinalize() {
  try {
    return require(path.join(__dirname, "finalize-output.js"));
  } catch (e) {
    return null;
  }
}

async function runOneAttempt(args, attempt, attemptDir, input, renderConfig) {
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var opts = args.opts || {};
  var state = args.state;

  fs.mkdirSync(path.join(attemptDir, "qa"), { recursive: true });
  writeJson(path.join(attemptDir, "render-attempt.json"), attempt);

  if (!Runner) throw new Error("orchestrator: remotion-render-runner.js unavailable");

  var cancelToken = opts.cancelToken || null;
  var lastStateSave = 0;

  function persistProgress(info, force) {
    var now = Date.now();
    if (!force && (now - lastStateSave) < 5000 && (!info || info.fraction < 1)) return;
    lastStateSave = now;
    try {
      Store.updateAttempt(state, attempt.attemptId, { progress: Object.assign({},
        attempt.progress || {}, info || {}) });
      attempt.progress = Object.assign({}, attempt.progress || {}, info || {});
      Store.saveState(projectRoot, projectId, state);
    } catch (e) {}
    try {
      Lock.heartbeat(projectRoot, projectId);
    } catch (e) {}
  }

  var handle = Runner.runRender({
    projectRoot: projectRoot,
    projectId: projectId,
    attemptDir: attemptDir,
    inputProps: input,
    compositionId: "UNFOLDIQVideo",
    renderConfig: renderConfig,
    cancelSignal: opts.liveSignal || undefined,
    signalHandlers: opts.signalHandlers === true,
    onStart: function (info) {
      attempt.progress = Object.assign({}, attempt.progress, info, { started: true });
      persistProgress(info, true);
    },
    onProgress: function (info) {
      attempt.progress = Object.assign({}, attempt.progress, info);
      if (cancelToken && cancelToken.cancelled) {
        try {
          handle.cancelSignal.cancel();
        } catch (e) {}
      }
      var cr = cancelRequested(projectRoot, projectId, attempt.startedAt);
      if (cr) {
        try {
          handle.cancelSignal.cancel();
        } catch (e) {}
      }
      persistProgress(info, false);
    },
    onLog: function () {}
  });
  var liveSignal = handle.cancelSignal;

  try {
    var res = await handle.promise;
    persistProgress({ fraction: 1, done: true }, true);
    return { ok: true, result: res, liveSignal: liveSignal };
  } catch (e) {
    persistProgress({ failed: true }, true);
    return { ok: false, error: e, liveSignal: liveSignal };
  }
}

function classifyError(e) {
  if (Classifier) return Classifier.classify(e);
  return { class: (e && e.renderErrorClass) || "UNKNOWN", retryable: !!(e && e.retryable),
    detail: String((e && e.message) || e).slice(0, 500) };
}

// Consume auto-fix knob intents (fix-knobs.json) into the next config.
function applyKnobIntents(projectRoot, projectId, config) {
  var next = clone(config);
  try {
    var abs = path.join(renderDirFor(projectRoot, projectId), "fix-knobs.json");
    if (!existsFile(abs)) return next;
    var intents = readJson(abs);
    if (intents.LOWER_CONCURRENCY) {
      next.concurrency = Math.max(1, Math.floor(next.concurrency / 2));
    }
    if (intents.RAISE_TIMEOUT) {
      var t = Number(next.timeoutMs || next.timeoutInMilliseconds) || 600000;
      next.timeoutMs = Math.min(3600000, t * 2);
      delete next.timeoutInMilliseconds;
    }
  } catch (e) {}
  return Cfg.resolveConfig(next);
}

/* ------------------------------------------------------------------ */
/* renderOp                                                            */
/* ------------------------------------------------------------------ */

async function renderOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var opts = args.opts || {};
  assertProjectId(projectId);

  var state = Store.loadState(projectRoot, projectId);
  if (!state) state = fbNewState(projectId);

  // prepare-if-needed: never invent work — render only from validated inputs.
  var needsPrepare = ["NEW", "PREPARING", "BLOCKED", "FAILED", "CANCELLED"].indexOf(state.status) !== -1 ||
    !state.inputFingerprint ||
    !(state.checkpoints && state.checkpoints.RENDER_PLAN) ||
    (state.checkpoints.RENDER_PLAN && state.checkpoints.RENDER_PLAN.status === "INVALIDATED");
  if (needsPrepare && state.status !== "CANCELLED") {
    var prep = await prepareOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
    state = Store.loadState(projectRoot, projectId);
    if (!prep.ok) {
      return { ok: false, projectId: projectId, status: state.status, reason: prep.reason || "prepare blocked" };
    }
  }
  if (state.status === "CANCELLED") {
    return { ok: false, projectId: projectId, status: "CANCELLED",
      reason: "never auto-render cancelled work; run prepare explicitly" };
  }

  var disk = diskPrecheck(projectRoot, projectId);
  if (!disk.ok) {
    Store.addBlocker(state, { code: "DISK_SPACE_LOW", message: "free bytes: " + disk.freeBytes });
    Store.transition(projectRoot, projectId, state, "BLOCKED", "disk space low");
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, status: "BLOCKED", reason: "DISK_SPACE_LOW" };
  }

  var maxTotalAttempts = (typeof opts.maxTotalAttempts === "number" && opts.maxTotalAttempts > 0)
    ? Math.floor(opts.maxTotalAttempts) : (Cfg.RENDER_RETRY_POLICY.maxTotalAttempts || 3);
  var maxRetries = (typeof opts.maxRetries === "number" && opts.maxRetries >= 0)
    ? Math.floor(opts.maxRetries) : 1;
  var maxAutoFixCycles = Cfg.AUTO_FIX_POLICY.maxAutoFixCycles || 2;

  if ((state.attempts || []).length >= maxTotalAttempts) {
    Store.addBlocker(state, { code: "MAX_ATTEMPTS",
      message: "attempt count reached maxTotalAttempts=" + maxTotalAttempts });
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, status: state.status, reason: "MAX_ATTEMPTS" };
  }

  // Rebuild validated input for this run.
  var input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
  var plan = readJson(path.join(renderDirFor(projectRoot, projectId), "render-plan.json"));

  var baseConfig = Cfg.resolveConfig({
    concurrency: opts.concurrency,
    timeoutMs: (opts.timeoutMs !== undefined && opts.timeoutMs !== null) ? opts.timeoutMs : opts.timeoutInMilliseconds,
    codec: opts.codec,
    logLevel: opts.logLevel
  });
  baseConfig = applyKnobIntents(projectRoot, projectId, baseConfig);

  var retriesUsed = 0;
  var outcome = null;

  while (true) {
    if ((state.attempts || []).length >= maxTotalAttempts) {
      Store.addBlocker(state, { code: "MAX_ATTEMPTS", message: "stopping retry loop at maxTotalAttempts" });
      Store.transition(projectRoot, projectId, state, "FAILED", "max attempts reached");
      Store.saveState(projectRoot, projectId, state);
      return { ok: false, projectId: projectId, status: "FAILED", reason: "MAX_ATTEMPTS",
        attemptId: outcome && outcome.attemptId };
    }

    var number = (state.attempts || []).length + 1;
    var attemptId = "attempt-" + pad3(number);
    var attemptDir = path.join(renderDirFor(projectRoot, projectId), "attempts", attemptId);
    var stagingNow = null;
    try {
      stagingNow = readJson(path.join(renderDirFor(projectRoot, projectId), "staging-manifest.json"));
    } catch (e) {}
    var fpNow = Fp.compute(projectRoot, projectId, { input: input, plan: plan, staging: stagingNow });
    // Immutable attempt fields are written once at creation (updateAttempt
    // only permits status/progress/endedAt/error/technicalQa/visualQa/fixPlan/artifacts).
    var attempt = {
      attemptId: attemptId,
      projectId: projectId,
      number: number,
      inputFingerprint: fpNow,
      renderPlanHash: plan.planHash,
      startedAt: nowIso(),
      status: "PENDING",
      outputPath: path.join(attemptDir, "output.mp4"),
      renderConfig: baseConfig,
      progress: { fraction: 0 },
      artifacts: [],
      testOnly: opts.testOnly !== false
    };
    Store.addAttempt(state, attempt);
    state.currentStage = "RENDER";
    Store.saveState(projectRoot, projectId, state);
    if (number === 1) {
      Store.transition(projectRoot, projectId, state, "RENDERING", attemptId + " started");
    } else {
      // Retry loop: FAILED -> RE_RENDERING -> RENDERING (Branch A allowlist).
      try {
        Store.transition(projectRoot, projectId, state, "RE_RENDERING", attemptId + " retry queued");
      } catch (e) {}
      Store.transition(projectRoot, projectId, state, "RENDERING", attemptId + " started");
    }
    Store.updateAttempt(state, attemptId, { status: "RUNNING" });
    Store.saveState(projectRoot, projectId, state);

    var run = await runOneAttempt({ projectRoot: projectRoot, projectId: projectId, opts: opts, state: state },
      attempt, attemptDir, input, baseConfig);

    if (run.ok) {
      Store.updateAttempt(state, attemptId, { status: "RENDERED", endedAt: nowIso(),
        progress: Object.assign({}, attempt.progress, { fraction: 1, frameCount: run.result.frameCount }) });
      Store.setCheckpoint(state, "RENDER_OUTPUT", { inputHash: Fp.id(fpNow),
        artifactPaths: [["projects", projectId, "render", "attempts", attemptId, "output.mp4"].join("/")],
        metadata: { attemptId: attemptId, frameCount: run.result.frameCount, planHash: plan.planHash } });
      Store.transition(projectRoot, projectId, state, "RENDERED", attemptId + " rendered");
      Store.saveState(projectRoot, projectId, state);

      // Technical QA hook (guarded; QA_DEFERRED when Branch C absent).
      var tq = runTechnicalQaHook(projectRoot, projectId, latestAttempt(state));
      if (tq.deferred) {
        Store.appendHistory(state, "QA_DEFERRED", { attemptId: attemptId, reason: tq.reason });
        Store.saveState(projectRoot, projectId, state);
      } else if (tq.error) {
        Store.addIssue(state, { code: "TECHNICAL_QA_ERROR", message: tq.error,
          blocking: false, source: "technical-qa", attemptId: attemptId });
        Store.saveState(projectRoot, projectId, state);
      } else {
        Store.updateAttempt(state, attemptId, { technicalQa: tq.result || null });
        Store.setCheckpoint(state, "TECHNICAL_QA", { inputHash: Fp.id(fpNow),
          artifactPaths: [],
          metadata: { attemptId: attemptId, technical: (tq.result && tq.result.status) || "unknown" } });
        Store.saveState(projectRoot, projectId, state);
      }

      // Visual evidence hook (guarded; QA_DEFERRED when absent).
      var vq = runVisualEvidenceHook(projectRoot, projectId, latestAttempt(state));
      if (vq.deferred) {
        Store.appendHistory(state, "QA_DEFERRED", { attemptId: attemptId, reason: vq.reason });
        Store.saveState(projectRoot, projectId, state);
      } else if (!vq.error) {
        Store.updateAttempt(state, attemptId, { visualQa: vq.result || null });
        Store.setCheckpoint(state, "VISUAL_EVIDENCE", { inputHash: Fp.id(fpNow),
          artifactPaths: [], metadata: { attemptId: attemptId } });
        Store.saveState(projectRoot, projectId, state);
      }

      // Acceptance: technical PASS (+ acceptable visual) -> finalize promotion.
      var cur = latestAttempt(state);
      var techOk = cur && cur.technicalQa && cur.technicalQa.status === "PASS";
      var vis = cur && cur.visualQa;
      var visDecision = vis && (vis.decision || vis.status);
      var visReview = vis && (vis.reviewState || vis.review_state);
      var visualOk = visDecision === "APPROVE" || visReview === "HUMAN_REVIEWED" ||
        visReview === "AGENT_REVIEWED" ||
        (opts.allowMachineOnly === true && techOk);
      var finalized = false;
      if (techOk) {
        state.currentStage = "POST_RENDER_TECHNICAL_QA";
        Store.transition(projectRoot, projectId, state, "QA_RUNNING", attemptId + " QA passed, accepting");
        if (visualOk) {
          try {
            var FMod = freshFinalize();
            if (FMod && typeof FMod.finalize === "function") {
              var fin = FMod.finalize({ projectRoot: projectRoot, projectId: projectId,
                attemptId: attemptId, opts: { allowMachineOnly: opts.allowMachineOnly === true } });
              finalized = !!(fin && fin.ok);
              state = Store.loadState(projectRoot, projectId) || state;
            }
          } catch (e) {
            Store.appendHistory(state, "FINALIZE_SKIPPED", { reason: (e && e.message) || String(e) });
            Store.saveState(projectRoot, projectId, state);
          }
          if (finalized) {
            state.currentStage = "FINAL_ACCEPTANCE";
            Store.transition(projectRoot, projectId, state, "FINAL_RENDER_READY", attemptId + " finalized");
            Store.saveState(projectRoot, projectId, state);
          } else {
            Store.transition(projectRoot, projectId, state, "QA_REVIEW_REQUIRED", attemptId + " needs review");
            Store.saveState(projectRoot, projectId, state);
          }
        } else {
          Store.transition(projectRoot, projectId, state, "QA_REVIEW_REQUIRED", attemptId + " visual review pending");
          Store.saveState(projectRoot, projectId, state);
        }
      }

      outcome = { ok: true, projectId: projectId, status: state.status, attemptId: attemptId,
        outputPath: run.result.outputPath, frameCount: run.result.frameCount, finalized: finalized };
      return outcome;
    }

    // Failure path: classify + record.
    var c = classifyError(run.error);
    var cancelled = c.class === "CANCELLED" ||
      !!cancelRequested(projectRoot, projectId, attempt.startedAt) ||
      !!(opts.cancelToken && opts.cancelToken.cancelled);
    Store.updateAttempt(state, attemptId, { status: cancelled ? "CANCELLED" : "FAILED",
      endedAt: nowIso(), error: { errorClass: c.class, retryable: c.retryable, detail: c.detail } });
    Store.addIssue(state, { code: c.class, message: c.detail, blocking: !c.retryable,
      source: "render", attemptId: attemptId });
    if (cancelled) {
      Store.transition(projectRoot, projectId, state, "CANCELLED", attemptId + " cancelled (no auto-retry)");
      Store.saveState(projectRoot, projectId, state);
      return { ok: false, projectId: projectId, status: "CANCELLED", attemptId: attemptId,
        errorClass: c.class, reason: "cancelled (no auto-retry)" };
    }
    Store.transition(projectRoot, projectId, state, "FAILED", attemptId + " failed [" + c.class + "]");
    Store.saveState(projectRoot, projectId, state);

    // Auto-fix hook (guarded; bounded; SAFE_AUTOMATIC only inside applyFix).
    var AF = freshAutoFix();
    if (AF && typeof AF.planFix === "function" && fixCycleCount(state) < maxAutoFixCycles) {
      var issues = openIssues(state);
      var fixPlan = null;
      try {
        fixPlan = AF.planFix({ projectRoot: projectRoot, projectId: projectId,
          attempt: latestAttempt(state), issues: issues, qaResults: null });
      } catch (e) {
        fixPlan = { riskClass: "REVIEW_REQUIRED", requiresApproval: true,
          reason: "planFix threw: " + ((e && e.message) || String(e)), actions: [] };
      }
      Store.updateAttempt(state, attemptId, { fixPlan: fixPlan });
      state.currentStage = "FIX_CLASSIFICATION";
      Store.saveState(projectRoot, projectId, state);
      if (fixPlan && fixPlan.riskClass === "SAFE_AUTOMATIC" && typeof AF.applyFix === "function") {
        try {
          var applied = AF.applyFix({ projectRoot: projectRoot, projectId: projectId, plan: fixPlan });
          state.currentStage = "AUTO_FIX";
          Store.appendHistory(state, "AUTO_FIX_APPLIED", { attemptId: attemptId,
            actions: (applied && applied.applied) || [] });
          Store.saveState(projectRoot, projectId, state);
          baseConfig = applyKnobIntents(projectRoot, projectId, baseConfig);
          // Re-render as a new attempt after an applied fix (never frame-resume).
          input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
          plan = readJson(path.join(renderDirFor(projectRoot, projectId), "render-plan.json"));
          continue;
        } catch (e) {
          Store.appendHistory(state, "AUTO_FIX_FAILED", { reason: (e && e.message) || String(e) });
          Store.saveState(projectRoot, projectId, state);
        }
      } else {
        Store.appendHistory(state, "FIX_REQUIRES_REVIEW", { riskClass: fixPlan && fixPlan.riskClass });
        Store.saveState(projectRoot, projectId, state);
      }
    } else if (fixCycleCount(state) >= maxAutoFixCycles) {
      Store.appendHistory(state, "MAX_FIX_CYCLES", { attemptId: attemptId });
      Store.saveState(projectRoot, projectId, state);
    }

    // Retryable-class retry with lowered concurrency / raised timeout (bounded).
    if (isRetryableClass(c.class, c.retryable) && retriesUsed < maxRetries) {
      retriesUsed += 1;
      var lowered = Cfg.lowerConcurrencyForRetry(baseConfig, c.class);
      baseConfig = Cfg.resolveConfig((lowered && lowered.config) || lowered || baseConfig);
      if (c.class === "TIMEOUT") {
        var t = Number(baseConfig.timeoutMs) || 600000;
        baseConfig = Cfg.resolveConfig(Object.assign({}, baseConfig, { timeoutMs: Math.min(3600000, t * 2) }));
      }
      Store.appendHistory(state, "RETRY_WITH_LOWERED_CONCURRENCY", { attemptId: attemptId,
        errorClass: c.class, nextConcurrency: baseConfig.concurrency,
        note: (lowered && lowered.note) || null });
      Store.saveState(projectRoot, projectId, state);
      input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
      continue;
    }

    return { ok: false, projectId: projectId, status: state.status, attemptId: attemptId,
      errorClass: c.class, retryable: c.retryable, reason: c.detail };
  }
}

/* ------------------------------------------------------------------ */
/* resumeOp                                                            */
/* ------------------------------------------------------------------ */

function resumeOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var opts = (args && args.opts) || {};
  assertProjectId(projectId);

  var state = Store.loadState(projectRoot, projectId);
  if (!state || Store.isFreshSkeleton(state)) {
    return { ok: true, projectId: projectId, decision: "NO_STATE",
      detail: "no pipeline state; run prepare first" };
  }

  if (state.status === "CANCELLED") {
    return { ok: true, projectId: projectId, status: state.status, decision: "CANCELLED",
      autoRender: false, detail: "cancelled work is never auto-rendered; run prepare explicitly" };
  }

  // Branch A reconcile decides crash recovery on a copy; adopt its state.
  if (RealRec) {
    try {
      var rec = RealRec.reconcileInterrupted({ projectRoot: projectRoot, projectId: projectId,
        state: state, activePidAlive: false });
      if (rec && rec.state) {
        Object.keys(state).forEach(function (k) { delete state[k]; });
        Object.keys(rec.state).forEach(function (k) { state[k] = rec.state[k]; });
        Store.saveState(projectRoot, projectId, state);
      }
      if (rec && rec.decision === "BLOCKED_REVIEW_REQUIRED") {
        return { ok: true, projectId: projectId, status: state.status,
          decision: "BLOCKED_REVIEW_REQUIRED", openBlockingIssues: severeIssues(state).length };
      }
      if (rec && rec.decision === "FINAL_ALREADY_READY") {
        var finalAbs = path.join(projectRoot, "out", projectId, "final.mp4");
        if (existsFile(finalAbs)) {
          return { ok: true, projectId: projectId, status: state.status, decision: "FINAL_ALREADY_READY",
            finalPath: ["out", projectId, "final.mp4"].join("/") };
        }
        // Artifact record exists but file is gone: fall through to re-render.
      } else if (rec) {
        // Adopt reconcile's checkpoint/new-attempt guidance, then refine below.
        if (rec.decision === "RUN_QA") {
          var last = latestAttempt(state);
          return { ok: true, projectId: projectId, status: state.status, decision: "RUN_QA",
            attemptId: (last && last.attemptId) || rec.attemptId,
            detail: "rendered output lacks passing QA" };
        }
        if (rec.decision === "NEW_RENDER_ATTEMPT") {
          return { ok: true, projectId: projectId, status: state.status, decision: "NEW_RENDER_ATTEMPT",
            detail: "interrupted attempt marked; render a fresh attempt (never frame-resume)" };
        }
        // CONTINUE_FROM_CHECKPOINT: verify below before confirming.
      }
    } catch (e) {}
  } else {
    reconcileLocalMarks(projectRoot, projectId, state);
    Store.saveState(projectRoot, projectId, state);
  }

  // FINAL_ALREADY_READY: finalized + final artifact present.
  if (state.status === "FINAL_RENDER_READY") {
    var finalAbs2 = path.join(projectRoot, "out", projectId, "final.mp4");
    if (existsFile(finalAbs2)) {
      return { ok: true, projectId: projectId, status: state.status, decision: "FINAL_ALREADY_READY",
        finalPath: ["out", projectId, "final.mp4"].join("/") };
    }
  }

  if (state.status === "BLOCKED" || severeIssues(state).length) {
    return { ok: true, projectId: projectId, status: state.status, decision: "BLOCKED_REVIEW_REQUIRED",
      openBlockingIssues: severeIssues(state).length };
  }
  if (state.status === "QA_REVIEW_REQUIRED" || state.status === "FIX_REQUIRED") {
    return { ok: true, projectId: projectId, status: state.status, decision: "BLOCKED_REVIEW_REQUIRED",
      detail: state.status === "FIX_REQUIRED" ? "fix required before re-render" : "visual review required" };
  }

  var last2 = latestAttempt(state);
  if (last2 && (last2.status === "RENDERED" || last2.status === "PASSED") &&
      (!last2.technicalQa || last2.technicalQa.status !== "PASS")) {
    return { ok: true, projectId: projectId, status: state.status, decision: "RUN_QA",
      attemptId: last2.attemptId, detail: "rendered output lacks passing QA" };
  }

  // CONTINUE_FROM_CHECKPOINT when stored plan checkpoint matches current input.
  try {
    var input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
    var plan = readJson(path.join(renderDirFor(projectRoot, projectId), "render-plan.json"));
    var staging = null;
    try {
      staging = readJson(path.join(renderDirFor(projectRoot, projectId), "staging-manifest.json"));
    } catch (e) {}
    var fp = Fp.compute(projectRoot, projectId, { input: input, plan: plan, staging: staging });
    var cp = state.checkpoints && state.checkpoints.RENDER_PLAN;
    if (cp && cp.status === "VALID" && cp.inputHash === Fp.id(fp) &&
        state.inputFingerprint && Fp.id(state.inputFingerprint) === Fp.id(fp)) {
      return { ok: true, projectId: projectId, status: state.status, decision: "CONTINUE_FROM_CHECKPOINT",
        planHash: plan.planHash, detail: "checkpoints valid; ready to render without re-preparing" };
    }
  } catch (e) {}

  void opts;
  return { ok: true, projectId: projectId, status: state.status, decision: "NEW_RENDER_ATTEMPT",
    detail: "inputs changed or checkpoints invalid; prepare then render a fresh attempt (never frame-resume)" };
}

/* ------------------------------------------------------------------ */
/* cancelOp                                                            */
/* ------------------------------------------------------------------ */

function cancelOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var opts = (args && args.opts) || {};
  assertProjectId(projectId);

  var state = Store.loadState(projectRoot, projectId);
  if (!state || Store.isFreshSkeleton(state)) {
    return { ok: false, projectId: projectId, reason: "NO_STATE" };
  }

  // Cross-process cancel limitation (documented): the Remotion cancelSignal
  // lives in-process. A second CLI invocation cannot reach another process's
  // signal, so it persists CANCEL_REQUESTED state + a cancel-request file
  // that an actively rendering process polls between progress callbacks.
  // Cancel works live when the orchestrator owns the run in-process
  // (opts.cancelToken { cancelled: false } checked in the progress callback
  // -> signal.cancel(), or opts.liveSignal cancelled directly here).
  var running = null;
  (state.attempts || []).forEach(function (a) {
    if (a && a.status === "RUNNING") running = a;
  });

  var doc = { at: nowIso(), reason: opts.reason || "cancel requested" };
  writeJson(path.join(renderDirFor(projectRoot, projectId), "cancel-requested.json"), doc);

  if (opts.liveSignal) {
    try {
      opts.liveSignal.cancel();
    } catch (e) {}
  }
  if (opts.cancelToken && typeof opts.cancelToken === "object") {
    try {
      opts.cancelToken.cancelled = true;
    } catch (e) {}
  }

  if (!running) {
    Store.appendHistory(state, "CANCEL_NO_RUNNING_ATTEMPT", { reason: doc.reason });
    Store.saveState(projectRoot, projectId, state);
    return { ok: true, projectId: projectId, status: state.status, cancelled: false,
      detail: "no RUNNING attempt; cancel request recorded" };
  }

  Store.updateAttempt(state, running.attemptId, { status: "CANCEL_REQUESTED", endedAt: nowIso() });
  Store.transition(projectRoot, projectId, state, "CANCELLED", "cancel requested: " + doc.reason);
  Store.appendHistory(state, "CANCEL_REQUESTED", { attemptId: running.attemptId,
    reason: doc.reason, liveCancelled: !!opts.liveSignal });
  Store.saveState(projectRoot, projectId, state);
  // No auto-retry after cancel: terminal by policy.
  return { ok: true, projectId: projectId, status: "CANCELLED", cancelled: true,
    attemptId: running.attemptId, liveCancelled: !!opts.liveSignal };
}

/* ------------------------------------------------------------------ */
/* qaOp / attemptsOp / finalizeOp                                      */
/* ------------------------------------------------------------------ */

function qaOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var opts = (args && args.opts) || {};
  assertProjectId(projectId);

  var state = Store.loadState(projectRoot, projectId);
  if (!state || Store.isFreshSkeleton(state)) return { ok: false, projectId: projectId, reason: "NO_STATE" };

  var attempt = null;
  if (opts.attempt !== undefined && opts.attempt !== null) {
    var n = Number(opts.attempt);
    (state.attempts || []).forEach(function (a) {
      if (a && (a.attemptId === opts.attempt || a.number === n)) attempt = a;
    });
    if (!attempt) return { ok: false, projectId: projectId, reason: "UNKNOWN_ATTEMPT" };
  } else {
    attempt = latestAttempt(state);
    if (!attempt) return { ok: false, projectId: projectId, reason: "NO_ATTEMPTS" };
  }

  if (state.status === "RENDERED") {
    state.currentStage = "POST_RENDER_TECHNICAL_QA";
    Store.transition(projectRoot, projectId, state, "QA_RUNNING", "qa requested for " + attempt.attemptId);
    Store.saveState(projectRoot, projectId, state);
  }

  var tq = runTechnicalQaHook(projectRoot, projectId, attempt);
  if (tq.deferred) {
    Store.appendHistory(state, "QA_DEFERRED", { attemptId: attempt.attemptId, reason: tq.reason });
    Store.saveState(projectRoot, projectId, state);
    return { ok: true, projectId: projectId, attemptId: attempt.attemptId, qa: "DEFERRED", reason: tq.reason };
  }
  if (tq.error) {
    Store.addIssue(state, { code: "TECHNICAL_QA_ERROR", message: tq.error,
      blocking: false, source: "technical-qa", attemptId: attempt.attemptId });
    Store.saveState(projectRoot, projectId, state);
    return { ok: false, projectId: projectId, attemptId: attempt.attemptId, reason: tq.error };
  }
  Store.updateAttempt(state, attempt.attemptId, { technicalQa: tq.result || null });
  var fpId = state.inputFingerprint ? Fp.id(state.inputFingerprint) : null;
  Store.setCheckpoint(state, "TECHNICAL_QA", { inputHash: fpId, artifactPaths: [],
    metadata: { attemptId: attempt.attemptId, status: (tq.result && tq.result.status) || "UNKNOWN" } });
  var qaDir = path.join(renderDirFor(projectRoot, projectId), "attempts", attempt.attemptId, "qa");
  try {
    writeJson(path.join(qaDir, "technical-qa.json"), tq.result || { status: "UNKNOWN" });
    var arts = (attempt.artifacts || []).slice();
    arts.push(["attempts", attempt.attemptId, "qa", "technical-qa.json"].join("/"));
    Store.updateAttempt(state, attempt.attemptId, { artifacts: arts });
  } catch (e) {}
  if (tq.result && tq.result.status === "PASS") {
    Store.transition(projectRoot, projectId, state, "FINAL_RENDER_READY", attempt.attemptId + " QA passed");
  } else if (tq.result && tq.result.status === "FAIL") {
    Store.transition(projectRoot, projectId, state, "FIX_REQUIRED", attempt.attemptId + " QA failed");
  }
  Store.saveState(projectRoot, projectId, state);
  return { ok: true, projectId: projectId, attemptId: attempt.attemptId,
    qa: (tq.result && tq.result.status) || "UNKNOWN", result: tq.result };
}

function attemptsOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  assertProjectId(projectId);
  var state = Store.loadState(projectRoot, projectId);
  if (!state || Store.isFreshSkeleton(state)) return { ok: true, projectId: projectId, attempts: [] };
  return {
    ok: true,
    projectId: projectId,
    status: state.status,
    attempts: (state.attempts || []).map(function (a) {
      return {
        number: a.number,
        attemptId: a.attemptId,
        status: a.status,
        startedAt: a.startedAt,
        endedAt: a.endedAt || null,
        outputPath: a.outputPath,
        renderPlanHash: a.renderPlanHash,
        concurrency: a.renderConfig && (a.renderConfig.concurrency),
        progress: a.progress || null,
        errorClass: (a.error && (a.error.errorClass || a.error.code)) || null,
        technicalQa: (a.technicalQa && a.technicalQa.status) || null,
        visualQa: (a.visualQa && (a.visualQa.decision || a.visualQa.status)) || null
      };
    })
  };
}

async function finalizeOp(args) {
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var opts = (args && args.opts) || {};
  assertProjectId(projectId);
  var FMod = freshFinalize();
  if (!FMod || typeof FMod.finalize !== "function") {
    return { ok: false, projectId: projectId, reason: "FINALIZE_UNAVAILABLE" };
  }
  var res = FMod.finalize({ projectRoot: projectRoot, projectId: projectId,
    attemptId: opts.attemptId || (args && args.attemptId), opts: opts });
  if (res && res.ok) {
    var state = Store.loadState(projectRoot, projectId);
    if (state && !Store.isFreshSkeleton(state)) {
      if (state.status === "RENDERED") {
        Store.transition(projectRoot, projectId, state, "QA_RUNNING", "finalize acceptance");
      }
      if (state.status === "QA_RUNNING" || state.status === "QA_REVIEW_REQUIRED") {
        state.currentStage = "FINAL_ACCEPTANCE";
        Store.transition(projectRoot, projectId, state, "FINAL_RENDER_READY", "finalized " + res.attemptId);
      }
      Store.appendHistory(state, "FINALIZED", { attemptId: res.attemptId, finalPath: res.finalPath });
      Store.saveState(projectRoot, projectId, state);
    }
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* orchestrate                                                         */
/* ------------------------------------------------------------------ */

var OPS = ["prepare", "render", "resume", "cancel", "qa", "attempts"];

async function orchestrate(args) {
  args = args || {};
  var projectRoot = args.projectRoot || defaultRoot();
  var projectId = args.projectId;
  var op = args.op;
  var opts = args.opts || {};
  assertProjectId(projectId);
  if (OPS.indexOf(op) === -1) {
    throw new Error("orchestrator: unknown op " + String(op) + " (expected " + OPS.join("|") + ")");
  }

  // cancel bypasses the lock by design: it must land even while a render
  // holds the lock (it persists CANCEL_REQUESTED + cancel-requested.json).
  if (op === "cancel") {
    return cancelOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
  }

  var acq = null;
  try {
    acq = Lock.acquire(projectRoot, projectId, op);
  } catch (e) {
    if (Lock.isLockedError(e)) {
      return { ok: false, projectId: projectId, op: op, reason: "LOCKED",
        detail: (e && e.message) || "pipeline locked" };
    }
    throw e;
  }

  try {
    if (op === "prepare") return await prepareOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
    if (op === "render") return await renderOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
    if (op === "resume") return resumeOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
    if (op === "qa") return qaOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
    if (op === "attempts") return attemptsOp({ projectRoot: projectRoot, projectId: projectId, opts: opts });
    throw new Error("orchestrator: unhandled op " + op);
  } finally {
    // Lock is always released in finally.
    try {
      if (acq) Lock.release(projectRoot, projectId);
    } catch (e) {}
  }
  void opts;
}

module.exports = {
  orchestrate: orchestrate,
  prepareOp: function (a) { return prepareOp(a); },
  renderOp: function (a) { return renderOp(a); },
  resumeOp: function (a) { return resumeOp(a); },
  cancelOp: function (a) { return cancelOp(a); },
  qaOp: function (a) { return qaOp(a); },
  attemptsOp: function (a) { return attemptsOp(a); },
  finalizeOp: function (a) { return finalizeOp(a); },
  // Delegated config/fingerprint surface (Branch A modules when present).
  resolveConfig: function (o) { return Cfg.resolveConfig(o); },
  lowerConcurrencyForRetry: function (c, e) { return Cfg.lowerConcurrencyForRetry(c, e); },
  computeFingerprint: function (root, id, docs) {
    if (RealFp) return RealFp.computeFingerprint(root, id, docs);
    return Fp.compute(root, id, { input: docs && docs.renderInput, plan: docs && docs.renderPlan,
      staging: docs && docs.stagingManifest });
  },
  compareFingerprint: function (a, b) {
    if (RealFp) return RealFp.compareFingerprint(a, b);
    var changed = Fp.changedKeys(a, b);
    return { same: changed.length === 0, changedKeys: changed };
  },
  RENDER_RETRY_POLICY: Cfg.RENDER_RETRY_POLICY,
  AUTO_FIX_POLICY: Cfg.AUTO_FIX_POLICY,
  PRESSURE_ERROR_CLASSES: Cfg.PRESSURE_CLASSES,
  STATUSES: Store.STATUSES,
  STAGES: Store.STAGES,
  OPS: OPS
};
