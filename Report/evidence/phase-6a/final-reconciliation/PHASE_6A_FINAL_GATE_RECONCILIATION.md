# PHASE 6A — FINAL GATE RECONCILIATION

Date: 2026-10-10. Project: `pilot-sky-blue-canonical`. External cost: 0 VND. New Gemini/Flow/Veo/TTS/render/incremental calls: 0.

## Full regression, current snapshot

| Field | Value |
|---|---|
| Command | `node scripts/run-tests.js` (single run, started by the owner before this pass; reused, not re-run) |
| Revision | HEAD `5dec82a42e07aaf928343809b9f5bb10abc2f3b6`, branch `main`; no staged changes; no source/config dirty vs HEAD (all 5 feature source files committed and unchanged) |
| Window | 2026-10-10 10:49:00 → 11:06:50 (+07:00), runner-reported 1070.4 s |
| Result | **195 suites PASS, 4 FAIL** (`4 failed suite(s)`). Process exit code was not captured (process finished while detached); the runner summary reports failures, so exit is treated as non-zero |
| Failed suites | `research/test-auth-extract.js`, `research/test-browser-extract.js`, `research/test-crawl4ai-bridge.js`, `research/test-robots-ratelimit.js` |
| Class | ENVIRONMENT. Log prints "Looks like Playwright was just installed or updated… run `npx playwright install`". Node Playwright 1.63.0 expects `…/node_modules/playwright-core/.local-browsers/chromium-1247/chrome-win64/chrome.exe` (does not exist); the research Python `.venv` expects `…/.venv/Lib/site-packages/playwright/driver/package/.local-browsers/chromium-1243` (not installed). Browser-acquisition assertions then fail (`EXTRACTION_FAILED`, `undefined` results). No product-code diff is involved |
| Not verified | I did not run the 4 suites individually, and did not install browsers (a download/environment change; needs owner OK) |
| Log / snapshot | `final-reconciliation/full-regression-current.log` (copy), `Report/evidence/phase-6a/full-regression-6a-canonical-final.log` (original), `final-reconciliation/regression-snapshot.json` (HEAD, log sha256, source file hashes, generated-patch hash) |
| Verdict | `FULL_REGRESSION_CURRENT_SNAPSHOT = FAIL` (4 environment failures; all other 195 suites PASS, including creative, incremental, remotion, packaging, render, golden) |

The old claim "full regression PASS on 4a57790" is therefore NOT upgradable to current-snapshot PASS. Per §5.8 I did not start a second full run. A final rerun needs owner approval after the browsers are installed.

## Verdict block

```text
CANONICAL_PILOT                        = READY
CANONICAL_PILOT_LINEAGE                = PARTIAL   (Gemini artifacts reference final.mp4 by name+size 18954217, no sha256)
OWNER_APPROVAL                         = PROVEN    (explicit chat approval of attempt-006 sha 7954a86a + variant; not a signed human watch)
FINAL_VIDEO_SHA256_MATCH               = PASS      (final.mp4 = attempt-006/output.mp4 = final-artifact = package = approval = 4B QC)
REPRESENTATIVE_PILOT_SCOPE             = REVIEW_REQUIRED (57.152 s; no owner scope exception for 2–3 min found)

FINAL_MULTIMODAL_WATCH                 = PASS_WITH_LIMITATIONS (model opinion; no hash in artifact; timestamps unreliable)
CAPTION_FRAME_BOUNDARY_QA              = PASS      (deterministic frames 146/147/148 + RC9/RC10 per gate JSON; not re-extracted this pass)
FLASH_QA_CANONICAL                     = PASS      (deterministic, 1713 frames, 0 large transitions; not a photosensitivity certification)
AUDIO_VISUAL_QA_CANONICAL              = REVIEW_REQUIRED (model opinion only)
REAL_INCREMENTAL_CREATIVE_REPAIR       = PROVEN    (fixture; pilot-repair-a/b, reuse-5c, incremental-render PASS in the current run)

PACKAGING_CLAIM_FIDELITY               = REVIEW_REQUIRED (title OK; description wrongly says Microsoft SAPI, actual Kokoro-82M)
PACKAGING_OPEN_ITEMS                   = 3 listed (+5 stale/inconsistent findings; 2 need owner decision)
PACKAGING_QA                           = REVIEW_REQUIRED (no UNRESOLVED_BLOCKING; status not forced to PASS)

FULL_REGRESSION_CURRENT_SNAPSHOT       = FAIL (4 ENVIRONMENT failures, 195 PASS)
HYGIENE                                = PASS      (last recorded check:workspace + check:repo-structure; not re-run, no source change)
GIT_STATUS                             = EXPECTED_DIRTY (tracked tree clean after exact-path restore; untracked canonical artifacts/evidence remain)
P0                                     = 0 confirmed product defects (open: environment fail + description claim error as gate blockers)
P1_CRITICAL                            = 0
EXTERNAL_PAID_COST_VND                 = 0

PHASE_6A_ENGINEERING_GATE              = FAIL      (current-snapshot full regression not green)
PHASE_6A_PRODUCT_ACCEPTANCE            = REVIEW_REQUIRED
PHASE_6A                               = NOT_COMPLETE
PHASE_6B_READY                         = NO
```

