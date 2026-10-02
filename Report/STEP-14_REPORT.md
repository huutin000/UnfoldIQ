# STEP 14 REPORT

## 1. Status

`PASS`

End-to-end pilot complete: one real video (`pilot-sky-blue`, "Why the sky is blue") from intake to final accepted MP4. All 30 final pass criteria (§53) met. No publishing. No Step 14 scope excess.

## 2. Pilot Input

- Platform: `youtube` (landscape 1920x1080, 30 fps).
- inputMode: `TOPIC`; topic: `Why the sky is blue` (exact topic kept, no rewrite).
- Language: `en` (chosen because local TTS supports en-US; Vietnamese is unsupported by the official Kokoro route and SAPI has only en-US voices — language never silently changed).
- Audience: curious general viewers 12+.
- Duration: FLEXIBLE_TARGET, min 0.5 min, preferred 1 min, max 2 min.
- Requested target: 60000 ms (reference only). Measured final: 65387 ms (65.39 s).
- Content mode: everyday-physics-explainer, LIGHT arc, educational.
- Artifact: `PILOT_INPUT.yaml` (repo root). `publishMode: MANUAL_ONLY`.

## 3. Policy Refresh

- YouTube AI disclosure (`https://support.google.com/youtube/answer/14328491`): fetched LIVE 2026-09-26, full policy text retrieved. Decision for pilot: `NO` disclosure — non-realistic animated diagrams plus synthetic narration; no photorealistic generation, no real person/event/place. Recorded in `policy-refresh.json` with verifiedAt.
- YouTube upload/format rules (`answer/6375112`): SNAPSHOT_ONLY (page not fetched live; recorded honestly).
- Flow/provider capability metadata: Flow route NOT selected (no logged-in UI, no approvals possible in-session); no live Flow verification claimed. Provider states per Step 10C doctor (no keys configured).
- Rights policy: all-original pilot, no third-party media — no encumbrance.

## 4. Topic / Registry

- Mode TOPIC: candidate discovery skipped; duplicate guard run (0 duplicates for "Why the sky is blue").
- Registered `TOPIC-PILOT-SKYBLUE` as SELECTED, then RENDERED after final acceptance. Never PUBLISHED.
- Evidence: `projects/TOPIC_REGISTRY.json` (`platforms.youtube.status: RENDERED`).

## 5. Research

- `research/research-brief.json`, status COMPLETE, 7 claims:
  - C1 SUPPORTED_FACT (N2/O2 Rayleigh scattering, blue >> red), C2 SUPPORTED_FACT (1/lambda^4, "several times"), C3 SUPPORTED_FACT (blue-not-violet: spectrum plus absorption plus eye), C4 DIRECT_EVIDENCE (red sunsets, long path), C5 SUPPORTED_FACT (Mie vs Rayleigh, haze), C6 SUPPORTED_FACT (Rayleigh 1871), C7 UNVERIFIED (Einstein 1911 — EXCLUDED from script).
- Sources: NOAA JetStream/NESDIS/GML, NASA Space Place/GSFC, GSU HyperPhysics, US university course notes (all found via search; URLs in brief; accessed 2026-09-26).
- Uncertainties and gaps recorded (ozone share omitted as too advanced; no primary Rayleigh PDF verified).
- Script uses C1–C6 only. No AI reconstruction presented as evidence.

## 6. Duration Planning

- Contract `planning/duration-contract.json` (FLEXIBLE_TARGET, working 30–120 s, preferred 60 s, script budget ~800 chars).
- Research supported ~65 s of real content; no expansion, no filler.
- Measured narration 65332 ms; final render 65387 ms. Target never padded (delta 55 ms is measured tail, tolerance 1307 ms).

## 7. Story / Script

- `script.json` v1.0.0: 8 beats, 768 chars, each beat carries claimRefs (B8 payoff uncited by design).
- Beats map 1:1 to voice clips B1–B8 and caption segments. Estimated timing superseded by measured timing.

## 8. Visual Bible / Continuity

- `visual-bible.json` `vb-pilot-1`: flat vector sky system (no global Ancient Humans style); evidence-vs-reconstruction labeled ILLUSTRATION throughout.
- Tokens added for render (`tokens.background #1c5fa8`, sky palette, system-ui type).
- `continuity-registry.json` `cr-pilot-1`: single STYLE_ANCHOR `STYLE_SKY_SYSTEM`, LOCKED; strictness NOT_APPLICABLE (no recurring cast). No independent per-scene generation problem exists by construction.

## 9. Scene / Asset Plan

