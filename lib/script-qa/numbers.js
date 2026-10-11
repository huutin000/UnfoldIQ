"use strict";

/**
 * Generic spoken-number verifier (no topic knowledge). Parses quantities that
 * a narrator would SAY ("twenty thousand two hundred kilometers", "seven
 * hundredths of a second") and quantities that evidence WRITES ("20,200 km",
 * "1 ns = 30 cm"), converts to base units, and compares with an explicit
 * tolerance policy:
 *   MATCH            exact, or equal after rounding to the spoken precision
 *   MATCH_QUALIFIED  satisfies an "at least / at most / under" bound
 *   COARSE           within 50% but not rounding-equal: an approximation a
 *                    human must accept (REVIEW)
 *   MISMATCH         no evidence quantity is within 50% (FAIL)
 *   NO_EVIDENCE      no evidence quantity of that dimension at all (FAIL)
 */

const UNITS = [
  [/^(kilometers?|kilometres?|km)$/i, "length", 1000],
  [/^(meters?|metres?|m)$/i, "length", 1],
  [/^(centimeters?|centimetres?|cm)$/i, "length", 0.01],
  [/^(millimeters?|millimetres?|mm)$/i, "length", 0.001],
  [/^(microseconds?|µs|μs|us)$/i, "time", 1e-6],
  [/^(nanoseconds?|ns)$/i, "time", 1e-9],
  [/^(milliseconds?|ms)$/i, "time", 1e-3],
  [/^(seconds?|s|sec)$/i, "time", 1],
  [/^(minutes?|min)$/i, "time", 60],
  [/^(hours?|h)$/i, "time", 3600],
  [/^days?$/i, "time", 86400],
  [/^(degrees?|°)$/i, "angle", 1],
  [/^(percent|%)$/i, "percent", 1],
  [/^radii$/i, "radii", 1],
];

const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULT = { thousand: 1e3, million: 1e6, billion: 1e9 };
const FRACTION = { tenth: 0.1, tenths: 0.1, hundredth: 0.01, hundredths: 0.01, thousandth: 1e-3, thousandths: 1e-3, millionth: 1e-6, millionths: 1e-6, billionth: 1e-9, billionths: 1e-9 };
const QUALIFIERS = {
  approx: ["about", "roughly", "nearly", "almost", "around", "approximately", "estimated"],
  lower: ["at least", "over", "more than", "above"],
  upper: ["at most", "under", "less than", "within", "up to", "below", "no more than"],
  exact: ["exactly"],
};

function unitOf(word) {
  if (!word) return null;
  for (const [re, dimension, factor] of UNITS) if (re.test(word)) return { dimension, factor };
  return null;
}

function qualifierBefore(tokens, i) {
  const two = (tokens[i - 2] || "") + " " + (tokens[i - 1] || "");
  const one = tokens[i - 1] || "";
  for (const [kind, words] of Object.entries(QUALIFIERS)) {
    if (words.includes(two) || words.includes(one)) return kind;
  }
  return "plain";
}

/** Significant figures a spoken number carries ("twenty thousand two hundred" = 3, "three hundred" = 1). */
function sigFigs(value) {
  if (!Number.isFinite(value) || value === 0) return 1;
  const s = Math.abs(value).toExponential(12).replace(/0+e/, "e");
  return s.split("e")[0].replace(".", "").length;
}

function roundSig(value, sf) {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Number(value.toPrecision(Math.max(1, sf)));
}

/** Parse "twenty thousand two hundred" style phrases starting at tokens[i]. Returns {value, next, sf} or null. */
function parseNumberAt(tokens, i) {
  let total = 0;
  let current = 0;
  let seen = false;
  let j = i;
  let sigWords = 0;
  for (; j < tokens.length; j += 1) {
    const t = tokens[j];
    if (t in SMALL) { current += SMALL[t]; seen = true; sigWords += 1; }
    else if (t in TENS) { current += TENS[t]; seen = true; sigWords += 1; }
    else if (t === "hundred") { if (!seen) return null; current = (current || 1) * 100; sigWords += 1; }
    else if (t in MULT) { if (!seen) return null; total += (current || 1) * MULT[t]; current = 0; sigWords += 1; }
    else if (t === "and" && seen && tokens[j + 1] === "a" && tokens[j + 2] === "half") { current += 0.5; j += 3; break; }
    else break;
  }
  if (!seen) return null;
  let value = total + current;
  // decimal: "two point three"
  if (tokens[j] === "point") {
    let frac = "";
    let k = j + 1;
    while (k < tokens.length && tokens[k] in SMALL && SMALL[tokens[k]] < 10) { frac += SMALL[tokens[k]]; k += 1; }
    if (frac) { value = Number(`${value}.${frac}`); j = k; }
  }
  return { value, next: j };
}

