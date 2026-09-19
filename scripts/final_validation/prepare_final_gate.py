"""Final-Gate preflight + baseline + working-copy factory (Task 3).

Subcommands (run from repo root):
  fingerprint  write environment/*
  diskcheck    verify free space, write environment/disk_preflight.json
  coldstart    owned stop -> ports closed -> start kokoro+studio -> health
  freeze       clone source project -> canonical_baseline/*
  mkcopy GATE  create working_copies/<GATE> from frozen baseline
"""
from __future__ import annotations

import json
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    assert_within, inventory_tree, sha256_file, write_json_create_only,
)

VALID = REPO / "temp" / "final_system_validation"
ENV = VALID / "environment"
BASE_PROJECT = VALID / "canonical_baseline" / "project"
COPIES = VALID / "working_copies"
SOURCE_PROJECT_ID = "2026-09-12_210003_youtube-narration-01"
SOURCE_PROJECT = REPO / "projects" / SOURCE_PROJECT_ID

ALLOWED_COPIES = ("G02_e2e", "G03_integrity", "G04_dependency", "G05_versions",
                  "G06_scheduler", "G10_export", "G11_manifest", "G12_render",
                  "G13_qa_diagnostics")

KOKORO_PORT, STUDIO_PORT = 8880, 7860
KOKORO_HEALTH = "http://127.0.0.1:8880/health"
STUDIO_HEALTH = "http://127.0.0.1:7860/health"
KOKORO_VENV_PY = REPO / "upstream" / "kokoro-fastapi" / ".venv" / "Scripts" / "python.exe"
RUNTIME = REPO / "runtime"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- fingerprint
def _sh(cmd: list[str], timeout: int = 30) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (r.stdout or "").strip()
    except Exception as e:
        return f"<unavailable: {e}>"


def fingerprint(env_dir: Path = ENV) -> dict:
    env_dir.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    freeze = _sh([py, "-m", "pip", "freeze", "--all"], timeout=120)
    (env_dir / "python.txt").write_text(
        f"{py}\n{platform.python_version()}\n", encoding="utf-8")
    (env_dir / "pip_freeze.txt").write_text(freeze + "\n", encoding="utf-8")
    import hashlib
    norm = "\n".join(sorted(l.strip().lower() for l in freeze.splitlines() if l.strip()))
    pip_hash = hashlib.sha256(norm.encode()).hexdigest()
    ffmpeg_v = _sh(["ffmpeg", "-version"])
    (env_dir / "ffmpeg.txt").write_text(ffmpeg_v + "\n", encoding="utf-8")
    ffprobe_v = _sh(["ffprobe", "-version"])
    (env_dir / "ffprobe.txt").write_text(ffprobe_v + "\n", encoding="utf-8")
    smi = _sh(["nvidia-smi",
               "--query-gpu=name,memory.total,driver_version",
               "--format=csv,noheader"], timeout=30)
    (env_dir / "nvidia_smi.txt").write_text(smi + "\n", encoding="utf-8")
    git = {
        "branch": _sh(["git", "branch", "--show-current"]),
        "head": _sh(["git", "rev-parse", "HEAD"]),
        "status": _sh(["git", "status", "--short"]),
    }
    (env_dir / "git.txt").write_text(json.dumps(git, indent=2) + "\n", encoding="utf-8")
    fp = {
        "id": f"env-{pip_hash[:12]}",
        "capturedAt": _now(),
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "cpu": platform.processor() or platform.machine(),
        "logicalCores": __import__("os").cpu_count(),
        "python": {"executable": py, "version": platform.python_version()},
        "pipFreezeSha256": pip_hash,
        "ffmpeg": ffmpeg_v.splitlines()[0] if ffmpeg_v else "<missing>",
        "ffprobe": ffprobe_v.splitlines()[0] if ffprobe_v else "<missing>",
        "nvidiaSmi": smi.splitlines() if smi and not smi.startswith("<") else [],
        "git": git,
    }
    (env_dir / "environment.json").write_text(
        json.dumps(fp, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return fp


# ---------------------------------------------------------------- diskcheck
def _tree_bytes(p: Path) -> int:
    total = 0
    for f in p.rglob("*"):
        try:
            if f.is_file():
                total += f.stat().st_size
        except OSError:
            pass
    return total


def diskcheck(env_dir: Path = ENV) -> dict:
    src_bytes = _tree_bytes(SOURCE_PROJECT)
    required = int(src_bytes * 6.25)  # baseline + 3 copies + pkg/scratch/final +25%
    free = shutil.disk_usage(str(REPO)).free
    ok = free >= required
    payload = {"at": _now(), "sourceBytes": src_bytes,
               "requiredBytes": required, "freeBytes": free, "ok": ok}
    env_dir.mkdir(parents=True, exist_ok=True)
    (env_dir / "disk_preflight.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if not ok:
        raise RuntimeError(f"FG_ENVIRONMENT_FAILURE: disk free={free} < required={required}")
    return payload


# ---------------------------------------------------------------- cold start
def port_open(port: int) -> bool:
    c = socket.socket()
    c.settimeout(1.0)
    try:
        c.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        c.close()


def _cmdline(pid: int) -> str:
    try:
        r = subprocess.run(
            ["wmic", "process", "where", f"ProcessId={pid}",
             "get", "CommandLine", "/VALUE"],
            capture_output=True, text=True, timeout=30)
        if r.stdout and "CommandLine" in r.stdout:
            return r.stdout
    except FileNotFoundError:
        pass
    try:  # wmic removed on newer Windows; CIM fallback
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"],
            capture_output=True, text=True, timeout=30)
        return r.stdout or ""
    except Exception:
        return ""


def _port_listener_pid(port: int) -> int | None:
    """Resolve the PID that LISTENs on 127.0.0.1:port via netstat (read-only)."""
    r = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                       timeout=30)
    for line in r.stdout.splitlines():
        parts = line.split()
        if (len(parts) >= 5 and parts[0] == "TCP"
                and parts[1] == f"127.0.0.1:{port}" and parts[3] == "LISTENING"
                and parts[4].isdigit()):
            return int(parts[4])
    return None


def _ppid(pid: int) -> int | None:
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').ParentProcessId"],
            capture_output=True, text=True, timeout=30)
        text = (r.stdout or "").strip()
        return int(text) if text.isdigit() else None
    except Exception:
        return None


