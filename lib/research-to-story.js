"use strict";

/**
 * UNFOLDIQ Phase 1G.1 integration facade (Prompt 06, 1G.1R).
 *
 * runResearchToStory(input, options) coordinates the canonical 1G.1 owners:
 * content class (lib/content-class.js) -> research planning (lib/research-plan.js)
 * -> acquisition (lib/research-acquisition/) -> evidence (lib/research-evidence/)
 * -> DEEP escalation (lib/research-deep/) -> story handoff (lib/research-story/).
 *
 * This module owns NO business rules: no mode->class map, no URL safety, no
 * independence heuristics, no claim verification, no sufficiency scoring, no
 * DEEP eligibility, no story evidence policy. It only sequences owner calls,
 * passes provider/analyst exchanges through their canonical normalization
 * layers, maps terminal states, and persists canonical artifacts.
 *
 * Exchange seams (the canonical V1 model — no network client is baked in):
 *   options.searchExchange(requests)    -> raw search results per request
 *   options.acquireUrls(urls)           -> acquired documents (default: real
 *                                          acquisition.acquireBatch)
 *   options.analysisExchange(requests)  -> claim candidates per analysis request
 *   options.deep.runProvider(request)   -> DEEP provider (leads only)
 *
 * Terminal statuses (explicit, never collapsed into a generic ERROR):
 *   HANDOFF_READY | NEEDS_MORE_RESEARCH | RESEARCH_BLOCKED |
 *   AMBIGUOUS_CONTENT_CLASS | CONTENT_MODE_CLASS_CONFLICT |
 *   DEEP_UNAVAILABLE | DEEP_BUDGET_EXHAUSTED | STORY_BLOCKED_BY_EVIDENCE |
 *   EDITORIAL_INPUT_REQUIRED | STALE_INPUT | FAILED
 */

const path = require("path");
const crypto = require("crypto");
const { stableStringify } = require("./../providers/runtime/request-fingerprint.js");


const planLib = require("./research-plan.js");
const acquisition = require("./research-acquisition/acquisition.js");
const searchProvider = require("./research-acquisition/search-provider.js");
const analysisExchangeLib = require("./research-evidence/analysis-exchange.js");
const registryLib = require("./research-evidence/source-registry.js");
const independenceLib = require("./research-evidence/independence.js");
const ledgerLib = require("./research-evidence/claim-ledger.js");
const verificationLib = require("./research-evidence/verification.js");
const contradictionsLib = require("./research-evidence/contradictions.js");
const sufficiencyLib = require("./research-evidence/sufficiency.js");
const evidenceStore = require("./research-evidence/evidence-store.js");
const packLib = require("./research-story/research-pack.js");
const gateLib = require("./research-story/script-evidence-gate.js");
const narrativeBriefLib = require("./research-story/narrative-brief.js");
const draftLib = require("./research-story/story-draft.js");
const auditLib = require("./research-story/story-audit.js");
const storyStore = require("./research-story/story-store.js");
const deepLib = require("./research-deep/index.js");
const creativeMemoryLib = require("./creative-memory.js");

const FACADE_VERSION = "1.0.0";

const STATUS = {
  HANDOFF_READY: "HANDOFF_READY",
  NEEDS_MORE_RESEARCH: "NEEDS_MORE_RESEARCH",
  RESEARCH_BLOCKED: "RESEARCH_BLOCKED",
  AMBIGUOUS_CONTENT_CLASS: "AMBIGUOUS_CONTENT_CLASS",
  CONTENT_MODE_CLASS_CONFLICT: "CONTENT_MODE_CLASS_CONFLICT",
  DEEP_UNAVAILABLE: "DEEP_UNAVAILABLE",
  DEEP_BUDGET_EXHAUSTED: "DEEP_BUDGET_EXHAUSTED",
  STORY_BLOCKED_BY_EVIDENCE: "STORY_BLOCKED_BY_EVIDENCE",
  EDITORIAL_INPUT_REQUIRED: "EDITORIAL_INPUT_REQUIRED",
  STALE_INPUT: "STALE_INPUT",
  FAILED: "FAILED",
};

function sha16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function baseResult(input) {
  return {
    ok: false,
    status: STATUS.FAILED,
    facadeVersion: FACADE_VERSION,
    projectId: input.projectId || null,
    topic: input.topic || null,
    platform: input.platform || null,
    contentClass: null,
    contentMode: input.contentMode || input.modeId || null,
    researchRequired: null,
    researchMode: "STANDARD",
    sufficiency: null,
    deepEscalated: false,
    deepRunStatus: "NOT_RUN",
    packStatus: "NOT_BUILT",
    storyStatus: "NOT_STARTED",
    handoffStatus: "NOT_READY",
    artifactRefs: {},
    lineage: [],
    sources: { registered: 0, independentGroups: 0, searchResults: 0, acquisitionFailed: 0 },
    creativeMemoryContext: null,
    warnings: [],
    blockers: [],
  };
}

function projectDir(root, projectId) {
  return path.join(root, "projects", projectId);
}

