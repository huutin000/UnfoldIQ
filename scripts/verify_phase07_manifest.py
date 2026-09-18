"""Phase 7 verification: reference fidelity + scale timings (evidence only).
Usage: python scripts/verify_phase07_manifest.py
"""
import json
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio.timeline_compiler import compile_manifest_preview

REF = Path("projects/2026-09-12_210003_youtube-narration-01")
OUT = Path("temp/phase07_verification/manifest")
OUT.mkdir(parents=True, exist_ok=True)


def _synth(root: Path, n_scenes: int, shots_per_scene: int) -> int:
    root.mkdir(parents=True, exist_ok=True)
    (root / "assets").mkdir(exist_ok=True)
    scenes, shots, ledger, sid = [], [], [], 0
    for a in range(n_scenes):
        scenes.append({"scene_id": f"sc_{a:03d}", "index": a + 1})
        for b in range(shots_per_scene):
            sid += 1
            shot_id = f"sh_{sid:04d}"
            shots.append({"shot_id": shot_id, "scene_id": f"sc_{a:03d}",
                          "start": float((sid - 1) * 2), "end": float(sid * 2),
                          "duration": 2.0, "index": b + 1})
            (root / "assets" / f"{shot_id}.png").write_bytes(b"\x89PNG" + b"\x00" * 64)
            ledger.append({"id": f"ASSET-{shot_id}", "scene_id": f"sc_{a:03d}",
                           "shot_id": shot_id, "lifecycle": "LOCKED",
                           "checksum": "cd" * 32, "version": 1,
                           "filePath": f"assets/{shot_id}.png"})
    total = float(sid * 2)
    with wave.open(str(root / "audio.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00" * int(48000 * total) * 2 * 2)
    (root / "scene_plan.json").write_text(json.dumps({"scenes": scenes}))
    (root / "veo_prompts.json").write_text(json.dumps({"shots": shots}))
    (root / "timestamps.json").write_text(json.dumps({"audio_duration": total}))
    (root / "assets" / "intake_ledger.json").write_text(json.dumps({"assets": ledger}))
    return sid


def _timed(fn):
    t0 = time.perf_counter()
    out = fn()
    return out, round((time.perf_counter() - t0) * 1000, 1)


def main():
    rec: dict = {}
    r, ms = _timed(lambda: compile_manifest_preview(REF))
    rec["reference"] = {
        "sceneCount": len(r.manifest.scenes),
        "shotCount": len(r.manifest.videoTrack.clips),
        "valid": r.validation.valid,
        "blockers": [i.code for i in r.validation.blockers[:5]],
        "manifestHash": r.manifest.manifestHash,
        "compileMs": ms,
    }
    print("reference:", json.dumps(rec["reference"]), flush=True)
    rec["scale"] = {}
    import tempfile
    with tempfile.TemporaryDirectory(prefix="p7verify_") as tmp:
        for label, ns, sps in (("1", 1, 1), ("250", 25, 10), ("500", 50, 10)):
            p = Path(tmp) / f"s{label}"
            n = _synth(p, ns, sps)
            rr, msm = _timed(lambda p=p: compile_manifest_preview(p))
            rec["scale"][label] = {"shots": n, "compileMs": msm,
                                   "valid": rr.validation.valid,
                                   "hash": (rr.manifest.manifestHash or "")[:16]}
            print(label, json.dumps(rec["scale"][label]), flush=True)
    (OUT / "verification.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
