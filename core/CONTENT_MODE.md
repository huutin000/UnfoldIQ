# UNFOLDIQ Content Mode / Genre Resolver

## Core Principles

- **Ancient Humans is NOT the default style.** UNFOLDIQ does not default every niche to cinematic historical storytelling.
- **Content Mode is resolved per project/video.** Each video production resolves its own mode based on topic, niche, platform, and user intent.
- **Core rules are niche-neutral.** The same validation, quality, and editorial rules apply regardless of mode.
- **User explicit creative direction overrides inferred mode** when technically feasible.
- **Content Mode is provider-agnostic.** It describes creative intent, not provider parameters.
- **No closed enum for mode IDs.** Agent may create custom modes when justified by topic and evidence.
- **Content Mode ≠ Platform Profile.** Platform profile defines technical constraints (aspect ratio, duration limits, safe zones). Content Mode defines creative approach.

---

## Content Class (ROADMAP V5 — PRE-FLIGHT)

Canonical V5 model (backward compatible — `modeId` unchanged):

```text
contentClass = FACTUAL | FICTION | HYBRID
contentMode  = domain / genre / treatment mode (this file's modeId)
```

| contentClass | Research default | Examples |
|---|---|---|
| `FACTUAL` | `researchRequired = true`, Evidence Gate mandatory | `historical-documentary`, `news-explainer`, `technical-explainer` |
| `FICTION` | `researchRequired = false`; `OPTIONAL_TARGETED` only for real-world accuracy subset | `cinematic-fiction`, `horror-fiction` |
| `HYBRID` | `REQUIRED` for real-world/folklore/testimony basis; labels preserved | `urban-legend-documentary` |

HYBRID labels (must be preserved, never silently promoted):

```text
FACT | FOLKLORE | TESTIMONY | SPECULATION | FICTIONALIZED_ELEMENT
```

Forbidden: `FOLKLORE → FACT`, `TESTIMONY → VERIFIED FACT`, `SPECULATION → CERTAINTY`.

Schema: `schemas/content-mode.schema.json` carries optional `contentClass`
(default `FACTUAL` for backward compatibility). Consumers must not rename
`modeId` — add `contentClass` alongside it (migration version `1.1.0`).

---

## Inputs to Mode Resolution

Minimum inputs:

- **Resolved/Selected Topic** — the final topic string
- **Optional Niche** — the niche provided by user (if Mode B input)
- **Target Platform** — youtube | tiktok (from platform resolution)
- **Audience** — if known (e.g., general, technical, academic, kids)
- **Research/Evidence** — from research-brief.json (claim classes, evidence strength)
- **User Intent** — explicit creative constraints (e.g., "make it cinematic", "keep it minimal")
- **Production Constraints** — budget, timeline, capability limits, rights restrictions

---

## Suggested Mode Examples (Not Closed Enum)

Agent may use these or create custom modes when justified:

| Mode ID | Label | Typical Use |
|---------|-------|-------------|
| `historical-documentary` | Historical Documentary | Evidence-driven narrative, archaeological/historical visual language, curiosity/suspense/awe when justified |
| `technical-explainer` | Technical Explainer | Problem → explanation → demonstration → resolution; code/browser/diagram visuals; instructional voice |
| `tutorial` | Tutorial / How-To | Step-by-step guided learning; screen recording, diagrams, minimal fluff |
| `educational-explainer` | Educational Explainer | Concept explanation with analogies, visual metaphors, structured learning |
| `news-explainer` | News Explainer | Context → verified facts → implications; neutral/evidence-led voice; restrained emotion |
| `product-review` | Product Review | Hands-on evaluation, pros/cons, comparison, verdict |
| `comparison` | Comparison | A vs B across criteria; structured framework; decision aid |
| `listicle` | Listicle / Countdown | Numbered items; clear ranking logic; fast pacing |
| `storytelling` | Narrative Storytelling | Character-driven, emotional arc, tension → payoff |
| `comedy` | Comedy / Satire | Humor-driven; exaggeration for effect; timing-dependent |
| `meditation-guided` | Guided Meditation | Calm structure; slow pacing; gentle motion; warm voice; ambient audio |
| `cinematic-fiction` | Cinematic Fiction | Narrative fiction; dramatic visual language; emotional arc STRONG |
| `commentary` | Commentary / Opinion | Creator perspective; argument + evidence; conversational |
| `data-explainer` | Data Explainer | Charts, stats, trends; visual data storytelling; neutral narration |

**Agent may create custom mode IDs** when topic/evidence justifies a distinct creative approach not covered above. Custom modes must include all required direction fields.

---

## Content Mode Output

A resolved Content Mode produces `content-mode.json` with:

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `modeId` | string | Mode identifier (from suggested list or custom) |
| `modeLabel` | string | Human-readable label |
| `rationale` | string | Why this mode fits topic/niche/platform/evidence |
| `storyApproach` | string | How narrative is structured (e.g., "evidence → explanation → implication") |
| `hookApproach` | string | How to open (e.g., "question → visual evidence → promise") |
| `visualLanguage` | string | Visual style description (color, composition, era accuracy, graphics style) |
| `cameraAndMotionDirection` | string | Camera behavior (static, dolly, handheld, snap zoom, kinetic type, abstract) |
| `voiceDirection` | string | Voice delivery (pace, emphasis, intimacy vs projection, emotional coloring) |
| `musicDirection` | string | Genre, instrumentation, emotional function (support vs lead), energy curve |
| `sfxDirection` | string | When/how SFX serve story (punctuation, immersion, humor, tension, transition) |
| `pacingDirection` | string | Default rhythm (when to linger, when to cut fast, breathing room) |
| `transitionDirection` | string | How scenes connect (hard cuts, crossfades, match cuts, morphs, audio-led) |
| `typographyDirection` | string | Font personality, hierarchy, animation style, color, positioning |
| `captionDirection` | string | Caption style (burn-in vs separate, position, max lines, visual style) |
| `emotionalArcMode` | enum | `STRONG` \| `LIGHT` \| `MINIMAL` \| `ADAPTIVE` |
| `constraints` | object | Optional: hard limits (e.g., "no dramatic reconstruction", "voice-only segments") |

