# UNFOLDIQ — SUBPHASE 3B FINAL VERIFICATION & GAP CLOSURE PROMPT
## Voice Workbench
### Targeted closure before authorizing Subphase 3C

> **Task type:** VERIFY / FIX SUBPHASE 3B ONLY
>
> **Current implementation report:** `docs/implementation/PHASE_03B_IMPLEMENTATION_REPORT.md`
>
> **Current architecture doc:** `docs/implementation/PHASE_03B_VOICE_WORKBENCH.md`
>
> **Current claimed regression:** `501 / 501 PASS`
>
> **Do NOT start Subphase 3C.**
>
> **Do NOT redesign Visual Workbench.**
>
> **Do NOT start 3D or Phase 4+.**
>
> The current implementation appears substantially complete, but the uploaded reports do not yet prove several non-negotiable 3B contracts and contain a few architecture inconsistencies. This task closes only those gaps.

---

# 0. Operating Rules

Mandatory order:

```text
INSPECT CURRENT SOURCE + EXISTING EVIDENCE
→ VERIFY THE GAPS BELOW
→ FIX ONLY REAL DEFECTS
→ ADD FOCUSED TESTS
→ BROWSER VALIDATION
→ FULL REGRESSION IF SOURCE/TESTS CHANGE
→ DATA INTEGRITY
→ DOC/ROADMAP SYNC
→ FINAL VERIFICATION REPORT
→ STOP
```

Rules:

- Do not rewrite already-correct 3B code.
- Do not fabricate evidence.
- Reuse Phase 1/2/3A contracts.
- Do not replace stable IDs with positional identity.
- Do not bypass `TTSProvider`, `STTProvider`, `LocalResourceScheduler`, `StateStore`, or VersionManager.
- Do not use `git clean -fd`.

---

# 1. Gate A — Verify the `pre-phase-3b` Git Checkpoint

## Current inconsistency

The 3B implementation report says:

```text
pre-phase-3b tag: c1fa0ab
```

The previous approved 3A baseline also used:

```text
pre-phase-3a = c1fa0ab
```

If these are truly the same commit, the 3B rollback checkpoint may not contain the completed 3A implementation.

## Required verification

Run:

```bash
git rev-parse pre-phase-3a
git rev-parse pre-phase-3b
git show --stat --oneline pre-phase-3b
git status --short
git log --oneline --decorate -n 20
```

Verify:

```text
pre-phase-3b
→ contains the full approved Subphase 3A state
→ predates 3B implementation changes
```

If `pre-phase-3b` incorrectly points to the old pre-3A baseline:

- create a proper approved 3A checkpoint commit/tag;
- do not destroy current work;
- document exactly how the checkpoint was repaired.

Do not move historical tags silently without documenting it.

Evidence:

```text
temp/phase03b_final_verification/git/checkpoint_audit.md
```

---

# 2. Gate B — Stable Chunk Identity Must Be Canonical

## Current inconsistency

The architecture uses an ID-based streaming route:

```text
GET /api/projects/{dir}/chunks/{id}/audio
```

but single-chunk regeneration is documented as:

```text
POST /api/projects/{dir}/voice-qa/rerender-chunk/{index}
```

The 3B contract explicitly forbids persistent mutation by array index.

## Required source trace

Inspect:

```text
Voice Navigator selection
single-chunk rerender caller
bulk rerender caller
Voice QA issue → chunk mapping
Pronunciation impact mapping
audio streaming
revision / lock calls
```

Determine whether the frontend and backend mutations use:

```text
chunk_id / artifact_id
```

or positional index.

## Canonical requirement

Persistent identity:

```text
chunk_id
```

not:

```text
array index
visible ordinal
DOM position
```

### Preferred canonical route

If source supports it, use something equivalent to:

```text
POST /api/projects/{dir}/voice/chunks/{chunk_id}/regenerate
```

Do NOT invent a new route blindly; first inspect existing routing architecture.

If the old `{index}` route must remain for backward compatibility:

```text
/index route = compatibility alias only
frontend canonical dependency = stable-ID route
```

and the compatibility adapter must resolve the current stable ID safely.

## Mutation tests

Verify:

```text
select chunk by stable ID
→ insert/reorder another chunk
→ regenerate originally selected chunk
→ correct chunk is still mutated
```

Also test:

```text
QA issue mapping
lock
revision restore
audio lookup
```

by stable ID.

Evidence:

```text
temp/phase03b_final_verification/chunk_identity/
├── canonical_identity_contract.md
└── stable_id_mutation_results.json
```

---

# 3. Gate C — TTSProvider / STTProvider Must Be the Active Production Paths

The current implementation report lists provider evidence artifacts, but the report itself does not prove the active call graph.

## TTS

Trace:

```text
Voice Workbench action
→ API route
→ service
→ TTSProvider
→ current provider implementation
→ scheduler
```

Required:

```text
NO frontend/business-layer direct Kokoro bypass
```

Kokoro may remain the active provider implementation, but the contract must pass through `TTSProvider`.

## STT

Trace:

```text
Voice Workbench alignment action
→ API route
→ service
→ STTProvider
→ Faster-Whisper implementation
→ scheduler
```

Required:

```text
NO frontend/business-layer direct Faster-Whisper bypass
```

## Tests

Use fakes for deterministic unit coverage and existing production integration evidence where appropriate.

Do not force real GPU tests into every environment if the existing integration-test policy separates them.

Evidence:

```text
temp/phase03b_final_verification/provider_paths/
├── tts_provider_callgraph.md
├── stt_provider_callgraph.md
└── provider_path_results.json
```

---

# 4. Gate D — Generation / Alignment Transaction Semantics

3B must preserve the Phase 2 committed-output contract.

## TTS failure scenario

Start with:

```text
committed audio = valid
downstream state = current/ready
```

Then simulate:

```text
replacement TTS generation starts
→ generation fails before commit
```

Expected:

```text
old committed audio remains available
old content hash remains canonical
downstream is NOT invalidated merely because an attempt started
```

Then test successful replacement:

```text
candidate succeeds
→ validate
→ atomic commit
→ content hash changes
→ only true downstream dependents become OUTDATED
```

## STT/alignment failure scenario

Same rule:

```text
existing committed timestamps/cues remain valid
```

until a replacement is successfully committed.

No “delete first, regenerate later” workflow.

Evidence:

```text
temp/phase03b_final_verification/transactional_generation/
├── tts_replacement_results.json
└── stt_replacement_results.json
```

---

# 5. Gate E — Lock, Revision & Bulk Regeneration Semantics

## Locked + OUTDATED

Explicitly verify a chunk can be:

```text
is_locked = true
effectiveStatus = OUTDATED
```

UI must show both:

```text
Đã khóa
Cần cập nhật
```

Lock does not mean “current”.

## Regeneration

For locked chunk:

```text
play/review/transcript/QA = allowed
overwrite/regenerate = blocked
```

unless an existing explicit approved override path exists.

## Bulk regenerate

`Tạo lại toàn bộ giọng đọc` must:

- be explicitly user-triggered;
- clearly communicate impact;
- skip or safely handle locked chunks;
- not silently overwrite approved locked audio;
- not auto-trigger by simply opening the Workbench.

## Revision restore

The architecture currently says:

```text
one-click restore
```

Verify this does not mean destructive restore without safeguards.

Restore must:
- use existing VersionManager;
- respect lock/conflict contract;
- require an appropriate confirmation for consequential replacement;
- preserve stable identity.

Evidence:

```text
temp/phase03b_final_verification/lock_revision/
├── lock_outdated_results.json
├── bulk_regeneration_results.json
└── revision_restore_results.json
```

---

# 6. Gate F — Job State Must Remain Separate from Artifact State

Verify UI and data model do not merge:

```text
Job:
QUEUED
RUNNING
COMPLETED
FAILED
CANCELLED
```

with:

```text
Artifact:
DRAFT
NEEDS_REVIEW
READY
OUTDATED
BLOCKED
```

