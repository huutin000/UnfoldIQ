# PHASE 8 — EXTERNAL REVIEW CORRECTIVE CLOSURE V2

Current status:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
PHASE 9: NOT STARTED
```

Do not implement Phase 9.

Do not rewrite Phase 8.

Read in this order:

1. Approved Phase 8 Design Spec
2. Approved Phase 8 Implementation Plan
3. Current source code
4. Current `PHASE_08_IMPLEMENTATION_REPORT.md`
5. This corrective closure V2

The previous corrective pass successfully closed major issues including:
- unauthorized `loudnorm`;
- Windows `CTRL_BREAK_EVENT` cancellation;
- global Final Render concurrency = 1;
- `NEEDS_REVIEW / PENDING_RENDER_QA`;
- `render-metadata.json`;
- 250/500 Shot planning;
- full regression;
- scope audit.

The remaining items below must be closed before external review may promote Phase 8.

---

## 1. FIX HARDWARE FALLBACK TAXONOMY

The approved Phase 8 contract requires exactly these NVENC hardware classes to be fallback-eligible:

```text
ENCODER_HARDWARE_UNAVAILABLE
ENCODER_OUT_OF_MEMORY
ENCODER_INITIALIZATION_FAILED
ENCODER_BUSY
```

All four must:

```text
encoder == h264_nvenc
AND execution stage == ENCODING
AND root cause is hardware/encoder specific
→ fallback_eligible = true
```

All other failures must be false.

Audit:

```text
studio/render_failure_classifier.py
studio/manifest_render_types.py
studio/manifest_render_service.py
tests/test_phase08_failure_classifier.py
```

Required table-driven tests:

```text
"No capable devices found"
→ ENCODER_HARDWARE_UNAVAILABLE
→ fallback true

"Cannot load libcuda"
→ ENCODER_HARDWARE_UNAVAILABLE
→ fallback true

"OpenEncodeSessionEx failed: out of memory"
→ ENCODER_OUT_OF_MEMORY
→ fallback true

"InitializeEncoder failed"
→ ENCODER_INITIALIZATION_FAILED
→ fallback true

"encoder is busy"
→ ENCODER_BUSY
→ fallback true
```

Also prove:

```text
FILTERGRAPH_ERROR
INPUT/MISSING FILE
SUBTITLE ERROR
MUX ERROR
UNKNOWN ERROR
CANCELLED
→ fallback false
```

A misleading stderr line containing CUDA/NVENC text must not override a more specific non-hardware root cause.

Fallback remains maximum one retry.

---

## 2. COMPLETE DATA-INTEGRITY COVERAGE

The current report proves hashes for:

```text
script
audio
timestamps
Scene Plan
Visual Bible
Veo Prompts
intake ledger
```

The approved plan additionally requires protection of:

```text
Asset Registry
Phase 7 persisted render-manifest snapshots
```

Update:

```text
scripts/verify_phase08_data_integrity.py
```

Before runtime/destructive verification hash all applicable protected files:

```text
script
audio master
timestamps
Scene Plan
Visual Bible
Veo Prompts
Asset Registry
intake ledger
Phase 7 render-manifest snapshots
```

If one canonical file is genuinely absent, report it explicitly as:

```text
ABSENT / NOT APPLICABLE
```

Do not silently omit it.

Write:

```text
temp/phase08_verification/integrity/reference_hashes_before.json
temp/phase08_verification/integrity/reference_hashes_after.json
temp/phase08_verification/integrity/result.json
```

Required final evidence:

```text
all applicable protected hashes unchanged
0 unexplained mismatch
```

Generated Phase 8 final/metadata fixtures must be listed separately.

---

## 3. COMPLETE UPSTREAM INTEGRITY EVIDENCE

Run all four approved commands:

```powershell
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" rev-parse HEAD
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" describe --tags --exact-match
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" status --short
git -C "D:\Project\UnfoldIQ\upstream\kokoro-fastapi" diff --stat
```

The report must include:

```text
HEAD
exact tag, or explicit NO EXACT TAG
working-tree status
diff stat
currently approved upstream baseline
comparison result
```

Do not reset upstream to force an older historical hash.

If the approved upstream baseline intentionally changed since older reports, document the provenance of that baseline change.

---

## 4. PROVE HARD-SUBTITLE FONT CONTRACT

Approved hard-burn behavior:

```text
burnIn=true
→ subtitles/libass
→ use requested manifest font/style fields
→ no duplicate soft stream
```

The requested font must be resolved from the current runtime/configured font environment.

Required behavior:

```text
requested font exists
→ render

requested font missing
→ SUBTITLE_FONT_UNAVAILABLE
→ FAIL
→ no silent Arial/default substitution
```

Add explicit focused tests for:

```text
fontName honored
fontSize honored
bottomOffsetPx/style mapping honored when supported by current schema
missing requested font → SUBTITLE_FONT_UNAVAILABLE
hard burn → no mov_text duplicate
```

If `bottomOffsetPx` cannot map exactly through current subtitle renderer, document the deterministic mapping used by Phase 8 rather than ignoring the field.

---

## 5. PROVE AUDIO DURATION TOLERANCE POLICY

Approved narration/video alignment policy after resampling to 48 kHz:

```text
targetSamples = expectedFinalFrames * 2000
```

Required:

```text
exact match
→ use as-is

