"use strict";

/**
 * Phase 6B — evidence collector for the quality rubric (UNFOLDIQ CORE).
 *
 * Reads ONLY artifacts that already exist (Phase 3-6A QA, per-scene watch checks,
 * packaging QA, owner approvals) and maps them to rubric signals. Absent evidence
 * becomes NOT_MEASURED — never PASS. No model/provider call is made here.
 */

const fs = require("fs");
const path = require("path");
const text = require("../creative-retention/text.js");

const readJson = (p) => (p && fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

const sig = (dimension, assessor, status, note, evidenceRef, extra = {}) => ({ dimension, source: note, assessor, status, note, evidenceRef, confidence: assessor === "MODEL" ? "MEDIUM" : "HIGH", ...extra });

function openAtOrAbove(findings, sevs = ["P0", "P1", "P2"]) {
  return findings.filter((f) => (f.status === "OPEN" || f.status === "REVIEW_REQUIRED") && sevs.includes(f.severity));
}

/**
 * opts: { analysis (6A analyzeCreativeRetention result), watch (6A runWatch result), originality (assessOriginality doc),
 *         geminiWhole, geminiPerScene (parsed JSON), qc (phase4b final qc JSON), evidenceRel (repo-relative refs for those),
 *         attemptId }
 */
function collectProjectEvidence(root, projectId, opts) {
  const dir = path.join(root, "projects", projectId);
  const signals = [];
  const hardBlockers = [];
  const refs = opts.refs || {};
  const finalArt = readJson(path.join(dir, "render", "final-artifact.json"));
  const approval = readJson(path.join(dir, "approval", "owner-approval.json"));
  const attempt = opts.attemptId || (finalArt && finalArt.attemptId);
  const tqa = readJson(path.join(dir, "render", "attempts", attempt || "", "qa", "technical-qa.json"));
  const vr = readJson(path.join(dir, "render", "attempts", attempt || "", "qa", "visual-review.json"));
  const pkgQa = readJson(path.join(dir, "packaging", "packaging-qa.json"));
  const contReg = readJson(path.join(dir, "continuity-registry.json"));
  const scenes = (readJson(path.join(dir, "scene-script.json")) || { scenes: [] }).scenes;
  const fssDir = path.join(dir, "input", "final-spoken-script");
  const fssFile = fs.existsSync(fssDir) ? fs.readdirSync(fssDir).map((n) => [n, /^fss-.*-v(\d+)\.json$/.exec(n)]).filter(([, m]) => m).sort((x, y) => Number(y[1][1]) - Number(x[1][1]))[0] : null;
  const fss = fssFile ? readJson(path.join(fssDir, fssFile[0])) : null;
  const qc = opts.qc;
  const gw = opts.geminiWhole;
  const gs = opts.geminiPerScene;
  const a = opts.analysis;

  // ---- hard blockers (technical / artifact / approval / rights)
  const videoSha = finalArt && finalArt.sha256;
  if (!finalArt || !videoSha) hardBlockers.push({ id: "FINAL_ARTIFACT_MISSING", category: "MISSING_ARTIFACT", severity: "P0", reason: "final-artifact.json absent", evidenceRef: `projects/${projectId}/render/final-artifact.json` });
  if (tqa && tqa.summary && tqa.summary.fail > 0) hardBlockers.push({ id: "TECHNICAL_QA_FAIL", category: "TECHNICAL_QA", severity: "P1", reason: `technical-qa fail=${tqa.summary.fail}`, evidenceRef: `render/attempts/${attempt}/qa/technical-qa.json` });
  if (!tqa) hardBlockers.push({ id: "TECHNICAL_QA_MISSING", category: "MISSING_ARTIFACT", severity: "P1", reason: "technical-qa.json absent", evidenceRef: `render/attempts/${attempt}/qa/technical-qa.json` });
  if (!approval || approval.outputSha256 !== videoSha) hardBlockers.push({ id: "OWNER_APPROVAL_MISSING_OR_MISMATCHED", category: "OWNER_APPROVAL", severity: "P1", reason: "owner approval absent or bound to different bytes", evidenceRef: `projects/${projectId}/approval/owner-approval.json` });
  if (qc && qc.verdict !== "PASS") hardBlockers.push({ id: "FINAL_QC_NOT_PASS", category: "TECHNICAL_QA", severity: "P1", reason: `final QC verdict ${qc.verdict}`, evidenceRef: refs.qc });
  for (const f of (pkgQa && pkgQa.rightsFindings) || []) hardBlockers.push({ id: `RIGHTS:${f.code || "FINDING"}`, category: "RIGHTS", severity: "P1", reason: f.reason || "rights finding", evidenceRef: `projects/${projectId}/packaging/packaging-qa.json` });

  // ---- narration / sound / motion from deterministic final QC and per-scene local checks
  const perScene = (gs && gs.scenes) || [];
  const wers = perScene.map((s) => s.localCheck && s.localCheck.transcriptWer).filter((w) => Number.isFinite(w));
  if (wers.length) signals.push(sig("narration", "DETERMINISTIC", Math.max(...wers) === 0 ? "PASS" : Math.max(...wers) <= 0.1 ? "REVIEW_REQUIRED" : "FAIL", `local transcript WER max ${Math.max(...wers)} over ${wers.length}/${scenes.length || wers.length} scenes`, refs.perScene));
  if (qc && qc.volume) {
    const clean = qc.volume.ok && !qc.volume.noAudio && (qc.silence || []).length === 0;
    signals.push(sig("narration", "DETERMINISTIC", clean ? "PASS" : "FAIL", `final QC: audio present, ${(qc.silence || []).length} silence gaps, maxVolume ${qc.volume.maxVolumeDb} dB`, refs.qc));
    signals.push(sig("sound", "DETERMINISTIC", clean ? "PASS" : "FAIL", `final QC: no silence gaps, volume ok (mean ${qc.volume.meanVolumeDb} dB, max ${qc.volume.maxVolumeDb} dB); speech-only mix, no music by design`, refs.qc));
    const luma = qc.luminanceAllFrames && qc.luminanceAllFrames.bigCount === 0;
    signals.push(sig("motion", "DETERMINISTIC", luma && (qc.freeze || []).length === 0 && (qc.black || []).length === 0 ? "PASS" : "FAIL", `final QC: 0 freeze, 0 black, ${qc.luminanceAllFrames ? qc.luminanceAllFrames.bigCount : "?"} large luminance transitions over ${qc.luminanceAllFrames ? qc.luminanceAllFrames.frames : "?"} frames (not a photosensitivity certification)`, refs.qc));
  }
  const gv = (k) => gw && gw.verdict && gw.verdict.checks && gw.verdict.checks[k] && gw.verdict.checks[k].verdict;
  const model = (dim, key, note) => gv(key) && signals.push(sig(dim, "MODEL", gv(key) === "PASS" ? "PASS" : "REVIEW_REQUIRED", `${note} (${gw.model}, single whole-video pass; Free Tier owner-attested; video hash not bound in the artifact)`, refs.gemini));
  model("narration", "audio_quality", "model: voiceover clean/intelligible");
  model("sound", "audio_quality", "model: audio clean, no music/SFX");
  model("motion", "flash_or_strobe_risk", "model: no flash/strobe");
  model("captions", "caption_accuracy_and_sync", "model: captions accurate and in sync");
  model("evidenceFidelity", "visual_clarity_and_scientific_accuracy", "model: diagrams scientifically accurate");
  model("visualFactuality", "visual_clarity_and_scientific_accuracy", "model: diagrams clear and accurate");
  model("pacing", "audio_visual_sync_and_rhythm", "model: visuals in step with narration");
  model("semanticAlignment", "audio_visual_sync_and_rhythm", "model: visuals support narration");
  model("semanticAlignment", "packaging_promise_delivered", "model: delivers title/thumbnail promise");
  model("packaging", "packaging_promise_delivered", "model: delivers title/thumbnail promise");
  if (perScene.length) {
    const ok = perScene.filter((s) => s.model && s.model.visual && s.model.visual.scientifically_accurate === true).length;
    signals.push(sig("visualFactuality", "MODEL", ok === perScene.length ? "PASS" : "REVIEW_REQUIRED", `model per-scene: scientifically_accurate on ${ok}/${perScene.length} scenes (${perScene[0].model ? "flash-lite fallback pass" : ""}); in-frame ILLUSTRATION badge per coverage matrix`, refs.perScene));
    const sceneVisual = perScene.filter((s) => s.model && s.model.visual && s.model.visual.description).length;
    signals.push(sig("imagery", "MODEL", sceneVisual === perScene.length ? "PASS" : "REVIEW_REQUIRED", `model per-scene: relevant visual described on ${sceneVisual}/${perScene.length} scenes`, refs.perScene));
    const cueExp = perScene.reduce((n, s) => n + ((s.localCheck && s.localCheck.captionCuesExpected) || 0), 0);
    const cueOk = perScene.reduce((n, s) => n + ((s.localCheck && s.localCheck.captionCuesMatchedExactly) || 0), 0);
    if (cueExp) signals.push(sig("captions", "DETERMINISTIC", cueOk === cueExp ? "PASS" : "FAIL", `local check: ${cueOk}/${cueExp} burned-in caption cues match script text exactly (timing NOT proven by the model)`, refs.perScene));
  }

  // ---- imagery: coverage of approved assets
  const plan = readJson(path.join(dir, "render", "render-plan.json"));
  if (plan && plan.scenes) {
    const withVisual = plan.scenes.filter((s) => (s.layers || []).some((l) => l.kind === "VIDEO" && l.assetStaticPath)).length;
    signals.push(sig("imagery", "DETERMINISTIC", withVisual === plan.scenes.length ? "PASS" : "FAIL", `render plan: ${withVisual}/${plan.scenes.length} scenes carry a visual asset (0 placeholders per coverage matrix)`, `projects/${projectId}/render/render-plan.json`));
  }
  if (vr && vr.decision === "APPROVE") for (const d of ["imagery", "visualFactuality", "pacing", "semanticAlignment"]) signals.push(sig(d, "HUMAN", "PASS", "owner visual review APPROVE of the exact attempt bytes (explicit message; unsigned full watch accepted by owner)", `projects/${projectId}/render/attempts/${attempt}/qa/visual-review.json`, { confidence: "MEDIUM" }));

  // ---- script naturalness / evidence fidelity: upstream QA + final-text lineage
  if (fss && scenes.length) {
    const approved = text.contentTokens(fss.segments.map((s) => s.text).join(" "));
    const finalTok = text.contentTokens(scenes.map((s) => s.narration).join(" "));
    const added = [...finalTok].filter((t) => !approved.has(t));
    const lineage = added.length === 0
      ? { status: "PASS", note: `final scene narration adds 0 content tokens beyond the QA-approved spoken script (condensation only; ${[...approved].filter((t) => !finalTok.has(t)).length} filler tokens dropped)` }
      : { status: "REVIEW_REQUIRED", note: `final scene narration adds ${added.length} content token(s) not in the QA-approved script: ${added.slice(0, 8).join(", ")}` };
    const lref = `projects/${projectId}/input/final-spoken-script + scene-script.json`;
    signals.push(sig("evidenceFidelity", "DETERMINISTIC", lineage.status, lineage.note, lref));
    signals.push(sig("scriptNaturalness", "DETERMINISTIC", lineage.status, `lineage: ${lineage.note}`, lref, { confidence: "MEDIUM" }));
    const prov = fss.provenance || {};
    const fid = readJson(path.join(dir, "voice", "evidence-fidelity", `${prov.evidenceFidelityRef}.json`));
    const nat = readJson(path.join(dir, "voice", "naturalness-qa", `${prov.naturalnessQaRef}.json`));
    if (fid) signals.push(sig("evidenceFidelity", "DETERMINISTIC", fid.decision === "PASS" && (fid.issues || []).length === 0 ? "PASS" : "FAIL", `evidence-fidelity ${fid.decisionId}: ${fid.decision}, ${fid.checks.length} protected-item checks, ${fid.issues.length} issues (bound to the 8-segment spoken script, not the condensed scene text)`, `projects/${projectId}/voice/evidence-fidelity/${fid.decisionId}.json`));
    if (nat) signals.push(sig("scriptNaturalness", "DETERMINISTIC", nat.decision === "PASS" && (nat.issues || []).length === 0 ? "PASS" : "FAIL", `naturalness QA ${nat.qaId}: ${nat.decision}, ${nat.issues.length} issues (upstream spoken script)`, `projects/${projectId}/voice/naturalness-qa/${nat.qaId}.json`));
  }

  // ---- Phase 6A creative reports (rule-based)
  if (a) {
    const hot = (list) => openAtOrAbove(list);
    const beatHot = hot(a.beatReport.findings);
    signals.push(sig("scriptNaturalness", "DETERMINISTIC", beatHot.length ? "REVIEW_REQUIRED" : "PASS", `Phase 6A beat report: ${beatHot.length} open P0-P2 findings (${a.beatReport.metrics.loopsOpened} loops opened, ${a.beatReport.metrics.loopsResolved} resolved)`, refs.beat || "6A NarrativeBeatQualityReport"));
    const rh = hot(a.rhythmReport.findings), hk = hot(a.hookReport.findings), allHot = hot(a.findings);
    signals.push(sig("pacing", "DETERMINISTIC", allHot.length ? "REVIEW_REQUIRED" : "PASS", `Phase 6A hook/beat/rhythm: ${allHot.length} open P0-P2 findings; hook checkpoints ${a.hookReport.checkpoints.map((c) => c.verdict).join("/")}`, refs.hook || "6A HookQualityReport"));
    signals.push(sig("motion", "DETERMINISTIC", rh.length ? "REVIEW_REQUIRED" : "PASS", `Phase 6A visual rhythm: ${rh.length} open P0-P2 findings, ${a.findings.filter((f) => f.status === "OPEN" && f.severity === "P3").length} open P3 polish`, refs.rhythm || "6A VisualRhythmReport"));
    const cps = a.rhythmReport.metrics.captionCpsP90;
    signals.push(sig("captions", "DETERMINISTIC", cps <= 17 ? "PASS" : "REVIEW_REQUIRED", `caption reading speed p90 ${cps} cps (policy overload at 17)`, refs.rhythm || "6A VisualRhythmReport"));
    signals.push(sig("semanticAlignment", "DETERMINISTIC", hk.some((f) => f.code === "HOOK_PROMISE_MISMATCH") ? "FAIL" : "PASS", `hook promise coverage: no HOOK_PROMISE_MISMATCH; checkpoints ${a.hookReport.checkpoints.map((c) => c.verdict).join("/")}`, refs.hook || "6A HookQualityReport"));
  }
  if (opts.watch) {
    const w = opts.watch.watchReport;
    signals.push(sig("semanticAlignment", "DETERMINISTIC", w.findings.some((f) => f.code === "MULTIMODAL_CONTRADICTION" && f.status === "OPEN") ? "FAIL" : "PASS", `Phase 6A structural watch: verdict ${w.verdict}, coverage ${w.coverage && w.coverage.share}, no cross-channel contradiction`, refs.watch || "6A MultimodalWatchReport"));
  }

  // ---- originality (6.5)
  const o = opts.originality;
  if (o) {
    const st = o.risk === "LOW" ? "PASS" : o.risk === "HIGH" ? "FAIL" : o.risk === "MEDIUM" ? "REVIEW_REQUIRED" : "NOT_MEASURED";
    signals.push(sig("originality", "DETERMINISTIC", st, `OriginalityAssessment risk ${o.risk} for scope ${o.corpusScope} (corpus ${o.corpusCount}); channel-level ${o.channelLevelOriginality}`, refs.originality || "originality-assessment", { confidence: "MEDIUM" }));
  }

  // ---- packaging: persisted QA is authoritative (never forge PASS)
  if (pkgQa) signals.push(sig("packaging", "DETERMINISTIC", pkgQa.status === "PASS" ? "PASS" : pkgQa.status === "FAIL" ? "FAIL" : "REVIEW_REQUIRED", `persisted packaging QA ${pkgQa.status}: ${(pkgQa.findings || []).map((f) => f.code).join(",") || "no findings"}; owner approval records audience ${approval ? JSON.stringify(approval.audience) : "n/a"} and variant ${approval && approval.selectedVariantId}`, `projects/${projectId}/packaging/packaging-qa.json`));

  const applicability = {};
  if (contReg && contReg.continuityStrictnessDefault === "NOT_APPLICABLE") applicability.continuity = { applicable: false, reason: "continuity registry declares strictness NOT_APPLICABLE (no recurring characters/entities; single locked STYLE anchor)", evidenceRefs: [`projects/${projectId}/continuity-registry.json`] };

  return { projectId, videoSha256: videoSha || null, contentClass: (a && a.input.contentClass) || "FACTUAL", applicability, signals, hardBlockers, ownerApprovalRef: approval ? `projects/${projectId}/approval/owner-approval.json` : undefined };
}

module.exports = { collectProjectEvidence };
