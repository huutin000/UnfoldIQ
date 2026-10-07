# PHASE 1G.1 — PROMPT 01
# CONTENT ROUTING + RESEARCH PLANNING REPORT

## 1. Status

```text
TASK_VALIDATION = PASS
SCOPE = 1G.1A Content Class Router + 1G.1B Research Plan/Question Planner + 1G.1C Research Required Gate
NO paid API calls. NO web research. NO Flow/Veo. NO credits consumed.
```

## 2. Scope

Implemented exactly Roadmap V5 work items `1G.1A / 1G.1B / 1G.1C`.
Prompt 02 (Research Acquisition: SearchProvider, Crawl4AI, browser extraction) intentionally NOT started.

## 3. Baseline Read

Actually read before modifying code:

```text
AGENTS.md (thin router rules)
core/WORKFLOW.md, core/CONTENT_MODE.md, core/RESEARCH_QUALITY.md,
core/EDITORIAL_VALUE.md, core/STORYTELLING.md, core/CONTEXT_ROUTER.md
platforms/INDEX.md, platforms/youtube/PROFILE.yaml, platforms/tiktok/PROFILE.yaml,
platforms/youtube/OVERLAY.md, platforms/tiktok/OVERLAY.md
schemas/content-mode.schema.json, schemas/research-plan.schema.json, schemas/research-brief.schema.json
lib/research-quality-check.js, lib/v5-contract-check.js
context/ROUTES.yaml, context/DOC_CATALOG.yaml
tests/pipeline/test-v5-preflight.js, tests/pipeline/test-editorial-quality.js,
tests/pipeline/test-context-routing.js
Report/PHASE_1G_PREFLIGHT_ROADMAP_V5_PROMPT_RULE_CONTRACT_MIGRATION_REPORT.md
package.json, scripts/run-tests.js, scripts/checks/validate-schemas.js,
scripts/checks/repository-structure-check.js, scripts/cli/context-resolver.js,
pipeline/state-store.js (state conventions), projects/pilot-sky-blue/* (artifact conventions)
```

## 4. Repository Architecture Reused

| Reused | How |
|---|---|
| `lib/v5-contract-check.js` `decideResearchRequired` | Wrapped by the new gate, not duplicated |
| `lib/*` result conventions (`{valid/errors}`, `{ok/code/message}`) | Same shapes in new modules |
| `tests/pipeline/*.js` custom Node runner style | New tests follow it; run via `scripts/run-tests.js` |
| `projects/<id>/research/*.json` artifact convention | Plan persists to `research/research-plan.json` |
| `research-plan.schema.json` contract | No schema change; runtime validates against it via `ajv` (existing dep) |
| `platforms/INDEX.md` aliases | `normalizePlatform` accepts `youtube/yt`, `tiktok/tt` |
| Schema default `contentClass = FACTUAL` | Untouched; runtime resolution stays explicit for new ambiguous work (documented in §22) |

## 5. Files Audited

See §3 plus `lib/topic-registry-check.js` (persist/load conventions),
`lib/render-errors.js` (error-code conventions), `projects/pilot-sky-blue/content-mode.json`
and `research/research-brief.json` (real artifact shapes).

## 6. Content Class Runtime Implementation

`lib/content-class.js` — `resolveContentClass({contentClass, persistedContentClass, contentMode/modeId, customModeClass, topic})`.
Precedence: EXPLICIT → PERSISTED → MODE_MAP → CUSTOM_MODE_METADATA → AMBIGUOUS
(`AMBIGUOUS_CONTENT_CLASS`, never guessed). Invalid explicit class →
`INVALID_CONTENT_CLASS`. Explicit/persisted vs mapped-mode mismatch →
`CONTENT_MODE_CLASS_CONFLICT` (intent preserved, not overwritten).
No title-keyword sniffing: repository supports topic→mode hints, not
title→class inference, so title-only input is unresolved by design.

## 7. Content Mode Compatibility

`MODE_CLASS_MAP` in `lib/content-class.js` is the single mapping owner.
Mapped: all factual doc-table modes (`historical-documentary`,
`technical-explainer`, `tutorial`, `educational-explainer`, `news-explainer`,
`product-review`, `comparison`, `listicle`, `commentary`, `data-explainer`,
`meditation-guided` = instructional wellness about real practice) → FACTUAL;
`cinematic-fiction`, `horror-fiction`, `original-story` → FICTION;
`urban-legend-documentary`, `paranormal-documentary` → HYBRID.
Deliberately unmapped (need explicit class): `comedy`, `storytelling`
(genre-ambiguous), any `custom-*`/unknown ID. `modeId` never renamed; schema untouched.

## 8. Ambiguity / Review Behavior

