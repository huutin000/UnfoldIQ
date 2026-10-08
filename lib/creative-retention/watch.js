"use strict";

/**
 * Phase 6A §32–§37 — Final Multimodal Watch Pass (UNFOLDIQ CORE).
 *
 * Creative viewer-experience QA over SYNCHRONIZED channels — video, audio,
 * narration, music, SFX, captions, on-screen text, story context and the
 * packaging promise. It is NOT a duplicate of Phase 4 technical QC: technical
 * defects found here are routed into the existing Phase 4 taxonomy.
 *
 * Modes:
 *   FULL_WATCH       whole video, required before 6A completion
 *   SEGMENT_REWATCH  affected segment + context before/after, used after
 *                    local repairs (no full re-watch after every patch)
 *
 * Deterministic channel analysis measures structured state (never asks a
 * model to count what is already in structured state — §45). An injected
 * reviewer adds judgment (curiosity, payoff strength, semantic redundancy);
 * material disagreement => REVIEW_REQUIRED, never averaged (§46). Reviewer
 * traces (provider/model/rubric/hash/sampling/cost/latency) are persisted
 * and the contract is vendor-neutral (§47).
 */

const fs = require("fs");
const crypto = require("crypto");
const { makeFinding, FINDING_CATALOG, sha16, countBySeverity } = require("./contract.js");
const { WATCH_POLICY: W, HOOK_CHECKPOINTS_MS, POLICY_VERSION } = require("./policy.js");
const T = require("./text.js");

const WATCH_VERSION = "1.0.0";
const MODES = ["FULL_WATCH", "SEGMENT_REWATCH"];

// Codes whose truth is measurable from structured state: a model that
// asserts one without deterministic support is a DISAGREEMENT, not a finding.
const MEASURABLE = new Set(["BEAT_TOO_LONG", "BEAT_TOO_SHORT", "VISUAL_TOO_REPETITIVE", "REPETITIVE_MOTION_RHYTHM", "MOTION_TOO_REPETITIVE", "FRAMING_REPETITION", "MODALITY_MONOTONY", "CAPTION_MOTION_OVERLOAD", "MUSIC_ENERGY_MISMATCH"]);
const EMPHASIS_PRIMITIVES = new Set(["REVEAL", "MASK_REVEAL", "CHART_HIGHLIGHT", "CHART_REVEAL", "PATH_DRAW", "BLUR_TO_FOCUS", "DIAGRAM_STEP_REVEAL"]);
const HEAVY_TRANSITIONS = new Set(["WIPE", "SLIDE_PUSH", "LIGHT_SWEEP"]);

const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };

/** [{value, noun}] pairs: "9 percent", "nine in a hundred" (noun "hundred" skipped), "3 predators". */
function quantities(text) {
  const out = [];
  const ws = T.words(text);
  for (let i = 0; i < ws.length; i++) {
    let v = null;
    if (/^\d+(\.\d+)?$/.test(ws[i])) v = Number(ws[i]);
    else if (Object.prototype.hasOwnProperty.call(NUM_WORDS, ws[i])) v = NUM_WORDS[ws[i]];
    if (v === null) continue;
    let noun = null;
    for (let j = i + 1; j < Math.min(ws.length, i + 3); j++) {
      if (T.STOP.has(ws[j])) continue;
      noun = T.stem(ws[j]);
      break;
    }
    if (noun) out.push({ value: v, noun });
  }
  return out;
}

