# PHASE 5A — SYSTEM PROFILING / PERFORMANCE BUDGETS — REPORT

**Package:** Phase 5A — E2E Bottleneck Map + Core/Agent + Extension + Integration Efficiency
**Date:** 2026-10-07
**Spec:** Phase 5A execution package (`UNFOLDIQ_PHASE_5A_SYSTEM_PROFILING_PERFORMANCE_BUDGETS.md`)
**Verdict:** **PHASE_5A = COMPLETE; PHASE_5B_READY = YES** (see §36)

---

## 1. Entry gate

Phase 4B evidence verified in `Report/phases/phase-4/PHASE_4B_PILOT_FINAL_QA_RENDER_QC_REPORT.md` (§36):

```text
PHASE_4B_FUNCTIONAL / QUALITY_GATE = PASS · RENDERER_INTEGRATION = READY
FINAL_VIDEO = READY · ENCODED_COLOR/SAFE/FLASH_QC = PASS
ENCODED_AV_SYNC / CAPTION_FINAL_QC / AV_SEMANTIC / CONTENT_QA / PACKAGING = PASS
PILOT_TIME/COST/HUMAN_BASELINE = RECORDED · TRACE_CORRELATION = PROVEN
P0 = 0 · P1_CRITICAL = 0 · FULL_REGRESSION = PASS · HYGIENE = PASS
PHASE_4B = COMPLETE · PHASE_4 = COMPLETE · PHASE_5A_READY = YES
```

Planning inputs read before scope freeze: latest Roadmap docs, `MARKET_GAP_REGISTRY.md` (27 gaps), 4B report + `Report/evidence/pilot-4b/` (probe/qc/baseline/intent), `lib/telemetry`, Core acquisition/evidence libs, Extension MV3 service worker + adapter + bridge server, `providers/CONFIG.yaml` (allowPaidCloud=false), render/QC libs, Node v24.16.0 runtime. `npm run render:doctor` → **READY** (no SAC block; no security toggles touched).

## 2. Phase 4 baseline review

Pilot starting point (§3 of spec): 150s video, render 232s @~19fps, 50.9MB output, local TTS ~70s wall, QC ~60–90s, 0 failures/retries/rerenders/interventions, 0 paid spend. **Limitation honored:** pilot visuals were synthetic lavfi stand-ins → render spans tagged `MEASURED_SYNTHETIC`; provider wait/cost tagged `NOT_MEASURED`, never zero.

## 3. Fresh Market Gap Review (07/10/2026)

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 4.1 | Chrome MV3 lifecycle (~30s timer, no indefinite keepalive) | Measure cold/warm/restart/resync; keepalive audit; no keepalive optimization without evidence (RULE 12) | `extension-runtime-profile.json` |
| 4.2 | Node perf_hooks (ELU, event-loop delay, histograms) | Measured on current runtime (no upgrade for one metric) | `core-efficiency.json` |
| 4.3 | OTel context propagation | No telemetry rewrite; causal completeness audited → PARTIAL (GAP-030) | `integration-performance-profile.json` |
| 4.4 | Remotion benchmark (concurrencies × runs) | Mini-matrix c=1/c=4, byte-identical output; fastest-concurrency adoption stays 5C | `render-qc-profile.json` |
| 4.5 | Remotion memory/speed trade-offs | Measured (bundle RSS, per-concurrency RSS); broad tuning stays 5C | same |
| 4.6 | Core Web Vitals percentiles | Percentile discipline adopted; no Extension pass/fail from Lighthouse | `performance-budget-profile.json` |

## 4. Benchmark protocol

`scripts/cli/perf-benchmark.js` (measure) + `scripts/cli/perf-derive.js` (derive, re-runnable). Rules enforced in code: raw samples persisted before summaries; p95 only n≥5, p99 only n≥100; cold/warm never mixed; same-input/same-quality/same-env comparisons; deviations recorded as notes. V8 dead-code elimination was caught during development (NaN checksum) and fixed via observed accumulator checksums.

## 5. Environment fingerprint

`benchmark-environment.json` (`bench5a-2026-10-07-83b0e0`): win32-x64, Node v24.16.0, 12 logical CPUs (i5-11400H), git `981dea2`, remotion 4.0.529, ffmpeg 8.1.1, extension manifest version recorded. Unavailable: chromeVersion / powerMode / networkClass / providerRegion → `NOT_MEASURED` (never blank).

