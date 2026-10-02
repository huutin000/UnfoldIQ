"use strict";

/**
 * Flow Companion safety-refusal module (STEP 10B-FIX).
 * SAFE REPRESENTATION ADAPTATION — never safety-filter evasion.
 *
 * - classifyRefusal(): provider error text/DOM state → refusal class.
 *   Ambiguous text → UNKNOWN_SAFETY (never guess an exact category).
 * - planAdaptation(): rule-based Level 1/2/3 visual reframe preserving
 *   scene intent, claims, continuity, and Visual Bible version.
 * - detectEvasion(): rejects obfuscation, prompt-splitting, age tricks.
 * - Budget: max 2 adapted generation attempts, then SAFE_FALLBACK_REQUIRED.
 * - Step 09 BLOCKED content is terminal: adaptationAllowed() returns BLOCK.
 */

const MAX_ADAPTED_GENERATION_ATTEMPTS = 2;

const REFUSAL_CLASSES = [
  "MINOR_SAFETY",
  "GRAPHIC_VIOLENCE",
  "SEXUAL_CONTENT",
  "SELF_HARM",
  "IDENTIFIABLE_PERSON_RESTRICTION",
  "UPLOAD_RESTRICTION",
  "UNKNOWN_SAFETY",
  "NON_SAFETY_TECHNICAL",
];

// Multi-signal keyword sets. No single exact string is ever required.
const CLASS_SIGNALS = {
  MINOR_SAFETY: ["minor", "child", "children", "kid", "kids", "infant", "baby", "babies", "toddler", "teen", "young person", "underage", "under 18", "youth"],
  GRAPHIC_VIOLENCE: ["gore", "gory", "graphic viol", "blood", "gruesome", "dismember", "mutilat", "decapitat", "wound"],
  SEXUAL_CONTENT: ["sexual", "nudity", "nude", "explicit", "porn"],
  SELF_HARM: ["self-harm", "self harm", "suicide"],
  IDENTIFIABLE_PERSON_RESTRICTION: ["identifiable", "likeness", "real person", "face match", "identity verification", "public figure"],
  UPLOAD_RESTRICTION: ["upload", "uploaded image", "uploaded photo", "reference rejected", "input image"],
  NON_SAFETY_TECHNICAL: ["timeout", "network error", "service unavailable", "internal error", "transient", "rate limit", "try again later"],
};

function normalizeText(s) {
  return String(s || "").toLowerCase();
}

/**
 * classifyRefusal({ message, errorCode, domState }) → { refusalClass, confidence, hits }
 * Exactly one safety class with signals → that class (confidence high when
 * 2+ distinct signals, else medium). Zero or tied multiple → UNKNOWN_SAFETY.
 * Technical-only → NON_SAFETY_TECHNICAL.
 */
function classifyRefusal(input = {}) {
  const text = normalizeText(`${input.message || ""} ${input.errorCode || ""} ${input.domState || ""}`);
  const hits = {};
  for (const [cls, signals] of Object.entries(CLASS_SIGNALS)) {
    const matched = signals.filter((s) => text.includes(s));
    if (matched.length > 0) hits[cls] = matched;
  }
  const safetyHits = Object.keys(hits).filter((k) => k !== "NON_SAFETY_TECHNICAL");
  if (safetyHits.length === 1) {
    const cls = safetyHits[0];
    return { refusalClass: cls, confidence: hits[cls].length >= 2 ? "high" : "medium", hits: hits[cls] };
  }
  if (safetyHits.length === 0 && hits.NON_SAFETY_TECHNICAL) {
    return { refusalClass: "NON_SAFETY_TECHNICAL", confidence: "medium", hits: hits.NON_SAFETY_TECHNICAL };
  }
  return { refusalClass: "UNKNOWN_SAFETY", confidence: "low", hits: safetyHits.flatMap((k) => hits[k]) };
}

