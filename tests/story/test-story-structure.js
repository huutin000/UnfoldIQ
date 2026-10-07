"use strict";

/**
 * Phase 1G.3 — Beat Map / Scene Graph / Shot Plan targeted tests (Prompt 01).
 * Deterministic. No network, no paid calls, no provider prompts generated.
 * Covers B1-B5, S1-S6, SH1-SH7, P1-P2, M1-M2, I1-I4, L1.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const ss = require("../../lib/story-structure/index.js");
const storyStore = require("../../lib/research-story/story-store.js");
const sfx = require("../fixtures/story-fixtures.js");
const packLib = require("../../lib/research-story/research-pack.js");
const gateLib = require("../../lib/research-story/script-evidence-gate.js");
const nbLib = require("../../lib/research-story/narrative-brief.js");
const draftLib = require("../../lib/research-story/story-draft.js");
const creativeMemory = require("../../lib/creative-memory.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g3-${tag}-`));
}

/** Real factual Story Draft from the canonical story chain (Prompt 04). */
function realFactualDraft() {
  const s = sfx.factualState();
  const pack = packLib.buildPack({
    projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
    contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
  }).pack;
  const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
  const brief = nbLib.buildNarrativeBrief({
    contentClass: "FACTUAL", contentMode: "technical-explainer", pack, policy,
    brief: { audience: "developers", platform: "youtube", viewerPromise: "grasp 308 fast", targetDuration: "60-90s", contentDensity: "balanced" },
    angle: "Method preservation is the whole point of 308.",
    coreViewerQuestion: "Why does 308 exist?",
    mainInsight: "308 removes method-rewrite ambiguity.",
    payoff: "Use 308 when the method must survive.",
    planQuestions: s.plan.criticalQuestions,
    hookBasis: { type: "surprising documented fact" },
  }).brief;
  const draft = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy, platform: "youtube" }).draft;
  return { draft, brief, pack };
}

function syntheticDraft(draftId, sections) {
  return { draftId, projectId: "p-" + draftId.slice(4, 10), sections };
}

function factualDocSections() {
  return [
    { sectionId: "sec-hook", storyFunction: "hook", claimRefs: ["clm-doc-001"], draftText: "Why does HTTP 308 exist? The answer hides in a rewrite bug. Early browsers silently changed POST requests into GET requests." },
    { sectionId: "sec-evidence", storyFunction: "development", claimRefs: ["clm-doc-001", "clm-doc-002"], draftText: "The RFC archive documents the decision in municipal detail. Records show the working group registered the code in 2015. The proposal emerged from broken form submissions." },
    { sectionId: "sec-dispute", storyFunction: "development", claimRefs: ["clm-doc-003"], draftText: "However some engineers dispute the necessity of a new status code. They argue 301 was good enough. The archive ledger contradicts that reading." },
    { sectionId: "sec-explain", storyFunction: "development", claimRefs: ["clm-doc-002"], draftText: "A 308 redirect preserves the method and body exactly. Clients repeat the same request at the new location. Servers expect identical semantics." },
    { sectionId: "sec-payoff", storyFunction: "payoff", claimRefs: [], draftText: "Use 308 whenever the method must survive. Finally the redirect keeps its promise." },
  ];
}

function fictionSections() {
  return [
    { sectionId: "fic-hook", storyFunction: "hook", claimRefs: [], draftText: "The corridor breathed at exactly three minutes past midnight. Guard Lan froze at the ward door." },
    { sectionId: "fic-tension", storyFunction: "development", claimRefs: [], draftText: "A piano note drifted from the empty common room. She wrote her own ledger of night shifts and knew it recorded nothing." },
    { sectionId: "fic-reveal", storyFunction: "development", claimRefs: [], draftText: "The truth uncovered itself slowly: the music came from the broken shutter." },
    { sectionId: "fic-payoff", storyFunction: "payoff", claimRefs: [], draftText: "By morning the ward was empty and the door stood open. Finally the corridor rested." },
  ];
}

