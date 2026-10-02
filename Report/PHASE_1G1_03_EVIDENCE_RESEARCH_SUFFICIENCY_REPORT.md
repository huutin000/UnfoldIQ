# PHASE 1G.1 — PROMPT 03
# EVIDENCE + RESEARCH SUFFICIENCY ENGINE REPORT

## 1. Status

```text
TASK_VALIDATION = PASS
SCOPE = V6 Creative Brief delta + 1G.1G Source Registry + 1G.1H Independence
      + 1G.1I Claim/Evidence Ledger + 1G.1J Verification + 1G.1K Contradictions/Unknowns
      + 1G.1L Sufficiency Gate
BASELINE: PRE-FLIGHT V5 + PROMPT 01 + PROMPT 02 all PASS and intact
NO paid services. NO Flow/Veo. NO publishing. NO credits consumed.
```

## 2. Scope

Evidence pipeline only: brief → plan linkage → acquired documents → source
records → independence/origin groups → candidate claims → ledger →
verification → contradictions/unknowns → sufficiency state + targeted gaps.
Stops at sufficiency. No Research Pack, no Script Evidence Gate, no 1G.3
humanizer/visual work, no GPT Researcher, no Prompt 04.

## 3. Baseline Read

Actually read (current versions): `AGENTS.md` router rules; `core/WORKFLOW.md`
(3B), `CONTENT_MODE.md`, `RESEARCH_QUALITY.md` (V5.1–V5.15), `EDITORIAL_VALUE.md`,
`STORYTELLING.md`, `CONTEXT_ROUTER.md`; platform index/profiles/overlays;
`content-mode`, `research-plan`, `research-brief` schemas (enums extracted by
execution: claimClass ×6, evidenceStatus ×4, sourceType ×8, corroboration ×5,
independence ×5); `lib/content-class.js`, `lib/research-plan.js` (patched,
see §7), `research-quality-check.js`, `v5-contract-check.js`
(`checkSufficiency` reused as boolean core); all four acquisition modules;
worker + requirements; all Prompt-01/02 tests; all three prior reports;
`package.json`, `run-tests.js`, both checks. Audited: atomic-write convention
(`providers/runtime/artifact-store.js` tmp+rename, reused); SHA-256 +
stable-stringify (`request-fingerprint.js`, reused); `validate-schemas.js`
hardcoded file list (extended); no V6/creative-brief files existed (only
unrelated `CREATIVE_DIRECTION.md`); research artifacts live at
`projects/<id>/research/` (extended in place).

## 4. Prompt 01/02 Behaviors Preserved

- Prompt 01: `test-content-class-router` 34/34, `test-research-planning` 70/70 —
  untouched logic; only additive `creativeBrief` input + `creativeBriefRef`
  output (absent without brief: byte-identical behavior asserted CB1).
- Prompt 02: full `research` domain 0 failed (46s); two Prompt-02 bugs found
  via Prompt-03 tests and fixed minimally: robots URL dropped the port
  (`u.hostname` → `u.host`); dedupe kept `#frag` and trailing-slash variants
  (`u.hash=""`, strip trailing `/`). URL safety/robots/bridge/browser/auth
  behavior otherwise unchanged; BM25-Vietnamese ceiling honored
  (fit = aid, raw = canonical fallback, asserted CE9/CE10).
- V5 governance: preflight 47/47, editorial 37/37, context-routing 34/34,
  schemas ALL PASS, structure OK. Full repo: 0 failed, 136.3s.

## 5. Roadmap V6 Delta Applied

Lightweight only: `schemas/creative-brief.schema.json` (12 canonical
concerns, required = version/briefId/audience/platform) +
`lib/research-evidence/creative-brief.js` (layered create:
channel < profile < overrides; stable hash ref; research-subset projection;
gap-filling plan-input fold) + one additive optional `creativeBriefRef` on
`research-plan.schema.json`. No subsystem, no UI, no 1G.3 work.

