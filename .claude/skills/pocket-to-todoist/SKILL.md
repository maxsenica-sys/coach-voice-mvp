---
name: pocket-to-todoist
description: Run the Pocket to Todoist pipeline. Reads new Pocket voice recordings, works out which sentences are real commitments, and creates only those as Todoist tasks with due dates, labels and a link back to Obsidian. Use whenever Max says "run it", "run the pipeline", "run my AI programs", "do the daily run", "process my voice notes", "check Pocket", or asks for new voice notes to be turned into tasks.
allowed-tools: Bash, Read, Write, Grep, Glob
---

# Pocket → Todoist

Obsidian keeps the whole note. Todoist gets only the actions.

Run this whole thing without asking Max anything. He has already approved it;
stopping halfway to confirm defeats the point. Report at the end, briefly.

## What you must not improvise

`tools/pocket-to-todoist/plan.py` decides dates, projects, labels, priorities,
descriptions and duplicate suppression. You decide **only** which sentences are
commitments. Do not compute a due date yourself, do not invent a project, and
do not retype a description.

That last one is not a style note. On the first real run four of five tasks were
created with a hand-typed `ref:` that did not match the computed one. Nothing
looked wrong, and every one of them would have been silently duplicated the next
day. Build the tool arguments from `plan.json` with a script, always.

## Steps

**1. Read the rules.** Open `tools/pocket-to-todoist/pocket_todoist/prompt.py`
and follow its `SYSTEM` prompt when deciding what counts as an action. It is the
spec. Most of a voice note is thinking aloud. When a sentence is ambiguous it is
not an action.

**2. Pull recent recordings.** `search_pocket_conversations` with
`recordingDateAfter` set to four days ago. Page until `meta.hasMore` is false,
passing `meta.nextRecordingDateBeforeExclusive` back as
`recordingDateBeforeExclusive`. Big results get written to a file: use `jq` on
it rather than printing transcripts into the conversation.

**3. Pull what Todoist already has.** `find-tasks` with labels `["Pocket"]` and
limit 100, and `find-projects` for the ids.

**4. Write four files** in a scratch directory:

| File | Shape |
|---|---|
| `recordings.json` | `[{recording_id, title, date, transcript}]`, date as `YYYY-MM-DD` |
| `extractions.json` | `{recording_id: {action_items, ideas, notes, decisions}}` |
| `existing.json` | `[{id, content, description}]` from step 3 |
| `projects.json` | `[{id, name}]` from step 3 |

Each action item is `{title, context, owner, owner_name, due_phrase, priority,
topic}`. Copy the speaker's own time words into `due_phrase` — "tomorrow",
"Friday", "next week", "before training" — and never convert them to a date.
Leave it empty when he said nothing about timing.

Every recording needs an entry in `extractions.json`, including the ones with
nothing in them. An empty note is a normal outcome; a missing one is a bug.

**5. Plan.**

```bash
python3 tools/pocket-to-todoist/plan.py \
  --recordings recordings.json --extractions extractions.json \
  --existing existing.json --projects projects.json --out plan.json
```

**6. Create.** For each entry in `plan.json["create"]`, call Todoist
`add-tasks` in batches of up to 25, taking `content`, `description`,
`projectId`, `labels`, `priorityLabel` (as `priority`) and `dueString`
**verbatim**. Generate the arguments with a script that reads `plan.json`.

**7. Report** in two or three sentences: recordings seen, tasks created,
duplicates suppressed, and anything that looked like a real commitment but was
too ambiguous to file. If nothing was created, say so. On a quiet day that is
the correct answer, not a failure.

## Never

- Never put a transcript, or a long slab of one, into a Todoist task.
- Never create a task for an idea, an observation, or something already done.
- Never re-run `plan.py` output twice without refreshing `existing.json` first.
