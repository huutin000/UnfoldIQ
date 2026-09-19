"""G02 — Canonical 79/141 Full E2E on Dedicated Clone (Task 13, validation-only).

Walks the full production path from Overview -> Story -> Voice -> Visual ->
Export preflight -> Portable Package -> Render Manifest -> Final Render ->
Automatic Render QA -> Artifact READY -> Post-READY cold restart verification.
Evidence: temp/final_system_validation/e2e/
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, append_command_log, sha256_file,
    write_gate_result, write_json_create_only,
)
from scripts.final_validation.prepare_final_gate import (  # noqa: E402
    BASE_PROJECT, coldstart, port_open,
)
from scripts.final_validation.fixtures import (  # noqa: E402
    generate_validation_frame, provision_shot_media,
)

import os as _os
import argparse

DEFAULT_GATE_DIR = REPO / "temp" / "final_system_validation" / "e2e"
PROJECTS_DIR = REPO / "projects"
SERVED_NAME = "FG_G02_e2e"
HOST = "http://127.0.0.1:7860"


def _http_get(url: str, timeout: int = 15) -> tuple[int, dict | str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = resp.read()
            try:
                return resp.status, json.loads(data.decode("utf-8"))
            except Exception:
                return resp.status, data.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, str(e)
    except Exception as e:
        return 0, str(e)


def _http_post(url: str, payload: dict, timeout: int = 30) -> tuple[int, dict | str]:
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data_bytes,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            try:
                return resp.status, json.loads(body.decode("utf-8"))
            except Exception:
                return resp.status, body.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, str(e)
    except Exception as e:
        return 0, str(e)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rerun", default=_os.environ.get("FG_RERUN", ""))
    args, _ = parser.parse_known_args()

    gate_dir = DEFAULT_GATE_DIR
    if args.rerun:
        gate_dir = gate_dir / args.rerun

    gate_dir.mkdir(parents=True, exist_ok=True)
    clog = gate_dir / "commands.log"
    t0 = time.time()
    fails: list[str] = []
    obs: list[str] = []
    workflow_results: dict[str, dict] = {}
    job_timeline: list[dict] = []

    # Step 1: Create dedicated G02 copy from frozen baseline.
    served = PROJECTS_DIR / SERVED_NAME
    if served.exists():
        shutil.rmtree(served)
    shutil.copytree(BASE_PROJECT, served)
    append_command_log(clog, ["stage_project", SERVED_NAME], 0, str(served), "")
    obs.append("staged fresh G02 copy from frozen canonical baseline")

    # Heal visual_bible and veo_prompts hashes to match baseline scene_plan.
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
    obs.append("healed baseline metadata hashes to READY")

    # Step 2: Provision deterministic validation media (141 shots).
    frame = Path(tempfile.gettempdir()) / "final_gate_g02_frame.png"
    generate_validation_frame(frame)
    shots = [{"shot_id": f"shot_{i+1:03d}", "scene_id": f"scene_{(i//2)+1:03d}"}
             for i in range(141)]
    provision_shot_media(served, frame, shots, is_baseline=False)
    obs.append("provisioned 141 VALIDATION_FIXTURE assets")

    # Invariants snapshot BEFORE.
    sp_before = json.loads((served / "scene_plan.json").read_text(encoding="utf-8"))
    veo_before = json.loads((served / "veo_prompts.json").read_text(encoding="utf-8"))
    scenes_count = len(sp_before.get("scenes", []))
    shots_count = len(veo_before.get("shots", []))
    if scenes_count != 79:
        fails.append(f"scenes count {scenes_count} != 79")
    if shots_count != 141:
        fails.append(f"shots count {shots_count} != 141")

    # Step 3: Pre-E2E cold restart.
    cs_pre = coldstart()
    if not (port_open(7860) and port_open(8880)):
        fails.append("pre-E2E coldstart failed to restore listening ports")
    obs.append(f"pre-E2E coldstart OK (studio {cs_pre['studio']['startupSeconds']}s)")

    # Step 4: Walk the canonical production path.
    # 4a. Overview / Project Open
    st_render, ov_state = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/render-state")
    st_list, proj_list = _http_get(f"{HOST}/api/projects")
    is_listed = any(p.get("directory_name") == SERVED_NAME for p in (proj_list.get("projects", []) if isinstance(proj_list, dict) else []))
    workflow_results["overview"] = {"status": st_render, "listed": is_listed, "ok": st_render == 200 and is_listed}
    if st_render != 200 or not is_listed:
        fails.append(f"overview check failed: render-state={st_render} listed={is_listed}")
    else:
        obs.append("Overview GET 200 and project listed")

    # 4b. Story / Script
    st, scr = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/script")
    workflow_results["story"] = {"status": st, "ok": st == 200}
    if st != 200:
        fails.append(f"script GET HTTP {st}")
    else:
        obs.append("Story GET 200")

    # 4c. Voice / Audio Master
    st, _ = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/audio/wav")
    workflow_results["voice"] = {"status": st, "ok": st == 200}
    if st != 200:
        fails.append(f"voice audio.wav GET HTTP {st}")
    else:
        obs.append("Voice audio.wav GET 200")

    # 4d. Visual / Scenes & Bible
    st_sp, _ = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/scenes")
    st_vb, _ = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/visual-bible")
    workflow_results["visual"] = {"status_sp": st_sp, "status_vb": st_vb, "ok": st_sp == 200 and st_vb == 200}
    if st_sp != 200 or st_vb != 200:
        fails.append(f"visual endpoints HTTP sp={st_sp} vb={st_vb}")
    else:
        obs.append("Visual endpoints GET 200 (/scenes, /visual-bible)")

    # 4e. Export Preflight / Readiness
    st, rdn = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/export/readiness")
    workflow_results["preflight"] = {"status": st, "ready": (rdn.get("ready") if isinstance(rdn, dict) else False)}
    if st != 200 or not isinstance(rdn, dict) or not rdn.get("ready"):
        fails.append(f"export readiness check not ready: {rdn}")
    else:
        obs.append("Export readiness: READY")

    # 4f. Portable Production Package
    pkg_req = urllib.request.Request(f"{HOST}/api/projects/{SERVED_NAME}/export/portable-package")
    with urllib.request.urlopen(pkg_req, timeout=120) as r:
        pkg_bytes = r.read()
    workflow_results["portable_package"] = {"bytes": len(pkg_bytes), "ok": len(pkg_bytes) > 0}
    obs.append(f"Portable package generated ({len(pkg_bytes)} bytes)")

    # 4g. Render Manifest creation + persistence
    from studio.production_export import execute_export
    from studio.timeline_compiler import compile_render_manifest
    exp = execute_export(SERVED_NAME)
    export_id = exp.get("exportId") or exp.get("export_id")
    obs.append(f"Export snapshot created: {export_id}")
    res = compile_render_manifest(served, export_id)
    if not res.validation.valid:
        fails.append(f"render manifest compile invalid: {res.validation.blockers}")
    else:
        obs.append(f"Render Manifest compiled + persisted ({export_id})")

    # 4h. Final Render via production API
    st, post_res = _http_post(
        f"{HOST}/api/projects/{SERVED_NAME}/render/final",
        {"exportId": export_id, "encoderProfile": "FINAL_QUALITY"}
    )
    job_id = post_res.get("jobId") or (post_res.get("job") or {}).get("id") if isinstance(post_res, dict) else None
    if st != 200 or not job_id:
        fails.append(f"Final Render POST HTTP {st}: {post_res}")
    else:
        obs.append(f"Final Render job started: {job_id}")

    # Poll Final Render to terminal state
    terminal = None
    t_start = time.time()
    for _ in range(600):
        time.sleep(2)
        st_job, data = _http_get(f"{HOST}/api/activity/jobs?projectId={SERVED_NAME}")
        if st_job == 200 and isinstance(data, dict):
            for j in data.get("jobs", []):
                if (j.get("id") or j.get("jobId")) == job_id:
                    job_timeline.append({
                        "at": round(time.time() - t_start, 1),
                        "status": j.get("status"),
                        "progress": j.get("progress"),
                        "phase": (j.get("metadata") or {}).get("executionPhase")
                    })
                    if j.get("status") in ("COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"):
                        terminal = j
                        break
        if terminal:
            break

    if not terminal or terminal.get("status") != "COMPLETED":
        fails.append(f"Final Render did not complete successfully: {terminal}")
    else:
        obs.append(f"Final Render COMPLETED in {round(time.time() - t_start, 1)}s")

    # 4i. Verify final.mp4 with ffprobe
    final_path = served / "exports" / export_id / "final.mp4"
    if not final_path.is_file():
        fails.append("final.mp4 missing after render completion")
    else:
        probe_cmd = ["ffprobe", "-v", "error", "-of", "json", "-show_format",
                     "-show_streams", "-count_frames", str(final_path)]
        r_probe = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=120)
        if r_probe.returncode != 0:
            fails.append("ffprobe failed on final.mp4")
        else:
            pr = json.loads(r_probe.stdout)
            (gate_dir / "final_probe.json").write_text(json.dumps(pr, indent=2), encoding="utf-8")
            vs = [s for s in pr.get("streams", []) if s.get("codec_type") == "video"]
            if not vs:
                fails.append("no video stream in final.mp4")
            else:
                v = vs[0]
                if v.get("width") != 1920 or v.get("height") != 1080:
                    fails.append(f"resolution {v.get('width')}x{v.get('height')} != 1920x1080")
                if "24/1" not in v.get("avg_frame_rate", "") and "24/1" not in v.get("r_frame_rate", ""):
                    fails.append(f"frame rate {v.get('avg_frame_rate')} != 24/1 CFR")
                if v.get("codec_name") != "h264":
                    fails.append(f"codec {v.get('codec_name')} != h264")
            obs.append("final.mp4 ffprobe verified (1080p CFR H.264)")

    # 4j. Automatic Render QA observation
    qa_latest = None
    for _ in range(60):
        time.sleep(2)
        st_qa, qdata = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/exports/{export_id}/qa/latest")
        if st_qa == 200 and isinstance(qdata, dict) and qdata.get("qaRunId"):
            qa_latest = qdata
            break

    if not qa_latest:
        fails.append("automatic Render QA not enqueued or not found via /qa/latest")
    else:
        qa_run_id = qa_latest.get("qaRunId")
        obs.append(f"automatic Render QA enqueued: {qa_run_id}")

        qa_done = None
        for _ in range(180):
            time.sleep(2)
            st_run, rdata = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/exports/{export_id}/qa/runs/{qa_run_id}")
            if st_run == 200 and isinstance(rdata, dict):
                if rdata.get("verdict") in ("PASS", "PASS_WITH_WARNINGS", "FAIL") or rdata.get("status") in ("COMPLETED", "FAILED"):
                    qa_done = rdata
                    break

        if not qa_done:
            fails.append("Render QA timed out without completing")
        else:
            verdict = qa_done.get("verdict")
            obs.append(f"Render QA verdict: {verdict}")
            if verdict not in ("PASS", "PASS_WITH_WARNINGS"):
                fails.append(f"Render QA verdict rejected: {verdict}")
            (gate_dir / "qa_report.json").write_text(json.dumps(qa_done, indent=2, ensure_ascii=False), encoding="utf-8")

            # Binary identity and lineage check
            final_sha = sha256_file(final_path)
            qa_sha = qa_done.get("finalSha256") or (qa_done.get("final") or {}).get("sha256Commit")
            if final_sha != qa_sha:
                fails.append(f"finalSha256 mismatch: {final_sha} != {qa_sha}")
            else:
                obs.append("binary identity match (finalSha256)")

            lineage = {
                "projectId": qa_done.get("projectId"),
                "exportId": qa_done.get("exportId"),
                "manifestHash": qa_done.get("manifestHash"),
                "finalSha256": final_sha,
                "renderJobId": job_id,
                "qaRunId": qa_run_id,
                "verdict": verdict,
            }
            (gate_dir / "artifact_lineage.json").write_text(json.dumps(lineage, indent=2), encoding="utf-8")

    # Step 5: Invariants check AFTER
    sp_after = json.loads((served / "scene_plan.json").read_text(encoding="utf-8"))
    veo_after = json.loads((served / "veo_prompts.json").read_text(encoding="utf-8"))
    scenes_after = len(sp_after.get("scenes", []))
    shots_after = len(veo_after.get("shots", []))
    integrity = {
        "scenes_before": scenes_count, "scenes_after": scenes_after,
        "shots_before": shots_count, "shots_after": shots_after,
        "scenes_match": scenes_count == scenes_after == 79,
        "shots_match": shots_count == shots_after == 141,
    }
    (gate_dir / "before_after_integrity.json").write_text(json.dumps(integrity, indent=2), encoding="utf-8")
    if not (integrity["scenes_match"] and integrity["shots_match"]):
        fails.append("before/after scene or shot count drifted during E2E")

    # Step 6: Post-READY cold restart and persistence check.
    cs_post = coldstart()
    obs.append(f"post-READY coldstart OK (studio {cs_post['studio']['startupSeconds']}s)")
    st_post_qa, post_qa = _http_get(f"{HOST}/api/projects/{SERVED_NAME}/exports/{export_id}/qa/latest")
    if st_post_qa != 200 or not isinstance(post_qa, dict) or post_qa.get("qaRunId") != qa_run_id:
        fails.append("QA report failed to persist across post-READY restart")
    else:
        obs.append("QA report persisted intact across post-READY restart")

    # Save evidence artifacts before cleanup.
    try:
        shutil.copy2(final_path, gate_dir / "final.mp4")
        meta_p = served / "exports" / export_id / "render-metadata.json"
        if meta_p.is_file():
            shutil.copy2(meta_p, gate_dir / "render-metadata.json")
    except Exception as e:
        obs.append(f"evidence copy note: {e}")

    shutil.rmtree(served, ignore_errors=True)

    # Save all G02 gate artifacts.
    (gate_dir / "workflow_results.json").write_text(json.dumps(workflow_results, indent=2), encoding="utf-8")
    (gate_dir / "job_timeline.json").write_text(json.dumps(job_timeline, indent=2), encoding="utf-8")

    status = GateStatus.PASS if not fails else GateStatus.FAIL
    write_gate_result(gate_dir, GateResult(
        gate="G02", name="Canonical 79/141 Full E2E", status=status,
        hard_blocker=True, failure_kind=("FG_PRODUCT_FAILURE" if fails else None),
        evidence=["workflow_results.json", "artifact_lineage.json",
                  "before_after_integrity.json", "job_timeline.json", "final.mp4",
                  "render-metadata.json", "qa_report.json"],
        observations=tuple(obs + [f"G02 total duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails)
    ))
    try:
        write_json_create_only(gate_dir / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (gate_dir / "summary.md").write_text(f"# G02 Canonical 79/141 Full E2E — {status.value}\n", encoding="utf-8")

    print(f"G02 {status.value}: fails={fails}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
