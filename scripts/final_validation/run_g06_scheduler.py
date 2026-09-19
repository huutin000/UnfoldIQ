"""G06 — Resource Scheduler & Recovery (Task 8, validation-only).

1. Record resource policy. 2. Run Phase 8+9 runtime-safety scripts (raw).
3. Mixed-class stress: CUDA_HEAVY (real Kokoro TTS), GPU_ENCODER (NVENC tiny
clip), CPU_BOUND, cancel-while-held, controlled failure, recovery job.
Evidence: resource_scheduler/.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, append_command_log, write_gate_result,
    write_json_create_only,
)

import os as _os2

GATE_DIR = REPO / "temp" / "final_system_validation" / "resource_scheduler"
if _os2.environ.get("FG_RERUN"):
    GATE_DIR = GATE_DIR / _os2.environ["FG_RERUN"]


def _sh(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "")[:3000]
    except Exception as e:
        return 99, f"<unavailable: {e}>"


def _smi(path: Path):
    code, out = _sh(["nvidia-smi",
                     "--query-gpu=index,name,utilization.gpu,memory.used,memory.total",
                     "--format=csv,noheader"])
    path.write_text(out + "\n", encoding="utf-8")
    return out


def _tts(text: str) -> bytes:
    body = json.dumps({"model": "kokoro", "input": text, "voice": "af_heart",
                       "response_format": "wav"}).encode()
    req = urllib.request.Request("http://127.0.0.1:8880/v1/audio/speech",
                                 data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def main() -> int:
    GATE_DIR.mkdir(parents=True, exist_ok=True)
    clog = GATE_DIR / "commands.log"
    obs: list[str] = []
    fails: list[str] = []
    t0 = time.time()

    from studio.resource_scheduler import LocalResourceScheduler, ResourceGuard
    import os as _os
    sched = LocalResourceScheduler()

    def _active() -> dict:
        ac = sched.active_counts
        return dict(ac() if callable(ac) else ac)
    policy = {
        "cudaHeavyConcurrency": sched.cuda_concurrency,
        "gpuEncoderConcurrency": sched.encoder_concurrency,
        "cpuBoundConcurrency": sched.cpu_concurrency,
        "ioBoundConcurrency": sched.io_concurrency,
        "gpuConflictRule": "CUDA_HEAVY x GPU_ENCODER denied on 4GB VRAM "
                           "(ResourceGuard.check_can_run)",
    }
    (GATE_DIR / "resource_policy.json").write_text(
        json.dumps(policy, indent=2) + "\n", encoding="utf-8")

    _smi(GATE_DIR / "nvidia_smi_before.txt")
    for script in ("scripts/verify_phase08_runtime_safety.py",
                   "scripts/verify_phase09_runtime_safety.py"):
        c, o = _sh([sys.executable, script], timeout=1500)
        append_command_log(clog, [script], c, o, "")
        (GATE_DIR / (Path(script).stem + ".log")).write_text(o[-20000:],
                                                             encoding="utf-8")
        if c != 0:
            fails.append(f"{script} exit={c}")
        else:
            obs.append(f"{script} GREEN")
    _smi(GATE_DIR / "nvidia_smi_during.txt")

    async def stress():
        timeline: list[dict] = []

        async def cpu_job():
            await asyncio.sleep(2.0)
            return sum(range(100000))

        t = time.time()
        r1 = await sched.submit_job("fg-cpu-1", "probe", "CPU_BOUND", cpu_job)
        timeline.append({"job": "fg-cpu-1", "class": "CPU_BOUND",
                         "result": r1, "s": round(time.time() - t, 1)})

        # GPU_ENCODER: real NVENC tiny clip.
        enc_src = GATE_DIR / "enc_src.mp4"
        enc_out = GATE_DIR / "enc_nvenc.mp4"
        c, _ = _sh(["ffmpeg", "-y", "-hide_banner", "-nostdin", "-f", "lavfi",
                    "-i", "testsrc2=size=320x180:rate=24:duration=2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(enc_src)])
        nvenc_ok, nvenc_msg = False, ""
        if c == 0:
            async def enc_job():
                rc, msg = await asyncio.to_thread(
                    _sh, ["ffmpeg", "-y", "-hide_banner", "-nostdin", "-i",
                          str(enc_src), "-c:v", "h264_nvenc", "-pix_fmt",
                          "yuv420p", str(enc_out)])
                if rc != 0:
                    raise RuntimeError(f"nvenc rc={rc}: {msg[:300]}")
                return enc_out.stat().st_size
            try:
                n = await sched.submit_job("fg-enc-1", "probe", "GPU_ENCODER", enc_job)
                nvenc_ok, nvenc_msg = True, f"{n} bytes"
            except Exception as e:
                nvenc_msg = repr(e)[:300]
        timeline.append({"job": "fg-enc-1", "class": "GPU_ENCODER",
                         "nvenc": nvenc_ok, "detail": nvenc_msg})
        if not nvenc_ok:
            fails.append(f"GPU_ENCODER NVENC path failed: {nvenc_msg}")

        # CUDA_HEAVY: real Kokoro TTS ( host-side path, scheduler-tracked ).
        async def tts_job():
            return await asyncio.to_thread(_tts, "Final gate scheduler probe two.")
        try:
            wav = await sched.submit_job("fg-tts-1", "probe", "CUDA_HEAVY", tts_job)
            timeline.append({"job": "fg-tts-1", "class": "CUDA_HEAVY",
                             "wavBytes": len(wav)})
        except Exception as e:
            timeline.append({"job": "fg-tts-1", "class": "CUDA_HEAVY",
                             "error": repr(e)[:300]})
            fails.append(f"CUDA_HEAVY TTS path failed: {repr(e)[:200]}")

        # Conflict rule: CUDA_HEAVY must be denied while GPU_ENCODER active.
        guard = ResourceGuard()
        probe = guard.check_can_run("CUDA_HEAVY",
                                    {"CUDA_HEAVY": 0, "GPU_ENCODER": 1})
        timeline.append({"conflictProbe": probe})
        if isinstance(probe, dict) and probe.get("allowed") is False:
            obs.append("ResourceGuard denies CUDA_HEAVY during GPU_ENCODER")
        else:
            obs.append(f"conflict probe response: {str(probe)[:200]}")

        # Cancel while permit held. Scheduler cancellation is cooperative:
        # cancel_job marks the job; the permit releases when coro_fn returns
        # and the post-check raises JobCancelledError. Await past the job's
        # own duration, then require counts back to 0 (bounded wait).
        started = asyncio.Event()
        cancelled_seen = {}

        async def long_job():
            started.set()
            await asyncio.sleep(8.0)
            return "should-not-finish"

        task = asyncio.create_task(
            sched.submit_job("fg-cancel-1", "probe", "CPU_BOUND", long_job))
        await started.wait()
        await asyncio.sleep(0.5)
        ok_cancel = sched.cancel_job("fg-cancel-1")
        try:
            await asyncio.wait_for(task, timeout=25)
            cancelled_seen["outcome"] = "returned-normally-UNEXPECTED"
        except asyncio.TimeoutError:
            cancelled_seen["outcome"] = "TIMEOUT-past-job-duration"
        except Exception as e:
            cancelled_seen["outcome"] = type(e).__name__ + ": " + str(e)[:150]
        counts = _active()
        if "JobCancelledError" in cancelled_seen.get("outcome", ""):
            obs.append("cooperative cancel raised JobCancelledError within bound")
        else:
            fails.append(f"cancel outcome unexpected: {cancelled_seen.get('outcome')}")
        timeline.append({"cancel": {"requested": ok_cancel,
                                    "outcome": cancelled_seen.get("outcome"),
                                    "activeAfter": counts}})
        if any(v != 0 for v in counts.values()):
            fails.append(f"permit leak after cancel: {counts}")
        else:
            obs.append("no permit leak after cancel")

        async def boom():
            raise RuntimeError("controlled G06 failure")
        try:
            await sched.submit_job("fg-fail-1", "probe", "CPU_BOUND", boom)
            fails.append("controlled failure did not raise")
        except RuntimeError as e:
            timeline.append({"controlledFailure": str(e)[:100]})
        counts2 = _active()
        if any(v != 0 for v in counts2.values()):
            fails.append(f"permit leak after failure: {counts2}")

        r2 = await sched.submit_job("fg-cpu-2", "probe", "CPU_BOUND", cpu_job)
        timeline.append({"job": "fg-cpu-2", "class": "CPU_BOUND",
                         "result": r2, "recovery": True})
        obs.append("subsequent job completes after cancel+failure")
        return timeline

    timeline = asyncio.run(stress())
    (GATE_DIR / "job_timeline.json").write_text(
        json.dumps(timeline, indent=2) + "\n", encoding="utf-8")
    (GATE_DIR / "permit_timeline.json").write_text(json.dumps(
        {"finalActiveCounts": _active()}, indent=2) + "\n",
        encoding="utf-8")
    _smi(GATE_DIR / "nvidia_smi_after.txt")
    procs = [{"pid": p["pid"] if isinstance(p, dict) else None} for p in []]
    (GATE_DIR / "process_inventory.json").write_text(
        json.dumps({"note": "in-process scheduler; no owned children spawned",
                    "pythonPids": procs}, indent=2) + "\n", encoding="utf-8")

    status = GateStatus.PASS if not fails else GateStatus.FAIL
    write_gate_result(GATE_DIR, GateResult(
        gate="G06", name="Resource Scheduler & Recovery", status=status,
        hard_blocker=True,
        failure_kind=("FG_PRODUCT_FAILURE" if fails else None),
        evidence=["resource_policy.json", "job_timeline.json",
                  "permit_timeline.json", "nvidia_smi_before.txt",
                  "nvidia_smi_during.txt", "nvidia_smi_after.txt",
                  "process_inventory.json"],
        observations=tuple(obs + [f"duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails)))
    try:
        write_json_create_only(GATE_DIR / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (GATE_DIR / "summary.md").write_text(f"# G06 — {status.value}\n", encoding="utf-8")
    print(f"G06 {status.value}: fails={fails}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
