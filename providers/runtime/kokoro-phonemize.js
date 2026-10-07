"use strict";

/**
 * Phase 2.3 — local-kokoro PRONUNCIATION RUNTIME boundary (non-audio).
 *
 * Two responsibilities, both strictly pre-TTS:
 *
 * 1. QUIET PHONEMIZATION: the real configured Kokoro runtime executes with
 *    model=False (no acoustic model, no WAV) and returns graphemes + phonemes.
 *    This proves the runtime path is real without starting Phase 2.4 synthesis.
 *    Inject a transport via opts.transport for tests; the default transport is
 *    the real `python`/KPipeline path. No silent fallback: a runtime that is
 *    absent or fails returns a structured error, never a fabricated result.
 *
 * 2. PROVIDER COMPILATION: canonical provider-agnostic pronunciation entries
 *    → Kokoro-compatible input text. The compiled text is DERIVED; source
 *    script bytes are never mutated. IPA/PROVIDER_NATIVE entries compile to
 *    the OFFICIAL upstream phoneme markup `[term](/phonemes/)` (hexgrad/kokoro
 *    README syntax), which kokoro 0.9.4 consumes verbatim — proven live via
 *    KPipeline(lang_code='a', model=False): the standalone markup phonemizes
 *    to exactly the specified phonemes and the same phonemes appear verbatim
 *    in sentence context (FIX_PHASE_2_2_2_3_01 §1). READ_AS entries compile to
 *    a plain respelling substitution. Only provably-consumable notations are
 *    compiled; anything else is reported NOT APPLIED (fail-closed).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { LANGUAGE_CODES } = require("./adapters/local-kokoro.js");

const ERRORS = {
  PRONUNCIATION_RUNTIME_UNAVAILABLE: "configured Kokoro runtime could not be launched (missing python/package) — never silently degraded",
  PRONUNCIATION_RUNTIME_FAILED: "Kokoro quiet phonemization raised a runtime error",
  PRONUNCIATION_RUNTIME_LANGUAGE_UNSUPPORTED: "language has no Kokoro runtime mapping — never fallback to another language",
  PRONUNCIATION_OVERRIDE_NOT_APPLIED: "pronunciation entry cannot be consumed by this provider compiler",
};

// Embedded quiet runner: reads {items:[{index,text,langCode}]} from a payload
// file (argv[1], avoids Windows argv-quoting of JSON), prints one JSON doc to
// stdout. Warnings stay on stderr so stdout is always pure JSON.
const QUIET_RUNNER = `
import json, sys, os, contextlib, warnings
def main():
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    real_stdout = sys.stdout
    out = []
    with open(os.devnull, "w") as devnull, contextlib.redirect_stdout(devnull):
        warnings.filterwarnings("ignore")
        from kokoro import KPipeline
        pipes = {}
        for item in payload["items"]:
            lc = item["langCode"]
            entry = {"index": item["index"]}
            try:
                if lc not in pipes:
                    pipes[lc] = KPipeline(lang_code=lc, model=False)
                graphemes, phonemes = [], []
                for r in pipes[lc](item["text"]):
                    graphemes.append(r.graphemes or "")
                    phonemes.append(r.phonemes or "")
                entry["ok"] = True
                entry["graphemes"] = graphemes
                entry["phonemes"] = phonemes
            except Exception as e:
                entry["ok"] = False
                entry["error"] = str(e)[:300]
            out.append(entry)
    json.dump({"ok": True, "results": out}, real_stdout, ensure_ascii=False)
main()
`;

function kokoroLangCode(language) {
  return LANGUAGE_CODES[String(language || "").toLowerCase()] || null;
}

/** Default transport: one real python process per batch (cold start per call). */
function realBatchTransport(items, opts = {}) {
  const tmp = path.join(os.tmpdir(), `unfoldiq-kokoro-quiet-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ items }), "utf8");
  try {
    const span = spawnSync("python", ["-c", QUIET_RUNNER, tmp], {
      encoding: "utf8",
      timeout: opts.timeoutMs || 240000,
      windowsHide: true,
    });
    if (span.error) {
      return { ok: false, code: "PRONUNCIATION_RUNTIME_UNAVAILABLE", message: `${ERRORS.PRONUNCIATION_RUNTIME_UNAVAILABLE}: ${String(span.error.message || span.error)}` };
    }
    if (span.status !== 0) {
      return { ok: false, code: "PRONUNCIATION_RUNTIME_FAILED", message: `${ERRORS.PRONUNCIATION_RUNTIME_FAILED}: python exited ${span.status}: ${String(span.stderr || "").slice(-300)}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(span.stdout);
    } catch (e) {
      return { ok: false, code: "PRONUNCIATION_RUNTIME_FAILED", message: `${ERRORS.PRONUNCIATION_RUNTIME_FAILED}: unparseable runtime output: ${String((e && e.message) || e)}` };
    }
    return parsed;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
  }
}

/**
 * Batch quiet phonemization. items: [{index, text, language}].
 * Returns { ok, results: [{index, ok, graphemes[], phonemes[]}|{index, ok:false, error}] }
 * or { ok:false, code, message }.
 */
