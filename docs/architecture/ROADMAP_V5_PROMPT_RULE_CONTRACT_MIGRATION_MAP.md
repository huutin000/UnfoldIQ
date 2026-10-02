# ROADMAP V5 Prompt / Rule / Contract Migration Map (PRE-FLIGHT)

> Map only — not a competing business-rule source. Canonical rules live in
> `core/*`; contracts in `schemas/*`; checks in `lib/*`.

## Canonical owners after migration

| Concern | Canonical Owner |
|---|---|
| Content Class | `core/CONTENT_MODE.md` + `schemas/content-mode.schema.json` (`contentClass`, `modeId` unchanged) |
| Content Mode | `core/CONTENT_MODE.md` + `schemas/content-mode.schema.json` |
| Research Plan | `core/RESEARCH_QUALITY.md` §V5.1 + `schemas/research-plan.schema.json` |
| Research Required Gate | `core/RESEARCH_QUALITY.md` §V5.2 |
| Research Mode | `core/RESEARCH_QUALITY.md` §V5.3 |
| Source Registry | `core/RESEARCH_QUALITY.md` §V5.7 (+ optional fields on `research-brief` sources) |
| Source Independence | `core/RESEARCH_QUALITY.md` §V5.8 |
| Claim taxonomy | `core/RESEARCH_QUALITY.md` (unchanged 6 classes) |
| Evidence strength | `core/RESEARCH_QUALITY.md` (unchanged 4 states) |
| Corroboration | `core/RESEARCH_QUALITY.md` §V5.9 (+ optional `corroborationStatus` on claims) |
| Cross-source Verification | `core/RESEARCH_QUALITY.md` §V5.11 |
| Contradictions | `core/RESEARCH_QUALITY.md` §V5.12 (+ `research-brief.contradictions/openQuestions`) |
| Research Sufficiency | `core/RESEARCH_QUALITY.md` §V5.13 (+ optional `researchSufficiency`) |
| Research Pack | `core/RESEARCH_QUALITY.md` §V5.14 (extends `research-brief`; one handoff) |
| Script Evidence Gate | `core/RESEARCH_QUALITY.md` §V5.15 + `core/STORYTELLING.md` §B |
| Editorial Strategy | `core/EDITORIAL_VALUE.md` (explicit owner) |
| Storytelling Handoff | `core/STORYTELLING.md` |
| Platform Routing | `platforms/INDEX.md` + `context/ROUTES.yaml` |
| YouTube Prompt Routing | `platforms/youtube/OVERLAY.md` |
| TikTok Routing | `platforms/tiktok/OVERLAY.md` |
| Web Security | `core/RESEARCH_QUALITY.md` §V5.6 |

## Superseded artifacts

None. No file was superseded or deleted — EXTEND strategy throughout.

## Compatibility decisions

- `contentClass`, `researchRequired`, `researchMode`, `researchSufficiency`,
  `independenceStatus`, `originGroup`, `canonicalUrl`, `corroborationStatus`,
  `hybridLabel` are all **optional** schema fields. Every pre-migration
  instance validates unchanged (proven by tests).
- `modeId` never renamed; existing taxonomy preserved.
- Existing claim classes / evidence states unchanged; corroboration is a new
  orthogonal axis, not a replacement.
- `research-brief` EXTENDed; no competing Research Pack owner created.

## Research flow mapping

`TOPIC → CONTENT CLASS → RESEARCH PLAN → REQUIRED? GATE → (STANDARD/DEEP
contract) → EXTRACTION contract → SOURCE REGISTRY → QUALITY+INDEPENDENCE →
CLAIM/LEDGER → VERIFICATION → CONTRADICTIONS/UNKNOWNS → SUFFICIENCY
(SUFFICIENT|NEEDS_MORE|BLOCKED) → RESEARCH PACK → SCRIPT EVIDENCE GATE →
EDITORIAL STRATEGY → STORYTELLING`. FICTION takes the Story/Character/World
branch (§V5.2). All sections V5.1–V5.15 in `core/RESEARCH_QUALITY.md`.

## YouTube mapping

No 9-prompt bundle exists in repo (NOT_FOUND, not recreated). Minimum
`platforms/youtube/OVERLAY.md` created: shared core + YouTube overlay
(metadata/packaging/policy/monetization + research/script/idea prompt
contracts). Decision: NEW (overlay only, no duplicated suite).

## TikTok mapping

No TikTok prompt layer exists (gap documented). Minimum
`platforms/tiktok/OVERLAY.md` created: same shared core + TikTok overlay
(aspect/safe-zone/pacing/packaging). Decision: NEW (overlay only).

## Schema mapping

| Schema | Decision |
|---|---|
| `content-mode.schema.json` | EXTEND (+ optional `contentClass`) |
| `research-brief.schema.json` | EXTEND (+ 4 top-level + 3 source + 2 claim optional fields) |
| `research-plan.schema.json` | NEW (no prior owner) |
| all other schemas | KEEP (untouched) |

## Runtime work intentionally deferred to 1G.1

SearchProvider, Crawl4AI, browser research impl, Registry persistence,
Quality/Independence resolver, Ledger, verification engine, contradiction
engine, Sufficiency evaluator, Pack generator, GPT Researcher escalation,
1G.1 E2E. Verified: none installed/implemented (see report §44).
