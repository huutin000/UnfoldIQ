# POST-v1E.2F — AGENT MODE ROUTING AND DEFAULTS REPORT

Date: 2026-09-30
Scope: flowMode detection (AGENT/STANDARD/UNKNOWN), Agent Settings preparation (confirmation/aspect/output/save-persistence), mode-aware side-effect semantics, Agent readiness gate
Mode: ponytail (Standard pipeline kept intact; prompt handling, aspect/output Standard selectors, notifications, cleanup safety unchanged)

## 1. Live evidence recap

Composer toolbar: Agent instructions / Settings / Start generation. Opening the
live `ariaLabel="Settings"` control shows an **Agent settings** surface
(Confirm before generating: Always/Never; Image generation default: 16:9, 4:3,
1:1, 3:4, 9:16, x1–x4, model Nano Banana 2; Video generation default: 16:9,
9:16, x1–x4, model Omni 1.1 Flash; Save). The extension still demanded exact
Image/Video generation-type choices → `GENERATION_SURFACE_NOT_RESOLVED`. That
assumption is wrong for Agent mode.

## 2. flowMode detection (P0)

`resolveFlowMode(root, opts)` → `AGENT | STANDARD | UNKNOWN`, with
`probeLog` lines `flowMode: value=… verified=… evidence=[…]`:

1. already-open AGENT_SETTINGS surface → AGENT (no clicks);
2. cheap current-mode evidence (no clicks): verified Standard generation type
   (mode control/tab semantics) → STANDARD;
3. transactional Settings probes (max 3 candidates, rollback in finally):
   opened surface classified `AGENT_SETTINGS` → AGENT verified;
   exact Image+Video generation menu → STANDARD verified;
   anything else → rolled back, next candidate;
4. `Agent instructions` control presence is recorded as supporting evidence
   but NEVER verifies the mode alone — the verified Agent Settings surface is
   required. Arbitrary page text ("Agent settings" anywhere on the page) never
   verifies (regression-tested).

## 3. Routing (P0)

`PREPARE_GENERATION` after prompt PASS: `resolveFlowMode` →
- **STANDARD**: existing pipeline unchanged (ensureStandardMode →
  selectGenerationType IMAGE → aspect → outputs → model/cost → readiness).
  All previous Standard suites green.
- **AGENT**: `dispatchAgentPreparation` — NO Image/Video generation-type
  switch (a test spy proves `selectGenerationType` is never called). Agent
  path: prompt verified → flowMode AGENT verified → Agent Settings verified →
  confirmation policy → image defaults → save/verify → readiness.
- **UNKNOWN**: `FLOW_MODE_UNKNOWN` at stage `flow-mode`.

## 4. Agent Settings surface + preparation (P0)

