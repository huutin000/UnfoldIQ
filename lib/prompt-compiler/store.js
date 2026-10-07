"use strict";

/**
 * Prompt Package persistence + staleness (1G.4 §31, §33-§35).
 *
 * Layout: projects/<projectId>/prompts/<shotId>/<targetKind>.json (atomic).
 * Statuses: DRAFT | VALID | APPROVED | STALE | BLOCKED. APPROVED packages are
 * locked against silent overwrite (force recompiles only).
 *
 * Targeted staleness: packages store per-shot/scene fingerprints, reference
 * versions, platform composition and adapter versions — only packages whose
 * canonical dependency actually changed become STALE.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const shared = require("./shared.js");

function packageRel(shotId, targetKind) {
  return `prompts/${shotId}/${targetKind}.json`;
}

function persistPromptPackage(root, projectId, pkg) {
  if (!pkg || !pkg.promptPackageId || !pkg.shotId) {
    return { ok: false, code: "PROMPT_PACKAGE_INVALID" };
  }
  const rel = packageRel(pkg.shotId, pkg.targetKind);
  const existing = loadPromptPackage(root, projectId, pkg.shotId, pkg.targetKind);
  if (existing.ok && existing.pkg && existing.pkg.status === "APPROVED" && !pkg._force) {
    return { ok: false, code: "PROMPT_LOCKED", message: "APPROVED package is locked; recompile requires explicit force" };
  }
  try {
    artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(pkg, null, 2));
    return { ok: true, path: `projects/${projectId}/${rel}` };
  } catch (e) {
    return { ok: false, code: "PROMPT_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadPromptPackage(root, projectId, shotId, targetKind) {
  try {
    const rel = packageRel(shotId, targetKind);
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, pkg: null };
    return { ok: true, pkg: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "PROMPT_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function listPromptPackages(root, projectId) {
  const base = path.join(root, "projects", projectId, "prompts");
  const out = [];
  if (!fs.existsSync(base)) return { ok: true, packages: out };
  for (const shotDir of fs.readdirSync(base)) {
    const shotPath = path.join(base, shotDir);
    if (!fs.statSync(shotPath).isDirectory()) continue;
    for (const file of fs.readdirSync(shotPath)) {
      if (!file.endsWith(".json")) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(shotPath, file), "utf8")));
      } catch { /* corrupt files are skipped, never crash */ }
    }
  }
  return { ok: true, packages: out };
}

/**
 * Targeted staleness (§33-§34). A package becomes STALE only when a
 * dependency it actually references changed: its shot, its parent scene, a
 * referenced asset version, the platform composition, or the adapter version.
 * Everything else stays current.
 */
function checkPackageStaleness(pkg, context = {}) {
  const staleReasons = [];
  const sr = (pkg.promptSpec && pkg.promptSpec.sourceRefs) || {};
  const shot = (context.shotPlan && context.shotPlan.shots || []).find((s) => s.shotId === sr.shotId);
  const scene = (context.sceneGraph && context.sceneGraph.scenes || []).find((s) => s.sceneId === sr.sceneId);
  if (!shot || shared.hash16(shot) !== sr.sourceShotFingerprint) staleReasons.push("shot changed");
  if (!scene || shared.hash16(scene) !== sr.sourceSceneFingerprint) staleReasons.push("parent scene changed");
  if (context.adapterVersions && pkg.adapterVersion && context.adapterVersions[pkg.targetKind] && context.adapterVersions[pkg.targetKind] !== pkg.adapterVersion) {
    staleReasons.push("adapter version changed (recompile required)");
  }
  if (context.referenceAssets) {
    const byId = new Map(context.referenceAssets.map((a) => [a.assetId, a]));
    for (const ref of (pkg.promptSpec.referenceRefs || [])) {
      const current = byId.get(ref.assetId);
      if (!current || (current.version || current.hash || null) !== ref.version) {
        staleReasons.push(`reference asset ${ref.assetId} changed`);
      }
    }
  }
  if (context.platformComposition && pkg.generationMetadata && pkg.generationMetadata.platformComposition) {
    const stored = pkg.generationMetadata.platformComposition;
    const current = context.platformComposition;
    if ((stored.aspectRatio || null) !== (current.aspectRatio || null) || (stored.orientation || null) !== (current.orientation || null)) {
      staleReasons.push("platform output context changed");
    }
  }
  return { stale: staleReasons.length > 0, reasons: staleReasons };
}

/**
 * Targeted reference invalidation (§34): only packages whose referenceRefs
 * include the changed asset are marked STALE.
 */
function invalidateByReference(root, projectId, assetId) {
  const listed = listPromptPackages(root, projectId);
  let invalidated = 0;
  for (const pkg of listed.packages) {
    const refs = (pkg.promptSpec && pkg.promptSpec.referenceRefs) || [];
    if (refs.some((r) => r.assetId === assetId) && pkg.status !== "APPROVED") {
      pkg.status = "STALE";
      pkg.updatedAt = new Date().toISOString();
      artifactStore.writeArtifactAtomic(root, projectId, packageRel(pkg.shotId, pkg.targetKind), JSON.stringify(pkg, null, 2));
      invalidated++;
    }
  }
  return { ok: true, invalidated };
}

module.exports = { persistPromptPackage, loadPromptPackage, listPromptPackages, checkPackageStaleness, invalidateByReference };
