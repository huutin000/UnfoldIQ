# PHASE 1G.1 — PROMPT 04
# RESEARCH → STORY HANDOFF REPORT

## 1. Status

```text
TASK_VALIDATION = PASS
SCOPE = 1G.1M Research Pack + 1G.1N Script Evidence Gate + 1G.1O Editorial/Narrative Brief
      + 1G.1P Storytelling Handoff + Story Draft + Evidence Audit
BASELINE: PRE-FLIGHT V5 + PROMPT 01 + PROMPT 02 + PROMPT 03 all PASS and intact
STORY DRAFT ≠ FINAL SPOKEN SCRIPT (1G.3 owns humanization; no cadence/TTS work here)
NO paid services. NO Flow/Veo. NO credits consumed.
```

## 2. Scope

Research-to-story handoff only: SUFFICIENT evidence → Pack → Evidence Policy →
Narrative Brief → structured Story Draft → Evidence Audit (+ bounded revision)
→ HANDOFF READY FOR 1G.3. FACTUAL, HYBRID (labels preserved), FICTION
(no pack, no fake refs; targeted facts keep evidence). No Pack-merely-docs:
runtime-generated, hashed, stale-tracked.

## 3. Baseline Read

Actually read (current versions): `AGENTS.md`; `core/WORKFLOW.md` (3B runtime
lines), `CONTENT_MODE.md`, `RESEARCH_QUALITY.md`, `EDITORIAL_VALUE.md`,
`STORYTELLING.md`, `CREATIVE_DIRECTION.md`, `CONTEXT_ROUTER.md`;
platform index/profiles/overlays (YouTube script-prompt contract is
documentation-only; inputs already name Pack + Editorial Strategy);
all six schemas incl. `source-index` + `evidence-state` ($defs/enums reused);
`lib/content-class.js`, `lib/research-plan.js`; all acquisition + all nine
evidence modules; `context/ROUTES.yaml` (+ `DOC_CATALOG.yaml` checked);
all Prompt-01/02/03 tests; all three prior reports; `package.json`
(runner auto-discovers `tests/<domain>`), both checks. Discovered: NO
Script Builder / prompt-template / script-agent runtime exists (only
governance docs + static pilot `script.json` beats + `editorial-strategy.json`,
whose shapes were reused: beats-with-claimRefs, valueTypes/insightChain
naming); provider exchange pattern = structured request/response + validation
(`analysis-exchange.js`, reused as the model); atomic writes + SHA-256
fingerprint utilities (reused); Prompt-03 live evidence present
(`Report/evidence/research-evidence-live/`).

## 4. Existing Architecture Reused

| Reused | How |
|---|---|
| `providers/runtime/artifact-store.js` tmp+rename | All pack/story persistence |
| `request-fingerprint.js` stable-stringify + SHA-256 | packId/packHash/draftId/briefId |
| `research-evidence/verification.js` `hasPrimarySupport` | Pack primary grouping |
| `research-acquisition/search-provider.js` URL normalize | Source identity (unchanged) |
| `analysis-exchange` pattern | StoryDraftRequest/response + validation |
| Pilot `script.json` beats + `editorial-strategy.json` fields | Draft sections + brief naming |
| `tests/fixtures/` + `run-tests.js` domains | `story-fixtures.js`, `tests/story/`, `test:story` |

## 5. Research Pack Architecture

`lib/research-story/research-pack.js`: readiness gate + deterministic builder
(plan + brief + registry + ledger + contradictions + unknowns + sufficiency;
analyst-asserted facets/quotes/labels validated, never inferred) + Markdown
projection + hash/version + stale detection. Pack ≠ Script enforced
structurally (no narration fields exist).

## 6. Research Pack Readiness Gate

`checkReadiness`: SUFFICIENT → SCRIPT_READY; NEEDS_MORE_RESEARCH →
`RESEARCH_NOT_SUFFICIENT` (explicit, RP2); BLOCKED → `RESEARCH_BLOCKED` with
blocker (RP3). FICTION → `NO_PACK_FOR_FICTION` via `packNeeded` (X1). No
ready-pack to keep the pipeline moving.

## 7. Research Pack Structure

