# Final System Integration & Production Validation Gate — Design Specification

> **Project:** UnfoldIQ Workstation  
> **Document type:** Architectural Design Spec  
> **Date:** 2026-09-19  
> **Intended repository path:** `docs/superpowers/specs/2026-09-19-final-system-integration-production-validation-gate-design.md`  
> **Status:** DESIGN APPROVED IN CHAT — WRITTEN SPEC AWAITING USER REVIEW  
> **Scope boundary:** Final Quality Gate after Phase 9; **not Phase 10**.

---

## 1. Purpose

The Final System Integration & Production Validation Gate exists to answer one question:

> **Is UnfoldIQ Core stable enough to close MVP Core 1.0 on the validated local workstation/runtime configuration?**

The gate validates the complete production path:

```text
Story
→ Voice
→ Visual
→ Preflight
→ Export
→ Render Manifest
→ Final Render
→ Automated Render QA
→ final.mp4 READY
```

The gate is verification-first. It does not introduce new product features and does not expand the roadmap beyond the existing nine top-level phases.

A successful outcome allows the system to state:

```text
Phase 1–9 = PASS / FINAL / VERIFIED
Final System Gate = PRODUCTION READY / VERIFIED
MVP Core 1.0 = READY
```

Only after that boundary may post-MVP work such as YouTube Intelligence Layer v1, Agent/MCP integration, Google/Veo provider integration, multilingual expansion, or a future timeline editor begin.

---

## 2. Intent, Constraints, and Success Criteria

### 2.1 Intended outcome

The user wants a defensible production-readiness decision based on real execution evidence, not a summary of prior phase reports.

### 2.2 Product scope

The validated product is a local-first, solo-creator workstation running on the current target workstation/runtime configuration. This gate does not claim SaaS readiness, multi-user readiness, clean-machine distribution readiness, or universal hardware compatibility.

### 2.3 Core constraints

The Final Gate must preserve the following rules:

- exactly nine top-level phases remain in the roadmap;
- the Final Gate is not called Phase 10;
- one execution agent performs validation sequentially;
- Pass 1 is audit-only and may not silently fix product code;
- canonical project data is never mutated directly by destructive scenarios;
- evidence must be machine-verifiable where practical;
- existing production thresholds are preserved rather than relaxed to make the gate pass;
- external Google Flow/Veo generation is outside the deterministic core verdict;
- final promotion is owned by an external review, not by the execution agent.

### 2.4 Success criteria

The strongest verdict, `PRODUCTION READY`, requires:

```text
13 / 13 mandatory gates PASS
100% current canonical regression PASS
0 unresolved BLOCKER
0 data-integrity breach
0 scheduler safety failure
0 render hard failure
0 Render QA hard failure
all required evidence complete
```

The production-readiness claim must be scoped to the validated local workstation/runtime configuration.

---

## 3. Decisions Considered and Selected

### 3.1 Validation project strategy

**Selected:** use the fullest existing demo/reference project and freeze a canonical validation baseline.

Source project:

```text
projects/2026-09-12_210003_youtube-narration-01
```

The project already represents the required production-like scale:

```text
79 Scenes
141 Shots
~665.644 s narration duration
```

It is described as the **Canonical Production-Like Final-Gate Validation Project**, not as a real customer project.

**Rejected:** creating a brand-new synthetic Final-Gate project when a suitable full-scale reference project already exists.

### 3.2 Isolation strategy

**Selected:** immutable canonical baseline plus fresh working copies for mutating gates.

```text
SOURCE DEMO
    ↓
CANONICAL BASELINE
    ↓
SHA-256 inventory
    ↓
READ-ONLY AUTHORITY
```

Mutating validation scenarios use fresh clones:

```text
Canonical Baseline
→ Gate Working Copy
→ Execute Scenario
→ Capture Evidence
→ Discard Working Copy
```

**Rejected:** running all 13 gates against one mutable clone, because cross-gate state leakage would weaken reproducibility and root-cause analysis.

### 3.3 Validation process

**Selected:** two-pass, audit-first validation.

Pass 1:

```text
run all 13 gates
→ collect evidence
→ record PASS / FAIL / NOT RUN
→ produce blocker register
```

No product fixes are allowed during Pass 1.

If required, Pass 2 is a separate corrective closure:

```text
approved blocker list
→ targeted fixes
→ affected-gate reruns
→ nearby regression
→ full regression
→ external review
```

