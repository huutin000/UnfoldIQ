# FINAL SYSTEM GATE — EXTERNAL REVIEW & GOVERNANCE CLOSURE PLAN

> **Project:** UnfoldIQ Workstation  
> **Input report:** `FINAL_SYSTEM_GATE_CORRECTIVE_CLOSURE_REPORT.md`  
> **Purpose:** Close the remaining governance/review gap after the corrective report claims 13/13 gates PASS.  
> **Important:** This is **not** a new implementation phase and **not** Post-Final cleanup.  
> **Default mode:** Review/verification only. Do not modify product source unless the external review finds a real defect that requires a separately scoped corrective action.

---

## 1. Why This Closure Is Still Required

The corrective report claims:

```text
13 / 13 Final Gates PASS
1062 / 1062 regression PASS
Candidate Verdict = PRODUCTION READY
PASS / FINAL / VERIFIED
```

However, the approved Final Gate governance requires:

```text
candidate verdict
→ external review
→ only then final promotion
```

The corrective report does not contain a dedicated independent external-review result proving that this promotion occurred.

Therefore the current state should be treated as:

```text
TECHNICAL CORRECTIVE VALIDATION:
13 / 13 PASS according to the corrective report

GOVERNANCE:
EXTERNAL REVIEW STILL REQUIRED

FINAL / VERIFIED:
not independently confirmed yet
```

---

# 2. Scope

## In scope

- Review the corrective report and supporting evidence.
- Verify the fixes for FG-001, FG-002, FG-003, FG-004.
- Verify G01, G04 and G11 corrective reruns.
- Verify previously passing critical gates were not invalidated by corrective changes.
- Inspect current Git diff/status and reconcile it with the report.
- Check test/evidence changes for weakening, fabrication or stale assumptions.
- Review accessibility wording against the project’s established claim discipline.
- Produce an independent final review report.
- Update governance status only after review PASS.

## Out of scope

- Post-Final cleanup.
- New product features.
- New architecture.
- Timeline Editor / Web Preview.
- Refactors unrelated to corrective changes.
- Weakening test thresholds.
- Deleting tests/evidence.
- Committing/pushing unless explicitly authorized.

---

# 3. Required Inputs

The reviewer must have access to:

```text
FINAL_SYSTEM_GATE_CORRECTIVE_CLOSURE_REPORT.md
FINAL_SYSTEM_INTEGRATION_AND_PRODUCTION_VALIDATION_REPORT.md
Final Gate Design Spec
Final Gate Implementation Plan
FINAL_SYSTEM_GATE_CORRECTIVE_FIX_PLAN.md
current ROADMAP_STATUS.md
current real repository
current Git diff/status
temp/final_system_validation/**
```

If any required evidence referenced by the corrective report is missing, record it explicitly.

Do not reconstruct missing evidence from memory.

---

# 4. Baseline Verification

