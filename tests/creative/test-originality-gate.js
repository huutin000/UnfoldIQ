"use strict";

/**
 * Phase 6B / 6.5 — Originality / anti-template gate (O01-O12), on a SYNTHETIC golden corpus.
 * Proves the mechanics only: it never claims real channel-level originality (O10).
 */

const fx = require("../fixtures/creative-fixture.js");
const D = require("../fixtures/differentiation-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/originality");
const { originality: og, policy } = D.dif;
const GOLD = D.goldenOriginality();
const byName = (n) => GOLD.find((g) => g.name === n);
const assess = (g, opts = {}) => og.assessOriginality(g.subject, g.corpus, { corpusScope: "GOLDEN_FIXTURES", ...opts });

runTest("O01: same intro/outro/mascot/voice with different substance -> no false FAIL, identity recognised as intentional", () => {
  const a = assess(byName("same-channel-identity-different-substance"));
  assertEq(a.risk, "LOW", "risk LOW");
  assert(a.findings.includes("CHANNEL_IDENTITY_INTENTIONAL"), "identity noted as intentional");
  assert(!a.findings.some((c) => ["EXACT_EPISODE_DUPLICATE", "SEMANTIC_NEAR_DUPLICATE", "REPEATED_STORY_ARC_WITHOUT_NEW_SUBSTANCE"].includes(c)), "identity alone is never a substance finding");
  assert(a.comparisons[0].distinctContributions.length > 0, "distinct contributions are listed");
});

runTest("O02: near-duplicate meaning behind the same template -> HIGH risk with matches, where, why and repair", () => {
  const a = assess(byName("near-duplicate-script-new-package"));
  assertEq(a.risk, "HIGH", "HIGH");
  const f = a.findingDetails.find((x) => x.code === "SEMANTIC_NEAR_DUPLICATE");
  assert(f && f.matches.length === 1 && f.where.length > 0 && f.whyItMatters && f.suggestedRepair && f.falsePositiveConsiderations.length > 0 && f.confidence, "finding cites matches/where/why/confidence/false-positive notes/repair");
});

runTest("O03: common educational topic with distinct evidence and treatment -> not auto-failed", () => {
  const a = assess(byName("same-subject-different-evidence"));
  assertEq(a.risk, "LOW", "LOW");
  assert(!a.findings.includes("SEMANTIC_NEAR_DUPLICATE"), "no duplicate finding");
  assert(a.comparisons[0].distinctContributions.some((c) => c.startsWith("NEW_EVIDENCE_CLAIMS")), "new evidence claims credited");
});

runTest("O04: intentional recap is recognised, but a recap flag cannot hide a duplicate", () => {
  const g = byName("intentional-recap");
  const a = assess(g);
  assertEq(a.risk, "LOW", "recap episode LOW");
  assert(a.comparisons[0].distinctContributions.some((c) => c.startsWith("INTENTIONAL_RECAP_UNITS_EXCLUDED")), "recap units recorded as excluded");
  const dup = D.episode({ id: "g-recap-abuse", topic: "sky", recapBeats: [0, 1, 2, 3, 4, 5], title: "Sky Again", claims: D.C.sky, thesis: "why the sky is blue" }).fp;
  const b = og.assessOriginality(dup, [GOLD[0].corpus[0]], { corpusScope: "GOLDEN_FIXTURES" });
  assertEq(b.risk, "HIGH", "all-recap duplicate is still HIGH");
  assert(b.comparisons.length === 1, "compared");
});

runTest("O05: changed title/thumbnail only does not disguise a duplicate script", () => {
  const a = assess(byName("near-duplicate-script-new-package"));
  assert(a.findings.includes("SEMANTIC_NEAR_DUPLICATE") && !a.findings.includes("TITLE_FORMULA_REPETITION") && !a.findings.includes("THUMBNAIL_FORMULA_REPETITION"), "different packaging, same substance -> still flagged");
  const f = a.findingDetails.find((x) => x.code === "SEMANTIC_NEAR_DUPLICATE");
  assert(/changed title\/thumbnail/.test(f.whyItMatters), "explanation names the packaging-only change");
});

runTest("O06: music/framing/title/CTA repetition alone is a signal (warning), never proof or HIGH risk", () => {
  const a = assess(byName("same-presentation-new-substance"));
  assertEq(a.risk, "LOW", "risk stays LOW");
  const warn = a.findingDetails.filter((f) => f.severity === "WARNING").map((f) => f.code);
  assert(warn.includes("TITLE_FORMULA_REPETITION") && warn.includes("SHOT_MOTION_TEMPLATE_RISK"), `warnings present: ${warn}`);
  assert(a.findingDetails.filter((f) => f.severity === "WARNING").every((f) => f.falsePositiveConsiderations.length > 0), "each warning carries false-positive considerations");
  assert(/not a copyright clearance, YouTube eligibility or monetization verdict/.test(a.limits), "no platform verdict claimed");
});

