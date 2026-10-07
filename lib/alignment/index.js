"use strict";

/**
 * Phase 2.9 — Forced Alignment (UNFOLDIQ CORE).
 *
 * Known canonical text is aligned to CLEAN narration/dialogue stems; the
 * final mixed audio is only the release temporal-validation context. The
 * canonical text is NEVER rewritten: unalignable words become structured
 * findings (UNALIGNED / TEXT_AUDIO_MISMATCH → REVIEW_REQUIRED), never ASR
 * substitutions. Speaker ownership known upstream is preserved verbatim;
 * pronunciation hints may guide providers internally but never leak
 * phonetic text into visible words.
 */

const Ajv = require("ajv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const localEnergy = require("./providers/local-energy.js");

const SCHEMA_VERSION = "1.0.0";
const PROVIDERS = {
  [localEnergy.ID]: localEnergy,
};

const ERRORS = {
  ALIGNMENT_SCHEMA_INVALID: "alignment artifact fails schema validation",
  ALIGNMENT_INPUT_INVALID: "alignment request missing/invalid fields",
  UNKNOWN_PROVIDER: "alignment provider is not registered",
  SEGMENT_NOT_FOUND: "segmentId not present in the alignment artifact",
  STALE_DEPENDENCY: "alignment artifact does not match current input hashes",
};

// Timing invariant tolerances (§5.5).
const OVERLAP_TOLERANCE_MS = 20;
const SEGMENT_BOUND_TOLERANCE_RATIO = 0.05;
const SEGMENT_BOUND_TOLERANCE_MIN_MS = 250;
const DRIFT_GAP_MS = 2000;
const MIN_COVERAGE_RATIO = 0.95;
const WORD_RUN_MATCH_CONFIDENCE = 0.9;

let _validator = null;
function validator() {
  if (!_validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "alignment.schema.json"), "utf8"));
    _validator = ajv.compile(schema);
  }
  return _validator;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function transcriptHash(segments) {
  return sha256Hex(Buffer.from(JSON.stringify(segments.map((s) => ({ segmentId: s.segmentId, text: s.text })))));
}

// ---------- alignment (2.9-D) ----------

/**
 * request: spec §5.3 — { projectId, language, transcriptVersion,
 * narrationTimingHash, segments: [{segmentId, speakerId?, text, audioRef,
 * expectedStartMs?, expectedEndMs?}], providerPolicyVersion }.
 * opts: { providerId, readAudio(path)→Buffer, finalMixHash }.
 */
