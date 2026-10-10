# Canonical Lineage Audit — pilot-sky-blue-canonical

Date: 2026-10-10. Read-only. No render, no provider calls.

| # | Link | Evidence | Result |
|---|---|---|---|
| 1 | approved script + 8 beats / 6 scenes | `script.json` (B1–B8), `scene-script.json` (S01–S06, MEASURED timing, total 57075 ms) | PASS |
| 2 | scene-media-coverage-matrix | `Report/evidence/phase-6a/canonical-pilot/scene-media-coverage-matrix.md` exists | PASS (existence verified) |
| 3 | original SVG visual sources | `packaging/rights-provenance.json`: VISUAL_S01–S06 `remotion-local`, SkyDiagram, sha256 per asset, rights NOT_APPLICABLE (original, no third-party licence assigned); THUMB_S01/S03/S05 same | PASS |
| 4 | narration + captions | `audio-manifest.json` (local-kokoro am_michael 1.1), `rights-provenance` VOICE_B1–B8; gate JSON: transcript WER 0 on 6/6 scenes, 16/16 caption texts | PASS |
| 5 | render attempt-006 | `render/attempts/attempt-006/output.mp4` 18,954,217 bytes; technical-qa 9 PASS / 0 FAIL / 0 REVIEW / 0 UNKNOWN. Note: `render-attempt.json` still shows `status: PENDING`, `testOnly: true` (stale record; the technical QA and final artifact are consistent) | PASS (with stale-record note) |
| 6 | final-artifact.json | attemptId attempt-006, sha256 7954a86a…, size 18954217 | PASS |
| 7 | exact SHA256 | computed now: `out/pilot-sky-blue-canonical/final.mp4` = `attempt-006/output.mp4` = `7954A86A793CCBE5E153BE30875B832EF813F3E23021E0F571A9DA5E823DFCDF`; equals final-artifact.json, final-publish-package.finalVideoSha256, owner-approval.outputSha256, phase4b-final-qc.finalSha256 | **PASS** |
| 8 | owner-approval.json | statement "DUYỆT attempt-006 7954a86a, cho phép finalize", attemptId, outputSha256, sizeBytes, selectedVariantId pkv-202fd90e1b72, THUMB_S05, audience. Scope: video attempt-006 + packaging selection + finalize. `notCovered`: upload/publish, Gemini results, Phase 6A completion | PASS = OWNER_APPROVED_VIDEO. This is an explicit chat approval, NOT a signed human full-watch (`visual-review.json` reviewer "human", decision APPROVE, issue V3 INFO) |
| 9 | selected package + thumbnail | package selectedVariantId = approval selectedVariantId; THUMB_S05 exists (103,086 bytes) | PASS |
| 10 | Gemini whole/per-scene watch | both artifacts: `"video": "final.mp4"`, `videoSizeBytes: 18954217` (= final.mp4), generated 03:23Z / 03:37Z (after final.mp4 written 02:51–03:02Z). They do **not** record a sha256 | **PARTIAL: size + name + timestamp only, no hash** |
| 11 | final deterministic QC | `phase4b-final-qc.json` finalSha256 = 7954a86a…, verdict PASS | PASS |

## The exact missing link

`CANONICAL_PILOT_LINEAGE = PARTIAL`. The only missing link in the chain is #10: the Gemini artifacts identify the video by file name and byte size, not by SHA256. I will not forge a hash into the model artifacts. The correct fix is a separate reference manifest `Report/evidence/phase-6a/final-reconciliation/watch-reference-manifest.json` that states: "watch artifacts reference final.mp4 with size 18954217; the sha256 of the file with that name and size is 7954a86a…; sha256 was NOT recorded by the watch tool". This is an owner-confirmable inference, not proof, so I leave the verdict at PARTIAL rather than PROVEN. (Not created in this pass because it would still not turn size into a hash proof; recommendation: have `scripts/diagnostics/gemini-video-watch.js` record sha256 in future runs. That is a source change and was out of scope while regression ran.)

Secondary partials (not link breaks):
- Package-side files stale (`packaging-qa.json`, `platform-compliance.json`, checklist text, `render-attempt.json` status).
- `sourceTimelineId null`, `sourceProjectManifestVersion unknown`, `captions/audioMix fingerprint null` in final-artifact/package. Lineage rests on the render fingerprint (99572711696aeb39) and sha256, not on a timeline revision.

## Other checks required by the checklist

| Check | Result |
|---|---|
| FLASH_SAFETY_REVIEW on the canonical video | `phase4b-final-qc.json`: luminance 2 fps (114 frames) and all 1713 frames, bigCount 0, maxDelta 0.185. Deterministic PASS on the NEW final.mp4. Limit: not a photosensitivity certification. No old fixture warning carried over. `FLASH_QA_CANONICAL = PASS` |
| AUDIO_VISUAL_ENERGY_MISMATCH | only a model opinion (one low-granularity Gemini pass: calm narration vs calm motion); no deterministic metric. Technical audio: maxVolume -4.2 dB, mean -21.8 dB, loudness -18.2 LUFS (gate JSON), 0 silence. `AUDIO_VISUAL_QA_CANONICAL = REVIEW_REQUIRED` (not upgraded without human/frame evidence) |
| Caption frame boundary | boundary frames 146/147/148 and test RC9/RC10 per gate JSON (deterministic render evidence). Gemini caption timestamps explicitly unreliable and not used. `CAPTION_FRAME_BOUNDARY_QA = PASS` based on deterministic evidence recorded in the gate JSON; I did not re-extract frames in this pass |
| Formal human full-watch | the Phase 6A gate JSON lists `FULL_AV_WATCH_AUDIO_AND_VISUAL = PROVEN_BY_MODEL_WATCH + OWNER_VIEWED_UNSIGNED`. A signed human checklist for the canonical video does not exist. Whether the gate **requires** a signature is an owner decision. Status: `PENDING_OWNER_CONFIRMATION`. I did not sign for the owner |
| Representative pilot scope | video is 57.152 s. No owner-approved scope exception for the 2–3 minute requirement was found in the reports I searched. `REPRESENTATIVE_PILOT_SCOPE = REVIEW_REQUIRED`. `PILOT_57S_ACCEPTED != PHASE_4_2_TO_3_MIN_REQUIREMENT_PROVEN` |
| Real incremental creative repair | gate JSON + this regression: `incremental/test-pilot-repair-a/b`, `test-pilot-reuse-5c`, `test-incremental-render` all PASS on the current run. `PROVEN ON FIXTURE (495/1800)` |
