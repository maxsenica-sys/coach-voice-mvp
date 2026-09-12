#!/usr/bin/env python3
"""Turn extracted actions into Todoist task payloads. No credentials, no network.

This is the half of the pipeline that runs when the vault is on a phone.

`run.py` reads the vault and calls both APIs itself, which needs a computer that
has the vault and two API tokens. There isn't one: the vault lives on an iPhone.
So the transport moves to whatever is running this -- a Claude session with the
Pocket and Todoist connectors -- and this script keeps the part that must be
deterministic and testable:

    Pocket transcripts  ->  [ the session extracts ]  ->  extractions.json
    extractions.json    ->  [ THIS SCRIPT ]          ->  plan.json
    plan.json           ->  [ the session creates ]  ->  Todoist

Dates, routing, priority, descriptions and duplicate suppression all happen
here, against the same modules `run.py` uses and the same rigs. The session is
only a courier, which is the point: couriers improvise, and this part must not.

    ./plan.py --recordings r.json --extractions e.json \
              --existing existing.json --projects p.json --out plan.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pocket_todoist import config as config_module  # noqa: E402
from pocket_todoist import dedupe, routing, vault  # noqa: E402
from pocket_todoist.dates import resolve_due  # noqa: E402
from pocket_todoist.extract import Action, Extraction  # noqa: E402


def load(path, default=None):
    if not path:
        return default
    with open(os.path.expanduser(path), "r", encoding="utf-8") as handle:
        return json.load(handle)


def as_note(recording, vault_name):
    """A Pocket recording, shaped like a vault note.

    `rel_path` is the recording id rather than a file path. It is the dedupe
    key, and it has to be the one thing about a recording that never changes --
    a title can be regenerated, a path is unknown from here, an id is stable.
    """
    stamp = str(recording.get("date") or "")[:10]
    try:
        on = date(*(int(part) for part in stamp.split("-")))
    except (ValueError, TypeError):
        on = date.today()
    return vault.Note(
        path="",                      # not on this machine
        rel_path=f"pocket/{recording['recording_id']}",
        title=recording.get("title") or "Pocket recording",
        on=on,
        body=recording.get("transcript") or "",
        frontmatter="",
        raw="",
    )


def describe(note, action, due, ref, vault_name):
    parts = []
    if action.context:
        parts.append(action.context)
    if due and due.phrase:
        parts.append(f'Said: "{due.phrase}" on {note.on.isoformat()}.')

    provenance = [f"Source: {note.title} ({note.on.isoformat()})"]
    if vault_name:
        provenance.append(
            "Obsidian: " + vault.obsidian_search_uri(vault_name, note.title))
    provenance.append(f"ref: {ref}")
    parts.append("\n".join(provenance))
    return "\n\n".join(parts)


def build(recordings, extractions, existing, projects, config):
    vault_name = (config.get("vault") or {}).get("name") or ""
    projects_by_name = {p["name"].lower(): p["id"] for p in projects or []}

    known_refs = set()
    existing_titles = []
    for task in existing or []:
        known_refs |= dedupe.refs_in(task.get("description", ""))
        existing_titles.append(task.get("content", ""))

    create, skipped = [], []

    for recording in recordings:
        note = as_note(recording, vault_name)
        payload = extractions.get(recording["recording_id"])
        if payload is None:
            skipped.append({"recording": note.title,
                            "reason": "no extraction supplied"})
            continue

        extraction = Extraction(
            action_items=[Action(**a) for a in payload.get("action_items", [])],
            ideas=payload.get("ideas", []),
            notes=payload.get("notes", []),
            decisions=payload.get("decisions", []),
        )

        titles_this_note = []
        made = []
        for action in extraction.action_items:
            ref = dedupe.ref_for(note.key, action.title)
            if ref in known_refs:
                skipped.append({"title": action.title, "reason": "ref already in Todoist"})
                continue
            if dedupe.is_near_duplicate(action.title, titles_this_note):
                skipped.append({"title": action.title, "reason": "duplicate within note"})
                continue
            # Against everything already under the Pocket label, not just this
            # note: the older pipeline's tasks carry no ref, so similarity is
            # the only thing that can see them.
            if dedupe.is_near_duplicate(action.title, existing_titles):
                skipped.append({"title": action.title,
                                "reason": "already in Todoist under a similar title"})
                continue

            due = resolve_due(action.due_phrase, note.on, config.get("due") or {})
            decision = routing.route(action, projects_by_name, config)

            title = routing.owner_title(action)

            task = {
                "ref": ref,
                "recording_id": recording["recording_id"],
                "content": title,
                "description": describe(note, action, due, ref, vault_name),
                "projectId": decision.project_id,
                "project_name": decision.project_name,
                "labels": decision.labels,
                "priority": decision.priority,
                "priorityLabel": routing.TODOIST_PRIORITY_LABEL[decision.priority],
            }
            if due:
                task["due_datetime_utc"] = due.utc_datetime(config["timezone"])
                task["due_local"] = due.local_datetime()
                # An explicit local date and time, which Todoist reads in the
                # account's own timezone. Both a date AND a time, always: on
                # Todoist Free a task with only a date never reminds anyone.
                task["dueString"] = (f"{due.on.isoformat()} at "
                                     f"{due.at.strftime('%H:%M')}")
            create.append(task)
            made.append(task)
            known_refs.add(ref)
            titles_this_note.append(action.title)
            existing_titles.append(title)

        recording["_summary"] = vault.render_summary(
            extraction,
            [{"title": t["content"], "project": t["project_name"],
              "due": t.get("due_local"), "url": None} for t in made])

    return {
        "create": create,
        "skipped": skipped,
        "obsidian_blocks": {r["recording_id"]: r.pop("_summary")
                            for r in recordings if "_summary" in r},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--recordings", required=True)
    parser.add_argument("--extractions", required=True)
    parser.add_argument("--existing", help="Tasks already carrying the Pocket label.")
    parser.add_argument("--projects", help="Todoist projects, for routing.")
    parser.add_argument("--config")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    config, _ = config_module.load(args.config)
    result = build(load(args.recordings), load(args.extractions),
                   load(args.existing, []), load(args.projects, []), config)

    with open(os.path.expanduser(args.out), "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, ensure_ascii=False)

    print(f"{len(result['create'])} task(s) to create, "
          f"{len(result['skipped'])} suppressed -> {args.out}")
    for task in result["create"]:
        due = f"  due {task.get('due_local', '-')}" if task.get("due_local") else ""
        print(f"  + [{task['project_name']}] {task['content']}"
              f"  @{' @'.join(task['labels'])}{due}")
    for item in result["skipped"]:
        print(f"  = {item.get('title', item.get('recording'))} -- {item['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
