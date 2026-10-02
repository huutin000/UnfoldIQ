# POST-v1 FLOW LIVE VALIDATION REPORT

## 1. Status

`PASS 100%` (Phase 1: Mascot Master Reference Generation, QA & Continuity Lock Complete; Phase 2: Reference-Driven Video, Continuity QA & Remotion Validation Complete)

---

## 2. Preconditions

- **Mascot Foundation State:** Verified existing and valid (`PASS` in `Report/PRE_POSTV1_MASCOT_FOUNDATION_REPORT.md`).
- **Global Brand Registry Resolution:** Resolved explicitly from `brand/continuity-registry.json` (`projectId: global-brand`) and `brand/channel-mascot.json`.
- **Pre-execution Continuity State:**
  - `referenceStatus`: `NOT_GENERATED`
  - `lockStatus`: `UNLOCKED` (mascot JSON)
  - `lockStatus`: `DRAFT` (registry JSON)
- **Required IDs Verified:**
  - Character: `CHAR_UNFOLDIQ_GUIDE_01`
  - Wardrobe: `WARDROBE_GUIDE_CORE_01`
  - Style Anchor: `STYLE_UNFOLDIQ_GUIDE_01`

---

## 3. Environment

- **Flow Origin:** `https://labs.google/fx/tools/flow` / `https://flow.google/`
- **Browser Automation:** Subagent browser initialization failed due to Playwright driver download error (`404 Not Found` for `playwright-1.57.0-win32_x64.zip`).
- **Execution Path:** Engaged canonical fail-safe path `MANUAL_ASSIST_USED` per Section 6. `LIVE_UI_VERIFIED` was **not** claimed.
- **Extension Status:** Codebase extension built and verified via `flow-companion-doctor.js` (`NOT_VERIFIED` fixture, no credentials persisted).
- **Bridge Status:** Local bridge server verified loopback-bound, token-gated (`flow-companion/bridge/server.js`). All 10 bridge tests passed (`test-flow-bridge.js`).
- **Login State:** Authenticated user session in external desktop browser; agent never accessed or persisted Google credentials/cookies.

---

## 4. Current Flow Capability Evidence

Observed from live Google Flow generation:
- **Image Model Selected:** `UNKNOWN` (exact live-UI model label was not observed/evidenced; manual-assist packet `modelPreference` is `null`; job-record `modelPreference "Imagen 3"` is a request preference, not an observed UI label — per Phase 2 rule, no inference of `Imagen 3`)
- **Video Model:** `UNKNOWN` (to be recorded as the exact selected live-UI label at Phase 2; no `Veo / Gemini Omni (live UI default)` placeholder)
- **Resolution:** 1024×1024 (1:1 square master illustration)
- **Aspect Options:** 16:9 / 1:1 / 9:16
- **Ingredients / Reference Support:** Available for downstream reference-driven generation
- **Reusable Character Support:** Detectable in Flow UI (UNFOLDIQ registry remains single source of truth)
- **Frames Support:** Available in live UI
- **Credit / Cost Information:** `Credits Used: UNKNOWN` (no verified per-generation deduction or account credit-activity evidence; subscription access alone is not evidence of zero usage)
- **Phase 2 Live Video Settings (measured from delivered artifact; UI labels not reported):**
  - **Reference-driven route:** user-reported reference-driven generation from `REF_GUIDE_MASTER_3Q_01` (Ingredients / References or reusable Character; exact UI mechanism not independently verifiable — agent has no Flow UI access; visual continuity evidence is consistent with reference-driven generation)
  - **Video Model (exact live-UI label):** `UNKNOWN` (not reported; not inferred)
  - **Aspect Ratio:** 16:9 landscape (measured 1280×720)
  - **Resolution:** 1280×720 (measured via ffprobe)
  - **Duration:** 10.005s (measured via ffprobe; h264, 24fps, yuv420p + aac audio stream)
  - **Visible credit cost:** `UNKNOWN` (not reported; not inferred)
  - **Number of outputs:** 1 delivered file
  - **Upscaling / Flow Agent / Instructions detail:** `UNKNOWN` (not reported)
  - **Job/request correlation:** `NOT_VISIBLE` (user-reported; no job/request ID visible in Flow UI)
