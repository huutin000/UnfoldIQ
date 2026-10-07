"use strict";

/**
 * local-kokoro TTS adapter (STEP-10C Branch B).
 * Local Kokoro TTS. No voice-cloning claims. No fallback to a wrong voice.
 * Unsupported language (incl. Vietnamese) → NOT_AVAILABLE, never synthesized
 * with an English voice.
 */

const fs = require("fs");
const os = require("os");
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

/**
 * `python -m kokoro` accepts ONLY single-letter lang codes
 * (`choices=["a","b","h","e","f","i","p","j","z"]`), not `en-us`. Passing a
 * BCP-47 code makes argparse exit 2, which the adapter used to read as "CLI
 * unavailable". Mirrors LANGUAGE_NAMES 1:1.
 */
const LANGUAGE_CODES = {
  "en-us": "a",
  "en-gb": "b",
  hi: "h",
  es: "e",
  fr: "f",
  it: "i",
  "pt-br": "p",
  ja: "j",
  zh: "z",
};

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

/**
 * Real synthesis. `python -m kokoro` REQUIRES `-o/--output-file` (it writes a
 * WAV file, never WAV bytes on stdout), so the call must go through a temp
 * file. The default timeout is generous because the first call downloads the
 * model + voice + spaCy model; every later call is cache-warm.
 */
function tryRealCli(text, language, voice, speed, timeoutMs) {
  const langCode = LANGUAGE_CODES[String(language).toLowerCase()];
  if (!langCode) return { unavailable: true, reason: `no kokoro lang code for ${language}` };
  const tmp = path.join(os.tmpdir(), `unfoldiq-kokoro-${process.pid}-${Date.now()}.wav`);
  try {
    const span = spawnSync("python", ["-m", "kokoro", "--text", text, "--lang", langCode, "--voice", voice, "--speed", String(speed), "--output-file", tmp], {
      encoding: "buffer",
      timeout: timeoutMs || 300000,
    });
    if (span.error) return { unavailable: true, reason: String(span.error.message || span.error) };
    if (span.status !== 0) return { unavailable: true, reason: `kokoro CLI exited ${span.status}` };
    if (!fs.existsSync(tmp)) return { unavailable: true, reason: "kokoro CLI wrote no output file" };
    const bytes = fs.readFileSync(tmp);
    return { bytes: bytes.length > 0 ? bytes : null };
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* temp cleanup is best effort */ }
  }
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
      cli = tryRealCli(text, language, voice, speed, ctx.kokoroTimeoutMs);
    } catch {
      cli = { unavailable: true };
    }
    if (cli.unavailable || !cli.bytes) {
      throw unavailable("KOKORO_NOT_AVAILABLE", "Kokoro CLI (python -m kokoro) not available in this environment");
    }
    bytes = Buffer.from(cli.bytes);
    // FIX 02 (P3-5): corrupt non-RIFF output is refused, never replaced with
    // silent audio served as READY. A broken render fails loudly here instead
    // of passing downstream checks as silence.
    if (format === "wav" && bytes.length >= 4 && bytes.slice(0, 4).toString() !== "RIFF") {
      throw permanent("KOKORO_EMPTY_OUTPUT", "Kokoro produced corrupt (non-RIFF) wav output");
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

/**
 * FIX 01 Gap C — resolve the exact local Kokoro-82M weight file the
 * `python -m kokoro` CLI loads (HuggingFace hub snapshot). Returns the newest
 * snapshot's kokoro-v1_0.pth when several exist. No download, no mutation.
 */
function resolveLocalModelFile() {
  const candidates = [];
  const hubBase = process.env.HUGGINGFACE_HUB_CACHE
    || (process.env.HF_HOME ? path.join(process.env.HF_HOME, "hub") : null)
    || path.join(os.homedir(), ".cache", "huggingface", "hub");
  const snapDir = path.join(hubBase, "models--hexgrad--Kokoro-82M", "snapshots");
  try {
    for (const snap of fs.readdirSync(snapDir)) {
      const p = path.join(snapDir, snap, "kokoro-v1_0.pth");
      try {
        const st = fs.statSync(p);
        if (st.isFile()) candidates.push({ modelFile: p, snapshot: snap, sizeBytes: st.size, mtimeMs: st.mtimeMs });
      } catch { /* not present in this snapshot */ }
    }
  } catch {
    return { ok: false, code: "MODEL_FILE_NOT_FOUND", message: `no Kokoro-82M snapshot under ${snapDir}` };
  }
  if (candidates.length === 0) {
    return { ok: false, code: "MODEL_FILE_NOT_FOUND", message: `kokoro-v1_0.pth not found under ${snapDir}` };
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, ...candidates[0], modelRepo: "hexgrad/Kokoro-82M" };
}

function sha256File(modelFile) {
  const crypto = require("crypto");
  const stream = fs.readFileSync(modelFile);
  return crypto.createHash("sha256").update(stream).digest("hex");
}

/**
 * FIX 01 Gap C — hash the loaded local file and compare to the official
 * upstream hash. Never copies an upstream hash into metadata: the local bytes
 * are always hashed. Mismatch fails closed (MODEL_HASH_MISMATCH).
 */
function verifyLocalModel(expectedSha256) {
  const resolved = resolveLocalModelFile();
  if (!resolved.ok) return resolved;
  const localSha256 = sha256File(resolved.modelFile);
  if (localSha256 !== expectedSha256) {
    return { ok: false, code: "MODEL_HASH_MISMATCH", message: `local ${resolved.modelFile} sha256 ${localSha256} != expected ${expectedSha256}`, modelFile: resolved.modelFile, localSha256, expectedSha256 };
  }
  return { ok: true, match: true, modelFile: resolved.modelFile, snapshot: resolved.snapshot, sizeBytes: resolved.sizeBytes, localSha256, expectedSha256, modelRepo: resolved.modelRepo };
}

module.exports = {
  execute,
  providerId,
  registerLocalKokoro,
  resolveLocalModelFile,
  sha256File,
  verifyLocalModel,
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
  LANGUAGE_CODES,
  DEFAULT_VOICES,
  KOKORO_MODEL,
  KOKORO_VERSION,
  normalizeLanguage,
  isLanguageSupported,
  resolveVoice,
};
