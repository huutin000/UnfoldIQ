"use strict";

/**
 * UNFOLDIQ Script Evidence Gate runtime (1G.1N, Prompt 04).
 *
 * Decides what factual material may enter storytelling and how: allowed,
 * restricted (attribution/qualification), disputed (frame-only), forbidden.
 * Writes no prose itself. HYBRID labels gate promotion; FICTION plot carries
 * no evidence burden while targeted real-world details keep theirs.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const GATE_VERSION = "1.0.0";

// Semantic certainty constraints (meaning-level, not brittle exact words).
const QUALIFIERS = {
  approximate: ["approximately", "about", "around", "roughly", "nearly", "almost", "estimated", "estimate"],
  reported: ["reported", "reportedly", "according to", "witness", "witnesses", "accounts say", "is said to"],
  uncertain: ["may", "might", "possibly", "perhaps", "could", "likely", "unlikely", "disputed", "unconfirmed", "unclear", "unknown"],
};

function qualifierPresent(text, kind) {
  const low = String(text || "").toLowerCase();
  return (QUALIFIERS[kind] || []).some((w) => low.includes(w));
}

function publisherOf(sourceRefs, sourceId) {
  const r = (sourceRefs || []).find((s) => s.sourceId === sourceId);
  if (!r) return null;
  try {
    const host = new URL(r.url).hostname.replace(/^www\./, "");
    return r.title && r.title.length < 80 ? r.title : host;
  } catch {
    return r.title || r.sourceId;
  }
}

function attributionSatisfied(text, attribution) {
  if (!attribution) return true;
  const low = String(text || "").toLowerCase();
  const names = [attribution.publisher, ...(attribution.markers || ["according to", "reported", "witness"])].filter(Boolean);
  return names.some((n) => n && low.includes(String(n).toLowerCase()));
}

/**
 * Build policy from a Research Pack (+ records for publisher names).
 * HYBRID promotion map enforced: FOLKLORE/TESTIMONY/SPECULATION/FICTIONALIZED_ELEMENT
 * entries land restricted/disputed/forbidden, never allowed-as-fact.
 */