## 6. Creative Brief Contract

Required: `version`, `briefId`, `audience`, `platform (youtube|tiktok)`.
Optional: knowledgeLevel, videoType, targetDuration, viewerPromise,
primaryLearningGoal, narratorPersona, desiredFeeling, contentDensity,
visualLanguage, ctaGoal. Non-canonical platform and missing audience
rejected (`INVALID_BRIEF_PLATFORM`, `INVALID_BRIEF`, `CREATIVE_BRIEF_INVALID`).

## 7. Creative Brief → Research Plan Compatibility

`planResearch`/`buildResearchPlan` accept optional `creativeBrief`
(schema-validated at the boundary): explicit plan input wins (repo
convention), brief fills audience/platform gaps, plan carries only
`creativeBriefRef {briefId, briefHash(16), briefVersion}` — no duplicated
mutable values. Brief research context (knowledgeLevel, targetDuration,
promise, goal, density) stays in the persisted brief artifact, retrievable
through the ref. Brief never touches evidence status (CB10: identical
research fields ⇒ identical plan modulo ref; plans carry no verdict fields).
Pre-V6 projects: no ref key, unchanged output.

## 8. Source Registry

`lib/research-evidence/source-registry.js`: `registerSource` maps
AcquiredDocument + search provenance + plan-agnostic metadata to a
`sourceRecord` (all §9 fields: ids/URLs, title/publisher/author/publishedAt
nullable-never-fabricated, sourceType+reason, independence+originGroup,
search query/provider/rank, hashes, version chain, route/crawler/fitQuery,
warnings). Bodies stored once under `research/sources/<id>/content-<hash>.md`
(by ref, never duplicated). Search rank kept as discovery order; warnings
(truncation, empty fit, caller notes) preserved verbatim.

## 9. Source Identity / Version Behavior

`sourceId = src-<sha12(canonicalUrl)>` (canonical = Prompt-02 normalized
URL: tracking params, fragments, case, trailing slash folded). Same
canonical + same hash ⇒ deduplicated same record. Same canonical + new hash
⇒ version appended with `supersedes` lineage; current moves; history kept;
`markStaleOnSourceChange` flags dependent claims `needsReevaluation`
(E2E-4 proven). Same hash across URLs ⇒ distinct identities (no title
merge) + duplicate signal for independence. Silent overwrites impossible by
construction (append-only versions + atomic writes).

## 10. Source Type / Authority

V5 conceptual taxonomy (PRIMARY/OFFICIAL/REPUTABLE_SECONDARY/COMMUNITY/
SOCIAL/FOLKLORE/UNKNOWN) with forward map from brief lowercase types.
Conservative by default: insufficient evidence ⇒ UNKNOWN with reason
(SR7); OFFICIAL only via configured official domains, document
self-identification + corroborating location, or mapped brief types.
Explainable `classificationReason` on every record. No numeric truth scores
anywhere (grep-verified).

## 11. Source Independence

`lib/research-evidence/independence.js`: pairwise judgements over exact hash,
canonical/origin links, citation/syndication markers, publisher + similarity.
UNKNOWN default; INDEPENDENT only from evidence. `evaluateIndependence`
assigns shared `originGroup`s and propagates chains. Verification counts
independent origin groups, never URLs.

## 12. Near-Duplicate / Copy-Chain Detection

Bounded deterministic: lowercase/URL-strip/punctuation-fold → 5-word
shingles (first 20k chars) → Jaccard ≥ **0.75** (documented rationale:
above boilerplate noise, below lightly-rewritten syndication; calibrated
empirically: true rewrite 0.771, independent pair 0.000). No embeddings, no
paid API, no vector DB. Signal only — combined with publisher/citation
evidence for SYNDICATED vs COPY_CHAIN vs DERIVED.

## 13. Origin Groups

