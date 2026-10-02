# POST-v1E FIX 02 — FLOW COMPOSER READINESS REPORT

Date: 2026-09-30
Scope: composer readiness race + failed single-flight latch + ping telemetry + probe privacy
Mode: ponytail (minimal diffs, no redesign)

## 1. Status

Code complete, all tests green, build refreshed. **LIVE VALIDATION PENDING** (see §17).

## 2. Real live evidence

- `autoPrepare` reached `PREPARED`, started, then failed:
  `autoPrepare: preparation failed stage=prompt code=PROMPT_INPUT_NOT_FOUND`
- Timing probes: at ~02:52:54 `[contenteditable="true"]=0, input=0`; at ~02:53:00 `[contenteditable="true"]=1, input=2`. The Flow prompt composer mounts asynchronously after a UI transition.
- After that failure the next fetch logged `autoPrepare: already prepared key=FLOW-COMPANION-LIVE-GEN-01|1|...` — a failed attempt was latched as completed.
- Resolver logged `ping=true` while autoPrepare logged `ping=undefined`.
- Probe output contained account-identifying aria-labels despite the no-account-content claim.

## 3. DOM readiness race root cause

`PREPARE_GENERATION` stage "prompt" did a single synchronous lookup
(`assessDryRunReadiness`) and treated "not present now" as "does not exist".
The composer mounts late, so the first lookup races the UI transition.

## 4. Composer readiness design

New canonical adapter method `waitForPromptComposer(root, { timeoutMs, pollMs })`
in `flow-page-adapter.js`:

1. immediate lookup via `resolvePromptComposer`;
2. if missing, `MutationObserver` on the document (re-resolves from fresh DOM on every relevant mutation);
3. if no observer is usable (test/mock environments), bounded poll on fresh DOM with identical semantics;
4. succeeds as soon as the real composer appears;
5. bounded timeout (`FLOW_COMPOSER_READY_TIMEOUT_MS = 10000`) — safety boundary only, never the success mechanism;
6. observer always disconnected (and timer cleared) on success, failure, and timeout.

## 5. Scoped selector strategy

Canonical live anchor: `button[aria-label="Add ingredients to the prompt box"]`.
`resolvePromptComposer` walks up (bounded, 10 levels) from the anchor to the
nearest ancestor containing an interactable editor. Inside that scope the
editor resolves best-first: `input[aria-label="Editable text"]` → visible
`[contenteditable="true"]` → existing constrained PROMPT_INPUT fallbacks.
If no anchor exists (UI revamp), the constrained fallback path still applies.
Hard-excluded everywhere: `input[aria-label="Search"]`,
`textarea[name="g-recaptcha-response"]` / any CAPTCHA/recaptcha concept,
account/profile UI (`Google Account`, `Account details`, `membership`,
`profile`, `signed in`), hidden/disabled editors. CAPTCHA elements are never
used.

## 6. MutationObserver implementation

Same pattern as the existing `observeResults`: observer preferred, bounded
poll fallback, single `finish()` path that guarantees disconnect. Resolution
always re-reads fresh DOM; nothing is assumed from the mutation itself.

## 7. Timeout semantics

While waiting, preparation is in-flight (no failure is emitted; the
intermediate state is named `FLOW_COMPOSER_NOT_READY` in the timeout detail
metadata). Only after the bounded deadline does the command return
`{ stage: "prompt-composer", code: "FLOW_COMPOSER_READY_TIMEOUT", elapsedMs }`.
A first missing lookup never fails. `msg.composerTimeoutMs` allows callers
(and tests) to tune the boundary.

## 8. Single-flight failure-latch fix

`auto-prepare.js` bookkeeping refactored to `inFlightKeys` (Set) +
`successfulKeys` (Map). Rules now enforced:
- same key in-flight → dedupe (`IN_FLIGHT`);
- only successful preparation reaching `AWAITING_USER_APPROVAL` → `successfulKeys.set(key)`;
- any failure (returned failure, thrown error) → `successfulKeys.delete(key)`, in-flight removed in `finally`;
- the watchdog path no longer latches either.

## 9. Retry behavior

`Thử lại` runs `runPipeline` (fresh tab resolution + fresh job fetch) and,
with the latch removed, the same job key runs a real fresh attempt against
freshly resolved DOM. `already prepared` after a failed prep is now
impossible — regression-tested (forbidden-string assert).

## 10. Ping telemetry fix

One canonical field: `ping` (boolean). `pingOf(tab)` in `auto-prepare.js`
normalizes the resolver's `pingSuccess` shape (`ping=undefined` impossible
when the content script answered); the side panel's `resolveLiveTab` dep also
stamps `res.ping = res.pingSuccess === true` so every consumer (autoPrepare,
side panel, developer diagnostics, tests) reads the same signal.