/** Quantities a narrator says. Returns [{text, value, base, dimension, qualifier, sf}]. */
function spokenQuantities(text) {
  const tokens = String(text).toLowerCase().replace(/[^a-z0-9.%°µμ\s-]/g, " ").replace(/\.(?!\d)/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    // a tenth / a billionth
    let parsed = null;
    let start = i;
    if ((tokens[i] === "a" || tokens[i] === "one") && FRACTION[tokens[i + 1]] && !(tokens[i - 1] in SMALL)) {
      parsed = { value: 1, next: i + 1 };
    } else if (/^\d{4}$/.test(tokens[i]) && Number(tokens[i]) >= 1900 && Number(tokens[i]) <= 2100) {
      out.push({ text: tokens[i], kind: "year", value: Number(tokens[i]), qualifier: "plain" });
      continue;
    } else {
      parsed = parseNumberAt(tokens, i);
    }
    if (!parsed) continue;
    let { value, next } = parsed;
    let fraction = null;
    if (FRACTION[tokens[next]]) { fraction = FRACTION[tokens[next]]; next += 1; }
    // "parts in ten billion"
    let unit = null;
    if (tokens[next] === "parts" && tokens[next + 1] === "in") {
      const denom = parseNumberAt(tokens, next + 2);
      if (denom) { unit = { dimension: "fraction", factor: 1 / denom.value }; next = denom.next; }
    }
    if (!unit) {
      for (let k = next; k < Math.min(tokens.length, next + 3) && !unit; k += 1) {
        const u = tokens[k] === "earth" && tokens[k + 1] === "radii" ? unitOf("radii") : unitOf(tokens[k]);
        if (u) { unit = u; break; }
        if (!["of", "a", "an", "per", "the"].includes(tokens[k])) break;
      }
    }
    const base = (fraction !== null ? value * fraction : value) * (unit ? unit.factor : 1);
    const finalValue = fraction !== null ? value * fraction : value;
    if (unit && unit.dimension === "time" && unit.factor === 86400 && finalValue === 1) { i = next - 1; continue; } // "one day": calendar reference
    // small unitless counts are structure ("three circles"), not claims
    if (!unit && finalValue < 10) { i = next - 1; continue; }
    out.push({
      text: tokens.slice(start, next).join(" "),
      kind: "quantity",
      value: finalValue,
      base,
      dimension: unit ? unit.dimension : "count",
      qualifier: qualifierBefore(tokens, start),
      sf: sigFigs(finalValue),
    });
    i = next - 1;
  }
  return out;
}

const NUM_RE = /(?:[±+-]?\s*)(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*[×x]\s*10\^?\{?\s*([−–-]?\s*\d+)\}?)?(?:e([−–-]?\d+))?\s*(%|°|(?:Earth )?radii|[A-Za-zµμ]+)?/g;

/** Quantities evidence writes. Returns [{value, base, dimension}] (dimension "count" when unitless). */
function evidenceQuantities(text) {
  const out = [];
  const s = String(text).replace(/\[math\][\s\S]*?\[\/math\]/g, " ").replace(/\\displaystyle|\\mathbf|\\times|\\mu/g, " ").replace(/(nano|micro|milli)-\s*(seconds?)/gi, "$1$2");
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(s))) {
    let value = Number(m[1].replace(/[ ,]/g, ""));
    if (!Number.isFinite(value)) continue;
    const exp = m[2] || m[3];
    if (exp) value *= 10 ** Number(String(exp).replace(/[−–]/g, "-").replace(/\s/g, ""));
    let unitWord = m[4] || null;
    const earthPrefixed = unitWord && /^Earth\s+radii$/i.test(unitWord);
    if (unitWord && /^Earth$/i.test(unitWord)) unitWord = null;
    if (earthPrefixed) unitWord = "radii";
    const u = unitOf(unitWord);
    out.push({ value, base: value * (u ? u.factor : 1), dimension: exp && value < 1e-3 ? "fraction" : u ? u.dimension : "count" });
  }
  return out;
}

/** Evidence quantities including those written as words ("approximately every two hours"). */
function evidenceAllQuantities(text) {
  const out = evidenceQuantities(text);
  for (const q of spokenQuantities(text)) if (q.kind === "quantity") out.push({ value: q.value, base: q.base, dimension: q.dimension });
  return out;
}

/** Compare one spoken quantity with all evidence quantities. */
function matchQuantity(spoken, candidates) {
  if (spoken.kind === "year") {
    return candidates.some((c) => c.value === spoken.value) ? { verdict: "MATCH", detail: "year found" } : { verdict: "NO_EVIDENCE", detail: `year ${spoken.value} not in evidence` };
  }
  const same = candidates.filter((c) => c.dimension === spoken.dimension || (spoken.dimension === "count" && c.dimension === "count"));
  const pool = same.length ? same : spoken.dimension === "count" ? candidates : [];
  if (!pool.length) return { verdict: "NO_EVIDENCE", detail: `no ${spoken.dimension} quantity in evidence` };
  const v = spoken.base;
  let best = null;
  for (const c of pool) {
    const rel = c.base === 0 ? Math.abs(v) : Math.abs(v - c.base) / Math.abs(c.base);
    const sf = spoken.sf;
    let verdict = null;
    if (rel <= 0.005) verdict = "MATCH";
    else if (roundSig(c.base, sf) === roundSig(v, sf)) verdict = "MATCH";
    else if (spoken.qualifier === "lower" && v <= c.base * 1.0001) verdict = "MATCH_QUALIFIED";
    else if (spoken.qualifier === "upper" && c.base <= v * 1.0001) verdict = "MATCH_QUALIFIED";
    else if (rel <= 0.5) verdict = "COARSE";
    else verdict = "MISMATCH";
    const rank = { MATCH: 0, MATCH_QUALIFIED: 1, COARSE: 2, MISMATCH: 3 }[verdict];
    if (!best || rank < best.rank || (rank === best.rank && rel < best.rel)) best = { verdict, rank, rel, evidence: c.base };
  }
  return { verdict: best.verdict, detail: `spoken ${v} vs evidence ${best.evidence} (${(best.rel * 100).toFixed(1)}% off)` };
}

module.exports = { spokenQuantities, evidenceQuantities, evidenceAllQuantities, matchQuantity, sigFigs, roundSig };
