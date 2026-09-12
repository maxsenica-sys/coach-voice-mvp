#!/usr/bin/env python3
"""Pocket -> Obsidian -> Todoist.

    ./run.py --once              analyse any new Pocket notes, then exit
    ./run.py --watch             stay running and analyse notes as they arrive
    ./run.py --once --dry-run    show exactly what would happen, change nothing
    ./run.py --doctor            check the config, the vault and the two APIs

Obsidian keeps everything. Todoist receives only the actions.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pocket_todoist import config as config_module  # noqa: E402
from pocket_todoist import dedupe, extract, vault  # noqa: E402
from pocket_todoist import pipeline as pipeline_module  # noqa: E402
from pocket_todoist.sinks.todoist_sink import TodoistSink  # noqa: E402
from pocket_todoist.todoist import TodoistClient, TodoistError  # noqa: E402

GREY, BOLD, GREEN, YELLOW, RED, RESET = (
    "\033[90m", "\033[1m", "\033[32m", "\033[33m", "\033[31m", "\033[0m")
if not sys.stdout.isatty():
    GREY = BOLD = GREEN = YELLOW = RED = RESET = ""


def build_parser():
    parser = argparse.ArgumentParser(
        prog="pocket-todoist", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true",
                      help="Process everything outstanding, then exit (default).")
    mode.add_argument("--watch", action="store_true",
                      help="Keep running and process notes as they appear.")
    mode.add_argument("--doctor", action="store_true",
                      help="Check configuration and connectivity, change nothing.")
    parser.add_argument("--config", help="Path to the config file.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would be created without touching "
                             "Todoist or the vault.")
    parser.add_argument("--force", action="store_true",
                        help="Re-analyse notes already marked processed. "
                             "Duplicate tasks are still suppressed.")
    parser.add_argument("--note", help="Process a single note by path or title fragment.")
    parser.add_argument("--limit", type=int, help="Process at most N notes.")
    parser.add_argument("--backend", choices=["claude", "heuristic"],
                        help="Override the extraction backend.")
    return parser


def load_everything(args):
    config, config_path = config_module.load(args.config)
    if args.backend:
        config.setdefault("extract", {})["backend"] = args.backend
    return config, config_path


class OfflineTodoist:
    """Stands in for Todoist during a dry run with no token.

    It reports no projects, which makes the preview route everything to Inbox.
    That is honest -- without the account there is no way to know which projects
    exist -- and it means `--dry-run` works before anything has been set up.
    """

    def projects_by_name(self):
        return {}

    def ensure_label(self, name):
        return None

    def tasks_with_label(self, label):
        return []

    def create_task(self, **kwargs):
        return None


def make_client(config, dry_run=False):
    token_env = (config.get("todoist") or {}).get("token_env") or "TODOIST_API_TOKEN"
    token = os.environ.get(token_env)
    if not token and dry_run:
        print(f"{YELLOW}!{RESET} {token_env} is not set -- previewing offline, so "
              f"every task shows as Inbox.")
        return OfflineTodoist()
    return TodoistClient(token)


def select_notes(config, args):
    notes = vault.discover(config)
    if args.note:
        needle = args.note.lower()
        notes = [n for n in notes
                 if needle in n.rel_path.lower() or needle in n.title.lower()]
    if args.limit:
        notes = notes[: args.limit]
    return notes


def doctor(config, config_path):
    print(f"{BOLD}Configuration{RESET}")
    print(f"  file      {config_path or '(built-in defaults -- no config file found)'}")
    print(f"  vault     {config.get('vault', {}).get('path') or '(unset)'}")
    print(f"  timezone  {config.get('timezone')}")
    print(f"  backend   {config.get('extract', {}).get('backend')}")

    problems = config_module.validate(config)
    for problem in problems:
        print(f"  {RED}x{RESET} {problem}")

    if not problems:
        try:
            notes = vault.discover(config)
            processed_key = config["vault"].get("processed_key")
            outstanding = [n for n in notes
                           if not vault.is_processed(n, processed_key,
                                                     dedupe.content_hash(n.transcript()))]
            print(f"  {GREEN}v{RESET} {len(notes)} Pocket notes found, "
                  f"{len(outstanding)} outstanding")
        except FileNotFoundError as exc:
            problems.append(str(exc))
            print(f"  {RED}x{RESET} {exc}")

    print(f"\n{BOLD}Todoist{RESET}")
    try:
        client = make_client(config)
        projects = client.projects()
        print(f"  {GREEN}v{RESET} connected -- projects: "
              f"{', '.join(p['name'] for p in projects)}")
        wanted = set()
        routing = config.get("routing") or {}
        wanted.update((routing.get("owner_projects") or {}).values())
        if routing.get("fallback_project"):
            wanted.add(routing["fallback_project"])
        existing = {p["name"].lower() for p in projects}
        for name in sorted(wanted):
            if name.lower() not in existing:
                print(f"  {YELLOW}!{RESET} project {name!r} is configured but does "
                      f"not exist -- those tasks will land in Inbox")
        topic_projects = [t["project"] for t in config.get("topics") or []
                          if t.get("project") and t["project"].lower() not in existing]
        if topic_projects:
            print(f"  {GREY}i{RESET} topic projects not present, so topic becomes a "
                  f"label instead: {', '.join(topic_projects)}")
    except (TodoistError, KeyError) as exc:
        problems.append(str(exc))
        print(f"  {RED}x{RESET} {exc}")

    print(f"\n{BOLD}Claude{RESET}")
    if (config.get("extract") or {}).get("backend") == "heuristic":
        print(f"  {GREY}i{RESET} heuristic backend selected -- Claude is not used")
    else:
        try:
            import anthropic  # noqa: F401
            if os.environ.get("ANTHROPIC_API_KEY"):
                print(f"  {GREEN}v{RESET} anthropic installed, ANTHROPIC_API_KEY set")
            else:
                print(f"  {YELLOW}!{RESET} anthropic installed, but ANTHROPIC_API_KEY "
                      f"is not set")
        except ImportError:
            problems.append("anthropic is not installed")
            print(f"  {RED}x{RESET} anthropic is not installed -- run ./install.sh")

    print()
    if problems:
        print(f"{RED}{len(problems)} problem(s) to fix before this will run.{RESET}")
        return 1
    print(f"{GREEN}Ready.{RESET}")
    return 0


def report_result(result, dry_run):
    prefix = "would create" if dry_run else "created"
    if result.error:
        print(f"  {RED}x{RESET} {result.note_title} -- {result.error}")
        return
    print(f"  {BOLD}{result.note_title}{RESET}")
    for record in result.created:
        due = f"  {GREY}due {record['due']}{RESET}" if record.get("due") else ""
        labels = f" {GREY}@{' @'.join(record['labels'])}{RESET}" if record["labels"] else ""
        print(f"    {GREEN}+{RESET} {prefix}: {record['title']}"
              f"  {GREY}[{record['project']}]{RESET}{labels}{due}")
    for title in result.skipped_duplicates:
        print(f"    {GREY}= already in Todoist: {title}{RESET}")
    kept = []
    for count, name in ((result.ideas, "idea"), (result.decisions, "decision"),
                        (result.notes, "note")):
        if count:
            kept.append(f"{count} {name}{'s' if count != 1 else ''}")
    if kept:
        print(f"    {GREY}- kept in Obsidian only: {', '.join(kept)}{RESET}")


def run_once(config, args):
    problems = config_module.validate(config)
    if problems:
        for problem in problems:
            print(f"{RED}x{RESET} {problem}", file=sys.stderr)
        print("Run --doctor for the full picture.", file=sys.stderr)
        return 2

    notes = select_notes(config, args)
    backend = extract.get_backend(
        (config.get("extract") or {}).get("backend", "claude"),
        **({"model": config["extract"].get("model")}
           if (config.get("extract") or {}).get("backend", "claude") == "claude" else {}))

    client = make_client(config, dry_run=args.dry_run)
    sinks = [TodoistSink(client)]
    state = dedupe.StateStore((config.get("vault") or {}).get("state_file"))

    report = pipeline_module.run(notes, config, backend, sinks, state,
                                 dry_run=args.dry_run, force=args.force)

    if args.dry_run:
        print(f"{YELLOW}Dry run -- nothing was written.{RESET}")
    for result in report.results:
        report_result(result, args.dry_run)

    verb = "would create" if args.dry_run else "created"
    print(f"\n{report.considered} Pocket note(s): {report.already_done} already done, "
          f"{len(report.results)} analysed, {report.created_count} task(s) {verb}, "
          f"{report.duplicate_count} duplicate(s) suppressed.")
    return 1 if report.failed else 0


def run_watch(config, args):
    poll = (config.get("watch") or {}).get("poll_seconds", 60)
    debounce = (config.get("watch") or {}).get("debounce_seconds", 20)
    print(f"Watching {config['vault']['path']} -- polling every {poll}s. Ctrl-C to stop.")

    # Polling rather than filesystem events on purpose: the vault arrives over
    # a sync client, which lands files in ways that native watchers report
    # inconsistently, and a minute of latency costs nothing here.
    last_signature = None
    while True:
        try:
            notes = vault.discover(config)
            signature = sorted((n.rel_path, os.path.getmtime(n.path)) for n in notes)
            if signature != last_signature:
                if last_signature is not None:
                    time.sleep(debounce)  # let a sync finish writing
                code = run_once(config, args)
                if code == 2:
                    return code
                last_signature = sorted(
                    (n.rel_path, os.path.getmtime(n.path))
                    for n in vault.discover(config))
            time.sleep(poll)
        except KeyboardInterrupt:
            print("\nStopped.")
            return 0
        except (OSError, TodoistError) as exc:
            print(f"{RED}x{RESET} {exc} -- retrying in {poll}s", file=sys.stderr)
            time.sleep(poll)


def main(argv=None):
    args = build_parser().parse_args(argv)
    config, config_path = load_everything(args)

    if args.doctor:
        return doctor(config, config_path)
    try:
        if args.watch:
            return run_watch(config, args)
        return run_once(config, args)
    except (FileNotFoundError, TodoistError) as exc:
        print(f"{RED}x{RESET} {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
