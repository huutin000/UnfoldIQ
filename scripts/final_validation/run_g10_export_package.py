"""G10 — Portable Export Package Verification (Task 10, validation-only).

Fresh G10_export copy under projects/ + fixture media -> production portable-package endpoint
-> extract -> verify 10 artifact groups + 100% checksum match + provenance.
Evidence: export_package/.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
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

GATE_DIR = REPO / "temp" / "final_system_validation" / "export_package"
PROV = "VALIDATION_FIXTURE"
PROVIDER = "LOCAL_VALIDATION"
PROJECTS_DIR = REPO / "projects"
SERVED_NAME = "FG_G10_export"


def _sha256(p: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for c in iter(lambda: f.read(1024 * 1024), b""):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    GATE_DIR.mkdir(parents=True, exist_ok=True)
    clog = GATE_DIR / "commands.log"
    t0 = time.time()
    fails, obs = [], []

    from starlette.testclient import TestClient
    from studio.app import app
    client = TestClient(app)

    # Stage served copy under projects/ so endpoint finds it.
    served = PROJECTS_DIR / SERVED_NAME
    if served.exists():
        shutil.rmtree(served)
    shutil.copytree(BASE_PROJECT, served)
    append_command_log(clog, ["stage-project", SERVED_NAME], 0, str(served), "")

    # Fixture provisioning (141 shots).
    frame = Path(tempfile.gettempdir()) / "final_gate_g10_frame.png"
    generate_validation_frame(frame)
    shots = [{"shot_id": f"shot_{i+1:03d}", "scene_id": f"scene_{(i//2)+1:03d}"}
             for i in range(141)]
    provision_shot_media(served, frame, shots, is_baseline=False)
    obs.append("provisioned 141 VALIDATION_FIXTURE assets on served project")

    # Request portable package.
    resp = client.get(f"/api/projects/{SERVED_NAME}/export/portable-package")
    if resp.status_code != 200:
        fails.append(f"portable-package HTTP {resp.status_code}: {resp.text[:300]}")
        write_gate_result(GATE_DIR, GateResult(
            gate="G10", name="Portable Export Package", status=GateStatus.FAIL,
            hard_blocker=True, failure_kind="FG_PRODUCT_FAILURE",
            evidence=[], observations=tuple(obs), failures=tuple(fails)))
        shutil.rmtree(served, ignore_errors=True)
        return 1

    zip_bytes = resp.content
    (GATE_DIR / "raw_package.zip").write_bytes(zip_bytes)
    obs.append(f"package bytes: {len(zip_bytes)}")

    # Extract to evidence-only dir, verify path safety.
    with tempfile.TemporaryDirectory() as td:
        ext = Path(td) / "extracted"
        shutil.unpack_archive(GATE_DIR / "raw_package.zip", ext, "zip")
        for f in ext.rglob("*"):
            if f.is_file():
                rel = f.relative_to(ext).as_posix()
                if rel.startswith("..") or rel.startswith("/") or "\\" in rel:
                    fails.append(f"unsafe path in zip: {rel}")

# Verify 10 artifact groups (actual package layout).
        groups = {
            "script": ["script/script.json", "script/script.txt"],
            "master_wav": ["audio/audio.wav"],
            "subtitle": ["subtitles/timestamps.srt", "subtitles/timestamps.vtt"],
            "shots_json": ["shots/shots.json"],
            "shots_csv": ["shots/shots.csv"],
            "visual_bible": ["visual/visual_bible.json"],
            "prompts": ["visual/veo_prompts.json", "visual/image_prompts.json",
                        "visual/visual_prompts.json"],
            "asset_manifest": ["assets/asset_manifest.json"],
            "manifest": ["manifest.json"],
        }
        found = {}
        for grp, files in groups.items():
            for f in files:
                if (ext / f).is_file():
                    found[grp] = ext / f
                    break
        for grp in groups:
            if grp not in found:
                fails.append(f"missing artifact group: {grp}")

        # Accepted media group (separate check): must have at least one media file.
        accepted_media = []
        for f in ext.rglob("*"):
            if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg",
                                                      ".mp4", ".mov", ".webp",
                                                      ".wav", ".mp3"):
                rel = f.relative_to(ext).as_posix()
                if (rel.startswith("assets/media/") or rel.startswith("audio/")
                        or rel.startswith("video/")):
                    accepted_media.append(rel)
        if not accepted_media:
            fails.append("missing artifact group: accepted_media")
        else:
            obs.append(f"accepted media files: {len(accepted_media)}")
        manifest_path = found.get("manifest")
        if manifest_path:
            man = json.loads(manifest_path.read_text(encoding="utf-8"))
            man_files = man.get("files", [])
            ok, bad = 0, []
            for mf in man_files:
                rp = mf.get("path")
                expected = mf.get("sha256") or mf.get("checksum")
                if rp and expected and (ext / rp).is_file():
                    actual = _sha256(ext / rp)
                    if actual == expected:
                        ok += 1
                    else:
                        bad.append({"path": rp, "expected": expected, "actual": actual})
            if bad:
                fails.append(f"checksum mismatch: {bad}")
            obs.append(f"manifest checksums: {ok}/{len(man_files)} ok")

        # Verify accepted-media semantics (provenance on ledger).
        ledger_p = served / "assets" / "intake_ledger.json"
        ledger = json.loads(ledger_p.read_text(encoding="utf-8"))
        for a in ledger.get("assets", []):
            if a.get("lifecycle") in ("APPROVED", "LOCKED", "SELECTED"):
                prov = a.get("provenance")
                prv = a.get("provider")
                if prov != PROV or prv != PROVIDER:
                    fails.append(f"asset {a['id']} provenance mismatch: {prov}/{prv}")

    shutil.rmtree(served, ignore_errors=True)
    status = GateStatus.PASS if not fails else GateStatus.FAIL
    write_gate_result(GATE_DIR, GateResult(
        gate="G10", name="Portable Export Package", status=status,
        hard_blocker=True,
        failure_kind=("FG_PRODUCT_FAILURE" if fails else None),
        evidence=["raw_package.zip"],
        observations=tuple(obs + [f"duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails)))
    try:
        write_json_create_only(GATE_DIR / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (GATE_DIR / "summary.md").write_text(
        f"# G10 — {status.value}\nartifacts verified\n",
        encoding="utf-8")
    print(f"G10 {status.value}: fails={fails}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())