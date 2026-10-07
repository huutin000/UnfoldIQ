"use strict";

/**
 * 1G.9 semantic compare (PHASE 1G.9, Prompt 01, §§19–20).
 * Compares desired instruction text vs provider readback. Normalizes ONLY
 * harmless representation differences (whitespace, wrapping, display
 * separators, equivalent bullets). Never normalizes away missing identity
 * constraints, missing forbidden mutations, missing references, changed
 * palette/names/rules, negations, or contradictions.
 */

const shared = require("./shared.js");

function normalizeHarmless(text) {
  return String(text || "")
    .replace(/[•·▪◦]/g, "-")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[-–—]\s*/g, "- ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .toLowerCase();
}

function linesOf(text) {
  return normalizeHarmless(text).split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Critical-content tokens that must survive verbatim (case-insensitive). */
function criticalTokens(desired) {
  const names = [];
  const text = String((desired && desired.compiledText) || "");
  for (const line of text.split("\n")) {
    const m = /^\s*[-•·]\s*(.+?)\s*$/.exec(line);
    if (m && m[1].length > 0) names.push(m[1].toLowerCase().replace(/\s+/g, " ").trim());
  }
  return names;
}

/**
 * compareInstructionReadback(desired { compiledText, referenceIds[] },
 *   readback { text, referenceIds[]?, rawEvidence? })
 * → { status: MATCH|EQUIVALENT|DRIFT|UNVERIFIABLE, differences[], fingerprint }
 */
function compareInstructionReadback(desired, readback) {
  const differences = [];
  const dText = (desired && desired.compiledText) || "";
  const rText = (readback && (readback.text || readback.logicalText)) || "";
  if (!rText) {
    return { status: "UNVERIFIABLE", differences: [{ class: "NO_READBACK", detail: "no provider readback text available" }], fingerprint: null };
  }
  const dRefsEarly = new Set(desired.referenceIds || []);
  const rRefsEarly = new Set(readback.referenceIds || []);
  const missingRefsEarly = [...dRefsEarly].filter((id) => !rRefsEarly.has(id));
  // Text match alone is never enough when references are required.
  if (dText === rText && missingRefsEarly.length === 0) {
    return { status: "MATCH", differences, fingerprint: shared.hash16({ d: dText, r: rText }) };
  }
  const dLines = linesOf(dText);
  const rSet = new Set(linesOf(rText));
  const missing = dLines.filter((l) => !rSet.has(l));
  // Negation / contradiction signals in readback that desired lacks.
  const negations = linesOf(rText).filter((l) => /\b(not|never|don't|do not|no longer|except)\b/.test(l) && !new Set(dLines).has(l));
  const dRefs = new Set(desired.referenceIds || []);
  const rRefs = new Set(readback.referenceIds || []);
  const missingRefs = [...dRefs].filter((id) => !rRefs.has(id));
  for (const m of missing) {
    differences.push({ class: /no |never|forbidden|unwanted|must|always/i.test(m) ? "MISSING_CONSTRAINT" : "MISSING_LINE", detail: m.slice(0, 160) });
  }
  for (const id of missingRefs) {
    differences.push({ class: "MISSING_REFERENCE", detail: id });
  }
  for (const n of negations) {
    differences.push({ class: "CONTRADICTION", detail: n.slice(0, 160) });
  }
  if (differences.length === 0) {
    return { status: "EQUIVALENT", differences, fingerprint: shared.hash16({ d: normalizeHarmless(dText), r: normalizeHarmless(rText) }) };
  }
  const critical = differences.some((x) => x.class === "MISSING_CONSTRAINT" || x.class === "MISSING_REFERENCE" || x.class === "CONTRADICTION");
  void critical;
  return { status: "DRIFT", differences, fingerprint: shared.hash16({ d: dText, r: rText }) };
}

module.exports = { compareInstructionReadback, normalizeHarmless, criticalTokens };
