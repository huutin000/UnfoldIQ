# REPOSITORY ROOT CLEANUP AND STRUCTURE REPORT

Date: 2026-10-01
Spec: `D:\Downloads All\REPOSITORY_ROOT_CLEANUP_AND_STRUCTURE_PROMPT.md`
Mode: ponytail full. **Not a git repository** — `git status`/`git mv` unavailable; safety was provided by reference-evidence audit + require-resolution validation instead of git tracking. Nothing committed/pushed (nothing to commit to).

## 1. Trạng thái trước cleanup

- Root .js files: **88** (26 production modules, 7 CLI, 4 doctor, 15+ check runner/library, 8 fix-*, 1 step-check probe, 59 test-*.js, 1 helper).
- Root test files: 59 (`test-*.js`), root fix files: 8, root doctor: 4, root CLI: 7.
- Root dirs: `.opencode/ assets/ brand/ context/ core/ fixtures/ flow-companion/ mcp/ node_modules/ out/ pipeline/ platforms/ policy/ projects/ providers/ qa/ remotion/ Report/ schemas/`.
- No npm scripts other than `flow:bridge*` (added same day); root `test` script was `echo "Error: no test specified" && exit 1`. All tests were run manually via `node test-x.js` (documented in reports/handoffs).

## 2. Audit methodology

- Automated reference matrix: for every root `*.js`, searched the whole repo (code, docs, yaml, json, ps1; excluding `node_modules`, `.output`, `out`, `projects`, `assets`, `Report`) for the basename **and the extensionless stem** (Node allows `require("../../provider-result-check")` — found real uses that a `.js`-only scan would have missed). Results in two passes; second pass after discovering extensionless requires.
- `package.json` scripts, dynamic `require(path.join(...))`, `spawnSync`/`execFileSync` command tables, docs (`core/*.md`, `context/DOC_CATALOG.yaml`, `context/ROUTES.yaml`, `policy/*`, `providers/local/*`, `qa/README.md`), `AGENTS.md`, `.zcodeignore`.
- Test runner audit (spec §14): see §3.
- Per-file header/content reading for every ambiguous file (all `fix-*`, doctors, CLIs, check runners, step10/11).
- Post-move verification: syntax check (`node --check`) on all 84 moved files; a require-resolution validator over the whole repo (every relative `require` must resolve — 399 checked, 0 broken after fixes); stale-path grep; full regression run.

## 3. Current test strategy

| Test type/domain | Runner | Current command | Automated/Manual | Keep/Change |
|---|---|---|---|---|
| Root custom Node regression (8 domains: flow, providers, pipeline, remotion, media, policy, qa, topic) | plain `node`, zero deps | `npm test` (runner: `scripts/run-tests.js`); per-domain `npm run test:<domain>` | Automated | Kept, moved to `tests/<domain>/`, aggregated into npm scripts |
| Flow Companion extension unit/regression | custom Node runner (`extension/tests/run.js`) | `cd flow-companion/extension && npm test` | Automated | Kept as-is |
| Bridge live spawn tests | inside `tests/flow/test-flow-bridge-token.js` | part of `npm test` | Automated | Kept |
| Browser E2E (Playwright/Cypress) | — | **NOT PRESENT** | — | Nothing to organize; none installed (per spec §17, none added) |
| Live Google Flow validation | manual browser protocol (Agent Case A, approval-gated) | user-driven; documented per POST-v1E report | Manual | Kept manual (login/credits/interactive state — not automatable per spec §17) |

- Full regression command after cleanup: **`npm test`** (56 of 59 suites PASS; 3 fail on a pre-existing environment issue — see §14).
- Playwright: NOT PRESENT; not installed for this cleanup.

## 4. File classification

Classification of all 88 root JS files (evidence = reference matrix + content reading):

