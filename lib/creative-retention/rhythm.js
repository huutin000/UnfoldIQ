"use strict";

/**
 * Phase 6A §22–§31 — Visual Rhythm + CreativeFingerprint (UNFOLDIQ CORE).
 *
 * Visual rhythm is PURPOSEFUL temporal variation, not maximum cuts or
 * constant novelty (RULE 9). There is NO universal shot-duration quota
 * (RULE 10): durations are measured, patterns (identical streaks, constant
 * zoom, mechanical alternation) are flagged, and deliberate rest/static
 * shots are preserved — they break streaks and are never findings.
 *
 * Motion intent reuses Phase 3B MotionPlan metadata (primitive, direction,
 * timing preset, purpose, layer). 6A COLLECTS cross-video features
 * (CreativeFingerprint); 6B owns originality judgment (RULE 12).
 */

const { makeFinding, sha16 } = require("./contract.js");
const { RHYTHM_POLICY: P, POLICY_VERSION } = require("./policy.js");
const T = require("./text.js");

const ZOOM_FAMILY = new Set(["ZOOM", "PUSH", "PULL", "KEN_BURNS"]);

function median(a) {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(a, p) {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function entropy(items) {
  if (items.length === 0) return 0;
  const c = new Map();
  for (const i of items) c.set(i, (c.get(i) || 0) + 1);
  if (c.size === 1) return 0;
  let h = 0;
  for (const n of c.values()) { const p = n / items.length; h -= p * Math.log2(p); }
  return Number((h / Math.log2(c.size)).toFixed(3));
}

/** Maximal runs where keyFn is equal and non-null. Returns [{from,to,key}] (inclusive indexes). */
function runs(seq, keyFn, minLen) {
  const out = [];
  let from = 0;
  for (let i = 1; i <= seq.length; i++) {
    const same = i < seq.length && keyFn(seq[i], seq[i - 1]) && keyFn(seq[i], seq[i - 1]) === keyFn(seq[from], seq[from]);
    if (!same) {
      const k = seq.length ? keyFn(seq[from], null) : null;
      if (k && i - from >= minLen) out.push({ from, to: i - 1, key: k });
      from = i;
    }
  }
  return out;
}

const isMoving = (s) => s.isStatic !== true && !!s.motionPrimitive && s.motionPrimitive !== "CUT" && s.motionPrimitive !== "STATIC";
const isRest = (s, input) => s.restIntent === true || s.motionPurpose === "VISUAL_REST" || input.beats.some((b) => (b.intent.rest === true || b.intent.slow === true) && (s.beatId === b.beatId || (T.overlapMs(s.startMs, s.endMs, b.startMs, b.endMs) >= (s.endMs - s.startMs) * 0.5)));
const dur = (s) => s.endMs - s.startMs;

function contained(a, ranges) {
  return ranges.some((r) => a.from >= r.from && a.to <= r.to);
}

function beatRoleForShot(input, s) {
  const b = input.beats.find((x) => x.beatId === s.beatId) || input.beats.find((x) => T.overlapMs(s.startMs, s.endMs, x.startMs, x.endMs) > 0);
  return b ? b.role : null;
}

function avgMusic(input, a, b) {
  let acc = 0;
  let cover = 0;
  for (const m of input.music) {
    const o = T.overlapMs(m.startMs, m.endMs, a, b);
    if (o > 0) { acc += m.energy * o; cover += o; }
  }
  return cover > 0 ? acc / cover : null;
}

function analyzeRhythm(input, opts = {}) {
  const shots = input.shots;
  const findings = [];
  const durations = shots.map(dur);
  const med = median(durations);
  const rangeOf = (from, to) => ({ startMs: shots[from].startMs, endMs: shots[to].endMs });
  const idsOf = (from, to) => shots.slice(from, to + 1).map((s) => s.shotId);

  // ---- shot-duration pattern: identical streaks, long holds, rapid-cut bursts (metric)
  let identicalStreakMax = 0;
  {
    let from = 0;
    for (let i = 1; i <= shots.length; i++) {
      const same = i < shots.length && Math.abs(durations[i] - durations[from]) <= P.identicalDurationToleranceMs;
      if (!same) {
        const len = i - from;
        identicalStreakMax = Math.max(identicalStreakMax, len);
        if (len >= P.identicalDurationStreak) {
          const r = rangeOf(from, i - 1);
          findings.push(makeFinding("VISUAL_TOO_REPETITIVE", {
            ...r, shotId: shots[from].shotId, key: `identical:${shots[from].shotId}`, severity: len >= 6 ? "P2" : "P3", reasonClass: "IDENTICAL_DURATION",
            reason: `${len} consecutive shots last ≈${Math.round(durations[from])}ms (±${P.identicalDurationToleranceMs}ms) — mechanical cut rhythm`,
            evidenceRefs: [...idsOf(from, i - 1).map((id) => `shot:${id}`), `streak:${len}`],
            correctiveAction: "VISUAL_TIMING_PATCH:retime cuts to follow beat/speech boundaries instead of a fixed interval",
            confidence: "MEDIUM",
          }));
        }
        from = i;
      }
    }
  }
  let longHolds = 0;
  shots.forEach((s) => {
    if (dur(s) >= P.longHoldMinMs && dur(s) >= med * P.longHoldMedianMultiple && !isRest(s, input) && s.isStatic !== true) {
      longHolds += 1;
      findings.push(makeFinding("VISUAL_TOO_REPETITIVE", {
        startMs: s.startMs, endMs: s.endMs, shotId: s.shotId, key: `hold:${s.shotId}`, severity: "P3", reasonClass: "LONG_HOLD",
        reason: `shot ${s.shotId} holds ${Math.round(dur(s) / 1000)}s (${(dur(s) / Math.max(med, 1)).toFixed(1)}× the median) without a rest/slow intent`,
        evidenceRefs: [`shot:${s.shotId}`, `durationMs:${dur(s)}`, `medianMs:${Math.round(med)}`],
        correctiveAction: "VISUAL_TIMING_PATCH:add a visual progression inside the hold or declare it deliberate rest",
        confidence: "LOW",
      }));
    }
  });
  let rapidBursts = 0;
  {
    let run = 0;
    for (let i = 0; i <= shots.length; i++) {
      if (i < shots.length && durations[i] < P.rapidCutMs) run += 1;
      else { if (run >= P.rapidCutBurst) rapidBursts += 1; run = 0; }
    }
  }

  // ---- motion rhythm (static / rest shots break streaks and are valid)
  const flaggedRanges = [];
  const motionKey = (s) => (isMoving(s) ? s.motionPrimitive : null);
  const zoomKey = (s) => (isMoving(s) && ZOOM_FAMILY.has(s.motionPrimitive) ? "ZOOM_FAMILY" : null);
  for (const r of runs(shots, zoomKey, P.constantZoomMinShots)) {
    flaggedRanges.push(r);
    findings.push(makeFinding("REPETITIVE_MOTION_RHYTHM", {
      ...rangeOf(r.from, r.to), shotId: shots[r.from].shotId, key: `zoom:${shots[r.from].shotId}`, reasonClass: "CONSTANT_ZOOM",
      reason: `${r.to - r.from + 1} consecutive shots use a zoom/push/pull/ken-burns move with no static or different movement in between`,
      evidenceRefs: [...idsOf(r.from, r.to).map((id) => `shot:${id}`), `primitives:${[...new Set(shots.slice(r.from, r.to + 1).map((s) => s.motionPrimitive))].join("/")}`],
      correctiveAction: "MOTION_PATCH:keep movement only where it directs attention; SET_STATIC or REPLACE_PRIMITIVE on alternate shots",
      confidence: "HIGH",
    }));
  }
  for (const r of runs(shots, motionKey, P.sameMotionStreak)) {
    if (contained(r, flaggedRanges)) continue;
    flaggedRanges.push(r);
    findings.push(makeFinding("REPETITIVE_MOTION_RHYTHM", {
      ...rangeOf(r.from, r.to), shotId: shots[r.from].shotId, key: `prim:${shots[r.from].shotId}`, reasonClass: "SAME_PRIMITIVE",
      reason: `${r.to - r.from + 1} consecutive shots use the same motion primitive ${r.key}`,
      evidenceRefs: [...idsOf(r.from, r.to).map((id) => `shot:${id}`), `primitive:${r.key}`],
      correctiveAction: "MOTION_PATCH:REPLACE_PRIMITIVE / SET_STATIC on alternating shots (Phase 3B patchMotion)",
      confidence: "HIGH",
    }));
  }
  const dirKey = (s) => (isMoving(s) && s.motionDirection ? String(s.motionDirection) : null);
  for (const r of runs(shots, dirKey, P.sameDirectionStreak)) {
    if (contained(r, flaggedRanges)) continue;
    flaggedRanges.push(r);
    findings.push(makeFinding("MOTION_TOO_REPETITIVE", {
      ...rangeOf(r.from, r.to), shotId: shots[r.from].shotId, key: `dir:${shots[r.from].shotId}`, reasonClass: "SAME_DIRECTION",
      reason: `${r.to - r.from + 1} consecutive moves travel ${r.key}`,
      evidenceRefs: [...idsOf(r.from, r.to).map((id) => `shot:${id}`), `direction:${r.key}`],
      correctiveAction: "MOTION_PATCH:vary direction or hold a static shot between moves", confidence: "MEDIUM",
    }));
  }
  const timingKey = (s) => (isMoving(s) && s.timingPreset ? s.timingPreset : null);
  for (const r of runs(shots, timingKey, P.sameTimingStreak)) {
    if (contained(r, flaggedRanges)) continue;
    findings.push(makeFinding("MOTION_TOO_REPETITIVE", {
      ...rangeOf(r.from, r.to), shotId: shots[r.from].shotId, key: `timing:${shots[r.from].shotId}`, reasonClass: "SAME_TIMING",
      reason: `${r.to - r.from + 1} consecutive moves share the timing preset ${r.key}`,
      evidenceRefs: [...idsOf(r.from, r.to).map((id) => `shot:${id}`), `timingPreset:${r.key}`],
      correctiveAction: "MOTION_PATCH:CHANGE_TIMING_PRESET on some shots", confidence: "MEDIUM",
    }));
  }
  // Global constant zoom: no static/rest variation at all.
  const zoomShare = shots.length ? shots.filter((s) => isMoving(s) && ZOOM_FAMILY.has(s.motionPrimitive)).length / shots.length : 0;
  if (shots.length >= P.constantZoomMinShots && zoomShare >= P.constantZoomShare && flaggedRanges.length === 0) {
    findings.push(makeFinding("REPETITIVE_MOTION_RHYTHM", {
      startMs: shots[0].startMs, endMs: shots[shots.length - 1].endMs, key: "zoom-global", scope: "GLOBAL", reasonClass: "CONSTANT_ZOOM",
      reason: `${Math.round(zoomShare * 100)}% of ${shots.length} shots zoom/push — near-constant zoom with little static variation`,
      evidenceRefs: [`zoomShare:${zoomShare.toFixed(2)}`, `shots:${shots.length}`],
      correctiveAction: "MOTION_PATCH:introduce deliberate static shots", confidence: "MEDIUM",
    }));
  }

  // ---- motion without editorial purpose
  const moving = shots.filter(isMoving);
  // Spec §26: valid purposes direct attention / reveal info / support energy / follow subject / explain structure.
  // Phase 3B REDUCE_MONOTONY alone is NOT editorial value (it only avoids sameness).
  const unjustified = moving.filter((s) => !s.motionPurpose || s.motionPurpose === "NONE" || s.motionPurpose === "REDUCE_MONOTONY" || s.motionLayer === "DECORATIVE");
  if (moving.length >= 3 && unjustified.length / moving.length >= P.unjustifiedMotionShare) {
    findings.push(makeFinding("MOTION_WITHOUT_EDITORIAL_VALUE", {
      startMs: unjustified[0].startMs, endMs: unjustified[unjustified.length - 1].endMs, shotId: unjustified[0].shotId, key: "aggregate", severity: "P2",
      reason: `${unjustified.length}/${moving.length} moving shots do not direct attention, reveal information, follow a subject, support energy or explain structure`,
      evidenceRefs: unjustified.slice(0, 8).map((s) => `shot:${s.shotId}`),
      correctiveAction: "MOTION_PATCH:SET_STATIC on purposeless moves (Phase 3B motion-purpose metadata)", confidence: "MEDIUM",
    }));
  } else {
    for (const s of unjustified) {
      findings.push(makeFinding("MOTION_WITHOUT_EDITORIAL_VALUE", {
        startMs: s.startMs, endMs: s.endMs, shotId: s.shotId, key: s.shotId,
        reason: `shot ${s.shotId} moves (${s.motionPrimitive}) without a stated editorial purpose`,
        evidenceRefs: [`shot:${s.shotId}`, `primitive:${s.motionPrimitive}`], correctiveAction: "MOTION_PATCH:SET_STATIC or declare the purpose", confidence: "LOW",
      }));
    }
  }

  // ---- Veo utilization (no universal percentage; only unnecessary generative motion)
  const veo = shots.filter((s) => s.modality === "VEO");
  const totalDur = shots.reduce((a, s) => a + dur(s), 0) || 1;
  let maxConsecutiveVeo = 0;
  {
    let run = 0;
    for (const s of shots) { run = s.modality === "VEO" ? run + 1 : 0; maxConsecutiveVeo = Math.max(maxConsecutiveVeo, run); }
  }
  for (const s of veo) {
    const explicit = s.generativeMotionNeeded;
    const derivedKnown = s.visualNeed !== undefined || s.actionIntent !== undefined;
    const needed = explicit !== undefined ? explicit : derivedKnown ? (s.visualNeed === "MOTION" || !!s.actionIntent) : null;
    if (needed === false) {
      findings.push(makeFinding("UNNECESSARY_GENERATIVE_MOTION", {
        startMs: s.startMs, endMs: s.endMs, shotId: s.shotId, key: s.shotId,
        reason: `Veo shot ${s.shotId} carries no subject motion/action that a still image + Remotion move (or chart/diagram) could not communicate at lower cost and distraction`,
        evidenceRefs: [`shot:${s.shotId}`, `modality:VEO`, `visualNeed:${s.visualNeed || "n/a"}`],
        correctiveAction: "ASSET_MODALITY_REPLACE:replace with Image + Remotion (or chart/diagram) when quality-equivalent", confidence: "MEDIUM",
      }));
    }
  }
  const beatCountVeo = new Set(veo.map((s) => s.beatId).filter(Boolean)).size;

  // ---- framing / modality rhythm
  const framingKey = (s) => (s.framing ? String(s.framing) : null);
  for (const r of runs(shots, framingKey, P.framingStreak)) {
    findings.push(makeFinding("FRAMING_REPETITION", {
      ...rangeOf(r.from, r.to), shotId: shots[r.from].shotId, key: `frame:${shots[r.from].shotId}`, reasonClass: "SAME_FRAMING",
      reason: `${r.to - r.from + 1} consecutive shots use the same framing "${r.key}"`,
      evidenceRefs: [...idsOf(r.from, r.to).map((id) => `shot:${id}`), `framing:${r.key}`],
      correctiveAction: "FRAMING_LAYOUT_PATCH:vary crop/subject scale/composition", confidence: "MEDIUM",
    }));
  }
  let altMax = 0;
  {
    let run = 1;
    const side = (s) => { const d = String(s.motionDirection || "").toUpperCase(); return d === "LEFT" || d === "L" ? "L" : d === "RIGHT" || d === "R" ? "R" : null; };
    let flagged = false;
    for (let i = 1; i < shots.length; i++) {
      const a = side(shots[i - 1]);
      const b = side(shots[i]);
      if (a && b && a !== b) run += 1; else run = 1;
      altMax = Math.max(altMax, run);
      if (run >= P.mechanicalAlternationRun && !flagged) {
        flagged = true;
        findings.push(makeFinding("FRAMING_REPETITION", {
          ...rangeOf(i - run + 1, i), shotId: shots[i - run + 1].shotId, key: `alt:${shots[i - run + 1].shotId}`, reasonClass: "MECHANICAL_ALTERNATION",
          reason: `${run} shots alternate left/right in a fixed pattern`,
          evidenceRefs: idsOf(i - run + 1, i).map((id) => `shot:${id}`),
          correctiveAction: "FRAMING_LAYOUT_PATCH:break the L/R alternation", confidence: "MEDIUM",
        }));
      }
    }
  }
  let maxModalityStreak = 0;
  {
    const mk = (s) => s.modality;
    for (const r of runs(shots, mk, 1)) maxModalityStreak = Math.max(maxModalityStreak, r.to - r.from + 1);
    for (const r of runs(shots, mk, P.modalityMonotonyMinShots)) {
      const roles = new Set(shots.slice(r.from, r.to + 1).map((s) => beatRoleForShot(input, s)).filter(Boolean));
      if (roles.size >= P.modalityMonotonyMinRoles) {
        findings.push(makeFinding("MODALITY_MONOTONY", {
          ...rangeOf(r.from, r.to), key: `mod:${shots[r.from].shotId}`, reasonClass: "MODALITY_PATTERN",
          reason: `${r.to - r.from + 1} consecutive shots stay ${r.key} while the beat role changes across ${[...roles].join("/")}`,
          evidenceRefs: [...idsOf(r.from, r.to).slice(0, 8).map((id) => `shot:${id}`), `modality:${r.key}`],
          correctiveAction: "ASSET_MODALITY_REPLACE:match modality to beat role (chart/diagram/map/still)", confidence: "MEDIUM",
        }));
      }
    }
  }

  // ---- visual rest ranges (preserved, never flagged)
  const visualRestRanges = shots.filter((s) => isRest(s, input) || (s.isStatic === true && s.restIntent !== false && dur(s) >= 2500 && !s.motionPrimitive))
    .map((s) => ({ shotId: s.shotId, startMs: s.startMs, endMs: s.endMs, declared: isRest(s, input) }));

  // ---- caption-aware rhythm (reading load vs motion/cut rate)
  const capFindings = [];
  for (const c of input.captions) {
    const sec = Math.max((c.endMs - c.startMs) / 1000, 0.001);
    const cps = c.text.replace(/\s+/g, " ").trim().length / sec;
    if (cps < P.captionCpsOverload) continue;
    const overlapShots = shots.filter((s) => T.overlapMs(s.startMs, s.endMs, c.startMs, c.endMs) > 0);
    const intense = overlapShots.filter((s) => (Number(s.motionIntensity) || 0) >= P.captionMotionIntensity);
    const cuts = overlapShots.filter((s) => s.startMs > c.startMs && s.startMs < c.endMs).length;
    const overlays = Math.max(0, ...overlapShots.map((s) => Number(s.overlayCount) || 0), maxSim(input.onScreen, c.startMs, c.endMs));
    const cutRate = cuts / sec;
    if (intense.length > 0 || cutRate >= P.captionCutRatePerSec || overlays >= 2) {
      capFindings.push({ c, cps, intense, cutRate, overlays });
    }
  }
  // merge adjacent overloaded captions
  const merged = [];
  for (const o of capFindings) {
    const last = merged[merged.length - 1];
    if (last && o.c.startMs - last.endMs <= 500) { last.endMs = o.c.endMs; last.items.push(o); } else merged.push({ startMs: o.c.startMs, endMs: o.c.endMs, items: [o] });
  }
  for (const m of merged) {
    const worst = m.items.reduce((a, b) => (b.cps > a.cps ? b : a));
    findings.push(makeFinding("CAPTION_MOTION_OVERLOAD", {
      startMs: m.startMs, endMs: m.endMs, key: `cap:${m.startMs}`,
      reason: `caption density ${worst.cps.toFixed(1)} chars/s (cap ${P.captionCpsOverload}) coincides with ${worst.intense.length ? "intense motion" : worst.overlays >= 2 ? `${worst.overlays} simultaneous overlays` : `${worst.cutRate.toFixed(2)} cuts/s`}`,
      evidenceRefs: [`caption:${worst.c.startMs}-${worst.c.endMs}`, `cps:${worst.cps.toFixed(1)}`],
      correctiveAction: "CAPTION_MOTION_REDUCTION:reduce motion/cuts/overlays under dense captions; do not rewrite caption meaning", confidence: "MEDIUM",
    }));
  }

  // ---- audio / music rhythm context (energy supports narrative, via Phase 2 contracts)
  const beatTension = new Map(((opts.beatReport && opts.beatReport.beats) || []).map((b) => [b.beatId, b.tension]));
  const narrativeEnergyTimeline = [];
  const musicEnergyTimeline = [];
  for (const b of input.beats) {
    const ne = Number.isFinite(b.narrativeEnergy) ? b.narrativeEnergy : beatTension.has(b.beatId) ? beatTension.get(b.beatId) : null;
    narrativeEnergyTimeline.push({ beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, energy: ne === null ? null : Number(ne.toFixed(3)) });
    const me = avgMusic(input, b.startMs, b.endMs);
    if (me !== null) musicEnergyTimeline.push({ beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, energy: Number(me.toFixed(3)) });
    const silent = input.intentionalSilence.some((s) => T.overlapMs(s.startMs, s.endMs, b.startMs, b.endMs) >= (b.endMs - b.startMs) * 0.5);
    if (ne === null || me === null || silent) continue;
    const gap = me - ne;
    const wps = T.wordCount(b.text) / Math.max((b.endMs - b.startMs) / 1000, 0.001);
    const common = { beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, key: b.beatId };
    if (me >= P.overScoredMusic && ne <= P.overScoredNarrative && wps >= 2.5) {
      findings.push(makeFinding("OVER_SCORED_SECTION", { ...common, reason: `music energy ${me.toFixed(2)} under dense narration (${wps.toFixed(1)} words/s) while narrative energy is only ${ne.toFixed(2)}`, evidenceRefs: [`beat:${b.beatId}`, `musicEnergy:${me.toFixed(2)}`, `narrativeEnergy:${ne.toFixed(2)}`], correctiveAction: "MUSIC_MIX_PATCH:duck or swap the cue for this span (Phase 2 audio-mix contract)", confidence: "MEDIUM" }));
    } else if ((b.role === "PAYOFF" || b.role === "REVEAL") && me <= P.underScoredPayoff && ne >= 0.5) {
      findings.push(makeFinding("UNDER_SCORED_PAYOFF", { ...common, reason: `payoff beat ${b.beatId} has music energy ${me.toFixed(2)} against narrative energy ${ne.toFixed(2)} and no declared silence`, evidenceRefs: [`beat:${b.beatId}`, `musicEnergy:${me.toFixed(2)}`, `narrativeEnergy:${ne.toFixed(2)}`], correctiveAction: "MUSIC_MIX_PATCH:add a cue swell or declare intentional silence", confidence: "MEDIUM" }));
    } else if (Math.abs(gap) >= P.energyMismatchGap && b.intent.contrast !== true) {
      findings.push(makeFinding("MUSIC_ENERGY_MISMATCH", { ...common, reason: `music energy ${me.toFixed(2)} vs narrative energy ${ne.toFixed(2)} (gap ${gap.toFixed(2)})`, evidenceRefs: [`beat:${b.beatId}`, `musicEnergy:${me.toFixed(2)}`, `narrativeEnergy:${ne.toFixed(2)}`], correctiveAction: "MUSIC_MIX_PATCH:re-level or re-pick the cue; narration timing is unchanged", confidence: "MEDIUM" }));
    }
  }
  // SFX density under narration
  {
    const sfx = [...input.sfx].sort((a, b) => a.atMs - b.atMs);
    let i = 0;
    let flaggedUntil = -1;
    while (i < sfx.length) {
      const w0 = sfx[i].atMs;
      const inWin = sfx.filter((x) => x.atMs >= w0 && x.atMs < w0 + 4000);
      if (w0 >= flaggedUntil && inWin.length / 4 > P.sfxPerSecond) {
        findings.push(makeFinding("SFX_DISTRACTION", {
          startMs: w0, endMs: w0 + 4000, key: `sfx:${w0}`,
          reason: `${inWin.length} SFX events in 4s (${(inWin.length / 4).toFixed(2)}/s, cap ${P.sfxPerSecond}/s) over narration`,
          evidenceRefs: inWin.map((x) => `sfx:${x.atMs}`), correctiveAction: "MUSIC_MIX_PATCH:thin SFX events (Phase 2 SFX plan)", confidence: "LOW",
        }));
        flaggedUntil = w0 + 4000;
      }
      i += 1;
    }
  }

  const capCps = input.captions.map((c) => c.text.length / Math.max((c.endMs - c.startMs) / 1000, 0.001));
  const metrics = {
    shotCount: shots.length,
    medianMs: Math.round(med), meanMs: Math.round(mean(durations)), minMs: durations.length ? Math.min(...durations) : 0, maxMs: durations.length ? Math.max(...durations) : 0, p90Ms: percentile(durations, 0.9),
    durationCv: Number((mean(durations) ? Math.sqrt(mean(durations.map((d) => (d - mean(durations)) ** 2))) / mean(durations) : 0).toFixed(3)),
    identicalStreakMax, longHolds, rapidCutBursts: rapidBursts,
    staticShare: shots.length ? Number((shots.filter((s) => !isMoving(s)).length / shots.length).toFixed(3)) : 0,
    zoomFamilyShare: Number(zoomShare.toFixed(3)),
    primitiveEntropy: entropy(shots.map((s) => (isMoving(s) ? s.motionPrimitive : "STATIC"))),
    modalityEntropy: entropy(shots.map((s) => s.modality)),
    maxModalityStreak,
    maxSamePrimitiveStreak: Math.max(0, ...runs(shots, motionKey, 1).map((r) => r.to - r.from + 1)),
    directionAlternationMax: altMax,
    veoDurationRatio: Number((veo.reduce((a, s) => a + dur(s), 0) / totalDur).toFixed(3)),
    veoBeatRatio: input.beats.length ? Number((beatCountVeo / input.beats.length).toFixed(3)) : 0,
    maxConsecutiveVeo,
    captionCpsMean: Number(mean(capCps).toFixed(2)), captionCpsP90: Number(percentile(capCps, 0.9).toFixed(2)),
    visualRestRatio: Number((visualRestRanges.reduce((a, r) => a + (r.endMs - r.startMs), 0) / totalDur).toFixed(3)),
  };

  const fingerprint = {
    kind: "CREATIVE_FINGERPRINT",
    version: "1.0.0",
    policyVersion: POLICY_VERSION,
    projectId: input.projectId,
    inputFingerprint: input.inputFingerprint,
    shotDurationsMs: durations,
    modalitySequence: shots.map((s) => s.modality),
    framingSequence: shots.map((s) => s.framing || "UNKNOWN"),
    motionPrimitiveSequence: shots.map((s) => (isMoving(s) ? s.motionPrimitive : "STATIC")),
    transitionSequence: shots.map((s) => s.transitionIn || "CUT"),
    motionIntensityTimeline: shots.map((s) => ({ shotId: s.shotId, startMs: s.startMs, endMs: s.endMs, intensity: Number.isFinite(s.motionIntensity) ? s.motionIntensity : (isMoving(s) ? null : 0) })),
    narrativeEnergyTimeline,
    ...(musicEnergyTimeline.length ? { musicEnergyTimeline } : {}),
    visualRestRanges,
    metrics,
    anchors: {
      hookCheckpointIds: ["HOOK_5S", "HOOK_15S", "HOOK_30S"].map((c) => `${input.projectId}:${c}`),
      beatIds: input.beats.map((b) => b.beatId),
      sceneIds: [...new Set([...input.beats.map((b) => b.sceneId), ...shots.map((s) => s.sceneId)].filter(Boolean))],
      shotIds: shots.map((s) => s.shotId),
    },
  };
  fingerprint.fingerprintHash = sha16({ d: fingerprint.shotDurationsMs, m: fingerprint.modalitySequence, f: fingerprint.framingSequence, p: fingerprint.motionPrimitiveSequence, t: fingerprint.transitionSequence });

  return {
    kind: "VISUAL_RHYTHM",
    version: "1.0.0",
    policyVersion: POLICY_VERSION,
    projectId: input.projectId,
    inputFingerprint: input.inputFingerprint,
    metrics,
    visualRestRanges,
    audioContext: { narrativeEnergyTimeline, musicEnergyTimeline },
    fingerprint,
    findings,
  };
}

function maxSim(items, a, b) {
  const ev = [];
  for (const o of items) {
    const s = Math.max(o.startMs, a);
    const e = Math.min(o.endMs, b);
    if (e > s) { ev.push([s, 1]); ev.push([e, -1]); }
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) { cur += d; max = Math.max(max, cur); }
  return max;
}

module.exports = { analyzeRhythm, runs, median, percentile, entropy, isMoving, ZOOM_FAMILY };