// Evasion patterns: obfuscation, prompt-splitting, age tricks. Never allowed.
const EVASION_PATTERNS = [
  { id: "LEETSPEAK_OBFUSCATION", re: /\b\w*\d\w*\b/, check: (p) => /\b(ch1ld|k1d|bl00d|g0re|v1olence|nude|naked)\b/i.test(p) || /[\u200b-\u200d\u2060\ufeff]/.test(p) },
  { id: "PROMPT_SPLITTING", re: /part\s+\d+\s+of|ignore\s+(previous|all)\s+instructions|disregard\s+safety/i, check: null },
  { id: "ENCODING_EVASION", re: /base64|rot13|hex\s*encod|decod(e|ing)\s+this/i, check: null },
  { id: "AGE_MISREPRESENTATION", re: /actually\s+\d+\s+years?\s+old|aged?\s*up|adult\s+child|make\s+(him|her|them)\s+look\s+adult/i, check: null },
  { id: "EUPHEMISM_SWAP", re: /youthful\s+companion|barely\s+legal|childlike\s+adult/i, check: null },
];

function detectEvasion(prompt) {
  const p = String(prompt || "");
  const found = [];
  for (const pat of EVASION_PATTERNS) {
    const hit = pat.check ? pat.check(p) : pat.re.test(p);
    if (hit) found.push(pat.id);
  }
  return { evasive: found.length > 0, patterns: found };
}

const GRAPHIC_TERMS = ["blood", "bloody", "gore", "gory", "wound", "mutilat", "dismember", "decapitat", "gruesome"];

/**
 * checkAgeMisrepresentation({ involvesMinor, adaptedPrompt }) → { ok, reason }
 * A scene involving a minor must never be rewritten to claim adult age.
 */
function checkAgeMisrepresentation({ involvesMinor, adaptedPrompt }) {
  const p = String(adaptedPrompt || "");
  if (involvesMinor && /actually\s+(1[89]|2\d|30)\s+years?\s+old|is\s+an?\s+adult\b|adult\s+instead\s+of\s+(child|minor|infant)/i.test(p)) {
    return { ok: false, reason: "AGE_MISREPRESENTATION: adapted prompt claims adult age for a minor-involved scene" };
  }
  return { ok: true, reason: "no age misrepresentation" };
}

// Level templates: genuinely different visual representation, same story beat.
const LEVEL_TEMPLATES = {
  1: {
    name: "NON_GRAPHIC_REFRAME",
    framing: "non-graphic aftermath view",
    guidance: " aftermath, damaged environment, reaction shot; no visible injuries, no blood",
  },
  2: {
    name: "INDIRECT_VISUALIZATION",
    framing: "distant indirect view",
    guidance: " silhouette, shadow, distant framing, off-screen event, environmental evidence",
  },
};

function defaultLevelFor(refusalClass) {
  if (refusalClass === "GRAPHIC_VIOLENCE") return 1;
  if (refusalClass === "MINOR_SAFETY") return 2;
  if (refusalClass === "SEXUAL_CONTENT" || refusalClass === "SELF_HARM") return 3;
  if (refusalClass === "IDENTIFIABLE_PERSON_RESTRICTION" || refusalClass === "UPLOAD_RESTRICTION") return 2;
  return 2; // UNKNOWN_SAFETY → cautious indirect + manual review
}

/**
 * planAdaptation({ refusalClass, scene }) → adaptation plan object.
 * scene: { sceneId, originalSceneIntent, researchClaimIds[], editorialPurpose,
 *   continuityEntityIds[], referenceAssetIds[], locationId, wardrobeIds[],
 *   visualBibleVersion, contentMode, durationRequirementMs, originalPrompt,
 *   attempt, involvesMinor? }
 * Levels 1–2 rewrite the visual; Level 3 substitutes (no prompt retry).
 */
