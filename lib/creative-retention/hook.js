"use strict";

/**
 * Phase 6A §8–§14 — Hook System (UNFOLDIQ CORE).
 *
 * Structured 0–5s / 0–15s / 0–30s checkpoints. 5s and 15s are UNFOLDIQ
 * creative checkpoints; 30s is also grounded in YouTube's intro-retention
 * semantics (RULE 3) — but this module NEVER outputs a retention figure.
 * No opaque score: every checkpoint carries typed observations + findings.
 *
 * Hook quality includes delivery of the packaging promise (RULE 4). A calm
 * documentary opening can PASS: nothing here requires shouting, rapid cuts
 * or clickbait (RULE 5).
 */

const { makeFinding } = require("./contract.js");
const { HOOK_CHECKPOINTS_MS, HOOK_CLASS_POLICY, HOOK_COMMON, POLICY_VERSION } = require("./policy.js");
const T = require("./text.js");
const { analyzeBeats, collectLoops, resolveLoops, beatTokens } = require("./beats.js");

const SETUP_ROLES = new Set(["SETUP", "CONTEXT", "TRANSITION", "BRAND_INTRO", "CTA"]);

/** token-hit rule: at least 60% of a term's tokens (min 1) must be present. */
function established(termTokens, hay) {
  if (termTokens.size === 0) return false;
  let hit = 0;
  for (const t of termTokens) if (hay.has(t)) hit++;
  return hit >= Math.max(1, Math.ceil(termTokens.size * HOOK_COMMON.promiseCoverage));
}

function unionMs(ranges) {
  const sorted = ranges.filter((r) => r.endMs > r.startMs).sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let cur = null;
  for (const r of sorted) {
    if (!cur || r.startMs > cur.endMs) { if (cur) total += cur.endMs - cur.startMs; cur = { ...r }; }
    else cur.endMs = Math.max(cur.endMs, r.endMs);
  }
  if (cur) total += cur.endMs - cur.startMs;
  return total;
}

/** Channel units for promise coverage: narration + captions + on-screen + visual labels. */
function channelUnits(input) {
  return [
    ...input.narration,
    ...input.onScreen,
    ...input.shots.filter((s) => s.visualMeaning).map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.visualMeaning })),
  ];
}

function maxSimultaneous(items, w0, w1) {
  const ev = [];
  for (const o of items) {
    const a = Math.max(o.startMs, w0);
    const b = Math.min(o.endMs, w1);
    if (b > a) { ev.push([a, 1]); ev.push([b, -1]); }
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of ev) { cur += d; max = Math.max(max, cur); }
  return max;
}