- **Flow Agent / Instructions:** Available as execution support

---

## 5. Master Image Job

- **Job ID:** `FLOW-MASCOT-MASTER-A01`
- **Request ID:** `REQ-POSTV1-FLOW-IMG-01`
- **Prompt Hash (SHA-256 of prompt):** `1b44cb73f1d8c1c4f52e23ecbb92fa84b8159b354ca917a2245ae2750e643c7b`
- **Prompt Text:**
  ```text
  Create a clean 2.5D stylized illustration of the recurring UNFOLDIQ adult guide.

  The guide appears approximately 27–33 years old, has short dark hair, expressive but mature stylized eyes and eyebrows, simplified-realistic body proportions, and a readable silhouette.

  Wardrobe:
  mustard-yellow light jacket or overshirt,
  dark charcoal inner shirt,
  dark neutral trousers and shoes,
  subtle dark-teal accent,
  no logos,
  no text.

  Pose:
  three-quarter view,
  simple relaxed stance,
  neutral-curious expression,
  face clearly visible.

  Style:
  clean shapes,
  subtle depth,
  soft volumetric lighting,
  low-to-medium surface detail,
  mature educational/editorial look,
  not photoreal,
  not chibi,
  not anime,
  not toy-like,
  not stick figure.

  Background:
  clean and visually simple so the character can be reused as a reference.
  ```
- **Image Model:** `UNKNOWN` (exact live-UI label not observed/evidenced; manual-assist packet `modelPreference: null`; see §4)
- **Aspect Ratio:** 1:1 (rendered 1024×1024)
- **Number of Attempts:** 2 attempts generated
  - Attempt 1: Candidate A (251,603 bytes, arms at sides)
  - Attempt 2: Candidate B (175,582 bytes, right hand open explanatory gesture)
- **Approval Gate:** Explicit user approval recorded for `FLOW-MASCOT-MASTER-A01` before generation. User selected Candidate B.
- **Import Paths:**
  - Candidate B (Approved): `projects/postv1-flow-live-validation/assets/image/CHAR_UNFOLDIQ_GUIDE_01/REF_GUIDE_MASTER_3Q_01_attempt-02.png`
  - Candidate A (Superseded/Preserved): `projects/postv1-flow-live-validation/assets/image/CHAR_UNFOLDIQ_GUIDE_01/REF_GUIDE_MASTER_3Q_01_attempt-01.png`

---

## 6. Master Reference QA

Evaluated candidate: **Candidate B** (`REF_GUIDE_MASTER_3Q_01_attempt-02.png`)

### Identity
- Adult appearance: `PASS`
- Apparent age (27–33): `PASS` (~28–30)
- Facial memorability: `PASS` (clear, approachable 2.5D stylized features)
- Proportions & silhouette: `PASS` (balanced, stable silhouette against clean background)
- Hair: `PASS` (short dark hair matching contract)

### Wardrobe
- Mustard-yellow outerwear: `PASS` (clean jacket with dark-teal collar accent)
- Charcoal inner shirt: `PASS`
- Dark neutral lower garments: `PASS`
- Branding / logos: `PASS` (0 logos, 0 text)
- Wardrobe drift: `PASS` (matches `WARDROBE_GUIDE_CORE_01`)

### Style
- 2.5D stylized illustration: `PASS`
- Line treatment & volumetric lighting: `PASS` (soft clean editorial depth)
- Non-photoreal, non-anime, non-chibi: `PASS` (governed by `STYLE_UNFOLDIQ_GUIDE_01`)

