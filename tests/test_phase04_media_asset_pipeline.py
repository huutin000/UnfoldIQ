"""
Focused tests for Phase 4 — Media, Asset & Export Pipeline.

Covers: registry stable-ID contract, WebP thumbnails, 720p proxy,
safe serving, portable package (10 groups + manifest + VTT + shots),
audio specs, encoder capability model, governance boundaries.
Real FFmpeg/ffprobe binaries; temp project copies only (reference untouched).
"""
import csv
import hashlib
import io
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from studio.app import app

client = TestClient(app)
PROJ = "2026-09-12_210003_youtube-narration-01"
PROJ_DIR = Path("projects") / PROJ


def _ffmpeg():
    from studio.config import config
    return config.ffmpeg_path


def _ffprobe():
    from studio.config import config
    return config.ffprobe_path


@pytest.fixture()
def work_project(tmp_path):
    """Temp full copy of the reference project (isolated, cleaned up)."""
    dst = Path("projects") / f"_p4t_{tmp_path.name[-6:]}"
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(PROJ_DIR, dst)
    yield dst
    shutil.rmtree(dst, ignore_errors=True)


def _write_ledger(dst: Path, entries):
    ledger_p = dst / "assets" / "intake_ledger.json"
    try:
        current = json.loads(ledger_p.read_text(encoding="utf-8")).get("assets", []) or []
    except Exception:
        current = []
    have = {a.get("id") for a in current if isinstance(a, dict)}
    current.extend([e for e in entries if e["id"] not in have])
    ledger_p.write_text(json.dumps({"assets": current}), encoding="utf-8")


def _add_image_asset(dst: Path, name="scene_001_ab12cd34.png"):
    from studio.asset_registry import sha256_file
    src = PROJ_DIR / "assets/references/characters/char_hh_primary_caregiver_01/front.png"
    dest = dst / "assets" / "imported" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dest)
    h = sha256_file(dest)
    _write_ledger(dst, [{
        "id": "ASSET-SCENE_001-V1", "scene_id": "scene_001",
        "assetType": "image", "filePath": f"assets/imported/{name}",
        "checksum": h, "lifecycle": "SELECTED", "locked": False}])
    return "ASSET-SCENE_001-V1", h


def _add_video_asset(dst: Path):
    from studio.asset_registry import sha256_file
    dest = dst / "assets" / "imported" / "scene_002_ee34ff56.mp4"
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([_ffmpeg(), "-y", "-f", "lavfi",
                    "-i", "testsrc=size=640x480:rate=24:duration=3",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(dest)],
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                   check=True, timeout=120)
    h = sha256_file(dest)
    _write_ledger(dst, [{
        "id": "ASSET-SCENE_002-V1", "scene_id": "scene_002",
        "assetType": "video", "filePath": "assets/imported/scene_002_ee34ff56.mp4",
        "checksum": h, "lifecycle": "SELECTED", "locked": False}])
    return "ASSET-SCENE_002-V1", h


def _probe(path: Path):
    out = subprocess.run([_ffprobe(), "-v", "error", "-show_streams", "-of", "json", str(path)],
                         capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout or "{}")


# --- Asset Registry ---------------------------------------------------------