function segmentChannels(input, a, b) {
  const narr = T.textInWindow(input.narration, a, b);
  const sec = Math.max((b - a) / 1000, 0.001);
  const caps = input.captions.filter((c) => T.overlapMs(c.startMs, c.endMs, a, b) > 0);
  const capChars = caps.reduce((s, c) => s + c.text.length * (T.overlapMs(c.startMs, c.endMs, a, b) / Math.max(c.endMs - c.startMs, 1)), 0);
  const on = input.onScreen.filter((o) => T.overlapMs(o.startMs, o.endMs, a, b) > 0);
  const shots = input.shots.filter((s) => T.overlapMs(s.startMs, s.endMs, a, b) > 0);
  let music = 0;
  let cover = 0;
  for (const m of input.music) {
    const o = T.overlapMs(m.startMs, m.endMs, a, b);
    if (o > 0) { music += m.energy * o; cover += o; }
  }
  const sfx = input.sfx.filter((x) => x.atMs >= a && x.atMs < b).length;
  const motion = shots.length ? Math.max(...shots.map((s) => (Number.isFinite(s.motionIntensity) ? s.motionIntensity : 0))) : 0;
  const ev = [];
  for (const o of on) { ev.push([Math.max(o.startMs, a), 1]); ev.push([Math.min(o.endMs, b), -1]); }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let simul = 0;
  for (const [, d] of ev) { cur += d; simul = Math.max(simul, cur); }
  return {
    narrationText: narr,
    narrationWps: Number((T.wordCount(narr) / sec).toFixed(2)),
    captionCps: Number((capChars / sec).toFixed(2)),
    onScreenTexts: on.map((o) => o.text),
    onScreenSimultaneous: simul,
    shotIds: shots.map((s) => s.shotId),
    modalities: [...new Set(shots.map((s) => s.modality))],
    motionIntensityMax: Number(motion.toFixed(2)),
    chartComplexityMax: Math.max(0, ...shots.map((s) => Number(s.chartComplexity) || 0)),
    overlayCountMax: Math.max(0, ...shots.map((s) => Number(s.overlayCount) || 0)),
    cutCount: shots.filter((s) => s.startMs > a && s.startMs < b).length,
    musicEnergy: cover > 0 ? Number((music / cover).toFixed(2)) : null,
    sfxCount: sfx,
    visualLabels: shots.map((s) => s.visualMeaning).filter(Boolean),
  };
}

function buildSegments(input, { mode, affected } = {}) {
  const segs = [];
  const D = input.durationMs;
  const push = (kind, a, b, extra = {}) => {
    const s = Math.max(0, a);
    const e = Math.min(D, b);
    if (e <= s) return;
    segs.push({ segmentId: `${input.projectId}:${kind}:${s}-${e}`, kind, startMs: s, endMs: e, tags: [], beatIds: [], ...extra });
  };
  const hookEdges = [0, HOOK_CHECKPOINTS_MS.HOOK_5S, HOOK_CHECKPOINTS_MS.HOOK_15S, HOOK_CHECKPOINTS_MS.HOOK_30S];
  for (let i = 0; i + 1 < hookEdges.length; i++) push("HOOK_WINDOW", hookEdges[i], hookEdges[i + 1]);
  for (const b of input.beats) {
    push("BEAT", b.startMs, b.endMs, { beatIds: [b.beatId], tags: b.role === "PAYOFF" || b.role === "REVEAL" ? ["PAYOFF"] : [] });
  }
  const sceneIds = [...new Set(input.beats.map((b) => b.sceneId).filter(Boolean))];
  for (const sid of sceneIds) {
    const bs = input.beats.filter((b) => b.sceneId === sid);
    push("SCENE", Math.min(...bs.map((b) => b.startMs)), Math.max(...bs.map((b) => b.endMs)), { beatIds: bs.map((b) => b.beatId) });
  }
  for (const s of input.shots) {
    if (s.transitionIn && s.transitionIn !== "CUT") push("TRANSITION", s.startMs - 500, s.startMs + 500, { tags: [s.transitionIn], shotId: s.shotId });
  }
  const last = input.beats[input.beats.length - 1];
  push("OUTRO", Math.min(last.startMs, D - D * W.outroTailShare), D, { tags: ["OUTRO"], beatIds: [last.beatId] });

  // Equal-duration windows SUPPLEMENT semantic segmentation — gaps only (never replace it).
  const covered = unionRanges(segs);
  let cursor = 0;
  const gaps = [];
  for (const r of covered) { if (r.startMs > cursor) gaps.push([cursor, r.startMs]); cursor = Math.max(cursor, r.endMs); }
  if (cursor < D) gaps.push([cursor, D]);
  for (const [g0, g1] of gaps) for (let t = g0; t < g1; t += W.supplementWindowMs) push("SUPPLEMENT", t, Math.min(g1, t + W.supplementWindowMs));

  let chosen = segs;
  let coreRange = null;
  if (mode === "SEGMENT_REWATCH" && affected) {
    coreRange = { startMs: affected.startMs, endMs: affected.endMs };
    const idx = input.beats.map((b, i) => ({ b, i })).filter(({ b }) => T.overlapMs(b.startMs, b.endMs, affected.startMs, affected.endMs) > 0).map(({ i }) => i);
    const lo = Math.max(0, (idx.length ? Math.min(...idx) : 0) - W.contextBeats);
    const hi = Math.min(input.beats.length - 1, (idx.length ? Math.max(...idx) : 0) + W.contextBeats);
    const winStart = input.beats[lo].startMs;
    const winEnd = input.beats[hi].endMs;
    const windowBeatIds = new Set(input.beats.slice(lo, hi + 1).map((b) => b.beatId));
    // keep only segments that belong to the window's beats (an OUTRO window that merely grazes the edge is not re-judged)
    chosen = segs.filter((s) => s.kind !== "SUPPLEMENT" && T.overlapMs(s.startMs, s.endMs, winStart, winEnd) > 0 && s.beatIds.every((id) => windowBeatIds.has(id)));
    coreRange = { ...coreRange, contextStartMs: winStart, contextEndMs: winEnd };
  }
  for (const s of chosen) {
    s.channels = segmentChannels(input, s.startMs, s.endMs);
    const ctxB = Math.max(0, s.startMs - 2000);
    const ctxA = Math.min(D, s.endMs + 2000);
    s.contextBefore = { startMs: ctxB, endMs: s.startMs };
    s.contextAfter = { startMs: s.endMs, endMs: ctxA };
    s.segmentHash = sha16({ k: s.kind, a: s.startMs, b: s.endMs, ch: s.channels, f: input.inputFingerprint });
  }
  return { segments: chosen, coreRange };
}

