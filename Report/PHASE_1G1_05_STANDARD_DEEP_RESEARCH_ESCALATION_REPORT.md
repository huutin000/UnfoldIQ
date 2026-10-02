# PHASE 1G.1 — PROMPT 05
# STANDARD / DEEP RESEARCH ESCALATION REPORT

## 1. Status

```text
TASK_VALIDATION = PARTIAL — DEEP live provider validation not authorized/configured
SCOPE = 1G.1Q STANDARD / DEEP Research Escalation (GPT Researcher as DEEP-only provider)
BASELINE: PRE-FLIGHT V5 + PROMPT 01 + PROMPT 02 + PROMPT 03 + PROMPT 04 all PASS and intact
NO paid services. NO API spend. NO Flow/Veo. NO credits consumed.
```

All implementation, fixture E2E, doctor, no-cost provider integration proof, and
full regressions PASS. The single blocker for full PASS is external, not technical:
no explicit live-test opt-in (`UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1`) and no LLM/search
credentials exist in this environment, so the one bounded real DEEP run required by
§86–§89 / §115 could not be executed. Per §12/§90 this yields PARTIAL, not PASS.

## 2. Scope

Implemented exactly `1G.1Q STANDARD / DEEP RESEARCH ESCALATION`:

- STANDARD stays default; DEEP runs only on explicit eligibility
  (`NEEDS_MORE_RESEARCH` + allowed + material solvable gap + budget + provider).
- `DeepResearchProvider` interface; core never imports `gpt_researcher` directly.
- `GPTResearcherProvider` adapter via isolated Node↔Python JSON bridge
  (`research/deep-worker.py`, dedicated venv `research/.venv-deep`).
- DEEP output = leads only: candidate URLs → Prompt-02 canonical acquisition →
  Prompt-03 Source Registry / Independence / Evidence → Sufficiency re-evaluation →
  Prompt-04 unchanged Pack contract.
- Bounded retry/timeout/cancellation/cost controls; paid-live-test gate enforced.
- No Humanizer, no Beat/Scene/Shot, no Visual Story Grammar, no TTS/voice/caption,
  no media generation, no 1G.2+ work, no redesign of Prompt 02–04 contracts.

## 3. Baseline Read

Actually read (current versions): `AGENTS.md`; `core/WORKFLOW.md` (full);
`package.json` (deep scripts already registered: `research:deep:setup`,
`research:deep:doctor`, `research:deep:live-smoke`, `test:research-deep`);
`lib/research-acquisition/` (4 modules, listed);
`lib/research-evidence/` (9 modules, listed); `lib/research-story/` (6 modules, listed);
`lib/research-deep/` (6 modules, full read); `research/crawl4ai-worker.py`
(exists); `research/deep-worker.py` (full read); `research/requirements.txt`
(`crawl4ai==0.9.4`); `research/deep-requirements.txt`
(`gpt-researcher==0.15.1` + pin rationale); `scripts/run-tests.js` (domain runner);
`scripts/checks/validate-schemas.js`, `scripts/checks/repository-structure-check.js`;
all 5 `tests/research-deep/` suites (full read); `tests/fixtures/evidence-fixtures.js`
(imported by E2E); `Report/PHASE_1G1_01..04_*` (01–03 listed, 04 read §§1–5:
TASK_VALIDATION = PASS); `.gitignore`; `.env.example` (referenced via scripts only,
no secrets read or printed).

Also audited live: system Python version, both venvs' Python executables,
Crawl4AI venv contents, env/config loading (names-only checks), secret handling
(redact-only helpers), external-process bridge conventions (Prompt-02 JSON-over-stdio
pattern mirrored), cancellation (`AbortSignal` → kill owned child only),
cost/budget conventions (config clamp + `maxCostClass`), provider doctor/diagnostics.

No working Prompt-02 Crawl4AI environment was altered (verified: Crawl4AI venv
imports `crawl4ai==0.9.4` cleanly after all deep work).

