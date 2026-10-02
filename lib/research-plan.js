"use strict";

/**
 * UNFOLDIQ — Research planning runtime (PHASE 1G.1 Prompt 01, items 1G.1B/1G.1C).
 *
 * Three concerns with a clean boundary, orchestrated by planResearch():
 *
 *   ResearchRequirementResolver  REQUIRED | OPTIONAL_TARGETED | NOT_REQUIRED
 *   ResearchPlanBuilder          scope + questions + priorities + stop + budget
 *   ResearchPlanValidator        schema layer (ajv) + semantic layer (this file)
 *
 * Wraps (never duplicates) lib/v5-contract-check.js decideResearchRequired and
 * lib/content-class.js classOfModeId. Deterministic, no network, no AI, no
 * paid calls. Stops after a valid Research Plan — no acquisition, no sources,
 * no fake URLs/evidence (fixtures in tests only).
 *
 * Persistence follows the project-artifact convention
 * (projects/<id>/research/research-brief.json): plans persist to
 * projects/<id>/research/research-plan.json, idempotently.
 */

var fs = require("fs");
var path = require("path");
var Ajv = require("ajv");
var addFormats = require("ajv-formats");
var v5 = require("./v5-contract-check.js");
var contentClassLib = require("./content-class.js");

var PLAN_VERSION = "1.0.0";
var PLAN_REL_PATH = "research/research-plan.json";

var RESEARCH_DECISIONS = ["REQUIRED", "OPTIONAL_TARGETED", "NOT_REQUIRED"];

// Modes whose factual questions are procedural/demonstration-oriented rather
// than documentary-timeline-oriented. Question planning considers contentMode.
var TUTORIAL_MODES = [
  "tutorial",
  "technical-explainer",
  "educational-explainer",
  "product-review",
  "comparison",
  "listicle",
  "data-explainer",
  "commentary"
];

var FACTUAL_SOURCES = [
  "PRIMARY",
  "OFFICIAL",
  "peer-reviewed / institutional",
  "reputable secondary",
  "community / social only when the question requires testimony or sentiment"
];

var HYBRID_SOURCES = [
  "PRIMARY",
  "OFFICIAL",
  "peer-reviewed / institutional",
  "reputable secondary",
  "folklore sources for folklore classification",
  "community / social testimony only as TESTIMONY, never as verified fact"
];

var TARGETED_SOURCES = [
  "OFFICIAL",
  "peer-reviewed / institutional",
  "reputable secondary",
  "reference works for period/cultural detail"
];

var REQUIRED_STOP_CRITERIA = "Stop when: all critical questions have at least one viable evidence path; " +
  "high-impact claims have source requirements defined; freshness requirement can be satisfied; " +
  "remaining optional questions are non-blocking; research budget is reached. " +
  "(Actual SUFFICIENT / NEEDS_MORE_RESEARCH / BLOCKED evaluation belongs to a later stage.)";

var TARGETED_STOP_CRITERIA = "Stop when: every targeted world-building topic has at least one viable evidence path; " +
  "remaining optional questions are non-blocking; research budget is reached. " +
  "The fictional plot itself is never evidence-gated.";

var BUDGETS = {
  FACTUAL: "maxQueries:12; maxSources:20; maxDeepResearchEscalations:1; maxTimeMin:120",
  HYBRID: "maxQueries:14; maxSources:24; maxDeepResearchEscalations:1; maxTimeMin:150",
  OPTIONAL_TARGETED: "maxQueries:6; maxSources:10; maxDeepResearchEscalations:0; maxTimeMin:45"
};

var GENERIC_GOAL_PHRASES = ["research this topic", "learn about", "tell me everything", "find out about"];

var FICTION_SCOPE_VIOLATIONS = [
  "did the fictional",
  "prove the ghost",
  "ghost really exist",
  "evidence that the fictional",
  "haunting is real"
];

var MAX_TARGETED_TOPICS = 10;

