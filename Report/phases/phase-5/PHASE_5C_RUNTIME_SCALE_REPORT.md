# PHASE 5C — RUNTIME / SCALE — FINAL REPORT

**Package:** Phase 5C completion pass — Browser & Provider Reuse (5.4) + Controlled Concurrency / Backpressure (5.5) + Long-form Strategy (5.6)
**Date:** 08/10/2026
**Spec:** `UNFOLDIQ_PHASE_5C_COMPLETION_PASS.md` (continuation — NOT Phase 5D)
**Supersedes:** partial `PHASE_5C_RUNTIME_SCALE_REPORT.md` (05C = PARTIAL verdict retired by this file)
**Verdict:** **PHASE_5C = COMPLETE; PHASE_5 = COMPLETE; PHASE_6A_READY = YES** (see §27)

---

## 1. Entry gate

5B verdict (`PHASE_5B_INCREMENTAL_COMPUTE_REPORT.md` §35): `PHASE_5B = COMPLETE · PHASE_5C_READY = YES`, P0 = 0. Partial-5C foundation re-verified before new work (§2 of completion pass): runtime 5/5 suites, hygiene OK, render doctor READY — no regressions to fix first.

## 2. Partial-report carry-forward

Completed before this pass and kept intact (no rewrites, §1 preserve rule): `lib/browser-pool`, `lib/provider-session`, `lib/resource-budget`, `lib/scheduler` (34 unit checks), incremental-reuse wiring, orchestrator budget gate, 5C-04 small-scale evidence. One correction from this pass: the 5B "~100s browser startup" attribution is refuted by pilot-scale measurement (see §4, GAP-038) — pool direction kept, bottleneck story fixed.

## 3. Fresh Market Gap Review

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 3.1 | Remotion `openBrowser()` reuse across renders | KEEP pool direction; prove at pilot scale | `lib/browser-pool`, §4 |
| 3.2 | Playwright persistent profile = single owner | KEEP exclusive profile lease; orchestration obeys it | `lib/provider-session`, §13 |
| 3.3 | Chrome MV3 SW non-persistent lifecycle | MEASURE terminate→wake→restore; no keepalive | §11 |
| 3.4 | Remotion Lambda vs Node server vs Cloud Run | Benchmark/model first; V1 from evidence; no auto-migration | §18 |

References: remotion.dev/docs (API, compare-ssr fetched 2026-10-08), playwright.dev (browserType), chrome.com (SW lifecycle).

## 4. Pilot-scale browser reuse (Task A — MEASURED)

`tests/incremental/test-pilot-reuse-5c.js` **6/6**: same 150s/4500f pilot, same 5 ranges, BASELINE (reuse=0) vs CANDIDATE (pool). Self-sufficient fixture (rebuilds pilot docs/assets deterministically — repair-b cleanup deletes the project), per-range resume, evidence `Report/evidence/perf-5c/pilot-reuse-benchmark.json`:

```text
baseline 5-range wall ........ 680s (5 browser starts, by construction)
candidate 5-range wall ....... 674s (1 browser start, 4 reuses)
starts 5 → 1 ................. PROVEN
startup avoided .............. 404ms (browser open = 95–108ms/start)
chunks byte-identical ........ PROVEN (all 5 ranges)
equivalence vs ref-v1 ........ structural PASS (range-aware conform both sides, 5B §25)
leak ......................... 0 live browsers after shutdown; 5 jobs/1 browser retired by policy
wall improvement ............. NOT PROVEN (tie within noise; startup is immaterial)
```

Correction recorded as GAP-038: browser open is ~0.1s, not ~100s — range-wall variance (68–200s) is machine/render noise.

## 5. Browser pool health/leak evidence

8/8 unit (compat, reuse, incompatibility, exhaustion, crash, memory, TTL/max-jobs, lease-error) + pilot proof (§4): 1 browser served 5 jobs, policy retirement, shutdown-empty. No immortal browsers, no cross-environment reuse, crash-safe.

## 6. ProviderSession production integration (Task I)

Contract 7/7 unit unchanged. Production behavior proven from live traces (see §13): single-owner session throughout, warm SESSION_REVALIDATED restore, synthetic submit REFUSED (no bypass), restart reconciled without resubmitting. Residual (explicit): live double-lease and live stale-auth paths not exercised (session risk) — unit-proven only.

