"use strict";

/**
 * UNFOLDIQ continuity semantic validation (STEP 10A): CT1–CT8.
 * Pure logic over registry objects / scene preconditions. No media comparison
 * (visual QA is a later step); this module enforces structural invariants.
 *
 * Registry source: object, JSON string, or project-relative path (resolved
 * with { projectRoot, projectId }).
 */

const path = require("path");
const store = require("../providers/runtime/artifact-store.js");

function loadRegistry(registryInput, opts = {}) {
  if (!registryInput) return null;
  if (typeof registryInput === "object") return registryInput;
  let text = registryInput;
  if (!registryInput.trim().startsWith("{")) {
    // project-relative path
    text = store.readArtifact(opts.projectRoot, opts.projectId, registryInput).toString("utf8");
  }
  return JSON.parse(text);
}

function err(code, message) {
  return { code, message };
}

function entityMap(registry) {
  const map = new Map();
  for (const e of registry.entities || []) map.set(e.entityId, e);
  return map;
}

/**
 * validateContinuityRegistry(registryInput, opts) → { valid, errors[], warnings[] }
 * CT1 (locked needs approved ref), CT2 (paths inside project), CT4 (wardrobe
 * relation targets), CT6 (AI reconstruction ≠ evidence), CT7 (duplicate IDs),
 * CT8 (variant explicitness checked against attribute snapshots when provided).
 */
function validateContinuityRegistry(registryInput, opts = {}) {
  const errors = [];
  const warnings = [];
  let registry;
  try {
    registry = loadRegistry(registryInput, opts);
  } catch (e) {
    return { valid: false, errors: [err("REGISTRY_UNREADABLE", `Continuity registry unreadable: ${e.message}`)], warnings };
  }
  if (!registry || typeof registry !== "object") {
    return { valid: false, errors: [err("REGISTRY_INVALID", "Continuity registry must be an object")], warnings };
  }

  const seen = new Set();
  for (const e of registry.entities || []) {
    // CT7 — no duplicate entityId.
    if (seen.has(e.entityId)) {
      errors.push(err("DUPLICATE_ENTITY_ID", `Duplicate entityId: ${e.entityId}`));
    }
    seen.add(e.entityId);

    // CT1 — LOCKED entity requiring visual reference needs ≥1 APPROVED reference.
    if (e.lockStatus === "LOCKED" && e.requiresVisualReference !== false) {
      const approved = (e.referenceAssets || []).filter((r) => r.status === "APPROVED");
      if (approved.length === 0) {
        errors.push(err("LOCKED_WITHOUT_APPROVED_REFERENCE", `LOCKED entity ${e.entityId} has no APPROVED reference asset`));
      }
    }

    // CT2 — reference paths stay inside project.
    for (const r of e.referenceAssets || []) {
      if (typeof r.path !== "string") {
        errors.push(err("REFERENCE_PATH_INVALID", `Entity ${e.entityId} asset ${r.assetId} has no path`));
        continue;
      }
      try {
        if (opts.projectRoot && opts.projectId) {
          store.resolveProjectPath(opts.projectRoot, opts.projectId, r.path);
        } else if (r.path.includes("..")) {
          throw new Error("PATH_TRAVERSAL_BLOCKED");
        }
      } catch {
        errors.push(err("REFERENCE_PATH_TRAVERSAL", `Reference path escapes project: ${r.path}`));
      }

      // CT6 — historical AI reconstruction cannot be EVIDENCE_ASSET merely as master.
      if (r.role === "MASTER" && r.assetClassification === "EVIDENCE_ASSET" && r.aiGenerated === true) {
        errors.push(
          err("RECONSTRUCTION_AS_EVIDENCE", `AI master reference ${r.assetId} classified as EVIDENCE_ASSET: must be RECONSTRUCTION`)
        );
      }
    }

    // CT8 — intentional variant must be explicit, never a silent master overwrite.
    if (e.masterSnapshot && e.attributes) {
      const changed = Object.keys(e.attributes).filter(
        (k) => JSON.stringify(e.attributes[k]) !== JSON.stringify(e.masterSnapshot[k])
      );
      const declared = new Set((e.variants || []).flatMap((v) => Object.keys(v.attributeOverrides || {})));
      const silent = changed.filter((k) => !declared.has(k));
      if (silent.length > 0) {
        errors.push(
          err("SILENT_MASTER_OVERWRITE", `Entity ${e.entityId} silently changed master attributes: ${silent.join(",")}`)
        );
      }
    }
  }

  // CT4 — WARDROBE relation targets must exist.
  const map = entityMap(registry);
  for (const rel of registry.relationships || []) {
    if (!map.has(rel.from)) errors.push(err("RELATIONSHIP_UNKNOWN_FROM", `Relationship from unknown entity: ${rel.from}`));
    if (!map.has(rel.to)) {
      errors.push(err("WARDROBE_RELATION_TARGET_MISSING", `Relationship ${rel.from} ${rel.relation} → missing entity ${rel.to}`));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * checkContinuityPrecondition({ requiredEntities[], strictness, allowRetired }, registryInput, opts)
 * → { ok, reasons[] }
 * CT3 (STRICT needs LOCKED), CT5 (RETIRED not usable for strict unless allowed).
 */
function checkContinuityPrecondition(requirement, registryInput, opts = {}) {
  const reasons = [];
  const required = requirement.requiredEntities || [];
  const strict = requirement.strictness === "STRICT";
  if (required.length === 0) return { ok: true, reasons: ["no recurring entities required"] };

  let registry;
  try {
    registry = loadRegistry(registryInput, opts);
  } catch (e) {
    return { ok: false, reasons: [`continuity registry unavailable: ${e.message}`] };
  }
  if (!registry) return { ok: false, reasons: ["continuity registry missing for entity requirement"] };
  const map = entityMap(registry);

  for (const id of required) {
    const e = map.get(id);
    if (!e) return { ok: false, reasons: [`required entity not in registry: ${id}`] };
    // CT5 — RETIRED entity/reference unusable for strict unless explicitly allowed.
    if ((e.lockStatus === "RETIRED" || (e.referenceAssets || []).every((r) => r.status === "RETIRED")) && !requirement.allowRetired) {
      if (strict) return { ok: false, reasons: [`RETIRED entity ${id} cannot satisfy STRICT requirement`] };
      reasons.push(`entity ${id} is RETIRED (non-strict use flagged)`);
    }
    // CT3 — STRICT requires LOCKED.
    if (strict && e.lockStatus !== "LOCKED") {
      return { ok: false, reasons: [`STRICT continuity requires LOCKED entity, got ${e.lockStatus}: ${id}`] };
    }
  }
  reasons.push(strict ? "all required entities LOCKED" : "entities present for non-strict use");
  return { ok: true, reasons };
}

module.exports = { validateContinuityRegistry, checkContinuityPrecondition, loadRegistry };
