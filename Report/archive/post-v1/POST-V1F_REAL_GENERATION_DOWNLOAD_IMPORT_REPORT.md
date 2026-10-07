# POST-v1F — REAL GENERATION / DOWNLOAD / IMPORT REPORT

Date: 2026-10-01
Status claim: **PASS — zero-credit recovery proved correlation and completed the same 1/1 generation through download/import/QA/READY.**
Adapter build: `0.4.11-postv1f` (extension `0.5.1`, commands `0.4.11-postv1f-cmds2`)
Mode: ponytail full. Debug protocol: **log-first** throughout.

> **Reading order.** Everything above the
> `# Zero-credit correlation recovery` heading is the **pre-recovery audit
> history**, retained verbatim. It records the run as it stood when the
> correlation gate did not yet exist. Its `FAIL` / `PARTIAL` findings and its
> "Remaining issues" blocker are **SUPERSEDED BY ZERO-CREDIT CORRELATION
> RECOVERY BELOW**. The single source of truth for current status is
> [Final conclusion (current)](#final-conclusion-current) at the end of this
> document.

## Budget correction (supersedes the previous version of this report)

> SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW — retained as audit history.

The previous revision stated that a further generation would be "out of
budget". That was wrong: the earlier Start click never reached Google Flow, so
it never consumed the budget. Corrected accounting:

```text
real generations submitted .......... 1  (1/1)
Start clicks that Google Flow accepted 1  (2026-10-01T09:12:40.099Z)
second generation submitted ......... NO
```

### Credit accounting (precise wording)

The recovery is described as **zero-credit** in the sense that it **submitted no
additional generation** and therefore **incurred no additional generation
credit**. This is not a claim about the cost of the single accepted generation:

```text
real generations used .................................. 1/1
second generation ..................................... NO
zero-credit recovery submitted NO additional generation  YES
no additional generation credit was incurred by recovery  YES
exact credit consumption of the single accepted generation
  was NOT independently measured from the Flow UI ....... (not measured)
```

The single accepted generation's exact credit consumption was never read from the
Flow UI or billing surface, so no figure for it is asserted here. Only the
*absence of further generation* is verified, and that is what "zero-credit
recovery" refers to.

---

## Scope

> SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW — retained as audit history.

Prove one real end-to-end Flow Companion execution on authenticated Google
Flow: approval → submit accepted → generation → result detection → correlation
→ download → import → structural QA → terminal success.

Delivered: the **whole pipeline executed** through the canonical Bridge
endpoints and reached `READY` with a structural-QA record.
Not delivered *(as of this section)*: proof that the imported bytes are *this*
generation's output. **This gap was subsequently closed — see
[Zero-credit correlation recovery](#zero-credit-correlation-recovery).**

---

## Environment

| Item | Value |
|---|---|
| Browser | Playwright-bundled Chromium (`ms-playwright/chromium-1243`), persistent profile `%LOCALAPPDATA%\UNFOLDIQ\pw-flow-profile`, CDP `127.0.0.1:9333` |
| Flow context | `https://flow.google.com/project/8221824c-a1a6-4aa9-8d6b-fac24860d49e` (`UNFOLDIQ — Mascot Live Validation`), authenticated |
| Extension | `.output/chrome-mv3`, reloaded via CDP `Extensions.loadUnpacked`, ID `caokkkcclnfdpecnjhbcekphlfkcjiic` |
| Bridge | `127.0.0.1:4317`, loopback-only, token-gated, **restarted this session** so the new `/generate` route was live (`401` without token, `200` with it) |
| Job | `postv1b-flow-companion-live` / `FLOW-COMPANION-LIVE-GEN-01`, attempt 1 |
| Secrets | Bridge token read from the persistent local token file, injected programmatically, never printed; no cookies/auth tokens/passwords/account identifiers in evidence |

---

## Pre-flight regression (before any generation)

| Command | Actual result | Result |
|---|---|---|
| `npm run test:flow` | 14 suites, `0 failed suite(s)` (run 3× consecutively) | PASS |
| `cd flow-companion/extension && npm test` | `passed=508 failed=0` | PASS |
| `cd flow-companion/extension && npm run build` | `BUILD_OK … (29 files, MV3, minimal permissions)` | PASS |
| `npm run test:e2e` | `1 passed` | PASS |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` | PASS |
| `npm test` (8 domains) | `0 failed suite(s) in 100.4s` | PASS |

Targeted tests added for this phase: false-GENERATING prevention, submit-not-accepted
classification, composer/drawer restoration, approval & generation accounting, no
polling before submit acceptance, read-only acceptance polling, Buffer-free byte
encoding, avatar-safe result detection.

---

## False-GENERATING state correction

**Bug (proven live):** the Bridge moved the job to `GENERATING` on approval, i.e.
*before* the browser had any evidence that Google Flow took the request. That
produced false `GENERATING` and a useless 10-minute result poll.

**Fix (smallest architecture-consistent change):**

```text
POST /jobs/:id/approve   → records the approval ONLY, status stays AWAITING_USER_APPROVAL
POST /jobs/:jobId/generate → the real generation starts here (state machine still
                             enforces a fresh unused approval + the attempt budget)
```

`AWAITING_USER_APPROVAL` is reused as the canonical "approved, not yet
generating" state — no new state was invented. `approve` is refused from any
other state (`APPROVAL_STATE_REJECTED`).

**Live proof it works** — on every non-accepted submit the panel logged:

```text
bridge approval recorded, status=AWAITING_USER_APPROVAL
… job=AWAITING_USER_APPROVAL gen=0
```

`generationCount` stayed `0` and no polling started. Tests: `BR11` (approval
alone never starts a generation; `/generate` is idempotent; the approval is
consumed only by the real generation) and `BR12` (approve refused outside
`AWAITING_USER_APPROVAL`, generate refused without an approval).

---

## Submit acceptance handshake

`SUBMIT_GENERATE` now returns evidence instead of assuming success:

```text
submitIssued / submitAcceptedByFlow / submitAcceptedAt / acceptanceSignal / code
```

Acceptance signals (strongest first): `stop-control-appeared`,
`start-replaced-by-stop`, `composer-cleared`. The baseline
(`captureSubmitBaseline`) is captured **before** the click — an early version
captured it after, which made every signal look pre-existing and always answered
"not accepted" (caught by a test).

Unaccepted submits return **`SUBMIT_NOT_ACCEPTED`** after a bounded 15 s — never
`RESULT_TIMEOUT`, and never a 10-minute poll. The panel then requests the one
trusted user gesture and polls **read-only** (`AWAIT_SUBMIT_ACCEPTANCE`, which
provably never clicks) until Flow accepts.

### Why the user gesture is required (log-first)

| Evidence | Result |
|---|---|
| drawer state at click time | closed |
| composer controls visible | Clear prompt, Agent instructions, Settings, Add ingredients |
| Start control | visible, enabled, **not covered** (`elementFromPoint` hit-test returned Start itself) |
| prompt in DOM | exact, 82 chars |
| prompt in the editor's model | the editor is **ProseMirror**; typing one character appended to *our* text (`…No text.X`) → the model holds our prompt |
| event listeners on the editor | `beforeinput`, `keydown`, `keyup`, `keypress`, `paste`, `drop`, … and **no `input` listener** |
| synthetic `HTMLElement.click()` on Start | issued, then **no effect at all**: no acceptance signal, no agent turn, no media, 45 s later |

Conclusion: a content script cannot produce the trusted gesture Flow requires
(ProseMirror-backed Agent composers gate on real input). The single click is
therefore handed to the user, exactly once, and **everything after it stays
automated** — this is the one human interaction in the whole run.

---

## Drawer restoration (proven at zero credit, before approving)

`restoreComposer` no longer trusts a bare `Escape` (it did not close the live
drawer) and no longer trusts "visible" (a control under the drawer *is* visible).
It clicks the drawer's own `aria-label="Close"` control and then verifies the
drawer is **unmounted** (its markers no longer resolve). Coordinates are
forbidden by the adapter contract, so the check is semantic.

Zero-credit gate, immediately before the paid click
(`2026-10-01T09-06-42-842Z-02-pre-submit-readiness.json`):

```json
{"drawerOpen": false, "promptExact": true, "startVisible": true,
 "startDisabled": false, "overlayOverStart": null,
 "composerControlsVisible": ["Clear prompt","Agent instructions","Settings","Add ingredients to the prompt box"]}
```

Preparation log for the same run: `generationType=NOT_APPLICABLE verified=true`,
`aspect=1:1`, `outputCount=1`, `model=Nano Banana 2`, `generationReady=true missing=[]`.

---

## Real generation

| Item | Value |
|---|---|
| jobId / attempt | `FLOW-COMPANION-LIVE-GEN-01` / 1 |
| prompt identity | `Create a simple minimal blue circle centered on a clean light background.\nNo text.` (82 chars, exact) |
| route / capability | `AGENT/IMAGE` / `image` |
| aspect / output | `1:1` / `x1` |
| model | `Nano Banana 2` |
| visible credit/cost | none exposed by the Flow UI (`visibleCost=UNKNOWN`) |
| approval recorded | `09:07:34.056Z` (status stayed `AWAITING_USER_APPROVAL`) |
| synthetic submit issued | `09:07:49Z` — no acceptance (`SUBMIT_NOT_ACCEPTED`) |
| **accepted by Flow** | **`09:12:40.099Z`** (user gesture) |
| `/generate` | `status=GENERATING generationCount=1` |
| second click | **NO** — the run never submitted again |

---

## Generating state → result detection

```text
bridge generation started, status=GENERATING generationCount=1
RESULT_DETECTED at 09:12:45.119Z (started 09:12:40.096Z), urls=2 new=2
import failed: Buffer is not defined
```

`GENERATING` was entered only after acceptance — the ordering the phase
required. The run then crashed in `FETCH_RESULT_BYTES`: **a content script has
no Node `Buffer`**, and the live run died *after* the generation succeeded.

**Fix:** chunked `bytesToBase64` (no `Buffer`, no giant string). Regression
tests cover the round-trip, chunking, and a `FETCH_RESULT_BYTES` run with
`global.Buffer` removed to simulate the isolated world.

---

## Result detection, correlation and the resume

> **SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW** — the correlation
> `FAIL` recorded in this section is the pre-recovery finding. Correlation is now
> **proven** (`resultBelongsToCurrentAttempt = true`). Retained as audit history.

Per §18 the **same** generation/result was reused — no second generation.

The resume path captured a fresh baseline (2 pre-existing) and, because the
Bridge already counted the job as generating, **adopted** the current results:

```text
resume: adopting 2 result(s) for a job the bridge already counted as GENERATING
        at 2026-10-01T09:12:40.099Z (generationCount=1)
bytes fetched in-page: mime=image/png bytes=2080
DOWNLOADING → IMPORTED → READY: assets/image/GEN01/GEN01_attempt-01.png
        sha256=1186233d1af671fcb50ff5084ded613777105ba87cf0d951481ab236ba5b322e bytes=2080
```

### Correlation verdict — NOT proven

| Signal | Result |
|---|---|
| appeared after `submitAcceptedAt` | the 2 URLs were new vs the pre-submit baseline (logged `new=2`) |
| not the account avatar | **confirmed not the avatar** — sha256 of the live avatar (`7298e084…`, 5645 B) ≠ imported (`1186233d…`, 2080 B) |
| asset/result ID | not captured (the panel logs counts, not URLs) |
| media type IMAGE | yes (`image/png`) |
| **prompt/capability context** | **FAILS** — the image is a 32×32 beach/coconut-drink scene, not "a simple minimal blue circle on a clean light background. No text." |
| plausible output resolution | **FAILS** — 32×32 is thumbnail-sized; Flow outputs are far larger |

So `resultFound = true` but `resultBelongsToCurrentAttempt = false/unproven`.
Per §22/§25 this cannot be reported as a correlated result.

Two contributing weaknesses, both now understood:

1. **The resume adoption bypasses the baseline filter.** Adopting "whatever is
   on the page now" is exactly the "last image in DOM" pattern the spec forbids.
   It is gated on `generationCount >= 1`, but the *URLs* detected at the moment
   of `RESULT_DETECTED` are not persisted, so the resume cannot prove which of
   the current URLs were the new ones.
2. **`RESULT_MEDIA`'s broad fallback matches page chrome.** The live page's only
   `img[src*="googleusercontent"]` element is the signed-in account avatar
   (`…/ogw/…=s64-c-mo`, 32×32) — the same fallback that would have made the
   import the avatar had the timing differed. Fixed now
   (`isGeneratedResultCandidate`: rejects avatar/ogw/`=sN-` sources, account-ish
   alt/aria/class text, and anything under 96 px on its short edge) with two
   regression tests. This fix came **after** the import, so it did not cause it.

---

## Download / import / structural QA (as originally run — SUPERSEDED, see §Structural QA thumbnail rejection)

> **Correction.** The rows below record what the *pre-fix* pipeline did. That run
> imported a **32×32 PNG that was never a generated result**: it is the signed-in
> **account avatar** (`lh3.googleusercontent.com/ogw/AF2bZyga0_…=s32-c-mo`,
> `class="gb_X gbii"`, rendered 32×32). `structural QA = PASS, width 32, height 32`
> was **not** sufficient production structural QA — the record was a rubber stamp
> (`status` hardcoded to `"PASS"`) and `READY` was entered *before* QA ran. Both
> are fixed; the artifact is flagged untrusted and QA superseded.

| Check | Result | Evidence |
|---|---|---|
| download path | canonical (`FETCH_RESULT_BYTES` in-page → `POST /jobs/:id/artifact`) | panel log `bytes fetched in-page` |
| file exists | `assets/image/GEN01/GEN01_attempt-01.png` (2080 B) + staged `downloads/FLOW-COMPANION-LIVE-GEN-01-flow-result.png` | filesystem |
| size > 0 / decodes | PNG signature `89 50 4e 47 0d 0a 1a 0a` | header read |
| mime / extension consistent | `image/png` ↔ `.png` | QA record |
| job/attempt linkage | `jobId FLOW-COMPANION-LIVE-GEN-01`, `attempt 1` | `qa/structural-qa.json` |
| structural QA | ~~**PASS**, `width 32`, `height 32`~~ → **SUPERSEDED**, `resultBelongsToCurrentAttempt: false` | `2026-10-01T09-57-58-115Z-superseded-structural-qa.json` |
| aspect ≈ 1:1 | 32×32 → yes (trivially) | QA record |
| provenance | `promptFingerprint bef331ed…`, `providerId flow-web`, `sourceType generated` | QA record + importer result |
| duplicate import | none (`GEN01_attempt-01.png` written once) | filesystem |
| no unrelated overwrite | only the job's own scene directory touched | filesystem |
| Flow's own Download button | `DOWNLOAD_CONTROL_NOT_FOUND` (the panel logs this and continues) | panel log |

Structural QA passed **on the bytes it was given**. It could not judge whether
those bytes were the right image, and its PASS was not even computed — that is
the correlation gap above, now closed structurally.

---

## State-machine transitions

| # | Previous | Action | Actual next state | Evidence | Result |
|---|---|---|---|---|---|
| 1 | `PREPARED` | zero-credit preparation | `AWAITING_USER_APPROVAL` | prepare log | PASS |
| 2 | `AWAITING_USER_APPROVAL` | approve (records only) | `AWAITING_USER_APPROVAL` | `bridge approval recorded, status=AWAITING_USER_APPROVAL` | PASS |
| 3 | `AWAITING_USER_APPROVAL` | synthetic submit, not accepted | `AWAITING_USER_APPROVAL`, `gen=0` | `SUBMIT_NOT_ACCEPTED` | PASS (no false GENERATING) |
| 4 | `AWAITING_USER_APPROVAL` | user gesture accepted `09:12:40.099Z` → `/generate` | `GENERATING`, `generationCount=1` | job history | PASS |
| 5 | `GENERATING` | result detected (`urls=2 new=2`) | `RESULT_DETECTED` | bridge artifact route | PASS |
| 6 | `RESULT_DETECTED` | bytes received | `DOWNLOADING` | bridge artifact route | PASS |
| 7 | `DOWNLOADING` | `importResult` | `IMPORTED` | bridge artifact route | PASS |
| 8 | `IMPORTED` | structural QA PASS | **`READY`** | `qa/structural-qa.json` + job JSON | PASS |

Terminal state: **`READY`** (canonical success).

---

## Fix/test iterations (all evidence-driven, no generation spent on debugging)

| Iteration | Failure (exact code) | Root cause | Fix | Rerun |
|---|---|---|---|---|
| 1 | `FLOW_MODE_UNKNOWN` on the first attempt after a reload | the live Agent Settings title is a plain `<h2>`, unreachable by the marker selectors | `AGENT_HEADING_SELECTOR` | 421 assertions, live retry OK |
| 2 | Agent settings unresolvable (confirmation/aspect/output/model) | live DOM has no clean labels: role-less native radios, ligature glued to value, ARIA-only section names | `accessibleLabelOf`, `agentSemanticLabel`, `labelledGroupTextsOf`, `agentModelCandidates` | `aspect=1:1 outputCount=1 model=Nano Banana 2` |
| 3 | `APPROVAL_STALE_CHANGED: type,aspect,outputCount,model` | revalidation was Standard-mode only; Agent mode has no composer controls | async `readAgentMaterial` + Agent branch in `revalidateBeforeGenerate` | fresh approval accepted |
| 4 | `… agent-read=MISSING_ADAPTER_FN` | the adapter has two export surfaces; the new functions were only on the Node one | added to `window.FlowPageAdapter` + a parity test (which immediately caught a second pre-existing drift) | 454 assertions |
| 5 | `medias.map is not a function` | `querySelectorAll` returns a NodeList in a real document | `Array.from` + a NodeList-shaped test | 457 assertions |
| 6 | generation submitted, Flow produced nothing → `RESULT_TIMEOUT` | `readAgentMaterial` left the drawer open; the Start click was absorbed | `restoreComposer` (Close control + verified unmounted) | 461 assertions; zero-credit gate then passed |
| 7 | `agent-read=NO_AGENT_SURFACE` | the guard depended on the trigger ranking, which excludes the Agent control | `hasAgentComposerControls` direct toolbar scan | live: guard passes |
| 8 | `APPROVAL_STALE_CHANGED` while the drawer was closed | `classifySurface` could not classify the live panel (plain-text/ARIA labels) | richer-label fallback in `classifySurface` | live: first-attempt `AGENT` with the drawer closed |
| 9 | **`false GENERATING` + 10-min poll** | `/approve` transitioned to `GENERATING` | `/approve` records only; new `/generate` | live: `gen=0` on every unaccepted submit |
| 10 | **`SUBMIT_NOT_ACCEPTED`** (correctly) but the click was swallowed | Flow does not act on a synthetic click (ProseMirror model verified correct) | one trusted user gesture + read-only `AWAIT_SUBMIT_ACCEPTANCE` polling | accepted at `09:12:40` |
| 11 | `Buffer is not defined` in `FETCH_RESULT_BYTES` | no Node `Buffer` in a content script | chunked `bytesToBase64` | resume imported successfully |
| 12 | avatar/UI chrome matched by the `RESULT_MEDIA` fallback | the fallback selector is intentionally broad | `isGeneratedResultCandidate` guard + 2 tests | 508 assertions |

---

## Unique evidence files (§19)

`Report/evidence/post-v1f-real-execution/` — every file from this continuation is
timestamped; nothing was overwritten:

```text
2026-10-01T08-24-41-337Z-00-clean-slate.json
2026-10-01T08-24-41-337Z-01-prepare-log.txt
2026-10-01T08-24-41-337Z-02-pre-submit-readiness.json
2026-10-01T08-24-41-337Z-03-pre-submit.png
2026-10-01T08-25-56-576Z-10-pre-click.json      …-11-timeline.json  …-13-panel-log.txt
2026-10-01T08-31-14-887Z-…                     (repeat per attempt)
2026-10-01T08-37-09-066Z-…                     (repeat)
2026-10-01T08-46-12-604Z-…                     (repeat)
2026-10-01T08-56-57-333Z-02-pre-submit-readiness.json   ← the run that generated
2026-10-01T09-07-33-903Z-10-pre-click.json
2026-10-01T09-07-33-903Z-11-timeline.json
2026-10-01T09-07-33-903Z-12-generating.png
2026-10-01T09-07-33-903Z-13-panel-log.txt
2026-10-01T09-07-33-903Z-14-final-flow.png
2026-10-01T09-17-08-955Z-20-resume-media-before.json
2026-10-01T09-17-08-955Z-21-panel-log-resume.txt
2026-10-01T09-17-08-955Z-22-media-after.json
2026-10-01T09-17-08-955Z-23-flow-after-import.png
```

Un-numbered files (`01-…` … `panel-log.txt`) are the **previous** session's
evidence and are kept as-is for the audit trail. No secrets in any file.

---

## Regression after fixes

| Command | Actual result | Result |
|---|---|---|
| `npm run test:flow` | `0 failed suite(s)` | PASS |
| `cd flow-companion/extension && npm test` | `passed=508 failed=0` | PASS |
| `cd flow-companion/extension && npm run build` | `BUILD_OK` | PASS |
| `npm run test:e2e` | `1 passed` | PASS |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` | PASS |
| `npm test` | `0 failed suite(s) in 100.4s` | PASS |

### Changed files

- `flow-companion/bridge/server.js` — `/approve` records only; new `/generate`; route allowlist.
- `flow-companion/extension/src/content/flow-page-adapter.js` — `captureSubmitBaseline`, `awaitSubmitAcceptance` (+`mayClick:false` observer mode), `restoreComposer`, `agentSettingsDrawerOpen`, `hasAgentComposerControls`, `isGeneratedResultCandidate`, `classifySurface` fallback, `submitAfterApproval(beforeSubmit)`, `readAgentMaterial` reasons, `prepareAgentSettings` restoration, `detectResults` NodeList + candidate guard, `ADAPTER_VERSION 0.4.11-postv1f`.
- `flow-companion/extension/src/content/content-commands.js` — async revalidation with the Agent branch, `CONTENT_COMMANDS_VERSION`, `AWAIT_SUBMIT_ACCEPTANCE`, `bytesToBase64`, `SUBMIT_GENERATE` evidence contract.
- `flow-companion/extension/src/ui/sidepanel.js` — approve → submit → acceptance → `/generate` ordering, user-gesture wait, evidence logging, resume adoption.
- Tests: `flow-companion/extension/tests/run.js` (+24 `v1F` tests), `tests/flow/test-flow-bridge.js` (BR11/BR12), `tests/flow/test-flow-postv1e.js` (E1 invariant + E12 sequence).
- `projects/postv1b-flow-companion-live/` — validation job now `READY`, plus the imported artifact, staged download and `qa/structural-qa.json`.

---

## Security / secret check

Bridge token read from the local token file and injected programmatically; never
printed, never in evidence, never rotated. No Google cookies/auth tokens, no
password, no account identifier (display name / e-mail) written to any evidence
file or to this report.

## Credit / side-effect check

> **SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW** — retained as audit
> history for the pre-recovery run. See
> [Credit accounting (precise wording)](#credit-accounting-precise-wording) for
> the current, precisely-scoped credit wording.

| Check | Result |
|---|---|
| real generations submitted | **1 / 1** (accepted by Flow at `09:12:40.099Z`) |
| second generation | **NO** |
| duplicate submit | **NO** — the resume re-imported the SAME result |
| media generated by Flow | **unproven** — 2 new URLs appeared, but the imported bytes are a 32×32 unrelated scene |
| destructive cloud action | **NO** — one user click on Start generation; the Agent setting `Confirm before generating` remains **Always** |
| cloud result deleted/reset | **NO** |

---

## Acceptance matrix

> **SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW** — the rows below record
> the pre-recovery state (correlation `FAIL`). Retained as audit history.

| Check | Expected | Actual | Result |
|---|---|---|---|
| pre-flight tests | PASS | PASS | PASS |
| false-GENERATING bug fixed | YES | `/approve` records only; `gen=0` on every unaccepted submit | PASS |
| drawer restoration verified | YES | zero-credit gate: `drawerOpen:false`, `overlayOverStart:null` | PASS |
| READY immediately before submit | YES | `generationReady=true missing=[]` | PASS |
| real generations remaining before click | 1 | 1 | PASS |
| approval canonical | PASS | panel primary action → `/approve`; no JSON edited | PASS |
| Start clicks issued | exactly 1 | 1 synthetic (no effect) + 1 user gesture (accepted) | PASS |
| submit accepted by Flow | YES | `09:12:40.099Z` | PASS |
| job GENERATING only after acceptance | YES | `AWAITING_USER_APPROVAL → GENERATING` strictly after acceptance | PASS |
| duplicate submit | NO | NO | PASS |
| result appears | YES | `urls=2 new=2` | PASS |
| **result correlated to current attempt** | YES | **32×32 unrelated scene; not the prompt's output** | **FAIL** |
| download | PASS | 2080 B `image/png` | PASS |
| import | PASS | `assets/image/GEN01/GEN01_attempt-01.png` | PASS |
| structural QA | PASS | `PASS 32×32`, sha recorded | PASS |
| terminal success state | reached | **`READY`** | PASS |
| real generations used | max 1/1 | 1/1 | PASS |
| evidence overwritten | NO | all continuation files timestamped | PASS |
| secrets leaked | NO | none | PASS |

---

## Remaining issues

> **SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW** — the blocker listed
> here (unproven correlation) was **resolved** by the zero-credit recovery, which
> proved the asset and completed the import. Retained as audit history; for current
> open items see `## Remaining issues` inside the recovery section below.

1. **Result ↔ attempt correlation is unproven** (the blocker). Resolving it
   needs either a fresh generation (budget spent) or persisting the exact URLs
   observed at `RESULT_DETECTED` so a resume can re-verify them.
2. **The resume adoption path bypasses the baseline filter.** It should import
   only URLs recorded as new at detection time, not "whatever is on the page".
3. **Synthetic clicks are ineffective on this Flow composer.** Any future
   automated submit must expect the one trusted user gesture; the extension now
   asks for it instead of stalling.
4. **The imported bytes are 32×32.** The detector picked a small image; a
   full-resolution output URL is not yet selected. The avatar/chrome guard is in
   place, but preferring the largest available variant is still open.
5. **`FLOW_MODE_UNKNOWN` on the first preparation attempt after a page reload**
   persists (zero credit, recovers on the product's own Retry). The
   "panel not mounted" hypothesis was disproved by sampling; cause still unknown.
6. `readModelLabel` in diagnostics still shows the raw ligature label while the
   Agent path normalises it (cosmetic).
7. The adapter keeps two hand-synced export surfaces (now test-enforced).

---

## Final conclusion

> **SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW** — this is the
> **pre-recovery `PARTIAL` verdict**, retained as audit history. It is **not** the
> current status. The single source of truth is
> [Final conclusion (current)](#final-conclusion-current) at the end of this
> document, which records `TASK_VALIDATION = PASS`.

See **Zero-credit correlation recovery** below for the current verdict; the
conclusion recorded here is the pre-recovery one and is superseded.

```text
TASK_VALIDATION = PARTIAL — the full chain executed and reached the canonical
                   terminal state READY with a structural-QA PASS, but the
                   correlated asset does not correspond to the prompt, so
                   result↔attempt correlation is NOT proven.
REPOSITORY_REGRESSION = PASS
real generations used = 1/1
second generation submitted = NO
```

Not proven *at this point*: that the imported bytes are this generation's output.
Report updated; QUALITY 01 not started.

---

# Zero-credit correlation recovery

Task: `POST_V1F_ZERO_CREDIT_CORRELATION_RECOVERY_PROMPT.md`. The recovery
submitted **no additional generation** and incurred **no additional generation
credit**; `real generations used = 1/1`, `second generation = NO`. The exact
credit consumption of the single accepted generation was **not independently
measured from the Flow UI** and is not asserted. See
[Credit accounting (precise wording)](#credit-accounting-precise-wording).

## Root cause of the correlation failure

Forensics on the live project **found the real generated asset** — it had simply
never been a candidate:

| Step | Finding |
|---|---|
| last successful stage | `RESULT_DETECTED` at `09:12:45.119Z`, `urls=2 new=2` |
| first incorrect decision | the result detector only matched `googleusercontent` media, so the only `googleusercontent` element on the page — the **account avatar** — was taken as "the result" |
| why | Flow serves project/generated media from **`flow.google.com/asb/`**, which matched no selector |
| imported candidate identity | `lh3.googleusercontent.com/ogw/AF2bZyga0_…=s32-c-mo`, `class="gb_X gbii"`, 32×32 → **the account avatar** |
| real candidate | `flow.google.com/asb/ANqvLOabAWhGZg…=s512-rw`, 512×512, `alt="Option 1"` |
| confirmed root cause | detector blind to `/asb/` media **+** `isGeneratedResultCandidate` guard applied only in the fallback branch, so the avatar passed through the primary branch unguarded |
| rerun evidence | `2026-10-01T09-38-51.519Z-correlation-forensics.json` |

## Correlation proof (resultBelongsToCurrentAttempt = true)

The asset was proven, not assumed:

```text
same project                 https://flow.google.com/project/8221824c-a1a6-4aa9-8d6b-fac24860d49e
same Agent turn as prompt     inside div.messages-list containing
                              "Create a simple minimal blue circle centered on a
                              clean light background. No text." and the reply
                              "I've created the minimal blue circle."
media inside that turn        exactly 1
not in pre-submit baseline    yes (new asset id)
stable asset id               ANqvLOabAWhGZg…(full id in the evidence file)
media type                    IMAGE
not account chrome            different host (/asb/ vs /ogw), different sha256
content matches the prompt    center rgb(3,131,186) blue · corner rgb(234,234,234)
                              · edge-mid rgb(239,239,239) · blue grid fraction 0.125
                              → BLUE_SHAPE_ON_LIGHT_BACKGROUND
```

## Full-resolution asset selection

`srcset` empty; no enclosing anchor or download control; no JSON/protobuf API
exposes `resourceName` / `originalUrl` / `generationId`. A sizeless `/asb/` URL
was observed on reload but belonged to a **different** asset (`ANqvLOa35jEnLDdps…`,
512×288, `image/jpeg`) and was **rejected** on aspect + pixel difference
(MAD 44) rather than assumed to be the original. No Google URL was string-rewritten
to invent a larger variant. **512×512 is the highest evidence-backed variant**, and
the collector now groups variants of one asset and keeps the largest.

## RESULT_DETECTED candidate persistence

`POST /jobs/:jobId/result-candidates` persists, at detection time: `jobId`,
`attempt`, `submitAcceptedAt`, `detectedAt`, per candidate `candidateId`, exact
`url`, `assetId`, `currentSrc`, `src`, `srcset`, `naturalWidth/Height`,
`mediaType`, `container`, `alt`, and the `isNew` baseline decision. It is written
to the job record, so it survives extension reload, browser refresh, Bridge
restart and resume. No secrets are persisted.

## Resume correlation gate

`resumeGenerationPoll` no longer captures a fresh baseline and adopts what is on
the page. It uses **only** persisted candidates; with none — or with none that
were new vs the baseline — it stops with `RESULT_CORRELATION_REQUIRED` and never
enters `PROCESSING`/`READY`. `FETCH_RESULT_BYTES` now requires an explicit
correlated `url` and fetches it with `credentials: "include"`; the previous
"first media on the page" behaviour is gone.

## Structural QA thumbnail rejection

`flow-companion/bridge/media-quality.js` is the **single** canonical policy
(`GENERATED_IMAGE_MIN_SHORT_EDGE_PX = 256`); the extension no longer carries a
duplicated threshold. A generated image must be decodable, have real measured
dimensions, meet the minimum short edge, and match the requested aspect. A 32×32
image now fails explicitly:

```text
ARTIFACT_BELOW_MIN_RESOLUTION: 32x32 short edge < 256px,
treated as UI thumbnail rather than a generated asset
```

Structural QA is no longer a rubber stamp: `status` is computed, and a failure
records `FAIL` + reason and blocks the terminal state.

## READY invariant

`READY` is now unreachable unless **all** of: `resultBelongsToCurrentAttempt = true`,
the artifact maps to a persisted candidate, structural QA `PASS`. Verified live
against the running Bridge, not only in unit tests:

```text
REFUSED_AS_REQUIRED :: 32x32 avatar bytes cannot reach READY :: 400 ::
  ARTIFACT_BELOW_MIN_RESOLUTION: 32x32 short edge < 256px …
REFUSED_AS_REQUIRED :: unknown candidateId is refused :: 400 ::
  RESULT_CORRELATION_REQUIRED: no persisted candidate at RESULT_DETECTED
JOB status=MANUAL_ASSIST_REQUIRED generationCount=0 candidates=1
LIVE_GATE_PROOF: HOLDS
```

(The 32×32 avatar is precisely the artifact that previously reached `READY`.)

## Existing-generation recovery

A reconciliation job for the **same** already-generated result was created through
the state machine's existing credit-free route — no approval, no `/generate`, no
new state invented:

```text
PENDING → VALIDATED → PREPARED → MANUAL_ASSIST_REQUIRED
candidates persisted: 1   generationCount: 0   creditsConsumed: 0
reconcilesJobId: FLOW-COMPANION-LIVE-GEN-01
recoveredGenerationAcceptedAt: 2026-10-01T09:12:40.099Z
```

`FLOW-COMPANION-LIVE-GEN-01` itself is left at `READY` (terminal) and **flagged**:
`artifactUntrusted: true`, `correlatedOutput: false`, `reconciledBy: null`. Its QA
record is `SUPERSEDED` with the original preserved in evidence. No artifact file
and no cloud media was deleted.

**Import not completed — the authenticated bytes could not be obtained.** The
asset lives behind a signed-in Google session; the automation browser was closed
between sessions and reopens with a fresh, signed-out profile (`flow.google.com/about`,
no avatar, no `/asb/` media). An unauthenticated Node `fetch` of the URL returns an
HTML login shell, not image bytes. The import is therefore blocked on a human
login, and the job correctly sits at `MANUAL_ASSIST_REQUIRED` rather than `READY`.

The download step additionally verifies the fetched bytes against
`sha256 803b8db7…` / `4522 bytes` measured in the authenticated page, so the
bytes↔URL link is checked rather than assumed.

### Recovery completed after a human login

A signed-in session was restored (same account — the `ogw/AF2bZyga0_…` avatar
matches the original run) and the import completed with **no additional
generation submitted** (so no additional generation credit was incurred):

```text
STEP bytes-verified: sha256 803b8db7…  bytes 4522  contentType image/webp  dims 512x512
STEP import: 200 {"status":"READY",
                  "artifactPath":"assets/image/GEN01/GEN01_attempt-02.webp",
                  "sha256":"803b8db7…","bytes":4522,"mime":"image/webp"}
FINAL RECOVERED status=READY generationCount=0
QA {"status":"PASS","width":512,"height":512,"candidateId":"c1",
    "resultBelongsToCurrentAttempt":true,
    "correlationSignals":{"persistedAtDetection":true,"newVsBaseline":true,
      "stableAssetId":true,"sameAgentTurn":true,"hasUrl":true,"mediaTypeImage":true}}
```

The imported file was then re-verified **independently of the page** — read back
off disk: `VP8X`, 512×512, `sha256 803b8db7…`, `matchesProvenAsset: true`.

### Second real bug found by the recovery: WebP was undimensionable

The first import attempt failed with `IMAGE_DIMENSIONS_UNREADABLE` on the real
512×512 `image/webp` result. Root cause: `importer.imageDimensions()` parsed
**PNG only**, while `IMAGE_EXTS` already accepted `.jpg`/`.jpeg`/`.webp` — so
**any JPEG or WebP result from Flow could never pass structural QA**, regardless
of the correlation work. Fixed by adding JPEG SOF marker scanning and WebP
`VP8X` / `VP8L` / `VP8` (lossy) canvas parsing; E13 now asserts real dimensions
for all three container types.


## Regression after hardening

```text
node tests\flow\test-flow-postv1e.js   → 99 assertions, 0 failed
node tests\flow\test-flow-postv1b.js   → 178 assertions, 0 failed
npm run test:flow                      → 0 failed suite(s) in 32.2s
flow-companion/extension npm test      → passed=519 failed=0
flow-companion/extension npm run build → BUILD_OK (29 files, MV3)
npm run test:e2e                       → 1 passed (3.6s)
npm run check:repo-structure           → REPOSITORY_STRUCTURE_OK
npm test                               → 0 failed suite(s) in 94.0s
```

New/updated coverage: **E14** (persistence + reload survival, resume refusal,
avatar rejection, 32×32 rejection, 256 boundary, aspect mismatch, baseline member
refused, visibility-alone refused, assetId/same-turn proof, happy path to `READY`,
`READY` impossible without correlation, no generation consumed), **E15** (full-res
wins over its 64px sibling, chrome refused, per-asset grouping), **E16** (no
generation consumed by approval/persistence/recovery), **E13** (extended: lossy
WebP, lossless WebP and JPEG dimension decoding), **L5/L6** and **E12** updated to
the new contract, 3 extension tests updated. No `.skip()`, no expectation weakened
to match a bug.

## Remaining issues

1. The Bridge cannot itself re-fetch the candidate URL (it holds no Google
   credentials), so the bytes↔URL link is asserted by the extension and verified
   here by comparing the downloaded bytes against the sha256 measured in the
   authenticated page. A future hardening could let the Bridge verify by hash.
2. `GEN01_attempt-01.webp` (4522 B, byte-identical to the delivered artifact) is a
   leftover of the first, QA-failed import. Harmless but redundant; the job points
   at `GEN01_attempt-02.webp`.
3. Unchanged: synthetic clicks are ineffective on this Flow composer (one trusted
   user gesture is requested instead); `FLOW_MODE_UNKNOWN` can appear transiently
   after a reload and self-recovers; two hand-synced adapter export surfaces remain
   (test-enforced); `readModelLabel` shows a raw ligature label.

## Final conclusion (current)

> **This section is the single source of truth for current status.** Every
> `PARTIAL` verdict, correlation `FAIL` and blocker above it is pre-recovery audit
> history, marked **SUPERSEDED BY ZERO-CREDIT CORRELATION RECOVERY BELOW**.

```text
TASK_VALIDATION = PASS
REPOSITORY_REGRESSION = PASS
resultBelongsToCurrentAttempt = true
recovered asset = 512x512 WebP (image/webp, VP8X, 4522 B,
                  sha256 803b8db7080be4d23dca62c82136f3da5c0b46adfb1a4d0765ac4112e8c4ec37)
structural QA = PASS
job = FLOW-COMPANION-LIVE-GEN-01-RECONCILE, status READY, attempt 1
extension tests = 519 passed / 0 failed
npm test = PASS (0 failed suites)
```

Credit accounting, stated precisely:

```text
real generations used .................................. 1/1
second generation ..................................... NO
zero-credit recovery submitted NO additional generation  YES
no additional generation credit was incurred by recovery  YES
exact credit consumption of the single accepted generation
  was NOT independently measured from the Flow UI ....... (not measured)
```

The chain completed against the **same** single accepted generation, with no
second Start click and no additional generation submitted:

```text
one accepted generation (09:12:40.099Z, generationCount=1)
→ asset located in the same Agent turn and correlation PROVEN
→ 512x512 image/webp selected (highest evidence-backed variant)
→ downloaded in the authenticated page (no additional generation)
→ bytes verified by sha256 + size
→ imported via the credit-free MANUAL_ASSIST_REQUIRED route
→ structural QA PASS 512x512
→ resultBelongsToCurrentAttempt = true
→ READY
```

What changed the verdict: the real asset had always been recoverable — the
detector was simply blind to `flow.google.com/asb/` media, so the only
`googleusercontent` element on the page, the account avatar, was imported as "the
result" and a rubber-stamp QA passed it. Correlation is now proven on stable
identity and turn evidence rather than on visibility, a 32×32 asset can no longer
reach `READY`, and structural QA is computed instead of asserted. A second
independent bug (WebP/JPEG were undimensionable, so no Flow image result of those
types could ever pass QA) was found and fixed by the recovery itself.

No gate was weakened, no evidence overwritten, and no cloud media deleted to
reach this verdict.