`classifySurface` now returns `AGENT_SETTINGS` (≥2 strong markers: "Agent
settings", "Confirm before generating", "Image generation default", "Video
generation default", "Save") — ranked before ASSET_PICKER, and such a surface
is never rolled back as UNKNOWN.

`prepareAgentSettings(root, { confirmationPolicy="ALWAYS", aspectRatio="1:1", outputCount=1 })`:

- opens the Agent Settings surface transactionally
  (`openAgentSettingsSurface`: settings candidates → AGENT_SETTINGS
  classification only; wrong surfaces rolled back);
- **Confirmation policy** (ASSISTED_APPROVAL → MUST be Always): reads selected
  Always/Never semantics inside the "Confirm before generating" section; if
  Already Always → no click; if Never/unset → clicks Always and verifies
  selected state; Never is never silently selected;
- **Image aspect** — resolved ONLY inside the "Image generation default"
  section (ancestor-scoped choice resolution; the Video section is never
  touched — regression-tested with a video x1 decoy);
- **Image output** — `x1` maps to outputCount=1, same Image section only;
- **Model** — observed read-only from the verified Image section
  ("model: Nano Banana 2"); never changed when the job requests no model;
  modelLabel is only populated from this verified surface (generic page
  dropdowns remain excluded by the 2D gate);
- **Save + persistence** — after any change: click `Save`, close the surface,
  reopen, reread confirmation/aspect/output; only reread equality yields
  `agentSettingsVerified=true` (else `AGENT_SETTINGS_NOT_PERSISTED`); with no
  changes required, live values are still verified before readiness;
- the settings surface is closed at the end (UI restored); error codes:
  `AGENT_SETTINGS_NOT_RESOLVED`, `AGENT_CONFIRMATION_NOT_SET`,
  `AGENT_IMAGE_ASPECT_NOT_SET`, `AGENT_IMAGE_OUTPUT_NOT_SET`,
  `AGENT_SAVE_NOT_FOUND`, `AGENT_SETTINGS_NOT_PERSISTED`.

## 5. Capability representation + readiness gate (P0)

`generationType` is not overloaded: the Agent response carries
`requestedCapability="IMAGE"`,
`generationRoute={mode:"AGENT", capability:"IMAGE", verified:true}`, and
`settings.generationType="NOT_APPLICABLE"`. Agent readiness requires: prompt
verified AND flowMode=AGENT verified AND requestedCapability=IMAGE AND
agentConfirmation=ALWAYS verified AND imageAspect=1:1 verified AND
imageOutputCount=1 verified AND Start generation found AND enabled. Model is
informational. `generationType=IMAGE` is NOT required in Agent mode
(regression-tested, including a spy proving the Standard switch is never
invoked).

## 6. Mode-aware side-effect semantics (P0)

`detectGenerationRunning(root, before, flowMode)`: in AGENT mode a Start→Stop
transition alone is `agentState=BUSY`, `mediaGenerationState=IDLE` — never
proof of credit-spending media generation (logged
`agentState: BUSY mediaGenerationState: IDLE`); no
UNEXPECTED_GENERATION error from that signal during Agent preparation. The
guard for unexpected probe-caused Start clicks (a NEW stop/cancel control
appearing) still applies in every mode, and preparation never intentionally
clicks Start generation (regression-tested).

## 7. Changed files

- `flow-companion/extension/src/content/flow-page-adapter.js` — AGENT_SETTINGS classification, resolveFlowMode, openAgentSettingsSurface, prepareAgentSettings (section-scoped choices, confirmation policy, save/persistence), mode-aware detectGenerationRunning, ADAPTER_VERSION `0.4.8-postv1e2f`
- `flow-companion/extension/src/content/content-commands.js` — flow-mode routing stage, `dispatchAgentPreparation` (readiness gate + response fields), probeLogs threading
- `flow-companion/extension/tests/run.js` — 9 new v1E.2F regressions
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`; new code verified in bundle)

## 8. Tests

Extension suite: **passed=356 failed=0**. New v1E.2F regressions: (1) Agent
Instructions + verified Agent Settings → flowMode AGENT verified; (2) page
text "Agent settings" alone never verifies; (3) AGENT_SETTINGS classification
(both classifier entry points); (4)+(12)+(15) AGENT mode skips the Standard
switch (spy), reaches READY without generationType=IMAGE
(`NOT_APPLICABLE`), Start generation never clicked; (5) Always already selected
→ no click, still verified; (6) Never → Always with selected-semantics
verification; (7)+(8)+(9)+(10) image-section scoping (1:1 + x1 clicked, video
x1/16:9 decoys untouched, model "Nano Banana 2" observed read-only); (11)
Save + close/reopen persistence reread; (13) STANDARD gate intact
(`GENERATION_TYPE_UNKNOWN` still blocks readiness); (14) Agent Start→Stop =
`agentState=BUSY` / `mediaGenerationState=IDLE`, never
UNEXPECTED_GENERATION; (16) all previous Flow regression suites green.

## 9. Regression result

Extension 356/0. All root Flow suites ALL TESTS PASSED (single batch):
`test-flow-postv1e`, `test-flow-postv1b`, `test-flow-postv1c`,
`test-flow-postv1d`, `test-flow-page-adapter`, `test-flow-state-machine`,
`test-flow-safety-retry`, `test-flow-bridge`, `test-flow-jobs`,
`test-flow-origin`, `test-flow-manual-assist`.

## 10. Live validation status

**POST-v1E.2F CODE COMPLETE — LIVE VALIDATION PENDING.** After reload +
Retry, expected: `flowMode=AGENT verified=true` → Agent Settings opened →
`agentConfirmation expected=ALWAYS observed=… changed=… verified=true` →
`agentImageDefaults aspect=1:1 outputCount=1 model="Nano Banana 2" (or current
live value)` → Save/reopen persistence → `generationRoute mode=AGENT
capability=IMAGE verified=true` → `generationReady=READY` →
AWAITING_USER_APPROVAL. No media generation during preparation. Old
Video→Image switching acceptance applies only to STANDARD mode.

## 11. Conclusion

**POST-v1E.2F CODE COMPLETE — LIVE VALIDATION PENDING**