`research-pack.json`: packId/packHash/version, project/class/mode,
creativeBriefRef, plan ref, policy version, sufficiency ref, generatedAt,
objective, viewerContext; verifiedFacts / primarySourceFacts /
independentlyCorroboratedFacts / derivedContext / conflictingClaims /
unverifiedClaims / timeline / people / places / usefulContext / unknowns /
sourceLimitations / sourceRefs (pointers only). `research-pack.md`: all §11
sections with `[claim:]/[source:]` trace tokens (RP5).

## 8. Claim / Source Traceability

Every entry: claimId (`clm-` stable), statement, sourceIds, contentHashes
(exact versions), evidence/corroboration/class statuses, caveat, optional
HYBRID classification + verifiedQuotes. RP4 asserts all three axes on every
entry across four sections. Trace matrix in Appendix A.

## 9. Pack Compaction / Token Efficiency

Storytelling consumes Narrative Brief + Policy + compact Pack selections
(brief progression binds only selected claims); full bodies stay behind refs
(RP7: no 200-char body span inside pack JSON); raw pages never loaded.
Evidence is never deleted to shrink context (omission rules in §19).

## 10. Pack Versioning / Stale Detection

`packHash` over topic + per-claim (id, corroboration, evidence, reeval flag)
+ contradiction/unknown (id, status) + decision + policy + briefHash +
facets/quotes/labels + version (RP8: rebuilds identical). `isPackCurrent`
and `checkDownstreamCurrency` mark pack/policy/brief/draft/audit stale on
any evidence change or sufficiency regression (RP9, STALE test).

## 11. Script Evidence Gate

`script-evidence-gate.js`: `buildEvidencePolicy` outputs gateId/version,
pack ref, allowed/restricted/disputed/forbidden lists, requiredAttributions
(with publisher + markers), requiredQualifiers (semantic kinds), HYBRID
fictionalization boundaries, unknowns, targeted-fact claims. `usageFor`
answers allow/restrict/dispute/forbid per claim. Gate writes no prose.

## 12. Factual Claim Policy

PRIMARY/MULTI allowed as fact (EG1/EG2); SINGLE high-impact →
`SINGLE_SOURCE_ATTRIBUTED` restriction, never a global ban (EG3; low
single-source primary facts stay usable); CONFLICTED → frame-or-omit (EG4);
UNSUPPORTED/UNVERIFIED → forbidden (EG5); HYPOTHESIS/SPECULATION →
mandatory `uncertain` qualifier (EG6/EG9). No universal two-source rule.

## 13. Hybrid Classification Policy

Labels validated at pack build (unknown claim/label rejected). Gate:
FOLKLORE→as-folklore (EG7), TESTIMONY→attributed (EG8), SPECULATION→qualified
(EG6/EG9), FICTIONALIZED_ELEMENT→forbidden-as-documented (EG10). Promotion
without evidence/state transition is structurally unrepresentable (labels
travel on entries → sections → audit).

## 14. Fiction Evidence Boundary

Plot carries zero claimRefs and zero citation tokens (X2, asserted).
Targeted real-world details attach evidence refs only when the claim has
policy standing; otherwise brief construction fails (X4). Whole-story
factual citation never imposed.

## 15. Required Attribution / Qualifiers

Semantic kinds (`approximate/reported/uncertain` with word lists), not
brittle exact strings: audit accepts equivalent meaning (approximate-words
list). Attribution = publisher name or according-to/reported/witness markers.
Certainty levels expressed per claim; escalation blocked (F3).

## 16. Editorial Strategy Architecture

`narrative-brief.js`: deterministic builder over pack + policy + brief +
platform + analyst-supplied angle/question/insight/payoff (angle is required
input — the builder never invents editorial positions). Default progression
is question-ordered (viewer order, never source order); explicit override
supported with per-claim pack validation.

## 17. Narrative Brief

Fields per §25 (briefId stable hash, class/mode, audience/platform/duration/
promise/goal/feeling/density, question/angle/insight/hook/progression/payoff/
ending/CTA, selected/omitted/disputed/unknowns/attributions/boundary/
constraints) + packRef + scopeEstimate (section-count estimate, explicitly
not a word count, NB8). Story context + targeted facts for FICTION.

## 18. Viewer Promise / Audience / Platform Integration

