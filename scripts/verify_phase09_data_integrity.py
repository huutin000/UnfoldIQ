"""Phase 9 data-integrity verification: snapshot + check protected project data.

Usage:
  python scripts/verify_phase09_data_integrity.py --snapshot <out.json>
  python scripts/verify_phase09_data_integrity.py --check <baseline.json>

Allowed mutations (reported, non-failing):
  - files under exports/*/qa/ of intentionally tested exports
  - persistent RENDER_QA job records (runtime/jobs + projects/*/jobs)
  - artifact QA status/reason fields on job records for tested exports

Everything else under projects/ must be byte-identical.
Exit nonzero on any unexpected mutation.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ROOT / "projects"
RUNTIME_JOBS = ROOT / "runtime" / "jobs"

PROTECTED_HINTS = ("script", "audio.wav", "timestamps", "scene_plan",
                   "visual_bible", "veo_prompts", "asset_registry",
                   "intake_ledger", "render-manifest", "final.mp4",
                   "render-metadata")


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot_projects() -> dict:
    files = {}
    for f in sorted(PROJECTS.rglob("*")):
        if f.is_file():
            try:
                rel = f.relative_to(ROOT).as_posix()
                files[rel] = {"sha256": _sha(f), "size": f.stat().st_size}
            except OSError as e:
                files[f.relative_to(ROOT).as_posix()] = {"error": str(e)}
    return files


def runtime_job_ids() -> list:
    if not RUNTIME_JOBS.is_dir():
        return []
    return sorted(p.name for p in RUNTIME_JOBS.glob("*.json"))


def upstream_state() -> dict:
    def _git(*args):
        try:
            return subprocess.run(["git", "-C", "upstream/kokoro-fastapi", *args],
                                  capture_output=True, text=True, timeout=30,
                                  cwd=str(ROOT)).stdout.strip()
        except Exception as e:
            return f"ERROR: {e}"
    return {"head": _git("rev-parse", "HEAD"),
            "status": _git("status", "--short"),
            "diff_stat": _git("diff", "--stat")}


def _allowed(rel: str) -> bool:
    low = rel.lower()
    if "/qa/" in low:
        return True
    if low.endswith("/jobs") or "/jobs/" in low:
        return True
    return False


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("--snapshot", "--check"):
        print(__doc__)
        return 2
    mode, target = argv[1], Path(argv[2])
    if mode == "--snapshot":
        data = {"projects": snapshot_projects(),
                "runtime_jobs": runtime_job_ids(),
                "upstream": upstream_state()}
        target.write_text(json.dumps(data, indent=1), encoding="utf-8")
        print(f"snapshot: {len(data['projects'])} files -> {target}")
        missing = [h for h in PROTECTED_HINTS
                   if not any(h in rel for rel in data["projects"])]
        for h in missing:
            print(f"NOTE: protected hint ABSENT/NOT APPLICABLE: {h}")
        return 0
    base = json.loads(target.read_text(encoding="utf-8"))
    now_files = snapshot_projects()
    base_files = base.get("projects", {})
    added = sorted(set(now_files) - set(base_files))
    removed = sorted(set(base_files) - set(now_files))
    changed = sorted(k for k in set(now_files) & set(base_files)
                     if now_files[k] != base_files[k])
    allowed_added = [p for p in added if _allowed(p)]
    allowed_changed = [p for p in changed if _allowed(p)]
    bad_added = [p for p in added if not _allowed(p)]
    bad = {"added": bad_added, "removed": removed, "changed": changed,
           "allowed_added": allowed_added, "allowed_changed": allowed_changed}
    print(json.dumps({k: (v if len(v) < 50 else v[:50] + ["..."]) for k, v in bad.items()},
                     indent=1))
    new_jobs = sorted(set(runtime_job_ids()) - set(base.get("runtime_jobs", [])))
    print(f"new runtime job records (allowed): {len(new_jobs)}")
    for j in new_jobs[:20]:
        print(f"  + {j}")
    up_now, up_base = upstream_state(), base.get("upstream", {})
    print(f"upstream HEAD now={up_now['head']} base={up_base.get('head')}")
    upstream_ok = (up_now["head"] == up_base.get("head")
                   and up_now["status"] == up_base.get("status", ""))
    if not upstream_ok:
        print("UPSTREAM STATE CHANGED (unexpected)")
    unexpected = bool(bad_added or removed or changed and
                      [c for c in changed if not _allowed(c)])
    unexpected = bool(bad_added or removed or
                      [c for c in changed if not _allowed(c)])
    print("DATA INTEGRITY:", "GREEN" if not unexpected and upstream_ok else "RED")
    return 0 if (not unexpected and upstream_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
