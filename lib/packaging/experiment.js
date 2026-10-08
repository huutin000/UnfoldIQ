"use strict";

/**
 * Phase 4A §9–§19, §34–§36 — PublishExperimentSet + paired variants.
 *
 * Title+thumbnail PAIRS are first-class; up to 3 variants, each with
 * concept/audience/hypothesis. Variants are assembled deterministically
 * from caller-provided concepts (no hidden LLM); when generation is used,
 * the caller records model/prompt/seed/attempt in generationRecord.
 * No 3×3 combinatorial explosion, no cosmetic pseudo-variants.
 */

const crypto = require("crypto");
const profiles = require("./profiles.js");

const EXPERIMENT_VERSION = "1.0.0";
const TARGET_VARIANTS = 3;
const MIN_VARIANTS = 2;
const TITLE_ANGLES = ["CURIOSITY", "QUESTION", "OUTCOME", "CONTRAST", "EXPLANATION", "STORY", "DIRECT"];
const THUMB_SOURCES = ["FRAME", "COMPOSITE", "GENERATED", "ILLUSTRATION", "CHART", "OTHER"];

function sha12(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 12);
}
function nowIso() { return new Date().toISOString(); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function finding(code, extra = {}) {
  return { code, severity: extra.severity || "REVIEW", variantId: extra.variantId || null, field: extra.field || null, reason: extra.reason || code, correctiveAction: extra.correctiveAction || null };
}

/** Review-signal readability metrics (not hard blockers except via profile). */
function titleMetrics(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const letters = text.replace(/[^A-Za-z]/g, "");
  const upper = (letters.match(/[A-Z]/g) || []).length;
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  const punct = (text.match(/[!?.,:;'"\-–—()]/g) || []).length;
  const tokens = words.map((w) => w.toLowerCase());
  return {
    characterCount: text.length,
    wordCount: words.length,
    importantPrefix: words.slice(0, 3).join(" "),
    allCapsRatio: letters.length ? +(upper / letters.length).toFixed(3) : 0,
    emojiCount: emoji,
    punctuationDensity: words.length ? +(punct / words.length).toFixed(3) : 0,
    tokens,
  };
}

function wordSet(text) {
  return new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 2));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * Assemble one packaging variant from a caller-provided concept.
 * conceptInput: { concept, audience, hypothesis, semanticAngle, noveltyAxis[],
 *   expectedTradeoff?, title: { text, angle, primaryClaim, claimRefs[] },
 *   thumbnail: { assetId, concept, visualClaim, subjectRefs?, textOverlay?,
 *     textLegibility?, sourceType, width, height, format, fileSizeBytes,
 *     claimRefs[], provenanceRef? } }
 */
function buildVariant(conceptInput = {}, context = {}) {
  const errors = [];
  const t = conceptInput.title || {};
  const th = conceptInput.thumbnail || {};
  if (!conceptInput.concept) errors.push("variant concept required");
  if (!conceptInput.audience) errors.push("variant audience required");
  if (!conceptInput.hypothesis) errors.push("variant hypothesis required");
  if (!t.text) errors.push("title text required");
  if (t.angle && !TITLE_ANGLES.includes(t.angle)) errors.push(`unknown title angle ${t.angle}`);
  if (!th.assetId) errors.push("MISSING_PROVENANCE: thumbnail must be a canonical assetId, never an anonymous file");
  if (th.sourceType && !THUMB_SOURCES.includes(th.sourceType)) errors.push(`unknown thumbnail sourceType ${th.sourceType}`);
  if (errors.length) return { ok: false, errors };
  if (context.assetResolver) {
    const asset = context.assetResolver(th.assetId);
    if (!asset || !asset.hash) return { ok: false, errors: [`MISSING_PROVENANCE: thumbnail asset ${th.assetId} unresolvable`] };
  }
  const metrics = titleMetrics(t.text);
  const variantId = `pkv-${sha12({ c: conceptInput.concept, t: t.text, a: th.assetId })}`;
  return {
    ok: true,
    variant: {
      variantId,
      concept: conceptInput.concept,
      audience: conceptInput.audience,
      hypothesis: conceptInput.hypothesis,
      title: {
        text: t.text,
        angle: t.angle || "DIRECT",
        primaryClaim: t.primaryClaim || "",
        claimRefs: (t.claimRefs || []).slice(),
        characterCount: metrics.characterCount,
        importantPrefix: metrics.importantPrefix,
        metrics,
        qaStatus: "REVIEW_REQUIRED",
      },
      thumbnail: {
        assetId: th.assetId,
        concept: th.concept || conceptInput.concept,
        visualClaim: th.visualClaim || "",
        subjectRefs: (th.subjectRefs || []).slice(),
        textOverlay: th.textOverlay || null,
        textLegibility: th.textLegibility || null,
        sourceType: th.sourceType || "FRAME",
        aspectRatio: `${th.width || 1920}:${th.height || 1080}`,
        width: th.width || 1920,
        height: th.height || 1080,
        format: th.format || "JPG",
        fileSizeBytes: th.fileSizeBytes || 0,
        claimRefs: (th.claimRefs || []).slice(),
        provenanceRef: th.provenanceRef || `provenance:${th.assetId}`,
        generationRecord: th.generationRecord || null,
        qaStatus: "REVIEW_REQUIRED",
      },
      semanticAngle: conceptInput.semanticAngle || t.angle || "DIRECT",
      claimRefs: [...new Set([...(t.claimRefs || []), ...(th.claimRefs || [])])],
      noveltyAxis: (conceptInput.noveltyAxis || []).slice(),
      expectedTradeoff: conceptInput.expectedTradeoff || null,
      generationRecord: conceptInput.generationRecord || null,
      status: "CANDIDATE",
    },
  };
}

/**
 * Build an experiment set from 2–3 concepts. Deterministic: same inputs →
 * same experimentSetId (idempotent retry, Case W).
 */
function buildPublishExperimentSet(input = {}, context = {}) {
  const { projectId, platform = "youtube", profileRef = "youtube-long-form@1.0.0", concepts = [] } = input;
  const profile = profiles.getPublishProfile(profileRef);
  if (!projectId || !profile) return { ok: false, code: "INPUT_INVALID", message: "projectId + known profileRef required" };
  if (concepts.length < MIN_VARIANTS) {
    return { ok: false, code: "INPUT_INVALID", message: `at least ${MIN_VARIANTS} meaningful variants required (target ${TARGET_VARIANTS})` };
  }
  if (concepts.length > TARGET_VARIANTS) {
    return { ok: false, code: "INPUT_INVALID", message: `at most ${TARGET_VARIANTS} variants (no 3×3 explosion)` };
  }
  const variants = [];
  for (const c of concepts) {
    const r = buildVariant(c, context);
    if (!r.ok) return { ok: false, code: "VARIANT_INVALID", message: r.errors[0], errors: r.errors };
    variants.push(r.variant);
  }
  const set = {
    experimentSetId: `pxs-${sha12({ p: projectId, prof: profileRef, v: variants.map((v) => v.variantId) })}`,
    version: EXPERIMENT_VERSION,
    projectId,
    platform,
    profileRef,
    variants,
    experimentModesSupported: ["TITLE_ONLY", "THUMBNAIL_ONLY", "TITLE_AND_THUMBNAIL"],
    selectionPolicy: input.selectionPolicy || "OPERATOR_SELECTS_OR_FIRST_PASSING",
    selectedVariantId: null,
    selectionReason: null,
    hypothesisSummary: variants.map((v) => `${v.variantId}: ${v.hypothesis}`).join(" | "),
    contentHashes: input.contentHashes || {},
    packagingPolicyVersion: EXPERIMENT_VERSION,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    qaStatus: "REVIEW_REQUIRED",
  };
  return { ok: true, set };
}

/** Structural diversity QA — explainable rules, no magic ML thresholds. */
function checkVariantDiversity(set) {
  const findings = [];
  const vs = set.variants || [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i];
      const b = vs[j];
      const sameClaim = a.title.primaryClaim && a.title.primaryClaim === b.title.primaryClaim;
      const sameAsset = a.thumbnail.assetId === b.thumbnail.assetId;
      const titleSim = jaccard(wordSet(a.title.text), wordSet(b.title.text));
      const hypSim = jaccard(wordSet(a.hypothesis), wordSet(b.hypothesis));
      if (sameClaim && sameAsset) {
        findings.push(finding("VARIANTS_TOO_SIMILAR", { severity: "BLOCK", variantId: b.variantId, field: "concept", reason: `same primary claim + same thumbnail asset as ${a.variantId} — cosmetic pseudo-variant`, correctiveAction: "REPLAN_VARIANT" }));
      } else if (titleSim >= 0.8 && sameClaim) {
        findings.push(finding("VARIANTS_TOO_SIMILAR", { severity: "BLOCK", variantId: b.variantId, field: "title", reason: `title overlap ${(titleSim).toFixed(2)} on identical claim — synonym swap, not a new angle`, correctiveAction: "REPLAN_VARIANT" }));
      } else if (sameAsset && hypSim >= 0.8) {
        findings.push(finding("VARIANTS_TOO_SIMILAR", { severity: "REVIEW", variantId: b.variantId, field: "hypothesis", reason: `same thumbnail asset with near-identical hypothesis as ${a.variantId}`, correctiveAction: "REPLAN_VARIANT" }));
      }
    }
  }
  return findings;
}

function selectPackagingVariant(set, variantId, reason, byOperator = true) {
  const working = clone(set);
  const v = working.variants.find((x) => x.variantId === variantId);
  if (!v) return { ok: false, code: "VARIANT_NOT_FOUND", message: variantId };
  for (const x of working.variants) x.status = x.variantId === variantId ? "SELECTED" : "REJECTED";
  working.selectedVariantId = variantId;
  working.selectionReason = `${byOperator ? "operator" : "policy"}: ${reason || "selected"}`;
  working.updatedAt = nowIso();
  return { ok: true, set: working };
}

module.exports = {
  EXPERIMENT_VERSION,
  TARGET_VARIANTS,
  MIN_VARIANTS,
  TITLE_ANGLES,
  THUMB_SOURCES,
  titleMetrics,
  buildVariant,
  buildPublishExperimentSet,
  checkVariantDiversity,
  selectPackagingVariant,
};
