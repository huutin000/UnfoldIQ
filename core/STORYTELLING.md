# UNFOLDIQ Core Storytelling Rules

## A. Input

A valid story/script request requires at minimum:

- **Platform**: resolved platform identifier (from `platforms/INDEX.md`)
- **Topic**: the subject matter (resolved/selected via Topic Discovery or user-provided)
- **Research Brief**: `research-brief.json` with claims, sources, claim classes, caveats, handoff (from Stage 3B)
- **Content Mode**: `content-mode.json` with modeId, directions, emotionalArcMode (from Stage 3C)
- **Editorial Strategy**: `editorial-strategy.json` with value types, example policy, insight chains (from Stage 3D)
- **Duration Contract**: `duration-contract.json` with working duration + script budget (from Duration Planning Gate)
- **User Constraints**: optional explicit guidance (tone, length, format, audience, constraints)
- **Platform Profile**: loaded technical defaults from `platforms/<platform>/PROFILE.yaml`

## B. Research Gate
- **Content Class routing (ROADMAP V5):** `FACTUAL → Research Pack + Evidence Gate mandatory`. `HYBRID → Research Pack with FACT/FOLKLORE/TESTIMONY/SPECULATION/FICTIONALIZED_ELEMENT labels preserved`. `FICTION → Story Bible + Character Bible + World Bible + Plot Beats + optional targeted Research Pack; no fake citations for fictional events`.
- **Factual/Current/Historical/Scientific/Real-Person content**: Must use appropriate evidence when capability allows. Every critical claim must be verifiable or explicitly marked.
- **No Fabrication**: Do not invent facts, quotes, statistics, sources, retention rates, or performance metrics.
- **Unverifiable Critical Claims**: If a critical claim cannot be verified, use `NOT VERIFIED` status or rephrase to avoid presenting inference as fact.
- **Creative/Fictional Content**: May skip full research gate if no factual verification is needed. Still must maintain internal consistency.
- **Claim Class Compliance**: Script MUST respect claim classes from research brief:
  - `DIRECT_EVIDENCE` / `SUPPORTED_FACT` → `CAN_STATE` (state as fact)
  - `SCHOLARLY_INTERPRETATION` / `HYPOTHESIS` / `CONTESTED` → `STATE_WITH_CAVEAT` (include verbal/visual caveat)
  - `UNVERIFIED` → `DO_NOT_STATE_AS_FACT` (must not present as fact; may appear as hypothesis/scenario only)
- **Caveat Preservation**: Material caveats from research brief MUST be preserved in script; do not flatten uncertainty.

## C. Story Structure

Core storytelling supports at minimum these structural elements. Not every video uses all elements; the structure adapts to topic and platform.

| Element | Purpose |
|---------|---------|
| **Hook / Opening** | Capture attention in first 3 seconds; establish premise or question |
| **Promise / Question / Tension** | Create a narrative contract with the viewer: "Here is what you will learn/experience" |
| **Development / Progression** | Deliver on the promise through logical progression, evidence, or narrative beats |
| **Escalation or Discovery** | Raise stakes, deepen insight, or reveal new dimension |
| **Payoff** | Resolve the tension/promise; deliver the core value |
| **Closing / Reflection / CTA** | Synthesize, leave lasting impression, optional call-to-action if appropriate |

**No rigid formula**: Not every video requires all elements in fixed order. Agent selects and arranges elements appropriate to the topic and platform constraints.

**No platform-specific timing hardcoded**: Stage 2 (Resolve Platform) provides duration/format constraints; storytelling adapts to them.

## D. Script Quality Rules

| Rule | Description |
|------|-------------|
| **Natural Narration** | Dialogue and voiceover must sound human, conversational, not robotic or template-driven |
| **Scene Purpose** | Every scene/beat must have a clear narrative purpose; no filler |
| **No Abandoned Loops** | Every open question, tension, or promise must be paid off |
| **No Unnecessary Intro Length** | Get to the promise quickly; avoid extended preambles |
| **No Repetition** | Do not repeat information unless for deliberate reinforcement |
| **Promise ↔ Payoff Consistency** | What is promised in the hook must be delivered in the payoff |
| **CTA Optional** | Call-to-action only when contextually appropriate; never forced |
| **No Publish Metadata in Narration** | Do not embed "subscribe," "link in description," or platform mechanics into the story content |
| **No Clickbait / Misleading Claims** | Hook must be honest to the actual content; no bait-and-switch |

## E. Editorial Value Transformation (Mandatory)

### Beyond-Search Value Gate

Before script is ready, agent MUST answer:

> "What does the viewer receive from this video that they could NOT get by reading search results / Wikipedia in 30 seconds?"

Script must deliver at least one value type appropriate to topic/mode/evidence:
- `causal_explanation` — why something happens; mechanism, not just correlation
- `mechanism` — how something works step-by-step
- `synthesis` — integrating multiple sources into coherent picture
- `evidence_walkthrough` — walking through specific evidence
- `case_example` — concrete case illuminating general principle
- `comparison` — structured comparison across cases/theories
- `misconception_correction` — "Commonly believed X, but evidence shows Y because..."
- `timeline_context` — placing events in chronological/conceptual context
- `expert_interpretation` — scholarly interpretation with evidence base and caveats
- `implication` — "This discovery changes understanding of X because..."
- `visual_demonstration` — showing rather than telling
- `human_stakes` — why this matters to human experience
- `counterintuitive_insight` — "Contrary to intuition, X because Y"
- `structured_decision_framework` — framework for viewer to evaluate similar claims
- `practical_demonstration` — showing how to do/apply something

### Research Summary Is NOT a Script

**Forbidden Pattern:**
```
Fact 1.
Fact 2.
Fact 3.
Researchers say X.
Researchers say Y.
Conclusion.
```

If script primarily paraphrases research in source order → `REVISE`

**Storytelling MUST reorganize by viewer question → evidence → explanation → payoff**, not source order.

### Conditional Example Policy

Examples/cases/demos are **OPTIONAL**. Agent must decide:

> "Would a concrete example materially improve: comprehension, credibility, visualization, emotional connection, practical usefulness?"

- If YES and verified example exists → include
- If YES but no verified example → seek evidence / use labeled hypothetical (`SCENARIO` type) / omit
- If NO → do not force example
- **NEVER invent factual examples**

### Domain-Aware Examples

- **Historical/Archaeological**: specific site, artifact, fossil, footprint, dated find; explain: what found, what it tells us, what it CANNOT tell us, why it matters
- **Technical/React**: minimal code demo, browser behavior, performance trace, bug/fix, data flow diagram
- **News**: timeline, documented event, official statement, key data point, prior event comparison
- **Meditation**: factual examples often not needed; experience itself is value

### Viewer Knowledge Calibration

Avoid extremes:
- **Too shallow**: explaining obvious searchable facts
- **Too expert**: jargon/assumptions losing target audience

Adapt depth by: target audience, content mode, platform, duration, topic complexity.

## F. Insight Chain (Per Major Section/Beat)

Each major section SHOULD follow:

```
Viewer Question / Hook
    ↓
Evidence (what was found/measured)
    ↓
Explanation / Mechanism (why/how)
    ↓
Optional Concrete Example (if improves value)
    ↓
Meaning / Implication / Payoff (why it matters)
    ↓
Next Question / Transition
```

Not every scene needs all 6 elements. But a section MUST NOT exist only to fill duration.

## G. Engagement Without Distortion (Mandatory)

**Interesting ≠ Distortion.** FORBIDDEN to manufacture engagement:

| Forbidden | Why |
|-----------|-----|
| Exaggeration | Inflates certainty/impact beyond evidence |
| Fake suspense | "What they found next will shock you..." when outcome known |
| Invented stakes | "If they failed, humanity would go extinct" (unless evidence supports) |
| False certainty | Presenting hypothesis/interpretation as established fact |
| Sensational wording | "Secret," "Hidden," "Shocking" without evidence |
| Clickbait hooks | Promise not delivered in content |

