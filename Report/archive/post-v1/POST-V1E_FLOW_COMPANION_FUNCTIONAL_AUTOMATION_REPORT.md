# Report — POST-V1E FLOW COMPANION FUNCTIONAL AUTOMATION

Date: 2026-09-29
Extension version: 0.4.0 → **0.5.0** (functionality only; UX frozen per §2)
Adapter version: 0.3.0-postv1c → **0.4.0-postv1e**
Target job: `FLOW-COMPANION-LIVE-GEN-01` @ `postv1b-flow-companion-live`
Live origin: `https://flow.google.com`
Credits consumed in this task: **0** (implementation + fixtures only)

---

## 1. Status

**IMPLEMENTATION COMPLETE — LIVE GENERATION READY PENDING USER APPROVAL.**
All automatable work is done and tested. The remaining steps require the
operator's authenticated browser session (Part 1 zero-credit prep review,
then explicit APPROVE for the Part 2 credit-consuming run). Per §52 this
report does NOT claim full PASS.

## 2. UI baseline / freeze

v0.4.0 task-centric UI accepted as-is: compact header, status chip, job
card, one CTA, stepper, Settings screen, Developer Mode OFF by default,
fluid responsive shell. Only functional UI delta in v0.5.0: job-card
`Xem chi tiết` gains a `Chốt phê duyệt <timestamp>` row when a snapshot
is frozen (§22 — the packet the user approves must show its freeze time).
No color/layout/navigation/framework changes.

## 3. Existing live evidence

Inherited baseline (not repeated): 1 connected Flow tab,
`https://flow.google.com`, ping=true, contentScriptInjected=true,
bridgeReachable=true, PROMPT_READY/DRY_RUN_READY PASS, prompt
inserted+verified, clickedGenerate=false, creditsConsumed=false.

## 4. Real generation job prompt

`FLOW-COMPANION-LIVE-GEN-01` previously carried the dry-run wrapper
(`UNFOLDIQ Flow Companion live automation dry-run. …`). The CANCELLED
record is terminal, so the job was **recreated through the canonical
store + state machine** (PENDING → VALIDATED → PREPARED) with the exact
production prompt and unchanged identity
(requestId `REQ-POSTV1B-GEN-01`, scene `GEN01`, `1:1` × 1 output):

```text
Create a simple minimal blue circle centered on a clean light background.
No text.
```

Dry-run history preserved via record note. Regression: test E1 asserts
byte-exact prompt, no `/dry-run/i`, parked pre-approval status.

## 5. Flow settings discovery

Adapter gained popover-aware discovery (§10): `openGenerationSettings()`
clicks the model/settings trigger and verifies opening via
`aria-expanded` or a surfaced `menu/listbox/dialog` role (never assumes);
`closeGenerationSettings()` sends Escape best-effort; `scanSettingOptions()`
scans role options (`option/menuitem/menuitemradio/radio`) then
short-labelled buttons only (bounded 200, icon text rejected). Missing
trigger classifies `MODEL_CONTROL_NOT_FOUND`; unobservable popover
classifies `SETTINGS_POPOVER_NOT_OBSERVED` (registered error code).

## 6. IMAGE mode

`selectGenerationType(root, "IMAGE")`: keeps current if already verified,
else clicks the dedicated mode control, else a matching option label —
then **re-reads** `detectGenerationType()` and only returns ok on
`IMAGE + verified`. Never trusts job metadata. (E3.)

## 7. Aspect

`selectAspect(root, "1:1")`: reuses the icon-rejecting normalizer (§15
kept), selects the matching live option, re-reads for exact `1:1`.
If `1:1` is not offered → `TARGET_ASPECT_NOT_AVAILABLE`, no Generate.
(E4.)

## 8. Output count

`selectOutputCount(root, 1)`: same select + re-read discipline. No
explicit control → `OUTPUT_COUNT_NOT_AVAILABLE`, value stays UNKNOWN,
never fabricated. (E5.)

## 9. Model

No hard-coded model names anywhere. `readModelLabel()` returns the exact
live label or UNKNOWN; preparation never switches models to satisfy
tests; approval packet shows live label or UNKNOWN. (E5.)

## 10. Credit cost

`readCreditCost()` records the exact visible value or UNKNOWN; UNKNOWN
never becomes zero; approval validity is bound to the shown packet via
the snapshot fingerprint (§22–§24, E7).

## 11. GENERATION_READY

