"use strict";

/**
 * UNFOLDIQ media preflight CLI (STEP-11 Branch A).
 * Usage: node scripts/cli/media-preflight-cli.js --project <id> [--json] [--fix-safe]
 * Read-only except writing projects/<id>/preflight/*. Never rewrites manifests,
 * never regenerates media, never installs anything.
 * Exit: 0 READY, 2 BLOCKED, 3 REVIEW_REQUIRED, 1 usage/IO error.
 */

const fs = require("fs");
const path = require("path");
const { runPreflight } = require("../../lib/media-preflight.js");
const { resolveProjectPath } = require("../../providers/runtime/artifact-store.js");
const mediaProbe = require("../../lib/media-probe.js");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

function usage() {
  return "Usage: node scripts/cli/media-preflight-cli.js --project <id> [--json] [--fix-safe]";
}

function parseArgs(argv) {
  const o = { project: null, json: false, fixSafe: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--project" && i + 1 < argv.length) {
      o.project = argv[i + 1];
      i += 1;
    } else if (a.startsWith("--project=")) {
      o.project = a.slice("--project=".length);
    } else if (a === "--json") {
      o.json = true;
    } else if (a === "--fix-safe") {
      o.fixSafe = true;
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  if (!o.project) return { error: "missing --project <id>" };
  return o;
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function forwardSlashes(p) {
  return String(p).split(path.sep).join("/");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(usage());
    console.error(`error: ${args.error}`);
    process.exitCode = 1;
    return;
  }
  const projectId = args.project;
  const projectDir = path.join(PROJECT_ROOT, "projects", projectId);
  let manifest;
  let script;
  let registry = null;
  try {
    manifest = readJson(path.join(projectDir, "asset-manifest.json"));
    script = readJson(path.join(projectDir, "scene-script.json"));
    const regPath = path.join(projectDir, "continuity-registry.json");
    if (fs.existsSync(regPath)) registry = readJson(regPath);
  } catch (e) {
    console.error(`IO error: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const platform = script && typeof script.platform === "string" ? script.platform : null;
  if (!platform) {
    console.error("IO error: scene-script.json has no platform");
    process.exitCode = 1;
    return;
  }
  const requiredAssetIds = Array.isArray(manifest.assets)
    ? manifest.assets.filter((a) => a && a.required === true).map((a) => a.assetId).filter((x) => typeof x === "string")
    : [];

  let preflight;
  try {
    preflight = runPreflight({
      projectRoot: PROJECT_ROOT,
      projectId,
      platform,
      assetManifest: manifest,
      sceneScript: script,
      continuityRegistry: registry,
      requiredAssetIds,
      fps: null
    });
  } catch (e) {
    console.error(`preflight error: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const outDir = path.join(projectDir, "preflight");
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "media-preflight.json"), JSON.stringify(preflight, null, 2));
  } catch (e) {
    console.error(`IO error writing preflight output: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  if (args.fixSafe) {
    try {
      const normalizations = [];
      for (const a of preflight.assets) {
        if (a && a.normalizationPlan && a.normalizationPlan.suggestedPath) {
          normalizations.push({ assetId: a.assetId, from: a.path, to: a.normalizationPlan.suggestedPath });
        }
      }
      fs.writeFileSync(
        path.join(outDir, "path-normalization.json"),
        JSON.stringify({ version: "1.0.0", projectId, generatedAt: new Date().toISOString(), normalizations }, null, 2)
      );
      const entries = {};
      for (const a of Array.isArray(manifest.assets) ? manifest.assets : []) {
        if (!a || typeof a.path !== "string" || !a.path) continue;
        let abs = null;
        try {
          abs = resolveProjectPath(PROJECT_ROOT, projectId, a.path).abs;
        } catch {
          continue;
        }
        try {
          if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        } catch {
          continue;
        }
        try {
          entries[a.assetId] = mediaProbe.probe(abs);
        } catch {
          entries[a.assetId] = { metadata: null, status: "UNKNOWN", evidence: { source: "UNKNOWN", measuredAt: new Date().toISOString() } };
        }
      }
      fs.writeFileSync(
        path.join(outDir, "metadata-cache.json"),
        JSON.stringify({ version: "1.0.0", projectId, generatedAt: new Date().toISOString(), entries }, null, 2)
      );
    } catch (e) {
      console.error(`IO error writing --fix-safe outputs: ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(preflight, null, 2) + "\n");
  } else {
    const rel = forwardSlashes(path.join("projects", projectId, "preflight", "media-preflight.json"));
    process.stdout.write(`media-preflight ${preflight.status} for ${projectId}: ${rel}\n`);
    process.stdout.write(`assets=${preflight.timelineSummary.assetCount} ready=${preflight.timelineSummary.readyCount} required=${preflight.timelineSummary.requiredCount} missingRequired=${preflight.timelineSummary.missingRequired} blocking=${preflight.blockingIssues.length} warnings=${preflight.warnings.length}\n`);
  }

  process.exitCode = preflight.status === "READY" ? 0 : preflight.status === "BLOCKED" ? 2 : 3;
}

if (require.main === module) {
  main();
}

module.exports = {};
