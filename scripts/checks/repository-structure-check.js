"use strict";

/**
 * Repository structure guard: fails if root contains file patterns that
 * belong in tests/, scripts/, lib/ or Report/. Zero dependencies.
 * Exit 0 = structure OK; 1 = violations found.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

// Root-level .js files are never allowed (code lives in lib/, scripts/,
// tests/, pipeline/, providers/, remotion/, mcp/, qa/, flow-companion/).
// playwright.config.js is canonical root-level tooling config (like package.json).
const FORBIDDEN_ROOT = [/\.(py|mjs|cjs)$/, /^(?!playwright\.config\.js$).*\.js$/];
// Temporary/one-off artifacts anywhere in the repo (excluding heavy dirs).
const FORBIDDEN_ANYWHERE = [/^debug-.*\.js$/i, /^temp-.*\.js$/i, /^_patch_.*\.py$/i, /^_migrate-.*\.js$/i, /^cleanup-inventory\./];

const violations = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isDirectory()) continue;
  for (const re of FORBIDDEN_ROOT) if (re.test(entry.name)) violations.push(`root/${entry.name}`);
}
for (const dir of ["scripts", "tests", "lib", "pipeline", "providers", "mcp", "qa", "remotion", "flow-companion", "core", "context", "policy"]) {
  (function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (["node_modules", ".output"].includes(e.name)) continue;
        walk(path.join(d, e.name));
      } else {
        for (const re of FORBIDDEN_ANYWHERE) if (re.test(e.name)) violations.push(path.relative(ROOT, path.join(d, e.name)).split(path.sep).join("/"));
      }
    }
  })(path.join(ROOT, dir));
}

if (violations.length > 0) {
  console.error("REPOSITORY_STRUCTURE_VIOLATIONS:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("Root-level code belongs in lib/ (shared modules), scripts/{cli,checks,diagnostics,maintenance},");
  console.error("tests/<domain>/ (regression suites), or the domain folder. One-off scripts must be deleted.");
  process.exit(1);
}
console.log("REPOSITORY_STRUCTURE_OK: root clean, no temporary artifacts in source trees.");