## 7. Scheduler production integration (Tasks B/C/D)

No second scheduler. Every `renderOp` attempt now flows `enqueue → budget admit → RUNNING → COMPLETED/FAILED/CANCELLED → release` through `lib/scheduler` (`pipeline/render-orchestrator.js` queue section): idempotencyKey per attempt (concurrent duplicates blocked, explicit retries never blocked), `render/scheduler-queue.json` persistence, stale-reconcile-never-resubmit on open, 30-min watchdog, cancel-token linkage into the live render. `tests/runtime/test-orchestrator-queue.js` **6/6** (happy path, failure preservation, running-cancel, duplicate=1 execution, restart reconcile, §6 vocabulary). e2e render path green through the queue.

## 8. Backpressure/resource budgets (Task C)

Per-resource admission (render/extension/provider/memory/credit/queue) unit-proven 8/8; production render path enforces RENDER_CONCURRENT (entry gate, default cap 2, `UNFOLDIQ_MAX_CONCURRENT_RENDERS`) + queue bounds (50) + watchdog. §6 vocabulary mapped (`queueWaitState`: QUEUED/WAITING_MEMORY/WAITING_EXTENSION/WAITING_PROVIDER/WAITING_CREDIT/RATE_LIMITED/WAITING_CAPACITY — 6/6 test). Honest scope: memory/credit admission on the render path applies only to items declaring those resources (attempts declare RENDER_CONCURRENT); full multi-resource pressure proven at lib level.

## 9. Cancellation/restart/reconcile (Task D)

Integration-proven 6/6: failure error preserved for the retry loop, running-cancel aborts + releases the slot, queued/stale items reconcile on restart (never resubmitted), dedupe keys survive restart. Uncertain expensive work reconciles first (live proof: 09-01 resume adopted already-counted results without resubmitting). **DUPLICATE_EXPENSIVE_ACTION = 0** (concurrent duplicate submission executes exactly once).

## 10. Concurrency matrix (Task E — MEASURED)

`tests/perf/test-concurrency-matrix-5c.js` **5/5**, 120-frame fixture, 2 reps each (p50/p95 N/A at n=2 — reported best, no fabricated percentiles):

```text
c=1: 11.7s · c=2: 7.0s · c=4: 4.8s — zero crashes, all 6 outputs byte-identical
```

Default selected: **c=4** (fastest zero-crash; NOT max-by-default — 8 stays the hard ceiling; pilot-scale re-check open). Evidence: `concurrency-matrix.json`.

## 11. MV3 live lifecycle (Task F — GAP-031 FIXED)

`tests/e2e/mv3-lifecycle.spec.js` (N,O,P) in real Chromium, real unpacked extension, no mocks: cold wake 4–255ms (fresh profile), warm storage round-trip 1–10ms, terminate (process-exit on persistent profile) → wake 375–408ms → storage restore OK, no keepalive added. Environment limit honestly labeled: natural ~30s idle termination unobservable under Playwright (CDP attachment keeps the worker alive). Evidence: `mv3-lifecycle.json`.

## 12. Cross-boundary trace (Task G — GAP-030 FIXED)

Real end-to-end causal chain (spec Q): Core span → sidepanel-origin APPROVE_RECORD → genuine SW span (APPROVAL_RECORDED, joined via `traceId/parentSpanId` passthrough) → bridge `/trace` ingest → `reconstructTrace` = one complete ordered chain (core→extension→bridge, 660/1/14ms boundary latencies). Two fixes resulted: `trace-contract.js` was missing from the extension build (spans never shipped — GAP-037) and the SW span needed causal passthrough fields. No OTel rewrite. Evidence: `trace-chain.json`.

## 13. Provider baseline (Task H — GAP-029 FIXED, historical-sample grade)

RECORDED from existing real traces — zero new credits (evidence priority 1): live session FLOW-COMPANION-LIVE-GEN-01 (2026-10-01, Nano Banana 2, image 1:1): warm restore ~9ms, provider wait **5023ms (n=1 — not a distribution)**, human waits separated (deliberation 33s, gesture 289s excluded), cost UNKNOWN (never zero-filled). Repeat trigger: n≥5 + credit readout on authorized sample. Evidence: `provider-baseline.json`.

