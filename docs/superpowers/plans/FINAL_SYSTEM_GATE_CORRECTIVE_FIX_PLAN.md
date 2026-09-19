# FINAL SYSTEM GATE — CORRECTIVE FIX & VERIFICATION PLAN

> **Project:** UnfoldIQ Workstation  
> **Source report:** `FINAL_SYSTEM_INTEGRATION_AND_PRODUCTION_VALIDATION_REPORT.md`  
> **Roadmap status:** Revision 2.9.2  
> **Current candidate verdict:** `NOT READY`  
> **Execution mode:** Corrective implementation + targeted rerun + full regression  
> **Goal:** Close all open Final Gate blockers/conditional failures without weakening product contracts, validation thresholds, or test coverage.

---

## 1. Current Failure Summary

Pass 1 completed with:

```text
10 / 13 gates PASS
3 / 13 gates FAIL / CONDITIONAL

G01 — FAIL / Hard Blocker
G04 — FAIL / Hard Blocker
G11 — FAIL / Conditional
```

Open findings:

| ID | Gate | Severity | Classification | Status |
|---|---|---:|---|---|
| FG-001 | G04 | BLOCKER | DEPENDENCY_ENGINE | OPEN |
| FG-002 | G01 | BLOCKER | REGRESSION_SUITE | OPEN |
| FG-003 | G11 | CONDITIONAL | EXPORT_MANIFEST | OPEN |
| FG-004 | G09 | OBSERVATION | TEST_INFRASTRUCTURE | OPEN |

---

# 2. Global Rules

## Required

- Work from the current real repository and current Final Gate baseline.
- Preserve the existing Phase 1–9 contracts.
- Fix root causes, not symptoms.
- Do not weaken tests simply to make them pass.
- Do not lower validation thresholds.
- Do not delete failing tests.
- Do not fabricate runtime/browser/Narrator/FFmpeg/GPU evidence.
- Do not silently alter canonical project data to satisfy tests.
- Preserve stable-ID, lock, revision, DAG, cache, render-manifest and Render QA semantics.
- Use targeted tests first, then rerun affected Final Gate gates, then full canonical regression.
- Record every changed file and every rerun result.
- Do not commit unless explicitly authorized by the user.

## Forbidden

```text
git clean -fd
taskkill /IM python.exe /F
broad wildcard deletion
test deletion to force green
threshold relaxation
hard-coded fake evidence
silent mutation of canonical validation evidence
```

---

# 3. Priority Order

Execute strictly:

```text
P0. FG-001 / G04 — Dependency micro-propagation
P0. FG-002 / G01 — Canonical regression failures
P1. FG-003 / G11 — Render Manifest validation mismatch
P2. FG-004 / G09 — CDP infrastructure observation
→ targeted gate reruns
→ full canonical regression
→ Final Gate corrective closure report
→ external/final review
```

Do not start unrelated product features.

---

# 4. FG-001 — G04 Dependency Micro-Propagation

## Problem

`PATCH /script/v2` currently updates a coarse `outdatedDependencies` flag but does not correctly propagate the committed script-content change through the dependency DAG using the canonical node update path.

Observed effect:

```text
micro-propagation false negatives
affected example shots:
shot_001
shot_002
shot_003
```

The Final Gate report records `False Negatives = 4`.

## Expected Contract

A committed semantic/content change to the script must:

```text
PATCH /script/v2
→ persist committed script content
→ update canonical content hash
→ call/use canonical dependency graph update path
→ recompute/selectively propagate affected downstream nodes
→ mark only truly affected downstream artifacts OUTDATED
```

Do not replace selective propagation with blanket invalidation.

## Investigation Scope

Inspect at minimum:

```text
studio/script_service.py
studio/dependency_graph.py
studio/project_adapter.py
studio/version_manager.py
relevant script API route/controller
existing dependency/invalidation tests
Final Gate G04 harness
```

Search for:

```text
PATCH /script/v2
outdatedDependencies
update_node_content
content hash
dependency hash
mark_outdated
propagation
```