Titles alone (`The woman in room 304`, `The Room 304 Mystery`,
`The Ghost of the Old Hospital`, `The Vanishing Village`,
`The creature in the forest`) → `ok:false, code:AMBIGUOUS_CONTENT_CLASS`,
user confirmation required. Proven by test (5 titles, §24).

## 9. Research Required Gate

`resolveResearchRequirement(contentClass, {targetedResearchTopics, skipResearch})`
in `lib/research-plan.js`, wrapping pre-flight `decideResearchRequired`:
FACTUAL→REQUIRED, HYBRID→REQUIRED, FICTION→NOT_REQUIRED default,
FICTION+non-empty targeted topics→OPTIONAL_TARGETED. `skipResearch:true`
on FACTUAL/HYBRID → `RESEARCH_BYPASS_REJECTED` (no silent fast-track).

## 10. FICTION Targeted Research Behavior

Facade result preserves `fictionalCore:true` + `targetedResearchTopics[]`
alongside (not inside) the schema-clean plan, since
`research-plan.schema.json` forbids extra properties. Questions derive only
from caller-supplied factual/world-building topics; validator rejects
proof-of-fiction phrasing (`FICTION_SCOPE_VIOLATION`). Project stays FICTION.

## 11. Research Plan Builder

`buildResearchPlan()` — deterministic templates (no LLM, no second provider
stack). FACTUAL has documentary-timeline vs procedural (`TUTORIAL_MODES`)
variants; HYBRID separates documented/folklore/testimony/speculation/boundary;
targeted FICTION builds only from `targetedResearchTopics`. Builder
normalizes (dedupes) questions; validator rejects duplicates (strategy documented).

## 12. Research Plan Validation

Two layers: `validateResearchPlanSchema()` (ajv vs
`schemas/research-plan.schema.json`) then `validateResearchPlanSemantics()`
→ `VALID | INVALID | REVIEW_REQUIRED` with `{code, path, message, severity}`.
Codes: `INVALID_CONTENT_CLASS`, `AMBIGUOUS_CONTENT_CLASS`,
`CONTENT_MODE_CLASS_CONFLICT`, `RESEARCH_REQUIREMENT_MISMATCH`,
`RESEARCH_PLAN_INVALID`, `RESEARCH_PLAN_MISSING_CRITICAL_QUESTIONS`,
`RESEARCH_PLAN_INVALID_STOP_CRITERIA`, `RESEARCH_PLAN_DUPLICATE_QUESTIONS`,
`RESEARCH_NOT_REQUIRED`, `RESEARCH_BYPASS_REJECTED`,
`INVALID_TARGETED_SCOPE`, `INVALID_PLATFORM`, `INVALID_INPUT`,
`FICTION_SCOPE_VIOLATION`. No generic `PLANNING_FAILED`.

## 13. Research Goal / Scope

Per-class goal templates (§11 of code): factual (timeline + evidence +
interpretations + disputes), hybrid (separation mandate + label preservation),
targeted fiction (world-building only). `timeScope`/`geographicScope`
passthrough (never invented); `freshnessRequirement` defaults to
`EVERGREEN_OK; CURRENT_STATE claims require dated sources`.

## 14. Question Planning

Critical/supporting/optional groups per class/mode; hygiene enforced
(non-empty, normalized dedupe, scope-bounded). Tutorial-family modes get
procedural questions (prerequisites/steps/official docs/edge cases), not
documentary timelines.

## 15. Source Priority / Freshness

Priorities only, never sources: FACTUAL (primary/official/peer-reviewed/…),
HYBRID (+ folklore sources; community testimony only as TESTIMONY),
TARGETED (official/peer-reviewed/reference works). No search, no URLs
(asserted: plan JSON contains no `http`, no `sources`/`claims` keys).

## 16. Stop Criteria

Every built plan carries explicit stop criteria (evidence-path +
source-requirements + freshness + non-blocking optionals + budget).
Sufficiency evaluation (`SUFFICIENT / NEEDS_MORE_RESEARCH / BLOCKED`)
explicitly deferred (Prompt 03 scope).

## 17. Research Budget

String-form budgets per decision (schema type is `string`, unchanged):
FACTUAL `maxQueries:12; maxSources:20; maxDeepResearchEscalations:1; maxTimeMin:120`,
HYBRID `14;24;1;150`, TARGETED `6;10;0;45`; caller-overridable.
`deepResearchAllowed` defaults `false` = planning intent only, never execution.

## 18. Platform Integration

`normalizePlatform` (aliases per `platforms/INDEX.md`); unknown platform →
`INVALID_PLATFORM`. Same class/requirement on both platforms; platform only
propagates scope fields. No `ROUTES.yaml`/`DOC_CATALOG.yaml` change needed —
planning loads no new context (token-efficiency preserved; context-routing
regression still PASS).

