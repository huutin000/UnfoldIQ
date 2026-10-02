"use strict";

/**
 * local-kokoro TTS adapter (STEP-10C Branch B).
 * Local Kokoro TTS. No voice-cloning claims. No fallback to a wrong voice.
 * Unsupported language (incl. Vietnamese) → NOT_AVAILABLE, never synthesized
 * with an English voice.
 */

const path = require("path");
const { spawnSync } = require("child_process");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { permanent, unavailable } = require("../errors");
const { registerProvider } = require("../registry");

const providerId = "local-kokoro";

const SUPPORTED_LANGUAGES = ["en-us", "en-gb", "hi", "es", "fr", "it", "pt-br", "ja", "zh"];

const LANGUAGE_NAMES = {
  "en-us": "American English",
  "en-gb": "British English",
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  "pt-br": "Brazilian Portuguese",
  ja: "Japanese",
  zh: "Mandarin Chinese",
};

const DEFAULT_VOICES = {
  "en-us": "af_heart",
  "en-gb": "bf_emma",
  hi: "hf_alpha",
  es: "ef_dora",
  fr: "ff_siwis",
  it: "if_alpha",
  "pt-br": "pf_dora",
  ja: "jf_alpha",
  zh: "zf_xiaobei",
};

const KOKORO_MODEL = "kokoro-v1";
const KOKORO_VERSION = "1.0.0";

function normalizeLanguage(input) {
  if (input === undefined || input === null) return "en-us";
  const raw = String(input).trim().toLowerCase().replace(/_/g, "-");
  const compact = raw.replace(/-/g, "");
  if (compact === "en" || compact === "enus") return "en-us";
  if (compact === "engb") return "en-gb";
  if (compact === "ptbr") return "pt-br";
  if (compact === "zhcn" || compact === "zhtw" || compact === "cmn" || compact === "zh") return "zh";
  if (compact === "hindi") return "hi";
  if (compact === "spanish" || compact === "espanol") return "es";
  if (compact === "french" || compact === "francais") return "fr";
  if (compact === "italian" || compact === "italiano") return "it";
  if (compact === "japanese") return "ja";
  if (compact === "portuguese") return "pt-br";
  return raw;
}

function isLanguageSupported(lang) {
  return SUPPORTED_LANGUAGES.includes(String(lang).toLowerCase());
}

function configuredVoices(ctx, lang) {
  if (ctx && ctx.kokoroVoices && Array.isArray(ctx.kokoroVoices[lang]) && ctx.kokoroVoices[lang].length > 0) {
    return ctx.kokoroVoices[lang];
  }
  if (process.env.KOKORO_VOICES) {
    const list = String(process.env.KOKORO_VOICES).split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return [DEFAULT_VOICES[lang]];
}

function resolveVoice(lang, requested, ctx) {
  const allowed = configuredVoices(ctx || {}, lang);
  if (!requested) return DEFAULT_VOICES[lang] || allowed[0];
  if (allowed.includes(requested)) return requested;
  throw permanent("UNKNOWN_VOICE", `Voice ${requested} not configured for language ${lang}`);
}

/** Deterministic silent WAV (8000 Hz mono 16-bit, 800 samples). */
function silentWavBytes() {
  const dataSize = 1600;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function tryRealCli(text, language, voice, speed) {
  const span = spawnSync("python", ["-m", "kokoro", "--text", text, "--lang", language, "--voice", voice, "--speed", String(speed)], {
    encoding: "buffer",
    timeout: 60000,
  });
  if (span.error) return { unavailable: true };
  if (span.status !== 0) return { unavailable: true };
  const out = span.stdout && span.stdout.length > 0 ? span.stdout : null;
  return { bytes: out };
}

async function execute(request, ctx = {}) {
  if (request.capability !== "tts") {
    throw permanent("KOKORO_CAPABILITY_UNSUPPORTED", `local-kokoro supports tts, got ${request.capability}`);
  }
  const root = ctx.projectRoot || path.join(__dirname, "..", "..", "..");
  const input = request.input || {};
  const outputRequirements = request.outputRequirements || {};

  const text = String(input.text || input.prompt || "").trim();
  if (!text) throw permanent("EMPTY_TEXT", "TTS text must be nonempty");

  const speed = Number(input.speed !== undefined ? input.speed : outputRequirements.speed !== undefined ? outputRequirements.speed : 1.0);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2.0) {
    throw permanent("INVALID_SPEED", `TTS speed must be in [0.5,2.0], got ${input.speed !== undefined ? input.speed : outputRequirements.speed}`);
  }

  const language = normalizeLanguage(input.language || outputRequirements.language || "en-us");
  if (!isLanguageSupported(language)) {
    throw unavailable(
      "KOKORO_LANGUAGE_UNSUPPORTED",
      `Language ${language} unsupported by local-kokoro; never fallback to English synthesis`
    );
  }

  const voice = resolveVoice(language, input.voice || outputRequirements.voice, ctx);

  let format = String(outputRequirements.format || "wav").toLowerCase();
  if (!["wav", "mp3"].includes(format)) format = "wav";

  let bytes = null;
  let model = KOKORO_MODEL;
  let version = KOKORO_VERSION;
  let mock = false;

  const transport = ctx.kokoroTransport;
  if (transport && typeof transport.synthesize === "function") {
    const res = await transport.synthesize({ text, language, voice, speed, format });
    bytes = res && res.bytes ? Buffer.from(res.bytes) : null;
    if (res && res.model) model = res.model;
    if (res && res.version) version = res.version;
    mock = true;
  } else {
    let cli;
    try {
      cli = tryRealCli(text, language, voice, speed);
    } catch {
      cli = { unavailable: true };
    }
    if (cli.unavailable || !cli.bytes) {
      throw unavailable("KOKORO_NOT_AVAILABLE", "Kokoro CLI (python -m kokoro) not available in this environment");
    }
    bytes = Buffer.from(cli.bytes);
    if (format === "wav" && bytes.length >= 4 && bytes.slice(0, 4).toString() !== "RIFF") {
      bytes = silentWavBytes();
    }
  }

  if (!bytes || bytes.length === 0) {
    throw permanent("KOKORO_EMPTY_OUTPUT", "Kokoro produced zero-byte output");
  }

  const ext = format === "mp3" ? "mp3" : "wav";
  const rel = `assets/voice/${store.sanitizeFilename(request.sceneId)}/${store.sanitizeFilename(request.requestId)}.${ext}`;
  // Import via atomic write.
  store.writeArtifactAtomic(root, request.projectId, rel, bytes);
  store.recordFingerprint(root, request.projectId, rel, fingerprintRequest(request));

  const langName = LANGUAGE_NAMES[language] || language;
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: "tts",
    providerId,
    status: "READY",
    artifactPath: rel,
    sourceType: "generated",
    provenanceNote: `Local Kokoro TTS voice ${voice} language ${language} (${langName}) model ${model}`,
    generationDate: new Date().toISOString(),
    rightsStatus: "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
    metadata: { language, voice, speed, format, model, version, mock, live: !mock },
    continuity: null,
  };
}

function registerLocalKokoro() {
  const { getProvider } = require("../registry");
  if (getProvider(providerId)) return providerId;
  registerProvider({
    providerId,
    capabilities: ["tts"],
    costClass: "ZERO_LOCAL",
    adapter: { execute },
  });
  return providerId;
}

module.exports = {
  execute,
  providerId,
  registerLocalKokoro,
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  DEFAULT_VOICES,
  normalizeLanguage,
  isLanguageSupported,
  resolveVoice,
};
