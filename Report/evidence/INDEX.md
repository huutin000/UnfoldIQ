# Evidence Index

Map only. Files stay at their physical paths; do not move them (reports, JSON and tests reference them). Retention classes: `Report/REPORT_EVIDENCE_POLICY.md`.

| Folder | Owner phase | Content | Class |
|---|---|---|---|
| `playwright/` | Playwright E2E | HTML report + artifacts (`playwright.config.js` output) | REGENERABLE_CACHE |
| `phase1g1-full-e2e/`, `research-acquisition/`, `research-evidence-live/`, `research-story-live/` | 1G.1 | Live research/provider validation | HISTORICAL_ARCHIVE |
| `post-v1e2g-live/`, `post-v1f-real-execution/` | Post-V1 | Live Flow/real execution proofs | HISTORICAL_ARCHIVE |
| `pilot-4b/` | 4B | Pilot final QA / render QC | REQUIRED_TEST_EVIDENCE |
| `perf-5a/`, `perf-5b/`, `perf-5c/` | 5A–5C | Profiling, incremental, runtime scale (cited by tests/reports) | REQUIRED_TEST_EVIDENCE |
| `phase-6a/` | 6A | Gates, regression logs, repair, watch, canonical pilot | see below |

## `phase-6a/`

| Path | Class | Flag |
|---|---|---|
| `phase-6a-completion-gate.json`, `phase-6a-summary.json`, `phase-6a-canonical-video-lineage.json` | PINNED_CANONICAL | KEEP |
| `phase-6a-creative-repair-execution.json`, `phase-6a-after-repair-segment-review.json`, `repair/` | PINNED_CANONICAL | KEEP (cited by tests/fixtures) |
| `phase-6a-full-av-watch*.{json,md}`, `canonical-pilot/gemini-watch*.json`, `canonical-pilot/phase4b-final-qc.json`, `canonical-pilot/scene-media-coverage-matrix.md` | PINNED_CANONICAL | KEEP |
| `full-regression-*.log`, `suite-results.json`, `golden-creative-results.json`, `performance-budget-profile-6a.json`, `*-check-final.log` | REQUIRED_TEST_EVIDENCE | KEEP |
| `final-reconciliation/PHASE_6A_FINAL_GATE_RECONCILIATION.md` | PINNED_CANONICAL | KEEP; latest 6A/6B verdict |
| rest of `final-reconciliation/` | HISTORICAL_ARCHIVE | KEEP (logs, patches, audit notes) |
| `canonical-pilot/*.mp3`, `canonical-pilot/preview-*.mp4`, `narration-vi-review.md` | REVIEW_REQUIRED | HOLD: owner narration-speed review inputs, untracked; owner decides track/archive |
| `pilot/` | REVIEW_REQUIRED | KEEP until owner review |

## Related, outside this folder

- Golden baselines: `golden/`; project validation evidence: `projects/validation/`
- Canonical video: `projects/pilot-sky-blue-canonical/render/attempts/attempt-006/` (attempts 001–005 are untracked lineage: KEEP/HOLD)
- Render cache: `out/incremental-5b/`, `out/incremental-5c/`, long-form `out/longform-5c/` (HOLD, see cleanup audit)
