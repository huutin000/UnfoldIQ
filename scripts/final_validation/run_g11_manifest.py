"""G11 — Render Manifest Verification (Task 11, validation-only).

Fresh G11_manifest copy + fixture media -> real export -> persist manifest
-> run all 10 Phase 7 validation gates + invariant assertions.
Evidence: render_manifest/.
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

import argparse
import os

DEFAULT_GATE_DIR = REPO / "temp" / "final_system_validation" / "render_manifest"
SERVED_NAME = "FG_G11_manifest"
PROV = "VALIDATION_FIXTURE"
PROVIDER = "LOCAL_VALIDATION"
PROJECTS_DIR = REPO / "projects"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rerun", default=os.environ.get("FG_RERUN", ""))
    args, _ = parser.parse_known_args()

    gate_dir = DEFAULT_GATE_DIR
    if args.rerun:
        gate_dir = gate_dir / args.rerun

    gate_dir.mkdir(parents=True, exist_ok=True)
    clog = gate_dir / "commands.log"
    t0 = time.time()
    fails, obs = [], []

    served = PROJECTS_DIR / SERVED_NAME
    if served.exists():
        shutil.rmtree(served)
    shutil.copytree(BASE_PROJECT, served)

    # Fixture provisioning (141 shots).
    import tempfile
    frame = Path(tempfile.gettempdir()) / "final_gate_g11_frame.png"
    generate_validation_frame(frame)
    shots = [{"shot_id": f"shot_{i+1:03d}", "scene_id": f"scene_{(i//2)+1:03d}"}
             for i in range(141)]
    provision_shot_media(served, frame, shots, is_baseline=False)
    obs.append("provisioned 141 VALIDATION_FIXTURE assets on G11 served project")

    # Heal project to READY: sync visual_bible sourceScenePlanHash + veo sceneHashes.
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
    obs.append("healed project to READY (synced vb/veo hashes)")

    from starlette.testclient import TestClient
    from studio.app import app
    from studio.timeline_compiler import (
        load_scene_list, load_scene_shots, load_assets_by_shot,
        load_vb_bindings, load_master_audio_info, load_output_settings,
        load_source_hashes, compile_render_manifest, ManifestCompilation,
    )
    from studio.render_manifest_validation import validate_render_manifest

    # 1. Create a fresh immutable export snapshot (export_001).
    from studio.production_export import execute_export
    export_res = execute_export(SERVED_NAME)
    export_id = export_res.get("exportId") or export_res.get("export_id")
    obs.append(f"created export {export_id}")

    # 2. Persist the real Phase 7 Render Manifest.
    res = compile_render_manifest(served, export_id)
    if not res.validation.valid:
        fails.append(f"manifest validation failed: {res.validation.blockers}")
    else:
        obs.append("manifest compiled + validated (persisted)")

    # 3. Re-read and assert invariants.
    manifest_path = served / "exports" / export_id / "render-manifest.json"
    man = json.loads(manifest_path.read_text(encoding="utf-8"))
    clips = man.get("videoTrack", {}).get("clips", [])
    if len(clips) != 141:
        fails.append(f"clip count {len(clips)} != 141")
    expected_final = man.get("expectedFinalFrames") or max((c.get("endFrame", 0) for c in clips), default=0)
    if expected_final <= 0:
        fails.append("expectedFinalFrames <= 0")

    # 4. Run all 10 Phase 7 validation gates via validator (needs model).
    from studio.render_manifest import RenderManifest as RMModel
    man_model = RMModel.model_validate(man)
    val = validate_render_manifest(man_model, project_dir=served)
    gate_codes = [
        "PATH_SANDBOX_AND_PRESENCE", "ACCEPTED_ASSET_INTEGRITY",
        "UNSUPPORTED_MEDIA_TYPE", "NON_POSITIVE_DURATION",
        "INVALID_TIMESTAMPS", "TRANSITION_AWARE_OVERLAPS",
        "TIMELINE_GAPS", "REQUIRED_MASTER_AUDIO",
        "AUDIO_DURATION_ALIGNMENT", "OPTIONAL_TRACK_HANDLING",
    ]
    for gc in gate_codes:
        issues = [i for i in val.blockers + val.warnings if i.code == gc]
        if issues:
            fails.append(f"Phase 7 gate {gc}: {issues[0].message}")

    # 5. Structural invariants.
    if man.get("frameRate", {}).get("numerator") != 24 or \
            man.get("frameRate", {}).get("denominator") != 1:
        fails.append("frameRate != 24/1")
    if man.get("timeBase", {}).get("numerator") != 1 or \
            man.get("timeBase", {}).get("denominator") != 24:
        fails.append("timeBase != 1/24")
    for c in clips:
        if c.get("startFrame", -1) < 0 or c.get("durationFrames", -1) <= 0:
            fails.append(f"non-integer/negative frame coords in clip {c.get('clipId')}")
        if c.get("endFrame") != c.get("startFrame") + c.get("durationFrames"):
            fails.append(f"endFrame != startFrame+duration in clip {c.get('clipId')}")

    # 6. Source hashes match actual compiler inputs.
    from studio.timeline_compiler import load_source_hashes
    hashes = load_source_hashes(served)
    for k, v in man.get("sourceHashes", {}).items():
        if hashes.get(k) != v:
            fails.append(f"sourceHash mismatch {k}: manifest={v} actual={hashes.get(k)}")

    # 7. Write g11_identity.json for downstream.
    identity = {"projectId": SERVED_NAME, "exportId": export_id,
                "manifestHash": man.get("manifestHash"),
                "expectedFinalFrames": expected_final}
    (gate_dir / "g11_identity.json").write_text(
        json.dumps(identity, indent=2) + "\n", encoding="utf-8")

    # 8. Persist evidence.
    (gate_dir / "raw_manifest.json").write_text(
        json.dumps(man, indent=2) + "\n", encoding="utf-8")
    (gate_dir / "validation_result.json").write_text(
        json.dumps({"valid": val.valid, "blockers": [i.model_dump() for i in val.blockers],
                    "warnings": [i.model_dump() for i in val.warnings]},
                   indent=2) + "\n", encoding="utf-8")

    status = GateStatus.PASS if not fails else GateStatus.FAIL
    write_gate_result(gate_dir, GateResult(
        gate="G11", name="Render Manifest Verification", status=status,
        hard_blocker=True,
        failure_kind=("FG_PRODUCT_FAILURE" if fails else None),
        evidence=["raw_manifest.json", "validation_result.json", "g11_identity.json"],
        observations=tuple(obs + [f"duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails)))
    try:
        write_json_create_only(gate_dir / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (gate_dir / "summary.md").write_text(f"# G11 — {status.value}\n", encoding="utf-8")
    print(f"G11 {status.value}: fails={fails}")
    shutil.rmtree(served, ignore_errors=True)
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())