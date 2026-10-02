"use strict";

/**
 * local-media-doctor (STEP-10C Branch A).
 * Inspection ONLY: never pip/npm installs, clones, downloads, launches models,
 * generates audio, transcribes, or mutates global config.
 * Exit code always 0 (doctor never fails the build).
 *
 * Usage: node scripts/diagnostics/local-media-doctor.js [--json]
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const child_process = require("child_process");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

function item(name, status, detail) {
  return { name, status, detail: detail === undefined ? null : String(detail) };
}

function execGuarded(cmd, opts) {
  try {
    const out = child_process.execSync(cmd, {
      timeout: 5000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      ...(opts || {}),
    });
    return String(out || "").trim();
  } catch {
    return null;
  }
}

function httpGetJson(urlStr, timeoutMs) {
  return new Promise((resolve) => {
    let url = null;
    try {
      url = new URL(urlStr);
    } catch {
      resolve({ ok: false, status: null });
      return;
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      resolve({ ok: false, status: null });
      return;
    }
    const req = http.get(
      { hostname: url.hostname, port: url.port || 80, path: url.pathname || "/", timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, raw: body.slice(0, 2000) });
        });
      }
    );
    req.on("error", () => resolve({ ok: false, status: null }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: null });
    });
  });
}

function checkSystem() {
  let sys = null;
  try {
    sys = require("../../providers/runtime/hardware-policy.js").getSystemInfo();
  } catch {
    sys = null;
  }
  const items = [];
  if (!sys) {
    items.push(item("os", "UNKNOWN", "system detection unavailable"));
    return { section: "system", items, info: null };
  }
  items.push(item("os", "AVAILABLE", `${sys.platform} ${sys.release} (${sys.arch})`));
  items.push(item("cpu", "AVAILABLE", `${sys.cpuCount}x ${sys.cpuModel}`));
  items.push(
    item("ram", sys.totalMemGB != null ? "AVAILABLE" : "UNKNOWN", sys.totalMemGB != null ? `total ${sys.totalMemGB}GB free ${sys.freeMemGB}GB` : "memory unknown")
  );
  items.push(
    item("gpu", sys.gpu ? "AVAILABLE" : "UNKNOWN", sys.gpu ? `${sys.gpu} vram ${sys.vramGB != null ? sys.vramGB + "GB" : "unknown"}` : "no NVIDIA GPU detected (nvidia-smi absent or failed)")
  );
  items.push(
    item("disk", sys.diskFreeGB != null ? "AVAILABLE" : "UNKNOWN", sys.diskFreeGB != null ? `free ${sys.diskFreeGB}GB` : "disk free unknown")
  );
  return { section: "system", items, info: sys };
}

function commandOnPath(cmd) {
  const probe = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
  const out = execGuarded(probe);
  if (!out) return null;
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      if (fs.existsSync(line) && fs.statSync(line).isFile()) {
        if (process.platform === "win32") {
          const low = line.toLowerCase();
          if (low.endsWith(".cpl") || low.endsWith(".msc")) continue;
        }
        return line;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function checkComfyUI() {
  const items = [];
  const meta = { server: { host: "127.0.0.1", port: 8188 }, registryWorkflows: 0, modelsChecked: 0, modelsMissing: [] };

  const envCmd = process.env.COMFYUI_CMD ? String(process.env.COMFYUI_CMD).trim() : "";
  const regFile = path.join(PROJECT_ROOT, "providers", "local", "comfyui", "workflow-registry.yaml");
  const regExists = fs.existsSync(regFile);
  if (envCmd) {
    items.push(item("comfyui.command", "AVAILABLE", `COMFYUI_CMD=${envCmd}`));
  } else if (regExists) {
    items.push(item("comfyui.command", "NOT_CONFIGURED", "COMFYUI_CMD unset; registry file present"));
  } else {
    items.push(item("comfyui.command", "NOT_CONFIGURED", "COMFYUI_CMD unset and registry file missing"));
  }

  let registry = null;
  try {
    registry = require("../../providers/local/comfyui/workflow-loader.js").loadRegistry(PROJECT_ROOT);
    meta.server = registry.server || meta.server;
    meta.registryWorkflows = registry.workflows.length;
    items.push(item("comfyui.registry", "AVAILABLE", `${registry.workflows.length} workflow(s) in registry`));
  } catch (e) {
    items.push(item("comfyui.registry", regExists ? "UNKNOWN" : "NOT_CONFIGURED", `registry load failed: ${e.message}`));
  }

  const reach = await httpGetJson(`http://${meta.server.host}:${meta.server.port}/system_stats`, 1500);
  items.push(
    item("comfyui.server", reach.ok ? "AVAILABLE" : "NOT_AVAILABLE", reach.ok ? `reachable http://${meta.server.host}:${meta.server.port}/system_stats` : `not reachable http://${meta.server.host}:${meta.server.port}/system_stats`)
  );
  let version = null;
  if (reach.ok && reach.json && typeof reach.json === "object") {
    version = reach.json.version || reach.json.comfyui_version || reach.json.system_status || null;
  }
  items.push(
    item("comfyui.version", version ? "AVAILABLE" : "UNKNOWN", version ? String(version).slice(0, 200) : "version not detectable (server unreachable or no version field)")
  );

  if (registry) {
    const enabledImage = registry.workflows.filter((w) => w.capability === "image" && w.enabled).length;
    const enabledVideo = registry.workflows.filter((w) => w.capability === "video" && w.enabled).length;
    items.push(item("comfyui.capability.image", enabledImage > 0 ? "AVAILABLE" : "NOT_CONFIGURED", `${enabledImage} enabled image workflow(s)`));
    items.push(item("comfyui.capability.video", enabledVideo > 0 ? "AVAILABLE" : "NOT_CONFIGURED", `${enabledVideo} enabled video workflow(s)`));
    const missing = [];
    let checked = 0;
    const modelRoot = path.join(PROJECT_ROOT, "providers", "local", "comfyui");
    for (const w of registry.workflows) {
      if (w.enabled !== true) continue;
      for (const m of w.requiredModels || []) {
        const rel = typeof m === "string" ? m : m.path;
        const must = typeof m === "string" ? true : m.required !== false;
        if (!must || !rel) continue;
        checked += 1;
        const abs = path.resolve(modelRoot, rel);
        const rc = path.relative(path.resolve(modelRoot), abs);
        if (rc.startsWith("..") || !fs.existsSync(abs)) missing.push(`${w.workflowId}:${rel}`);
      }
    }
    meta.modelsChecked = checked;
    meta.modelsMissing = missing;
    if (checked === 0) {
      items.push(item("comfyui.models", "AVAILABLE", "enabled workflows reference no models (mock/test)"));
    } else if (missing.length === 0) {
      items.push(item("comfyui.models", "AVAILABLE", `${checked} referenced model(s) present`));
    } else {
      items.push(item("comfyui.models", "MODEL_MISSING", `missing: ${missing.join(", ")}`));
    }
  } else {
    items.push(item("comfyui.capability.image", "UNKNOWN", "registry unavailable"));
    items.push(item("comfyui.capability.video", "UNKNOWN", "registry unavailable"));
    items.push(item("comfyui.models", "UNKNOWN", "registry unavailable"));
  }

  return { section: "comfyui", items, meta };
}

function checkKokoro() {
  const items = [];
  const meta = {};
  const pyVer = execGuarded("python --version") || execGuarded("py --version");
  if (pyVer) {
    items.push(item("kokoro.python", "AVAILABLE", pyVer.split("\n")[0].slice(0, 200)));
    meta.python = pyVer.split("\n")[0];
  } else {
    items.push(item("kokoro.python", "NOT_AVAILABLE", "neither `python --version` nor `py --version` succeeded"));
  }
  if (pyVer) {
    const probe = execGuarded('python -c "import kokoro"');
    // execGuarded returns "" on success (no output) vs null on failure.
    const probe2 = (() => {
      try {
        child_process.execSync('python -c "import kokoro"', { timeout: 5000, stdio: "ignore", windowsHide: true });
        return true;
      } catch {
        return false;
      }
    })();
    void probe;
    items.push(item("kokoro.package", probe2 ? "AVAILABLE" : "NOT_CONFIGURED", probe2 ? "python -c \"import kokoro\" succeeded" : "kokoro package not importable (not installed or not on path)"));
    meta.packageImportable = probe2;
  } else {
    items.push(item("kokoro.package", "UNKNOWN", "python unavailable; package check skipped"));
  }
  const voices = process.env.KOKORO_VOICES ? String(process.env.KOKORO_VOICES) : "";
  const langs = process.env.KOKORO_LANGS ? String(process.env.KOKORO_LANGS) : "";
  items.push(item("kokoro.env.voices", voices ? "AVAILABLE" : "NOT_CONFIGURED", voices ? `KOKORO_VOICES=${voices.slice(0, 200)}` : "KOKORO_VOICES unset"));
  items.push(item("kokoro.env.langs", langs ? "AVAILABLE" : "NOT_CONFIGURED", langs ? `KOKORO_LANGS=${langs.slice(0, 200)}` : "KOKORO_LANGS unset"));
  meta.env = { KOKORO_VOICES: voices || null, KOKORO_LANGS: langs || null };
  let supported = null;
  try {
    const adapter = require("../../providers/runtime/adapters/local-kokoro.js");
    const langsMeta = adapter.supportedLanguages || adapter.SUPPORTED_LANGS || adapter.metadata;
    if (Array.isArray(langsMeta)) supported = langsMeta;
    else if (langsMeta && Array.isArray(langsMeta.languages)) supported = langsMeta.languages;
  } catch {
    supported = null;
  }
  if (!supported) supported = ["en"];
  meta.supportedLanguages = supported;
  items.push(item("kokoro.languages", "AVAILABLE", `supported: ${supported.join(", ")} (metadata only; no audio generated)`));
  items.push(item("kokoro.synth", "UNKNOWN", "not attempted — doctor never generates audio"));
  return { section: "kokoro", items, meta };
}

async function checkWhisper() {
  const items = [];
  const meta = {};
  const bin = process.env.WHISPER_CPP_BIN ? String(process.env.WHISPER_CPP_BIN).trim() : "";
  let binPath = null;
  if (bin) {
    binPath = bin;
    meta.binSource = "WHISPER_CPP_BIN";
  } else {
    for (const c of ["whisper-cli", "whisper.cpp", "main"]) {
      const found = commandOnPath(c);
      if (found) {
        binPath = found;
        meta.binSource = `PATH:${c}`;
        break;
      }
    }
  }
  if (binPath && fs.existsSync(binPath)) {
    items.push(item("whisper.binary", "AVAILABLE", `${binPath}`));
    meta.binary = binPath;
  } else if (binPath && !fs.existsSync(binPath)) {
    items.push(item("whisper.binary", "NOT_AVAILABLE", `configured path missing: ${binPath}`));
    meta.binary = binPath;
  } else {
    items.push(item("whisper.binary", "NOT_CONFIGURED", "WHISPER_CPP_BIN unset; whisper-cli/whisper.cpp/main not on PATH"));
    meta.binary = null;
  }
  const model = process.env.WHISPER_CPP_MODEL ? String(process.env.WHISPER_CPP_MODEL).trim() : "";
  meta.model = model || null;
  if (!model) {
    items.push(item("whisper.model", "NOT_CONFIGURED", "WHISPER_CPP_MODEL unset"));
  } else if (fs.existsSync(model)) {
    items.push(item("whisper.model", "AVAILABLE", `model present: ${model}`));
  } else {
    items.push(item("whisper.model", "MODEL_MISSING", `model path missing: ${model}`));
  }
  const serverUrl = process.env.WHISPER_CPP_SERVER_URL ? String(process.env.WHISPER_CPP_SERVER_URL).trim() : "";
  meta.serverUrl = serverUrl || null;
  if (!serverUrl) {
    items.push(item("whisper.server", "NOT_CONFIGURED", "WHISPER_CPP_SERVER_URL unset (optional)"));
  } else {
    let reach = { ok: false };
    try {
      const u = new URL(serverUrl);
      if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
        reach = await httpGetJson(serverUrl, 1500);
      }
    } catch {
      reach = { ok: false };
    }
    items.push(item("whisper.server", reach.ok ? "AVAILABLE" : "NOT_AVAILABLE", reach.ok ? `reachable ${serverUrl}` : `not reachable ${serverUrl}`));
  }
  items.push(item("whisper.transcribe", "UNKNOWN", "not attempted — doctor never transcribes"));
  return { section: "whisper", items, meta };
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const system = checkSystem();
  const comfyui = await checkComfyUI();
  const kokoro = checkKokoro();
  const whisper = await checkWhisper();
  const report = {
    tool: "local-media-doctor",
    generatedAt: new Date().toISOString(),
    note: "inspection only; never installs, downloads, or launches models",
    sections: [system, comfyui, kokoro, whisper],
  };
  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const lines = [];
    lines.push("UNFOLDIQ local-media-doctor (inspection only)");
    lines.push(`generated: ${report.generatedAt}`);
    for (const sec of report.sections) {
      lines.push(`\n[${sec.section}]`);
      for (const it of sec.items) {
        lines.push(`  ${it.status.padEnd(16)} ${it.name}${it.detail ? ` — ${it.detail}` : ""}`);
      }
    }
    lines.push("\nJSON: node scripts/diagnostics/local-media-doctor.js --json (exit code always 0)");
    process.stdout.write(lines.join("\n") + "\n");
  }
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch(() => {
    process.exitCode = 0;
  });
}

module.exports = {};
