"""
Hermetic Project Factory for UnfoldIQ Test Suites
Provides isolated, deterministic synthetic project fixtures without requiring
a permanent on-disk demo project in production workspace.
"""
from __future__ import annotations

import contextlib
import json
import shutil
import struct
import wave
import zlib
from pathlib import Path
from typing import Generator, List, Dict, Any

from studio.config import PROJECTS_DIR


def make_1x1_png() -> bytes:
    """Minimal valid 1x1 PNG bytes (pure stdlib)."""
    def chunk(ctype: bytes, data: bytes) -> bytes:
        c = ctype + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def make_noise_png(w: int = 96, h: int = 96, seed: int = 0) -> bytes:
    """Deterministic RGB-noise PNG (pure stdlib) as a realistic stand-in for
    per-shot production stills. Deliberately incompressible so the portable
    package zip carries real media weight (>1MB for 141 shots)."""
    import random
    def chunk(ctype: bytes, data: bytes) -> bytes:
        c = ctype + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    rng = random.Random(seed)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    rows = b"".join(
        b"\x00" + bytes(rng.randrange(256) for _ in range(w * 3))
        for _ in range(h)
    )
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(rows, 1)) + chunk(b"IEND", b""))


def create_canonical_scale_project(target_dir: Path, name: str = "2026-09-12_210003_youtube-narration-01") -> Path:
    """
    Creates a full 79-scene, 141-shot deterministic fixture matching the canonical
    scale expectations of Phase 1-7 tests.
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    assets_dir = target_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    n_scenes = 79
    n_shots = 141
    n_beats = 138
    n_chunks = 135

    # 1. Story beats & Script
    beats: List[Dict[str, Any]] = []
    sentences: List[str] = []
    for i in range(1, n_beats + 1):
        text = f"Humans evolved and thrived across generations in chapter {i} with innovative stone tools."
        sentences.append(text)
        beats.append({
            "beat_id": f"beat_{i:03d}",
            "index": i,
            "title": f"Phân đoạn {i}",
            "text": text,
            "style": "cinematic",
            "confidence": 0.95,
            "estimated_duration_sec": 5.0
        })

    script_text = " ".join(sentences)
    (target_dir / "script.txt").write_text(script_text, encoding="utf-8")
    (target_dir / "script.json").write_text(json.dumps({"text": script_text, "version": "1.0"}, ensure_ascii=False, indent=2), encoding="utf-8")
    (target_dir / "story_beats.json").write_text(json.dumps({"schema_version": "2.0.0", "beats": beats}, ensure_ascii=False, indent=2), encoding="utf-8")

    # 2. Settings
    settings = {
        "name": name,
        "schemaVersion": "15.0",
        "voice": "vn_female_1",
        "speed": 1.0,
        "duration_seconds": 690.0,
        "total_duration": 690.0,
        "resolution": "1080p",
        "fps": 24
    }
    (target_dir / "settings.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")

    # 3. Scenes (79 scenes)
    scenes: List[Dict[str, Any]] = []
    shots: List[Dict[str, Any]] = []
    img_scenes: List[Dict[str, Any]] = []
    vp_entries: List[Dict[str, Any]] = []
    intake_assets: List[Dict[str, Any]] = []
    png_bytes = make_1x1_png()
    # Pool of 8 distinct deterministic stills cycled across the 141 shots.
    still_pool = [make_noise_png(96, 96, seed) for seed in range(8)]

    # Map 141 shots across 79 scenes deterministically
    # scenes 1..62 get 2 shots (124 shots), scenes 63..79 get 1 shot (17 shots) -> 141 shots total!
    shot_counter = 0
    cur_time = 0.0

    for sc_idx in range(1, n_scenes + 1):
        sc_id = f"scene_{sc_idx:03d}"
        num_shots_here = 2 if sc_idx <= 62 else 1
        sc_start = cur_time
        sc_shots: List[Dict[str, Any]] = []

        for sh_sub_idx in range(1, num_shots_here + 1):
            shot_counter += 1
            sh_id = f"shot_{shot_counter:03d}"
            duration = 4.89 if shot_counter <= 140 else 5.4
            sh_start = cur_time
            sh_end = cur_time + duration
            cur_time = sh_end

            cg_id = f"group_{(sc_idx - 1) // 5 + 1:02d}"
            # Precision-matrix bindings (Group 8 / visual_continuity): predator
            # subject on shots 1..43, hearth environment on shots 100..112.
            # habilis stays first so handoff character_references[0] is stable.
            subj = ["subject_homo_habilis_01"]
            if shot_counter <= 43:
                subj.append("subject_pleistocene_predator_01")
            env = ("env_olduvai_gorge_hearth_site_01"
                   if 100 <= shot_counter <= 112
                   else "env_olduvai_gorge_grassland_01")
            shot_obj = {
                "shot_id": sh_id,
                "scene_id": sc_id,
                "parent_scene_id": sc_id,
                "index": sh_sub_idx,
                "start": sh_start,
                "end": sh_end,
                "duration": duration,
                "shot_type": "wide" if sh_sub_idx == 1 else "medium",
                "camera_motion": "slow push-in",
                "subject_action": f"Hominid elder shapes flint tools in scene {sc_idx} shot {sh_sub_idx}",
                "environmental_action": f"Grass sways across savannah in scene {sc_idx} shot {sh_sub_idx}",
                "environment_motion": f"Grass sways across savannah in scene {sc_idx} shot {sh_sub_idx}",
                "lighting_atmosphere": "Warm golden-hour sunlight with soft haze",
                "continuity_anchor": f"Flint scraper prop persists across group {cg_id}",
                "aspect_ratio": "16:9",
                "image_prompt": f"Cinematic photorealistic view of scene {sc_idx} shot {sh_sub_idx}",
                "veo_prompt": f"Cinematic camera tracking hominid in ancient landscape scene {sc_idx} shot {sh_sub_idx}",
                "negative_prompt": "no spoken dialogue, no voiceover, no captions, no subtitles, no text, no watermark, blurry, low quality",
                "visual_objective": f"Establish hominid toolmaking activity in scene {sc_idx} shot {sh_sub_idx}",
                "shot_purpose": "CONTINUATION",
                "shotPurpose": "CONTINUATION",
                "continuity_group": cg_id,
                "continuityGroupId": cg_id,
                "subjectIds": subj,
                "subject_ids": list(subj),
                "environmentId": env,
                "environment_id": env,
                "constraints": ["historical accuracy"],
                "status": "ready"
            }
            shots.append(shot_obj)
            sc_shots.append(shot_obj)

            # Asset file & ledger entry
            asset_filename = f"{sh_id}.png"
            (assets_dir / asset_filename).write_bytes(still_pool[shot_counter % 8])
            intake_assets.append({
                "id": f"ASSET-{sh_id}",
                "scene_id": sc_id,
                "shot_id": sh_id,
                "lifecycle": "APPROVED",
                "provider": "LOCAL_VALIDATION",
                "provenance": "VALIDATION_FIXTURE",
                "filePath": f"assets/{asset_filename}",
                "checksum": f"dummy_sha256_{sh_id}",
                "version": 1
            })

        sc_end = cur_time
        # Timestamp segment coverage: 135 segments across 79 scenes, each
        # assigned exactly once (scenes 1..56 get 2 each = 112, scenes
        # 57..79 get 1 each = 23; total 135). Required by
        # scene_planner.validate_scene_plan for PUT /scenes updates.
        if sc_idx <= 56:
            seg_ids = [2 * sc_idx - 1, 2 * sc_idx]
        else:
            seg_ids = [112 + (sc_idx - 56)]
        scenes.append({
            "scene_id": sc_id,
            "index": sc_idx,
            "start": sc_start,
            "end": sc_end,
            "duration": sc_end - sc_start,
            "timestamp_segment_ids": seg_ids,
            "speech_start": sc_start,
            "speech_end": sc_end,
            "category": "reconstruction",
            "evidence_mode": "reconstruction",
            "shot_type": "wide",
            "camera_motion": "slow push-in",
            "continuity_group": f"group_{(sc_idx - 1) // 5 + 1:02d}",
            "visual_summary": f"Historical depiction of evolution phase {sc_idx}",
            "narration": f"Narration for scene {sc_idx}.",
            "image_prompt": f"Cinematic master prompt for scene {sc_idx}",
            "negative_prompt": "blurry, artifacts",
            "status": "ready"
        })

        img_scenes.append({
            "scene_id": sc_id,
            "image_prompt": f"Master image prompt for scene {sc_idx}"
        })
        vp_entries.append({
            "sceneId": sc_id,
            "prompt": f"Visual prompt for scene {sc_idx}"
        })

    (target_dir / "scene_plan.json").write_text(json.dumps({"schema_version": "2.0.0", "scenes": scenes, "project": name}, indent=2, ensure_ascii=False), encoding="utf-8")
    (target_dir / "veo_prompts.json").write_text(json.dumps({"schema_version": "2.0.0", "shots": shots, "total_shots": len(shots)}, indent=2, ensure_ascii=False), encoding="utf-8")
    (target_dir / "image_prompts.json").write_text(json.dumps({"version": "1.0", "scenes": img_scenes}, indent=2, ensure_ascii=False), encoding="utf-8")
    (target_dir / "visual_prompts.json").write_text(json.dumps({"version": "1.0", "entries": vp_entries}, indent=2, ensure_ascii=False), encoding="utf-8")
    (target_dir / "assets" / "intake_ledger.json").write_text(json.dumps({"schema_version": "1.0.0", "assets": intake_assets}, indent=2, ensure_ascii=False), encoding="utf-8")

    # 4. Audio & Timestamps
    chunks: List[Dict[str, Any]] = []
    ts_segments: List[Dict[str, Any]] = []
    srt_lines: List[str] = []
    raw_segments: List[Dict[str, Any]] = []
    audio_dur = 690.0

    w_idx = 0
    words_vocab = ["Humans", "evolved", "and", "thrived", "across", "ancient", "landscapes", "with", "flint", "tools"]

    for i in range(1, n_chunks + 1):
        c_id = f"c_{i:02d}"
        c_start = (i - 1) * 5.0
        c_end = i * 5.0
        chunks.append({
            "chunk_id": c_id,
            "id": c_id,
            "index": i,
            "text": beats[i - 1]["text"],
            "synthesis_text": beats[i - 1]["text"],
            "voice": "vn_female_1",
            "speed": 1.0,
            "duration": 5.0,
            "is_locked": False,
            "render_hash": f"hash_{c_id}",
            "output_file": f"audio_{c_id}.mp3"
        })
        ts_segments.append({
            "index": i,
            "text": beats[i - 1]["text"],
            "start": c_start,
            "end": c_end
        })
        # Raw transcription words (10 words per segment = 1350 words total)
        s_words = []
        for w_sub in words_vocab:
            w_idx += 1
            s_words.append({
                "word": w_sub,
                "start": round(w_idx * 0.5, 2),
                "end": round(w_idx * 0.5 + 0.4, 2),
                "probability": 0.98
            })
        raw_segments.append({
            "id": i,
            "start": c_start,
            "end": c_end,
            "text": beats[i - 1]["text"],
            "words": s_words
        })

        # SRT block
        m_s, s_s = divmod(int(c_start), 60)
        h_s, m_s = divmod(m_s, 60)
        m_e, s_e = divmod(int(c_end), 60)
        h_e, m_e = divmod(m_e, 60)
        srt_lines.append(f"{i}\n{h_s:02d}:{m_s:02d}:{s_s:02d},000 --> {h_e:02d}:{m_e:02d}:{s_e:02d},000\n{beats[i-1]['text']}\n")

    (target_dir / "manifest.json").write_text(json.dumps({"chunks": chunks}, indent=2, ensure_ascii=False), encoding="utf-8")
    (target_dir / "timeline.json").write_text(json.dumps({"scenes": scenes}, indent=2, ensure_ascii=False), encoding="utf-8")
    (target_dir / "timestamps.srt").write_text("\n".join(srt_lines), encoding="utf-8")
    (target_dir / "transcription_raw.json").write_text(json.dumps({
        "audio_duration": audio_dur,
        "segments": raw_segments
    }, indent=2), encoding="utf-8")

    # Voice QA report
    (target_dir / "voice_qa.json").write_text(json.dumps({
        "status": "pass",
        "audio_duration": audio_dur,
        "metrics": {"wer": 0.015, "wpm": 142.0},
        "summary": {
            "overall_verdict": "PASS",
            "unresolved_fail_count": 0,
            "unresolved_review_count": 0
        },
        "issues": []
    }, indent=2), encoding="utf-8")

    # Generate minimal valid WAV file (24kHz mono 16-bit narration master spec)
    wav_path = target_dir / "audio.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00" * 4800)  # 100ms silence

    import hashlib
    audio_sha = hashlib.sha256(wav_path.read_bytes()).hexdigest()
    (target_dir / "timestamps.json").write_text(json.dumps({
        "version": 1,
        "audio_file": "audio.wav",
        "audio_sha256": audio_sha,
        "audio_duration": audio_dur,
        "segments": ts_segments,
        "words": [
            {"word": "Humans", "start": 0.0, "end": 0.5, "score": 0.99},
            {"word": "evolved", "start": 0.5, "end": 1.0, "score": 0.98}
        ]
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    # 5. Visual Bible
    visual_bible = {
        "schema_version": "2.0.0",
        "project": name,
        "characters": [
            {
                "characterId": "char_homo_habilis_01",
                "subjectId": "subject_homo_habilis_01",
                "id": "subject_homo_habilis_01",
                "name": "Homo Habilis Elder",
                "description": "Elder hominid toolmaker with weathered skin and determined gaze.",
                "visual_traits": ["early human features", "flint scraper in hand", "coarse hair"]
            }
        ],
        "objects": [
            {
                "objectId": "obj_flint_scraper_01",
                "id": "obj_flint_scraper_01",
                "name": "Flint Scraper",
                "description": "Chipped stone tool used by Homo Habilis."
            }
        ],
        "subjects": [
            {
                "subjectId": "subject_homo_habilis_01",
                "characterId": "char_homo_habilis_01",
                "id": "subject_homo_habilis_01",
                "name": "Homo Habilis Elder",
                "description": "Elder hominid toolmaker."
            },
            {
                "subjectId": "subject_pleistocene_predator_01",
                "id": "subject_pleistocene_predator_01",
                "name": "Pleistocene Predator",
                "description": "Large carnivore stalking the savannah."
            }
        ],
        "environments": [
            {
                "environmentId": "env_olduvai_gorge_grassland_01",
                "id": "env_olduvai_gorge_grassland_01",
                "name": "East African Savannah",
                "locationName": "East African Savannah",
                "description": "Sun-drenched grassland with scattered acacia trees and rocky outcrops.",
                "visual_traits": ["golden grass", "acacia trees", "distant volcanic mountains"]
            },
            {
                "environmentId": "env_olduvai_gorge_hearth_site_01",
                "id": "env_olduvai_gorge_hearth_site_01",
                "name": "Hearth Site",
                "locationName": "Hearth Site",
                "description": "Sheltered hearth area with stone circle and ash.",
                "visual_traits": ["stone circle", "ash bed", "charred wood"]
            }
        ],
        "periods": [
            {
                "periodId": "period_paleolithic_01",
                "id": "period_paleolithic_01",
                "name": "Paleolithic Era",
                "description": "Early Stone Age savannah habitat."
            },
            {
                "periodId": "period_early_pleistocene",
                "id": "period_early_pleistocene",
                "name": "Early Pleistocene",
                "description": "Global period constraint covering all scenes."
            }
        ],
        "continuityGroups": [
            {
                "continuityGroupId": f"group_{g:02d}",
                "environmentId": "env_olduvai_gorge_grassland_01",
                "subjectIds": ["subject_homo_habilis_01"]
            }
            for g in range(1, 17)
        ],
        "referenceAssets": [
            {
                "assetId": "REF-CHAR-HH-FRONT",
                "entityId": "subject_homo_habilis_01",
                "view": "FRONT",
                "path": "assets/references/characters/char_hh_primary_caregiver_01/front.png",
                "status": "APPROVED"
            }
        ],
        "generatorVersion": "10.0.0",
        # Deliberately stale: reference hermetic project must report BLOCKED
        # visualContinuity until make_ready_copy() heals it with the real hash.
        "sourceScenePlanHash": "stale_fixture_hash_needs_heal",
        "style_preset": {
            "id": "style_doc_cinema",
            "name": "Documentary Cinematic 16:9",
            "aspect_ratio": "16:9",
            "cinematography": "photorealistic nature documentary 35mm film grain"
        },
        "visualBibleHash": "pending_compute",
    }
    # Real semantic hash (notes/manualEdited/timestamps stripped by the
    # hasher), so notes-only update_entity() preserves it (P0-07 contract).
    from studio.visual_continuity import compute_visual_bible_hash
    visual_bible["visualBibleHash"] = compute_visual_bible_hash(visual_bible)
    (target_dir / "visual_bible.json").write_text(json.dumps(visual_bible, indent=2, ensure_ascii=False), encoding="utf-8")

    # 6. Export-readiness hash chain (Group 6): veo status must be Ready so the
    # reference project is BLOCKED only via visualContinuity (stale hash above)
    # and make_ready_copy() heals it to fully READY. Hashes are computed AFTER
    # all files are final. sourceVisualBibleHash is deliberately omitted so the
    # heal (which rewrites visual_bible.json) does not stale veo.
    from studio.scene_planner import compute_file_sha256
    from studio.veo_prompt_generator import compute_scene_hashes, CURRENT_GENERATOR_VERSION
    veo_path = target_dir / "veo_prompts.json"
    veo_data = json.loads(veo_path.read_text(encoding="utf-8"))
    veo_data["source_script_sha256"] = compute_file_sha256(target_dir / "script.txt")
    veo_data["audio_sha256"] = compute_file_sha256(target_dir / "audio.wav")
    veo_data["timestamps_sha256"] = compute_file_sha256(target_dir / "timestamps.json")
    veo_data["scene_plan_sha256"] = compute_file_sha256(target_dir / "scene_plan.json")
    veo_data["shotGeneratorVersion"] = CURRENT_GENERATOR_VERSION
    veo_data["sceneHashes"] = compute_scene_hashes(scenes)
    veo_data["audio_duration"] = audio_dur
    veo_path.write_text(json.dumps(veo_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # 7. Render outputs (Group 6): draft + final previews so readiness reports
    # hasDraft/hasFinal and media routes serve video/mp4 (>1000 bytes).
    for kind, fname in (("draft", "draft_preview.mp4"), ("final", "final.mp4")):
        slot_dir = target_dir / "renders" / kind
        slot_dir.mkdir(parents=True, exist_ok=True)
        blob = (b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
                + bytes(2048 - 28))
        (slot_dir / fname).write_bytes(blob)

    # 8. Visual Bible reference asset (Group 7): canonical FRONT reference PNG
    # so portable-package manifest carries 1 canonicalReference VB ref.
    ref_dir = (target_dir / "assets" / "references" / "characters"
               / "char_hh_primary_caregiver_01")
    ref_dir.mkdir(parents=True, exist_ok=True)
    (ref_dir / "front.png").write_bytes(png_bytes)

    return target_dir


@contextlib.contextmanager
def hermetic_canonical_project_in_projects_dir(name: str = "2026-09-12_210003_youtube-narration-01") -> Generator[Path, None, None]:
    """
    Context manager that temporarily provisions the canonical demo project inside
    `projects/` for tests that hit live FastAPI routes, and guarantees complete
    cleanup upon exit, returning `projects/` to pristine blank state (.gitkeep only).
    """
    proj_dir = PROJECTS_DIR / name
    had_existed = proj_dir.exists()
    try:
        create_canonical_scale_project(proj_dir, name=name)
        yield proj_dir
    finally:
        if not had_existed and proj_dir.exists():
            shutil.rmtree(proj_dir, ignore_errors=True)
        # Guarantee .gitkeep remains
        PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        gitkeep = PROJECTS_DIR / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.touch()
