"use strict";

/**
 * UNFOLDIQ hardware policy gate (STEP-10C Branch A).
 * Decides local-video eligibility without hard-coding any GPU model name.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const child_process = require("child_process");

function loadProjectPolicy(projectRoot) {
  const root = projectRoot || path.join(__dirname, "..", "..");
  const defaults = { avoidHeavyLocalVideoByDefault: true, allowPaidCloud: false };
  try {
    const yaml = require("js-yaml");
    const raw = fs.readFileSync(path.join(root, "providers", "CONFIG.yaml"), "utf8");
    const cfg = yaml.load(raw) || {};
    const hw = (cfg.hardwarePolicy && typeof cfg.hardwarePolicy === "object") ? cfg.hardwarePolicy : {};
    const cost = (cfg.costPolicy && typeof cfg.costPolicy === "object") ? cfg.costPolicy : {};
    return {
      avoidHeavyLocalVideoByDefault:
        typeof hw.avoidHeavyLocalVideoByDefault === "boolean"
          ? hw.avoidHeavyLocalVideoByDefault
          : defaults.avoidHeavyLocalVideoByDefault,
      allowPaidCloud:
        typeof cost.allowPaidCloud === "boolean" ? cost.allowPaidCloud : defaults.allowPaidCloud,
    };
  } catch {
    return { ...defaults };
  }
}

function getSystemInfo() {
  const cpus = (() => {
    try {
      return os.cpus() || [];
    } catch {
      return [];
    }
  })();
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const info = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: cpus.length || 0,
    cpuModel: (cpus[0] && cpus[0].model ? String(cpus[0].model) : "UNKNOWN").slice(0, 256),
    totalMemGB: round2(totalBytes / 1073741824),
    freeMemGB: round2(freeBytes / 1073741824),
    ramGB: round2(totalBytes / 1073741824),
    diskFreeGB: null,
    gpu: null,
    vramGB: null,
  };
  try {
    const target = process.cwd();
    const st = fs.statfsSync(target);
    if (st && typeof st.bavail === "number" && typeof st.bsize === "number") {
      info.diskFreeGB = round2((st.bavail * st.bsize) / 1073741824);
    }
  } catch {
    info.diskFreeGB = null;
  }
  try {
    const out = child_process.execSync(
      "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader",
      { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const line = String(out || "").split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (line) {
      const parts = line.split(",");
      const name = (parts[0] || "").trim();
      const memRaw = (parts[1] || "").trim();
      const memMatch = memRaw.match(/([\d.]+)\s*MiB/i);
      info.gpu = name ? name.slice(0, 256) : null;
      info.vramGB = memMatch ? round2(parseFloat(memMatch[1]) / 1024) : null;
    } else {
      info.gpu = null;
      info.vramGB = null;
    }
  } catch {
    info.gpu = null;
    info.vramGB = null;
  }
  return info;
}

function round2(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function isHeavyWorkflow(wr) {
  if (!wr || typeof wr !== "object") return false;
  if (wr.heavy === true) return true;
  if (typeof wr.minVramGB === "number" && wr.minVramGB >= 6) return true;
  return false;
}

/**
 * evaluateLocalVideoEligibility({ workflowRequirements, systemInfo, projectPolicy })
 * → { eligibility, reasons[] }
 */
function evaluateLocalVideoEligibility(args) {
  const a = args || {};
  const wr = a.workflowRequirements || null;
  const sys = a.systemInfo || {};
  const policy = a.projectPolicy || { avoidHeavyLocalVideoByDefault: true };
  const reasons = [];

  if (policy.avoidHeavyLocalVideoByDefault === true && wr && isHeavyWorkflow(wr)) {
    reasons.push("project policy avoidHeavyLocalVideoByDefault=true blocks heavy local video workflow");
    if (wr.heavy === true) reasons.push("workflow marked heavy:true");
    if (typeof wr.minVramGB === "number" && wr.minVramGB >= 6) {
      reasons.push(`workflow minVramGB=${wr.minVramGB} >= 6 threshold`);
    }
    return { eligibility: "UNSUITABLE_BY_POLICY", reasons };
  }

  if (!wr || (wr.minVramGB == null && wr.minRamGB == null)) {
    reasons.push("no reliable requirement metadata (minVramGB/minRamGB absent)");
    return { eligibility: "UNKNOWN", reasons };
  }

  const reqVram = typeof wr.minVramGB === "number" ? wr.minVramGB : null;
  const reqRam = typeof wr.minRamGB === "number" ? wr.minRamGB : null;
  const haveVram = typeof sys.vramGB === "number" ? sys.vramGB : null;
  const haveRam =
    typeof sys.ramGB === "number" ? sys.ramGB : typeof sys.totalMemGB === "number" ? sys.totalMemGB : null;

  if (reqVram != null && haveVram == null) {
    reasons.push(`workflow requires minVramGB=${reqVram} but system VRAM unknown`);
    return { eligibility: "UNKNOWN", reasons };
  }
  if (reqRam != null && haveRam == null) {
    reasons.push(`workflow requires minRamGB=${reqRam} but system RAM unknown`);
    return { eligibility: "UNKNOWN", reasons };
  }

  let ok = true;
  if (reqVram != null) {
    if (haveVram >= reqVram) {
      reasons.push(`VRAM ok: system ${haveVram}GB >= required ${reqVram}GB`);
    } else {
      reasons.push(`VRAM insufficient: system ${haveVram}GB < required ${reqVram}GB`);
      ok = false;
    }
  }
  if (reqRam != null) {
    if (haveRam >= reqRam) {
      reasons.push(`RAM ok: system ${haveRam}GB >= required ${reqRam}GB`);
    } else {
      reasons.push(`RAM insufficient: system ${haveRam}GB < required ${reqRam}GB`);
      ok = false;
    }
  }
  return { eligibility: ok ? "AVAILABLE" : "NOT_AVAILABLE", reasons };
}

module.exports = {
  evaluateLocalVideoEligibility,
  loadProjectPolicy,
  getSystemInfo,
};
