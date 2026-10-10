"use strict";

/**
 * Phase 6B / 6.5 — Originality / Anti-template gate (UNFOLDIQ CORE).
 *
 *   CHANNEL CONSISTENCY != MASS-TEMPLATE REPETITION.
 *
 * Extends the Phase 6A CreativeFingerprint (rhythm) with substance + structure +
 * packaging features (fingerprint v2). Comparison separates three things:
 *   A. same-channel identity (intro/outro/palette/mascot)     -> never penalised
 *   B. similar presentation (shots, CTA, title, music, framing) -> signal / warning only
 *   C. repetitive substance (script, claims, thesis)            -> high-risk review
 * No edit-distance threshold decides platform eligibility; output is a decision
 * aid with evidence, confidence and false-positive notes — never a monetization or
 * copyright verdict. Wording is stored as hashed shingles, not text (privacy).
 */

const text = require("../creative-retention/text.js");
const { ORIGINALITY_POLICY: P, FINGERPRINT_VERSION, COMPARATOR_VERSION, POLICY_VERSION } = require("./policy.js");
const { sha16, assertSafeDoc } = require("./guard.js");

const ASSESSMENT_VERSION = "1.0.0";
const IDENTITY_ROLES = new Set(["BRAND_INTRO", "OUTRO"]);
const h8 = (s) => sha16(s).slice(0, 8);
const uniq = (a) => [...new Set(a)];
const setOf = (a) => new Set(a);

function shingles(words, n) {
  const out = [];
  for (let i = 0; i + n <= words.length; i++) out.push(h8(words.slice(i, i + n).join(" ")));
  return out;
}
const sentences = (t) => String(t || "").split(/(?<=[.!?])\s+/).filter(Boolean);
const openerOf = (t) => text.words(sentences(t)[0] || "").slice(0, 2).join(" ");

function lcsRatio(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return (2 * prev[b.length]) / (a.length + b.length);
}

function jac(a, b) {
  const A = setOf(a);
  const B = setOf(b);
  if (A.size === 0 || B.size === 0) return 0;
  let i = 0;
  for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}

/** Title with content words masked ("Why Sunsets Turn Red" -> "why x x x"): the reusable formula, not the topic. */
function titleTemplate(title) {
  return text.words(title).map((w) => (/^\d+$/.test(w) ? "#" : text.STOP.has(w) ? w : "x")).join(" ");
}

/**
 * input: normalized CreativeInput. v1: Phase 6A CreativeFingerprint (rhythmReport.fingerprint).
 * extras: { episodeId?, scope:{ownerId,channelId,seriesId?}, editorialBibleVersion?, identity?:{palette,mascot,voiceId,introHash,outroHash},
 *           thesis?, keyQuestions?, claimRefs?, thumbnail?:{layout,subject}, cta?:{role,position}, sharedEntities?, assets?:[{assetId,sha256,source,reuseContext?}],
 *           musicCueRoles?, origin?: 'REAL_EPISODE'|'GOLDEN_FIXTURE', videoSha256? }
 */
