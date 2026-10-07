#!/usr/bin/env node
"use strict";

/**
 * PHASE 2.1 — voice-bible CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   voice-bible.js create  --project <pid> --file <input.json> [--attach-manifest] [--register-dag]
 *   voice-bible.js validate --project <pid> [--id vb-xxxxxxxxxxxx]
 *   voice-bible.js show    --project <pid> [--id vb-xxxxxxxxxxxx] [--field a.b.c] [--catalog]
 *   voice-bible.js list    --project <pid>
 *   voice-bible.js revise  --project <pid> --file <patch.json> [--attach-manifest]
 *   voice-bible.js perf    --project <pid> [--iterations N]
 *
 * `create` never invents a voice: the input file must declare the provider /
 * model / voiceId / language and its provenance source. An unapproved or
 * unproven selection is reported as NOT production-ready, not silently fixed.
 */

const fs = require("fs");
const path = require("path");
const vb = require("../../lib/voice-bible/index.js");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function flag(name) {
  return process.argv.includes(name);
}

function out(result, okCode = 0) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? okCode : 2);
}

function field(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

function readJson(file) {
  if (!file) return { ok: false, code: "VOICE_BIBLE_SCHEMA_INVALID", message: "--file <path> is required" };
  const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { ok: false, code: "VOICE_BIBLE_SCHEMA_INVALID", message: `unreadable input file ${file}: ${String((e && e.message) || e)}` };
  }
}

const cmd = process.argv[2];
const projectId = arg("--project", null);
if (!cmd || !projectId) {
  console.error("usage: voice-bible.js create|validate|show|list|revise|perf --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "create") {
    const input = readJson(arg("--file", null));
    if (!input.ok) out(input);
    const created = vb.createVoiceBible(ROOT, projectId, input.data);
    if (!created.ok) out(created);
    const steps = { created };
    if (flag("--register-dag")) steps.dag = vb.registerDagNode(ROOT, projectId, created.voiceBible.voiceBibleId);
    if (flag("--attach-manifest")) steps.manifest = vb.attachManifestReference(ROOT, projectId, created.voiceBible.voiceBibleId);
    out({
      ok: true,
      changed: created.changed,
      voiceBibleId: created.voiceBible.voiceBibleId,
      version: created.voiceBible.version,
      rel: created.rel,
      lifecycleClass: created.lifecycleClass || "DURABLE",
      readiness: created.readiness,
      steps,
    });
  } else if (cmd === "validate") {
    const id = arg("--id", null);
    const target = id ? vb.loadVoiceBible(ROOT, projectId, id) : vb.latestVoiceBible(ROOT, projectId);
    if (!target.ok) out(target);
    const v = vb.validateVoiceBible(target.voiceBible);
    out({
      ok: v.ok,
      voiceBibleId: target.voiceBible.voiceBibleId,
      version: target.voiceBible.version,
      semanticFingerprint: vb.semanticFingerprint(target.voiceBible),
      fingerprint: target.voiceBible.fingerprint,
      readiness: target.readiness,
      errors: v.errors,
    });
  } else if (cmd === "show") {
    if (flag("--catalog")) {
      out({ ok: true, v1Provider: vb.V1_TTS_PROVIDER, v1Model: vb.V1_TTS_MODEL, catalog: vb.providerCatalog() });
    }
    const id = arg("--id", null);
    const target = id ? vb.loadVoiceBible(ROOT, projectId, id) : vb.latestVoiceBible(ROOT, projectId);
    if (!target.ok) out(target);
    const f = arg("--field", null);
    out({ ok: true, readiness: target.readiness, voiceBible: f ? field(target.voiceBible, f) : target.voiceBible });
  } else if (cmd === "list") {
    out(vb.listVoiceBibles(ROOT, projectId));
  } else if (cmd === "revise") {
    const input = readJson(arg("--file", null));
    if (!input.ok) out(input);
    const revised = vb.reviseVoiceBible(ROOT, projectId, input.data);
    if (!revised.ok) out(revised);
    const steps = { revised };
    if (flag("--attach-manifest")) steps.manifest = vb.attachManifestReference(ROOT, projectId, revised.voiceBible.voiceBibleId);
    out({
      ok: true,
      changed: revised.changed,
      voiceBibleId: revised.voiceBible.voiceBibleId,
      version: revised.voiceBible.version,
      previousVersion: revised.previousVersion,
      rel: revised.rel,
      readiness: revised.readiness,
      steps,
    });
  } else if (cmd === "perf") {
    out(vb.measureBaseline(ROOT, projectId, { iterations: Number(arg("--iterations", "20")) }));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}