/** Acquisition failure codes that mean "access blocked", not "try harder". */
const ACCESS_BLOCKED_CODES = new Set([
  "ROBOTS_DISALLOWED", "AUTH_REQUIRED", "HUMAN_ACTION_REQUIRED", "UNSAFE_URL",
  "PRIVATE_HOST", "PAYWALL_REQUIRED", "FORBIDDEN", "ACCESS_DENIED",
]);

function mapPlanFailure(result, p) {
  result.contentClass = p.contentClass || null;
  if (p.code === "AMBIGUOUS_CONTENT_CLASS") {
    result.status = STATUS.AMBIGUOUS_CONTENT_CLASS;
  } else if (p.code === "CONTENT_MODE_CLASS_CONFLICT") {
    result.status = STATUS.CONTENT_MODE_CLASS_CONFLICT;
  } else if (p.code === "RESEARCH_BYPASS_REJECTED") {
    result.status = STATUS.RESEARCH_BLOCKED;
  } else {
    result.status = STATUS.FAILED;
  }
  result.blockers.push(`${p.code}: ${p.message || ""}`.trim());
  return result;
}

/**
 * Evidence pipeline shared by REQUIRED and OPTIONAL_TARGETED routes.
 * Returns { index, ledger, store, sufficiency, bodies, plan } or sets a
 * terminal research status on the result.
 */
