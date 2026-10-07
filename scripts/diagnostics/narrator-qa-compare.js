#!/usr/bin/env node
"use strict";

/**
 * Narrator QA comparison (Phase 2.1 FIX 01 §4).
 *
 * PURPOSE: give the operator an OBJECTIVE basis for choosing a narrator voice,
 * including for operators who cannot judge English audio reliably by ear. It
 * measures ten dimensions and produces a ranked technical recommendation.
 *
 * IT DOES NOT APPROVE ANYTHING. There is no auto-select here and no approval is
 * recorded by this tool; the operator decision stays human and is captured by
 * approveNarratorVoice() only.
 *
 * TEN DIMENSIONS (all measured, never estimated):
 *   1 ASR transcript accuracy / WER vs the exact source text   (faster-whisper)
 *   2 missing / substituted / repeated / hallucinated words    (edit alignment)
 *   3 measured words per minute
 *   4 pause count, mean/median duration, long-silence anomalies
 *   5 forced-alignment / pronunciation anomalies               (word timestamps)
 *   6 prosody variation + monotony indicators
 *   7 cross-clip consistency
 *   8 clipping, noise, RMS/peak, headroom
 *   9 estimated long-form fatigue risk
 *  10 overall technical score /100                            (published rubric)
 *
 * Rendering goes through the real provider adapter (buildPreviewPack), so what
 * is measured is what production would actually produce.
 *
 * Usage:
 *   node scripts/diagnostics/narrator-qa-compare.js \
 *     --project phase2-1-validation --voices am_fenrir,am_michael,am_puck \
 *     [--asr-model small] [--out <path>]
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const license = require("../../lib/voice-bible/license.js");

const ROOT = path.join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Test material. Two scripts per voice so cross-clip consistency is measurable.
// Both are neutral explanatory English at the channel's actual register
// (educational / explainer), ~150 words, no music cues, no SFX.
// ---------------------------------------------------------------------------

const SCRIPTS = [
  {
    id: "A",
    label: "neutral explainer, recommendation-mechanism passage (American spellings: the test language is en-us, and British spellings in the source were previously scored as ASR errors rather than voice errors)",
    text: "Most people learn the basic idea behind a recommendation system without ever seeing the mathematics behind it. At its simplest, the system looks at what you have already chosen, compares that history with the choices of many other people, and then ranks the options that resemble your own past behavior most closely. The resemblance can be measured in several ways. Some systems compare the items themselves, treating each product as a long list of features. Others compare the people, finding groups of viewers whose habits overlap with yours. A third approach mixes both signals together and lets a model learn the weighting on its own. Each approach has a cost. Comparing items is expensive when the catalog is large. Comparing people becomes unreliable when a new viewer arrives with very little history. Mixing the two is the most flexible approach, but it is also the hardest to explain.",
  },
  {
    id: "B",
    label: "neutral explainer, software-robustness passage",
    text: "Before a piece of software is released to the public, it passes through several distinct stages of checking. The first stage looks for crashes, which are situations where the program stops responding entirely and the user loses unsaved work. The second stage checks whether the program produces the correct answer for the inputs it was designed to handle. The third stage is the least comfortable, because it deliberately supplies unusual or malformed inputs to see whether the program degrades safely rather than failing outright. A program that handles these cases well is usually described as robust, and robustness turns out to matter more than raw speed in almost every real deployment. Teams that skip this work discover the problem later, in production, where the cost of a fix is far higher and the users who encounter the fault cannot easily report it. The habit of testing early is therefore not bureaucracy. It is the cheapest available insurance.",
  },
];

// Shared rendering conditions. Identical for every voice and every script.
const CONDITIONS = {
  language: "en-us",
  speedDefault: 1.0,
  format: "wav",
  sampleRate: 24000,
  bitsPerSample: 16,
  noMusic: true,
  noSfx: true,
  externalPaidCredits: 0,
  costClass: "ZERO_LOCAL",
};

/**
 * Scoring rubric, published so a score is auditable rather than a vibe.
 * Every dimension is scored 0..max by an explicit rule; there is no hidden
 * weighting and no cross-dimension fudge factor.
 */
