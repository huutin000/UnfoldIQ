# UNFOLDIQ MARKET GAP REGISTRY

**Created:** 2026-10-07 (Post-Phase-2 retroactive audit, spec §13–§15)
**Rule 12:** future prompts MUST read this registry before scope freeze.
**Rule 10:** every gap has an owner + severity + explicit decision.

Decision rule: `ADD_NOW` (P0/P1 or security/data-loss/rights/duplicate-spend risk or major downstream rework) · `MERGE_FUTURE_PACKAGE` · `POST_V1` · `REJECT`.

---

## GAP-001 — Trusted Device Pairing

- **Owner capability:** Flow Companion / Bridge auth (Track E)
- **Discovered:** 07/10/2026
- **Benchmark:** Chrome externally_connectable + origin allowlist; DPAPI-protected local secrets; device-identity + short-lived-session patterns (Premiere/Descript-class companion apps never expose token UX)
- **Current UNFOLDIQ (pre-fix):** normal user had to copy/paste a long-lived bridge bearer token; "remember token" = plaintext file
- **Gap:** user-managed secret UX; long-lived bearer persisted as plaintext
- **Severity:** P1 (security + UX)
- **Downstream impact:** blocks normal-user adoption of the Flow integration
- **Decision:** **ADD_NOW — FIXED in this package**
- **Target package:** POST-PHASE-2 (this)
- **Evidence:** `lib/device-pairing` (DeviceIdentity, DPAPI SecretStore, challenge/proof, RuntimeSession); bridge pairing routes; tests/pairing 18 tests PASS
- **Status:** FIXED

## GAP-002 — Runtime Browser/Profile Storage Lifecycle

- **Owner capability:** local runtime storage (Track E)
- **Discovered:** 07/10/2026 (measured: `pw-flow-profile` = 4.45 GB, of which 4.17 GB = Chrome `OptGuideOnDeviceModel` — pure disposable model cache; real auth data `Default` = 94 MB)
- **Benchmark:** browser profile lifecycle management; cache classification + retention budgets
- **Current UNFOLDIQ (pre-fix):** no lifecycle classification, no cleanup, unbounded growth of reproducible model caches mixed with durable auth state
- **Gap:** unbounded disposable growth; no measurement/cleanup tooling
- **Severity:** P2 (disk growth; not security)
- **Downstream impact:** user-visible disk pressure over long automation use
- **Decision:** **ADD_NOW — FIXED in this package** (policy + scan/dry-run/clean, path-guarded)
- **Target package:** POST-PHASE-2 (this)
- **Evidence:** `lib/runtime-storage` + CLIs; real cleanup reclaimed 4237.4 MB (4.45 GB → 111 MB) with auth data intact; tests/storage 5/5
- **Status:** FIXED

## GAP-003 — storageState vs Persistent Profile

- **Owner capability:** Playwright browser-session persistence (Track E, spec §11.3)
- **Discovered:** 07/10/2026
- **Benchmark:** Playwright `storageState` vs `launchPersistentContext`
- **Current UNFOLDIQ:** full persistent profile `pw-flow-profile` used for Flow automation
- **Gap:** cannot yet prove the full profile is required vs a minimal isolated `storageState`
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE** — experiment tooling shipped (`scripts/diagnostics/storage-state-experiment.js`); live run on 2026-10-07 returned **NOT_PROVEN: baseline itself not logged in** (Google session in `pw-flow-profile` expired — last live use 2026-10-05). Decision locked once the operator performs one fresh live Flow login and re-runs the script.
- **Status:** OPEN (blocked on live operator login, not on engineering)

## GAP-004 — Timeline Timebase / Frame Rounding

