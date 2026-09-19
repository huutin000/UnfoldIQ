"""G05 — Version / Lock / Restore with restart (Task 7, validation-only).

Served temp project (baseline clone, deleted afterwards) + real HTTP via
TestClient + owned coldstart restart. Records production behavior exactly as
observed; no weaker substitutions. Evidence: versions_and_locks/.
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
    GateResult, GateStatus, append_command_log, sha256_file,
    write_gate_result, write_json_create_only,
)
from scripts.final_validation.prepare_final_gate import (  # noqa: E402
    BASE_PROJECT, coldstart, port_open,
)

GATE_DIR = REPO / "temp" / "final_system_validation" / "versions_and_locks"
SERVED_NAME = "FG_G05_versions"
SHOT_ID = "shot_001"


def _shot_text(served: Path, shot_id: str) -> str:
    data = json.loads((served / "veo_prompts.json").read_text(encoding="utf-8"))
    sh = next(s for s in data["shots"] if s.get("shot_id") == shot_id)
    return json.dumps(sh, sort_keys=True, ensure_ascii=False)


def main() -> int:
    GATE_DIR.mkdir(parents=True, exist_ok=True)
    clog = GATE_DIR / "commands.log"
    raw: dict = {}
    fails: list[str] = []
    obs: list[str] = []
    t0 = time.time()

    served = REPO / "projects" / SERVED_NAME
    if served.exists():
        shutil.rmtree(served)
    shutil.copytree(BASE_PROJECT, served)

    from starlette.testclient import TestClient
    from studio.app import app
    client = TestClient(app)

    g = client.get(f"/api/projects/{SERVED_NAME}/visual/shots/{SHOT_ID}")
    assert g.status_code == 200, f"GET shot HTTP {g.status_code}"
    raw["shot_before"] = g.json()
    h0 = client.get(f"/api/projects/{SERVED_NAME}/history/shot/{SHOT_ID}")
    hist0 = h0.json() if h0.status_code == 200 else []
    raw["history_before_count"] = len(hist0) if isinstance(hist0, list) else h0.status_code
    before_text = _shot_text(served, SHOT_ID)

    # Meaningful revision via production PATCH route.
    probe = "[Final-Gate G05 revision probe]"
    p = client.patch(f"/api/projects/{SERVED_NAME}/visual/shots/{SHOT_ID}",
                     json={"veo_prompt": probe, "override_lock": False})
    raw["patch"] = {"http": p.status_code,
                    "body": p.json() if p.status_code == 200 else p.text[:300]}
    assert p.status_code == 200, f"PATCH HTTP {p.status_code}: {p.text[:300]}"
    h1 = client.get(f"/api/projects/{SERVED_NAME}/history/shot/{SHOT_ID}")
    hist1 = h1.json() if h1.status_code == 200 else []
    raw["history_after_patch_count"] = len(hist1) if isinstance(hist1, list) else h1.status_code
    if isinstance(hist1, list) and len(hist1) == (len(hist0) if isinstance(hist0, list) else -1):
        obs.append("PATCH shot does NOT create a version revision (history unchanged); "
                   "production create_revision has no shot-edit caller")
    patched_text = _shot_text(served, SHOT_ID)
    assert probe in patched_text

    # Seed one revision via the production VersionManager class (setup for the
    # production restore ROUTE under test; documented, not a product change).
    from studio.project_bootstrap import get_project_state_store
    from studio.version_manager import VersionManager
    vm = VersionManager(get_project_state_store(SERVED_NAME))
    seed = vm.create_revision(project_id=SERVED_NAME, artifact_type="shot",
                              artifact_id=SHOT_ID,
                              snapshot_data={"shotText": patched_text},
                              event_type="MANUAL",
                              message="G05 seed revision for restore test")
    seed_id = seed.revision_id
    obs.append(f"seed revision {seed_id} via production VersionManager")

    # Lock + overwrite protection.
    lk = client.post(f"/api/projects/{SERVED_NAME}/lock/shot/{SHOT_ID}",
                     json={"locked": True})
    raw["lock"] = {"http": lk.status_code,
                   "body": lk.json() if lk.status_code == 200 else lk.text[:300]}
    assert lk.status_code == 200 and lk.json().get("is_locked") is True
    locked_text = _shot_text(served, SHOT_ID)
    bad = client.patch(f"/api/projects/{SERVED_NAME}/visual/shots/{SHOT_ID}",
                       json={"veo_prompt": "MUTATION ATTEMPT",
                             "override_lock": False})
    raw["locked_patch_attempt"] = {"http": bad.status_code, "body": bad.text[:300]}
    if bad.status_code == 409 and _shot_text(served, SHOT_ID) == locked_text:
        obs.append("locked PATCH -> 409 LOCK_CONFLICT, content unchanged")
    else:
        fails.append(f"lock overwrite protection broken: http={bad.status_code}")

    # Restart persistence.
    cs = coldstart()
    assert port_open(7860) and port_open(8880)
    g2 = client.get(f"/api/projects/{SERVED_NAME}/visual/shots/{SHOT_ID}")
    raw["shot_after_restart"] = g2.json()
    from studio.locking import LockManager
    still_locked = LockManager(get_project_state_store(SERVED_NAME)).is_locked(SHOT_ID)
    if still_locked:
        obs.append("lock persists across owned restart/reopen")
    else:
        fails.append("lock LOST across restart")
    raw["restart"] = {"kokoroStartup": cs["kokoro"]["startupSeconds"],
                      "studioStartup": cs["studio"]["startupSeconds"]}

    # LOCKED + OUTDATED coexistence attempt via upstream script edit.
    sj = json.loads((served / "script.json").read_text(encoding="utf-8"))
    sj["sections"][0]["text"] += " [G05 upstream probe]"
    up = client.put(f"/api/projects/{SERVED_NAME}/script/v2",
                    json={"sections": sj["sections"], "new_version": False,
                          "force": True})
    g3 = client.get(f"/api/projects/{SERVED_NAME}/visual/shots/{SHOT_ID}")
    body3 = g3.json()
    raw["upstream_put_http"] = up.status_code
    raw["shot_after_upstream"] = {"outdated": body3.get("outdated"),
                                  "is_locked": body3.get("is_locked")}
    if body3.get("is_locked") is True and body3.get("outdated") is True:
        obs.append("LOCKED + OUTDATED coexist after upstream edit")
    else:
        obs.append(f"LOCKED+OUTDATED coexistence NOT observed "
                   f"(locked={body3.get('is_locked')}, outdated={body3.get('outdated')}); "
                   f"consistent with G04 wiring gap")

    # Restore while locked -> contract; unlock; restore -> verify.
    rr = client.post(f"/api/projects/{SERVED_NAME}/history/{seed_id}/restore",
                     json={})
    raw["restore_locked"] = {"http": rr.status_code, "body": rr.text[:400]}
    if rr.status_code == 409:
        obs.append("restore while locked -> 409 LOCK_CONFLICT (contract)")
    else:
        fails.append(f"restore-while-locked expected 409, got {rr.status_code}")
    ul = client.post(f"/api/projects/{SERVED_NAME}/lock/shot/{SHOT_ID}",
                     json={"locked": False})
    assert ul.status_code == 200
    rr2 = client.post(f"/api/projects/{SERVED_NAME}/history/{seed_id}/restore",
                      json={})
    raw["restore_unlocked"] = {"http": rr2.status_code, "body": rr2.text[:600]}
    if rr2.status_code == 200:
        h2 = client.get(f"/api/projects/{SERVED_NAME}/history/shot/{SHOT_ID}")
        hist2 = h2.json() if h2.status_code == 200 else []
        kinds = [r.get("event_type") for r in hist2] if isinstance(hist2, list) else []
        if "RESTORE" in kinds:
            obs.append("unlock+restore appends RESTORE revision (append-only history)")
        else:
            fails.append("RESTORE revision not appended to history")
    else:
        fails.append(f"restore after unlock failed: http={rr2.status_code}")

    (GATE_DIR / "raw_requests.json").write_text(
        json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    status = GateStatus.PASS if not fails else GateStatus.FAIL
    shutil.rmtree(served, ignore_errors=True)
    append_command_log(clog, ["g05", SHOT_ID, status.value], 0, "", "")
    write_gate_result(GATE_DIR, GateResult(
        gate="G05", name="Version / Lock / Restore", status=status,
        hard_blocker=True,
        failure_kind=("FG_PRODUCT_FAILURE" if fails else None),
        evidence=["raw_requests.json"],
        observations=tuple(obs + [f"duration {round(time.time() - t0, 1)}s"]),
        failures=tuple(fails)))
    try:
        write_json_create_only(GATE_DIR / "environment_ref.json",
                               {"environmentFingerprintId": "env-2b43194081ee"})
    except FileExistsError:
        pass
    (GATE_DIR / "summary.md").write_text(f"# G05 — {status.value}\n", encoding="utf-8")
    print(f"G05 {status.value}: fails={fails}")
    return 0 if status == GateStatus.PASS else 1


if __name__ == "__main__":
    raise SystemExit(main())
