# PHASE 6A — FINAL CLOSURE REPORT (2026-10-09)

Supplements `PHASE_6A_CREATIVE_RETENTION_FOUNDATION_REPORT.md`. External cost: 0 VND (no API call, no upload).

## Steps, evidence, timing

| # | Step | Result | Evidence / time |
|---|------|--------|-----------------|
| 1 | Keep Real Incremental Creative Repair evidence (495/1800 frames) | KEPT, fixture not re-rendered | `phase-6a-creative-repair-execution.json` untouched |
| 2 | 15 failing regression suites | ROOT-CAUSED, 15/15 PASS when run targeted, no code change needed | below |
| 3 | Canonical pilot has real media + packaging | **BLOCKED_BY_INPUT** | below |
| 4 | One real Full Multimodal Watch (Gemini Free) | **BLOCKED** (depends on 3); no call made | — |
| 5 | Partial QA REVIEW_REQUIRED findings | CLASSIFIED | below |
| 6 | Full regression + hygiene, once | PASS | below |

### 2. The 15 failures
Cause: the earlier full run executed in worktree `.claude/worktrees/unfoldiq-phase-6a-closure-de7296`, which lacked `research/.venv-deep` and `out/incremental-5b/`; the runner also kills a suite after 10 min. Not a code defect.
Targeted runs in the main checkout (`node scripts/run-tests.js research research-deep workspace`, 120 s): 24 research/research-deep suites PASS, `workspace` PASS 53/0 (covers 4 + 6 + 1 failing suites).
Direct runs: `tests/incremental/test-pilot-repair-a.js` 3/0 (23 s), `...repair-b.js` 4/0 (194 s), `...reuse-5c.js` 6/0 (117 s), `tests/perf/test-longform-5c.js` 2/0 (~0 s; passed in <1 s, not investigated further).
`npm run render:doctor` = READY before the render suites; no SAC/registry changes made.

### 3. Canonical pilot — BLOCKED_BY_INPUT
- `out/final/pilot-4b.mp4`: real Kokoro narration, but visuals are ffmpeg test patterns; packaging (pkv-1) exists only as literal test data, no persisted FinalPublishPackage.
- `out/final/pilot-sky-blue/final.mp4`: real SAPI narration, visuals are solid-colour title cards, packaging promise derived from the title card, no Phase 4 approval.
- Needed from owner: a video with real visual content (diagrams/stills/motion) plus its persisted Phase 4A packaging (selected title/thumbnail promise) and Phase 4 approval/FinalPublishPackage record. Alternatively, an explicit owner decision to accept pilot-4b/pilot-sky-blue as canonical despite this.

### 4. Gemini watch
Not run. A watch on either candidate would only review test patterns or solid cards and would not prove audio+visual quality. No Gemini adapter/project/model check was performed (nothing called).

### 5. Partial QA findings
- `FLASH_SAFETY_REVIEW` (REVIEW): 2 large luminance transitions inside the conservative limit → ACCEPTED_NON_BLOCKING. Re-check on the canonical pilot.
- `AUDIO_VISUAL_ENERGY_MISMATCH` (P2): pre-existing fixture artifact (synthetic two-tone audio vs test-pattern visuals), not caused by the repair (0 frames changed outside sc3/sc6, audio md5 identical) → FIXTURE_ARTIFACT, carried to the canonical pilot watch.
- Both remain open for the canonical pilot; no code changed.

### 6. Final regression and hygiene
- `node scripts/run-tests.js` (full, once): exit 0, `0 failed suite(s) in 1051.7s` (~17.5 min, under the 20 min limit). Log: `Report/evidence/phase-6a/full-regression-final-6a-close.log`.
- `npm run check:workspace`: ok, 20 projects. `npm run check:repo-structure`: REPOSITORY_STRUCTURE_OK.
- Side effect: the regression rewrites tracked baseline/telemetry files. I reverted `Report/evidence/**` and `projects/HARDENING_1G12/**` with `git checkout`; reverting the rest (`projects/TOPIC_REGISTRY.json`, `projects/phase223-*`, `projects/pilot-sky-blue/*`, `projects/validation/**`, `providers/model-registry/kokoro-v1-identity.json`) was denied by the permission classifier, so those ~18 files are still modified (all test-generated; the tree was clean at session start). Owner decision: revert with `git checkout -- projects providers`, or commit.

## Owner decision round 2 (2026-10-09) — result

