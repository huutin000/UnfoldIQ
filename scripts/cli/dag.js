#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.3 — dependency-DAG CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   dag.js create --project PID
 *   dag.js validate --project PID
 *   dag.js show --project PID [--field nodes.KEY]
 *   dag.js bootstrap --project PID
 *   dag.js add-node --project PID --key K --type T [--version V --state S --input K1,K2 --lock TYPE:ID]
 *   dag.js add-edge --project PID --from UP --to DOWN [--type T]
 *   dag.js set-version --project PID --key K --version V
 *   dag.js set-state --project PID --key K --state S
 *   dag.js mark-dirty --project PID --key K [--reason R]
 *   dag.js plan --project PID
 *   dag.js rerun --project PID --from K --set-version V   (simulated executor: marks rebuilt with V)
 */

const path = require("path");
const dag = require("../../lib/dependency-dag/index.js");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function out(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

function field(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

const cmd = process.argv[2];
const projectId = arg("--project", null);
if (!cmd || !projectId) {
  console.error("usage: dag.js <command> --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "create") {
    out(dag.createDag(ROOT, projectId));
  } else if (cmd === "validate") {
    const r = dag.loadDag(ROOT, projectId);
    out(r.ok
      ? { ok: true, revision: r.dag.revision, nodes: Object.keys(r.dag.nodes).length, fingerprint: r.dag.fingerprint }
      : r);
  } else if (cmd === "show") {
    const r = dag.loadDag(ROOT, projectId);
    if (!r.ok) out(r);
    const f = arg("--field", null);
    out({ ok: true, dag: f ? field(r.dag, f) : r.dag });
  } else if (cmd === "bootstrap") {
    out(dag.bootstrapDag(ROOT, projectId));
  } else if (cmd === "add-node") {
    const inputs = (arg("--input", "") || "").split(",").filter(Boolean).map((key) => ({ key }));
    const lock = arg("--lock", null);
    let lockTarget = null;
    if (lock) {
      const i = lock.indexOf(":");
      lockTarget = { targetType: lock.slice(0, i), targetId: lock.slice(i + 1) };
    }
    out(dag.addNode(ROOT, projectId, {
      artifactKey: arg("--key"), artifactType: arg("--type"),
      versionRef: arg("--version", null), state: arg("--state", "NOT_CREATED_YET"),
      inputRefs: inputs, lockTarget, provenance: "LIVE",
    }));
  } else if (cmd === "add-edge") {
    out(dag.addDependency(ROOT, projectId, arg("--from"), arg("--to"), arg("--type", null)));
  } else if (cmd === "set-version") {
    out(dag.setNodeVersion(ROOT, projectId, arg("--key"), arg("--version")));
  } else if (cmd === "set-state") {
    out(dag.setNodeState(ROOT, projectId, arg("--key"), arg("--state")));
  } else if (cmd === "mark-dirty") {
    out(dag.markDirty(ROOT, projectId, arg("--key"), { reason: arg("--reason", null) }));
  } else if (cmd === "plan") {
    out(dag.planRebuild(ROOT, projectId));
  } else if (cmd === "rerun") {
    const version = arg("--set-version", "rebuilt");
    out(dag.rerunBranch(ROOT, projectId, arg("--from"), () => ({ ok: true, versionRef: version })));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
