# GPS explainer — spoken script DRAFT v2 (for owner review; NOT locked, no audio)

Status: DRAFT v2. `FINAL_SCRIPT_LOCKED = NO`. No TTS, no render, no regression. Language: English (Kokoro `am_michael`, voice bible `vb-19f4fd6a4596`), American spelling. Every factual sentence maps to `Report/evidence/phase-7/research/claim-ledger.json` v1.1.0 (C1–C21; SRC ids are the ledger source ids: SRC3 NIST, SRC5 Ashby, SRC11 civil signals, SRC13 iono, SRC14 nav message, SRC15/16 accuracy, SRC17 code-based positioning, SRC21 GPS World, SRC22 selective availability, SRC23 GPS in space). "Explain" = geometry, arithmetic or definition. Numbers are written as spoken words; a pronunciation pass runs before TTS. Scene IDs (N01...) are new and are not a quota; shot durations will follow the real audio.

**Visual route** (Hybrid Visual Routing kept): `D` = DiagramScene (procedural SVG spec), `F` = approved Flow-shortlist still + Remotion 2D + deterministic overlay, `F?` = Flow only if credits and quality allow, else D. No parallax/3D claims; the only Veo candidate stays the city-canyon shot (N27).

| # | Chapter | Narration | Evidence | Visual |
|---|---|---|---|---|
| N01 | 1 Hook | Your phone can find you on Earth to within a few meters. Yet not one GPS satellite is tracking it. They only broadcast, like lighthouses. | C13 (4.9 m), C1 (SRC10) | F phone in street (was S01) + D overlay of one-way arrows |
| N02 | 1 | So how does a phone find itself from signals it never answers? By measuring time, so precisely that one billionth of a second is thirty centimeters of error. | C5 (derived: 1 ns = 30 cm) | D ruler 1 ns = 30 cm |
| N03 | 1 | And the clocks involved are strange: the ones on the satellites run faster than yours. Einstein explains why, and engineers estimate that without the fix, errors would grow by roughly ten kilometers a day. | C11, C12 (SRC3, SRC21) | D two clocks + counter |
| N04 | 2 Geometry | First, the geometry. Suppose you are exactly five kilometers from a tower. You could be anywhere on a circle around it. One distance is not enough. | Explain | D one circle |
| N05 | 2 | On a flat map, a second tower gives a second circle, and the two cross in two places. A third circle leaves just one spot where all three meet. Positioning from three distances: trilateration. | C3 (SRC2) | D three circles (fixture exists) |
| N06 | 2 | The real world has three dimensions, so each distance is a sphere. Three spheres can still meet at two points, so a receiver needs more measurements than that. One extra measurement turns out to matter for a surprising reason. | C3 (SRC2 spheres) | D spheres as perspective paths |
| N07 | 2 | All of this assumes the towers know where they are. For GPS, monitor stations track every satellite and work out its exact orbit and clock errors. Ground antennas then upload fresh data, about every two hours under normal conditions, and the satellite rebroadcasts it to users. | C7 (SRC14) | F? ground control (was S17 reserve) else D |
| N08 | 3 Satellites | The satellites orbit about twenty thousand two hundred kilometers up, roughly three Earth radii above your head, moving about fourteen thousand kilometers an hour. Each one circles the planet twice a day. | C4 (SRC1), SRC21 (14,000 km/h), derived 3.2 radii | F satellite and Earth (was S02) + D orbit overlay |
| N09 | 3 | There are at least twenty-four of them, in six orbital planes tilted fifty-five degrees to the equator. That arrangement lets you see at least four satellites from virtually any point on the planet. | C6 (SRC4, SRC1) | D planes + sky view |
| N10 | 3 | Each satellite broadcasts a message: where it is, what time its clock says, how healthy it is, and even a model of the ionosphere. Your phone only has to listen. | C7 (SRC14: ephemeris, clock corrections, health flags, ionospheric model), C1, C2 (SRC4) | D message packet |
| N11 | 4 Time | Radio waves travel at the speed of light, almost three hundred thousand kilometers a second. So distance is speed times travel time. Measure the time, and you know the distance. | C5 (SRC2) | D formula card |
| N12 | 4 | From straight overhead, the signal takes about seven hundredths of a second. Lower in the sky, up to about nine hundredths. Short, but a clock that is off by just one microsecond moves the answer by three hundred meters. | C5, C8 (derived 0.067 s, 0.086 s, 299.8 m) | D timeline bar |
| N13 | 4 | The satellites carry atomic clocks that the ground system keeps checking. Your receiver has to cope with whatever error its own clock has. | C8 (SRC1, SRC3, SRC14, SRC17) | F atomic-clock lab (was S28) + D |
| N14 | 4 | Here is the trick. Suppose every distance comes out too long by the same amount. On a flat map, the three circles no longer meet at one point. Shrink them all equally until they do, and that amount is the clock error. | C9 (Explain; consistent with SRC17 pseudorange model) | D animated circles (key scene) |
| N15 | 4 | In three dimensions, that makes four unknowns: east-west, north-south, height, and the clock error. So the receiver uses at least four satellites and solves for all of them at once. A distance with this clock error baked in is called a pseudorange. | C9 (SRC17, SRC5) | D four spheres + equation card |
| N16 | 4 | As a bonus, the receiver now knows the time, straight from the atomic clocks on the satellites. That timing synchronizes communications systems and power grids, and lets financial transactions carry traceable time tags. Hollywood even uses it in movie slates. | C10 (SRC7), C9 | D list cards |
| N17 | 5 Einstein | Now those atomic clocks have a problem, and it comes from Einstein. Special relativity says moving clocks tick slower. At fourteen thousand kilometers an hour, satellite clocks fall behind ground clocks by about seven microseconds a day. | C11 (SRC3, SRC21) | D bar chart (-7) |
| N18 | 5 | General relativity says clocks tick faster where gravity is weaker. Up there, that adds about forty-five microseconds a day. Together, satellite clocks run about thirty-eight microseconds a day faster than ground clocks. | C11 (SRC3, SRC21, SRC5, derived) | D bar chart (+45, net +38) |
| N19 | 5 | Thirty-eight microseconds sounds tiny, but a signal travels three hundred meters in one. Engineers estimate that, uncorrected, the errors would grow by roughly ten kilometers every day. | C12 (SRC21), derived | D growth chart |
| N20 | 5 | So before launch, each satellite clock is tuned to run slightly slow, by about four and a half parts in ten billion. Once in orbit, relativity cancels that offset. | C11 (SRC5: 4.4647e-10) | D two clocks |
| N21 | 5 | Even then, orbits are slightly oval, so receivers apply one final relativity correction themselves. For a slightly oval orbit it reaches about twenty-three nanoseconds, roughly seven meters. | C18 (SRC5: 23 ns at e = 0.01), derived 6.9 m | D oval orbit |
| N22 | 6 Inside the receiver | How does a receiver time a signal at all? Every satellite sends its own code: a pattern of one thousand twenty-three pulses, repeating every millisecond. | C7 (SRC18) | D code waveform |
| N23 | 6 | The receiver makes the same pattern and slides it until the two match. That shift is how late the signal arrived, by the receiver's own clock. Which is exactly why the result is a pseudorange. | C7 (SRC19), C9 | D sliding waveforms |
| N24 | 6 | The pattern repeats every millisecond, about three hundred kilometers of signal, so the message also carries a time count that tells the receiver which repeat it is hearing. With the orbit data in the message, each satellite becomes one sphere. | derived 299.8 km; SRC14 (message TOW count, ephemeris); inference flagged in risks | D message + waveform |
| N25 | 7 Real world | Between the satellite and your phone, the signal crosses the ionosphere and the troposphere, and both add delay. Dry air alone adds about two point three meters straight overhead, and about ten meters for satellites low on the horizon. Water vapor adds only tens of centimeters, but it changes quickly and is hard to model. | C13 (SRC20: 2.3 m zenith, 10 m low elevation, wet tens of cm) | D layered atmosphere |
| N26 | 7 | The ionosphere changes with the time of day and with solar activity. It delays lower frequencies more, in proportion to one over the frequency squared. So a receiver listening on two frequencies can compare the delays and correct for it. With the newer civil signal L2C, civilian receivers can do exactly that. | C19 (SRC13 eq., day/solar), C14 (SRC11) | D two-frequency plot |
| N27 | 7 | In cities, signals also bounce off buildings. That is called multipath, and it makes a signal look as if it traveled farther. Where buildings, bridges or trees block the signal, the blue dot gets worse. | C13 (SRC12, SRC15) | F city canyon (was S43) + D reflection paths; Veo optional |
| N28 | 7 | Put it all together, and a pseudorange is simply a sum: the true distance, plus the clock errors, plus the ionosphere and troposphere delays, plus multipath and noise. The receiver's whole job is to untangle that sum. | C20 (SRC17 eq. 1) | D equation built term by term |
| N29 | 7 | That is why the satellites' accuracy and yours differ. The government commits to a signal error of at most two meters, and measured under one meter on one day in 2021. Phones typically get within about five meters under open sky. | C13, C21 (SRC15, SRC16) | D three-number chart |
| N30 | 7 | It used to be worse by design. Until May 2000, the United States deliberately degraded the public GPS signal for national security reasons. Then it turned that feature off, and says it has no intent to use it again. | C15 (SRC22) | D timeline card |
| N31 | 7 | Engineers push further. Augmentation systems add corrections; WAAS, run by the FAA, helps aircraft navigate across North America. | C14 (SRC8) | D cards |
| N32 | 7 | Newer civil signals, called L2C, L5 and L1C, are being added next to the original one, but receivers must be upgraded to use them. Other nations fly their own constellations, like Galileo in Europe. | C14 (SRC11, SRC9) | D cards |
| N33 | 8 Close | So when the blue dot lands on the right street, here is what just happened. Signals that left the satellites a fraction of a second ago were timed to a billionth of a second, then corrected for the atmosphere and for relativity. | C5, C11, C13 (SRC21: nanosecond accuracy) | D single flow diagram |
| N34 | 8 | And it is not only for phones. Spacecraft use GPS as a compass, and sometimes even as a clock, replacing expensive atomic clocks on board. | C16 (SRC23) | D spacecraft + GPS signal |
| N35 | 8 | Relativity is not only for satellites. NIST physicists once ran two clocks just a foot apart in height, and they ticked at different rates. Gravity changes how time passes, and every time that blue dot appears, GPS has accounted for it. | C17 (SRC3); SRC3 + SRC21 for the GPS link | F outro backdrop (was S50) + D two clocks |
| N36 | 8 | Every claim in this video is sourced. The list is in the description. | sources | D sources card |

