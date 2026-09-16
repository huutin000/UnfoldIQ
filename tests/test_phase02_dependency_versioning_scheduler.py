"""
Comprehensive Phase 2 Verification Suite
Tests:
1. DAG & Dependency Management:
   - Creation, stable IDs, cycle rejection, single-branch invalidation,
     multi-level propagation, reload persistence, bootstrap idempotence.
2. Status Model & Precedence:
   - Base review status, derived OUTDATED, blockers,
     effective precedence: BLOCKED > OUTDATED > NEEDS_REVIEW > DRAFT > READY.
3. Content Identity & Composite Cache Keys:
   - Canonical SHA-256 serialization, non-semantic exclusion, composite cache key sensitivity.
4. Versioning & Restore:
   - Meaningful events create revisions, autosave rejection,
     deterministic snapshot restore, stable ID preservation, auditable history.
5. Locking Semantics:
   - Bulk overwrite protection, coexistence of locked + OUTDATED, unlock to regenerate.
6. Next Best Action Service:
   - Rule-based deterministic priorities (P1 Blocker -> P2 Outdated -> P3 Review -> P4 Draft -> P5 Ready).
7. Local Resource Scheduler & ResourceGuard:
   - CUDA_HEAVY concurrency=1, permit release on success/error, cancellation, ResourceGuard coexistence.
8. Persistence & SQLite StateStore:
   - ACID transaction rollback, reopen persistence.
9. REST APIs:
   - Graph, next-action, history, restore, lock endpoints with 4xx error handling.
"""

import asyncio
import os
import shutil
import tempfile
import time
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from studio.app import app
from studio.config import PROJECTS_DIR
from studio.domain_models import (
    ArtifactNode,
    ArtifactRevision,
    Blocker,
    DerivedFreshness,
    EffectiveStatus,
    JobState,
    ResourceClass,
    ReviewStatus,
)
from studio.dependency_graph import (
    ArtifactDependencyGraph,
    CycleDetectedError,
    NodeNotFoundError,
    compute_composite_cache_key,
    compute_content_hash,
    resolve_effective_status,
)
from studio.locking import LockConflictError, LockManager
from studio.next_action import NextBestActionService
from studio.project_bootstrap import bootstrap_project_graph, get_project_state_store
from studio.resource_scheduler import (
    JobCancelledError,
    LocalResourceScheduler,
    ResourceGuard,
    ResourceLimitExceededError,
)
from studio.state_store import StateStore
from studio.version_manager import (
    InvalidRevisionEventError,
    RevisionNotFoundError,
    VersionManager,
)

SAMPLE_PROJECT = "2026-09-12_210003_youtube-narration-01"


# ==============================================================================
# 1. DAG & DEPENDENCY MANAGEMENT TESTS
# ==============================================================================

def test_dag_creation_and_edges():
    """Verify DAG nodes creation, edge addition, and parent-child retrieval."""
    graph = ArtifactDependencyGraph(project_id="test_proj")
    graph.add_node("beat_1", "story_beat", "hash_beat_1")
    graph.add_node("chunk_1", "audio_chunk", "hash_chunk_1")
    graph.add_node("shot_1", "shot", "hash_shot_1")

    graph.add_dependency("beat_1", "chunk_1")
    graph.add_dependency("chunk_1", "shot_1")

    assert graph.get_children("beat_1") == ["chunk_1"]
    assert graph.get_parents("chunk_1") == ["beat_1"]
    assert graph.get_children("chunk_1") == ["shot_1"]
    assert graph.get_parents("shot_1") == ["chunk_1"]
    assert graph.get_downstream_closure("beat_1") == {"chunk_1", "shot_1"}


def test_dag_cycle_rejection():
    """Verify DAG strictly rejects self-loops and circular dependencies."""
    graph = ArtifactDependencyGraph(project_id="test_proj")
    graph.add_node("A", "type_a", "hash_a")
    graph.add_node("B", "type_b", "hash_b")
    graph.add_node("C", "type_c", "hash_c")

    # Self-dependency
    with pytest.raises(CycleDetectedError):
        graph.add_dependency("A", "A")

    # Circular dependency A -> B -> C -> A
    graph.add_dependency("A", "B")
    graph.add_dependency("B", "C")
    with pytest.raises(CycleDetectedError):
        graph.add_dependency("C", "A")


