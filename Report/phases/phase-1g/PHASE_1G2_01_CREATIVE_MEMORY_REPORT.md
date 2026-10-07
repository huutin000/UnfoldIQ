# PHASE 1G.2 — PROMPT 01
# CREATIVE MEMORY FOUNDATION REPORT

Date: 2026-10-03
Roadmap: V6 — first post-1G.1 work unit (1G.2 only)

## 1. Status

```text
TASK_VALIDATION = PASS
PHASE 1G.2 — PROMPT 01 = COMPLETE
NEXT = PHASE 1G.3 — BEAT MAP / SCENE GRAPH / SHOT PLAN
```

## 2. 1G.1 Entry Gate

```text
Report/PHASE_1G1_06_FULL_E2E_VALIDATION_REPORT.md:
  TASK_VALIDATION = PASS
  PHASE 1G.1 = COMPLETE
  1G.1A–1G.1R = CLOSED
  operator restored Smart App Control = ON   (confirmed by operator)
```

Entry gate = PASS.

## 3. Scope / Non-Scope

Implemented: deterministic Creative Memory layer — fingerprint builder,
scoped record store, ingestion lifecycle, explicit promotion, bounded
retrieval, anti-repetition detection, staleness/lineage, facade advisory hook.

NOT implemented (per prompt §2, §26, §38): no analytics/learning loop, no
vector DB, no paid embedding API, no semantic provider, no UI/dashboard, no
Beat Map/Shot Plan memory, no performance scoring (only USED / APPROVED /
AVOID / REPEATED), no 1G.3+ features, no topic-registry or creative-brief
replacement.

## 4. Existing Capability Audit

```text
lib/topic-registry-check.js + projects/TOPIC_REGISTRY.json → topics only
lib/research-evidence/creative-brief.js                    → current-video intent only
lib/research-story/*                                       → per-project artifacts only
pipeline/*, scripts/cli/*                                  → render stage only
No creative-history / repetition capability anywhere.
```

Classification (§4): **C — missing; create minimal new owner.** No duplicate
storage created for Topic Registry or Creative Brief concerns.

## 5. Canonical Owner Decision

ONE canonical owner:

```text
lib/creative-memory.js
  buildCreativeFingerprint / newMemoryRecord / saveCreativeMemory /
  loadCreativeMemory / listCreativeMemory / ingestCreativeMemory /
  promoteCreativeMemory / queryCreativeMemory / getCreativeMemoryContext /
  checkCreativeRepetition / isMemoryCurrent / supersedeCreativeMemory
```

No CreativeMemoryService/StyleMemoryService/StoryMemoryService/
AntiTemplateService split. Schema: `schemas/creative-memory.schema.json`
(validated at record creation and registered in `validate-schemas.js`).

## 6. Topic Registry Boundary

Memory records carry `topicRef` (e.g. `TOPIC-001`) as a REFERENCE only.
Registry keeps canonical topic/angle/promise/lifecycle/duplication ownership;
memory stores none of those fields.

## 7. Creative Brief Boundary

Direction of flow (required): `Creative Memory → advisory context → next
Creative Brief / editorial strategy`. Memory never writes the current brief.
The facade attaches `result.creativeMemoryContext` marked
`advisoryOnly: true`; explicit current-project input always wins (CM4 proves
a persisted plan field keeps its explicit value with memory present).

## 8. Evidence Truth Firewall

Hard invariant proven by CM5/CM16 (identical factual inputs with and without
memory present):

```markdown
| Evidence Item            | Without Memory | With Memory | Match |
|---|---|---|---|
| registered source count  | 2              | 2           | YES |
| claim IDs/statuses       | identical      | identical   | YES |
| independence groups      | 2              | 2           | YES |
| contradictions           | 0              | 0           | YES |
| sufficiency              | SUFFICIENT     | SUFFICIENT  | YES |
| Pack evidence verdicts   | identical      | identical   | YES |
| HYBRID classifications + gate forbiddenAsFact | identical | identical | YES |
```

