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
"""

from __future__ import annotations

import os
import sys
import tempfile
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from pocket_todoist import config as config_module  # noqa: E402
from pocket_todoist import dedupe, extract, pipeline, prompt, routing, vault  # noqa: E402
from pocket_todoist.dates import resolve_due  # noqa: E402
from pocket_todoist.sinks.todoist_sink import TodoistSink  # noqa: E402

GOLDEN = os.path.join(HERE, "fixtures", "golden-prompt.txt")

FAILURES = []
CHECKS = [0]


def check(name, condition, detail=""):
    CHECKS[0] += 1
    if not condition:
        FAILURES.append(f"{name}{(' -- ' + detail) if detail else ''}")


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


def main():
    update = "--update-golden" in sys.argv
    rig_prompt(update=update)
    if update:
        return 0
    rig_dates()
    rig_plumbing()
    rig_pipeline()

    if FAILURES:
        print(f"\n{len(FAILURES)} of {CHECKS[0]} checks FAILED:\n")
        for failure in FAILURES:
            print(f"  x {failure}")
        return 1
    print(f"All {CHECKS[0]} checks passed "
          f"(dates, prompt, plumbing, pipeline).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