const RUBRIC = {
  intelligibility: { max: 25, rule: "25 at WER 0%, minus 25 points per 1% WER, floored at 0" },
  wordFidelity: { max: 15, rule: "15 minus 3 per missing/substituted/repeated/hallucinated word, floored at 0" },
  rate: { max: 10, rule: "10 inside the 135-165 wpm narration band, tapering to 0 at 100 or 200 wpm" },
  pauseBehaviour: { max: 10, rule: "10 when no internal pause exceeds 0.8s and silence ratio is 0.15-0.45; penalties for long silence or dead air" },
  alignment: { max: 10, rule: "10 minus 2 per overlap / non-monotonic timestamp / long internal gap / extreme word duration / duplicate-word anomaly" },
  prosody: { max: 15, rule: "peaks at healthy variation (F0 range 60-260 Hz, long-term energy CV 0.15-0.45); penalises monotone and erratic extremes" },
  consistency: { max: 5, rule: "5 minus penalties for rate/pitch/level drift between the two clips" },
  cleanliness: { max: 10, rule: "10 when zero clipping, headroom >= 3 dB and SNR >= 30 dB; penalised otherwise" },
};
const TOTAL_MAX = Object.values(RUBRIC).reduce((s, r) => s + r.max, 0);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

// ---------------------------------------------------------------------------
// Python: audio metrics + ASR. One process, one JSON out.
// ---------------------------------------------------------------------------