## 14. Long-form fixture (Task J)

Deterministic mixed fixture (video scenes + stills + grid-diagram stand-ins + sine voice stubs + caption docs + audio-mix): `tests/perf/test-longform-5c.js`, resumable per duration under `out/longform-5c/`. Representative by construction; lavfi-synthetic (no provider assets) — stated, not hidden.

## 15. 10/20/30-min evidence (Task K — MEASURED/MODELED)

1080p30, c=4, this host (i5-11400H, 16GB):

```text
150s: 214s (5B reference) · 600s: 1216s, 14.8fps, RSS 398MB, 176MB out
1200s: 2198s, 16.4fps, RSS 449MB, 313MB out
1800s: ~3200s ESTIMATED (validated 1.43–2.03x scaling band; honest estimate, not measurement)
```

CPU-bound (~15fps); memory never the constraint. Evidence: `longform-benchmark.json`.

## 16. Server candidate (Task L)

Viable but unjustified: bundle-once + queue + retry already realized locally; same single-machine ceiling; only availability would improve. Ops (service mgmt, auth, job API) for no measured gain. Evidence: `server-candidate.json`. No deployment.

## 17. Distributed/cloud candidate (Task M)

Lambda evaluated from official constraints (compare-ssr, 2026-10-08): distributed = fastest claim but UNMEASURED for our workload; AV1 unavailable; CPU-only; S3 transfer per render; new AWS credential surface; footage leaves machine. NOT selected. No deployment. Evidence: `distributed-candidate.json`.

## 18. RenderStrategyDecision (Task N)

`render-strategy-decision.json` v1.0.0: **V1_RENDER_STRATEGY = LOCAL** (fully measured) with 4 evidence-driven migration triggers (SLO breach ×2, sustained queue block with scheduler evidence, metered Lambda pilot >2x win, 24/7 requirement → server-first). Explicit non-reasons recorded (no "cloud is more scalable", no startup-removal rationale).

## 19. GAP-014 benchmark (Task O — DEFERRED_WITH_EVIDENCE)

No motion-blur feature exists to benchmark (sole blur = static CSS background-fill, `ImageLayer.tsx:102`). OFF default preserved; revisit trigger registered (120-frame fixture protocol). Evidence: `gap-014-motion-blur.json`.

## 20. PerformanceBudgetProfile v2 (Task P)

`performance-budget-profile-v2.json` (12 budgets, each with baseline/source/warning/limit/rationale/environment). 5A profile untouched (historical baseline preserved). New: browser startup 95–108ms, starts/range, long-form wall ratio 1.8x target, c=4 default, RSS bands, queue invariant 0, MV3 cold/warm bands (wide, n=2), trace action band, provider wait recorded-but-unbudgeted (n=1).

## 21. Cases A–AO

| Case | Verdict | Proof |
|---|---|---|
| C pilot repair + reused browser | PASS | §4, 6/6 |
| N/O/P MV3 | PASS | §11, live |
| Q trace chain | PASS | §12, live |
| R bounded queue | PASS | §7/8, 6/6 |
| S priority/fairness | PASS (unit) | scheduler 9/9 |
| T dependency dispatch | PASS (unit; single-flight prod) | scheduler 9/9 |
| U concurrency matrix | PASS | §10 |
| V/W memory backpressure | PASS (unit; render path declares RENDER_CONCURRENT) | budget 8/8 |
| X/Y provider/extension concurrency | PASS (unit; no live paid path) | budget 8/8 |
| Z rate-limit logic | PASS (unit states) | scheduler 9/9 |
| AA/AB cancellation | PASS | §9, 6/6 |
| AC restart | PASS | §9, 6/6 |
| AD uncertain reconcile | PASS (unit + live resume) | §9/13 |
| AE duplicate = 1 execution | PASS, count 0 | §9, 6/6 |
| AF/AG 10/20-min | PASS measured | §15 |
| AH 30-min | ESTIMATED (honest) | §15 |
| AI/AJ/AK strategy | PASS | §16–18 |
| AM motion blur | DEFERRED_WITH_EVIDENCE | §19 |
| AN leak cycles | PASS | §5 + queue slots |
| AO regression | PASS | §22 |
| A/B/D–M remainder | REFERENCED (contracts unchanged since partial umbrella) | runtime 37 checks |

