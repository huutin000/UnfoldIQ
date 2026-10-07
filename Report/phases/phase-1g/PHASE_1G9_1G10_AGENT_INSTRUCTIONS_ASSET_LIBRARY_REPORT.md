# PHASE 1G.9 + 1G.10 — COMBINED PROMPT 01
# FLOW AGENT INSTRUCTIONS MANAGER + REFERENCE / ASSET LIBRARY REPORT

Date: 2026-10-03 (FIX 03 hands-free closure: 2026-10-04)
Roadmap: V6 — Scope Frozen
Previous gate: `TASK_VALIDATION = PASS / PHASE 1G.8 — OUTPUT / COST / CREDIT PLANNER = COMPLETE` (verified in-repo before any edit)

```text
TASK_VALIDATION = PASS
PHASE 1G.9 = COMPLETE (STAGE_A_1G9 = PASS; FIX 02 live-verified 2026-10-04 §59;
             FIX 03 HANDS-FREE APPLY VERIFIED 2026-10-04 §61)
PHASE 1G.10 = COMPLETE (Stage B gates all green, see §60)
BLOCKERS = []
NEXT = PHASE 1G.11 — STRUCTURAL / SEMANTIC / VISUAL FACTUALITY / CONTINUITY QA
```

HISTORICAL / SUPERSEDED (2026-10-03 intro — true then; the live gate was
closed by FIX 02 §59 and the hands-free chain by FIX 03 §61, and Stage B
completed per §60): the original run implemented the full deterministic
Stage A core while the live gate awaited an operator-authenticated session.

## 1. Status

Stage A deterministic core: COMPLETE and tested. Stage A live gate: VERIFIED
(FIX 02 §59, operator-assisted final write; superseded for the apply chain by
FIX 03 §61 — hands-free apply/persistence/readback verified 2026-10-04).
Stage B: COMPLETE (§60). Full `npm test` 0 failed (291.3s, 13 domains, FIX 03
final run); extension suite 525/525; FIX 03 suite 94/94; plumbing 76/76;
schemas + structure green; instruction-scope generations / credits = 0.

FIX 03 (2026-10-04, operator-requested closure of the §59 residual): the
extension now performs the ENTIRE apply chain hands-free — automated editor
write → automated Done/save → save confirmation (editor unmounts) →
close/reopen → provider readback → semantic compare MATCH → sync VERIFIED
(`sy-8e0ac1726008`), plus idempotent re-apply `NO_OP_ALREADY_SYNCED` →
VERIFIED with no duplicate (`sy-afc793497133`). Operator text entry = 0.
See §61 for the full live gate (LIVE-A1…A17), root-cause record, and the
syncId-collision incident + reconstruction disclosure.

HISTORICAL / SUPERSEDED (FIX 01 continuation, 2026-10-03 — statement "no live
apply path exists" was true then and is superseded by FIX 02 §59 and FIX 03
§61): pre-flight re-green (flow 0 failed; extension 525/525 after 2 sidepanel
fixes, see §58); §5 candidate set compiled from real pilot-sky-blue sources,
validated and persisted (`iv-94f3ffebb441`, FP `780ccba50d2f1498`, REFS=[]).
Instruction-scope generations/credits remain 0; one unrelated
operator-driven test image (GEN01, Flow Companion media job) exists on
disk outside FIX 01 authorization and is flagged, not counted.

## 2. Entry Gate

1G.5/1G.6/1G.7/1G.8 reports all `TASK_VALIDATION = PASS`. Live contracts
re-verified: 1G.5 owns visual/render strategy (render modes intact,
provider-neutral); 1G.6 owns registry/resolution/costs (seed intact);
1G.7 owns platform adaptation; 1G.8 owns output/cost/budget (candidate
gating + family contexts intact); Prompt Compiler without targetKind →
`PROMPT_TARGET_REQUIRED`. No ENTRY_GATE_FAIL; no earlier phase patched
(only additive schema-check instances for the two new schemas).

## 3. Repository Capability Audit

| Component | Class | Disposition + reason |
|---|---|---|
| `flow-companion/bridge/` (server, job-store, state-machine, importer, manual-assist, safety-refusal, security, path-policy) | **B** | reusable execution/message/job infrastructure; extended with pure `instruction-sync.js` contract only, no server changes |
| `flow-companion/extension/src/content/flow-page-adapter.js` (AGENT_MODE detect, settings read incl. Always/Never labels, zero-credit dry-run) | **B** | extended with 1G.9 Instructions selectors + read-only detect/extract functions in-file; SELECTORS_VERSION 3→4 per file rule |
| `flow-companion/extension/tests/` (mock-flow-page, FakeElement harness, 519-assert suite) | **A** | harness pattern reused for adapter unit coverage in the node suite; extension suite itself untouched and green |
| `scripts/diagnostics/flow-companion-doctor.js`, `provider-doctor.js` | **B** | left alone (static health green); live-detection extension deferred to the live pass |
| `providers/runtime/artifact-store.js`, `request-fingerprint.js` | **A** | reused as-is for instruction/sync persistence |
| `core/VISUAL_BIBLE.md`, `projects/*/visual-bible.json`, `continuity-registry.json` | **B** | real source structures; compiler consumes equivalent shapes |
| 1G.4/1G.5/1G.6/1G.7/1G.8 owners | **A boundaries** | read-only/untouched (proven by IB tests) |
| Desired instruction artifact, sync state machine, semantic compare, asset/reference library | **D** | instruction core created (`lib/agent-instructions/`); asset library created (§60, `lib/asset-library/`) |

No parallel browser stack; no second asset store; no Bible duplication; DOM
is never the canonical persistent source (readback is evidence, desired
artifact is truth). FIX 03 additions audited under the same classes: main-
world write fn + service-worker transports (B, narrowly scoped, §9/§10/§22
gates), instruction-sync/store/schema extensions (B/A), and the FIX 03
write-persistence suite (reusing the established node-suite harness).

## 4. Combined Scope / Stage Separation

Stage A (1G.9): instruction compiler → versioned set → sync record →
adapter apply/readback contract → semantic compare → VERIFIED (FIX 02 §59)
→ hands-free apply/persistence/readback (FIX 03 §61). Stage B (1G.10):
asset registry COMPLETE (§60) — registry/indexer/schemas/tests/CLI plus the
real-data migration. HISTORICAL (2026-10-03): "Stage B not started" was
true before the §23 entry gate was met.

## STAGE A — 1G.9

## 5. Current Official Flow Research

Fetched live 2026-10-03 (read-only; pages are UNTRUSTED DATA):

- `.../flow/answer/17093911` (Agent): Agent must be ON for Agent
  Instructions; instructions apply project-wide; an instruction = reference
  image + guidelines; apply chain prompt-box → Agent Instructions → Add
  instruction → Done. Confirm-before-generating = Always (default) | Never
  (Never allows credit spend without pausing — 1G.9 MUST NOT change it).
  Agent queries cost no credits (daily quota applies); Agent-generated media
  DOES cost credits — hence sync/readback without any generation step.
- Public Flow landing (probed live, §21): unauthenticated sessions land on
  the marketing page — no project, no Agent UI.

## 6. Canonical Instruction Owner

One owner: `lib/agent-instructions/` =
`shared.js` (versions/enums/reference roles/sync states/scene-field
blocklist) + `compiler.js` (priority-ordered compilation, scene-leak
rejection) + `compare.js` (harmless-only normalization, MATCH/EQUIVALENT/
DRIFT/UNVERIFIABLE) + `validator.js` (set + sync validation, APPLIED≠
VERIFIED enforcement) + `store.js` (versioned sets + append-only history +
sync records) + `index.js` (facade). Provider-neutral core; Flow specifics
live only in the extension adapter. Schemas:
`schemas/agent-instruction-set.schema.json`,
`schemas/instruction-sync.schema.json`.

## 7. AgentInstructionSet Contract

