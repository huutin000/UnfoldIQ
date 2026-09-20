# POST-FINAL CLEANUP — LEGACY TEST & EVIDENCE CORRECTIVE PLAN

> **Project:** UnfoldIQ Workstation  
> **Input report:** `POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md` v3.0.0  
> **Current verdict:** `POST-FINAL CLEANUP FAIL`  
> **Full suite:** 1062 collected / 870 passed / 5 skipped / 135 failed / 52 errors  
> **Primary root causes:**  
> 1. Legacy tests depend on the deleted canonical demo project.  
> 2. Phase 5/6 tests depend on historical evidence that was stored under disposable `temp/` paths and was deleted during cleanup.  
> **Goal:** Remove both forms of non-hermetic coupling without restoring permanent demo state, weakening tests, or fabricating historical evidence; then return the repository to a blank workspace and prove the full suite green.

---

# 1. Current Failure Summary

The corrective audit established:

```text
1062 tests collected
870 passed
5 skipped
135 failed
52 errors
187 total issues
```

Root-cause groups:

```text
A. STALE_DEMO_FIXTURE_DEPENDENCY / NON_HERMETIC_TEST
   → 122 issues

B. CLEANUP_CONTRACT_REGRESSION / TEST_INFRA_FAILURE
   → 65 issues
```

Current verdict remains:

```text
POST-FINAL CLEANUP FAIL
```

Do not start MVP Release/rollout.

---

# 2. Required Execution Mode

This is an **implementation corrective plan**.

Therefore:

```text
test FAIL
→ investigate root cause
→ implement the smallest correct fix
→ rerun focused test
→ rerun affected test group
→ rerun full suite
```

Do not stop after the first expected regression failure unless a true STOP condition is reached.

---

# 3. Hard Constraints

## Product / workspace

- Keep production startup blank.
- Do not restore `projects/2026-09-12_210003_youtube-narration-01/` as a permanent product dependency.
- Do not auto-seed demo data.
- Do not reintroduce Help/Onboarding.
- Do not reintroduce Free-Priority.
- Preserve current cleanup UX/safety behavior.

## Tests

- Do not delete tests to obtain green.
- Do not weaken meaningful assertions.
- Do not reduce validation thresholds.
- Do not reduce collected test count without a documented, independently reviewed reason.
- Do not turn required failures into unconditional `skip`/`xfail`.
- Tests that require project state must create their own isolated state.

## Evidence

- Never fabricate human/manual/Narrator/browser evidence.
- Never recreate a historical evidence JSON by inventing values.
- Reproducible machine evidence may be regenerated only through the canonical producing workflow.
- Irreproducible/manual evidence may only be restored from a trustworthy previously verified source or re-captured through the approved real/manual process.
- `temp/` must not remain the long-term source-of-truth for evidence required by the regression suite.

## Git / cleanup

- No `git clean -fd`.
- No broad wildcard deletion.
- No commit unless explicitly authorized.
- Preserve Final System Gate governance/provenance evidence.

---

# 4. Phase A — Failure Inventory Before Fixing

Before modifying tests, create:

```text
temp/post_final_corrective_failure_inventory.md
```

For every failing/erroring test record:

```markdown
| Test | Required external path/artifact | Why required | Root cause class | Reproducible? | Correct future owner | Planned action |
|---|---|---|---|---|---|---|
```

Allowed root-cause classes:

```text
STALE_DEMO_FIXTURE_DEPENDENCY
NON_HERMETIC_TEST
DURABLE_EVIDENCE_STORED_IN_TEMP
REPRODUCIBLE_MACHINE_EVIDENCE_MISSING
IRREPRODUCIBLE_MANUAL_EVIDENCE_MISSING
PRODUCT_REGRESSION
TEST_INFRA_FAILURE
OTHER_REVIEW_REQUIRED
```

Do not begin mass edits until this inventory is complete.

---

# 5. Workstream A — Remove Permanent Demo-Project Coupling

## Problem

122 issues rely on:

```text
projects/2026-09-12_210003_youtube-narration-01/
```

existing permanently in the normal workspace.

That assumption conflicts with the approved post-cleanup state:

```text
Projects list = empty
Active Project = NONE
No demo auto-seed
```

## Correct architecture

Tests must own their fixture lifecycle:

```text
test starts
→ create isolated temporary project/fixture
→ run assertion
→ teardown
→ production workspace remains blank
```

The normal `projects/` directory must not be the fixture source-of-truth.

---

# 6. Inventory Demo-Dependent Tests

At minimum inspect all files named in the failed-suite report:

```text
tests/test_phase01_verification.py
tests/test_data_foundation.py
tests/test_phase02_dependency_versioning_scheduler.py
tests/test_phase03b_voice_workbench.py
tests/test_phase03b_final_gap_closure.py
tests/test_phase03c_gap_closure.py
tests/test_phase03c_visual_workbench.py
tests/test_phase03d_export_workbench.py
tests/test_phase03d_governance.py
tests/test_phase04_media_asset_pipeline.py
tests/test_phase04_closure_gaps.py
tests/test_phase05_closure.py
```

Also search the whole test suite for literal references to:

```text
2026-09-12_210003_youtube-narration-01
projects/
79 scenes
141 shots
canonical demo
baseline demo
```

Record all hits in the failure inventory.

---

# 7. Determine Minimum Fixture Requirements

For each test, determine whether it actually needs:

```text
A. Project existence only
B. Specific metadata/state
C. Script / beats / scenes / shots
D. Audio/timestamp artifacts
E. Assets
F. Export / Render Manifest
G. Full canonical 79/141 scale
```

Do not use a full 214 MB fixture for a test that only needs a project ID and one JSON file.

Prefer:

```text
smallest fixture that proves the contract
```

---

# 8. Create Shared Hermetic Fixture Infrastructure

First inspect existing repository fixture conventions.

If no equivalent shared helper exists, create a dedicated fixture layer under the test source tree, for example:

```text
tests/
├── conftest.py
└── fixtures/
    └── project_factory.py
```

The exact location should follow the repository's current test organization.

The fixture API should support conceptually:

```text
create_minimal_project(...)
create_scene_shot_project(...)
create_media_pipeline_project(...)
create_export_ready_project(...)
create_canonical_scale_project(...)   # only if truly required
```

Requirements:

```text
- use temporary isolated directories;
- never rely on the production `projects/` directory unless a test specifically tests that directory contract;
- stable IDs must be deterministic where assertions require them;
- teardown must be automatic;
- failed tests must still clean temporary data where practical;
- fixture creation must not alter Recent Projects or Active Project persistently.
```

---

# 9. Canonical-Scale Tests

Some tests may genuinely verify scale behavior corresponding to the historical:

```text
79 scenes / 141 shots
```

For those tests:

- generate deterministic synthetic/canonical-scale fixture data;
- do not recreate the historical production demo project as a normal user project;
- do not hard-code the 79/141 numbers into product logic;
- fixture-specific numbers may remain in test data when the test explicitly validates canonical scale.

If required fixture content cannot be generated from repository-owned definitions, STOP that subset and document the missing source rather than guessing.

---

# 10. TDD Cycle for Demo-Coupled Tests

For each test group:

```text
1. Run current failing test and capture failure.
2. Replace permanent project dependency with isolated fixture.
3. Run focused test.
4. Confirm PASS.
5. Run the whole affected test file.
6. Confirm PASS.
7. Confirm fixture teardown leaves blank workspace.
```

Do not batch-edit all 122 issues without intermediate verification.

---

# 11. Workstream B — Move Required Regression Evidence Out of Disposable `temp/`

## Problem

65 issues depend on files such as:

```text
temp/phase05_*
temp/phase06_*
```

The regression suite treats those artifacts as required evidence, but cleanup treated them as disposable temp content.

This is an ownership/architecture conflict:

```text
required regression input
≠
disposable temporary output
```

The long-term fix is not simply:

```text
protect all temp/phase*
```

because that turns `temp/` into permanent storage.

---

# 12. Classify Every Missing Evidence Artifact

Inspect failures from at least:

```text
tests/test_phase05_evidence_closure.py
tests/test_phase05_performance_gate.py
tests/test_phase06_final_closure.py
tests/test_phase06_hardening.py
tests/test_phase06_twogate_closure.py
```

For each missing artifact classify:

```text
REPRODUCIBLE_MACHINE_EVIDENCE
IRREPRODUCIBLE_MANUAL_EVIDENCE
HISTORICAL_REPORT_DERIVABLE
STALE_FILE_EXISTENCE_ASSERTION
UNKNOWN
```