function unionRanges(rs) {
  const sorted = rs.map((r) => ({ startMs: r.startMs, endMs: r.endMs })).sort((a, b) => a.startMs - b.startMs);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startMs <= last.endMs) last.endMs = Math.max(last.endMs, r.endMs); else out.push({ ...r });
  }
  return out;
}

function sha256File(p) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(p));
  return h.digest("hex");
}

function videoEvidence(input, opts) {
  const v = input.video;
  if (!v || !v.path) return { consumed: false, reason: "NO_FINAL_VIDEO_SUPPLIED" };
  if (!fs.existsSync(v.path)) return { consumed: false, path: v.path, reason: "FINAL_VIDEO_NOT_FOUND" };
  const stat = fs.statSync(v.path);
  const sha = v.sha256 || sha256File(v.path);
  let probedMs = Number.isFinite(v.durationMs) ? v.durationMs : null;
  if (probedMs === null && typeof opts.probeVideo === "function") {
    try { probedMs = opts.probeVideo(v.path); } catch { probedMs = null; }
  }
  const mismatch = probedMs !== null && Math.abs(probedMs - input.durationMs) > 600;
  return { consumed: true, path: v.path, sha256: sha, sizeBytes: stat.size, probedDurationMs: probedMs, timelineDurationMs: input.durationMs, durationMatchesTimeline: probedMs === null ? null : !mismatch };
}