Brief promise preserved verbatim; rewriting it is rejected (NB1). Hook must
use a pack-resident, non-forbidden claim (or premise for fiction). Platform
changes presentation only: identical evidence selection across youtube/tiktok
(NB9). Duration/density scale the section estimate, never word counts (NB8,
§49 honored).

## 19. Claim Selection / Omission

Default selection = verified + primary + corroborated + derived (conflicts
and unverified excluded); explicit selection validated ⊆ Pack (NB5/NB6).
Omission allowed except material conflicts, which cannot vanish silently
(NB7). Angle changes emphasis path, never the evidence set (NB10).

## 20. Contradiction / Unknown Handling

Material conflicts auto-land in `disputesToPreserve` and render as framed
dispute sections (F6, E2E-2); material unknowns land in `unknownsToPreserve`.
Narrative may omit non-essentials or narrate uncertainty, never invent
answers (unknowns step text is fixed honest boilerplate) or silently pick a
side (C4/E2E-2, live run has none — reported as such).

## 21. Existing YouTube Script Integration

No Script Builder runtime existed to migrate — only the overlay's
documentation contract, which already specifies exactly this input shape
(`contentClass + contentMode + Research Pack + Editorial Strategy +
constraints`). Prompt-04 implements that contract for the first time; no
bundle rewritten, prompt provenance versioned (`TEMPLATE_VERSION`,
`AUDIT_VERSION`, brief/draft hashes).

## 22. TikTok Shared-Core Integration

Same core handoff (NB9 proves identical selection); no TikTok Research Pack
cloned; TikTok overlay influences opening/compression/pacing via brief
platform + density, evidence rules identical (§46–§48 honored by construction:
no platform branch exists in gate/audit code).

## 23. Storytelling Runtime

`story-draft.js`: `StoryDraftRequest` (brief + pack + policy + platform +
executor) → deterministic composer (production path, §86) or
`agent-exchange` provider sections through identical gates. No model
hard-coded; schema never varies by provider.

## 24. Structured Story Draft

Sections carry sectionId/purpose/draftText/claimRefs/classificationRefs/
attribution checklist/storyFunction; draft carries stable `drf-` id,
template version, brief/pack refs, provider id. Markdown projection for
humans. Empty-text sections are dropped, never emitted; zero renderable
sections fails loudly (found via F6 debugging, fixed).

## 25. Story Draft Evidence Audit

`story-audit.js`: per-section checks against Pack + Policy — unknown refs,
orphan factual sections, forbidden/disputed misuse, missing attribution,
dropped qualifiers, numbers/quotes without evidence paths (trailing quote
punctuation tolerated via normalization), classification relabeling/mismatch.
States PASS / NEEDS_REVISION / BLOCKED (fabrication/classification/audit
failures block). Optional `semanticCheck` hook for beyond-deterministic
comparison (unused by default; deterministic suffices for PASS).

## 26. Revision Loop

`reviseDraft`: only failing sections touched (others byte-identical,
asserted), evidence-aware sentence filter (drops only unevidenced
number/quote sentences — the naive drop-everything version was caught by
test and fixed), policy transforms from data only, empty results drop the
section, `maxRevisions` default 3, surviving blocking issues escalate to
BLOCKED. REV test converges in 1 attempt; REV-BLOCKED never false-PASSES.

## 27. FICTION Route

Premise → (NOT_REQUIRED: brief → draft, X1/X2/X5) or (OPTIONAL_TARGETED:
targeted evidence → gate → brief → draft with refs only on factual detail,
X3/X4). E2E-FICTION green with zero fake sources.

## 28. HYBRID Route

Labels flow pack → policy → brief boundary → section metadata → audit
(H1–H6 all green; E2E-HYBRID sees FACT/FOLKLORE/TESTIMONY/SPECULATION in
draft metadata; fictionalized beat forbidden-as-fact with explicit boundary).

## 29. FACTUAL Route

SUFFICIENT → pack → policy → brief → 6-section draft → audit PASS with zero
issues on live data (trace matrix Appendix A). F1–F8 green.

## 30. Context / Token Efficiency

No ROUTES.yaml change required (no new loadable docs; artifacts are inputs,
and stage routes already cover artifact inputs — context-routing 34/34
unchanged). Storytelling consumes brief + policy + compact pack selections;
raw crawls only for targeted debug.