Unchanged contract (promptVerified + IMAGE verified + Generate found +
enabled + AWAITING_USER_APPROVAL; optionals may be UNKNOWN) now fed by
the new verified selectors. New gap closed: nothing previously moved the
bridge job PREPARED → AWAITING_USER_APPROVAL, so the extension now calls
the new narrow endpoint `POST /jobs/:id/await-approval` after live
readiness is verified (idempotent; never consumes approval). (E12.)

## 12. Approval snapshot

`src/contracts/approval-snapshot.js` (new, DOM-free, shipped in build):
freezes jobId/attempt/prompt/type/model/aspect/outputCount/visibleCost/
referenceSummary + timestamp + nonce; fingerprint = canonical JSON of
material fields. Frozen automatically when preparation reports ready;
freeze time logged and shown in job details. (E7.)

## 13. Approval consumption

One approval → one submission, enforced at three layers: bridge
state-machine (fresh unused approval per job+attempt, generation budget),
service-worker single-use local approval now bound to nonce + snapshot
fingerprint when presented (backward compatible), content-side
`checkApproval`. Double-click, rerender, worker restart (map wiped →
`APPROVAL_REQUIRED`), and cross-packet nonces all fail closed. (E9.)

## 14. Generate submission

`SUBMIT_GENERATE` now: (a) validates approval, (b) revalidates live state
against the snapshot when present — any material drift throws
`APPROVAL_STALE_CHANGED` naming the fields, (c) refuses disabled/missing
Generate without clicking, (d) captures the pre-Generate result baseline
returned to the caller. Exactly-once click proven in fixture (E8).

## 15. Generation-start evidence

`readGenerateState()` (found/enabled/busy via `aria-busy`/`data-loading`/
short busy labels) + pure `assessGenerationStart()`: evidence strings
`generate-disabled-after-submit`, `generate-busy`, `new-result-appeared`.
No fixed-sleep assumptions; no evidence → not started. (E10.)

## 16. Result detection

Baseline captured before Generate; `READ_RESULT` accepts the baseline
and returns `newUrls` filtered by `diffNewResults()` — pre-existing media
never correlates to the attempt. Sidepanel poll loop prefers `newUrls`
when present, logs `urls=X new=Y`. Timeout stays a timeout. (E10.)

## 17. Download