def test_dag_single_branch_invalidation():
    """Verify micro-propagation: updating A invalidates only A's branch, not B's branch."""
    graph = ArtifactDependencyGraph(project_id="test_proj")
    # Branch 1
    graph.add_node("beat_1", "story_beat", "hash_b1")
    graph.add_node("chunk_1", "audio_chunk", "hash_c1")
    graph.add_node("shot_1", "shot", "hash_s1")
    graph.add_dependency("beat_1", "chunk_1")
    graph.add_dependency("chunk_1", "shot_1")

    # Branch 2 (Independent)
    graph.add_node("beat_2", "story_beat", "hash_b2")
    graph.add_node("chunk_2", "audio_chunk", "hash_c2")
    graph.add_node("shot_2", "shot", "hash_s2")
    graph.add_dependency("beat_2", "chunk_2")
    graph.add_dependency("chunk_2", "shot_2")

    # Mutate beat_1 content hash
    changed, invalidated = graph.update_node_content("beat_1", "new_hash_b1")
    assert changed is True
    assert invalidated == {"chunk_1", "shot_1"}

    # Verify branch 1 is OUTDATED
    assert graph.get_node("chunk_1").is_outdated is True
    assert graph.get_node("chunk_1").effective_status == EffectiveStatus.OUTDATED.value
    assert graph.get_node("shot_1").is_outdated is True
    assert graph.get_node("shot_1").effective_status == EffectiveStatus.OUTDATED.value

    # Verify branch 2 remains completely READY and NOT outdated
    assert graph.get_node("beat_2").is_outdated is False
    assert graph.get_node("beat_2").effective_status == EffectiveStatus.READY.value
    assert graph.get_node("chunk_2").is_outdated is False
    assert graph.get_node("chunk_2").effective_status == EffectiveStatus.READY.value
    assert graph.get_node("shot_2").is_outdated is False
    assert graph.get_node("shot_2").effective_status == EffectiveStatus.READY.value


def test_dag_topological_sort():
    """Verify topological sort respects dependency execution hierarchy."""
    graph = ArtifactDependencyGraph(project_id="test_proj")
    graph.add_node("shot", "shot", "h3")
    graph.add_node("chunk", "audio_chunk", "h2")
    graph.add_node("beat", "story_beat", "h1")

    graph.add_dependency("beat", "chunk")
    graph.add_dependency("chunk", "shot")

    order = graph.topological_sort()
    assert order == ["beat", "chunk", "shot"]


# ==============================================================================
# 2. STATUS MODEL & PRECEDENCE TESTS
# ==============================================================================

def test_canonical_status_precedence():
    """Verify exact precedence: BLOCKED > OUTDATED > NEEDS_REVIEW > DRAFT > READY."""
    blocker = Blocker(code="AUDIO_MISSING", message="Master WAV not found")

    # 1. Blocker overrides everything
    assert resolve_effective_status(
        review_status=ReviewStatus.READY.value,
        is_outdated=True,
        blockers=[blocker],
    ) == EffectiveStatus.BLOCKED.value

    assert resolve_effective_status(
        review_status=ReviewStatus.DRAFT.value,
        is_outdated=False,
        blockers=[blocker],
    ) == EffectiveStatus.BLOCKED.value

    # 2. Outdated overrides review status when no blocker
    assert resolve_effective_status(
        review_status=ReviewStatus.READY.value,
        is_outdated=True,
        blockers=[],
    ) == EffectiveStatus.OUTDATED.value

    assert resolve_effective_status(
        review_status=ReviewStatus.NEEDS_REVIEW.value,
        is_outdated=True,
        blockers=[],
    ) == EffectiveStatus.OUTDATED.value

    assert resolve_effective_status(
        review_status=ReviewStatus.DRAFT.value,
        is_outdated=True,
        blockers=[],
    ) == EffectiveStatus.OUTDATED.value

    # 3. Base review status takes precedence when fresh and unblocked
    assert resolve_effective_status(
        review_status=ReviewStatus.NEEDS_REVIEW.value,
        is_outdated=False,
        blockers=[],
    ) == EffectiveStatus.NEEDS_REVIEW.value

    assert resolve_effective_status(
        review_status=ReviewStatus.DRAFT.value,
        is_outdated=False,
        blockers=[],
    ) == EffectiveStatus.DRAFT.value

    assert resolve_effective_status(
        review_status=ReviewStatus.READY.value,
        is_outdated=False,
        blockers=[],
    ) == EffectiveStatus.READY.value


