"use strict";

/**
 * UNFOLDIQ Source Quality + Independence Gate (1G.1H, Prompt 03).
 *
 * Canonical states: INDEPENDENT | DERIVED | SYNDICATED | COPY_CHAIN | UNKNOWN.
 * Central invariant: 3 URLs != 3 independent sources. Different domains alone
 * never imply independence. Uncertainty => UNKNOWN, never auto-INDEPENDENT.
 *
 * Signals (bounded, deterministic, no embeddings/API):
 *  - exact contentHash match            => COPY_CHAIN / duplicate signal
 *  - shingle Jaccard >= threshold       => DERIVED / SYNDICATED / COPY_CHAIN
 *  - explicit citation / canonical link / "originally published" / same
 *    publisher with near-duplicate      => derivation captured, shared originGroup
 * Verification counts independent origin groups, never raw URLs.
 */

const crypto = require("crypto");

const INDEPENDENCE = ["INDEPENDENT", "DERIVED", "SYNDICATED", "COPY_CHAIN", "UNKNOWN"];

// Documented threshold: 5-word shingles, Jaccard >= 0.75. Rationale: high
// enough to ignore shared boilerplate/quotes, low enough to catch lightly
// rewritten syndication. Signal only, never absolute truth.
const SHINGLE_SIZE = 5;
const NEAR_DUPLICATE_THRESHOLD = 0.75;
const MIN_ANALYSIS_CHARS = 400;
const MAX_ANALYSIS_CHARS = 20000;

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text, size = SHINGLE_SIZE) {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const set = new Set();
  for (let i = 0; i + size <= words.length; i++) {
    set.add(words.slice(i, i + size).join(" "));
  }
  return set;
}

