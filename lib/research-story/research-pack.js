"use strict";

/**
 * UNFOLDIQ Research Pack runtime (1G.1M, Prompt 04).
 *
 * The Pack organizes SUFFICIENT evidence for editorial use. It is NOT a script:
 * no dramatic narration, no invented hooks/quotes, no hidden contradictions,
 * no speculation-to-certainty, no dramatic sequencing. Deterministic build
 * from plan + brief + registry + ledger + contradictions + unknowns +
 * sufficiency — no LLM needed to copy structured fields.
 *
 * Readiness: FACTUAL/HYBRID packs become SCRIPT_READY only when sufficiency
 * is SUFFICIENT. FICTION takes no pack (separate route).
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");
const { hasPrimarySupport } = require("../research-evidence/verification.js");

const PACK_VERSION = "1.0.0";

const FACTUAL_VERIFIED_CLASSES = new Set(["DIRECT_EVIDENCE", "SUPPORTED_FACT"]);

function packHashOf(fingerprint) {
  return crypto.createHash("sha256").update(stableStringify(fingerprint), "utf8").digest("hex").slice(0, 16);
}

function packNeeded(contentClass, researchRequired) {
  if (contentClass === "FICTION") return { needed: false, reason: "fiction takes no Research Pack" };
  if (contentClass !== "FACTUAL" && contentClass !== "HYBRID") {
    return { needed: false, reason: `unknown contentClass ${contentClass}` };
  }
  if (researchRequired === "NOT_REQUIRED") return { needed: false, reason: "research not required" };
  return { needed: true };
}

function checkReadiness(input = {}) {
  const decision = input.sufficiency && input.sufficiency.decision;
  if (decision === "SUFFICIENT") return { ok: true, status: "SCRIPT_READY" };
  if (decision === "BLOCKED") {
    return { ok: false, code: "RESEARCH_BLOCKED", message: `pack blocked: ${input.sufficiency.blocker || "sufficiency BLOCKED"}` };
  }
  return { ok: false, code: "RESEARCH_NOT_SUFFICIENT", message: `pack not script-ready: sufficiency is ${decision || "unknown"}` };
}

function openContradictionClaimIds(store) {
  const ids = new Set();
  for (const c of (store && store.contradictions) || []) {
    if (c.status === "OPEN" || c.status === "BLOCKING" || c.status === "FRAMED_AS_DISPUTED") {
      for (const id of c.claimIds || []) ids.add(id);
    }
  }
  return ids;
}

function entryFor(claim, records, opts = {}) {
  const support = claim.supportingEvidence || [];
  const sourceIds = [...new Set(support.map((e) => e.sourceId))];
  const hashes = [...new Set(support.map((e) => e.contentHash))];
  const entry = {
    claimId: claim.claimId,
    statement: claim.claim,
    sourceIds,
    contentHashes: hashes,
    evidenceStatus: claim.evidenceStatus,
    corroborationStatus: claim.corroborationStatus,
    claimClass: claim.claimClass,
    materiality: claim.materiality || "low",
  };
  if (claim.confidenceReason) entry.caveat = claim.confidenceReason.slice(0, 300);
  if (opts.hybridLabels && opts.hybridLabels[claim.claimId]) {
    entry.classification = opts.hybridLabels[claim.claimId];
  }
  const quotes = (opts.verifiedQuotes || {})[claim.claimId];
  if (quotes && quotes.length > 0) entry.verifiedQuotes = quotes;
  return entry;
}

/**
 * Build a pack. Input: { projectId, plan, brief?, ledger, records,
 * contradictionsStore, unknownsStore, sufficiency, evidencePolicyVersion,
 * hybridLabels? {claimId: label}, verifiedQuotes? {claimId: [quote]},
 * claimFacets? {claimId: {dates[], people[], places[]}} }.
 * Facets/quotes/labels are analyst-asserted and validated here — never inferred.
 */
