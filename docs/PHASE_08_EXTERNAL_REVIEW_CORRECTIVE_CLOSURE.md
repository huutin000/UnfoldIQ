# PHASE 8 — EXTERNAL REVIEW CORRECTIVE CLOSURE

Phase 8 implementation has completed, but external review does **NOT** authorize `PASS / FINAL / VERIFIED` yet.

Do not implement Phase 9.

Do not rewrite Phase 8 from scratch.

Read and obey, in this priority order:

1. Approved Phase 8 Design Spec
2. Approved Phase 8 Implementation Plan
3. Current source code
4. `PHASE_08_IMPLEMENTATION_REPORT.md`
5. This corrective closure

The current verdict remains:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
PHASE 9: NOT STARTED
```

## 1. Remove unauthorized loudness mastering

External review found the implementation report explicitly states:

```text
final master normalization (loudnorm)
```

This conflicts with the approved Phase 8 design.

Phase 8 must NOT introduce:

```text
loudnorm
global loudness mastering
LUFS mastering
implicit final-master normalization
```

The approved audio contract is:

```text
Narration → direct voice mix
Narration → sidechain control

BGM
→ manifest volume
→ fade
→ sidechaincompress controlled by narration

Narration + ducked BGM
→ amix
```

Use explicit mix semantics:

```text
duration=first
dropout_transition=0
normalize=0
```

Narration must not be passed through `sidechaincompress`.

After fixing, add/adjust focused tests proving:

```text
"loudnorm" not in Phase 8 product render graph
"sidechaincompress" affects BGM path
narration direct path remains intact
"normalize=0" is explicit
```

Do not alter Phase 9.

---

## 2. Audit and correct Windows cancellation semantics

The implementation report states that running cancellation uses `SIGTERM`.

Audit `studio/ffmpeg_process_runner.py`.

Approved Windows contract:

```text
CREATE_NEW_PROCESS_GROUP
→ send CTRL_BREAK_EVENT
→ wait bounded grace duration
→ if still alive, force terminate process/process tree
→ await confirmed process exit
→ no publish
→ release all permits
```

Do not use Windows SIGTERM/terminate as the initial graceful cancellation mechanism.

If source already follows the approved contract and only the report wording is wrong, correct the report and provide source/test evidence.

Add/adjust focused test proving the Windows branch selects `CTRL_BREAK_EVENT` before force termination.

---

## 3. Prove global Final Render concurrency = 1

Audit `ManifestRenderService`.

Required distinction:

```text
GLOBAL:
FINAL_RENDER concurrency = 1 across all projects

IDEMPOTENCY:
same projectId + exportId must not create a duplicate active job
```

Add a test with two different projects/exports:

```text
Project A / export A is rendering
Project B / export B requests Final
→ B does not execute concurrently
```

The global Final gate must remain held across NVENC → CPU fallback.

Do not replace the global gate with a per-project-only lock.

---

## 4. Prove final artifact lifecycle boundary

After successful Phase 8 publication, prove:

```text
RenderJob.status = COMPLETED

Artifact.status = NEEDS_REVIEW
reasonCode = PENDING_RENDER_QA

Artifact.status != READY
```

Use the existing artifact-status authority.

Do not create a new `PENDING_QA` enum or a second artifact-state store.

Add focused regression coverage.

---

## 5. Prove Render Metadata provenance

For successful render verify:

```text
exports/<exportId>/
├── render-manifest.json
├── final.mp4
└── render-metadata.json
```

`render-metadata.json` must contain at least:

```text
jobId
projectId
exportId
manifestHash
FFmpeg version
encoderProfileRequested
encoderActuallyUsed
encoderProfileVersion
fallbackAttempted / attempt history
expectedFrames
subtitleMode
completedAt
```

It is provenance only, not mutable job state.

Prove safe-write behavior.

---

## 6. Run 250 / 500 Shot scale gate

Build deterministic manifests with:

```text
250 shots
500 shots
```

Prove:

```text
planner completes
graph builder completes
filter graph is written to file/script
argv length remains bounded
no giant inline Windows filter graph
```

A real 500-shot encode is not required.

Record timing and evidence.

---

## 7. Encoder profile provenance

Current report states:

```text
FINAL_QUALITY_V1 = libx264 CRF18 slow
ACCELERATED_V1   = h264_nvenc p5 CQ20
```

Document exactly:

```text
what Final libx264 production profile existed before Phase 8
why FINAL_QUALITY_V1 uses CRF18/slow

Phase 4 accelerated baseline = p4/CQ28
why Phase 8 selected p5/CQ20
benchmark/runtime evidence supporting the change
```

Do not change profile merely to match historical values if the new profile is evidence-backed.

Do not claim CRF and CQ values are equivalent.

---

## 8. Run mandatory scope audit

Run:

```powershell
rg -n "blackdetect|freezedetect|silencedetect|render_qa_report|Phase 9|Remotion|YouTube upload|smart crop|loudnorm" studio tests
```

Verify Phase 8 product source does not introduce:

```text
Phase 9 QA
black/freeze/silence QA
loudness mastering
Remotion
YouTube publishing
smart crop
Agent Integration
```

Allowed matches must be individually explained.

Verify Draft path still uses the legacy renderer.

---

## 9. Run data-integrity gate

Before corrective runtime testing, hash protected project/reference data:

```text
script
audio master
timestamps
Scene Plan
Visual Bible
Veo Prompts
Asset Registry
Phase 7 render-manifest snapshots
```

After all tests re-hash.

Write:

```text
temp/phase08_verification/integrity/reference_hashes_before.json
temp/phase08_verification/integrity/reference_hashes_after.json
temp/phase08_verification/integrity/result.json
```

Expected:

```text
all protected hashes identical
```

Generated Phase 8 fixture Finals/metadata must be listed separately.

---

## 10. Verify upstream integrity

Run:

```powershell
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" rev-parse HEAD
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" describe --tags --exact-match
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" status --short
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" diff --stat
```

Compare against the currently approved upstream baseline.

Do not reset or modify upstream to force a result.

---

## 11. Run complete Phase 8 verification again

Run focused Phase 8 suite.

Run nearby Phase 7 / Phase 4 / Phase 3D / persistent-job-resource regressions.

Then run the mandatory full repository regression:

```powershell
python -m pytest --tb=short -q
```

Required:

```text
0 failed
0 errors
```

Do not disable or weaken tests.

---

## 12. Rewrite the implementation report to the approved structure

Update:

```text
docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md
```

The report must include dedicated sections for:

```text
Approved Design Decisions
Git/Baseline
Manifest-only boundary
Integrity verification
Execution Plan architecture
Visual normalization
CUT/CROSSFADE
Frame accuracy
Narration/BGM/Ducking
Audio alignment
Subtitle modes
Encoder profiles
Benchmark
Failure classifier
Hardware-only fallback
Process/progress/cancellation
Persistent jobs
Resource scheduling
Crash recovery
Strict no-overwrite
Canonical per-export Final
Render metadata/provenance
API contract
UI integration
Real FFmpeg E2E
250/500 Shot scale
Focused tests
Nearby regression
Full regression
Data integrity
Upstream integrity
Scope audit
Known limitations
Final gate matrix
Final verdict
```

Include all gates A–AP from the approved Implementation Plan.

Do not mark any gate PASS without evidence.

---

## 13. Final verdict

If and only if every mandatory Phase 8 gate passes, end with:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

Do NOT self-promote to:

```text
PASS / FINAL / VERIFIED
```

External review owns that decision.

After writing the corrected report:

```text
STOP
```

Do not start Phase 9.
