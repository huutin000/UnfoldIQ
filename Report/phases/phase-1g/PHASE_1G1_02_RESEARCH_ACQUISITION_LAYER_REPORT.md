# PHASE 1G.1 — PROMPT 02
# RESEARCH ACQUISITION LAYER REPORT

## 1. Status

```text
TASK_VALIDATION = PASS
SCOPE = 1G.1D Research Mode + Search Provider + 1G.1E Crawl4AI + 1G.1F Dynamic/Auth Browser Extraction
BASELINE: PRE-FLIGHT V5 PASS + PROMPT 01 PASS (both intact, see §39-§41)
NO paid API calls. NO Flow/Veo. NO publishing. NO credits consumed.
```

## 2. Scope

Acquisition pipeline only: validated Research Plan → STANDARD/DEEP routing →
SearchProvider exchange → normalized results → URL safety gate → robots →
Crawl4AI direct OR Playwright-rendered-HTML → shared AcquiredDocument.
Ends at acquisition. No truth/independence/authority/sufficiency verdicts
(Prompt 03 owns those; grep-verified absent, see §48).

## 3. Baseline Read

Actually read (current repo versions): `AGENTS.md`, `core/WORKFLOW.md`,
`core/CONTENT_MODE.md`, `core/RESEARCH_QUALITY.md`, `core/CONTEXT_ROUTER.md`,
`platforms/INDEX.md`, both `PROFILE.yaml`, both `OVERLAY.md`,
`schemas/research-plan.schema.json`, `schemas/research-brief.schema.json`,
`lib/content-class.js`, `lib/research-plan.js`, `lib/v5-contract-check.js`,
`lib/research-quality-check.js`, `context/ROUTES.yaml`, `context/DOC_CATALOG.yaml`,
all five pipeline tests, both Prompt 01/PRE-FLIGHT reports, `package.json`,
`scripts/run-tests.js`, both checks. Audited: no prior Python/venv (zero
`.py` files), no `.gitignore`, Playwright 1.63.0 + chromium-1243 present,
provider runtime conventions (`errors.js`, `timeout-policy.js`,
`request-fingerprint.js` SHA-256), doctor conventions
(`scripts/diagnostics/*`, exit-0-always, no secrets), no programmatic
browser launching in repo code (agent uses `playwright-cli` + `npx playwright test`).

## 4. Existing Architecture Reused

| Reused | How |
|---|---|
| `providers/runtime/request-fingerprint.js` SHA-256 + stable stringify | Content-hash convention (worker hashes with SHA-256) |
| `providers/runtime/errors.js` error classes | Retry taxonomy aligned (transient/policy/unavailable spirit) |
| `providers/runtime/timeout-policy.js` bounded waits | Same doctrine (no infinite waits/retries) |
| `@playwright/test` (existing stack) | `chromium.launch` for dynamic/auth extraction; NO new browser framework |
| `scripts/diagnostics/*` doctor pattern | `research-acquisition-doctor.js`, exit 0, no secrets |
| `scripts/maintenance/*` | `setup-research-env.js` one-command setup |
| `tests/fixtures/` | `research-servers.js` local fixture servers |
| `scripts/run-tests.js` domain auto-discovery | New `tests/research/` runs automatically |
| `platforms/INDEX.md` aliases | Search/acquisition never branches on platform |

## 5. Environment Audit

| Component | Version / Path | Expected | Actual | Result |
|---|---|---|---|---|
| Node | `v24.16.0` | >=18 | v24.16.0 | PASS |
| npm | `11.13.0` | present | 11.13.0 | PASS |
| Python (system) | `C:\...\Python312\python.exe` | >=3.10 | 3.12.10 | PASS |
| pip (system) | `pip` | present | 26.2.1 | PASS |
| venv pip | `research/.venv` | isolated | pip 25.0.1, zero global pollution | PASS |
| Crawl4AI | `research/.venv` | installed+pinned | **0.9.4** (`research/requirements.txt`) | PASS |
| Crawl4AI browser runtime | patchright/Chromium via setup | READY | setup COMPLETE, doctor crawl PASS | PASS |
| Playwright | `@playwright/test` | reusable | 1.63.0, `chromium.launch=function`, chromium-1243 on disk | PASS |
| PyPI network | reachable | yes | `PYPI_STATUS 200` | PASS |

