"use strict";

/**
 * Phase 2.10 + 2.11 — Caption System + Caption/Audio Temporal QA
 * (UNFOLDIQ CORE).
 *
 * Captions derive ONLY from canonical spoken text + AlignmentArtifact —
 * never fresh ASR. Layout is profile-driven (versioned per language/
 * platform), segmentation is semantic (punctuation/clause boundaries, never
 * char-count-only), reading speed is enforced without paraphrasing content,
 * SRT/VTT exports round-trip validate. Temporal QA detects drift,
 * duplicates, flicker, blank gaps and pathological boundaries; repair is
 * structured and bounded.
 */

const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.0.0";

// Versioned caption profiles (GAP-F). Netflix Vietnamese timed-text values
// are benchmark inputs for the long-form profile — NOT universal law.
const CAPTION_PROFILES = {
  "vi-longform-benchmark@1.0.0": {
    profileId: "vi-longform-benchmark",
    version: "1.0.0",
    language: "vi",
    platform: "GENERIC",
    contentType: "LONG_FORM",
    maxLines: 2,
    maxCharsPerLine: 42,
    maxCharactersPerSecond: 17,
    minCueDurationMs: 833,
    maxCueDurationMs: 7000,
    minGapMs: 84,
    presentationMode: "BLOCK",
    accessibilityMode: "DIALOGUE_ONLY",
    positioningPolicy: "BOTTOM_CENTER",
    safeZone: { top: 0.1, right: 0.05, bottom: 0.15, left: 0.05 },
  },
  "vi-shortform@1.0.0": {
    profileId: "vi-shortform",
    version: "1.0.0",
    language: "vi",
    platform: "SHORT_FORM",
    contentType: "SHORT_FORM",
    maxLines: 2,
    maxCharsPerLine: 32,
    maxCharactersPerSecond: 20,
    minCueDurationMs: 500,
    maxCueDurationMs: 3000,
    minGapMs: 84,
    presentationMode: "BLOCK",
    accessibilityMode: "DIALOGUE_ONLY",
    positioningPolicy: "BOTTOM_CENTER",
    safeZone: { top: 0.12, right: 0.08, bottom: 0.2, left: 0.08 },
  },
};

const ERRORS = {
  CAPTION_SCHEMA_INVALID: "caption artifact fails schema validation",
  CAPTION_INPUT_INVALID: "caption inputs missing/invalid",
  PROFILE_INVALID: "caption profile invalid",
  EXPORT_PARSE_FAIL: "export does not round-trip",
};

// Sentence/clause boundary punctuation (semantic cue breaks — §6.4).
const CLAUSE_BREAK = /[.!?…;:]$/;
const SENTENCE_BREAK = /[.!?…]$/;

let _artifactValidator = null;
function artifactValidator() {
  if (!_artifactValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "caption.schema.json"), "utf8"));
    _artifactValidator = ajv.compile(schema);
  }
  return _artifactValidator;
}
let _profileValidator = null;
function profileValidator() {
  if (!_profileValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "caption-profile.schema.json"), "utf8"));
    _profileValidator = ajv.compile(schema);
  }
  return _profileValidator;
}

function getProfile(ref) {
  const p = CAPTION_PROFILES[ref];
  return p || null;
}

// ---------- caption building (2.10-B/C/D) ----------

function visibleLen(s) {
  return s.replace(/\s+/g, " ").length;
}

/**
 * Build caption events from aligned words. Segmentation preference order
 * (§6.4): sentence/clause punctuation → speaker change → line/reading-speed
 * budget → word boundary. Never breaks inside a word; never paraphrases.
 */
