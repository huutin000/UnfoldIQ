"""
Step 17: Long-Form Acceptance Test (>= 20,000 characters)
Natural multi-topic documentary narration script.
"""

import sys
sys.path.insert(0, r"D:\Project\UnfoldIQ")

import json
import time
import urllib.request
from pathlib import Path
from studio.audio_service import probe_audio
from studio.text_chunker import build_and_verify_manifest

BASE_URL = "http://127.0.0.1:7860"

# Generate a high-quality multi-paragraph narrative text > 20,000 chars
paragraphs = [
    (
        "Chapter One: The Awakening of Consciousness. "
        "For nearly two million years, early hominids traversed the vast African savannah beneath an unyielding sky; "
        "they observed the cycles of drought and flood, the migrations of wildebeest, and the quiet ruthlessness of apex predators. "
        "Were these ancestral humans merely surviving, or were they already asking the profound questions that define our species today? "
        "Evidence from ancient campsites reveals carefully shaped stone tools, charred bones indicative of controlled fire, "
        "and fragmented pigments of red ochre. To command fire was not merely a technological breakthrough; it transformed the night from a realm of terror into a sanctuary for storytelling, collaboration, and social cohesion."
    ),
    (
        "Consider the dynamics of social grooming and vocal communication. "
        "As group sizes expanded beyond fifty individuals, physical grooming became mathematically unsustainable; "
        "there simply were not enough waking hours in the day to maintain bonds individually through touch alone. "
        "Language, therefore, emerged as an evolutionary necessity—a form of 'vocal grooming' that allowed one speaker to connect simultaneously with multiple listeners. "
        "Through rhythmic vocalizations, inflection, and cooperative gestures, our ancestors constructed the earliest shared myths. "
        "What began as simple warnings—a sharp cry denoting a stalking leopard or a low murmur signaling water—gradually evolved into complex grammar capable of conveying abstract metaphors and counterfactual scenarios."
    ),
    (
        "Chapter Two: The Great Dispersal across Continents. "
        "Roughly seventy thousand years ago, small bands of Homo sapiens began crossing the Bab-el-Mandeb strait, venturing into the uncharted expanses of Eurasia. "
        "They encountered starkly unfamiliar climates: freezing glacial steppes, dense temperate woodlands, and arid desert plateaus. "
        "Along the way, they met other archaic human species, including the Neanderthals in Europe and the mysterious Denisovans in the Altai mountains. "
        "Far from engaging in constant hostility, genetic evidence now confirms that interbreeding occurred repeatedly. "
        "Modern human genomes carry durable genetic signatures from these encounters; high-altitude adaptations in Tibetan populations, for instance, trace directly to ancient Denisovan alleles."
    ),
    (
        "The cognitive flexibility demonstrated during this era remains breathtaking. "
        "In the caves of Lascaux, Chauvet, and Sulawesi, artists blew charcoal dust through hollowed bird bones to immortalize surging bison, horses, and hand stencils. "
        "Why venture hundreds of meters into pitch-black subterranean chambers simply to paint on damp limestone walls? "
        "Anthropologists suggest that these chambers served as ceremonial spaces where young initiates experienced profound sensory isolation, illuminated only by flickering tallow lamps. "
        "Art was not an idle pastime; it was an externalized cognitive archive—a visual library documenting animal behavior, seasonal migrations, and ancestral totems."
    ),
    (
        "Chapter Three: The Agricultural Paradigm Shift. "
        "Around twelve thousand years ago, as the last glacial maximum receded and global temperatures stabilized, human societies in the Fertile Crescent initiated an unprecedented experiment: agriculture. "
        "In valleys flanked by the Tigris and Euphrates rivers, gatherers began cultivating wild emmer wheat, einkorn, and barley. "
        "Simultaneously, they domesticated wild goats, sheep, and cattle. "
        "This shift produced reliable caloric surpluses, enabling sedentary villages to burgeon into the world's first true urban centers: Uruk, Eridu, and Jericho. "
        "Yet this transition came with severe trade-offs; skeletal remains reveal increased rates of dental caries, repetitive strain injuries, and infectious epidemics transmitted from herd animals."
    ),
    (
        "With surplus grain came the imperative for bureaucratic administration. "
        "How does a priestly administration verify whether a farmer has delivered fifty bushels of barley or sixty? "
        "The response was the invention of cuneiform script in ancient Sumer. "
        "Clay tokens enclosed within hollow bullae gave way to flat clay tablets impressed with reed styluses. "
        "The earliest recorded human names in history are not those of conquerors or kings, but of accountants and storehouse managers: such as Kushim, who recorded receipts of barley over multiple harvesting cycles. "
        "Writing transformed ephemeral spoken sound into permanent physical stone and clay."
    ),
    (
        "Chapter Four: The Architecture of Thought and Reason. "
        "Across the Aegean Sea, the city-states of classical Greece pioneered new modes of philosophical and scientific inquiry. "
        "In the agora of Athens, Socrates challenged conventional dogmas through relentless dialectical interrogation: 'The unexamined life is not worth living,' he declared before his jurors. "
        "His student Plato founded the Academy, positing an eternal realm of ideal mathematical forms existing beyond imperfect sensory perceptions. "
        "Aristotle, meanwhile, turned his keen empirical gaze toward the natural world, dissecting marine specimens, categorizing botanical species, and formalizing the rules of deductive syllogism. "
        "This intellectual tradition bridged civilizations; Islamic scholars in Baghdad's House of Wisdom translated, preserved, and expanded upon these Greek treatises while Europe languished in the early Middle Ages."
    ),
    (
        "Mathematics blossomed concurrently across diverse cultures. "
        "In ancient India, mathematicians conceived the concept of zero—'shunya'—not merely as an empty placeholder, but as a foundational numerical value capable of arithmetic manipulation. "
        "Aryabhata calculated the value of pi with remarkable precision and posited that the Earth rotated daily upon its own axis. "
        "Centuries later, the Persian scholar Al-Khwarizmi formulated systematic techniques for balancing linear and quadratic equations, giving rise to the discipline of algebra. "
        "These universal mathematical insights traveled along maritime silk routes and caravan trails, stitching together the intellectual heritage of humanity."
    ),
    (
        "Chapter Five: The Scientific Revolution and Celestial Mechanics. "
        "By the sixteenth century, the geocentric cosmos of Ptolemy and Aristotle could no longer reconcile observational anomalies. "
        "Nicolaus Copernicus, working quietly in Frombork Cathedral, dared to place the Sun at the center of the planetary orbits in 'De revolutionibus orbium coelestium.' "
        "Decades later, Johannes Kepler derived his three immutable laws of planetary motion, showing that planetary orbits were not perfect circles, but subtle ellipses. "
        "When Galileo Galilei directed his newly fashioned spyglass toward the night sky in 1609, he witnessed mountains upon the Moon, four moons orbiting Jupiter, and sunspots traversing the solar disc. "
        "The heavens were not unchanging crystal spheres; they were composed of the same physical matter as the Earth itself."
    ),
    (
        "Isaac Newton synthesized these discoveries into a unified mathematical framework with his 'Philosophiae Naturalis Principia Mathematica' in 1687. "
        "By demonstrating that the same gravitational force causing an apple to fall from a branch also governs the Moon's perpetual orbit, Newton dismantled the ancient distinction between terrestrial and celestial physics. "
        "His differential calculus provided the computational engine for predicting mechanics, optics, and thermodynamics. "
        "Nature, it seemed, obeyed elegant mathematical laws accessible to human reason; the clockwork universe had arrived."
    ),
    (
        "Chapter Six: Thermodynamics, Steam, and the Industrial Crucible. "
        "The eighteenth and nineteenth centuries witnessed the harness of mechanical energy from fossilized carbon. "
        "Thomas Newcomen and James Watt refined steam engine designs, liberating human productivity from the organic constraints of muscular and animal power. "
        "Coal-fired locomotives crisscrossed continents on steel rails; steamships traversed oceans independent of prevailing trade winds. "
        "In textile mills and foundries, the rhythms of human existence decoupled from natural sunrise and sunset, bound instead to the relentless ticking of the factory clock. "
        "Urban populations surged as rural agrarian communities migrated toward industrial metropolises, giving birth to modern labor movements, social philosophies, and public sanitation systems."
    ),
    (
        "Concurrently, physicists wrestled with the fundamental laws governing heat and work. "
        "Sadi Carnot analyzed the ideal efficiency of heat engines; Rudolf Clausius and Lord Kelvin formulated the laws of thermodynamics. "
        "The concept of entropy entered the lexicon: the realization that within closed systems, disorder inexorably increases, defining the irreversible thermodynamic arrow of time. "
        "Energy cannot be created or destroyed, yet its utility steadily dissipates. "
        "How do living organisms resist this entropic decay? "
        "As Erwin Schrödinger later remarked, life sustains its intricate order by continually importing negative entropy from its surrounding environment."
    ),
    (
        "Chapter Seven: The Quantum Frontier and Relativistic Space-Time. "
        "At the dawn of the twentieth century, classical physics encountered insurmountable crises: the ultraviolet catastrophe of blackbody radiation and the constancy of the speed of light. "
        "Albert Einstein proposed that light is emitted and absorbed in discrete packets or quanta, while his special theory of relativity established that space and time are interconnected facets of a four-dimensional continuum. "
        "Mass and energy were revealed to be interchangeable through the famous equation E equals m c squared. "
        "Ten years later, his general theory of relativity reimagined gravity not as an invisible pull between masses, but as the curvature of spacetime induced by mass and energy."
    ),
    (
        "Simultaneously, the quantum realm defied deterministic intuition. "
        "Niels Bohr, Werner Heisenberg, and Erwin Schrödinger formulated a probabilistic mechanics of the microscopic world. "
        "Heisenberg's uncertainty principle demonstrated that the position and momentum of a subatomic particle cannot simultaneously be determined with arbitrary precision. "
        "Particles exhibited wave-particle duality, existing in superpositions of states until measured or disrupted by their environment. "
        "Einstein remained famously skeptical, insisting that 'God does not play dice with the universe.' "
        "Yet decades of rigorous experiments, from Bell inequality tests to modern quantum computation, have repeatedly confirmed quantum theory's strange and counterintuitive validity."
    ),
    (
        "Chapter Eight: The Code of Life and Molecular Architecture. "
        "While physicists probed the nucleus of the atom, biological sciences unraveled the molecular blueprint of living organisms. "
        "In 1953, James Watson and Francis Crick, building upon Rosalind Franklin's seminal X-ray diffraction images, deduced the double-helix structure of deoxyribonucleic acid. "
        "Four nitrogenous bases—adenine, thymine, cytosine, and guanine—encode the hereditary information of all terrestrial organisms. "
        "Through transcription into messenger RNA and translation by cellular ribosomes, these nucleotide triplets direct the assembly of amino acid polypeptide chains into functional proteins."
    ),
    (
        "The implications of this molecular clarity reshaped medicine, agriculture, and evolutionary biology. "
        "Every organism on Earth, from the extremophile bacteria thriving in deep-sea volcanic vents to the sequoia trees reaching skyward in Pacific forests, shares the exact same genetic code. "
        "The tree of life is not a collection of isolated creations, but a continuous genealogical tapestry stretching back nearly four billion years to the last universal common ancestor. "
        "Today, technologies like CRISPR-Cas9 allow scientists to edit this code with surgical precision, unlocking curative treatments for hereditary diseases while presenting profound ethical frontiers."
    ),
    (
        "Chapter Nine: The Information Age and Computational Intelligence. "
        "During the Second World War, mathematicians like Alan Turing and Claude Shannon laid the theoretical foundations for digital computation and information theory. "
        "Turing conceived of an abstract machine capable of executing any algorithmic procedure given sufficient tape and instructions. "
        "Shannon quantified information itself, defining the binary digit—or bit—as the fundamental unit of uncertainty reduction. "
        "The transition from bulky vacuum tubes to solid-state silicon transistors, and eventually to integrated microchips containing billions of microscopic gates, propelled an exponential surge in computational power."
    ),
    (
        "The digital revolution democratized global access to knowledge, connecting humanity through decentralized fiber-optic networks and orbital satellite constellations. "
        "Billions of human beings now carry pocket-sized computers possessing millions of times more memory and processing speed than the guidance computers that navigated Apollo eleven to the lunar surface. "
        "Artificial neural networks, inspired by the synaptic architectures of biological brains, analyze complex patterns in astronomical data, predict three-dimensional protein folding, and synthesize natural human speech with unprecedented fidelity. "
        "We stand on the precipice of an era where machine cognition assists human discovery across every frontier."
    ),
    (
        "Chapter Ten: The Cosmic Perspective and Our Shared Future. "
        "When the Voyager one spacecraft reached the outer edge of our planetary system in 1990, Carl Sagan requested that its cameras look back one final time toward Earth. "
        "In the resulting photograph, our planet appeared as a solitary pale blue dot suspended within a sunbeam. "
        "'Look again at that dot,' Sagan wrote. 'That's here. That's home. That's us. On it everyone you love, everyone you know, everyone you ever heard of, every human being who ever was, lived out their lives.' "
        "All our historical triumphs, ideological conflicts, artistic achievements, and profound heartaches occurred on that tiny mote of dust, floating in a vast cosmic arena."
    ),
    (
        "As we gaze toward the century ahead, our challenges demand global solidarity and ecological stewardship. "
        "Climate destabilization, biodiversity loss, and emerging technological risks test our collective wisdom. "
        "Yet the story of humanity is one of resilience, insatiable curiosity, and profound cooperation. "
        "From small bands huddling around prehistoric campfires in the African dusk to robotic rovers exploring the rusted plains of Mars, our journey has always been propelled by the courage to venture beyond known horizons. "
        "We are the cosmos contemplating itself; let us honor that inheritance by building a future worthy of our children."
    ),
    (
        "Chapter Eleven: The Abyssal Deep and Subterranean Biospheres. "
        "For centuries, natural philosophers assumed that marine life could not exist beneath the bathypelagic zone, where crushing hydrostatic pressure, absolute darkness, and freezing temperatures prevail. "
        "In 1977, oceanographers exploring the Galapagos Rift aboard the submersible Alvin made an astounding discovery: hydrothermal vents spewing superheated, mineral-rich fluids at three hundred and fifty degrees Celsius. "
        "Clustered around these black smokers were entirely alien ecosystems thriving without sunlight: giant tube worms lacking digestive tracts, ghostly white crabs, and chemosynthetic sulfur-oxidizing bacteria. "
        "Life, it turned out, does not strictly depend on solar photosynthesis. "
        "This revelation dramatically expanded the search for extraterrestrial habitability, turning planetary eyes toward the sub-surface oceans of Jupiter's moon Europa and Saturn's Enceladus."
    ),
    (
        "Chapter Twelve: The Architecture of Mind and Memory. "
        "Nestled within the human cranium resides the most complex physical structure known in the observable universe: eighty-six billion neurons interconnected by over one hundred trillion synaptic junctions. "
        "How do electrochemical impulses traveling across microscopic lipid membranes give rise to subjective sensations of joy, longing, and vivid memory? "
        "Neuroscientists have mapped the critical role of the hippocampus in consolidating episodic experiences into distributed neocortical networks. "
        "Synaptic plasticity—the capacity of neural connections to strengthen or weaken through long-term potentiation—forms the physical basis of learning. "
        "We are not static machines; our brains physically reshape their internal wiring in response to every thought, skill, and environmental challenge encountered throughout a lifetime."
    ),
    (
        "Chapter Thirteen: Stellar Nucleosynthesis and Cosmic Origins. "
        "Every heavy atom in the universe, from the iron surging in our hemoglobin to the calcium fortifying our bones, was forged within the nuclear crucibles of long-dead stars. "
        "In the earliest moments of the Big Bang, primordial nucleosynthesis produced only hydrogen, helium, and trace amounts of lithium. "
        "It was the gravitational collapse of massive first-generation stars that catalyzed the fusion of carbon, nitrogen, oxygen, and silicon. "
        "When these celestial titans exhausted their nuclear fuel, they collapsed under their own immense gravity and exploded in cataclysmic supernovae, blasting enriched elements across interstellar nebulae. "
        "New star systems condensed from these dusty debris clouds; we are quite literally the ashes of ancient stellar furnaces."
    ),
    (
        "Chapter Fourteen: Complex Systems, Chaos, and Emergence. "
        "From the murmurations of starlings wheeling in unison across autumnal skies to the turbulent eddies of river rapids, nature demonstrates the principle of emergent complexity. "
        "In non-linear dynamical systems, simple underlying interactions between individual agents give rise to spontaneous, coherent macro-level phenomena that cannot be predicted by analyzing the components in isolation. "
        "Edward Lorenz famously discovered deterministic chaos in meteorological models, coining the term 'butterfly effect': the sensitive dependence on initial conditions where the flap of a butterfly's wings in Brazil might set off a tornado in Texas weeks later. "
        "Understanding emergence teaches humility; it demonstrates that predictability has fundamental mathematical boundaries even within entirely deterministic universes."
    ),
    (
        "Chapter Fifteen: Language, Syntax, and Cognitive Scaffolding. "
        "The cognitive scientist Noam Chomsky revolutionized linguistics by proposing that all human languages share a universal grammar wired into human biology. "
        "Children acquire intricate syntactic rules effortlessly without formal instruction, navigating recursive structures with astounding agility. "
        "Consider recursive embedding: 'The scientist who studied the stars that illuminated the ancient desert observed a pattern.' "
        "This capacity for discrete infinity—combining a finite vocabulary into an infinite repertoire of unique propositions—is unique to our species. "
        "Language functions not merely as an acoustic transmission medium; it is a cognitive operating system, providing the conceptual scaffolding for mathematical calculation, deductive reasoning, and empathy."
    ),
    (
        "Chapter Sixteen: The Relic Echoes of the Primordial Universe. "
        "In 1965, two radio astronomers in New Jersey, Arno Penzias and Robert Wilson, detected an inexplicable microwave hiss emanating uniformly from every direction in the sky. "
        "Neither pigeons nesting within their horn antenna nor terrestrial electronic interference could explain the signal. "
        "They had stumbled upon the cosmic microwave background radiation: the cooled, red-shifted remnant afterglow of the Big Bang itself, dating back three hundred and eighty thousand years after the cosmic dawn. "
        "Minute temperature fluctuations within this primordial light, mapped with exquisite precision by modern space telescopes like Planck and WMAP, represent the gravitational seeds that blossomed into galaxies, star clusters, and cosmic voids. "
        "We are holding an optical baby picture of our universe, deciphering the conditions under which matter, light, and geometry first converged."
    ),
    (
        "Chapter Seventeen: Epilogue on Curiosity and Exploration. "
        "As we conclude this panoramic reflection on our journey from archaic savannahs to planetary orbit, one unifying thread binds every chapter: our insatiable hunger to understand the unknown. "
        "We do not build observatories, compose symphonies, or split atoms because survival requires it; we do so because our spirit refuses to remain confined within intellectual shadows. "
        "Every generation inherits the cumulative knowledge of those who came before, standing on the shoulders of forgotten dreamers and patient thinkers. "
        "The horizon ahead is boundless, illuminated by the twin lights of empirical reason and human kindness. "
        "Let us step forward boldly, with open eyes and compassionate hearts, into the wondrous unfolding story of tomorrow."
    )
]

