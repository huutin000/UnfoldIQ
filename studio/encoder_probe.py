"""
UnfoldIQ Encoder Capability & Benchmark — Phase 4.

- Capability detection from the real FFmpeg binary (no assumptions).
- h264_nvenc vs libx264 benchmark on the same fixture: same input,
  same resolution/fps/pix_fmt, matched bitrate, SSIM + PSNR vs the same
  reference, wall-clock timings, file sizes. Exact commands are logged.
- Produces a recommendation record; NEVER changes the production default
  (libx264 CPU). Phase 8 owns the official renderer architecture.
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("unfoldiq.encoder_probe")


def _ffmpeg() -> str:
    from studio.config import config
    return config.ffmpeg_path


def ffmpeg_version() -> Dict[str, Any]:
    out = subprocess.run([_ffmpeg(), "-hide_banner", "-version"],
                         capture_output=True, text=True, timeout=30)
    first = (out.stdout or "").splitlines()[0] if out.stdout else ""
    m = re.search(r"ffmpeg version (\S+)", first)
    return {"raw": first, "version": m.group(1) if m else "unknown"}


def encoders_available() -> Dict[str, bool]:
    out = subprocess.run([_ffmpeg(), "-hide_banner", "-encoders"],
                         capture_output=True, text=True, timeout=30)
    text = out.stdout or ""
    found = {}
    for name in ("h264_nvenc", "hevc_nvenc", "libx264", "libx265", "libwebp", "aac"):
        found[name] = bool(re.search(rf"^\s*\S+\s+{re.escape(name)}\s", text, re.M))
    return found


def nvenc_runtime_works(timeout: int = 120) -> Dict[str, Any]:
    """Prove NVENC works at runtime (listing alone is not proof)."""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        out = str(Path(td) / "nvenc_probe.mp4")
        cmd = [_ffmpeg(), "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=2",
               "-c:v", "h264_nvenc", "-preset", "p4", "-pix_fmt", "yuv420p", out]
        try:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           check=True, timeout=timeout)
            ok = Path(out).is_file() and Path(out).stat().st_size > 0
            return {"works": ok, "detail": "2s testsrc encode succeeded" if ok else "no output"}
        except Exception as e:
            err = ""
            try:
                err = str(e.stderr or e)[:300] if hasattr(e, "stderr") else str(e)[:300]
            except Exception:
                err = str(e)[:300]
            return {"works": False, "detail": err}


def _run(cmd: List[str], timeout: int) -> float:
    t0 = time.perf_counter()
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                   check=True, timeout=timeout)
    return time.perf_counter() - t0


def _metrics(reference: Path, distorted: Path, workdir: Path, tag: str) -> Dict[str, Any]:
    """SSIM + PSNR of distorted vs reference (same resolution required)."""
    # POSIX separators: backslashes would be eaten as filter escapes on Windows.
    ssim_log = (workdir / f"{tag}_ssim.log").as_posix()
    psnr_log = (workdir / f"{tag}_psnr.log").as_posix()
    cmd_s = [_ffmpeg(), "-y", "-i", str(distorted), "-i", str(reference),
             "-lavfi", f"ssim=stats_file={ssim_log}", "-f", "null", "-"]
    cmd_p = [_ffmpeg(), "-y", "-i", str(distorted), "-i", str(reference),
             "-lavfi", f"psnr=stats_file={psnr_log}", "-f", "null", "-"]
    subprocess.run(cmd_s, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=300)
    subprocess.run(cmd_p, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=300)
    def _parse(path, keys: List[str]) -> Dict[str, Optional[float]]:
        vals: Dict[str, Optional[float]] = {k: None for k in keys}
        try:
            text = Path(path).read_text(encoding="utf-8", errors="replace")
            acc: Dict[str, List[float]] = {k: [] for k in keys}
            for line in text.splitlines():
                for k in keys:
                    m = re.search(rf"{k}\s*:\s*([0-9a-zA-Z.\-]+)", line)
                    if m:
                        try:
                            acc[k].append(float(m.group(1)))
                        except ValueError:
                            if m.group(1).lower() == "inf":
                                acc[k].append(float("inf"))
            for k in keys:
                if acc[k]:
                    vals[k] = sum(acc[k]) / len(acc[k])
        except Exception:
            pass
        return vals
    # Summary keys as emitted by the filters: ssim "All:", psnr "psnr_avg:".
    ssim = _parse(ssim_log, ["All"])
    psnr = _parse(psnr_log, ["psnr_avg"])
    return {"ssim_all": ssim.get("All"), "psnr_avg_db": psnr.get("psnr_avg"),
            "ssim_log": str(ssim_log), "psnr_log": str(psnr_log)}


def benchmark(source: Path, outdir: Path, runs: int = 3,
              bitrate: str = "800k", timeout: int = 600,
              mode: str = "cbr", quality: str = "23") -> Dict[str, Any]:
    """Benchmark h264_nvenc vs libx264 on the same source.

    mode="cbr": matched bitrate (-b:v/-maxrate/-bufsize identical).
    mode="quality": matched quality-profile intent (x264 CRF 23 vs NVENC CQ 23,
      same preset family); scales differ by vendor, documented as limitation.
    Identical input, resolution, fps, pix_fmt, audio settings in both modes.
    Quality measured against the same reference.
    """
    source, outdir = Path(source), Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    if mode == "quality":
        profiles = {
            "libx264": ["-c:v", "libx264", "-preset", "veryfast", "-crf", quality],
            "h264_nvenc": ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", quality],
        }
        target = (f"quality-profile CRF/CQ {quality} "
                  "(vendor scales differ; see limitations)")
        rate_args: List[str] = []
    elif mode == "cbr":
        profiles = {
            "libx264": ["-c:v", "libx264", "-preset", "veryfast"],
            "h264_nvenc": ["-c:v", "h264_nvenc", "-preset", "p4"],
        }
        m = re.fullmatch(r"(\d+)([kM])", bitrate)
        if not m:
            raise ValueError(f"bitrate must look like 200k/4M, got {bitrate!r}")
        bufsize = f"{2 * int(m.group(1))}{m.group(2)}"
        target = f"matched bitrate {bitrate}"
        rate_args = ["-b:v", bitrate, "-maxrate", bitrate, "-bufsize", bufsize]
    else:
        raise ValueError(f"unknown benchmark mode: {mode}")
    results: Dict[str, Any] = {"source": str(source), "mode": mode,
                               "target": target, "bitrate": bitrate,
                               "runs_requested": runs, "profiles": {}}
    for name, vcodec in profiles.items():
        times, sizes, outs = [], [], []
        ok = True
        fail_detail = ""
        for i in range(runs):
            out = outdir / f"bench_{name}_r{i}.mp4"
            cmd = ([_ffmpeg(), "-y", "-i", str(source)] + vcodec + rate_args +
                   ["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", str(out)])
            try:
                times.append(_run(cmd, timeout))
                sizes.append(out.stat().st_size)
                outs.append(out)
            except Exception as e:
                ok, fail_detail = False, str(e)[:300]
                break
        entry: Dict[str, Any] = {"ok": ok, "times_s": times, "sizes_bytes": sizes,
                                 "command": " ".join(cmd) if 'cmd' in dir() else ""}
        if ok:
            import statistics
            entry["median_s"] = statistics.median(times)
            # Quality of the first run output vs source reference.
            try:
                entry["quality"] = _metrics(source, outs[0], outdir, f"bench_{name}")
            except Exception as e:
                entry["quality"] = {"error": str(e)[:200]}
        else:
            entry["fail_detail"] = fail_detail
        results["profiles"][name] = entry
    results["created_at"] = datetime.now(timezone.utc).isoformat()
    a, b = results["profiles"].get("libx264", {}), results["profiles"].get("h264_nvenc", {})
    if a.get("ok") and b.get("ok"):
        results["recommendation"] = (
            "Both encoders functional at matched bitrate. Production default stays "
            "libx264 (CPU) — no blind switch. NVENC usable for speed when quality delta is acceptable."
            if (b.get("median_s", 1e9) <= a.get("median_s", 0)) else
            "libx264 remains the default; NVENC showed no speed advantage here.")
    else:
        results["recommendation"] = "Benchmark incomplete (one profile failed); keep libx264 default."
    (outdir / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results
