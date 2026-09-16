"""
Phase 9 — Hidden Narration Director / Prosody Planner.

Local-first, deterministic, stdlib-only narrative direction for documentary
narration. Produces project-scoped `narration_plan.json` (metadata only —
`script.txt` is never rewritten) consumed by the Narration Compiler, then
Pronunciation preprocessing, then Kokoro Smart Render.

Three-layer model: Narrative Role -> Narration Style -> Prosody.
Default profile DOCUMENTARY_CINEMATIC: neutral/authoritative baseline,
moderate range, rare strong styles, intentional pauses, no theatrical acting.
"""

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from studio.smart_render import atomic_write_json, read_json

ANALYZER_VERSION = "1.0"
NARRATION_SCHEMA_VERSION = 1
COMPILER_VERSION = "1.0"
DEFAULT_PROFILE = "DOCUMENTARY_CINEMATIC"
KNOWN_PROFILES = (DEFAULT_PROFILE,)
NARRATION_MODES = ("auto", "custom", "off")

NARRATIVE_ROLES = (
    "SETUP", "EXPLANATION", "QUESTION", "THREAT", "DISCOVERY", "EVIDENCE",
    "REVEAL", "CONSEQUENCE", "REFLECTION", "CONCLUSION", "TRANSITION",
    "ACTION", "COMPARISON",
)

NARRATION_STYLES = (
    "NEUTRAL", "AUTHORITATIVE", "CURIOUS", "MYSTERIOUS", "OMINOUS", "TENSE",
    "URGENT", "SOMBER", "REFLECTIVE", "AWE", "EXCITED", "REVEAL",
)

ROLE_STYLE_GUIDANCE: Dict[str, Tuple[str, ...]] = {
    "SETUP": ("NEUTRAL", "AUTHORITATIVE"),
    "EXPLANATION": ("NEUTRAL", "AUTHORITATIVE"),
    "QUESTION": ("CURIOUS", "MYSTERIOUS"),
    "THREAT": ("TENSE", "OMINOUS"),
    "DISCOVERY": ("CURIOUS", "AWE", "REVEAL"),
    "EVIDENCE": ("AUTHORITATIVE", "CURIOUS"),
    "REVEAL": ("REVEAL", "OMINOUS", "AWE"),
    "CONSEQUENCE": ("SOMBER", "REFLECTIVE", "AUTHORITATIVE"),
    "REFLECTION": ("REFLECTIVE",),
    "CONCLUSION": ("AUTHORITATIVE", "REFLECTIVE"),
    "TRANSITION": ("NEUTRAL",),
    "ACTION": ("TENSE", "URGENT", "NEUTRAL"),
    "COMPARISON": ("NEUTRAL", "AUTHORITATIVE"),
}

STRONG_STYLES = ("OMINOUS", "URGENT", "SOMBER", "AWE", "EXCITED", "REVEAL")

STYLE_BASE_RATE: Dict[str, float] = {
    "NEUTRAL": 1.0, "AUTHORITATIVE": 1.0, "CURIOUS": 0.96,
    "MYSTERIOUS": 0.92, "OMINOUS": 0.90, "TENSE": 0.97,
    "URGENT": 1.06, "SOMBER": 0.92, "REFLECTIVE": 0.93,
    "AWE": 0.94, "EXCITED": 1.05, "REVEAL": 0.90,
}

# Hard safety bounds (Voice QA pause/WPM compatibility).
RATE_MIN, RATE_MAX = 0.85, 1.15
PAUSE_BEFORE_MAX = 0.5
PAUSE_AFTER_MAX = 1.2
INTENSITY_AUTO_CAP = 0.8

# --- Rule lexicons (guidance signals, not absolute mapping) -----------------

# Strong threat markers always count. Contextual ones (hunt/hunter/prey)
# count only beside another danger signal, otherwise benign mentions such as
# "researchers believed early humans were efficient hunters" would misfire.
_STRONG_THREAT = ("predator", "kill", "killed", "danger", "threat", "attack",
                  "flee", "extinct", "extinction", "death", "deadly",
                  "risk", "stalk", "ambush", "fear", "terror", "survive",
                  "survival", "carnivore")
_CONTEXT_THREAT = ("hunt", "hunter", "hunters", "hunting", "prey")
_THREAT = _STRONG_THREAT + _CONTEXT_THREAT
_EVIDENCE = ("fossil", "evidence", "remains", "bones", "study", "research",
             "shows", "marks", "record", "specimen", "discovery", "data")
_DISCOVERY = ("discover", "found", "reveals", "another story", "different story",
              "unexpected", "surprising", " mystery", "unknown")
