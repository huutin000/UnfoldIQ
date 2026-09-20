# UnfoldIQ Workstation — Production Release Baseline

> **Status:** `PRODUCTION RELEASE READY` — v1.0.1 smoke PASS, 1068/1068 regression PASS.
> See §25 for final verdict and §24 for full smoke evidence.

---

## 1. Product Version

```text
v1.0.0
```

First production release with a stable product contract (per rollout plan §4: first public/stable contract → `v1.0.0`).

## 2. Git Branch

```text
main
```

Integrated from `phase09-render-qa` via fast-forward merge (`8f8aefd..4f33307`, 5 commits, no conflicts).

## 3. Git Commit SHA

```text
4f33307f8043516baeee983e690252bc793bf918
```

Message: `feat: add post-final cleanup infrastructure, UI components, and comprehensive test suites`.

## 4. Git Tag

```text
v1.0.0 (annotated)
Message: "UnfoldIQ Workstation v1.0.0 - Production Ready"
Tag → 4f33307f8043516baeee983e690252bc793bf918 (verified via `git show v1.0.0`)
Pushed: origin/main + refs/tags/v1.0.0 (fast-forward only, no force)
```

## 5. Release Date

```text
2026-09-20
```

## 6. Final Gate Status

```text
FINAL SYSTEM GATE — PASS / FINAL / VERIFIED (source: FINAL_SYSTEM_GATE_EXTERNAL_REVIEW_FINAL.md)
POST-FINAL CLEANUP — PASS (source: POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md v3.3.0)
```

## 7. Final Gate Matrix

Reference (not duplicated): `docs/implementation/FINAL_SYSTEM_GATE_EXTERNAL_REVIEW_FINAL.md` — 13/13 PASS.
Post-final: `docs/implementation/POST_FINAL_GATE_CLEANUP_UI_SIMPLIFICATION_REPORT.md` — full suite 1063/1063.

## 8. Canonical Regression Result

Fresh regression on the **merged `main` result** (2026-09-20, zero narrowing):

```text
Command: upstream\kokoro-fastapi\.venv\Scripts\python.exe -m pytest -q --tb=short -rs -p no:cacheprovider
Collected: 1063 | Passed: 1063 | Failed: 0 | Errors: 0 | Skipped: 0
Duration: 293.07s | Exit code: 0 | projects/: .gitkeep only after run
```

Pre-merge run on `phase09-render-qa`: identical 1063/1063 (312.66s). No count reduction, no new skips.

## 9. Supported OS

```text
Verified: Windows 10/11 64-bit (win32, physical display 1920x1080 w/ 125% DPI)
Unverified: Linux / macOS (not tested — no claim)
```

## 10. Python Version

```text
3.12.14 (upstream\kokoro-fastapi\.venv)
```

## 11. Node Version

```text
v24.16.0 (used by virtual-list unit checks in tests; not a production runtime dependency)
```

## 12. FFmpeg / ffprobe Version

```text
ffmpeg 8.1.1-essentials_build-www.gyan.dev
ffprobe 8.1.1-essentials_build-www.gyan.dev
```

## 13. GPU / CUDA Requirements

```text
Runtime: torch 2.8.0+cu126 (CUDA 12.6 builds)
Verified hardware (this machine): NVIDIA GeForce RTX 3050 Laptop GPU + Intel(R) UHD Graphics
Headed-Chrome evidence (144 Hz rAF/FPS gates) validated on this GPU; other GPUs unverified.
```

## 14. Kokoro Requirements

```text
kokoro 0.9.4 | kokoro-fastapi 0.8.2 | inno-kokoro 0.2.0 (upstream\kokoro-fastapi\.venv)
```

## 15. Faster-Whisper Requirements

```text
faster-whisper 1.2.1 | ctranslate2 4.8.2
```

## 16. Required Models

```text
models/whisper/small.en/ (model.bin ~483 MB + config/tokenizer/vocabulary)
Kokoro voice assets resolve via upstream\kokoro-fastapi environment.
```

## 17. Required Config

```text
studio/config.py is env-driven with local defaults:
  KOKORO_BASE_URL (default local) | STUDIO_HOST | STUDIO_PORT (default 7860)
Secrets: none committed; provider keys are masked/sanitized in logs (studio/provider_router.py, studio/structured_logger.py).
GAP (non-blocking): no `.env.example` at repo root yet — recommended before handoff to new operators.
```

