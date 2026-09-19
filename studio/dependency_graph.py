"""
UnfoldIQ Artifact-Level Dependency Graph & Content Identity Engine — Phase 2
Provides:
- Deterministic canonical SHA-256 content hashing excluding ephemeral metadata
- Composite cache key generation incorporating upstream dependencies, provider, model, seed
- Directed Acyclic Graph (DAG) for artifact-level dependencies with strict cycle detection
- Micro-propagation invalidation (only downstream transitive closure marked OUTDATED)
- Canonical 4-tier status precedence resolution: BLOCKED > OUTDATED > NEEDS_REVIEW > DRAFT > READY
"""

import hashlib
import json
import logging
from typing import Dict, Any, List, Optional, Set, Tuple

from studio.domain_models import (
    ArtifactNode,
    Blocker,
    ReviewStatus,
    DerivedFreshness,
    EffectiveStatus,
)

logger = logging.getLogger("unfoldiq.dependency_graph")


class DependencyGraphError(Exception):
    """Base exception for dependency graph operations."""
    pass


class CycleDetectedError(DependencyGraphError):
    """Raised when an edge insertion would create a circular dependency."""
    pass


class NodeNotFoundError(DependencyGraphError):
    """Raised when an operation targets an artifact ID that does not exist in the graph."""
    pass


# ==============================================================================
# 1. CANONICAL CONTENT HASHING & COMPOSITE CACHE KEYS
# ==============================================================================

