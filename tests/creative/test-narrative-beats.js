"use strict";

/** Phase 6A §15–§21 Narrative Beat Quality — Cases F–K (+ tension/open-loop traceability). */

const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/beats");
const golden = (name) => fx.GOLDEN.find((g) => g.name === name).build();
const get = (a, code) => a.findings.find((f) => f.code === code);
const open = (a, code) => a.findings.some((f) => f.code === code && f.status === "OPEN");

runTest("Beat roles, progress types, tension and loops are represented and traceable", () => {
  const a = fx.analyze(fx.baseRaw());
  const r = a.beatReport;
  assertEq(r.beats.length, 9, "9 beats");
  assert(r.beats.every((b) => b.role && Array.isArray(b.progress) && b.progress.length > 0), "every beat has a role + at least one progress type");
  assert(r.beats[0].progress.includes("RAISE_QUESTION"), "hook beat raises the question");
  assert(r.beats[7].progress.includes("PAYOFF") && r.beats[7].progress.includes("ANSWER_QUESTION"), "payoff beat answers + pays off");
  assertEq(r.openLoops.length, 1, "one open loop tracked");
  const L = r.openLoops[0];
  assert(L.status === "RESOLVED" && L.openedBeatId === "b1" && L.resolvedBeatId === "b8", "loop traced b1 -> b8: " + JSON.stringify(L));
  const mid = r.beats.slice(1, 7);
  assert(mid.every((b) => b.tension > 0), "tension > 0 mid-video from the knowledge gap alone (no danger drama needed)");
  assert(r.tensionTimeline.length === 9 && r.tensionTimeline.every((t) => ["RISING", "FALLING", "FLAT"].includes(t.movement)), "tension timeline movement recorded");
  assertEq(r.findings.filter((f) => f.status === "OPEN").length, 0, "clean base has zero open beat findings");
});

runTest("Case F — beat with no progress detected (actionable)", () => {
  const a = fx.analyze(fx.mini({
    beats: [
      ["b1", "HOOK", 0, 8000, "Early humans protected babies at night using fire and shelter beside rock walls."],
      ["b2", "EXPLANATION", 8000, 30000, "Archaeologists studying shelter sites found families sleeping in tight groups beside rock walls."],
      ["b3", "EXPLANATION", 30000, 33000, "families sleeping in tight groups beside rock walls"],
      ["b4", "PAYOFF", 33000, 60000, "So fire, shelter and watchful adults formed a system."],
    ],
  }));
  const f = get(a, "BEAT_NO_PROGRESS");
  assert(f && f.beatId === "b3", "BEAT_NO_PROGRESS on b3");
  assert(f.repairClass === "SCRIPT_TRIM" && f.evidenceRefs.length > 0 && f.startMs === 30000 && f.endMs === 33000, "where/why/evidence/repair class present");
});

runTest("Case G — repeated fact at meaning level (not exact string) flagged as NARRATIVE_REDUNDANCY", () => {
  const raw = golden("redundant-beats");
  fx.setText(raw, "b4", "At these sites the fires burned through the night, and animal tracks stop well outside the ring of ashes around the hearths.");
  const a = fx.analyze(raw);
  const f = get(a, "NARRATIVE_REDUNDANCY");
  assert(f && f.status === "OPEN" && f.reasonClass === "SEMANTIC_REPEAT" && f.beatId === "b4", "paraphrased restatement caught: " + JSON.stringify(a.findings.map((x) => x.code)));
});

runTest("Case H — intentional recap is distinguishable (ACCEPTED_INTENTIONAL, not OPEN)", () => {
  const raw = fx.baseRaw();
  fx.setText(raw, "b4", "To recap, fires burned through the night and animal tracks stop well outside the ring of ashes.");
  const a = fx.analyze(raw);
  const f = get(a, "NARRATIVE_REDUNDANCY");
  assert(f && f.status === "ACCEPTED_INTENTIONAL" && f.reasonClass === "INTENTIONAL_RECAP", "recap accepted: " + JSON.stringify(f && [f.status, f.reasonClass]));
  const raw2 = fx.baseRaw();
  fx.setText(raw2, "b4", fx.T.b3);
  fx.beat(raw2, "b4").intent = { recap: true };
  const f2 = get(fx.analyze(raw2), "NARRATIVE_REDUNDANCY");
  assert(f2 && f2.status === "ACCEPTED_INTENTIONAL", "explicit recap intent also accepted");
});