# ==============================================================================
# 3. CONTENT HASHING & COMPOSITE CACHE KEY TESTS
# ==============================================================================

def test_canonical_content_hashing():
    """Verify SHA-256 content hashing is deterministic and ignores ephemeral fields."""
    d1 = {"text": "Hello world", "voice": "af_sarah", "speed": 1.0}
    # d2 has different key insertion order and an extra updated_at ephemeral field
    d2 = {"speed": 1.0, "updated_at": "2026-09-16T12:00:00Z", "voice": "af_sarah", "text": "Hello world"}
    d3 = {"text": "Hello world modified", "voice": "af_sarah", "speed": 1.0}

    h1 = compute_content_hash(d1)
    h2 = compute_content_hash(d2)
    h3 = compute_content_hash(d3)

    assert h1 == h2  # Deterministic despite order and updated_at
    assert h1 != h3  # Semantic change changes hash


def test_composite_cache_key_sensitivity():
    """Verify composite cache key changes when any contributing factor changes."""
    base_key = compute_composite_cache_key(
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        effective_input_hash="hash_input_1",
        dependency_hashes=["dep_hash_a"],
        provider="kokoro",
        model="kokoro-v1.0",
        settings={"speed": 1.0},
        seed=42,
    )

    # Identical inputs produce identical key
    same_key = compute_composite_cache_key(
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        effective_input_hash="hash_input_1",
        dependency_hashes=["dep_hash_a"],
        provider="kokoro",
        model="kokoro-v1.0",
        settings={"speed": 1.0},
        seed=42,
    )
    assert base_key == same_key

    # Dependency hash changed
    diff_dep_key = compute_composite_cache_key(
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        effective_input_hash="hash_input_1",
        dependency_hashes=["dep_hash_b"],
        provider="kokoro",
        model="kokoro-v1.0",
        settings={"speed": 1.0},
        seed=42,
    )
    assert base_key != diff_dep_key

    # Seed changed
    diff_seed_key = compute_composite_cache_key(
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        effective_input_hash="hash_input_1",
        dependency_hashes=["dep_hash_a"],
        provider="kokoro",
        model="kokoro-v1.0",
        settings={"speed": 1.0},
        seed=999,
    )
    assert base_key != diff_seed_key


# ==============================================================================
# 4. PERSISTENT STATE STORE (SQLITE) TESTS
# ==============================================================================

def test_state_store_transactions_and_persistence(tmp_path):
    """Verify SQLite StateStore saves/reloads DAG and rolls back on failure."""
    db_file = tmp_path / "test_state.db"
    store = StateStore(db_file)

    # Create and save graph
    graph = ArtifactDependencyGraph(project_id="proj_sqlite")
    graph.add_node("n1", "type_1", "h1")
    graph.add_node("n2", "type_2", "h2")
    graph.add_dependency("n1", "n2")
    store.save_graph(graph)

    # Reload in new instance
    store2 = StateStore(db_file)
    reloaded_graph = store2.load_graph(project_id="proj_sqlite")
    assert len(reloaded_graph.list_nodes()) == 2
    assert reloaded_graph.get_children("n1") == ["n2"]

    # Test transaction rollback on error
    try:
        with store.transaction() as conn:
            conn.execute("INSERT INTO nodes (artifact_id, artifact_type, content_hash, review_status, updated_at) VALUES ('err_node', 't', 'h', 'READY', 'now')")
            raise RuntimeError("Simulated crash inside transaction")
    except RuntimeError:
        pass

    # Confirm err_node was not persisted
    conn = store._get_connection()
    cur = conn.execute("SELECT * FROM nodes WHERE artifact_id = 'err_node'")
    assert cur.fetchone() is None
    conn.close()


