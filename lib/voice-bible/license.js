"use strict";

/**
 * PHASE 2.1 FIX 01 — Voice license evidence + runtime voice discovery + operator
 * approval (UNFOLDIQ CORE).
 *
 * Three separable rights claims, never collapsed into one opaque
 * `licensed = true`:
 *
 *   MODEL_LICENSE       what licence covers the model weights
 *   VOICE_ASSET_RIGHTS  what licence covers the individual voice files
 *   OUTPUT_USAGE_STATUS what licence covers the synthesized audio output
 *
 * A claim is VERIFIED only when an official upstream source states that exact
 * claim. Silence is not permission: an unstated claim stays REVIEW_REQUIRED and
 * never gets promoted upward.
 *
 * OPERATOR APPROVAL IS A HUMAN DECISION (§5). `approveNarratorVoice` refuses to
 * run without an explicit approval, and there is deliberately no auto-select
 * path — no scoring function can stand in for the operator.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const kokoro = require("../../providers/runtime/adapters/local-kokoro.js");
const manifestLib = require("../project-manifest/index.js");
const workspaceLib = require("../workspace/index.js");

const LICENSE_EVIDENCE_SCHEMA_VERSION = "1.0.0";
const LICENSE_EVIDENCE_REL = "providers/license-evidence";

// Previews are RETENTION_MANAGED: they are real rendered audio, but they are
// selection scratch, not durable evidence and not production narration.
const PREVIEW_LIFECYCLE = "RETENTION_MANAGED";

const ERROR_REFS = {
  VOICE_LICENSE_EVIDENCE_NOT_FOUND: "no license evidence recorded for this provider",
  VOICE_LICENSE_EVIDENCE_INVALID: "license evidence fails schema/semantic validation",
  VOICE_LICENSE_EVIDENCE_FABRICATED: "evidence claims an official source that does not support it",
  VOICE_RUNTIME_UNAVAILABLE: "the configured TTS runtime is not installed or not importable",
  VOICE_DISCOVERY_FAILED: "runtime voice discovery failed",
  VOICE_PREVIEW_FAILED: "preview synthesis failed",
  OPERATOR_APPROVAL_REQUIRED: "narrator voice selection requires an explicit operator decision",
  OPERATOR_APPROVAL_MISMATCH: "approved voiceId does not match the shortlist presented for approval",
  OPERATOR_APPROVAL_UNKNOWN_VOICE: "approved voice is not present in the runtime inventory",
};

let evidenceValidator = null;
function validator() {
  if (!evidenceValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "voice-license-evidence.schema.json"), "utf8"));
    evidenceValidator = ajv.compile(root);
  }
  return evidenceValidator;
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

/**
 * Semantic validation on top of the schema. The important rule: an evidence
 * document may only carry a VERIFIED claim when it names an official upstream
 * source over https and a quoted statement. This is what stops a fabricated
 * "Apache-2.0" string from being parked in the repo.
 */