function jaccardSimilarity(a, b) {
  const setA = typeof a === "string" ? shingles(a.slice(0, MAX_ANALYSIS_CHARS)) : a;
  const setB = typeof b === "string" ? shingles(b.slice(0, MAX_ANALYSIS_CHARS)) : b;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const s of setA) {
    if (setB.has(s)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function originGroupFor(seed) {
  return `og-${crypto.createHash("sha256").update(String(seed), "utf8").digest("hex").slice(0, 12)}`;
}

function publisherOf(record) {
  const p = record && record.publisher;
  return typeof p === "string" && p.trim() ? p.trim().toLowerCase() : null;
}

function citesOrigin(text, originCanonical) {
// A bare hyperlink to the origin's host is normal referencing (e.g. a
// References section), not derivation. Derivation needs an explicit
// republication/syndication signal or canonical-URL equality (checked
// separately in judgePair).
  const sample = String(text || "").slice(0, 6000).toLowerCase();
  return /originally published|syndicated from|republished from|copied from|courtesy of|via (the )?original|source:\s*http/i.test(sample);
}

function canonicalInMetadata(record) {
  const md = (record && record.metadata) || {};
  const candidates = [md.canonical, md.canonicalUrl, md.originUrl, md.originalUrl];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return null;
}

/**
 * Pairwise judgement. bodies: { sourceId: rawMarkdown }. Returns
 * { status, originGroup, reason, similarity }.
 */
function judgePair(a, b, bodies = {}) {
  const bodyA = bodies[a.sourceId] || "";
  const bodyB = bodies[b.sourceId] || "";
  if (a.contentHash && a.contentHash === b.contentHash) {
    const group = a.originGroup || b.originGroup || originGroupFor(`hash:${a.contentHash}`);
    return { status: "COPY_CHAIN", originGroup: group, reason: "exact contentHash match across URLs", similarity: 1 };
  }
  const aCanon = canonicalInMetadata(a);
  const bCanon = canonicalInMetadata(b);
  if (aCanon && b.finalUrl && aCanon === b.finalUrl) {
    return { status: "DERIVED", originGroup: b.originGroup || originGroupFor(`origin:${b.canonicalUrl}`), reason: "explicit canonical/origin link to sibling", similarity: null };
  }
  if (bCanon && a.finalUrl && bCanon === a.finalUrl) {
    return { status: "DERIVED", originGroup: a.originGroup || originGroupFor(`origin:${a.canonicalUrl}`), reason: "explicit canonical/origin link to sibling", similarity: null };
  }
  if (citesOrigin(bodyA, b.canonicalUrl) || citesOrigin(bodyB, a.canonicalUrl)) {
    const origin = citesOrigin(bodyA, b.canonicalUrl) ? b : a;
    return { status: "DERIVED", originGroup: origin.originGroup || originGroupFor(`origin:${origin.canonicalUrl}`), reason: "explicit citation/syndication marker", similarity: null };
  }
  if (bodyA.length >= MIN_ANALYSIS_CHARS && bodyB.length >= MIN_ANALYSIS_CHARS) {
    const sim = jaccardSimilarity(bodyA, bodyB);
    if (sim >= NEAR_DUPLICATE_THRESHOLD) {
      const pubA = publisherOf(a);
      const pubB = publisherOf(b);
      const samePublisher = pubA && pubB && pubA === pubB;
      const group = a.originGroup || b.originGroup || originGroupFor(`sim:${[a.canonicalUrl, b.canonicalUrl].sort().join("|")}`);
      return {
        status: samePublisher ? "SYNDICATED" : "COPY_CHAIN",
        originGroup: group,
        reason: `near-duplicate text (Jaccard ${sim.toFixed(2)} >= ${NEAR_DUPLICATE_THRESHOLD})${samePublisher ? ", same publisher" : ""}`,
        similarity: sim,
      };
    }
    return { status: "INDEPENDENT", originGroup: null, reason: `no derivation signal; Jaccard ${sim.toFixed(2)} below threshold`, similarity: sim };
  }
  return { status: "UNKNOWN", originGroup: null, reason: "insufficient comparable content for a confident judgement", similarity: null };
}

/**
 * Registry-wide pass. Mutates independenceStatus/originGroup on records.
 * Conservative: starts UNKNOWN; INDEPENDENT only from pairwise evidence.
 */
function evaluateIndependence(records, bodies = {}) {
  const list = records || [];
  const decisions = [];
  for (const r of list) {
    if (!r.originGroup) {
      r.independenceStatus = "UNKNOWN";
    }
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const verdict = judgePair(a, b, bodies);
      decisions.push({ a: a.sourceId, b: b.sourceId, ...verdict });
      if (verdict.status === "INDEPENDENT" || verdict.status === "UNKNOWN") {
        if (a.independenceStatus === "UNKNOWN" && verdict.status === "INDEPENDENT") a.independenceStatus = "INDEPENDENT";
        if (b.independenceStatus === "UNKNOWN" && verdict.status === "INDEPENDENT") b.independenceStatus = "INDEPENDENT";
        continue;
      }
      const group = verdict.originGroup;
      a.independenceStatus = verdict.status;
      b.independenceStatus = verdict.status;
      a.originGroup = a.originGroup || group;
      b.originGroup = b.originGroup || group;
      // Propagate the shared group to anything already chained to either side.
      for (const r of list) {
        if (r.originGroup === a.originGroup || r.originGroup === b.originGroup) r.originGroup = group;
      }
      a.originGroup = group;
      b.originGroup = group;
    }
  }
  // Lone sources with no derivation evidence but too little content stay UNKNOWN.
  for (const r of list) {
    if (r.independenceStatus === "UNKNOWN" && !r.originGroup) {
      r.originGroup = originGroupFor(`solo:${r.canonicalUrl}`);
    }
  }
  return decisions;
}

/** Count independent origin groups behind a set of sourceIds. UNKNOWN never counts. */
function countIndependentGroups(records, sourceIds) {
  const groups = new Set();
  for (const id of sourceIds || []) {
    const r = (records || []).find((x) => x.sourceId === id);
    if (r && r.independenceStatus === "INDEPENDENT") {
      groups.add(r.originGroup || `solo:${r.sourceId}`);
    }
  }
  return groups.size;
}

module.exports = {
  INDEPENDENCE,
  SHINGLE_SIZE,
  NEAR_DUPLICATE_THRESHOLD,
  MIN_ANALYSIS_CHARS,
  MAX_ANALYSIS_CHARS,
  normalizeText,
  shingles,
  jaccardSimilarity,
  originGroupFor,
  judgePair,
  evaluateIndependence,
  countIndependentGroups,
};