async function runEvidencePipeline(result, plan, options) {
  const root = options.root;
  const persist = options.persist !== false;
  const questions = plan.criticalQuestions || [];

  // 1. Search requests (canonical agent-exchange; no executor baked in).
  const requests = [];
  for (const q of questions) {
    const built = searchProvider.searchRequestFromPlan(plan, q, {
      executor: searchProvider.EXECUTOR_AGENT_EXCHANGE,
      maxResults: options.maxResultsPerQuery,
    });
    if (!built.ok) {
      result.warnings.push(`search request build failed: ${built.code}`);
      continue;
    }
    requests.push(built.request);
  }
  if (requests.length === 0) {
    result.status = STATUS.RESEARCH_BLOCKED;
    result.blockers.push("SEARCH_REQUEST_BUILD_FAILED: plan produced no valid search requests");
    return null;
  }
  if (typeof options.searchExchange !== "function") {
    result.status = STATUS.RESEARCH_BLOCKED;
    result.blockers.push("SEARCH_PROVIDER_UNAVAILABLE: no searchExchange configured for this run");
    return null;
  }
  const rawBatches = await options.searchExchange(requests);
  if (!Array.isArray(rawBatches)) {
    result.status = STATUS.RESEARCH_BLOCKED;
    result.blockers.push("SEARCH_EXCHANGE_INVALID: searchExchange must return an array aligned to requests");
    return null;
  }

  // 2. Normalize search results through the canonical owner. Snippets stay
  //    UNTRUSTED provenance; they never enter the evidence chain directly.
  const searchResults = [];
  for (let i = 0; i < requests.length; i++) {
    const norm = searchProvider.normalizeSearchResults(requests[i], rawBatches[i] || []);
    if (norm.ok) searchResults.push(...norm.results);
    else result.warnings.push(`search normalize failed q${i}: ${norm.code}`);
    for (const rej of (norm.ok ? norm.rejected : [])) {
      result.warnings.push(`search result rejected q${i}[${rej.index}]: ${rej.code}`);
    }
  }
  const deduped = searchProvider.dedupeSearchResults(searchResults);
  result.sources.searchResults = deduped.length;

  // 3. Canonical acquisition (Prompt-02 owner). Provider snippets are never
  //    acquired content; only fetched documents are.
  const urls = [...new Set(deduped.map((r) => r.url))];
  let acquired = [];
  if (urls.length > 0) {
    if (typeof options.acquireUrls === "function") {
      acquired = await options.acquireUrls(urls);
    } else {
      const batch = await acquisition.acquireBatch(urls, options.acquireOpts || {});
      acquired = batch.map((r) => ({ url: r.url, ok: !!r.ok, document: r.document, code: r.code, message: r.message }));
    }
  }
  const byUrl = new Map(acquired.map((a) => [a.url, a]));
  const failures = [];
  const docsByUrl = new Map();
  for (const url of urls) {
    const a = byUrl.get(url);
    if (!a || !a.ok || !a.document) {
      failures.push({ url, blocker: `${(a && a.code) || "ACQUIRE_FAILED"}: ${(a && a.message) || url}` });
      if (a && ACCESS_BLOCKED_CODES.has(a.code)) {
        result.blockers.push(`ACCESS_BLOCKED ${a.code}: ${url}`);
      }
    } else {
      docsByUrl.set(url, a.document);
    }
  }
  result.sources.acquisitionFailed = failures.length;
  if (urls.length > 0 && docsByUrl.size === 0) {
    result.status = STATUS.RESEARCH_BLOCKED;
    result.blockers.push("RESEARCH_BLOCKED: every candidate URL failed canonical acquisition");
    return null;
  }

  // 4. Source Registry + Independence (Prompt-03 owners).
  const index = registryLib.emptyIndex(plan.projectId);
  const bodies = {};
  const fits = {};
  for (const r of deduped) {
    const doc = docsByUrl.get(r.url);
    if (!doc || doc.success === false) continue;
    const reg = registryLib.registerSource(index, { acquiredDocument: doc, searchResult: r });
    if (!reg.ok) {
      result.warnings.push(`source register failed ${r.url}: ${reg.code}`);
      continue;
    }
    if (!bodies[reg.record.sourceId]) {
      bodies[reg.record.sourceId] = doc.rawMarkdown || "";
      fits[reg.record.sourceId] = doc.fitMarkdown || "";
    }
  }
  result.sources.registered = index.sources.length;
  independenceLib.evaluateIndependence(index.sources, bodies);
  result.sources.independentGroups = independenceLib.countIndependentGroups(index.sources, index.sources.map((s) => s.sourceId));
  if (persist && index.sources.length > 0) {
    registryLib.persistRegistry(root, plan.projectId, index, bodies);
  }

  // 5. Claim/evidence ledger via the canonical analysis exchange. Only
  //    canonically acquired content (registry-validated links) can support
  //    claims; provider summaries have no registry link and are rejected by
  //    the ledger owner.
  const ledger = ledgerLib.emptyLedger();
  const store = { contradictions: [], unknowns: [] };
  if (typeof options.analysisExchange === "function" && index.sources.length > 0) {
    const analysisRequests = index.sources
      .filter((s) => (bodies[s.sourceId] || "").length > 0 || (fits[s.sourceId] || "").length > 0)
      .map((s) => analysisExchangeLib.createAnalysisRequest({
        sourceId: s.sourceId,
        contentHash: s.currentVersionHash || s.contentHash,
        rawContent: bodies[s.sourceId] || "",
        fitContent: fits[s.sourceId] || "",
        researchQuestionIds: questions.map((_, i) => `q${i}`),
      }))
      .filter((r) => r.ok)
      .map((r) => r.request);
    const rawCandidates = await options.analysisExchange(analysisRequests);
    if (Array.isArray(rawCandidates)) {
      for (let i = 0; i < analysisRequests.length; i++) {
        const req = analysisRequests[i];
        const norm = analysisExchangeLib.normalizeAnalysisResponse(req, rawCandidates[i] || []);
        if (!norm.ok) {
          result.warnings.push(`analysis normalize failed ${req.sourceId}: ${norm.code}`);
          continue;
        }
        for (const rej of norm.rejected) {
          result.warnings.push(`analysis candidate rejected ${req.sourceId}[${rej.index}]: ${rej.code}`);
        }
        for (const cand of norm.candidates) {
          const up = ledgerLib.upsertClaim(ledger, {
            claim: cand.claim,
            claimClass: cand.claimClass,
            evidenceStatus: cand.evidenceStatus,
            materiality: cand.materiality,
            researchQuestionIds: cand.researchQuestionIds || req.researchQuestionIds,
            confidenceReason: cand.confidenceReason,
            evidence: [{
              sourceId: req.sourceId,
              contentHash: req.contentHash,
              locator: cand.evidence && cand.evidence[0] ? cand.evidence[0].locator : null,
              excerpt: cand.evidence && cand.evidence[0] ? cand.evidence[0].excerpt : "",
            }],
          }, index);
          if (!up.ok) result.warnings.push(`claim rejected: ${up.message}`);
        }
      }
    } else {
      result.warnings.push("analysisExchange returned no aligned array; ledger left empty (honest insufficiency)");
    }
  } else if (index.sources.length > 0) {
    result.warnings.push("no analysisExchange configured; claims must come from the analyst exchange");
  }
  verificationLib.verifyLedger(ledger, index.sources);

  // 6. Contradictions: a CONTESTED-classified claim on a question that also
  //    holds a rival claim is recorded via the contradictions owner. Framing
  //    is the analyst decision (options.frameContradictions), never silent
  //    consensus.
  for (const claim of ledger.claims) {
    if (claim.claimClass !== "CONTESTED") continue;
    const qid = (claim.researchQuestionIds || [])[0];
    const rival = ledger.claims.find((c) => c.claimId !== claim.claimId && (c.researchQuestionIds || []).includes(qid));
    if (!rival) continue;
    const qi = /^q(\d+)$/.test(String(qid)) ? Number(String(qid).slice(1)) : -1;
    contradictionsLib.recordContradiction(store, {
      claimIds: [claim.claimId, rival.claimId],
      sourceIds: [...new Set([
        ...claim.supportingEvidence.map((e) => e.sourceId),
        ...rival.supportingEvidence.map((e) => e.sourceId),
      ])],
      description: `Sources disagree on "${(plan.criticalQuestions || [])[qi] || qid}": "${claim.claim}" vs "${rival.claim}"`,
      materiality: claim.materiality === "critical" ? "critical" : "non-critical",
    });
    break; // one open dispute per run is enough to block false consensus
  }
  if (store.contradictions.length > 0 && options.frameContradictions) {
    contradictionsLib.frameAsDisputed(store, store.contradictions[0].contradictionId);
  }

  // 7. Sufficiency gate (canonical owner; failures feed the blocker path).
  const sufficiency = sufficiencyLib.evaluateSufficiency({
    plan,
    ledger,
    records: index.sources,
    store,
    budgetSpent: { sources: index.sources.length, queries: requests.length },
    failures,
    now: options.now,
  });

  if (persist) {
    evidenceStore.persistEvidenceState(root, plan.projectId, {
      index, claimsLedger: ledger, contradictionStore: store, unknownStore: store, sufficiency,
      brief: options.creativeBrief,
    });
  }
  return { index, ledger, store, sufficiency, bodies, plan, searchResults: deduped };
}

