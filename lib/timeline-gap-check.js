"use strict";

/**
 * UNFOLDIQ timeline gap check (STEP-11 Branch A).
 * Pure timeline math over scene/voice/caption/asset ranges. No I/O, no estimates.
 * Intentional pauses require explicit type + purpose + bounded duration, else unexplained.
 */

const PAUSE_TYPES = ["pause", "hold", "silence"];

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function validRange(r) {
  if (!r || typeof r !== "object") return null;
  const s = num(r.startMs);
  const e = num(r.endMs);
  if (s === null || e === null || e < s) return null;
  return { startMs: s, endMs: e };
}

function validPause(p, gapMs) {
  if (!p || typeof p !== "object") return false;
  if (!PAUSE_TYPES.includes(p.type)) return false;
  if (typeof p.purpose !== "string" || p.purpose.length === 0) return false;
  return Number(p.durationMs) === gapMs;
}

function scenePauseCovers(scenes, winStart, winEnd, gapMs) {
  for (const s of scenes) {
    if (!s || typeof s !== "object") continue;
    const r = validRange(s);
    if (!r) continue;
    if (r.endMs <= winStart || r.startMs >= winEnd) continue;
    const pauses = Array.isArray(s.pauses) ? s.pauses : s.pause !== undefined ? [s.pause] : [];
    for (const p of pauses) {
      if (!p || typeof p !== "object") continue;
      if (!PAUSE_TYPES.includes(p.type)) continue;
      if (typeof p.purpose !== "string" || p.purpose.length === 0) continue;
      if (gapMs !== null && Number(p.durationMs) !== gapMs) continue;
      return true;
    }
  }
  return false;
}

