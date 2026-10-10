"use strict";

/**
 * Full Multimodal Watch of a final video via the Gemini API (AI Studio free tier).
 *
 * Usage:
 *   node scripts/diagnostics/gemini-video-watch.js --video <mp4> --project <dir> --out <json>              (one whole-video pass)
 *   node scripts/diagnostics/gemini-video-watch.js --video <mp4> --project <dir> --out <json> --segments   (one pass per scene)
 * Secrets: GEMINI_API_KEY from the repo-root .env / shell only; never logged or written.
 * Safety: ONE upload, one generateContent per pass, NO retries; any non-2xx stops the run.
 * The uploaded file is deleted afterwards. Free-tier status cannot be verified by API: the
 * operator attests it (recorded as OWNER_ATTESTED). In --segments mode the model's transcript and
 * caption timestamps are re-checked locally against script.json / captions.json (never trusted blindly).
 */

const fs = require("fs");
const path = require("path");
const { loadRootEnv } = require("../../lib/env-bootstrap.js");

const BASE = "https://generativelanguage.googleapis.com";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

async function call(url, init, label) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${label} failed: HTTP ${res.status} ${text.slice(0, 400)}`);
    err.status = res.status;
    throw err;
  }
  return { res, text };
}

async function uploadVideo(headers, bytes) {
  const start = await call(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: { ...headers, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": "video/mp4", "Content-Type": "application/json" },
    body: JSON.stringify({ file: { display_name: "unfoldiq-final-watch" } }),
  }, "upload-start");
  const uploadUrl = start.res.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("upload-start: no upload URL returned");
  const up = await call(uploadUrl, { method: "POST", headers: { "Content-Length": String(bytes.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes }, "upload-finalize");
  const file = JSON.parse(up.text).file;
  let state = file.state;
  for (let i = 0; i < 40 && state !== "ACTIVE"; i++) {
    if (state === "FAILED") throw new Error("file processing FAILED");
    await new Promise((r) => setTimeout(r, 3000));
    state = JSON.parse((await call(`${BASE}/v1beta/${file.name}`, { headers }, "file-poll")).text).state;
  }
  if (state !== "ACTIVE") throw new Error(`file not ACTIVE (state=${state})`);
  return file;
}

async function generate(model, headers, file, prompt, range) {
  const part = { file_data: { mime_type: "video/mp4", file_uri: file.uri } };
  if (range) part.video_metadata = { start_offset: `${range.startS}s`, end_offset: `${range.endS}s` };
  const gen = await call(`${BASE}/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [part, { text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
  }, "generateContent");
  const result = JSON.parse(gen.text);
  const text = result.candidates && result.candidates[0] && result.candidates[0].content.parts.map((p) => p.text || "").join("");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* keep raw */ }
  return { parsed, rawText: parsed ? undefined : text, usage: result.usageMetadata || null };
}

function wholePrompt(project) {
  const script = readJson(path.join(project, "script.json"));
  const pkg = readJson(path.join(project, "packaging", "final-publish-package.json"));
  const narration = script.beats.map((b) => `${b.beatId}: ${b.text}`).join("\n");
  return `You are a strict QA reviewer watching a finished ~57 s explainer video (audio AND picture). Judge only what you actually see and hear; cite timestamps (mm:ss). Do not invent problems or praise.

Approved narration script:
${narration}

Packaging promise: title "${pkg.selectedTitle}"; the thumbnail shows the sunset long-path diagram.
Burned-in captions are expected and should match the spoken words.

Return ONLY JSON with this shape:
{"overall":"PASS|REVIEW|FAIL",
"checks":{
 "audio_quality":{"verdict":"PASS|REVIEW|FAIL","evidence":"..."},
 "narration_matches_script":{"verdict":"...","evidence":"... list any deviation"},
 "caption_accuracy_and_sync":{"verdict":"...","evidence":"..."},
 "visual_clarity_and_scientific_accuracy":{"verdict":"...","evidence":"..."},
 "audio_visual_sync_and_rhythm":{"verdict":"...","evidence":"..."},
 "audio_visual_energy_match":{"verdict":"...","evidence":"..."},
 "flash_or_strobe_risk":{"verdict":"...","evidence":"..."},
 "text_legibility_and_safe_zone":{"verdict":"...","evidence":"..."},
 "music_sfx":{"verdict":"...","evidence":"... say if none is present"},
 "packaging_promise_delivered":{"verdict":"...","evidence":"... does the video deliver the title?"}},
"findings":[{"timestamp":"mm:ss","severity":"P1|P2|P3","issue":"..."}]}`;
}