## 19. YouTube Compatibility

Matrix-proven: YouTube + `historical-documentary` → FACTUAL/REQUIRED/plan;
YouTube + `horror-fiction` → FICTION/NOT_REQUIRED/no plan. Shared core used;
no YouTube-only policy in core.

## 20. TikTok Compatibility

Matrix-proven: TikTok + `historical-documentary` → FACTUAL/REQUIRED/plan;
TikTok + `urban-legend-documentary` → HYBRID/REQUIRED/plan. Same contracts;
no YouTube-monetization leakage; TikTok aspect/safe-zone untouched.

## 21. Persistence / Project State Integration

`saveResearchPlan(projectDir, plan)` → `<projectDir>/research/research-plan.json`
(same convention as `research-brief.json`), creating `research/` if needed.
Idempotent: byte-identical (stable key-sorted compare) rerun →
`{saved:false, code:UNCHANGED}`; changed plan rewrites. Tested with temp dir,
deleted after.

## 22. Backward Compatibility

No schema changed. Pre-V5 `content-mode.json` without `contentClass` still
validates (asserted). Pre-V5 input (topic + known mode, no class) resolves via
`MODE_MAP` and plans. Schema default `FACTUAL` preserved for old instances;
new ambiguous runtime work returns explicit unresolved instead of silent
FACTUAL — the distinction required by the prompt, documented here.

## 23. Errors / Diagnostics

See code list in §12. LOG-FIRST was followed: a smoke-test anomaly
(`undefined` in an inline check) was traced to the throwaway `node -e`
reading `.ok` off a JSON string, not library code — verified with a corrected
probe rather than editing source.

## 24. Tests Added

- `tests/pipeline/test-content-class-router.js` — 14 tests / 34 asserts (A1–A7, ambiguity, platform independence, backward compat).
- `tests/pipeline/test-research-planning.js` — 20 tests / 70 asserts (B1–B6, C1–C10, semantic mismatches, 5-path integration, YT/TT matrix, no-fake-acquisition, persistence/idempotency).
- Style: repo-custom Node asserts, exit 1 on failure, auto-run by `scripts/run-tests.js`.

## 25. Bugs Found During Implementation

None in library code. One throwaway-probe mistake (see §23); no source change resulted.

## 26. LOG-FIRST Fix Iterations

No fix iterations required: both new suites passed on first run; all
regressions passed on first run (see §28–§30).

## 27. Commands Executed

```text
node tests/pipeline/test-content-class-router.js
node tests/pipeline/test-research-planning.js
node tests/pipeline/test-v5-preflight.js
node tests/pipeline/test-editorial-quality.js
node tests/pipeline/test-context-routing.js
node scripts/checks/validate-schemas.js
node scripts/checks/repository-structure-check.js
node scripts/run-tests.js   (full: flow/media/pipeline/policy/providers/qa/remotion/topic)
```

## 28. Targeted Test Results

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-content-class-router.js` | PASS | 14 tests, 34/34 asserts | PASS |
| `test-research-planning.js` | PASS | 20 tests, 70/70 asserts | PASS |

## 29. V5 PRE-FLIGHT Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-v5-preflight.js` | PASS | 47/47 asserts | PASS |
| `test-editorial-quality.js` | PASS | 37/37 asserts | PASS |
| `test-context-routing.js` | PASS | 34/34 asserts (C1–C7) | PASS |
| `validate-schemas.js` | PASS | all schemas + semantic S1–S8b | PASS |
| `repository-structure-check.js` | PASS | `REPOSITORY_STRUCTURE_OK` | PASS |

## 30. Full Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `node scripts/run-tests.js` | 0 failed | 0 failed suite(s) in 96.5s (incl. 2 new suites) | PASS |

## 31. Browser Validation
- NOT_APPLICABLE
- Backend/core-only change (`lib/*.js` + pipeline tests); no DOM, UI, extension, selector, or user-visible browser workflow touched; no UI exposes the new states (per prompt §49–§50, no new Research UI built).

## 32. Files Created

| File | Why |
|---|---|
| `lib/content-class.js` | 1G.1A ContentClassResolver + single-owner `MODE_CLASS_MAP` |
| `lib/research-plan.js` | 1G.1B/1G.1C gate + builder + validator + `planResearch` facade + `saveResearchPlan` |
| `tests/pipeline/test-content-class-router.js` | A-series + ambiguity + platform + compat tests |
| `tests/pipeline/test-research-planning.js` | B/C-series + integration + persistence tests |
| `Report/PHASE_1G1_01_CONTENT_ROUTING_AND_RESEARCH_PLANNING_REPORT.md` | This report (mandatory deliverable) |

## 33. Files Modified

