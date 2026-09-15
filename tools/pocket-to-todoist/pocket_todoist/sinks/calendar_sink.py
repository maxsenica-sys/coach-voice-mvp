"""The calendar sink: an extracted action that is really an appointment.

`sinks/base.py` named this as the obvious second sink, and the shape it
predicted is the shape it has: given a note and an action, decide whether it is
yours, and if so record it somewhere.

What makes it *its own* sink rather than a flag on the Todoist one is the
question it answers. Todoist answers "what do I have to do?" and a task with no
date is a perfectly good answer. A calendar answers "where do I have to be at
four o'clock?", and an entry that is not a real commitment at a real time is
worse than no entry -- it is a meeting that does not exist, which he will plan
around. So this sink is deliberately narrow, and says no far more often than
yes:

- The action must resolve to an actual date. No date, no event, never a guess.
- It must read like somewhere to be, not something to do. "Book the flight" is
  a task; "flight to Ankara" is an event. The cue list below is the whole of
  that judgement and is config-editable, because it is the part most likely to
  need tuning against real notes.

**Dedupe is the sink's own business here.** `known_refs` returns nothing on
purpose: the pipeline treats refs as global across sinks, so a ref reported
here would suppress the *Todoist task* of the same name, and an appointment
usually wants both -- the event to be somewhere, the task to prepare for it.
This sink therefore stamps a ref in its own `pkc-` namespace -- see
`dedupe.cal_ref_for`, which explains why a namespace and not a suffix -- and
checks the calendar itself rather than reporting refs upwards.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from .. import dedupe, vault
from ..dates import resolve_due
from .base import Sink

# Words that mean "be somewhere at a time" rather than "do a thing by a time".
# Turkish included: the schedules these end up alongside are Turkish, and a
# note is as likely to say "maç" as "match".
APPOINTMENT_CUES = [
    "meeting", "appointment", "session", "training", "practice", "match",
    "game", "fixture", "flight", "travel", "pick up", "pickup", "drop off",
    "call with", "catch up with", "coffee with", "lunch with", "dinner with",
    "physio", "scan", "doctor", "dentist", "clinic", "camp", "trial",
    "antrenman", "idman", "mac", "toplanti", "kamp", "ucus", "seyahat",
]

# Words that keep something a task even when a cue matched. "Book the flight"
# and "confirm the meeting" are errands about an event, not the event.
TASK_OVERRIDES = [
    "book", "rebook", "confirm", "reschedule", "cancel", "arrange", "organise",
    "organize", "email", "message", "text", "ring", "chase", "ask", "check",
    "pay", "invoice", "send", "prepare", "plan",
]


class CalendarSink(Sink):
    name = "calendar"

    def __init__(self, client):
        self.client = client
        self.config = {}
        self.calendar_config = {}
        self.dry_run = False
        self._seen = set()

    def prepare(self, config, dry_run=False):
        self.config = config
        self.calendar_config = config.get("calendar") or {}
        self.dry_run = dry_run
        self._seen = set()
        if dry_run or not self.client:
            return
        # A window wide enough to cover anything this run could file. Read once,
        # so the duplicate question is answered from the calendar itself rather
        # than from local bookkeeping that a lost state file would take with it.
        back = int(self.calendar_config.get("lookback_days") or 30)
        ahead = int(self.calendar_config.get("lookahead_days") or 180)
        now = datetime.now().astimezone()
        for event in self.client.events_between(
                (now - timedelta(days=back)).isoformat(),
                (now + timedelta(days=ahead)).isoformat()):
            self._seen |= dedupe.cal_refs_in(event.get("description", ""))

    def known_refs(self):
        """Nothing, deliberately. See the module docstring."""
        return {}

    def accepts(self, note, action):
        if not self.calendar_config.get("enabled", False):
            return False
        text = f"{action.title} {action.context}".lower()
        if any(word in text for word in self._overrides()):
            return False
        if not any(cue in text for cue in self._cues()):
            return False
        # The hard requirement. An appointment with no date is not an
        # appointment, and the calendar is the one place a guess does damage.
        return resolve_due(action.due_phrase, note.on,
                           self.config.get("due") or {}) is not None

    def _cues(self):
        return [c.lower() for c in
                (self.calendar_config.get("cues") or APPOINTMENT_CUES)]

    def _overrides(self):
        return [w.lower() for w in
                (self.calendar_config.get("task_overrides") or TASK_OVERRIDES)]

    def emit(self, note, action, context):
        ref = dedupe.cal_ref_for(note.key, action.title)
        if ref in self._seen:
            return None

        due = resolve_due(action.due_phrase, note.on, self.config.get("due") or {})
        if due is None:
            return None  # accepts() already checked; belt and braces.

        tz = (self.calendar_config.get("timezone")
              or self.config.get("timezone") or "UTC")
        minutes = int(self.calendar_config.get("default_duration_minutes") or 60)
        start = datetime.combine(due.on, due.at)
        end = start + timedelta(minutes=minutes)

        description = _describe(note, action, ref, context.get("vault_name", ""))

        if self.dry_run or not self.client:
            event_id, link = None, None
        else:
            created = self.client.create_event(
                summary=action.title,
                start={"dateTime": start.isoformat(timespec="seconds"), "timeZone": tz},
                end={"dateTime": end.isoformat(timespec="seconds"), "timeZone": tz},
                description=description,
                ical_uid=f"{ref}@pocket-todoist",
                timezone=tz,
            ) or {}
            event_id, link = created.get("id"), created.get("htmlLink")

        self._seen.add(ref)
        return {
            "sink": self.name,
            "ref": ref,
            "id": event_id,
            "url": link,
            "title": action.title,
            "start": start.isoformat(timespec="seconds"),
            "end": end.isoformat(timespec="seconds"),
            "timezone": tz,
        }


def _describe(note, action, ref, vault_name):
    parts = []
    if action.context:
        parts.append(action.context)
    provenance = [f"Source: {note.title} ({note.on.isoformat()})"]
    if vault_name:
        provenance.append(f"Obsidian: {vault.obsidian_uri(vault_name, note.rel_path)}")
    provenance.append(f"ref: {ref}")
    parts.append("\n".join(provenance))
    return "\n\n".join(parts)