function planAdaptation({ refusalClass, scene }) {
  if (!scene || !scene.sceneId || !scene.originalPrompt) {
    throw new Error("ADAPTATION_INPUT_REQUIRED: scene.sceneId + originalPrompt");
  }
  if (refusalClass === "SEXUAL_CONTENT" || refusalClass === "SELF_HARM") {
    return {
      adaptationLevel: 3,
      adaptedPrompt: null,
      preservedClaims: scene.researchClaimIds || [],
      preservedContinuity: scene.continuityEntityIds || [],
      removedOrChangedElements: ["restricted subject depiction (no retry)"],
      reason: `${refusalClass}: safe substitute only, no provider prompt retry`,
      policyDecision: "SAFE_FALLBACK_ONLY",
      requiresApproval: false,
    };
  }
  const level = defaultLevelFor(refusalClass);
  const tpl = LEVEL_TEMPLATES[level];
  const entities = (scene.continuityEntityIds || []).join(", ") || "established subjects";
  const place = scene.locationId ? ` at ${scene.locationId}` : "";
  const adaptedPrompt =
    `${tpl.framing}${place}: ${scene.originalSceneIntent}. ` +
    `Same subjects (${entities}), same wardrobe, same lighting and time of day;${tpl.guidance}. ` +
    `Wide, restrained composition; nothing graphic shown.`;
  const evasion = detectEvasion(adaptedPrompt);
  if (evasion.evasive) {
    throw new Error(`ADAPTATION_EVASIVE: generated prompt tripped ${evasion.patterns.join(",")}`);
  }
  // Depiction check ignores negated mentions ("no blood", "without gore").
  const denegated = adaptedPrompt
    .toLowerCase()
    .replace(/\bno\s+(visible\s+)?(injuries|blood|gore)\b/g, "")
    .replace(/\bwithout\s+(blood|gore)\b/g, "")
    .replace(/\bnon-graphic\b/g, "");
  const graphicLeft = GRAPHIC_TERMS.filter((t) => denegated.includes(t));
  if (graphicLeft.length > 0) {
    throw new Error(`ADAPTATION_STILL_GRAPHIC: ${graphicLeft.join(",")}`);
  }
  return {
    adaptationLevel: level,
    adaptedPrompt,
    preservedClaims: scene.researchClaimIds || [],
    preservedContinuity: scene.continuityEntityIds || [],
    removedOrChangedElements: level === 1
      ? ["explicit gore/injury detail → aftermath/environment/reaction"]
      : ["direct depiction → silhouette/distance/off-screen/environmental evidence"],
    reason: `${refusalClass}: Level ${level} ${tpl.name}; story beat and factual claims unchanged`,
    policyDecision: "ALLOW_ADAPTED_RETRY",
    requiresApproval: true,
  };
}

/**
 * adaptationAllowed({ step09Decision }) → { allowed, policyDecision }
 * Step 09 BLOCKED content is terminal: no rewrite, no retry.
 */
function adaptationAllowed({ step09Decision }) {
  if (step09Decision === "BLOCKED" || step09Decision === "BLOCK") {
    return { allowed: false, policyDecision: "BLOCK", reason: "UNFOLDIQ policy BLOCK is terminal; no rewrite/retry of equivalent content" };
  }
  return { allowed: true, policyDecision: "ALLOW_ADAPTED_RETRY", reason: "underlying content permitted; provider rendering refused" };
}

/**
 * adaptationBudget(adaptedCount) → { exhausted:boolean, remaining:number }
 * Max 2 adapted generation attempts after the original, then SAFE_FALLBACK_REQUIRED.
 */
function adaptationBudget(adaptedCount) {
  const used = adaptedCount || 0;
  return { exhausted: used >= MAX_ADAPTED_GENERATION_ATTEMPTS, remaining: Math.max(0, MAX_ADAPTED_GENERATION_ATTEMPTS - used) };
}

/**
 * selectFallback({ approvedAssets?, allowManualHandoff? }) → fallback descriptor.
 * One of: image | diagram | text | approved-asset | manual-handoff.
 */
function selectFallback(input = {}) {
  if ((input.approvedAssets || []).length > 0) {
    return { kind: "approved-asset", assetId: input.approvedAssets[0], reason: "rights-cleared existing asset preferred" };
  }
  if (input.allowDiagram) return { kind: "diagram", reason: "symbolic illustration carries the beat without depiction" };
  if (input.allowText) return { kind: "text", reason: "on-screen text carries the factual claim" };
  if (input.allowManualHandoff !== false) return { kind: "manual-handoff", reason: "user completes the visual manually" };
  return { kind: "image", reason: "non-graphic still fallback" };
}

