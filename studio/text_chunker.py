"""
Natural text chunking with deterministic exact text and punctuation integrity verification.
Follows UnfoldIQ TTS Studio Phase 2 requirements.
"""

import re
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple


class TextIntegrityError(Exception):
    """Raised when reconstructed text fails integrity verification against original script."""
    pass


@dataclass
class TextChunk:
    index: int
    text: str
    character_count: int
    word_count: int
    paragraph_index: int = 0


def normalize_script(text: str) -> str:
    """
    Explicit, documented normalization rule for script comparison:
    1. Standardize line endings (\r\n -> \n).
    2. Normalize paragraph breaks (2 or more newlines become \n\n).
    3. Normalize horizontal whitespace sequences (spaces, tabs) on each line to a single space.
    4. Strip leading and trailing whitespace from each paragraph.
    5. PRESERVES all punctuation (. , ? ! ; : " ' “ ” — – -), casing, and paragraph breaks.
    """
    if not text:
        return ""
    # 1. Standardize line endings
    unified = text.replace("\r\n", "\n").replace("\r", "\n")
    # 2. Split on paragraph boundaries
    paras = re.split(r'\n{2,}', unified)
    normalized_paras = []
    for p in paras:
        # Collapse horizontal whitespace within paragraph
        clean_p = " ".join(p.split())
        if clean_p:
            normalized_paras.append(clean_p)
    return "\n\n".join(normalized_paras)


def reconstruct_chunks(chunks: List[TextChunk]) -> str:
    """
    Deterministically reconstruct the full script from chunks using paragraph_index.
    Chunks within the same paragraph are joined by space.
    Chunks across paragraphs are joined by double newline.
    """
    if not chunks:
        return ""
    parts: List[str] = []
    current_para = chunks[0].paragraph_index
    current_para_chunks: List[str] = []

    for c in chunks:
        if c.paragraph_index == current_para:
            current_para_chunks.append(c.text)
        else:
            parts.append(" ".join(current_para_chunks))
            current_para = c.paragraph_index
            current_para_chunks = [c.text]
    if current_para_chunks:
        parts.append(" ".join(current_para_chunks))

    return "\n\n".join(parts)


def _split_into_sentences(text: str) -> List[str]:
    """Split text into sentences on [.!?] followed by whitespace, keeping delimiters."""
    parts = re.split(r'(?<=[.!?])\s+|(?<=[.!?][\"\'”’])\s+', text.strip())
    return [p for p in parts if p.strip()]


def _split_into_clauses(text: str) -> List[str]:
    """Split long sentence into clauses on [;,:\u2014\u2013] followed by whitespace."""
    parts = re.split(r'(?<=[;,:\u2014\u2013])\s+', text.strip())
    return [p for p in parts if p.strip()]


def _split_by_words(text: str, max_chars: int) -> List[str]:
    """Fallback: split clause into word-bounded segments under max_chars."""
    words = text.split()
    if not words:
        return []
    segments = []
    current_words = []
    current_len = 0
    for w in words:
        if len(w) > max_chars:
            if current_words:
                segments.append(" ".join(current_words))
                current_words = []
                current_len = 0
            for i in range(0, len(w), max_chars):
                segments.append(w[i:i + max_chars])
            continue

        w_len = len(w) + (1 if current_words else 0)
        if current_words and (current_len + w_len > max_chars):
            segments.append(" ".join(current_words))
            current_words = [w]
            current_len = len(w)
        else:
            current_words.append(w)
            current_len += w_len
    if current_words:
        segments.append(" ".join(current_words))
    return segments