No `.gitignore` existed → created minimal (venv, bytecode, `.crawl4ai/`,
auth-state, node_modules, `.env`). No venv committed.

## 6. Python / Crawl4AI Installation

Dedicated venv `research/.venv` (`python -m venv`, no global pollution, no
admin needed). `pip install crawl4ai` → **0.9.4** (full package list in tool
output; includes `playwright 1.63.0`, `patchright`, `rank-bm25`, `lxml`).
No floating dependency: pinned post-proof (see §8).

## 7. Crawl4AI Version / Setup / Doctor

- Version: **0.9.4** (`crawl4ai.__version__`).
- Setup: `research\.venv\Scripts\crawl4ai-setup.exe` → Patchright install
  COMPLETE, DB init/migration COMPLETE, post-install COMPLETE.
- Doctor: `crawl4ai-doctor` → live crawl `https://crawl4ai.com` ✓ in 3.79s
  (`Crawling test passed`). Setup runs at install time only, never per job.
- API verified current: `result.markdown` with `raw_markdown /
  markdown_with_citations / references_markdown / fit_markdown (+fit_html)`;
  **no `markdown_v2` anywhere** (v0.5-removed; docs confirm `AttributeError`
  if touched). Raw HTML via `raw:` scheme + `base_url`. `BM25ContentFilter`
  + `DefaultMarkdownGenerator(content_filter=...)`. `CacheMode`
  BYPASS/ENABLED/…. `CrawlerRunConfig(check_robots_txt=False)` default —
  robots enforced in Node gate instead (deterministic, testable).

## 8. Dependency Reproducibility

`research/requirements.txt` = single line `crawl4ai==0.9.4` (+ provenance
comment). No `pip freeze` dump, no unrelated packages, venv never committed
(`.gitignore`: `research/.venv/`, `.venv/`).

## 9. SearchProvider Architecture

`lib/research-acquisition/search-provider.js`: `createSearchRequest` /
`searchRequestFromPlan` (query + executor + planRef provenance) →
`normalizeSearchResults` (per-item validate: http(s) URL, provider identity,
valid retrievedAt; bad items rejected with codes, never silently dropped) →
`dedupeSearchResults` (exact + normalized URL: lowercase, default-port,
tracking-param, trailing-slash, fragment handling; keeps lowest searchRank).
No OpenCode/Antigravity private parser: code never shells to agent internals.
No truth/authority/independence fields anywhere in the contract.

## 10. V1 Search Execution Model

Agent-tool search exchange (dependency-injected), implemented and
live-proven: UNFOLDIQ emitted `SearchRequest`
(`requestId srq-muqdolgy-9bb39507`, executor `agent-exchange`, query from a
real Prompt-01 plan question) → agent satisfied it with web-search
capability (8 raw results) → `normalizeSearchResults` → 5 normalized, 0
rejected → dedupe → 5. Proven by execution (§13), not by mocks.

## 11. STANDARD / DEEP Routing

`resolveResearchMode`: STANDARD → `{route: SEARCH_PROVIDER}`; DEEP →
`DEEP_PROVIDER_NOT_IMPLEMENTED_YET` (explicit deferred, Prompt 05 owns GPT
Researcher); unknown → `INVALID_RESEARCH_MODE`. Static assertion: no GPT
module require/call in `lib/research-acquisition/`.

## 12. Search Result Contract

`{query, url, title, snippet, provider, retrievedAt, searchRank?}` —
searchRank preserved as discovery order only. `SEARCH_PROVIDER_UNAVAILABLE`
when no executor (never fake `[]`).

## 13. Search Live Validation