Run from the real repository:

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
git diff --check
```

Record:

```text
branch
HEAD
dirty/clean state
modified files
untracked files
diff stat
```

Important:

The corrective report lists multiple source/test modifications while the recorded Git HEAD remains the same baseline commit.

This is acceptable if the worktree is intentionally uncommitted, but the final review must explicitly confirm that:

```text
the modified worktree is the reviewed candidate
```

Do not mistake unchanged HEAD for unchanged source.

---

# 5. Review FG-001 / G04

Review:

```text
studio/dependency_graph.py
studio/script_service.py
scripts/final_validation/run_g04_dependency.py
associated dependency tests
G04 corrective result.json
```

Verify:

```text
[ ] canonical DAG update path is used
[ ] no second conflicting invalidation engine introduced
[ ] selective propagation remains selective
[ ] FP = 0
[ ] FN = 0
[ ] unrelated Scene/Shot nodes remain current
[ ] lock semantics remain intact
[ ] failed/uncommitted script mutation does not propagate
[ ] graph persistence is correct
```

Fresh verification should include the approved G04 corrective command.

Expected:

```text
G04 PASS
FP = 0
FN = 0
```

---

# 6. Review FG-002 / G01

Review every modified regression test listed in the corrective report.

For each changed test, classify the change as:

```text
VALID_STALE_ASSUMPTION_FIX
VALID_EVIDENCE_RESTORE
VALID_INFRA_CLASSIFICATION
TEST_WEAKENING
UNSUPPORTED_CHANGE
```

Pay special attention to:

```text
test_phase03d_export_workbench.py
test_phase05_closure.py
test_phase05_evidence_closure.py
test_phase05_performance_gate.py
test_phase06_final_closure.py
test_phase06_hardening.py
test_phase06_twogate_closure.py
test_phase07_final_closure.py
test_phase07_scale_and_governance.py
```

Required checks:

```text
[ ] no test deleted
[ ] no meaningful product assertion removed merely to obtain green
[ ] stale roadmap assumptions were updated to current governance
[ ] restored evidence corresponds to previously verified real evidence
[ ] no fabricated human/Narrator observations
[ ] browser ERR_ABORTED exception handling is narrowly scoped
[ ] legitimate JS/server failures still fail
```

Fresh canonical regression:

```powershell
py -3 scripts/final_validation/run_g01_regression.py --rerun external_review
```

Acceptance:

```text
0 failed
0 errors
no unexplained reduction in collected tests
```

---

# 7. Review FG-003 / G11

Review:

```text
studio/render_manifest.py
scripts/final_validation/run_g11_manifest.py
TimelineCompiler / RenderManifest consumers
G11 corrective evidence
```

Verify the new:

```text
expectedFinalFrames: int | None = None
```

does not create contradictory sources of truth.

The reviewer must answer:

```text
1. Who is canonical for expected final frame count?
2. Is expectedFinalFrames derived deterministically from the compiled timeline?
3. Can serialized expectedFinalFrames disagree with clip end frames?
4. If disagreement occurs, which value wins?
5. Is validation able to detect inconsistency rather than silently hiding it?
```

Required:

```text
[ ] G11 10/10 PASS
[ ] 141/141 clips validated
[ ] path sandbox remains enforced
[ ] accepted asset integrity remains enforced
[ ] lifecycle validation remains enforced
[ ] G02 behavior remains compatible
```

Do not accept a fallback that masks a malformed manifest.

---

# 8. Review FG-004 / Launcher Safety

Verify:

```text
start-unfoldiq-tts.bat
stop-unfoldiq-tts.bat
scripts/start-unfoldiq-tts.ps1
scripts/stop-unfoldiq-tts.ps1
tests/test_launcher_safety.py
```

Acceptance:

```text
launcher tests PASS
no broad Python process kill
PID ownership remains verified
unrelated processes remain protected
```

---

# 9. Evidence Integrity Review

Inspect referenced corrective evidence:

```text
temp/final_system_validation/regression/corrective_rerun_02/
temp/final_system_validation/dependency/corrective_rerun_01/
temp/final_system_validation/render_manifest/corrective_rerun_01/
```

Also inspect the evidence restored for Phase 5/6.

For each evidence family verify:

```text
[ ] path exists
[ ] timestamps/provenance are understandable
[ ] content matches the report
[ ] no evidence was silently overwritten
[ ] Pass 1 evidence remains preserved
[ ] corrective evidence is distinguishable from original evidence
```

Human-observation evidence must not be presented as newly observed if it was reconstructed from a historical approved report.

If restored historical evidence is used, label it clearly as:

```text
RESTORED FROM PREVIOUSLY VERIFIED EVIDENCE
```

not:

```text
NEW MANUAL OBSERVATION
```

---

# 10. Accessibility Claim Discipline

The project’s established wording is:

```text
WCAG 2.2 AA-Oriented Accessibility Hardening
```

Do not promote this to a formal claim such as:

```text
WCAG 2.2 AA compliant
WCAG 2.2 AA certified
formal WCAG 2.2 AA conformance
```

unless a complete WCAG conformance evaluation exists for the claimed scope.

Review the corrective report and roadmap for wording such as:

```text
Accessibility Hardening (WCAG 2.2 AA)
```

If that wording can be reasonably interpreted as formal conformance, change it to:

```text
WCAG 2.2 AA-Oriented Accessibility Hardening
```

This is documentation/governance correction only unless a real accessibility defect is found.

---

# 11. Previously Passing Critical Gates

Because corrective source changes touched:

```text
dependency graph
script service
render manifest
validation harness
tests
```

review whether they can affect previously passing gates.

At minimum confirm evidence/compatibility for:

```text
G02
G03
G05
G06
G10
G12
G13
```

Do not rerun expensive gates unnecessarily if immutable evidence plus change-impact analysis is sufficient and the approved Final Gate governance permits reuse.

If impact analysis cannot prove isolation, rerun the affected gate.

---

# 12. Independent Review Output

Create:

```text
docs/implementation/FINAL_SYSTEM_GATE_EXTERNAL_REVIEW_FINAL.md
```

Required sections:

```text
1. Review Scope
2. Inputs Reviewed
3. Git / Worktree State
4. FG-001 Review
5. FG-002 Review
6. Regression-Test Change Audit
7. Evidence Integrity Audit
8. FG-003 Review
9. RenderManifest Contract Review
10. FG-004 Review
11. Accessibility Claim Review
12. Previously Passing Gate Impact Analysis
13. Fresh Verification Results
14. Remaining Findings
15. Final Gate Matrix
16. Governance Verdict
```

---

# 13. Allowed Governance Verdicts

Exactly one:

```text
FINAL SYSTEM GATE — PASS / FINAL / VERIFIED
```

or:

```text
FINAL SYSTEM GATE — REVIEW FAILED
```

or:

```text
FINAL SYSTEM GATE — CONDITIONAL / REVIEW INCOMPLETE
```

---

# 14. PASS Conditions

External review may promote to:

```text
PASS / FINAL / VERIFIED
```

only if all are true:

```text
[ ] G01 corrective result independently verified
[ ] G04 corrective result independently verified
[ ] G11 corrective result independently verified
[ ] regression-test changes are not test weakening
[ ] restored evidence has valid provenance
[ ] no fabricated evidence
[ ] no unresolved Critical/Important finding
[ ] no unexplained test-count reduction
[ ] current Git/worktree candidate is clearly identified
[ ] previously passing critical contracts remain valid
[ ] accessibility wording follows established claim discipline
```

---

# 15. FAIL / CONDITIONAL Conditions

Do not promote to FINAL / VERIFIED if any of these remain:

```text
missing referenced evidence
unverifiable restored evidence
test weakening
manifest source-of-truth ambiguity
G04 propagation regression
G01 regression failure
G11 validation failure
critical prior-gate regression
candidate worktree cannot be identified
formal WCAG claim without supporting conformance evidence
```

---

# 16. If Review Finds a Real Defect

If the review finds a real product/test/harness defect:

```text
STOP review promotion
→ create a narrowly scoped corrective item
→ fix using TDD
→ rerun affected verification
→ rerun external review closure
```

Do not silently fix code inside the review and still call the same review independent.

---

# 17. Roadmap Promotion

Only after external review verdict:

```text
FINAL SYSTEM GATE — PASS / FINAL / VERIFIED
```

update:

```text
docs/implementation/ROADMAP_STATUS.md
```

to the final promoted status.

If the current roadmap already says `PASS / FINAL / VERIFIED` before external review is complete, treat that as premature governance state and correct it during review.

---

# 18. STOP

After the external review report and governance update:

```text
STOP
```

Do not automatically start cleanup or any next feature.