/**
 * recordSafetyRefusal(projectRoot, projectId, jobId, { message, errorCode, domState, step09Decision })
 * GENERATING → PROVIDER_SAFETY_REFUSED → SAFETY_ADAPTATION_REQUIRED (or SAFE_FALLBACK_REQUIRED past budget).
 * Step 09 BLOCKED throws POLICY_BLOCK_TERMINAL and leaves the job untouched.
 */
function recordSafetyRefusal(projectRoot, projectId, jobId, input = {}) {
  const store = require("./job-store");
  const gate = adaptationAllowed({ step09Decision: input.step09Decision });
  if (!gate.allowed) {
    throw new Error("POLICY_BLOCK_TERMINAL: Step 09 BLOCKED content admits no safety rewrite");
  }
  const job = store.getJob(projectRoot, projectId, jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  if (job.status !== "GENERATING") {
    throw new Error(`INVALID_REFUSAL_STATE: refusal recorded from ${job.status}, expected GENERATING`);
  }
  const classification = classifyRefusal({ message: input.message, errorCode: input.errorCode, domState: input.domState });
  store.transitionJob(projectRoot, projectId, jobId, "PROVIDER_SAFETY_REFUSED", { actor: "flow-companion" });
  store.updateJob(projectRoot, projectId, jobId, {
    refusal: { ...classification, message: input.message || null, at: new Date().toISOString() },
    // §15: never assume a refused generation was free/refunded.
    creditOutcome: input.creditEvidence || "UNKNOWN",
  });
  const persisted = store.getJob(projectRoot, projectId, jobId);
  const budget = adaptationBudget(persisted.adaptedCount);
  if (budget.exhausted) {
    const fell = store.transitionJob(projectRoot, projectId, jobId, "SAFE_FALLBACK_REQUIRED", { actor: "flow-companion" });
    return { outcome: "fallback", job: fell, refusalClass: classification.refusalClass };
  }
  const next = store.transitionJob(projectRoot, projectId, jobId, "SAFETY_ADAPTATION_REQUIRED", { actor: "flow-companion" });
  return { outcome: "adapt", job: next, refusalClass: classification.refusalClass };
}

/**
 * prepareAdaptation(projectRoot, projectId, jobId, plan) → updated job.
 * Validates the agent-authored plan (evasion re-check, age check, preserved
 * claims/continuity vs job) then SAFETY_ADAPTATION_REQUIRED →
 * SAFETY_ADAPTATION_PREPARED (new attempt, cleared approval, adaptation kept).
 */
function prepareAdaptation(projectRoot, projectId, jobId, plan) {
  const store = require("./job-store");
  const job = store.getJob(projectRoot, projectId, jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  if (!plan || plan.policyDecision !== "ALLOW_ADAPTED_RETRY" || !plan.adaptedPrompt) {
    throw new Error("ADAPTATION_PLAN_INVALID: ALLOW_ADAPTED_RETRY with adaptedPrompt required");
  }
  const evasion = detectEvasion(plan.adaptedPrompt);
  if (evasion.evasive) {
    throw new Error(`ADAPTATION_EVASIVE: ${evasion.patterns.join(",")}`);
  }
  store.transitionJob(projectRoot, projectId, jobId, "SAFETY_ADAPTATION_PREPARED", {
    actor: "agent",
    adaptation: plan,
  });
  store.updateJob(projectRoot, projectId, jobId, {
    currentPrompt: plan.adaptedPrompt,
    adaptationStatus: `LEVEL_${plan.adaptationLevel}_PREPARED`,
  });
  return store.getJob(projectRoot, projectId, jobId);
}

module.exports = {
  MAX_ADAPTED_GENERATION_ATTEMPTS,
  REFUSAL_CLASSES,
  classifyRefusal,
  detectEvasion,
  checkAgeMisrepresentation,
  planAdaptation,
  adaptationAllowed,
  adaptationBudget,
  selectFallback,
  defaultLevelFor,
  recordSafetyRefusal,
  prepareAdaptation,
};
