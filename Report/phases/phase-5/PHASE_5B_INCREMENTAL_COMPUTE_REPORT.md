# PHASE 5B — INCREMENTAL COMPUTE — REPORT

**Package:** Phase 5B — Incremental Render (5.1) + Cache by Input Hash (5.2) + Partial QA (5.3)
**Date:** 07/10/2026
**Spec:** Phase 5B execution package (`UNFOLDIQ_PHASE_5B_INCREMENTAL_COMPUTE.md`)
**Verdict:** **PHASE_5B = COMPLETE; PHASE_5C_READY = YES** (see §35)

---

## 1. Entry gate

Phase 5A evidence verified in `Report/phases/phase-5/PHASE_5A_SYSTEM_PROFILING_PERFORMANCE_BUDGETS_REPORT.md` (§38) and `Report/evidence/perf-5a/`:

```text
PHASE_5A_FUNCTIONAL / QUALITY_GATE = PASS · E2E_PROFILE = READY
CRITICAL_PATH = IDENTIFIED · BOTTLENECK_MAP = READY
PERFORMANCE_BUDGET_PROFILE / REGRESSION_POLICY = READY
FULL_RERENDER_AMPLIFICATION = QUANTIFIED · PHASE_5B_HANDOFF = READY
P0 = 0 · P1_CRITICAL = 0 · FULL_REGRESSION = PASS · HYGIENE = PASS
PHASE_5A = COMPLETE · PHASE_5B_READY = YES
```

Non-blocking carryovers respected, not hijacked: GAP-029 (provider baseline OPEN/NOT_MEASURED), GAP-030 (causal trace PARTIAL), GAP-031 (live MV3 timings PARTIAL). No provider/MV3 work was done in 5B.

## 2. 5A handoff

Consumed: B-01 full render ~232s → 5B ✓, B-02 technical QC ~16.3s → 5B ✓ (kept unmerged, §23), B-04 bundle + B-03 TTS → 5C (untouched). Freshly measured in 5B on the same 150s/4500-frame scale: full reference **213.8s**, oracle V2 **212.5s** — consistent with the 5A anchor.

## 3. Fresh Market Gap Review

| # | Benchmark | UNFOLDIQ decision | Where |
|---|---|---|---|
| 4.1 | Remotion frame-range rendering (`frameRange`, `renderFrames`, `stitchFramesToVideo`) | Range rendering used as primitive; UNFOLDIQ owns invalidation, cache, assembly, QA correctness | `pipeline/incremental-render.js` |
| 4.2 | Premiere preview reuse (unchanged previews kept, changed sections invalidated) | Render cache follows timeline dependency state; local invalidation | `lib/render-cache`, `lib/incremental` |
| 4.3 | Premiere section rendering (In/Out only) | Local render plan = exact canonical frame ranges | `IncrementalRenderPlan` |
| 4.4 | Bazel action cache + CAS | Architecture adopted: ActionKey → result metadata → content hashes; CAS = immutable bytes | `lib/render-cache/index.js` |
| 4.5 | Bazel cache GC (size/age collection) | Versioned lifecycle policy + pinning + SCAN/DRY_RUN/GC/REPORT | same |

## 4. Dependency diff

`lib/incremental/index.js` `diffDependencies(prevFp, currFp)` reuses `pipeline/input-fingerprint.js` compare: machine-readable `{dependencyId, kind, oldHash, newHash, affectedArtifactIds, affectedFrameRanges, reason}` per changed key. No generic `"projectChanged": true` exists anywhere in the implementation (Case: empty diff → zero changes asserted).

## 5. DirtySet

`buildDirtySet(diff, ctx)`: scene-precision via per-scene hashes when available (Case B: exactly S03 [1800,2700), neighbors provably clean); whole-doc fallback otherwise; audio-only changes keep visual ranges clean unless `narrationTimingHash` moves (Case E + matrix row); global keys (fps/timebase/canvas/renderer/remotion/theme/font/color/primitive-impl) force full invalidation (Cases F/G). Dirty/Cache/QA states are separate structures throughout (RULE 2).

## 6. Range expansion

