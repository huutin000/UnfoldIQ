"""
UnfoldIQ Visual Scene to Video Shot Engine — Google Flow / Veo Prompt Generator (Phase 7)
Transforms verified scene plans, speech timestamps, and narration scripts into
production-ready, temporal video generation prompt packs for Google Flow / Veo.

Phase 7 upgrades:
- Dynamic visual beat derivation from narration content (not pure duration splitting)
- shotPurpose enum (ESTABLISH/ACTION/DETAIL/REVEAL/REACTION/EVIDENCE/COMPARISON/TRANSITION/PAYOFF/CONTINUATION)
- Per-shot distinct subject_action, camera_framing, visual_objective
- Adjacent duplicate detection (multi-signal: purpose + subject + camera + environment + prompt)
- Bounded automatic regeneration of duplicate shots (max 3 retries)
- Scene-level validators: coverage, parent mapping, continuity, narration coverage
- shotGeneratorVersion + sourceScenePlanHash in canonical output
- Per-scene regeneration support
- OUTDATED detection on generator version mismatch
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

# Current generator version — bump this when shot generation logic changes materially.
# Old output with a different version will be flagged as OUTDATED.
CURRENT_GENERATOR_VERSION = "7.0.0"

# Shot Purpose Enum — strict vocabulary for semantic shot classification.
SHOT_PURPOSE_ENUM = [
    "ESTABLISH",    # Sets location / scale / period / environment / spatial context
    "ACTION",       # Shows meaningful subject action / physical event / behavioral progression
    "DETAIL",       # Focuses on specific object / body detail / tool / evidence / texture
    "REVEAL",       # Introduces new information / unexpected subject / important discovery
    "REACTION",     # Shows response / emotion / behavioral reaction / consequence
    "EVIDENCE",     # Visualizes archaeological / scientific evidence / artifact / fossil / data-backed clue
    "COMPARISON",   # Explicitly compares before/after, species, scale, behavior, evidence
    "TRANSITION",   # Moves story/context between time / location / subject / narrative beat (must have visual content)
    "PAYOFF",       # Shows the visual conclusion of a prior setup
    "CONTINUATION", # Continues same event/subject BUT must introduce meaningful progression
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

# Duplicate detection threshold: if similarity score >= this, treat as duplicate
_DUPLICATE_SCORE_THRESHOLD = 3


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


# ---------------------------------------------------------------------------
# VISUAL BEAT DERIVATION
# ---------------------------------------------------------------------------

# Keywords that signal a visual beat change in narration
_ACTION_VERBS = [
    "hunt", "attack", "flee", "chase", "kill", "escape", "strike", "run", "leap",
    "dig", "discover", "found", "reveal", "uncover", "examine", "study", "analyze",
    "build", "create", "craft", "knap", "flake", "shape", "use", "carry",
    "migrate", "travel", "cross", "enter", "emerge", "return", "spread",
    "evolve", "adapt", "develop", "transform", "change",
    "eat", "feed", "consume", "drink",
    "gather", "forage", "scavenge",
    "communicate", "signal", "warn",
    "watch", "observe", "scan", "listen",
]

_EVIDENCE_KEYWORDS = [
    "fossil", "bone", "skull", "artifact", "tool", "stone", "flint", "obsidian",
    "evidence", "excavat", "archaeological", "site", "layer", "strat", "sediment",
    "remains", "specimen", "dating", "analysis", "genome", "dna", "isotope",
]

_REVEAL_KEYWORDS = [
    "reveals", "discovered", "surprising", "unexpected", "first time", "new evidence",
    "scientists found", "research shows", "study reveals", "recent discovery",
    "breakthrough", "unprecedented", "turns out", "in fact",
]

_REACTION_KEYWORDS = [
    "response", "react", "fear", "terror", "panic", "retreat", "freeze",
    "cautious", "wary", "alert", "threatened", "danger", "prey",
]

_COMPARISON_KEYWORDS = [
    "compared to", "unlike", "whereas", "in contrast", "however", "while",
    "versus", "vs", "similar to", "difference", "both", "neither",
    "smaller than", "larger than", "faster", "slower",
]


def derive_visual_beats(scene: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract visual beat opportunities from scene narration.
    Returns a list of beat dicts with 'purpose', 'signal', 'weight'.
    The number and types of beats inform dynamic shot count planning.
    """
    narration = scene.get("narration", "").strip()
    category = scene.get("category", "reconstruction")
    tone = scene.get("tone") or scene.get("narrative_tone", "neutral_explanatory")
    duration = float(scene.get("duration", scene.get("end", 0.0)) if "duration" in scene else
                     float(scene.get("end", 0.0)) - float(scene.get("start", 0.0)))

    text_lower = narration.lower()
    beats: List[Dict[str, Any]] = []

    # Beat 1: Establishing shot — always generated for first beat of any scene
    beats.append({"purpose": "ESTABLISH", "signal": "scene_start", "weight": 1.0})

    # Beat 2: Evidence beat — triggered by archaeological/scientific evidence keywords
    has_evidence = any(k in text_lower for k in _EVIDENCE_KEYWORDS)
    if has_evidence and category in ("artifact", "detail/macro", "reconstruction", "anatomy/science"):
        beats.append({"purpose": "EVIDENCE", "signal": "evidence_keyword", "weight": 0.9})

    # Beat 3: Reveal beat — new information or discovery
    has_reveal = any(k in text_lower for k in _REVEAL_KEYWORDS)
    if has_reveal:
        beats.append({"purpose": "REVEAL", "signal": "reveal_keyword", "weight": 0.85})

    # Beat 4: Action beat — physical or behavioral event
    sentence_count = len([s for s in re.split(r'[.!?]+', narration) if s.strip()])
    has_action = any(k in text_lower for k in _ACTION_VERBS)
    if has_action and category not in ("timeline", "map"):
        beats.append({"purpose": "ACTION", "signal": "action_verb", "weight": 0.8})

    # Beat 5: Comparison beat
    has_comparison = any(k in text_lower for k in _COMPARISON_KEYWORDS)
    if has_comparison:
        beats.append({"purpose": "COMPARISON", "signal": "comparison_keyword", "weight": 0.7})

    # Beat 6: Reaction beat — for tension scenes
    has_reaction = tone == "tension" or any(k in text_lower for k in _REACTION_KEYWORDS)
    if has_reaction and "ESTABLISH" in [b["purpose"] for b in beats]:
        beats.append({"purpose": "REACTION", "signal": "tension_tone", "weight": 0.75})

    # Beat 7: Detail beat — for longer narrations or when process/artifact category
    if category in ("process", "artifact", "detail/macro") or sentence_count >= 3:
        beats.append({"purpose": "DETAIL", "signal": "category_or_length", "weight": 0.65})

    # Beat 8: Payoff or Transition for terminal beats in long scenes
    if duration >= 12.0 and category in ("transition", "reconstruction"):
        beats.append({"purpose": "PAYOFF", "signal": "duration_terminal", "weight": 0.6})

    # Deduplicate purposes, keeping highest weight
    seen_purposes: Dict[str, float] = {}
    unique_beats = []
    for b in beats:
        if b["purpose"] not in seen_purposes or b["weight"] > seen_purposes[b["purpose"]]:
            seen_purposes[b["purpose"]] = b["weight"]
            unique_beats = [ub for ub in unique_beats if ub["purpose"] != b["purpose"]]
            unique_beats.append(b)

    # Sort by weight descending
    unique_beats.sort(key=lambda x: x["weight"], reverse=True)
    return unique_beats


