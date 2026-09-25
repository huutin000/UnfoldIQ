# AGENT_HANDOFF — Stage 3 First Real Video Baseline (stop for today)

Date stopped: 2026-09-21 ~21:45 (UTC+7). Do NOT continue implementing; resume per §10.

## 1. Current task / objective
Stage 3 — First Real Video Baseline (`UNFOLDIQ_STAGE_03_FIRST_REAL_VIDEO_BASELINE_PLAN.md`).
Run one REAL video end-to-end through the current workflow for production evidence.
Topic (user-selected, real): **How Did Ancient Humans Protect Babies From Predators?** Target was 10–12 min;
locked narration came out 8:04 (user decision: KEEP, record drift as friction).

## 2. Completed
- Gate preflight: VIDEO_AFFECTING_TASK: YES; prompts #4 (light) + #2 (script); policy A/C/E/F/G; human gates YES.
- Task 1: pre-stage state main / `6de31cb` / clean.
- Services: canonical launcher FAILED (Kokoro health 35s timeout — cold model load ~80s; also
  pythonw spawn wrote empty logs). Started manually with venv python.exe: Kokoro :8880 + Studio :7860.
- Task 2/3: script v1 → user corrections (10) → v2 → micro-edits (6) → final 3 replacements →
  **APPROVED — LOCK SCRIPT**. Locked text: `temp/stage3_baseline/locked_script.txt` (1237 words).
- Task 4: `POST /api/jobs` → job_c80ddc961f3f → project
  `projects/2026-09-21_143938_ancient-humans-protect-babies-predators/`. TTS 26/26 chunks, 0 retries,
  19.2s elapsed. audio.wav 484.7s. Manifest integrity True. Timestamps 98 segs, sha match.
  Voice QA initial: 27 FAIL / 54 REVIEW (WER 3.23%).
- Human audio decisions applied via canonical QA API: waived 23 em-dash artifacts; then waived 4 remaining
  FAIL + accepted 29 reviews → **0 unresolved FAIL**; 25 reviews left (17 low_conf + 6 extra + 2 subst,
  out of disposition scope). **NARRATION APPROVED.**
- Task 5: scenes/generate → 59 scenes 100%; visual-bible/generate → Ready (auto-picked Homo habilis GROUP);
  veo/generate → 98 shots 100%.
- Task 8: restart/reopen PARITY PASS (46/46 files byte-identical, APIs serve 59/98/VB Ready).
- Task 6/manual: user generated 18 Flow images for scenes 001–018 (real location:
  `projects/incoming/*.jpeg` with timestamp-suffixed names, NOT `.../incoming/*.png` — first lookup
  failed honestly, corrected by user). Verified: 18 files, JPEG magic, 116–373KB, scenes 001–018 covered.
- Intake 18/18 via `POST /assets/intake` (all SELECTED, QC passed). Timeline auto-linked 18 assets.
- **P0 REAL PRODUCTION BLOCKER FOUND + FIXED**: `renderer_adapter.render_draft` read
  `scene_id`/`id` but timeline uses `sceneId` → all clips collapsed to one shared
  `img_clip_sc_1280.mp4` (whole visual draft showed ONE image). Fix in `studio/renderer_adapter.py`:
  `_resolve_scene_id()` + content-addressed clip names (`img_clip_<id>_<sha12>_<w>.mp4`),
  applied to draft AND final. Studio restarted (PID 2408) with fix.
- Visual draft RE-RENDERED with fix: `renders/draft/draft_preview.mp4` 33MB + 59 per-scene
  `img_clip_scene_*.mp4` files (18 real images for scenes 1–18; scenes 19–59 reuse first asset
  per existing filler design — recorded as P2 friction, not changed).

## 3. In progress
Stage 3 Tasks 10–19 (from human visual-draft review onward). Visual draft file exists but has NOT
been formally verified (ffprobe) nor presented to user for review yet.

## 4. Exact stopping point
Right after the fixed visual-draft render finished (files listed, FIX behaviorally confirmed by
59 distinct clip files). Next required step is §10 below. No code edits pending in editor.

## 5. Modified files
- `studio/renderer_adapter.py` (ONLY tracked modification: +20/-5): `import hashlib`,
  `_resolve_scene_id()`, `_asset_cache_key()`, clip naming, draft+final loops use resolver.
- Real project data (gitignored via `projects/*`): full project dir + `projects/incoming/` (18 JPEGs).
- `temp/stage3_baseline/` (gitignored): locked_script.txt, submit/run/inspect/verify scripts,
  job_id.txt, intake_results.json, prerestart_snapshot.json, result artifacts.
- `temp/stage2_*` leftovers from prior stages (ignored, harmless).
- NO report file created yet for Stage 3. NO commit/tag/push (all unauthorized — none performed).

