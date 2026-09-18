"""Phase 7 hashing tests: determinism, self-exclusion, sensitivity."""
import math

import pytest

from studio.render_manifest_hashing import (
    canonical_json_bytes,
    compute_manifest_hash,
    hash_file,
    manifest_hash_payload,
    sha256_hex,
)


def test_canonical_hash_is_property_order_independent():
    a = {"b": 2, "a": 1}
    b = {"a": 1, "b": 2}
    assert canonical_json_bytes(a) == canonical_json_bytes(b)


def test_canonical_bytes_are_compact_sorted_utf8():
    out = canonical_json_bytes({"b": [1, 2], "a": "x"})
    assert out == '{"a":"x","b":[1,2]}'.encode("utf-8")


def test_manifest_hash_excludes_manifest_hash_field():
    a = {"schemaVersion": "1.0.0", "manifestHash": "old", "projectId": "p1"}
    b = {"schemaVersion": "1.0.0", "manifestHash": "different", "projectId": "p1"}
    assert compute_manifest_hash(a) == compute_manifest_hash(b)


def test_meaningful_change_changes_manifest_hash():
    a = {"projectId": "p1", "videoTrack": {"clips": []}}
    b = {"projectId": "p2", "videoTrack": {"clips": []}}
    assert compute_manifest_hash(a) != compute_manifest_hash(b)


def test_hash_payload_drops_only_manifest_hash():
    payload = manifest_hash_payload({"manifestHash": "x", "a": 1})
    assert payload == {"a": 1}


def test_rejects_nan_and_infinity():
    with pytest.raises(ValueError):
        canonical_json_bytes({"v": math.nan})
    with pytest.raises(ValueError):
        canonical_json_bytes({"v": math.inf})


def test_sha256_hex_known_vector():
    assert sha256_hex(b"abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


def test_hash_file_matches_bytes(tmp_path):
    p = tmp_path / "f.bin"
    p.write_bytes(b"hello")
    assert hash_file(p) == sha256_hex(b"hello")


def test_manifest_model_hash_roundtrip():
    from studio.render_manifest import RenderManifest
    m = RenderManifest.minimal_for_test()
    h1 = compute_manifest_hash(m.model_dump(mode="json"))
    h2 = compute_manifest_hash(m.model_dump(mode="json"))
    assert h1 == h2 and len(h1) == 64
