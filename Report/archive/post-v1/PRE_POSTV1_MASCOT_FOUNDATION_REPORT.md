# PRE POST-v1 MASCOT FOUNDATION REPORT

## 1. Status

`PASS`

Channel mascot foundation complete. No media generated. No Flow calls. POST-v1 can proceed with `CHAR_UNFOLDIQ_GUIDE_01`.

## 2. Existing Architecture Reused

- Continuity contract: `schemas/continuity-registry.schema.json` (entity types CHARACTER/WARDROBE/STYLE_ANCHOR, lock lifecycle DRAFT/LOCKED/RETIRED, reference roles plus CANDIDATE/APPROVED/REJECTED, relationships, RECONSTRUCTION classification rule). No schema change, no new enum values.
- Pipeline rules: `core/CONTINUITY.md` (Visual Bible vs registry split, master-reference-before-LOCK, STRICT precondition semantics). The mascot brief references this split instead of duplicating it.
- No existing global Continuity store existed (registries are project-scoped per `core/CONTINUITY.md` storage section), so `brand/continuity-registry.json` was created as the single global-brand registry following the canonical schema — a new location, not a duplicate pipeline.

## 3. Mascot Definition

- Character ID: `CHAR_UNFOLDIQ_GUIDE_01`.
- Role: CHANNEL_MASCOT, scope GLOBAL_BRAND, continuityStrictness STRICT.
- Style: 2.5D-stylized adult guide (apparent 27–33), short dark stable hair, expressive eyes/brows, simplified-realistic body, readable silhouette; governed by `STYLE_UNFOLDIQ_GUIDE_01`.
- Default wardrobe: `WARDROBE_GUIDE_CORE_01` (mustard-yellow light jacket/overshirt, dark-charcoal inner shirt, dark-neutral trousers/shoes, no logos/text).
- Signature elements: mustard-yellow outerwear anchor, charcoal inner, dark-teal secondary accent.
- Artifacts: `brand/CHANNEL_MASCOT_BRIEF.md`, `brand/channel-mascot.json`.

## 4. Immutable vs Variable

| Property | Immutable | Controlled Variant | Free per Scene |
|---|---|---|---|
| Face proportions | YES | — | — |
| Apparent age (27–33) | YES | — | — |
| Hairstyle identity | YES | — | — |
| Body proportions/silhouette | YES | — | — |
| Art-style family (2.5D-stylized) | YES | — | — |
| Mustard brand anchor | YES (across variants) | — | — |
| Core wardrobe | YES for V1 | variant ID required later | — |
| Expression (7-set) | — | semantic set, identity-stable | YES (per beat) |
| Pose (7-set) | — | future approved refs | YES (per beat) |
| Props/environment/camera/lighting | — | — | YES |
| Future wardrobe variants | — | explicit IDs only (not created) | — |
| Screen-time placement | — | — | YES (content-driven, no cadence rule) |

## 5. Wardrobe Strategy

- CORE wardrobe `WARDROBE_GUIDE_CORE_01` locked as the only V1 wardrobe; default answer to per-video changes is NO.
- Future variants (FIELD/LAB/FORMAL) explicitly NOT generated; rules recorded (identity unchanged, anchor preserved, own stable ID, approved reference required, no per-video invention).
- `channel-mascot.json` lists them under `explicitlyNotGeneratedYet`. No random per-video wardrobe possible under this contract.

## 6. Files Created

- `brand/CHANNEL_MASCOT_BRIEF.md`
- `brand/channel-mascot.json`
- `brand/continuity-registry.json`
- `Report/PRE_POSTV1_MASCOT_FOUNDATION_REPORT.md`

## 7. Files Modified

`None`. No existing file was edited; registration lives in the new global-brand registry.

## 8. Schema / Registry Compatibility

- `brand/continuity-registry.json` validates against `schemas/continuity-registry.schema.json`: VALID (Ajv, verified 2026-09-26).
- All three IDs resolve: character, wardrobe, style anchor present; both relationships (`uses`, `governedBy`) resolve to registered IDs.
- No new enum values introduced (`scope: GLOBAL_BRAND` and `role: CHANNEL_MASCOT` live in the mascot JSON and entity attributes, not in the schema).
- `referenceStatus: NOT_GENERATED`, mascot `lockStatus: UNLOCKED`, registry `lockStatus: DRAFT` — nothing prematurely locked.
- No duplicate character system (single `brand/` store), no duplicate Visual Bible (style lives in the STYLE_ANCHOR entity plus brief), no duplicate Continuity Registry (one global file following the canonical schema).

## 9. POST-v1 Readiness

YES — POST-v1 can now use `CHAR_UNFOLDIQ_GUIDE_01` instead of the generic explorer:
- Contract resolvable: character → default wardrobe → style anchor verified programmatically.
- Master target specified: `REF_GUIDE_MASTER_3Q_01` with acceptance gate (APPROVED then LOCKED; REVIEW_REQUIRED when uncertain).
- Quality gate recorded (recognizable, reusable, pleasant, explainer-fit, continuity-friendly — not just structurally valid).
- Flow notes recorded (one-Flow-project preference, no credential storage, reusable-Character detection, draft agent instruction, `@me` forbidden).

## 10. Flow Calls

`None`. No network calls of any kind were made in this task (local file writes plus local Ajv validation only).

## 11. Errors / Warnings

`None`. One design note (not a warning): project-scoped registries remain the norm per `core/CONTINUITY.md`; the mascot registry is intentionally global (`projectId: global-brand`) and consumers must select it explicitly for brand-level STRICT checks.

## 12. Blockers

`None`

## 13. Remaining Work

`Run POST-V1_FLOW_LIVE_VALIDATION using CHAR_UNFOLDIQ_GUIDE_01`

## 14. Final Conclusion

`PRE POST-v1 MASCOT FOUNDATION: PASS 100%`
