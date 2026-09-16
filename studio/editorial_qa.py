"""
UnfoldIQ Phase 12 — Script Editorial QA + Protected Facts.

Suggestion-first editorial QA (DETECT -> SUGGEST -> DIFF -> APPLY SELECTED -> IGNORE).
No whole-script rewrite, no silent rewrite, no automatic factual modification.

Artifacts (project-scoped):
  editorial_qa.json      issues, score, status, applied/ignored decisions
  script_protection.json locked factual spans (numbers, dates, species, names, anchors, caveats)

Deterministic, stdlib only. No LLM.
"""

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from studio.config import PROJECTS_DIR
from studio.scene_planner import compute_file_sha256

logger = logging.getLogger("unfoldiq.editorial_qa")

SCHEMA_VERSION = "1.0.0"
EDITOR_VERSION = "12.0.0"

# ---------------------------------------------------------------------------
# Sentence utilities
# ---------------------------------------------------------------------------

_SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+(?=[A-Z0-9\"“(\[])")
_STARTER_WORDS = ("But", "Yet", "Still", "And")
_NUMBER_RE = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b")
_PERCENT_RE = re.compile(r"\b\d+(?:\.\d+)?\s?%")
_DATE_DIGIT_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*Mya\b"
    r"|\b\d{3,}(?:,\d{3})*\s*(?:million years ago|thousand years ago|years ago)\b"
    r"|\b\d{1,2}(?:st|nd|rd|th)?\s+century\b"
    r"|\b1[5-9]\d{2}s?\b|\b20\d{2}s?\b",
    re.IGNORECASE,
)
_DATE_WORD_RE = re.compile(
    r"\b(?:about|around|roughly|approximately|nearly|almost|over)\s+"
    r"(?:[a-z]+\s+){0,4}?(?:thousand|million|hundred)(?:\s+[a-z]+){0,2}\s+years\s+ago\b",
    re.IGNORECASE,
)
_SPECIES_RE = re.compile(
    r"\b(Homo|Australopithecus|Paranthropus|Ardipithecus|Denisovan|Neanderthal)"
    r"(?:\s+[a-z]+)?\b"
)
_ABBREV_RE = re.compile(r"\b(e\.g\.|i\.e\.|etc\.|[A-Z]\s?\d+|\b[A-Z]{2,5}s?\b)")
_HEDGE_RE = re.compile(
    r"\b(may|might|could|perhaps|likely|probably|plausibly|plausible|uncertain|"
    r"suggests?|indicates?|consistent with|does not prove|cannot prove|"
    r"cannot point to|difficult to ignore)\b",
    re.IGNORECASE,
)
_EVIDENCE_RE = re.compile(
    r"\b(researchers?|studies|study|analysis|evidence|fossil?s?|specimens?|"
    r"excavat\w*|archaeolog\w*|genome|dating|isotope)\b",
    re.IGNORECASE,
)
_DRAMA_LEXICON = (
    "unimaginable", "unspeakable", "trembling", "gasped", "heart pounded",
    "shattered the silence", "pierced the", "blood-curdling", "petrified",
    "unthinkable", "jaw-dropping",
)
_CONCLUSION_STARTERS = (
    "the story of", "it is a story about", "that is why", "in the end",
    "ultimately,", "so the next time",
)
_THREE_PART_RE = re.compile(r",[^,;]{3,}?,[^,;]{3,}?\band\b|;[^;]+;[^;]+")


def split_sentences(text: str) -> List[Dict[str, Any]]:
    """Split script into sentences with char offsets and word counts."""
    out: List[Dict[str, Any]] = []
    start = 0
    # split keeping offsets
    parts = _SENT_SPLIT.split(text)
    cursor = 0
    for part in parts:
        s = part.strip()
        if not s:
            continue
        idx = text.find(part.strip()[:20] if len(part.strip()) > 20 else part.strip(), cursor)
        if idx < 0:
            idx = cursor
        end = idx + len(part.strip())
        words = re.findall(r"[A-Za-z0-9'’\-]+", s)
        first = re.match(r"[\"“(\[]*([A-Za-z]+)", s)
        out.append({
            "text": s,
            "startOffset": idx,
            "endOffset": end,
            "wordCount": len(words),
            "starter": first.group(1) if first else "",
            "question": s.rstrip().endswith("?"),
        })
        cursor = end
    _ = start
    return out