Structurally: the facade passes memory context to the RESULT only; no memory
value reaches `planResearch`, acquisition, registry, ledger, verification,
sufficiency, pack, gate, brief, draft, or audit owners.

## 9. Memory Scope Model

Scopes: `CHANNEL | NICHE | PLATFORM | PROJECT`. Retrieval precedence
(current project explicit > current brief — handled by owners — then):
channel+niche+platform > channel+niche > niche > platform > channel, with
PROJECT records visible only to their own project (CM12). Platform-scoped
records are never treated as universal unless promoted (CM14).

## 10. Creative Memory Contract

Versioned record `1.0.0` per `creative-memory.schema.json`: memoryId
(`cm-<sha256-12>` of scope+identity+fingerprintHash+topicRef — stable),
scope, channelId/nicheId/platform/projectId, topicRef, contentClass, status,
fingerprint, fingerprintHash (sha256-16 of stableStringify), approvedSignals
(≤20), avoidSignals (≤20), sourceArtifactRefs (IDs/hashes only), promotedFrom,
useCount, createdAt/updatedAt/lastUsedAt. `additionalProperties: false`.

## 11. Creative Fingerprint

Deterministic builder over existing artifacts (Creative Brief viewerPromise,
Narrative Brief, Story Draft sections):

```text
openingPattern         = first 12 normalized words of the opening sentence
narrativeShape         = section storyFunction sequence ("hook>development>…")
viewerPromisePattern   = normalized viewer promise
transitionPatterns     = first 5 normalized words of each following section (≤8)
rhetoricalPatterns     = first 6 normalized words of each section (≤8)
phrasePatterns         = 5-word shingles (section openings + intra-draft repeats, ≤12)
```

Normalization: lowercase, digits→`#`, punctuation stripped, whitespace
collapsed — deterministic, preserves meaningful distinctions. Bounded; never
stores the draft body, never stores research source bodies, never stores
provider prompts.

## 12. Ingestion Lifecycle

`DRAFT/REVIEWED` records are stored but NOT retrievable; only `APPROVED` is
durable (`DURABLE_STATUSES`). `REJECTED` ingestion is refused outright
(`REJECTED_NOT_INGESTED`) — a failed/rejected draft can never silently become
reusable channel memory (CM10/CM11).

## 13. Promotion Rules

`promoteCreativeMemory(root, memoryId, toScope, {approved})` — explicit only:
non-durable records refused (`NOT_DURABLE`); PROJECT→wider scope requires
`approved: true` (`PROMOTION_NOT_APPROVED` otherwise). Promoted record carries
`promotedFrom`; source record retained (CM13).

## 14. Retrieval

`queryCreativeMemory` / `getCreativeMemoryContext(root, {channelId, nicheId,
platform, projectId, contentClass, topicRef})` return approved signals, avoid
signals, recent fingerprints, repetition warnings — sorted by recency, bounded
(§19). Pre-1G.2 projects get EMPTY context with nothing fabricated (CM3/CM21).

## 15. Anti-Repetition Detection

`checkCreativeRepetition(root, fingerprint, scope)` — deterministic similarity
over 6 dimensions (exact normalized phrase equality, structural fingerprint
equality, list overlaps). Severity: exact+structural repeats →
`HIGH_TEMPLATE_REUSE`; single structural/phrase overlap → `REPETITION_WARNING`;
no match → `REPETITION_OK`. It is a repetition signal, NOT an AI detector; no
score is produced; no vector DB; no paid API (prompt §13 satisfied: only
deterministic methods used — semantic similarity was not needed).

## 16. Explainability

Every warning carries `matchedMemoryIds`, `matchedDimensions`,
`matchedValues`, human-readable `reason`, and `suggestedVariationDimensions`.
No mysterious scalar is ever emitted (asserted in CM7).