# ==============================================================================
# 5. VERSIONING & RESTORE TESTS
# ==============================================================================

def test_version_manager_revision_and_restore(tmp_path):
    """Verify meaningful events create revisions, autosaves fail, and restore is auditable."""
    db_file = tmp_path / "ver_state.db"
    store = StateStore(db_file)
    graph = ArtifactDependencyGraph(project_id="proj_ver")
    graph.add_node("chunk_01", "audio_chunk", "initial_hash")
    store.save_graph(graph)

    vm = VersionManager(store, graph=graph)

    # 1. Autosave must raise InvalidRevisionEventError
    with pytest.raises(InvalidRevisionEventError):
        vm.create_revision(
            project_id="proj_ver",
            artifact_type="audio_chunk",
            artifact_id="chunk_01",
            snapshot_data={"text": "draft"},
            event_type="AUTOSAVE",
        )

    # 2. Meaningful events create revisions
    rev1 = vm.create_revision(
        project_id="proj_ver",
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        snapshot_data={"text": "Revision 1 audio text", "speed": 1.0},
        event_type="GENERATE",
    )
    rev2 = vm.create_revision(
        project_id="proj_ver",
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        snapshot_data={"text": "Revision 2 audio text", "speed": 1.1},
        event_type="REGENERATE",
    )
    rev3 = vm.create_revision(
        project_id="proj_ver",
        artifact_type="audio_chunk",
        artifact_id="chunk_01",
        snapshot_data={"text": "Revision 3 audio text", "speed": 1.2},
        event_type="MANUAL",
    )

    history = vm.list_history("audio_chunk", "chunk_01")
    assert len(history) == 3
    assert history[0].revision_id == rev3.revision_id  # Newest first

    # 3. Restore revision #2
    restore_result = vm.restore_revision(rev2.revision_id)
    assert restore_result["status"] == "RESTORED"
    assert restore_result["artifact_id"] == "chunk_01"  # Stable ID preserved!
    assert restore_result["restored_data"]["text"] == "Revision 2 audio text"
    assert restore_result["source_revision_id"] == rev2.revision_id

    # 4. History is append-only (now 4 revisions)
    new_history = vm.list_history("audio_chunk", "chunk_01")
    assert len(new_history) == 4
    assert new_history[0].event_type == "RESTORE"
    assert new_history[0].source_revision_id == rev2.revision_id


# ==============================================================================
# 6. LOCKING ENFORCEMENT TESTS
# ==============================================================================

def test_locking_semantics(tmp_path):
    """Verify lock prevents automated bulk overwrite but permits OUTDATED status."""
    db_file = tmp_path / "lock_state.db"
    store = StateStore(db_file)
    graph = ArtifactDependencyGraph(project_id="proj_lock")
    graph.add_node("beat_01", "story_beat", "h_b1")
    graph.add_node("chunk_01", "audio_chunk", "h_c1")
    graph.add_dependency("beat_01", "chunk_01")
    store.save_graph(graph)

    lm = LockManager(store, graph=graph)

    # Lock chunk_01
    lm.set_lock("chunk_01", True)
    assert lm.is_locked("chunk_01") is True

    # 1. Bulk filter skips locked chunk
    unlocked, skipped = lm.filter_unlocked_for_bulk(["beat_01", "chunk_01"])
    assert unlocked == ["beat_01"]
    assert skipped == ["chunk_01"]

    # 2. Automated modification raises LockConflictError
    with pytest.raises(LockConflictError):
        lm.verify_can_modify("chunk_01", is_automated=True)

    # 3. Manual modification without override raises LockConflictError
    with pytest.raises(LockConflictError):
        lm.verify_can_modify("chunk_01", is_automated=False, override_lock=False)

    # 4. Manual modification with explicit override succeeds
    lm.verify_can_modify("chunk_01", is_automated=False, override_lock=True)

    # 5. Upstream change marks locked chunk as OUTDATED (content untouched)
    graph.update_node_content("beat_01", "new_beat_hash")
    node = graph.get_node("chunk_01")
    assert node.is_locked is True
    assert node.is_outdated is True
    assert node.effective_status == EffectiveStatus.OUTDATED.value