`og-<sha12>` shared by derived/syndicated/copy-chain members (earliest
origin or similarity-cluster seed). Solo/unknown sources get solo groups
that never count as independent. `countIndependentGroups` counts only
INDEPENDENT-status groups — the 3-URL copy chain counts 0 (I1 proven).

## 14. Claim / Evidence Ledger

`claim-ledger.js`: stable `clm-<sha12(text|questions)>` ids (idempotent
upsert, evidence attach without duplication); evidence links validated
against known sourceId + known version hash (`EVIDENCE_LINK_BROKEN`
otherwise); excerpts ≤280 chars with locators (CE8); risk-aware
`evidence-policy-1.0.0` (critical/high need 2 groups or primary; medium/low
need 1 — no universal two-source rule); `questionCoverage` per question id.

## 15. Analysis Provider Boundary

`analysis-exchange.js`: `createAnalysisRequest` (bounded 4000-char excerpt,
fit-preferred with `fitWeakFallback` flag + raw fallback, always traceable
to sourceId + contentHash) → agent/model → `normalizeAnalysisResponse`
(schema + semantic validation; invalid candidates rejected with codes;
free-form non-array ⇒ `ANALYSIS_PROVIDER_UNAVAILABLE`, never a prose PASS).
Switching OpenCode/Antigravity/model cannot change the ledger schema.
Live proof: analyst authored 5 structured candidates from bounded acquired
passages; code accepted 5, rejected 0, then ledger/verify/sufficiency ran
deterministically (§31–§32).

## 16. Evidence Provenance

Every claim link: sourceId + exact contentHash version + locator + short
excerpt. Every analysis request: sourceId + contentHash + excerptScope
(fit/raw) + truncation flag. Every verdict: policy version + plan/brief
refs + evaluatedAt. Bodies referenced by path, never pasted into records,
logs, reports, or snapshots (private/fixture bodies excluded from evidence
by rule; live evidence files hold metadata only).

## 17. Cross-source Verification

`verification.js`: counts distinct INDEPENDENT origin groups behind
supporting evidence; derived-copy agreement never increments the count
(CE5/E2E-1); PRIMARY/OFFICIAL support ⇒ PRIMARY_CONFIRMED (preferred when
material, but recorded as what the source establishes — official ≠
auto-true, no override of the claim text); ≥2 groups ⇒
MULTI_SOURCE_CONFIRMED; 1 ⇒ SINGLE_SOURCE; independent contradiction ⇒
CONFLICTED (framed, never flattened); no support ⇒ UNSUPPORTED. Search rank
and fit inclusion ignored as evidence (no rank inputs exist in the
verifier — structural guarantee).

## 18. Contradictions

`contradictions.js`: records need ≥2 claimIds + ≥1 sourceId + description
(stable `ctr-` ids, re-report deduplicates); statuses
OPEN/FRAMED_AS_DISPUTED/RESOLVED_WITH_REASON/BLOCKING; resolution requires
≥20-char reason + prevailingClaimId + evidenceNote (drama is not a reason —
C3 rejects reason-only and citation-less resolutions); BLOCKING needs human
override; non-critical may stay FRAMED (C5 ⇒ SUFFICIENT preserved).

## 19. Unknowns

Records need description (stable `unk-` ids); materiality
critical/material/non-material; settle ANSWERED/ACCEPTED only. Critical
question without answer ⇒ material unknown ⇒ NEEDS_MORE_RESEARCH (U1);
answered ⇒ settlable (U2); non-material open ⇒ SUFFICIENT still reachable
(U3 proven with full-satisfaction state).

## 20. Research Sufficiency Logic

`sufficiency.js` computes inspectable factors (per-question coverage,
policy-checked important claims, blocking contradictions, material unknowns,
per-claim freshness, parsed budget, stop state, critical failures) then maps
through PRE-FLIGHT `checkSufficiency` (reused boolean core) and enriches
with targeted gaps. Rationale is a factor listing, never an opinion.
Freshness: current-state questions (pattern or explicit ids) need evidence
within 90 days (configurable); evergreen honors old primaries (S8: 2015 RFC
⇒ SUFFICIENT). Budget parsed from plan string (`maxQueries/maxSources`);
unparseable ⇒ remaining + warning (no silent enforcement claim).