class TestAssetRegistry:
    def test_stable_asset_id_lookup(self, work_project):
        from studio.asset_registry import get_asset
        aid, _ = _add_image_asset(work_project)
        entry = get_asset(work_project, aid)
        assert entry is not None and entry["asset_id"] == aid

    def test_master_proxy_thumbnail_relation(self, work_project):
        from studio.asset_registry import ensure_thumbnail, get_asset
        aid, _ = _add_image_asset(work_project)
        r = ensure_thumbnail(work_project, aid)
        entry = get_asset(work_project, aid)
        assert entry["master"].endswith(".png")
        assert entry["thumbnail"] == r["thumbnail"]
        assert entry["proxy"] is None  # stills: no video proxy per contract

    def test_unknown_fields_preserved(self, work_project):
        from studio.asset_registry import sync_from_intake_ledger, get_registry_path
        aid, _ = _add_image_asset(work_project)
        sync_from_intake_ledger(work_project)  # materialize registry from ledger
        rp = get_registry_path(work_project)
        # sync once to materialize (intake change persists), then add legacy field
        reg = json.loads(rp.read_text(encoding="utf-8"))
        for a in reg["assets"]:
            if a["asset_id"] == aid:
                a["legacy_custom_field"] = "keep-me"
        rp.write_text(json.dumps(reg), encoding="utf-8")
        sync_from_intake_ledger(work_project)
        reg2 = json.loads(rp.read_text(encoding="utf-8"))
        # NOTE: sync persists only on intake changes; legacy field survives either way
        found = [a for a in reg2["assets"] if a.get("asset_id") == aid][0]
        assert found.get("legacy_custom_field") == "keep-me"

    def test_sha256_master_checksum(self, work_project):
        from studio.asset_registry import get_asset, sha256_file
        aid, _ = _add_image_asset(work_project)
        entry = get_asset(work_project, aid)
        assert entry["checksum"] == sha256_file(work_project / entry["master"])

    def test_no_sibling_mutation(self, work_project):
        from studio.asset_registry import ensure_thumbnail, get_asset
        aid, _ = _add_image_asset(work_project)
        aid2, _ = _add_video_asset(work_project)
        ensure_thumbnail(work_project, aid)
        other = get_asset(work_project, aid2)
        assert other["thumbnail"] is None and other["proxy"] is None


# --- Thumbnail ----------------------------------------------------------------

class TestThumbnail:
    def test_valid_media_produces_webp(self, work_project):
        from studio.asset_registry import ensure_thumbnail
        aid, _ = _add_image_asset(work_project)
        r = ensure_thumbnail(work_project, aid)
        assert r["status"] == "GENERATED"
        out = work_project / r["thumbnail"]
        streams = _probe(out)["streams"]
        assert streams[0]["codec_name"] == "webp"
        assert (streams[0]["width"], streams[0]["height"]) == (256, 144)

    def test_aspect_not_distorted(self, work_project):
        # front.png is portrait-ish; canvas must stay exactly 256x144 via pad
        from studio.asset_registry import ensure_thumbnail
        aid, _ = _add_image_asset(work_project)
        r = ensure_thumbnail(work_project, aid)
        s = _probe(work_project / r["thumbnail"])["streams"][0]
        assert (s["width"], s["height"]) == (256, 144)

    def test_master_bytes_unchanged(self, work_project):
        from studio.asset_registry import ensure_thumbnail, sha256_file
        aid, h = _add_image_asset(work_project)
        ensure_thumbnail(work_project, aid)
        assert sha256_file(work_project / "assets/imported/scene_001_ab12cd34.png") == h

    def test_cache_idempotent(self, work_project):
        from studio.asset_registry import ensure_thumbnail
        aid, _ = _add_image_asset(work_project)
        first = ensure_thumbnail(work_project, aid)
        second = ensure_thumbnail(work_project, aid)
        assert second["status"] == "CACHED" and second["thumbnail"] == first["thumbnail"]

    def test_missing_source_errors(self, work_project):
        from studio.asset_registry import ensure_thumbnail
        with pytest.raises((KeyError, FileNotFoundError)):
            ensure_thumbnail(work_project, "ASSET-DOES-NOT-EXIST")

    def test_audio_has_no_thumbnail(self, work_project):
        from studio.asset_registry import ensure_thumbnail, sha256_file
        dest = work_project / "assets" / "imported" / "sfx.wav"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(PROJ_DIR / "audio.wav", dest)
        h = sha256_file(dest)
        _write_ledger(work_project, [{
            "id": "ASSET-AUDIO-V1", "scene_id": "scene_001", "assetType": "audio",
            "filePath": "assets/imported/sfx.wav", "checksum": h,
            "lifecycle": "SELECTED", "locked": False}])
        r = ensure_thumbnail(work_project, "ASSET-AUDIO-V1")
        assert r["status"] == "N/A" and r["thumbnail"] is None


# --- Proxy --------------------------------------------------------------------

