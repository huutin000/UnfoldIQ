"use strict";

/** Phase 6A §8–§14 Hook System — Cases A–E + class awareness (RULE 3/4/5). */

const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/hook");
const has = (a, code) => a.findings.some((f) => f.code === code && f.status === "OPEN");
const get = (a, code) => a.findings.find((f) => f.code === code);

runTest("Case A — strong opening: 5s/15s/30s checkpoints PASS with structured evidence, no opaque score", () => {
  const a = fx.analyze(fx.baseRaw());
  assertEq(a.hookReport.checkpoints.map((c) => c.checkpoint), ["HOOK_5S", "HOOK_15S", "HOOK_30S"], "three checkpoints");
  assertEq(a.hookReport.checkpoints.map((c) => c.verdict), ["PASS", "PASS", "PASS"], "all PASS");
  for (const c of a.hookReport.checkpoints) {
    for (const k of ["subject", "valueDelivered", "curiosity", "setupOnlyMs", "informationProgress", "promiseDelivery", "deadTimeRiskMs", "reason", "evidenceRefs", "checkpointId"]) assert(k in c, `${c.checkpoint} has ${k}`);
    assert(!("score" in c) && !("retention" in c), `${c.checkpoint} carries no opaque score`);
  }
  assertEq(a.hookReport.checkpoints[0].checkpointId, "creative-validation:HOOK_5S", "stable checkpoint id");
  assertEq(a.hookReport.checkpoints[0].subject.via, "PACKAGING_TERMS", "subject established via the packaging promise");
  assert(a.hookReport.metrics.groundedExternally.HOOK_30S.includes("YouTube"), "only the 30s checkpoint is externally grounded (RULE 3)");
  assert(!("HOOK_5S" in a.hookReport.metrics.groundedExternally) && !("HOOK_15S" in a.hookReport.metrics.groundedExternally), "5s/15s are UNFOLDIQ internal checkpoints");
});

runTest("Case B — unnecessary branding/preamble detected (BRAND_PREAMBLE) and classified as OPENING_EDIT", () => {
  const raw = fx.mini({
    beats: [
      ["b1", "BRAND_INTRO", 0, 6500, "Welcome back to the channel everyone, before we start please like and subscribe."],
      ["b2", "HOOK", 6500, 20000, "Early humans had to keep babies safe at night from predators prowling in the dark beyond the fire."],
      ["b3", "EXPLANATION", 20000, 40000, "Archaeologists found hearths and rock shelters where families slept together in tight groups."],
      ["b4", "PAYOFF", 40000, 60000, "So fire, shelter and watchful adults formed a system that protected the young."],
    ],
  });
  const a = fx.analyze(raw);
  const f = get(a, "HOOK_SETUP_TOO_LONG");
  assert(f, "HOOK_SETUP_TOO_LONG present");
  assertEq(f.reasonClass, "BRAND_PREAMBLE", "reason class BRAND_PREAMBLE");
  assertEq(f.repairClass, "OPENING_EDIT", "repair class OPENING_EDIT");
  assert(f.evidenceRefs.length > 0 && f.correctiveAction, "actionable: evidence + corrective action");
});

runTest("Case C — packaging promise delayed past 30s (P1) vs merely late within 30s (P3); never fabricated", () => {
  const delayed = fx.analyze(fx.GOLDEN.find((g) => g.name === "delayed-hook").build());
  const f = get(delayed, "PACKAGING_PROMISE_DELAYED");
  assert(f && f.severity === "P1" && f.scope === "PACKAGING", "PACKAGING_PROMISE_DELAYED is a P1 PACKAGING finding");
  assert(/first delivered at \d+(\.\d)?s/.test(f.reason), "reason states WHEN the promise is actually delivered: " + f.reason);
  const late = fx.analyze(fx.mini({
    beats: [
      ["b1", "SETUP", 0, 16000, "Archaeologists have studied shelter sites across Africa and Europe for more than a century, cataloguing hearths, bones and stone tools in careful detail."],
      ["b2", "EXPLANATION", 16000, 34000, "At these places early humans protected babies and kept them safe at night using fire and shelter."],
      ["b3", "PAYOFF", 34000, 60000, "So the answer was a system of fire, shelter and watchful adults."],
    ],
  }));
  assert(has(late, "HOOK_PROMISE_DELAYED") && !has(late, "PACKAGING_PROMISE_DELAYED"), "promise established at ~16–30s => P3 HOOK_PROMISE_DELAYED only");
  assertEq(get(late, "HOOK_PROMISE_DELAYED").severity, "P3", "late-but-within-30s is P3");
});

runTest("Case D — calm documentary hook PASSES (no shouting / rapid cuts / clickbait required)", () => {
  const a = fx.analyze(fx.mini({
    contentMode: "historical-documentary",
    packaging: { openingMustEstablish: ["early humans", "babies"], titleText: "How Early Humans Kept Babies Safe at Night" },
    beats: [
      ["b1", "HOOK", 0, 14000, "A cold wind moved across the valley floor. Somewhere beyond the firelight, early humans listened for the footsteps of predators while the babies slept close."],
      ["b2", "EXPLANATION", 14000, 34000, "Shelter sites in the region preserve rings of ash, flat sleeping floors and the bones of the animals that once hunted there."],
      ["b3", "EVIDENCE", 34000, 54000, "Tracks stop at the edge of the ash, which suggests the fire marked a boundary that hunters respected."],
      ["b4", "PAYOFF", 54000, 74000, "Fire, shelter and watchfulness together explain how the youngest survived the dark."],
    ],
  }));
  assertEq(a.hookReport.hookClass, "DOCUMENTARY", "resolved to the DOCUMENTARY class");
  assertEq(a.hookReport.checkpoints.map((c) => c.verdict).filter((v) => v === "FAIL").length, 0, "no checkpoint fails");
  assert(!a.findings.some((f) => f.scope === "HOOK" && ["P1", "P2"].includes(f.severity)), "no P1/P2 hook finding on a calm hook: " + a.findings.map((f) => f.code));
  assert(a.input.shots.every((s) => s.isStatic), "fixture really has no rapid cuts / motion");
});

