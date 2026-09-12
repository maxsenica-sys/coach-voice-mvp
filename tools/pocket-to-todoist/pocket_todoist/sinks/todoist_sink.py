"""The Todoist sink: turns an extracted action into exactly one task."""

from __future__ import annotations

from .. import dedupe, routing, vault
from ..dates import resolve_due
from .base import Sink


class TodoistSink(Sink):
    name = "todoist"

    def __init__(self, client):
        self.client = client
        self.projects_by_name = {}
        self.config = {}
        self.dry_run = False

    def prepare(self, config, dry_run=False):
        self.config = config
        self.dry_run = dry_run
        self.projects_by_name = self.client.projects_by_name()
        if not dry_run:
            for label in (config.get("routing") or {}).get("always_labels") or []:
                self.client.ensure_label(label)

    def known_refs(self):
        """Every ref already sitting in Todoist under the Pocket label.

        One request, and it makes the whole duplicate question answerable from
        the destination itself rather than from local bookkeeping.
        """
        labels = (self.config.get("routing") or {}).get("always_labels") or []
        if not labels:
            return {}
        found = {}
        for task in self.client.tasks_with_label(labels[0]):
            for ref in dedupe.refs_in(task.get("description", "")):
                found[ref] = task.get("id")
        return found

    def accepts(self, note, action):
        return True

    def emit(self, note, action, context):
        config = self.config
        due = resolve_due(action.due_phrase, note.on, config.get("due") or {})
        decision = routing.route(action, self.projects_by_name, config)

        title = action.title
        if action.owner == "other" and action.owner_name:
            prefix = f"{action.owner_name}:"
            if not title.lower().startswith(action.owner_name.lower()):
                title = f"{prefix} {title}"

        description = _describe(note, action, due, context)

        if self.dry_run:
            task_id, url = None, None
        else:
            created = self.client.create_task(
                content=title,
                description=description,
                project_id=decision.project_id,
                labels=decision.labels,
                priority=decision.priority,
                due_datetime=due.utc_datetime(config["timezone"]) if due else None,
            )
            task_id = (created or {}).get("id")
            url = (created or {}).get("url")

        return {
            "ref": context["ref"],
            "id": task_id,
            "url": url,
            "title": title,
            "project": decision.project_name,
            "labels": decision.labels,
            "priority": decision.priority,
            "due": due.local_datetime() if due else None,
            "due_phrase": due.phrase if due else None,
        }


def _describe(note, action, due, context):
    """The task description: context first, provenance last.

    The Obsidian link is the reason this pipeline sends tasks rather than
    transcripts. Todoist gets the sentence needed to act; the recording, the
    full transcript and the surrounding thinking stay one tap away.
    """
    parts = []
    if action.context:
        parts.append(action.context)
    if due and due.phrase:
        parts.append(f'Said: "{due.phrase}" on {note.on.isoformat()}.')

    vault_name = (context.get("vault_name") or "").strip()
    provenance = [f"Source: {note.title} ({note.on.isoformat()})"]
    if vault_name:
        provenance.append(f"Obsidian: {vault.obsidian_uri(vault_name, note.rel_path)}")
    provenance.append(f"ref: {context['ref']}")

    parts.append("\n".join(provenance))
    return "\n\n".join(parts)