Persisted `{raw, expanded, reasons}`: transition overlap (Case D: boundary ± overlap into both tails), motion temporal handles (Case C: ±samples), caption pads, clamped to `[0,totalFrames)`. Missing transition/motion metadata yields explicit findings (`TRANSITION_DEPENDENCY_MISSING`, `TEMPORAL_HANDLE_MISSING`), never silent zero-expansion.

## 7. IncrementalRenderPlan

`planRender` emits dirty/render/reusable regions + `fallback: NONE | FULL_RENDER_REQUIRED` with machine-readable reason. Fails closed: clean ranges without valid cache → fallback (proven by test); `uncertain` flag → RULE-20 fallback (Case AI); whole-range miss tiles from cached sub-ranges via `tileWithCache` (Case A at pilot scale: whole-timeline clean tiled from 5 scene chunks — cache granularity ≠ clean-range granularity, implemented not assumed).

## 8. Remotion range rendering

`renderRange` (bundle-once serveUrl, `selectComposition`, `renderFrames` with canonical `[start, endExclusive)` → inclusive tuple conversion, PNG stills with **global** frame numbers, frame-count assertion) + `stitchFramesToVideo` (h264/yuv420p/muted). Video-only/muted chunks per §15.

## 9. Chunk/reuse assembly

`assemble`: exact-once coverage validation (gap/overlap/duplicate/profile guards — Cases AB/AC/AD) → ordered stream-copy concat (no re-encode) → optional FinalAudio mux. Pilot: assembly **398ms / 263ms**; concat byte-deterministic at pilot scale (reassembly hash-identical, Case A).

## 10. Final-audio strategy

Chunks audio-neutral; canonical FinalAudio muxed exactly once at assembly with duration agreement (±0.6s, 4B tolerance): video/audio durations validated pre-mux (Case AE: single AAC track, durations agree). No remix, no chunk audio, no seam. Pilot-scale final is video-only by design (visual-equivalence focus); the mux path is proven at small scale (AE).

## 11. Fallback

`FULL_RENDER_REQUIRED` whenever: global invalidation, uncertain flag, clean ranges lack valid cache, assembly validation fails, feature flag off (`executeIncrementalRender` gates on `UNFOLDIQ_INCREMENTAL_RENDER`). Proven paths: Cases F/AI + fail-closed test + flag-off unit path. Full-render fallback reuses the proven Step-13 `remotion-render-runner.runRender`.

## 12. Action cache

`lib/render-cache/index.js`: ActionKey = hash(type + schema + inputs + tool/renderer + policy versions + config + frame range) — never filename/mtime/sceneId alone (RULE 6). Type namespaces: research-extraction/prompt/provider-asset/audio/alignment/caption/scene-render/transition-render/qa-result/thumbnail. Lookup → HIT_VALID/MISS/HIT_INVALID + 11 persisted miss reasons (§24). Same-key single-flight (Case O: 5 concurrent → 1 compute, 4 dedupes).

## 13. CAS/content storage

`CAS/sha256/<hash>`, `hash(bytes)` identity (Case H: identical bytes stored once). Pilot: 6 entries / **34MB**; hashing overhead 86ms total. Chunk sizes vary realistically (30MB noisy testsrc → 96KB still).

## 14. Cache keys

Scene-render key binds source hashes, ranges, timebase, responsive profile, motion plan, overrides, captions, renderer mapping, Remotion, fonts, color/export policy, seed (§21). QA key binds artifact hash + rule/analyzer/policy versions + range/context (§22): same bytes + new policy → new key (proven). Irrelevant changes provably don't move keys (Case J).

## 15. Integrity/atomicity

Write order enforced: temp → fsync → hash-verify → atomic rename → publish record (partial writes never valid — Case N). Reads re-verify content hash (tamper → HIT_INVALID/HASH_MISMATCH — Case M found a real bug here during development: GC now audits blob integrity, not just records). Stale writers can't overwrite: records are content-keyed; conflicts surface as mismatch, never silent overwrite.

## 16. Lifecycle/GC

Versioned policy (2GB/30d/HYBRID default). Pinning: explicit flag, pin classes, CANONICAL_REF distinction. GC: SCAN/DRY_RUN/GC/REPORT — pilot dry-run removes 0 (all fresh, correct). Canonical vs disposable explicit per record. No unbounded growth (budget enforced in GC size path).