## 1. Word count and narration estimate
- **1227 words, 36 scenes, 94 sentences** (scene length 13 to 55 words). v1 had 1,152 words / 50 scenes.
- **Rate basis (MEASURED, one data point):** the canonical 6A pilot narration (`projects/pilot-sky-blue-canonical/audio/timing.json`, Kokoro `am_michael`, speed 1.1) is 154 words in 57.1 s = **2.70 words/s** including segment pauses, on simple vocabulary. A number-heavy technical script is expected to be slower; 2.45 to 2.5 w/s is the working range (speed 1.0 proxy = 2.70 / 1.1). The real rate for this script is NOT_MEASURED until TTS is approved.

| Rate (w/s) | Basis | Narration length |
|---|---|---|
| 2.70 | 6A measured, speed 1.1, easy text | 7:34 |
| 2.50 | working estimate, technical text | 8:11 |
| 2.45 | speed 1.0 proxy | 8:21 |
| 2.30 | pessimistic (many numerals) | 8:53 |

- **Versus the 8:00 Phase 7 minimum:** the narration alone reaches 8:00 only if the rate is at most 2.56 w/s. At the fast end (2.70) it is about 7:34, so the margin depends on the Kokoro speed chosen at TTS time (1.0 is likelier to clear 8:00 and is clearer for number-heavy sentences). Chapter breathing space and a few narration-free visual beats will add time, but that is unmeasured and not counted here.
- **Not padded:** to close the gap v2 adds only sourced explanations (list below), no filler. If real audio lands under 8:00, the options are a slower Kokoro speed or one more sourced explanation; the decision is yours after a small TTS probe.

