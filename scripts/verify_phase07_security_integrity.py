"""Task 10 evidence: security battery, preview side-effects, persistence
isolation, secrets/absolute-path scan. Evidence only (temp/phase07_verification).
Usage: python scripts/verify_phase07_security_integrity.py
"""
import hashlib
import json
import shutil
import sys
import tempfile
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio.render_manifest import RenderClip, RenderManifest, VideoTrack
from studio.render_manifest_validation import validate_render_manifest
from studio.timeline_compiler import (
    RenderManifestConflictError,
    compile_manifest_preview,
    compile_render_manifest,
)

SEC = Path("temp/phase07_verification/security")
INT = Path("temp/phase07_verification/integrity")
SEC.mkdir(parents=True, exist_ok=True)
INT.mkdir(parents=True, exist_ok=True)
REF = Path("projects/2026-09-12_210003_youtube-narration-01")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _wav(p: Path, seconds=4.0):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00" * int(48000 * seconds) * 2 * 2)


def _clip(**over):
    base = dict(clipId="c1", sceneId="s1", shotId="sh1", sequenceIndex=1,
                startFrame=0, durationFrames=96, endFrame=96,
                timelineStartSeconds=0.0, durationSeconds=4.0,
                assetId="a1", acceptedAssetVersion=1, checksum="ab" * 32,
                filePath="assets/x.png", mediaType="IMAGE")
    base.update(over)
    return RenderClip(**base)


def security_battery(tmp: Path):
    d = tmp / "sec"
    (d / "assets").mkdir(parents=True)
    (d / "assets" / "x.png").write_bytes(b"\x89PNG" + b"\x00" * 32)
    _wav(d / "audio.wav", 4.0)
    cases = {
        "traversal": "../secret.txt",
        "abs_drive": "C:\\evil.png",
        "unc": "\\\\server\\x.png",
        "missing": "assets/gone.png",
        "bad_ext": "assets/x.bmp",
    }
    (d / "assets" / "x.bmp").write_bytes(b"BM" + b"\x00" * 32)
    rec = {}
    for name, path in cases.items():
        m = RenderManifest(projectId="sec", videoTrack=VideoTrack(clips=[_clip(filePath=path)]))
        m.voiceTrack.filePath = "audio.wav"
        m.voiceTrack.durationFrames = 96
        r = validate_render_manifest(m, project_dir=d)
        rec[name] = {"valid": r.valid, "codes": sorted({i.code for i in r.blockers})}
        assert r.valid is False, name
        assert not (d / "exports").exists(), "no manifest may be created"
    # checksum mismatch + unapproved via registry authority
    (d / "assets" / "intake_ledger.json").write_text(json.dumps({"assets": [
        {"id": "a1", "lifecycle": "LOCKED", "checksum": "ff" * 32,
         "version": 1, "filePath": "assets/x.png"}]}))
    m = RenderManifest(projectId="sec", videoTrack=VideoTrack(clips=[_clip()]))
    m.voiceTrack.filePath = "audio.wav"
    m.voiceTrack.durationFrames = 96
    r = validate_render_manifest(m, project_dir=d)
    rec["checksum_mismatch"] = {"valid": r.valid,
                                "codes": sorted({i.code for i in r.blockers})}
    assert any(i.code == "ACCEPTED_ASSET_INTEGRITY" for i in r.blockers)
    (SEC / "security_cases.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
    print("security:", json.dumps(rec), flush=True)


def preview_side_effects():
    watched = ["scene_plan.json", "timestamps.json", "audio.wav",
               "assets/intake_ledger.json", "visual_bible.json", "state.db"]
    before = {f: (sha(REF / f), (REF / f).stat().st_mtime_ns) for f in watched}
    exports_before = sorted(x.name for x in (REF / "exports").iterdir())
    hashes = []
    for _ in range(3):
        r = compile_manifest_preview(REF)
        hashes.append(r.manifest.manifestHash)
    after = {f: (sha(REF / f), (REF / f).stat().st_mtime_ns) for f in watched}
    exports_after = sorted(x.name for x in (REF / "exports").iterdir())
    rec = {"identical_hashes": len(set(hashes)) == 1,
           "files_unchanged": before == after,
           "exports_unchanged": exports_before == exports_after,
           "runs": 3}
    assert rec["identical_hashes"] and rec["files_unchanged"] and rec["exports_unchanged"]
    (INT / "preview_side_effects.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
    print("preview side-effects:", json.dumps(rec), flush=True)


def persistence_isolation(tmp: Path):
    src = tmp / "copy"
    shutil.copytree(REF, src, ignore=shutil.ignore_patterns("render_cache", "exports"))
    before_ref = {p.name: sha(p) for p in REF.iterdir() if p.is_file()}
    try:
        r = compile_manifest_preview(src)
        assert r.validation.valid is False  # REF has no accepted media: blocked
        assert not (src / "exports").exists()
        # synthetic valid project persists in isolation
        d = tmp / "iso"
        (d / "assets").mkdir(parents=True)
        (d / "assets" / "s.png").write_bytes(b"\x89PNG" + b"\x00" * 32)
        _wav(d / "audio.wav", 2.0)
        (d / "scene_plan.json").write_text(json.dumps({"scenes": [{"scene_id": "s", "index": 1}]}))
        (d / "veo_prompts.json").write_text(json.dumps({"shots": [
            {"shot_id": "sh", "scene_id": "s", "start": 0.0, "end": 2.0,
             "duration": 2.0, "index": 1}]}))
        (d / "timestamps.json").write_text(json.dumps({"audio_duration": 2.0}))
        (d / "assets" / "intake_ledger.json").write_text(json.dumps({"assets": [
            {"id": "A", "shot_id": "sh", "lifecycle": "LOCKED",
             "checksum": "ab" * 32, "version": 1, "filePath": "assets/s.png"}]}))
        p1 = compile_render_manifest(d, "export_001")
        assert p1.persisted is True
        text = (d / "exports/export_001/render-manifest.json").read_text(encoding="utf-8")
        bad = [t for t in ("D:\\", "C:\\", "\\\\server", "api_key", "token",
                           "secret", "password") if t.lower() in text.lower()]
        assert not bad, bad
        try:
            compile_render_manifest(d, "../evil")
            raise SystemExit("traversal accepted!")
        except ValueError:
            pass
        rec = {"ref_copy_blocked": True, "isolated_persisted": True,
               "no_secrets_or_abs_paths": True, "traversal_rejected": True}
    finally:
        shutil.rmtree(src, ignore_errors=True)
    after_ref = {p.name: sha(p) for p in REF.iterdir() if p.is_file()}
    rec["reference_unchanged"] = before_ref == after_ref
    assert rec["reference_unchanged"]
    (INT / "persistence_isolation.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
    print("isolation:", json.dumps(rec), flush=True)


def main():
    with tempfile.TemporaryDirectory(prefix="p7sec_") as tmp:
        security_battery(Path(tmp))
        preview_side_effects()
        persistence_isolation(Path(tmp))
    print("Task 10 evidence complete.", flush=True)


if __name__ == "__main__":
    main()
