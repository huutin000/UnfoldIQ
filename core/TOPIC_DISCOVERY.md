# UNFOLDIQ Topic Discovery + Idea Validation

## A. Evidence Hierarchy

Priority order for evidence:

1. Official/current platform discovery surfaces when agent actually has access
2. Direct platform/search/video/channel evidence
3. User-provided reference/channel data
4. Transparent search/trend tools
4. Competitor/public web evidence
5. Inference

Every material signal must be classified as:

- `FACT`
- `INFERENCE`
- `RECOMMENDATION`

Do NOT fabricate:

- search volume
- CTR
- retention
- RPM
- view potential
- virality
- audience size
- trend status

If a claim depends on current data but agent lacks live access:

`NOT VERIFIED — NO LIVE ACCESS`

---

## B. Official Discovery Sources

### YouTube

Official source: `https://support.google.com/youtubecreatorstudio/answer/11962757`

When capability/data truly available, may use signals such as:

- Top searches
- Breakout videos
- Recent videos
- Audience interest
- Searched on YouTube
- content gaps / content gaps for Shorts

Do NOT assume every insight always available for every account/country/language/device.

### TikTok

Official source: `https://newsroom.tiktok.com/creator-search-insights`

When capability/data truly available, may use:

- topics people search for
- search-driven content opportunities
- content gap signals
- audience/search interest

Do NOT assume Creator Search Insights available for every account/region.

### General Web

May use for:

- finding recurring questions
- checking factual/current relevance
- finding competitor/reference content
- detecting stale/overused angles

Web popularity does NOT automatically equal platform demand.

---

## C. Topic Discovery Process

```
Niche
  ↓
Research signals
  ↓
Audience questions / recurring themes
  ↓
Content gaps / underserved angles
  ↓
Candidate topics
  ↓
TOPIC REGISTRY CHECK
  ↓
Idea Validation
  ↓
Selected Topic
```

Minimum analysis:

### Niche Snapshot
- recurring themes
- audience intent
- common questions
- dominant formats
- saturation signals
- recent relevance if needed
- production/rights constraints

### Competitor/Reference Scan
When evidence permits:
- topic
- angle
- promise
- opening/hook
- format
- repeated patterns
- overused angles
- missing/weakly served angles

Do NOT copy title/script/thumbnail of competitor.

### Content Gap Rule
Only mark content gap when reasonable evidence shows:

- search/question exists but quality content missing
- current results don't match intent
- results stale/low-quality
- audience question not clearly answered
- same subject exists but important angle not served

Do NOT call `content gap` just because angle sounds new.

---

## D. Candidate Generation

If Topic missing, default create `5–10 candidate topics` unless user requests different count.

Each candidate minimum:

- `candidateId`
- `topic`
- `canonicalTopic`
- `subject`
- `audienceQuestion`
- `corePromise`
- `angle`
- optional `timeScope`
- `audienceReason`
- `evidenceSummary`
- `contentGapStatus`
- `storyPotential`
- `visualPotential`
- `productionNotes`
- `rightsRisk`
- `platformFit`

Do NOT create 10 candidates only differing in wording.

Candidates must differ substantively in subject/angle/promise/value.

---

## E. Idea Validation Rubric

Score `0–2` only for triage, NOT performance forecast.

Dimensions:

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| Audience Fit | unclear/no fit | plausible, weak evidence | strong evidence/context |
| Evidence Strength | mostly assumption | mixed/indirect evidence | direct/recent/relevant evidence |
| Differentiation | near copy/overused | some variation | clear distinct angle/value |
| Story Potential | little progression/payoff | workable | clear tension/discovery/payoff |
| Visual Potential | very hard to illustrate | can build | strong visual opportunities |
| Production Feasibility | major blocker/cost/rights | needs workaround | fits current capability |
| Rights / Policy Fit | blocker/high risk | review needed | no material blocker from evidence |
| Platform Fit | format/intent doesn't fit | average fit | good fit with platform/request |

Decision per candidate:

- `GO`
- `REVISE`
- `HOLD`

Do NOT use scores to claim:

- guaranteed viral
- high CTR
- high views
- high RPM
- best guaranteed topic

---

## F. Input Modes

### Mode A — Topic Provided
```
Platform: TikTok
Topic: How Did Ancient Humans Protect Babies From Predators?
```
- Skip Topic Discovery unless user requests alternatives
- MUST run duplicate/history check via Topic Registry
- If same topic + same angle already covered on target platform, do NOT silently redo
- If topic same but angle materially different, may proceed after validation

### Mode B — Niche Provided, Topic Missing
```
Platform: TikTok
Niche: Ancient Humans
```
- MUST run Topic Discovery
- Generate 5–10 candidate topics
- Each candidate MUST run duplicate/history check
- Duplicate candidates NOT included in shortlist as new topics

### Missing Both
No Topic AND no Niche:

`BLOCKED — TOPIC_OR_NICHE_REQUIRED`

Do NOT guess niche from platform.