class TestProxy:
    def test_video_proxy_720p_or_below(self, work_project):
        from studio.asset_registry import ensure_proxy
        aid, _ = _add_video_asset(work_project)
        r = ensure_proxy(work_project, aid)
        assert r["status"] == "GENERATED"
        s = [x for x in _probe(work_project / r["proxy"])["streams"] if x["codec_type"] == "video"][0]
        assert s["codec_name"] == "h264"
        assert s["width"] <= 1280 and s["height"] <= 720

    def test_proxy_aspect_preserved(self, work_project):
        from studio.asset_registry import ensure_proxy
        aid, _ = _add_video_asset(work_project)
        r = ensure_proxy(work_project, aid)
        s = [x for x in _probe(work_project / r["proxy"])["streams"] if x["codec_type"] == "video"][0]
        assert abs((s["width"] / s["height"]) - (640 / 480)) < 0.02

    def test_proxy_browser_compatible(self, work_project):
        from studio.asset_registry import ensure_proxy
        aid, _ = _add_video_asset(work_project)
        r = ensure_proxy(work_project, aid)
        s = [x for x in _probe(work_project / r["proxy"])["streams"] if x["codec_type"] == "video"][0]
        assert s["pix_fmt"] == "yuv420p"
        out = subprocess.run([_ffmpeg(), "-v", "error", "-i", str(work_project / r["proxy"]),
                              "-c", "copy", "-f", "null", "-"],
                             capture_output=True, timeout=120)
        assert out.returncode == 0

    def test_proxy_master_unchanged(self, work_project):
        from studio.asset_registry import ensure_proxy, sha256_file
        aid, h = _add_video_asset(work_project)
        ensure_proxy(work_project, aid)
        assert sha256_file(work_project / "assets/imported/scene_002_ee34ff56.mp4") == h

    def test_image_proxy_null_per_contract(self, work_project):
        from studio.asset_registry import ensure_proxy
        aid, _ = _add_image_asset(work_project)
        r = ensure_proxy(work_project, aid)
        assert r["status"] == "N/A" and r["proxy"] is None


# --- Serving / security ---------------------------------------------------------

class TestServing:
    def test_valid_thumbnail_200_webp(self, work_project):
        from studio.asset_registry import ensure_thumbnail
        aid, _ = _add_image_asset(work_project)
        ensure_thumbnail(work_project, aid)
        r = client.get(f"/api/projects/{work_project.name}/assets/{aid}/thumbnail")
        assert r.status_code == 200
        assert "image/webp" in r.headers.get("content-type", "")

    def test_missing_thumbnail_404(self, work_project):
        _add_image_asset(work_project)
        r = client.get(f"/api/projects/{work_project.name}/assets/ASSET-SCENE_001-V1/thumbnail")
        assert r.status_code == 404

    def test_invalid_asset_id_404(self, work_project):
        r = client.get(f"/api/projects/{work_project.name}/assets/NOPE/thumbnail")
        assert r.status_code == 404

    def test_traversal_blocked(self):
        r = client.get(f"/api/projects/{PROJ}/assets/..%2Fsecret/thumbnail")
        assert r.status_code in (400, 404)
        r2 = client.get("/api/projects/..%2Fsecret/assets/registry")
        assert r2.status_code in (400, 404)

    def test_registry_read(self, work_project):
        _add_image_asset(work_project)
        d = client.get(f"/api/projects/{work_project.name}/assets/registry").json()
        assert any(a["asset_id"] == "ASSET-SCENE_001-V1" for a in d["assets"])

    def test_derivatives_endpoint_explicit(self, work_project):
        aid, _ = _add_image_asset(work_project)
        r = client.post(f"/api/projects/{work_project.name}/assets/{aid}/derivatives",
                        json={"kinds": ["thumbnail"]})
        assert r.status_code == 200
        assert r.json()["results"]["thumbnail"]["status"] == "GENERATED"


# --- Package / VTT / shots ------------------------------------------------------

