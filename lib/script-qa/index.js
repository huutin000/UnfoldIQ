"use strict";

/**
 * Script QA orchestrator (integration layer, NOT a second QA pipeline).
 *
 * Reuses existing capabilities and adds only what was missing:
 *   existing: spoken-script naturalness (evaluateNaturalness), creative-retention
 *             (hook / beats / title promise), visual-motion routing (feasibility),
 *             script-evidence-gate qualifierPresent
 *   new generic checks: evidence mapping, spoken-number vs evidence verification,
 *             ledger-declared forbidden phrases and caveats, absolute language,
 *             weak evidence overlap, repeated content, pacing/duration basis
 *
 * Role separation (the same model family cannot certify itself):
 *   DETERMINISTIC        code in this file / numbers.js
 *   EXISTING_CAPABILITY  repo libs called as-is
 *   EDITORIAL            findings supplied from outside (human or a model); recorded
 *                        with assessor.independent = false for a same-family model
 * No rule contains topic knowledge: topic specifics (forbidden phrases, caveats)
 * come from the claim ledger, per claim.
 */

const numbers = require("./numbers.js");
const { qualifierPresent } = require("../research-story/script-evidence-gate.js");
const spoken = require("../spoken-script/index.js");
const retention = require("../creative-retention/index.js");
const routing = require("../visual-motion/routing.js");
const originality = require("../creative-differentiation/originality.js");

const STOP = new Set("this that with from they them their there which would could should about into than then when where what your yours have been were also just only some very more most such each other these those over under while because between through during before after again once here still even much many make made like ever being does doing done same both few".split(" "));
const LECTURE = /let'?s recap|in summary|to summari[sz]e|remember that|as we('ve| have) seen|in conclusion|thanks for watching|so the recipe/i;
const ABSOLUTE = /\b(exactly|always|never|guarantee[sd]?|proves?|proven|impossible|nobody|everyone|only works because)\b/i;
const CAUSAL_ABSOLUTE = /\bonly (works|exists|happens|functions) because\b/i;

