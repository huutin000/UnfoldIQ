"use strict";

/**
 * UNFOLDIQ render-binaries setup (PHASE 1G.1 Prompt 05 Fix 6, Part B).
 *
 * Root cause: upstream Remotion ships UNSIGNED Windows compositor binaries
 * (@remotion/compositor-win32-x64-msvc) and Windows Smart App Control blocks
 * them (tracked upstream: "Sign Windows compositor binaries with Microsoft
 * Artifact Signing"). SAC has no per-app allow rule and must not be weakened.
 *
 * Supported alternative: Remotion's official `binariesDirectory` option. This
 * script builds a NON-COMMITTED runtime directory that mirrors the installed
 * compositor package but replaces ffmpeg.exe/ffprobe.exe with the operator's
 * trusted system FFmpeg build (which SAC already allows). remotion.exe and the
 * FFmpeg DLLs stay the pristine upstream bytes.
 *
 * STATUS (Fix 7 REV3): DIAGNOSTIC/FUTURE HELPER ONLY — not the current render
 * path. The approved workflow is native rendering during the operator's manual
 * SAC-off window. This script becomes relevant again if upstream signs the
 * compositor binaries or on machines without SAC. *
 * Usage: node scripts/maintenance/setup-render-binaries.js
 * Then render with UNFOLDIQ_REMOTION_BINARIES_DIR=<dir>.
 * Never runs automatically; never committed (dir is git-ignored).
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const COMPOSITOR_PKG = path.join(ROOT, "remotion", "node_modules", "@remotion", "compositor-win32-x64-msvc");
const OUT_DIR = path.join(ROOT, "remotion", ".render-binaries");
const REPLACED = new Set(["ffmpeg.exe", "ffprobe.exe"]);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function systemFfmpegPath() {
  try {
    const where = execFileSync("where.exe", ["ffmpeg"], { encoding: "utf8" });
    const first = where.split(/\r?\n/).map((l) => l.trim()).find((l) => l && fs.existsSync(l));
    return first || null;
  } catch {
    return null;
  }
}

function main() {
  if (!fs.existsSync(COMPOSITOR_PKG)) {
    console.error("SETUP_RENDER_BINARIES_FAILED: compositor package missing:", COMPOSITOR_PKG);
    process.exit(1);
  }
  const sysFfmpeg = systemFfmpegPath();
  if (!sysFfmpeg) {
    console.error("SETUP_RENDER_BINARIES_FAILED: no system ffmpeg found on PATH");
    process.exit(1);
  }
  const sysFfprobe = path.join(path.dirname(sysFfmpeg), "ffprobe.exe");
  if (!fs.existsSync(sysFfprobe)) {
    console.error("SETUP_RENDER_BINARIES_FAILED: no ffprobe next to system ffmpeg:", sysFfmpeg);
    process.exit(1);
  }
  // Fresh build every run (no stale mixing).
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const entry of fs.readdirSync(COMPOSITOR_PKG)) {
    if (REPLACED.has(entry)) continue;
    fs.copyFileSync(path.join(COMPOSITOR_PKG, entry), path.join(OUT_DIR, entry));
  }
  fs.copyFileSync(sysFfmpeg, path.join(OUT_DIR, "ffmpeg.exe"));
  fs.copyFileSync(sysFfprobe, path.join(OUT_DIR, "ffprobe.exe"));
  const manifest = {
    generatedAt: new Date().toISOString(),
    compositorPackage: "@remotion/compositor-win32-x64-msvc",
    compositorVersion: require(path.join(COMPOSITOR_PKG, "package.json")).version,
    replaced: {
      "ffmpeg.exe": { source: sysFfmpeg, sha256: sha256(path.join(OUT_DIR, "ffmpeg.exe")) },
      "ffprobe.exe": { source: sysFfprobe, sha256: sha256(path.join(OUT_DIR, "ffprobe.exe")) },
    },
    preserved: {
      "remotion.exe": sha256(path.join(OUT_DIR, "remotion.exe")),
      upstreamFfmpegSha256: sha256(path.join(COMPOSITOR_PKG, "ffmpeg.exe")),
      upstreamFfprobeSha256: sha256(path.join(COMPOSITOR_PKG, "ffprobe.exe")),
    },
    reason: "Windows SAC blocks the unsigned upstream ffmpeg.exe/ffprobe.exe; remotion.exe is unaffected. Official binariesDirectory option with trusted system FFmpeg.",
  };
  fs.writeFileSync(path.join(OUT_DIR, "render-binaries-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("RENDER_BINARIES_READY:", OUT_DIR);
  console.log("Set UNFOLDIQ_REMOTION_BINARIES_DIR to that path for renders on SAC-affected machines.");
}

main();
