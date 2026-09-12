"""The orchestration: note in, tasks out, note marked.

The ordering here is the safety property worth reading twice. A note is marked
processed only after every one of its tasks has been created. If the run dies
half way through a note, the note stays unprocessed, and the next run re-reads
it and re-derives the same refs -- which the duplicate check then recognises,
so the tasks that did land are not created twice. Crash recovery falls out of
dedupe rather than needing a transaction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from . import dedupe, vault
from .extract import ExtractionError


@dataclass
class NoteResult:
    note_title: str
    rel_path: str
    created: list = field(default_factory=list)
    skipped_duplicates: list = field(default_factory=list)
    ideas: int = 0
    notes: int = 0
    decisions: int = 0
    error: str = ""
    status: str = "processed"


@dataclass
class RunReport:
    results: list = field(default_factory=list)
    considered: int = 0
    already_done: int = 0

    @property
    def created_count(self):
        return sum(len(r.created) for r in self.results)

    @property
    def duplicate_count(self):
        return sum(len(r.skipped_duplicates) for r in self.results)

    @property
    def failed(self):
        return [r for r in self.results if r.error]


def process_note(note, config, backend, sinks, state, known_refs,
                 dry_run=False, force=False):
    vault_config = config.get("vault") or {}
    processed_key = vault_config.get("processed_key") or "pocket_todoist"
    transcript = note.transcript()
    digest = dedupe.content_hash(transcript)

    if not force and vault.is_processed(note, processed_key, digest):
        return None  # Already analysed, and unchanged since.

    result = NoteResult(note_title=note.title, rel_path=note.rel_path)

    try:
        extraction = backend.extract(
            note_title=note.title,
            note_date=note.on.isoformat(),
            transcript=transcript,
            topics=[(t["name"], t.get("hint", "")) for t in config.get("topics") or []],
        )
    except ExtractionError as exc:
        # Leave the note untouched. An unprocessed note is visible and will be
        # retried; a note marked done with nothing under it is neither.
        result.error = str(exc)
        result.status = "failed"
        return result

    result.ideas = len(extraction.ideas)
    result.notes = len(extraction.notes)
    result.decisions = len(extraction.decisions)

    titles_this_note = state.titles_for_note(note.key)
    created_records = []

    for action in extraction.action_items:
        ref = dedupe.ref_for(note.key, action.title)

        if ref in known_refs or state.known_ref(ref):
            result.skipped_duplicates.append(action.title)
            continue
        if dedupe.is_near_duplicate(action.title, titles_this_note):
            result.skipped_duplicates.append(action.title)
            continue

        context = {"ref": ref, "vault_name": vault_config.get("name", "")}
        for sink in sinks:
            if not sink.accepts(note, action):
                continue
            record = sink.emit(note, action, context)
            if not record:
                continue
            created_records.append(record)
            if not dry_run:
                state.record_task(note.key, ref, record.get("id"), action.title)
            known_refs[ref] = record.get("id")
        titles_this_note.append(action.title)

    result.created = created_records

    summary = vault.render_summary(extraction, created_records)
    processed_lines = [
        f"processed_at: {datetime.now().astimezone().isoformat(timespec='seconds')}",
        f"content_hash: {digest}",
        f"tasks: {len(created_records)}",
    ]
    vault.write_back(note, summary, processed_key, processed_lines, dry_run=dry_run)

    if not dry_run:
        state.record_note(note.key, digest,
                          datetime.now().astimezone().isoformat(timespec="seconds"))
        state.save()

    return result


def run(notes, config, backend, sinks, state, dry_run=False, force=False,
        on_event=lambda *_: None):
    report = RunReport(considered=len(notes))

    for sink in sinks:
        sink.prepare(config, dry_run=dry_run)

    known_refs = {}
    for sink in sinks:
        known_refs.update(sink.known_refs())
    if known_refs and not dry_run:
        state.adopt_existing(known_refs)

    for note in notes:
        on_event("note", note)
        result = process_note(note, config, backend, sinks, state, known_refs,
                              dry_run=dry_run, force=force)
        if result is None:
            report.already_done += 1
            continue
        report.results.append(result)
        on_event("result", result)

    if not dry_run:
        state.save()
    return report
