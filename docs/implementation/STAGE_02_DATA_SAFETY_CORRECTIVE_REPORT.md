# Stage 2 — Data Safety Corrective Report

## 1. Current Git State
- Branch: `main`
- HEAD: `537698e77ca967ab4cfee0c37d10263f229e188c` (`git log -1`: `537698e chore(stage1): ...`)
- Tracked source: one modified file — `M studio/backup_restore.py` (the corrective fix, §4).
- Worktree: DIRTY — expected untracked files only:
  - `?? docs/implementation/STAGE_02_DATA_SAFETY_REPORT.md` (first Stage 2 report)
  - `?? tests/test_backup_sqlite_consistency.py` (new focused regression coverage, §4)
  - (this corrective report itself is likewise untracked until a user-authorized commit)
- Exact classification: **TRACKED SOURCE: 1-file corrective diff; WORKTREE: DIRTY — expected untracked report(s) + 1 new test file.** The worktree is NOT called clean.
- Staged changes: none (`git diff --cached --name-only` empty).
- Untracked relevant files: the two paths above (+ this report).
- Ignored verification artifacts: `temp/stage2_data_safety/` (rerunnable script + result),
  `temp/stage2_corrective/` (overlap probe script) — gitignored, outside product.
- Prior-contradiction correction (honest provenance): the first Stage 2 report's
  "worktree clean" line was captured BEFORE `STAGE_02_DATA_SAFETY_REPORT.md` itself was
  written, then worded as if it described the end-state including that report. The
  re-capture above replaces it: any non-ignored untracked report makes the worktree
  dirty by definition.
- Unauthorized git add/commit/tag/push:
  - `git add`: NO — never executed in Stage 2 or this corrective pass (staging was done
    only in the earlier user-authorized Stage 1 checkpoint turn).
  - `commit`: NO. `tag`: NO (`git tag --points-at HEAD` empty).
  - `push`: NO — the command was never executed in this Agent session (confirmed from
    execution history, not inferred from HEAD alone).

## 2. SQLite Backup Consistency Boundary
- Write transaction path (`studio/state_store.py:44-80`): `StateStore.transaction()`
  opens a fresh connection (`timeout=30s`, `foreign_keys=ON`, `busy_timeout=30s`,
  `journal_mode=DELETE`), yields, commits, closes. No application-level lock exists
  anywhere on this path (repo-wide search: only unrelated `asyncio.Lock` in app startup /
  resource scheduler / transcription; backup routes in `studio/phase15a_router.py:98-159`
  take no lock; sole backup callers are those routes).
- Backup `state.db` path (pre-fix `studio/backup_restore.py:create_backup`): collected
  `state.db` via `os.walk` like any other file, then `_file_sha256` + `zf.write` read
  its **raw bytes directly**. No shared/exclusive application lock, no writer quiesce,
  no SQLite Backup API, no `VACUUM INTO`, no snapshot API of any kind.
- Lock/quiesce mechanism: NONE (pre-fix).
- Snapshot mechanism: NONE pre-fix — raw file copy. `journal_mode=DELETE` was the only
  consistency argument, and it guarantees a consistent file **only while idle**.
- Safety conclusion: **Existing mechanism NOT safe under overlap (Outcome B).**
  Documented hazards, all unguarded pre-fix: (a) torn-page read if the copy races a
  commit flush (Windows permits concurrent file reads during SQLite writes, so nothing
  blocks the copy); (b) journal divergence — copying `state.db` while a hot
  `-journal` exists captures bytes without the journal's content; (c) sidecar files
  (`-journal`/`-wal`/`-shm`) were packed as ordinary files. The first Stage 2 run's
  idle-fixture success therefore proved only that one quiescent copy, not the mechanism.

## 3. Overlapping-Write Verification
- Disposable fixture: `temp/stage2_corrective/probe_src/` — `settings.json` + `state.db`
  (1 DAG node via canonical `StateStore`); backup target `temp/stage2_corrective/probe_backup/`.
- Concurrency setup (`temp/stage2_corrective/probe_overlap.py`, rerunnable): opened a writer
  connection, `BEGIN IMMEDIATE` + uncommitted `INSERT` (hot `state.db-journal` confirmed
  present), then ran the exact pre-fix read sequence plus the real
  `BackupRestoreService.create_backup(..., backup_type="full")` while the tx stayed open.
- Observed behavior (pre-fix, factual): hot journal present = True; raw read during open
  tx blocked 0.00s; `create_backup` during open tx completed in 0.00s; archived
  `state.db` bytes == pre-commit bytes (stale-but-valid in this instance) and !=
  post-commit bytes; manifest hash described those raw bytes. I.e. backup proceeds with
  zero synchronization while a write is open — the unsafe window is real, even though
  this particular instance did not tear.
- Existing mechanism safe?: NO → Outcome B corrective implementation (§4).

