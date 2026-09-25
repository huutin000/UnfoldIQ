# STAGE 03 — Provenance Backfill Report

Date: 2026-09-22. Scope: narrow canonical-approval backfill per provenance decision.
Stage 3 production remains STOPPED. No Final Render. No Stage 4. No git mutation.

## 0. Human content approval (explicit, 2026-09-22)
- The user explicitly confirms the script whose SHA-256 begins `7314ba4b…` is the
  official Stage 3 production script. This section records that HUMAN CONTENT APPROVAL.
- The script was NOT rewritten, normalized, expanded, shortened, or regenerated.

## 1. Accepted script
- Official Stage 3 production script SHA-256 (file bytes).
- Path: `projects/2026-09-21_143938_ancient-humans-protect-babies-predators/script.txt`
- Full SHA BEFORE canonical lock: `7314ba4bea83d0f9134c04940d88ba0010a3086fcfee4230b1ad641ca74d0c21`
- Full SHA AFTER canonical lock: `7314ba4bea83d0f9134c04940d88ba0010a3086fcfee4230b1ad641ca74d0c21`
- **Bytes changed: NO.** `script.txt` text also verified to exactly match the approved
  `temp/stage3_baseline/locked_script.txt` body (1237 words; locked-body sha `f2542e8d…`).

## 2. Canonical lock
- Path used: `studio/script_service.py::ScriptService.approve_and_lock_script()`
  (via `get_script_data()` bootstrap from existing `script.txt`; `script.txt` never written by this path).
- Artifact created: `projects/…/script.json` — status `APPROVED`, `locked: true`,
  `version: 1`, 8 sections, `approvedAt: 2026-09-22T04:44:55Z`.
- Nothing fabricated: sections derive mechanically from the accepted `script.txt`
  (paragraph split); section text re-hashes to the locked body (`f2542e8d…`).
- Note: `script.txt` carries 14 CRLF line endings (written by the 21/09 TTS-submit
  path, pre-existing). `script.json` sections use LF-normalized text (bootstrap reads
  text mode). Accepted bytes untouched; downstream hashes reference file bytes and
  whitespace-normalized text respectively — both unchanged (see §3).

## 3. Downstream hash chain after lock — 9/9 PASS
- approved script → `narration_plan.sourceScriptHash` (`af45cd8c…`) == whitespace-normalized script ✅
- approved script → `scene_plan.source_script_sha256` == `script.txt` ✅
- scene plan → `visual_bible.sourceScenePlanHash` == `scene_plan.json` ✅
- approved script → `visual_bible.sourceScriptHash` == `script.txt` ✅
- visual bible → `veo_prompts.sourceVisualBibleHash` == `visual_bible.visualBibleHash` ✅
- scene plan → `veo_prompts.sourceScenePlanHash` == `scene_plan.json` ✅
- scene plan → `image_prompts.json`: 59/59 scenes; scene_001 prompt byte-identical to plan ✅
- `script.json` APPROVED + locked, version 1 (consistent with scene plan and
  veo `script_version: 1`) ✅
- **No artifact invalidated; nothing outdated.** Preserved untouched per order:
  scene_plan.json, visual_bible.json, image_prompts, veo_prompts.json, audio.wav,
  voice QA, scenes 001–018 images, motion pilot assets, accepted motion clips,
  current motion draft.

## 4. Narration acceptance semantics — Option B (informational)
- `narration_plan.json`: `status: REVIEW`, all 66 beats `accepted: false`, unchanged (not touched).
- Evidence: `narration_director.narration_synth_hash` docstring explicitly **excludes**
  "review metadata, confidence display, accepted state" from synthesis; `plan_status()`
  gates only on EMPTY/OUTDATED/ERROR; the sole writer of `accepted: true` is the UI
  workbench per-beat human click (`static/app.js::saveBeat`); no Python gate requires it.
- Recorded as **Stage 3 process/design friction**: beat-level acceptance exists as UI
  affordance only, with no enforcement point in the production path (TTS ran and its
  output passed human voice QA instead).
