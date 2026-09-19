# Final System Integration & Production Validation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Selected execution for this project:** `superpowers:executing-plans`, one agent, sequential execution. Do **not** use subagent-driven development for this plan.

**Goal:** Execute Pass 1 of the Final System Integration & Production Validation Gate against the canonical 79-Scene / 141-Shot UnfoldIQ reference project, preserve immutable evidence for all 13 mandatory gates, and produce a review-pending candidate verdict without silently fixing product code.

**Architecture:** Add a thin validation-only harness under `scripts/final_validation/` that reuses the existing UnfoldIQ APIs, job system, browser/CDP harnesses, asset semantics, Render Manifest compiler, FFmpeg renderer, and Render QA service. Product source remains read-only during Pass 1. All destructive scenarios run against fresh project copies created from one frozen canonical baseline; evidence is append-only under `temp/final_system_validation/`.

**Tech Stack:** Python 3.12, existing pytest suite, FastAPI/HTTP endpoints, existing Chrome/Edge CDP tooling, FFmpeg/ffprobe, Git, PowerShell, `nvidia-smi`, existing UnfoldIQ modules (`dependency_graph`, `version_manager`, `resource_scheduler`, Phase 4 asset/export pipeline, Phase 7 manifest compiler, Phase 8 render service, Phase 9 Render QA).

**Spec:** `docs/superpowers/specs/2026-09-19-final-system-integration-production-validation-gate-design.md`

## Global Constraints

- Final Gate is a **Final Quality Gate**, not Phase 10.
- Pass 1 is audit-only: no product fixes, no threshold relaxation, no deleted/weakened tests, no silent state repair.
- One agent only; run tasks sequentially in the order below.
- At execution start, invoke `superpowers:using-git-worktrees` and work in an isolated validation worktree/feature branch where practical.
- Do not commit unless the user explicitly authorizes commits. Every task ends with a diff/status checkpoint instead of an unconditional commit.
- Never mutate `projects/2026-09-12_210003_youtube-narration-01` directly.
- Never mutate the frozen canonical baseline after its hashes are captured.
- External Google Flow/Veo generation is out of scope. Validation media may only be marked `VALIDATION_FIXTURE` or `EXISTING_ACCEPTED_DEMO_MEDIA`.
- Never fabricate browser, GPU, FFmpeg, QA, or provider evidence.
- Never use broad process termination such as `taskkill /IM python.exe /F`; terminate only verified UnfoldIQ-owned processes.
- A mandatory gate that cannot run is `NOT RUN`, not PASS. Infrastructure failure and product failure must remain distinct.
- Pass 1 ends after the 13-gate evidence set, blocker register, candidate verdict, and review-pending report are written. Corrective fixes require a separate approved corrective-closure plan.

## Review Focus

1. **Accepted-media isolation:** the historical 79/141 reference project may not contain a complete accepted visual set. Deterministic validation media must be provisioned only in working copies and must use the existing Phase 4 lifecycle/checksum semantics without changing the source project.
2. **Regression integrity:** G01 must run the current collected canonical suite and flag any unexplained test-count decrease relative to the latest 1062-test reference; the harness itself must not hide failures by altering canonical test discovery.
3. **Render/QA lineage:** G12 and G13 must prove that the QA report belongs to the exact `final.mp4` produced from the exact persisted manifest using `projectId`, `exportId`, `manifestHash`, and `finalSha256`.
4. **Infrastructure honesty:** unavailable browser/CDP/CUDA/tooling produces `FG_TEST_INFRA_FAILURE` / `NOT RUN`, never a fabricated product result.
5. **Baseline/process safety:** any canonical-source mutation, path escape, unowned process kill, unexpected HEAD/runtime change, or unexplained dependency mutation is a global STOP condition.

---

## Task 1: Create the isolated execution workspace and freeze governance inputs

**Files:**
- Read: `.agents/**`
- Read: `docs/superpowers/specs/2026-09-19-final-system-integration-production-validation-gate-design.md`
- Read: `docs/implementation/ROADMAP_STATUS.md`
- Read: `docs/implementation/PHASE_02_IMPLEMENTATION_REPORT.md`
- Read: `docs/implementation/PHASE_04_IMPLEMENTATION_REPORT.md`
- Read: `docs/implementation/PHASE_06_IMPLEMENTATION_REPORT.md`
- Read: `docs/implementation/PHASE_07_IMPLEMENTATION_REPORT.md`
- Read: `docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md`
- Read: `docs/implementation/PHASE_09_IMPLEMENTATION_REPORT.md`
- Create: `temp/final_system_validation/governance/source_audit.md`
- Create: `temp/final_system_validation/governance/git_preflight.txt`

- [ ] **Step 1: Start with the approved execution method**

Invoke `superpowers:using-git-worktrees` before changing repository files. Create or select an isolated Final-Gate worktree/branch from the exact Phase-9-approved state. Do not clean or reset unrelated changes.

- [ ] **Step 2: Read project-local agent rules before any implementation action**

Read `.agents` instructions, including repository-specific rules and skills. Record any rule that changes commands or paths in `source_audit.md`.

- [ ] **Step 3: Verify the approved spec is present in the execution worktree**

Expected canonical repository path:

```text
docs/superpowers/specs/2026-09-19-final-system-integration-production-validation-gate-design.md
```

If it is absent, copy the already-approved spec into that exact path before proceeding. Do not alter its semantics.

- [ ] **Step 4: Capture Git baseline**