Note: the earlier gate JSON says `PHASE_6A = CLOSED_BY_OWNER_DECISION`. That is an owner closure, which this reconciliation does not override; but by the blocking rules in the reconciliation checklist (§6) the evidence gate is not met, so I do not mark `COMPLETE` and `PHASE_6B_READY = YES`.

## Missing Evidence -> Action -> Path -> Result

| Missing evidence | Action | Path | Result |
|---|---|---|---|
| Full regression current snapshot | reused the running run, read log | `full-regression-current.log`, `regression-snapshot.json` | FAIL (4 env) |
| Package open items list | read package + referenced files | `packaging-qa-reconciliation.md` | DONE (8 findings: 5 resolved, 1 accepted, 2 owner) |
| Claim fidelity | script/scene mapping | `packaging-qa-reconciliation.md` §2 | title PASS, description FAIL (SAPI) |
| Same-hash lineage | recomputed SHA256 | `canonical-lineage-audit.md` | PASS; watch link PARTIAL |
| Git tree audit + cleanup | exact-path restore of 30 test-generated files | `git-working-tree-audit.md`, `regression-generated-tracked-changes.patch` | EXPECTED_DIRTY |
| Flash / AV on canonical | read 4B QC | `phase4b-final-qc.json` | flash PASS, AV REVIEW_REQUIRED |
| Human full-watch signature | none, not forged | n/a | PENDING_OWNER_CONFIRMATION |

## Decisions still needed from the owner (nothing decided on their behalf)

1. Allow `npx playwright install chromium` (Node) and `research\.venv\Scripts\python.exe -m playwright install chromium` (downloads browser binaries), then approve **one** final full-regression rerun.
2. Description fix: replace "Microsoft SAPI" with "Kokoro-82M (local)" and re-approve the packaging variant (video bytes unchanged, no render). Alternatively accept the discrepancy explicitly.
3. Is 57.152 s accepted as `ACCEPTED_REPRESENTATIVE_PILOT` for Phase 6A?
4. Does the Phase 6A gate require a signed human full-watch, or is model watch + owner approval enough?
5. Null `category` / `licenseDistribution` / `playlistIntent` in metadata acceptable for a private, unpublished pilot?

Next after these are resolved: refresh the stale packaging QA files via the canonical service, rerun the one full regression, update this file. Phase 6B was not started.

---

# UPDATE (2026-10-10, after owner decisions 1–5) — supersedes the verdict block above

Owner decisions are recorded in `projects/pilot-sky-blue-canonical/approval/owner-decisions-6a-reconciliation.json`.

