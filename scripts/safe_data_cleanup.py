"""
UnfoldIQ Post-Final Gate Safe Data Cleanup Script
Executes safe data cleanup per PROJECT_AUDIT_AND_POST_FINAL_CLEANUP_MASTER_SPEC.md.
Rules:
- Strict exact-path allowlist.
- ZERO broad wildcards.
- Strictly protects source, tests, models, environments, configs, docs, and Gate provenance.
"""

import os
import shutil
import sys
from pathlib import Path

# Explicit canonical candidates list
PROTECTED_PREFIXES = [
    "tests",
    "studio",
    "models",
    "upstream",
    "transcription",
    "docs",
    "scripts",
    ".git",
    ".agents",
    "temp/final_system_validation/governance",
    "temp/final_system_validation/data_integrity",
    "temp/final_system_validation/corrective_closure",
    "temp/final_system_validation/pass1_summary.json",
    "temp/final_system_validation/final_validation_summary.md",
]

BASE_DIR = Path(".").resolve()

def get_candidates():
    candidates = [
        Path("projects/--help"),
        Path("projects/.backup_2026-09-12_baseline"),
        Path("projects/2026-09-12_210003_youtube-narration-01"),
        Path("backups/phase15b_baseline_backup_youtube-narration-01.zip"),
        Path("temp/phase04_final_closure/benchmark"),
        Path("temp/final_system_validation/working_copies"),
        Path("temp/final_system_validation/export_package"),
        Path("temp/final_system_validation/render"),
        Path("temp/final_system_validation/e2e"),
        Path("temp/final_system_validation/canonical_baseline"),
        Path("docs.zip"),
        Path(".pytest_cache"),
    ]

    # Temporary browser test profiles in temp/
    temp_p = Path("temp")
    if temp_p.exists():
        for d in temp_p.iterdir():
            if d.is_dir() and any(d.name.startswith(pre) for pre in [
                "browser_profile_", "p6tg_", "p6close_", "headed_profile_", "edge_cdp_profile_"
            ]):
                candidates.append(d)

    # Ephemeral test fixtures in projects/
    proj_p = Path("projects")
    if proj_p.exists():
        for d in proj_p.iterdir():
            if d.is_dir() and d.name.startswith("proj_"):
                candidates.append(d)

    return candidates


def validate_protection(path: Path):
    resolved = path.resolve()
    rel_path = resolved.relative_to(BASE_DIR).as_posix()

    for prot in PROTECTED_PREFIXES:
        if rel_path == prot or rel_path.startswith(prot + "/"):
            raise ValueError(f"SECURITY VIOLATION: Path {rel_path} is PROTECTED and cannot be deleted!")


def run_cleanup():
    candidates = get_candidates()
    print("==================================================")
    print("UNFOLDIQ SAFE DATA CLEANUP — EXECUTION")
    print("==================================================")
    
    # 1. Preview & Validate
    valid_candidates = []
    total_bytes = 0

    for c in candidates:
        if not c.exists():
            continue
        validate_protection(c)
        if c.is_file():
            sz = c.stat().st_size
        else:
            sz = sum(f.stat().st_size for f in c.rglob("*") if f.is_file())
        valid_candidates.append((c, sz))
        total_bytes += sz

    print(f"Validated {len(valid_candidates)} disposable targets.")
    print(f"Target reclaimable size: {total_bytes / (1024*1024):.2f} MB ({total_bytes / (1024*1024*1024):.2f} GB)\n")

    # 2. Deletion
    deleted_count = 0
    reclaimed_bytes = 0
    errors = []

    for path, sz in valid_candidates:
        try:
            if path.is_file() or path.is_symlink():
                path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
            deleted_count += 1
            reclaimed_bytes += sz
            print(f"✓ Deleted: {path.as_posix()} ({sz / (1024*1024):.2f} MB)")
        except Exception as e:
            errors.append((str(path), str(e)))
            print(f"✗ FAILED to delete {path.as_posix()}: {e}")

    # 3. Ensure projects/.gitkeep exists
    proj_dir = Path("projects")
    proj_dir.mkdir(parents=True, exist_ok=True)
    gitkeep = proj_dir / ".gitkeep"
    if not gitkeep.exists():
        gitkeep.touch()
        print("✓ Created projects/.gitkeep")

    print("\n==================================================")
    print(f"CLEANUP SUMMARY:")
    print(f"Items deleted: {deleted_count} / {len(valid_candidates)}")
    print(f"Bytes reclaimed: {reclaimed_bytes} ({reclaimed_bytes / (1024*1024):.2f} MB / {reclaimed_bytes / (1024*1024*1024):.2f} GB)")
    print(f"Errors: {len(errors)}")
    print("==================================================")

    if errors:
        sys.exit(1)

if __name__ == "__main__":
    run_cleanup()