## 21. NEEDS_MORE_RESEARCH Loop

Emits `missingQuestions + recommendedQueries + recommendedSourceTypes`
(from plan priorities), `missingEvidence` (claim + needed corroboration),
`weakClaims`, `unresolvedContradictions`, `staleSources`. E2E-3 proves the
loop: 1-question state ⇒ NEEDS_MORE_RESEARCH with all three targeted fields
⇒ add two independent sources (no touched claims duplicated, ledger 2
claims) ⇒ re-evaluate ⇒ SUFFICIENT. Blind full restart forbidden by design
(additive inputs only).

## 22. BLOCKED Behavior

Exact blocker preserved: critical acquisition failure (`AUTH_REQUIRED`
without access + exhausted budget ⇒ BLOCKED, S6), budget-exhausted material
gap ⇒ BLOCKED (S10, never downgraded to keep moving), BLOCKING
contradiction (S5). `blocker` string + `BLOCKED` decision persisted.

## 23. Freshness / Budget / Stop Criteria

Consumed from the Prompt-01 plan, not reinvented: freshnessRequirement
drives per-question staleness (S7 stale-current ⇒ NEEDS_MORE_RESEARCH +
staleSources; S8 evergreen-primary ⇒ SUFFICIENT); researchBudget string
parsed for remaining/runway (S10); stopCriteriaReached derived (no material
gap left). No endless auto-research: gaps + exhausted budget ⇒ BLOCKED.

## 24. Vietnamese RawMarkdown Fallback

Prompt-02 ceiling honored structurally: `excerptScope` records fit vs raw;
empty/weak fit ⇒ `fitWeakFallback: true`, raw excerpt used (CE9/CE10 with
real Vietnamese body: excerpt carries evidence, no false UNSUPPORTED).
Crawl4AI itself untouched.

## 25. Persistence / Idempotency / Versioning

`evidence-store.js` over `artifact-store.writeArtifactAtomic` (tmp+rename;
failure leaves old artifact readable): `research/creative-brief.json`,
`source-index.json`, `sources/<id>/*.md`, `claims.json`,
`contradictions.json`, `unknowns.json`, `sufficiency.json` — extending (not
duplicating) the `research/` tree; no competing handoff (Pack belongs to
Prompt 04). Idempotent re-register/re-report (SR1/C2/U2/E2E-3: no
uncontrolled duplicates). Versions fingerprinted: content hashes, brief
hash, `evidence-policy-1.0.0`, `policyVersion` + `evaluatedAt` on every
evaluation (1H manifest explicitly not built).

## 26. Security / Prompt Injection Boundary

Content stays data through analysis: excerpts are validated strings, never
executed (Prompt-02 S7/B6 intact; new modules contain no eval/exec of
content — structural property). Sanitized observability only
(plan/brief-ref/source/host/hash/group/claim/state/gap-counts/policy).
Authenticated-body rule: registry may reference authorized local content;
reports/evidence/logs carry metadata only (live evidence = 3 metadata JSONs;
leak scan clean). Fixture creds live only in `tests/fixtures/` (§54-allowed).

## 27. Tests Added

`tests/research/`: `test-creative-brief.js` CB1–CB11 (18 asserts),
`test-source-registry.js` SR1–SR8 (27), `test-independence.js` I1–I5 (12),
`test-claim-ledger.js` CE1–CE10 + exchange + VI (20),
`test-contradictions.js` C1–C5 + U1–U3 (14), `test-sufficiency.js` S1–S10
(19), `test-evidence-e2e.js` E2E-1–E2E-4 (22). Shared calibrated fixtures:
`tests/fixtures/evidence-fixtures.js`. New total: **132 asserts**.
`validate-schemas.js`: 3 schemas + 9 instance assertions.

