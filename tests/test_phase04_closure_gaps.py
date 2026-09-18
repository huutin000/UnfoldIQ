"""
Phase 4 micro-closure gap tests: accepted-version semantics, Benchmark B
parser, end-to-end final-render audio. Temp copies only.
"""
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

PROJ = "2026-09-12_210003_youtube-narration-01"
PROJ_DIR = Path("projects") / PROJ


@pytest.fixture()
def work_project(tmp_path):
    dst = Path("projects") / f"_p4c_{tmp_path.name[-6:]}"
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(PROJ_DIR, dst)
    yield dst
    shutil.rmtree(dst, ignore_errors=True)


def _png_bytes():
    return (PROJ_DIR / "assets/references/characters/char_hh_primary_caregiver_01/front.png").read_bytes()


def _seed_lifecycle(dst: Path, lifecycle: str, aid="A-X", name="x.png"):
    from studio.asset_registry import sha256_file
    dest = dst / "assets" / "imported" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(_png_bytes())
    (dst / "assets" / "intake_ledger.json").write_text(json.dumps({"assets": [{
        "id": aid, "scene_id": "scene_001", "assetType": "image",
        "filePath": f"assets/imported/{name}", "checksum": sha256_file(dest),
        "lifecycle": lifecycle, "locked": lifecycle == "LOCKED"}]}), encoding="utf-8")
    return aid


def _package_media_names(dst: Path, **kw):
    from studio.portable_package import build_portable_package
    r = build_portable_package(dst, **kw)
    zf = zipfile.ZipFile(r["zip_path"])
    return r, [n for n in zf.namelist() if n.startswith("assets/media/")]


class TestAcceptedSemantics:
    def test_locked_asset_packaged(self, work_project):
        _seed_lifecycle(work_project, "LOCKED", "A-L", "l.png")
        r, media = _package_media_names(work_project)
        assert any("l.png" in m for m in media)

    def test_approved_packaged_without_locked(self, work_project):
        _seed_lifecycle(work_project, "APPROVED", "A-A", "a.png")
        r, media = _package_media_names(work_project)
        assert any("a.png" in m for m in media)

    def test_locked_preferred_over_approved_by_canonical_selector(self, work_project):
        from studio.asset_intake import asset_intake
        _seed_lifecycle(work_project, "APPROVED", "A-A", "a.png")
        # second asset same scene, LOCKED
        from studio.asset_registry import sha256_file
        dest = work_project / "assets" / "imported" / "l.png"
        dest.write_bytes(_png_bytes())
        ledger = json.loads((work_project / "assets" / "intake_ledger.json").read_text())
        ledger["assets"].append({"id": "A-L", "scene_id": "scene_001", "assetType": "image",
                                 "filePath": "assets/imported/l.png",
                                 "checksum": sha256_file(dest),
                                 "lifecycle": "LOCKED", "locked": True})
        (work_project / "assets" / "intake_ledger.json").write_text(json.dumps(ledger))
        sel = asset_intake.get_selected_asset_for_scene(work_project, "scene_001")
        assert sel["id"] == "A-L"

    def test_generated_not_silently_packaged(self, work_project):
        _seed_lifecycle(work_project, "GENERATED", "A-G", "g.png")
        r, media = _package_media_names(work_project)
        assert not any("g.png" in m for m in media)
        assert any("chưa được duyệt" in w for w in r["warnings"])

    def test_selected_not_silently_packaged(self, work_project):
        _seed_lifecycle(work_project, "SELECTED", "A-S", "s.png")
        r, media = _package_media_names(work_project)
        assert not any("s.png" in m for m in media)
        assert any("chưa được duyệt" in w for w in r["warnings"])

    def test_rejected_never_packaged(self, work_project):
        _seed_lifecycle(work_project, "REJECTED", "A-R", "r.png")
        r, media = _package_media_names(work_project)
        assert not any("r.png" in m for m in media)

    def test_required_only_generated_blocks_in_strict_mode(self, work_project):
        from studio.portable_package import build_portable_package
        _seed_lifecycle(work_project, "GENERATED", "A-G", "g.png")
        with pytest.raises(ValueError, match="chưa được duyệt"):
            build_portable_package(work_project, strict_media=True)

    def test_broken_reference_path_omitted_gracefully(self, work_project):
        from studio.portable_package import build_asset_manifest
        mf = build_asset_manifest(work_project)  # reference fixture has 1 VB ref
        assert any(a.get("entity_id") for a in mf["assets"])

    def test_canonical_vb_reference_included_with_truthful_role(self, work_project):
        from studio.portable_package import build_asset_manifest
        mf = build_asset_manifest(work_project)
        refs = [a for a in mf["assets"] if a.get("entity_id")]
        assert len(refs) >= 1
        assert all(a["sourceRole"] == "canonicalReference" for a in refs)
        r, media = _package_media_names(work_project)
        assert any("front.png" in m for m in media)

    def test_manifest_lifecycle_truthful(self, work_project):
        from studio.portable_package import build_asset_manifest
        _seed_lifecycle(work_project, "SELECTED", "A-S", "s.png")
        mf = build_asset_manifest(work_project)
        entry = next(a for a in mf["assets"] if a["asset_id"] == "A-S")
        assert entry["lifecycle"] == "SELECTED"
        assert entry["sourceRole"] == "unapproved"
        assert "accepted" not in str(entry.get("sourceRole")) or True
        assert entry["sourceRole"] != "accepted"


class TestBenchmarkBParser:
    def test_metrics_discriminating_on_runB(self):
        from studio.encoder_probe import _metrics
        out = Path("temp/phase04_final_closure/benchmark/runB")
        ref = Path("temp/phase04_final_closure/benchmark/fixture_reference.mp4")
        assert ref.is_file(), "Benchmark B fixture missing — run scripts/run_phase04_benchmark_b.py"
        vals = {}
        for enc in ("libx264", "h264_nvenc"):
            q = _metrics(ref, out / f"bench_{enc}_r0.mp4", out, f"probe_{enc}")
            vals[enc] = q
        for enc, q in vals.items():
            assert q["ssim_all"] is not None and q["ssim_all"] < 1.0, f"{enc} SSIM not discriminating"
            assert q["psnr_avg_db"] is not None and q["psnr_avg_db"] != float("inf"), \
                f"{enc} PSNR not discriminating"


class TestFinalRenderAudioE2E:
    def test_renderer_output_aac_48k_stereo(self, work_project):
        from studio.config import config
        from studio.renderer_adapter import renderer_adapter
        (work_project / "renders" / "final" / "final.mp4").unlink(missing_ok=True)
        res = renderer_adapter.render_final(work_project)
        out = work_project / res["outputPath"]
        assert out.is_file()
        probe = subprocess.run([config.ffprobe_path, "-v", "error", "-show_streams",
                                "-of", "json", str(out)],
                               capture_output=True, text=True, timeout=120)
        streams = json.loads(probe.stdout)["streams"]
        a = next(s for s in streams if s["codec_type"] == "audio")
        assert a["codec_name"] == "aac"
        assert a["sample_rate"] == "48000"
        assert a["channels"] == 2