function validateLicenseEvidence(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "evidence must be an object" }] };
  }
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const official = doc.officialSource || {};
  for (const [claim, state] of Object.entries(doc.claims || {})) {
    if (!state || state.status !== "VERIFIED") continue;
    if (!/^https:\/\//.test(String(official.url || ""))) {
      errors.push({ code: "VOICE_LICENSE_EVIDENCE_FABRICATED", message: `${claim} is VERIFIED but no official https source is recorded` });
    }
    if (!official.quotedStatement) {
      errors.push({ code: "VOICE_LICENSE_EVIDENCE_FABRICATED", message: `${claim} is VERIFIED but no verbatim quoted statement from the official source is recorded` });
    }
    if (!Array.isArray(state.evidenceRefs) || state.evidenceRefs.length === 0) {
      errors.push({ code: "VOICE_LICENSE_EVIDENCE_FABRICATED", message: `${claim} is VERIFIED but carries no evidenceRefs` });
    }
    for (const ref of state.evidenceRefs || []) {
      if (!/^https:\/\//.test(ref) && !/^[a-z0-9_./-]+\.(md|json|js)$/i.test(ref)) {
        errors.push({ code: "VOICE_LICENSE_EVIDENCE_FABRICATED", message: `${claim} evidenceRef ${ref} is neither an https URL nor a repo-relative file` });
      }
    }
  }
  // The whole point of the three claims is that they may differ. Collapsing
  // them into one identical VERIFIED triple with no basis is a smell, not a
  // proof — flag it rather than silently accepting a copy-paste.
  const c = doc.claims || {};
  const statuses = [c.modelLicense, c.voiceAssetRights, c.outputUsageStatus].map((x) => (x ? x.status : null));
  if (statuses.every((s) => s === "VERIFIED")) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_FABRICATED", message: "all three claims VERIFIED with no distinguishing basis — a licence on weights is not evidence of voice-asset or output rights" });
  }
  const secrets = manifestLib.findSecretKeys(doc);
  if (secrets.length > 0) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: `secret-like fields: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "fingerprint mismatch: mutated outside the canonical write path" });
  }
  return { ok: errors.length === 0, errors };
}

function evidencePath(root, provider) {
  return path.join(root, LICENSE_EVIDENCE_REL, `${provider}.json`);
}

function loadLicenseEvidence(root, provider) {
  const p = evidencePath(root, provider);
  if (!fs.existsSync(p)) {
    return { ok: false, code: "VOICE_LICENSE_EVIDENCE_NOT_FOUND", message: `${ERROR_REFS.VOICE_LICENSE_EVIDENCE_NOT_FOUND}: ${LICENSE_EVIDENCE_REL}/${provider}.json` };
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {
    return { ok: false, code: "VOICE_LICENSE_EVIDENCE_INVALID", message: `unparseable evidence: ${String((e && e.message) || e)}` };
  }
  const v = validateLicenseEvidence(raw);
  if (!v.ok) return { ok: false, code: v.errors[0].code, message: v.errors[0].message, errors: v.errors };
  return { ok: true, evidence: raw, rel: path.relative(root, p).split(path.sep).join("/") };
}

/**
 * The three states, flattened for consumption by the Voice Bible readiness
 * gate. A missing evidence document is itself an honest state, never a
 * permissive default.
 */
function rightsStates(root, provider) {
  const loaded = loadLicenseEvidence(root, provider);
  if (!loaded.ok) {
    const missing = {
      modelLicense: { status: "UNRESOLVED", licenseIdentifier: null, detail: loaded.message },
      voiceAssetRights: { status: "UNRESOLVED", licenseIdentifier: null, detail: loaded.message },
      outputUsageStatus: { status: "UNRESOLVED", licenseIdentifier: null, detail: loaded.message },
    };
    return { ok: false, code: loaded.code, message: loaded.message, states: missing, evidence: null };
  }
  const c = loaded.evidence.claims;
  const pick = (x) => ({
    status: x.status,
    licenseIdentifier: x.licenseIdentifier || null,
    scope: x.scope || null,
    basis: x.basis || null,
    retrievedAt: x.retrievedAt || loaded.evidence.retrievedAt,
    evidenceRefs: x.evidenceRefs || [],
  });
  return {
    ok: true,
    evidence: loaded.evidence,
    rel: loaded.rel,
    states: {
      modelLicense: pick(c.modelLicense),
      voiceAssetRights: pick(c.voiceAssetRights),
      outputUsageStatus: pick(c.outputUsageStatus),
    },
  };
}

// ---------------------------------------------------------------------------
// FIX 02 — explicit residual-risk acceptance (never inferred, never VERIFIED).
// ---------------------------------------------------------------------------

/**
 * Review triggers (FIX 02 §6). Risk acceptance goes stale and production
 * readiness fails closed when any of these changes.
 */
const REVIEW_TRIGGERS = [
  "provider",
  "model/version",
  "voiceId",
  "repository license",
  "voice file/hash",
  "intended distribution/use",
  "voice cloning introduced",
  "impersonation/real-person use introduced",
  "commercial/distribution policy materially changes",
  "official source publishes conflicting terms",
];

/**
 * Validate an operator rights decision object. Explicit only: no defaults,
 * no inference — every field must be present and honest.
 */
function validateRightsDecision(dec) {
  const errors = [];
  if (!dec || typeof dec !== "object") {
    return { ok: false, errors: [{ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision must be an object" }] };
  }
  if (dec.decision !== "ACCEPT_RESIDUAL_RIGHTS_RISK" && dec.decision !== "STRICT_VERIFICATION") {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: `rightsDecision.decision must be ACCEPT_RESIDUAL_RIGHTS_RISK or STRICT_VERIFICATION, got ${dec.decision}` });
  }
  if (typeof dec.decisionAt !== "string" || !dec.decisionAt) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision.decisionAt is required" });
  }
  const scope = dec.scope || {};
  for (const k of ["provider", "model", "voiceId", "use"]) {
    if (typeof scope[k] !== "string" || !scope[k]) {
      errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: `rightsDecision.scope.${k} is required` });
    }
  }
  if (scope.noVoiceCloning !== true) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision.scope.noVoiceCloning must be true" });
  }
  if (scope.noImpersonation !== true) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision.scope.noImpersonation must be true" });
  }
  if (!Array.isArray(dec.evidenceRefs) || dec.evidenceRefs.length === 0) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision.evidenceRefs must be non-empty" });
  }
  if (!Array.isArray(dec.residualRisks) || dec.residualRisks.length === 0) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision.residualRisks must be non-empty" });
  }
  if (!Array.isArray(dec.reviewTriggers) || dec.reviewTriggers.length === 0) {
    errors.push({ code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision.reviewTriggers must be non-empty" });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Is a RISK_ACCEPTED pair honestly usable for production? Every condition in
 * FIX 02 §5 must hold; a single mismatch fails closed to REVIEW_REQUIRED.
 */
function isRiskAcceptanceValid(root, provider, opts = {}) {
  const loaded = loadLicenseEvidence(root, provider);
  if (!loaded.ok) return { ok: false, code: loaded.code, message: loaded.message };
  const ev = loaded.evidence;
  const dec = ev.rightsDecision;
  if (!dec) {
    return { ok: false, code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "no explicit operator rightsDecision recorded — risk acceptance cannot be inferred" };
  }
  const v = validateRightsDecision(dec);
  if (!v.ok) return { ok: false, code: v.errors[0].code, message: v.errors[0].message, errors: v.errors };
  if (dec.decision !== "ACCEPT_RESIDUAL_RIGHTS_RISK") {
    return { ok: false, code: "VOICE_RIGHTS_REVIEW_REQUIRED", message: `operator decision is ${dec.decision}: production stays blocked` };
  }
  if (ev.claims.modelLicense.status !== "VERIFIED") {
    return { ok: false, code: "MODEL_LICENSE_REVIEW_REQUIRED", message: "MODEL_LICENSE is not VERIFIED" };
  }
  for (const k of ["voiceAssetRights", "outputUsageStatus"]) {
    if (ev.claims[k].status !== "RISK_ACCEPTED") {
      return { ok: false, code: "VOICE_LICENSE_EVIDENCE_FABRICATED", message: `${k} must be RISK_ACCEPTED under risk acceptance — never relabelled VERIFIED` };
    }
  }
  // Scope must match the live evidence + the approved narrator in use.
  if (dec.scope.provider !== ev.provider || dec.scope.model !== ev.model) {
    return { ok: false, code: "VOICE_LICENSE_EVIDENCE_INVALID", message: "rightsDecision scope does not match the current provider/model" };
  }
  if (opts.voiceId && dec.scope.voiceId !== opts.voiceId) {
    return { ok: false, code: "VOICE_LICENSE_EVIDENCE_INVALID", message: `rightsDecision scope voice ${dec.scope.voiceId} does not match current voice ${opts.voiceId}` };
  }
  // Review triggers: any fired trigger invalidates readiness.
  const fired = (opts.firedReviewTriggers || []).filter(Boolean);
  if (fired.length > 0) {
    return { ok: false, code: "VOICE_RIGHTS_REVIEW_REQUIRED", message: `review trigger fired: ${fired.join(", ")}` };
  }
  return { ok: true, decision: dec, evidence: ev };
}

/**
 * FIX 02 §5 production policy. Terminal (productionReady:true) only when
 * MODEL_LICENSE is VERIFIED and the voice/output pair is either both VERIFIED
 * or both honestly RISK_ACCEPTED under a valid, in-scope operator decision.
 */
function evaluateProductionReadiness(input = {}) {
  const blockers = [];
  const selectionStatus = input.selectionStatus || "PENDING_OPERATOR";
  if (selectionStatus !== "OPERATOR_APPROVED") {
    blockers.push({
      code: selectionStatus === "PROVIDER_DEFAULT" ? "VOICE_SELECTION_PROVIDER_DEFAULT" : "VOICE_SELECTION_PENDING_OPERATOR",
      detail: `selectionStatus=${selectionStatus} is not an explicit operator approval`,
    });
  }
  const states = input.states || {};
  const model = states.modelLicense;
  if (!model || model.status !== "VERIFIED") {
    blockers.push({ code: "MODEL_LICENSE_REVIEW_REQUIRED", detail: `modelLicense is ${model ? model.status : "MISSING"} (not VERIFIED)` });
  }
  const voice = states.voiceAssetRights;
  const output = states.outputUsageStatus;
  const bothVerified = voice && voice.status === "VERIFIED" && output && output.status === "VERIFIED";
  const bothRiskAccepted = voice && voice.status === "RISK_ACCEPTED" && output && output.status === "RISK_ACCEPTED";
  if (bothVerified) {
    // Strict path: fully verified. Nothing further needed.
  } else if (bothRiskAccepted) {
    // Risk path: valid only with an explicit, in-scope operator decision.
    const check = input.riskAcceptance ?? null;
    if (!check || check.ok !== true) {
      blockers.push({
        code: "VOICE_RIGHTS_RISK_ACCEPTANCE_INVALID",
        detail: check && check.message ? check.message : "RISK_ACCEPTED without a valid explicit operator decision",
      });
    }
  } else {
    for (const [key, code] of [["voiceAssetRights", "VOICE_ASSET_RIGHTS_REVIEW_REQUIRED"], ["outputUsageStatus", "OUTPUT_USAGE_STATUS_REVIEW_REQUIRED"]]) {
      const s = states[key];
      // ponytail: one honest code per unresolved claim; RISK_ACCEPTED without a
      // valid decision is reported as its own blocker, not silently downgraded.
      if (!s || (s.status !== "VERIFIED" && s.status !== "RISK_ACCEPTED")) {
        blockers.push({ code, detail: `${key} is ${s ? s.status : "MISSING"} (not VERIFIED)` });
      }
    }
    if (voice && voice.status === "RISK_ACCEPTED" && (!input.riskAcceptance || input.riskAcceptance.ok !== true)) {
      blockers.push({ code: "VOICE_RIGHTS_RISK_ACCEPTANCE_INVALID", detail: "voiceAssetRights RISK_ACCEPTED without a valid explicit operator decision" });
    }
    if (output && output.status === "RISK_ACCEPTED" && (!input.riskAcceptance || input.riskAcceptance.ok !== true)) {
      blockers.push({ code: "VOICE_RIGHTS_RISK_ACCEPTANCE_INVALID", detail: "outputUsageStatus RISK_ACCEPTED without a valid explicit operator decision" });
    }
  }
  return {
    productionReady: blockers.length === 0,
    reviewRequired: blockers.length > 0,
    selectionStatus,
    blockerCodes: blockers.map((b) => b.code),
    blockers: blockers.map((b) => `${b.code}: ${b.detail}`),
  };
}

// ---------------------------------------------------------------------------
// Runtime discovery (§3) — never invent a voice id.
// ---------------------------------------------------------------------------

/** Is the configured runtime actually importable? Never auto-installs. */
function probeRuntime() {
  try {
    const r = spawnSync("python", ["-c", "import kokoro,sys;print(getattr(kokoro,'__version__','unknown'))"], { encoding: "utf8", timeout: 30000 });
    if (r.error || r.status !== 0) {
      return { installed: false, reason: (r.stderr || (r.error && r.error.message) || "python -c import kokoro failed").toString().trim().split("\n").pop() };
    }
    return { installed: true, version: String(r.stdout || "").trim() };
  } catch (e) {
    return { installed: false, reason: String((e && e.message) || e) };
  }
}

/**
 * Discover the voices the CONFIGURED runtime actually exposes.
 *
 * Kokoro ships NO static voice inventory: `KPipeline.load_single_voice()` resolves
 * any id at synthesis time via `hf_hub_download(repo_id, "voices/<id>.pt")`. So
 * an honest inventory must come from the repo the runtime itself binds to, and a
 * voice may only be reported as AVAILABLE once the runtime has actually loaded
 * it. Globbing the package directory (an earlier, broken attempt) always
 * returns empty, because no `.pt` file lives there.
 *
 * The hardcoded DEFAULT_VOICES table in the adapter is a per-language fallback,
 * NOT an inventory — using it here would fabricate discovery. When the runtime
 * is absent this returns an empty inventory and a reason; it never guesses.
 */
function discoverRuntimeVoices(opts = {}) {
  const probe = opts.probe || probeRuntime();
  if (!probe.installed) {
    return {
      ok: false,
      code: "VOICE_RUNTIME_UNAVAILABLE",
      message: `${ERROR_REFS.VOICE_RUNTIME_UNAVAILABLE}: ${probe.reason}`,
      runtime: probe,
      inventory: [],
      source: "NONE",
      note: "Voice ids are discovered from the installed runtime only. The adapter's DEFAULT_VOICES fallback table is a resolution default, not an inventory, and is never reported as discovered voices.",
    };
  }
  const verify = Array.isArray(opts.verify) ? opts.verify.filter((v) => typeof v === "string" && v) : [];
  const script = [
    "import json,sys",
    "from huggingface_hub import list_repo_files",
    "from kokoro import KPipeline",
    "p=KPipeline(lang_code='a')",
    "repo=p.repo_id",
    "files=list_repo_files(repo)",
    "voices=sorted(f[len('voices/'):-len('.pt')] for f in files if f.startswith('voices/') and f.endswith('.pt'))",
    "ok=[];bad={}",
    "for v in json.loads(sys.argv[1]):",
    "    try:",
    "        if v not in voices: raise KeyError('not in runtime inventory')",
    "        p.load_voice(v)",
    "        ok.append(v)",
    "    except Exception as e:",
    "        bad[v]=str(e)",
    "print(json.dumps({'repoId':repo,'voices':voices,'verified':ok,'failed':bad}))",
  ].join("\n");
  let parsed = null;
  try {
    const r = spawnSync("python", ["-c", script, JSON.stringify(verify)], { encoding: "utf8", timeout: opts.timeoutMs || 600000 });
    if (r.status === 0 && r.stdout) parsed = JSON.parse(String(r.stdout).trim().split("\n").pop());
  } catch (e) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.voices)) {
    return {
      ok: false,
      code: "VOICE_DISCOVERY_FAILED",
      message: `${ERROR_REFS.VOICE_DISCOVERY_FAILED}: the runtime did not return an inventory`,
      runtime: probe,
      inventory: [],
      source: "NONE",
    };
  }
  return {
    ok: true,
    runtime: probe,
    repoId: parsed.repoId,
    inventory: parsed.voices,
    source: "RUNTIME",
    // A voice is only usable if the runtime really loaded it — enumeration
    // alone proves the file is published, not that this runtime can serve it.
    verified: Array.isArray(parsed.verified) ? parsed.verified : [],
    failed: parsed.failed && typeof parsed.failed === "object" ? parsed.failed : {},
    note: "Inventory read from the repo the installed runtime binds to, via the runtime's own resolver; `verified` voices were actually loaded by the runtime.",
  };
}

// ---------------------------------------------------------------------------
// Preview pack (§4) — same script, same speed/defaults, same format.
// ---------------------------------------------------------------------------

const PREVIEW_SAMPLE_TEXT = "Kokoro is an open weight text to speech model with eighty two million parameters.";

// Previews reuse the adapter's own artifact placement
// (assets/voice/<sceneId>/<requestId>.wav); the pack never invents a second
// location for the same bytes.

/**
 * Render ONE preview per shortlisted voice through the real adapter, with the
 * same text/speed/format for every voice so they are comparable.
 */
async function buildPreviewPack(root, projectId, voiceIds = [], opts = {}) {
  const speed = opts.speedDefault === undefined ? 1 : opts.speedDefault;
  const text = opts.text || PREVIEW_SAMPLE_TEXT;
  const lifecycle = workspaceLib.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: PREVIEW_LIFECYCLE });
  if (!lifecycle.ok) return { ok: false, code: "VOICE_BIBLE_LIFECYCLE_INVALID", message: lifecycle.message };

  const results = [];
  const language = opts.language || "en-us";
  // Default scene/request ids are byte-identical to the original single-script
  // pack; the optional prefixes only exist so a multi-script comparison does not
  // overwrite its own clips.
  const sceneId = opts.sceneId || "voice-preview";
  const requestIdFor = (voiceId) => (opts.requestIdPrefix ? `${opts.requestIdPrefix}-${voiceId}` : `preview-${voiceId}`);
  for (const voiceId of voiceIds) {
    // Compare previews only: enforce the shared script/speed/format invariant.
    if (opts.text && opts.text !== text) return { ok: false, code: "VOICE_PREVIEW_FAILED", message: "all previews must use one identical sample text" };
    try {
      const out = await kokoro.execute({
        requestId: requestIdFor(voiceId),
        projectId,
        sceneId,
        capability: "tts",
        input: { text, voice: voiceId, language, speed },
        outputRequirements: { format: "wav" },
      }, {
        projectRoot: root,
        kokoroTransport: opts.transport,
        // Declare the shortlist under evaluation as this language's allowlist.
        // The adapter otherwise permits only its single per-language default,
        // which would make a multi-voice preview impossible even with Kokoro
        // installed. This is NOT discovery — the ids came from the caller.
        kokoroVoices: { [language]: voiceIds.slice() },
      });
      results.push({ voiceId, ok: true, artifactPath: out.artifactPath, sampleRate: 24000, durationTarget: "same-script", metadata: out.metadata });
    } catch (e) {
      results.push({ voiceId, ok: false, errorCode: e.errorCode || "VOICE_PREVIEW_FAILED", errorClass: e.errorClass || "permanent", message: e.message });
    }
  }
  const rendered = results.filter((r) => r.ok).map((r) => r.voiceId);
  const failed = results.filter((r) => !r.ok);
  return {
    ok: rendered.length > 0,
    code: rendered.length > 0 ? null : "VOICE_PREVIEW_FAILED",
    lifecycleClass: PREVIEW_LIFECYCLE,
    sampleText: text,
    speedDefault: speed,
    format: "wav",
    previews: results,
    rendered,
    failed,
    note: "Selection scratch only. Not production narration, no music/SFX, no external paid credits.",
  };
}

// ---------------------------------------------------------------------------
// Operator approval (§5) — explicit human decision, no auto-select path.
// ---------------------------------------------------------------------------

/**
 * Record an explicit operator decision. There is intentionally no default and
 * no scoring shortcut: the caller must pass the exact voiceId the operator
 * chose AND the shortlist that was presented, so a selection can never be
 * made against a list the operator never saw.
 */
function approveNarratorVoice(input = {}) {
  const approved = input.approvedVoiceId;
  if (typeof approved !== "string" || !approved) {
    return { ok: false, code: "OPERATOR_APPROVAL_REQUIRED", message: `${ERROR_REFS.OPERATOR_APPROVAL_REQUIRED}: pass approvedVoiceId exactly as the operator stated it (APPROVED_NARRATOR_VOICE = <voiceId>)` };
  }
  const shortlist = Array.isArray(input.shortlist) ? input.shortlist : null;
  if (!shortlist || shortlist.length === 0) {
    return { ok: false, code: "OPERATOR_APPROVAL_REQUIRED", message: `${ERROR_REFS.OPERATOR_APPROVAL_REQUIRED}: the shortlist presented to the operator must be supplied so the choice is auditable` };
  }
  if (!shortlist.includes(approved)) {
    return { ok: false, code: "OPERATOR_APPROVAL_MISMATCH", message: `${ERROR_REFS.OPERATOR_APPROVAL_MISMATCH}: ${approved} was not in the presented shortlist (${shortlist.join(", ")})` };
  }
  if (input.runtimeInventory && !input.runtimeInventory.includes(approved)) {
    return { ok: false, code: "OPERATOR_APPROVAL_UNKNOWN_VOICE", message: `${ERROR_REFS.OPERATOR_APPROVAL_UNKNOWN_VOICE}: ${approved} is not in the runtime inventory` };
  }
  if (typeof input.approvalStatement !== "string" || !input.approvalStatement.includes(approved)) {
    return { ok: false, code: "OPERATOR_APPROVAL_REQUIRED", message: `${ERROR_REFS.OPERATOR_APPROVAL_REQUIRED}: approvalStatement must record the operator's literal decision, e.g. "APPROVED_NARRATOR_VOICE = ${approved}"` };
  }
  if (input.previewPathFor === undefined || input.previewPathFor === null || input.previewPathFor === "") {
    return { ok: false, code: "OPERATOR_APPROVAL_REQUIRED", message: `${ERROR_REFS.OPERATOR_APPROVAL_REQUIRED}: a preview reference for the approved voice is required — approval is made against heard audio, not a name` };
  }
  return {
    ok: true,
    approval: {
      selectionStatus: "OPERATOR_APPROVED",
      approvedVoiceId: approved,
      approvalStatement: input.approvalStatement,
      previewRef: input.previewPathFor,
      shortlistPresented: shortlist,
      decidedAt: input.decidedAt || new Date().toISOString(),
      decidedBy: input.decidedBy || "operator",
    },
  };
}

module.exports = {
  LICENSE_EVIDENCE_SCHEMA_VERSION,
  LICENSE_EVIDENCE_REL,
  PREVIEW_LIFECYCLE,
  PREVIEW_SAMPLE_TEXT,
  ERROR_REFS,
  REVIEW_TRIGGERS,
  fingerprintOf,
  validateLicenseEvidence,
  validateRightsDecision,
  isRiskAcceptanceValid,
  evaluateProductionReadiness,
  evidencePath,
  loadLicenseEvidence,
  rightsStates,
  probeRuntime,
  discoverRuntimeVoices,
  buildPreviewPack,
  approveNarratorVoice,
};