// ---------------------------------------------------------------------------
// Platform normalization (aliases per platforms/INDEX.md). Platform never
// decides truth class; it only propagates into the plan for scope/depth.
// ---------------------------------------------------------------------------

function normalizePlatform(platform) {
  if (platform === undefined || platform === null || platform === "") return null;
  var p = String(platform).trim().toLowerCase();
  if (p === "youtube" || p === "yt") return "youtube";
  if (p === "tiktok" || p === "tt") return "tiktok";
  return { invalid: p };
}

// ---------------------------------------------------------------------------
// 1G.1C — Research Required? Gate (independent from class resolution).
// ---------------------------------------------------------------------------

function hasTargetedTopics(topics) {
  return Array.isArray(topics) && topics.filter(function (t) {
    return typeof t === "string" && t.trim().length > 0;
  }).length > 0;
}

function resolveResearchRequirement(contentClass, opts) {
  var options = opts || {};
  var topics = Array.isArray(options.targetedResearchTopics)
    ? options.targetedResearchTopics.filter(function (t) { return typeof t === "string" && t.trim().length > 0; })
    : [];
  if (!contentClassLib.isValidContentClass(contentClass)) {
    return { ok: false, code: "INVALID_CONTENT_CLASS", message: "Cannot gate research: unknown contentClass '" + String(contentClass) + "'." };
  }
  // Factual projects cannot be fast-tracked past research by any flag.
  if (options.skipResearch === true && (contentClass === "FACTUAL" || contentClass === "HYBRID")) {
    return { ok: false, code: "RESEARCH_BYPASS_REJECTED", message: "skipResearch cannot disable REQUIRED research for " + contentClass + "." };
  }
  var decision = v5.decideResearchRequired(contentClass, { factualAccuracyRequested: topics.length > 0 });
  if (decision === "REVIEW_REQUIRED") {
    return { ok: false, code: "AMBIGUOUS_CONTENT_CLASS", message: "Cannot gate research for unresolved content class." };
  }
  var out = { ok: true, decision: decision };
  if (decision === "REQUIRED") {
    out.reason = contentClass + " requires researched evidence before scripting.";
  } else if (decision === "OPTIONAL_TARGETED") {
    out.reason = "FICTION with factual/world-building accuracy needs; only the targeted subset is researched.";
    out.fictionalCore = true;
    out.targetedResearchTopics = topics;
  } else {
    out.reason = "Original fiction needs no research; continue toward story development.";
    out.next = "STORY_DEVELOPMENT";
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1G.1B — Research Plan + Question Planner (deterministic, no LLM).
// ---------------------------------------------------------------------------

function factualQuestions(topic, mode) {
  if (TUTORIAL_MODES.indexOf(mode) !== -1) {
    return {
      criticalQuestions: [
        "What are the exact prerequisites, steps, and expected outcomes for \"" + topic + "\"?",
        "What official documentation or authoritative reference defines correct behavior for \"" + topic + "\"?",
        "What common errors, edge cases, or version differences affect \"" + topic + "\"?",
        "What must be verified (commands, APIs, observable behavior) before demonstrating \"" + topic + "\"?"
      ],
      supportingQuestions: [
        "What audience skill level does \"" + topic + "\" assume, and what background must be established?",
        "What minimal demonstration scope proves \"" + topic + "\" without unnecessary breadth?"
      ],
      optionalQuestions: [
        "What advanced tips or alternatives around \"" + topic + "\" help if budget allows?"
      ]
    };
  }
  return {
    criticalQuestions: [
      "What is the documented timeline of \"" + topic + "\" (key dates, sequence, participants)?",
      "What primary evidence (records, artifacts, measurements, official sources) supports the core claims about \"" + topic + "\"?",
      "Which identities, dates, locations, and numbers in \"" + topic + "\" must be verified before scripting?",
      "What are the major factual disputes or competing interpretations about \"" + topic + "\"?"
    ],
    supportingQuestions: [
      "What historical or domain context is needed to explain \"" + topic + "\" to the target audience?",
      "What do reputable experts conclude about \"" + topic + "\", and with what caveats?",
      "What comparisons or precedents clarify \"" + topic + "\" without distorting it?"
    ],
    optionalQuestions: [
      "What color or detail about \"" + topic + "\" would enrich the narrative without affecting truthfulness?"
    ]
  };
}

function hybridQuestions(topic) {
  return {
    criticalQuestions: [
      "What is verifiably documented about \"" + topic + "\" (dates, places, named sources)?",
      "Where and when did the legend or folklore around \"" + topic + "\" originate, and how has it changed across retellings?",
      "Which accounts of \"" + topic + "\" are first-hand testimony versus repeated or derived retellings?",
      "Which claims about \"" + topic + "\" lack independent support, and what alternative (non-paranormal) explanations exist?",
      "Where is the boundary between documented material and fictionalized adaptation for \"" + topic + "\"?"
    ],
    supportingQuestions: [
      "What cultural or local context explains why the \"" + topic + "\" narrative persists?",
      "What contradictions exist between retellings of \"" + topic + "\", and how should they be framed (never flattened)?"
    ],
    optionalQuestions: [
      "What atmospheric detail about \"" + topic + "\" aids storytelling without asserting unverified claims as fact?"
    ]
  };
}

function targetedQuestions(topic, topics) {
  var critical = topics.map(function (t) {
    return "What is documented about " + t.trim() + " relevant to the setting of \"" + topic + "\", so the fictional world stays plausible?";
  });
  critical.push("What are the limits of the targeted scope: which story elements of \"" + topic + "\" must stay fiction and need no evidence?");
  return {
    criticalQuestions: critical,
    supportingQuestions: [
      "Which common misconceptions in the targeted areas must the story avoid repeating as fact?"
    ],
    optionalQuestions: []
  };
}

function researchGoalFor(contentClass, topic, mode, audience, platform, topics) {
  if (contentClass === "HYBRID") {
    return "Separate documented facts, local folklore, witness testimony, and speculation about \"" + topic +
      "\" for a documentary-horror narrative (" + mode + ", " + audience + ", " + platform +
      "), preserving FACT / FOLKLORE / TESTIMONY / SPECULATION / FICTIONALIZED_ELEMENT labels; never present paranormal claims as proven fact.";
  }
  if (contentClass === "FICTION") {
    return "Verify only the targeted world-building details (" + topics.join("; ") +
      ") needed to make the fictional setting of \"" + topic +
      "\" plausible; the fictional plot itself requires no evidence and no citations.";
  }
  return "Establish the documented timeline, primary evidence, major interpretations, and unresolved disputes about \"" + topic +
    "\" needed to support a " + audience + " " + platform + " video (" + mode +
    "), without stating unverified claims as fact.";
}

function normalizeQuestion(q) {
  return String(q).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function dedupeQuestions(groups) {
  var seen = {};
  var out = {};
  ["criticalQuestions", "supportingQuestions", "optionalQuestions"].forEach(function (key) {
    out[key] = [];
    (groups[key] || []).forEach(function (q) {
      var n = normalizeQuestion(q);
      if (!n || seen[n]) return;
      seen[n] = true;
      out[key].push(q);
    });
  });
  return out;
}

function buildResearchPlan(input) {
  var opts = input || {};
  var projectId = opts.projectId;
  var topic = opts.topic;
  if (typeof projectId !== "string" || !projectId.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "buildResearchPlan requires a non-empty projectId." };
  }
  if (typeof topic !== "string" || !topic.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "buildResearchPlan requires a non-empty topic." };
  }
  var contentClass = opts.contentClass;
  if (!contentClassLib.isValidContentClass(contentClass)) {
    return { ok: false, code: "INVALID_CONTENT_CLASS", message: "buildResearchPlan requires contentClass FACTUAL | FICTION | HYBRID." };
  }

  // ROADMAP V6 delta: optional Creative Brief fills audience/platform gaps and
  // links via stable ref. Absent brief => byte-identical pre-V6 behavior.
  var briefRef = null;
  if (opts.creativeBrief !== undefined && opts.creativeBrief !== null) {
    var briefMod;
    try {
      briefMod = require("./research-evidence/creative-brief.js");
    } catch (e) {
      return { ok: false, code: "CREATIVE_BRIEF_INVALID", message: "Creative Brief module unavailable: " + e.message };
    }
    if (!briefMod.validateBriefSchema(opts.creativeBrief)) {
      return { ok: false, code: "CREATIVE_BRIEF_INVALID", message: "creativeBrief failed schema validation." };
    }
    var applied = briefMod.applyBriefToPlanInput(opts.creativeBrief, { audience: opts.audience, platform: opts.platform });
    if (applied.planInput.audience !== undefined) opts = { ...opts, audience: applied.planInput.audience };
    if (applied.planInput.platform !== undefined) opts = { ...opts, platform: applied.planInput.platform };
    briefRef = applied.briefRef;
  }

  var gate = resolveResearchRequirement(contentClass, {
    targetedResearchTopics: opts.targetedResearchTopics,
    skipResearch: opts.skipResearch
  });
  if (!gate.ok) return gate;
  if (gate.decision === "NOT_REQUIRED") {
    return { ok: false, code: "RESEARCH_NOT_REQUIRED", message: "FICTION without targeted factual needs requires no Research Plan; continue toward story development." };
  }

  var topics = gate.decision === "OPTIONAL_TARGETED" ? gate.targetedResearchTopics : [];
  if (gate.decision === "OPTIONAL_TARGETED") {
    if (topics.length > MAX_TARGETED_TOPICS) {
      return { ok: false, code: "INVALID_TARGETED_SCOPE", message: "Too many targeted topics (" + topics.length + " > " + MAX_TARGETED_TOPICS + "); narrow the scope." };
    }
  }

  var platform = normalizePlatform(opts.platform);
  if (platform && platform.invalid) {
    return { ok: false, code: "INVALID_PLATFORM", message: "Unknown platform '" + platform.invalid + "'; expected youtube | tiktok." };
  }
  var mode = typeof opts.contentMode === "string" && opts.contentMode ? opts.contentMode : "unspecified-mode";
  var audience = typeof opts.audience === "string" && opts.audience.trim() ? opts.audience.trim() : "general";

  var groups = gate.decision === "OPTIONAL_TARGETED"
    ? targetedQuestions(topic, topics)
    : (contentClass === "HYBRID" ? hybridQuestions(topic) : factualQuestions(topic, mode));
  groups = dedupeQuestions(groups);

  var plan = {
    version: PLAN_VERSION,
    projectId: projectId,
    topic: topic,
    researchGoal: researchGoalFor(contentClass, topic, mode, audience, platform || "unspecified-platform", topics),
    contentClass: contentClass,
    criticalQuestions: groups.criticalQuestions
  };
  if (platform) plan.platform = platform;
  if (typeof opts.contentMode === "string" && opts.contentMode) plan.contentMode = opts.contentMode;
  plan.audience = audience;
  if (typeof opts.timeScope === "string" && opts.timeScope.trim()) plan.timeScope = opts.timeScope.trim();
  if (typeof opts.geographicScope === "string" && opts.geographicScope.trim()) plan.geographicScope = opts.geographicScope.trim();
  plan.freshnessRequirement = typeof opts.freshnessRequirement === "string" && opts.freshnessRequirement.trim()
    ? opts.freshnessRequirement.trim()
    : "EVERGREEN_OK; CURRENT_STATE claims require dated sources with access dates.";
  plan.sourcePriority = contentClass === "HYBRID" ? HYBRID_SOURCES.slice() : (gate.decision === "OPTIONAL_TARGETED" ? TARGETED_SOURCES.slice() : FACTUAL_SOURCES.slice());
  if (groups.supportingQuestions.length > 0) plan.supportingQuestions = groups.supportingQuestions;
  if (groups.optionalQuestions.length > 0) plan.optionalQuestions = groups.optionalQuestions;
  plan.stopCriteria = gate.decision === "OPTIONAL_TARGETED" ? TARGETED_STOP_CRITERIA : REQUIRED_STOP_CRITERIA;
  plan.researchBudget = typeof opts.researchBudget === "string" && opts.researchBudget.trim()
    ? opts.researchBudget.trim()
    : BUDGETS[gate.decision === "OPTIONAL_TARGETED" ? "OPTIONAL_TARGETED" : contentClass];
  plan.deepResearchAllowed = opts.deepResearchAllowed === true;
  plan.researchRequired = gate.decision;
  plan.researchMode = opts.researchMode === "DEEP" ? "DEEP" : "STANDARD";
  if (briefRef) plan.creativeBriefRef = briefRef;
  return { ok: true, plan: plan, researchRequired: gate.decision };
}

// ---------------------------------------------------------------------------
// Validator: Layer 1 = JSON Schema (ajv), Layer 2 = semantics (below).
// Status: VALID | INVALID | REVIEW_REQUIRED with errorCode/path/message.
// ---------------------------------------------------------------------------

function validateResearchPlanSchema(plan) {
  var schemaPath = path.join(__dirname, "..", "schemas", "research-plan.schema.json");
  var schema = JSON.parse(fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, ""));
  var ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  var validate = ajv.compile(schema);
  var valid = validate(plan);
  return { valid: valid, errors: validate.errors || [] };
}

