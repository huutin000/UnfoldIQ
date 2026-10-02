# UNFOLDIQ Duration Planning (STEP 10A-FIX)

Duration is a planning constraint, not an instruction to manufacture content.
A user request for 8–12 minutes means a **target range**, never
"force exactly 10:00 regardless of content".

```text
USER TARGET + RESEARCH CAPACITY + CONTENT MODE / PLATFORM
    ↓ DURATION PLANNER ↓ WORKING DURATION ↓ SCRIPT BUDGET
    ↓ SCENE / VISUAL PLAN ↓ MEASURED AUDIO / TIMELINE ↓ ACTUAL FINAL DURATION
```

## Duration Modes

- `AUTO` — no user target; planner derives a recommended range from research
  capacity, content mode, platform, editorial value, and topic complexity.
- `FLEXIBLE_TARGET` — default when the user gives a range (e.g. 8–12 min):
  try to fit, no filler, no unsupported expansion; the final may fall outside
  the range when content quality requires it (with documented resolution).
- `APPROXIMATE_TARGET` — e.g. "khoảng 10 phút": `preferredMs` ±
  `tolerancePercent`; exact seconds never required.
- `HARD_LIMIT` — only when a platform/business constraint imposes a real
  maximum (e.g. 60s). May force prioritization/cutting, never fabricated facts
  or artificial speed.

## Content Capacity

`contentCapacity` = how much evidence-backed, editorially useful material the
research can support (`INSUFFICIENT` / `SUFFICIENT` / `OVER_CAPACITY` /
`UNCERTAIN`), with `recommendedMinMs`/`recommendedMaxMs`, a `basis`, and
`coverage`. Capacity is NEVER raw search volume: not source count, token
count, result count, or fact count alone. Meaningful units: core claims,
causal mechanisms, evidence walkthroughs, cases/sites/examples, comparisons,
context/timelines, uncertainties, implications, counterintuitive insights,
visual explanation opportunities.

- `INSUFFICIENT` → do not pad; expand research with valid adjacent
  sub-questions, broaden scope only if aligned with the core promise, else ship
  shorter.
- `OVER_CAPACITY` → prioritize core promise → must-know evidence → strongest
  mechanism → strongest example → necessary context; cut tangents, defer
  secondary examples, optionally recommend Part 2; never unnatural speed.
- `UNCERTAIN` → research incomplete; no FIT claim allowed.

Scope expansion (`allowScopeExpansion`) is valid only when it answers the same
audience question, has (or can get) evidence, adds editorial value, and is not
filler.

## Script Budget & Speaking Rate

`scriptBudget` carries word estimates, `estimatedNarrationMs`,
`speakingRateAssumption` + `rateSource`, and `timingStatus`
(`PLANNED`/`MEASURED`). Word rate is planning only — never "N words = exact
duration"; measured TTS/narration timing becomes authoritative later. No single
global WPM: content-mode defaults apply (documentary/explainer ~140–160,
tutorial ~130–150, meditation ~90–110, energetic short-form ~160–180), always
natural for the mode. If the target needs unnatural speech, the conflict stays
unresolved.

## Three Durations (never collapsed)

- **TARGET** — what user/platform/planner wants.
- **ESTIMATED** — calculated from script/narration assumptions.
- **ACTUAL** — measured from the final timeline.

## Timeline End & No Black Tail

```text
actualTimelineEndMs = max(narrationEndMs, visualEndMs, captionsEndMs,
                          intentionalOutroEndMs, intentionalMusicTailEndMs)
```

Intentional outro/music tails need an explicit timeline item with a content
purpose and bounded duration. Anonymous padding (black/silent tail to reach a
target) is rejected by executable validation. The final Remotion duration
derives from the actual timeline end — never forced to the requested duration.

## Scene & AI-Video Boundaries

Scene duration comes from script beat, information density, visual type,
narration timing, comprehension needs, and motion requirements — never
`target / fixedSceneLength`. AI-video clip duration ≠ scene duration: a
10-minute video does NOT imply 10 minutes of Veo; stills, pans/zooms,
parallax, maps, diagrams, text, evidence imagery, and Remotion animation cover
the rest. The planner never drives unnecessary AI-video generation.

## Platform Guidance (dynamic, not eternal truth)

YouTube currently states no universal ideal video length — choose the length
needed to deliver value, avoid filler, don't stretch artificially
(`https://support.google.com/youtube/answer/16559651`), with retention
analytics (`.../answer/9314415`, `.../answer/141805`). Treat as dynamic
guidance; official sources override cached rules.

Executable rules live in `lib/duration-check.js`; deterministic planning in
`lib/duration-planner.js`; contract in `schemas/duration-contract.schema.json`.
Per-project file: `projects/<projectId>/planning/duration-contract.json`.
