"use strict";

/** Phase 6A §32–§37 Final Multimodal Watch Pass — Cases S, T, U, W + reviewer traceability/disagreement. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Ajv = require("ajv");
const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/watch");
const golden = (name) => fx.GOLDEN.find((g) => g.name === name).build();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-6a-watch-"));
const videoFile = path.join(tmp, "final.mp4");
fs.writeFileSync(videoFile, Buffer.from("not-a-real-video-but-hashable-bytes-for-the-watch-contract"));
const withVideo = (raw, durationMs) => { raw.video = { path: videoFile, durationMs: durationMs === undefined ? raw.durationMs : durationMs }; return raw; };
const codes = (r) => r.findings.map((f) => f.code);
const watch = (raw, opts = {}) => { const a = fx.analyze(raw); return { a, w: fx.cr.runWatch(a, { mode: "FULL_WATCH", ...opts }) }; };

/** A single dense beat for channel-level checks. */
function channelRaw({ narration, onScreen, label, shotExtra = {}, beatExtra = {}, captions = true }) {
  const raw = fx.mini({
    durationMs: 60000,
    beats: [
      ["b1", "HOOK", 0, 9000, "Early humans protected babies at night using fire and shelter beside rock walls."],
      ["b2", "EXPLANATION", 9000, 21000, narration, beatExtra],
      ["b3", "PAYOFF", 21000, 60000, "So fire, shelter and watchful adults formed a system that kept the young safe."],
    ],
    shots: [
      { shotId: "a", beatId: "b1", startMs: 0, endMs: 9000, modality: "IMAGE", isStatic: true, framing: "WIDE" },
      { shotId: "b", beatId: "b2", startMs: 9000, endMs: 21000, modality: "CHART", isStatic: true, framing: "FLAT", ...(label ? { visualMeaning: label } : {}), ...shotExtra },
      { shotId: "c", beatId: "b3", startMs: 21000, endMs: 60000, modality: "IMAGE", isStatic: true, framing: "MEDIUM" },
    ],
  });
  if (onScreen) raw.onScreen = [{ startMs: 9500, endMs: 20500, text: onScreen }];
  if (!captions) raw.captions = [];
  return raw;
}

runTest("Case S — multimodal redundancy: one fact through 4 channels flagged; intentional reinforcement kept; 3 calm channels fine", () => {
  const N = "Fire kept predators away from the sleeping babies at night.";
  const four = watch(channelRaw({ narration: N, onScreen: "FIRE KEPT PREDATORS AWAY", label: "fire kept predators away" }));
  const f = four.w.watchReport.findings.find((x) => x.code === "MULTIMODAL_REDUNDANCY");
  assert(f && f.evidenceRefs.some((r) => r === "channel:ON_SCREEN_TEXT") && f.evidenceRefs.some((r) => r === "channel:VISUAL_LABEL"), "4-channel repeat flagged with channel evidence");
  assertEq(f.repairClass, "CHANNEL_DEDUP", "routed to channel dedup, not content deletion");
  const kept = watch(channelRaw({ narration: N, onScreen: "FIRE KEPT PREDATORS AWAY", label: "fire kept predators away", beatExtra: { intent: { reinforce: true } } }));
  assert(!codes(kept.w.watchReport).includes("MULTIMODAL_REDUNDANCY"), "intentional reinforcement is not removed");
  const calm = watch(channelRaw({ narration: N, onScreen: "FIRE KEPT PREDATORS AWAY" }));
  assert(!codes(calm.w.watchReport).includes("MULTIMODAL_REDUNDANCY"), "narration + caption + on-screen keyword (3 calm channels) is normal reinforcement");
});