## 17. FICTION

FICTION plot-pattern memory supported (CM15): repeated plot opening/narrative
shape → explainable warning; different plot shape → `REPETITION_OK`. Memory
never fabricates evidence for fiction.

## 18. HYBRID

CM16: with memory present, HYBRID run keeps identical claim classifications
(FACT/FOLKLORE/TESTIMONY/SPECULATION/FICTIONALIZED_ELEMENT) and identical
`forbiddenAsFact` gate rules. Memory informs framing only.

## 19. YouTube / TikTok

Platform-scoped memory separation proven (CM14): the same channel's youtube
record never leaks into tiktok queries and vice versa; channel-level memory is
shared. Platform differences change nothing about evidence truth.

## 20. Persistence

```text
projects/creative-memory/records/<memoryId>.json
```

Atomic tmp+rename writes via `providers/runtime/artifact-store.js` (no
truncated JSON, no silent lost file); idempotent re-ingest updates in place
(`created:false`, useCount tracking); per-record files (no registry file to
corrupt; corrupt files are skipped by readers, never crash retrieval); not in
repository root; versioned schema.

## 21. Lineage / Staleness

Records keep `sourceArtifactRefs` (draftId/briefId/hash refs).
`isMemoryCurrent(record, currentRefs)` compares stored vs current refs — a
changed source artifact marks the derived fingerprint stale instead of
pretending it belongs to the new version; `supersedeCreativeMemory` sets
`SUPERSEDED` + reason and removes it from retrieval (CM17).

## 22. Backward Compatibility

Projects before 1G.2: no memory store exists → empty context, no store created
as a side effect (`projects/creative-memory/` is NOT created by a memory-less
run), 1G.1 behavior byte-identical (CM21; full 1G.1 suite rerun PASS §25).

## 23. Security / Prompt Injection

- Secret guard: records containing secret-like strings (api keys, bearer,
  cookies, passwords, private keys, JWTs, .env) are refused
  (`MEMORY_SECRET_SUSPECTED`).
- No eval/Function/vm/child_process in the owner (static assertion in CM20).
- Retrieved memory text is DATA: it is returned verbatim as untrusted
  advisory context with `advisoryOnly: true`; it can never become system
  instruction (CM20 proves injection-flavored text flows as data only).
- No private research bodies / provider prompts are ever stored — records
  carry IDs/hashes and bounded creative patterns only.

## 24. Tests

```text
tests/pipeline/test-creative-memory.js
  17 tests / 75 assertions — RESULT: ALL TESTS PASSED
  CM1 deterministic fingerprint            CM12 project isolation
  CM2 save/load atomicity                  CM13 channel/niche promotion
  CM3 missing memory = empty context       CM14 YouTube/TikTok separation
  CM4 explicit input wins                  CM15 FICTION plot patterns
  CM5 memory → zero evidence change        CM16 HYBRID boundaries preserved
  CM6 past facts never become evidence     CM17 staleness/supersede
  CM7/8/9 repetition detection             CM18 idempotent ingestion
  CM10 rejected not ingested               CM19 bounded retrieval
  CM11 approved eligible                   CM20 secrets/injection safety
                                           CM21 backward compatibility
```

## 25. 1G.1 Regression

Executed after the changes (SAC = ON, non-render):

```text
node scripts/run-tests.js pipeline       → 0 failed suite(s) (incl. 1G.1 E2E, 122 assertions)
node scripts/run-tests.js research       → 0 failed suite(s)
node scripts/run-tests.js research-deep  → 0 failed suite(s)
node scripts/run-tests.js story          → 0 failed suite(s)
node scripts/run-tests.js topic          → 0 failed suite(s)
node scripts/checks/validate-schemas.js  → ALL PASS (incl. new creative-memory schema)
npm run check:repo-structure             → REPOSITORY_STRUCTURE_OK
```

