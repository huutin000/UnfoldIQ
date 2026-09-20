# UnfoldIQ Documentation — Clean Index

> Cleaned on 19/09/2026.
> Goal: remove true duplicates / clearly superseded draft material while preserving unique implementation, verification, governance, design, and corrective evidence.

## 1. Canonical structure

```text
docs/
├── README.md
├── antigravity_stop_and_handoff.md
├── PHASE_08_EXTERNAL_REVIEW_CORRECTIVE_CLOSURE_V2.md
├── PHASE_08_EXTERNAL_REVIEW_FINAL_CORRECTIVE_V4.md
├── implementation/
│   ├── ROADMAP_STATUS.md
│   ├── implementation_plan.md
│   ├── PHASE_01_... -> PHASE_09_...
│   ├── FINAL_SYSTEM_...
│   └── UI_LANGUAGE_...
└── superpowers/
    ├── plans/
    └── specs/
```

## 2. Source-of-truth documents

For current project state, start with:

1. `implementation/ROADMAP_STATUS.md` — current phase / Final Gate status.
2. `implementation/implementation_plan.md` — master implementation roadmap and architecture plan.
3. `implementation/PHASE_09_IMPLEMENTATION_REPORT.md` — latest implementation-phase report.
4. `implementation/FINAL_SYSTEM_GATE_EXTERNAL_REVIEW_FINAL.md` — final external review / governance closure for the Final System Gate.
5. `implementation/UI_LANGUAGE_GLOSSARY.md` — canonical UI language glossary.

For a specific phase, use its `IMPLEMENTATION_REPORT` together with the latest `FINAL_*` closure / verification report. Micro-closure reports are retained only when they contain unique evidence referenced by later final reports.

## 3. Cleanup performed

Removed from the original ZIP:

- `PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md` at docs root — byte-for-byte duplicate of `implementation/PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md`.
- `PHASE_08_FINAL_CLOSURE_REPORT.md` at docs root — byte-for-byte duplicate of `implementation/PHASE_08_FINAL_CLOSURE_REPORT.md`.
- `PHASE_08_EXTERNAL_REVIEW_CORRECTIVE_CLOSURE.md` — superseded by V2; V2 explicitly records that the previous corrective pass closed its major issues.

Retained:

- `PHASE_08_EXTERNAL_REVIEW_CORRECTIVE_CLOSURE_V2.md` and `PHASE_08_EXTERNAL_REVIEW_FINAL_CORRECTIVE_V4.md` because they contain different corrective requirements and are part of the Phase 8 review lineage; they are not simple duplicate revisions.
- Phase-specific micro/final closure reports where later reports still rely on their unique evidence.

Corrected:

- In `implementation/PHASE_03A_FINAL_VERIFICATION_REPORT.md`, the glossary path was corrected from `docs/UI_LANGUAGE_GLOSSARY.md` to `docs/implementation/UI_LANGUAGE_GLOSSARY.md`.

## 4. Known missing references in the source ZIP

These were referenced by existing documents but were not present in the uploaded ZIP, so no replacement content was fabricated:

- `docs/PHASE_08_EXTERNAL_REVIEW_FINAL_MICRO_CLOSURE_V3.md`
- `docs/implementation/PHASE_01_IMPLEMENTATION_REPORT.md`
- `docs/implementation/PHASE_03A_IMPLEMENTATION_REPORT.md`
- `docs/UNFOLDIQ-PHASE03A-FINAL-VERIFICATION-AND-GAP-CLOSURE-PROMPT.md`

Phase 8 V3 results are nevertheless summarized/incorporated inside `implementation/PHASE_08_IMPLEMENTATION_REPORT.md`; the missing standalone V3 file should only be restored if the original exists elsewhere.

## 5. Cleanup rule used

- Remove exact duplicates.
- Remove an older corrective document only when a later document explicitly states the previous corrective pass was closed/superseded.
- Do not delete documents merely because they share a phase number: implementation reports, design specs, verification reports, closure reports, and evidence reports have different purposes.
- Do not invent missing reports.
