"use strict";

/**
 * Phase 1G.10 — real existing-asset indexer (migration + ongoing).
 * Walks a project directory, measures what is measurable locally, and
 * registers every media file through the canonical registry (hash dedup
 * applies: re-runs never duplicate).Entry point for legacy migration:
 * pre-existing files are recorded with honest UNKNOWN rights and a
 * migration provenance note — origins are NOT invented.
 */

const fs = require("fs");
const path = require("path");
const registry = require("./registry.js");
const mediaProbe = require("../media-probe.js");

const MEDIA_EXTS = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mp3": "audio",
  ".wav": "audio",
  ".ogg": "audio",
};

const SKIP_NAMES = new Set(["library-index.json"]);
const SKIP_EXTS = new Set([".json", ".md", ".tmp", ".log"]);

function projectDir(root, projectId) {
  return path.join(root, "projects", projectId);
}

function isInside(dir, abs) {
  const rel = path.relative(dir, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function measurePng(abs, buf) {
  try {
    const info = mediaProbe.parsePngHeader(buf);
    if (info && Number.isInteger(info.width) && Number.isInteger(info.height)) {
      return { width: info.width, height: info.height };
    }
  } catch { /* measured-only: unknown on any failure */ }
  void abs;
  return null;
}

/**
 * indexDirectory(root, projectId, relDir, opts) → summary.
 * opts: { source ("migration"|"existing"), roleDefault, provider,
 *   jobIdForProbe?, recursive=true, rightsNote }
 */
function indexDirectory(root, projectId, relDir, opts = {}) {
  const summary = { projectId, dir: relDir, indexed: 0, deduplicated: 0, skipped: [], errors: [] };
  const base = path.join(projectDir(root, projectId), relDir);
  let entries = [];
  const walk = (dir) => {
    let kids = [];
    try {
      kids = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      summary.errors.push(`${path.relative(projectDir(root, projectId), dir) || "."}: ${e.message}`);
      return;
    }
    for (const k of kids) {
      const abs = path.join(dir, k.name);
      if (k.isDirectory()) {
        if (opts.recursive !== false) walk(abs);
        continue;
      }
      if (k.isFile()) entries.push(abs);
    }
  };
  if (!fs.existsSync(base)) {
    summary.errors.push(`${relDir}: directory not found`);
    return summary;
  }
  walk(base);
  for (const abs of entries) {
    const rel = path.relative(projectDir(root, projectId), abs).replace(/\\/g, "/");
    if (SKIP_NAMES.has(path.basename(abs))) {
      summary.skipped.push({ rel, reason: "library own file" });
      continue;
    }
    const ext = path.extname(abs).toLowerCase();
    if (!MEDIA_EXTS[ext] || SKIP_EXTS.has(ext)) {
      summary.skipped.push({ rel, reason: "non-media" });
      continue;
    }
    let buf = null;
    try {
      buf = fs.readFileSync(abs);
    } catch (e) {
      summary.errors.push(`${rel}: ${e.message}`);
      continue;
    }
    if (!isInside(projectDir(root, projectId), abs)) {
      summary.errors.push(`${rel}: outside project dir`);
      continue;
    }
    const type = MEDIA_EXTS[ext];
    const dimensions = ext === ".png" ? measurePng(abs, buf) : null;
    const r = registry.registerAsset(root, projectId, {
      bytes: buf,
      type,
      role: opts.roleDefault || "OTHER",
      source: opts.source || "migration",
      provider: opts.provider || null,
      relativePath: rel,
      dimensions,
      durationMs: null,
      rights: { status: "UNKNOWN", note: opts.rightsNote || "pre-existing file indexed by migration; origin and license unverified" },
      provenance: { source: "migration", detail: `pre-existing file at ${rel}` },
      referenceIds: [],
      derivedFrom: [],
    });
    if (!r.ok) {
      summary.errors.push(`${rel}: ${r.code}`);
      continue;
    }
    if (r.deduplicated) summary.deduplicated += 1;
    else summary.indexed += 1;
  }
  return summary;
}

module.exports = { MEDIA_EXTS, indexDirectory };