## 6. Key decisions / assumptions
- Project creation = `POST /api/jobs` (canonical UI path; dir auto-created at submit).
- Duration 8:04 KEPT per user; drift is friction evidence, script stays locked.
- VB species: do NOT lock habilis; Taung scenes must be A. africanus; no canonical add-entity
  API exists (`update_entity` is update-only) → left auto-derived VB untouched, fix at manual
  Flow step; mismatch = P2 friction (Stage 4 owner).
- Filler design (asset-less scenes reuse first asset) intentionally NOT changed (scope).
- `/api/jobs/{id}` 404 for jobs_manager DRAFT_RENDER jobs = P2 API-consistency friction, not fixed.
- Both services died once while idle (cause unknown — no logs on manual start); restarted fine.
- Kokoro cold start ~80s > launcher 35s timeout → launcher failure explained.

## 7. Tests/checks run + results
- TTS job: 26/26, 0 retries. Voice QA final: 0 unresolved FAIL / 25 REVIEW (WER 3.23%).
- Restart parity: ALL PASS. Intake: 18/18 SELECTED + QC pass. Timeline links: 18/59, 0 missing.
- Draft v1 (buggy): 720p, 484.67s, 6.4MB color-card. Draft v2 (fixed): 33MB, 59 clips.
  ffprobe of v2 NOT yet run (do on resume).
- Full pytest NOT rerun after renderer fix (required before Stage 3 report: tracked source changed).
- No focused regression test yet for the renderer fix (plan Task 17 Case B expects one if fitting).

## 8. Errors / warnings / blockers / unresolved
- RESOLVED: single-image visual draft (P0) — fixed, re-rendered.
- OPEN (friction, not blocking): VB habilis mismatch; filler reuse design; /api/jobs 404;
  duration drift 10–12→8:04; 25 residual QA reviews; services died once idle; slow Kokoro cold start.
- No P0/P1 open. No secrets in evidence (two untracked-aware sweeps pattern applies on resume).

## 9. Remaining TODOs
1. ffprobe-verify draft v2 (duration/streams/size) + confirm concat lists distinct clips.
2. Add focused regression test for per-scene clip identity (fits Task 17 Case B), run it.
3. Rerun FULL pytest (renderer_adapter is tracked + new test) — expect 1109+ new count.
4. STOP → present visual draft (`renders/draft/draft_preview.mp4`) for HUMAN VISUAL DRAFT REVIEW.
5. Per review: targeted corrections → (user forbids direct audio-led Final Render; visual coverage
   is scenes 1–18 only — discuss extension vs partial baseline with user).
6. Render QA, friction/automation inventories, storage/perf notes.
7. Write `docs/implementation/STAGE_03_FIRST_REAL_VIDEO_BASELINE_REPORT.md` (plan §19 structure).
8. Final git/data state + STOP. No Stage 4, no git mutation without explicit user authorization.

## 10. Exact next action on resume
1. Restart services if down (Kokoro needs ~80s; verify `/health` on :8880 and :7860).
2. Run: ffprobe on `projects/2026-09-21_143938_ancient-humans-protect-babies-predators/renders/draft/draft_preview.mp4`
   (expect ~484.7s, 1280x720 h264+aac) and count distinct files in `concat_draft.txt`.
3. Write focused test (e.g. `tests/test_renderer_per_scene_clips.py`), run it, then full `python -m pytest -q`.
4. Then present the visual draft to the user for HUMAN VISUAL DRAFT REVIEW and STOP.

## 11. Commands to rerun if needed
- Health: `Invoke-RestMethod http://127.0.0.1:7860/health`, `:8880/health`
- Start Kokoro: `Start-Process <kokoro-venv python.exe> "-m uvicorn api.src.main:app --host 127.0.0.1 --port 8880"` in `upstream/kokoro-fastapi` (wait ~80s)
- Start Studio: same with `-m uvicorn studio.app:app ... --port 7860` in repo root (wait ~25s)
- Draft render trigger: `python temp/stage3_baseline/run_draft.py` (note: `/api/jobs/{id}` poll 404s — check output file directly)
- Full suite: `python -m pytest -q` (last green: 1109/1109 BEFORE renderer fix)
- Current PIDs at stop: Studio 2408 (+child 8324), Kokoro 10308 (+child 10992); both HTTP 200.

## 12. Task IDs / statuses to preserve
No framework task-ID system in use; internal todowrite list (all completed except):
- in_progress at stop: "Tasks 10-16: Human draft review, corrections, final render/QA, friction+automation inventory"
- pending: "Tasks 17-19: Regression decision, git/data state, final report + STOP"
- completed: gate preflight, Task 1, Task 2, Task 3 (LOCKED), Task 4 (voice+QA disposition),
  Task 5 (scenes/VB/prompts), Tasks 6-9 partial (visuals 1–18, intake, restart parity, draft v2 rendered).
