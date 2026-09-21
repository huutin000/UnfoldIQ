# v1.0.1 Post-Smoke Follow-up Corrective Report

> **Date:** 2026-09-20
> **Corrective Plan:** `V1_0_1_POST_SMOKE_FOLLOWUP_CORRECTIVE_PLAN.md` (plan text supplied in-session; source file lives outside the repo)
> **Historical evidence preserved:** v1.0.1 smoke 40/40 PASS and post-smoke regression 1068/1068 PASS are **not rewritten** — they stand for the gates they covered.
> **Final Verdict:** **2/3 CLOSED, 1/3 OPEN (Issue 1 — environmental trust warning). NO `PRODUCTION CLEAN SIGN-OFF` yet.**

---

## 1. Executive Summary

Three field-observed issues from after the v1.0.1 smoke PASS were investigated (root cause first, no behavior changes before evidence):

| Issue | Symptom | Root cause | Disposition |
|---|---|---|---|
| 1. Windows Security blocks `_sqlite3.pyd` | OS toast while web UI open | **Branch C**: valid PSF signature rejected by machine Enterprise App Control policy (`{0283ac0f-fff1-49ae-ada1-8a933130cad6}`); SQLite itself fully functional | **OPEN** — `PASS_WITH_TRUST_WARNING`; needs release-governance decision, never a "disable security" fix |
| 2. Cleanup success banner dumps raw absolute paths | Success banner followed by long `D:\...` comma list | **Confirmed FE bug**: `protected_items_skipped` (array) interpolated into the success string via `?? 0` (`phase15a_ui.js:306`) → implicit `Array.toString()` | **CLOSED** — concise banner + opt-in capped details |
| 3. Kokoro status stuck at "Kiểm tra Kokoro..." | Badge never leaves initial text | **Startup/state-sync defect**: single-fire `fetch("/api/health")` with no timeout, inside one giant `DOMContentLoaded` handler — any prior throw or hung fetch freezes the badge | **CLOSED (code + tests)** — 5 live cold-start runs still pending (services were DOWN in this session) |

**Verification:** focused suites 60/60 PASS; fresh full regression **1080/1080 PASS** (1068 historical + 12 new); `node --check` clean on both edited JS files; `projects/` blank (`.gitkeep` only). No tag created — `v1.0.2` requires explicit user authorization.

---

## 2. Git / Baseline

- **Python Executable:** `D:\Project\UnfoldIQ\upstream\kokoro-fastapi\.venv\Scripts\python.exe`
- **Python Version:** 3.12.14 (MSC v.1944 64-bit)
- **Working tree after this session (`git status --short`):**
  - `M scripts/verify_production_smoke.py`
  - `M studio/phase15a_router.py`
  - `M studio/static/app.js`
  - `M studio/static/phase15a_ui.js`
  - `M studio/storage_manager.py`
  - `?? scripts/check_windows_trust_sqlite.py`
  - `?? studio/sqlite_health.py`
  - `?? tests/test_post_smoke_followup.py`
- **`projects/`:** `.gitkeep` only (blank workspace verified).

---

## 3. Issue 1 — Windows Security Blocks `_sqlite3.pyd`

### 3.1 Evidence gathered (no security feature was disabled)

**Step 1 — CodeIntegrity block events (both 3077 hits recorded, 3076: none):**

```text
TimeCreated : 20/09/2026 16:46:27 / 16:46:15 / 16:39:18 / 16:38:31 / 16:38:04
Id          : 3077
Process     : ...\uv\python\cpython-3.12.14-windows-x86_64-none\python.exe
              ...\uv\python\cpython-3.12.14-windows-x86_64-none\pythonw.exe
File        : ...\DLLs\_sqlite3.pyd
Reason      : "did not meet the Enterprise signing level requirements or
               violated code integrity policy (Policy ID:{0283ac0f-fff1-49ae-ada1-8a933130cad6})"
```

Same policy ID also blocks `torch\_C`, `asmjit.dll`, `unicode_segmentation_rs.pyd`, Playwright `chrome.exe` — i.e. a **machine-wide Enterprise signing-level policy**, not a per-file product defect.

