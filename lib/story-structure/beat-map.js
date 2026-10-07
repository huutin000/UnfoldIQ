"use strict";

/**
 * UNFOLDIQ Story Beat Map runtime (1G.3, Prompt 01).
 *
 * A Story Beat is a meaningful narrative unit (question / setup / evidence /
 * reveal / contrast / resolution), NOT a sentence, subtitle, or TTS segment.
 * Boundaries follow role changes detected deterministically over the story
 * draft text; adjacent sentences with the same role merge into one Beat.
 * Beat identity is stable over canonical inputs (section ref + text hash +
 * role + relative position), not list position.
 *
 * Coverage invariant: every story section that contributes to the narrative
 * is covered by >= 1 Beat. Beats carry claimRefs only as REFERENCES inherited
 * from their story section — they never invent or upgrade claims.
 */

const shared = require("./shared.js");
const { STRUCTURE_VERSION, hash16, id12, normalizeText, splitSentences, classifySentence } = shared;

function draftRef(draft) {
  return { draftId: draft && draft.draftId, fingerprint: (draft && draft.draftFingerprint) || null };
}

function roleForSectionStart(storyFunction, firstSentenceRole) {
  if (storyFunction === "hook") return firstSentenceRole === "QUESTION" ? "QUESTION" : "SETUP";
  if (storyFunction === "payoff") return "RESOLUTION";
  if (storyFunction === "framing") return "REFLECTION";
  return firstSentenceRole;
}

function visualNeedFor(role, claimRefCount) {
  if (claimRefCount > 0) return "CLAIM_EVIDENCE";
  if (role === "REVEAL" || role === "CONTRAST") return "MOTION";
  if (role === "RESOLUTION" || role === "REFLECTION") return "STILL";
  return "CONTEXT";
}

/**
 * Build a deterministic Beat Map from a Story Draft.
 * Input: { projectId, storyDraft, narrativeBrief?, contentClass, platform?, now? }
 */
function buildBeatMap(input = {}) {
  const draft = input.storyDraft;
  if (!draft || !Array.isArray(draft.sections) || draft.sections.length === 0) {
    return { ok: false, code: "BEAT_SOURCE_INVALID", message: "storyDraft with sections is required" };
  }
  if (!input.contentClass || !["FACTUAL", "FICTION", "HYBRID"].includes(input.contentClass)) {
    return { ok: false, code: "INVALID_CONTENT_CLASS", message: "contentClass must be FACTUAL|FICTION|HYBRID" };
  }
  const projectId = input.projectId || draft.projectId || "project";
  const now = input.now || new Date().toISOString();

  const beats = [];
  let order = 0;
  for (const section of draft.sections) {
    const sentences = splitSentences(section.draftText);
    if (sentences.length === 0) continue; // empty husk sections are dropped upstream; nothing to cover
    // Group adjacent sentences with the same narrative role into one Beat.
    const groups = [];
    for (const sentence of sentences) {
      let role = classifySentence(sentence);
      if (groups.length === 0) {
        role = roleForSectionStart(section.storyFunction, role);
      }
      const last = groups[groups.length - 1];
      if (last && last.role === role && role !== "QUESTION") {
        last.sentences.push(sentence);
      } else {
        groups.push({ role, sentences: [sentence] });
      }
    }
    groups.forEach((group, gi) => {
      const text = group.sentences.join(" ");
      const textHash = hash16(normalizeText(text));
      const beatId = id12("bt", {
        projectId,
        sectionId: section.sectionId,
        textHash,
        role: group.role,
        indexInSection: gi,
      });
      const claimRefs = [...(section.claimRefs || [])];
      beats.push({
        beatId,
        order: order++,
        storySectionRef: section.sectionId,
        narrativeRole: group.role,
        summary: normalizeText(group.sentences[0]).slice(0, 240),
        claimRefs,
        classificationRefs: [...(section.classificationRefs || [])],
        importance: claimRefs.length > 0 ? "high" : "normal",
        visualNeed: visualNeedFor(group.role, claimRefs.length),
        continuityHints: [],
        textHash,
      });
    });
  }

  if (beats.length === 0) {
    return { ok: false, code: "BEAT_SOURCE_INVALID", message: "story draft has no coverable content" };
  }

  const beatMapId = id12("bm", { projectId, draft: draftRef(draft).draftId, beatIds: beats.map((b) => b.beatId) });
  const beatMap = {
    version: STRUCTURE_VERSION,
    beatMapId,
    projectId,
    platform: input.platform || draft.platform || null,
    contentClass: input.contentClass,
    sourceStoryDraftRef: draftRef(draft),
    sourceNarrativeBriefRef: (input.narrativeBrief && input.narrativeBrief.briefId)
      ? { briefId: input.narrativeBrief.briefId }
      : null,
    beats,
    fingerprint: hash16({ beatMapId, beats: beats.map((b) => [b.beatId, b.narrativeRole, b.textHash]) }),
    status: "GENERATED",
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, beatMap };
}

/** Structural signature for downstream comparison / memory advisory. */
function beatShapeSignature(beatMap) {
  return (beatMap.beats || []).map((b) => b.narrativeRole).join(">");
}

module.exports = { buildBeatMap, beatShapeSignature, draftRef };
module.exports.shared = shared;
