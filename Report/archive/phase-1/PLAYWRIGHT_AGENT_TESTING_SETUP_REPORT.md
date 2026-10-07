# PLAYWRIGHT AGENT TESTING SETUP — REPORT

Date: 2026-10-01
Spec: `D:\Downloads All\UNFOLDIQ_PLAYWRIGHT_AGENT_TESTING_SETUP_PROMPT.md`

```text
TASK_VALIDATION        = PASS
REPOSITORY_REGRESSION  = PARTIAL (56/59 — 3 real-render suites blocked by Smart App Control, pre-existing, documented)
ENVIRONMENT_BLOCKER    = SAC / Remotion compositor (unchanged from before this task)
```

## 1. Test architecture trước setup

- Layer 1–2: 59 custom Node regression suites under `tests/<domain>/` run by `scripts/run-tests.js` (`npm test`, `npm run test:<domain>`) — baseline 56/59 PASS, 3 fails = SAC/Remotion environment blocker.
- Extension suite: `cd flow-companion/extension && npm test` (394/0) + build.
- Layer 3 (browser E2E): **not present**. Layer 4 (agent browser control): ad-hoc CDP/computer-use (this session's live validation), no durable tooling.

## 2. Stack được chọn (đúng spec §1)

- `@playwright/test` — durable deterministic browser E2E.
- `@playwright/cli` — agent browser control / exploratory / live validation / attach.
- NOT installed (per spec): Playwright MCP, BrowserCode, browser-use, Stagehand, agent-browser. No blocker of Playwright was found, so no substitutes were considered.

## 3. Exact versions + install

```text
npm view @playwright/test version → 1.63.0
npm view @playwright/cli version  → 0.1.22
npm install -D @playwright/test@1.63.0 @playwright/cli@0.1.22
npx playwright install chromium   → chromium-1243, chromium_headless_shell-1243, ffmpeg-1011, winldd-1007 (ms-playwright cache)
npx playwright-cli install --skills=agents → .agents/skills/playwright-cli installed; default browser: Chrome (system)
```

- **SAC check on Playwright Chromium**: `chromium.launch()` headless spawn + page eval → **WORKS** (Playwright's Chromium has cloud reputation; unlike the unsigned Remotion compositor binaries, it is NOT blocked by Smart App Control). This is what makes real-browser testing viable on this machine.

## 4. Files changed / added

| Path | Change |
|---|---|
| `package.json` | devDependencies `@playwright/test@^1.63.0`, `@playwright/cli@^0.1.22`; scripts `test:e2e`, `test:e2e:headed`, `test:e2e:ui` (existing `npm test` untouched; no `|| exit 0` masking) |
| `playwright.config.js` (new, root — canonical tooling config like package.json) | testDir `tests/e2e`, `workers=1`, `retries=0`, `trace: retain-on-failure`, `screenshot: only-on-failure`, `video: retain-on-failure`, HTML reporter `open: never`, `outputDir: Report/evidence/playwright/artifacts` |
| `tests/e2e/flow-companion.spec.js` (new) | first durable browser E2E (see §6) |
| `scripts/run-tests.js` | excludes `tests/e2e` from the plain-node domain runner (E2E has its own Playwright runner — `npm test` no longer mis-executes spec files with node) |
| `scripts/checks/repository-structure-check.js` | allowlist `playwright.config.js` at root (canonical config); structure check still passes |
| `AGENTS.md` | new mandatory section "Browser testing stack (Playwright)" merging the provided rules file: post-code workflow, browser-impacting ⇒ mandatory real-browser validation, real-PASS semantics, autonomous fix-test loop, token-efficient usage, assertion/persistence rules, secrets rules, Google-Flow credit safety |

## 5. Browser session / auth strategy

- E2E: per-test throwaway **persistent context** in tmpdir (`chromium.launchPersistentContext` — bắt buộc cho extension specs), extension loaded via `--load-extension` (Chromium supports it; branded-Chrome restriction does not apply to Playwright's Chromium).
- **Extension E2E default = headless new Chromium**: `channel: "chromium", headless: true`. Headed mode chỉ giữ cho debugging / manual observation (available via `npm run test:e2e:headed`).
- MV3 service worker có thể dormant ngay sau launch; verification headless-safe = two-stage: registry check qua `chrome://extensions` (`developerPrivate.getExtensionsInfo`) + assert SW **wake after panel bootstrap** (chi tiết §11).
- Bridge under test: own instance per run, ephemeral loopback port (fixed across in-test restarts), random 32-byte test token via `FLOW_BRIDGE_TOKEN` env override (never persisted, never printed). Test job seeded through the normal authenticated API; project dir cleaned before/after (deterministic starting state).
- Google Flow real-site flows: **LIVE_CLI_VALIDATION_ONLY** — không đưa vào durable E2E (dynamic UI + auth state = not deterministic), nhưng agent vẫn phải TỰ điều khiển browser bằng Playwright CLI khi authenticated session có thể attach/reuse (`playwright-cli attach` / persistent profile). Human intervention CHỈ được yêu cầu khi thật sự cần: initial login, OTP, CAPTCHA, browser permission, hoặc credit-consuming/destructive approval.

## 6. E2E tests tạo ra — `tests/e2e/flow-companion.spec.js`

One serial real-browser scenario (highest-value deterministic candidates from §20 of the spec, all with zero Google credits):

1. fresh profile → panel shows `BRIDGE_TOKEN_REQUIRED` (auto-bootstrap, Flow tab resolved);
2. paste once + tick remember → token-input recovery auto-runs pipeline → authenticated `GET /jobs` succeeds;
3. token persisted ONLY after authenticated success (`rememberToken=true`, `bridgeToken`, `schemaVersion=1`);
4. developer log contains NO raw token (redaction);
5. reload → remembered token auto-reconnects, field empty, "đã nhớ trên thiết bị này" placeholder, checkbox restored;
6. bridge down → dedicated `BRIDGE_UNREACHABLE` error card, token RETAINED;
7. bridge restart + retry → reconnects with remembered token;
8. "Quên mã truy cập" → `rememberToken=false`, token key removed, non-secret config kept.

Offline simulation uses a local stub tab (`flow.google.com/about` fulfilled by route interception — zero real Google traffic) because `resolveFlow` requires a Flow-matching tab; content script injects on the origin exactly as in production.

## 7. Automated tests executed (exact)

| Command | Scope | Result |
|---|---|---|
| `npm run test:e2e` | Playwright E2E, headless default (1 spec, 8-step lifecycle) | **1 passed** × 3 consecutive runs (3.4s / 3.5s / 3.7s) |
| `npm run test:e2e:headed` | same spec, headed mode | **1 passed** (3.5s) — headed path re-verified |
| `npm test` | all node domains | 56/59 (3 SAC-blocked real-render suites, unchanged) |
| `npm run test:flow` | flow domain (14 suites) | 0 failed |
| `cd flow-companion/extension && npm test` | extension suite | passed=394 failed=0 |
| `npm run check:repo-structure` | structure guard | REPOSITORY_STRUCTURE_OK |
| `npx playwright-cli open/eval/close` | live CLI smoke (real browser control from terminal) | PASS |

## 8. Fix/test iterations during E2E bring-up (honest log)

| Iteration | Failure | Root cause | Fix | Rerun |
|---|---|---|---|---|
| 1 | `context.waitForTimeout is not a function` | BrowserContext has no waitForTimeout | plain sleep helper | progressed |
| 2 | SW never appears (10s) in headless | misdiagnosed at the time as "headless cannot load extensions"; actually the MV3 SW is event-driven/dormant and profile extension state is written lazily | moved the spec to headed as a temporary bring-up measure; later corrected — headless default with registry + wake-after-bootstrap detection (see §11) | SW detected |
| 3 | error card ≠ TOKEN_REQUIRED | panel defaults to port 4317, test bridge on ephemeral port | fill `#bridge-url` with test port | progressed |
| 4 | `FLOW_TAB_NOT_FOUND` | resolveFlow needs a Flow-matching tab | offline stub tab via route fulfillment (no real Google traffic) | progressed |
| 5 | `#bridge-url` fill timeout | config fields live in the hidden Settings view | click `#open-settings` first | progressed |
| 6 | `#bridge-token` value ≠ "" in-session | wrong expectation: typed token stays in field during session; remembered tokens are the ones never rendered | assert log redaction instead; keep DOM-echo assertion after reload | progressed |
| 7 | `DUPLICATE_JOB_ID` | leftover project dir from a failed run | idempotent seed (rm project dir in beforeAll) | progressed |
| 8 | retry after bridge restart still UNREACHABLE | `startBridge()` picked a NEW random port; panel had the old URL saved | port fixed once per test run | **PASS** |

## 9. Token optimization applied

Playwright CLI (not MCP) as default agent browser control; skills installed; headless new-Chromium default (headed = debugging/manual observation only); `find`/scoped snapshots; evidence (trace/screenshot/video) only on failure, stored under `Report/evidence/playwright/`, referenced by path.

## 10. Remaining blockers / issues

1. **SAC / Remotion compositor (pre-existing)**: 3 real-render suites still fail; not hidden, not skipped. Repository-wide `npm test` remains 56/59 until the user disables SAC or Remotion ships signed binaries (see `Report/REMOTION_WINDOWS_RENDER_ENVIRONMENT_FIX_REPORT.md`).
2. Google Flow end-to-end (real logged-in UI) is `LIVE_CLI_VALIDATION_ONLY` by design — agent-driven browser control via Playwright CLI (attach/reuse persistent session); human help requested only for initial login / OTP / CAPTCHA / browser permission / credit-consuming or destructive approval. Not faked as E2E.
3. `playwright-cli` session artifacts live in `.playwright/` (workspace-local; add to `.gitignore` if git is ever initialized, together with the already-documented ignores).

## 11. Headless extension E2E validation

Added 2026-10-01 (follow-up optimization task):

- **Previous headed limitation**: the initial bring-up ran the extension spec with `headless: false` because the first headless attempt showed no service worker and no extension in the profile — which turned out to be a misdiagnosis: the MV3 service worker is event-driven (dormant until driven) and Chrome writes profile extension state lazily, so "no SW target yet" did not mean "extension not loaded".
- **New Chromium channel configuration**: `chromium.launchPersistentContext(tmpProfile, { channel: "chromium", headless: true, args: ["--disable-extensions-except=<EXT>", "--load-extension=<EXT>"] })`. Service-worker detection is two-stage and headless-safe: (1) bounded wait for `context.serviceWorkers()`; (2) if the worker is still dormant (normal for MV3), the extension identity is resolved through the `chrome://extensions` registry (`developerPrivate.getExtensionsInfo`, UNPACKED + name match — proving the extension registered headlessly); then the spec asserts the real service worker **wakes** once the panel bootstrap drives it (`expect.poll` on `context.serviceWorkers()`).
- **Exact command**: `npm run test:e2e`
- **3 consecutive results**: `1 passed (3.4s)`, `1 passed (3.5s)`, `1 passed (3.7s)` — headless, no visible browser window.
- **Service-worker detection result**: extension registered in headless mode (registry fallback), and the real `service-worker.js` worker woke and appeared in `context.serviceWorkers()` once the panel page bootstrapped. All 8 lifecycle assertions unchanged and passing.
- **Final E2E mode**: **headless new-Chromium is now the default** (`test:e2e`); headed remains available via `npm run test:e2e:headed` and was re-verified green (`1 passed (3.5s)`) so the headed path did not regress.
- **Remaining blocker**: none for extension E2E. (The unrelated SAC/Remotion real-render blocker is unchanged and documented in §10.)

## 12. Final status

**PASS** (setup task itself, updated by the headless optimization follow-up): stack installed and verified, config + scripts live, first durable real-browser E2E exists and passes repeatedly (headless default + headed verified), CLI live control works, skills installed, AGENTS.md governance merged, existing tests untouched and green (except the documented pre-existing SAC environment blocker).

Documentation correction note: PASS — documentation internally consistent (§5 headed-requirement claim removed as a misdiagnosis; section numbering de-duplicated; Google Flow wording tightened to `LIVE_CLI_VALIDATION_ONLY`).