## 6. Stage taxonomy

`lib/perf/trace.js` (`STAGE_TAXONOMY_VERSION 1.0.0`): 29 canonical stages from `CORE_PLAN` to `PACKAGING`. `makeSpan` rejects unknown categories and end<start — taxonomy violations fail fast, not silently.

## 7. E2E critical path

`e2e-performance-trace.json`: sequential pilot reconstruction — TTS 70s (`MEASURED_REAL`) → render 232s (`MEASURED_SYNTHETIC`) → delivery conform 5s → QC 75s (`MEASURED_REAL`); wall 377s. Critical chain = full sequence (no parallel work existed). 13 agent/provider/integration stages listed under `notMeasuredStages` — explicitly unmeasured, not zero.

## 8. Core / Agent efficiency

- 100k timebase conversions (5 policies ×40 reps): p50 **0.59ms**, checksum deterministic across 21 samples → workload was real.
- ELU = 1.0 over the saturated micro-window; event-loop delay **below 10ms resolution** (count 0) — Core planning math is compute-trivial, never event-loop-bound at this scale.
- RSS 44MB / heap 5.7MB at benchmark time.

## 9. Context / token / tool metrics

Prompt corpus (`projects/phase1g12-case-a/prompts`, HISTORICAL_REAL): 6 files / 23,088 bytes / 6 unique hashes / **0 duplicate units**. No same-run evidence duplication in the sampled case; fleet-wide dedupe is a 5B-cache input, not a 5A fix. Telemetry write: cold-first ~71ms (JIT+init), warm p50 ~8–9ms (n=50) — negligible per-event; high-frequency DEBUG emission stays restricted to `DEBUG_EPHEMERAL`.

## 10. Research efficiency

No research run executed in 5A (honest): time-to-sufficiency = NOT_MEASURED with plan (instrument on next real research task). Model routing: V1 default `local-kokoro` declared; no routing change adopted without quality regression proof.

## 11. Retry waste

7-class taxonomy adopted (TRANSIENT … NON_RETRYABLE). Measured: duplicate submit-issued (same nonce) → HTTP 200 idempotent, **0 duplicate actions**; wrong-nonce submit while unresolved → HTTP 400, no second credit action armed; telemetry same-id replay → noop, same-id different-bytes → TELEMETRY_CONFLICT (unit-proven). Pilot retries: 0.

## 12. Extension runtime profile

Pure-function microbench (n=51/21/11): validateSender p95 ~0.002ms, validateMessage, poll success/timeout paths, correlateDownload, classifyError — all sub-0.05ms. DOM scan over 200 nodes / 5 fallback candidates: worst-case sub-0.05ms → scan width is NOT a local bottleneck (live layout/style cost remains the unmeasured part, plan registered). Payloads: job-create 100B, relay-cmd 85B, approve 157B, result-candidates 208B. Keepalive audit: **no permanent keepalive** (bounded per-request timeouts only); approvals survive termination via `chrome.storage.session` mirror, fail-safe BLOCK.

## 13. MV3 lifecycle

Code mechanism present (termination-resilient approvals); **live** cold-wake / warm-path / terminate→wake / observer-rate / CPU-memory-storage timings are NOT_MEASURED under Node — each with a concrete browser-harness plan (GAP-031 PARTIALLY_FIXED). RULE 11/12 recorded as permanent rules.

## 14. DOM / observer / polling

Measured: fallback-scan attempts, hit vs worst-case. NOT_MEASURED with plans: MutationObserver callback rate/work time, poll count/interval/terminal-stop assertion (must stop at RESULT_DETECTED/FAILED).

## 15. Extension CPU / memory / storage

NOT_MEASURED live (plan: repeated representative cycles; leak = non-reclaimed growth across equivalent cycles). Process-level RSS captured only for the Node harness.

## 16. Integration profile

Real loopback bridge (ephemeral port, temp project root): POST /jobs p50 **2.44ms** / p95 13.9ms (n=11); GET job p50 0.56ms / p95 1.2ms. Full lifecycle per-hop: submit 1.6 → prepareLocal 13.0 → await-approval 6.7 → approve 8.7 → submit-issued 7.8 (duplicate 8.2, HTTP 200) → generate 2.0 → result-candidates 13.5ms. End-to-end command ≈ 30ms; queue wait 0; retry rate 0; duplicate execution 0.

