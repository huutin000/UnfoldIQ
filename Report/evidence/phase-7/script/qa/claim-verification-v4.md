# Claim verification v4 (4 edited scenes)

Method: each edited sentence traced to ledger v1.2.0 quotes (unchanged) and re-checked against the live sources on 2026-10-11 (GPS World / Misra, GPS.gov). Ledger not modified: no claim changed, only wording. Same-model verifier; not independent.

| Scene | Spoken claim | Claim / source | Verdict |
|---|---|---|---|
| N03 | Without correction a GPS satellite clock would gain about 38 us/day vs a ground clock | C11, SRC24 "will gain about 38 microseconds per day over a clock at rest at mean sea level" | PASS (counterfactual framing is what the source describes) |
| N03 | "Far beyond the timing accuracy GPS needs" | C23, SRC24 (nanosecond-level clocks; 38,000 ns / 10 ns = 3,800x, derived) | PASS (qualitative; number no longer spoken) |
| N18 | GR adds about 45 us/day; with motion, uncorrected clock about 38 us/day faster | C11: SRC21 (+45), SRC3 (-7), SRC24 (net 38); derived 45.7 - 7.2 = 38.5 | PASS |
| N19b | Identical circular orbits assumed first | C12 wording "idealised identical-orbit case"; SRC24 live text: "not perfectly circular, or identical, but for now let's pretend that they are" | PASS. Note: ledger quote lacks the word "circular"; confirmed on the live page, not yet stored in the ledger |
| N19b | Common range bias up to about 11 km between daily clock updates | C12, SRC24 "up to about 11 kilometers between daily uploads of clock corrections" | PASS |
| N19b | Receiver could absorb it into clock bias; position estimate survives in this idealized case | C12, SRC24 "common bias ... lumped with ... receiver clock ... position estimate would be unaffected" | PASS, claim limited to the model |
| N19b | GPS time "could drift by 38 us a day" | C12, SRC24 "timing accuracy would have suffered ... 38 microseconds per day between updates" | PASS |
| N29 | Government commits to daily global average signal-in-space ranging error <= 2 m, 95%, across healthy satellites | C13/C21/C25, SRC15 (URE <= 2.0 m, 95% probability, all healthy satellites in constellation slots) | PASS. "U.S. government commits" replaces the candidate's "official GPS standard" (SRC15 says "the government commits"; the SPS Performance Standard document is not in the ledger) |
| N29 | On one day in 2021 that average was at most about 64 cm | C21/C25, SRC15 "April 20, 2021 ... <= 0.643 m, 95% of the time" | PASS. "At most" added: source is an upper bound at 95%, the candidate's "was about" read as equality |
| N29 | Not the phone's accuracy; phones typically within about 5 m under open sky | C25, C13 (SRC16 4.9 m open sky), SRC15 | PASS |

Deterministic checks (qa/script-qa-v4.json): 0 FAIL, 0 undisposed REVIEW. Findings that the review candidate's wording triggered and that were fixed: NUMBER_NOT_IN_EVIDENCE (ordinal "ninety-fifth" parsed as 90), FORBIDDEN_BY_LEDGER C12 ("position error" in N29), NATURALNESS_REPETITIVE_SENTENCE_OPENING ("The receiver" x3 after N19b).
Consistency N03 -> N17 -> N18 -> N19b -> N20 -> N21: all 38 us/day statements are conditional ("without correction"/"uncorrected"/"ignoring relativity"); N20 (factory offset) and N21 (eccentricity residual) unchanged and consistent. N19 unchanged ("38 microseconds a day sounds tiny" refers to the offset, not an operational error).
