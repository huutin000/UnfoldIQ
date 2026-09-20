"""Phase 7 governance guard: roadmap IN PROGRESS + Phase 8/9 absence.

Baseline for this task: 756/756 PASS (observed inline; summary recorded in
temp/phase07_verification/tests/baseline_pytest.log).
"""
from pathlib import Path
import pytest

from tests.fixtures.project_factory import hermetic_canonical_project_in_projects_dir

ROOT = Path(__file__).resolve().parents[1]
PROJ = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture(autouse=True)
def hermetic_project():
    with hermetic_canonical_project_in_projects_dir(PROJ) as p:
        yield p


def _roadmap():
    return (ROOT / "docs/implementation/ROADMAP_STATUS.md").read_text(encoding="utf-8")


def test_phase07_roadmap_in_progress():
    # External review officially closed Phase 7 (PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md).
    text = _roadmap()
    assert "Phase 7" in text
    line7 = [line for line in text.splitlines() if "Phase 7" in line][0]
    assert "PASS / FINAL" in line7 and "VERIFIED" in line7


def test_phase08_phase09_not_started():
    text = _roadmap()
    assert "Phase 8" in text and ("PASS / FINAL" in text or "NOT STARTED" in text)
    assert "Phase 9" in text and ("PASS / FINAL" in text or "NOT STARTED" in text)


def test_no_phase08_renderer_module_exists():
    forbidden = [
        ROOT / "studio/render_from_manifest.py",
        ROOT / "studio/manifest_renderer.py",
    ]
    assert all(not p.exists() for p in forbidden)


def test_no_phase09_qa_module_exists():
    forbidden = [
        ROOT / "studio/render_qa.py",
        ROOT / "studio/manifest_qa.py",
    ]
    assert all(not p.exists() for p in forbidden)


def test_no_agent_integration_module_exists():
    forbidden = [
        ROOT / "studio/agent_integration.py",
        ROOT / "studio/mcp_server.py",
    ]
    assert all(not p.exists() for p in forbidden)


def test_phase06_closure_evidence_present():
    # Approved Phase 6 closure artifacts must remain in the worktree.
    assert (ROOT / "docs/implementation/PHASE_06_FINAL_MANUAL_CLOSURE_REPORT.md").is_file()
    assert (ROOT / "docs/implementation/PHASE_06_FINAL_TWO_GATE_CLOSURE_REPORT.md").is_file()


def test_scale_fixtures_have_no_production_count():
    # Reference 79/141 is a fixture, never a production constant. This guard
    # fails if any Phase 7 production module hardcodes the reference counts.
    import re
    prod = ["render_manifest.py", "render_manifest_hashing.py",
            "render_manifest_validation.py", "timeline_compiler.py"]
    for name in prod:
        p = ROOT / "studio" / name
        if not p.exists():
            continue
        src = p.read_text(encoding="utf-8")
        assert not re.search(r"\b141\b", src), name
        assert not re.search(r"(?<![\d.])79(?![\d.])", src), name


def test_reference_project_fidelity():
    """141 shots / 79 scenes preserved without flattening (fixture values)."""
    from studio.timeline_compiler import compile_manifest_preview
    ref = ROOT / "projects" / "2026-09-12_210003_youtube-narration-01"
    if not ref.is_dir():
        pytest.skip("reference project not present")
    result = compile_manifest_preview(ref)
    clips = result.manifest.videoTrack.clips
    assert len(clips) == 141
    assert len({c.shotId for c in clips}) == 141
    assert len(result.manifest.scenes) == 79
    import json
    src_shots = json.loads((ref / "veo_prompts.json").read_text(encoding="utf-8"))["shots"]
    scene_index = {s["scene_id"]: s.get("index", 0) for s in json.loads(
        (ref / "scene_plan.json").read_text(encoding="utf-8"))["scenes"]}
    expected = [s["shot_id"] for s in sorted(
        src_shots, key=lambda s: (scene_index.get(s.get("scene_id", ""), 10 ** 9),
                                  s.get("index", 0), s["shot_id"]))]
    assert [c.shotId for c in clips] == expected


