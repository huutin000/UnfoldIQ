# UNFOLDIQ Core Video Production Workflow

## Minimum User Input

A valid video production request must provide at minimum one of:

```
Platform: <platform>
Topic: <topic>
```

or:

```
Platform: <platform>
Niche: <niche>
```

If neither Topic nor Niche provided:

`BLOCKED — TOPIC_OR_NICHE_REQUIRED`

The workflow resolves all remaining decisions from project rules, platform profiles, and provider configurations. Users do not need to repeat workflow steps or technical directives.

---

## Canonical Production Flow

The following stages execute in logical order. Each stage produces artifacts consumed by downstream stages.

Canonical stage numbering (no duplicates): Stage 1, Stage 2, Stage 3A, Stage 3B, Stage 3C, Stage 3D, Stage 4–19.

### 1. Intake / Resolve Request
- Parse and validate minimum input (Platform + Topic, OR Platform + Niche)
- If neither Topic nor Niche provided: `BLOCKED — TOPIC_OR_NICHE_REQUIRED`
- Normalize platform identifier (e.g., "youtube", "tiktok")
- Initialize production context with request metadata
- Determine execution branch:
  - **Branch A**: Topic provided → Resolve Platform → Registry duplicate check → Topic Research / Fact Verification
  - **Branch B**: Niche provided (no Topic) → Resolve Platform → Topic Discovery → Registry duplicate checks → Idea Validation → Selected Topic → Topic Research / Fact Verification

### 2. Resolve Platform
- Resolve platform identifier via `platforms/INDEX.md` (aliases: YouTube/youtube/YT → youtube, TikTok/tiktok/TT → tiktok)
- Load platform profile from `platforms/<platform>/PROFILE.yaml`
- Apply merge precedence:
  1. Explicit User Input (overrides)
  2. Platform Project Defaults (from PROFILE.yaml)
  3. Core Technical Fallback (if defined in future)
- Select appropriate composition template from `remotion/` based on orientation/aspect ratio
- Do NOT load policy, provider, or creative rules at this stage

### 3A. Topic Discovery / Registry
- Reference: `core/TOPIC_DISCOVERY.md`, `core/TOPIC_REGISTRY.md`, `projects/TOPIC_REGISTRY.json`

**Branch A (Topic provided)**:
- Skip candidate discovery
- Run Topic Registry duplicate/history check on provided topic
- If duplicate on target platform → `BLOCKED` or `REVISE_REQUIRED`
- Proceed to Topic Research / Fact Verification (conditional, when topic requires factual/current-event verification)
- Query authoritative sources, capture citations
- Produce `research/` artifact with verified claims and source URLs

**Branch B (Niche provided, no Topic)**:
- Run Topic Discovery per `core/TOPIC_DISCOVERY.md`:
  - Niche snapshot, competitor scan, content gap analysis
  - Generate 5–10 candidate topics with substantive variation
  - Each candidate: run Topic Registry duplicate check
  - Idea Validation per rubric (Audience Fit, Evidence Strength, Differentiation, Story/Visual Potential, Production Feasibility, Rights/Policy Fit, Platform Fit)
  - Decision per candidate: `GO`, `REVISE`, `HOLD`
- Blocked duplicates excluded from shortlist
- Select one candidate → upsert Topic Registry with `SELECTED` status on target platform
- Selected topic becomes canonical Topic for downstream stages
- Output: `topic-discovery.json` validated against `schemas/topic-discovery.schema.json`
- Upsert Topic Registry with selected topic at `SELECTED` status on target platform
- Proceed to Topic Research / Fact Verification (conditional)

### 3B. Research Quality / Fact Verification (Research Quality Gate)
- Reference: `core/RESEARCH_QUALITY.md` (canonical owner incl. ROADMAP V5 contracts V5.1–V5.15), `schemas/research-plan.schema.json` (conditional)
- Runtime: `lib/research-plan.js` (Research Required gate + Plan builder + validator + `planResearch` facade), `lib/content-class.js` (Content Class router)
- Acquisition runtime (1G.1D–1G.1F): `lib/research-acquisition/` (SearchProvider exchange + URL safety gate + Crawl4AI bridge + Playwright browser/auth path); acquisition ends at normalized documents, no truth verdicts
- Evidence runtime (1G.1G–1G.1L): `lib/research-evidence/` (Source Registry + Independence gate + Claim/Evidence Ledger + Verification + Contradictions/Unknowns + Sufficiency gate); ends at sufficiency state + targeted gaps, no Research Pack
- Execute deep factual research per `core/RESEARCH_QUALITY.md`:
  - Define core factual, interpretation, and narrative questions
  - Execute source hierarchy search (primary evidence → peer-reviewed → institutional → expert analysis)
  - Classify every material claim: `DIRECT_EVIDENCE`, `SUPPORTED_FACT`, `SCHOLARLY_INTERPRETATION`, `HYPOTHESIS`, `CONTESTED`, `UNVERIFIED`
  - Apply source corroboration rules for high-impact/contested claims
  - Record freshness/currentness for time-sensitive claims
  - Distinguish evidence vs interpretation vs reconstruction (mandatory for historical/archaeological topics)
- Output: `research-brief.json` validated against `schemas/research-brief.schema.json`
- If `researchStatus` = `BLOCKED` → do not proceed to Storytelling
- If `researchStatus` = `PARTIAL` → proceed with documented caveats in `handoff.materialUncertainties`

### 3C. Content Mode Resolution
- Reference: `core/CONTENT_MODE.md` (incl. V5 `contentClass = FACTUAL | FICTION | HYBRID`; `modeId` unchanged)
- Runtime: `lib/content-class.js` (`resolveContentClass`; canonical `MODE_CLASS_MAP` is the single mapping owner)
- Resolve Content Mode per `core/CONTENT_MODE.md`:
  - Inputs: resolved topic, niche, platform, audience, research brief, user intent, production constraints
  - Determine modeId (suggested or custom), rationale, and all direction fields
  - Apply cross-modal propagation: Content Mode → Research interpretation → Storytelling → Creative Direction → Visual Bible → Scene Plan → Asset prompts → Voice/Music/SFX → Remotion editing
  - Select appropriate `emotionalArcMode` (STRONG/LIGHT/MINIMAL/ADAPTIVE) per content type
- Output: `content-mode.json` validated against `schemas/content-mode.schema.json`
- Ancient Humans is NOT global default; mode resolved per project

### 3D. Editorial Value Strategy
- Reference: `core/EDITORIAL_VALUE.md`
- Define Beyond-Search Value Gate: articulate what viewer gets beyond search results
- Select value types: causal_explanation, mechanism, synthesis, evidence_walkthrough, case_example, comparison, misconception_correction, timeline_context, expert_interpretation, implication, visual_demonstration, human_stakes, counterintuitive_insight, structured_decision_framework, practical_demonstration
- Define conditional example policy: include only if materially improves comprehension/credibility/visualization/emotional_connection/practical_usefulness
- Apply domain-aware example mapping (historical: archaeological sites/artifacts; technical: code demos; news: timeline/events; meditation: optional)
- Apply viewer knowledge calibration (avoid too shallow/too expert)
- Define insight chain per section: Question → Evidence → Explanation → Optional Example → Meaning/Implication → Next Question
- Apply Engagement Without Distortion rules (no exaggeration, fake suspense, invented stakes, false certainty, sensationalism, clickbait)
- Apply smell checks: no generic cadence, no source-order narration, no disconnected facts, no mechanism gaps when required, etc.
- Output: `editorial-strategy.json` (or integrate into script handoff)

### Duration Planning Gate (between Stage 3D and Stage 4)
- Reference: `core/DURATION_PLANNING.md`
- Inputs: user target, research brief, content mode, editorial value, platform profile
- Resolve `duration-contract.json` per `schemas/duration-contract.schema.json` (mode: `AUTO` | `FLEXIBLE_TARGET` | `APPROXIMATE_TARGET` | `HARD_LIMIT`; never filler, never unsupported expansion)
- Output: `projects/<projectId>/planning/duration-contract.json`
- Stage 4 must load it; script fits working duration, not raw user seconds

### 4. Story + Script
- Follow `core/STORYTELLING.md` for research gate, story structure, script quality rules, and scene handoff contract
- Follow `core/EDITORIAL_VALUE.md` Beyond-Search Value Gate, conditional example policy, domain-aware examples, knowledge calibration, insight chain, engagement without distortion
- Consume: resolved topic, research-brief, content-mode, editorial-strategy, duration-contract (working duration + script budget)
- Transform research into explanation/story/value (NOT source-order narration)
- Generate narrative structure: hook, body, conclusion
- Write timed script with dialogue, visual cues, pacing markers
- Preserve caveats from research brief; do not state UNVERIFIED/HYPOTHESIS as fact
- Conditional examples: include only if materially improves value; label hypothetical scenarios
- Output: `script.json` with segments, timestamps, and metadata

### 5. Hook / Opening Design
- Apply `core/STORYTELLING.md` hook rules and script quality rules
- Incorporate resolved platform constraints (aspect ratio, safe zones, duration) from Stage 2
- Apply Content Mode hookApproach and pacingDirection
- Design first 3 seconds: visual + audio + text sync
- Optimize for platform retention mechanics
- Output: `hook.json` with frame-accurate plan

### 6. Creative / Emotional Direction
- Follow `core/CREATIVE_DIRECTION.md` for global creative direction, emotional arc, cross-modal consistency, and anti-template rules
- Consume Content Mode (Stage 3C) for direction fields and emotionalArcMode
- Consume research brief for confidence/caveats constraining dramatic treatment
- HYPOTHESIS/CONTESTED material MUST NOT receive visual/audio treatment signaling false certainty
- Emotional Arc adapts to content type (Content Mode emotionalArcMode)
- Define emotional arc per segment (tension, release, curiosity, payoff)
- Map emotions to visual/audio parameters (color, motion, music energy, voice tone)
- Creative direction MUST be finalized before asset generation (Stage 10)
- Output: `emotional-direction.json`

### 7. Visual Bible / Continuity
- Follow `core/VISUAL_BIBLE.md` for usage criteria, style/character/environment continuity, asset-generation inheritance, and provenance boundary
- Historical/scientific reconstruction MUST distinguish evidence-backed visual, interpretation, and reconstruction
- Generated imagery is illustrative unless source-backed evidence itself
- Evidence and reconstruction MUST NOT be conflated
- Create Visual Bible when continuity is materially relevant (recurring character, location, historical/fictional world, product/brand identity, multi-scene AI visuals)
- Recurring visual entities (character, wardrobe, prop, location, creature/object) may require a Continuity Registry per `core/CONTINUITY.md` (identify → master refs → LOCK before scene generation)
- Define visual language: color palette, typography, iconography, transition style
- Establish character/asset consistency rules across scenes
- Output: `visual-bible.json` + reference assets in `assets/visual-bible/`

### 8. Scene Plan
- Consume outputs from:
  - Storytelling (Stage 4): script.json with scene handoff contract
  - Creative Direction (Stage 6): emotional-direction.json
  - Visual Bible (Stage 7): visual-bible.json (when created)
- If scene uses a factual example/case: link to corresponding claim/source/example evidence where practical
- Scene must identify recurring entities when relevant (entity IDs + `continuityStrictness`: `STRICT` | `NORMAL` | `LOOSE` | `NOT_APPLICABLE`)
- Break script into scenes with: duration, composition, camera, animation, layering
- Map each scene to Remotion composition/component
- Output: `scene-script.json` validated against `schemas/scene-script.schema.json`

### 9. Asset Plan
- Map each scene requirement to a capability (image, video, tts, stt, music, sfx)
- Classify source for each asset: `existing` | `generated` | `local-library` (per `providers/CONFIG.yaml`)
- Identify which assets require provider generation vs. reuse vs. Remotion-native
- Do NOT call providers at this stage — only plan
- Run PRE_PRODUCTION rights/policy routing when relevant (`core/POLICY_RIGHTS.md`, `policy/ROUTER.md`):
  - Resolve relevant policy categories from topic/mode/script/asset plan
  - Record current/snapshot policy state and rights strategy in the policy review (`schemas/policy-review.schema.json`, gate `PRE_PRODUCTION`)
  - A blocked asset strategy MUST stop — do not proceed to Stage 10 on blocked rights
- Before generation: determine asset type and continuity strictness; ensure required locked references exist, or create prerequisite reference-generation tasks (per `core/CONTINUITY.md`)
- Output: `asset-manifest.json` validated against `schemas/asset-manifest.schema.json`

### 10. Asset Generation / Resolution
- Follow `providers/INDEX.md` routing, `providers/CONFIG.yaml` selection, `providers/PROVIDER_CONTRACT.md` I/O, and `providers/PROVIDERS.md` capability notes
- Use the generic provider runtime (`providers/runtime/`): Asset Requirement → Provider Request → Resolver → Adapter → Persistent Artifact → Provider Result. Do not vendor-call from workflow.
- For recurring visual assets: Continuity precondition → Provider request → Provider result → Continuity QA. A STRICT scene whose required entities are not LOCKED MUST NOT claim continuity-ready.
- Resolve provider per asset using preferredOrder and availability (existing → agent-native → configured API)
- Apply Creative Direction (Stage 6) and Visual Bible (Stage 7) constraints to every generation request
- Execute generation per asset plan:
  - Image generation via resolved provider
  - Video generation via resolved provider
  - Code-generated assets (charts, maps, typography) via Remotion components
  - Stock/local asset retrieval
- Verify each asset: dimensions, format, license, AI provenance
- Output artifact MUST be persistent in project workspace
- Record full provenance per `PROVIDER_CONTRACT.md` output contract
- Update `asset-manifest.json` with generated asset details, validate against `schemas/asset-manifest.schema.json`
- Every generated/acquired asset preserves: provenance, rights source type, AI/generated status, reconstruction classification (`EVIDENCE_ASSET` | `RECONSTRUCTION` | `ILLUSTRATION` | `GENERIC_BROLL`)
- If required capability missing and no valid fallback → `BLOCKED` with missing capability documented
- Store in `assets/generated/` or `assets/stock/` with provenance records

### 11. Media Preflight
- Run structural validation over every planned/generated asset (file existence inside the project, zero-byte/corrupt detection, path-traversal rejection, extension/type compatibility)
- Record media metadata (dimensions, duration, codec, aspect treatment vs platform canvas) via measurement only — never estimated; unknown extensions stay `UNKNOWN`, never `MEASURED`
- Gate asset usability: rights status (`BLOCKED`/`MUSIC_RIGHTS_UNKNOWN` stop), provenance recording, fingerprint freshness, STRICT continuity lock checks, orphan scene-asset detection, probe-candidate conflict review
- Record the embedded-audio policy for video assets (default `MUTE_GENERATED_CLIP_AUDIO` unless the scene declares an explicit `clipAudioUse`)
- Output: `media-preflight.json` validated against `schemas/media-preflight.schema.json` (`READY` / `REVIEW_REQUIRED` / `BLOCKED` per asset)