function err(code, msg, pathStr, severity) {
  return { code: code, path: pathStr || "", message: msg, severity: severity || "ERROR" };
}

function validateResearchPlanSemantics(plan, context) {
  var ctx = context || {};
  var errors = [];
  var warnings = [];

  if (!plan || typeof plan !== "object") {
    return { status: "INVALID", errors: [err("RESEARCH_PLAN_INVALID", "Research plan must be an object.")], warnings: warnings };
  }

  if (!contentClassLib.isValidContentClass(plan.contentClass)) {
    errors.push(err("INVALID_CONTENT_CLASS", "contentClass must be FACTUAL | FICTION | HYBRID.", "contentClass"));
  }

  var required = plan.researchRequired || ctx.researchRequired;
  if (plan.contentClass === "FACTUAL" && required && required !== "REQUIRED") {
    errors.push(err("RESEARCH_REQUIREMENT_MISMATCH", "FACTUAL must be REQUIRED, got '" + required + "'.", "researchRequired"));
  }
  if (plan.contentClass === "HYBRID" && required && required !== "REQUIRED") {
    errors.push(err("RESEARCH_REQUIREMENT_MISMATCH", "HYBRID must be REQUIRED, got '" + required + "'.", "researchRequired"));
  }
  if (plan.contentClass === "FICTION" && required === "REQUIRED") {
    errors.push(err("RESEARCH_REQUIREMENT_MISMATCH", "FICTION must not be REQUIRED; use OPTIONAL_TARGETED or no plan.", "researchRequired"));
  }
  if (required === "NOT_REQUIRED") {
    errors.push(err("RESEARCH_NOT_REQUIRED", "A plan asserting NOT_REQUIRED is contradictory; fiction without research needs no plan.", "researchRequired"));
  }

  // Mode/class conflict surfaces for review instead of silent overwrite.
  if (typeof plan.contentMode === "string" && plan.contentMode) {
    var mapped = contentClassLib.classOfModeId(plan.contentMode);
    if (mapped !== null && mapped !== plan.contentClass) {
      return {
        status: "REVIEW_REQUIRED",
        errors: [err("CONTENT_MODE_CLASS_CONFLICT", "contentMode '" + plan.contentMode + "' canonically maps to '" +
          mapped + "' but plan declares '" + plan.contentClass + "'.", "contentMode")],
        warnings: warnings
      };
    }
  }

  var goal = typeof plan.researchGoal === "string" ? plan.researchGoal.trim() : "";
  if (goal.length < 24 || GENERIC_GOAL_PHRASES.some(function (p) { return goal.toLowerCase() === p || goal.toLowerCase().indexOf(p) === 0 && goal.length < 40; })) {
    errors.push(err("RESEARCH_PLAN_INVALID", "researchGoal must be specific enough to guide search (not a generic one-liner).", "researchGoal"));
  }

  var needsCritical = required === "REQUIRED" || required === "OPTIONAL_TARGETED" ||
    (!required && (plan.contentClass === "FACTUAL" || plan.contentClass === "HYBRID"));
  var critical = Array.isArray(plan.criticalQuestions) ? plan.criticalQuestions : [];
  if (needsCritical && critical.length === 0) {
    errors.push(err("RESEARCH_PLAN_MISSING_CRITICAL_QUESTIONS", "REQUIRED research must define non-empty criticalQuestions.", "criticalQuestions"));
  }

  if (typeof plan.stopCriteria !== "string" || !plan.stopCriteria.trim()) {
    errors.push(err("RESEARCH_PLAN_INVALID_STOP_CRITERIA", "Every non-empty plan must define explicit stopCriteria.", "stopCriteria"));
  }

  // Question hygiene: non-empty, no exact/near duplicates across groups.
  var seen = {};
  ["criticalQuestions", "supportingQuestions", "optionalQuestions"].forEach(function (key) {
    var list = plan[key];
    if (list === undefined) return;
    if (!Array.isArray(list)) {
      errors.push(err("RESEARCH_PLAN_INVALID", key + " must be an array of strings.", key));
      return;
    }
    list.forEach(function (q, i) {
      var qp = key + "[" + i + "]";
      if (typeof q !== "string" || !q.trim()) {
        errors.push(err("RESEARCH_PLAN_INVALID", "Empty research question is not answerable.", qp));
        return;
      }
      var n = normalizeQuestion(q);
      if (seen[n]) {
        errors.push(err("RESEARCH_PLAN_DUPLICATE_QUESTIONS", "Duplicate/near-identical question also at " + seen[n] + ".", qp));
      } else {
        seen[n] = qp;
      }
    });
  });

  // Targeted fiction scope: questions cover world-building only, never proof
  // that fictional entities exist.
  if (required === "OPTIONAL_TARGETED" || plan.contentClass === "FICTION") {
    ["criticalQuestions", "supportingQuestions", "optionalQuestions"].forEach(function (key) {
      (plan[key] || []).forEach(function (q, i) {
        var low = String(q).toLowerCase();
        if (FICTION_SCOPE_VIOLATIONS.some(function (p) { return low.indexOf(p) !== -1; })) {
          errors.push(err("FICTION_SCOPE_VIOLATION", "Targeted fiction research must not seek proof that fictional entities exist.", key + "[" + i + "]"));
        }
      });
    });
  }

  if (plan.platform !== undefined) {
    var np = normalizePlatform(plan.platform);
    if (typeof np !== "string") {
      errors.push(err("INVALID_PLATFORM", "platform must be youtube | tiktok when present.", "platform"));
    }
  }

  return { status: errors.length === 0 ? "VALID" : "INVALID", errors: errors, warnings: warnings };
}

