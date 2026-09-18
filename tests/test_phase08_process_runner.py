"""Phase 8 Task 7: process runner, progress parsing, cancellation."""
import asyncio
import sys

import pytest

from studio.ffmpeg_process_runner import FFmpegProgressParser


def test_progress_parser_emits_completed_blocks():
    parser = FFmpegProgressParser()
    event = None
    for line in [
        "frame=120\n",
        "fps=24.0\n",
        "out_time_ms=5000000\n",
        "progress=continue\n",
    ]:
        event = parser.feed_line(line) or event
    assert event["frame"] == 120
    assert event["progress"] == "continue"


def test_progress_parser_ignores_partial_block():
    parser = FFmpegProgressParser()
    assert parser.feed_line("frame=7\n") is None
    assert parser.feed_line("fps=24.0\n") is None


def test_progress_percent_caps_at_99():
    from studio.ffmpeg_process_runner import progress_percent
    assert progress_percent(50, 100) == 50
    assert progress_percent(100, 100) == 99
    assert progress_percent(500, 100) == 99
    assert progress_percent(0, 0) == 0


def test_graceful_cancel_of_child_process(tmp_path):
    from studio.ffmpeg_process_runner import run_process_with_cancel
    log = tmp_path / "child.log"

    async def scenario():
        child_code = (
            "import sys, time\n"
            "print('ready', flush=True)\n"
            "time.sleep(60)\n"
        )
        cancelled = asyncio.Event()

        async def waiter():
            await asyncio.sleep(1.0)
            cancelled.set()

        task = asyncio.ensure_future(waiter())
        result = await run_process_with_cancel(
            [sys.executable, "-c", child_code],
            log_path=log,
            cancel_event=cancelled,
            grace_seconds=2.0,
        )
        await task
        return result

    result = asyncio.run(scenario())
    assert result.cancelled is True
    assert result.completed is False
    assert log.exists()


def test_clean_exit_reports_completed(tmp_path):
    from studio.ffmpeg_process_runner import run_process_with_cancel
    log = tmp_path / "ok.log"

    async def scenario():
        never = asyncio.Event()
        return await run_process_with_cancel(
            [sys.executable, "-c", "print('hi')"],
            log_path=log,
            cancel_event=never,
            grace_seconds=2.0,
        )

    result = asyncio.run(scenario())
    assert result.completed is True
    assert result.cancelled is False
    assert result.return_code == 0


def test_windows_cancellation_selects_ctrl_break_event(tmp_path, monkeypatch):
    import signal
    from unittest.mock import AsyncMock, MagicMock
    from studio.ffmpeg_process_runner import run_process_with_cancel

    signals_sent = []
    kill_called = []

    mock_proc = MagicMock()
    mock_proc.stdout = AsyncMock()
    mock_proc.stdout.readline = AsyncMock(return_value=b"")
    mock_proc.stderr = AsyncMock()
    mock_proc.stderr.readline = AsyncMock(return_value=b"")
    mock_proc.wait = AsyncMock(return_value=0)

    def _send_signal(sig):
        signals_sent.append(sig)

    def _kill():
        kill_called.append(True)

    mock_proc.send_signal = _send_signal
    mock_proc.kill = _kill

    mock_create = AsyncMock(return_value=mock_proc)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", mock_create)
    monkeypatch.setattr(sys, "platform", "win32")

    cancel_ev = asyncio.Event()
    cancel_ev.set()

    log = tmp_path / "win_cancel.log"
    res = asyncio.run(run_process_with_cancel(
        ["fake_ffmpeg"], log_path=log, cancel_event=cancel_ev, grace_seconds=0.1
    ))

    assert res.cancelled is True
    assert signal.CTRL_BREAK_EVENT in signals_sent
    assert not kill_called, "Should not force kill when process exited within grace period"
