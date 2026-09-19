"""Phase 9 render-QA verification script (real FFmpeg, temp dirs only).

Runs a clean PASS plus a mid-stream-corruption FAIL through the production
RenderQaService and prints machine-readable results. Exit nonzero on mismatch.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from phase09_qa_media import (  # noqa: E402
    make_clean_final,
    write_export,
)


async def _run_qa(projects: Path, jobs, project_name: str, export_id: str,
                  timeout: float = 600.0) -> tuple[dict, dict]:
    from studio.render_qa_report_store import RenderQaReportStore
    from studio.render_qa_service import RenderQaService
    svc = RenderQaService(projects_dir=projects, jobs=jobs)
    req = svc.request_qa(project_name, export_id, "MANUAL_RERUN")
    job = await svc.wait_for_job(req["jobId"], timeout=timeout)
    report = RenderQaReportStore().read_report(
        projects / project_name / "exports" / export_id, req["qaRunId"])
    return job, report


async def _main(tmp: Path) -> dict:
    from studio.jobs_manager import JobsManager
    projects = tmp / "projects"
    projects.mkdir()
    jobs = JobsManager(runtime_dir=tmp / "jobs", projects_dir=projects)
    results: dict = {}

    clean_src = tmp / "clean.mp4"
    make_clean_final(clean_src, 4.0)
    proj = projects / "proj_verify_clean"
    proj.mkdir()
    write_export(proj, "export_001", clean_src)
    job, report = await _run_qa(projects, jobs, "proj_verify_clean",
                                "export_001")
    results["clean"] = {"verdict": report.get("verdict"),
                        "artifact": job["metadata"].get("artifactStatus"),
                        "frames": report.get("probe", {}).get("observedFrameCount")}

    corrupt_src = tmp / "corrupt.mp4"
    buf = bytearray(clean_src.read_bytes())
    off = len(buf) // 2
    buf[off:off + 8192] = b"\x00" * 8192
    corrupt_src.write_bytes(bytes(buf))
    proj2 = projects / "proj_verify_corrupt"
    proj2.mkdir()
    write_export(proj2, "export_001", corrupt_src)
    job2, report2 = await _run_qa(projects, jobs, "proj_verify_corrupt",
                                  "export_001")
    results["corrupt_midstream"] = {
        "verdict": report2.get("verdict"),
        "artifact": job2["metadata"].get("artifactStatus"),
        "hardFailures": [f["code"] for f in (report2.get("hardFailures") or [])],
        "decodeErrors": (report2.get("fullDecode") or {}).get("decodeErrorCount"),
    }
    return results


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="phase09_verify_") as td:
        results = asyncio.run(_main(Path(td)))
    print(json.dumps(results, indent=2))
    ok = (results["clean"]["verdict"] == "PASS"
          and results["clean"]["artifact"] == "READY"
          and results["corrupt_midstream"]["verdict"] == "FAIL"
          and results["corrupt_midstream"]["artifact"] == "BLOCKED"
          and "QA_FULL_DECODE_FAILED" in results["corrupt_midstream"]["hardFailures"])
    print("PHASE09 RENDER QA VERIFY:", "GREEN" if ok else "RED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