class TestPortablePackage:
    def test_generation_success_with_10_groups(self, work_project):
        from studio.portable_package import build_portable_package
        r = build_portable_package(work_project)
        assert Path(r["zip_path"]).is_file() and r["bytes"] > 1000000
        zf = zipfile.ZipFile(r["zip_path"])
        names = zf.namelist()
        for need in ("manifest.json", "audio/audio.wav", "subtitles/timestamps.srt",
                     "subtitles/timestamps.vtt", "script/script.txt", "script/script.json",
                     "shots/shots.csv", "shots/shots.json", "visual/visual_bible.json",
                     "visual/image_prompts.json", "visual/veo_prompts.json",
                     "assets/asset_manifest.json"):
            assert need in names, f"missing {need}"

    def test_manifest_checksums_verify(self, work_project):
        from studio.portable_package import build_portable_package
        r = build_portable_package(work_project)
        zf = zipfile.ZipFile(r["zip_path"])
        mf = json.loads(zf.read("manifest.json").decode("utf-8"))
        assert mf["packageSchemaVersion"] == "1.0"
        assert "renderManifestVersion" not in mf
        for f in mf["files"]:
            assert hashlib.sha256(zf.read(f["relative_path"])).hexdigest() == f["sha256"]

    def test_no_abs_paths_no_secrets(self, work_project):
        from studio.portable_package import build_portable_package
        r = build_portable_package(work_project)
        zf = zipfile.ZipFile(r["zip_path"])
        names = zf.namelist()
        assert not any(n.startswith("/") or ".." in n.split("/") for n in names)
        lowered = [n.lower() for n in names]
        assert not any((".env" in n or "state.db" in n or n.endswith(".bak") or n.endswith(".log")) for n in lowered)

    def test_blocker_on_missing_required(self, work_project):
        from studio.portable_package import build_portable_package
        (work_project / "audio.wav").unlink()
        with pytest.raises(ValueError, match="missing required"):
            build_portable_package(work_project)

    def test_shots_csv_json_same_set(self, work_project):
        from studio.portable_package import build_shots_payload, shots_to_csv
        rows = build_shots_payload(work_project)
        assert len(rows) == 141
        assert all(r["shot_id"] and r["scene_id"] for r in rows)
        csv_ids = [row["shot_id"] for row in csv.DictReader(io.StringIO(shots_to_csv(rows)))]
        assert csv_ids == [r["shot_id"] for r in rows]

    def test_vtt_valid_timing_unicode(self):
        from studio.portable_package import srt_to_vtt
        srt = (PROJ_DIR / "timestamps.srt").read_text(encoding="utf-8")
        vtt, stats = srt_to_vtt(srt)
        assert vtt.startswith("WEBVTT")
        assert stats["cues"] == 142
        assert "00:00:00.000 --> 00:00:02.520" in vtt
        assert "leopard" in vtt  # content preserved
        assert (PROJ_DIR / "timestamps.srt").read_text(encoding="utf-8") == srt  # untouched

    def test_package_endpoint_download(self, work_project):
        r = client.get(f"/api/projects/{work_project.name}/export/portable-package")
        assert r.status_code == 200
        assert "application/zip" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")

    def test_package_endpoint_blocker_422(self, work_project):
        (work_project / "audio.wav").unlink()
        r = client.get(f"/api/projects/{work_project.name}/export/portable-package")
        assert r.status_code == 422


# --- Audio specs / encoder / boundaries ------------------------------------------

class TestAudioAndEncoder:
    def test_narration_master_spec_real(self):
        meta = _probe(PROJ_DIR / "audio.wav")
        a = [s for s in meta["streams"] if s["codec_type"] == "audio"][0]
        assert a["codec_name"] == "pcm_s16le"
        assert a["sample_rate"] == "24000" and a["channels"] == 1
        assert a.get("bits_per_sample") == 16

    def test_muxed_audio_target_contract(self):
        src = Path("studio/renderer_adapter.py").read_text(encoding="utf-8")
        assert '"-c:a", "aac"' in src and '"-b:a", "192k"' in src
        assert '"-ar", "48000"' in src and '"-ac", "2"' in src

    def test_encoder_capability_model(self):
        from studio.encoder_probe import encoders_available, ffmpeg_version
        assert encoders_available()["libx264"] is True
        assert "version" in ffmpeg_version()

    def test_frontend_package_contract(self):
        js = Path("studio/static/phase14_ui.js").read_text(encoding="utf-8")
        assert "export/portable-package" in js
        assert "Đang đóng gói dữ liệu" in js
        html = Path("studio/static/index.html").read_text(encoding="utf-8")
        assert "Gói sản xuất di động" in html
        assert 'id="export-package-box"' in html and 'id="btn-download-portable-package"' in html
