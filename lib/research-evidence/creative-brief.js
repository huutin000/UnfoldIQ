"use strict";

/**
 * UNFOLDIQ Creative Brief runtime (ROADMAP V6 lightweight delta, Prompt 03).
 *
 * The brief is pre-research context (audience/intent/format), NOT a research
 * plan and NOT evidence. Model: channel defaults + platform profile +
 * user/project overrides. The brief informs the Research Plan through a
 * stable reference (briefId/hash/version); mutable values are not duplicated
 * across artifacts. The brief never alters factual truth or evidence status.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { stableStringify } = require("../../providers/runtime/request-fingerprint.js");

const BRIEF_VERSION = "1.0.0";
const BRIEF_REL_PATH = "research/creative-brief.json";

const PLATFORMS = ["youtube", "tiktok"];

// Research-relevant subset consumed by planning/sufficiency.
const RESEARCH_FIELDS = [
  "audience",
  "knowledgeLevel",
  "platform",
  "targetDuration",
  "viewerPromise",
  "primaryLearningGoal",
  "contentDensity",
];

function validateBriefSchema(brief) {
  const schemaPath = path.join(__dirname, "..", "..", "schemas", "creative-brief.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, ""));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const valid = ajv.compile(schema)(brief);
  return valid;
}

function briefHash(brief) {
  return crypto.createHash("sha256").update(stableStringify(brief), "utf8").digest("hex");
}

function briefRef(brief) {
  return { briefId: brief.briefId, briefHash: briefHash(brief).slice(0, 16), briefVersion: brief.version };
}

/**
 * Build a brief from layered context. Precedence: channel defaults <
 * platform profile (platform stays canonical) < explicit overrides.
 */
function createBrief(input = {}) {
  const channel = input.channelDefaults || {};
  const profile = input.platformProfile || {};
  const overrides = input.overrides || {};
  const merged = { ...channel, ...profile, ...overrides };
  const platform = typeof merged.platform === "string" ? merged.platform.toLowerCase() : "";
  if (!PLATFORMS.includes(platform)) {
    return { ok: false, code: "INVALID_BRIEF_PLATFORM", message: "Creative Brief platform must be youtube | tiktok." };
  }
  const brief = { version: BRIEF_VERSION, ...merged, platform };
  if (typeof brief.briefId !== "string" || !brief.briefId) {
    brief.briefId = `cb-${briefHash({ ...brief, briefId: "id" }).slice(0, 8)}`;
  }
  if (typeof brief.audience !== "string" || !brief.audience.trim()) {
    return { ok: false, code: "INVALID_BRIEF", message: "Creative Brief requires a non-empty audience." };
  }
  if (!validateBriefSchema(brief)) {
    return { ok: false, code: "CREATIVE_BRIEF_INVALID", message: "Creative Brief failed schema validation." };
  }
  return { ok: true, brief };
}

/** Research-relevant projection (no truth-bearing fields cross this boundary). */
function researchContextOf(brief) {
  const out = {};
  for (const f of RESEARCH_FIELDS) {
    if (brief[f] !== undefined) out[f] = brief[f];
  }
  return out;
}

/**
 * Fold a validated brief into Prompt-01 plan input. Explicit plan input wins
 * over brief context (repo-wide explicit-override convention); the brief
 * only fills gaps. Returns { planInput, briefRef }.
 */
function applyBriefToPlanInput(brief, planInput = {}) {
  const input = { ...planInput };
  if ((input.audience === undefined || input.audience === "") && brief.audience) {
    input.audience = brief.audience;
  }
  if ((input.platform === undefined || input.platform === "") && brief.platform) {
    input.platform = brief.platform;
  }
  return { planInput: input, briefRef: briefRef(brief) };
}

module.exports = {
  BRIEF_VERSION,
  BRIEF_REL_PATH,
  RESEARCH_FIELDS,
  validateBriefSchema,
  briefHash,
  briefRef,
  createBrief,
  researchContextOf,
  applyBriefToPlanInput,
};