function buildFingerprintV2(input, v1, extras = {}) {
  const scope = extras.scope || {};
  if (!scope.ownerId || !scope.channelId) throw Object.assign(new Error("FINGERPRINT_SCOPE_REQUIRED: scope.ownerId + scope.channelId"), { code: "FINGERPRINT_SCOPE_REQUIRED" });
  const shared = new Set((extras.sharedEntities || []).flatMap((e) => [...text.contentTokens(e)]));
  const beats = input.beats;
  const units = beats.map((b) => {
    const toks = text.words(b.text).filter((w) => !shared.has(text.stem(w)));
    return {
      beatId: b.beatId, role: b.role,
      isIdentity: IDENTITY_ROLES.has(b.role) || b.intent.identity === true,
      isRecap: b.intent.recap === true,
      shingleHashes: shingles(toks, P.scriptShingleSize),
      tokenHashes: uniq([...text.contentTokens(toks.join(" "))].filter((t) => !shared.has(t)).map(h8)),
    };
  });
  const spoken = beats.map((b) => b.text).join(" ");
  const totalMs = Math.max(1, input.durationMs);
  const relPos = (pred) => { const b = beats.find(pred); return b ? Number((b.startMs / totalMs).toFixed(2)) : null; };
  const ctaBeat = beats.find((b) => b.role === "CTA");
  const thesisTokens = uniq([...text.contentTokens(extras.thesis || "")].map(h8));
  const dBucket = P.durationBucketMs;
  const fp = {
    kind: "ORIGINALITY_FINGERPRINT",
    version: FINGERPRINT_VERSION,
    projectId: input.projectId,
    episodeId: extras.episodeId || input.projectId,
    origin: extras.origin || "REAL_EPISODE",
    scope: { ownerId: scope.ownerId, channelId: scope.channelId, ...(scope.seriesId ? { seriesId: scope.seriesId } : {}) },
    contentClass: input.contentClass,
    inputFingerprint: input.inputFingerprint,
    videoSha256: extras.videoSha256 || (input.video && input.video.sha256) || null,
    identity: {
      editorialBibleVersion: extras.editorialBibleVersion || null,
      channelIdentityHash: sha16({ c: scope.channelId, i: extras.identity || null, v: extras.editorialBibleVersion || null }),
    },
    substance: {
      thesisTokens, keyQuestionCount: (extras.keyQuestions || []).length,
      claimRefs: uniq(extras.claimRefs || []).sort(),
      scriptHash: sha16(spoken),
      units,
      wordingStorage: "HASHED_SHINGLES_ONLY",
    },
    structure: {
      roleSequence: beats.map((b) => b.role),
      hookRoles: beats.filter((b) => b.role === "HOOK" || b.role === "QUESTION").map((b) => b.role),
      revealPosition: relPos((b) => b.role === "REVEAL"),
      payoffPosition: relPos((b) => b.role === "PAYOFF"),
      cta: extras.cta || (ctaBeat ? { role: "CTA", position: Number((ctaBeat.startMs / totalMs).toFixed(2)) } : null),
    },
    transitions: { openers: uniq(beats.filter((b) => !IDENTITY_ROLES.has(b.role)).map((b) => openerOf(b.text)).filter(Boolean)), perBeat: beats.map((b) => [b.beatId, openerOf(b.text)]) },
    presentation: {
      durationBuckets: v1 ? v1.shotDurationsMs.map((d) => Math.round(d / dBucket)) : input.shots.map((s) => Math.round((s.endMs - s.startMs) / dBucket)),
      modalitySequence: v1 ? v1.modalitySequence : input.shots.map((s) => s.modality),
      framingSequence: v1 ? v1.framingSequence : input.shots.map((s) => s.framing || "UNKNOWN"),
      motionSequence: v1 ? v1.motionPrimitiveSequence : input.shots.map((s) => s.motionPrimitive || "STATIC"),
      transitionSequence: v1 ? v1.transitionSequence : [],
      staticShare: v1 && v1.metrics ? v1.metrics.staticShare : null,
      musicCueRoles: extras.musicCueRoles || [],
      titleTemplate: titleTemplate(input.packaging && input.packaging.titleText),
      thumbnailLayout: (extras.thumbnail && extras.thumbnail.layout) || null,
    },
    provenance: { assets: (extras.assets || []).map((a) => ({ assetId: a.assetId, sha256: a.sha256 || null, source: a.source || "ORIGINAL", ...(a.reuseContext ? { reuseContext: a.reuseContext } : {}) })) },
    v1FingerprintHash: v1 ? v1.fingerprintHash : null,
  };
  fp.fingerprintHash = sha16({ ...fp, inputFingerprint: undefined });
  assertSafeDoc(fp);
  return fp;
}

const substantiveUnits = (fp) => {
  const base = fp.substance.units.filter((u) => !u.isIdentity);
  const recap = base.filter((u) => u.isRecap);
  // a recap flag cannot hide a duplicate: only honoured while recaps are a minority of the episode
  const honour = base.length > 0 && recap.length / base.length < 0.5;
  return { units: honour ? base.filter((u) => !u.isRecap) : base, recapExcluded: honour ? recap.length : 0, recapShareTooHigh: !honour && recap.length > 0 };
};

