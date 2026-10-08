"use strict";

/** Phase 6A §22–§31 Visual Rhythm — Cases L–R + AE (CreativeFingerprint). */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Ajv = require("ajv");
const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/rhythm");
const golden = (name) => fx.GOLDEN.find((g) => g.name === name).build();
const get = (a, code) => a.findings.find((f) => f.code === code);
const has = (a, code) => a.findings.some((f) => f.code === code && f.status === "OPEN");

runTest("Shot-duration distribution captured; no arbitrary duration quota", () => {
  const a = fx.analyze(fx.baseRaw());
  const m = a.rhythmReport.metrics;
  for (const k of ["shotCount", "medianMs", "meanMs", "minMs", "maxMs", "p90Ms", "durationCv", "identicalStreakMax", "longHolds", "rapidCutBursts"]) assert(k in m, `metric ${k}`);
  assertEq(m.shotCount, 17, "17 shots");
  assertEq(m.medianMs, 5500, "median measured");
  // very short but varied shots, and very long but varied shots: neither is flagged for duration alone
  const mkShots = (durs) => { let t = 0; return durs.map((d, i) => { const s = { shotId: `q${i}`, beatId: "b1", startMs: t, endMs: t + d, modality: ["IMAGE", "CHART", "MAP", "DIAGRAM"][i % 4], isStatic: true, framing: ["WIDE", "CLOSE", "MEDIUM", "TOP"][i % 4] }; t += d; return s; }); };
  const fast = mkShots([1800, 2400, 2100, 2700, 1900, 2300, 2600, 2000]);
  const slow = mkShots([9000, 11000, 8000, 10500, 9500, 12000, 8800, 10200]);
  for (const [label, shots] of [["fast", fast], ["slow", slow]]) {
    const end = shots[shots.length - 1].endMs;
    const raw = fx.mini({ durationMs: end, shots, beats: [["b1", "EXPLANATION", 0, end, "Archaeologists studying shelter sites found rings of ash and sleeping floors and the bones of hunters beside rock walls."]] });
    const r = fx.analyze(raw);
    assert(!r.findings.some((f) => f.code === "VISUAL_TOO_REPETITIVE"), `${label} varied cutting is not flagged (no universal quota)`);
  }
});

runTest("Identical-duration streaks, long holds and rapid-cut bursts are measured", () => {
  const shots = []; let t = 0;
  for (let i = 0; i < 6; i++) { shots.push({ shotId: `e${i}`, beatId: "b1", startMs: t, endMs: t + 5000, modality: ["IMAGE", "CHART", "MAP"][i % 3], isStatic: true, framing: ["WIDE", "CLOSE", "TOP"][i % 3] }); t += 5000; }
  const raw = fx.mini({ durationMs: t, shots, beats: [["b1", "EXPLANATION", 0, t, "Archaeologists studying shelter sites found rings of ash and sleeping floors and bones."]] });
  const a = fx.analyze(raw);
  const f = a.findings.find((x) => x.code === "VISUAL_TOO_REPETITIVE" && x.reasonClass === "IDENTICAL_DURATION");
  assert(f && f.severity === "P2" && /6 consecutive shots/.test(f.reason), "6 identical-duration shots flagged");
  assertEq(a.rhythmReport.metrics.identicalStreakMax, 6, "streak measured");
  // long hold without rest intent
  const hold = []; let u = 0;
  [4000, 4500, 3800, 15000, 4200, 4100].forEach((d, i) => { hold.push({ shotId: `h${i}`, beatId: "b1", startMs: u, endMs: u + d, modality: ["IMAGE", "CHART", "MAP"][i % 3], isStatic: false, motionPrimitive: "PAN", motionPurpose: "REVEAL_INFORMATION", motionDirection: ["LEFT", "RIGHT", "UP"][i % 3], timingPreset: ["linear", "ease-in-out", "ease-out"][i % 3], framing: ["WIDE", "CLOSE", "TOP"][i % 3] }); u += d; });
  const h = fx.analyze(fx.mini({ durationMs: u, shots: hold, beats: [["b1", "EXPLANATION", 0, u, "Archaeologists studying shelter sites found rings of ash and sleeping floors and bones."]] }));
  assert(h.findings.some((x) => x.reasonClass === "LONG_HOLD"), "15s hold (≥3× median, no rest intent) flagged P3");
  hold[3].restIntent = true;
  const h2 = fx.analyze(fx.mini({ durationMs: u, shots: hold, beats: [["b1", "EXPLANATION", 0, u, "Archaeologists studying shelter sites found rings of ash and sleeping floors and bones."]] }));
  assert(!h2.findings.some((x) => x.reasonClass === "LONG_HOLD"), "the same hold with a declared rest intent is preserved");
});

