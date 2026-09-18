import json, subprocess, sys
from pathlib import Path
sys.path.insert(0, ".")
from studio import encoder_probe as ep
from studio.config import config

out = Path("temp/phase04_verification/benchmark")
out.mkdir(parents=True, exist_ok=True)

env = {
    "ffmpeg": ep.ffmpeg_version(),
    "encoders": ep.encoders_available(),
    "ffprobe": config.ffprobe_path,
}
try:
    import shutil
    gpu = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total",
                          "--format=csv,noheader"], capture_output=True, text=True, timeout=30)
    env["nvidia_smi"] = gpu.stdout.strip() if gpu.returncode == 0 else f"unavailable rc={gpu.returncode}"
except Exception as e:
    env["nvidia_smi"] = f"unavailable: {e}"
(out / "environment.json").write_text(json.dumps(env, indent=2), encoding="utf-8")
print("ENV:", json.dumps(env, indent=1)[:600])

print("NVENC runtime probe...")
print(json.dumps(ep.nvenc_runtime_works(), indent=1)[:400])

src = Path("projects/2026-09-12_210003_youtube-narration-01/renders/draft/draft_preview.mp4")
print("fixture bytes:", src.stat().st_size)
res = ep.benchmark(src, out / "run1", runs=3, bitrate="4M", timeout=900)
(out / "results.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
cmds = [res["profiles"][k].get("command", "") for k in ("libx264", "h264_nvenc")]
(out / "commands.txt").write_text("\n\n".join(cmds), encoding="utf-8")
print(json.dumps({k: {kk: v for kk, v in p.items() if kk != "command"}
                  for k, p in res["profiles"].items()}, indent=1)[:1500])
print("RECOMMENDATION:", res.get("recommendation"))