full_script = "\n\n".join(paragraphs)

print("=== STEP 17: LONG-FORM ACCEPTANCE TEST ===")
print("Generated script character count:", len(full_script))
print("Generated script word count:", len(full_script.split()))

if len(full_script) < 20000:
    print(f"ERROR: Script must be at least 20,000 characters! Current: {len(full_script)}")
    sys.exit(1)

# Pre-inference verification
print("\nVerifying chunk plan and text integrity locally before submission...")
manifest = build_and_verify_manifest(full_script, target_chars=400, max_chars=480)
print(f"Local Integrity Check PASS: {manifest['total_chunks']} chunks, {manifest['total_words']} words.")

# Submit job to UnfoldIQ Studio
payload = {
    "script": full_script,
    "project_name": "longform_acceptance_20k",
    "voice": "af_heart",
    "speed": 1.0,
    "language": "American English",
    "export_mp3": True
}

req = urllib.request.Request(
    f"{BASE_URL}/api/jobs",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    start_resp = json.loads(resp.read().decode("utf-8"))

job_id = start_resp["job_id"]
print(f"Submitted Job ID: {job_id}")
print(f"Estimated duration: {start_resp['estimated_duration_seconds']}s (~{round(start_resp['estimated_duration_seconds']/60, 1)} mins)")

# Poll job progress
last_chunk = -1
start_t = time.time()
while True:
    time.sleep(1.5)
    with urllib.request.urlopen(f"{BASE_URL}/api/jobs/{job_id}") as resp:
        job = json.loads(resp.read().decode("utf-8"))
    
    current_chunk = job.get("current_chunk", 0)
    if current_chunk != last_chunk or job["state"] in ("stitching", "completed", "failed"):
        print(f"[{round(time.time() - start_t, 1)}s] State: {job['state']:10s} | Progress: {job['progress_percent']:3d}% | Chunk: {current_chunk:2d}/{job['total_chunks']:2d}")
        last_chunk = current_chunk

    if job["state"] in ("completed", "failed", "cancelled"):
        break

if job["state"] != "completed":
    print("FAILED:", job.get("error_message"))
    sys.exit(1)

project_dir = Path(job["project_dir"])
print(f"\nLong-form synthesis COMPLETED in {job['elapsed_seconds']}s!")
print(f"Project Directory: {project_dir}")

# Check files
wav_path = project_dir / "audio.wav"
mp3_path = project_dir / "audio.mp3"
settings_path = project_dir / "settings.json"
manifest_path = project_dir / "manifest.json"

print(f"audio.wav exists: {wav_path.is_file()} ({wav_path.stat().st_size:,} bytes)")
print(f"audio.mp3 exists: {mp3_path.is_file()} ({mp3_path.stat().st_size:,} bytes)")

# Probe final master audio
wav_info = probe_audio(wav_path)
print("\n--- FFPROBE MASTER WAV ANALYSIS ---")
print(json.dumps(wav_info, indent=2))

mp3_info = probe_audio(mp3_path)
print("\n--- FFPROBE EXPORT MP3 ANALYSIS ---")
print(json.dumps(mp3_info, indent=2))

# Export to outputs/
exp_req = urllib.request.Request(
    f"{BASE_URL}/api/projects/{project_dir.name}/export",
    data=json.dumps({"format": "mp3"}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(exp_req) as resp:
    exp_res = json.loads(resp.read().decode("utf-8"))
print("\nExport to outputs/ result:", exp_res)