## 31. Prompt Injection Boundary

Pack/md/draft carry web-derived text as DATA (RP10, INJ: injection preserved,
nothing executed, no canary). No instruction/data concatenation exists —
composer templates never interpolate source text into rule positions;
structured validation never replaces semantic validation (both run).

## 32. Persistence / Atomic Writes / Idempotency

`story-store.js` over artifact tmp+rename: 7 artifacts
(`research-pack.json/md`, `script-evidence-policy.json`,
`narrative-brief.json`, `story-draft.json/md`, `story-evidence-audit.json`),
all round-trip tested (E2E-FACTUAL). Deterministic ids (same inputs →
same packId/draftId); no 1H versioning.

## 33. Version / Provenance

Recorded: packVersion/hash + input fingerprint, gate version, brief version,
template version, draft hash, audit policy version, provider id
(`deterministic-composer` live). No model keys (none exist). Live
provenance in `Report/evidence/research-story-live/`.

## 34. Tests Added

`tests/story/`: pack RP1–RP11 (28), gate EG1–EG10 (17), brief NB1–NB10 (21),
factual draft F1–F8 (21), hybrid H1–H6 (13), fiction X1–X5 (16), audit
INJ/Q1/REV/REV-BLOCKED/STALE (15), E2E FACTUAL/HYBRID/FICTION (19).
Fixture: `tests/fixtures/story-fixtures.js` (factual/hybrid-5-label/fiction).
New total **150 asserts**. `validate-schemas.js`: syntax + 4 instance tests.

## 35. Factual Fixture E2E

SUFFICIENT → pack → policy → brief → draft → audit PASS; every section ref
checked reachable in pack; 7 artifacts persisted + reloaded (E2E-FACTUAL).

## 36. Hybrid Fixture E2E

All five classifications reach draft metadata; audit unblocked (E2E-HYBRID).

## 37. Fiction Fixture E2E

Pure fiction PASS with zero refs; targeted variant covered in X3 (E2E-FICTION).

## 38. Stale-Pack Test

Evidence mutation and sufficiency regression both stale the pack and flag
policy/brief/draft/audit downstream (RP9, STALE). No falsely-current story.

## 39. Live Factual Research → Story Validation

LIVE (fresh bounded flow, HTTP 308): agent search (10 RFC + 8 MDN raw) →
normalized 3 → acquired (RFC 15,112 chars; MDN index 81,896; MDN 308 60,310;
hashes stable across runs: `1ffad4aa74b2`, `274c8cee5b66`, `359cf28aed3b`)
→ registered (OFFICIAL via configured domain + 2× conservative UNKNOWN) →
3× INDEPENDENT (Jaccard 0.00/0.00/0.17; a bare-hyperlink DERIVED verdict was
caught live, traced to an over-aggressive heuristic, fixed, and locked with
regression test I6) → 5 analyst-structured candidates accepted / 0 rejected
→ critical claim PRIMARY_CONFIRMED ×2 groups → SUFFICIENT 4/4 →
`pack-1daade0f8442` SCRIPT_READY → deterministic draft `drf-5170890fb970`
(6 sections) → audit PASS, zero issues. Real IDs/hashes throughout;
sanitized metadata in `Report/evidence/research-story-live/` (3 files).

## 40. Live Storytelling Provider Validation

Production path is the deterministic composer (§86 applies — no provider
theater): request contract + structured response + schema validation
(`story-handoff.schema.json`) + semantic validation (brief/pack/policy
gates) + evidence audit, all executed live on real artifacts (§39). No LLM
call exists to validate; `agent-exchange` path is implemented, gated, and
fixture-tested but not falsely claimed as live.

