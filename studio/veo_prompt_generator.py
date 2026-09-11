"""
UnfoldIQ Visual Scene to Video Shot Engine — Google Flow / Veo Prompt Generator (Phase 6)
Transforms verified scene plans, speech timestamps, and narration scripts into
production-ready, temporal video generation prompt packs for Google Flow / Veo.
Ensures 100% full-audio visual timeline coverage, balanced long-scene splitting,
continuity inheritance, prompt grounding, and zero dialogue/text generation requests.
"""

import hashlib
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from studio.config import config, PROJECTS_DIR
from studio.prompt_builder import (
    VISUAL_CATEGORIES,
    detect_narration_domain,
)
from studio.scene_planner import compute_file_sha256



logger = logging.getLogger("unfoldiq.veo_prompt_generator")

# Controlled Video Shot Types
VEO_SHOT_TYPES = [
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

# Controlled Video Camera Motions
VEO_CAMERA_MOTIONS = [
    "static",
    "slow push-in",
    "slow pull-back",
    "slow pan left",
    "slow pan right",
    "slow lateral tracking",
    "slow forward tracking",
    "gentle orbit",
    "controlled handheld",
]

# Controlled Narrative Tones
VEO_NARRATIVE_TONES = [
    "neutral_explanatory",
    "discovery",
    "tension",
    "awe",
    "reflection",
    "transition",
    "process",
]

# Standard Video Constraints (No spoken dialogue, no text overlays)
STANDARD_VEO_CONSTRAINTS = [
    "no spoken dialogue",
    "no voiceover",
    "no captions",
    "no subtitles",
    "no text",
    "no watermark",
]

STANDARD_VEO_CONSTRAINTS_TEXT = (
    "no spoken dialogue, no voiceover, no captions, no subtitles, no text, no watermark"
)


def format_timestamp_hms(seconds: float) -> str:
    """Format seconds into HH:MM:SS.mmm string."""
    ms = int(round((seconds - int(seconds)) * 1000))
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def extract_proper_nouns(text: str) -> List[str]:
    """
    Extract recognized historical persons, scientific taxa, geographical sites, and observatories.
    """
    results: List[str] = []
    # 1. Capitalized Person Names & Titles (e.g. Alan Turing, Ada Lovelace, James Watt, Charles Babbage)
    person_matches = re.findall(
        r'\b(?:Professor|Doctor|Dr\.|Sir)?\s*([A-Z][a-z]+ [A-Z][a-z]+)\b',
        text
    )
    common_stops = {
        "The Theory", "This Is", "In A", "In An", "First Scene", "Second Scene",
        "Meanwhile The", "Modern Supercomputers", "Documentary Visual"
    }
    for pm in person_matches:
        pm_clean = pm.strip()
        if pm_clean not in common_stops and pm_clean not in results:
            results.append(pm_clean)

    # 2. Scientific taxa
    latin_matches = re.findall(r'\b(Homo [a-z]+|Australopithecus [a-z]+|Paranthropus [a-z]+)\b', text, flags=re.IGNORECASE)
    results.extend(latin_matches)

    # 3. Known geographical & astronomical observatories / sites (two-word matches)
    known_sites = re.findall(
        r'\b(Olduvai Gorge|East Africa|Great Rift Valley|Tanzania|Lake Turkana|Sterkfontein|James Webb Space Telescope|Hubble Space Telescope|Cambridge University)\b',
        text,
        flags=re.IGNORECASE
    )
    for s in known_sites:
        if s not in results:
            results.append(s)

    # 4. Single-word known locations (capitals not matched by person-name pattern)
    single_word_sites = re.findall(
        r'\b(Pompeii|Herculaneum|Mesopotamia|Stonehenge|Luxor|Machu|Mycenae|Pompeii)\b',
        text,
        flags=re.IGNORECASE
    )
    for s in single_word_sites:
        if s not in results:
            results.append(s)

    return results


# Known geographic locations and sites — must NOT be used as biological actors
_KNOWN_LOCATIONS = frozenset([
    "olduvai gorge", "east africa", "great rift valley", "tanzania", "lake turkana",
    "sterkfontein", "africa", "europe", "asia", "mesopotamia", "nile", "tigris",
    "euphrates", "cambridge", "oxford", "greenwich", "pompeii", "herculaneum",
    "james webb space telescope", "hubble space telescope",
])

# Known scientific taxa — biological subjects
_TAXA_PATTERN = re.compile(
    r'\b(Homo [a-z]+|Australopithecus [a-z]+|Paranthropus [a-z]+)\b', re.IGNORECASE
)


def classify_proper_nouns(nouns: List[str]) -> Dict[str, List[str]]:
    """
    Classify a list of proper nouns into semantic categories:
      locations: geographic sites / landmarks (must NOT be used as walking biological actors)
      taxa:      scientific species / genus names (the biological subjects)
      persons:   human names (historical figures)
    """
    locations: List[str] = []
    taxa: List[str] = []
    persons: List[str] = []

    for noun in nouns:
        noun_lower = noun.lower()
        if noun_lower in _KNOWN_LOCATIONS:
            locations.append(noun)
        elif _TAXA_PATTERN.match(noun):
            taxa.append(noun)
        else:
            # Two-word capitalized noun not in location list → treat as person
            persons.append(noun)

    return {"locations": locations, "taxa": taxa, "persons": persons}



class VeoPlanValidationError(Exception):
    """Raised when Veo shot plan fails validation."""
    pass



class VeoPromptGenerator:
    """Production Google Flow / Veo video prompt generator."""

    def __init__(
        self,
        target_shot_duration: Optional[float] = None,
        preferred_max_duration: Optional[float] = None,
        min_shot_duration: Optional[float] = None,
        aspect_ratio: Optional[str] = None,
        target_duration: Optional[float] = None,
        min_duration: Optional[float] = None,
    ):
        self.target_duration = target_shot_duration or target_duration or config.veo_target_duration
        self.preferred_max_duration = preferred_max_duration or config.veo_preferred_max_duration
        self.min_duration = min_shot_duration or min_duration or config.veo_min_duration
        self.aspect_ratio = aspect_ratio or config.veo_default_aspect_ratio


    # -------------------------------------------------------------------------
    # TONE INFERENCE
    # -------------------------------------------------------------------------
    def infer_narrative_tone(self, narration: str, category: str) -> str:
        """
        Deterministically infer narrative tone from narration keywords and category.
        Affects pacing, camera movement, and lighting style.

        Priority order:
        1. Explicit neutral_explanatory anchors (highest priority — overrides category)
        2. Tension / Conflict / Peril
        3. Awe / Cosmic Scale / Monumental
        4. Discovery / Breakthrough
        5. Process / Physical Progression (category tiebreaker)
        6. Reflection / Heritage
        7. Transition
        8. neutral_explanatory (default fallback)
        """
        text = narration.lower()

        # 0. Explicit neutral_explanatory anchors — positive keywords for explanatory content.
        # These override category-based process detection when the text is purely descriptive.
        neutral_kw = [
            "describes how", "is defined as", "refers to", "is known as", "is a measure",
            "can be understood", "is the study", "explains", "is characterized by",
            "is a property", "is the process by which", "in simple terms", "by definition",
            "is a concept", "is a principle", "is a law of", "is a fundamental",
        ]
        if any(k in text for k in neutral_kw):
            return "neutral_explanatory"

        # 1. Tension / Conflict / Peril
        tension_kw = [
            "predator", "predators", "danger", "dangerous", "ruthlessness", "vulnerable",
            "prey", "drought", "peril", "crisis", "conflict", "struggle", "weapon",
            "warfare", "perpetual orbit", "harsh", "threat", "survival"
        ]
        if any(k in text for k in tension_kw):
            return "tension"

        # 2. Awe / Cosmic Scale / Monumental
        awe_kw = [
            "vast", "cosmic", "universe", "millions of years", "starfield", "celestial",
            "infinite", "profound", "monumental", "grand expanse", "endless", "horizon",
            "spacecraft", "galaxy", "supernova", "neutron star", "light-year", "light-years",
            "dwarfing"
        ]
        if any(k in text for k in awe_kw):
            return "awe"

        # 3. Discovery / Breakthrough
        discovery_kw = [
            "reveals", "excavated", "discovered", "breakthrough",
            "insight", "unlocked", "curiosity", "exploration", "first time",
            "revolution"
        ]
        # Note: "transformed" and "integrated circuits" removed — too ambiguous
        if any(k in text for k in discovery_kw):
            return "discovery"

        # 4. Process / Physical Progression (category acts as tiebreaker only if no other signal)
        process_text_kw = [
            "knapping", "flaking", "butchery", "assembly", "fabrication", "manufacturing",
            "disperses", "spinning", "orbiting", "reaction", "fuses", "fusing",
            "sequentially", "step by step", "stage by stage",
        ]
        if any(k in text for k in process_text_kw) or (
            category in ["process", "detail/macro"]
            and not any(k in text for k in neutral_kw + tension_kw + awe_kw + discovery_kw)
        ):
            return "process"

        # 5. Reflection / Heritage / Memory
        reflection_kw = [
            "heritage", "legacy", "memory", "remember", "consciousness", "humanity",
            "meaning", "wisdom", "generations", "philosophy", "intellectual"
        ]
        if any(k in text for k in reflection_kw):
            return "reflection"

        # 6. Transition
        if category == "transition" or any(k in text for k in [
            "meanwhile", "turning to", "next chapter", "furthermore", "nonetheless",
            "chapter one", "chapter two", "chapter three"
        ]):
            return "transition"

        return "neutral_explanatory"

    # -------------------------------------------------------------------------
    # MOTION & ACTION BUILDERS
    # -------------------------------------------------------------------------
    def build_subject_and_action(
        self,
        narration: str,
        category: str,
        domain: str,
        tone: str,
        shot_progression_index: int = 1,
    ) -> Tuple[str, str]:
        """
        Generate grounded (subject, subject_action) answering 'What moves/changes during the clip?'.
        Does NOT invent dialogue or unsupported facts.
        """
        text = narration.lower()
        proper_nouns = extract_proper_nouns(narration)

        # Domain 1: Astrophysics
        if domain == "astrophysics":
            if "telescope" in text or "observatory" in text or "jwst" in text or "james webb" in text:
                subj_name = proper_nouns[0] if proper_nouns else "astronomical observatory telescope"
                subject = f"{subj_name} deep-space telescope observatory"
                action = "orientation thrusters and optical sensor arrays tracking slowly toward target cosmic coordinate"
            elif "neutron star" in text or "star" in text:
                subject = f"a hyper-dense rotating neutron star{f' ({proper_nouns[0]})' if proper_nouns else ''} with radiant magnetic poles"
                action = "rotating steadily on its axis while emitting energetic relativistic radiation beams into the surrounding space"
            elif "moon" in text or "orbit" in text:
                subject = "celestial bodies exhibiting orbital gravitational mechanics"
                action = "tracking along smooth gravitational curves in vacuum"
            else:
                subj_prefix = f"{proper_nouns[0]} " if proper_nouns else ""
                subject = f"{subj_prefix}cosmic astronomical phenomenon"
                action = "subtle gravitational expansion and luminous particle drift across deep space"
            return subject, action

        # Domain 2: Modern Computing & Technology
        if domain == "computing_technology":
            person_match = next((p for p in proper_nouns if any(w in p.lower() for w in ["turing", "babbage", "lovelace", "hopper", "neumann", "watt", "einstein", "curie", "darwin"])), None)
            subj_p = f"{person_match or proper_nouns[0]} " if proper_nouns else ""
            if person_match:
                subject = f"{person_match} formulating mathematical and computing principles alongside early computer hardware"
                action = "methodically recording equations and reviewing discrete technological components"
            elif "circuit" in text or "microchip" in text:
                subject = f"{subj_p}historic planar silicon integrated circuit architecture and microchip substrate"
                if shot_progression_index == 1:
                    action = "subtle light glinting across micro-fabricated circuit traces and gold bonding wires under examination"
                else:
                    action = "precision optical inspection probe moving smoothly across semiconductor wafer surface"
            elif "computer" in text or "supercomputer" in text or "processing" in text or "data" in text:
                subject = f"{subj_p}high-performance computer hardware and data processing server architecture"
                action = "status indicators and data processing activity operating smoothly in an engineering laboratory setting"
            else:
                subject = f"{subj_p}historical technological computer hardware"
                action = "focused operational inspection of mid-century electronics and processing equipment"
            return subject, action




        # Domain 3: Physics & Chemistry
        if domain == "physics_chemistry":
            if "entropy" in text or "energy" in text or "dispers" in text:
                subject = "isolated physical system demonstrating energy dispersion"
                action = "molecules and thermal energy gradients dispersing smoothly from concentrated areas into balanced distribution"
            else:
                subject = "physical science process model"
                action = "gradual thermodynamic state progression showing energy distribution over time"
            return subject, action

        # Domain 4: Prehistory / Archaeology
        if domain == "prehistory":
            # Classify proper nouns to avoid treating locations as biological actors
            classified = classify_proper_nouns(proper_nouns)
            taxa      = classified["taxa"]       # e.g. ["Homo habilis"]
            locations = classified["locations"]  # e.g. ["Olduvai Gorge", "Tanzania"]
            persons   = classified["persons"]    # e.g. ["Mary Leakey"]

            # Biological subject: use taxon if available, else generic hominid
            taxon_name   = taxa[0] if taxa else None
            hominid_name = taxon_name or "early ancestral hominid"

            # Geographic context string (used as location context, NOT as actor)
            loc_parts = [l for l in locations if l.lower() not in ("east africa", "africa")]
            if locations:
                geo_context = " and ".join(loc_parts[:2]) if loc_parts else locations[0]
            else:
                geo_context = ""

            if category == "establishing":
                if geo_context:
                    subject = f"expansive prehistoric landscape of {geo_context}"
                else:
                    subject = "vast prehistoric landscape with distant wildlife"
                action = "herds shifting slowly in the middle distance beneath shifting cloud shadows"
            elif category == "artifact":
                loc_suffix = f" at {geo_context}" if geo_context else ""
                subject = f"authentic fossilized specimen and stone tools{loc_suffix}"
                action = "resting stable on an archaeological examination surface as soft raking light glides across mineral textures"
            elif category == "process":
                subject = f"hands of an {hominid_name}"
                action = "striking a volcanic stone core with a quartzite hammerstone, detaching sharp flint flakes cleanly"
            elif category == "detail/macro":
                subject = "microscopic cutting edge of an ancient stone tool"
                action = "light scanning slowly across microscopic surface wear striations and butchery polish"
            elif category == "map":
                if geo_context:
                    subject = f"relief terrain model of {geo_context} and surrounding migration corridors"
                else:
                    subject = "relief terrain model of migration corridors"
                action = "camera traversing smoothly across topographical contours and river valley paths"
            elif category == "timeline":
                subject = "geological strata visualization of deep time"
                action = "gradual horizontal lighting progression illuminating distinct epoch sediment layers"
            else:
                # Reconstruction / general narrative:
                # Use taxon + location context to ground the visual correctly
                if taxon_name and geo_context:
                    # Fossil/archaeological reconstruction with site context
                    subject = f"{taxon_name} fossil remains and archaeological evidence at {geo_context}"
                    action = "emerging from excavated sediment layers under systematic archaeological examination"
                elif taxon_name:
                    # Taxon-only biological reconstruction
                    if tone == "tension":
                        subject = f"a cautious band of {taxon_name} individuals"
                        action = "moving vigilantly through tall dry grass, scanning the tree line attentively for predators"
                    elif tone == "awe":
                        subject = f"a {taxon_name} individual standing on a high volcanic ridge"
                        action = "pausing quietly to observe the expansive horizon as morning wind rustles their hair"
                    else:
                        subject = f"a {taxon_name} individual in natural foraging environment"
                        if shot_progression_index == 1:
                            action = "moving cautiously and purposefully across open savannah terrain"
                        elif shot_progression_index == 2:
                            action = "pausing to inspect natural vegetation and stone resources on the ground"
                        else:
                            action = "observing surroundings with keen, intelligent awareness"
                elif geo_context:
                    # Geographic site — show the landscape/site, not a walking person
                    subject = f"archaeological excavation site at {geo_context}"
                    action = "archaeological grid and sediment layers being carefully documented and brushed clean"
                else:
                    # Fully generic fallback
                    if tone == "tension":
                        subject = f"a cautious band of {hominid_name} individuals"
                        action = "moving vigilantly through tall dry grass, scanning the tree line attentively for predators"
                    elif tone == "awe":
                        subject = f"an {hominid_name} individual standing on a high volcanic ridge"
                        action = "pausing quietly to observe the expansive horizon as morning wind rustles their hair"
                    else:
                        subject = f"an {hominid_name} in natural foraging environment"
                        if shot_progression_index == 1:
                            action = "moving cautiously and purposefully across open savannah terrain"
                        elif shot_progression_index == 2:
                            action = "pausing to inspect natural vegetation and stone resources on the ground"
                        else:
                            action = "observing surroundings with keen, intelligent awareness"
            return subject, action

        # Domain 5: General History & General Science (Fallback)
        clean_text = narration.strip().rstrip(".;:!?")
        clean_text = re.sub(r'^(?:Chapter\s+(?:One|Two|Three|Four|Five|\d+):\s*)', '', clean_text, flags=re.IGNORECASE)
        first_clause = clean_text.split('.')[0].strip()
        if len(first_clause) > 60:
            first_clause = first_clause[:57] + "..."

        subject = f"documentary visual representation of {first_clause}"
        if tone == "process":
            action = "demonstrating methodical physical progression and authentic operational steps"
        elif tone == "tension":
            action = "moving attentively through authentic period environment under focused observation"
        elif tone == "awe":
            action = "gradually revealing monumental architectural or scientific scale"
        else:
            action = "authentic historical or scientific actions progressing naturally over time"

        return subject, action

    def build_environment_and_motion(
        self,
        category: str,
        domain: str,
        tone: str,
    ) -> Tuple[str, str]:
        """
        Generate grounded (environment, environment_motion).
        Avoids irrelevant visual clutter.
        """
        if domain == "astrophysics":
            env = "deep space cosmic environment with distant celestial starfield and faint nebula dust"
            env_motion = "faint interstellar particles drifting slowly against deep space darkness"
            return env, env_motion

        if domain == "computing_technology":
            env = "1960s technology engineering laboratory cleanroom with period test instruments"
            env_motion = "diffused fluorescent light reflections and gentle oscillograph traces on background equipment"
            return env, env_motion

        if domain == "physics_chemistry":
            env = "clean minimalist scientific demonstration environment"
            env_motion = "smooth thermal gradient shading shifting naturally across the physical boundary"
            return env, env_motion

        if domain == "prehistory":
            if category in ["artifact", "detail/macro"]:
                env = "field archaeological research station in dry savannah environment"
                env_motion = "fine dust motes drifting gently through warm directional sunbeams"
            elif category == "establishing":
                env = "untamed Pleistocene East African savannah with acacia scrub and volcanic horizons"
                env_motion = "tall golden grass bending gently in the wind under drifting light cloud cover"
            else:
                env = "semi-arid Pleistocene grassland with dry riverbed and distant acacia woodland"
                env_motion = "warm breeze rustling dry savannah vegetation and heat shimmer rising subtly from the ground"
            return env, env_motion

        # General
        env = "historically and scientifically authentic period documentary setting"
        env_motion = "natural atmospheric depth with subtle ambient environmental movement"
        return env, env_motion

    def infer_camera_strategy(
        self,
        category: str,
        tone: str,
        domain: str,
        shot_progression_index: int = 1,
        total_shots_in_scene: int = 1,
    ) -> Tuple[str, str]:
        """
        Determine shot_type and camera_motion with progression across split scenes.
        Progressive rule: Shot 1 = wider / establishing; Shot 2 = medium / tracking; Shot 3 = close-up / detail.
        """
        # Base shot types
        if category == "map":
            shot_type = "top-down"
            motion = "slow forward tracking" if tone == "discovery" else "static"
            return shot_type, motion

        if category == "timeline":
            shot_type = "medium wide"
            motion = "slow lateral tracking"
            return shot_type, motion

        if category == "detail/macro":
            shot_type = "macro/detail"
            motion = "slow push-in"
            return shot_type, motion

        if category == "artifact":
            if total_shots_in_scene > 1 and shot_progression_index == 1:
                return "medium close-up", "slow push-in"
            return "close-up", "slow push-in"

        if category == "establishing":
            if shot_progression_index == 1:
                return "extreme wide", "slow pan right"
            return "wide", "slow push-in"

        if category == "process":
            if shot_progression_index == 1:
                return "medium", "slow push-in"
            return "medium close-up", "slow push-in"

        # General Narrative / Reconstruction Progression
        if total_shots_in_scene == 1:
            if tone == "awe":
                return "wide", "slow pull-back"
            if tone == "tension":
                return "medium wide", "slow lateral tracking"
            return "medium wide", "slow forward tracking"

        # Multi-shot split progression
        if shot_progression_index == 1:
            # Wide establishing shot
            return "wide", "slow lateral tracking"
        elif shot_progression_index == 2:
            # Medium focal shot
            return "medium", "slow push-in"
        else:
            # Close detail / resolution shot
            return "medium close-up", "slow forward tracking"

    def build_continuity_anchor(
        self,
        scene: Dict[str, Any],
        domain: str,
    ) -> Optional[str]:
        """Build stable continuity anchor for scenes sharing a continuity group."""
        group = scene.get("continuity_group")
        if not group:
            return None

        proper_nouns = extract_proper_nouns(scene.get("narration", ""))
        subject_name = proper_nouns[0] if proper_nouns else "primary subject"

        if domain == "prehistory":
            return (
                f"Consistent visual identity of {subject_name} ({group}): same physical stature, "
                "anatomically consistent facial structure, identical natural skin/fur coloration, "
                "matching dry savannah lighting family"
            )
        elif domain == "computing_technology":
            return (
                f"Consistent visual identity ({group}): identical 1960s semiconductor package, "
                "consistent planar wafer architecture, matching cleanroom laboratory color science"
            )
        else:
            return f"Consistent documentary visual identity: matching {group} subject features and environmental palette"


    # -------------------------------------------------------------------------
    # FLOW / VEO PROMPT SYNTHESIS
    # -------------------------------------------------------------------------
    def build_veo_prompt(
        self,
        subject: str,
        subject_action: str,
        environment: str,
        environment_motion: str,
        shot_type: str,
        camera_motion: str,
        lighting: str,
        domain: str,
        tone: str,
        continuity_anchor: Optional[str] = None,
    ) -> str:
        """
        Assemble production Flow/Veo video generation prompt adhering to:
        1. Visual subject
        2. Subject action over time
        3. Environment
        4. Environmental motion
        5. Camera framing
        6. Camera movement
        7. Lighting
        8. Documentary realism
        9. Continuity anchor (if present)
        10. Production constraints (no spoken dialogue, no text)
        """
        # Pacing & realism tokens
        if domain == "astrophysics":
            realism = "scientifically plausible astrophysical visualization, astronomically accurate, photorealistic cinematic documentary footage"
        elif domain == "computing_technology":
            realism = "historically authentic mid-century technology, period-correct engineering details, photorealistic 35mm documentary archival cinematography"
        elif domain == "physics_chemistry":
            realism = "scientifically plausible physical process visualization, clean educational documentary cinematography, physical realism"
        elif domain == "prehistory":
            realism = "scientifically plausible prehistoric reconstruction, realistic anatomy and body mechanics, natural materials, photorealistic documentary cinematography"
        else:
            realism = "historically and scientifically plausible documentary reconstruction, realistic physical behavior, photorealistic cinematography"

        # Assemble clauses with explicit prefix tags
        parts = [
            f"Cinematography: {shot_type} framing, camera: {camera_motion}",
            f"Action: {subject.strip().rstrip('.')}, {subject_action.strip().rstrip('.')}",
            f"Environment: {environment.strip().rstrip('.')}, {environment_motion.strip().rstrip('.')}",
            f"Lighting: {lighting.strip().rstrip('.')}",
            f"Style: {realism}",
        ]

        if continuity_anchor:
            parts.append(f"Continuity anchor: {continuity_anchor.strip().rstrip('.')}")

        parts.extend([
            f"Composition: {self.aspect_ratio} widescreen composition",
            f"Explicit constraints: {STANDARD_VEO_CONSTRAINTS_TEXT}",
        ])

        prompt_str = ". ".join(p.strip().rstrip(".") for p in parts if p.strip()) + "."
        # Clean formatting
        prompt_str = re.sub(r'\s*\.\s*\.', '.', prompt_str)
        prompt_str = re.sub(r'\s+', ' ', prompt_str).strip()
        return prompt_str

    # -------------------------------------------------------------------------
    # SCENE-TO-SHOT PLANNING & BALANCED SPLITTING
    # -------------------------------------------------------------------------
    def plan_shots_from_scenes(
        self,
        scenes: List[Dict[str, Any]],
        audio_duration: float,
    ) -> List[Dict[str, Any]]:
        """
        Deterministic scene-to-shot planning and duration-based splitting.
        Invariants:
        1. If scene.duration <= preferred_max_duration (8.0s), creates 1 shot.
        2. If scene.duration > preferred_max_duration, splits into N balanced shots (no tiny tail shot).
        3. sum(child_shot_durations) == parent_scene_duration.
        4. First shot start = 0.000s, last shot end = audio_duration.
        5. Full project timeline coverage = 100.0%, 0 gaps, 0 overlaps.
        6. Does NOT mutate input scenes.
        """
        if not scenes:
            return []

        all_shots: List[Dict[str, Any]] = []
        global_shot_idx = 1

        for scene in scenes:
            scene_id = scene["scene_id"]
            scene_start = float(scene["start"])
            scene_end = float(scene["end"])
            scene_duration = round(scene_end - scene_start, 3)
            narration = scene.get("narration", "").strip()
            category = scene.get("category", "reconstruction")
            domain = detect_narration_domain(narration)
            tone = self.infer_narrative_tone(narration, category)

            # Lighting description
            if tone == "awe":
                lighting = "expansive natural golden-hour illumination with deep atmospheric haze"
            elif tone == "tension":
                lighting = "high-contrast directional daylight with deep dramatic shadows"
            elif domain == "astrophysics":
                lighting = "high-dynamic-range stellar radiance with natural deep-space contrast"
            elif domain == "computing_technology":
                lighting = "authentic 1960s diffused laboratory fluorescent lighting with subtle warm falloff"
            else:
                lighting = "natural diffused daylight with realistic environmental reflection"

            # Determine number of shots
            if scene_duration <= self.preferred_max_duration:
                num_shots = 1
            else:
                # Balanced splitting around target_duration (~6.0s)
                num_shots = max(2, int(round(scene_duration / self.target_duration)))
                # If dividing yields segments below min_duration, clamp
                if (scene_duration / num_shots) < self.min_duration and num_shots > 2:
                    num_shots = max(2, int(scene_duration // self.min_duration))

            # Split scene into balanced durations
            child_intervals: List[Tuple[float, float, float]] = []
            curr_start = scene_start
            for k in range(num_shots):
                if k == num_shots - 1:
                    child_end = scene_end
                else:
                    child_end = round(scene_start + (k + 1) * (scene_duration / num_shots), 3)
                child_dur = round(child_end - curr_start, 3)
                child_intervals.append((curr_start, child_end, child_dur))
                curr_start = child_end

            # Construct shot objects
            continuity_anchor = self.build_continuity_anchor(scene, domain)

            for shot_sub_idx, (s_start, s_end, s_dur) in enumerate(child_intervals, start=1):
                shot_id = f"{scene_id}_shot_{shot_sub_idx:02d}"

                # Infer camera and shot type with progressive variation
                shot_type, camera_motion = self.infer_camera_strategy(
                    category=category,
                    tone=tone,
                    domain=domain,
                    shot_progression_index=shot_sub_idx,
                    total_shots_in_scene=num_shots,
                )
                if num_shots == 1 and scene.get("shot_type") in VEO_SHOT_TYPES:
                    shot_type = scene["shot_type"]
                if num_shots == 1 and scene.get("camera_motion"):
                    camera_motion = scene["camera_motion"]


                # Build subject and temporal motion
                subject, subject_action = self.build_subject_and_action(
                    narration=narration,
                    category=category,
                    domain=domain,
                    tone=tone,
                    shot_progression_index=shot_sub_idx,
                )

                # Build environment and environmental motion
                environment, env_motion = self.build_environment_and_motion(
                    category=category,
                    domain=domain,
                    tone=tone,
                )

                # Visual objective
                if num_shots == 1:
                    visual_obj = scene.get("visual_summary") or f"Documentary video shot illustrating {narration[:60]}"
                else:
                    visual_obj = f"{scene.get('visual_summary', 'Scene visualization')} (Part {shot_sub_idx}/{num_shots}: {shot_type} view)"

                # Assemble Flow / Veo Prompt
                veo_prompt = self.build_veo_prompt(
                    subject=subject,
                    subject_action=subject_action,
                    environment=environment,
                    environment_motion=env_motion,
                    shot_type=shot_type,
                    camera_motion=camera_motion,
                    lighting=lighting,
                    domain=domain,
                    tone=tone,
                    continuity_anchor=continuity_anchor,
                )

                shot_data = {
                    "shot_id": f"shot_{global_shot_idx:03d}",
                    "scene_id": scene_id,
                    "parent_scene_id": scene_id,
                    "parent_scene_index": scene.get("index", 1),
                    "index": global_shot_idx,
                    "scene_shot_index": shot_sub_idx,
                    "total_scene_shots": num_shots,
                    "shot_split_index": shot_sub_idx,
                    "shot_split_total": num_shots,
                    "start": s_start,
                    "end": s_end,
                    "duration": s_dur,
                    "narration": narration,
                    "visual_objective": visual_obj,
                    "subject": subject,
                    "subject_action": subject_action,
                    "environment": environment,
                    "environment_motion": env_motion,
                    "environmental_action": env_motion,
                    "category": category,
                    "shot_type": shot_type,
                    "camera_framing": f"{shot_type} documentary shot" if "shot" not in shot_type else shot_type,
                    "camera_motion": camera_motion,
                    "lighting": lighting,
                    "lighting_atmosphere": lighting,
                    "narrative_tone": tone,
                    "tone": tone,
                    "aspect_ratio": self.aspect_ratio,
                    "continuity_group": scene.get("continuity_group"),
                    "continuity_anchor": continuity_anchor,
                    "veo_prompt": veo_prompt,
                    "negative_prompt": STANDARD_VEO_CONSTRAINTS_TEXT,
                    "constraints": list(STANDARD_VEO_CONSTRAINTS),
                    "status": "generated",
                }
                all_shots.append(shot_data)
                global_shot_idx += 1


        # Enforce exact timeline boundaries
        if all_shots:
            all_shots[0]["start"] = 0.000
            for i in range(len(all_shots) - 1):
                all_shots[i]["end"] = all_shots[i + 1]["start"]
                all_shots[i]["duration"] = round(all_shots[i]["end"] - all_shots[i]["start"], 3)
            all_shots[-1]["end"] = round(audio_duration, 3)
            all_shots[-1]["duration"] = round(all_shots[-1]["end"] - all_shots[-1]["start"], 3)

        return all_shots

    # -------------------------------------------------------------------------
    # VALIDATION
    # -------------------------------------------------------------------------
    def validate_veo_plan(
        self,
        veo_data_or_shots: Any,
        expected_audio_duration: Optional[float] = None,
        parent_scenes: Optional[List[Dict[str, Any]]] = None,
        audio_duration: Optional[float] = None,
    ) -> List[str]:
        """Comprehensive production validation of Veo shot plan."""
        if audio_duration is not None and expected_audio_duration is None:
            expected_audio_duration = audio_duration

        is_raw_shots = isinstance(veo_data_or_shots, list)
        if is_raw_shots:
            shots = veo_data_or_shots
            audio_dur = expected_audio_duration or (shots[-1]["end"] if shots else 0.0)
            veo_data = {"shots": shots, "audio_duration": audio_dur}
        else:
            veo_data = veo_data_or_shots
            shots = veo_data.get("shots", [])
            audio_dur = expected_audio_duration or float(veo_data.get("audio_duration", 0.0))

        errors: List[str] = []
        if not shots:
            errors.append("Veo shot plan contains zero shots.")
            if is_raw_shots:
                raise VeoPlanValidationError("; ".join(errors))
            return errors

        # 1. Shot ID uniqueness
        shot_ids = [s.get("shot_id") for s in shots if s.get("shot_id")]
        if len(shot_ids) != len(set(shot_ids)):
            errors.append(f"Duplicate shot IDs detected: {len(shot_ids) - len(set(shot_ids))} duplicates.")

        # 2. Parent scene references (if parent_scenes provided)
        if parent_scenes:
            parent_scene_ids = set(sc["scene_id"] for sc in parent_scenes)
            for s in shots:
                parent_id = s.get("parent_scene_id") or s.get("scene_id")
                if parent_id and parent_id not in parent_scene_ids:
                    errors.append(f"Shot {s.get('shot_id')} references unknown parent scene {parent_id}.")

        # 3. Timeline continuity & Monotonicity
        prev_end = 0.000
        for i, s in enumerate(shots):
            if s["start"] >= s["end"]:
                errors.append(f"Shot {s.get('shot_id')} has invalid range [{s['start']}, {s['end']}].")
            if i == 0 and abs(s["start"] - 0.000) > 0.005:
                errors.append(f"First shot {s.get('shot_id')} does not start at 0.000 (got {s['start']}).")
            if i > 0 and abs(s["start"] - prev_end) > 0.005:
                errors.append(f"Timeline discontinuity at shot {s.get('shot_id')}: expected {prev_end}, got {s['start']}.")
            prev_end = s["end"]

        # 4. Final end coverage
        if audio_dur and abs(shots[-1]["end"] - audio_dur) > 0.05:
            errors.append(
                f"Last shot end ({shots[-1]['end']}) does not cover audio duration ({audio_dur})."
            )

        # 5. Non-empty required fields & negative constraints
        for s in shots:
            if not s.get("veo_prompt") or len(s["veo_prompt"].strip()) < 10:
                errors.append(f"Shot {s.get('shot_id')} has missing or empty veo_prompt.")
            neg_p = s.get("negative_prompt", "")
            for token in STANDARD_VEO_CONSTRAINTS:
                if token not in neg_p.lower() and token not in s.get("veo_prompt", "").lower():
                    errors.append(f"Shot {s.get('shot_id')} missing mandatory token: {token}")

        if is_raw_shots and errors:
            raise VeoPlanValidationError("; ".join(errors))

        return errors


    # -------------------------------------------------------------------------
    # MARKDOWN PROMPT PACK BUILDER
    # -------------------------------------------------------------------------
    def build_markdown_prompt_pack(self, veo_data: Dict[str, Any]) -> str:
        """Construct copy-paste ready Markdown prompt pack."""
        lines = [
            "# UnfoldIQ — Google Flow / Veo Video Prompt Pack",
            "",
            f"**Project:** `{veo_data.get('project', 'unknown')}`  ",
            f"**Audio Duration:** {veo_data.get('audio_duration', 0.0):.2f}s | **Parent Scenes:** {veo_data.get('scene_count', 0)} | **Video Shots:** {veo_data.get('shot_count', len(veo_data.get('shots', [])))}  ",
            f"**Generated:** {veo_data.get('created_at', '')} | **Generator Version:** {veo_data.get('generator_version', '6.0.0')}  ",
            f"**Timeline Coverage:** {veo_data.get('full_timeline_coverage', 100.0):.1f}%  ",
            "",
            "---",
            "",
        ]

        for shot in veo_data.get("shots", []):
            shot_id = shot["shot_id"]
            scene_id = shot["scene_id"]
            sub_idx = shot.get("scene_shot_index", 1)
            tot_sub = shot.get("total_scene_shots", 1)
            start_fmt = format_timestamp_hms(shot["start"])
            end_fmt = format_timestamp_hms(shot["end"])
            continuity_str = shot.get("continuity_group") or "—"

            lines.extend([
                f"## Shot {shot.get('index', 1):03d} — `{shot_id}` (Scene `{scene_id}`, Shot {sub_idx}/{tot_sub})",
                f"**Timeline:** `{start_fmt}` → `{end_fmt}`  ",
                f"**Duration:** {shot['duration']:.2f}s | **Shot Type:** {shot.get('shot_type', '').title()} | **Camera Motion:** {shot.get('camera_motion', '').title()}  ",
                f"**Tone:** {shot.get('narrative_tone', '').title()} | **Category:** {shot.get('category', '').title()} | **Continuity:** {continuity_str}  ",
                "",
                "### Narration",
                f"> \"{shot.get('narration', '').strip()}\"",
                "",
                "### Visual Objective",
                f"{shot.get('visual_objective', '').strip()}",
                "",
                "### Flow / Veo Prompt",
                "```text",
                shot.get("veo_prompt", "").strip(),
                "```",
                "",
                "### Production Constraints",
            ])

            constraints = shot.get("constraints", STANDARD_VEO_CONSTRAINTS)
            for c in constraints:
                lines.append(f"- {c.title()}")

            lines.extend(["", "---", ""])

        return "\n".join(lines)

    # -------------------------------------------------------------------------
    # PERSISTENCE & ATOMIC WRITES
    # -------------------------------------------------------------------------
    def _atomic_write_file(self, target_path: Path, content: str) -> None:
        """Write file atomically using a temporary file to avoid corruption."""
        temp_path = target_path.with_suffix(f".tmp_{datetime.now().strftime('%f')}")
        try:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with open(temp_path, "w", encoding="utf-8") as f:
                f.write(content)
            temp_path.replace(target_path)
        except Exception as e:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
            raise IOError(f"Failed to atomically write {target_path}: {e}")

    def plan_project_veo_shots(
        self,
        project_dir: Path,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Generate or regenerate complete Veo shot plan and prompt packs for a project.
        Enforces regeneration backup archive to prevent data loss.
        """
        scene_plan_path = project_dir / "scene_plan.json"
        script_path = project_dir / "script.txt"
        audio_path = project_dir / "audio.wav"
        ts_path = project_dir / "timestamps.json"

        if not scene_plan_path.is_file():
            raise FileNotFoundError(f"Missing scene_plan.json in {project_dir}. Generate scene plan first.")
        if not script_path.is_file():
            raise FileNotFoundError(f"Missing script.txt in {project_dir}.")
        if not audio_path.is_file():
            raise FileNotFoundError(f"Missing audio.wav in {project_dir}.")
        if not ts_path.is_file():
            raise FileNotFoundError(f"Missing timestamps.json in {project_dir}.")

        with open(scene_plan_path, "r", encoding="utf-8") as f:
            scene_data = json.load(f)

        audio_duration = float(scene_data.get("audio_duration", 0.0))
        scenes = scene_data.get("scenes", [])
        if not scenes:
            raise ValueError("scene_plan.json contains no scenes.")

        script_sha256 = compute_file_sha256(script_path)
        audio_sha256 = compute_file_sha256(audio_path)
        ts_sha256 = compute_file_sha256(ts_path)
        scene_sha256 = compute_file_sha256(scene_plan_path)

        # Regeneration safety: archive existing plan if present
        existing_plan_path = project_dir / "veo_prompts.json"
        if existing_plan_path.is_file():
            archive_name = f"veo_prompts_archive_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            shutil.copy2(existing_plan_path, project_dir / archive_name)
            shutil.copy2(existing_plan_path, project_dir / "veo_prompts.json.bak")
            logger.info(f"Archived previous Veo shot plan to {archive_name}")

        # Plan shots
        shots = self.plan_shots_from_scenes(scenes, audio_duration)

        now_iso = datetime.now(timezone.utc).isoformat()
        veo_data: Dict[str, Any] = {
            "version": 1,
            "project": project_dir.name,
            "created_at": now_iso,
            "updated_at": now_iso,
            "generator_version": "6.0.0",
            "source_script_sha256": script_sha256,
            "audio_sha256": audio_sha256,
            "timestamps_sha256": ts_sha256,
            "scene_plan_sha256": scene_sha256,
            "audio_duration": audio_duration,
            "scene_count": len(scenes),
            "shot_count": len(shots),
            "full_timeline_coverage": 100.0,
            "status": "Ready",
            "shots": shots,
        }

        # Validate
        errors = self.validate_veo_plan(veo_data, audio_duration, scenes)
        if errors:
            raise VeoPlanValidationError(f"Veo shot plan validation failed: {'; '.join(errors)}")

        # Build markdown prompt pack
        prompt_md = self.build_markdown_prompt_pack(veo_data)

        # Atomic writes
        self._atomic_write_file(project_dir / "veo_prompts.json", json.dumps(veo_data, indent=2, ensure_ascii=False))
        self._atomic_write_file(project_dir / "veo_prompts.md", prompt_md)

        logger.info(f"Successfully generated {len(shots)} Veo video shots for {project_dir.name} (100% coverage).")
        return veo_data

    plan_project_veo = plan_project_veo_shots


    # -------------------------------------------------------------------------
    # STALENESS & STATUS
    # -------------------------------------------------------------------------
    def check_veo_status(self, project_dir: Path) -> Dict[str, Any]:
        """Check status and staleness against canonical upstream sources."""
        veo_path = project_dir / "veo_prompts.json"
        if not veo_path.is_file():
            return {
                "status": "Not Generated",
                "shot_count": 0,
                "coverage": 0.0,
                "audio_duration": 0.0,
                "stale_reason": None,
            }

        try:
            with open(veo_path, "r", encoding="utf-8") as f:
                veo_data = json.load(f)
        except Exception as e:
            return {
                "status": "Error",
                "shot_count": 0,
                "coverage": 0.0,
                "audio_duration": 0.0,
                "stale_reason": f"Corrupted veo_prompts.json: {e}",
            }

        # Check hashes
        script_p = project_dir / "script.txt"
        audio_p = project_dir / "audio.wav"
        ts_p = project_dir / "timestamps.json"
        scene_p = project_dir / "scene_plan.json"

        stale_reasons = []
        if compute_file_sha256(script_p) != veo_data.get("source_script_sha256"):
            stale_reasons.append("script.txt modified")
        if compute_file_sha256(audio_p) != veo_data.get("audio_sha256"):
            stale_reasons.append("audio.wav modified")
        if compute_file_sha256(ts_p) != veo_data.get("timestamps_sha256"):
            stale_reasons.append("timestamps.json modified")
        if compute_file_sha256(scene_p) != veo_data.get("scene_plan_sha256"):
            stale_reasons.append("scene_plan.json modified")

        status = "Stale" if stale_reasons else "Ready"
        return {
            "status": status,
            "shot_count": veo_data.get("shot_count", len(veo_data.get("shots", []))),
            "coverage": veo_data.get("full_timeline_coverage", 100.0),
            "audio_duration": veo_data.get("audio_duration", 0.0),
            "stale_reason": "; ".join(stale_reasons) if stale_reasons else None,
            "created_at": veo_data.get("created_at"),
            "updated_at": veo_data.get("updated_at"),
        }

    # -------------------------------------------------------------------------
    # MANUAL EDITING
    # -------------------------------------------------------------------------
    def update_shot(
        self,
        project_dir: Path,
        shot_id: str,
        updates: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Manually edit shot visual attributes without modifying Phase 5 scene_plan.json.
        Re-validates and atomically persists veo_prompts.json and veo_prompts.md.
        """
        veo_path = project_dir / "veo_prompts.json"
        if not veo_path.is_file():
            raise FileNotFoundError(f"Veo shot plan not found in {project_dir}")

        with open(veo_path, "r", encoding="utf-8") as f:
            plan = json.load(f)

        target_shot = None
        for s in plan.get("shots", []):
            if s.get("shot_id") == shot_id:
                target_shot = s
                break

        if not target_shot:
            raise KeyError(f"Shot {shot_id} not found in project Veo shot plan.")

        # Allowed editable fields
        allowed_fields = [
            "visual_objective",
            "subject_action",
            "environment_motion",
            "environmental_action",
            "shot_type",
            "camera_motion",
            "camera_framing",
            "lighting",
            "lighting_atmosphere",
            "narrative_tone",
            "tone",
            "aspect_ratio",
            "continuity_anchor",
            "veo_prompt",
            "negative_prompt",
        ]

        changed = False
        for field in allowed_fields:
            if field in updates and updates[field] is not None:
                val = updates[field]
                if field == "shot_type" and val not in VEO_SHOT_TYPES:
                    raise ValueError(f"Invalid shot type: {val}")
                target_shot[field] = val
                if field == "environmental_action":
                    target_shot["environment_motion"] = val
                elif field == "lighting_atmosphere":
                    target_shot["lighting"] = val
                elif field == "tone":
                    target_shot["narrative_tone"] = val
                changed = True


        if changed:
            target_shot["status"] = "edited"
            plan["updated_at"] = datetime.now(timezone.utc).isoformat()

            # Validate against parent scenes
            scene_plan_path = project_dir / "scene_plan.json"
            parent_scenes = []
            if scene_plan_path.is_file():
                with open(scene_plan_path, "r", encoding="utf-8") as f:
                    sc_data = json.load(f)
                parent_scenes = sc_data.get("scenes", [])

            errors = self.validate_veo_plan(plan, plan.get("audio_duration", 0.0), parent_scenes)
            if errors:
                raise VeoPlanValidationError(f"Edited shot validation failed: {'; '.join(errors)}")

            # Synchronize Markdown
            prompt_md = self.build_markdown_prompt_pack(plan)

            # Atomic writes
            self._atomic_write_file(veo_path, json.dumps(plan, indent=2, ensure_ascii=False))
            self._atomic_write_file(project_dir / "veo_prompts.md", prompt_md)

        return target_shot


veo_generator = VeoPromptGenerator()