// ---- deterministic multimodal checks ------------------------------------------------------
function deterministicChecks(input, beatReport, hookReport, segments) {
  const findings = [];
  const perBeat = new Map(beatReport.beats.map((b) => [b.beatId, b]));
  const beatById = new Map(input.beats.map((b) => [b.beatId, b]));
  const seen = new Set();
  const add = (f) => { if (!seen.has(f.findingId)) { seen.add(f.findingId); findings.push(f); } };

  for (const seg of segments.filter((s) => s.kind === "BEAT")) {
    const ch = seg.channels;
    const beat = beatById.get(seg.beatIds[0]);
    const base = { beatId: beat.beatId, sceneId: beat.sceneId, startMs: seg.startMs, endMs: seg.endMs };

    // Cognitive load: how many channels compete simultaneously.
    const high = [];
    if (ch.narrationWps >= W.narrationWpsHigh) high.push("NARRATION");
    if (ch.captionCps >= W.captionCpsHigh) high.push("CAPTIONS");
    if (ch.chartComplexityMax >= W.chartComplexityHigh || ch.overlayCountMax >= 2) high.push("COMPLEX_VISUAL");
    if (ch.motionIntensityMax >= W.motionHigh) high.push("FAST_MOTION");
    if ((ch.musicEnergy !== null && ch.musicEnergy >= 0.7) || ch.sfxCount >= 2) high.push("MUSIC_SFX_EVENT");
    if (ch.onScreenSimultaneous >= 3) high.push("ON_SCREEN_TEXT");
    if (high.length >= W.cognitiveChannelsHigh) {
      add(makeFinding("MULTIMODAL_COGNITIVE_OVERLOAD", {
        ...base, key: beat.beatId,
        reason: `${high.length} channels compete at once in beat ${beat.beatId}: ${high.join(", ")}`,
        evidenceRefs: [`segment:${seg.segmentId}`, ...high.map((h) => `channel:${h}`)],
        correctiveAction: "COGNITIVE_LOAD_REDUCTION:reduce motion, simplify the visual, delay the overlay or create rest; keep factual content", confidence: "MEDIUM",
      }));
    }

    // Redundancy across channels (adds no value AND hurts pacing/readability).
    const nTok = T.contentTokens(ch.narrationText);
    if (nTok.size >= 3 && beat.intent.reinforce !== true) {
      const channels = ["NARRATION"];
      if (ch.captionCps > 0) channels.push("CAPTIONS");
      if (ch.onScreenTexts.some((t) => { const k = T.contentTokens(t); return k.size > 0 && T.coverage(k, nTok) >= W.redundancyOverlap; })) channels.push("ON_SCREEN_TEXT");
      if (ch.visualLabels.some((t) => { const k = T.contentTokens(t); return k.size > 0 && T.coverage(k, nTok) >= W.redundancyOverlap; })) channels.push("VISUAL_LABEL");
      const dense = ch.narrationWps >= W.narrationWpsHigh || ch.captionCps >= W.captionCpsHigh;
      if (channels.length >= W.redundancyChannels || (channels.length >= W.redundancyChannelsDense && dense && channels.includes("ON_SCREEN_TEXT") && channels.includes("VISUAL_LABEL"))) {
        add(makeFinding("MULTIMODAL_REDUNDANCY", {
          ...base, key: beat.beatId,
          reason: `the same fact is stated through ${channels.join(" + ")} in beat ${beat.beatId}${dense ? " while the section is already dense" : ""}`,
          evidenceRefs: [`segment:${seg.segmentId}`, ...channels.map((c) => `channel:${c}`)],
          correctiveAction: "CHANNEL_DEDUP:drop the weakest repeating channel; keep intentional reinforcement", confidence: "LOW",
        }));
      }
    }

    // Contradiction between narration and on-screen text / captions / chart trend.
    const nq = quantities(ch.narrationText);
    const others = [...ch.onScreenTexts.map((t) => ({ src: "ON_SCREEN_TEXT", t }))];
    for (const o of others) {
      for (const q of quantities(o.t)) {
        const same = nq.filter((x) => x.noun === q.noun);
        if (same.length > 0 && !same.some((x) => x.value === q.value)) {
          add(makeFinding("MULTIMODAL_CONTRADICTION", {
            ...base, key: `${beat.beatId}:${q.noun}`, reasonClass: "QUANTITY_CONFLICT",
            reason: `narration says ${same.map((x) => x.value).join("/")} ${q.noun} but ${o.src} shows ${q.value} ${q.noun}`,
            evidenceRefs: [`segment:${seg.segmentId}`, `channel:${o.src}`, "phase4:QUANTITY_MISMATCH"],
            correctiveAction: "TECHNICAL_QC_ROUTE:QUANTITY_MISMATCH (Phase 4 semantic taxonomy)", confidence: "HIGH",
          }));
        }
      }
    }
    const trendShot = input.shots.find((s) => s.trend && T.overlapMs(s.startMs, s.endMs, seg.startMs, seg.endMs) > 0);
    if (trendShot && beat.trend && String(trendShot.trend).toUpperCase() !== String(beat.trend).toUpperCase()) {
      add(makeFinding("MULTIMODAL_CONTRADICTION", {
        ...base, shotId: trendShot.shotId, key: `${beat.beatId}:trend`, reasonClass: "TREND_CONFLICT",
        reason: `narration trend ${beat.trend} contradicts the chart trend ${trendShot.trend}`,
        evidenceRefs: [`segment:${seg.segmentId}`, `shot:${trendShot.shotId}`, "phase4:TREND_MISMATCH"],
        correctiveAction: "TECHNICAL_QC_ROUTE:TREND_MISMATCH (Phase 4 semantic taxonomy)", confidence: "HIGH",
      }));
    }

    // Audio ↔ visual energy.
    const pb = perBeat.get(beat.beatId);
    const nrg = Number.isFinite(beat.narrativeEnergy) ? beat.narrativeEnergy : pb.tension;
    const audioSide = [nrg, ch.musicEnergy].filter((x) => x !== null && x !== undefined);
    const anyMotionData = input.shots.some((s) => Number.isFinite(s.motionIntensity) && T.overlapMs(s.startMs, s.endMs, seg.startMs, seg.endMs) > 0);
    const rest = beat.intent.rest === true || beat.intent.slow === true;
    if (anyMotionData && audioSide.length > 0 && !rest) {
      const aud = audioSide.reduce((a, b) => a + b, 0) / audioSide.length;
      const vis = ch.motionIntensityMax;
      if (Math.abs(vis - aud) >= W.avEnergyGap) {
        add(makeFinding("AUDIO_VISUAL_ENERGY_MISMATCH", {
          ...base, key: beat.beatId,
          reason: `visual energy ${vis.toFixed(2)} vs audio/narrative energy ${aud.toFixed(2)} in beat ${beat.beatId}`,
          evidenceRefs: [`segment:${seg.segmentId}`, `visualEnergy:${vis.toFixed(2)}`, `audioEnergy:${aud.toFixed(2)}`],
          correctiveAction: "MOTION_PATCH:match movement intensity to the beat energy (or adjust the cue)", confidence: "MEDIUM",
        }));
      }
    }

    // Payoff emphasis.
    if (beat.role === "PAYOFF" || beat.role === "REVEAL") {
      const ov = input.shots.filter((s) => T.overlapMs(s.startMs, s.endMs, seg.startMs, seg.endMs) > 0);
      const visual = ov.some((s) => EMPHASIS_PRIMITIVES.has(s.motionPrimitive) || s.motionPurpose === "EMPHASIS" || s.motionPurpose === "REVEAL");
      const idx = input.beats.findIndex((b) => b.beatId === beat.beatId);
      const prevMusic = idx > 0 ? segmentChannels(input, input.beats[idx - 1].startMs, input.beats[idx - 1].endMs).musicEnergy : null;
      const audio = (ch.musicEnergy !== null && prevMusic !== null && ch.musicEnergy - prevMusic >= 0.15)
        || input.intentionalSilence.some((s) => T.overlapMs(s.startMs, s.endMs, Math.max(0, seg.startMs - 1500), seg.startMs + 1500) > 0);
      const text = ch.onScreenTexts.length > 0;
      const duration = seg.endMs - seg.startMs >= W.payoffMinMs;
      const emphasis = [visual && "VISUAL", audio && "AUDIO", text && "ON_SCREEN_TEXT", duration && "DURATION"].filter(Boolean);
      if (emphasis.length < W.payoffEmphasisChannelsMin) {
        add(makeFinding("PAYOFF_UNDER_EMPHASIZED", {
          ...base, key: beat.beatId,
          reason: `payoff beat ${beat.beatId} gets no visual emphasis, audio emphasis, on-screen text and runs only ${seg.endMs - seg.startMs}ms`,
          evidenceRefs: [`segment:${seg.segmentId}`, "emphasisChannels:none"],
          correctiveAction: "PAYOFF_EMPHASIS_PATCH:add a reveal move, cue swell, caption emphasis or a longer hold", confidence: "MEDIUM",
        }));
      }
    }
  }

  // Transition continuity.
  for (const s of input.shots) {
    if (!HEAVY_TRANSITIONS.has(s.transitionIn) || s.cutMotivation) continue;
    const prev = input.beats.find((b) => b.endMs > s.startMs - 1 && b.startMs < s.startMs);
    const next = input.beats.find((b) => b.startMs <= s.startMs && b.endMs > s.startMs);
    if (!prev || !next || prev.beatId === next.beatId) continue;
    const sim = T.jaccard(T.contentTokens(prev.text), T.contentTokens(next.text));
    if (sim >= 0.35 && prev.sceneId && prev.sceneId === next.sceneId) {
      add(makeFinding("TRANSITION_CREATIVE_BREAK", {
        beatId: next.beatId, sceneId: next.sceneId, shotId: s.shotId, startMs: s.startMs - 500, endMs: s.startMs + 500, key: s.shotId,
        reason: `a ${s.transitionIn} transition cuts through continuous material (beat similarity ${sim.toFixed(2)}, same scene) with no stated cut motivation`,
        evidenceRefs: [`shot:${s.shotId}`, `beat:${prev.beatId}`, `beat:${next.beatId}`], correctiveAction: "TRANSITION_PATCH:use CUT/CROSSFADE inside a continuous scene", confidence: "LOW",
      }));
    }
  }

  // Outro momentum.
  {
    const D = input.durationMs;
    const tailStart = D - Math.max(D * W.outroTailShare, W.outroMinTailMs);
    const tail = beatReport.beats.filter((b) => b.startMs >= tailStart - 1);
    const flat = tail.filter((b) => b.newInfoCount < 2 && ["REFLECTION", "CTA", "OUTRO", "CONTEXT", "SETUP"].includes(b.role) && b.status !== "DELIBERATE_REST");
    const flatMs = flat.reduce((s, b) => s + b.durationMs, 0);
    if (flatMs >= W.outroMaxFlatMs) {
      const first = flat[0];
      add(makeFinding("OUTRO_LOSES_MOMENTUM", {
        beatId: first.beatId, startMs: first.startMs, endMs: D, key: "outro",
        reason: `the last ${Math.round(flatMs / 1000)}s carries no new information (${flat.map((b) => b.role).join("/")}) — momentum drains before the end`,
        evidenceRefs: flat.map((b) => `beat:${b.beatId}`), correctiveAction: "SCRIPT_TRIM:tighten the outro or end on the payoff", confidence: "MEDIUM",
      }));
    }
  }

  // Opening composites — corroborate a hook finding with the NON-narration channels.
  const hookBy = (code) => hookReport.findings.find((f) => f.code === code && f.status === "OPEN");
  const first8 = segmentChannels(input, 0, Math.min(8000, input.durationMs));
  const first5 = segmentChannels(input, 0, Math.min(5000, input.durationMs));
  const slow = hookBy("HOOK_SETUP_TOO_LONG");
  if (slow && first8.visualLabels.length === 0 && first8.motionIntensityMax < 0.2) {
    add(makeFinding("OPENING_TOO_SLOW", { startMs: 0, endMs: 8000, key: "slow", relatedFindingIds: [slow.findingId], reason: "the opening is setup-only in narration AND the picture shows no meaningful visual or movement for the first 8s", evidenceRefs: [`finding:${slow.findingId}`, "channel:VISUAL", "channel:NARRATION"], correctiveAction: "OPENING_EDIT:start on the subject; cut preamble/logo", confidence: "MEDIUM" }));
  }
  const over = hookBy("HOOK_OVERLOADED");
  if (over && (first5.motionIntensityMax >= 0.6 || first5.overlayCountMax >= 2 || first5.onScreenSimultaneous >= 3)) {
    add(makeFinding("OPENING_OVERLOADED", { startMs: 0, endMs: 5000, key: "over", relatedFindingIds: [over.findingId], reason: "dense narration is paired with heavy motion/overlays in the first 5s", evidenceRefs: [`finding:${over.findingId}`, "channel:VISUAL", "channel:NARRATION"], correctiveAction: "SCRIPT_TRIM:simplify the opening visual and trim the first sentence", confidence: "MEDIUM" }));
  }
  const late = hookBy("PACKAGING_PROMISE_DELAYED") || hookBy("HOOK_PROMISE_DELAYED");
  if (late) {
    const terms = (hookReport.packagingPromise.openingMustEstablish || []).map((t) => T.contentTokens(t)).filter((t) => t.size > 0);
    const first15 = segmentChannels(input, 0, Math.min(15000, input.durationMs));
    const visualTokens = T.contentTokens([...first15.visualLabels, ...first15.onScreenTexts].join(" "));
    const carried = terms.length > 0 && T.coverage(terms[0], visualTokens) >= 0.6; // primary promise term
    if (!carried) {
      add(makeFinding("OPENING_PROMISE_WEAK", { startMs: 0, endMs: 15000, key: "promise", relatedFindingIds: [late.findingId], reason: "neither the picture nor on-screen text carries the promised subject in the first 15s, and the narration establishes it late", evidenceRefs: [`finding:${late.findingId}`, "channel:VISUAL", "channel:ON_SCREEN_TEXT"], correctiveAction: "OPENING_EDIT:show/label the promised subject in the first seconds", confidence: "MEDIUM" }));
    }
  }
  return findings;
}