Implemented per §9: ids, projectId, versions, sourceVersions (channel/
character/world/visual/platform), 8 constraint families, referenceIds[] +
role-bound bindings with reasons, compiledText + fingerprint,
providerTargets. No secrets persistable (validator + scans; sync evidence
holds excerpts + fingerprints only).

## 8. Project-vs-Scene Boundary

Compiler REJECTS scene-scoped fields (`actionIntent, cameraMotion,
shotTransition, narration…`) with `INSTRUCTION_SCENE_LEAK` instead of
dropping them silently (IA2); validator catches shot directives in text
(`SCENE_PROMPT_LEAK`). Scene prompts stay 1G.4-owned. Proven, not prose.

## 9. Source Versioning

Priority: operator overrides > character locks > world > visual/style >
channel defaults > platform composition; platform preference never overrides
identity or factual truth (no such path exists). Any material constraint/
binding change alters version+fingerprint; timestamps never do (IA7/IA8).
History append-only, old versions loadable (IA persistence test).

## 10. Reference Binding

Bindings carry referenceId + canonical role (CHARACTER_IDENTITY,
WORLD_LOCATION, STYLE, PALETTE, PROJECT_GUIDE) + reason; non-canonical
roles rejected at compile. Compatible with 1G.10 canonical IDs by design
(plain string IDs + roles, no provider display-name dependence).

## 11. Provider Sync Contract

`InstructionSync` per §15 (ids, versions, fingerprints, provider +
projectRef, apply/readback/compare slots, binding echo, evidenceRefs,
syncStatus). Bridge module `flow-companion/bridge/instruction-sync.js`
(pure, no DOM/network): `buildApplyPlan` (project binding + agent-state
gates, exact steps incl. VERIFY_PROJECT first, forbidden list),
`validateSyncEvidence` (rejects model/output-count/settings/secret keys),
`transitionSync` (APPLIED→READBACK_PENDING→compare-gated VERIFIED/DRIFT).

## 12. Exact Flow Project Binding

`buildApplyPlan` refuses ambiguous identity
(`BLOCKED_PROJECT_IDENTITY_UNKNOWN`) and cross-project mutation
(`BLOCKED_PROJECT_MISMATCH`) before any mutation step. No cross-project
mutation is representable in the contract.

## 13. Agent Mode Handling

Adapter detects Agent mode read-only (`detectFlowAgentMode`, pre-existing);
apply plan turns Agent ON only when required (`ensureAgentOn` flag) and
never touches Confirm-before-generating, default models, or output counts
(forbidden list + evidence validation + IB scans). Unknown agent state →
`BLOCKED_AGENT_STATE_UNKNOWN`, no blind action (IS2).

## 14. Apply Evidence

Canonical sequence encoded in `APPLY_STEPS`; bridge records apply evidence
(attempt id, status, timestamp) into the sync record. `click Done` yields
`APPLIED` at most — the state machine has no path from apply to VERIFIED
without compare evidence (IS5 + IB gate test prove it).

## 15. Provider Readback

`extractInstructionReadback` (adapter, read-only): reads visible instruction
text + attached reference names/ids from the actual page; returns
`{available:false, reason}` when the surface is missing/unreadable — never
the attempted payload, never success toasts. Unit-tested against mock DOM.

## 16. Semantic Compare

`compareInstructionReadback`: harmless-only normalization (whitespace,
wrapping, separators, equivalent bullets); MATCH (byte-equal, refs complete),
EQUIVALENT (representation-only diff), DRIFT (missing constraint/reference,
contradiction — IR3/IR4/IR5), UNVERIFIABLE (no readback). Missing identity
rules, palette/name changes, negations, and extra contradictions are never
normalized away.

## 17. Reference Readback

Text match without required references → DRIFT (`MISSING_REFERENCE`, IR5);
transition to VERIFIED requires non-empty provider reference ids when
bindings exist. Ambiguous identity → `UNVERIFIABLE_REFERENCE` path via
unavailable readback (adapter returns no ids; compare cannot confirm).

## 18. UI Drift / Provider Doctor

Selector ownership stays in the adapter (SELECTORS_VERSION 6; trigger/
add/editor/done adopted VERIFIED with FIX 02 §9 live evidence; readback
+ reference-attach keys remain NOT_VERIFIED by convention — readback
reads editor VALUES).
`detectInstructionsSurface`/`buildInstructionDiagnostics` report per-control
state and are surfaced in the sidepanel apply log on every refusal
(FIX 03), so UI drift is observable live; anything missing fails safe
upstream (BLOCKED_AGENT_STATE_UNKNOWN / INSTRUCTION_SELECTORS_NOT_VERIFIED
/ INSTRUCTION_CONTROL_AMBIGUOUS). The pre-write Done-control health gate
(task §21) runs before any mutation. FIX 03 additionally observes live
drift: panel-open hides the Agent pill (known deadlock, now auto-closed
after readback), and server hydration after reopen required the bounded
15s readback poll.

## 19. Zero-generation / Zero-credit Proof

Core + bridge scans: no execute/fetch/network/browser/click calls, no
Generate/settings/output logic, no secret access (IB suite scans all 7
files). Extension suite green (519/519) confirms no generation-path
regression. No Agent query is needed for instruction sync by design.

## 20. 1G.9 Test Matrix

`tests/flow/test-agent-instructions.js`: 73/73 (live-corrected readback
contract). `tests/flow/test-live-instruction-plumbing.js`: **76 passed,
0 failed** (FIX 03 round). `tests/flow/test-instruction-bridge.js`: 19
asserts. `tests/flow/test-instruction-write-persistence.js` (FIX 03
§61): **94 passed, 0 failed** — WP1–WP13 write-persistence gates +
MW1–MW4 main-world write function + TI1–TI5 trusted-input security gates
(§22 allowlist/tab/URL/detach surface) + SV1–SV3 bridge/store contract
incl. the FIX 03-R1 syncId-collision guard. IA/IS/IR/IB core groups
unchanged (70-assert origin). IS3/IS4/IS6/IS7/IR6 live-evidence steps are
covered by the FIX 02 §59 + FIX 03 §61 live records.

## 21. 1G.9 Live Gate

CLOSED — current state (2026-10-04, FIX 02 §59 + FIX 03 §61):

```text
STAGE_A_1G9 = PASS
LIVE_FLOW_SYNC = VERIFIED_HANDS_FREE (FIX 03 §61, sy-8e0ac1726008)
LIVE_FLOW_READBACK = VERIFIED (provider-derived, post-reopen)
INSTRUCTION_REFERENCES = NOT_APPLICABLE (REFS=[] per §14, no invention)
INSTRUCTION_APPLY_IDEMPOTENCY = VERIFIED (sy-afc793497133 NO_OP, no duplicate)
OPERATOR_TEXT_ENTRY = 0
MEDIA_GENERATIONS = 0
CREDITS_SPENT = 0
```

HISTORICAL / SUPERSEDED: the original probe record below (2026-10-03) proved
the gate BLOCKED before an authenticated session existed — marketing page
only, no project, no Agent UI, bridge token-gated with no session, zero
stored auth state; LIVE1–LIVE12 = BLOCKED/NOT_PERFORMED at that time; the
blocker `OPERATOR_LOGIN_REQUIRED` was resolved in FIX 02 (§58–59) and the
apply chain was closed hands-free in FIX 03 (§61). No statement above is a
current limitation.

Probe record (all read-only, 2026-10-03): bridge unreachable
(ECONNREFUSED 127.0.0.1:4317, not started — starting it yields no session);
repo/machine has zero stored Google auth state (no storage-state, profile,
or session artifacts); `doctor:flow` covers static health only; a
playwright browser opened to Flow lands unauthenticated on the public
marketing page (no project, no Agent UI); completing login needs the
operator's Google credentials (forbidden for the agent to handle) and any
project mutation needs explicit operator authorization on an identified
project. Per §25:

```text
1G.9 = PARTIAL
BLOCKER = LIVE_FLOW_INSTRUCTION_VERIFICATION_REQUIRED
1G.10 = NOT_STARTED
```

What the live pass will need (nothing more): operator-authenticated browser
profile (or supervised login ceremony) + identified Flow project ref + approval
to apply one instruction set; then IS3–IS7/IR6 run against real readback.
FIX 01 reran this gate 2026-10-03 with fresh live evidence (§57): still
BLOCKED at project-identity/agent-state/selector-health — no mutation
attempted, correctly.

## 22. STAGE_A_1G9 Final Verdict

```text
STAGE_A_1G9 = PASS (deterministic core COMPLETE + green; live gate VERIFIED
hands-free by FIX 02 §59 + FIX 03 §61, 2026-10-04)
```

Stage B entry gate met — unlocked 2026-10-04.

## STAGE B — 1G.10

## 23. Stage B Entry Gate

MET 2026-10-04 (STAGE_A_1G9 = PASS + verified sync artifact
`channel-mascot/instruction-sync/sy-4f2e4f010241.json` with syncStatus
VERIFIED + instructionVersion `iv-7e784d73e229`). Stage B executed to
completion (§60); §§24–44 below are the current-state one-line summaries
pointing at §60.

## 24. Canonical Asset Owner

COMPLETE — `lib/asset-library/` (registry.js + indexer.js + index.js) reusing artifact-store, media-probe, bridge path-policy conventions. See §60.
## 25. AssetRecord Contract

COMPLETE — `schemas/asset-record.schema.json` (registered + accept/reject instances) with roadmap registry fields + instructionVersion + derivedFrom[] + rights/provenance + qualityStatus + selection + lock. See §60.
## 26. Asset Types / Roles

COMPLETE — image/video types, BROLL-style roles validated by schema; GEN01 records live. See §60.
## 27. Source / Provider Mapping

COMPLETE — provider refs as external mapping only; migration records unverified origin explicitly. See §60.
## 28. Content Hash / Dedup

COMPLETE — sha256 content hash; duplicate bytes return the existing assetId (`deduplicated:true`), re-indexing adds nothing (proven live on GEN01 webp pair). See §60.
## 29. Lineage

COMPLETE — derivedFrom[] with unknown-parent/self refusal + transitive chain with cycle failsafe. See §60.
## 30. Cost/Attempt Linkage

COMPLETE — records link to generation artifacts via lineage; no invented costs. See §60.
## 31. Agent Instructions Version Linkage

COMPLETE — linkInstruction + E2E resolving the real VERIFIED set iv-7e784d73e229 (FP 778e8299f5dd0265). See §60.
## 32. Reference Relationships

COMPLETE — role-bound relationships in the record contract (compatible with 1G.9 reference roles). See §60.
## 33. Flow Ingredient / Character Mapping

COMPLETE — Character Bible supremacy preserved; nothing inverted. See §60.
## 34. Selection / Quality Status

COMPLETE — SELECTED/REJECTED/UNSET + UNREVIEWED/APPROVED/REJECTED with timestamps; invalid transitions refused. See §60.
## 35. Approved / Reference Locks

COMPLETE — lock requires a reason; every mutator except unlock refuses locked records (ASSET_LOCKED); live lock gate on as-1186233d1af6. See §60.
## 36. Derived / Replacement Assets

COMPLETE — derivedFrom[] lineage covers derived/replacement chains. See §60.
## 37. Rights / Provenance

COMPLETE — UNKNOWN default, never invented; migration records unverified origin explicitly. See §60.
## 38. Persistence / Index

COMPLETE — `projects/<projectId>/assets/library-index.json` via artifact-store atomic writes. See §60.
## 39. Legacy Migration

COMPLETE — real CLI migration indexed existing media without renaming/rewriting (postv1b 2+1 dedup, pilot-sky-blue 8, postv1 4). See §60.
## 40. Real Existing Asset Indexing

COMPLETE — indexer run on real projects; GEN01_attempt-01.png measured 32x32; live-1g1-http308 reported honestly (no assets dir, nothing fabricated). See §60.
## 41. Reference Reuse Gate

COMPLETE — dedup-hit returns the canonical id (proven live + unit). See §60.
## 42. Approved Lock Gate

COMPLETE — post-lock mutation refused ASSET_LOCKED on real data. See §60.
## 43. Dedup Gate

COMPLETE — byte-identical pair proved one record (4522B × 2). See §60.
## 44. Lineage Gate

COMPLETE — cycle/unknown-parent refusals unit-proven. See §60.
## 45. 1G.10 Test Matrix

Done (§60): `tests/flow/test-asset-library.js` — 41 asserts covering
record contract, hash/dedup, lineage (+cycle/unknown), locks/immutability,
selection/quality, rights/provenance, instruction linkage, indexer honesty,
combined E2E.

## 46. Combined E2E

PERFORMED (§60, test AL7): asset linked to instructionVersion
iv-7e784d73e229 resolves to the real VERIFIED set (FP 778e8299f5dd0265);
real migration + live lock gate close the provider↔registry loop.

## 47. Schemas

Added and registered with accept/reject instances:
`schemas/agent-instruction-set.schema.json`,
`schemas/instruction-sync.schema.json` (Stage A), `schemas/asset-record.schema.json`
(Stage B §60). FIX 03 extended `instruction-sync.schema.json` with optional
`automationMode` / `writeTransport` / `operatorTextEntry` / `previousSyncRef`
(+2 instances). Historical (2026-10-03): "no asset schemas" was true before
Stage B executed. No documentation-only schemas.

## 48. Targeted Regression

FIX 01 rerun 2026-10-03: `flow` 15/15 in 35.7s (incl. 70-assert 1G.9
suite) + schemas ALL PASSED + `check:repo-structure` OK + extension suite
519/519. Outside Stage A owner + bridge contract + adapter selectors +
schema registrations, only additive test/schema-check changes exist. No
new code was written by FIX 01.

FIX 03 (2026-10-04): new `tests/flow/test-instruction-write-persistence.js`
94/94; plumbing suite updated to the FIX 03 contract (76/76); adapter suite
green; extension suite 525/525; schemas ALL PASSED (2 new instruction-sync
instances); doctors + `check:repo-structure` OK. Owner files only (adapter,
commands, runtime, sidepanel, service-worker, bridge instruction routes,
lib/agent-instructions store, schema, validate-schemas) — no 1G.1–1G.8,
provider-runtime, platform, or asset-library owner rewritten.

FIX 01 continuation: 2 sidepanel fixes (phantom prep-failure banner on
already-READY jobs via new pure `prepToastAction` in
`src/ui/state/auto-prepare.js`; dead "Xem kết quả" via bridge
`deliveredArtifact` hydration + fallback toast) + 2 regression tests
(extension 525/525, was 519) + rebuilt `.output/chrome-mv3` (operator
reloaded the extension; banner gone, result card renders with the real
artifact path, verified on disk). `flow` 0 failed (35.6s);
`check:repo-structure` OK. 1G.9 deterministic core untouched by these
fixes (adapter selectors, compiler, bridge sync contract unchanged).

## 49. Full Regression

`npm test` executed continuously under the standing host security state (no
SAC gate; project rule from 1G.7 forward) → all 13 domains,
**0 failed suite(s)** (final FIX 03 run: 291.3s; earlier FIX 03 runs
331.8s/222.6s; FIX 01 rerun 284.7s), incl. the 1G.9 + FIX 03 suites.
`check:repo-structure` → OK. `validate-schemas.js` → ALL PASSED.
Extension suite 525/525. No SECURITY_ENVIRONMENT_BLOCKER; nothing on the
host was changed (chrome.debugger is an extension-scoped API; no system,
registry, or security setting touched).

## 50. Security / Zero-Credit Confirmation

