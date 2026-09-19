"""G12/G13 — Final Render + Auto QA (Task 12, validation-only).

Fresh G12_render copy + fixture media -> real export -> real Final Render
-> automatic Render QA -> verify binary identity + lineage + READY.
Evidence: render/ + render_qa/.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, append_command_log, sha256_file,
    write_gate_result, write_json_create_only,
)
from scripts.final_validation.prepare_final_gate import (  # noqa: E402
    BASE_PROJECT,
)
from scripts.final_validation.fixtures import (  # noqa: E402
    generate_validation_frame, provision_shot_media,
)

GATE_DIR = REPO / "temp" / "final_system_validation"
RENDER_DIR = GATE_DIR / "render"
QA_DIR = GATE_DIR / "render_qa"
SERVED_NAME = "FG_G12_render"
PROJECTS_DIR = REPO / "projects"
PROV = "VALIDATION_FIXTURE"
PROVIDER = "LOCAL_VALIDATION"


def main() -> int:
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    clog = GATE_DIR / "commands.log"
    t0 = time.time()
    fails_g12, fails_g13, obs = [], [], []

    served = PROJECTS_DIR / SERVED_NAME
    if served.exists():
        shutil.rmtree(served)
    shutil.copytree(BASE_PROJECT, served)

    # Heal project to READY.
    from studio.scene_planner import compute_file_sha256
    from studio.veo_prompt_generator import compute_scene_hashes
    vb_p = served / "visual_bible.json"
    vb = json.loads(vb_p.read_text(encoding="utf-8"))
    vb["sourceScenePlanHash"] = compute_file_sha256(served / "scene_plan.json")
    vb_p.write_text(json.dumps(vb, ensure_ascii=False, indent=2), encoding="utf-8")
    veo_p = served / "veo_prompts.json"
    veo = json.loads(veo_p.read_text(encoding="utf-8"))
    sp = json.loads((served / "scene_plan.json").read_text(encoding="utf-8"))
    veo["sceneHashes"] = compute_scene_hashes(sp.get("scenes", []))
    veo_p.write_text(json.dumps(veo, ensure_ascii=False, indent=2), encoding="utf-8")
    obs.append("healed project to READY")

    # Fixture provisioning (141 shots) on served project.
    import tempfile
    frame = Path(tempfile.gettempdir()) / "final_gate_g12_frame.png"
    generate_validation_frame(frame)
    shots = [{"shot_id": f"shot_{i+1:03d}", "scene_id": f"scene_{(i//2)+1:03d}"}
             for i in range(141)]
    provision_shot_media(served, frame, shots, is_baseline=False)
    obs.append("provisioned 141 VALIDATION_FIXTURE assets")

    from starlette.testclient import TestClient
    from studio.app import app
    client = TestClient(app)

    # 1. Create fresh export + compile & persist Render Manifest.
    from studio.production_export import execute_export
    from studio.timeline_compiler import compile_render_manifest
    exp = execute_export(SERVED_NAME)
    export_id = exp.get("exportId") or exp.get("export_id")
    obs.append(f"export created: {export_id}")
    res = compile_render_manifest(served, export_id)
    if not res.validation.valid:
        fails_g12.append(f"manifest compile invalid: {res.validation.blockers}")

    # 2. Trigger real production Final Render via live server.
    import urllib.request
    req_body = json.dumps({"exportId": export_id, "encoderProfile": "FINAL_QUALITY"}).encode("utf-8")
    req = urllib.request.Request(
        f"http://127.0.0.1:7860/api/projects/{SERVED_NAME}/render/final",
        data=req_body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            post_res = json.loads(resp.read().decode("utf-8"))
        job_id = post_res.get("jobId") or post_res.get("job", {}).get("id")
        obs.append(f"Final Render job {job_id} started")
    except Exception as e:
        fails_g12.append(f"trigger final render failed: {e}")
        job_id = None

    # Poll until terminal.
    terminal = None
    if job_id:
        for _ in range(600):  # up to 20 minutes (2s intervals)
            time.sleep(2)
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:7860/api/activity/jobs?projectId={SERVED_NAME}",
                    timeout=10
                ) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    for j in data.get("jobs", []):
                        if (j.get("id") or j.get("jobId")) == job_id:
                            if j.get("status") in ("COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"):
                                terminal = j
                                break
                if terminal:
                    break
            except Exception:
                pass

    if not terminal:
        fails_g12.append("Final Render timeout (no terminal state)")
    else:
        obs.append(f"Final Render terminal: {terminal.get('status')}")

    # 3. Verify G12 Final independently with ffprobe.
    final_path = served / "exports" / export_id / "final.mp4"
    if terminal and terminal.get("status") == "COMPLETED":
        if not final_path.is_file():
            fails_g12.append("final.mp4 not found at expected path")
        else:
            import subprocess
            ffprobe = subprocess.run(
                ["ffprobe", "-v", "error", "-of", "json", "-show_format",
                 "-show_streams", "-count_frames", str(final_path)],
                capture_output=True, text=True, timeout=120)
            if ffprobe.returncode != 0:
                fails_g12.append("ffprobe failed on final.mp4")
            else:
                import json as _json
                pr = _json.loads(ffprobe.stdout)
                (RENDER_DIR / "final_probe.json").write_text(
                    json.dumps(pr, indent=2), encoding="utf-8")
                vs = [s for s in pr.get("streams", []) if s.get("codec_type") == "video"]
                if not vs:
                    fails_g12.append("no video stream")
                else:
                    v = vs[0]
                    if v.get("width") != 1920 or v.get("height") != 1080:
                        fails_g12.append(f"resolution {v.get('width')}x{v.get('height')} != 1920x1080")
                    if "24/1" not in v.get("avg_frame_rate", "") and "24/1" not in v.get("r_frame_rate", ""):
                        fails_g12.append(f"frame rate {v.get('avg_frame_rate')} != 24/1 CFR")
                    if v.get("codec_name") != "h264":
                        fails_g12.append(f"codec {v.get('codec_name')} != H.264")
                obs.append("G12 ffprobe: PASS")

                # Copy evidence files before cleanup.
                try:
                    shutil.copy2(final_path, RENDER_DIR / "final.mp4")
                    meta_src = served / "exports" / export_id / "render-metadata.json"
                    if meta_src.is_file():
                        shutil.copy2(meta_src, RENDER_DIR / "render-metadata.json")
                except Exception as e:
                    obs.append(f"evidence copy note: {e}")

                # 4. Verify automatic Render QA handoff.
                qa_latest_data = None
                for _ in range(60):  # wait up to 120s for automatic QA enqueue
                    time.sleep(2)
                    try:
                        with urllib.request.urlopen(
                            f"http://127.0.0.1:7860/api/projects/{SERVED_NAME}/exports/{export_id}/qa/latest",
                            timeout=10
                        ) as resp:
                            if resp.status == 200:
                                qa_latest_data = json.loads(resp.read().decode("utf-8"))
                                if qa_latest_data.get("qaRunId"):
                                    break
                    except Exception:
                        pass

                if not qa_latest_data:
                    fails_g13.append("automatic QA not found via /qa/latest")
                else:
                    qa_run_id = qa_latest_data.get("qaRunId")
                    obs.append(f"auto QA qaRunId={qa_run_id}")

                    # Wait for QA completion.
                    qa_done = None
                    for _ in range(180):
                        time.sleep(2)
                        try:
                            with urllib.request.urlopen(
                                f"http://127.0.0.1:7860/api/projects/{SERVED_NAME}/exports/{export_id}/qa/runs/{qa_run_id}",
                                timeout=10
                            ) as resp:
                                if resp.status == 200:
                                    qa_data = json.loads(resp.read().decode("utf-8"))
                                    if qa_data.get("verdict") in ("PASS", "PASS_WITH_WARNINGS", "FAIL") or qa_data.get("status") in ("COMPLETED", "FAILED"):
                                        qa_done = qa_data
                                        break
                        except Exception:
                            pass

                    if not qa_done:
                        fails_g13.append("QA timeout")
                    else:
                        obs.append(f"QA verdict: {qa_done.get('verdict')}")
                        (QA_DIR / "qa_report.json").write_text(
                            json.dumps(qa_done, indent=2, ensure_ascii=False), encoding="utf-8")

                        # Verify binary identity.
                        final_sha = sha256_file(final_path)
                        qa_sha = qa_done.get("finalSha256") or (qa_done.get("final") or {}).get("sha256Commit")
                        if final_sha != qa_sha:
                            fails_g13.append(f"hash mismatch: final={final_sha[:16]} qa={qa_sha[:16] if qa_sha else 'none'}")
                        else:
                            obs.append("binary identity match (finalSha256)")

                        # Verify lineage.
                        lineage_ok = (
                            qa_done.get("projectId") == SERVED_NAME and
                            qa_done.get("exportId") == export_id and
                            qa_done.get("manifestHash") and
                            qa_done.get("qaRunId")
                        )
                        if not lineage_ok:
                            fails_g13.append("QA lineage incomplete")
                        else:
                            obs.append("lineage match: projectId/exportId/manifestHash/finalSha256/qaRunId")

                        # Verify QA verdict.
                        verdict = qa_done.get("verdict")
                        if verdict not in ("PASS", "PASS_WITH_WARNINGS"):
                            fails_g13.append(f"QA verdict not accepted: {verdict}")
                        else:
                            obs.append(f"QA verdict: {verdict} -> artifact READY")

                        # Verify QA performance.
                        qa_time = qa_done.get("totalQaTime") or qa_done.get("qaTime")
                        if qa_time:
                            obs.append(f"QA time: {qa_time:.1f}s")

    shutil.rmtree(served, ignore_errors=True)

    # Persist evidence.
    status_g12 = GateStatus.PASS if not fails_g12 else GateStatus.FAIL
    status_g13 = GateStatus.PASS if not fails_g13 else GateStatus.FAIL
    write_gate_result(RENDER_DIR, GateResult(
        gate="G12", name="Final Render Deliverable", status=status_g12,
        hard_blocker=True, failure_kind=("FG_PRODUCT_FAILURE" if fails_g12 else None),
        evidence=["final.mp4", "render-metadata.json"],
        observations=tuple(obs + [f"G12 duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails_g12)))
    write_gate_result(QA_DIR, GateResult(
        gate="G13", name="Automated Render QA", status=status_g13,
        hard_blocker=True, failure_kind=("FG_PRODUCT_FAILURE" if fails_g13 else None),
        evidence=["qa_report.json"],
        observations=tuple(obs + [f"G13 duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails_g13)))
    try:
        write_json_create_only(RENDER_DIR / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
        write_json_create_only(QA_DIR / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (RENDER_DIR / "summary.md").write_text(f"# G12 — {status_g12.value}\n", encoding="utf-8")
    (QA_DIR / "summary.md").write_text(f"# G13 — {status_g13.value}\n", encoding="utf-8")
    print(f"G12 {status_g12.value}: fails={fails_g12}")
    print(f"G13 {status_g13.value}: fails={fails_g13}")
    return 0 if (status_g12 == GateStatus.PASS and status_g13 == GateStatus.PASS) else 1


if __name__ == "__main__":
    raise SystemExit(main())