## 2. Changes v1 to v2

### 2a. Scientific fixes on the scenes you flagged
| v1 | Problem | v2 fix | Basis |
|---|---|---|---|
| S01 | Implied the blue dot is purely GPS and that "within about five meters" always holds | "to within a few meters" and the one-way fact moved first; the 4.9 m figure is stated later as typical under open sky (N29) | C13, C1 |
| S08 | "Three circles meet at exactly one point" only on a flat map | "On a flat map ... just one spot where all three meet" | C3 |
| S09 | "Spheres meet at your position" is wrong: three spheres meet at two points | N06: three spheres can still meet at two points, so more measurements are needed; the surprising reason (clock) is set up for N14-N15 | C3 (SRC2 spheres) + Explain |
| S22 | "About a tenth of a second" hid that it varies with elevation | N12: about seven hundredths straight overhead, up to about nine hundredths low in the sky | derived 0.0674 s and 0.086 s |
| S24 | "Pulses" and "its own code" without the repeat or what is measured | N23: pattern of 1,023 pulses repeating every millisecond | SRC18 |
| S25 | Said the shift is "the travel time"; it is a delay by the receiver's own clock, ambiguous every millisecond | N23: the shift is how late it arrived by the receiver's own clock, so the result is a pseudorange; N24: a repeat is about 300 km of signal and the message time count says which repeat | SRC19, SRC17, SRC14, derived 299.8 km |
| S34 | "Exactly what time it is" (overclaim) and a pure recap | recap deleted; N16 says the receiver "knows the time, straight from the atomic clocks" with concrete uses | C10 (SRC7) |
| S40 | "GPS only works because designers corrected for relativity" (overclaim) | N03/N19 attribute the size of the effect to engineers' estimates (about ten kilometers a day); no "only works because" claim; N35 says GPS accounts for relativity | SRC21, SRC3 |

