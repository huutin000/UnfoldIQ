#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.1 — manifest CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   manifest.js create   --project <pid> [--pipeline V] [--content-class C] [--content-mode M] [--status S] [--stage T]
 *   manifest.js validate --project <pid>
 *   manifest.js show     --project <pid> [--field a.b.c]
 *   manifest.js migrate  --project <pid>
 *   manifest.js update   --project <pid> [--artifact KEY --version V --astatus S --ref R --detail D]
 *                                            [--selection MODEL [--resolution-ref R] [--provider P]]
 *                                            [--stage T --status S] [--expected-revision N]
 */

const path = require("path");
const pm = require("../../lib/project-manifest/index.js");
const migrate = require("../../lib/project-manifest/migrate.js");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function out(result, okCode = 0) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? okCode : 2);
}

function field(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

const cmd = process.argv[2];
const projectId = arg("--project", null);
if (!cmd || !projectId) {
  console.error("usage: manifest.js create|validate|show|migrate|update --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "create") {
    out(pm.createProjectManifest({
      root: ROOT, projectId,
      pipelineVersion: arg("--pipeline", null),
      contentClass: arg("--content-class", null),
      contentMode: arg("--content-mode", null),
      state: { stage: arg("--stage", null), status: arg("--status", "DRAFT") },
    }));
  } else if (cmd === "validate") {
    const r = pm.loadProjectManifest(ROOT, projectId);
    out(r.ok
      ? { ok: true, manifestId: r.manifest.manifestId, projectVersion: r.manifest.projectVersion, revision: r.manifest.revision, fingerprint: r.manifest.fingerprint }
      : r);
  } else if (cmd === "show") {
    const r = pm.loadProjectManifest(ROOT, projectId);
    if (!r.ok) out(r);
    const f = arg("--field", null);
    out({ ok: true, manifest: f ? field(r.manifest, f) : r.manifest });
  } else if (cmd === "migrate") {
    const r = migrate.bootstrapProjectManifest(ROOT, projectId);
    out(r);
  } else if (cmd === "update") {
    const patch = {};
    const aKey = arg("--artifact", null);
    if (aKey) {
      patch.artifacts = {
        [aKey]: {
          version: arg("--version", null) === "null" ? null : arg("--version", null),
          status: arg("--astatus", "MIGRATED"),
          ref: arg("--ref", null),
          detail: arg("--detail", null),
        },
      };
    }
    const model = arg("--selection", null);
    if (model) {
      patch.providers = {
        selections: [{
          modelId: model,
          resolutionRef: arg("--resolution-ref", null),
          providerId: arg("--provider", null),
        }],
      };
      // Preserve existing selections (update replaces the set): merge first.
      const cur = pm.loadProjectManifest(ROOT, projectId);
      if (cur.ok) {
        const have = cur.manifest.providers.selections || [];
        const key = (s) => `${s.modelId}||${s.resolutionRef || ""}||${s.providerId || ""}`;
        const merged = new Map(have.map((s) => [key(s), s]));
        for (const s of patch.providers.selections) merged.set(key(s), s);
        patch.providers.selections = [...merged.values()];
      }
    }
    if (arg("--stage", null) !== null || arg("--status", null) !== null) {
      patch.state = {};
      if (arg("--stage", null) !== null) patch.state.stage = arg("--stage", null);
      if (arg("--status", null) !== null) patch.state.status = arg("--status", null);
    }
    const exp = arg("--expected-revision", null);
    out(pm.updateProjectManifest(ROOT, projectId, patch, { expectedRevision: exp === null ? null : Number(exp) }));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