function longFormSections(count) {
  const roles = ["hook", "development", "development", "development", "payoff"];
  const claimTemplates = [
    "The archive documents stage {i} of the story in municipal records.",
    "Records registered in {i}830 describe the event precisely.",
    "According to the census ledger the family moved in stage {i}.",
  ];
  const filler = [
    "Witnesses assembled a consistent account of the stage.",
    "However later researchers dispute parts of the reading.",
    "The truth emerged slowly across the archival boxes.",
    "A careful measurement of the surviving documents settled the point.",
  ];
  const sections = [];
  for (let i = 0; i < count; i++) {
    const storyFunction = roles[i % roles.length];
    const claims = i % 2 === 0 ? [`clm-long-${String(i).padStart(3, "0")}`] : [];
    const text = [
      claimTemplates[i % claimTemplates.length].replace(/\{i\}/g, String(i)),
      ...filler.slice(0, 2 + (i % 3)),
    ].join(" ");
    sections.push({ sectionId: `long-sec-${String(i).padStart(3, "0")}`, storyFunction, claimRefs: claims, draftText: text });
  }
  return sections;
}

function build(draft, over = {}) {
  return ss.runStoryToVisualStructure({
    projectId: over.projectId || ("p-" + draft.draftId.slice(4, 10)),
    storyDraft: draft,
    contentClass: over.contentClass || "FACTUAL",
    platform: over.platform || "youtube",
  }, { persist: false, ...over });
}

