---
name: screenshot-to-calendar
description: Turn a schedule screenshot into Google Calendar events. Reads new images from the Calendar Inbox folder in Google Drive, reads the schedule off them in Turkish or English, and creates only the entries it could resolve with confidence. Use whenever Max says "do the schedule", "new schedule", "check the calendar inbox", "add the schedule", "process the screenshot", or drops a training schedule and asks for it in his calendar.
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Screenshot → Google Calendar

The schedule is printed in Turkish. The calendar has to be right in Turkish time.

Run this whole thing without asking Max anything. Report at the end, briefly.

## What you must not improvise

`tools/pocket-to-todoist/plan_calendar.py` decides dates, durations, timezone,
dedupe and what is too uncertain to file. You decide **only** what the image
says. Do not work out which day "SALI" is, do not convert a time, do not
translate a title, and do not retype a description.

That is not a style note. The first real run of the sibling pipeline created
four of five tasks with a hand-typed `ref:` that did not match the computed one.
Nothing looked wrong, and every one would have been silently duplicated the next
day. Build the tool arguments from `calendar-plan.json` with a script, always.

## Steps

**1. Find new screenshots.** `Google_Drive:search_files` for image files in the
folder named in `calendar.drive_folder` (default `Calendar Inbox`). A query like
`name contains 'Calendar Inbox'` finds the folder id first, then
`'<folder-id>' in parents and mimeType contains 'image/'`. Sort by most recent.

Skip anything already processed — step 4 reads the calendar, and a screenshot
whose events are all already there produces an empty plan, which is the correct
outcome and not a failure.

**2. Read each screenshot.** `Google_Drive:download_file_content`, then read the
image. Report one row per entry, and copy what is printed rather than
interpreting it:

| Field | What goes in it |
|---|---|
| `title` | The entry as printed. Turkish stays Turkish — "Antrenman", not "Training". |
| `date` | An absolute date, ISO `YYYY-MM-DD`, resolved by you from the screenshot. |
| `printed_day` | The day label **exactly as printed** — `SALI`, `Pazartesi`, `CUMA`. |
| `time` | The time range as printed — `18:00 - 20:00`, `09.00`, or empty. |
| `location` | Hall, court, city, or empty. |
| `notes` | Anything else on the row worth keeping. Empty is fine. |

`printed_day` is not decoration and must never be left out when the schedule
shows one. It is the cross-check: the planner confirms your date really does
fall on that weekday, and holds the row back if it does not. The way a grid gets
misread is by taking the row above or below, which changes the date while
leaving every other field looking perfectly correct. This is the only thing that
catches it.

**Resolve dates yourself, to absolute ISO dates.** The planner can read
`16.09.2026` and `16 Eylül`, but it should not have to guess a year from a
column header you can see. If the screenshot gives no date at all for a row,
give `date: ""` — the row will be reported for review rather than filed on a
plausible day.

**Do not translate.** The English gloss is added by code, from a fixed
glossary, so it is the same every time. A title you translate by hand will not
match the next screenshot's.

**3. Write two files** in a scratch directory:

| File | Shape |
|---|---|
| `screenshots.json` | `[{screenshot_id, file_name, taken_on, drive_url}]` — `taken_on` as `YYYY-MM-DD`, used as the anchor when a row's year is missing |
| `events.json` | `{screenshot_id: {events: [ ...rows from step 2... ], week_of}}` |

Every screenshot needs an entry in `events.json`, including ones you read
nothing from. An empty list is a normal outcome; a missing key is a bug.

**4. Pull what the calendar already has.** `Google_Calendar:list_events` over
the range the screenshots cover, plus a few days either side. Write it as
`existing.json`: `[{id, summary, location, description, start, end}]`.

Every one of those fields is load-bearing. `description` carries the dedupe
ref. `start`, `end`, `summary` and `location` are what the planner compares
against to tell an entry that has not changed from one that has been moved —
drop them and a rescheduled match reads as unchanged and never reaches the
calendar. Copy `start` and `end` exactly as Google returns them, offset and
all; do not reformat them.

**5. Plan.**

```bash
python3 tools/pocket-to-todoist/plan_calendar.py \
  --screenshots screenshots.json --events events.json \
  --existing existing.json --out calendar-plan.json
```

Exit status 2 means some rows need review. That is information, not a failure —
carry on to step 6 and report them in step 7.

**6. Create and move.** Two buckets, and both must be handled:

- `calendar-plan.json["create"]` → `Google_Calendar:create_event`, taking
  `summary`, `description`, `location`, `start` and `end` **verbatim**.
- `calendar-plan.json["update"]` → `Google_Calendar:update_event`, passing
  `event_id` as the event to change, with the same fields verbatim. These are
  entries already on the calendar whose time, title or venue has changed on the
  reprinted schedule. Skipping them is how a rescheduled match stays wrong.

The `start`/`end` objects already carry `timeZone`; send them as they are and
never substitute a UTC conversion of your own. Generate the arguments with a
script that reads `calendar-plan.json`.

**7. Report** in two or three sentences: screenshots read, events created,
events **moved** (say what changed — "Friday's match moved 19:00 → 20:00"),
duplicates suppressed, and — always, in full — anything under `needs_review`
with the reason. A row held back is the one thing Max has to see, because it is
the one thing that will not appear in his calendar.

## Never

- Never file a row whose date you could not read. `needs_review` exists for it.
- Never skip the `update` bucket, and never turn an update into a new event.
- Never drop `printed_day` when the schedule shows one.
- Never convert a time into UTC yourself, or change `timeZone`.
- Never translate a title, or "tidy up" the Turkish.
- Never create an event for something that is not a commitment at a time — a
  note in the margin of a schedule is not a calendar entry.
