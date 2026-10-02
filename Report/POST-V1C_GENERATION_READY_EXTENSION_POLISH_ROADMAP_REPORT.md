# Report — POST-V1C GENERATION READY + ESSENTIAL POLISH + ROADMAP

Date: 2026-09-29
Workstream: POST-v1B FLOW COMPANION LIVE AUTOMATION (continued)
Extension version: 0.2.0 → **0.3.0**
Adapter version: 0.2.0-postv1b → **0.3.0-postv1c**
Live origin: `https://flow.google.com`
Credits consumed in this task: **0** (no Generate click — stop condition honored)

---

## 1. Status

**POST-v1C implementation COMPLETE, all automated gates PASS.**
`GENERATION_READY` contract implemented and fixture-verified; essential
extension polish implemented; roadmap realigned. No live Generate click
occurred in this task — the next step remains a user-facing
review → APPROVE / REJECT on the live approval packet.

## 2. Starting live evidence

Inherited from the POST-v1B zero-credit dry-run (COMPLETE, not repeated):

```text
connected Flow tabs: 1
liveTab ping=true
PROMPT_READY=PASS
DRY_RUN_READY=PASS
prompt inserted=true
prompt verified=true
clickedGenerate=false
creditsConsumed=false
DRY-RUN PASS (PROMPT_INJECTION)
```

Blocking observation carried into this task:

```text
generateFound=true
generateEnabledAfterPrompt=false
model=UNKNOWN
aspect=arrow_forward   ← icon/label artifact, NOT a real aspect ratio
cost=UNKNOWN
MODE_IMAGE / GENERATION_TYPE / MODEL_CONTROL / OUTPUT_COUNT /
CREDIT_DISPLAY / DOWNLOAD_CONTROL = FAIL
```

## 3. Generation-control resolution

All Flow DOM behavior stayed centralized in `FlowPageAdapter`
(`flow-companion/extension/src/content/flow-page-adapter.js`) — no
selectors scattered into sidepanel / service-worker / bridge / provider
runtime (FP15 still PASS). Priority order implemented as specified:

```text
P0: GENERATION_TYPE → detectGenerationType() (aria-selected/pressed/checked
    on mode controls, then selected-tab scan; job metadata never trusted)
P0: MODE_IMAGE → existing selectMode() retained + verified discovery
P0: MODEL_CONTROL → normalizeModelLabel() (live label only)
P0: ASPECT_CONTROL → normalizeAspectLabel() (§8 fix)
P0: OUTPUT_COUNT → readOutputCount() (integer 1..8 or UNKNOWN) + widened
    aria fallbacks (results-per/count/radiogroup/listbox)
P0: GENERATE_BUTTON enabled-state → detectGenerateButton() unchanged,
    now drives assessGenerationReady()
P1: CREDIT_DISPLAY → normalizeCreditLabel()
P2: RESULT_MEDIA / DOWNLOAD_CONTROL → unchanged, deferred to the approved
    execution step
```

New read-only content command `GET_GENERATION_STATE`
(`content-commands.js`) reports readiness without inserting or clicking.
`INSERT_PROMPT_DRYRUN` now also snapshots generation state with honest
UNKNOWNs.

## 4. Model/aspect/output/cost observations