def _matching_ancestors(pid: int, expect: list[str], log: list) -> list[int]:
    """Walk up while ancestors match the same verified service cmdline."""
    chain: list[int] = []
    seen = {pid}
    cur = _ppid(pid)
    while cur and cur not in seen:
        seen.add(cur)
        cmd = _cmdline(cur)
        if ("python" not in _proc_name(cur).lower()
                and "python" not in cmd.lower()):
            break
        if not all(e.lower() in cmd.lower() for e in expect):
            break
        chain.append(cur)
        log.append(f"matched supervisor ancestor pid {cur}")
        cur = _ppid(cur)
    return chain
def _kill_verified(name: str, pid: int, expect: list[str], log: list) -> bool:
    """Graceful then /F stop of a cmdline-verified owned process."""
    cmd = _cmdline(pid)
    if "python" not in _proc_name(pid).lower() and "python" not in cmd.lower():
        log.append(f"refuse pid {pid}: not python (recycled?)")
        return False
    if not all(e.lower() in cmd.lower() for e in expect):
        raise RuntimeError(
            f"FG_SECURITY_SAFETY_FAILURE: {name} pid {pid} cmdline mismatch; "
            f"refusing to kill")
    subprocess.run(["taskkill", "/PID", str(pid)], capture_output=True, timeout=30)
    deadline = time.time() + 15
    while time.time() < deadline:
        if _proc_name(pid) == "":
            log.append(f"pid {pid} exited gracefully")
            return True
        time.sleep(1.0)
    # Repo stop-script parity: verified-owned processes get force escalation.
    subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                   capture_output=True, timeout=30)
    time.sleep(2.0)
    if _proc_name(pid) == "":
        log.append(f"pid {pid} force-stopped after graceful refusal")
        return True
    log.append(f"pid {pid} SURVIVED force stop")
    return False


def _proc_name(pid: int) -> str:
    """Process image name or '' if dead. FG-HARNESS-03: the ctypes/psapi
    variant falsely reported live processes as dead; use Get-Process."""
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-Process -Id {pid} -ErrorAction SilentlyContinue).ProcessName"],
            capture_output=True, text=True, timeout=30)
        return (r.stdout or "").strip().lower()
    except Exception:
        return ""