**Rejected:** fix-as-you-go validation, because it erases the original failure state and makes audit history less trustworthy.

### 3.4 Verdict model

**Selected:** three explicit verdicts:

```text
PRODUCTION READY
CONDITIONAL
NOT READY
```

`CONDITIONAL` is reserved only for non-core browser/responsive/accessibility issues when every core/data/render gate still passes.

### 3.5 Environment scope

**Selected:** current target workstation with true cold-start and fresh-context validation.

The gate records the environment and proves startup/reopen/restart behavior. A second clean machine is not mandatory for MVP Core 1.0.

### 3.6 External provider boundary

**Selected:** Google Flow/Veo is outside the mandatory core Final Gate.

The gate may use:

```text
VALIDATION_FIXTURE
```

or:

```text
EXISTING_ACCEPTED_DEMO_MEDIA
```

as visual media provenance.

The gate does not require provider login, credits, provider uptime, or 141 new video generations.

---

## 4. Canonical Baseline Architecture

### 4.1 Source and baseline

The canonical source is cloned once into a validation baseline.

Expected validation root:

```text
temp/final_system_validation/
├── canonical_baseline/
│   ├── project/
│   ├── inventory.json
│   ├── hashes.json
│   └── baseline_metadata.json
```

The baseline becomes read-only authority for the duration of the run.

### 4.2 Working copies

Read-only gates may inspect the baseline directly where safe. Gates with deliberate mutation must use isolated working copies.

Recommended layout:

```text
temp/final_system_validation/
├── working_copies/
│   ├── G02_e2e/
│   ├── G03_integrity/
│   ├── G04_dependency/
│   ├── G05_versions/
│   ├── G06_scheduler/
│   ├── G10_export/
│   ├── G11_manifest/
│   ├── G12_render/
│   └── G13_qa/
```

G02 owns a dedicated E2E copy and does not reuse the state produced by G04, G05, G12, or any other mutating gate.

### 4.3 Baseline integrity

The canonical baseline must capture at least:

- relative path inventory;
- file size;
- SHA-256 for canonical files;
- project ID;
- scene count;
- shot count;
- stable ID inventory;
- accepted asset/version identity;
- revision/lock summary;
- branch and repository HEAD used to run the gate.

Unexpected canonical baseline mutation is a global stop condition.

---

## 5. Validation Execution Model

### 5.1 One-agent sequential execution

The Final Gate is executed by one agent in one controlled sequence.

```text
PRE-FLIGHT
↓
G01
↓
Wave A
↓
Wave B
↓
Wave C
↓
G02
↓
Pass-1 Summary
↓
STOP
```

No parallel gate owners or subagents are used.

### 5.2 Execution waves

#### Pre-flight

Capture environment, repository, process, disk-space, and baseline evidence before any gate runs.

#### G01

Run full canonical regression first.

#### Wave A — State and data

```text
G03 Data Integrity & Persistence
G04 Dependency Engine Micro-Propagation
G05 Version / Lock / Restore
```

#### Wave B — Runtime and UX

```text
G06 Resource Scheduler & Recovery
G07 Browser Workflow
G08 Responsive Matrix
G09 Accessibility Hardening
```

#### Wave C — Production output

```text
G10 Portable Export Package
G11 Render Manifest Verification
G12 Final Render Deliverable
G13 Automated Render QA
```

#### Wave D — Full system integration

```text
G02 Canonical 79/141 End-to-End Workflow
```

G02 is intentionally last because it is the integration proof that all previously verified subsystems work together.

---

## 6. Canonical Mandatory Gates

The Final Gate contains exactly 13 mandatory gates.

### G01 — Full Canonical Regression

Pass condition:

```text
current collected tests = N
N passed
0 failed
0 errors
```

The historical 1062-test baseline is reference context, not a hardcoded test count. Any unexplained reduction in collected tests is a blocker requiring inventory diff and review.

Evidence:

```text
regression/
├── pytest_full.log
├── pytest_summary.json
├── collected_tests.txt
└── environment.json
```

Classification: **Hard blocker if failed.**

### G02 — Canonical 79/141 End-to-End Workflow

A dedicated project clone must go through the real production path:

```text
cold start
→ open project
→ Story
→ Voice
→ Visual
→ Export
→ Portable Package
→ Render Manifest
→ Final Render
→ automatic Render QA
→ READY
```

