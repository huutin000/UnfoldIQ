"""G03 — Data Integrity & Persistence (Task 5, validation-only).

Fresh G03_integrity copy: byte+semantic inventory -> supported persistence op
(VersionManager.create_revision) -> owned service restart -> re-read & diff.
Writes immutable evidence under temp/final_system_validation/data_integrity/.
"""
from __future__ import annotations

import json
import sqlite3
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.final_validation.common import (  # noqa: E402
    GateResult, GateStatus, append_command_log, sha256_file,
    write_gate_result, write_json_create_only,
)
from scripts.final_validation.prepare_final_gate import (  # noqa: E402
    BASE_PROJECT, COPIES, VALID, coldstart, create_working_copy, port_open,
)

GATE_DIR = REPO / "temp" / "final_system_validation" / "data_integrity"

TRACKED = [
    "script.json", "story_beats.json", "audio.wav", "manifest.json",
    "timestamps.json", "timestamps.srt", "scene_plan.json", "visual_bible.json",
    "veo_prompts.json", "assets/intake_ledger.json", "assets/registry.json",
    "state.db", "exports/metadata.json", "render_cache/manifest.json",
]


def snapshot_state_db(db: Path) -> dict:
    if not db.is_file():
        return {"absent": True}
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        counts = {}
        for t in tables:
            try:
                counts[t] = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except Exception:
                counts[t] = "<unreadable>"
        return {"tables": tables, "counts": counts}
    finally:
        con.close()


def snapshot(proj: Path) -> dict:
    files = {}
    for rel in TRACKED:
        p = proj / rel
        if p.is_file():
            files[rel] = {"size": p.stat().st_size, "sha256": sha256_file(p)}
        else:
            files[rel] = {"absent": True}
    shots, scenes = [], []
    try:
        data = json.loads((proj / "veo_prompts.json").read_text(encoding="utf-8"))
        shots = sorted(s["shot_id"] for s in data.get("shots", []) if isinstance(s, dict))
    except Exception:
        pass
    try:
        data = json.loads((proj / "scene_plan.json").read_text(encoding="utf-8"))
        scenes = sorted(s.get("scene_id", "") for s in data.get("scenes", []) if isinstance(s, dict))
    except Exception:
        pass
    return {"files": files, "stateDb": snapshot_state_db(proj / "state.db"),
            "shotIds": shots, "sceneIds": scenes}


def main() -> int:
    GATE_DIR.mkdir(parents=True, exist_ok=True)
    clog = GATE_DIR / "commands.log"
    t0 = time.time()
    wc = create_working_copy(BASE_PROJECT, COPIES, "G03_integrity")
    append_command_log(clog, ["mkcopy", "G03_integrity"], 0, str(wc), "")

    before = snapshot(wc)
    (GATE_DIR / "before_inventory.json").write_text(
        json.dumps(before, indent=2) + "\n", encoding="utf-8")

    from studio.state_store import StateStore
    from studio.version_manager import VersionManager
    store = StateStore(wc / "state.db")
    graph = store.load_graph(project_id=wc.name)
    nodes = graph.list_nodes()
    if not nodes:
        raise RuntimeError("FG_TEST_INFRA_FAILURE: no DAG nodes in G03 copy")
    target = nodes[0]
    vm = VersionManager(store, graph)
    rev = vm.create_revision(
        project_id=wc.name, artifact_type="shot",
        artifact_id=getattr(target, "artifact_id", "unknown"),
        snapshot_data={"finalGate": "G03-persistence-probe"},
        event_type="MANUAL", message="G03 integrity persistence probe")
    rev_id = getattr(rev, "revision_id", str(rev))

    after_op = snapshot(wc)
    # Owned restart, then reopen (re-read) the copy.
    cs = coldstart()
    (GATE_DIR / "restart_reopen.json").write_text(
        json.dumps({"kokoroStartup": cs["kokoro"]["startupSeconds"],
                    "studioStartup": cs["studio"]["startupSeconds"],
                    "portsAfter": cs["portsAfter"]}, indent=2) + "\n",
        encoding="utf-8")
    assert port_open(7860) and port_open(8880)
    after = snapshot(wc)
    (GATE_DIR / "after_inventory.json").write_text(
        json.dumps(after, indent=2) + "\n", encoding="utf-8")

    # Diff: only the revision-history growth is EXPECTED.
    unexpected, expected = [], [f"revision appended: {rev_id}"]
    for rel, b in before["files"].items():
        a = after["files"].get(rel, {})
        if rel == "state.db":
            continue  # compared semantically below
        if a != b:
            unexpected.append(rel)
    bdb, adb = before["stateDb"], after["stateDb"]
    sem_diff = {"tablesBefore": bdb.get("counts"), "tablesAfter": adb.get("counts")}
    if bdb.get("tables") != adb.get("tables"):
        unexpected.append("state.db: table list changed")
    else:
        for t, c0 in (bdb.get("counts") or {}).items():
            c1 = (adb.get("counts") or {}).get(t)
            if c0 != c1:
                if t.lower().startswith("revision") or "history" in t.lower():
                    expected.append(f"state.db table {t}: {c0} -> {c1}")
                else:
                    unexpected.append(f"state.db table {t}: {c0} -> {c1}")
    if before["shotIds"] != after["shotIds"]:
        unexpected.append("shot ID sequence changed")
    if before["sceneIds"] != after["sceneIds"]:
        unexpected.append("scene ID sequence changed")
    (GATE_DIR / "semantic_diff.json").write_text(json.dumps(
        {"expected": expected, "unexpected": unexpected,
         "stateDb": sem_diff}, indent=2) + "\n", encoding="utf-8")

    failures = [f"UNEXPECTED mutation: {u}" for u in unexpected]
    status = GateStatus.PASS if not failures else GateStatus.FAIL
    write_gate_result(GATE_DIR, GateResult(
        gate="G03", name="Data Integrity & Persistence", status=status,
        hard_blocker=True,
        failure_kind=("FG_DATA_INTEGRITY_FAILURE" if failures else None),
        evidence=["before_inventory.json", "after_inventory.json",
                  "semantic_diff.json", "restart_reopen.json"],
        observations=[f"revision probe {rev_id}",
                      f"duration {round(time.time() - t0, 1)}s"],
        failures=tuple(failures)))
    try:
        write_json_create_only(GATE_DIR / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (GATE_DIR / "summary.md").write_text(
        f"# G03 — {status.value}\nunexpected={len(unexpected)} "
        f"expected={len(expected)}\n", encoding="utf-8")
    print(f"G03 {status.value}: unexpected={unexpected}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
