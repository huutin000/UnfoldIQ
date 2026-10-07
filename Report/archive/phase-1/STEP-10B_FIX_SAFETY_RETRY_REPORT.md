# STEP 10B-FIX SAFETY RETRY REPORT

## 1. Status

PASS

## 2. Problem addressed

STEP 10B handled technical retries and QA rejection but had no dedicated
provider-safety refusal workflow: a safety-refused prompt would either die or
risk a blind identical retry. This FIX adds `PROVIDER_SAFETY_REFUSED` as a
first-class state distinct from Step 09 `BLOCKED` (terminal), with SAFE
REPRESENTATION ADAPTATION — same story beat and factual claims, genuinely
different non-graphic visual — bounded to 2 adapted attempts, every
credit-consuming retry approval-gated, then safe fallback. Evasion
(obfuscation, prompt-splitting, age tricks) is detected and rejected, never
assisted.

## 3. Files created

| File Path | Purpose |
|---|---|
| `D:\Project\UNFOLDIQ\flow-companion\bridge\safety-refusal.js` | Classifier (8 classes), Level 1–3 planner, evasion/age guards, budget, fallback, job helpers |
| `D:\Project\UNFOLDIQ\schemas\safety-prompt-adaptation.schema.json` | Adaptation record contract |
| `D:\Project\UNFOLDIQ\test-flow-safety-retry.js` | SR1–SR20 executable tests |
| `D:\Project\UNFOLDIQ\Report\STEP-10B_FIX_SAFETY_RETRY_REPORT.md` | This report |

## 4. Files modified

| File Path | Key Changes |
|---|---|
| `D:\Project\UNFOLDIQ\flow-companion\bridge\state-machine.js` | 4 new states + transitions; adapted-budget guard; new-attempt + cleared-approval on PREPARED adaptation |
| `D:\Project\UNFOLDIQ\flow-companion\bridge\job-store.js` | Added `updateJob` (refusal/adaptation metadata merge) |
| `D:\Project\UNFOLDIQ\flow-companion\bridge\manual-assist.js` | Additive refusal/adaptation/next-action packet fields |
| `D:\Project\UNFOLDIQ\flow-companion\extension\src\content\flow-page-adapter.js` | 3 NOT_VERIFIED refusal selectors + `detectRefusal` (observe-only; classification stays bridge-side) |
| `D:\Project\UNFOLDIQ\flow-companion\extension\src\contracts\job-contract.js` | Status mirror extended |
| `D:\Project\UNFOLDIQ\schemas\flow-job.schema.json` | Status enum + store fields already present; enum extended with 4 safety states |
| `D:\Project\UNFOLDIQ\providers\CONFIG.yaml` | `safetyRetryPolicy.maxAdaptedGenerationAttempts: 2` |
| `D:\Project\UNFOLDIQ\validate-schemas.js` | +safety-prompt-adaptation schema with valid/invalid tests |

## 5. Commands executed

| Command | Result | Key Output |
|---|---|---|
| `node test-flow-safety-retry.js` | PASS | 34 assertions, 0 failed |
| `node test-flow-jobs.js` | PASS | 34 assertions, 0 failed |
| `node test-flow-state-machine.js` | PASS | 15 assertions, 0 failed |
| `node test-flow-bridge.js` | PASS | 15 assertions, 0 failed |
| `node test-flow-page-adapter.js` | PASS | 20 assertions, 0 failed |
| `node test-flow-download-import.js` | PASS | 15 assertions, 0 failed |
| `node test-flow-manual-assist.js` | PASS | 12 assertions, 0 failed |
| `node test-provider-core.js` | PASS | 43 assertions, 0 failed |
| `node test-continuity.js` | PASS | 20 assertions, 0 failed |
| `node test-duration-planning.js` | PASS | 37 assertions, 0 failed |
| `node test-policy-rights.js` | PASS | 26 assertions, 0 failed |
| `node validate-schemas.js` | PASS | 19 schemas valid incl. safety-prompt-adaptation |
| `cd flow-companion/extension; npm test` | PASS | passed=6 failed=0 |
| `npm run build` | PASS | BUILD_OK 8 files MV3 |