- **Aspect (§8 FIXED):** `normalizeAspectLabel()` accepts only explicit
  ratios (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`) or orientation keywords
  (`landscape`, `portrait`, `square`). Icon/ligature strings
  (`arrow_forward`, `expand_more`, `chevron_right`, `settings`, `tune`)
  are rejected → `null` (reported as `UNKNOWN`). The live
  `aspect=arrow_forward` observation can therefore never recur as a valid
  value. Nothing is fabricated from the job packet.
- **Model (§9):** `normalizeModelLabel()` returns the exact live label
  (≤80 chars) or `null`; icon text and bare `model` placeholders rejected.
  Approval packet shows `Model: UNKNOWN` when unresolved — automation is
  not blocked on model alone.
- **Output count (§10):** target `1`; `readOutputCount()` parses 1..8 from
  the live control, verifies nothing from click-only, returns UNKNOWN when
  the UI exposes no selector.
- **Cost:** `normalizeCreditLabel()`; exact visible value or UNKNOWN.
- **Generation type (§11):** `detectGenerationType()` reads LIVE state
  (`IMAGE` / `VIDEO` / `UNKNOWN` + verified flag); validation generation
  is IMAGE and live state must agree with job metadata.

## 5. GENERATION_READY evidence

`assessGenerationReady(root, { promptVerified, approvalState })` contract:

```text
REQUIRED: promptVerified=true · generationType=IMAGE ·
          Generate found=true · Generate enabled=true ·
          approvalState=AWAITING_USER_APPROVAL
OPTIONAL-BUT-REPORTED: modelLabel · aspect · outputCount ·
                       visibleCreditCost (UNKNOWN allowed, stays visible)
INVARIANTS: clickedGenerate=false · creditsConsumed=false · never clicks
```

Fixture evidence (`node test-flow-postv1c.js`, C5/C7):

```text
ready=true when all conditions met (optionals visibly UNKNOWN)
missing=GENERATE_STILL_DISABLED_AFTER_PROMPT when disabled
missing=APPROVAL_NOT_RECORDED when approval absent
GET_GENERATION_STATE + INSERT_PROMPT_DRYRUN: btn.clicked=0
```

## 6. Extension branding

No approved UNFOLDIQ logo exists in the repo (searched `*.png/*.svg`,
`brand/` holds only mascot briefs) → per task rule no brand logo was
invented. Created **clearly labeled provisional** icons
`flow-companion/extension/icons/icon{16,32,48,128}.png` (indigo tile +
white “U”) and recorded provisional status here and in
`flow-companion/README.md`. Manifest now declares `icons`,
`action.default_icon`, `action.default_title: UNFOLDIQ Flow Companion`,
`short_name: Flow Companion`, and the full store `description`.

## 7. Side-panel action behavior

`service-worker.js` calls
`chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
(guarded, browser-only) → toolbar-icon click opens the Side Panel.
`build.js` fails the build if this wiring is ever removed (regression
evidence), and test C8 asserts it statically.

## 8. Vietnamese localization

`src/ui/sidepanel.html` is now `<html lang="vi">` with the specified
mapping (URL Bridge (chỉ máy cục bộ), Mã truy cập Bridge, Mã dự án, Mã
công việc, Lưu cấu hình, Kiểm tra Flow, Lấy công việc, Kiểm tra giao
diện Flow, Thông tin phê duyệt, Duyệt & Tạo, Từ chối, Chạy thử không tốn
credit, Trạng thái hệ thống, Nhật ký). Technical enums
(READY/PASS/FAIL/DEGRADED/UNKNOWN/AWAITING_USER_APPROVAL) remain English
for debugging consistency. Test C9 asserts every mapped string.

## 9. UX structure

Cleaner card layout per §18: header (brand + connection badge) →
TRẠNG THÁI (Flow/Bridge/Current Job) → CÔNG VIỆC (job + approval packet
+ GENERATION_READY state) → HÀNH ĐỘNG (primary Duyệt & Tạo + secondary)
→ ẢNH THAM CHIẾU (optional) → NÂNG CAO as collapsed `<details>` (bridge
config, diagnostics, safe probe) → NHẬT KÝ collapsed by default.
Consistent spacing/cards/badges, one clear primary action, responsive
side-panel width, accessible labels. No decorative animation.

## 10. Toast/notifications

`toast(message, type)` system: SUCCESS / INFO / WARNING / ERROR,
auto-close ~4s (errors persist until dismissed), manual close button,
max-4 stacking, `aria-live="polite"`. Every meaningful action covered:
Lưu cấu hình → “Đã lưu cấu hình”; Kiểm tra Flow → connected/not-found;
Lấy công việc → “Đã tải công việc”; probe → “Đã cập nhật chẩn đoán giao
diện”; dry-run → “Đang chạy kiểm tra…” → “Dry-run thành công — không sử
dụng credit”; Duyệt & Tạo → “Đã phê duyệt — đang tạo nội dung”; Từ chối
→ “Đã từ chối công việc”; download/import toasts likewise.

## 11. Loading/double-click protection

All async buttons (Save/Check/Fetch/Probe/Dry-run/Approve/Reject/
Download/Import paths) run through `guard(btn, fn)`: `inFlight` set +
`loading` class + `disabled` while active, state restored on
completion/failure. `onApprove` adds a final idempotency layer — jobs not
in an approvable state are refused without dispatch. Duplicate approval
consumption throws (C10). Generation can never duplicate from double-click.

## 12. One-action workflow changes

Safe auto-bootstrap on panel open: restore persisted safe config (token
stays memory-only, never persisted) → auto-resolve Flow tab (read-only
ping) → auto-fetch current job + prepare packet when a token is present
in memory. Manual Advanced buttons retained for troubleshooting. Security/
approval checks untouched; Generate is never auto-clicked. Primary action
follows job state (CHƯA KẾT NỐI → ĐÃ KẾT NỐI/JOB → AWAITING_USER_APPROVAL
“Duyệt & Tạo” → GENERATING disabled/loading → READY “imported” note).

## 13. Reference image + description support

Optional “Ảnh tham chiếu” card: asset path + semantic role + identity
traits + continuity constraints + allowed variation (one-per-line).
`readReferenceFields()` returns `null` when unused (never forced);
otherwise `{ referenceAsset: { id, path }, referenceDescription:
{ semanticRole, identityTraits, continuityConstraints, allowedVariation } }`
surfaced in the approval packet text. Schema-side continuity fields
(`continuityContext`, `referenceAssets`, `ingredients`) already exist in
`schemas/flow-job.schema.json` and are unchanged.

## 14. Roadmap changes

New source of truth: `flow-companion/docs/POST-V1C_ROADMAP.md`
(README points to it):

```text
POST-v1B → QUALITY 01 (Voice+Caption, ngay sau POST-v1B) →
POST-V2 2–3 min publishable validation (thumbnail+metadata+music-rights,
real manual upload) → Render Performance → Creative Quality →
8–12+ min Full Production Validation
```

Essential polish done NOW in this task; any larger optional redesign must
not block QUALITY 01.

## 15. Thumbnail stage

Added `THUMBNAIL PLAN → GENERATION/SELECTION → QA` with
`schemas/thumbnail-package.schema.json` (16:9, ≥640×360, readable at
small size, accurate, policy-safe, title-consistent; no clickbait) and
`publish/` artifacts (`thumbnail.png`, `thumbnail-metadata.json`,
`thumbnail-qa.json`).

## 16. Music rights stage

Added `MUSIC_SOURCE_RESOLUTION` gate with
`schemas/music-source.schema.json` (trackId/title/artist/source/
sourceUrl/licenseType/commercialUseAllowed/platformRestrictions/
attributionRequired/attributionText/licenseEvidence/downloadedAt/sha256/
status `APPROVED|REVIEW_REQUIRED|BLOCKED|UNKNOWN`). `UNKNOWN` blocks
publish-ready. Preferred sources: YouTube Audio Library, original music,
licensed third-party libraries. Attribution auto-included in
description/publish package.

## 17. Short publishable-video milestone

Added `POST-V2_SHORT_PUBLISHABLE_VIDEO_VALIDATION` (before render
performance / creative / 8–12 min): one real 2–3 min complete publishable
educational video with research, script, improved narration+captions,
continuity, rights-resolved music, thumbnail, title, description,
rights/provenance checklist, AI-disclosure decision, final MP4; system
prepares the publish package (title.txt, description.txt, metadata.json,
thumbnail.png, music-attribution.txt, UPLOAD_CHECKLIST.md) → user
explicitly approves → user uploads/authorizes manually (PUBLIC or UNLISTED
explicitly chosen, never silent) → platform result reviewed. All 12 pass
criteria recorded in the roadmap doc.

## 18. Files modified

```text
flow-companion/extension/src/content/flow-page-adapter.js  (Task A core)
flow-companion/extension/src/content/content-commands.js    (GET_GENERATION_STATE)
flow-companion/extension/src/background/service-worker.js  (error codes + sidePanel behavior)
flow-companion/extension/manifest.json                     (0.3.0, icons, titles, description)
flow-companion/extension/package.json                      (0.3.0)
flow-companion/extension/build.js                          (icons + sidePanel regression gates)
flow-companion/extension/src/ui/sidepanel.html             (Vietnamese, new structure)
flow-companion/extension/src/ui/sidepanel.js               (toast, loading, auto-bootstrap, refs)
flow-companion/extension/icons/icon{16,32,48,128}.png      (NEW, provisional)
flow-companion/extension/.output/chrome-mv3/**             (rebuilt, 16 files incl. icons)
flow-companion/README.md                                   (provisional branding + roadmap pointer)
flow-companion/docs/POST-V1C_ROADMAP.md                    (NEW, roadmap realignment)
schemas/music-source.schema.json                           (NEW)
schemas/thumbnail-package.schema.json                     (NEW)
validate-schemas.js                                        (register 2 new schemas)
test-flow-postv1c.js                                       (NEW, §36 coverage)
Report/POST-V1C_GENERATION_READY_EXTENSION_POLISH_ROADMAP_REPORT.md (this file)
```

Tab resolver, bridge architecture, and dry-run readiness fix untouched.

## 19. Tests

```text
node test-flow-postv1c.js        → 97 assertions PASS, 0 fail (C1–C11)
node test-flow-postv1b.js        → 177 assertions PASS, 0 fail (dry-run intact)
node test-flow-page-adapter.js   → 20 assertions PASS (FP1–FP15, incl. FP15)
flow-companion/extension tests   → 6 PASS
node flow-companion-doctor.js    → exit 0, all OK (no <all_urls>, no cookies)
node build.js (extension)        → BUILD_OK, 16 files MV3 minimal permissions
node validate-schemas.js         → ALL TESTS PASSED (incl. 2 new schemas)
```

C1–C11 map to §36: generation-type/image-mode/aspect/model/output/
Generate-state (C1–C5), approval-packet honesty (C6), read-only probe +
zero-credit dry-run (C7), branding + side-panel behavior (C8),
Vietnamese/toast/loading/double-click (C9), approval safety incl.
duplicate-click (C10), music/thumbnail contracts (C11).

## 20. Security regression

No new permissions (`storage/downloads/sidePanel/scripting` only; exact
Flow hosts + loopback; no `<all_urls>`, no cookies/webRequest). Probe
allowlist unchanged (tagName/role/aria/title/type/disabled/short label
only — no account text, prompt content, media src, cookies, tokens).
Bridge stays `127.0.0.1` + token-gated. No private Flow API calls, no
token/password persistence (token memory-only), no remote executable
code, no CAPTCHA bypass. Doctor + M2/M4 + C9-cookie assertions PASS.

## 21. Remaining blockers

1. **Live GENERATION_READY verification** — fixture PASS only; the real
   `GENERATION_READY` (IMAGE + enabled Generate + exact model/aspect/cost
   labels) must be confirmed against the live authenticated Flow UI in
   the next session (read-only probe, zero credit).
2. **Live approval packet review** — prepare `FLOW-COMPANION-LIVE-GEN-01`
   packet from live state; user APPROVE/REJECT belongs to the next
   explicitly approved execution step (Generate → Result → Download →
   Import → QA → READY).
3. **Provisional icons** — replace with approved UNFOLDIQ brand assets
   when available.
4. No code blockers: P2 result/download controls intentionally deferred
   to the post-approval execution step per task priority.

## 22. Final conclusion

Live dry-run PASS remains intact; generation controls are resolved to an
honest `GENERATION_READY` evaluation (icon garbage can never pass as
aspect again); essential polish (branding, side-panel behavior,
Vietnamese UI, toasts, loading/double-click guards, auto-bootstrap,
reference support) is implemented and tested; roadmap now prioritizes
QUALITY 01, adds thumbnail + music-rights stages, and inserts the 2–3
min publishable-video milestone before render-performance/full-length
validation. No Generate click occurred; no credits consumed.

`POST-v1C GENERATION READY + ESSENTIAL POLISH + ROADMAP: PASS 100%`