Example valid state:

```text
artifact = OUTDATED
job = QUEUED
```

or:

```text
artifact = READY
replacement job = FAILED
old committed artifact remains READY
```

User-facing Vietnamese labels must make the distinction understandable.

Evidence:

```text
temp/phase03b_final_verification/job_artifact_state/state_matrix.md
```

---

# 7. Gate G — Fix Voice vs Model Terminology

## Current documentation issue

The Voice Inspector currently documents:

```text
Kokoro model selector:
af_heart
af_bella
am_adam
...
```

These identifiers are Kokoro **voices**, not model identifiers.

## Required correction

User-facing UI:

```text
Giọng đọc
```

Internal semantic field:

```text
voice / voice_id
```

Examples:

```text
af_heart
af_bella
am_adam
```

Provider/model should remain separate where the current architecture exposes them:

```text
Provider → Kokoro provider implementation
Model    → Kokoro / actual model identifier/version
Voice    → af_heart / af_bella / ...
```

Do not rename internal API fields blindly; inspect the existing schema first.

Correct:

```text
#voice-select-model
```

if it actually stores a voice and can be safely migrated.

If changing its DOM ID risks unnecessary compatibility breakage, the DOM ID may remain temporarily internal, but:
- data semantics;
- UI label;
- docs;
- API mapping

must correctly call it a **voice**, not a model.

Evidence:

```text
temp/phase03b_final_verification/voice_settings/voice_model_semantics.md
```

---

# 8. Gate H — Voice Navigator Accessibility for 135 Chunks

The architecture declares:

```text
role=listbox
roving tabindex
ArrowUp / ArrowDown
```

With ~135 chunks, explicitly verify the complete composite behavior.

Required:

```text
ArrowDown → next chunk
ArrowUp   → previous chunk
Home      → first chunk
End       → last chunk
Tab       → enters/exits the composite predictably
```

Do not require 135 Tab presses to leave the Navigator.

Selection, focus, and `aria-selected` must stay synchronized.

If it is not intended to be a listbox, use simpler semantics instead of incomplete ARIA.

Evidence:

```text
temp/phase03b_final_verification/accessibility/
└── voice_navigator_keyboard.json
```

---

# 9. Gate I — Word Cue Keyboard Strategy for ~1,422 Interactive Tokens

The architecture states:

```text
1,400+ interactive word tokens
click-to-seek
```

Do NOT create ~1,422 sequential Tab stops.

## Verify actual semantics

A mouse user can:

```text
click cue → seek audio
```

A keyboard user must also have a practical equivalent.

Use one coherent pattern, for example:

```text
roving tabindex within cue collection
or
another documented composite/focus-management model
```

Required:

- keyboard can reach the cue interaction;
- user can move among relevant cues without tabbing through 1,422 items;
- activate/seek is keyboard operable;
- Tab exits the cue component predictably;
- active playback highlighting does not steal focus;
- playback does not spam accessibility announcements.

Do not assign inappropriate `listbox` semantics unless selection behavior genuinely matches a listbox.

Evidence:

```text
temp/phase03b_final_verification/accessibility/
└── word_cue_keyboard_results.json
```

---

# 10. Gate J — Native Range Controls: Semantics & Labels

The architecture says:

```text
input[type="range"] with ARIA role slider
```

Native `<input type="range">` already carries native slider semantics.

## Inspect

For:

```text
audio seek
TTS speed
```

verify:

- native range is used where possible;
- no redundant/misleading ARIA overrides;
- each control has a Vietnamese accessible name via visible `<label>` / `aria-labelledby`, or `aria-label` only if no visible label exists;
- `min`, `max`, `step`, `value` are valid;
- the seek control exposes a useful value description where needed;
- keyboard behavior works without custom key handling breaking native behavior.

Do not manually recreate native slider keyboard behavior if the native input already provides it.

Evidence:

```text
temp/phase03b_final_verification/accessibility/
└── slider_accessibility_results.json
```

---

# 11. Gate K — Pronunciation Impact & No Silent Regeneration

