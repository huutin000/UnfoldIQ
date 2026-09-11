"""
UnfoldIQ Visual Scene Planner — Prompt Engineering Engine
Constructs documentary-grade image prompts, visual summaries, shot metadata,
and negative prompts from canonical source narration text.
Supports cross-domain generality across science, history, prehistory, and technology.
"""

import re
from typing import Dict, Any, List, Optional, Tuple

# Controlled Visual Categories
VISUAL_CATEGORIES = [
    "reconstruction",
    "environment",
    "artifact",
    "map",
    "timeline",
    "anatomy/science",
    "process",
    "comparison",
    "detail/macro",
    "establishing",
    "transition",
]

# Controlled Evidence Modes
EVIDENCE_MODES = [
    "documented",
    "reconstruction",
    "conceptual",
]

# Controlled Shot Types
SHOT_TYPES = [
    "extreme wide",
    "wide",
    "medium wide",
    "medium",
    "medium close-up",
    "close-up",
    "macro/detail",
    "top-down",
    "aerial",
]

# Controlled Camera Motion (Metadata only)
CAMERA_MOTIONS = [
    "static",
    "slow push-in",
    "slow pull-back",
    "slow pan",
    "tracking",
    "orbit",
]

# Universal Global Negative Prompt (Quality & Presentation Hygiene)
GLOBAL_NEGATIVE_PROMPT = (
    "text, subtitles, watermark, logo, UI elements, cartoon, anime, 3d render, "
    "illustration, extra fingers, deformed hands, distorted faces, blur, low quality, "
    "oversaturated fantasy lighting"
)

# Backward-compatible default
DEFAULT_NEGATIVE_PROMPT = (
    f"modern clothing, modern objects, {GLOBAL_NEGATIVE_PROMPT}"
)

DOCUMENTARY_STYLE_TOKENS = (
    "cinematic documentary reconstruction, photorealistic, naturalistic, "
    "scientifically plausible, historically appropriate, realistic anatomy, "
    "natural materials, environmental realism, subtle filmic lighting, high detail"
)


def detect_narration_domain(narration: str) -> str:
    """
    Detect thematic domain to prevent prehistory/paleoanthropology leakage
    into unrelated astrophysics, modern technology, physics, or history topics.
    Returns: 'prehistory' | 'astrophysics' | 'computing_technology' | 'physics_chemistry' | 'general_history' | 'general_science'
    """
    text = narration.lower()

    # 1. Modern Computing / Electronics
    tech_kw = [
        "integrated circuit", "integrated circuits", "microchip", "semiconductor",
        "transistor", "computer", "computers", "computing", "silicon", "software",
        "microprocessor", "electronics", "1960s", "1970s", "1980s", "internet",
        "digital", "motherboard", "cleanroom", "hardware"
    ]
    if any(k in text for k in tech_kw):
        return "computing_technology"

    # 2. Astrophysics / Space
    astro_kw = [
        "neutron star", "black hole", "supernova", "galaxy", "galaxies", "stellar",
        "astrophysics", "astronomy", "telescope", "spacecraft", "celestial", "cosmos",
        "cosmic", "solar mass", "light years", "orbiting", "starfield"
    ]
    if any(k in text for k in astro_kw):
        return "astrophysics"

    # 3. Physics / Chemistry / Thermodynamics
    physics_kw = [
        "entropy", "thermodynamics", "quantum", "dispersion", "disperses", "physical system",
        "molecule", "molecular", "atom", "atomic", "subatomic", "particle", "electromagnetic",
        "kinetic energy", "chemical reaction"
    ]
    if any(k in text for k in physics_kw):
        return "physics_chemistry"

    # 4. Prehistory / Human Evolution / Paleoanthropology
    prehistory_kw = [
        "hominid", "hominids", "hominin", "hominins", "homo habilis", "homo erectus",
        "australopithecus", "neanderthal", "paleolithic", "pleistocene", "olduvai",
        "handaxe", "stone tool", "knapping", "foraging", "scavenging", "hunter",
        "hunters", "prey", "fossil", "fossils", "ancient humans", "early humans",
        "ancestral humans", "african savannah", "savannah", "gorge in tanzania"
    ]
    if any(k in text for k in prehistory_kw):
        return "prehistory"

    # 5. General History
    history_kw = [
        "century", "ancient rome", "ancient greece", "medieval", "renaissance",
        "empire", "dynasty", "archival", "warfare", "monarch"
    ]
    if any(k in text for k in history_kw):
        return "general_history"

    return "general_science"