| File | Change | Why | Tests |
|---|---|---|---|
| `core/WORKFLOW.md` | +1 runtime pointer line in Stage 3B, +1 in Stage 3C | Discoverability of new runtime modules; no rule duplication | context-routing still PASS |

## 34. Files Deleted

None.

## 35. Scope Check
- confirm no SearchProvider/Crawl4AI/etc.

```text
Grep over new modules for Crawl4AI|SearchProvider|GPTResearcher|playwright|
Source Registry|Evidence Ledger|http|fetch( -> zero hits (SCOPE_CLEAN).
package.json untouched (deps still ajv/ajv-formats/js-yaml + playwright dev).
No schemas changed. No 1G.1D+ or 1G.2+ work.
```

## 36. Remaining Issues

None blocking. Known deliberate ceiling: question templates are deterministic
heuristics (mode-aware but not LLM-planned); upgrade to provider-backed
planning only if/when the product explicitly requires it.

## 37. Next Allowed Step

```text
PHASE 1G.1 — PROMPT 02
RESEARCH ACQUISITION LAYER (1G.1D Research Mode + Search Provider,
1G.1E Crawl4AI, 1G.1F dynamic/auth browser extraction)
```
Not started in this task.

## 38. Final Conclusion

```text
TASK_VALIDATION = PASS
Content Class Router + Research Required Gate + Research Plan/Question Planner
+ semantic validation + pipeline integration + backward compatibility
+ targeted tests + V5 regression + full required regression: ALL PASS.
```

---

## Appendix A — Behavior Matrix

| Case | Input | Expected | Actual | Evidence | Result |
|---|---|---|---|---|---|
| FACTUAL | explicit / `historical-documentary` | FACTUAL | FACTUAL (EXPLICIT / MODE_MAP) | A1, A4, C1 | PASS |
| FICTION | explicit / `horror-fiction` | FICTION | FICTION | A2, A4b | PASS |
| FICTION targeted | FICTION + 1980s-hospital topics | OPTIONAL_TARGETED, stays FICTION | same + `fictionalCore:true` | B4, B5, C3 | PASS |
| HYBRID | `urban-legend-documentary` | HYBRID, REQUIRED | same | A4b, C2 | PASS |
| custom ambiguous | `custom-xyz`, no class | unresolved/review | `AMBIGUOUS_CONTENT_CLASS` | A5 | PASS |
| explicit class | FICTION + unmapped custom mode | explicit preserved | FICTION | A6 | PASS |
| class/mode conflict | FICTION + `historical-documentary` | review failure | `CONTENT_MODE_CLASS_CONFLICT` | A7 | PASS |
| YouTube factual | YT + documentary | FACTUAL/REQUIRED/plan | same, platform= youtube | integration matrix | PASS |
| TikTok factual | TT + documentary | FACTUAL/REQUIRED/plan | same, platform= tiktok | integration matrix | PASS |
| YouTube fiction | YT + `horror-fiction` | FICTION/NOT_REQUIRED/null plan | same | integration matrix | PASS |
| TikTok hybrid | TT + `urban-legend-documentary` | HYBRID/REQUIRED/plan | same | integration matrix | PASS |
| ambiguous title | `The Room 304 Mystery`, no mode | unresolved | `AMBIGUOUS_CONTENT_CLASS` | ambiguity test | PASS |

## Appendix B — Test Matrix

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `node tests/pipeline/test-content-class-router.js` | PASS | 34/34 asserts | PASS |
| `node tests/pipeline/test-research-planning.js` | PASS | 70/70 asserts | PASS |
| `node tests/pipeline/test-v5-preflight.js` | PASS | 47/47 asserts | PASS |
| `node tests/pipeline/test-editorial-quality.js` | PASS | 37/37 asserts | PASS |
| `node tests/pipeline/test-context-routing.js` | PASS | 34/34 asserts | PASS |
| `node scripts/checks/validate-schemas.js` | PASS | all schemas + semantics | PASS |
| `node scripts/checks/repository-structure-check.js` | PASS | `REPOSITORY_STRUCTURE_OK` | PASS |
| `node scripts/run-tests.js` (full) | 0 failed | 0 failed in 96.5s | PASS |

## Appendix C — Files Changed

| File | Change | Why | Tests |
|---|---|---|---|
| `lib/content-class.js` | NEW resolver | 1G.1A runtime | test-content-class-router.js |
| `lib/research-plan.js` | NEW gate/builder/validator/facade/persist | 1G.1B + 1G.1C runtime | test-research-planning.js |
| `tests/pipeline/test-content-class-router.js` | NEW 34 asserts | A-series coverage | self + run-tests.js |
| `tests/pipeline/test-research-planning.js` | NEW 70 asserts | B/C + integration coverage | self + run-tests.js |
| `core/WORKFLOW.md` | +2 runtime pointer lines | module discoverability | context-routing PASS |
