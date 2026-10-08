"use strict";

/**
 * Phase 6A — deterministic text helpers (UNFOLDIQ CORE).
 * Content-token normalization shared by hook / beat / watch analysis.
 * No model calls: structured state is measured, never "estimated by a model".
 */

const STOP = new Set((
  "a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those " +
  "he she they them his her their we you your i me my our us not no yes do does did done have has had will would can could " +
  "just very more most some any all each every than too also into out up down over under about after before again there here " +
  "what when where why how who whom which while because even still only own same such both few other"
).split(/\s+/));

const INTERROGATIVE = new Set(["what", "when", "where", "why", "how", "who", "which", "whom"]);

function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) return `${s.slice(0, -3)}y`;
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

function words(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, " ").split(/\s+/).filter(Boolean);
}

function wordCount(text) {
  return words(text).length;
}

/** Content tokens (stemmed, stop-word free, length>=3). */
function contentTokens(text) {
  const out = new Set();
  for (const w of words(text)) {
    if (STOP.has(w) || w.length < 3) continue;
    out.add(stem(w));
  }
  return out;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Fraction of `needle` tokens present in `hay` (0..1); empty needle -> 0. */
function coverage(needle, hay) {
  if (needle.size === 0) return 0;
  let hit = 0;
  for (const x of needle) if (hay.has(x)) hit++;
  return hit / needle.size;
}

function isQuestion(text) {
  const t = String(text || "").trim();
  if (/\?/.test(t)) return true;
  const first = words(t)[0];
  return !!first && INTERROGATIVE.has(first);
}

/** Question tokens without interrogatives (what a payoff must answer). */
function questionTokens(text) {
  const out = new Set();
  for (const w of words(text)) {
    if (STOP.has(w) || INTERROGATIVE.has(w) || w.length < 3) continue;
    out.add(stem(w));
  }
  return out;
}

const PREAMBLE_RE = /^\s*(welcome( back)?|hey( guys| everyone)?|hi( everyone| guys)?|hello|what'?s up|before we (start|begin|get started)|in this video|today (we|i)('re| am| will| are)|don'?t forget to|like and subscribe|subscribe|this video is (sponsored|brought)|brought to you|my name is|you'?re watching|thanks for (clicking|joining))/i;

function isPreamble(text) {
  return PREAMBLE_RE.test(String(text || ""));
}

/** Clip a [start,end) range to a window and return overlap ms. */
function overlapMs(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/**
 * Timed narration units [{startMs,endMs,text}] -> text inside window,
 * words distributed linearly across each unit's span (segment-level timing
 * is the strongest evidence in repo; word timing used when units are words).
 */
function textInWindow(units, w0, w1) {
  const parts = [];
  for (const u of units) {
    const o = overlapMs(u.startMs, u.endMs, w0, w1);
    if (o <= 0) continue;
    const ws = String(u.text || "").split(/\s+/).filter(Boolean);
    if (ws.length === 0) continue;
    const span = Math.max(1, u.endMs - u.startMs);
    const from = Math.max(0, Math.floor(((Math.max(w0, u.startMs) - u.startMs) / span) * ws.length));
    const to = Math.min(ws.length, Math.ceil(((Math.min(w1, u.endMs) - u.startMs) / span) * ws.length));
    parts.push(ws.slice(from, Math.max(from + 1, to)).join(" "));
  }
  return parts.join(" ");
}

/** Time (ms) at which any token of `needle` is first spoken; null if never. */
function firstMentionMs(units, needle, minCoverage = 0.5) {
  if (needle.size === 0) return null;
  const sorted = [...units].sort((a, b) => a.startMs - b.startMs);
  let acc = new Set();
  for (const u of sorted) {
    const ws = String(u.text || "").split(/\s+/).filter(Boolean);
    const span = Math.max(1, u.endMs - u.startMs);
    for (let i = 0; i < ws.length; i++) {
      for (const t of contentTokens(ws[i])) acc.add(t);
      if (coverage(needle, acc) >= minCoverage) return Math.round(u.startMs + (span * (i + 1)) / ws.length);
    }
  }
  return null;
}

module.exports = { STOP, stem, words, wordCount, contentTokens, jaccard, coverage, isQuestion, questionTokens, isPreamble, overlapMs, textInWindow, firstMentionMs };
