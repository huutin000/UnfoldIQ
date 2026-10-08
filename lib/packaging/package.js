"use strict";

/**
 * Phase 4A §24–§33, §37–§39, §44–§45 — metadata, rights, compliance,
 * checklist, manifest, full packaging QA + bounded repair + persistence.
 *
 * Packaging-only changes never dirty video/audio/timeline. Upstream content
 * change marks packaging STALE. finalVideoRef stays PENDING_PHASE_4B.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const profiles = require("./profiles.js");
const experiment = require("./experiment.js");
const claims = require("./claims.js");

const PACKAGE_VERSION = "1.0.0";
const FINAL_VIDEO_PENDING = "PENDING_PHASE_4B";
const REPAIR_BUDGET = { maxAttempts: 5, timeBudgetMs: 5000, maxImageAttempts: 2 };

function sha12(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 12);
}
function nowIso() { return new Date().toISOString(); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function finding(code, extra = {}) {
  return { code, severity: extra.severity || "REVIEW", variantId: extra.variantId || null, field: extra.field || null, reason: extra.reason || code, correctiveAction: extra.correctiveAction || null };
}

// ---------- description (§24–§25) ----------

function buildDescription(canonical = {}, profile) {
  const sections = [];
  if (canonical.summary) sections.push(canonical.summary);
  if (Array.isArray(canonical.learnPoints) && canonical.learnPoints.length) {
    sections.push("In this video:\n" + canonical.learnPoints.map((l) => `• ${l}`).join("\n"));
  }
  if (canonical.sourcesNote) sections.push(canonical.sourcesNote);
  if (Array.isArray(canonical.chapters) && canonical.chapters.length) {
    sections.push("Chapters:\n" + canonical.chapters.map((c) => `${c.time} ${c.label}`).join("\n"));
  }
  if (canonical.musicCredit) sections.push(`Music: ${canonical.musicCredit}`);
  if (canonical.correctionsPlaceholder) sections.push("Corrections: (none reported)");
  const text = sections.join("\n\n");
  const check = profiles.validateDescriptionText(text, profile);
  return { text, ok: check.ok, errors: check.errors };
}

// ---------- tags (§26: low priority, small useful set) ----------

function buildTags(input = {}) {
  const seen = new Set();
  const out = [];
  for (const t of input.tags || []) {
    const k = String(t).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(t).trim());
    if (out.length >= 10) break;
  }
  return { tags: out, stuffed: (input.tags || []).length > 15 };
}

// ---------- metadata (§27–§28) ----------

function buildPublishMetadata(input = {}, profile) {
  const unknowns = [];
  const audience = {
    madeForKids: input.madeForKids === true ? true : input.madeForKids === false ? false : "REVIEW_REQUIRED",
    ageRestriction: input.ageRestriction === true ? true : input.ageRestriction === false ? false : "REVIEW_REQUIRED",
  };
  if (audience.madeForKids === "REVIEW_REQUIRED") unknowns.push("MISSING_AUDIENCE_DECISION: madeForKids unknown — not defaulted");
  if (audience.ageRestriction === "REVIEW_REQUIRED") unknowns.push("MISSING_AUDIENCE_DECISION: ageRestriction unknown — not defaulted");
  return {
    metadata: {
      version: PACKAGE_VERSION,
      platformProfileRef: input.profileRef,
      title: input.title,
      description: input.description,
      language: input.language || "en",
      tags: input.tags || [],
      audience,
      category: input.category || null,
      playlistIntent: input.playlistIntent || null,
      visibilityIntent: input.visibilityIntent || "PRIVATE",
      licenseDistribution: input.licenseDistribution || null,
      selectedPackagingVariantId: input.selectedVariantId || null,
      sourceHashes: input.sourceHashes || {},
    },
    unknowns,
  };
}

// ---------- rights / provenance (§29–§30) ----------

function buildRightsProvenance({ assetManifest, usedAssetIds = [], musicAttribution } = {}) {
  const findings = [];
  const records = [];
  const byId = new Map(((assetManifest && assetManifest.assets) || []).map((a) => [a.assetId, a]));
  for (const id of usedAssetIds) {
    const rec = byId.get(id);
    if (!rec) {
      findings.push(finding("MISSING_PROVENANCE", { severity: "BLOCK", field: "rights", reason: `used asset ${id} has no canonical rights record`, correctiveAction: "REBUILD_ATTRIBUTION" }));
      continue;
    }
    records.push({ assetId: id, sourceType: rec.sourceType || null, provenance: rec.provenance || null, rights: rec.rights || null });
  }
  let musicAttributionText = null;
  if (musicAttribution && musicAttribution.required) {
    if (!musicAttribution.exactText) {
      findings.push(finding("MISSING_ATTRIBUTION", { severity: "BLOCK", field: "rights", reason: "music requires attribution but no canonical credit text exists", correctiveAction: "REBUILD_ATTRIBUTION" }));
    } else {
      musicAttributionText = musicAttribution.exactText; // exact canonical text, never retyped
    }
  }
  return { rightsProvenance: { version: PACKAGE_VERSION, records, musicAttribution: musicAttributionText }, findings };
}

// ---------- sources (§31: traceability, not forced public citations) ----------

function buildSources(evidenceClaims = []) {
  return {
    sources: evidenceClaims.map((c) => ({ claimId: c.claimId, text: c.text, sources: c.sources || [] })),
  };
}

// ---------- compliance (§32: packaging-level; render/output stays 4B) ----------

function buildCompliance({ profile, experimentSet, metadata, rightsFindings = [], description }) {
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail: detail || null });
  push("title limit", (metadata.title || "").length <= profile.title.maxCharacters, `${(metadata.title || "").length}/${profile.title.maxCharacters}`);
  push("description limit", (description || "").length <= profile.description.maxCharacters, `${(description || "").length}/${profile.description.maxCharacters}`);
  push("thumbnail profile", true, "per-variant geometry validated in packaging QA");
  push("metadata completeness", !!metadata.title && !!metadata.language, null);
  push("audience decision completeness", metadata.audience && metadata.audience.madeForKids !== "REVIEW_REQUIRED", null);
  push("rights/attribution completeness", rightsFindings.filter((f) => f.severity === "BLOCK").length === 0, null);
  push("final render/output technical compliance", false, FINAL_VIDEO_PENDING);
  push("final visual flash/safe-zone validation", false, FINAL_VIDEO_PENDING);
  const blocking = checks.filter((c) => !c.ok && !String(c.detail || "").startsWith("PENDING"));
  return { compliance: { version: PACKAGE_VERSION, profileRef: metadata.platformProfileRef, checks }, blocking: blocking.length };
}

// ---------- upload checklist (§33) ----------

function buildUploadChecklist(manifest) {
  const lines = [
    "# UPLOAD CHECKLIST",
    "",
    `- [ ] final.mp4 exists and Phase 4B PASS (currently: ${manifest.finalVideoRef})`,
    `- [ ] selected title (${manifest.selectedTitle || "unset"})`,
    `- [ ] selected thumbnail (${manifest.selectedThumbnail || "unset"})`,
    "- [ ] description",
    "- [ ] captions (srt/vtt refs present)",
    `- [ ] language (${manifest.language || "unset"})`,
    "- [ ] audience flag (made-for-kids + age restriction decided)",
    "- [ ] rights/provenance complete",
    "- [ ] music attribution (if required)",
    "- [ ] platform compliance (packaging PASS; final render pending 4B)",
    "- [ ] sources/citations retained",
    "- [ ] final human/operator review if policy requires",
    "",
    "Manual upload remains acceptable for V1.",
    "",
  ];
  return lines.join("\n");
}

// ---------- full packaging QA (§40) ----------

function validateExperimentSet(set, context = {}) {
  const findings = [];
  const profile = profiles.getPublishProfile(set.profileRef);
  if (!profile) return { status: "FAIL", findings: [finding("STALE_PACKAGING_INPUT", { severity: "BLOCK", reason: `unknown profile ${set.profileRef}`, correctiveAction: "REBASE" })] };
  // Upstream staleness: content hashes moved since packaging.
  const cur = context.currentContentHashes || null;
  if (cur && set.contentHashes && Object.keys(set.contentHashes).length) {
    const stale = Object.keys(set.contentHashes).some((k) => cur[k] !== undefined && cur[k] !== set.contentHashes[k]);
    if (stale) {
      findings.push(finding("STALE_PACKAGING_INPUT", { severity: "BLOCK", reason: "upstream script/content changed — claims may be stale", correctiveAction: "REBASE" }));
    }
  }
  findings.push(...experiment.checkVariantDiversity(set));
  for (const v of set.variants) {
    const tc = profiles.validateTitleText(v.title.text, profile);
    for (const e of tc.errors) {
      findings.push(finding(e.startsWith("TITLE_TOO_LONG") ? "TITLE_TOO_LONG" : "INVALID_TITLE_CHARACTER",
        { severity: e.startsWith("TITLE_TOO_LONG") ? "BLOCK" : "REVIEW", variantId: v.variantId, field: "title", reason: e, correctiveAction: "REWRITE_TITLE" }));
    }
    const th = profiles.validateThumbnailAsset(v.thumbnail, profile);
    for (const e of th.errors) {
      const code = e.startsWith("THUMBNAIL_WRONG_ASPECT") ? "THUMBNAIL_WRONG_ASPECT"
        : e.startsWith("THUMBNAIL_RESOLUTION") ? "THUMBNAIL_RESOLUTION_TOO_LOW"
        : e.startsWith("THUMBNAIL_FORMAT") ? "THUMBNAIL_FORMAT_INVALID" : "THUMBNAIL_FILE_TOO_LARGE";
      findings.push(finding(code, { severity: "BLOCK", variantId: v.variantId, field: "thumbnail", reason: e, correctiveAction: "REPLACE_THUMBNAIL" }));
    }
    // Small-preview QA: text legibility + density.
    const overlay = v.thumbnail.textOverlay || "";
    const leg = v.thumbnail.textLegibility || {};
    if (overlay && (overlay.length > 30 || (leg.fontSizePx && leg.fontSizePx < 48))) {
      findings.push(finding("THUMBNAIL_TEXT_UNREADABLE", { severity: "REVIEW", variantId: v.variantId, field: "thumbnail", reason: `overlay too long/small for mobile preview (${overlay.length} chars)`, correctiveAction: "SIMPLIFY_TEXT" }));
    }
    if (overlay && overlay.split(/\s+/).length > 8 && (leg.elements || 0) > 4) {
      findings.push(finding("THUMBNAIL_TOO_COMPLEX", { severity: "REVIEW", variantId: v.variantId, field: "thumbnail", reason: "overly dense composition", correctiveAction: "SIMPLIFY_TEXT" }));
    }
    if (!v.thumbnail.provenanceRef || (context.assetResolver && !context.assetResolver(v.thumbnail.assetId))) {
      findings.push(finding("MISSING_PROVENANCE", { severity: "BLOCK", variantId: v.variantId, field: "thumbnail", reason: `thumbnail ${v.thumbnail.assetId} lacks resolvable provenance`, correctiveAction: "REPLACE_THUMBNAIL" }));
    }
    findings.push(...claims.gateVariantClaims(v, context).findings);
  }
  if (!set.selectedVariantId) {
    findings.push(finding("MISSING_AUDIENCE_DECISION", { severity: "REVIEW", reason: "no variant selected — REVIEW_REQUIRED before publish-ready finalize", correctiveAction: "SELECT_VARIANT" }));
  }
  const blocks = findings.filter((f) => f.severity === "BLOCK");
  return { status: blocks.length ? "FAIL" : findings.length ? "REVIEW_REQUIRED" : "PASS", findings, blocks: blocks.length };
}

// ---------- repair (§41, bounded; never fabricates support) ----------

function repairExperimentSet(set, context = {}, budget = {}) {
  const maxAttempts = budget.maxAttempts || REPAIR_BUDGET.maxAttempts;
  const deadline = Date.now() + (budget.timeBudgetMs || REPAIR_BUDGET.timeBudgetMs);
  const applied = [];
  const working = clone(set);
  let attempts = 0;
  for (; attempts < maxAttempts; attempts++) {
    if (Date.now() > deadline) break;
    const qa = validateExperimentSet(working, context);
    const f = qa.findings.find((x) => REPAIRABLE[x.code]);
    if (!f) return { ok: qa.status !== "FAIL", set: working, qa, applied, attempts: attempts + 1, unresolved: qa.findings };
    if (!REPAIRABLE[f.code](working, f, context)) {
      return { ok: false, set: working, qa, applied, attempts: attempts + 1, unresolved: qa.findings, stopped: f.code };
    }
    applied.push({ code: f.code, variantId: f.variantId });
    working.updatedAt = nowIso();
  }
  const qa = validateExperimentSet(working, context);
  return { ok: qa.status !== "FAIL", set: working, qa, applied, attempts, unresolved: qa.findings };
}

function rewriteTitleToLimit(variant, profile) {
  const max = profile.title.maxCharacters;
  const words = variant.title.text.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max - 1) break;
    out = next;
  }
  variant.title.text = out.length ? `${out}…` : variant.title.text.slice(0, max);
  variant.title.characterCount = variant.title.text.length;
  variant.title.metrics = experiment.titleMetrics(variant.title.text);
}

const REPAIRABLE = {
  TITLE_TOO_LONG: (working, f) => {
    const v = working.variants.find((x) => x.variantId === f.variantId);
    const profile = profiles.getPublishProfile(working.profileRef);
    if (!v || !profile) return false;
    rewriteTitleToLimit(v, profile);
    return true;
  },
  TITLE_THUMBNAIL_MISMATCH: (working, f) => {
    const v = working.variants.find((x) => x.variantId === f.variantId);
    if (!v) return false;
    // Align pair toward the title claim (title is the fidelity anchor).
    v.thumbnail.claimRefs = [...new Set([...v.thumbnail.claimRefs, ...v.title.claimRefs])];
    return true;
  },
  THUMBNAIL_TEXT_UNREADABLE: (working, f) => {
    const v = working.variants.find((x) => x.variantId === f.variantId);
    if (!v || !v.thumbnail.textOverlay) return false;
    const words = v.thumbnail.textOverlay.split(/\s+/);
    v.thumbnail.textOverlay = words.slice(0, 3).join(" ");
    return true;
  },
  THUMBNAIL_TOO_COMPLEX: (working, f) => REPAIRABLE.THUMBNAIL_TEXT_UNREADABLE(working, f),
  VARIANTS_TOO_SIMILAR: () => false, // needs a genuinely new angle — operator/agent replan, not auto-mangle
};

function patchPackaging(set, patch = {}) {
  const OPS = ["EDIT_TITLE", "REPLACE_THUMBNAIL", "EDIT_DESCRIPTION_REF", "SELECT_VARIANT", "REJECT_VARIANT"];
  if (!patch.patchId || !OPS.includes(patch.op)) return { ok: false, code: "PATCH_INVALID", message: `op must be ${OPS.join("|")}` };
  const working = clone(set);
  working.appliedPatchIds = working.appliedPatchIds || [];
  if (working.appliedPatchIds.includes(patch.patchId)) return { ok: true, set: working, idempotent: true };
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== (working.revision || 0)) {
    return { ok: false, code: "STALE_PACKAGING_INPUT", message: "stale packaging patch" };
  }
  if (patch.op === "SELECT_VARIANT") {
    const r = experiment.selectPackagingVariant(working, patch.variantId, patch.reason || "operator selection", true);
    if (!r.ok) return r;
    Object.assign(working, r.set);
  } else if (patch.op === "REJECT_VARIANT") {
    const v = working.variants.find((x) => x.variantId === patch.variantId);
    if (!v) return { ok: false, code: "VARIANT_NOT_FOUND", message: patch.variantId };
    v.status = "REJECTED";
  } else if (patch.op === "EDIT_TITLE") {
    const v = working.variants.find((x) => x.variantId === patch.variantId);
    if (!v) return { ok: false, code: "VARIANT_NOT_FOUND", message: patch.variantId };
    v.title.text = patch.text; // operator edit preserved; QA rerun by caller (Case R)
    v.title.characterCount = patch.text.length;
    v.title.metrics = experiment.titleMetrics(patch.text);
    if (patch.primaryClaim !== undefined) v.title.primaryClaim = patch.primaryClaim;
    if (patch.claimRefs !== undefined) v.title.claimRefs = patch.claimRefs;
  } else if (patch.op === "REPLACE_THUMBNAIL") {
    const v = working.variants.find((x) => x.variantId === patch.variantId);
    if (!v) return { ok: false, code: "VARIANT_NOT_FOUND", message: patch.variantId };
    Object.assign(v.thumbnail, patch.thumbnail); // operator asset preserved; rights/claim QA rerun by caller
  } else if (patch.op === "EDIT_DESCRIPTION_REF") {
    working.descriptionRef = patch.descriptionRef;
  }
  working.appliedPatchIds.push(patch.patchId);
  working.revision = (working.revision || 0) + 1;
  working.updatedAt = nowIso();
  return { ok: true, set: working };
}

// ---------- manifest assembly (§8) ----------

function buildPublishPackage(input = {}) {
  const sel = (input.experimentSet.variants || []).find((v) => v.variantId === input.experimentSet.selectedVariantId);
  const manifest = {
    version: PACKAGE_VERSION,
    projectId: input.projectId,
    sourceProjectManifestVersion: input.sourceProjectManifestVersion || "unknown",
    sourceTimelineId: input.sourceTimelineId || null,
    sourceTimelineRevision: input.sourceTimelineRevision !== undefined ? input.sourceTimelineRevision : 0,
    sourceMotionPlanVersion: input.sourceMotionPlanVersion || "unknown",
    sourceResponsiveVariantId: input.sourceResponsiveVariantId || null,
    finalVideoRef: FINAL_VIDEO_PENDING,
    experimentSetRef: input.experimentSet.experimentSetId,
    selectedVariantId: input.experimentSet.selectedVariantId || null,
    selectedTitle: sel ? sel.title.text : null,
    selectedThumbnail: sel ? sel.thumbnail.assetId : null,
    language: (input.metadata && input.metadata.language) || "en",
    descriptionRef: input.descriptionRef || "packaging/description.md",
    captions: input.captions || {},
    metadataRef: input.metadataRef || "packaging/metadata.json",
    rightsProvenanceRef: input.rightsProvenanceRef || "packaging/rights-provenance.json",
    platformComplianceRef: input.platformComplianceRef || "packaging/platform-compliance.json",
    sourcesCitationsRef: input.sourcesCitationsRef || "packaging/sources.json",
    musicAttributionRef: input.musicAttributionRef || null,
    uploadChecklistRef: input.uploadChecklistRef || "packaging/UPLOAD_CHECKLIST.md",
    dependencyHashes: input.dependencyHashes || {},
    qaStatus: input.qaStatus || "REVIEW_REQUIRED",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  manifest.uploadChecklist = buildUploadChecklist(manifest);
  return { ok: true, manifest };
}

// ---------- dependency / invalidation (§38) ----------

function resolvePackagingInvalidation(change = {}) {
  if (change.scope === "TITLE_ONLY") {
    return { titleQADirty: true, claimQADirty: true, metadataDirty: true, videoRenderClean: true, audioClean: true, timelineClean: true };
  }
  if (change.scope === "THUMBNAIL_ONLY") {
    return { thumbnailQADirty: true, claimQADirty: true, rightsDirty: true, videoRenderClean: true, audioClean: true, timelineClean: true };
  }
  if (change.scope === "UPSTREAM_CONTENT") {
    return { experimentSetDirty: true, claimsStale: true, videoRenderClean: true };
  }
  if (change.scope === "RENDER_TECHNICAL_ONLY") {
    return { packagingTextClean: true, finalVideoRefDirty: true, complianceDirty: true };
  }
  return { experimentSetDirty: true };
}

// ---------- persistence (workspace OUTPUT governance) ----------

function persistPackagingFile(root, projectId, fileName, data, expectedRevision) {
  const ws = require("../workspace/index.js");
  const resolved = ws.resolveArtifactPath(root, projectId, "OUTPUT", "DURABLE", { fileName });
  if (!resolved.ok) return resolved;
  const guard = ws.validateWorkspacePath(root, resolved.path, { projectId });
  if (!guard.ok) return guard;
  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  if (expectedRevision !== undefined && fs.existsSync(resolved.path)) {
    try {
      const prev = JSON.parse(fs.readFileSync(resolved.path, "utf8"));
      const prevRev = prev.revision !== undefined ? prev.revision : prev.experimentSetRevision;
      if (prevRev !== undefined && prevRev !== expectedRevision) {
        return { ok: false, code: "STALE_PACKAGING_INPUT", message: `stale persist: disk rev ${prevRev} ≠ expected ${expectedRevision}` };
      }
    } catch (e) {
      return { ok: false, code: "REGISTRY_INVALID", message: String((e && e.message) || e) };
    }
  }
  const tmp = `${resolved.path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, resolved.path);
  return { ok: true, path: resolved.path };
}

function loadPackagingFile(root, projectId, fileName) {
  const ws = require("../workspace/index.js");
  const resolved = ws.resolveArtifactPath(root, projectId, "OUTPUT", "DURABLE", { fileName });
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.path)) return { ok: false, code: "NOT_FOUND", message: fileName };
  try {
    const raw = fs.readFileSync(resolved.path, "utf8");
    return { ok: true, data: fileName.endsWith(".md") || fileName.endsWith(".txt") ? raw : JSON.parse(raw), path: resolved.path };
  } catch (e) {
    return { ok: false, code: "REGISTRY_INVALID", message: String((e && e.message) || e) };
  }
}

// ---------- store (idempotent retry, Case W) ----------

function createPackagingStore() {
  const byProject = new Map();
  return {
    buildSet(projectId, input, context) {
      const r = experiment.buildPublishExperimentSet({ ...input, projectId }, context || {});
      if (!r.ok) return r;
      const prev = byProject.get(projectId);
      if (prev && prev.set.experimentSetId === r.set.experimentSetId) {
        return { ok: true, set: prev.set, idempotent: true }; // retry: no duplicate set
      }
      byProject.set(projectId, { set: { ...r.set, revision: 0 } });
      return { ok: true, set: byProject.get(projectId).set };
    },
    get(projectId) {
      const e = byProject.get(projectId);
      return e ? { ok: true, set: e.set } : { ok: false, code: "NOT_FOUND" };
    },
    validate(projectId, context) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      return validateExperimentSet(e.set, context || {});
    },
    patch(projectId, patch) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const r = patchPackaging(e.set, patch);
      if (r.ok && !r.idempotent) byProject.set(projectId, { set: r.set });
      return r;
    },
    findings(projectId) {
      const e = byProject.get(projectId);
      if (!e) return { ok: false, code: "NOT_FOUND" };
      const qa = validateExperimentSet(e.set, {});
      return { ok: true, status: qa.status, findings: qa.findings };
    },
  };
}

module.exports = {
  PACKAGE_VERSION,
  FINAL_VIDEO_PENDING,
  REPAIR_BUDGET,
  buildDescription,
  buildTags,
  buildPublishMetadata,
  buildRightsProvenance,
  buildSources,
  buildCompliance,
  buildUploadChecklist,
  validateExperimentSet,
  repairExperimentSet,
  patchPackaging,
  buildPublishPackage,
  resolvePackagingInvalidation,
  persistPackagingFile,
  loadPackagingFile,
  createPackagingStore,
};
