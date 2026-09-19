"""Deterministic validation-media provisioning (Task 3, validation-only).

All media created here carries ``provenance = VALIDATION_FIXTURE`` and
``provider = LOCAL_VALIDATION``. Never touches the canonical source project
or the frozen baseline — callers must pass an isolated working copy with
``is_baseline=False``.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

PROVENANCE = "VALIDATION_FIXTURE"
PROVIDER = "LOCAL_VALIDATION"


def _ffmpeg() -> str:
    try:  # prefer configured binary, fall back to PATH
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from studio.config import AppConfig  # type: ignore
        cfg = AppConfig.load() if hasattr(AppConfig, "load") else AppConfig()
        cand = getattr(cfg, "ffmpeg_path", "") or ""
        if cand and Path(cand).is_file():
            return cand
    except Exception:
        pass
    return "ffmpeg"


def generate_validation_frame(out_path: Path) -> Path:
    """Deterministic 1920x1080 still via local lavfi (no network/provider)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        _ffmpeg(), "-y", "-hide_banner", "-nostdin",
        "-f", "lavfi", "-i", "color=c=0x2E3440:s=1920x1080:d=1:r=24",
        "-frames:v", "1", str(out_path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not out_path.is_file():
        raise RuntimeError(f"frame generation failed: {r.stderr[-2000:]}")
    return out_path


def provision_shot_media(project_dir, frame_src, shots,
                         is_baseline: bool = False) -> list[dict]:
    """Intake + APPROVE one asset per shot on a working copy only.

    Uses the canonical Phase 4 writer (``AssetIntakeService``); no competing
    schema. Stamps honest provenance on the working-copy ledger entry.
    """
    if is_baseline:
        raise ValueError("fixture provisioning refuses the canonical baseline")
    project_dir = Path(project_dir)
    frame_src = Path(frame_src)
    if not frame_src.is_file():
        raise FileNotFoundError(f"frame not found: {frame_src}")

    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from studio.asset_intake import AssetIntakeService

    svc = AssetIntakeService()
    done: list[dict] = []
    for s in shots:
        entry = svc.intake_asset(
            project_dir, frame_src,
            scene_id=str(s["scene_id"]), shot_id=str(s["shot_id"]),
            provider=PROVIDER, select_immediately=True,
        )
        if entry.get("lifecycle") == "REJECTED":
            raise RuntimeError(
                f"fixture QC rejected for shot {s['shot_id']}: "
                f"{entry.get('qcReason')}")
        svc.update_asset_lifecycle(project_dir, entry["id"], "APPROVED")
        ledger_p = project_dir / "assets" / "intake_ledger.json"
        ledger = json.loads(ledger_p.read_text(encoding="utf-8"))
        for a in ledger.get("assets", []):
            if a.get("id") == entry["id"]:
                a["provider"] = PROVIDER
                a["provenance"] = PROVENANCE
        ledger_p.write_text(json.dumps(ledger, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        entry["provider"] = PROVIDER
        entry["provenance"] = PROVENANCE
        entry["lifecycle"] = "APPROVED"
        done.append(entry)
    return done