LIVE_PUBLIC (see §43 + evidence files): query
`What official documentation or authoritative reference defines correct
behavior for "Crawl4AI markdown generation result API"?`, executor
`agent-exchange`, 8 raw → 5 normalized (api.crawl4ai.com ×2,
docs.crawl4ai.com ×3), 0 rejected, 0 fabricated.
Evidence: `Report/evidence/research-acquisition/live-search-{request,normalized}.json`.

## 14. Acquisition Router

`acquireUrl`: safety → binary-extension gate → robots.txt → route
(`direct` default; `browser` only when caller-specified for
interaction/auth). JS-heavy alone never forces the browser path (Crawl4AI is
browser-capable: `wait_until`/`wait_for` supported). `acquireBatch`:
concurrency ≤5 (default 2), per-host delay default 1000ms.

## 15. Crawl4AI Node↔Python Bridge

`research/crawl4ai-worker.py` + `lib/research-acquisition/crawl4ai-bridge.js`:
protocol v1 (`version`/`crawl` ops), stdin JSON → stdout single JSON,
stderr diagnostics, exit codes (0/1/2/3). One `AsyncWebCrawler` lifecycle per
batch (N bounded URLs, default max 8). Deterministic extraction only (no LLM
strategy, no screenshots). Timeouts: `pageTimeoutMs` 45000 +
`processTimeoutMs` 180000 defaults; owned child killed on timeout/abort
(signal supported); never unrelated processes. Garbage stdout →
`BRIDGE_PROTOCOL_ERROR`, never a Node crash (tested).

## 16. AcquiredDocument Contract

`{requestedUrl, finalUrl, retrievedAt, success, statusCode, route,
extractionMethod, crawlerVersion, browserAcquired, rawMarkdown (+truncated
flag), fitMarkdown (+truncated flag), fitQuery, title, metadata, links
(capped 200) + linkCount, responseHeaders (capped), contentHash (SHA-256),
errorCode, errorMessage}`. Separate from `NormalizedSearchResult` by
construction. No VERIFIED/TRUSTED/CONFIRMED statuses exist (comment + grep
verified).

## 17. Raw Markdown

Preserved in full (bounded by `maxMarkdownChars` 200000, truncation flagged).
Live: 33,646 chars from `https://api.crawl4ai.com/docs`. Fixture: Vietnamese
UTF-8 byte-identical through the pipeline.

## 18. Fit Markdown

BM25 filter with query derived from the plan question (`fitQuery` preserved
as provenance). Live: fit 4,653 chars from 33,646 (relevant API-docs blocks
kept). Fixture: unrelated paragraph removed, relevant kept. When no filter
applies → `fitMarkdown: null`. Honest limitation recorded: BM25
(`language=english`, stemming) can yield near-empty fit for Vietnamese text
(probed); raw is always preserved as fallback — nothing faked.

## 19. Content Hashing

SHA-256 over normalized `rawMarkdown` (UNFOLDIQ convention reused). Stable:
same content → same hash across runs; changed content → different hash
(tested C7). Used for change detection/dedupe/lineage, never truth.

## 20. URL Safety / SSRF Guard

`lib/research-acquisition/url-safety.js`: scheme allowlist http/https only
(rejects file/data/javascript/ftp/chrome/about + credentials-in-URL);
IP-literal checks incl. IPv4-mapped IPv6 (`::ffff:127.0.0.1`),
loopback/link-local/private/CGNAT/documentation/multicast/reserved v4 +
loopback/unspecified/link-local/unique-local/multicast/documentation/
translation/discard v6; blocked hostnames (`localhost`, `*.local`,
`*.internal`, `*.lan`, `metadata.google.internal`, …) + single-label names;
**DNS resolved and EVERY address checked** (rebinding-aware); DNS failure
fails closed (`DNS_ERROR`). 41 asserts PASS.

## 21. Redirect Safety

Bounded (browser-handled) + `validateRedirectChain` re-checks EVERY hop
(post-crawl final URL re-validated too — defense in depth). Requested vs
final URL both recorded (live: `…/docs` → `…/docs/`). Redirect-to-private
and redirect-to-metadata blocked (tested with mocked DNS + literals).

## 22. robots.txt Policy

