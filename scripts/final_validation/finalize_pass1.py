"""Final-Gate Pass 1 Finalizer (Task 14, validation-only).

1. Verifies evidence completeness for all G01-G13 gates.
2. Builds canonical blocker register (blocker_register/blockers.json).
3. Reduces mechanical candidate verdict.
4. Generates pass1_summary.json and final_validation_summary.md.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, reduce_candidate_verdict, write_json_create_only,
)

GATE_DIR = REPO / "temp" / "final_system_validation"
BLOCKERS_DIR = GATE_DIR / "blocker_register"

GATES_SPEC = [
    ("G01", "Full Canonical Regression", "regression", True),
    ("G02", "Canonical 79/141 Full E2E", "e2e", True),
    ("G03", "Data Integrity & Persistence", "data_integrity", True),
    ("G04", "Dependency Engine Micro-Propagation", "dependency", True),
    ("G05", "Version / Lock / Restore", "versions_and_locks", True),
    ("G06", "Resource Scheduler & Recovery", "resource_scheduler", True),
    ("G07", "Browser Workflow", "browser", True),
    ("G08", "Responsive Layout Matrix", "responsive", False),
    ("G09", "Accessibility Hardening", "accessibility", False),
    ("G10", "Portable Export Package", "export_package", True),
    ("G11", "Render Manifest Verification", "render_manifest", True),
    ("G12", "Final Render Deliverable", "render", True),
    ("G13", "Automated Render QA", "render_qa", True),
]


def _read_gate_result(gate_dir: Path) -> dict | None:
    # Check corrective_rerun_01 first for effective verdict, fallback to initial
    rerun = gate_dir / "corrective_rerun_01" / "result.json"
    if rerun.is_file():
        try:
            return json.loads(rerun.read_text(encoding="utf-8"))
        except Exception:
            pass
    initial = gate_dir / "result.json"
    if initial.is_file():
        try:
            return json.loads(initial.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def main() -> int:
    BLOCKERS_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    missing_evidence: list[str] = []
    gate_objects: list[GateResult] = []

    for gate, name, sub_dir, hard in GATES_SPEC:
        gdir = GATE_DIR / sub_dir
        initial_res = gdir / "result.json"
        rerun_res = gdir / "corrective_rerun_01" / "result.json"

        res_data = None
        has_rerun = rerun_res.is_file()
        target_file = rerun_res if has_rerun else initial_res

        if target_file.is_file():
            try:
                res_data = json.loads(target_file.read_text(encoding="utf-8"))
            except Exception as e:
                missing_evidence.append(f"{gate}: unreadable result.json ({e})")
        else:
            missing_evidence.append(f"{gate}: missing result.json in {gdir}")

        if res_data:
            # Check required gate files
            active_dir = gdir / "corrective_rerun_01" if has_rerun else gdir
            if not (active_dir / "summary.md").is_file() and not (gdir / "summary.md").is_file():
                missing_evidence.append(f"{gate}: missing summary.md")
            if not (active_dir / "commands.log").is_file() and not (gdir / "commands.log").is_file():
                missing_evidence.append(f"{gate}: missing commands.log")
            if not (active_dir / "environment_ref.json").is_file() and not (gdir / "environment_ref.json").is_file():
                missing_evidence.append(f"{gate}: missing environment_ref.json")

            st = GateStatus(res_data.get("status", "NOT RUN"))
            results.append({
                "gate": gate,
                "name": name,
                "status": st.value,
                "hardBlocker": hard,
                "hasRerun": has_rerun,
                "failureKind": res_data.get("failureKind"),
                "failures": res_data.get("failures", []),
                "observations": res_data.get("observations", []),
            })
            gate_objects.append(GateResult(
                gate=gate,
                name=name,
                status=st,
                hard_blocker=hard,
                failure_kind=res_data.get("failureKind"),
                evidence=tuple(res_data.get("evidence", [])),
                observations=tuple(res_data.get("observations", [])),
                failures=tuple(res_data.get("failures", [])),
            ))
        else:
            results.append({
                "gate": gate,
                "name": name,
                "status": "NOT RUN",
                "hardBlocker": hard,
                "hasRerun": False,
                "failures": ["Gate evidence missing or unparseable"],
                "observations": [],
            })
            gate_objects.append(GateResult(
                gate=gate,
                name=name,
                status=GateStatus.NOT_RUN,
                hard_blocker=hard,
                failure_kind="FG_EVIDENCE_INCOMPLETE",
                failures=("Gate evidence missing or unparseable",),
            ))

    # Build canonical blocker register
    blockers = [
        {
            "id": "FG-001",
            "gate": "G04",
            "severity": "BLOCKER",
            "category": "DEPENDENCY_ENGINE",
            "summary": "Micro-propagation wiring gap: PATCH /script/v2 sets coarse outdatedDependencies flags but does NOT call update_node_content on DAG; false negative propagation to shots 001-003.",
            "reproduction": ["py -3 scripts/final_validation/run_g04_dependency.py"],
            "expected": "Granular DAG node update triggers downstream micro-propagation only to affected shots.",
            "actual": "FP=0, FN=4; script edit does not propagate through dependency graph to shot nodes.",
            "evidence": ["temp/final_system_validation/dependency/result.json"],
            "affectedSubsystem": "studio/script_service.py vs studio/dependency_graph.py",
            "status": "OPEN",
        },
        {
            "id": "FG-002",
            "gate": "G01",
            "severity": "BLOCKER",
            "category": "REGRESSION_SUITE",
            "summary": "18 regression tests fail in corrective rerun (1043 passed / 18 failed): 1 test encodes stale live reference project assumption (3D veo), and 17 tests require live Windows Narrator human validation artifacts or headed UI console clean state.",
            "reproduction": ["py -3 scripts/final_validation/run_g01_regression.py --rerun corrective_rerun_01"],
            "expected": "1062/1062 tests PASS (100% regression green).",
            "actual": "1043 passed, 18 failed, 1 skipped.",
            "evidence": ["temp/final_system_validation/regression/corrective_rerun_01/result.json", "temp/final_system_validation/regression/corrective_rerun_01/pytest_full.log"],
            "affectedSubsystem": "tests/test_phase03d_export_workbench.py, tests/test_phase06_twogate_closure.py, tests/test_phase05_closure.py",
            "status": "OPEN",
        },
        {
            "id": "FG-003",
            "gate": "G11",
            "severity": "CONDITIONAL",
            "category": "EXPORT_MANIFEST_PIPELINE",
            "summary": "G11 standalone validator expects accepted assets in intake_ledger.json; validation fixtures provisioned into references/ produce PATH_SANDBOX_AND_PRESENCE validation blockers in standalone harness.",
            "reproduction": ["py -3 scripts/final_validation/run_g11_manifest.py"],
            "expected": "Timeline compiler and export validation seamlessly accept all provisioned fixture assets.",
            "actual": "Validation blockers flagged due to intake ledger vs references placement disparity.",
            "evidence": ["temp/final_system_validation/render_manifest/result.json"],
            "affectedSubsystem": "studio/timeline_compiler.py, scripts/final_validation/run_g11_manifest.py",
            "status": "OPEN",
        },
        {
            "id": "FG-004",
            "gate": "G09",
            "severity": "OBSERVATION",
            "category": "TEST_INFRASTRUCTURE",
            "summary": "Phase 5 browser virtualization scripts in evid05 batch showed 3/9 failures under headed CDP automation due to websocket drop and missing visual group selectors.",
            "reproduction": ["py -3 scripts/final_validation/run_g07_g09_browser.py evid05"],
            "expected": "Headed browser virtualization tests run cleanly without CDP connection drops.",
            "actual": "3/9 tests failed on CDP connection drop or selector timing.",
            "evidence": ["temp/final_system_validation/browser/batch_evid05.json"],
            "affectedSubsystem": "scripts/verify_phase05_browser.py, scripts/verify_phase05_virtualization.py",
            "status": "OPEN",
        },
    ]

    (BLOCKERS_DIR / "blockers.json").write_text(json.dumps(blockers, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Calculate verdict
    verdict = reduce_candidate_verdict(gate_objects)

    pass1_summary = {
        "candidateVerdict": verdict,
        "reviewStatus": "REVIEW PENDING",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totalGates": len(GATES_SPEC),
        "passedGates": sum(1 for r in results if r["status"] == "PASS"),
        "failedGates": sum(1 for r in results if r["status"] == "FAIL"),
        "notRunGates": sum(1 for r in results if r["status"] == "NOT RUN"),
        "gates": results,
        "blockers": blockers,
        "missingEvidence": missing_evidence,
    }
    (GATE_DIR / "pass1_summary.json").write_text(json.dumps(pass1_summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Generate final_validation_summary.md
    summary_lines = [
        "# Final System Integration & Production Validation Gate — Pass 1 Summary",
        "",
        f"- **Candidate Verdict:** `{verdict}`",
        "- **Workflow Status:** `VALIDATION COMPLETE / REVIEW PENDING`",
        f"- **Generated At:** `{pass1_summary['generatedAt']}`",
        f"- **Total Gates Evaluated:** {len(GATES_SPEC)}",
        f"- **Pass Rate:** {pass1_summary['passedGates']}/{len(GATES_SPEC)} gates PASS ({round(pass1_summary['passedGates']/len(GATES_SPEC)*100, 1)}%)",
        "",
        "## Gate Results Matrix",
        "",
        "| Gate | Name | Status | Rerun | Hard Blocker | Failure Kind |",
        "|---|---|:---:|:---:|:---:|---|",
    ]
    for r in results:
        status_badge = "✅ PASS" if r["status"] == "PASS" else ("❌ FAIL" if r["status"] == "FAIL" else "⚪ NOT RUN")
        rerun_badge = "Yes" if r["hasRerun"] else "No"
        summary_lines.append(f"| {r['gate']} | {r['name']} | {status_badge} | {rerun_badge} | {r['hardBlocker']} | {r['failureKind'] or '-'} |")

    summary_lines.extend([
        "",
        "## Canonical Blocker Register",
        "",
        "| ID | Gate | Severity | Category | Summary | Subsystem |",
        "|---|---|:---:|---|---|---|",
    ])
    for b in blockers:
        summary_lines.append(f"| {b['id']} | {b['gate']} | `{b['severity']}` | {b['category']} | {b['summary']} | `{b['affectedSubsystem']}` |")

    summary_lines.extend([
        "",
        "## Mechanical Candidate Verdict Reduction",
        "",
        f"Per common.py `reduce_candidate_verdict`: Core gates contain hard blockers (`FG-001` G04 micro-propagation wiring gap, `FG-002` G01 18 regression failures) -> **Candidate Verdict: `{verdict}`**.",
        "",
        "> **Notice:** The execution agent does NOT declare `FINAL / VERIFIED`. This verdict is a mechanical reduction awaiting human review and authorized corrective closure.",
        ""
    ])
    (GATE_DIR / "final_validation_summary.md").write_text("\n".join(summary_lines), encoding="utf-8")

    print(f"Pass 1 Finalized: Verdict={verdict} ({pass1_summary['passedGates']}/{len(GATES_SPEC)} PASS)")
    print(f"Blockers: {len(blockers)} recorded in {BLOCKERS_DIR / 'blockers.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
