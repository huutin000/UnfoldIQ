"use strict";

/**
 * UNFOLDIQ — Content Class Router runtime (PHASE 1G.1 Prompt 01, work item 1G.1A).
 *
 * Resolves contentClass = FACTUAL | FICTION | HYBRID with explicit precedence:
 *   1. Explicit valid user/project contentClass
 *   2. Existing persisted contentClass
 *   3. Canonical contentMode -> contentClass mapping (MODE_CLASS_MAP below — the
 *      single owner; do not scatter mappings across modules)
 *   4. Canonical custom-mode metadata declaring a class
 *   5. Otherwise -> unresolved / review required (never silently guessed)
 *
 * Title-only input with no mode/intent is AMBIGUOUS by design: the same title
 * ("The woman in room 304") can be FACTUAL investigation, HYBRID folklore, or
 * FICTION. Guessing would trigger fabricated research or fabricated story
 * treatment downstream.
 *
 * Pure deterministic functions. No network, no AI, no platform dependency.
 * Platform never decides truth class (see resolvePlatformRoute in
 * lib/v5-contract-check.js for the shared-core isolation proof).
 */

var CONTENT_CLASSES = ["FACTUAL", "FICTION", "HYBRID"];

// Canonical contentMode -> contentClass mapping. ONLY modes that actually exist
// (core/CONTENT_MODE.md suggested IDs + fiction/hybrid IDs named by the V5
// contract) are mapped. Genre-ambiguous modes (comedy, storytelling) are
// deliberately unmapped: they need an explicit class instead of a guess.
// meditation-guided is instructional wellness about real-world practice, so it
// stays FACTUAL (consistent with the schema backward-compatible default).
var MODE_CLASS_MAP = {
  "historical-documentary": "FACTUAL",
  "technical-explainer": "FACTUAL",
  tutorial: "FACTUAL",
  "educational-explainer": "FACTUAL",
  "news-explainer": "FACTUAL",
  "product-review": "FACTUAL",
  comparison: "FACTUAL",
  listicle: "FACTUAL",
  commentary: "FACTUAL",
  "data-explainer": "FACTUAL",
  "meditation-guided": "FACTUAL",
  "cinematic-fiction": "FICTION",
  "horror-fiction": "FICTION",
  "original-story": "FICTION",
  "urban-legend-documentary": "HYBRID",
  "paranormal-documentary": "HYBRID"
};

function isValidContentClass(value) {
  return CONTENT_CLASSES.indexOf(value) !== -1;
}

// Single owner for mode -> class lookup. Unknown/custom modeIds return null
// (caller must require explicit class or custom-mode metadata).
function classOfModeId(modeId) {
  if (typeof modeId !== "string" || !modeId) return null;
  return Object.prototype.hasOwnProperty.call(MODE_CLASS_MAP, modeId)
    ? MODE_CLASS_MAP[modeId]
    : null;
}

function isCustomModeId(modeId) {
  if (typeof modeId !== "string" || !modeId) return false;
  if (classOfModeId(modeId) !== null) return false;
  return modeId.indexOf("custom-") === 0 || true;
}

function resolveContentClass(input) {
  var opts = input || {};
  var explicit = opts.contentClass;
  var persisted = opts.persistedContentClass;
  var modeId = opts.contentMode || opts.modeId;
  var customModeClass = opts.customModeClass;

  // Explicit choice must be a valid enum value, never silently coerced.
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    if (!isValidContentClass(explicit)) {
      return {
        ok: false,
        code: "INVALID_CONTENT_CLASS",
        message: "Explicit contentClass '" + String(explicit) + "' is not one of FACTUAL | FICTION | HYBRID."
      };
    }
    // Explicit vs mapped-mode conflict surfaces instead of overwriting intent.
    var mapped = classOfModeId(modeId);
    if (mapped !== null && mapped !== explicit) {
      return {
        ok: false,
        code: "CONTENT_MODE_CLASS_CONFLICT",
        message: "Explicit contentClass '" + explicit + "' conflicts with contentMode '" +
          modeId + "' (canonical class '" + mapped + "'). Resolve explicitly; intent was not overwritten.",
        contentClass: explicit,
        modeId: modeId,
        mappedClass: mapped
      };
    }
    return { ok: true, contentClass: explicit, source: "EXPLICIT", reason: "Valid explicit user/project choice preserved." };
  }

  if (isValidContentClass(persisted)) {
    var persistedMapped = classOfModeId(modeId);
    if (persistedMapped !== null && persistedMapped !== persisted) {
      return {
        ok: false,
        code: "CONTENT_MODE_CLASS_CONFLICT",
        message: "Persisted contentClass '" + persisted + "' conflicts with contentMode '" +
          modeId + "' (canonical class '" + persistedMapped + "').",
        contentClass: persisted,
        modeId: modeId,
        mappedClass: persistedMapped
      };
    }
    return { ok: true, contentClass: persisted, source: "PERSISTED", reason: "Existing persisted contentClass reused." };
  }

  var fromMode = classOfModeId(modeId);
  if (fromMode !== null) {
    return { ok: true, contentClass: fromMode, source: "MODE_MAP", reason: "Canonical contentMode '" + modeId + "' maps to '" + fromMode + "'." };
  }

  if (isValidContentClass(customModeClass)) {
    return { ok: true, contentClass: customModeClass, source: "CUSTOM_MODE_METADATA", reason: "Canonical custom-mode metadata declares '" + customModeClass + "'." };
  }

  return {
    ok: false,
    code: "AMBIGUOUS_CONTENT_CLASS",
    message: "Cannot resolve content class: no explicit class, no persisted class, and " +
      (modeId ? "contentMode '" + modeId + "' carries no canonical class." : "no contentMode provided.") +
      " User confirmation required; content was not silently defaulted.",
    modeId: modeId || null
  };
}

module.exports = {
  CONTENT_CLASSES: CONTENT_CLASSES,
  MODE_CLASS_MAP: MODE_CLASS_MAP,
  isValidContentClass: isValidContentClass,
  classOfModeId: classOfModeId,
  isCustomModeId: isCustomModeId,
  resolveContentClass: resolveContentClass
};
