"use strict";

/**
 * Phase 6A — real-artifact check (Case U on the published pilot): FULL_WATCH consumes the
 * ACTUAL final.mp4 of projects/pilot-sky-blue (byte-hash bound to the accepted
 * final-artifact.json) and the structured project state (scene-script, render-plan, captions).
 * The packaging promise is derived from the pilot's own title card — documented as a derived
 * input, not a published title package (the pilot predates Phase 4A).
 */

const fs = require("fs");
const path = require("path");
const fx = require("../fixtures/creative-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/pilot");
const cr = fx.cr;

const ROOT = fx.REPO;
const VIDEO = path.join(ROOT, "out", "final", "pilot-sky-blue", "final.mp4");
const ARTIFACT = path.join(ROOT, "projects", "pilot-sky-blue", "render", "final-artifact.json");
const PACKAGING = { titleText: "Why Is the Sky Blue?", thumbnailText: "WHY IS THE SKY BLUE?", expectedViewerPromise: ["why the sky is blue"], openingMustEstablish: ["sky blue", "why"], mustNotImply: ["ocean reflection"] };

if (!fs.existsSync(VIDEO) || !fs.existsSync(ARTIFACT)) {
  console.log("[SKIP] pilot-sky-blue final.mp4 / final-artifact.json not present on this machine — real-video watch NOT RUN (not counted as PASS)");
  process.exit(0);
}

runTest("Pilot FULL_WATCH: real final.mp4 consumed, hash bound to the accepted artifact, duration matches timeline", () => {
  const inp = cr.adapter.fromLegacyProject(ROOT, "pilot-sky-blue", { videoPath: VIDEO, packaging: PACKAGING });
  assert(inp.ok, "legacy adapter builds a CreativeInput from scene-script + render-plan + captions");
  const a = cr.analyzeCreativeRetention(inp.input);
  const w = cr.runWatch(a, { mode: "FULL_WATCH", probeVideo: cr.adapter.probeVideoDurationMs });
  const r = w.watchReport;
  const accepted = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  assertEq(r.video.sha256, accepted.sha256, "watched bytes == accepted final artifact (sha256)");
  assert(r.video.consumed && r.video.durationMatchesTimeline === true, `probed ${r.video.probedDurationMs}ms vs timeline ${r.video.timelineDurationMs}ms`);
  assertEq(r.verdict, "PASS", "FULL_WATCH verdict");
  assert(r.coverage.share >= 0.98, "coverage ≥ 98%");
  const v = a.hookReport.checkpoints.map((c) => c.verdict);
  assert(v[0] === "PASS" && v[1] === "PASS" && v[2] !== "FAIL", `hook 5s/15s PASS, 30s not FAIL (${v})`);
  const open = cr.contract.countBySeverity(w.findings);
  assert(open.P0 === 0 && open.P1 === 0, `no P0/P1 (counts ${JSON.stringify(open)})`);
  assertEq(w.riskReport.actualRetention, null, "no retention claim");
});

runTest("Pilot findings are honest and consistent with Phase 4B visual QA (minimal title-card visuals, VR-LAYOUT-001)", () => {
  const inp = cr.adapter.fromLegacyProject(ROOT, "pilot-sky-blue", { videoPath: VIDEO, packaging: PACKAGING });
  const a = cr.analyzeCreativeRetention(inp.input);
  const codes = a.findings.map((f) => f.code);
  assert(codes.includes("MODALITY_MONOTONY"), "all-title-card visuals surface as MODALITY_MONOTONY (matches the known minimal-visuals WARNING): " + codes);
  assert(a.findings.filter((f) => f.status === "OPEN").every((f) => f.severity === "P3"), "only P3 polish findings on the accepted pilot");
  assertEq(a.beatReport.metrics.noProgressBeats, 0, "every pilot beat makes progress");
  assertEq(a.beatReport.openLoops.map((l) => l.status), ["RESOLVED"], "hook question (\"where does the blue come from?\") is paid off");
  assert(a.rhythmReport.metrics.staticShare === 1, "pilot has no motion plan: 100% static title cards (measured, not assumed)");
});

done();