**Rule**: If most accurate version is less dramatic than fabricated version → choose accurate version.

Hook/storytelling MUST remain faithful to evidence and claim classes.

## H. "AI Reading Research" Smell Checks (Script REVISE Triggers)

Script MUST be revised if exhibiting:

| Smell | Description |
|-------|-------------|
| Generic encyclopedia cadence | Uniform rhythm, no variation in sentence structure/energy |
| Repeated "research shows/experts say" without explaining | Authority appeal without substance |
| Sequence of disconnected facts | Fact A. Fact B. Fact C. No connective tissue |
| No mechanism/causal explanation when topic demands it | "X happened" without "because Y" |
| No concrete nouns/details despite verified evidence | "Ancient tools were made" vs "Flint handaxes with bifacial flaking" |
| Every paragraph same rhythm/cadence | Monotone delivery pattern |
| No audience question/payoff structure | Information dump without question→payoff |
| Source-order narration | "Study A found X. Study B found Y. Study C found Z." |
| Unnecessary adjectives replacing insight | "Amazing discovery reveals..." instead of "Cut marks on femur indicate..." |
| Fake rhetorical questions | "But what does this mean? [immediate answer]" without genuine tension |
| Repetition to pad duration | Repeating same point in different words |

These are smell checks, not rigid formulas. Multiple smells = strong `REVISE` signal.

## I. Script Handoff Readiness Checklist

Before script is `READY` for Creative Direction:

- [ ] Research brief is `READY` (or `PARTIAL` with documented caveats)
- [ ] Content mode resolved and validated
- [ ] Script delivers at least one Beyond-Search value type
- [ ] Script structure follows viewer question → evidence → explanation → payoff
- [ ] No forbidden patterns (see Smell Checks)
- [ ] Claim classes respected: no `UNVERIFIED`/`HYPOTHESIS` stated as fact
- [ ] Caveats preserved where material
- [ ] Examples conditional, labeled, evidence-linked
- [ ] Engagement earned through insight, not distortion
- [ ] Viewer knowledge calibrated for target audience/mode/platform
- [ ] Each major section has clear viewer value/purpose

## I2. Duration Adherence (STEP 10A-FIX)

- Script MUST honor the working duration from `duration-contract.json`; fit the working range, not arbitrary raw user seconds.
- Do NOT pad to reach a target (no filler, no unsupported expansion, no artificial speed/slowness).
- Do NOT remove core evidence solely to hit an arbitrary target.
- If an unresolved duration conflict exists (`SCRIPT_ESTIMATE_CONFLICT` or non-FIT status without documented resolution), Story + Script cannot claim READY.
- Narration density must match the content mode (speaking pace, pause density, information density per `core/DURATION_PLANNING.md`).

## J. Scene Handoff Contract (Editorial Level)

Each scene/beat in the script must provide at minimum:

| Field | Description |
|-------|-------------|
| `sceneId` | Unique identifier for the scene |
| `purpose` | Narrative function (e.g., "establish premise," "present evidence," "emotional peak") |
| `narration` | Voiceover/dialogue text for this scene |
| `visualIntent` | Creative description of what should be shown (composition, action, focus) |
| `onScreenText` | Text overlays, captions, or key phrases to display (if any) |
| `evidenceNotes` | Citations, source references, or verification status for factual claims in this scene |
| `emotionIntent` | Primary emotion this scene should evoke (links to Creative Direction emotional arc) |
| `transitionIntent` | How this scene flows to the next (creative transition idea, not technical spec) |
| `assetRequirement` | What assets needed: generated image/video, stock footage, chart, text overlay, diagram |
| `audioCue` | Music shift, SFX, silence, or voice emphasis points (if relevant) |
| `claimIds` | Research brief claim IDs referenced in this scene (for traceability) |
| `exampleIds` | Research brief example IDs used in this scene (for traceability) |

**Note**: This is an editorial contract defined in prose/Markdown. JSON schema implementation is deferred to a later step.