def build_negative_prompt(domain: str) -> str:
    """Build domain-appropriate negative prompt without cross-domain prohibitions."""
    if domain == "prehistory":
        return f"modern clothing, modern objects, modern footwear, modern technology, fantasy armor, dinosaur with humans, {GLOBAL_NEGATIVE_PROMPT}"
    elif domain == "astrophysics":
        return f"earth clouds in deep space, sci-fi fantasy lasers, cartoon planets, magical effects, {GLOBAL_NEGATIVE_PROMPT}"
    elif domain == "computing_technology":
        # Crucial: DO NOT suppress modern objects on computing / tech scenes!
        return f"ancient stone tools, medieval, fantasy armor, steampunk, {GLOBAL_NEGATIVE_PROMPT}"
    elif domain == "physics_chemistry":
        return f"cartoon characters, fantasy magic, {GLOBAL_NEGATIVE_PROMPT}"
    elif domain == "general_history":
        return f"modern clothing, modern technology, cars, power lines, {GLOBAL_NEGATIVE_PROMPT}"
    return GLOBAL_NEGATIVE_PROMPT


def infer_visual_category(narration: str) -> str:
    """
    Deterministically categorize visual intent based on keyword/pattern matching.
    Small, robust rule set for documentary production.
    """
    text = narration.lower()
    domain = detect_narration_domain(narration)

    # Map / Geography
    if any(k in text for k in ["map", "migration route", "across the continent", "geography", "territory", "border", "route", "gps", "regional"]):
        return "map"

    # Timeline / Chronology
    if any(k in text for k in ["million years", "thousand years", "century", "era", "chronology", "timeline", "millennia", "epoch", "timeline of"]):
        return "timeline"

    # Detail / Macro
    if any(k in text for k in ["microscopic", "striations", "cut marks", "wear pattern", "magnified", "microscopic wear", "fine detail", "close inspection"]):
        return "detail/macro"

    # Process / Knapping / Butchery / Fabrication
    if any(k in text for k in ["knapping", "flaking", "butchery", "butchering", "foraging", "scavenging", "making fire", "manufacturing", "carving", "striking stone", "fabrication", "assembly"]):
        return "process"

    # Anatomy / Science
    if domain in ["astrophysics", "physics_chemistry"]:
        if any(k in text for k in ["mass", "density", "sphere", "energy", "disperses", "entropy", "system", "structure", "quantum", "star", "physics"]):
            return "anatomy/science"
    if any(k in text for k in ["brain", "teeth", "enamel", "cranial", "anatomy", "genetics", "dna", "jaw", "pelvis", "bipedal", "locomotion", "morphology"]):
        return "anatomy/science"

    # Comparison
    if any(k in text for k in ["in contrast", "compared to", "differed from", "whereas", "unlike", "side by side", "diverged", "versus"]):
        return "comparison"

    # Artifact / Physical Evidence / Hardware
    if any(k in text for k in ["fossil", "fossils", "stone tool", "handaxe", "flint", "bone tool", "artifact", "pottery", "beads", "flakes", "blade", "skull", "skeleton", "assemblage", "integrated circuit", "circuits", "microchip"]):
        return "artifact"

    # Establishing / Grand Scope (Only trigger on chapter if prehistoric/history or explicit landscape)
    if any(k in text for k in ["vast african", "vast savannah", "horizon", "rift valley", "endless landscape", "great expanse", "wilderness", "open ocean", "mountain range"]):
        return "establishing"
    if text.startswith("chapter ") and domain in ["prehistory", "general_history"]:
        return "establishing"

    # Environment
    if any(k in text for k in ["savannah", "grassland", "drought", "flood", "gorge", "volcanic", "canyon", "forest", "canopy", "arid", "watering hole", "climate"]):
        return "environment"

    # Transition
    if any(k in text for k in ["and that creates", "meanwhile", "in the next chapter", "turning to", "furthermore", "nonetheless"]):
        return "transition"

    # Default for narrative scenes
    return "reconstruction"