## 18. Startup Commands

```powershell
.\start-unfoldiq-tts.bat
# → scripts\start-unfoldiq-tts.ps1 (Vietnamese UI, safety guards, pythonw — no popup windows)
# Studio: uvicorn studio.app:app --host 127.0.0.1 --port 7860
```

## 19. Shutdown Commands

```powershell
.\stop-unfoldiq-tts.bat
```

## 20. Data Paths

```text
projects/            ← user projects (MUST be .gitkeep-only at release; runtime-created)
state.db             ← per-project state (runtime-created, never shipped)
assets/ exports/     ← per-project media + render outputs (runtime-created)
temp/                ← disposable EXCEPT protected evidence paths (see storage_manager contract §19.5)
```

## 21. Backup Scope (pending verification — Stage 6)

```text
Candidate set: projects/ + per-project state.db + assets/ + exports/ + required settings/config.
Excluded: temp CDP profiles, recreatable cache, pytest output, historical temp/ evidence.
Status: scope defined, backup+restore NOT yet executed/verified.
```

## 22. Rollback Procedure (pending — Stage 7)

```text
Target artifact: docs/operations/ROLLBACK_RUNBOOK.md — NOT yet written.
Rollback unit: code tag (v1.0.0) + project/data state + config + models/runtime compat.
```

## 23. Known Limitations

1. No `.env.example` at root (config works via defaults; handoff polish outstanding).
2. Test-only hard path `D:\Downloads\NodeJS\node.exe` in `tests/test_phase05_closure.py` (regression-env dependency, not production runtime).
3. Known test-infra gap (test-only): `scripts/verify_phase05_headed.py` does not self-provision its `_p5_dense300` fixture (see cleanup report §24.3).
4. Non-Windows platforms untested.

## 24. Smoke Test Results (both runs)

### 24.1 v1.0.0 Smoke — FAIL (2026-09-20, preserved for provenance)

```text
Harness: scripts/verify_production_smoke.py (EXIT 2)
Startup, Script, TTS synthesis: PASS
Voice QA: FAIL — pipeline crash (TypeError: unexpected keyword 'script_text')
STT timestamps: FAIL — HTTP 500
Visual/Export/Render/QA/Browser: BLOCKED / NOT REACHED
Cleanup: PASS
```

### 24.2 v1.0.1 Smoke — PASS (2026-09-20)

```text
Harness: scripts/verify_production_smoke.py (EXIT 0 — PASS)
Version: v1.0.1, commit 69aa2e9a80c5b3b3fa0cb6203c0eddd476c31ed3
Report: docs/implementation/PRODUCTION_SMOKE_TEST_REPORT.md §A
Startup: PASS (Studio+Kokoro healthy, 68 voices)
Project lifecycle: PASS
Script (display/save/reload/restore/lock/unlock): PASS
Voice (TTS 7.589s, audio readable, ffprobe decodable): PASS
Voice QA: PASS (status=pass, 0 unresolved issues, WER 0.0)
STT/timestamps: PASS
Visual (scenes, veo, bible, media intake, asset approval): PASS
Export readiness READY, render manifest, timeline compile: PASS
Final Render completes (509,341 bytes, 7.583s): PASS
Render QA PASS (auto-handoff), artifact READY: PASS
Browser (shell renders, Vietnamese UI, 0 critical JS errors): PASS
Persistence gate (cold restart, status/readiness/final.mp4): PASS
Cleanup (smoke project removed, projects/ .gitkeep-only): PASS
Full regression: 1068/1068 PASS, 0 fail/error
Total smoke checks: 40/40 PASS, 0 failures
```

## 25. Final Release Verdict

```text
PRODUCTION RELEASE READY — v1.0.1 smoke PASS
Commit: 69aa2e9a80c5b3b3fa0cb6203c0eddd476c31ed3
Tag: v1.0.1 (annotated, local — push to origin authorized)
Full regression: 1068/1068 PASS, 0 fail/error
Smoke: 40/40 checks PASS
Persistence: VERIFIED (cold restart)
projects/ blank: VERIFIED
Date: 2026-09-20
Note: v1.0.0 tag stands immutable at 4f33307; v1.0.1 is the current shipping release.
```
