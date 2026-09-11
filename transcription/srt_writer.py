"""
SRT generator, validator, and atomic writer for UnfoldIQ TTS Studio.
Pure Python standard library implementation adhering to the Ponytail principle.
"""

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def format_timestamp(seconds: float) -> str:
    """
    Formats a duration in seconds into standard SubRip timestamp syntax:
    HH:MM:SS,mmm
    """
    if seconds is None or seconds < 0:
        seconds = 0.0
    
    total_ms = int(round(seconds * 1000))
    hrs = total_ms // 3600000
    total_ms %= 3600000
    mins = total_ms // 60000
    total_ms %= 60000
    secs = total_ms // 1000
    millis = total_ms % 1000

    return f"{hrs:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def parse_timestamp(ts_str: str) -> float:
    """
    Parses 'HH:MM:SS,mmm' back into seconds.
    """
    match = re.match(r"^(\d{2}):(\d{2}):(\d{2}),(\d{3})$", ts_str.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp format: '{ts_str}'")
    hrs, mins, secs, ms = match.groups()
    return int(hrs) * 3600 + int(mins) * 60 + int(secs) + int(ms) / 1000.0


def generate_srt_content(segments: List[Dict[str, Any]]) -> str:
    """
    Generates standard valid SRT content from aligned canonical segments.
    Preserves exact source script text.
    """
    cues = []
    for idx, seg in enumerate(segments, start=1):
        start_str = format_timestamp(seg.get("start", 0.0))
        end_str = format_timestamp(seg.get("end", 0.0))
        text = str(seg.get("text", "")).strip()
        cues.append(f"{idx}\n{start_str} --> {end_str}\n{text}\n")

    return "\n".join(cues) + ("\n" if cues else "")


def validate_srt(
    srt_content: str,
    expected_sentence_count: Optional[int] = None,
    max_duration: Optional[float] = None,
    tolerance_seconds: float = 1.0
) -> Tuple[bool, List[str]]:
    """
    Strictly validates SRT format:
    1. Sequential 1-indexed cue numbers
    2. Valid 'HH:MM:SS,mmm --> HH:MM:SS,mmm' format
    3. start < end for each cue
    4. Monotonic start times (start >= prev_start)
    5. No timestamps materially exceeding max_duration + tolerance
    6. Non-empty cue text
    7. Matching expected sentence count if provided
    """
    errors: List[str] = []
    if not srt_content or not srt_content.strip():
        return False, ["SRT content is empty."]

    # Split into cue blocks separated by blank lines
    blocks = [b.strip() for b in re.split(r"\n\s*\n", srt_content.strip()) if b.strip()]

    if expected_sentence_count is not None and len(blocks) != expected_sentence_count:
        errors.append(f"Cue count mismatch: expected {expected_sentence_count}, got {len(blocks)}.")

    prev_start = 0.0
    time_pattern = re.compile(r"^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})$")

    for i, block in enumerate(blocks, start=1):
        lines = [line.rstrip("\r\n") for line in block.splitlines() if line.strip()]
        if len(lines) < 3:
            errors.append(f"Cue {i}: Malformed block with fewer than 3 lines: {repr(block)}")
            continue

        # Check sequence number
        seq_str = lines[0].strip()
        if not seq_str.isdigit() or int(seq_str) != i:
            errors.append(f"Cue {i}: Expected sequence index {i}, found '{seq_str}'.")

        # Check timing line
        time_line = lines[1].strip()
        m = time_pattern.match(time_line)
        if not m:
            errors.append(f"Cue {i}: Malformed timing line: '{time_line}'.")
            continue

        start_str, end_str = m.group(1), m.group(2)
        try:
            start_sec = parse_timestamp(start_str)
            end_sec = parse_timestamp(end_str)
        except ValueError as ve:
            errors.append(f"Cue {i}: Timestamp parse error: {ve}")
            continue

        if start_sec >= end_sec:
            errors.append(f"Cue {i}: Start ({start_sec:.3f}s) is not strictly before end ({end_sec:.3f}s).")

        if start_sec < prev_start - 0.001:
            errors.append(f"Cue {i}: Monotonicity violation: start ({start_sec:.3f}s) < previous cue start ({prev_start:.3f}s).")
        prev_start = start_sec

        if max_duration is not None and end_sec > max_duration + tolerance_seconds:
            errors.append(f"Cue {i}: End time ({end_sec:.3f}s) exceeds max audio duration ({max_duration:.3f}s + {tolerance_seconds}s tol).")

        # Check text
        text = "\n".join(lines[2:]).strip()
        if not text:
            errors.append(f"Cue {i}: Empty cue text.")

    is_valid = len(errors) == 0
    return is_valid, errors


def write_timestamps_safely(
    project_dir: Path,
    timestamps_data: Dict[str, Any],
    srt_content: str,
    expected_sentence_count: Optional[int] = None,
    max_duration: Optional[float] = None
) -> Tuple[Path, Path]:
    """
    Safely writes timestamps.json and timestamps.srt atomically using temporary files.
    Validates SRT before replacing canonical targets to prevent corrupt artifacts.
    """
    project_dir = Path(project_dir)
    json_path = project_dir / "timestamps.json"
    srt_path = project_dir / "timestamps.srt"

    # Validate SRT first
    valid, errors = validate_srt(srt_content, expected_sentence_count, max_duration)
    if not valid:
        raise ValueError(f"SRT validation failed before saving: {'; '.join(errors)}")

    tmp_json = None
    tmp_srt = None
    try:
        # 1. Write timestamps.json.tmp
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=str(project_dir),
            delete=False,
            encoding="utf-8",
            prefix="ts_tmp_",
            suffix=".json"
        ) as f_json:
            tmp_json = Path(f_json.name)
            json.dump(timestamps_data, f_json, indent=2, ensure_ascii=False)

        # 2. Write timestamps.srt.tmp
        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=str(project_dir),
            delete=False,
            encoding="utf-8",
            prefix="srt_tmp_",
            suffix=".srt"
        ) as f_srt:
            tmp_srt = Path(f_srt.name)
            f_srt.write(srt_content)

        # 3. Atomic replace
        tmp_json.replace(json_path)
        tmp_srt.replace(srt_path)

        return json_path, srt_path

    except Exception:
        # Clean up temp files if anything failed
        if tmp_json and tmp_json.exists():
            try:
                tmp_json.unlink()
            except Exception:
                pass
        if tmp_srt and tmp_srt.exists():
            try:
                tmp_srt.unlink()
            except Exception:
                pass
        raise
