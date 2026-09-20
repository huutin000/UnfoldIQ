# Production Smoke Test Report — UnfoldIQ v1.0.0

> **Final Smoke Verdict:** **`PRODUCTION SMOKE TEST FAIL`**
> **Release status:** **`PRODUCTION RELEASE BLOCKED`** (real product defect, see §15)

---

## 1. Release Identity

```text
Version: v1.0.0 (annotated tag, pushed)
Branch: main
Commit: 4f33307f8043516baeee983e690252bc793bf918
Tag verified: YES (HEAD == v1.0.0 target; studio+transcription byte-equivalent to tag)
Smoke date: 2026-09-20
Harness: scripts/verify_production_smoke.py (verification-only, EXIT 2)
```

## 2. Environment

```text
Windows 10/11 64-bit | Python 3.12.14 | torch 2.8.0+cu126 (CUDA avail, RTX 3050)
FFmpeg/ffprobe 8.1.1 | Kokoro :8880 healthy | Studio :7860 healthy
Launcher: start-unfoldiq-tts.bat -NoBrowser (pid-tracked, single listener per port)
No --reload in launchers. No secrets embedded. No runtime-critical dev paths
(config/app.json absolute ffmpeg paths resolve via PATH fallback — non-blocking).
```

## 3. Startup

**PASS** — cold start via release launcher after stopping stale services; Studio `/health`
healthy, Kokoro healthy through Studio, voice list returns 60+ voices, no startup
exception (only INFO health polls), no duplicate listeners.

## 4. Browser Runtime

**NOT EXECUTED** — harness stopped at the export gate (FAIL) before the headed-Chrome
CDP gate. No browser evidence claimed.

## 5. Project Lifecycle

**PASS (partial)** — disposable project `2026-09-20_105629_SMOKE_V1_0_0_*` created via real
`POST /api/generate` TTS job (completed in 1.9s, 7.59s audio); status/v2-state open;
directory exists on disk.

## 6. Script Workflow

**PASS** — display/save/reload/lock/unlock all verified through real routes
(`GET/PUT .../script`, `POST .../lock/script/script`).

## 7. Voice/TTS/STT

**PARTIAL/FAIL** —
TTS synthesis works (audio.wav 364,328 bytes, ffprobe duration 7.589s, decodable).
Voice QA (`POST .../voice-qa/run`) accepted but its pipeline crashed and persisted
nothing (`GET .../voice-qa` → `exists:false`).
STT (`POST .../timestamps/generate`) → **HTTP 500**.

## 8. Visual Workflow

**FAIL (cascade)** — `scenes/generate` → 400, `veo/generate` → 400 (product guards
require timestamps/QA first); 0 scenes / 0 shots. Visual Bible + visual-prompts GETs pass.

## 9. Export/Final Render

**NOT REACHED** — readiness `BLOCKED` (`voiceQa, timestamp, subtitles, scenePlan,
visualContinuity, veo`). No render started; no state fabricated.

## 10. Render QA

**NOT REACHED** (blocked upstream).

## 11. Persistence After Restart

**NOT TESTED** (no READY artifact produced).

## 12. Browser Console / HTTP 5xx

```text
Uncaught critical JS exceptions: not measured (browser gate not reached)
Unexpected server 5xx: 1 (POST .../timestamps/generate → 500, real product exception)
```

## 13. Cleanup / Blank Workspace

Disposable project removed after evidence preservation
(audio/script/traceback copied to `temp/production_smoke/failure_evidence_*`).
`projects/` verified `.gitkeep`-only after run. **PASS**.

## 14. Evidence Inventory

```text
temp/production_smoke/smoke_summary.json        (status FAIL, 7 critical failures)
temp/production_smoke/http_results.json         (all request/response codes)
temp/production_smoke/runtime_environment.json  (platform/python/ffmpeg/torch)
temp/production_smoke/artifact_checks.json
temp/production_smoke/smoke_audio.wav           (real TTS output, 7.59s)
temp/production_smoke/failure_evidence_audio.wav / _script.txt / _traceback.txt
runtime/studio_err.log                          (live server traceback, 10:56/11:03)
```

## 15. Failures / Corrective Findings

**Root cause (PRODUCT DEFECT, severity P1 — core workflow broken):**
interface drift between the STT provider contract and its service implementation.

```text
studio/app.py:1659 (_run_voice_qa_pipeline) and :1879 (generate_project_timestamps)
  → providers/whisper_provider.py:69
      start_transcription(project_id, script_text="", force=False, **kwargs)
    → TranscriptionService.start_transcription(project_id, is_tts_active_fn=None)
      → TypeError: ... got an unexpected keyword argument 'script_text'
```

The provider (and `providers/base.py:72`) promises `script_text`/`force`; the concrete
service accepts only `is_tts_active_fn`. Every real Voice QA run and every STT request
crashes; downstream scenes/veo/export/render/QA are unreachable. Unit/integration tests
never caught it (they do not exercise the real provider→service call chain).

**Cascade (not independent defects):** 400s on scenes/veo generate are correct product
guards; BLOCKED readiness is correct given missing QA/timestamps.

**Corrective plan (patch release, normally v1.0.1):**

```text
1. Align the interface (minimal, one side):
   (a) TranscriptionService.start_transcription accepts and ignores/forwards
       script_text/force, OR
   (b) whisper_provider strips provider-only kwargs before delegating.
2. Add a regression test invoking the REAL provider→service chain
   (service mocked at the boundary, asserting call kwargs) for both
   voice-qa/run and timestamps/generate paths.
3. Fresh full regression (1063+), new annotated tag (v1.0.1), push, re-run smoke.
```

`v1.0.0` MUST NOT be rewritten, force-updated, or moved.

## 16. Final Smoke Verdict

```text
PRODUCTION SMOKE TEST FAIL
PRODUCTION RELEASE BLOCKED
```

STOP. Do not begin Backup/Restore. Do not commit/push. Wait for explicit user instruction.