runTest("Case T — multimodal contradiction: narration vs on-screen quantity / chart trend => P1 routed to Phase 4 taxonomy", () => {
  const q = watch(channelRaw({ narration: "Only two predators approached the camp that night.", onScreen: "9 PREDATORS ATTACKED" }));
  const f = q.w.watchReport.findings.find((x) => x.code === "MULTIMODAL_CONTRADICTION");
  assert(f && f.severity === "P1" && f.reasonClass === "QUANTITY_CONFLICT", "quantity conflict flagged P1");
  assert(f.evidenceRefs.includes("phase4:QUANTITY_MISMATCH") && f.repairClass === "TECHNICAL_QC_ROUTE", "technical defect routed into the Phase 4 taxonomy (QUANTITY_MISMATCH)");
  assertEq(q.w.watchReport.verdict, "FAIL", "unrepaired P1 contradiction => FAIL");
  const t = watch(channelRaw({ narration: "Predator attacks fell sharply over the period.", beatExtra: { trend: "DOWN" }, shotExtra: { trend: "UP" } }));
  const g = t.w.watchReport.findings.find((x) => x.reasonClass === "TREND_CONFLICT");
  assert(g && g.evidenceRefs.includes("phase4:TREND_MISMATCH"), "chart trend contradicting narration routed as TREND_MISMATCH");
  const ok = watch(channelRaw({ narration: "Only two predators approached the camp that night.", onScreen: "2 PREDATORS" }));
  assert(!codes(ok.w.watchReport).includes("MULTIMODAL_CONTRADICTION"), "agreeing channels are not a contradiction");
});

runTest("Cognitive overload: many simultaneous high-load channels flagged; repair keeps facts", () => {
  const dense = "Charred hearths at these sites show that fires burned through the night, and animal tracks stop well outside the ring of ashes, while families slept in tight groups beside rock walls with the youngest in the middle.";
  const raw = channelRaw({ narration: dense, onScreen: "A", shotExtra: { chartComplexity: 0.9, motionIntensity: 0.85, motionPrimitive: "PAN", isStatic: false, motionPurpose: "REVEAL_INFORMATION", overlayCount: 2 } });
  raw.sfx = [{ atMs: 12000, kind: "HIT" }, { atMs: 13000, kind: "HIT" }];
  const r = watch(raw);
  const f = r.w.watchReport.findings.find((x) => x.code === "MULTIMODAL_COGNITIVE_OVERLOAD");
  assert(f && f.evidenceRefs.filter((e) => e.startsWith("channel:")).length >= 4, "≥4 competing channels listed");
  assert(/keep factual content/.test(f.correctiveAction), "repair reduces load without deleting factual content");
});

runTest("Case U — FULL_WATCH consumes the actual final video, covers every channel + semantic segments, PASS on clean base", () => {
  const { w } = watch(withVideo(fx.baseRaw()));
  const r = w.watchReport;
  assertEq(r.mode, "FULL_WATCH", "mode FULL_WATCH");
  assert(r.video.consumed && /^[0-9a-f]{64}$/.test(r.video.sha256) && r.video.sizeBytes > 0, "final video consumed + hashed");
  assertEq(r.channelsEvaluated, ["VIDEO", "AUDIO", "NARRATION", "MUSIC", "SFX", "CAPTIONS", "ON_SCREEN_TEXT", "NARRATIVE_CONTEXT", "PACKAGING_PROMISE"], "all synchronized channels declared");
  const kinds = new Set(r.segments.map((s) => s.kind));
  for (const k of ["HOOK_WINDOW", "BEAT", "SCENE", "OUTRO"]) assert(kinds.has(k), `semantic segment kind ${k}`);
  assert(r.segments.filter((s) => s.kind === "HOOK_WINDOW").length === 3, "5s/15s/30s hook windows");
  assert(r.segments.some((s) => s.tags.includes("PAYOFF")), "payoff moment segment");
  assert(!kinds.has("SUPPLEMENT"), "equal windows only supplement gaps — none needed when semantic segments cover the video");
  assert(r.coverage.share >= 0.98, "coverage ≥ 98%");
  assertEq(r.reviewer.mode, "DETERMINISTIC_ONLY", "no reviewer => explicit DETERMINISTIC_ONLY");
  assertEq(r.verdict, "PASS", "clean base PASS");
  assert(r.segments.every((s) => s.contextBefore && s.contextAfter && s.segmentHash), "each segment has context + hash");
  const ajv = new Ajv({ strict: false });
  const root = JSON.parse(fs.readFileSync(path.join(fx.REPO, "schemas", "creative-retention.schema.json"), "utf8"));
  const v = ajv.compile({ ...root, $ref: "#/definitions/multimodalWatchReport" });
  assert(v(r), "watch report schema-valid: " + JSON.stringify(v.errors));
  // supplements fill gaps only
  const gap = withVideo(fx.baseRaw());
  gap.beats.find((b) => b.beatId === "b6").endMs = 58000;
  gap.beats.find((b) => b.beatId === "b7").startMs = 63500;
  gap.music = [];
  const sg = watch(gap).w.watchReport.segments;
  assert(sg.some((s) => s.kind === "SUPPLEMENT" && s.startMs >= 58000 && s.endMs <= 63500), "equal-duration supplement appears only inside the uncovered gap");
});

