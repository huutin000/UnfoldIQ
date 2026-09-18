"""
Phase 11 — Production Export / Flow Handoff unit tests (§60-63):

Export core, hash/snapshot semantics, multi-project isolation, path safety.

Offline: synthetic project fixtures under a temp projects root (PROJECTS_DIR
is monkeypatched). No GPU, no server.
"""

import csv
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import sys
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import studio.production_export as aspex
from studio.production_export import (
    ProductionExportError,
    execute_export,
    list_exports,
    preflight,
    production_status,
)
from studio.scene_planner import compute_file_sha256
from studio.veo_prompt_generator import compute_scene_hashes
from studio.visual_continuity import VISUAL_CONTINUITY_VERSION
from studio.veo_prompt_generator import CURRENT_GENERATOR_VERSION


PROMPT_TXT = ("Cinematography: wide framing, camera: slow pan right. "
              "Action: test subject moving slowly. Environment: test grassland, "
              "gentle wind. Lighting: warm daylight. Style: photorealistic documentary "
              "cinematography. Composition: 16:9 widescreen composition. "
              "Explicit constraints: no spoken dialogue, no voiceover, no captions, "
              "no subtitles, no text, no watermark.")


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def make_shot(shot_id, scene_id, sub_idx, start, end, **kw):
    d = {
        "shot_id": shot_id,
        "scene_id": scene_id,
        "parent_scene_id": scene_id,
        "parentSceneId": scene_id,
        "index": sub_idx,
        "scene_shot_index": sub_idx,
        "total_scene_shots": 1,
        "start": float(start),
        "end": float(end),
        "duration": round(float(end) - float(start), 3),
        "narration": f"Narration for {shot_id}.",
        "shotPurpose": "ESTABLISH",
        "continuity_group": "cg_001",
        "continuityGroupId": "cg_001",
        "subjectIds": ["subject_test_01"],
        "environmentId": "env_test_01",
        "periodId": "period_test_01",
        "propIds": ["prop_test_01"],
        "veo_prompt": PROMPT_TXT,
        "status": "generated",
        "outdated": False,
    }
    d.update(kw)
    return d


def make_scene(sid, idx, start, end):
    return {
        "scene_id": sid,
        "index": idx,
        "start": float(start),
        "end": float(end),
        "duration": round(float(end) - float(start), 3),
        "speech_start": float(start),
        "speech_end": float(end),
        "category": "reconstruction",
        "evidence_mode": "reconstruction",
        "shot_type": "wide",
        "camera_motion": "slow push-in",
        "continuity_group": "cg_001",
        "visual_summary": f"Visual summary for {sid}",
        "narration": f"Narration text for {sid}.",
        "image_prompt": f"Image prompt for {sid}",
    }