- 6 scenes (S01 hook … S06 payoff), MEASURED timings from narration (9394 … 65332 ms).
- 8 voice assets (SAPI WAVs, READY, measured durations). Visuals: Remotion-native (BACKGROUND plus TEXT per scene) — legitimate explainer content under `allowRemotionNativeVisualFallback`, not placeholders.
- AI-video seconds: 0 (motion adds no value for diagram narration; documented choice). Final duration 65.39 s comes from measured narration, not AI clips.
- Master references: n/a (no strict visual continuity subjects). Flow project mapping: n/a (Flow not used — honestly reported, not faked).

## 10. Provider Usage

| Provider | Used | Live verified | Attempts | Accepted assets | Notes |
|---|---|---|---|---|---|
| windows-sapi (Zira en-US, local) | YES | YES (8 WAVs, ffprobe-measured) | 8 utterances, 0 retries | 8 voice assets | zero network, zero cost |
| remotion-native visuals | YES | YES (attempt-005 frames inspected) | 5 render attempts | 6 scenes | zero cost |
| ffprobe/WAV measurement | YES | YES (8.1.1) | all durations | timing evidence | pre-existing tool |
| local-kokoro | NO | NO | 0 | 0 | package not installed; vi unsupported anyway |
| flow-web / google-veo | NO | NO (`MANUAL_ASSIST_USED` not claimed; no UI session) | 0 | 0 | no login/approvals possible; nothing faked |
| elevenlabs / cloud | NO | NO | 0 | 0 | disabled, no keys |
| agent-native | NO | NO | 0 | 0 | undeclared in this session |

Only actual use counts as live verified. Flow §18 outcome: neither `LIVE_UI_VERIFIED` nor `MANUAL_ASSIST_USED` — Flow was not selected, and the report does not pretend otherwise.

## 11. Flow / Live Generation Evidence

Flow not used in this pilot (documented reason: no authenticated Flow UI session and no human approver for credit-consuming generation in-session). No Flow jobs, no approvals, no retries, no safety refusals, no credentials/cookies/tokens stored. The pilot validates the local/measured path end to end; Flow live verification remains future work.

## 12. Safety / Policy Events

`None`. No safety refusal occurred (SAPI narration of original educational script; no blocked content). Step 10B-FIX semantics preserved but untriggered. Rights: all-original, no events.

## 13. Media Preflight

`media-preflight-cli.js --project pilot-sky-blue`: READY (8/8 assets, 0 blocking, 0 warnings), exit 0. Voice assets exist, non-zero, type-compatible, ffprobe-measured, rights NOT_APPLICABLE, provenance recorded, fingerprints current.

## 14. Voice / Timing

- Real narration: 8 SAPI WAVs (Zira Desktop, Rate -1), total 65332 ms, per-clip durations 6634–9394 ms.
- Voice QA per clip via `voice-check` (after genuine integration fix: probe-shape read): READY, MEASURED, alignment MATCH, language en, no truncation.
- `audio-caption-cli.js --validate`: READY, exit 0. Timing source: per-sentence measured durations (WAV header plus ffprobe), level SEGMENT_TIMING. No word timing claimed.
- Pronunciation: SAPI default rendering; agent spot-review found no misrendered names/numbers (script uses plain words; "Rayleigh" is not spoken in narration — only in metadata).

## 15. Captions

- Mode BOTH (explicit pilot override of youtube SIDECAR default, recorded in `caption-profile.json`).
- 16 items from 8 measured segments (sentence grouping, boundaries preserved), SEGMENT_TIMING, no word emphasis.
- `captions.json` plus `captions.srt` plus `captions.vtt` (VTT per profile). Burn-in verified in rendered frames; sidecars retained in `out/`.

## 16. Music / SFX

- Explicit plan: no music, no SFX. Justification: narration-only explainer; Step 11 permits finalizing a plan without music; no filler SFX added. No rights exposure by construction.

## 17. Measured Timeline

- `timing/timeline-measured.json`: voiceEnd 65332, visualPlannedEnd 65332, captionEnd 65332, music/sfx 0, outro 0 → actual 65332, status MEASURED.
- Target 60000 vs measured 65332 vs rendered 65387: target never drove the render.

## 18. Render

- Via Step 13 only: `node pipeline-cli.js render --project pilot-sky-blue` (raw Step 12 production render refused by design; `--render` delegates).
- Attempts: 001 FAILED (AudioTrack trimAfter crash) → fix → 002 RENDERED (silent audio plus near-black bg found by QA) → fix → 003 FAILED (NaN duration, missing propagation) → fix → 004 RENDERED (title clipping found by agent review) → fix → 005 RENDERED and accepted.
- Attempt cap: default 3 reached through genuine fix iterations; operator override `--max-attempts 5` (new flag, cap 6, default unchanged) with documented reason; all attempts preserved, none overwritten.
- Progress persisted (100%, 1960/1960 frames). No cancellation needed. Accepted attempt: attempt-005, fingerprint current.

