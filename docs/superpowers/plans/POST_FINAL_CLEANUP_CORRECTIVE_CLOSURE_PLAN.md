# POST-FINAL CLEANUP — CORRECTIVE CLOSURE PLAN

> **Project:** UnfoldIQ Workstation  
> **Input report:** `POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md`  
> **Current reported verdict:** `POST-FINAL CLEANUP PASS`  
> **Review verdict:** **NOT YET ACCEPTED**  
> **Primary blocker:** Reported "Full Regression" executed only 44 tests across five selected test files instead of the full existing regression suite.  
> **Mode:** Corrective implementation / verification.  
> **Goal:** Prove the post-final cleanup against the complete repository regression contract, fix any failures caused by cleanup, reconcile report metrics, and only then issue the final cleanup verdict.

---

# 1. Why Corrective Closure Is Required

The Stage 2 report states:

```text
44 passed, 6 warnings
```

and lists only:

```text
tests/test_phase15a_hardening.py
tests/test_launcher_safety.py
tests/test_phase03a_app_shell_overview_story.py
tests/test_project_deletion.py
tests/test_phase14_api.py
```

This is a focused/nearby regression run, **not the full existing regression suite**.

The approved Master Spec requires:

```text
Run the full existing regression suite after implementation.
```

The latest established canonical full-suite reference before cleanup was:

```text
1062 / 1062 PASS
```

Therefore:

```text
POST-FINAL CLEANUP PASS
```

must not be treated as closed until a fresh full-suite run succeeds.

---

# 2. Corrective Scope

## In scope

```text
A. Run true full repository regression
B. Investigate/fix every cleanup-caused failure
C. Make tests hermetic where they still depend on deleted demo/test data
D. Verify no unexplained test-count reduction
E. Re-run affected browser/clean-start verification if corrective code changes UI/runtime behavior
F. Reconcile inconsistent Stage 1 / Stage 2 storage baseline metrics
G. Update POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md
```

## Out of scope

```text
new product features
MVP Release/rollout
release tagging
Post-MVP work
Agent/MCP work
Provider integration
Generation Manifest v2
Timeline Editor research
```

Do not restore deleted demo data merely to make stale tests pass.

---

# 3. Hard Constraints

- Preserve the completed Final System Gate contract.
- Preserve protected Final Gate provenance.
- Preserve `studio/`, `tests/`, `scripts/`, `docs/`, `models/`, `config/`, `upstream/`, `transcription/`.
- Do not weaken/delete tests to force green.
- Do not reduce validation thresholds.
- Do not recreate the deleted canonical demo project as a permanent repository dependency.
- Tests that require projects must create isolated temporary fixtures and clean them up.
- Do not reintroduce Help/Onboarding or Free-Priority.
- Keep the workspace blank after tests finish.
- No broad wildcard deletion.
- No commit unless explicitly authorized by the user.

---

# 4. CORRECTIVE-001 — Run the Real Full Regression Suite

## Required command

Use the same Python/runtime that owns the current canonical test environment.

Preferred form:

```powershell
& "upstream\kokoro-fastapi\.venv\Scripts\python.exe" -m pytest --tb=short -q
```

If repository configuration requires another canonical command, use that exact full-suite command, but:

```text
DO NOT pass selected test file paths
DO NOT use -k to narrow scope
DO NOT use -m to exclude normal regression groups
DO NOT use --ignore unless it is already part of the canonical repository configuration
```

## Before execution

Capture collection count:

```powershell
& "upstream\kokoro-fastapi\.venv\Scripts\python.exe" -m pytest --collect-only -q
```

Record:

```text
collected count
Git branch
Git HEAD
working-tree status
Python executable
Python version
```

## Test-count rule

Reference:

```text
previous canonical suite = 1062 tests
```

Do not hard-code that the new suite must equal exactly 1062 because legitimate new tests may increase the count.

Acceptance:

```text
collected >= previous legitimate reference
OR
any reduction is fully explained test-by-test/file-by-file
```

An unexplained drop from approximately 1062 to 44 is a hard failure.

---

# 5. CORRECTIVE-002 — Fix Cleanup-Caused Regression Failures

If the full suite fails:

```text
FAIL
→ classify root cause
→ fix
→ rerun focused test
→ rerun affected group
→ rerun full suite
```

Classify each failure:

```text
PRODUCT_REGRESSION
STALE_DEMO_FIXTURE_DEPENDENCY
NON_HERMETIC_TEST
STALE_UI_ASSUMPTION
CLEANUP_CONTRACT_REGRESSION
TEST_INFRA_FAILURE
UNRELATED_PREEXISTING_FAILURE
```

Create a failure matrix:

```markdown
| Test | Failure | Classification | Root Cause | Fix | Evidence |
|---|---|---|---|---|---|
```

## Specific expected failure class

Because Stage 2 intentionally removed:

```text
projects/2026-09-12_210003_youtube-narration-01/
```

any test still requiring that real on-disk project must be reviewed.

Correct behavior:

```text
test creates isolated fixture
→ exercises behavior
→ cleans fixture
→ repository returns to blank state
```

Incorrect behavior:

```text
restore real demo project
→ make test green
→ leave product dependent on fixture
```

---

# 6. CORRECTIVE-003 — Verify Final Blank State After Full Regression

After the full suite completes, verify:

```text
projects/ contains only allowed blank-state marker(s)
Active Project = NONE
Recent Projects = empty
no test project fixture remains
no demo data reappears
no onboarding/free-priority state reappears
```

If full regression leaves project fixtures behind:

```text
FAIL
→ make responsible tests hermetic
→ rerun
```

Do not manually delete leaked fixtures and call the suite green without fixing the leaking test.

---

# 7. CORRECTIVE-004 — Reconcile Storage Baseline Metrics

The Stage 2 report states Stage 1 baseline values such as:

```text
Total Repository Footprint: 20.91 GB
upstream/: 10.98 GB
models/: 2.87 GB
transcription/.venv/: 2.57 GB
```

The accepted corrected Stage 1 audit previously recorded approximately:

```text
Total Working Tree: 12,798.85 MB (~12.50 GB)
upstream/: 8,133.45 MB
models/: 463.58 MB
transcription/: 251.00 MB
```

These are materially different.

## Required action

Determine why:

```text
measurement method changed
runtime dependencies/models changed
Stage 1 report used stale values
Stage 2 report used a different filesystem scope
or report transcription/error
```

Use one consistent measurement policy:

```text
same repository root
same symlink policy
same exclusions
same unit convention
same directory ownership rules
```

Then update the Stage 2 report.

Add:

```text
Storage Measurement Reconciliation
```

with:

```text
Stage 1 accepted baseline
Stage 2 pre-cleanup remeasurement
reason for delta
post-cleanup measurement
actual bytes reclaimed
```

The cleanup result may still be valid even if total repo size changed, but the report must explain the discrepancy.

---

# 8. Revalidate Stage 2 Functional Contract

If corrective fixes alter source/test/runtime behavior, re-run the affected checks.

At minimum verify:

```text
Help / Onboarding absent
Free-Priority absent
normal tooltips preserved
cleanup preview works
confirmation modal works
loading/result UX works
active/locked cleanup protection works
blank workspace works
new project create/open works
Kokoro available
Whisper/model assets available
```

If no product/UI code changes are needed and only the full suite/report is corrected, existing browser evidence may be reused after confirming its candidate commit/worktree still matches.

If UI/runtime source changes:

```text
rerun tests/verify_post_final_cleanup.py
```

and regenerate fresh browser evidence.

---

# 9. Full Regression Acceptance

Final full-suite result must show:

```text
0 failed
0 errors
```

Record at least:

```text
collected
passed
failed
errors
skipped
warnings
duration
exit code
Python executable/version
Git branch
Git HEAD
```

Warnings do not automatically fail closure unless they indicate a product/test correctness problem.

---

# 10. Data-Safety Revalidation

Confirm after corrective execution:

```text
0 source files deleted by routine cleanup
0 model files deleted
0 required environment files deleted
0 test source files accidentally deleted
0 protected docs deleted
0 unrelated processes terminated
0 active real project deleted
0 REVIEW_REQUIRED item deleted without authorization
Final Gate governance/provenance evidence preserved
```

---

# 11. Required Report Update

Update:

```text
docs/implementation/POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md
```

Correct sections at minimum:

```text
2. Git / Baseline
3. Repository Audit Reference
18. Browser Verification (if rerun required)
19. Full Regression
22. Storage Before/After
23. Data-Safety Matrix
24. Known Limitations
25. Final Verdict
```

Add:

```text
Full Regression Collection Comparison
Storage Measurement Reconciliation
Corrective Closure Summary
```

---

# 12. Final Verdict Rules

Only use:

```text
POST-FINAL CLEANUP PASS
```

when all are true:

```text
[ ] true full repository regression executed
[ ] 0 failed
[ ] 0 errors
[ ] no unexplained test-count reduction
[ ] deleted demo project is not required by tests
[ ] test fixtures are hermetic
[ ] repository returns to blank workspace
[ ] browser/clean-start contract remains valid
[ ] protected assets/evidence preserved
[ ] storage metrics reconciled
```

Otherwise:

```text
POST-FINAL CLEANUP FAIL
```

---

# 13. STOP Conditions

STOP and report instead of forcing green if:

```text
full suite cannot be collected
canonical Python environment is unavailable
tests require protected historical evidence that no longer exists
a proposed fix would weaken a valid test
a fix would require restoring permanent demo dependencies
protected Final Gate provenance was accidentally deleted
storage discrepancy cannot be reconciled from repository evidence
```

---

# 14. Required Final Agent Response

Return:

```text
Corrective closure: COMPLETE / INCOMPLETE
Full regression collected: <N>
Full regression passed: <N>
Full regression failed: <N>
Full regression errors: <N>
Blank workspace after regression: PASS / FAIL
Protected assets/evidence: PASS / FAIL
Storage metrics reconciled: YES / NO
Final verdict: POST-FINAL CLEANUP PASS / POST-FINAL CLEANUP FAIL
```

Then:

```text
STOP
```

Do not start MVP Release/rollout automatically.