_REVEAL = ("but ", "however", "instead", "not always", "another story",
           "different story", "turns out", "in fact")
_CONCLUSION = ("therefore", "ultimately", "in the end", "in conclusion",
               "as a result", "legacy", "shaped")
_TRANSITION = ("meanwhile", "later", "across", "thousands of years",
               "over time", "next", "then ")
_ACTION = ("run", "ran", "chase", "escape", "strike", "move", "walk",
           "migrate", "travel", "cross", "climb", "dig", "knap", "shape")
_COMPARISON = (" than ", "unlike", "while ", "compared", "both ", "whereas",
               "in contrast", "smaller", "larger")
_REFLECTION = ("wonder", "meaning", "think", "imagine", "perhaps", "maybe",
               "reflect", "contemplat", "legacy")
_SOMBER = ("death", "loss", "extinct", "disappear", "vanish", "grave")
_AWE = ("vast", "immense", "extraordinary", "remarkable", "astonish",
        "breathtaking", "monumental")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\r\n", "\n")).strip()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def script_content_hash(synthesis_text: str) -> str:
    """Canonical hash of synthesis text for plan reuse gates."""
    return sha256_text(_norm(synthesis_text))


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def split_sentences(text: str) -> List[str]:
    """Split paragraph text into sentences, keeping delimiters. Deterministic."""
    parts = re.split(r"(?<=[.!?…])\s+|(?<=[.!?…][\"'”’])\s+", text.strip())
    return [p for p in parts if p.strip()]


def split_paragraphs(script: str) -> List[str]:
    unified = (script or "").replace("\r\n", "\n").replace("\r", "\n")
    return [p.strip() for p in re.split(r"\n{2,}", unified) if p.strip()]


def _contains_any(hay: str, words: Tuple[str, ...]) -> List[str]:
    low = hay.lower()
    return [w for w in words if w.lower() in low]


# ----------------------------------------------------------------------------
# Beat segmentation (semantic grouping; beats never cross paragraphs)
# ----------------------------------------------------------------------------

@dataclass
class _Sentence:
    sid: str
    index: int  # 1-based global
    para: int
    text: str
    words: int


def segment_script(script: str) -> List[_Sentence]:
    out: List[_Sentence] = []
    idx = 0
    for pi, para in enumerate(split_paragraphs(script)):
        for s in split_sentences(para):
            idx += 1
            out.append(_Sentence(sid=f"sentence_{idx:03d}", index=idx,
                                para=pi, text=s, words=len(s.split())))
    return out


# ----------------------------------------------------------------------------
# Context-aware role classification (Layer 1)
# ----------------------------------------------------------------------------

def classify_role(sent: _Sentence, prev: Optional[_Sentence],
                  nxt: Optional[_Sentence], para_len: int,
                  para_pos: int,
                  prev_role: Optional[str] = None) -> Tuple[str, float, str, List[str]]:
    """Return (role, confidence, reason, evidence_spans)."""
    t = sent.text
    low = t.lower()
    prev_t = (prev.text.lower() if prev else "")
    ev: List[str] = []

    if t.rstrip().endswith("?"):
        return ("QUESTION", 0.70, "Sentence asks an open question.",
                [t.strip()[:60]])
    strong = _contains_any(low, _STRONG_THREAT)
    ctx = [w for w in _contains_any(low, _CONTEXT_THREAT)]
    if ctx and not strong:
        # benign hunting mentions need a danger companion to count as threat
        if not (_contains_any(low, _REVEAL) or _contains_any(low, _SOMBER)):
            ctx = []
    hits = strong + ctx
    if hits:
        conf = min(0.55 + 0.08 * len(hits), 0.85)
        return ("THREAT", round(conf, 2),
                f"Danger/predator language ({', '.join(hits[:3])}).",
                hits[:3])
    # continuation of a reveal/threat arc: short or prey-framed sentences
    # inherit the arc instead of collapsing to flat explanation
    if prev_role in ("REVEAL", "THREAT"):
        prey = [w for w in _contains_any(low, _CONTEXT_THREAT)]
        if prey or sent.words <= 10:
            ev = (["Sometimes"] if low.startswith("sometimes") else []) + prey[:2]
            return ("REVEAL", 0.62,
                    "Continues the prior reveal/threat beat.",
                    ev or [t.strip()[:60]])
    hits = _contains_any(low, _REVEAL)
    if hits and (prev_t or para_pos > 0):
        return ("REVEAL", 0.78,
                "Contrast marker reverses the prior assumption.",
                hits[:2] + ([prev.text.strip()[:60]] if prev else []))
    if hits:
        return ("DISCOVERY", 0.64,
                "New or contrasting information introduced.",
                hits[:2])
    hits = _contains_any(low, _EVIDENCE)
    if hits and len(hits) >= 1 and ("fossil" in low or "evidence" in low
                                    or "remains" in low or "record" in low):
        return ("EVIDENCE", 0.72, "Factual/scientific support cited.", hits[:2])
    somber = _contains_any(low, _SOMBER)
    if somber:
        return ("CONSEQUENCE", 0.62, "Loss/extinction consequence.", somber[:2])
    if para_pos == para_len - 1 and _contains_any(low, _CONCLUSION):
        return ("CONCLUSION", 0.74, "Wrap-up marker at paragraph end.",
                _contains_any(low, _CONCLUSION)[:2])
    if sent.words <= 12 and _contains_any(low, _TRANSITION):
        return ("TRANSITION", 0.66, "Short bridging segment.", _contains_any(low, _TRANSITION)[:2])
    if _contains_any(low, _COMPARISON):
        return ("COMPARISON", 0.60, "Explicit contrast.", _contains_any(low, _COMPARISON)[:2])
    if _contains_any(low, _REFLECTION):
        return ("REFLECTION", 0.60, "Interpretive language.", _contains_any(low, _REFLECTION)[:2])
    if _contains_any(low, _DISCOVERY):
        return ("DISCOVERY", 0.62, "New finding introduced.", _contains_any(low, _DISCOVERY)[:2])
    if _contains_any(low, _EVIDENCE):
        return ("EVIDENCE", 0.60, "Supporting detail.", _contains_any(low, _EVIDENCE)[:2])
    act = _contains_any(low, _ACTION)
    if len(act) >= 2:
        return ("ACTION", min(0.55 + 0.07 * len(act), 0.78),
                f"Physical event language ({', '.join(act[:3])}).", act[:3])
    if para_pos == 0:
        return ("SETUP", 0.62, "Opens a paragraph with context.", [t.strip()[:60]])
    return ("EXPLANATION", 0.58, "Factual narration without strong markers.",
            [t.strip()[:60]])


