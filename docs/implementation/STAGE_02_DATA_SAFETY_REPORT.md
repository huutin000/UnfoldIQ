# Stage 2 — Data Safety Report

## 1. Preflight Git State
- Branch: `main`
- HEAD: `537698e77ca967ab4cfee0c37d10263f229e188c` (matches plan's Stage 1 known-good checkpoint)
- Worktree: clean at start, clean at end (`git status --short` empty). No tag on HEAD (not required).
- No intentional post-checkpoint commits existed; no reset performed.

## 2. Canonical Data Surface Inventory

Source-reviewed from current repo (authority: `studio/state_store.py`, `studio/config.py`,
`studio/backup_restore.py`, `studio/project_bootstrap.py`, `studio/project_integrity.py`,
`studio/asset_integrity.py`, `tests/fixtures/project_factory.py`).

| Data surface | Current path/source | Required in backup? | Reason | Restore method |
|---|---|---:|---|---|
| Project SQLite state (DAG nodes/edges/revisions/locks) | `projects/<dir>/state.db` (`StateStore`, `journal_mode=DELETE`, short-lived per-transaction connections) | REQUIRED | Sole durable store of artifact graph, review status, locks, revision history | `BackupRestoreService.restore_backup` (full-type zip carries `state.db`) |
| Project JSON artifacts (script, scene plan, settings, visual bible, timestamps, manifests, transcription) | `projects/<dir>/*.json|*.txt|*.srt|*.md` | REQUIRED | Reopen/reference inputs; `settings.json` (voice/speed/resolution/schemaVersion) needed for reopen | Same zip restore, sha256-verified per file |
| Referenced assets + intake ledger | `projects/<dir>/assets/**` incl. `intake_ledger.json` (ledger resolves `path`/`filePath` relative to project dir) | REQUIRED | Linked-asset resolution; ledger `status` stamped by verifier | Same zip restore; ledger paths stay relative |
| Render cache / drafts / `.tmp` | `projects/<dir>/render_cache`, `renders/draft*`, `.tmp` | OPTIONAL / REGENERABLE | Explicitly excluded by both light and full backup (`backup_restore.py:87,104`) | Regenerate |
| Audio masters used by verification | `projects/<dir>/audio.wav` (referenced by `timestamps.json`) | REQUIRED when referenced | `project_integrity` audio check resolves it | Same zip restore (full type packs non-excluded files) |
| Global app defaults | `config/*.json` (tracked in git) | EXCLUDED from project backup | Version-controlled, not per-project data | Git checkout |
| Machine-local runtime (logs, jobs, venv, caches, `__pycache__`, test cache) | `runtime/logs`, `temp/`, `scratch/`, `.venv`, `models/whisper` (all gitignored) | EXCLUDED / SECRET-MACHINE-LOCAL | Regenerable or machine-local; env-based values (`KOKORO_BASE_URL`) never written to backups | N/A |
| Existing backups archives | `backups/*.unfoldiq.zip` | EXCLUDED | Must not nest backups inside backups | N/A |

- Required data: `state.db`, project JSON artifacts, `settings.json`, referenced assets + ledger, referenced audio.
- Optional/regenerable data: render cache, draft renders, `.tmp`, exports, QA reports.
- Excluded data: `.venv`, `__pycache__`, test/build cache, runtime logs, source tree, prior backup zips.
- Secret/machine-local handling: no per-project secrets exist in the schema (nodes carry hashes/status/metadata only); machine-local values live in env/gitignored paths and are excluded from backup scope. No secret values in this report.

## 3. Backup / Restore Capability Audit
- Existing mechanism: `studio/backup_restore.py::BackupRestoreService` + API routes in
  `studio/phase15a_router.py` (`POST /api/projects/{dir}/backup`, `/api/backup/restore`, preview/upload).
  Features: atomic zip write via temp+replace, `backup_manifest.json` with per-file sha256,
  Zip-Slip guard on preview, collision detection (`COLLISION_DETECTED` without overwrite),
  rollback snapshot on overwrite failure, per-file checksum re-verification on restore,
  post-restore `project_integrity_checker.run_check`.
- SQLite consistency mechanism: `state_store.py` enforces `PRAGMA journal_mode = DELETE`
  (rollback journal, no WAL) with short-lived connections (open → commit → close per
  transaction). Verified at runtime: zero `state.db-*` sidecars while idle, so a
  quiescent file copy inside the zip is a consistent snapshot (plan-accepted
  "controlled quiesce + safe copy" equivalent; no Backup API/`VACUUM INTO` needed).
- Changes required: NONE (Decision A). One scope note: `light` backup type excludes
  `state.db` (extension filter, `backup_restore.py:96`) — Stage 2 verification therefore
  uses `full` type, which carries `state.db` + assets and still excludes cache/temp.
- No product/runtime/test/UI code was modified in this stage.

## 4. Disposable Verification Dataset
- Location: `temp/stage2_data_safety/src_project/` (gitignored; removed after verification).
  Rerunnable builder + raw result kept at `temp/stage2_data_safety/verify_stage2.py` / `result.json`.
- Contents (deterministic, no secrets): `settings.json`, `script.json/txt`, `scene_plan.json`
  (1 scene), `visual_bible.json` (1 subject), `timestamps.json` (+`audio.wav` 100 ms silence),
  `assets/shot_001.png` + `assets/intake_ledger.json` (entry carries both intake keys
  `id`/`filePath` and registry keys `assetId`/`path`/`checksum`), and `state.db` built via
  canonical `StateStore`+`ArtifactDependencyGraph`: 6 nodes
  (`beat_001→c_01→scene_001→shot_001/shot_002`, `visual_bible→shots`, `shot_002` locked),
  6 edges, 1 revision (`rev_stage2_001`).
- Representative coverage: project identity, DAG reference chain depth 4, stable IDs,
  lock flag, revision history, FK constraints, relative asset reference, reopen settings.
- Honest observation (fixture-side, not product): an early fixture revision used only
  `filePath` in the ledger; the canonical verifier resolves `path`/`dest_path`
  (`asset_integrity.py:150`), so it correctly reported `ASSET_PATH_EMPTY` and stamped
  `status=MISSING` back into the ledger (intended `save_ledger` behavior, line 225).
  Fixture was corrected to the canonical dual-key schema; no product change needed.

## 5. Backup Creation
- Method: canonical `BackupRestoreService(backups_dir=<disposable>).create_backup(src, backup_type="full")`.
- Destination: `temp/stage2_data_safety/backup_out/src_project_full_<ts>.unfoldiq.zip`
  (8067 bytes, outside the active data tree; no silent overwrite — timestamped name + atomic replace).
- Included surfaces: all 10 fixture files incl. `state.db`, assets, ledger, settings, audio
  (manifest `fileCount: 10`, `projectId: src_project`).
- Excluded/re-generable: no cache/temp dirs in fixture; verifier asserted zero
  `render_cache`/`.tmp` entries in the zip.
- Result: backup created, `BACKUP-CREATED PASS`.

## 6. Backup Integrity Verification
- SQLite `integrity_check` on the zipped `state.db` copy: `ok`.
- `foreign_key_check` on the zipped copy: 0 violations.
- File/reference inventory: manifest present; all manifest sha256 values re-hashed from
  zip bytes and matched; relative reference `assets/shot_001.png` resolvable.

## 7. Disposable Restore
- Destination: `temp/stage2_data_safety/restore_out/stage2_restored/` (fresh dir,
  `target_parent_dir` override; canonical `projects/` never used as target).
- Result: `restore_backup` → `SUCCESS` (checksum of every file re-verified during restore;
  embedded integrity check `WARNING / 0 errors / 1 warning`, identical to source — see §8).

## 8. Restore Verification
- Reopen status: reopened via canonical paths — `StateStore(restored/state.db).load_graph()`
  (6/6 nodes, edges equal) + `store.list_revisions()` (1/1) + `project_integrity_checker.run_check()`.
- Stable IDs: node IDs/types/hashes/locks/metadata identical before/after.
- Project/state consistency: nodes, edges, revisions row-equal; `settings.json` equal.
- Asset/reference consistency: `assets/shot_001.png` resolves via ledger `filePath`,
  byte-identical hash; ledger `path`+`checksum` intact.
- Settings consistency: `settings.json` byte-content equal.
- The single checker warning (`TIMELINE_MISSING`, `timeline.json` absent from the minimal
  fixture — regenerable surface) is identical pre/post restore: parity `WARNING/0/1` vs
  `WARNING/0/1`. All script/audio/timestamp/scenes/visual checklist items True.
- Before/after matrix:

| Check | Before backup | After restore | Result |
|---|---|---|---|
| SQLite `integrity_check` | `ok` | `ok` | PASS |
| `foreign_key_check` violations | 0 | 0 | PASS |
| DAG nodes (via canonical reopen) | 6 | 6 | PASS |
| DAG edges | 6 | 6 | PASS |
| Revisions | 1 (`rev_stage2_001`) | 1 | PASS |
| Lock flag (`shot_002`) | locked | locked | PASS |
| `settings.json` | equal | equal | PASS |
| Asset bytes (`shot_001.png`) | equal | equal | PASS |
| Ledger reference resolves | yes | yes | PASS |
| Integrity checker (status/errors/warnings) | WARNING/0/1 (`TIMELINE_MISSING`) | WARNING/0/1 | PASS (parity) |

## 9. Non-Destructive Safety
- Canonical data untouched: `projects/` contains only `.gitkeep` before, during, after
  (asserted programmatically); no `state.db` ever created under `projects/`.
- Overwrite protection/result: restore targeted a fresh disposable dir; the service's
  `COLLISION_DETECTED` path was not triggered (no collision existed); rollback path not
  needed (no failure).
- Secret exposure: NONE — fixture contains no credentials; report contains no hashes of
  real data, no tokens, no keys.
- Cleanup: `src_project/`, `backup_out/`, `restore_out/` removed with control after the
  ALL-PASS run; `projects/` re-verified pristine; only the rerunnable script + `result.json`
  remain under gitignored `temp/` (outside git, outside product).

## 10. Change Impact and Regression
- Changed files: tracked `git status --short` empty before and after — ZERO tracked
  product/runtime/test/UI/source changes. New files exist only under gitignored `temp/`
  (verification script + result) and this untracked report.
- Focused tests: end-to-end verification script (32 checks, 32 PASS) exercising the real
  `BackupRestoreService`, `StateStore`, and `project_integrity_checker` — no new committed
  tests required (no product behavior added/changed).
- Full regression: NOT RERUN. Reason: working tree is byte-identical to checkpoint
  `537698e` (where `1106/1106 PASS` was recorded); Stage 2 introduced no tracked changes,
  so prior full-suite evidence remains valid per plan Task 10 rules.
- MACHINE-HEADED IMPACT: NONE
- HUMAN-NARRATOR IMPACT: NONE

## 11. Blockers / Deviations
- None. One fixture-side correction during execution (ledger dual-key schema, §4) —
  product behavior confirmed correct, no deviation from plan criteria.

## 12. Final Verdict
STAGE 2 — READY FOR USER ACCEPTANCE

## 13. Next Action
If READY:
Return this report to the user for ChatGPT acceptance review.
Do not start Stage 3.
