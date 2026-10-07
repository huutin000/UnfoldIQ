"use strict";

/**
 * Generic motion/video prompt adapter (1G.4 §15-§17). Motion semantics only:
 * what moves, how, camera motion (only when canonical), environment motion,
 * temporal progression, and what must remain unchanged.
 *
 * Image-to-video continuity (§16): with a reference frame, the subject is the
 * ESTABLISHED visual — identity/wardrobe/style are NOT redefined; the prompt
 * focuses on motion and preservation.
 *
 * Aspect ratio via generationMetadata (config semantics). No model names.
 * No generation. No Veo decision.
 */

const ADAPTER_ID = "VIDEO_GENERIC";
const ADAPTER_VERSION = "1.0.0";
const DEFAULT_BUDGET_CHARS = 2000;

function section(header, body) {
  if (!body) return null;
  return `${header}: ${body}`;
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

  const subjectBody = referenceFirst || (spec.referenceRefs || []).some((r) => r.kind === "CHARACTER")
    ? `${spec.subject.descriptor} — animate the established visual; appearance already locked by the reference`
    : spec.subject.descriptor;

  const cameraMotion = spec.camera && spec.camera.motion ? spec.camera.motion : (spec.camera && spec.camera.position ? `static ${spec.camera.position}` : null);
  const progression = spec.shot && spec.shot.startState || spec.shot && spec.shot.endState
    ? `${spec.shot.startState || "established state"} -> ${spec.shot.endState || "held state"}`
    : null;

  const sections = [
    { key: "CRITICAL", text: critical.filter(Boolean).join("\n") },
    { key: "SUBJECT", text: section("SUBJECT", subjectBody) },
    { key: "ACTION", text: section("ACTION", spec.action) },
    { key: "CAMERA_MOTION", text: section("CAMERA MOTION", cameraMotion) },
    { key: "ENVIRONMENT_MOTION", text: section("ENVIRONMENT MOTION", spec.environmentMotion || spec.environment.descriptor || (spec.environment.refs.length ? `subtle ambient motion in ${spec.environment.refs.join(", ")}` : null)) },
    { key: "PROGRESSION", text: section("TEMPORAL PROGRESSION", progression) },
    { key: "COMPOSITION", text: section("COMPOSITION", spec.composition) },
    { key: "FOCUS_LENS", text: section("FOCUS / LENS", spec.focusLens) },
    { key: "LIGHTING", text: section("AMBIANCE", spec.lightingAmbiance) },
    { key: "STYLE", text: section("STYLE", spec.style) },
    { key: "AVOID", text: spec.mustAvoid.length ? section("AVOID", spec.mustAvoid.join("; ")) : null },
  ].filter((s) => s.text);

  // §16: with a locked reference/character, visual style and identity are
  // owned by the reference — the motion prompt must NOT redefine them.
  const styleLockedByReference = referenceFirst || (spec.referenceRefs || []).some((r) => r.kind === "CHARACTER" || r.kind === "FRAME");
  const filteredSections = styleLockedByReference
    ? sections.filter((s) => s.key !== "STYLE")
    : sections;

  let text = filteredSections.map((s) => s.text).join("\n");
  let dropped = [];
  if (text.length > budgetChars) {
    const dropOrder = ["STYLE", "LIGHTING", "FOCUS_LENS", "COMPOSITION"];
    let current = filteredSections.filter(Boolean);
    for (const key of dropOrder) {
      const remaining = current.filter((s) => s.key !== key);
      if (remaining.length === current.length) continue;
      dropped.push(key);
      current = remaining;
      text = remaining.map((s) => s.text).join("\n");
      if (text.length <= budgetChars) { filteredSections.length = 0; filteredSections.push(...remaining); break; }
    }
    if (text.length > budgetChars) {
      return { ok: false, code: "BUDGET_EXCEEDED_REQUIRED_LOSS", message: "required prompt content exceeds adapter budget" };
    }
  }

  const requiredCapabilities = ["VIDEO_GENERATION"];
  if (hasFrame) requiredCapabilities.push("IMAGE_TO_VIDEO");
  if ((spec.referenceRefs || []).some((r) => r.kind === "CHARACTER" || r.kind === "STYLE")) {
    requiredCapabilities.push("IMAGE_REFERENCE");
  }

  return {
    ok: true,
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    compiledPrompt: text,
    sections: filteredSections.map((s) => s.key),
    droppedForBudget: dropped,
    generationMetadata: {
      platformComposition: spec.platformComposition || null,
      targetKind: "VIDEO",
      referenceFrameUsed: hasFrame,
    },
    requiredCapabilities,
    budgetChars,
    hasReferenceFrame: hasFrame,
  };
}

module.exports = { ADAPTER_ID, ADAPTER_VERSION, DEFAULT_BUDGET_CHARS, compile };