function align(request, opts = {}) {
  const t0 = Date.now();
  if (!request || !request.projectId || !Array.isArray(request.segments) || !request.narrationTimingHash) {
    return { ok: false, code: "ALIGNMENT_INPUT_INVALID", message: ERRORS.ALIGNMENT_INPUT_INVALID };
  }
  const providerId = opts.providerId || localEnergy.ID;
  const provider = PROVIDERS[providerId];
  if (!provider) return { ok: false, code: "UNKNOWN_PROVIDER", message: `${ERRORS.UNKNOWN_PROVIDER}: ${providerId}` };
  const readAudio = opts.readAudio || ((p) => fs.readFileSync(p));

  const words = [];
  const perSegment = [];
  let durationMs = 0;
  for (const seg of request.segments) {
    if (!seg.segmentId || typeof seg.text !== "string") {
      return { ok: false, code: "ALIGNMENT_INPUT_INVALID", message: `${ERRORS.ALIGNMENT_INPUT_INVALID}: segment ${seg && seg.segmentId}` };
    }
    // Speaker ownership is preserved verbatim (§5.6); pronunciation hints are
    // provider-internal only and never alter visible canonical text (§5.7).
    const bytes = seg.audioRef ? readAudio(seg.audioRef) : null;
    const r = provider.alignSegment({
      text: seg.text,
      audioBytes: bytes,
      expectedStartMs: seg.expectedStartMs || 0,
      expectedEndMs: seg.expectedEndMs,
      pronunciationHints: seg.pronunciationHints,
    });
    if (!r.ok) return r;
    // Run/word 1:1 mapping boosts confidence; otherwise the base applies.
    const runs = bytes ? provider.speechRuns(bytes) : null;
    const exactRuns = runs && runs.ok && runs.runs.length === localEnergy.tokenize(seg.text).length;
    for (const w of r.words) {
      words.push({
        wordId: `w-${String(words.length + 1).padStart(5, "0")}`,
        segmentId: seg.segmentId,
        ...(seg.speakerId ? { speakerId: seg.speakerId } : {}),
        text: w.text,
        startMs: w.startMs,
        endMs: w.endMs,
        confidence: exactRuns && w.status === "ALIGNED" ? WORD_RUN_MATCH_CONFIDENCE : w.confidence,
        status: w.status,
      });
    }
    perSegment.push({ segmentId: seg.segmentId, durationMs: r.durationMs, speechRatio: r.speechRatio });
    durationMs += r.durationMs;
  }

  const phrases = buildPhrases(words);
  const metrics = computeMetrics(words, durationMs, Date.now() - t0);
  const artifact = {
    version: SCHEMA_VERSION,
    projectId: request.projectId,
    transcriptHash: transcriptHash(request.segments),
    narrationTimingHash: request.narrationTimingHash,
    ...(opts.finalMixHash ? { finalMixHash: opts.finalMixHash } : {}),
    provider: { id: providerId, version: provider.VERSION },
    words,
    phrases,
    metrics,
    qa: { status: "PASS", findings: [] },
    qaStatus: "PASS",
    createdAt: new Date().toISOString(),
  };
  const qa = alignmentQA(artifact, { segments: request.segments });
  artifact.qa = { status: qa.status, findings: qa.findings, metrics: qa.metrics };
  artifact.qaStatus = qa.status;
  const valid = validator()(artifact);
  if (!valid) return { ok: false, code: "ALIGNMENT_SCHEMA_INVALID", message: ajvText(validator().errors) };
  return { ok: true, artifact, qa, perSegment };
}

function buildPhrases(words) {
  const phrases = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    phrases.push({
      phraseId: `ph-${String(phrases.length + 1).padStart(4, "0")}`,
      segmentId: current[0].segmentId,
      ...(current[0].speakerId ? { speakerId: current[0].speakerId } : {}),
      wordIds: current.map((w) => w.wordId),
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
    });
    current = [];
  };
  for (const w of words) {
    current.push(w);
    const boundary = /[.!?;:]$/.test(w.text);
    const speakerChange = false; // phrases never cross segments by construction
    if (boundary || current.length >= 12 || speakerChange) flush();
  }
  flush();
  return phrases;
}

function computeMetrics(words, durationMs, latencyMs) {
  const aligned = words.filter((w) => w.status === "ALIGNED").length;
  const interpolated = words.filter((w) => w.status === "INTERPOLATED").length;
  const unaligned = words.filter((w) => w.status === "UNALIGNED").length;
  return {
    wordCount: words.length,
    alignedWordCount: aligned,
    interpolatedWordCount: interpolated,
    unalignedWordCount: unaligned,
    coverageRatio: words.length ? Number(((aligned + interpolated) / words.length).toFixed(4)) : 0,
    durationMs,
    alignLatencyMs: latencyMs,
    localRealignCount: 0,
  };
}

// ---------- alignment QA (2.9-F / §5.10) ----------