function phonemizeBatch(items, opts = {}) {
  const prepared = [];
  for (const item of items || []) {
    const langCode = kokoroLangCode(item.language);
    if (!langCode) {
      return { ok: false, code: "PRONUNCIATION_RUNTIME_LANGUAGE_UNSUPPORTED", message: `${ERRORS.PRONUNCIATION_RUNTIME_LANGUAGE_UNSUPPORTED}: ${item.language}` };
    }
    prepared.push({ index: item.index, text: String(item.text || ""), langCode });
  }
  if (prepared.length === 0) return { ok: true, results: [] };
  if (opts.transport && typeof opts.transport === "function") {
    return opts.transport(prepared, opts);
  }
  return realBatchTransport(prepared, opts);
}

/** Single-text convenience wrapper. */
function phonemize(text, language, opts = {}) {
  return phonemizeBatch([{ index: 0, text, language }], opts);
}

// ---------------------------------------------------------------------------
// Provider compilation (canonical entry -> Kokoro-compatible input text)
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findOccurrences(text, term) {
  const occurrences = [];
  const re = new RegExp(`(?:^|[^A-Za-z0-9'])(${escapeRegExp(term)})(?=[^A-Za-z0-9']|$)`, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    occurrences.push({ start: m.index + m[0].indexOf(m[1]), end: m.index + m[0].indexOf(m[1]) + m[1].length });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  if (occurrences.length === 0) {
    const i = text.toLowerCase().indexOf(String(term).toLowerCase());
    if (i >= 0) occurrences.push({ start: i, end: i + term.length });
  }
  return occurrences;
}

/**
 * Apply one canonical entry to one text occurrence set. Returns
 * { applied, replacement } or { applied:false, code } when the notation is
 * not consumable by this compiler (fail-closed, never silently dropped).
 */
function compileEntry(entry, acronymModeResolved) {
  const notation = entry.reading && entry.reading.notation;
  if (entry.category === "ACRONYM") {
    if (acronymModeResolved === "LETTER_BY_LETTER") {
      // Dotted letters ("C.I.A.") phonemize stably letter-by-letter in
      // context; spaced letters lose the final letter to vowel reduction.
      return { applied: true, replacement: `${String(entry.displayTerm).split("").join(".")}.` };
    }
    if (acronymModeResolved === "WORD") {
      return { applied: true, replacement: null }; // espeak already reads it as a word; no text change
    }
    if (acronymModeResolved === "CUSTOM") {
      if (notation === "READ_AS") return { applied: true, replacement: entry.reading.value };
      if (notation === "IPA" || notation === "PROVIDER_NATIVE") return nativeMarkup(entry);
      return { applied: false, code: "PRONUNCIATION_OVERRIDE_NOT_APPLIED", detail: "CUSTOM acronym requires READ_AS or native phoneme notation for local-kokoro" };
    }
    return { applied: false, code: "PRONUNCIATION_OVERRIDE_NOT_APPLIED", detail: "ACRONYM entry without a resolvable acronymMode" };
  }
  if (notation === "READ_AS") return { applied: true, replacement: entry.reading.value };
  if (notation === "IPA" || notation === "PROVIDER_NATIVE") return nativeMarkup(entry);
  return { applied: false, code: "PRONUNCIATION_OVERRIDE_NOT_APPLIED", detail: `${notation} notation is not consumable by this provider compiler` };
}

/**
 * Official upstream phonetic override (hexgrad/kokoro README syntax):
 * `[Term](/phonemes/)` — kokoro 0.9.4 consumes this verbatim, replacing the
 * default G2P reading of <term> with the specified phonemes. Verified live on
 * the installed runtime (KPipeline lang_code='a', model=False).
 */
function nativeMarkup(entry) {
  return { applied: true, replacement: `[${entry.displayTerm}](/${entry.reading.value}/)` };
}

/**
 * Compile provider input for one segment.
 * entries: canonical entries already resolved to this segment (active only).
 * Returns { ok, compiledText, applications[], notApplied[], changed }.
 */
function compileInput({ text, entries }) {
  const source = String(text || "");
  const applications = [];
  const notApplied = [];
  let compiled = source;
  for (const entry of entries || []) {
    if (entry.quality === "REJECTED") continue;
    const term = entry.displayTerm || entry.normalizedTerm;
    const occurrences = findOccurrences(compiled, term);
    if (occurrences.length === 0) continue;
    const result = compileEntry(entry, entry.acronymMode || null);
    if (!result.applied) {
      notApplied.push({ entryId: entry.entryId, term, code: result.code, detail: result.detail || null });
      continue;
    }
    if (result.replacement !== null) {
      // Replace right-to-left so earlier offsets stay valid; every occurrence.
      for (let i = occurrences.length - 1; i >= 0; i -= 1) {
        const { start, end } = occurrences[i];
        compiled = compiled.slice(0, start) + result.replacement + compiled.slice(end);
      }
    }
    applications.push({ entryId: entry.entryId, term, replacement: result.replacement, occurrenceCount: occurrences.length });
  }
  return { ok: true, compiledText: compiled, applications, notApplied, changed: applications.some((a) => a.replacement !== null) };
}

module.exports = {
  ERRORS,
  phonemize,
  phonemizeBatch,
  compileInput,
  kokoroLangCode,
  QUIET_RUNNER,
};
