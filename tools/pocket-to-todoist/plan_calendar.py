#!/usr/bin/env python3
"""Turn a read schedule into Google Calendar payloads. No credentials, no network.

The screenshot half of the automation, and the mirror image of `plan.py`:

    a screenshot in Drive  ->  [ the session reads it ]  ->  events.json
    events.json            ->  [ THIS SCRIPT ]          ->  calendar-plan.json
    calendar-plan.json     ->  [ the session creates ]  ->  Google Calendar

The session is a courier. It reads the image and reports rows; it does not
decide what day "SALI" is, whether 16.09 is September or the sixteenth month,
how long a session runs, or whether an entry is already on the calendar. All of
that is here, where it is deterministic and tested, for the reason the first
real run of `plan.py` taught: a courier that retypes the parcel is not a
courier, and four of the first five tasks it wrote carried a hand-typed ref
that would have duplicated everything the next day.

An entry already on the calendar is compared, not merely detected: same entry
with a new time is an event to move, not a duplicate to suppress. Suppressing
on presence alone is how a rescheduled match silently never reaches the phone.

**Nothing here guesses a date.** A row whose date cannot be read, or whose date
contradicts the weekday printed next to it, goes to `needs_review` and is
reported. An empty calendar is a visible problem; a confident calendar with
Tuesday's session on Wednesday is not.

    ./plan_calendar.py --screenshots s.json --events e.json \
                       --existing existing.json --out calendar-plan.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

from pocket_todoist import config as config_module  # noqa: E402
from pocket_todoist import dedupe, schedule  # noqa: E402


def load(path, default=None):
    if not path:
        return default
    with open(os.path.expanduser(path), "r", encoding="utf-8") as handle:
        return json.load(handle)


def occurrence_key(on, title, seen_counts):
    """A stable identity for one entry on one day.

    The date and the title alone are not enough -- a training day routinely has
    a morning and an evening session with the same name -- so an occurrence
    index separates them. The index counts entries *of the same title on that
    day*, not all entries, so adding a match to a Tuesday does not renumber the
    training sessions and rewrite events that did not change.

    Deliberately excludes the time. That is what lets a corrected schedule move
    an existing event rather than adding a second one beside it: same day, same
    name, same occurrence, new time -> the iCalUID matches and Google updates.
    """
    normalised = dedupe.normalise(title)
    slot = f"{on.isoformat()}/{normalised}"
    index = seen_counts.get(slot, 0)
    seen_counts[slot] = index + 1
    return f"schedule/{slot}/{index}"


def describe(event, screenshot, ref):
    """What the entry says, and where it came from.

    The printed Turkish is kept verbatim. When a time or a day has to be
    checked against the original, the words on the screenshot are what to
    compare against, not this pipeline's reading of them.
    """
    parts = []
    if event.notes:
        parts.append(event.notes)

    printed = []
    if event.printed_day:
        printed.append(event.printed_day)
    if event.printed_time:
        printed.append(event.printed_time)
    if printed:
        parts.append("As printed: " + " ".join(printed))

    provenance = []
    name = (screenshot or {}).get("file_name") or (screenshot or {}).get("screenshot_id")
    if name:
        provenance.append(f"Source: {name}")
    if (screenshot or {}).get("drive_url"):
        provenance.append(f"Screenshot: {screenshot['drive_url']}")
    provenance.append(f"ref: {ref}")
    parts.append("\n".join(provenance))
    return "\n\n".join(parts)


def _instant(side, tz):
    """One end of an event as a comparable instant, or a date for all-day.

    Google returns what it stored -- "2026-09-18T19:00:00+03:00" -- while a
    freshly planned event carries a naive local time and a separate zone. They
    describe the same moment and must compare equal, so both are resolved to an
    aware datetime before comparison rather than matched as strings.
    """
    side = side or {}
    if side.get("date"):
        return side["date"]
    raw = side.get("dateTime")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return raw
    if parsed.tzinfo is None:
        zone = side.get("timeZone") or tz
        try:
            parsed = parsed.replace(tzinfo=ZoneInfo(zone))
        except Exception:
            return raw
    return parsed.astimezone(ZoneInfo("UTC")).isoformat()


def _unchanged(existing_event, planned, tz):
    """Is the calendar's copy already what we would write?

    Compared on the things a reprinted schedule actually changes: when it
    starts, when it ends, what it is called and where it is. The description
    is excluded deliberately -- it carries the screenshot filename, which
    changes every time a new photo of the same week is taken and would make
    every event look edited.
    """
    for key in ("start", "end"):
        if _instant(existing_event.get(key), tz) != _instant(planned.get(key), tz):
            return False
    if (existing_event.get("summary") or "") != (planned.get("summary") or ""):
        return False
    if (existing_event.get("location") or "") != (planned.get("location") or ""):
        return False
    return True


def build(screenshots, events_by_screenshot, existing, config):
    calendar_config = config.get("calendar") or {}
    tz = calendar_config.get("timezone") or config.get("timezone") or "UTC"

    # Keyed by ref, so a planned event can be compared against the calendar's
    # copy rather than merely detected as present. Skipping on presence alone
    # is what made a rescheduled match vanish: the ref matched, the row was
    # suppressed, and the new time never reached the calendar.
    known = {}
    for item in existing or []:
        for ref in dedupe.cal_refs_in(item.get("description", "")):
            known[ref] = item

    create, update, needs_review, skipped = [], [], [], []
    seen_counts = {}
    by_id = {s.get("screenshot_id"): s for s in screenshots or []}

    for screenshot_id, payload in (events_by_screenshot or {}).items():
        screenshot = by_id.get(screenshot_id, {"screenshot_id": screenshot_id})
        anchor = schedule.parse_date(
            screenshot.get("taken_on") or (payload or {}).get("week_of")) or date.today()

        rows = (payload or {}).get("events") or []
        if not rows:
            skipped.append({"screenshot": screenshot.get("file_name", screenshot_id),
                            "reason": "no rows read from this screenshot"})
            continue

        for raw in rows:
            event, problem = schedule.build(
                raw, calendar_config, anchor=anchor,
                source=screenshot.get("file_name", screenshot_id))
            if problem is not None:
                needs_review.append({
                    "screenshot": screenshot.get("file_name", screenshot_id),
                    "raw": problem.raw,
                    "reason": problem.reason,
                })
                continue

            key = occurrence_key(event.on, event.title, seen_counts)
            ref = dedupe.cal_ref_for(key, event.title)

            entry = {
                "ref": ref,
                "iCalUID": f"{ref}@pocket-todoist",
                "summary": event.title,
                "description": describe(event, screenshot, ref),
                "screenshot_id": screenshot_id,
            }
            if event.location:
                entry["location"] = event.location

            if event.all_day:
                # Google's all-day end is exclusive: a one-day event ends on the
                # following date. Sending the same date both sides produces a
                # zero-length event that silently does not appear.
                entry["start"] = {"date": event.on.isoformat()}
                entry["end"] = {"date": event.end_date_exclusive()}
            else:
                entry["start"] = {"dateTime": event.start_datetime(), "timeZone": tz}
                entry["end"] = {"dateTime": event.end_datetime(), "timeZone": tz}

            previous = known.get(ref)
            if previous is None:
                create.append(entry)
            elif _unchanged(previous, entry, tz):
                skipped.append({"title": event.title,
                                "date": event.on.isoformat(),
                                "reason": "already on the calendar, unchanged"})
                continue
            else:
                # Same entry, changed details. The iCalUID is unchanged, so this
                # moves the event Google already holds instead of adding a
                # second one beside it.
                entry["event_id"] = previous.get("id")
                entry["was"] = {"start": previous.get("start"),
                                "summary": previous.get("summary")}
                update.append(entry)
            known[ref] = entry

    def when(entry):
        return entry["start"].get("dateTime") or entry["start"].get("date")

    create.sort(key=when)
    update.sort(key=when)
    return {"create": create, "update": update, "needs_review": needs_review,
            "skipped": skipped, "timezone": tz}


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--screenshots", required=True)
    parser.add_argument("--events", required=True)
    parser.add_argument("--existing", help="Events already on the calendar.")
    parser.add_argument("--config")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    config, _ = config_module.load(args.config)
    result = build(load(args.screenshots, []), load(args.events, {}),
                   load(args.existing, []), config)

    with open(os.path.expanduser(args.out), "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, ensure_ascii=False)

    print(f"{len(result['create'])} event(s) to create, "
          f"{len(result['update'])} to move, "
          f"{len(result['needs_review'])} needing review, "
          f"{len(result['skipped'])} suppressed -> {args.out}")
    print(f"  timezone: {result['timezone']}")
    for entry in result["create"]:
        when = entry["start"].get("dateTime") or entry["start"].get("date")
        print(f"  + {when}  {entry['summary']}")
    for entry in result["update"]:
        when = entry["start"].get("dateTime") or entry["start"].get("date")
        was = (entry.get("was") or {}).get("start") or {}
        print(f"  ~ {when}  {entry['summary']}  "
              f"(was {was.get('dateTime') or was.get('date') or 'different'})")
    for item in result["needs_review"]:
        print(f"  ? {item['raw'].get('title', '(untitled)')} -- {item['reason']}")
    for item in result["skipped"]:
        print(f"  = {item.get('title', item.get('screenshot'))} -- {item['reason']}")
    # Rows needing review are the whole point of the weekday cross-check, so
    # they change the exit status: a silent partial import is the failure this
    # script exists to make impossible.
    return 2 if result["needs_review"] else 0


if __name__ == "__main__":
    sys.exit(main())