## 4. Official GPT Researcher Compatibility Review

Verified 2026-10-02 via live web lookup (PyPI + GitHub + docs):

| Item | Finding |
|---|---|
| Official repo | `assafelovic/gpt-researcher` (MIT, maintainer Assaf Elovic) — used, no fork |
| Docs | `https://docs.gptr.dev/docs/gpt-researcher/gptr/pip-package` and `/deep_research` |
| Supported Python | `>=3.11` per PyPI metadata — local Python is 3.12.10, compatible |
| Install method | `pip install gpt-researcher` (pip package preferred over cloning UI app) |
| Deep API used | `GPTResearcher(query, report_type="deep").conduct_research()`, `write_report()`, `get_source_urls()`, `get_research_sources()`, `get_costs()`, `get_research_context()` |
| Deep config surface | `DEEP_RESEARCH_BREADTH` / `DEEP_RESEARCH_DEPTH` / `DEEP_RESEARCH_CONCURRENCY` env + `TOTAL_WORDS` |
| Required credentials | LLM key (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) + search key (`TAVILY_API_KEY` / `SERPER_API_KEY` / `SEARCHAPI_API_KEY`) |
| Pinned version | `gpt-researcher==0.15.1` (imports cleanly; exposes all Deep APIs above) |
| Latest PyPI at check | 0.16.1 (0.16.0 recorded BROKEN upstream: `query_processing.py` uses `typing.Any` without import → `NameError` on `import gpt_researcher`; recorded in `research/deep-requirements.txt`) |
| UI | NOT integrated (no frontend, Next.js, report viewer, publishing, PDF/Word export, image generation) |

Pin is exact (`==0.15.1`), not `git main`, not machine-wide `pip freeze`.

## 5. Installed Provider Version / Python Environment

| Component | Version / Path | Source |
|---|---|---|
| System Python | 3.12.10 (`python --version`, `py -3 --version` agree) | live probe |
| Deep venv Python | `research/.venv-deep/Scripts/python.exe`, Python 3.12.10 | live probe |
| Crawl4AI venv Python | `research/.venv/Scripts/python.exe`, present, untouched | live probe |
| `gpt-researcher` (deep venv) | 0.15.1, `import gpt_researcher` OK | live probe |
| `crawl4ai` (research venv) | 0.9.4, `import crawl4ai` OK | live probe |
| Node | v24.16.0 (need >=18) | doctor output |
| Platform | win32 | doctor output |

## 6. Dependency Isolation

- DEEP provider lives in dedicated `research/.venv-deep` (created by
  `npm run research:deep:setup` → `scripts/maintenance/setup-deep-env.js`).
- Crawl4AI env (`research/.venv`, `crawl4ai==0.9.4`) never touched by deep setup;
  post-task import + version probe both PASS.
- `research/deep-requirements.txt` pins only `gpt-researcher==0.15.1` (minimal,
  no freeze dump).
- Fix applied this session: `.gitignore` did not cover `research/.venv-deep/`
  (only `research/.venv/` + `.venv/`); added explicit `research/.venv-deep/` entry.
  Verified: `npm run check:repo-structure` → `REPOSITORY_STRUCTURE_OK` after fix.
- Never committed: `.venv*`, site-packages, caches, credentials (nothing committed
  at all — repo has no commits yet; no secrets exist in worktree outside venvs).

## 7. Provider Doctor

`npm run research:deep:doctor` (`scripts/diagnostics/deep-provider-doctor.js`):
no-cost, prints names only, exit 0 informational. Live result:

```text
deep venv python: D:\Project\UNFOLDIQ\research\.venv-deep\Scripts\python.exe PRESENT
deep worker: D:\Project\UNFOLDIQ\research\deep-worker.py PRESENT
pinned requirements: gpt-researcher==0.15.1
crawl4ai venv untouched: PRESENT
status: READY_NO_LIVE_APPROVAL providerVersion=0.15.1
llmConfigured: no
searchConfigured: no
liveApproved (UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1): no
```

