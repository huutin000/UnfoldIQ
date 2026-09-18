"""Phase 7 compiler tests: ordering, frame math, transitions, purity."""
import pytest

from studio.render_manifest import seconds_to_frame
from studio.timeline_compiler import build_render_manifest


def _shot(shot_id, scene_id, start, end, index):
    return {"shot_id": shot_id, "scene_id": scene_id, "start": start,
            "end": end, "duration": end - start, "index": index,
            "scene_shot_index": index}


def _asset(shot_id, lifecycle="LOCKED"):
    return {"asset_id": f"ASSET-{shot_id}", "shot_id": shot_id,
            "scene_id": "scene_A", "lifecycle": lifecycle,
            "checksum": "ab" * 32, "version": 2, "master": f"assets/{shot_id}.png"}


def test_shot_order_and_sequence_preserved():
    shots = [_shot("shot_a1", "scene_A", 0.0, 2.0, 1),
             _shot("shot_a2", "scene_A", 2.0, 5.0, 2),
             _shot("shot_b1", "scene_B", 5.0, 9.0, 1)]
    scenes = [{"scene_id": "scene_A", "index": 1}, {"scene_id": "scene_B", "index": 2}]
    assets = {s["shot_id"]: _asset(s["shot_id"]) for s in shots}
    m = build_render_manifest("p1", scenes, shots, assets, {}, None, None, {})
    clips = m.videoTrack.clips
    assert [c.shotId for c in clips] == ["shot_a1", "shot_a2", "shot_b1"]
    assert [c.sequenceIndex for c in clips] == [1, 2, 3]
    assert [c.sceneId for c in clips] == ["scene_A", "scene_A", "scene_B"]


def test_frame_conversion_at_24fps():
    assert seconds_to_frame(0.0) == 0
    assert seconds_to_frame(4.0) == 96
    assert seconds_to_frame(3.153) == 76  # 75.672 -> 76


def test_half_frame_rounding_rule():
    # one frame = 1/24 s; half-frame boundary rounds up (documented rule)
    assert seconds_to_frame(1 / 48) == 1
    assert seconds_to_frame(1 / 48 - 1e-9) == 0


def test_cut_adjacency():
    shots = [_shot("s1", "A", 0.0, 2.0, 1), _shot("s2", "A", 2.0, 5.0, 2)]
    scenes = [{"scene_id": "A", "index": 1}]
    assets = {s["shot_id"]: _asset(s["shot_id"]) for s in shots}
    m = build_render_manifest("p1", scenes, shots, assets, {}, None, None, {})
    c1, c2 = m.videoTrack.clips
    assert c2.startFrame == c1.endFrame
    assert c1.transition.type == "CUT"


def test_crossfade_overlap_12_frames():
    from studio.render_manifest import Transition
    shots = [_shot("s1", "A", 0.0, 4.0, 1), _shot("s2", "A", 4.0, 8.0, 2)]
    scenes = [{"scene_id": "A", "index": 1}]
    assets = {s["shot_id"]: _asset(s["shot_id"]) for s in shots}
    m = build_render_manifest("p1", scenes, shots, assets, {}, None, None,
                              {"s2": Transition(type="CROSSFADE", durationFrames=12)})
    c1, c2 = m.videoTrack.clips
    assert c2.transition.type == "CROSSFADE"
    assert c1.endFrame - c2.startFrame == 12


def test_seconds_fields_are_derived():
    shots = [_shot("s1", "A", 0.0, 4.0, 1)]
    scenes = [{"scene_id": "A", "index": 1}]
    m = build_render_manifest("p1", scenes, shots, {"s1": _asset("s1")}, {}, None, None, {})
    c = m.videoTrack.clips[0]
    assert c.durationFrames == 96
    assert c.durationSeconds == pytest.approx(4.0)
    assert c.timelineStartSeconds == pytest.approx(0.0)


def test_unresolved_asset_keeps_clip_with_empty_refs():
    shots = [_shot("s1", "A", 0.0, 2.0, 1)]
    scenes = [{"scene_id": "A", "index": 1}]
    m = build_render_manifest("p1", scenes, shots, {}, {}, None, None, {})
    c = m.videoTrack.clips[0]
    assert c.assetId == "" and c.filePath == ""


def test_scene_metadata_built():
    shots = [_shot("shot_a1", "scene_A", 0.0, 2.0, 1),
             _shot("shot_a2", "scene_A", 2.0, 5.0, 2)]
    scenes = [{"scene_id": "scene_A", "index": 1}]
    assets = {s["shot_id"]: _asset(s["shot_id"]) for s in shots}
    m = build_render_manifest("p1", scenes, shots, assets, {}, None, None, {})
    assert len(m.scenes) == 1
    assert m.scenes[0].clipIds == [c.clipId for c in m.videoTrack.clips]
