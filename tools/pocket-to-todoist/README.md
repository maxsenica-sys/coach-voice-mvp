# Pocket → Obsidian → Todoist

Watches the Obsidian vault for new Pocket notes, works out which sentences are
actually commitments, and sends only those to Todoist. Everything else — the
ideas, the observations, the decisions, the full transcript — stays in Obsidian,
where it already lives.

```
Pocket  →  Obsidian (the complete note)  →  parser  →  Todoist (tasks only)
                   ↑                                        │
                   └──────── link back in every task ───────┘
```

## What was already there

Worth knowing before changing anything: Todoist already contains a working
version of this idea. The projects say so themselves —

> *Actions*: "Things Max does. Written by the Pocket → Todoist → Obsidian
> nightly pipeline (`.automation/run.py` in the Second Brain vault)."
>
> *Waiting On*: "Things others committed to, that Max needs to chase."

Twenty-two tasks were written by it on 2026-09-07, and they are good: owners
separated, three near-identical items merged into one, one task corrected for a
transcript that described the other party's commitment in Max's voice.

It has not run since. Pocket has recorded sixteen conversations since that date
and none of them produced a task, so whatever schedules `.automation/run.py` is
not firing.

This tool is built to **fit that system, not replace it**:

- The **Actions / Waiting On** split is kept, because it is the split that
  decides what gets done in the morning, and it already exists.
- Every due date carries a **time as well as a date**, for the reason the
  existing project description gives: Todoist Free only sends an automatic
  reminder when both are set.
- Tasks are stamped with a **dedupe ref**, so running this alongside the older
  pipeline, or re-running it, cannot produce the same task twice.

`.automation/run.py` lives inside the vault and is not in this repository, so it
has not been read or modified. If it is still scheduled somewhere, see
*Running both* below.

## Two ways to run it

The vault is on an iPhone, so there is no computer to watch a folder on. That
splits the tool in two, sharing one tested core:

| | `run.py` | `plan.py` |
|---|---|---|
| Reads | the vault, on disk | transcripts handed to it as JSON |
| Talks to Todoist | itself, over REST | no: it emits task payloads |
| Needs | a computer with the vault, and two API tokens | nothing |
| Marks the note processed in Obsidian | yes | no: it cannot reach the vault |
| Runs where | a Mac or laptop | a scheduled Claude session |

**`plan.py` is the one in use today**, because of the iPhone. It is driven by
the `pocket-to-todoist` skill: say "run it", type `/run-it`, or let the daily
Routine fire. See [ROUTINE.md](ROUTINE.md). `run.py` is the better shape
and takes over the moment the vault is on a computer: it is the only one that
can write the extracted ideas and decisions back into the note.

Both get their dates, routing, priorities, descriptions and duplicate
suppression from the same modules and the same rigs. Only the transport differs.

### What the phone costs

One requirement cannot be met without a computer: **marking the note processed
inside Obsidian**. Nothing here can write to the vault, so "already handled" is
recorded in Todoist instead, as a `ref:` line in every task description. That is
durable and survives anything short of deleting the tasks, but the note itself
does not show that it was read. `plan.py` still produces the Obsidian block for
each note under `obsidian_blocks`, ready to paste in.

## Install

To run the vault watcher, on the machine where the vault lives:

```bash
cd tools/pocket-to-todoist
./install.sh              # config, dependencies, a connectivity check
./install.sh --schedule   # the same, plus a launchd job every 15 minutes
```

Two tokens go in the environment, never in the config file:

```bash
export TODOIST_API_TOKEN=...   # Todoist → Settings → Integrations → Developer
export ANTHROPIC_API_KEY=...   # console.anthropic.com
```

## Running

```bash
./run.py --doctor              # is everything wired up?
./run.py --once --dry-run      # exactly what would happen, changing nothing
./run.py --once                # process everything outstanding
./run.py --watch               # stay running, pick up notes as they sync
./run.py --note "Jaden"        # one note, by title or path
```

`--dry-run` works before anything is configured, including without a Todoist
token — it just shows every task routed to Inbox, because without the account
there is no way to know which projects exist.

## What it does to a note

Given a note containing:

> Spoke with Jaden about Project V. Need to ask him if he wants the Head of
> Performance title. Also need to update the shoulder program page. I think
> athlete testing every six weeks could be a good idea.

Todoist gets two tasks. Obsidian keeps the idea:

```markdown
---
source: pocket
pocket_todoist:
  processed_at: 2026-09-12T11:40:03+10:00
  content_hash: 9f2c1a04bb7e4d51
  tasks: 2
---

...the original note, untouched...

<!-- pocket-todoist:start -->
## Extracted by Pocket → Todoist

### Actions sent to Todoist
- [ ] Ask Jaden about the Head of Performance title — *Actions* ([Todoist](...))
- [ ] Update the shoulder program page — *Actions* ([Todoist](...))

### Ideas
- Athlete testing every six weeks could be a good idea
<!-- pocket-todoist:end -->
```