runTest("Watch honesty: no video / stale video / low coverage never silently PASS", () => {
  const none = watch(fx.baseRaw());
  assertEq(none.w.watchReport.verdict, "REVIEW_REQUIRED", "no final video => REVIEW_REQUIRED");
  assert(none.w.watchReport.blockers.some((b) => b.startsWith("FINAL_VIDEO_NOT_CONSUMED")), "blocker names the missing video");
  assertEq(watch(fx.baseRaw(), { requireVideo: false }).w.watchReport.verdict, "PASS", "explicitly structural-only run may PASS");
  const stale = watch(withVideo(fx.baseRaw(), 70000));
  assert(stale.w.watchReport.blockers.includes("VIDEO_TIMELINE_DURATION_MISMATCH") && stale.w.watchReport.verdict === "REVIEW_REQUIRED", "video ≠ timeline duration => REVIEW_REQUIRED");
  const missing = fx.baseRaw();
  missing.video = { path: path.join(tmp, "absent.mp4") };
  assert(watch(missing).w.watchReport.video.reason === "FINAL_VIDEO_NOT_FOUND", "missing file reported");
});

runTest("Opening composites corroborate hook findings with non-narration channels", () => {
  const raw = withVideo(golden("delayed-hook"));
  for (const id of ["s1", "s2", "s3"]) Object.assign(raw.shots.find((s) => s.shotId === id), { visualMeaning: undefined, motionIntensity: 0, motionPrimitive: undefined, isStatic: true });
  const { a, w } = watch(raw);
  const slow = w.watchReport.findings.find((f) => f.code === "OPENING_TOO_SLOW");
  const weak = w.watchReport.findings.find((f) => f.code === "OPENING_PROMISE_WEAK");
  const hookIds = a.hookReport.findings.map((f) => f.findingId);
  assert(slow && slow.relatedFindingIds.every((id) => hookIds.includes(id)), "OPENING_TOO_SLOW references the hook finding (no duplicate repair)");
  assert(weak && weak.relatedFindingIds.length === 1, "OPENING_PROMISE_WEAK references the promise finding");
});

