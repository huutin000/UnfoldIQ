"""
UnfoldIQ SQLite native-module trust/health probe (post-smoke follow-up, Issue 1).

Records the exact release runtime evidence required by the corrective plan:
  python executable, _sqlite3.pyd path, SQLite import + read/write smoke result.

Never disables Windows Security / Defender / App Control. On Windows it
additionally reports the Authenticode status of _sqlite3.pyd and any recent
CodeIntegrity 3077/3076 events for the file (read-only; failures are recorded,
never raised).
"""

import hashlib
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional


def _sqlite_module_file() -> Optional[str]:
    try:
        import _sqlite3  # type: ignore

        return getattr(_sqlite3, "__file__", None)
    except Exception:
        return None


def _authenticode_status(pyd_path: Optional[str]) -> Dict[str, Any]:
    if not pyd_path or os.name != "nt":
        return {"checked": False, "reason": "non-windows-or-unknown-path"}
    ps = (
        "$p = Get-AuthenticodeSignature -LiteralPath $env:UQ_SQLITE_PYD; "
        "$p | Format-List Status,StatusMessage,Path | Out-String"
    )
    env = dict(os.environ)
    env["UQ_SQLITE_PYD"] = pyd_path
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        out = (proc.stdout or "").strip()
        status = "Unknown"
        for line in out.splitlines():
            if line.strip().lower().startswith("status"):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    status = parts[1].strip()
                break
        return {"checked": True, "status": status, "detail": out[:1000]}
    except Exception as e:
        return {"checked": False, "reason": f"authenticode-query-failed: {e}"}


def _file_sha256(pyd_path: Optional[str]) -> Optional[str]:
    if not pyd_path:
        return None
    try:
        h = hashlib.sha256()
        with open(pyd_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def _codeintegrity_events(pyd_name: str = "_sqlite3.pyd", max_events: int = 5) -> Dict[str, Any]:
    if os.name != "nt":
        return {"checked": False, "reason": "non-windows"}
    ps = (
        "try { Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational';"
        " Id=3077} -MaxEvents 50 -ErrorAction Stop | Where-Object { $_.Message -like '*"
        + pyd_name
        + "*' } | Select-Object -First "
        + str(max_events)
        + " TimeCreated, Id, Message | Format-List | Out-String } "
        "catch { 'NO_EVENTS_OR_NO_ACCESS: ' + $_.Exception.Message }"
    )
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=30,
        )
        out = (proc.stdout or "").strip()
        blocked = "NO_EVENTS_OR_NO_ACCESS" not in out and bool(out)
        return {"checked": True, "recent_blocks": blocked, "detail": out[:2000]}
    except Exception as e:
        return {"checked": False, "reason": f"codeintegrity-query-failed: {e}"}


def check_sqlite_health() -> Dict[str, Any]:
    """Run the SQLite native-module import + read/write smoke probe."""
    result: Dict[str, Any] = {
        "python_executable": sys.executable,
        "python_version": sys.version.split()[0],
        "sqlite_module_file": None,
        "sqlite_version": None,
        "sqlite_sha256": None,
        "authenticode": {"checked": False},
        "codeintegrity": {"checked": False},
        "import_ok": False,
        "read_write_ok": False,
        "error": None,
    }
    try:
        result["sqlite_module_file"] = _sqlite_module_file()
        result["sqlite_version"] = sqlite3.sqlite_version
        result["import_ok"] = True
    except Exception as e:
        result["error"] = f"sqlite-import-failed: {e}"
        return result

    result["sqlite_sha256"] = _file_sha256(result["sqlite_module_file"])
    result["authenticode"] = _authenticode_status(result["sqlite_module_file"])
    result["codeintegrity"] = _codeintegrity_events()

    tmp_path: Optional[str] = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".db", prefix="uq_sqlite_probe_")
        os.close(fd)
        conn = sqlite3.connect(tmp_path, timeout=10.0)
        try:
            conn.execute("CREATE TABLE probe(x INTEGER)")
            conn.execute("INSERT INTO probe VALUES (1)")
            conn.commit()
            row = conn.execute("SELECT x FROM probe").fetchone()
            result["read_write_ok"] = bool(row and row[0] == 1)
        finally:
            conn.close()
    except Exception as e:
        result["error"] = f"sqlite-read-write-failed: {e}"
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
    return result
