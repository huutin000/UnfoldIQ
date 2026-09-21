"""
UnfoldIQ Storage Manager & Safe Cache Policy — Phase 15A (P1)
Monitors disk usage across pipeline categories and provides safe, previewable,
permission-gated cleanup that strictly protects critical project assets.

Protected Resources (NEVER auto-deleted):
- approved assets
- locked assets
- project state / manifests / scripts
- final render (final.mp4)
- Visual Bible
- AI models (Kokoro, Whisper)
- source code
- .git, .env
"""

import hashlib
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

from studio.config import BASE_DIR, PROJECTS_DIR, OUTPUTS_DIR, TEMP_DIR
from studio.structured_logger import LOGS_DIR

logger = logging.getLogger("unfoldiq.storage_manager")

MODELS_DIR = BASE_DIR / "models"


# ---------------------------------------------------------------------------
# Post-final-gate cleanup: explicit allowlist classifier + preview fingerprint
# (Tasks 4-5). Precedence is fixed and documented; unknown content always
# lands in NEEDS_REVIEW and is never auto-deleted.
# ---------------------------------------------------------------------------

CLEANUP_SCOPE_ROUTINE = "routine"

CLASS_SAFE = "SAFE_TO_DELETE"
CLASS_PROTECTED = "PROTECTED"
CLASS_REVIEW = "NEEDS_REVIEW"

# Any of these as a full path segment => PROTECTED (checked AFTER the
# explicit disposable-area rules below, so render_cache survivors keep working).
PROTECTED_ROOT_SEGMENTS = frozenset({
    ".git", ".env", "studio", "scripts", "tests", "config", "models",
    "upstream", "transcription", "docs", "backups", "outputs", "projects",
    "runtime", "library", "phase3d_context",
})

# Exact basenames that are never deleted, wherever they appear.
PROTECTED_FILENAMES = frozenset({
    "visual_bible.json", "veo_prompts.json", "script.json", "settings.json",
    "manifest.json", "audio.wav", "final.mp4", "intake_ledger.json",
    ".gitkeep", ".gitignore",
})

# Legacy protected-substring markers (same list the legacy execute path uses).
LEGACY_PROTECTED_MARKERS = [
    ".git", ".env", "models", "script.json", "script.txt",
    "final.mp4", "intake_ledger.json", "audio.wav", "manifest.json",
    "final_system_validation", "edge_cdp_profile", "browser_profile", "tests",
]

# Extra evidence markers the new classifier also respects.
EVIDENCE_MARKERS = [
    "phase", "evidence", "closure", "verification", "audit",
    "screenreader", "zoom", "keyboard", "performance",
]

# Disposable subtrees under temp/final_system_validation/ (old audit: working
# copies, export packages, renders, e2e, canonical baseline are disposable;
# corrective_closure/governance/data_integrity/pass1_summary.json stay PROTECTED).
FSV_DISPOSABLE_PREFIXES = (
    "temp/final_system_validation/working_copies/",
    "temp/final_system_validation/export_package/",
    "temp/final_system_validation/render/",
    "temp/final_system_validation/e2e/",
    "temp/final_system_validation/canonical_baseline/",
)

# Allowlisted first-segment names under temp/ for stale CDP/browser profiles
# (Task-1 audit: ephemeral, regenerable, never user data). Explicit prefixes
# and exact names only — never a bare `"test" in name` style rule.
PROFILE_DIR_PREFIXES = (
    "browser_profile_",
    "headed_profile_",
    "headed_probe",
    "probe_",
    "p6",
    "edge_cdp_profile",
    "smoke_profile",
)
PROFILE_DIR_NAMES = frozenset({
    "probe_profile",
    "dbg_dense",
    "dbg_p5",
    "p8pref",
    "cast_smoke",
    "scale_test",
    "trace_probe",
    "trace_probe2",
    "evidence_jobs_runtime",
    "runtime_validation",
    "onboarding_revamp",
})

# Disposable file patterns at the temp/ root (regenerable outputs).
# NOTE: user-generated diagnostics exports (unfoldiq_diagnostics_*.zip) are
# deliberately NOT allowlisted — Review Focus #1: user content always needs
# human review before deletion.
ROOT_DISPOSABLE_SUFFIXES = (".log",)
ROOT_DISPOSABLE_NAMES = ("__pycache__",)


