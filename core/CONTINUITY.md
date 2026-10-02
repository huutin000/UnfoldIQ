# UNFOLDIQ Continuity Foundation (STEP 10A)

Source of truth for recurring visual consistency. A video with recurring
character, wardrobe, prop, location, or creature/object MUST NOT generate each
scene independently and hope they match.

## Mandatory Pipeline

```text
Visual Bible
↓
Continuity Plan
↓
Master Reference Assets
↓
LOCK
↓
Scene Assets
↓
Continuity QA
↓
READY
```

## Responsibility Split

**Visual Bible owns**: overall visual language, world/era, style, camera
language, color/lighting direction.

**Continuity Registry owns**: recurring entity identity, wardrobe, prop,
location identity, locked reference assets.

One references the other; neither duplicates the other.

## Entity Types

`CHARACTER` · `WARDROBE` · `LOCATION` · `PROP` · `CREATURE` · `OBJECT` · `STYLE_ANCHOR`

Not every video needs continuity entities (e.g. a React tutorial may have no
recurring character). Continuity docs are CONDITIONAL when a scene needs no
recurring visual consistency.

## Lifecycle

`DRAFT` → `LOCKED` → (`RETIRED`). At least one APPROVED master/reference is
required before an entity can be LOCKED when a visual reference is required.
RETIRED references/entities cannot serve current strict requirements unless
explicitly allowed.

## Reference Roles

`MASTER` · `FRONT` · `PROFILE` · `THREE_QUARTER` · `WARDROBE_REFERENCE` ·
`LOCATION_REFERENCE` · `PROP_REFERENCE` · `STYLE_REFERENCE`, each with status
`CANDIDATE` · `APPROVED` · `REJECTED`.

## Character / Wardrobe / Location

- Character attributes support age range, face/identity notes, hair,
  body/build, distinguishing features, wardrobe IDs, accessories, role,
  era/domain constraints — only when relevant. No sensitive identity inference.
- Wardrobe is a separate entity when it matters (`CHAR_MOTHER_01` wears
  `WARDROBE_MOTHER_01`). Without a wardrobe change, `forbiddenChanges` covers
  unexpected clothing/color/material changes; intentional change is a new
  variant/entity relationship, never a silent overwrite.
- Location captures environment, layout, lighting baseline, weather/time,
  landmarks, era restrictions. Day/night is an allowed variant or a separate
  variant per story.

## Evidence / Reconstruction Link

The registry MUST NOT imply AI reconstruction is factual evidence. Reference
assets use Step 09 classifications: `EVIDENCE_ASSET` · `RECONSTRUCTION` ·
`ILLUSTRATION` · `GENERIC_BROLL`. A master AI character image is usually
`RECONSTRUCTION`, never `EVIDENCE_ASSET`.

## Scene Requirements

Provider requests state `requiredEntities[]` and `continuityStrictness`:
`STRICT` (recurring identifiable main characters/hero product) · `NORMAL`
(same world, moderate variation ok) · `LOOSE` (mood/style only) ·
`NOT_APPLICABLE` (diagram/code/text-only).

Without approved references, a STRICT scene MUST NOT claim
`CONTINUITY_READY`: require reference generation or use a deliberately
non-recurring/generic visual strategy.

## Storage

```text
projects/<projectId>/
├── continuity/
│   ├── continuity-registry.json
│   ├── characters/
│   ├── wardrobe/
│   ├── locations/
│   ├── props/
│   └── style/
```

Executable rules live in `lib/continuity-check.js` (CT1–CT8).