# ---------------------------------------------------------------------------
# Protected facts
# ---------------------------------------------------------------------------

PROTECTION_SCHEMA_VERSION = "1.0.0"


def auto_detect_protected_spans(script: str) -> List[Dict[str, Any]]:
    """Deterministically detect factual spans. Locked unless a caveat hedge."""
    spans: List[Dict[str, Any]] = []
    counter = [0]

    def _add(ptype: str, m: re.Match, source: str = "AUTO", locked: bool = True) -> None:
        counter[0] += 1
        spans.append({
            "id": f"FACT_{counter[0]:03d}",
            "type": ptype,
            "text": m.group(0),
            "startOffset": m.start(),
            "endOffset": m.end(),
            "source": source,
            "locked": locked,
        })

    for m in _PERCENT_RE.finditer(script):
        _add("NUMBER", m)
    for m in _NUMBER_RE.finditer(script):
        if not any(s["startOffset"] <= m.start() < s["endOffset"] for s in spans):
            _add("NUMBER", m)
    for m in _DATE_DIGIT_RE.finditer(script):
        _add("DATE", m)
    for m in _DATE_WORD_RE.finditer(script):
        _add("DATE", m)
    for m in _SPECIES_RE.finditer(script):
        _add("SPECIES", m)
    # Proper nouns via shared extractor (locations/persons/taxa)
    try:
        from studio.veo_prompt_generator import extract_proper_nouns, classify_proper_nouns
        nouns = extract_proper_nouns(script)
        classified = classify_proper_nouns(nouns)
        for noun in nouns:
            for m in re.finditer(re.escape(noun), script):
                kind = "PROPER_NOUN"
                low = noun.lower()
                if noun in classified.get("taxa", []):
                    kind = "SPECIES"
                elif noun in classified.get("locations", []):
                    kind = "PLACE"
                _add(kind, m)
                break  # first occurrence representative; overlaps merged below
    except Exception:
        pass
    for m in _EVIDENCE_RE.finditer(script):
        _add("EVIDENCE_ANCHOR", m)
    for m in _HEDGE_RE.finditer(script):
        _add("CAVEAT", m, locked=False)

    # Dedupe/merge overlaps: keep longest span, merge type info
    spans.sort(key=lambda s: (s["startOffset"], -(s["endOffset"] - s["startOffset"])))
    merged: List[Dict[str, Any]] = []
    for s in spans:
        if merged and s["startOffset"] < merged[-1]["endOffset"]:
            prev = merged[-1]
            if (s["endOffset"] - s["startOffset"]) > (prev["endOffset"] - prev["startOffset"]):
                merged[-1] = s
            prev_locked = prev.get("locked", True) or s.get("locked", True)
            merged[-1]["locked"] = prev_locked
            continue
        merged.append(s)
    # Re-id sequentially
    for i, s in enumerate(merged, 1):
        s["id"] = f"FACT_{i:03d}"
    return merged


def load_protection(project_dir: Path) -> Optional[Dict[str, Any]]:
    p = project_dir / "script_protection.json"
    if not p.is_file():
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def ensure_protection(project_dir: Path, script: str) -> Dict[str, Any]:
    """Build or refresh protection; preserves MANUAL locks across refreshes."""
    project_dir = Path(project_dir)
    existing = load_protection(project_dir)
    manual = []
    if existing:
        for s in existing.get("protectedSpans", []):
            if s.get("source") == "MANUAL":
                manual.append(s)
    auto = auto_detect_protected_spans(script)
    spans = auto + [
        {**m, "id": f"FACT_{len(auto) + i + 1:03d}"} for i, m in enumerate(manual)
    ]
    payload = {
        "schemaVersion": PROTECTION_SCHEMA_VERSION,
        "scriptHash": compute_file_sha256(project_dir / "script.txt")
        if (project_dir / "script.txt").is_file() else None,
        "protectedSpans": spans,
    }
    tmp = project_dir / "script_protection.tmp.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    tmp.replace(project_dir / "script_protection.json")
    return payload


