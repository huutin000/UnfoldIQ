"""Phase 9 immutable QA report store.

exports/<exportId>/qa/<qaRunId>/report.json is create-only;
qa/latest.json is a safely-written mutable pointer. English identifiers.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")
_MAX_STDERR_BYTES = 200_000


def _check_run_id(qa_run_id: str) -> str:
    if not isinstance(qa_run_id, str) or not _RUN_ID_RE.match(qa_run_id):
        raise ValueError(f"invalid qaRunId: {qa_run_id!r}")
    if qa_run_id in (".", "..") or "/" in qa_run_id or "\\" in qa_run_id:
        raise ValueError(f"invalid qaRunId: {qa_run_id!r}")
    return qa_run_id


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".tmp_{path.name}_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    os.replace(tmp, path)


def _summary_of(report: dict, export_dir: Path) -> dict[str, Any]:
    final = report.get("final") or {}
    return {
        "qaRunId": report.get("qaRunId"),
        "reportPath": f"qa/{report.get('qaRunId')}/report.json",
        "manifestHash": report.get("manifestHash"),
        "finalSha256": final.get("sha256Commit") or final.get("sha256Start"),
        "qaPolicyVersion": report.get("qaPolicyVersion"),
        "verdict": report.get("verdict"),
        "completedAt": report.get("completedAt"),
    }


class RenderQaReportStore:
    """Filesystem-backed immutable QA report storage."""

    def qa_dir(self, export_dir: Path) -> Path:
        return Path(export_dir) / "qa"

    def run_dir(self, export_dir: Path, qa_run_id: str) -> Path:
        return self.qa_dir(export_dir) / _check_run_id(qa_run_id)

    def commit_report(self, export_dir: Path, report: dict[str, Any],
                      diagnostics: dict[str, Any] | None = None) -> Path:
        export_dir = Path(export_dir)
        qa_run_id = _check_run_id(str(report.get("qaRunId") or ""))
        run_dir = self.run_dir(export_dir, qa_run_id)
        report_path = run_dir / "report.json"
        if report_path.exists():
            raise FileExistsError(f"report already committed: {qa_run_id}")
        run_dir.mkdir(parents=True, exist_ok=True)
        diag = diagnostics or {}
        diag_dir = run_dir / "diagnostics"
        diag_dir.mkdir(parents=True, exist_ok=True)
        (diag_dir / "ffprobe.json").write_text(
            json.dumps(diag.get("ffprobe", {}), ensure_ascii=False, indent=2),
            encoding="utf-8")
        (diag_dir / "detector-events.json").write_text(
            json.dumps(diag.get("events", []), ensure_ascii=False, indent=2),
            encoding="utf-8")
        stderr_text = str(diag.get("stderr", ""))
        raw = stderr_text.encode("utf-8", errors="replace")[-_MAX_STDERR_BYTES:]
        (diag_dir / "ffmpeg-stderr.log").write_bytes(raw)
        payload = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
        try:
            with open(report_path, "x", encoding="utf-8", newline="\n") as f:
                f.write(payload)
        except FileExistsError:
            raise
        _atomic_write_json(self.qa_dir(export_dir) / "latest.json",
                           _summary_of(report, export_dir))
        return report_path

    def read_report(self, export_dir: Path, qa_run_id: str) -> dict[str, Any]:
        path = self.run_dir(export_dir, qa_run_id) / "report.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def list_reports(self, export_dir: Path) -> list[dict[str, Any]]:
        qa = self.qa_dir(export_dir)
        out: list[dict[str, Any]] = []
        if not qa.is_dir():
            return out
        for child in sorted(qa.iterdir(), key=lambda p: p.name):
            if not child.is_dir() or child.name.startswith("."):
                continue
            report_path = child / "report.json"
            if not report_path.is_file():
                continue
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            out.append(_summary_of(report, export_dir))
        out.sort(key=lambda s: (str(s.get("completedAt") or ""), str(s.get("qaRunId") or "")))
        return out

    def read_latest(self, export_dir: Path) -> dict[str, Any] | None:
        path = self.qa_dir(export_dir) / "latest.json"
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        run_id = data.get("qaRunId")
        if not run_id:
            return None
        if not (self.qa_dir(export_dir) / str(run_id) / "report.json").is_file():
            return None
        return data

    def repair_latest(self, export_dir: Path) -> dict[str, Any] | None:
        reports = self.list_reports(export_dir)
        if not reports:
            return None
        latest = reports[-1]
        _atomic_write_json(self.qa_dir(export_dir) / "latest.json", latest)
        return latest


def commit_report(export_dir: Path, report: dict[str, Any],
                  diagnostics: dict[str, Any] | None = None) -> Path:
    return RenderQaReportStore().commit_report(export_dir, report, diagnostics)


def read_report(export_dir: Path, qa_run_id: str) -> dict[str, Any]:
    return RenderQaReportStore().read_report(export_dir, qa_run_id)


def list_reports(export_dir: Path) -> list[dict[str, Any]]:
    return RenderQaReportStore().list_reports(export_dir)


def read_latest(export_dir: Path) -> dict[str, Any] | None:
    return RenderQaReportStore().read_latest(export_dir)


def repair_latest(export_dir: Path) -> dict[str, Any] | None:
    return RenderQaReportStore().repair_latest(export_dir)