function buildCaptions(inputs = {}) {
  const { projectId, alignment, profileRef, mode = "DIALOGUE_ONLY", speakerLabels = {}, nonSpeechEvents = [], inputHashes = {} } = inputs;
  if (!projectId || !alignment || !profileRef) {
    return { ok: false, code: "CAPTION_INPUT_INVALID", message: ERRORS.CAPTION_INPUT_INVALID };
  }
  const profile = typeof profileRef === "string" ? getProfile(profileRef) : profileRef;
  if (!profile || !profileValidator()(profile)) {
    return { ok: false, code: "PROFILE_INVALID", message: ERRORS.PROFILE_INVALID };
  }
  const words = alignment.words.filter((w) => w.status !== "UNALIGNED");
  const events = [];
  let bucket = [];
  const flush = () => {
    if (!bucket.length) return;
    events.push(makeEvent(bucket, events.length, profile, mode, speakerLabels));
    bucket = [];
  };
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const prev = bucket[bucket.length - 1];
    const speakerChanged = prev && w.speakerId && prev.speakerId && w.speakerId !== prev.speakerId;
    const textSoFar = bucket.concat([w]).map((x) => x.text).join(" ");
    const durSoFar = w.endMs - (bucket[0] ? bucket[0].startMs : w.startMs);
    const projectedCps = durSoFar > 0 ? visibleLen(textSoFar) / (durSoFar / 1000) : 0;
    const bucketChars = visibleLen(textSoFar);
    // Max-duration split: a cue may never outlive maxCueDurationMs.
    const tooLong = prev && (w.endMs - bucket[0].startMs) > profile.maxCueDurationMs;
    if (prev && (speakerChanged || tooLong || bucketChars > profile.maxCharsPerLine * profile.maxLines)) flush();
    bucket.push(w);
    const closes =
      SENTENCE_BREAK.test(w.text) ||
      (CLAUSE_BREAK.test(w.text) && visibleLen(bucket.map((x) => x.text).join(" ")) >= Math.round(profile.maxCharsPerLine * 0.4)) ||
      projectedCps > profile.maxCharactersPerSecond * 1.5 ||
      visibleLen(bucket.map((x) => x.text).join(" ")) > profile.maxCharsPerLine * profile.maxLines;
    if (closes) flush();
  }
  flush();

  // Flicker prevention + cue-shape normalization: rebalance single-word cues
  // by moving an adjacent word, then merge too-short cues into neighbours.
  normalizeCueShapes(events, profile, words);

  // ACCESSIBLE_CAPTIONS: meaningful non-speech audio events (§6.10) sourced
  // from caller-provided plan metadata, never waveform guessing.
  let allEvents = events;
  if (mode === "ACCESSIBLE_CAPTIONS" && nonSpeechEvents.length) {
    allEvents = insertNonSpeechEvents(events, nonSpeechEvents, profile, mode);
  }

  const artifact = {
    version: SCHEMA_VERSION,
    projectId,
    alignmentVersion: alignment.version,
    narrationTimingHash: alignment.narrationTimingHash,
    profileRef: `${profile.profileId}@${profile.version}`,
    mode,
    events: allEvents,
    qa: { status: "PASS", findings: [] },
    qaStatus: "PASS",
    inputHashes: {
      ...inputHashes,
      transcript: alignment.transcriptHash,
      alignment: alignment.narrationTimingHash,
    },
    createdAt: new Date().toISOString(),
  };
  const qa = captionQA(artifact, { profile, alignment, nonSpeechEvents });
  artifact.qa = { status: qa.status, findings: qa.findings, metrics: qa.metrics };
  artifact.qaStatus = qa.status;
  const valid = artifactValidator()(artifact);
  if (!valid) return { ok: false, code: "CAPTION_SCHEMA_INVALID", message: ajvText(artifactValidator().errors) };
  return { ok: true, artifact, qa, profile };
}

function makeEvent(bucket, idx, profile, mode, speakerLabels) {
  const text = bucket.map((w) => w.text).join(" ");
  const lines = layoutLines(text, profile);
  const speakerId = bucket[0].speakerId;
  return {
    captionId: `cap-${String(idx + 1).padStart(4, "0")}`,
    startMs: bucket[0].startMs,
    endMs: bucket[bucket.length - 1].endMs,
    text,
    lines,
    ...(speakerId ? { speakerId, ...(speakerLabels[speakerId] ? { speakerLabel: speakerLabels[speakerId] } : {}) } : {}),
    wordIds: bucket.map((w) => w.wordId),
    presentation: { mode: profile.presentationMode, anchor: profile.positioningPolicy, safeZoneRef: `${profile.profileId}@${profile.version}` },
    locked: false,
  };
}

