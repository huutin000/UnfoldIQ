"use strict";

/**
 * UNFOLDIQ media tool doctor (STEP-11 Branch A).
 * Inspection ONLY: never installs, downloads, renders, transcribes, or spends credits.
 * Usage: node scripts/diagnostics/media-tool-doctor.js [--json]
 * Exit code always 0.
 */

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const REMOTION_DIR = path.join(PROJECT_ROOT, "remotion");

function item(name, status, detail) {
  return { name, status, detail: detail === undefined || detail === null ? null : String(detail) };
}

function firstLine(text) {
  const line = String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return line || null;
}

function spawnFirstLine(cmd, args) {
  try {
    const out = child_process.spawnSync(cmd, args, { timeout: 8000, encoding: "utf8", windowsHide: true });
    if (!out || out.status !== 0) return null;
    return firstLine(out.stdout);
  } catch {
    return null;
  }
}

function commandOnPath(cmd) {
  try {
    const probe = process.platform === "win32" ? ["where", [cmd]] : ["sh", ["-c", `command -v ${cmd}`]];
    const out = child_process.spawnSync(probe[0], probe[1], { timeout: 5000, encoding: "utf8", windowsHide: true });
    if (!out || out.status !== 0) return null;
    const lines = String(out.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      try {
        if (fs.existsSync(line) && fs.statSync(line).isFile()) return line;
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function resolveRemotionPackage(spec) {
  try {
    const resolved = require.resolve(spec, { paths: [REMOTION_DIR] });
    let dir = path.dirname(resolved);
    for (let i = 0; i < 5; i += 1) {
      const pkgFile = path.join(dir, "package.json");
      if (fs.existsSync(pkgFile)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
          if (pkg && pkg.name === spec) return { resolved, version: pkg.version || null };
        } catch {
          return { resolved, version: null };
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return { resolved, version: null };
  } catch {
    return null;
  }
}

function checkTools() {
  const items = [];
  const ffmpegLine = spawnFirstLine("ffmpeg", ["-version"]);
  items.push(item("ffmpeg", ffmpegLine ? "AVAILABLE" : "NOT_AVAILABLE", ffmpegLine || "ffmpeg -version failed or not on PATH"));
  const ffprobeLine = spawnFirstLine("ffprobe", ["-version"]);
  items.push(item("ffprobe", ffprobeLine ? "AVAILABLE" : "NOT_AVAILABLE", ffprobeLine || "ffprobe -version failed or not on PATH"));
  return { section: "media-tools", items, meta: { ffmpeg: ffmpegLine, ffprobe: ffprobeLine } };
}

function checkRemotion() {
  const items = [];
  let coreVersion = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REMOTION_DIR, "package.json"), "utf8"));
    coreVersion = (pkg.dependencies && (pkg.dependencies.remotion || pkg.dependencies["@remotion/cli"])) || pkg.version || null;
  } catch {
    coreVersion = null;
  }
  items.push(item("remotion.core", coreVersion ? "AVAILABLE" : "UNKNOWN", coreVersion ? `remotion ${coreVersion} (from remotion/package.json)` : "remotion/package.json unreadable"));
  const captions = resolveRemotionPackage("@remotion/captions");
  items.push(item("remotion.captions", captions ? "AVAILABLE" : "NOT_AVAILABLE", captions ? `@remotion/captions ${captions.version || "version unknown"}` : "ABSENT"));
  const mediaUtils = resolveRemotionPackage("@remotion/media-utils");
  items.push(item("remotion.media-utils", mediaUtils ? "AVAILABLE" : "NOT_AVAILABLE", mediaUtils ? `@remotion/media-utils ${mediaUtils.version || "version unknown"}` : "ABSENT"));
  return { section: "remotion", items, meta: { coreVersion, captions: captions ? captions.version : null, mediaUtils: mediaUtils ? mediaUtils.version : null } };
}

function checkWhisper() {
  const items = [];
  const meta = {};
  const envBin = process.env.WHISPER_CPP_BIN ? String(process.env.WHISPER_CPP_BIN).trim() : "";
  let bin = null;
  let source = null;
  if (envBin) {
    bin = envBin;
    source = "WHISPER_CPP_BIN";
  } else {
    const found = commandOnPath("whisper-cli");
    if (found) {
      bin = found;
      source = "PATH:whisper-cli";
    }
  }
  meta.binary = bin;
  meta.binSource = source;
  if (bin && fs.existsSync(bin)) {
    items.push(item("whisper.binary", "AVAILABLE", `${bin} (${source})`));
  } else if (bin) {
    items.push(item("whisper.binary", "NOT_AVAILABLE", `configured path missing: ${bin}`));
  } else {
    items.push(item("whisper.binary", "NOT_CONFIGURED", "WHISPER_CPP_BIN unset; whisper-cli not on PATH"));
  }
  const model = process.env.WHISPER_CPP_MODEL ? String(process.env.WHISPER_CPP_MODEL).trim() : "";
  meta.model = model || null;
  if (!model) {
    items.push(item("whisper.model", "NOT_CONFIGURED", "WHISPER_CPP_MODEL unset"));
  } else if (fs.existsSync(model)) {
    items.push(item("whisper.model", "AVAILABLE", `model present: ${model}`));
  } else {
    items.push(item("whisper.model", "NOT_AVAILABLE", `model path missing: ${model}`));
  }
  return { section: "whisper", items, meta };
}

function checkTiming() {
  const items = [];
  const meta = {};
  let localWhisper = null;
  try {
    localWhisper = require("../../providers/runtime/adapters/local-whisper.js");
  } catch {
    localWhisper = null;
  }
  meta.localWhisperLoadable = !!localWhisper;
  const provider = process.env.STT_TIMING_PROVIDER ? String(process.env.STT_TIMING_PROVIDER).trim() : "";
  meta.STT_TIMING_PROVIDER = provider || null;
  if (localWhisper && (!provider || provider === "local-whisper")) {
    items.push(item("timing.local-whisper", "AVAILABLE", provider ? "STT_TIMING_PROVIDER=local-whisper REGISTERED" : "adapter require-able; STT_TIMING_PROVIDER unset (defaults to local-whisper)"));
  } else if (localWhisper) {
    items.push(item("timing.local-whisper", "NOT_CONFIGURED", `adapter present but STT_TIMING_PROVIDER=${provider}`));
  } else {
    items.push(item("timing.local-whisper", "NOT_AVAILABLE", "providers/runtime/adapters/local-whisper not require-able"));
  }
  items.push(item("timing.elevenlabs-stt", "NOT_CONFIGURED", "disabled by policy: no paid calls; never auto-enabled by doctor"));
  meta.elevenlabsStt = "DISABLED_BY_POLICY";
  return { section: "timing", items, meta };
}

function checkCaptions(summary) {
  const items = [];
  const caps = summary.remotion.items.find((i) => i.name === "remotion.captions");
  const mu = summary.remotion.items.find((i) => i.name === "remotion.media-utils");
  const wb = summary.whisper.items.find((i) => i.name === "whisper.binary");
  const parts = [
    `@remotion/captions=${caps ? caps.status : "UNKNOWN"}`,
    `@remotion/media-utils=${mu ? mu.status : "UNKNOWN"}`,
    `whisper=${wb ? wb.status : "UNKNOWN"}`
  ];
  const ok = caps && caps.status === "AVAILABLE" && mu && mu.status === "AVAILABLE";
  items.push(item("captions.summary", ok ? "AVAILABLE" : "NOT_CONFIGURED", parts.join(" ")));
  return { section: "captions", items, meta: null };
}

function main() {
  let report;
  try {
    const asJson = process.argv.slice(2).includes("--json");
    const tools = checkTools();
    const remotion = checkRemotion();
    const whisper = checkWhisper();
    const timing = checkTiming();
    const summary = { remotion, whisper };
    const captions = checkCaptions(summary);
    report = {
      tool: "media-tool-doctor",
      generatedAt: new Date().toISOString(),
      note: "inspection only; never installs, downloads, renders, transcribes, or spends credits",
      sections: [tools, remotion, whisper, timing, captions]
    };
    if (asJson) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      const lines = [];
      lines.push("UNFOLDIQ media-tool-doctor (inspection only)");
      lines.push(`generated: ${report.generatedAt}`);
      for (const sec of report.sections) {
        lines.push(`\n[${sec.section}]`);
        for (const it of sec.items) {
          lines.push(`  ${String(it.status).padEnd(16)} ${it.name}${it.detail ? ` — ${it.detail}` : ""}`);
        }
      }
      lines.push("\nJSON: node scripts/diagnostics/media-tool-doctor.js --json (exit code always 0)");
      process.stdout.write(lines.join("\n") + "\n");
    }
  } catch (e) {
    try {
      if (process.argv.slice(2).includes("--json")) {
        process.stdout.write(JSON.stringify({ tool: "media-tool-doctor", status: "UNKNOWN", error: String((e && e.message) || e) }) + "\n");
      } else {
        process.stdout.write(`media-tool-doctor UNKNOWN: ${String((e && e.message) || e)}\n`);
      }
    } catch {
      /* ignore */
    }
  }
  process.exitCode = 0;
}

if (require.main === module) {
  main();
}

module.exports = {};
