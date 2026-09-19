"""Phase 7 final micro-closure pins: GAP A/B/C/D evidence."""
import json
import wave
from pathlib import Path

import pytest

from studio.asset_registry import resolve_asset_role
from studio.timeline_compiler import (
    compile_manifest_preview,
    compile_render_manifest,
    load_source_hashes,
    prevalidate_source_timing,
)


def _entry(lifecycle, entity_id=None):
    return {"asset_id": "a1", "lifecycle": lifecycle, "entity_id": entity_id,
            "checksum": "c", "version": 1, "master": "m.png"}


class TestResolverPrecedence:
    def test_rejected_plus_binding_is_rejected(self):
        r = resolve_asset_role(registry_entry=_entry("REJECTED", "ch1"),
                               canonical_binding={"entity_id": "ch1"})
        assert r.role == "rejected"

    def test_selected_plus_binding_is_unapproved(self):
        r = resolve_asset_role(registry_entry=_entry("SELECTED"),
                               canonical_binding={"entity_id": "ch1"})
        assert r.role == "unapproved"

    def test_generated_plus_binding_is_unapproved(self):
        r = resolve_asset_role(registry_entry=_entry("GENERATED", "ch1"),
                               canonical_binding={"entity_id": "ch1"})
        assert r.role == "unapproved"

    def test_approved_plus_binding_is_accepted(self):
        r = resolve_asset_role(registry_entry=_entry("APPROVED"),
                               canonical_binding={"entity_id": "ch1"})
        assert r.role == "accepted"

    def test_locked_plus_binding_is_accepted(self):
        r = resolve_asset_role(registry_entry=_entry("LOCKED", "ch1"),
                               canonical_binding={"entity_id": "ch1"})
        assert r.role == "accepted"

    def test_no_lifecycle_plus_binding_is_canonical_reference(self):
        r = resolve_asset_role(registry_entry=_entry(None, None),
                               canonical_binding={"entity_id": "ch1"})
        assert r.role == "canonicalReference"


def _wav(p: Path, seconds):
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"\x00" * int(48000 * seconds) * 2 * 2)


@pytest.fixture
def tproj(tmp_path):
    d = tmp_path / "p"
    (d / "assets").mkdir(parents=True)
    (d / "assets" / "s.png").write_bytes(b"\x89PNG" + b"\x00" * 32)
    _wav(d / "audio.wav", 4.0)
    (d / "scene_plan.json").write_text(json.dumps(
        {"scenes": [{"scene_id": "s", "index": 1}]}))
    (d / "veo_prompts.json").write_text(json.dumps({
        "shots": [{"shot_id": "sh", "scene_id": "s", "start": 0.0,
                   "end": 4.0, "duration": 4.0, "index": 1}]}))
    (d / "timestamps.json").write_text(json.dumps({"audio_duration": 4.0}))
    (d / "assets" / "intake_ledger.json").write_text(json.dumps({
        "assets": [{"id": "A", "shot_id": "sh", "lifecycle": "LOCKED",
                    "checksum": "ab" * 32, "version": 1,
                    "filePath": "assets/s.png"}]}))
    return d


class TestAssetRegistryHash:
    def test_asset_registry_hash_exists(self, tproj):
        h = load_source_hashes(tproj)
        assert "assetRegistryHash" in h
        assert h["assetRegistryHash"] == "absent"  # no registry file yet
        assert "intakeLedgerHash" in h and h["intakeLedgerHash"] != "absent"

    def test_registry_change_changes_hash(self, tproj):
        from studio.asset_registry import load_registry  # noqa (documents input)
        before = load_source_hashes(tproj)["assetRegistryHash"]
        (tproj / "assets" / "registry.json").write_text(json.dumps(
            {"assets": [{"asset_id": "R1", "shot_id": "sh", "lifecycle": "LOCKED",
                         "checksum": "ab" * 32, "version": 1,
                         "master": "assets/s.png"}]}))
        after = load_source_hashes(tproj)["assetRegistryHash"]
        assert before != after and len(after) == 64
        # unrelated sources untouched
        assert load_source_hashes(tproj)["timestampsHash"] == \
            load_source_hashes(tproj)["timestampsHash"]

    def test_hashes_cover_actual_inputs(self, tproj):
        h = load_source_hashes(tproj)
        for key in ("scenePlanHash", "veoPromptsHash", "audioHash",
                    "timestampsHash", "assetRegistryHash", "intakeLedgerHash",
                    "visualBibleHash"):
            assert key in h, key