// ---- reviewer integration -----------------------------------------------------------------
function runReviewer(reviewer, input, segments, deterministic, evidence, opts) {
  const trace = {
    provider: reviewer.provider, model: reviewer.model, modelVersion: reviewer.modelVersion || null, rubricVersion: reviewer.rubricVersion,
    samplingStrategy: reviewer.samplingStrategy || "ALL_SEGMENTS", videoSha256: evidence.consumed ? evidence.sha256 : null,
    segmentHashes: [], costUsd: 0, latencyMs: 0, calls: 0, tokens: 0,
  };
  const findings = [];
  const rejected = [];
  const clears = [];
  const max = Number.isFinite(opts.maxReviewedSegments) ? opts.maxReviewedSegments : 40;
  const reviewable = segments.filter((s) => s.kind !== "SUPPLEMENT" || s.endMs - s.startMs > 0).slice(0, max);
  for (const seg of reviewable) {
    const t0 = Date.now();
    const res = reviewer.review({ segment: seg, channels: seg.channels, deterministicFindingIds: deterministic.filter((f) => T.overlapMs(f.startMs || 0, f.endMs || 0, seg.startMs, seg.endMs) > 0).map((f) => f.findingId), video: evidence.consumed ? { sha256: evidence.sha256, range: { startMs: seg.startMs, endMs: seg.endMs } } : null }) || {};
    trace.calls += 1;
    trace.segmentHashes.push(seg.segmentHash);
    trace.costUsd += Number(res.costUsd) || 0;
    trace.tokens += Number(res.tokens) || 0;
    trace.latencyMs += Number.isFinite(res.latencyMs) ? res.latencyMs : Date.now() - t0;
    for (const c of res.clears || []) clears.push({ ...c, startMs: c.startMs ?? seg.startMs, endMs: c.endMs ?? seg.endMs });
    for (const r of res.findings || []) {
      if (!FINDING_CATALOG[r.code] || !r.reason || !Array.isArray(r.evidenceRefs) || r.evidenceRefs.length === 0) { rejected.push({ code: r.code, why: "NOT_IN_CATALOG_OR_NOT_ACTIONABLE" }); continue; }
      findings.push(makeFinding(r.code, { ...r, startMs: r.startMs ?? seg.startMs, endMs: r.endMs ?? seg.endMs, source: "MODEL", key: `${r.key || ""}:${seg.segmentId}` }));
    }
  }
  trace.costUsd = Number(trace.costUsd.toFixed(6));
  return { trace, findings, clears, rejected };
}

