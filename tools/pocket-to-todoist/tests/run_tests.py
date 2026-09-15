#!/usr/bin/env python3
"""Four rigs that run the code instead of type-checking it.

    python3 tests/run_tests.py
    python3 tests/run_tests.py --update-golden

| Rig      | What it runs                          | The bug class it exists for |
|----------|---------------------------------------|-----------------------------|
| dates    | The real resolver, 9 timezones, every | Anything that divides ms by |
|          | day of a year                         | 86,400,000, or assumes DST  |
|          |                                       | does not exist              |
| prompt   | The pinned extraction prompt          | A silent edit to the text   |
|          |                                       | that decides what is a task |
| plumbing | Routing, dedupe, vault splicing       | A task filed where he will  |
|          |                                       | not look; a second copy of  |
|          |                                       | a task; eaten frontmatter   |
| pipeline | The whole thing against a temp vault  | The run that marks a note   |
|          | and a fake Todoist                    | done having created nothing |

Every assertion here was verified by breaking the code on purpose and watching
that specific check go red. A check that has never failed is not known to work.

This file drops the package's __pycache__ before importing anything. Editing a
constant to another value of the same byte length, twice inside one second,
leaves Python serving a stale .pyc -- which looks exactly like a rig that failed
to notice the change. That happened twice while calibrating the similarity
threshold below, and produced a confidently wrong conclusion both times. A rig
you cannot trust while deliberately breaking things is not a rig.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import sys
import tempfile
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

# Before any import of the package under test. See the module docstring.
sys.dont_write_bytecode = True
for _cache in pathlib.Path(os.path.dirname(HERE)).rglob("__pycache__"):
    shutil.rmtree(_cache, ignore_errors=True)

from pocket_todoist import config as config_module  # noqa: E402
from pocket_todoist import dedupe, extract, pipeline, prompt, routing, schedule, vault  # noqa: E402
from pocket_todoist.dates import resolve_due  # noqa: E402
from pocket_todoist.sinks.calendar_sink import CalendarSink  # noqa: E402
from pocket_todoist.sinks.todoist_sink import TodoistSink  # noqa: E402

import plan as plan_module  # noqa: E402
import plan_calendar as plan_calendar_module  # noqa: E402

GOLDEN = os.path.join(HERE, "fixtures", "golden-prompt.txt")

FAILURES = []
CHECKS = [0]


def check(name, condition, detail=""):
    CHECKS[0] += 1
    if not condition:
        # Coerced, because a rig that crashes while reporting a failure hides
        # every failure after it.
        suffix = f" -- {detail}" if detail else ""
        FAILURES.append(f"{name}{suffix}")


def equal(name, actual, expected):
    check(name, actual == expected, f"got {actual!r}, expected {expected!r}")


# --- Rig 1: dates ------------------------------------------------------------

TIMEZONES = [
    "Australia/Brisbane",   # where Max is. No DST, which is why it hides bugs.
    "Australia/Sydney",     # same country, DST -- the pair that catches it
    "Europe/London",
    "Europe/Amsterdam",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Tokyo",
    "Pacific/Auckland",
    "UTC",                  # what CI runs in, and therefore proves nothing alone
]

DUE_CASES = [
    # anchor 2026-09-09 is a Wednesday.
    ("today", date(2026, 9, 9), "08:00:00"),
    ("tonight", date(2026, 9, 9), "18:00:00"),
    ("tomorrow", date(2026, 9, 10), "08:00:00"),
    ("tomorrow evening", date(2026, 9, 10), "18:00:00"),
    ("the day after tomorrow", date(2026, 9, 11), "08:00:00"),
    ("friday", date(2026, 9, 11), "08:00:00"),
    ("on wednesday", date(2026, 9, 9), "08:00:00"),      # today is Wednesday
    ("next wednesday", date(2026, 9, 16), "08:00:00"),
    ("next week", date(2026, 9, 14), "08:00:00"),        # the coming Monday
    ("this week", date(2026, 9, 11), "08:00:00"),        # the coming Friday
    ("this weekend", date(2026, 9, 12), "08:00:00"),
    ("next weekend", date(2026, 9, 19), "08:00:00"),
    ("in 3 days", date(2026, 9, 12), "08:00:00"),
    ("in two weeks", date(2026, 9, 23), "08:00:00"),
    ("before training", date(2026, 9, 9), "08:00:00"),   # via phrase_map
    ("after training", date(2026, 9, 9), "18:00:00"),    # phrase_map + evening cue
    ("end of the month", date(2026, 9, 30), "08:00:00"),
    ("2026-12-01", date(2026, 12, 1), "08:00:00"),
    ("14 October", date(2026, 10, 14), "08:00:00"),
    ("", None, None),
    ("sometime", None, None),
    ("when I get a chance", None, None),
]


def rig_dates():
    config = config_module.DEFAULTS["due"]
    anchor = date(2026, 9, 9)

    for phrase, expected_day, expected_time in DUE_CASES:
        due = resolve_due(phrase, anchor, config)
        if expected_day is None:
            check(f"dates: {phrase!r} yields no due date", due is None,
                  f"got {due}")
            continue
        if due is None:
            check(f"dates: {phrase!r}", False, "resolved to nothing")
            continue
        equal(f"dates: {phrase!r} day", due.on, expected_day)
        equal(f"dates: {phrase!r} time", due.at.strftime("%H:%M:%S"), expected_time)

    # A phrase with no day must never be invented into one. This is the check
    # that keeps a rambling note from filling the calendar.
    for phrase in ["I should probably get to it", "at some point", "the shoulder program"]:
        check(f"dates: no date invented for {phrase!r}",
              resolve_due(phrase, anchor, config) is None)

    # Month-end arithmetic, including the leap day, without a day count anywhere.
    for anchor_day, expected in [(date(2026, 2, 3), date(2026, 2, 28)),
                                 (date(2024, 2, 3), date(2024, 2, 29)),
                                 (date(2026, 4, 30), date(2026, 4, 30)),
                                 (date(2026, 12, 5), date(2026, 12, 31))]:
        due = resolve_due("end of the month", anchor_day, config)
        # Guarded rather than dotted into: when this rule breaks it tends to
        # break by returning nothing, and a rig that crashes reports one bug
        # instead of the whole list.
        check(f"dates: end of month from {anchor_day}",
              due is not None and due.on == expected,
              f"got {due.on if due else None}, expected {expected}")

    # Every day of a year, in every timezone: "tomorrow" is exactly one day
    # later, and the UTC stamp sent to Todoist converts back to the same wall
    # clock time. In a DST zone, one day in October is 23 or 25 hours long, and
    # a pipeline doing this arithmetic in seconds files that day's task at the
    # wrong time -- in UTC, where CI runs, it never does.
    day = date(2026, 1, 1)
    drift = []
    while day < date(2027, 1, 1):
        tomorrow = resolve_due("tomorrow", day, config)
        if tomorrow.on != day + timedelta(days=1):
            drift.append(f"tomorrow from {day} gave {tomorrow.on}")
        for tz_name in TIMEZONES:
            stamp = tomorrow.utc_datetime(tz_name)
            back = (datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%S.%f%z")
                    .astimezone(ZoneInfo(tz_name)))
            if (back.date(), back.strftime("%H:%M")) != (tomorrow.on, "08:00"):
                drift.append(f"{tz_name} {day}: {stamp} came back as {back}")
        day += timedelta(days=1)
    check("dates: 365 days x 9 timezones round-trip", not drift,
          "; ".join(drift[:3]))


# --- Rig 2: the prompt -------------------------------------------------------

def rig_prompt(update=False):
    rendered = (
        prompt.SYSTEM
        + "\n\n=== SCHEMA KEYS ===\n"
        + "\n".join(sorted(prompt.SCHEMA["properties"]["action_items"]["items"]["properties"]))
        + "\n\n=== USER MESSAGE ===\n"
        + prompt.build_user_message(
            "Coaching with Wyatt", "2026-09-09",
            [("Coaching", "sessions, technique"), ("Content", "instagram, reels")],
            "TRANSCRIPT GOES HERE")
    )
    if update:
        os.makedirs(os.path.dirname(GOLDEN), exist_ok=True)
        with open(GOLDEN, "w", encoding="utf-8") as handle:
            handle.write(rendered)
        print(f"Golden prompt rewritten: {GOLDEN}")
        return

    try:
        with open(GOLDEN, "r", encoding="utf-8") as handle:
            pinned = handle.read()
    except FileNotFoundError:
        check("prompt: golden file exists", False,
              "run tests/run_tests.py --update-golden")
        return
    check("prompt: matches the pinned golden file", rendered == pinned,
          "the prompt changed -- review the diff, then --update-golden")

    # Properties the downstream code depends on, stated so they cannot be
    # quietly dropped by a rewrite.
    check("prompt: tells the model not to resolve dates",
          "do not convert them" in prompt.SYSTEM.lower())
    check("prompt: distinguishes ideas from actions",
          "idea" in prompt.SYSTEM.lower() and "not actions" in prompt.SYSTEM.lower())
    check("prompt: an empty action list is allowed",
          "empty action list" in prompt.SYSTEM.lower())
    required = prompt.SCHEMA["properties"]["action_items"]["items"]["required"]
    for field in ("title", "owner", "due_phrase", "priority", "topic"):
        check(f"prompt: schema requires {field}", field in required)
    check("prompt: schema is closed",
          prompt.SCHEMA["additionalProperties"] is False)


# --- Rig 3: plumbing ---------------------------------------------------------

WORKED_EXAMPLE_1 = (
    "Spoke with Jaden about Project V. Need to ask him if he wants the Head of "
    "Performance title. Also need to update the shoulder program page. I think "
    "athlete testing every six weeks could be a good idea.")

WORKED_EXAMPLE_2 = (
    "Tomorrow I need to message Kevin about Friday training. I also need to "
    "finish the HPA testing document sometime next week.")


def rig_plumbing():
    config, _ = config_module.load()

    # -- routing
    action = extract.Action(title="Post the reel", owner="me", topic="Content")
    decision = routing.route(action, {"actions": "1", "inbox": "9"}, config)
    equal("routing: no Content project -> Actions", decision.project_name, "Actions")
    check("routing: Pocket label always applied", "Pocket" in decision.labels)
    check("routing: topic becomes a label", "Content" in decision.labels)

    decision = routing.route(action, {"actions": "1", "content": "7"}, config)
    equal("routing: a real Content project wins", decision.project_name, "Content")
    equal("routing: and it uses that project's id", decision.project_id, "7")

    waiting = extract.Action(title="Send the footage", owner="other",
                             owner_name="Dan", topic="Coaching")
    decision = routing.route(waiting, {"actions": "1", "waiting on": "2"}, config)
    equal("routing: other people's tasks go to Waiting On",
          decision.project_name, "Waiting On")

    orphan = extract.Action(title="Something", owner="me", topic="unknown")
    decision = routing.route(orphan, {}, config)
    equal("routing: nothing configured exists -> Inbox", decision.project_name, "Inbox")

    equal("routing: urgent maps to Todoist p1",
          routing.route(extract.Action(title="x", priority="urgent"), {}, config).priority, 4)
    equal("routing: low maps to Todoist p4",
          routing.route(extract.Action(title="x", priority="low"), {}, config).priority, 1)

    # -- dedupe
    ref_a = dedupe.ref_for("Pocket/note.md", "Message Kevin about Friday training")
    ref_b = dedupe.ref_for("Pocket/note.md", "message kevin about friday training.")
    equal("dedupe: ref ignores case and punctuation", ref_a, ref_b)
    check("dedupe: a different note gives a different ref",
          dedupe.ref_for("Pocket/other.md", "Message Kevin") != ref_a)
    check("dedupe: refs are findable in a description",
          dedupe.refs_in(f"blah\nref: {ref_a}\n") == {ref_a})

    check("dedupe: a re-phrasing is caught",
          dedupe.is_near_duplicate("Message Kevin re Friday training",
                                   ["Message Kevin about Friday training"]))
    check("dedupe: two genuinely different errands are kept apart",
          not dedupe.is_near_duplicate(
              "Send Dan the gym program",
              ["Send Wyatt the spike timing rhyme", "Update the shoulder page"]))

    # Real pairs from the day a second pipeline wrote the same commitments in
    # different words. The threshold is calibrated on exactly these.
    for ours, theirs in [
        ("Send Jack footwork drills for his passing", "Send Jack the footwork drills"),
        ("Send Nick his session recording and written summary",
         "Send Nick's session recording + summary to his parent"),
        ("Build Jack's six-week gym program", "Write Jack's 6-week gym program"),
        ("Set up a Google Drive folder for Jack's training videos",
         "Set up Google Drive folder for Jack's video uploads"),
        ("Speak with Vicky about setting up online work for Nick",
         "Speak with Vicky about online work for Nick"),
    ]:
        check(f"dedupe: catches the other pipeline's wording -- {theirs[:34]!r}",
              dedupe.is_near_duplicate(ours, [theirs]))

    # The pairs that must survive the lowered threshold. The first is the
    # closest false pair in the whole real set, at 0.63.
    for a, b in [
        ("Send the footwork and spiking drill material", "Send Jack the footwork drills"),
        ("Send Nick his session recording and written summary",
         "Send Jack his full session note (testing + technical)"),
        ("Speak with Vicky about setting up online work for Nick",
         "Vicky - decision on online coaching for Nick"),
        ("Build Jack's six-week gym program", "Build Nick's 6-week block to end of October"),
    ]:
        check(f"dedupe: still separates {a[:32]!r} from {b[:28]!r}",
              not dedupe.is_near_duplicate(a, [b]))

    # -- the four-way separation itself
    # The whole product is this split: actions leave, everything else stays.
    # Asserted on the backend directly so a regression names the category that
    # moved, rather than showing up as a mysteriously missing task.
    split = extract.HeuristicBackend().extract(
        "Mixed", "2026-09-09",
        "Spoke with Jaden about Project V. "
        "I need to update the shoulder program page. "
        "I think athlete testing every six weeks could be a good idea. "
        "We decided to run the clinic on Tuesday.",
        [("Project V", "project v")])
    check("split: the commitment is an action",
          any("shoulder program page" in a.title for a in split.action_items),
          [a.title for a in split.action_items])
    check("split: the speculation is an idea, not a note",
          any("six weeks" in i for i in split.ideas), split.ideas)
    check("split: the decision is a decision",
          any("Tuesday" in d for d in split.decisions), split.decisions)
    check("split: the background is a note",
          any("Spoke with Jaden" in n for n in split.notes), split.notes)
    check("split: nothing is filed in two places at once",
          len(split.action_items) + len(split.ideas)
          + len(split.decisions) + len(split.notes) == 4)

    # -- vault splicing
    raw = ("---\ntitle: Session\ntags: [pocket]\ncustom_field: keep me\n---\n"
           "# Session\n\nSome transcript.\n")
    with tempfile.TemporaryDirectory() as root:
        folder = os.path.join(root, "Pocket")
        os.makedirs(folder)
        path = os.path.join(folder, "2026-09-09 Session.md")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(raw)

        note = vault.load_note(path, root)
        equal("vault: date comes from the filename", note.on, date(2026, 9, 9))
        equal("vault: title comes from frontmatter", note.title, "Session")
        equal("vault: relative path is the note key", note.key, "Pocket/2026-09-09 Session.md")

        extraction = extract.Extraction(
            action_items=[], ideas=["test every six weeks"], notes=["spoke to Jaden"],
            decisions=[])
        summary = vault.render_summary(extraction, [
            {"title": "Ask Jaden about the title", "project": "Actions",
             "due": "2026-09-10T08:00:00", "url": "https://todoist.com/task/1"}])
        vault.write_back(note, summary, "pocket_todoist",
                         ["processed_at: now", "content_hash: abc", "tasks: 1"])

        with open(path, "r", encoding="utf-8") as handle:
            first = handle.read()
        check("vault: unknown frontmatter survives", "custom_field: keep me" in first)
        check("vault: the processed marker is written", "pocket_todoist:" in first)
        check("vault: the original transcript survives", "Some transcript." in first)
        check("vault: ideas are written into the note", "test every six weeks" in first)
        check("vault: the Todoist link is written into the note",
              "https://todoist.com/task/1" in first)

        # Writing twice must not stack two blocks -- this ran every night for a
        # year in an earlier life of this idea and left a note with 300 of them.
        note2 = vault.load_note(path, root)
        vault.write_back(note2, summary, "pocket_todoist",
                         ["processed_at: later", "content_hash: abc", "tasks: 1"])
        with open(path, "r", encoding="utf-8") as handle:
            second = handle.read()
        equal("vault: the summary block is replaced, not stacked",
              second.count(vault.BLOCK_START), 1)
        equal("vault: the processed marker is replaced, not stacked",
              second.count("pocket_todoist:"), 1)
        check("vault: the marker actually updated", "processed_at: later" in second)

        note3 = vault.load_note(path, root)
        check("vault: the summary is excluded from the next transcript",
              "Ask Jaden about the title" not in note3.transcript())
        check("vault: is_processed sees a matching hash",
              vault.is_processed(note3, "pocket_todoist", "abc"))
        check("vault: is_processed sees an edited note",
              not vault.is_processed(note3, "pocket_todoist", "different"))

    # -- detection
    match = config["vault"]["match"]
    match = dict(match, folders=["Pocket"])
    check("vault: a note in the Pocket folder is detected",
          vault.looks_like_pocket("Pocket/a.md", "", "", match))
    check("vault: a tagged note anywhere is detected",
          vault.looks_like_pocket("Inbox/a.md", "", "recorded #pocket today", match))
    check("vault: source: pocket frontmatter is detected",
          vault.looks_like_pocket("Inbox/a.md", "source: pocket", "", match))
    check("vault: an unrelated note is left alone",
          not vault.looks_like_pocket("Training/plan.md", "title: Plan",
                                      "a normal note", match))


# --- Rig 4: the pipeline end to end -----------------------------------------

class FakeTodoist:
    """Stands in for Todoist. Records what would have been created."""

    def __init__(self, projects=("Inbox", "Actions", "Waiting On")):
        self._projects = {name.lower(): str(i + 1) for i, name in enumerate(projects)}
        self.created = []
        self.labels_created = []

    def projects_by_name(self):
        return dict(self._projects)

    def ensure_label(self, name):
        self.labels_created.append(name)
        return "label-1"

    def tasks_with_label(self, label):
        return [{"id": t["id"], "description": t["description"]} for t in self.created]

    def create_task(self, content, description=None, project_id=None, labels=None,
                    priority=None, due_datetime=None):
        task = {"id": f"task-{len(self.created) + 1}",
                "url": f"https://todoist.com/showTask?id={len(self.created) + 1}",
                "content": content, "description": description or "",
                "project_id": project_id, "labels": labels or [],
                "priority": priority, "due_datetime": due_datetime}
        self.created.append(task)
        return task


def write_note(root, name, body, frontmatter="source: pocket"):
    folder = os.path.join(root, "Pocket")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(f"---\n{frontmatter}\n---\n{body}\n")
    return path


def run_pipeline(root, config, client, state, force=False, dry_run=False):
    notes = vault.discover(config)
    return pipeline.run(notes, config, extract.HeuristicBackend(), [TodoistSink(client)],
                        state, dry_run=dry_run, force=force)


def rig_pipeline():
    with tempfile.TemporaryDirectory() as root:
        config, _ = config_module.load()
        config["vault"]["path"] = root
        config["vault"]["name"] = "Second Brain"
        config["vault"]["state_file"] = os.path.join(root, "state.json")
        config["extract"]["backend"] = "heuristic"

        write_note(root, "2026-09-09 Jaden.md", WORKED_EXAMPLE_1)
        write_note(root, "2026-09-09 Kevin.md", WORKED_EXAMPLE_2)
        # A note with nothing actionable in it must produce no tasks at all.
        write_note(root, "2026-09-09 Ramble.md",
                   "The gym was busy today. Wyatt's platform looked better.")

        client = FakeTodoist()
        state = dedupe.StateStore(config["vault"]["state_file"])
        report = run_pipeline(root, config, client, state)

        titles = [t["content"] for t in client.created]
        equal("pipeline: three notes analysed", len(report.results), 3)
        equal("pipeline: four actions created", len(client.created), 4)

        check("pipeline: worked example 1 -- ask Jaden",
              any("Head of Performance title" in t for t in titles), titles)
        check("pipeline: worked example 1 -- shoulder program page",
              any("shoulder program page" in t for t in titles), titles)
        check("pipeline: the idea did NOT become a task",
              not any("six weeks" in t for t in titles), titles)
        check("pipeline: the observation did NOT become a task",
              not any("platform" in t.lower() for t in titles), titles)

        kevin = next((t for t in client.created if "Kevin" in t["content"]), None)
        check("pipeline: worked example 2 -- message Kevin exists", kevin is not None)
        if kevin:
            equal("pipeline: Kevin is due tomorrow (the day after the note)",
                  kevin["due_datetime"][:10],
                  # 2026-09-10 08:00 Brisbane is 2026-09-09 22:00 UTC
                  "2026-09-09")
            check("pipeline: every task carries the Pocket label",
                  all("Pocket" in t["labels"] for t in client.created))
            check("pipeline: the description links back to Obsidian",
                  "obsidian://open?vault=Second%20Brain" in kevin["description"])
            check("pipeline: the description carries a dedupe ref",
                  bool(dedupe.refs_in(kevin["description"])))
            check("pipeline: the transcript is NOT sent to Todoist",
                  "I also need to finish" not in kevin["description"],
                  kevin["description"])

        hpa = next((t for t in client.created if "HPA testing document" in t["content"]), None)
        check("pipeline: the HPA document task exists", hpa is not None)
        if hpa:
            equal("pipeline: 'next week' resolves to the following Monday",
                  hpa["due_datetime"][:10], "2026-09-13")  # Mon 14th, 08:00 AEST

        # The note on disk must now say it has been processed, and carry the
        # material that never left Obsidian.
        with open(os.path.join(root, "Pocket", "2026-09-09 Jaden.md"),
                  encoding="utf-8") as handle:
            jaden = handle.read()
        check("pipeline: the note is marked processed", "pocket_todoist:" in jaden)
        check("pipeline: the idea is kept in Obsidian", "six weeks" in jaden)

        # -- second run: nothing new
        before = len(client.created)
        report2 = run_pipeline(root, config, client, state)
        equal("pipeline: a second run creates nothing", len(client.created), before)
        equal("pipeline: and skips the notes as already done", report2.already_done, 3)

        # -- forced re-analysis: still nothing new, because the refs match
        report3 = run_pipeline(root, config, client, state, force=True)
        equal("pipeline: forcing a re-analysis still creates nothing",
              len(client.created), before)
        check("pipeline: and reports them as duplicates", report3.duplicate_count >= 4)

        # -- an edited note: only the genuinely new action is created
        write_note(root, "2026-09-09 Kevin.md",
                   WORKED_EXAMPLE_2 + " I also need to book the physio for Thursday.")
        run_pipeline(root, config, client, state)
        equal("pipeline: an edited note adds only its new action",
              len(client.created), before + 1)
        check("pipeline: and that action is the new one",
              "physio" in client.created[-1]["content"].lower(),
              client.created[-1]["content"])

        # -- a lost state file must not double everything
        os.remove(config["vault"]["state_file"])
        fresh_state = dedupe.StateStore(config["vault"]["state_file"])
        run_pipeline(root, config, client, fresh_state, force=True)
        equal("pipeline: losing the state file creates no duplicates",
              len(client.created), before + 1)

        # -- dry run writes nothing
        with tempfile.TemporaryDirectory() as clean_root:
            clean_config, _ = config_module.load()
            clean_config["vault"].update(
                {"path": clean_root, "name": "Second Brain",
                 "state_file": os.path.join(clean_root, "state.json")})
            clean_config["extract"]["backend"] = "heuristic"
            path = write_note(clean_root, "2026-09-09 Dry.md", WORKED_EXAMPLE_2)
            original = open(path, encoding="utf-8").read()
            dry_client = FakeTodoist()
            dry_report = run_pipeline(clean_root, clean_config, dry_client,
                                      dedupe.StateStore(clean_config["vault"]["state_file"]),
                                      dry_run=True)
            equal("pipeline: a dry run creates no Todoist tasks", len(dry_client.created), 0)
            check("pipeline: a dry run still reports what it would create",
                  dry_report.created_count == 2, dry_report.created_count)
            equal("pipeline: a dry run leaves the note untouched",
                  open(path, encoding="utf-8").read(), original)
            check("pipeline: a dry run writes no state file",
                  not os.path.exists(clean_config["vault"]["state_file"]))



# --- Rig 5: the phone path (plan.py) ----------------------------------------

def rig_plan():
    """plan.py runs when the vault is on a phone and there are no credentials.

    Its duplicate check has to be stricter than run.py's, because the tasks the
    older .automation/run.py pipeline wrote carry no ref at all. Similarity
    against every existing Pocket task is the only thing that can see them.
    """
    config, _ = config_module.load()
    config["vault"]["name"] = "Second Brain"

    recordings = [{
        "recording_id": "rec-1",
        "title": "Chat about Kevin and HPA",
        "date": "2026-09-11",
        "transcript": WORKED_EXAMPLE_2,
    }]
    extractions = {"rec-1": {
        "action_items": [
            {"title": "Message Kevin about Friday training", "context": "",
             "owner": "me", "owner_name": "", "due_phrase": "tomorrow",
             "priority": "high", "topic": "Coaching"},
            {"title": "Finish the HPA testing document", "context": "",
             "owner": "me", "owner_name": "", "due_phrase": "next week",
             "priority": "normal", "topic": "HPA"},
            {"title": "Dan to send the gym program images", "context": "",
             "owner": "other", "owner_name": "Dan", "due_phrase": "",
             "priority": "normal", "topic": "Coaching"},
        ],
        "ideas": ["Six-weekly testing blocks"],
        "notes": [], "decisions": [],
    }}
    projects = [{"id": "1", "name": "Inbox"}, {"id": "2", "name": "Actions"},
                {"id": "3", "name": "Waiting On"}]

    result = plan_module.build(list(recordings), extractions, [], projects, config)
    by_title = {t["content"]: t for t in result["create"]}
    equal("plan: three tasks planned", len(result["create"]), 3)

    kevin = by_title.get("Message Kevin about Friday training")
    check("plan: the Kevin task exists", kevin is not None, list(by_title))
    if kevin:
        equal("plan: Kevin lands in Actions", kevin["project_name"], "Actions")
        equal("plan: and uses that project's real id", kevin["projectId"], "2")
        equal("plan: 'tomorrow' resolves against the recording's date",
              kevin["due_local"], "2026-09-12T08:00:00")
        equal("plan: 8am Brisbane is sent to Todoist as the night before in UTC",
              kevin["due_datetime_utc"], "2026-09-11T22:00:00.000000Z")
        equal("plan: 'high' becomes Todoist p2", kevin["priority"], 3)
        equal("plan: and is spelled out for callers that name priorities",
              kevin["priorityLabel"], "p2")
        equal("plan: the due string carries a time, not just a date",
              kevin["dueString"], "2026-09-12 at 08:00")
        check("plan: every task carries the Pocket label", "Pocket" in kevin["labels"])
        check("plan: the topic rides along as a label", "Coaching" in kevin["labels"])
        check("plan: the description links back to the vault",
              "obsidian://search?vault=Second%20Brain" in kevin["description"])
        check("plan: the description carries a ref",
              bool(dedupe.refs_in(kevin["description"])))
        check("plan: the transcript is NOT sent to Todoist",
              "I also need to finish" not in kevin["description"])

    hpa = by_title.get("Finish the HPA testing document")
    if hpa:
        equal("plan: 'next week' is the coming Monday", hpa["due_local"][:10], "2026-09-14")

    dan = next((t for t in result["create"] if t["content"].startswith("Dan:")), None)
    check("plan: someone else's commitment is prefixed with their name", dan is not None,
          list(by_title))
    if dan:
        equal("plan: and routed to Waiting On", dan["project_name"], "Waiting On")
        check("plan: with no invented due date", "due_local" not in dan)
        check("plan: and no due string either", "dueString" not in dan)

    check("plan: an Obsidian block is produced for the note",
          "Six-weekly testing blocks" in result["obsidian_blocks"]["rec-1"])

    # Re-planning the same recording against the tasks it produced must be a
    # no-op. This is the whole safety property of re-running.
    existing = [{"id": "x", "content": t["content"], "description": t["description"]}
                for t in result["create"]]
    again = plan_module.build(list(recordings), extractions, existing, projects, config)
    equal("plan: re-planning creates nothing", len(again["create"]), 0)
    check("plan: and says why", all("ref already" in s["reason"] for s in again["skipped"]))

    # The case refs cannot cover: a task written by the OLD pipeline, which has
    # no ref in its description at all.
    legacy = [{"id": "old", "content": "Message Kevin about Friday training",
               "description": "Source: some other note (2026-09-06)"}]
    legacy_plan = plan_module.build(list(recordings), extractions, legacy, projects, config)
    titles = [t["content"] for t in legacy_plan["create"]]
    check("plan: a ref-less task from the old pipeline is still recognised",
          "Message Kevin about Friday training" not in titles, titles)
    equal("plan: and the genuinely new ones are still planned", len(titles), 2)

    # A recording nobody extracted must not silently vanish.
    orphan = plan_module.build(
        [{"recording_id": "rec-9", "title": "Unread", "date": "2026-09-11",
          "transcript": "x"}], {}, [], projects, config)
    equal("plan: an unextracted recording creates nothing", len(orphan["create"]), 0)
    check("plan: and is reported rather than dropped",
          any("no extraction" in s["reason"] for s in orphan["skipped"]))


# --- Rig 6: the schedule screenshots (Turkish) -------------------------------

# 2026-09-14 is a Monday, so this week runs Pazartesi 14th .. Pazar 20th.
WEEK = {
    "pazartesi": date(2026, 9, 14),
    "sali": date(2026, 9, 15),
    "carsamba": date(2026, 9, 16),
    "persembe": date(2026, 9, 17),
    "cuma": date(2026, 9, 18),
    "cumartesi": date(2026, 9, 19),
    "pazar": date(2026, 9, 20),
}


class FakeCalendar:
    """Stands in for Google Calendar. Records what would have been created."""

    def __init__(self, existing=()):
        self.existing = list(existing)
        self.created = []

    def events_between(self, start_iso, end_iso, query=None):
        return list(self.existing)

    def create_event(self, summary, start, end, description=None, location=None,
                     ical_uid=None, timezone=None):
        event = {"id": f"evt-{len(self.created) + 1}",
                 "htmlLink": f"https://calendar.google.com/event?eid={len(self.created) + 1}",
                 "summary": summary, "start": start, "end": end,
                 "description": description or "", "location": location,
                 "iCalUID": ical_uid}
        self.created.append(event)
        return event


def rig_schedule():
    """The Turkish reading layer, and the calendar plan built on top of it.

    Every check here was verified by breaking the code on purpose. The three
    that matter most, because each one fails while looking entirely healthy:

    1. `fold` -- without it a schedule printed in capitals matches nothing,
       because "SALI".lower() is "sali" and "Salı".lower() is "salı".
    2. Longest-name-first -- without it "Pazartesi" matches the "Pazar" rule
       and every Monday session moves to Sunday.
    3. The pkt-/pkc- namespace split -- with a "-cal" suffix instead, the
       calendar scan reads its own refs back as task refs, recognises none of
       its own events, and re-creates the whole week on every run.
    """

    # --- Folding: the same day in every casing a printed schedule uses.
    for spelling in ["SALI", "Salı", "salı", "SALİ", "sali", " Salı "]:
        equal(f"schedule: {spelling!r} is Tuesday",
              schedule.weekday_index(spelling), 1)

    # The prefix trap. Turkish Sunday is a prefix of Monday, and Friday of
    # Saturday, so a shortest-match lookup moves two days of the week.
    for label, expected, clashes_with in [
        ("Pazartesi", 0, "Pazar"), ("PAZARTESİ", 0, "Pazar"),
        ("Pazar", 6, "Pazartesi"),
        ("Cumartesi", 5, "Cuma"), ("CUMARTESİ", 5, "Cuma"),
        ("Cuma", 4, "Cumartesi"),
    ]:
        equal(f"schedule: {label!r} is not read as {clashes_with!r}",
              schedule.weekday_index(label), expected)

    for label, expected in [("Çarşamba", 2), ("ÇARŞAMBA", 2), ("Perşembe", 3),
                            ("PERŞEMBE", 3), ("Monday", 0), ("wed", 2)]:
        equal(f"schedule: {label!r} weekday", schedule.weekday_index(label), expected)

    check("schedule: a word that names no day is None",
          schedule.weekday_index("Antrenman") is None)

    # A day name inside a longer word is not that day. This is what the
    # whole-word guard buys, and it is separate from the ordering below --
    # a rig run proved the docstring had credited the wrong one.
    for label in ["Pazartesi", "Cumartesi"]:
        check(f"schedule: {label!r} is not matched by its own prefix",
              schedule.weekday_index(label) != schedule.weekday_index(label[:5]),
              f"{label} and {label[:5]} both read as "
              f"{schedule.weekday_index(label)}")

    # Two glossary terms can both be whole words in the same title. The longer
    # one is the right answer, and only the ordering decides that.
    equal("schedule: the longer glossary term wins",
          schedule.gloss("Video Analiz"), "Video Analiz (video analysis)")
    equal("schedule: an already-English title is not glossed twice",
          schedule.gloss("Training"), "Training")

    # --- Dates. Day-first always; there is no reading where MM/DD is right.
    anchor = date(2026, 9, 14)
    for printed, expected in [
        ("16.09.2026", date(2026, 9, 16)),
        ("16/09/2026", date(2026, 9, 16)),
        ("16-09-2026", date(2026, 9, 16)),
        ("2026-09-16", date(2026, 9, 16)),
        ("16.09", date(2026, 9, 16)),          # year from the anchor
        ("16 Eylül", date(2026, 9, 16)),
        ("16 EYLÜL 2026", date(2026, 9, 16)),
        ("Eylül 16", date(2026, 9, 16)),
        ("1 Aralık", date(2026, 12, 1)),
        ("5 Ocak", date(2027, 1, 5)),          # forwards, not ten months back
    ]:
        equal(f"schedule: date {printed!r}",
              schedule.parse_date(printed, anchor=anchor), expected)

    # 09.10 is the ninth of October, never the tenth of September.
    equal("schedule: 09.10 is day-first",
          schedule.parse_date("09.10", anchor=anchor), date(2026, 10, 9))

    for rubbish in ["31.02.2026", "45.01.2026", "16.13.2026", "", "next week",
                    "Antrenman", None]:
        check(f"schedule: {rubbish!r} yields no date",
              schedule.parse_date(rubbish, anchor=anchor) is None,
              f"got {schedule.parse_date(rubbish, anchor=anchor)}")

    # --- Times, in every separator a printed schedule uses.
    for printed, expected in [("09:00", (9, 0)), ("09.00", (9, 0)),
                              ("9:00", (9, 0)), ("0900", (9, 0)),
                              ("19.30", (19, 30)), ("9", (9, 0))]:
        parsed = schedule.parse_time(printed)
        check(f"schedule: time {printed!r}",
              parsed is not None and (parsed.hour, parsed.minute) == expected,
              f"got {parsed}")

    for rubbish in ["24:00", "25.00", "09:75", "", "sabah", None]:
        check(f"schedule: time {rubbish!r} rejected",
              schedule.parse_time(rubbish) is None)

    for printed in ["09.00 - 10.30", "09:00-10:30", "09.00 – 10.30",
                    "09:00 to 10:30", "09.00 ile 10.30"]:
        start, end = schedule.parse_time_range(printed)
        check(f"schedule: range {printed!r}",
              start is not None and end is not None
              and (start.hour, start.minute) == (9, 0)
              and (end.hour, end.minute) == (10, 30),
              f"got {start}..{end}")

    # --- The weekday cross-check: the guard against reading the wrong row.
    equal("schedule: SALI agrees with a Tuesday",
          schedule.verify_weekday(WEEK["sali"], "SALI"), True)
    equal("schedule: SALI contradicts a Wednesday",
          schedule.verify_weekday(WEEK["carsamba"], "SALI"), False)
    equal("schedule: an unreadable label cannot be checked either way",
          schedule.verify_weekday(WEEK["sali"], "Antrenman"), None)

    calendar_config = config_module.DEFAULTS["calendar"]

    contradiction, problem = schedule.build(
        {"title": "Antrenman", "date": "16.09.2026", "printed_day": "SALI",
         "time": "18:00 - 20:00"}, calendar_config, anchor=anchor)
    check("schedule: a row whose day contradicts its date is held back",
          contradiction is None and problem is not None)
    check("schedule: and the reason names both readings",
          problem is not None and "Wednesday" in problem.reason
          and "SALI" in problem.reason, problem.reason if problem else "")

    undated, problem = schedule.build(
        {"title": "Antrenman", "date": "", "time": "18:00"},
        calendar_config, anchor=anchor)
    check("schedule: a row with no readable date is never given one",
          undated is None and problem is not None)

    # --- A good row, end to end.
    event, problem = schedule.build(
        {"title": "Antrenman", "date": "15.09.2026", "printed_day": "SALI",
         "time": "18:00 - 20:00", "location": "Salon"},
        calendar_config, anchor=anchor)
    check("schedule: a consistent row resolves", event is not None,
          problem.reason if problem else "")
    if event:
        equal("schedule: its date", event.on, WEEK["sali"])
        equal("schedule: its start", event.start_datetime(), "2026-09-15T18:00:00")
        equal("schedule: its end", event.end_datetime(), "2026-09-15T20:00:00")
        equal("schedule: the Turkish is kept and glossed",
              event.title, "Antrenman (training)")

    # A start with no end gets the configured duration, not an open-ended event.
    open_ended, _ = schedule.build(
        {"title": "Maç", "date": "18.09.2026", "printed_day": "Cuma",
         "time": "19:00"}, calendar_config, anchor=anchor)
    check("schedule: a start with no end gets the configured duration",
          open_ended is not None
          and open_ended.end_datetime() == "2026-09-18T20:30:00",
          open_ended.end_datetime() if open_ended else "no event")

    # A match finishing after midnight must not produce a negative-length event.
    late, _ = schedule.build(
        {"title": "Maç", "date": "18.09.2026", "start": "22:30", "end": "00:30"},
        calendar_config, anchor=anchor)
    check("schedule: an end past midnight rolls to the next day",
          late is not None and late.end_datetime() == "2026-09-19T00:30:00",
          late.end_datetime() if late else "no event")

    # A dateless entry is still a fact worth having; Google's all-day end is
    # exclusive, and sending the same date twice makes the event invisible.
    all_day, _ = schedule.build(
        {"title": "Deplasman", "date": "19.09.2026"}, calendar_config, anchor=anchor)
    check("schedule: an entry with no time becomes an all-day event",
          all_day is not None and all_day.all_day)
    if all_day:
        equal("schedule: whose end is the following date",
              all_day.end_date_exclusive(), "2026-09-20")

    # --- Refs. The namespace split, which is invisible when it breaks.
    task_ref = dedupe.ref_for("pocket/1", "Antrenman")
    calendar_ref = dedupe.cal_ref_for("pocket/1", "Antrenman")
    check("schedule: a calendar ref round-trips through its own scanner",
          calendar_ref in dedupe.cal_refs_in(f"ref: {calendar_ref}"))
    equal("schedule: a calendar ref is invisible to the task scanner",
          dedupe.refs_in(f"ref: {calendar_ref}"), set())
    equal("schedule: a task ref is invisible to the calendar scanner",
          dedupe.cal_refs_in(f"ref: {task_ref}"), set())
    check("schedule: the two refs are not the same string", task_ref != calendar_ref)

    # --- plan_calendar, end to end, against a real week.
    config, _ = config_module.load()
    screenshots = [{"screenshot_id": "shot-1", "file_name": "hafta-38.jpg",
                    "taken_on": "2026-09-14", "drive_url": "https://drive.example/1"}]
    rows = [
        {"title": "Antrenman", "date": "14.09.2026", "printed_day": "PAZARTESİ",
         "time": "10:00 - 12:00", "location": "Salon"},
        {"title": "Antrenman", "date": "14.09.2026", "printed_day": "PAZARTESİ",
         "time": "18:00 - 20:00", "location": "Salon"},
        {"title": "Kondisyon", "date": "15.09.2026", "printed_day": "SALI",
         "time": "10:00 - 11:30"},
        {"title": "Maç", "date": "18.09.2026", "printed_day": "CUMA",
         "time": "19:00 - 21:00", "location": "Ankara"},
        # Contradicts its own day: 19.09.2026 is a Saturday, not Sunday.
        {"title": "Toplantı", "date": "19.09.2026", "printed_day": "PAZAR",
         "time": "11:00"},
    ]
    plan = plan_calendar_module.build(
        screenshots, {"shot-1": {"events": rows}}, [], config)

    equal("plan_calendar: four good rows planned", len(plan["create"]), 4)
    equal("plan_calendar: the contradictory row is held back, not filed",
          len(plan["needs_review"]), 1)
    equal("plan_calendar: events are stamped Turkish time",
          plan["timezone"], "Europe/Istanbul")
    for entry in plan["create"]:
        if "dateTime" in entry["start"]:
            equal(f"plan_calendar: {entry['summary']} carries its zone",
                  entry["start"]["timeZone"], "Europe/Istanbul")

    # Two sessions with the same name on the same day are two events.
    monday = [e for e in plan["create"] if e["start"].get("dateTime", "").startswith("2026-09-14")]
    equal("plan_calendar: both Monday sessions survive", len(monday), 2)
    equal("plan_calendar: and they are distinct events",
          len({e["ref"] for e in monday}), 2)

    # Re-running the same screenshot creates nothing. The existing events are
    # shaped the way Google actually returns them -- an explicit +03:00 offset,
    # where a freshly planned event carries a naive local time and a separate
    # zone. Those describe the same moment and must compare equal; string
    # comparison says they do not, and would rewrite the whole week every run.
    existing = []
    for index, entry in enumerate(plan["create"]):
        start, end = dict(entry["start"]), dict(entry["end"])
        for side in (start, end):
            if "dateTime" in side:
                side["dateTime"] = side["dateTime"] + "+03:00"
        existing.append({"id": f"evt-{index}", "summary": entry["summary"],
                         "location": entry.get("location", ""),
                         "description": entry["description"],
                         "start": start, "end": end})

    again = plan_calendar_module.build(
        screenshots, {"shot-1": {"events": rows}}, existing, config)
    equal("plan_calendar: re-reading the same screenshot creates nothing",
          len(again["create"]), 0)
    equal("plan_calendar: and moves nothing, across the offset difference",
          len(again["update"]), 0)
    equal("plan_calendar: and says why", len(again["skipped"]), 4)

    # A corrected time moves the existing event rather than adding a second one
    # -- and must not be silently suppressed either, which is the bug this
    # check was written for. A rescheduled match that never reaches the phone
    # is the single most expensive thing this pipeline could do.
    moved = [dict(r) for r in rows]
    moved[3]["time"] = "20:00 - 22:00"
    corrected = plan_calendar_module.build(
        screenshots, {"shot-1": {"events": moved}}, existing, config)
    equal("plan_calendar: a corrected time is not a second event",
          len(corrected["create"]), 0)
    equal("plan_calendar: a corrected time is not silently dropped",
          len(corrected["update"]), 1)
    if corrected["update"]:
        entry = corrected["update"][0]
        equal("plan_calendar: the moved event keeps its identity",
              entry["iCalUID"],
              [e for e in plan["create"] if e["summary"] == entry["summary"]][0]["iCalUID"])
        equal("plan_calendar: and carries the new time",
              entry["start"]["dateTime"], "2026-09-18T20:00:00")
        equal("plan_calendar: and names the calendar's own id to move",
              entry["event_id"], "evt-3")

    # A renamed session is a new event, not a move. Stated as a check because
    # it is a known gap rather than a desirable behaviour.
    renamed = [dict(r) for r in rows]
    renamed[2]["title"] = "Fizyoterapi"
    after_rename = plan_calendar_module.build(
        screenshots, {"shot-1": {"events": renamed}}, existing, config)
    equal("plan_calendar: a renamed session reads as a new event",
          len(after_rename["create"]), 1)

    # A genuinely new session on a new day is created.
    added = [dict(r) for r in rows] + [
        {"title": "Video Analiz", "date": "17.09.2026", "printed_day": "PERŞEMBE",
         "time": "16:00 - 17:00"}]
    extended = plan_calendar_module.build(
        screenshots, {"shot-1": {"events": added}}, existing, config)
    equal("plan_calendar: a new session is still created", len(extended["create"]), 1)
    equal("plan_calendar: and nothing else is disturbed", len(extended["update"]), 0)

    # --- Every day of a year, in Istanbul: a wall-clock time survives the trip.
    # Turkey has had no DST since 2016 and could rejoin it; nothing here may
    # assume that, which is why the zone is named and never written as +03:00.
    istanbul = ZoneInfo("Europe/Istanbul")
    day, drift = date(2026, 1, 1), []
    while day < date(2027, 1, 1):
        built, _ = schedule.build(
            {"title": "Antrenman", "date": day.isoformat(), "time": "19:00 - 21:00"},
            config_module.DEFAULTS["calendar"], anchor=day)
        if built is None:
            drift.append(f"{day} did not resolve")
            day += timedelta(days=1)
            continue
        local = datetime.fromisoformat(built.start_datetime()).replace(tzinfo=istanbul)
        back = local.astimezone(ZoneInfo("UTC")).astimezone(istanbul)
        if back.strftime("%Y-%m-%d %H:%M") != f"{day.isoformat()} 19:00":
            drift.append(f"{day} came back as {back}")
        day += timedelta(days=1)
    check("plan_calendar: 365 days round-trip through Istanbul", not drift,
          "; ".join(drift[:3]))

    # --- The sink: narrow on purpose.
    config["calendar"]["enabled"] = True
    sink = CalendarSink(FakeCalendar())
    sink.prepare(config)
    note = vault.Note(path="", rel_path="pocket/rec-9", title="Note", on=date(2026, 9, 14),
                      body="", frontmatter="", raw="")

    def action(**kwargs):
        base = {"title": "", "context": "", "owner": "me", "owner_name": "",
                "due_phrase": "", "priority": "normal", "topic": "unknown"}
        base.update(kwargs)
        return extract.Action(**base)

    yes = action(title="Physio appointment", due_phrase="tomorrow")
    check("sink: an appointment with a date is the calendar's",
          sink.accepts(note, yes))

    no_date = action(title="Physio appointment")
    check("sink: the same appointment with no date is not",
          not sink.accepts(note, no_date))

    errand = action(title="Book the physio appointment", due_phrase="tomorrow")
    check("sink: booking an appointment stays a task",
          not sink.accepts(note, errand))

    plain = action(title="Finish the testing document", due_phrase="tomorrow")
    check("sink: an ordinary task is not an appointment", not sink.accepts(note, plain))

    record = sink.emit(note, yes, {"ref": dedupe.ref_for(note.key, yes.title),
                                   "vault_name": "Second Brain"})
    check("sink: it creates an event", record is not None)
    if record:
        equal("sink: in Turkish time", record["timezone"], "Europe/Istanbul")
        check("sink: stamped with a calendar ref",
              record["ref"].startswith(dedupe.CAL_REF_PREFIX), record["ref"])

    # The sink must never suppress the task that accompanies its event.
    equal("sink: reports no refs upward, so the task still gets written",
          sink.known_refs(), {})

    # A second run against a calendar that already holds the event creates nothing.
    seeded = FakeCalendar(existing=[{"description": f"ref: {record['ref']}"}])
    second = CalendarSink(seeded)
    second.prepare(config)
    check("sink: an event already on the calendar is not created twice",
          second.emit(note, yes, {"ref": dedupe.ref_for(note.key, yes.title),
                                  "vault_name": ""}) is None)
    config["calendar"]["enabled"] = False


def main():
    update = "--update-golden" in sys.argv
    rig_prompt(update=update)
    if update:
        return 0
    rig_dates()
    rig_plumbing()
    rig_pipeline()
    rig_plan()
    rig_schedule()

    if FAILURES:
        print(f"\n{len(FAILURES)} of {CHECKS[0]} checks FAILED:\n")
        for failure in FAILURES:
            print(f"  x {failure}")
        return 1
    print(f"All {CHECKS[0]} checks passed "
          f"(dates, prompt, plumbing, pipeline, plan, schedule).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