Node gate (`checkRobots`, 1h cache): `User-agent: *` (+`unfoldiq`) groups,
Allow/Disallow longest-match. Disallow → stop with `ROBOTS_DISALLOWED`
before any fetch (target never hit — asserted). Unreachable robots.txt →
fail-open (logged). Browser path enforces the same check for public crawling
(`authorizedSession` never bypasses robots). No bypass test written, by design.

## 23. Rate Limit / Retry Policy

Per-host 1000ms politeness, concurrency ≤5. Retryable: `NETWORK_TIMEOUT`,
5xx `HTTP_ERROR`, `RATE_LIMITED`, `WORKER_TIMEOUT` (max 2 retries, exponential
backoff, `Retry-After` honored capped at 30s). Live-shaped fixture: 429×2 →
200 recovered, retries counted. Terminal `RATE_LIMITED` if unresolved.
Policy/non-retryable codes (`UNSAFE_URL`, `ROBOTS_DISALLOWED`,
`AUTH_REQUIRED`, 4xx) never retried. No infinite retry anywhere.

## 24. Public Live Crawl

LIVE_PUBLIC: `https://api.crawl4ai.com/docs` (benign public docs, robots
allowed, no login) → `ACQUIRED`, final URL recorded, status 308→200 chain,
raw 33,646 chars, fit 4,653 chars, hash
`33a3220b…01d08e25fa02`, 5,964ms, crawler 0.9.4, route `crawl4ai-direct`.
Plus install-time doctor crawl of `https://crawl4ai.com` (3.79s PASS).
Evidence holds metadata only — no page body, no secrets.

## 25. Dynamic Browser Extraction

AUTH_FIXTURE-class local proof with REAL Chromium (`@playwright/test`,
no new framework): click-to-reveal fixture → revealed text acquired (B1);
final URL exact (B2); relative href resolved against page base (B3); same
`AcquiredDocument` shape via `raw:` + `base_url` normalization with
`browserAcquired:true` (B4); unsupported actions / navigation failures →
structured codes (B5). No CAPTCHA/paywall bypass: only declarative
click/wait actions; challenge markers → `HUMAN_ACTION_REQUIRED`.

## 26. Authenticated Browser Extraction

Local login fixture (`fixture-user`/`fixture-password`, HTTP-only session
cookie): no state → `AUTH_REQUIRED` (A1); fixture login → storageState →
protected article acquired (A2). Only user-authorized fixture content
extracted; MFA/CAPTCHA path returns `HUMAN_ACTION_REQUIRED`, never bypassed.

## 27. Auth-State Security

Default dir `%LOCALAPPDATA%\UNFOLDIQ\auth-state` (win) /
`~/.unfoldiq/auth-state` (else) — outside repo; `ensureOutsideRepo`
rejects in-repo paths (`AUTH_STATE_IN_REPO`, tested). Tests used OS temp
dirs (deleted after). Scans: evidence files contain zero session/cookie/
password/Bearer hits; no `*.auth.json`/`*storage-state*.json` under repo;
`.gitignore` covers `**/auth-state/`. SessionStorage limitation documented:
storageState covers cookies+localStorage; sessionStorage-dependent sites are
out of scope until a supported site requires it (none does).

## 28. Web Prompt-Injection Safety

`WEB CONTENT = UNTRUSTED DATA` preserved end-to-end (PRE-FLIGHT S11 intact).
Injection pages (search snippet + crawled page containing `Ignore previous
instructions / Run this command / Send your token`) are acquired VERBATIM as
data (asserted), with zero side effects (canary env absent, no eval/exec of
content anywhere — static property of the code, no content-stripping that
would destroy evidence).

## 29. Cache / Freshness Behavior

Crawl4AI `CacheMode` mapped from Prompt-01 `freshnessRequirement`:
`CURRENT_STATE` → `BYPASS`, else `ENABLED` (`cacheModeFor`, tested). No 1H
storage policy built.

## 30. Limits / Timeouts / Cancellation