def _rel_posix(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def classify_cleanup_path(rel_posix: str) -> Tuple[str, str]:
    """Classify a BASE_DIR-relative posix path.

    Returns (classification, reason). Pure function of the path — no I/O —
    so tests can prove the allowlist without touching disk. Precedence:
    protected filenames > disposable areas > protected roots/markers > review.
    """
    rel = rel_posix.replace("\\", "/")
    if rel.startswith("./"):
        rel = rel[2:]
    lower = rel.lower()
    parts = [p for p in rel.split("/") if p]
    name = parts[-1] if parts else ""

    if name in PROTECTED_FILENAMES:
        return CLASS_PROTECTED, "Protected artifact filename"

    in_render_cache = (
        len(parts) >= 3 and parts[0] == "projects"
        and parts[2] == "render_cache"
    )
    in_temp = parts[:1] == ["temp"]
    in_scratch = parts[:1] == ["scratch"]

    if in_render_cache and len(parts) > 3:
        return CLASS_SAFE, "Disposable render cache file"
    if in_scratch and len(parts) > 1:
        return CLASS_SAFE, "Disposable scratch/test-cache file"
    if rel.startswith("projects/") and (
        "veo_prompts_archive_" in name or "visual_bible_archive_" in name
    ):
        return CLASS_SAFE, "Superseded archive (newest-N policy applied at scan)"
    if in_temp and any(rel.startswith(p) for p in FSV_DISPOSABLE_PREFIXES):
        return CLASS_SAFE, "Disposable validation working copy/output"
    if in_temp and len(parts) > 1:
        first = parts[1].lower()
        if first in PROFILE_DIR_NAMES or first.startswith(PROFILE_DIR_PREFIXES):
            return CLASS_SAFE, "Stale CDP/browser test profile (allowlisted)"
        if first == "__pycache__":
            return CLASS_SAFE, "Regenerable bytecode cache"
    if in_temp and len(parts) == 2:
        ln = name.lower()
        if ln.endswith(ROOT_DISPOSABLE_SUFFIXES):
            return CLASS_SAFE, "Regenerable temp-root log output"

    if any(seg in PROTECTED_ROOT_SEGMENTS for seg in parts):
        return CLASS_PROTECTED, "Protected repository root"
    if any(m in lower for m in LEGACY_PROTECTED_MARKERS):
        return CLASS_PROTECTED, "Protected path marker"
    if any(m in lower for m in EVIDENCE_MARKERS):
        return CLASS_PROTECTED, "Evidence/verification marker"

    return CLASS_REVIEW, "Unknown content — needs human review"


def _remove_file(path: Path) -> None:
    """Single OS delete primitive for the preview-gated path (monkeypatchable)."""
    path.unlink()


def _dir_size(path: Path, exclude_subdirs: Optional[List[str]] = None) -> int:
    """Calculate total size of files under a directory, optionally excluding subdirectory names."""
    if not path.exists():
        return 0
    total = 0
    exclude = set(exclude_subdirs or [])
    for root, dirs, files in os.walk(path):
        # In-place modify dirs to skip excluded
        dirs[:] = [d for d in dirs if d not in exclude]
        for f in files:
            fp = Path(root) / f
            try:
                total += fp.stat().st_size
            except Exception:
                pass
    return total


class StorageManager:
    def __init__(self, projects_dir: Optional[Path] = None):
        self.projects_dir = projects_dir or PROJECTS_DIR

    def get_storage_breakdown(self) -> Dict[str, Any]:
        """Compute storage usage across all major pipeline categories."""
        # 1. Free disk space
        total_disk, used_disk, free_disk = shutil.disk_usage(BASE_DIR)

        # 2. Render cache
        render_cache_size = 0
        if self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    rc = p_dir / "render_cache"
                    if rc.exists():
                        render_cache_size += _dir_size(rc)

        # 3. Projects (excluding render_cache)
        projects_size = _dir_size(self.projects_dir, exclude_subdirs=["render_cache"])

        # 4. Logs
        logs_size = _dir_size(LOGS_DIR)
        for lf in (BASE_DIR / "runtime").glob("*.log"):
            try:
                logs_size += lf.stat().st_size
            except Exception:
                pass

        # 5. Models
        models_size = _dir_size(MODELS_DIR)

        # 6. Python environment
        python_env_size = 0
        py_prefix = Path(sys.prefix)
        # Only measure if virtualenv inside project or accessible
        if py_prefix.exists() and (py_prefix.is_relative_to(BASE_DIR) or "venv" in str(py_prefix).lower()):
            try:
                python_env_size = _dir_size(py_prefix)
            except Exception:
                pass

        # 7. Exports
        exports_size = _dir_size(OUTPUTS_DIR)
        if PROJECTS_DIR.exists():
            for p_dir in PROJECTS_DIR.iterdir():
                if p_dir.is_dir():
                    exp = p_dir / "exports"
                    if exp.exists():
                        exports_size += _dir_size(exp)

        # 8. Temporary files & Test caches
        temp_size = _dir_size(TEMP_DIR)
        test_cache_size = 0
        scratch_dir = BASE_DIR / "scratch"
        if scratch_dir.exists():
            test_cache_size += _dir_size(scratch_dir)

        def to_mb(b: int) -> float:
            return round(b / (1024 * 1024), 2)

        def to_gb(b: int) -> float:
            return round(b / (1024 * 1024 * 1024), 2)

        return {
            "categories": {
                "projects": {"bytes": projects_size, "mb": to_mb(projects_size), "labelVi": "Dự án"},
                "renderCache": {"bytes": render_cache_size, "mb": to_mb(render_cache_size), "labelVi": "Render cache"},
                "testCache": {"bytes": test_cache_size, "mb": to_mb(test_cache_size), "labelVi": "Cache kiểm thử"},
                "logs": {"bytes": logs_size, "mb": to_mb(logs_size), "labelVi": "Nhật ký"},
                "models": {"bytes": models_size, "mb": to_mb(models_size), "labelVi": "Models"},
                "pythonEnv": {"bytes": python_env_size, "mb": to_mb(python_env_size), "labelVi": "Môi trường Python"},
                "exports": {"bytes": exports_size, "mb": to_mb(exports_size), "labelVi": "Exports"},
                "tempFiles": {"bytes": temp_size, "mb": to_mb(temp_size), "labelVi": "Temporary files"},
            },
            "disk": {
                "freeBytes": free_disk,
                "freeGb": to_gb(free_disk),
                "totalBytes": total_disk,
                "totalGb": to_gb(total_disk),
                "usedGb": to_gb(used_disk),
                "labelVi": "Dung lượng trống"
            }
        }

    def preview_cleanup(self, categories: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Scan candidates for cleanup without deleting anything.
        Explicitly displays protected resources warning.
        """
        selected_categories = set(categories or ["renderCache", "testCache", "tempFiles"])
        deletable_files: List[Dict[str, Any]] = []
        reclaimable_bytes = 0

        # 1. Render Cache
        if "renderCache" in selected_categories and self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    rc = p_dir / "render_cache"
                    if rc.exists():
                        for fp in rc.glob("*"):
                            if fp.is_file():
                                sz = fp.stat().st_size
                                deletable_files.append({
                                    "category": "renderCache",
                                    "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                    "absPath": str(fp),
                                    "size": sz
                                })
                                reclaimable_bytes += sz

        # 2. Temp files
        if "tempFiles" in selected_categories and TEMP_DIR.exists():
            cutoff = datetime.now() - timedelta(hours=1)
            for fp in TEMP_DIR.glob("**/*"):
                if fp.is_file():
                    path_str = str(fp).lower()
                    if any(marker in path_str for marker in [
                        "final_system_validation", "edge_cdp_profile", "browser_profile",
                        "phase", "evidence", "closure", "verification", "audit", "screenreader", "zoom", "keyboard", "performance"
                    ]):
                        continue
                    try:
                        mtime = datetime.fromtimestamp(fp.stat().st_mtime)
                        if mtime < cutoff:
                            sz = fp.stat().st_size
                            deletable_files.append({
                                "category": "tempFiles",
                                "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                "absPath": str(fp),
                                "size": sz
                            })
                            reclaimable_bytes += sz
                    except Exception:
                        pass

        # 3. Test Cache & Scratch
        if "testCache" in selected_categories:
            scratch_dir = BASE_DIR / "scratch"
            if scratch_dir.exists():
                for fp in scratch_dir.glob("**/*"):
                    if fp.is_file():
                        sz = fp.stat().st_size
                        deletable_files.append({
                            "category": "testCache",
                            "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                            "absPath": str(fp),
                            "size": sz
                        })
                        reclaimable_bytes += sz

        # 4. Old Archive files (veo_prompts_archive_*.json & visual_bible_archive_*.json beyond 3 newest)
        if "archiveFiles" in selected_categories and self.projects_dir.exists():
            for p_dir in self.projects_dir.iterdir():
                if p_dir.is_dir():
                    # veo prompts archives
                    veo_archives = sorted(p_dir.glob("veo_prompts_archive_*.json"), key=lambda f: f.name)
                    if len(veo_archives) > 3:
                        # Keep the newest 3, delete older
                        for fp in veo_archives[:-3]:
                            sz = fp.stat().st_size
                            deletable_files.append({
                                "category": "archiveFiles",
                                "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                "absPath": str(fp),
                                "size": sz
                            })
                            reclaimable_bytes += sz
                    # visual bible archives
                    vb_archives = sorted(p_dir.glob("visual_bible_archive_*.json"), key=lambda f: f.name)
                    if len(vb_archives) > 3:
                        for fp in vb_archives[:-3]:
                            sz = fp.stat().st_size
                            deletable_files.append({
                                "category": "archiveFiles",
                                "path": str(fp.relative_to(BASE_DIR)) if fp.is_relative_to(BASE_DIR) else str(fp),
                                "absPath": str(fp),
                                "size": sz
                            })
                            reclaimable_bytes += sz

        return {
            "candidateCount": len(deletable_files),
            "reclaimableBytes": reclaimable_bytes,
            "reclaimableMb": round(reclaimable_bytes / (1024 * 1024), 2),
            "protectedWarningVi": "BẢO VỆ DỮ LIỆU: Các mục sau luôn được bảo vệ tuyệt đối và không bao giờ bị xóa: tài nguyên đã duyệt (approved assets), tài nguyên đã khóa (locked assets), trạng thái dự án (project state), bản kết xuất cuối (final.mp4), Visual Bible, models, mã nguồn, tệp .git và .env.",
            "candidatesSample": deletable_files[:30],
            "allCandidates": deletable_files
        }

    def execute_cleanup(self, categories: Optional[List[str]] = None, confirmed: bool = False) -> Dict[str, Any]:
        """
        Safely deletes only whitelisted disposable cache and temp files.
        Guarantees protected items are NEVER deleted.
        """
        if not confirmed:
            raise ValueError("Cần xác nhận dọn dẹp trước khi thực hiện.")

        preview = self.preview_cleanup(categories=categories)
        deleted_count = 0
        freed_bytes = 0
        errors: List[str] = []

        # Strict blacklist / protected markers
        PROTECTED_MARKERS = [
            ".git", ".env", "models", "script.json", "script.txt",
            "final.mp4", "intake_ledger.json", "audio.wav", "manifest.json",
            "final_system_validation", "edge_cdp_profile", "browser_profile", "tests"
        ]

        target_items = preview.get("allCandidates", preview.get("candidatesSample", []))
        protected_skipped: List[str] = []

        for item in target_items:
            abs_p = Path(item["absPath"])
            # Strict protection: exact active project files
            if abs_p.name in ["visual_bible.json", "veo_prompts.json", "script.json", "settings.json", "manifest.json", "audio.wav", "final.mp4"]:
                logger.warning(f"Prevented deletion of protected file: {abs_p}")
                protected_skipped.append(str(abs_p))
                continue
            path_str = str(abs_p).lower()
            if any(marker in path_str for marker in PROTECTED_MARKERS):
                logger.warning(f"Prevented deletion of protected file: {abs_p}")
                protected_skipped.append(str(abs_p))
                continue

            if abs_p.exists() and abs_p.is_file():
                try:
                    abs_p.unlink()
                    deleted_count += 1
                    freed_bytes += item["size"]
                except Exception as e:
                    errors.append(f"{abs_p.name}: {e}")

        # Determine machine-readable status according to Master Spec §36
        if errors and deleted_count > 0:
            status = "PARTIAL_FAILURE"
            status_vi = "Dọn dẹp hoàn tất một phần"
        elif errors and deleted_count == 0:
            status = "FAILURE"
            status_vi = "Dọn dẹp thất bại"
        else:
            status = "SUCCESS"
            status_vi = "Đã dọn dẹp thành công"

        logger.info(f"Storage cleanup [{status}]: {deleted_count} files removed, {freed_bytes} bytes freed, {len(errors)} errors")
        return {
            "status": status,
            "statusVi": status_vi,
            "deletedCount": deleted_count,
            "freedBytes": freed_bytes,
            "freedMb": round(freed_bytes / (1024 * 1024), 2),
            "errors": errors,
            "bytes_reclaimed": freed_bytes,
            "items_deleted": deleted_count,
            "items_failed": len(errors),
            "failed_items": errors,
            "protected_items_skipped": protected_skipped,
            "protected_items_skipped_count": len(protected_skipped),
        }


    # ------------------------------------------------------------------
    # Post-final-gate binding contract (Tasks 4-5). Additive: the legacy
    # preview_cleanup / execute_cleanup(category, confirmed) behavior above
    # is preserved untouched for existing clients and historical tests.
    # ------------------------------------------------------------------

    def build_cleanup_preview(self, scope: str = CLEANUP_SCOPE_ROUTINE) -> Dict[str, Any]:
        """Authoritative deterministic cleanup preview.

        Returns the binding contract: preview_id (sha256 over sorted
        candidate metadata incl. mtime_ns), scope, status, bytes_reclaimable,
        items (SAFE_TO_DELETE only), protected_items, needs_review.
        """
        if scope != CLEANUP_SCOPE_ROUTINE:
            raise ValueError(f"Unsupported cleanup scope: {scope!r}")

        base_dir = BASE_DIR
        temp_dir = TEMP_DIR
        records: List[Dict[str, Any]] = []

        def add_file(fp: Path, category: str) -> None:
            try:
                st = fp.stat()
                if not fp.is_file():
                    return
            except OSError:
                return
            rel = _rel_posix(fp, base_dir)
            classification, reason = classify_cleanup_path(rel)
            # Scratch refinement: possible helper scripts/config stay REVIEW
            # even inside the disposable scratch area (mixed-content safety).
            if classification == CLASS_SAFE and category == "testCache" \
                    and fp.suffix.lower() in {
                        ".py", ".pyw", ".js", ".ts", ".sh", ".ps1", ".bat",
                        ".cmd", ".md", ".rst", ".json", ".yaml", ".yml",
                        ".toml", ".cfg", ".ini", ".env",
                    }:
                classification, reason = CLASS_REVIEW, "Possible helper script/config in scratch"
            records.append({
                "path": rel,
                "absPath": str(fp),
                "category": category,
                "classification": classification,
                "bytes": st.st_size,
                "mtime_ns": st.st_mtime_ns,
                "reason": reason,
            })

        # 1. Render cache files (mirrors legacy scan).
        if self.projects_dir.exists():
            for p_dir in sorted(self.projects_dir.iterdir()):
                if not p_dir.is_dir():
                    continue
                rc = p_dir / "render_cache"
                if rc.is_dir():
                    for fp in sorted(rc.glob("*")):
                        add_file(fp, "renderCache")
            # 2. Superseded archives beyond newest 3 (legacy newest-N policy).
            for p_dir in sorted(self.projects_dir.iterdir()):
                if not p_dir.is_dir():
                    continue
                for pattern in ("veo_prompts_archive_*.json", "visual_bible_archive_*.json"):
                    archives = sorted(p_dir.glob(pattern), key=lambda f: f.name)
                    for fp in archives[:-3] if len(archives) > 3 else []:
                        add_file(fp, "archiveFiles")

        # 3. Scratch tree (test cache).
        scratch_dir = base_dir / "scratch"
        if scratch_dir.is_dir():
            for fp in sorted(scratch_dir.glob("**/*")):
                add_file(fp, "testCache")

        # 4. Whole temp tree — the classifier (never a wildcard) decides.
        if temp_dir.is_dir():
            for fp in sorted(temp_dir.glob("**/*")):
                if fp.is_symlink():
                    continue
                add_file(fp, "tempFiles")

        fingerprint_payload = {
            "scope": scope,
            "records": sorted(
                (
                    [r["path"], r["classification"], r["bytes"], r["mtime_ns"], r["category"]]
                    for r in records
                ),
                key=lambda row: row[0],
            ),
        }
        preview_id = hashlib.sha256(
            json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        safe = [r for r in records if r["classification"] == CLASS_SAFE]
        protected = [r for r in records if r["classification"] == CLASS_PROTECTED]
        review = [r for r in records if r["classification"] == CLASS_REVIEW]
        return {
            "preview_id": preview_id,
            "scope": scope,
            "status": "READY",
            "bytes_reclaimable": sum(r["bytes"] for r in safe),
            "items": safe,
            "protected_items": protected,
            "needs_review": review,
        }

    def execute_cleanup_with_preview(
        self,
        *,
        preview_id: str,
        scope: str = CLEANUP_SCOPE_ROUTINE,
        confirmed: bool = False,
    ) -> Dict[str, Any]:
        """Execute only after server-side preview revalidation.

        Any fingerprint/scope mismatch deletes NOTHING and returns FAILURE
        (stale-preview safety). Only current SAFE_TO_DELETE items are
        eligible; protected items are skipped (never failed); locked files
        are recorded as failed without aborting siblings.
        """
        if not confirmed:
            raise ValueError("Cần xác nhận dọn dẹp trước khi thực hiện.")
        if scope != CLEANUP_SCOPE_ROUTINE:
            raise ValueError(f"Unsupported cleanup scope: {scope!r}")

        current = self.build_cleanup_preview(scope=scope)
        if current["preview_id"] != preview_id or current["scope"] != scope:
            logger.warning("Stale cleanup preview rejected; zero deletion performed.")
            return {
                "status": "FAILURE",
                "statusVi": "Xem trước dọn dẹp đã cũ; không xóa gì cả. Vui lòng xem trước lại.",
                "reason": "STALE_PREVIEW",
                "bytes_reclaimed": 0,
                "deletedCount": 0,
                "freedBytes": 0,
                "freedMb": 0.0,
                "items_deleted": [],
                "items_failed": [],
                "failed_items": [],
                "protected_items_skipped": [],
                "protected_items_skipped_count": 0,
                "preview_id": current["preview_id"],
                "scope": scope,
            }

        deleted: List[str] = []
        failed: List[str] = []
        failed_items: List[str] = []
        freed_bytes = 0
        deleted_abs: List[Path] = []

        for item in current["items"]:
            abs_p = Path(item["absPath"])
            if not abs_p.exists() or not abs_p.is_file():
                continue  # vanished after preview: eligible-but-absent, not a failure
            try:
                _remove_file(abs_p)
                deleted.append(item["path"])
                freed_bytes += item["bytes"]
                deleted_abs.append(abs_p)
            except OSError as e:
                failed.append(item["path"])
                failed_items.append(f"{abs_p.name}: {e}")

        self._prune_emptied_profile_dirs(deleted_abs)

        protected_abs = [r["absPath"] for r in current["protected_items"]]
        if failed and deleted:
            status, status_vi = "PARTIAL_FAILURE", "Dọn dẹp hoàn tất một phần"
        elif failed:
            status, status_vi = "FAILURE", "Dọn dẹp thất bại"
        else:
            status, status_vi = "SUCCESS", "Đã dọn dẹp thành công"
        logger.info(
            f"Preview-gated cleanup [{status}]: {len(deleted)} files removed, "
            f"{freed_bytes} bytes freed, {len(failed)} failed"
        )
        return {
            "status": status,
            "statusVi": status_vi,
            "bytes_reclaimed": freed_bytes,
            "deletedCount": len(deleted),
            "freedBytes": freed_bytes,
            "freedMb": round(freed_bytes / (1024 * 1024), 2),
            "items_deleted": deleted,
            "items_failed": failed,
            "failed_items": failed_items,
            "protected_items_skipped": protected_abs,
            "protected_items_skipped_count": len(protected_abs),
            "preview_id": current["preview_id"],
            "scope": scope,
        }

    def _prune_emptied_profile_dirs(self, deleted_abs: List[Path]) -> None:
        """Best-effort rmdir of emptied allowlisted profile dirs. Never raises."""
        try:
            temp_dir = TEMP_DIR
        except Exception:
            return
        for abs_p in deleted_abs:
            try:
                rel = abs_p.relative_to(temp_dir).as_posix()
            except ValueError:
                continue
            first = rel.split("/")[0].lower() if "/" in rel else ""
            prunable = (
                first in PROFILE_DIR_NAMES
                or first.startswith(PROFILE_DIR_PREFIXES)
                or first == "__pycache__"
                or any(rel.startswith(p[len("temp/"):]) for p in FSV_DISPOSABLE_PREFIXES)
            )
            if not prunable:
                continue
            cur = abs_p.parent
            while cur != temp_dir and temp_dir in cur.parents:
                try:
                    cur.rmdir()
                except OSError:
                    break
                cur = cur.parent


storage_manager = StorageManager()