## Required Fix

Use the existing canonical DAG/content-update API instead of introducing a second propagation mechanism.

Requirements:

1. Persist the committed script mutation first according to existing transactional semantics.
2. Update the corresponding graph node content/hash.
3. Trigger canonical selective downstream invalidation.
4. Preserve unaffected nodes.
5. Preserve lock semantics.
6. Failed/uncommitted mutation must not invalidate downstream nodes.
7. Do not invalidate everything as a shortcut.
8. Do not use array index / DOM position / visible row number as persistent identity.

## Required Tests

Add or repair focused tests proving:

```text
1. Script content mutation changes the correct canonical content hash.
2. update_node_content/canonical equivalent is reached.
3. Directly affected downstream node becomes OUTDATED.
4. Transitively affected node becomes OUTDATED where applicable.
5. Unrelated Scene/Shot remains current.
6. Locked downstream artifact is not overwritten.
7. Locked downstream artifact may still become OUTDATED.
8. Failed script update produces no propagation.
9. Re-applying identical effective content does not create false invalidation.
10. Stable IDs are used throughout the propagation path.
```

## G04 Acceptance

G04 can close only when:

```text
false negatives = 0
false positives = 0 for the canonical G04 fixture
canonical selective propagation observed
no blanket invalidation introduced
focused tests PASS
G04 harness PASS
```

---

# 5. FG-002 — G01 Canonical Regression

## Current Result

```text
Collected: 1062
Passed:    1043
Failed:    18
Skipped:   1
Errors:    0
```

The report identifies:

```text
1 failure:
test_phase03d_export_workbench.py
→ test expects STALE
→ actual canonical project is FRESH

17 failures:
test_phase06_twogate_closure.py
test_phase05_closure.py
→ depend on real Windows Narrator / headed-browser evidence artifacts
→ e.g. sr_human.json and related browser evidence
```

## Required Rule

Do not assume all 18 are product bugs.

Every failure must first be classified as exactly one of:

```text
PRODUCT_REGRESSION
STALE_TEST_ASSUMPTION
MISSING_REQUIRED_EVIDENCE
TEST_INFRA_FAILURE
HARNESS_DEFECT
```

Create a matrix:

```markdown
| Test | Failure | Classification | Root cause | Correct owner | Fix | Evidence |
|---|---|---|---|---|---|---|
```

## 5.1 Phase 3D STALE vs FRESH Failure

Investigate why the test requires STALE while the current canonical project is legitimately FRESH.

Check:

```text
test fixture setup
canonical project state
readiness calculation
veo readiness
dependency hashes
historical Phase 3D contract
latest Phase 3D/Phase 9 behavior
```

### Corrective Rule

If current product behavior is correct and the test encodes an obsolete historical assumption:

- update the test fixture/expectation to the current canonical contract;
- document why this is a stale-test correction;
- do not mutate production behavior back to an obsolete state.

If product behavior is incorrect:

- fix the product root cause;
- preserve the current canonical contract.

## 5.2 Narrator / Browser Evidence Failures

For the 17 evidence-dependent tests:

1. Determine whether each test is:
   - a normal automated regression test, or
   - a historical closure/evidence assertion that requires external human evidence.

2. Verify whether required evidence exists in the current validation workspace.

3. Do not synthesize or fake `sr_human.json`.

4. If the evidence is genuinely required:
   - capture it through the approved real/manual process;
   - store it at the exact canonical location expected by current governance.

5. If a historical test incorrectly assumes ignored/transient evidence must always exist in every repo clone:
   - redesign the test to validate the correct governance contract;
   - preserve evidence integrity requirements;
   - document the change.

6. If headed CDP instability is the cause:
   - classify as test infrastructure;
   - rerun using the approved browser runtime;
   - do not convert an infrastructure failure into product success.

## G01 Acceptance

The canonical regression must finish with:

```text
0 failed
0 errors
```

Also record:

```text
total collected
passed
skipped
duration
environment
Git HEAD
```

