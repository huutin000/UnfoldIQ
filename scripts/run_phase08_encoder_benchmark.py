"""Phase 8 Task 12: Versioned Encoder Benchmark Script.
Compares FINAL_QUALITY_V1 (libx264) vs ACCELERATED_V1 (h264_nvenc).
1 warmup run + 3 measured runs per profile.
Evidence: temp/phase08_verification/benchmark/benchmark_results.json
"""
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio.render_profiles import ACCELERATED_V1, FINAL_QUALITY_V1

OUT_DIR = Path("temp/phase08_verification/benchmark")
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _get_ffmpeg_version():
    res = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True)
    first_line = res.stdout.splitlines()[0] if res.stdout else "unknown"
    return first_line


def _get_hardware_identifiers():
    gpu_name = "None"
    try:
        res = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, check=True
        )
        if res.stdout.strip():
            gpu_name = res.stdout.strip()
    except Exception:
        pass

    cpu_name = platform.processor() or "CPU"
    return {"cpu": cpu_name, "gpu": gpu_name}


def _calc_ssim_psnr(encoded_file: Path, ref_file: Path) -> tuple[float, float]:
    cmd_ssim = [
        "ffmpeg", "-y", "-i", str(encoded_file), "-i", str(ref_file),
        "-lavfi", "ssim", "-f", "null", "-"
    ]
    res_ssim = subprocess.run(cmd_ssim, capture_output=True, text=True)
    ssim_val = 0.0
    match = re.search(r"All:([0-9.]+)", res_ssim.stderr)
    if match:
        ssim_val = float(match.group(1))

    cmd_psnr = [
        "ffmpeg", "-y", "-i", str(encoded_file), "-i", str(ref_file),
        "-lavfi", "psnr", "-f", "null", "-"
    ]
    res_psnr = subprocess.run(cmd_psnr, capture_output=True, text=True)
    psnr_val = 0.0
    match = re.search(r"average:([0-9.]+)", res_psnr.stderr)
    if match:
        psnr_val = float(match.group(1))

    return ssim_val, psnr_val


def benchmark_profile(profile, ref_file: Path, temp_dir: Path, n_runs: int = 3) -> dict:
    print(f"\n--- Benchmarking Profile: {profile.name.value} ({profile.video_encoder}) ---")
    out_file = temp_dir / f"{profile.name.value}.mp4"

    # Base encode args
    args = [
        "ffmpeg", "-y", "-i", str(ref_file),
        *profile.video_args,
        "-pix_fmt", "yuv420p",
        str(out_file)
    ]

    # Warmup run
    print("Running warmup...")
    subprocess.run(args, check=True, capture_output=True)

    elapsed_times = []
    for i in range(1, n_runs + 1):
        if out_file.exists():
            out_file.unlink()
        t0 = time.perf_counter()
        subprocess.run(args, check=True, capture_output=True)
        dur = time.perf_counter() - t0
        elapsed_times.append(dur)
        print(f"Run {i}/{n_runs}: {dur:.3f}s")

    out_bytes = out_file.stat().st_size
    ssim_val, psnr_val = _calc_ssim_psnr(out_file, ref_file)

    sorted_times = sorted(elapsed_times)
    mean_time = sum(elapsed_times) / len(elapsed_times)
    median_time = sorted_times[len(sorted_times) // 2]
    min_time = sorted_times[0]

    return {
        "profileName": profile.name.value,
        "profileVersion": profile.version,
        "encoder": profile.video_encoder,
        "exactArgs": list(profile.video_args),
        "warmup": True,
        "measuredRuns": n_runs,
        "timesSeconds": [round(t, 4) for t in elapsed_times],
        "meanSeconds": round(mean_time, 4),
        "medianSeconds": round(median_time, 4),
        "minSeconds": round(min_time, 4),
        "outputSizeBytes": out_bytes,
        "outputSizeMB": round(out_bytes / (1024 * 1024), 3),
        "ssim": round(ssim_val, 6),
        "psnr": round(psnr_val, 3),
    }


def main():
    print("=== UnfoldIQ Phase 8 Encoder Benchmark ===")
    tmp = Path(tempfile.mkdtemp(prefix="phase08_bench_"))
    try:
        ref_file = tmp / "reference_motion.mp4"
        print("Generating motion-complex reference video (1920x1080 @ 24fps, 3 seconds)...")
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "testsrc2=size=1920x1080:rate=24",
            "-t", "3",
            "-c:v", "libx264", "-crf", "10", "-pix_fmt", "yuv420p",
            str(ref_file)
        ], check=True, capture_output=True)

        hw = _get_hardware_identifiers()
        ff_ver = _get_ffmpeg_version()
        print(f"FFmpeg: {ff_ver}")
        print(f"GPU: {hw['gpu']}")

        results_fq = benchmark_profile(FINAL_QUALITY_V1, ref_file, tmp, n_runs=3)
        results_acc = benchmark_profile(ACCELERATED_V1, ref_file, tmp, n_runs=3)

        speedup = 1.0
        if results_acc["medianSeconds"] > 0:
            speedup = round(results_fq["medianSeconds"] / results_acc["medianSeconds"], 2)

        summary = {
            "benchmarkTimestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ffmpegVersion": ff_ver,
            "hardware": hw,
            "referenceDurationSeconds": 3.0,
            "speedupRatio": speedup,
            "profiles": [results_fq, results_acc],
            "conclusion": (
                f"FINAL_QUALITY_V1 ({results_fq['encoder']}) achieved PSNR {results_fq['psnr']} dB / SSIM {results_fq['ssim']} in {results_fq['medianSeconds']}s. "
                f"ACCELERATED_V1 ({results_acc['encoder']}) completed in {results_acc['medianSeconds']}s ({speedup}x speedup) with PSNR {results_acc['psnr']} dB / SSIM {results_acc['ssim']}. "
                f"Production default remains FINAL_QUALITY."
            ),
        }

        out_file = OUT_DIR / "benchmark_results.json"
        out_file.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"\nSaved benchmark results to: {out_file.resolve()}")
        print("\nSummary:")
        print(summary["conclusion"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
