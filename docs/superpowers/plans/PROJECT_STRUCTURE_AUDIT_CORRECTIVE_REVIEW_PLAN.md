# PROJECT STRUCTURE AUDIT — CORRECTIVE REVIEW PLAN

> **Project:** UnfoldIQ Workstation  
> **Input report:** `PROJECT_STRUCTURE_AUDIT.md`  
> **Current stage:** Stage 1 — `READ_ONLY_AUDIT`  
> **Purpose:** Correct documentation/classification gaps in the Stage 1 audit before any Stage 2 destructive cleanup or source modification is authorized.  
> **Important:** This corrective task remains **READ ONLY** with respect to product source and repository data.

---

# 1. Current Review Verdict

The submitted Stage 1 audit is substantially complete, but **not yet 100% compliant** with the Master Cleanup Spec.

Do **not** authorize Stage 2 yet.

The following items must be corrected in `PROJECT_STRUCTURE_AUDIT.md`:

```text
AUDIT-001 — Runtime/Python version inconsistency
AUDIT-002 — Final-system evidence directory over-broad SAFE_TO_DELETE classification
AUDIT-003 — Proposed wildcard deletion commands conflict with cleanup safety contract
AUDIT-004 — "Zero risk" wording is not defensible for destructive commands without revalidation
```

No product source fix is required.

---

# 2. Hard Constraints

During this corrective pass:

```text
NO delete
NO move
NO rename
NO source modification
NO config modification
NO dependency modification
NO cleanup execution
NO Stage 2 implementation
```

Allowed modification:

```text
PROJECT_STRUCTURE_AUDIT.md
```

Do not modify product/runtime data.

---

# 3. AUDIT-001 — Correct Runtime / Python Version

## Finding

The audit currently describes the workstation runtime as:

```text
Python 3.10/3.11
```

However, the latest independently verified Final System Gate environment records:

```text
Python 3.12.10
```

## Required correction

Update Project Overview to distinguish:

```text
Current verified runtime: Python 3.12.10.
```

If additional supported versions are intentionally documented, list them only when supported by current config/tests/docs.

## Acceptance

```text
[ ] Current Python runtime matches latest verified environment evidence.
[ ] Historical/supported versions are not conflated with the active verified runtime.
```

---

# 4. AUDIT-002 — Reclassify `temp/final_system_validation/`

## Finding

The report currently classifies the entire:

```text
temp/final_system_validation/
```

as:

```text
SAFE_TO_DELETE
```

with rationale focused on disposable validation output.

This directory contains Final System Gate evidence across multiple gates/reruns, including corrective and external-review artifacts.

## Required action

Perform a targeted **read-only metadata inventory** of:

```text
temp/final_system_validation/
```

Classify contents by logical group, for example:

```text
DISPOSABLE_GENERATED_MEDIA
DISPOSABLE_EXPORT_PACKAGE
GATE_RESULT_EVIDENCE
CORRECTIVE_EVIDENCE
EXTERNAL_REVIEW_EVIDENCE
OTHER / REVIEW_REQUIRED
```

Do not classify the whole directory `SAFE_TO_DELETE` unless every contained class independently meets the deletion criteria.

Recommended default before MVP release baseline is frozen:

```text
raw generated media/package artifacts
→ SAFE_TO_DELETE where proven

Final Gate result/evidence JSON and external review evidence
→ REVIEW_REQUIRED or PROTECTED_UNTIL_RELEASE_BASELINE
```

## Acceptance

```text
[ ] No mixed evidence directory is deleted as one broad category without classification.
[ ] External-review evidence provenance remains defensible.
[ ] Final authored reports remain protected.
```

---

# 5. AUDIT-003 — Replace Broad Wildcard Delete Proposals

## Finding

The Stage 1 report proposes commands such as:

```powershell
Remove-Item -Path "temp\browser_profile_*", "temp\p6tg_*", ... -Recurse -Force
```

The Master Cleanup Spec prohibits broad wildcard/name-based deletion as the operational cleanup mechanism.

## Required correction

Replace wildcard deletion proposals with a safe execution model:

```text
1. Enumerate exact candidates.
2. Resolve canonical full path.
3. Verify descendant of repository root.
4. Verify classification = SAFE_TO_DELETE.
5. Verify current preview/fingerprint.
6. Verify no active job/process ownership.
7. Delete exact paths only.
```

Prefer an explicit approved path list and `-LiteralPath`, or the server-side cleanup preview + confirmed execution API.

Example pattern:

```powershell
$approved = @(
  "D:\Project\UnfoldIQ\temp\<exact-profile-1>",
  "D:\Project\UnfoldIQ\temp\<exact-profile-2>"
)

foreach ($path in $approved) {
    Remove-Item -LiteralPath $path -Recurse -Force
}
```

The exact executable allowlist must come from the current validated preview.

## Acceptance

```text
[ ] Operational cleanup no longer depends on wildcard/name pattern deletion.
[ ] Exact allowlist or validated cleanup API is authoritative.
```

---

# 6. AUDIT-004 — Correct Risk Language

## Finding

The audit labels some destructive cleanup commands as:

```text
Risk: Zero risk
```

No destructive filesystem action should be described as unconditional zero-risk before fresh validation.

## Required correction

Use:

```text
LOW — safe only after current preview/revalidation and active-ownership checks
```

or equivalent.

For runtime/browser profile folders explicitly require:

```text
skip/reject if actively owned or locked
```

## Acceptance

```text
[ ] No destructive command is described as unconditional zero-risk.
[ ] Risk wording reflects Stage 2 ownership/revalidation requirements.
```

---

# 7. Revalidate Existing Good Findings

Retain and confirm supported classifications:

```text
SAFE_TO_DELETE:
- verified stale CDP profiles, after exact-path/ownership validation
- verified Phase 4 benchmark output
- exact duplicate accidental projects
- known test project fixtures
- docs.zip if redundant archive is confirmed
- .pytest_cache

DO_NOT_DELETE:
- upstream/
- models/
- transcription/
- studio/
- tests/
- scripts/
- docs/
- config/
- .agents/
- .git/
- launcher scripts
- pytest.ini
- README.md
- .gitignore
```

Keep the canonical demo project and its backup `REVIEW_REQUIRED` until Stage 2 authorization and ownership checks.

---

# 8. Corrected Stage 1 Verdict

The report may state:

```text
STAGE 1 AUDIT COMPLETE — PASS
```

only if:

```text
[ ] Runtime metadata is accurate.
[ ] Mixed Final Gate evidence is classified safely.
[ ] Wildcard deletion is not the authoritative execution method.
[ ] Destructive actions are not labeled unconditional zero-risk.
[ ] Stage 1 remained read-only.
[ ] No repository content was deleted/moved/renamed.
[ ] No source/config/dependency was modified.
[ ] Protected paths remain protected.
[ ] Stage 2 is still NOT EXECUTED.
```

---

# 9. Required Output

Update:

```text
PROJECT_STRUCTURE_AUDIT.md
```

At the end return:

```text
Stage 1 corrective review: COMPLETE / INCOMPLETE
Stage 1 final verdict: PASS / FAIL
Repository modifications outside audit report: NONE
Stage 2 executed: NO
```

If PASS:

```text
STOP
```

Wait for explicit Stage 2 authorization.

---

# 10. STOP Conditions

STOP and report instead of guessing if:

```text
current validated Python runtime cannot be established
Final Gate evidence ownership/preservation policy is ambiguous
an evidence directory contains unknown user/source data
exact cleanup candidates cannot be resolved safely
repository state changed materially during the corrective audit
```

Do not delete anything to resolve an audit ambiguity.