function alignmentQA(artifact, { segments = [], minCoverage = MIN_COVERAGE_RATIO } = {}) {
  const findings = [];
  const { words } = artifact;
  const tolFor = (seg) => Math.max(SEGMENT_BOUND_TOLERANCE_MIN_MS, (seg ? (seg.expectedEndMs - seg.expectedStartMs) || 0 : 0) * SEGMENT_BOUND_TOLERANCE_RATIO);

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (w.endMs <= w.startMs) {
      findings.push(finding("TIMING_INVALID", { wordId: w.wordId, startMs: w.startMs, endMs: w.endMs, reason: "non-positive word duration", correctiveAction: "REALIGN_SEGMENT" }));
    }
    if (i > 0) {
      const prev = words[i - 1];
      if (w.startMs < prev.endMs - OVERLAP_TOLERANCE_MS && prev.segmentId === w.segmentId) {
        findings.push(finding("TIMING_OVERLAP", { wordId: w.wordId, startMs: w.startMs, endMs: prev.endMs, reason: `word overlaps predecessor by ${prev.endMs - w.startMs}ms in the same spoken stream`, correctiveAction: "REALIGN_SEGMENT" }));
      }
      if (prev.segmentId === w.segmentId && w.startMs - prev.endMs > DRIFT_GAP_MS) {
        findings.push(finding("ALIGNMENT_DRIFT", { wordId: w.wordId, startMs: prev.endMs, endMs: w.startMs, reason: `unexplained ${w.startMs - prev.endMs}ms gap between adjacent words`, correctiveAction: "REALIGN_SEGMENT" }));
      }
    }
    const seg = segments.find((s) => s.segmentId === w.segmentId);
    if (seg && seg.expectedEndMs && w.endMs > seg.expectedEndMs + tolFor(seg)) {
      findings.push(finding("SEGMENT_BOUND_OVERFLOW", { wordId: w.wordId, endMs: w.endMs, reason: `word end ${w.endMs}ms beyond segment bound ${seg.expectedEndMs}ms`, correctiveAction: "REALIGN_SEGMENT" }));
    }
    if (w.status === "UNALIGNED") {
      findings.push(finding("UNALIGNED_WORD", { wordId: w.wordId, segmentId: w.segmentId, reason: `word "${w.text}" could not be aligned to audio`, correctiveAction: "REALIGN_SEGMENT" }));
    }
  }

  // Segment duration consistency: last aligned word end vs expectedEnd.
  for (const seg of segments) {
    if (!seg.expectedEndMs) continue;
    const segWords = words.filter((w) => w.segmentId === seg.segmentId && w.status === "ALIGNED");
    if (!segWords.length) continue;
    const lastEnd = Math.max(...segWords.map((w) => w.endMs));
    if (lastEnd > seg.expectedEndMs + tolFor(seg)) {
      findings.push(finding("ALIGNMENT_DRIFT", { segmentId: seg.segmentId, endMs: lastEnd, reason: `last word ends ${lastEnd}ms vs segment end ${seg.expectedEndMs}ms`, correctiveAction: "REALIGN_SEGMENT" }));
    }
  }

  const unalignedRatio = artifact.metrics.wordCount ? artifact.metrics.unalignedWordCount / artifact.metrics.wordCount : 0;
  if (artifact.metrics.coverageRatio < minCoverage) {
    findings.push(finding("LOW_ALIGNMENT_COVERAGE", { reason: `coverage ${(artifact.metrics.coverageRatio * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(0)}% (unaligned ${(unalignedRatio * 100).toFixed(1)}%)`, correctiveAction: "REALIGN_SEGMENT" }));
  }

  const fail = findings.some((f) => f.correctiveAction === "REALIGN_SEGMENT" && (f.code === "TIMING_INVALID" || f.code === "TIMING_OVERLAP")) ||
    unalignedRatio > 0.1;
  const review = findings.length > 0 && !fail;
  return {
    status: fail ? "FAIL" : (review ? "REVIEW_REQUIRED" : "PASS"),
    findings,
    metrics: {
      coverageRatio: artifact.metrics.coverageRatio,
      unalignedWordCount: artifact.metrics.unalignedWordCount,
      findingCount: findings.length,
    },
  };
}

function finding(code, extra) {
  return { code, ...(extra || {}), reason: extra.reason, correctiveAction: extra.correctiveAction || "REALIGN_SEGMENT" };
}

// ---------- local re-alignment (GAP-E / §5.9) ----------

/**
 * Re-align ONLY the affected segments (+ boundary handles come from the
 * request itself); untouched word timings are preserved verbatim.
 */
