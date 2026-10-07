#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.2 — history/lock CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   history.js create --project PID
 *   history.js validate --project PID
 *   history.js show --project PID                        (projection)
 *   history.js migrate --project PID                      (1G bootstrap)
 *   history.js record-gen --project PID --id gen-H --job J --attempt A --status S [--shot X --scene Y --asset AID ...]
 *   history.js complete-gen --project PID --id gen-H --status SUCCEEDED|FAILED|CANCELLED [--asset AID]
 *   history.js record-variant --project PID --id var-H --target TYPE:ID --gen gen-H [--asset AID]
 *   history.js decide --project PID --target TYPE:ID --decision APPROVED|REJECTED --reason R --evidence ref1,ref2 [--variant var-H] [--actor operator] [--no-lock]
 *   history.js select-variant --project PID --id var-H
 *   history.js lock --project PID --target TYPE:ID [--reason R]
 *   history.js unlock --project PID --target TYPE:ID --reason R --lock-version N
 *   history.js check --project PID --target TYPE:ID [--action rerun]
 *   history.js select-asset --project PID --id as-H --reason R
 *   history.js divergence --project PID
 *   history.js voice --project PID --paragraph P
 */

const path = require("path");
const hist = require("../../lib/generation-history/index.js");
const migrate = require("../../lib/generation-history/migrate.js");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function out(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

function target(s) {
  const i = (s || "").indexOf("::");
  if (i < 0) {
    const j = (s || "").indexOf(":");
    if (j < 0) return null;
    return { targetType: s.slice(0, j), targetId: s.slice(j + 1) };
  }
  return { targetType: s.slice(0, i), targetId: s.slice(i + 2) };
}

function baseOpts() {
  const exp = arg("--expected-revision", null);
  return { expectedRevision: exp === null ? null : Number(exp), actor: arg("--actor", null), now: arg("--now", null) };
}

const cmd = process.argv[2];
const projectId = arg("--project", null);
if (!cmd || !projectId) {
  console.error("usage: history.js <command> --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "create") {
    out(hist.createHistoryStore(ROOT, projectId));
  } else if (cmd === "validate") {
    const r = hist.loadHistory(ROOT, projectId);
    out(r.ok
      ? { ok: true, revision: r.store.revision, generations: Object.keys(r.store.generations).length, variants: Object.keys(r.store.variants).length, decisions: Object.keys(r.store.decisions).length, locks: Object.keys(r.store.locks).length, fingerprint: r.store.fingerprint }
      : r);
  } else if (cmd === "show") {
    out(hist.projectHistory(ROOT, projectId));
  } else if (cmd === "migrate") {
    const assetLib = require("../../lib/asset-library/index.js");
    out(migrate.bootstrapHistory(ROOT, projectId, { assetLib }));
  } else if (cmd === "record-gen") {
    out(hist.recordGeneration(ROOT, projectId, {
      generationId: arg("--id"), jobId: arg("--job"), attemptId: arg("--attempt"),
      shotId: arg("--shot", null), sceneId: arg("--scene", null), segmentId: arg("--segment", null),
      generationUnitId: arg("--unit", null), provider: arg("--provider", null), model: arg("--model", null),
      modelResolutionRef: arg("--resolution", null), promptVersion: arg("--prompt", null),
      status: arg("--status", "SUBMITTED"),
      resultAssetIds: arg("--asset", null) ? [arg("--asset")] : [],
      retryOf: arg("--retry-of", null), provenance: "LIVE",
    }, baseOpts()));
  } else if (cmd === "complete-gen") {
    out(hist.completeGeneration(ROOT, projectId, arg("--id"), {
      status: arg("--status"),
      resultAssetIds: arg("--asset", null) ? [arg("--asset")] : undefined,
    }, baseOpts()));
  } else if (cmd === "record-variant") {
    const t = target(arg("--target", ""));
    if (!t) { console.error("--target TYPE:ID required"); process.exit(2); }
    out(hist.recordVariant(ROOT, projectId, {
      variantId: arg("--id"), targetType: t.targetType, targetId: t.targetId,
      generationId: arg("--gen"), assetId: arg("--asset", null),
    }, baseOpts()));
  } else if (cmd === "decide") {
    const t = target(arg("--target", ""));
    if (!t) { console.error("--target TYPE:ID required"); process.exit(2); }
    out(hist.recordDecision(ROOT, projectId, {
      targetType: t.targetType, targetId: t.targetId,
      variantId: arg("--variant", null), decision: arg("--decision"),
      reason: arg("--reason", ""), evidenceRefs: (arg("--evidence", "") || "").split(",").filter(Boolean),
      actorType: arg("--actor-type", "operator"), provenance: "LIVE",
    }, { ...baseOpts(), lockOnApprove: arg("--no-lock", null) === null }));
  } else if (cmd === "select-variant") {
    out(hist.selectVariant(ROOT, projectId, arg("--id"), baseOpts()));
  } else if (cmd === "lock") {
    const t = target(arg("--target", ""));
    if (!t) { console.error("--target TYPE:ID required"); process.exit(2); }
    out(hist.lockTarget(ROOT, projectId, { ...t, reason: arg("--reason", null) }, baseOpts()));
  } else if (cmd === "unlock") {
    const t = target(arg("--target", ""));
    if (!t) { console.error("--target TYPE:ID required"); process.exit(2); }
    out(hist.unlockTarget(ROOT, projectId, { ...t, reason: arg("--reason", ""), expectedLockVersion: Number(arg("--lock-version", "NaN")) }, baseOpts()));
  } else if (cmd === "check") {
    const t = target(arg("--target", ""));
    if (!t) { console.error("--target TYPE:ID required"); process.exit(2); }
    out(hist.checkRerunAllowed(ROOT, projectId, { ...t, action: arg("--action", "rerun") }));
  } else if (cmd === "select-asset") {
    const assetLib = require("../../lib/asset-library/index.js");
    out(hist.selectAssetWithHistory(ROOT, projectId, arg("--id"), { reason: arg("--reason", "cli selection") }, baseOpts(), assetLib));
  } else if (cmd === "divergence") {
    const assetLib = require("../../lib/asset-library/index.js");
    out(hist.detectLockDivergence(ROOT, projectId, assetLib));
  } else if (cmd === "voice") {
    out(hist.voiceParagraphState(ROOT, projectId, arg("--paragraph", "")));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