Path A (Flow's own Download UI via `TRIGGER_DOWNLOAD`) + in-page bytes
fetch remain the automatic path; no private APIs, tokens, cookies, or
endpoint reverse-engineering. No permission changes. (§31.)

## 18. Download correlation

`correlateDownload()` now marks `correlation: DIRECT` for explicit-id
matches vs `FALLBACK_CORRELATION` for bounded latest-file fallbacks
(time window + MIME gate kept). Import provenance records downloadId,
filenames, timestamps, fingerprint. (E11.)

## 19. Import

Existing bridge artifact pipeline reused unchanged (MIME allowlist, magic
sniff, 60 MB cap, tmp+rename, project-confined canonical path
`assets/<cap>/<scene>/<scene>_attempt-NN.<ext>`), fully automatic — no
manual find/rename/copy. Target for this job:
`projects/postv1b-flow-companion-live/assets/FLOW-COMPANION-LIVE-GEN-01.<ext>`
(actual canonical name per scene convention). (E12 loopback-proven.)

## 20. Structural QA

`structuralQA()` (exists, verified): non-zero, expected extension,
image decodes with width/height, SHA-256. **New:** the artifact endpoint
persists `projects/<project>/qa/structural-qa.json` with PASS + jobId,
attempt, path, sha256, bytes, mime, dimensions, downloadId,
promptFingerprint, timestamp — READY requires this PASS. Corrupt and
zero-byte assets fail with precise codes. (E12–E13.)

## 21. Final job state

Explicit chain enforced by the state machine (no PREPARED→READY jumps):
PREPARED → AWAITING_USER_APPROVAL → GENERATING → RESULT_DETECTED →
DOWNLOADING → IMPORTED → READY. Normal UI: `Hoàn tất`, CTA becomes
`Xem kết quả`. (E12 end-to-end on loopback.)

## 22. Click-count / user actions

Happy path unchanged from v1D: 0 infrastructure clicks (resolve, fetch,
dry-run, state probe, await-approval marking, download, import all
automatic) + **1 meaningful click** (`Duyệt & Tạo`). Fresh approval
required per credit attempt; stale config forces re-freeze, never silent
retry.

## 23. Errors/warnings

New precise codes (all registered): `SETTINGS_POPOVER_NOT_OBSERVED`,
`TARGET_ASPECT_NOT_AVAILABLE`, `OUTPUT_COUNT_NOT_AVAILABLE`,
`AGENT_MODE_DETECTED`, `APPROVAL_STALE_CHANGED`, `APPROVAL_MISMATCH`,
`GENERATE_CLICK_FAILED`, `GENERATION_START_NOT_CONFIRMED`. Existing
taxonomy (RESULT_TIMEOUT, PROVIDER_SAFETY_REFUSED, FLOW_UI_CHANGED,
DOWNLOAD_*/IMPORT_FAILED) reused; manual-assist stays a route, never a
diagnostic category. Agent-mode note: STANDARD baseline enforced; a plain
switch-off is attempted + verified, otherwise an actionable Vietnamese
message blocks Generate (§8, E6).

## 24. Security regression

No `<all_urls>`, no cookies permission, token memory-only, no password
storage, no private Flow API, no CAPTCHA bypass, no remote code, bridge
loopback-only, probe metadata allowlist unchanged, DOM authority still
exclusively FlowPageAdapter (FP15 PASS). Doctor exit 0; build credential
scan PASS.

## 25. Tests

```text
NEW  test-flow-postv1e.js → 56 assertions PASS (E1–E13: §42–§46 + §5)
     test-flow-postv1b.js → 177 PASS (dry-run/bridge/relay intact)
     test-flow-postv1c.js → 95 PASS (readiness/packet/UI contracts)
     test-flow-postv1d.js → 136 PASS (UX simplification intact)
     test-flow-page-adapter.js → PASS (FP1–FP15)
     extension tests/run.js → 6 PASS
     validate-schemas.js → ALL PASS · doctor → 0 · build → 28 files MV3
```

## 26. Files modified

```text
projects/.../flow-jobs/FLOW-COMPANION-LIVE-GEN-01.json (recreated, §5)
flow-companion/bridge/server.js (await-approval endpoint, qa write)
flow-companion/extension/src/content/flow-page-adapter.js (0.4.0: popover,
  select IMAGE/1:1/output-1, ensureStandardMode, baseline/diff, start state)
flow-companion/extension/src/content/content-commands.js (submit revalidation,
  disabled-never-click, READ_RESULT baseline filter)
flow-companion/extension/src/background/service-worker.js (nonce/fingerprint
  binding, DIRECT/FALLBACK marking, new error codes)
flow-companion/extension/src/contracts/approval-snapshot.js (NEW)
flow-companion/extension/src/ui/sidepanel.js (snapshot freeze, await-approval
  marking, baseline-aware poll, snapshot in approval)
flow-companion/extension/src/ui/sidepanel.html (snapshot script tag)
flow-companion/extension/src/ui/components/job-card.js (freeze timestamp row)
flow-companion/extension/build.js (28 files) · manifest/package → 0.5.0
test-flow-postv1e.js (NEW)
```

Tab resolver, probe policy, provider runtime, v1D presentation: untouched
except the one freeze-timestamp row.

## 27. Remaining limitations

1. Live Part 1 (operator): rebuild → reload extension → refresh Flow →
   open panel → automatic prep → verify IMAGE/1:1/1 output/model/cost →
   confirm AWAITING_USER_APPROVAL → STOP, report packet. No Generate.
2. Live Part 2 (explicit APPROVE only): `Duyệt & Tạo` → Generate ×1 →
   result → download → import → QA → READY.
3. Real Flow settings DOM is unseen from here: popover/option discovery
   is fixture-verified; first live run may surface new controls — the
   safe probe + precise codes exist exactly for that iteration.
4. Reference jobs: blue-circle validation uses none (`referenceAsset =
   none`); reference contract preserved for future jobs.
5. Next workstream after close (not started): QUALITY 01 Voice + Caption.

## 28. Final conclusion

Implementation satisfies every automatable §53 item (preparation,
11–12 approval mechanics, 13–21 pipeline mechanics on loopback, 23–25
constraints); live items 1 and 12–21 on the real tab await the operator
session. No manual assist in the designed path; no silent retries; no
credit consumed in this task.

`POST-v1E FLOW COMPANION FUNCTIONAL AUTOMATION: LIVE APPROVAL PENDING`
