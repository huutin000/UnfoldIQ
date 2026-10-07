# PHASE 2.1 — TASK 01
# VOICE BIBLE + NARRATOR PERSONA

> **SUPERSEDED — ARCHIVE ONLY.** Current Phase 2.1 truth lives in
> `Report/fixes/phase-2/FIX_PHASE_2_1_02_RIGHTS_DECISION_AND_CANONICAL_SYNC_REPORT.md`
> (Voice Bible v3 `vb-19f4fd6a4596`, narrator `am_michael` OPERATOR_APPROVED,
> productionReady=true under ACCEPT_RESIDUAL_RIGHTS_RISK).
> This document is preserved byte-identical below the banner except for this notice:
> it describes `af_heart` / PROVIDER_DEFAULT / v1 with an unprobed runtime and is
> NOT the current Phase 2.1 state. Do not index it as current.

```text
TASK_VALIDATION = PASS
PHASE_2_1_QUALITY_GATE = PASS
PHASE_2_1 = COMPLETE
NEXT = PHASE 2.2 — NARRATION DIRECTOR VERIFICATION
```

**Project:** UNFOLDIQ · **Roadmap:** V6.2 · **Window:** 2026-10-05
**Artifact:** `vb-42744f223671` v1 · **Project:** `phase2-1-validation`

---

## 1. Entry gate

From `Report/POST_1H_REPOSITORY_HYGIENE_AND_WORKSPACE_MIGRATION_REPORT.md` (read):
`TASK_VALIDATION = PASS`, `POST_1H_HYGIENE_QUALITY_GATE = PASS`,
`POST_1H_HYGIENE = COMPLETE`, `WORKSPACE_GOVERNANCE = ACTIVE`, `ROADMAP = V6.2`,
open P0 = 0, open P1 = 0, full regression PASS (24 domains, 300.1s).

Live contracts re-verified loadable before any write: `projects/registry.json`
(17 → 18 projects after registration), workspace resolver/guard,
`check:workspace`, Project Manifest, History/locks, DAG/recovery,
Golden/telemetry/provenance/compliance. All true → **not blocked**.

## 2. Existing voice-state audit

Read-only sweep of every voice/TTS surface before writing anything:

| Finding | Location |
|---|---|
| Kokoro adapter with a hardcoded `DEFAULT_VOICES` map (9 languages → 9 voices) | `providers/runtime/adapters/local-kokoro.js:33-43` |
| Kokoro model id `kokoro-v1` / version `1.0.0` — **not exported** | `local-kokoro.js:45-46` |
| `TTS_PROVIDER` key | **does not exist anywhere in the repo** |
| `KOKORO_LANGS`, `KOKORO_MODEL` | documented in `SETUP_KOKORO.md` but **never read** by the adapter |
| Canonical voice selection module | **does not exist** |
| `windows-sapi` as `providerId` in 8 committed pilot records | `projects/pilot-sky-blue/audio-manifest.json:15,31,…` — **not a registered provider** |
| `elevenlabs-default-voice` placeholder | `adapters/cloud-elevenlabs-tts.js:24` |
| `narratorPersona` free-text string only | `schemas/creative-brief.schema.json:55` |
| `voiceRightsStatus` / `voiceDetail` in governance | `schemas/governance.schema.json:70,72` |
| Provider runtime emitted **zero** telemetry | grep: no `recordEvent` outside `lib/telemetry` + tests |

**Conclusion:** no canonical, operator-approved, or benchmark-derived narrator
voice selection exists anywhere. The only voice data is a runtime per-language
fallback inside the adapter. There is nothing to migrate.

## 3. Voice Bible schema

`schemas/voice-bible.schema.json` — draft-07, `$id: voice-bible.schema.json`,
`additionalProperties: false` at every level, `fingerprint: ^[0-9a-f]{16}$`.

Stores: `schemaVersion`, `voiceBibleId` (`^vb-[0-9a-f]{12}$`), `version`,
`projectId?`, `channelId?`, `language`, `locale?`, `narrator`,
`characterVoices[]`, `pronunciationProfileRef?`, `providerOptions?`,
`provenance`, `fingerprint`. Controlled enums only — no prose blobs.

