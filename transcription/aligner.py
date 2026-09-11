"""
Deterministic source-to-synthesis-to-ASR sequence alignment engine for UnfoldIQ TTS Studio.
Pure Python standard library implementation.
"""

import re
import unicodedata
from typing import List, Dict, Any, Tuple, Optional


def normalize_for_matching(text: str) -> str:
    """
    Normalizes text strictly for token matching without altering display text:
    - Unicode NFKC normalization
    - Lowercase
    - Replace curly apostrophes/quotes with straight
    - Strip surrounding punctuation
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    # Strip quotes that are not contraction apostrophes inside words
    text = re.sub(r"(?<!\w)'|'(?!\w)", " ", text)
    # Strip all remaining non-alphanumeric except apostrophe
    cleaned = re.sub(r"[^\w\s']", " ", text)
    # Collapse whitespace
    return re.sub(r"\s+", " ", cleaned).strip()


def segment_script_into_sentences(script_text: str) -> List[Dict[str, Any]]:
    """
    Splits script.txt into deterministic source sentence objects while preserving
    exact wording, punctuation, paragraph boundaries, and source character offsets.
    """
    if not script_text or not script_text.strip():
        return []

    # Regex matching sentence boundaries: (. ! ?) followed by whitespace, or double newlines
    pattern = r'([^\n.!?]+(?:[\.!?]+["\']?|\n+|$))'
    raw_parts = [m.group(0) for m in re.finditer(pattern, script_text) if m.group(0).strip()]

    sentences = []
    current_char_idx = 0

    for idx, part in enumerate(raw_parts, start=1):
        clean_part = part.strip()
        if not clean_part:
            continue
        
        # Find exact occurrence in script_text from current_char_idx
        start_char = script_text.find(clean_part, current_char_idx)
        if start_char == -1:
            start_char = current_char_idx
        end_char = start_char + len(clean_part)
        current_char_idx = end_char

        sentences.append({
            "index": idx,
            "text": clean_part,
            "start_char": start_char,
            "end_char": end_char,
            "words": [w for w in re.split(r"\s+", clean_part) if w]
        })

    return sentences


def extract_words_from_whisper_segments(raw_segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Flattens word-level timestamps from faster-whisper raw segments into a sequence of timed words.
    """
    words = []
    for seg in raw_segments:
        seg_words = seg.get("words", [])
        if seg_words:
            for w in seg_words:
                w_text = w.get("word", "").strip()
                if not w_text:
                    continue
                words.append({
                    "word": w_text,
                    "norm": normalize_for_matching(w_text),
                    "start": float(w.get("start", 0.0)),
                    "end": float(w.get("end", 0.0)),
                    "probability": float(w.get("probability", 1.0))
                })
        else:
            # Fallback if a segment has no word breakdown: split text and distribute time
            seg_text = seg.get("text", "").strip()
            parts = [p for p in seg_text.split() if p]
            if not parts:
                continue
            s_start = float(seg.get("start", 0.0))
            s_end = float(seg.get("end", s_start + 0.1))
            duration = max(0.1, s_end - s_start)
            step = duration / len(parts)
            for i, p in enumerate(parts):
                words.append({
                    "word": p,
                    "norm": normalize_for_matching(p),
                    "start": s_start + i * step,
                    "end": s_start + (i + 1) * step,
                    "probability": 0.8
                })
    return words


