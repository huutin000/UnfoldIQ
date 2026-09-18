# PHASE 8 — EXTERNAL REVIEW FINAL CORRECTIVE V4

Current status:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
PHASE 9: NOT STARTED
```

Do not implement Phase 9.

Do not rewrite Phase 8.

All V2/V3 corrective items are considered closed except the source-duration validation issue below.

---

## 1. BLOCKER — SOURCE-DURATION VALIDATION IS FRAME-RATE INCORRECT

The current Phase 8 report states:

```text
usable source frames after trim/speed
= round(native_frames / speedFactor)
```

and then allows the render when:

```text
usable >= target_frames
```

This is incorrect for non-24fps sources and cannot be used for VFR sources.

Example:

```text
source = 60 fps
selected source interval = 60 source frames
speedFactor = 1.0

actual source duration = 1 second
actual canonical 24fps capacity = 24 output frames

current formula:
usable = 60 / 1 = 60 frames
```

If the manifest requires:

```text
target_frames = 48
```

the current planner would incorrectly accept the source because:

```text
60 >= 48
```

but after canonicalization to 24fps the source can only supply approximately:

```text
24 canonical frames
```

The same class of error exists for 30fps input.

For VFR input, raw source-frame count is fundamentally insufficient to determine the selected interval duration because frame timestamps are variable.

---

## 2. REQUIRED CONTRACT

Keep the approved source trim semantics:

```text
trim.inFrame / trim.outFrame
= source-media frame coordinates
```

Keep the filter order:

```text
source-native trim
→ PTS reset
→ speedFactor
→ fps=24
→ fitting
→ canonicalization
→ exact target frame clamp
```

But source sufficiency must be decided from **source timeline duration**, not raw source-frame count.

Canonical calculation:

```text
selected_source_duration
= timeline duration of source frames [inFrame, outFrame)

effective_duration
= selected_source_duration / speedFactor

available_canonical_frames
= duration converted to the canonical 24fps timeline
```

Then:

```text
available_canonical_frames >= target_frames
→ allowed

available_canonical_frames < target_frames
→ INSUFFICIENT_SOURCE_DURATION
```

Do not:

```text
freeze last frame
duplicate frames beyond actual timeline duration to hide shortage
change speedFactor
extend editorial timing
```

Normal `fps=24` duplication/drop behavior used to convert a valid source timeline to CFR is allowed; artificial extension beyond the selected source duration is not.

---

## 3. CFR SOURCES

For CFR 24/30/60fps fixtures, prove source sufficiency using the actual source timebase/frame rate or equivalent exact timeline metadata.

Required tests:

```text
24fps:
24 source frames at speed 1.0
→ approximately 1 second
→ 24 canonical frames available

30fps:
30 source frames at speed 1.0
→ approximately 1 second
→ 24 canonical frames available

60fps:
60 source frames at speed 1.0
→ approximately 1 second
→ 24 canonical frames available
```

Add rejection cases:

```text
30 source frames @30fps
target = 48 canonical frames
→ INSUFFICIENT_SOURCE_DURATION

60 source frames @60fps
target = 48 canonical frames
→ INSUFFICIENT_SOURCE_DURATION
```

Also test `speedFactor`:

```text
2.0
→ effective duration halves

0.5
→ effective duration doubles
```

---

## 4. VFR SOURCE

For VFR input, do not infer selected interval duration from:

```text
frame_count / nominal_fps
```

or:

```text
native_frames
```

Use real source timing/PTS for the selected source frame interval.

Required deterministic VFR fixture:

```text
frame indexes have non-uniform PTS spacing
```

Prove two cases:

```text
VFR selected interval timeline duration is sufficient
→ allowed

VFR selected interval has enough raw frames but insufficient timeline duration
→ INSUFFICIENT_SOURCE_DURATION
```

The second test is mandatory because it proves the planner is not falling back to frame-count logic.

---

## 5. POST-RENDER SAFETY REMAINS

Retain the existing invariant:

```text
expectedFinalFrames = max(clips.endFrame)
```

If actual composed output contains fewer frames than expected:

```text
RENDER_FRAME_UNDERRUN
```

must still fail.

However, `RENDER_FRAME_UNDERRUN` is a runtime safety net, not a substitute for correct pre-render `INSUFFICIENT_SOURCE_DURATION` validation.

---

## 6. UPDATE REPORT WORDING

Remove the incorrect statement:

```text
usable = round(native_frames / speedFactor)
```

Replace it with the actual implemented timeline-duration algorithm.

Document:

```text
CFR duration resolution method
VFR duration/PTS resolution method
speedFactor conversion
rounding policy at the 24fps boundary
```

Rounding must be deterministic and must not overstate available duration.

---

## 7. REQUIRED VERIFICATION

Run focused tests including the new source-duration cases:

```powershell
python -m pytest (Get-ChildItem tests/test_phase08_*.py) -q
```

Run real FFmpeg 24/30/60/VFR normalization again if the implementation path changed.

Then run:

```powershell
python -m pytest --tb=short -q
```

Required:

```text
0 failed
0 errors
```

Retain all previously closed V2/V3 evidence.

---

## 8. FINAL REPORT

Update:

```text
docs/implementation/PHASE_08_IMPLEMENTATION_REPORT.md
```

Include explicit evidence that:

```text
source-duration validation is timeline-based
30fps shortage is rejected correctly
60fps shortage is rejected correctly
VFR shortage is decided from timestamps/PTS
speedFactor 0.5 / 1.0 / 2.0 remains correct
RENDER_FRAME_UNDERRUN remains a runtime backstop
```

Final implementation-agent verdict remains:

```text
PHASE 8: IMPLEMENTED / REVIEW PENDING
READY FOR EXTERNAL REVIEW
PHASE 9: NOT STARTED
```

Do not self-promote.

After updating the report:

```text
STOP
```

Do not start Phase 9.