runTest("Case L — constant zoom sequence detected (MOTION_PATCH repair)", () => {
  const a = fx.analyze(golden("repetitive-zoom"));
  const f = get(a, "REPETITIVE_MOTION_RHYTHM");
  assert(f && f.reasonClass === "CONSTANT_ZOOM" && f.repairClass === "MOTION_PATCH", "constant zoom flagged: " + JSON.stringify(a.findings.map((x) => x.code)));
  assert(f.evidenceRefs.some((r) => r.startsWith("shot:")) && f.startMs === 0, "points at the shot range");
  // same primitive streak (non-zoom) and same-direction / timing streaks
  const mk = (prim) => {
    const shots = []; let t = 0;
    [4000, 5200, 4600, 6100, 4300, 5000].forEach((d, i) => { shots.push({ shotId: `p${i}`, beatId: "b1", startMs: t, endMs: t + d, modality: ["IMAGE", "CHART", "MAP"][i % 3], isStatic: false, motionPrimitive: prim, motionPurpose: "REVEAL_INFORMATION", motionDirection: "RIGHT", timingPreset: "linear", framing: ["WIDE", "CLOSE", "TOP", "MEDIUM"][i % 4] }); t += d; });
    return fx.mini({ durationMs: t, shots, beats: [["b1", "EXPLANATION", 0, t, "Archaeologists studying shelter sites found rings of ash and sleeping floors and bones."]] });
  };
  assert(fx.analyze(mk("PAN")).findings.some((x) => x.code === "REPETITIVE_MOTION_RHYTHM" && x.reasonClass === "SAME_PRIMITIVE"), "same primitive streak (PAN x6)");
});

runTest("Case M — purposeful static / visual rest is preserved (never flagged)", () => {
  const a = fx.analyze(golden("purposeful-static-rest"));
  assert(a.rhythmReport.visualRestRanges.length >= 3 && a.rhythmReport.visualRestRanges.every((r) => r.declared || r.endMs > r.startMs), "visual rest ranges recorded");
  for (const code of ["REPETITIVE_MOTION_RHYTHM", "MOTION_TOO_REPETITIVE", "VISUAL_TOO_REPETITIVE", "MOTION_WITHOUT_EDITORIAL_VALUE", "DEAD_TIME_RISK"]) assert(!has(a, code), `${code} absent`);
  assert(a.rhythmReport.metrics.visualRestRatio > 0, "rest ratio measured");
});

runTest("Case N — purposeless movement flagged (single P3, aggregate P2); REDUCE_MONOTONY alone is not editorial value", () => {
  const raw = fx.baseRaw();
  fx.shot(raw, "s8").motionPurpose = undefined;
  const one = fx.analyze(raw);
  const f = one.findings.find((x) => x.code === "MOTION_WITHOUT_EDITORIAL_VALUE");
  assert(f && f.severity === "P3" && f.shotId === "s8", "single purposeless move => P3 on the shot");
  const many = fx.baseRaw();
  for (const id of ["s1", "s3", "s8", "s11"]) fx.shot(many, id).motionPurpose = "REDUCE_MONOTONY";
  const m = fx.analyze(many);
  const g = m.findings.find((x) => x.code === "MOTION_WITHOUT_EDITORIAL_VALUE");
  assert(g && g.severity === "P2" && g.key === undefined && /moving shots do not direct attention/.test(g.reason), "≥25% purposeless moves => aggregate P2");
});

