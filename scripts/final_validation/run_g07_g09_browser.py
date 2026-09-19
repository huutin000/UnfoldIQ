"""G07/G08/G09 — Browser, Responsive, Accessibility (Task 9, validation-only).

Usage: run_g07_g09_browser.py <g07|g08|g09|evid05|finalize>
Each batch runs canonical scripts with bounded timeouts, capturing raw logs.
`finalize` aggregates batch logs into independent browser/result.json,
responsive/result.json, accessibility/result.json (conservative: any nonzero
script exit in a gate's set -> gate FAIL; T14 adjudicates infra vs product).
Fresh browser contexts: every canonical script launches its own CDP browser
with a fresh/temp profile (no shared session).
"""
from __future__ import annotations

import json
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

ROOT = REPO / "temp" / "final_system_validation"
BDIR = ROOT / "browser"
RDIR = ROOT / "responsive"
ADIR = ROOT / "accessibility"

BATCHES = {
    "g07": [("scripts/verify_phase06_browser.py", 1200),
            ("scripts/verify_phase09_browser.py", 1500)],
    "g08": [("scripts/verify_phase06_closure_breakpoints.py", 900),
            ("scripts/verify_phase06_closure_breakpoints_real.py", 900),
            ("scripts/verify_phase06_closure_zoom200.py", 900),
            ("scripts/verify_phase06_twogate_zoom1080.py", 1200),
            ("scripts/verify_phase06_twogate_zoom1080_drawer.py", 1200)],
    "g09": [("scripts/verify_phase06_manual.py", 900),
            ("scripts/verify_phase06_target_sizes.py", 900),
            ("scripts/verify_phase06_palette_dense.py", 900),
            ("scripts/verify_phase06_closure_focus.py", 900),
            ("scripts/verify_phase06_closure_keyboard.py", 900),
            ("scripts/verify_phase06_closure_screenreader.py", 1200),
            ("scripts/verify_phase06_closure_screenreader2.py", 1200),
            ("scripts/verify_phase06_twogate_sr_human.py", 1200)],
    "evid05": [("scripts/verify_phase05_browser.py", 900),
               ("scripts/verify_phase05_followup.py", 900),
               ("scripts/verify_phase05_frame_evidence.py", 900),
               ("scripts/verify_phase05_headed.py", 1500),
               ("scripts/verify_phase05_palette.py", 900),
               ("scripts/verify_phase05_palette_dense.py", 900),
               ("scripts/verify_phase05_performance.py", 1500),
               ("scripts/verify_phase05_sustained.py", 1500),
               ("scripts/verify_phase05_virtualization.py", 900)],
}

BATCH_DIR = {"g07": BDIR, "g08": RDIR, "g09": ADIR, "evid05": ROOT / "browser"}


def run_batch(name: str) -> dict:
    d = BATCH_DIR[name]
    (d / "raw").mkdir(parents=True, exist_ok=True)
    clog = d / "commands.log"
    outcomes = []
    for script, tmo in BATCHES[name]:
        t0 = time.time()
        try:
            r = subprocess.run([sys.executable, script], cwd=str(REPO),
                               capture_output=True, text=True, timeout=tmo)
            code, out = r.returncode, (r.stdout or "") + "\n===== STDERR =====\n" + (r.stderr or "")
            note = ""
        except subprocess.TimeoutExpired as e:
            code, out = 124, f"TIMEOUT after {tmo}s\n" + str((e.stdout or "")[-2000:])
            note = "timeout"
        (d / "raw" / (Path(script).stem + ".log")).write_text(out[-60000:],
                                                              encoding="utf-8")
        append_command_log(clog, [script], code, out[-8000:], "")
        outcomes.append({"script": script, "exit": code,
                         "seconds": round(time.time() - t0, 1), "note": note})
        print(f"[{name}] {script} exit={code} {note}", flush=True)
    (d / f"batch_{name}.json").write_text(json.dumps(outcomes, indent=2) + "\n",
                                          encoding="utf-8")
    return {o["script"]: o for o in outcomes}


GATE_MAP = {
    "G07": ("browser", "Browser Workflow", True,
            ["g07"], BDIR),
    "G08": ("responsive", "Responsive Layout Matrix", False,
            ["g08"], RDIR),
    "G09": ("accessibility", "Accessibility Hardening", False,
            ["g09"], ADIR),
}


def finalize() -> int:
    merged: dict[str, dict] = {}
    for b in ("g07", "g08", "g09", "evid05"):
        p = BATCH_DIR[b] / f"batch_{b}.json"
        if p.is_file():
            for o in json.loads(p.read_text(encoding="utf-8")):
                merged[o["script"]] = o
    (ROOT / "browser" / "evid05_summary.json").write_text(json.dumps(
        {k: v for k, v in merged.items() if k.startswith("scripts/verify_phase05")},
        indent=2) + "\n", encoding="utf-8")

    rc = 0
    for gate, (slug, name, hard, batches, d) in GATE_MAP.items():
        scripts = [s for b in batches for s, _ in BATCHES[b]]
        missing = [s for s in scripts if s not in merged]
        bad = [s for s in scripts
               if s in merged and merged[s]["exit"] != 0]
        fails = [f"{s} exit={merged[s]['exit']}" for s in bad]
        if missing:
            fails.append(f"batch not run: {missing}")
        obs = [f"{s}: exit={merged[s]['exit']} ({merged[s].get('seconds', '?')}s)"
               for s in scripts if s in merged]
        status = GateStatus.PASS if not fails else GateStatus.FAIL
        if status == GateStatus.FAIL:
            rc = 1
        write_gate_result(d, GateResult(
            gate=gate, name=name, status=status, hard_blocker=hard,
            failure_kind=("FG_PRODUCT_FAILURE" if fails else None),
            evidence=[f"batch_{b}.json" for b in batches] + ["raw/"],
            observations=tuple(obs), failures=tuple(fails)))
        try:
            write_json_create_only(d / "environment_ref.json",
                                   {"environmentFingerprintId": "env-2b43194081ee"})
        except FileExistsError:
            pass
        (d / "summary.md").write_text(f"# {gate} {name} — {status.value}\n",
                                      encoding="utf-8")
        print(f"{gate} {status.value}: {fails}")
    return rc


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in BATCHES and argv[1] != "finalize":
        print("usage: g07|g08|g09|evid05|finalize")
        return 2
    if argv[1] == "finalize":
        return finalize()
    run_batch(argv[1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
