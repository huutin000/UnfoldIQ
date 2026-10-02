# POST-v1E.2G — AGENT SURFACE DETECTION + PROMPT LOGICAL TEXT — REPORT

Date: 2026-10-01
Status claim: **POST-v1E.2G LIVE VALIDATION PASS** (real authenticated Google Flow)
Adapter build validated: `0.4.10-postv1e2h` (extension `0.5.1`)
Mode: ponytail full.

## Objective recap

Two live blockers before Agent-mode live validation:

- **Blocker A** — Agent Settings panel visibly open but `flowMode UNKNOWN`
  (`FLOW_MODE_UNKNOWN`): the panel carries NO `role=dialog/menu/listbox`, so
  the ARIA-only resolver missed it.
- **Blocker B** — multiline prompt lost one internal newline after `dom-replace`
  insertion (expected `...background.\nNo text.` (82), observed
  `...background.No text.` (81), firstDiff at 73/U+004E).

Live-browser outcome: **Blocker B did not reproduce** (prompt verified exact on
the first live run). **Blocker A reproduced** and its root cause was deeper
than "the panel is role-less" — see *Real Google Flow validation* / *Fix/test
iterations*.

---

## Live validation environment

| Item | Value |
|---|---|
| Browser | Playwright-bundled Chromium `chromium-1247` (real Chrome channel not usable: see *Remaining issues*) |
| Chrome/Chromium build | `154.0.8037.92` branded Chrome was rejected by `--load-extension`; the validating browser is Playwright Chromium (same engine family, MV3, extensions supported) |
| Profile | `%LOCALAPPDATA%\UNFOLDIQ\pw-flow-profile` (persistent → authenticated Google session reused) |
| Remote debugging | `http://127.0.0.1:9333` (loopback) |
| Flow context | `https://flow.google.com/project/8221824c-a1a6-4aa9-8d6b-fac24860d49e` (`UNFOLDIQ — Mascot Live Validation`), authenticated (account chip + project list rendered, no Google sign-in wall) |
| Extension build path | `flow-companion/extension/.output/chrome-mv3` (rebuilt from source before the run, reloaded via CDP `Extensions.loadUnpacked`) |
| Extension manifest version | `0.5.1` (panel diagnostics `extensionVersion: 0.5.1`) |
| Adapter version | `0.4.10-postv1e2h` (panel diagnostics `adapterVersion`) |
| Extension ID | `caokkkcclnfdpecnjhbcekphlfkcjiic` |
| Bridge | `npm run flow:bridge` → `127.0.0.1:4317`, loopback-only, token-gated |
| Bridge token source | persistent local token file (`%LOCALAPPDATA%\UNFOLDIQ\flow-bridge-token`), `FLOW_BRIDGE_TOKEN_SOURCE=LOCAL_FILE`, never printed, never rotated |
| Validation job | `postv1b-flow-companion-live` / `FLOW-COMPANION-LIVE-GEN-01` (existing production-prompt job, `status: PREPARED`, `capability: image`) |
| Playwright driver | `playwright-cli` (installed stack) + `@playwright/test` for `npm run test:e2e` |

No private account identifiers are recorded in this report or in the evidence
files. Account display name / e-mail observed in the DOM were deliberately not
copied into evidence.

---

## Pre-flight regression

| Command | Actual result | Result |
|---|---|---|
| `npm run test:flow` | 14 suites, **0 failed** | PASS |
| `cd flow-companion/extension && npm test` | `passed=394 failed=0` (pre-fix baseline) | PASS |
| `cd flow-companion/extension && npm run build` | `BUILD_OK: .output\chrome-mv3 (29 files, MV3, minimal permissions)` | PASS |
| `npm run test:e2e` | `1 passed` — real MV3 extension panel, headless new-Chromium, bridge auth + remember-token lifecycle | PASS |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK: root clean, no temporary artifacts in source trees.` | PASS |

Known unrelated blocker from the previous task (`npm test = 56/59`, Windows
Smart App Control blocking 3 real Remotion render suites) did **not** reproduce
in this session — see *Repository regression*.

---

## Real Google Flow validation

Live Agent Settings surface, exposed through the composer's real `Settings`
(`tune`) control before the run. Observed structure (evidence, not assumptions):

```
FLOW-AGENT-PANEL                       <- no role attribute anywhere
  h2.header-title            "Agent settings"
  span.settings-section-label "Confirm before generating"
  mat-radio-group[role=radiogroup][aria-labelledby=agent-settings-confirm-policy-label]
    input[type=radio] (label -> "Always"  + description)
    input[type=radio] (label -> "Never"   + description)
  span.settings-section-label "Image generation default"
  flow-toggles[aria-label="Image generation default aspect ratio"]
    button[role=radio] "crop_square1:1" (aria-checked=true)   <- ligature glued to value
  flow-toggles[aria-label="Image generation default output count"]
    button[role=radio] "x1" (aria-checked=true)
  button[aria-label="Image generation default model"] text "🍌 Nano Banana 2 arrow_drop_down"
  span.settings-section-label "Video generation default"  (identical shape)
  button "Save"