## 4. Corrective Implementation
- Changes required: minimal local-first fix in exactly 2 tracked files:
  1. `studio/backup_restore.py` — `create_backup` now: (a) drops SQLite sidecars
     (`-journal`/`-wal`/`-shm`) from the pack set; (b) snapshots every `*.db` file via
     new `_snapshot_sqlite_db()` = Python `sqlite3.Connection.backup()` into a temp dir
     (Backup API serializes against concurrent writers instead of copying torn bytes),
     then integrity-verifies the snapshot (`integrity_check = ok`,
     `foreign_key_check = 0`) and archives the **snapshot bytes** under the original
     `state.db` arcname; manifest sha256/size describe the snapshot actually archived;
     temp snapshots removed in `finally`. Backup aborts loudly (`RuntimeError` /
     `ValueError`) if snapshot or verification fails — corruption is never archived
     silently. `preview`/`restore`/API/routes unchanged.
  2. `tests/test_backup_sqlite_consistency.py` (new) — 3 focused regression tests (§5).
- Reason: close the torn-read / journal-divergence window with the plan-preferred
  mechanism; keep behavior identical for all non-DB files and for idle databases.
- Mechanism: SQLite Backup API → temp snapshot → verify → archive snapshot → cleanup.
- Honest fix-history note: the first fix revision opened the source `mode=ro`; the new
  test caught `OperationalError: attempt to write a readonly database` when a sidecar
  was present (SQLite must reconcile the journal on open). Corrected to a normal
  timed (`timeout=30s`) connection — identical to what the application itself does on
  open — and the sidecar test was upgraded to use a REAL WAL sidecar (open holder
  connection) instead of garbage bytes.

## 5. Focused Verification
- Focused checks/tests (`tests/test_backup_sqlite_consistency.py`, hermetic `tmp_path`,
  canonical `projects/` asserted untouched in `tearDown`):
  - `test_backup_during_open_write_tx_stays_consistent` — writer thread holds an open
    write tx 1.5s; main thread runs canonical `create_backup(full)` concurrently.
  - `test_sqlite_sidecars_never_archived` — real WAL sidecar present; assert exclusion
    from zip + manifest and snapshot completeness (`n_wal` present, integrity ok).
  - `test_restore_reopen_preserves_state` — disposable restore + canonical
    `StateStore` reopen (IDs, lock flag), settings/asset parity, integrity ok.
- Passed: 3/3. Failed: 0.
- SQLite `integrity_check`: `ok` (archived snapshot, extracted copy, restored DB).
- `foreign_key_check`: 0 violations at all three points.
- Checklist mapping: no-corrupt-snapshot-under-overlap ✓, integrity ok ✓, FK 0 ✓,
  manifest-hash-matches-archived-bytes ✓ (asserted byte-for-byte), disposable restore ✓,
  graph/revisions/locks consistent ✓, asset reference resolves ✓, settings consistent ✓,
  canonical `projects/` untouched ✓.

## 6. Restore / Reopen Verification
- Full Stage 2 disposable flow re-run AFTER the fix
  (`temp/stage2_data_safety/verify_stage2.py`): **32/32 checks ALL PASS** (was already
  passing pre-fix on the idle path; now exercises the snapshot path end-to-end).
- Restore result: `SUCCESS` into disposable `restore_out/stage2_restored`
  (embedded integrity `WARNING / 0 errors / 1 warning`, identical to source).
- Canonical reopen result: `StateStore.load_graph` 6/6 nodes, 6/6 edges, lock + 1
  revision preserved; `project_integrity_checker` parity `WARNING/0/1` vs `WARNING/0/1`
  (single warning = `TIMELINE_MISSING`, regenerable surface absent from the minimal
  fixture — identical pre/post, not caused by restore).
- Stable IDs/state: nodes/edges/revisions row-equal before/after.
- Assets/references: ledger `filePath` resolves, PNG bytes identical.
- Settings: `settings.json` content-equal.
- Canonical data untouched: `projects/` = `.gitkeep` only throughout; no `state.db`
  ever created under `projects/`; disposable dirs removed under control afterward
  (rerunnable script + `result.json` kept under gitignored `temp/`).

## 7. Regression
- Tracked product/runtime/test changes: `M studio/backup_restore.py` (fix),
  `?? tests/test_backup_sqlite_consistency.py` (new coverage). No UI/accessibility diff.
- Focused regression: 3/3 PASS (above).
- Full regression: `python -m pytest -q` → **1109 collected / 1109 passed / 0 failed /
  0 errors / 0 skipped** (1106 pre-existing + 3 new), duration ~379s, exit 0.
  Only pre-existing deprecation warnings; no thresholds touched, no test weakened.
- MACHINE-HEADED IMPACT: NONE
- HUMAN-NARRATOR IMPACT: NONE

## 8. Remaining Blockers
NONE

## 9. Final Verdict
STAGE 2 — READY FOR USER ACCEPTANCE

## 10. Next Action
Return this report to the user for ChatGPT review.
Do not start Stage 3.