runTest("Payoff under-emphasis, transition break and outro momentum", () => {
  const raw = fx.baseRaw();
  raw.beats.find((b) => b.beatId === "b8").endMs = 74000;
  raw.beats.find((b) => b.beatId === "b9").startMs = 74000;
  for (const id of ["s15", "s16"]) Object.assign(raw.shots.find((s) => s.shotId === id), { motionPrimitive: undefined, motionPurpose: undefined, isStatic: true, motionIntensity: 0 });
  raw.shots.find((s) => s.shotId === "s15").endMs = 74000;
  raw.shots = raw.shots.filter((s) => s.shotId !== "s16");
  raw.onScreen = raw.onScreen.filter((o) => o.startMs !== 72500);
  raw.music = raw.music.map((m) => (m.startMs === 72000 ? { startMs: 72000, endMs: 82000, energy: 0.5 } : m));
  const p = watch(raw).w.watchReport.findings.find((f) => f.code === "PAYOFF_UNDER_EMPHASIZED");
  assert(p && p.beatId === "b8" && p.repairClass === "PAYOFF_EMPHASIS_PATCH", "2s un-emphasised payoff flagged");
  // transition break: a heavy WIPE inside a continuous scene, no stated cut motivation
  const tr = fx.baseRaw();
  Object.assign(tr.shots.find((s) => s.shotId === "s5"), { transitionIn: "WIPE" });
  fx.setText(tr, "b3", "Archaeologists studying shelter sites also found families sleeping in tight groups beside rock walls, with the youngest placed in the middle of the ring.");
  tr.beats.find((b) => b.beatId === "b3").sceneId = "sc-b2";
  const t = watch(tr).w.watchReport.findings.find((f) => f.code === "TRANSITION_CREATIVE_BREAK");
  assert(t && t.shotId === "s5" && t.repairClass === "TRANSITION_PATCH", "WIPE through continuous material flagged");
  tr.shots.find((s) => s.shotId === "s5").cutMotivation = "CHANGE_OF_SUBJECT";
  assert(!watch(tr).w.watchReport.findings.some((f) => f.code === "TRANSITION_CREATIVE_BREAK"), "a stated cut motivation clears it");
  // outro
  const out = fx.mini({
    durationMs: 68000,
    beats: [
      ["b1", "HOOK", 0, 10000, "Early humans protected babies at night using fire and shelter beside rock walls."],
      ["b2", "EXPLANATION", 10000, 50000, "Archaeologists studying shelter sites found rings of ash, sleeping floors and the bones of hunters."],
      ["b3", "REFLECTION", 50000, 68000, "Humans protected babies using fire and shelter beside walls. Early humans protected babies at night."],
    ],
  });
  assert(watch(out).w.watchReport.findings.some((f) => f.code === "OUTRO_LOSES_MOMENTUM"), "18s information-free outro flagged");
});

runTest("Reviewer integration: traceability persisted; invalid model findings rejected; subjective model findings kept", () => {
  const raw = withVideo(fx.baseRaw());
  const reviewer = {
    provider: "test-provider", model: "test-model", modelVersion: "1.0", rubricVersion: "creative-rubric@1.0.0", samplingStrategy: "ALL_SEGMENTS",
    review({ segment }) {
      if (segment.kind !== "BEAT" || segment.beatIds[0] !== "b8") return { costUsd: 0.001, latencyMs: 40, tokens: 100, findings: [], clears: [] };
      return {
        costUsd: 0.002, latencyMs: 55, tokens: 210,
        findings: [
          { code: "PAYOFF_UNDER_EMPHASIZED", reason: "the reveal lands without a pause before the answer", evidenceRefs: ["frame:76.2s"], beatId: "b8", correctiveAction: "PAYOFF_EMPHASIS_PATCH:hold one beat before the answer" },
          { code: "MADE_UP_CODE", reason: "x", evidenceRefs: ["frame:1"] },
          { code: "BEAT_NO_PROGRESS", reason: "no evidence refs" },
        ],
        clears: [],
      };
    },
  };
  const { w } = watch(raw, { reviewer });
  const r = w.watchReport;
  assertEq(r.reviewer.mode, "MODEL_ASSISTED", "model-assisted");
  const t = r.reviewer.trace;
  for (const k of ["provider", "model", "modelVersion", "rubricVersion", "videoSha256", "samplingStrategy", "segmentHashes", "costUsd", "latencyMs", "calls"]) assert(k in t, `trace.${k}`);
  assert(t.calls === r.segments.length && t.segmentHashes.length === t.calls && t.costUsd > 0 && t.latencyMs > 0, "calls/hashes/cost/latency recorded");
  assert(/^[0-9a-f]{64}$/.test(t.videoSha256), "video hash bound to the trace");
  assertEq(r.reviewer.rejectedModelFindings.length, 2, "uncatalogued / non-actionable model findings rejected");
  const m = r.findings.find((f) => f.code === "PAYOFF_UNDER_EMPHASIZED" && f.source === "MODEL");
  assert(m && m.status === "OPEN", "subjective model finding accepted as MODEL source");
  assert(fx.cr.contract.validateFinding(m).ok, "model finding satisfies the same contract (vendor-neutral)");
});