def determine_dynamic_shot_count(
    scene: Dict[str, Any],
    beats: List[Dict[str, Any]],
    target_duration: float = 6.0,
    preferred_max_duration: float = 8.0,
    min_duration: float = 3.0,
) -> int:
    """
    Determine the optimal number of shots for a scene.
    Considers: duration, visual beat count, narration density.
    Returns an integer >= 1.
    """
    duration = float(scene.get("duration", 0.0)) if "duration" in scene else (
        float(scene.get("end", 0.0)) - float(scene.get("start", 0.0))
    )
    narration = scene.get("narration", "")
    sentence_count = len([s for s in re.split(r'[.!?]+', narration) if s.strip()])
    word_count = len(narration.split())
    beat_count = len(beats)

    # Very short scenes: always 1 shot
    if duration <= min_duration:
        return 1

    # Scenes within preferred max duration (<= 8s) remain a single shot
    if duration <= preferred_max_duration:
        return 1

    # For longer scenes (> 8s), determine count by duration and visual beats
    duration_based = max(2, int(round(duration / target_duration)))
    beat_based = min(beat_count, max(1, int(duration / min_duration)))
    density_bonus = 1 if sentence_count >= 4 and duration >= 14.0 else 0

    count = max(duration_based, beat_based) + density_bonus

    # Safety: ensure minimum shot duration is respected
    while count > 1 and (duration / count) < min_duration:
        count -= 1

    return max(1, count)


def _canonical_json(obj: Any) -> str:
    """Deterministic serialization for hashing (never Python hash())."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def scene_content_hash(scene: Dict[str, Any]) -> str:
    """Stable identity hash of one scene's content (P0.2 per-scene invalidation)."""
    return hashlib.sha256(_canonical_json(scene).encode("utf-8")).hexdigest()


def compute_scene_hashes(scenes: List[Dict[str, Any]]) -> Dict[str, str]:
    return {sc["scene_id"]: scene_content_hash(sc) for sc in scenes if sc.get("scene_id")}


def _compute_shot_similarity(a: Dict[str, Any], b: Dict[str, Any]) -> int:
    """
    Compute multi-signal similarity score between two adjacent shots.
    Score >= _DUPLICATE_SCORE_THRESHOLD is considered a duplicate.
    Fields compared: purpose, subject_action, camera_framing, camera_motion,
    visual_objective (first 60 chars), environment.
    """
    score = 0
    # Purpose match
    if a.get("shotPurpose") and a.get("shotPurpose") == b.get("shotPurpose"):
        score += 1
    # Camera framing match
    if a.get("camera_framing") and a.get("camera_framing") == b.get("camera_framing"):
        score += 1
    # Camera motion match
    if a.get("camera_motion") and a.get("camera_motion") == b.get("camera_motion"):
        score += 1
    # Subject action similarity (first 50 chars)
    a_action = (a.get("subject_action") or "")[:50].lower().strip()
    b_action = (b.get("subject_action") or "")[:50].lower().strip()
    if a_action and a_action == b_action:
        score += 1
    # Environment match (first 50 chars)
    a_env = (a.get("environment") or "")[:50].lower().strip()
    b_env = (b.get("environment") or "")[:50].lower().strip()
    if a_env and a_env == b_env:
        score += 1
    # Visual objective similarity (first 60 chars)
    a_obj = (a.get("visual_objective") or "")[:60].lower().strip()
    b_obj = (b.get("visual_objective") or "")[:60].lower().strip()
    if a_obj and a_obj == b_obj:
        score += 1
    return score


