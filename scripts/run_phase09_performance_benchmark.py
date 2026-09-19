"""Phase 9 long-form performance benchmark (temp media only).

Builds a >=20-minute Final, runs full production QA, prints wall-clock
breakdown and QA_RTF. Exit nonzero if RTF > 1.0 or verdict != PASS.
"""
import asyncio
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DURATION_S = 20 * 60


async def _main(tmp: Path) -> dict:
    from studio.jobs_manager import JobsManager
    from studio.render_manifest_hashing import compute_manifest_hash
    from studio.render_qa_service import RenderQaService
    projects = tmp / "projects"
    projects.mkdir()
    metrics: dict = {}
    final = tmp / "final20.mp4"
    t0 = time.perf_counter()
    proc = subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i",
         f"color=c=0x3b82f6:size=1920x1080:rate=24:duration={DURATION_S}",
         "-f", "lavfi", "-i",
         f"sine=frequency=440:sample_rate=48000:duration={DURATION_S}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "24",
         "-preset", "ultrafast", "-crf", "30",
         "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k",
         "-shortest", str(final)],
        capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(f"fixture encode failed: {proc.stderr[-1500:]}")
    metrics["fixture_gen_s"] = round(time.perf_counter() - t0, 1)

    from studio.render_qa_probe import compute_sha256, run_ffprobe
    t0 = time.perf_counter()
    sha = compute_sha256(final)
    metrics["hash_s"] = round(time.perf_counter() - t0, 2)
    t0 = time.perf_counter()
    probe = run_ffprobe(final)
    metrics["probe_s"] = round(time.perf_counter() - t0, 2)
    n_frames = probe.video.read_frames
    final_dur = n_frames / 24.0
    metrics.update({"frames": n_frames, "final_duration_s": round(final_dur, 2),
                    "final_sha256": sha[:16] + "..."})

    proj = projects / "projBench"
    export_dir = proj / "exports" / "export_001"
    export_dir.mkdir(parents=True)
    import shutil
    shutil.copyfile(final, export_dir / "final.mp4")
    manifest = {
        "schemaVersion": "1.0.0", "projectId": "projBench",
        "exportId": "export_001",
        "frameRate": {"numerator": 24, "denominator": 1},
        "timeBase": {"numerator": 1, "denominator": 24},
        "output": {"width": 1920, "height": 1080},
        "videoTrack": {"clips": [
            {"clipId": "clip_all", "sceneId": "scene_001",
             "shotId": "shot_001", "sequenceIndex": 1,
             "startFrame": 0, "durationFrames": n_frames,
             "endFrame": n_frames, "assetId": "a1",
             "acceptedAssetVersion": 1, "checksum": "0" * 64,
             "filePath": "assets/s1.png", "mediaType": "IMAGE",
             "transition": {"type": "CUT", "durationFrames": 0}}]},
        "voiceTrack": {}, "musicTrack": {"configured": False},
        "subtitlesTrack": {"configured": False}, "scenes": [],
    }
    manifest["manifestHash"] = compute_manifest_hash(manifest)
    (export_dir / "render-manifest.json").write_text(json.dumps(manifest))
    (export_dir / "render-metadata.json").write_text(json.dumps(
        {"projectId": "projBench", "exportId": "export_001",
         "manifestHash": manifest["manifestHash"],
         "expectedFinalFrames": n_frames}))
    jobs = JobsManager(runtime_dir=tmp / "jobs", projects_dir=projects)
    svc = RenderQaService(projects_dir=projects, jobs=jobs)
    t0 = time.perf_counter()
    req = svc.request_qa("projBench", "export_001", "MANUAL_RERUN")
    job = await svc.wait_for_job(req["jobId"], timeout=1800.0)
    metrics["qa_wall_s"] = round(time.perf_counter() - t0, 1)
    metrics["verdict"] = (job.get("metadata") or {}).get("qaVerdict")
    metrics["artifact"] = (job.get("metadata") or {}).get("artifactStatus")
    metrics["qa_rtf"] = round(metrics["qa_wall_s"] / final_dur, 4)
    metrics["decode_fps"] = round(n_frames / metrics["qa_wall_s"], 1)
    return metrics


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="phase09_bench_") as td:
        metrics = asyncio.run(_main(Path(td)))
    print(json.dumps(metrics, indent=2))
    ok = (metrics["final_duration_s"] >= DURATION_S
          and metrics["qa_rtf"] <= 1.0
          and metrics["verdict"] == "PASS")
    print("PHASE09 BENCHMARK:", "GREEN" if ok else "RED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