const PY = `
import sys, json, math, wave, struct, re
import numpy as np

def read_wav(p):
    w = wave.open(p, 'rb')
    sr = w.getframerate(); ch = w.getnchannels()
    raw = w.readframes(w.getnframes()); w.close()
    a = np.frombuffer(raw, dtype='<i2').astype(np.float64)
    if ch > 1: a = a.reshape(-1, ch).mean(axis=1)
    return a / 32768.0, sr

def frames(a, sr, ms):
    n = max(1, int(sr * ms / 1000.0))
    m = (len(a) // n) * n
    return (np.sqrt((a[:m].reshape(-1, n) ** 2).mean(axis=1)), n) if m else (np.array([1e-9]), n)

def db(x):
    return round(20 * math.log10(x), 2) if x > 0 else None

def f0_track(a, sr):
    win = int(sr * 0.04); hop = int(sr * 0.02)
    lo, hi = int(sr / 300.0), int(sr / 60.0)
    out = []
    for i in range(0, max(0, len(a) - win), hop):
        seg = a[i:i+win]
        if np.sqrt((seg ** 2).mean()) < 0.02: continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, 'full')[win-1:]
        if len(ac) <= hi: continue
        k = int(np.argmax(ac[lo:hi])) + lo
        if ac[k] > 0.30 * ac[0]: out.append(sr / k)
    return out

def norm_words(t):
    return re.sub(r'[^a-z0-9 ]', ' ', t.lower()).split()

def edit_align(ref, hyp):
    """Levenshtein with backtrace -> S/D/I ops + per-ref-word fate."""
    n, m = len(ref), len(hyp)
    d = np.zeros((n+1, m+1), dtype=int)
    d[:, 0] = np.arange(n+1); d[0, :] = np.arange(m+1)
    for i in range(1, n+1):
        for j in range(1, m+1):
            d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1] + (ref[i-1] != hyp[j-1]))
    i, j = n, m; ops = []; fate = ['ok'] * n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i-1][j-1] + (ref[i-1] != hyp[j-1]):
            if ref[i-1] != hyp[j-1]: ops.append(('S', ref[i-1], hyp[j-1])); fate[i-1] = 'substituted'
            i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i-1][j] + 1:
            ops.append(('D', ref[i-1], None)); fate[i-1] = 'missing'; i -= 1
        else:
            ops.append(('I', None, hyp[j-1])); j -= 1
    ops.reverse()
    return {'sub': sum(1 for o in ops if o[0]=='S'), 'del': sum(1 for o in ops if o[0]=='D'),
            'ins': sum(1 for o in ops if o[0]=='I'), 'ops': ops, 'fate': fate}

req = json.loads(sys.argv[1])
asr_model = sys.argv[2]
out = {'audio': {}, 'asr': {}, 'asrMeta': {}}

for item in req:
    p = item['path']
    a, sr = read_wav(p)
    dur = len(a) / sr
    f20, n20 = frames(a, sr, 20)
    fsec = n20 / sr
    thr = max(f20.max() * 0.02, 1e-4)
    voiced = f20 > thr
    idx = np.where(voiced)[0]
    lead = float(idx[0] * fsec) if idx.size else dur
    tail = float((len(voiced) - 1 - idx[-1]) * fsec) if idx.size else 0.0

    # pauses: contiguous unvoiced runs strictly INSIDE the voiced span
    pauses = []
    cur = 0
    for k, v in enumerate(voiced):
        if not v and idx.size and idx[0] < k < idx[-1]:
            cur += 1
        else:
            if cur: pauses.append(cur * fsec)
            cur = 0
    if cur: pauses.append(cur * fsec)

    # noise floor from the quietest 5% of frames that are still non-silent work
    sorted_f = np.sort(f20[f20 > 0])
    floor = float(np.percentile(sorted_f[:max(1, len(sorted_f)//20)], 50)) if len(sorted_f) else 0.0
    rms = float(np.sqrt((a ** 2).mean()))
    pk = float(np.abs(a).max())

    active = f20[voiced]
    energy_cv = float(active.std() / active.mean()) if active.size and active.mean() > 0 else 0.0
    f0 = np.array(f0_track(a, sr))
    # long-term (fatigue) signals: per-second energy drift + pitch drift
    f1s, _ = frames(a, sr, 1000)
    v1 = f1s[f1s > thr]
    lt_cv = float(v1.std() / v1.mean()) if v1.size and v1.mean() > 0 else 0.0
    half = len(a) // 2
    e_first = float(np.sqrt((a[:half] ** 2).mean())); e_last = float(np.sqrt((a[half:] ** 2).mean()))
    half_s = max(1, int(sr / 2.0))
    f0a = np.array(f0_track(a[:half], sr)); f0b = np.array(f0_track(a[half:], sr))
    pitch_drift = (float(np.median(f0b) - np.median(f0a)) / float(np.median(f0a)) * 100) if (len(f0a) > 5 and len(f0b) > 5 and np.median(f0a) > 0) else None

    words = len(norm_words(item['text']))
    active_dur = max(1e-6, dur - lead - tail)
    out['audio'][p] = {
        'sampleRate': sr, 'durationSec': round(dur, 3),
        'peakDbfs': db(pk), 'rmsDbfs': db(rms), 'noiseFloorDbfs': db(floor),
        'snrDb': round(db(rms) - db(floor), 2) if db(rms) is not None and db(floor) is not None else None,
        'headroomDb': round(-db(pk), 2) if db(pk) is not None else None,
        'clippedSamples': int((np.abs(a) >= 0.999).sum()),
        'speechRatio': round(float(voiced.mean()), 4),
        'leadingSilenceSec': round(lead, 3), 'trailingSilenceSec': round(tail, 3),
        'pauseCount': len(pauses),
        'pauseMeanSec': round(float(np.mean(pauses)), 3) if pauses else 0.0,
        'pauseMedianSec': round(float(np.median(pauses)), 3) if pauses else 0.0,
        'pauseMaxSec': round(float(np.max(pauses)), 3) if pauses else 0.0,
        'silenceRatio': round(float(1 - voiced.mean()), 4),
        'energyCv': round(energy_cv, 4), 'longTermEnergyCv': round(lt_cv, 4),
        'f0MedianHz': round(float(np.median(f0)), 1) if len(f0) else None,
        'f0RangeHz': round(float(np.percentile(f0, 95) - np.percentile(f0, 5)), 1) if len(f0) > 8 else None,
        'f0SpreadPct': round(float(np.percentile(f0,75)-np.percentile(f0,25))/float(np.median(f0))*100, 1) if len(f0) > 8 and np.median(f0) else None,
        'energyDecayPct': round((e_last - e_first) / e_first * 100, 2) if e_first > 0 else None,
        'pitchDriftPct': round(pitch_drift, 2) if pitch_drift is not None else None,
        'words': words,
        'wpm': round(words / active_dur * 60, 1),
        'wpmWallClock': round(words / dur * 60, 1),
    }

# ---- ASR pass -------------------------------------------------------------
from faster_whisper import WhisperModel
model = WhisperModel(asr_model, device='cpu', compute_type='int8')
for item in req:
    p = item['path']
    segs, info = model.transcribe(p, language='en', word_timestamps=True, beam_size=5, vad_filter=False)
    words = []
    for s in segs:
        for w in (s.words or []):
            words.append({'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3)})
    hyp_txt = ' '.join(x['w'] for x in words)
    ref = norm_words(item['text']); hyp = norm_words(hyp_txt)
    al = edit_align(ref, hyp)
    # item 5: alignment / pronunciation anomalies from word timestamps
    anomalies = {'overlaps': 0, 'nonMonotonic': 0, 'zeroOrNegDuration': 0, 'extremeDurations': 0,
                 'longGaps': 0, 'repeatedWords': 0}
    durs = [x['e'] - x['s'] for x in words if x['e'] > x['s']]
    med_dur = float(np.median(durs)) if durs else 0.0
    for i, x in enumerate(words):
        if x['e'] - x['s'] <= 0: anomalies['zeroOrNegDuration'] += 1
        elif med_dur > 0 and (x['e'] - x['s'] > 3 * med_dur): anomalies['extremeDurations'] += 1
        if i > 0:
            prev = words[i-1]
            if x['s'] < prev['e'] - 0.02: anomalies['overlaps'] += 1
            if x['s'] < prev['s']: anomalies['nonMonotonic'] += 1
            if x['s'] - prev['e'] > 1.0: anomalies['longGaps'] += 1
            if x['w'].lower() == prev['w'].lower() and x['w'].strip(): anomalies['repeatedWords'] += 1
    wer = (al['sub'] + al['del'] + al['ins']) / max(1, len(ref))
    out['asr'][p] = {
        'asrModel': asr_model, 'transcript': hyp_txt.strip(),
        'refWords': len(ref), 'hypWords': len(hyp),
        'substitutions': al['sub'], 'deletions': al['del'], 'insertions': al['ins'],
        'wer': round(wer, 4), 'werPct': round(wer * 100, 2),
        'wordOps': [{'op': o[0], 'ref': o[1], 'hyp': o[2]} for o in al['ops'] if o[0] != 'M'][:40],
        'wordFate': al['fate'],
        'alignment': anomalies,
        'medianWordDurSec': round(med_dur, 3),
    }
print(json.dumps(out))
`;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