/** Editorial input is an analyst decision; the facade never invents it. */
function editorialRequired(input) {
  return !(input.editorial && typeof input.editorial.angle === "string" && input.editorial.angle.trim() &&
    typeof input.editorial.coreViewerQuestion === "string" && input.editorial.coreViewerQuestion.trim());
}

function buildFactualStory(result, evidence, input, options) {
  const { index, ledger, store, sufficiency, plan } = evidence;
  if (editorialRequired(input)) {
    result.status = STATUS.EDITORIAL_INPUT_REQUIRED;
    result.blockers.push("editorial.angle and editorial.coreViewerQuestion are analyst inputs and must be supplied");
    return result;
  }
  const pack = packLib.buildPack({
    projectId: plan.projectId,
    plan,
    brief: input.creativeBrief,
    ledger,
    records: index.sources,
    contradictionsStore: store,
    unknownsStore: store,
    sufficiency,
    hybridLabels: input.hybridLabels,
    verifiedQuotes: input.verifiedQuotes,
    claimFacets: input.claimFacets,
  });
  if (!pack.ok) {
    result.status = pack.code === "RESEARCH_BLOCKED" ? STATUS.RESEARCH_BLOCKED : STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`RESEARCH_PACK: ${pack.code} ${pack.message || ""}`.trim());
    return result;
  }
  result.packStatus = "SCRIPT_READY";
  const policy = gateLib.buildEvidencePolicy({ pack: pack.pack, records: index.sources });
  if (!policy.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`SCRIPT_EVIDENCE_POLICY: ${policy.code}`);
    return result;
  }
  const brief = narrativeBriefLib.buildNarrativeBrief({
    contentClass: plan.contentClass,
    contentMode: plan.contentMode,
    pack: pack.pack,
    policy: policy.policy,
    brief: input.creativeBrief,
    platform: plan.platform,
    planQuestions: plan.criticalQuestions,
    fictionalizationBoundary: input.fictionalizationBoundary,
    ...input.editorial,
  });
  if (!brief.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`NARRATIVE_BRIEF: ${brief.code} ${brief.message || ""}`.trim());
    return result;
  }
  return finishStory(result, {
    pack: pack.pack, policy: policy.policy, brief: brief.brief,
    ledger, index, store, sufficiency, plan,
  }, input, options);
}

/** Draft + audit + bounded mechanical revision + persistence. */
function finishStory(result, ctx, input, options) {
  const { pack, policy, brief, ledger, index, store, sufficiency, plan } = ctx;
  const gen = draftLib.generateStoryDraft({
    narrativeBrief: brief,
    pack,
    policy,
    platform: plan ? plan.platform : (brief && brief.platform),
    executor: input.storyExecutor || "deterministic",
    providerSections: input.providerSections,
  });
  if (!gen.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`STORY_DRAFT: ${gen.code}`);
    return result;
  }
  let draft = gen.draft;
  let audit = auditLib.auditStoryDraft(draft, { pack, policy });
  let attempts = 0;
  while (audit.state === "NEEDS_REVISION" && attempts < 3) {
    const rev = auditLib.reviseDraft(draft, audit, { pack, policy });
    draft = rev.draft;
    audit = rev.audit;
    attempts++;
  }
  if (audit.state !== "PASS") {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.storyStatus = audit.state;
    result.blockers.push(`STORY_AUDIT: ${audit.state} (${audit.issues.map((i) => `${i.code}: ${i.message}`).join("; ")})`);
    return result;
  }
  result.storyStatus = "PASS";
  result.handoffStatus = "READY";
  result.status = STATUS.HANDOFF_READY;

  if (options.persist !== false) {
    const root = options.root;
    const projectId = (plan && plan.projectId) || input.projectId;
    if (pack) {
      evidenceStore.persistEvidenceState(root, projectId, {
        index, claimsLedger: ledger, contradictionStore: store, unknownStore: store, sufficiency,
        brief: input.creativeBrief,
      });
    }
    const saved = storyStore.persistStoryHandoff(root, projectId, {
      ...(pack ? {
        pack,
        packMarkdown: packLib.renderPackMarkdown(pack),
        policy,
      } : {}),
      narrativeBrief: brief,
      draft,
      draftMarkdown: draftLib.renderDraftMarkdown(draft),
      audit,
    });
    if (!saved.ok) {
      result.warnings.push("story handoff persistence reported failure");
    }
    result.artifactRefs = collectArtifactRefs(root, projectId, {
      plan, index, pack, policy, brief, draft, audit,
    });
    result.lineage = buildLineage(plan, index, pack, brief, draft, audit);
  }
  return result;
}