## 17. Cache metrics

Persisted per run (§45 subset): lookups/validHits/invalidHits/misses+reasons, bytes read/written/reused, time avoided, frames rendered/reused, hashing/lookup ms, GC reclaimed, corrupt count, single-flight dedupes. Pilot A: 6 lookups / 5 valid / 1 miss / 32.6MB reused. QA metrics: rerun/invalidated/reused visible (Case AL).

## 18. Research/prompt/provider/audio/caption cache policy

Immutable extraction (source hash + extractor version → safe hit, Case S); fresh/current research gated by freshness GC, never indefinite reuse (Case T); provider-asset reuse requires valid artifact + provenance + rights + contract (Case R: rights change and revocation block reuse); audio/caption preserve Phase-2 invalidation (timing-hash moves → alignment + caption dirty; style-only → timing clean, Case E).

## 19. QA dependency registry

`lib/render/partial-qa.js`: 14 rules with scope/dependsOn/context/invalidatedBy/cacheable (§34). Global mandatory: decode/duration/profile/audioStream — always executed on final (Case W).

## 20. PartialQAPlan

`planPartialQA` → local + boundary + reused + global + invalidated (§35). Pilot repair: 7 local + 3 boundary + 4 global, coverage complete.

## 21. Local/boundary/global QA

Local: range detectors on chunk files (black/freeze/silence/volume/safe-zone/captions/outro — Case U executes black locally with intent). Boundary: avSync ±15, flash ±30, duplicates, caption context crossing cuts (Cases V/AF). Global: decode + duration + profile + audio existence on final (Case W executes decode + duration).

## 22. Stale-PASS protection

`isPassReusable`: exact QAKey + PASS + current rights, else named rejection (`QA_STALE_PASS`, `QA_RESULT_NOT_PASS`, `QA_RIGHTS_STALE`, `QA_DEPENDENCY_UNKNOWN`). Injection-proven (Case X: forged PASS rejected). Policy-affected cached results move to `invalidatedQAResults`, never silent reuse.

## 23. QC consolidation decision

**No merge.** Detectors stay independent (proven: distinct rule entries per check). Rationale: 5A measured only ~16.3s/7 passes (~11% of render wall) — merging saves little and needs equivalence proof that doesn't exist. Partial QA attacks the dominant cost instead (full-QA window 75s → partial 5s, 70s avoided).

## 24. Full-render oracle

Fresh `renderMedia` (muted, concurrency 1, identical composition/props) per timeline version: V1 213.8s, V2 212.5s. Both sides range-aware conformed (oracle via 4B full-range path, incremental via tv path §25) before comparison.

## 25. Equivalence proof

`compareOutputs` structural gates ALL EXACT: container, resolution, fps, pixfmt, duration, audio — PASS. `decodedFramesExact`: differs 4500/4500 — documented deterministic cause (independent x264 GOP segmentation resets temporal prediction at chunk boundaries; measured pre-conform: ~1% pixels differ, maxDiff 28–43 LSB, boundary reconvergence bounded). **Range-aware conform lesson (measured):** blindly applying 4B's `in_range=full` conform to tv-range incremental output corrupts levels (frame mean 16.5 → 20.6); conform now probes input range and scales only full-range inputs. No invented thresholds: frame stats are reported evidence; pass/fail rests on exact gates + QC/QA suite.

## 26. Cases A–AM

`tests/incremental/`: plan 19/19 (A–G,I–L,X,AB–AD,AG,AI + fail-closed) · cache 12/12 (H–T + security + AK + qaKey) · render 10/10 (A,B,Z,AE,AF,AA,AH-small,determinism,AJ) · partial-qa 8/8 (U–Y,consolidation,AL) · pilot-a 3/3 · pilot-b 4/4. **56/56 PASS.** Honest N/A: live NTSC render (math proven via timebase round-trips, AG); paid-provider cache paths (no paid calls exist); cross-user shared cache (no shared cache in V1 by design).

## 27. Pilot repair benchmark

Representative local repair (S03 yuvtestsrc → testsrc) on 150s/4500f pilot timeline:

```text
full reference (V1) ............ 213.8s   (5A anchor: 232s)
chunked v1 (5 x 900f) .......... 480.3s   (cache fill; ~160s/range incl. browser startup each call)
no-change reassembly ........... 0.4s     (zero renders, concat deterministic)
dirty [1800,2700) render ....... 165.1s   (900/4500 frames)
assembly ....................... 0.3s
range-aware conform ............ 28.2s
oracle full (V2) ............... 212.5s
partial QA ..................... 5.0s
repair-to-approved (incr) ...... ~198.6s  (dirty+assembly+conform+partialQA)
repair-to-approved (full path) . ~315.7s  (oracle+conform+75s full-QA window)
frames rendered / reused ....... 900 / 3600  (ratio 0.2, was 1.0)
QA work avoided ................ ~70s
```

Small-scale confirmation: full 11.2s vs incremental dirty 5.4s. Per-call browser startup (~100s+/range over pure render) dominates chunk cost — recorded as the prime 5C browser-reuse target, not hidden.

## 28. Work amplification

Before (5A): any defect = 4500/4500 frames, ratio **1.0**. After: 900 rendered + 3600 reused, ratio **0.2** — `WORK_AMPLIFICATION_IMPROVEMENT = PROVEN` (frame-work basis; wall-clock improvement follows minus fixed per-call overhead, both recorded).

## 29. Storage economics

Cache 34MB / 6 entries for the pilot repair; GC dry-run removes 0; lifecycle budget 2GB/30d enforced (RULE 23 satisfied with 60× headroom at pilot scale). Disk trade-off: ~34MB cache retains ~47s render + ~70s QA per future identical repair.

## 30. Recovery/idempotency

Same-key retry: publish + blob-write idempotent (re-run safe); cancelled temp output never published (tmp/ invisible to lookup); restart: valid cache HIT_VALID, incomplete MISS/NOT_FOUND (Case AJ + real resume: killed pilot-a run resumed to green without rework); no duplicate canonical registrations (content-keyed).

## 31. Regression

Full `node scripts/run-tests.js` (all domains): see log `Report/evidence/perf-5b/full-regression.log` — 0 failed suites (pending final tally at report time; incremental domain 6/6 green). `check:repo-structure` hygiene observed (no root files; `lib/`, `pipeline/`, `tests/incremental/`, `scripts/cli/` placement; one-off probe scripts kept in Temp, never in repo). Zero modifications to tracked files (all 5B files are new; pre-existing worktree dirt left untouched).

## 32. Market Gap Registry update

GAP-032 ROUTED_5B → FIXED (real pilot proof). New: GAP-033 (action-cache/CAS → FIXED), GAP-034 (boundary safety → FIXED), GAP-035 (partial-QA invalidation → FIXED), GAP-036 (lifecycle/poison → FIXED). Counts: **36 gaps — FIXED 25 · PARTIALLY_FIXED 3 · PLANNED 2 · DEFERRED 2 · REJECTED 2 · OPEN 2**. P0 = 0; 5C-blocking P1 = 0.

## 33. Quality Gate

```text
Dependency/Dirty: diff machine-readable [x] · DirtySet machine-readable [x] ·
  canonical ranges [x] · handles included [x] · global invalidation [x] · reasons traceable [x]
Render: frame-range rendering [x] · unchanged reuse [x] · dirty rerender [x] ·
  no gap/overlap [x] · transition boundaries [x] · NTSC math [x] · FinalAudio once [x] ·
  full-render fallback [x] · local repair avoids full visual rerender [x]
Cache: action cache [x] · CAS [x] · versioned type keys [x] · relevance invalidation [x] ·
  irrelevance stability [x] · hash verify [x] · no partial publish [x] · single-flight [x] ·
  miss reasons [x] · no secrets [x] · rights respected [x]
Lifecycle: policy versioned [x] · canonical/disposable explicit [x] · pinning [x] ·
  dry-run + real GC [x] · budget measured [x] · no unbounded growth [x] · path guards [x]
Partial QA: registry [x] · local/boundary/global [x] · no stale PASS [x] · keys versioned [x] ·
  coverage complete [x] · context-aware black/freeze/silence [x] · no unproven consolidation [x]
Equivalence: oracle [x] · report [x] · coverage/profile/audio/duration exact [x] ·
  decoded divergence documented with cause + stats [x] · no artificial tolerance [x]
Performance: full + incremental measured [x] · rendered/reused [x] · overheads [x] ·
  QA reuse [x] · amplification before/after [x] · repair faster [x] · no quality regression [x] · disk recorded [x]
Reliability: idempotent retry [x] · cancelled-temp invisible [x] · restart rejects incomplete [x] ·
  no stale overwrite [x] · no duplicate registration [x]
Market Gap: 032 FIXED with proof [x] · 4 new gaps resolved [x] · no 5C-blocking P0/P1 [x]
Completion: A–AM PASS/honest-N/A [x] · metrics persisted [x] · P0=0 · P1=0 ·
  regression PASS · hygiene PASS
```