/** Balanced semantic-ish line layout within maxLines/maxCharsPerLine. */
function layoutLines(text, profile) {
  const maxChars = profile.maxCharsPerLine;
  if (visibleLen(text) <= maxChars) return [text];
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (visibleLen(candidate) > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  // Re-balance: if over maxLines, rebalance lengths (words preserved).
  if (lines.length > profile.maxLines) {
    const flat = lines.join(" ").split(" ");
    const per = Math.ceil(flat.length / profile.maxLines);
    const out = [];
    for (let i = 0; i < flat.length; i += per) out.push(flat.slice(i, i + per).join(" "));
    return out.slice(0, profile.maxLines);
  }
  return lines;
}

/**
 * Cue-shape normalization:
 * 1. Single-word cues (awkward split leftovers) absorb an adjacent word from
 *    a ≥3-word neighbour when timing is contiguous — sentence text order and
 *    canonical word identity are preserved.
 * 2. Too-short cues merge into a compatible neighbour (same speaker, line
 *    budget, maxCueDurationMs). Unmergeable cues stay for honest QA.
 */
function normalizeCueShapes(events, profile, allWords) {
  const byId = new Map(allWords.map((w) => [w.wordId, w]));
  const canMerge = (a, b) =>
    !(a.speakerId && b.speakerId && a.speakerId !== b.speakerId) &&
    visibleLen(`${a.text} ${b.text}`) <= profile.maxCharsPerLine * profile.maxLines &&
    (b.endMs - a.startMs) <= profile.maxCueDurationMs;
  const mergeInto = (target, src) => {
    target.text = `${target.text} ${src.text}`;
    target.startMs = Math.min(target.startMs, src.startMs);
    target.endMs = Math.max(target.endMs, src.endMs);
    target.wordIds = target.wordIds.concat(src.wordIds);
    target.lines = layoutLines(target.text, profile);
  };
  const relayout = (e) => {
    e.text = e.wordIds.map((id) => (byId.get(id) || { text: "" }).text).join(" ");
    e.lines = layoutLines(e.text, profile);
  };
  // 1. Rebalance single-word cues.
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.wordIds.length !== 1) continue;
    const prev = i > 0 ? events[i - 1] : null;
    const next = i + 1 < events.length ? events[i + 1] : null;
    if (prev && prev.wordIds.length >= 3 &&
        !(prev.speakerId && e.speakerId && prev.speakerId !== e.speakerId)) {
      const moved = byId.get(prev.wordIds[prev.wordIds.length - 1]);
      const newLast = byId.get(prev.wordIds[prev.wordIds.length - 2]);
      if (moved && newLast && e.endMs - moved.startMs <= profile.maxCueDurationMs &&
          newLast.endMs - prev.startMs >= profile.minCueDurationMs) {
        prev.wordIds.pop();
        prev.endMs = newLast.endMs;
        relayout(prev);
        e.wordIds.unshift(moved.wordId);
        e.startMs = moved.startMs;
        relayout(e);
        continue;
      }
    }
    if (next && next.wordIds.length >= 3 &&
        !(next.speakerId && e.speakerId && next.speakerId !== e.speakerId)) {
      const moved = byId.get(next.wordIds[0]);
      const newFirst = byId.get(next.wordIds[1]);
      if (moved && newFirst && newFirst.endMs - e.startMs <= profile.maxCueDurationMs &&
          next.endMs - newFirst.startMs >= profile.minCueDurationMs) {
        next.wordIds.shift();
        next.startMs = newFirst.startMs;
        relayout(next);
        e.wordIds.push(moved.wordId);
        e.endMs = moved.endMs;
        relayout(e);
      }
    }
  }
  // 2. Merge too-short cues.
  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.endMs - e.startMs >= profile.minCueDurationMs) { i += 1; continue; }
    if (i > 0 && canMerge(events[i - 1], e)) {
      mergeInto(events[i - 1], e);
      events.splice(i, 1);
      continue;
    }
    if (i + 1 < events.length && canMerge(e, events[i + 1])) {
      mergeInto(e, events[i + 1]);
      events.splice(i + 1, 1);
      continue;
    }
    i += 1;
  }
}