Statuses implemented: `READY` / `READY_NO_LIVE_APPROVAL` / `MISSING_CREDENTIALS` /
`NOT_INSTALLED` / `BROKEN` (in `gpt-researcher-bridge.js#checkReady`).

## 8. DeepResearchProvider Interface

`lib/research-deep/provider-interface.js`:

- `DeepResearchProvider.run(request) → DeepResearchResult` contract; canonical
  ownership orchestration → interface → adapter; core never imports provider internals.
- `PROVIDER_PROTOCOL_VERSION = 1`, `PROVIDER_ID = "gpt-researcher"`.
- `validateDeepRequest` (requires gap-mapped request: `recommendedQuestions` or
  `criticalGaps`; positive-int bounds).
- `normalizeDeepResult` (strips everything to lead-safe shape: urls, candidates,
  queries, follow-ups, learnings+source links, citations, progress, warnings/errors,
  cost; never assigns claim classes / evidence statuses / corroboration).
- `redactSecrets` (values → `<REDACTED_PRESENT>`/`<ABSENT>`), `credentialState`
  (names-only presence), `isLiveApproved` (`UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1`).
- Error taxonomy incl. all §96 codes + bridge codes (`BRIDGE_PROTOCOL_ERROR`,
  `WORKER_SPAWN_FAILED/TIMEOUT/CANCELLED/FAILED`).

## 9. GPTResearcher Adapter

`lib/research-deep/gpt-researcher-bridge.js` + `research/deep-worker.py`:

- `runDeepResearch(request, opts)` = adapter `run()`: validates, delegates to worker,
  normalizes success, preserves provider error codes on failure.
- Worker ops: `version` (no-cost import check), `config` (names-only check),
  `run` (refuses without BOTH live opt-in AND LLM+search credentials — no spend).
- `run` uses gap-mapped query (`topic + focus: gaps[0..3]`), clamps
  breadth 1–4 / depth 1–2 / concurrency 1–2, `total_words = 800` bounded diagnostic
  prose; returns candidates from `get_research_sources()` + `get_source_urls()`,
  learnings from `get_research_context()`, cost from `get_costs()`.
- No LLM/retriever hard-coding in UNFOLDIQ contracts (retriever + model stay
  adapter/provider configuration; evidence schemas unchanged).
- No provider UI/media features invoked (research + optional diagnostic prose only).

## 10. Node ↔ Python / Runtime Bridge

Proven Prompt-02 pattern mirrored: Node owns orchestration, Python owns provider
library, JSON over stdin/stdout (`{protocolVersion, operation, request}` →
`{protocolVersion, operation, ok, result|errorCode|errorMessage}`), stderr =
diagnostics, exit code = status, UTF-8, bounded timeouts
(`processTimeoutMs` default 5 min, startup 120 s; run bound by `maxDurationMs`).

- Invalid/mixed stdout → `BRIDGE_PROTOCOL_ERROR`, never silent corruption
  (tested DP3).
- Timeout kills ONLY the owned child (`child.kill()` on the spawned handle);
  cancellation via `AbortSignal` → `WORKER_CANCELLED` (tested DP4/DP5).
- Windows: `Scripts\python.exe` resolution, `windowsHide: true`, env-override
  `UNFOLDIQ_DEEP_PYTHON`, no `python3` assumption, PowerShell-compatible helpers.
- No global PATH / package / execution-policy mutation; project-scoped venv only.

## 11. STANDARD Default Behavior

`researchMode = STANDARD` canonical. Policy proof:

- `deepResearchAllowed = true` means permitted, never required (EP2 needs the full
  gate set; flag alone never escalates).
- `SUFFICIENT` (without explicit request) → `STAY_STANDARD`, provider run count 0
  (EP1 + fixture F1 against the REAL sufficiency gate).
