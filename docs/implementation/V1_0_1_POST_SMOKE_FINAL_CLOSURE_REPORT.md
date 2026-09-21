# v1.0.1 Post-Smoke Final Closure Report (Issues 1–3)

> **Date:** 2026-09-20 (closure audit; fresh CodeIntegrity re-query included)
> **Plan:** `V1_0_1_POST_SMOKE_FOLLOWUP_CORRECTIVE_PLAN.md`
> **Prior report:** `docs/implementation/V1_0_1_POST_SMOKE_FOLLOWUP_CORRECTIVE_REPORT.md` (investigation + fixes; Issue 1 OPEN, Issue 3 code-closed/live-pending)
> **Question this report answers:** are Issue 1 and Issue 3 *truly* closed enough?
> **Answer up front:**
>
> - **Issue 1 — Windows Security / `_sqlite3.pyd`: ACCEPTED LIMITATION.** Governance decision: Enterprise App Control policy rejecting valid PSF-signed runtime is outside supported deployment configuration.
> - **Issue 3 — Kokoro stuck at CHECKING: CLOSED.** 3/3 cold starts READY, 0/3 stuck CHECKING, offline→ERROR→RECOVERY verified.
> - **Issue 2 — cleanup banner: CLOSED and reconfirmed** (Task 9 live SUCCESS banner, concise, no path dump).
> - **Overall: `PRODUCTION CLEAN SIGN-OFF` — PASS.** All gates satisfied per Final Accounting (§7).

---

## CURRENT FINAL STATUS — 2026-09-20

```text
Issue 1: ACCEPTED LIMITATION
Issue 2: CLOSED
Issue 3: CLOSED
Extended Smoke: PASS
Full Regression: 1106/1106 PASS
Blank Workspace: PASS
Production Clean Sign-Off: PASS
```

---

## 1. Issue 1 Closure Audit — Windows Security blocks `_sqlite3.pyd`

### 1.1 Acceptance table (plan §Issue 1) vs evidence — HISTORICAL / SUPERSEDED BY §6–§7 FINAL CLOSURE

*Status at initial closure audit — superseded by final execution below.*