function collectArtifactRefs(root, projectId, arts) {
  const refs = {};
  if (arts.plan) {
    refs.researchPlan = { path: "research/research-plan.json", hash: sha16(arts.plan) };
    if (arts.plan.creativeBriefRef) {
      refs.creativeBrief = { path: "research/creative-brief.json", ...arts.plan.creativeBriefRef };
    }
  }
  if (arts.index) {
    refs.sourceIndex = {
      path: "research/source-index.json",
      sourceIds: arts.index.sources.map((s) => s.sourceId),
      contentHashes: arts.index.sources.map((s) => s.currentVersionHash || s.contentHash),
    };
  }
  if (arts.pack) {
    refs.researchPack = { path: "research/research-pack.json", packId: arts.pack.packId, packHash: arts.pack.packHash };
    refs.evidencePolicy = { path: "story/script-evidence-policy.json", gateId: arts.policy.gateId };
  }
  if (arts.brief) refs.narrativeBrief = { path: "story/narrative-brief.json", briefId: arts.brief.briefId };
  if (arts.draft) refs.storyDraft = { path: "story/story-draft.json", draftId: arts.draft.draftId };
  if (arts.audit) refs.storyAudit = { path: "story/story-evidence-audit.json", auditId: arts.audit.auditId, state: arts.audit.state };
  return refs;
}

function buildLineage(plan, index, pack, brief, draft, audit) {
  const lineage = [];
  if (plan) {
    lineage.push(
      { layer: "topic", ref: plan.topic, inputRef: null },
      { layer: "contentClass", ref: plan.contentClass, inputRef: plan.topic },
    );
    if (plan.creativeBriefRef) {
      lineage.push({
        layer: "creativeBrief",
        ref: `${plan.creativeBriefRef.briefId}@${plan.creativeBriefRef.briefHash}v${plan.creativeBriefRef.briefVersion}`,
        inputRef: "pre-research context (V6; never evidence)",
      });
    }
    lineage.push(
      { layer: "researchPlan", ref: sha16(plan), inputRef: plan.creativeBriefRef ? `${plan.topic}/${plan.contentClass}+creativeBriefRef` : `${plan.topic}/${plan.contentClass}` },
    );
  }
  if (index) {
    lineage.push(
      { layer: "acquiredDocuments", ref: index.sources.map((s) => `${s.sourceId}@${(s.currentVersionHash || s.contentHash).slice(0, 12)}`).join(","), inputRef: "searchExchange->canonical acquisition" },
      { layer: "sourceRegistry", ref: `src:${index.sources.length}`, inputRef: "acquiredDocuments" },
      { layer: "evidenceState", ref: `claims:${(brief.selectedClaimIds || []).length}`, inputRef: "sourceRegistry+independence" },
    );
  }
  if (pack) {
    lineage.push(
      { layer: "researchPack", ref: pack.packId, inputRef: "evidenceState" },
      { layer: "narrativeBrief", ref: brief.briefId, inputRef: `${pack.packId}/editorial` },
    );
  } else {
    lineage.push({ layer: "narrativeBrief", ref: brief.briefId, inputRef: "editorial/storyContext (no pack: FICTION)" });
  }
  lineage.push(
    { layer: "storyDraft", ref: draft.draftId, inputRef: brief.briefId },
    { layer: "storyAudit", ref: audit.auditId, inputRef: draft.draftId },
  );
  return lineage;
}

/** Pure FICTION: no search, no pack, no fabricated refs. */
function runPureFiction(result, input, options) {
  if (editorialRequired(input)) {
    result.status = STATUS.EDITORIAL_INPUT_REQUIRED;
    result.blockers.push("fiction route still requires editorial.angle/coreViewerQuestion");
    return result;
  }
  const brief = narrativeBriefLib.buildNarrativeBrief({
    contentClass: "FICTION",
    contentMode: input.contentMode || input.modeId,
    brief: input.creativeBrief,
    storyContext: input.storyContext,
    targetedFactClaimIds: [],
    platform: input.platform,
    planQuestions: [],
    ...input.editorial,
  });
  if (!brief.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`NARRATIVE_BRIEF: ${brief.code} ${brief.message || ""}`.trim());
    return result;
  }
  return finishStory(result, { pack: null, policy: null, brief: brief.brief, ledger: null, index: null, store: null, sufficiency: null, plan: null }, input, options);
}

/** FICTION + targeted real-world facts: fictional core stays FICTION; only
 *  the targeted factual backbone carries evidence (its own subset plan). */
