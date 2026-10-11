# PHASE 7 — Production Plan (Slice A: Preflight / Feasibility)

> **Update 10/10/2026:** owner decisions applied in `PHASE_7_SLICE_A_OWNER_DECISIONS_ADDENDUM.md` (brief/budget APPROVED_CONDITIONAL, Flow cap 80, visual routing revision). Sections 7 and 9 below are historical.

**Slice A verdict: `PHASE_7 = BLOCKED_BY_INPUT` — engineering preflight READY; waiting on owner approvals (§9).** No render, no media generation, no Flow credit, no provider call, 0 VND. Slices B–E have NOT started.

## 1. Entry snapshot and Phase 6 gate (verified from the repo)
| Check | Result |
|---|---|
| Git HEAD / branch | `f579985` (feat(phase-6b)…) / `main` |
| Tracked tree | clean (`git status --porcelain` shows only 16 pre-existing untracked 6A leftovers: `Report/audit.zip`, 6A preview mp3/mp4, `pilot-sky-blue-canonical` attempts 001-006 log, `remotion/public/unfoldiq/pilot-sky-blue-canonical/`) |
| Phase 6 Major Gate | `phase6-major-gate.json`: PHASE_6B=COMPLETE, PHASE_6_MAJOR_GATE=PASS, PHASE_7_READY=YES, FULL_REGRESSION=PASS (199/199, 1033.3 s), EXTERNAL_PAID_COST_VND=0 |
| Snapshot vs 199/199 run | No file under `lib/`, `tests/creative/`, the 6B fixture or the 6B script is newer than the run-2 start marker; the committed code = the tested worktree. Doc/index edits were made after the run (non-behavioural). The regression ran on the then-uncommitted worktree; identity is by content, not by a pre-commit hash. |
| Run 1 (191/195, Chromium missing) | kept as history, SUPERSEDED by run 2 |
| Render readiness | `npm run render:doctor` → READY |
| Locked 6A canonical | `final.mp4` sha256 `7954a86a…` untouched |

**Discrepancy found:** the newest roadmap on disk is `UNFOLDIQ_CANONICAL_ROADMAP_LATEST.md` = **V6.3** (07/10/2026, identical to the `V6_3_…` file), but `Report/INDEX.md` still cites V6.2 and no roadmap file is inside the repo. Phase 7 text in V6.3 (§12, 7.1–7.3) matches the task file. Recommend updating the INDEX reference in a later doc-only commit (not done here).

### Carried limitations (unchanged, not transferred as exceptions)
CHANNEL_LEVEL_ORIGINALITY=NOT_PROVEN (1 real episode; need ≥5) · 57 s pilot ≠ long-form proof · packaging exception is video-specific (does NOT apply to the new video) · AUDIO_VISUAL_QA_6A=REVIEW_REQUIRED (accepted) · GEMINI_WATCH_LINEAGE=PARTIAL · GAP-046 deferred · GAP-047 English-tuned lexical layer.

## 2. Proposed long-form project (needs owner approval — no approved long-form brief exists)
Repo check: no owner-approved long-form brief; `PILOT_INPUT.yaml` is the 1-min sky pilot; `TOPIC_REGISTRY.json` has only a test topic. The sky pilot is NOT stretched.

**Recommended: "How Does GPS Know Where You Are?"** (everyday physics/technology explainer)
- Format 16:9 1920×1080@30, English (Kokoro supports `en`; Vietnamese is unsupported by Kokoro), audience curious general viewers 12+, channel identity UNFOLDIQ flat-vector "ILLUSTRATION" system, calm documentary pacing.
- Target **≈9:35 (575 s)**, range 9–10 min; ≈1,500 narration words (6A measured 2.6 w/s).
- Why this topic: factual with abundant public primary sources; deep enough for 9+ min without padding (trilateration → orbits → time-of-flight → clock bias → relativity → error sources); every scene can be an **original diagram/chart** (0 licensing risk, 0 Flow credits); different subject from the pilot so the Phase 6 originality gate gets a second real, distinct episode (still ≠ channel-level proof).
- Title/thumbnail promise (draft): "How Does GPS Know Where You Are? (It Needs Einstein)" / thumbnail = phone dot + orbit ring illustration. Promise delivered at 6:30–7:50 (relativity), teased in the hook; HOOK_PROMISE checks will run in Slice B.
- Alternates if you prefer: (B) "Why Do Noise-Cancelling Headphones Work?" (shorter, may need padding), (C) "How Do Airplanes Actually Stay Up?" (heavy myth-correction, needs careful evidence). A fictional/story brief is also possible but needs many more assets (characters) and likely Flow/Veo.
- Structure: 8 chapters / **50 scenes** — see `PHASE7_SCENE_ASSET_COVERAGE.md`.

### Research path and evidence policy — READY (to execute in Slice B)
Existing stages: research acquisition/deep research → evidence sufficiency → editorial strategy → humanizer → evidence-fidelity/naturalness → final spoken script. Policy proposed: every factual claim ≥1 primary source; every numeric claim ≥2 agreeing sources; unsupported → rewrite, not waive; source diversity ≥3 independent publishers (government/agency, standards/metrology, peer-reviewed). 14 claims (C1–C14) mapped to scenes; candidate sources named but **not fetched yet**; numbers (orbit ~20,200 km, 12 h, ~38 µs/day, ~10 km/day) are unverified until then.
**Open check:** `research:deep:doctor` / research provider keys were NOT probed in this slice (could touch providers); verify at Slice B start. `doctor:research` OK for the local Playwright stack.