1. Accepted evidence kept (full regression exit 0, Real Incremental Creative Repair); nothing re-run, no source/config changed.
2. pilot-4b / pilot-sky-blue NOT approved as canonical.
3. Asset inventory (Glob over `projects/**` and `remotion/public/**`; no media generated, no provider called). Visual assets that exist: `postv1-flow-live-validation` (guide character reference stills + one ~4 s motion clip), `postv1b-flow-companion-live` (one generated still GEN01), `phase1g12-case-a` (blue-circle stills and several ~4 s clips of a generic character/circle), plus render frames of the two existing pilots. These are provider-validation samples: one generic character and a circle, no scene-specific visuals for any script topic. A representative ~60 s+ pilot needs a distinct topic-relevant visual per scene; the only way to get them is paid Flow/Veo generation (forbidden) or building another stand-in fixture (forbidden). Persisted Phase 4 packaging + approval also does not exist and cannot be fabricated.
4. **BLOCKED_BY_INPUT.** Missing data: (a) topic-relevant visual assets (stills/clips) for every scene of one approved script, with provenance; (b) a Phase 4A selected packaging variant (title/thumbnail promise) persisted for that project; (c) a human approval record for it. Supply (a) via the owner's own Flow session or existing licensed media, or authorise a bounded Flow generation budget.
5. Full Multimodal Watch (Gemini Free or human) not run: no canonical video to watch. Free-tier availability not verified (nothing to call). Flash and audio-visual recheck pending that video.
6. The 18 files modified by the regression were inspected: only timestamps, revisions, fingerprints, perf-baseline measurements and appended telemetry events dated 2026-10-09 (test-generated; no source or user data). Revert (`git checkout -- <those 18 paths>`) was denied twice by the permission classifier, so the files are unchanged. Owner: run `git checkout -- projects providers` (the tree was clean at session start).
7. No product code/config changed this round; the existing regression PASS on revision 4a57790 stands.
8. External cost 0 VND.

## Owner decision round 3 (2026-10-10) — canonical pilot `pilot-sky-blue-canonical`

Owner set `EXTERNAL_COST_BUDGET_VND = 0` and asked for one free canonical pilot. External cost: 0 VND (no paid API, Flow not used, no upload/publish).

| Item | Result | Evidence |
|---|---|---|
| Script | Approved "Why the sky is blue" (8 beats, 6 scenes), content unchanged | `projects/pilot-sky-blue-canonical/script.json` |
| Visuals | One original Remotion SVG diagram clip per scene (no third-party media) | `remotion/src/compositions/SkyDiagram.tsx`, `scene-media-coverage-matrix.md` |
| Narration | Local Kokoro `am_michael` (Voice Bible voice), speed 1.1, Whisper `base.en` WER 0 on all 8 beats; gain/limiter applied (-18.2 LUFS) | `assets/voice/B1..B8.wav` |
| Captions | Burned-in + sidecar (`BOTH`), retimed to the narration | `captions/captions.srt`, `captions.vtt` |
| Phase 4A packaging | Experiment set `pxs-3b6db9620ead`, 3 variants, QA 0 BLOCK; owner selected `pkv-202fd90e1b72` ("Why Sunsets Turn Red While the Sky Stays Blue", thumbnail `THUMB_S05`); madeForKids=No, ageRestriction=No (owner) | `projects/pilot-sky-blue-canonical/packaging/` |
| Render | 6 attempts (002 interrupted by operator error); final `attempt-006`, technical QA 9 PASS / 0 FAIL / 0 REVIEW / 0 UNKNOWN | `pipeline-cli qa` |
| Owner approval | Explicit message `DUYỆT attempt-006 7954a86a, cho phép finalize`; hash verified before finalize | `approval/owner-approval.json` |
| Finalize | `out/pilot-sky-blue-canonical/final.mp4`, sha256 `7954a86a793ccbe5e153be30875b832ef813f3e23021e0f571a9da5e823dfcdf`, 57.152 s, 1920x1080@30 | `final-artifact.json` |
| FinalPublishPackage | Persisted, schema-valid, `finalVideoRef` + sha256, `OWNER_APPROVED`, `qaStatus=REVIEW_REQUIRED` with open items | `packaging/final-publish-package.json` |
| Phase 4B final QC (deterministic) | PASS: 0 black / freeze / silence, flash screen 0 large transitions (2 fps and all 1713 frames), max volume -4.2 dB | `Report/evidence/phase-6a/canonical-pilot/phase4b-final-qc.json` |

Defects found and fixed (root cause, test first): burned-in captions were invisible because `CaptionTrack` had no `zIndex` above scene layers (`tests/remotion/test-remotion-captions.js` RC9); cues sharing one boundary frame stacked two captions for one frame, a visible flash (RC10); S06 crossfade ghosting; Kokoro output ~7 dB too quiet. Scene title text and the "ILLUSTRATION" badge were removed and the diagrams redesigned on owner feedback.

Exact commands executed: `npm run render:doctor`; `node scripts/cli/pipeline-cli.js prepare|render|qa|resume|submit-visual-review --project pilot-sky-blue-canonical` (render with `--max-attempts 4/5/6`); `node tests/remotion/test-remotion-captions.js` (10/10 PASS); `npm run test:remotion` (0 failed suites); `npm run check:repo-structure` (OK); `npx remotion compositions`; `finalizeOp` from `pipeline/render-orchestrator.js` (no CLI exists; owner-authorised); QC via `lib/render/probe.js` + `lib/render/qc.js`.

Owner-authorised state edit: the stale `MAX_ATTEMPTS` blocker (recorded when the default cap of 3 rejected a render, before `--max-attempts` was used) was removed from `pipeline/state.json`; see `approval/blocker-removal.json`.

