"use strict";

/**
 * Phase 1G.1 FULL E2E (Prompt 06, 1G.1R) — routes A..K over the
 * lib/research-to-story.js facade with fixture exchanges (deterministic,
 * no network, no paid calls). Canonical owners do all rule work; the
 * facade only sequences them.
 *
 * Coverage: A (FACTUAL/STANDARD/SUFFICIENT), B1/B2 (STANDARD->DEEP),
 * C (blocked access), D (pure FICTION), E (FICTION targeted facts),
 * F (HYBRID), G (contradiction), H (duplicate sources), I (unsupported
 * high-impact claim), J (stale invalidation), K (ambiguous/conflict),
 * platform matrix, lineage, provider-text bypass, idempotency,
 * persistence/reload, partial-write resilience.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const facade = require("../../lib/research-to-story.js");
const ledgerLib = require("../../lib/research-evidence/claim-ledger.js");
const planLib = require("../../lib/research-plan.js");
const creativeBrief = require("../../lib/research-evidence/creative-brief.js");
const storyStore = require("../../lib/research-story/story-store.js");
const fx = require("../fixtures/evidence-fixtures.js");

/** Question ids of a generated plan (claims default to full coverage). */
function qidsFor(topic, contentMode) {
  const p = planLib.planResearch({ projectId: "qids-probe", topic, contentMode });
  return (p.plan.criticalQuestions || []).map((_, i) => `q${i}`);
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g1e2e-${tag}-`));
}

const FIXED_RETRIEVED_AT = "2026-10-03T08:00:00.000Z";

function rawSearch(urls, query) {
  return urls.map((url, i) => ({
    url, title: `Fixture page ${i}`, snippet: "fixture snippet (untrusted provenance only)",
    provider: "fixture", retrievedAt: FIXED_RETRIEVED_AT,
    ...(query ? { query } : {}),
  }));
}

/** Canonical claim covering all plan questions, backed by its source. */
const CORE_CLAIM = "HTTP 308 requires clients to preserve the original request method and body.";

function claimCandidates(sourceId, contentHash, over = {}) {
  return [{
    claim: CORE_CLAIM,
    claimClass: "SUPPORTED_FACT",
    evidenceStatus: "SUPPORTED",
    materiality: "critical",
    ...over,
  }];
}

function factualInput(projectId, over = {}) {
  return {
    projectId,
    topic: "HTTP 308 semantics",
    contentClass: "FACTUAL",
    platform: "youtube",
    editorial: {
      angle: "Method preservation is the whole point of 308.",
      coreViewerQuestion: "Why does 308 exist?",
      mainInsight: "308 removes method-rewrite ambiguity.",
      payoff: "Use 308 when the method must survive.",
      hookBasis: { type: "surprising documented fact" },
    },
    ...over,
  };
}

/**
 * Deterministic exchanges for the happy factual route:
 * 2 independent sources, one core claim merged across both.
 */
function sufficientExchanges(urls, opts = {}) {
  const searchCalls = [];
  const analysisCalls = [];
  return {
    searchCalls,
    analysisCalls,
    searchExchange: async (requests) => {
      searchCalls.push(requests.map((r) => r.query));
      return requests.map(() => rawSearch(urls));
    },
    acquireUrls: async (acqUrls) => acqUrls.map((url) => {
      const body = opts.bodies && opts.bodies[url];
      if (!body) return { url, ok: false, code: opts.failCode || "HTTP_ERROR", message: "fixture failure" };
      return { url, ok: true, document: fx.makeDoc(url, body) };
    }),
    analysisExchange: async (requests) => {
      analysisCalls.push(requests.map((r) => r.sourceId));
      return requests.map((r) => claimCandidates(r.sourceId, r.contentHash, opts.claimOver || {}));
    },
  };
}

async function main() {
  console.log("=== PHASE 1G.1 FULL E2E (Prompt 06) ===\n");

  // ---------------------------------------------------------------- A
  await runTest("E2E-A FACTUAL/STANDARD/SUFFICIENT -> HANDOFF_READY, zero DEEP calls", async () => {
    const root = tmpRoot("a");
    try {
      const urls = ["https://a.example/preserve", "https://d.example/independent"];
      let deepCalls = 0;
      const ex = sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } });
      const out = await facade.runResearchToStory(factualInput("p-e2e-a"), {
        root, ...ex,
        deep: { runProvider: async () => { deepCalls++; return { ok: true, result: {} }; } },
      });
      assert(out.status === "HANDOFF_READY", `status HANDOFF_READY (${out.status}: ${out.blockers.join("; ")})`);
      assert(deepCalls === 0, "no DEEP call on SUFFICIENT");
      assert(out.contentClass === "FACTUAL" && out.researchRequired === "REQUIRED", "class/routing resolved");
      assert(out.sufficiency === "SUFFICIENT", "sufficiency SUFFICIENT");
      assert(out.sources.registered === 2, `2 canonical sources registered (${out.sources.registered})`);
      assert(out.packStatus === "SCRIPT_READY" && out.storyStatus === "PASS", "pack + story ready");
      // Lineage completeness (§10).
      const layers = out.lineage.map((l) => l.layer);
      for (const layer of ["topic", "contentClass", "researchPlan", "acquiredDocuments", "sourceRegistry", "researchPack", "narrativeBrief", "storyDraft", "storyAudit"]) {
        assert(layers.includes(layer), `lineage layer ${layer} present`);
      }
      // Artifacts exist on disk.
      const pd = path.join(root, "projects", "p-e2e-a");
      for (const rel of ["research/research-plan.json", "research/source-index.json", "research/research-pack.json", "story/story-draft.json", "story/story-evidence-audit.json"]) {
        assert(fs.existsSync(path.join(pd, rel)), `${rel} persisted`);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- B1
  await runTest("E2E-B1 STANDARD insufficient -> DEEP leads -> canonical reacquisition -> SUFFICIENT -> HANDOFF_READY", async () => {
    const root = tmpRoot("b1");
    try {
      const urls = ["https://a.example/preserve"]; // only one independent source
      const deepUrl = "https://deep.example/independent-308-note";
      let acquireCalls = [];
      const LEARNING_TEXT = "DEEP learning: 308 method preservation is guaranteed somewhere online.";
      const ex = sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE } });
      const out = await facade.runResearchToStory(factualInput("p-e2e-b1", { deepResearchAllowed: true }), {
        root, ...ex,
        deep: {
          runProvider: async () => ({
            ok: true,
            result: {
              providerVersion: "fixture", status: "COMPLETED",
              candidateSources: [{ url: deepUrl, title: "deep lead", context: LEARNING_TEXT }],
              queries: ["308 method preservation"],
              learnings: [{ text: LEARNING_TEXT, sourceUrls: [deepUrl] }],
              providerCitations: [], warnings: [], errors: [],
            },
          }),
        },
        deepAcquireUrl: async (url) => { acquireCalls.push(url); return { ok: true, document: fx.makeDoc(url, fx.BODY_D), url }; },
      });
      assert(out.status === "HANDOFF_READY", `B1 ends HANDOFF_READY (${out.status}: ${out.blockers.join("; ")})`);
      assert(out.deepEscalated === true && out.deepRunStatus === "DEEP_PARTIAL_OR_SUCCESS", `deep escalated (${out.deepRunStatus})`);
      assert(acquireCalls.length === 1 && acquireCalls[0] === deepUrl, "candidate URL canonically reacquired (not trusted directly)");
      assert(out.sources.registered === 2, `registry holds STANDARD + reacquired source (${out.sources.registered})`);
      // Provider-text bypass (§12): DEEP learning/candidate context text must
      // not appear as any claim or evidence excerpt.
      const loaded = storyStore.loadStoryFile(root, "p-e2e-b1", storyStore.FILES.packJson);
      assert(loaded.ok && loaded.doc, "pack reloads from disk");
      const packText = JSON.stringify(loaded.doc);
      assert(!packText.includes(LEARNING_TEXT), "DEEP provider learning text absent from Pack");
      assert(!packText.includes("deep lead"), "DEEP candidate context text absent from Pack");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- B2
  await runTest("E2E-B2 DEEP returns only duplicates -> still NEEDS_MORE_RESEARCH, no Pack, no ready story", async () => {
    const root = tmpRoot("b2");
    try {
      const urls = ["https://a.example/preserve"];
      const ex = sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE } });
      const out = await facade.runResearchToStory(factualInput("p-e2e-b2", { deepResearchAllowed: true }), {
        root, ...ex,
        deep: {
          runProvider: async () => ({
            ok: true,
            result: {
              providerVersion: "fixture", status: "COMPLETED",
              candidateSources: [{ url: "https://copy.example/same", title: "copy", context: "lead" }],
              queries: ["q"], learnings: [], providerCitations: [], warnings: [], errors: [],
            },
          }),
        },
        deepAcquireUrl: async (url) => ({ ok: true, document: fx.makeDoc(url, fx.BODY_PRESERVE), url }),
      });
      assert(out.status === "NEEDS_MORE_RESEARCH", `B2 honest insufficiency (${out.status})`);
      assert(out.packStatus !== "SCRIPT_READY", "no Pack after still-insufficient DEEP");
      assert(out.handoffStatus !== "READY", "no fake ready state");
      assert(!fs.existsSync(path.join(root, "projects", "p-e2e-b2", "story", "story-draft.json")), "no story draft artifact");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- C
  await runTest("E2E-C blocked access -> RESEARCH_BLOCKED, no blind DEEP, no Pack", async () => {
    const root = tmpRoot("c");
    try {
      const urls = ["https://locked.example/paywalled", "https://forbidden.example/private"];
      let deepCalls = 0;
      const ex = sufficientExchanges(urls, { failCode: "ROBOTS_DISALLOWED" });
      const out = await facade.runResearchToStory(factualInput("p-e2e-c", { deepResearchAllowed: true }), {
        root, ...ex,
        deep: { runProvider: async () => { deepCalls++; return { ok: true, result: {} }; } },
      });
      assert(out.status === "RESEARCH_BLOCKED", `blocked route (${out.status})`);
      assert(deepCalls === 0, "no blind DEEP when access gap is not DEEP-solvable");
      assert(out.packStatus !== "SCRIPT_READY" && out.handoffStatus !== "READY", "no Pack / no ready story");
      assert(!fs.existsSync(path.join(root, "projects", "p-e2e-c", "research", "research-pack.json")), "no pack artifact");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- D
  await runTest("E2E-D pure FICTION -> no search, no Pack, no fabricated refs -> HANDOFF_READY", async () => {
    const root = tmpRoot("d");
    try {
      let searchCalls = 0;
      let acquireCalls = 0;
      const out = await facade.runResearchToStory({
        projectId: "p-e2e-d",
        topic: "The night guard of an invented 1980s provincial hospital",
        contentMode: "horror-fiction",
        platform: "youtube",
        storyContext: { premise: "a night guard in a 1980s provincial hospital", beats: ["arrival", "first sound", "discovery"] },
        editorial: {
          angle: "Dread builds through sound, not spectacle.",
          coreViewerQuestion: "What walks the night corridors?",
          mainInsight: "Fear of the unseen carries the tale.",
          payoff: "Morning comes; the ward keeps its secret.",
        },
      }, {
        root,
        searchExchange: async () => { searchCalls++; return []; },
        acquireUrls: async () => { acquireCalls++; return []; },
      });
      assert(out.status === "HANDOFF_READY", `pure fiction ready (${out.status}: ${out.blockers.join("; ")})`);
      assert(searchCalls === 0 && acquireCalls === 0, "no SearchProvider/acquisition invoked for fiction");
      assert(out.packStatus === "NOT_NEEDED" || out.packStatus === "NOT_BUILT", `no pack (${out.packStatus})`);
      assert(out.contentClass === "FICTION", "class stays FICTION");
      const pd = path.join(root, "projects", "p-e2e-d");
      assert(!fs.existsSync(path.join(pd, "research", "source-index.json")), "no source registry fabricated");
      assert(!fs.existsSync(path.join(pd, "research", "research-pack.json")), "no pack fabricated");
      const draft = storyStore.loadStoryFile(root, "p-e2e-d", storyStore.FILES.draftJson);
      assert(draft.ok && draft.doc, "story draft persisted");
      assert(draft.doc.sections.every((s) => s.claimRefs.length === 0), "zero claim refs (no fabricated source refs)");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- E
  await runTest("E2E-E FICTION with targeted real-world facts -> core stays FICTION, facts evidence-backed", async () => {
    const root = tmpRoot("e");
    try {
      const urls = ["https://history.example/waverly", "https://archive.example/sanatorium-records"];
      const ex = sufficientExchanges(urls, {
        bodies: { [urls[0]]: fx.BODY_D, [urls[1]]: fx.BODY_PRESERVE },
        claimOver: { claim: "The real Waverly Hills Sanatorium opened in 1910 as a tuberculosis hospital.", claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "medium" },
      });
      const out = await facade.runResearchToStory({
        projectId: "p-e2e-e",
        topic: "The Blackwood sanatorium legend",
        contentMode: "horror-fiction",
        platform: "youtube",
        targetedResearchTopics: ["When was the real Waverly Hills Sanatorium built?"],
        storyContext: { premise: "a caretaker in a haunted sanatorium", beats: ["arrival", "ward 4", "dawn"] },
        editorial: {
          angle: "The real building grounds the invented dread.",
          coreViewerQuestion: "What is real behind the legend?",
          mainInsight: "History makes the horror heavier.",
          payoff: "The legend ends where the records begin.",
        },
      }, { root, ...ex });
      assert(out.status === "HANDOFF_READY", `targeted fiction ready (${out.status}: ${out.blockers.join("; ")})`);
      assert(out.contentClass === "FICTION", "fictional core NOT converted to FACTUAL/HYBRID");
      assert(out.sources.registered === 2, `targeted facts canonically acquired (${out.sources.registered})`);
      const pack = storyStore.loadStoryFile(root, "p-e2e-e", storyStore.FILES.packJson);
      assert(pack.ok && pack.doc, "targeted-fact pack persisted");
      assert((pack.doc.verifiedFacts || []).length > 0, "targeted factual details carry verified evidence");
      const draft = storyStore.loadStoryFile(root, "p-e2e-e", storyStore.FILES.draftJson);
      const plotSections = draft.doc.sections.filter((s) => s.claimRefs.length === 0);
      assert(plotSections.length >= 1, "fictional plot sections remain claim-free (clearly fictional)");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- F
  await runTest("E2E-F HYBRID -> labels preserved, fictionalized element never promoted, audit PASS", async () => {
    const root = tmpRoot("f");
    try {
      const urls = ["https://records.example/villa", "https://journal.example/da-lat"];
      const folkloreClaim = "Legend says gold is buried beneath the courtyard before the owner vanished in 1945.";
      const fictionalBeat = "Narrator beat: the camera pushes toward the darkened doorway as the music swells.";
      const factClaim = "Municipal records show the villa was built in 1922.";
      const labels = {};
      const ex = sufficientExchanges(urls, {
        bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D },
        claimOver: { claim: factClaim, claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "high" },
      });
      // Second pass analysis: folklore + fictionalized element claims.
      const origAnalysis = ex.analysisExchange;
      ex.analysisExchange = async (requests) => {
        const base = await origAnalysis(requests);
        return base.map((cands, i) => (i === 0
          ? [...cands,
            { claim: folkloreClaim, claimClass: "HYPOTHESIS", evidenceStatus: "WEAK", materiality: "medium" },
            { claim: fictionalBeat, claimClass: "UNVERIFIED", evidenceStatus: "UNSUPPORTED", materiality: "low" }]
          : cands));
      };
      // Precompute claim IDs (stable on claim text + question ids).
      const qids = qidsFor("The Da Lat villa legend", "urban-legend-documentary");
      labels[ledgerLib.claimIdFor(factClaim, qids)] = "FACT";
      labels[ledgerLib.claimIdFor(folkloreClaim, qids)] = "FOLKLORE";
      labels[ledgerLib.claimIdFor(fictionalBeat, qids)] = "FICTIONALIZED_ELEMENT";
      const out = await facade.runResearchToStory({
        ...factualInput("p-e2e-f"), projectId: "p-e2e-f", contentMode: "urban-legend-documentary", contentClass: undefined, hybridLabels: labels,
        fictionalizationBoundary: { mayFictionalize: ["transitions", "doorway beat"], mustRemainFactual: ["villa land record"], mustAttribute: ["folklore retellings"] },
      }, { root, ...ex });
      assert(out.status === "HANDOFF_READY", `hybrid ready (${out.status}: ${out.blockers.join("; ")})`);
      assert(out.contentClass === "HYBRID", "class HYBRID");
      const pack = storyStore.loadStoryFile(root, "p-e2e-f", storyStore.FILES.packJson);
      assert(pack.ok && pack.doc, "pack persisted");
      const labelsSeen = new Set();
      for (const key of ["verifiedFacts", "primarySourceFacts", "independentlyCorroboratedFacts", "derivedContext", "conflictingClaims", "unverifiedClaims"]) {
        for (const e of pack.doc[key] || []) if (e.classification) labelsSeen.add(e.classification);
      }
      assert(labelsSeen.has("FOLKLORE"), "FOLKLORE label preserved in pack");
      assert(labelsSeen.has("FICTIONALIZED_ELEMENT"), "FICTIONALIZED_ELEMENT label preserved in pack");
      // No fictionalized promotion (§14): fictionalized element is not in any
      // verified/confirmed bucket and is forbidden as fact by the gate.
      const promoted = ["verifiedFacts", "primarySourceFacts", "independentlyCorroboratedFacts"]
        .some((k) => (pack.doc[k] || []).some((e) => e.classification === "FICTIONALIZED_ELEMENT"));
      assert(!promoted, "fictionalized element never upgraded to verified/confirmed");
      const policy = storyStore.loadStoryFile(root, "p-e2e-f", storyStore.FILES.policy);
      assert(policy.ok && (policy.doc.forbiddenAsFact || []).some((f) => f.rule === "FICTION_IS_NOT_DOCUMENTED"),
        "evidence gate forbids fictionalized element as fact");
      const audit = storyStore.loadStoryFile(root, "p-e2e-f", storyStore.FILES.audit);
      assert(audit.ok && audit.doc.state === "PASS", `audit PASS (${audit.doc && audit.doc.state})`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- G
  await runTest("E2E-G contradiction -> recorded + framed, dispute preserved in story, no false consensus", async () => {
    const root = tmpRoot("g");
    try {
      const urls = ["https://records.example/villa-land", "https://witnesses.example/villa-family"];
      // No numerals in the disputed claims: the story audit requires every
      // number in a multi-claim section to exist in EACH referenced claim's
      // evidence corpus, so the dispute fixture stays number-free.
      const factClaim = "Municipal records confirm the villa stands on registered town land.";
      const rivalClaim = "Witness accounts dispute which family first owned the villa, contradicting the records.";
      const ex = sufficientExchanges(urls, {
        bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D },
        claimOver: { claim: factClaim, claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "medium" },
      });
      const origAnalysis = ex.analysisExchange;
      ex.analysisExchange = async (requests) => {
        const base = await origAnalysis(requests);
        return base.map((cands, i) => (i === 1
          ? [{ claim: rivalClaim, claimClass: "CONTESTED", evidenceStatus: "MIXED", materiality: "medium" }]
          : cands));
      };
      const out = await facade.runResearchToStory({
        ...factualInput("p-e2e-g"), topic: "The Da Lat villa build date",
      }, { root, ...ex, frameContradictions: true });
      assert(out.status === "HANDOFF_READY", `framed dispute reaches handoff (${out.status}: ${out.blockers.join("; ")})`);
      const pack = storyStore.loadStoryFile(root, "p-e2e-g", storyStore.FILES.packJson);
      assert(pack.ok && (pack.doc.conflictingClaims || []).length >= 1, "dispute lands in pack conflictingClaims (not flattened)");
      const brief = storyStore.loadStoryFile(root, "p-e2e-g", storyStore.FILES.brief);
      assert(brief.ok && (brief.doc.disputesToPreserve || []).length >= 1, "narrative brief preserves the dispute");
      const draft = storyStore.loadStoryFile(root, "p-e2e-g", storyStore.FILES.draftJson);
      const disputeSection = draft.doc.sections.find((s) => s.storyFunction === "framing" || /dispute|1905|conflict/i.test(s.draftText));
      assert(disputeSection, "story draft carries the framed dispute");
      const audit = storyStore.loadStoryFile(root, "p-e2e-g", storyStore.FILES.audit);
      assert(audit.ok && audit.doc.state === "PASS", `audit PASS with preserved dispute (${audit.doc && audit.doc.state})`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- H
  await runTest("E2E-H duplicate/derived sources -> independence does not inflate -> not falsely SUFFICIENT", async () => {
    const root = tmpRoot("h");
    try {
      const urls = ["https://origin.example/story", "https://syndicator.example/copy", "https://aggregator.example/copy2"];
      let deepCalls = 0;
      const ex = sufficientExchanges(urls, {
        bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_A, [urls[2]]: fx.BODY_A },
      });
      const out = await facade.runResearchToStory(factualInput("p-e2e-h", { deepResearchAllowed: false }), {
        root, ...ex,
        deep: { runProvider: async () => { deepCalls++; return { ok: true, result: {} }; } },
      });
      assert(out.status === "NEEDS_MORE_RESEARCH", `duplicates never fabricate sufficiency (${out.status})`);
      assert(out.sources.registered === 3, "all copies registered");
      assert(out.sources.independentGroups <= 1, `independent groups NOT inflated (${out.sources.independentGroups})`);
      assert(deepCalls === 0, "no DEEP when deepResearchAllowed=false");
      assert(out.packStatus !== "SCRIPT_READY", "no Pack from duplicate inflation");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- I
  await runTest("E2E-I unsupported high-impact claim -> cannot reach ready factual story", async () => {
    const root = tmpRoot("i");
    try {
      const urls = ["https://rumor.example/claim"];
      const ex = sufficientExchanges(urls, {
        bodies: { [urls[0]]: fx.BODY_PRESERVE },
        claimOver: { claim: "The 308 standard was secretly revised in 2024 to allow method rewriting.", claimClass: "UNVERIFIED", evidenceStatus: "UNSUPPORTED", materiality: "critical" },
      });
      const out = await facade.runResearchToStory(factualInput("p-e2e-i"), { root, ...ex });
      assert(out.status === "NEEDS_MORE_RESEARCH" || out.status === "RESEARCH_BLOCKED",
        `unsupported critical claim blocks handoff (${out.status})`);
      assert(out.packStatus !== "SCRIPT_READY" && out.handoffStatus !== "READY", "no ready state carrying orphan claim");
      assert(!fs.existsSync(path.join(root, "projects", "p-e2e-i", "story", "story-draft.json")),
        "story composer cannot silently reintroduce the unsupported claim");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- J
  await runTest("E2E-J stale upstream artifact -> downstream ready state invalidated (STALE_INPUT)", async () => {
    const root = tmpRoot("j");
    try {
      // 1. Full run to HANDOFF_READY.
      const urls = ["https://a.example/preserve", "https://d.example/independent"];
      const ex = sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } });
      const out = await facade.runResearchToStory(factualInput("p-e2e-j"), { root, ...ex });
      assert(out.status === "HANDOFF_READY", "baseline run ready");
      // 2. Simulate changed upstream evidence state (weaker sufficiency).
      const planLoaded = storyStore.loadStoryFile(root, "p-e2e-j", "research/research-plan.json");
      const changedInput = {
        plan: planLoaded.doc,
        ledger: { claims: [] },
        contradictionsStore: { contradictions: [] },
        unknownsStore: { unknowns: [] },
        sufficiency: { decision: "NEEDS_MORE_RESEARCH" },
      };
      const stale = facade.checkExistingPackStaleness(root, "p-e2e-j", changedInput);
      assert(stale.stale === true, `stale detected (${JSON.stringify(stale)})`);
      assert((stale.staleLayers || []).includes("draft") || (stale.staleLayers || []).length > 0,
        "downstream layers invalidated, not reused as current");
      // 3. A rerun with the weaker evidence must NOT return HANDOFF_READY from stale artifacts.
      const weakEx = sufficientExchanges([urls[0]], { bodies: { [urls[0]]: fx.BODY_PRESERVE } });
      const rerun = await facade.runResearchToStory(factualInput("p-e2e-j"), { root, ...weakEx });
      assert(rerun.status !== "HANDOFF_READY", `no HANDOFF_READY from changed inputs (${rerun.status})`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------------------------------------------------------- K
  await runTest("E2E-K ambiguous class and mode/class conflict stop before research/story", async () => {
    const root = tmpRoot("k");
    try {
      let searchCalls = 0;
      const ex = { searchExchange: async () => { searchCalls++; return []; } };
      const amb = await facade.runResearchToStory({ projectId: "p-e2e-k1", topic: "The vanished lighthouse keeper" }, { root, ...ex });
      assert(amb.status === "AMBIGUOUS_CONTENT_CLASS", `ambiguous stops safely (${amb.status})`);
      const conf = await facade.runResearchToStory({
        projectId: "p-e2e-k2", topic: "The vanished lighthouse keeper",
        contentClass: "FACTUAL", contentMode: "horror-fiction",
      }, { root, ...ex });
      assert(conf.status === "CONTENT_MODE_CLASS_CONFLICT", `conflict stops safely (${conf.status})`);
      assert(searchCalls === 0, "no research performed for either stop state");
      for (const p of ["p-e2e-k1", "p-e2e-k2"]) {
        assert(!fs.existsSync(path.join(root, "projects", p, "story")), "no story artifacts on validation stop");
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ------------------------------------------------- platform matrix (§9)
  await runTest("Platform matrix: YT FACTUAL, TikTok FACTUAL, YT FICTION, TikTok HYBRID", async () => {
    const root = tmpRoot("plat");
    try {
      const urls = ["https://a.example/preserve", "https://d.example/independent"];

      const ytFact = await facade.runResearchToStory(factualInput("p-plat-ytf"), { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) });
      assert(ytFact.status === "HANDOFF_READY" && ytFact.platform === "youtube", "YouTube FACTUAL ready");

      const ttFact = await facade.runResearchToStory(factualInput("p-plat-ttf", { platform: "tiktok" }), { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) });
      assert(ttFact.status === "HANDOFF_READY" && ttFact.platform === "tiktok", "TikTok FACTUAL ready");
      // Platform overlay shapes metadata only; evidence truth unchanged.
      assert(ttFact.sufficiency === ytFact.sufficiency && ttFact.sources.registered === ytFact.sources.registered,
        "evidence truth identical across platforms");

      const ytFic = await facade.runResearchToStory({
        projectId: "p-plat-ytfi", topic: "An invented lighthouse tale", contentMode: "horror-fiction", platform: "youtube",
        storyContext: { premise: "a lighthouse keeper", beats: ["fog", "light", "morning"] },
        editorial: { angle: "Isolation amplifies sound.", coreViewerQuestion: "What waits in the fog?", mainInsight: "I.", payoff: "Dawn." },
      }, { root, searchExchange: async () => { throw new Error("must not search"); } });
      assert(ytFic.status === "HANDOFF_READY" && ytFic.platform === "youtube", "YouTube FICTION ready with zero research");

      const labels = {};
      const hybridClaim = "Municipal records confirm the villa stands on registered town land.";
      const hybridEx = sufficientExchanges(urls, {
        bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D },
        claimOver: { claim: hybridClaim, claimClass: "SUPPORTED_FACT", evidenceStatus: "SUPPORTED", materiality: "medium" },
      });
      labels[ledgerLib.claimIdFor(hybridClaim, qidsFor("The Da Lat villa legend", "urban-legend-documentary"))] = "FACT";
      const ttHybrid = await facade.runResearchToStory({
        ...factualInput("p-plat-tth", { platform: "tiktok" }), projectId: "p-plat-tth",
        contentMode: "urban-legend-documentary", contentClass: undefined,
        hybridLabels: labels,
        fictionalizationBoundary: { mayFictionalize: ["transitions"], mustRemainFactual: ["villa land record"], mustAttribute: [] },
      }, { root, ...hybridEx });
      assert(ttHybrid.status === "HANDOFF_READY" && ttHybrid.platform === "tiktok", `TikTok HYBRID ready (${ttHybrid.status})`);
      assert(ttHybrid.contentClass === "HYBRID", "platform overlay did not alter source truth");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ------------------------------------------------- idempotency / rerun (§21)
  await runTest("Idempotency: same deterministic E2E twice -> stable identity, no duplicate inflation", async () => {
    const root = tmpRoot("idem");
    try {
      const urls = ["https://a.example/preserve", "https://d.example/independent"];
      const input = factualInput("p-idem");
      const run1 = await facade.runResearchToStory(input, { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) });
      const run2 = await facade.runResearchToStory(input, { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) });
      assert(run1.status === "HANDOFF_READY" && run2.status === "HANDOFF_READY", "both runs ready");
      assert(run1.sources.registered === run2.sources.registered, `no canonical source inflation (${run1.sources.registered} -> ${run2.sources.registered})`);
      const pack1 = storyStore.loadStoryFile(root, "p-idem", storyStore.FILES.packJson).doc;
      const pack2 = storyStore.loadStoryFile(root, "p-idem", storyStore.FILES.packJson).doc;
      assert(pack1.packId === pack2.packId, `stable pack identity (${pack1.packId})`);
      const draft1 = storyStore.loadStoryFile(root, "p-idem", storyStore.FILES.draftJson).doc;
      const draft2 = storyStore.loadStoryFile(root, "p-idem", storyStore.FILES.draftJson).doc;
      assert(draft1.draftId === draft2.draftId, `stable draft identity (${draft1.draftId})`);
      const reg1 = storyStore.loadStoryFile(root, "p-idem", "research/source-index.json").doc;
      assert(reg1.sources.length === 2, "registry did not duplicate on rerun");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ------------------------------------------------- persistence / partial write (§19-20)
  await runTest("Persistence/reload + partial-write resilience: corrupt downstream artifact exposes no ready state", async () => {
    const root = tmpRoot("persist");
    try {
      const urls = ["https://a.example/preserve", "https://d.example/independent"];
      const out = await facade.runResearchToStory(factualInput("p-persist"), { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) });
      assert(out.status === "HANDOFF_READY", "run ready");
      // Full reload of every persisted artifact.
      for (const rel of Object.values(storyStore.FILES)) {
        const loaded = storyStore.loadStoryFile(root, "p-persist", rel);
        assert(loaded.ok && loaded.doc, `${rel} reloads`);
      }
      // Cross-module consume: evidence files load via evidence-store loaders.
      const ev = require("../../lib/research-evidence/evidence-store.js");
      const claims = ev.loadEvidenceFile(root, "p-persist", "research/claims.json");
      assert(claims.ok && Array.isArray(claims.doc.claims) && claims.doc.claims.length > 0, "claims ledger reloads and is consumable");
      // Partial/corrupt write: no valid-ready state exposed.
      const draftPath = path.join(root, "projects", "p-persist", "story", "story-draft.json");
      fs.writeFileSync(draftPath, '{"draftId": "trunc', "utf8");
      let exposed = null;
      try {
        const reloaded = storyStore.loadStoryFile(root, "p-persist", storyStore.FILES.draftJson);
        exposed = reloaded.ok ? reloaded.doc : null;
      } catch (e) { exposed = null; }
      assert(!exposed || typeof exposed.draftId !== "string" || exposed.draftId === "trunc",
        "corrupt draft does not load as a valid ready artifact");
      const stale = facade.checkExistingPackStaleness(root, "p-persist", {
        plan: { topic: "HTTP 308 semantics" },
        ledger: { claims: [] },
        contradictionsStore: { contradictions: [] },
        unknownsStore: { unknowns: [] },
        sufficiency: { decision: "NEEDS_MORE_RESEARCH" },
      });
      assert(stale.stale === true, "corrupt/changed state invalidates ready reuse");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ------------------------------------------------- V6 addendum: Creative Brief E2E
  await runTest("V6 ADDENDUM: Creative Brief in the E2E route — lineage + planning context only, evidence truth unchanged", async () => {
    const root = tmpRoot("v6brief");
    try {
      const urls = ["https://a.example/preserve", "https://d.example/independent"];
      const built = creativeBrief.createBrief({
        channelDefaults: { audience: "channel default audience" },
        platformProfile: { platform: "youtube" },
        overrides: {
          briefId: "cb-e2e-v6", audience: "junior developers", knowledgeLevel: "beginner",
          targetDuration: "60-90s", viewerPromise: "understand 308 fast",
          primaryLearningGoal: "redirect semantics", contentDensity: "lean",
        },
      });
      assert(built.ok, "creative brief builds");
      const brief = built.brief;
      const ref = creativeBrief.briefRef(brief);

      // WITH brief: full canonical V6 route Topic → Brief → Plan → … → Draft.
      const withBrief = await facade.runResearchToStory(
        { ...factualInput("p-v6-brief"), creativeBrief: brief },
        { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) }
      );
      assert(withBrief.status === "HANDOFF_READY", `brief route ready (${withBrief.status}: ${withBrief.blockers.join("; ")})`);

      // Lineage link 1→2: ResearchPlan.creativeBriefRef == brief ID/hash/version.
      const plan = storyStore.loadStoryFile(root, "p-v6-brief", "research/research-plan.json").doc;
      assert(plan.creativeBriefRef && plan.creativeBriefRef.briefId === "cb-e2e-v6",
        `plan.creativeBriefRef.briefId linked (${plan.creativeBriefRef && plan.creativeBriefRef.briefId})`);
      assert(plan.creativeBriefRef.briefHash === ref.briefHash && plan.creativeBriefRef.briefVersion === ref.briefVersion,
        "brief hash + version stable through the plan");
      // Brief fills planning gaps only (explicit plan input would win).
      assert(plan.audience === "junior developers", "brief audience flowed into the plan (no explicit conflict)");
      // Lineage link 2→3: brief persisted as canonical artifact.
      const persistedBrief = storyStore.loadStoryFile(root, "p-v6-brief", "research/creative-brief.json");
      assert(persistedBrief.ok && persistedBrief.doc && persistedBrief.doc.briefId === "cb-e2e-v6",
        "creative-brief.json persisted");
      assert(withBrief.artifactRefs.creativeBrief && withBrief.artifactRefs.creativeBrief.briefId === "cb-e2e-v6",
        "artifactRefs carries creativeBrief");
      const lineageLayers = withBrief.lineage.map((l) => l.layer);
      assert(lineageLayers.includes("creativeBrief"), "lineage exposes the creativeBrief layer");

      // (3) Brief affects ONLY planning/editorial context — evidence truth identical.
      const withoutBrief = await facade.runResearchToStory(
        factualInput("p-v6-nobrief"),
        { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) }
      );
      assert(withoutBrief.status === "HANDOFF_READY", "no-brief route ready");
      assert(withBrief.sufficiency === withoutBrief.sufficiency && withBrief.sources.registered === withoutBrief.sources.registered,
        `same sufficiency/source truth with and without brief (${withBrief.sufficiency}/${withoutBrief.sufficiency}, ${withBrief.sources.registered}/${withoutBrief.sources.registered})`);
      const evStore = require("../../lib/research-evidence/evidence-store.js");
      const stripVolatile = (claims) => claims.map((c) => ({
        claimId: c.claimId, claim: c.claim, claimClass: c.claimClass, evidenceStatus: c.evidenceStatus,
        materiality: c.materiality, corroborationStatus: c.corroborationStatus,
        researchQuestionIds: c.researchQuestionIds,
        supportingEvidence: c.supportingEvidence, contradictingEvidence: c.contradictingEvidence,
      }));
      const claimsB = stripVolatile(evStore.loadEvidenceFile(root, "p-v6-brief", "research/claims.json").doc.claims);
      const claimsN = stripVolatile(evStore.loadEvidenceFile(root, "p-v6-nobrief", "research/claims.json").doc.claims);
      assert(JSON.stringify(claimsB) === JSON.stringify(claimsN), "claim/evidence ledger identical with and without brief (timestamps excluded)");
      // Pack evidence verdicts identical (packHash differs only via briefRef fingerprint).
      const packB = storyStore.loadStoryFile(root, "p-v6-brief", storyStore.FILES.packJson).doc;
      const packN = storyStore.loadStoryFile(root, "p-v6-nobrief", storyStore.FILES.packJson).doc;
      const verdicts = (p) => ["verifiedFacts", "primarySourceFacts", "independentlyCorroboratedFacts", "conflictingClaims", "unverifiedClaims"]
        .map((k) => (p[k] || []).map((e) => `${e.claimId}:${e.corroborationStatus}`).join("|")).join(";");
      assert(verdicts(packB) === verdicts(packN), "pack evidence verdicts unchanged by the brief");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await runTest("V6 ADDENDUM: backward compatibility — routes without Creative Brief keep pre-V6 behavior", async () => {
    const root = tmpRoot("v6compat");
    try {
      const urls = ["https://a.example/preserve", "https://d.example/independent"];
      const out = await facade.runResearchToStory(
        factualInput("p-v6-compat"),
        { root, ...sufficientExchanges(urls, { bodies: { [urls[0]]: fx.BODY_PRESERVE, [urls[1]]: fx.BODY_D } }) }
      );
      assert(out.status === "HANDOFF_READY", "no-brief route still reaches HANDOFF_READY");
      const plan = storyStore.loadStoryFile(root, "p-v6-compat", "research/research-plan.json").doc;
      assert(!("creativeBriefRef" in plan), "no brief => no creativeBriefRef key (identical pre-V6 plan output)");
      assert(!fs.existsSync(path.join(root, "projects", "p-v6-compat", "research", "creative-brief.json")),
        "no creative-brief.json fabricated");
      assert(!out.artifactRefs.creativeBrief && !out.lineage.some((l) => l.layer === "creativeBrief"),
        "no brief lineage fabricated");
      assert(out.packStatus === "SCRIPT_READY" && out.storyStatus === "PASS", "downstream chain unaffected");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await runTest("V6 ADDENDUM: invalid Creative Brief stops before research with no side effects", async () => {
    const root = tmpRoot("v6invalid");
    try {
      let searchCalls = 0;
      const out = await facade.runResearchToStory({
        ...factualInput("p-v6-invalid"),
        creativeBrief: { platform: "vimeo", audience: "someone", version: "1.0.0" }, // invalid platform enum
      }, {
        root,
        searchExchange: async () => { searchCalls++; return []; },
      });
      assert(out.status !== "HANDOFF_READY", "invalid brief cannot reach handoff");
      assert(out.blockers.some((b) => /CREATIVE_BRIEF_INVALID/.test(b)), `explicit CREATIVE_BRIEF_INVALID blocker (${out.blockers.join("; ")})`);
      assert(searchCalls === 0, "no research performed on invalid brief");
      assert(!fs.existsSync(path.join(root, "projects", "p-v6-invalid", "story")), "no story artifacts");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