def stop_owned_service(name: str, pid_file: Path, expect: list[str],
                       port: int = 0) -> dict:
    """Stop verified-owned processes incl. shim-spawned socket holders.

    Launcher-shim reality (FG-HARNESS-02): the recorded venv-python PID may be
    a shim whose uv-python child owns the socket. After stopping the recorded
    PID, if the port is still open the LISTENing PID is resolved via netstat,
    cmdline-verified to the same standard, and stopped. Nothing is ever killed
    without a python + expected-command-line match. Repo stop-script parity:
    graceful first, /F escalation for verified-owned processes only.
    """
    out: dict = {"service": name, "action": "none", "at": _now(), "log": []}
    log: list[str] = out["log"]  # type: ignore[assignment]
    if pid_file.is_file():
        text = pid_file.read_text(encoding="utf-8").strip()
        if not text.isdigit():
            pid_file.unlink(missing_ok=True)
            out["action"] = "stale-pid-cleaned"
        else:
            pid = int(text)
            if _proc_name(pid) == "":
                pid_file.unlink(missing_ok=True)
                out.update(action="already-stopped", pid=pid)
                log.append(f"pid {pid} already dead; record cleaned")
            else:
                if _kill_verified(name, pid, expect, log):
                    pid_file.unlink(missing_ok=True)
                    out.update(action="stopped-owned", pid=pid)
                else:
                    # FG-HARNESS-01: keep the record of a surviving process.
                    raise RuntimeError(
                        f"FG_SECURITY_SAFETY_FAILURE: {name} pid {pid} survived "
                        f"owned stop; pid record kept, refusing to proceed")
    else:
        out["action"] = "no-pid-file"
        log.append("no pid record; will only act on verified port listener")
    if port and port_open(port):
        holder = _port_listener_pid(port)
        if holder is None:
            log.append(f"port {port} transiently open; no listener resolved")
        else:
            # Top-down: verified matching supervisors first (they respawn
            # workers), then the socket holder itself.
            targets = _matching_ancestors(holder, expect, log) + [holder]
            ok = True
            for t in targets:
                if _proc_name(t) != "" and not _kill_verified(name, t, expect, log):
                    ok = False
            time.sleep(2.0)
            if not ok or port_open(port):
                raise RuntimeError(
                    f"FG_SECURITY_SAFETY_FAILURE: port {port} still occupied "
                    f"after stopping verified holders {targets}")
            out["portHolderStopped"] = targets
    return out


