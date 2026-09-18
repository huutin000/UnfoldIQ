"""Phase 8 Data Integrity Gate.
Hashes all protected reference project files before and after verification runs.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF_PROJ = ROOT / "projects" / "2026-09-12_210003_youtube-narration-01"
OUTPUT_DIR = ROOT / "temp" / "phase08_verification" / "integrity"

PROTECTED_RELATIVE_PATHS = [
    "script.json",
    "script.txt",
    "audio.wav",
    "timestamps.json",
    "scene_plan.json",
    "visual_bible.json",
    "veo_prompts.json",
    "assets/intake_ledger.json",
    "assets/registry.json",
]


def _hash_file(p: Path) -> str | None:
    if not p.is_file():
        return None
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def collect_hashes():
    hashes = {}
    for rel in PROTECTED_RELATIVE_PATHS:
        fp = REF_PROJ / rel
        if fp.exists():
            hashes[f"ref:{rel}"] = {
                "status": "PRESENT",
                "path": str(fp.relative_to(ROOT)).replace("\\", "/"),
                "sha256": _hash_file(fp),
                "sizeBytes": fp.stat().st_size,
            }
        else:
            hashes[f"ref:{rel}"] = {
                "status": "ABSENT / NOT APPLICABLE",
                "path": str(fp.relative_to(ROOT)).replace("\\", "/"),
                "sha256": None,
                "sizeBytes": None,
            }

    # Also collect Phase 7 manifest snapshots across exports
    exports_dir = REF_PROJ / "exports"
    manifest_count = 0
    if exports_dir.is_dir():
        for exp in sorted(exports_dir.iterdir()):
            if exp.is_dir():
                mf = exp / "render-manifest.json"
                if mf.is_file():
                    manifest_count += 1
                    key = f"manifest:{exp.name}"
                    hashes[key] = {
                        "status": "PRESENT",
                        "path": str(mf.relative_to(ROOT)).replace("\\", "/"),
                        "sha256": _hash_file(mf),
                        "sizeBytes": mf.stat().st_size,
                    }
    if manifest_count == 0:
        hashes["manifest:phase7_snapshots"] = {
            "status": "ABSENT / NOT APPLICABLE",
            "path": "projects/2026-09-12_210003_youtube-narration-01/exports/*/render-manifest.json",
            "sha256": None,
            "sizeBytes": None,
        }
    return hashes


def collect_generated_finals():
    finals = []
    exports_dir = REF_PROJ / "exports"
    if exports_dir.is_dir():
        for exp in sorted(exports_dir.iterdir()):
            if exp.is_dir():
                fin = exp / "final.mp4"
                meta = exp / "render-metadata.json"
                if fin.is_file():
                    finals.append({
                        "exportId": exp.name,
                        "finalPath": str(fin.relative_to(ROOT)).replace("\\", "/"),
                        "finalSize": fin.stat().st_size,
                        "metadataPath": str(meta.relative_to(ROOT)).replace("\\", "/") if meta.is_file() else None,
                    })
    return finals


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", choices=["before", "after"], required=True)
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.action == "before":
        data = collect_hashes()
        out = OUTPUT_DIR / "reference_hashes_before.json"
        out.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"Recorded {len(data)} reference hashes to {out}")

    elif args.action == "after":
        before_file = OUTPUT_DIR / "reference_hashes_before.json"
        if not before_file.is_file():
            print("ERROR: before file missing", file=sys.stderr)
            sys.exit(1)
        before_data = json.loads(before_file.read_text(encoding="utf-8"))
        after_data = collect_hashes()
        out = OUTPUT_DIR / "reference_hashes_after.json"
        out.write_text(json.dumps(after_data, indent=2), encoding="utf-8")

        mismatches = []
        for k, v_before in before_data.items():
            v_after = after_data.get(k)
            if not v_after:
                mismatches.append({"item": k, "error": "MISSING_IN_AFTER"})
            elif v_before["sha256"] != v_after["sha256"]:
                mismatches.append({
                    "item": k,
                    "before": v_before["sha256"],
                    "after": v_after["sha256"],
                })

        generated_finals = collect_generated_finals()

        verdict = "PASS" if len(mismatches) == 0 else "FAIL"
        res = {
            "verdict": verdict,
            "totalProtectedEntries": len(before_data),
            "presentProtectedFiles": sum(1 for v in before_data.values() if v.get("status") == "PRESENT"),
            "absentProtectedFiles": sum(1 for v in before_data.values() if v.get("status") == "ABSENT / NOT APPLICABLE"),
            "mismatches": mismatches,
            "generatedFinalsList": generated_finals,
        }
        res_file = OUTPUT_DIR / "result.json"
        res_file.write_text(json.dumps(res, indent=2), encoding="utf-8")
        print(f"Data Integrity Gate: {verdict}. Mismatches: {len(mismatches)}. Result written to {res_file}")
        if verdict != "PASS":
            sys.exit(1)


if __name__ == "__main__":
    main()
