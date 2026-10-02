"use strict";
// lib/transcript-alignment.js — STEP-11 Branch B
// Compares planned script text vs measured STT transcript to classify narration drift.
// Never fabricates timing/metadata; pure string comparison only.

function normalizeForAlignment(text) {
  if (text === null || text === undefined) return "";
  var s = String(text);
  // NFKC unicode normalize
  try {
    s = s.normalize("NFKC");
  } catch (e) { /* ignore */ }
  // Normalize curly quotes/dashes to ASCII
  s = s
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\uFF07]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]/g, '"')
    .replace(/[\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u2026]/g, "...")
    .replace(/[\u00A0\u2000-\u200B\u2028\u2029\u3000]/g, " ");
  // Case-fold for comparison (returned string is folded; originals kept by caller)
  s = s.toLowerCase();
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Strip leading/trailing punctuation spaces
  s = s.replace(/^[\s\.,;:!?'"\-–—(){}\[\]<>]+/, "");
  s = s.replace(/[\s\.,;:!?'"\-–—(){}\[\]<>]+$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeLight(text) {
  // Same as normalizeForAlignment but WITHOUT case folding / punctuation stripping
  // used only to detect punctuation-only differences: we compare folded versions.
  return normalizeForAlignment(text);
}

function stripPunctLower(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}<>–—\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

var FILLER_SET = {
  "uh": true, "um": true, "ah": true, "er": true, "like": true, "you-know": true,
  "you": false // guard: "you know" as two tokens handled below
};

function isFillerToken(tok) {
  var t = String(tok || "").toLowerCase();
  if (FILLER_SET[t]) return true;
  return false;
}

function tokenize(s) {
  s = String(s || "").trim();
  if (!s) return [];
  return s.split(/\s+/).filter(Boolean);
}

var NEGATION_WORDS = {
  "not": true, "no": true, "never": true, "neither": true, "none": true, "nor": true,
  "can't": true, "cant": true, "cannot": true, "won't": true, "wont": true,
  "don't": true, "dont": true, "doesn't": true, "doesnt": true,
  "isn't": true, "isnt": true, "aren't": true, "arent": true,
  "wasn't": true, "wasnt": true, "weren't": true, "werent": true,
  "without": true
};

var UNIT_WORDS = {
  "ms": true, "s": true, "sec": true, "secs": true, "second": true, "seconds": true,
  "minute": true, "minutes": true, "min": true, "mins": true,
  "hour": true, "hours": true, "h": true,
  "kg": true, "g": true, "km": true, "m": true, "cm": true, "mm": true,
  "percent": true, "%": true, "hz": true, "khz": true, "db": true,
  "lufs": true, "fps": true, "px": true, "gb": true, "mb": true
};

var MONTHS = {
  "january": true, "february": true, "march": true, "april": true, "may": true,
  "june": true, "july": true, "august": true, "september": true, "october": true,
  "november": true, "december": true,
  "jan": true, "feb": true, "mar": true, "apr": true, "jun": true, "jul": true,
  "aug": true, "sep": true, "sept": true, "oct": true, "nov": true, "dec": true
};

function hasDigit(s) { return /\d/.test(String(s || "")); }
function isDateLike(s) {
  var t = String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^\d{4}$/.test(t)) return true;
  if (MONTHS[t]) return true;
  return false;
}
function isUnitLike(s) {
  var t = String(s || "").toLowerCase().replace(/[^a-z%]/g, "");
  if (UNIT_WORDS[t]) return true;
  // attached forms like "44.1khz", "10px", "50%"
  if (/^[\d.,]+(ms|s|sec|seconds|minutes|min|hours|kg|g|km|cm|mm|hz|khz|db|lufs|fps|px|gb|mb|percent|%)$/.test(String(s || "").toLowerCase())) return true;
  return false;
}

function alignScriptTranscript(scriptText, transcriptText) {
  var rawScript = scriptText === null || scriptText === undefined ? "" : String(scriptText);
  var rawTranscript = transcriptText === null || transcriptText === undefined ? "" : String(transcriptText);
  var normalizedScript = normalizeForAlignment(rawScript);
  var normalizedTranscript = normalizeForAlignment(rawTranscript);

  // Empty transcript → UNKNOWN
  if (!normalizedTranscript || tokenize(normalizedTranscript).length === 0) {
    return {
      classification: "UNKNOWN",
      normalizedScript: normalizedScript,
      normalizedTranscript: normalizedTranscript,
      differences: [{ reason: "EMPTY_TRANSCRIPT", detail: "Transcript empty after normalization" }],
      truncated: false
    };
  }

  // Exact normalized equal → MATCH
  if (normalizedScript === normalizedTranscript) {
    return {
      classification: "MATCH",
      normalizedScript: normalizedScript,
      normalizedTranscript: normalizedTranscript,
      differences: [],
      truncated: false
    };
  }

  var scriptTokens = tokenize(normalizedScript);
  var transcriptTokens = tokenize(normalizedTranscript);

  // Truncation: transcript words < 50% of script
  var truncated = false;
  if (scriptTokens.length > 0 && transcriptTokens.length < scriptTokens.length * 0.5) {
    truncated = true;
    return {
      classification: "MATERIAL_DIFFERENCE",
      normalizedScript: normalizedScript,
      normalizedTranscript: normalizedTranscript,
      differences: [{
        reason: "TRUNCATED",
        detail: "Transcript word count " + transcriptTokens.length + " < 50% of script " + scriptTokens.length
      }],
      truncated: true,
      details: {
        scriptWords: scriptTokens.length,
        transcriptWords: transcriptTokens.length,
        changedTokens: diffChangedTokens(scriptTokens, transcriptTokens, 20)
      }
    };
  }

  // Punctuation/whitespace/quotes/case-only → MINOR
  // Compare stripped-punctuation-lowercase forms of raw inputs.
  var rawScriptStripped = stripPunctLower(
    String(rawScript).normalize ? String(rawScript).normalize("NFKC") : String(rawScript)
  );
  var rawTranscriptStripped = stripPunctLower(
    String(rawTranscript).normalize ? String(rawTranscript).normalize("NFKC") : String(rawTranscript)
  );
  // Also normalize curly quotes/dashes before stripping
  function asciiFold(s) {
    return String(s)
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035\u02BC\uFF07]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\uFF02]/g, '"')
      .replace(/[\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
  }
  rawScriptStripped = stripPunctLower(asciiFold(String(rawScript)));
  rawTranscriptStripped = stripPunctLower(asciiFold(String(rawTranscript)));
  // Collapse whitespace
  rawScriptStripped = rawScriptStripped.replace(/\s+/g, " ").trim();
  rawTranscriptStripped = rawTranscriptStripped.replace(/\s+/g, " ").trim();
  if (rawScriptStripped === rawTranscriptStripped) {
    return {
      classification: "MINOR_DIFFERENCE",
      normalizedScript: normalizedScript,
      normalizedTranscript: normalizedTranscript,
      differences: [{ reason: "PUNCTUATION_CASE_WHITESPACE", detail: "Differences only in punctuation/whitespace/quotes/case" }],
      truncated: false
    };
  }

  // Token-level analysis for material reasons.
  // Build simple LCS-free comparison: walk with counts.
  var changed = diffChangedTokens(scriptTokens, transcriptTokens, 20);

  // Detect changed numbers: any \d in differing tokens
  // Differing tokens = tokens in changed list
  var differingJoined = " " + changed.join(" ") + " ";
  var hasChangedNumber = changed.some(function (t) { return hasDigit(t); });

  // Negation change: negation word present on one side but not other (compare sets)
  function negSet(tokens) {
    var set = {};
    tokens.forEach(function (t) {
      var k = String(t).toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
      if (NEGATION_WORDS[k]) set[k] = true;
    });
    return set;
  }
  var negS = negSet(scriptTokens);
  var negT = negSet(transcriptTokens);
  var negDiff = false;
  Object.keys(negS).forEach(function (k) { if (!negT[k]) negDiff = true; });
  Object.keys(negT).forEach(function (k) { if (!negS[k]) negDiff = true; });
  // Also "without-affix": without- prefix difference
  if (!negDiff) {
    var woS = scriptTokens.filter(function (t) { return /^without-/i.test(t); }).length;
    var woT = transcriptTokens.filter(function (t) { return /^without-/i.test(t); }).length;
    if (woS !== woT) negDiff = true;
  }

  // Unit / date change: differing tokens include unit words or date-like, or month names differ
  var unitDiff = changed.some(function (t) {
    var clean = String(t).toLowerCase().replace(/^[^a-z0-9%]+|[^a-z0-9%]+$/g, "");
    return isUnitLike(clean) || isDateLike(clean) || hasDigit(t);
  });
  // Refine: unit change only counts if a unit/date token actually differs between sides.
  // Check unit tokens sets differ
  function unitTokens(tokens) {
    return tokens.filter(function (t) {
      var clean = String(t).toLowerCase().replace(/^[^a-z0-9%]+|[^a-z0-9%]+$/g, "");
      return isUnitLike(clean) || isDateLike(clean);
    }).map(function (t) { return String(t).toLowerCase(); });
  }
  var uS = unitTokens(scriptTokens).join("|");
  var uT = unitTokens(transcriptTokens).join("|");
  var unitChanged = (uS !== uT);

  if (hasChangedNumber) {
    return material("NUMBER", "Changed number-like token detected", scriptTokens, transcriptTokens, changed);
  }
  if (negDiff) {
    return material("NEGATION", "Negation word added/removed/changed", scriptTokens, transcriptTokens, changed);
  }
  if (unitChanged) {
    var reason = "UNIT";
    // Date-specific?
    var dS = unitTokens(scriptTokens).join(" ");
    var dT = unitTokens(transcriptTokens).join(" ");
    if (/(\b\d{4}\b|january|february|march|april|may|june|july|august|september|october|november|december|\bjan\b|\bfeb\b|\bmar\b|\bapr\b|\bjun\b|\bjul\b|\baug\b|\bsep\b|\bsept\b|\boct\b|\bnov\b|\bdec\b)/i.test(dS + " " + dT) && dS !== dT) reason = "DATE";
    return material(reason, "Unit/date token changed", scriptTokens, transcriptTokens, changed);
  }

  // Content vs filler-only
  // Compute added/removed/substituted content words outside filler set.
  var contentDiff = changedContentTokens(scriptTokens, transcriptTokens);
  if (contentDiff.length === 0) {
    return {
      classification: "MINOR_DIFFERENCE",
      normalizedScript: normalizedScript,
      normalizedTranscript: normalizedTranscript,
      differences: [{ reason: "FILLER_ONLY", detail: "Only filler words differ (uh/um/ah/er/like/you-know)" }],
      truncated: false
    };
  }
  return material("CONTENT_CHANGE", "Added/removed/substituted content: " + contentDiff.slice(0, 10).join(", "), scriptTokens, transcriptTokens, changed);

  function material(reason, detail, sToks, tToks, ch) {
    return {
      classification: "MATERIAL_DIFFERENCE",
      normalizedScript: normalizedScript,
      normalizedTranscript: normalizedTranscript,
      differences: [{ reason: reason, detail: detail }],
      truncated: false,
      details: { scriptWords: sToks.length, transcriptWords: tToks.length, changedTokens: ch }
    };
  }
}

function diffChangedTokens(a, b, max) {
  // Simple diff: frequency-based — tokens whose counts differ, plus positional mismatches capped.
  var out = [];
  var counts = {};
  a.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
  b.forEach(function (t) { counts[t] = (counts[t] || 0) - 1; });
  // positional walk
  var n = Math.max(a.length, b.length);
  var seen = {};
  for (var i = 0; i < n; i++) {
    var ta = a[i], tb = b[i];
    if (ta !== tb) {
      if (ta !== undefined && !seen["a:" + i + ":" + ta]) { out.push(ta); seen["a:" + i + ":" + ta] = 1; }
      if (tb !== undefined && !seen["b:" + i + ":" + tb]) { out.push(tb); seen["b:" + i + ":" + tb] = 1; }
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

function changedContentTokens(scriptTokens, transcriptTokens) {
  // tokens that differ by multiset, excluding filler
  var cs = {}, ct = {};
  scriptTokens.forEach(function (t) {
    var k = String(t).toLowerCase();
    cs[k] = (cs[k] || 0) + 1;
  });
  transcriptTokens.forEach(function (t) {
    var k = String(t).toLowerCase();
    ct[k] = (ct[k] || 0) + 1;
  });
  var keys = {};
  Object.keys(cs).forEach(function (k) { keys[k] = 1; });
  Object.keys(ct).forEach(function (k) { keys[k] = 1; });
  var out = [];
  Object.keys(keys).forEach(function (k) {
    if ((cs[k] || 0) !== (ct[k] || 0)) {
      // handle "you know" as filler bigram: skip both
      if (k === "you" || k === "know") {
        // only skip if the bigram exists on the side with surplus — best-effort: treat as filler
        // check adjacency
        var hasBigramS = hasBigram(scriptTokens, "you", "know");
        var hasBigramT = hasBigram(transcriptTokens, "you", "know");
        if (hasBigramS !== hasBigramT) return; // filler-only, skip
      }
      if (!isFillerToken(k)) out.push(k);
    }
  });
  return out;
}

function hasBigram(tokens, w1, w2) {
  for (var i = 0; i + 1 < tokens.length; i++) {
    if (String(tokens[i]).toLowerCase() === w1 && String(tokens[i + 1]).toLowerCase() === w2) return true;
  }
  return false;
}

module.exports = { normalizeForAlignment: normalizeForAlignment, alignScriptTranscript: alignScriptTranscript };
