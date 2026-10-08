"use strict";
// lib/perf/env.js — Phase 5A environment fingerprint (spec §6.1).
// Every field is measured locally; unavailable fields are NOT_MEASURED, never "".

const child_process = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function sh(cmd, args, timeoutMs) {
  try {
    const r = child_process.spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs || 30000 });
    if (r.status === 0) return (r.stdout || "").trim().split("\n")[0].trim();
  } catch (e) { void e; }
  return null;
}

function repoCommit(root) {
  return sh("git", ["rev-parse", "--short", "HEAD"], 15000);
}

function remotionVersion(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "remotion", "package.json"), "utf8"));
    void pkg;
  } catch (e) { void e; }
  // Canonical renderer version lives in the compositor preflight (render-doctor).
  try {
    const doc = child_process.spawnSync(process.execPath,
      [path.join(root, "scripts", "diagnostics", "render-doctor.js")],
      { encoding: "utf8", timeout: 60000 });
    const m = ((doc.stdout || "") + (doc.stderr || "")).match(/remotion:\s*([0-9][^\s|]*)/);
    if (m) return m[1];
  } catch (e) { void e; }
  return "NOT_MEASURED";
}

function cpuModel() {
  const cpus = os.cpus() || [];
  return {
    model: cpus.length > 0 ? String(cpus[0].model || "NOT_MEASURED").trim() : "NOT_MEASURED",
    logicalCount: typeof os.availableParallelism === "function" ? os.availableParallelism() : (cpus.length || "NOT_MEASURED"),
  };
}

function fingerprint(root, opts) {
  opts = opts || {};
  const cpu = cpuModel();
  return {
    benchmarkId: opts.benchmarkId || ("bench-" + Date.now()),
    date: new Date().toISOString(),
    gitCommit: repoCommit(root) || "NOT_MEASURED",
    os: os.platform() + "-" + os.release(),
    arch: os.arch(),
    cpuModel: cpu.model,
    cpuLogicalCount: cpu.logicalCount,
    memoryBytes: typeof os.totalmem === "function" ? os.totalmem() : "NOT_MEASURED",
    nodeVersion: process.version,
    chromeVersion: "NOT_MEASURED",
    extensionVersion: extensionVersion(root),
    remotionVersion: remotionVersion(root),
    ffmpegVersion: (sh("ffmpeg", ["-version"], 15000) || "NOT_MEASURED").slice(0, 64),
    powerMode: "NOT_MEASURED",
    networkClass: "NOT_MEASURED",
    providerRegion: "NOT_MEASURED",
    benchmarkMode: opts.benchmarkMode || "WARM",
  };
}

function extensionVersion(root) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(root, "flow-companion", "extension", "manifest.json"), "utf8"));
    return m.version || "NOT_MEASURED";
  } catch (e) { return "NOT_MEASURED"; }
}

module.exports = { fingerprint, extensionVersion };