```

Ancestor-chain probe of the surface: **zero** `[role]` attributes from the
`<h2>` up to `<flow-project-shell>`; `document.querySelector('[role=dialog],[role=menu],[role=listbox]') === null`.
Blocker A's premise confirmed: an ARIA-only resolver can never see this panel.

---

## Agent Settings detection

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| Agent Settings surface exists | yes | `FLOW-AGENT-PANEL` open, heading `h2.header-title` = "Agent settings" | `Report/evidence/post-v1e2g-live/01-agent-settings-surface-open.png`; ancestor probe (role-less) | PASS |
| Marker source reachable | heading + ≥2 markers in ONE container | markers resolved: `agent settings` (h2), `image generation default` + `video generation default` (model-button `aria-label`), `save` (button text) | `findAgentSettingsMarkerContainer` live run; regression test `v1E2H live plain-heading Agent Settings panel → AGENT verified without click` | PASS |
| `flowMode` | `AGENT` | `AGENT`, `verified=true`, `resolutionSource=VISIBLE_MARKERS` | live log `generationType=NOT_APPLICABLE verified=true` — that field is produced **only** by `dispatchAgentPreparation`, which runs only for `flowMode==="AGENT" && verified===true` | PASS |
| zero-click (observe-only) detection | 0 clicks | settings never re-opened, no probe click | regression test asserts `always.clicked===0 && save.clicked===0` | PASS |
| no false-classify STANDARD | no | `generationType=NOT_APPLICABLE` (STANDARD would require a verified Image/Video generation-type menu; none exists in Agent mode) | live log | PASS |

---

## Multiline prompt exactness

Job prompt (unchanged, from `FLOW-COMPANION-LIVE-GEN-01.json`):

```
Create a simple minimal blue circle centered on a clean light background.\nNo text.
```

Writer → DOM → logical reader, measured on the live contenteditable **after**
the extension's own `PREPARE_GENERATION` prompt stage reported
`prompt verified=true`:

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| writer stage | inserted + verified | live log `prompt input resolved` / `prompt verified=true` | `Report/evidence/post-v1e2g-live/panel-awaiting-approval.txt` | PASS |
| logical readback | exact 82-char string | `"Create a simple minimal blue circle centered on a clean light background.\nNo text."` | `live-dom-state.json` → `editors[0].logicalExact=true`, `logicalLength=82` | PASS |
| newline preserved | yes | present at index 70 (U+000A) | same | PASS |
| block/`<br>` boundaries | correct | `domShape = ["P"]` (single block, `<br>` nested inside) | same | PASS |
| flat `textContent` false-negative avoided | must not win | `flatTextContentHasNewline = false` — the logical reader, not `textContent`, produced the match | same | PASS |
| no whitespace collapse / no duplicated boundaries | exact | exact match on a string containing a double space | same | PASS |

**Blocker B verdict: NOT REPRODUCED on live.** The POST-v1E.2G
`readContentEditableLogicalText` + `domShapeOf` path verified the multiline
prompt on its very first live attempt. The `promptReadback` diagnostic was
therefore never needed to separate case A from case B; the writer stayed
unchanged, exactly as the spec required.

---

## Generation defaults

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| generation type | IMAGE (Agent routes by prompt) | `settings.generationType = NOT_APPLICABLE`, `requestedCapability = IMAGE`, `generationRoute = AGENT/IMAGE` | live log | PASS |
| Confirm before generating | `Always` (normalized `ALWAYS`) | `input[type=radio] value=1` ("Always") `checked=true`; `value=2` ("Never") `checked=false` | `live-dom-state.json` → `confirm` | PASS |
| confirmation was actually changed live | Never → Always | Before the fix the live panel was on **Never** (credits auto-spend). The first successful live run switched it to **Always**, clicked `Save`, and the setting **persisted** (re-verified after a full page reload) | pre-run probe + post-reload probe | PASS |
| aspect ratio | `1:1` | `crop_square1:1` `aria-checked=true` (all other ratios false) | `live-dom-state.json` → `imageAspect` | PASS |
| output count | `1 / x1` | `x1` `aria-checked=true` (x2/x3/x4 false) | `live-dom-state.json` → `imageOutputs` | PASS |
| values read from the live UI, not job config | yes | both were read from the reopened panel after `Save` | live log `aspect=1:1 outputCount=1` | PASS |
| video defaults untouched | yes | zero clicks on any Video-section toggle | regression test `v1E2H ligature-glued aspect + x1 resolved in the Image section only` | PASS |

---

## Model-label normalization

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| actual visible model label | read from the live UI | `"🍌 Nano Banana 2 arrow_drop_down"` on `button[aria-label="Image generation default model"]` | `live-dom-state.json` → `imageModel.raw` | PASS |
| adapter-normalized label | clean model name | `Nano Banana 2` (live log `model=Nano Banana 2`) | `panel-awaiting-approval.txt` | PASS |
| no `arrow_drop_down` | absent | absent | same | PASS |
| no icon ligature | absent | absent | same | PASS |
| no unrelated icon text | absent | leading `🍌` emoji removed | same | PASS |
| not hard-coded | different future value works | `Flux Pro Ultra` normalizes identically | regression test `v1E2H model label works for a different future model value` | PASS |
| observed read-only | never clicked | `img.model.clicked===0`, `vid.model.clicked===0` | regression tests | PASS |

---

## Route and readiness

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| `flowMode` | `AGENT` | `AGENT` verified | live log (see *Agent Settings detection*) | PASS |
| `generationRoute` | `AGENT / IMAGE` | `mode=AGENT, capability=IMAGE, verified=true` | live log `generationType=NOT_APPLICABLE verified=true` + regression test `v1E2H PREPARE_GENERATION → AGENT/IMAGE READY on the live panel shape` | PASS |
| `generationReady` | `READY` | live log `generationReady=true missing=[]` | `panel-awaiting-approval.txt` | PASS |
| Generate control | found + enabled | live log `generateFound=true enabled=true`; DOM `button[aria-label="Start generation"] disabled=false` | `live-dom-state.json` → `startButton` | PASS |
| approval snapshot frozen | yes | `approval snapshot frozen: fingerprint={"aspect":"1:1","attempt":1,"jobId":"FLOW-COMPAN…` | `panel-awaiting-approval.txt` | PASS |
| ambiguous-surface blocker | none | none | live log has no `FLOW_MODE_UNKNOWN` / stale selector error | PASS |
| prompt mismatch | none | none | live log `prompt verified=true` | PASS |
| settings mismatch | none | none | all four settings verified on reread after `Save` | PASS |
| `UNKNOWN` mode fallback | not used | not used | `generationType=NOT_APPLICABLE`, not `UNKNOWN` | PASS |

---

## Approval gate

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| final job state | `AWAITING_USER_APPROVAL` | Bridge job `FLOW-COMPANION-LIVE-GEN-01` `status: AWAITING_USER_APPROVAL`, history `PREPARED → AWAITING_USER_APPROVAL` (actor `extension`) | `projects/postv1b-flow-companion-live/flow-jobs/FLOW-COMPANION-LIVE-GEN-01.json` | PASS |
| panel state | awaiting approval | status chip `Chờ duyệt`, primary button `Duyệt & Tạo` | `Report/evidence/post-v1e2g-live/03-panel-awaiting-approval.png` | PASS |
| readiness real | yes | frozen snapshot aspect `1:1`, attempt 1, jobId matches | live log | PASS |
| approval state real | yes | no approval recorded, `SUBMIT_GENERATE` never invoked | job JSON has no `approval` object | PASS |
| generation not started | yes | `Start generation` enabled but never clicked; live log never shows `clickedGenerate` | live log | PASS |
| credits not consumed | yes | `creditsConsumed=false` on every path; `generationCount: 0` | live log + job JSON | PASS |
| no media result | yes | result container media count `0` | `live-dom-state.json` → `mediaCount=0` | PASS |
| not approved by the agent | yes | `Duyệt & Tạo` left untouched | screenshot + log | PASS |

---

## Browser evidence

Directory: `Report/evidence/post-v1e2g-live/`

| File | Content |
|---|---|
| `01-agent-settings-surface-open.png` | Live Agent Settings panel open (role-less `FLOW-AGENT-PANEL`) |
| `02-awaiting-user-approval.png` | Live Flow composer + Agent Settings after preparation |
| `03-panel-awaiting-approval.png` | Flow Companion panel in `Chờ duyệt` state, primary = `Duyệt & Tạo` |
| `live-dom-state.json` | Independent in-page probe: prompt logical text + `domShape`, confirmation radios, aspect/output `aria-checked`, raw model label, Start button state, media count |
| `panel-awaiting-approval.txt` | Panel developer log of the successful run, Bridge token redacted |

Redaction: no Bridge token, Google auth token, cookie, password or account
identifier appears in any evidence file. The Bridge token was read from the
persistent local token file and injected into the panel field programmatically;
it was never echoed to stdout, the panel log, the DOM or any report.

---

## Fix/test iterations

| Iteration | Failure | Root cause | Fix | Rerun |
|---|---|---|---|---|
| 0 (live attempt 1) | `FLOW_MODE_UNKNOWN` — `flowMode: value=UNKNOWN verified=false` while the Agent Settings panel was visibly open | `MARKER_SOURCE_SELECTORS` only scans `button` / `[role=…]` / `input`. Live Flow renders the panel title as a plain `<h2 class="header-title">` and the section titles as `<span class="settings-section-label">` — **none of them are reachable**, so the mandatory `agent settings` heading marker could never be collected and `findAgentSettingsMarkerContainer` returned `null` | `AGENT_HEADING_SELECTOR = "h1…h6"` added to the Agent Settings marker scan only (the `>=3`-markers-in-one-container gate and the "lone heading never verifies" rule are untouched) | `npm test` → `passed=394 failed=0`; live attempt 2 exposed three further live gaps, so the fix continued |
| 1 (live, after the heading fix — gaps found by live DOM probes, not by guesswork) | confirmation / aspect / output / model all unresolvable | Live Agent Settings exposes **no** clean labels: (a) Always/Never are native `<input type=radio>` with **no ARIA role**, labelled by a sibling `<span class="radio-label">`; (b) aspect/output toggles carry a Material-Symbols ligature **glued** to the value (`crop_square1:1`); (c) sections are named only by standard ARIA (`role=radiogroup[aria-labelledby]`, `flow-toggles[aria-label="Image generation default aspect ratio"]`); (d) the model trigger is a `button[aria-label="Image generation default model"]` whose visible text is icon + name + ligature | Four small, standard-DOM/ARIA changes in `flow-page-adapter.js`: `input[type=radio\|checkbox]` added to `OPTION_SELECTORS`; `accessibleLabelOf` (`aria-label` → `aria-labelledby` → associated `<label>` first short chunk); `labelledGroupTextsOf` + `sectionLabelTextsOf` (ARIA-named groups count as section labels); `agentSemanticLabel` (drops ligature tokens, emoji glyphs and a ligature glued to a ratio); `agentModelCandidates` (model controls the short-label option scan skips) | `npm test` → `passed=421 failed=0` (394 baseline + 8 new `v1E2H` tests / 27 assertions) |
| 2 (live, `0.4.10-postv1e2h`) | — | — | full live re-validation after `ADAPTER_VERSION` bump + rebuild + extension reload + Flow tab reload | **PASS** (all rows of the acceptance matrix below) |

Note on counts: the runner counts **assertions**, not test cases, so
`passed=394` → `passed=421` is **+8 test cases / +27 assertions** — exactly the
assertions of the 8 new `v1E2H` tests. No pre-existing test changed behaviour:
the 394-assertion baseline stayed at `failed=0` across every iteration.

Adapter version was bumped `0.4.9-postv1e2g` → `0.4.10-postv1e2h` so the live
evidence is attributable to a single, named build (panel diagnostics confirmed
`adapterVersion: 0.4.10-postv1e2h` during the final run).

Local test-state note: to re-run the full `PREPARED → AWAITING_USER_APPROVAL`
path after the version bump, the local validation job fixture was reset to
`status: PREPARED` (no `approval` object, `generationCount: 0`). No other
project state was touched; nothing was published or generated.

---

## Security / credit check

| Check | Result |
|---|---|
| Real media generation triggered | **NO** — `clickedGenerate=false`, `Start generation` never clicked |
| Credits consumed | **NO** — `creditsConsumed=false` on every response, `generationCount: 0`, no credit display in the live UI |
| Final approval performed | **NO** — panel left at `Chờ duyệt` / `Duyệt & Tạo` |
| Destructive cloud action | **NO** — only: navigate, expose Agent Settings, read state, and the extension's own zero-credit preparation (which does switch `Confirm before generating` from **Never** to **Always** and clicks `Save`; that is a safety-increasing change, not a generation) |
| Bridge bound to loopback only | YES — `127.0.0.1:4317` |
| Bridge authentication enforced | YES — unauthenticated `GET /health` → `401`; token present → `200` |
| Bridge token rotated | NO — reused the persistent local token, never printed |
| Secrets in evidence / report / logs | NONE — token redacted in the panel log; no cookies, no auth tokens, no account identifiers |
| Side effects outside the task | The live Google account's Agent "Confirm before generating" was switched **Never → Always** and saved. Recorded here explicitly. |

---

## Repository regression

| Command | Actual result | Result |
|---|---|---|
| `npm run test:flow` | 14 suites, `0 failed suite(s)` | PASS |
| `cd flow-companion/extension && npm test` | `passed=421 failed=0` | PASS |
| `cd flow-companion/extension && npm run build` | `BUILD_OK … (29 files, MV3, minimal permissions)` | PASS |
| `npm run test:e2e` | `1 passed` — real MV3 extension panel, bridge auth + remember-token lifecycle | PASS |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` | PASS |
| `npm test` (full, 8 domains) | `0 failed suite(s) in 62.7s` | PASS |

Notes on the two deviations from the previous task's stated baseline:

1. The documented `npm test = 56/59` Smart App Control blocker did **not**
   reproduce — the full run is green in this session. Nothing was disabled,
   skipped, mocked or re-diagnosed to achieve that.
2. One intermediate full run reported `FAIL pipeline/test-step13-pipeline-e2e.js`
   while the live Chromium was still rendering the Flow page. Re-running the
   suite alone (`passed=3 failed=0 RESULT: PASS`), the whole `pipeline` domain
   (`0 failed suite(s)`), and then the full `npm test` (`0 failed suite(s)`) all
   passed. Recorded as a one-off contention flake with the live browser, **not**
   a regression from this task's changes (this task touched only
   `flow-page-adapter.js` and its tests).

### Changed files (this task)

- `flow-companion/extension/src/content/flow-page-adapter.js` — `ADAPTER_VERSION`
  `0.4.10-postv1e2h`; `input[type=radio|checkbox]` in `OPTION_SELECTORS`;
  `accessibleLabelOf`, `firstShortTextChunk`, `labelledGroupTextsOf`,
  `sectionLabelTextsOf`, `agentSemanticLabel`, `agentModelCandidates`,
  `AGENT_HEADING_SELECTOR`; `agentSectionChoice` / `agentConfirmationState` /
  `prepareAgentSettings` model+save lookups use the new semantic label.
- `flow-companion/extension/tests/run.js` — 8 new `v1E2H` regression tests
  built on a fixture that mirrors the real live Agent Settings DOM.
- `flow-companion/extension/.output/chrome-mv3/**` — rebuilt.
- `projects/postv1b-flow-companion-live/flow-jobs/FLOW-COMPANION-LIVE-GEN-01.json`
  — local validation fixture advanced to `AWAITING_USER_APPROVAL` by the run.
- This report + `Report/evidence/post-v1e2g-live/**`.

No unrelated code was refactored. No new dependency, selector library, test
framework or abstraction was added.

---

## Acceptance matrix

| Check | Expected | Actual | Evidence | Result |
|---|---|---|---|---|
| authenticated Google Flow session | available | authenticated, project page loaded | `01/02` screenshots | PASS |
| current extension build loaded | yes | `.output/chrome-mv3` rebuilt + CDP-reloaded, `extensionVersion 0.5.1` / `adapterVersion 0.4.10-postv1e2h` | panel diagnostics | PASS |
| Bridge connected | yes | `bridgeReachable: true`, token-gated, loopback | panel diagnostics | PASS |
| intended validation job loaded | yes | `FLOW-COMPANION-LIVE-GEN-01` (`PREPARED`) | `panel-awaiting-approval.txt` | PASS |
| Agent Settings detected | yes | role-less surface resolved | 2G/2H regression tests + live log | PASS |
| `flowMode` | `AGENT` | `AGENT` verified | live log | PASS |
| multiline prompt logical text | exact match | exact, 82 chars | `live-dom-state.json` | PASS |
| newline preservation | PASS | PASS | `live-dom-state.json` | PASS |
| Confirm before generating | `Always` | `ALWAYS` (radio `value=1` checked) | `live-dom-state.json` | PASS |
| generation type | IMAGE | `requestedCapability=IMAGE`, route `AGENT/IMAGE` | live log | PASS |
| aspect ratio | `1:1` | `crop_square1:1` checked | `live-dom-state.json` | PASS |
| output count | `1/x1` | `x1` checked | `live-dom-state.json` | PASS |
| model label | clean | `Nano Banana 2` | live log + `live-dom-state.json` | PASS |
| generation route | `AGENT/IMAGE` | `AGENT/IMAGE` verified | live log | PASS |
| generation readiness | `READY` | `generationReady=true missing=[]` | `panel-awaiting-approval.txt` | PASS |
| final job state | `AWAITING_USER_APPROVAL` | `AWAITING_USER_APPROVAL` | job JSON + `03` screenshot | PASS |
| paid generation triggered | NO | NO | `clickedGenerate=false`, `mediaCount=0` | PASS |
| credits consumed | NO | NO | `generationCount: 0`, `creditsConsumed=false` | PASS |

---

## Remaining issues

1. **Real Chrome (branded, `154.0.8037.92`) refuses `--load-extension`.**
   `--load-extension` + `--enable-unsafe-extension-debugging` +
   `--remote-debugging-port` were all passed and Chrome started, but the
   extension never registered (no service-worker target; CDP
   `Extensions.loadUnpacked` succeeded, i.e. it had not been loaded, and its
   pages returned `ERR_BLOCKED_BY_CLIENT`). Validation therefore ran on
   Playwright's bundled Chromium — same engine, real MV3, real authenticated
   Google session, real `flow.google.com`. Not a UNFOLDIQ defect, but it means
   the branded-Chrome launch path used by earlier sessions is currently broken
   on this machine.
2. **`Agent instructions` vs `Agent settings` marker freshness.** The heading
   and section markers are English literals. A localized Flow UI would need a
   marker refresh (unchanged limitation from 2G).
3. **`promptReadback` remains failure-path only.** It was not exercised live
   because Blocker B did not reproduce; its unit coverage stands.
4. **Panel developer log wording.** `autoPrepare` logs `standardMode=true`
   unconditionally whenever `res.settings` exists, including on the AGENT path.
   It is cosmetic (the authoritative `generationType=NOT_APPLICABLE` line is
   right next to it) and was left alone to keep this diff minimal.
5. **Live UI labels are ligature-glued** (`crop_square1:1`). The new
   `agentSemanticLabel` handles the ratio case and whitespace-separated
   ligature tokens; a future Flow label that glues a ligature to a
   non-ratio, non-alphanumeric value would need one more rule.

---

## Final conclusion

```
TASK_VALIDATION       = PASS
REPOSITORY_REGRESSION = PASS
```

Every item in the acceptance matrix is backed by evidence produced on a real,
authenticated Google Flow session against the real extension build
(`0.4.10-postv1e2h`), and the run terminated at the required terminal state
`AWAITING_USER_APPROVAL` with **no generation and no credits consumed**.

Blocker A was **not** a "Flow changed its ARIA" story: the 2G resolver was
structurally unable to see the live panel, because every label that identifies
it is plain text. The fix is small, standard-DOM/ARIA only, covered by 8 new
regression tests, and left all 394 pre-existing tests green.

Blocker B did **not** reproduce on live: the multiline prompt was verified
exact on the first attempt, and the writer was left untouched as the spec
required.