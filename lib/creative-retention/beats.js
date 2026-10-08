"use strict";

/**
 * Phase 6A §15–§21 — Narrative Beat Quality (UNFOLDIQ CORE).
 *
 * Consumes the existing Beat Map / Scene Graph roles + final script text +
 * timeline timing (already merged into CreativeInput). Evaluates per beat:
 * role, new information, question/open loop, tension movement (knowledge-gap
 * based, never danger-drama), payoff, semantic repetition, dead time.
 *
 * Distinctions that MUST hold (RULE 8): slow ≠ dead, static ≠ dead,
 * silence ≠ dead, intentional recap ≠ redundancy.
 */

const { makeFinding } = require("./contract.js");
const { BEAT_POLICY, POLICY_VERSION } = require("./policy.js");
const T = require("./text.js");

const RECAP_RE = /\b(to recap|in short|so far|as we (saw|said|covered)|remember (that|how)|let'?s (recap|review)|once again|to sum up|in summary)\b/i;
const RESOLVING_ROLES = new Set(["EXPLANATION", "REVEAL", "PAYOFF", "EVIDENCE", "ESCALATION", "CONTRAST"]);
const ENGAGEMENT_ROLES = new Set(["CTA", "OUTRO"]);

function sentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function beatTokens(b) {
  return T.contentTokens(b.text);
}

/** Open loops: explicit annotations first; otherwise questions in the text. */
function collectLoops(input) {
  const loops = [];
  for (const b of input.beats) {
    if (b.opensLoops.length > 0) {
      for (const l of b.opensLoops) {
        loops.push({
          loopId: l.loopId, openedBeatId: b.beatId, openedAtMs: b.startMs, openedOrder: b.order,
          question: l.question || b.text, qTokens: T.questionTokens(l.question || b.text),
          packaging: l.packaging === true, deferTo: l.deferTo || null, deferReason: l.deferReason || null, source: "ANNOTATED",
        });
      }
      continue;
    }
    const qs = sentences(b.text).filter((s) => /\?$/.test(s));
    if (qs.length > 0) {
      const q = qs[qs.length - 1];
      loops.push({
        loopId: `auto:${b.beatId}`, openedBeatId: b.beatId, openedAtMs: b.startMs, openedOrder: b.order,
        question: q, qTokens: T.questionTokens(q), packaging: false, deferTo: null, deferReason: null, source: "DETECTED",
      });
    }
  }
  return loops;
}

function resolveLoops(input, loops, tokensByBeat) {
  const mustTokens = new Set();
  for (const t of input.packaging.openingMustEstablish || []) for (const x of T.contentTokens(t)) mustTokens.add(x);
  const out = [];
  for (const loop of loops) {
    const opener = input.beats.find((b) => b.beatId === loop.openedBeatId);
    let resolvedBy = null;
    for (const b of input.beats) {
      if (b.order <= loop.openedOrder && b.startMs <= opener.startMs) continue;
      if (b.resolvesLoops.includes(loop.loopId)) { resolvedBy = b; break; }
      if (RESOLVING_ROLES.has(b.role) && loop.qTokens.size > 0 && T.coverage(loop.qTokens, tokensByBeat.get(b.beatId)) >= BEAT_POLICY.loopResolveCoverage) {
        resolvedBy = b; break;
      }
    }
    let status;
    let statusReason = null;
    if (resolvedBy) status = "RESOLVED";
    else if (loop.deferTo && loop.deferReason) { status = "INTENTIONALLY_DEFERRED"; statusReason = loop.deferReason; }
    else if (ENGAGEMENT_ROLES.has(opener.role)) { status = "INTENTIONALLY_DEFERRED"; statusReason = "ENGAGEMENT_PROMPT"; }
    else status = "DROPPED";
    const tiesToPackaging = loop.packaging || (mustTokens.size > 0 && T.coverage(mustTokens, loop.qTokens) >= 0.5) || (loop.qTokens.size > 0 && T.coverage(loop.qTokens, mustTokens) >= 0.6);
    out.push({
      loopId: loop.loopId, openedBeatId: loop.openedBeatId, openedAtMs: loop.openedAtMs, question: loop.question,
      status, statusReason, resolvedBeatId: resolvedBy ? resolvedBy.beatId : null, resolvedAtMs: resolvedBy ? resolvedBy.startMs : null,
      tiesToPackaging, source: loop.source,
    });
  }
  return out;
}

function musicEnergyOver(input, a, b) {
  let acc = 0;
  let cover = 0;
  for (const m of input.music) {
    const o = T.overlapMs(m.startMs, m.endMs, a, b);
    if (o > 0) { acc += m.energy * o; cover += o; }
  }
  return cover > 0 ? acc / cover : null;
}

function inSilence(input, a, b) {
  return input.intentionalSilence.some((s) => T.overlapMs(s.startMs, s.endMs, a, b) >= (b - a) * 0.5);
}

function visualMeaningOver(input, a, b) {
  return input.shots.some((s) => s.visualMeaning && T.overlapMs(s.startMs, s.endMs, a, b) > 0);
}

function maxBeatMs(role) {
  return BEAT_POLICY.maxBeatMsByRole[role] || BEAT_POLICY.maxBeatMsByRole.DEFAULT;
}

function analyzeBeats(input) {
  const P = BEAT_POLICY;
  const findings = [];
  const tokensByBeat = new Map(input.beats.map((b) => [b.beatId, beatTokens(b)]));
  const loops = resolveLoops(input, collectLoops(input), tokensByBeat);

  const seen = new Set();
  const perBeat = [];
  let prevTension = 0;
  for (const b of input.beats) {
    const tokens = tokensByBeat.get(b.beatId);
    const newTokens = [...tokens].filter((t) => !seen.has(t));
    for (const t of tokens) seen.add(t);
    const newInfoCount = Number.isFinite(b.newInfoCount) ? b.newInfoCount : newTokens.length;
    const durationMs = b.endMs - b.startMs;
    const wc = T.wordCount(b.text);
    const recapIntent = b.intent.recap === true || (RECAP_RE.test(b.text) && newInfoCount < 2);
    const progress = [];
    if (newInfoCount >= 2 || (newInfoCount >= 1 && wc < 8)) progress.push("ADD_INFORMATION");
    if (b.opensLoops.length > 0 || /\?/.test(b.text)) progress.push("RAISE_QUESTION");
    if (b.resolvesLoops.length > 0 || loops.some((l) => l.resolvedBeatId === b.beatId)) progress.push("ANSWER_QUESTION");
    if (b.role === "ESCALATION") progress.push("ESCALATE");
    if (b.role === "CONTRAST") progress.push("CONTRAST");
    if (b.role === "EVIDENCE" || ((b.claimRefs || []).length > 0 && newInfoCount >= 1)) progress.push("SHOW_EVIDENCE");
    if (b.role === "PAYOFF" || b.role === "REVEAL") progress.push("PAYOFF");
    if (b.role === "EXPLANATION" && newInfoCount >= 1 && !progress.includes("ADD_INFORMATION")) progress.push("CLARIFY");
    if (b.intent.rest === true || b.intent.slow === true) progress.push("RESET_PACING");
    if (b.role === "TRANSITION" && newInfoCount >= 1) progress.push("TRANSITION_MEANINGFULLY");
    if (recapIntent) progress.push("INTENTIONAL_RECAP");

    // Knowledge-gap tension (never danger-drama): outstanding loops after this beat.
    const outstanding = loops.filter((l) => l.openedAtMs <= b.startMs && !(l.resolvedAtMs !== null && l.resolvedAtMs <= b.startMs) && l.status !== "INTENTIONALLY_DEFERRED").length;
    const tension = Math.min(1, 0.25 * outstanding + (["ESCALATION", "CONTRAST", "REVEAL"].includes(b.role) ? 0.15 : 0) + (Number.isFinite(b.narrativeEnergy) ? b.narrativeEnergy * 0.4 : 0));
    const movement = tension - prevTension > 0.05 ? "RISING" : prevTension - tension > 0.05 ? "FALLING" : "FLAT";
    prevTension = tension;

    const music = musicEnergyOver(input, b.startMs, b.endMs);
    const atmospheric = b.intent.atmosphere === true || (music !== null && music >= 0.3) || inSilence(input, b.startMs, b.endMs);
    const hasVisualMeaning = !!b.visualMeaning || visualMeaningOver(input, b.startMs, b.endMs);
    const deliberate = b.intent.rest === true || b.intent.slow === true || b.intent.atmosphere === true;

    const usefulProgress = progress.filter((p) => p !== "INTENTIONAL_RECAP" && p !== "RESET_PACING");
    const energetic = Number.isFinite(b.narrativeEnergy) && b.narrativeEnergy >= 0.15;
    let status = "PROGRESS";
    if (usefulProgress.length === 0) {
      if (recapIntent) status = "INTENTIONAL_RECAP";
      else if (deliberate) status = "DELIBERATE_REST";
      else if (hasVisualMeaning || atmospheric || energetic) status = "VISUAL_OR_ATMOSPHERIC";
      else if (!ENGAGEMENT_ROLES.has(b.role)) status = "NO_PROGRESS";
    }

    if (status === "NO_PROGRESS") {
      if (durationMs >= P.deadTimeMinMs) {
        findings.push(makeFinding("DEAD_TIME_RISK", {
          beatId: b.beatId, startMs: b.startMs, endMs: b.endMs,
          reason: `beat ${b.beatId} (${b.role}, ${Math.round(durationMs / 100) / 10}s) delivers no new information, emotion, atmosphere, anticipation or visual meaning and is not marked as deliberate rest`,
          evidenceRefs: [`beat:${b.beatId}`, `newInfoCount:${newInfoCount}`],
          correctiveAction: "BEAT_RETIME_OR_SPLIT:trim or merge dead span; or declare intentional rest/atmosphere",
          confidence: "MEDIUM",
        }));
        status = "DEAD_TIME_RISK";
      } else if (durationMs >= 1500 || wc >= 6) {
        findings.push(makeFinding("BEAT_NO_PROGRESS", {
          beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, severity: durationMs < 3000 ? "P3" : "P2",
          reason: `beat ${b.beatId} (${b.role}) adds no new information, question, answer, evidence or payoff`,
          evidenceRefs: [`beat:${b.beatId}`, `newInfoCount:${newInfoCount}`],
          correctiveAction: "SCRIPT_TRIM:remove or merge the non-progressing beat into its neighbour",
          confidence: "MEDIUM",
        }));
      }
    }

    // Duration discipline.
    const max = maxBeatMs(b.role);
    const densityPer10s = (newInfoCount / Math.max(durationMs, 1)) * 10000;
    if (durationMs > max && b.intent.slow !== true && b.intent.rest !== true && (densityPer10s < P.lowDensityPer10s || durationMs > max * P.excessMultiplier)) {
      findings.push(makeFinding("BEAT_TOO_LONG", {
        beatId: b.beatId, startMs: b.startMs, endMs: b.endMs,
        reason: `beat ${b.beatId} runs ${Math.round(durationMs / 1000)}s (policy ${Math.round(max / 1000)}s for ${b.role}) at ${densityPer10s.toFixed(1)} new concepts/10s`,
        evidenceRefs: [`beat:${b.beatId}`, `durationMs:${durationMs}`, `policyMaxMs:${max}`],
        correctiveAction: "BEAT_RETIME_OR_SPLIT:split at the first turn or trim script",
        confidence: "MEDIUM",
      }));
    }
    if (durationMs < P.tooShortMs && wc >= P.tooShortMinWords && !["TRANSITION", "CTA"].includes(b.role)) {
      findings.push(makeFinding("BEAT_TOO_SHORT", {
        beatId: b.beatId, startMs: b.startMs, endMs: b.endMs,
        reason: `beat ${b.beatId} carries ${wc} words in ${durationMs}ms — comprehension window too short`,
        evidenceRefs: [`beat:${b.beatId}`, `wordCount:${wc}`, `durationMs:${durationMs}`],
        correctiveAction: "BEAT_RETIME_OR_SPLIT:extend the beat or merge into neighbour",
        confidence: "MEDIUM",
      }));
    }

    perBeat.push({
      beatId: b.beatId, role: b.role, startMs: b.startMs, endMs: b.endMs, durationMs, wordCount: wc,
      newInfoCount, progress, status, tension: Number(tension.toFixed(3)), tensionMovement: movement,
      outstandingLoops: outstanding, musicEnergy: music === null ? null : Number(music.toFixed(3)), visualMeaning: hasVisualMeaning,
    });
  }

  // Dropped payoffs.
  for (const l of loops) {
    if (l.status !== "DROPPED") continue;
    findings.push(makeFinding("DROPPED_PAYOFF", {
      beatId: l.openedBeatId, startMs: l.openedAtMs, key: l.loopId,
      severity: l.tiesToPackaging ? "P1" : "P2",
      reason: `open loop "${l.question.slice(0, 80)}" opened at ${Math.round(l.openedAtMs / 100) / 10}s is never resolved or intentionally deferred${l.tiesToPackaging ? " (and ties to the packaging promise)" : ""}`,
      evidenceRefs: [`loop:${l.loopId}`, `beat:${l.openedBeatId}`],
      correctiveAction: "SCRIPT_REWRITE:add the payoff beat, or mark the loop intentionally deferred with a reason",
      confidence: "MEDIUM",
    }));
  }

  // Semantic repetition (meaning-level, not exact string).
  for (let i = 0; i < input.beats.length; i++) {
    const a = input.beats[i];
    const ta = tokensByBeat.get(a.beatId);
    if (ta.size < P.redundancyMinTokens) continue;
    for (let j = i + 1; j < Math.min(input.beats.length, i + 1 + P.redundancyLookahead); j++) {
      const b = input.beats[j];
      const tb = tokensByBeat.get(b.beatId);
      if (tb.size < P.redundancyMinTokens) continue;
      const sim = T.jaccard(ta, tb);
      if (sim < P.redundancyJaccard) continue;
      const pb = perBeat[j];
      const recap = pb.status === "INTENTIONAL_RECAP" || b.intent.recap === true || RECAP_RE.test(b.text);
      const escalates = b.role === "ESCALATION" || b.role === "PAYOFF" || pb.newInfoCount >= 2;
      if (escalates && !recap) continue;
      findings.push(makeFinding("NARRATIVE_REDUNDANCY", {
        beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, key: `${a.beatId}>${b.beatId}`,
        severity: recap ? "P3" : "P2", status: recap ? "ACCEPTED_INTENTIONAL" : "OPEN",
        statusReason: recap ? "intentional recap" : undefined,
        reasonClass: recap ? "INTENTIONAL_RECAP" : "SEMANTIC_REPEAT",
        reason: recap
          ? `beat ${b.beatId} recaps beat ${a.beatId} (similarity ${sim.toFixed(2)}) — recorded as intentional`
          : `beat ${b.beatId} restates beat ${a.beatId} (content similarity ${sim.toFixed(2)}) with no escalation or new information`,
        evidenceRefs: [`beat:${a.beatId}`, `beat:${b.beatId}`, `similarity:${sim.toFixed(2)}`],
        correctiveAction: recap ? "NONE:intentional recap accepted" : "SCRIPT_TRIM:cut the restated beat or add escalation",
        confidence: "MEDIUM",
      }));
      break;
    }
  }
  // Same visual meaning repeated, or same emotion repeated without energy rise.
  let emotionRunLen = 0;
  for (let i = 0; i < input.beats.length; i++) {
    const b = input.beats[i];
    const prev = input.beats[i - 1];
    if (prev && b.visualMeaning && b.visualMeaning === prev.visualMeaning && (Number(b.narrativeEnergy) || 0) - (Number(prev.narrativeEnergy) || 0) <= P.energyRise && b.role !== "PAYOFF") {
      findings.push(makeFinding("NARRATIVE_REDUNDANCY", {
        beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, severity: "P3", key: `visual:${prev.beatId}>${b.beatId}`,
        reasonClass: "VISUAL_MEANING_REPEAT", repairClass: "ASSET_MODALITY_REPLACE",
        reason: `beat ${b.beatId} repeats the visual meaning "${b.visualMeaning}" of ${prev.beatId} without escalation`,
        evidenceRefs: [`beat:${prev.beatId}`, `beat:${b.beatId}`, `visualMeaning:${b.visualMeaning}`],
        correctiveAction: "ASSET_MODALITY_REPLACE:show a different aspect or merge the shots",
        confidence: "LOW",
      }));
    }
    if (b.emotion && prev && prev.emotion === b.emotion && (Number(b.narrativeEnergy) || 0) - (Number(prev.narrativeEnergy) || 0) <= P.energyRise) emotionRunLen += 1;
    else emotionRunLen = b.emotion ? 1 : 0;
    if (emotionRunLen === P.emotionRepeatRun) {
      const first = input.beats[i - emotionRunLen + 1];
      findings.push(makeFinding("NARRATIVE_REDUNDANCY", {
        beatId: b.beatId, startMs: first.startMs, endMs: b.endMs, severity: "P3", key: `emotion:${first.beatId}>${b.beatId}`,
        reasonClass: "EMOTION_REPEAT", repairClass: "SCRIPT_TRIM",
        reason: `emotion "${b.emotion}" repeats across ${emotionRunLen} beats without energy escalation`,
        evidenceRefs: [`beat:${first.beatId}`, `beat:${b.beatId}`, `emotion:${b.emotion}`],
        correctiveAction: "SCRIPT_TRIM:vary the emotional beat or escalate",
        confidence: "LOW",
      }));
    }
  }

  // Uncovered time between beats (silence/rest must be declared, not accidental).
  for (let i = 0; i + 1 < input.beats.length; i++) {
    const a = input.beats[i];
    const n = input.beats[i + 1];
    const gap = n.startMs - a.endMs;
    if (gap >= P.deadGapMinMs && !inSilence(input, a.endMs, n.startMs) && !visualMeaningOver(input, a.endMs, n.startMs) && (musicEnergyOver(input, a.endMs, n.startMs) || 0) < 0.3) {
      findings.push(makeFinding("DEAD_TIME_RISK", {
        beatId: a.beatId, startMs: a.endMs, endMs: n.startMs, scope: "GLOBAL", key: `gap:${a.beatId}`,
        reasonClass: "UNDECLARED_GAP",
        reason: `${Math.round(gap / 100) / 10}s between beats ${a.beatId} and ${n.beatId} has no narration, visual meaning, atmosphere or declared silence`,
        evidenceRefs: [`beat:${a.beatId}`, `beat:${n.beatId}`, `gapMs:${gap}`],
        correctiveAction: "BEAT_RETIME_OR_SPLIT:close the gap or declare intentional silence",
        confidence: "MEDIUM",
      }));
    }
  }

  const open = (f) => f.status === "OPEN" || f.status === "REVIEW_REQUIRED";
  const report = {
    kind: "NARRATIVE_BEAT_QUALITY",
    version: "1.0.0",
    policyVersion: POLICY_VERSION,
    projectId: input.projectId,
    inputFingerprint: input.inputFingerprint,
    beats: perBeat,
    openLoops: loops,
    tensionTimeline: perBeat.map((p) => ({ beatId: p.beatId, startMs: p.startMs, tension: p.tension, movement: p.tensionMovement })),
    metrics: {
      beatCount: perBeat.length,
      noProgressBeats: perBeat.filter((p) => p.status === "NO_PROGRESS" || p.status === "DEAD_TIME_RISK").length,
      deliberateRestBeats: perBeat.filter((p) => p.status === "DELIBERATE_REST").length,
      intentionalRecapBeats: perBeat.filter((p) => p.status === "INTENTIONAL_RECAP").length,
      loopsOpened: loops.length,
      loopsResolved: loops.filter((l) => l.status === "RESOLVED").length,
      loopsDeferred: loops.filter((l) => l.status === "INTENTIONALLY_DEFERRED").length,
      loopsDropped: loops.filter((l) => l.status === "DROPPED").length,
      deadTimeRiskMs: findings.filter((f) => f.code === "DEAD_TIME_RISK").reduce((s, f) => s + ((f.endMs || 0) - (f.startMs || 0)), 0),
      openFindings: findings.filter(open).length,
    },
    findings,
  };
  return report;
}

module.exports = { analyzeBeats, collectLoops, resolveLoops, beatTokens, RECAP_RE };
