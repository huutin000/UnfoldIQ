"use strict";

/**
 * Shared helpers for the 1G.3 structural planners (Beat Map / Scene Graph /
 * Shot Plan). Deterministic identity + bounded text normalization only.
 */

const crypto = require("crypto");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const STRUCTURE_VERSION = "1.0.0";

function hash16(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function id12(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 12)}`;
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deterministic narrative-role classification for one sentence. This is a
 * structural heuristic — never a factual judgment and never evidence work.
 */
const ROLE_MARKERS = {
  DISPUTE: /dispute|argue|argued|however|debate|contradict|differ|conflict|contest|disagree/i,
  EVIDENCE: /record|document|evidence|according to|archive|municipal|data|study|measured|registered|filed|census|ledger/i,
  REVEAL: /reveal|discovered|turns out|actually|uncovered|emerged|hidden|found/i,
  RESOLUTION: /finally|in the end|remains|today|conclude|conclusion|morning comes|dawn|ever since/i,
};

function classifySentence(sentence) {
  const text = String(sentence || "");
  if (/\?$/.test(text.trim()) || /^(who|what|when|where|why|how|which|is|are|do|does|did|can|could|would|will)\b/i.test(text)) {
    return "QUESTION";
  }
  if (ROLE_MARKERS.DISPUTE.test(text)) return "CONTRAST";
  if (ROLE_MARKERS.EVIDENCE.test(text)) return "EVIDENCE";
  if (ROLE_MARKERS.REVEAL.test(text)) return "REVEAL";
  if (ROLE_MARKERS.RESOLUTION.test(text)) return "RESOLUTION";
  return "EXPLANATION";
}

/** Visual-objective buckets: scene boundaries follow meaningful turns only. */
const ROLE_BUCKETS = {
  QUESTION: "ORIENT",
  SETUP: "ORIENT",
  EXPLANATION: "EXPLAIN",
  EVIDENCE: "EXPLAIN",
  REVEAL: "SHIFT",
  CONTRAST: "SHIFT",
  RESOLUTION: "RESOLVE",
  REFLECTION: "RESOLVE",
};

const ROLE_SHOT_PURPOSE = {
  QUESTION: "ORIENT",
  SETUP: "ESTABLISH",
  EXPLANATION: "DEMONSTRATE",
  EVIDENCE: "EVIDENCE_VISUAL",
  REVEAL: "REVEAL",
  CONTRAST: "CONTRAST",
  RESOLUTION: "RESOLUTION",
  REFLECTION: "RESOLUTION",
};

module.exports = {
  STRUCTURE_VERSION,
  hash16,
  id12,
  normalizeText,
  splitSentences,
  classifySentence,
  ROLE_BUCKETS,
  ROLE_SHOT_PURPOSE,
};