- Fixture E2E F1: STANDARD two-group SUFFICIENT world → `deepRunStatus = NOT_RUN`,
  `providerCalls === 0`.
- STANDARD regression invariant: all 14 `tests/research/` + 8 `tests/story/` suites
  PASS unchanged with deep code present but untriggered.

## 12. Escalation Policy

`lib/research-deep/escalation-policy.js#decideEscalation` → decision
`{eligible, action, reasonCodes[], gapRefs[], recommendedQuestions[], maxDepth,
maxBreadth, maxConcurrency, maxQueries, maxDuration, maxCostClass, providerId}`.
Actions: `STAY_STANDARD | ESCALATE_DEEP | REVIEW_REQUIRED | BLOCKED`.

Conservative bounds (`DEFAULT_DEEP_CONFIG`): escalations 1, breadth 2, depth 2,
concurrency 2, queries 10, duration 5 min, cost SMALL; `clampConfig` hard-caps
(escalations ≤3, breadth ≤4, depth ≤2, concurrency ≤2, queries ≤20, duration ≤15 min).
Live-smoke config smaller (breadth 2 / depth 1 / concurrency 2 / queries 4).

## 13. Eligibility Rules

All mandatory checks enforced in order: FICTION+NOT_REQUIRED guard →
SUFFICIENT guard → BLOCKED triage → `deepAllowed` → budget → escalation count →
provider availability → STANDARD-attempted → material gap → gap solvable.
Reason codes: the 8 required escalation reasons + `STANDARD_SUFFICIENT`,
`DEEP_NOT_ALLOWED`, `FICTION_NO_RESEARCH`, `BLOCKED_ACCESS_POLICY`,
`BUDGET_EXHAUSTED`, `PROVIDER_UNAVAILABLE`, `MAX_ESCALATIONS_REACHED`,
`EXPLICIT_DEEP_REQUEST`, `NO_MATERIAL_GAP`, `GAP_NOT_RESEARCH_SOLVABLE`,
`STANDARD_NOT_YET_ATTEMPTED`. No `DEEP_BECAUSE_MORE_IS_BETTER` path exists.

## 14. BLOCKED / Access Rules

`BLOCKED` stays `BLOCKED` by default. No-DEEP blocker codes:
`AUTH_REQUIRED, HUMAN_ACTION_REQUIRED, AUTH_STATE_IN_REPO, POLICY_BLOCKED,
PRIVATE_SOURCE, BUDGET_EXHAUSTED, USER_PROHIBITED, PAYWALL_NO_ACCESS`.
BLOCKED → DEEP only when `blockerIsDiscoverableGap === true` AND the code is not in
the no-DEEP list (EP5 covers the default). Budget/time/query/provider budgets and
attempt counts gate every escalation; explicit DEEP requests still face all
safety/budget gates (EP8: budget denial + fiction guard both hold when explicit).

## 15. Budget / Cost / Live-Test Approval

- Policy inputs `budgetRemaining`, `escalationsUsed/maxDeepEscalations`; hard caps in
  `clampConfig`; per-run `maxDurationMs` timeout.
- Paid-live-test gate default DISABLED: real run requires BOTH
  `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1` (operator-created; never set by code/tests —
  verified absent) AND LLM+search credentials (verified absent). Key presence alone
  is never consent (`credentialState` is names-only).
- `npm run research:deep:live-smoke` without opt-in → `REFUSED:
  DEEP_LIVE_NOT_APPROVED`, exit 2, nothing executed (live-verified this session).
- Cost observability: `cost: {known | null, limit: maxCostClass}` — never fabricated
  (worker passes real `get_costs()` scalar or null with the configured limit labeled
  as limit).

## 16. Deep Request Contract