# ----------------------------------------------------------------------------
# Style + prosody proposal (Layers 2-3)
# ----------------------------------------------------------------------------

def propose_style(role: str, sent: _Sentence, nxt: Optional[_Sentence]) -> Tuple[str, float, float]:
    """Return (style, intensity, confidence_delta)."""
    options = ROLE_STYLE_GUIDANCE.get(role, ("NEUTRAL",))
    low = sent.text.lower()
    style = options[0]
    conf_d = 0.0
    # threat near reveal -> ominous; threat + action verbs -> tense
    if role == "THREAT":
        style = "OMINOUS" if _contains_any(low, _REVEAL) or (nxt and "?" in nxt.text) else "TENSE"
    elif role == "REVEAL":
        style = "REVEAL" if sent.words >= 6 else "CURIOUS"
        conf_d = 0.05
    elif role == "DISCOVERY":
        style = "AWE" if _contains_any(low, _AWE) else ("REVEAL" if _contains_any(low, _REVEAL) else "CURIOUS")
    elif role == "QUESTION":
        style = "MYSTERIOUS" if _contains_any(low, ("still", "yet", "unanswered", "mystery")) else "CURIOUS"
    elif role == "ACTION":
        style = "URGENT" if sent.text.rstrip().endswith("!") and sent.words <= 14 else "TENSE"
    elif role == "CONSEQUENCE":
        style = "SOMBER" if _contains_any(low, _SOMBER) else "REFLECTIVE"
    elif role == "EVIDENCE":
        style = "AUTHORITATIVE"
    intensity = 0.30
    strong_hits = len(_contains_any(low, _THREAT + _SOMBER + _AWE))
    if style in STRONG_STYLES:
        intensity = 0.45 + 0.08 * strong_hits
    if role in ("EXPLANATION", "SETUP", "TRANSITION", "COMPARISON"):
        intensity = 0.22 + 0.02 * min(sent.words // 10, 3)
    intensity = max(0.15, min(INTENSITY_AUTO_CAP, round(intensity, 2)))
    return style, intensity, conf_d


def propose_prosody(style: str, intensity: float, sent: _Sentence,
                    beat_first: bool, beat_last: bool,
                    para_first: bool, para_last: bool) -> Tuple[float, float, float]:
    rate = STYLE_BASE_RATE.get(style, 1.0)
    if sent.words > 28:
        rate += 0.02
    elif sent.words < 8:
        rate -= 0.02
    rate = max(RATE_MIN, min(RATE_MAX, round(rate, 3)))
    pause_before = 0.35 if para_first else (0.25 if beat_first else 0.10)
    if style in ("REVEAL", "OMINOUS") and intensity >= 0.5:
        pause_before = min(PAUSE_BEFORE_MAX, pause_before + 0.10)
    pause_after = 0.25
    if style == "REVEAL" and intensity >= 0.5:
        pause_after = 0.90
    elif style in STRONG_STYLES and intensity >= 0.45:
        pause_after = 0.50
    elif para_last:
        pause_after = 0.60
    pause_after = min(PAUSE_AFTER_MAX, pause_after)
    return rate, round(pause_before, 2), round(pause_after, 2)


def extract_emphasis(sent: _Sentence) -> List[str]:
    """Key phrases from source text only (never invented). Max 3."""
    out: List[str] = []
    text = sent.text
    # contrast phrases: "not X", "very X"
    for m in re.finditer(r"\b(not|never|no|very|most|first|only)\s+([A-Za-z][\w\-']*(?:\s+[A-Za-z][\w\-']*){0,2})", text):
        out.append(m.group(0).strip(" ,.;:"))
    # capitalized multi-word runs (proper nouns), excluding sentence start word
    words = text.split()
    run: List[str] = []
    for i, w in enumerate(words):
        clean = w.strip("\"'“”(),.;:!?")
        if clean and clean[0].isupper() and (i > 0 or len(words) == 1):
            run.append(clean)
        else:
            if len(run) >= 2:
                out.append(" ".join(run))
            elif len(run) == 1 and len(run[0]) > 6:
                out.append(run[0])
            run = []
    if len(run) >= 2:
        out.append(" ".join(run))
    # word before ?/!
    m = re.search(r"(\b[\w\-']+)\s*[?!]\s*$", text)
    if m and m.group(1).lower() not in ("what", "why", "how", "when"):
        out.append(m.group(1))
    # dedupe, keep order, max 3, each must exist in source
    seen, final = set(), []
    for e in out:
        key = e.lower()
        if key not in seen and key and key in text.lower():
            seen.add(key)
            final.append(e)
        if len(final) >= 3:
            break
    return final


# ----------------------------------------------------------------------------
# Analyzer: beats + plan
# ----------------------------------------------------------------------------

def _beat_fingerprint(text: str, order: int, script_hash: str) -> str:
    return sha256_text("|".join([_norm(text).lower(), str(order), script_hash]))


def analyze_script(script: str, profile: str = DEFAULT_PROFILE,
                   mode: str = "auto") -> Dict[str, Any]:
    """Deterministic rule-based analysis → canonical plan (unvalidated)."""
    if profile not in KNOWN_PROFILES:
        profile = DEFAULT_PROFILE
    if mode not in NARRATION_MODES:
        mode = "auto"
    sentences = segment_script(script)
    script_hash = script_content_hash(script)
    beats: List[Dict[str, Any]] = []
    # group consecutive same-role sentences (≤3 sents, ≤60 words, same paragraph)
    groups: List[List[_Sentence]] = []
    for s in sentences:
        if groups and groups[-1] and groups[-1][-1].para == s.para:
            groups[-1].append(s)
        else:
            groups.append([s])
    # split groups by role runs
    refined: List[List[_Sentence]] = []
    sent_roles: Dict[int, str] = {}
    for g in groups:
        cur: List[_Sentence] = []
        cur_role = None
        for s in g:
            prev = sentences[s.index - 2] if s.index >= 2 else None
            nxt = sentences[s.index] if s.index < len(sentences) else None
            prev_role = sent_roles.get(s.index - 1)
            role, _, _, _ = classify_role(s, prev, nxt, len(g),
                                          g.index(s), prev_role)
            sent_roles[s.index] = role
            if cur and (role != cur_role or len(cur) >= 3
                        or sum(x.words for x in cur) + s.words > 60):
                refined.append(cur)
                cur = []
            cur.append(s)
            cur_role = role
        if cur:
            refined.append(cur)

    order = 0
    for gi, grp in enumerate(refined):
        order += 1
        first, last = grp[0], grp[-1]
        prev = sentences[first.index - 2] if first.index >= 2 else None
        nxt = sentences[last.index] if last.index < len(sentences) else None
        role, conf, reason, ev = classify_role(
            first, prev, nxt, len([s for s in sentences if s.para == first.para]),
            sum(1 for s in sentences[:first.index] if s.para == first.para),
            sent_roles.get(first.index - 1))
        style, intensity, conf_d = propose_style(role, first, nxt)
        conf = max(0.0, min(1.0, round(conf + conf_d, 2)))
        # low confidence -> conservative fallback
        if conf < 0.5 and style in STRONG_STYLES:
            style, intensity = "AUTHORITATIVE", 0.35
        text = " ".join(s.text for s in grp)
        rate, pb, pa = propose_prosody(
            style, intensity, first,
            beat_first=True, beat_last=True,
            para_first=(first.index == 1 or (prev is not None and prev.para != first.para)),
            para_last=(nxt is None or (nxt is not None and nxt.para != last.para)))
        emphasis: List[str] = []
        for s in grp:
            for e in extract_emphasis(s):
                if e.lower() not in [x.lower() for x in emphasis]:
                    emphasis.append(e)
                if len(emphasis) >= 3:
                    break
        evidence = ev + [s.text.strip()[:80] for s in grp[:1] if style in STRONG_STYLES]
        beats.append({
            "beatId": f"beat_{order:03d}",
            "sentenceIds": [s.sid for s in grp],
            "text": text,
            "role": role,
            "style": style,
            "intensity": intensity,
            "confidence": conf,
            "rate": rate,
            "pauseBefore": pb,
            "pauseAfter": pa,
            "emphasis": emphasis[:3],
            "delivery": {
                "energy": "high" if intensity >= 0.6 else ("medium" if intensity >= 0.35 else "low"),
                "weight": "strong" if style in ("AUTHORITATIVE", "REVEAL", "OMINOUS") else "natural",
                "pace": "slow" if rate < 0.96 else ("fast" if rate > 1.02 else "steady"),
            },
            "reason": reason,
            "evidence": evidence[:4],
            "manualEdited": False,
            "accepted": False,
            "fingerprint": _beat_fingerprint(text, order, script_hash),
        })

    return {
        "schemaVersion": NARRATION_SCHEMA_VERSION,
        "analyzerVersion": ANALYZER_VERSION,
        "profile": profile,
        "mode": mode,
        "sourceScriptHash": script_hash,
        "status": "READY",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
        "beats": beats,
    }


# ----------------------------------------------------------------------------
# Validator (beat-level + global)
# ----------------------------------------------------------------------------

def validate_beat(beat: Dict[str, Any], script_norm: str) -> List[str]:
    issues: List[str] = []
    if beat.get("role") not in NARRATIVE_ROLES:
        issues.append(f"invalid role {beat.get('role')}")
    if beat.get("style") not in NARRATION_STYLES:
        issues.append(f"invalid style {beat.get('style')}")
    for k in ("intensity", "confidence"):
        v = beat.get(k)
        if not isinstance(v, (int, float)) or not (0.0 <= v <= 1.0):
            issues.append(f"{k} out of bounds: {v}")
    r = beat.get("rate")
    if not isinstance(r, (int, float)) or not (RATE_MIN - 0.001 <= r <= RATE_MAX + 0.001):
        issues.append(f"rate out of bounds: {r}")
    for k in ("pauseBefore", "pauseAfter"):
        v = beat.get(k)
        if not isinstance(v, (int, float)) or v < 0 or v > 2.0:
            issues.append(f"{k} invalid: {v}")
    for e in beat.get("emphasis", []):
        if not e or e.lower() not in script_norm.lower():
            issues.append(f"emphasis not in source: {e!r}")
    if not beat.get("reason"):
        issues.append("missing reason")
    if beat.get("style") in STRONG_STYLES and not beat.get("evidence"):
        issues.append("strong style without evidence")
    bt = _norm(beat.get("text", ""))
    if not bt or bt.lower() not in script_norm.lower():
        issues.append("beat text not found in script (possible rewrite)")
    if not beat.get("sentenceIds"):
        issues.append("missing sentenceIds")
    return issues


def validate_plan(plan: Dict[str, Any], script: str) -> Dict[str, Any]:
    """Beat + global validation → {status: READY|REVIEW|ERROR, issues, stats}."""
    script_norm = _norm(script).lower()
    issues: List[str] = []
    beats = plan.get("beats", []) if isinstance(plan, dict) else []
    if not beats:
        return {"status": "ERROR", "issues": ["empty beat list"],
                "stats": beat_stats(plan, script)}
    for b in beats:
        for i in validate_beat(b, script_norm):
            issues.append(f"{b.get('beatId')}: {i}")
    # global overacting / continuity checks
    n = len(beats)
    strong = sum(1 for b in beats if b.get("style") in STRONG_STYLES)
    if strong / max(n, 1) > 0.35:
        issues.append(f"GLOBAL: too many strong beats ({strong}/{n})")
    switches = sum(1 for i in range(1, n)
                   if beats[i].get("style") != beats[i - 1].get("style")
                   and (beats[i].get("style") in STRONG_STYLES
                        or beats[i - 1].get("style") in STRONG_STYLES))
    if n > 3 and switches / (n - 1) > 0.5:
        issues.append(f"GLOBAL: excessive strong-style switching ({switches}/{n - 1})")
    avg_i = sum(float(b.get("intensity", 0)) for b in beats) / max(n, 1)
    if avg_i > 0.6:
        issues.append(f"GLOBAL: high average intensity ({avg_i:.2f})")
    avg_pa = sum(float(b.get("pauseAfter", 0)) for b in beats) / max(n, 1)
    if avg_pa > 0.7:
        issues.append(f"GLOBAL: pause density too high (avg pauseAfter {avg_pa:.2f}s)")
    osc = sum(1 for i in range(1, n)
              if abs(float(beats[i].get("rate", 1)) - float(beats[i - 1].get("rate", 1))) > 0.12)
    if n > 3 and osc / (n - 1) > 0.4:
        issues.append(f"GLOBAL: rate oscillation ({osc}/{n - 1})")
    reveals = sum(1 for b in beats if b.get("style") == "REVEAL")
    if n >= 5 and reveals / n > 0.4:
        issues.append(f"GLOBAL: excessive REVEAL usage ({reveals}/{n})")
    tiny = sum(1 for b in beats if len(b.get("text", "").split()) < 4)
    if tiny:
        issues.append(f"GLOBAL: {tiny} very short beat(s) (fragmentation)")
    status = "ERROR" if any("not found in script" in i or "empty beat" in i for i in issues) \
        else ("REVIEW" if issues else "READY")
    return {"status": status, "issues": issues, "stats": beat_stats(plan, script)}


def beat_stats(plan: Dict[str, Any], script: str) -> Dict[str, Any]:
    beats = plan.get("beats", []) if isinstance(plan, dict) else []
    words = [_norm(b.get("text", "")).split() for b in beats]
    total_w = sum(len(w) for w in words)
    from collections import Counter
    return {
        "beat_count": len(beats),
        "avg_words_per_beat": round(total_w / max(len(beats), 1), 1),
        "very_short_beats": sum(1 for w in words if len(w) < 4),
        "auto_approved": sum(1 for b in beats if not b.get("manualEdited")),
        "manual_edited": sum(1 for b in beats if b.get("manualEdited")),
        "needs_review": 0,
        "style_dist": dict(Counter(b.get("style") for b in beats)),
        "role_dist": dict(Counter(b.get("role") for b in beats)),
        "avg_intensity": round(sum(float(b.get("intensity", 0)) for b in beats) / max(len(beats), 1), 3),
        "strong_count": sum(1 for b in beats if b.get("style") in STRONG_STYLES),
    }


# ----------------------------------------------------------------------------
# Persistence + lifecycle
# ----------------------------------------------------------------------------

PLAN_FILENAME = "narration_plan.json"


def plan_path(project_dir: Path) -> Path:
    return Path(project_dir) / PLAN_FILENAME


def save_plan(project_dir: Path, plan: Dict[str, Any]) -> Path:
    # P1 (§4): lineage — stamp script_version khi lưu (không phá hash hiện có).
    try:
        sv = json.loads((Path(project_dir) / "script.json").read_text(encoding="utf-8")).get("version", 1)
        plan["script_version"] = int(sv)
    except Exception:
        pass
    p = plan_path(project_dir)
    atomic_write_json(p, plan)
    return p


def load_plan(project_dir: Path) -> Optional[Dict[str, Any]]:
    from studio.smart_render import read_json as _read
    data = _read(plan_path(project_dir))
    return data if isinstance(data, dict) and isinstance(data.get("beats"), list) else None


def plan_status(project_dir: Path, script: str) -> str:
    """EMPTY | READY | OUTDATED | ERROR (+REVIEW surfaced via validate)."""
    plan = load_plan(project_dir)
    if plan is None:
        return "EMPTY"
    if plan.get("schemaVersion") != NARRATION_SCHEMA_VERSION:
        return "OUTDATED"
    if script_content_hash(script) != plan.get("sourceScriptHash"):
        return "OUTDATED"
    res = validate_plan(plan, script)
    if res["status"] == "ERROR":
        return "ERROR"
    return "READY"


def update_beat(plan: Dict[str, Any], beat_id: str,
                patch: Dict[str, Any]) -> Dict[str, Any]:
    """Manual edit: allowlisted fields only; marks manualEdited. Never touches script."""
    allowed = {"style", "intensity", "rate", "pauseBefore", "pauseAfter",
               "emphasis", "accepted"}
    beats = plan.get("beats", [])
    target = next((b for b in beats if b.get("beatId") == beat_id), None)
    if target is None:
        raise KeyError(f"beat {beat_id} not found")
    if "style" in patch and patch["style"] not in NARRATION_STYLES:
        raise ValueError(f"invalid style {patch['style']}")
    for k in ("intensity",):
        if k in patch and not (0.0 <= float(patch[k]) <= 1.0):
            raise ValueError(f"{k} out of bounds")
    if "rate" in patch and not (RATE_MIN - 0.001 <= float(patch["rate"]) <= RATE_MAX + 0.001):
        raise ValueError("rate out of bounds")
    for k in ("pauseBefore", "pauseAfter"):
        if k in patch and (float(patch[k]) < 0 or float(patch[k]) > 2.0):
            raise ValueError(f"{k} invalid")
    changed = False
    for k in allowed:
        if k in patch and patch[k] is not None:
            if target.get(k) != patch[k]:
                target[k] = patch[k]
                changed = True
    if changed and "accepted" not in patch:
        target["manualEdited"] = True
    return target


# ----------------------------------------------------------------------------
# Synthesis hash (what actually affects audio) + compiler
# ----------------------------------------------------------------------------

def narration_synth_hash(plan: Optional[Dict[str, Any]]) -> str:
    """Hash over synthesis-affecting fields only.

    Excludes: UI selection, generatedAt, reason/evidence text, review metadata,
    confidence display, accepted state. Includes beat order/text-span mapping,
    rate, pauses, emphasis, style-when-used, profile, compiler version.
    """
    if not plan or plan.get("mode") == "off":
        return sha256_text(f"narration-off|{COMPILER_VERSION}")
    items = []
    for b in plan.get("beats", []):
        items.append({
            "sids": b.get("sentenceIds"),
            "rate": b.get("rate"),
            "pb": b.get("pauseBefore"),
            "pa": b.get("pauseAfter"),
            "emph": b.get("emphasis"),
            "style": b.get("style"),
            "intensity": b.get("intensity"),
        })
    return sha256_text(_canonical({
        "beats": items,
        "profile": plan.get("profile"),
        "compiler": COMPILER_VERSION,
    }))


def _sentences_with_beats(plan: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten beats to per-sentence prosody rows in script order."""
    rows = []
    for b in plan.get("beats", []):
        for sid in b.get("sentenceIds", []):
            rows.append({"sid": sid, "rate": float(b.get("rate", 1.0)),
                         "pb": float(b.get("pauseBefore", 0.0)),
                         "pa": float(b.get("pauseAfter", 0.0)),
                         "emph": list(b.get("emphasis", [])),
                         "beat": b.get("beatId")})
    return rows


def compile_for_chunks(chunk_texts: List[str], sentences: List[_Sentence],
                       plan: Optional[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """Map beat prosody onto ordered chunk texts (1-based chunk index).

    A chunk inherits the mean rate of beats overlapping it (via sentence
    containment), boundary pauses where a beat starts/ends at the chunk edge,
    and the union of emphasis phrases present in its text. Deterministic.
    Chunks fully inside neutral gaps keep defaults (1.0 / 0.08 / 0.12).
    """
    sent_by_idx = {s.index: s for s in sentences}
    rows = _sentences_with_beats(plan) if plan and plan.get("mode") != "off" else []
    by_sid = {r["sid"]: r for r in rows}
    # Word-level sequential alignment (robust to different sentence
    # splitters: chunkers only ever split at whitespace, so chunk words form
    # a contiguous subsequence of sentence words).
    sent_word_lists = [s.text.split() for s in sentences]
    flat: List[int] = []  # sentence position per word
    for si, words in enumerate(sent_word_lists):
        flat.extend([si] * len(words))
    all_words = [w for words in sent_word_lists for w in words]

    def locate(chunk_words: List[str], start: int) -> Tuple[int, int, int]:
        """Return (first_si, last_si, next_start) or (-1, -1, start)."""
        if not chunk_words:
            return -1, -1, start
        # find first word at/after start
        i = -1
        for k in range(start, len(all_words)):
            if all_words[k] == chunk_words[0]:
                # verify full run
                ok = True
                for j in range(1, len(chunk_words)):
                    if k + j >= len(all_words) or all_words[k + j] != chunk_words[j]:
                        ok = False
                        break
                if ok:
                    i = k
                    break
        if i < 0:
            return -1, -1, start
        return flat[i], flat[i + len(chunk_words) - 1], i + len(chunk_words)

    out: Dict[int, Dict[str, Any]] = {}
    ptr = 0
    sids = [s.sid for s in sentences]
    for ci, ctext in enumerate(chunk_texts, start=1):
        ctext = ctext or ""
        first_si, last_si, ptr = locate(ctext.split(), ptr)
        if first_si < 0:
            # not locatable: neutral, never invent prosody
            out[ci] = {"rate_factor": 1.0, "pause_before": 0.08,
                       "pause_after": 0.12, "emphasis": []}
            continue
        overlapping = [by_sid[sids[si]] for si in range(first_si, last_si + 1)
                       if sids[si] in by_sid]
        if not overlapping:
            out[ci] = {"rate_factor": 1.0, "pause_before": 0.08,
                       "pause_after": 0.12, "emphasis": []}
            continue
        rates = [r["rate"] for r in overlapping]
        first = overlapping[0]
        last = overlapping[-1]
        # beat starts at this chunk? (beat's first sentence starts inside chunk
        # AND no earlier sentence of the same beat is inside this chunk... use
        # sentence-boundary rule: pause_before from a beat whose first listed
        # sentence is the chunk's first overlapping sentence and that sentence
        # starts the beat)
        pb = 0.08
        pa = 0.12
        # find beats owning first/last overlapping sentences
        first_beat = next((b for b in (plan.get("beats", []) if plan else [])
                           if b.get("sentenceIds", [])[:1] == [first["sid"]]), None)
        if first_beat is not None:
            pb = float(first_beat.get("pauseBefore", 0.08))
        last_beats = [b for b in (plan.get("beats", []) if plan else [])
                      if b.get("sentenceIds", [])[-1:] == [last["sid"]]]
        if last_beats:
            pa = max(float(b.get("pauseAfter", 0.12)) for b in last_beats)
        emph: List[str] = []
        low_chunk = ctext.lower()
        for r in overlapping:
            for e in r["emph"]:
                if e and e.lower() in low_chunk and e.lower() not in [x.lower() for x in emph]:
                    emph.append(e)
        out[ci] = {"rate_factor": round(sum(rates) / len(rates), 3),
                   "pause_before": round(min(pb, PAUSE_BEFORE_MAX), 2),
                   "pause_after": round(min(pa, PAUSE_AFTER_MAX), 2),
                   "emphasis": emph}
    # Joint-silence cap: pause_after(N) + pause_before(N+1) is contiguous in
    # the master track. Keep joints <= 1.2s so Voice QA intra-sentence
    # threshold (1.5s) is not tripped by planned pauses alone.
    for ci in sorted(out.keys())[:-1]:
        joint = out[ci]["pause_after"] + out[ci + 1]["pause_before"]
        if joint > 1.2:
            out[ci + 1]["pause_before"] = round(max(0.0, 1.2 - out[ci]["pause_after"]), 2)
    return out


# ----------------------------------------------------------------------------
# Master assembly (audio + silence track) + soft visual links
# ----------------------------------------------------------------------------

def assemble_master(track: List[Any], out_path: Path,
                    sample_rate: int = 24000) -> float:
    """Concatenate wav files and silence gaps into one master WAV.

    track items: ("wav", Path) or ("silence", seconds). Returns duration (s).
    """
    import numpy as np
    import soundfile as sf

    parts = []
    for kind, payload in track:
        if kind == "silence":
            n = int(round(float(payload) * sample_rate))
            if n > 0:
                parts.append(np.zeros(n, dtype=np.int16))
        elif kind == "wav":
            data, sr = sf.read(str(payload), dtype="int16")
            if sr != sample_rate:
                raise ValueError(f"sample rate {sr} != {sample_rate}: {payload}")
            if getattr(data, "ndim", 1) > 1:
                data = data[:, 0]
            parts.append(np.asarray(data, dtype=np.int16).reshape(-1))
        else:
            raise ValueError(f"unknown track item {kind!r}")
    if not parts or sum(len(p) for p in parts) == 0:
        raise ValueError("empty master track")
    master = np.concatenate(parts)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.parent / ("." + out_path.stem + "_new" + out_path.suffix)
    try:
        sf.write(str(tmp), master, sample_rate, subtype="PCM_16")
        tmp.replace(out_path)
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except Exception:
            pass
    return float(len(master)) / float(sample_rate)


def link_beats_to_scenes(scenes: List[Dict[str, Any]],
                         beats: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Many-to-one informational mapping beat->scene by narration containment.

    Pure derivation: does NOT split scenes, change counts, or mutate inputs.
    Returns {scene_id: {"beatIds": [...], "tones": [...]}}.
    """
    links: Dict[str, Dict[str, Any]] = {}
    for sc in scenes:
        narr = _norm(sc.get("narration", "")).lower()
        bids, tones = [], []
        for b in beats:
            bt = _norm(b.get("text", ""))
            if bt and bt.lower() in narr:
                bids.append(b.get("beatId"))
                if b.get("style") not in tones:
                    tones.append(b.get("style"))
        links[sc.get("scene_id")] = {"beatIds": bids, "tones": tones}
    return links
