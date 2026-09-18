"""Build a temp large-fixture project (N scenes x 3 shots) from the reference.

Temp-only. Preserves referential integrity with stable generated IDs.
Usage: python scripts/make_large_fixture.py [dest_name] [num_scenes]
"""
import copy
import json
import shutil
import sys
from pathlib import Path

SRC = Path("projects/2026-09-12_210003_youtube-narration-01")


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "_p5_big300"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    dst = Path("projects") / name
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(SRC, dst)

    sp = json.loads((dst / "scene_plan.json").read_text(encoding="utf-8"))
    veo = json.loads((dst / "veo_prompts.json").read_text(encoding="utf-8"))
    img = json.loads((dst / "image_prompts.json").read_text(encoding="utf-8"))
    vp = json.loads((dst / "visual_prompts.json").read_text(encoding="utf-8"))

    t_scene = next(s for s in sp["scenes"] if s["scene_id"] == "scene_001")
    t_shots = [s for s in veo["shots"] if s.get("parent_scene_id") == "scene_001"][:3]
    t_img = next(s for s in img["scenes"] if s["scene_id"] == "scene_001")
    t_vp = next(e for e in vp["entries"] if e["sceneId"] == "scene_001")

    base_idx = len(sp["scenes"])
    shot_idx = len(veo["shots"])
    for i in range(1, n + 1):
        k = base_idx + i
        sid = f"scene_{k:03d}"
        sc = copy.deepcopy(t_scene)
        sc.update({"scene_id": sid, "index": k, "start": k * 10.0, "end": k * 10.0 + 9.0,
                   "duration": 9.0})
        sp["scenes"].append(sc)
        si = copy.deepcopy(t_img)
        si.update({"scene_id": sid, "index": k})
        img["scenes"].append(si)
        ve = copy.deepcopy(t_vp)
        ve.update({"sceneId": sid})
        vp["entries"].append(ve)
        for j, ts in enumerate(t_shots):
            shot_idx += 1
            sh = copy.deepcopy(ts)
            shid = f"shot_{shot_idx:03d}"
            sh.update({"shot_id": shid, "parent_scene_id": sid, "scene_id": sid,
                       "index": j + 1})
            veo["shots"].append(sh)

    (dst / "scene_plan.json").write_text(json.dumps(sp, ensure_ascii=False), encoding="utf-8")
    (dst / "veo_prompts.json").write_text(json.dumps(veo, ensure_ascii=False), encoding="utf-8")
    (dst / "image_prompts.json").write_text(json.dumps(img, ensure_ascii=False), encoding="utf-8")
    (dst / "visual_prompts.json").write_text(json.dumps(vp, ensure_ascii=False), encoding="utf-8")
    print(f"fixture {name}: {len(sp['scenes'])} scenes, {len(veo['shots'])} shots")


if __name__ == "__main__":
    main()