runTest("Case I — dropped payoff detected; deferred loop with a reason is not dropped", () => {
  const a = fx.analyze(golden("dropped-payoff"));
  const f = get(a, "DROPPED_PAYOFF");
  assert(f && f.severity === "P1", "dropped payoff tied to the packaging promise escalates to P1");
  assertEq(a.beatReport.metrics.loopsDropped, 1, "metrics count the dropped loop");
  const raw = golden("dropped-payoff");
  fx.beat(raw, "b1").opensLoops = [{ loopId: "L1", question: "how do you keep a baby safe from predators in the dark?", packaging: true, deferTo: "NEXT_VIDEO", deferReason: "answered in part two of the series" }];
  const b = fx.analyze(raw);
  assert(!b.findings.some((x) => x.code === "DROPPED_PAYOFF"), "intentional defer with reason is not a dropped payoff");
  assertEq(b.beatReport.openLoops[0].status, "INTENTIONALLY_DEFERRED", "loop status INTENTIONALLY_DEFERRED");
  // detected (un-annotated) question loops are tracked too
  const c = fx.analyze(fx.mini({ beats: [["b1", "HOOK", 0, 8000, "Why did predators avoid the camp?"], ["b2", "EXPLANATION", 8000, 40000, "Archaeologists studying shelter sites found sleeping floors."], ["b3", "PAYOFF", 40000, 60000, "So fire explains it."]] }));
  assert(c.beatReport.openLoops.some((l) => l.source === "DETECTED"), "auto-detected question loop");
});

runTest("Case J — intentional slow beat is NOT dead time / not too long", () => {
  const a = fx.analyze(golden("intentional-slow-beat"));
  const b5 = a.beatReport.beats.find((b) => b.beatId === "b5");
  assertEq(b5.status, "DELIBERATE_REST", "classified DELIBERATE_REST");
  for (const code of ["DEAD_TIME_RISK", "BEAT_NO_PROGRESS", "BEAT_TOO_LONG"]) assert(!open(a, code), `${code} absent`);
  assertEq(a.beatReport.metrics.deliberateRestBeats, 1, "rest counted separately");
});

runTest("Case K — true dead time detected; static/silent/visual-meaning/atmosphere are NOT dead", () => {
  const a = fx.analyze(golden("true-dead-time"));
  const f = get(a, "DEAD_TIME_RISK");
  assert(f && f.beatId === "b5" && f.repairClass === "BEAT_RETIME_OR_SPLIT", "dead beat b5 flagged with repair class");
  // visual meaning present => not dead
  const raw = golden("true-dead-time");
  raw.shots.find((s) => s.shotId === "s9").visualMeaning = "embers glowing in the dark";
  assert(!fx.analyze(raw).findings.some((x) => x.code === "DEAD_TIME_RISK"), "meaningful static visual is not dead");
  // declared silence => not dead
  const raw2 = golden("true-dead-time");
  raw2.intentionalSilence = [{ startMs: 40000, endMs: 50000 }];
  assert(!fx.analyze(raw2).findings.some((x) => x.code === "DEAD_TIME_RISK"), "declared intentional silence is not dead");
  // atmosphere via music => not dead
  const raw3 = golden("true-dead-time");
  raw3.music = [{ startMs: 40000, endMs: 50000, energy: 0.4 }];
  assert(!fx.analyze(raw3).findings.some((x) => x.code === "DEAD_TIME_RISK"), "atmospheric music bed is not dead");
  // undeclared gap between beats
  const gap = fx.baseRaw();
  gap.music = [];
  gap.beats.find((b) => b.beatId === "b6").endMs = 58000;
  gap.beats.find((b) => b.beatId === "b7").startMs = 63500;
  const g = fx.analyze(gap);
  assert(g.findings.some((x) => x.code === "DEAD_TIME_RISK" && x.reasonClass === "UNDECLARED_GAP"), "5.5s undeclared gap flagged");
});

runTest("Duration discipline: too-long low-density beat and too-short dense beat", () => {
  const a = fx.analyze(fx.mini({ beats: [["b1", "HOOK", 0, 8000, "Early humans protected babies at night using fire and shelter beside rock walls."], ["b2", "EXPLANATION", 8000, 60000, "Archaeologists studying shelter sites found sleeping floors beside rock walls."], ["b3", "PAYOFF", 60000, 90000, "So fire, shelter and watchful adults formed a system."]] }));
  assert(a.findings.some((f) => f.code === "BEAT_TOO_LONG" && f.beatId === "b2"), "52s EXPLANATION at low concept density => BEAT_TOO_LONG");
  const short = fx.mini({ beats: [["b1", "HOOK", 0, 8000, "Early humans protected babies at night using fire and shelter beside rock walls."], ["b2", "EXPLANATION", 8000, 9200, "Archaeologists studying shelter sites found families sleeping together beside rock walls."], ["b3", "PAYOFF", 9200, 60000, "So fire explains it."]] });
  assert(fx.analyze(short).findings.some((f) => f.code === "BEAT_TOO_SHORT" && f.beatId === "b2"), "11 words in 1.2s => BEAT_TOO_SHORT");
});

done();