function reconcile(deterministic, model) {
  const extra = [];
  const out = [];
  const det = deterministic.map((f) => ({ ...f }));
  for (const c of model.clears) {
    for (const f of det) {
      if (f.code === c.code && (f.status === "OPEN") && ["P1", "P2"].includes(f.severity) && T.overlapMs(f.startMs || 0, f.endMs || 0, c.startMs, c.endMs) > 0) {
        f.status = "REVIEW_REQUIRED";
        f.statusReason = "reviewer marked the same code CLEAR while deterministic evidence disagrees";
        extra.push(makeFinding("MODEL_DISAGREEMENT", {
          startMs: f.startMs, endMs: f.endMs, beatId: f.beatId, key: `clear:${f.findingId}`, status: "REVIEW_REQUIRED", relatedFindingIds: [f.findingId],
          reason: `deterministic ${f.code} (${f.reasonClass}) vs reviewer CLEAR over the same span — not averaged`,
          evidenceRefs: [`finding:${f.findingId}`, "reviewer:clear"], correctiveAction: "REVIEW_ONLY:human/agent adjudication of the conflicting evidence", confidence: "HIGH",
        }));
      }
    }
  }
  for (const m of model.findings) {
    if (MEASURABLE.has(m.code) && !det.some((f) => f.code === m.code && T.overlapMs(f.startMs || 0, f.endMs || 0, m.startMs || 0, m.endMs || 0) > 0)) {
      const mm = { ...m, status: "REVIEW_REQUIRED", statusReason: "measurable claim without deterministic support" };
      out.push(mm);
      extra.push(makeFinding("MODEL_DISAGREEMENT", {
        startMs: m.startMs, endMs: m.endMs, beatId: m.beatId, key: `claim:${m.findingId}`, status: "REVIEW_REQUIRED", relatedFindingIds: [m.findingId],
        reason: `reviewer reports ${m.code} but structured state does not measure it — not averaged`,
        evidenceRefs: [`finding:${m.findingId}`, "deterministic:not-measured"], correctiveAction: "REVIEW_ONLY:verify against structured timeline/motion data", confidence: "HIGH",
      }));
    } else out.push(m);
  }
  return { findings: [...det, ...out, ...extra] };
}

