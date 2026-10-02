# UNFOLDIQ Core Creative Direction

## A. Global Creative Direction

Before any asset generation or Remotion build, agent must establish a unified creative direction for the entire video. Minimum components:

| Component | Description |
|-----------|-------------|
| **Overall Tone** | The video's personality (e.g., authoritative, conversational, cinematic, intimate, energetic, contemplative) |
| **Narrative Energy** | How the story drives forward (e.g., steady build, punchy segments, meandering exploration, urgent pace) |
| **Pacing Philosophy** | Default rhythm: when to linger, when to cut fast, breathing room between beats |
| **Visual Mood** | Color temperature, contrast feel, lighting atmosphere (e.g., warm golden hour, cool clinical, high-contrast noir, soft pastel) |
| **Motion Style** | Camera behavior: static/locked, slow dolly, handheld energy, snap zooms, kinetic typography, abstract transitions |
| **Voice Delivery Direction** | How narration should be performed: pace, emphasis patterns, breath, intimacy vs projection, emotional coloring |
| **Music Direction** | Genre, instrumentation, emotional function (support vs lead), energy curve across the video |
| **SFX Philosophy** | When and how sound effects serve story: punctuation, immersion, humor, tension, transition |
| **Transition Philosophy** | How scenes connect: hard cuts, crossfades, match cuts, morphs, graphic wipes, audio-led transitions |
| **Typography / On-Screen Text Direction** | Font personality, hierarchy, animation style, color, positioning philosophy |

**No provider/tool hardcoding**: Direction describes creative intent, not specific AI prompts or tool parameters.

---

## B. Emotional Arc

For videos with storytelling, agent must define an emotional arc mapping segments to emotional states.

### Per-Segment Emotional Mapping

Each segment/beat may specify:

| Field | Description |
|-------|-------------|
| **Primary Emotion** | The dominant feeling (see vocabulary below) |
| **Secondary Emotion** (optional) | Supporting or contrasting feeling |
| **Intensity** | Low / Medium / High / Peak |
| **Trajectory** | Rising / Falling / Stable / Spike / Release |
| **Narrative Reason** | Why this emotion at this moment (story justification) |

### Suggested Emotion Vocabulary

Not an exhaustive enum — agent selects appropriate terms:

- suspense, tension, fear
- curiosity, surprise
- relief, warmth, joy
- awe, wonder
- sadness, melancholy
- urgency, drive
- reflection, contemplation
- triumph, resolution
- confusion → clarity
- boredom → engagement (deliberate contrast)

**Anti-generic rule**: "Suspense" does not always mean "heartbeat sound + dark zoom." The specific expression must fit the story context.

---

## C. Cross-Modal Consistency

The Creative Direction is the **single source of truth** for all downstream modalities. Every stage must align:

| Modality | Must Align With Creative Direction |
|----------|-----------------------------------|
| Narration delivery | Tone, pace, emphasis, emotional coloring |
| Image/Video prompt direction | Visual mood, lighting, composition style, color palette |
| Camera / Motion intent | Motion style, pacing, transition philosophy |
| Music mood | Music direction, emotional arc intensity |
| SFX | SFX philosophy, transition punctuation |
| Editing pace | Pacing philosophy, narrative energy |
| Transition intensity | Transition philosophy, emotional trajectory |
| Typography / On-screen text | Typography direction, visual mood |

**No independent mood selection**: Downstream tools/stages do not choose their own creative direction. They inherit from the established Creative Direction.

---

## D. Anti-Template Rule

**Do not map emotions to rigid presets.**

| ❌ Forbidden | ✅ Required |
|--------------|-------------|
| `suspense = heartbeat SFX + slow zoom + dark filter` (every time) | `suspense` expressed via context-appropriate variation: silence + close-up, or dissonant chord + rapid cuts, or held breath + wide isolation |
| `joy = upbeat music + bright colors + fast cuts` (every time) | `joy` expressed via context: quiet smile + warm light, or energetic dance + saturated palette, or shared laugh + intimate framing |
| `curiosity = question mark animation + whoosh sound` (every time) | `curiosity` via: extreme close-up reveal, or audio drop + visual puzzle, or narrator lean-in + tilt |

**Goal**: Avoid repetitive, mass-produced feel. Variation must serve the specific story and visual bible.

---

## E. Platform Relationship