function buildPack(input = {}) {
  const plan = input.plan || {};
  const ledger = input.ledger || { claims: [] };
  const records = input.records || [];
  const need = packNeeded(plan.contentClass, plan.researchRequired);
  if (!need.needed) {
    return { ok: false, code: "NO_PACK_FOR_FICTION", message: need.reason };
  }
  const ready = checkReadiness(input);
  if (!ready.ok) return ready;

  // Validate analyst assertions before use.
  const claimIds = new Set((ledger.claims || []).map((c) => c.claimId));
  const hybridLabels = input.hybridLabels || {};
  for (const [id, label] of Object.entries(hybridLabels)) {
    if (!claimIds.has(id)) return { ok: false, code: "RESEARCH_PACK_INVALID", message: `hybrid label for unknown claim ${id}` };
    if (!["FACT", "FOLKLORE", "TESTIMONY", "SPECULATION", "FICTIONALIZED_ELEMENT"].includes(label)) {
      return { ok: false, code: "RESEARCH_PACK_INVALID", message: `bad hybrid label ${label}` };
    }
  }
  const verifiedQuotes = {};
  for (const [id, quotes] of Object.entries(input.verifiedQuotes || {})) {
    if (!claimIds.has(id)) return { ok: false, code: "RESEARCH_PACK_INVALID", message: `quotes for unknown claim ${id}` };
    const claim = ledger.claims.find((c) => c.claimId === id);
    const corpus = (claim.supportingEvidence || []).map((e) => e.excerpt || "").join("\n");
    for (const q of quotes) {
      if (typeof q !== "string" || !q || q.length > 280) {
        return { ok: false, code: "RESEARCH_PACK_INVALID", message: `bad quote for ${id}` };
      }
      if (!corpus.includes(q)) {
        return { ok: false, code: "RESEARCH_PACK_INVALID", message: `quote not found in evidence excerpts for ${id}` };
      }
    }
    verifiedQuotes[id] = quotes;
  }
  const facets = {};
  for (const [id, f] of Object.entries(input.claimFacets || {})) {
    if (!claimIds.has(id)) return { ok: false, code: "RESEARCH_PACK_INVALID", message: `facets for unknown claim ${id}` };
    for (const key of ["dates", "people", "places"]) {
      const list = (f && f[key]) || [];
      if (!Array.isArray(list)) return { ok: false, code: "RESEARCH_PACK_INVALID", message: `bad facet ${key} for ${id}` };
      for (const v of list) {
        if (typeof v !== "string" || !v.trim() || v.length > 120) {
          return { ok: false, code: "RESEARCH_PACK_INVALID", message: `bad facet value for ${id}` };
        }
      }
    }
    facets[id] = { dates: (f.dates || []), people: (f.people || []), places: (f.places || []) };
  }

  const disputed = openContradictionClaimIds(input.contradictionsStore);
  const pack = {
    packId: null,
    packVersion: PACK_VERSION,
    projectId: input.projectId || plan.projectId || null,
    contentClass: plan.contentClass,
    contentMode: plan.contentMode || null,
    creativeBriefRef: plan.creativeBriefRef || null,
    researchPlanRef: { topic: plan.topic || null },
    evidencePolicyVersion: input.evidencePolicyVersion || "evidence-policy-1.0.0",
    sufficiencyRef: { decision: input.sufficiency.decision },
    generatedAt: new Date().toISOString(),
    researchObjective: plan.researchGoal || "",
    viewerContext: {
      audience: plan.audience || (input.brief && input.brief.audience) || null,
      platform: plan.platform || null,
      targetDuration: (input.brief && input.brief.targetDuration) || null,
      viewerPromise: (input.brief && input.brief.viewerPromise) || null,
    },
    verifiedFacts: [],
    primarySourceFacts: [],
    independentlyCorroboratedFacts: [],
    derivedContext: [],
    conflictingClaims: [],
    unverifiedClaims: [],
    timeline: [],
    people: [],
    places: [],
    usefulContext: [],
    unknowns: ((input.unknownsStore && input.unknownsStore.unknowns) || [])
      .filter((u) => u.status === "OPEN")
      .map((u) => ({ unknownId: u.unknownId, description: u.description, materiality: u.materiality })),
    sourceLimitations: [],
    sourceRefs: [],
  };

  for (const claim of ledger.claims || []) {
    const entry = entryFor(claim, records, { hybridLabels, verifiedQuotes });
    const isDisputed = disputed.has(claim.claimId) || claim.corroborationStatus === "CONFLICTED";
    if (isDisputed) {
      entry.disputeNote = "unresolved dispute: frame as disputed or omit, never state as settled fact";
      pack.conflictingClaims.push(entry);
      continue;
    }
    if (claim.evidenceStatus === "UNSUPPORTED" || claim.claimClass === "UNVERIFIED") {
      pack.unverifiedClaims.push(entry);
      continue;
    }
    const verified = claim.evidenceStatus === "SUPPORTED" &&
      (claim.corroborationStatus === "PRIMARY_CONFIRMED" || claim.corroborationStatus === "MULTI_SOURCE_CONFIRMED") &&
      FACTUAL_VERIFIED_CLASSES.has(claim.claimClass);
    if (verified) pack.verifiedFacts.push(entry);
    if (hasPrimarySupport(claim, records)) {
      pack.primarySourceFacts.push({ ...entry });
    }
    if (claim.corroborationStatus === "MULTI_SOURCE_CONFIRMED") {
      pack.independentlyCorroboratedFacts.push({ ...entry });
    }
    if (!verified) {
      pack.derivedContext.push(entry);
    }
    if (claim.materiality === "low" || claim.materiality === "medium") {
      pack.usefulContext.push(entry.claimId);
    }
    const f = facets[claim.claimId];
    if (f) {
      for (const d of f.dates) pack.timeline.push({ claimId: claim.claimId, date: d });
      for (const p of f.people) pack.people.push({ claimId: claim.claimId, person: p });
      for (const p of f.places) pack.places.push({ claimId: claim.claimId, place: p });
    }
  }
  if (pack.timeline.length === 0) pack.timelineStatus = "not established";
  if (pack.people.length === 0) pack.peopleStatus = "not established";
  if (pack.places.length === 0) pack.placesStatus = "not established";

  const warnings = new Set();
  for (const r of records) {
    for (const w of r.acquisitionWarnings || []) warnings.add(`${r.sourceId}: ${w}`);
    if (r.sourceType === "UNKNOWN") warnings.add(`${r.sourceId}: authority UNKNOWN — treat with care`);
  }
  pack.sourceLimitations = [...warnings];
  pack.sourceRefs = records.map((r) => ({
    sourceId: r.sourceId,
    url: r.finalUrl || r.canonicalUrl,
    title: r.title || null,
    sourceType: r.sourceType,
    independenceStatus: r.independenceStatus,
    contentHash: r.currentVersionHash || r.contentHash,
  }));

  const fingerprint = {
    topic: plan.topic || null,
    claims: (ledger.claims || []).map((c) => [c.claimId, c.corroborationStatus, c.evidenceStatus, c.needsReevaluation ? 1 : 0]),
    contradictions: ((input.contradictionsStore && input.contradictionsStore.contradictions) || []).map((c) => [c.contradictionId, c.status]),
    unknowns: ((input.unknownsStore && input.unknownsStore.unknowns) || []).map((u) => [u.unknownId, u.status]),
    decision: input.sufficiency.decision,
    policyVersion: pack.evidencePolicyVersion,
    briefHash: (plan.creativeBriefRef && plan.creativeBriefRef.briefHash) || null,
    packVersion: PACK_VERSION,
    facets: Object.keys(facets).sort(),
    quotes: Object.keys(verifiedQuotes).sort(),
    labels: Object.keys(hybridLabels).sort(),
  };
  pack.packHash = packHashOf(fingerprint);
  pack.packId = `pack-${pack.packHash.slice(0, 12)}`;
  return { ok: true, pack, status: "SCRIPT_READY" };
}