## 41. Bugs Found

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | F6/F7/F8 crash (`.sections` of undefined) | Tests dereferenced `.draft.draft`; F6 also exposed missing dispute-claim render path | Fixed derefs; dispute step now carries disputed claimIds; composer drops empty husks / fails loudly |
| 2 | Naive revision dropped evidenced sentences | Sentence filter dropped any sentence containing digits (`308`) | Evidence-aware filter (corpus-checked numbers/quotes) |
| 3 | Revision loop never converged | Empty-section fallback tripped orphan rule forever | Drop empties; structural check inside loop; blocking escalation |
| 4 | Verified quote with trailing period rejected | Exact-match quote comparison | Trailing-punctuation-tolerant normalization |
| 5 | Composer boilerplate tripped number audit | `(…for 1 referenced fact.)` | Count-free boilerplate |
| 6 | Live DERIVED verdict on MDN | `citesOrigin` treated any hyperlink as derivation | Republication-signal-only heuristic + I6 lock |
| 7 | Live index missed 3rd source | Stage-A driver saved before stage-B registration | Re-acquire/register/evaluate driver; evidence re-copied |

## 42. LOG-FIRST Fix Iterations

Each failure read from output to stage: crash stacks → exact deref lines;
revision traces printed per attempt (exposed the digit-filter and
empty-fallback loop); live verdict text named the heuristic (`explicit
citation/syndication marker` on a References section) → narrowed to
republication signals, re-ran live 3-way evaluation, added I6. No
architectural rewrites; targeted reruns after every fix.

## 43. Commands Executed

```text
node tests/story/test-research-pack.js       -> 28/28
node tests/story/test-evidence-gate.js       -> 17/17
node tests/story/test-narrative-brief.js     -> 21/21
node tests/story/test-story-draft.js         -> 21/21
node tests/story/test-story-hybrid.js        -> 13/13
node tests/story/test-story-fiction.js       -> 16/16
node tests/story/test-story-audit.js         -> 15/15
node tests/story/test-story-e2e.js           -> 19/19
node scripts/run-tests.js story              -> 0 failed, 0.7s
node scripts/checks/validate-schemas.js      -> ALL PASS (+story-handoff)
node tests/pipeline/test-content-class-router.js   -> 34/34
node tests/pipeline/test-research-planning.js      -> 70/70
node scripts/run-tests.js research           -> 0 failed
node tests/pipeline/test-v5-preflight.js     -> 47/47
node tests/pipeline/test-editorial-quality.js -> 37/37
node tests/pipeline/test-context-routing.js  -> 34/34
node scripts/checks/repository-structure-check.js -> OK
node scripts/run-tests.js (full)             -> 0 failed, 140.4s
live drivers (search/acquire x6, analyze, handoff) -> LIVE PASS (§39)
```

## 44. Targeted Test Results

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-research-pack.js` | PASS | 28/28 (RP1–RP11) | PASS |
| `test-evidence-gate.js` | PASS | 17/17 (EG1–EG10) | PASS |
| `test-narrative-brief.js` | PASS | 21/21 (NB1–NB10) | PASS |
| `test-story-draft.js` | PASS | 21/21 (F1–F8) | PASS |
| `test-story-hybrid.js` | PASS | 13/13 (H1–H6) | PASS |
| `test-story-fiction.js` | PASS | 16/16 (X1–X5) | PASS |
| `test-story-audit.js` | PASS | 15/15 (INJ/Q/REV/STALE) | PASS |
| `test-story-e2e.js` | PASS | 19/19 (3 routes + persist) | PASS |

## 45. Prompt 01 Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-content-class-router.js` | PASS | 34/34 | PASS |
| `test-research-planning.js` | PASS | 70/70 | PASS |

## 46. Prompt 02 Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `run-tests.js research` | 0 failed | 0 failed (14 suites) | PASS |

Acquisition untouched (no compatibility bug found; live flow reused it as-is).

## 47. Prompt 03 Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| 7 evidence suites | PASS | SR 27, I 13, CE 20, C/U 14, S 19, CB 18, E2E 22 | PASS |

Evidence semantics intact; independence heuristic tightened (I6) with all
prior assertions still green.

## 48. Governance Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-v5-preflight.js` | PASS | 47/47 | PASS |
| `test-editorial-quality.js` | PASS | 37/37 | PASS |
| `test-context-routing.js` | PASS | 34/34 | PASS |
| `validate-schemas.js` | PASS | + story-handoff syntax + 4 instances | PASS |
| `repository-structure-check.js` | PASS | OK | PASS |

## 49. Full Regression

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `node scripts/run-tests.js` | 0 failed | 0 failed, all 10 domains, 140.4s | PASS |