def chunk_text(
    script: str,
    target_chars: int = 400,
    max_chars: int = 480
) -> List[TextChunk]:
    """
    Split script into natural, prosody-preserving chunks.
    Maintains paragraph_index for exact reconstruction.
    """
    cleaned = script.strip()
    if not cleaned:
        return []

    unified = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    raw_paragraphs = re.split(r'\n{2,}', unified)
    paragraphs = [p.strip() for p in raw_paragraphs if p.strip()]

    chunks: List[TextChunk] = []

    for para_idx, para in enumerate(paragraphs):
        # Determine atomic units for this paragraph
        if len(para) <= max_chars:
            para_units = [para]
        else:
            para_units = []
            sentences = _split_into_sentences(para)
            for sent in sentences:
                if len(sent) <= max_chars:
                    para_units.append(sent)
                else:
                    clauses = _split_into_clauses(sent)
                    for clause in clauses:
                        if len(clause) <= max_chars:
                            para_units.append(clause)
                        else:
                            para_units.extend(_split_by_words(clause, max_chars))

        # Greedily group units within this paragraph
        current_group: List[str] = []
        current_len = 0

        for unit in para_units:
            additional_len = len(unit) + (1 if current_group else 0)
            if current_group and (current_len + additional_len > target_chars):
                combined = " ".join(current_group).strip()
                chunks.append(
                    TextChunk(
                        index=len(chunks) + 1,
                        text=combined,
                        character_count=len(combined),
                        word_count=len(combined.split()),
                        paragraph_index=para_idx,
                    )
                )
                current_group = [unit]
                current_len = len(unit)
            else:
                current_group.append(unit)
                current_len += additional_len

        if current_group:
            combined = " ".join(current_group).strip()
            chunks.append(
                TextChunk(
                    index=len(chunks) + 1,
                    text=combined,
                    character_count=len(combined),
                    word_count=len(combined.split()),
                    paragraph_index=para_idx,
                )
            )

    return chunks


def build_and_verify_manifest(
    script: str,
    target_chars: int = 400,
    max_chars: int = 480
) -> Dict[str, Any]:
    """
    Build chunk plan and strictly verify exact text and punctuation integrity.
    Enforces:
      - Exact normalized text match (including all punctuation, quotes, dashes, paragraph breaks).
      - Word count match.
      - Sequential word match.
    Raises TextIntegrityError on any mismatch.
    """
    chunks = chunk_text(script, target_chars, max_chars)
    if not chunks and script.strip():
        raise TextIntegrityError("Chunking returned 0 chunks for non-empty script.")

    # 1. Exact string & punctuation reconstruction check
    expected_norm = normalize_script(script)
    reconstructed_norm = normalize_script(reconstruct_chunks(chunks))

    if expected_norm != reconstructed_norm:
        # Find first point of difference for detailed error reporting
        min_len = min(len(expected_norm), len(reconstructed_norm))
        diff_idx = min_len
        for i in range(min_len):
            if expected_norm[i] != reconstructed_norm[i]:
                diff_idx = i
                break
        ctx_start = max(0, diff_idx - 20)
        ctx_exp = expected_norm[ctx_start:ctx_start + 50]
        ctx_rec = reconstructed_norm[ctx_start:ctx_start + 50]
        raise TextIntegrityError(
            f"Exact text/punctuation integrity mismatch at position {diff_idx}:\n"
            f"  Expected:     '...{ctx_exp}...'\n"
            f"  Reconstructed:'...{ctx_rec}...'"
        )

    # 2. Sequential word check
    orig_words = expected_norm.split()
    recon_words = reconstructed_norm.split()
    if len(orig_words) != len(recon_words):
        raise TextIntegrityError(
            f"Word count mismatch: original has {len(orig_words)} words, "
            f"reconstructed has {len(recon_words)} words."
        )

    for i, (ow, rw) in enumerate(zip(orig_words, recon_words)):
        if ow != rw:
            raise TextIntegrityError(
                f"Word mismatch at token {i}: expected '{ow}', got '{rw}'"
            )

    manifest = {
        "total_characters": len(script),
        "total_words": len(orig_words),
        "total_chunks": len(chunks),
        "target_chars": target_chars,
        "max_chars": max_chars,
        "integrity_verified": True,
        "exact_punctuation_verified": True,
        "chunks": [
            {
                "index": c.index,
                "paragraph_index": c.paragraph_index,
                "text": c.text,
                "character_count": c.character_count,
                "word_count": c.word_count,
            }
            for c in chunks
        ]
    }
    return manifest
