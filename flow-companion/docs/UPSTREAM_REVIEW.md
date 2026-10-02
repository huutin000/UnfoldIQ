# Upstream Review — NeetroxX/Auto-Flow (STEP 10B, §5)

Reviewed 2026-09-26 via live fetch of https://github.com/NeetroxX/Auto-Flow
(main, 42 commits; 1 star; 1 fork; Apache-2.0).

## Confirmed architecture

Side Panel (React) → Background BatchEngine state machine → Content script
(FlowPageAdapter) → Google Flow, with `chrome.downloads` fed by result URLs
from a MAIN-world network listener. WXT build, vitest (46 unit tests), mock
Flow harness (`harness/` + `window.FlowHarness`), one centralized
`SELECTORS` block in `src/content/flow-page-adapter.ts`.

## Keep / adapt candidates (concepts only — no code vendored)

BatchEngine/state-machine shape, persisted queue, pause/resume, side-panel
infrastructure, page-adapter boundary, `chrome.downloads` integration, WXT
setup shape, harness/mock-page testing concepts.

## Rework candidates (must not be trusted as-is)

Prompt-batch model (UNFOLDIQ needs per-scene jobs, not prompt batches);
result-URL discovery (README warns request-URL + extension matching may fail —
JSON-body results need a response-fed bus or DOM scraping fallback);
settings selectors and output-count assumptions (explicitly placeholders);
folder naming (UNFOLDIQ needs deterministic scene/attempt paths); manual
reference picker (UNFOLDIQ injects locked refs); retry behavior and stop
latency (I2: stop observed only at item boundaries).

## Remove / reject

Anything bypassing CAPTCHA, scraping credentials, replaying private tokens,
using undocumented private Flow APIs, hiding credit consumption, launching
unlimited unattended generation, writing arbitrary paths, or silently
retrying paid generations. None of this exists in UNFOLDIQ's implementation.

## License handling

No upstream code vendored → no license text to preserve. Apache-2.0
obligations recorded in `LICENSES/THIRD_PARTY_NOTICES.md` for future work.