## 50. Browser Validation
- NOT_APPLICABLE — no browser-visible UI changed (core/runtime logic only;
  no DOM, selectors, extension, or user-facing browser workflow touched).
  No Playwright run for ceremony (§100). Real-browser acquisition paths were
  already proven in Prompt 02 and reused untouched.

## 51. Files Created

| File | Why | Tests |
|---|---|---|
| `schemas/story-handoff.schema.json` | Pack/policy/brief/draft/audit contracts | validate-schemas + story |
| `lib/research-story/research-pack.js` | 1G.1M runtime | RP1–RP11 |
| `lib/research-story/script-evidence-gate.js` | 1G.1N runtime | EG1–EG10 |
| `lib/research-story/narrative-brief.js` | 1G.1O runtime | NB1–NB10 |
| `lib/research-story/story-draft.js` | 1G.1P composer + exchange | F/H/X |
| `lib/research-story/story-audit.js` | Evidence audit + revision | INJ/Q/REV/STALE, F2–F6 |
| `lib/research-story/story-store.js` | Persistence + stale | E2E, RP9 |
| `tests/story/test-research-pack.js` | RP suite | self |
| `tests/story/test-evidence-gate.js` | EG suite | self |
| `tests/story/test-narrative-brief.js` | NB suite | self |
| `tests/story/test-story-draft.js` | F suite | self |
| `tests/story/test-story-hybrid.js` | H suite | self |
| `tests/story/test-story-fiction.js` | X suite | self |
| `tests/story/test-story-audit.js` | Audit suite | self |
| `tests/story/test-story-e2e.js` | Route E2Es | self |
| `tests/fixtures/story-fixtures.js` | Deterministic fixtures | all above |
| `Report/evidence/research-story-live/*` (3) | Sanitized live evidence | manual |
| `Report/PHASE_1G1_04_RESEARCH_TO_STORY_HANDOFF_REPORT.md` | This report | — |

## 52. Files Modified

| File | Change | Why | Tests |
|---|---|---|---|
| `lib/research-evidence/independence.js` | `citesOrigin` = republication signals only | Live false-DERIVED (§41-6) | I1–I6 green |
| `tests/research/test-independence.js` | +I6 bare-hyperlink lock | Regression lock | self |
| `scripts/checks/validate-schemas.js` | +story-handoff syntax + 4 instances | Governance | self PASS |
| `package.json` | +`test:story` | Domain runner | `run-tests.js story` |
| `core/WORKFLOW.md` | +1 evidence-runtime pointer (3B) | Discoverability | context-routing PASS |

## 53. Files Deleted

None.

## 54. Scope Check

Static audit of new code: no humanizer/naturalness/beat/scene/shot/grammar
hits beyond boundary comments; no GPT/TTS/voice/caption/Veo/Flow/media/1G.2+
implementation; no `research-pack.md`-as-script confusion (pack has no
narration fields). Prompt-05 DEEP runtime untouched.

## 55. Security / Secret Audit

Scans over new tests/fixtures, live evidence, and (post-write) this report:
zero hits for cookies/Bearer/API keys/passwords/session material. Private
bodies never enter packs/drafts/reports (refs only; live evidence =
metadata). Fixture creds: none introduced (story fixtures carry no auth).
Auth-state handling untouched from Prompt 02.

## 56. Remaining Issues

None blocking. Known ceilings: deterministic composer is editorially
conservative (templates, not stylistic range — 1G.3 will own voice);
number/name matching is literal (word-form numbers and aliases need the
1G.3-era semantic layer); quote tolerance covers trailing punctuation only;
MDN-classified UNKNOWN stays conservative without a configured domain list.

## 57. Next Allowed Step

```text
PHASE 1G.1 — PROMPT 05
STANDARD / DEEP RESEARCH ESCALATION
(1G.1Q + GPT Researcher or compatible DEEP provider, same contracts)
```
Not started in this task.

## 58. Final Conclusion

```text
TASK_VALIDATION = PASS
Research Pack + Script Evidence Gate + Editorial Strategy + Story Draft /
Storytelling Handoff + post-generation Evidence Audit + FACTUAL/HYBRID/
FICTION E2E + live factual validation + Prompt 01/02/03 + governance +
full regression: ALL PASS.
```

---

## Appendix A — Behavior Matrix

