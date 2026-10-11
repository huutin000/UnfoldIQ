# UNFOLDIQ Report Index

> Generated under POST-1H workspace governance. canonical roadmap: V6.3
> (see `UNFOLDIQ_CANONICAL_ROADMAP_V6_3_MARKET_GAP_CONTINUITY_AGENT_READY.md` / `UNFOLDIQ_CANONICAL_ROADMAP_LATEST.md` at Downloads All; supersedes V6.2).
> Rule: consult this index instead of scanning hundreds of reports.
> Layout migrated by FIX POST-1H 01: phases/ (final gates), fixes/ (fix
> reports), archive/ (superseded intermediates), current/ (live gate).

## Current state

> Status below is copied from the cited canonical reports, not decided in this index.
> Retention/cleanup rules: `Report/REPORT_EVIDENCE_POLICY.md`. Evidence map: `Report/evidence/INDEX.md`.

- **Roadmap:** V6.3 — Market Gap, Continuity, Agent-Ready
- **Current phase:** Phase 6 `COMPLETE` (6A + 6B), `PHASE_7_READY = YES` per `Report/phases/phase-6/PHASE_6B_CREATIVE_DIFFERENTIATION_FINAL_QUALITY_REPORT.md` and `Report/evidence/phase-6b/phase6-major-gate.json` (full regression 199/199). Phase 7 Slice A (preflight) is documented in `Report/phases/phase-7/` (owner decisions applied; `PHASE_7 = NOT_COMPLETE`, Slice B not started). Phase index: `Report/phases/phase-6/INDEX.md`
- **Latest canonical gate report:** `Report/phases/phase-6/PHASE_6B_CREATIVE_DIFFERENTIATION_FINAL_QUALITY_REPORT.md` (6A gate: `Report/evidence/phase-6a/final-reconciliation/PHASE_6A_FINAL_GATE_RECONCILIATION.md`)
- **Open limitations handed to Phase 7:** `CHANNEL_LEVEL_ORIGINALITY = NOT_PROVEN` (1 real episode, need >=5); pilot QA PASS relies on the owner-accepted packaging REVIEW_REQUIRED exception; 57 s pilot does not prove 8-12+ min production; Gemini watch lineage PARTIAL; AUDIO_VISUAL_QA REVIEW_REQUIRED (owner-accepted); English-tuned lexical layer (GAP-047)
- **Technical debt — Regression Output Isolation:** `node scripts/run-tests.js` rewrites ~30 tracked baseline/telemetry/registry files (timestamps, telemetry events, DAG revision counters); patch kept at `Report/evidence/phase-6b/regression-generated-tracked-changes.patch`; fix = run tests against a temp copy or untrack generated output
- **Canonical pilot:** `Report/phases/phase-6/PHASE_6A_CANONICAL_PILOT_REPORT.md` (project `pilot-sky-blue-canonical`, attempt-006)
- **Repo cleanup audit (2026-10-10):** `Report/audit/repo-cleanup-2026-10-10/` (execution result: `CLEANUP_EXECUTION_RESULT.md`)

## Phase 6 (CANONICAL)

- `Report/phases/phase-6/PHASE_6B_CREATIVE_DIFFERENTIATION_FINAL_QUALITY_REPORT.md` — CANONICAL (6B final gate; Phase 6 COMPLETE)
- `Report/phases/phase-6/PHASE_6A_FINAL_CLOSURE_REPORT.md` — CANONICAL for steps/evidence; its `CLOSED_BY_OWNER_DECISION` / `PHASE_6B_READY = NO` verdict is SUPERSEDED by the final reconciliation
- `Report/phases/phase-6/PHASE_6A_CANONICAL_PILOT_REPORT.md` — CANONICAL (pilot lineage)
- `Report/phases/phase-6/PHASE_6A_CREATIVE_RETENTION_FOUNDATION_REPORT.md` — CANONICAL with closure revision (its original verdict block is SUPERSEDED inside the file)

## Final report per major phase (KEEP — canonical)

- Phase 1G: `Report/phases/phase-1g/PHASE_1G12_02_RETROACTIVE_HARDENING_SWEEP_REPORT.md`
  (V6.1 quality gate PASS; A/B/C/D functional proof lives in
  `Report/phases/phase-1g/PHASE_1G12_01_VEO_REAL_E2E_REPORT.md`)