function insertNonSpeechEvents(events, nonSpeechEvents, profile, mode) {
  const all = events.map((e) => ({ ...e }));
  for (const n of nonSpeechEvents) {
    if (!n.label || typeof n.startMs !== "number") continue;
    all.push({
      captionId: `cap-nse-${n.eventId || all.length}`,
      startMs: n.startMs,
      endMs: n.endMs || n.startMs + 1500,
      text: `[${n.label}]`,
      lines: [`[${n.label}]`],
      nonSpeechEventRef: n.eventId || n.label,
      presentation: { mode: profile.presentationMode, anchor: profile.positioningPolicy, safeZoneRef: `${profile.profileId}@${profile.version}` },
      locked: false,
    });
  }
  all.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return all;
}

// ---------- caption QA (2.11-A/B/C) ----------

function normalizeWords(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function captionQA(artifact, opts = {}) {
  const { profile, alignment, nonSpeechEvents } = opts;
  const findings = [];
  const dialogue = artifact.events.filter((e) => !e.nonSpeechEventRef);
  const metricsEvents = [];

  // Duplicate detection FIRST (§7.4): identical word ranges emitted twice.
  // A confirmed duplicate makes TEXT_FIDELITY locally repairable.
  let hasDuplicate = false;
  const seen = new Map();
  for (const e of dialogue) {
    const key = (e.wordIds || []).join(",");
    if (key && seen.has(key)) {
      hasDuplicate = true;
      findings.push(f({ code: "CAPTION_DUPLICATE", captionId: e.captionId, reason: `duplicate word range of ${seen.get(key)}`, correctiveAction: "REMOVE_DUPLICATE" }));
    } else if (key) {
      seen.set(key, e.captionId);
    }
  }

  // Text fidelity: caption words == canonical aligned words (order preserved).
  // If the only difference is cue-level duplication, the corrective action is
  // local duplicate removal; otherwise resegmentation/upstream is required.
  if (alignment) {
    const canonical = alignment.words.filter((w) => w.status !== "UNALIGNED").map((w) => normalizeWords(w.text)).join(" ");
    const captioned = dialogue.map((e) => e.text.split(/\s+/)).flat().map(normalizeWords).join(" ");
    const canonList = canonical.split(" ").filter(Boolean);
    const capList = captioned.split(" ").filter(Boolean);
    if (canonList.join(" ") !== capList.join(" ")) {
      findings.push(f({
        code: "TEXT_FIDELITY", reason: "caption text does not match canonical spoken text (missing/duplicated/paraphrased words)",
        correctiveAction: hasDuplicate ? "REMOVE_DUPLICATE" : "RESEGMENT_CAPTION",
      }));
    }
  }

  for (let i = 0; i < artifact.events.length; i += 1) {
    const e = artifact.events[i];
    const durMs = e.endMs - e.startMs;
    const chars = visibleLen(e.text);
    const cps = durMs > 0 ? Number((chars / (durMs / 1000)).toFixed(2)) : Infinity;
    metricsEvents.push({ captionId: e.captionId, durMs, chars, cps });
    if (e.nonSpeechEventRef) continue;
    if (cps > profile.maxCharactersPerSecond) {
      findings.push(f({ code: "CAPTION_TOO_FAST", captionId: e.captionId, reason: `reading speed ${cps} CPS > profile ${profile.maxCharactersPerSecond}`, correctiveAction: "RESEGMENT_CAPTION" }));
    }
    if (e.lines.length > profile.maxLines || e.lines.some((l) => visibleLen(l) > profile.maxCharsPerLine)) {
      findings.push(f({ code: "BAD_LINE_BREAK", captionId: e.captionId, reason: `lines ${e.lines.length}/${e.lines.map((l) => visibleLen(l)).join(",")} exceed profile ${profile.maxLines}x${profile.maxCharsPerLine}`, correctiveAction: "RESEGMENT_CAPTION" }));
    }
    if (durMs < profile.minCueDurationMs) {
      findings.push(f({ code: "CAPTION_FLICKER", captionId: e.captionId, startMs: e.startMs, endMs: e.endMs, reason: `cue ${durMs}ms < min ${profile.minCueDurationMs}ms`, correctiveAction: "MERGE_CAPTIONS" }));
    }
    if (durMs > profile.maxCueDurationMs) {
      findings.push(f({ code: "CAPTION_TOO_LONG", captionId: e.captionId, reason: `cue ${durMs}ms > max ${profile.maxCueDurationMs}ms`, correctiveAction: "SPLIT_CAPTION" }));
    }
    // Pathological boundary (§7.5): a single word FLASHING alone (below the
    // profile's minimum readable duration) without single-word profile intent.
    if (profile.presentationMode === "BLOCK" && e.text.trim().split(/\s+/).length === 1 &&
        durMs < profile.minCueDurationMs && !/\[.+\]/.test(e.text)) {
      findings.push(f({ code: "PATHOLOGICAL_BOUNDARY", captionId: e.captionId, reason: "single-word flash below minimum duration", correctiveAction: "MERGE_CAPTIONS" }));
    }
    if (i > 0) {
      const prev = artifact.events[i - 1];
      const gap = e.startMs - prev.endMs;
      if (gap < 0) {
        findings.push(f({ code: "CAPTION_OVERLAP", captionId: e.captionId, reason: `overlaps previous cue by ${-gap}ms`, correctiveAction: "ADJUST_TIMING" }));
      } else if (gap > 2000 && prev.wordIds && e.wordIds && adjacentCanonical(prev, e, alignment)) {
        findings.push(f({ code: "UNINTENDED_BLANK_GAP", captionId: e.captionId, startMs: prev.endMs, endMs: e.startMs, reason: `${gap}ms blank gap between canonically adjacent cues`, correctiveAction: "ADJUST_TIMING" }));
      }
    }
  }

  // Accessibility: meaningful audio cues represented when provided.
  if (artifact.mode === "ACCESSIBLE_CAPTIONS" && Array.isArray(nonSpeechEvents)) {
    for (const n of nonSpeechEvents) {
      if (!artifact.events.some((e) => e.nonSpeechEventRef === (n.eventId || n.label))) {
        findings.push(f({ code: "MISSING_MEANINGFUL_AUDIO_CUE", reason: `meaningful audio event "${n.label}" not captioned`, correctiveAction: "ADD_AUDIO_CUE" }));
      }
    }
  }

  const fail = findings.some((f) => ["TEXT_FIDELITY", "CAPTION_OVERLAP"].includes(f.code) && f.correctiveAction !== "REMOVE_DUPLICATE");
  const maxCps = metricsEvents.reduce((m, x) => Math.max(m, x.cps || 0), 0);
  const avgCps = metricsEvents.length ? Number((metricsEvents.reduce((s, x) => s + (Number.isFinite(x.cps) ? x.cps : 0), 0) / metricsEvents.length).toFixed(2)) : 0;
  return {
    status: fail ? "FAIL" : (findings.length ? "REVIEW_REQUIRED" : "PASS"),
    findings,
    metrics: {
      eventCount: artifact.events.length,
      maxCps,
      avgCps,
      maxLineLength: artifact.events.reduce((m, e) => Math.max(m, ...e.lines.map(visibleLen)), 0),
      findingCount: findings.length,
    },
  };
}

function adjacentCanonical(prev, next, alignment) {
  if (!alignment) return false;
  const ids = alignment.words.filter((w) => w.status !== "UNALIGNED").map((w) => w.wordId);
  const pi = ids.indexOf(prev.wordIds[prev.wordIds.length - 1]);
  const ni = ids.indexOf(next.wordIds[0]);
  return pi !== -1 && ni !== -1 && ni === pi + 1;
}

function f(extra) {
  return { ...extra };
}

// ---------- structured bounded repair (2.11-D, §9/§10) ----------

const REPAIR_BUDGET = { maxAttemptsPerCode: 3, maxTotalAttempts: 6 };

/**
 * Apply local corrective actions to a working copy. Return
 * { ok, artifact, applied, requiresUpstream }.
 */
function applyRepairs(artifact, findings, { profile } = {}) {
  const working = JSON.parse(JSON.stringify(artifact));
  const applied = [];
  const dedup = new Map();
  for (const fd of findings) {
    const key = `${fd.code}:${fd.captionId || "global"}`;
    if (!dedup.has(key)) dedup.set(key, fd);
  }
  for (const fd of dedup.values()) {
    switch (fd.correctiveAction) {
      case "REMOVE_DUPLICATE": {
        const idx = working.events.findIndex((e) => e.captionId === fd.captionId);
        if (idx > 0) { working.events.splice(idx, 1); applied.push({ code: fd.code, action: "REMOVE_DUPLICATE", captionId: fd.captionId }); }
        break;
      }
      case "MERGE_CAPTIONS": {
        const idx = working.events.findIndex((e) => e.captionId === fd.captionId);
        if (idx > 0 && profile) {
          const prev = working.events[idx - 1];
          const cur = working.events[idx];
          const fits = visibleLen(`${prev.text} ${cur.text}`) <= profile.maxCharsPerLine * profile.maxLines &&
            (cur.endMs - prev.startMs) <= profile.maxCueDurationMs;
          if (!fits) break; // guard fails — leave finding for honest re-QA
          prev.text = `${prev.text} ${cur.text}`;
          prev.endMs = cur.endMs;
          prev.wordIds = prev.wordIds.concat(cur.wordIds);
          prev.lines = layoutLines(prev.text, profile);
          working.events.splice(idx, 1);
          applied.push({ code: fd.code, action: "MERGE_CAPTIONS", captionId: fd.captionId });
        } else if (idx > 0) {
          const prev = working.events[idx - 1];
          const cur = working.events[idx];
          prev.text = `${prev.text} ${cur.text}`;
          prev.endMs = cur.endMs;
          prev.wordIds = prev.wordIds.concat(cur.wordIds);
          working.events.splice(idx, 1);
          applied.push({ code: fd.code, action: "MERGE_CAPTIONS", captionId: fd.captionId });
        }
        break;
      }
      case "ADJUST_TIMING": {
        const e = working.events.find((x) => x.captionId === fd.captionId);
        if (e) {
          // Close unintended gaps: pull the cue start back toward the gap.
          if (fd.startMs !== undefined && fd.endMs !== undefined) {
            const gap = fd.endMs - fd.startMs;
            e.startMs = Math.max(0, e.startMs - Math.min(gap - 84, gap));
          }
          applied.push({ code: fd.code, action: "ADJUST_TIMING", captionId: fd.captionId, newStartMs: e.startMs });
        }
        break;
      }
      case "FIX_SPEAKER_LABEL":
      case "ADD_AUDIO_CUE":
      case "CHANGE_PROFILE":
      case "RESEGMENT_CAPTION":
      case "SPLIT_CAPTION":
      case "REALIGN_SEGMENT":
      default:
        return { ok: false, artifact: working, applied, requiresUpstream: fd.correctiveAction };
    }
  }
  return { ok: true, artifact: working, applied, requiresUpstream: null };
}

/**
 * Full bounded caption QA + repair loop. RESEGMENT_CAPTION is handled by
 * re-running the builder (the caller passes the builder inputs).
 */
function captionWithRepair(inputs = {}) {
  const lineage = [];
  const codeAttempts = {};
  let current = null;
  let attempt = 0;
  while (attempt <= REPAIR_BUDGET.maxTotalAttempts) {
    let built;
    if (attempt === 0 || current === null) {
      built = buildCaptions(inputs);
    } else {
      // Re-QA the working artifact without rebuilding from scratch.
      built = { ok: true, artifact: current, qa: captionQA(current, { profile: inputs._profile, alignment: inputs.alignment }) };
    }
    if (!built.ok) return built;
    if (built.profile) inputs._profile = built.profile;
    current = built.artifact;
    const qa = built.qa || captionQA(current, { profile: inputs._profile, alignment: inputs.alignment });
    lineage.push({ attempt, status: qa.status, findings: qa.findings.map((x) => ({ code: x.code, reason: x.reason, correctiveAction: x.correctiveAction })), applied: [], metrics: qa.metrics });
    if (qa.status === "PASS") {
      current.qa = { status: "PASS", findings: [], metrics: qa.metrics };
      current.qaStatus = "PASS";
      return { ok: true, artifact: current, qa, lineage, attempts: attempt };
    }
    const fixable = qa.findings.filter((x) => {
      codeAttempts[x.code] = (codeAttempts[x.code] || 0) + 1;
      return codeAttempts[x.code] <= REPAIR_BUDGET.maxAttemptsPerCode;
    }).filter((x) => !["RESEGMENT_CAPTION", "SPLIT_CAPTION", "REALIGN_SEGMENT", "ADD_AUDIO_CUE", "FIX_SPEAKER_LABEL", "CHANGE_PROFILE"].includes(x.correctiveAction));
    if (fixable.length === 0) {
      return { ok: false, artifact: current, status: qa.status === "FAIL" ? "FAIL" : "REVIEW_REQUIRED", code: "CAPTION_REPAIR_BUDGET_EXHAUSTED", qa, lineage };
    }
    const repair = applyRepairs(current, fixable, { profile: inputs._profile });
    lineage[attempt].applied = repair.applied;
    if (!repair.ok) {
      return { ok: false, artifact: repair.artifact, status: "REVIEW_REQUIRED", code: "CAPTION_UPSTREAM_REQUIRED", requiresUpstream: repair.requiresUpstream, qa, lineage };
    }
    current = repair.artifact;
    attempt += 1;
  }
  return { ok: false, status: "REVIEW_REQUIRED", code: "CAPTION_REPAIR_BUDGET_EXHAUSTED", lineage };
}

// ---------- exports (2.10-E/F) ----------

function srtTime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msec = Math.round(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msec).padStart(3, "0")}`;
}

function vttTime(ms) {
  return srtTime(ms).replace(",", ".");
}

/** UTF-8 SRT with strict monotonic cue numbers and valid timestamps. */
function exportSrt(artifact) {
  const blocks = [];
  let n = 1;
  const sorted = artifact.events.slice().sort((a, b) => a.startMs - b.startMs);
  for (const e of sorted) {
    if (e.endMs <= e.startMs) continue;
    blocks.push(`${n}\n${srtTime(e.startMs)} --> ${srtTime(e.endMs)}\n${e.lines.join("\n")}`);
    n += 1;
  }
  return blocks.join("\n\n") + "\n";
}

function exportVtt(artifact) {
  const blocks = [];
  let n = 1;
  const sorted = artifact.events.slice().sort((a, b) => a.startMs - b.startMs);
  for (const e of sorted) {
    if (e.endMs <= e.startMs) continue;
    blocks.push(`${n}\n${vttTime(e.startMs)} --> ${vttTime(e.endMs)}\n${e.lines.join("\n")}`);
    n += 1;
  }
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

function parseSrt(text) {
  return parseTimestampBlocks(String(text).replace(/^WEBVTT\n+/, ""), ",");
}

function parseVtt(text) {
  return parseTimestampBlocks(String(text).replace(/^WEBVTT\n+/, ""), ".");
}

function parseTimestampBlocks(body, msSep) {
  const cues = [];
  const blocks = body.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const m = tl.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) return { ok: false, code: "EXPORT_PARSE_FAIL", message: "malformed timestamp line" };
    const startMs = ((+m[1] * 3600) + (+m[2] * 60) + +m[3]) * 1000 + +m[4];
    const endMs = ((+m[5] * 3600) + (+m[6] * 60) + +m[7]) * 1000 + +m[8];
    const textLines = lines.filter((l) => l !== tl && !/^\d+$/.test(l.trim()));
    cues.push({ startMs, endMs, text: textLines.join("\n") });
  }
  return { ok: true, cues };
}

/**
 * Round-trip validation (RULE 11): export → parse must preserve timing
 * (within format precision) and text, with correct event count.
 */
function validateExportRoundTrip(artifact, format) {
  const exported = format === "vtt" ? exportVtt(artifact) : exportSrt(artifact);
  const parsed = format === "vtt" ? parseVtt(exported) : parseSrt(exported);
  if (!parsed.ok) return parsed;
  const source = artifact.events.filter((e) => e.endMs > e.startMs).sort((a, b) => a.startMs - b.startMs);
  if (parsed.cues.length !== source.length) {
    return { ok: false, code: "EXPORT_PARSE_FAIL", message: `cue count ${parsed.cues.length} != ${source.length}` };
  }
  for (let i = 0; i < source.length; i += 1) {
    if (Math.abs(parsed.cues[i].startMs - source[i].startMs) > 2 || Math.abs(parsed.cues[i].endMs - source[i].endMs) > 2) {
      return { ok: false, code: "EXPORT_PARSE_FAIL", message: `cue ${i + 1} timing drift after round-trip` };
    }
    if (normalizeWords(parsed.cues[i].text) !== normalizeWords(source[i].lines.join(" "))) {
      return { ok: false, code: "EXPORT_PARSE_FAIL", message: `cue ${i + 1} text changed after round-trip` };
    }
  }
  return { ok: true, format, exported };
}

// ---------- render manifest / localized preview (2.10-G) ----------

function buildRenderManifest(artifact, { profileRef } = {}) {
  return {
    version: SCHEMA_VERSION,
    projectId: artifact.projectId,
    captionArtifactVersion: artifact.version,
    profileRef: profileRef || artifact.profileRef,
    mode: artifact.mode,
    positioning: { policy: "BOTTOM_CENTER", safeZone: null, note: "safe-zone geometry carried per profile ref; Phase 3.5 may re-layout per canvas" },
    preview: { kind: "CAPTION_PREVIEW_LOCALIZED", note: "localized caption preview; no full video render required in Phase 2" },
    events: artifact.events.map((e) => ({
      captionId: e.captionId,
      startMs: e.startMs,
      endMs: e.endMs,
      lines: e.lines,
      presentation: e.presentation,
      ...(e.speakerLabel ? { speakerLabel: e.speakerLabel } : {}),
    })),
  };
}

// ---------- invalidation (§11) ----------

/**
 * Caption-profile-only change dirties captions/exports but NOT alignment.
 * Mix-only change (finalMixHash) with unchanged narrationTimingHash leaves
 * both alignment and caption timing CLEAN.
 */
function resolveCaptionInvalidation({ prevProfileRef, nextProfileRef, prevNarrationTimingHash, nextNarrationTimingHash }) {
  const timingChanged = prevNarrationTimingHash !== nextNarrationTimingHash;
  const profileChanged = prevProfileRef !== nextProfileRef;
  return {
    alignmentDirty: timingChanged,
    captionsDirty: timingChanged || profileChanged,
    exportsDirty: timingChanged || profileChanged,
    profileOnlyChange: profileChanged && !timingChanged,
  };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  SCHEMA_VERSION,
  CAPTION_PROFILES,
  ERRORS,
  REPAIR_BUDGET,
  getProfile,
  buildCaptions,
  captionQA,
  applyRepairs,
  captionWithRepair,
  exportSrt,
  exportVtt,
  parseSrt,
  parseVtt,
  validateExportRoundTrip,
  buildRenderManifest,
  resolveCaptionInvalidation,
  layoutLines,
  validateArtifact(artifact) {
    const ok = artifactValidator()(artifact);
    return { ok, errors: ok ? [] : ajvText(artifactValidator().errors) };
  },
  validateProfile(profile) {
    const ok = profileValidator()(profile);
    return { ok, errors: ok ? [] : ajvText(profileValidator().errors) };
  },
};