### `emotionalArcMode` Values

| Value | Description |
|-------|-------------|
| `STRONG` | Full emotional arc: tension → release → curiosity → payoff → awe/warmth |
| `LIGHT` | Gentle emotional shaping; subtle emphasis; no dramatic peaks |
| `MINIMAL` | Near-neutral delivery; functional tone; emotion via content not performance |
| `ADAPTIVE` | Arc adapts per segment based on evidence class (hypothesis→light, fact→strong) |

---

## Required Behavior Examples

### Historical / Ancient Humans
- Evidence-driven narrative; historical/archaeological visual language
- Curiosity/suspense/awe **when justified by evidence**
- Documentary delivery; period/environment audio when appropriate
- **Visual reconstruction clearly labeled** as interpretation vs evidence

### Technical / React / Frontend
- Problem → explanation → demonstration → resolution
- Browser/code/diagram/motion graphics
- Instructional voice; subtle/optional music
- Restrained SFX; emotional arc `LIGHT` or `MINIMAL`

### News Explainer
- Context → verified facts → implications
- Neutral/evidence-led voice; restrained emotion
- Avoid sensationalism; `emotionalArcMode`: `LIGHT` or `MINIMAL`

### Meditation / Guided
- Calm guided structure; slow pacing
- Gentle motion; warm/stable voice; ambient audio
- Few hard cuts; `emotionalArcMode`: `MINIMAL` or `ADAPTIVE`
- `pacingDirection`: slow, breathing room between segments

### Product Review
- Hands-on evaluation → pros/cons → comparison → verdict
- Honest assessment; `emotionalArcMode`: `LIGHT`
- Visual: product shots, comparison graphics, real usage footage

---

## Cross-Modal Propagation

```
Content Mode
   ↓
Research interpretation (which claims get emphasis, how caveats are framed)
   ↓
Storytelling (narrative structure, hook, pacing, example selection)
   ↓
Creative Direction (visual mood, emotional arc, music, SFX, voice)
   ↓
Visual Bible (visual language, reconstruction labeling, color palette)
   ↓
Scene Plan (shot composition, camera, animation, asset prompts)
   ↓
Asset prompts (image/video generation aligned with visual language)
   ↓
Voice / Music / SFX (aligned with direction fields)
   ↓
Remotion editing (pacing, transitions, typography, captions per direction)
```

**No independent mood selection.** Downstream stages inherit from Content Mode. If a downstream stage needs to deviate, it must document rationale.

---

## Emotional Arc Conditional (Mandatory)

**Do NOT apply a universal arc template.**

| Content Type | Arc Pattern |
|--------------|-------------|
| Historical storytelling | `STRONG`: curiosity → suspense → discovery → awe/warmth |
| Technical tutorial | `LIGHT`: problem → clarity → demo → resolution |
| News explainer | `LIGHT`/`MINIMAL`: context → facts → implications |
| Meditation | `MINIMAL`/`ADAPTIVE`: stable → gentle deepening → integration |
| Product review | `LIGHT`: expectation → evidence → verdict |
| Comparison | `LIGHT`: criteria → evidence → verdict |
| Storytelling/fiction | `STRONG`: hook → tension → escalation → payoff |

**Rule:** Agent must select `emotionalArcMode` appropriate to mode and evidence. Do NOT force `STRONG` cinematic arc on technical, news, or meditation content.

---

## Duration & Pacing Influence (STEP 10A-FIX)

Content Mode may influence duration planning, but MUST NOT define a global fixed duration:

- **Speaking pace** — mode-appropriate narration rate (see `core/DURATION_PLANNING.md` defaults).
- **Pause density** — breathing room between beats (meditation high, short-form low).
- **Visual dwell time** — how long evidence/code/diagrams stay on screen.
- **Scene rhythm** — expected beat length and transition cadence.
- **Information density** — words-per-minute of real content the mode sustains.

The Duration Planner consumes these as pacing inputs; the mode never outputs a fixed second count.

---

## Mode Resolution Algorithm (Deterministic)

1. **Explicit user mode** → Use if provided and technically feasible
2. **Topic keywords** → Map to likely modes (e.g., "how to" → tutorial, "review" → product-review, "history of" → historical-documentary)
3. **Niche patterns** → Default mode for niche (configurable in future; no hardcoded defaults)
4. **Platform norms** → TikTok favors faster pacing, visual hooks; YouTube allows longer exposition
5. **Evidence profile** → High `DIRECT_EVIDENCE`/`SUPPORTED_FACT` → documentary; high `HYPOTHESIS` → speculative/exploratory
6. **User constraints** → Override any inferred choice

Output must include `rationale` explaining the resolution path.