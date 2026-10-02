# UNFOLDIQ Core Visual Bible

## A. When a Visual Bible Is Required

A Visual Bible is **mandatory or strongly recommended** when the video involves:

| Condition | Reason |
|-----------|--------|
| **Recurring character** | Consistent identity across scenes |
| **Recurring location** | Spatial and lighting continuity |
| **Historical recreation** | Period accuracy across shots |
| **Fictional world** | World-building consistency |
| **Product identity** | Brand visual language adherence |
| **Brand identity** | Logo, color, typography consistency |
| **Multi-scene AI-generated visuals** | Prevent drift across generations |

A Visual Bible may be **lightweight** (style notes only) when the video uses primarily:
- Charts, diagrams, data visualizations
- Text/motion graphics
- Stock-like abstract assets
- Single-scene or non-recurring content

---

## B. Visual Bible Fields (Minimum Definition)

| Field | Description |
|-------|-------------|
| **Visual Style** | Overall aesthetic (e.g., photorealistic, illustrated, collage, kinetic typography, mixed media, documentary, cinematic) |
| **Realism / Stylization Level** | Where on the spectrum: photorealistic → stylized → abstract → symbolic |
| **Color / Palette Direction** | Primary, secondary, accent colors; color harmony rules; mood-driven palette shifts |
| **Lighting** | Key light quality (hard/soft), direction, time-of-day consistency, practical lighting sources |
| **Contrast** | Global contrast ratio; high-key vs low-key; shadow behavior |
| **Environment / World Rules** | Physics, weather, time flow, technology level, cultural markers, spatial logic |
| **Character Identity** | See Section C (Character Continuity) |
| **Wardrobe / Props** | Consistent clothing, accessories, objects across scenes |
| **Era / Time Period** | Historical period, futuristic setting, timeless; period-accurate details |
| **Architecture / Object Consistency** | Building styles, furniture, vehicles, tech, signage — consistent within world |
| **Camera Language** | Lens preferences (wide/normal/tele), depth of field, camera height, movement vocabulary |
| **Framing Preferences** | Rule of thirds, centered, negative space, close-up vs wide ratios, safe zone awareness |
| **Prohibited Visual Inconsistencies** | Explicit "do not drift" rules (e.g., "character eye color must not change," "building layout fixed") |
| **Negative Constraints** | Styles, colors, elements, compositions to avoid |
| **Text / Logo / Brand Constraints** | Typography, logo placement, brand color usage, legal marks if applicable |

---

## C. Character Continuity

When a character recurs across scenes, define:

| Field | Description |
|-------|-------------|
| **Identity / Role** | Who they are in the story (narrator, protagonist, expert, historical figure) |
| **Approximate Age Range** | If relevant to visual depiction |
| **Key Facial / Physical Traits** | Distinguishing features (eyes, hair, build, scars, markings) — only what's needed for recognition |
| **Hairstyle** | Consistent cut, color, styling |
| **Wardrobe** | Signature outfit(s), color palette, accessories |
| **Distinguishing Props** | Objects consistently associated with character |
| **Emotional Baseline** | Default resting expression/energy; how emotions manifest physically |
| **Consistency Notes** | Specific "anchor" details that must never change (e.g., "always wears red watch on left wrist") |

**Privacy**: Do not store sensitive personal data not required for visual consistency.

---

## D. Environment Continuity

When a location recurs:

| Field | Description |
|-------|-------------|
| **Geography / Setting** | Indoor/outdoor, urban/nature, specific venue type |
| **Time of Day** | Morning, golden hour, blue hour, night, artificial |
| **Weather** | Clear, overcast, rain, snow, fog — consistent per scene time |
| **Architecture** | Style, materials, color, layout |
| **Spatial Relationships** | Fixed positions of key elements (door relative to window, desk orientation) |
| **Recurring Props** | Objects that exist in the space across visits |
| **Lighting Consistency** | Window direction, practical light positions, color temperature |

---

## E. Asset-Generation Inheritance

**All image/video asset generation after Visual Bible creation must inherit relevant constraints.**

| Generation Type | Inherits From Visual Bible |
|-----------------|---------------------------|
| AI Image Generation | Style, palette, lighting, character/environment specs, negative constraints |
| AI Video Generation | Motion style, camera language, consistency rules, pacing |
| Code-Generated (Remotion) | Typography, color palette, transition style, framing |
| Stock Footage Selection | Visual mood, palette, lighting, era, style match |

**Explicit Override Required**: If a scene deliberately breaks continuity for narrative reason (flashback, dream sequence, alternate timeline), the override must be **explicitly documented** in the scene plan — never a silent drift.