### 2b. Storytelling changes
- **Hook:** the paradox is the first sentence pair ("not one GPS satellite is tracking it ... they only broadcast"). N02 poses the question and the nanosecond stake; N03 teases Einstein with the cost. The hook is the first three scenes.
- **Einstein payoff earlier:** the explanation begins at about 3:29 and the full chain (-7, +45, net +38, the 10 km/day stake, the pre-launch fix, the receiver-side correction) ends by about 4:17 (estimates at 2.6 w/s). In v1 the explanation began at about 5:18. The satellite chapter was shortened and the code-correlation detail moved after Einstein ("Inside the receiver").
- **Fewer lecture beats:** deleted v1 S11 (recipe), S14, S19, S34, S41 (reflection), S48 (three ideas to remember) and S50 (thanks). The remaining recaps are only structural (N32 one connecting flow).
- **Ending:** from "thanks" to discovery: N33 the chain behind one dot, N34 spacecraft use GPS as compass and sometimes as clock (SRC23), N35 a clock a foot higher ticks faster and GPS accounts for it (SRC3), N36 the sources line.
- **Added sourced explanations (net +75 words versus v1 after the cuts above):** why every distance being too long by the same amount reveals the clock error (N14, geometry); pseudorange as a sum of terms (N28, SRC17); the 23 ns receiver-side correction (N21, SRC5); dry-air delay 2.3 m overhead and about 10 m low in the sky (N25, SRC20); ionosphere delay scales as 1/f^2 so two frequencies cancel it (N26, SRC13, SRC11); why satellite accuracy and user accuracy differ (N29, SRC15/16); selective availability (N30, SRC22); WAAS and the new civil signals (N31/N32, SRC8/SRC11); the navigation message contents (N10, SRC14); spacecraft use (N34, SRC23).

### 2c. Scene structure: 50 draft scenes become 36 (proposal, not a quota)
| v1 scenes | v2 scene | Note |
|---|---|---|
| S01-S04 | N01-N03 | hook compressed to three scenes |
| S05-S09, S11 | N04-N06 | geometry in three steps; v1 S11 recap deleted |
| S10, S17 | N07 | ground control merged with "towers know where they are" |
| S13-S16, S19 | N08-N09 | orbit and constellation merged |
| S18 | N10 | message contents extended (SRC14) |
| S20-S23 | N11-N12 | speed of light and timing merged |
| S27-S28 | N13 | atomic clocks / receiver clock |
| (new) | N14-N15 | clock-error trick and the fourth unknown (v1 S30-S31) |
| S32-S34 | N16 | time as a bonus; v1 S34 recap deleted |
| S35-S41 | N17-N21 | Einstein chapter moved earlier and tightened; v1 S39 becomes N20; N21 new |
| S24-S26 | N22-N24 | moved after Einstein: "Inside the receiver" |
| S42-S47 | N25-N32 | real world; v1 S47 (limits) folded into N27; v1 S46 into N32 |
| S48-S50 | N33-N36 | discovery ending |