Examples:

```text
benchmark JSON generated by deterministic script
→ REPRODUCIBLE_MACHINE_EVIDENCE

Windows Narrator human observation
→ IRREPRODUCIBLE_MANUAL_EVIDENCE

a test that only checks that a temp file exists
while the durable authored report contains the accepted result
→ possible STALE_FILE_EXISTENCE_ASSERTION
```

Do not decide from filename alone.

---

# 13. Durable Evidence Location

Evidence that is required for routine regression must live in a protected durable location, not a cleanup temp directory.

First inspect existing repository conventions.

If no canonical location exists, introduce one narrowly scoped protected location such as:

```text
tests/fixtures/governance_evidence/
```

or another repository-approved fixture directory.

Do not move large runtime media into the repository unless the test truly needs the binary.

Prefer compact deterministic evidence:

```text
JSON
small text fixtures
checksums
manifests
minimal metadata
```

over large videos/screenshots where possible.

---

# 14. Reproducible Machine Evidence

For each reproducible artifact:

```text
canonical producing script/harness
→ run in isolated workspace
→ validate output
→ copy/minimize required deterministic fixture into durable fixture location
→ update test to consume durable fixture
```

Requirements:

- generated values must come from the real producer;
- record producing command and version;
- do not manually invent JSON fields;
- if artifact is environment-specific, preserve only fields required by the contract and only if the test spec permits this;
- review test assertions to ensure semantics remain equivalent.

---

# 15. Manual / Narrator / OS Evidence

For evidence requiring real human or OS observation:

Allowed solutions, in priority order:

```text
1. Restore exact previously verified artifact from a trustworthy retained backup/source.
2. Re-run the approved manual capture process and generate new real evidence.
3. If governance has explicitly changed so routine regression should not require that manual artifact, redesign the test contract with independent review.
```

Forbidden:

```text
fabricate sr_human.json
invent Narrator observations
copy values from prose into JSON and call it observed evidence
skip the test unconditionally
```

If no authentic evidence source exists and recapture is impossible:

```text
STOP
→ report blocker
```

---

# 16. Historical Closure Tests

For each Phase 5/6 closure test, determine what it is supposed to guarantee today:

```text
product behavior
regression contract
historical governance record
manual evidence provenance
```

If a test only asserts:

```text
"historical temp file exists"
```

but that temp file is not itself the durable contract, rewrite the test to assert the correct durable contract.

This is allowed only after proving the old assertion was a storage-location assumption rather than a substantive validation requirement.

Document every such test change in a Test Change Audit.

---

# 17. Test Change Audit

Create:

```text
temp/post_final_test_change_audit.md
```

For every modified test:

```markdown
| Test | Old assumption | New fixture/evidence source | Assertion removed? | Assertion added/replaced | Contract preserved? |
|---|---|---|---|---|---|
```

Acceptance:

```text
Tests deleted: 0
Meaningful contracts weakened: 0
Unconditional skips added: 0
Unsupported xfails added: 0
```

---

# 18. Cleanup Policy Correction

The report says `storage_manager.py` now protects broad evidence markers such as:

```text
temp/phase*
evidence
closure
```

Re-evaluate this after durable evidence migration.

Desired long-term rule:

```text
durable required regression evidence
→ protected source/fixture location

temp runtime evidence
→ disposable only after classification
```

Do not permanently protect all paths containing `phase`, `evidence`, or `closure` if doing so causes temp growth without governance need.

Use explicit ownership/classification instead of broad substring protection where practical.

Add focused tests proving:

```text
required durable fixture/evidence cannot be deleted
disposable temp evidence can still be cleaned
unknown evidence-like path becomes REVIEW_REQUIRED / protected
active path is skipped safely
```

---

# 19. Full Regression Sequence

After Workstream A and B are green:

## Step 1 — Collect

Run:

```powershell
& "upstream\kokoro-fastapi\.venv\Scripts\python.exe" -m pytest --collect-only -q
```

Record collection count.

Expected:

```text
>= 1062
```

unless an exact documented reason explains a legitimate count change.

## Step 2 — Full suite

Run:

```powershell
& "upstream\kokoro-fastapi\.venv\Scripts\python.exe" -m pytest --tb=short -q
```

Required:

```text
0 failed
0 errors
```