const flat = (units, k) => units.flatMap((u) => u[k]);
const sameScope = (a, b, allowCrossChannel) => a.scope.ownerId === b.scope.ownerId && (allowCrossChannel || a.scope.channelId === b.scope.channelId);

const F = (code, severity, o) => ({ code, severity, matches: [], where: [], confidence: "MEDIUM", falsePositiveConsiderations: [], suggestedRepair: "", evidenceRefs: [], ...o });

/** Compare one episode against one reference (LEVEL 1-3). */
function compareEpisodes(a, b) {
  const sa = substantiveUnits(a);
  const sb = substantiveUnits(b);
  const A = { sh: flat(sa.units, "shingleHashes"), tk: flat(sa.units, "tokenHashes") };
  const B = { sh: flat(sb.units, "shingleHashes"), tk: flat(sb.units, "tokenHashes") };
  const jShingle = jac(A.sh, B.sh);
  const jSemantic = jac(A.tk, B.tk);
  const jClaims = jac(a.substance.claimRefs, b.substance.claimRefs);
  const jThesis = jac(a.substance.thesisTokens, b.substance.thesisTokens);
  const haveClaims = a.substance.claimRefs.length > 0 && b.substance.claimRefs.length > 0;
  const exact = a.substance.scriptHash === b.substance.scriptHash || (a.videoSha256 && a.videoSha256 === b.videoSha256);
  const nearDup = !exact && (jShingle >= P.nearDuplicateShingleJaccard || (jSemantic >= P.nearDuplicateSemanticJaccard && (!haveClaims || jClaims >= P.sameClaimsJaccard)));

  const pa = a.presentation, pb = b.presentation;
  const sim = {
    roles: lcsRatio(a.structure.roleSequence, b.structure.roleSequence),
    shotRhythm: Math.min(lcsRatio(pa.durationBuckets, pb.durationBuckets), lcsRatio(pa.modalitySequence, pb.modalitySequence), lcsRatio(pa.framingSequence, pb.framingSequence)),
    motion: lcsRatio(pa.motionSequence, pb.motionSequence),
    music: pa.musicCueRoles.length && pb.musicCueRoles.length ? lcsRatio(pa.musicCueRoles, pb.musicCueRoles) : 0,
    transitions: jac(a.transitions.openers, b.transitions.openers),
  };
  const hi = P.structuralSimilarityHigh;
  const structural = [];
  if (sim.roles >= hi) structural.push("STORY_ROLE_SEQUENCE");
  if (sim.shotRhythm >= hi) structural.push("SHOT_RHYTHM");
  if (sim.motion >= hi && pa.motionSequence.some((m) => m !== "STATIC")) structural.push("MOTION_TEMPLATE");
  if (sim.music >= hi) structural.push("MUSIC_CUE_ROLES");
  if (sim.transitions >= 0.7 && a.transitions.openers.length >= 3) structural.push("TRANSITION_PHRASES");
  const titleSame = !!pa.titleTemplate && pa.titleTemplate === pb.titleTemplate && pa.titleTemplate.split(" ").length >= 4;
  const thumbSame = !!pa.thumbnailLayout && pa.thumbnailLayout === pb.thumbnailLayout;
  const ctaSame = !!a.structure.cta && !!b.structure.cta && a.structure.cta.role === b.structure.cta.role && Math.abs(a.structure.cta.position - b.structure.cta.position) <= 0.05;
  if (titleSame) structural.push("TITLE_FORMULA");
  if (thumbSame) structural.push("THUMBNAIL_LAYOUT");
  if (ctaSame) structural.push("CTA_PATTERN");

  const substantive = [];
  if (exact) substantive.push("EXACT_SCRIPT_OR_VIDEO_IDENTITY");
  if (jShingle >= P.nearDuplicateShingleJaccard) substantive.push(`SCRIPT_SHINGLE_OVERLAP:${jShingle.toFixed(2)}`);
  if (jSemantic >= P.nearDuplicateSemanticJaccard) substantive.push(`SEMANTIC_TOKEN_OVERLAP:${jSemantic.toFixed(2)}`);
  if (haveClaims && jClaims >= P.sameClaimsJaccard) substantive.push(`SAME_CLAIM_SET:${jClaims.toFixed(2)}`);
  if (jThesis >= P.sameThesisJaccard) substantive.push(`SAME_THESIS:${jThesis.toFixed(2)}`);

  const distinct = [];
  const newClaims = a.substance.claimRefs.filter((c) => !b.substance.claimRefs.includes(c));
  if (newClaims.length) distinct.push(`NEW_EVIDENCE_CLAIMS:${newClaims.length}`);
  if (jThesis < 0.3 && a.substance.thesisTokens.length && b.substance.thesisTokens.length) distinct.push("DIFFERENT_THESIS");
  if (1 - jShingle >= 0.7) distinct.push("NEW_SCRIPT_CONTENT");
  const assetsB = new Set(b.provenance.assets.map((x) => x.sha256).filter(Boolean));
  const newAssets = a.provenance.assets.filter((x) => x.sha256 && !assetsB.has(x.sha256) && x.source === "ORIGINAL");
  if (newAssets.length) distinct.push(`NEW_ORIGINAL_ASSETS:${newAssets.length}`);
  const reused = a.provenance.assets.filter((x) => x.sha256 && assetsB.has(x.sha256));
  if (sa.recapExcluded) distinct.push(`INTENTIONAL_RECAP_UNITS_EXCLUDED:${sa.recapExcluded}`);

  const newSubstanceShare = haveClaims ? newClaims.length / a.substance.claimRefs.length : 1 - jSemantic;
  const identity = [];
  if (a.identity.channelIdentityHash === b.identity.channelIdentityHash) identity.push("SAME_CHANNEL_IDENTITY");
  if (a.scope.seriesId && a.scope.seriesId === b.scope.seriesId) identity.push("SAME_SERIES");
  if (reused.length) identity.push(`ASSET_REUSE:${reused.length}`);

  const findings = [];
  const ref = b.episodeId;
  if (exact) findings.push(F("EXACT_EPISODE_DUPLICATE", "HIGH", { matches: [ref], confidence: "HIGH", whyItMatters: "Identical script/video identity is the clearest mass-production signal.", suggestedRepair: "Do not publish both; produce genuinely new substance or consolidate.", evidenceRefs: ["scriptHash/videoSha256"] }));
  else if (nearDup) {
    const pkgChanged = !titleSame || !thumbSame;
    findings.push(F("SEMANTIC_NEAR_DUPLICATE", "HIGH", {
      matches: [ref], where: sa.units.map((u) => u.beatId), confidence: jShingle >= 0.8 ? "HIGH" : "MEDIUM",
      whyItMatters: `Script substance overlaps (shingle ${jShingle.toFixed(2)}, semantic ${jSemantic.toFixed(2)})${pkgChanged ? "; a changed title/thumbnail does not make it a new episode" : ""}.`,
      falsePositiveConsiderations: ["Intentional recap or shared reference text should be flagged via beat intent.recap", "Shared quotations of public-domain text"],
      suggestedRepair: "Add distinct evidence, a different thesis/perspective, or merge episodes.", evidenceRefs: substantive,
    }));
  }
  if (!exact && !nearDup && structural.length >= P.structuralFamiliesForTemplateRisk && newSubstanceShare < P.thinNewSubstanceShare && sim.roles >= hi) {
    findings.push(F("REPEATED_STORY_ARC_WITHOUT_NEW_SUBSTANCE", "REVIEW", { matches: [ref], confidence: "MEDIUM", whyItMatters: "Story arc and presentation repeat across >=3 structural families while little new evidence/substance is added.", falsePositiveConsiderations: ["Serial formats legitimately reuse an arc when each episode adds new facts"], suggestedRepair: "Add episode-specific evidence or vary the arc/reveal; keep channel identity.", evidenceRefs: structural }));
  }
  const warn = (code, why, fam) => structural.includes(fam) && findings.push(F(code, "WARNING", { matches: [ref], confidence: "LOW", whyItMatters: why, falsePositiveConsiderations: ["Repeated presentation alone is not proof of a policy problem", ...(distinct.length ? ["Episode substance is distinct"] : [])], suggestedRepair: "Optional: vary the pattern if substance is also thin.", evidenceRefs: [fam] }));
  warn("TITLE_FORMULA_REPETITION", "Same title formula as a reference episode.", "TITLE_FORMULA");
  warn("THUMBNAIL_FORMULA_REPETITION", "Same thumbnail layout as a reference episode.", "THUMBNAIL_LAYOUT");
  warn("REPETITIVE_CTA_PATTERN", "Same CTA role and position.", "CTA_PATTERN");
  warn("TRANSITION_PHRASE_OVERUSE", "Narration transitions overlap strongly with a reference episode.", "TRANSITION_PHRASES");
  if (structural.includes("SHOT_RHYTHM") || structural.includes("MOTION_TEMPLATE")) findings.push(F("SHOT_MOTION_TEMPLATE_RISK", "WARNING", { matches: [ref], confidence: "LOW", whyItMatters: "Shot-duration/modality/motion sequence closely matches a reference episode.", falsePositiveConsiderations: ["A recognisable house style is intentional channel identity"], suggestedRepair: "Optional variation where the beat does not need the template.", evidenceRefs: structural }));
  if (identity.includes("SAME_CHANNEL_IDENTITY")) findings.push(F("CHANNEL_IDENTITY_INTENTIONAL", "INFO", { matches: [ref], confidence: "HIGH", whyItMatters: "Shared channel identity (intro/outro/palette/voice) is intentional and not penalised.", evidenceRefs: ["identity.channelIdentityHash"] }));

  const risk = exact || nearDup ? "HIGH" : findings.some((f) => f.severity === "REVIEW") ? "MEDIUM" : "LOW";
  return {
    ref, level: exact ? 1 : substantive.length ? 3 : 2,
    structuralSignals: structural, substantiveSignals: substantive, distinctContributions: distinct, identitySignals: identity,
    metrics: { jShingle: +jShingle.toFixed(3), jSemantic: +jSemantic.toFixed(3), jClaims: +jClaims.toFixed(3), jThesis: +jThesis.toFixed(3), newSubstanceShare: +newSubstanceShare.toFixed(3), seq: Object.fromEntries(Object.entries(sim).map(([k, v]) => [k, +v.toFixed(3)])) },
    confidence: exact ? "HIGH" : nearDup ? (jShingle >= 0.8 ? "HIGH" : "MEDIUM") : structural.length >= 3 ? "MEDIUM" : "LOW",
    risk, recapShareTooHigh: sa.recapShareTooHigh, findings,
  };
}