## 11. Safe-probe privacy issue

`probeCandidateControls` recorded raw `aria-label`/`title`/`name` values,
which in live output included account-identifying metadata. Fixed at the
single choke point (adapter) so UI logs are covered too.

## 12. Account/CAPTCHA exclusions

Candidates self-identifying (via aria-label, title, name, or visible button
label) as account/profile UI, Search, or CAPTCHA/recaptcha are excluded
before entry construction (`isForbiddenControl`, `ACCOUNT_UI_RE`,
`FORBIDDEN_CONTROL_RE`). ponytail note recorded in code: own-attribute
exclusion only (no ancestor subtree walk) — add ancestor check if a live leak
ever shows up.

## 13. Redaction

`redactSafe()` applied to every probe string before it leaves the adapter:
email addresses → `[REDACTED_EMAIL]`; long opaque token-like runs (≥25 chars
of `[A-Za-z0-9_-]`) → `[REDACTED_TOKEN]`. Values, prompt content, media
sources, alt text, and placeholders were already never read.

## 14. Tests

`flow-companion/extension` suite: **passed=83 failed=0** (13 new FIX02
regressions):

- async composer mount (adapter-level: editor added at t+60ms resolves via wait)
- async composer mount end-to-end (`PREPARE_GENERATION` with late-mounted prompt input → prepared, `composerWait.waited=true`)
- composer timeout (bounded failure, elapsed metadata; command-level `stage=prompt-composer code=FLOW_COMPOSER_READY_TIMEOUT`)
- failure does not mark success (retry runs, `calls=2`, forbidden `already prepared` absent)
- failed prerequisite never logs `generationReady=false missing=[]` (`NOT_EVALUATED` + non-empty missing asserted)
- successful dedupe (`COMPLETED` skip + `already prepared` allowed only after success)
- ping telemetry (`pingSuccess` shape → `ping=true`, `ping=undefined` forbidden)
- safe probe privacy (account/membership/CAPTCHA/Search excluded, email redacted; Add-ingredients anchor + Generate still observable)
- `redactSafe` unit (email, token, normal label untouched)
- `composerProbe` fields on both anchor-scoped and legacy page shapes
- anchor scoping (`resolvePromptComposer` via composer container)

Adjacent root suites re-run: `test-flow-postv1e.js` (56/0),
`test-flow-page-adapter.js` (20/0), `test-flow-state-machine.js` (15/0),
`test-flow-safety-retry.js` (34/0) — all pass.

## 15. Security/privacy regression

Unchanged and re-verified: no cookies permission, no token persistence, no
private Flow API, no CAPTCHA interaction of any kind, no `<all_urls>`, no
account scraping (now actively excluded + redacted), no remote executable
code. The probe never reads values/content; `composerProbe` outputs booleans
and a type label only.

## 16. Files modified

- `flow-companion/extension/src/content/flow-page-adapter.js` — composer resolution/wait/probe, probe privacy, exports
- `flow-companion/extension/src/content/content-commands.js` — prompt-composer wait stage, `COMPOSER_PROBE`, `composerWait` in response
- `flow-companion/extension/src/ui/state/auto-prepare.js` — successfulKeys latch fix, `pingOf`, honest readiness log, stage logs
- `flow-companion/extension/src/ui/sidepanel.js` — canonical `ping` stamp, `FLOW_COMPOSER_READY_TIMEOUT` error mapping
- `flow-companion/extension/src/ui/components/developer-tools.js` — one diagnostics line for composer state
- `flow-companion/extension/tests/run.js` — 13 FIX02 regressions
- Rebuilt: `.output/chrome-mv3` (`BUILD_OK`, 29 files; new code verified present in bundle)

## 17. Live validation status

Not yet performed (requires the real browser session: reload extension,
refresh Flow, open side panel, token if needed). Automated evidence above is
node-test-level only.

Expected live path: `PREPARED` → autoPrepare → waits for composer if not
mounted → composer appears → prompt inserted/verified → STANDARD → IMAGE →
1:1 → output 1 or honest UNKNOWN → model/cost live or UNKNOWN → Generate
enabled → `AWAITING_USER_APPROVAL` (● Sẵn sàng / [Duyệt & Tạo]). No
Generate click, no credit consumption.

## 18. Remaining blocker

Live validation of the composer wait against the real Flow UI (the anchor
selector is live-observed but best-effort; if Flow renames it, the fallback
path still resolves the editor).

## 19. Conclusion

**POST-v1E FIX 02 FLOW COMPOSER READINESS: LIVE VALIDATION PENDING**
