# PHASE 6A — Canonical Pilot Report: `pilot-sky-blue-canonical` (2026-10-10)

Companion to `PHASE_6A_FINAL_CLOSURE_REPORT.md` (round 3 section). External cost: 0 VND. No upload/publish.

## 1. Deliverable

| Item | Value |
|---|---|
| Final video | `out/pilot-sky-blue-canonical/final.mp4` (git-ignored; same bytes tracked at `projects/pilot-sky-blue-canonical/render/attempts/attempt-006/output.mp4`) |
| sha256 | `7954a86a793ccbe5e153be30875b832ef813f3e23021e0f571a9da5e823dfcdf` |
| Format | 1920x1080, 30 fps, h264 + aac, 57.152 s, about -18.2 LUFS |
| Title (owner choice) | Why Sunsets Turn Red While the Sky Stays Blue (`pkv-202fd90e1b72`, thumbnail `THUMB_S05`) |
| Audience flags (owner) | madeForKids = No, ageRestriction = No |
| Packaging | `projects/pilot-sky-blue-canonical/packaging/` (description, metadata, rights, sources, upload checklist, `final-publish-package.json`) |
| Approval | `projects/pilot-sky-blue-canonical/approval/owner-approval.json` |

## 2. How it was made (all local, free)

- Script: approved "Why the sky is blue" (8 beats, 6 scenes), content unchanged.
- Visuals: original SVG diagrams animated by frame number in `remotion/src/compositions/SkyDiagram.tsx`, rendered with Remotion. No AI image/video generation, no Flow, no extension, no third-party media.
- Narration: local Kokoro `am_michael` (Voice Bible voice), speed 1.1, then compressor + gain + limiter. Whisper WER 0 on every beat.
- Captions: burned-in plus `captions.srt` / `captions.vtt` sidecars.
- Render: `pipeline-cli` prepare / render / qa; 6 attempts, final `attempt-006`; owner approval by explicit message, then `finalizeOp` (no CLI exists for it).

## 3. Defects found and fixed

| Defect | Root cause | Fix |
|---|---|---|
| Burned-in captions invisible | `CaptionTrack` had no `zIndex`; scene video layers (zIndex = layer index) covered it | `zIndex: 1000`, test RC9 |
| One-frame caption flash at cue changes | adjacent cues share a frame (start = floor, end = ceil), so two captions stacked for one frame | drop the superseded cue, test RC10 |
| S06 ghosting during crossfade | overlapping fade of two layers | sequential fade-out then fade-in |
| Voice too quiet (-27.5 LUFS) | Kokoro output level | gain + limiter (-18.2 LUFS) |
| Scene titles, "ILLUSTRATION" badge, plain visuals | owner feedback | titles and badge removed, diagrams redesigned |

## 4. Verification

| Check | Result |
|---|---|
| Pipeline technical QA (attempt-006) | 9 PASS / 0 FAIL / 0 REVIEW / 0 UNKNOWN |
| Phase 4B deterministic QC | PASS: 0 black, 0 freeze, 0 silence, 0 large luminance transitions (2 fps and all 1713 frames) — `canonical-pilot/phase4b-final-qc.json` |
| Gemini whole-video watch (`gemini-3.5-flash`) | 10/10 PASS, 0 findings — `canonical-pilot/gemini-watch.json` |
| Gemini per-scene watch (`gemini-3.5-flash-lite`) | transcript WER 0 in 6/6 scenes, 16/16 caption texts read exactly, 0 issues (locally re-checked) — `canonical-pilot/gemini-watch-per-scene.json` |
| `npm run test:remotion`, `check:repo-structure`, `check:workspace` | pass |
| Full regression (`node scripts/run-tests.js`, revision 5dec82a) | 195/195 suites PASS, 0 failed, 1293.8 s (first run: 4 research suites failed only due to session env `PLAYWRIGHT_BROWSERS_PATH=0`; logs in `Report/evidence/phase-6a/`) |

Limits: Gemini Free Tier is owner-attested (not verifiable by API); the model's caption timestamps are unreliable (mixed clip-relative and absolute time), so caption timing is evidenced by rendered boundary frames and render QA; the model watch is an opinion, not a signed human watch; the owner viewed the video unsigned.

## 5. Process notes (honest record)

- Attempt-002 was interrupted by an operator error (output pipe closed); attempts 4-6 ran with the CLI flag `--max-attempts`. A stale `MAX_ATTEMPTS` blocker was removed from `pipeline/state.json` only with explicit owner permission (`approval/blocker-removal.json`).
- Gemini `gemini-3.5-flash` returned HTTP 503 (overload) three times on the per-scene run; the owner approved the lighter model.
- An early "key not loaded" finding was an agent mistake (`require` of `lib/env-bootstrap.js` does not load `.env`; `loadRootEnv()` must be called).

## 6. Open items

- ~18 regression-generated tracked files under `projects/` and `providers/` are still modified (not committed).
- Untracked listening aids and older attempts remain in the working tree: `Report/evidence/phase-6a/canonical-pilot/*.mp3|*.mp4`, `projects/pilot-sky-blue-canonical/render/attempts/attempt-001..005`.
- Phase 6B readiness is a separate owner decision (`NO`).

## 7. Commits

`73116b9` caption fix, `d99ec8c` SkyDiagram, `a977f62` project, `9723dcc` Gemini watch tool, `5dec82a` closure docs.
