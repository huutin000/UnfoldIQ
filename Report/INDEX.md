# UNFOLDIQ Report Index

> Generated under POST-1H workspace governance. canonical roadmap: V6.2
> (supersedes V6.1; see `UNFOLDIQ_CANONICAL_ROADMAP_V6_2_*` at Downloads All).
> Rule: consult this index instead of scanning hundreds of reports.
> Layout migrated by FIX POST-1H 01: phases/ (final gates), fixes/ (fix
> reports), archive/ (superseded intermediates), current/ (live gate).

## Current state

- **Roadmap:** V6.2 — Continuous Optimization, Workspace Governance, Agent-Ready
- **Current phase:** FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE COMPLETE (previous: Phase 2.2+2.3 COMPLETE)
- **Next:** Phase 2.4 + 2.5 + 2.6 (final narration/TTS audio, speech-rate QA, captions) — production-TTS block CLEARED via canonical FSS `fss-pilot-sky-blue@v2`
- **Latest Quality Gate:** `Report/fixes/phase-2/FIX_PRE_2_4_FINAL_SPOKEN_SCRIPT_PIPELINE_REPORT.md`
  (`FIX_PRE_2_4 = COMPLETE`, FSS = CANONICAL, PRODUCTION_TTS_BLOCKED = false, P0/P1 = 0)

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
- POST-1H physical reorganization: `Report/current/POST_1H_PHYSICAL_REORGANIZATION_REPORT.md`
  (this FIX; `FIX_POST_1H_01 = COMPLETE`)

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
