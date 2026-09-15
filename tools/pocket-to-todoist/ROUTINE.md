# Running it daily without a computer

The vault is on an iPhone, so there is no machine to install `run.py` on. The
pipeline instead runs inside a Claude session that holds the Pocket and Todoist
connectors. No computer, no API tokens, no vault access, and nothing to paste.

`plan.py` is the part that must not improvise: dates, routing, priority,
descriptions and duplicate suppression. The session is the courier that carries
transcripts in and task payloads out. The procedure it follows lives in
`.claude/skills/pocket-to-todoist/SKILL.md`, which is the single source of
truth — this file does not repeat it.

## Three ways to set it off

**Say "run it".** The skill's description covers "run it", "run my AI
programs", "process my voice notes" and similar, so a plain sentence in any
session on this repo is enough.

**Type `/run-it`.** The slash command in `.claude/commands/run-it.md`, for when
you want to be unambiguous.

**Say nothing.** A daily Routine at 04:00 UTC wakes the session and runs it.

## About the Routine

It is bound to an existing session rather than starting a fresh one each time,
and that is deliberate. A Routine created from inside Claude Code cannot attach
connectors on this account; a fresh session would therefore fire with no Pocket
and no Todoist tools and quietly do nothing. Waking a session that already holds
those connectors sidesteps that.

The cost is that the Routine is only as durable as the session it is bound to.
If daily tasks stop appearing, that binding is the first thing to check, and
saying "run it" always works regardless.

## Why the skill says "verbatim" so often

Because it was got wrong on the first real run. Four of the first five tasks
were created with a hand-typed `ref:` that did not match the one `plan.py` had
computed. Nothing looked broken: the tasks were correct and the descriptions
read properly. The next run would quietly have created all four a second time.

The refs were corrected, and the instruction now says to generate the tool
arguments from `plan.json` with a script. A courier that retypes the parcel is
not a courier.

## The lookback window

Four days, with duplicate suppression doing the rest. A watermark would be
tighter, but it needs somewhere durable to live, and the whole point of this
shape is that there is nowhere durable except Todoist itself. Re-reading a few
days of recordings costs a little extra work and cannot produce a duplicate.

## The schedule screenshots

The same shape, a different inbox. `screenshot-to-calendar` reads new images
from the `Calendar Inbox` folder in Google Drive and files them into Google
Calendar in Istanbul time. Say "do the schedule", type `/schedule`, or let a
Routine fire.

Drive rather than the vault, for the reason this whole file exists: a scheduled
session cannot read an iPhone. Drive is the only inbox where both ends are
reachable without a computer.

A Routine for it has the same constraint as the Pocket one and then some — it
needs the Drive **and** Calendar connectors, so it must be bound to a session
that already holds them rather than starting fresh. Create it from the session
you normally run these in; a Routine created elsewhere will fire with no
connectors and quietly do nothing, which looks identical to there being no new
schedules.

Unlike the Pocket run, this one can end with work outstanding. Rows whose date
contradicts the day printed beside them are held back rather than filed, and
`plan_calendar.py` exits 2 when that happens. Those rows are the one thing worth
reading in the report — everything else either landed or was already there.