/** LEVEL 0: single-video internal repetition (no corpus needed). */
function assessInternal(fp, opts = {}) {
  const findings = [];
  const body = fp.substance.units.filter((u) => !u.isIdentity);
  const per = fp.transitions.perBeat.filter(([id]) => body.some((u) => u.beatId === id));
  if (per.length >= P.transitionOveruseMinBeats) {
    const counts = {};
    for (const [, o] of per) if (o) counts[o] = (counts[o] || 0) + 1;
    const [top, n] = Object.entries(counts).sort((x, y) => y[1] - x[1])[0] || [null, 0];
    if (top && n >= 3 && n / per.length >= P.transitionOveruseShare) findings.push(F("TRANSITION_PHRASE_OVERUSE", "REVIEW", { matches: [fp.episodeId], where: per.filter(([, o]) => o === top).map(([id]) => id), confidence: "MEDIUM", whyItMatters: `${n}/${per.length} beats open with the same phrase.`, falsePositiveConsiderations: ["A deliberate refrain can be a stylistic device"], suggestedRepair: "Vary connective phrasing across beats.", evidenceRefs: ["transitions.perBeat"] }));
  }
  for (let i = 0; i < body.length; i++) for (let j = i + 1; j < body.length; j++) {
    if (body[i].isRecap || body[j].isRecap) continue;
    const s = jac(body[i].shingleHashes, body[j].shingleHashes);
    const t = jac(body[i].tokenHashes, body[j].tokenHashes);
    if (s >= P.internalBeatDuplicateJaccard || (t >= 0.75 && body[i].tokenHashes.length >= 5)) findings.push(F("INTERNAL_BEAT_DUPLICATION", "REVIEW", { matches: [fp.episodeId], where: [body[i].beatId, body[j].beatId], confidence: "MEDIUM", whyItMatters: "Two beats restate the same substance.", falsePositiveConsiderations: ["Intentional recap should set beat intent.recap"], suggestedRepair: "Merge or differentiate the beats.", evidenceRefs: [`shingle:${s.toFixed(2)}`, `semantic:${t.toFixed(2)}`] }));
  }
  const p = fp.presentation;
  const moving = p.motionSequence.filter((m) => m !== "STATIC");
  const top = Object.values(moving.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).sort((a, b) => b - a)[0] || 0;
  const rhythmOpen = (opts.rhythmFindings || []).some((f) => ["MOTION_TOO_REPETITIVE", "REPETITIVE_MOTION_RHYTHM"].includes(f.code) && f.status === "OPEN");
  if (rhythmOpen || (p.motionSequence.length >= 6 && top / p.motionSequence.length >= 0.8)) findings.push(F("SHOT_MOTION_TEMPLATE_RISK", "WARNING", { matches: [fp.episodeId], confidence: "MEDIUM", whyItMatters: "One motion primitive dominates the shot sequence.", falsePositiveConsiderations: ["Purposeful consistency for a technical explainer"], suggestedRepair: "Vary motion where the beat allows.", evidenceRefs: ["presentation.motionSequence", "Phase6A:REPETITIVE_MOTION_RHYTHM"] }));
  const mods = new Set(p.modalitySequence);
  if (p.modalitySequence.length >= P.slideshowMinShots && (p.staticShare || 0) >= P.slideshowStaticShare && [...mods].every((m) => ["TITLE", "IMAGE"].includes(m))) findings.push(F("LOW_VALUE_VISUAL_SLIDESHOW_RISK", "REVIEW", { matches: [fp.episodeId], confidence: "MEDIUM", whyItMatters: "Static title/image cards for nearly the whole video add little visual value.", falsePositiveConsiderations: ["Audio-led formats may be intentionally minimal"], suggestedRepair: "Add explanatory visuals (diagrams, charts, motion with purpose).", evidenceRefs: ["presentation.staticShare", "presentation.modalitySequence"] }));
  return findings;
}

