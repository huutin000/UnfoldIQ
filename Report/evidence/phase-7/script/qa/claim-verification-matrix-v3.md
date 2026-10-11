# Claim verification matrix: GPS script v3

Ledger 1.2.0. Class: SOURCED (quote in cited sources), SOURCED+DERIVED (also a reproducible derivation), EXPLAIN (geometry/arithmetic/definition, no external fact). Number verdicts come from `lib/script-qa/numbers.js` (MATCH, MATCH_QUALIFIED, COARSE, MISMATCH, NO_EVIDENCE). "Verified" is a deterministic result, not an independent human fact-check.

| Scene | Class | Claims | Sources | Spoken numbers vs evidence | Lead quote | Open findings | Result |
|---|---|---|---|---|---|---|---|
| N01 | SOURCED | C13, C1 | SRC10 | - | C13/SRC16: "For example, GPS-enabled smartphones are typically accurate to within a 4.9 m (16 ft.) rad" | - | VERIFIED |
| N02 | SOURCED+DERIVED | C5, C1 | SRC10 | one billionth -> MATCH; thirty -> MATCH | C5/SRC2: "In GPS positioning the rate is how fast the radio signal travels, which is equal to the sp" | - | VERIFIED |
| N03 | SOURCED+DERIVED | C11, C23 | SRC3, SRC24 | thirty eight -> MATCH | C11/SRC3: "These satellites hurtle so fast through space that special relativity indicates they shoul" | - | VERIFIED |
| N04 | EXPLAIN | - | - | five -> EXPLAIN | - | - | VERIFIED |
| N05 | SOURCED | C3 | SRC2 | - | C3/SRC2: "GPS positioning works on two basic mathematical concepts. The first is called trilateratio" | - | VERIFIED |
| N06 | SOURCED | C3 | SRC2 | - | C3/SRC2: "GPS positioning works on two basic mathematical concepts. The first is called trilateratio" | - | VERIFIED |
| N07 | SOURCED | C7 | SRC14 | two -> MATCH | C7/SRC18: "The Coarse/Acquisition code (C/A(t)), which is modulated only on L1. It has a chipping-rat" | - | VERIFIED |
| N08 | SOURCED+DERIVED | C4 | SRC1, SRC21 | twenty thousand two hundred -> MATCH; three -> MATCH; fourteen thousand -> MATCH | C4/SRC1: "GPS satellites fly in medium Earth orbit (MEO) at an altitude of approximately 20,200 km (" | - | VERIFIED |
| N09 | SOURCED | C6 | SRC4, SRC1 | twenty four -> MATCH; fifty five -> MATCH | C6/SRC4: "Space Segment: A constellation of at least 24 US government satellites distributed in six " | - | VERIFIED |
| N10 | SOURCED | C7, C1, C2 | SRC14, SRC4 | - | C7/SRC18: "The Coarse/Acquisition code (C/A(t)), which is modulated only on L1. It has a chipping-rat" | - | VERIFIED |
| N11 | SOURCED+DERIVED | C5 | SRC2 | three hundred thousand -> MATCH | C5/SRC2: "In GPS positioning the rate is how fast the radio signal travels, which is equal to the sp" | - | VERIFIED |
| N12 | SOURCED+DERIVED | C5, C8 | - | seven hundredths -> MATCH; one -> MATCH; three hundred -> MATCH | C5/SRC2: "In GPS positioning the rate is how fast the radio signal travels, which is equal to the sp" | - | VERIFIED |
| N13 | SOURCED | C8 | SRC1, SRC3, SRC24, SRC14 | - | C8/SRC3: "Though not designed as a test of Einstein, GPS satellites — the ones that control the blue" | - | VERIFIED |
| N14 | SOURCED | C9 | SRC17 | - | C9/SRC17: "The right side contains the four unknown parameters: The receiver coordinates [math]\displ" | WEAK_EVIDENCE_OVERLAP(accepted) | VERIFIED |
| N15 | SOURCED | C9 | SRC17, SRC5 | - | C9/SRC17: "The right side contains the four unknown parameters: The receiver coordinates [math]\displ" | - | VERIFIED |
| N16 | SOURCED | C10, C9 | SRC7 | - | C10/SRC7: "Precise synchronization of communications systems, power grids, financial networks, and ot" | - | VERIFIED |
| N17 | SOURCED+DERIVED | C11 | SRC3, SRC21 | fourteen thousand -> NO_EVIDENCE; seven -> MATCH | C11/SRC3: "These satellites hurtle so fast through space that special relativity indicates they shoul" | - | VERIFIED |
| N18 | SOURCED+DERIVED | C11 | SRC3, SRC21, SRC5 | forty five -> MATCH; thirty eight -> MATCH | C11/SRC3: "These satellites hurtle so fast through space that special relativity indicates they shoul" | - | VERIFIED |
| N19 | SOURCED+DERIVED | C11, C23, C8 | SRC24 | thirty eight -> MATCH; three -> MATCH; ten -> MATCH | C11/SRC3: "These satellites hurtle so fast through space that special relativity indicates they shoul" | - | VERIFIED |
| N19b | SOURCED+DERIVED | C12, C11 | SRC24 | eleven -> MATCH; thirty eight -> MATCH | C12/SRC24: "A GPS receiver would have meas-ured the ranges to all satellites in view as too short by a" | - | VERIFIED |
| N20 | SOURCED+DERIVED | C22, C11 | SRC24, SRC5 | four and a half parts in ten billion -> MATCH | C22/SRC24: "The relativistic effects discussed so far can be compensated for easily by setting the fre" | - | VERIFIED |
| N21 | SOURCED+DERIVED | C18 | SRC24, SRC5 | forty five -> MATCH; fifteen -> MATCH | C18/SRC5: "This correction must be made by the receiver; it is a correction to the coordinate time as" | - | VERIFIED |
| N22 | SOURCED | C7 | SRC18 | one thousand twenty three -> MATCH | C7/SRC18: "The Coarse/Acquisition code (C/A(t)), which is modulated only on L1. It has a chipping-rat" | - | VERIFIED |
| N23 | SOURCED | C7, C9, C20 | SRC19, SRC17 | - | C7/SRC18: "The Coarse/Acquisition code (C/A(t)), which is modulated only on L1. It has a chipping-rat" | - | VERIFIED |
| N24 | SOURCED+DERIVED | C24 | SRC18, SRC14 | three hundred -> MATCH; one -> MATCH; fifty -> MATCH; six -> MATCH | C24/SRC18: "The Coarse/Acquisition code (C/A(t)), which is modulated only on L1. It has a chipping-rat" | - | VERIFIED |
| N25 | SOURCED | C13 | SRC20 | two point three -> MATCH; ten -> MATCH | C13/SRC16: "For example, GPS-enabled smartphones are typically accurate to within a 4.9 m (16 ft.) rad" | - | VERIFIED |
| N26 | SOURCED | C19, C14 | SRC13, SRC11 | - | C19/SRC13: "the difference between the measured range (with the frequency [math]\displaystyle{ f }[/ma" | - | VERIFIED |
| N27 | SOURCED | C13 | SRC12, SRC15 | - | C13/SRC16: "For example, GPS-enabled smartphones are typically accurate to within a 4.9 m (16 ft.) rad" | - | VERIFIED |
| N28 | SOURCED | C20 | SRC17 | - | C20/SRC17: "From the code pseudorange measurements [math]\displaystyle{ R^j }[/math] for, at least, fo" | - | VERIFIED |
| N29 | SOURCED | C25, C21, C13 | SRC15, SRC16 | two -> MATCH; ninety five -> MATCH; 2021 -> MATCH; one -> MATCH_QUALIFIED; five -> MATCH | C25/SRC16: "To calculate its position, a GPS device measures its distance (range) from multiple GPS sa" | - | VERIFIED |
| N30 | SOURCED | C15 | SRC22 | 2000 -> MATCH | C15/SRC22: "Selective Availability (SA) was an intentional degradation of public GPS signals implement" | - | VERIFIED |
| N31 | SOURCED | C14 | SRC8 | - | C14/SRC8: "A GPS augmentation is any system that aids GPS by providing accuracy, integrity, availabil" | - | VERIFIED |
| N32 | SOURCED | C14 | SRC11, SRC9 | - | C14/SRC8: "A GPS augmentation is any system that aids GPS by providing accuracy, integrity, availabil" | - | VERIFIED |
| N33 | SOURCED | C5, C11, C13, C23 | SRC24 | - | C5/SRC2: "In GPS positioning the rate is how fast the radio signal travels, which is equal to the sp" | - | VERIFIED |
| N34 | SOURCED | C16 | SRC23 | - | C16/SRC23: "The Global Positioning System (GPS) is revolutionizing and revitalizing the way nations op" | - | VERIFIED |
| N35 | SOURCED | C17 | SRC3, SRC21 | - | C17/SRC3: "At a much smaller scale, clock scientists have also observed gravitational time dilation i" | - | VERIFIED |
| N36 | RECAP/SOURCES | - | - | - | - | - | VERIFIED |

Totals: 37 scenes; SOURCED 23, SOURCED+DERIVED 12, EXPLAIN 1, RECAP/SOURCES 1; REVIEW 0.