Verify the existing pronunciation dictionary behavior instead of only proving that the card renders.

Where supported, test:

```text
add
edit
delete
search/list
preview/test
```

Most important:

```text
committed pronunciation rule changes
→ determine affected chunk(s)
→ mark appropriate audio needing update/review
→ NO automatic TTS generation
```

Unrelated chunks must not be invalidated if selective impact is known.

Confirm the UI does not invent a phonetic notation contract different from the existing backend/provider mechanism.

Evidence:

```text
temp/phase03b_final_verification/pronunciation/
├── pronunciation_crud_results.json
└── impact_invalidation_results.json
```

---

# 12. Gate L — Audio/Subtitle Download Controls Must Be Real

The architecture exposes:

```text
.wav
.mp3
.srt
.json
```

Verify every visible download action:

```text
has a real route/file
returns the correct media/format
does not produce a dead link
does not fabricate MP3 if only WAV exists
```

If a format is not actually produced by the current pipeline:
- remove/hide the control;
- or explicitly generate it through an existing supported path.

Do not add conversion infrastructure outside 3B merely to keep an invented dropdown option.

Evidence:

```text
temp/phase03b_final_verification/downloads/download_results.json
```

---

# 13. Gate M — Transcript/Cue Runtime Performance Contract

The architecture claims:

```text
~1,422 cues
binary-search active cue lookup
<0.2 ms
zero network during timeupdate
```

Verify the measurement rather than relying on prose.

Document:

```text
cue count
measurement API
number of runs/samples
median
p95 if enough samples
network requests caused by timeupdate
DOM scope updated per tick
```

Required:

```text
timeupdate
→ NO network request
→ no full Workbench re-render per tick
```

No arbitrary SLA is required.

Do not introduce Phase 5 virtualization unless real measurements show a blocker.

Evidence:

```text
temp/phase03b_final_verification/performance/
├── cue_sync_methodology.md
└── cue_sync_measurements.json
```

---

# 14. Gate N — Full 3B Data-Integrity Matrix

The implementation report says:

```text
100% UNTOUCHED
```

Surface the actual matrix.

Verify preservation of:

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

If a targeted test intentionally mutates a fixture:
- use an isolated copy;
- restore it;
- do not mutate the reference project silently.

Evidence:

```text
temp/phase03b_final_verification/integrity/
├── semantic_diff.json
└── integrity_matrix.md
```

---

# 15. Gate O — Browser / API / Language / Compatibility Closure

Using the real application, verify:

```text
1920x1080
1440x900
1366x768
```

Workflow:

```text
Open project
→ Giọng đọc
→ select chunk
→ play/pause
→ seek
→ click/keyboard-seek word cue
→ change preview playback rate
→ verify TTS speed unchanged
→ inspect Voice QA
→ inspect Pronunciation
→ inspect lock/revision
→ return Tổng quan
→ return Kịch bản
→ return Giọng đọc
→ verify state
→ open Hình ảnh & Cảnh compatibility
→ open Xuất video compatibility
```

Expected:

```text
unexpected console errors = 0
unhandled rejections = 0
unexpected failed API requests = 0
```

Verify canonical frontend route:

```text
GET /api/projects/{id}/v2/voice
```

If `/voice` remains:
- compatibility alias only;
- not the canonical frontend dependency.

Language audit:

```text
UI = Vietnamese-first
narration/transcript content = original project language
no automatic translation
```

---

# 16. Gate P — Roadmap Governance Must Wait for External Review

## Current issue

`ROADMAP_STATUS.md` already says:

```text
Subphase 3B = PASS / FINAL / VERIFIED
Subphase 3C = READY TO START
```

before this external review gate has passed.

This conflicts with the roadmap discipline:

```text
Code
→ Tests
→ Regression
→ Report
→ Review Gate PASS
→ next subphase
```

## Required state during this closure

Until this verification is complete:

```text
3B = IMPLEMENTED / REVIEW PENDING
3C = NOT STARTED
```

