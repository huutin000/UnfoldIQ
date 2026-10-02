"use strict";

/**
 * UNFOLDIQ Story Draft Evidence Audit (Prompt 04, §39-§42) + bounded revision loop.
 *
 * Clean input does not guarantee the generator invented nothing: every draft
 * section is checked against the Pack + Script Evidence Policy. Deterministic
 * checks catch structural violations; an optional semantic hook covers deeper
 * comparison. States: PASS / NEEDS_REVISION / BLOCKED.
 *
 * Revision is mechanical and evidence-bound: drop offending sentences, add
 * required attribution/qualifiers from policy data, frame disputes from pack
 * data. No new facts are ever introduced by revision.
 */

const { usageFor, qualifierPresent, attributionSatisfied } = require("./script-evidence-gate.js");
const { claimMap } = require("./story-draft.js");

const AUDIT_VERSION = "story-audit-1.0.0";
const MAX_REVISIONS = 3;

function err(code, message, sectionId) {
  return { code, message, sectionId: sectionId || null };
}

function extractNumbers(text) {
  const found = String(text || "").match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return [...new Set(found.map((n) => n.replace(/,/g, "")))];
}

function extractQuotes(text) {
  const out = [];
  const re = /"([^"]{2,280})"/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) out.push(m[1]);
  return out;
}

/** Trailing sentence punctuation inside closing quotes is not fabrication. */
function normalizeQuote(q) {
  return String(q || "").replace(/[.,;:!?]+$/, "");
}

function numberInCorpus(num, corpus) {
  const flat = corpus.replace(/,/g, "");
  if (flat.includes(num)) return true;
  // Approximate match tolerance: "300000" vs "300,000" handled above; word forms not matched (conservative).
  return false;
}

function auditSection(section, context = {}) {
  const issues = [];
  const { pack, policy, claims } = context;
  const byId = claims || claimMap(pack);
  const text = section.draftText || "";
  const contentClass = context.contentClass || (policy && policy.contentClass) || "FACTUAL";

  for (const id of section.claimRefs || []) {
    if (!byId.has(id)) {
      issues.push(err("UNSUPPORTED_STORY_CLAIM", `claimRef ${id} does not exist in Pack`, section.sectionId));
    }
  }
  const factualSection = contentClass !== "FICTION" ||
    ((section.claimRefs || []).length > 0);
  if (contentClass !== "FICTION" && (section.claimRefs || []).length === 0 &&
    !["hook", "payoff", "framing"].includes(section.storyFunction) && text.trim().length > 0) {
    // Hook/payoff/framing may legitimately carry no refs; development sections must.
    if (section.storyFunction === "development" || !section.storyFunction) {
      issues.push(err("UNSUPPORTED_STORY_CLAIM", "material factual section has no claimRefs", section.sectionId));
    }
  }

  for (const id of section.claimRefs || []) {
    const entry = byId.get(id);
    if (!entry) continue;
    const use = policy ? usageFor(policy, id) : { verdict: "allow" };
    const corpus = [entry.statement, entry.caveat || "", ...((entry.verifiedQuotes || []))].join("\n");
    if (use.verdict === "forbid") {
      issues.push(err(use.rule === "FORBIDDEN_AS_FACT" ? "UNSUPPORTED_STORY_CLAIM" : "CLASSIFICATION_VIOLATION",
        `claim ${id} used against gate rule ${use.rule}`, section.sectionId));
      continue;
    }
    if (use.verdict === "dispute" && !/disagree|differ|disput|according to|accounts|debate/i.test(text)) {
      issues.push(err("MISSING_ATTRIBUTION", `disputed claim ${id} not framed as disputed`, section.sectionId));
      continue;
    }
    if (use.attribution && !attributionSatisfied(text, use.attribution)) {
      issues.push(err("MISSING_ATTRIBUTION", `claim ${id} missing required attribution (${use.attribution.publisher})`, section.sectionId));
    }
    if (use.qualifier && !qualifierPresent(text, use.qualifier.qualifier)) {
      issues.push(err("CERTAINTY_ESCALATION", `claim ${id} dropped required ${use.qualifier.qualifier} qualifier`, section.sectionId));
    }
    // Fabricated numbers: every number in text must occur in referenced evidence.
    for (const num of extractNumbers(text)) {
      if (!numberInCorpus(num, corpus)) {
        issues.push(err("UNSUPPORTED_STORY_CLAIM", `number ${num} has no evidence path in claim ${id}`, section.sectionId));
      }
    }
    // Hybrid classification: wording must not promote the label.
    const label = (section.classificationRefs || []).find((c) => c.claimId === id);
    if (label && entry.classification && label.classification !== entry.classification) {
      issues.push(err("CLASSIFICATION_VIOLATION", `claim ${id} relabeled ${entry.classification} -> ${label.classification}`, section.sectionId));
    }
    if (!label && entry.classification && contentClass === "HYBRID" && use.verdict !== "allow") {
      issues.push(err("CLASSIFICATION_VIOLATION", `claim ${id} used without its ${entry.classification} classification`, section.sectionId));
    }
  }

  // Quotes: quoted strings must equal a verified quote of a referenced claim.
  const verifiedQuotes = [];
  for (const id of section.claimRefs || []) {
    const entry = byId.get(id);
    if (entry && entry.verifiedQuotes) verifiedQuotes.push(...entry.verifiedQuotes);
  }
  for (const q of extractQuotes(text)) {
    const nq = normalizeQuote(q);
    if (!verifiedQuotes.some((v) => v === q || normalizeQuote(v) === nq)) {
      issues.push(err("FABRICATED_QUOTE", `quoted text has no verified quote evidence: "${q.slice(0, 60)}"`, section.sectionId));
    }
  }
  void factualSection;
  return issues;
}

