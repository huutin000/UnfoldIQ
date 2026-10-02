"use strict";

/**
 * UNFOLDIQ Storytelling runtime + structured Story Draft (1G.1P, Prompt 04).
 *
 * Production executor is DETERMINISTIC: sections composed from the Narrative
 * Brief progression + Pack claim statements through fixed editorial templates
 * (no invented facts, no quotes unless verified, qualifiers/attributions from
 * policy data only). An agent-exchange executor exists for provider-supplied
 * sections, validated through the identical schema + semantic gates.
 * Provider/model choice never alters the artifact schema.
 *
 * Draft = editorial narrative draft. NOT TTS-ready spoken script (1G.3 owns
 * cadence, breath/pause, naturalness). No humanization transforms here.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");
const { usageFor, qualifierPresent, attributionSatisfied } = require("./script-evidence-gate.js");

const DRAFT_VERSION = "1.0.0";
const TEMPLATE_VERSION = "story-template-1.0.0";
const MAX_REVISIONS = 3;

function draftHashOf(obj) {
  return crypto.createHash("sha256").update(stableStringify(obj), "utf8").digest("hex").slice(0, 16);
}

function claimMap(pack) {
  const map = new Map();
  if (!pack) return map;
  for (const key of ["verifiedFacts", "primarySourceFacts", "independentlyCorroboratedFacts", "derivedContext", "conflictingClaims", "unverifiedClaims"]) {
    for (const e of pack[key] || []) {
      if (!map.has(e.claimId)) map.set(e.claimId, e);
    }
  }
  return map;
}

function renderClaimSentence(entry, policy, pack) {
  // Deterministic editorial sentence from ledger statement + policy data.
  // No new facts: only the claim statement plus required attribution/qualifier.
  let text = entry.statement.trim();
  if (!/[.!?]$/.test(text)) text += ".";
  const use = policy ? usageFor(policy, entry.claimId) : { verdict: "allow" };
  if (use.verdict === "dispute") {
    text = `Accounts differ here: ${lowerFirst(text)} The disagreement is preserved rather than settled.`;
  } else {
    if (use.attribution && !attributionSatisfied(text, use.attribution)) {
      text = `According to ${use.attribution.publisher}, ${lowerFirst(text)}`;
    }
    if (use.qualifier && !qualifierPresent(text, use.qualifier.qualifier)) {
      const word = use.qualifier.qualifier === "uncertain" ? "Current evidence suggests " : "Approximately speaking, ";
      text = `${word}${lowerFirst(text)}`;
    }
  }
  return text;
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function composeSection(step, claims, policy, pack, brief) {
  const texts = [];
  const refs = [];
  const classifications = [];
  for (const id of step.claimIds || []) {
    const entry = claims.get(id);
    if (!entry) continue; // validated earlier; skip defensively, audit catches
    texts.push(renderClaimSentence(entry, policy, pack));
    refs.push(id);
    if (entry.classification) classifications.push({ claimId: id, classification: entry.classification });
  }
  if (step.stepId === "dispute" && brief.disputesToPreserve.length > 0) {
    texts.push("On one point the sources do not agree, and the story keeps that disagreement visible instead of choosing silently.");
  }
  if (step.stepId === "unknowns" && brief.unknownsToPreserve.length > 0) {
    texts.push("Some questions remain open, and the story does not invent answers for them.");
  }
  if (step.stepId === "payoff") {
    texts.push(brief.payoff || "The story closes on its central insight.");
  }
  if (step.stepId === "hook" && texts.length === 0) {
    texts.push(hookFallback(brief));
  }
  return {
    sectionId: step.stepId,
    purpose: step.purpose,
    draftText: texts.join(" "),
    claimRefs: refs,
    classificationRefs: classifications,
    requiredAttributionsSatisfied: refs.map((id) => {
      const use = policy ? usageFor(policy, id) : {};
      return { claimId: id, satisfied: !use.attribution ? true : attributionSatisfied(texts.join(" "), use.attribution) };
    }),
    storyFunction: step.stepId === "hook" ? "hook" : step.stepId === "payoff" ? "payoff" :
      (step.stepId === "dispute" || step.stepId === "unknowns") ? "framing" : "development",
  };
}

function hookFallback(brief) {
  const q = (brief.coreViewerQuestion || "the question behind this story").trim();
  return `A question worth asking: ${q.charAt(0).toLowerCase() + q.slice(1).replace(/\?$/, "")}. This story follows the evidence to an answer.`;
}

function fictionSection(step, brief) {
  // Pure-fiction beats carry no claim refs (valid). Targeted facts attach refs.
  const refs = (step.claimIds || []).filter((id) => (brief.selectedClaimIds || []).includes(id));
  const texts = [];
  if (step.stepId === "hook") texts.push(fictionHook(brief));
  else if (step.stepId === "payoff") texts.push(brief.payoff || "The story lands where its premise promised.");
  else texts.push(`The narrative continues through ${step.purpose || "the next beat"}.`);
  if (refs.length > 0) texts.push("(Grounded detail held to evidence.)");
  return {
    sectionId: step.stepId,
    purpose: step.purpose,
    draftText: texts.join(" "),
    claimRefs: refs,
    classificationRefs: [],
    requiredAttributionsSatisfied: [],
    storyFunction: step.stepId,
  };
}

function fictionHook(brief) {
  const premise = (brief.storyContext && brief.storyContext.premise) || "a premise";
  return `The story opens on ${premise}. What follows is invented — except where the world itself is real.`;
}

function composeDeterministic(request) {
  const { narrativeBrief: brief, pack, policy } = request;
  const claims = claimMap(pack);
  const sections = [];
  const progression = brief.narrativeProgression.length > 0 ? brief.narrativeProgression : [{ stepId: "body", purpose: "develop the story", claimIds: brief.selectedClaimIds || [] }];
  for (const step of progression) {
    const section = brief.contentClass === "FICTION"
      ? fictionSection(step, brief)
      : composeSection(step, claims, policy, pack, brief);
    if (section.draftText.trim()) sections.push(section); // drop claim-less husks, never emit empty sections
  }
  if (sections.length === 0) {
    return { ok: false, errors: ["no sections with evidence to render"] };
  }
  return sections;
}

function validateDraftStructure(draft) {
  const errors = [];
  if (!draft || typeof draft !== "object") return ["draft must be an object"];
  for (const key of ["draftId", "contentClass", "narrativeBriefRef", "sections"]) {
    if (draft[key] === undefined) errors.push(`missing ${key}`);
  }
  if (!Array.isArray(draft.sections) || draft.sections.length === 0) errors.push("sections must be a non-empty array");
  const ids = new Set();
  for (const s of draft.sections || []) {
    if (!s.sectionId || ids.has(s.sectionId)) errors.push(`bad/duplicate sectionId ${s.sectionId}`);
    ids.add(s.sectionId);
    if (typeof s.draftText !== "string" || !s.draftText.trim()) errors.push(`empty draftText in ${s.sectionId}`);
    if (!Array.isArray(s.claimRefs)) errors.push(`claimRefs must be an array in ${s.sectionId}`);
    if (/\b(clm|src|pack|ctr|unk)-[0-9a-f]{6,}\b/.test(s.draftText)) errors.push(`internal trace ID leaked into viewer text in ${s.sectionId}`);
  }
  return errors;
}

/**
 * StoryDraftRequest: { narrativeBrief, pack?, policy?, platform?,
 * executor: 'deterministic' | 'agent-exchange', providerSections?,
 * providerId? }. Agent sections validated through the same gates.
 */