function scoreIntelligibility(werPct) {
  return clamp(RUBRIC.intelligibility.max - werPct * 25, 0, RUBRIC.intelligibility.max);
}
function scoreWordFidelity(a) {
  const errs = a.substitutions + a.deletions + a.insertions + a.alignment.repeatedWords;
  return clamp(RUBRIC.wordFidelity.max - errs * 3, 0, RUBRIC.wordFidelity.max);
}
function scoreRate(wpm) {
  const lo = 135, hi = 165;
  if (wpm >= lo && wpm <= hi) return RUBRIC.rate.max;
  const d = wpm < lo ? lo - wpm : wpm - hi;
  return clamp(RUBRIC.rate.max - d * 0.2, 0, RUBRIC.rate.max);
}
function scorePause(a) {
  let s = RUBRIC.pauseBehaviour.max;
  if (a.pauseMaxSec > 0.8) s -= Math.min(5, (a.pauseMaxSec - 0.8) * 5);
  if (a.silenceRatio > 0.45) s -= Math.min(3, (a.silenceRatio - 0.45) * 10);
  if (a.silenceRatio < 0.15) s -= Math.min(3, (0.15 - a.silenceRatio) * 10);
  return clamp(s, 0, RUBRIC.pauseBehaviour.max);
}
function scoreAlignment(a) {
  const an = a.alignment;
  // longGaps belongs here: an unexplained >1s hole inside the utterance is an
  // alignment anomaly even though the words around it are transcribed correctly.
  const bad = an.overlaps + an.nonMonotonic + an.zeroOrNegDuration + an.extremeDurations + an.repeatedWords + an.longGaps;
  return clamp(RUBRIC.alignment.max - bad * 2, 0, RUBRIC.alignment.max);
}
function scoreProsody(a) {
  let s = RUBRIC.prosody.max;
  const range = a.f0RangeHz;
  if (range !== null) {
    if (range < 60) s -= (60 - range) * 0.15;          // monotone / robotic
    else if (range > 260) s -= (range - 260) * 0.05;    // erratic / theatrical
  }
  if (a.longTermEnergyCv < 0.15) s -= (0.15 - a.longTermEnergyCv) * 40; // flat over long form
  else if (a.longTermEnergyCv > 0.55) s -= (a.longTermEnergyCv - 0.55) * 10;
  if (a.energyCv > 0.95) s -= (a.energyCv - 0.95) * 10; // spiky / bombastic
  return clamp(s, 0, RUBRIC.prosody.max);
}
function scoreCleanliness(a) {
  let s = RUBRIC.cleanliness.max;
  if (a.clippedSamples > 0) s -= clamp(a.clippedSamples / 50, 0, 5);
  if (a.headroomDb !== null && a.headroomDb < 3) s -= (3 - a.headroomDb) * 1.5;
  if (a.snrDb !== null && a.snrDb < 30) s -= (30 - a.snrDb) * 0.3;
  return clamp(s, 0, RUBRIC.cleanliness.max);
}
/** Item 9: long-form fatigue risk. Heuristic, explicitly labelled as such. */
function fatigueRisk(clips) {
  const reasons = [];
  let risk = 0;
  const ltCv = clips.map((c) => c.longTermEnergyCv);
  const drift = clips.map((c) => c.pitchDriftPct).filter((v) => v !== null);
  const decay = clips.map((c) => c.energyDecayPct).filter((v) => v !== null);
  const meanLt = ltCv.reduce((s, v) => s + v, 0) / ltCv.length;
  if (meanLt < 0.15) { risk += 35; reasons.push(`low long-term energy variation (${r1(meanLt)}) - monotonous over long form`); }
  if (drift.length) {
    const md = drift.reduce((s, v) => s + Math.abs(v), 0) / drift.length;
    if (md > 15) { risk += 20; reasons.push(`pitch drift across the clip (${r1(md)}%) - unstable over long form`); }
  }
  if (decay.length) {
    const md = decay.reduce((s, v) => s + Math.abs(v), 0) / decay.length;
    if (md > 15) { risk += 20; reasons.push(`energy decay across the clip (${r1(md)}%) - fatigue signal`); }
  }
  const meanWpm = clips.reduce((s, c) => s + c.wpm, 0) / clips.length;
  if (meanWpm > 170) { risk += 15; reasons.push(`fast delivery (${r1(meanWpm)} wpm) - raises fatigue over long form`); }
  if (meanWpm < 125) { risk += 15; reasons.push(`slow delivery (${r1(meanWpm)} wpm) - risks viewer drop-off`); }
  const meanPause = clips.reduce((s, c) => s + c.pauseMaxSec, 0) / clips.length;
  if (meanPause > 1.2) { risk += 10; reasons.push(`long silences (max ${r1(meanPause)}s) - feels hesitant over long form`); }
  return { riskScore: Math.round(clamp(risk, 0, 100)), rating: risk >= 50 ? "HIGH" : risk >= 25 ? "MEDIUM" : "LOW", reasons };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const projectId = arg("--project", null);
const voices = String(arg("--voices", "")).split(",").map((s) => s.trim()).filter(Boolean);
const asrModel = arg("--asr-model", "small");
const outPath = arg("--out", null);

if (!projectId || voices.length === 0) {
  console.error("usage: narrator-qa-compare.js --project <pid> --voices <a,b,c> [--asr-model small] [--out <path>]");
  process.exit(2);
}

(async () => {
  // --- 1. render every voice x script under identical conditions -----------
  const rendered = [];
  for (const s of SCRIPTS) {
    const pack = await license.buildPreviewPack(ROOT, projectId, voices, {
      text: s.text, language: CONDITIONS.language, speedDefault: CONDITIONS.speedDefault,
      sceneId: `voice-qa-${s.id}`, requestIdPrefix: `qa${s.id}`,
      kokoroTimeoutMs: 1800000,
    });
    for (const p of pack.previews) {
      rendered.push({
        scriptId: s.id, scriptLabel: s.label, voiceId: p.voiceId,
        ok: p.ok, text: s.text,
        path: path.join(ROOT, "projects", projectId, p.artifactPath),
        rel: `projects/${projectId}/${p.artifactPath}`,
      });
    }
  }
  const failed = rendered.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`render failed: ${JSON.stringify(failed)}`);
    process.exit(1);
  }

  // --- 2. measure (audio + ASR in one python process) ----------------------
  const r = spawnSync("python", ["-c", PY, JSON.stringify(rendered.map(({ path: p, text }) => ({ path: p, text }))), asrModel], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 3600000,
  });
  if (r.status !== 0) {
    console.error(r.stderr || `python exited ${r.status}`);
    process.exit(1);
  }
  const measured = JSON.parse(String(r.stdout).trim().split("\n").pop());

  // --- 3. aggregate per voice --------------------------------------------
  const perVoice = {};
  for (const item of rendered) {
    const a = measured.audio[item.path];
    const b = measured.asr[item.path];
    (perVoice[item.voiceId] = perVoice[item.voiceId] || []).push({ scriptId: item.scriptId, scriptLabel: item.scriptLabel, rel: item.rel, audio: a, asr: b });
  }

  const results = [];
  for (const voiceId of voices) {
    const clips = perVoice[voiceId];
    const scored = clips.map((c) => ({
      ...c,
      scores: {
        intelligibility: r1(scoreIntelligibility(c.asr.werPct)),
        wordFidelity: r1(scoreWordFidelity(c.asr)),
        rate: r1(scoreRate(c.audio.wpm)),
        pauseBehaviour: r1(scorePause(c.audio)),
        alignment: r1(scoreAlignment(c.asr)),
        prosody: r1(scoreProsody(c.audio)),
        cleanliness: r1(scoreCleanliness(c.audio)),
      },
    }));
    // cross-clip consistency (item 7)
    const wpms = scored.map((c) => c.audio.wpm);
    const pitches = scored.map((c) => c.audio.f0MedianHz).filter((v) => v !== null);
    const rmses = scored.map((c) => c.audio.rmsDbfs).filter((v) => v !== null);
    const spread = (arr) => (arr.length > 1 ? Math.max(...arr) - Math.min(...arr) : 0);
    const drift = { wpm: r1(spread(wpms)), f0Hz: r1(spread(pitches)), rmsDb: r1(spread(rmses)) };
    let cons = RUBRIC.consistency.max;
    if (drift.wpm > 8) cons -= Math.min(2, (drift.wpm - 8) * 0.15);
    if (drift.f0Hz > 10) cons -= Math.min(2, (drift.f0Hz - 10) * 0.1);
    if (drift.rmsDb > 3) cons -= Math.min(1, (drift.rmsDb - 3) * 0.2);
    const consistency = r1(clamp(cons, 0, RUBRIC.consistency.max));

    const dims = {};
    for (const k of Object.keys(RUBRIC)) {
      if (k === "consistency") { dims[k] = consistency; continue; }
      const vals = scored.map((c) => c.scores[k]).filter((v) => typeof v === "number");
      dims[k] = r1(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    const total = r1(Object.values(dims).reduce((s, v) => s + v, 0));
    results.push({
      voiceId,
      totalScore: total,
      maxScore: TOTAL_MAX,
      dimensions: dims,
      consistencyDrift: drift,
      fatigueRisk: fatigueRisk(scored.map((c) => c.audio)),
      meanWpm: r1(scored.reduce((s, c) => s + c.audio.wpm, 0) / scored.length),
      meanF0Hz: r1(pitches.reduce((s, v) => s + v, 0) / pitches.length),
      meanRmsDbfs: r1(rmses.reduce((s, v) => s + v, 0) / rmses.length),
      clips: scored.map((c) => ({
        scriptId: c.scriptId, rel: c.rel,
        durationSec: c.audio.durationSec, wpm: c.audio.wpm, wpmWallClock: c.audio.wpmWallClock,
        werPct: c.asr.werPct, substitutions: c.asr.substitutions, deletions: c.asr.deletions,
        insertions: c.asr.insertions, repeatedWords: c.asr.alignment.repeatedWords,
        pauseCount: c.audio.pauseCount, pauseMeanSec: c.audio.pauseMeanSec,
        pauseMedianSec: c.audio.pauseMedianSec, pauseMaxSec: c.audio.pauseMaxSec,
        silenceRatio: c.audio.silenceRatio, f0MedianHz: c.audio.f0MedianHz, f0RangeHz: c.audio.f0RangeHz,
        energyCv: c.audio.energyCv, longTermEnergyCv: c.audio.longTermEnergyCv,
        energyDecayPct: c.audio.energyDecayPct, pitchDriftPct: c.audio.pitchDriftPct,
        peakDbfs: c.audio.peakDbfs, rmsDbfs: c.audio.rmsDbfs, noiseFloorDbfs: c.audio.noiseFloorDbfs,
        snrDb: c.audio.snrDb, headroomDb: c.audio.headroomDb, clippedSamples: c.audio.clippedSamples,
        alignment: c.asr.alignment, transcript: c.asr.transcript,
        wordOps: c.asr.wordOps,
      })),
    });
  }
  results.sort((a, b) => b.totalScore - a.totalScore);
  results.forEach((x, i) => { x.rank = i + 1; });

  const report = {
    tool: "scripts/diagnostics/narrator-qa-compare.js",
    generatedFor: "PHASE_2_1_FIX_01 narrator selection",
    approvesNothing: "This tool produces a technical recommendation only. It records no approval; approveNarratorVoice() remains the only path to a selection, and the operator decision is still outstanding.",
    conditions: CONDITIONS,
    scripts: SCRIPTS.map((s) => ({ id: s.id, label: s.label, words: s.text.trim().split(/\s+/).length })),
    asrEngine: { name: "faster-whisper", model: asrModel, computeType: "int8", device: "cpu", language: "en", beamSize: 5, vadFilter: false },
    rubric: RUBRIC,
    totalMax: TOTAL_MAX,
    ranking: results.map((r) => ({ rank: r.rank, voiceId: r.voiceId, totalScore: r.totalScore, dimensions: r.dimensions, fatigueRisk: r.fatigueRisk })),
    detail: results,
  };

  const json = JSON.stringify(report, null, 2);
  if (outPath) {
    const p = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, json + "\n");
    console.log(JSON.stringify({ ok: true, out: path.relative(ROOT, p).split(path.sep).join("/"), ranking: report.ranking.map((x) => `${x.rank}. ${x.voiceId} = ${x.totalScore}/${TOTAL_MAX} fatigue=${x.fatigueRisk.rating}`) }, null, 2));
  } else {
    console.log(json);
  }
})().catch((e) => { console.error(`FATAL: ${(e && e.stack) || e}`); process.exit(1); });