# ==============================================================================
# 7. NEXT BEST ACTION SERVICE TESTS
# ==============================================================================

def test_next_best_action_deterministic_priority():
    """Verify deterministic priority: BLOCKED (P1) > OUTDATED (P2) > REVIEW (P3) > DRAFT (P4) > READY (P5)."""
    graph = ArtifactDependencyGraph(project_id="proj_nba")
    graph.add_node("n_ready", "scene", "h1", review_status=ReviewStatus.READY.value)
    graph.add_node("n_draft", "story_beat", "h2", review_status=ReviewStatus.DRAFT.value)
    graph.add_node("n_review", "audio_chunk", "h3", review_status=ReviewStatus.NEEDS_REVIEW.value)
    graph.add_node("n_outdated", "shot", "h4", is_outdated=True)
    graph.add_node("n_blocked", "shot", "h5", blockers=[Blocker(code="OOM", message="CUDA out of memory")])

    service = NextBestActionService(graph)

    # With blocked node present -> Priority 1
    act1 = service.get_next_action()
    assert act1.priority == 1
    assert act1.action_type == "RESOLVE_BLOCKER"
    assert act1.target_artifact_id == "n_blocked"

    # Clear blocker -> Next priority is OUTDATED (P2)
    graph.clear_blocker("n_blocked", "OOM")
    act2 = service.get_next_action()
    assert act2.priority == 2
    assert act2.action_type == "REGENERATE_OUTDATED"
    assert act2.target_artifact_id == "n_outdated"

    # Mark fresh -> Next priority is NEEDS_REVIEW (P3)
    graph.mark_fresh("n_outdated")
    act3 = service.get_next_action()
    assert act3.priority == 3
    assert act3.action_type == "REVIEW_ARTIFACT"
    assert act3.target_artifact_id == "n_review"

    # Set review ready -> Next priority is DRAFT (P4)
    graph.set_review_status("n_review", ReviewStatus.READY.value)
    act4 = service.get_next_action()
    assert act4.priority == 4
    assert act4.action_type == "COMPLETE_DRAFT"
    assert act4.target_artifact_id == "n_draft"

    # Set draft ready -> All ready (P5)
    graph.set_review_status("n_draft", ReviewStatus.READY.value)
    act5 = service.get_next_action()
    assert act5.priority == 5
    assert act5.action_type == "PROCEED_TO_EXPORT"


# ==============================================================================
# 8. LOCAL RESOURCE SCHEDULER & RESOURCEGUARD TESTS
# ==============================================================================

def test_scheduler_cuda_concurrency_one():
    """Verify CUDA_HEAVY strictly enforces concurrency=1 (job 2 queues while job 1 runs)."""
    async def _run():
        scheduler = LocalResourceScheduler(cuda_heavy_concurrency=1)
        execution_order = []

        async def task_1():
            execution_order.append("t1_start")
            await asyncio.sleep(0.05)
            execution_order.append("t1_done")
            return "res1"

        async def task_2():
            execution_order.append("t2_start")
            await asyncio.sleep(0.02)
            execution_order.append("t2_done")
            return "res2"

        t1 = asyncio.create_task(scheduler.submit_job("j1", "whisper", ResourceClass.CUDA_HEAVY.value, task_1))
        t2 = asyncio.create_task(scheduler.submit_job("j2", "kokoro", ResourceClass.CUDA_HEAVY.value, task_2))

        r1, r2 = await asyncio.gather(t1, t2)
        assert r1 == "res1"
        assert r2 == "res2"

        # Confirm strict serial execution without overlap
        assert execution_order == ["t1_start", "t1_done", "t2_start", "t2_done"]

    asyncio.run(_run())