runTest("Case E — overloaded hook (density) flagged with measured evidence", () => {
  const a = fx.analyze(fx.mini({
    beats: [
      ["b1", "HOOK", 0, 4500, "Early humans faced predators, storms, famine, disease, exhaustion, injuries, rivals, floods, wildfires and babies who needed constant protection every single night."],
      ["b2", "EXPLANATION", 4500, 30000, "Archaeologists studying shelter sites found families sleeping in tight groups beside rock walls."],
      ["b3", "PAYOFF", 30000, 60000, "So fire, shelter and watchful adults formed a system."],
    ],
  }));
  const f = get(a, "HOOK_OVERLOADED");
  assert(f, "HOOK_OVERLOADED present");
  assert(/words\/s/.test(f.reason) && f.checkpoints.includes("HOOK_5S"), "measured density evidence on the 5s checkpoint");
});

runTest("Additional hook findings: repeats-packaging, confusing, early payoff, too many open loops", () => {
  const echo = fx.analyze(fx.mini({
    beats: [["b1", "HOOK", 0, 6000, "How early humans kept babies safe at night."], ["b2", "EXPLANATION", 6000, 40000, "Archaeologists studying shelter sites found rings of ash and sleeping floors."], ["b3", "PAYOFF", 40000, 60000, "So fire and watchfulness explain it."]],
  }));
  assert(has(echo, "HOOK_REPEATS_PACKAGING"), "title echo detected");
  const confusing = fx.analyze(fx.mini({
    packaging: { titleText: "A Mystery in the Valley", openingMustEstablish: [] },
    beats: [["b1", "HOOK", 0, 8000, "This is what they did. It was always done the same way."], ["b2", "EXPLANATION", 8000, 40000, "Archaeologists studying shelter sites found rings of ash and sleeping floors."], ["b3", "PAYOFF", 40000, 60000, "So fire and watchfulness explain it."]],
  }));
  assert(has(confusing, "HOOK_CONFUSING"), "pronoun-led, subject-less opening is confusing");
  const early = fx.analyze(fx.mini({
    durationMs: 90000,
    beats: [["b1", "HOOK", 0, 6000, "Early humans kept babies safe at night using fire."], ["b2", "PAYOFF", 6000, 12000, "The answer: fire, shelter and watchful adults protected the young."], ["b3", "EXPLANATION", 12000, 90000, "Archaeologists studying shelter sites found rings of ash and sleeping floors and bones of hunters."]],
  }));
  assert(has(early, "HOOK_PAYOFF_GIVEN_TOO_EARLY"), "main payoff spent in the first 15s of a 90s video");
  const loops = fx.analyze(fx.mini({
    beats: [["b1", "HOOK", 0, 7000, "Why did predators avoid the camp? What did the adults do? Where did babies sleep? Who kept watch? How long did it last?"], ["b2", "EXPLANATION", 7000, 40000, "Archaeologists studying shelter sites found rings of ash and sleeping floors."], ["b3", "PAYOFF", 40000, 60000, "So fire and watchfulness explain it."]],
  }));
  assert(has(loops, "HOOK_TOO_MANY_OPEN_LOOPS") || loops.beatReport.openLoops.length >= 1, "multiple open loops tracked");
});

runTest("Content-class-aware rules: same text, different class => different expectations (no universal formula)", () => {
  const delayedRaw = fx.GOLDEN.find((g) => g.name === "delayed-hook").build();
  const explainer = fx.analyze(delayedRaw);
  assert(has(explainer, "HOOK_NO_FORWARD_QUESTION"), "EXPLAINER expects a forward question");
  const tut = fx.clone(delayedRaw);
  tut.contentMode = "tutorial";
  const tutorial = fx.analyze(tut);
  assertEq(tutorial.hookReport.hookClass, "TUTORIAL", "TUTORIAL class");
  assert(!has(tutorial, "HOOK_NO_FORWARD_QUESTION"), "TUTORIAL does not require a mystery/open loop");
  // setup tolerance differs by class: 9s of context before the promise
  const mk = (mode) => fx.analyze(fx.mini({
    contentMode: mode,
    beats: [
      ["b1", "SETUP", 0, 9000, "The late Pleistocene was a cold and unstable era in which early humans moved between river valleys following herds across open grassland."],
      ["b2", "EXPLANATION", 9000, 34000, "Babies had to be kept safe at night, so families used fire and shelter beside rock walls."],
      ["b3", "PAYOFF", 34000, 60000, "So the answer was a system of fire, shelter and watchful adults."],
    ],
  }));
  assert(has(mk("tutorial"), "HOOK_SETUP_TOO_LONG"), "TUTORIAL (7s max) flags 9s of setup");
  assert(!has(mk("historical-documentary"), "HOOK_SETUP_TOO_LONG"), "DOCUMENTARY (10s max) tolerates 9s of atmosphere-setting context");
});

runTest("Hook report contains no retention/watch-time figure (RULE 1/2)", () => {
  const a = fx.analyze(fx.baseRaw());
  assertEq(fx.cr.contract.findFabricatedRetention(a.hookReport), [], "no fabricated retention in hookReport");
});

done();