def _health(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def _start(name: str, workdir: Path, args: list[str], log: Path,
           pid_file: Path, health_url: str, cap_s: int) -> dict:
    log.parent.mkdir(parents=True, exist_ok=True)
    lf = open(log, "ab")
    creation = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    p = subprocess.Popen([str(KOKORO_VENV_PY)] + args, cwd=str(workdir),
                         stdout=lf, stderr=subprocess.STDOUT,
                         creationflags=creation)
    pid_file.write_text(str(p.pid), encoding="utf-8")
    t0, healthy, body = time.time(), False, None
    while time.time() - t0 < cap_s:
        body = _health(health_url)
        if isinstance(body, dict) and body.get("status") == "healthy":
            healthy = True
            break
        if p.poll() is not None:
            break
        time.sleep(2.0)
    return {"service": name, "pid": p.pid, "healthy": healthy,
            "health": body, "startupSeconds": round(time.time() - t0, 1)}


def coldstart() -> dict:
    cs_dir = VALID / "environment" / "coldstart"
    cs_dir.mkdir(parents=True, exist_ok=True)
    ports_before = {"7860": port_open(7860), "8880": port_open(8880)}
    (cs_dir / "ports_before.txt").write_text(json.dumps(ports_before) + "\n",
                                             encoding="utf-8")
    stops = [
        stop_owned_service("studio", RUNTIME / "studio.pid",
                           ["uvicorn", "studio.app"], port=STUDIO_PORT),
        stop_owned_service("kokoro", RUNTIME / "kokoro.pid",
                           ["uvicorn", "api.src.main"], port=KOKORO_PORT),
    ]
    time.sleep(2.0)
    if port_open(7860) or port_open(8880):
        raise RuntimeError("FG_SECURITY_SAFETY_FAILURE: port still occupied "
                           "after owned stop; refusing to proceed")
    kok = _start("kokoro", REPO / "upstream" / "kokoro-fastapi",
                 ["-m", "uvicorn", "api.src.main:app",
                  "--host", "127.0.0.1", "--port", "8880"],
                 RUNTIME / "kokoro.log", RUNTIME / "kokoro.pid",
                 KOKORO_HEALTH, 180)
    (cs_dir / "kokoro_start.json").write_text(json.dumps(kok, indent=2) + "\n",
                                              encoding="utf-8")
    if not kok["healthy"]:
        raise RuntimeError("FG_TEST_INFRA_FAILURE: kokoro failed health")
    try:
        with urllib.request.urlopen("http://127.0.0.1:8880/v1/voices",
                                    timeout=15) as r:
            voices = r.read().decode()[:4000]
    except Exception as e:
        voices = f"<unavailable: {e}>"
    (cs_dir / "voices.json").write_text(voices + "\n", encoding="utf-8")
    smi = _sh(["nvidia-smi"])
    (cs_dir / "nvidia_smi_loaded.txt").write_text(smi + "\n", encoding="utf-8")
    stu = _start("studio", REPO,
                 ["-m", "uvicorn", "studio.app:app",
                  "--host", "127.0.0.1", "--port", "7860"],
                 RUNTIME / "studio.log", RUNTIME / "studio.pid",
                 STUDIO_HEALTH, 120)
    (cs_dir / "studio_start.json").write_text(json.dumps(stu, indent=2) + "\n",
                                              encoding="utf-8")
    if not stu["healthy"]:
        raise RuntimeError("FG_TEST_INFRA_FAILURE: studio failed health")
    ports_after = {"7860": port_open(7860), "8880": port_open(8880)}
    (cs_dir / "ports_after.txt").write_text(json.dumps(ports_after) + "\n",
                                            encoding="utf-8")
    summary = {"at": _now(), "portsBefore": ports_before, "stops": stops,
               "kokoro": kok, "studio": stu, "portsAfter": ports_after}
    (cs_dir / "health.json").write_text(json.dumps(summary, indent=2) + "\n",
                                        encoding="utf-8")
    return summary


# ---------------------------------------------------------------- baseline
def freeze_baseline(src: Path = SOURCE_PROJECT, dest: Path = BASE_PROJECT,
                    meta: dict | None = None) -> dict:
    if dest.exists():
        raise FileExistsError(f"baseline already frozen: {dest}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest)
    inv = inventory_tree(dest)
    (dest.parent / "inventory.json").write_text(
        json.dumps(inv, indent=2) + "\n", encoding="utf-8")
    hashes = {e["rel"]: e["sha256"] for e in inv["files"]}
    (dest.parent / "hashes.json").write_text(
        json.dumps(hashes, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    metadata = {"frozenAt": _now(), "sourceProjectId": SOURCE_PROJECT_ID,
                "provenance": "CANONICAL_PRODUCTION_LIKE_DEMO",
                **(meta or {})}
    (dest.parent / "baseline_metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def create_working_copy(baseline_project: Path = BASE_PROJECT,
                        copies_root: Path = COPIES, gate: str = "",
                        enforce_baseline_root: bool = True) -> Path:
    if gate not in ALLOWED_COPIES:
        raise ValueError(f"unknown working-copy gate: {gate}")
    src = Path(baseline_project).resolve()
    if enforce_baseline_root:
        allowed = (VALID / "canonical_baseline").resolve()
        try:
            src.relative_to(allowed)
        except ValueError:
            raise ValueError("working copies must come from the frozen baseline, "
                             "never from the source project")
    if not src.is_dir():
        raise FileNotFoundError(f"baseline project missing: {src}")
    dest = copies_root / gate
    if dest.exists():
        raise FileExistsError(f"working copy exists (never replace): {dest}")
    copies_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dest)
    return dest


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "fingerprint":
        fp = fingerprint()
        print("fingerprint", fp["id"])
    elif cmd == "diskcheck":
        d = diskcheck()
        print("disk ok", d["freeBytes"], ">=", d["requiredBytes"])
    elif cmd == "coldstart":
        s = coldstart()
        print("coldstart kokoro", s["kokoro"]["startupSeconds"],
              "studio", s["studio"]["startupSeconds"])
    elif cmd == "freeze":
        m = freeze_baseline(meta={"expectedScenes": 79, "expectedShots": 141})
        print("baseline frozen", m["frozenAt"])
    elif cmd == "mkcopy":
        dest = create_working_copy(gate=argv[2])
        print("copy", dest)
    else:
        print("usage: fingerprint|diskcheck|coldstart|freeze|mkcopy GATE")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