/**
 * Audit a full draft. Optional semanticCheck(section, context) hook returns
 * extra issues for comparisons beyond deterministic reach.
 */
function auditStoryDraft(draft, context = {}) {
  const allIssues = [];
  for (const section of draft.sections || []) {
    allIssues.push(...auditSection(section, { ...context, contentClass: draft.contentClass }));
    if (typeof context.semanticCheck === "function") {
      try {
        const extra = context.semanticCheck(section, context) || [];
        allIssues.push(...extra);
      } catch (e) {
        allIssues.push(err("STORY_AUDIT_FAILED", `semantic hook failed: ${e.message}`, section.sectionId));
      }
    }
  }
  const blocking = allIssues.filter((i) => ["FABRICATED_QUOTE", "CLASSIFICATION_VIOLATION", "STORY_AUDIT_FAILED"].includes(i.code));
  const state = allIssues.length === 0 ? "PASS" : (blocking.length > 0 ? "BLOCKED" : "NEEDS_REVISION");
  return {
    auditId: `aud-${(draft.draftId || "unknown").replace(/^drf-/, "")}`,
    auditVersion: AUDIT_VERSION,
    draftId: draft.draftId || null,
    state,
    issues: allIssues,
    checkedSections: (draft.sections || []).length,
    checkedAt: new Date().toISOString(),
  };
}

