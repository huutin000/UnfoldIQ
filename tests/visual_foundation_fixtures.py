"""Shared fixtures for Phase 12–13 visual foundation tests (not a test module)."""

import json
import struct
import zlib
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from studio.scene_planner import compute_file_sha256
from studio.veo_prompt_generator import compute_scene_hashes, CURRENT_GENERATOR_VERSION
from studio.visual_continuity import VISUAL_CONTINUITY_VERSION


PROMPT_TXT = ("Cinematography: wide framing, camera: slow pan right. "
              "Action: test subject moving slowly. Environment: test grassland, "
              "gentle wind. Lighting: warm daylight. Style: photorealistic documentary "
              "cinematography. Composition: 16:9 widescreen composition. "
              "Explicit constraints: no spoken dialogue, no voiceover, no captions, "
              "no subtitles, no text, no watermark.")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def make_png_bytes() -> bytes:
    """Minimal valid 1x1 PNG (stdlib only)."""
    def chunk(ctype: bytes, data: bytes) -> bytes:
        c = ctype + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def build_foundation_project(root: Path, name: str = "proj_foundation",
                             audio_duration: float = 12.0) -> Path:
    """3 scenes / 4 shots project: s1->[A], s2->[A,B], s3->[] (group-less)."""
    p = root / name
    p.mkdir(parents=True, exist_ok=True)
    script = ("Homo habilis shaped stone tools at Olduvai Gorge. "
              "The group shared knowledge across generations. "
              "Firelight extended their working day into the night.")
    (p / "script.txt").write_text(script, encoding="utf-8")
    (p / "audio.wav").write_bytes(b"RIFF" + bytes(1000) + b"WAVE")
    (p / "timestamps.srt").write_text(
        "1\n00:00:00,000 --> 00:00:06,000\nTest.\n", encoding="utf-8")
    audio_hash = compute_file_sha256(p / "audio.wav")
    script_hash = compute_file_sha256(p / "script.txt")
    write_json(p / "timestamps.json", {
        "version": 1, "audio_file": "audio.wav", "audio_sha256": audio_hash,
        "audio_duration": audio_duration,
        "segments": [
            {"index": 1, "text": "Homo habilis shaped stone tools.",
             "start": 0.0, "end": 4.0},
            {"index": 2, "text": "A predator watches the group.",
             "start": 4.0, "end": 8.0},
            {"index": 3, "text": "The group ranged widely.",
             "start": 8.0, "end": 12.0},
        ]})

    scenes = [
        {"scene_id": "scene_001", "index": 1, "start": 0.0, "end": 4.0,
         "duration": 4.0, "speech_start": 0.0, "speech_end": 4.0,
         "timestamp_segment_ids": [1],
         "category": "reconstruction", "evidence_mode": "reconstruction",
         "shot_type": "wide", "camera_motion": "slow push-in",
         "continuity_group": None, "visual_summary": "Hominid band moving",
         "narration": "Homo habilis shaped stone tools.", "image_prompt": "x",
         "negative_prompt": "blurry", "status": "ready"},
        {"scene_id": "scene_002", "index": 2, "start": 4.0, "end": 8.0,
         "duration": 4.0, "speech_start": 4.0, "speech_end": 8.0,
         "timestamp_segment_ids": [2],
         "category": "reconstruction", "evidence_mode": "reconstruction",
         "shot_type": "medium", "camera_motion": "slow push-in",
         "continuity_group": None, "visual_summary": "Predator watches group",
         "narration": "A predator watches the group.", "image_prompt": "x",
         "negative_prompt": "blurry", "status": "ready"},
        {"scene_id": "scene_003", "index": 3, "start": 8.0, "end": 12.0,
         "duration": 4.0, "speech_start": 8.0, "speech_end": 12.0,
         "timestamp_segment_ids": [3],
         "category": "map", "evidence_mode": "conceptual",
         "shot_type": "wide", "camera_motion": "static",
         "continuity_group": None, "visual_summary": "Migration map",
         "narration": "The group ranged widely.", "image_prompt": "x",
         "negative_prompt": "blurry", "status": "ready"},
    ]
    write_json(p / "scene_plan.json", {
        "version": "1.0", "project": name, "planner_version": "1.0",
        "source_script_sha256": script_hash, "audio_sha256": audio_hash,
        "timestamps_sha256": compute_file_sha256(p / "timestamps.json"),
        "audio_duration": audio_duration, "scene_count": 3, "status": "ready",
        "scenes": scenes})
    sp_hash = compute_file_sha256(p / "scene_plan.json")

    bible = {
        "schemaVersion": "1.0.0", "generatorVersion": VISUAL_CONTINUITY_VERSION,
        "subjects": [
            {"subjectId": "subject_alpha_01", "name": "Alpha group",
             "species": "Homo habilis", "visualAnchors": ["anchor one"],
             "manualEdited": False},
            {"subjectId": "subject_beta_01", "name": "Beta predator",
             "species": "Panthera leo", "visualAnchors": ["anchor two"],
             "manualEdited": True},
        ],
        "environments": [
            {"environmentId": "env_plains_01", "locationName": "Plains"},
            {"environmentId": "env_river_01", "locationName": "River"},
        ],
        "periods": [{"periodId": "period_test_01", "label": "Test period"}],
        "props": [{"propId": "prop_tool_01", "name": "Tool"}],
        "continuityGroups": [
            {"continuityGroupId": "cg_001", "subjectIds": ["subject_alpha_01"],
             "environmentId": "env_plains_01", "periodId": "period_test_01",
             "persistentPropIds": ["prop_tool_01"],
             "sceneIds": ["scene_001"]},
            {"continuityGroupId": "cg_002",
             "subjectIds": ["subject_alpha_01", "subject_beta_01"],
             "environmentId": "env_river_01", "periodId": "period_test_01",
             "persistentPropIds": [],
             "sceneIds": ["scene_002"]},
        ],
        "visualStyle": {"styleName": "test-style"},
        "sourceScenePlanHash": sp_hash,
        "sourceScriptHash": script_hash,
    }
    from studio.visual_continuity import compute_visual_bible_hash
    from studio.visual_bible_v2 import script_entity_signature
    bible["visualBibleHash"] = compute_visual_bible_hash(bible)
    bible["sourceScriptEntityHash"] = script_entity_signature(script)
    write_json(p / "visual_bible.json", bible)
    vb_hash = bible["visualBibleHash"]

    def shot(sid, sc, idx, start, end, subs, env, purpose="ESTABLISH"):
        return {"shot_id": sid, "scene_id": sc, "parent_scene_id": sc,
                "parentSceneId": sc, "index": idx, "scene_shot_index": idx,
                "total_scene_shots": 1, "start": float(start), "end": float(end),
                "duration": round(float(end) - float(start), 3),
                "narration": f"Narration {sid}.", "shotPurpose": purpose,
                "continuity_group": "cg_001", "continuityGroupId": "cg_001",
                "subjectIds": subs, "environmentId": env,
                "periodId": "period_test_01", "propIds": ["prop_tool_01"],
                "veo_prompt": PROMPT_TXT, "status": "generated", "outdated": False}

    shots = [shot("shot_001_01", "scene_001", 1, 0.0, 4.0, ["subject_alpha_01"], "env_plains_01"),
             shot("shot_002_01", "scene_002", 1, 4.0, 6.0, ["subject_alpha_01", "subject_beta_01"], "env_river_01", "ACTION"),
             shot("shot_002_02", "scene_002", 2, 6.0, 8.0, ["subject_beta_01"], "env_river_01", "REACTION"),
             shot("shot_003_01", "scene_003", 1, 8.0, 12.0, [], None, "ESTABLISH")]
    write_json(p / "veo_prompts.json", {
        "project": name, "generator_version": CURRENT_GENERATOR_VERSION,
        "shotGeneratorVersion": CURRENT_GENERATOR_VERSION,
        "source_script_sha256": script_hash, "audio_sha256": audio_hash,
        "timestamps_sha256": compute_file_sha256(p / "timestamps.json"),
        "scene_plan_sha256": sp_hash, "sourceVisualBibleHash": vb_hash,
        "audio_duration": audio_duration, "scene_count": 3, "shot_count": 4,
        "full_timeline_coverage": 100.0, "status": "ready",
        "shots": shots, "sceneHashes": compute_scene_hashes(scenes)})
    write_json(p / "voice_qa.json", {
        "schema_version": "1.0", "status": "pass", "audio_sha256": audio_hash,
        "audio_duration": audio_duration,
        "summary": {"unresolved_fail_count": 0, "unresolved_review_count": 0,
                    "total_issues": 0}, "issues": []})
    write_json(p / "settings.json", {"project_name": name})
    return p