`buildDeepRequest(plan, gaps, decision, opts)`: `protocolVersion, requestId,
researchPlanId, researchPlanHash, topic, researchGoal, criticalGaps[],
recommendedQuestions[], missingEvidence, weakClaims, unresolvedContradictions,
contentClass, contentMode, timeScope, geographicScope, freshnessRequirement,
maxBreadth/Depth/Concurrency/Duration/Queries, maxCostClass, providerId,
sourcePriority[], excludedDomains[], requiredDomains[], progressEnabled`.
Built ONLY from Prompt-03 targeted gaps (`missingQuestions/missingEvidence/
weakClaims/unresolvedContradictions/recommendedQueries`) — never a generic
"research X deeply", never full source bodies/reports/story artifacts (§91–§92).

## 17. Deep Result Contract

Normalized result: `requestId, providerId, providerVersion, startedAt/completedAt,
status, visitedUrls[], candidateSources[{url,title,context}], queries[],
followUpQuestions[], learnings[{text,sourceUrls}], providerCitations[],
progressSummary, warnings[], errors[], cost, providerReportRef?`.
Learnings/report/citations carry NO claim verdicts (DP2 asserts no `claimClass`/
`claimId`/`packEntry` keys). Provider report stored at most as a diagnostic
artifact reference (`providerReportRef`), default-loaded nowhere near Storytelling.

## 18. Progress / Timeout / Cancellation

- Progress captured as normalized safe data (`progressSummary: {breadth, depth,
  concurrency}` + counts); observability only, never mutates Evidence state.
- Bounded `provider startup timeout` (120 s), `deep run timeout`
  (`maxDurationMs`, hard-cap 15 min), `child-process timeout`; on timeout the owned
  child is terminated and structured `WORKER_TIMEOUT`/`DEEP_TIMEOUT` returned;
  STANDARD evidence untouched.
- Cancellation propagates (`AbortSignal` → kill owned child → `WORKER_CANCELLED`);
  no unrelated processes touched (handle-scoped `kill`, `windowsHide`).
- Retry policy: transient-only (network timeout, 5xx, rate-limit with Retry-After
  semantics); never invalid credentials / budget-denied / policy-blocked / invalid
  config; bounded by attempt + query caps. Rate/cost exhaustion preserved verbatim
  (`DEEP_RATE_LIMITED` / `DEEP_BUDGET_EXHAUSTED`); no silent provider switching, no
  fake-data downgrade.

## 19. Provider Error Handling

Taxonomy reused from `DEEP_ERROR_CODES` (§96 + bridge codes). Orchestrator
(`lib/research-deep/index.js#runDeepEscalation`) maps every failure to:
STANDARD artifacts intact + structured `deepRunStatus` + before-state sufficiency.
`DEEP_PROVIDER_UNAVAILABLE` preserves `NEEDS_MORE_RESEARCH` (EP7). Partial-branch
warnings survive normalization and flow into the attempt record + sufficiency inputs
(DP7, fixture F4). Failed-branch coverage gaps must influence Sufficiency via the
injected `evaluateSufficiency` (fixture F4 models exactly this).

## 20. Deep Output as Leads, Not Truth

Permanent rule enforced in code (`deep-leads.js` header + tests EB1–EB3):

- Learnings with no URL → `UNVERIFIED_LEAD`, `usableAsEvidence: false`.
- Learnings WITH urls → `CANDIDATE_LINKED_LEAD`, still `usableAsEvidence: false`
  until canonical acquisition.
- Provider report → `assertReportNotPack`: never canonical evidence, never a Pack entry.
- Follow-up questions become candidate queries only after dedupe/scope/plan
  compatibility (orchestrator slices + caps; `scopeDriftCheck` drops out-of-scope
  branches with `DEEP_SCOPE_DRIFT`).
- Creative Brief may shape depth/density/duration/audience bounds via request config;
  truth threshold / independence / correctness never relax (same gates as STANDARD).

## 21. Canonical Re-acquisition

Every DEEP URL that may support evidence goes through Prompt-02 URL Safety +
canonical acquisition (Crawl4AI/browser path → `AcquiredDocument` with SSR
...[truncated 15821 chars]