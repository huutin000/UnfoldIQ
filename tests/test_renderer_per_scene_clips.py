"""
Focused regression test — Stage 3 P0: visual draft collapsed to ONE shared clip.

Root cause: `render_draft`/`render_final` read `scene_id`/`id`, but the
timeline compiler writes `sceneId` (camelCase). Every scene fell back to
`"sc"`, so `_prepare_scene_clip` produced a single shared
`img_clip_sc_<w>.mp4` for all 59 scenes.

Guards:
- `_resolve_scene_id` prefers `sceneId`, accepts legacy keys, falls back
  to the stable scene index (`sc{idx:03d}`) so names never collapse.
- `_prepare_scene_clip` content-addresses clip names (`<sha12>`), so two
  scenes with different image bytes never share one clip file.
"""

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from studio.renderer_adapter import FFmpegRenderer


class TestPerSceneClipIdentity(unittest.TestCase):
    def setUp(self):
        self.renderer = FFmpegRenderer()
        self.tmp = Path(tempfile.mkdtemp(prefix="unfoldiq_test_clipid_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_resolve_scene_id_prefers_camel_case(self):
        r = self.renderer._resolve_scene_id({"sceneId": "scene_001"}, 0)
        self.assertEqual(r, "scene_001")

    def test_resolve_scene_id_accepts_legacy_keys(self):
        self.assertEqual(self.renderer._resolve_scene_id({"scene_id": "a"}, 0), "a")
        self.assertEqual(self.renderer._resolve_scene_id({"id": "b"}, 1), "b")

    def test_resolve_scene_id_falls_back_to_index(self):
        # The bug's fallback was a constant "sc" for every scene.
        self.assertEqual(self.renderer._resolve_scene_id({}, 5), "sc005")
        self.assertNotEqual(
            self.renderer._resolve_scene_id({}, 5),
            self.renderer._resolve_scene_id({}, 6),
        )

    def test_prepare_scene_clip_distinguishes_asset_bytes(self):
        img_a = self.tmp / "a.jpg"
        img_b = self.tmp / "b.jpg"
        img_a.write_bytes(b"\xff\xd8\xffAAA")
        img_b.write_bytes(b"\xff\xd8\xffBBB")

        def fake_run(cmd, **kwargs):
            Path(cmd[-1]).touch()
            return mock.Mock(returncode=0)

        with mock.patch("studio.renderer_adapter.subprocess.run", side_effect=fake_run):
            clip_a = self.renderer._prepare_scene_clip(
                self.tmp, img_a, "scene_001", 5.0, 1280, 720, self.tmp
            )
            clip_b = self.renderer._prepare_scene_clip(
                self.tmp, img_b, "scene_002", 5.0, 1280, 720, self.tmp
            )
        self.assertNotEqual(clip_a, clip_b)
        self.assertIn("scene_001", clip_a.name)
        self.assertIn("scene_002", clip_b.name)

    def test_prepare_scene_clip_same_asset_reuses_cache(self):
        img = self.tmp / "c.jpg"
        img.write_bytes(b"\xff\xd8\xffCCC")

        def fake_run(cmd, **kwargs):
            Path(cmd[-1]).touch()
            return mock.Mock(returncode=0)

        with mock.patch("studio.renderer_adapter.subprocess.run", side_effect=fake_run) as m:
            first = self.renderer._prepare_scene_clip(
                self.tmp, img, "scene_001", 5.0, 1280, 720, self.tmp
            )
            second = self.renderer._prepare_scene_clip(
                self.tmp, img, "scene_001", 5.0, 1280, 720, self.tmp
            )
        self.assertEqual(first, second)
        self.assertEqual(m.call_count, 1)


if __name__ == "__main__":
    unittest.main()