Do not hard-code `1062` as the future expected count if legitimate corrective tests increase the suite.

Any unexplained reduction in collected test count must be treated as a failure.

---

# 6. FG-003 — G11 Render Manifest Verification

## Problem

The independent G11 harness expects an approved/accepted asset to be represented through `intake_ledger.json`, while its validation fixture places the asset under `references/`.

This causes validation blockers such as:

```text
PATH_SANDBOX_AND_PRESENCE
ACCEPTED_ASSET_INTEGRITY
```

At the same time, integrated G02 manifest compilation succeeds.

## Important

Do not immediately modify production code.

First determine whether the mismatch belongs to:

```text
A. product contract
B. G11 validation fixture
C. independent harness
D. asset intake lifecycle setup
```

## Investigation Scope

Inspect:

```text
studio/asset_intake.py
studio/asset_registry.py
studio/timeline_compiler.py
studio/render_manifest.py
studio/render_manifest_validation.py
scripts/final_validation/run_g11_manifest.py
G11 fixture preparation
G02 working fixture preparation
intake_ledger.json
references/
registry/accepted asset state
```

Compare the exact lifecycle used by G02 vs G11.

## Required Decision

### If product contract is correct and G11 fixture bypasses intake lifecycle

Fix the validation harness/fixture:

```text
fixture asset
→ proper intake
→ registry/lifecycle state
→ approved/accepted
→ manifest compilation
→ validation
```

Do not weaken production validation.

### If production incorrectly rejects a valid canonical accepted asset

Fix production with a focused regression test proving the intended accepted-asset lifecycle.

### If `references/` is not a canonical accepted-asset source

Do not make it one just to satisfy G11.

## Required Tests

Prove:

```text
accepted asset provenance is valid
path containment remains enforced
checksum/integrity remains enforced
rejected/unaccepted asset remains blocked
path traversal remains blocked
G02 contract remains green
G11 independent verification becomes green
```

## G11 Acceptance

```text
G11 PASS
no validation threshold relaxation
no sandbox bypass
no integrity bypass
G02 remains PASS
```

---

# 7. FG-004 — G09 / Phase 5 CDP Infrastructure Observation

## Current Observation

Some headed browser/virtualization scripts experienced CDP websocket disconnects.

This was recorded as:

```text
FG_TEST_INFRA_FAILURE
```

and is not currently a Final Gate hard blocker.

## Improvement Scope

Investigate only after P0/P1 blockers are closed.

Check:

```text
browser process ownership
duplicate Chrome/Edge instances
CDP port lifecycle
websocket timeout/reconnect handling
profile directory ownership
headed test startup/shutdown
service readiness before browser attach
```

## Requirements

- Do not hide genuine browser failures through unlimited retries.
- Retry must be bounded and only for clearly classified infrastructure disconnects.
- Product JS/console/runtime errors must remain failures.
- Preserve real browser evidence.

## Acceptance

Record whether FG-004 is:

```text
RESOLVED
or
KNOWN NON-BLOCKING INFRASTRUCTURE LIMITATION
```

with evidence.

---

# 8. Corrective Validation Sequence

After implementation:

## Stage A — Focused Verification

Run focused suites for:

```text
dependency graph / script mutation
Phase 3D readiness
Phase 5 closure/evidence
Phase 6 accessibility evidence
asset intake / registry
timeline compiler
render manifest validation
```

All touched focused suites must pass.

## Stage B — Rerun Failed Final Gates

Rerun:

```text
G04
G01
G11
```

in that order unless the current Final Gate harness requires another dependency-safe order.

Required result:

```text
G04 PASS
G01 PASS
G11 PASS
```

## Stage C — Regression of Previously Passing Critical Gates

At minimum revalidate no regression in:

```text
G02
G03
G05
G06
G10
G12
G13
```

Use existing immutable/corrective-rerun evidence rules.

## Stage D — Full Canonical Regression

Run the current canonical regression command.

Acceptance:

```text
0 failed
0 errors
no unexplained test-count reduction
```

## Stage E — Browser / Runtime Safety

Recheck relevant browser paths and runtime safety if touched code can affect UI/runtime state.

---

# 9. Data Integrity Requirements

After corrective work verify:

```text
canonical 79 Scenes preserved
canonical 141 Shots preserved
stable IDs preserved
source media preserved
accepted asset lifecycle preserved
render-manifest history preserved
Render QA history preserved
locks/revisions preserved
no unintended project mutation
```

Any canonical test clone created by the Final Gate may be disposable, but do not mutate/delete the canonical source project without an explicit approved reason.

---

# 10. Required Evidence

Save corrective evidence separately from Pass 1 evidence.

Recommended root:

```text
temp/final_system_validation/corrective_closure/
```

Suggested structure:

```text
corrective_closure/
├── baseline/
├── fg001_g04/
├── fg002_g01/
├── fg003_g11/
├── fg004_infra/
├── regression/
├── browser/
├── data_integrity/
└── final_summary/
```

Do not overwrite Pass 1 evidence.

---

# 11. Required Final Report

Create:

```text
docs/implementation/FINAL_SYSTEM_GATE_CORRECTIVE_CLOSURE_REPORT.md
```

Required sections:

```text
1. Executive Summary
2. Original Pass 1 Verdict
3. Git / Environment Baseline
4. FG-001 Root Cause
5. FG-001 Corrective Implementation
6. G04 Verification
7. FG-002 Failure Classification Matrix
8. Phase 3D Regression Correction
9. Narrator / Browser Evidence Resolution
10. G01 Full Regression Result
11. FG-003 Root Cause
12. G11 Corrective Resolution
13. G02/G11 Contract Comparison
14. FG-004 Infrastructure Observation
15. Focused Test Results
16. Failed-Gate Rerun Results
17. Previously-Passing Gate Regression Check
18. Full Canonical Regression
19. Browser / Runtime Verification
20. Data Integrity
21. Files Modified
22. Tests Added / Modified
23. Remaining Limitations
24. Final Gate Matrix
25. Final Candidate Verdict
```

---

# 12. Final Gate Matrix Requirement

Report all gates:

```text
G01
G02
G03
G04
G05
G06
G07
G08
G09
G10
G11
G12
G13
```

No gate may inherit PASS solely from assumption if touched corrective code can affect it.

---

# 13. PASS / FAIL Conditions

## Corrective Closure PASS candidate

Only when:

```text
FG-001 CLOSED
FG-002 CLOSED
FG-003 CLOSED
G01 PASS
G04 PASS
G11 PASS
0 full-regression failures
0 full-regression errors
no unexplained test-count reduction
canonical data integrity preserved
previous critical passing gates remain valid
```

Then candidate may be submitted for final/external review.

## Corrective Closure FAIL

Any of:

```text
G01 still fails
G04 still has false-negative/false-positive propagation
G11 remains unresolved
tests were weakened/deleted to obtain green
validation thresholds were relaxed
evidence was fabricated
canonical data was corrupted
new critical regression introduced
```

---

# 14. STOP Conditions

STOP immediately and report instead of continuing if:

```text
current repository baseline does not match expected Final Gate branch/history
canonical project is missing/corrupt
a proposed fix requires weakening a product safety contract
root cause cannot be distinguished from harness behavior
required real human/browser evidence cannot be obtained honestly
destructive action against canonical data becomes necessary
```

Do not silently improvise around these conditions.

---

# 15. Final Expected Outcome

Target state:

```text
Final System Gate
G01 PASS
G02 PASS
G03 PASS
G04 PASS
G05 PASS
G06 PASS
G07 PASS
G08 PASS
G09 PASS
G10 PASS
G11 PASS
G12 PASS
G13 PASS

Full canonical regression:
0 failed
0 errors

Candidate verdict:
ready for final/external review
```

After producing the corrective closure report:

```text
STOP
```

Do not start unrelated cleanup or product work automatically.
