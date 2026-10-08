"use strict";

/**
 * Phase 4B §8–§10, §19 — RenderJob + Render Preflight (UNFOLDIQ CORE).
 *
 * Preflight validates the whole approved state BEFORE expensive render:
 * assets, gaps, currency (audio/alignment/captions/timeline/motion/
 * overrides/variant/packaging/rights), mapping support, hard safety.
 * Preflight fail → DO NOT RENDER. Job records resolved options + versions
 * for reproducibility; retry reuses by input hash (no duplicate artifacts).
 */

const crypto = require("crypto");
const mapping = require("./mapping-registry.js");

const JOB_VERSION = "1.0.0";

function sha12(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 12);
}
function nowIso() { return new Date().toISOString(); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function finding(code, extra = {}) {
  return { code, severity: extra.severity || "BLOCK", reason: extra.reason || code, correctiveAction: extra.correctiveAction || null, evidenceRefs: extra.evidenceRefs || [] };
}

/**
 * Run render preflight. inputs: { projectId, timelineManifest, motionPlan,
 *   overrideRecords?, responsiveVariant?, captionArtifact?, finalAudioArtifact?,
 *   alignmentArtifact?, assetResolver, selectedPackaging?, rightsComplete?,
 *   exportProfileRef, compositionId?, rendererVersions? }
 */
function runPreflight(inputs = {}) {
  const findings = [];
  const man = inputs.timelineManifest;
  if (!man || !Array.isArray(man.items)) {
    return { ok: false, status: "PREFLIGHT_FAILED", findings: [finding("RENDER_PREFLIGHT_FAIL", { reason: "timeline manifest missing" })] };
  }
  // Assets resolve, current, no placeholder/missing.
  const resolve = inputs.assetResolver || (() => null);
  for (const item of man.items) {
    if (!item.assetId) continue;
    const asset = resolve(item.assetId);
    if (!asset || !asset.hash) {
      findings.push(finding("MISSING_ASSET_RENDERED", { reason: `timeline item ${item.timelineItemId} asset ${item.assetId} unresolvable` }));
    } else if (/placeholder/i.test(item.assetId) || asset.placeholder === true) {
      findings.push(finding("PLACEHOLDER_RENDERED", { reason: `placeholder asset ${item.assetId} on ${item.timelineItemId}` }));
    }
    if (asset && inputs.assetHashes && inputs.assetHashes[item.assetId] && inputs.assetHashes[item.assetId] !== asset.hash) {
      findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: `stale asset ${item.assetId}` }));
    }
  }
  // Unresolved required visual gaps (from motion plan coverage).
  const plan = inputs.motionPlan;
  if (plan && plan.coverage && Array.isArray(plan.coverage.ranges)) {
    for (const r of plan.coverage.ranges) {
      if (r.status === "UNRESOLVED_REQUIRED_GAP") {
        findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: `unresolved required visual gap [${r.startFrame}, ${r.endFrameExclusive})` }));
      }
    }
  }
  // Currency: narration timing hash must match across audio/alignment/timeline.
  const fa = inputs.finalAudioArtifact;
  const al = inputs.alignmentArtifact;
  if (fa && man.sourceTiming && man.sourceTiming.narrationTimingHash && fa.narrationTimingHash
    && fa.narrationTimingHash !== man.sourceTiming.narrationTimingHash) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: "Final Audio narration timing differs from timeline source timing" }));
  }
  if (al && fa && al.narrationTimingHash && fa.narrationTimingHash && al.narrationTimingHash !== fa.narrationTimingHash) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: "alignment built against different narration timing" }));
  }
  if (inputs.captionArtifact && inputs.captionArtifact.stale === true) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: "caption artifact stale" }));
  }
  // Motion plan revision matches timeline.
  if (plan && man.revision !== undefined && plan.timelineRevision !== man.revision) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: `motion plan rev ${plan.timelineRevision} ≠ timeline rev ${man.revision}` }));
  }
  // Variant currency.
  if (inputs.responsiveVariant && man.revision !== undefined
    && inputs.responsiveVariant.sourceTimelineRevision !== man.revision) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: "responsive variant stale vs timeline" }));
  }
  // Mapping support (Case B path).
  if (plan) {
    const chk = mapping.checkPlanRenderable(plan);
    for (const u of chk.unsupported) {
      findings.push(finding("UNSUPPORTED_RENDER_MAPPING", { reason: `${u.primitiveRef} on ${u.timelineItemId || u.transitionId}: ${u.reason}` }));
    }
  }
  // Packaging selection + rights currency.
  if (inputs.selectedPackaging && !inputs.selectedPackaging.selectedVariantId) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: "no packaging variant selected" }));
  }
  if (inputs.rightsComplete === false) {
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: "rights/provenance incomplete" }));
  }
  // Hard safety gates from plan QA must not be FAIL.
  if (plan && plan.qa && plan.qa.status === "FAIL") {
    const blocks = (plan.qa.findings || []).filter((f) => f.severity === "BLOCK").map((f) => f.code);
    findings.push(finding("RENDER_PREFLIGHT_FAIL", { reason: `motion plan QA FAIL: ${blocks.join(",") || "blocked"}` }));
  }
  const blocks = findings.filter((f) => f.severity === "BLOCK");
  return { ok: blocks.length === 0, status: blocks.length ? "PREFLIGHT_FAILED" : "READY", findings };
}

function buildRenderJob(inputs = {}, preflight = null) {
  const man = inputs.timelineManifest;
  const pf = preflight || runPreflight(inputs);
  const job = {
    renderJobId: `rj-${sha12({ p: inputs.projectId, t: man && man.timelineId, rev: man && man.revision, prof: inputs.exportProfileRef })}`,
    version: JOB_VERSION,
    projectId: inputs.projectId,
    timelineId: (man && (man.timelineId || man.projectId)) || inputs.projectId,
    timelineRevision: (man && man.revision) || 0,
    motionPlanVersion: (inputs.motionPlan && inputs.motionPlan.version) || "unknown",
    overrideRevision: inputs.overrideRevision || 0,
    responsiveVariantId: (inputs.responsiveVariant && inputs.responsiveVariant.variantId) || null,
    responsiveVariantRevision: (inputs.responsiveVariant && inputs.responsiveVariant.revision) || 0,
    captionArtifactRef: (inputs.captionArtifact && inputs.captionArtifact.artifactId) || null,
    finalAudioArtifactRef: (inputs.finalAudioArtifact && inputs.finalAudioArtifact.artifactId) || null,
    exportProfileRef: inputs.exportProfileRef,
    renderer: {
      engine: "REMOTION",
      version: (inputs.rendererVersions && inputs.rendererVersions.remotion) || null,
      nodeVersion: process.version,
      entryPoint: "remotion/src/index.ts",
      compositionId: inputs.compositionId || "UNFOLDIQVideo",
    },
    resolvedOptions: inputs.resolvedOptions || {},
    inputHashes: inputs.inputHashes || {},
    status: pf.ok ? "PENDING" : "PREFLIGHT_FAILED",
    preflight: { status: pf.status, findings: pf.findings },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return { ok: pf.ok, job, preflight: pf };
}

module.exports = { JOB_VERSION, runPreflight, buildRenderJob };
