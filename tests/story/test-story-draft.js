"use strict";

/**
 * FACTUAL Story Draft + audit tests F1-F8 (Prompt 04, 1G.1P + §39).
 * Deterministic fixtures. No network.
 */

const nbLib = require("../../lib/research-story/narrative-brief.js");
const packLib = require("../../lib/research-story/research-pack.js");
const gateLib = require("../../lib/research-story/script-evidence-gate.js");
const draftLib = require("../../lib/research-story/story-draft.js");
const auditLib = require("../../lib/research-story/story-audit.js");
const fx = require("../fixtures/story-fixtures.js");

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

function pipeline(over = {}) {
  const s = fx.factualState();
  const pack = packLib.buildPack({
    projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
    contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
  }).pack;
  const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
  const brief = nbLib.buildNarrativeBrief({
    contentClass: "FACTUAL", contentMode: "technical-explainer", pack, policy,
    brief: { audience: "developers", platform: "youtube" },
    angle: "Method preservation is the whole point of 308.",
    coreViewerQuestion: "Why does 308 exist?",
    mainInsight: "308 removes method-rewrite ambiguity.",
    payoff: "Use 308 when the method must survive.",
    planQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
    hookBasis: { type: "surprising documented fact" },
    ...over,
  }).brief;
  return { s, pack, policy, brief };
}

