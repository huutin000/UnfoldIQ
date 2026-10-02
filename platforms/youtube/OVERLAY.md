# YouTube Platform Overlay (ROADMAP V5 PRE-FLIGHT — contract only)

Architecture: **SHARED CORE + YouTube overlay**.
Shared core (Content Class, Content Mode, Research Plan, Evidence,
Sufficiency, Research Pack, Editorial Strategy, Storytelling) is owned by
`core/*` + `schemas/*`. This file owns YouTube-only concerns.

## YouTube-only

- Metadata/packaging contracts (title, description, chapters, thumbnails).
- YouTube policy/monetization governance (never global; never auto-loaded
  for TikTok tasks).
- YouTube publish QA + analytics contracts (when implemented).

## Research prompt contract (documentation-driven)

- Research Request → Research Engine contract → Research Pack → niche /
  competitor analysis. No `raw URLs → unsourced confident conclusion`.
- Cite evidence when available; record access limitations; never claim
  retention/CTR/RPM/views without observed data; never claim a video was
  watched unless actually accessed.

## Script prompt contract

- FACTUAL/HYBRID input: `contentClass + contentMode + Research Pack +
  Editorial Strategy + production constraints`.
- FICTION input: `contentClass + contentMode + Story/Character/World +
  Plot Beats + Editorial Strategy + constraints` (Research Pack optional
  unless targeted factual research exists).
- Idea validation receives `contentClass + research/sufficiency/evidence
  state + feasibility + rights/policy risk`; never invents observed metrics.

No YouTube prompt bundle is duplicated into TikTok. No runtime implemented
here — contracts only; runtime deferred to 1G.1.