/** Stale detection: recompute fingerprint against current evidence state. */
function packInputFingerprint(input) {
  const ledger = input.ledger || { claims: [] };
  return {
    topic: (input.plan && input.plan.topic) || null,
    claims: (ledger.claims || []).map((c) => [c.claimId, c.corroborationStatus, c.evidenceStatus, c.needsReevaluation ? 1 : 0]),
    contradictions: ((input.contradictionsStore && input.contradictionsStore.contradictions) || []).map((c) => [c.contradictionId, c.status]),
    unknowns: ((input.unknownsStore && input.unknownsStore.unknowns) || []).map((u) => [u.unknownId, u.status]),
    decision: input.sufficiency && input.sufficiency.decision,
    policyVersion: input.evidencePolicyVersion || "evidence-policy-1.0.0",
    briefHash: (input.plan && input.plan.creativeBriefRef && input.plan.creativeBriefRef.briefHash) || null,
    packVersion: PACK_VERSION,
    facets: Object.keys(input.claimFacets || {}).sort(),
    quotes: Object.keys(input.verifiedQuotes || {}).sort(),
    labels: Object.keys(input.hybridLabels || {}).sort(),
  };
}

function isPackCurrent(pack, input) {
  if (!pack || !pack.packHash) return { current: false, reason: "no pack hash" };
  const now = packHashOf(packInputFingerprint(input));
  if (now !== pack.packHash) return { current: false, reason: "evidence inputs changed since pack generation" };
  if (input.sufficiency && input.sufficiency.decision !== "SUFFICIENT") {
    return { current: false, reason: `sufficiency is ${input.sufficiency.decision}, pack no longer SCRIPT_READY` };
  }
  return { current: true };
}