### 12. Voice / Music / SFX / Captions
- TTS/STT provider resolution goes through Provider Layer (`providers/INDEX.md`, `providers/CONFIG.yaml`)
- Music/SFX default to `approved-local` per current config (configurable in future)
- Generate voiceover via resolved TTS provider (timed to script segments)
- Voice QA (`lib/voice-check.js`): render-ready voice requires measured timing evidence; existing timing artifacts are preserved verbatim, never re-estimated; unsupported TTS languages never synthesize (handoff, no fake audio)
- Transcript alignment (`lib/transcript-alignment.js`): planned script vs measured transcript classified as `MATCH` / `MINOR_DIFFERENCE` / `MATERIAL_DIFFERENCE` (numbers, negation, units/dates, truncation flagged)
- Select/license background music per emotional direction from approved sources (unknown music rights block, never render-ready)
- Add SFX at hook/transition points from approved sources (purposeless/filler SFX flagged for review)
- Caption timing MUST be derived from evidence/timestamps (STT or manual alignment) — do NOT fabricate timing; segment timing is never promoted to word timing
- Captions grouped per platform profile (`lib/caption-grouping.js`: TikTok 42 chars vs YouTube 84 chars) and validated (`lib/caption-check.js`)
- Assemble the deterministic audio mix plan (`audio-mix-plan.json` per `schemas/audio-mix-plan.schema.json`: clips with gain/fades, measured ducking ranges, loudness recorded only when actually measured) and the measured timeline (`buildMeasuredTimeline`: `actualTimelineEndMs` = max of measured ends; target never pads; black-tail/pad-to-target rejected; gaps reconciled explicitly)
- Cross-contract consistency enforced (`lib/step11-contract-check.js`: no orphan scene/audio/caption refs, ±250ms duration tolerance, caption-within-timeline, target intact, measured evidence separate from target, no safety-reentry, continuity refs locked)
- Frame-math handoff for coding (`lib/step11-handoff.js`: ms→frames, caption/audio ranges, `assertNoBlackTail`) — pure math, no rendering
- Output:
  - `audio-manifest.json` validated against `schemas/audio-manifest.schema.json`
  - `captions.json` validated against `schemas/captions.schema.json`
  - `audio-mix-plan.json` validated against `schemas/audio-mix-plan.schema.json`
  - `media-preflight.json`, `timeline-measured.json`, `duration-evidence.json`
- Audio tracks stored in `assets/audio/`, captions in `assets/captions/`

> **Implementation-step vs runtime-stage note:** the top-level implementation
> Step 11 work package covers runtime Stages 11+12 preparation (preflight
> through measured timeline and video-spec inputs) feeding Step 12 coding.
> The canonical 19-stage numbering above is unchanged — no renumbering.

### 13. Video Spec
- Assemble final render specification from:
  - Platform profile (Stage 2): composition dimensions, fps, aspect ratio, safe zones
  - Scene plan (Stage 8): scene-script.json with MEASURED timings
  - Asset manifest (Stage 10): asset-manifest.json with READY assets
  - Audio manifest (Stage 12): audio-manifest.json with evidence-based timing
  - Captions (Stage 12): captions.json with MEASURED timing
  - Creative Direction (Stage 6) + Visual Bible (Stage 7): globalStyle references
- Validate all required timing is MEASURED or has equivalent evidence
- Output: `video-spec.json` validated against `schemas/video-spec.schema.json`

### 14. Remotion Build
- Consume validated `video-spec.json` (validated against `schemas/video-spec.schema.json`)
- Pass video spec as input props to Remotion composition (no hardcoded video content in components)
- Execute `npx remotion render` with video spec parameters
- Stream logs, capture frame progress
- On failure: capture error, invalidate downstream, retry with fix

### 15. Preview
- Render low-res preview (optional, for human review)
- Quick-play in Remotion Studio or Player
- Human approval gate if configured

### 16. Final Render
- Execute full-quality render per video spec
- Produce final MP4 at `out/<project>-<timestamp>.mp4`
- Generate render evidence: logs, duration, file size, checksum

### 17. Render / Content / Policy QA
- **Render QA**: Verify file exists, playable, correct duration, no corruption
- **Content QA**: Spot-check script adherence, caption sync, visual continuity
- **Policy QA (PRE_FINAL)**: Run the policy review against actual artifacts (`schemas/policy-review.schema.json`, gate `PRE_FINAL`):
  - Use current relevant official policy when live-verifiable; otherwise record the snapshot limitation (`SNAPSHOT_ONLY`/`STALE`) — never claim live verification without it
  - Keep the 4 axes separate: `PLATFORM_ALLOWEDNESS`, `RIGHTS`, `AI_TRANSPARENCY`, `MONETIZATION_AD_SUITABILITY`