Provider-live cases use the cost exception only where stated (X/Y live paths); no zero-cost claims.

## 22. Full regression (AO)

```text
runtime ..... 0 failed (6 suites, 43 checks: 8+5+6+7+8+9)
pipeline .... 0 failed (17 suites, incl. step13 e2e through queue path)
incremental . 0 failed (7 suites, incl. pilot-reuse-5c 6/6)
perf ........ 0 failed (3 suites: 5a 18 + matrix 5 + longform 2)
remotion .... 0 failed (all suites)
e2e ......... 5 passed (flow-companion panel + mv3 N/O/P/Q)
extension ... 533 passed, 0 failed
hygiene ..... REPOSITORY_STRUCTURE_OK
```

## 23. Market Gap Registry update (Task Q)

`docs/roadmap/MARKET_GAP_REGISTRY.md`: GAP-014 → DEFERRED_WITH_EVIDENCE; GAP-029/030/031 → FIXED; new GAP-037 (build exclusion, found+fixed), GAP-038 (attribution correction), GAP-039 (production queue), GAP-040 (session safety), GAP-041 (long-form strategy). **Counts: 41 gaps — FIXED 33 · PARTIALLY_FIXED 0 · PLANNED 2 · DEFERRED 3 · REJECTED 2 · OPEN 1 (003 live-gated). P0 = 0; Phase-6-blocking P1 = 0.**

## 24. Phase 5C Quality Gate

```text
Browser reuse
[x] pilot-scale 150s reuse benchmark · [x] starts 5→1 · [x] repair wall recorded (tie=evidence)
[x] equivalence PASS · [x] retirement bounds growth
Scheduler production integration
[x] real orchestration path · [x] bounded · [x] admission · [x] per-resource concurrency
[x] memory backpressure (unit+path scope) · [x] credit/rate-limit (unit) · [x] cancel · [x] restore
[x] reconcile-before-retry · [x] duplicate = 0
MV3 / trace
[x] cold wake measured · [x] warm measured · [x] terminate→wake (variant labeled)
[x] no keepalive · [x] chain complete · [x] GAP-030/031 honestly updated
Provider reuse
[x] session architecture safe · [x] double lease impossible (unit) · [x] stale/drift/revoke/reset handled
[x] baseline recorded (historical grade) · [x] no unsupported performance claim
Long-form
[x] fixture · [x] 10-min · [x] 20-min · [x] 30-min estimated · [x] LOCAL/SERVER/DISTRIBUTED
[x] V1 selected · [x] triggers explicit · [x] no unjustified deployment
Performance / gaps
[x] GAP-014 with evidence · [x] Budget v2 · [x] 5A preserved · [x] registry updated
Completion
[x] A–AO complete/honest · [x] P0=0 · [x] regression PASS · [x] hygiene PASS
[x] final report persisted · [x] gates below PASS
```

## 25. Phase 5 Major Gate

```text
E2E bottleneck map ................ READY (5A, corrected by GAP-038)
PerformanceBudgetProfile .......... READY + v2 (5A preserved)
Incremental Render ................ PROVEN (5B + §4)
Cache correctness ................. PROVEN (5B)
Partial QA ........................ PROVEN (5B)
Stale cache/QA protection ......... PROVEN (5B)
Local work amplification .......... IMPROVED (5B, ratio 0.2)
Renderer browser reuse ............ PROVEN at representative scale (starts, identity, no-leak)
Browser/session resources ......... BOUNDED (pool policy + budget gate)
Production scheduler .............. INTEGRATED (§7)
Backpressure ...................... PROVEN (unit + path scope, §8)
Per-resource concurrency .......... CONTROLLED (gate + queue + matrix default)
Duplicate expensive action ........ 0 (§9)
MV3 live lifecycle ................ PROVEN (variant labeled, §11)
Cross-boundary causal trace ....... PROVEN (§12)
Provider baseline ................. RECORDED (historical grade, §13)
Long-form strategy ................ READY, V1=LOCAL (§18)
Cloud migration triggers .......... EVIDENCE-DRIVEN (§18)
P0 ................................ 0
Phase-6-blocking P1 ............... 0
Full regression ................... PASS (§22)
Hygiene ........................... PASS (§22)
```

## 26. Honest limitations