def check_edit_safety(script: str, start: int, end: int, new_text: str,
                      spans: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """A suggestion is BLOCKED if it alters any locked factual span."""
    conflicts: List[str] = []
    original_slice = script[start:end]
    for s in spans:
        if not s.get("locked"):
            continue
        so, eo = int(s["startOffset"]), int(s["endOffset"])
        if eo <= start or so >= end:
            continue  # no overlap with edited range
        locked_text = script[so:eo]
        if locked_text not in new_text and locked_text not in original_slice.replace(
                script[max(start, so):min(end, eo)], "", 1):
            # locked text must survive verbatim in the replacement
            if locked_text not in new_text:
                conflicts.append(f"Protected {s['type']} '{s['text']}' would be altered.")
    # Global guard: every locked span text must still exist after full replace
    new_script = script[:start] + new_text + script[end:]
    for s in spans:
        if s.get("locked") and script[int(s["startOffset"]):int(s["endOffset"])] not in new_script:
            msg = f"Protected {s['type']} '{s['text']}' missing after edit."
            if msg not in conflicts:
                conflicts.append(msg)
    return (len(conflicts) == 0, conflicts)


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def _issue(iid: str, itype: str, severity: str, start: int, end: int,
           text: str, message: str, suggestion: Optional[str] = None) -> Dict[str, Any]:
    return {
        "issueId": iid, "type": itype, "severity": severity,
        "startOffset": start, "endOffset": end, "text": text,
        "message": message, "suggestion": suggestion, "status": "OPEN",
    }


def detect_issues(script: str) -> List[Dict[str, Any]]:
    sents = split_sentences(script)
    issues: List[Dict[str, Any]] = []
    n = [0]

    def _next(prefix: str) -> str:
        n[0] += 1
        return f"EDQ_{n[0]:03d}"

    # 1. Consecutive short sentences
    run: List[int] = []
    for i, s in enumerate(sents):
        if s["wordCount"] <= 8:
            run.append(i)
        else:
            if len(run) >= 3:
                a, b = sents[run[0]], sents[run[-1]]
                issues.append(_issue(_next("EDQ"), "SHORT_SENTENCE_RUN", "REVIEW",
                                     a["startOffset"], b["endOffset"],
                                     " ".join(sents[k]["text"] for k in run),
                                     f"{len(run)} consecutive short sentences — choppy rhythm.",
                                     " ".join(sents[k]["text"] for k in run)))
            run = []
    if len(run) >= 3:
        a, b = sents[run[0]], sents[run[-1]]
        issues.append(_issue(_next("EDQ"), "SHORT_SENTENCE_RUN", "REVIEW",
                             a["startOffset"], b["endOffset"],
                             " ".join(sents[k]["text"] for k in run),
                             f"{len(run)} consecutive short sentences — choppy rhythm.",
                             " ".join(sents[k]["text"] for k in run)))

    # 2. Dramatic fragments
    frags = [s for s in sents if s["wordCount"] <= 4 and not s["question"]]
    if len(frags) >= 3:
        issues.append(_issue(_next("EDQ"), "FRAGMENT_OVERUSE", "REVIEW",
                             frags[0]["startOffset"], frags[-1]["endOffset"],
                             " | ".join(s["text"] for s in frags[:5]),
                             f"{len(frags)} dramatic fragments — theatrical rhythm.",
                             None))

    # 3. Not X. Not Y. (+Z)
    for i in range(len(sents) - 1):
        a, b = sents[i]["text"], sents[i + 1]["text"]
        if re.match(r'^\s*Not\s+\S', a) and re.match(r'^\s*Not\s+\S', b):
            issues.append(_issue(_next("EDQ"), "NOT_X_NOT_Y", "REVIEW",
                                 sents[i]["startOffset"], sents[i + 1]["endOffset"],
                                 f"{a} {b}",
                                 'Repeated "Not X. Not Y." pattern.',
                                 f"{a} {b}"))
            break

    # 4. Not X, but Y
    count_but = 0
    first_but = None
    for s in sents:
        if re.search(r"\b[Nn]ot\b.{1,80}?\bbut\b", s["text"]):
            count_but += 1
            first_but = first_but or s
    if count_but >= 2 and first_but:
        issues.append(_issue(_next("EDQ"), "NOT_X_BUT_Y", "REVIEW",
                             first_but["startOffset"], first_but["endOffset"],
                             first_but["text"],
                             f'"Not X, but Y" construction used {count_but}×.',
                             None))

    # 5. Sentence-starter repetition (But/Yet/Still/And)
    for starter in _STARTER_WORDS:
        idxs = [i for i, s in enumerate(sents) if s["starter"] == starter]
        if len(idxs) >= 3:
            issues.append(_issue(_next("EDQ"), "REPEATED_TRANSITION_STARTER", "REVIEW",
                                 sents[idxs[0]]["startOffset"], sents[idxs[-1]]["endOffset"],
                                 " | ".join(sents[k]["text"] for k in idxs[:4]),
                                 f'Sentence starter "{starter}" used {len(idxs)}×.',
                                 None))
        else:
            for w in range(len(idxs) - 1):
                if idxs[w + 1] - idxs[w] <= 5 and len(idxs) >= 2:
                    issues.append(_issue(_next("EDQ"), "REPEATED_TRANSITION_STARTER", "INFO",
                                         sents[idxs[w]]["startOffset"], sents[idxs[w + 1]]["endOffset"],
                                         f"{sents[idxs[w]]['text']} | {sents[idxs[w + 1]]['text']}",
                                         f'Local "{starter}" repetition.',
                                         re.sub(rf'^\s*{starter}\b\s*', '',
                                                sents[idxs[w + 1]]["text"])))
                    break

    # 6. Rhetorical questions
    qs = [s for s in sents if s["question"]]
    if len(qs) >= 3:
        issues.append(_issue(_next("EDQ"), "RHETORICAL_QUESTION_OVERUSE", "REVIEW",
                             qs[0]["startOffset"], qs[-1]["endOffset"],
                             " | ".join(s["text"] for s in qs[:4]),
                             f"{len(qs)} rhetorical questions.",
                             None))

    # 7. Think about / Now imagine
    for phrase, itype in (("think about", "THINK_ABOUT_REPEAT"),
                          ("now imagine", "NOW_IMAGINE_REPEAT")):
        hits = [s for s in sents if phrase in s["text"].lower()]
        if len(hits) >= 2:
            issues.append(_issue(_next("EDQ"), itype, "REVIEW",
                                 hits[0]["startOffset"], hits[-1]["endOffset"],
                                 " | ".join(s["text"] for s in hits[:3]),
                                 f'"{phrase}" repeated {len(hits)}×.',
                                 None))

    # 8. Three-part contrast/list
    tpl = [s for s in sents if _THREE_PART_RE.search(s["text"])]
    if len(tpl) >= 3:
        issues.append(_issue(_next("EDQ"), "THREE_PART_PATTERN", "INFO",
                             tpl[0]["startOffset"], tpl[-1]["endOffset"],
                             " | ".join(s["text"][:80] for s in tpl[:3]),
                             f"{len(tpl)} three-part list/contrast sentences — template risk.",
                             None))

    # 9. Template conclusions
    concl = [s for s in sents if s["text"].lower().startswith(_CONCLUSION_STARTERS)]
    if concl:
        issues.append(_issue(_next("EDQ"), "TEMPLATE_CONCLUSION", "INFO",
                             concl[0]["startOffset"], concl[0]["endOffset"],
                             concl[0]["text"],
                             "Template-like conclusion sentence.",
                             None))

    # 10. Uniform cadence
    if len(sents) >= 8:
        lens = [s["wordCount"] for s in sents]
        mean = sum(lens) / len(lens)
        var = sum((x - mean) ** 2 for x in lens) / len(lens)
        cv = (var ** 0.5) / mean if mean else 1.0
        if cv < 0.35:
            issues.append(_issue(_next("EDQ"), "UNIFORM_CADENCE", "INFO",
                                 sents[0]["startOffset"], sents[-1]["endOffset"],
                                 f"mean {mean:.1f} words, CV {cv:.2f}",
                                 "Uniform sentence cadence — monotonous delivery.",
                                 None))

    # 11. Fake drama lexicon
    drama_hits = [s for s in sents
                  if any(t in s["text"].lower() for t in _DRAMA_LEXICON)]
    if len(drama_hits) >= 2:
        issues.append(_issue(_next("EDQ"), "THEATRICAL_LANGUAGE", "REVIEW",
                             drama_hits[0]["startOffset"], drama_hits[-1]["endOffset"],
                             " | ".join(s["text"] for s in drama_hits[:3]),
                             "Excessive theatrical language.",
                             None))

    # 12. Restatement (repeated 5-grams)
    seen: Dict[str, List[int]] = {}
    for i, s in enumerate(sents):
        words = [w.lower() for w in re.findall(r"[A-Za-z0-9'’\-]+", s["text"])]
        for j in range(len(words) - 4):
            gram = " ".join(words[j:j + 5])
            seen.setdefault(gram, []).append(i)
    restated = {g: v for g, v in seen.items() if len(set(v)) >= 2}
    if restated:
        g = sorted(restated, key=lambda k: -len(restated[k]))[0]
        idxs = sorted(set(restated[g]))
        issues.append(_issue(_next("EDQ"), "RESTATEMENT", "REVIEW",
                             sents[idxs[0]]["startOffset"], sents[idxs[-1]]["endOffset"],
                             f"…{g}… ({len(idxs)}×)",
                             "Unnecessary restatement of the same phrase.",
                             None))

    # 13. Overlong sentences (TTS)
    for s in sents:
        if s["wordCount"] > 28:
            # suggestion: split at a mid clause boundary (text-only, fact-safe pending check)
            parts = re.split(r",\s+(?:and|but|while|whereas)\s+|\s+—\s+|;\s+", s["text"], maxsplit=1)
            sugg = (parts[0].rstrip(" ,;") + ". " + parts[1][0].upper() + parts[1][1:]
                    if len(parts) == 2 and len(parts[0].split()) > 4 else None)
            issues.append(_issue(_next("EDQ"), "TTS_LONG_SENTENCE", "REVIEW",
                                 s["startOffset"], s["endOffset"], s["text"],
                                 f"Overlong sentence ({s['wordCount']} words) — hard for TTS.",
                                 sugg))

    # 14. Number-reading candidates (protected; manual review, no auto suggestion)
    num_hits = [s for s in sents if _NUMBER_RE.search(s["text"]) or _PERCENT_RE.search(s["text"])]
    if num_hits:
        issues.append(_issue(_next("EDQ"), "TTS_NUMBER_READING", "INFO",
                             num_hits[0]["startOffset"], num_hits[-1]["endOffset"],
                             f"{len(num_hits)} sentence(s) contain numbers.",
                             "Verify TTS number/date pronunciation. Numbers are protected facts.",
                             None))

    # 15. Punctuation abuse
    punct = [s for s in sents if re.search(r"[!?]{2,}|\.{3,}|—.*—", s["text"])]
    if len(punct) >= 2:
        issues.append(_issue(_next("EDQ"), "PUNCTUATION_ABUSE", "INFO",
                             punct[0]["startOffset"], punct[-1]["endOffset"],
                             " | ".join(s["text"][:60] for s in punct[:3]),
                             "Punctuation abuse — noisy TTS prosody.",
                             None))

    # 16. Awkward abbreviations
    abbr = [s for s in sents if _ABBREV_RE.search(s["text"])]
    if abbr:
        issues.append(_issue(_next("EDQ"), "AWKWARD_ABBREVIATION", "INFO",
                             abbr[0]["startOffset"], abbr[-1]["endOffset"],
                             " | ".join(s["text"][:60] for s in abbr[:3]),
                             "Abbreviations read poorly in TTS — expand manually.",
                             None))

    # 17. Difficult proper nouns (protected; manual review)
    try:
        from studio.veo_prompt_generator import extract_proper_nouns
        nouns = [nn for nn in extract_proper_nouns(script)
                 if len(nn) >= 12 or re.search(r"[^\x00-\x7F]", nn)]
        if nouns:
            issues.append(_issue(_next("EDQ"), "DIFFICULT_PROPER_NOUN", "INFO",
                                 0, min(len(script), 200),
                                 ", ".join(nouns[:6]),
                                 "Potentially difficult proper nouns — verify pronunciation.",
                                 None))
    except Exception:
        pass

    # Re-id sequentially for stability
    for i, iss in enumerate(issues, 1):
        iss["issueId"] = f"EDQ_{i:03d}"
    return issues


def compute_score(issues: List[Dict[str, Any]]) -> Tuple[int, str]:
    open_iss = [i for i in issues if i.get("status") == "OPEN"]
    score = 100
    for i in open_iss:
        if i.get("severity") == "BLOCK":
            score -= 8
        elif i.get("severity") == "REVIEW":
            score -= 3
        else:
            score -= 1
    score = max(0, min(100, score))
    if any(i.get("severity") == "BLOCK" for i in open_iss):
        status = "ERROR"
    elif any(i.get("severity") == "REVIEW" for i in open_iss):
        status = "REVIEW"
    else:
        status = "READY"
    return score, status


# ---------------------------------------------------------------------------
# Persistence + workflow
# ---------------------------------------------------------------------------

def _qa_path(project_dir: Path) -> Path:
    return Path(project_dir) / "editorial_qa.json"


def load_qa(project_dir: Path) -> Optional[Dict[str, Any]]:
    p = _qa_path(project_dir)
    if not p.is_file():
        return None
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_qa(project_dir: Path, payload: Dict[str, Any]) -> None:
    tmp = Path(project_dir) / "editorial_qa.tmp.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    tmp.replace(_qa_path(project_dir))


def analyze_project(project_dir: Path) -> Dict[str, Any]:
    """Run detection over canonical script.txt and persist editorial_qa.json."""
    project_dir = Path(project_dir)
    script_path = project_dir / "script.txt"
    if not script_path.is_file():
        raise FileNotFoundError("Missing script.txt.")
    script = script_path.read_text(encoding="utf-8")
    protection = ensure_protection(project_dir, script)
    issues = detect_issues(script)
    # Preserve prior APPLIED/IGNORED decisions by stable text match
    prev = load_qa(project_dir) or {}
    prev_by_text = {(i.get("type"), i.get("text")): i.get("status")
                    for i in prev.get("issues", [])}
    for iss in issues:
        st = prev_by_text.get((iss["type"], iss["text"]))
        if st in ("APPLIED", "IGNORED"):
            iss["status"] = st
    score, status = compute_score(issues)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "editorVersion": EDITOR_VERSION,
        "scriptHash": compute_file_sha256(script_path),
        "status": status,
        "score": score,
        "issueCount": len(issues),
        "openCount": sum(1 for i in issues if i["status"] == "OPEN"),
        "protectedSpanCount": len(protection.get("protectedSpans", [])),
        "issues": issues,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    _save_qa(project_dir, payload)
    return payload


def check_stale(project_dir: Path) -> bool:
    qa = load_qa(project_dir)
    if not qa:
        return False
    script_path = Path(project_dir) / "script.txt"
    if not script_path.is_file():
        return True
    return qa.get("scriptHash") != compute_file_sha256(script_path)


def apply_suggestion(project_dir: Path, issue_id: str) -> Dict[str, Any]:
    """Transactionally apply one suggestion; BLOCK if a locked fact would change."""
    project_dir = Path(project_dir)
    qa = load_qa(project_dir)
    if not qa:
        raise FileNotFoundError("No editorial QA report. Run analysis first.")
    script_path = project_dir / "script.txt"
    script = script_path.read_text(encoding="utf-8")
    if qa.get("scriptHash") != compute_file_sha256(script_path):
        raise ValueError("Script changed since analysis. Re-run Editorial QA analysis first.")
    iss = next((i for i in qa["issues"] if i["issueId"] == issue_id), None)
    if not iss:
        raise KeyError(f"Issue {issue_id} not found.")
    if iss["status"] == "APPLIED":
        return {"applied": True, "already": True, "issue": iss}
    if not iss.get("suggestion"):
        raise ValueError(f"Issue {issue_id} has no automatic suggestion (manual review required).")
    protection = ensure_protection(project_dir, script)
    safe, conflicts = check_edit_safety(script, int(iss["startOffset"]), int(iss["endOffset"]),
                                        iss["suggestion"], protection["protectedSpans"])
    if not safe:
        iss["severity"] = "BLOCK"
        iss["blockReason"] = "; ".join(conflicts)
        score, status = compute_score(qa["issues"])
        qa.update({"score": score, "status": status,
                   "openCount": sum(1 for i in qa["issues"] if i["status"] == "OPEN")})
        _save_qa(project_dir, qa)
        raise ValueError(f"BLOCKED: {'; '.join(conflicts)}")
    new_script = script[:int(iss["startOffset"])] + iss["suggestion"] + script[int(iss["endOffset"]):]
    # Transactional commit: tmp + replace; verify locked spans survive
    tmp = project_dir / "script.txt.edq.tmp"
    tmp.write_text(new_script, encoding="utf-8")
    for s in protection["protectedSpans"]:
        if s.get("locked") and script[int(s["startOffset"]):int(s["endOffset"])] not in new_script:
            tmp.unlink(missing_ok=True)
            raise ValueError(f"BLOCKED: protected {s['type']} '{s['text']}' would be lost.")
    tmp.replace(script_path)
    iss["status"] = "APPLIED"
    iss["appliedAt"] = datetime.now(timezone.utc).isoformat()
    iss["before"] = script[int(iss["startOffset"]):int(iss["endOffset"])]
    iss["after"] = iss["suggestion"]
    # Refresh hashes + protection after mutation
    protection = ensure_protection(project_dir, new_script)
    qa["scriptHash"] = compute_file_sha256(script_path)
    qa["protectedSpanCount"] = len(protection["protectedSpans"])
    # Re-detect remaining issues against the new script (keeps offsets truthful)
    fresh = detect_issues(new_script)
    prev_status = {(i["type"], i["text"]): i["status"] for i in qa["issues"]}
    for f in fresh:
        st = prev_status.get((f["type"], f["text"]))
        if st in ("APPLIED", "IGNORED"):
            f["status"] = st
    qa["issues"] = fresh
    score, status = compute_score(fresh)
    qa.update({"score": score, "status": status,
               "issueCount": len(fresh),
               "openCount": sum(1 for i in fresh if i["status"] == "OPEN"),
               "updatedAt": datetime.now(timezone.utc).isoformat()})
    _save_qa(project_dir, qa)
    logger.info(f"Applied editorial suggestion {issue_id} in {project_dir.name}")
    return {"applied": True, "issueId": issue_id, "score": score, "status": status}


def ignore_issue(project_dir: Path, issue_id: str) -> Dict[str, Any]:
    project_dir = Path(project_dir)
    qa = load_qa(project_dir)
    if not qa:
        raise FileNotFoundError("No editorial QA report.")
    iss = next((i for i in qa["issues"] if i["issueId"] == issue_id), None)
    if not iss:
        raise KeyError(f"Issue {issue_id} not found.")
    iss["status"] = "IGNORED"
    iss["ignoredAt"] = datetime.now(timezone.utc).isoformat()
    score, status = compute_score(qa["issues"])
    qa.update({"score": score, "status": status,
               "openCount": sum(1 for i in qa["issues"] if i["status"] == "OPEN"),
               "updatedAt": datetime.now(timezone.utc).isoformat()})
    _save_qa(project_dir, qa)
    return {"ignored": True, "issueId": issue_id, "score": score, "status": status}


def lock_span(project_dir: Path, span_type: str, start: int, end: int,
              source: str = "MANUAL") -> Dict[str, Any]:
    project_dir = Path(project_dir)
    script = (project_dir / "script.txt").read_text(encoding="utf-8")
    if not (0 <= start < end <= len(script)):
        raise ValueError("Invalid span offsets.")
    protection = ensure_protection(project_dir, script)
    spans = protection["protectedSpans"]
    spans.append({
        "id": f"FACT_{len(spans) + 1:03d}",
        "type": span_type,
        "text": script[start:end],
        "startOffset": start,
        "endOffset": end,
        "source": source,
        "locked": True,
    })
    payload = {
        "schemaVersion": PROTECTION_SCHEMA_VERSION,
        "scriptHash": compute_file_sha256(project_dir / "script.txt"),
        "protectedSpans": spans,
    }
    tmp = project_dir / "script_protection.tmp.json"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    tmp.replace(project_dir / "script_protection.json")
    return payload


def resolve_project_dir(project_id: str) -> Path:
    clean = (project_id or "").strip()
    if not clean or ".." in clean or "/" in clean or "\\" in clean:
        raise ValueError(f"Invalid project id: {project_id!r}")
    target = (PROJECTS_DIR / clean).resolve()
    if target.parent != PROJECTS_DIR.resolve() or not target.is_dir():
        raise ValueError(f"Project directory not found: {clean}")
    return target