function corpusFingerprint(entries) {
  return sha16(entries.map((e) => [e.fingerprintHash, e.scope.ownerId, e.scope.channelId]).sort());
}

function cacheParts(subject, entries, extra = {}) {
  return {
    subjectFingerprintHash: subject.fingerprintHash,
    fingerprintVersion: subject.version,
    comparatorVersion: COMPARATOR_VERSION,
    policyVersion: POLICY_VERSION,
    contentClass: subject.contentClass,
    channelIdentityHash: subject.identity.channelIdentityHash,
    corpusFingerprint: corpusFingerprint(entries),
    ...extra,
  };
}

/** Stale when ANY cache part moved (fingerprint/comparator version, corpus, identity, policy). Video bytes are irrelevant. */
function isAssessmentStale(assessment, current) {
  const was = assessment.cache && assessment.cache.parts;
  if (!was) return { stale: true, reasons: ["NO_CACHE_PARTS"] };
  const reasons = Object.keys(current).filter((k) => was[k] !== current[k]);
  return { stale: reasons.length > 0, reasons };
}

/**
 * corpus: [fingerprintV2]. opts: { corpusScope: ONE_VIDEO|GOLDEN_FIXTURES|REAL_CHANNEL_CORPUS, allowCrossChannel?, rhythmFindings?, reviewerDecision? }
 * Entries of another owner/channel are NEVER compared (excludedForScope counts them).
 */
