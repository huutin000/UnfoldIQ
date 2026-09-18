import json
import shutil
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, ".")
from studio.portable_package import build_portable_package

SRC = Path("projects/2026-09-12_210003_youtube-narration-01")
OUT = Path("temp/phase04_final_closure")
OUT.mkdir(parents=True, exist_ok=True)


def fresh(name):
    dst = Path("projects") / name
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(SRC, dst)
    return dst


def seed(dst, lifecycle, aid, name):
    from studio.asset_registry import sha256_file
    (dst / "assets" / "imported").mkdir(parents=True, exist_ok=True)
    data = (SRC / "assets/references/characters/char_hh_primary_caregiver_01/front.png").read_bytes()
    (dst / "assets" / "imported" / name).write_bytes(data)
    (dst / "assets" / "intake_ledger.json").write_text(json.dumps({"assets": [{
        "id": aid, "scene_id": "scene_001", "assetType": "image",
        "filePath": f"assets/imported/{name}", "checksum": sha256_file(dst / "assets" / "imported" / name),
        "lifecycle": lifecycle, "locked": lifecycle == "LOCKED"}]}), encoding="utf-8")


def verify(label, dst, **kw):
    r = build_portable_package(dst, **kw)
    zf = zipfile.ZipFile(r["zip_path"])
    names = zf.namelist()
    mf = json.loads(zf.read("manifest.json").decode("utf-8"))
    ok = True
    notes = []
    assert "manifest.json" in names
    for f in mf["files"]:
        assert hashlib_sha(zf.read(f["relative_path"])) == f["sha256"], f["relative_path"]
    assert not any(n.startswith("/") or ".." in n.split("/") for n in names)
    assert not any(".env" in n.lower() or "state.db" in n.lower() for n in names)
    media = [n for n in names if n.startswith("assets/media/")]
    roles = {}
    for a in mf.get("asset_roles", []) if isinstance(mf.get("asset_roles"), list) else []:
        roles[a["asset_id"]] = a["role"]
    return {"label": label, "files": len(names), "media": media,
            "warnings": r["warnings"], "zip": r["zip_path"]}


def hashlib_sha(b):
    import hashlib
    return hashlib.sha256(b).hexdigest()


results = []
# 1. accepted fixture
d = fresh("_p4rv_acc")
seed(d, "APPROVED", "A-A", "a.png")
results.append(verify("accepted", d))
shutil.rmtree(d, ignore_errors=True)
# 2. generated-only
d = fresh("_p4rv_gen")
seed(d, "GENERATED", "A-G", "g.png")
results.append(verify("generated-only", d))
shutil.rmtree(d, ignore_errors=True)
# 3. rejected
d = fresh("_p4rv_rej")
seed(d, "REJECTED", "A-R", "r.png")
results.append(verify("rejected", d))
shutil.rmtree(d, ignore_errors=True)
# 4. legacy/reference (no intake assets)
d = fresh("_p4rv_leg")
results.append(verify("legacy-reference", d))
shutil.rmtree(d, ignore_errors=True)

(OUT / "package_reverification.json").write_text(
    json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
for r in results:
    print(r["label"], "files:", r["files"], "media:", r["media"], "warnings:", r["warnings"])