def build_valid_project(root: Path, name: str = "proj_valid",
                         audio_duration: float = 12.0, with_mp3: bool = False) -> Path:
    """Create a minimal canonical project that passes the export preflight gate."""
    p = root / name
    p.mkdir(parents=True, exist_ok=True)

    script = "Test narration script. Two sentences for export fixtures."
    _write(p / "script.txt", script)
    audio_bytes = b"RIFF" + bytes(2000) + b"WAVE-test-audio-bytes"
    _write_bytes(p / "audio.wav", audio_bytes)
    if with_mp3:
        _write_bytes(p / "audio.mp3", b"ID3-test-mp3-bytes")
    _write(p / "timestamps.srt",
           "1\n00:00:00,000 --> 00:00:06,000\nTest narration.\n")

    audio_hash = compute_file_sha256(p / "audio.wav")
    _write(p / "timestamps.json", json.dumps({
        "version": 1, "audio_file": "audio.wav", "audio_sha256": audio_hash,
        "audio_duration": audio_duration, "segments": [],
    }, indent=2))

    scenes = [make_scene("scene_001", 1, 0.0, 6.0),
              make_scene("scene_002", 2, 6.0, audio_duration)]
    ts_hash = compute_file_sha256(p / "timestamps.json")
    _write(p / "scene_plan.json", json.dumps({
        "version": "1.0", "project": name, "planner_version": "1.0",
        "source_script_sha256": compute_file_sha256(p / "script.txt"),
        "audio_sha256": audio_hash, "timestamps_sha256": ts_hash,
        "audio_duration": audio_duration, "scene_count": 2, "status": "ready",
        "scenes": scenes,
    }, indent=2, ensure_ascii=False))

    sp_hash = compute_file_sha256(p / "scene_plan.json")
    script_hash = compute_file_sha256(p / "script.txt")
    _write(p / "visual_bible.json", json.dumps({
        "schemaVersion": "1.0", "generatorVersion": VISUAL_CONTINUITY_VERSION,
        "subjects": [{"subjectId": "subject_test_01", "name": "Test subject"}],
        "environments": [{"environmentId": "env_test_01", "locationName": "Test land"}],
        "periods": [{"periodId": "period_test_01", "label": "Test period"}],
        "props": [{"propId": "prop_test_01", "name": "Test prop"}],
        "continuityGroups": [{"continuityGroupId": "cg_001",
                              "subjectIds": ["subject_test_01"],
                              "environmentId": "env_test_01",
                              "periodId": "period_test_01",
                              "persistentPropIds": ["prop_test_01"],
                              "sceneIds": ["scene_001", "scene_002"]}],
        "visualBibleHash": "vb-test-hash",
        "sourceScenePlanHash": sp_hash,
        "sourceScriptHash": script_hash,
    }, indent=2))

    shots = [make_shot("shot_001_01", "scene_001", 1, 0.0, 3.0),
             make_shot("shot_001_02", "scene_001", 2, 3.0, 6.0, shotPurpose="ACTION"),
             make_shot("shot_002_01", "scene_002", 1, 6.0, audio_duration,
                       shotPurpose="DETAIL")]
    for i, s in enumerate(shots):
        s["total_scene_shots"] = 2 if s["scene_id"] == "scene_001" else 1
        shots[i] = s
    _write(p / "veo_prompts.json", json.dumps({
        "project": name, "generator_version": CURRENT_GENERATOR_VERSION,
        "shotGeneratorVersion": CURRENT_GENERATOR_VERSION,
        "source_script_sha256": script_hash, "audio_sha256": audio_hash,
        "timestamps_sha256": ts_hash, "scene_plan_sha256": sp_hash,
        "sourceVisualBibleHash": "vb-test-hash",
        "audio_duration": audio_duration, "scene_count": 2, "shot_count": 3,
        "full_timeline_coverage": 100.0, "status": "ready",
        "shots": shots, "sceneHashes": compute_scene_hashes(scenes),
    }, indent=2, ensure_ascii=False))

    _write(p / "voice_qa.json", json.dumps({
        "schema_version": "1.0", "status": "pass", "audio_sha256": audio_hash,
        "audio_duration": audio_duration,
        "summary": {"unresolved_fail_count": 0, "unresolved_review_count": 0,
                    "total_issues": 0},
        "issues": [],
    }, indent=2))
    _write(p / "settings.json", json.dumps({"project_name": name}, indent=2))
    return p


