# Packaging QA Reconciliation — pilot-sky-blue-canonical

Date: 2026-10-10. Read-only audit. No package/description/title was edited.

## 1. Open items of `packaging/final-publish-package.json`

`qaStatus = REVIEW_REQUIRED`, `approvalStatus = OWNER_APPROVED`, `finalVideoSha256 = 7954a86a…dfcdf`.

| # | findingId / code | severity | source | evidenceRef | blockingPolicy | currentStatus | classification | proposedResolution |
|---|---|---|---|---|---|---|---|---|
| 1 | OI-1 "Phase 4B visual flash/safe-zone validation not run" | REVIEW | final-publish-package.openItems | `Report/evidence/phase-6a/canonical-pilot/phase4b-final-qc.json` (finalSha256 = 7954a86a…; 0 black, 0 freeze, 0 silence; luminance 2 fps + 1713 frames: bigCount 0; verdict PASS) | blocks publish-ready finalize until flash QC exists | evidence exists but was produced after the package was written (package updatedAt 03:02:58Z, QC 03:04:28Z) | RESOLVED_BY_EXISTING_EVIDENCE for flash. Caveat: the QC is deterministic ffmpeg only, "not a photosensitivity certification"; it has no explicit caption safe-zone check | refresh the package open item via the canonical packaging service (owner-triggered); do not hand-edit JSON |
| 2 | OI-2 "Full Multimodal Watch (Gemini Free) not run: no API key available" | REVIEW | final-publish-package.openItems | `canonical-pilot/gemini-watch.json` (10/10 PASS, 03:23Z), `gemini-watch-per-scene.json` (03:37Z) | informational for packaging | open item text is stale: watch ran later. Watch artifacts carry `videoSizeBytes = 18954217` (equals final.mp4) but NO sha256; Free Tier is OWNER_ATTESTED | RESOLVED_BY_EXISTING_EVIDENCE with limitation (model opinion, not signed human watch, not frame-exact) | add sha256 reference manifest (see lineage audit) |
| 3 | OI-3 "upload/publish not performed" | INFO | final-publish-package.openItems | AGENTS.md / guards: `AUTOMATIC_CLOUD_UPLOAD=false`; owner-approval `notCovered: upload/publish` | non-blocking for Phase 6A | true and intended | ACCEPTED_NON_BLOCKING (policy: Phase 6A does not upload; owner approval explicitly excludes upload) | none for 6A; owner decides publish later |

Additional stale or inconsistent findings in files the package references (not in `openItems`, but they contradict it):

| # | code | source | detail | classification |
|---|---|---|---|---|
| 4 | MISSING_AUDIENCE_DECISION ("no variant selected") | `packaging/packaging-qa.json` (status REVIEW_REQUIRED, complianceBlocking 1) | stale. The package has `selectedVariantId pkv-202fd90e1b72`; `metadata.json.audience = {madeForKids:false, ageRestriction:false}`; owner-approval records the same audience | RESOLVED_BY_EXISTING_EVIDENCE (file was not regenerated after selection) |
| 5 | platform-compliance: "title limit 0/100", "metadata completeness false", "final render/output technical compliance PENDING_PHASE_4B", "flash/safe-zone PENDING_PHASE_4B" | `packaging/platform-compliance.json` | stale snapshot taken before title/metadata/4B existed. Title is 45 chars; technical QA 9/9 PASS; flash QC PASS | RESOLVED_BY_EXISTING_EVIDENCE for title/render/flash. "metadata completeness": `category`, `licenseDistribution`, `playlistIntent` are null | REQUIRES_OWNER_DECISION (are null category/license acceptable for a PRIVATE, not uploaded pilot?) |
| 6 | `uploadChecklist` text says "Phase 4B PASS (currently: PENDING_PHASE_4B)" | final-publish-package.uploadChecklist | stale text; checklist items are all unchecked | RESOLVED_BY_EXISTING_EVIDENCE (cosmetic) |
| 7 | **DESCRIPTION_NARRATION_ENGINE_MISMATCH**: description says "Narration is synthetic (Microsoft SAPI)" | `packaging/description.md`, `metadata.json.description`, selected variant | actual narration is local Kokoro-82M `am_michael` speed 1.1 (`audio-manifest.json` providerId local-kokoro; `rights-provenance.json`). The description is factually wrong about the voice engine | **REQUIRES_OWNER_DECISION** (claim-fidelity defect in owner-approved packaging) |
| 8 | rights note stale: VISUAL_S0x notes say "Labeled ILLUSTRATION in-frame" but the owner design change in attempt-006 removed the ILLUSTRATION badge (`gate JSON defectsFixed/designChanges`) | `rights-provenance.json` | wording only; rights status NOT_APPLICABLE (original work) is unaffected | RESOLVED_BY_EXISTING_EVIDENCE (cosmetic; correct wording on next packaging refresh) |