The Manifest stays an **index**: schema `project-manifest-1.4.0.schema.json`
adds only an `artifactRef` slot, and `attachManifestReference` writes only
`{version, status, ref, detail}`. No persona, prosody or voice body ever
enters the Manifest.

## 4. Narrator Persona

`narrator.persona` carries all 13 required fields as controlled enums:
`personaId, role, audience, tone, energy, paceIntent, warmth, directness,
formality, storytellingStyle, emotionalRange, prohibitedDeliveryPatterns,
language`.

Semantic identity, not a voiceId: the persona is validated against itself
(`personaId` must match `narrator.personaId`; `persona.language` must equal the
bible language; persona emotions must be a **subset** of the narrator's range)
— see V12. Live persona: `per-explanatory-narrator-en`, role `GUIDE`, tone
`EXPLAINING`, storytelling `EVIDENCE_WALKTHROUGH`, formality `CONVERSATIONAL`.

## 5. Provider/model/voice selection

```text
provider = local-kokoro   model = kokoro-v1   voiceId = af_heart   language = en-us
source  = PROVIDER_DEFAULT (NOT operator-approved)   rights = UNRESOLVED
productionReady = false
blockers = VOICE_SELECTION_PROVIDER_DEFAULT, VOICE_RIGHTS_REVIEW_REQUIRED
```

**Not invented.** `provenance.source` is `PROVIDER_DEFAULT`, not
`OPERATOR_APPROVED`, because no operator decision exists. Rights are
`UNRESOLVED` with an explicit detail string, not a guessed licence. The
readiness gate refuses production use; `VOICE_SELECTION_PENDING_OPERATOR` /
`VOICE_RIGHTS_REVIEW_REQUIRED` (finding **P2-1**) is the honest outcome per
roadmap 25/26/37.

## 6. Kokoro boundary

Permitted and performed: provider identity, model identity, configured voice
refs, language compatibility. Runtime probe is **deliberately
`NOT_PROBED`** — proving the Kokoro CLI exists means running it, and running it
means synthesizing, which is 2.4.

Forbidden and not performed: full narration render, speech-rate QA,
Performance QA, mix/master, forced alignment, final captions.
**No synthesis, no smoke audio, no credits, no python spawn.** VoiceStudio is
absent from the catalog and fails `VOICE_PROVIDER_UNSUPPORTED` (V8/V28).

## 7. Language / locale

Explicit `language` (required) and `locale` (nullable), stored separately —
never inferred from a voice name. Checks: provider support →
`VOICE_LANGUAGE_UNSUPPORTED` ("never fallback to another language"), then
locale↔language base agreement → `VOICE_LOCALE_UNSUPPORTED`. The locale gate
constrains the **narrator**; a character may legitimately speak another
language (fix F4). V10 covers unsupported language, incompatible locale,
compatible locale, and provider normalisation (`hi` / `hi-IN`).

## 8. Speed/style/prosody defaults

`speedDefault: 1`, bounded **[0.5, 2.0]** — a provider rate **factor**. The
bound structurally excludes a words-per-minute magnitude, so `145` is
unrepresentable; V11 asserts `145 / 0 / 2.5 / -1` are all refused and that no
wpm-shaped key exists anywhere in the document. **Measured speech rate belongs
to 2.4.** Bounded prosody defaults, all enums: `paceIntent MODERATE`,
`energy BALANCED`, `pauseStyle NATURAL`, `sentenceFlow MEASURED`,
`emphasisStyle SELECTIVE`, `emotionalBaseline WARM`.

## 9. Emotional range

Allowed: `NEUTRAL, FRIENDLY, CURIOSITY, CONFIDENT, INSTRUCTIVE`. Extreme
styles are **explicitly prohibited**, not merely absent:
`UNNATURALLY_SLOW_CINEMATIC, CONSTANT_DRAGMATIC_EMPHASIS, MONOTONE_CADENCE,
OVERACTING, ROBOTIC_CLAUSE_RHYTHM, EXCESSIVE_PAUSES, ANNOUNCER_BOMBAST`.
Segment direction cannot mutate identity: persona emotions must stay a subset
of the narrator range (V12), and no segment/scene/paragraph field exists in the
schema at all.

## 10. Pronunciation profile reference

`pronunciationProfileRef = "pron-en-us-reference"`. **Reference contract only**;
runtime validation is 2.3. Schema checks shape (`^[a-z0-9][a-z0-9-]{1,63}$`),
code checks semantics (must be `pron-` prefixed → `PRONUNCIATION_PROFILE_INVALID`
is reachable, not dead code). Future coverage: names, foreign terms, acronyms,
place names, domain terms, phonetic overrides.

## 11. Character voices

`characterVoices: []` — empty is valid and is the correct state for this
FACTUAL project (unused dialogue voices are never created). Mapping contract:
`speakerId, personaId?, provider, model, voiceId, styleDefaults?, language?`.
`CHARACTER_VOICE_CONFLICT` on duplicate `speakerId`, on a character reusing the
narrator's voice, and on an unknown character voice. Kokoro documents one
default voice per language, so a distinct same-language character voice is only
resolvable through the documented `KOKORO_VOICES` override — no second `en-us`
voice was invented (V13/V14).

## 12. Version semantics

Immutable files, one per version: `voice/voice-bible/vb-<12hex>.json`.
`persistVersion` refuses to overwrite an existing id (`VOICE_BIBLE_VERSION_CONFLICT`).

Semantic fingerprint = whole document minus `{voiceBibleId, version,
provenance.createdAt, provenance.source, provenance.approvalRef, fingerprint}`,
**plus** `provenance.rights` and `provenance.evidenceRefs`. Timestamps must not
fake a bump; a rights change must never be silently dropped.

Same content → `changed:false, deduped:true`, no write (V5). Meaningful change
(`voiceId / provider / model / language / speedDefault / persona tone /
prohibited pattern / pronunciationProfileRef / rights`) → new id, version+1,
previous version still loadable and byte-unchanged (V6).

## 13. Manifest integration

`project-manifest-1.4.0.schema.json` (new) = 1.3.0 + `voiceBibleVersion`.
`CURRENT_SCHEMA_VERSION` 1.3.0 → 1.4.0; 1.0.0–1.3.0 stay loadable.
Explicit migration `migrateSchema1_3_0_to_1_4_0` inserts
`{version:null, status:NOT_CREATED_YET}` — it never claims a bible exists where
none was provable. `migrateSchemaTo` now accepts a function for in-place slot
patches. A new `schemaAtLeast()` semver gate replaces two hardcoded `!==`
checks so the 1.2.0 recovery and 1.3.0 governance slots stay writable on 1.4.0.

Live reference: `version=vb-42744f223671`, `ref=voice/voice-bible/vb-42744f223671.json`,
`status=UNRESOLVED` (honest — see §15).

## 14. DAG/history/lock integration

`VOICE_BIBLE` added to `ARTIFACT_TYPES`, to the DAG `lockTarget` whitelist, and
to both `targetType` enums (`generation-history.schema.json`,
`recovery-state.schema.json`), plus `TARGET_TYPES` in code.

**One real edge added: `VOICE_BIBLE → VOICE` (`VOICE_IDENTITY`).** Roadmap 16
lists `VOICE_BIBLE → NARRATION_DIRECTION → TTS_AUDIO`, but `NARRATION_DIRECTION`
is a 2.2 artifact and `TTS_AUDIO` is not a DAG class — and roadmap 16 itself
forbids fake downstream nodes when no such audio exists. Deviation DEV-4.

Revision scoping: a bible version change dirties **only** the forward
descendants of `VOICE_BIBLE`. Verified: `VOICE` → DIRTY while `RESEARCH_PACK`
and `CREATIVE_BRIEF` stay CLEAN; `planRebuild` lists VOICE for rebuild and
reuses the unaffected branches (V17).

Locks: `VOICE_BIBLE` is a 1H.2 lock target. A locked config refuses `revise`
with `VOICE_BIBLE_LOCKED` and writes no version; explicit unlock (with the
required `expectedLockVersion`) → revise → v2 (V18).

## 15. Provenance / rights

```text
source = PROVIDER_DEFAULT   rights.status = UNRESOLVED   cloning = false
evidenceRefs = 4 (kokoro adapter, SETUP_KOKORO.md, CONFIG.yaml, this report)
```

No rights fabricated. No voice cloning (schema `const false`). A bible with
unproven rights is still a real persisted artifact — it is simply **not
production ready**, and the Manifest indexes it as `UNRESOLVED`, never
`VERIFIED`.

## 16. Workspace / lifecycle

Governance stack applied: Project Registry + Resolver + Guard +
lifecycle-at-creation. `phase2-1-validation` registered (kind VALIDATION,
ACTIVE). Path resolves via `resolveArtifactPath(root, pid, "VOICE", "DURABLE")`
→ `projects/phase2-1-validation/voice/voice-bible/` and is approved by
`validateWorkspacePath`. An unregistered project is refused **before any
directory is created** (V22). `check:workspace` → `ok:true, violations:[]`.

Lifecycle: schema/config + approved version + migration evidence = **DURABLE**;
test fixtures RETENTION_MANAGED; provider smoke audio EPHEMERAL; debug logs
EPHEMERAL. Unclassified fails safe to RETENTION_MANAGED + REVIEW_REQUIRED —
never disposable (V22/V23).

**DEV-1 (disclosed):** roadmap 35 *suggested* `projects/validation/phase-2/2.1/`.
Actual: `projects/phase2-1-validation/evidence/phase-2/2.1/`.
`providers/runtime/artifact-store.js` `resolveProjectPath` hardcodes
`root/projects/<projectId>`, so a nested registry path would make the resolver
and the artifact writer disagree about the truth. The flat `<phase>-validation`
form matches all 8 pre-existing phase validation projects; roadmap 35 permits a
"resolver-approved equivalent".

## 17. Extension impact

**Does 2.1 require user-facing voice selection/configuration inside Flow
Companion now? NO.** 2.1 is Core-first. Therefore: no Extension UI change, no
speculative controls, and the Extension suite was **not** re-run for ritual.
V28 proves the gate on the feature, not on `git status`: `git grep` finds no
`voiceBible` / `voice-bible` / `VoiceBible` string anywhere in `flow-companion/`.
Major Extension UI/UX redesign remains Phase 5.

## 18. Structured errors

All 14 roadmap codes are declared in `lib/voice-bible` `ERRORS` and each is
**reachable in a test** (fix F1 made this true — `persistVersion` had been
collapsing precise codes into a generic one):

```text
VOICE_BIBLE_NOT_FOUND  VOICE_BIBLE_SCHEMA_INVALID  VOICE_BIBLE_VERSION_CONFLICT
VOICE_BIBLE_LOCKED     VOICE_PROVIDER_UNSUPPORTED  VOICE_MODEL_UNSUPPORTED
VOICE_NOT_FOUND        VOICE_LANGUAGE_UNSUPPORTED  VOICE_LOCALE_UNSUPPORTED
VOICE_CONFIGURATION_INVALID
NARRATOR_PERSONA_INVALID  CHARACTER_VOICE_CONFLICT  PRONUNCIATION_PROFILE_INVALID
VOICE_RIGHTS_REVIEW_REQUIRED
```

Plus 4 implementation codes: `VOICE_BIBLE_WRITE_FAILED`,
`VOICE_BIBLE_PATH_NOT_ALLOWED`, `VOICE_BIBLE_LIFECYCLE_INVALID`,
`TARGET_NOT_FOUND`-class lock passthrough. Core returns the repo-standard
`{ok:false, code, message}` shape (as `project-manifest` / `dependency-dag` /
`generation-history` do) rather than inventing a second error mechanism.

## 19. Security / privacy

Never persisted: provider API key, OAuth token, cookie, Authorization header,
private key, raw env secret. Persisted instead: provider/model/voice ids,
version ids, semantic fingerprints, safe evidence refs. Two scanners
(`manifestLib.findSecretKeys` key-name + `historyLib.findSecretPastes` value
paste) run on every validate. Refused: `providerOptions.apiKey`,
`Authorization: Bearer …` in evidence refs, `bridge_token=…` in evidence refs,
post-hoc secret injection. Cloning is `const false` in the schema.
Future cloned/real-person voice consent is treated as protected governance
evidence, not as Voice Bible body content.

## 20. Observability

Five event classes added to `lib/telemetry` `EVENT_CLASSES`
(`VOICE_BIBLE_CREATED`, `_VALIDATED`, `_REVISED`,
`VOICE_SELECTION_RESOLVED`, `VOICE_SELECTION_REVIEW_REQUIRED`); four are in
`DURABLE_CLASSES` → `CANONICAL_DURABLE`, never sampled. **No telemetry schema
change needed** — `eventName` is `minLength:1` in the schema; the closed
vocabulary lives in code.

Correlation: `correlationId = operationId = voiceBibleId`, so
`getTrace(pid, voiceBibleId)` returns the whole bible lifecycle. Live project
holds 3 events, all correlated, all `CANONICAL_DURABLE`. Persisted identifiers
only — V25 asserts no `/sk-|Bearer |password/` shape in stored events.

## 21. Performance baseline

200 iterations, milliseconds, **configuration operations only — no TTS
synthesis benchmark (2.4)**:

| Operation | ms (warm) |
|---|---|
| `voiceSelectionResolveLatencyMs` | 0.010 |
| `voiceBibleValidateLatencyMs` | 0.087 |
| `voiceBibleWriteLatencyMs` | 0.252 |
| `voiceBibleLoadLatencyMs` | 0.310 |
| `manifestReferenceUpdateLatencyMs` | 0.357 |

Cold-start cost is a one-time ~19ms Ajv compile (observed on a 2-iteration
probe), a process-lifetime constant, not a per-operation cost. The probe
performs **no manifest mutation** — V16 asserts it cannot flip an `UNRESOLVED`
reference to a false `VERIFIED` (fix F2).

## 22. V1–V28

`node tests/voice-bible/test-voice-bible.js` → **187 assertions passed, 0 failed.**

```text
V1 valid persists ✓  V2 fresh process same version ✓  V3 invalid rejected ✓
V4 same version immutable ✓  V5 same-content idempotent ✓  V6 change → new version ✓
V7 Kokoro → normalized config ✓  V8 provider/model structured ✓  V9 unknown voice ✓
V10 language/locale fail-closed ✓  V11 speed ≠ measured WPM ✓  V12 persona validation ✓
V13 duplicate speaker refused ✓  V14 empty character voices valid ✓  V15 pron ref ✓
V16 Manifest reference correct ✓  V17 dirties only audio branch ✓  V18 lock prevents mutation ✓
V19 provenance traceable ✓  V20 unresolved rights fail safely ✓  V21 placement approved ✓
V22 guard rejects ad-hoc write ✓  V23 lifecycle correct ✓  V24 secret rejection ✓
V25 event correlation ✓  V26 golden regression ✓  V27 fresh-process consistency ✓
V28 Extension impact gate ✓
```

## 23. Targeted regression

```text
dag 156✓  recovery 75✓  history 109✓  project-manifest 69✓  telemetry 54✓
golden 63✓ + governance-regression 30✓  provenance 30✓  compliance 38✓
workspace 52✓  voice-bible 187✓  providers (Kokoro adapter: export-only change) ✓
```
Extension untouched → not re-run (roadmap 33).

## 24. Full regression

`npm test` → **25 domains, 0 failed suites, 317.6s** (compliance, cost, dag,
flow, golden, history, media, pipeline, platform, policy, project-manifest,
provenance, providers, qa, real-e2e, recovery, remotion, research,
research-deep, storage, story, telemetry, topic, voice-bible, workspace).
`node scripts/checks/validate-schemas.js` → `RESULT: ALL TESTS PASSED`.
`npm run check:workspace` → `ok:true`. `npm run check:repo-structure` →
`REPOSITORY_STRUCTURE_OK`. No weakened assertions, no added skips, no deleted
tests.

## 25. Open P2/P3

P0 = 0. P1 = 0. Full detail in
`projects/phase2-1-validation/evidence/phase-2/2.1/findings-phase-2-1.json`.

- **P2-1** — bible not production-ready: `PROVIDER_DEFAULT` selection +
  `UNRESOLVED` rights. Needs an operator-approved selection **and** proven
  Kokoro licence evidence. A blocker for production readiness (roadmap 26),
  not for this gate. Must not be closed by inventing an `approvalRef`.
- **P3-1** `providers/INDEX.md` logical-ID table is stale (omits
  `local-kokoro`) — now actively misleading about the V1 provider.
- **P3-2** `SETUP_KOKORO.md` documents `KOKORO_LANGS`/`KOKORO_MODEL` the adapter
  never reads; `KOKORO_VOICES` example is malformed.
- **P3-3** `audio-manifest.schema.json` rejects its own committed pilot data
  (`voiceId`/`language`/`providerId` absent from the item contract).
- **P3-4** `windows-sapi` recorded as a provider in committed pilot artifacts
  but not registered — a competing non-canonical voice record.
- **P3-5** Kokoro adapter substitutes a silent WAV while returning
  `status:"READY"` (`local-kokoro.js:170-172`) — a fabricated-audio path that
  contradicts its own correct language refusal. Flagged, **not** fixed (out of
  2.1 scope); also why 2.1 does not probe synthesis runtime.

**7 defects found and fixed during 2.1**, each at root cause and pinned by a
regression assertion: F1 collapsed structured error codes (P2), F2 perf probe
could write a false `VERIFIED` (P2), F3 root-cause check ordering (P2),
F6 DAG node left `NOT_CREATED_YET` with no lockTarget — the DAG misreported a
real artifact and silently opted out of locking (P2), F7 a second lockTarget
enum missed in `recovery-state.schema.json` (P3), F4 locale leaking onto
character voices (P3), F5 golden metric name colliding with the secret scanner
(P3 — renamed rather than weakening a security control).

## 26. Q1–Q28

All 28 PASS. Full per-item evidence in
`projects/phase2-1-validation/evidence/phase-2/2.1/quality-gate/phase-2-1-quality-gate.json`.

Q1 canonical versioned bible ✓ · Q2 persona structured ✓ · Q3 identity explicit ✓ ·
Q4 Kokoro V1, no VoiceStudio ✓ · Q5 normalized contract ✓ · Q6 language fail-closed ✓ ·
Q7 speed ≠ measured rate ✓ · Q8 pronunciation ref ✓ · Q9 character voices ✓ ·
Q10 immutable/loadable ✓ · Q11 revision → new version ✓ · Q12 manifest reference ✓ ·
Q13 DAG scoped ✓ · Q14 lock semantics ✓ · Q15 rights honest ✓ · Q16 no fabrication ✓ ·
Q17 workspace governance ✓ · Q18 lifecycle-at-creation ✓ · Q19 structured errors ✓ ·
Q20 secret/privacy ✓ · Q21 observability ✓ · Q22 perf baseline ✓ · Q23 V1–V28 ✓ ·
Q24 targeted regression ✓ · Q25 full regression ✓ · Q26 P0 = 0 ✓ · Q27 P1 = 0 ✓ ·
Q28 no premature 2.2+ behavior ✓

**Q16 passes precisely because the selection was left unresolved.** Marking the
provider-default voice as operator-approved would have failed Q16.

## 27. Final verdict

```text
TASK_VALIDATION = PASS
PHASE_2_1_QUALITY_GATE = PASS
PHASE_2_1 = COMPLETE
NEXT = PHASE 2.2 — NARRATION DIRECTOR VERIFICATION
```

No stop condition triggered: no fabricated selection (left `PROVIDER_DEFAULT`
+ `UNRESOLVED`), provider/model/voice resolved, language compatibility proven,
version-safe mutation, no conflicting Manifest/DAG truth, rights not guessed, no
secret persisted, workspace policy intact, full regression green, P0/P1 = 0.

Added: `lib/voice-bible/`, `schemas/voice-bible.schema.json`,
`schemas/project-manifest-1.4.0.schema.json`, `scripts/cli/voice-bible.js`,
`tests/voice-bible/`, `projects/phase2-1-validation/`, `gold-voice-bible:v1`
+ `b1`, 7 golden metrics, `VOICE_BIBLE` in 2 lockTarget/targetType vocabularies
+ `ARTIFACT_TYPES`, `VOICE` in `ARTIFACT_DIRS`, 5 telemetry classes, manifest
schema 1.4.0 + migration, `v1Provider` in CONFIG.yaml, registry entry,
11 new schema-validation cases. No Extension change. No synthesis, no credits.

**Do not begin Phase 2.2 until this gate is formally accepted.** P2-1 (an
operator-approved voice + proven rights) is the one input Phase 2.2 will need
before any narration is directed for production.