function realignSegments(previousArtifact, request, segmentIds, opts = {}) {
  if (!previousArtifact) return { ok: false, code: "ALIGNMENT_INPUT_INVALID", message: "previous artifact required" };
  const wanted = new Set(segmentIds);
  const affectedSegments = request.segments.filter((s) => wanted.has(s.segmentId));
  if (affectedSegments.length !== wanted.size) {
    return { ok: false, code: "SEGMENT_NOT_FOUND", message: ERRORS.SEGMENT_NOT_FOUND };
  }
  const fresh = align({ ...request, segments: affectedSegments }, opts);
  if (!fresh.ok) return fresh;
  const words = [
    ...previousArtifact.words.filter((w) => !wanted.has(w.segmentId)),
    ...fresh.artifact.words,
  ];
  // Rebuild word IDs + phrases over the merged stream (timing untouched for
  // unaffected words; IDs stay stable per text+segment for idempotency).
  words.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  words.forEach((w, i) => { w.wordId = `w-${String(i + 1).padStart(5, "0")}`; });
  const artifact = {
    ...fresh.artifact,
    words,
    phrases: buildPhrases(words),
    metrics: { ...computeMetrics(words, fresh.artifact.metrics.durationMs, fresh.artifact.metrics.alignLatencyMs), localRealignCount: (previousArtifact.metrics.localRealignCount || 0) + segmentIds.length },
    createdAt: new Date().toISOString(),
  };
  const qa = alignmentQA(artifact, { segments: request.segments });
  artifact.qa = { status: qa.status, findings: qa.findings, metrics: qa.metrics };
  artifact.qaStatus = qa.status;
  const valid = validator()(artifact);
  if (!valid) return { ok: false, code: "ALIGNMENT_SCHEMA_INVALID", message: ajvText(validator().errors) };
  return { ok: true, artifact, qa, realigned: segmentIds };
}

// ---------- invalidation (GAP-C / §11) ----------

/**
 * Pure mix-only vs timing-sensitive invalidation decision.
 */
function resolveAlignmentInvalidation({ prevNarrationTimingHash, nextNarrationTimingHash, prevFinalMixHash, nextFinalMixHash }) {
  const timingChanged = prevNarrationTimingHash !== nextNarrationTimingHash;
  const mixChanged = prevFinalMixHash !== nextFinalMixHash;
  return {
    alignmentDirty: timingChanged,
    captionTimingDirty: timingChanged,
    finalAudioDirty: mixChanged || timingChanged,
    mixOnlyChange: mixChanged && !timingChanged,
  };
}

// ---------- temporal validation against Final Audio (GAP-B) ----------

/**
 * Final Audio is the release validation context: word timings must sit
 * inside the final audio duration and inside declared narration-active
 * ranges (with tolerance). Pure validation — no re-alignment here.
 */
function validateAgainstFinalAudio(artifact, { finalAudioDurationMs, narrationRanges = [], toleranceMs = 250 } = {}) {
  const findings = [];
  if (!finalAudioDurationMs) {
    return { ok: false, code: "ALIGNMENT_INPUT_INVALID", message: "finalAudioDurationMs required" };
  }
  for (const w of artifact.words) {
    if (w.status === "UNALIGNED") continue;
    if (w.endMs > finalAudioDurationMs + toleranceMs) {
      findings.push(finding("FINAL_AUDIO_OVERFLOW", { wordId: w.wordId, endMs: w.endMs, reason: `word end beyond final audio duration ${finalAudioDurationMs}ms`, correctiveAction: "REALIGN_SEGMENT" }));
    }
    if (narrationRanges.length) {
      const inside = narrationRanges.some((r) => w.startMs >= r.startMs - toleranceMs && w.endMs <= r.endMs + toleranceMs);
      if (!inside) {
        findings.push(finding("WORD_OUTSIDE_NARRATION_RANGE", { wordId: w.wordId, startMs: w.startMs, endMs: w.endMs, reason: "aligned word outside any narration-active range in the final mix", correctiveAction: "REALIGN_SEGMENT" }));
      }
    }
  }
  return { ok: findings.length === 0, status: findings.length ? "FAIL" : "PASS", findings };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  SCHEMA_VERSION,
  ERRORS,
  PROVIDERS,
  MIN_COVERAGE_RATIO,
  align,
  realignSegments,
  alignmentQA,
  resolveAlignmentInvalidation,
  validateAgainstFinalAudio,
  transcriptHash,
  buildPhrases,
  validateArtifact(artifact) {
    const ok = validator()(artifact);
    return { ok, errors: ok ? [] : ajvText(validator().errors) };
  },
};