Blocking policy result: no item is `UNRESOLVED_BLOCKING`. Items 5 (metadata null fields) and 7 (SAPI claim) need an owner decision, so `PACKAGING_QA = REVIEW_REQUIRED`. I did NOT convert it to PASS and did NOT change status (the canonical service would have to be called with owner confirmation; the schema supports `REVIEW_REQUIRED`).

`PACKAGING_OPEN_ITEMS = 3` listed + 5 stale/inconsistent findings = 8 total; 5 resolved by evidence, 1 accepted non-blocking, 2 need owner decision.

## 2. Claim fidelity: title promise vs video

Approved script topic: "Why the sky is blue". Selected title: "Why Sunsets Turn Red While the Sky Stays Blue".

| titleClaim | script beat (script.json) | scene / time (scene-script.json) | spoken sentence | supported |
|---|---|---|---|---|
| "the Sky Stays Blue" | B1, B3, B4 (C1, C2) | S01 0–7.1 s, S03 15.3–30.25 s | "they scatter short blue wavelengths in every direction… That is why the whole sky glows blue." | yes |
| "Sunsets Turn Red" | B6 (C4) | S05 37.35–44.475 s ("sunset gradient, long-path arrow") | "At sunset, sunlight crosses much more air. The blue is scattered away, and the reds and oranges remain." | yes (mechanism: longer path, blue scattered out, red/orange remain) |
| "…While…" (contrast) | B4 vs B6 | S03 vs S05 | blue overhead by scattering, red at sunset by longer path | yes |

Description claims: "why the sky is not violet" -> B5/S04 (30.25–37.35 s) yes; "why sunsets turn red and orange" -> B6/S05 yes; "hazy sky looks pale and white" -> B7/S06 yes; chapters 0:00/0:15/0:30/0:44 match scene starts 0 / 15.3 / 30.25 / 44.475 s (within 0.3 s) yes; "one-minute explainer" = 57.152 s yes; sources listed in `sources.json` for C1–C5; "Narration is synthetic (Microsoft SAPI)" **NO** (see item 7).

Coverage depth: the sunset explanation is a single beat (~7.1 s, one scene). It is accurate and sufficient for the claim, but the title leads with sunsets while the video is mostly about why the sky is blue. This is a reasonable emphasis question, not a deception. The Gemini 10/10 result was not used as evidence; the mapping above comes from the approved script, scene script and timing.

Verdict:
- `TITLE_CLAIM_FIDELITY = PASS` (sunset-red explained in B6/S05).
- `DESCRIPTION_CLAIM_FIDELITY = FAIL (one factual error: SAPI)`.
- `PACKAGING_CLAIM_FIDELITY = REVIEW_REQUIRED` -> `CLAIM_FIDELITY_REVIEW_REQUIRED` for the description only.

Proposed correction (needs owner decision, then the standard packaging flow and a NEW owner approval of the packaging variant; the video bytes do not change, no render): replace "Narration is synthetic (Microsoft SAPI)" with "Narration is synthetic (Kokoro-82M, local)". The existing approval cannot be silently reused for the changed description.