| Case | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| SUFFICIENT factual → Pack | SCRIPT_READY | `pack-1daade0f8442` live | RP1/§39 | PASS |
| NEEDS_MORE_RESEARCH → blocked | `RESEARCH_NOT_SUFFICIENT` | explicit, no pack | RP2 | PASS |
| BLOCKED → blocked | `RESEARCH_BLOCKED` + blocker | preserved | RP3 | PASS |
| PRIMARY_CONFIRMED claim | allowed | gate allow | EG1/live | PASS |
| MULTI_SOURCE_CONFIRMED claim | allowed | gate allow | EG2 | PASS |
| SINGLE_SOURCE high-impact | restricted + attribution | `SINGLE_SOURCE_ATTRIBUTED` | EG3/F4 | PASS |
| CONFLICTED claim | frame-or-omit | dispute verdict | EG4/F6 | PASS |
| UNSUPPORTED claim | forbidden | forbid verdict | EG5/F5-path | PASS |
| HYPOTHESIS | qualified uncertainty | mandatory qualifier | EG6 | PASS |
| FOLKLORE | kept as folklore | restricted, no promotion | EG7/H2 | PASS |
| TESTIMONY | attributed | witness attribution | EG8/H3 | PASS |
| SPECULATION | qualified | uncertainty qualifier | EG9/H4 | PASS |
| FICTIONALIZED_ELEMENT | forbidden as fact | forbid + boundary | EG10/H5 | PASS |
| pure FICTION | no pack, no refs | 0 refs, audit PASS | X1/X2 | PASS |
| FICTION targeted detail | evidence ref kept | ref + audit PASS | X3 | PASS |
| unsupported story assertion | NEEDS_REVISION | numbers caught | F2/REV | PASS |
| certainty escalation | NEEDS_REVISION | qualifier check | F3 | PASS |
| missing attribution | NEEDS_REVISION | marker check | F4 | PASS |
| fabricated quote | BLOCKED | quote check | F5/Q1 | PASS |
| revision loop | fix section, keep rest | 1 attempt, byte-preserved | REV | PASS |
| stale Pack | downstream stale | mutation + regression | RP9/STALE | PASS |
| live factual story | pack→draft→audit PASS | 6 sections, 0 issues | §39/trace | PASS |

## Appendix B — Artifact Trace Matrix (live)

| Story Section | Claim Refs | Source Path Reachable | Classification | Audit |
|---|---|---|---|---|
| hook | — | — (question-led, no factual assertion) | — | PASS |
| q0 | `clm-8935cbdd21be` | RFC-OFFICIAL + MDN (2 groups) | SUPPORTED_FACT | PASS |
| q1 | `clm-f3482021bcb5` | RFC-OFFICIAL (PRIMARY) | SUPPORTED_FACT | PASS |
| q2 | `clm-18900323a523` | MDN index (SINGLE) | SUPPORTED_FACT | PASS |
| q3 | `clm-c4ec41213815` | MDN-308 (SINGLE) | SCHOLARLY_INTERP | PASS |
| payoff | — | — (editorial close) | — | PASS |

No source bodies pasted; refs resolve through `live-source-index.json`.

## Appendix C — Test Matrix

| Command / Test | Expected | Actual | Result |
|---|---|---|---|
| `test-research-pack.js` | PASS | 28/28 | PASS |
| `test-evidence-gate.js` | PASS | 17/17 | PASS |
| `test-narrative-brief.js` | PASS | 21/21 | PASS |
| `test-story-draft.js` | PASS | 21/21 | PASS |
| `test-story-hybrid.js` | PASS | 13/13 | PASS |
| `test-story-fiction.js` | PASS | 16/16 | PASS |
| `test-story-audit.js` | PASS | 15/15 | PASS |
| `test-story-e2e.js` | PASS | 19/19 | PASS |
| Prompt-01 ×2 | PASS | 34 + 70 | PASS |
| Prompt-02/03 research domain | 0 failed | 0 failed (14 suites) | PASS |
| V5/V6 governance ×3 + schemas + structure | PASS | 47 + 37 + 34 + ALL + OK | PASS |
| `run-tests.js` full | 0 failed | 0 failed, 140.4s | PASS |
| live search/acquire/analyze/handoff | PASS | real IDs, audit PASS | PASS |