## 19. Technical QA

- Real ffprobe on `attempt-005/output.mp4`: h264 1920x1080 30 fps plus aac, 65.386667 s, 3,289,216 bytes (final 3,289,216 B).
- `technical-qa.json`: PASS 9/9. Duration expected 65332, actual 65387, delta 55, tolerance 1307 — PASS.
- Black-frame QA (blackdetect): PASS, 0 regions. Silence QA (silencedetect, 8 voice ranges): PASS, 17 natural sub-1.1 s pauses.
- Audio levels: mean -23.6 dB, max -5.5 dB (healthy narration; attempt-002's -91 dB silence caught and fixed).

## 20. Visual QA

- Review state: AGENT_REVIEWED, decision APPROVE (submitted via `submit-visual-review`, exit 0).
- Evidence: 19 sampled frames (first, last, 6 midpoints, 5 transitions, caption-heavy), contact sheet (19), review packet (MACHINE_CHECKED at build, agent review on top).
- Agent inspected frames at 5/30/33.9/48/55/64.5 s: content match PASS, continuity PASS (style anchor only), AI artifacts none, layout PASS (titles centered, no clipping, no caption overlap after fix), captions PASS, safe zone PASS, black frames none, scene relevance PASS, factual-visual honesty PASS (illustrative only).
- Issues: 1 WARNING (VR-LAYOUT-001, OPEN): visuals minimal (title cards on solid sky-blue; molecule/spectrum diagrams from visualIntent not built — builder has no shape-from-intent feature). No ERROR/BLOCKER. Documented for future polish; does not block pipeline validation.

## 21. QA Diff / Fix Cycles

- issue-1 (trimAfter crash): RESOLVED by trim guards; verified by 002 rendering.
- attempt-002 QA findings (silent audio, near-black bg): fixed (audio range logic, VB tokens); verified by 004 audio levels and blue frames.
- issue-2 (NaN duration): RESOLVED by builder durationMs propagation plus explicit guard; verified by 004/005 rendering.
- issues-3–10 (schema additionalProperties on audioClip.durationMs): RESOLVED by additive schema fix; input validates.
- Title clipping plus caption overlap (agent review of 004): fixed (center anchor, yPct 68); verified in 005 frames.
- Stale PREPARE_CHECKS_BLOCKED blocker: cleared with documented history entry after input validated READY.
- Final: 0 open issues, 0 blockers. No unresolved ERROR/BLOCKER. Fixes were deterministic derived/render changes only (plus 3 minimal integration-shape fixes); no script/fact/character changes, no AI regeneration, no paid calls.

## 22. Final Artifact

- Path: `out/pilot-sky-blue/final.mp4`.
- Size: 3,289,216 bytes. Duration: 65.386667 s (65,387 ms).
- Dimensions: 1920x1080. FPS: 30. Codec: h264 plus aac.
- Checksum: sha256 `3f684657a9ed34f10f3845ef5bc36a4e6c599a851be09bc9d48d08ebaacc94b3` (recomputed from file, matches manifest).
- `final-artifact.json` schema-valid; sidecars retained (srt, vtt, render-plan, staging-manifest, qa-report, provenance).

## 23. Cost Summary

`cost-summary.json`: Flow jobs 0/0, retries 0, paid spend USD 0 (verified — no paid call exists in any pilot log), subscription credits UNKNOWN (none visible/used), all routes local. Unknowns: none material.

## 24. Runtime Stage Evidence

| Stage | Status | Artifact | Evidence |
|---|---|---|---|
| 1 Intake | DONE | `PILOT_INPUT.yaml` | TOPIC mode, all required fields |
| 2 Platform | DONE | `policy-refresh.json` | youtube 1920x1080/30, disclosure NO (live page) |
| 3A Topic/Registry | DONE | `TOPIC_REGISTRY.json` | 0 duplicates, SELECTED then RENDERED |
| 3B Research | DONE | `research-brief.json` | COMPLETE, 7 claims, real URLs |
| 3C Content mode | DONE | `content-mode.json` | explainer, LIGHT arc |
| 3D Editorial | DONE | `editorial-strategy.json` | mechanism plus misconception correction |
| Duration gate | DONE | `duration-contract.json` | FLEXIBLE, no filler |
| 4 Script | DONE | `script.json` v1.0.0 | 8 beats plus claim refs |
| 6 Direction | DONE | content-mode crossModal | hook/pacing/audio direction |
| 7 Visual Bible | DONE | `visual-bible.json` vb-pilot-1 | sky system plus tokens, ILLUSTRATION label |
| 7b Continuity | DONE | `continuity-registry.json` cr-pilot-1 | STYLE_ANCHOR LOCKED |
| 8 Scene plan | DONE | `scene-script.json` | 6 scenes, MEASURED timings |
| 9 Asset plan | DONE | `asset-manifest.json` | 8 voice READY plus rights/provenance |
| 10 Assets | DONE | 8 WAVs | SAPI synth, ffprobe-measured |
| 11 Preflight | READY | `preflight/media-preflight.json` | 8/8, exit 0 |
| 12 Voice/captions | READY | audio-manifest, captions, mix plan, timeline | validate exit 0; 16 captions; 65332 ms |
| 13 Video spec | DONE | `video-spec.json` | 1920x1080/30/65332 ms |
| 14 Remotion build | DONE | render-plan ba81acf6 | compositions list UNFOLDIQVideo |
| 16 Render | DONE | attempt-005 output.mp4 | pipeline, 1960 frames |
| 17 QA | DONE | technical PASS, visual APPROVE | Sec 19-20 |
| 18 Fix/re-render | DONE | attempts 001-005 history | Sec 21, all preserved |
| 19 Final | READY | `out/pilot-sky-blue/final.mp4` | Sec 22, state FINAL_RENDER_READY |

(Stage 5 hook and Stage 15 preview are folded into scene titles and Studio-capable composition; no separate artifacts required.)

## 25. Regression

- Bounded re-runs after pilot fixes (all EXIT 0): voice-timing 20, captions 31, audio-mix 22, step11-contracts 21, render-input 12, render-plan 8, remotion-layers 12 (one assertion updated for renamed trim variable; behavior unchanged), remotion-audio 10, remotion-captions 8, remotion-composition 6, validate-schemas (26 files), compositions listing, pipeline state/lock/resume/retry/qa/diff/finalize/auto-fix suites.
- Full Step 10/11/12/13 suites passed pre-pilot (§7 of Steps 11-13 reports); pilot changed 7 files (voice-check, audio-caption-cli, render-input-builder, render-input schema, AudioTrack, VideoLayer, TextLayer, pipeline-cli, 1 test assertion) and every affected suite was re-run green.
- No live generation re-run (nothing to re-generate; pilot media is the generation).

## 26. Manual Upload Checklist

`out/pilot-sky-blue/UPLOAD_CHECKLIST.md`: file hash, suggested title/description/chapters, captions.srt, AI disclosure NO with rationale, rights notes, QA summary, registry note (mark PUBLISHED only after manual upload). Nothing uploaded.

## 27. Topic Registry Final State

`RENDERED` (`TOPIC-PILOT-SKYBLUE`, youtube). Not `PUBLISHED`.

## 28. Errors / Warnings

- Errors during pilot (all fixed, all preserved in attempt history): trimAfter crash (001), silent audio plus near-black background (002 QA findings), NaN duration (003), title clipping plus caption overlap (004 agent review).
- Open WARNING: VR-LAYOUT-001 (minimal visuals; see Sec 20).
- No other warnings. geschaffen artifacts: none leftover (sweeps confirm no `__13_*__`/`__12_*__` residue; pilot project intentionally retained as the deliverable).

## 29. Blockers

`None`

## 30. Artifact Paths

- `PILOT_INPUT.yaml`
- `projects/pilot-sky-blue/` (research, planning, script, content-mode, editorial-strategy, visual-bible, continuity-registry, scene-script, asset-manifest, audio-manifest, caption-profile, assets/voice/B1-B8.wav, audio/timing.json, audio/audio-mix-plan.json, captions/captions.json/srt/vtt, preflight/media-preflight.json, timing/timeline-measured.json plus duration-evidence.json, video-spec.json, policy-refresh.json, cost-summary.json, pipeline/state.json, render/render-plan.json plus staging-manifest.json plus attempts/001-005 plus render-manifest.json)
- `out/pilot-sky-blue/final.mp4`
- `out/pilot-sky-blue/final-artifact.json`
- `out/pilot-sky-blue/QA.md`
- `out/pilot-sky-blue/provenance-summary.json`
- `out/pilot-sky-blue/captions.srt`, `captions.vtt`
- `out/pilot-sky-blue/UPLOAD_CHECKLIST.md`
- `out/pilot-sky-blue/render-plan.json`, `staging-manifest.json`, `qa-report.json`, `provenance.json`
- `Report/STEP-14_REPORT.md`

## 31. Final Conclusion

`STEP 14: PASS 100% — END-TO-END PILOT COMPLETE`