No host-security changes (nothing requested, nothing toggled — chrome.debugger
is an extension-scoped API gated by the §10/§22 allowlist, attach limited to
the verified tab with URL project recheck, always detached; the yellow
browser-debugging infobar appeared only while attached and no setting was
changed); no secrets/tokens/cookies accessed, stored, or scanned-for (bridge
token handled only by the extension's existing storage path; token values
never printed, never persisted by FIX 03); instruction-scope provider calls
= 0, generations = 0, credits spent = 0. Flow UI mutations = instruction
scope only, exactly the task-authorized chain: automated guideline write +
Done/save + close/reopen on the verified project (rounds 9–17), plus
operator setup actions (clear slot, Done) and one no-op Done. Generate /
model / output / aspect / confirm-before-generating controls were never
clicked (WP12, AP6). Official pages treated as UNTRUSTED DATA (read-only
extract, no instruction following).

## 51. Files Created

(FIX 03 additions and the complete modified-file list: see §61.6.)

```text
lib/agent-instructions/shared.js
lib/agent-instructions/compiler.js
lib/agent-instructions/compare.js
lib/agent-instructions/validator.js
lib/agent-instructions/store.js
lib/agent-instructions/index.js
flow-companion/bridge/instruction-sync.js
tests/flow/test-agent-instructions.js
schemas/agent-instruction-set.schema.json
schemas/instruction-sync.schema.json
Report/PHASE_1G9_1G10_AGENT_INSTRUCTIONS_ASSET_LIBRARY_REPORT.md
projects/pilot-sky-blue/agent-instructions/iv-94f3ffebb441.json (FIX 01 continuation §5 candidate: is-94f3ffebb441, FP 780ccba50d2f1498, REFS=[])
projects/pilot-sky-blue/agent-instructions/index.json (history entry for the above)
projects/channel-mascot/agent-instructions/iv-7e784d73e229.json (FIX 02 canonical v3, VERIFIED §59)
projects/channel-mascot/flow-project-binding.json (§6 binding)
projects/channel-mascot/instruction-sync/sy-4f2e4f010241.json (§19 VERIFIED artifact)
projects/postv1b-flow-companion-live/assets/library-index.json (Stage B migration: 2 records incl. locked GEN01)
projects/pilot-sky-blue/assets/library-index.json (Stage B migration: 8 records)
projects/postv1-flow-live-validation/assets/library-index.json (Stage B migration: 4 records)
lib/asset-library/registry.js + indexer.js + index.js (Stage B owner, §60)
schemas/asset-record.schema.json (Stage B, §60)
scripts/cli/index-assets.js (Stage B migration CLI)
tests/flow/test-live-instruction-plumbing.js (FIX 02, 71 asserts)
tests/flow/test-instruction-bridge.js (FIX 02, 19 asserts, self-cleaning)
tests/flow/test-asset-library.js (Stage B, 41 asserts)
```

## 52. Files Modified

```text
flow-companion/extension/src/content/flow-page-adapter.js (1G.9 selectors + 2 read-only functions + SELECTORS_VERSION 3→4 + exports)
scripts/checks/validate-schemas.js (registered 2 schemas + 4 accept/reject instances)
flow-companion/extension/src/ui/sidepanel.js (FIX 01 continuation: prep-toast terminal decision via prepToastAction; lastResult hydration from deliveredArtifact; result-CTA fallback toast)
flow-companion/extension/src/ui/state/auto-prepare.js (FIX 01 continuation: exported pure prepToastAction + terminal decision rule)
flow-companion/extension/tests/run.js (FIX 01 continuation: 2 regression tests / 6 asserts for prepToastAction)
flow-companion/extension/.output/chrome-mv3/{src/ui/sidepanel.js,src/ui/state/auto-prepare.js} (rebuilt via node build.js, 29 files BUILD_OK)
```

FIX 03 modified-file list: see §61.6. Across all fix rounds, no 1G.1–1G.8,
provider-runtime, or platform owner was rewritten; bridge instruction
routes and lib/agent-instructions store were extended additively (FIX 02/03).
No root code added.

## 53. Files Deleted

None. No fix-*/debug-*/temp-* artifacts created (browser snapshots from the
read-only probe were removed after inspection; tmp test roots live in the OS
temp dir, outside the repo).

## 54. Known Limitations

Current-state limitations (all others from earlier stages are historical /
superseded — see §57–§61 chronology):

- CDP trusted-input transport (`chrome.debugger`, FIX 03 §10/§22 fallback)
  is implemented, gated, and security-tested, but live rounds showed it
  adds no benefit over the lower-privileged transports on the current Flow
  editor: `Input.dispatchKeyEvent` did not land (KEYTEXT_VERIFY_FAILED,
  round 14) and `Input.insertText` offers no advantage over DOM-commit +
  persistence boundary (rounds 5–7). It remains available as a fallback
  with a strict allowlist (Input.insertText / per-char keyDown+keyUp only),
  verified-tab + project-URL attach gate, and mandatory detach.
- The apply chain's winning transport on current Flow UI is
  `ISOLATED_SYNTHETIC_EVENTS` with the commit model proven by live round 9:
  Done commits the guideline textarea's DOM value. The acceptance gate is
  the independent persistence boundary (save confirm + close/reopen +
  provider readback + semantic compare), not a pre-Done framework ack
  (no React props are exposed on the editor — fingerprint evidence §61).
- Provider hydration after reopen is server-backed; the readback poll is
  bounded at 15s. Slower backend responses than that would surface as
  honest READBACK_PENDING (never a false VERIFIED).
- Reference bindings remain NOT_APPLICABLE for channel-mascot (REFS=[]):
  verified attach plumbing + file bytes are still future work.
- `INSTRUCTION_READBACK` / `INSTRUCTION_REFERENCE_ATTACH` selectors remain
  NOT_VERIFIED by file convention (readback reads editor VALUES; the
  readback-surface key itself is unobserved).
- One incident (FIX 03-R1, disclosed §61): a live attempt overwrote the
  VERIFIED sync record `sy-4f2e4f010241` via deterministic syncId
  collision. The record was reconstructed verbatim from report §59 with a
  provenance note; a uniqueness guard + regression test now prevent it.

## 55. Acceptance Checklist

Stage A (§71): (1) one owner ✓ (2) project≠scene ✓ (3) deterministic
constraints ✓ (4) version hygiene ✓ (5) project binding — contract green,
live unproven (6) apply — contract green, live unproven (7) reference
attach — contract green, live unproven (8) readback — extractor green on
mocks, live unproven (9) drift detection ✓ (10) MATCH/EQUIVALENT — logic
green, live unproven (11) persistence fields ✓ (12) 0 generations ✓ (13) 0
credits ✓ (14) settings untouched ✓ (15) earlier artifacts intact ✓ (16)
live proof ✗ → PARTIAL (historical — superseded by the FIX 02/FIX 03
update lines below).
FIX 02 update: live proof ✓ (MATCH readback + VERIFIED sync artifact §59) → STAGE_A_1G9 = PASS.
FIX 03 update: hands-free proof ✓ — criteria 3 (extension writes full text
automatically), 4 (no operator text entry), 5 (Flow application state
accepts the write — persistence boundary §61), 6 (extension performs
Done/save), 7 (save survives close/reopen), 10 (new hands-free sync
artifact VERIFIED), 11 (same-set reapply creates no duplicate) all
demonstrated live (`sy-8e0ac1726008` + `sy-afc793497133`).
Stage B (§72): criteria 1–21 unmet by gate (NOT_STARTED, no partial credit
claimed for unbuilt work) — HISTORICAL, superseded by §60 (all green).

## 56. Final Verdict

```text
TASK_VALIDATION = PASS
PHASE 1G.9 = COMPLETE (STAGE_A_1G9 = PASS; FIX 02 live-verified §59;
             FIX 03 HANDS-FREE APPLY = VERIFIED §61, 2026-10-04)
PHASE 1G.10 = COMPLETE (Stage B gates all green, §60)
BLOCKERS = []
NEXT = PHASE 1G.11 — STRUCTURAL / SEMANTIC / VISUAL FACTUALITY / CONTINUITY QA
```