async function runTargetedFiction(result, planned, input, options) {
  const topics = planned.targetedResearchTopics || input.targetedResearchTopics || [];
  if (topics.length === 0) return runPureFiction(result, input, options);
  const subset = planLib.buildResearchPlan({
    projectId: input.projectId,
    topic: topics.join("; "),
    contentClass: "FACTUAL",
    contentMode: input.contentMode || input.modeId,
    platform: input.platform,
    audience: input.audience,
    criticalQuestions: topics,
    freshnessRequirement: input.freshnessRequirement,
    researchBudget: input.researchBudget,
  });
  if (!subset.ok) {
    result.status = STATUS.FAILED;
    result.blockers.push(`TARGETED_PLAN: ${subset.code}`);
    return result;
  }
  const evidence = await runEvidencePipeline(result, subset.plan, { ...options, creativeBrief: input.creativeBrief });
  if (!evidence) return result;
  result.sufficiency = evidence.sufficiency.decision;
  if (evidence.sufficiency.decision !== "SUFFICIENT") {
    result.status = evidence.sufficiency.decision === "BLOCKED" ? STATUS.RESEARCH_BLOCKED : STATUS.NEEDS_MORE_RESEARCH;
    result.blockers.push(`TARGETED_FACTS_INSUFFICIENT: ${evidence.sufficiency.decision}`);
    return result;
  }
  if (editorialRequired(input)) {
    result.status = STATUS.EDITORIAL_INPUT_REQUIRED;
    result.blockers.push("editorial.angle and editorial.coreViewerQuestion are analyst inputs and must be supplied");
    return result;
  }
  const pack = packLib.buildPack({
    projectId: input.projectId,
    plan: subset.plan,
    brief: input.creativeBrief,
    ledger: evidence.ledger,
    records: evidence.index.sources,
    contradictionsStore: evidence.store,
    unknownsStore: evidence.store,
    sufficiency: evidence.sufficiency,
  });
  if (!pack.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`TARGETED_PACK: ${pack.code}`);
    return result;
  }
  const policy = gateLib.buildEvidencePolicy({ pack: pack.pack, records: evidence.index.sources });
  if (!policy.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`SCRIPT_EVIDENCE_POLICY: ${policy.code}`);
    return result;
  }
  const targetedIds = input.targetedFactClaimIds || pack.pack.verifiedFacts.map((e) => e.claimId);
  const brief = narrativeBriefLib.buildNarrativeBrief({
    contentClass: "FICTION",
    contentMode: input.contentMode || input.modeId,
    policy: policy.policy,
    brief: input.creativeBrief,
    storyContext: input.storyContext,
    targetedFactClaimIds: targetedIds,
    platform: input.platform,
    planQuestions: topics,
    ...input.editorial,
  });
  if (!brief.ok) {
    result.status = STATUS.STORY_BLOCKED_BY_EVIDENCE;
    result.blockers.push(`NARRATIVE_BRIEF: ${brief.code} ${brief.message || ""}`.trim());
    return result;
  }
  const finished = finishStory(result, {
    pack: pack.pack, policy: policy.policy, brief: brief.brief,
    ledger: evidence.ledger, index: evidence.index, store: evidence.store,
    sufficiency: evidence.sufficiency, plan: subset.plan,
  }, input, options);
  if (finished.status === STATUS.HANDOFF_READY) {
    finished.warnings.push("FICTION core preserved: only targeted factual backbone carries evidence");
  }
  return finished;
}

