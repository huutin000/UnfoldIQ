"""Final-Gate validation-only harness core (Task 2).

No product imports. All evidence writes are create-only (append-only history).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path


class GateStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_RUN = "NOT RUN"


class FailureKind(str, Enum):
    ENVIRONMENT = "FG_ENVIRONMENT_FAILURE"
    TEST_INFRA = "FG_TEST_INFRA_FAILURE"
    PRODUCT = "FG_PRODUCT_FAILURE"
    DATA_INTEGRITY = "FG_DATA_INTEGRITY_FAILURE"
    SECURITY_SAFETY = "FG_SECURITY_SAFETY_FAILURE"
    EVIDENCE_INCOMPLETE = "FG_EVIDENCE_INCOMPLETE"


FAILURE_KINDS = tuple(k.value for k in FailureKind)


@dataclass(frozen=True)
class GateResult:
    gate: str
    name: str
    status: GateStatus
    hard_blocker: bool
    failure_kind: str | None = None
    evidence: tuple[str, ...] = ()
    observations: tuple[str, ...] = ()
    failures: tuple[str, ...] = ()

    def __post_init__(self):
        if not isinstance(self.status, GateStatus):
            raise ValueError(f"invalid gate status: {self.status!r}")
        if self.failure_kind is not None and self.failure_kind not in FAILURE_KINDS:
            raise ValueError(f"invalid failure kind: {self.failure_kind!r}")

    def to_dict(self) -> dict:
        return {
            "gate": self.gate,
            "name": self.name,
            "status": self.status.value,
            "hardBlocker": self.hard_blocker,
            "inputs": [],
            "evidence": list(self.evidence),
            "observations": list(self.observations),
            "failures": list(self.failures),
            **({"failureKind": self.failure_kind} if self.failure_kind else {}),
        }


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def inventory_tree(root: Path) -> dict:
    root = root.resolve()
    files = []
    for p in sorted(root.rglob("*")):
        if p.is_file():
            rel = p.relative_to(root).as_posix()
            files.append({
                "rel": rel,
                "size": p.stat().st_size,
                "sha256": sha256_file(p),
            })
    files.sort(key=lambda e: e["rel"])
    return {"root": str(root), "count": len(files), "files": files}


def assert_within(root: Path, candidate: Path) -> Path:
    """Resolve *candidate* and refuse any path escaping *root*."""
    base = root.resolve()
    target = candidate.resolve() if candidate.is_absolute() else (base / candidate).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise ValueError(f"path escapes validation root: {candidate}")
    return target


def write_json_create_only(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "x", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


def append_command_log(path: Path, argv: list[str], exit_code: int,
                       stdout: str, stderr: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "at": datetime.now(timezone.utc).isoformat(),
        "argv": list(argv),
        "exitCode": exit_code,
        "stdout": stdout[-8000:],
        "stderr": stderr[-8000:],
    }
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def write_gate_result(gate_dir: Path, result: GateResult) -> dict:
    """Write ``result.json`` create-only; return the payload dict."""
    payload = result.to_dict()
    payload["startedAt"] = payload.get("startedAt", "")
    payload["completedAt"] = datetime.now(timezone.utc).isoformat()
    write_json_create_only(gate_dir / "result.json", payload)
    return payload


def allocate_blocker_id(existing: list[dict]) -> str:
    used = set()
    for b in existing:
        bid = str(b.get("id", ""))
        if bid.startswith("FG-") and bid[3:].isdigit():
            used.add(int(bid[3:]))
    nxt = (max(used) + 1) if used else 1
    return f"FG-{nxt:03d}"


def should_retry_infra(attempt: int, product_failure: bool) -> bool:
    """One immediate retry for infrastructure flakiness only (spec §9.4)."""
    if product_failure:
        return False
    return attempt == 0


# Gates whose failure alone can only ever be CONDITIONAL (non-core UX).
_NON_CORE_GATES = frozenset({"G07", "G08", "G09"})

# Core gates: any FAIL or mandatory NOT RUN forces NOT READY.
_CORE_GATES = frozenset(
    {"G01", "G02", "G03", "G04", "G05", "G06", "G10", "G11", "G12", "G13"}
)


def reduce_candidate_verdict(results: list[GateResult]) -> str:
    """Mechanical candidate verdict. Never emits FINAL / VERIFIED."""
    by_gate = {r.gate: r for r in results}
    for g in _CORE_GATES:
        r = by_gate.get(g)
        if r is None or r.status == GateStatus.NOT_RUN:
            return "NOT READY"
        if r.status == GateStatus.FAIL:
            return "NOT READY"
    non_core_fail = [
        r for r in results
        if r.gate in _NON_CORE_GATES and r.status == GateStatus.FAIL
    ]
    non_core_notrun = [
        r for r in results
        if r.gate in _NON_CORE_GATES and r.status == GateStatus.NOT_RUN
    ]
    if non_core_notrun:
        return "NOT READY"
    if non_core_fail:
        if all(not r.hard_blocker for r in non_core_fail):
            return "CONDITIONAL"
        return "NOT READY"
    if all(r.status == GateStatus.PASS for r in results):
        return "PRODUCTION READY"
    return "NOT READY"
