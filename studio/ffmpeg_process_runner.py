"""Phase 8 FFmpeg background runner: argv-only launch, progress drain,
bounded diagnostics, graceful-then-forced cancellation.

FFmpeg invocation prefix (pinned): ffmpeg -hide_banner -nostdin
-progress pipe:1 -stats_period 0.5. Callers append inputs/filters/outputs.
"""
import asyncio
import collections
import signal
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

FFMPEG_PREFIX = ("ffmpeg", "-hide_banner", "-nostdin",
                 "-progress", "pipe:1", "-stats_period", "0.5")

_TAIL_LINES = 200


class FFmpegProgressParser:
    """Accumulate `-progress` key=value lines; emit on progress= boundary."""

    def __init__(self):
        self._block: dict[str, Any] = {}

    def feed_line(self, line: str) -> dict[str, Any] | None:
        text = line.strip()
        if not text or "=" not in text:
            return None
        key, _, value = text.partition("=")
        key, value = key.strip(), value.strip()
        if key == "frame":
            try:
                value = int(float(value))
            except ValueError:
                pass
        self._block[key] = value
        if key == "progress":
            event = dict(self._block)
            self._block = {}
            return event
        return None


def progress_percent(frame: int, expected_final_frames: int) -> int:
    if not expected_final_frames or expected_final_frames <= 0:
        return 0
    try:
        return min(99, int(int(frame) * 100 / expected_final_frames))
    except (TypeError, ValueError):
        return 0


@dataclass
class ProcessRunResult:
    completed: bool
    cancelled: bool
    return_code: int | None
    stderr_tail: str
    max_frame_seen: int = 0


async def _read_progress(stream, parser, callback, expected_frames, state):
    while True:
        raw = await stream.readline()
        if not raw:
            break
        event = parser.feed_line(raw.decode("utf-8", errors="replace"))
        if event is None:
            continue
        frame = event.get("frame", 0)
        try:
            frame = int(frame)
        except (TypeError, ValueError):
            frame = 0
        state["max_frame"] = max(state.get("max_frame", 0), frame)
        if expected_frames:
            event["percent"] = progress_percent(frame, expected_frames)
        if callback is not None:
            res = callback(event)
            if isinstance(res, Awaitable):
                await res


async def _read_stderr(stream, log_file, tail_buffer):
    while True:
        raw = await stream.readline()
        if not raw:
            break
        text = raw.decode("utf-8", errors="replace")
        log_file.write(text)
        log_file.flush()
        tail_buffer.append(text.rstrip("\r\n"))


async def run_process_with_cancel(argv: list[str], log_path: Path,
                                  cancel_event: asyncio.Event,
                                  grace_seconds: float = 5.0,
                                  progress_callback=None,
                                  expected_frames: int = 0,
                                  cwd: Path | str | None = None) -> ProcessRunResult:
    """Run argv; on cancel_event: graceful signal, grace wait, force kill."""
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
    process = await asyncio.create_subprocess_exec(
        *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        stdin=asyncio.subprocess.DEVNULL, creationflags=creationflags,
        cwd=str(cwd) if cwd else None)
    parser = FFmpegProgressParser()
    tail: collections.deque[str] = collections.deque(maxlen=_TAIL_LINES)
    state: dict[str, Any] = {}
    cancelled = False
    try:
        with open(log_path, "w", encoding="utf-8", errors="replace") as log_file:
            readers = [
                asyncio.ensure_future(
                    _read_progress(process.stdout, parser, progress_callback,
                                   expected_frames, state)),
                asyncio.ensure_future(
                    _read_stderr(process.stderr, log_file, tail)),
            ]
            while True:
                if cancel_event.is_set():
                    cancelled = True
                    try:
                        if sys.platform == "win32":
                            process.send_signal(signal.CTRL_BREAK_EVENT)
                        else:
                            process.terminate()
                    except ProcessLookupError:
                        pass
                    try:
                        await asyncio.wait_for(process.wait(), timeout=grace_seconds)
                    except asyncio.TimeoutError:
                        try:
                            process.kill()
                        except ProcessLookupError:
                            pass
                        await process.wait()
                    break
                try:
                    await asyncio.wait_for(process.wait(), timeout=0.1)
                    break
                except asyncio.TimeoutError:
                    continue
            await asyncio.gather(*readers)
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()
    rc = process.returncode
    completed = (not cancelled) and rc == 0
    return ProcessRunResult(completed=completed, cancelled=cancelled,
                            return_code=rc, stderr_tail="\n".join(tail),
                            max_frame_seen=state.get("max_frame", 0))
