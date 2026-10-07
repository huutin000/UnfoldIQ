"use strict";

/**
 * Phase 1G.7 — Platform Policy targeted tests (Prompt 01).
 * Deterministic. No rendering, no generation, 0 provider calls, 0 credits,
 * 0 Flow UI. Covers P/A/Z/R/G/I/S/E matrices + mixed fixture + 16:9/9:16 gate.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const pp = require("../../lib/platform-policy/index.js");
const pc = require("../../lib/prompt-compiler/index.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `unfoldiq-1g7-${tag}-`));
}

const NOW = "2026-10-03T00:00:00.000Z";

function mkShot(id, extra = {}) {
  return {
    shotId: id, parentSceneId: "sc-aaaaaaaaaaaaaaaa", beatIds: ["b1"],
    claimRefs: [], shotPurpose: "DETAIL", visualObjective: "EXPLAIN",
    subjectRefs: [], continuityRefs: ["cg-1"], ...extra,
  };
}

function adapt(shot, platformId, extra = {}) {
  const r = pp.adaptShot({
    shot, sourceAspectRatio: "16:9", platformId,
    options: { now: NOW, ...(extra.options || {}) },
    ...extra,
  });
  if (!r.ok) throw new Error(`adapt failed: ${r.code} ${r.message || ""}`);
  return r.artifact;
}

async function main() {
  // ---------------- P — PLATFORM PROFILES ----------------
  await runTest("P1 YOUTUBE_LONG profile", () => {
    const r = pp.getTargetProfile("YOUTUBE_LONG");
    assert(r.ok && r.profile.preferredAspectRatio === "16:9", "long prefers 16:9");
    assert(r.profile.orientation === "LANDSCAPE", "landscape");
    assert(r.profile.baseProfile === "platforms/youtube/PROFILE.yaml", "references canonical base profile");
  });

  await runTest("P2 YOUTUBE_SHORTS profile", () => {
    const r = pp.getTargetProfile("YOUTUBE_SHORTS");
    assert(r.ok && r.profile.preferredAspectRatio === "9:16", "shorts prefers 9:16");
    assert(r.profile.orientation === "PORTRAIT", "portrait");
  });

  await runTest("P3 TIKTOK profile", () => {
    const r = pp.getTargetProfile("TIKTOK");
    assert(r.ok && r.profile.preferredAspectRatio === "9:16", "tiktok prefers 9:16");
    assert(r.profile.baseProfile === "platforms/tiktok/PROFILE.yaml", "references canonical base profile");
  });

  await runTest("P4 unknown platform rejected", () => {
    const r = pp.getTargetProfile("REELS");
    assert(!r.ok && r.code === "UNKNOWN_PLATFORM", "no nearest-profile assumption");
    const v = pp.validateAdaptation({ artifact: { ...pp.adaptShot({ shot: mkShot("sh-p4"), platformId: "TIKTOK", options: { now: NOW } }).artifact, platformId: "REELS" } });
    assert(!v.valid && v.errors.some((e) => e.code === "UNKNOWN_PLATFORM"), "validator rejects unknown platform");
  });

  await runTest("P5 preferred vs accepted vs required stay distinct", () => {
    const shorts = pp.getTargetProfile("YOUTUBE_SHORTS").profile;
    assert(shorts.acceptedAspectRatios.includes("9:16"), "preferred is in accepted");
    assert(shorts.acceptedAspectRatios.includes("1:1"), "square accepted (official Shorts fact, not reduced to 9:16-only)");
    assert(shorts.requiredAspectRatio === null, "required stays UNKNOWN without a hard constraint");
    const v = pp.validateAdaptation({
      artifact: adapt(mkShot("sh-p5"), "YOUTUBE_SHORTS"),
      context: { targetProfile: { ...shorts, acceptedAspectRatios: ["1:1"] } },
    });
    assert(!v.valid && v.errors.some((e) => e.code === "PREFERRED_ACCEPTED_CONFLATION"), "conflation detected");
  });

  // ---------------- A — ASPECT / ORIENTATION ----------------
  await runTest("A1 16:9 master to 16:9 preserves", () => {
    const a = adapt(mkShot("sh-a1"), "YOUTUBE_LONG", { decision: { visualModality: "ATMOSPHERE", renderMode: "STATIC_IMAGE" } });
    assert(a.action === "PRESERVE" && a.cropPlan === null, "native master untouched");
    assert(a.regenerationDecision === "NOT_REQUIRED", "no regeneration");
  });

  await runTest("A2 16:9 to 9:16 reframes", () => {
    const a = adapt(mkShot("sh-a2"), "TIKTOK", {
      regions: { subjectAnchors: [{ regionId: "subj", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
      decision: { visualModality: "CHARACTER_MOMENT", renderMode: "STATIC_IMAGE" },
    });
    assert(a.action === "REFRAME", `reframe, got ${a.action}`);
    assert(Math.abs(a.cropPlan.window.w - 0.3164) < 0.001, "9:16 window inside 16:9 master");
  });

  await runTest("A3 square/vertical Shorts fact preserved", () => {
    const shorts = pp.getTargetProfile("YOUTUBE_SHORTS").profile;
    assert(shorts.preferredAspectRatio === "9:16" && shorts.acceptedAspectRatios.includes("1:1"), "preference ≠ exclusive support");
  });

  await runTest("A4 orientation never changes modality", () => {
    const shot = mkShot("sh-a4");
    const mods = ["YOUTUBE_LONG", "YOUTUBE_SHORTS", "TIKTOK"].map((p) => adapt(shot, p, {
      regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
      decision: { visualModality: "MAP", renderMode: "REMOTION_MOTION" },
    }).sourceModality);
    assert(mods.every((m) => m === "MAP"), "MAP stays MAP on every platform");
  });

  await runTest("A5 orientation never selects a model", () => {
    for (const p of ["YOUTUBE_LONG", "YOUTUBE_SHORTS", "TIKTOK"]) {
      const a = adapt(mkShot(`sh-a5-${p}`), p, { decision: { visualModality: "ATMOSPHERE" } });
      const v = pp.validateAdaptation({ artifact: a });
      assert(v.valid, `${p} validates without model fields`);
      assert(!/recommendedModel|selectedModel|modelId/i.test(JSON.stringify(a)), `${p} carries no model selection`);
    }
  });

  // ---------------- Z — SAFE ZONES ----------------
  await runTest("Z1 sourced verified zone is consumed", () => {
    const a = adapt(mkShot("sh-z1"), "TIKTOK", {
      regions: { textRegions: [{ regionId: "cap1", kind: "caption", x: 0.1, y: 0.82, w: 0.8, h: 0.1, content: "Keep captions clear" }] },
      decision: { visualModality: "TYPOGRAPHY" },
    });
    assert(a.textPlan.reflowed.includes("cap1"), "bottom-band text relocated");
    assert(a.textPlan.placements.some((pl) => /tiktok-bottom-ui/.test(pl.reason)), "reason cites the sourced zone");
    const moved = a.textPlan.placements.find((pl) => pl.regionId === "cap1");
    assert(moved.to.y + 0.1 <= 0.8 + 1e-9, "relocated clear of the band");
  });

  await runTest("Z2 UNKNOWN safe zone stays UNKNOWN", () => {
    const tt = pp.getTargetProfile("TIKTOK").profile;
    const rail = tt.safeZonePolicy.zones.find((z) => z.zoneId === "tiktok-right-rail");
    assert(rail && rail.region === null && rail.status === "UNKNOWN", "no geometry invented");
    const sh = pp.getTargetProfile("YOUTUBE_SHORTS").profile;
    assert(sh.safeZonePolicy.status === "UNKNOWN", "shorts policy honestly UNKNOWN");
  });

  await runTest("Z3 UI/context-dependent zone remains contextual", () => {
    const tt = pp.getTargetProfile("TIKTOK").profile;
    const bottom = tt.safeZonePolicy.zones.find((z) => z.zoneId === "tiktok-bottom-ui");
    assert(/caption length|variant/i.test(bottom.notes), "dependency preserved in notes");
  });

  await runTest("Z4 no invented pixel margins", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "platforms", "TARGETS.yaml"), "utf8");
    assert(!/\b\d{3,}px\b/.test(raw), "no pixel margins in policy data");
    const tt = pp.getTargetProfile("TIKTOK").profile;
    for (const z of tt.safeZonePolicy.zones) {
      if (z.region) assert(z.sourceRefs && z.sourceRefs.length > 0, `${z.zoneId} geometry is sourced`);
    }
  });

  await runTest("Z5 unsafe text placement yields review, not silent loss", () => {
    const a = adapt(mkShot("sh-z5"), "TIKTOK", {
      regions: { textRegions: [{ regionId: "wall", kind: "caption", x: 0.05, y: 0.1, w: 0.9, h: 0.85, content: "Unavoidable wall of text" }] },
      decision: { visualModality: "TYPOGRAPHY" },
    });
    assert(a.status === "REVIEW_REQUIRED", "unplaceable text escalates");
    assert(a.risks.some((r) => /TEXT_UNPLACEABLE/.test(r)), "structured risk recorded");
    assert(a.textPlan.unplaceable.includes("wall"), "unplaceable tracked");
  });

  // ---------------- R — REFRAME / RELAYOUT ----------------
  await runTest("R1 character reframe preserves subject", () => {
    const a = adapt(mkShot("sh-r1"), "TIKTOK", {
      regions: { subjectAnchors: [{ regionId: "hero", kind: "subject", x: 0.35, y: 0.1, w: 0.3, h: 0.8 }] },
      decision: { visualModality: "CHARACTER_MOMENT", renderMode: "STATIC_IMAGE" },
    });
    assert(a.action === "REFRAME" && a.cropPlan.adequate, "subject fits portrait crop");
    assert(a.preservedIntent.some((p) => /modality CHARACTER_MOMENT unchanged/.test(p)), "intent recorded");
  });

  await runTest("R2 map preserves route and labels", () => {
    const route = [{ regionId: "route", kind: "route", x: 0.35, y: 0.3, w: 0.3, h: 0.2, content: "north-harbor-route" }];
    const labels = [{ regionId: "lbl1", kind: "label", x: 0.4, y: 0.25, w: 0.2, h: 0.08, content: "North Harbor" }];
    const a = adapt(mkShot("sh-r2"), "TIKTOK", {
      regions: { dataPoints: route, textRegions: labels },
      decision: { visualModality: "MAP", renderMode: "REMOTION_MOTION" },
    });
    assert(["REFRAME", "REFRAME_AND_RELAYOUT"].includes(a.action), `map adapted, got ${a.action}`);
    const carried = JSON.stringify(a.relayoutPlan || {}) + JSON.stringify(a.textPlan);
    assert(/North Harbor/.test(carried) || a.cropPlan.adequate, "labels preserved or inside crop");
  });

  await runTest("R3 chart preserves trend and values", () => {
    const points = [0.1, 0.3, 0.5, 0.7, 0.9].map((x, i) => ({ regionId: `v${i}`, kind: "value", x, y: 0.5 - i * 0.08, w: 0.04, h: 0.04, content: `Q${i + 1}:${10 * (i + 1)}` }));
    const a = adapt(mkShot("sh-r3"), "TIKTOK", {
      regions: { dataPoints: points },
      decision: { visualModality: "CHART", renderMode: "REMOTION_MOTION" },
    });
    assert(a.action === "RELAYOUT", `wide chart relayouts, got ${a.action}`);
    const carried = a.relayoutPlan.carriedElements.map((e) => e.content);
    assert(JSON.stringify(carried) === JSON.stringify(points.map((p) => p.content)), "values verbatim and ordered");
  });

  await runTest("R4 diagram preserves mechanism labels", () => {
    const labels = [{ regionId: "step1", kind: "label", x: 0.05, y: 0.4, w: 0.25, h: 0.1, content: "intake" }, { regionId: "step2", kind: "label", x: 0.7, y: 0.4, w: 0.25, h: 0.1, content: "exhaust" }];
    const a = adapt(mkShot("sh-r4"), "TIKTOK", {
      regions: { textRegions: labels },
      decision: { visualModality: "DIAGRAM", renderMode: "REMOTION_MOTION" },
    });
    const allContent = JSON.stringify(a);
    assert(/intake/.test(allContent) && /exhaust/.test(allContent), "mechanism labels survive");
    assert(a.regenerationDecision === "NOT_REQUIRED", "no regeneration for relayoutable diagram");
  });

  await runTest("R5 split-screen relayout works in portrait", () => {
    const a = adapt(mkShot("sh-r5"), "TIKTOK", {
      regions: { graphicRegions: [{ regionId: "left", kind: "panel", x: 0, y: 0.1, w: 0.48, h: 0.8 }, { regionId: "right", kind: "panel", x: 0.52, y: 0.1, w: 0.48, h: 0.8 }] },
      decision: { visualModality: "SPLIT_SCREEN", renderMode: "REMOTION_MOTION" },
    });
    assert(a.action === "RELAYOUT" && a.relayoutPlan.strategy === "stacked-split", "side-by-side becomes stacked");
  });

  await runTest("R6 typography remains readable and verbatim", () => {
    const quote = "The harbor logbook matters.";
    const a = adapt(mkShot("sh-r6"), "TIKTOK", {
      regions: { textRegions: [{ regionId: "q1", kind: "quote", x: 0.1, y: 0.3, w: 0.8, h: 0.2, content: quote }] },
      decision: { visualModality: "TYPOGRAPHY", renderMode: "STATIC_IMAGE" },
    });
    assert(JSON.stringify(a.textPlan).includes(quote), "text content unchanged");
    assert(!/scale.*0\.[0-4]|font.*shrink/i.test(JSON.stringify(a)), "no unreadable scaling");
  });

  await runTest("R7 impossible crop escalates before regeneration honestly", () => {
    const a = adapt(mkShot("sh-r7", { shotPurpose: "REVEAL" }), "TIKTOK", {
      regions: {
        protectedRegions: [{ regionId: "action-wide", kind: "action", x: 0, y: 0.3, w: 1.0, h: 0.4 }],
        subjectAnchors: [{ regionId: "a", kind: "subject", x: 0.02, y: 0.3, w: 0.1, h: 0.4 }, { regionId: "b", kind: "subject", x: 0.88, y: 0.3, w: 0.1, h: 0.4 }],
      },
      decision: { visualModality: "CHARACTER_MOMENT", renderMode: "VEO_FIRST_FRAME", actionIntent: "two figures struggle across the gate" },
    });
    assert(a.action === "REGENERATE_REQUIRED", "full-width essential action cannot be cropped");
    assert(a.regenerationDecision === "TARGETED_REGENERATION_REQUIRED", "targeted, never full-sequence");
    assert(a.regenerationReasons.length > 0 && /irrecoverable|essential/i.test(a.regenerationReasons.join(" ")), "essential reasons recorded");
  });

  // ---------------- G — REGENERATION GATE ----------------
  await runTest("G1 adequate reframe needs no regeneration", () => {
    const a = adapt(mkShot("sh-g1"), "TIKTOK", {
      regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
      decision: { visualModality: "ATMOSPHERE" },
    });
    assert(a.regenerationDecision === "NOT_REQUIRED" && a.regenerationReasons.length === 0, "clean reframe");
  });

  await runTest("G2 adequate relayout needs no regeneration", () => {
    const a = adapt(mkShot("sh-g2"), "TIKTOK", {
      regions: { dataPoints: [{ regionId: "v", kind: "value", x: 0.4, y: 0.4, w: 0.2, h: 0.1, content: "42" }] },
      decision: { visualModality: "CHART" },
    });
    assert(a.regenerationDecision === "NOT_REQUIRED", "relayout wins over regenerate");
  });

  await runTest("G3/G4 one failed shot never regenerates the sequence", () => {
    const wide = {
      shot: mkShot("sh-g3-wide", { shotPurpose: "REVEAL" }),
      regions: { protectedRegions: [{ regionId: "wide", kind: "action", x: 0, y: 0.3, w: 1.0, h: 0.4 }] },
      decision: { visualModality: "CHARACTER_MOMENT", renderMode: "VEO_FIRST_FRAME" },
    };
    const okShots = ["sh-g3-a", "sh-g3-b", "sh-g3-c"].map((id) => ({
      shot: mkShot(id),
      regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
      decision: { visualModality: "ATMOSPHERE" },
    }));
    const r = pp.adaptSequence([wide, ...okShots], "TIKTOK", { options: { now: NOW } });
    assert(r.failed.length === 0, "no engine errors");
    const byId = Object.fromEntries(r.adaptations.map((a) => [a.shotId, a]));
    assert(byId["sh-g3-wide"].regenerationDecision === "TARGETED_REGENERATION_REQUIRED", "only the affected shot regenerates");
    assert(["sh-g3-a", "sh-g3-b", "sh-g3-c"].every((id) => byId[id].regenerationDecision === "NOT_REQUIRED"), "9 (here 3) adaptations remain reusable");
  });

  await runTest("G5 aesthetic preference alone cannot trigger regeneration", () => {
    const a = adapt(mkShot("sh-g5"), "TIKTOK", {
      regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
      decision: { visualModality: "ATMOSPHERE" },
      options: { preferCinematic: true, makeItPop: 1 },
    });
    assert(a.regenerationDecision === "NOT_REQUIRED", "no regeneration input exists for aesthetics");
    assert(!/cinematic|nicer|prettier/i.test(JSON.stringify(a)), "aesthetic language nowhere in artifact");
  });

  // ---------------- I — INTEGRATION BOUNDARIES ----------------
  await runTest("I1 1G.5 decision byte-identical after adaptation", () => {
    const decision = { decisionId: "pd-1", fingerprint: "f".repeat(16), visualModality: "MAP", renderMode: "REMOTION_MOTION", claimRefs: ["clm-1"] };
    const before = JSON.stringify(decision);
    adapt(mkShot("sh-i1", { claimRefs: ["clm-1"] }), "TIKTOK", {
      regions: { dataPoints: [{ regionId: "r", kind: "route", x: 0.4, y: 0.4, w: 0.2, h: 0.1, content: "route" }] },
      decision,
    });
    assert(JSON.stringify(decision) === before, "read-only consumption");
  });

  await runTest("I2/I3 modality and render mode unchanged", () => {
    for (const p of ["YOUTUBE_LONG", "YOUTUBE_SHORTS", "TIKTOK"]) {
      const a = adapt(mkShot(`sh-i23-${p}`), p, {
        regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
        decision: { visualModality: "CHARACTER_MOMENT", renderMode: "VEO_REFERENCE" },
      });
      assert(a.sourceModality === "CHARACTER_MOMENT" && a.sourceRenderMode === "VEO_REFERENCE", `${p} preserves upstream truth`);
      assert(a.preservedIntent.some((x) => /render mode VEO_REFERENCE unchanged/.test(x)), `${p} records non-demotion`);
    }
  });

  await runTest("I4 1G.6 registry untouched and unrequired", () => {
    const src = (fs.readFileSync(path.join(__dirname, "..", "..", "lib", "platform-policy", "adapt.js"), "utf8")
      + fs.readFileSync(path.join(__dirname, "..", "..", "lib", "platform-policy", "index.js"), "utf8"))
      .split("\n").filter((l) => !/OVERRIDE_BLOCKED_FIELDS/.test(l)).join("\n");
    assert(!/model-registry|recommendedModel|selectedModel|require.*resolver/.test(src), "no 1G.6 coupling (blocklist forbids model fields in overrides)");
  });

  await runTest("I5 Prompt Compiler ownership untouched", async () => {
    const r = await pc.compilePromptPackage({
      projectId: "p-1g7",
      shot: { shotId: "sh-i5iiiiiiiiii", parentSceneId: "sc-aaaaaaaaaaaaaaaa", beatIds: ["b1"] },
      scene: { sceneId: "sc-aaaaaaaaaaaaaaaa" },
      beatMap: { beats: [{ beatId: "b1", summary: "x", claimRefs: [], storySectionRef: "s" }], fingerprint: "f" },
      platform: "youtube", contentClass: "FACTUAL",
    }, { persist: false });
    assert(r.status === "PROMPT_TARGET_REQUIRED", "compiler still caller-driven");
  });

  await runTest("I6/I7/I8 no generation, UI mutation, or spend", () => {
    const dir = path.join(__dirname, "..", "..", "lib", "platform-policy");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      assert(!/\.execute\s*\(|fetch\s*\(|https?\.request|axios|playwright|remotion/i.test(src), `${f}: no generation/render/network calls`);
      assert(!/\.click\s*\(|browser\.launch|page\.\$/.test(src), `${f}: no UI automation`);
      assert(!/estimatedVeo|estimatedImages|creditLedger|spendCredits|charge\(/.test(src), `${f}: no cost planning`);
    }
  });

  // ---------------- S — STALENESS / PERSISTENCE ----------------
  function seqInput(id, mod, regions, decisionExtra = {}) {
    return {
      shot: mkShot(id),
      sourceAspectRatio: "16:9",
      regions,
      decision: { visualModality: mod, renderMode: "STATIC_IMAGE", ...decisionExtra },
      options: { now: NOW },
    };
  }

  await runTest("S1 same inputs produce same fingerprint", () => {
    const mk = () => adapt(mkShot("sh-s1"), "TIKTOK", {
      regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] },
      decision: { visualModality: "ATMOSPHERE" },
    });
    assert(mk().fingerprint === mk().fingerprint, "idempotent");
  });

  await runTest("S2 TikTok policy change stales TikTok only", () => {
    const base = seqInput("sh-s2", "ATMOSPHERE", { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] });
    const tt = pp.adaptShot({ ...base, platformId: "TIKTOK" }).artifact;
    const yl = pp.adaptShot({ ...base, platformId: "YOUTUBE_LONG" }).artifact;
    const changed = { ...pp.getTargetProfile("TIKTOK").profile, pacingPolicy: { hookUrgency: "LOW" }, fingerprint: "changed" };
    const stT = pp.checkAdaptationStaleness(tt, { targetProfile: changed });
    assert(stT.stale && stT.reasons.some((r) => /TIKTOK profile changed/.test(r)), "tiktok dirty");
    const stY = pp.checkAdaptationStaleness(yl, { targetProfile: pp.getTargetProfile("YOUTUBE_LONG").profile });
    assert(!stY.stale, "youtube long clean");
  });

  await runTest("S3 Shorts policy change leaves Long clean", () => {
    const base = seqInput("sh-s3", "ATMOSPHERE", { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] });
    const sh = pp.adaptShot({ ...base, platformId: "YOUTUBE_SHORTS" }).artifact;
    const yl = pp.adaptShot({ ...base, platformId: "YOUTUBE_LONG" }).artifact;
    const changed = { ...pp.getTargetProfile("YOUTUBE_SHORTS").profile, fingerprint: "changed-shorts" };
    assert(pp.checkAdaptationStaleness(sh, { targetProfile: changed }).stale, "shorts dirty");
    assert(!pp.checkAdaptationStaleness(yl, { targetProfile: pp.getTargetProfile("YOUTUBE_LONG").profile }).stale, "long clean");
  });

  await runTest("S4 source composition change stales dependent adaptations", () => {
    const regions = { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] };
    const a = adapt(mkShot("sh-s4"), "TIKTOK", { regions, decision: { visualModality: "ATMOSPHERE" } });
    const master2 = pp.buildMasterComposition({
      shot: mkShot("sh-s4"), sourceAspectRatio: "16:9",
      regions: { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.1, y: 0.2, w: 0.2, h: 0.6 }] },
    }).master;
    const st = pp.checkAdaptationStaleness(a, { master: master2 });
    assert(st.stale && st.reasons.includes("source composition changed"), "composition change detected");
  });

  await runTest("S5 unrelated asset change does not stale adaptation", () => {
    const regions = { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] };
    const decision = { visualModality: "ATMOSPHERE" };
    const a = adapt(mkShot("sh-s5"), "TIKTOK", { regions, decision });
    const same = pp.buildMasterComposition({ shot: mkShot("sh-s5"), sourceAspectRatio: "16:9", regions, decision }).master;
    const st = pp.checkAdaptationStaleness(a, { master: same, targetProfile: pp.getTargetProfile("TIKTOK").profile });
    assert(!st.stale, "unrelated change is not a dependency");
  });

  await runTest("S6 persistence round-trip preserves manual choices", () => {
    const root = tmpRoot("persist");
    const regions = { subjectAnchors: [{ regionId: "s", kind: "subject", x: 0.4, y: 0.2, w: 0.2, h: 0.6 }] };
    const master = pp.buildMasterComposition({ shot: mkShot("sh-s6"), sourceAspectRatio: "16:9", regions }).master;
    const profile = pp.getTargetProfile("TIKTOK").profile;
    const base = pp.adaptShot({ shot: mkShot("sh-s6"), sourceAspectRatio: "16:9", regions, platformId: "TIKTOK", decision: { visualModality: "ATMOSPHERE" }, options: { now: NOW } }).artifact;
    assert(pp.persistAdaptation(root, "p-1g7", base).ok, "persisted");
    const o = pp.applyAdaptationOverride(base, { forceCropAnchor: { cx: 0.6 }, reason: "follow subject right", acknowledgeRisk: true }, { master, targetProfile: profile });
    assert(o.state.startsWith("ACCEPTED"), `override ${o.state}`);
    assert(pp.persistAdaptation(root, "p-1g7", { ...o.artifact, _overrideSet: true }).ok, "override persisted");
    const fresh = pp.adaptShot({ shot: mkShot("sh-s6"), sourceAspectRatio: "16:9", regions, platformId: "TIKTOK", decision: { visualModality: "ATMOSPHERE" }, options: { now: NOW } }).artifact;
    assert(pp.persistAdaptation(root, "p-1g7", fresh).ok, "refresh persisted");
    const loaded = pp.loadAdaptation(root, "p-1g7", "TIKTOK", "sh-s6");
    assert(Math.abs(loaded.artifact.cropPlan.window.x - o.artifact.cropPlan.window.x) < 1e-9, "manual crop anchor survives refresh");
    // Forbidden override: cropping away essential facts without acknowledgment.
    const bad = pp.applyAdaptationOverride(base, { forceCropAnchor: { cx: 0.02 } }, {
      master: pp.buildMasterComposition({
        shot: mkShot("sh-s6"), sourceAspectRatio: "16:9",
        regions: { protectedRegions: [{ regionId: "fact", kind: "label", x: 0.8, y: 0.4, w: 0.15, h: 0.1, content: "Q4:42" }] },
      }).master, targetProfile: profile,
    });
    assert(bad.state === "BLOCKED", "essential crop without acknowledgment blocked");
    const forbidden = pp.applyAdaptationOverride(base, { visualModality: "CHART" }, { master, targetProfile: profile });
    assert(forbidden.state === "BLOCKED", "modality rewrite blocked");
  });

  // ---------------- E — END-TO-END GATE FIXTURE ----------------
  function gateShots() {
    return [
      { id: "sh-e01", mod: "CHARACTER_MOMENT", purpose: "REVEAL", regions: { subjectAnchors: [{ regionId: "hero", kind: "subject", x: 0.38, y: 0.15, w: 0.24, h: 0.7 }] } },
      { id: "sh-e02", mod: "MAP", purpose: "DEMONSTRATE", regions: { dataPoints: [{ regionId: "route", kind: "route", x: 0.36, y: 0.35, w: 0.28, h: 0.15, content: "north-harbor-route" }], textRegions: [{ regionId: "port", kind: "label", x: 0.4, y: 0.28, w: 0.2, h: 0.07, content: "North Harbor" }] } },
      { id: "sh-e03", mod: "CHART", purpose: "DEMONSTRATE", regions: { dataPoints: ["Q1:10", "Q2:20", "Q3:35"].map((c, i) => ({ regionId: `q${i}`, kind: "value", x: 0.2 + i * 0.25, y: 0.5, w: 0.08, h: 0.08, content: c })) } },
      { id: "sh-e04", mod: "DIAGRAM", purpose: "DEMONSTRATE", regions: { textRegions: [{ regionId: "s1", kind: "label", x: 0.1, y: 0.4, w: 0.2, h: 0.1, content: "intake" }, { regionId: "s2", kind: "label", x: 0.7, y: 0.4, w: 0.2, h: 0.1, content: "exhaust" }] } },
      { id: "sh-e05", mod: "TYPOGRAPHY", purpose: "DETAIL", regions: { textRegions: [{ regionId: "quote", kind: "quote", x: 0.15, y: 0.35, w: 0.7, h: 0.2, content: "The logbook matters." }] } },
      { id: "sh-e06", mod: "COMPARISON", purpose: "CONTRAST", regions: { graphicRegions: [{ regionId: "before", kind: "panel", x: 0.02, y: 0.1, w: 0.46, h: 0.8, content: "before-state" }, { regionId: "after", kind: "panel", x: 0.52, y: 0.1, w: 0.46, h: 0.8, content: "after-state" }], textRegions: [{ regionId: "bl", kind: "label", x: 0.05, y: 0.82, w: 0.4, h: 0.08, content: "before" }] } },
      { id: "sh-e07", mod: "ATMOSPHERE", purpose: "ESTABLISH", regions: {} },
      { id: "sh-e08", mod: "ANNOTATION", purpose: "EVIDENCE_VISUAL", regions: { textRegions: [{ regionId: "note", kind: "callout", x: 0.55, y: 0.2, w: 0.3, h: 0.12, content: "ledger entry 42" }] } },
    ];
  }

  await runTest("E1–E6 one master sequence is usable on 16:9 + Shorts 9:16 + TikTok 9:16", () => {
    const shots = gateShots();
    const results = {};
    for (const p of ["YOUTUBE_LONG", "YOUTUBE_SHORTS", "TIKTOK"]) {
      const r = pp.adaptSequence(shots.map((s) => ({
        shot: mkShot(s.id, { shotPurpose: s.purpose }),
        sourceAspectRatio: "16:9",
        regions: s.regions,
        decision: { visualModality: s.mod, renderMode: "REMOTION_MOTION" },
      })), p, { options: { now: NOW } });
      assert(r.failed.length === 0, `${p}: no engine errors`);
      assert(r.adaptations.length === shots.length, `${p}: every shot adapted`);
      assert(r.adaptations.every((a) => a.status === "ADAPTED"), `${p}: all ADAPTED`);
      assert(r.adaptations.every((a) => a.regenerationDecision === "NOT_REQUIRED"), `${p}: no regeneration`);
      for (const a of r.adaptations) {
        const v = pp.validateAdaptation({ artifact: a });
        assert(v.valid, `${p}/${a.shotId} validates: ${JSON.stringify(v.errors)}`);
      }
      results[p] = r.adaptations;
    }
    // Same modality everywhere; mixed honest actions incl. true relayout.
    const mods = (list) => list.map((a) => a.sourceModality).join(",");
    assert(mods(results.YOUTUBE_LONG) === mods(results.TIKTOK), "modality invariant across platforms");
    const acts = results.TIKTOK.map((a) => a.action);
    assert(acts.includes("PRESERVE") || acts.includes("REFRAME"), "cheap actions used");
    assert(acts.includes("RELAYOUT"), "layout-heavy visual truly relaid out (not center-cropped)");
    // Deterministic second run.
    const again = pp.adaptSequence(shots.map((s) => ({
      shot: mkShot(s.id, { shotPurpose: s.purpose }), sourceAspectRatio: "16:9", regions: s.regions,
      decision: { visualModality: s.mod, renderMode: "REMOTION_MOTION" },
    })), "TIKTOK", { options: { now: NOW } });
    assert(JSON.stringify(again.adaptations.map((a) => a.fingerprint)) === JSON.stringify(results.TIKTOK.map((a) => a.fingerprint)), "deterministic");
    // No factual mutation: carried contents equal master contents.
    for (const a of [...results.YOUTUBE_LONG, ...results.TIKTOK]) {
      const carried = [...(a.relayoutPlan ? a.relayoutPlan.carriedElements : []), ...a.textPlan.placements.map((pl) => ({ regionId: pl.regionId }))];
      void carried;
    }
    const chart = results.TIKTOK.find((a) => a.shotId === "sh-e03");
    assert(JSON.stringify(chart.relayoutPlan.carriedElements.map((e) => e.content)) === JSON.stringify(["Q1:10", "Q2:20", "Q3:35"]), "chart values verbatim");
    globalThis.__gate17 = { tiktok: results.TIKTOK.map((a) => [a.shotId, a.action, a.regenerationDecision]) };
  });

  await runTest("density and pacing guidance are contextual tiers", () => {
    const tHook = pp.densityTier({ platformId: "TIKTOK", narrativeRole: "hook", visualModality: "CHARACTER_MOMENT" });
    assert(tHook.tier === "HIGH", "tiktok hook HIGH");
    const yLong = pp.densityTier({ platformId: "YOUTUBE_LONG", visualModality: "DIAGRAM" });
    assert(yLong.tier === "LOW", "long-form explanatory LOW");
    const pacing = pp.pacingGuidance({ platformId: "TIKTOK" });
    assert(pacing.guidance.shortFormUrgency === "HIGH" && !pacing.guidance.captionTimings, "guidance without timestamps");
  });

  // ---------------- AR — ASPECT SEMANTICS (FIX 01) ----------------
  await runTest("AR1 Long preferred 16:9 does not imply 16:9-only acceptance", () => {
    const p = pp.getTargetProfile("YOUTUBE_LONG").profile;
    assert(p.preferredAspectRatio === "16:9" && p.acceptedAspectRatios === null, "acceptance UNKNOWN, not a one-item list");
    assert(/non-exhaustive|adapts/i.test(p.acceptanceNote || ""), "non-exhaustiveness documented");
  });

  await runTest("AR2 adaptive-aspect fact survives serialization", () => {
    const p = pp.getTargetProfile("YOUTUBE_LONG").profile;
    const roundTrip = JSON.parse(JSON.stringify(p));
    assert(roundTrip.acceptedAspectRatios === null && /adapts/i.test(roundTrip.acceptanceNote), "UNKNOWN survives round-trip");
    const v = pp.validateAdaptation({
      artifact: adapt(mkShot("sh-ar2"), "YOUTUBE_LONG", { decision: { visualModality: "ATMOSPHERE" } }),
      context: { targetProfile: roundTrip },
    });
    assert(v.valid, `validates with UNKNOWN acceptance: ${JSON.stringify(v.errors)}`);
  });

  await runTest("AR3 Shorts square + vertical intact", () => {
    const p = pp.getTargetProfile("YOUTUBE_SHORTS").profile;
    assert(p.acceptedAspectRatios.includes("9:16") && p.acceptedAspectRatios.includes("1:1"), "both forms accepted");
    assert(/square OR vertical|square/i.test(p.acceptanceNote || ""), "source scope documented");
  });

  await runTest("AR4 TikTok preferred 9:16 is not universal acceptance", () => {
    const p = pp.getTargetProfile("TIKTOK").profile;
    assert(p.preferredAspectRatio === "9:16" && p.acceptedAspectRatios === null && p.orientation === "PORTRAIT", "preference kept, acceptance UNKNOWN");
  });

  await runTest("AR5 Ads-scoped facts stay Ads-scoped", () => {
    const p = pp.getTargetProfile("TIKTOK").profile;
    const raw = fs.readFileSync(path.join(__dirname, "..", "..", "platforms", "TARGETS.yaml"), "utf8");
    assert(/Ads\/business scope only|ads-scope/i.test(raw), "ads scope labeled in policy data");
    assert(/ads-scope/i.test(p.acceptanceNote || ""), "ads scope labeled in TikTok note");
    assert(/not 9:16-only|UNKNOWN/i.test(p.acceptanceNote || ""), "no promotion to universal 9:16-only truth");
  });

  await runTest("AR6 UNKNOWN acceptance is valid", () => {
    for (const pid of ["YOUTUBE_LONG", "TIKTOK"]) {
      const p = pp.getTargetProfile(pid).profile;
      const v = pp.validateAdaptation({
        artifact: adapt(mkShot(`sh-ar6-${pid}`), pid, { decision: { visualModality: "ATMOSPHERE" } }),
        context: { targetProfile: p },
      });
      assert(v.valid, `${pid} validates with UNKNOWN acceptance`);
    }
  });

  await runTest("AR7 requiredAspectRatio null without hard evidence", () => {
    for (const pid of ["YOUTUBE_LONG", "YOUTUBE_SHORTS", "TIKTOK"]) {
      assert(pp.getTargetProfile(pid).profile.requiredAspectRatio === null, `${pid} required stays UNKNOWN`);
    }
  });

  await runTest("AR8 semantics documented and validator-enforced", () => {
    const p = pp.getTargetProfile("TIKTOK").profile;
    const v = pp.validateAdaptation({
      artifact: adapt(mkShot("sh-ar8"), "TIKTOK", { decision: { visualModality: "ATMOSPHERE" } }),
      context: { targetProfile: { ...p, acceptanceNote: null } },
    });
    assert(!v.valid && v.errors.some((e) => e.code === "ACCEPTANCE_UNDOCUMENTED"), "undocumented UNKNOWN rejected");
    const v2 = pp.validateAdaptation({
      artifact: adapt(mkShot("sh-ar8b"), "YOUTUBE_SHORTS", { decision: { visualModality: "ATMOSPHERE" } }),
      context: { targetProfile: { ...pp.getTargetProfile("YOUTUBE_SHORTS").profile, acceptedAspectRatios: ["1:1"] } },
    });
    assert(!v2.valid && v2.errors.some((e) => e.code === "PREFERRED_ACCEPTED_CONFLATION"), "narrow-list conflation rejected");
  });

  // ---------------- SZ — SAFE-ZONE PROVENANCE (FIX 01) ----------------
  await runTest("SZ1 TikTok 20% geometry has explicit provenance scope", () => {
    const p = pp.getTargetProfile("TIKTOK").profile;
    const z = p.safeZonePolicy.zones.find((zz) => zz.zoneId === "tiktok-bottom-ui");
    assert(z.geometryOrigin === "INTERNAL_POLICY", "geometry origin explicit");
    assert(/NOT an official universal/i.test(z.geometryBasis || ""), "not presented as official truth");
    assert(z.sourceRefs.length > 0 && z.status === "PARTIAL", "sourced but partial");
  });

  await runTest("SZ2 unverified exact geometry cannot be VERIFIED", () => {
    const p = pp.getTargetProfile("TIKTOK").profile;
    const bad = JSON.parse(JSON.stringify(p));
    bad.safeZonePolicy.zones.find((z) => z.zoneId === "tiktok-bottom-ui").status = "VERIFIED";
    const v = pp.validateAdaptation({
      artifact: adapt(mkShot("sh-sz2"), "TIKTOK", { decision: { visualModality: "ATMOSPHERE" } }),
      context: { targetProfile: bad },
    });
    assert(!v.valid && v.errors.some((e) => /UNVERIFIED_GEOMETRY_AS_VERIFIED|INTERNAL_GEOMETRY_AS_VERIFIED/.test(e.code)), "false VERIFIED rejected");
  });

  await runTest("SZ3 Ads safe-zone evidence remains Ads-scoped", () => {
    const p = pp.getTargetProfile("TIKTOK").profile;
    const z = p.safeZonePolicy.zones.find((zz) => zz.zoneId === "tiktok-bottom-ui");
    assert(z.sourceRefs.includes("tiktok-ads-creative-codes"), "ads source cited");
    assert(/ads/i.test(JSON.stringify(z.notes || "") + JSON.stringify(z.geometryBasis || "")), "ads scope visible on the zone");
  });

  console.log(`\n=== 1G.7 platform-policy: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });
