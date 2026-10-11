# Flow Credit Plan (Phase 7 GPS project) — PLAN ONLY, nothing generated

## Limits
- Owner cap: **FLOW_CREDIT_CAP = 80** total (retries, image calls if charged, video, edits/upscales), existing subscription only, `EXTRA_VND = 0`, no auto-upgrade, no paid provider.
- Policy: cap is an upper bound, not a target. `UNAPPROVED_FLOW_GENERATION = FORBIDDEN`.
- Quota sources disagree (policy: 50/day no-subscription; owner decisions: 200/month on Google AI Plus). **Neither is assumed.** Required readback before spend: `availableCredits`, active model/mode, `creditCostPerGeneration`, `outputCount`, `providerLastVerifiedAt`.

## Current values
| Field | Value |
|---|---|
| availableCredits | UNKNOWN (not read; no browser/Flow session used) |
| creditCostPerGeneration | UNKNOWN |
| providerLastVerifiedAt | never |
| creditsUsed | 0 |
| estimatedCredits per shot | UNKNOWN (null, not 0) |
| retryAllowance | 1 retry per shot, outputCount=1 unless owner approves more |

## Shortlist (HIGH_IMPACT_VISUALS; owner-approved, S17/S47 reserve)
| Scene | Intent | Route | Fallback if no credit/quality |
|---|---|---|---|
| S01 | phone in real street, everyday hook | FLOW_GENERATED_IMAGE + REMOTION_2D | APPROVED_ASSET / PROCEDURAL_GRAPHICS |
| S02 | satellite + Earth hero (illustration, not a scientific diagram) | same; optional VEO_IMAGE_TO_VIDEO | same |
| S17 (RESERVE) | ground-control atmosphere | same | same |
| S28 | atomic-clock lab atmosphere | same | same |
| S43 | city canyon for multipath; optional Veo | same; optional VEO_IMAGE_TO_VIDEO | same |
| S47 (RESERVE) | tunnel/indoor caveat | same | same |
| S50 | outro backdrop | same | same |

Veo: at most 1 clip (S43 only), only if an actual generated still plus pan/zoom fails the story need. Veo clip prices are unknown until the UI shows them; the 80 cap may not fit a clip plus images — the owner picks priorities after seeing real costs.

## Spend protocol (per generation)
1. Shortlist approved by owner. 2. Read balance, model, mode, cost, outputs in Flow UI. 3. Record projected cumulative credits; STOP + `OWNER_REVIEW_REQUIRED` if cost unclear, balance short or cap exceeded. 4. Generate; persist before/after balance, job correlation ID, prompt version, model, asset hash. 5. On timeout/reconnect check history first (no duplicate spend). 6. QA the actual artifact (factuality, continuity, defects, rights, AI disclosure, native audio muted/routed). 7. No credits: reuse, licensed, local; else `WAIT_FOR_FREE_QUOTA` / `BLOCKED_BY_ASSET`; never paid.

## Honest limits
Flow image to Remotion route is approved pending cost readback and the Veo route (S43) is conditional; neither is proven. Visual provenance fields exist in the plan but no asset exists.
