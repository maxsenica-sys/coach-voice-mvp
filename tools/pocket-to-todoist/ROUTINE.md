# Running it daily without a computer

The vault is on an iPhone, so there is no machine to install `run.py` on. The
pipeline instead runs as a scheduled Claude session with the Pocket and Todoist
connectors attached, which needs no computer, no API tokens and no vault access.

`plan.py` is the part that must not improvise: dates, routing, priority,
descriptions and duplicate suppression. The session is only the courier that
carries transcripts in and task payloads out.

## Set it up

A Routine created from inside a Claude Code session cannot carry connectors on
this account, so it has to be created in the **Routines UI on claude.ai**, where
it can. Create one with:

- **Schedule:** daily. `03:00 UTC` is a reasonable default; pick whatever hour
  suits, as long as it is after the day's recordings have synced.
- **Connectors:** Pocket and Todoist. Without both, the run cannot do anything.
- **Repository:** this one, so `plan.py` is on disk.
- **Prompt:** everything below the line.

---

Run the Pocket → Todoist pipeline. Work only from the tools; do not ask the user anything.

The code is in this repo at `tools/pocket-to-todoist/`. Read `pocket_todoist/prompt.py` FIRST and follow its SYSTEM prompt exactly when deciding what is an action. That prompt is the spec: most of a voice note is thinking aloud, and only genuine commitments become tasks. When a sentence is ambiguous it is NOT an action.

Steps:

1. Pocket: call search_pocket_conversations with recordingDateAfter set to 4 days ago. Page through until meta.hasMore is false. Large results get saved to a file; use jq on that file rather than printing transcripts.

2. Todoist: call find-tasks with labels ["Pocket"] (limit 100) to get every task this pipeline has already made. Call find-projects for the project ids.

3. Write four JSON files in a scratch directory:
   - recordings.json: [{recording_id, title, date (YYYY-MM-DD), transcript}]
   - extractions.json: {recording_id: {action_items:[{title, context, owner, owner_name, due_phrase, priority, topic}], ideas:[], notes:[], decisions:[]}}
     You produce this yourself by reading each transcript and applying prompt.py's SYSTEM prompt. Copy the speaker's own time words into due_phrase ("tomorrow", "Friday", "next week", "before training"). Never convert them to a date; plan.py does that.
   - existing.json: [{id, content, description}] from step 2
   - projects.json: [{id, name}] from step 2

4. Run:
   python3 tools/pocket-to-todoist/plan.py --recordings recordings.json \
     --extractions extractions.json --existing existing.json \
     --projects projects.json --out plan.json

5. Create each task in plan.json["create"] with the Todoist add-tasks tool, in batches. Copy content, description, projectId, labels, priority (use the priorityLabel field) and dueString VERBATIM from plan.json. Do not retype or re-word them. The description contains a `ref:` line that prevents duplicates on every future run, so a mistyped description silently breaks dedupe. Generate the tool arguments from plan.json with a script rather than by hand.

6. Report in two or three sentences: how many recordings, how many tasks created, how many suppressed as duplicates. If plan.json has nothing to create, say so and stop; that is the normal outcome on a quiet day.

Never send a transcript into a Todoist task. Obsidian keeps the full note; Todoist gets only the action and its context.

---

## Why step 5 says "verbatim" twice

Because it was got wrong on the first real run. Four of the first five tasks
were created with a hand-typed `ref:` that did not match the one `plan.py` had
computed. Nothing looked broken: the tasks were correct, the descriptions read
properly, and the next run would quietly have created all four a second time.

The refs were corrected, and the instruction now says to generate the tool
arguments from `plan.json` with a script. A courier that retypes the parcel is
not a courier.

## The lookback window

Four days, with duplicate suppression doing the rest. A watermark would be
tighter, but it needs somewhere durable to live, and the whole point of this
shape is that there is nowhere durable except Todoist itself. Re-reading a few
days of recordings costs a little extra work and cannot produce a duplicate.