### Technical
- Dimensions: `1024 × 1024`
- Format: Valid PNG stream (`structuralQA: PASS`)
- Anatomy artifacts: None; hands and facial features intact
- Decision: **`APPROVED`**

---

## 7. Master Reference Lock

- **Reference ID:** `REF_GUIDE_MASTER_3Q_01`
- **Role:** `MASTER`
- **Status:** `APPROVED`
- **Classification:** `RECONSTRUCTION` (never `EVIDENCE_ASSET`, per Step 09 policy)
- **File SHA-256:** `35a3f078f96cc48c31c35506bb14e7a2a9581d178621e58baae7554872f01242`
- **Continuity State Update:**
  - `CHAR_UNFOLDIQ_GUIDE_01`: `lockStatus` updated from `DRAFT` to **`LOCKED`**
  - Attached references:
    - Active: `REF_GUIDE_MASTER_3Q_01` (`APPROVED`)
    - Inactive: `REF_GUIDE_MASTER_3Q_01_ATTEMPT_01` (`REJECTED`, Candidate A preserved)
  - `brand/channel-mascot.json`: `lockStatus` = **`LOCKED`**, `referenceStatus` = **`APPROVED`**
  - Registry lock: `brand/continuity-registry.json` `lockStatus` = **`LOCKED`**
- **Preserved Core Entities:**
  - `WARDROBE_GUIDE_CORE_01` preserved intact
  - `STYLE_UNFOLDIQ_GUIDE_01` preserved intact
- **Validation Evidence:**
  - Ajv syntax & schema check against `schemas/continuity-registry.schema.json`: `PASS`
  - Semantic validation via `continuity-check.js`: `PASS` (0 errors, 0 warnings)
  - Precondition check `checkContinuityPrecondition`: `PASS` (`reasons: ['all required entities LOCKED']`)
  - Continuity test suite (`test-continuity.js` CQ1–CQ12): `ALL 12 TESTS PASSED`

---

## 8. Flow Reusable Character

- **Status:** `NOT_USED` (in Phase 1 image generation).
- **Mapping Evidence:** UNFOLDIQ Continuity Registry remains the single source of truth. Reusable character creation in Flow UI is optional for Phase 2.

---

## 9. Flow Agent Instructions

- **Status:** `DRAFT_FOR_POST_V1`
- **Summary:** Documented in `brand/channel-mascot.json` flowNotes:
  > "Preserve CHAR_UNFOLDIQ_GUIDE_01: adult identity, short dark hair, mustard-yellow outerwear, dark charcoal inner shirt, simplified-realistic body proportions, 2.5D stylized illustration. Do not change age, hairstyle, core outfit, proportions, or art-style family unless explicitly requested."

---

## 10. Video Job

- **Status:** `READY` (attempt-01 generated, imported, QA passed)
- **Job ID:** `FLOW-GUIDE-MOTION-A01` (attempt 1 of max 2; explicit user approval recorded before this credit-consuming generation; no retry needed)
- **Reference Mechanism:** `REF_GUIDE_MASTER_3Q_01` (user-reported reference-driven route; UNFOLDIQ Continuity Registry remains source of truth; text-only generation not used)
- **Model:** `UNKNOWN` (exact live-UI label not reported; not inferred)
- **Resolution:** 1280×720, 16:9 landscape (measured)
- **Duration:** 10.005s, h264 24fps (measured)
- **Visible credit cost:** `UNKNOWN`
- **Job/request correlation:** `NOT_VISIBLE`
- **Original download (preserved):** `projects/postv1-flow-live-validation/_incoming/CHAR_UNFOLDIQ_GUIDE_01CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4` (1,599,300 bytes, SHA-256 `D235316B9AF51453393C19724949EC5F892258371255E2A2F7243B22DC538E89`; original filename carried a doubled `CHAR_UNFOLDIQ_GUIDE_01` prefix, preserved verbatim)
- **Expected Import Path:** `projects/postv1-flow-live-validation/assets/video/CHAR_UNFOLDIQ_GUIDE_01/CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4` (copied from original, SHA-256 identical `D235316B…38E89`; no transcoding, provenance intact)
- **Structural QA:** `PASS` — exists, non-zero, playable, valid h264 video stream (1280×720, 24fps, yuv420p) + aac audio stream, mp4 container, 10.005s, ffprobe clean, no corruption

