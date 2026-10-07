"use strict";

/**
 * Generic image prompt adapter (1G.4 §14, §21). Compiles the canonical spec
 * into image-oriented prompt TEXT with deterministic section ordering that
 * mirrors current official provider guidance: subject -> action/pose ->
 * context/environment -> composition -> camera/framing -> lighting -> style,
 * with critical identity/factual constraints FIRST.
 *
 * Aspect ratio / output size live in generationMetadata (config-parameter
 * semantics), never duplicated as prose. No model names. No generation.
 */

const ADAPTER_ID = "IMAGE_GENERIC";
const ADAPTER_VERSION = "1.0.0";
const DEFAULT_BUDGET_CHARS = 1600;

function section(header, body) {
  if (!body) return null;
  return `${header}: ${body}`;
}

/**
 * Priority-preserving shortening (§21): optional aesthetic sections are
 * dropped first; identity/continuity and factual constraints are never
 * dropped. Returns null when required content still exceeds budget.
 */
function shorten(sections, budgetChars) {
  const dropOrder = ["STYLE", "LIGHTING", "CAMERA", "COMPOSITION"];
  const dropped = [];
  let current = sections.filter(Boolean);
  for (const key of dropOrder) {
    const remaining = current.filter((s) => s.key !== key);
    if (remaining.length === current.length) continue;
    dropped.push(key);
    current = remaining;
    const text = remaining.map((s) => s.text).join("\n");
    if (text.length <= budgetChars) return { sections: remaining, dropped, text };
  }
  return { sections: current, dropped, text: current.map((s) => s.text).join("\n") };
}

function compile(spec, opts = {}) {
  const budgetChars = opts.budgetChars || DEFAULT_BUDGET_CHARS;
  const referenceFirst = spec.subject.referenceFirst;
  const hasFrame = (spec.referenceRefs || []).some((r) => r.kind === "FRAME");

  const critical = [];
  if (spec.mustPreserve.length > 0) {
    critical.push(section("MUST PRESERVE", spec.mustPreserve.join(", ")));
  }
  if (spec.historicalConstraints) critical.push(section("HISTORICAL CONSTRAINTS", spec.historicalConstraints));
  if (spec.scientificConstraints) critical.push(section("SCIENTIFIC CONSTRAINTS", spec.scientificConstraints));

  const subjectBody = referenceFirst
    ? `${spec.subject.descriptor} — appearance defined by the locked reference; do not re-imagine identity`
    : spec.subject.descriptor;
  const cameraBody = typeof spec.camera === "string"
    ? spec.camera
    : (spec.camera ? [spec.camera.position, spec.camera.motion].filter(Boolean).join(", ") : null);
  const sections = [
    { key: "CRITICAL", text: critical.filter(Boolean).join("\n") },
    { key: "SUBJECT", text: section("SUBJECT", subjectBody) },
    { key: "ACTION", text: section("ACTION", spec.action) },
    { key: "ENVIRONMENT", text: section("ENVIRONMENT", spec.environment.descriptor || (spec.environment.refs.length ? spec.environment.refs.join(", ") : null)) },
    { key: "COMPOSITION", text: section("COMPOSITION", spec.composition) },
    { key: "CAMERA", text: section("CAMERA", cameraBody) },
    { key: "LIGHTING", text: section("LIGHTING", spec.lightingAmbiance) },
    { key: "STYLE", text: section("STYLE", spec.style) },
    { key: "AVOID", text: spec.mustAvoid.length ? section("AVOID", spec.mustAvoid.join("; ")) : null },
  ].filter((s) => s.text);

  let text = sections.map((s) => s.text).join("\n");
  let dropped = [];
  if (text.length > budgetChars) {
    const result = shorten(sections, budgetChars);
    text = result.text;
    dropped = result.dropped;
    if (text.length > budgetChars) {
      return { ok: false, code: "BUDGET_EXCEEDED_REQUIRED_LOSS", message: "required prompt content exceeds adapter budget" };
    }
  }

  const requiredCapabilities = ["IMAGE_GENERATION"];
  if ((spec.referenceRefs || []).some((r) => r.kind === "CHARACTER" || r.kind === "STYLE")) {
    requiredCapabilities.push("IMAGE_REFERENCE");
  }

  return {
    ok: true,
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    compiledPrompt: text,
    sections: sections.map((s) => s.key),
    droppedForBudget: dropped,
    generationMetadata: {
      platformComposition: spec.platformComposition || null,
      targetKind: "IMAGE",
      referenceImageCount: (spec.referenceRefs || []).filter((r) => r.kind !== "FRAME").length,
    },
    requiredCapabilities,
    budgetChars,
    hasReferenceFrame: hasFrame,
  };
}

module.exports = { ADAPTER_ID, ADAPTER_VERSION, DEFAULT_BUDGET_CHARS, compile };
