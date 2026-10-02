"use strict";

/**
 * local-whisper STT adapter (STEP-10C Branch B).
 * Local whisper.cpp transcription. Measured timing only — never fabricated.
 * Model file must exist; never auto-downloaded.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { permanent, unavailable } = require("../errors");
const { registerProvider } = require("../registry");

const providerId = "local-whisper";

const ALLOWED_EXTS = [".wav", ".mp3", ".m4a", ".ogg", ".flac", ".mp4", ".mov", ".mkv"];

function defaultModelPath(root) {
  if (process.env.WHISPER_CPP_MODEL) return path.resolve(process.env.WHISPER_CPP_MODEL);
  return path.join(store.projectRootPath(root), "providers", "local", "whisper", "models", "ggml-base.bin");
}

function resolveBinary(ctx) {
  if (ctx && ctx.whisperTransport && typeof ctx.whisperTransport.transcribe === "function") return { mock: true };
  if (process.env.WHISPER_CPP_BIN) return { bin: process.env.WHISPER_CPP_BIN };
  for (const candidate of ["whisper-cli", "whisper-cpp", "main"]) {
    try {
      const probe = process.platform === "win32"
        ? spawnSync("where", [candidate], { encoding: "utf8", timeout: 5000 })
        : spawnSync("which", [candidate], { encoding: "utf8", timeout: 5000 });
      if (probe.status === 0 && String(probe.stdout || "").trim()) {
        return { bin: String(probe.stdout).trim().split(/\r?\n/)[0] };
      }
    } catch {
      // try next candidate
    }
  }
  return { missing: true };
}

function validateSegments(segments) {
  if (!Array.isArray(segments)) throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Transcript segments must be an array");
  for (const s of segments) {
    if (!s || typeof s !== "object") throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Invalid transcript segment");
    if (typeof s.startMs !== "number" || typeof s.endMs !== "number" || !Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) {
      throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Segment timing must be finite numbers");
    }
    if (s.startMs < 0 || !(s.startMs < s.endMs)) {
      throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Segment timing invalid: require 0 <= startMs < endMs");
    }
    if (typeof s.text !== "string" || !s.text.trim()) {
      throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Segment text must be nonempty");
    }
  }
}

async function execute(request, ctx = {}) {
  if (request.capability !== "stt") {
    throw permanent("WHISPER_CAPABILITY_UNSUPPORTED", `local-whisper supports stt, got ${request.capability}`);
  }
  const root = ctx.projectRoot || path.join(__dirname, "..", "..", "..");
  const input = request.input || {};

  const rel = input.audioPath || input.videoPath || input.existingArtifactPath;
  if (!rel || typeof rel !== "string") {
    throw permanent("WHISPER_INPUT_MISSING", "STT input audio/video path is required");
  }
  if (!store.artifactExists(root, request.projectId, rel)) {
    throw permanent("WHISPER_INPUT_MISSING", `STT input not found: ${rel}`);
  }
  const ext = path.extname(rel).toLowerCase();
  if (!ALLOWED_EXTS.includes(ext)) {
    throw permanent("WHISPER_UNSUPPORTED_INPUT", `Unsupported STT input extension ${ext}`);
  }

  const language = String(input.language || "auto").trim().toLowerCase() || "auto";

  const modelPath = (ctx && ctx.whisperModelPath) || defaultModelPath(root);
  const binInfo = resolveBinary(ctx);
  const isMock = binInfo.mock === true;

  if (!isMock) {
    if (binInfo.missing || !binInfo.bin) {
      throw unavailable("WHISPER_NOT_AVAILABLE", "whisper.cpp binary not found (set WHISPER_CPP_BIN or install whisper-cli)");
    }
    const fs = require("fs");
    if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isFile()) {
      throw unavailable("MODEL_MISSING", `Whisper model missing at ${modelPath}; download it manually, never auto-downloaded`);
    }
  }

  const { abs: audioAbsPath } = store.resolveProjectPath(root, request.projectId, rel);

  let text = "";
  let segments = [];
  let model = path.basename(modelPath);

  if (isMock) {
    const res = await ctx.whisperTransport.transcribe({ audioAbsPath, language, modelPath });
    text = String((res && res.text) || "");
    segments = Array.isArray(res && res.segments) ? res.segments : [];
    if (res && res.model) model = res.model;
  } else {
    let timeoutMs = 120000;
    try {
      const policy = require("../timeout-policy");
      if (policy && typeof policy.timeoutFor === "function") timeoutMs = policy.timeoutFor("stt", timeoutMs);
      else if (typeof policy.STT_TIMEOUT_MS === "number") timeoutMs = policy.STT_TIMEOUT_MS;
    } catch {
      // timeout-policy optional
    }
    let cli;
    try {
      cli = spawnSync(binInfo.bin, ["-m", modelPath, "-f", audioAbsPath, "-l", language, "--output-json"], {
        encoding: "utf8",
        timeout: timeoutMs,
      });
    } catch (e) {
      throw unavailable("WHISPER_NOT_AVAILABLE", `Whisper CLI failed to launch: ${e.message}`);
    }
    if (cli.error) throw unavailable("WHISPER_NOT_AVAILABLE", `Whisper CLI error: ${cli.error.message}`);
    if (cli.status !== 0) throw unavailable("WHISPER_NOT_AVAILABLE", `Whisper CLI exited with status ${cli.status}`);
    try {
      const parsed = JSON.parse(String(cli.stdout || "{}"));
      text = String(parsed.text || "");
      segments = Array.isArray(parsed.segments) ? parsed.segments : [];
    } catch {
      throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Whisper CLI returned unparseable output");
    }
  }

  validateSegments(segments);
  if (segments.length === 0 && !String(text).trim()) {
    throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Whisper returned an empty transcript");
  }
  if (segments.length === 0) {
    text = String(text || "").trim();
    if (!text) throw permanent("WHISPER_EMPTY_TRANSCRIPT", "Whisper returned an empty transcript");
  }

  const timingSource = segments.length > 0 ? "measured" : "none";
  const sceneSafe = store.sanitizeFilename(request.sceneId);
  const reqSafe = store.sanitizeFilename(request.requestId);
  const timingRel = `timing/${sceneSafe}/${reqSafe}.json`;
  const transcriptRel = `timing/${sceneSafe}/${reqSafe}.txt`;

  const timingDoc = {
    version: "1.0.0",
    requestId: request.requestId,
    sceneId: request.sceneId,
    model,
    language,
    timingSource,
    segments,
    generatedAt: new Date().toISOString(),
  };
  store.writeArtifactAtomic(root, request.projectId, timingRel, JSON.stringify(timingDoc, null, 2));
  store.writeArtifactAtomic(root, request.projectId, transcriptRel, String(text));
  store.recordFingerprint(root, request.projectId, timingRel, fingerprintRequest(request));

  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: "stt",
    providerId,
    status: "READY",
    artifactPath: timingRel,
    sourceType: "generated",
    provenanceNote: `Local whisper.cpp transcription model ${model}; transcript at ${transcriptRel}`,
    transcriptPath: transcriptRel,
    generationDate: new Date().toISOString(),
    rightsStatus: "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
    metadata: { model, language, segmentCount: segments.length, timingSource, mock: isMock },
    continuity: null,
  };
}

function registerLocalWhisper() {
  const { getProvider } = require("../registry");
  if (getProvider(providerId)) return providerId;
  registerProvider({
    providerId,
    capabilities: ["stt"],
    costClass: "ZERO_LOCAL",
    adapter: { execute },
  });
  return providerId;
}

module.exports = { execute, providerId, registerLocalWhisper };