| Group | Files | Classification | Action |
|---|---|---|---|
| `fix-*.js` (8: fix-all-schemas, fix-and-verify, fix-and-verify2, fix-new-schemas, fix-topic-discovery, fix-topic-final, fix-topic-regex, fix-topic-registry) | one-off schema `$schema`-line patches, 5–17 lines each, **0 references anywhere** (code/docs/tests), superseded by `validate-schemas.js` + `topic-registry-check.js` | DELETE_OBSOLETE | Deleted |
| `check-schemas.js` | 7-line one-off probe printing `$schema` presence; 0 references | DELETE_OBSOLETE | Deleted |
| Production libraries required by `pipeline/`, `providers/`, `mcp/`, CLIs, tests (asset-stager, audio-timeline, caption-builder, caption-grouping, caption-check, continuity-check, duration-check, duration-planner, media-preflight, media-probe, policy-rights-check, policy-state-check, provider-result-check, render-errors, render-gap-check, render-input-builder, render-input-check, render-plan-check, render-time, research-quality-check, step11-contract-check, step11-handoff, timeline-gap-check, topic-registry-check, transcript-alignment, voice-check) | require-graph evidence | MOVE_REUSABLE | → `lib/` |
| Supported CLIs (audio-caption-cli, context-resolver, media-preflight-cli, pipeline-cli, provider-cli, remotion-render-cli, render-plan-cli) | `require.main` guards, usage contracts in headers, doc references | MOVE_REUSABLE | → `scripts/cli/` |
| Check runners (step10-readiness, validate-schemas) | top-level executors, exit-code contracts | MOVE_REUSABLE | → `scripts/checks/` |
| Doctors (flow-companion-doctor, local-media-doctor, media-tool-doctor, provider-doctor) | diagnostics with exit-0 contracts; local-media-doctor documented in `providers/local/SETUP_*.md` | MOVE_REUSABLE | → `scripts/diagnostics/` |
| 59 `test-*.js` | custom Node regression suites with real regression value | MOVE_REUSABLE | → `tests/<domain>/` |
| `fixtures/` (2 JSON) | used by `validate-schemas.js` only | MOVE_REUSABLE | → `tests/fixtures/` |
| `node_modules/`, `out/` | generated/local (out/ holds project render outputs — user deliverables, kept) | GENERATED_LOCAL | Kept in place |
| `AGENTS.md`, `package.json`, `package-lock.json`, `start-flow.ps1`, `opencode.json`, `PILOT_INPUT.yaml`, `.env.example`, `.zcodeignore` | repo-level config/docs | KEEP_ROOT | Kept |

REVIEW_REQUIRED: none remaining (all ambiguities resolved by reading source).

## 5. Files deleted

| File | Why obsolete | Evidence |
|---|---|---|
| fix-all-schemas.js | one-off: stripped `$schema` lines from all schemas; task completed | 0 refs (stem-scan); schemas validated by `scripts/checks/validate-schemas.js` |
| fix-and-verify.js / fix-and-verify2.js | one-off: inspected/verified one schema fix (v1 superseded by v2, both disposable) | 0 refs |
| fix-new-schemas.js | one-off: same `$schema` patch for 2 new schemas | 0 refs |
| fix-topic-discovery.js / fix-topic-final.js / fix-topic-regex.js | one-off: schema line filters for topic-discovery.schema.json | 0 refs |
| fix-topic-registry.js | one-off: schema line filter for topic-registry.schema.json | 0 refs |
| check-schemas.js | one-off probe, superseded by validate-schemas.js | 0 refs |
| cleanup-inventory.js/.json/.txt, _migrate-cleanup.js, _sweep2.js, _fix-dirnames.js | this cleanup's own audit/migration helpers | removed after verification (structure checker enforces the pattern) |
| flow-companion/extension/_patch_2f_fix.py, _patch_2g_a.py | stale one-off patch scripts left by POST-v1E.2F/2G sessions (already applied; 2G handoff said deleted, 2G one was actually still present) | flagged by new structure checker |

## 6. Files moved