/**
 * runWatchPass({ input, mode, beatReport, hookReport, rhythmReport, affected?, reviewer?, requireVideo?, probeVideo?, maxReviewedSegments? })
 */
function runWatchPass(args) {
  const { input, mode = "FULL_WATCH", beatReport, hookReport, rhythmReport, affected, reviewer, requireVideo = true } = args;
  if (!MODES.includes(mode)) throw new Error(`INVALID_WATCH_MODE:${mode}`);
  if (mode === "SEGMENT_REWATCH" && !(affected && Number.isFinite(affected.startMs) && Number.isFinite(affected.endMs))) {
    throw new Error("SEGMENT_REWATCH requires affected {startMs,endMs}");
  }
  const t0 = Date.now();
  const { segments, coreRange } = buildSegments(input, { mode, affected });
  const evidence = videoEvidence(input, args);
  const det = deterministicChecks(input, beatReport, hookReport, segments);
  // Findings from the other three analyses participate in the roll-up.
  const upstream = [...hookReport.findings, ...beatReport.findings, ...rhythmReport.findings];
  let all = [...upstream, ...det];
  let reviewerBlock = { mode: "DETERMINISTIC_ONLY" };
  if (reviewer) {
    const m = runReviewer(reviewer, input, segments, all, evidence, args);
    all = reconcile(all, m).findings;
    reviewerBlock = { mode: "MODEL_ASSISTED", trace: m.trace, rejectedModelFindings: m.rejected };
  }
  // Mode scoping: a segment rewatch only judges its own window (+context).
  let scoped = all;
  if (mode === "SEGMENT_REWATCH") {
    scoped = all.filter((f) => f.startMs === undefined || T.overlapMs(f.startMs, f.endMs ?? f.startMs + 1, coreRange.contextStartMs, coreRange.contextEndMs) > 0);
  }
  const covered = unionRanges(segments);
  const coveredMs = covered.reduce((s, r) => s + (r.endMs - r.startMs), 0);
  const targetMs = mode === "FULL_WATCH" ? input.durationMs : coreRange.contextEndMs - coreRange.contextStartMs;
  const coverageShare = Number((Math.min(coveredMs, targetMs) / Math.max(targetMs, 1)).toFixed(3));

  const blockers = [];
  if (requireVideo && !evidence.consumed) blockers.push(`FINAL_VIDEO_NOT_CONSUMED:${evidence.reason}`);
  if (evidence.consumed && evidence.durationMatchesTimeline === false) blockers.push("VIDEO_TIMELINE_DURATION_MISMATCH");
  if (mode === "FULL_WATCH" && coverageShare < W.coverageMinShare) blockers.push(`SEGMENT_COVERAGE_BELOW_${W.coverageMinShare}`);
  const counts = countBySeverity(scoped);
  const open = scoped.filter((f) => f.status === "OPEN" || f.status === "REVIEW_REQUIRED");
  let verdict;
  if (counts.P0 > 0 || counts.P1 > 0) verdict = "FAIL";
  else if (open.some((f) => f.status === "REVIEW_REQUIRED") || blockers.length > 0) verdict = "REVIEW_REQUIRED";
  else verdict = "PASS";

  return {
    kind: "MULTIMODAL_WATCH",
    version: WATCH_VERSION,
    policyVersion: POLICY_VERSION,
    watchId: `wp-${sha16({ p: input.projectId, mode, fp: input.inputFingerprint, a: affected || null })}`,
    projectId: input.projectId,
    mode,
    inputFingerprint: input.inputFingerprint,
    channelsEvaluated: ["VIDEO", "AUDIO", "NARRATION", "MUSIC", "SFX", "CAPTIONS", "ON_SCREEN_TEXT", "NARRATIVE_CONTEXT", "PACKAGING_PROMISE"],
    video: evidence,
    reviewer: reviewerBlock,
    ...(coreRange ? { affected: coreRange } : {}),
    segments: segments.map(({ channels, ...s }) => ({ ...s, channelSummary: { wps: channels.narrationWps, cps: channels.captionCps, motion: channels.motionIntensityMax, music: channels.musicEnergy, sfx: channels.sfxCount, modalities: channels.modalities } })),
    coverage: { coveredMs, targetMs, share: coverageShare },
    blockers,
    verdict,
    counts: { open: counts, total: scoped.length },
    findings: scoped,
    latencyMs: Date.now() - t0,
  };
}

/**
 * After a SEGMENT_REWATCH: findings inside the affected window that were not
 * re-detected become REPAIRED; findings outside stay untouched; new ones open.
 */
function mergeRewatch(previousFindings, rewatch) {
  const win = rewatch.affected;
  const byId = new Map(rewatch.findings.map((f) => [f.findingId, f]));
  const merged = [];
  for (const f of previousFindings) {
    const inWin = f.startMs !== undefined && T.overlapMs(f.startMs, f.endMs ?? f.startMs + 1, win.startMs, win.endMs) > 0;
    if (!inWin) { merged.push(f); continue; }
    if (byId.has(f.findingId)) { merged.push(byId.get(f.findingId)); byId.delete(f.findingId); }
    else if (f.status === "OPEN" || f.status === "REVIEW_REQUIRED") merged.push({ ...f, status: "REPAIRED", statusReason: "not re-detected in SEGMENT_REWATCH" });
    else merged.push(f);
  }
  for (const f of byId.values()) merged.push(f);
  return merged;
}

module.exports = { WATCH_VERSION, MODES, buildSegments, segmentChannels, quantities, runWatchPass, mergeRewatch, reconcile };