def canonical_json_dumps(obj: Any) -> str:
    """
    Deterministically serializes any dictionary or object to a JSON string.
    Keys are sorted, whitespace is stripped, non-semantic keys are excluded.
    """
    def _sanitize(item: Any) -> Any:
        if isinstance(item, dict):
            # Exclude non-semantic, ephemeral, or mutable tracking fields
            filtered = {}
            for k, v in sorted(item.items()):
                if k in ("updated_at", "last_accessed", "memory_address", "client_ip"):
                    continue
                filtered[k] = _sanitize(v)
            return filtered
        elif isinstance(item, (list, tuple)):
            return [_sanitize(x) for x in item]
        elif isinstance(item, (set, frozenset)):
            return sorted([_sanitize(x) for x in item], key=lambda x: str(x))
        elif hasattr(item, "model_dump"):
            return _sanitize(item.model_dump())
        elif hasattr(item, "dict"):
            return _sanitize(item.dict())
        return item

    clean = _sanitize(obj)
    return json.dumps(clean, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def compute_content_hash(data: Any) -> str:
    """
    Computes a canonical SHA-256 content hash of the input data.
    Guarantees:
    - Same effective semantic content produces identical hash
    - Dict key order or volatile timestamp differences do not alter hash
    - Any semantic mutation produces a completely different hash
    """
    serialized = canonical_json_dumps(data)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def compute_composite_cache_key(
    artifact_type: str,
    artifact_id: Optional[str] = None,
    effective_input_hash: str = "",
    dependency_hashes: Optional[List[str]] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
    seed: Optional[int] = None,
    schema_version: str = "2.0.0",
    *,
    input_hash: Optional[str] = None,
    algorithm_version: Optional[str] = None,
    prompt_template_version: Optional[str] = None,
    code_generation_version: Optional[str] = None,
    **kwargs: Any,
) -> str:
    """
    Generates a composite cache key for generated/computed artifacts.
    Adheres strictly to effective-input semantics (Gate A):
    - Same effective inputs -> same reusable computation/output identity.
    - artifact_id is retained as lineage/ownership identity, but does NOT mutate the reusable computation digest.
    - Effective inputs: artifact_type, effective_input_hash, dependency_hashes, provider, model, settings, seed, schema_version,
      plus optional algorithm_version, prompt_template_version, code_generation_version.
    - Non-effective metadata (updated_at, display labels, UI metadata, artifact_id) do not affect output cache key.
    """
    actual_input_hash = input_hash or effective_input_hash
    # If caller called positionally with 2 arguments e.g. (artifact_type, input_hash)
    if not actual_input_hash and artifact_id and not dependency_hashes and not provider and not settings and seed is None:
        actual_input_hash = artifact_id

    payload = {
        "artifact_type": artifact_type,
        "effective_input_hash": actual_input_hash or "",
        "dependency_hashes": sorted(dependency_hashes or []),
        "provider": provider or "",
        "model": model or "",
        "settings": settings or {},
        "seed": seed,
        "schema_version": schema_version,
    }
    if algorithm_version is not None:
        payload["algorithm_version"] = algorithm_version
    if prompt_template_version is not None:
        payload["prompt_template_version"] = prompt_template_version
    if code_generation_version is not None:
        payload["code_generation_version"] = code_generation_version
    for k in sorted(kwargs.keys()):
        payload[k] = kwargs[k]

    digest = compute_content_hash(payload)
    return f"cck_{digest[:32]}"




def resolve_effective_status(
    review_status: str,
    is_outdated: bool,
    blockers: List[Blocker],
) -> str:
    """
    Resolves the canonical effective status with immutable precedence:
    BLOCKED > OUTDATED > NEEDS_REVIEW > DRAFT > READY
    """
    if blockers and len(blockers) > 0:
        return EffectiveStatus.BLOCKED.value
    if is_outdated:
        return EffectiveStatus.OUTDATED.value
    if review_status == ReviewStatus.NEEDS_REVIEW.value:
        return EffectiveStatus.NEEDS_REVIEW.value
    if review_status == ReviewStatus.DRAFT.value:
        return EffectiveStatus.DRAFT.value
    return EffectiveStatus.READY.value


# ==============================================================================
# 2. ARTIFACT-LEVEL DEPENDENCY GRAPH (DAG)
# ==============================================================================

class ArtifactDependencyGraph:
    """
    In-memory Directed Acyclic Graph representing artifact dependencies.
    Provides cycle safety, incremental micro-propagation invalidation,
    and status precedence resolution.
    """

    def __init__(self, project_id: str = ""):
        self.project_id: str = project_id
        self._nodes: Dict[str, ArtifactNode] = {}
        self._children: Dict[str, Set[str]] = {}  # parent_id -> set of child_ids
        self._parents: Dict[str, Set[str]] = {}   # child_id -> set of parent_ids

    def add_node(
        self,
        artifact_id: str,
        artifact_type: str,
        content_hash: str,
        review_status: str = ReviewStatus.READY.value,
        is_outdated: bool = False,
        is_locked: bool = False,
        blockers: Optional[List[Blocker]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ArtifactNode:
        """Adds or updates an artifact node in the graph."""
        bl = blockers or []
        eff = resolve_effective_status(review_status, is_outdated, bl)
        parents = list(self._parents.get(artifact_id, set()))

        node = ArtifactNode(
            artifact_id=artifact_id,
            artifact_type=artifact_type,
            content_hash=content_hash,
            review_status=review_status,
            is_outdated=is_outdated,
            is_locked=is_locked,
            blockers=bl,
            effective_status=eff,
            dependencies=parents,
            metadata=metadata or {},
        )
        self._nodes[artifact_id] = node

        if artifact_id not in self._children:
            self._children[artifact_id] = set()
        if artifact_id not in self._parents:
            self._parents[artifact_id] = set()

        return node

    def get_node(self, artifact_id: str) -> Optional[ArtifactNode]:
        """Retrieves a node by its stable ID."""
        return self._nodes.get(artifact_id)

    def has_node(self, artifact_id: str) -> bool:
        return artifact_id in self._nodes

    def list_nodes(self) -> List[ArtifactNode]:
        """Returns all nodes currently in the graph."""
        return list(self._nodes.values())

    def add_dependency(self, parent_id: str, child_id: str) -> None:
        """
        Adds a directed edge: parent_id -> child_id.
        Child depends on parent.
        Strictly rejects self-loops and circular dependencies.
        """
        if parent_id not in self._nodes:
            raise NodeNotFoundError(f"Parent node '{parent_id}' does not exist in graph.")
        if child_id not in self._nodes:
            raise NodeNotFoundError(f"Child node '{child_id}' does not exist in graph.")

        if parent_id == child_id:
            raise CycleDetectedError(f"Self-dependency detected: node '{parent_id}' cannot depend on itself.")

        # Check if child is an ancestor of parent (i.e. parent is reachable from child)
        if self._is_reachable(source=child_id, target=parent_id):
            raise CycleDetectedError(
                f"Cycle detected: adding edge '{parent_id}' -> '{child_id}' would create a circular dependency."
            )

        self._children[parent_id].add(child_id)
        self._parents[child_id].add(parent_id)

        # Update node dependencies list
        self._nodes[child_id].dependencies = sorted(list(self._parents[child_id]))

    def remove_dependency(self, parent_id: str, child_id: str) -> None:
        """Removes a directed dependency edge."""
        if parent_id in self._children:
            self._children[parent_id].discard(child_id)
        if child_id in self._parents:
            self._parents[child_id].discard(parent_id)
        if child_id in self._nodes:
            self._nodes[child_id].dependencies = sorted(list(self._parents.get(child_id, set())))

    def _is_reachable(self, source: str, target: str) -> bool:
        """Checks if target is reachable from source using Depth-First Search."""
        visited: Set[str] = set()
        stack: List[str] = [source]

        while stack:
            curr = stack.pop()
            if curr == target:
                return True
            if curr not in visited:
                visited.add(curr)
                stack.extend(self._children.get(curr, set()) - visited)
        return False

    def get_children(self, artifact_id: str) -> List[str]:
        """Returns immediate child IDs depending on this node."""
        return sorted(list(self._children.get(artifact_id, set())))

    def get_parents(self, artifact_id: str) -> List[str]:
        """Returns immediate parent IDs this node depends on."""
        return sorted(list(self._parents.get(artifact_id, set())))

    def get_downstream_closure(self, artifact_id: str) -> Set[str]:
        """
        Computes the complete transitive downstream closure of descendants.
        Does NOT include artifact_id itself.
        """
        closure: Set[str] = set()
        stack: List[str] = list(self._children.get(artifact_id, set()))

        while stack:
            child = stack.pop()
            if child not in closure:
                closure.add(child)
                stack.extend(self._children.get(child, set()) - closure)
        return closure

    def update_node_content(
        self,
        artifact_id: str,
        new_content_hash: str,
    ) -> Tuple[bool, Set[str]]:
        """
        Updates the content hash of a node.
        If hash changed:
        - Updates node.content_hash.
        - Triggers micro-propagation: marks all transitive downstream descendants as OUTDATED.
        - Unrelated branches remain untouched.
        Returns (changed: bool, invalidated_ids: Set[str]).
        """
        if artifact_id not in self._nodes:
            raise NodeNotFoundError(f"Node '{artifact_id}' does not exist.")

        node = self._nodes[artifact_id]
        if node.content_hash == new_content_hash:
            return False, set()

        node.content_hash = new_content_hash
        # Re-evaluate self effective status
        node.effective_status = resolve_effective_status(
            node.review_status, node.is_outdated, node.blockers
        )

        invalidated = self.get_downstream_closure(artifact_id)
        for d_id in invalidated:
            d_node = self._nodes[d_id]
            d_node.is_outdated = True
            d_node.effective_status = resolve_effective_status(
                d_node.review_status, True, d_node.blockers
            )

        logger.info(
            f"Node {artifact_id} updated. Invalidated {len(invalidated)} downstream nodes."
        )
        return True, invalidated

    def invalidate_dependent_chain(self, artifact_id: str, reason: str = "") -> Set[str]:
        """
        Invalidates all transitive downstream descendants of artifact_id.
        Marks descendants as OUTDATED while preserving locks and review statuses.
        Returns the set of invalidated artifact IDs.
        """
        if artifact_id not in self._nodes:
            logger.debug(f"Node '{artifact_id}' not found for chain invalidation.")
            return set()

        invalidated = self.get_downstream_closure(artifact_id)
        for d_id in invalidated:
            d_node = self._nodes[d_id]
            d_node.is_outdated = True
            d_node.effective_status = resolve_effective_status(
                d_node.review_status, True, d_node.blockers
            )

        logger.info(
            f"Chain invalidation from '{artifact_id}' ({reason or 'unspecified'}): "
            f"invalidated {len(invalidated)} downstream nodes."
        )
        return invalidated

    def set_review_status(self, artifact_id: str, status: str) -> None:
        """Updates the base review status (DRAFT, NEEDS_REVIEW, READY)."""
        if artifact_id not in self._nodes:
            raise NodeNotFoundError(f"Node '{artifact_id}' does not exist.")
        node = self._nodes[artifact_id]
        node.review_status = status
        node.effective_status = resolve_effective_status(
            node.review_status, node.is_outdated, node.blockers
        )

    def mark_fresh(self, artifact_id: str) -> None:
        """Marks an artifact as fresh (clears OUTDATED flag after regeneration)."""
        if artifact_id not in self._nodes:
            raise NodeNotFoundError(f"Node '{artifact_id}' does not exist.")
        node = self._nodes[artifact_id]
        node.is_outdated = False
        node.effective_status = resolve_effective_status(
            node.review_status, False, node.blockers
        )

    def set_locked(self, artifact_id: str, locked: bool) -> None:
        """Sets the lock state of an artifact."""
        if artifact_id not in self._nodes:
            raise NodeNotFoundError(f"Node '{artifact_id}' does not exist.")
        self._nodes[artifact_id].is_locked = locked

    def add_blocker(self, artifact_id: str, blocker: Blocker) -> None:
        """Adds a blocker to an artifact."""
        if artifact_id not in self._nodes:
            raise NodeNotFoundError(f"Node '{artifact_id}' does not exist.")
        node = self._nodes[artifact_id]
        # Avoid duplicate blocker codes
        node.blockers = [b for b in node.blockers if b.code != blocker.code]
        node.blockers.append(blocker)
        node.effective_status = resolve_effective_status(
            node.review_status, node.is_outdated, node.blockers
        )

    def clear_blocker(self, artifact_id: str, code: str) -> None:
        """Clears a blocker by code."""
        if artifact_id not in self._nodes:
            raise NodeNotFoundError(f"Node '{artifact_id}' does not exist.")
        node = self._nodes[artifact_id]
        node.blockers = [b for b in node.blockers if b.code != code]
        node.effective_status = resolve_effective_status(
            node.review_status, node.is_outdated, node.blockers
        )

    def topological_sort(self) -> List[str]:
        """
        Returns all node IDs sorted in topological dependency order (parents before children).
        Uses Kahn's algorithm.
        """
        in_degree: Dict[str, int] = {nid: len(self._parents.get(nid, set())) for nid in self._nodes}
        queue: List[str] = [nid for nid, deg in in_degree.items() if deg == 0]
        # Sort queue deterministically
        queue.sort()

        order: List[str] = []
        while queue:
            curr = queue.pop(0)
            order.append(curr)

            for child in sorted(list(self._children.get(curr, set()))):
                in_degree[child] -= 1
                if in_degree[child] == 0:
                    queue.append(child)
            queue.sort()

        if len(order) != len(self._nodes):
            raise CycleDetectedError("Cycle detected during topological sort.")

        return order

    def to_dict(self) -> Dict[str, Any]:
        """Serializes entire graph to dictionary for export or persistence."""
        edges = []
        for p_id, children in self._children.items():
            for c_id in sorted(list(children)):
                edges.append({"parent_id": p_id, "child_id": c_id})

        return {
            "project_id": self.project_id,
            "nodes": [node.model_dump() for node in self._nodes.values()],
            "edges": edges,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ArtifactDependencyGraph":
        """Reconstructs graph from dictionary."""
        graph = cls(project_id=data.get("project_id", ""))
        for nd in data.get("nodes", []):
            graph.add_node(
                artifact_id=nd["artifact_id"],
                artifact_type=nd["artifact_type"],
                content_hash=nd["content_hash"],
                review_status=nd.get("review_status", ReviewStatus.READY.value),
                is_outdated=nd.get("is_outdated", False),
                is_locked=nd.get("is_locked", False),
                blockers=[Blocker(**b) for b in nd.get("blockers", [])],
                metadata=nd.get("metadata", {}),
            )
        for ed in data.get("edges", []):
            graph.add_dependency(ed["parent_id"], ed["child_id"])
        return graph
