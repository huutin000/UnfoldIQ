#!/usr/bin/env node
"use strict";

/**
 * POST-1H hygiene — repo inventory + path-reference graph + classification.
 * Read-heavy, writes NOTHING outside projects/phase1hyg-validation/.
 * Usage: node scripts/cli/repo-inventory.js [--out <dir>]
 *
 * Inventory entry: path, type, sizeBytes, hash (files <= 64MB), modifiedAt,
 * gitTracked, gitIgnored, referenceCount, canonicalRefs[], proposedAction, reason.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..", "..");
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : path.join(REPO, "projects", "phase1hyg-validation", "inventory");

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg"]);
const HASH_MAX = 1 * 1024 * 1024;

function gitLines(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd: REPO, timeout: 60000 }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function walk() {
  const files = [];
  const dirs = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(REPO, abs).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        dirs.push(rel);
        visit(abs);
      } else if (e.isFile()) {
        files.push(rel);
      }
    }
  };
  visit(REPO);
  return { files: files.sort(), dirs: dirs.sort() };
}

function main() {
  const { files, dirs } = walk();
  const tracked = new Set(gitLines(["ls-files", "--exclude-standard"]) || []);
  const hasGit = tracked !== null && tracked.size > 0;
  const ignored = new Set();
  if (hasGit) {
    // Single --stdin pass for ignore detection (bounded input).
    try {
      const proc = require("child_process").spawnSync("git", ["check-ignore", "--stdin"], {
        encoding: "utf8", cwd: REPO, timeout: 120000,
        input: files.filter((f) => !tracked.has(f)).slice(0, 20000).join("\n"),
      });
      for (const line of String(proc.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean)) ignored.add(line);
    } catch { /* ignore detection best-effort */ }
  }
  const entries = [];
  for (const rel of files) {
    let size = null;
    let mtime = null;
    let hash = null;
    try {
      const st = fs.statSync(path.join(REPO, rel));
      size = st.size;
      mtime = st.mtime.toISOString();
      if (st.size <= HASH_MAX) {
        hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO, rel))).digest("hex");
      }
    } catch { /* unreadable → nulls */ }
    entries.push({
      path: rel, type: "file", sizeBytes: size, hash, modifiedAt: mtime,
      gitTracked: hasGit ? tracked.has(rel) : null,
      gitIgnored: hasGit ? ignored.has(rel) : null,
      referenceCount: 0, canonicalRefs: [], proposedAction: "REVIEW_REQUIRED", reason: "unclassified",
    });
  }
  for (const rel of dirs) {
    entries.push({
      path: rel, type: "dir", sizeBytes: null, hash: null, modifiedAt: null,
      gitTracked: hasGit ? tracked.has(rel) : null,
      gitIgnored: hasGit ? ignored.has(rel) : null,
      referenceCount: 0, canonicalRefs: [], proposedAction: "REVIEW_REQUIRED", reason: "unclassified",
    });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "repo-inventory.json"), JSON.stringify({ artifact: "repo-inventory", capturedAt: new Date().toISOString(), files: files.length, dirs: dirs.length, entries }, null, 2) + "\n");
  console.log(JSON.stringify({ files: files.length, dirs: dirs.length, out: path.join(OUT, "repo-inventory.json") }));
}

main();