Stage A closed 2026-10-04 with live hands-free evidence (§61). STOP: no 1G.11/1G.12/1H/Phase-2 work started.

## 57. FIX 01 Live Evidence (2026-10-03, read-only, no mutation)

Authorization scope honored: zero provider mutations, zero credentials
handled, zero host-security changes. Deterministic core untouched (no
1G.9 source rewritten — no defect found by live evidence because no live
surface was reachable).

Pre-flight (existing repo commands only):

```text
tests/flow/test-agent-instructions.js → 70 passed, 0 failed
doctor:flow → all OK (selectors NOT_VERIFIED placeholders, adapter centralized)
doctor:provider → flow origins ORIGIN_COVERED, uiSelectors NOT_VERIFIED, live generation NOT_VERIFIED
```

Bridge (canonical `flow-companion/bridge/run.js` server, already running):

```text
GET http://127.0.0.1:4317/health → 401 {"error":"TOKEN_REJECTED"}
bridgeReachable (network) = true; authenticated session = NONE (token value never read)
No duplicate bridge/browser implementation created.
```

Live browser probe (playwright-cli, isolated in-memory headless session,
read-only snapshot + text finds, no clicks/fills/login/generation):

```text
Page URL = https://flow.google.com/about (public marketing page, NOT an authenticated project)
Page Title = Google Flow - AI Creative Studio for Video, Images & Custom Tools
find "Agent Instructions" → No matches found
Agent/project UI = ABSENT (no project, no Agent mode control, no Instructions surface)
```

Stored-auth scan: `STORED_AUTH:NONE` (no storage-state/profile/session
artifacts in repo or standard local paths). Canonical tab resolver
(`resolveLiveFlowTab`) requires an open Flow-origin tab answering PING —
no such tab exists in this environment, so no resolution was attempted
beyond the read-only landing probe (no extension attach, no PING sent).

Canonical instruction-set check (no set persisted under any
`projects/*/agent-instructions/`; fresh compile validates the contract):

```text
COMPILE:true FP:03ed77f193c63c6e (test-shape inputs, deterministic)
VALID:true
buildApplyPlan (no contentScript, no projectRef, no agentState)
  → PLAN_OK:false CODE:BLOCKED_CONTENT_SCRIPT_DISCONNECTED
  (+ BLOCKED_PROJECT_IDENTITY_UNKNOWN / BLOCKED_AGENT_STATE_UNKNOWN entailed)
```

Selector health (live): `detectInstructionsSurface` on the observed surface
→ all five controls false; `extractInstructionReadback` →
`{available:false, reason:READBACK_SURFACE_MISSING}` (fails safe, never the
attempted payload). SELECTORS_VERSION stays 4; no placeholder replaced
(no verified selector exists to replace from). Agent mode: unreadable
(no Agent control on marketing page) → ENSURE_AGENT_ON not reached; no
Confirm/model/output setting touched.

Live test IDs (FIX 01 outcome):

```text
LIVE1 authenticated Flow project detected → BLOCKED (marketing page only)
LIVE2 exact project identity verified → BLOCKED_PROJECT_IDENTITY_UNKNOWN (no mutation)
LIVE3 Agent state safely resolved → BLOCKED_AGENT_STATE_UNKNOWN (no blind action)
LIVE4 Instructions surface selectors verified → NOT_VERIFIED (drift check done, no replacement)
LIVE5 instruction applied → NOT_PERFORMED (gated)
LIVE6 required references attached → NOT_PERFORMED (gated)
LIVE7 provider state read back → NOT_PERFORMED (surface missing by evidence)
LIVE8 semantic compare MATCH/EQUIVALENT → NOT_PERFORMED (no readback)
LIVE9 sync artifact persisted VERIFIED → NOT_PERFORMED (no artifact fabricated)
LIVE10 no Confirm-before-generating mutation → HELD (nothing touched)
LIVE11 no default model/output mutation → HELD (nothing touched)
LIVE12 zero media generation / zero credits → HELD (MEDIA_GENERATIONS=0, CREDITS_SPENT=0)
```

Regression after probe (host security untouched):

```text
flow suite 15/15 (35.7s) · full npm test 0 failed (284.7s, 13 domains)
FIX 02 final regression: full `npm test` 0 failed (248.6s, 13 domains) + extension 525/525 + doctors + structure OK (see §59).
extension suite 519/519 · validate-schemas ALL PASSED · check:repo-structure OK
```

Gate result of FIX 01:

```text
STAGE_A_1G9 = PARTIAL (deterministic core COMPLETE + green; live gate BLOCKED)
LIVE_FLOW_SYNC = NOT_PERFORMED
LIVE_FLOW_READBACK = NOT_PERFORMED
INSTRUCTION_REFERENCES = COMPILED_NOT_VERIFIED
BLOCKER = OPERATOR_LOGIN_REQUIRED (subsumed by LIVE_FLOW_INSTRUCTION_VERIFICATION_REQUIRED)
1G.10 = NOT_STARTED
NEXT = FIX 1G.9 ONLY (operator-authenticated session + identified project ref + apply approval)
```

## 58. FIX 01 Continuation — Live-Gate Attempt 2 (2026-10-03, operator-requested)

Scope honored: zero instruction mutations, zero credentials handled, zero
host-security changes, zero provider generation caused by FIX 01.
Deterministic 1G.9 core untouched (no defect found; suite re-green after
unrelated sidepanel fixes, §48).

Pre-flight (existing repo commands only):

```text
flow suite → 0 failed (35.7s→35.6s rerun, incl. 70-assert 1G.9 suite)
extension suite → 525/525 (519 + 2 new prepToastAction regression tests)
doctor:flow → static OK · doctor:provider → ORIGIN_COVERED, uiSelectors NOT_VERIFIED
check:repo-structure → OK
bridge 127.0.0.1:4317 → reachable, token-gated (earlier TOKEN_REJECTED
recovered by single-instance restart; operator re-entered token, "remember" held)
operator browser → authenticated (liveTab ping=true, media job
FLOW-COMPANION-LIVE-GEN-01 ran READY→imported; OPERATOR_LOGIN_REQUIRED gone)
```

§5 canonical set (canonical compiler only, no hand-written browser text;
mapping is verbatim source strings, nothing invented):

```text
projectId = pilot-sky-blue (sources: content-mode.json visualDirection
"flat vector diagrams, sky-blue system, spectrum accents" + continuity
entity STYLE_SKY_SYSTEM LOCKED vb-pilot-1; no character/world sources → omitted, not invented)
instructionSetId = is-94f3ffebb441
instructionVersion = iv-94f3ffebb441
compiledFingerprint = 780ccba50d2f1498
referenceIds[] = [] (no canonical refs exist: 1G.10 asset library NOT_STARTED)
VALID = true → persisted projects/pilot-sky-blue/agent-instructions/iv-94f3ffebb441.json
buildApplyPlan (agent session: no contentScript, no projectRef, no agentState)
  → PLAN_OK:false BLOCKED_CONTENT_SCRIPT_DISCONNECTED|BLOCKED_PROJECT_IDENTITY_UNKNOWN|BLOCKED_AGENT_STATE_UNKNOWN
(contract gates correctly — no mutation path taken)
```

§4 project identity: BLOCKED_PROJECT_IDENTITY_UNKNOWN — only local
projectIds exist; operator named no Flow project, and no provider-visible
ref was established. No mutation attempted, correctly.

§6 selector health: NOT_VERIFIED, unchanged — placeholders intact;
`buildLiveDiagnostics` (adapter:4042) does not report the instruction
surface, so no live observation exists to verify against.

§7 agent mode: live-observed STANDARD (Agent OFF) from the operator page
diagnostics — read-only, no change made (correct while gated).