Required invariants:

```text
Scenes = 79
Shots = 141
stable shot IDs preserved
canonical source hashes preserved
manifest lineage correct
render lineage correct
QA lineage correct
final.mp4 READY
```

No mock service or test-only shortcut may stand in for the production path.

Classification: **Hard blocker if failed.**

### G03 — Data Integrity & Persistence

Track at least:

- script;
- master audio;
- timestamps;
- Scene Plan;
- Visual Bible;
- visual/motion prompt artifacts;
- asset registry/intake ledger;
- stable IDs;
- settings/metadata;
- state database semantic state;
- historical exports;
- render manifests;
- locks;
- revision lineage.

Pass condition:

```text
unexpectedMutationCount = 0
```

Gate-specific expected mutations must be declared explicitly.

Classification: **Hard blocker if failed.**

### G04 — Dependency Engine Micro-Propagation

Modify exactly one upstream Story Beat in an isolated working copy.

Expected behavior:

```text
changed node
→ only true downstream descendants become OUTDATED

unrelated branches
→ unchanged
```

Required metrics:

```text
falsePositive = 0
falseNegative = 0
stable IDs unchanged
```

Evidence must include before/after graph snapshots and expected-vs-actual affected ID matrices.

Classification: **Hard blocker if failed.**

### G05 — Version / Lock / Restore

Required behavior:

- meaningful revision creation works;
- restore recreates exact prior content;
- Stable Artifact ID is preserved;
- history remains append-only;
- locked artifact is protected from bulk overwrite;
- lock persists across restart/reopen;
- LOCKED and OUTDATED may coexist;
- restore conflict on locked artifact follows the existing lock contract.

Restart is mandatory inside this gate.

Classification: **Hard blocker if failed.**

### G06 — Resource Scheduler & Recovery

Stress scenarios must exercise:

```text
CUDA_HEAVY
GPU_ENCODER
CPU_BOUND
cancellation
failure cleanup
```

Required:

```text
CUDA OOM = 0
deadlock = 0
permit leak = 0
orphan process = 0
```

After failure/cancellation, a subsequent job must still run successfully.

Classification: **Hard blocker if failed.**

### G07 — Browser Workflow

Use a fresh real-browser context.

Validate the five main Workbenches and current production surfaces:

- project open/reopen;
- primary CTA reachability;
- Next Best Action;
- save/reload state;
- loading/empty/error/dirty states;
- Export;
- Render;
- QA;
- project switching and state isolation.

Required:

```text
uncaught JS errors = 0
dead primary CTA = 0
unexpected state leak = 0
```

A core workflow break causes `NOT READY`. Minor non-blocking polish may contribute to `CONDITIONAL`.

### G08 — Responsive Layout Matrix

Validate all 11 canonical configurations:

```text
2560×1440
1920×1080
1440×900
1366×768
1280×720
1024×768
768×1024
390×844
360×800
320 CSS px reflow
200% browser zoom
```

Required:

- no unintended page-level horizontal scroll;
- primary actions remain reachable;
- no critical clipping;
- drawers/sheets remain usable;
- navigation remains usable;
- modal/dialog content remains reachable.

Core workflow failure causes `NOT READY`; low-impact cosmetic issues may contribute to `CONDITIONAL`.

### G09 — Accessibility Hardening

The claim is explicitly:

```text
WCAG 2.2 AA-oriented validation within the defined test scope
```

It is not formal full WCAG 2.2 AA conformance.

Validate:

- keyboard-only workflow;
- visible focus;
- focus not fully obscured;
- modal/drawer focus trap;
- Escape handling;
- focus restoration;
- hidden panels not tabbable;
- non-hover access;
- drag alternatives where relevant;
- normal target-size policy;
- coarse-pointer target-size policy;
- reduced motion;
- aria-live progress/status;
- Vietnamese-first accessible labels on relevant UI.

Core keyboard/focus failure causes `NOT READY`; limited non-core issues may contribute to `CONDITIONAL`.

### G10 — Portable Export Package

The package must contain 10 accepted artifact groups:

```text
1. Script
2. Master WAV PCM 24kHz
3. Subtitle SRT/VTT
4. Shots JSON
5. Shots CSV
6. Visual Bible
7. Prompts
8. Asset Manifest
9. Accepted Media
10. manifest.json
```