- **Core Creative Direction is platform-neutral**. It defines story meaning and creative identity.
- **Platform profiles** (`platforms/<platform>/PROFILE.yaml`) provide presentation constraints: aspect ratio, safe zones, duration limits, technical specs.
- **Platform constraints may override presentation** (e.g., vertical crop for TikTok) but **must not change core story meaning** unless user explicitly requests a platform-specific adaptation.
- Creative Direction is established *before* platform constraints are applied to presentation layer.

---

## F. Content Mode Upstream (Mandatory)

Creative Direction **consumes Content Mode** (`content-mode.json` from Stage 3C) as upstream input:

- All direction fields (visualLanguage, cameraAndMotionDirection, voiceDirection, musicDirection, sfxDirection, pacingDirection, transitionDirection, typographyDirection, captionDirection) **inherit from Content Mode** and refine for execution
- `emotionalArcMode` from Content Mode (`STRONG`/`LIGHT`/`MINIMAL`/`ADAPTIVE`) **constrains** emotional arc design
- Content Mode rationale and storyApproach inform Creative Direction rationale
- Creative Direction refines Content Mode directions for execution (e.g., "measured pacing" → specific frame counts)

---

## G. Research Confidence Constrains Dramatic Treatment (Mandatory)

Creative Direction **consumes Research Brief** (`research-brief.json` from Stage 3B):

- **Claim classes constrain dramatic treatment**:
  - `DIRECT_EVIDENCE` / `SUPPORTED_FACT` → full dramatic treatment allowed
  - `SCHOLARLY_INTERPRETATION` → dramatic treatment allowed with visual/audio cues signaling interpretation (e.g., visual label "reconstruction")
  - `HYPOTHESIS` / `CONTESTED` → **MUST NOT** receive visual/audio treatment that falsely signals certainty (no dramatic music swell on hypothesis, no "definitive" visual language on contested claim)
  - `UNVERIFIED` → no dramatic treatment; present as open question only

- **Caveats from research brief** (`handoff.materialUncertainties`) constrain Creative Direction:
  - If `materialUncertainties` includes "no direct evidence for X", Creative Direction must not create definitive visual sequence for X
  - Uncertainty must be reflected in visual/audio treatment (e.g., lower confidence → less definitive visual language)

---

## H. Emotional Arc Adapts to Content Type (Mandatory)

Emotional Arc **adapts to Content Mode** (`emotionalArcMode` from Content Mode):

| Content Type / `emotionalArcMode` | Arc Pattern |
|-----------------------------------|-------------|
| Historical storytelling / `STRONG` | curiosity → suspense → discovery → awe/warmth |
| Technical tutorial / `LIGHT` | problem → clarity → demo → resolution |
| News explainer / `LIGHT`/`MINIMAL` | context → facts → implications |
| Meditation / `MINIMAL`/`ADAPTIVE` | stable → gentle deepening → integration |
| Product review / `LIGHT` | expectation → evidence → verdict |
| Comparison / `LIGHT` | criteria → evidence → verdict |
| Storytelling/fiction / `STRONG` | hook → tension → escalation → payoff |
| Custom / `ADAPTIVE` | Arc adapts per segment based on evidence class (hypothesis→light, fact→strong) |

**Rule**: Do NOT force `STRONG` cinematic arc on technical, news, or meditation content. Emotional Arc MUST serve content type and evidence profile.

---

## I. Anti-Template Rule

**Do not map emotions to rigid presets.**

| ❌ Forbidden | ✅ Required |
|--------------|-------------|
| `suspense = heartbeat SFX + slow zoom + dark filter` (every time) | `suspense` expressed via context-appropriate variation: silence + close-up, or dissonant chord + rapid cuts, or held breath + wide isolation |
| `joy = upbeat music + bright colors + fast cuts` (every time) | `joy` expressed via context: quiet smile + warm light, or energetic dance + saturated palette, or shared laugh + intimate framing |
| `curiosity = question mark animation + whoosh sound` (every time) | `curiosity` via: extreme close-up reveal, or audio drop + visual puzzle, or narrator lean-in + tilt |

**Goal**: Avoid repetitive, mass-produced feel. Variation must serve the specific story and visual bible.

---

## J. Platform Relationship

- **Core Creative Direction is platform-neutral**. It defines story meaning and creative identity.
- **Platform profiles** (`platforms/<platform>/PROFILE.yaml`) provide presentation constraints: aspect ratio, safe zones, duration limits, technical specs.
- **Platform constraints may override presentation** (e.g., vertical crop for TikTok) but **must not change core story meaning** unless user explicitly requests a platform-specific adaptation.
- Creative Direction is established *before* platform constraints are applied to presentation layer.