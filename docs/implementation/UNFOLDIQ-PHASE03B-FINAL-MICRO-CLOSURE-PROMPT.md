# UNFOLDIQ — SUBPHASE 3B FINAL MICRO-CLOSURE PROMPT
## Close Git checkpoint, scheduler call-graph, final evidence mapping, and roadmap governance before 3C

> **Task type:** FINAL TARGETED VERIFY / FIX 3B ONLY
>
> **Current final report:** `docs/implementation/PHASE_03B_FINAL_VERIFICATION_REPORT.md`
>
> **Current claimed regression:** `507 / 507 PASS`
>
> **Do NOT start Subphase 3C.**
>
> **Do NOT redesign Visual Workbench.**
>
> This is a narrow micro-closure. Most 3B technical gates are already accepted. Only the items below remain to be proven/fixed.

---

# 0. Operating Rules

Mandatory flow:

```text
INSPECT ACTUAL GIT + SOURCE + EXISTING EVIDENCE
→ VERIFY THE REMAINING GAPS
→ FIX ONLY REAL DEFECTS
→ ADD TARGETED TESTS ONLY IF REQUIRED
→ FULL REGRESSION IF SOURCE/TESTS CHANGE
→ SYNC REPORT/ROADMAP
→ STOP
```

Do not:
- rewrite Voice Workbench;
- start 3C;
- alter Visual/Export;
- fabricate evidence;
- use `git clean -fd`.

---

# 1. Gate A — Repair the `pre-phase-3b` Checkpoint Contract

## Current contradiction

The final report states:

```text
pre-phase-3a = c1fa0ab
pre-phase-3b = c1fa0ab
HEAD         = c1fa0ab
```

But Subphase 3A introduced approved source changes.

Therefore a tag/reference that still points to the same pre-3A commit cannot by itself be a committed snapshot of the approved 3A final state.

A valid Phase 3B rollback checkpoint must represent:

```text
APPROVED 3A FINAL STATE
+
NO 3B CHANGES
```

## Required inspection

Run:

```bash
git rev-parse pre-phase-3a
git rev-parse pre-phase-3b
git rev-parse HEAD
git status --short
git diff --stat
git diff --cached --stat
git log --oneline --decorate -n 30
git show --stat --oneline pre-phase-3a
git show --stat --oneline pre-phase-3b
```

Determine exactly where the approved 3A source lives:

```text
committed in Git
or
only in working tree
```

## Required correction

### If 3A was never committed

Create a safe commit/checkpoint containing the approved **3A final state only**, then establish a real pre-3B checkpoint from it.

Do not accidentally include unreviewed 3B code in the 3A checkpoint.

If separation is difficult because 3A and 3B changes are mixed in one working tree:
- inspect the diff;
- use targeted staging/restoration;
- document provenance;
- do not use destructive broad cleanup.

### If 3A is committed elsewhere

Point/document `pre-phase-3b` to the actual approved 3A final commit.

Do not silently rewrite historical refs without documenting:
- old target;
- new target;
- reason.

## Acceptance

The following must be demonstrably true:

```text
checkout pre-phase-3b
→ gives approved 3A final code
→ contains no 3B implementation
```

Evidence:

```text
temp/phase03b_micro_closure/git/
├── checkpoint_audit.md
└── checkpoint_diff_summary.txt
```

---

# 2. Gate B — Prove TTS/STT Compute Actually Goes Through LocalResourceScheduler

## Current report gap

The final provider call graph currently ends approximately as:

```text
TTS:
route
→ implementation
→ KokoroTTSProvider.synthesize_chunk
→ cache/stitch/commit

STT:
route
→ WhisperSTTProvider.transcribe
→ timestamps
```

But the canonical 3B architecture also requires expensive local AI compute to respect:

```text
LocalResourceScheduler
ResourceGuard
```

The final report currently does not surface `LocalResourceScheduler` in either call graph.

## Required source trace

Inspect the actual active production path.

### TTS

Verify:

```text
Voice action
→ API/service
→ LocalResourceScheduler / scheduler submission
→ TTSProvider / KokoroTTSProvider
→ candidate output
→ commit
```

