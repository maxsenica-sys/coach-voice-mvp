"""Reading Pocket notes out of the Obsidian vault, and writing back the result.

Obsidian is the system of record. That shapes every decision in this file:

- Nothing here ever rewrites a note wholesale. The processed marker is spliced
  into the frontmatter and the summary lives between two HTML comments; every
  other byte of the file is passed through untouched. A voice note is the only
  copy of something Max said, and a parser that reformats YAML it half-
  understands will eventually eat one.
- There is no YAML library. A dependency-free splice that preserves unknown
  keys verbatim is safer here than a real parser that round-trips them into
  its own idea of the same document.
- Writes are atomic, because the vault is syncing to a phone while this runs.
"""

from __future__ import annotations

import fnmatch
import os
import re
import tempfile
import urllib.parse
from dataclasses import dataclass
from datetime import date, datetime

FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---[ \t]*\r?\n?", re.DOTALL)
BLOCK_START = "<!-- pocket-todoist:start -->"
BLOCK_END = "<!-- pocket-todoist:end -->"
BLOCK = re.compile(
    re.escape(BLOCK_START) + r".*?" + re.escape(BLOCK_END), re.DOTALL)
DATE_IN_NAME = re.compile(r"(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})")


@dataclass
class Note:
    path: str
    rel_path: str
    title: str
    on: date
    body: str
    frontmatter: str
    raw: str

    @property
    def key(self) -> str:
        """Stable identity for dedupe. The vault-relative path, which is what
        Obsidian itself uses as a note's identity."""
        return self.rel_path

    def transcript(self) -> str:
        """The note's content with our own summary block removed.

        Without this the model would read back its own previous output and
        start extracting tasks from its own task list.
        """
        return BLOCK.sub("", self.body).strip()


def split_frontmatter(text):
    match = FRONTMATTER.match(text or "")
    if not match:
        return "", text or ""
    return match.group(1), (text or "")[match.end():]


def frontmatter_value(frontmatter, key):
    pattern = re.compile(rf"^{re.escape(key)}:[ \t]*(.*)$", re.MULTILINE | re.IGNORECASE)
    match = pattern.search(frontmatter or "")
    if not match:
        return None
    return match.group(1).strip().strip("\"'") or None


def has_frontmatter_key(frontmatter, key):
    return re.search(rf"^{re.escape(key)}:", frontmatter or "",
                     re.MULTILINE | re.IGNORECASE) is not None


def upsert_frontmatter_block(frontmatter, key, lines):
    """Replace (or append) a top-level mapping key and its indented children.

    Everything else in the frontmatter is left exactly as it was found,
    including comments, ordering and quoting style.
    """
    block = re.compile(
        rf"^{re.escape(key)}:.*?(?=^\S|\Z)", re.MULTILINE | re.DOTALL)
    rendered = f"{key}:\n" + "".join(f"  {line}\n" for line in lines)
    existing = (frontmatter or "").rstrip("\n")
    if block.search(existing + "\n"):
        return block.sub(rendered, existing + "\n").rstrip("\n")
    return (existing + "\n" + rendered.rstrip("\n")).strip("\n")


def obsidian_search_uri(vault_name, query):
    """A link back when the note's path in the vault is not known.

    The Pocket source knows a recording's title but not where Pocket filed it,
    and a wrong file path produces a link that silently opens nothing. A search
    link always lands somewhere useful.
    """
    return ("obsidian://search?vault=" + urllib.parse.quote(vault_name, safe="")
            + "&query=" + urllib.parse.quote(f'"{query}"', safe=""))


def obsidian_uri(vault_name, rel_path):
    without_extension = re.sub(r"\.md$", "", rel_path)
    return ("obsidian://open?vault=" + urllib.parse.quote(vault_name, safe="")
            + "&file=" + urllib.parse.quote(without_extension, safe=""))


def _note_date(path, frontmatter, filename):
    for key in ("recorded", "recordingDate", "date", "created"):
        raw = frontmatter_value(frontmatter, key)
        if raw:
            match = DATE_IN_NAME.search(raw)
            if match:
                try:
                    return date(*(int(g) for g in match.groups()))
                except ValueError:
                    pass
    match = DATE_IN_NAME.search(filename)
    if match:
        try:
            return date(*(int(g) for g in match.groups()))
        except ValueError:
            pass
    return datetime.fromtimestamp(os.path.getmtime(path)).date()


def _note_title(frontmatter, body, filename):
    explicit = frontmatter_value(frontmatter, "title")
    if explicit:
        return explicit
    heading = re.search(r"^#\s+(.+)$", body or "", re.MULTILINE)
    if heading:
        return heading.group(1).strip()
    return re.sub(r"\.md$", "", filename)