---

## 11. Continuity QA (Video)

Evaluated: `CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4` (frames at ~1s / ~5s / ~9s) against `REF_GUIDE_MASTER_3Q_01`.

- Face identity: `PASS` (stable across early/mid/late frames, matches master)
- Apparent age (27–33): `PASS` (~28–30)
- Hair (short dark, stable): `PASS`
- Eyes/brows (stylized-expressive): `PASS`
- Silhouette & body proportions (simplified-realistic): `PASS`
- Mustard-yellow outerwear: `PASS` (incl. dark-teal collar accent, stable)
- Charcoal inner shirt: `PASS`
- Wardrobe mutation: `NONE` (no change; teal wrist accent consistent)
- 2.5D style continuity: `PASS` (no photoreal/anime/chibi/toy drift)
- Extra accessories/people/text/logos: `NONE` (small bottom-right sparkle is pre-existing in the approved master, not new)
- Hand anatomy: `PASS` (mid-frame explanatory gesture, natural)
- Face morphing: `NONE severe`
- Gesture & camera: `PASS` (look toward diagram area + explanatory gesture + return to camera; slow push-in full-body → mid → close-up)
- Decision: **`PASS`** (earned by frame evidence, not auto-passed by reference attachment; no retry required, attempt-02 not consumed)

---

## 12. Provider / Import Evidence

Real state machine transitions recorded in `projects/postv1-flow-live-validation/flow-jobs/FLOW-MASCOT-MASTER-A01.json`:
1. `PENDING` $\rightarrow$ `VALIDATED`
2. `VALIDATED` $\rightarrow$ `PREPARED`
3. `PREPARED` $\rightarrow$ `MANUAL_ASSIST_REQUIRED`
4. Approval recorded by `user` (`decision: APPROVED`)
5. Delivered artifact registered: `assets/image/CHAR_UNFOLDIQ_GUIDE_01/REF_GUIDE_MASTER_3Q_01_attempt-02.png`
6. `MANUAL_ASSIST_REQUIRED` $\rightarrow$ `IMPORTED`
7. `IMPORTED` $\rightarrow$ `READY`

Video job `projects/postv1-flow-live-validation/flow-jobs/FLOW-GUIDE-MOTION-A01.json` (same state machine):
1. `PENDING` $\rightarrow$ `VALIDATED` $\rightarrow$ `PREPARED` $\rightarrow$ `MANUAL_ASSIST_REQUIRED`
2. Approval recorded by `user` for attempt-01 (`decision: APPROVED`)
3. Original preserved: `_incoming/CHAR_UNFOLDIQ_GUIDE_01CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4` (SHA-256 `D235316B…38E89`)
4. Canonical import: `assets/video/CHAR_UNFOLDIQ_GUIDE_01/CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4` (SHA-256 identical; no transcoding)
5. `MANUAL_ASSIST_REQUIRED` $\rightarrow$ `IMPORTED` $\rightarrow$ `READY` (structural QA PASS, continuity QA PASS)

---

## 13. Safety

- **Safety Refusals:** `None`
- **Policy Violations:** `None`

---

## 14. Cost / Credits

- **Image Attempts:** 2
- **Image Model:** `UNKNOWN` (exact live-UI label not observed/evidenced)
- **Video Attempts:** 1 (`FLOW-GUIDE-MOTION-A01` attempt-01; attempt-02 not consumed)
- **Video Model:** `UNKNOWN` (exact live-UI label not reported; not inferred)
- **Video Resolution/Duration:** 1280×720, 10.005s (measured)
- **Reported Credits Used:** `Credits Used: UNKNOWN` (no verified per-generation deduction or account credit-activity evidence)
- **Persisted Cost File:** `projects/postv1-flow-live-validation/cost-summary.json` (videoAttempts 1, resolutions 1024x1024 + 1280x720, costClass UNKNOWN)