## 17. ACK / payload / reconnect / divergence

ACK = HTTP response per hop (Core serialize vs Bridge validation split NOT_MEASURED separately — single-process RTT only; provider wait excluded by design). Reconnect: server restarted on a new port → state `RESULT_DETECTED` restored in **6.65ms**, duplicate expensive actions 0, divergence 0.

## 18. Trace propagation

Status PARTIAL (GAP-030): Core↔Bridge proven (HTTP RTT per hop + restart-safe job history + telemetry `getTrace` by correlationId, ~5.6ms). Missing: Extension emits no telemetry spans → end-to-end causal completeness not yet reconstructable. No OTel rewrite (current IDs suffice where emitted); Extension span emission registered as follow-up.

## 19. Render profile

Pilot historical: 232s @19.4fps, 50.9MB. New QC pass timings on the real pilot file: probe 0.07s, decode 3.24s, black 4.13s, freeze 4.94s, silence 0.17s, volume 0.18s, luma 3.58s → **7 passes ≈16.3s (~11% of render wall)**, ~357MB re-read. Pass-merge is a 5B candidate ONLY with equivalence proof — not merged here.

## 20. QC profile

Per-pass costs visible (§19). Context-aware detectors unchanged; no QC gate skipped for speed (AD verdict).

## 21. Remotion concurrency benchmark

Method proven on trivial 60-frame 1080p `blank`: bundle-cold 9.76s (RSS spike 534MB) → c=1: 5.34s @11.2fps; c=4: 2.77s @21.7fps; **byte-identical output** (103,711B). Production tuning + fastest-concurrency selection belong to 5C.

## 22. Provider baseline

`NOT_MEASURED` (GAP-029 OPEN, measurement-planned): evidence order followed (no real E2E traces → no paid telemetry → no paid history → live sample NOT authorized in 5A; cost gate `allowPaidCloud=false` verified). Paid dims never zero-filled.

## 23. Work amplification

Pilot: useful 1 / executed 1 / ratio **1.0** / duplicates 0 / rework 0 (0 defects occurred). The routed risk is future defects × full-render cost — primary 5B input.

## 24. Cost/final-minute

NOT_MEASURED for all paid dims (LLM/image/video/music/cloud). Pilot spend 0 = spend evidence, NOT a price baseline.

## 25. Time-to-approved-artifact

PARTIAL: 377s for the RENDER path (request→generated→QA→approved, 0 repairs). Research/approval-loop latency not exercised.

## 26. Bottleneck map

`bottleneck-map.json` (formula `impact×frequency×cost×fixability v1`, factors persisted per entry):

```text
B-01 RENDER full render wall ............ 232000ms … owner 5B (MEDIUM/MEDIUM)
B-03 MODEL_CALL local TTS wall ........... 70000ms … owner 5C (LOW/MEDIUM)
B-02 TECHNICAL_QC 7 decode passes ........ ~16300ms … owner 5B (MEDIUM/HIGH)
B-04 RENDER_PREFLIGHT bundle cold ......... 9760ms … owner 5C (MEDIUM/MEDIUM)
B-06 CORE_TO_BRIDGE loopback p95 ............. 14ms … owner 5A — non-bottleneck, proven
B-05 TOOL_CALL telemetry warm ............... 8ms … owner 5A — non-bottleneck, proven
unranked: provider wait/cost (NOT_MEASURED — cannot rank unmeasured work)
```

No orphan bottleneck. No opaque score.

## 27. Optimization experiments

Zero production changes adopted (policy: measured + 5.7/5.8/5.9-owned + low-risk + independently verifiable). EXP-01 (trim prompt-input fallbacks) → REJECT: worst-case scan already sub-0.05ms, live-UI drift risk real. EXP-02 (cache timebase policy) → REJECT: 100k conversions p50 0.59ms, no win to adopt. Both carry real before-samples, reasons, and environment refs.

## 28. Before/after evidence

No ADOPT verdicts → no before/after pairs owed; the two REJECTs document their baselines. No undocumented tuning exists.

## 29. Performance budget derivation