def make_rep(project: Path, rep_id: str = "char_alpha_caregiver_01",
             source: str = "subject_alpha_01",
             role: str = "primary caregiver") -> dict:
    """Create a representative character on a migrated fixture project."""
    from studio.visual_bible_v2 import create_entity
    return create_entity(project, "character", {
        "characterId": rep_id,
        "entityKind": "REPRESENTATIVE_CHARACTER",
        "name": "Test Caregiver",
        "role": role,
        "sourceSubjectId": source,
        "historicalStatus": "RECONSTRUCTED_REPRESENTATIVE",
        "taxonomy": {"speciesOrPopulation": "Homo habilis",
                     "period": "Test period"},
        "demographics": {"ageGroup": "adult", "sex": "female"},
        "identityAnchors": ["test anchor one"],
        "clothingRules": ["test wrap"],
    })


def bind_rep(project: Path, scene_id: str, rep_id: str) -> dict:
    """Append a representative to a scene's characterIds (explicit binding)."""
    from studio.scene_planner import scene_planner
    data = load_json(project / "scene_plan.json")
    sc = next(s for s in data["scenes"] if s["scene_id"] == scene_id)
    chars = list(sc.get("characterIds", []) or [])
    if rep_id not in chars:
        chars.append(rep_id)
    return scene_planner.update_scene(project, scene_id, {"characterIds": chars})


def reset_outdated(project: Path) -> None:
    """Clear all Veo outdated flags (simulates post-change re-render baseline)."""
    data = load_json(project / "veo_prompts.json")
    for s in data.get("shots", []):
        s["outdated"] = False
    write_json(project / "veo_prompts.json", data)