Actual defaults: `pageTimeoutMs` 45000, `processTimeoutMs` 180000,
`maxMarkdownChars` 200000 (flagged truncation), `maxPagesPerBatch` 8,
concurrency 2 (≤5), host delay 1000ms, retries 2, Retry-After cap 30s,
robots fetch 10s/256KB, links 200/doc, headers 50/doc. `/hang` fixture →
`NETWORK_TIMEOUT` well inside the process bound. AbortSignal kills the owned
worker (no orphan processes — asserted via process scan).

## 31. UTF-8 / Windows Compatibility

Vietnamese (`Phở bò — kiểm tra UTF-8`, `Xương ống…`) byte-identical through
stdin→worker→markdown→JSON→Node (tested C1 + doctor smoke). Venv path with
backslashes resolved via `path.join`; no `python3` assumption (venv exe,
else `UNFOLDIQ_PYTHON`/`python`/`py -3` in setup helper). PowerShell 5.1 used
throughout (no `tail`, `utf8NoBOM`, or `&&` assumptions — two probe scripts
hit and survived exactly these quirks).

## 32. Provider / Acquisition Doctor

`npm run doctor:research` (basic, no network) and `npm run research:verify`
(`--smoke`: local raw-HTML browser normalization, no internet, no paid API).
`npm run research:setup` = venv → pinned install → `crawl4ai-setup` →
doctor (no credentials, no global policy changes, admin needs reported not
silenced). Doctor output verified live (§5 table + smoke hash
`857d9735…`).

## 33. Search-to-Acquisition E2E Smoke

LIVE_PUBLIC, benign technical query, no quality/claim verdicts:
Plan (`live-smoke-1`, Prompt-01 `planResearch` real output) → SearchRequest
→ agent web search (8 raw) → 5 normalized → pick `api.crawl4ai.com/docs` →
safety (real DNS) → robots allowed → Crawl4AI (fitQuery = plan question) →
AcquiredDocument. Evidence: `Report/evidence/research-acquisition/*.json`
(3 files, metadata only).

## 34. Tests Added

New domain `tests/research/` (auto-run by `scripts/run-tests.js` + `npm run
test:research`): `test-search-provider.js` (S1–S7, 23 asserts),
`test-research-modes.js` (M1–M3, 4), `test-url-safety.js` (§57 matrix, 41),
`test-crawl4ai-bridge.js` (C1–C7, 25), `test-robots-ratelimit.js` (robots/
429/redirect/production-defaults/freshness, 15),
`test-browser-extract.js` (B1–B6 incl. injection-as-data, 16),
`test-auth-extract.js` (A1–A5, 13). Fixture helper:
`tests/fixtures/research-servers.js` (article/redirect/robots/429/hang +
login/protected). Total new: **137 asserts**.

## 35. Bugs Found

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Robots tests failed (fail-open) | `checkRobots` built robots URL from `hostname`, dropping the port | Use `u.host` (verified: disallow now blocks pre-fetch) |
| 2 | S4 dedupe failed | Fragment kept (`u.hash` never cleared) + trailing-slash mismatch | Clear hash; strip trailing `/` for paths >1 char |
| 3 | `/flaky` recovery came back empty | Crawl4AI anti-bot rejects near-empty 200 bodies (80 bytes) | Fixture serves realistic-length page (library behavior kept) |
| 4 | Raw-HTML worker failed | Crawl4AI requires `raw:` scheme prefix | Worker prefixes `raw:`; `base_url` honored (links prove it) |
| 5 | C7 hash "unchanged" | Test appended `<p>` after `</html>` (parser dropped it) | Test inserts inside `<article>` (test-only fix) |
| 6 | M3 static assertion matched deferral message | Regex too broad | Assert real integration patterns only (require/call) |

Plus two probe-script mistakes (PowerShell pipe BOM, inline-quote escaping) —
diagnosed via LOG-FIRST, moved probes to files, no source impact.

## 36. LOG-FIRST Fix Iterations