## Actions
- Packaging: "Microsoft SAPI" -> "Kokoro-82M, local" in `description.md`, `metadata.json` description and `policy-refresh.json` rightsNotes (3 files, +3/-3 lines). Title, thumbnail and video bytes unchanged; no render.
- Environment: `npx playwright install chromium` (Node) and `research\.venv ... -m playwright install chromium`. The 4 research suites then PASS when run alone (13 / 16 / 25 / 15 assertions, exit 0).
- One final full regression (`node scripts/run-tests.js`) on HEAD `5dec82a` + the 3 packaging edits: 11:45 end, runner 1146.3 s, **194 suites PASS, 1 FAIL**. Process exit code not captured; treated as non-zero.
- The failing suite is `dag/test-dag.js`: `PERF baseline: smallDirty p50 45.337ms < 25ms` (the test's own retry measured 20.9 ms). Run alone 3 times: exit 0, 156 passed / 0 failed, smallDirty p50 ~15 ms. Class: perf-threshold flake under full-suite load, not a product defect. Per the project rule, flaky is reported as FLAKY/FAIL, not PASS. I did not loosen the threshold and did not start a second full run.
- Cleanup: the 30 test-generated tracked files were restored by exact path (patch: `regression-final-run-generated-changes.patch`). Intentionally modified and left dirty: the 3 packaging files and `phase-6a-completion-gate.json`.
- Evidence: `full-regression-final-run.log` (+ `.err.log`), `full-regression-current.log` (copy), `regression-snapshot.json` (`finalRun`).

## Verdict block (current)

```text
CANONICAL_PILOT                        = READY
CANONICAL_PILOT_LINEAGE                = PARTIAL   (Gemini artifacts lack sha256; owner accepted model watch + approval as sufficient, hash gap remains documented)
OWNER_APPROVAL                         = PROVEN
FINAL_VIDEO_SHA256_MATCH               = PASS
REPRESENTATIVE_PILOT_SCOPE             = ACCEPTED  (ACCEPTED_REPRESENTATIVE_PILOT; does not prove the 2-3 min Phase 4 requirement)

FINAL_MULTIMODAL_WATCH                 = PASS_WITH_LIMITATIONS
CAPTION_FRAME_BOUNDARY_QA              = PASS
FLASH_QA_CANONICAL                     = PASS
AUDIO_VISUAL_QA_CANONICAL              = REVIEW_REQUIRED (model opinion only)
REAL_INCREMENTAL_CREATIVE_REPAIR       = PROVEN (fixture)

PACKAGING_CLAIM_FIDELITY               = PASS      (title mapped to B6/S05; SAPI error fixed) — variant re-confirmation PENDING_OWNER_CONFIRMATION
PACKAGING_OPEN_ITEMS                   = 3 listed (+5 stale findings; no UNRESOLVED_BLOCKING)
PACKAGING_QA                           = REVIEW_REQUIRED (stale packaging-qa.json / platform-compliance.json not regenerated; metadata nulls accepted by owner)

FULL_REGRESSION_CURRENT_SNAPSHOT       = FAIL      (194 PASS / 1 FAIL: dag perf flake; isolated 3/3 PASS)
HYGIENE                                = PASS      (last recorded; not re-run)
GIT_STATUS                             = EXPECTED_DIRTY
P0                                     = 0
P1_CRITICAL                            = 0
EXTERNAL_PAID_COST_VND                 = 0

PHASE_6A_ENGINEERING_GATE              = FAIL      (current-snapshot full regression not green)
PHASE_6A_PRODUCT_ACCEPTANCE            = REVIEW_REQUIRED (variant re-confirmation pending)
PHASE_6A                               = NOT_COMPLETE
PHASE_6B_READY                         = NO
```

## Remaining, owner-only
1. Confirm packaging variant `pkv-202fd90e1b72` after the description wording change.
2. Regression: either accept `dag/test-dag.js` as a documented load-sensitive perf flake (isolated 3/3 PASS) — which I will record as `FLAKY`, not `PASS` — or approve one more full rerun. The 194/195 other suites are green.

---

# UPDATE 2 (2026-10-10 12:16) — final regression rerun, owner chose option B

- Rerun: 
ode scripts/run-tests.js on HEAD `caf23cc` (owner had committed the packaging wording fix as `caf23cc`; tracked tree clean at start). Result: **195 suites PASS, 0 failed, 1008.4 s**; stderr empty. `dag/test-dag.js` passed. Process exit code not captured; the runner summary says `0 failed suite(s)`.
- Evidence: `full-regression-final-run2.log` (copied to `full-regression-current.log`), `regression-snapshot.json` (`finalRun2`), `regression-final-run2-generated-changes.patch` (30 test-generated files restored by exact path).
- Hygiene re-run: `check:workspace` ok (21 projects), `check:repo-structure` ok. Tracked tree clean; untracked canonical artifacts remain => `EXPECTED_DIRTY`.
- Note: commit `9029070` message says "record passing full regression"; the first two runs in this pass were not green, so the passing evidence is this rerun.

## Verdict block (current)

```text
FULL_REGRESSION_CURRENT_SNAPSHOT       = PASS
HYGIENE                                = PASS
GIT_STATUS                             = EXPECTED_DIRTY
P0 / P1_CRITICAL                       = 0 / 0
EXTERNAL_PAID_COST_VND                 = 0
PACKAGING_CLAIM_FIDELITY               = PASS
PACKAGING_QA                           = REVIEW_REQUIRED (stale QA json not regenerated; variant re-confirmation pending)
PHASE_6A_ENGINEERING_GATE              = PASS
PHASE_6A_PRODUCT_ACCEPTANCE            = REVIEW_REQUIRED (owner re-confirmation of variant pkv-202fd90e1b72 after description wording change)
PHASE_6A                               = NOT_COMPLETE
PHASE_6B_READY                         = NO
```

Only remaining blocker: the owner's explicit re-confirmation of the packaging variant. On that confirmation: `PHASE_6A = COMPLETE`, `PHASE_6B_READY = YES` (other fields as in the previous update; lineage `PARTIAL` and AV `REVIEW_REQUIRED` are documented limitations the owner accepted).

---

# FINAL (2026-10-10) — owner confirmed variant pkv-202fd90e1b72

Owner message: "xác nhận variant pkv-202fd90e1b72". Recorded in `projects/pilot-sky-blue-canonical/approval/owner-decisions-6a-reconciliation.json` (`packagingReapproval.status = CONFIRMED_BY_OWNER`, description sha256 `3d75085f…26cd6`, HEAD `caf23cc`). `owner-approval.json` was not modified. Upload/publish remain NOT covered.

```text
CANONICAL_PILOT                        = READY
CANONICAL_PILOT_LINEAGE                = PARTIAL   (documented limitation: Gemini artifacts lack sha256)
OWNER_APPROVAL                         = PROVEN
FINAL_VIDEO_SHA256_MATCH               = PASS
REPRESENTATIVE_PILOT_SCOPE             = ACCEPTED
FINAL_MULTIMODAL_WATCH                 = PASS_WITH_LIMITATIONS
CAPTION_FRAME_BOUNDARY_QA              = PASS
FLASH_QA_CANONICAL                     = PASS
AUDIO_VISUAL_QA_CANONICAL              = REVIEW_REQUIRED (documented limitation: model opinion only; owner accepted)
REAL_INCREMENTAL_CREATIVE_REPAIR       = PROVEN (fixture)
PACKAGING_CLAIM_FIDELITY               = PASS
PACKAGING_OPEN_ITEMS                   = 3 listed, 0 unresolved blocking
PACKAGING_QA                           = ACCEPTED_NON_BLOCKING (mapped to REVIEW_REQUIRED in the persisted schema; stale QA json not regenerated)
FULL_REGRESSION_CURRENT_SNAPSHOT       = PASS (HEAD caf23cc, 195/0, 1008.4 s)
HYGIENE                                = PASS
GIT_STATUS                             = EXPECTED_DIRTY
P0 / P1_CRITICAL                       = 0 / 0
EXTERNAL_PAID_COST_VND                 = 0
PHASE_6A_ENGINEERING_GATE              = PASS
PHASE_6A_PRODUCT_ACCEPTANCE            = PASS
PHASE_6A                               = COMPLETE
PHASE_6B_READY                         = YES
```

Distinctions kept: owner-approved video != signed human full-watch; model watch != frame-exact QA; 57 s pilot != Phase 4 2–3 min requirement proven; HYGIENE PASS != git clean. Phase 6B was not started.
