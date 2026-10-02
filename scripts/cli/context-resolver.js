"use strict";

/**
 * UNFOLDIQ context resolver (STEP 09 V2).
 * Resolves canonical stage -> required / conditional / excluded context paths.
 * Reads ROUTES.yaml structure only; never reads full file contents.
 *
 * CLI:
 *   node scripts/cli/context-resolver.js --stage 3A --platform tiktok
 *   node scripts/cli/context-resolver.js --stage 14 --platform youtube
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROUTES_PATH = path.join(__dirname, "..", "..", "context", "ROUTES.yaml");

function parseArgs(argv) {
  const out = { stage: null, platform: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--stage" && argv[i + 1]) out.stage = String(argv[++i]).toUpperCase();
    else if (argv[i] === "--platform" && argv[i + 1]) out.platform = String(argv[++i]).toLowerCase();
  }
  return out;
}

function loadRoutes() {
  const raw = fs.readFileSync(ROUTES_PATH, "utf8");
  return yaml.load(raw);
}

function resolveRoute(stage, platform) {
  const doc = loadRoutes();
  const key = String(stage).toUpperCase();
  const route = doc.routes && doc.routes[key];
  if (!route) {
    return { error: `UNKNOWN_STAGE: ${stage}. Canonical stages: 1-19 plus 3A-3D.` };
  }
  const plat = platform || "<platform>";
  const sub = (p) => String(p).replace("<platform>", plat);
  const required = (route.required || []).map(sub);
  const conditional = (route.conditional || []).map((c) =>
    typeof c === "string" ? { path: sub(c), trigger: "" } : { path: sub(c.path), trigger: c.trigger || "" }
  );
  return {
    stage: key,
    platform: plat,
    required,
    conditional,
    excludedPatterns: doc.excludedFromRuntime || [],
  };
}

module.exports = { resolveRoute, ROUTES_PATH };

if (require.main === module) {
  const { stage, platform } = parseArgs(process.argv);
  if (!stage) {
    console.error("Usage: node scripts/cli/context-resolver.js --stage <1..19|3A|3B|3C|3D> --platform <youtube|tiktok>");
    process.exit(1);
  }
  const result = resolveRoute(stage, platform || "<platform>");
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
