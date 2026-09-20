# Production Smoke Test Report — UnfoldIQ v1.0.0 / v1.0.1

> **Latest Smoke Verdict:** **`PRODUCTION SMOKE TEST PASS`** (v1.0.1)
> **Release status:** **`PRODUCTION RELEASE READY`** (v1.0.1)

---

## A. v1.0.1 Smoke Run (2026-09-20 — PASS)

### A.1. Release Identity

```text
Version: v1.0.1 (annotated tag, local — push authorized on PASS)
Branch: main
Commit: 69aa2e9a80c5b3b3fa0cb6203c0eddd476c31ed3
Tag: v1.0.1 → 69aa2e9 (fix(stt): translate provider transcription contract at whisper adapter boundary)
Smoke date: 2026-09-20
Harness: scripts/verify_production_smoke.py (EXIT 0 — PASS)
Smoke duration: ~56 seconds (16:48:27 → 16:49:23 +07:00)
```

### A.2. Environment

```text
Windows 11 64-bit | Python 3.12.14 | torch 2.8.0+cu126 (CUDA avail, RTX 3050)
FFmpeg/ffprobe 8.1.1 | Kokoro :8880 healthy (68 voices) | Studio :7860 healthy
Launcher: manual daemon start (pythonw.exe, uvicorn, pid-tracked)
No --reload in production processes. Product code identical to v1.0.1 tag.
```

### A.3. Full Smoke Results — All PASS

| Gate | Check | Result |
|------|-------|--------|
| Startup | Studio /health healthy | **PASS** |
| Startup | Kokoro healthy via studio | **PASS** |
| Startup | Voice list responds (68 voices) | **PASS** |
| Project | TTS job accepted (project create) | **PASS** |
| Project | Job reports project_dir | **PASS** |
| Project | Project directory exists on disk | **PASS** |
| Project | Project status opens | **PASS** |
| Project | Project v2 state opens | **PASS** |
| Script | Script displays | **PASS** |
| Script | Script save works | **PASS** |
| Script | Reload preserves edit | **PASS** |
| Script | Script restore to audio-backed text | **PASS** |
| Script | Restored script matches audio | **PASS** |
| Script | Script lock works | **PASS** |
| Script | Script unlock works | **PASS** |
| Voice | Candidate audio readable (364,332 bytes) | **PASS** |
| Voice | Audio decodable, duration 7.589s | **PASS** |
| Voice QA | Voice QA path executes to passing state | **PASS** |
| STT | Transcription/STT path available | **PASS** |
| Visual | Scene list loads (1 scene) | **PASS** |
| Visual | Shot list loads (1 shot) | **PASS** |
| Visual | Shot edit/save + reload persists | **PASS** |
| Visual | Veo regenerate after edit accepted | **PASS** |
| Visual | Visual Bible loads | **PASS** |
| Visual | Media intake via production route | **PASS** |
| Visual | Asset APPROVED via production route | **PASS** |
| Visual | Image Prompt state available | **PASS** |
| Export | Export readiness READY | **PASS** |
| Export | Render Manifest compiles | **PASS** |
| Export | Timeline compile persists | **PASS** |
| Export | Production export snapshot created | **PASS** |
| Render | Final Render starts | **PASS** |
| Render | Final Render completes (final.mp4 reachable) | **PASS** |
| Render | final.mp4 exists and readable (509,341 bytes, 7.583s) | **PASS** |
| Render QA | Render QA PASS (auto-handoff) | **PASS** |
| Render QA | Artifact at READY after QA PASS | **PASS** |
| Browser | Application shell renders | **PASS** |
| Browser | Vietnamese-first UI preserved | **PASS** |
| Browser | Primary navigation present | **PASS** |
| Browser | 0 uncaught critical JS exceptions | **PASS** |

**Total: 40/40 checks PASS, 0 failures**

### A.4. Persistence Gate

Post-restart verification (Studio restarted cold after smoke run):
- `GET /api/projects/{smoke_dir}/status` → **200** ✅
- `GET /api/projects/{smoke_dir}/export/readiness` → **200, status=READY** ✅
- `GET /api/projects/{smoke_dir}/exports/export_001/final/file` → **200** ✅

Project data, export snapshot, and final.mp4 fully persistent across cold restart.

### A.5. Cleanup

Smoke project `2026-09-20_164827_SMOKE_V1_0_1_20260920_164827` removed post-run.
`projects/` verified `.gitkeep`-only after cleanup. **PASS**.

### A.6. Full Regression (post-smoke)

```text
1068 passed, 0 failed, 0 errors, 9 warnings
Duration: 307.67s (5:07)
projects/ blank: verified
```

### A.7. Corrective Fix Applied (v1.0.1)

Root cause (P1, fixed in commit `69aa2e9`):
```text
studio/providers/whisper_provider.py:69
  start_transcription(project_id, script_text="", force=False, **kwargs)
  → forwarded script_text/force to TranscriptionService.start_transcription
    → TypeError: unexpected keyword argument 'script_text'
Fix: adapter strips provider-only kwargs before delegating to service.
```

New regression tests: `tests/test_stt_provider_delegation.py` (5 tests, RED-before/GREEN-after verified).

---

## B. v1.0.0 Smoke Run (2026-09-20 — FAIL, preserved for provenance)

> **Smoke Verdict (v1.0.0):** **`PRODUCTION SMOKE TEST FAIL`**
> **Release status:** **`PRODUCTION RELEASE BLOCKED`** (real P1 product defect)

### B.1. Release Identity

```text
Version: v1.0.0 (annotated tag, pushed)
Branch: main
Commit: 4f33307f8043516baeee983e690252bc793bf918
Smoke date: 2026-09-20
Harness: scripts/verify_production_smoke.py (EXIT 2 — FAIL)
```

### B.2. Environment

```text
Windows 10/11 64-bit | Python 3.12.14 | torch 2.8.0+cu126 (CUDA avail, RTX 3050)
FFmpeg/ffprobe 8.1.1 | Kokoro :8880 healthy | Studio :7860 healthy
```

### B.3. Failures (7 critical)

| Gate | Result |
|------|--------|
| Startup, Script, TTS synthesis | **PASS** |
| Voice QA | **FAIL** — pipeline crash, no report persisted |
| STT timestamps | **FAIL** — HTTP 500 (TypeError: unexpected keyword 'script_text') |
| Visual/Export/Render/QA | **BLOCKED** (correct product guards downstream) |
| Browser gate / Persistence | **NOT REACHED** |

### B.4. Root Cause

```text
studio/providers/whisper_provider.py:69 forwarded script_text/force kwargs
→ TranscriptionService.start_transcription (project_id, is_tts_active_fn=None)
→ TypeError: unexpected keyword argument 'script_text'
Every real Voice QA + STT call crashed. Corrected in v1.0.1.
```

### B.5. Final Verdict

```text
PRODUCTION SMOKE TEST FAIL — v1.0.0 BLOCKED
v1.0.0 tag stands immutable; fix shipped as patch release v1.0.1.
```

---

## C. Final Release Verdict

```text
PRODUCTION SMOKE TEST PASS — v1.0.1
PRODUCTION RELEASE READY
Commit: 69aa2e9a80c5b3b3fa0cb6203c0eddd476c31ed3
Tag: v1.0.1 (local, push authorized conditionally on PASS — condition met)
Full regression: 1068/1068 PASS, 0 fail/error
Smoke: 40/40 checks PASS, 0 failures
Persistence: VERIFIED (cold restart, all artifacts accessible)
projects/ blank: VERIFIED
Date: 2026-09-20
```
