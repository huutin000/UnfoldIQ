# PHASE 7 — Visual Routing Decision Report (Slice A: discovery + plan)

Policy: `UNFOLDIQ_PHASE7_VISUAL_SOURCE_MOTION_ROUTING_POLICY.md` (Downloads All, 10/10/2026). No new phase; attached to Phase 7 Slice A (Production Preflight). Plan only: 0 provider calls, 0 credits, 0 VND, no media, no render, no code change.

## 1. Snapshot and scope
HEAD `891c3c6` (Slice A docs committed). Brief: GPS explainer ~9:35, 50 draft scenes treated as 50 single shots (SH01). Phase 6A pilot and Phase 6B history untouched. Roadmap V6.3 is latest (INDEX already points to it).

## 2. Router reuse vs gaps
`EXISTING_ROUTER_REUSED`: `lib/visual-motion` (1G.5) is the base; no parallel router will be built. `GAPS_IMPLEMENTED`: **none yet.** Findings in `Report/evidence/phase-7/visual-routing-audit.md`: no independent VisualSource axis, no PARALLAX/3D/EXISTING_FOOTAGE codes, no `ShotVisualDecision` contract, no realism-required hard block, no Flow credit ledger. Proposed GAP-052/053 (registry not edited).

## 3. Shot routing
`Report/evidence/phase-7/scene-visual-routing-matrix.md` (+ `scene-plan.json` v1.2.0 with ShotVisualDecision fields):
- 43 shots `PROCEDURAL_GRAPHICS + REMOTION_2D` (exact exposition, numbers, charts, text).
- 5 shots `FLOW_GENERATED_IMAGE + REMOTION_2D` approved by owner (S01, S02, S28, S43, S50) pending cost readback; 2 reserve (S17, S47).
- Optional `VEO_IMAGE_TO_VIDEO` on S43 only; max 1; not forced.
- No PARALLAX/3D claimed: flat stills get 2D motion only unless real depth layers exist.

## 4. Quality-first trade-off
No shot is marked hard-realism-required, so the policy 6.4 block does not trigger today. If the owner decides S01/S43 must be realistic, a missing quota or weak local art means `BLOCKED_BY_VISUAL_INPUT_OR_QUOTA`, not a quiet SVG. Diagram monotony (the 6A P3 lesson) is addressed by the 5 approved context stills; the real timeline still needs the Phase 6 rhythm/originality gates.

## 5. Credit plan and pending approvals
`flow-free-credit-plan.md`: cap 80, balance and per-generation cost UNKNOWN, estimates null. Shortlist approved (5 + 2 reserve); GAP-052/053 implementation approved; Gemini upload consent granted for the GPS video only, free-tier confirmation pending. Note the quota discrepancy (policy 50/day vs owner 200/month): the Flow UI readback decides.

## 6. Tests
None run (no code). ROUTE-01..18 = NOT_RUN. Checks executed this slice: JSON parse of evidence files, `git diff --check`, `npm run check:repo-structure` (see commit step). Live Flow/Veo = `NOT_MEASURED`.

## 7. Verdict
See `visual-routing-gate.json`: `VISUAL_ROUTING_CONTRACT = NOT_READY`, `VISUAL_SOURCE_MOTION_SEPARATION = NOT_PROVEN`, `FLOW_IMAGE_REMOTION_ROUTE = PENDING_OWNER`, `VEO_SEMANTIC_MOTION_ROUTE = PENDING_OWNER`, `SHOT_COVERAGE_MATRIX = READY`, `FLOW_CREDIT_PLAN = READY`, `PHASE7_ROUTING_PREFLIGHT = WAITING_OWNER`, `PHASE7_LONGFORM_E2E = NOT_RUN`, `EXTERNAL_PAID_COST_VND = 0`. `PHASE_7` is not complete.

## 8. Handoff
Next (needs owner go): policy Slice B — extend `lib/visual-motion` with the source axis, new motion codes, reason codes and tests ROUTE-01..18 (targeted suites only); then Slice C three representative shots (one diagram, one Flow still only if credits approved, one Veo only if approved). Slice B of Phase 7 (research -> audio) must not freeze the Shot Plan before this routing is resolved.