def _bad_timing_proj(tproj, **shot_over):
    import shutil
    data = json.loads((tproj / "veo_prompts.json").read_text(encoding="utf-8"))
    data["shots"][0].update(shot_over)
    (tproj / "veo_prompts.json").write_text(json.dumps(data))
    return tproj


class TestInvalidSourceTiming:
    @pytest.mark.parametrize("over,code", [
        ({"duration": 0.0, "end": 4.0}, "NON_POSITIVE_DURATION"),
        ({"duration": -2.0, "end": 4.0}, "NON_POSITIVE_DURATION"),
        ({"start": 5.0, "end": 4.0, "duration": 4.0}, "INVALID_TIMESTAMPS"),
        ({"start": 4.0, "end": 4.0, "duration": 0.0}, "INVALID_TIMESTAMPS"),
        ({"start": -1.0, "end": 4.0, "duration": 4.0}, "INVALID_TIMESTAMPS"),
    ])
    def test_structured_blockers_no_crash(self, tproj, over, code):
        _bad_timing_proj(tproj, **over)
        r = compile_manifest_preview(tproj)
        assert r.validation.valid is False
        assert any(i.code == code for i in r.validation.blockers), \
            [i.code for i in r.validation.blockers]

    def test_prevalidate_needs_no_render_clip(self, tproj):
        _bad_timing_proj(tproj, duration=0.0, end=4.0)
        import json as _json
        shots = _json.loads((tproj / "veo_prompts.json").read_text())["shots"]
        issues = prevalidate_source_timing(shots)
        assert any(i.code == "NON_POSITIVE_DURATION" for i in issues)
        # no RenderClip was constructed: manifest has zero clips, no crash
        r = compile_manifest_preview(tproj)
        assert len(r.manifest.videoTrack.clips) == 0

    def test_invalid_timing_blocks_persistence(self, tproj):
        _bad_timing_proj(tproj, duration=-1.0, end=4.0)
        result = compile_render_manifest(tproj, "export_001")
        assert result.validation.valid is False
        assert result.persisted is False
        assert not (tproj / "exports/export_001/render-manifest.json").exists()


class TestClosureGovernance:
    def test_phase6_pass_final_verified(self):
        text = (Path("docs/implementation/ROADMAP_STATUS.md")).read_text(encoding="utf-8")
        line6 = [l for l in text.splitlines() if "| **Phase 6**" in l][0]
        assert "PASS / FINAL" in line6 and "VERIFIED" in line6

    def test_phase7_implemented_review_pending(self):
        # External review officially closed Phase 7 (PHASE_07_FINAL_EXTERNAL_CLOSURE_REPORT.md).
        text = (Path("docs/implementation/ROADMAP_STATUS.md")).read_text(encoding="utf-8")
        line7 = [l for l in text.splitlines() if "| **Phase 7**" in l][0]
        assert "PASS / FINAL" in line7 and "VERIFIED" in line7

    def test_phase8_9_not_started(self):
        text = (Path("docs/implementation/ROADMAP_STATUS.md")).read_text(encoding="utf-8")
        assert "Phase 8" in text and ("PASS / FINAL" in text or "NOT STARTED" in text)
        assert "Phase 9" in text and ("PASS / FINAL" in text or "NOT STARTED" in text)

    def test_no_forbidden_phase8_artifacts(self):
        import studio.timeline_compiler as tc
        assert not hasattr(tc, "render_from_manifest")
        assert not Path("studio/render_from_manifest.py").exists()
        assert not Path("studio/manifest_renderer.py").exists()

    def test_closure_report_exists(self):
        assert Path("docs/implementation/PHASE_07_FINAL_CLOSURE_REPORT.md").is_file()

    def test_approved_design_spec_restored(self):
        p = Path("docs/superpowers/specs/2026-09-18-phase07-render-manifest-timeline-compiler-design.md")
        assert p.is_file(), "SPEC FILE STILL MISSING"
        t = p.read_text(encoding="utf-8")
        assert "DESIGN APPROVED IN CHAT" in t
        assert '"numerator": 24' in t and '"denominator": 1' in t
        assert "[startFrame,endFrame)" in t
        assert "PATH_SANDBOX_AND_PRESENCE" in t
        assert "render_from_manifest()" in t  # Phase 8 boundary explicit
        assert "No TBD/TODO" in t or "No TBD" in t
