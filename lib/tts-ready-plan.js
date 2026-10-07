"use strict";

/**
 * Phase 2.2+2.3 — TTS-Ready Input Plan (§30).
 *
 * Machine-readable downstream plan consumed by Phase 2.4. Joins the Final
 * Spoken Script, the (optional) Narration Direction and the Pronunciation
 * Runtime Pass into per-segment readiness. NEVER stores audio paths, final
 * timing, or any Phase 2.4+ artifact: this package ends at a verified
 * TTS-ready input plan.
 */

const fs = require("fs");
const path = require("path");
const manifestLib = require("./project-manifest/index.js");
const dagLib = require("./dependency-dag/index.js");
const costShared = require("./output-cost/shared.js");
const narrationLib = require("./narration/index.js");
const pronunciationLib = require("./pronunciation/index.js");

const PLAN_SCHEMA_VERSION = "1.0.0";
const PLAN_DIR_REL = "voice/tts-ready-plan";

const ERRORS = {
  TTS_READY_PLAN_INVALID: "tts-ready plan fails schema/semantic validation",
  TTS_READY_PLAN_NOT_FOUND: "tts-ready plan version does not exist",
  TTS_READY_PLAN_SCRIPT_MISMATCH: "plan inputs do not share one script version",
};

function nowIso(now) {
  return now || new Date().toISOString();
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

/**
 * input: { scriptDoc, narrationDirectionDoc? , passDoc, voiceBibleRef,
 *          provider?, providerModel? }
 * The plan is BLOCKED for FAILED pronunciation segments, REVIEW_REQUIRED when
 * any segment needs review, otherwise READY_FOR_TTS.
 */
function buildTtsReadyPlan(root, projectId, input = {}, opts = {}) {
  const script = input.scriptDoc;
  const pass = input.passDoc;
  if (!script || !pass) {
    return { ok: false, code: "TTS_READY_PLAN_INVALID", message: "scriptDoc + passDoc are required" };
  }
  if (input.narrationDirectionDoc && (input.narrationDirectionDoc.scriptRef.scriptArtifactId !== script.scriptArtifactId || input.narrationDirectionDoc.scriptRef.scriptVersion !== script.scriptVersion)) {
    return { ok: false, code: "TTS_READY_PLAN_SCRIPT_MISMATCH", message: ERRORS.TTS_READY_PLAN_SCRIPT_MISMATCH };
  }
  if (pass.scriptRef.scriptArtifactId !== script.scriptArtifactId || pass.scriptRef.scriptVersion !== script.scriptVersion) {
    return { ok: false, code: "TTS_READY_PLAN_SCRIPT_MISMATCH", message: ERRORS.TTS_READY_PLAN_SCRIPT_MISMATCH };
  }
  const nd = input.narrationDirectionDoc || null;
  const ndBySegment = new Map((nd ? nd.segments : []).map((d) => [d.segmentId, d]));
  const passBySegment = new Map(pass.segments.map((s) => [s.segmentId, s]));

  const segments = [];
  for (const seg of script.segments) {
    const ps = passBySegment.get(seg.segmentId);
    const dd = ndBySegment.get(seg.segmentId);
    const blockers = [];
    if (!ps) {
      blockers.push({ code: "PRONUNCIATION_PASS_NOT_FOUND", detail: `no runtime pass result for ${seg.segmentId}` });
    } else {
      for (const issue of ps.issues || []) blockers.push({ code: issue.code, detail: issue.detail || null });
    }
    const pronunciationStatus = ps ? ps.status : "FAILED";
    const readyForTts = pronunciationStatus === "CLEAN" || pronunciationStatus === "OVERRIDE_APPLIED";
    segments.push({
      segmentId: seg.segmentId,
      sourceTextHash: narrationLib.segmentHash(seg.text),
      speakerId: (dd && dd.speakerId) || "narrator",
      directionRef: dd ? `${nd.narrationDirectionId}#v${nd.version}` : null,
      compiledTextHash: ps ? ps.compiledInputHash : null,
      pronunciationStatus,
      readyForTts,
      blockers: readyForTts ? [] : blockers,
    });
  }
  const overall = segments.some((s) => s.pronunciationStatus === "FAILED")
    ? "BLOCKED"
    : segments.every((s) => s.readyForTts)
      ? "READY_FOR_TTS"
      : "REVIEW_REQUIRED";

  // Production gate (FIX_PHASE_2_2_2_3_01 §2): technical readiness never
  // bypasses the canonical-script requirement. A plan built from a bounded
  // validation fixture (or from a script whose humanizer chain has not
  // completed) is machine-readably blocked for PRODUCTION TTS.
  const productionScriptStatus = (script.provenance && script.provenance.productionScriptStatus) || "PENDING";
  const productionTtsBlocked = productionScriptStatus !== "CANONICAL";

  const planId = costShared.id12("ttp", {
    project: projectId,
    scriptArtifactId: script.scriptArtifactId,
    scriptVersion: script.scriptVersion,
    ndRef: nd ? nd.narrationDirectionId : null,
    passRef: pass.pronunciationPassId,
  });
  const doc = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    ttsReadyPlanId: planId,
    version: 1,
    projectId: input.projectId || projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    voiceBibleRef: input.voiceBibleRef,
    narrationDirectionRef: nd ? nd.narrationDirectionId : null,
    pronunciationPassRef: pass.pronunciationPassId,
    provider: input.provider || pass.provider,
    providerModel: input.providerModel || pass.providerModel,
    language: script.language,
    overall,
    productionTtsBlocked,
    segments,
    provenance: { source: "phase-2.2-2.3", createdAt: nowIso(opts.now), productionScriptStatus, evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.fingerprint = fingerprintOf(doc);

  // Idempotent: same inputs → same plan id → replay, never a duplicate.
  const abs = path.join(root, "projects", projectId, PLAN_DIR_REL, `${planId}.json`);
  if (fs.existsSync(abs)) {
    try {
      const existing = JSON.parse(fs.readFileSync(abs, "utf8"));
      return { ok: true, plan: existing, rel: `${PLAN_DIR_REL}/${planId}.json`, code: "IDEMPOTENT_REPLAY" };
    } catch {
      return { ok: false, code: "TTS_READY_PLAN_INVALID", message: "existing plan unparseable" };
    }
  }
  try {
    fs.mkdirSync(path.join(root, "projects", projectId, PLAN_DIR_REL), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, abs);
  } catch (e) {
    return { ok: false, code: "TTS_READY_PLAN_INVALID", message: `persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true, plan: doc, rel: `${PLAN_DIR_REL}/${planId}.json` };
}

function loadTtsReadyPlan(root, projectId, planId) {
  const p = path.join(root, "projects", projectId, PLAN_DIR_REL, `${planId}.json`);
  if (!fs.existsSync(p)) return { ok: false, code: "TTS_READY_PLAN_NOT_FOUND", message: `${ERRORS.TTS_READY_PLAN_NOT_FOUND}: ${planId}` };
  try {
    return { ok: true, plan: JSON.parse(fs.readFileSync(p, "utf8")), rel: `${PLAN_DIR_REL}/${planId}.json` };
  } catch (e) {
    return { ok: false, code: "TTS_READY_PLAN_INVALID", message: String((e && e.message) || e) };
  }
}

/** Manifest index (§19): refs + status only, never the plan body. */
function attachManifestReference(root, projectId, planId, opts = {}) {
  const loaded = loadTtsReadyPlan(root, projectId, planId);
  if (!loaded.ok) return loaded;
  const plan = loaded.plan;
  const ref = {
    version: plan.ttsReadyPlanId,
    status: plan.productionTtsBlocked === true ? "UNRESOLVED" : plan.overall === "READY_FOR_TTS" ? "VERIFIED" : "UNRESOLVED",
    ref: loaded.rel,
    detail: `overall=${plan.overall} segments=${plan.segments.length}` + (plan.productionTtsBlocked === true ? " PRODUCTION_TTS_BLOCKED(non-canonical script)" : ""),
  };
  const r = manifestLib.setArtifactVersion(root, projectId, "ttsReadyPlanVersion", ref, opts);
  if (!r.ok) return r;
  return { ok: true, manifestStatus: ref.status };
}

/** DAG: TTS_READY_PLAN ← NARRATION_DIRECTION + PRONUNCIATION_RUNTIME_PASS. */
function registerDagNode(root, projectId, planId, opts = {}) {
  const loaded = loadTtsReadyPlan(root, projectId, planId);
  if (!loaded.ok) return loaded;
  const cur = dagLib.loadDag(root, projectId);
  if (!cur.ok && cur.code !== "DAG_NOT_FOUND") return cur;
  if (cur.ok && cur.dag.nodes.TTS_READY_PLAN) {
    // A newer immutable plan version exists: advance the versionRef (never rewrite history).
    if (cur.dag.nodes.TTS_READY_PLAN.versionRef !== planId) {
      const v = dagLib.setNodeVersion(root, projectId, "TTS_READY_PLAN", planId, opts);
      if (!v.ok) return v;
      const s = dagLib.setNodeState(root, projectId, "TTS_READY_PLAN", "CLEAN", opts);
      if (!s.ok) return s;
      return { ok: true, added: ["TTS_READY_PLAN.version"] };
    }
    if (cur.dag.nodes.TTS_READY_PLAN.state !== "CLEAN") {
      // Re-registration of the current validated plan converges to CLEAN.
      const s = dagLib.setNodeState(root, projectId, "TTS_READY_PLAN", "CLEAN", opts);
      if (!s.ok) return s;
      return { ok: true, added: ["TTS_READY_PLAN.state=CLEAN"] };
    }
    return { ok: true, added: [] };
  }
  const n = dagLib.addNode(root, projectId, {
    artifactKey: "TTS_READY_PLAN",
    artifactType: "TTS_READY_PLAN",
    versionRef: planId,
    state: "CLEAN",
    producedBy: "phase-2.2-2.3:tts-ready-plan",
    provenance: "LIVE",
    inputRefs: [
      { key: "NARRATION_DIRECTION", type: "DIRECTION" },
      { key: "PRONUNCIATION_RUNTIME_PASS", type: "PRONUNCIATION_EVIDENCE" },
    ],
  }, opts);
  if (!n.ok) return n;
  return { ok: true, added: ["TTS_READY_PLAN"] };
}

module.exports = {
  ERRORS,
  PLAN_DIR_REL,
  buildTtsReadyPlan,
  loadTtsReadyPlan,
  attachManifestReference,
  registerDagNode,
};