- Phase 1H.1: `Report/phases/phase-1h/PHASE_1H1_01_VERSIONED_PROJECT_MANIFEST_REPORT.md`
- Phase 1H.2: `Report/phases/phase-1h/PHASE_1H2_01_GENERATION_HISTORY_AND_LOCKING_REPORT.md`
- Phase 1H.3: `Report/phases/phase-1h/PHASE_1H3_01_IDEMPOTENCY_RESUME_RECOVERY_AND_DEPENDENCY_DAG_REPORT.md`
- Phase 1H.4+1H.5: `Report/phases/phase-1h/PHASE_1H4_1H5_01_OBSERVABILITY_AND_GOLDEN_QUALITY_REGRESSION_REPORT.md`
- Phase 1H.6+1H.7: `Report/phases/phase-1h/PHASE_1H6_1H7_01_ARTIFACT_GOVERNANCE_AND_STORAGE_LIFECYCLE_REPORT.md`
- POST-1H hygiene: `Report/archive/post-1h/POST_1H_REPOSITORY_HYGIENE_AND_WORKSPACE_MIGRATION_REPORT.md`
  (superseded as current gate by FIX POST-1H 01)
- Phase 2.1: `Report/fixes/phase-2/FIX_PHASE_2_1_02_RIGHTS_DECISION_AND_CANONICAL_SYNC_REPORT.md`
  (`PHASE_2_1 = COMPLETE`, Voice Bible v3 `vb-19f4fd6a4596`, narrator `am_michael`)
- Phase 2.2+2.3: `Report/phases/phase-2/PHASE_2_2_2_3_NARRATION_DIRECTION_AND_PRONUNCIATION_RUNTIME_REPORT.md`
  (`PHASE_2_2_2_3 = COMPLETE`; narration direction + pronunciation runtime pass; TTS-ready plan READY_FOR_TTS)
- FIX PRE-2.4: `Report/fixes/phase-2/FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE_REPORT.md`
  (`FIX_PRE_2_4 = COMPLETE`; humanizer → fidelity → naturalness → canonical FSS `fss-pilot-sky-blue@v2`; productionTtsBlocked=false)
- Phase 2.4–2.11: `Report/phases/phase-2/` (4 reports)
- Phase 3A–3C: `Report/phases/phase-3/`
- Phase 4A–4B: `Report/phases/phase-4/`
- Phase 5A–5C: `Report/phases/phase-5/`
- POST-1H physical reorganization: `Report/current/POST_1H_PHYSICAL_REORGANIZATION_REPORT.md`
  (`FIX_POST_1H_01 = COMPLETE`)

## 1G stage reports (KEEP — entry gates for 1G.12)

- `Report/phases/phase-1g/PHASE_1G1_05_DEEP_LIVE_PROVIDER_VALIDATION_FIX_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G1_06_FULL_E2E_VALIDATION_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G2_01_CREATIVE_MEMORY_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G3_01_BEAT_SCENE_SHOT_PLANNING_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G4_01_PROMPT_COMPILER_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G5_01_VISUAL_MOTION_DECISION_ENGINE_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G6_01_PROVIDER_MODEL_CAPABILITY_REGISTRY_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G7_01_PLATFORM_POLICY_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G8_01_OUTPUT_COST_CREDIT_PLANNER_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G9_1G10_AGENT_INSTRUCTIONS_ASSET_LIBRARY_REPORT.md`
- `Report/phases/phase-1g/PHASE_1G11_01_STRUCTURAL_SEMANTIC_FACTUALITY_CONTINUITY_QA_REPORT.md`

## Fix history

- Phase 1 env: `Report/fixes/phase-1/REMOTION_WINDOWS_RENDER_ENVIRONMENT_FIX_REPORT.md`
- Post-V1 bridge/flow: `Report/fixes/post-v1/` (11 fix reports)
- Phase 2 voice: `Report/fixes/phase-2/` (FIX 01 + FIX 02)

## Archive locations

- Superseded step reports: `Report/archive/phase-1/` (STEP-*, setup, root-cleanup)
- Superseded post-V1 intermediates: `Report/archive/post-v1/`
- Superseded POST-1H gate: `Report/archive/post-1h/`
- Superseded Phase 2.1 task report: `Report/archive/phase-2/`
  (superseded-by FIX 02; status also in
  `projects/phase1hyg-validation/inventory/classification.json` review notes)

## Canonical evidence locations (do not move without ref updates)

- Evidence map by phase/owner: `Report/evidence/INDEX.md`

- Playwright/browser evidence: `Report/evidence/playwright/`
- Phase validation evidence: `projects/validation/phase-1g/phase1g12-hardening/`,
  `projects/validation/phase-1h/phase1h{1,2,3,45,67}-validation/`
- Golden definitions/baselines: `golden/`
- Project registry: `projects/registry.json`
- Artifact registry: `projects/artifact-registry.json`
- Migration journal: `projects/validation/post-1h-physical-migration/migration/migration-journal.jsonl`

## Workspace governance (POST-1H, extended by FIX POST-1H 01)

- Resolver/guard: `lib/workspace/index.js` (registry-aware nested paths + portability hazards)
- Artifact resolver: `lib/artifact-resolver/index.js` (`artifact://` identity + hash/state validation)
- Retention policy: `policy/artifact-retention-policy.json`
- Gate: `npm run check:workspace` (`scripts/checks/workspace-check.js`)
- Registry: `projects/registry.json`
