# PHASE 7 — Visual Routing Matrix (Slice A addendum v1.1, revises coverage v1.0)

> Status: **PROPOSED — Flow shortlist awaits owner approval. No Flow generation has happened; 0 credits used.**
> Machine copy: `Report/evidence/phase-7/scene-plan.json` (fields: scene, beatId, visualSource, motionSource, reason, expectedQualityGain, estimatedCredits, fallback, license, rightsStatus, approvalState).
> Rules come from owner decisions §2–§3 (`UNFOLDIQ_PHASE7_SLICE_A_OWNER_DECISIONS.md`). The referenced `UNFOLDIQ_PHASE7_VISUAL_SOURCE_MOTION_ROUTING_POLICY.md` was NOT found in `D:\Downloads All\`; only the rules quoted in the decisions file were applied.

## What changed vs coverage v1.0
- v1.0 (31 DIAGRAM / 9 CHART / 8 TEXT_EVIDENCE / 2 MAP, 0 Flow) is **not approved as a final creative treatment**.
- 39 bespoke components are replaced by **9 parametric primitives**: TextCard, TrilaterationScene, OrbitScene, BarChart, GrowthChart, SignalPathScene, ClockCompare, PhoneMapDot, CardGrid. Scene variants are props, not new components.
- 50 scenes (~11.5 s average) are a draft; Slice B must vary shot length by beat meaning, density and real audio timing.
- Technical exposition (trilateration, pseudorange, error budgets, relativity numbers, orbits, labels, charts) stays original SVG/chart/Remotion with deterministic text and numbers.

## Flow-image shortlist for owner approval (7 shots; target 5–8, not a quota)
Ceiling: **80 Flow credits total** (retries, images, video, edits included), existing subscription only, 0 VND extra. Veo: **at most 2 candidate clips**, only if a shot truly needs semantic motion; none forced.

| Scene | Narrative need | Veo candidate | Fallback |
|---|---|---|---|
| S01 | Phone held in a real outdoor street setting; establishes the everyday hook | - | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |
| S02 | Satellite and Earth hero frame; atmosphere only, NOT an authoritative scientific diagram | conditional Veo: orbiting satellite with Earth rotation parallax that pan/zoom cannot express | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |
| S17 | Ground-control room atmosphere behind the ground-segment diagram | - | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |
| S28 | Atomic-clock laboratory atmosphere behind the clock card | - | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |
| S43 | City-canyon street context for multipath; reflection geometry stays SVG | conditional Veo: moving vehicle through a canyon showing signal blockage over time | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |
| S47 | Tunnel/indoor context for the signal-loss caveat | - | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |
| S50 | Outro backdrop behind the sources card | - | REMOTION_SVG (or approved/licensed media); BLOCKED_BY_ASSET if below quality bar |

Before any generation: check model/mode/outputs/cost per output/balance and projected cumulative credits; persist before/after balance and job correlation ID; STOP with OWNER_REVIEW_REQUIRED if cost is unclear or the cap would be exceeded; no blind retries. AI visuals are labelled illustration, carry source/model/prompt/attempt/hash provenance and pass factuality + continuity QA. `estimatedCredits` stays null until the Flow UI shows the real cost.

## Full matrix
| Scene | Beat | Primitive (draft component) | visualSource | motionSource | estCredits | Rights | Approval |
|---|---|---|---|---|---|---|---|
| S01 | B01 | PhoneMapDot (PhoneMapDot) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
| S02 | B02 | OrbitScene (SatelliteSkyOverview) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
| S03 | B03 | TextCard (KineticTextCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S04 | B04 | BarChart (RelativityTeaserBar) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S05 | B05 | TrilaterationScene (LandmarkBearings) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S06 | B06 | TrilaterationScene (Trilateration2D) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S07 | B07 | TrilaterationScene (Trilateration2D) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S08 | B08 | TrilaterationScene (Trilateration2D) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S09 | B09 | TrilaterationScene (Trilateration3D) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S10 | B10 | TrilaterationScene (BeaconPositions) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S11 | B11 | TextCard (KineticTextCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S12 | B12 | TrilaterationScene (DistanceQuestion) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S13 | B13 | OrbitScene (OrbitDiagram) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S14 | B14 | BarChart (OrbitScaleChart) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S15 | B15 | OrbitScene (ConstellationCoverage) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S16 | B16 | OrbitScene (OrbitPlanes) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S17 | B17 | OrbitScene (GroundSegment) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
| S18 | B18 | SignalPathScene (BroadcastMessage) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S19 | B19 | OrbitScene (SkyPlotAbstract) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S20 | B20 | SignalPathScene (SignalTravel) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S21 | B21 | TextCard (FormulaCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S22 | B22 | BarChart (TravelTimeBar) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S23 | B23 | BarChart (NanosecondScale) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S24 | B24 | SignalPathScene (CodeCorrelation) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S25 | B25 | SignalPathScene (CodeCorrelation) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S26 | B26 | TrilaterationScene (Trilateration3D) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S27 | B27 | ClockCompare (CheapClock) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S28 | B28 | ClockCompare (AtomicClockCard) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
| S29 | B29 | GrowthChart (ClockDriftChart) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S30 | B30 | TrilaterationScene (ExtraUnknown) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S31 | B31 | TrilaterationScene (FourSatSolve) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S32 | B32 | ClockCompare (TimeSideEffect) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S33 | B33 | TextCard (KineticTextCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S34 | B34 | TextCard (KineticTextCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S35 | B35 | ClockCompare (VelocityTimeDilation) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S36 | B36 | ClockCompare (GravityTimeDilation) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S37 | B37 | BarChart (RelativityBarChart) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S38 | B38 | GrowthChart (ErrorGrowthChart) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S39 | B39 | ClockCompare (FrequencyOffset) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S40 | B40 | TextCard (KineticTextCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S41 | B41 | GrowthChart (ErrorGrowthChart) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S42 | B42 | SignalPathScene (AtmosphereDelay) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S43 | B43 | SignalPathScene (Multipath) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
| S44 | B44 | BarChart (ErrorBudgetBars) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S45 | B45 | SignalPathScene (Augmentation) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S46 | B46 | CardGrid (GnssFamilyCards) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S47 | B47 | SignalPathScene (IndoorLimit) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
| S48 | B48 | TextCard (KineticTextCard) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S49 | B49 | PhoneMapDot (PhoneMapDot) | REMOTION_SVG | REMOTION | null | ORIGINAL | LOCAL_AUTHORING_PENDING_BUILD |
| S50 | B50 | TextCard (SourcesCard) | FLOW_IMAGE_CANDIDATE | REMOTION_STILL_MOTION | null | PENDING_PROVENANCE | PROPOSED_SHORTLIST |