runTest("Case O — modality monotony flagged; framing repetition + mechanical alternation measured", () => {
  const a = fx.analyze(golden("modality-monotony"));
  const f = get(a, "MODALITY_MONOTONY");
  assert(f && f.scope === "GLOBAL" && /across/.test(f.reason), "MODALITY_MONOTONY across changing beat roles");
  assertEq(a.rhythmReport.metrics.maxModalityStreak >= 9, true, "max modality streak measured");
  const raw = fx.baseRaw();
  ["s1", "s2", "s3", "s4", "s5"].forEach((id) => { fx.shot(raw, id).framing = "MEDIUM"; });
  assert(fx.analyze(raw).findings.some((x) => x.code === "FRAMING_REPETITION" && x.reasonClass === "SAME_FRAMING"), "5 same-framing shots flagged");
  const alt = fx.baseRaw();
  ["s3", "s4", "s5", "s6", "s7", "s8", "s9"].forEach((id, i) => { Object.assign(fx.shot(alt, id), { motionDirection: i % 2 ? "RIGHT" : "LEFT", motionPrimitive: "PAN", isStatic: false, motionPurpose: "FOLLOW_SUBJECT", timingPreset: ["linear", "ease-out", "ease-in-out"][i % 3], framing: ["WIDE", "TOP", "CLOSE", "MEDIUM"][i % 4] }); });
  assert(fx.analyze(alt).findings.some((x) => x.reasonClass === "MECHANICAL_ALTERNATION"), "mechanical L/R alternation flagged");
});

runTest("Case P — Veo utilization: unnecessary generative motion flagged; justified Veo is not (no universal %)", () => {
  const raw = fx.baseRaw();
  fx.shot(raw, "s2").generativeMotionNeeded = false;
  const a = fx.analyze(raw);
  const f = get(a, "UNNECESSARY_GENERATIVE_MOTION");
  assert(f && f.shotId === "s2" && f.repairClass === "ASSET_MODALITY_REPLACE", "unneeded Veo flagged -> Image+Remotion replacement");
  const base = fx.analyze(fx.baseRaw());
  assert(!has(base, "UNNECESSARY_GENERATIVE_MOTION"), "justified Veo is untouched");
  assert(base.rhythmReport.metrics.veoDurationRatio > 0 && "veoBeatRatio" in base.rhythmReport.metrics && base.rhythmReport.metrics.maxConsecutiveVeo === 1, "Veo ratios + consecutive use measured");
  // 40% Veo, all justified => still no finding
  const heavy = fx.baseRaw();
  ["s3", "s5", "s8", "s10", "s12"].forEach((id) => Object.assign(fx.shot(heavy, id), { modality: "VEO", generativeMotionNeeded: true }));
  assert(!has(fx.analyze(heavy), "UNNECESSARY_GENERATIVE_MOTION"), "high Veo share is not a defect when motion is needed");
});

runTest("Case Q — caption + motion overload detected; dense captions over a static picture are fine", () => {
  const a = fx.analyze(golden("caption-motion-overload"));
  const f = get(a, "CAPTION_MOTION_OVERLOAD");
  assert(f && f.scope === "CAPTION" && f.repairClass === "CAPTION_MOTION_REDUCTION" && /chars\/s/.test(f.reason), "overload flagged with density evidence");
  assert(/do not rewrite caption meaning/.test(f.correctiveAction), "repair never rewrites caption meaning");
  const calm = golden("caption-motion-overload");
  Object.assign(calm.shots.find((s) => s.shotId === "s5"), { motionPrimitive: undefined, isStatic: true, motionIntensity: 0 });
  assert(!fx.analyze(calm).findings.some((x) => x.code === "CAPTION_MOTION_OVERLOAD"), "dense captions over a static shot are not overload");
});