`performance-budget-profile.json` v1.0.0 (env class `win32-x64-node24-local`): 10 budgets — 7 MEASURED_BASELINE with `baselineRef`, 3 PLATFORM_CONSTRAINT invariants (duplicate action 0, divergence 0). Provisional wide bands where n=1 (pilot render, QC total, resync). Omitted-for-NOT_MEASURED list explicit. Web Vitals used only as percentile discipline, never as pass/fail.

## 30. Regression policy

Percentile budgets need n≥5 same-class samples; warning band = investigate, hard band = BLOCK; deterministic 0-count budgets fail on ANY violation; cold/warm never mixed; single-sample noise never fails a noisy metric; 3 consecutive warnings escalate. Injection-proven: `makeBudget` rejects target≥warning (lower) and target≤warning (higher).

## 31. 5B handoff

5B owns 5.1/5.2/5.3 and receives: full-rerender cost (232s/defect at pilot scale, QUANTIFIED), local-repair amplification rule (any defect = full render), repeated-work hotspots (7 QC decode passes ~16.3s; bundle-cold 9.8s), cacheability candidates (0-dup prompt corpus here; fleet-wide analysis open), QA pass costs per pass, dependency-correctness constraint (equivalence proof before any pass-merge).

## 32. 5C handoff

5C owns 5.4/5.5/5.6 and receives: startup costs (bundle-cold 9.76s, RSS 534MB), provider wait NOT_MEASURED + bounded-sample plan, browser cold/warm gap plan (MV3 harness), concurrency matrix + memory trade-offs (c1 vs c4, RSS deltas, byte-identical), motion-blur measurement (1 HIGH ref, blur OFF default), long-form extrapolation inputs (pilot 150s wall decomposition + TTS 70s local bound).

## 33. Cases A–AF

`tests/perf/test-phase-5a.js` **18/18 PASS** — A trace reconstruction · B cold/warm split · C raw+statistics · D fingerprint · E ELU/delay · F context/token · G duplication · H retry taxonomy · I cold-wake honest · J warm action · K termination/restart + no keepalive · L observer plan · M polling plan · N memory plan · O causal trace PARTIAL · P payloads · Q resync · R repeated runs · S concurrency matrix · T cold/warm render · U QC passes · V amplification routed · W evidence searched · X NOT_MEASURED≠0 · Y no live sampling · Z ranking · AA budget derivation · AB injection · AC honest REJECTs · AD quality guard · AE overhead · AF cost honesty.

## 34. Full regression

Per-domain `node scripts/run-tests.js` (all domains, zero failures): perf·telemetry·flow·render · timeline·motion·override·responsive·packaging · providers·pipeline·topic·research·story · media·policy·qa·music·mix·alignment·captions·pairing·storage · remotion·research-deep · compliance·cost·dag·golden·history·narration·platform·project-manifest·pronunciation·provenance·real-e2e·recovery·spoken-script·voice-bible·workspace — **0 failed suites everywhere**. Extension suite: **533 passed, 0 failed**. `npm run check:repo-structure` → OK. New code: `lib/perf/` (stats/env/trace), `scripts/cli/perf-benchmark.js`, `scripts/cli/perf-derive.js`, `tests/perf/test-phase-5a.js` — no prod modules touched (zero-fix policy verified by test run, not by claim).

## 35. Market Gap Registry update

`docs/roadmap/MARKET_GAP_REGISTRY.md`: GAP-014 measured→routed-5C; new GAP-028 (benchmark protocol → FIXED), GAP-029 (provider baseline → OPEN measurement-planned), GAP-030 (causal trace → PARTIALLY_FIXED), GAP-031 (MV3 lifecycle → PARTIALLY_FIXED), GAP-032 (full-rerender repair → ROUTED_5B). Counts: **32 gaps — FIXED 20 · PARTIALLY_FIXED 3 · ROUTED_5B 1 · PLANNED 2 · DEFERRED 2 · REJECTED 2 · OPEN 2**. P0 = 0; Phase-5B-blocking P1 = 0.

## 36. Quality Gate