/** DEEP escalation attempt; leads only, canonical reacquisition. */
async function tryDeepEscalation(result, evidence, input, options) {
  const plan = evidence.plan;
  const suf = evidence.sufficiency;
  const hasProvider = !!(options.deep && typeof options.deep.runProvider === "function");
  const escalationsUsed = (evidence.deepEscalationsUsed || 0);
  const decision = deepLib.decideEscalation({
    contentClass: plan.contentClass,
    researchRequired: plan.researchRequired,
    sufficiencyDecision: suf.decision,
    standardAttempted: true,
    materialGap: Object.keys(suf.gaps || {}).length > 0,
    gapSolvable: input.gapSolvable !== false,
    deepAllowed: input.deepResearchAllowed !== false,
    budgetRemaining: suf.factors.budgetRemaining,
    escalationsUsed,
    maxDeepEscalations: 1,
    providerAvailable: hasProvider,
    blockedCode: null,
    blockerIsDiscoverableGap: true,
    explicitDeepRequest: input.researchMode === "DEEP",
    targetedFactualSubset: false,
    reasonCodes: [],
  });

  if (decision.action !== "ESCALATE_DEEP") {
    const codes = decision.reasonCodes || [];
    if (codes.includes("BUDGET_EXHAUSTED") || codes.includes("MAX_ESCALATIONS_REACHED")) {
      result.status = STATUS.DEEP_BUDGET_EXHAUSTED;
    } else if (codes.includes("PROVIDER_UNAVAILABLE")) {
      // Escalation not attempted: honest stay-standard, not a DEEP failure.
      result.status = STATUS.NEEDS_MORE_RESEARCH;
      result.warnings.push("DEEP provider unavailable; escalation not attempted");
    } else if (decision.action === "BLOCKED" || codes.includes("GAP_NOT_RESEARCH_SOLVABLE")) {
      result.status = STATUS.RESEARCH_BLOCKED;
    } else {
      result.status = STATUS.NEEDS_MORE_RESEARCH;
    }
    result.blockers.push(`DEEP_NOT_ESCALATED: ${codes.join(",") || decision.action}`);
    return result;
  }

  const out = await deepLib.runDeepEscalation({
    escalationInput: {
      contentClass: plan.contentClass,
      researchRequired: plan.researchRequired,
      sufficiencyDecision: suf.decision,
      standardAttempted: true,
      materialGap: true,
      gapSolvable: input.gapSolvable !== false,
      deepAllowed: input.deepResearchAllowed !== false,
      budgetRemaining: suf.factors.budgetRemaining,
      escalationsUsed,
      maxDeepEscalations: 1,
      providerAvailable: hasProvider,
      explicitDeepRequest: input.researchMode === "DEEP",
      targetedFactualSubset: false,
      reasonCodes: [],
    },
    plan,
    gaps: suf.gaps || {},
    sourceIndex: evidence.index,
    sufficiencyBefore: suf,
    requireLiveApproval: options.deep && options.deep.requireLiveApproval,
  }, {
    runProvider: options.deep && options.deep.runProvider,
    acquireUrl: options.deepAcquireUrl || (async (url) => {
      const r = await acquisition.acquireUrl(url, (options.acquireOpts || {}).single || {});
      return { ok: r.ok, document: r.document, url };
    }),
    registerSource: (idx, regInput) => {
      const reg = registryLib.registerSource(idx, regInput);
      if (reg.ok) evidence.bodies[reg.record.sourceId] = regInput.acquiredDocument.rawMarkdown || "";
      return reg;
    },
    // Prompt-03 reintegration: reacquired docs go through the same canonical
    // analysis/ledger/verification owners before the gate reruns.
    evaluateSufficiency: async ({ reacquiredRecords }) => {
      for (const rec of reacquiredRecords) {
        const raw = evidence.bodies[rec.sourceId] || "";
        const built = analysisExchangeLib.createAnalysisRequest({
          sourceId: rec.sourceId,
          contentHash: rec.currentVersionHash || rec.contentHash,
          rawContent: raw,
          fitContent: "",
          // Full question coverage so reacquired evidence merges into the
          // same claim IDs the STANDARD stage created (claims dedupe on
          // text + question ids).
          researchQuestionIds: (plan.criticalQuestions || []).map((_, i) => `q${i}`),
        });
        if (!built.ok) continue;
        const req = built.request;
        let cands = [];
        if (options.analysisExchange) cands = (await options.analysisExchange([req]))[0] || [];
        const norm = analysisExchangeLib.normalizeAnalysisResponse(req, cands);
        if (norm.ok) {
          for (const cand of norm.candidates) {
            ledgerLib.upsertClaim(evidence.ledger, {
              claim: cand.claim,
              claimClass: cand.claimClass,
              evidenceStatus: cand.evidenceStatus,
              materiality: cand.materiality,
              researchQuestionIds: cand.researchQuestionIds || req.researchQuestionIds,
              evidence: [{
                sourceId: req.sourceId,
                contentHash: req.contentHash,
                locator: cand.evidence && cand.evidence[0] ? cand.evidence[0].locator : null,
                excerpt: cand.evidence && cand.evidence[0] ? cand.evidence[0].excerpt : "",
              }],
            }, evidence.index);
          }
        }
      }
      independenceLib.evaluateIndependence(evidence.index.sources, evidence.bodies);
      verificationLib.verifyLedger(evidence.ledger, evidence.index.sources);
      return sufficiencyLib.evaluateSufficiency({
        plan,
        ledger: evidence.ledger,
        records: evidence.index.sources,
        store: evidence.store,
        budgetSpent: { sources: evidence.index.sources.length, queries: (plan.criticalQuestions || []).length },
        now: options.now,
      });
    },
  });

  result.deepEscalated = true;
  result.deepRunStatus = out.deepRunStatus;
  // The facade's evaluateSufficiency dep is async (analyst exchange), while
  // runDeepEscalation treats it as sync; resolve the returned promise here and
  // sanitize the attempt record before persistence.
  const sufficiencyAfter = out.sufficiencyAfter && typeof out.sufficiencyAfter.then === "function"
    ? await out.sufficiencyAfter
    : out.sufficiencyAfter;
  if (out.attemptRecord) {
    out.attemptRecord.sufficiencyAfter = (sufficiencyAfter && sufficiencyAfter.decision) || null;
  }
  if (out.attemptRecord && options.persist !== false) {
    result.artifactRefs.deepAttempt = {
      path: `research/deep-attempts/${out.attemptRecord.attemptId}.json`,
      attemptId: out.attemptRecord.attemptId,
    };
    deepLib.attempts.saveAttempt(projectDir(options.root, plan.projectId), out.attemptRecord);
  }

  if (out.deepRunStatus === "DEEP_LIVE_NOT_APPROVED") {
    result.status = STATUS.DEEP_UNAVAILABLE;
    result.blockers.push("DEEP_LIVE_NOT_APPROVED");
    return result;
  }
  if (out.deepRunStatus === "NOT_RUN" || (out.deepRunStatus !== "DEEP_PARTIAL_OR_SUCCESS" && out.deepRunStatus !== "DEEP_NO_NEW_SOURCES")) {
    result.status = STATUS.DEEP_UNAVAILABLE;
    result.blockers.push(`DEEP_RUN_FAILED: ${out.deepRunStatus}`);
    return result;
  }

  result.sufficiency = sufficiencyAfter && sufficiencyAfter.decision;
  result.sources.registered = evidence.index.sources.length;
  if (sufficiencyAfter && sufficiencyAfter.decision === "SUFFICIENT") {
    evidence.sufficiency = sufficiencyAfter;
    if (options.persist !== false) {
      evidenceStore.persistEvidenceState(options.root, plan.projectId, {
        index: evidence.index, claimsLedger: evidence.ledger,
        contradictionStore: evidence.store, unknownStore: evidence.store,
        sufficiency: sufficiencyAfter,
        brief: input.creativeBrief,
      });
    }
    return buildFactualStory(result, evidence, input, options);
  }
  result.status = STATUS.NEEDS_MORE_RESEARCH;
  result.blockers.push("STILL_INSUFFICIENT_AFTER_DEEP: no Pack, no ready story state");
  return result;
}