## Step 3 — No hidden narrowing

Confirm:

```text
no selected file list
no -k filter
no ad-hoc --ignore
no marker exclusion that was not already canonical
```

---

# 20. Blank-State Verification After Full Suite

After full regression completes:

```text
projects/ contains only approved blank-state marker(s)
Active Project = NONE
Recent Projects = empty
no demo project remains
no leaked test fixture remains
```

If tests leave data behind:

```text
identify leaking fixture/test
→ fix teardown/root cause
→ rerun affected tests
→ rerun full suite
```

Do not manually clean leaked test directories as the final solution.

---

# 21. Browser / Runtime Reverification

Because this corrective work primarily targets tests/evidence, reuse existing browser evidence only if product/UI source remains unchanged after the last verified browser run.

If any of these are modified:

```text
studio/static/*
studio/app.py
studio/storage_manager.py
project lifecycle code
cleanup API/UI code
```

rerun:

```text
tests/verify_post_final_cleanup.py
```

Required:

```text
8/8 PASS
```

and regenerate current evidence.

---

# 22. Data-Safety Reverification

Confirm:

```text
0 source files accidentally deleted
0 model files deleted
0 required environment files deleted
0 authored docs deleted
0 protected Final Gate provenance deleted
0 real user project deleted
0 permanent demo project restored
0 secret values exposed
```

---

# 23. Storage Reconciliation

Retain the corrected accepted baseline:

```text
Stage 1:
12,798.85 MB
```

and current post-cleanup measurement:

```text
8,911.80 MB
```

Do not change those values unless a fresh same-method measurement proves a new value.

If fixture/evidence remediation adds durable small files, record the increase explicitly.

Do not count required durable test fixtures as disposable cleanup loss.

---

# 24. Required Updated Cleanup Report

Update:

```text
docs/implementation/POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md
```

Required new/updated sections:

```text
1. Executive Summary
19. Full Regression
19.x Failure Corrective History
19.x Test Change Audit
19.x Hermetic Fixture Migration
19.x Durable Evidence Migration
22. Storage Before/After
23. Data-Safety Matrix
24. Known Limitations
25. Final Verdict
```

Also record:

```text
collected
passed
failed
errors
skipped
warnings
duration
exit code
Git branch
Git HEAD
Python executable/version
```

---

# 25. Final PASS Conditions

Use:

```text
POST-FINAL CLEANUP PASS
```

only when all are true:

```text
[ ] full suite collected with no unexplained reduction
[ ] 0 failed
[ ] 0 errors
[ ] legacy tests no longer depend on permanent demo workspace state
[ ] tests create/teardown isolated fixtures
[ ] required regression evidence lives in durable protected ownership
[ ] no required evidence remains dependent on disposable temp storage
[ ] no fabricated manual/human evidence
[ ] no meaningful test weakening
[ ] no unconditional skip/xfail used to hide failures
[ ] blank workspace restored after regression
[ ] browser verification remains valid
[ ] protected Final Gate provenance remains intact
[ ] storage metrics remain reconciled
```

Otherwise:

```text
POST-FINAL CLEANUP FAIL
```

---

# 26. STOP Conditions

STOP and report if:

```text
authentic manual evidence cannot be restored or recaptured
a failing test's intended contract cannot be determined
fixing tests would require weakening a substantive requirement
the canonical full suite cannot be collected
required historical data has no trustworthy source and cannot be regenerated
product behavior is discovered to be genuinely broken beyond cleanup scope
```

Do not guess.

---

# 27. Required Final Agent Response

Return:

```text
Corrective implementation: COMPLETE / INCOMPLETE

Demo-coupled tests migrated: <N>/<N>
Evidence-coupled tests migrated/resolved: <N>/<N>

Full regression collected: <N>
Passed: <N>
Failed: <N>
Errors: <N>
Skipped: <N>

Test deletions: 0
Meaningful test weakening: 0
Permanent demo project restored: NO
Fabricated manual evidence: NO

Blank workspace after regression: PASS / FAIL
Browser verification: PASS / NOT RERUN / FAIL
Protected provenance: PASS / FAIL
Storage reconciliation: PASS / FAIL

Final verdict:
POST-FINAL CLEANUP PASS / POST-FINAL CLEANUP FAIL
```

Then:

```text
STOP
```

Do not start MVP Release/rollout.