def align_tokens_needleman_wunsch(
    expected_tokens: List[str],
    asr_tokens: List[str]
) -> Tuple[List[Optional[int]], Dict[str, Any]]:
    """
    Dynamic programming sequence alignment (Needleman-Wunsch) between
    expected synthesis tokens and ASR recognized tokens.
    Returns:
      - mapping from expected_token_idx -> asr_token_idx (or None if deleted)
      - quality metrics dictionary (matches, insertions, deletions, substitutions, coverage_pct)
    """
    n = len(expected_tokens)
    m = len(asr_tokens)

    if n == 0:
        return [], {"matched_words": 0, "expected_words": 0, "asr_words": m, "insertions": m, "deletions": 0, "substitutions": 0, "coverage_pct": 100.0}
    if m == 0:
        return [None] * n, {"matched_words": 0, "expected_words": n, "asr_words": 0, "insertions": 0, "deletions": n, "substitutions": 0, "coverage_pct": 0.0}

    # Normalized tokens for comparison
    norm_exp = [normalize_for_matching(t) for t in expected_tokens]
    norm_asr = [normalize_for_matching(t) for t in asr_tokens]

    # Costs
    MATCH_SCORE = 3
    SUB_PENALTY = -2
    DEL_PENALTY = -2
    INS_PENALTY = -2

    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i * DEL_PENALTY
    for j in range(m + 1):
        dp[0][j] = j * INS_PENALTY

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            is_match = (norm_exp[i - 1] == norm_asr[j - 1]) and (norm_exp[i - 1] != "")
            score_diag = dp[i - 1][j - 1] + (MATCH_SCORE if is_match else SUB_PENALTY)
            score_del = dp[i - 1][j] + DEL_PENALTY
            score_ins = dp[i][j - 1] + INS_PENALTY
            dp[i][j] = max(score_diag, score_del, score_ins)

    # Backtracking
    i = n
    j = m
    mapping = [None] * n
    matches = 0
    substitutions = 0
    deletions = 0
    insertions = 0

    while i > 0 and j > 0:
        is_match = (norm_exp[i - 1] == norm_asr[j - 1]) and (norm_exp[i - 1] != "")
        score_diag = dp[i - 1][j - 1] + (MATCH_SCORE if is_match else SUB_PENALTY)

        if dp[i][j] == score_diag:
            if is_match:
                mapping[i - 1] = j - 1
                matches += 1
            else:
                mapping[i - 1] = j - 1  # Substitution alignment
                substitutions += 1
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j] + DEL_PENALTY:
            mapping[i - 1] = None
            deletions += 1
            i -= 1
        else:
            insertions += 1
            j -= 1

    while i > 0:
        mapping[i - 1] = None
        deletions += 1
        i -= 1
    while j > 0:
        insertions += 1
        j -= 1

    coverage_pct = round((matches / n) * 100.0, 2) if n > 0 else 100.0

    metrics = {
        "expected_words": n,
        "asr_words": m,
        "matched_words": matches,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "coverage_pct": coverage_pct
    }

    return mapping, metrics