No live DEEP/API calls made (prompt §36/§38): the live provider path was not
touched by 1G.2.

## 26. Full Regression / SAC Gate

1G.2 needs no rendering, so all implementation/targeted work ran with
SAC = ON. The final repository-wide regression (includes real native Remotion
suites) was executed inside an operator-controlled SAC-off window:

```text
operator manually set SAC = OFF        (confirmed in-session)
agent toggled SAC automatically        = NO
npm run render:doctor                  → RENDER_DOCTOR_RESULT: READY
npm test                               → 0 failed suite(s) in 274.0s
npm run check:repo-structure           → REPOSITORY_STRUCTURE_OK
node scripts/checks/validate-schemas.js → ALL TESTS PASSED
zero FAIL lines in full test output    (verified by grep)
operator manually restored SAC = ON    (confirmed in-session)
no native Remotion rerun after restoration
```

Final regression evidence:

| Command | Expected | Actual | Result |
|---|---|---|---|
| npm run render:doctor | READY | READY (ffmpeg/ffprobe/remotion.exe OK, compositor 4.0.529) | PASS |
| npm test | 0 failed suites | 0 failed suites — flow, media, pipeline, policy, providers, qa, remotion, research, research-deep, story, topic (274.0s) | PASS |
| npm run check:repo-structure | REPOSITORY_STRUCTURE_OK | REPOSITORY_STRUCTURE_OK | PASS |
| node scripts/checks/validate-schemas.js | PASS | ALL TESTS PASSED (incl. creative-memory.schema.json) | PASS |

Security restoration record:

```text
SAC toggled automatically by agent   = NO
SAC OFF only during render/full-regression window = YES
operator restored SAC after validation = YES
Defender changed                     = NO
security exclusion added             = NO
Code Integrity policy modified       = NO
registry bypass                      = NO
```

## 27. Files Created

```text
lib/creative-memory.js                    (canonical Creative Memory owner)
schemas/creative-memory.schema.json       (versioned record contract)
tests/pipeline/test-creative-memory.js    (CM1–CM21, 17 tests / 75 assertions)
Report/PHASE_1G2_01_CREATIVE_MEMORY_REPORT.md
```

## 28. Files Modified

```text
lib/research-to-story.js    (advisory hook only: attach bounded creativeMemoryContext
                             to the result when options.creativeMemory is provided;
                             no evidence-owner code path changed)
scripts/checks/validate-schemas.js (registered creative-memory.schema.json)
```

## 29. Files Deleted

```text
(none)
```

## 30. Known Limitations

- Memory knows only USED/APPROVED/AVOID/REPEATED — no performance inference
  (learning loop is a later roadmap phase).
- Similarity is exact/structural/lexical only; no semantic similarity (not
  needed for acceptance; adding one would require paid APIs — declined).
- Promotion approval is programmatic (`approved: true`); no UI (per §39).
- Retention metadata (createdAt/lastUsedAt/useCount/superseded) exists; no
  automatic expiry policy yet.

## 31. Remaining Issues

```text
(none — all PASS criteria met, including the SAC-gated full regression and
 operator-confirmed SAC restoration)
```

## 32. Final Conclusion

All PASS criteria of the prompt are met: one canonical Creative Memory owner,
registry/brief boundaries respected, deterministic fingerprint, scoped
isolation, ingestion lifecycle, bounded retrieval, exact/structural repetition
detection with explainable warnings, explicit-input-wins, zero evidence-truth
change, FICTION/HYBRID/platform coverage, atomic idempotent persistence,
lineage/staleness, backward compatibility, no secret leakage, no paid API
calls, targeted + full regressions PASS, SAC workflow followed with operator
restoration confirmed.

```text
TASK_VALIDATION = PASS
PHASE 1G.2 — CREATIVE MEMORY = COMPLETE
NEXT = PHASE 1G.3 — BEAT MAP / SCENE GRAPH / SHOT PLAN
```
