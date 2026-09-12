"""
UnfoldIQ TTS Studio — Phase 8.1 Voice QA Service.
Evaluates narration audio against the intended script using Faster-Whisper ASR.
Pure Python standard library (Ponytail principle) reusing existing alignment infrastructure.
"""

import hashlib
import json
import logging
import math
import os
import re
import tempfile
import time
import unicodedata
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("unfoldiq.voice_qa")

SCHEMA_VERSION = 1

# Default Configurable Thresholds
DEFAULT_SETTINGS = {
    "schema_version": SCHEMA_VERSION,
    "intra_sentence_pause_threshold_s": 1.5,
    "inter_sentence_pause_threshold_s": 2.5,
    "paragraph_pause_threshold_s": 3.5,
    "wpm_low_threshold": 95.0,
    "wpm_high_threshold": 225.0,
    "low_confidence_threshold": 0.60,
    "duplicate_similarity_threshold": 0.80,
    "duplicate_min_words": 4,
    "truncation_min_trailing_words": 2,
    "max_acceptable_wer_for_pass": 0.12,
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_file_sha256(filepath: Path) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def normalize_for_matching(text: str) -> str:
    """
    Deterministic text normalization consistent with Phase 4 aligner:
    - Unicode NFKC normalization
    - Lowercase
    - Straighten curly quotes and apostrophes
    - Strip punctuation except contraction apostrophes
    - Collapse whitespace
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"(?<!\w)'|'(?!\w)", " ", text)
    cleaned = re.sub(r"[^\w\s']", " ", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def compute_issue_fingerprint(
    issue_type: str,
    start_char: int,
    end_char: int,
    expected_norm: str,
    start_time: float,
    audio_sha256: str
) -> str:
    """Deterministic SHA-256 fingerprint for stable issue tracking and review decisions."""
    key = f"{issue_type}:{start_char}:{end_char}:{expected_norm}:{round(start_time, 1)}:{audio_sha256}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def align_tokens_dp(
    expected_tokens: List[str],
    asr_tokens: List[str],
    allowed_equivalences: Optional[Dict[str, Set[str]]] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Needleman-Wunsch sequence alignment between expected synthesis tokens and ASR tokens.
    Supports pronunciation equivalences: if a token matches any of its allowed spoken forms,
    it is treated as a valid MATCH instead of a substitution.
    """
    n = len(expected_tokens)
    m = len(asr_tokens)
    equivalences = allowed_equivalences or {}

    norm_exp = [normalize_for_matching(t) for t in expected_tokens]
    norm_asr = [normalize_for_matching(t) for t in asr_tokens]

    if n == 0 and m == 0:
        return [], {
            "expected_words": 0, "asr_words": 0, "matched_words": 0,
            "substitutions": 0, "deletions": 0, "insertions": 0,
            "wer": 0.0, "match_rate": 100.0
        }

    MATCH_SCORE = 3
    SUB_PENALTY = -2
    DEL_PENALTY = -2
    INS_PENALTY = -2

    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i * DEL_PENALTY
    for j in range(m + 1):
        dp[0][j] = j * INS_PENALTY

    def tokens_match(exp_idx: int, asr_idx: int) -> bool:
        e = norm_exp[exp_idx]
        a = norm_asr[asr_idx]
        if not e or not a:
            return False
        if e == a:
            return True
        # Check pronunciation overrides equivalence
        if e in equivalences and a in equivalences[e]:
            return True
        return False

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            is_match = tokens_match(i - 1, j - 1)
            score_diag = dp[i - 1][j - 1] + (MATCH_SCORE if is_match else SUB_PENALTY)
            score_del = dp[i - 1][j] + DEL_PENALTY
            score_ins = dp[i][j - 1] + INS_PENALTY
            dp[i][j] = max(score_diag, score_del, score_ins)

    # Backtracking
    i, j = n, m
    operations = []
    matched = 0
    substitutions = 0
    deletions = 0
    insertions = 0

    while i > 0 and j > 0:
        is_match = tokens_match(i - 1, j - 1)
        score_diag = dp[i - 1][j - 1] + (MATCH_SCORE if is_match else SUB_PENALTY)

        if dp[i][j] == score_diag:
            if is_match:
                operations.append({
                    "op": "match",
                    "exp_idx": i - 1,
                    "asr_idx": j - 1,
                    "expected": expected_tokens[i - 1],
                    "detected": asr_tokens[j - 1]
                })
                matched += 1
            else:
                operations.append({
                    "op": "substitution",
                    "exp_idx": i - 1,
                    "asr_idx": j - 1,
                    "expected": expected_tokens[i - 1],
                    "detected": asr_tokens[j - 1]
                })
                substitutions += 1
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j] + DEL_PENALTY:
            operations.append({
                "op": "deletion",
                "exp_idx": i - 1,
                "asr_idx": None,
                "expected": expected_tokens[i - 1],
                "detected": None
            })
            deletions += 1
            i -= 1
        else:
            operations.append({
                "op": "insertion",
                "exp_idx": None,
                "asr_idx": j - 1,
                "expected": None,
                "detected": asr_tokens[j - 1]
            })
            insertions += 1
            j -= 1

    while i > 0:
        operations.append({
            "op": "deletion",
            "exp_idx": i - 1,
            "asr_idx": None,
            "expected": expected_tokens[i - 1],
            "detected": None
        })
        deletions += 1
        i -= 1

    while j > 0:
        operations.append({
            "op": "insertion",
            "exp_idx": None,
            "asr_idx": j - 1,
            "expected": None,
            "detected": asr_tokens[j - 1]
        })
        insertions += 1
        j -= 1

    operations.reverse()

    wer = round((substitutions + deletions + insertions) / max(1, n), 4)
    match_rate = round((matched / max(1, n)) * 100.0, 2)

    metrics = {
        "expected_words": n,
        "asr_words": m,
        "matched_words": matched,
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "wer": wer,
        "match_rate": match_rate
    }

    return operations, metrics