## 3. Scene Asset Coverage (summary)
50 scenes, 575 s: DIAGRAM 31, CHART 9, TEXT_EVIDENCE 8, MAP-like 2. **0** need Flow/Veo, **0** need external media, **0** placeholders. Everything is original SVG/Remotion (≈12 parametric primitives after consolidation of the 39 listed component names). Music/SFX: intentionally absent (approved-local music/sfx contain TEST-ONLY entries only). Full table: `PHASE7_SCENE_ASSET_COVERAGE.md`; machine copy `Report/evidence/phase-7/scene-plan.json`.
Gate: SCENE_ASSET_COVERAGE = READY (planned). Real cost = authoring effort (3–6 sessions), flagged to you rather than hidden.

## 4. Resource & credit budget (summary; full JSON: `Report/evidence/phase-7/PHASE7_RESOURCE_AND_CREDIT_BUDGET.json`)
| Item | Estimate (not guarantee) |
|---|---|
| Frames | 17,250 @30 fps |
| TTS (Kokoro local) | ~5 min (4–10) |
| Forced alignment (faster-whisper) | ~4 min (2–8), NOT_MEASURED at this length |
| 5 preview segments | ~4 min |
| ONE planned full render | ~20 min (19–39), LOCAL, c=4, RSS ~450 MB |
| Technical QA | ~8 min (5–15) |
| Disk | final ~170 MB; temp/cache ~3 GB (2–6); free 213 GB |
| Machine wall-clock total | ~1.2 h (excl. authoring + owner review) |
| Host | i5-11400H 6c/12t, RAM 15.8 GB (5.1 GB free now), RTX 3050 4GB unused, render doctor READY |
| Flow credits authorized | **0** (none needed) |
| Gemini Free | ≤10 calls planned, **NOT_MEASURED**: API keys not set in this shell; `.env` deliberately not read; tier/quota/privacy unverified |
| External paid cost | **0 VND** |
Strategy LOCAL (Phase 5C). Retries bounded (TTS 2/segment, preview 2/segment, full render 1 + 1 only with defect evidence and your approval). Stop conditions in the JSON.

## 5. Rights, music and disclosure policy — READY
- Visuals: all original; each used asset gets a provenance record (generator, composition, hash) like the pilot's `asset-manifest.json`. Narration: local Kokoro synthesis of an original script (Kokoro model terms and voice rights to be re-recorded in the rights ledger).
- Music/SFX: **absent by design** (no licensed track available). If you later supply licensed music, the existing cue-rights, mix and ducking checks run; narration intelligibility wins.
- Sources: cited in the description; no source imagery is reused.
- AI-content disclosure (YouTube help 14328491, fetched 10/10/2026): disclosure targets *realistic* synthetic content; non-realistic animation and production assistance are exempt. Preliminary decision: **not required** (stylized labelled diagrams, generic synthetic narrator that is not an impersonation). Final decision recorded in Slice B and confirmed by you.
- No archival/photoreal depiction presented as real; all visuals labelled ILLUSTRATION.

## 6. Free-API cost guard — PROVEN (configuration level)
`doctor:provider` shows every paid/cloud provider `enabled=no, paidAllowed=false`; the 6B `assertZeroPaid` guard exists and is tested; Slice A made 0 provider/model calls. Not yet exercised against a live provider in Phase 7 (no provider interaction authorized).

## 7. Readiness per Slice A gate
| Gate field | Status |
|---|---|
| OWNER_CREATIVE_BRIEF_APPROVED | **NO** (proposal awaiting you) |
| RESEARCH_PATH_AND_EVIDENCE_POLICY | READY (providers' keys unprobed) |
| SCENE_ASSET_COVERAGE | READY (planned, local-authored) |
| RIGHTS_POLICY | READY |
| FREE_API_COST_GUARD | PROVEN (config) |
| RESOURCE_BUDGET | PROPOSED, **not approved** |
| CAN_PROCEED_TO_LONGFORM | **NO** until approvals |

## 8. Blockers / risks
1. **Owner approvals** (brief, budget, Flow = 0) — hard blocker by design.
2. Gemini Free availability/privacy unverified — only affects optional model-assisted watch; fallback is your human watch.
3. Research provider readiness unprobed — verify first thing in Slice B; if deep-research providers are unavailable, fall back to the acquisition (crawl) path with the same evidence policy.
4. Authoring effort is large (50 scenes, 12+ primitives); risk of visual monotony mitigated by modality mix + Phase 6 gates.
5. Render times derived from a synthetic fixture; real compositions may be up to ~2× slower (budget band covers it).
6. Smart App Control: doctor says READY now; if it later blocks the compositor, stop and ask you to toggle manually (agent must not).
7. Known debt: Regression Output Isolation (full test run rewrites tracked baselines) — avoid full regression until the end.
8. Doc drift: `Report/INDEX.md` cites roadmap V6.2 while V6.3 is the latest.

## 9. Decisions needed from you
1. **Approve or change the brief** (GPS explainer, ~9:35, English, 16:9) — or give your own topic/brief (a story/fiction brief changes the asset plan and likely needs Flow).
2. **Approve the resource budget** (≈1.2 h machine time + 3–6 authoring sessions; one planned full render).
3. **Flow free credits: 0 (recommended)** or set a maximum number.
4. **Gemini Free for the final watch:** confirm key/project is on the Free tier and that uploading the final video is acceptable; otherwise you do the human watch (needed anyway for final approval).
5. **Music:** keep absent (recommended) or supply a licensed track + license evidence.
6. **Evidence threshold** (≥1 primary / ≥2 for numbers) and the source list approach.
7. Confirm I may commit these Slice A documents (not committed yet).

Next step only after your answer: Slice B (research → script → audio → previews). I will not continue without your confirmation.
