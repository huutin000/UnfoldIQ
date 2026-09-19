"""Phase 9 QA types/policy contract tests (TDD RED first)."""
from studio.render_qa_types import (
    QaVerdict,
    QaSeverity,
    QaDetectorKind,
    RenderQaExecutionPhase,
    QaIdentity,
)
from studio.render_qa_policy import RENDER_QA_POLICY_V1


def test_phase09_public_enums_are_locked():
    assert [x.value for x in QaVerdict] == ["PASS", "PASS_WITH_WARNINGS", "FAIL"]
    assert [x.value for x in QaSeverity] == ["EXPECTED", "OBSERVED", "WARNING", "HARD_FAIL"]
    assert [x.value for x in QaDetectorKind] == ["BLACK", "FREEZE", "SILENCE"]
    assert RenderQaExecutionPhase.REPORT_COMMITTED.value == "REPORT_COMMITTED"


def test_policy_v1_thresholds_are_exact():
    p = RENDER_QA_POLICY_V1
    assert p.version == "RENDER_QA_POLICY_V1"
    assert p.black.detect_min_seconds == 0.25
    assert p.black.hard_fail_seconds == 2.0
    assert p.freeze.detect_min_seconds == 1.0
    assert p.freeze.video_hard_fail_seconds == 3.0
    assert p.silence.detect_min_seconds == 2.0
    assert p.silence.warning_seconds == 5.0
    assert p.silence.hard_fail_seconds == 8.0


def test_seconds_to_frames_uses_half_open_floor_ceil():
    from studio.render_qa_policy import seconds_to_frame_range
    assert seconds_to_frame_range(1.0, 2.0) == (24, 48)
    assert seconds_to_frame_range(1.001, 1.999) == (24, 48)


def test_verdict_reducer():
    from studio.render_qa_policy import reduce_qa_verdict
    from studio.render_qa_types import QaFinding, QaSeverity, QaVerdict
    assert reduce_qa_verdict([]) is QaVerdict.PASS
    assert reduce_qa_verdict([
        QaFinding(code="W", severity=QaSeverity.WARNING)
    ]) is QaVerdict.PASS_WITH_WARNINGS
    assert reduce_qa_verdict([
        QaFinding(code="H", severity=QaSeverity.HARD_FAIL)
    ]) is QaVerdict.FAIL


def test_black_boundaries():
    from studio.render_qa_policy import black_severity
    from studio.render_qa_types import QaSeverity
    assert black_severity(1.99) is QaSeverity.WARNING
    assert black_severity(2.0) is QaSeverity.HARD_FAIL


def test_video_freeze_boundaries():
    from studio.render_qa_policy import video_freeze_severity
    from studio.render_qa_types import QaSeverity
    assert video_freeze_severity(2.99) is QaSeverity.WARNING
    assert video_freeze_severity(3.0) is QaSeverity.HARD_FAIL


def test_silence_boundaries():
    from studio.render_qa_policy import silence_severity
    from studio.render_qa_types import QaSeverity
    assert silence_severity(4.99) is QaSeverity.OBSERVED
    assert silence_severity(5.0) is QaSeverity.WARNING
    assert silence_severity(7.99) is QaSeverity.WARNING
    assert silence_severity(8.0) is QaSeverity.HARD_FAIL
