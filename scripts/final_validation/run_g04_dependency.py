"""G04 — Dependency Engine Micro-Propagation (Task 6, validation-only).

Served temp project (fresh baseline clone, deleted afterwards) + real HTTP
via TestClient: graph/next-action before -> mutate exactly one script section
(sec_001) via production PUT script/v2 -> bootstrap reload -> graph after.
Precision: expected = pre-mutation downstream closure of c_01; actual =
newly OUTDATED nodes. Writes immutable evidence to dependency/.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, append_command_log, write_gate_result,
    write_json_create_only,
)
from scripts.final_validation.prepare_final_gate import (  # noqa: E402
    BASE_PROJECT, VALID,
)

import argparse
import os

DEFAULT_GATE_DIR = REPO / "temp" / "final_system_validation" / "dependency"
SERVED_NAME = "FG_G04_dependency"
SECTION_ID = "sec_001"
CHUNK_ID = "c_01"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rerun", default=os.environ.get("FG_RERUN", ""))
    args, _ = parser.parse_known_args()

    gate_dir = DEFAULT_GATE_DIR
    if args.rerun:
        gate_dir = gate_dir / args.rerun

    gate_dir.mkdir(parents=True, exist_ok=True)
    clog = gate_dir / "commands.log"
    t0 = time.time()
    served = REPO / "projects" / SERVED_NAME
    if served.exists():
        shutil.rmtree(served)
    shutil.copytree(BASE_PROJECT, served)
    append_command_log(clog, ["stage-served-copy", SERVED_NAME], 0, str(served), "")

    from starlette.testclient import TestClient
    from studio.app import app
    from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
    client = TestClient(app)

    r = client.get(f"/api/projects/{SERVED_NAME}/dependencies/graph")
    assert r.status_code == 200, f"graph HTTP {r.status_code}: {r.text[:300]}"
    (gate_dir / "graph_before.json").write_text(
        json.dumps(r.json(), indent=2) + "\n", encoding="utf-8")
    r2 = client.get(f"/api/projects/{SERVED_NAME}/next-action")
    (gate_dir / "next_action_before.json").write_text(
        json.dumps(r2.json() if r2.status_code == 200 else {"http": r2.status_code},
                   indent=2) + "\n", encoding="utf-8")

    store = get_project_state_store(SERVED_NAME)
    graph = bootstrap_project_graph(SERVED_NAME, state_store=store)
    expected = set(graph.get_downstream_closure(CHUNK_ID))
    (gate_dir / "expected_descendants.json").write_text(
        json.dumps({"mutatedSection": SECTION_ID, "mappedChunk": CHUNK_ID,
                    "expected": sorted(expected)}, indent=2) + "\n",
        encoding="utf-8")
    before_outdated = {n.artifact_id for n in graph.list_nodes() if n.is_outdated}

    # Mutate exactly one section via the production Story save route.
    sj = json.loads((served / "script.json").read_text(encoding="utf-8"))
    sections = sj["sections"]
    target = next(s for s in sections if s.get("id") == SECTION_ID)
    old_text = target["text"]
    target["text"] = old_text + " [Final-Gate G04 micro-propagation probe]"
    pr = client.put(f"/api/projects/{SERVED_NAME}/script/v2",
                    json={"sections": sections, "new_version": False, "force": True})
    (gate_dir / "mutation_request.json").write_text(json.dumps(
        {"section": SECTION_ID, "oldText": old_text,
         "http": pr.status_code,
         "body": pr.json() if pr.status_code == 200 else pr.text[:500]},
        indent=2) + "\n", encoding="utf-8")
    assert pr.status_code == 200, f"PUT script/v2 HTTP {pr.status_code}: {pr.text[:300]}"

    # Documented reload path: bootstrap (non-force) recompute observation.
    graph2 = bootstrap_project_graph(SERVED_NAME, state_store=store)
    r3 = client.get(f"/api/projects/{SERVED_NAME}/dependencies/graph")
    (gate_dir / "graph_after.json").write_text(
        json.dumps(r3.json(), indent=2) + "\n", encoding="utf-8")
    after_outdated = {n.artifact_id for n in graph2.list_nodes() if n.is_outdated}
    newly = after_outdated - before_outdated
    (gate_dir / "actual_outdated.json").write_text(
        json.dumps({"before": sorted(before_outdated),
                    "after": sorted(after_outdated),
                    "newly": sorted(newly)}, indent=2) + "\n", encoding="utf-8")

    fp = sorted(set(newly) - expected)
    fn = sorted(set(expected) - set(newly))
    stable_ok = True  # section id preserved by construction (same record edited)
    failures = []
    if fp or fn:
        failures.append(f"FG_PRODUCT_FAILURE: micro-propagation imprecise: "
                        f"falsePositive={fp} falseNegative={fn}")
    # Root-cause probes (read-only, recorded as observations).
    obs = [f"mutated {SECTION_ID} (stable id preserved: {stable_ok})",
           f"expected descendants of {CHUNK_ID}: {sorted(expected)}",
           f"newly OUTDATED: {sorted(newly)}",
           f"duration {round(time.time() - t0, 1)}s"]
    try:
        has_chain = hasattr(graph2, "invalidate_dependent_chain")
    except Exception:
        has_chain = False
    obs.append(f"graph.invalidate_dependent_chain exists: {has_chain} "
               f"(save route calls it; missing = silent no-op)")
    obs.append("script node children: "
               f"{sorted(graph2.get_children('script'))} (disconnected)")

    status = GateStatus.PASS if not failures else GateStatus.FAIL
    shutil.rmtree(served, ignore_errors=True)
    append_command_log(clog, ["remove-served-copy", SERVED_NAME], 0, "", "")
    write_gate_result(gate_dir, GateResult(
        gate="G04", name="Dependency Engine Micro-Propagation", status=status,
        hard_blocker=True,
        failure_kind=("FG_PRODUCT_FAILURE" if failures else None),
        evidence=["graph_before.json", "graph_after.json",
                  "expected_descendants.json", "actual_outdated.json",
                  "mutation_request.json", "next_action_before.json"],
        observations=tuple(obs), failures=tuple(failures)))
    try:
        write_json_create_only(gate_dir / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (gate_dir / "summary.md").write_text(
        f"# G04 — {status.value}\nfalsePositive={fp} falseNegative={fn}\n",
        encoding="utf-8")
    print(f"G04 {status.value}: FP={fp} FN={fn}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
