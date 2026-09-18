"""
Phase 7 — Smart Render Engine.

Default internal rendering engine behind "Tao giong doc" (Generate Audio).

Design (YAGNI):
- Reuses existing deterministic chunking (studio.text_chunker) on the
  pronunciation-transformed synthesis text — same guarantees as Phase 2.
- Project-scoped cache: projects/<project>/render_cache/
  (manifest.json + chunks/<render_hash>.wav). Content-addressed by
  render_hash so unchanged chunks survive index shifts on script edits.
- Persistent resumable job state: projects/<project>/render_job.json
  (atomic writes). Auto-resume of individually hash-validated chunks only.
- Bounded retry (3 attempts total), ordered stitch by chunk index,
  atomic replacement of audio.wav / audio.mp3 (old valid output preserved
  until the new master validates).
- Conservative scheduler: single Kokoro service instance, semaphore-bounded
  concurrency profiles (eco/balanced/fast). No second model instance.

Only stdlib + soundfile (already a dependency). No new dependencies.
"""

import asyncio
import hashlib
import json
import logging
import shutil
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

import soundfile as sf

from studio.text_chunker import build_and_verify_manifest

logger = logging.getLogger("unfoldiq.smart_render")

RENDER_ENGINE_VERSION = 1
EXPECTED_SAMPLE_RATE = 24000
MAX_ATTEMPTS = 3  # initial attempt + up to 2 retries
RETRY_BACKOFF_SECONDS = (1.0, 2.0)

RENDER_MODES = ("eco", "balanced", "fast")
DEFAULT_RENDER_MODE = "balanced"

# Concurrency per profile, from Phase 7.3 benchmark on the target machine
# (RTX 3050 Laptop 4GB, single Kokoro service instance, 8-chunk script):
#   c1: 6.60s wall, peak VRAM 1027 MiB, 0 errors
#   c2: 5.92s wall (~10% faster), peak VRAM 1027 MiB, 0 errors
#   c3: 6.01s wall (no further gain), peak VRAM 1029 MiB, 0 errors
# Kokoro is GPU-bound: concurrency >1 gives marginal benefit and identical
# VRAM (same model instance). Balanced stays at 1 (default = safest, same
# throughput); fast uses 2 (measured safe: no errors, no extra VRAM).
RENDER_PROFILES: Dict[str, Dict[str, Any]] = {
    "eco": {"concurrency": 1, "description": "minimum machine pressure"},
    "balanced": {"concurrency": 1, "description": "default trade-off"},
    "fast": {"concurrency": 2, "description": "verified safe throughput"},
}


# ----------------------------------------------------------------------------
# Hashing
# ----------------------------------------------------------------------------