function generateStoryDraft(request = {}) {
  const brief = request.narrativeBrief;
  if (!brief || !brief.briefId) {
    return { ok: false, code: "STORY_DRAFT_INVALID", message: "story draft needs a valid Narrative Brief" };
  }
  if (request.executor === "agent-exchange") {
    if (!Array.isArray(request.providerSections) || request.providerSections.length === 0) {
      return { ok: false, code: "STORY_PROVIDER_UNAVAILABLE", message: "agent-exchange supplied no sections" };
    }
  } else if (request.executor && request.executor !== "deterministic") {
    return { ok: false, code: "STORY_DRAFT_INVALID", message: `unknown executor ${request.executor}` };
  }
  const sections = request.executor === "agent-exchange"
    ? normalizeProviderSections(request.providerSections)
    : composeDeterministic(request);
  if (!sections.ok && sections.errors) {
    return { ok: false, code: "STORY_DRAFT_INVALID", message: sections.errors.join("; ") };
  }
  const list = sections.ok ? sections.sections : sections;
  const draft = {
    draftId: `drf-${draftHashOf({ b: brief.briefId, s: list.map((s) => [s.sectionId, s.draftText, s.claimRefs]) }).slice(0, 12)}`,
    draftVersion: DRAFT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    contentClass: brief.contentClass,
    narrativeBriefRef: { briefId: brief.briefId },
    researchPackRef: brief.packRef || (request.pack ? { packId: request.pack.packId, packHash: request.pack.packHash } : null),
    platform: request.platform || brief.platform || null,
    providerId: request.executor === "agent-exchange" ? (request.providerId || "agent-exchange") : "deterministic-composer",
    generatedAt: new Date().toISOString(),
    sections: list,
  };
  const structural = validateDraftStructure(draft);
  if (structural.length > 0) {
    return { ok: false, code: "STORY_DRAFT_INVALID", message: structural.join("; ") };
  }
  return { ok: true, draft };
}

function normalizeProviderSections(sections) {
  const errors = [];
  const out = [];
  const ids = new Set();
  sections.forEach((s, i) => {
    if (!s || typeof s !== "object") { errors.push(`section ${i} not an object`); return; }
    if (!s.sectionId || ids.has(s.sectionId)) { errors.push(`bad/duplicate sectionId at ${i}`); return; }
    ids.add(s.sectionId);
    out.push({
      sectionId: s.sectionId,
      purpose: s.purpose || "",
      draftText: s.draftText || "",
      claimRefs: Array.isArray(s.claimRefs) ? s.claimRefs.filter((c) => typeof c === "string") : [],
      classificationRefs: Array.isArray(s.classificationRefs) ? s.classificationRefs : [],
      requiredAttributionsSatisfied: [],
      storyFunction: s.storyFunction || s.sectionId,
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, sections: out };
}

function renderDraftMarkdown(draft) {
  const lines = [`# Story Draft (${draft.contentClass})`, ""];
  for (const s of draft.sections) {
    lines.push(`## ${s.sectionId} — ${s.purpose || s.storyFunction}`, "", s.draftText, "");
  }
  return lines.join("\n");
}

module.exports = {
  DRAFT_VERSION,
  TEMPLATE_VERSION,
  MAX_REVISIONS,
  generateStoryDraft,
  validateDraftStructure,
  normalizeProviderSections,
  renderDraftMarkdown,
  claimMap,
};