No Flow calls, no credits, no network, no production media. Fixture project `__flow10b_fix__` removed after run.

## 6. SR1–SR20 evidence

| Case | Expected | Actual | Status |
|---|---|---|---|
| SR1 | refusal → PROVIDER_SAFETY_REFUSED | outcome adapt, SAFETY_ADAPTATION_REQUIRED, MINOR_SAFETY | PASS |
| SR2 | Step 09 BLOCKED terminal | POLICY_BLOCK_TERMINAL; job untouched at GENERATING | PASS |
| SR3 | minor Level 1/2, no evasion | Level 2, ALLOW_ADAPTED_RETRY, approval required, clean | PASS |
| SR4 | violence reframed, intent kept | intent phrase survives; no affirmative gore | PASS |
| SR5 | claims preserved | ["CLM-001","CLM-002"] verbatim | PASS |
| SR6 | continuity preserved | ["CHAR_MOTHER_01","CHAR_INFANT_01"] verbatim | PASS |
| SR7 | VB version + schema | record validates; vb-test-1 preserved | PASS |
| SR8 | approval gate | PREPARED → AWAITING_USER_APPROVAL | PASS |
| SR9 | no approval blocks | APPROVAL_REQUIRED on adapted GENERATING | PASS |
| SR10 | attempt increments | 1 → 2 | PASS |
| SR11 | history preserved | original prompt kept; currentPrompt separate; refusal in history | PASS |
| SR12 | second bounded adaptation | adaptedCount 2, outcome adapt | PASS |
| SR13 | limit → fallback | 3rd refusal → SAFE_FALLBACK_REQUIRED | PASS |
| SR14 | fallback variants | approved-asset/diagram/text/manual-handoff | PASS |
| SR15 | evasion rejected | LEETSPEAK + SPLITTING flagged; evasive plan refused | PASS |
| SR16 | age tricks rejected | adult-age claim fails; honest reframe passes | PASS |
| SR17 | unknown cautious | UNKNOWN_SAFETY → Level 2 + packet carries refusal/status/action | PASS |
| SR18 | credit honesty | UNKNOWN default; explicit receipt recorded | PASS |
| SR19 | attempts preserved | attempt 2, refusal states in history | PASS |
| SR20 | 10B machine intact | classic PENDING→…→READY still works | PASS |

## 7. Minor-safety example

