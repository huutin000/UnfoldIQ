"use strict";

/**
 * UNFOLDIQ Source Registry (1G.1G, Prompt 03).
 *
 * Turns Prompt-02 AcquiredDocuments (+ search provenance + plan ref) into
 * persistent, traceable source records. The registry records sources; it
 * declares no claim true. Bodies live once under research/sources/ and are
 * referenced, never duplicated into every record.
 *
 * Identity: same canonical URL => same logical source (new contentHash
 * appends a version, never silently overwrites history). Same exact hash
 * across different URLs => duplicate/derived signal for independence.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const { normalizeUrlForDedupe } = require("../research-acquisition/search-provider.js");

const REGISTRY_VERSION = "1.0.0";
const INDEX_REL = "research/source-index.json";
const SOURCES_REL = "research/sources";

const SOURCE_TYPES = ["PRIMARY", "OFFICIAL", "REPUTABLE_SECONDARY", "COMMUNITY", "SOCIAL", "FOLKLORE", "UNKNOWN"];

// Brief-lowercase taxonomy -> registry V5 conceptual taxonomy (forward map).
const BRIEF_TYPE_MAP = {
  primary_evidence: "PRIMARY",
  official_documentation: "OFFICIAL",
  peer_reviewed: "REPUTABLE_SECONDARY",
  institutional: "OFFICIAL",
  expert_analysis: "REPUTABLE_SECONDARY",
  secondary_journalism: "REPUTABLE_SECONDARY",
  general_web: "UNKNOWN",
  user_provided: "UNKNOWN",
};

function sha12(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, 12);
}

function canonicalUrl(urlString) {
  try {
    return normalizeUrlForDedupe(urlString);
  } catch {
    return null;
  }
}

function sourceIdFor(canonical) {
  return `src-${sha12(canonical)}`;
}

function validateIndexSchema(index) {
  const schemaPath = path.join(__dirname, "..", "..", "schemas", "source-index.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, ""));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const valid = ajv.compile(schema)(index);
  return valid;
}

/**
 * Conservative authority classification. UNKNOWN beats a fabricated OFFICIAL.
 * Deterministic rules only: explicit official-domain config, document
 * self-identification + corroborating metadata, brief-type forward map.
 * Anything weaker => UNKNOWN with reason (agent analysis may refine later
 * with rationale; the rule outcome is never overwritten silently).
 */
function classifySourceType(input = {}) {
  const url = typeof input.url === "string" ? input.url : "";
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const officialDomains = Array.isArray(input.officialDomains) ? input.officialDomains : [];
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { sourceType: "UNKNOWN", reason: "unparseable URL" };
  }
  for (const d of officialDomains) {
    const dom = String(d).toLowerCase();
    if (host === dom || host.endsWith(`.${dom}`)) {
      return { sourceType: "OFFICIAL", reason: `host matches configured official domain ${dom}` };
    }
  }
  const declared = `${metadata.publisher || ""} ${metadata.author || ""}`.toLowerCase();
  if (/official/.test(declared) && (metadata.url || url)) {
    return { sourceType: "OFFICIAL", reason: "document self-identifies as official with corroborating location" };
  }
  if (typeof input.briefSourceType === "string" && BRIEF_TYPE_MAP[input.briefSourceType]) {
    const mapped = BRIEF_TYPE_MAP[input.briefSourceType];
    if (mapped !== "UNKNOWN") {
      return { sourceType: mapped, reason: `forward-mapped from brief sourceType ${input.briefSourceType}` };
    }
  }
  return { sourceType: "UNKNOWN", reason: "insufficient evidence for confident classification" };
}

function emptyIndex(projectId) {
  return { version: REGISTRY_VERSION, projectId, sources: [] };
}

/**
 * Register one acquired document. Idempotent: same canonical + same hash =>
 * existing record (retrievedAt of first acquisition kept). Same canonical +
 * new hash => version appended, current moved, supersedes linked.
 */