Run from repository root:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git diff --stat
```

Write exact output to `temp/final_system_validation/governance/git_preflight.txt`.

- [ ] **Step 5: Confirm roadmap state**

Verify the current authoritative roadmap still says:

```text
Phase 1–9 = PASS / FINAL / VERIFIED
Final System Gate = READY TO START / NOT STARTED
```

If Phase 9 is no longer the approved baseline, stop with `FG_ENVIRONMENT_FAILURE`; do not reinterpret the plan against a different roadmap state.

- [ ] **Step 6: Audit exact source integration points before writing the harness**

Read these files and record the exact current callable names/endpoints used by the repository:

```text
studio/dependency_graph.py
studio/version_manager.py
studio/resource_scheduler.py
studio/project_bootstrap.py
studio/asset_intake.py
studio/asset_registry.py
studio/portable_package.py
studio/render_manifest.py
studio/render_manifest_hashing.py
studio/render_manifest_validation.py
studio/timeline_compiler.py
studio/manifest_integrity.py
studio/manifest_render_service.py
studio/render_qa_service.py
studio/phase14_router.py
scripts/verify_phase06_browser.py
scripts/verify_phase06_manual.py
scripts/verify_phase08_render_engine.py
scripts/verify_phase09_render_qa.py
```

The audit must explicitly confirm the current names for:

```text
Phase 4 ledger/registry load + write path
Phase 7 preview + persisted compile path
Phase 8 Final render trigger path
Phase 9 automatic handoff + latest-report path
project bootstrap/reload path
scheduler submit/cancel/permit path
```

Do not create competing product services if the source already owns these operations.

- [ ] **Step 7: Checkpoint without commit**

```powershell
git status --short
git diff --stat
```

Expected product-source delta: none. Do not commit unless explicitly authorized.

---

## Task 2: Build the validation-harness core and evidence contracts

**Files:**
- Create: `scripts/final_validation/__init__.py`
- Create: `scripts/final_validation/common.py`
- Create: `scripts/final_validation/selftest_final_validation.py`
- Create: `temp/final_system_validation/README.md`

- [ ] **Step 1: Write harness self-tests first**

In `scripts/final_validation/selftest_final_validation.py`, add direct executable tests for:

```text
safe path containment
SHA-256 file hashing
deterministic directory inventory
append-only evidence creation
result.json schema validation
blocker ID allocation
PASS / FAIL / NOT_RUN status validation
failure-taxonomy validation
single-retry infrastructure policy
candidate-verdict reduction
```

Use plain assertions/unittest inside this script; name it `selftest_...py`, not `test_*.py`, so the harness does not silently increase or alter canonical G01 pytest discovery.

Run before implementing helpers:

```powershell
python scripts/final_validation/selftest_final_validation.py
```

Expected: FAIL because `common.py` is not implemented.

- [ ] **Step 2: Implement canonical harness types in `common.py`**

Use one explicit result model:

```python
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

class GateStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_RUN = "NOT RUN"

class FailureKind(str, Enum):
    ENVIRONMENT = "FG_ENVIRONMENT_FAILURE"
    TEST_INFRA = "FG_TEST_INFRA_FAILURE"
    PRODUCT = "FG_PRODUCT_FAILURE"
    DATA_INTEGRITY = "FG_DATA_INTEGRITY_FAILURE"
    SECURITY_SAFETY = "FG_SECURITY_SAFETY_FAILURE"
    EVIDENCE_INCOMPLETE = "FG_EVIDENCE_INCOMPLETE"

@dataclass(frozen=True)
class GateResult:
    gate: str
    name: str
    status: GateStatus
    hard_blocker: bool
    failure_kind: str | None = None
    evidence: tuple[str, ...] = ()
    observations: tuple[str, ...] = ()
    failures: tuple[str, ...] = ()
