"use strict";

/**
 * UNFOLDIQ Editorial Strategy / Narrative Brief runtime (1G.1O, Prompt 04).
 *
 * Transforms evidence + context into editorial intent: what the video says,
 * why the audience cares, which angle, what matters, what stays uncertain.
 * Selects claims ONLY from the Pack (fiction: story context + targeted facts).
 * Angle/order/emphasis/omission are free; dates/outcomes/certainty are not.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const BRIEF_VERSION = "1.0.0";

function briefHashOf(obj) {
  return crypto.createHash("sha256").update(stableStringify(obj), "utf8").digest("hex").slice(0, 16);
}

function packClaimIds(pack) {
  const ids = new Set();
  for (const key of ["verifiedFacts", "primarySourceFacts", "independentlyCorroboratedFacts", "derivedContext", "conflictingClaims", "unverifiedClaims"]) {
    for (const e of (pack && pack[key]) || []) ids.add(e.claimId);
  }
  return ids;
}

/**
 * Build a Narrative Brief. Input: { projectId, contentClass, contentMode,
 * pack? (FACTUAL/HYBRID), policy, brief? (creative), platform,
 * angle, coreViewerQuestion?, mainInsight?, hookBasis? {type, claimId?},
 * progressionOverride? [{stepId, purpose, claimIds[]}],
 * omitClaimIds? [], payoff?, endingIntent?, ctaIntent?,
 * storyContext? (FICTION premise/beats), targetedFactClaimIds? (FICTION),
 * fictionalizationBoundary? (HYBRID) }.
 */