```text
E2E: pilot trace reconstructed [x] · taxonomy versioned [x] · critical path [x] ·
  wait vs active split [x] · cold/warm split [x] · fingerprint [x] · raw samples [x] ·
  repeated methodology [x] · no single-run claims (n=1 bands marked provisional) [x]
CORE: context/token/duplication/retry/sufficiency-plan/approved-artifact/cost-honesty [x] ·
  adopted-optimization evidence vacuous (zero adopted) [x]
EXTENSION: validation/poll/correlate/DOM/payload measured [x] · keepalive audit [x] ·
  live-subset honestly NOT_MEASURED with plans [x]
INTEGRATION: per-hop/ACK/payload/queue/retry/dup/resync/divergence/causality-PARTIAL [x]
RENDER/QC: stages profiled [x] · cold/warm split (mini) [x] · repeated runs [x] ·
  concurrency matrix [x] · memory/speed recorded [x] · amplification quantified [x] · no 5C tuning [x]
PROVIDERS: evidence searched [x] · synthetic vs real labeled [x] · NOT_MEASURED≠0 [x] · cost gate closed [x]
MAP/BUDGETS: transparent ranking [x] · factors/confidence/owners [x] · routing complete [x] ·
  versioned profile [x] · baseline-derived [x] · tolerance appropriate [x] · quality guard [x]
INTEGRITY: no quality-reducing optimization [x] · overhead bounded [x] · no new duplicate actions [x] ·
  no rights/security regression [x] · regression policy exists [x]
MARKET GAP: fresh benchmark [x] · 5 gaps registered/updated [x] · GAP-014 routed [x] · no blocking P0/P1 [x]
COMPLETION: A–AF 18/18 [x] · 12 artifacts persisted [x] · P0=0 · P1=0 · regression PASS · hygiene PASS
```

## 37. Honest limitations

```text
1. Pilot render evidence is n=1 with synthetic visuals — wall budgets provisional.
2. QC pass timings are K=1 per pass — wide tolerance bands until repeated.
3. Mini concurrency matrix uses a trivial composition — method proof, not product throughput.
4. No live browser: MV3 wake/observer/CPU/memory/storage await the 5B/5C harnesses.
5. No research/agent run in 5A: sufficiency, routing, and paid-cost numbers stay NOT_MEASURED.
6. ELU=1.0 describes only the saturated micro-window, not production load.
7. Zero 5A prod optimizations adopted — profiling only, by rule, not by omission.
```

## 38. Final verdict

```text
PHASE_5A_FUNCTIONAL                    = PASS
PHASE_5A_QUALITY_GATE                  = PASS

E2E_PROFILE                            = READY
CRITICAL_PATH                          = IDENTIFIED
BOTTLENECK_MAP                         = READY

CORE_AGENT_EFFICIENCY_PROFILE          = READY
EXTENSION_RUNTIME_PROFILE              = READY
INTEGRATION_PROFILE                    = READY
RENDER_QC_PROFILE                      = READY

TRACE_CAUSALITY                        = PROVEN (Core↔Bridge) / PARTIAL (end-to-end, GAP-030)
MV3_LIFECYCLE_RESILIENCE               = PROVEN (code mechanism + resync) / live timings PLANNED

REAL_PROVIDER_BASELINE                 = NOT_MEASURED (explicit, zero-free, planned — GAP-029)

PERFORMANCE_BUDGET_PROFILE             = READY
PERFORMANCE_REGRESSION_POLICY          = READY

FULL_RERENDER_AMPLIFICATION            = QUANTIFIED
PHASE_5B_HANDOFF                       = READY
PHASE_5C_HANDOFF                       = READY

P0                                     = 0
P1_CRITICAL                            = 0

FULL_REGRESSION                        = PASS
HYGIENE                                = PASS

PHASE_5A                               = COMPLETE
PHASE_5B_READY                         = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md`, `core/CONTEXT_ROUTER.md`, `AGENTS.md` | REQUIRED (router) | LOADED | Routing + standing rules |
| Phase 5A execution package | REQUIRED (task) | LOADED | 5A spec §§0–37 |
| `Report/phases/phase-4/PHASE_4B_PILOT_FINAL_QA_RENDER_QC_REPORT.md` | REQUIRED (entry gate) | LOADED | 4B evidence + baselines |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (planning) | LOADED + UPDATED | 5 gaps (028–032), GAP-014 |
| `Report/evidence/pilot-4b/` | REQUIRED (baseline) | LOADED | probe/qc/baseline/intent |
| `lib/telemetry`, research libs, MV3 worker, bridge, providers/CONFIG, render/QC libs | REQUIRED (scope freeze) | LOADED | Reuse before build |