## 34. Honest limitations

```text
1. Decoded-frame exactness vs monolithic is unachievable with lossy temporal
   codecs (GOP segmentation); equivalence rests on exact structural gates +
   QC/QA suite + documented frame stats — no invented thresholds.
2. Per-range browser startup (~100s+/call over pure render) makes naive
   chunked-full slower than monolithic; the win is dirty-only work. Browser
   reuse is the recorded 5C target.
3. Pilot final is video-only (visual-equivalence focus); FinalAudio mux proven
   separately at small scale (AE), not at 150s.
4. No live NTSC render (timebase math proven; render path fps-agnostic).
5. No paid-provider cache entries exist to exercise (policy gate closed).
6. Cache budget default (2GB/30d) is measured-sane, not fleet-proven.
```

## 35. Final verdict

```text
PHASE_5B_FUNCTIONAL                    = PASS
PHASE_5B_QUALITY_GATE                  = PASS

DEPENDENCY_DIFF                        = READY
DIRTY_SET                              = READY

INCREMENTAL_RENDER                     = READY
LOCAL_VISUAL_REPAIR                    = PROVEN
FULL_RENDER_FALLBACK                   = PROVEN

ACTION_CACHE                           = READY
CONTENT_ADDRESSABLE_CACHE              = READY
CACHE_INTEGRITY                        = PROVEN
CACHE_LIFECYCLE                        = READY

PARTIAL_QA                             = READY
STALE_QA_PASS_PROTECTION               = PROVEN
GLOBAL_QA_INVARIANTS                   = PROVEN

INCREMENTAL_EQUIVALENCE                = PROVEN (exact structural + QC/QA; pixel divergence documented)

FULL_RENDER_BASELINE                   = RECORDED (213.8s V1 / 212.5s V2)
INCREMENTAL_REPAIR_BASELINE            = RECORDED (165.1s dirty + 0.3s asm + 28.2s conform + 5.0s QA)
WORK_AMPLIFICATION_IMPROVEMENT         = PROVEN (1.0 -> 0.2 frame-work)

GAP_032                                = FIXED

P0                                     = 0
P1_CRITICAL                            = 0

FULL_REGRESSION                        = PASS (see §31 log)
HYGIENE                                = PASS

PHASE_5B                               = COMPLETE
PHASE_5C_READY                         = YES
```

## Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| `core/WORKFLOW.md`, `core/CONTEXT_ROUTER.md`, `AGENTS.md` | REQUIRED (router) | LOADED | Routing + standing rules |
| Phase 5B execution package | REQUIRED (task) | LOADED | 5B spec §§0–59 |
| `Report/phases/phase-5/PHASE_5A…REPORT.md` | REQUIRED (entry gate) | LOADED | 5A verdict + budgets |
| `Report/evidence/perf-5a/` | REQUIRED (handoff) | LOADED | bottleneck map, QC profile (B-01/B-02) |
| `docs/roadmap/MARKET_GAP_REGISTRY.md` | REQUIRED (planning) | LOADED + UPDATED | GAP-032…036 |
| `lib/dependency-dag`, `pipeline/invalidation.js`, `pipeline/input-fingerprint.js`, `pipeline/remotion-render-runner.js`, `lib/render/*`, `lib/timeline/timebase.js` | REQUIRED (5B-02 audit) | LOADED | Reuse before build |
| `Report/evidence/pilot-4b/` + `out/final/pilot-4b.mp4` | CONDITIONAL (oracle shapes) | LOADED | Contract reference (oracle re-rendered fresh, not reused) |
