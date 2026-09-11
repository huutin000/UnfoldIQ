"""
Standalone transcription worker for UnfoldIQ TTS Studio.
Runs in isolated transcription/.venv using faster-whisper and CTranslate2.
Emits JSON-lines progress events on stdout for Studio integration.
"""

import argparse
import hashlib
import json
import os
import sys
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure CUDA DLLs from torch/lib are discoverable for CTranslate2
TORCH_LIB_PATH = Path(__file__).resolve().parent.parent / "upstream" / "kokoro-fastapi" / ".venv" / "Lib" / "site-packages" / "torch" / "lib"
if TORCH_LIB_PATH.exists():
    os.environ["PATH"] = str(TORCH_LIB_PATH) + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(str(TORCH_LIB_PATH))
        except Exception:
            pass

# Local transcription imports
try:
    from aligner import align_script_and_asr
    from srt_writer import generate_srt_content, write_timestamps_safely
except ImportError:
    from transcription.aligner import align_script_and_asr
    from transcription.srt_writer import generate_srt_content, write_timestamps_safely


def emit_progress(stage: str, percent: int, message: str, **kwargs):
    """Emits structured JSON line progress update to stdout."""
    event = {
        "event": "progress",
        "stage": stage,
        "percent": percent,
        "message": message,
        "timestamp": time.time(),
        **kwargs
    }
    print(json.dumps(event, ensure_ascii=False), flush=True)