Flow shortlist mapping (budget cap 80 unchanged): S01 to N01, S02 to N08, S28 to N13, S43 to N27 (Veo optional), S50 to N34; reserve S17 to N07; the old reserve S47 (tunnel) is not needed because N27 covers blockage. `scene-plan.json` is NOT yet rewritten; it will be regenerated from the approved v2.

## 3. Factual QA
- **Ledger:** v1.1.0 adds C15-C21 (selective availability, spacecraft use, foot-clock experiment, 23 ns correction, 1/f^2 delay, pseudorange equation terms, URE versus user accuracy) and sources SRC22-SRC23; every quote was extracted programmatically from the acquired page text. All 21 claims are SUPPORTED (C8 after rewrite).
- **Targeted script QA** (`node scripts/checks/script-claim-qa.js ...`, result in `script-qa-v2.json`): **0 FAIL**. Checks: every scene maps to supported claims and existing sources; every spoken number maps to ledger text or a recorded derivation (this caught three mismatches in my first v2 pass, fixed before this version); banned phrases (offline, quartz, "exactly what time", "only works because"); lecture phrases; sentence length; hook rule (paradox in scene 1, Einstein preview in the first three scenes).
- **REVIEW notes (not failures):** N30, N32, N33 contain numbers without an "about/roughly" qualifier because they are dates or product names (May 2000, L2C/L5/L1C) or a defined quantity.
- **Derivations used** (`research/claim-ledger.json`, simplified circular orbit): 3.2 Earth radii, 0.067 s zenith and 0.086 s at the horizon, 1 microsecond = 299.8 m, 1 ms = 299.8 km, 23 ns = 6.9 m, net relativity +38.5 microseconds a day versus NIST 38 and Ashby 38.6.
- **No source was invented.** One new page set was acquired this round (selective availability and GPS in space); search results were used only to find URLs.

## 4. Visual check (Hybrid Visual Routing)
Every narration unit has a route in the table. Exact exposition (geometry, equations, charts, formulas) is DiagramScene; the five Flow stills (N01, N08, N13, N27, N34) carry deterministic labels; the reserve is N07. New authoring needs beyond the current engine: oval orbit and orbit-plane paths, a sliding code waveform (N23), and a layered atmosphere (N25). All are plain path/line/text specs, no new component. The key explanatory scene is N14 (circles shrinking to one point).

## 5. Remaining risks
1. **Ten kilometers a day (N03, N19).** It is the standard published estimate (GPS World citing the literature) and our derivation gives 11.5 km, but a receiver that solves its own clock offset absorbs a clock error common to all satellites. The claim is therefore attributed to "engineers estimate" and framed as growing system error; if you want it harder, drop the number from N03 and keep it in N19 only.
2. **N24 inference.** The navigation message carries a time-of-week count (SRC14); that this resolves the 1 ms repeat is our explanation, not a quoted sentence. Keep or soften.
3. **N29 single-day datum.** "Under one meter on one day in 2021" rests on one GPS.gov value (0.643 m on 20 April 2021); the 4.9 m figure comes from an archived GPS.gov page citing ION.
4. **N14 is a 2D simplification** of the pseudorange model (consistent with SRC17); the 3D version follows in N15.
5. **Source quality:** government pages form one independence group; Navipedia is a reference wiki used for mechanism and for the tropospheric figures; GPS World is secondary; pages are snapshots dated 10-11 Oct 2026.
6. **Duration:** the 8:00 minimum is met only at 2.56 w/s or slower (section 1). The rate is unmeasured for this script.
7. **Pronunciation pass needed** for: microsecond units, ionosphere, troposphere, pseudorange, multipath, L2C/L5/L1C, WAAS, FAA, NIST, Galileo, "one thousand twenty-three".
8. **Creative QA is heuristic at script level** (hook placement, Einstein timing, lecture-phrase scan, ending). The 6A/6B creative gates (rhythm, originality, retention) run on the real timeline; nothing here proves visual variety or channel-level originality.
9. The science explainer still does not validate cinematic storytelling (owner scope note).

## 6. Not done (by instruction)
No FINAL_SCRIPT_LOCKED, no final-spoken-script artifact, no pronunciation pass, no TTS, no render, no Flow generation, no full regression, no paid or cloud API call.