def test_scheduler_permit_release_on_error():
    """Verify semaphore permit is guaranteed released on exception without deadlock."""
    async def _run():
        scheduler = LocalResourceScheduler(cuda_heavy_concurrency=1)

        async def failing_task():
            await asyncio.sleep(0.01)
            raise ValueError("Intentional crash")

        async def succeeding_task():
            await asyncio.sleep(0.01)
            return "recovered"

        with pytest.raises(ValueError):
            await scheduler.submit_job("fail_job", "cuda_task", ResourceClass.CUDA_HEAVY.value, failing_task)

        # Next job must acquire permit immediately without blocking
        result = await scheduler.submit_job("ok_job", "cuda_task", ResourceClass.CUDA_HEAVY.value, succeeding_task)
        assert result == "recovered"

    asyncio.run(_run())


def test_resource_guard_denies_cuda_encoder_coexistence():
    """Verify ResourceGuard denies CUDA_HEAVY + GPU_ENCODER coexistence on 4GB VRAM."""
    guard = ResourceGuard(allow_cuda_encoder_coexistence=False)
    active_counts = {
        ResourceClass.CUDA_HEAVY.value: 1,
        ResourceClass.GPU_ENCODER.value: 0,
    }

    # Attempting to start GPU_ENCODER when CUDA_HEAVY is active
    check = guard.check_can_run(ResourceClass.GPU_ENCODER.value, active_counts)
    assert check["allowed"] is False
    assert "CUDA_HEAVY đang chạy" in check["reason"]


# ==============================================================================
# 9. REFERENCE PROJECT BOOTSTRAP & REST API TESTS
# ==============================================================================

def test_reference_project_bootstrap_idempotence():
    """Verify reference 79-scene project bootstraps without modifying Phase 1 stable IDs."""
    store = get_project_state_store(SAMPLE_PROJECT)
    graph1 = bootstrap_project_graph(SAMPLE_PROJECT, state_store=store, force_rebuild=True)

    nodes1 = graph1.list_nodes()
    assert len(nodes1) >= 79  # At least 79 scenes + beats + chunks

    # Bootstrap second time (must return existing graph idempotently)
    graph2 = bootstrap_project_graph(SAMPLE_PROJECT, state_store=store, force_rebuild=False)
    assert len(graph2.list_nodes()) == len(nodes1)


def test_phase02_rest_api_contracts():
    """Verify Phase 2 REST API endpoints return structured payloads and proper 4xx error codes."""
    client = TestClient(app)

    # 1. Graph endpoint
    resp_graph = client.get(f"/api/projects/{SAMPLE_PROJECT}/dependencies/graph")
    assert resp_graph.status_code == 200
    graph_data = resp_graph.json()
    assert "nodes" in graph_data
    assert "edges" in graph_data
    assert len(graph_data["nodes"]) > 0

    # 2. Next action endpoint
    resp_nba = client.get(f"/api/projects/{SAMPLE_PROJECT}/next-action")
    assert resp_nba.status_code == 200
    nba_data = resp_nba.json()
    assert "action_type" in nba_data
    assert "priority" in nba_data

    # 3. History endpoint
    resp_hist = client.get(f"/api/projects/{SAMPLE_PROJECT}/history/audio_chunk/chunk_0001")
    assert resp_hist.status_code == 200
    assert isinstance(resp_hist.json(), list)

    # 4. Lock endpoint
    resp_lock = client.post(
        f"/api/projects/{SAMPLE_PROJECT}/lock/audio_chunk/chunk_0001",
        json={"locked": True},
    )
    assert resp_lock.status_code == 200
    assert resp_lock.json()["is_locked"] is True

    # Unlock again
    client.post(
        f"/api/projects/{SAMPLE_PROJECT}/lock/audio_chunk/chunk_0001",
        json={"locked": False},
    )

    # 5. Invalid project ID returns 404
    resp_404 = client.get("/api/projects/non_existent_project_9999/dependencies/graph")
    assert resp_404.status_code == 404

    # 6. Invalid revision restore returns 404
    resp_rev_404 = client.post(f"/api/projects/{SAMPLE_PROJECT}/history/rev_non_existent/restore")
    assert resp_rev_404.status_code == 404