Each failure: test/worker output → exact stage (robots URL got port 80;
normalizer kept `#frag`; anti-bot message named byte count; worker stderr
named the `raw:` scheme) → minimal fix → targeted rerun → full domain rerun.
No broad rewrites; no selector/config guessing. Browser failures: none
(first-run PASS after fixture shaped per §35-3 learning).

## 37. Commands Executed

```text
python -m venv research\.venv
research\.venv\Scripts\python.exe -m pip install crawl4ai        -> 0.9.4
research\.venv\Scripts\crawl4ai-setup.exe                        -> COMPLETE
research\.venv\Scripts\crawl4ai-doctor.exe                       -> crawl PASS 3.79s
node scripts/diagnostics/research-acquisition-doctor.js --smoke  -> READY + smoke hash
node tests/research/test-*.js (7 suites)                         -> ALL PASS
node tests/pipeline/test-content-class-router.js                 -> 34/34
node tests/pipeline/test-research-planning.js                    -> 70/70
node tests/pipeline/test-v5-preflight.js                         -> 47/47
node tests/pipeline/test-editorial-quality.js                    -> 37/37
node tests/pipeline/test-context-routing.js                      -> 34/34
node scripts/checks/validate-schemas.js                          -> ALL PASS
node scripts/checks/repository-structure-check.js                 -> OK
node scripts/run-tests.js research                               -> 0 failed, 46.1s
node scripts/run-tests.js (full)                                -> 0 failed, 147.1s
live-smoke.js request/normalize/acquire                          -> LIVE E2E PASS
```

## 38. Targeted Test Results

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-search-provider.js` | PASS | 23/23 (S1–S7 + plan query) | PASS |
| `test-research-modes.js` | PASS | 4/4 (M1–M3) | PASS |
| `test-url-safety.js` | PASS | 41/41 (§57 matrix) | PASS |
| `test-crawl4ai-bridge.js` | PASS | 25/25 (C1–C7) | PASS |
| `test-robots-ratelimit.js` | PASS | 15/15 | PASS |
| `test-browser-extract.js` | PASS | 16/16 (B1–B6, real Chromium) | PASS |
| `test-auth-extract.js` | PASS | 13/13 (A1–A5, real login flow) | PASS |

## 39. Prompt 01 Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-content-class-router.js` | PASS | 34/34 | PASS |
| `test-research-planning.js` | PASS | 70/70 | PASS |

Prompt 01 files untouched; FACTUAL/FICTION/HYBRID, gates, and plans unchanged.

## 40. V5 PRE-FLIGHT Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-v5-preflight.js` | PASS | 47/47 | PASS |
| `test-editorial-quality.js` | PASS | 37/37 | PASS |
| `test-context-routing.js` | PASS | 34/34 (no new context deps added) | PASS |
| `validate-schemas.js` | PASS | all schemas + semantics (no schema changed) | PASS |
| `repository-structure-check.js` | PASS | `REPOSITORY_STRUCTURE_OK` | PASS |

## 41. Full Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `node scripts/run-tests.js` | 0 failed | 0 failed, 9 domains, 147.1s (incl. new `research`) | PASS |

## 42. Browser Validation
- PASS (real browser, not mocks): `crawl4ai-doctor` live crawl; live
  public crawl; 6 dynamic-extraction tests + 5 auth tests on REAL Chromium
  (`@playwright/test`, headless) against local fixtures — interaction,
  final-URL, base-URL, shared normalization, structured errors, auth
  deny/allow all executed. No Playwright MCP / extra framework added.

## 43. Live vs Fixture Evidence Classification

| Item | Class | Proof |
|---|---|---|
| web search (8 raw → 5 normalized) | LIVE_PUBLIC | `live-search-{request,normalized}.json`, agent websearch session |
| public crawl + fit markdown | LIVE_PUBLIC | `live-acquire-evidence.json` (hash `33a3220b…`, 5964ms) |
| doctor crawl `crawl4ai.com` | LIVE_PUBLIC | doctor output, 3.79s |
| click-reveal / login / 429 / robots / hang | AUTH_FIXTURE / FIXTURE_INTEGRATION | local `127.0.0.1` servers, real browsers |
| S/M/C-url-safety/robots-parse/dedupe | UNIT | injected DNS/fetchers, no sockets |