Required:

```text
100% checksum match
portable paths
no stale media
no rejected media
no garbage/temp files
```

The package must be extracted and its checksums recomputed as part of verification.

Classification: **Hard blocker if failed.**

### G11 — Render Manifest Verification

Required manifest invariants:

```text
141 clips preserved
frameRate = 24/1
timeBase = 1/24
integer frame coordinates authoritative
[startFrame,endFrame) semantics
stable IDs preserved
source hashes match actual inputs
accepted asset versions/checksums exact
```

The current ten Phase 7 validation gates must all execute:

```text
1 PATH_SANDBOX_AND_PRESENCE
2 ACCEPTED_ASSET_INTEGRITY
3 UNSUPPORTED_MEDIA_TYPE
4 NON_POSITIVE_DURATION
5 INVALID_TIMESTAMPS
6 TRANSITION_AWARE_OVERLAPS
7 TIMELINE_GAPS
8 REQUIRED_MASTER_AUDIO
9 AUDIO_DURATION_ALIGNMENT
10 OPTIONAL_TRACK_HANDLING
```

Classification: **Hard blocker if failed.**

### G12 — Final Render Deliverable

The Final Render must be created from G11's exact persisted manifest.

Required output:

```text
MP4
H.264
1920×1080
24/1 CFR
yuv420p
SAR 1:1
AAC
48 kHz
stereo
```

Also validate:

- exact expected frame count;
- A/V duration tolerance per existing contract;
- machine-readable progress;
- atomic final publish;
- render metadata lineage;
- correct hardware fallback behavior;
- scratch cleanup;
- no orphan render process.

GPU/encoder failure may trigger the existing CPU fallback. Input/data/filter errors may not be disguised as hardware fallback conditions.

Classification: **Hard blocker if failed.**

### G13 — Automated Render QA

G13 must run automatically on the exact final file produced by G12.

Required flow:

```text
G12 Final committed
→ PENDING_RENDER_QA / NEEDS_REVIEW
→ automatic RENDER_QA
→ ffprobe
→ full-file decode
→ manifest-aware detection evaluation
→ immutable QA report
→ PASS or PASS_WITH_WARNINGS
→ Artifact READY
```

Accepted final QA verdicts:

```text
PASS
PASS_WITH_WARNINGS
```

Not accepted:

```text
FAIL
FAILED QA infrastructure
INTERRUPTED
missing report
hash mismatch
```

Lineage must connect at least:

```text
projectId
exportId
manifestHash
finalSha256
renderJobId
qaJobId
qaRunId
```

Classification: **Hard blocker if failed.**

---

## 7. Evidence Architecture

### 7.1 Canonical root

```text
temp/final_system_validation/
├── environment/
├── baseline/
├── regression/
├── e2e/
├── data_integrity/
├── dependency/
├── versions_and_locks/
├── resource_scheduler/
├── browser/
├── responsive/
├── accessibility/
├── export_package/
├── render_manifest/
├── render/
├── render_qa/
├── blocker_register/
└── final_validation_summary.md
```

### 7.2 Minimum per-gate evidence

Each gate must have at least:

```text
result.json
summary.md
commands.log
environment reference
raw evidence
hashes when applicable
```

A screenshot is supplemental evidence and cannot replace machine-verifiable output where such output is practical.

### 7.3 Result model

A gate result must record at least:

```json
{
  "gate": "G04",
  "name": "Dependency Engine",
  "startedAt": "<ISO-8601>",
  "completedAt": "<ISO-8601>",
  "status": "PASS | FAIL | NOT RUN",
  "hardBlocker": true,
  "inputs": [],
  "evidence": [],
  "observations": [],
  "failures": []
}
```

The spec does not define concrete runtime timestamps; execution fills actual values.

### 7.4 Evidence immutability

Pass 1 evidence is append-only.

Corrective reruns are stored separately:

```text
G12/
├── pass1/
└── corrective_rerun_01/
```

An initial FAIL must remain visible after a later PASS.

---

## 8. Blocker Register

Canonical path:

```text
temp/final_system_validation/blocker_register/blockers.json
```

Each issue records:

```text
id
gate
severity
category
summary
reproduction
expected
actual
evidence
affected subsystem
status
```

Severity values:

```text
BLOCKER
CONDITIONAL
OBSERVATION
```

Example identifier format:

```text
FG-001
FG-002
...
```