## 28. Copy-chain Fixture E2E

E2E-1: original + exact copy + light rewrite (3 URLs, 2 publishers) ⇒ 3
pairwise judgements, ≤1 independent group, claim with all-3-URL support ⇒
**not** MULTI_SOURCE_CONFIRMED ⇒ NEEDS_MORE_RESEARCH. Central invariant
proven end-to-end (mirrors I1 at unit level).

## 29. Contradiction Fixture E2E

E2E-2: preserve-method vs rewrite-to-GET (two independent fixtures) ⇒
disputed claim CONFLICTED, contradiction record created, sufficiency ≠
SUFFICIENT with the contradiction named in gaps. No side auto-chosen.

## 30. Targeted Research Loop E2E

E2E-3: one-question coverage ⇒ NEEDS_MORE_RESEARCH with missingQuestions +
recommendedQueries + recommendedSourceTypes ⇒ two additive independent
sources ⇒ SUFFICIENT, ledger exactly 2 claims (no restart, no duplicates).
E2E-4 covers persist/reload/schema-validate + version-append + stale-marking.

## 31. Live Public Research Validation

LIVE_PUBLIC, benign technical fact (HTTP 308, plan `live-ev-1`,
technical-explainer, 4 critical questions): agent web search (10 + 8 raw
results) → normalized 2 → acquired via Prompt-02 layer (RFC 15,112 raw /
13,462 fit chars; MDN 60,310 / 4,255) → registered (`src-1114d819459b`
OFFICIAL via configured domain, hash `1ffad4aa74b2`; `src-048e66b5112e`
UNKNOWN-conservative, hash `359cf28aed3b`) → independence INDEPENDENT both
ways (Jaccard 0.00, genuinely separate authorship) → 5 analyst-structured
candidates validated (0 rejected) → verification → sufficiency run 1:
NEEDS_MORE_RESEARCH (split phrasing, targeted missingEvidence gap) → analyst
normalized one proposition → run 2: critical claim PRIMARY_CONFIRMED with 2
groups, 4/4 questions, SUFFICIENT, zero gaps. Evidence:
`Report/evidence/research-evidence-live/` (plan, index, sufficiency —
metadata only, leak-scanned clean).

## 32. Analysis-provider Live Validation

Proven per §66 without pretending: request contract
(`createAnalysisRequest` with excerptScope/traceability) → analyst response
(5 structured candidates authored from bounded acquired passages, excerpts
verbatim ≤280) → schema validation (AJV) → semantic validation
(`normalizeAnalysisResponse`: 5 accepted/0 rejected; free-form would fail) →
ledger/verify/sufficiency deterministic thereafter. Deterministic fixture
path covered in-suite (CE9/CE10/E2E-3); live run used the current agent as
the exchange analyst, documented as such.

## 33. Bugs Found

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Robots tests failed open | `checkRobots` built URL from `hostname`, dropping the port (Prompt-02 module) | `u.host`; Prompt-02 suite still green |
| 2 | S4 dedupe failed | Kept `#frag`; `/docs/` vs `/docs` (Prompt-02 module) | Clear hash; strip trailing `/` |
| 3 | `/flaky` recovery empty | Crawl4AI anti-bot rejects ~80-byte 200s (Prompt-02 fixture) | Realistic-length fixture page |
| 4 | SR1 same-source split | Fixture used unreal `utm=x` (real params are `utm_source=`) | Fixture realism fix |
| 5 | Stray `register trio()` | Editing slip in new test | Removed before first run |
| 6 | Interpretive corroboration cap | Over-clever special case in verifier | Uniform group counting; caveats stay on claimClass axis |
| 7 | U3 vacuous assertion | Accepted either decision | Rebuilt as full-satisfaction SUFFICIENT proof |
| 8 | Live run-1 gap | Analyst split one fact into two wordings | Normalized proposition ⇒ SUFFICIENT (documents analyst-linking effect honestly) |