Only after every final closure gate passes may canonical docs be changed to:

```text
3B = PASS / FINAL / VERIFIED
3C = READY TO START / NOT STARTED
```

Do not start 3C in the same task.

---

# 17. Required Final Report

Create:

```text
docs/implementation/PHASE_03B_FINAL_VERIFICATION_REPORT.md
```

Required sections:

```text
1. Executive Summary
2. Git Checkpoint Audit
3. Stable Chunk Identity Contract
4. TTSProvider / STTProvider Call Graph
5. Transactional TTS/STT Replacement
6. Lock / Revision / Bulk Regeneration
7. Job vs Artifact State Model
8. Voice vs Model Semantics
9. Voice Navigator Keyboard Accessibility
10. Word Cue Keyboard Accessibility
11. Native Range Accessibility
12. Pronunciation Impact
13. Download Controls
14. Cue-Sync Performance
15. Browser / Network / Language
16. Data Integrity
17. Full Regression
18. Scope Audit
19. Remaining Risks
20. Final Gate Matrix
21. Final Verdict
```

---

# 18. Full Regression

If source/tests change:

```bash
pytest --tb=short -q
```

Current baseline:

```text
501 / 501 PASS
0 failed
0 errors
```

Acceptance:

```text
100% canonical collected tests PASS
0 failed
0 errors
```

New targeted tests should normally make the collected count `>= 501`.

Any unexplained decrease below 501 is a blocker.

If only documentation/evidence changes:
- keep 501/501 as the latest actual runtime regression;
- do not invent a larger count.

---

# 19. Scope Audit

Confirm:

```text
3C = NOT STARTED
3D = NOT STARTED
Phase 4+ = NOT STARTED
Localization/Multi-language = NOT STARTED
```

No Visual Workbench redesign.

No Export Workbench redesign.

No Phase 5 virtualization.

No Phase 6 full accessibility hardening.

No multi-language dubbing/localization.

---

# 20. Final Verdict Rule

Only conclude:

```text
SUBPHASE 3B: PASS / FINAL
READY FOR SUBPHASE 3C
```

when ALL are true:

- [ ] `pre-phase-3b` is a real checkpoint of the approved 3A final state.
- [ ] Persistent chunk mutations use stable IDs.
- [ ] Positional `{index}` is not the canonical mutation identity.
- [ ] TTS active path uses `TTSProvider`.
- [ ] STT active path uses `STTProvider`.
- [ ] No provider bypass exists.
- [ ] TTS/STT replacement failure preserves committed output.
- [ ] Downstream invalidation occurs only after successful committed change.
- [ ] Locked chunks are never silently overwritten.
- [ ] Bulk regeneration handles locks safely.
- [ ] Revision restore follows the Phase 2 conflict/lock contract.
- [ ] Job state and artifact state remain distinct.
- [ ] `af_heart`, `af_bella`, `am_adam`, etc. are treated as voices, not model identifiers.
- [ ] Voice Navigator listbox keyboard behavior is complete.
- [ ] 1,400+ cue interactions do not create an unusable 1,400-item Tab sequence.
- [ ] Word cue seek is keyboard accessible.
- [ ] Native range controls have correct accessible names and semantics.
- [ ] Pronunciation changes do not silently regenerate audio.
- [ ] Pronunciation invalidation is selective where possible.
- [ ] Every visible Voice download action is backed by a real artifact/route.
- [ ] Cue highlighting produces no network call per playback tick.
- [ ] Browser/network validation PASS.
- [ ] Vietnamese-first UI PASS.
- [ ] Original narration/transcript language is preserved.
- [ ] Data integrity PASS.
- [ ] Full regression PASS.
- [ ] 3C/3D/Phase 4+ remain untouched.
- [ ] No P0/P1 blocker remains.

Otherwise:

```text
SUBPHASE 3B: CONDITIONAL PASS
NOT READY FOR SUBPHASE 3C
```

and list the exact blockers.

---

# 21. Stop

After the final report:

```text
STOP
```

Do NOT start Subphase 3C automatically.
