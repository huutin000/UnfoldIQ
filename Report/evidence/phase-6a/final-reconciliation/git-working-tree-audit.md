# Git Working Tree Audit

Date: 2026-10-10. HEAD `5dec82a42e07aaf928343809b9f5bb10abc2f3b6` (branch `main`, committed 10:40:38 +07:00).

## Before cleanup (after the regression finished at 11:06:50)

- Tracked modified: 30 files, all `git diff` hunks are timestamps / perf numbers / appended telemetry events (366 insertions, 222 deletions). No source/config among them. Full patch saved: `regression-generated-tracked-changes.patch`.
- `git diff --check`: only "LF will be replaced by CRLF" warnings; no whitespace errors.
- Staged: 0.

### Intentional source changes (verified COMMITTED, not dirty)
`remotion/src/compositions/SkyDiagram.tsx`, `remotion/src/Root.tsx`, `remotion/src/captions/CaptionTrack.tsx`, `tests/remotion/test-remotion-captions.js`, `scripts/diagnostics/gemini-video-watch.js` — none appear in `git diff` / `git status` (commits d99ec8c, 73116b9, 9723dcc, 5dec82a). They were not touched.

### TEST_GENERATED_CHANGE (30 tracked files) — restored by exact pathspec
`git restore --worktree -- <30 exact paths>` (exit 0; no directory-level restore, no reset/clean/checkout):

- Report/evidence: `perf-5b/repair-benchmark-a.json`, `perf-5b/repair-benchmark-small.json`, `perf-5b/repair-benchmark.json`, `perf-5c/browser-reuse-benchmark.json`, `perf-5c/concurrency-matrix.json`, `pilot-4b/e2e-baseline.json`
- `projects/HARDENING_1G12/flow-jobs/H1-JOB.json, H2, H3, H4, H6, H8`
- `projects/TOPIC_REGISTRY.json`
- `projects/phase223-narration-pronunciation/` `dependency-dag.json`, `evidence/phase-2/2.2-2.3/performance/performance-baseline.json`, `evidence/phase-2/2.2-2.3/runtime/quiet-phonemization-evidence.json`, `telemetry/events.json`
- `projects/pilot-sky-blue/` `evidence/fix-pre-2.4/performance-baseline.json`, `evidence/fix-pre-2.4/runtime/quiet-phonemization-evidence.json`, `telemetry/events.json`
- `projects/validation/phase-1h/` `phase1h1-validation/baseline/perf-baseline.json`, `phase1h2-validation/evidence/performance/perf-baseline.json`, `phase1h3-validation/evidence/performance/perf-baseline-dag.json`, `perf-baseline-recovery.json`, `phase1h45-validation/evidence/performance/perf-baseline-golden.json`, `perf-baseline-telemetry.json`, `phase1h67-validation/evidence/performance/perf-baseline-compliance.json`, `perf-baseline-governance.json`, `perf-baseline-storage.json`
- `providers/model-registry/kokoro-v1-identity.json`

After restore: `git status` shows 0 tracked modifications.

## Still untracked (kept, nothing deleted) — awaiting owner

| Path | Class |
|---|---|
| `projects/pilot-sky-blue-canonical/render/attempts/attempt-001…006/` (incl. `browser.log` 1.2 MB, output.mp4 18.9 MB) | OWNER_DATA / UNTRACKED_REQUIRED_ARTIFACT (attempt-006 is the approved render) |
| `Report/evidence/phase-6a/canonical-pilot/*.mp3, preview-en-x*.mp4` | REPORT/EVIDENCE (narration speed previews) |
| `Report/evidence/phase-6a/full-regression-6a-canonical-final.log`, `final-reconciliation/*` | REPORT/EVIDENCE |
| `Report/phases/phase-6/PHASE_6A_CANONICAL_PILOT_REPORT.md`, `UNFOLDIQ_PHASE_6A_FINAL_EVIDENCE_RECONCILIATION.md` | REPORT/EVIDENCE |
| `remotion/public/unfoldiq/pilot-sky-blue-canonical/`, `…/pilot-sky-blue/<6 hash dirs>/`, `…/__5c_conc__/` | generated render staging (likely TEST_GENERATED/staging; not confirmed deletable; left alone) |

(Some `projects/pilot-sky-blue-canonical/**` is tracked, some untracked; the full `git status` list is large. This table groups the untracked set seen in `git status --porcelain=v1`.)

Notes: no commit/push/stash performed. Nothing deleted.

`GIT_STATUS = EXPECTED_DIRTY` (tracked tree is clean; untracked canonical artifacts/evidence remain uncommitted). `HYGIENE = PASS` per the last recorded `check:workspace` and `check:repo-structure` runs in the gate JSON; they were not re-run in this pass (no source change). HYGIENE PASS != GIT_CLEAN.