runTest("O07: exact duplicate content is detected via identity/hash (script hash and video hash)", () => {
  const a = assess(byName("exact-duplicate-republished"));
  assert(a.findings.includes("EXACT_EPISODE_DUPLICATE") && a.risk === "HIGH", "script identity -> EXACT_EPISODE_DUPLICATE");
  const x = D.episode({ id: "v1", topic: "bridge", title: "A", claims: D.C.bridge, videoSha256: "cd".repeat(32) }).fp;
  const y = D.episode({ id: "v2", topic: "sleep", title: "B", claims: D.C.sleep, videoSha256: "cd".repeat(32) }).fp;
  assert(og.assessOriginality(x, [y], { corpusScope: "GOLDEN_FIXTURES" }).findings.includes("EXACT_EPISODE_DUPLICATE"), "identical video bytes -> EXACT_EPISODE_DUPLICATE");
});

runTest("O08: fingerprint/comparator version change invalidates old comparator results", () => {
  const g = byName("same-channel-identity-different-substance");
  const a = assess(g);
  const parts = og.cacheParts(g.subject, g.corpus);
  assertEq(og.isAssessmentStale(a, parts).stale, false, "fresh");
  const s1 = og.isAssessmentStale(a, { ...parts, comparatorVersion: "9.9.9" });
  const s2 = og.isAssessmentStale(a, { ...parts, fingerprintVersion: "3.0.0" });
  assert(s1.stale && s1.reasons.includes("comparatorVersion"), "comparator version bump -> stale");
  assert(s2.stale && s2.reasons.includes("fingerprintVersion"), "fingerprint version bump -> stale");
  assertEq(a.fingerprintVersion, policy.FINGERPRINT_VERSION, "assessment records fingerprint version");
});

runTest("O09: a changed comparison corpus invalidates the channel-level result; unrelated video bytes do not", () => {
  const g = byName("same-channel-identity-different-substance");
  const a = assess(g);
  const extra = D.episode({ id: "g-new", topic: "sleep", title: "New", claims: D.C.sleep }).fp;
  const s = og.isAssessmentStale(a, og.cacheParts(g.subject, [...g.corpus, extra]));
  assert(s.stale && s.reasons.includes("corpusFingerprint") && s.reasons.length === 1, `only the corpus moved: ${s.reasons}`);
  const rebuilt = D.episode({ id: "g-bridge", topic: "bridge", title: "How Suspension Bridges Hold", claims: D.C.bridge, thesis: "why bridge cables hold", videoSha256: "ee".repeat(32) }).fp;
  assert(!("videoSha256" in a.cache.parts), "cache parts exclude video bytes");
  assertEq(og.corpusFingerprint(g.corpus), og.corpusFingerprint([...g.corpus]), "corpus fingerprint is deterministic");
  assert(rebuilt.videoSha256 !== g.subject.videoSha256, "fixture sanity: different bytes");
});

runTest("O10: one real pilot -> no false claim of real channel-level originality proof", () => {
  const pilot = D.episode({ id: "real-1", origin: "REAL_EPISODE", topic: "sky", title: "Why Is the Sky Blue", claims: D.C.sky }).fp;
  const one = og.assessOriginality(pilot, [], { corpusScope: "ONE_VIDEO" });
  assertEq([one.channelLevelOriginality, one.corpusCount], ["NOT_PROVEN", 0], "ONE_VIDEO -> channel level NOT_PROVEN");
  assert(one.findings.includes("INSUFFICIENT_COMPARISON_CORPUS"), "INSUFFICIENT_COMPARISON_CORPUS reported");
  const real = og.assessOriginality(pilot, [D.episode({ id: "real-0", origin: "REAL_EPISODE", topic: "bridge", title: "T", claims: D.C.bridge }).fp], { corpusScope: "REAL_CHANNEL_CORPUS" });
  assertEq([real.coverage, real.risk, real.channelLevelOriginality], ["INSUFFICIENT", "NOT_ASSESSED", "NOT_PROVEN"], "2 real episodes are not a representative channel corpus");
  const synthetic = og.assessOriginality(pilot, GOLD[0].corpus, { corpusScope: "REAL_CHANNEL_CORPUS" });
  assertEq(synthetic.realEpisodeCount, 0, "synthetic fixtures are never counted as real episodes");
});