- Output: `qa-report.json` with PASS/FAIL per check

### 18. Fix + Re-render If QA Fail
- If any QA check fails: diagnose root cause
- Invalidate affected downstream artifacts
- Re-run from earliest affected stage (minimal rework)
- Repeat until QA PASS

### 19. Final MP4
- Declare production complete when:
  - Final MP4 artifact exists at declared output path
  - QA report shows all checks PASS
  - Render evidence captured
  - Asset provenance records complete
- Final handoff differentiates: `RENDER_READY` (technically renderable) vs `PUBLISH_READY` vs `PUBLISH_REVIEW_REQUIRED` vs `BLOCKED` — renderable does NOT imply publish-ready
- Workflow terminates with final video artifact + QA evidence

---

## Stage Execution Rules

1. **Selective Execution**: Agent runs only stages required for the current request. Stages with valid existing artifacts may be skipped.

2. **Skip with Validation**: A stage may be skipped if:
   - Its output artifact exists
   - The artifact is valid for current input (platform, topic, config unchanged)
   - Upstream dependencies have not changed

3. **No Unnecessary Regeneration**: Do not regenerate assets, audio, scripts, or renders that are already valid and compatible.

4. **Invalidation on Upstream Change**: If any upstream dependency changes (script, platform config, visual bible, asset plan), all downstream artifacts derived from it are invalidated and must be rebuilt.

5. **Evidence-Based Claims**: Never claim to have researched, generated, previewed, rendered, inspected, or QA'd without providing actual evidence (command output, file paths, render artifacts, test results).

6. **Capability Honesty**: If a capability is not implemented (e.g., no TTS provider configured), mark stage as `NOT VERIFIED` or `BLOCKED`. Do not assume PASS.

7. **User Input Priority**: Explicit user input always overrides project defaults.

8. **Platform Rules Deferred**: Platform-specific rules (YouTube, TikTok) are defined in `platforms/<platform>/` and loaded at Stage 2. This workflow does not embed default TikTok/YouTube rules.

9. **Asset/AI Provenance & Policy Gate**: Before final READY state, verify:
   - Asset licenses and usage rights
   - AI generation provenance records
   - Platform policy compliance (when relevant profile exists)

10. **Final Render Success Criteria**: Final render is only successful when:
    - The MP4 file physically exists at the declared output path
    - File is playable and matches spec (duration, resolution, fps)
    - QA evidence is captured and all checks PASS

11. **Stage Context Routing**: From Stage 1/2, the agent resolves stage-specific context per `core/CONTEXT_ROUTER.md` + `context/ROUTES.yaml` (or `node scripts/cli/context-resolver.js --stage <STAGE> --platform <platform>`). From Stage 3 onward, each major stage execution generates/updates a context manifest (`schemas/context-manifest.schema.json`). `missingRequired.length > 0` blocks stage PASS. Development history (`Report/**`, step prompts/fixes) is never runtime context.

---

## Final Output Contract

Upon workflow completion, the following must exist:

| Artifact | Description |
|----------|-------------|
| **Final rendered video** | MP4 at `out/<project>-<timestamp>.mp4` |
| **Production artifacts** | All stage outputs required for render (script, scene plan, asset plan, video spec, emotional direction, visual bible, hook plan, preflight report) |
| **Asset provenance records** | Generation source, provider, license, timestamps for each asset |
| **QA result** | `qa-report.json` with all checks PASS |
| **Render evidence** | Render logs, duration, file size, checksum, frame count |

Publishing metadata, analytics, upload status, and post-publish tracking are **not required** for video-production workflow completion.

---

## Workflow Termination

The workflow ends at **Final MP4 + QA Evidence**. No auto-publishing, upload API calls, scheduling, analytics ingestion, experiment systems, dashboards, backends, or databases are part of this core workflow.