function segmentPrompt(scene, expected, cues) {
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return `You are a strict QA reviewer. The clip you are given is scene ${scene.sceneId}, which covers ${mmss(scene.startS)}-${mmss(scene.endS)} of a longer video (timestamps below are absolute video time). Listen and look carefully; report only what you actually perceive. Be specific; vague praise is useless.

Expected narration for this scene: "${expected}"

Return ONLY JSON:
{"scene":"${scene.sceneId}",
"heard_transcript":"word-for-word what the voice says in this clip",
"captions_seen":[{"first_visible_s":0.0,"text":"exact burned-in caption text you read on screen"}],
"caption_vs_speech_sync":{"verdict":"PASS|REVIEW|FAIL","estimated_max_offset_s":0.0,"notes":"..."},
"visual":{"description":"what is drawn and how it moves, in 2-3 sentences","scientifically_accurate":true,"notes":"..."},
"audio":{"clean":true,"notes":"voice quality, noise, clipping, background sound"},
"flash_or_strobe":{"present":false,"notes":"..."},
"text_legibility":{"verdict":"PASS|REVIEW|FAIL","notes":"labels and captions: size, contrast, overlap, cut-off"},
"issues":[{"timestamp_s":0.0,"severity":"P1|P2|P3","issue":"..."}]}`;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Number((prev[h.length] / Math.max(1, r.length)).toFixed(3));
}

async function segmentsRun(model, headers, file, project) {
  const script = readJson(path.join(project, "script.json"));
  const spec = readJson(path.join(project, "video-spec.json"));
  const caps = readJson(path.join(project, "captions", "captions.json")).items;
  const beatText = Object.fromEntries(script.beats.map((b) => [b.beatId, b.text]));
  const audio = readJson(path.join(project, "audio-manifest.json")).tracks;
  const out = [];
  for (const sc of spec.scenes) {
    const scene = { sceneId: sc.sceneId, startS: sc.timing.startMs / 1000, endS: sc.timing.endMs / 1000 };
    const expected = audio.filter((t) => t.sceneId === sc.sceneId).map((t) => beatText[t.audioId.replace("VO_", "")]).join(" ");
    const cues = caps.filter((c) => c.startMs >= sc.timing.startMs && c.endMs <= sc.timing.endMs);
    const r = await generate(model, headers, file, segmentPrompt(scene, expected, cues), scene);
    // Local re-check: transcript WER vs script, and caption first-visible time vs the real cue start.
    const heard = r.parsed && r.parsed.heard_transcript;
    const seen = (r.parsed && r.parsed.captions_seen) || [];
    const capOffsets = cues.map((c) => {
      const m = seen.find((s) => norm(s.text).join(" ") === norm(c.text).join(" "));
      return m ? Number((m.first_visible_s - c.startMs / 1000).toFixed(2)) : null;
    });
    out.push({ ...scene, expected, localCheck: { transcriptWer: heard ? wer(expected, heard) : null, captionCuesExpected: cues.length, captionCuesMatchedExactly: capOffsets.filter((x) => x !== null).length, captionStartOffsetsS: capOffsets }, model: r.parsed, rawText: r.rawText, usage: r.usage });
  }
  return out;
}

async function main() {
  const video = arg("video");
  const project = arg("project");
  const outPath = arg("out");
  const segments = process.argv.includes("--segments");
  if (!video || !project || !outPath) throw new Error("usage: --video <mp4> --project <dir> --out <json> [--segments]");
  loadRootEnv();
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (checked env + root .env)");
  const pick = arg("llm") === "fast" ? process.env.FAST_LLM : process.env.SMART_LLM; // --llm fast = lighter model from .env
  const smart = pick || "";
  const model = smart.includes(":") ? smart.split(":")[1] : smart;
  if (!model) throw new Error("SMART_LLM not set; refusing to guess a model");

  const bytes = fs.readFileSync(video);
  const t0 = Date.now();
  const headers = { "x-goog-api-key": key };
  const file = await uploadVideo(headers, bytes);
  let body;
  let calls = 0;
  try {
    if (segments) {
      body = { mode: "PER_SCENE", scenes: await segmentsRun(model, headers, file, project) };
      calls = body.scenes.length;
    } else {
      const r = await generate(model, headers, file, wholePrompt(project), null);
      body = { mode: "WHOLE_VIDEO", verdict: r.parsed, rawText: r.rawText, usage: r.usage };
      calls = 1;
    }
  } finally {
    await fetch(`${BASE}/v1beta/${file.name}`, { method: "DELETE", headers }).catch(() => {});
  }
  const evidence = { generatedAt: new Date().toISOString(), provider: "gemini-api (AI Studio)", model, freeTier: "OWNER_ATTESTED (not verifiable via API)", calls: { upload: 1, generateContent: calls, retries: 0 }, latencyMs: Date.now() - t0, video: path.basename(video), videoSizeBytes: bytes.length, ...body };
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: true, model, mode: body.mode, calls, latencyMs: evidence.latencyMs }));
}

main().catch((e) => { console.error("WATCH_FAILED:", String(e.message).replace(/key=[^&\s"]+/gi, "key=***")); process.exit(1); });