def infer_evidence_mode(narration: str, category: str) -> str:
    """Infer evidence mode: documented, reconstruction, or conceptual."""
    text = narration.lower()
    domain = detect_narration_domain(narration)

    if category in ["timeline", "map", "comparison"]:
        return "conceptual"
    if domain in ["physics_chemistry", "astrophysics"]:
        return "conceptual" if category in ["anatomy/science", "transition"] else "reconstruction"

    # Documented evidence
    if any(k in text for k in [
        "olduvai gorge", "tanzania", "fossil", "fossils", "specimen", "oh 7", "oh 24",
        "excavation", "site", "researchers re-examined", "apollo", "1960s", "nasa"
    ]):
        return "documented"

    return "reconstruction"


def infer_shot_type(category: str, narration: str) -> str:
    """Infer recommended shot framing based on category and narration."""
    text = narration.lower()
    domain = detect_narration_domain(narration)

    if category == "map":
        return "top-down"
    if category == "establishing":
        return "extreme wide"
    if category in ["detail/macro"]:
        return "macro/detail"
    if category in ["artifact"]:
        if domain == "computing_technology" or "circuit" in text:
            return "close-up"
        return "close-up" if "skull" in text or "teeth" in text or "handaxe" in text else "medium close-up"
    if category in ["environment"]:
        return "wide"
    if category in ["process"]:
        return "medium close-up"
    if category in ["timeline", "comparison"]:
        return "medium wide"
    return "medium wide"


def infer_camera_motion(category: str, shot_type: str) -> str:
    """Suggest camera motion for video planning metadata."""
    if shot_type in ["macro/detail", "close-up"]:
        return "slow push-in"
    if category in ["establishing", "environment"]:
        return "slow pan"
    if category in ["map", "timeline"]:
        return "static"
    return "tracking" if category == "reconstruction" else "slow push-in"


def extract_proper_nouns(text: str) -> List[str]:
    """
    Safely extract known proper nouns, binomials, and recognized geographical entities.
    Does NOT treat arbitrary capitalized sentence-starters (like 'Sun' or 'Entropy') as hominid species.
    """
    proper_nouns = []
    
    # 1. Scientific taxa (Homo habilis, Australopithecus afarensis, etc.)
    latin_matches = re.findall(r'\b(Homo [a-z]+|Australopithecus [a-z]+|Paranthropus [a-z]+)\b', text)
    proper_nouns.extend(latin_matches)

    # 2. Known geographical sites / research locations
    loc_matches = re.findall(r'\b(Olduvai Gorge|East Africa|Great Rift Valley|Tanzania|Lake Turkana|Sterkfontein)\b', text, flags=re.IGNORECASE)
    for loc in loc_matches:
        if loc not in proper_nouns:
            proper_nouns.append(loc)

    return proper_nouns


