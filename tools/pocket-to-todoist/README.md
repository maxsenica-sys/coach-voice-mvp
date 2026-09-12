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

**`plan.py` is the one in use today**, because of the iPhone. See
[ROUTINE.md](ROUTINE.md) for the daily schedule. `run.py` is the better shape
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

- **A new destination** — Google Calendar for things that are really
  appointments, a reminder service — is a class in `pocket_todoist/sinks/`
  implementing `prepare` / `known_refs` / `accepts` / `emit`, added to the list
  in `run.py`. The pipeline does not change.
- **Completion syncing back to Obsidian** reads the `ref:` values that are
  already written into every task description and ticks the matching checkbox in
  the note's block. Nothing new needs storing to make it possible.
- **Better classification** is a prompt change in `pocket_todoist/prompt.py`,
  pinned by a golden file so the diff is reviewable.

## Tests

```bash
python3 tests/run_tests.py            # 123 checks, no network, ~0.3s
python3 tests/run_tests.py --update-golden   # after a deliberate prompt change
```

Four rigs: dates (nine timezones, every day of a year), the pinned prompt,
plumbing (routing, dedupe, vault splicing), and the whole pipeline against a
temporary vault and a fake Todoist.

Each check was verified by breaking the code on purpose and watching that
specific check go red — eleven deliberate bugs, eleven caught, including a
dropped timezone conversion, a hardcoded 30-day month, an unstable dedupe ref,
frontmatter rewritten wholesale, and the full transcript being sent to Todoist.

A check that has never failed is not known to work.
