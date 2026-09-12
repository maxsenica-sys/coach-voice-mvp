"""Making sure the same spoken commitment becomes exactly one Todoist task.

Three layers, because each one fails differently:

1.  A deterministic `ref` derived from the note and the task title, written into
    the task description. Todoist itself becomes the record of what exists.
2.  A local state file, so the common case costs no API calls.
3.  A near-match check against the titles already created from the same note.
    This is the layer that earns its keep. The first two only recognise an
    identical title, and when a note is edited and re-analysed the model may
    phrase the same commitment slightly differently. Without this, editing a
    note quietly doubles its tasks.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from difflib import SequenceMatcher

REF_PREFIX = "pkt-"
REF_PATTERN = re.compile(r"\bpkt-[0-9a-f]{10}\b")

# Above this title similarity, two tasks from the same note are the same task.
# 0.85 was chosen by running the fixtures: it merges re-phrasings such as
# "Message Kevin about Friday training" / "Message Kevin re Friday training",
# and keeps "Send Dan the gym program" apart from "Send Dan the arm swing
# program", which differ by one word and are genuinely two errands.
SIMILARITY_THRESHOLD = 0.85


def normalise(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", (title or "").lower()).strip()


def ref_for(note_key: str, title: str) -> str:
    digest = hashlib.sha1(f"{note_key}\x00{normalise(title)}".encode("utf-8"))
    return REF_PREFIX + digest.hexdigest()[:10]


def refs_in(text: str):
    return set(REF_PATTERN.findall(text or ""))


def is_near_duplicate(title: str, existing_titles) -> bool:
    candidate = normalise(title)
    if not candidate:
        return False
    for existing in existing_titles:
        other = normalise(existing)
        if not other:
            continue
        if candidate == other:
            return True
        if SequenceMatcher(None, candidate, other).ratio() >= SIMILARITY_THRESHOLD:
            return True
    return False


class StateStore:
    """A small JSON file recording what has already been created.

    Written atomically: the vault syncs between a phone and a computer, and a
    half-written state file read by the next run is worse than no state file.
    """

    def __init__(self, path):
        self.path = os.path.expanduser(path)
        self.data = {"version": 1, "notes": {}, "refs": {}}
        self._load()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict) and "notes" in loaded:
                self.data = loaded
                self.data.setdefault("refs", {})
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass  # A missing or corrupt state file is recoverable: Todoist has the refs.

    def save(self):
        directory = os.path.dirname(self.path) or "."
        os.makedirs(directory, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=directory, delete=False, suffix=".tmp")
        try:
            json.dump(self.data, handle, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        finally:
            handle.close()
        os.replace(handle.name, self.path)

    # --- queries ---

    def note(self, note_key):
        return self.data["notes"].get(note_key)

    def content_hash(self, note_key):
        entry = self.note(note_key)
        return entry.get("content_hash") if entry else None

    def known_ref(self, ref):
        return self.data["refs"].get(ref)

    def titles_for_note(self, note_key):
        entry = self.note(note_key)
        return list((entry or {}).get("titles", {}).values())

    # --- updates ---

    def record_task(self, note_key, ref, task_id, title):
        entry = self.data["notes"].setdefault(
            note_key, {"content_hash": None, "titles": {}, "processed_at": None})
        entry.setdefault("titles", {})[ref] = title
        self.data["refs"][ref] = task_id

    def record_note(self, note_key, content_hash, processed_at):
        entry = self.data["notes"].setdefault(
            note_key, {"content_hash": None, "titles": {}, "processed_at": None})
        entry["content_hash"] = content_hash
        entry["processed_at"] = processed_at

    def adopt_existing(self, refs_to_task_ids):
        """Fold refs discovered in Todoist into the state file."""
        self.data["refs"].update(refs_to_task_ids)


def content_hash(text: str) -> str:
    return hashlib.sha1((text or "").encode("utf-8")).hexdigest()[:16]