Probes only: PowerShell pipe BOM / inline quoting (moved to files, no source impact).

## 34. LOG-FIRST Fix Iterations

Every failure traced from output to stage: robots fetch landing on port 80
(logged URL) → one-token fix; normalizer output inspected → two-line fix;
anti-bot message named the byte heuristic → fixture-side fix; Jaccard probe
(0.645 → 0.771) before freezing fixtures/threshold. No architectural
rewrites; rerun targeted suite after each fix, domain after each file.

## 35. Commands Executed

```text
node scripts/checks/validate-schemas.js                          -> ALL PASS (3 new schemas + 9 instances)
node tests/research/test-{creative-brief,source-registry,independence,claim-ledger,contradictions,sufficiency,evidence-e2e}.js -> ALL PASS (132 asserts)
node tests/pipeline/test-content-class-router.js                 -> 34/34
node tests/pipeline/test-research-planning.js                    -> 70/70
node scripts/run-tests.js research                               -> 0 failed
node tests/pipeline/test-v5-preflight.js                         -> 47/47
node tests/pipeline/test-editorial-quality.js                    -> 37/37
node tests/pipeline/test-context-routing.js                      -> 34/34
node scripts/checks/repository-structure-check.js                -> OK
node scripts/run-tests.js (full)                                 -> 0 failed, 136.3s
live drivers (search x2, acquire x4, analyze x2)                 -> LIVE PASS (see §31)
```

## 36. Targeted Test Results

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-creative-brief.js` | PASS | 18/18 (CB1–CB11) | PASS |
| `test-source-registry.js` | PASS | 27/27 (SR1–SR8) | PASS |
| `test-independence.js` | PASS | 12/12 (I1–I5) | PASS |
| `test-claim-ledger.js` | PASS | 20/20 (CE1–CE10) | PASS |
| `test-contradictions.js` | PASS | 14/14 (C1–C5, U1–U3) | PASS |
| `test-sufficiency.js` | PASS | 19/19 (S1–S10) | PASS |
| `test-evidence-e2e.js` | PASS | 22/22 (E2E-1–E2E-4) | PASS |

## 37. Prompt 01 Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-content-class-router.js` | PASS | 34/34, FACTUAL/FICTION/HYBRID intact | PASS |
| `test-research-planning.js` | PASS | 70/70, gates/plans intact | PASS |

## 38. Prompt 02 Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `run-tests.js research` | 0 failed | 0 failed (14 suites: 7×P02 + 7×P03) | PASS |

SearchProvider, DEEP deferral, URL safety, bridge, robots/rate-limit,
browser, auth all green; no new live crawl needed (acquisition untouched
apart from two minimal fixes, both covered by P02 suites).

## 39. V5/V6 Governance Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-v5-preflight.js` | PASS | 47/47 (incl. sufficiency-core agreement) | PASS |
| `test-editorial-quality.js` | PASS | 37/37 | PASS |
| `test-context-routing.js` | PASS | 34/34 (no new context deps) | PASS |
| `validate-schemas.js` | PASS | 3 new schemas + plan-ref instances | PASS |
| `repository-structure-check.js` | PASS | no root/throwaway files | PASS |

No V6 contract files pre-existed; the three added schemas validate.

## 40. Full Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `node scripts/run-tests.js` | 0 failed | 0 failed, all domains, 136.3s | PASS |

## 41. Files Created

