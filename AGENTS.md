# AGENTS.md — UNFOLDIQ (thin router)

## Project Identity

**Project Name:** UNFOLDIQ
**Type:** Agent + Remotion video generation system

## Router (read in order)

1. Read `core/WORKFLOW.md` and determine the current stage.
2. Run/consult `core/CONTEXT_ROUTER.md` + `context/ROUTES.yaml` (or `node scripts/cli/context-resolver.js --stage <STAGE> --platform <platform>`).
3. Load only REQUIRED context for that stage.
4. Load CONDITIONAL context only if its trigger applies.
5. Do NOT load development-history prompts/reports (`Report/**`, `STEP-*` prompts/fixes) for normal video production.
6. Do NOT claim required context was loaded if it was not actually read.
7. Stage rules live in `core/WORKFLOW.md` and stage docs — they are not duplicated here.

## Coding Mode (ponytail)

- Ponytail is active by default (`opencode.json` -> `.opencode/ponytail/.opencode/plugins/ponytail.mjs`, default level `full` via `%APPDATA%\ponytail\config.json`).
- Apply the ponytail ladder when writing code: does it need to exist -> reuse in repo -> stdlib -> native platform -> installed dep -> one line -> minimum that works.
- Never cut validation, error handling, security, data-loss handling or accessibility to satisfy minimalism.
- Level switch inside a session: `/ponytail lite|full|ultra|off`. Review: `/ponytail-review`.

## Browser testing stack (Playwright — mandatory)

- Primary browser stack: `@playwright/test` (durable E2E in `tests/e2e/`, run via `npm run test:e2e` / `test:e2e:headed` / `test:e2e:ui`) + `playwright-cli` (agent browser control, skills in `.agents/skills/playwright-cli`). Do NOT add Playwright MCP, BrowserCode, Browser Use, Stagehand or agent-browser unless a proven Playwright blocker exists (evidence + justification).
- Config: `playwright.config.js` (workers=1, retries=0, trace/screenshot/video retained only on failure, evidence under `Report/evidence/playwright/`).
- **Browser-impacting change** (UI, DOM, extension, content script, service worker, side panel, browser storage, auth/session, Google Flow, selector/control, user-visible browser workflow) ⇒ real-browser validation is MANDATORY: Playwright E2E +, when flows aren't deterministic, playwright-cli live validation. Unit/static tests alone are not sufficient PASS evidence.
- **Autonomous fix-test loop**: on failure → capture evidence → root cause → fix → rerun targeted → rerun browser → repeat. Only stop and report PARTIAL/FAIL when: same failure repeats 3× without new evidence, 5 cycles don't converge, OS/security block, human login/CAPTCHA needed, external service down, unauthorized credit/destructive action, or requirement ambiguity.
- **Real PASS only**: claim PASS/LIVE PASS only for tests actually executed and passing (exact command + actual result in the report). Forbidden: reasoning-only PASS, mocks for real-browser requirements, swallowed exit codes, `.skip()` to hide failures, changed expectations to match bugs, retry-until-lucky flakiness (flaky = PARTIAL/FLAKY).
- Token-efficient browser use: reuse sessions, headless when possible (headed only for login/CAPTCHA/extension integration/visual need), scoped snapshots, `find` over full dumps, screenshots only on failure/milestones, large evidence in files not chat.
- Assertions: action → verify semantic result → verify persistence; prefer role/label/test-id locators; no arbitrary sleeps (auto-wait + observable state).
- Secrets: never in prompts/tests/logs/reports/DOM/tracked files (passwords, API keys, bridge tokens, cookies). Auth state local-only.
- Google Flow credits: verify prepare/settings/readiness only; STOP before any credit-consuming action unless the task explicitly authorizes it; no blind paid retries; no destructive cloud actions.

## Standing Rules

- Evidence-based execution: every completion claim needs verifiable proof (command output, file paths, artifacts, test results).
- Reuse the existing `./remotion` project; do not duplicate it. Verify with `npx remotion compositions` after changes.
- Never commit secrets; use environment variables (see `.env.example`).
- Scope discipline: execute only the assigned step; do not pre-build future steps.
- Provider behavior resolves via `providers/INDEX.md` + `providers/CONFIG.yaml` (+ contract/notes); platform via `platforms/INDEX.md` + `platforms/<platform>/PROFILE.yaml`.
- Minimum video input: `Platform + Topic` OR `Platform + Niche` (per `core/WORKFLOW.md` Stage 1).
- No real API calls, media generation, upload/publish, or production renders unless the assigned step explicitly requires them.

## Repository hygiene (mandatory)

- No code files at repository root. Root holds only configs/docs (`package.json`, `AGENTS.md`, `start-flow.ps1`, `.env.example`, …).
- Shared production modules → `lib/`. Supported CLI → `scripts/cli/`. Check runners → `scripts/checks/`. Diagnostics/doctor → `scripts/diagnostics/`. Reusable maintenance/repair → `scripts/maintenance/`.
- Regression tests → `tests/<domain>/` (`flow`, `providers`, `pipeline`, `remotion`, `media`, `policy`, `qa`, `topic`). Never create `test-*.js` at root; run via `npm test` / `npm run test:<domain>` (runner: `scripts/run-tests.js`).
- Test fixtures → `tests/fixtures/`.
- No `fix-*`, `debug-*`, `temp-*`, `_patch_*`, `_migrate-*` files anywhere; one-off fix scripts are deleted right after the fix is verified. No `archive/` dumping ground.
- Reports → `Report/` only, never at root.
- Any file move must update requires/spawn paths, package scripts and docs; verify with `npm run check:repo-structure` and the relevant suites.

## Testing / fix artifact policy (mandatory)

- Before writing a test, use the existing runner (custom Node suites via `npm test`; extension suite: `cd flow-companion/extension && npm test`). Do not install a new test framework (Playwright/Jest/…) for a one-off check.
- A test verifying a one-off fix with no long-term regression value is deleted after the fix is verified; keep it in `tests/<domain>/` only if it guards behavior permanently.
- Record the exact test command(s) executed in every report.