---

## 9. Pass-1 Failure Handling

### 9.1 Normal gate failure

A normal product/business failure marks the gate `FAIL`, preserves evidence, and allows independent gates to continue where safe.

The purpose of Pass 1 is to reveal the full failure surface before correction begins.

### 9.2 Global stop conditions

Stop the entire Final Gate immediately if any of the following occurs:

- canonical source project is unexpectedly mutated;
- canonical baseline hash changes unexpectedly;
- Kokoro upstream is mutated by the Final Gate;
- a validation operation escapes its intended filesystem scope;
- an unowned process would need to be terminated;
- repository branch/HEAD changes unexpectedly;
- dependencies/runtime materially change mid-run;
- environment trust is otherwise lost.

No silent reset/clean/restore may be used to hide these conditions.

### 9.3 Infrastructure failure taxonomy

Final Gate orchestration uses:

```text
FG_ENVIRONMENT_FAILURE
FG_TEST_INFRA_FAILURE
FG_PRODUCT_FAILURE
FG_DATA_INTEGRITY_FAILURE
FG_SECURITY_SAFETY_FAILURE
FG_EVIDENCE_INCOMPLETE
```

If a mandatory gate cannot execute due to infrastructure failure:

```text
Gate = NOT RUN
```

A mandatory `NOT RUN` prevents `PRODUCTION READY`.

### 9.4 Retry policy

Only infrastructure flakiness may receive one immediate retry.

```text
infrastructure flake → retry once
product assertion failure → no masking retry
```

A second infrastructure failure remains `NOT RUN` with the appropriate failure classification.

---

## 10. Cold-Start and Environment Validation

### 10.1 Required cold start

The run must not rely on old services or transient shell state.

Controlled startup sequence:

```text
Studio stopped
Kokoro stopped
ports verified closed
→ fresh shell/process
→ start Kokoro
→ health check
→ CUDA/device evidence
→ start Studio
→ HTTP 200
```

### 10.2 Environment fingerprint

Capture one canonical environment fingerprint before G01:

```text
OS build
CPU model
logical cores
RAM
GPU model
VRAM
NVIDIA driver
CUDA visibility
Python executable
Python version
pip environment hash
FFmpeg version
ffprobe version
browser/version
repo branch
repo HEAD
git status fingerprint
```

Every gate references the same environment fingerprint ID.

A material environment change invalidates later evidence and requires a new controlled validation run.

### 10.3 Restart checkpoints

Controlled restart/reopen checks are mandatory in:

```text
G05
G07
G02
```

Unplanned crashes are captured as defects before any restart.

---

## 11. Process and Resource Safety

### 11.1 Process ownership

Validation may terminate only verified UnfoldIQ-owned processes.

Broad commands that could terminate unrelated Python processes are prohibited.

### 11.2 Resource evidence

G06/G12/G13 capture at least:

```text
job start/end
resource class
permit acquired/released
process PID
exit status
nvidia-smi snapshots where relevant
```

### 11.3 Cancellation

Cancellation evidence must prove:

```text
cancel request recorded
owned child stopped correctly
bounded wait
process reaped
resource permit released
scratch cleanup correct
next job still executes
```

### 11.4 Timeouts

Long-running operations use bounded inactivity detection and existing progress contracts.

The design does not invent arbitrary timeout durations. Execution derives concrete bounds from existing code contracts or measured baseline behavior.

---

## 12. Performance and Runtime Measurements

### 12.1 Measurement categories

Metrics are classified as:

```text
HARD THRESHOLD
REGRESSION REFERENCE
OBSERVATIONAL
```

Existing thresholds remain authoritative. The Final Gate may not relax them.

### 12.2 Required measurements

Record at least:

#### Startup

```text
Kokoro cold-start time
Studio cold-start time
time-to-health
time-to-browser-ready
```

#### Dependency/state

```text
content hash
single-branch invalidation
next-best-action
topological sort
state load
```

#### Portable export

```text
preflight duration
package/export duration
package size
checksum verification duration
```

#### Browser/UI

```text
page load
project open
workbench switch
long-list interaction
console errors
network errors
```

#### Render

```text
expected duration
render wall time
render RTF
encoder used
fallback used
peak CPU where practical
peak GPU/VRAM where practical
output bytes
```

#### QA

```text
hash time
probe time
full decode time
evaluation time
total QA time
QA_RTF
```