class VoiceQAEvaluator:
    """Evaluates Faster-Whisper speech recognition output against script.txt and pronunciation rules."""

    def __init__(self, settings: Optional[Dict[str, Any]] = None):
        self.settings = dict(DEFAULT_SETTINGS)
        if settings:
            self.settings.update(settings)

    def evaluate(
        self,
        script_text: str,
        *args,
        raw_whisper_segments: Optional[List[Dict[str, Any]]] = None,
        audio_duration: Optional[float] = None,
        audio_sha256: Optional[str] = None,
        raw_segments: Optional[List[Dict[str, Any]]] = None,
        pronunciation_entries: Optional[List[Dict[str, Any]]] = None,
        manifest_chunks: Optional[List[Dict[str, Any]]] = None,
        existing_decisions: Optional[Dict[str, str]] = None,
        human_decisions: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Runs comprehensive Voice QA analysis:
        1. Prepares display reference and acoustic reference.
        2. Flattens timed words from Whisper.
        3. Runs Needleman-Wunsch alignment.
        4. Detects Missing, Extra, Substitutions, Truncations, Duplicates, Pauses, Speed anomalies.
        5. Computes overall status: PASS / REVIEW / FAIL.
        6. Preserves human decisions for matching fingerprints.
        """
        # Parse flexible positional arguments
        if len(args) >= 1:
            if isinstance(args[0], list):
                raw_whisper_segments = args[0]
                if len(args) >= 2 and isinstance(args[1], (int, float)):
                    audio_duration = float(args[1])
                if len(args) >= 3 and isinstance(args[2], str):
                    audio_sha256 = str(args[2])
            elif isinstance(args[0], (int, float)):
                audio_duration = float(args[0])
                if len(args) >= 2 and isinstance(args[1], str):
                    audio_sha256 = str(args[1])
                if len(args) >= 3 and isinstance(args[2], list):
                    raw_whisper_segments = args[2]

        if raw_whisper_segments is None:
            raw_whisper_segments = raw_segments or []
        if existing_decisions is None:
            existing_decisions = human_decisions or {}
        if audio_duration is None:
            audio_duration = 0.0
        if audio_sha256 is None:
            audio_sha256 = ""

        # 1. Build sentences and words from script.txt (verbatim display reference)
        sentences = self._segment_sentences(script_text)
        ref_words: List[Dict[str, Any]] = []
        for s in sentences:
            for w_idx, w_text in enumerate(s["words"]):
                ref_words.append({
                    "word": w_text,
                    "sentence_index": s["index"],
                    "start_char": s["start_char"],
                    "end_char": s["end_char"],
                    "sentence_text": s["text"],
                    "word_index_in_sent": w_idx
                })

        # 2. Build acoustic equivalences from Pronunciation Dictionary
        equivalences = self._build_pronunciation_equivalences(pronunciation_entries or [])

        # 3. Flatten Whisper ASR words
        asr_words: List[Dict[str, Any]] = []
        for seg in raw_whisper_segments:
            for w in seg.get("words", []):
                txt = w.get("word", "").strip()
                if txt:
                    asr_words.append({
                        "word": txt,
                        "start": float(w.get("start", 0.0)),
                        "end": float(w.get("end", 0.0)),
                        "probability": float(w.get("probability", 1.0)),
                        "segment_id": seg.get("id", 0)
                    })

        # 4. Align tokens
        exp_tokens = [w["word"] for w in ref_words]
        asr_tokens = [w["word"] for w in asr_words]
        operations, metrics = align_tokens_dp(exp_tokens, asr_tokens, equivalences)

        # 5. Detect Issues
        issues: List[Dict[str, Any]] = []

        # A. Detect Substitutions, Missing Words, Extra Words
        issues.extend(self._detect_token_mismatches(
            operations=operations,
            ref_words=ref_words,
            asr_words=asr_words,
            equivalences=equivalences,
            audio_sha256=audio_sha256
        ))

        # B. Detect Duplicate Spoken Blocks
        duplicate_issues = self._detect_duplicates(
            script_text=script_text,
            asr_words=asr_words,
            audio_sha256=audio_sha256
        )
        issues.extend(duplicate_issues)

        # C. Detect Long Pauses
        pause_issues = self._detect_long_pauses(
            asr_words=asr_words,
            sentences=sentences,
            audio_sha256=audio_sha256
        )
        issues.extend(pause_issues)

        # D. Detect Sentence Cuts / Truncations
        truncation_issues = self._detect_truncations(
            operations=operations,
            ref_words=ref_words,
            asr_words=asr_words,
            audio_duration=audio_duration,
            manifest_chunks=manifest_chunks,
            audio_sha256=audio_sha256
        )
        issues.extend(truncation_issues)

        # E. Calculate Sentence-level WPM anomalies
        wpm_issues, sentence_wpms = self._calculate_sentence_wpms(
            operations=operations,
            sentences=sentences,
            asr_words=asr_words,
            audio_sha256=audio_sha256
        )
        issues.extend(wpm_issues)

        # F. Detect Low-Confidence ASR Words
        low_conf_thresh = self.settings.get("low_confidence_threshold", 0.50)
        for w in asr_words:
            prob = w.get("probability", 1.0)
            if prob < low_conf_thresh:
                already_covered = any(
                    iss.get("type") in ("substitution", "missing_words", "extra_words") and
                    abs(iss.get("start_time", 0.0) - w["start"]) < 0.2
                    for iss in issues
                )
                if not already_covered:
                    w_txt = w["word"]
                    fp = compute_issue_fingerprint("low_conf", 0, 0, w_txt, w["start"], audio_sha256)
                    issues.append({
                        "fingerprint": fp,
                        "type": "low_confidence",
                        "category": "low_confidence",
                        "severity": "review",
                        "sentence_index": 0,
                        "start_char": 0,
                        "end_char": 0,
                        "start_time": round(w["start"], 3),
                        "end_time": round(w["end"], 3),
                        "start_seconds": round(w["start"], 3),
                        "end_seconds": round(w["end"], 3),
                        "expected": w_txt,
                        "expected_text": w_txt,
                        "detected": w_txt,
                        "recognized_text": w_txt,
                        "context": w_txt,
                        "reason": f"Low-confidence ASR word: '{w_txt}' ({prob:.2f})",
                        "description": f"Low-confidence ASR word: '{w_txt}' ({prob:.2f})",
                        "confidence": round(prob, 3),
                        "is_proper_noun": False,
                        "requires_pronunciation_qa": False,
                        "resolution": "unresolved",
                        "decision": "open"
                    })

        # 6. Apply Existing Human Review Decisions (Fingerprint matching)
        decisions = existing_decisions or {}
        for issue in issues:
            fp = issue["fingerprint"]
            if fp in decisions:
                dec_val = decisions[fp]
                if isinstance(dec_val, dict):
                    dec_val = dec_val.get("decision", "open")
                issue["decision"] = dec_val
                issue["resolution"] = dec_val
            else:
                issue["decision"] = issue.get("decision", "open")
                issue["resolution"] = issue.get("resolution", "unresolved")

            # Ensure all compatibility fields are populated
            if "description" not in issue:
                issue["description"] = issue.get("reason", "")
            if "expected_text" not in issue:
                issue["expected_text"] = issue.get("expected", "")
            if "recognized_text" not in issue:
                issue["recognized_text"] = issue.get("detected", "")

        # 7. Summary Counts & Status Calculation
        review_count = 0
        fail_count = 0
        dup_count = 0
        pause_count = 0
        cut_count = 0

        for issue in issues:
            if issue.get("resolution") in ("accepted", "waived") or issue.get("decision") in ("accepted", "waived"):
                continue
            sev = issue["severity"]
            if sev == "fail":
                fail_count += 1
            elif sev == "review":
                review_count += 1

            itype = issue.get("category", issue.get("type"))
            if itype in ("duplicate_block", "duplicate_spoken_block", "duplicate"):
                dup_count += 1
            elif itype in ("long_pause", "pause"):
                pause_count += 1
            elif itype in ("sentence_cut", "truncation"):
                cut_count += 1

        overall_wpm = round(len(ref_words) / (audio_duration / 60.0), 1) if audio_duration > 0 else 0.0

        if fail_count > 0:
            status = "fail"
        elif review_count > 0:
            status = "review"
        else:
            status = "pass"

        wer_ratio = metrics["wer"]
        wer_pct = round(wer_ratio * 100.0, 2)
        match_rate = metrics["match_rate"]

        final_metrics = {
            "reference_words": len(ref_words),
            "recognized_words": len(asr_words),
            "matched_words": metrics["matched_words"],
            "substitutions": metrics["substitutions"],
            "deletions": metrics["deletions"],
            "insertions": metrics["insertions"],
            "wer": wer_ratio,
            "wer_pct": wer_pct,
            "transcript_match_percent": match_rate,
            "transcript_match_pct": match_rate,
            "overall_wpm": overall_wpm,
            "duplicate_count": dup_count,
            "long_pause_count": pause_count,
            "sentence_cut_count": cut_count,
            "review_count": review_count,
            "fail_count": fail_count,
            "total_issues": len(issues)
        }

        summary = {
            "unresolved_fail_count": fail_count,
            "unresolved_review_count": review_count,
            "total_issues": len(issues),
            "duplicate_count": dup_count,
            "long_pause_count": pause_count,
            "sentence_cut_count": cut_count
        }

        # Sort issues chronologically
        issues.sort(key=lambda x: (x.get("start_time", 0.0), x.get("start_char", 0)))

        return {
            "schema_version": SCHEMA_VERSION,
            "status": status,
            "generated_at": _utc_now_iso(),
            "audio_sha256": audio_sha256,
            "audio_duration": round(audio_duration, 3),
            "metrics": final_metrics,
            "summary": summary,
            "issues": issues,
            "sentence_wpms": sentence_wpms
        }

    # --------------------------------------------------------------------------
    # Internal Detectors
    # --------------------------------------------------------------------------

    def _segment_sentences(self, script_text: str) -> List[Dict[str, Any]]:
        """Splits script.txt into sentences with offsets and words."""
        if not script_text or not script_text.strip():
            return []
        pattern = r'([^\n.!?]+(?:[\.!?]+["\']?|\n+|$))'
        raw_parts = [m.group(0) for m in re.finditer(pattern, script_text) if m.group(0).strip()]

        sentences = []
        current_idx = 0
        for idx, part in enumerate(raw_parts, start=1):
            clean_part = part.strip()
            if not clean_part:
                continue
            start_c = script_text.find(clean_part, current_idx)
            if start_c == -1:
                start_c = current_idx
            end_c = start_c + len(clean_part)
            current_idx = end_c

            words = [w for w in re.split(r"\s+", clean_part) if w]
            sentences.append({
                "index": idx,
                "text": clean_part,
                "start_char": start_c,
                "end_char": end_c,
                "words": words
            })
        return sentences

    def _build_pronunciation_equivalences(
        self, entries: List[Dict[str, Any]]
    ) -> Dict[str, Set[str]]:
        """Maps normalized original phrases to their normalized spoken words."""
        equiv: Dict[str, Set[str]] = {}
        for e in entries:
            if not e.get("enabled", True):
                continue
            orig_norm = normalize_for_matching(e.get("original", ""))
            spoken_norm = normalize_for_matching(e.get("spoken_form", ""))
            if orig_norm and spoken_norm:
                orig_tokens = orig_norm.split()
                spoken_tokens = spoken_norm.split()
                for ot in orig_tokens:
                    if ot not in equiv:
                        equiv[ot] = set()
                    equiv[ot].update(spoken_tokens)
                    equiv[ot].add(ot)
        return equiv

    def _detect_token_mismatches(
        self,
        operations: List[Dict[str, Any]],
        ref_words: List[Dict[str, Any]],
        asr_words: List[Dict[str, Any]],
        equivalences: Dict[str, Set[str]],
        audio_sha256: str
    ) -> List[Dict[str, Any]]:
        issues: List[Dict[str, Any]] = []

        for op in operations:
            op_type = op["op"]
            if op_type == "match":
                continue

            exp_idx = op.get("exp_idx")
            asr_idx = op.get("asr_idx")

            ref_info = ref_words[exp_idx] if exp_idx is not None and exp_idx < len(ref_words) else None
            asr_info = asr_words[asr_idx] if asr_idx is not None and asr_idx < len(asr_words) else None

            start_t = asr_info["start"] if asr_info else (self._estimate_time_for_exp(exp_idx, operations, asr_words))
            end_t = asr_info["end"] if asr_info else (start_t + 0.5)

            start_c = ref_info["start_char"] if ref_info else 0
            end_c = ref_info["end_char"] if ref_info else 0
            sent_idx = ref_info["sentence_index"] if ref_info else 0
            sent_txt = ref_info["sentence_text"] if ref_info else ""

            exp_word = op.get("expected") or ""
            det_word = op.get("detected") or ""
            conf = asr_info.get("probability", 1.0) if asr_info else 0.0

            is_proper_noun = bool(exp_word and (exp_word[0].isupper() or normalize_for_matching(exp_word) in equivalences))

            if op_type == "substitution":
                # Check if it's a known proper noun or scientific term
                if is_proper_noun or conf < self.settings["low_confidence_threshold"]:
                    reason = "Possible pronunciation / ASR mismatch" if is_proper_noun else f"Substituted word (low confidence: {conf:.2f})"
                    severity = "review"
                    category = "proper_noun" if is_proper_noun else "substitution"
                else:
                    reason = f"Word mismatch: expected '{exp_word}', heard '{det_word}'"
                    severity = "fail"
                    category = "substitution"

                fp = compute_issue_fingerprint("substitution", start_c, end_c, normalize_for_matching(exp_word), start_t, audio_sha256)
                issues.append({
                    "fingerprint": fp,
                    "type": "substitution",
                    "category": category,
                    "severity": severity,
                    "sentence_index": sent_idx,
                    "start_char": start_c,
                    "end_char": end_c,
                    "start_time": round(start_t, 3),
                    "end_time": round(end_t, 3),
                    "start_seconds": round(start_t, 3),
                    "end_seconds": round(end_t, 3),
                    "expected": exp_word,
                    "expected_text": exp_word,
                    "detected": det_word,
                    "recognized_text": det_word,
                    "context": sent_txt,
                    "reason": reason,
                    "description": reason,
                    "confidence": round(conf, 3),
                    "is_proper_noun": is_proper_noun,
                    "requires_pronunciation_qa": is_proper_noun,
                    "resolution": "unresolved",
                    "decision": "open"
                })

            elif op_type == "deletion":
                reason = f"Missing word in speech: '{exp_word}'"
                severity = "fail"
                fp = compute_issue_fingerprint("deletion", start_c, end_c, normalize_for_matching(exp_word), start_t, audio_sha256)
                issues.append({
                    "fingerprint": fp,
                    "type": "missing_words",
                    "category": "missing_words",
                    "severity": severity,
                    "sentence_index": sent_idx,
                    "start_char": start_c,
                    "end_char": end_c,
                    "start_time": round(start_t, 3),
                    "end_time": round(end_t, 3),
                    "start_seconds": round(start_t, 3),
                    "end_seconds": round(end_t, 3),
                    "expected": exp_word,
                    "expected_text": exp_word,
                    "detected": "",
                    "recognized_text": "",
                    "context": sent_txt,
                    "reason": reason,
                    "description": reason,
                    "confidence": 0.0,
                    "is_proper_noun": is_proper_noun,
                    "requires_pronunciation_qa": False,
                    "resolution": "unresolved",
                    "decision": "open"
                })

            elif op_type == "insertion":
                reason = f"Extra word in speech: '{det_word}'"
                severity = "review"
                fp = compute_issue_fingerprint("insertion", start_c, end_c, normalize_for_matching(det_word), start_t, audio_sha256)
                issues.append({
                    "fingerprint": fp,
                    "type": "extra_words",
                    "category": "extra_words",
                    "severity": severity,
                    "sentence_index": sent_idx,
                    "start_char": start_c,
                    "end_char": end_c,
                    "start_time": round(start_t, 3),
                    "end_time": round(end_t, 3),
                    "start_seconds": round(start_t, 3),
                    "end_seconds": round(end_t, 3),
                    "expected": "",
                    "expected_text": "",
                    "detected": det_word,
                    "recognized_text": det_word,
                    "context": sent_txt,
                    "reason": reason,
                    "description": reason,
                    "confidence": round(conf, 3),
                    "is_proper_noun": False,
                    "requires_pronunciation_qa": False,
                    "resolution": "unresolved",
                    "decision": "open"
                })

        return issues

    def _estimate_time_for_exp(
        self,
        exp_idx: Optional[int],
        operations: List[Dict[str, Any]],
        asr_words: List[Dict[str, Any]]
    ) -> float:
        """Finds nearest neighboring aligned ASR time for unaligned token."""
        if not asr_words:
            return 0.0
        if exp_idx is None:
            return asr_words[0]["start"]

        for op in operations:
            if op.get("exp_idx") == exp_idx and op.get("asr_idx") is not None:
                return asr_words[op["asr_idx"]]["start"]

        # Search forward
        for op in operations:
            if (op.get("exp_idx") or 0) > exp_idx and op.get("asr_idx") is not None:
                return asr_words[op["asr_idx"]]["start"]

        return asr_words[-1]["end"]

    def _detect_duplicates(
        self,
        script_text: str,
        asr_words: List[Dict[str, Any]],
        audio_sha256: str
    ) -> List[Dict[str, Any]]:
        """
        Catches repeated spoken blocks that do not legitimately occur twice in the source script.
        Uses sliding window token similarity and temporal adjacency.
        """
        issues = []
        min_words = self.settings["duplicate_min_words"]
        sim_thresh = self.settings["duplicate_similarity_threshold"]

        if len(asr_words) < min_words * 2:
            return []

        norm_words = [normalize_for_matching(w["word"]) for w in asr_words]
        norm_script = normalize_for_matching(script_text)

        # Window sizes from 4 to 12 words
        for w_len in (4, 6, 8, 12):
            for i in range(len(norm_words) - w_len * 2 + 1):
                win1 = norm_words[i:i + w_len]
                win1_str = " ".join(win1)
                if not win1_str.strip():
                    continue

                # Look in adjacent forward window
                for j in range(i + w_len, min(i + w_len * 3, len(norm_words) - w_len + 1)):
                    win2 = norm_words[j:j + w_len]
                    win2_str = " ".join(win2)

                    matches = sum(1 for a, b in zip(win1, win2) if a == b)
                    sim = matches / float(w_len)

                    if sim >= sim_thresh:
                        occurrences_in_script = len(re.findall(re.escape(win1_str), norm_script))
                        if occurrences_in_script <= 1:
                            t1_start = asr_words[i]["start"]
                            t1_end = asr_words[i + w_len - 1]["end"]
                            t2_start = asr_words[j]["start"]
                            t2_end = asr_words[j + w_len - 1]["end"]

                            fp = compute_issue_fingerprint("duplicate", 0, 0, win1_str, t2_start, audio_sha256)
                            if not any(iss["fingerprint"] == fp or abs(iss["start_time"] - t2_start) < 2.0 for iss in issues):
                                issues.append({
                                    "fingerprint": fp,
                                    "type": "duplicate_spoken_block",
                                    "category": "duplicate_block",
                                    "severity": "fail",
                                    "sentence_index": 0,
                                    "start_char": 0,
                                    "end_char": 0,
                                    "start_time": round(t2_start, 3),
                                    "end_time": round(t2_end, 3),
                                    "start_seconds": round(t2_start, 3),
                                    "end_seconds": round(t2_end, 3),
                                    "expected": "Spoken once",
                                    "expected_text": "Spoken once",
                                    "detected": win1_str,
                                    "recognized_text": win1_str,
                                    "context": f"First heard at {t1_start:.1f}s, repeated at {t2_start:.1f}s",
                                    "reason": f"Duplicated spoken block: '{win1_str}' repeated in audio but occurs once in script",
                                    "description": f"Duplicated spoken block: '{win1_str}' repeated in audio but occurs once in script",
                                    "confidence": round(sim, 3),
                                    "is_proper_noun": False,
                                    "requires_pronunciation_qa": False,
                                    "resolution": "unresolved",
                                    "decision": "open"
                                })
        return issues

    def _detect_long_pauses(
        self,
        asr_words: List[Dict[str, Any]],
        sentences: List[Dict[str, Any]],
        audio_sha256: str
    ) -> List[Dict[str, Any]]:
        """Detects abnormally long silence between words or sentences."""
        issues = []
        intra_thresh = self.settings["intra_sentence_pause_threshold_s"]
        inter_thresh = self.settings["inter_sentence_pause_threshold_s"]

        for i in range(len(asr_words) - 1):
            w1 = asr_words[i]
            w2 = asr_words[i + 1]
            pause = w2["start"] - w1["end"]

            if pause >= intra_thresh:
                severity = "review"
                reason = f"Long pause ({pause:.2f}s) between '{w1['word']}' and '{w2['word']}'"

                fp = compute_issue_fingerprint("pause", 0, 0, f"{w1['word']}_{w2['word']}", w1["end"], audio_sha256)
                issues.append({
                    "fingerprint": fp,
                    "type": "long_pause",
                    "category": "long_pause",
                    "severity": severity,
                    "sentence_index": 0,
                    "start_char": 0,
                    "end_char": 0,
                    "start_time": round(w1["end"], 3),
                    "end_time": round(w2["start"], 3),
                    "start_seconds": round(w1["end"], 3),
                    "end_seconds": round(w2["start"], 3),
                    "expected": "Normal pacing (< 1.5s pause)",
                    "expected_text": "Normal pacing (< 1.5s pause)",
                    "detected": f"{pause:.2f}s silence",
                    "recognized_text": f"{pause:.2f}s silence",
                    "context": f"...{w1['word']} [ {pause:.2f}s ] {w2['word']}...",
                    "reason": reason,
                    "description": reason,
                    "confidence": 1.0,
                    "is_proper_noun": False,
                    "requires_pronunciation_qa": False,
                    "resolution": "unresolved",
                    "decision": "open"
                })
        return issues

    def _detect_truncations(
        self,
        operations: List[Dict[str, Any]],
        ref_words: List[Dict[str, Any]],
        asr_words: List[Dict[str, Any]],
        audio_duration: float,
        manifest_chunks: Optional[List[Dict[str, Any]]],
        audio_sha256: str
    ) -> List[Dict[str, Any]]:
        """Detects likely truncated narration: multiple trailing deleted words at the end of a sentence or audio."""
        issues = []
        min_trailing = self.settings["truncation_min_trailing_words"]

        sent_ops: Dict[int, List[Dict[str, Any]]] = {}
        for op in operations:
            exp_idx = op.get("exp_idx")
            if exp_idx is not None and exp_idx < len(ref_words):
                s_idx = ref_words[exp_idx]["sentence_index"]
                if s_idx not in sent_ops:
                    sent_ops[s_idx] = []
                sent_ops[s_idx].append(op)

        for s_idx, ops in sent_ops.items():
            if not ops:
                continue
            trailing_dels = 0
            deleted_words = []
            for op in reversed(ops):
                if op["op"] == "deletion":
                    trailing_dels += 1
                    deleted_words.append(op["expected"])
                else:
                    break

            if trailing_dels >= min_trailing:
                deleted_words.reverse()
                ref_info = next((r for r in ref_words if r["sentence_index"] == s_idx), None)
                start_c = ref_info["start_char"] if ref_info else 0
                end_c = ref_info["end_char"] if ref_info else 0
                sent_txt = ref_info["sentence_text"] if ref_info else ""

                last_matched = next((op for op in reversed(ops) if op.get("asr_idx") is not None), None)
                cut_time = asr_words[last_matched["asr_idx"]]["end"] if last_matched else max(0.0, audio_duration - 1.0)

                affected_chunk = None
                if manifest_chunks:
                    for ch in manifest_chunks:
                        if ch.get("start_char", 0) <= start_c <= ch.get("end_char", 0):
                            affected_chunk = ch.get("chunk_index")
                            break

                fp = compute_issue_fingerprint("truncation", start_c, end_c, " ".join(deleted_words), cut_time, audio_sha256)
                issues.append({
                    "fingerprint": fp,
                    "type": "sentence_cut",
                    "category": "sentence_cut",
                    "severity": "fail",
                    "sentence_index": s_idx,
                    "start_char": start_c,
                    "end_char": end_c,
                    "start_time": round(cut_time, 3),
                    "end_time": round(min(cut_time + 1.5, audio_duration), 3),
                    "start_seconds": round(cut_time, 3),
                    "end_seconds": round(min(cut_time + 1.5, audio_duration), 3),
                    "expected": sent_txt,
                    "expected_text": sent_txt,
                    "detected": f"Speech cut before trailing {trailing_dels} words: '{' '.join(deleted_words)}'",
                    "recognized_text": f"Speech cut before trailing {trailing_dels} words: '{' '.join(deleted_words)}'",
                    "context": sent_txt,
                    "reason": f"Sentence appears truncated: {trailing_dels} trailing words omitted",
                    "description": f"Sentence appears truncated: {trailing_dels} trailing words omitted",
                    "affected_chunk": affected_chunk,
                    "confidence": 0.95,
                    "is_proper_noun": False,
                    "requires_pronunciation_qa": False,
                    "resolution": "unresolved",
                    "decision": "open"
                })

        return issues

    def _calculate_sentence_wpms(
        self,
        operations: List[Dict[str, Any]],
        sentences: List[Dict[str, Any]],
        asr_words: List[Dict[str, Any]],
        audio_sha256: str
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Calculates WPM per sentence and flags local speed anomalies."""
        issues = []
        sentence_wpms = []
        low_thresh = self.settings["wpm_low_threshold"]
        high_thresh = self.settings["wpm_high_threshold"]

        sent_asr_indices: Dict[int, List[int]] = {}
        for op in operations:
            exp_idx = op.get("exp_idx")
            asr_idx = op.get("asr_idx")
            if exp_idx is not None and asr_idx is not None:
                cur_words = 0
                for s in sentences:
                    w_count = len(s["words"])
                    if cur_words <= exp_idx < cur_words + w_count:
                        s_idx = s["index"]
                        if s_idx not in sent_asr_indices:
                            sent_asr_indices[s_idx] = []
                        sent_asr_indices[s_idx].append(asr_idx)
                        break
                    cur_words += w_count

        for s in sentences:
            s_idx = s["index"]
            w_count = len(s["words"])
            indices = sent_asr_indices.get(s_idx, [])

            if indices and w_count >= 4:
                first_idx = min(indices)
                last_idx = max(indices)
                s_start = asr_words[first_idx]["start"]
                s_end = asr_words[last_idx]["end"]
                dur = max(0.2, s_end - s_start)
                wpm = round((w_count / (dur / 60.0)), 1)

                record = {
                    "sentence_index": s_idx,
                    "text": s["text"],
                    "word_count": w_count,
                    "start": round(s_start, 3),
                    "end": round(s_end, 3),
                    "duration": round(dur, 2),
                    "wpm": wpm
                }
                sentence_wpms.append(record)

                if wpm < low_thresh or wpm > high_thresh:
                    sev = "review"
                    descriptor = "abnormally slow" if wpm < low_thresh else "abnormally fast"
                    fp = compute_issue_fingerprint("wpm", s["start_char"], s["end_char"], f"wpm_{wpm}", s_start, audio_sha256)
                    issues.append({
                        "fingerprint": fp,
                        "type": "speed_anomaly",
                        "category": "abnormal_wpm",
                        "severity": sev,
                        "sentence_index": s_idx,
                        "start_char": s["start_char"],
                        "end_char": s["end_char"],
                        "start_time": round(s_start, 3),
                        "end_time": round(s_end, 3),
                        "start_seconds": round(s_start, 3),
                        "end_seconds": round(s_end, 3),
                        "expected": f"Pacing ~140-160 WPM",
                        "expected_text": f"Pacing ~140-160 WPM",
                        "detected": f"{wpm} WPM ({descriptor})",
                        "recognized_text": f"{wpm} WPM ({descriptor})",
                        "context": s["text"],
                        "reason": f"Sentence speech rate is {descriptor} ({wpm} WPM)",
                        "description": f"Sentence speech rate is {descriptor} ({wpm} WPM)",
                        "confidence": 0.85,
                        "is_proper_noun": False,
                        "requires_pronunciation_qa": False,
                        "resolution": "unresolved",
                        "decision": "open"
                    })
            else:
                sentence_wpms.append({
                    "sentence_index": s_idx,
                    "text": s["text"],
                    "word_count": w_count,
                    "start": 0.0,
                    "end": 0.0,
                    "duration": 0.0,
                    "wpm": 0.0
                })

        return issues, sentence_wpms


class VoiceQAManager:
    """Manages project-scoped Voice QA execution, artifact storage, and decision persistence."""

    def __init__(self, projects_dir: Path):
        self.projects_dir = Path(projects_dir)

    def _resolve_project_dir(self, project_dir: Any) -> Path:
        p = Path(project_dir)
        if not p.is_absolute() and self.projects_dir:
            p = self.projects_dir / project_dir
        return p

    def get_qa_paths(self, project_dir: Any) -> Dict[str, Path]:
        p = self._resolve_project_dir(project_dir)
        return {
            "qa_json": p / "voice_qa.json",
            "transcript_json": p / "voice_qa_transcript.json",
            "settings_json": p / "voice_qa_settings.json",
            "decisions_json": p / "voice_qa_decisions.json",
            "raw_whisper": p / "transcription_raw.json",
            "script": p / "script.txt",
            "audio": p / "audio.wav",
            "manifest": p / "manifest.json"
        }

    def check_status(self, project_dir: Any) -> Dict[str, Any]:
        """Inspects project directory to check Voice QA readiness, gating, and staleness."""
        paths = self.get_qa_paths(project_dir)
        has_audio = paths["audio"].is_file()
        has_script = paths["script"].is_file()

        if not has_audio:
            return {
                "status": "error",
                "state": "error",
                "exists": False,
                "has_audio": False,
                "is_stale": False,
                "error": "Missing audio.wav in project directory."
            }
        if not has_script:
            return {
                "status": "error",
                "state": "error",
                "exists": False,
                "has_audio": True,
                "is_stale": False,
                "error": "Missing script.txt in project directory."
            }

        if not paths["qa_json"].is_file():
            return {
                "status": "idle",
                "state": "idle",
                "exists": False,
                "has_audio": True,
                "is_stale": False
            }

        try:
            with open(paths["qa_json"], "r", encoding="utf-8") as f:
                data = json.load(f)

            current_audio_hash = compute_file_sha256(paths["audio"])
            saved_audio_hash = data.get("audio_sha256", "")
            is_stale = (current_audio_hash != saved_audio_hash)
            raw_status = data.get("status", "pass").lower()
            status_val = "stale" if is_stale else raw_status

            return {
                "status": status_val,
                "state": status_val,
                "is_stale": is_stale,
                "stale": is_stale,
                "exists": True,
                "has_audio": True,
                "data": data,
                "metrics": data.get("metrics", {}),
                "issues": data.get("issues", []),
                "summary": data.get("summary", {}),
                "audio_sha256": current_audio_hash,
                "saved_audio_sha256": saved_audio_hash,
                "created_at": data.get("created_at", "")
            }
        except Exception as e:
            logger.warning(f"Failed to check Voice QA status in {project_dir}: {e}")
            return {"status": "error", "state": "error", "exists": True, "error": str(e)}

    def load_qa_report(self, project_dir: Any) -> Optional[Dict[str, Any]]:
        paths = self.get_qa_paths(project_dir)
        if not paths["qa_json"].is_file():
            return None
        with open(paths["qa_json"], "r", encoding="utf-8") as f:
            return json.load(f)

    def save_qa_report_atomically(self, project_dir: Any, data: Dict[str, Any]):
        """Atomic write using temporary file to prevent corruption."""
        paths = self.get_qa_paths(project_dir)
        p = self._resolve_project_dir(project_dir)
        json_str = json.dumps(data, indent=2, ensure_ascii=False)

        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(p),
                delete=False,
                encoding="utf-8",
                prefix="voice_qa_tmp_",
                suffix=".json"
            ) as tf:
                temp_file = Path(tf.name)
                tf.write(json_str)

            temp_file.replace(paths["qa_json"])
        except Exception:
            if temp_file and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass
            raise

    def save_evaluation(self, project_dir: Any, data: Dict[str, Any]):
        """Alias for save_qa_report_atomically."""
        self.save_qa_report_atomically(project_dir, data)

    def load_decisions(self, project_dir: Any) -> Dict[str, Any]:
        paths = self.get_qa_paths(project_dir)
        if not paths["decisions_json"].is_file():
            return {}
        try:
            with open(paths["decisions_json"], "r", encoding="utf-8") as f:
                data = json.load(f)
            # Validate audio hash staleness for decisions
            if paths["audio"].is_file():
                current_hash = compute_file_sha256(paths["audio"])
                if data.get("audio_sha256") != current_hash:
                    return {}
            return data.get("decisions", {})
        except Exception as e:
            logger.warning(f"Error reading decisions for {project_dir}: {e}")
            return {}

    def save_decisions(self, project_dir: Any, decisions: Dict[str, Any], audio_sha256: str = ""):
        paths = self.get_qa_paths(project_dir)
        p = self._resolve_project_dir(project_dir)
        if not audio_sha256 and paths["audio"].is_file():
            audio_sha256 = compute_file_sha256(paths["audio"])
        payload = {
            "audio_sha256": audio_sha256,
            "decisions": decisions
        }
        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(p),
                delete=False,
                encoding="utf-8",
                prefix="decisions_tmp_",
                suffix=".json"
            ) as tf:
                temp_file = Path(tf.name)
                json.dump(payload, tf, indent=2, ensure_ascii=False)
            temp_file.replace(paths["decisions_json"])
        except Exception:
            if temp_file and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass

    def invalidate_decisions_if_audio_changed(self, project_dir: Any):
        paths = self.get_qa_paths(project_dir)
        if not paths["decisions_json"].is_file() or not paths["audio"].is_file():
            return
        try:
            current_hash = compute_file_sha256(paths["audio"])
            with open(paths["decisions_json"], "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("audio_sha256") != current_hash:
                paths["decisions_json"].unlink()
        except Exception:
            pass

    def record_decision(
        self,
        project_dir: Any,
        fingerprint: str,
        decision: str,  # "accepted" | "waived"
        note: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Records a human decision (accepted or waived) for an issue fingerprint."""
        paths = self.get_qa_paths(project_dir)
        report = self.load_qa_report(project_dir)
        if not report:
            return None

        matched = False
        for issue in report.get("issues", []):
            if issue.get("fingerprint") == fingerprint:
                issue["resolution"] = decision
                issue["decision"] = decision
                if note:
                    issue["decision_note"] = note
                matched = True
                break

        if not matched:
            return None

        # Recalculate unresolved counts and status
        unresolved_fail = 0
        unresolved_review = 0
        for issue in report.get("issues", []):
            res = issue.get("resolution", "unresolved")
            if res in ("accepted", "waived"):
                continue
            if issue.get("severity") == "fail":
                unresolved_fail += 1
            elif issue.get("severity") == "review":
                unresolved_review += 1

        if "summary" not in report:
            report["summary"] = {}
        report["summary"]["unresolved_fail_count"] = unresolved_fail
        report["summary"]["unresolved_review_count"] = unresolved_review

        if unresolved_fail > 0:
            report["status"] = "fail"
        elif unresolved_review > 0:
            report["status"] = "review"
        else:
            report["status"] = "pass"

        # Save updated voice_qa.json
        self.save_qa_report_atomically(project_dir, report)

        # Also persist to voice_qa_decisions.json
        decisions = self.load_decisions(project_dir)
        decisions[fingerprint] = {
            "decision": decision,
            "note": note or "",
            "audio_sha256": report.get("audio_sha256", "")
        }
        self.save_decisions(project_dir, decisions, audio_sha256=report.get("audio_sha256", ""))

        return {
            "status": report["status"],
            "data": report
        }


# Singleton Voice QA Manager
voice_qa_manager = VoiceQAManager(Path(__file__).resolve().parent.parent / "projects")