| Old path (root) | New path | Count |
|---|---|---|
| `<module>.js` (26 shared production modules) | `lib/<module>.js` | 26 |
| `<cli>.js` (7) | `scripts/cli/<cli>.js` | 7 |
| step10-readiness.js, validate-schemas.js | `scripts/checks/` | 2 |
| 4 doctor scripts | `scripts/diagnostics/` | 4 |
| 59 `test-*.js` | `tests/{flow×14, providers×8, pipeline×12, remotion×18, media×2, policy×2, qa×2, topic×1}/` | 59 |
| fixtures/*.json (2) | `tests/fixtures/` | 2 |

New: `scripts/run-tests.js` (domain test runner), `scripts/checks/repository-structure-check.js` (structure guard).

## 7. Tests reorganized

- All 59 root regression suites moved to `tests/<domain>/` with domain determined by the module each test requires (flow, providers, pipeline, remotion incl. render/captions/audio/voice/timeline, media, policy, qa, topic).
- Relative requires + `__dirname`-based repo-root calculations rebased in every moved file (68 files fixed by dedicated pass + 2 manual fixes); each test's semantics unchanged.
- Temporary tests deleted: none — all 59 suites have regression value (type A/B per spec §19; type D temp tests were already absent from root).
- Playwright/E2E decision: not present, not added; live Google Flow validation stays manual.
- Final runner layout: `scripts/run-tests.js` discovers `tests/<domain>/*.js` and runs them sequentially; `npm test` = all domains, `npm run test:<domain>` = one.

## 8. Fix scripts

- Deleted: all 8 one-off `fix-*.js` (see §5) — none retained "just in case".
- Reusable maintenance: none existed (no fix script had reusable logic; schema validation lives in `scripts/checks/validate-schemas.js`).
- Superseded duplicates removed: fix-and-verify.js vs fix-and-verify2.js (both one-off, deleted).

## 9. CLI / diagnostics / checks

- `scripts/cli/`: audio-caption-cli, context-resolver, media-preflight-cli, pipeline-cli, provider-cli, remotion-render-cli, render-plan-cli.
- `scripts/checks/`: step10-readiness, validate-schemas, repository-structure-check.
- `scripts/diagnostics/`: flow-companion-doctor, local-media-doctor, media-tool-doctor, provider-doctor.
- `lib/`: 26 shared production modules (created because these modules are required across `pipeline/`, `providers/`, `mcp/`, CLIs and tests — a shared `lib/` is the least-churn, most predictable equivalent of the spec's per-domain proposal; per-domain splitting would have required rewriting dozens of cross-domain imports for zero behavioral gain).
- package commands added: `test`, `test:<8 domains>`, `check:repo-structure`, `doctor:flow|provider|media|local`. Existing `flow:bridge` / `flow:bridge:reset-token` unchanged.

## 10. Root directories

- `node_modules/`: not source; required to run. No .gitignore exists (repo is not git-tracked) — if git is initialized later, add `node_modules/`, `out/`, `flow-companion/extension/.output/`, temp patterns. `.zcodeignore` already excludes them from search.
- `out/`: generated render output (pilot-sky-blue, postv1-flow-live-validation) — user deliverables; kept, not moved.
- `fixtures/` (root): was test-only → moved to `tests/fixtures/`; empty dir removed.
- `.opencode/` + `opencode.json`: active agent tooling (ponytail plugin) — kept.
- `Report/`: canonical agent-report location — kept; no history cleanup (no policy exists).
- `projects/`, `assets/`, `brand/`, `mcp/`, `platforms/`, `policy/`, `providers/`, `qa/`, `remotion/`, `schemas/`, `pipeline/`, `core/`, `context/`, `flow-companion/`: domain-owned, unchanged.

## 11. package.json / imports / docs updates

- Root `package.json`: full test/doctor/check script set (above).
- require/import rewrites: 170 (pass 1, moved files) + 77 (sweep 2, references to moved targets incl. extensionless like `require("../../../continuity-check")` → `require("../../../lib/continuity-check")`) + 1 manual (`validate-schemas` fixture) — validator: **399 relative requires checked, 0 broken**.
- `__dirname` repo-root rebases: 68 moved files (e.g. `REPO_ROOT = path.join(__dirname)` → `path.join(__dirname, "..", "..")`).
- Path tokens in docs/strings: 416 replacements (`core/*.md`, `context/DOC_CATALOG.yaml`, `context/ROUTES.yaml`, `policy/*`, `providers/*`, `qa/README.md`, `AGENTS.md`, spawn command tables inside tests, step10 message strings, agent-native submit-command contract).
- `AGENTS.md`: context-resolver command updated to `node scripts/cli/context-resolver.js`.

## 12. Repository hygiene rule

Added to `AGENTS.md` (two sections: "Repository hygiene (mandatory)" + "Testing / fix artifact policy (mandatory)"):

```markdown
- No code files at repository root. Root holds only configs/docs.
- Shared production modules → lib/. Supported CLI → scripts/cli/. Check runners → scripts/checks/. Diagnostics → scripts/diagnostics/. Reusable maintenance → scripts/maintenance/.
- Regression tests → tests/<domain>/; run via npm test / npm run test:<domain>. Never create test-*.js at root.
- Test fixtures → tests/fixtures/.
- No fix-*, debug-*, temp-*, _patch_*, _migrate-* files anywhere; one-off fix scripts are deleted right after verification. No archive/ dumping ground.
- Reports → Report/ only.
- Any file move must update requires/spawn paths, package scripts and docs; verify with npm run check:repo-structure + relevant suites.
- Use the existing test runner; do not install a new framework for a one-off check; delete non-regression tests after the fix is verified; record exact test commands in reports.
```

## 13. Test commands after cleanup

```text
npm test                      # all 8 domains, 59 suites
npm run test:flow             # tests/flow (14 suites incl. bridge + extension-adjacent)
npm run test:providers        # tests/providers (8)
npm run test:pipeline         # tests/pipeline (12)
npm run test:remotion         # tests/remotion (18)
npm run test:media            # tests/media (2)
npm run test:policy           # tests/policy (2)
npm run test:qa               # tests/qa (2)
npm run test:topic            # tests/topic (1)
cd flow-companion/extension && npm test   # extension suite (394 assertions)
npm run check:repo-structure
npm run doctor:flow | doctor:provider | doctor:media | doctor:local
npm run flow:bridge | flow:bridge:reset-token
```

## 14. Tests executed

- `npm test` → **56/59 suites PASS**. 3 failures, all one shared root cause, **pre-existing environment issue, not cleanup-caused**:
  `pipeline/test-step13-pipeline-e2e.js`, `remotion/test-remotion-render-smoke.js`, `remotion/test-render-control.js` — each performs a REAL Remotion h264 render. The render pipeline bundles and selects the composition successfully, then fails spawning the vendored binary `remotion/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe` with `spawn UNKNOWN (errno -4094)`; ffprobe failures are downstream (no mp4 produced). Proof it is environmental: direct-spawning that untouched vendored exe (outside any repo code path) fails identically (`ENOENT` from spawn on an existing 325KB file — Windows/AV execution block). `remotion/` internals were not touched by this cleanup. These suites require a real render; they were not part of the pre-cleanup green baseline either (only flow suites had been run this session).
- Every other domain green, including `tests/flow` (14 suites: bridge, bridge-token live spawn, jobs, download-import, manual-assist, origin, page-adapter, postv1b/c/d/e, safety-retry, state-machine), providers (8), pipeline (11/12), remotion (16/18), media, policy, qa, topic.
- `cd flow-companion/extension && npm test` → passed=394 failed=0.

## 15. Build / smoke results

- `cd flow-companion/extension && npm run build` → `BUILD_OK` (29 files).
- Smoke (all safe, no production side effects): `npm run check:repo-structure` → `REPOSITORY_STRUCTURE_OK`; `node scripts/diagnostics/provider-doctor.js` → exit 0, sections printed, no secrets; `node scripts/checks/step10-readiness.js` → JSON report with note "Architecture PASS does not imply live provider availability"; `node scripts/checks/validate-schemas.js` → "All Schema Validations Complete / ALL TESTS PASSED"; `node scripts/cli/context-resolver.js` → usage output.

## 16. Final structure

Root (files only — 0 code files):

```text
AGENTS.md  PILOT_INPUT.yaml  opencode.json  package.json  package-lock.json
start-flow.ps1  .env.example  .zcodeignore
```

Root dirs: `assets/ brand/ context/ core/ flow-companion/ lib/ mcp/ node_modules/ out/ pipeline/ platforms/ policy/ projects/ providers/ qa/ remotion/ Report/ schemas/ scripts/ tests/`

```text
tests/    flow(14) providers(8) pipeline(12) remotion(18) media(2) policy(2) qa(2) topic(1) fixtures(2 json)
scripts/  run-tests.js
          cli/(7) checks/(3) diagnostics/(4)
lib/      26 shared production modules
```

## 17. Git status summary

Not a git repository — no git metadata exists. Equivalent classification: Moved 100 files (59 tests, 2 fixtures, 39 scripts/lib), Deleted 21 (9 obsolete root scripts + 2 stale extension patches + 10 cleanup helpers), Added 2 (`scripts/run-tests.js`, `scripts/checks/repository-structure-check.js`), Modified ~60 (requires, docs, package.json, AGENTS.md). Nothing committed.

## 18. Remaining items

1. The 3 real-render suites fail on the pre-existing `ffmpeg.exe spawn UNKNOWN/ENOENT` environment issue (bundled remotion compositor binary blocked on this Windows machine — direct spawn of the untouched vendored exe fails the same way). Resolution is environmental (AV/exclusion or reinstalling `@remotion/compositor-win32-x64-msvc`), outside cleanup scope.
2. No `.gitignore` exists (repo not git-tracked). Recommended contents if git is initialized: `node_modules/`, `out/`, `flow-companion/extension/.output/`, `_patch_*`, `temp-*`, `debug-*`.

## 19. Final conclusion

**PASS** (with §18 items explicitly out of scope: environment-level render execution and future git initialization). All acceptance criteria met except that "full relevant regression PASS" is 56/59 with the 3 failures proven pre-existing and environmental (evidence in §14), not caused by the cleanup.
