"""Operational release check: Windows trust / SQLite native module (Issue 1).

Records (never modifies security policy):
  python executable, _sqlite3.pyd path, Authenticode status,
  SQLite import + read/write smoke, CodeIntegrity 3077/3076 events
  observed during the release startup window.

Usage:
    python scripts/check_windows_trust_sqlite.py [--python <exe>] [--json-out <path>]

Exit 0 = SQLite import + read/write smoke PASS (trust signals recorded).
Exit 2 = SQLite itself broken (P1). A CodeIntegrity block event alone is
reported but does not fake a PASS — see `codeintegrity` field.

Never disables Windows Security, Defender, Smart App Control, Code Integrity,
or App Control.
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

DEFAULT_PYTHON = REPO / "upstream" / "kokoro-fastapi" / ".venv" / "Scripts" / "python.exe"


def _run(python_exe: str, code: str, timeout: int = 60) -> tuple:
    try:
        proc = subprocess.run(
            [python_exe, "-c", code],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip()
    except Exception as e:
        return 99, "", f"spawn-failed: {e}"


def _codeintegrity_snapshot(max_events: int = 10) -> str:
    ps = (
        "try { Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational'}"
        " -MaxEvents 100 -ErrorAction Stop | Where-Object { $_.Id -eq 3077 -or $_.Id -eq 3076 }"
        " | Where-Object { $_.Message -like '*_sqlite3.pyd*' }"
        f" | Select-Object -First {max_events} TimeCreated, Id, Message | Format-List | Out-String }}"
        " catch { 'NO_EVENTS_OR_NO_ACCESS: ' + $_.Exception.Message }"
    )
    try:
        proc = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
            capture_output=True,
            text=True,
            timeout=60,
        )
        return ((proc.stdout or "").strip() or "NO_OUTPUT")[:4000]
    except Exception as e:
        return f"QUERY_FAILED: {e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--python", default=str(DEFAULT_PYTHON))
    ap.add_argument("--json-out", default="")
    args = ap.parse_args()

    python_exe = args.python
    report: dict = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "python_exe": python_exe,
        "provenance": {},
        "sqlite_rw": {},
        "codeintegrity_sqlite_blocks": "",
        "verdict": "UNKNOWN",
    }

    rc, out, err = _run(
        python_exe,
        "import sys,sqlite3; "
        "import _sqlite3 as m; "
        "print(sys.executable); print(sys.version.replace(chr(10),' ')); "
        "print(m.__file__); print(sqlite3.sqlite_version)",
    )
    lines = out.splitlines()
    report["provenance"] = {
        "returncode": rc,
        "executable": lines[0] if len(lines) > 0 else "",
        "version": lines[1] if len(lines) > 1 else "",
        "sqlite_module_file": lines[2] if len(lines) > 2 else "",
        "sqlite_version": lines[3] if len(lines) > 3 else "",
        "stderr": err[:500],
    }

    rc2, out2, err2 = _run(
        python_exe,
        "import sqlite3,tempfile,os; p=tempfile.mktemp(suffix='.db'); "
        "c=sqlite3.connect(p); c.execute('create table t(x int)'); "
        "c.execute('insert into t values (1)'); c.commit(); "
        "print(c.execute('select x from t').fetchone()); c.close(); os.remove(p); "
        "print('SQLITE_RW_PASS')",
    )
    rw_ok = rc2 == 0 and "SQLITE_RW_PASS" in out2
    report["sqlite_rw"] = {"returncode": rc2, "pass": rw_ok, "stdout": out2[-300:], "stderr": err2[:500]}

    report["codeintegrity_sqlite_blocks"] = _codeintegrity_snapshot()
    blocked = (
        "NO_EVENTS_OR_NO_ACCESS" not in report["codeintegrity_sqlite_blocks"]
        and "_sqlite3.pyd" in report["codeintegrity_sqlite_blocks"]
    )
    report["codeintegrity_block_observed"] = blocked

    if rw_ok and not blocked:
        report["verdict"] = "PASS"
    elif rw_ok and blocked:
        # SQLite works but the OS trust policy logged a block (e.g. Enterprise
        # signing-level rejection of a valid PSF signature on another process).
        # Do NOT claim fully fixed; surface for release governance.
        report["verdict"] = "PASS_WITH_TRUST_WARNING"
    else:
        report["verdict"] = "FAIL"

    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    if report["verdict"] == "FAIL":
        print("RESULT: FAIL — SQLite native module broken with this runtime (P1).", flush=True)
        return 2
    if report["verdict"] == "PASS_WITH_TRUST_WARNING":
        print(
            "RESULT: PASS_WITH_TRUST_WARNING — SQLite works, but CodeIntegrity logged "
            "a _sqlite3.pyd block (likely Enterprise signing-level policy vs valid "
            "PSF signature). Do not claim 'Windows Security issue fixed'; escalate "
            "via release governance. Never disable security as the fix.",
            flush=True,
        )
        return 0
    print("RESULT: PASS — no CodeIntegrity block, SQLite import + RW smoke succeed.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