```

Implement these validation-only functions:

```python
sha256_file(path: Path) -> str
inventory_tree(root: Path) -> dict
assert_within(root: Path, candidate: Path) -> Path
write_json_create_only(path: Path, payload: dict) -> None
append_command_log(path: Path, argv: list[str], exit_code: int, stdout: str, stderr: str) -> None
write_gate_result(gate_dir: Path, result: GateResult) -> None
allocate_blocker_id(existing: list[dict]) -> str
reduce_candidate_verdict(results: list[GateResult]) -> str
```

`write_json_create_only` must use exclusive-create semantics (`"x"`) so a prior result cannot be overwritten.

- [ ] **Step 3: Pin verdict reduction rules**

`reduce_candidate_verdict()` must enforce:

```text
Mandatory NOT RUN -> cannot be PRODUCTION READY
Any core hard-blocker FAIL -> NOT READY
Only non-core minor G07/G08/G09 issues -> CONDITIONAL candidate
13/13 PASS + evidence complete -> PRODUCTION READY candidate
```

Do not let the reducer promote `FINAL / VERIFIED`; it only produces a candidate verdict.

- [ ] **Step 4: Run harness self-tests**

```powershell
python scripts/final_validation/selftest_final_validation.py
```

Expected: PASS.

- [ ] **Step 5: Write evidence root README**

Document the append-only contract and the exact required per-gate files:

```text
result.json
summary.md
commands.log
environment_ref.json
raw/
hashes/ when applicable
screenshots/ when applicable
```

- [ ] **Step 6: Checkpoint without commit**

Review only validation-harness files. Product source must remain unchanged.

---

## Task 3: Implement Final-Gate preflight, cold start, environment fingerprint, baseline clone, and validation media provisioning

**Files:**
- Create: `scripts/final_validation/prepare_final_gate.py`
- Create: `scripts/final_validation/fixtures.py`
- Modify: `scripts/final_validation/selftest_final_validation.py`
- Create at runtime: `temp/final_system_validation/environment/**`
- Create at runtime: `temp/final_system_validation/canonical_baseline/**`
- Create at runtime: `temp/final_system_validation/working_copies/**`

- [ ] **Step 1: Add failing self-tests for project cloning and fixture isolation**

Test that:

```text
source project cannot equal destination
canonical baseline is created once
working copy is created from baseline, not source
fixture provisioning refuses canonical baseline
fixture provenance is VALIDATION_FIXTURE
source-project hashes remain unchanged
```

Run:

```powershell
python scripts/final_validation/selftest_final_validation.py
```

Expected: FAIL until `prepare_final_gate.py` and `fixtures.py` exist.

- [ ] **Step 2: Implement environment fingerprint collection**

`prepare_final_gate.py` must write:

```text
temp/final_system_validation/environment/environment.json
temp/final_system_validation/environment/python.txt
temp/final_system_validation/environment/pip_freeze.txt
temp/final_system_validation/environment/ffmpeg.txt
temp/final_system_validation/environment/ffprobe.txt
temp/final_system_validation/environment/nvidia_smi.txt
temp/final_system_validation/environment/git.txt
```

Collect at minimum:

```text
OS/build
CPU/logical cores
RAM
GPU/VRAM/driver
CUDA visibility
Python executable/version
SHA-256 of normalized pip freeze
FFmpeg/ffprobe versions
browser name/version
branch/HEAD/git-status fingerprint
```

- [ ] **Step 3: Implement disk-space preflight**

Calculate source-project size and current free disk space. Require enough free space for:

```text
canonical baseline
+ three largest concurrent working copies
+ portable ZIP
+ render scratch
+ final.mp4
+ 25% safety margin
```

If insufficient, stop before creating copies and write `FG_ENVIRONMENT_FAILURE` evidence. Do not classify a later disk-full render as a product defect if preflight already knew capacity was insufficient.

- [ ] **Step 4: Perform true cold-start evidence collection**

Use existing launcher/ownership-safe stop logic. From a stopped state verify ports 7860 and 8880 are closed, then start Kokoro and Studio using the repository’s documented production commands. Capture:

```text
ports_before.txt
kokoro_start.log
studio_start.log
health.json
voices.json
nvidia_smi_loaded.txt
ports_after.txt
```

Never terminate unowned Python processes. If ownership cannot be proven, stop with `FG_SECURITY_SAFETY_FAILURE`.

- [ ] **Step 5: Freeze the canonical baseline**

Source authority:

```text
projects/2026-09-12_210003_youtube-narration-01
```

Clone to:

```text
temp/final_system_validation/canonical_baseline/project/
```

Then write:

```text
inventory.json
hashes.json
baseline_metadata.json
```

`baseline_metadata.json` must include at least:

```json
{
  "sourceProjectId": "2026-09-12_210003_youtube-narration-01",
  "expectedScenes": 79,
  "expectedShots": 141,
  "provenance": "CANONICAL_PRODUCTION_LIKE_DEMO"
}
```

Immediately re-hash the source project and prove it is unchanged by the clone operation.

- [ ] **Step 6: Implement working-copy factory**

Expose:

```python
create_working_copy(gate: str) -> Path
```

Allowed names are exactly:

```text
G02_e2e
G03_integrity
G04_dependency
G05_versions
G06_scheduler
G10_export
G11_manifest
G12_render
G13_qa_diagnostics
```

The function must fail if the destination already exists; reruns use a new Pass/rerun directory rather than replacing evidence/state.

- [ ] **Step 7: Implement deterministic validation visual fixture generation**

`fixtures.py` must generate a local deterministic 1920×1080 still image using FFmpeg/lavfi or another already-installed deterministic local tool. It must not call Google Flow/Veo or any network provider.

Example generation shape:

```powershell
ffmpeg -f lavfi -i "color=c=0x303030:s=1920x1080:d=1" -frames:v 1 <working-copy>\assets\final_gate\validation_frame.png
```

Use the exact Phase 4 asset-intake/registry writer discovered in Task 1 to register accepted mappings for all 141 shots on the **working copy only**. Do not duplicate the Phase 4 JSON schema manually when a canonical writer exists.

Required semantics for each mapping:

```text
stable shotId preserved
lifecycle accepted under current Phase 4 rule
sha256 exact
path project-relative
provenance = VALIDATION_FIXTURE
provider = NONE / LOCAL_VALIDATION (only if current schema supports it)
no claim that asset came from Google/Veo
```

If the current Phase 4 code exposes no safe writer that can preserve existing semantics, stop fixture provisioning as `FG_TEST_INFRA_FAILURE`; do not invent a competing product schema inside the Final Gate.

- [ ] **Step 8: Run fixture smoke only on a disposable working copy**

Create `G11_manifest` copy, provision fixtures, run the current Phase 7 preview compiler, and prove the remaining blockers are not accepted-media absence/checksum issues. Delete/recreate this copy before the actual G11 task so smoke state is not reused as final evidence.

- [ ] **Step 9: Run harness self-tests again**

```powershell
python scripts/final_validation/selftest_final_validation.py
```

Expected: PASS.

- [ ] **Step 10: Check global-stop invariants**

Re-hash source project and baseline. Any unexpected change is an immediate STOP with `FG_DATA_INTEGRITY_FAILURE`.

---

## Task 4: Execute G01 — Full Canonical Regression

**Files:**
- Create: `scripts/final_validation/run_g01_regression.py`
- Create at runtime: `temp/final_system_validation/regression/**`

- [ ] **Step 1: Implement G01 runner without touching test discovery**

The runner must execute from repository root:

```powershell
python -m pytest --collect-only -q
python -m pytest --tb=short -q
```

Capture raw stdout/stderr/exit codes.

- [ ] **Step 2: Record collection inventory**

Write:

```text
collected_tests.txt
pytest_full.log
pytest_summary.json
```

`pytest_summary.json` must include:

```text
collected
passed
failed
errors
skipped
warnings
duration_seconds
exit_code
historical_reference_count = 1062
count_delta
```

- [ ] **Step 3: Enforce G01 acceptance**

PASS only if:

```text
100% currently collected canonical tests pass
failed = 0
errors = 0
```

If `collected < 1062`, generate a test-inventory diff against available Phase-9 evidence and add an observation requiring review. An unexplained reduction is a G01 failure; never silently accept lower coverage.

- [ ] **Step 4: Write immutable G01 evidence**

Write `result.json`, `summary.md`, `commands.log`, `environment_ref.json` under `regression/` using create-only semantics.

- [ ] **Step 5: Continue or stop correctly**

A product regression is recorded as G01 FAIL but does not automatically abort independent evidence gathering. A source/baseline mutation detected while running tests is a global STOP.

---

## Task 5: Execute G03 — Data Integrity & Persistence

**Files:**
- Create: `scripts/final_validation/run_g03_integrity.py`
- Create at runtime: `temp/final_system_validation/data_integrity/**`
- Working copy: `temp/final_system_validation/working_copies/G03_integrity/`

- [ ] **Step 1: Create a fresh G03 working copy**

Do not reuse any previous gate copy.

- [ ] **Step 2: Capture semantic + byte baseline**

Inventory at minimum:

```text
script / script.json / story_beats.json
audio.wav
manifest.json
timestamps.json / timestamps.srt
scene_plan.json
visual_bible.json
veo_prompts.json
assets/intake_ledger.json
assets/registry.json
state.db semantic summary
export history
render-manifest snapshots
locks
revision IDs
scene IDs
shot IDs
```

Use SHA-256 for files and structured queries for SQLite/state semantics.

- [ ] **Step 3: Exercise save → stop → start → reopen**

Perform a controlled non-destructive persistence action on the G03 copy using an existing supported project write path, then restart Studio, reopen the project, and verify expected persisted state without changing unrelated canonical content.

- [ ] **Step 4: Compare before/after**

Produce:

```text
before_inventory.json
after_inventory.json
semantic_diff.json
restart_reopen.json
```

Classify every change as `EXPECTED` or `UNEXPECTED` with exact paths/IDs.

- [ ] **Step 5: Enforce G03 acceptance**

PASS requires:

```text
unexpectedMutationCount = 0
stable scene/shot IDs unchanged
expected project counts preserved
revision/lock history not lost
canonical baseline unchanged
```

Unexpected mutation is `FG_DATA_INTEGRITY_FAILURE` and a hard blocker.

---

## Task 6: Execute G04 — Dependency Engine Micro-Propagation

**Files:**
- Create: `scripts/final_validation/run_g04_dependency.py`
- Create at runtime: `temp/final_system_validation/dependency/**`
- Working copy: `temp/final_system_validation/working_copies/G04_dependency/`

- [ ] **Step 1: Create G04 copy and capture the DAG**

Use:

```http
GET /api/projects/{dir_name}/dependencies/graph
GET /api/projects/{dir_name}/next-action
```

Persist `graph_before.json` and `next_action_before.json`.

- [ ] **Step 2: Identify exactly one StoryBeat and its true descendants**

Choose a stable beat ID from the working copy, for example the first real `beat_id` returned by the Story slice. Compute the expected descendant set from the **pre-mutation graph**; do not hardcode downstream IDs.

- [ ] **Step 3: Mutate only that StoryBeat in the isolated fixture**

Because the documented Story UI save route updates the whole script/root rather than a single beat, use the working-copy persistence layer to change exactly one `StoryBeat` record while preserving its stable ID, then run the existing project bootstrap/reload path that recomputes content hashes.

Do not perform this direct fixture mutation against the canonical source or G02 E2E project.

If the current bootstrap/persistence layer cannot observe a one-beat content change without broad root invalidation, record G04 as `FG_PRODUCT_FAILURE`; do not replace the test with a weaker whole-script scenario.

- [ ] **Step 4: Capture post-mutation DAG**

Persist:

```text
graph_after.json
next_action_after.json
expected_descendants.json
actual_outdated.json
```

- [ ] **Step 5: Enforce precision**

Compute:

```text
falsePositive = actual OUTDATED - expected descendants
falseNegative = expected descendants - actual OUTDATED
```

PASS requires:

```text
falsePositive = 0
falseNegative = 0
mutated beat stable ID unchanged
unrelated sibling branches retain their prior effective status
```

- [ ] **Step 6: Re-hash baseline**

Baseline/source must remain unchanged.

---

## Task 7: Execute G05 — Version / Lock / Restore with restart persistence

**Files:**
- Create: `scripts/final_validation/run_g05_version_lock_restore.py`
- Create at runtime: `temp/final_system_validation/versions_and_locks/**`
- Working copy: `temp/final_system_validation/working_copies/G05_versions/`

- [ ] **Step 1: Create G05 copy and choose one existing lockable artifact**

Prefer a Shot because current APIs are documented for stable-ID mutation and lock operations.

Read:

```http
GET /api/projects/{dir}/visual/shots/{shot_id}
GET /api/projects/{dir}/history/shot/{shot_id}
```

- [ ] **Step 2: Produce a meaningful revision**

Use the supported Shot PATCH route to change a validation-safe prompt field while preserving stable ID:

```http
PATCH /api/projects/{dir}/visual/shots/{shot_id}
```

Then capture the new revision ID through the history route.

- [ ] **Step 3: Lock and prove overwrite protection**

Use:

```http
POST /api/projects/{dir}/lock/shot/{shotId}
```

Attempt the supported bulk/regenerate behavior that would otherwise touch the Shot. Expect lock protection according to current contract; capture HTTP/domain error and unchanged content hash.

- [ ] **Step 4: Prove lock persistence across restart**

Stop/restart Studio using owned-process controls, reopen the G05 project, then verify `is_locked=true` remains persisted.

- [ ] **Step 5: Prove LOCKED + OUTDATED coexistence**

Change the appropriate upstream dependency on this isolated copy so the locked Shot becomes OUTDATED without being overwritten. Capture both flags simultaneously.

- [ ] **Step 6: Prove restore semantics**

First attempt restore while locked and verify the current lock-conflict contract. Then explicitly unlock and restore using stable `revision_id`:

```http
POST /api/projects/{dir}/history/{revision_id}/restore
```

Verify:

```text
exact prior content restored
shot stable ID unchanged
old history preserved
new RESTORE revision appended
```

- [ ] **Step 7: Persist evidence and re-hash baseline**

Write all request/response bodies, before/after hashes, restart proof, and history sequence.

---

## Task 8: Execute G06 — Resource Scheduler & Recovery

**Files:**
- Create: `scripts/final_validation/run_g06_scheduler.py`
- Reuse: `scripts/verify_phase08_runtime_safety.py`
- Reuse: `scripts/verify_phase09_runtime_safety.py`
- Create at runtime: `temp/final_system_validation/resource_scheduler/**`
- Working copy: `temp/final_system_validation/working_copies/G06_scheduler/`

- [ ] **Step 1: Capture current resource policy**

Record exact configured concurrency for:

```text
CUDA_HEAVY
GPU_ENCODER
CPU_BOUND
IO_BOUND
```

and current ResourceGuard GPU conflict rule.

- [ ] **Step 2: Run existing Phase 8 and Phase 9 runtime-safety scripts**

Capture raw results rather than restating old reports:

```powershell
python scripts/verify_phase08_runtime_safety.py
python scripts/verify_phase09_runtime_safety.py
```

- [ ] **Step 3: Run controlled mixed-class stress on the G06 copy**

Submit/trigger jobs that exercise:

```text
one CUDA_HEAVY path (existing Kokoro or Whisper path)
one GPU_ENCODER path (NVENC render if available)
one CPU_BOUND path
cancellation while a resource permit is held
one controlled failure path
```

Do not require CUDA_HEAVY and GPU_ENCODER to execute simultaneously on the 4GB target GPU; the expected ResourceGuard behavior is serialized/conflict-safe scheduling.

- [ ] **Step 4: Capture process/resource trace**

Write:

```text
job_timeline.json
permit_timeline.json
nvidia_smi_before.txt
nvidia_smi_during.txt
nvidia_smi_after.txt
process_inventory.json
```

- [ ] **Step 5: Verify recovery**

After cancellation and controlled failure, submit one additional safe job and prove it can acquire resources and complete.

- [ ] **Step 6: Enforce G06 acceptance**

PASS requires:

```text
CUDA OOM = 0
deadlock = 0
permit leak = 0
orphan owned child = 0
subsequent job completes
```

Any unexplained process ownership violation is a global safety STOP.

---

## Task 9: Execute G07–G09 — Browser, Responsive Matrix, and Accessibility

**Files:**
- Create: `scripts/final_validation/run_g07_g09_browser.py`
- Reuse: `scripts/verify_phase06_browser.py`
- Reuse: `scripts/verify_phase06_manual.py`
- Reuse: `scripts/verify_phase06_target_sizes.py`
- Reuse: `scripts/verify_phase06_palette_dense.py`
- Reuse: `scripts/verify_phase09_browser.py`
- Create at runtime: `temp/final_system_validation/browser/**`
- Create at runtime: `temp/final_system_validation/responsive/**`
- Create at runtime: `temp/final_system_validation/accessibility/**`

- [ ] **Step 1: Start a fresh browser context/profile**

Do not reuse a Phase 6/9 historical profile or session. Record browser version and profile path.

- [ ] **Step 2: Verify G07 across all five Workbenches**

Use the current app UI and the canonical validation baseline/read-safe project where possible. Verify:

```text
Overview
Story
Voice
Visual / Scenes
Export
```

For each, record:

```text
workbench visible and non-blank
primary CTA reachable
Next Best Action where applicable
loading/empty/error/dirty state path
save/reload state
project-switch isolation
console errors
unhandled rejections
failed non-media requests
5xx responses
```

Also exercise the Phase 9 QA panel behavior in Export so G07 covers the latest production UI.

- [ ] **Step 3: Run the exact G08 11-configuration matrix**

Use these exact configurations:

```text
2560x1440
1920x1080
1440x900
1366x768
1280x720
1024x768
768x1024
390x844
360x800
320 CSS px reflow
200% browser zoom
```

For every configuration record:

```text
page-level horizontal overflow
primary CTA clipping/reachability
navigation reachability
drawer/sheet usability
modal/content reachability
screenshot
```

- [ ] **Step 4: Run G09 automated and manual accessibility checks**

Reuse Phase 6 scripts and explicitly verify:

```text
keyboard-only workbench path
visible focus
focus not fully obscured
modal/drawer trap
Escape closes topmost overlay
focus restore
hidden panels not tabbable
non-hover access
drag alternative or justified N/A
normal target-size policy
coarse-pointer 44x44 policy
reduced-motion behavior
aria-live progress/status
Vietnamese accessible names/labels
```

Wording in evidence must remain `WCAG 2.2 AA-oriented validation`; do not claim full conformance.

- [ ] **Step 5: Separate gate outcomes**

The single runner may share one browser session, but it must write independent immutable results to:

```text
browser/result.json        # G07
responsive/result.json     # G08
accessibility/result.json  # G09
```

A browser/CDP startup failure may receive one immediate infrastructure retry. A product assertion failure is not retried to obtain a green result.

---

## Task 10: Execute G10 — Portable Export Package Verification

**Files:**
- Create: `scripts/final_validation/run_g10_export_package.py`
- Reuse: `studio/portable_package.py`
- Reuse: `tests/test_phase04_media_asset_pipeline.py`
- Reuse: `tests/test_phase04_closure_gaps.py`
- Create at runtime: `temp/final_system_validation/export_package/**`
- Working copy: `temp/final_system_validation/working_copies/G10_export/`

- [ ] **Step 1: Create G10 copy and provision deterministic accepted validation media**

Use Task 3 fixture provisioning. Do not modify the canonical baseline.

- [ ] **Step 2: Request the production portable package**

Use the real endpoint:

```http
GET /api/projects/{id}/export/portable-package
```

Save the returned ZIP as raw evidence.

- [ ] **Step 3: Extract to an evidence-only directory and verify path safety**

Reject:

```text
absolute paths
.. traversal
UNC paths
unexpected .env
state.db
.bak
.log
weights/temp artifacts
```

- [ ] **Step 4: Verify all 10 accepted artifact groups**

The extracted package must contain the canonical groups:

```text
1 Script
2 Master WAV PCM 24kHz
3 Subtitle SRT/VTT
4 Shots JSON
5 Shots CSV
6 Visual Bible
7 Prompts
8 Asset Manifest
9 Accepted Media
10 manifest.json
```

- [ ] **Step 5: Recompute every manifest checksum**

Write `checksum_verification.json` with one row per packaged file. Require 100% match and no dangling entries.

- [ ] **Step 6: Verify accepted-media semantics**

Every included validation asset must be accepted/canonical according to current Phase 4 rules, must preserve truthful provenance, and no GENERATED/SELECTED-only or REJECTED media may leak into the package.

- [ ] **Step 7: Record package performance as observational evidence**

Record package size and build/checksum time. Do not create a new hard SLA.

---

## Task 11: Execute G11 — Render Manifest Verification

**Files:**
- Create: `scripts/final_validation/run_g11_manifest.py`
- Reuse: current Phase 7 manifest compiler/validator modules discovered in Task 1
- Create at runtime: `temp/final_system_validation/render_manifest/**`
- Working copy: `temp/final_system_validation/working_copies/G11_manifest/`

- [ ] **Step 1: Recreate a fresh G11 copy and provision accepted validation media**

Do not reuse the Task 3 smoke copy.

- [ ] **Step 2: Create a fresh immutable export snapshot**

Use the existing export lifecycle to obtain a new `export_NNN` ID. Do not overwrite an historical export.

- [ ] **Step 3: Persist the real Phase 7 Render Manifest**

Canonical path must be:

```text
projects/<projectId>/exports/<exportId>/render-manifest.json
```

Use the current explicit compile/persistence path; do not synthesize a fake manifest in the validation script.

- [ ] **Step 4: Run all current ten Phase 7 validation gates**

Require these exact gate codes:

```text
PATH_SANDBOX_AND_PRESENCE
ACCEPTED_ASSET_INTEGRITY
UNSUPPORTED_MEDIA_TYPE
NON_POSITIVE_DURATION
INVALID_TIMESTAMPS
TRANSITION_AWARE_OVERLAPS
TIMELINE_GAPS
REQUIRED_MASTER_AUDIO
AUDIO_DURATION_ALIGNMENT
OPTIONAL_TRACK_HANDLING
```

Persist the structured validator output.

- [ ] **Step 5: Verify manifest invariants independently**

Re-read the JSON and assert:

```text
len(videoTrack.clips) = 141
shot IDs match canonical 141-shot ordering
frameRate = 24/1
timeBase = 1/24
integer frame coordinates only
endFrame = startFrame + durationFrames
half-open interval semantics
sourceHashes match the actual working-copy compiler inputs
manifestHash recomputes exactly
accepted asset versions/checksums match files
```

- [ ] **Step 6: Preserve manifest identity for downstream gates**

Write `g11_identity.json` containing at minimum:

```text
projectId
exportId
manifestHash
expectedFinalFrames
```

This identity is a structural reference for downstream verification only. G12 creates its own fresh export and persisted manifest in `G12_render`; canonical G13 then consumes the exact Final from that same G12 copy so the render-to-QA lineage is continuous.

---

## Task 12: Execute G12 and G13 — Real Final Render followed by automatic Render QA

**Files:**
- Create: `scripts/final_validation/run_g12_g13_render_qa.py`
- Reuse: `studio/manifest_render_service.py`
- Reuse: `studio/render_qa_service.py`
- Reuse: `scripts/verify_phase08_render_engine.py`
- Reuse: `scripts/verify_phase09_render_qa.py`
- Create at runtime: `temp/final_system_validation/render/**`
- Create at runtime: `temp/final_system_validation/render_qa/**`
- Canonical working copy: `temp/final_system_validation/working_copies/G12_render/`
- Diagnostic-only reserve: `temp/final_system_validation/working_copies/G13_qa_diagnostics/`

- [ ] **Step 1: Create the fresh G12 render copy; reserve G13 diagnostics separately**

Provision deterministic accepted validation media in `G12_render`. **Canonical G13 must execute on the exact Final produced inside this same G12 copy** so binary and lifecycle lineage are continuous. `G13_qa_diagnostics` is only for optional isolated manual-rerun/negative diagnostics after canonical automatic QA evidence is frozen; it must never replace the canonical G13 result. Never copy a completed `final.mp4` into another project copy and call it the automatic G13 run.

- [ ] **Step 2: In the G12 copy, create a fresh export + persisted Render Manifest**

Capture `projectId`, `exportId`, `manifestHash`, and `expectedFinalFrames` before rendering.

- [ ] **Step 3: Trigger the real production Final Render**

Use:

```http
POST /api/projects/{dir_name}/render/final
Content-Type: application/json

{"exportId":"<current export>","encoderProfile":"FINAL_QUALITY"}
```

Poll the existing `/api/activity/jobs` path until terminal state. Preserve job progress history.

- [ ] **Step 4: Verify the G12 Final independently with ffprobe**

Require:

```text
MP4 readable
one primary H.264 video stream
1920x1080
24/1 CFR
yuv420p
SAR 1:1
AAC audio
48000 Hz
stereo
exact expected frame count
A/V duration within existing Phase 8/9 frame tolerance
```

Also verify:

```text
final path = exports/<exportId>/final.mp4
render-metadata.json exists and matches manifestHash/exportId
atomic no-replace contract retained
scratch directory cleaned
```

- [ ] **Step 5: Verify fallback classification without weakening G12**

Reuse existing Phase 8 focused/runtime tests to prove only `ENCODER_HARDWARE_UNAVAILABLE`-class failures receive the single CPU fallback. Do not intentionally corrupt the production Final to force fallback during the main G12 run.

- [ ] **Step 6: Verify automatic Phase 9 handoff on the same exact Final**

After render completion, wait for automatic Render QA. Do not substitute a manual QA-only run for the automatic-handoff requirement.

Use the existing QA APIs for observation:

```http
GET /api/projects/{id}/exports/{exp}/qa/latest
GET /api/projects/{id}/exports/{exp}/qa/runs
```

If automatic handoff does not occur, G13 fails even if a manual rerun would pass.

- [ ] **Step 7: Verify G13 exact binary identity**

Compute SHA-256 of `final.mp4` and compare with the QA report. Require lineage equality across:

```text
projectId
exportId
manifestHash
finalSha256
renderJobId
qaJobId
qaRunId
```

- [ ] **Step 8: Verify technical QA result**

Accept only:

```text
PASS
PASS_WITH_WARNINGS
```

with final artifact state `READY`.

Reject:

```text
FAIL
engine failure
INTERRUPTED
missing report
hash mismatch
report/final lineage mismatch
```

Confirm the report is immutable and Phase 9’s full-file decode/probe path executed.

- [ ] **Step 9: Enforce Phase 9 performance threshold where applicable**

For the long-form fixture, require existing hard contract:

```text
QA_RTF <= 1.0
```

Record probe/decode/evaluation/total QA timings.

- [ ] **Step 10: Keep G12 and G13 outcomes separate**

Write independent `result.json` files. A good render with failed automatic QA is `G12 PASS / G13 FAIL`, not a combined PASS.

---

## Task 13: Execute G02 — Canonical 79/141 Full E2E on its dedicated clone

**Files:**
- Create: `scripts/final_validation/run_g02_e2e.py`
- Reuse: production APIs/UI and the gate runners’ shared helpers only
- Create at runtime: `temp/final_system_validation/e2e/**`
- Working copy: `temp/final_system_validation/working_copies/G02_e2e/`

- [ ] **Step 1: Create a brand-new G02 E2E copy from the frozen baseline**

It must not contain state from G04/G05/G10/G11/G12/G13.

- [ ] **Step 2: Provision deterministic accepted media through the same approved fixture path**

Provenance remains `VALIDATION_FIXTURE`; do not call Flow/Veo.

- [ ] **Step 3: Perform a controlled cold restart before E2E**

Stop owned services, verify ports closed, start Kokoro/Studio fresh, open the G02 project from a fresh browser context, and capture startup/reopen evidence.

- [ ] **Step 4: Walk the production path, not internal shortcuts**

Verify through UI and/or current production APIs in canonical order:

```text
Overview / project open
Story
Voice
Visual
Export preflight
Portable Package
Render Manifest compile/persist
Final Render job
Automatic Render QA
READY
```

Do not use mocks or directly mark statuses READY.

- [ ] **Step 5: Capture E2E invariants before and after**

Require:

```text
Scenes = 79
Shots = 141
shot ID sequence unchanged
source/canonical authoring hashes unchanged except explicitly allowed working-copy lifecycle additions
export lineage valid
manifest lineage valid
render metadata lineage valid
QA lineage valid
final.mp4 exists and is READY
```

- [ ] **Step 6: Restart and reopen after READY**

Stop/restart Studio, reopen G02, and prove the final READY state, export history, render metadata, and latest QA report persist correctly.

- [ ] **Step 7: Write full E2E timeline evidence**

At minimum:

```text
workflow_results.json
artifact_lineage.json
before_after_integrity.json
job_timeline.json
browser_console.json
browser_network.json
screenshots/
```

- [ ] **Step 8: Enforce hard-blocker semantics**

Any broken core path, count drift, lineage mismatch, lost persistence, or final not READY makes G02 FAIL / `FG_PRODUCT_FAILURE` or `FG_DATA_INTEGRITY_FAILURE` as appropriate.

---

## Task 14: Finalize Pass 1, evidence completeness, blocker register, report, and review-pending roadmap state

**Files:**
- Create: `scripts/final_validation/finalize_pass1.py`
- Create: `temp/final_system_validation/pass1_summary.json`
- Create: `temp/final_system_validation/blocker_register/blockers.json`
- Create: `temp/final_system_validation/final_validation_summary.md`
- Create: `docs/implementation/FINAL_SYSTEM_INTEGRATION_AND_PRODUCTION_VALIDATION_REPORT.md`
- Modify: `docs/implementation/ROADMAP_STATUS.md`

- [ ] **Step 1: Run evidence completeness meta-gate**

For each G01–G13 require the expected immutable files. At minimum:

```text
result.json
summary.md
commands.log
environment_ref.json
referenced raw evidence exists
```

If a gate says PASS while referenced evidence is missing, convert final interpretation to `FG_EVIDENCE_INCOMPLETE`; do not allow a Production Ready candidate.

- [ ] **Step 2: Verify environment and baseline remained trustworthy through the run**

Compare current:

```text
branch
HEAD
pip fingerprint
FFmpeg/ffprobe versions
browser version
source-project hashes
canonical-baseline hashes
Kokoro upstream tracked state
```

against Task 3 fingerprints. Unexpected material change invalidates evidence after the change point.

- [ ] **Step 3: Build canonical blocker register**

For every failure/conditional issue write:

```json
{
  "id": "FG-001",
  "gate": "G12",
  "severity": "BLOCKER",
  "category": "RENDER",
  "summary": "...",
  "reproduction": ["..."],
  "expected": "...",
  "actual": "...",
  "evidence": ["..."],
  "affectedSubsystem": "...",
  "status": "OPEN"
}
```

Allowed severity values:

```text
BLOCKER
CONDITIONAL
OBSERVATION
```

Do not prescribe speculative product fixes in Pass 1; describe the confirmed defect and evidence.

- [ ] **Step 4: Reduce the candidate verdict mechanically**

Rules:

```text
13/13 PASS + complete evidence + 100% regression -> PRODUCTION READY candidate
Only non-core G07/G08/G09 minor issues -> CONDITIONAL candidate
Any core hard-blocker FAIL or mandatory NOT RUN -> NOT READY candidate
```

The execution agent must never output `FINAL / VERIFIED`.

- [ ] **Step 5: Write the required 16-section Final Gate report**

Use exactly this structure:

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

Section 16 must say only:

```text
FINAL SYSTEM GATE: VALIDATION COMPLETE / REVIEW PENDING
Candidate verdict: PRODUCTION READY | CONDITIONAL | NOT READY
```

with the production-readiness scope explicitly limited to the validated local workstation/runtime.

- [ ] **Step 6: Update ROADMAP_STATUS to review-pending only**

Do not mark Final Gate `PRODUCTION READY / VERIFIED` yourself. Use a state equivalent to:

```text
Final System Gate = VALIDATION COMPLETE / REVIEW PENDING
Candidate verdict = <value>
External review = REQUIRED
```

Phase 1–9 remain `PASS / FINAL / VERIFIED` unless evidence proves the baseline itself is invalid; do not rewrite history casually.

- [ ] **Step 7: Run final harness self-test and report consistency scan**

```powershell
python scripts/final_validation/selftest_final_validation.py
python -m pytest --tb=short -q
```

The second command is a final canonical regression only if no product/source test code changed during Pass 1. Capture fresh output rather than reusing G01 logs.

- [ ] **Step 8: Run placeholder/ambiguity scan on Final Gate artifacts**

Search the new plan/report/evidence summaries for accidental placeholders:

```powershell
rg -n "TBD|TODO|implement later|Similar to|similar to|probably ready|mostly ready" docs/implementation/FINAL_SYSTEM_INTEGRATION_AND_PRODUCTION_VALIDATION_REPORT.md temp/final_system_validation scripts/final_validation
```

Expected: no unresolved placeholder language in official report/evidence.

- [ ] **Step 9: Final Git safety checkpoint**

```powershell
git status --short
git diff --stat
git diff -- docs/implementation/ROADMAP_STATUS.md docs/implementation/FINAL_SYSTEM_INTEGRATION_AND_PRODUCTION_VALIDATION_REPORT.md scripts/final_validation
```

Verify no product-source edits occurred during Pass 1. If product source changed, identify when/why and invalidate the affected evidence rather than hiding the change.

- [ ] **Step 10: STOP**

Do not fix blockers in this task.

Do not begin:

```text
YouTube Intelligence Layer v1
Agent/MCP Integration
Google/Veo Provider Integration
multilingual expansion
Timeline Editor
```

Wait for external review. If blockers exist, create a separate corrective-closure design/plan only after approval.

---

# Pass 1 Execution Order

The execution agent must preserve this exact sequence:

```text
Task 1  Governance/worktree audit
Task 2  Harness core
Task 3  Preflight/baseline/fixture capability
Task 4  G01 Regression
Task 5  G03 Integrity
Task 6  G04 Dependency
Task 7  G05 Version/Lock/Restore
Task 8  G06 Scheduler
Task 9  G07/G08/G09 Browser/Responsive/A11y
Task 10 G10 Portable Package
Task 11 G11 Render Manifest
Task 12 G12/G13 Final Render + automatic QA
Task 13 G02 Full 79/141 E2E
Task 14 Pass-1 finalization + STOP
```

This deliberately leaves G02 until the end so an E2E failure can be diagnosed against already-collected subsystem evidence.

# Gate-to-Task Coverage Matrix

| Final Gate | Task | Primary Evidence Root |
|---|---:|---|
| G01 Full Canonical Regression | 4 | `temp/final_system_validation/regression/` |
| G02 Canonical 79/141 E2E | 13 | `temp/final_system_validation/e2e/` |
| G03 Data Integrity & Persistence | 5 | `temp/final_system_validation/data_integrity/` |
| G04 Dependency Micro-Propagation | 6 | `temp/final_system_validation/dependency/` |
| G05 Version / Lock / Restore | 7 | `temp/final_system_validation/versions_and_locks/` |
| G06 Resource Scheduler & Recovery | 8 | `temp/final_system_validation/resource_scheduler/` |
| G07 Browser Workflow | 9 | `temp/final_system_validation/browser/` |
| G08 Responsive Layout Matrix | 9 | `temp/final_system_validation/responsive/` |
| G09 Accessibility Hardening | 9 | `temp/final_system_validation/accessibility/` |
| G10 Portable Export Package | 10 | `temp/final_system_validation/export_package/` |
| G11 Render Manifest Verification | 11 | `temp/final_system_validation/render_manifest/` |
| G12 Final Render Deliverable | 12 | `temp/final_system_validation/render/` |
| G13 Automated Render QA | 12 | `temp/final_system_validation/render_qa/` |

# Corrective Closure Boundary

Corrective closure is intentionally **not** implemented by this plan. If Pass 1 finds blockers:

```text
Pass 1 evidence frozen
→ blocker register reviewed
→ STOP
→ separate corrective-closure design/plan approved
→ targeted product fixes
→ affected-gate reruns
→ nearby regression
→ full regression
→ external review
```

At most two corrective rounds are allowed before requiring architecture/root-cause review. This rule prevents an endless patch loop that merely forces the gate green.

# Self-Review

## Spec coverage

Covered explicitly:

- Final Gate is not Phase 10.
- Canonical 79/141 project source.
- Immutable baseline and isolated mutation copies.
- Audit-first Pass 1.
- One-agent sequential execution.
- All 13 mandatory gates.
- Current-regression count semantics and historical 1062 reference.
- StoryBeat micro-propagation precision.
- Lock/revision/restart semantics.
- Scheduler/OOM/cancel/permit recovery.
- Five-workbench browser acceptance.
- Exact 11 responsive configurations.
- WCAG 2.2 AA-oriented wording and checks.
- Portable Package 10 artifact groups.
- Current ten Phase 7 validation codes.
- Real Phase 8 Final render.
- Automatic Phase 9 QA handoff and exact binary lineage.
- External Flow/Veo exclusion.
- Deterministic validation media provenance.
- Cold-start and environment fingerprint.
- Evidence append-only contract.
- Failure taxonomy and retry rules.
- Global safety STOP conditions.
- Blocker register.
- Candidate verdict reduction.
- 16-section report.
- External-review promotion ownership.
- Post-MVP STOP boundary.

No design requirement is intentionally deferred inside Pass 1.

## Placeholder scan

No `TBD`, unresolved `TODO`, “implement later”, or “similar to Task X” placeholders are used as requirements. Runtime-derived identifiers such as the actual current `exportId`, `jobId`, `qaRunId`, selected `shotId`, and `revisionId` are deliberately discovered from the real system and persisted as evidence rather than pre-invented.

## Interface consistency

Canonical interfaces referenced throughout are internally consistent with current project reports:

```text
GET  /api/projects/{dir}/dependencies/graph
GET  /api/projects/{dir}/next-action
GET  /api/projects/{dir}/history/{type}/{id}
POST /api/projects/{dir}/history/{revision_id}/restore
POST /api/projects/{dir}/lock/{type}/{id}
PATCH /api/projects/{dir}/visual/shots/{shot_id}
GET  /api/projects/{id}/export/portable-package
POST /api/projects/{dir}/render/final
GET  /api/projects/{id}/exports/{exp}/qa/latest
GET  /api/projects/{id}/exports/{exp}/qa/runs
GET  /api/activity/jobs
```

The plan requires Task 1 source-audit confirmation before relying on any callable symbol whose Python function name may have changed while preserving the public contract.

## Scope check

This is one bounded validation program for the already-approved Final Quality Gate. It does not implement post-MVP subsystems and does not include corrective product changes. A separate approved plan is required if Pass 1 reveals blockers.