function renderPackMarkdown(pack) {
  const lines = [];
  const ref = (e) => `[claim:${e.claimId}]${e.sourceIds.map((s) => ` [source:${s}]`).join("")}`;
  const item = (e) => `- ${e.statement} ${ref(e)}${e.caveat ? ` (caveat: ${e.caveat})` : ""}${e.classification ? ` {${e.classification}}` : ""}`;
  lines.push("# Research Pack", "", `packId: ${pack.packId}`, `contentClass: ${pack.contentClass}`, "");
  lines.push("## Research objective", pack.researchObjective || "(none)", "");
  lines.push("## Audience / platform context",
    `audience: ${pack.viewerContext.audience || "?"} | platform: ${pack.viewerContext.platform || "?"} | promise: ${pack.viewerContext.viewerPromise || "?"}`,
    "");
  const section = (title, entries) => {
    lines.push(`## ${title}`);
    if (entries.length === 0) lines.push("(none)");
    else for (const e of entries) lines.push(item(e));
    lines.push("");
  };
  section("Verified facts", pack.verifiedFacts);
  section("Primary-source facts", pack.primarySourceFacts);
  section("Independently corroborated facts", pack.independentlyCorroboratedFacts);
  section("Derived / secondary context", pack.derivedContext);
  section("Conflicting claims", pack.conflictingClaims);
  section("Unverified claims", pack.unverifiedClaims);
  lines.push("## Timeline");
  if (pack.timeline.length === 0) lines.push(pack.timelineStatus || "not established");
  else for (const t of pack.timeline) lines.push(`- ${t.date} [claim:${t.claimId}]`);
  lines.push("", "## People");
  if (pack.people.length === 0) lines.push(pack.peopleStatus || "not established");
  else for (const p of pack.people) lines.push(`- ${p.person} [claim:${p.claimId}]`);
  lines.push("", "## Places");
  if (pack.places.length === 0) lines.push(pack.placesStatus || "not established");
  else for (const p of pack.places) lines.push(`- ${p.place} [claim:${p.claimId}]`);
  lines.push("", "## Useful context", ...(pack.usefulContext.length > 0 ? pack.usefulContext.map((c) => `- [claim:${c}]`) : ["(none)"]), "");
  lines.push("## Unknowns");
  if (pack.unknowns.length === 0) lines.push("(none)");
  else for (const u of pack.unknowns) lines.push(`- ${u.description} (${u.materiality})`);
  lines.push("", "## Source limitations");
  if (pack.sourceLimitations.length === 0) lines.push("(none)");
  else for (const s of pack.sourceLimitations) lines.push(`- ${s}`);
  lines.push("", "## Sources");
  for (const s of pack.sourceRefs) lines.push(`- ${s.title || s.url} [source:${s.sourceId}] (${s.sourceType}/${s.independenceStatus})`);
  lines.push("");
  return lines.join("\n");
}

module.exports = {
  PACK_VERSION,
  packNeeded,
  checkReadiness,
  buildPack,
  packInputFingerprint,
  isPackCurrent,
  renderPackMarkdown,
};