Nothing local is labeled LIVE; no mock is labeled REAL CRAWL.

## 44. Files Created

| File | Why |
|---|---|
| `research/crawl4ai-worker.py` | 1G.1E Python worker (protocol v1, one crawler lifecycle) |
| `research/requirements.txt` | Pinned `crawl4ai==0.9.4` |
| `lib/research-acquisition/search-provider.js` | 1G.1D exchange + contracts + STANDARD/DEEP |
| `lib/research-acquisition/url-safety.js` | SSRF gate + redirect re-validation |
| `lib/research-acquisition/crawl4ai-bridge.js` | Spawn/protocol/timeouts + AcquiredDocument |
| `lib/research-acquisition/acquisition.js` | Router, robots, retry/politeness, browser/auth path, freshness |
| `scripts/maintenance/setup-research-env.js` | One-command env setup |
| `scripts/diagnostics/research-acquisition-doctor.js` | Doctor + `--smoke` verify |
| `tests/research/test-search-provider.js` | S1–S7 |
| `tests/research/test-research-modes.js` | M1–M3 |
| `tests/research/test-url-safety.js` | §57 matrix |
| `tests/research/test-crawl4ai-bridge.js` | C1–C7 |
| `tests/research/test-robots-ratelimit.js` | Robots/429/redirect/defaults |
| `tests/research/test-browser-extract.js` | B1–B6 |
| `tests/research/test-auth-extract.js` | A1–A5 |
| `tests/fixtures/research-servers.js` | Local fixture servers |
| `.gitignore` | Ignore policy (venv, bytecode, caches, auth-state) |
| `Report/evidence/research-acquisition/*.json` (3) | Sanitized live evidence |
| `Report/PHASE_1G1_02_RESEARCH_ACQUISITION_LAYER_REPORT.md` | This report |

## 45. Files Modified

| File | Change | Why | Tests |
|---|---|---|---|
| `package.json` | `+test:research`, `+doctor:research`, `+research:setup`, `+research:verify` | One-command conventions | doctor/verify executed |
| `core/WORKFLOW.md` | +1 acquisition-runtime pointer line in 3B | Discoverability, no rule duplication | context-routing PASS |

## 46. Files Deleted

None.

## 47. Secrets / Auth-State Audit

- Evidence files: `Select-String` for session/cookie/Bearer/password → **zero hits**.
- Repo tree: no `*.auth.json` / `*storage-state*.json` (scan clean).
- Fixture creds (`fixture-user`, `fixture-session-abc123`) exist ONLY in
  `tests/fixtures/research-servers.js` — committed per §54 (clearly
  fixture-only, non-real, non-reusable).
- Auth-state default `%LOCALAPPDATA%\UNFOLDIQ\auth-state` ensured outside
  repo; test states under OS temp, deleted post-run.
- No secrets in logs (summaries carry host/route/hash/length only), no
  secrets in this report (live evidence is metadata-only).

## 48. Scope Check

- No SearchProvider paid service; tests need no paid API (live steps are
  manual, agent-capability + public docs).
- Prompt-03 grep over new modules: no Source Registry persistence, no
  quality/independence scoring, no ledger, no verification, no sufficiency,
  no Pack, no Evidence Gate, no GPT Researcher (only the required DEEP
  deferral string), no Flow/Veo/publish/analytics.