function buildEvidencePolicy(input = {}) {
  const pack = input.pack;
  if (!pack || !pack.packId) {
    return { ok: false, code: "SCRIPT_EVIDENCE_BLOCKED", message: "evidence policy needs a valid Research Pack" };
  }
  const records = input.records || [];
  const sourceRefs = pack.sourceRefs || [];
  const policy = {
    gateId: `gate-${pack.packHash.slice(0, 12)}`,
    gateVersion: GATE_VERSION,
    contentClass: pack.contentClass,
    researchPackRef: { packId: pack.packId, packHash: pack.packHash },
    generatedAt: new Date().toISOString(),
    allowedClaims: [],
    restrictedClaims: [],
    disputedClaims: [],
    forbiddenAsFact: [],
    requiredAttributions: [],
    requiredQualifiers: [],
    fictionalizationBoundaries: input.fictionalizationBoundaries || [],
    unknownsToPreserve: (pack.unknowns || []).map((u) => u.unknownId || u.description),
  };

  const pushAttribution = (claimId, sourceIds) => {
    const pubs = [...new Set(sourceIds.map((s) => publisherOf(sourceRefs, s)).filter(Boolean))];
    if (pubs.length > 0) {
      policy.requiredAttributions.push({ claimId, publisher: pubs[0], markers: ["according to", "reported"] });
    }
  };

  const consider = (entry, opts = {}) => {
    const label = entry.classification || null;
    // HYBRID promotion guard — no evidence/state transition may promote these.
    if (label === "FOLKLORE") {
      policy.restrictedClaims.push({ claimId: entry.claimId, rule: "FOLKLORE_AS_FOLKLORE", note: "present as folklore/tradition, never as fact" });
      return;
    }
    if (label === "TESTIMONY") {
      policy.restrictedClaims.push({ claimId: entry.claimId, rule: "TESTIMONY_ATTRIBUTED", note: "attribute to the witness; never flatten to verified fact" });
      pushAttribution(entry.claimId, entry.sourceIds);
      return;
    }
    if (label === "SPECULATION") {
      policy.restrictedClaims.push({ claimId: entry.claimId, rule: "SPECULATION_QUALIFIED", note: "qualify as speculation; certainty escalation forbidden" });
      policy.requiredQualifiers.push({ claimId: entry.claimId, qualifier: "uncertain", level: "must" });
      return;
    }
    if (label === "FICTIONALIZED_ELEMENT") {
      policy.forbiddenAsFact.push({ claimId: entry.claimId, rule: "FICTION_IS_NOT_DOCUMENTED", note: "fictionalized element must never masquerade as documented event" });
      return;
    }
    if (opts.disputed) {
      policy.disputedClaims.push({ claimId: entry.claimId, rule: "FRAME_OR_OMIT", note: entry.disputeNote || "frame as disputed or omit" });
      return;
    }
    if (opts.unverified) {
      policy.forbiddenAsFact.push({ claimId: entry.claimId, rule: "NO_EVIDENCE_NO_NARRATION", note: "must not appear as factual narration" });
      return;
    }
    if (opts.singleHigh) {
      policy.restrictedClaims.push({ claimId: entry.claimId, rule: "SINGLE_SOURCE_ATTRIBUTED", note: "single-source high-impact claim needs attribution/qualification or exclusion from central claims" });
      pushAttribution(entry.claimId, entry.sourceIds);
      return;
    }
    policy.allowedClaims.push({ claimId: entry.claimId, rule: "SUPPORTED_FACT_USE" });
  };

  for (const e of pack.verifiedFacts || []) consider(e);
  for (const e of pack.independentlyCorroboratedFacts || []) {
    if (!policy.allowedClaims.some((a) => a.claimId === e.claimId)) consider(e);
  }
  for (const e of pack.primarySourceFacts || []) {
    if (!policy.allowedClaims.some((a) => a.claimId === e.claimId)) consider(e);
  }
  for (const e of pack.derivedContext || []) {
    const high = /high|critical/i.test(claimMateriality(pack, e.claimId));
    if (e.corroborationStatus === "SINGLE_SOURCE" && high) consider(e, { singleHigh: true });
    else if (!policy.allowedClaims.some((a) => a.claimId === e.claimId)) consider(e);
  }
  for (const e of pack.conflictingClaims || []) consider(e, { disputed: true });
  for (const e of pack.unverifiedClaims || []) consider(e, { unverified: true });

  // Fiction targeted-fact support: claims listed here keep evidence rules.
  policy.targetedFactClaims = (input.targetedFactClaimIds || []).filter((id) =>
    policy.allowedClaims.some((a) => a.claimId === id) || policy.restrictedClaims.some((a) => a.claimId === id)
  );
  return { ok: true, policy };
}

function claimMateriality(pack, claimId) {
  const all = [...(pack.verifiedFacts || []), ...(pack.derivedContext || []),
    ...(pack.primarySourceFacts || []), ...(pack.independentlyCorroboratedFacts || [])];
  const e = all.find((x) => x.claimId === claimId);
  return (e && e.materiality) || "low";
}

/** Classify one claim usage for storytelling: allow / restrict / dispute / forbid. */
function usageFor(policy, claimId) {
  if (!policy) return { verdict: "forbid", rule: "NO_POLICY" };
  if ((policy.forbiddenAsFact || []).some((c) => c.claimId === claimId)) return { verdict: "forbid", rule: "FORBIDDEN_AS_FACT" };
  if ((policy.disputedClaims || []).some((c) => c.claimId === claimId)) return { verdict: "dispute", rule: "FRAME_OR_OMIT" };
  const restricted = (policy.restrictedClaims || []).find((c) => c.claimId === claimId);
  if (restricted) {
    return {
      verdict: "restrict",
      rule: restricted.rule,
      attribution: (policy.requiredAttributions || []).find((a) => a.claimId === claimId) || null,
      qualifier: (policy.requiredQualifiers || []).find((q) => q.claimId === claimId) || null,
    };
  }
  if ((policy.allowedClaims || []).some((c) => c.claimId === claimId)) return { verdict: "allow", rule: "SUPPORTED_FACT_USE" };
  return { verdict: "forbid", rule: "UNKNOWN_CLAIM" };
}

module.exports = {
  GATE_VERSION,
  QUALIFIERS,
  qualifierPresent,
  attributionSatisfied,
  publisherOf,
  buildEvidencePolicy,
  usageFor,
};
