"use strict";

/**
 * UNFOLDIQ render readiness doctor (PHASE 1G.1 Prompt 05 Fix 7 REV3, §14-15).
 * Detects whether native Windows Remotion rendering is currently executable
 * WITHOUT changing any Windows security setting. Read-only: runs small safe
 * binary preflights (ffmpeg/ffprobe -version, compositor JSON-handshake probe)
 * and checks output-dir writeability. Never toggles Smart App Control, never
 * edits policies, never modifies files.
 *
 * Result contract: READY | NOT_READY.
 * A SAC-specific hint is printed ONLY with supporting evidence (deny on
 * spawn/exec plus a matching recent CodeIntegrity event for that binary);
 * otherwise a generic NOT_READY is reported (no overclaiming, Fix 7 §15).
 *
 * Usage: npm run render:doctor
 */

const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const REMOTION_DIR = path.join(ROOT, "remotion");
const COMPOSITOR_DIR = path.join(REMOTION_DIR, "node_modules", "@remotion", "compositor-win32-x64-msvc");

function line(s) { console.log(s); }

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function remotionVersion() {
  try {
    return require(path.join(REMOTION_DIR, "node_modules", "remotion", "package.json")).version;
  } catch {
    return null;
  }
}

function compositorVersion() {
  try {
    return require(path.join(COMPOSITOR_DIR, "package.json")).version;
  } catch {
    return null;
  }
}

/** Run a binary with a tiny safe argv; classify spawn/exit outcome. */
function probeBinary(exe, args, input) {
  const r = spawnSync(exe, args, { encoding: "utf8", timeout: 30000, input: input || "", windowsHide: true });
  if (r.error) {
    return { ok: false, kind: "spawn-error", code: r.error.code || String(r.error.code || r.error.message).slice(0, 40) };
  }
  return { ok: r.status === 0, kind: "exit", code: r.status, stderrTail: (r.stderr || "").slice(-200) };
}

/** Look for a recent CodeIntegrity block mentioning the given file name. */
function recentCodeIntegrityBlock(fileName) {
  try {
    const ps = `Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 40 -ErrorAction SilentlyContinue | Where-Object { $_.Id -in 3033,3077,3118 -and $_.Message -match '${fileName.replace(/'/g, "")}' } | Select-Object -First 1 TimeCreated, Id | ConvertTo-Json -Compress`;
    const out = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 30000 });
    const t = (out.stdout || "").trim();
    if (!t) return null;
    const j = JSON.parse(t);
    return { timeCreated: j.TimeCreated, eventId: j.Id };
  } catch {
    return null;
  }
}

function main() {
  console.log("=== UNFOLDIQ RENDER DOCTOR (read-only, no security changes) ===");
  const problems = [];
  let sacEvidence = false;

  const rv = remotionVersion();
  const cv = compositorVersion();
  line(`remotion: ${rv || "MISSING"} | compositor pkg: ${cv || "MISSING"}`);
  if (!rv || !cv) problems.push("remotion/compositor package missing (run npm ci in remotion/)");
  else if (rv !== cv) problems.push(`remotion ${rv} != compositor ${cv} (version mismatch)`);

  const binaries = [
    ["ffmpeg.exe", ["-version"], "", false],
    ["ffprobe.exe", ["-version"], "", false],
    // The Rust compositor expects a JSON command on stdin; an invalid one makes
    // it exit non-zero through its own error handling. For this binary any
    // SPAWNED run proves executability (SAC denies the spawn itself), so the
    // exit code is not the criterion.
    ["remotion.exe", [], "{}", true],
  ];
  for (const [name, args, input, spawnOnly] of binaries) {
    const exe = path.join(COMPOSITOR_DIR, name);
    if (!fs.existsSync(exe)) {
      problems.push(`${name} missing at ${exe}`);
      continue;
    }
    const res = probeBinary(exe, args, input);
    if (res.kind !== "spawn-error" && (res.code === 0 || spawnOnly)) {
      line(`binary preflight ${name}: OK (spawned${res.code === 0 ? ", exit 0" : ", ran its own error handling"})`);
      continue;
    }
    if (res.kind === "spawn-error" && ["EACCES", "EPERM"].includes(res.code)) {
      const ci = recentCodeIntegrityBlock(name);
      if (ci) {
        sacEvidence = true;
        problems.push(`${name} denied on execution (EACCES) + CodeIntegrity event ${ci.eventId} at ${ci.timeCreated} — Windows application control is blocking it`);
      } else {
        problems.push(`${name} denied on execution (EACCES) — no matching CodeIntegrity event found; inspect logs`);
      }
    } else {
      problems.push(`${name} probe failed: ${res.kind} code=${res.code} ${res.stderrTail || ""}`.trim());
    }
  }

  // Output dir writeability (render artifacts land under out/).
  try {
    const probeDir = path.join(ROOT, "out");
    fs.mkdirSync(probeDir, { recursive: true });
    const tmp = path.join(probeDir, `.render-doctor-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, "probe");
    fs.unlinkSync(tmp);
    line("output dir writeability: OK (out/)");
  } catch (e) {
    problems.push(`output dir not writable: ${e.message}`);
  }

  // Browser readiness where cheap: pinned headless shell presence only.
  const shell = path.join(REMOTION_DIR, "node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  line(`browser headless shell: ${fs.existsSync(shell) ? "PRESENT" : "MISSING (npx remotion browser ensure will fetch on demand)"}`);

  if (problems.length === 0) {
    console.log("RENDER_DOCTOR_RESULT: READY");
    return;
  }
  console.log("RENDER_DOCTOR_RESULT: NOT_READY");
  for (const p of problems) line(`- ${p}`);
  if (sacEvidence) {
    console.log("OPERATOR_ACTION_REQUIRED:");
    console.log("Native Remotion binaries are blocked by Windows application control.");
    console.log("If your approved workflow is manual SAC toggling, turn Smart App Control OFF");
    console.log("manually in Windows Security and rerun render:doctor.");
  } else {
    console.log("NATIVE_RENDER_NOT_READY — inspect logs");
  }
}

main();