function splitSentences(text) {
  return String(text || "").match(/[^.!?]+[.!?]+["']?|\S[^.!?]*$/g) || [];
}

function sectionCorpus(section, context = {}) {
  const byId = context.claims || claimMap(context.pack);
  const parts = [];
  for (const id of section.claimRefs || []) {
    const entry = byId.get(id);
    if (entry) parts.push(entry.statement, entry.caveat || "", ...((entry.verifiedQuotes || [])));
  }
  return parts.join("\n");
}

function sentenceOffends(sentence, corpus, verifiedQuotes) {
  for (const num of extractNumbers(sentence)) {
    if (!numberInCorpus(num, corpus)) return true;
  }
  for (const q of extractQuotes(sentence)) {
    const nq = normalizeQuote(q);
    if (!verifiedQuotes.some((v) => v === q || normalizeQuote(v) === nq)) return true;
  }
  return false;
}

/** Mechanical revision: drop offending sentences, never invent replacements. */
function reviseSection(section, issues, context = {}) {
  const { policy } = context;
  const byId = context.claims || claimMap(context.pack);
  const corpus = sectionCorpus(section, { ...context, claims: byId });
  const verifiedQuotes = [];
  for (const id of section.claimRefs || []) {
    const entry = byId.get(id);
    if (entry && entry.verifiedQuotes) verifiedQuotes.push(...entry.verifiedQuotes);
  }
  void issues;
  let sentences = splitSentences(section.draftText).filter((s) => !sentenceOffends(s, corpus, verifiedQuotes));
  let text = sentences.join(" ").trim();
  for (const id of section.claimRefs || []) {
    const use = policy ? usageFor(policy, id) : {};
    if (!text) break;
    if (use.attribution && !attributionSatisfied(text, use.attribution)) {
      text = `According to ${use.attribution.publisher}, ${text.charAt(0).toLowerCase() + text.slice(1)}`;
    }
    if (use.qualifier && !qualifierPresent(text, use.qualifier.qualifier)) {
      const word = use.qualifier.qualifier === "uncertain" ? "Current evidence suggests " : "Approximately speaking, ";
      text = `${word}${text.charAt(0).toLowerCase() + text.slice(1)}`;
    }
    if (use.verdict === "dispute" && !/disagree|differ|disput|according to|accounts|debate/i.test(text)) {
      text = `${text} Sources disagree on this point, and the disagreement is preserved.`;
    }
  }
  return { ...section, draftText: text };
}

/** Bounded revision loop: exact failing sections only, unaffected preserved. */
function reviseDraft(draft, audit, context = {}) {
  const { validateDraftStructure } = require("./story-draft.js");
  const maxRevisions = context.maxRevisions || MAX_REVISIONS;
  const BLOCKING_CODES = new Set(["FABRICATED_QUOTE", "CLASSIFICATION_VIOLATION", "STORY_AUDIT_FAILED", "STORY_DRAFT_INVALID"]);
  let current = JSON.parse(JSON.stringify(draft));
  let currentAudit = audit;
  let attempts = 0;
  const dropped = [];
  const failingSections = () => [...new Set(currentAudit.issues.map((i) => i.sectionId).filter(Boolean))];
  const fullAudit = (doc) => {
    const structural = validateDraftStructure(doc);
    if (structural.length > 0) {
      return {
        auditId: `aud-${(doc.draftId || "unknown").replace(/^drf-/, "")}`,
        auditVersion: AUDIT_VERSION, draftId: doc.draftId || null,
        state: "BLOCKED",
        issues: structural.map((m) => err("STORY_DRAFT_INVALID", m, null)),
        checkedSections: (doc.sections || []).length, checkedAt: new Date().toISOString(),
      };
    }
    return auditStoryDraft(doc, { ...context, semanticCheck: undefined });
  };
  while ((currentAudit.state === "NEEDS_REVISION") && attempts < maxRevisions) {
    attempts++;
    const failing = failingSections();
    const kept = [];
    for (const s of current.sections) {
      if (!failing.includes(s.sectionId)) { kept.push(s); continue; } // preserved byte-identical
      const revised = reviseSection(s, currentAudit.issues, context);
      if (revised.draftText.trim()) kept.push(revised);
      else dropped.push(s.sectionId);
    }
    current = { ...current, sections: kept };
    if (current.sections.length === 0) {
      currentAudit = {
        auditId: currentAudit.auditId, auditVersion: AUDIT_VERSION, draftId: current.draftId,
        state: "BLOCKED", issues: [err("STORY_AUDIT_FAILED", "no renderable sections remain after revision", null)],
        checkedSections: 0, checkedAt: new Date().toISOString(),
      };
      break;
    }
    currentAudit = fullAudit(current);
  }
  if (currentAudit.state !== "PASS" && currentAudit.issues.some((i) => BLOCKING_CODES.has(i.code))) {
    currentAudit = { ...currentAudit, state: "BLOCKED" };
  }
  return { draft: current, audit: currentAudit, attempts, droppedSections: dropped, fullyRevised: currentAudit.state === "PASS" };
}

module.exports = {
  AUDIT_VERSION,
  MAX_REVISIONS,
  auditSection,
  auditStoryDraft,
  reviseSection,
  reviseDraft,
  extractNumbers,
  extractQuotes,
};