or the equivalent ordering actually used by the current architecture.

### STT

Verify:

```text
Alignment action
→ API/service
→ LocalResourceScheduler / scheduler submission
→ STTProvider / WhisperSTTProvider
→ candidate timestamps
→ commit
```

## Acceptance

- [ ] No production Kokoro execution bypasses the scheduler where the architecture requires `CUDA_HEAVY`.
- [ ] No production Faster-Whisper execution bypasses the scheduler where the architecture requires `CUDA_HEAVY`.
- [ ] Frontend does not hard-code concurrency.
- [ ] Queue/job status is produced by the same scheduler/job system already established in Phase 2.
- [ ] Existing real-engine scheduler evidence remains valid.

If the provider is intentionally invoked *inside* a scheduler worker/callback, document that clearly in the call graph.

If a real bypass exists, fix only that bypass.

Evidence:

```text
temp/phase03b_micro_closure/scheduler/
├── tts_scheduler_callgraph.md
├── stt_scheduler_callgraph.md
└── scheduler_path_results.json
```

---

# 3. Gate C — Surface Job State vs Artifact State Evidence

The previous closure prompt required:

```text
Job state:
QUEUED / RUNNING / COMPLETED / FAILED / CANCELLED

Artifact state:
DRAFT / NEEDS_REVIEW / READY / OUTDATED / BLOCKED
```

to remain separate.

The final evidence tree already references:

```text
temp/phase03b_final_verification/job_artifact_state/state_matrix.md
```

but the final report does not surface or summarize it.

## Required action

Read the existing evidence and add a concise section to the final report.

Explicitly demonstrate at least:

```text
artifact = OUTDATED
job = QUEUED
```

and:

```text
old artifact = READY
replacement job = FAILED
old committed artifact remains READY
```

Do not change code if evidence already proves this.

---

# 4. Gate D — Surface the Full Data-Integrity Matrix

## Current report gap

The final report summarizes only a subset:

```text
script.txt
metadata.json
audio.wav
timestamps.json
transcription_raw.json
```

The required 3B integrity contract is broader.

## Required action

Read:

```text
temp/phase03b_final_verification/integrity/integrity_matrix.md
temp/phase03b_final_verification/integrity/semantic_diff.json
```

Surface the actual PASS/FAIL matrix for:

```text
Script
Story Beats
Audio Chunks
Voice settings
Master narration
Chunk audio references
Transcript
Timestamps
Word cues
Pronunciation data
Voice QA data
79 Scenes
141 Shots
Visual Bible
Image prompts
Motion/Veo prompts
Negative prompts
Asset references
Project settings
Stable IDs
Parent-child relationships
state.db
Revision history
Lock states
unknown/legacy fields
```

Expected:

```text
0 unintended semantic differences
```

If an item is absent from the fixture, mark it honestly as:

```text
N/A — not present in reference fixture
```

and use an isolated preservation fixture where the Phase 1/2 preservation contract requires it.

Do not claim “100% untouched” without the matrix supporting it.

---

# 5. Gate E — Restore the Original Gate Mapping O / P

## Current report mismatch

The final verification prompt defined:

```text
Gate O = Browser / API / Language / Compatibility Closure
Gate P = Roadmap Governance
```

But the produced report currently maps:

```text
Gate O = evidence directory structure
Gate P = full regression
```

Directory structure and regression are useful, but they must not replace the originally requested closure gates.

## Required correction

Use the canonical final mapping:

```text
Gate O
→ Browser / API / Language / Compatibility Closure

Gate P
→ Roadmap Governance
```

Regression remains a required global gate/section, but does not replace Gate P.

Evidence-directory completeness may remain a supporting section.

---

# 6. Gate O — Browser / API / Language / Compatibility Closure

Surface the existing browser evidence and explicitly state:

```text
1920x1080 PASS
1440x900 PASS
1366x768 PASS

unexpected console errors = 0
unhandled promise rejections = 0
unexpected failed API requests = 0
```

Verify canonical frontend dependency:

```text
GET /api/projects/{id}/v2/voice
```

If:

```text
GET /api/projects/{id}/voice
```

still exists, document it as compatibility alias only.

Verify:

```text
Tổng quan still works
Kịch bản still works
Hình ảnh & Cảnh compatibility remains reachable
Xuất video compatibility remains reachable
```

Language:

```text
UI = Vietnamese-first
narration/transcript = original project language
no automatic localization/translation
```

Use existing evidence if already present; do not rerun browser automation unnecessarily.

---

# 7. Gate P — Roadmap Governance

## Current issue

`ROADMAP_STATUS.md` already states:

```text
3B = PASS / FINAL / VERIFIED
3C = READY TO START
```

before the external review has accepted the final closure.

The roadmap itself states:

```text
Code
→ Unit Tests
→ Regression
→ Report
→ Review Gate PASS
→ next phase
```

## Required governance state during this task

Until this micro-closure is externally accepted, canonical status should be:

```text
3B = IMPLEMENTED / REVIEW PENDING
3C = NOT STARTED
```

or an equivalent status that does not claim the next gate is already authorized.

After the micro-closure itself proves every remaining item, the **report may recommend**:

```text
3B = PASS / FINAL
3C = READY TO START
```

but do not begin 3C.

If project governance intentionally allows the implementation task itself to be the review authority, document that policy change explicitly in the roadmap. Do not silently contradict the existing discipline.

---

# 8. Minor Accessibility Documentation Cleanup — Non-Blocking Unless Runtime Defect Exists

Current report says native range controls have both:

```text
<label for="...">
and
aria-label="..."
```

For native inputs, prefer the visible/native label as the accessible name.

If `aria-label` merely duplicates and overrides the visible label:
- remove the redundant attribute;
- or justify why it is necessary.

Do not redesign the control if current accessible naming is already correct.

This is a minor cleanup, not a reason to reopen 3B by itself.

---

# 9. Regression

If production source/tests change:

```bash
pytest --tb=short -q
```

Current baseline:

```text
507 / 507 PASS
0 failed
0 errors
```

Acceptance:

```text
100% canonical collected tests PASS
0 failed
0 errors
```

Any unexplained decrease below 507 is a blocker.

If only Git checkpoint metadata/docs/evidence change:
- do not invent a new test count;
- retain 507/507 as the latest actual regression.

---

# 10. Required Final Micro-Closure Report

Create:

```text
docs/implementation/PHASE_03B_MICRO_CLOSURE_REPORT.md
```

Required sections:

```text
1. Git Checkpoint Resolution
2. TTS Scheduler Call Graph
3. STT Scheduler Call Graph
4. Job State vs Artifact State
5. Full Data Integrity Matrix
6. Browser / API / Language / Compatibility (Gate O)
7. Roadmap Governance (Gate P)
8. Regression Status
9. Scope Audit
10. Final Verdict
```

---

# 11. Final Verdict

Only conclude:

```text
SUBPHASE 3B: PASS / FINAL
READY FOR SUBPHASE 3C
```

when ALL are true:

- [ ] `pre-phase-3b` actually represents the approved 3A final state.
- [ ] The Git checkpoint is usable as a real rollback point.
- [ ] TTS compute respects `LocalResourceScheduler` / resource policy.
- [ ] STT compute respects `LocalResourceScheduler` / resource policy.
- [ ] Job state and artifact state separation is explicitly evidenced.
- [ ] Full 3B data-integrity matrix is surfaced and PASS.
- [ ] Gate O browser/API/language/compatibility is explicitly PASS.
- [ ] Gate P roadmap governance is explicitly PASS.
- [ ] Regression remains 100% PASS.
- [ ] 3C remains NOT STARTED during this task.
- [ ] No P0/P1 blocker remains.

Otherwise:

```text
SUBPHASE 3B: CONDITIONAL PASS
NOT READY FOR SUBPHASE 3C
```

with exact remaining blockers.

---

# 12. Stop

After the report:

```text
STOP
```

Do NOT start Subphase 3C automatically.