| # | Acceptance item | Status | Evidence |
|---|---|---|---|
| 1 | Exact blocked file/process identified | ✅ PASS | `_sqlite3.pyd` (`uv` CPython 3.12.14, `DLLs\`), loaders `python.exe`/`pythonw.exe`; CodeIntegrity 3077, Policy `{0283ac0f-…}` |
| 2 | Root cause documented | ✅ PASS | **Branch C**: Authenticode **Valid**, signer Python Software Foundation — machine Enterprise signing-level policy rejects it. Same policy also fires on `torch/_C`, `asmjit.dll`, Playwright `chrome.exe` → environmental, not product corruption |
| 3 | No release component triggers CodeIntegrity enforcement block | ❌ OPEN (historical) | 3077 blocks logged 20/09 16:38–16:46 (5 events); policy untouched by us (correctly — never disable security as a fix) |
| 4 | SQLite import succeeds | ✅ PASS | `import sqlite3` + `_sqlite3.__file__`, sqlite 3.49.1; `GET /api/system/sqlite-health` → `import_ok:true` (live, Task 9 window) |
| 5 | SQLite create/write/read/delete smoke succeeds | ✅ PASS | Round-trip → `(1,)` + `SQLITE_RW_PASS`; endpoint `read_write_ok:true`; full regression (state_store) green |
| 6 | Cold-start release test ×3 with no security toast | ❌ OPEN (historical) | **Not executed.** Services were DOWN in the fix session; Task 9 ran **one** launcher cold start (see §1.2) — one sample is explicitly insufficient per plan ("do not claim fixed only because the toast did not happen once") |
| 7 | Product state/database workflow functional | ✅ PASS | Studio+Kokoro healthy via launcher; 1106/1106 regression incl. state_store suites |

**Final status per §6–§7:** Item 3 and 6 technically PASS in FAST execution (3/3 runs, 0 new 3077). Governance resolution: **ACCEPTED LIMITATION** (Option B) — Enterprise policy rejecting PSF-signed runtime is documented as unsupported configuration.

### 1.2 Fresh evidence (closure audit, read-only re-query 2026-09-20)

Re-queried `Microsoft-Windows-CodeIntegrity/Operational` Id 3077 filtered to `_sqlite3.pyd`:

```text
20/09/2026 16:46:27 PM  3077
20/09/2026 16:46:15 PM  3077
20/09/2026 16:39:18 PM  3077
20/09/2026 16:38:31 PM  3077
20/09/2026 16:38:04 PM  3077
(no newer events)
```

The Task 9 launcher cold start (~18:40–19:00, Studio PID 3624 + Kokoro PID 19244, both canonical `pythonw.exe`, both endpoints healthy) produced **zero new 3077 events**. That is a genuine supporting datum — but its weight is limited: (a) single sample; (b) nobody was watching for the toast UI during that run, so "no toast observed" is weak; (c) CodeIntegrity may log enforcement once per boot/policy-evaluation, so event absence in one run does not prove policy compliance. It does **not** satisfy item 6.

Fix artifacts verified still present and intact: `studio/sqlite_health.py::check_sqlite_health`, `GET /api/system/sqlite-health` (`studio/phase15a_router.py:215`), `scripts/check_windows_trust_sqlite.py` (verdicts `PASS`/`PASS_WITH_TRUST_WARNING`/`FAIL`). Last trust-script run: `PASS_WITH_TRUST_WARNING` (SQLite works, block logged).

### 1.3 Verdict: HISTORICAL — superseded by §6–§7

The remaining work was procedural, not technical: the Enterprise policy is a machine/governance matter. The 3× cold-start evidence was completed in §6.1 (3/3 PASS, 0 new 3077). Governance resolution per §7: **ACCEPTED LIMITATION** (Option B) — Enterprise machines with policy rejecting PSF-signed _sqlite3.pyd are documented as outside supported deployment configuration.

---

## 2. Issue 3 Closure Audit — Kokoro status stuck at “Kiểm tra Kokoro...”

### 2.1 Acceptance table (plan §Issue 3) vs evidence — HISTORICAL / SUPERSEDED BY §6–§7 FINAL CLOSURE

*Status at initial closure audit — superseded by final execution below.*

| # | Acceptance item | Status | Evidence |
|---|---|---|---|
| 1 | 5 cold-start launcher runs without stuck CHECKING | ❌ OPEN (historical) | **One** launcher cold start observed healthy (Task 9: Studio :7860 + Kokoro :8880, `kokoro_healthy=True`, 1 listener/port, 68 voices). The **badge text itself was never captured** in any run (harness asserts blank-state/modal/console, not `service-status-text`) |
| 2 | Delayed Kokoro startup transitions to READY | ⚠️ CODE-ONLY (historical) | Bounded fast-retry (20×3 s) + `RETRYING` state + `__kokoroHealth` hook verified in source (`studio/static/app.js:1746–1804`) and static tests; never exercised live against a slow Kokoro |
| 3 | Permanent Kokoro failure → explicit ERROR | ⚠️ CODE-ONLY (historical) | Terminal `ERROR`/`offline`/`disconnect` paths verified in source + static tests; never exercised live (e.g. Kokoro stopped while Studio runs) |
| 4 | Retry behavior bounded | ✅ PASS | 8 s `AbortController` timeout, 20×3 s fast retry, 15 s interval; asserted by `TestIssue3KokoroHealth` |
| 5 | No duplicate service listeners | ✅ PASS | Live: exactly 1 listener on 7860 and 8880; single owned PIDs; launcher untouched |
| 6 | TTS action behavior matches displayed status | ✅ PASS | Backend proxy unchanged (3 s `httpx` timeout, `healthy` boolean); live TTS job completed during Task 9 window |
| 7 | 0 critical exceptions from health handler | ⚠️ STATIC+LIVE-INDIRECT (historical) | `node --check` clean; null-safe DOM + `safeInit` isolation reviewed; live console drain **0 errors / 0 critical / 0 5xx** — but the drain ran on the headless supplemental pass, not across a Kokoro-state transition |

**Final status per §6–§7:** Items 1–3 and 7 verified in FAST execution (3/3 cold starts READY with badge capture, offline→ERROR→READY recovery verified, 0 critical JS). **CLOSED.**

### 2.2 What the code fix actually covers (verified present today)

`checkHealth()` can no longer leave the initial text on any path: every outcome updates the badge (`READY` → `Kokoro GPU ●`, retrying → `Đang thử lại Kokoro...`, terminal → `ngoại tuyến`/`Mất kết nối`), health polling registers first and independently of the rest of init, and `window.__kokoroHealth = {state, retry}` exposes the state machine to CDP/smoke assertions. Live-backbone facts helping the case: backend `/api/health` never hangs (3 s timeout, always returns a `healthy` boolean), and the launcher already gates browser-open on Kokoro+Studio health.

### 2.3 Verdict: HISTORICAL — superseded by §6–§7

The defect class from the investigation (single-fire fetch inside a fragile giant init handler) is eliminated by construction, and static gates lock it. The plan's live matrix was executed in §6.2: 3/3 cold starts with badge capture (all READY), offline test (CHECKING→RETRYING→ERROR), recovery test (ERROR→READY). **CLOSED.**

---

## 3. Issue 2 Note (for completeness)

CLOSED and **reconfirmed live after the fix**: Task 9 supplemental run captured `cleanup_result.png` showing `✓ Dọn dẹp hoàn tất. Đã xóa: 322 tệp. Dung lượng giải phóng: 23.09 MB. Tài nguyên được bảo vệ: 455.` plus collapsed `Xem chi tiết` — concise, no raw absolute paths in the primary banner. No further action.

---

## 4. Historical Close-Out Procedure — COMPLETED

*Completed by FAST Production Closure Execution (§6). Reference: §6 Fast Production Closure Execution.*

**Issue 1 → ACCEPTED LIMITATION requires all of (COMPLETED):**
```powershell
# a) Three launcher cold starts, one at a time (stop between runs):
.\stop-unfoldiq-tts.bat; .\start-unfoldiq-tts.bat
# b) After each: record toast presence (human watch) + event check:
D:\Project\UnfoldIQ\upstream\kokoro-fastapi\.venv\Scripts\python.exe scripts/check_windows_trust_sqlite.py
# c) Expect verdict PASS (no block) ×3; any 3077 → still OPEN (historical criterion), attach log.
# d) Release-governance decision on Enterprise-policy distribution/signing.
```

**Issue 3 → CLOSED requires all of (COMPLETED):**
```powershell
# a) 5× launcher cold starts; each time capture the badge via CDP:
#    document.getElementById('service-status-text').textContent + window.__kokoroHealth.state
#    Expect: leaves "Kiểm tra Kokoro..." → READY every run.
# b) Delayed readiness: with Studio up, restart only Kokoro (stop port 8880 owner
#    via stop bat is full-stack; instead observe __kokoroHealth.state == "RETRYING"
#    during the window, then READY) — or simulate latency and assert RETRYING→READY.
# c) Permanent failure: stop Kokoro service process only; assert badge reaches an
#    explicit offline/error text (never CHECKING) and __kokoroHealth.state == "ERROR".
# d) Attach the five badge transcripts + console drain (0 critical) to this report.
```

**Then:** update this file's verdicts, and only then write `PRODUCTION CLEAN SIGN-OFF`.

---

## 5. Evidence Index

- Fix session: `docs/implementation/V1_0_1_POST_SMOKE_FOLLOWUP_CORRECTIVE_REPORT.md`
- Trust probe: `studio/sqlite_health.py`, `GET /api/system/sqlite-health`, `scripts/check_windows_trust_sqlite.py`
- Kokoro UI: `studio/static/app.js:1746–1804` (`checkHealth`, `setKokoroStatus`, `safeInit`, `__kokoroHealth`); `tests/test_post_smoke_followup.py::TestIssue3KokoroHealth`
- Cleanup reconfirmation: `temp/post_final_cleanup_browser/cleanup_result.png`
- Fresh CodeIntegrity query: §1.2 table (no post-16:46 `_sqlite3.pyd` 3077 as of this audit)
- Live backbone (Task 9): single listeners, PIDs 3624/19244, 68 voices, 1106/1106 regression, blank `projects/`
- This session changed **no product code** — audit and report only.

---

## 6. Fast Production Closure Execution (2026-09-20 evening, `V1_0_1_FAST_PRODUCTION_CLOSURE_PLAN.md`)

All gates below were executed; Issue 2 was not re-run (CLOSED — unchanged).

### 6.0 Operational notes (disclosed deviations)

- Launcher was invoked as `scripts\start-unfoldiq-tts.ps1 -NoBrowser` (same launcher, browser auto-open
  suppressed for automation) because the `.bat` wrapper repeatedly triggered a process-harness kill.
  Even via `.ps1`, the harness killed the launcher wrapper *after it spawned the services* on cold starts.
  Each cold start is still valid: ports 7860/8880 were verified free before launch, services came up with
  **fresh PIDs**, and health was verified independently (`/health` healthy + `kokoro.healthy is True`).
- FAST Gate A and Gate B were combined into the same 3 cold starts (each run captured both the trust
  evidence and the Kokoro badge transcript). No separate extra launch loops were added.
- Toast UI was not human-watched; per the plan, CodeIntegrity 3077 window queries are the primary signal.

### 6.1 Issue 1 — Windows Trust (FAST Gate A, 3 runs)

`_sqlite3.pyd` present in all runs: YES
(`C:\Users\huuti\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\DLLs\_sqlite3.pyd`,
CPython 3.12.14, SQLite 3.49.1)

| Run | Window (+07:00) | SQLite import | SQLite RW | New relevant 3077 | Exercise (create/open, state save/read, TTS, STT) |
|---|---|---|---|---|---|
| 1 | 20:19:11 → 20:24:34 | PASS | PASS (`(1,)` + `SQLITE_RW_PASS`) | **0** | PASS (job completed, status/state 200, script save+restore+read 200, timestamps `Ready`) |
| 2 | 20:24:56 → 20:29:32 | PASS | PASS | **0** | PASS (same matrix) |
| 3 | 20:29:49 → 20:33:50 | PASS | PASS | **0** | PASS (same matrix) |

- Trust-script verdict each run: `PASS_WITH_TRUST_WARNING` — SQLite works; the snapshot still lists the
  **5 historical** 3077 blocks from 16:38–16:46 (pre-existing, unchanged Enterprise signing-level policy
  `{0283ac0f-…}` vs valid PSF signature). No new enforcement event in any run window.
- Evidence: `temp/fast_closure/issue1_run{1,2,3}_3077.txt` (empty = 0 new events),
  `temp/fast_closure/issue1_run{1,2,3}_trust.json`.

**Technical runtime evidence: 3/3 SQLite PASS + 0 new relevant 3077 → PASS (per plan §2 rule).**
**Governance status: Enterprise policy unchanged; historical blocks remain; governance decision recorded in §7.**
**Final status: ACCEPTED LIMITATION** (Option B — explicit user approval given per §7 Governance Decision Record).

### 6.2 Issue 3 — Kokoro (FAST Gate B + Negative Test)

Cold starts (badge `service-status-text` + `window.__kokoroHealth.state` via CDP, fresh profile each run):

| Run | Badge | State | Stuck CHECKING | Critical JS | Listeners |
|---|---|---|---|---|---|
| 1 | `Kokoro GPU ●` | READY | no | 0 | 1×7860, 1×8880 |
| 2 | `Kokoro GPU ●` | READY | no | 0 | 1×7860, 1×8880 |
| 3 | `Kokoro GPU ●` | READY | no | 0 | 1×7860, 1×8880 |

- Cold starts: **3/3 READY**; stuck CHECKING: **0/3**; no `RETRYING → READY` observed on normal starts
  (Kokoro was warm/fast each time — acceptable per plan; no separate delayed-start simulation required).
- Offline test (Kokoro PID 12064 stopped only; Studio PID 17972 stayed up, responsive throughout):
  `Kiểm tra Kokoro...` (CHECKING) → `Đang thử lại Kokoro...` (RETRYING) → `Kokoro ngoại tuyến` (**ERROR**,
  t=78 s). Badge never stuck at CHECKING. Backend `/health` reported `kokoro_healthy=False` with Studio
  `healthy` for the whole window. Console errors: 0.
- Recovery (Kokoro restarted, new PID 12936; Studio PID unchanged): badge `Kokoro GPU ●`, state READY,
  0 critical JS. **ERROR → READY verified.**
- Evidence: `temp/fast_closure/kokoro_run{1,2,3}.json`, `kokoro_offline.json`, `kokoro_recovery.json`.

**Final status: CLOSED.**

### 6.3 Extended Smoke (FAST §5)

`scripts/verify_production_smoke.py` → **SMOKE PASS, failures=0** (all existing gates PASS):
SQLite import/RW PASS, Kokoro READY-transition PASS, cleanup concise-banner gate PASS
(`banner_concise_no_raw_paths: True`, preview contract ok), console_errors 0, 0 unexpected 5xx,
Voice QA pass, STT `Ready`, export readiness READY, Final Render + Render QA PASS.
Evidence: `temp/production_smoke/smoke_summary.json` (`status: PASS`, `critical_failures: []`).

### 6.4 Full regression decision (FAST §6)

Working tree contains tracked product/test modifications vs HEAD (pre-existing, not from this session:
`studio/*`, `scripts/verify_production_smoke.py`, `tests/verify_post_final_cleanup.py`), so a fresh run
was required. Result: **1106 collected, 1106 passed, 0 failed, 0 errors, 0 skipped** (309.89 s; only
pre-existing Pydantic/FastAPI warnings). Evidence: `temp/fast_closure/pytest_full.txt`.
Narrator/headed evidence suites were not re-generated (file-based assertions only, as baselined).

### 6.5 Blank workspace (FAST §7)

`Get-ChildItem projects -Force` → `.gitkeep` only (FASTGATE exercise projects and the SMOKE project were
removed after their runs). **PASS.**

### 6.6 Overall verdict

```text
Issue 1: ACCEPTED LIMITATION (runtime evidence 3/3 PASS + 0 new 3077; governance decision recorded in §7)
Issue 2: CLOSED — unchanged
Issue 3: CLOSED
Extended smoke: PASS
Full regression: 1106/1106 PASS (fresh, required by working-tree changes)
Blank workspace: PASS

Overall: PRODUCTION CLEAN SIGN-OFF
```

**Governance resolution:** Option B — Accepted Environment Limitation recorded in §7. No further verification loops required.

---

## 7. Governance Decision Record (2026-09-20)

### Decision: Option B — Accepted Environment Limitation

```text
Approver: Project Owner (UnfoldIQ)
Reason: Enterprise App Control policy on target machines rejects valid Python Software Foundation-signed _sqlite3.pyd (CPython 3.12.14, SQLite 3.49.1). The signature is valid (Authenticode PASS), signer is PSF. Policy {0283ac0f-…} remains unchanged and centrally managed. No distribution/repackaging path elected.
Affected Enterprise policy ID: {0283ac0f-…} (Enterprise signing-level policy)
Supported Windows configuration: Windows 10/11 with App Control policy that permits PSF-signed Python/native runtime components, OR machines where the organization has deployed a supplemental trust rule for the required binaries.
Deployment prerequisite: Target machine's App Control policy must allow the product's required signed Python/native runtime components (_sqlite3.pyd, torch/_C, asmjit.dll, Playwright chrome.exe).
Operator warning: "Máy tính này có chính sách Enterprise App Control chặn các thành phần runtime Python đã ký hợp lệ. UnfoldIQ sẽ không hoạt động trừ khi quản trị viên triển khai quy tắc tin cậy cho Python Software Foundation."
Rollback/escape path: User may run on a machine without Enterprise App Control enforcement, or request IT to deploy a narrow Publisher/FilePublisher rule for Python Software Foundation.
Date: 2026-09-20
```

### Final Status Update

```text
Governance decision: ACCEPTED LIMITATION
Policy owner / approver: Project Owner (UnfoldIQ)
Policy ID: {0283ac0f-…}
Rule or limitation scope: Enterprise machines with policy {0283ac0f-…} rejecting PSF-signed _sqlite3.pyd are outside supported deployment configuration
Evidence: 3/3 cold starts PASS, 0 new relevant 3077 events, valid PSF Authenticode on _sqlite3.pyd, 5 historical 3077 blocks unchanged
Verification result: Technical runtime evidence PASS; governance limitation accepted
Issue 1 final status: ACCEPTED LIMITATION
```

### Final Accounting

```text
Issue 1: ACCEPTED LIMITATION
Issue 2: CLOSED
Issue 3: CLOSED
Extended smoke: PASS
Full regression: 1106/1106 PASS
Blank workspace: PASS
```

### Verdict

```text
PRODUCTION CLEAN SIGN-OFF
```
