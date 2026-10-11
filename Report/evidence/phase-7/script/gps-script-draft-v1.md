# GPS explainer — spoken script DRAFT v1 (for owner review, before any audio)

Status: DRAFT. Not locked, no audio made. Language: English (Kokoro), American spelling. Every factual sentence maps to a claim in `Report/evidence/phase-7/research/claim-ledger.json`. "Explain" = uncontroversial explanatory step (analogy, arithmetic or definition), no external source needed under the owner policy. Numbers are written as spoken words; a pronunciation pass still runs before TTS. Scene boundaries and durations are provisional: the real audio decides timing, and scene count is not a quota.

| # | Ch | Narration | Evidence |
|---|---|---|---|
| S01 | 1 Hook | That blue dot on your phone shows where you are, usually within about five meters when you can see the sky. Yet the satellites overhead are not tracking you at all. So how does the dot know? | C13 (4.9 m), C1 (beacons) |
| S02 | 1 | The answer is that your phone is listening. About twenty thousand kilometers up, satellites broadcast signals one way, like lighthouses. Your phone catches them, and does the math. | C1, C4 |
| S03 | 1 | In the next few minutes, three ideas explain it all: how distances become a position, why one tiny clock error matters, and where Albert Einstein comes in. | roadmap |
| S04 | 1 | Because here is the strange part. Without correcting for Einstein's relativity, GPS would drift by roughly ten kilometers every single day. We will get to that. | C12, C11 |
| S05 | 2 Trilateration | Start with a simple idea. If you know where a few landmarks are, and how far you are from each one, you can mark your own spot on a map. | Explain |
| S06 | 2 | Say you are exactly five kilometers from a tower. You could be anywhere on a circle, five kilometers around that tower. One distance is not enough. | Explain |
| S07 | 2 | Add a second tower, and the two circles cross in two places. Now there are only two possible spots. | Explain |
| S08 | 2 | A third distance picks the winner. Three circles meet at exactly one point. That is trilateration: positioning from three distances. | C3 (SRC2) |
| S09 | 2 | The real world has one more dimension. In three dimensions each distance is a sphere, not a circle, and the spheres meet at your position in space. | C3 (SRC2: spheres) |
| S10 | 2 | For this to work, the towers must know exactly where they are. In GPS the towers are satellites, and control stations keep track of every one of them. | C4, C7 (SRC14) |
| S11 | 2 | So the recipe is simple: measure the distance to points whose positions you already know. That is all trilateration ever needs. | C3 |
| S12 | 2 | But the satellites are about twenty thousand kilometers away. How do you measure a distance like that? | C4 |
| S13 | 3 Satellites | GPS satellites fly in what is called medium Earth orbit, about twenty thousand two hundred kilometers up, and each one circles the planet twice a day. | C4 (SRC1) |
| S14 | 3 | To picture that height: it is roughly three Earth radii above your head. Far enough to see a huge part of the planet at once. | C4 + arithmetic (20,200 / 6,371 = 3.2) |
| S15 | 3 | The constellation has at least twenty-four satellites, arranged so that you can see at least four of them from virtually any point on the planet. | C6 (SRC1, SRC4) |
| S16 | 3 | They travel in six orbital planes, each tilted fifty-five degrees to the equator, so the sky stays covered as the Earth turns. | C6 (SRC4) |
| S17 | 3 | On the ground, monitor stations track every satellite, work out its exact orbit and clock errors, and upload fresh data to it. | C7 (SRC14) |
| S18 | 3 | Each satellite then broadcasts a message: here is where I am, and here is the exact time on my clock. | C7 (SRC14) |
| S19 | 3 | At any moment, your receiver listens to the satellites that are above your horizon, and each one tells it the same two things. | C2, C7 |
| S20 | 4 Timing | These signals are radio waves, and radio waves travel at the speed of light: almost three hundred thousand kilometers every second. | C5 (SRC2) |
| S21 | 4 | So distance is just speed times travel time. The receiver measures how long a signal took, and multiplies by the speed of light. | C5 (SRC2: D = R x T) |
| S22 | 4 | From twenty thousand kilometers away, a signal arrives in about a tenth of a second. Short, but measurable. | C5 (derived 0.067 s zenith) |
| S23 | 4 | And the precision needed is extreme. One billionth of a second, a nanosecond, is about thirty centimeters of distance. | C5 (derived) |
| S24 | 4 | How does the receiver measure that time? Each satellite sends its own code, a pattern of one thousand twenty-three pulses that repeats every millisecond. | C7 (SRC18) |
| S25 | 4 | Your receiver makes its own copy of the pattern and slides it until the two line up. The shift needed to match is the travel time. | C7 (SRC19) |
| S26 | 4 | Do that for several satellites and you get several distances: several spheres, one crossing point. That crossing point is you. | C3 |
| S27 | 4 | But there is a catch. All of this assumes your clock agrees perfectly with the satellites' clocks. And it never quite does. | C9 (SRC17: receiver clock offset) |
| S28 | 5 Clocks | Each satellite carries atomic clocks, and the ground system keeps checking and correcting them. | C8 (SRC1, SRC3), C7 (SRC14) |
| S29 | 5 | Your receiver's clock will always be a little off. And a clock that is wrong by just one microsecond, one millionth of a second, puts the distance off by about three hundred meters. | C8 (derived 299.8 m) |
| S30 | 5 | The fix is clever. Treat the clock error as one more unknown to solve for, alongside your position: east and west, north and south, and height. | C9 (SRC17) |
| S31 | 5 | Four unknowns need four measurements. So the receiver uses at least four satellites, and solves for your position and its clock error together. | C9 (SRC17, SRC5), C6 |
| S32 | 5 | As a side effect, your phone ends up knowing the time, accurate to a tiny fraction of a second, straight from the satellites' atomic clocks. | C9, C10 |
| S33 | 5 | That timing is used far beyond maps: to synchronize communications systems, power grids, and financial networks. | C10 (SRC7) |
| S34 | 5 | So GPS gives you two things at once: where you are, and exactly what time it is. | recap |
| S35 | 6 Einstein | Now for Einstein. Special relativity says moving clocks tick slower. Satellites move fast, so their clocks fall behind ground clocks by about seven microseconds a day. | C11 (SRC3) |
| S36 | 6 | General relativity says clocks tick faster where gravity is weaker. Up there gravity is weaker, so the satellite clocks gain about forty-five microseconds a day. | C11 (SRC3, SRC21) |
| S37 | 6 | Put the two effects together, and a satellite clock runs about thirty-eight microseconds a day faster than a clock on the ground. | C11 (SRC3, SRC5, derived) |
| S38 | 6 | Thirty-eight microseconds sounds tiny. But signals travel at the speed of light, and uncorrected, errors would pile up at roughly ten kilometers every day. | C12 (SRC21, derived 11.5 km) |
| S39 | 6 | So before launch, engineers set each satellite clock to tick very slightly slower than normal, to cancel the difference in advance. | C11 (SRC5: 10.23 MHz offset) |
| S40 | 6 | That is the payoff to our opening question mark: GPS only works because its designers corrected for relativity. | C12 (SRC21) |
| S41 | 6 | The effects are small, but they never stop accumulating. That is why tiny effects matter in a system built on nanoseconds. | C11, C12 |
| S42 | 7 Real world | Even with perfect clocks, the signal has to cross the atmosphere. The ionosphere and the troposphere slow it down, and that extra delay has to be estimated. | C13 (SRC13, SRC20) |
| S43 | 7 | In cities, signals also bounce off buildings before they reach you. This is called multipath, and it makes a signal look like it traveled farther than it really did. | C13 (SRC15, SRC12) |
| S44 | 7 | The result: phones are typically accurate to within about five meters under open sky, and worse near buildings, bridges and trees. | C13 (SRC16) |
| S45 | 7 | Engineers push accuracy further. Augmentation systems add corrections, and receivers that use two frequencies can correct the ionosphere delay. | C14 (SRC8, SRC11) |
| S46 | 7 | GPS is the best known system, but other countries run their own, including Europe's Galileo. | C14 (SRC9) |
| S47 | 7 | And there are limits. Where buildings or tunnels block the signals, the blue dot becomes less accurate. | C13 (SRC15: blockage) |
| S48 | 8 Close | Three ideas to remember: distances to known points give a position; a fourth measurement fixes your clock; and relativity has to be corrected. | recap |
| S49 | 8 | So the blue dot is the end of a long chain: satellites broadcasting where they are and when, your phone measuring delays, and math solving for where, and when, you are. | C1, C2, C9 |
| S50 | 8 | Every fact in this video is traced to its sources, listed in the description. Thanks for watching. | sources |

## Script checks
- Claims covered: C1 to C14 all appear. Banned by the ledger: no "works offline", no "cheap quartz clock". The 2D circles are labeled as a teaching analogy (S06 to S08) before the 3D reality (S09). One-way broadcast is stated in S02.
- Deliberately NOT said (no source): "among the most precise clocks ever", "sweet spot altitude", "ignores the rest of the sky", "many phones use several systems".
- Hook: S01 to S02 deliver the GPS answer in the first ~25 s and S04 previews Einstein honestly; the payoff is S35 to S40.
- Open risk: S40 phrase "only works because designers corrected for relativity" is an interpretation of the GPS World quote ("utterly worthless for navigation in a very short time"); keep it only if the owner agrees.