```text
1. Reuse wall saving ~0.4s at pilot scale (browser open ~0.1s); the 5B ~100s
   attribution is corrected, not hidden (GAP-038).
2. 30-min long-form is estimated (1.43–2.03x band), not measured.
3. MV3 natural idle-timeout path unobservable under Playwright/CDP; termination
   variant is process-exit (labeled in evidence).
4. Provider baseline is one historical sample (n=1); no budget set from it.
5. Live double-lease / live stale-auth not exercised (session risk); unit-only.
6. Memory/credit admission on the render path covers declared resources only;
   full multi-resource pressure proven at lib level.
7. Concurrency default c=4 selected at small scale; pilot-scale re-check open.
8. Scheduler watchdog 30min; queue file is per-project (no global queue yet).
9. Fail-open: scheduler/budget libs absent → legacy direct path (guarded).
```

## 27. Final verdict

```text
PHASE_5C_FUNCTIONAL                    = PASS
PHASE_5C_QUALITY_GATE                  = PASS

RENDERER_BROWSER_REUSE                 = PROVEN
LOCAL_REPAIR_BROWSER_STARTUP_REDUCTION = PROVEN (starts 5→1; wall tie recorded, not hidden)
BROWSER_RESOURCE_BOUNDED               = PROVEN

PROVIDER_SESSION_ARCHITECTURE          = READY
REAL_PROVIDER_REUSE                    = RECORDED (historical-sample grade, zero new credits)

MV3_LIVE_LIFECYCLE                     = PROVEN (process-exit variant; idle-timeout CDP-limited, labeled)
TRACE_CAUSALITY_END_TO_END             = PROVEN

RESOURCE_BUDGET_PROFILE                = READY
BOUNDED_SCHEDULER                      = READY
SCHEDULER_PRODUCTION_INTEGRATION       = PROVEN
BACKPRESSURE                           = PROVEN (unit + declared-resource path scope)
CONCURRENCY_CONTROL                    = PROVEN
DUPLICATE_EXPENSIVE_ACTION             = 0

LONG_FORM_BENCHMARK                    = READY (10/20 measured, 30 estimated)
RENDER_STRATEGY_DECISION               = READY
V1_RENDER_STRATEGY                     = LOCAL

GAP_014                                = DEFERRED_WITH_EVIDENCE
GAP_029                                = FIXED
GAP_030                                = FIXED
GAP_031                                = FIXED

PERFORMANCE_BUDGET_PROFILE_V2          = READY
MARKET_GAP_REGISTRY                    = UPDATED (41 gaps, FIXED 33, P0=0)

P0                                     = 0
P1_CRITICAL                            = 0 (Phase-6-blocking: 0)

FULL_REGRESSION                        = PASS
HYGIENE                                = PASS

PHASE_5C                               = COMPLETE
PHASE_5                                = COMPLETE
PHASE_6A_READY                         = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md`, `AGENTS.md` | REQUIRED (router) | LOADED | Routing + standing rules |
| Completion pass doc | REQUIRED (task) | LOADED | §§0–26 execution order |
| Partial 5C report | REQUIRED (preserve) | LOADED + SUPERSEDED | Carry-forward + correction |
| 5A/5B reports + perf-5a/5b evidence | REQUIRED (gates) | LOADED | Entry + reference walls |
| `lib/browser-pool`, `provider-session`, `resource-budget`, `scheduler` | REQUIRED (subject) | LOADED + INTEGRATED | No rewrites |
| `pipeline/render-orchestrator.js`, `incremental-render.js`, `pipeline-cli.js` (read) | REQUIRED (integration) | LOADED | Queue + gate paths |
| `flow-companion/extension`, `bridge` | REQUIRED (F/G/H) | LOADED + FIXED | Build fix, trace passthrough |
| `providers/CONFIG.yaml`, `cost-policy.js` | REQUIRED (H) | LOADED | No-paid-credit rule |
| `post-v1f-real-execution/` traces | REQUIRED (H priority 1) | LOADED | Historical baseline |
| remotion.dev compare-ssr | REQUIRED (§3) | FETCHED 2026-10-08 | Cloud evaluation |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (Q) | LOADED + UPDATED | 41 gaps |
| `Report/evidence/perf-5c/` (12 artifacts) | REQUIRED (proof) | WRITTEN | All Tasks |