function assessOriginality(subject, corpus = [], opts = {}) {
  const corpusScope = opts.corpusScope || "ONE_VIDEO";
  const eligible = corpus.filter((e) => e.fingerprintHash !== subject.fingerprintHash && sameScope(subject, e, opts.allowCrossChannel));
  const excludedForScope = corpus.filter((e) => e.fingerprintHash !== subject.fingerprintHash && !sameScope(subject, e, opts.allowCrossChannel)).length;
  const comparisons = eligible.map((e) => compareEpisodes(subject, e));
  const internal = assessInternal(subject, opts);
  const realCount = eligible.filter((e) => e.origin === "REAL_EPISODE").length;
  const insufficient = corpusScope === "REAL_CHANNEL_CORPUS" ? realCount < P.minRealEpisodesForChannelLevel : corpusScope === "ONE_VIDEO" ? false : eligible.length === 0;
  const all = [...comparisons.flatMap((c) => c.findings), ...internal];
  if (corpusScope === "ONE_VIDEO" || (corpusScope === "REAL_CHANNEL_CORPUS" && insufficient)) all.push(F("INSUFFICIENT_COMPARISON_CORPUS", "INFO", { matches: [], confidence: "HIGH", whyItMatters: `Only ${realCount} comparable real episode(s) (need >= ${P.minRealEpisodesForChannelLevel} for channel-level assessment).`, suggestedRepair: "Re-assess once more real episodes exist.", evidenceRefs: ["corpus"] }));
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const worst = [...comparisons.map((c) => c.risk), ...(internal.some((f) => f.severity === "REVIEW") ? ["MEDIUM"] : ["LOW"])].sort((a, b) => rank[b] - rank[a])[0];
  const risk = corpusScope === "REAL_CHANNEL_CORPUS" && insufficient && worst !== "HIGH" ? "NOT_ASSESSED" : worst;
  const parts = cacheParts(subject, eligible);
  const doc = {
    kind: "ORIGINALITY_ASSESSMENT",
    version: ASSESSMENT_VERSION,
    fingerprintVersion: subject.version,
    comparatorVersion: COMPARATOR_VERSION,
    policyVersion: POLICY_VERSION,
    assessedArtifactHash: subject.videoSha256 || subject.fingerprintHash,
    assessedFingerprintHash: subject.fingerprintHash,
    corpusScope,
    corpusCount: eligible.length,
    realEpisodeCount: realCount,
    excludedForScope,
    coverage: insufficient ? "INSUFFICIENT" : "SUFFICIENT_FOR_SCOPE",
    channelLevelOriginality: corpusScope === "REAL_CHANNEL_CORPUS" && !insufficient ? "ASSESSED" : "NOT_PROVEN",
    comparisons: comparisons.map((c) => ({ ref: c.ref, structuralSignals: c.structuralSignals, substantiveSignals: c.substantiveSignals, distinctContributions: c.distinctContributions, identitySignals: c.identitySignals, confidence: c.confidence, risk: c.risk, metrics: c.metrics })),
    risk,
    findings: [...new Set(all.map((f) => f.code))],
    findingDetails: all,
    evidenceRefs: ["fingerprint v2 (hashed shingles)", "Phase6A CreativeFingerprint v1"],
    limits: "Decision aid only: not a copyright clearance, YouTube eligibility or monetization verdict. Rights/provenance checks remain separate gates.",
    cache: { key: sha16(parts), parts },
    ...(opts.reviewerDecision ? { reviewerDecision: opts.reviewerDecision } : {}),
  };
  assertSafeDoc(doc);
  return doc;
}

module.exports = { ASSESSMENT_VERSION, titleTemplate, buildFingerprintV2, compareEpisodes, assessInternal, assessOriginality, corpusFingerprint, cacheParts, isAssessmentStale, lcsRatio };