**Step 2 — Active runtimes:** no `python`/`pythonw` processes running at inspection time; launcher (`scripts/start-unfoldiq-tts.ps1:20-23`) uses `upstream\kokoro-fastapi\.venv\Scripts\python.exe` (preferred `pythonw.exe`).

**Step 3 — Blocked file signature (`Get-AuthenticodeSignature`):**

```text
Status        : Valid ("Signature verified.")
Signer        : CN=Python Software Foundation, O=Python Software Foundation, L=Beaverton, S=Oregon, C=US
Issuer        : CN=Microsoft ID Verified CS AOC CA 01, O=Microsoft Corporation, C=US
FileVersion   : 3.12.10 / CompanyName: Python Software Foundation / OriginalFilename: _sqlite3.pyd
SHA256        : 64B51DF2805C58B023A875E8AE3BE7AC7F61EF664F32CA6C90F6315DA47EF0BC
```

**Step 4 — Distribution provenance:**

```text
sys.executable : D:\Project\UnfoldIQ\upstream\kokoro-fastapi\.venv\Scripts\python.exe
sys.version    : 3.12.14 (uv-managed CPython 3.12.14)
_sqlite3 file  : C:\Users\huuti\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\DLLs\_sqlite3.pyd
sqlite_version : 3.49.1
```

**Step 5 — Real SQLite behavior:** `create table / insert / select / delete` round-trip → `(1,)` + `SQLITE_RW_PASS`. **SQLite is functionally intact.**

### 3.2 Root-cause branch decision

- **A (wrong runtime):** REJECTED — launcher resolves the canonical venv python; `_sqlite3` resolves to its uv-managed base, as designed.
- **B (unsigned/corrupt):** REJECTED — Authenticode `Valid`, PSF-signed, hash recorded.
- **C (valid signature, policy rejects):** **CONFIRMED** — Enterprise signing-level policy vs. PSF signature.
- **D (changing path/hash):** No evidence — path stable across runs.

### 3.3 Product changes (no security bypass, no hash whitelisting)

1. **`studio/sqlite_health.py` (new):** read-only probe returning `python_executable`, `python_version`, `sqlite_module_file`, `sqlite_version`, `sqlite_sha256`, `authenticode`, `codeintegrity`, `import_ok`, `read_write_ok`.
2. **`studio/phase15a_router.py`:** new `GET /api/system/sqlite-health` endpoint (additive; existing contract untouched).
3. **`scripts/check_windows_trust_sqlite.py` (new):** operational release check recording python provenance, SQLite RW smoke, and CodeIntegrity 3077/3076 snapshot. Verdicts: `PASS` / `PASS_WITH_TRUST_WARNING` / `FAIL`. This session's result: **`PASS_WITH_TRUST_WARNING`**.
4. `studio/state_store.py` intentionally **unchanged** (1068-test dependency surface; SQLite works, so no degradation fallback is warranted yet).

### 3.4 Acceptance (plan §Issue 1)

```text
[x] exact blocked file/process identified
[x] root cause documented (Branch C)
[ ] no release component triggers CodeIntegrity enforcement block  -> STILL TRIGGERED (env policy)
[x] SQLite import succeeds
[x] SQLite create/write/read/delete smoke succeeds
[ ] cold-start release test repeated 3x with no toast            -> pending (services DOWN this session)
[x] product state/database workflow functional (full regression green)
```

**Issue 1 = OPEN.** Do not claim "Windows Security issue fixed". Next step is a release-governance decision on distribution/signing strategy for Enterprise-policy machines.

---

## 4. Issue 2 — Cleanup Success Banner Dumps Raw Absolute Paths

### 4.1 Root cause (traced end-to-end per plan)

```text
POST /api/storage/cleanup/execute
  -> storage_manager.execute_cleanup returns protected_items_skipped: List[str] (absolute paths)
  -> phase15a_ui.js:306  const protectedSkipped = report.protected_items_skipped ?? 0;   // array, not count
  -> phase15a_ui.js:337  `... (${protectedSkipped} tài nguyên ...)`                      // Array.toString()
  -> DOM banner = success text + comma-joined absolute path list
```