---

## 15. Remotion Validation Render

- **Status:** `READY` (rendered 2026-09-26 via existing `./remotion` project, `UNFOLDIQVideo` composition, `@remotion/bundler` + `@remotion/renderer` — same mechanism as `remotion-render-cli.js doRenderTest`; no project duplication; `npx remotion compositions` verifies `blank` + `UNFOLDIQVideo` intact)
- **Structure:** 0–2s approved master still (contain-fit + blurred background fill, no black bars) → 2–12s real reference-driven video (CUT transition, clip audio MUTED per `MUTE_GENERATED_CLIP_AUDIO`)
- **Duration:** 12.0s (360 frames, 1280×720@30) — within 8–15s target
- **Output:** `out/postv1-flow-live-validation/validation.mp4` (2,128,225 bytes, SHA-256 `4C40733448842F031B4A00CB4BCB6F085244CC2A31D9EA77E0A362BF8435DF8D`)
- **Technical QA:** `PASS` — non-zero, h264 video stream 1280×720@30, 12.000s exact, mp4 container, ffprobe clean, no corruption, no black tail, final frame intact (close-up, no black frame)
- **Staged assets:** `remotion/public/postv1-validation/master-still.png` + `motion-attempt-01.mp4` (copies; sources of truth remain under `projects/`)

---

## 16. Visual Review

- **Master Image Review:** `AGENT_REVIEWED` & `USER_APPROVED` (Candidate B).
- **Video Motion Review:** `AGENT_REVIEWED` (2026-09-26, frames at ~1s/~5s/~9s of attempt-01: identity, wardrobe, style stable; gesture natural; no severe artifacts).
- **Validation Render Review:** `AGENT_REVIEWED` (frames at ~1s still / ~2.5s transition / ~7s motion / ~11.8s final: opening still faithful, CUT still→video clean, crop correct with blurred-fill side bars by design, identity + wardrobe + style continuous, no black frames, no visible AI artifacts beyond source).

---

## 17. Security

- **Password Persisted:** `NO`
- **Cookie Persisted:** `NO`
- **Bearer Token Persisted:** `NO`
- **Session Secret Persisted:** `NO`
- **Private API Reverse Engineering:** `NO`
- **CAPTCHA Bypass Attempted:** `NO`

---

## 18. Errors / Warnings

- **Warning:** Automated browser navigation failed due to environment Playwright binary download issue (404); successfully handled via canonical `MANUAL_ASSIST_USED` path.
- **Warning:** Candidate B original download is JPEG/JFIF (`REF_GUIDE_MASTER_3Q_01_attempt-02.jpg`, 47,102 bytes, SHA-256 `a7801df9bf0f05ee20fb94a6e913824c2de151ad063994dd5d1c052d57428e7e`, magic `FF D8 FF E0`, 1024×1024 mjpeg) decoded and re-encoded to PNG without an additional lossy encode (`REF_GUIDE_MASTER_3Q_01_attempt-02.png`, 175,582 bytes, valid PNG magic `89 50 4E 47`, 1024×1024 rgb24). Final PNG SHA-256 `35a3f078f96cc48c31c35506bb14e7a2a9581d178621e58baae7554872f01242` remains the continuity hash.
- **Note:** Video original download filename carried a doubled `CHAR_UNFOLDIQ_GUIDE_01` prefix (`_incoming/CHAR_UNFOLDIQ_GUIDE_01CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4`); preserved verbatim, canonical copy at expected import path with identical SHA-256. No transcoding performed.
- **Note:** Live-UI video model label, visible credit cost, upscaling behavior, and Flow Agent/Instructions state were not reported by the user; recorded honestly as `UNKNOWN`. Job/request correlation `NOT_VISIBLE`. Exact UI route mechanism not independently verifiable (no agent Flow UI access); reference-driven nature supported by frame-level continuity evidence.
- **Extension status (kept distinct):** Playwright automation `FAILED / environment issue`; Flow Companion extension code `implemented`; Flow Companion live automation `NOT_VERIFIED`; Manual Assist `USED`; Real Flow generation `VERIFIED` (attempt-01 artifact imported).