narration short by <= 2000 samples
→ pad silence only at tail

narration long by <= 2000 samples
→ trim tail

absolute mismatch > 2000 samples
→ AUDIO_DURATION_MISMATCH
→ fail before render
```

No narration speed correction.

Add focused tests proving all four cases.

Also prove BGM semantics:

```text
loop=true
→ loop then trim to canonical duration

loop=false
→ play once
→ remaining timeline narration-only
→ BGM cannot extend Final duration
```

---

## 6. PROVE SPEED / SOURCE-DURATION VISUAL CONTRACT

Add explicit evidence for:

```text
speedFactor = 0.5
speedFactor = 1.0
speedFactor = 2.0
```

Verify filter order:

```text
source-native trim
→ setpts speed transform
→ fps=24
→ fitting normalization
→ exact target frame trim
```

Required source-duration behavior:

```text
usable source after trim/speed >= target
→ render allowed

usable source after trim/speed < target
→ INSUFFICIENT_SOURCE_DURATION
→ do not freeze last frame
→ do not invent frames
```

Also retain evidence for:

```text
24fps source
30fps source
60fps source
VFR source
```

---

## 7. PROVE WINDOWS COMMAND-LINE LENGTH SAFETY

The current scale report records:

```text
250 Shots → 1536 argv tokens
500 Shots → 3036 argv tokens
```

Token count alone is insufficient on Windows.

Measure the actual serialized command-line character length for the 250- and 500-shot plans.

Record:

```text
argv token count
serialized command-line char count
filter script byte count
number of media inputs
```

The filter graph must remain in:

```text
-filter_complex_script <path>
```

and not inline.

If the 500-shot command line approaches/exceeds the Windows `CreateProcess` limit, implement the already-approved staged-normalized fallback or another safe bounded-input strategy.

Do not claim the Windows scale gate PASS only from token count.

Write evidence to:

```text
temp/phase08_verification/scale/scale_250_shots.json
temp/phase08_verification/scale/scale_500_shots.json
```

---

## 8. PROVE RENDER-METADATA SAFE WRITE

The current report proves metadata contents, but external review also requires persistence safety.

Prove:

```text
metadata written to temp file
→ flush/close
→ safe commit
→ no partial JSON
```

and:

```text
existing valid render-metadata.json
→ never silently overwritten with conflicting provenance
```

Add focused test for interrupted/failed metadata commit.

If Final exists after publish but metadata is missing due crash at the boundary, recovery may safely reconstruct metadata only from persisted immutable job/manifest provenance.

---

## 9. CORRECT PROCESS-TREE CLAIM OR IMPLEMENTATION

The report currently states:

```text
process.kill()
→ terminate process tree
```

On Windows, Python `Popen.kill()` is an alias of `terminate()` and terminates the child process; it is not by itself a generic process-tree kill primitive.

Audit actual behavior.

Required contract:

```text
CREATE_NEW_PROCESS_GROUP
→ CTRL_BREAK_EVENT
→ bounded grace
→ if FFmpeg still alive, force termination
→ verify owned FFmpeg process is gone
→ no orphan render process
```

If FFmpeg does not spawn child processes in this runtime, correct the report wording to say the owned FFmpeg process is force-killed.

If process-tree termination is actually required by the implementation environment, use a Windows-safe tree/job-object strategy and test it explicitly.

Do not claim process-tree kill without evidence.

---

## 10. RE-RUN VERIFICATION

After the fixes/evidence above:

### Focused Phase 8

```powershell
python -m pytest tests/test_phase08_*.py -q
```

### Nearby regression

```powershell
python -m pytest tests/test_phase07_*.py tests/test_phase04_*.py tests/test_phase03d_*.py -q
```

Include persistent job/resource scheduler tests relevant to Final Render if they live outside those patterns.

### Full regression

```powershell
python -m pytest --tb=short -q
```

Required:

```text
0 failed
0 errors
```

Run runtime race/recovery safety repeatedly if related source changed.

---

## 11. UPDATE FINAL REPORT

Update:

```text
docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md
```

Add explicit sections/evidence for:

```text
Hardware fallback taxonomy — all four eligible classes
Complete protected-file integrity set
Upstream exact tag/baseline provenance
Hard subtitle font resolution
Audio +/-1-frame alignment policy
BGM loop true/false
speedFactor 0.5/1/2
insufficient-source rejection
Windows serialized argv character length
render-metadata safe-write
accurate Windows force-termination wording/evidence
```

Do not mark any item PASS from source inspection alone if runtime evidence is required.

---

## 12. FINAL VERDICT

If every mandatory Phase 8 gate passes, keep the implementation-agent verdict exactly:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

Do not self-promote to:

```text
PASS / FINAL / VERIFIED
```

External review owns promotion.

After producing the corrected report:

```text
STOP
```

Do not start Phase 9.