function analyzeHook(input, opts = {}) {
  const cls = HOOK_CLASS_POLICY[input.hookClass] || HOOK_CLASS_POLICY.EXPLAINER;
  const beatReport = opts.beatReport || analyzeBeats(input);
  const perBeat = new Map(beatReport.beats.map((b) => [b.beatId, b]));
  const titleTokens = T.contentTokens(`${input.packaging.titleText} ${input.packaging.thumbnailText || ""}`);
  const mustAll = (input.packaging.openingMustEstablish || []).map((t) => ({ term: t, tokens: T.contentTokens(t) }));
  // Terms with no content tokens (e.g. "why") cannot be tested lexically — recorded, never silently failed.
  const must = mustAll.filter((m) => m.tokens.size > 0);
  const untestableTerms = mustAll.filter((m) => m.tokens.size === 0).map((m) => m.term);
  const mustNot = (input.packaging.mustNotImply || []).map((t) => ({ term: t, tokens: T.contentTokens(t) }));
  const units = channelUnits(input);
  const tokensByBeat = new Map(input.beats.map((b) => [b.beatId, beatTokens(b)]));
  const loops = resolveLoops(input, collectLoops(input), tokensByBeat);

  const byCode = new Map();
  const addFinding = (checkpoint, code, extra) => {
    const f = makeFinding(code, { ...extra, checkpoints: [checkpoint] });
    const prev = byCode.get(`${code}:${extra.key || ""}`);
    if (prev) { prev.checkpoints.push(checkpoint); return prev; }
    byCode.set(`${code}:${extra.key || ""}`, f);
    return f;
  };

  const checkpoints = [];
  for (const [checkpointId, windowMs] of Object.entries(HOOK_CHECKPOINTS_MS)) {
    const W = Math.min(windowMs, input.durationMs);
    const sec = windowMs === 5000 ? 5 : windowMs === 15000 ? 15 : 30;
    const narr = T.textInWindow(input.narration, 0, W);
    const narrTokens = T.contentTokens(narr);
    const allText = [narr, ...input.onScreen.filter((o) => o.startMs < W).map((o) => o.text), ...input.shots.filter((s) => s.startMs < W && s.visualMeaning).map((s) => s.visualMeaning)].join(" ");
    const allTokens = T.contentTokens(allText);
    const wc = T.wordCount(narr);
    const wps = wc / (W / 1000);
    const question = T.isQuestion(narr) || /\?/.test(narr);
    const newInfoTokens = [...narrTokens].filter((t) => !titleTokens.has(t));
    const newInfoCount = newInfoTokens.length;
    const minNew = cls.minNewInfo[sec];
    const terms = must.map((m) => {
      const inWin = established(m.tokens, allTokens);
      const first = T.firstMentionMs(units, m.tokens, HOOK_COMMON.promiseCoverage);
      return { term: m.term, establishedInWindow: inWin, firstMentionMs: first };
    });
    const subjectFromTerms = terms.length > 0 && terms.some((t) => t.establishedInWindow);
    const subjectFromTitle = terms.length === 0 && titleTokens.size > 0 && T.coverage(titleTokens, allTokens) >= 0.34;
    const subject = subjectFromTerms || subjectFromTitle;

    // Preamble / setup-only time inside the window.
    const ranges = [];
    // Setup-only = preamble, or SETUP/CONTEXT-role time before the primary promise is first established
    // (context that delays the promised content), or setup beats with no real information.
    const primaryAt = must.length > 0 ? (terms[0].firstMentionMs === null ? input.durationMs : terms[0].firstMentionMs) : null;
    for (const b of input.beats) {
      const o = T.overlapMs(b.startMs, b.endMs, 0, W);
      if (o <= 0) continue;
      const pb = perBeat.get(b.beatId);
      const preamble = b.role === "BRAND_INTRO" || T.isPreamble(b.text);
      if (preamble) { ranges.push({ startMs: b.startMs, endMs: Math.min(b.endMs, W) }); continue; }
      if (!SETUP_ROLES.has(b.role)) continue;
      if (primaryAt !== null) {
        if (b.startMs < primaryAt) ranges.push({ startMs: b.startMs, endMs: Math.min(b.endMs, W, primaryAt) });
      } else if (pb && pb.newInfoCount < 2) ranges.push({ startMs: b.startMs, endMs: Math.min(b.endMs, W) });
    }
    for (const u of input.narration) if (T.isPreamble(u.text) && u.startMs < W) ranges.push({ startMs: u.startMs, endMs: Math.min(u.endMs, W) });
    for (const s of input.shots) if ((s.role === "LOGO" || s.role === "LOGO_STING") && s.startMs < W) ranges.push({ startMs: s.startMs, endMs: Math.min(s.endMs, W) });
    const setupOnlyMs = unionMs(ranges);
    const preambleMs = unionMs(input.beats.filter((b) => b.role === "BRAND_INTRO" || T.isPreamble(b.text)).map((b) => ({ startMs: b.startMs, endMs: Math.min(b.endMs, W) })));

    const openLoops = loops.filter((l) => l.openedAtMs < W);
    const deadRisk = beatReport.findings.filter((f) => f.code === "DEAD_TIME_RISK" && T.overlapMs(f.startMs, f.endMs, 0, W) > 0)
      .reduce((s, f) => s + T.overlapMs(f.startMs, f.endMs, 0, W), 0);

    const refs = [`window:0-${W}`, `hookClass:${input.hookClass}`];
    const cpFindings = [];
    const push = (code, extra) => cpFindings.push(addFinding(checkpointId, code, { startMs: 0, endMs: W, evidenceRefs: refs, ...extra }));

    if (sec === 5) {
      if ((setupOnlyMs >= cls.setupMax5Ms && !subject) || preambleMs >= 3000) {
        const brand = preambleMs >= 3000;
        push("HOOK_SETUP_TOO_LONG", {
          reason: brand
            ? `${Math.round(preambleMs)}ms of logo/channel preamble before the subject (first ${W}ms)`
            : `${Math.round(setupOnlyMs)}ms of the first ${W}ms is setup/context with no subject established (class ${input.hookClass}: max ${cls.setupMax5Ms}ms)`,
          reasonClass: brand ? "BRAND_PREAMBLE" : "SETUP_DELAY", confidence: brand ? "HIGH" : "MEDIUM",
        });
      }
      if (!subject && !question && newInfoCount < minNew && !byCode.has("HOOK_SETUP_TOO_LONG:")) {
        push("HOOK_NO_CLEAR_VALUE", { reason: `no clear subject, question or value in the first ${W}ms (${newInfoCount} new concepts, need ${minNew})`, confidence: "MEDIUM" });
      }
      if (titleTokens.size > 0 && T.jaccard(narrTokens, titleTokens) >= HOOK_COMMON.titleEchoJaccard && newInfoCount < 3) {
        push("HOOK_REPEATS_PACKAGING", { reason: "the opening only restates the title/thumbnail text without adding new information", confidence: "MEDIUM" });
      }
      const simul = maxSimultaneous(input.onScreen, 0, W);
      if (wps > cls.maxWps5 || newInfoCount > HOOK_COMMON.maxNewInfo5 || simul > HOOK_COMMON.maxOnScreenSimultaneous5) {
        push("HOOK_OVERLOADED", {
          reason: `opening density: ${wps.toFixed(1)} words/s (class cap ${cls.maxWps5}), ${newInfoCount} new concepts (cap ${HOOK_COMMON.maxNewInfo5}), ${simul} simultaneous on-screen texts (cap ${HOOK_COMMON.maxOnScreenSimultaneous5})`,
          confidence: "MEDIUM",
        });
      }
      const first = T.words(narr)[0];
      if (!subject && !question && first && /^(this|that|it|they|he|she|these|those)$/.test(first)) {
        push("HOOK_CONFUSING", { reason: `the opening starts with an unresolved pronoun ("${first}") and establishes no subject`, confidence: "MEDIUM" });
      }
    }

    if (sec === 15) {
      if (setupOnlyMs >= cls.setupMax15Ms) {
        push("HOOK_SETUP_TOO_LONG", { reason: `${Math.round(setupOnlyMs)}ms of the first ${W}ms is setup-only without information progress (class ${input.hookClass}: max ${cls.setupMax15Ms}ms)`, confidence: "MEDIUM" });
      } else if (newInfoCount < minNew) {
        push("HOOK_NO_CLEAR_VALUE", { reason: `only ${newInfoCount} new concepts by ${W}ms (class ${input.hookClass} expects ≥ ${minNew}) — the story has not progressed`, reasonClass: "NO_PROGRESS_BY_15S", confidence: "MEDIUM" });
      }
      const primary = terms[0];
      if (primary && !primary.establishedInWindow && primary.firstMentionMs !== null && primary.firstMentionMs <= 30000) {
        push("HOOK_PROMISE_DELAYED", { key: primary.term, reason: `the primary promise "${primary.term}" is first established at ${Math.round(primary.firstMentionMs / 100) / 10}s, after the 15s checkpoint`, confidence: "MEDIUM" });
      }
      const early = input.beats.find((b) => b.role === "PAYOFF" && b.startMs < HOOK_COMMON.earlyPayoffWindowMs && b.intent.previewPayoff !== true);
      if (early && input.durationMs >= HOOK_COMMON.earlyPayoffVideoMinMs) {
        push("HOOK_PAYOFF_GIVEN_TOO_EARLY", { beatId: early.beatId, reason: `a PAYOFF beat starts at ${Math.round(early.startMs / 100) / 10}s of a ${Math.round(input.durationMs / 1000)}s video — the main payoff is spent before the story develops`, confidence: "MEDIUM" });
      }
    }

    if (sec === 30) {
      const delayed = [];
      const absent = [];
      terms.forEach((t, i) => {
        if (t.establishedInWindow) return;
        if (t.firstMentionMs !== null) delayed.push({ ...t, primary: i === 0 });
        else absent.push({ ...t, primary: i === 0 });
      });
      if (delayed.length > 0) {
        const severe = delayed.some((d) => d.primary) || delayed.length >= Math.ceil(terms.length / 2);
        push("PACKAGING_PROMISE_DELAYED", {
          severity: severe ? "P1" : "P2",
          reason: `the opening does not establish the promised ${delayed.map((d) => `"${d.term}"`).join(", ")} within 30s (first delivered at ${delayed.map((d) => Math.round(d.firstMentionMs / 100) / 10 + "s").join(", ")})`,
          evidenceRefs: [...refs, ...delayed.map((d) => `promise:${d.term}`)], confidence: "MEDIUM",
        });
      }
      if (absent.length > 0) {
        push("HOOK_PROMISE_MISMATCH", {
          key: "absent", reasonClass: "PROMISE_NOT_DELIVERED",
          reason: `the video never establishes the promised ${absent.map((d) => `"${d.term}"`).join(", ")}`,
          evidenceRefs: [...refs, ...absent.map((d) => `promise:${d.term}`)], confidence: "HIGH",
        });
      }
      const implied = mustNot.filter((m) => established(m.tokens, allTokens));
      if (implied.length > 0) {
        push("HOOK_PROMISE_MISMATCH", {
          key: "implied", reasonClass: "IMPLIED_FORBIDDEN",
          reason: `the opening implies what the package must not: ${implied.map((m) => `"${m.term}"`).join(", ")}`,
          evidenceRefs: [...refs, ...implied.map((m) => `mustNotImply:${m.term}`)], confidence: "MEDIUM",
        });
      }
      const unresolved30 = openLoops.filter((l) => l.resolvedAtMs === null || l.resolvedAtMs >= W);
      if (openLoops.length > HOOK_COMMON.maxOpenLoops30 && unresolved30.length > HOOK_COMMON.maxOpenLoops30) {
        push("HOOK_TOO_MANY_OPEN_LOOPS", { reason: `${openLoops.length} open loops in the first 30s (${unresolved30.length} unresolved; cap ${HOOK_COMMON.maxOpenLoops30})`, confidence: "MEDIUM" });
      }
      const forward = unresolved30.length > 0
        || (W > 15000 && T.isQuestion(T.textInWindow(input.narration, 15000, W)))
        || loops.some((l) => l.openedAtMs >= W && l.openedAtMs < W + 30000);
      if (cls.forwardQuestionExpected && !forward && input.durationMs > 60000) {
        push("HOOK_NO_FORWARD_QUESTION", { reason: `no open question/anticipation is carried past 30s (class ${input.hookClass} usually expects one; not required for every video)`, confidence: "LOW" });
      }
    }

    checkpoints.push({
      checkpointId: `${input.projectId}:${checkpointId}`,
      checkpoint: checkpointId,
      startMs: 0,
      endMs: W,
      subject: { established: subject, via: subjectFromTerms ? "PACKAGING_TERMS" : subjectFromTitle ? "TITLE_TOKENS" : "NONE" },
      valueDelivered: newInfoCount >= minNew,
      curiosity: { questionPresent: question, openLoopsOpened: openLoops.length, openLoopsUnresolved: openLoops.filter((l) => l.resolvedAtMs === null || l.resolvedAtMs >= W).length },
      setupOnlyMs,
      informationProgress: { newInfoCount, expectedMin: minNew, wordsPerSecond: Number(wps.toFixed(2)) },
      promiseDelivery: { terms, untestableTerms, mustNotImply: mustNot.map((m) => m.term) },
      deadTimeRiskMs: deadRisk,
      evidenceRefs: refs,
      _findings: cpFindings,
    });
  }

  const findings = [...byCode.values()];
  for (const cp of checkpoints) {
    const own = findings.filter((f) => (f.checkpoints || []).includes(cp.checkpoint));
    delete cp._findings;
    cp.findingIds = own.map((f) => f.findingId);
    const worst = own.filter((f) => f.status === "OPEN").map((f) => f.severity).sort()[0];
    cp.verdict = !worst ? "PASS" : worst === "P3" ? "PASS_WITH_NOTES" : "FAIL";
    cp.reason = own.length === 0
      ? `${cp.checkpoint}: subject/value/promise checks passed for class ${input.hookClass}`
      : own.map((f) => `${f.code}: ${f.reason}`).join(" | ");
  }

  return {
    kind: "HOOK_QUALITY",
    version: "1.0.0",
    policyVersion: POLICY_VERSION,
    projectId: input.projectId,
    inputFingerprint: input.inputFingerprint,
    hookClass: input.hookClass,
    classExpectations: cls.expects,
    packagingPromise: {
      titleText: input.packaging.titleText,
      titleClaimRefs: input.packaging.titleClaimRefs,
      thumbnailClaimRefs: input.packaging.thumbnailClaimRefs,
      expectedViewerPromise: input.packaging.expectedViewerPromise,
      openingMustEstablish: input.packaging.openingMustEstablish,
      mustNotImply: input.packaging.mustNotImply,
    },
    checkpoints,
    metrics: { openFindings: findings.filter((f) => f.status === "OPEN").length, groundedExternally: { HOOK_30S: "YouTube intro-retention semantics (first 30s)" } },
    findings,
  };
}

module.exports = { analyzeHook, established };