- Why downstream execution is valid despite REVIEW/false: (1) synthesis depends only on
  beat order/text-span/rate/pauses/emphasis/style (`narration_synth_hash` excludes
  `accepted` by design); (2) the plan is hash-pinned to the approved script, so any
  script change would mark it OUTDATED and block reuse; (3) the actual gate exercised
  was human QA on the rendered `audio.wav` (0 unresolved FAIL, decisions pinned in
  `voice_qa_decisions.json`), which covers more than beat-flag review.

## 5. Git state
- `M studio/renderer_adapter.py` (+20/-5, P0 clip-identity fix, pre-existing).
- Untracked: `AGENT_HANDOFF.md`, `tests/test_renderer_per_scene_clips.py`.
- New: `script.json` is gitignored (`projects/*`); this report is the only tracked-tree
  addition and is uncommitted. No add/commit/tag/push performed.

## 6. Remaining blockers
1. Human visual-draft decisions outstanding (static-draft NEEDS_CHANGES; 3-scene motion
   pilot draft pending human review).
2. Kokoro `:8880` still App-Control-blocked (`torch_python.dll`, WinError 4551) — no TTS
   rerun needed while `audio.wav`/narration stay approved.
3. Accepted-script authorship root (agent v1 draft + user corrections) remains
   conversation-record only; repo now proves byte-identity and lock, not origin.

## 7. Clarification — script.json absent-to-present transition (read-only, 2026-09-22)
1. Exact path:
   `projects/2026-09-21_143938_ancient-humans-protect-babies-predators/script.json`
2. Filesystem times (UTC): created `2026-09-22T04:44:55.1188137Z`,
   modified `2026-09-22T04:44:55.1198022Z` (single write, ~1ms apart), 9198 bytes.
3. Creating event/process: one direct in-process call
   `studio.script_service.ScriptService.approve_and_lock_script(pdir)` executed via
   `python -c` from the repo root during the provenance-backfill turn. The invocation
   was guarded by `assert not (pdir/'script.json').exists()` which passed — proving
   absence immediately before creation. NOT via HTTP: the canonical endpoint
   `POST /api/projects/{dir}/script/approve` (`studio/phase14_router.py:308`) exists
   but was never called for this (no such POST was issued in any turn).
4. Was `approve_and_lock_script()` invoked after the explicit SHA-7314ba4b approval
   message? **No.** The single invocation (`approvedAt 2026-09-22T04:44:55.118813+00:00`,
   identical to file creation time) ran under the earlier provenance-decision
   authorization and predates the explicit-approval message. Every later turn was
   verify-only (file creation time unchanged since).
5. n/a (see 4) — there has been exactly one invocation lifetime-to-date, confirmed by:
   `approvedAt == updatedAt`, `version: 1` (no bump), `outdatedDependencies: []`
   (`update_script()` would have set voice/timing/scene_plan/captions and bumped
   the version — neither happened).
6. n/a (see 4/5).
7. Current SHAs: `script.txt` =
   `7314ba4bea83d0f9134c04940d88ba0010a3086fcfee4230b1ad641ca74d0c21`
   (7456 bytes, untouched since `2026-09-21T07:39:57Z`, predating the lock by ~21h);
   locked body (`locked_script.txt` minus `#` headers) = `f2542e8d…`, text-identical
   to `script.txt` (14 pre-existing CRLFs aside, see §2).
8. `script.json` creation modified **no downstream artifact**: chain re-audited 9/9
   PASS after creation; `script.txt` mtime predates the lock; later `timeline.json`
   changes trace solely to canonical motion-intake recompiles (separate documented events).
9. Git status at clarification time: `M studio/renderer_adapter.py` (pre-existing P0 fix);
   untracked: `AGENT_HANDOFF.md`, `tests/test_renderer_per_scene_clips.py`, this report.
   `script.json` is gitignored (`projects/*`). No add/commit/tag/push.
