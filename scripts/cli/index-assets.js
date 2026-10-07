"use strict";

/**
 * UNFOLDIQ asset indexer CLI (1G.10 Stage B).
 * Indexes real existing media files of one project into its asset library
 * (content-hash dedup: re-runs never duplicate).
 *
 * CLI:
 *   node scripts/cli/index-assets.js --project postv1b-flow-companion-live [--dir assets] [--role OTHER]
 */

const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const { indexDirectory } = require("../../lib/asset-library/index.js");

function parseArgs(argv) {
  const out = { project: null, dir: "assets", role: "OTHER" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--project" && argv[i + 1]) out.project = String(argv[++i]);
    else if (argv[i] === "--dir" && argv[i + 1]) out.dir = String(argv[++i]);
    else if (argv[i] === "--role" && argv[i + 1]) out.role = String(argv[++i]).toUpperCase();
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.project) {
    console.error("USAGE: node scripts/cli/index-assets.js --project <projectId> [--dir assets] [--role OTHER]");
    process.exit(2);
  }
  const summary = indexDirectory(ROOT, args.project, args.dir, { source: "migration", roleDefault: args.role });
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();