§§8–12: NOT_PERFORMED with structural cause (not a retry issue):
(1) content-command dispatch (`content-commands.js`) has 12 commands and
zero instruction-apply commands; (2) bridge `server.js` has 12 routes and
zero instruction routes; (3) writing a new mutation command now would
violate the file's own rule (selectors NOT_VERIFIED, verify-first) and §4
(unknown project). No sync record started (nothing provider-evidenced to
record — fabricating one would be a false VERIFIED).

Live test IDs (attempt 2 outcome):

```text
LIVE1 authenticated Flow project detected → PARTIAL (session live, ping=true; project ref not established)
LIVE2 exact project identity verified → BLOCKED_PROJECT_IDENTITY_UNKNOWN
LIVE3 Agent state safely resolved → OBSERVED STANDARD (no change, gated)
LIVE4 Instructions surface selectors verified → NOT_VERIFIED (surface unobservable live)
LIVE5 instruction applied → NOT_PERFORMED (no live apply path exists)
LIVE6 required references attached → NOT_PERFORMED (no canonical refs; REFS=[])
LIVE7 provider state read back → NOT_PERFORMED
LIVE8 semantic compare MATCH/EQUIVALENT → NOT_PERFORMED
LIVE9 sync artifact persisted VERIFIED → NOT_PERFORMED (none fabricated)
LIVE10 no Confirm-before-generating mutation → HELD
LIVE11 no default model/output mutation → HELD
LIVE12 zero media generation / zero credits (instruction scope) → HELD
  (note: one operator-driven test image GEN01 exists on disk from a Flow
  Companion media job outside FIX 01 authorization — flagged, uncounted)
```

Gate result of attempt 2 (unchanged verdict, refined blocker):

```text
STAGE_A_1G9 = PARTIAL (deterministic core COMPLETE + green; live gate BLOCKED)
LIVE_FLOW_SYNC = NOT_PERFORMED
LIVE_FLOW_READBACK = NOT_PERFORMED
INSTRUCTION_REFERENCES = COMPILED_NOT_VERIFIED
BLOCKER = NO_LIVE_INSTRUCTION_APPLY_PATH + BLOCKED_PROJECT_IDENTITY_UNKNOWN
  (subsumed by LIVE_FLOW_INSTRUCTION_VERIFICATION_REQUIRED)
1G.10 = NOT_STARTED
NEXT = FIX 1G.9 ONLY — unblock needs, in order: (a) operator names the ONE
Flow project + its provider-visible ref; (b) read-only instruction-surface
plumbing (diagnostics/probe) to verify selectors live; (c) one reviewed
instruction-apply content command behind the existing sync contract; then
rerun §§8–12. No 1G.10 work started.
```

## 59. FIX 02 — LIVE PASS (2026-10-03 → 2026-10-04, operator Chrome tab)

All authorization boundaries held: one instruction set, one verified
project, zero instruction-scope generations/credits, no Confirm/model/
output/aspect change, no host-security change, no credentials handled.
GEN01 remains OUT_OF_SCOPE_EXISTING_MEDIA_JOB (kept separate, untouched).

Live results (operator's real Chrome + extension + bridge; no Playwright):

```text
LIVE1 authenticated Flow tab = VERIFIED (tabId 1466563613→1466563711, origin flow.google.com, ping=true, SESSION_REVALIDATED)
LIVE2 exact project identity = VERIFIED (url-router HIGH ref 8221824c-a1a6-4aa9-8d6b-fac24860d49e; address-bar + DOM extraction agree; binding channel-mascot→ref persisted, bridge check BOUND)
LIVE3 Agent state = VERIFIED (AGENT live-observed; pill state signal read)
LIVE4 instruction selectors = VERIFIED (trigger aria-primary + add/done text-channel + editor textarea[aria-label="Instruction description"], all adopted §9 with uniqueness + bounded-mount gates)
LIVE5 instruction apply = APPLIED (sy-4f2e4f010241, iv-7e784d73e229, BOUND, 2026-10-03T15:04:53Z automated path; final text placed by operator-assisted write of the identical canonical v3, path A)
LIVE6 references = NOT_APPLICABLE (REFS=[]; set valid per §14, no reference invented)
LIVE7 provider state read back = VERIFIED (reopen + READ_AGENT_INSTRUCTIONS, project ref + full guidelines + refs=0)
LIVE8 semantic compare = MATCH (byte-equal, 0 differences, FP 778e8299f5dd0265 both sides)
LIVE9 sync artifact persisted VERIFIED (sy-4f2e4f010241, verifiedAt 2026-10-04T01:56:00Z, validator VALID=true)
LIVE10 no Confirm-before-generating mutation = HELD
LIVE11 no default model/output mutation = HELD
LIVE12 instruction-scope generations = 0 (HELD)
LIVE13 instruction-scope credits = 0 (HELD)
```

Gate (§24): STAGE_A_1G9 = PASS; PROJECT_IDENTITY = VERIFIED;
LIVE_FLOW_SYNC = VERIFIED; LIVE_FLOW_READBACK = VERIFIED;
INSTRUCTION_SEMANTIC_COMPARE = VERIFIED (MATCH);
INSTRUCTION_REFERENCES = NOT_APPLICABLE;
INSTRUCTION_SCOPE_GENERATIONS = 0; INSTRUCTION_SCOPE_CREDITS = 0.
PHASE 1G.10 ENTRY GATE = UNLOCKED.

Stale-statement corrections (supersede earlier attempt sections):
- §21/§57/§58 "live gate BLOCKED / NOT_PERFORMED" → closed by this section.
- §18 "no verified selector observed" → 4 selectors adopted with live
  evidence (record §59-evidence above); readback/reference-attach stay
  NOT_VERIFIED/MISSING by rule (correct: unobserved / not-applicable).
- §20 matrix: + `tests/flow/test-live-instruction-plumbing.js` (71 asserts)
  + `tests/flow/test-instruction-bridge.js` (19 asserts); 1G.9 suite 73/73
  (one readback test updated after live proved container-text reads wrong).
- §§3/11/15: "no live apply path" → APPLY_AGENT_INSTRUCTIONS +
  READ_AGENT_INSTRUCTIONS (dispatcher) + POST /instruction/apply +
  POST /instruction/evidence (bridge) + panel Apply/Đọc buttons; all gated,
  tested, zero-credit.
- §12 binding: `projects/channel-mascot/flow-project-binding.json`
  (channel-mascot → 8221824c-…, GOOGLE_FLOW, no secrets).
- §17 reference readback: REFS=[] → NOT_APPLICABLE per §14 (no invention).
- Known residual (honest at the time; SUPERSEDED by FIX 03 §61 live
  evidence — the "does not survive" observation was a readback-vs-server
  hydration race plus cross-strategy text concatenation; Done does commit
  the textarea's DOM value, and the FIX 03 chain proves hands-free
  apply/persistence/readback end to end): automated editor writes verify
  in-DOM but were observed not to survive Flow's Done/save (synthetic
  events incl. trusted insertText path); final text placed operator-assisted
  (path A). Nothing was faked: every failed write surfaced as
  DRIFT/EMPTY/OCCUPIED/AMBIGUOUS, never VERIFIED.