runTest("Case R — music/audio rhythm: mismatch, over-scored, under-scored payoff, SFX distraction; declared silence respected", () => {
  assert(has(fx.analyze(golden("music-energy-mismatch")), "MUSIC_ENERGY_MISMATCH"), "generic mismatch");
  const over = fx.baseRaw();
  over.beats.find((b) => b.beatId === "b3").narrativeEnergy = 0.2;
  fx.setText(over, "b3", "Charred hearths at these sites show that fires burned through the night, and animal tracks stop well outside the ring of ashes, while storm winds drove the sparks across the plain and every hunter in the valley watched from the ridge.");
  over.music = [{ startMs: 0, endMs: 17000, energy: 0.35 }, { startMs: 17000, endMs: 28000, energy: 0.9 }, { startMs: 28000, endMs: 90000, energy: 0.35 }];
  assert(has(fx.analyze(over), "OVER_SCORED_SECTION"), "loud cue under dense low-energy narration");
  const under = fx.baseRaw();
  under.music = under.music.map((m) => (m.startMs === 72000 ? { startMs: 72000, endMs: 82000, energy: 0.1 } : m));
  const u = fx.analyze(under);
  assert(has(u, "UNDER_SCORED_PAYOFF") && get(u, "UNDER_SCORED_PAYOFF").repairClass === "MUSIC_MIX_PATCH", "payoff with no swell flagged");
  under.intentionalSilence = [{ startMs: 72000, endMs: 82000 }];
  assert(!has(fx.analyze(under), "UNDER_SCORED_PAYOFF"), "declared intentional silence is respected");
  const sfx = fx.baseRaw();
  sfx.sfx = Array.from({ length: 6 }, (_, i) => ({ atMs: 30000 + i * 500, kind: "WHOOSH" }));
  assert(has(fx.analyze(sfx), "SFX_DISTRACTION"), "6 SFX in 3s over narration");
});

runTest("Case AE — CreativeFingerprint carries every §23 feature + stable anchors; deterministic; schema-valid", () => {
  const a = fx.analyze(fx.baseRaw());
  const fp = a.fingerprint;
  for (const k of ["shotDurationsMs", "modalitySequence", "framingSequence", "motionPrimitiveSequence", "transitionSequence", "motionIntensityTimeline", "narrativeEnergyTimeline", "musicEnergyTimeline", "visualRestRanges", "metrics", "anchors", "fingerprintHash"]) assert(k in fp, `fingerprint.${k}`);
  assertEq(fp.shotDurationsMs.length, 17, "one duration per shot");
  assertEq(fp.motionPrimitiveSequence[1], "STATIC", "static shots recorded as STATIC");
  assert(fp.anchors.hookCheckpointIds.length === 3 && fp.anchors.beatIds.length === 9 && fp.anchors.shotIds.length === 17 && fp.anchors.sceneIds.length === 9, "stable anchors for Phase 10 analytics mapping");
  assertEq(fx.analyze(fx.baseRaw()).fingerprint.fingerprintHash, fp.fingerprintHash, "deterministic fingerprint hash");
  const other = fx.baseRaw();
  fx.shot(other, "s3").motionPrimitive = "ZOOM";
  assert(fx.analyze(other).fingerprint.fingerprintHash !== fp.fingerprintHash, "a different rhythm yields a different hash");
  const ajv = new Ajv({ strict: false });
  const root = JSON.parse(fs.readFileSync(path.join(fx.REPO, "schemas", "creative-retention.schema.json"), "utf8"));
  assert(ajv.compile({ ...root, $ref: "#/definitions/creativeFingerprint" })(fp), "fingerprint is schema-valid");
  // 6A collects features only: no cross-video originality verdict is produced (RULE 12)
  assert(!("originality" in fp) && !("similarity" in fp) && !("templateScore" in fp), "no originality judgement in 6A");
  // persisted for 6B
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-6a-fp-"));
  fx.cr.persistCreativeArtifacts(root2, "creative-validation", { fingerprint: fp });
  assertEq(fx.cr.loadCreativeArtifact(root2, "creative-validation", "fingerprint").fingerprintHash, fp.fingerprintHash, "fingerprint persisted + reloadable");
});

done();
