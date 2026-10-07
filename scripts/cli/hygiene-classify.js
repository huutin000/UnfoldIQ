#!/usr/bin/env node
"use strict";

/**
 * POST-1H hygiene — path-reference graph + classification (read-only).
 * Reads inventory + scans bounded text files for path references.
 * Writes: reference-graph.json, classification.json
 * Usage: node scripts/cli/hygiene-classify.js
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const INV_DIR = path.join(REPO, "projects", "phase1hyg-validation", "inventory");

const SCAN_EXT = new Set([".json", ".js", ".mjs", ".md", ".yaml", ".yml", ".html", ".css", ".txt", ".srt", ".vtt"]);
const SCAN_MAX = 2 * 1024 * 1024;
const SKIP_TOP = new Set(["node_modules", ".git"]);

function textFiles() {
  const out = [];
  const visit = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(REPO, abs).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (SKIP_TOP.has(e.name)) continue;
        if (rel.startsWith("research/") && /venv|env|__pycache__|\.venv/.test(e.name)) continue;
        visit(abs);
      } else if (e.isFile() && SCAN_EXT.has(path.extname(e.name).toLowerCase())) {
        try {
          if (fs.statSync(abs).size <= SCAN_MAX) out.push(rel);
        } catch { /* skip */ }
      }
    }
  };
  visit(REPO);
  return out;
}

function main() {
  const inv = JSON.parse(fs.readFileSync(path.join(INV_DIR, "repo-inventory.json"), "utf8"));
  const byPath = new Map(inv.entries.map((e) => [e.path, e]));
  const files = textFiles();
  console.log(JSON.stringify({ scannedTextFiles: files.length }));
  const refCounts = new Map();
  const refSources = new Map(); // path -> [source files...] (bounded 5)
  const tokenRe = /(projects\/[A-Za-z0-9_.\-+/]+|Report\/[A-Za-z0-9_.\-+/]+|golden\/[A-Za-z0-9_.\-+/]+|out\/[A-Za-z0-9_.\-+/]+|tests\/[A-Za-z0-9_.\-+/]+|schemas\/[A-Za-z0-9_.\-+/]+)/g;
  for (const rel of files) {
    let text = "";
    try { text = fs.readFileSync(path.join(REPO, rel), "utf8"); } catch { continue; }
    const seen = new Set();
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      const tok = m[1].replace(/[),;"']+$/, "");
      if (seen.has(tok)) continue;
      seen.add(tok);
      // Exact file hit or dir-prefix hit.
      const targets = [];
      if (byPath.has(tok)) targets.push(tok);
      const parts = tok.split("/");
      for (let i = parts.length - 1; i >= 1; i--) {
        const dir = parts.slice(0, i).join("/");
        if (byPath.has(dir)) { targets.push(dir); break; }
      }
      for (const t of targets) {
        refCounts.set(t, (refCounts.get(t) || 0) + 1);
        if ((refSources.get(t) || []).length < 5) {
          refSources.set(t, [...(refSources.get(t) || []), rel]);
        }
      }
    }
  }
  // Canonical stores count as references for anything they point at.
  const graph = { capturedAt: new Date().toISOString(), nodes: [] };
  for (const [p, count] of refCounts) {
    graph.nodes.push({ path: p, referenceCount: count, sources: refSources.get(p) || [] });
  }
  graph.nodes.sort((a, b) => b.referenceCount - a.referenceCount);
  fs.writeFileSync(path.join(INV_DIR, "reference-graph.json"), JSON.stringify(graph, null, 2) + "\n");

  // ---- classification ----
  const KEEP_DIRS = ["lib", "core", "scripts", "schemas", "tests", "providers", "pipeline", "qa", "platforms", "policy", "golden", "remotion", "mcp", "docs", "context", "brand", "assets", ".agents"];
  const KEEP_FILES = ["package.json", "package-lock.json", ".gitignore", "AGENTS.md", "start-flow.ps1", ".env.example", "playwright.config.js", "opencode.json"];
  const REGENERABLE_RE = /(^|\/)(node_modules|\.venv|venv|__pycache__|\.turbo|\.next|dist)\//;
  const PLAYWRIGHT_GEN_RE = /^playwright-report\/|^test-results\/|\.playwright-cli\//;
  const classified = [];
  for (const e of inv.entries) {
    const p = e.path;
    const refs = refCounts.get(p) || 0;
    let action = "REVIEW_REQUIRED";
    let reason = refs > 0 ? `referenced by ${refs} file(s)` : "no rule matched; human decides";
    const top = p.split("/")[0];
    if (e.type === "dir") {
      if (KEEP_DIRS.includes(top) || top === "projects" || top === "Report" || top === "research" || top === "flow-companion" || top === "out" || top === ".opencode" || top === ".agents") {
        action = "KEEP"; reason = "canonical source/data/tooling area (judged per contained files)";
      } else if (REGENERABLE_RE.test(p + "/")) { action = "LOCAL_REGENERABLE"; reason = "dependency/env/build output regenerable from lockfiles/sources"; }
      else if (PLAYWRIGHT_GEN_RE.test(p + "/") || top === ".playwright") { action = "LOCAL_REGENERABLE"; reason = "generated test-runner output"; }
    } else {
      const base = p.split("/").pop();
      if (KEEP_FILES.includes(base) || KEEP_FILES.includes(p)) { action = "KEEP"; reason = "root config/manifest"; }
      else if (top === ".opencode" || top === ".agents") { action = "KEEP"; reason = "agent tooling config"; }
      else if (REGENERABLE_RE.test(p)) { action = "LOCAL_REGENERABLE"; reason = "inside regenerable env/build tree"; }
      else if (PLAYWRIGHT_GEN_RE.test(p)) { action = "LOCAL_REGENERABLE"; reason = "generated test-runner output"; }
      else if (top === "projects" || top === "Report" || top === "golden" || top === "tests" || top === "schemas") {
        action = refs > 0 ? "KEEP" : "KEEP";
        reason = refs > 0 ? `canonical area, ${refs} incoming refs` : "canonical area (KEEP by default; archive only via explicit evidence)";
      } else if (["lib", "core", "scripts", "providers", "pipeline", "qa", "platforms", "policy", "remotion", "flow-companion", "research", "mcp", "docs", "context", "brand", "assets", ".agents", ".opencode"].includes(top)) {
        action = "KEEP"; reason = "source area file";
      } else if (top === "out") {
        action = refs > 0 ? "KEEP" : "REVIEW_REQUIRED"; reason = refs > 0 ? "referenced output" : "unreferenced output — classify content before action";
      }
    }
    e.referenceCount = refs;
    e.canonicalRefs = refSources.get(p) || [];
    e.proposedAction = action;
    e.reason = reason;
    classified.push({ path: p, type: e.type, action, reason, refs });
  }
  fs.writeFileSync(path.join(INV_DIR, "repo-inventory.json"), JSON.stringify({ artifact: "repo-inventory", capturedAt: new Date().toISOString(), files: inv.files, dirs: inv.dirs, entries: inv.entries }, null, 2) + "\n");
  const summary = {};
  for (const c of classified) summary[c.action] = (summary[c.action] || 0) + 1;
  fs.writeFileSync(path.join(INV_DIR, "classification.json"), JSON.stringify({ artifact: "classification", capturedAt: new Date().toISOString(), summary, rules: "KEEP-first; DELETE only with explicit proof (none proposed by default)" }, null, 2) + "\n");
  console.log(JSON.stringify({ summary, graphNodes: graph.nodes.length }));
}

main();