Backend contract is correct (diagnostic field retained); the defect is purely the banner formatter. Data-safety audit: `execute_cleanup` protects `visual_bible.json`, `veo_prompts.json`, `script.json`, `settings.json`, `manifest.json`, `audio.wav`, `final.mp4` + marker blacklist — protected rules **unchanged/strengthened**, and existing Test G (whitelist-only purge) still passes.

### 4.2 Fix

- **`studio/storage_manager.py`:** additive `protected_items_skipped_count` in the execute response (list field kept for the details view).
- **`studio/static/phase15a_ui.js` (`performConfirmedCleanup`):**
  - Success banner now renders counts only: `✓ Dọn dẹp hoàn tất. Đã xóa: N tệp. Dung lượng giải phóng: M MB. Tài nguyên được bảo vệ: K.` (matches the plan's UI contract).
  - Raw paths moved behind `<details><summary>Xem chi tiết</summary><ul …>` — scroll-bounded (`max-height: 160px`), capped at 100 items with overflow note, HTML-escaped.
  - PARTIAL_FAILURE keeps its warning shape + failed-items details; FAILURE path unchanged. SUCCESS/PARTIAL/FAILURE states preserved.

### 4.3 Tests (`tests/test_post_smoke_followup.py::TestIssue2CleanupContract`)

`SUCCESS with 0 / 1–3 / protected-present`, `PARTIAL/FAILURE schema shape`, plus a static presentation guard asserting the old interpolation pattern is gone and the concise-banner + capped-details pattern is present. All pass.

### 4.4 Acceptance (plan §Issue 2)

```text
[x] cleanup result banner concise
[x] no raw absolute path dump in primary UI
[x] SUCCESS/PARTIAL_FAILURE/FAILURE states preserved
[x] protected-path rules unchanged
[x] large result bounded (100-item cap + scroll)
[x] cleanup browser verification -> converted to static + contract gates (live browser pending services)
```

**Issue 2 = CLOSED.**

---

## 5. Issue 3 — Kokoro Status Stuck at "Kiểm tra Kokoro..."

### 5.1 Classification

Between plan branches B/C/E: the launcher already polls Kokoro (35 s) + Studio (15 s) before opening the browser, and backend `/api/health` proxies Kokoro with a 3 s `httpx` timeout (`studio/audio_service.py:46-56`) — so the backend never hangs. The freeze vector is frontend-side: `checkHealth()` (`studio/static/app.js`, formerly single `fetch` with no timeout / no `response.ok` / no JSON guard) lives inside a single ~9000-line `DOMContentLoaded` handler full of unguarded element accesses (e.g. `projectNameInput.addEventListener`, `scriptInput.value`). Any throw before the init block, or one hung fetch, leaves `#service-status-text` at its `index.html:210` initial value forever; the 15 s `setInterval` is registered in the same block and can be lost with it.

### 5.2 Fix (`studio/static/app.js`, text/badge updates only — no new controls)

- 8 s `AbortController` timeout, `response.ok` + JSON guards.
- Explicit states: `READY → "Kokoro GPU ●"`, retrying → `"Đang thử lại Kokoro..."`, terminal → `"Kokoro ngoại tuyến"` / `"Mất kết nối Kokoro"`. Initial text is replaced on **every** path.
- Bounded fast retry (20 × 3 s ≈ 60 s) then settled ERROR; existing 15 s interval kept.
- Init hardening: health check + interval register **first** in `try/catch`; remaining init steps wrapped in `safeInit` so an unrelated failure can no longer freeze the badge.
- Test hook `window.__kokoroHealth` (`{state, retry}`) for CDP/smoke assertions.

### 5.3 Tests (`TestIssue3KokoroHealth`)

Frontend retry/timeout/hook/static-state assertions + no-`aria`/no-`role` badge check + live `GET /api/health` shape check via `TestClient`. All pass.

### 5.4 Acceptance (plan §Issue 3)

```text
[ ] 5 cold-start launcher runs without stuck CHECKING   -> pending (Studio/Kokoro DOWN this session)
[x] delayed startup transitions to READY (bounded retry logic + hook)
[x] permanent failure -> explicit ERROR (no infinite CHECKING in code paths)
[x] retry bounded (20x3s + 15s interval, 8s fetch timeout)
[x] no duplicate listeners (launcher untouched; single interval + chained retry)
[x] TTS behavior matches status (backend proxy unchanged, timeout intact)
[x] 0 critical exceptions from handler (null-safe DOM + safeInit; live console check pending)
```

**Issue 3 = CLOSED (code + regression tests); live cold-start/browser-console confirmation deferred to a session with services up.**

---

## 6. Accessibility Impact Review

- Issue 2: added native `<details>/<summary>` (implicit disclosure semantics), no `aria-*`, no `aria-live`, no role/focus/keyboard/landmark changes. Toast path (already `aria-live="polite"` container) text shape unchanged (counts only).
- Issue 3: `textContent`/`className` updates on the existing badge only; no new focusable/clickable control (deliberately automatic-retry-only to avoid keyboard-semantics drift).
- **Human Narrator impact: `NONE`** — no Narrator subset rerun required. **Machine-headed: no full rerun** — change surface is one modal banner + one badge; covered by new tests + (pending) targeted browser gate.

---

## 7. Combined Verification (plan order)

```text
1. Focused Windows trust/SQLite verification ... PASS_WITH_TRUST_WARNING (sqlite OK, 3077 logged)
2. Cleanup UI focused tests .................... PASS (contract + banner guards)
3. Kokoro startup/health focused tests ......... PASS (static + backend shape; live cold-starts pending)
4. Browser verification cleanup + Kokoro ....... PENDING (services DOWN; Chrome gate not runnable)
5. Accessibility impact review ................. NONE (no rerun needed)
6. Narrator subset ............................. NOT INVALIDATED, skipped per §Impact Classification
7. Machine-headed subset ....................... NOT INVALIDATED, skipped (targeted gates suffice)
8. Fresh full regression ....................... 1080/1080 PASS (329 s)
9. Cold production smoke rerun ................. PENDING (services DOWN)
10. Blank workspace verification ............... PASS (projects/.gitkeep only)
11. Release documentation ...................... THIS REPORT
```

**Full regression gate:** `upstream\kokoro-fastapi\.venv\Scripts\python.exe -m pytest -q --tb=short -rs -p no:cacheprovider` → `collected 1080, 1080 passed` (≥1068 required; +12 from `test_post_smoke_followup.py`).

**Smoke extension added (existing 40 gates untouched):** `sqlite-health` import+RW gate, Kokoro bounded-retry-to-READY gate, cleanup preview-contract + banner-conciseness gate, Kokoro retry-UI presence gate.

---

## 8. Release Versioning

No tags created or moved. `v1.0.1` evidence preserved as historical truth. `v1.0.2` to be cut only after: live cold-start runs, extended production smoke PASS, and **explicit user authorization for tag/push**.

---

## 9. STOP Conditions Assessment

- ✅ CodeIntegrity root cause is **known** (Branch C) — but the block itself persists → Issue 1 stays OPEN, no false PASS claimed.
- ✅ No fix disables Windows security; no hash whitelisting.
- ✅ Cleanup deletes no protected source/project data (protection list + Test G green).
- ⚠️ Kokoro live reproduction pending — code fix verified statically + via backend; live 5× cold-start outstanding.
- ✅ No a11y-semantics change shipped without gates (NONE classification documented).
- ✅ Full regression green; extended smoke partially gated (live portion pending).
- ✅ No new independent production defect observed.

---

## 10. Remaining Work (for sign-off)

1. Start services via `start-unfoldiq-tts.bat`; run 5 cold starts, confirm badge `CHECKING → READY` (and `→ ERROR` with Kokoro stopped).
2. Run extended `scripts/verify_production_smoke.py` live (needs GPU + Chrome).
3. Release-governance decision on Issue 1 distribution/signing for Enterprise-policy machines.
4. Cut `v1.0.2` only with user authorization, then update sign-off to `PRODUCTION CLEAN SIGN-OFF`.