function buildNarrativeBrief(input = {}) {
  const contentClass = input.contentClass;
  if (!["FACTUAL", "FICTION", "HYBRID"].includes(contentClass)) {
    return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `unknown contentClass ${contentClass}` };
  }
  if (typeof input.angle !== "string" || !input.angle.trim()) {
    return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: "editorial angle is required (analyst/agent choice, never invented by the builder)" };
  }
  if (typeof input.coreViewerQuestion !== "string" || !input.coreViewerQuestion.trim()) {
    return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: "coreViewerQuestion is required" };
  }
  const platform = input.platform || (input.brief && input.brief.platform) || null;
  if (platform && !["youtube", "tiktok"].includes(platform)) {
    return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `non-canonical platform ${platform}` };
  }

  const brief = {
    briefId: null,
    briefVersion: BRIEF_VERSION,
    projectId: input.projectId || (input.pack && input.pack.projectId) || null,
    contentClass,
    contentMode: input.contentMode || (input.pack && input.pack.contentMode) || null,
    audience: (input.brief && input.brief.audience) || null,
    platform,
    targetDuration: (input.brief && input.brief.targetDuration) || null,
    viewerPromise: (input.brief && input.brief.viewerPromise) || null,
    primaryLearningGoal: (input.brief && input.brief.primaryLearningGoal) || null,
    desiredFeeling: (input.brief && input.brief.desiredFeeling) || null,
    contentDensity: (input.brief && input.brief.contentDensity) || null,
    coreViewerQuestion: input.coreViewerQuestion.trim(),
    editorialAngle: input.angle.trim(),
    mainInsight: typeof input.mainInsight === "string" ? input.mainInsight.trim() : "",
    hookBasis: input.hookBasis || null,
    narrativeProgression: [],
    payoff: typeof input.payoff === "string" ? input.payoff.trim() : "",
    endingIntent: input.endingIntent || null,
    ctaIntent: input.ctaIntent || null,
    selectedClaimIds: [],
    claimsToOmit: [...(input.omitClaimIds || [])],
    disputesToPreserve: [],
    unknownsToPreserve: [],
    requiredAttributions: [],
    fictionalizationBoundary: input.fictionalizationBoundary || null,
    storytellingConstraints: [],
  };

  if (contentClass === "FICTION") {
    // No pack needed; targeted facts keep evidence rules, plot stays free.
    brief.selectedClaimIds = [...(input.targetedFactClaimIds || [])];
    brief.storyContext = input.storyContext || null;
    if (input.policy) {
      for (const id of brief.selectedClaimIds) {
        const known = (input.policy.allowedClaims || []).some((c) => c.claimId === id) ||
          (input.policy.restrictedClaims || []).some((c) => c.claimId === id) ||
          (input.policy.targetedFactClaims || []).includes(id);
        if (!known) {
          return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `targeted fact ${id} has no evidence standing` };
        }
      }
    }
  } else {
    const pack = input.pack;
    if (!pack || !pack.packId) {
      return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `${contentClass} narrative needs a Research Pack` };
    }
    const available = packClaimIds(pack);
    const selected = input.selectedClaimIds || [...available].filter((id) => {
      // Default selection: verified + corroborated + derived (non-conflict, non-unverified).
      for (const key of ["verifiedFacts", "primarySourceFacts", "independentlyCorroboratedFacts", "derivedContext"]) {
        if ((pack[key] || []).some((e) => e.claimId === id)) return true;
      }
      return false;
    });
    for (const id of selected) {
      if (!available.has(id)) {
        return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `selected claim ${id} does not exist in Pack` };
      }
    }
    // Misleading-by-omission guard: material conflicts/unknowns cannot vanish silently.
    const materialConflicts = (pack.conflictingClaims || []).map((e) => e.claimId);
    const materialUnknowns = (pack.unknowns || []).filter((u) => u.materiality === "critical" || u.materiality === "material").map((u) => u.unknownId || u.description);
    for (const id of materialConflicts) {
      if (brief.claimsToOmit.includes(id)) {
        return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `material conflict ${id} cannot be silently omitted (frame or keep)` };
      }
    }
    brief.selectedClaimIds = selected.filter((id) => !brief.claimsToOmit.includes(id));
    brief.disputesToPreserve = materialConflicts.filter((id) => !brief.claimsToOmit.includes(id));
    brief.unknownsToPreserve = materialUnknowns;
    if (input.policy) {
      brief.requiredAttributions = (input.policy.requiredAttributions || [])
        .filter((a) => brief.selectedClaimIds.includes(a.claimId));
    }
    brief.packRef = { packId: pack.packId, packHash: pack.packHash };
    if (contentClass === "HYBRID" && !brief.fictionalizationBoundary) {
      return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: "HYBRID narrative needs an explicit fictionalizationBoundary" };
    }
  }

  // Viewer promise preserved verbatim when the brief carries one.
  if (brief.viewerPromise && input.viewerPromise && input.viewerPromise !== brief.viewerPromise) {
    return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: "narrative must not rewrite the Creative Brief viewerPromise" };
  }
  if (input.viewerPromise) brief.viewerPromise = input.viewerPromise;

  // Hook basis must stay compatible with evidence/classification.
  if (brief.hookBasis) {
    const hb = brief.hookBasis;
    if (hb.claimId && contentClass !== "FICTION") {
      const available = input.pack ? packClaimIds(input.pack) : new Set();
      if (!available.has(hb.claimId)) {
        return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `hook claim ${hb.claimId} not in Pack` };
      }
      if (input.policy) {
        const { usageFor } = require("./script-evidence-gate.js");
        const use = usageFor(input.policy, hb.claimId);
        if (use.verdict === "forbid") {
          return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `hook claim ${hb.claimId} is forbidden as fact (${use.rule})` };
        }
      }
    }
  }

  // Progression: explicit override or deterministic question-ordered default
  // (viewer-question order, never raw source order).
  if (Array.isArray(input.progressionOverride) && input.progressionOverride.length > 0) {
    for (const step of input.progressionOverride) {
      for (const id of step.claimIds || []) {
        if (contentClass !== "FICTION" && !(input.pack && packClaimIds(input.pack).has(id))) {
          return { ok: false, code: "EDITORIAL_STRATEGY_INVALID", message: `progression claim ${id} not in Pack` };
        }
      }
    }
    brief.narrativeProgression = input.progressionOverride;
  } else {
    brief.narrativeProgression = defaultProgression(brief, input);
  }

  // Scope hint from density/duration: section-count estimate only (marked as such).
  const density = brief.contentDensity || "balanced";
  const steps = brief.narrativeProgression.length;
  brief.scopeEstimate = {
    sections: contentClass === "FICTION" && brief.narrativeProgression.length === 0 ? 4 : Math.max(3, Math.min(steps + 2, density === "lean" ? 5 : density === "dense" ? 9 : 7)),
    note: "approximate section-count estimate for planning only; not a word count",
  };
  brief.storytellingConstraints = [
    ...(contentClass === "FICTION" ? [] : ["every material factual assertion carries claimRefs", "no internal IDs in viewer text"]),
    ...(contentClass === "HYBRID" ? ["preserve FACT/FOLKLORE/TESTIMONY/SPECULATION/FICTIONALIZED_ELEMENT per section"] : []),
    "no spoken-cadence humanization in this draft (1G.3 scope)",
  ];

  brief.briefId = `nb-${briefHashOf({ ...brief, briefId: null })}`.slice(0, 15);
  return { ok: true, brief };
}

function defaultProgression(brief, input) {
  const steps = [];
  if (brief.hookBasis) steps.push({ stepId: "hook", purpose: `hook: ${brief.hookBasis.type}`, claimIds: brief.hookBasis.claimId ? [brief.hookBasis.claimId] : [] });
  const questions = (input.planQuestions || []).filter((q) => typeof q === "string" && q);
  const perQuestion = Math.max(1, Math.ceil(brief.selectedClaimIds.length / Math.max(1, questions.length)));
  questions.forEach((q, i) => {
    steps.push({
      stepId: `q${i}`,
      purpose: `answer viewer question: ${q.slice(0, 120)}`,
      claimIds: brief.selectedClaimIds.slice(i * perQuestion, (i + 1) * perQuestion),
    });
  });
  if (brief.disputesToPreserve.length > 0) {
    steps.push({ stepId: "dispute", purpose: "frame preserved dispute(s) honestly", claimIds: [...brief.disputesToPreserve] });
  }
  if (brief.unknownsToPreserve.length > 0) {
    steps.push({ stepId: "unknowns", purpose: "keep material unknowns visible", claimIds: [] });
  }
  steps.push({ stepId: "payoff", purpose: brief.payoff || "deliver the promised payoff", claimIds: [] });
  return steps;
}

module.exports = {
  BRIEF_VERSION,
  buildNarrativeBrief,
  packClaimIds,
};