def detect_adjacent_duplicates(shots: List[Dict[str, Any]]) -> List[Tuple[int, int, int]]:
    """
    Detect adjacent duplicate pairs within the same scene.
    Returns list of (index_a, index_b, score) for pairs exceeding threshold.
    """
    duplicates = []
    for i in range(len(shots) - 1):
        a = shots[i]
        b = shots[i + 1]
        # Only compare shots within the same scene
        if a.get("scene_id") != b.get("scene_id"):
            continue
        score = _compute_shot_similarity(a, b)
        if score >= _DUPLICATE_SCORE_THRESHOLD:
            duplicates.append((i, i + 1, score))
    return duplicates



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
        # P2.7: last duplicate-repair run metrics (zeros until first planning pass)
        self.last_dup_metrics = {"initial_pairs": 0, "passes_used": 0, "remaining": 0}


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
    # PURPOSE-DRIVEN CAMERA STRATEGY
    # -------------------------------------------------------------------------
    def _purpose_camera_strategy(
        self,
        purpose: str,
        category: str,
        tone: str,
        domain: str,
        shot_sub_idx: int,
        num_shots: int,
    ) -> Tuple[str, str]:
        """
        Derive shot_type and camera_motion from shotPurpose rather than just index.
        Ensures ESTABLISH is wide, DETAIL is close, ACTION uses tracking, etc.
        """
        if purpose == "ESTABLISH":
            if category == "map":
                return "top-down", "slow forward tracking"
            if category == "timeline":
                return "wide", "slow lateral tracking"
            if tone == "awe":
                return "extreme wide", "slow pull-back"
            return "wide", "slow pan right"

        if purpose == "ACTION":
            if tone == "tension":
                return "medium wide", "controlled handheld"
            return "medium", "slow forward tracking"

        if purpose in ("DETAIL", "EVIDENCE"):
            if category == "artifact":
                return "close-up", "slow push-in"
            if category == "detail/macro":
                return "macro/detail", "slow push-in"
            return "medium close-up", "slow push-in"

        if purpose == "REVEAL":
            return "medium close-up", "slow pull-back"

        if purpose == "REACTION":
            if tone == "tension":
                return "close-up", "static"
            return "medium close-up", "slow push-in"

        if purpose == "COMPARISON":
            return "medium wide", "slow lateral tracking"

        if purpose == "TRANSITION":
            return "medium wide", "slow lateral tracking"

        if purpose == "PAYOFF":
            if tone == "awe":
                return "wide", "slow pull-back"
            return "medium wide", "slow push-in"

        if purpose == "CONTINUATION":
            # Must differ from previous — use close-up/tracking to add progression
            if shot_sub_idx % 2 == 0:
                return "medium close-up", "slow push-in"
            return "medium", "slow forward tracking"

        # Fallback: use existing strategy
        return self.infer_camera_strategy(category, tone, domain, shot_sub_idx, num_shots)

    def _purpose_subject_action(
        self,
        purpose: str,
        narration: str,
        category: str,
        domain: str,
        tone: str,
        shot_sub_idx: int,
        base_subject: str,
        base_action: str,
    ) -> Tuple[str, str]:
        """
        Override subject_action to match shotPurpose semantics.
        Each purpose must produce a meaningfully different action from ESTABLISH.
        """
        text_lower = narration.lower()

        if purpose == "ESTABLISH":
            # Wide context-setting — use the base subject/action from domain builder
            return base_subject, base_action

        if purpose == "ACTION":
            if domain == "prehistory":
                if tone == "tension":
                    return base_subject, "moving rapidly through undergrowth, crouching low to avoid detection by distant predator"
                return base_subject, "actively engaged in purposeful physical movement across the terrain"
            if domain == "astrophysics":
                return base_subject, "observable motion and energy emission patterns visible in real time"
            return base_subject, "executing focused physical action relevant to the narrated event"

        if purpose == "DETAIL":
            if domain == "prehistory" and category in ("artifact", "detail/macro", "process"):
                subj_detail = f"hands of {base_subject}" if base_subject else "hands of an early hominid"
                return subj_detail, "precise grip and controlled pressure visible on stone tool edge"
            if domain == "astrophysics":
                return "observable surface detail of the astronomical object", "fine structural detail resolving through optical clarity"
            if domain == "computing_technology":
                return "circuit substrate and component detail", "micro-fabricated trace and junction structure illuminated by raking light"
            return f"specific surface or structural detail of {base_subject}" if base_subject else "specific surface or structural detail of the primary subject", "fine texture and material composition revealed under directional light"

        if purpose == "EVIDENCE":
            if domain == "prehistory":
                subj_ev = f"fossilized remains or stone tool artifact associated with {base_subject}" if base_subject else "fossilized remains or stone tool artifact"
                return subj_ev, "resting in-situ as soft raking light reveals surface wear and geological context"
            if domain == "computing_technology":
                return "period-accurate hardware evidence and technical documentation", "visible evidence of design evolution and material craft"
            return f"material evidence relevant to {base_subject}" if base_subject else "material evidence relevant to the narrated discovery", "displayed in scientific context under analytical illumination"

        if purpose == "REVEAL":
            if domain == "prehistory":
                subj_rev = f"previously obscured discovery or unexpected finding related to {base_subject}" if base_subject else "previously obscured discovery or unexpected finding"
                return subj_rev, "emerging into frame as camera repositions to expose new information"
            return base_subject, "coming into focus as the camera reveals previously unseen spatial relationship"

        if purpose == "REACTION":
            if domain == "prehistory":
                return base_subject, "pausing abruptly and scanning surroundings with heightened biological alertness"
            return base_subject, "registering the consequence of the preceding action through visible behavioral response"

        if purpose == "COMPARISON":
            # Show two things side by side or sequentially
            return "two distinct subjects or states under comparison", "juxtaposed within frame to highlight scale or behavioral contrast"

        if purpose == "TRANSITION":
            if domain == "prehistory":
                subj_tr = f"the wider environment context around {base_subject}" if base_subject else "the wider environment context"
                return subj_tr, "camera pulling back slowly to reveal landscape transition and narrative shift"
            return "transitional environmental context", "smooth visual shift indicating change in time, location, or narrative focus"

        if purpose == "PAYOFF":
            if tone == "tension":
                return base_subject, "reaching visual resolution of the preceding tension with clear outcome visible"
            if tone == "awe":
                return base_subject, "framed against the full scale of the environment in the payoff composition"
            return base_subject, "in the culminating visual position that concludes the scene's narrative arc"

        if purpose == "CONTINUATION":
            # MUST have progression — different camera position / new information
            if domain == "prehistory":
                return base_subject, "continuing forward as new environmental detail enters the foreground frame"
            return base_subject, "progressing through action while new compositional element or information enters frame"

        return base_subject, base_action

    def _purpose_visual_objective(
        self,
        purpose: str,
        scene_visual_summary: str,
        narration: str,
        shot_sub_idx: int,
        num_shots: int,
    ) -> str:
        """Generate a distinct visual objective per shot purpose."""
        summary = scene_visual_summary or f"Scene visualization"
        narr_short = narration[:50].rstrip() if narration else "narrated event"

        purpose_objectives = {
            "ESTABLISH": f"{summary} — wide establishing view setting location, scale and environmental context",
            "ACTION": f"{summary} — action beat showing {narr_short[:40]}... in physical progression",
            "DETAIL": f"Close detail of specific evidence, tool or texture supporting the narration",
            "EVIDENCE": f"Material evidence visualization: artifact, fossil or scientific data in context",
            "REVEAL": f"Reveal moment: new information or discovery entering the frame",
            "REACTION": f"Reaction beat: subject behavioral response to the preceding event",
            "COMPARISON": f"Comparison visual: two states, species or scales juxtaposed in frame",
            "TRANSITION": f"Transition: environmental or narrative shift illustrated visually",
            "PAYOFF": f"Payoff: visual conclusion of the scene's primary narrative arc",
            "CONTINUATION": f"{summary} — continuation with meaningful progression (Shot {shot_sub_idx}/{num_shots})",
        }
        return purpose_objectives.get(purpose, f"{summary} (Shot {shot_sub_idx}/{num_shots})")

    # -------------------------------------------------------------------------
    # SCENE-TO-SHOT PLANNING WITH VISUAL BEATS
    # -------------------------------------------------------------------------
    def plan_shots_from_scenes(
        self,
        scenes: List[Dict[str, Any]],
        audio_duration: float,
        rebase_timeline: bool = True,
        visual_bible: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Phase 7 & 10: Dynamic scene-to-shot planning driven by visual beats, shotPurpose,
        and canonical Visual Bible continuity anchors.

        Invariants:
        1. Shot count is derived from visual beat analysis + duration, NOT fixed rules.
        2. Visual Bible metadata alone does NOT alter shot count.
        3. Each shot has a unique shotPurpose from SHOT_PURPOSE_ENUM.
        4. Adjacent shots within same scene have distinct purpose + camera + subject_action.
        5. sum(child_shot_durations) == parent_scene_duration.
        6. First shot start = 0.000s, last shot end = audio_duration.
        7. Full project timeline coverage = 100.0%, 0 gaps, 0 overlaps.
        8. Does NOT mutate input scenes.
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
            visual_summary = scene.get("visual_summary", "")

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

            # Build base subject/action from domain knowledge (used by some purposes)
            base_subject, base_action = self.build_subject_and_action(
                narration=narration,
                category=category,
                domain=domain,
                tone=tone,
                shot_progression_index=1,
            )
            environment, env_motion = self.build_environment_and_motion(
                category=category,
                domain=domain,
                tone=tone,
            )
            # Resolve continuity group and environment from visual bible if not present on scene
            has_explicit_groups = any(s.get("continuity_group") or s.get("continuityGroupId") for s in scenes)
            scene_cg_id = scene.get("continuityGroupId") or scene.get("continuity_group")
            scene_env_id = scene.get("environmentId")
            if not has_explicit_groups and visual_bible:
                for cg in visual_bible.get("continuityGroups", []):
                    if scene_id in cg.get("sceneIds", []):
                        if not scene_cg_id:
                            scene_cg_id = cg.get("continuityGroupId")
                        if not scene_env_id:
                            scene_env_id = cg.get("environmentId")
                        break

            continuity_anchor = self.build_continuity_anchor(scene, domain)

            # Phase 10: compact continuity anchor from Visual Bible if available
            if visual_bible and scene_cg_id:
                try:
                    from studio.visual_continuity import visual_continuity_director
                    vb_anchor = visual_continuity_director.build_compact_continuity_anchor(
                        {"continuityGroupId": scene_cg_id}, visual_bible
                    )
                    if vb_anchor:
                        continuity_anchor = vb_anchor
                except Exception as ex:
                    logger.debug(f"Visual Bible anchor resolution fallback: {ex}")

            # ── Visual beat derivation ──
            beats = derive_visual_beats(scene)
            num_shots = determine_dynamic_shot_count(
                scene, beats,
                target_duration=self.target_duration,
                preferred_max_duration=self.preferred_max_duration,
                min_duration=self.min_duration,
            )

            # Assign purposes to shots (cycle through beats, fall back to CONTINUATION)
            shot_purposes: List[str] = []
            for i in range(num_shots):
                if i < len(beats):
                    shot_purposes.append(beats[i]["purpose"])
                else:
                    shot_purposes.append("CONTINUATION")

            # Split scene timeline into balanced child intervals
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

            # ── Construct per-beat shot objects ──
            for shot_sub_idx, (s_start, s_end, s_dur) in enumerate(child_intervals, start=1):
                purpose = shot_purposes[shot_sub_idx - 1]

                # Purpose-driven camera strategy
                shot_type, camera_motion = self._purpose_camera_strategy(
                    purpose=purpose,
                    category=category,
                    tone=tone,
                    domain=domain,
                    shot_sub_idx=shot_sub_idx,
                    num_shots=num_shots,
                )
                # For single-shot scenes, honour scene-level hints if available
                if num_shots == 1:
                    if scene.get("shot_type") in VEO_SHOT_TYPES:
                        shot_type = scene["shot_type"]
                    if scene.get("camera_motion"):
                        camera_motion = scene["camera_motion"]

                # Purpose-driven subject & action (ensures per-shot differentiation)
                subject, subject_action = self._purpose_subject_action(
                    purpose=purpose,
                    narration=narration,
                    category=category,
                    domain=domain,
                    tone=tone,
                    shot_sub_idx=shot_sub_idx,
                    base_subject=base_subject,
                    base_action=base_action,
                )

                # Per-shot distinct visual objective
                visual_obj = self._purpose_visual_objective(
                    purpose=purpose,
                    scene_visual_summary=visual_summary,
                    narration=narration,
                    shot_sub_idx=shot_sub_idx,
                    num_shots=num_shots,
                )

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
                    # canonical ID fields — both naming conventions for compatibility
                    "scene_id": scene_id,
                    "parent_scene_id": scene_id,   # snake_case (existing schema)
                    "parentSceneId": scene_id,      # camelCase (spec requirement)
                    "parent_scene_index": scene.get("index", 1),
                    "index": global_shot_idx,
                    "scene_shot_index": shot_sub_idx,
                    "total_scene_shots": num_shots,
                    "shot_split_index": shot_sub_idx,
                    "shot_split_total": num_shots,
                    # timing
                    "start": s_start,
                    "end": s_end,
                    "duration": s_dur,
                    # content
                    "narration": narration,
                    "visual_objective": visual_obj,
                    "shotPurpose": purpose,          # camelCase (spec requirement)
                    "shot_purpose": purpose,          # snake_case alias
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
                    "continuity_group": scene_cg_id,
                    "continuityGroupId": scene_cg_id,
                    "continuity_anchor": continuity_anchor,
                    "subjectIds": scene.get("subjectIds", [visual_bible["subjects"][0]["subjectId"]] if (visual_bible and visual_bible.get("subjects")) else []),
                    "environmentId": scene_env_id or scene.get("environmentId", visual_bible["environments"][0]["environmentId"] if (visual_bible and visual_bible.get("environments")) else None),
                    "periodId": scene.get("periodId", visual_bible["periods"][0]["periodId"] if (visual_bible and visual_bible.get("periods")) else None),
                    "propIds": scene.get("propIds", [visual_bible["props"][0]["propId"]] if (visual_bible and visual_bible.get("props")) else []),
                    "veo_prompt": veo_prompt,
                    "negative_prompt": STANDARD_VEO_CONSTRAINTS_TEXT,
                    "constraints": list(STANDARD_VEO_CONSTRAINTS),
                    "status": "generated",
                }
                all_shots.append(shot_data)
                global_shot_idx += 1

        # Enforce exact timeline boundaries (full-plan calls only).
        # Single-scene callers (per-scene regeneration) pass rebase_timeline=False
        # to keep absolute scene positions: the per-scene splitter above already
        # produces exact absolute intervals.
        if rebase_timeline and all_shots:
            all_shots[0]["start"] = 0.000
            for i in range(len(all_shots) - 1):
                all_shots[i]["end"] = all_shots[i + 1]["start"]
                all_shots[i]["duration"] = round(all_shots[i]["end"] - all_shots[i]["start"], 3)
            all_shots[-1]["end"] = round(audio_duration, 3)
            all_shots[-1]["duration"] = round(all_shots[-1]["end"] - all_shots[-1]["start"], 3)

        # ── Adjacent duplicate detection + bounded regeneration ──
        all_shots = self._resolve_duplicates(all_shots, scenes, audio_duration)

        return all_shots

    def _resolve_duplicates(
        self,
        shots: List[Dict[str, Any]],
        scenes: List[Dict[str, Any]],
        audio_duration: float,
        max_retries: int = 3,
    ) -> List[Dict[str, Any]]:
        """
        Detect adjacent duplicates and regenerate the second shot with an
        alternative purpose. Uses bounded retry (max_retries per shot).
        Preserves timeline, parentSceneId, and continuity anchors.
        """
        # Build scene lookup
        scene_map = {sc["scene_id"]: sc for sc in scenes}
        MAX_PURPOSE_CYCLE = len(SHOT_PURPOSE_ENUM)

        # P2.7: repair instrumentation (also exposed via self.last_dup_metrics)
        initial_pairs = len(detect_adjacent_duplicates(shots))
        passes_used = 0

        for attempt in range(max_retries):
            duplicates = detect_adjacent_duplicates(shots)
            if not duplicates:
                break
            passes_used = attempt + 1
            logger.info(f"Duplicate resolution pass {attempt + 1}: {len(duplicates)} duplicate pairs found")

            for idx_a, idx_b, score in duplicates:
                if idx_b >= len(shots):
                    continue
                shot_b = shots[idx_b]
                scene_id = shot_b.get("scene_id")
                parent_scene = scene_map.get(scene_id, {})

                # Choose an alternative purpose not used by shot_a or the scene yet
                used_in_scene = {s.get("shotPurpose") for s in shots if s.get("scene_id") == scene_id}
                alt_purposes = [p for p in SHOT_PURPOSE_ENUM if p not in used_in_scene]
                if not alt_purposes:
                    # All purposes used — fall back to CONTINUATION with different camera
                    alt_purposes = ["CONTINUATION", "DETAIL", "PAYOFF"]

                new_purpose = alt_purposes[attempt % len(alt_purposes)]

                narration = shot_b.get("narration", "")
                category = shot_b.get("category", "reconstruction")
                domain = detect_narration_domain(narration)
                tone = shot_b.get("tone", "neutral_explanatory")

                base_subject, base_action = self.build_subject_and_action(
                    narration=narration, category=category, domain=domain,
                    tone=tone, shot_progression_index=idx_b + 1,
                )

                shot_type, camera_motion = self._purpose_camera_strategy(
                    purpose=new_purpose, category=category, tone=tone, domain=domain,
                    shot_sub_idx=idx_b + 1, num_shots=shot_b.get("total_scene_shots", 1),
                )
                subject, subject_action = self._purpose_subject_action(
                    purpose=new_purpose, narration=narration, category=category,
                    domain=domain, tone=tone, shot_sub_idx=idx_b + 1,
                    base_subject=base_subject, base_action=base_action,
                )
                visual_obj = self._purpose_visual_objective(
                    purpose=new_purpose,
                    scene_visual_summary=parent_scene.get("visual_summary", ""),
                    narration=narration,
                    shot_sub_idx=idx_b + 1,
                    num_shots=shot_b.get("total_scene_shots", 1),
                )
                environment, env_motion = self.build_environment_and_motion(
                    category=category, domain=domain, tone=tone,
                )
                lighting = shot_b.get("lighting", "natural diffused daylight with realistic environmental reflection")

                veo_prompt = self.build_veo_prompt(
                    subject=subject, subject_action=subject_action,
                    environment=environment, environment_motion=env_motion,
                    shot_type=shot_type, camera_motion=camera_motion,
                    lighting=lighting, domain=domain, tone=tone,
                    continuity_anchor=shot_b.get("continuity_anchor"),
                )

                # Update shot_b in place — preserve timing and identity
                shots[idx_b].update({
                    "shotPurpose": new_purpose,
                    "shot_purpose": new_purpose,
                    "subject": subject,
                    "subject_action": subject_action,
                    "environment": environment,
                    "environment_motion": env_motion,
                    "environmental_action": env_motion,
                    "shot_type": shot_type,
                    "camera_framing": f"{shot_type} documentary shot" if "shot" not in shot_type else shot_type,
                    "camera_motion": camera_motion,
                    "visual_objective": visual_obj,
                    "veo_prompt": veo_prompt,
                    "status": "regenerated_dedup",
                })
                logger.info(f"Resolved duplicate: shot {shots[idx_b]['shot_id']} → purpose changed to {new_purpose}")
        else:
            remaining = detect_adjacent_duplicates(shots)
            if remaining:
                logger.warning(f"{len(remaining)} duplicate pairs remain after {max_retries} resolution passes")

        self.last_dup_metrics = {
            "initial_pairs": initial_pairs,
            "passes_used": passes_used,
            "remaining": len(detect_adjacent_duplicates(shots)),
        }
        logger.info(
            "Duplicate repair: initial=%d passes=%d remaining=%d",
            self.last_dup_metrics["initial_pairs"],
            passes_used,
            self.last_dup_metrics["remaining"],
        )
        return shots

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
        Phase 7: Includes shotGeneratorVersion and sourceScenePlanHash in output.
        Archives existing plan before replacing (transactional — does not destroy
        the current canonical chain until the new one is validated).
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

        # Archive existing plan BEFORE generation (transactional).
        # The old canonical data remains valid until the new plan is committed.
        existing_plan_path = project_dir / "veo_prompts.json"
        if existing_plan_path.is_file():
            archive_name = f"veo_prompts_archive_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            shutil.copy2(existing_plan_path, project_dir / archive_name)
            shutil.copy2(existing_plan_path, project_dir / "veo_prompts.json.bak")
            logger.info(f"Archived previous Veo shot plan to {archive_name}")

        # Phase 10: Load or derive candidate Visual Bible
        vb = None
        try:
            from studio.visual_continuity import visual_continuity_director
            vb = visual_continuity_director.get_visual_bible(project_dir)
            if vb is None:
                vb = visual_continuity_director.derive_and_save(project_dir)
        except Exception as ex:
            logger.warning(f"Visual Bible auto-derivation skipped: {ex}")

        # Generate candidate shots using Phase 7 & 10 engine
        shots = self.plan_shots_from_scenes(scenes, audio_duration, visual_bible=vb)

        now_iso = datetime.now(timezone.utc).isoformat()
        # P1 (§4): lineage — artifact biết mình sinh từ script version nào.
        try:
            script_version = int(json.loads((project_dir / "script.json").read_text(encoding="utf-8")).get("version", 1))
        except Exception:
            script_version = 1
        veo_data: Dict[str, Any] = {
            "version": 1,
            "project": project_dir.name,
            "created_at": now_iso,
            "updated_at": now_iso,
            # Phase 7 & 10 fields — canonical dependency tracking
            "generator_version": CURRENT_GENERATOR_VERSION,
            "shotGeneratorVersion": CURRENT_GENERATOR_VERSION,
            "visualContinuityVersion": "10.0.0",
            "script_version": script_version,
            "sourceScenePlanHash": scene_sha256,
            "sourceVisualBibleHash": vb.get("visualBibleHash") if vb else None,
            # Existing hash fields (backward compat)
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
            # P0.2: per-scene source hashes for granular invalidation
            "sceneHashes": compute_scene_hashes(scenes),
            # P2.7: duplicate-repair metrics for this generation
            "duplicate_repair": dict(getattr(self, "last_dup_metrics", {})),
        }

        # Validate candidate — do NOT write if validation fails
        errors = self.validate_veo_plan(veo_data, audio_duration, scenes)
        if errors:
            raise VeoPlanValidationError(f"Veo shot plan validation failed: {'; '.join(errors)}")

        # Build markdown prompt pack
        prompt_md = self.build_markdown_prompt_pack(veo_data)

        # Atomic writes — replace canonical only after validation succeeds
        self._atomic_write_file(project_dir / "veo_prompts.json", json.dumps(veo_data, indent=2, ensure_ascii=False))
        self._atomic_write_file(project_dir / "veo_prompts.md", prompt_md)

        logger.info(f"Successfully generated {len(shots)} Veo video shots for {project_dir.name} (100% coverage).")
        return veo_data

    plan_project_veo = plan_project_veo_shots

    def regenerate_scene_shots(
        self,
        project_dir: Path,
        scene_id: str,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Regenerate shots for a single Scene without touching other Scenes' shots.
        Atomically merges new shots into the canonical veo_prompts.json.

        P1 (§5): scene có intake asset LOCKED thì từ chối regen trừ khi force=True
        (replace phải explicit).
        """
        scene_plan_path = project_dir / "scene_plan.json"
        veo_path = project_dir / "veo_prompts.json"

        if not scene_plan_path.is_file():
            raise FileNotFoundError(f"Missing scene_plan.json in {project_dir}.")
        if not veo_path.is_file():
            raise FileNotFoundError(f"Missing veo_prompts.json in {project_dir}.")

        if not force:
            try:
                from studio.asset_intake import asset_intake as _intake
                locked = [a for a in _intake.list_assets(project_dir, scene_id=scene_id)
                          if a.get("locked") or a.get("lifecycle") == "LOCKED"]
                if locked:
                    raise ValueError(
                        f"Scene {scene_id} có asset đã KHÓA ({locked[0].get('id')}). "
                        f"Hãy mở khóa hoặc xác nhận ghi đè rõ ràng trước khi tạo lại."
                    )
            except ValueError:
                raise
            except Exception:
                pass

        if not scene_plan_path.is_file():
            raise FileNotFoundError(f"Missing scene_plan.json in {project_dir}.")
        if not veo_path.is_file():
            raise FileNotFoundError(f"Missing veo_prompts.json in {project_dir}.")

        with open(scene_plan_path, "r", encoding="utf-8") as f:
            scene_data = json.load(f)
        with open(veo_path, "r", encoding="utf-8") as f:
            existing_veo = json.load(f)

        scenes = scene_data.get("scenes", [])
        target_scene = next((sc for sc in scenes if sc.get("scene_id") == scene_id), None)
        if target_scene is None:
            raise ValueError(f"Scene {scene_id} not found in scene_plan.json")

        audio_duration = float(scene_data.get("audio_duration", 0.0))

        # Archive before modification
        archive_name = f"veo_prompts_archive_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy2(veo_path, project_dir / archive_name)
        shutil.copy2(veo_path, project_dir / "veo_prompts.json.bak")

        # Generate new candidate shots for this scene only.
        # The planner partitions absolute scene time; pass rebase_timeline=False
        # so positions stay absolute (the full-plan rebase only applies to
        # whole-dataset calls starting at 0.000).
        scene_start = float(target_scene["start"])
        scene_end = float(target_scene["end"])
        vb = None
        vb_path = project_dir / "visual_bible.json"
        if vb_path.is_file():
            try:
                with open(vb_path, "r", encoding="utf-8") as f:
                    vb = json.load(f)
            except Exception:
                vb = None

        new_scene_shots = self.plan_shots_from_scenes(
            [target_scene], float(target_scene["end"]), rebase_timeline=False, visual_bible=vb
        )
        for s in new_scene_shots:
            # Clamp float noise to exact scene bounds (never silent invalid data:
            # merged validation below still rejects any violation).
            s["start"] = round(max(float(s["start"]), scene_start), 3)
            s["end"] = round(min(float(s["end"]), scene_end), 3)
            s["duration"] = round(s["end"] - s["start"], 3)
            s["outdated"] = False

        # Replace only shots belonging to this scene
        existing_shots = existing_veo.get("shots", [])
        kept_shots = [s for s in existing_shots if s.get("scene_id") != scene_id]

        # P1 (§5 FINAL-GAPS): targeted regen không re-index Scene khác.
        # Shot đã giữ nguyên shot_id ổn định; chỉ shot mới của scene đích nhận id mới
        # (suffix số lớn nhất hiện có +1). `index` là thứ tự hiển thị sau sort.
        import re as _re
        def _num_suffix(sid: str) -> int:
            m = _re.search(r"(\d+)$", str(sid or ""))
            return int(m.group(1)) if m else 0
        max_existing = 0
        for s in kept_shots:
            max_existing = max(max_existing, _num_suffix(s.get("shot_id")))
        for i, s in enumerate(new_scene_shots):
            s["shot_id"] = f"shot_{max_existing + i + 1:03d}"

        # Merge: kept shots + new scene shots, re-sort by start time
        merged = sorted(kept_shots + new_scene_shots, key=lambda s: float(s.get("start", 0)))

        # Thứ tự hiển thị tuần tự; shot_id của scene khác KHÔNG đổi.
        for i, s in enumerate(merged, start=1):
            s["index"] = i

        # Enforce global timeline boundaries
        if merged:
            merged[0]["start"] = 0.000
            for i in range(len(merged) - 1):
                merged[i]["end"] = merged[i + 1]["start"]
                merged[i]["duration"] = round(merged[i]["end"] - merged[i]["start"], 3)
            merged[-1]["end"] = round(audio_duration, 3)
            merged[-1]["duration"] = round(merged[-1]["end"] - merged[-1]["start"], 3)

        existing_veo["shots"] = merged
        existing_veo["shot_count"] = len(merged)
        existing_veo["updated_at"] = datetime.now(timezone.utc).isoformat()
        existing_veo["shotGeneratorVersion"] = CURRENT_GENERATOR_VERSION
        existing_veo["generator_version"] = CURRENT_GENERATOR_VERSION
        existing_veo["sourceScenePlanHash"] = compute_file_sha256(scene_plan_path)
        existing_veo["scene_plan_sha256"] = existing_veo["sourceScenePlanHash"]
        # P0.2: refresh per-scene source hashes from the current plan
        existing_veo["sceneHashes"] = compute_scene_hashes(scenes)
        # Phase 10: synchronize sourceVisualBibleHash if no outdated shots remain
        if vb and not any(s.get("outdated") for s in merged):
            existing_veo["sourceVisualBibleHash"] = vb.get("visualBibleHash")

        # Validate merged dataset
        errors = self.validate_veo_plan(existing_veo, audio_duration, scenes)
        if errors:
            raise VeoPlanValidationError(f"Per-scene regeneration validation failed: {'; '.join(errors)}")

        prompt_md = self.build_markdown_prompt_pack(existing_veo)
        self._atomic_write_file(veo_path, json.dumps(existing_veo, indent=2, ensure_ascii=False))
        self._atomic_write_file(project_dir / "veo_prompts.md", prompt_md)

        logger.info(f"Per-scene regeneration complete: {scene_id}, total shots now {len(merged)}")
        return existing_veo


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

        # Check generator version mismatch — old shots generated with legacy logic
        saved_gen_version = veo_data.get("shotGeneratorVersion") or veo_data.get("generator_version", "0.0.0")
        if saved_gen_version != CURRENT_GENERATOR_VERSION:
            stale_reasons.append(f"generator version mismatch (saved={saved_gen_version}, current={CURRENT_GENERATOR_VERSION})")

        # Phase 10: Check visual_bible.json hash
        vb_p = project_dir / "visual_bible.json"
        if vb_p.is_file():
            try:
                with open(vb_p, "r", encoding="utf-8") as f:
                    current_vb = json.load(f)
                saved_vb_hash = veo_data.get("sourceVisualBibleHash")
                if saved_vb_hash and current_vb.get("visualBibleHash") != saved_vb_hash:
                    stale_reasons.append("visual_bible.json modified")
            except Exception:
                pass

        # P0.2: per-scene invalidation. Only shots whose parent scene content
        # changed become outdated; structural changes (added/removed scenes) or
        # version mismatch invalidate the whole dataset. Replaces the old
        # whole-file scene_plan.json comparison.
        outdated_scenes: List[str] = []
        partial = False
        if scene_p.is_file():
            try:
                with open(scene_p, "r", encoding="utf-8") as f:
                    current_scenes = (json.load(f)).get("scenes", [])
                saved_hashes = veo_data.get("sceneHashes") or {}
                if not saved_hashes:
                    # No per-scene map (pre-P0.2 dataset): fall back to whole-dataset stale.
                    if compute_file_sha256(scene_p) != veo_data.get("scene_plan_sha256"):
                        stale_reasons.append("scene_plan.json modified (no per-scene map)")
                else:
                    current_ids = {sc.get("scene_id") for sc in current_scenes if sc.get("scene_id")}
                    saved_ids = set(saved_hashes.keys())
                    if current_ids != saved_ids:
                        stale_reasons.append("scene structure changed (added/removed scenes)")
                    else:
                        current_hashes = compute_scene_hashes(current_scenes)
                        outdated_scenes = sorted(
                            sid for sid in current_ids
                            if current_hashes.get(sid) != saved_hashes.get(sid)
                        )
                        if outdated_scenes:
                            stale_reasons.append(
                                "scene(s) modified: " + ", ".join(outdated_scenes)
                            )
                            # Partial only when nothing else invalidates the whole dataset.
                            partial = not any(
                                r.startswith(("script.txt", "audio.wav", "timestamps.json",
                                              "scene structure", "generator version"))
                                for r in stale_reasons
                            )
                            if not partial:
                                outdated_scenes = []
            except Exception as e:
                stale_reasons.append(f"scene comparison failed: {e}")

        # Phase 10: Collect any shots marked outdated (e.g. from partial visual continuity invalidation)
        shot_outdated_scenes = sorted(list({
            s.get("scene_id") or s.get("parentSceneId")
            for s in veo_data.get("shots", [])
            if s.get("outdated") and (s.get("scene_id") or s.get("parentSceneId"))
        }))
        if shot_outdated_scenes:
            for s_id in shot_outdated_scenes:
                if s_id not in outdated_scenes:
                    outdated_scenes.append(s_id)
            outdated_scenes.sort()
            if not any("visual continuity" in r or "scene(s) modified" in r for r in stale_reasons):
                stale_reasons.append("visual continuity modified: " + ", ".join(shot_outdated_scenes))

        total_shots = len(veo_data.get("shots", []))
        outdated_shots_count = sum(1 for s in veo_data.get("shots", []) if s.get("outdated"))

        has_global_stale = any(
            r.startswith(("script.txt", "audio.wav", "timestamps.json",
                          "scene structure", "generator version"))
            for r in stale_reasons
        )

        if outdated_shots_count >= total_shots and total_shots > 0:
            partial = False
        elif outdated_scenes and not has_global_stale and (outdated_shots_count < total_shots or not total_shots):
            partial = True
            if "visual_bible.json modified" in stale_reasons and outdated_shots_count < total_shots:
                stale_reasons = [r for r in stale_reasons if r != "visual_bible.json modified"]
        elif not partial and not outdated_scenes and not stale_reasons:
            partial = False

        status = "Stale" if stale_reasons else "Ready"
        return {
            "status": status,
            "shot_count": veo_data.get("shot_count", len(veo_data.get("shots", []))),
            "coverage": veo_data.get("full_timeline_coverage", 100.0),
            "audio_duration": veo_data.get("audio_duration", 0.0),
            "stale_reason": "; ".join(stale_reasons) if stale_reasons else None,
            "created_at": veo_data.get("created_at"),
            "updated_at": veo_data.get("updated_at"),
            "generator_version": saved_gen_version,
            "scene_plan_sha256": veo_data.get("scene_plan_sha256"),
            # P0.2: granular invalidation detail
            "partial": partial,
            "outdated_scenes": outdated_scenes,
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