TEST-ONLY scene S05 (family sheltering; infant safe in adult's arms):
refused prompt `close-up of an injured child covered in blood…` →
classified MINOR_SAFETY → Level 2 plan:
`distant indirect view at LOC_CAMP_01: the group protects vulnerable members
from danger. Same subjects (CHAR_MOTHER_01, CHAR_INFANT_01), same wardrobe,
same lighting and time of day; silhouette, shadow, distant framing,
off-screen event, environmental evidence. Wide, restrained composition;
nothing graphic shown.`
Intent kept ("the group protects vulnerable members from danger"); restricted
depiction removed; age honest; approval required.

## 8. Violence/gore example

Same scene, `GRAPHIC_VIOLENCE` refusal → Level 1 NON_GRAPHIC_REFRAME:
aftermath/damaged environment/reaction shot, no visible injuries, no blood;
factual narration may stay while visuals stay non-graphic. No gore invented
for engagement; nothing the research did not support is added.

## 9. Context preservation evidence

SR5/SR6/SR7/SR11: claim IDs verbatim, entity IDs verbatim, Visual Bible
version untouched, original prompt stored separately from `currentPrompt`,
full refusal/adaptation history on the job. The adaptation schema test
additionally proves a Level 2 record validates end-to-end.

## 10. Continuity preservation evidence

Adapted plans carry the same `CHAR_MOTHER_01`/`CHAR_INFANT_01`,
`WARDROBE_MOTHER_01`, `LOC_CAMP_01` context (SR6 + packet continuity block);
Level 2 explicitly keeps mother identity, wardrobe, camp, lighting, and time
of day while hiding the restricted depiction. No substitute character is
generated because the first prompt was refused.

## 11. Approval/credit evidence

SR8/SR9: adapted retries return to AWAITING_USER_APPROVAL; GENERATING without
a fresh approval throws APPROVAL_REQUIRED. SR18: `creditOutcome` is UNKNOWN
unless explicit receipt evidence exists (then recorded verbatim). No retry
assumes the refused attempt was free.

## 12. Retry-bound evidence

SR12: second refusal within budget adapts again (adaptedCount 2).
SR13: third refusal → `SAFE_FALLBACK_REQUIRED`, never a third mutation.
Budget constant `MAX_ADAPTED_GENERATION_ATTEMPTS = 2`, mirrored in
`CONFIG.yaml` (`safetyRetryPolicy.maxAdaptedGenerationAttempts: 2`).

## 13. Safe fallback evidence

SR14: `selectFallback` returns approved-asset (rights-cleared first choice),
diagram, text, or manual-handoff. SAFE_FALLBACK_REQUIRED transitions only to
MANUAL_ASSIST_REQUIRED or CANCELLED — never back into silent generation.

## 14. Security/policy evidence

- Evasion patterns rejected (SR15): leetspeak/zero-width, prompt-splitting,
  instruction-override, encoding tricks, euphemism swaps.
- Age misrepresentation rejected (SR16).
- Step 09 BLOCKED terminal (SR2): no rewrite path exists.
- Adapter observes only (new `detectRefusal` returns message/state; no exact-string dependency; no private APIs); classification lives bridge-side.
- Manual-assist refusal packets never coach filter bypass (packet carries refusal + next lawful action only).

## 15. Regression evidence

All §5 commands PASS: 10B suites (FJ 34, FS 15, BR 15, FP 20, DI 15, MA 12),
provider-core 43, continuity 20, duration 37, policy-rights 26, 19 schemas,
extension test 6/6 + MV3 build. State-machine extension is additive: classic
happy path re-verified in SR20.

## 16. Context Loaded

| Path | Requirement | Loaded | Purpose |
|---|---|---|---|
| 10B-FIX spec (USER message) | REQUIRED | YES | FIX-only scope; no 10C |
| `AGENTS.md` | REQUIRED | YES | Router order + standing rules (verified this workspace) |
| `core/WORKFLOW.md` | CONDITIONAL | NO | Stage flow untouched by FIX (`NOT_NEEDED`) |
| `core/CONTEXT_ROUTER.md` | CONDITIONAL | NO | Routing rules untouched (`NOT_NEEDED`) |
| `context/ROUTES.yaml` | CONDITIONAL | NO | No new stage-10 docs required (`NOT_NEEDED`) |
| `flow-companion/bridge/state-machine.js` | REQUIRED | YES | Full file (new states/guards) |
| `flow-companion/bridge/job-store.js` | REQUIRED | YES | updateJob section |
| `flow-companion/bridge/manual-assist.js` | REQUIRED | YES | Full file (packet fields) |
| `flow-companion/extension/src/content/flow-page-adapter.js` | REQUIRED | YES | SELECTORS + detectRefusal |
| `flow-companion/bridge/safety-refusal.js` | REQUIRED | YES | Created here |
| `schemas/flow-job.schema.json` | CONDITIONAL | YES | Status enum (trigger: 4 new states) |
| `schemas/safety-prompt-adaptation.schema.json` | REQUIRED | YES | Created here |
| `providers/CONFIG.yaml` | CONDITIONAL | YES | Retry budget (trigger: §13 policy) |
| `validate-schemas.js` | CONDITIONAL | YES | Schema-test extension (trigger: new schema) |
| `Report/**` history (beyond this report) | EXCLUDED | NO | Development history not runtime context |

No REQUIRED item missing.

## 17. Errors/Warnings

None open. Fixed during development (re-verified): template self-trip on
negated "blood" (denegation-aware depiction check + matching test update).

## 18. Blockers

None

## 19. Remaining Work

- Step 10C — Local/Cloud/MCP integration + final provider QA

Do NOT implement it in this FIX.

## 20. Final Conclusion

STEP 10B-FIX SAFETY RETRY: PASS 100%