def compute_file_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def get_audio_duration(wav_path: Path) -> float:
    with wave.open(str(wav_path), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        return frames / float(rate)


def run_transcription_pipeline(
    project_dir: Path,
    model_path: Path,
    device: str = "cuda",
    compute_type: str = "int8_float16",
    language: str = "en"
) -> Dict[str, Any]:
    project_dir = Path(project_dir).resolve()
    audio_path = project_dir / "audio.wav"
    script_path = project_dir / "script.txt"
    manifest_path = project_dir / "manifest.json"

    if not audio_path.exists():
        raise FileNotFoundError(f"Missing audio.wav in {project_dir}")
    if not script_path.exists():
        raise FileNotFoundError(f"Missing script.txt in {project_dir}")

    emit_progress("preparing", 5, "Hashing audio and reading project metadata...")
    start_total_time = time.time()
    audio_hash = compute_file_sha256(audio_path)
    audio_duration = get_audio_duration(audio_path)

    with open(script_path, "r", encoding="utf-8") as f:
        script_text = f.read()

    manifest: Dict[str, Any] = {}
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            manifest = {}

    model_path = Path(model_path).resolve()
    if not model_path.exists():
        raise FileNotFoundError(f"Local Whisper model is not installed at {model_path}.")

    emit_progress("loading_model", 15, f"Loading Whisper model from {model_path.name} on {device} ({compute_type})...")
    load_start = time.time()
    
    from faster_whisper import WhisperModel
    try:
        model = WhisperModel(
            str(model_path),
            device=device,
            compute_type=compute_type,
            local_files_only=True
        )
    except Exception as e:
        if device == "cuda":
            emit_progress("loading_model", 18, f"CUDA load error: {e}. Falling back to CPU...")
            device = "cpu"
            compute_type = "int8"
            model = WhisperModel(
                str(model_path),
                device="cpu",
                compute_type="int8",
                local_files_only=True
            )
        else:
            raise

    load_duration = round(time.time() - load_start, 3)

    emit_progress("transcribing", 25, "Running faster-whisper inference with word timestamps...")
    inference_start = time.time()

    segments_gen, info = model.transcribe(
        str(audio_path),
        language=language,
        word_timestamps=True,
        beam_size=5,
        vad_filter=False
    )

    raw_segments = []
    for seg in segments_gen:
        seg_dict = {
            "id": seg.id,
            "seek": seg.seek,
            "start": seg.start,
            "end": seg.end,
            "text": seg.text,
            "tokens": seg.tokens,
            "avg_logprob": seg.avg_logprob,
            "compression_ratio": seg.compression_ratio,
            "no_speech_prob": seg.no_speech_prob,
            "words": [
                {
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                    "probability": w.probability
                }
                for w in (seg.words or [])
            ]
        }
        raw_segments.append(seg_dict)

        # Update dynamic transcription progress based on audio position
        if audio_duration > 0:
            seg_progress = 25 + int(min(seg.end / audio_duration, 1.0) * 55)
            emit_progress("transcribing", seg_progress, f"Transcribed {seg.end:.1f}s / {audio_duration:.1f}s...")

    inference_duration = round(time.time() - inference_start, 3)
    rtf = round(inference_duration / max(0.1, audio_duration), 4)

    # 1. Save transcription_raw.json
    raw_output = {
        "engine": "faster-whisper",
        "model": model_path.name,
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "audio_sha256": audio_hash,
        "audio_duration": audio_duration,
        "load_duration_seconds": load_duration,
        "transcription_duration_seconds": inference_duration,
        "realtime_factor": rtf,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "segments": raw_segments
    }
    raw_path = project_dir / "transcription_raw.json"
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw_output, f, indent=2, ensure_ascii=False)

    # 2. Perform alignment
    emit_progress("aligning", 85, "Aligning recognized speech with script.txt sentences...")
    alignment_result = align_script_and_asr(
        script_text=script_text,
        manifest=manifest,
        raw_whisper_segments=raw_segments,
        audio_duration=audio_duration
    )

    canonical_segments = alignment_result["segments"]
    metrics = alignment_result["metrics"]

    # 3. Format and save SRT and timestamps.json
    emit_progress("writing", 95, "Validating and writing timestamps.srt and timestamps.json...")
    srt_content = generate_srt_content(canonical_segments)

    timestamps_json_data = {
        "version": 1,
        "audio_file": "audio.wav",
        "audio_sha256": audio_hash,
        "audio_duration": round(audio_duration, 3),
        "transcription": {
            "engine": "faster-whisper",
            "model": model_path.name,
            "device": device,
            "compute_type": compute_type,
            "language": language,
            "load_duration_seconds": load_duration,
            "transcription_duration_seconds": inference_duration,
            "realtime_factor": rtf
        },
        "alignment": metrics,
        "segments": canonical_segments
    }

    json_path, srt_path = write_timestamps_safely(
        project_dir=project_dir,
        timestamps_data=timestamps_json_data,
        srt_content=srt_content,
        expected_sentence_count=len(canonical_segments),
        max_duration=audio_duration
    )

    # 4. Save transcription_settings.json snapshot
    settings_data = {
        "engine": "faster-whisper",
        "package_version": "1.2.1",
        "model_identifier": model_path.name,
        "local_model_path": str(model_path),
        "device": device,
        "compute_type": compute_type,
        "language": language,
        "word_timestamps": True,
        "beam_size": 5,
        "audio_sha256": audio_hash,
        "audio_duration": round(audio_duration, 3),
        "alignment_coverage_pct": metrics.get("coverage_pct", 0.0),
        "total_sentences": metrics.get("total_sentences", 0),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    settings_path = project_dir / "transcription_settings.json"
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings_data, f, indent=2, ensure_ascii=False)

    total_duration = round(time.time() - start_total_time, 3)
    emit_progress(
        "completed",
        100,
        f"Timestamps generated successfully ({len(canonical_segments)} sentences, {metrics.get('coverage_pct', 0.0)}% coverage).",
        json_file=str(json_path.name),
        srt_file=str(srt_path.name),
        metrics=metrics,
        total_duration=total_duration
    )

    return timestamps_json_data


def main():
    parser = argparse.ArgumentParser(description="UnfoldIQ Whisper Transcription Worker")
    parser.add_argument("project_dir", type=str, help="Path to project directory")
    parser.add_argument("--model-path", type=str, default="models/whisper/small.en", help="Path to local Whisper model")
    parser.add_argument("--device", type=str, default="cuda", choices=["cuda", "cpu"], help="Inference device")
    parser.add_argument("--compute-type", type=str, default="int8_float16", help="CTranslate2 compute type")
    parser.add_argument("--language", type=str, default="en", help="Language code")

    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    model_path = Path(args.model_path)
    if not model_path.is_absolute():
        # Resolve relative to repo root
        repo_root = Path(__file__).resolve().parent.parent
        model_path = (repo_root / model_path).resolve()

    try:
        run_transcription_pipeline(
            project_dir=project_dir,
            model_path=model_path,
            device=args.device,
            compute_type=args.compute_type,
            language=args.language
        )
    except Exception as e:
        emit_progress("failed", 0, f"Error: {str(e)}", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