- ManageTask statuses: none external. MUST preserve: script LOCKED (no edits without user),
  narration APPROVED, NO Final Render / NO Stage 4 / NO git mutation without explicit authorization.

## 13. Addendum 2026-09-22 — resume + human visual-draft review + motion pilot
- Resume verified: repo matched §5 exactly (only `M studio/renderer_adapter.py` +20/-5).
  ffprobe draft v2 PASS (1280x720 h264+aac, 484.671s, 33MB). Services restarted:
  Studio :7860 healthy; Kokoro :8880 DOWN — `OSError WinError 4551` App Control
  blocked `torch_python.dll` (new friction; no TTS rerun needed).
- Focused regression `tests/test_renderer_per_scene_clips.py` 5/5; full suite 1114/1114.
- HUMAN VISUAL DRAFT REVIEW: NEEDS_CHANGES. NO Final Render. Findings: 001–018 PASS,
  mapping/intake/timeline PASS; pacing (scene_009 17.42s static, others 8–11s static);
  001–018 is a static slideshow — motion pilot ordered for scene_001/003/010 with
  canonical Veo prompts, manual provider boundary, intake/QC → timeline → short
  motion draft → STOP. Accepted images must NOT be replaced. Coverage 019–059 filler
  pipeline-verification only, NOT for final. Flow watermark = provider constraint,
  do NOT crop (conflicts with canonical "no watermark" prompt constraint — provider wins).
- Pilot kit: `temp/stage3_baseline/motion_pilot_kit.md`. STOPPED awaiting user Flow generation.

## 14. Addendum 2026-09-22 — motion pilot intake + short draft (STOP for review)
- User delivered 5/5 clips to `projects/incoming/` (do NOT regenerate/replace).
  Verified: MP4 ftypisom, h264 1280x720 24fps + aac, 8.0s each, 7.7–12.6MB.
- Studio :7860 had died idle overnight; restarted (PID 14736), healthy.
  Kokoro still App-Control-blocked (no TTS needed on this path).
- Canonical intake 5/5 SELECTED + QC pass (`run_motion_intake.py`,
  manifest MOTION-PILOT-v1): ASSET-SCENE_001-V2/V3, ASSET-SCENE_003-V2,
  ASSET-SCENE_010-V2/V3. V1 images demoted to GENERATED, files untouched.
  Timeline auto-recompiled: 001→V3 mp4, 003→V2 mp4, 010→V3 mp4; other scenes unchanged.
- Short motion draft (`run_motion_draft.py`, head trims, clip audio dropped per
  muteGeneratedAudio, narration slices 0–11.4 / 19.66–27.4 / 88.42–97.56):
  `renders/draft_motion/motion_pilot_draft.mp4` — ffprobe 1280x720 h264+aac,
  28.288s (= 5.7+5.7+7.74+4.57+4.57), 50.7MB. Canonical full draft untouched.
- STOPPED for HUMAN REVIEW. Still forbidden: Final Render, scenes 019–059,
  Stage 4, any git mutation.

## 15. Addendum 2026-09-24 — continuation frames + v2/v3 motion drafts
- Extracted final frames (n=191, t=7.958s, PNG lossless) from shot1 sources:
  `temp/stage3_baseline/continuation/scene_{001,010}_continuation.png`. Sources untouched.
- User delivered shot2_v2 continuations (MOTION-PILOT-v2): ASSET-SCENE_001-V4,
  ASSET-SCENE_010-V4 SELECTED; timeline 001→V4, 010→V4; shot1 V2s + scene_003 V2 kept.
- Draft v2 (`motion_pilot_draft_v2.mp4`, 28.288s): human review — improved, NOT approved;
  jumps at both shot1→shot2_v2 joins traced to HEAD-trimming discarding the continuation tail.
- Draft v3 (`run_motion_draft_v3.py`): trims only — shot1 keeps TAIL (001: ss 2.3/5.7s;
  010: ss 3.43/4.57s), shot2_v2 keeps HEAD; scene_003 unchanged.
  `renders/draft_motion/motion_pilot_draft_v3.mp4` — 1280x720 h264+aac, 28.288s, 51.8MB.
  Joins frame-exact by construction (tail ends frame 191 = continuation frame = v2 head frame 0).
- STAGE 3 FINDING — MULTI_SHOT_CONTINUITY_TRIM_POLICY: when a continuation clip is
  generated from the previous shot's final frame, the continuation clip's head must be
  preserved (previous shot: HEAD trim / keep tail; continuation: TAIL trim / keep head).
  Generic head-trimming breaks the continuity chain.
- STOPPED for HUMAN REVIEW of v3. Still forbidden: new Flow generation, scenes 004–018,
  Final Render, Stage 4, any git mutation.