def build_visual_summary(narration: str, category: str) -> str:
    """
    Generate a clean, high-level visual description for the scene.
    Domain-aware to avoid injecting prehistoric themes into unrelated science/technology.
    """
    domain = detect_narration_domain(narration)
    cleaned = narration.strip().rstrip(".;:!?")
    cleaned = re.sub(r'^(?:Chapter\s+(?:One|Two|Three|Four|Five|\d+):\s*)', '', cleaned, flags=re.IGNORECASE)
    proper_nouns = extract_proper_nouns(narration)

    # 1. Astrophysics
    if domain == "astrophysics":
        if category == "anatomy/science":
            return f"Astrophysical scientific model: {cleaned[:75]}"
        return f"Cosmic astronomical visualization: {cleaned[:75]}"

    # 2. Computing & Modern Technology
    if domain == "computing_technology":
        if category == "artifact":
            return f"Historical microelectronics study: {cleaned[:75]}"
        return f"Historical technology reconstruction: {cleaned[:75]}"

    # 3. Physics & Chemistry
    if domain == "physics_chemistry":
        return f"Physical science conceptual visualization: {cleaned[:75]}"

    # 4. Prehistory / Archaeological Documentary (applied ONLY when domain == 'prehistory')
    if domain == "prehistory":
        noun_str = f" involving {', '.join(proper_nouns[:2])}" if proper_nouns else ""
        if category == "establishing":
            return f"Panoramic establishing view of vast prehistoric landscape{noun_str}"
        elif category == "artifact":
            return f"Archaeological inspection of prehistoric fossil or stone tool evidence{noun_str}"
        elif category == "map":
            return f"Geographical documentary map detailing prehistoric migration and terrain{noun_str}"
        elif category == "timeline":
            return f"Chronological scientific timeline visualizing evolutionary epochs"
        elif category == "anatomy/science":
            return f"Detailed scientific anatomical study and morphological comparison{noun_str}"
        elif category == "process":
            return f"Authentic prehistoric tool manufacturing and natural resource processing"
        elif category == "detail/macro":
            return f"Macro close-up analysis of microscopic surface wear and striations"
        elif category == "comparison":
            return f"Comparative visual analysis contrasting hominid traits and behavioral strategies"
        elif category == "environment":
            return f"Environmental study of ancient climatic conditions and natural habitat"
        elif category == "transition":
            return f"Cinematic atmospheric transition across the prehistoric landscape"
        else:
            first_clause = cleaned.split('.')[0].strip()
            if len(first_clause) > 90:
                first_clause = first_clause[:87] + "..."
            return f"Prehistoric reconstruction: {first_clause}"

    # 5. General Science / General History (Clean Generic Preset)
    if category == "map":
        return f"Geographical documentary map: {cleaned[:75]}"
    elif category == "timeline":
        return f"Chronological timeline visualization: {cleaned[:75]}"
    elif category == "artifact":
        return f"Historical artifact inspection: {cleaned[:75]}"
    elif category == "anatomy/science":
        return f"Scientific anatomical model: {cleaned[:75]}"
    elif category == "process":
        return f"Scientific and operational process: {cleaned[:75]}"
    elif category == "establishing":
        return f"Cinematic documentary establishing view: {cleaned[:75]}"
    elif category == "environment":
        return f"Environmental documentary study: {cleaned[:75]}"
    elif category == "detail/macro":
        return f"Macro detailed inspection: {cleaned[:75]}"
    elif category == "comparison":
        return f"Comparative documentary analysis: {cleaned[:75]}"
    elif category == "transition":
        return f"Cinematic documentary scene transition: {cleaned[:75]}"
    else:
        first_clause = cleaned.split('.')[0].strip()
        if len(first_clause) > 90:
            first_clause = first_clause[:87] + "..."
        return f"Documentary visual reconstruction: {first_clause}"