def align_script_and_asr(
    script_text: str,
    manifest: Dict[str, Any],
    raw_whisper_segments: List[Dict[str, Any]],
    audio_duration: float
) -> Dict[str, Any]:
    """
    Primary alignment orchestrator:
    1. Segments script.txt into sentences.
    2. Builds expected synthesis tokens (incorporating pronunciation overrides if applied).
    3. Aligns expected synthesis tokens to Whisper timed words.
    4. Projects word timings back to source sentence spans.
    5. Enforces monotonic, valid timestamps (0 <= start < end <= audio_duration).
    6. Returns canonical segments and alignment metrics.
    """
    sentences = segment_script_into_sentences(script_text)
    asr_words = extract_words_from_whisper_segments(raw_whisper_segments)

    # Flatten expected tokens across all sentences
    sentence_word_spans = []  # List of (sentence_idx, word_idx_in_sentence)
    expected_tokens = []
    
    # Check if pronunciation overrides modified synthesis text
    pron_overrides = manifest.get("pronunciation_overrides", []) if manifest else []
    # Sort overrides longest-match-first
    sorted_overrides = sorted(
        [o for o in pron_overrides if o.get("original") and o.get("spoken_form")],
        key=lambda o: len(o.get("original", "")),
        reverse=True
    )

    for s_idx, s in enumerate(sentences):
        sentence_synth_text = s["text"]
        for o in sorted_overrides:
            orig = o.get("original", "").strip()
            spoken = o.get("spoken_form", "").strip()
            if orig and spoken:
                prefix = r"(?<!\w)" if re.match(r"^\w", orig) else ""
                suffix = r"(?!\w)" if re.match(r".*\w$", orig) else ""
                pattern = re.compile(f"{prefix}{re.escape(orig)}{suffix}", re.IGNORECASE)
                sentence_synth_text = pattern.sub(spoken, sentence_synth_text)

        synth_words = [w for w in re.split(r"\s+", sentence_synth_text) if w]
        if not synth_words:
            synth_words = s["words"]

        for w in synth_words:
            sentence_word_spans.append((s_idx, len(expected_tokens)))
            expected_tokens.append(w)

    # Perform sequence alignment
    mapping, metrics = align_tokens_needleman_wunsch(expected_tokens, [w["word"] for w in asr_words])

    # Map aligned ASR words to each sentence
    sentence_timings: List[Dict[str, Any]] = []
    direct_aligned_count = 0
    interpolated_count = 0
    unresolved_count = 0

    for s_idx, s in enumerate(sentences):
        # Gather all ASR words aligned to this sentence
        sentence_asr_words = []
        for word_span_s_idx, token_idx in sentence_word_spans:
            if word_span_s_idx == s_idx:
                asr_idx = mapping[token_idx]
                if asr_idx is not None and 0 <= asr_idx < len(asr_words):
                    sentence_asr_words.append(asr_words[asr_idx])

        if sentence_asr_words:
            start_t = min(w["start"] for w in sentence_asr_words)
            end_t = max(w["end"] for w in sentence_asr_words)
            if end_t <= start_t:
                end_t = start_t + 0.5
            sentence_timings.append({
                "index": s["index"],
                "text": s["text"],
                "start": start_t,
                "end": end_t,
                "source_start": s["start_char"],
                "source_end": s["end_char"],
                "status": "direct",
                "matched_tokens": len(sentence_asr_words),
                "total_tokens": len(s["words"])
            })
            direct_aligned_count += 1
        else:
            sentence_timings.append({
                "index": s["index"],
                "text": s["text"],
                "start": None,
                "end": None,
                "source_start": s["start_char"],
                "source_end": s["end_char"],
                "status": "unresolved",
                "matched_tokens": 0,
                "total_tokens": len(s["words"])
            })
            unresolved_count += 1

    # Interpolation pass for unresolved sentences bounded by valid neighbors
    for i, item in enumerate(sentence_timings):
        if item["status"] == "unresolved":
            prev_end = sentence_timings[i - 1]["end"] if i > 0 and sentence_timings[i - 1]["end"] is not None else 0.0
            next_start = None
            for j in range(i + 1, len(sentence_timings)):
                if sentence_timings[j]["start"] is not None:
                    next_start = sentence_timings[j]["start"]
                    break
            if next_start is None:
                next_start = audio_duration

            if next_start > prev_end:
                item["start"] = prev_end
                item["end"] = min(next_start, prev_end + 1.5)
                item["status"] = "interpolated"
                unresolved_count -= 1
                interpolated_count += 1

    # Monotonicity & boundary enforcement pass
    last_end = 0.0
    for item in sentence_timings:
        start_t = item["start"] if item["start"] is not None else last_end
        end_t = item["end"] if item["end"] is not None else start_t + 0.5

        # Strict monotonicity: start must not be before last_end
        if start_t < last_end:
            start_t = last_end
        if end_t <= start_t:
            end_t = start_t + 0.3
        # Cap to audio duration
        if end_t > audio_duration:
            end_t = audio_duration
            if start_t >= end_t:
                start_t = max(0.0, end_t - 0.3)

        item["start"] = round(start_t, 3)
        item["end"] = round(end_t, 3)
        last_end = item["end"]

    metrics["total_sentences"] = len(sentences)
    metrics["direct_aligned_sentences"] = direct_aligned_count
    metrics["interpolated_sentences"] = interpolated_count
    metrics["unresolved_sentences"] = unresolved_count

    return {
        "segments": sentence_timings,
        "metrics": metrics
    }
