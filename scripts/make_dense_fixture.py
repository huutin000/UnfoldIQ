"""Build a dense-shot temp fixture: 1 scene with 300 shots (temp-only)."""
import copy
import json
import shutil
import sys
from pathlib import Path

SRC = Path("projects/2026-09-12_210003_youtube-narration-01")


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "_p5_dense300"
    nshots = int(sys.argv[2]) if len(sys.argv) > 2 else 300
    dst = Path("projects") / name
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(SRC, dst)

    sp = json.loads((dst / "scene_plan.json").read_text(encoding="utf-8"))
    veo = json.loads((dst / "veo_prompts.json").read_text(encoding="utf-8"))
    img = json.loads((dst / "image_prompts.json").read_text(encoding="utf-8"))
    vp = json.loads((dst / "visual_prompts.json").read_text(encoding="utf-8"))

    t_shot = next(s for s in veo["shots"] if s.get("parent_scene_id") == "scene_001")
    sid = "scene_900"
    sc = next(s for s in sp["scenes"] if s["scene_id"] == "scene_001")
    new_sc = copy.deepcopy(sc)
    new_sc.update({"scene_id": sid, "index": len(sp["scenes"]) + 1,
                   "start": 9000.0, "end": 9090.0, "duration": 90.0})
    sp["scenes"].append(new_sc)
    si = next(s for s in img["scenes"] if s["scene_id"] == "scene_001")
    new_img = copy.deepcopy(si)
    new_img.update({"scene_id": sid})
    img["scenes"].append(new_img)
    ve = next(e for e in vp["entries"] if e["sceneId"] == "scene_001")
    new_vp = copy.deepcopy(ve)
    new_vp.update({"sceneId": sid})
    vp["entries"].append(new_vp)

    base = len(veo["shots"])
    for j in range(nshots):
        sh = copy.deepcopy(t_shot)
        sh.update({"shot_id": f"shot_d{j + 1:03d}", "parent_scene_id": sid,
                   "scene_id": sid, "index": j + 1,
                   "start": j * 0.3, "end": (j + 1) * 0.3, "duration": 0.3})
        veo["shots"].append(sh)

    (dst / "scene_plan.json").write_text(json.dumps(sp, ensure_ascii=False), encoding="utf-8")
    (dst / "veo_prompts.json").write_text(json.dumps(veo, ensure_ascii=False), encoding="utf-8")
    (dst / "image_prompts.json").write_text(json.dumps(img, ensure_ascii=False), encoding="utf-8")
    (dst / "visual_prompts.json").write_text(json.dumps(vp, ensure_ascii=False), encoding="utf-8")
    print(f"fixture {name}: scene_900 with {nshots} shots; "
          f"total {len(sp['scenes'])} scenes / {len(veo['shots'])} shots")


if __name__ == "__main__":
    main()