def build_image_prompt(
    narration: str,
    category: str,
    shot_type: str,
    evidence_mode: str,
    aspect_ratio: str = "16:9",
    continuity_group: Optional[str] = None,
) -> str:
    """
    Assemble a production-ready documentary image prompt adhering to:
    [scene visual objective], [subject], [action], [environment], [camera], [lighting], [documentary style], [accuracy constraints], 16:9, no text
    Domain-aware: strictly avoids injecting prehistoric hominids or East African savannah into astrophysics, technology, or physics.
    """
    domain = detect_narration_domain(narration)
    proper_nouns = extract_proper_nouns(narration)
    clean_narration = narration.strip().rstrip(".;:!?")
    clean_narration = re.sub(r'^(?:Chapter\s+(?:One|Two|Three|Four|Five|\d+):\s*)', '', clean_narration, flags=re.IGNORECASE)

    # -------------------------------------------------------------------------
    # Domain 1: Astrophysics & Space
    # -------------------------------------------------------------------------
    if domain == "astrophysics":
        obj = f"Cinematic astrophysical scientific visualization: {clean_narration[:70]}"
        subj = "accurate physical representation of stellar bodies, celestial mass, and gravitational fields"
        action = "gravitational energy dynamics, radiant high-density plasma glow, cosmic particle emissions"
        env = "deep space cosmic environment with distant starfields, faint interstellar dust, and nebula backdrop"
        lighting = "intense high-dynamic-range stellar radiance with natural deep space contrast"
        accuracy = "scientifically plausible astrophysical visualization, astronomically accurate, photorealistic documentary cinematography"

    # -------------------------------------------------------------------------
    # Domain 2: Modern Computing & Technology
    # -------------------------------------------------------------------------
    elif domain == "computing_technology":
        obj = f"Historical technological documentary photograph: {clean_narration[:70]}"
        subj = "authentic early integrated circuits, planar silicon wafer paths, and discrete electronic components"
        action = "detailed macro view of semiconductor architecture, gold bonding wires, and period-correct circuit layout"
        env = "1960s technological engineering laboratory, cleanroom testing apparatus, period electronic test equipment"
        lighting = "diffused fluorescent laboratory illumination, authentic 1960s archival color science"
        accuracy = "historically accurate mid-century technology, authentic period-correct electronic components, photorealistic documentary cinematography"

    # -------------------------------------------------------------------------
    # Domain 3: Physics & Chemistry
    # -------------------------------------------------------------------------
    elif domain == "physics_chemistry":
        obj = f"Scientific conceptual visualization of physical principles: {clean_narration[:70]}"
        subj = "thermodynamic state distribution, molecular dispersion, and energy dispersion across a physical system"
        action = "clean visual gradients illustrating kinetic energy spreading, entropy progression, and microscopic molecular states"
        env = "isolated physical system visualization, minimalist scientific educational backdrop"
        lighting = "balanced directional studio illumination highlighting particle vector dispersion"
        accuracy = "scientifically plausible physical process visualization, clean educational documentary style, no fantasy elements"

    # -------------------------------------------------------------------------
    # Domain 4: Prehistory / Human Evolution (Original Specialized Domain)
    # -------------------------------------------------------------------------
    elif domain == "prehistory":
        accuracy = "scientifically plausible prehistoric environment, authentic archaeological context, no anachronisms"
        if category == "establishing":
            obj = "Panoramic cinematic establishing shot of vast prehistoric East African savannah"
            subj = "open grasslands beneath an expansive dramatic sky"
            action = "heat shimmer rising over the arid terrain with distant acacia scrub"
            env = "untamed Pleistocene wilderness, deep geological horizons"
            lighting = "golden natural morning sunlight casting long shadows across tall grass"
        elif category == "artifact":
            subj_name = proper_nouns[0] if proper_nouns else "hominid fossil specimens"
            obj = f"Cinematic museum documentary close-up of authentic fossilized archaeological discovery: {subj_name}"
            subj = "fossilized hominid remains resting carefully on an archaeological field examination table"
            action = "soft raking light revealing authentic surface mineral textures, natural stone sediment, and ancient bone preservation"
            env = "field excavation station in dry savannah environment, natural expedition setting"
            lighting = "diffused directional daylight highlighting subtle anatomical ridges and bone textures"
        elif category == "map":
            obj = "Documentary topographic cartography visualization"
            subj = "relief map of the African Rift Valley and migration corridors"
            action = "clear geographical terrain markers indicating hominid movement paths without baked text"
            env = "stylized realistic 3D physical relief terrain, geographical elevation shading"
            lighting = "soft clean studio illumination highlighting continental landforms"
        elif category == "timeline":
            obj = "Abstract scientific timeline visualization of deep evolutionary time"
            subj = "horizontal chronological strata representing distinct prehistoric epochs and hominid milestones"
            action = "clean layered geological sediment markers visualizing millions of years of evolutionary history"
            env = "minimalist cinematic scientific background, deep earth strata textures"
            lighting = "dramatic low-key lighting highlighting transition points between epochs"
        elif category == "anatomy/science":
            obj = "Detailed paleoanthropological scientific reconstruction and morphological study"
            subj = f"anatomical focus on hominid skeletal structure and dentition{f' ({proper_nouns[0]})' if proper_nouns else ''}"
            action = "scientific comparative display highlighting cranial capacity and jaw development"
            env = "scientific laboratory study setting with natural limestone and reference casts"
            lighting = "neutral clinical daylight balanced with soft rim lighting"
        elif category == "process":
            obj = "Cinematic archaeological demonstration of prehistoric toolmaking and knapping"
            subj = "hands of an early hominid striking a basalt core with a quartzite hammerstone"
            action = "sharp flakes detaching with precision, authentic stone knapping technique"
            env = "dry riverbed camp surrounded by natural stone debris, East African woodland margin"
            lighting = "bright natural sunlight glinting off freshly flaked stone facets"
        elif category == "detail/macro":
            obj = "Extreme macro documentary cinematography of stone tool surface"
            subj = "microscopic polish, striations, and butchery cut-mark traces on ancient tool edge"
            action = "raking light revealing authentic microwear patterns and archaeological micro-traces"
            env = "archaeological laboratory microscope field of view"
            lighting = "high-contrast precision raking light revealing microscopic tool wear"
        elif category == "comparison":
            obj = "Documentary comparative visual layout contrasting evolutionary adaptations"
            subj = "two distinct ancestral hominid morphotypes and their toolkits presented in balanced composition"
            action = "contrasting physical stature, cranial proportions, and foraging adaptations"
            env = "split compositional background of transitional Pleistocene environments"
            lighting = "balanced documentary lighting preserving naturalistic skin and fur tones"
        elif category == "environment":
            obj = "Cinematic environmental portrait of ancient Pleistocene climate"
            subj = "seasonal East African wetlands transitioning into arid drought-stricken savannah"
            action = "prehistoric fauna visible at a distance around a shrinking watering hole"
            env = "dynamic natural ecosystem, riverbed sediments, ancient geological formations"
            lighting = "atmospheric late-afternoon sun with dust motes and soft atmospheric haze"
        elif category == "transition":
            obj = "Atmospheric visual scene transition across prehistoric territory"
            subj = "wide landscape view connecting narrative segments"
            action = "dusk falling over the Great Rift Valley, wind rustling dry savannah grass"
            env = "broad East African volcanic plains"
            lighting = "dramatic twilight with deep indigo and amber horizon gradient"
        else:
            # Default reconstruction
            if proper_nouns:
                subject_token = f"an early {proper_nouns[0]} individual"
            elif "prey" in narration.lower():
                subject_token = "small group of early hominids acting cautiously as vulnerable prey"
            elif "hunters" in narration.lower():
                subject_token = "early hominids surveying the horizon cautiously for dangerous apex predators"
            else:
                subject_token = "early ancestral hominid in natural habitat"

            obj = f"Cinematic archaeological reconstruction: {clean_narration[:60]}"
            subj = f"{subject_token}, anatomically realistic early hominid features"
            action = "moving attentively through open grassland, vigilant posture, observant expressions"
            env = "semi-arid Pleistocene East African savannah with acacia scrub and rocky volcanic outcroppings"
            lighting = "natural low-angle morning sunlight with soft golden highlights on skin and hair"

    # -------------------------------------------------------------------------
    # Domain 5: General History & General Science (Fallback)
    # -------------------------------------------------------------------------
    else:
        obj = f"Cinematic documentary reconstruction: {clean_narration[:65]}"
        subj = f"documentary visual representation of {clean_narration[:50]}"
        action = "natural authentic actions reflecting historical or scientific context"
        env = "historically authentic documentary setting, period-appropriate environment"
        lighting = "natural cinematic lighting with realistic atmospheric depth"
        accuracy = "historically and scientifically plausible, authentic documentary reconstruction, no anachronisms"

    # Assemble modular prompt
    prompt_parts = [
        obj,
        subj,
        action,
        env,
        f"{shot_type} documentary framing",
        lighting,
        DOCUMENTARY_STYLE_TOKENS,
        accuracy,
        f"{aspect_ratio} widescreen composition",
        "no text",
        "no watermark",
    ]

    full_prompt = ", ".join(p.strip().rstrip(",") for p in prompt_parts if p.strip())
    full_prompt = re.sub(r'\s*,\s*', ', ', full_prompt)
    return full_prompt
