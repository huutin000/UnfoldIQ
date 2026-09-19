"""Phase 9 Task 4: manifest context + evaluator (TDD RED first)."""
from studio.render_qa_types import QaDetectorKind, RawQaEvent


def _manifest():
    return {
        "videoTrack": {"clips": [
            {"clipId": "clip_0001", "sceneId": "scene_001", "shotId": "shot_001",
             "startFrame": 0, "endFrame": 120, "mediaType": "IMAGE",
             "transition": {"type": "CUT", "durationFrames": 0}},
            {"clipId": "clip_0002", "sceneId": "scene_001", "shotId": "shot_002",
             "startFrame": 120, "endFrame": 264, "mediaType": "VIDEO",
             "transition": {"type": "CROSSFADE", "durationFrames": 12}},
        ]}
    }


def _event(detector, start, end):
    return RawQaEvent(detector=detector, start_time=start, end_time=end,
                      duration=end - start, raw_thresholds={}, raw_evidence={})


def test_manifest_index():
    from studio.render_qa_evaluator import build_manifest_qa_context
    ctx = build_manifest_qa_context(_manifest())
    assert ctx.total_frames == 264
    assert len(ctx.slices) == 2
    assert ctx.slices[0].media_type == "IMAGE"


def test_image_freeze_is_expected():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaSeverity
    ctx = build_manifest_qa_context(_manifest())
    findings = evaluate_events(
        [_event(QaDetectorKind.FREEZE, 0.0, 5.0)], ctx, RENDER_QA_POLICY_V1)
    assert findings and findings[0].severity is QaSeverity.EXPECTED


def test_video_freeze_2s_is_warning():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaSeverity
    ctx = build_manifest_qa_context(_manifest())
    findings = evaluate_events(
        [_event(QaDetectorKind.FREEZE, 6.0, 8.0)], ctx, RENDER_QA_POLICY_V1)
    assert findings[0].severity is QaSeverity.WARNING
    assert findings[0].code == "QA_VIDEO_FREEZE_EXCESSIVE"


def test_video_freeze_3s_is_hard_fail():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaSeverity
    ctx = build_manifest_qa_context(_manifest())
    findings = evaluate_events(
        [_event(QaDetectorKind.FREEZE, 6.0, 9.0)], ctx, RENDER_QA_POLICY_V1)
    assert findings[0].severity is QaSeverity.HARD_FAIL


def test_cross_boundary_split():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaSeverity
    ctx = build_manifest_qa_context(_manifest())
    findings = evaluate_events(
        [_event(QaDetectorKind.FREEZE, 4.0, 9.0)], ctx, RENDER_QA_POLICY_V1)
    sev = {f.shot_id: f.severity for f in findings}
    assert sev["shot_001"] is QaSeverity.EXPECTED
    assert sev["shot_002"] in (QaSeverity.WARNING, QaSeverity.HARD_FAIL)


def test_black_context_labels():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaSeverity
    ctx = build_manifest_qa_context(_manifest())
    findings = evaluate_events(
        [_event(QaDetectorKind.BLACK, 0.1, 0.6)], ctx, RENDER_QA_POLICY_V1)
    assert findings[0].severity is QaSeverity.WARNING
    assert findings[0].context in ("BLACK_NEAR_SHOT_BOUNDARY",
                                   "BLACK_NEAR_TRANSITION", "BLACK_INSIDE_SHOT")


def test_silence_policy():
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    from studio.render_qa_types import QaSeverity
    ctx = build_manifest_qa_context(_manifest())
    f3 = evaluate_events([_event(QaDetectorKind.SILENCE, 0.0, 3.0)], ctx, RENDER_QA_POLICY_V1)
    f6 = evaluate_events([_event(QaDetectorKind.SILENCE, 0.0, 6.0)], ctx, RENDER_QA_POLICY_V1)
    f9 = evaluate_events([_event(QaDetectorKind.SILENCE, 0.0, 9.0)], ctx, RENDER_QA_POLICY_V1)
    assert f3[0].severity is QaSeverity.OBSERVED
    assert f6[0].severity is QaSeverity.WARNING
    assert f9[0].severity is QaSeverity.HARD_FAIL
    assert f9[0].code == "QA_AUDIO_SILENCE_EXCESSIVE"


def test_evaluator_scale_500_shots_under_2_seconds():
    import time
    from studio.render_qa_evaluator import build_manifest_qa_context, evaluate_events
    from studio.render_qa_policy import RENDER_QA_POLICY_V1
    clips = []
    for i in range(500):
        clips.append({"clipId": f"clip_{i:04d}", "sceneId": f"scene_{i // 10:03d}",
                      "shotId": f"shot_{i:04d}", "startFrame": i * 24,
                      "endFrame": (i + 1) * 24,
                      "mediaType": "VIDEO" if i % 2 else "IMAGE",
                      "transition": {"type": "CUT", "durationFrames": 0}})
    ctx = build_manifest_qa_context({"videoTrack": {"clips": clips}})
    events = [_event(QaDetectorKind.FREEZE, 10.0, 14.0),
              _event(QaDetectorKind.BLACK, 20.0, 20.6),
              _event(QaDetectorKind.SILENCE, 30.0, 36.0)]
    t0 = time.perf_counter()
    findings = evaluate_events(events, ctx, RENDER_QA_POLICY_V1)
    dt = time.perf_counter() - t0
    assert findings
    assert dt < 2.0