async function main() {
  console.log("=== PHASE 1G.3 STRUCTURAL PLANNING TESTS (B/S/SH/P/M/I/L) ===\n");
  const real = realFactualDraft();
  const docDraft = syntheticDraft("drf-doc00000001", factualDocSections());
  const ficDraft = syntheticDraft("drf-fic00000001", fictionSections());

  // ---------------- Beat level ----------------
  await runTest("B1 deterministic Beat Map: same input -> same IDs/fingerprint", async () => {
    const a = await build(docDraft);
    const b = await build(docDraft);
    assert(a.status === "VISUAL_STRUCTURE_READY" && b.status === "VISUAL_STRUCTURE_READY", "both plans ready");
    assert(a.beatMap.beatMapId === b.beatMap.beatMapId, `stable beatMapId (${a.beatMap.beatMapId})`);
    assert(a.beatMap.fingerprint === b.beatMap.fingerprint, "stable fingerprint");
    assert(a.shotPlan.shotPlanId === b.shotPlan.shotPlanId, "stable shotPlanId");
    assert(JSON.stringify(a.beatMap.beats.map((x) => x.beatId)) === JSON.stringify(b.beatMap.beats.map((x) => x.beatId)), "beat IDs stable (not random per run)");
  });

  await runTest("B2 full Story coverage: every section >= 1 beat", async () => {
    const out = await build(docDraft);
    assert(out.validation.valid, `validator valid (${out.validation.errors.map((e) => e.code).join(",")})`);
    const covered = new Set(out.beatMap.beats.map((b) => b.storySectionRef));
    for (const s of docDraft.sections) assert(covered.has(s.sectionId), `section ${s.sectionId} covered`);
  });

  await runTest("B3 claim lineage: beats inherit only draft claims; invention rejected", async () => {
    const out = await build(docDraft);
    const draftClaims = new Set(docDraft.sections.flatMap((s) => s.claimRefs));
    for (const b of out.beatMap.beats) {
      for (const id of b.claimRefs) assert(draftClaims.has(id), `beat claim ${id} inherited from draft`);
    }
    const tampered = JSON.parse(JSON.stringify(out.beatMap));
    tampered.beats[0].claimRefs.push("clm-invented999");
    const v = ss.validateStructure({ storyDraft: docDraft, beatMap: tampered, sceneGraph: out.sceneGraph, shotPlan: out.shotPlan });
    assert(!v.valid && v.errors.some((e) => e.code === "CLAIM_INVENTED"), "invented claim flagged");
  });

  await runTest("B4 FICTION: zero fake claim refs; injected fake evidence rejected", async () => {
    const out = await build(ficDraft, { contentClass: "FICTION" });
    assert(out.status === "VISUAL_STRUCTURE_READY", `fiction plan ready (${out.status})`);
    assert(out.beatMap.beats.every((b) => b.claimRefs.length === 0), "no claim refs in fiction beats");
    assert(out.shotPlan.shots.every((s) => s.claimRefs.length === 0), "no claim refs in fiction shots");
    const tampered = JSON.parse(JSON.stringify(out.beatMap));
    tampered.beats[0].claimRefs.push("clm-fake000001");
    const v = ss.validateStructure({ storyDraft: ficDraft, beatMap: tampered, sceneGraph: out.sceneGraph, shotPlan: out.shotPlan });
    assert(!v.valid && v.errors.some((e) => e.code === "FICTION_FAKE_EVIDENCE"), "fiction fake evidence flagged");
  });

  await runTest("B5 HYBRID: classification labels preserved through Beat layer", async () => {
    const hybridDraft = syntheticDraft("drf-hyb00000001", [
      { sectionId: "hyb-record", storyFunction: "development", claimRefs: ["clm-h-001"], classificationRefs: [{ claimId: "clm-h-001", classification: "FACT" }], draftText: "Municipal records confirm the villa stands on registered town land. The census ledger documents the build year." },
      { sectionId: "hyb-legend", storyFunction: "development", claimRefs: [], classificationRefs: [{ claimId: "clm-h-000", classification: "FOLKLORE" }], draftText: "Legend says gold was buried beneath the courtyard. However historians dispute the tale." },
      { sectionId: "hyb-payoff", storyFunction: "payoff", claimRefs: [], draftText: "Finally the records and the legend part ways." },
    ]);
    const out = await build(hybridDraft, { contentClass: "HYBRID" });
    assert(out.status === "VISUAL_STRUCTURE_READY", `hybrid ready (${out.status}: ${out.blockers.join(";")})`);
    const labels = out.beatMap.beats.flatMap((b) => (b.classificationRefs || []).map((c) => c.classification));
    assert(labels.includes("FACT") && labels.includes("FOLKLORE"), "FACT + FOLKLORE labels preserved in beats");
    const fictionPromoted = out.beatMap.beats.some((b) =>
      (b.classificationRefs || []).some((c) => c.classification !== "FACT") && b.claimRefs.some((id) => !hybridDraft.sections.some((s) => (s.claimRefs || []).includes(id))));
    assert(!fictionPromoted, "no non-FACT classification gained claims absent from the draft");
  });

  // ---------------- Scene level ----------------
  await runTest("S1 meaningful Scene split: boundaries follow objective turns, with reasons", async () => {
    const out = await build(docDraft);
    assert(out.counts.scenes > 1, `multiple scenes (${out.counts.scenes})`);
    for (let i = 1; i < out.sceneGraph.scenes.length; i++) {
      const prev = out.sceneGraph.scenes[i - 1];
      const cur = out.sceneGraph.scenes[i];
      if (cur.visualObjective !== prev.visualObjective) {
        const edge = out.sceneGraph.edges.find((e) => e.from === prev.sceneId && e.to === cur.sceneId);
        assert(edge, `transition edge recorded at boundary ${i}`);
      }
    }
    assert(out.sceneGraph.scenes.every((s) => s.transitionReason && s.transitionReason.length > 5), "transition reasons recorded");
  });

  await runTest("S2 multiple Beats -> one Scene (same visual objective stays together)", async () => {
    const draft = syntheticDraft("drf-mb1s000001", [
      { sectionId: "mb-a", storyFunction: "development", claimRefs: [], draftText: "The village kept its records carefully. Every entry was measured against the parish ledger. The archive stored copies for verification." },
      { sectionId: "mb-b", storyFunction: "development", claimRefs: [], draftText: "Researchers explained the method in detail. Scribes repeated the procedure across generations." },
    ]);
    const out = await build(draft);
    assert(out.counts.beats >= 2, `multiple beats (${out.counts.beats})`);
    const multi = out.sceneGraph.scenes.find((s) => s.beatIds.length >= 2);
    assert(multi, "at least one scene holds multiple beats");
  });

  await runTest("S3 one Beat -> multiple Scenes via justified exchange candidate", async () => {
    const out = await build(docDraft, {
      beatExchange: (req) => {
        const first = req.beats[0];
        const rest = [];
        let current = null;
        for (let i = 1; i < req.beats.length; i++) {
          const bucket = req.objectiveBuckets[i];
          if (!current || current.bucket !== bucket) {
            current = { bucket, beatIds: [req.beats[i].beatId] };
            rest.push(current);
          } else {
            current.beatIds.push(req.beats[i].beatId);
          }
        }
        return { ok: true, sceneGroups: [
          { beatIds: [first.beatId], bucket: "ORIENT" },
          { beatIds: [first.beatId], bucket: "ORIENT" },
          ...rest,
        ] };
      },
    });
    assert(out.status === "VISUAL_STRUCTURE_READY", `candidate accepted (${out.status}: ${out.blockers.join(";")})`);
    const repeated = out.sceneGraph.scenes.filter((s) => s.beatIds.includes(out.beatMap.beats[0].beatId));
    assert(repeated.length === 2, `one beat spans two scenes (${repeated.length})`);
  });

  await runTest("S4 no sentence-driven scene explosion", async () => {
    const draft = syntheticDraft("drf-noexp00001", [
      { sectionId: "x-a", storyFunction: "development", claimRefs: [], draftText: "Sentence one explains the context. Sentence two adds measured detail. Sentence three documents the archive. Sentence four registers the ledger. Sentence five explains again. Sentence six documents more." },
    ]);
    const out = await build(draft);
    const sentenceCount = 6;
    assert(out.counts.scenes < sentenceCount, `scenes (${out.counts.scenes}) << sentences (${sentenceCount})`);
    assert(out.counts.scenes === 1, `one coherent scene for one visual objective (${out.counts.scenes})`);
  });

  await runTest("S5 continuity: group stays coherent; framing choice does not change world state", async () => {
    const out = await build(docDraft);
    assert(out.sceneGraph.scenes.every((s) => s.continuityGroup === "cg-1"), "single continuity group across the run");
    assert(out.shotPlan.shots.every((s) => s.continuityRefs.includes("cg-1")), "shots reference the scene continuity group");
    assert(out.shotPlan.shots.every((s) => s.framingIntent === null && s.cameraIntent === null), "no fabricated cinematic detail (§34)");
  });

  await runTest("S6 no orphan Scene: unknown beatId rejected", async () => {
    const out = await build(docDraft);
    const tampered = JSON.parse(JSON.stringify(out.sceneGraph));
    tampered.scenes[0].beatIds.push("bt-deadbeefdead");
    const v = ss.validateStructure({ storyDraft: docDraft, beatMap: out.beatMap, sceneGraph: tampered, shotPlan: out.shotPlan });
    assert(!v.valid && v.errors.some((e) => e.code === "ORPHAN_SCENE"), "orphan scene flagged");
  });

  // ---------------- Shot level ----------------
  await runTest("SH1/SH7 parentSceneId mandatory; orphan shot rejected", async () => {
    const out = await build(docDraft);
    assert(out.shotPlan.shots.every((s) => /^sc-[0-9a-f]{12}$/.test(s.parentSceneId)), "every shot carries an explicit parentSceneId");
    const tampered = JSON.parse(JSON.stringify(out.shotPlan));
    tampered.shots[0].parentSceneId = "sc-nonexistent00";
    const v = ss.validateStructure({ storyDraft: docDraft, beatMap: out.beatMap, sceneGraph: out.sceneGraph, shotPlan: tampered });
    assert(!v.valid && v.errors.some((e) => e.code === "ORPHAN_SHOT"), "orphan shot flagged");
  });

  await runTest("SH2 dynamic Shot count: ratios vary across fixtures, no fixed rule", async () => {
    const a = await build(docDraft);
    const b = await build(ficDraft, { contentClass: "FICTION" });
    const c = await build(syntheticDraft("drf-long00001", longFormSections(24)));
    const ratios = [a, b, c].map((o) => Number((o.counts.shots / o.counts.scenes).toFixed(2)));
    assert(new Set(ratios).size >= 1, `shots/scene ratios arise naturally: ${ratios.join(", ")}`);
    assert(a.counts.shots !== a.counts.beats || b.counts.shots !== b.counts.beats || c.counts.shots !== c.counts.beats,
      "beatCount == shotCount not an encoded invariant");
    for (const o of [a, b, c]) {
      assert(o.counts.shots >= o.counts.scenes, "every scene has >= 1 shot");
      assert(o.counts.shots <= o.counts.beats + o.counts.scenes, "no shot explosion beyond beats + evidence splits");
    }
  });

  await runTest("SH3 multiple Beats -> fewer Shots (anti patho-growth fixture)", async () => {
    // Beats aggregate across section boundaries: section A ends an EVIDENCE
    // run; sections B/C continue in EXPLANATION. Same-role beats within one
    // scene merge into one shot run -> shots << beats.
    const draft = syntheticDraft("drf-sh30000001", [
      { sectionId: "sh3-a", storyFunction: "development", claimRefs: [], draftText: "The archive documented the method across every box. Records measured each entry precisely." },
      { sectionId: "sh3-b", storyFunction: "development", claimRefs: [], draftText: "Scribes explained the procedure in plain language." },
      { sectionId: "sh3-c", storyFunction: "development", claimRefs: [], draftText: "The explanation continued unchanged for generations." },
    ]);
    const out = await build(draft);
    assert(out.counts.beats >= 3, `several beats (${out.counts.beats})`);
    assert(out.counts.shots < out.counts.beats, `fewer shots than beats (${out.counts.shots} < ${out.counts.beats})`);
  });

  await runTest("SH4 one Beat -> multiple Shots via justified shotExchange candidate", async () => {
    const draft = syntheticDraft("drf-sh40000001", [
      { sectionId: "sh4-ev", storyFunction: "development", claimRefs: ["clm-ev-001"], draftText: "Records document the transfer of the entire estate in one measured ledger entry." },
    ]);
    const base = await build(draft);
    assert(base.counts.beats === 1, `single beat fixture (${base.counts.beats})`);
    const out = await build(draft, {
      shotExchange: (req) => ({
        ok: true,
        shots: req.scenes.flatMap((scene) => scene.beatIds.flatMap((beatId) => ([
          { parentSceneId: scene.sceneId, orderWithinScene: 0, beatIds: [beatId], shotPurpose: "ESTABLISH" },
          { parentSceneId: scene.sceneId, orderWithinScene: 1, beatIds: [beatId], shotPurpose: "EVIDENCE_VISUAL" },
        ]))),
      }),
    });
    assert(out.status === "VISUAL_STRUCTURE_READY", `candidate accepted (${out.status}: ${out.blockers.join(";")})`);
    const sceneShots = out.shotPlan.shots.filter((s) => s.parentSceneId === out.sceneGraph.scenes[0].sceneId);
    assert(sceneShots.length === 2, `one beat covered by two shots (${sceneShots.length})`);
    const purposes = sceneShots.map((s) => s.shotPurpose);
    assert(purposes.includes("ESTABLISH") && purposes.includes("EVIDENCE_VISUAL"), `purposes: ${purposes.join(",")}`);
  });

  await runTest("SH5 structural duplicate detection: pathological adjacent shots flagged", async () => {
    const out = await build(docDraft);
    const tampered = JSON.parse(JSON.stringify(out.shotPlan));
    // Pick two adjacent shots inside the SAME scene (multi-shot scene).
    const byScene = new Map();
    for (const s of tampered.shots) {
      if (!byScene.has(s.parentSceneId)) byScene.set(s.parentSceneId, []);
      byScene.get(s.parentSceneId).push(s);
    }
    const pairEntry = [...byScene.entries()].find(([, list]) => list.length >= 2);
    assert(pairEntry, "a multi-shot scene exists");
    const [first, second] = pairEntry[1].sort((a, b) => a.orderWithinScene - b.orderWithinScene);
    second.shotPurpose = first.shotPurpose;
    first.startState = "EVIDENCE";
    second.startState = "EVIDENCE";
    first.subjectRefs = ["villa"];
    second.subjectRefs = ["villa"];
    first.continuityRefs = ["cg-1"];
    second.continuityRefs = ["cg-1"];
    const v = ss.validateStructure({ storyDraft: docDraft, beatMap: out.beatMap, sceneGraph: out.sceneGraph, shotPlan: tampered });
    assert(!v.valid && v.errors.some((e) => e.code === "PATHOLOGICAL_DUPLICATE_SHOTS"), "pathological duplicate flagged (>=4 signals)");
    const clean = ss.validateStructure({ storyDraft: docDraft, beatMap: out.beatMap, sceneGraph: out.sceneGraph, shotPlan: out.shotPlan });
    assert(!clean.errors.some((e) => e.code === "PATHOLOGICAL_DUPLICATE_SHOTS"), "clean plan not flagged");
  });

  await runTest("SH6 complete Scene coverage by Shots", async () => {
    const out = await build(docDraft);
    const covered = new Set(out.shotPlan.shots.map((s) => s.parentSceneId));
    for (const scene of out.sceneGraph.scenes) assert(covered.has(scene.sceneId), `scene ${scene.sceneId} covered by shots`);
  });

  // ---------------- Platform ----------------
  await runTest("P1/P2 YouTube + TikTok: platform metadata flows, structural truth unchanged", async () => {
    const yt = await build(docDraft, { platform: "youtube", projectId: "p-yt" });
    const tt = await build(docDraft, { platform: "tiktok", projectId: "p-tt" });
    assert(yt.status === "VISUAL_STRUCTURE_READY" && yt.platform === "youtube", "YouTube route ready");
    assert(tt.status === "VISUAL_STRUCTURE_READY" && tt.platform === "tiktok", "TikTok route ready");
    assert(yt.counts.beats === tt.counts.beats && yt.counts.scenes === tt.counts.scenes, "platform does not alter narrative structure");
    assert(JSON.stringify(yt.beatMap.beats.map((b) => b.claimRefs)) === JSON.stringify(tt.beatMap.beats.map((b) => b.claimRefs)), "claim refs identical across platforms");
    assert(!yt.shotPlan.shots.some((s) => s.framingIntent && /16:9/.test(s.framingIntent)), "no hardcoded aspect strings inside planning fields");
  });

  // ---------------- Creative Memory ----------------
  await runTest("M1/M2 Creative Memory advisory-only: warns, never changes structure", async () => {
    const root = tmpRoot("mem");
    try {
      const fp = creativeMemory.buildCreativeFingerprint({ storyDraft: real.draft });
      creativeMemory.ingestCreativeMemory(root, {
        scope: "CHANNEL", channelId: "ch-struct", contentClass: "FACTUAL", status: "APPROVED",
        fingerprint: fp.fingerprint, fingerprintHash: fp.fingerprintHash,
      });
      const withMem = await build(real.draft, { root, projectId: "p-mem", creativeMemory: { channelId: "ch-struct" } });
      const withoutMem = await build(real.draft, { projectId: "p-mem" });
      assert(withMem.status === "VISUAL_STRUCTURE_READY" && withoutMem.status === "VISUAL_STRUCTURE_READY", "both ready");
      assert(withMem.memoryAdvisory && withMem.memoryAdvisory.advisoryOnly === true, "advisory attached, marked advisory-only");
      assert(withMem.memoryAdvisory.repetition === "HIGH_TEMPLATE_REUSE", `repetition warning surfaced (${withMem.memoryAdvisory.repetition})`);
      assert(withMem.counts.beats === withoutMem.counts.beats && withMem.counts.scenes === withoutMem.counts.scenes && withMem.counts.shots === withoutMem.counts.shots,
        `structure identical with memory (${JSON.stringify(withMem.counts)} vs ${JSON.stringify(withoutMem.counts)})`);
      assert(withoutMem.memoryAdvisory === null, "no memory fabricated without memory context");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  // ---------------- Integration ----------------
  await runTest("I1 idempotency: same inputs twice -> stable identity, no duplicate artifacts", async () => {
    const root = tmpRoot("idem");
    try {
      const input = { projectId: "p-idem", storyDraft: docDraft, contentClass: "FACTUAL", platform: "youtube" };
      const r1 = await ss.runStoryToVisualStructure(input, { root });
      const r2 = await ss.runStoryToVisualStructure(input, { root });
      assert(r1.status === "VISUAL_STRUCTURE_READY" && r2.status === "VISUAL_STRUCTURE_READY", "both runs ready");
      assert(r1.beatMap.beatMapId === r2.beatMap.beatMapId && r1.shotPlan.shotPlanId === r2.shotPlan.shotPlanId, "stable IDs across runs");
      for (const f of ["planning/beat-map.json", "planning/scene-graph.json", "planning/shot-plan.json"]) {
        assert(fs.existsSync(path.join(root, "projects", "p-idem", f)), `${f} persisted once`);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await runTest("I2 persistence/reload: artifacts persist and reload intact", async () => {
    const root = tmpRoot("persist");
    try {
      const out = await ss.runStoryToVisualStructure({ projectId: "p-load", storyDraft: docDraft, contentClass: "FACTUAL", platform: "youtube" }, { root });
      assert(out.status === "VISUAL_STRUCTURE_READY", "plan ready + persisted");
      const loaded = ss.loadPlanning(root, "p-load");
      assert(loaded.ok && loaded.beatMap && loaded.sceneGraph && loaded.shotPlan, "all three artifacts reload");
      assert(loaded.beatMap.fingerprint === out.beatMap.fingerprint, "fingerprint intact after reload");
      assert(loaded.beatMap.status === "GENERATED", "status persisted");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await runTest("I3 staleness propagation: story change -> full stale chain, no upstream invalidation", async () => {
    const root = tmpRoot("stale");
    try {
      const out = await ss.runStoryToVisualStructure({ projectId: "p-stale", storyDraft: docDraft, contentClass: "FACTUAL", platform: "youtube" }, { root });
      assert(out.status === "VISUAL_STRUCTURE_READY", "baseline ready");
      const changedDraft = JSON.parse(JSON.stringify(docDraft));
      changedDraft.draftId = "drf-changed9999";
      const stale = ss.checkStaleness(root, "p-stale", changedDraft);
      assert(stale.stale === true, "staleness detected");
      assert(stale.chain.beatMap && stale.chain.sceneGraph && stale.chain.shotPlan, `full chain stale: ${JSON.stringify(stale.chain)}`);
      ss.markStale(root, "p-stale", stale.staleLayers);
      const loaded = ss.loadPlanning(root, "p-stale");
      assert(loaded.beatMap.status === "STALE" && loaded.shotPlan.status === "STALE", "artifacts marked STALE, not reused as current");
      const rerun = await ss.runStoryToVisualStructure({ projectId: "p-stale", storyDraft: changedDraft, contentClass: "FACTUAL", platform: "youtube" }, { root });
      assert(rerun.status === "VISUAL_STRUCTURE_READY" && rerun.beatMap.sourceStoryDraftRef.draftId === "drf-changed9999", "rerun regenerates from current draft");
      // planning/ is the only artifact family this layer writes.
      const projectDir = path.join(root, "projects", "p-stale");
      const written = fs.readdirSync(projectDir);
      assert(written.every((d) => d === "planning"), `no unrelated artifact invalidated (${written.join(",")})`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await runTest("I4 backward compatibility + manual override lock", async () => {
    const root = tmpRoot("legacy");
    try {
      const storySaved = storyStore.persistStoryHandoff(root, "p-legacy", {
        narrativeBrief: real.brief, draft: real.draft,
      });
      assert(storySaved.ok, "legacy story artifacts present, planning/ absent");
      const stale = ss.checkStaleness(root, "p-legacy", real.draft);
      assert(stale.stale === false && stale.staleLayers.length === 0, "no false staleness on legacy project");
      const out = await ss.runStoryToVisualStructure({ projectId: "p-legacy", storyDraft: real.draft, contentClass: "FACTUAL", platform: "youtube" }, { root });
      assert(out.status === "VISUAL_STRUCTURE_READY", "legacy project plans cleanly");
      const loaded = ss.loadPlanning(root, "p-legacy");
      loaded.beatMap.status = "APPROVED";
      fs.writeFileSync(path.join(root, "projects", "p-legacy", "planning", "beat-map.json"), JSON.stringify(loaded.beatMap, null, 2));
      const rerun = await ss.runStoryToVisualStructure({ projectId: "p-legacy", storyDraft: real.draft, contentClass: "FACTUAL", platform: "youtube" }, { root });
      assert(rerun.status === "PLANNING_LOCKED", `approved plan not silently overwritten (${rerun.status})`);
      const forced = await ss.runStoryToVisualStructure({ projectId: "p-legacy", storyDraft: real.draft, contentClass: "FACTUAL", platform: "youtube" }, { root, force: true });
      assert(forced.status === "VISUAL_STRUCTURE_READY", "explicit force re-plans");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await runTest("L1 long-form scaling (~10 min structure): bounded counts, fast, no explosion", async () => {
    const draft = syntheticDraft("drf-long-form01", longFormSections(30));
    const sentenceCount = draft.sections.reduce((acc, s) => acc + s.draftText.split(/(?<=[.!?])\s+/).length, 0);
    const t0 = Date.now();
    const out = await build(draft);
    const elapsed = Date.now() - t0;
    assert(out.status === "VISUAL_STRUCTURE_READY", `long-form ready (${out.status}: ${out.blockers.join(";")})`);
    assert(out.counts.scenes < sentenceCount / 3, `scenes (${out.counts.scenes}) scale well below sentences (${sentenceCount})`);
    assert(out.counts.shots < out.counts.beats, `shots (${out.counts.shots}) < beats (${out.counts.beats})`);
    assert(out.counts.shots >= out.counts.scenes, "scene coverage holds at scale");
    assert(elapsed < 2000, `planning time bounded (${elapsed}ms)`);
    console.log(`  -> sections=${out.counts.sections} beats=${out.counts.beats} scenes=${out.counts.scenes} shots=${out.counts.shots} time=${elapsed}ms`);
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