The existing Phase 9 long-form QA requirement `QA_RTF <= 1.0` remains a hard contract where applicable.

No new hard performance number is created merely for this Final Gate unless an existing production contract already defines it.

---

## 13. Disk-Space Safety

Pre-flight must measure free disk before cloning/rendering.

The capacity estimate must account for:

```text
canonical baseline
several concurrent working copies
portable package
render scratch
final.mp4
QA evidence
safety margin
```

If free disk is insufficient, validation must stop before expensive gates begin. Disk exhaustion must not be misclassified as a product render defect.

---

## 14. External Provider Boundary and Provenance

Google Flow/Veo is not a mandatory dependency of this gate.

Final Gate does not require:

```text
Google login
Flow availability
Veo credits
141 fresh generations
provider output determinism
```

Any visual media used in Final Gate must declare honest provenance:

```text
VALIDATION_FIXTURE
```

or:

```text
EXISTING_ACCEPTED_DEMO_MEDIA
```

The validation report must not claim fresh Veo generation when none occurred.

---

## 15. Corrective Closure

### 15.1 Entry condition

Corrective closure may begin only after:

```text
all 13 Pass-1 gates have reached PASS / FAIL / NOT RUN
pass1_summary.json exists
blocker register is frozen
Pass-1 draft report exists
```

Then execution stops for review/approval.

### 15.2 Corrective behavior

Each fix must map to a concrete blocker:

```text
FG-xxx
→ root cause
→ files changed
→ test added/updated
→ affected gate(s)
```

Required rerun pattern:

```text
focused test
→ affected gate rerun
→ nearby regression
→ full regression
```

Cross-system fixes rerun dependent gates. Examples:

```text
G12 renderer fix
→ rerun G11, G12, G13, G02, G01
```

```text
G08 CSS-only fix
→ rerun G07, G08, G09, G01
```

### 15.3 Corrective-round limit

Maximum:

```text
2 corrective rounds
```

If the same subsystem still fails after two rounds:

```text
STOP
→ NOT READY
→ architecture/root-cause review
```

The process must not patch indefinitely to force a green result.

---

## 16. Verdict Model

### 16.1 PRODUCTION READY

Requires:

```text
13 / 13 PASS
100% full canonical regression
0 unresolved BLOCKER
0 data-integrity breach
0 scheduler safety failure
0 render/QA hard failure
complete evidence set
```

Allowed statement:

> **Production-ready for the validated local workstation/runtime configuration.**

### 16.2 CONDITIONAL

Allowed only when all core/data/render gates pass and remaining findings are limited to non-blocking browser/responsive/accessibility issues.

Every conditional issue must document:

```text
risk
workaround
owner/area
recommended closure
```

### 16.3 NOT READY

Any failure in the following forces `NOT READY`:

```text
G01 regression
G02 E2E
G03 integrity
G04 dependency propagation
G05 version/lock/restore
G06 scheduler/resource safety
G10 portable package
G11 render manifest
G12 final render
G13 render QA
```

Core failures in G07/G08/G09 also force `NOT READY`.

---

## 17. Final Report Contract

Canonical report path:

```text
docs/implementation/FINAL_SYSTEM_INTEGRATION_AND_PRODUCTION_VALIDATION_REPORT.md
```

Required 16 sections:

```text
1. Executive Summary
2. Environment & Git Baseline
3. Canonical Validation Project
4. Validation Methodology
5. G01 Full Canonical Regression
6. G02 Canonical 79/141 E2E
7. G03–G05 Data / Dependency / Version-Lock-Restore
8. G06 Resource Scheduler
9. G07–G09 Browser / Responsive / Accessibility
10. G10 Portable Export Package
11. G11 Render Manifest
12. G12 Final Render Deliverable
13. G13 Automated Render QA
14. Blocker Register & Corrective Closures
15. Full Gate Matrix G01–G13
16. Final Production Verdict
```

The report may conclude only one of:

```text
FINAL SYSTEM GATE: PRODUCTION READY
FINAL SYSTEM GATE: CONDITIONAL
FINAL SYSTEM GATE: NOT READY
```

No vague intermediate wording such as “mostly ready” is allowed as the final verdict.

---

## 18. Promotion Ownership

The execution agent cannot self-promote the Final Gate.

Execution-agent terminal state:

```text
FINAL SYSTEM GATE:
VALIDATION COMPLETE / REVIEW PENDING

Candidate verdict:
PRODUCTION READY | CONDITIONAL | NOT READY
```

An external review owns final promotion to:

```text
FINAL SYSTEM GATE:
PRODUCTION READY / VERIFIED
```

or the corresponding externally verified non-ready verdict.

---

## 19. Exact Stop Conditions

### 19.1 Pass-1 stop

After all mandatory gates have a terminal state:

```text
write pass1_summary.json
write blocker register
write draft Final Report
STOP
```

No corrective source-code changes begin automatically.

### 19.2 Corrective stop

After corrective execution and required reruns:

```text
write corrective evidence
update candidate verdict
STOP for external review
```

### 19.3 Post-promotion stop

If external review promotes the gate to `PRODUCTION READY / VERIFIED`:

```text
MVP Core 1.0 = READY
STOP
```

The Final Gate does not automatically start post-MVP roadmap work.

---

## 20. Out of Scope

This design explicitly excludes:

- creating a new Phase 10;
- new YouTube Intelligence features;
- Prompt Registry implementation;
- Agent/MCP implementation;
- Google Flow/Veo API integration;
- fresh 141-shot external provider generation;
- multilingual/multi-niche expansion;
- future browser timeline editing;
- SaaS/cloud/multi-user architecture;
- clean-machine installer/distribution certification;
- unrelated refactors;
- performance threshold invention without an existing product contract.

---

## 21. Design Invariants

The following decisions are locked for implementation planning:

```text
13 canonical Gates                     LOCKED
79/141 production-like validation      LOCKED
immutable canonical baseline           LOCKED
fresh working copy per mutating Gate   LOCKED
G02 dedicated E2E working copy         LOCKED
audit-first Pass 1                     LOCKED
no silent fixes during Pass 1          LOCKED
one-agent sequential execution         LOCKED
machine-verifiable evidence            LOCKED
append-only evidence history           LOCKED
blocker register                       LOCKED
cold-start validation                  LOCKED
current-workstation scope              LOCKED
Flow/Veo excluded from core verdict    LOCKED
three-verdict model                    LOCKED
maximum two corrective rounds          LOCKED
execution agent cannot self-promote    LOCKED
MVP Core boundary after external pass  LOCKED
```

Any implementation plan that contradicts one of these invariants requires returning to design review rather than silently changing the contract.

---

## 22. Spec Acceptance Criteria

This design is considered correctly implemented only when all of the following are true:

1. Final Gate remains a quality gate after Phase 9, not Phase 10.
2. The canonical 79-scene / 141-shot project is used as the production-like validation source.
3. The source demo and canonical baseline remain protected from destructive testing.
4. Mutating scenarios use isolated working copies.
5. Pass 1 runs all 13 gates without product fixes.
6. G01 validates all currently collected canonical tests with zero failures/errors.
7. G02 executes the real production path and ends in a READY final artifact.
8. G03–G06 prove data, dependency, revision/lock, and scheduler integrity.
9. G07–G09 validate real-browser workflow, the 11-display matrix, and scoped accessibility behavior.
10. G10 validates the portable 10-artifact package and checksums.
11. G11 validates the exact current 10 Phase 7 gates and frame-accurate manifest contract.
12. G12 creates a real final render from the persisted manifest.
13. G13 automatically validates that exact final render and records immutable QA evidence.
14. External Flow/Veo availability is not required for the core verdict.
15. All mandatory gates retain raw and summarized evidence.
16. Pass-1 failures remain visible after corrective reruns.
17. Environment and process ownership are recorded and controlled.
18. Mandatory infrastructure failures become `NOT RUN`, never fabricated PASS results.
19. Existing production thresholds are preserved.
20. The final report follows the 16-section contract.
21. The execution agent stops at review-pending state.
22. External review owns final promotion.
23. MVP Core 1.0 becomes READY only after final external promotion.
24. No post-MVP feature is started by the Final Gate workflow.

---

## 23. Self-Review Result

The written spec has been checked for:

- placeholders: none;
- undefined mandatory gates: none;
- contradictory verdict rules: none;
- conflicting project-isolation rules: none;
- unbounded corrective loops: none;
- ambiguous provider boundary: none;
- accidental Phase 10 language: none;
- implementation leakage into post-MVP scope: none.

This spec is ready for user review before implementation planning.