Files (FIX 02, additive except noted test correction):
```text
lib/agent-instructions/binding.js (new, §6 owner)
lib/agent-instructions/store.js (+loadLatestInstructionSet, additive)
lib/agent-instructions/index.js (+facade entries, additive)
flow-companion/bridge/instruction-sync.js (+validateApplyPayload)
flow-companion/bridge/server.js (+2 routes, shared projectId gate)
flow-companion/extension/src/content/flow-page-adapter.js (identity, diagnostics, apply gating, readback-by-value, slot selection, trusted write, TEXT_FALLBACKS, SELECTORS_VERSION 6)
flow-companion/extension/src/content/content-commands.js (APPLY + READ, cmds3)
flow-companion/extension/src/ui/sidepanel.js + sidepanel.html (dev Apply/Đọc)
scripts/diagnostics/flow-companion-doctor.js + provider-doctor.js (read-only §20 lines)
tests/flow/test-live-instruction-plumbing.js (new, 71 asserts)
tests/flow/test-instruction-bridge.js (new, 19 asserts, self-cleaning)
tests/flow/test-agent-instructions.js (1 readback test corrected to editor-value contract after live proof)
projects/channel-mascot/agent-instructions/iv-cf9583674d69.json (v1 superseded)
projects/channel-mascot/agent-instructions/iv-8860138959df.json (v2 superseded)
projects/channel-mascot/agent-instructions/iv-7e784d73e229.json (v3 canonical, FP 778e8299f5dd0265)
projects/channel-mascot/agent-instructions/index.json
projects/channel-mascot/flow-project-binding.json
projects/channel-mascot/instruction-sync/sy-4f2e4f010241.json (VERIFIED)
```

Regression (§27): full `npm test` 0 failed (248.6s, 13 domains) +
extension 525/525 + doctors + structure OK, host security untouched.

## 60. STAGE B — 1G.10 COMPLETE (2026-10-04)

Entry gate was met (§23); Stage B executed from FIX 02 §25 + roadmap V6
§1G.10 (no separate combined-prompt file exists in-repo; these two sources
are the full spec used). No 1G.9 core rewritten.

Owner (new, reuse-first): `lib/asset-library/` = `registry.js` (record,
hash/dedup, lineage, locks, selection/quality, rights, instruction link) +
`indexer.js` (real existing-asset migration) + `index.js` (facade).
Reused, not duplicated: `providers/runtime/artifact-store.js`
(persistence), `lib/media-probe.js` PNG header measurement, bridge
`path-policy` conventions. No new framework, no second store.

Canonical record (`schemas/asset-record.schema.json`, registered +
accept/reject instances in validate-schemas): roadmap registry fields +
instructionVersion + derivedFrom[] + rights/provenance + qualityStatus +
selection + lock. Layout: `projects/<projectId>/assets/library-index.json`.

Gates (all enforced in code, all proven by `tests/flow/test-asset-library.js`, 41 asserts):
- ASSET_DEDUP: sha256 content hash; duplicate bytes return the existing
  assetId (`deduplicated:true`), never a second record; re-indexing adds nothing.
- ASSET_LINEAGE: derivedFrom[] with unknown-parent/self refusal +
  transitive chain with cycle failsafe.
- REFERENCE_LOCK + APPROVED_ASSET_IMMUTABILITY: lock needs a reason; every
  mutator except unlock refuses locked records (ASSET_LOCKED); no generic
  update API exists so identity fields are structurally immutable.
- Selection/quality: SELECTED/REJECTED/UNSET + UNREVIEWED/APPROVED/REJECTED
  with timestamps; invalid transitions refused.
- RIGHTS/PROVENANCE: UNKNOWN default, never invented; migration records
  unverified origin explicitly.
- AGENT_INSTRUCTIONS_VERSION_LINKAGE: linkInstruction + E2E resolving the
  real VERIFIED set iv-7e784d73e229 (FP 778e8299f5dd0265).

Real migration (CLI `scripts/cli/index-assets.js`, evidence = index files):
postv1b-flow-companion-live 2 indexed + 1 deduped; pilot-sky-blue 8;
postv1-flow-live-validation 4; live-1g1-http308 no assets dir (reported,
nothing fabricated). GEN01_attempt-01.png measured 32x32.
Live lock gate on real data: `as-1186233d1af6` (GEN01_attempt-01.png)
locked as approved reference; post-lock mutation refused ASSET_LOCKED.
GEN01 webp pair proved byte-identical via dedup (4522b × 2 → one record).

Reference reuse (§41): dedup-hit returns the canonical id (proven live +
unit). Legacy files were observed/indexed, never renamed/rewritten (§39).

Regression: full `npm test` 0 failed (268.0s, 13 domains) + extension
525/525 + doctors + structure OK.

## 61. FIX 03 — HANDS-FREE PERSISTENT APPLY (2026-10-04, LIVE PASS)

Task: `D:\Downloads All\PHASE_1G9_FIX_03_FINAL_HANDS_FREE_PERSISTENT_APPLY.md`.
Goal: prove the exact chain `canonical AgentInstructionSet → extension writes
full text automatically → Flow accepts Done/save → close/reopen → provider
readback → semantic compare MATCH → VERIFIED hands-free` on the real
operator Chrome Flow project, with OPERATOR_TEXT_ENTRY = 0.

### 61.1 Root-cause record (evidence-driven, §7 of the task)

Seventeen live rounds on the operator Chrome tab (tabId 1466563711→1466563777,
origin flow.google.com, project ref 8221824c-a1a6-4aa9-8d6b-fac24860d49e)
isolated the true causes of the FIX 02 residual, each fixed in code:

1. **Isolated-world writes were never the problem.** Live round 9 proved
   Done COMMITS the guideline textarea's DOM value: the chain's automated
   Done persisted DOM text (the provider later showed it). The FIX 02
   "never survives Done/save" observation was confounded by (2) and (3).
2. **Readback vs server hydration race.** Flow persists the instruction to
   its backend on Done; the reopened dialog hydrates from the server
   seconds after mount. The old single-read readback (and later a 5s poll)
   raced that fetch and misreported SUCCESSFUL saves as READBACK_EMPTY
   (rounds 5, 9). Fix: 15s bounded readback poll (last honest observation
   wins) + hydration-stability wait before slot selection (3 identical
   consecutive editor reads) so a hydrating slot is never treated as empty.
3. **Cross-strategy text concatenation.** Round 9's doubled/flattened
   instruction blob came from strategy A's DOM write being APPENDED to by
   strategy B (selection not effective). Fix: clearInstructionEditor
   between failed strategies; whitespace-normalized slot matching (mirrors
   compare.js harmless normalization) so provider-normalized text is
   recognized as the same instruction, never re-applied nor clobber-refused.
4. **Missing commit-on-blur.** A real mouse click on Done blurs the editor
   first; el.click() does not. Fix: explicit editor blur + 200ms settle
   before Done.
5. **Framework ack was the wrong gate.** The editor exposes no React props
   (fingerprint evidence); REACT_PROPS never fires, BROWSER_INPUT_EVENTS
   acks do not predict persistence, and CDP Input.dispatchKeyEvent did not
   land (KEYTEXT_VERIFY_FAILED, round 14). Per task §8, acceptance is now
   the independent persistence boundary: save confirmed (editor unmounts)
   → close/reopen → provider-derived readback → compareInstructionReadback.
   DOM presence alone can never read VERIFIED (WP1/WP3 enforced there).
6. **Panel-open deadlock.** An open dialog hides the Agent pill, so a run
   left open blocked the next run's agent gate (rounds 8, 16). Fix: the
   chain closes the dialog (no-op Done) after its readback.
7. **Deterministic syncId collision (FIX 03-R1 incident).** `id12` seeded
   on (version, provider ref) made a second apply of the same set reuse the
   old syncId and OVERWRITE the VERIFIED record `sy-4f2e4f010241` (round
   2). Fix: unused-id re-seed loop in startInstructionSync (bounded, 64) +
   SV3 regression test. The overwritten record was reconstructed verbatim
   from §59's documented state with an explicit provenance note in
   evidenceRefs (createdAt approximated from appliedAt; readbackAt not
   recoverable → null). Disclosed here; no evidence was invented.

### 61.2 Implementation (owners preserved per §6; only the write/persist path changed)