class TestProductionExport(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.mkdtemp(prefix="unfoldiq_test_prod11_"))
        self._orig_projects_dir = aspex.PROJECTS_DIR
        aspex.PROJECTS_DIR = self.temp_root
        self.project = build_valid_project(self.temp_root)
        self.pid = self.project.name

    def tearDown(self):
        aspex.PROJECTS_DIR = self._orig_projects_dir
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def _load(self, name):
        with open(self.project / name, "r", encoding="utf-8") as f:
            return json.load(f)

    # -- core export ------------------------------------------------------
    def test_preflight_passes_on_valid_project(self):
        pre = preflight(self.project)
        self.assertTrue(pre["ok"], f"Unexpected blockers: {pre['blockers']}")
        self.assertEqual(pre["sceneCount"], 2)
        self.assertEqual(pre["shotCount"], 3)

    def test_export_creates_deterministic_directory(self):
        res = execute_export(self.pid)
        self.assertEqual(res["exportId"], "export_001")
        self.assertTrue((self.project / "exports" / "export_001").is_dir())
        res2 = execute_export(self.pid)
        self.assertEqual(res2["exportId"], "export_002")

    def test_export_never_overwrites(self):
        execute_export(self.pid)
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid, export_id="export_001")

    def test_manifest_schema_and_counts(self):
        execute_export(self.pid)
        with open(self.project / "exports" / "export_001" / "production_manifest.json",
                  encoding="utf-8") as f:
            m = json.load(f)
        self.assertEqual(m["schemaVersion"], "1.0.0")
        self.assertEqual(m["exportId"], "export_001")
        self.assertEqual(m["projectId"], self.pid)
        self.assertEqual(m["shotCount"], 3)
        self.assertEqual(len(m["shots"]), 3)
        self.assertEqual(len(m["scenes"]), 2)
        for key in ("scriptHash", "audioHash", "timestampsHash", "scenePlanHash",
                    "visualBibleHash", "veoPromptsHash"):
            self.assertIn(key, m["sourceHashes"])
            self.assertTrue(m["sourceHashes"][key])
        entry = m["shots"][0]
        for key in ("shotId", "parentSceneId", "shotIndex", "shotPurpose", "startTime",
                    "endTime", "duration", "narration", "continuityGroupId", "subjectIds",
                    "environmentId", "periodId", "propIds", "promptFile",
                    "expectedFileName", "status"):
            self.assertIn(key, entry)
        self.assertEqual(entry["status"], "PENDING")

    def test_source_hashes_are_sha256_and_stable(self):
        execute_export(self.pid)
        with open(self.project / "exports" / "export_001" / "production_manifest.json",
                  encoding="utf-8") as f:
            h1 = json.load(f)["sourceHashes"]
        for v in h1.values():
            if v is not None:
                self.assertEqual(len(v), 64)
                int(v, 16)
        self.assertEqual(h1["audioHash"], compute_file_sha256(self.project / "audio.wav"))

    def test_counts_agree_across_representations(self):
        execute_export(self.pid)
        exp = self.project / "exports" / "export_001"
        with open(exp / "production_manifest.json", encoding="utf-8") as f:
            m = json.load(f)
        with open(exp / "shot_manifest.csv", "r", encoding="utf-8", newline="") as f:
            rows = list(csv.reader(f))
        with open(exp / "production_checklist.md", "r", encoding="utf-8") as f:
            checklist = f.read()
        txt_files = list((exp / "shots").rglob("*.txt"))
        self.assertEqual(len(m["shots"]), 3)
        self.assertEqual(len(rows) - 1, 3)
        self.assertEqual(checklist.count("- [ ]"), 3)
        self.assertEqual(len(txt_files), 3)

    def test_expected_filename_mapping_and_uniqueness(self):
        execute_export(self.pid)
        with open(self.project / "exports" / "export_001" / "production_manifest.json",
                  encoding="utf-8") as f:
            m = json.load(f)
        names = {s["shotId"]: s["expectedFileName"] for s in m["shots"]}
        self.assertEqual(names["shot_001_01"], "scene_001_shot_01.mp4")
        self.assertEqual(names["shot_001_02"], "scene_001_shot_02.mp4")
        self.assertEqual(names["shot_002_01"], "scene_002_shot_01.mp4")
        lowered = [n.lower() for n in names.values()]
        self.assertEqual(len(set(lowered)), len(lowered))

    def test_stable_ordering(self):
        execute_export(self.pid)
        with open(self.project / "exports" / "export_001" / "production_manifest.json",
                  encoding="utf-8") as f:
            m = json.load(f)
        self.assertEqual([s["shotId"] for s in m["shots"]],
                         ["shot_001_01", "shot_001_02", "shot_002_01"])

    def test_prompt_text_matches_canonical(self):
        execute_export(self.pid)
        exp = self.project / "exports" / "export_001"
        canonical = {s["shot_id"]: s["veo_prompt"] for s in self._load("veo_prompts.json")["shots"]}
        for txt in (exp / "shots").rglob("*.txt"):
            body = txt.read_text(encoding="utf-8")
            shot_id = next(sid for sid in canonical if sid in body)
            self.assertIn(canonical[shot_id].strip(), body)

    def test_audio_and_srt_copied_binary_safe(self):
        execute_export(self.pid)
        exp = self.project / "exports" / "export_001"
        self.assertEqual((exp / "audio" / "audio.wav").read_bytes(),
                         (self.project / "audio.wav").read_bytes())
        self.assertEqual((exp / "audio" / "timestamps.srt").read_bytes(),
                         (self.project / "timestamps.srt").read_bytes())
        self.assertFalse((exp / "audio" / "audio.mp3").exists())

    def test_mp3_copied_when_canonical_exists(self):
        p2 = build_valid_project(self.temp_root, name="proj_mp3", with_mp3=True)
        execute_export(p2.name)
        self.assertTrue((p2 / "exports" / "export_001" / "audio" / "audio.mp3").is_file())

    def test_source_snapshot_copied(self):
        execute_export(self.pid)
        snap = self.project / "exports" / "export_001" / "source_snapshot"
        for name in ("scene_plan.json", "visual_bible.json", "veo_prompts.json"):
            self.assertTrue((snap / name).is_file(), name)

    def test_flow_pack_and_checklist_content(self):
        execute_export(self.pid)
        exp = self.project / "exports" / "export_001"
        pack = (exp / "flow_prompt_pack.md").read_text(encoding="utf-8")
        self.assertIn("scene_001_shot_01.mp4", pack)
        self.assertIn("shot_001_01", pack)
        self.assertIn(PROMPT_TXT[:60], pack)
        checklist = (exp / "production_checklist.md").read_text(encoding="utf-8")
        self.assertIn("- [ ] shot_001_01 — ESTABLISH — scene_001_shot_01.mp4", checklist)

    # -- guards ------------------------------------------------------------
    def _break_veo(self, mutate):
        data = self._load("veo_prompts.json")
        mutate(data)
        _write(self.project / "veo_prompts.json", json.dumps(data, indent=2))

    def test_blocks_on_outdated_shot(self):
        self._break_veo(lambda d: d["shots"].__setitem__(0, {**d["shots"][0], "outdated": True}))
        with self.assertRaises(ProductionExportError) as ctx:
            execute_export(self.pid)
        self.assertTrue(any("OUTDATED" in b for b in ctx.exception.blockers))

    def test_blocks_on_missing_prompt(self):
        self._break_veo(lambda d: d["shots"].__setitem__(1, {**d["shots"][1], "veo_prompt": ""}))
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid)

    def test_blocks_on_missing_audio(self):
        (self.project / "audio.wav").unlink()
        with self.assertRaises(ProductionExportError) as ctx:
            execute_export(self.pid)
        self.assertTrue(any("audio.wav" in b for b in ctx.exception.blockers))

    def test_blocks_on_missing_srt(self):
        (self.project / "timestamps.srt").unlink()
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid)

    def test_blocks_on_invalid_parent_scene(self):
        self._break_veo(lambda d: d["shots"].__setitem__(0, {**d["shots"][0], "parent_scene_id": "scene_999",
                                                             "parentSceneId": "scene_999"}))
        with self.assertRaises(ProductionExportError) as ctx:
            execute_export(self.pid)
        self.assertTrue(any("parentSceneId" in b for b in ctx.exception.blockers))

    def test_blocks_on_timeline_gap(self):
        def _mut(d):
            d["shots"][1] = {**d["shots"][1], "start": 3.5}
        self._break_veo(_mut)
        with self.assertRaises(ProductionExportError) as ctx:
            execute_export(self.pid)
        self.assertTrue(any("gap" in b for b in ctx.exception.blockers))

    def test_blocks_on_timeline_overlap(self):
        def _mut(d):
            d["shots"][1] = {**d["shots"][1], "start": 2.5, "end": 6.0, "duration": 3.5}
        self._break_veo(_mut)
        with self.assertRaises(ProductionExportError) as ctx:
            execute_export(self.pid)
        self.assertTrue(any("verlap" in b for b in ctx.exception.blockers))

    def test_blocks_on_duplicate_filenames(self):
        def _mut(d):
            d["shots"][1] = {**d["shots"][1], "shot_id": "shot_001_01x",
                             "scene_shot_index": 1, "index": 1}
        self._break_veo(_mut)
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid)

    def test_blocks_on_continuity_error(self):
        self._break_veo(lambda d: d["shots"].__setitem__(
            0, {**d["shots"][0], "subjectIds": ["subject_unknown_99"]}))
        with self.assertRaises(ProductionExportError) as ctx:
            execute_export(self.pid)
        self.assertTrue(any("continuity" in b.lower() or "subject" in b.lower()
                            for b in ctx.exception.blockers))

    def test_blocks_on_stale_veo(self):
        sp = self._load("scene_plan.json")
        sp["scenes"][0]["narration"] = "Mutated narration invalidates scene hash."
        _write(self.project / "scene_plan.json", json.dumps(sp, indent=2))
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid)

    def test_blocks_on_open_voice_qa_review(self):
        qa = self._load("voice_qa.json")
        qa["status"] = "review"
        qa["summary"] = {"unresolved_fail_count": 0, "unresolved_review_count": 1,
                         "total_issues": 1}
        qa["issues"] = [{"fingerprint": "abc", "severity": "review", "decision": "open"}]
        _write(self.project / "voice_qa.json", json.dumps(qa, indent=2))
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid)

    def test_accepted_review_passes_gate(self):
        qa = self._load("voice_qa.json")
        qa["status"] = "review"
        qa["summary"] = {"unresolved_fail_count": 0, "unresolved_review_count": 0,
                         "total_issues": 1}
        qa["issues"] = [{"fingerprint": "abc", "severity": "review",
                         "decision": "accepted", "resolution": "accepted"}]
        _write(self.project / "voice_qa.json", json.dumps(qa, indent=2))
        pre = preflight(self.project)
        self.assertTrue(pre["ok"], pre["blockers"])

    def test_failed_export_leaves_no_partial_folder(self):
        (self.project / "audio.wav").unlink()
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid)
        exports_root = self.project / "exports"
        finals = [c for c in exports_root.iterdir()
                  if c.is_dir() and not c.name.startswith(".tmp_")] if exports_root.is_dir() else []
        tmps = list(exports_root.glob(".tmp_*")) if exports_root.is_dir() else []
        self.assertEqual(finals, [])
        self.assertEqual(tmps, [])

    # -- snapshot immutability ---------------------------------------------
    def test_old_export_unchanged_after_mutation(self):
        res1 = execute_export(self.pid)
        exp1 = self.project / "exports" / res1["exportId"]
        before = {str(p.relative_to(exp1)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in exp1.rglob("*") if p.is_file()}
        sp = self._load("scene_plan.json")
        sp["scenes"].append(make_scene("scene_003", 3, 12.0, 15.0))
        _write(self.project / "scene_plan.json", json.dumps(sp, indent=2))
        after = {str(p.relative_to(exp1)): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in exp1.rglob("*") if p.is_file()}
        self.assertEqual(before, after)

    def test_mutation_detected_as_older_snapshot(self):
        execute_export(self.pid)
        hist = list_exports(self.pid)
        self.assertEqual(hist[0]["snapshot"], "CURRENT")
        sp = self._load("scene_plan.json")
        sp["scenes"][0]["narration"] = "Changed after export."
        _write(self.project / "scene_plan.json", json.dumps(sp, indent=2))
        hist2 = list_exports(self.pid)
        self.assertEqual(hist2[0]["snapshot"], "OLDER SNAPSHOT")

    # -- multi-project isolation --------------------------------------------
    def test_projects_isolated(self):
        p_b = build_valid_project(self.temp_root, name="proj_b")
        ra = execute_export(self.pid)
        rb = execute_export(p_b.name)
        self.assertEqual(ra["exportId"], "export_001")
        self.assertEqual(rb["exportId"], "export_001")
        ha = list_exports(self.pid)
        hb = list_exports(p_b.name)
        self.assertEqual(len(ha), 1)
        self.assertEqual(len(hb), 1)
        self.assertEqual(ha[0]["projectId"], self.pid)
        self.assertEqual(hb[0]["projectId"], p_b.name)

    def test_status_lists_history_light(self):
        execute_export(self.pid)
        st = production_status(self.pid)
        self.assertTrue(st["ready"])
        self.assertEqual(len(st["exports"]), 1)
        self.assertEqual(st["latestExport"]["exportId"], "export_001")

    # -- path safety ---------------------------------------------------------
    def test_rejects_path_traversal(self):
        for bad in ("../evil", "a/b", "a\\b", "..", ""):
            with self.assertRaises(ProductionExportError):
                execute_export(bad)

    def test_rejects_invalid_export_id(self):
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid, export_id="../export_001")
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid, export_id="export_1")
        with self.assertRaises(ProductionExportError):
            execute_export(self.pid, export_id="export_001;rm")


if __name__ == "__main__":
    unittest.main()