| File | Why | Tests |
|---|---|---|
| `schemas/creative-brief.schema.json` | V6 contract | validate-schemas + CB |
| `schemas/source-index.schema.json` | 1G.1G contract | validate-schemas + SR/E2E-4 |
| `schemas/evidence-state.schema.json` | 1G.1I–1G.1L contract (anyOf 4 files) | validate-schemas + E2E-4 |
| `lib/research-evidence/creative-brief.js` | V6 runtime + plan fold | CB1–CB11 |
| `lib/research-evidence/source-registry.js` | 1G.1G runtime | SR1–SR8 |
| `lib/research-evidence/independence.js` | 1G.1H runtime | I1–I5 |
| `lib/research-evidence/analysis-exchange.js` | 1G.1I boundary | CE9–CE10, live §32 |
| `lib/research-evidence/claim-ledger.js` | 1G.1I runtime | CE1–CE8 |
| `lib/research-evidence/verification.js` | 1G.1J runtime | CE2–CE7, E2E-1/2 |
| `lib/research-evidence/contradictions.js` | 1G.1K runtime | C/U, E2E-2 |
| `lib/research-evidence/sufficiency.js` | 1G.1L runtime | S1–S10, E2E-3 |
| `lib/research-evidence/evidence-store.js` | Atomic persist/load | E2E-4 |
| `tests/research/test-creative-brief.js` | CB suite | self |
| `tests/research/test-source-registry.js` | SR suite | self |
| `tests/research/test-independence.js` | I suite | self |
| `tests/research/test-claim-ledger.js` | CE suite | self |
| `tests/research/test-contradictions.js` | C/U suites | self |
| `tests/research/test-sufficiency.js` | S suite | self |
| `tests/research/test-evidence-e2e.js` | §59–§61 E2Es | self |
| `tests/fixtures/evidence-fixtures.js` | Calibrated fixtures | all above |
| `Report/evidence/research-evidence-live/*` (3) | Sanitized live evidence | manual |
| `Report/PHASE_1G1_03_EVIDENCE_RESEARCH_SUFFICIENCY_REPORT.md` | This report | — |

## 42. Files Modified

| File | Change | Why | Tests |
|---|---|---|---|
| `schemas/research-plan.schema.json` | +optional `creativeBriefRef` | V6 linkage without duplication | validate-schemas + CB2 |
| `lib/research-plan.js` | Accept `creativeBrief`, fill gaps, attach ref | V6 compatibility, backward compatible | Prompt-01 70/70 + CB |
| `lib/research-acquisition/acquisition.js` | Robots URL keeps port | Bug §33-1 | robots suite |
| `lib/research-acquisition/search-provider.js` | Dedupe strips hash/trailing slash | Bug §33-2 | S4 |
| `scripts/checks/validate-schemas.js` | +3 schemas, +9 instances | Governance | self PASS |
| `tests/fixtures/research-servers.js` | Fuller `/flaky` body | Bug §33-3 | ratelimit suite |
| `core/WORKFLOW.md` | +1 evidence-runtime pointer (3B) | Discoverability | context-routing PASS |

## 43. Files Deleted

None.

## 44. Scope Check

Static audit of `lib/research-evidence/`: zero hits for Pack/script/
humanizer/beat/scene/shot/visual-grammar/compiler/GPT/Flow/Veo/voice
(one comment explicitly disclaims Pack production). No `research-pack.md`
generated; no script/story artifacts; no media; no 1G.2+; no secrets
(evidence leak-scan clean; fixture creds confined to `tests/fixtures/`).

## 45. Remaining Issues

None blocking. Known ceilings: Jaccard threshold is heuristic (signal, not
proof); analyst proposition-linking affects grouping (demonstrated live —
analyst discipline matters); budget parsing covers the Prompt-01 string
format; sessionStorage-only auth out of scope; robots fail-open logged.

## 46. Next Allowed Step

```text
PHASE 1G.1 — PROMPT 04
RESEARCH → STORY HANDOFF
(1G.1M Research Pack, 1G.1N Script Evidence Gate, 1G.1O Editorial Strategy /
Narrative Brief, 1G.1P Storytelling Handoff)
```
Not started in this task.

## 47. Final Conclusion