def _canonical(obj: Any) -> str:
    """Deterministic JSON serialization for hashing (never Python hash())."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_pronunciation_hash(applied_overrides: List[Dict[str, Any]]) -> str:
    """Hash of the effective pronunciation inputs.

    Only overrides that actually matched participate (preprocess output), so
    dictionary edits touching no chunk text leave the hash unchanged and all
    chunks remain cache hits — fine-grained invalidation for free.
    """
    normalized = [
        {
            "entry_id": o.get("entry_id", ""),
            "original": o.get("original", ""),
            "spoken_form": o.get("spoken_form", ""),
            "match_count": o.get("match_count", 0),
        }
        for o in (applied_overrides or [])
    ]
    normalized.sort(key=lambda o: (o["entry_id"], o["original"]))
    return hashlib.sha256(_canonical(normalized).encode("utf-8")).hexdigest()


def compute_render_hash(
    effective_text: str,
    voice: str,
    speed: float,
    pronunciation_hash: str,
    target_chars: int,
    max_chars: int,
    narration_hash: str = "",
    narration_directive: Optional[Dict[str, Any]] = None,
) -> str:
    """Stable cache identity for one chunk.

    Includes every input that can change generated speech: effective
    (post-pronunciation) chunk text, voice, speed, pronunciation result,
    narration synthesis state affecting that chunk (Phase 9; "" when Off),
    the compiled per-chunk directive actually applied at synth/stitch time
    (rate/pauses/emphasis — so compiler changes invalidate correctly),
    chunking settings and the render engine schema version.
    """
    payload = {
        "effective_text": effective_text,
        "voice": voice,
        "speed": float(speed),
        "pronunciation_hash": pronunciation_hash,
        "narration_hash": narration_hash,
        "narration_directive": narration_directive or {},
        "target_chars": int(target_chars),
        "max_chars": int(max_chars),
        "render_engine_version": RENDER_ENGINE_VERSION,
    }
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def plan_fingerprint(
    synthesis_text_hash: str,
    voice: str,
    speed: float,
    pronunciation_hash: str,
    target_chars: int,
    max_chars: int,
    narration_hash: str = "",
) -> str:
    """Compatibility identity for a whole render plan (resume gate)."""
    payload = {
        "synthesis_text_hash": synthesis_text_hash,
        "voice": voice,
        "speed": float(speed),
        "pronunciation_hash": pronunciation_hash,
        "narration_hash": narration_hash,
        "target_chars": int(target_chars),
        "max_chars": int(max_chars),
        "render_engine_version": RENDER_ENGINE_VERSION,
    }
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


# ----------------------------------------------------------------------------
# Atomic JSON helpers
# ----------------------------------------------------------------------------

def atomic_write_json(path: Path, obj: Any) -> None:
    """Write JSON atomically (tmp file + os.replace). Never leaves partial files."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)
        tmp_path.replace(path)
    finally:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass


def read_json(path: Path) -> Optional[Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# ----------------------------------------------------------------------------
# Render plan (7.1)
# ----------------------------------------------------------------------------

@dataclass
class ChunkPlan:
    chunk_id: str          # zero-padded ordered index, e.g. "0001"
    index: int             # 1-based script order
    text: str              # effective synthesis text (post-pronunciation)
    text_hash: str
    render_hash: str
    character_count: int
    word_count: int
    # Phase 9 narration synthesis instructions (defaults = neutral = legacy path)
    rate_factor: float = 1.0
    pause_before: float = 0.0
    pause_after: float = 0.0
    emphasis: List[str] = field(default_factory=list)
    is_locked: bool = False


@dataclass
class RenderPlan:
    chunks: List[ChunkPlan] = field(default_factory=list)
    fingerprint: str = ""
    synthesis_text_hash: str = ""
    pronunciation_hash: str = ""
    total_chunks: int = 0

    @property
    def hashes_in_order(self) -> List[str]:
        return [c.render_hash for c in self.chunks]


def plan_render(
    synthesis_text: str,
    voice: str,
    speed: float,
    applied_overrides: List[Dict[str, Any]],
    target_chars: int,
    max_chars: int,
    pron_preprocess: Optional[Callable[[str], Any]] = None,
    narration: Optional[Dict[str, Any]] = None,
    locked_chunk_indices: Optional[Set[int]] = None,
) -> RenderPlan:
    """Deterministic render plan reusing Phase 2 chunking guarantees.

    Chunking runs on the synthesis text exactly like the legacy pipeline, so
    no-lost-text / no-duplicate-text / punctuation guarantees are preserved.
    Cache addressing is by render_hash (content), therefore chunk identity is
    stable even when a script edit shifts later chunk indices.

    P1.6: when pron_preprocess is provided AND every full-run applied
    override is single-word, each chunk gets its own pronunciation hash, so a
    dictionary edit invalidates only chunks it actually touches. Otherwise
    (multi-word matches possible across chunk boundaries, or no callable)
    every chunk safely shares the global hash (conservative fallback — never
    stale audio, at most extra renders).

    Phase 9: optional narration mapping {chunk_index: directive} plus
    narration_hash participates in per-chunk hashes, so one beat change
    invalidates only overlapping chunks. narration=None (or Off) behaves
    exactly like the legacy path.

    Phase 2: optional locked_chunk_indices prevents automated/bulk regeneration
    from overwriting locked chunk assets.
    """
    manifest = build_and_verify_manifest(
        synthesis_text, target_chars=target_chars, max_chars=max_chars
    )
    synthesis_hash = sha256_text(synthesis_text)
    pron_hash = compute_pronunciation_hash(applied_overrides)
    narr = narration or {}
    narr_hash = str(narr.get("narration_hash", ""))
    narr_dirs = narr.get("directives") or {}
    fingerprint = plan_fingerprint(
        synthesis_hash, voice, speed, pron_hash, target_chars, max_chars,
        narr_hash,
    )

    fine_grained = (
        pron_preprocess is not None
        and all(len((o.get("original") or "").split()) <= 1
                for o in (applied_overrides or []))
    )

    chunks: List[ChunkPlan] = []
    for item in manifest["chunks"]:
        text = item["text"]
        chunk_ph = pron_hash
        if fine_grained:
            try:
                _, chunk_applied = pron_preprocess(text)
                chunk_ph = compute_pronunciation_hash(chunk_applied or [])
            except Exception:
                chunk_ph = pron_hash
        d = narr_dirs.get(item["index"]) or {}
        rate_factor = float(d.get("rate_factor", 1.0))
        pause_before = float(d.get("pause_before", 0.0))
        pause_after = float(d.get("pause_after", 0.0))
        emphasis = list(d.get("emphasis", []))
        directive_sig = {"rate_factor": rate_factor, "pause_before": pause_before,
                         "pause_after": pause_after, "emphasis": emphasis}
        is_chk_locked = bool(locked_chunk_indices and item["index"] in locked_chunk_indices)
        chunks.append(
            ChunkPlan(
                chunk_id=f"{item['index']:04d}",
                index=item["index"],
                text=text,
                text_hash=sha256_text(text),
                render_hash=compute_render_hash(
                    text, voice, speed, chunk_ph, target_chars, max_chars,
                    narr_hash, directive_sig,
                ),
                character_count=item["character_count"],
                word_count=item["word_count"],
                rate_factor=rate_factor,
                pause_before=pause_before,
                pause_after=pause_after,
                emphasis=emphasis,
                is_locked=is_chk_locked,
            )
        )

    return RenderPlan(
        chunks=chunks,
        fingerprint=fingerprint,
        synthesis_text_hash=synthesis_hash,
        pronunciation_hash=pron_hash,
        total_chunks=len(chunks),
    )


# ----------------------------------------------------------------------------
# Project-scoped cache (7.1)
# ----------------------------------------------------------------------------

class RenderCache:
    """Content-addressed WAV chunk cache inside one project.

    Layout:
        render_cache/
            manifest.json          # {render_hash: {chunk_id, bytes, ...}}
            chunks/
                <render_hash>.wav
    """

    def __init__(self, project_dir: Path):
        self.project_dir = Path(project_dir)
        self.cache_dir = self.project_dir / "render_cache"
        self.chunks_dir = self.cache_dir / "chunks"
        self.manifest_path = self.cache_dir / "manifest.json"

    def chunk_path(self, render_hash: str) -> Path:
        return self.chunks_dir / f"{render_hash}.wav"

    def load_manifest(self) -> Dict[str, Any]:
        data = read_json(self.manifest_path)
        if isinstance(data, dict):
            return data
        return {"version": RENDER_ENGINE_VERSION, "chunks": {}}

    def _save_manifest(self, manifest: Dict[str, Any]) -> None:
        manifest["version"] = RENDER_ENGINE_VERSION
        atomic_write_json(self.manifest_path, manifest)

    def validate_wav(self, path: Path, expected_hash: Optional[str] = None) -> bool:
        """Header-level validation without loading full audio into RAM."""
        try:
            if not path.is_file() or path.stat().st_size <= 0:
                return False
            info = sf.info(str(path))
            if info.frames <= 0 or info.samplerate != EXPECTED_SAMPLE_RATE:
                return False
            if info.channels < 1:
                return False
            # Full RIFF parse check (cheap, streaming).
            with wave.open(str(path), "rb") as wf:
                if wf.getnframes() <= 0 or wf.getframerate() != EXPECTED_SAMPLE_RATE:
                    return False
            if expected_hash is not None:
                manifest = self.load_manifest()
                entry = manifest.get("chunks", {}).get(expected_hash)
                if not entry:
                    return False
            return True
        except Exception:
            return False

    def lookup(self, render_hash: str) -> Optional[Path]:
        """Return cached chunk path if valid, else None (corrupt cache rejected)."""
        path = self.chunk_path(render_hash)
        if self.validate_wav(path, expected_hash=render_hash):
            return path
        # Remove corrupt/partial file so it can never be reused accidentally.
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass
        return None

    def store(self, render_hash: str, src_wav: Path, chunk_id: str = "") -> Path:
        """Atomically store a validated WAV into the cache."""
        if not self.validate_wav(src_wav):
            raise ValueError(f"Refusing to cache invalid WAV: {src_wav}")
        dest = self.chunk_path(render_hash)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)
        tmp_dest = dest.with_suffix(".wav.tmp")
        try:
            shutil.copy2(src_wav, tmp_dest)
            if not self.validate_wav(tmp_dest):
                raise ValueError("Cached copy failed validation.")
            tmp_dest.replace(dest)
        finally:
            try:
                if tmp_dest.exists():
                    tmp_dest.unlink()
            except Exception:
                pass
        manifest = self.load_manifest()
        entries = manifest.setdefault("chunks", {})
        entries[render_hash] = {
            "chunk_id": chunk_id,
            "bytes": dest.stat().st_size,
            "stored_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        }
        self._save_manifest(manifest)
        return dest

    def prune_orphans(self, referenced_hashes: List[str]) -> int:
        """Remove cached chunks no longer referenced by the current plan.

        Never touches audio.wav / audio.mp3 / script.txt / timestamps /
        scene plan / veo prompts — only render_cache/chunks/*.wav.
        """
        keep = set(referenced_hashes)
        manifest = self.load_manifest()
        entries = manifest.get("chunks", {})
        removed = 0
        for render_hash in list(entries.keys()):
            if render_hash not in keep:
                try:
                    p = self.chunk_path(render_hash)
                    if p.exists():
                        p.unlink()
                except Exception:
                    pass
                entries.pop(render_hash, None)
                removed += 1
        # Also drop stray wav files with no manifest entry.
        try:
            if self.chunks_dir.is_dir():
                for p in self.chunks_dir.glob("*.wav"):
                    if p.stem not in keep and p.stem not in entries:
                        try:
                            p.unlink()
                            removed += 1
                        except Exception:
                            pass
        except Exception:
            pass
        self._save_manifest(manifest)
        return removed


# ----------------------------------------------------------------------------
# Persistent resumable job state (7.2)
# ----------------------------------------------------------------------------

class RenderJobState:
    """Atomic persistent state for one project's render job: render_job.json."""

    def __init__(self, project_dir: Path):
        self.project_dir = Path(project_dir)
        self.state_path = self.project_dir / "render_job.json"

    def load(self) -> Optional[Dict[str, Any]]:
        data = read_json(self.state_path)
        return data if isinstance(data, dict) else None

    def save(self, state: Dict[str, Any]) -> None:
        state["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        atomic_write_json(self.state_path, state)

    def new(self, job_id: str, fingerprint: str, total_chunks: int) -> Dict[str, Any]:
        state = {
            "job_id": job_id,
            "status": "running",
            "fingerprint": fingerprint,
            "total_chunks": total_chunks,
            "completed": {},       # chunk_id -> render_hash (validated)
            "rendered_chunks": 0,
            "reused_chunks": 0,
            "failed": {},          # chunk_id -> {error, retries}
            "retries": 0,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            "render_engine_version": RENDER_ENGINE_VERSION,
        }
        self.save(state)
        return state

    def mark_completed(
        self,
        state: Dict[str, Any],
        chunk_id: str,
        render_hash: str,
        reused: bool,
        retries: int = 0,
    ) -> None:
        state["completed"][chunk_id] = render_hash
        if reused:
            state["reused_chunks"] = int(state.get("reused_chunks", 0)) + 1
        else:
            state["rendered_chunks"] = int(state.get("rendered_chunks", 0)) + 1
        state["retries"] = int(state.get("retries", 0)) + int(retries)
        state["failed"].pop(chunk_id, None)
        self.save(state)

    def mark_failed(self, state: Dict[str, Any], chunk_id: str, error: str, retries: int) -> None:
        state["failed"][chunk_id] = {"error": error, "retries": int(retries)}
        state["retries"] = int(state.get("retries", 0)) + int(retries)
        self.save(state)

    def mark_status(self, state: Dict[str, Any], status: str) -> None:
        state["status"] = status
        self.save(state)

    def compatible_completed(
        self, state: Dict[str, Any], plan: RenderPlan, cache: RenderCache
    ) -> Dict[str, str]:
        """Previously completed chunks that are safe to resume.

        Requires identical plan fingerprint AND per-chunk hash match AND a
        currently valid cached file. Anything else regenerates.
        """
        if not state or state.get("fingerprint") != plan.fingerprint:
            return {}
        if state.get("render_engine_version") != RENDER_ENGINE_VERSION:
            return {}
        by_id = {c.chunk_id: c.render_hash for c in plan.chunks}
        ok: Dict[str, str] = {}
        for chunk_id, render_hash in (state.get("completed") or {}).items():
            if by_id.get(chunk_id) == render_hash and cache.lookup(render_hash) is not None:
                ok[chunk_id] = render_hash
        return ok


# ----------------------------------------------------------------------------
# Chunk rendering with bounded retry (7.2)
# ----------------------------------------------------------------------------

# synth_fn(effective_text, tmp_output_path) -> None. Raises on failure.
# asyncio.CancelledError is never retried and always propagates.
SynthFn = Callable[[str, Path], Awaitable[None]]


async def render_chunk_with_retry(
    synth_fn: SynthFn,
    effective_text: str,
    tmp_output_path: Path,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """Render one chunk with bounded retry. Returns {ok, retries, error}."""
    retries = 0
    last_error = ""
    for attempt in range(MAX_ATTEMPTS):
        if cancel_check and cancel_check():
            raise asyncio.CancelledError("Render cancelled before chunk attempt.")
        try:
            tmp_output_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                if tmp_output_path.exists():
                    tmp_output_path.unlink()
            except Exception:
                pass
            await synth_fn(effective_text, tmp_output_path)
            # Validate before accepting.
            try:
                info = sf.info(str(tmp_output_path))
                valid = (
                    tmp_output_path.is_file()
                    and tmp_output_path.stat().st_size > 0
                    and info.frames > 0
                    and info.samplerate == EXPECTED_SAMPLE_RATE
                )
            except Exception:
                valid = False
            if not valid:
                raise RuntimeError("Synthesized chunk failed validation (format/empty).")
            return {"ok": True, "retries": retries, "error": ""}
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - bounded retry over transient failures
            last_error = str(e)
            if attempt < MAX_ATTEMPTS - 1:
                retries += 1
                await asyncio.sleep(RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)])
    return {"ok": False, "retries": retries, "error": last_error}


# ----------------------------------------------------------------------------
# Ordered stitch + atomic replacement (7.2)
# ----------------------------------------------------------------------------

def ordered_chunk_paths(plan: RenderPlan, resolve: Callable[[str], Path]) -> List[Path]:
    """Chunk files in exact script order (by index — never completion order)."""
    ordered = sorted(plan.chunks, key=lambda c: c.index)
    return [resolve(c.render_hash) for c in ordered]


def replace_file_atomically(src: Path, dest: Path) -> None:
    """Atomically replace dest with src (old dest intact until replace).

    src must be a non-empty, parseable WAV at the expected sample rate;
    anything else raises and dest is left untouched. os.replace is atomic
    on the same filesystem.
    """
    valid = False
    try:
        if src.is_file() and src.stat().st_size > 0:
            info = sf.info(str(src))
            valid = info.frames > 0 and info.samplerate == EXPECTED_SAMPLE_RATE
    except Exception:
        valid = False
    if not valid:
        raise ValueError(f"Refusing atomic replace from invalid WAV: {src}")
    if src.resolve() != dest.resolve():
        src.replace(dest)