function registerSource(index, input = {}) {
  const doc = input.acquiredDocument || {};
  const search = input.searchResult || {};
  const canonical = canonicalUrl(doc.finalUrl || doc.requestedUrl || "");
  if (!canonical) {
    return { ok: false, code: "SOURCE_RECORD_INVALID", message: "source has no usable URL" };
  }
  if (typeof doc.contentHash !== "string" || !doc.contentHash) {
    return { ok: false, code: "SOURCE_RECORD_INVALID", message: "source has no contentHash" };
  }
  const id = sourceIdFor(canonical);
  let record = (index.sources || []).find((s) => s.sourceId === id);
  const retrievedAt = doc.retrievedAt || new Date().toISOString();
  const warnings = [];
  if (doc.rawTruncated) warnings.push("rawMarkdown truncated at acquisition limit; evidence may be incomplete");
  if (!doc.fitMarkdown) warnings.push("fitMarkdown empty; analysis must fall back to rawMarkdown");
  if ((input.acquisitionWarnings || []).length > 0) warnings.push(...input.acquisitionWarnings);

  if (!record) {
    const classified = classifySourceType({
      url: doc.finalUrl || doc.requestedUrl,
      metadata: doc.metadata,
      officialDomains: input.officialDomains,
      briefSourceType: input.briefSourceType,
    });
    record = {
      sourceId: id,
      requestedUrl: doc.requestedUrl || null,
      canonicalUrl: canonical,
      finalUrl: doc.finalUrl || doc.requestedUrl || canonical,
      title: typeof doc.title === "string" && doc.title ? doc.title.slice(0, 500) : null,
      publisher: (doc.metadata && doc.metadata.publisher) || null,
      author: (doc.metadata && doc.metadata.author) || null,
      publishedAt: (doc.metadata && (doc.metadata.publishedAt || doc.metadata.date)) || null,
      retrievedAt,
      sourceType: classified.sourceType,
      classificationReason: classified.reason,
      independenceStatus: "UNKNOWN",
      originGroup: null,
      searchQuery: search.query || null,
      searchProvider: search.provider || null,
      searchRank: typeof search.searchRank === "number" ? search.searchRank : null,
      contentHash: doc.contentHash,
      currentVersionHash: doc.contentHash,
      versions: [{
        contentHash: doc.contentHash,
        retrievedAt,
        rawContentRef: `${SOURCES_REL}/${id}/content-${doc.contentHash.slice(0, 12)}.md`,
        fitContentRef: doc.fitMarkdown ? `${SOURCES_REL}/${id}/fit-${doc.contentHash.slice(0, 12)}.md` : null,
        supersedes: null,
      }],
      acquisitionRoute: doc.route || "crawl4ai-direct",
      crawlerVersion: doc.crawlerVersion || null,
      fitQuery: doc.fitQuery || null,
      acquisitionWarnings: warnings,
    };
    index.sources.push(record);
    return { ok: true, record, created: true, versionAdded: false };
  }

  if (record.currentVersionHash === doc.contentHash) {
    return { ok: true, record, created: false, versionAdded: false, deduplicated: true };
  }
  record.versions.push({
    contentHash: doc.contentHash,
    retrievedAt,
    rawContentRef: `${SOURCES_REL}/${id}/content-${doc.contentHash.slice(0, 12)}.md`,
    fitContentRef: doc.fitMarkdown ? `${SOURCES_REL}/${id}/fit-${doc.contentHash.slice(0, 12)}.md` : null,
    supersedes: record.currentVersionHash,
  });
  record.currentVersionHash = doc.contentHash;
  record.contentHash = doc.contentHash;
  record.finalUrl = doc.finalUrl || record.finalUrl;
  record.retrievedAt = retrievedAt;
  for (const w of warnings) {
    if (!record.acquisitionWarnings.includes(w)) record.acquisitionWarnings.push(w);
  }
  return { ok: true, record, created: false, versionAdded: true };
}

/** Persist bodies (once per hash) + index atomically. Old artifact stays readable on failure. */
function persistRegistry(root, projectId, index, bodies = {}) {
  try {
    for (const record of index.sources || []) {
      for (const v of record.versions || []) {
        const body = bodies[v.contentHash];
        if (body !== undefined && !artifactStore.artifactExists(root, projectId, v.rawContentRef)) {
          artifactStore.writeArtifactAtomic(root, projectId, v.rawContentRef, String(body));
        }
      }
    }
    if (!validateIndexSchema(index)) {
      return { ok: false, code: "SOURCE_RECORD_INVALID", message: "index failed schema validation" };
    }
    artifactStore.writeArtifactAtomic(root, projectId, INDEX_REL, JSON.stringify(index, null, 2));
    return { ok: true, path: INDEX_REL };
  } catch (e) {
    return { ok: false, code: "SOURCE_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

function loadRegistry(root, projectId) {
  try {
    if (!artifactStore.artifactExists(root, projectId, INDEX_REL)) return { ok: true, index: null };
    const raw = artifactStore.readArtifact(root, projectId, INDEX_REL).toString("utf8");
    return { ok: true, index: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, code: "SOURCE_PERSIST_FAILED", message: String((e && e.message) || e) };
  }
}

module.exports = {
  REGISTRY_VERSION,
  INDEX_REL,
  SOURCES_REL,
  SOURCE_TYPES,
  canonicalUrl,
  sourceIdFor,
  classifySourceType,
  emptyIndex,
  registerSource,
  validateIndexSchema,
  persistRegistry,
  loadRegistry,
};