```text
TASK_VALIDATION = PASS
V6 Creative Brief + Source Registry + Independence + Claim/Evidence Ledger
+ Verification + Contradictions/Unknowns + Sufficiency + fixture E2Es
+ live public evidence validation + Prompt 01/02 + governance + full
regression: ALL PASS.
```

---

## Appendix A — Behavior Matrix

| Case | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| Creative Brief compatibility | link + gap-fill, old projects intact | ref attached; no-ref output identical | CB1/CB2/CB10 | PASS |
| same source/version | deduplicate | same id, `deduplicated` | SR1 | PASS |
| same URL changed content | version + lineage + stale flags | `supersedes` chain, 1 claim marked | SR2/E2E-4 | PASS |
| exact duplicate URLs | duplicate signal, independent count 0 | COPY_CHAIN ×3, 1 group | I1/E2E-1 | PASS |
| near-duplicate copy chain | DERIVED/SYNDICATED/COPY_CHAIN | 0.771 ≥ 0.75 flagged | I2/E2E-1 | PASS |
| independent sources | INDEPENDENT, count 2 | Jaccard 0.00 | I4/live | PASS |
| UNKNOWN independence | stays UNKNOWN | thin content, domains differ | I5 | PASS |
| supported claim | traces to versioned source | stable `clm-` + verified links | CE1 | PASS |
| single-source claim | SINGLE_SOURCE, no inflation | 1 group counted | CE2/live | PASS |
| conflicting claim | CONFLICTED + record persists | dispute framed, gap named | C4/E2E-2 | PASS |
| critical unknown | blocks SUFFICIENT | NEEDS_MORE_RESEARCH | U1 | PASS |
| NEEDS_MORE_RESEARCH | targeted gaps | questions/queries/types/evidence | S2/E2E-3/live-run-1 | PASS |
| BLOCKED | exact blocker | budget/auth blockers | S6/S10 | PASS |
| SUFFICIENT | all factors green + rationale | 4/4, policy met, rationale | S1/live-run-2 | PASS |
| Vietnamese raw fallback | raw excerpt, no false gap | `fitWeakFallback`, excerpt kept | CE9/CE10 | PASS |
| live public research | engine processes real sources | RFC OFFICIAL + MDN, SUFFICIENT | §31/live JSONs | PASS |

## Appendix B — Test Matrix

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-creative-brief.js` | PASS | 18/18 | PASS |
| `test-source-registry.js` | PASS | 27/27 | PASS |
| `test-independence.js` | PASS | 12/12 | PASS |
| `test-claim-ledger.js` | PASS | 20/20 | PASS |
| `test-contradictions.js` | PASS | 14/14 | PASS |
| `test-sufficiency.js` | PASS | 19/19 | PASS |
| `test-evidence-e2e.js` | PASS | 22/22 | PASS |
| Prompt-01 ×2 | PASS | 34 + 70 | PASS |
| V5/V6 governance ×3 + schemas + structure | PASS | 47 + 37 + 34 + ALL + OK | PASS |
| `run-tests.js research` | 0 failed | 0 failed | PASS |
| `run-tests.js` full | 0 failed | 0 failed, 136.3s | PASS |

## Appendix C — Live Evidence (metadata only)

```text
plan:    live-ev-1, technical-explainer, 4 critical questions, budget 12/20
search:  agent-exchange; RFC query 10 results, MDN query 8 results; 2 normalized
sources: src-1114d819459b OFFICIAL/INDEPENDENT hash 1ffad4aa74b2 (RFC 7538, 15112 raw)
         src-048e66b5112e UNKNOWN/INDEPENDENT  hash 359cf28aed3b (MDN 308, 60310 raw)
analysis: 5 structured candidates accepted / 0 rejected (validated, not prose-trusted)
run 1:   NEEDS_MORE_RESEARCH — critical claim split across wordings (targeted gap named)
run 2:   SUFFICIENT — critical claim PRIMARY_CONFIRMED ×2 groups, 4/4 questions, rationale recorded
discipline: engine reports source-says + support classification, never absolute truth
```