---

## F. Provenance Boundary

The Visual Bible describes **creative identity only**. It does **not** replace:

- **Rights / Provenance Manifest**: Asset licenses, AI generation provenance, source attribution
- **Policy Review**: Platform policy compliance, brand safety, legal clearance
- **Technical Spec**: Resolution, codec, frame rate, file format (handled by platform profile and video spec)

Visual Bible informs *what it looks like*; provenance/policy/spec govern *what it is and where it can go*.

---

## G. Per-Project Visual Identity (Mandatory)

Visual Bible is **per-project**. Each video production resolves its own Visual Bible based on:
- Resolved topic, niche, platform
- Research brief claim classes and evidence profile
- Content Mode visualLanguage and cameraAndMotionDirection
- Content Mode emotionalArcMode

**Ancient Humans / Historical is NOT global default visual identity.** Visual identity is resolved per project.

---

## H. Historical/Scientific Reconstruction Label/Rule (Mandatory)

For historical, archaeological, paleoanthropological, or scientific reconstruction content:

- **Evidence-backed visuals** (directly supported by `DIRECT_EVIDENCE`/`SUPPORTED_FACT` claims) → no label needed
- **Interpretation visuals** (based on `SCHOLARLY_INTERPRETATION` claims) → MUST be labeled in visual Bible and scene plan as "scholarly interpretation" or "expert reconstruction"
- **Hypothesis/speculative visuals** (based on `HYPOTHESIS` claims) → MUST be labeled "hypothetical reconstruction" or "speculative visualization"
- **AI-generated imagery** → always illustrative unless the AI output itself IS the evidence being discussed

**Rule**: Evidence and reconstruction MUST NOT be conflated in Visual Bible or scene plan. Reconstruction MUST be explicitly labeled in Visual Bible fields and scene plan `animationIntent`/`visualIntent`.

---

## I. Generated Imagery Labeling (Mandatory)

All AI-generated imagery in Visual Bible and asset manifest MUST carry metadata:

| Field | Requirement |
|-------|-------------|
| `generationType` | `AI_IMAGE` \| `AI_VIDEO` \| `CODE_GENERATED` \| `STOCK` |
| `providerId` | Logical provider ID from Provider Layer |
| `modelOrVersion` | Model name/version if known |
| `promptHash` | Hash of prompt used (for reproducibility) |
| `evidenceLink` | Link to research brief claim ID if evidence-backed |
| `label` | `EVIDENCE_BACKED` \| `INTERPRETATION` \| `HYPOTHETICAL` \| `ILLUSTRATIVE` |

**Rule**: Visual Bible MUST distinguish evidence-backed visuals from interpretive/illustrative ones. No generated imagery presented as documentary evidence without evidence link.

---

## J. Evidence and Reconstruction Must Not Be Conflated (Mandatory)

Per `core/RESEARCH_QUALITY.md` and `core/EDITORIAL_VALUE.md`:

- Visual Bible fields (`visualStyle`, `lighting`, `environment`, etc.) for evidence-backed content MUST trace to `DIRECT_EVIDENCE`/`SUPPORTED_FACT` claims
- Visual Bible fields for reconstructions MUST trace to `SCHOLARLY_INTERPRETATION`/`HYPOTHESIS` claims with explicit label
- Scene plan `visualIntent`/`animationIntent` for reconstruction scenes MUST include label: "RECONSTRUCTION: scholarly interpretation" or "RECONSTRUCTION: hypothetical"
- **Never present speculative AI imagery as documentary evidence** in Visual Bible, scene plan, or asset manifest

---

## K. Provenance Boundary

The Visual Bible describes **creative identity only**. It does **not** replace:

- **Rights / Provenance Manifest**: Asset licenses, AI generation provenance, source attribution
- **Policy Review**: Platform policy compliance, brand safety, legal clearance
- **Technical Spec**: Resolution, codec, frame rate, file format (handled by platform profile and video spec)

Visual Bible informs *what it looks like*; provenance/policy/spec govern *what it is and where it can go*.

---

## L. Continuity Registry Boundary (STEP 10A)

**Visual Bible owns**: overall visual language, world/era, style, camera
language, color/lighting direction.

**Continuity Registry (`core/CONTINUITY.md`, `continuity-registry.json`) owns**:
recurring entity identity, wardrobe, prop, location identity, locked reference
assets.

The Visual Bible references recurring entities by ID; it does NOT duplicate the
full registry. A Visual Bible alone is never sufficient to guarantee recurring
identity — LOCKED references are required before STRICT scene generation.