- No `markdown_v2`, no LLM extraction, no second HTML→Markdown library
  (raw HTML uses Crawl4AI's supported `raw:` + `base_url`).
- No `1G.1D+` beyond acquisition, no 1G.2+ work.
- Prompt 01 behavior byte-identical (regression §39).

## 49. Remaining Issues

None blocking. Known honest ceilings: (1) BM25 fit can be near-empty for
Vietnamese queries (raw always preserved); (2) sessionStorage-only auth
sites unsupported until a real site requires it; (3) robots fail-open when
its fetch fails (logged); (4) doctor `--smoke` launches a browser (~5s).

## 50. Next Allowed Step

```text
PHASE 1G.1 — PROMPT 03
EVIDENCE + RESEARCH SUFFICIENCY ENGINE
(1G.1G Source Registry, 1G.1H Quality+Independence, 1G.1I Claim/Evidence
Ledger, 1G.1J Cross-source Verification, 1G.1K Contradictions/Unknowns,
1G.1L Sufficiency Gate)
```
Not started in this task.

## 51. Final Conclusion

```text
TASK_VALIDATION = PASS
SearchProvider real path + Crawl4AI 0.9.4 local integration + safe public
live crawl + dynamic browser fixture + authenticated fixture + security
gates + Prompt 01 + V5 + full regression + no secret leakage: ALL PASS.
```

---

## Appendix A — Acquisition Behavior Matrix

| Case | Route | Expected | Actual | Evidence | Result |
|---|---|---|---|---|---|
| real search | agent-exchange | 5 normalized, 0 fabricated | 8 raw → 5/0/5 | live-search-normalized.json | PASS |
| public crawl | crawl4ai-direct | ACQUIRED + fit | raw 33646, fit 4653, hash `33a3220b…` | live-acquire-evidence.json | PASS |
| fit-markdown crawl | BM25 from plan question | relevant, query-tagged | fit keeps API blocks, drops noise | C2 + live evidence | PASS |
| JS interaction fixture | browser-captured-html | revealed text acquired | `REVEALED_SECRET_TEXT` present | B1 | PASS |
| auth denied fixture | browser | AUTH_REQUIRED | denied without state | A1 | PASS |
| auth success fixture | browser+state | article acquired, no leak | `Members article`, secrets absent | A2–A5 | PASS |
| unsafe localhost (prod) | gate | PRIVATE_HOST | blocked, no bypass | url-safety + acquisition test | PASS |
| public→private redirect | gate | blocked | PRIVATE_HOST on hop | redirect-chain tests | PASS |
| robots denied | gate | ROBOTS_DISALLOWED pre-fetch | target never hit | robots tests | PASS |
| 429 bounded retry | router | recover, counted retries | 429×2 → 200, retries ≥2 | ratelimit test | PASS |
| prompt injection page | all | data preserved, nothing executed | verbatim + canary absent | S7 + B6 | PASS |
| UTF-8 Vietnamese page | all | byte-identical | `Xương ống…` exact | C1 + doctor smoke | PASS |

## Appendix B — Test Matrix

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-search-provider.js` | PASS | 23/23 | PASS |
| `test-research-modes.js` | PASS | 4/4 | PASS |
| `test-url-safety.js` | PASS | 41/41 | PASS |
| `test-crawl4ai-bridge.js` | PASS | 25/25 | PASS |
| `test-robots-ratelimit.js` | PASS | 15/15 | PASS |
| `test-browser-extract.js` | PASS | 16/16 | PASS |
| `test-auth-extract.js` | PASS | 13/13 | PASS |
| Prompt-01 ×2 + V5 ×3 + schemas + structure | PASS | 34+70+47+37+34 asserts | PASS |
| `run-tests.js research` | 0 failed | 0 failed, 46.1s | PASS |
| `run-tests.js` full | 0 failed | 0 failed, 147.1s | PASS |
| `doctor:research` / `research:verify` | READY | READY 0.9.4 + smoke hash | PASS |

## Appendix C — Live Evidence (metadata only)

```text
query:    What official documentation or authoritative reference defines correct
          behavior for "Crawl4AI markdown generation result API"?
provider: agent-exchange (agent web-search capability; 8 raw results)
picked:   https://api.crawl4ai.com/docs
host:     api.crawl4ai.com | route: crawl4ai-direct | status: ACQUIRED (308→final …/docs/)
raw:      33646 chars | fit: 4653 chars (fitQuery = plan question)
hash:     33a3220b6977e1eecfca1b335d1ff57e372649d2e3e69a44919a01d08e25fa02
crawler:  0.9.4 | elapsed: 5964ms | retries: 0
```
