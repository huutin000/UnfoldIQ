"""Phase 7 canonical JSON + SHA-256 manifest hashing.

Canonicalization contract (manifest v1): UTF-8, ``sort_keys=True``,
compact separators, ``ensure_ascii=False``, ``allow_nan=False``. This is
the documented deterministic subset needed by manifest v1 — not a claim
of strict RFC 8785 compatibility. If strict RFC 8785 is required later,
the schema version must control the migration.
"""
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping


def canonical_json_bytes(value: Any) -> bytes:
    text = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return text.encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_hash_payload(manifest: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(manifest)
    payload.pop("manifestHash", None)
    return payload


def compute_manifest_hash(manifest: Mapping[str, Any]) -> str:
    return sha256_hex(canonical_json_bytes(manifest_hash_payload(manifest)))


def hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