// ---------------------------------------------------------------------------
// Facade: Topic -> Content Class -> Research Requirement -> Research Plan.
// ---------------------------------------------------------------------------

function planResearch(input) {
  var opts = input || {};
  if (typeof opts.topic !== "string" || !opts.topic.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "planResearch requires a non-empty topic." };
  }
  if (typeof opts.projectId !== "string" || !opts.projectId.trim()) {
    return { ok: false, code: "INVALID_INPUT", message: "planResearch requires a non-empty projectId." };
  }

  var cls = contentClassLib.resolveContentClass({
    contentClass: opts.contentClass,
    persistedContentClass: opts.persistedContentClass,
    contentMode: opts.contentMode,
    modeId: opts.modeId,
    customModeClass: opts.customModeClass
  });
  if (!cls.ok) return { ok: false, contentClass: cls.contentClass || null, code: cls.code, message: cls.message };

  var gate = resolveResearchRequirement(cls.contentClass, {
    targetedResearchTopics: opts.targetedResearchTopics,
    skipResearch: opts.skipResearch
  });
  if (!gate.ok) return { ok: false, contentClass: cls.contentClass, code: gate.code, message: gate.message };

  if (gate.decision === "NOT_REQUIRED") {
    return {
      ok: true,
      contentClass: cls.contentClass,
      classSource: cls.source,
      researchRequired: "NOT_REQUIRED",
      plan: null,
      next: "STORY_DEVELOPMENT",
      reason: gate.reason
    };
  }

  var built = buildResearchPlan({
    projectId: opts.projectId,
    topic: opts.topic,
    contentClass: cls.contentClass,
    contentMode: opts.contentMode || opts.modeId,
    platform: opts.platform,
    audience: opts.audience,
    timeScope: opts.timeScope,
    geographicScope: opts.geographicScope,
    freshnessRequirement: opts.freshnessRequirement,
    researchBudget: opts.researchBudget,
    deepResearchAllowed: opts.deepResearchAllowed,
    researchMode: opts.researchMode,
    targetedResearchTopics: opts.targetedResearchTopics,
    skipResearch: opts.skipResearch,
    creativeBrief: opts.creativeBrief
  });
  if (!built.ok) return { ok: false, contentClass: cls.contentClass, code: built.code, message: built.message };

  var schemaRes = validateResearchPlanSchema(built.plan);
  if (!schemaRes.valid) {
    return { ok: false, contentClass: cls.contentClass, code: "RESEARCH_PLAN_INVALID", message: "Plan failed schema validation.", details: schemaRes.errors };
  }
  var sem = validateResearchPlanSemantics(built.plan, { researchRequired: gate.decision });
  if (sem.status !== "VALID") {
    return { ok: false, contentClass: cls.contentClass, code: sem.errors[0].code, message: sem.errors[0].message, details: sem.errors };
  }

  var out = {
    ok: true,
    contentClass: cls.contentClass,
    classSource: cls.source,
    researchRequired: gate.decision,
    plan: built.plan,
    reason: gate.reason
  };
  if (gate.decision === "OPTIONAL_TARGETED") {
    out.fictionalCore = true;
    out.targetedResearchTopics = gate.targetedResearchTopics;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence: projects/<id>/research/research-plan.json (idempotent).
// ---------------------------------------------------------------------------

function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(function (k) {
      return JSON.stringify(k) + ":" + stableStringify(value[k]);
    }).join(",") + "}";
  }
  return JSON.stringify(value);
}