def looks_like_pocket(rel_path, frontmatter, body, match_config):
    """Is this one of Pocket's notes?

    Several independent signals, any of which is enough. Which one fires
    depends on how Pocket happens to be writing into the vault, and that is
    not something to hardcode from the outside.
    """
    folders = match_config.get("folders") or []
    if folders:
        head = rel_path.replace(os.sep, "/").split("/")[0]
        if any(head.lower() == folder.lower().strip("/") for folder in folders):
            return True

    for key in match_config.get("frontmatter_keys") or []:
        if has_frontmatter_key(frontmatter, key):
            return True

    for key, expected in (match_config.get("frontmatter_values") or {}).items():
        value = frontmatter_value(frontmatter, key)
        if value and value.lower() == str(expected).lower():
            return True

    for tag in match_config.get("tags") or []:
        needle = tag.lstrip("#").lower()
        if re.search(rf"#{re.escape(needle)}\b", body or "", re.IGNORECASE):
            return True
        tag_line = frontmatter_value(frontmatter, "tags")
        if tag_line and needle in tag_line.lower():
            return True

    for pattern in match_config.get("filename_globs") or []:
        if fnmatch.fnmatch(os.path.basename(rel_path).lower(), pattern.lower()):
            return True

    return False


def load_note(path, vault_root):
    with open(path, "r", encoding="utf-8") as handle:
        raw = handle.read()
    frontmatter, body = split_frontmatter(raw)
    rel_path = os.path.relpath(path, vault_root).replace(os.sep, "/")
    filename = os.path.basename(path)
    return Note(
        path=path,
        rel_path=rel_path,
        title=_note_title(frontmatter, body, filename),
        on=_note_date(path, frontmatter, filename),
        body=body,
        frontmatter=frontmatter,
        raw=raw,
    )


def discover(config):
    """Every Pocket note in the vault, oldest first.

    Oldest first is deliberate: if a run is interrupted, the backlog shrinks
    from the end that has been waiting longest.
    """
    vault = config.get("vault") or {}
    root = os.path.expanduser(vault.get("path") or "")
    if not root or not os.path.isdir(root):
        raise FileNotFoundError(
            f"Vault path does not exist: {root or '(unset)'}. "
            "Set vault.path in the config.")

    match_config = dict(vault.get("match") or {})
    match_config.setdefault("folders", vault.get("include_folders") or [])
    skip_dirs = {".obsidian", ".trash", ".git", ".automation", "node_modules"}

    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
        for filename in filenames:
            if not filename.lower().endswith(".md"):
                continue
            path = os.path.join(dirpath, filename)
            try:
                note = load_note(path, root)
            except (OSError, UnicodeDecodeError):
                continue
            if looks_like_pocket(note.rel_path, note.frontmatter, note.body, match_config):
                found.append(note)

    found.sort(key=lambda n: (n.on, n.rel_path))
    return found


def is_processed(note, processed_key, expected_hash=None):
    """Has this note already been analysed, and is it unchanged since?"""
    if not has_frontmatter_key(note.frontmatter, processed_key):
        return False
    if expected_hash is None:
        return True
    recorded = re.search(
        rf"^{re.escape(processed_key)}:.*?^\s+content_hash:[ \t]*(\S+)",
        note.frontmatter + "\n", re.MULTILINE | re.DOTALL)
    if not recorded:
        return True
    return recorded.group(1).strip().strip("\"'") == expected_hash


def render_summary(extraction, created_tasks):
    """The block written back into the note.

    Actions appear here too, with their Todoist link, so the note remains a
    complete record of what was decided -- which is the point of keeping
    Obsidian as the system of record rather than a staging area.
    """
    lines = [BLOCK_START, "", "## Extracted by Pocket -> Todoist", ""]

    if created_tasks:
        lines.append("### Actions sent to Todoist")
        for task in created_tasks:
            due = f" -- due {task['due']}" if task.get("due") else ""
            link = f" ([Todoist]({task['url']}))" if task.get("url") else ""
            lines.append(f"- [ ] {task['title']}{due} -- *{task['project']}*{link}")
        lines.append("")

    for heading, items in (("Ideas", extraction.ideas),
                           ("Decisions", extraction.decisions),
                           ("Notes", extraction.notes)):
        if items:
            lines.append(f"### {heading}")
            lines.extend(f"- {item}" for item in items)
            lines.append("")

    if not created_tasks and not (extraction.ideas or extraction.notes or extraction.decisions):
        lines.append("*Nothing actionable found.*")
        lines.append("")

    lines.append(BLOCK_END)
    return "\n".join(lines)


def write_back(note, summary, processed_key, processed_lines, dry_run=False):
    """Splice the summary and the processed marker into the note on disk."""
    body = note.body
    if BLOCK.search(body):
        body = BLOCK.sub(summary, body)
    else:
        body = body.rstrip() + "\n\n" + summary + "\n"

    frontmatter = upsert_frontmatter_block(
        note.frontmatter, processed_key, processed_lines)
    updated = f"---\n{frontmatter}\n---\n{body.lstrip(chr(10))}"

    if dry_run:
        return updated

    directory = os.path.dirname(note.path)
    handle = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=directory, delete=False, suffix=".tmp")
    try:
        handle.write(updated)
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, note.path)
    return updated