```text
NEW  flow-companion/extension/src/content/main-world-write.js
       self-contained page-world write fn (chrome.scripting world:"MAIN"):
       native setter + input/change (REACT_PROPS ack) → execCommand
       fallback; bounded non-secret evidence, no text echo.
NEW  service-worker transports: MAIN_WORLD_INSTRUCTION_WRITE (data-only
       spec, fixed injected fn) and INSTRUCTION_TRUSTED_INPUT (§10 last
       resort: chrome.debugger attach ONLY to the sender's verified Flow
       tab, tab-URL project recheck, allowlist = Input.insertText +
       per-char Input.dispatchKeyEvent, detach in finally on
       success/failure/timeout; no Network/Storage/Cookie/DOM/Runtime).
MOD  flow-page-adapter.js: applyInstructionGuidelines (strategy ladder
       MAIN_WORLD → CDP trusted input → ISOLATED_SYNTHETIC, clear-between-
       strategies, normalized slot match); ADAPTER_VERSION 0.4.13-fix03.
MOD  content-commands.js: full §12 sequence (VERIFY_PROJECT →
       VERIFY_SELECTORS incl. Done health pre-write → ENSURE_AGENT_ON →
       OPEN → hydration-stability wait → slot select → write ladder →
       blur+settle → DONE → save-confirm → close/reopen → readback poll →
       evidence) + NO_OP full-boundary idempotency + auto-close after
       readback; CONTENT_COMMANDS_VERSION 0.4.13-fix03-cmds4.
MOD  content-runtime.js (ctx transports), sidepanel.js (one-click chain +
       detailed strategies logging), manifest.json v0.5.3 (+debugger
       permission), build.js (+main-world-write.js).
MOD  bridge: instruction-sync.js (HANDS_FREE ⊕ operatorTextEntry
       contradiction blocker), server.js (previousSyncRef lineage
       auto-pointer + hands-free metadata intake), store.js (syncId
       uniqueness, metadata persistence, latestVerifiedSync),
       agent-instructions/index.js (+latestVerifiedSync).
MOD  schemas/instruction-sync.schema.json (+automationMode, writeTransport,
       operatorTextEntry, previousSyncRef) + validate-schemas instances.
```

### 61.3 Live gate (task §24) — all items LIVE-proven on the operator Chrome

```text
LIVE-A1  real Chrome tab resolved               = VERIFIED (ping=true, SESSION_REVALIDATED)
LIVE-A2  exact project identity                 = VERIFIED (8221824c-…, BOUND, BLOCKED_PROJECT_MISMATCH enforced WP10)
LIVE-A3  Agent state                            = VERIFIED (BLOCKED_AGENT_STATE_UNKNOWN enforced on wrong surface, WP-gated)
LIVE-A4  instruction selectors                  = VERIFIED (trigger/editor/done/add VERIFIED + exactly-one counts)
LIVE-A5  canonical artifact loaded              = VERIFIED (iv-7e784d73e229, FP 778e8299f5dd0265, bridge-loaded, never hard-coded)
LIVE-A6  automated editor write                 = VERIFIED (sy-8e0ac1726008, transport ISOLATED_SYNTHETIC_EVENTS, DOM-verified)
LIVE-A7  automated Done/save                    = VERIFIED (saveConfirmed=true — editor unmounted)
LIVE-A8  close/reopen persistence boundary      = VERIFIED (reopen + provider readback available)
LIVE-A9  provider readback                      = VERIFIED (readbackFingerprint cb988f8b695b4f7b, payload never used as fallback WP5)
LIVE-A10 semantic compare                       = MATCH (0 differences)
LIVE-A11 new hands-free sync artifact           = VERIFIED (sy-8e0ac1726008: HANDS_FREE, operatorTextEntry=false, previousSyncRef chain)
LIVE-A12 second identical APPLY                 = NO_OP_ALREADY_SYNCED → VERIFIED, no duplicate (sy-afc793497133)
LIVE-A13 Confirm-before-generating unchanged    = HELD (no settings path in the chain; AP6/WP12)
LIVE-A14 default model/output settings unchanged = HELD (no model/output code in the chain; WP12)
LIVE-A15 instruction-scope generations          = 0
LIVE-A16 instruction-scope credits              = 0
LIVE-A17 operator text entry                    = 0 (operator only: reload extension, clear-slot setup before round 15, click Apply)
```

Key sync records (all under `projects/channel-mascot/instruction-sync/`,
full failed-round chronology preserved as honest history):
`sy-8e0ac1726008` = the hands-free VERIFIED apply (write→save→reopen→
readback→MATCH); `sy-afc793497133` = idempotent NO_OP → VERIFIED;
`sy-4f2e4f010241` = FIX 02 record, reconstructed after the R1 incident
(provenance note inside).

### 61.4 Tests (task §25) + regression (§30)

``tests/flow/test-instruction-write-persistence.js` — 94 asserts, 0 failed:
WP1 DOM-only write can never read VERIFIED (persistence-boundary enforced) ·
WP2 framework-compatible write chain · WP2b transport preference +
boundary-decided verdict · WP3 never-landed write withholds Done ·
WP4/WP4b reopen returns persisted provider text incl. delayed hydration ·
WP5 attempted payload cannot fake readback (DRIFT passes through) ·
WP6 failed save → not APPLIED · WP7 failed readback → READBACK_PENDING ·
WP8/WP8b identical re-apply NO_OP (raw + provider-normalized), no
duplicate · WP9 HANDS_FREE ⊕ operatorTextEntry blocked · WP10 wrong
project cannot write · WP11 ambiguous selector cannot write · WP12
generation/model controls untouched · WP13 main-world module surface scan ·
MW1–MW4 write-fn contract (ack, DOM-only rejection, missing editor, no
text echo) · TI1 exact-tab/URL gates · TI2+TI6 debugger allowlist static
scan (3 sendCommand sites, Input.* only, single attach + finally-detach) ·
TI3/TI3b canonical text via CDP transports · TI5 permission-blocked
refusal surfaced · SV1 hands-free VERIFIED chain · SV2 store lineage
metadata · SV3 syncId-collision guard.

Regression under standing host security state (no SAC toggling):
`npm test` → **0 failed suite(s), 13 domains** (final run 291.3s);
`flow` domain 0 failed (incl. FIX 03 suite 94/94, plumbing 76/76,
1G.9 core 73/73, 1G.10 asset-library 41 asserts); extension suite
**525/525**; `validate-schemas` ALL PASSED; `doctor:flow` OK;
`doctor:provider` instruction lines OK; `check:repo-structure` OK.
Bridge restarted twice during the fix to load server-side changes
(token unchanged, persistent token file honored).

### 61.5 §31 PASS criteria — 21/21 met

1 exact project verified · 2 canonical artifact sole text source · 3
extension writes full text automatically · 4 no operator text entry · 5
Flow state accepts the write (persistence boundary) · 6 extension
performs Done/save · 7 save survives close/reopen · 8 provider-derived
readback · 9 compare MATCH · 10 hands-free sync artifact VERIFIED · 11
no duplicate on reapply · 12 no settings/model/output mutation · 13 no
media generation · 14 no credits · 15 trusted-input gates pass (TI suite;
fallback unused in the final run) · 16 1G.10 fully green · 17 historical
lineage intact (all 19 sync records preserved; R1 record reconstructed
with disclosure) · 18 canonical report consistent (§27–§29 scan) · 19
targeted regression passes · 20 full regression passes · 21 no 1G.11
work started.

### 61.6 Files

```text
Created: flow-companion/extension/src/content/main-world-write.js;
         tests/flow/test-instruction-write-persistence.js
Modified: flow-companion/extension/src/content/{flow-page-adapter.js,
         content-commands.js, content-runtime.js}; src/ui/sidepanel.js;
         src/background/service-worker.js; manifest.json (v0.5.3,
         +debugger); build.js; flow-companion/bridge/{server.js,
         instruction-sync.js}; lib/agent-instructions/{store.js,
         index.js}; schemas/instruction-sync.schema.json;
         scripts/checks/validate-schemas.js; tests/flow/
         test-live-instruction-plumbing.js (FIX 03 contract updates);
         projects/channel-mascot/instruction-sync/* (19 records, incl.
         sy-4f2e4f010241 reconstruction); rebuilt .output/chrome-mv3.
```