function checkGaps(input) {
  const o = input && typeof input === "object" ? input : {};
  const rawScenes = Array.isArray(o.scenes) ? o.scenes : [];
  const rawVoice = Array.isArray(o.voiceRanges) ? o.voiceRanges : [];
  const rawCaptions = Array.isArray(o.captionItems) ? o.captionItems : [];
  const rawAssets = Array.isArray(o.assets) ? o.assets : [];

  const scenes = [];
  for (const s of rawScenes) {
    const r = validRange(s);
    if (!r) continue;
    scenes.push({ sceneId: typeof s.sceneId === "string" ? s.sceneId : "", ...r, timingStatus: s.timingStatus, pause: s.pause, pauses: s.pauses });
  }
  scenes.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const voice = [];
  for (const v of rawVoice) {
    const r = validRange(v);
    if (r) voice.push(r);
  }
  voice.sort((a, b) => a.startMs - b.startMs);

  const captions = [];
  for (const c of rawCaptions) {
    const r = validRange(c);
    if (r) captions.push(r);
  }
  captions.sort((a, b) => a.startMs - b.startMs);

  const gaps = [];
  const overlaps = [];
  const issues = [];

  // Scene overlaps: any pair strictly intersecting.
  for (let i = 0; i < scenes.length; i += 1) {
    for (let j = i + 1; j < scenes.length; j += 1) {
      const a = scenes[i];
      const b = scenes[j];
      if (b.startMs < a.endMs && b.endMs > a.startMs) {
        const overlapMs = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
        overlaps.push({ sceneA: a.sceneId, sceneB: b.sceneId, overlapMs });
        issues.push({
          kind: "OVERLAP_CONFLICT",
          severity: "BLOCK",
          message: `scenes ${a.sceneId || i} and ${b.sceneId || j} overlap by ${overlapMs}ms`,
          sceneA: a.sceneId,
          sceneB: b.sceneId,
          overlapMs
        });
      }
    }
  }

  // Visual gaps between consecutive scenes.
  for (let i = 0; i + 1 < scenes.length; i += 1) {
    const cur = scenes[i];
    const nxt = scenes[i + 1];
    const gap = nxt.startMs - cur.endMs;
    if (gap <= 0) continue;
    const intentional = validPause(cur.pause, gap) || validPause(nxt.pause, gap);
    if (intentional) {
      gaps.push({ kind: "INTENTIONAL_SILENCE", startMs: cur.endMs, endMs: nxt.startMs, gapMs: gap, intentional: true, severity: "OK" });
    } else {
      gaps.push({ kind: "UNEXPLAINED_GAP", startMs: cur.endMs, endMs: nxt.startMs, gapMs: gap, intentional: false, severity: gap <= 2000 ? "REVIEW" : "BLOCK" });
      issues.push({
        kind: "UNEXPLAINED_GAP",
        severity: gap <= 2000 ? "REVIEW" : "BLOCK",
        message: `unexplained visual gap of ${gap}ms between ${cur.sceneId || i} and ${nxt.sceneId || (i + 1)}`,
        startMs: cur.endMs,
        endMs: nxt.startMs,
        gapMs: gap
      });
    }
  }

  // Narration gaps: voice coverage gaps >5000ms without intentional silence.
  for (let i = 0; i + 1 < voice.length; i += 1) {
    const gap = voice[i + 1].startMs - voice[i].endMs;
    if (gap <= 5000) continue;
    const covered = scenePauseCovers(scenes, voice[i].endMs, voice[i + 1].startMs, null);
    if (covered) {
      gaps.push({ kind: "INTENTIONAL_SILENCE", startMs: voice[i].endMs, endMs: voice[i + 1].startMs, gapMs: gap, intentional: true, severity: "OK" });
    } else {
      issues.push({
        kind: "NARRATION_GAP",
        severity: "REVIEW",
        message: `narration gap of ${gap}ms with no intentional silence`,
        startMs: voice[i].endMs,
        endMs: voice[i + 1].startMs,
        gapMs: gap
      });
    }
  }

  // Caption gaps: voice-active spans with no caption cover (>1000ms).
  for (const v of voice) {
    const covering = captions
      .filter((c) => c.endMs > v.startMs && c.startMs < v.endMs)
      .map((c) => ({ startMs: Math.max(c.startMs, v.startMs), endMs: Math.min(c.endMs, v.endMs) }))
      .sort((a, b) => a.startMs - b.startMs);
    let cursor = v.startMs;
    for (const c of covering) {
      if (c.startMs - cursor > 1000) {
        issues.push({
          kind: "CAPTION_GAP",
          severity: "REVIEW",
          message: `voice active ${v.startMs}-${v.endMs}ms but no caption covers ${cursor}-${c.startMs}ms`,
          startMs: cursor,
          endMs: c.startMs,
          gapMs: c.startMs - cursor
        });
      }
      if (c.endMs > cursor) cursor = c.endMs;
    }
    if (v.endMs - cursor > 1000) {
      issues.push({
        kind: "CAPTION_GAP",
        severity: "REVIEW",
        message: `voice active ${v.startMs}-${v.endMs}ms but no caption covers ${cursor}-${v.endMs}ms`,
        startMs: cursor,
        endMs: v.endMs,
        gapMs: v.endMs - cursor
      });
    }
  }

  // Asset windows vs scene use windows.
  const sceneById = new Map();
  for (const s of scenes) {
    if (s.sceneId) sceneById.set(s.sceneId, s);
  }
  for (const raw of rawAssets) {
    if (!raw || typeof raw !== "object") continue;
    const r = validRange(raw);
    if (!r) continue;
    const assetId = typeof raw.assetId === "string" ? raw.assetId : "";
    let host = null;
    if (typeof raw.sceneId === "string" && sceneById.has(raw.sceneId)) {
      host = sceneById.get(raw.sceneId);
    } else {
      host = scenes.find((s) => r.startMs >= s.startMs && r.startMs < s.endMs) || null;
    }
    if (!host) continue;
    if (r.startMs > host.startMs) {
      issues.push({
        kind: "ASSET_STARTS_LATE",
        severity: "REVIEW",
        message: `asset ${assetId || "?"} starts ${r.startMs - host.startMs}ms after scene ${host.sceneId} window start`,
        assetId,
        sceneId: host.sceneId,
        startMs: r.startMs,
        endMs: r.endMs
      });
    }
    if (r.endMs < host.endMs) {
      issues.push({
        kind: "ASSET_ENDS_EARLY",
        severity: "REVIEW",
        message: `asset ${assetId || "?"} ends ${host.endMs - r.endMs}ms before scene ${host.sceneId} window end`,
        assetId,
        sceneId: host.sceneId,
        startMs: r.startMs,
        endMs: r.endMs
      });
    }
  }

  let status = "CLEAN";
  if (issues.some((i) => i.severity === "BLOCK")) status = "BLOCKED";
  else if (issues.some((i) => i.severity === "REVIEW")) status = "REVIEW";

  return { gaps, overlaps, issues, status };
}

module.exports = {
  checkGaps
};