/** Parse the script table; columns are found by header name (#, Chapter|Ch, Narration, Evidence, Visual optional). */
function parseScriptTable(md) {
  const lines = String(md).split("\n");
  const start = lines.findIndex((l) => /^\|\s*#\s*\|/.test(l) && /narration/i.test(l) && /evidence/i.test(l));
  if (start < 0) throw new Error("SCRIPT_TABLE_NOT_FOUND");
  const head = lines[start].split("|").map((x) => x.trim().toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const ci = { id: col(/^#$/), chapter: col(/^(chapter|ch)$/), text: col(/narration/), evidence: col(/evidence/), visual: col(/visual/) };
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i += 1) {
    const c = lines[i].split("|").map((x) => x.trim());
    rows.push({ id: c[ci.id], chapter: ci.chapter >= 0 ? c[ci.chapter] : "", text: c[ci.text], evidence: c[ci.evidence], visual: ci.visual >= 0 ? c[ci.visual] : "" });
  }
  return rows;
}

const words = (t) => String(t).trim().split(/\s+/).filter(Boolean);
const content = (t) => words(String(t).toLowerCase().replace(/[^a-z0-9\s]/g, " ")).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.replace(/s$/, ""));

function sceneEvidence(scene, ledger) {
  const claimRefs = [...scene.evidence.matchAll(/\bC(\d+)\b/g)].map((m) => "C" + m[1]);
  const srcRefs = [...scene.evidence.matchAll(/\bSRC(\d+)\b/g)].map((m) => "SRC" + m[1]);
  const texts = [];
  for (const c of claimRefs) {
    const cl = ledger.claims[c];
    if (!cl) continue;
    for (const e of cl.evidence || []) texts.push(e.quote);
    if (cl.derivation) texts.push(cl.derivation);
  }
  for (const c of Object.values(ledger.claims)) for (const e of c.evidence || []) if (srcRefs.includes(e.src)) texts.push(e.quote);
  const noSource = /^(Explain|sources|recap)/i.test(scene.evidence) && !claimRefs.length && !srcRefs.length;
  const explainOnly = /^Explain/i.test(scene.evidence) && !claimRefs.length && !srcRefs.length;
  return { claimRefs, srcRefs, texts, noSource, explainOnly };
}

function finding(code, severity, status, scene, detail, extra = {}) {
  return { key: `${code}:${scene || "-"}`, code, severity, status, scene: scene || null, detail, class: extra.class || "DETERMINISTIC", checker: extra.checker || "script-qa" };
}

function deterministic(scenes, ledger, options) {
  const out = [];
  const seen = new Set();
  const contentSets = [];
  scenes.forEach((s, idx) => {
    if (seen.has(s.id)) out.push(finding("DUPLICATE_SCENE_ID", "P1", "FAIL", s.id, "duplicate scene id"));
    seen.add(s.id);
    const ev = sceneEvidence(s, ledger);
    // 1. evidence mapping
    for (const c of ev.claimRefs) {
      const cl = ledger.claims[c];
      if (!cl) out.push(finding("CLAIM_NOT_IN_LEDGER", "P1", "FAIL", s.id, `${c} is not in the ledger`));
      else if (!String(cl.status).startsWith("SUPPORTED")) out.push(finding("CLAIM_NOT_SUPPORTED", "P0", "FAIL", s.id, `${c} status ${cl.status}`));
    }
    const srcIds = new Set((ledger.sources || []).map((x) => x.id));
    for (const r of ev.srcRefs) if (!srcIds.has(r)) out.push(finding("SOURCE_NOT_IN_LEDGER", "P1", "FAIL", s.id, `${r} unknown`));
    if (!ev.claimRefs.length && !ev.srcRefs.length && !ev.noSource) out.push(finding("NO_EVIDENCE_MAPPING", "P1", "FAIL", s.id, "scene cites neither a claim nor an Explain/sources tag"));
    // 2. spoken numbers vs evidence of the cited claims (skipped for Explain-only scenes)
    if (!ev.noSource) {
      const cands = ev.texts.flatMap((t) => numbers.evidenceAllQuantities(t));
      for (const q of numbers.spokenQuantities(s.text)) {
        const m = numbers.matchQuantity(q, cands);
        if (m.verdict === "MISMATCH" || m.verdict === "NO_EVIDENCE") out.push(finding("NUMBER_NOT_IN_EVIDENCE", "P1", "FAIL", s.id, `"${q.text}": ${m.detail}`));
        else if (m.verdict === "COARSE") out.push(finding("NUMBER_COARSE_APPROXIMATION", "P2", "REVIEW", s.id, `"${q.text}": ${m.detail}`));
      }
    }
    // 3. ledger-declared forbidden phrases and caveats (topic knowledge lives in the ledger)
    // Ledger constraints are project-wide: they apply to every scene, not only to scenes that cite the claim.
    for (const [c, cl] of Object.entries(ledger.claims)) {
      if (ev.explainOnly) break;
      for (const re of cl.forbidden || []) if (new RegExp(re, "i").test(s.text)) out.push(finding("FORBIDDEN_BY_LEDGER", "P0", "FAIL", s.id, `${c} forbids /${re}/`));
      for (const cv of cl.caveats || []) {
        const next = scenes[idx + 1] ? scenes[idx + 1].text : "";
        if (new RegExp(cv.trigger, "i").test(s.text) && !new RegExp(cv.requires, "i").test(s.text + " " + next)) {
          out.push(finding("MISSING_CAVEAT", "P1", "REVIEW", s.id, `${c}: ${cv.note || cv.trigger}`));
        }
      }
    }
    // 4. absolute / causal overclaim
    if (!ev.explainOnly && ABSOLUTE.test(s.text)) {
      const w = s.text.match(ABSOLUTE)[0].toLowerCase();
      const inEvidence = ev.texts.some((t) => t.toLowerCase().includes(w));
      if (CAUSAL_ABSOLUTE.test(s.text) && !inEvidence) out.push(finding("CAUSAL_OVERCLAIM", "P1", "FAIL", s.id, `"${w}" not supported by the cited evidence`));
      else if (!inEvidence) out.push(finding("ABSOLUTE_LANGUAGE", "P2", "REVIEW", s.id, `"${w}" is not in the cited evidence`));
    }
    // 5. weak lexical overlap with cited evidence (advisory: paraphrase is normal)
    if (!ev.noSource && ev.texts.length) {
      const evWords = new Set(content(ev.texts.join(" ")));
      const mine = content(s.text);
      const cover = mine.length ? mine.filter((w) => evWords.has(w)).length / mine.length : 1;
      if (cover < (options.minOverlap ?? 0.2)) out.push(finding("WEAK_EVIDENCE_OVERLAP", "P2", "REVIEW", s.id, `only ${(cover * 100).toFixed(0)}% of content words appear in the cited evidence`));
    }
    // 6. lecture phrase and repeated content
    if (LECTURE.test(s.text)) out.push(finding("LECTURE_PHRASE", "P2", "FAIL", s.id, "lecture/recap phrase"));
    const cs = new Set(content(s.text));
    contentSets.forEach((prev, j) => {
      const inter = [...cs].filter((w) => prev.has(w)).length;
      const union = new Set([...cs, ...prev]).size;
      if (union && cs.size >= 6 && inter / union >= (options.repeatJaccard ?? 0.5)) out.push(finding("REPEATED_CONTENT", "P2", "REVIEW", s.id, `overlaps ${scenes[j].id} (${(inter / union * 100).toFixed(0)}%)`));
    });
    contentSets.push(cs);
    // 7. qualifier on approximate numeric claims (reuses the repo evidence gate helper)
    if (!ev.noSource && /\d|hundred|thousand|million|billion/i.test(s.text)) {
      const qs = numbers.spokenQuantities(s.text).filter((q) => q.kind === "quantity" && q.qualifier === "plain" && q.dimension !== "count");
      if (qs.length && !qualifierPresent(s.text, "approximate") && !/exactly|at (least|most)|one (billionth|microsecond|millisecond)/i.test(s.text)) {
        out.push(finding("NUMBER_WITHOUT_QUALIFIER", "P2", "REVIEW", s.id, `"${qs[0].text}" carries no approximation qualifier`, { checker: "script-evidence-gate.qualifierPresent" }));
      }
    }
  });
  return out;
}

function existing(scenes, meta, options) {
  const out = [];
  const wps = options.wordsPerSecond || 2.5;
  let t = 0;
  let retentionResult = null;
  const beats = scenes.map((s, i) => {
    const dur = Math.round((words(s.text).length / wps) * 1000);
    const m = (meta.beats && meta.beats[s.id]) || {};
    const b = { beatId: s.id, order: i + 1, role: m.role || (i === 0 ? "HOOK" : i === scenes.length - 1 ? "OUTRO" : "EXPLANATION"), startMs: t, endMs: t + dur, text: s.text, opensLoops: (m.opens || []).map((id) => ({ loopId: id, question: id })), resolvesLoops: m.resolves || [] };
    t += dur;
    return b;
  });
  // naturalness (existing)
  try {
    const nat = spoken.evaluateNaturalness({ segments: scenes.map((s) => ({ segmentId: s.id, candidateSpokenText: s.text })) });
    for (const is of nat.issues || []) out.push(finding(`NATURALNESS_${is.code}`, is.blocking ? "P1" : "P2", is.blocking ? "FAIL" : "REVIEW", is.segmentId, is.detail, { class: "EXISTING_CAPABILITY", checker: "spoken-script.evaluateNaturalness" }));
  } catch (e) {
    out.push(finding("CHECK_ERROR", "P1", "REVIEW", null, `naturalness: ${e.message}`, { class: "EXISTING_CAPABILITY" }));
  }
  // hook / beats / promise (existing, deterministic, 0 model calls)
  try {
    const r = retention.analyzeCreativeRetention({
      projectId: meta.projectId || "script-qa", contentClass: meta.contentClass || "FACTUAL", hookClass: meta.hookClass || "EXPLAINER", durationMs: t,
      packaging: { titleText: meta.title || "", expectedViewerPromise: meta.promise || [], openingMustEstablish: meta.openingMustEstablish || [], mustNotImply: meta.mustNotImply || [], titleClaimRefs: [] },
      beats, shots: [], captions: [], narration: beats.map((b) => ({ startMs: b.startMs, endMs: b.endMs, text: b.text })),
    });
    if (!r.ok) out.push(finding("CHECK_ERROR", "P1", "REVIEW", null, `creative-retention input: ${JSON.stringify(r.errors || r.code)}`, { class: "EXISTING_CAPABILITY" }));
    else {
    retentionResult = r;
    for (const f of r.findings || []) {
      if (/RHYTHM|SHOT|MOTION|VISUAL|CAPTION/i.test(f.code || f.id || "")) continue; // needs a real timeline, not a script
      out.push(finding(`RETENTION_${f.code || f.id}`, f.severity || "P2", /^P[01]$/.test(f.severity || "") ? "FAIL" : "REVIEW", f.beatId || null, f.message || f.detail || f.reason || "", { class: "EXISTING_CAPABILITY", checker: "creative-retention" }));
    }
    }
  } catch (e) {
    out.push(finding("CHECK_ERROR", "P1", "REVIEW", null, `creative-retention: ${e.message}`, { class: "EXISTING_CAPABILITY" }));
  }
  // originality / template risk against a supplied corpus (existing 6B gate; script-level wording + structure only)
  let originalityDoc = null;
  if (retentionResult && options.originalityCorpus && meta.scope) {
    try {
      const subject = originality.buildFingerprintV2(retentionResult.input, retentionResult.fingerprint, { scope: meta.scope });
      originalityDoc = originality.assessOriginality(subject, options.originalityCorpus, { corpusScope: "ONE_VIDEO" });
      if (originalityDoc.risk === "HIGH") out.push(finding("ORIGINALITY_RISK_HIGH", "P1", "REVIEW", null, (originalityDoc.findings || []).join(", "), { class: "EXISTING_CAPABILITY", checker: "creative-differentiation.assessOriginality" }));
      else if (originalityDoc.risk === "MEDIUM") out.push(finding("ORIGINALITY_RISK_MEDIUM", "P2", "REVIEW", null, (originalityDoc.findings || []).join(", "), { class: "EXISTING_CAPABILITY", checker: "creative-differentiation.assessOriginality" }));
    } catch (e) {
      out.push(finding("CHECK_ERROR", "P2", "REVIEW", null, `originality: ${e.message}`, { class: "EXISTING_CAPABILITY" }));
    }
  }
  // visual feasibility through the existing routing decision (no generation, no spend)
  for (const s of scenes) {
    if (!/^(D|F\??)\b/.test(s.visual || "")) { out.push(finding("NO_VISUAL_ROUTE", "P2", "REVIEW", s.id, "scene has no visual route", { class: "EXISTING_CAPABILITY", checker: "visual-motion.routing" })); continue; }
    const isFlow = /^F/.test(s.visual);
    const d = routing.routeShot({ shotId: s.id, contentMode: isFlow ? "ENVIRONMENT" : "DIAGRAM", targetRealism: isFlow ? "ILLUSTRATIVE" : "ABSTRACT", motionRequirement: "CAMERA_ONLY", availability: { flowQuota: { available: null, costPerGeneration: null } } });
    if (d.state === "BLOCKED") out.push(finding("VISUAL_ROUTE_BLOCKED", "P1", "FAIL", s.id, (d.reasonCodes || []).join(", "), { class: "EXISTING_CAPABILITY", checker: "visual-motion.routing" }));
  }
  return { findings: out, beats, totalMs: t, originality: originalityDoc ? { risk: originalityDoc.risk, coverage: originalityDoc.coverage, channelLevelOriginality: originalityDoc.channelLevelOriginality, corpusCount: originalityDoc.corpusCount, findings: originalityDoc.findings } : null, retentionFindings: retentionResult ? (retentionResult.findings || []).length : null };
}

/**
 * runScriptQa({ scenes, ledger, meta, editorial, dispositions, options })
 * options: wordsPerSecond, durationBasis ("MEASURED"|"ESTIMATED"), minSeconds (default 480), goldenPassed (bool)
 */
function runScriptQa({ scenes, ledger, meta = {}, editorial = [], dispositions = {}, options = {} }) {
  const det = deterministic(scenes, ledger, options);
  const ex = existing(scenes, meta, options);
  const findings = [...det, ...ex.findings];
  // editorial findings come from outside; they never override deterministic FAILs
  for (const e of editorial) {
    findings.push({ key: `EDITORIAL:${e.id}`, code: e.code || "EDITORIAL", severity: e.severity, status: e.status === "RESOLVED" ? "RESOLVED" : "REVIEW", scene: e.scene || null, detail: e.text, class: "EDITORIAL", assessor: e.assessor || { type: "UNSPECIFIED", independent: false } });
  }
  const totalWords = scenes.reduce((a, s) => a + words(s.text).length, 0);
  const wps = options.wordsPerSecond || 2.5;
  const seconds = totalWords / wps;
  const minSeconds = options.minSeconds ?? 480;
  const basis = options.durationBasis || "ESTIMATED";
  if (seconds < minSeconds) findings.push(finding("DURATION_BELOW_MINIMUM", "P1", basis === "MEASURED" ? "FAIL" : "REVIEW", null, `${Math.round(seconds)} s at ${wps} w/s (${basis}) vs minimum ${minSeconds} s`));
  const open = [];
  for (const f of findings) {
    const d = dispositions[f.key];
    f.disposition = d || null;
    if (f.status === "RESOLVED") continue;
    if (f.status === "FAIL") open.push(f);
    else if (f.status === "REVIEW" && !(d && d.decision === "ACCEPT" && d.reason)) open.push(f);
  }
  const blocking = open.filter((f) => f.status === "FAIL" || f.severity === "P0" || f.severity === "P1");
  const requirements = [
    { id: "NO_OPEN_FINDINGS", met: open.length === 0 },
    { id: "DURATION_MEASURED", met: basis === "MEASURED" },
    { id: "GOLDEN_TESTS_PASSED", met: options.goldenPassed === true },
  ];
  let verdict;
  if (blocking.some((f) => f.status === "FAIL")) verdict = "FAIL";
  else if (open.length || requirements.some((r) => !r.met)) verdict = "REVIEW_REQUIRED";
  else verdict = "READY_FOR_LOCK";
  return { kind: "SCRIPT_QA_RESULT", version: "1.0.0", scenes: scenes.length, words: totalWords, estimatedSeconds: Math.round(seconds), durationBasis: basis, wordsPerSecond: wps, findings, open: open.map((f) => f.key), requirements, verdict, originality: ex.originality, retentionFindingCount: ex.retentionFindings };
}

module.exports = { runScriptQa, parseScriptTable, deterministic, existing, finding };
