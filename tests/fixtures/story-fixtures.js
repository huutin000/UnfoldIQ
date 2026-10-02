"use strict";

/**
 * Shared deterministic story-handoff fixtures (Prompt 04).
 * FACTUAL: HTTP-308-like ledger (2 independent sources).
 * HYBRID: 1 documented fact + 1 folklore + 1 testimony + 1 speculation + 1 fictionalized beat.
 * FICTION: horror premise + 1 targeted architectural fact.
 * No network. No invented evidence beyond what the ledger holds.
 */

const reg = require("./evidence-fixtures.js");
const registry = require("../../lib/research-evidence/source-registry.js");
const ind = require("../../lib/research-evidence/independence.js");
const ledgerLib = require("../../lib/research-evidence/claim-ledger.js");
const ver = require("../../lib/research-evidence/verification.js");

const PLAN_FACTUAL = {
  projectId: "story-fact", topic: "HTTP 308 semantics",
  researchGoal: "Establish documented 308 semantics.",
  contentClass: "FACTUAL", contentMode: "technical-explainer",
  audience: "developers", platform: "youtube",
  criticalQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
  sourcePriority: ["OFFICIAL", "reputable secondary"],
  researchBudget: "maxQueries:12; maxSources:20",
  freshnessRequirement: "EVERGREEN_OK",
  researchRequired: "REQUIRED",
};

function factualState() {
  const index = registry.emptyIndex("story-fact");
  const a = registry.registerSource(index, { acquiredDocument: reg.makeDoc("https://a.example/preserve", reg.BODY_PRESERVE, { metadata: { publisher: "Ref Alpha" } }) }).record;
  const d = registry.registerSource(index, { acquiredDocument: reg.makeDoc("https://d.example/other", reg.BODY_D, { metadata: { publisher: "Net Journal" } }) }).record;
  ind.evaluateIndependence([a, d], { [a.sourceId]: reg.BODY_PRESERVE, [d.sourceId]: reg.BODY_D });
  const led = ledgerLib.emptyLedger();
  ledgerLib.upsertClaim(led, {
    claim: "HTTP 308 requires clients to preserve method and body.", claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED", materiality: "critical", researchQuestionIds: ["q0"],
    evidence: [
      { sourceId: a.sourceId, contentHash: a.contentHash, locator: "para 1", excerpt: "requires clients to preserve the original request method" },
      { sourceId: d.sourceId, contentHash: d.contentHash, excerpt: "method stays PUT or POST exactly as sent" },
    ],
  }, index);
  ledgerLib.upsertClaim(led, {
    claim: "RFC 7538 standardizes HTTP 308.", claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED", materiality: "low", researchQuestionIds: ["q1"],
    evidence: [{ sourceId: a.sourceId, contentHash: a.contentHash, locator: "header", excerpt: "standardized technical reference" }],
  }, index);
  ver.verifyLedger(led, index.sources);
  return { index, ledger: led, plan: PLAN_FACTUAL, sufficiency: { decision: "SUFFICIENT", rationale: "fixture", policyVersion: "evidence-policy-1.0.0" } };
}

const HYBRID_LABELS_WANTED = ["FACT", "FOLKLORE", "TESTIMONY", "SPECULATION", "FICTIONALIZED_ELEMENT"];

function hybridState() {
  const index = registry.emptyIndex("story-hybrid");
  const mk = (slug, body, publisher) => registry.registerSource(index, {
    acquiredDocument: reg.makeDoc(`https://h.example/${slug}`, body, { metadata: { publisher } }),
  }).record;
  const bodies = {
    fact: `${reg.BODY_A} The villa was built in 1922 according to municipal records.`,
    folk: "Local legend says the villa owner buried gold beneath the courtyard before vanishing in 1945, a tale retold every festival season.",
    test: "Witness Lan states she heard piano music from the empty villa on three separate nights in 2019.",
    spec: "Some speculate the music came from wind through broken shutters, though no measurement was ever taken.",
    beat: "Narrator beat: the camera pushes toward the darkened doorway as the music swells.",
  };
  const recs = {
    fact: mk("record", bodies.fact, "Municipal Archive"),
    folk: mk("legend", bodies.folk, "Festival Oral History"),
    test: mk("witness", bodies.test, "Field Notes"),
    spec: mk("theory", bodies.spec, "Field Notes"),
    beat: mk("beat", bodies.beat, "Story Team"),
  };
  const list = Object.values(recs);
  ind.evaluateIndependence(list, Object.fromEntries(list.map((r, i) => [r.sourceId, Object.values(bodies)[i]])));
  const led = ledgerLib.emptyLedger();
  const add = (key, claim, claimClass, evidenceStatus, materiality) => ledgerLib.upsertClaim(led, {
    claim, claimClass, evidenceStatus, materiality, researchQuestionIds: ["q0"],
    evidence: [{ sourceId: recs[key].sourceId, contentHash: recs[key].contentHash, locator: "body", excerpt: bodies[key].slice(0, 120) }],
  }, index);
  add("fact", "The villa was built in 1922 per municipal records.", "SUPPORTED_FACT", "SUPPORTED", "high");
  add("folk", "Legend says gold is buried beneath the courtyard.", "CONTESTED", "WEAK", "medium");
  add("test", "Witness Lan heard piano music on three nights in 2019.", "SCHOLARLY_INTERPRETATION", "MIXED", "medium");
  add("spec", "Wind through shutters may explain the music.", "HYPOTHESIS", "WEAK", "low");
  add("beat", "Camera pushes toward the doorway as music swells.", "UNVERIFIED", "UNSUPPORTED", "low");
  ver.verifyLedger(led, index.sources);
  const labels = {};
  const order = ["fact", "folk", "test", "spec", "beat"];
  led.claims.forEach((c, i) => { labels[c.claimId] = HYBRID_LABELS_WANTED[order.indexOf(Object.keys(recs).find((k) => recs[k].sourceId === c.supportingEvidence[0].sourceId))]; });
  const plan = {
    projectId: "story-hybrid", topic: "The Da Lat villa legend",
    researchGoal: "Separate documented facts from folklore and testimony.",
    contentClass: "HYBRID", contentMode: "urban-legend-documentary",
    audience: "general", platform: "youtube",
    criticalQuestions: ["What is documented about the villa?"],
    researchBudget: "maxQueries:14; maxSources:24",
    freshnessRequirement: "EVERGREEN_OK", researchRequired: "REQUIRED",
  };
  return {
    index, ledger: led, plan,
    sufficiency: { decision: "SUFFICIENT", rationale: "fixture", policyVersion: "evidence-policy-1.0.0" },
    hybridLabels: labels,
    boundary: { mayFictionalize: ["transitions", "doorway beat"], mustRemainFactual: ["build year"], mustAttribute: ["witness testimony"] },
  };
}

function fictionState() {
  return {
    contentClass: "FICTION",
    contentMode: "horror-fiction",
    storyContext: { premise: "a night guard in a 1980s provincial hospital", beats: ["arrival", "first sound", "discovery"] },
    targetedFactClaimIds: [],
    brief: { audience: "general", platform: "youtube", viewerPromise: "a chilling original tale", targetDuration: "60-90s" },
  };
}

module.exports = { PLAN_FACTUAL, factualState, hybridState, fictionState, HYBRID_LABELS_WANTED };