Gemini Full Multimodal Watch (owner-authorised, one call): `node scripts/diagnostics/gemini-video-watch.js --video out/pilot-sky-blue-canonical/final.mp4 --project projects/pilot-sky-blue-canonical --out Report/evidence/phase-6a/canonical-pilot/gemini-watch.json`. Model `gemini-3.5-flash` (AI Studio), 1 upload + 1 `generateContent`, 0 retries, 6864 tokens, 25.7 s, uploaded file deleted afterwards. Result: 10/10 checks PASS (audio, narration vs script, captions, visuals/science, AV sync, AV energy, flash/strobe, legibility, music/SFX, packaging promise), 0 findings. Free Tier is **owner-attested** (not verifiable through the API). Caveats: the model cited no timestamps although asked, and its "narration matches verbatim" is self-reported (independently supported by Whisper WER 0 per beat); treat this as one low-granularity pass, not an exhaustive segment watch. An earlier key check in this session wrongly reported "not loaded" because `require` on `lib/env-bootstrap.js` does not load the file (`loadRootEnv()` must be called); that was an agent error, not an env problem.

Per-scene Gemini watch (owner-authorised re-run): `node scripts/diagnostics/gemini-video-watch.js --video out/pilot-sky-blue-canonical/final.mp4 --project projects/pilot-sky-blue-canonical --out Report/evidence/phase-6a/canonical-pilot/gemini-watch-per-scene.json --segments [--llm fast]`. The first three attempts with `gemini-3.5-flash` returned HTTP 503 (service overload, not quota); no result was written. The owner then approved the lighter `gemini-3.5-flash-lite` (`FAST_LLM`): 1 upload + 6 calls (one per scene), 0 retries, 9591 tokens, 41.6 s. Each scene had to transcribe what it hears, read the burned-in captions and list issues with timestamps; I re-checked the output locally:
- Transcript vs approved script: WER 0 in 6/6 scenes.
- Burned-in captions: 16/16 cue texts read exactly (S01 2/2, S02 2/2, S03 4/4, S04 2/2, S05 2/2, S06 4/4).
- Visual descriptions match the diagrams; audio clean; no flash; legibility PASS in every scene; 0 issues.
- **Not reliable:** the model's caption timestamps mix clip-relative and absolute time (e.g. S05 offsets of -37 s), so caption sync is not proven by the model. Caption timing is evidenced by the rendered boundary frames 146/147/148 and the render QA instead.
- The model is the lighter one; treat as medium granularity, still a model opinion, not a signed human watch.

Not done / open:
- The owner viewed the video and gave feedback over several rounds, then approved; no signed `phase-6a-full-av-watch-evidence.md` checklist exists, so this is not recorded as a formal human watch.
- `AUDIO_VISUAL_ENERGY_MISMATCH`: model reports no mismatch; `FLASH_SAFETY_REVIEW`: deterministic 0 transitions plus model reports no flash.
- Full regression re-run on revision 5dec82a: `node scripts/run-tests.js` = 195/195 suites PASS, 0 failed, 1293.8 s (`Report/evidence/phase-6a/full-regression-6a-canonical-final-run2.log`). A first run showed 4 research suites failing only because the agent session had `PLAYWRIGHT_BROWSERS_PATH=0` (the research venv looked for Chromium in `.local-browsers`; logged in `full-regression-6a-canonical-final.log`); they passed with the variable unset and the full suite then passed.
- New file: `scripts/diagnostics/gemini-video-watch.js` (reusable one-shot watch tool; never logs the key).
- Typecheck not run (no local TypeScript); Remotion bundling compiled the sources.
- Source changes not committed: `remotion/src/compositions/SkyDiagram.tsx`, `remotion/src/Root.tsx`, `remotion/src/captions/CaptionTrack.tsx`, `tests/remotion/test-remotion-captions.js`.
- The ~18 regression-generated tracked files from round 2 are still modified.

## Final Verdict

```text
FULL_REGRESSION                = PASS (195/195 suites, 0 failed, 1293.8 s, revision 5dec82a)
HYGIENE                        = PASS
REAL_INCREMENTAL_RENDER        = PROVEN (fixture, unchanged)
CANONICAL_PILOT_LINEAGE        = PROVEN_PARTIAL (pilot-sky-blue-canonical, owner-approved final.mp4)
PHASE_4B_FINAL_QC_DETERMINISTIC= PASS
FLASH_SAFETY_REVIEW            = RECHECKED (deterministic PASS + model reports none)
FULL_AV_WATCH_AUDIO_AND_VISUAL = PROVEN_BY_MODEL_WATCH (single low-granularity pass) + owner viewed, unsigned
AUTONOMOUS_MULTIMODAL_WATCH    = PASS_MEDIUM_GRANULARITY (whole-video + per-scene; Free Tier owner-attested)
PAID_EXTERNAL_COST_VND         = 0
PHASE_6A                       = CLOSED_BY_OWNER_DECISION (2026-10-10; full regression re-run PASS on the new revision)
PHASE_6B_READY                 = NO (separate owner decision)
```
