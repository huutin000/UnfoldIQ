"""Phase 9 Task 3: one-pass detector runner tests (TDD RED first)."""
import asyncio
from pathlib import Path


def test_command_shape_single_pass():
    from studio.render_qa_detector import build_render_qa_ffmpeg_args
    argv = build_render_qa_ffmpeg_args(Path("final.mp4"))
    text = " ".join(argv)
    assert argv[0] == "ffmpeg"
    for token in ("-hide_banner", "-nostdin", "-progress", "pipe:1", "-stats_period", "0.5"):
        assert token in argv
    assert argv.count("final.mp4") == 1
    assert "blackdetect=d=0.25:pic_th=0.98:pix_th=0.10" in text
    assert "freezedetect=n=0.001:d=1" in text
    assert "silencedetect" in text and "n=-50dB" in text and "d=2" in text
    assert text.count("ffmpeg") == 1
    assert "-f" in argv and "null" in argv


def test_detector_parsers():
    from studio.render_qa_detector import parse_detector_stderr
    stderr = (
        "[blackdetect @ 0x] black_start:0 black_end:0.5 black_duration:0.5\n"
        "[silencedetect @ 0x] silence_start: 1.0\n"
        "[silencedetect @ 0x] silence_end: 4.0 | silence_duration: 3.0\n"
        "[lavfi.freezedetect.freeze_start: 2.0]\n"
        "[lavfi.freezedetect.freeze_duration: 1.5]\n"
        "[lavfi.freezedetect.freeze_end: 3.5]\n"
    )
    events = parse_detector_stderr(stderr)
    by_kind = {}
    for e in events:
        by_kind.setdefault(e.detector.value, []).append(e)
    assert abs(by_kind["BLACK"][0].duration - 0.5) < 1e-6
    assert abs(by_kind["SILENCE"][0].duration - 3.0) < 1e-6
    assert abs(by_kind["FREEZE"][0].duration - 1.5) < 1e-6


def test_progress_band_mapping():
    from studio.render_qa_detector import decode_progress_fraction
    assert decode_progress_fraction(0.0, 4.0) == 0.12
    mid = decode_progress_fraction(2.0, 4.0)
    assert 0.12 < mid < 0.88
    assert decode_progress_fraction(4.0, 4.0) == 0.88
    assert decode_progress_fraction(99.0, 4.0) <= 0.88


def test_cancellation_uses_graceful_then_force():
    from studio.render_qa_detector import CANCEL_GRACE_SECONDS
    assert CANCEL_GRACE_SECONDS == 5.0
    import inspect
    import studio.render_qa_detector as det
    src = inspect.getsource(det.run_full_decode_detectors)
    assert "run_process_with_cancel" in src


def test_fatal_decode_errors_detected_despite_zero_exit():
    from studio.render_qa_detector import count_fatal_decode_errors
    concealed = ("[h264 @ 0x] cabac decode of qscale diff failed at 84 45\n"
                 "[h264 @ 0x] error while decoding MB 84 45\n"
                 "[h264 @ 0x] concealing 2725 DC errors in P frame\n")
    assert count_fatal_decode_errors(concealed) >= 1
    clean = ("frame= 96 fps=24 q=-0.0 Lsize=N/A time=00:00:04.00\n"
             "video:40KiB audio:752KiB\n")
    assert count_fatal_decode_errors(clean) == 0


def test_eof_freeze_start_without_end_is_bounded_to_total_frames():
    from studio.render_qa_detector import parse_detector_stderr
    stderr = ("[Parsed_freezedetect_1 @ 0x] lavfi.freezedetect.freeze_start: 4.0\n")
    events = parse_detector_stderr(stderr, total_frames=144)
    assert len(events) == 1
    ev = events[0]
    assert ev.detector.value == "FREEZE"
    assert ev.start_time == 4.0
    assert abs(ev.end_time - 6.0) < 1e-6
    assert abs(ev.duration - 2.0) < 1e-6
    assert ev.raw_evidence.get("eof_truncated") is True


def test_eof_freeze_start_past_total_is_discarded():
    from studio.render_qa_detector import parse_detector_stderr
    stderr = ("[Parsed_freezedetect_1 @ 0x] lavfi.freezedetect.freeze_start: 9.0\n")
    assert parse_detector_stderr(stderr, total_frames=144) == []