runTest("O11: golden corpus has both genuinely original and templated cases, each within its expected band", () => {
  assert(GOLD.some((g) => g.expect.risk === "LOW") && GOLD.some((g) => g.expect.risk === "HIGH"), "both bands present");
  for (const g of GOLD) {
    const a = assess(g);
    assertEq(a.risk, g.expect.risk, `${g.name}: risk band`);
    for (const c of g.expect.present || []) assert(a.findings.includes(c), `${g.name}: has ${c}`);
    for (const c of g.expect.absent || []) assert(!a.findings.includes(c), `${g.name}: no ${c}`);
  }
  const stock = assess(byName("stock-reuse-with-new-narration"));
  assert(stock.comparisons[0].identitySignals.some((s) => s.startsWith("ASSET_REUSE")), "stock reuse is context, not a fail");
  const serial = assess(byName("serial-shared-characters"));
  assert(serial.comparisons[0].identitySignals.includes("SAME_SERIES") && serial.risk === "LOW", "serial characters are not a duplicate");
});

runTest("O12: other owners'/channels' private content is never compared", () => {
  const g = byName("near-duplicate-script-new-package");
  const foreign = D.episode({ id: "other-owner", owner: "owner-2", topic: "sky", title: "Sky", claims: D.C.sky, thesis: "why the sky is blue" }).fp;
  const otherChannel = D.episode({ id: "other-chan", channel: "chan-9", topic: "sky", title: "Sky", claims: D.C.sky, thesis: "why the sky is blue" }).fp;
  const a = og.assessOriginality(g.subject, [foreign, otherChannel], { corpusScope: "GOLDEN_FIXTURES" });
  assertEq([a.corpusCount, a.excludedForScope, a.comparisons.length], [0, 2, 0], "both excluded and never compared");
  assert(!JSON.stringify(a).includes("other-owner") && !JSON.stringify(a).includes("owner-2"), "excluded content leaves no trace in the report");
  const same = og.assessOriginality(g.subject, [otherChannel], { corpusScope: "GOLDEN_FIXTURES", allowCrossChannel: true });
  assertEq(same.corpusCount, 1, "same owner, explicit cross-channel opt-in only");
  let code = null;
  try { og.buildFingerprintV2(D.episode({ id: "no-scope", topic: "sky", title: "T" }).analysis.input, null, {}); } catch (e) { code = e.code; }
  assertEq(code, "FINGERPRINT_SCOPE_REQUIRED", "a fingerprint cannot be built without an owner/channel scope");
  assertEq(g.subject.substance.wordingStorage, "HASHED_SHINGLES_ONLY", "wording stored as hashed shingles only (no full-text collection)");
  assert(!JSON.stringify(g.subject).includes("sunlight"), "no spoken text in the fingerprint");
});

runTest("Single-video internal repetition: repeated openers / duplicated beats / slideshow are flagged; clean episode is not", () => {
  const clean = D.episode({ id: "int-ok", topic: "bridge", title: "Bridges", claims: D.C.bridge }).fp;
  assert(og.assessInternal(clean).filter((f) => f.severity !== "INFO").length === 0, "clean episode has no internal findings");
  const rep = ["So the cable holds because of wire count.", "So the anchors hold because of concrete mass.", "So the hangers carry because of tension stiffness.", "So the towers stand because of steel compression.", "So the deck resists because of truss stiffness."];
  const t = D.episode({ id: "int-rep", texts: rep, title: "Bridge Parts", claims: D.C.bridge }).fp;
  assert(og.assessInternal(t).some((f) => f.code === "TRANSITION_PHRASE_OVERUSE"), "same opener on >=40% of beats");
  const dupTexts = [D.TEXTS.bridge[0], D.TEXTS.bridge[1], D.TEXTS.bridge[1], D.TEXTS.bridge[3], D.TEXTS.bridge[4], D.TEXTS.bridge[5]];
  assert(og.assessInternal(D.episode({ id: "int-dup", texts: dupTexts, title: "Bridge", claims: D.C.bridge }).fp).some((f) => f.code === "INTERNAL_BEAT_DUPLICATION"), "restated beat flagged");
  const slide = JSON.parse(JSON.stringify(clean));
  slide.presentation.modalitySequence = ["TITLE", "TITLE", "IMAGE", "TITLE", "IMAGE", "TITLE", "TITLE"];
  slide.presentation.staticShare = 1;
  assert(og.assessInternal(slide).some((f) => f.code === "LOW_VALUE_VISUAL_SLIDESHOW_RISK"), "static title/image slideshow flagged for review");
});

done();
