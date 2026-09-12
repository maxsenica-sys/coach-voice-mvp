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
