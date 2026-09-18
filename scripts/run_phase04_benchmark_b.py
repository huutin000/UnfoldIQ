"""Benchmark B — motion-complex quality-discriminating fixture (Phase 4 closure).

Deterministic synthetic fixture (no production media): testsrc2 + noise,
15s 720p24. Reference = effectively-lossless CRF 10 encode. Both encoders
run at quality-profile 28, 3 runs each, SSIM/PSNR vs the SAME reference.
Evidence: temp/phase04_final_closure/benchmark/.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, ".")
from studio.config import config
from studio.encoder_probe import benchmark

FF = config.ffmpeg_path
OUT = Path("temp/phase04_final_closure/benchmark")
OUT.mkdir(parents=True, exist_ok=True)


def run(cmd, timeout=600):
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                   check=True, timeout=timeout)


print("building deterministic base (testsrc2 + noise, 15s)...")
base = OUT / "fixture_base.mp4"
run([FF, "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=15",
     "-vf", "noise=alls=30:allf=t,format=yuv420p",
     "-c:v", "libx264", "-preset", "medium", "-crf", "10",
     "-an", str(base)])
print("base bytes:", base.stat().st_size)

print("reference (effectively lossless CRF 10)...")
ref = OUT / "fixture_reference.mp4"
run([FF, "-y", "-i", str(base), "-c:v", "libx264", "-preset", "medium",
     "-crf", "10", "-pix_fmt", "yuv420p", "-an", str(ref)])
print("reference bytes:", ref.stat().st_size)

res = benchmark(ref, OUT / "runB", runs=3, mode="quality", quality="28", timeout=900)
for k, p in res["profiles"].items():
    q = p.get("quality", {})
    print(k, "median", round(p.get("median_s", 0), 2), "size", p["sizes_bytes"][0],
          "ssim", q.get("ssim_all"), "psnr", q.get("psnr_avg_db"))
(OUT / "benchmark_b_results.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
print("RECO:", res.get("recommendation"))