async function main() {
  console.log("=== FACTUAL STORY DRAFT TESTS (F1-F8) ===\n");

  await runTest("F1 material factual sections carry claimRefs", async () => {
    const { pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy, platform: "youtube" });
    assert(gen.ok, "draft generated through runtime");
    const dev = gen.draft.sections.filter((x) => x.storyFunction === "development");
    assert(dev.length > 0 && dev.every((x) => x.claimRefs.length > 0), "development sections trace to claims");
    assert(/^drf-[0-9a-f]{12}$/.test(gen.draft.draftId), "stable draft id");
    const audit = auditLib.auditStoryDraft(gen.draft, { pack, policy });
    assert(audit.state === "PASS", `clean draft audits PASS (${JSON.stringify(audit.issues)})`);
  });

  await runTest("F2 unsupported new factual assertion -> NEEDS_REVISION", async () => {
    const { pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    gen.sections[1].draftText += " The committee voted 11 to 3 in Geneva in 2019.";
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(audit.state === "NEEDS_REVISION", `invented numbers caught (${audit.issues.map((i) => i.code).join(",")})`);
    assert(!audit.issues.some((i) => i.code === "FABRICATED_QUOTE"), "numbers, not quotes");
  });

  await runTest("F3 certainty escalation -> NEEDS_REVISION", async () => {
    const pack = {
      verifiedFacts: [], primarySourceFacts: [], independentlyCorroboratedFacts: [], derivedContext: [],
      conflictingClaims: [], unverifiedClaims: [],
      sourceRefs: [], unknowns: [], sourceLimitations: [],
    };
    const claimId = "clm-aaaabbbbcccc";
    const policy = {
      gateId: "g", gateVersion: "1.0.0", contentClass: "FACTUAL",
      researchPackRef: {}, generatedAt: new Date().toISOString(),
      allowedClaims: [], forbiddenAsFact: [], disputedClaims: [],
      restrictedClaims: [{ claimId, rule: "APPROX" }],
      requiredAttributions: [], requiredQualifiers: [{ claimId, qualifier: "approximate", level: "must" }],
      fictionalizationBoundaries: [], unknownsToPreserve: [],
    };
    const fakePack = { ...pack, derivedContext: [{ claimId, statement: "Approximately 300000 servers use 308.", sourceIds: ["src-x"], contentHashes: ["h"], evidenceStatus: "SUPPORTED", corroborationStatus: "SINGLE_SOURCE", claimClass: "SUPPORTED_FACT" }] };
    const draft = {
      draftId: "drf-aaaabbbbcccc", contentClass: "FACTUAL", narrativeBriefRef: {},
      sections: [{ sectionId: "s1", purpose: "p", draftText: "300000 servers use 308.", claimRefs: [claimId], classificationRefs: [], requiredAttributionsSatisfied: [], storyFunction: "development" }],
    };
    // Seed the corpus: number 300000 exists in evidence, qualifier dropped.
    const audit = auditLib.auditSection(draft.sections[0], {
      pack: fakePack,
      policy,
      claims: new Map([[claimId, { claimId, statement: "Approximately 300000 servers use 308.", verifiedQuotes: [] }]]),
    });
    assert(audit.some((i) => i.code === "CERTAINTY_ESCALATION"), "dropped approximate qualifier detected");
    assert(!audit.some((i) => i.code === "UNSUPPORTED_STORY_CLAIM"), "number itself is evidenced (isolated qualifier failure)");
  });

  await runTest("F4 missing attribution -> NEEDS_REVISION", async () => {
    const { s } = pipeline();
    // Demote the critical claim to single-source high (as in EG3).
    s.ledger.claims[0].corroborationStatus = "SINGLE_SOURCE";
    s.ledger.claims[0].materiality = "high";
    s.ledger.claims[0].supportingEvidence = [s.ledger.claims[0].supportingEvidence[0]];
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const target = s.ledger.claims[0].claimId;
    assert(policy.requiredAttributions.some((a) => a.claimId === target), "attribution required by gate");
    const brief = nbLib.buildNarrativeBrief({
      contentClass: "FACTUAL", contentMode: "technical-explainer", pack, policy,
      brief: { audience: "d", platform: "youtube" }, angle: "A.", coreViewerQuestion: "Q?",
      mainInsight: "I.", payoff: "P.", planQuestions: ["Q?"],
    }).brief;
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const sec = gen.sections.find((x) => x.claimRefs.includes(target));
    assert(/According to/i.test(sec.draftText), "composer adds attribution by default");
    sec.draftText = sec.draftText.replace(/According to [^,]+, /, "");
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(audit.issues.some((i) => i.code === "MISSING_ATTRIBUTION"), "stripped attribution caught");
  });

  await runTest("F5 fabricated quote -> NEEDS_REVISION (BLOCKED class)", async () => {
    const { pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    gen.sections[1].draftText += ' As the engineer said, "this changes everything forever."';
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(audit.issues.some((i) => i.code === "FABRICATED_QUOTE"), "invented quotation caught");
    assert(audit.state === "BLOCKED", "fabrication blocks, not merely revises");
  });

  await runTest("F6 disputed claim framed correctly", async () => {
    const { s } = pipeline();
    // Add a contested challenger; contradict critical vs challenger, keep the low claim clean.
    const chal = {
      claimId: "clm-ffffffffffff", researchQuestionIds: ["q0"],
      claim: "Some argue 308 rewrites POST to GET.", claimClass: "CONTESTED",
      evidenceStatus: "MIXED", corroborationStatus: "SINGLE_SOURCE",
      materiality: "high",
      supportingEvidence: [{ sourceId: s.index.sources[0].sourceId, contentHash: s.index.sources[0].contentHash, locator: "body", excerpt: "challenger excerpt text" }],
      contradictingEvidence: [],
      confidenceReason: "", needsReevaluation: false, createdAt: new Date().toISOString(),
    };
    s.ledger.claims.push(chal);
    const crit = s.ledger.claims[0].claimId;
    const pack2 = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [{ contradictionId: "ctr-aaaabbbbcccc", claimIds: [crit, chal.claimId], sourceIds: ["x"], description: "d", materiality: "critical", status: "OPEN" }] },
      unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy2 = gateLib.buildEvidencePolicy({ pack: pack2, records: s.index.sources }).policy;
    const brief2 = nbLib.buildNarrativeBrief({
      contentClass: "FACTUAL", contentMode: "technical-explainer", pack: pack2, policy: policy2,
      brief: { audience: "d", platform: "youtube" }, angle: "A.", coreViewerQuestion: "Q?",
      mainInsight: "I.", payoff: "P.", planQuestions: ["Q?"],
    }).brief;
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief2, pack: pack2, policy: policy2 }).draft;
    const audit = auditLib.auditStoryDraft(gen, { pack: pack2, policy: policy2 });
    const disp = audit.issues.filter((i) => i.sectionId && gen.sections.find((x) => x.sectionId === i.sectionId && x.claimRefs.includes(s.ledger.claims[0].claimId)));
    assert(!disp.some((i) => i.code === "UNSUPPORTED_STORY_CLAIM"), "framed dispute is not an orphan assertion");
  });

  await runTest("F7 story order differs from raw source order", async () => {
    const { pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const order = gen.sections.flatMap((x) => x.claimRefs);
    // Sources registered a-then-d; progression follows question order (q0 claims then q1).
    // Editorial requirement: sections follow brief progression stepIds, not acquisition order.
    const steps = gen.sections.map((x) => x.sectionId);
    assert(steps[0] === "hook" && steps[steps.length - 1] === "payoff", `brief-driven order hook->payoff (${steps.join(",")})`);
    assert(order.length > 0, "claims sequenced through progression");
  });

  await runTest("F8 no internal IDs in viewer text", async () => {
    const { pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    for (const s of gen.sections) {
      assert(!/\b(clm|src|pack|ctr|unk)-[0-9a-f]{6,}\b/.test(s.draftText), `clean viewer text in ${s.sectionId}`);
    }
    const md = draftLib.renderDraftMarkdown(gen);
    assert(md.includes("# Story Draft"), "markdown projection renders");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
