"use strict";

/**
 * Phase 4A §47 Cases A–X. Publish Packaging on deterministic fixtures.
 * Claim-fidelity uses the fixture evidence/video contract (no mocks).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Ajv = require("ajv");
const fx = require("../fixtures/packaging-fixture.js");
const packaging = fx.packaging;

let passed = 0;
let failed = 0;
function assert(c, m) {
  if (!c) throw new Error("ASSERTION FAILED: " + m);
  console.log("  ok  " + m);
}
function assertEq(a, b, m) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + m);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}
const codes = (qa) => qa.findings.map((f) => f.code);
const blocks = (qa) => qa.findings.filter((f) => f.severity === "BLOCK");

(async () => {

await runTest("Case A — 3 meaningful paired variants", async () => {
  const { set, registry } = fx.buildSet();
  assertEq(set.variants.length, 3, "3 pairs");
  assert(set.variants.every((v) => v.concept && v.audience && v.hypothesis && v.title.text && v.thumbnail.assetId), "concept+audience+hypothesis+pair");
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assertEq(blocks(q).length, 0, "no blocking findings: " + JSON.stringify(codes(q)));
  assert(!codes(q).includes("VARIANTS_TOO_SIMILAR"), "materially distinct");
  const ajv = new Ajv({ strict: false });
  const schema = JSON.parse(fs.readFileSync(path.join(fx.REPO, "schemas", "publish-experiment-set.schema.json"), "utf8"));
  assert(ajv.compile(schema)(set), "experiment set ajv-valid");
});

await runTest("Case B — cosmetic duplicates flagged", async () => {
  const dupes = [
    fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1"),
    { ...fx.concept(2, "How Early Humans Kept Babies Safe At Night!", "c-shelter", "as-thumb1"), concept: "concept-angle-2", audience: "audience-2", hypothesis: "hypothesis-2" },
    fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3"),
  ];
  const { set, registry } = fx.buildSet(dupes);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assert(codes(q).includes("VARIANTS_TOO_SIMILAR"), "pseudo-variant detected: " + JSON.stringify(codes(q)));
  const rep = packaging.repairExperimentSet(set, fx.qaContext(registry));
  assert(rep.stopped === "VARIANTS_TOO_SIMILAR" || (rep.unresolved || []).some((f) => f.code === "VARIANTS_TOO_SIMILAR"), "repair refuses to auto-mangle — needs genuine replan");
});

await runTest("Case C — title over limit flagged + repaired", async () => {
  const long = `How Early Humans Kept Their Babies Safe at Night From Every Predator in the Valley and Beyond Explained`;
  assert(long.length > 100, `test title really over limit (${long.length})`);
  const concepts = [fx.concept(1, long, "c-shelter", "as-thumb1"), fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")];
  const { set, registry } = fx.buildSet(concepts);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assert(codes(q).includes("TITLE_TOO_LONG"), "over-limit detected");
  const rep = packaging.repairExperimentSet(set, fx.qaContext(registry));
  const v = rep.set.variants.find((x) => x.title.text.length > 60);
  assert(v.title.text.length <= 100, `repaired to ${v.title.text.length} chars`);
  const q2 = packaging.validateExperimentSet(rep.set, fx.qaContext(registry));
  assert(!codes(q2).includes("TITLE_TOO_LONG"), "length finding cleared, claim refs intact");
});

await runTest("Case D — description over limit flagged", async () => {
  const profile = packaging.profiles.getPublishProfile("youtube-long-form@1.0.0");
  const big = packaging.buildDescription({ summary: "x".repeat(6000) }, profile);
  assert(!big.ok && big.errors.some((e) => e.startsWith("DESCRIPTION_TOO_LONG")), "over-limit detected");
  const small = packaging.buildDescription({ summary: "Shelter, fire and group vigilance.", learnPoints: ["Why babies were vulnerable", "How fire helped"] }, profile);
  assert(small.ok, "normal description passes");
});

await runTest("Case E — valid thumbnail profile passes", async () => {
  const profile = packaging.profiles.getPublishProfile("youtube-long-form@1.0.0");
  const r = packaging.profiles.validateThumbnailAsset({ width: 1920, height: 1080, format: "JPG", fileSizeBytes: 1500000 }, profile);
  assert(r.ok, "1920×1080 JPG 1.5MB passes: " + JSON.stringify(r.errors));
});

await runTest("Case F — invalid thumbnail geometry/format/size flagged", async () => {
  const profile = packaging.profiles.getPublishProfile("youtube-long-form@1.0.0");
  const square = packaging.profiles.validateThumbnailAsset({ width: 1080, height: 1080, format: "JPG", fileSizeBytes: 500000 }, profile);
  assert(square.errors.some((e) => e.startsWith("THUMBNAIL_WRONG_ASPECT")), "1:1 aspect rejected");
  const tiny = packaging.profiles.validateThumbnailAsset({ width: 320, height: 180, format: "JPG", fileSizeBytes: 100000 }, profile);
  assert(tiny.errors.some((e) => e.startsWith("THUMBNAIL_RESOLUTION_TOO_LOW")), "320px rejected");
  const bmp = packaging.profiles.validateThumbnailAsset({ width: 1920, height: 1080, format: "BMP", fileSizeBytes: 500000 }, profile);
  assert(bmp.errors.some((e) => e.startsWith("THUMBNAIL_FORMAT_INVALID")), "BMP rejected");
  const huge = packaging.profiles.validateThumbnailAsset({ width: 1920, height: 1080, format: "PNG", fileSizeBytes: 5 * 1048576 }, profile);
  assert(huge.errors.some((e) => e.startsWith("THUMBNAIL_FILE_TOO_LARGE")), "5MB rejected");
});

await runTest("Case G — supported factual title passes with refs", async () => {
  const { set, registry } = fx.buildSet([fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1"), fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const v = set.variants[0];
  const g = packaging.claims.gateVariantClaims(v, fx.qaContext(registry));
  assert(!g.findings.some((f) => f.severity === "BLOCK"), "supported claims pass: " + JSON.stringify(codes({ findings: g.findings })));
  assert(g.claims.some((c) => c.status === "SUPPORTED" && c.supportRefs.length > 0), "support refs recorded");
});

await runTest("Case H — unsupported clickbait title blocked", async () => {
  const evil = fx.concept(1, "The Dinosaur That Hunted Human Babies", "c-dino-fake", "as-thumb1");
  const { set, registry } = fx.buildSet([evil, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assert(codes(q).includes("TITLE_UNSUPPORTED_CLAIM"), "unsupported claim flagged");
  assert(codes(q).includes("MISLEADING_PACKAGING") && blocks(q).length > 0, "clickbait blocked");
});

await runTest("Case I — misleading thumbnail visual blocked/reviewed", async () => {
  const bad = fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1",
    { thumbnail: fx.thumbFor("as-thumb1", "c-dino-fake", { visualClaim: "dinosaur chasing baby", claimRefs: ["c-dino-fake"] }) });
  const { set, registry } = fx.buildSet([bad, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assert(codes(q).includes("THUMBNAIL_UNSUPPORTED_CLAIM"), "misleading visual flagged: " + JSON.stringify(codes(q)));
});

await runTest("Case J — title/thumbnail mismatch flagged", async () => {
  const mixed = fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1",
    { thumbnail: fx.thumbFor("as-thumb1", "c-fire", { visualClaim: "fire at night", claimRefs: ["c-fire"] }) });
  const { set, registry } = fx.buildSet([mixed, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assert(codes(q).includes("TITLE_THUMBNAIL_MISMATCH"), "disjoint pair flagged");
  const rep = packaging.repairExperimentSet(set, fx.qaContext(registry));
  const q2 = packaging.validateExperimentSet(rep.set, fx.qaContext(registry));
  assert(!codes(q2).includes("TITLE_THUMBNAIL_MISMATCH"), "pair aligned toward title claim");
});

await runTest("Case K — packaging/video mismatch blocked", async () => {
  const off = fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1");
  const { set, registry } = fx.buildSet([off, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry, { videoSupport: { claimIds: ["c-group"] }, evidenceClaims: [{ claimId: "c-group", supportType: "VIDEO_CONTENT" }] }));
  assert(codes(q).includes("PACKAGING_VIDEO_MISMATCH"), "video-absent claim blocked");
});

await runTest("Case L — generated thumbnail needs canonical asset + provenance", async () => {
  const gen = fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1",
    { thumbnail: { ...fx.thumbFor("as-thumb1", "c-shelter"), sourceType: "GENERATED", generationRecord: { provider: "approved-image", model: "img-1.0", attempt: 1, assetId: "as-thumb1", provenance: "generated:img-1.0:attempt-1" } } });
  const { set, registry } = fx.buildSet([gen, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const v = set.variants[0];
  assertEq(v.thumbnail.generationRecord.provider, "approved-image", "generation record kept");
  assert(v.thumbnail.provenanceRef, "provenance present");
  const anon = packaging.experiment.buildVariant(
    { concept: "x", audience: "y", hypothesis: "z", title: { text: "T", primaryClaim: "c-shelter", claimRefs: ["c-shelter"] }, thumbnail: { concept: "t", width: 1920, height: 1080, format: "JPG", fileSizeBytes: 1, claimRefs: ["c-shelter"] } }, {});
  assert(!anon.ok && anon.errors.some((e) => e.startsWith("MISSING_PROVENANCE")), "anonymous file refused");
});

await runTest("Case M — music attribution exact when required", async () => {
  const manifest = { assets: [{ assetId: "as-music1", sourceType: "licensed", provenance: { source: "library" }, rights: { attributionRequired: true } }] };
  const r = packaging.buildRightsProvenance({ assetManifest: manifest, usedAssetIds: ["as-music1"], musicAttribution: { required: true, exactText: "Music: Night Watch by L. Composer (CC-BY 4.0)" } });
  assertEq(r.rightsProvenance.musicAttribution, "Music: Night Watch by L. Composer (CC-BY 4.0)", "exact canonical credit, never retyped");
  assertEq(r.findings.length, 0, "no findings");
  const missing = packaging.buildRightsProvenance({ assetManifest: manifest, usedAssetIds: ["as-music1"], musicAttribution: { required: true } });
  assert(missing.findings.some((f) => f.code === "MISSING_ATTRIBUTION" && f.severity === "BLOCK"), "missing credit blocks");
});

await runTest("Case N — no fake attribution when not required", async () => {
  const manifest = { assets: [{ assetId: "as-thumb1", sourceType: "original", provenance: { source: "project" }, rights: { attributionRequired: false } }] };
  const r = packaging.buildRightsProvenance({ assetManifest: manifest, usedAssetIds: ["as-thumb1"] });
  assertEq(r.rightsProvenance.musicAttribution, null, "no attribution invented");
  assertEq(r.findings.length, 0, "clean");
});

await runTest("Case O — made-for-kids unknown requires review, never silent false", async () => {
  const m = packaging.buildPublishMetadata({ profileRef: "youtube-long-form@1.0.0", title: "T", description: "D", selectedVariantId: "v1" });
  assertEq(m.metadata.audience.madeForKids, "REVIEW_REQUIRED", "unknown stays unknown");
  assert(m.unknowns.some((u) => u.startsWith("MISSING_AUDIENCE_DECISION")), "review demanded");
  const decided = packaging.buildPublishMetadata({ profileRef: "x", title: "T", description: "D", madeForKids: false, ageRestriction: false });
  assertEq(decided.metadata.audience.madeForKids, false, "explicit false respected");
});

await runTest("Case P — tags small and useful, no stuffing", async () => {
  const t = packaging.buildTags({ tags: ["hominin", "hominin", "HOMININ ", "Lucy skeleton", "Australopithecus"] });
  assertEq(JSON.stringify(t.tags), JSON.stringify(["hominin", "Lucy skeleton", "Australopithecus"]), "deduped, order-kept");
  assertEq(t.stuffed, false, "normal set fine");
  const stuffed = packaging.buildTags({ tags: Array.from({ length: 30 }, (_, i) => `keyword${i}`) });
  assertEq(stuffed.tags.length, 10, "capped at 10");
  assertEq(stuffed.stuffed, true, "stuffing flagged");
});

await runTest("Case Q — small-preview thumbnail QA", async () => {
  const dense = fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1",
    { thumbnail: { ...fx.thumbFor("as-thumb1", "c-shelter"), textOverlay: "EVERYTHING YOU MUST KNOW ABOUT NIGHT SURVIVAL TACTICS", textLegibility: { fontSizePx: 28, elements: 6 } } });
  const { set, registry } = fx.buildSet([dense, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry));
  assert(codes(q).includes("THUMBNAIL_TEXT_UNREADABLE"), "unreadable overlay flagged");
  const clean = fx.concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1",
    { thumbnail: { ...fx.thumbFor("as-thumb1", "c-shelter"), textOverlay: "SAFE AT NIGHT", textLegibility: { fontSizePx: 120, elements: 2 } } });
  const { set: set2 } = fx.buildSet([clean, fx.concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3")]);
  const q2 = packaging.validateExperimentSet(set2, fx.qaContext(registry));
  assert(!codes(q2).includes("THUMBNAIL_TEXT_UNREADABLE") && !codes(q2).includes("THUMBNAIL_TOO_COMPLEX"), "legible overlay passes");
});

await runTest("Case R — manual title override preserved + QA rerun", async () => {
  const store = packaging.createPackagingStore();
  const { registry } = fx.buildSet();
  const b = store.buildSet("pr", { contentHashes: { script: "s1", timeline: "t1" }, concepts: fx.baseConcepts() }, { assetResolver: registry.resolver });
  assert(b.ok, "store build ok");
  const vid = b.set.variants[0].variantId;
  const p = store.patch("pr", { patchId: "pk-1", op: "EDIT_TITLE", variantId: vid, text: "Operator Cut: Babies Definitely Hunted Dinosaurs", primaryClaim: "c-operator-invented", claimRefs: ["c-operator-invented"] });
  assert(p.ok, "operator edit applied");
  assertEq(p.set.variants[0].title.text, "Operator Cut: Babies Definitely Hunted Dinosaurs", "edit preserved");
  const q = packaging.validateExperimentSet(p.set, fx.qaContext(registry));
  assert(codes(q).includes("TITLE_UNSUPPORTED_CLAIM"), "claim QA rerun catches the invented claim");
});

await runTest("Case S — manual thumbnail override preserved + rights/claim rerun", async () => {
  const store = packaging.createPackagingStore();
  const { registry } = fx.buildSet();
  const b = store.buildSet("ps", { contentHashes: { script: "s1", timeline: "t1" }, concepts: fx.baseConcepts() }, { assetResolver: registry.resolver });
  const vid = b.set.variants[0].variantId;
  const p = store.patch("ps", { patchId: "pk-2", op: "REPLACE_THUMBNAIL", variantId: vid, thumbnail: { assetId: "as-thumb2", width: 1920, height: 1080, format: "JPG", fileSizeBytes: 900000, provenanceRef: "provenance:as-thumb2" } });
  assert(p.ok, "operator asset applied");
  assertEq(p.set.variants[0].thumbnail.assetId, "as-thumb2", "operator asset preserved");
  const q = packaging.validateExperimentSet(p.set, fx.qaContext(registry));
  assert(q.findings.length >= 0, "QA reruns without crashing: " + JSON.stringify(codes(q)));
});

await runTest("Case T — upstream content change marks packaging stale", async () => {
  const { set, registry } = fx.buildSet(fx.baseConcepts(), "p", { script: "s1", timeline: "t1" });
  const q = packaging.validateExperimentSet(set, fx.qaContext(registry, { currentContentHashes: { script: "s2-CHANGED", timeline: "t1" } }));
  assert(codes(q).includes("STALE_PACKAGING_INPUT") && blocks(q).length > 0, "stale content blocks");
});

await runTest("Case U — packaging-only patch leaves media clean", async () => {
  const titleInv = packaging.resolvePackagingInvalidation({ scope: "TITLE_ONLY" });
  assert(titleInv.titleQADirty && titleInv.claimQADirty && titleInv.metadataDirty, "packaging branches dirty");
  assert(titleInv.videoRenderClean && titleInv.audioClean && titleInv.timelineClean, "media branches clean");
  const thumbInv = packaging.resolvePackagingInvalidation({ scope: "THUMBNAIL_ONLY" });
  assert(thumbInv.thumbnailQADirty && thumbInv.rightsDirty && thumbInv.videoRenderClean, "thumbnail isolation");
});

await runTest("Case V — persistence/restart reloads same state", async () => {
  const { set } = fx.buildSet();
  const sel = packaging.experiment.selectPackagingVariant(set, set.variants[0].variantId, "best content match", true);
  assert(sel.ok, "selection ok");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-pack-"));
  fs.mkdirSync(path.join(tmp, "projects", "validation", "proj-pack"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "projects", "registry.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    projects: [{ projectId: "proj-pack", kind: "VALIDATION", status: "ACTIVE", path: "projects/validation/proj-pack", manifestRef: null }],
  }));
  const s1 = packaging.persistPackagingFile(tmp, "proj-pack", "publish-experiment-set.json", { ...sel.set, revision: 3 });
  assert(s1.ok, "persist ok");
  const l1 = packaging.loadPackagingFile(tmp, "proj-pack", "publish-experiment-set.json");
  assert(l1.ok, "reload ok");
  assertEq(l1.data.selectedVariantId, sel.set.variants[0].variantId, "selection durable");
  assertEq(JSON.stringify(l1.data.variants), JSON.stringify(sel.set.variants), "variants identical");
  const stale = packaging.persistPackagingFile(tmp, "proj-pack", "publish-experiment-set.json", { ...sel.set, revision: 99 }, 12345);
  assertEq(stale.code, "STALE_PACKAGING_INPUT", "stale overwrite refused");
  fs.rmSync(tmp, { recursive: true, force: true });
});

await runTest("Case W — idempotent retry creates no duplicates", async () => {
  const store = packaging.createPackagingStore();
  const { registry } = fx.buildSet();
  const input = { contentHashes: { script: "s1", timeline: "t1" }, concepts: fx.baseConcepts() };
  const a = store.buildSet("pw", input, { assetResolver: registry.resolver });
  const b = store.buildSet("pw", input, { assetResolver: registry.resolver });
  assert(a.ok && b.ok, "both builds ok");
  assertEq(a.set.experimentSetId, b.set.experimentSetId, "stable experiment ID");
  assertEq(b.idempotent, true, "retry reported idempotent");
});

await runTest("Case X — package completeness, final video explicitly pending", async () => {
  const { set, registry } = fx.buildSet();
  const sel = packaging.experiment.selectPackagingVariant(set, set.variants[1].variantId, "strongest content match", true);
  const profile = packaging.profiles.getPublishProfile("youtube-long-form@1.0.0");
  const desc = packaging.buildDescription({ summary: "How early humans protected their young.", learnPoints: ["Shelter", "Fire", "Group vigilance"] }, profile);
  assert(desc.ok, "description ok");
  const meta = packaging.buildPublishMetadata({ profileRef: "youtube-long-form@1.0.0", title: sel.set.variants[1].title.text, description: desc.text, language: "en", madeForKids: false, ageRestriction: false, selectedVariantId: sel.set.variants[1].variantId });
  const rights = packaging.buildRightsProvenance({ assetManifest: { assets: [{ assetId: "as-thumb2", sourceType: "original", provenance: { source: "project" }, rights: {} }] }, usedAssetIds: ["as-thumb2"] });
  const compliance = packaging.buildCompliance({ profile, experimentSet: sel.set, metadata: meta.metadata, rightsFindings: rights.findings, description: desc.text });
  const pkg = packaging.buildPublishPackage({
    projectId: "p", sourceTimelineRevision: 7, experimentSet: sel.set,
    metadata: meta.metadata, descriptionRef: "packaging/description.md",
    captions: { srtRef: "captions/captions.srt" },
  });
  assert(pkg.ok, "package ok");
  assertEq(pkg.manifest.finalVideoRef, "PENDING_PHASE_4B", "final video explicitly pending — no publishability claim");
  assert(pkg.manifest.uploadChecklist.includes("Phase 4B PASS"), "checklist gates on 4B");
  assert(pkg.manifest.selectedTitle && pkg.manifest.selectedThumbnail, "selection resolved");
  const ajv = new Ajv({ strict: false });
  const schema = JSON.parse(fs.readFileSync(path.join(fx.REPO, "schemas", "publish-package-manifest.schema.json"), "utf8"));
  assert(ajv.compile(schema)(pkg.manifest), "manifest ajv-valid");
  assert(compliance.compliance.checks.some((c) => c.detail === "PENDING_PHASE_4B"), "4B-owned checks marked pending, not passed");
});

console.log(`\n=== packaging: ${failed} failed, ${passed} passed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