Nothing else in the file is rewritten. Unknown frontmatter keys, formatting and
the transcript itself are passed through byte for byte, and re-running replaces
the block rather than stacking another copy.

Each Todoist task carries the label `Pocket`, a short imperative title, the
context needed to act on it, and a link back:

```
Kevin is waiting on confirmation before Friday's session.
Said: "tomorrow" on 2026-09-11.

Source: Chat with Jaden about Project V (2026-09-11)
Obsidian: obsidian://open?vault=Second%20Brain&file=Pocket%2F2026-09-11%20Session
ref: pkt-3f9a2c14bb
```

## Routing: why topics are labels

The requested routing was Project V / HPA / Coaching / Content / Volleyball /
Personal. Those are **labels**, not projects, and that is a constraint rather
than a preference: **Todoist Free allows five personal projects**, two are
already in use, and six more would not fit.

So routing runs in two layers:

| Layer | Decides | Becomes |
|---|---|---|
| Ownership | who owes it | the project — `Actions` or `Waiting On` |
| Topic | what it is about | a label — `@ProjectV`, `@HPA`, `@Content`, … |

Every task also gets `@Pocket`, so the whole pipeline's output is one filter.

If a project matching a topic ever exists, the router prefers it automatically
and the topic stops being a label. Upgrading the plan and creating a "Project V"
project is the entire migration; no config change is needed.

## Dates

Resolved **against the note's own date**, not the day the parser runs. A Monday
note saying "tomorrow" means Tuesday even if the run is three days late.

Handled: `today`, `tonight`, `tomorrow`, weekday names, `next Friday`,
`this week`, `next week`, `this weekend`, `next weekend`, `in three days`,
`end of the month`, `14 October`, `2026-12-01`.

Phrases with no inherent day — `before training`, `after training`,
`first thing` — are mapped in config under `due.phrase_map`. Change what
"before training" means there, not in the code.

Anything else gets **no due date at all**. A task with no date is right more
often than a task on the wrong day.

## Duplicates

Three independent layers, because each fails differently:

1. A `ref:` in every task description, derived from the note and the title —
   Todoist itself is the record of what exists.
2. A local state file, so the normal case costs no API calls.
3. A similarity check against titles already created from the same note, which
   catches the case the first two miss: an edited note re-analysed, where the
   model phrases the same commitment slightly differently.

Deleting the state file does not cause duplicates. Re-running with `--force`
does not cause duplicates. Editing a note creates only its genuinely new
actions.

## Running both this and `.automation/run.py`

Don't, for long. They would both write to Actions and Waiting On, and the older
pipeline's tasks carry no `ref:`, so layer 1 above cannot see them — only the
title-similarity layer would, and only within the same note.

If `.automation/run.py` is still scheduled, either disable it or point this one
at a different label while comparing the two.

## Extending it

The seams are already in place:

- **A new destination** is a class in `pocket_todoist/sinks/` implementing
  `prepare` / `known_refs` / `accepts` / `emit`, added to the list in `run.py`.
  The pipeline does not change. Google Calendar was the worked example in
  `sinks/base.py` and is now `sinks/calendar_sink.py` — see *Schedules* below.
- **Completion syncing back to Obsidian** reads the `ref:` values that are
  already written into every task description and ticks the matching checkbox in
  the note's block. Nothing new needs storing to make it possible.
- **Better classification** is a prompt change in `pocket_todoist/prompt.py`,
  pinned by a golden file so the diff is reviewable.

## Schedules: a screenshot into the calendar

A training schedule is printed on a wall in Turkish, photographed, and has to
end up in Google Calendar in Turkish time. That is a different problem from the
voice notes, and it gets its own path:

```
a screenshot in Drive  ->  [ the session reads it ]  ->  events.json
events.json            ->  [ plan_calendar.py ]     ->  calendar-plan.json
calendar-plan.json     ->  [ the session creates ]  ->  Google Calendar
```

Same split as `plan.py`, for the same reason: the session is a courier that
reads the image, and every decision that must be deterministic happens in a
script with no network and no credentials. The procedure lives in
`.claude/skills/screenshot-to-calendar/SKILL.md`; say "do the schedule" or type
`/schedule`.

Drop screenshots in a Google Drive folder called `Calendar Inbox`. Drive is not
a preference — it is the only inbox both ends of this can reach. The vault is on
an iPhone and no scheduled session can read it, so a screenshot filed in
Obsidian stays in Obsidian.

### Reading Turkish

`pocket_todoist/schedule.py` handles the language. Three things there are not
obvious and each comes from a way this fails quietly:

**Turkish text is folded, never lowercased.** `"SALI".lower()` is `"sali"` and
`"Salı".lower()` is `"salı"`, which do not compare equal. A schedule printed in
capitals — which is most of them — therefore matches nothing at all, while
looking entirely healthy in the logs. `fold()` is the only sanctioned
normaliser.