runTest("Model disagreement => REVIEW_REQUIRED, never averaged", () => {
  const raw = withVideo(golden("repetitive-zoom"));
  const clears = { provider: "p", model: "m", rubricVersion: "r", review: () => ({ findings: [], clears: [{ code: "REPETITIVE_MOTION_RHYTHM", startMs: 0, endMs: 40000 }] }) };
  const { w } = watch(raw, { reviewer: clears });
  assert(w.watchReport.findings.some((f) => f.code === "MODEL_DISAGREEMENT" && f.status === "REVIEW_REQUIRED"), "MODEL_DISAGREEMENT recorded");
  const det = w.watchReport.findings.find((f) => f.code === "REPETITIVE_MOTION_RHYTHM");
  assertEq(det.status, "REVIEW_REQUIRED", "the deterministic finding is held for review, not erased");
  assertEq(w.watchReport.verdict, "REVIEW_REQUIRED", "verdict REVIEW_REQUIRED");
  // reviewer claims a measurable defect the structured state does not show
  const claim = { provider: "p", model: "m", rubricVersion: "r", review: ({ segment }) => (segment.kind === "BEAT" && segment.beatIds[0] === "b2" ? { findings: [{ code: "BEAT_TOO_LONG", reason: "feels long", evidenceRefs: ["frame:10s"] }] } : {}) };
  const c = watch(withVideo(fx.baseRaw()), { reviewer: claim }).w.watchReport;
  assert(c.findings.some((f) => f.code === "MODEL_DISAGREEMENT") && c.verdict === "REVIEW_REQUIRED", "a model claim contradicting measured duration is held for review");
});

runTest("Case W — SEGMENT_REWATCH judges only the affected beat + 1 context beat each side; merge marks REPAIRED", () => {
  const before = fx.analyze(golden("repetitive-zoom"));
  const rewatchOf = (analysis, affected) => fx.cr.runWatch(analysis, { mode: "SEGMENT_REWATCH", affected, requireVideo: false }).watchReport;
  const w = rewatchOf(before, { startMs: 28000, endMs: 40000 });
  assertEq(w.mode, "SEGMENT_REWATCH", "mode");
  const ids = new Set(w.segments.flatMap((s) => s.beatIds));
  assert(ids.has("b3") && ids.has("b4") && ids.has("b5") && !ids.has("b1") && !ids.has("b8"), "affected b4 + context b3/b5 only: " + [...ids]);
  assert(w.segments.length < fx.cr.runWatch(before, { mode: "FULL_WATCH", requireVideo: false }).watchReport.segments.length / 2, "far fewer segments than a full watch");
  assert(w.affected.contextStartMs === 17000 && w.affected.contextEndMs === 50000, "context window recorded");
  // merge: previous findings in the affected window not re-detected become REPAIRED
  const repaired = fx.baseRaw();
  const after = fx.analyze(repaired);
  const rw = rewatchOf(after, { startMs: 0, endMs: 28000 });
  const merged = fx.cr.watch.mergeRewatch(before.findings, rw);
  const zoom = merged.find((f) => f.code === "REPETITIVE_MOTION_RHYTHM");
  assertEq(zoom.status, "REPAIRED", "zoom finding re-checked and marked REPAIRED");
  assert(/SEGMENT_REWATCH/.test(zoom.statusReason), "status reason recorded");
  assertEq(fx.cr.watch.mergeRewatch(before.findings, rewatchOf(before, { startMs: 28000, endMs: 40000 })).find((f) => f.code === "REPETITIVE_MOTION_RHYTHM").status, "OPEN", "findings outside the rewatch window are untouched");
  assert(fx.cr.runWatch(before, { mode: "SEGMENT_REWATCH", affected: { startMs: 0, endMs: 5000 }, requireVideo: false }).watchReport.segments.length > 0, "edge: rewatch at t=0 works");
  let threw = false;
  try { fx.cr.runWatch(before, { mode: "SEGMENT_REWATCH" }); } catch { threw = true; }
  assert(threw, "SEGMENT_REWATCH without an affected range is rejected");
});

done();
