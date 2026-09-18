"""Phase 7 resolver contract: shared Phase 4 semantics, no silent upgrades."""
import pytest

from studio.asset_registry import AssetResolution, resolve_asset_role


def _entry(**over):
    base = {"asset_id": "a1", "lifecycle": None, "entity_id": None,
            "checksum": "c", "accepted_version": 1, "master": "m.png"}
    base.update(over)
    return base


def test_locked_is_accepted():
    r = resolve_asset_role(registry_entry=_entry(lifecycle="LOCKED"))
    assert isinstance(r, AssetResolution) and r.role == "accepted"


def test_approved_is_accepted():
    r = resolve_asset_role(registry_entry=_entry(lifecycle="APPROVED"))
    assert r.role == "accepted"


def test_selected_is_unapproved():
    r = resolve_asset_role(registry_entry=_entry(lifecycle="SELECTED"))
    assert r.role == "unapproved"


def test_generated_is_unapproved():
    r = resolve_asset_role(registry_entry=_entry(lifecycle="GENERATED"))
    assert r.role == "unapproved"


def test_rejected_is_rejected():
    r = resolve_asset_role(registry_entry=_entry(lifecycle="REJECTED"))
    assert r.role == "rejected"


def test_unknown_lifecycle_is_unapproved():
    r = resolve_asset_role(registry_entry=_entry(lifecycle="WHATEVER"))
    assert r.role == "unapproved"


def test_visual_bible_canonical_binding_is_canonical_reference():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle=None, entity_id=None),
        canonical_binding={"entity_id": "char_1"},
    )
    assert r.role == "canonicalReference"
    assert r.entity_id == "char_1"


def test_entity_id_entry_is_canonical_reference():
    r = resolve_asset_role(registry_entry=_entry(entity_id="char_9"))
    assert r.role == "canonicalReference"


def test_resolution_carries_provenance():
    r = resolve_asset_role(
        registry_entry=_entry(asset_id="ax", lifecycle="LOCKED",
                              checksum="deadbeef", accepted_version=7,
                              master="assets/m.png"))
    assert (r.asset_id, r.accepted_version, r.checksum, r.file_path) == \
        ("ax", 7, "deadbeef", "assets/m.png")


def test_portable_package_uses_shared_resolver():
    import studio.portable_package as pp
    import inspect
    src = inspect.getsource(pp.resolve_asset_role)
    assert "resolve_asset_role" in src  # delegates to shared resolver
    assert pp.resolve_asset_role({"lifecycle": "LOCKED"}) == "accepted"
    assert pp.resolve_asset_role({"lifecycle": "SELECTED"}) == "unapproved"
    assert pp.resolve_asset_role({"lifecycle": "REJECTED"}) == "rejected"
    assert pp.resolve_asset_role({"entity_id": "e"}) == "canonicalReference"
    # lifecycle governs even with a binding present (GAP A matrix)
    assert pp.resolve_asset_role(
        {"lifecycle": "REJECTED", "entity_id": "e"}) == "rejected"


def test_rejected_plus_binding_is_rejected():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle="REJECTED", entity_id="char_1"),
        canonical_binding={"entity_id": "char_1"})
    assert r.role == "rejected"


def test_selected_plus_binding_is_unapproved():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle="SELECTED"),
        canonical_binding={"entity_id": "char_1"})
    assert r.role == "unapproved"


def test_generated_plus_binding_is_unapproved():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle="GENERATED", entity_id="char_1"),
        canonical_binding={"entity_id": "char_1"})
    assert r.role == "unapproved"


def test_approved_plus_binding_is_accepted():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle="APPROVED"),
        canonical_binding={"entity_id": "char_1"})
    assert r.role == "accepted"


def test_locked_plus_binding_is_accepted():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle="LOCKED", entity_id="char_1"),
        canonical_binding={"entity_id": "char_1"})
    assert r.role == "accepted"


def test_no_lifecycle_plus_binding_is_canonical_reference():
    r = resolve_asset_role(
        registry_entry=_entry(lifecycle=None, entity_id=None),
        canonical_binding={"entity_id": "char_1"})
    assert r.role == "canonicalReference"
    assert r.entity_id == "char_1"
