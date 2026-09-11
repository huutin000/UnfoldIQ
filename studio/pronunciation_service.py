"""
Persistent Pronunciation Dictionary and Preprocessing Engine for UnfoldIQ TTS Studio.
100% Python Standard Library (Ponytail principle).
"""

import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PronunciationEntry:
    def __init__(
        self,
        entry_id: str,
        original: str,
        spoken_form: str,
        enabled: bool = True,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None,
    ):
        self.id = entry_id
        self.original = original.strip()
        self.spoken_form = spoken_form.strip()
        self.enabled = bool(enabled)
        self.created_at = created_at or _utc_now_iso()
        self.updated_at = updated_at or self.created_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "original": self.original,
            "spoken_form": self.spoken_form,
            "enabled": self.enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PronunciationEntry":
        return cls(
            entry_id=str(data.get("id", uuid.uuid4().hex[:12])),
            original=str(data.get("original", "")),
            spoken_form=str(data.get("spoken_form", "")),
            enabled=bool(data.get("enabled", True)),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


class PronunciationDictionary:
    def __init__(self, dict_path: Path):
        self.dict_path = Path(dict_path)
        self.entries: List[PronunciationEntry] = []
        self.load()

    def load(self) -> None:
        """Loads dictionary entries safely. Preserves corrupted files without crashing."""
        if not self.dict_path.exists():
            self.entries = []
            self.save()
            return

        try:
            with open(self.dict_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            raw_entries = data.get("entries", [])
            loaded: List[PronunciationEntry] = []
            for item in raw_entries:
                if isinstance(item, dict) and item.get("original") and item.get("spoken_form"):
                    loaded.append(PronunciationEntry.from_dict(item))
            self.entries = loaded
        except (json.JSONDecodeError, OSError) as e:
            # Preserve corrupted file for diagnostics
            backup_path = self.dict_path.with_suffix(f".corrupt.{int(datetime.now().timestamp())}.json")
            try:
                shutil.copyfile(self.dict_path, backup_path)
            except Exception:
                pass
            # Re-initialize safely with empty entries
            self.entries = []

    def save(self) -> None:
        """Atomic write to prevent corruption during sudden power loss or process kill."""
        self.dict_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "updated_at": _utc_now_iso(),
            "entries": [e.to_dict() for e in self.entries],
        }
        json_str = json.dumps(payload, indent=2, ensure_ascii=False)

        # Write to temporary file in the same directory, then atomic rename
        temp_file = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(self.dict_path.parent),
                delete=False,
                encoding="utf-8",
                prefix="pron_dict_tmp_",
                suffix=".json",
            ) as tf:
                temp_file = Path(tf.name)
                tf.write(json_str)

            temp_file.replace(self.dict_path)
        except Exception:
            if temp_file and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass
            raise

    def list_entries(self) -> List[Dict[str, Any]]:
        return [e.to_dict() for e in self.entries]

    def get_entry(self, entry_id: str) -> Optional[PronunciationEntry]:
        for e in self.entries:
            if e.id == entry_id:
                return e
        return None

    def add_entry(self, original: str, spoken_form: str, enabled: bool = True) -> PronunciationEntry:
        orig = (original or "").strip()
        spoken = (spoken_form or "").strip()

        if not orig:
            raise ValueError("Original phrase cannot be empty.")
        if not spoken:
            raise ValueError("Spoken form / pronunciation cannot be empty.")
        if len(orig) > 200 or len(spoken) > 200:
            raise ValueError("Phrase length cannot exceed 200 characters.")

        # Check case-insensitive duplicate
        for e in self.entries:
            if e.original.lower() == orig.lower():
                raise ValueError(f"Entry with phrase '{orig}' already exists in dictionary.")

        new_entry = PronunciationEntry(
            entry_id=uuid.uuid4().hex[:12],
            original=orig,
            spoken_form=spoken,
            enabled=enabled,
        )
        self.entries.append(new_entry)
        self.save()
        return new_entry

    def update_entry(
        self,
        entry_id: str,
        original: Optional[str] = None,
        spoken_form: Optional[str] = None,
        enabled: Optional[bool] = None,
    ) -> PronunciationEntry:
        entry = self.get_entry(entry_id)
        if not entry:
            raise KeyError(f"Pronunciation entry '{entry_id}' not found.")

        if original is not None:
            orig = original.strip()
            if not orig:
                raise ValueError("Original phrase cannot be empty.")
            if len(orig) > 200:
                raise ValueError("Phrase length cannot exceed 200 characters.")
            # Duplicate check excluding self
            for e in self.entries:
                if e.id != entry_id and e.original.lower() == orig.lower():
                    raise ValueError(f"Entry with phrase '{orig}' already exists in dictionary.")
            entry.original = orig

        if spoken_form is not None:
            spoken = spoken_form.strip()
            if not spoken:
                raise ValueError("Spoken form cannot be empty.")
            if len(spoken) > 200:
                raise ValueError("Phrase length cannot exceed 200 characters.")
            entry.spoken_form = spoken

        if enabled is not None:
            entry.enabled = bool(enabled)

        entry.updated_at = _utc_now_iso()
        self.save()
        return entry

    def delete_entry(self, entry_id: str) -> bool:
        before_count = len(self.entries)
        self.entries = [e for e in self.entries if e.id != entry_id]
        if len(self.entries) < before_count:
            self.save()
            return True
        return False

    def preprocess(self, text: str) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Deterministically preprocesses input text using enabled pronunciation dictionary entries.
        Rules:
        1. Only enabled entries participate.
        2. Sorted longest-match-first to resolve overlapping phrases.
        3. Word-boundary matching: will not replace sub-words inside larger alphanumeric tokens.
        4. Case-insensitive matching, replaced with explicit user spoken form.
        5. Returns transformed text and a snapshot list of applied overrides with match counts.
        """
        enabled_entries = [e for e in self.entries if e.enabled]
        if not enabled_entries or not text:
            return text, []

        # Sort by length of original phrase descending (longest-match-first)
        sorted_entries = sorted(enabled_entries, key=lambda e: len(e.original), reverse=True)

        current_text = text
        applied_overrides: List[Dict[str, Any]] = []

        for entry in sorted_entries:
            orig = entry.original
            spoken = entry.spoken_form

            # Build boundary-safe regex pattern:
            # If start is alphanumeric, require no preceding word char (?<!\w)
            # If end is alphanumeric, require no succeeding word char (?!\w)
            prefix = r"(?<!\w)" if re.match(r"^\w", orig) else ""
            suffix = r"(?!\w)" if re.match(r".*\w$", orig) else ""
            pattern = re.compile(f"{prefix}{re.escape(orig)}{suffix}", re.IGNORECASE)

            matches = list(pattern.finditer(current_text))
            count = len(matches)
            if count > 0:
                current_text = pattern.sub(spoken, current_text)
                applied_overrides.append({
                    "entry_id": entry.id,
                    "original": entry.original,
                    "spoken_form": entry.spoken_form,
                    "match_count": count,
                })

        return current_text, applied_overrides