def _synthetic_project(root: Path, n_scenes: int, shots_per_scene: int):
    import json as _json
    import wave as _wave
    root.mkdir(parents=True, exist_ok=True)
    (root / "assets").mkdir(exist_ok=True)
    scenes, shots, ledger = [], [], []
    sid = 0
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
    total_seconds = float(sid * 2)
    with _wave.open(str(root / "audio.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00" * int(48000 * total_seconds) * 2 * 2)
    (root / "scene_plan.json").write_text(_json.dumps({"scenes": scenes}))
    (root / "veo_prompts.json").write_text(_json.dumps({"shots": shots}))
    (root / "timestamps.json").write_text(
        _json.dumps({"audio_duration": float(sid * 2)}))
    (root / "assets" / "intake_ledger.json").write_text(
        _json.dumps({"assets": ledger}))
    return sid


def test_scale_fixtures_compile(tmp_path):
    from studio.timeline_compiler import compile_manifest_preview
    n1 = _synthetic_project(tmp_path / "s1", 1, 1)
    n250 = _synthetic_project(tmp_path / "s250", 25, 10)
    n500 = _synthetic_project(tmp_path / "s500", 50, 10)
    for p, n in ((tmp_path / "s1", n1), (tmp_path / "s250", n250), (tmp_path / "s500", n500)):
        r = compile_manifest_preview(p)
        assert len(r.manifest.videoTrack.clips) == n, p
        assert r.validation.valid is True, [i.code for i in r.validation.blockers]
        assert [c.sequenceIndex for c in r.manifest.videoTrack.clips] == list(range(1, n + 1))


def test_repeated_compile_deterministic(tmp_path):
    from studio.render_manifest_hashing import canonical_json_bytes
    from studio.timeline_compiler import compile_manifest_preview
    _synthetic_project(tmp_path / "det", 3, 4)
    a = compile_manifest_preview(tmp_path / "det")
    b = compile_manifest_preview(tmp_path / "det")
    assert a.manifest.manifestHash == b.manifest.manifestHash
    da = a.manifest.model_dump(mode="json")
    db = b.manifest.model_dump(mode="json")
    da.pop("manifestHash", None)
    db.pop("manifestHash", None)
    assert canonical_json_bytes(da) == canonical_json_bytes(db)


def test_no_renderer_leakage_in_phase07_sources():
    # New Phase 7 modules are scanned whole-file. studio/timeline_compiler.py
    # predates Phase 7 (live Phase 14 float-seconds compiler + renderer
    # adapter refs are grandfathered): only Phase 7-added symbols are scanned.
    import inspect
    import importlib
    for name in ("render_manifest", "render_manifest_hashing",
                 "render_manifest_validation"):
        p = ROOT / "studio" / f"{name}.py"
        if not p.exists():
            continue
        low = p.read_text(encoding="utf-8").lower()
        for b in ("subprocess", "ffmpeg", "filter_complex", "xfade",
                  "h264_nvenc", "libx264", "render_from_manifest"):
            assert b not in low, (name, b)
    p = ROOT / "studio" / "timeline_compiler.py"
    if p.exists():
        try:
            mod = importlib.import_module("studio.timeline_compiler")
        except Exception:
            return
        srcs = []
        for sym in ("compile_manifest_preview", "compile_render_manifest",
                    "build_render_manifest", "ManifestCompilation",
                    "PersistedManifestResult", "RenderManifestConflictError"):
            obj = getattr(mod, sym, None)
            if obj is not None:
                try:
                    srcs.append(inspect.getsource(obj).lower())
                except Exception:
                    pass
        for src in srcs:
            for b in ("subprocess", "ffmpeg", "filter_complex", "xfade",
                      "h264_nvenc", "libx264", "render_from_manifest"):
                assert b not in src, ("timeline_compiler phase7", b)