**Day names match on whole words, longest first.** "Pazar" (Sunday) is a prefix
of "Pazartesi" (Monday) and "Cuma" (Friday) of "Cumartesi" (Saturday) — the same
bug class as the name test that matched "Ana" inside "Anastasia", and here it
moves every Monday session to Sunday.

**Dates are day-first, always.** `09.10` is the ninth of October. There is no
reading of a Turkish schedule where `MM/DD` is correct, so it is never tried.

Titles keep the Turkish and gain an English gloss — `Antrenman (training)` —
from a fixed glossary, so the calendar is readable without ceasing to match the
schedule on the wall. The glossary is a dict in `schedule.py`; adding a word is
a one-line change.

### The weekday cross-check

The guard worth understanding, because it is the one that will actually fire.
A schedule is a grid, and the way a reader misreads a grid is by taking the row
above or below — which changes the date while leaving the title, the time and
the location all perfectly correct. Nothing downstream can detect that.

So the session copies the printed day label verbatim (`SALI`), and the planner
confirms the date it was given really is a Tuesday. If it is not, the row goes
to `needs_review` and is reported, never filed. `plan_calendar.py` exits 2 when
anything needs review, so a partial import cannot pass silently.

**Nothing here invents a date.** A row with no readable date is reported, not
placed on a plausible day. An empty calendar is a visible problem; Tuesday's
session sitting confidently on Wednesday is not, and he plans his week on it.

### Timezone

`calendar.timezone` is `Europe/Istanbul` and is deliberately **not** the
top-level `timezone`, which is `Australia/Brisbane` and belongs to the Todoist
pipeline. A session at 19:00 in Istanbul is not 19:00 in Brisbane and one
setting cannot be both.

It is a named zone, never an offset. Turkey has had no DST since 2016 and could
rejoin it; a hardcoded `+03:00` would be wrong the day it did. Every event sent
to Google carries its `timeZone` explicitly, because Google reads a naive
`dateTime` in the calendar's own default — a silent way to file an Istanbul
evening session at an Australian one.

### Duplicates

An entry is identified by date, title and its occurrence among same-named
entries that day, in the `pkc-` ref namespace — separate from the tasks' `pkt-`
for a reason worth reading in `dedupe.py`. Consequences:

- Re-uploading the same screenshot creates nothing. Existing events are
  *compared*, not merely detected — Google returns `19:00+03:00` where a
  planned event carries a naive local time and a separate zone, and those are
  resolved to instants before comparison rather than matched as strings.
- A **corrected time** moves the existing event rather than adding a second one
  beside it, because the ref does not depend on the time. It lands in the
  plan's `update` bucket with the calendar's own event id. An earlier draft
  suppressed it instead, on the grounds that the ref was already present —
  which meant a rescheduled match never reached the phone. That is now a
  check, because it is the most expensive thing this could get wrong.
- Two sessions with the same name on one day stay two events.
- Adding an entry does not renumber differently-named ones, so nothing is
  rewritten that did not change.

### Known gaps

Stated because a green run should never be mistaken for coverage it lacks:

- **A deleted session is not removed.** The planner only creates. If a session
  is cancelled on the printed schedule, the calendar keeps it.
- **A renamed session becomes a second event.** The ref is built from the
  title, so `Antrenman` becoming `Kondisyon` reads as a new entry, not a
  changed one — the old one stays. A title change and a time change are not
  distinguishable from a reprint without something stabler than a title to key
  on, and a printed schedule offers nothing.
- **Nothing reads the image but the session.** There is no OCR here and no
  fixture of a real screenshot, so the rig proves what happens to rows *after*
  they are read, not that they were read correctly. The weekday cross-check is
  the only thing standing between a misread grid and the calendar.
- **`run.py`'s calendar sink is unexercised in practice.** It is tested against
  a fake, but the vault is still on a phone, so the path that would use it does
  not run.

## Tests

```bash
python3 tests/run_tests.py            # 265 checks, no network, ~0.4s
python3 tests/run_tests.py --update-golden   # after a deliberate prompt change
```

Six rigs: dates (nine timezones, every day of a year), the pinned prompt,
plumbing (routing, dedupe, vault splicing), the whole pipeline against a
temporary vault and a fake Todoist, the phone path, and the Turkish schedule
reader against a fake calendar.

Each check was verified by breaking the code on purpose and watching that
specific check go red — twenty-four deliberate bugs, twenty-four caught,
including a dropped timezone conversion, a hardcoded 30-day month, an unstable
dedupe ref, frontmatter rewritten wholesale, the full transcript being sent to
Todoist, a Turkish day name lowercased instead of folded, and a calendar ref
that read back as the task ref it was derived from.

Three of those were found by running the thing rather than by writing a test:
the `-cal` ref suffix that `refs_in` silently truncated, a docstring that
credited the wrong mechanism for keeping "Pazar" out of "Pazartesi", and a
rescheduled match that was suppressed as a duplicate instead of moved. The
last one passed every test that existed at the time and was caught by reading
the output of an end-to-end run. That is the reason the exercise is not
optional, and the reason a rig is not a substitute for running it once.

A check that has never failed is not known to work.