function planFilePath(projectDir) {
  return path.join(projectDir, PLAN_REL_PATH);
}

function saveResearchPlan(projectDir, plan) {
  if (typeof projectDir !== "string" || !projectDir) {
    return { saved: false, code: "INVALID_INPUT", message: "projectDir is required." };
  }
  var filePath = planFilePath(projectDir);
  try {
    if (fs.existsSync(filePath)) {
      var existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (stableStringify(existing) === stableStringify(plan)) {
        return { saved: false, code: "UNCHANGED", path: filePath, reason: "Identical plan already persisted; no duplicate artifact written." };
      }
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(plan, null, 2) + "\n", "utf8");
    return { saved: true, path: filePath };
  } catch (e) {
    return { saved: false, code: "PERSISTENCE_FAILED", message: String(e && e.message || e) };
  }
}

module.exports = {
  PLAN_VERSION: PLAN_VERSION,
  RESEARCH_DECISIONS: RESEARCH_DECISIONS,
  TUTORIAL_MODES: TUTORIAL_MODES,
  MAX_TARGETED_TOPICS: MAX_TARGETED_TOPICS,
  normalizePlatform: normalizePlatform,
  resolveResearchRequirement: resolveResearchRequirement,
  buildResearchPlan: buildResearchPlan,
  validateResearchPlanSchema: validateResearchPlanSchema,
  validateResearchPlanSemantics: validateResearchPlanSemantics,
  planResearch: planResearch,
  saveResearchPlan: saveResearchPlan,
  planFilePath: planFilePath
};