/**
 * Main entry. input: canonical planResearch input + editorial/story inputs +
 * hybridLabels/verifiedQuotes/claimFacets/storyContext. options: root,
 * persist, searchExchange, acquireUrls, acquireOpts, analysisExchange, deep,
 * deepAcquireUrl, frameContradictions, maxResultsPerQuery, now.
 */
async function runResearchToStory(input = {}, options = {}) {
  const result = baseResult(input);
  try {
    // 1G.2 advisory only: bounded Creative Memory context is attached to the
    // result for the next Creative Brief / editorial decisions. It never
    // touches the evidence owners below — same factual inputs produce
    // identical evidence truth with or without memory (§7 firewall).
    if (options.creativeMemory && options.creativeMemory.channelId) {
      const cm = creativeMemoryLib.getCreativeMemoryContext(options.root, {
        ...options.creativeMemory,
        projectId: input.projectId,
        contentClass: input.contentClass,
        topicRef: input.topic || null,
      });
      if (cm.ok) result.creativeMemoryContext = cm.context;
      else result.warnings.push(`creative memory unavailable: ${cm.code}`);
    }

    const planned = planLib.planResearch(input);
    if (!planned.ok) return mapPlanFailure(result, planned);
    result.contentClass = planned.contentClass;
    result.researchRequired = planned.researchRequired;

    if (planned.plan) {
      result.researchMode = planned.plan.researchMode || "STANDARD";
      if (options.persist !== false) {
        const saved = planLib.saveResearchPlan(projectDir(options.root, input.projectId), planned.plan);
        if (saved.saved) result.artifactRefs.researchPlan = { path: "research/research-plan.json" };
      }
    }

    if (planned.researchRequired === "NOT_REQUIRED") {
      result.packStatus = "NOT_NEEDED";
      return runPureFiction(result, input, options);
    }
    if (planned.researchRequired === "OPTIONAL_TARGETED") {
      return runTargetedFiction(result, planned, input, options);
    }

    const evidence = await runEvidencePipeline(result, planned.plan, { ...options, creativeBrief: input.creativeBrief });
    if (!evidence) return result;
    result.sufficiency = evidence.sufficiency.decision;

    if (evidence.sufficiency.decision === "SUFFICIENT") {
      return buildFactualStory(result, evidence, input, options);
    }
    if (evidence.sufficiency.decision === "BLOCKED") {
      result.status = STATUS.RESEARCH_BLOCKED;
      result.blockers.push(`SUFFICIENCY_BLOCKED: ${evidence.sufficiency.blocker || "policy blocker"}`);
      return result;
    }
    return await tryDeepEscalation(result, evidence, input, options);
  } catch (e) {
    result.status = STATUS.FAILED;
    result.blockers.push(`UNEXPECTED: ${String((e && e.message) || e)}`);
    return result;
  }
}

/**
 * Staleness check for reuse (E2E-J): compares a persisted Pack against the
 * CURRENT canonical evidence state via the pack owner's own fingerprint.
 * Returns { stale: bool, reason?, staleLayers[] }.
 */
function checkExistingPackStaleness(root, projectId, currentPackInput) {
  const loaded = storyStore.loadStoryFile(root, projectId, storyStore.FILES.packJson);
  if (!loaded.ok || !loaded.doc) return { stale: false, reason: "no existing pack" };
  const pack = loaded.doc;
  const currency = storyStore.checkDownstreamCurrency(pack, currentPackInput);
  if (!currency.current) {
    return { stale: true, reason: currency.reason || "downstream not current", staleLayers: currency.stale || ["pack"] };
  }
  const current = packLib.isPackCurrent(pack, currentPackInput);
  if (!current.current) return { stale: true, reason: current.reason, staleLayers: ["pack", "policy", "narrativeBrief", "draft", "audit"] };
  return { stale: false };
}

module.exports = {
  STATUS,
  FACADE_VERSION,
  runResearchToStory,
  checkExistingPackStaleness,
};
