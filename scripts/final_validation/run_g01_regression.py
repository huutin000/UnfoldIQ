"""G01 — Full Canonical Regression runner (Task 4, validation-only).

Executes from repo root WITHOUT touching test discovery:
  py -3 -m pytest --collect-only -q
  py -3 -m pytest --tb=short -q
Writes immutable evidence under temp/final_system_validation/regression/.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, append_command_log, write_gate_result,
    write_json_create_only,
)

import argparse

DEFAULT_GATE_DIR = REPO / "temp" / "final_system_validation" / "regression"
HISTORICAL_REFERENCE = 1062


def _run(argv: list[str], timeout_s: int) -> tuple[int, str, str, float]:
    t0 = time.time()
    r = subprocess.run([sys.executable] + argv, cwd=str(REPO),
                       capture_output=True, text=True, timeout=timeout_s)
    return r.returncode, r.stdout, r.stderr, time.time() - t0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rerun", default="")
    args, _ = parser.parse_known_args()

    gate_dir = DEFAULT_GATE_DIR
    if args.rerun:
        gate_dir = gate_dir / args.rerun

    gate_dir.mkdir(parents=True, exist_ok=True)
    clog = gate_dir / "commands.log"

    code, out, err, dt = _run(["-m", "pytest", "--collect-only", "-q"], 600)
    append_command_log(clog, ["pytest", "--collect-only", "-q"], code, out, err)
    mcol = re.search(r"(\d+)\s+(?:tests|items) collected", out + err) or re.search(r"collected\s+(\d+)\s+(?:tests|items)", out + err)
    n = int(mcol.group(1)) if mcol else 0
    leaked = sorted({l for l in (out + err).splitlines() if "final_validation" in l})

    (gate_dir / "collected_tests.txt").write_text(out, encoding="utf-8")
    code2, out2, err2, dt2 = _run(["-m", "pytest", "--tb=short", "-q"], 3600)
    append_command_log(clog, ["pytest", "--tb=short", "-q"], code2, out2, err2)
    (gate_dir / "pytest_full.log").write_text(
        out2 + "\n===== STDERR =====\n" + err2, encoding="utf-8")

    m = re.search(r"(\d+) passed", out2 + err2)
    passed = int(m.group(1)) if m else 0
    mf = re.search(r"(\d+) failed", out2 + err2)
    failed = int(mf.group(1)) if mf else 0
    me = re.search(r"(\d+) error", out2 + err2)
    errors = int(me.group(1)) if me else 0
    ms = re.search(r"(\d+) skipped", out2 + err2)
    skipped = int(ms.group(1)) if ms else 0
    summary = {
        "collected": n, "passed": passed, "failed": failed, "errors": errors,
        "skipped": skipped, "durationSeconds": round(dt2, 1),
        "exitCode": code2, "historicalReferenceCount": HISTORICAL_REFERENCE,
        "countDelta": n - HISTORICAL_REFERENCE,
        "harnessLeakedIntoDiscovery": leaked,
    }
    (gate_dir / "pytest_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    observations, failures = [], []
    if leaked:
        failures.append(f"FG_TEST_INFRA_FAILURE: harness files collected: {leaked[:5]}")
    if n < HISTORICAL_REFERENCE:
        failures.append(
            f"unexplained test-count reduction: collected={n} < "
            f"reference={HISTORICAL_REFERENCE} (delta={n - HISTORICAL_REFERENCE})")
    else:
        observations.append(
            f"collected={n} vs reference={HISTORICAL_REFERENCE} (delta={n - HISTORICAL_REFERENCE})")
    if failed or errors:
        failures.append(f"product regression: failed={failed} errors={errors}")
    if code2 != 0 and not (failed or errors):
        failures.append(f"pytest exit={code2} without failed/error counts parsed")

    status = GateStatus.PASS if not failures else GateStatus.FAIL
    write_gate_result(gate_dir, GateResult(
        gate="G01", name="Full Canonical Regression", status=status,
        hard_blocker=True,
        failure_kind=("FG_PRODUCT_FAILURE" if failures else None),
        evidence=["collected_tests.txt", "pytest_full.log", "pytest_summary.json"],
        observations=observations, failures=tuple(failures)))
    env_ref = {"environmentFingerprintId": "env-2b43194081ee"}
    try:
        write_json_create_only(gate_dir / "environment_ref.json", env_ref)
    except FileExistsError:
        pass
    lines = [f"# G01 Full Canonical Regression — {status.value}",
             "", f"collected={n} passed={passed} failed={failed} errors={errors} "
                 f"skipped={skipped} exit={code2} ({dt2:.0f}s)",
             f"reference={HISTORICAL_REFERENCE} delta={n - HISTORICAL_REFERENCE}"]
    (gate_dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"G01 {status.value}: collected={n} passed={passed} failed={failed} "
          f"errors={errors} exit={code2}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