- **Owner capability:** Master Timeline (Phase 3A)
- **Discovered:** 07/10/2026
- **Severity:** P1 (architectural; causes expensive rework if deferred past 3A)
- **Decision:** **ADD_NOW — FIXED in Phase 3A** (2026-10-07): rational `FrameRate {numerator, denominator}` + versioned `TIMELINE_TIMEBASE_POLICIES` (web-30, web-2997 w/ drop-frame, film-24, pal-25, ntsc-23976) + centralized deterministic integer time↔frame conversion (`lib/timeline/timebase.js`); exact-boundary + round-trip + no-accumulating-drift proofs over 24/1, 25/1, 30/1, 24000/1001, 30000/1001 (`tests/timeline/test-timebase.js` 6/6).
- **Evidence:** Phase 3A report §4; canonical time unit remains proven integer-ms with derived frames.
- **Status:** FIXED

## GAP-005 — Media Conform / Color Management

- **Owner capability:** visual pipeline (Track B)
- **Severity:** P2
- **Decision:** **PARTIALLY_FIXED in Phase 3A** (2026-10-07): canonical `MediaConformMetadata` (dims/fps-rational/CFR-VFR/PAR/rotation/audio/color with per-field confidence DECLARED|DETECTED|ASSUMED|UNKNOWN), versioned `MediaConformPolicy` (DIRECT_USE/CONFORM_REQUIRED/REVIEW_REQUIRED/REJECT, VFR never silent-CFR), versioned `ColorManagementPolicy` (input/working/output distinct; unknown explicit). Remaining owner — **Phase 4B**: final encoded-output color verification, delivery compliance, actual transcoding execution.
- **Evidence:** `lib/timeline/media-conform.js`, `lib/timeline/color-policy.js`, tests in `tests/timeline/`.
- **Status:** PARTIALLY_FIXED / PLANNED_FOR_4B

## GAP-006 — Versioned Export Profiles

- **Owner capability:** render/export (Track B/C)
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 4B**
- **Status:** PLANNED

## GAP-007 — Proxy / Mezzanine Media

- **Severity:** P3
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 5C, only if profiling proves a bottleneck**
- **Status:** DEFERRED

## GAP-008 — Final Multimodal Watch Pass

- **Owner capability:** QA (Track B/C)
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE → Phase 6A**
- **Status:** PLANNED

## GAP-009 — Alignment Provider Real-Production Quality

- **Owner capability:** forced alignment (Track D)
- **Benchmark:** WhisperX/MFA-class acoustic-model aligners
- **Current UNFOLDIQ:** `local-energy-known-text` deterministic energy-based aligner (word boundaries are estimates inside continuous speech)
- **Severity:** P2
- **Decision:** **MERGE_FUTURE_PACKAGE** — trigger-registered: upgrade the provider ONLY if real Kokoro/long-form validation fails the alignment quality target (spec §13.4); the `AlignmentProvider` contract accepts a drop-in replacement with no contract change
- **Status:** DEFERRED (trigger registered)

## GAP-010 — Full interactive caption editor UI / NLE-style timeline UI

- **Benchmark:** Premiere Speech-to-Text panel, Descript editor
- **Severity:** P3
- **Decision:** **REJECT for V1** — UNFOLDIQ is a headless, agent-driven product; manual editor parity does not fit; revisit POST_V1 only if operator workflow proves a need
- **Status:** REJECTED

## GAP-011 — Chrome Native Messaging transport

- **Benchmark:** Chrome Native Messaging with `allowed_origins` per extension ID
- **Severity:** P3
- **Decision:** **REJECT for V1** — measured trade-off recorded in `docs/roadmap/FLOW_BRIDGE_TRANSPORT_DECISION.md` (KEEP_AND_HARDEN wins); revisit only if loopback ports get blocked by enterprise policy
- **Status:** REJECTED (with re-open condition)

---

**Counts:** 11 gaps — FIXED 2 · PLANNED 3 · DEFERRED 2 · REJECTED 2 · OPEN 1 (live-gated) · 1 merged into Phase 3A decision record (GAP-003 tooling shipped).
**Unresolved P0 = 0. Unresolved Phase-3-blocking P1 = 0.**
