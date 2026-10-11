# PHASE 7 — Slice B Progress (started 10/10/2026)

Status: **IN_PROGRESS**. Stage 3B (research / evidence verification). No script, audio, Flow generation or render yet. 0 credits, 0 VND, no paid or Gemini API call.

## Readiness
- `npm run research:deep:doctor` -> `READY_NO_LIVE_APPROVAL` (provider installed, credentials present by name, `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED` unset). Live deep research was **not** run: no live approval, and the Gemini key tier is not verified by the agent. Valid fallback used instead.
- `npm run doctor:research` -> Crawl4AI bridge READY (0.9.4), Playwright stack present.
- Fallback used: `lib/research-acquisition` `acquireBatch` (local, robots enforced, polite delay), evidence handling per the owner policy.

## Batches 1-2 result (`Report/evidence/phase-7/research/`: source-batch-1.json, source-batch-2.json, claim-ledger.json)
- 21 sources acquired with the local Crawl4AI path (robots enforced): GPS.gov (10 pages), NIST, NASA, Ashby 2003, ESA Navipedia (7 pages), GPS World. 3 guessed URLs were 404 and discarded; 1 Navipedia page had no text. Raw text is not committed; sha256 identifies each snapshot.
- Search results were used only to discover URLs. Every quote in the ledger was extracted programmatically from acquired page text (the script fails if a quote is not found verbatim). Patent/forum hits were ignored.
- **C1-C14: all SUPPORTED** (C8 after rewrite: no quartz-oscillator claim; satellites carry atomic clocks and the receiver solves its own clock error as a fourth unknown). C11 carries NIST (-7/+45/+38 us/day), Ashby (net offset 4.4647e-10 = 38.6 us/day) and our derivation (-7.2/+45.7/+38.5). C12: GPS World "about 10 kilometers each day" plus derivation 11.5 km/day. C13: GPS.gov archive "typically accurate to within a 4.9 m radius under open sky" (cites ION); the signal-in-space URE (<= 2.0 m, 95%) must not be presented as user accuracy.
- C1 wording constraint: satellites are one-way beacons; do not claim phones work without any network.
- `RESEARCH_SUFFICIENCY = PASS_FOR_SCRIPTING`. Limits: government pages are one independence group; Navipedia is a reference wiki (mechanism, not headline numbers); GPS World is secondary; pages are snapshots of 2026-10-10/11; script quotes must be re-checked before the spoken script is locked. The repo evidence libs (lib/research-evidence) were not yet run on this ledger.

## Next (Dependency DAG order)
1. Run the repo claim-ledger/sufficiency libs on the ledger (or document why the JSON ledger is the Slice B format).
2. Final spoken script from the supported claims, then scene plan/coverage re-check against the routing matrix, then Kokoro audio + alignment, DiagramScene specs, previews. Full render only after the readiness gates.