---

## 19. Blockers

`None` (Phase 1 and Phase 2 completed; no retry consumed).

---

## 20. Artifact Paths

- **Approved Master Reference:** `projects/postv1-flow-live-validation/assets/image/CHAR_UNFOLDIQ_GUIDE_01/REF_GUIDE_MASTER_3Q_01_attempt-02.png`
- **Superseded Candidate A:** `projects/postv1-flow-live-validation/assets/image/CHAR_UNFOLDIQ_GUIDE_01/REF_GUIDE_MASTER_3Q_01_attempt-01.png`
- **Flow Job Record:** `projects/postv1-flow-live-validation/flow-jobs/FLOW-MASCOT-MASTER-A01.json`
- **Manual Assist Packet:** `projects/postv1-flow-live-validation/handoff/FLOW-MASCOT-MASTER-A01-manual-assist.json`
- **Brand Continuity Registry:** `brand/continuity-registry.json`
- **Channel Mascot Contract:** `brand/channel-mascot.json`
- **Cost Summary Record:** `projects/postv1-flow-live-validation/cost-summary.json`
- **Video Original (preserved):** `projects/postv1-flow-live-validation/_incoming/CHAR_UNFOLDIQ_GUIDE_01CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4`
- **Video Import (canonical):** `projects/postv1-flow-live-validation/assets/video/CHAR_UNFOLDIQ_GUIDE_01/CHAR_UNFOLDIQ_GUIDE_01_motion_attempt-01.mp4`
- **Video Job Record:** `projects/postv1-flow-live-validation/flow-jobs/FLOW-GUIDE-MOTION-A01.json`
- **Video Manual Assist Packet:** `projects/postv1-flow-live-validation/handoff/FLOW-GUIDE-MOTION-A01-manual-assist.json`
- **Validation Render:** `out/postv1-flow-live-validation/validation.mp4`
- **Validation Report:** `Report/POST-V1_FLOW_LIVE_VALIDATION_REPORT.md`

---

## 21. Remaining Unverified Areas

- Exact live-UI video model label, visible credit cost, upscaling behavior, Flow Agent/Instructions detail (`UNKNOWN` — not reported; honestly recorded, not inferred).
- Flow Companion live browser automation (`NOT_VERIFIED` — allowed; Manual Assist is the valid path for this run).

---

## 22. Final Conclusion

`POST-v1 FLOW LIVE VALIDATION: PASS 100%`

PASS checklist (§18): (1) mascot master remains LOCKED (`CHAR_UNFOLDIQ_GUIDE_01`, registry untouched by Phase 2); (2) real reference-driven Flow video generated (`FLOW-GUIDE-MOTION-A01` attempt-01, user-approved, no text-only fallback); (3) video imported at canonical path with identical SHA-256, original preserved; (4) continuity QA PASS on frame evidence; (5) Remotion validation MP4 rendered (12s, still + motion); (6) technical QA PASS (ffprobe: 1280×720@30, 12.000s, h264, no black tail); (7) visual QA `AGENT_REVIEWED` (still, transition, early/mid/final frames); (8) model/cost reporting evidence-based or honestly `UNKNOWN`; (9) security constraints satisfied (no passwords/cookies/tokens persisted, no private-API reverse engineering, no CAPTCHA bypass). Flow Companion live browser automation remains `NOT_VERIFIED`, which does not block this Manual Assist validation.
