"""Configuration, and the defaults that encode what is already true.

The defaults are not neutral. They describe the Todoist account as it actually
is -- an "Actions" project and a "Waiting On" project, no labels yet, Brisbane
time, a free plan with a five-project cap. Anything topic-shaped therefore
becomes a label by default, and turns into a project automatically if a project
by that name ever appears.
"""

from __future__ import annotations

import copy
import json
import os

DEFAULTS = {
    "timezone": "Australia/Brisbane",

    "vault": {
        "path": "",
        # Used to build obsidian:// links. Must match the vault name Obsidian
        # shows, not the folder name, when the two differ.
        "name": "",
        "include_folders": ["Pocket"],
        "match": {
            "frontmatter_keys": ["pocket_id", "recordingId"],
            "frontmatter_values": {"source": "pocket"},
            "tags": ["pocket"],
            "filename_globs": [],
        },
        "processed_key": "pocket_todoist",
        "state_file": "~/.local/state/pocket-todoist/state.json",
    },

    "due": {
        "default_time": "08:00",
        "evening_time": "18:00",
        # "next week" lands on Monday; "this week" on Friday.
        "next_week_anchor": "monday",
        "this_week_anchor": "friday",
        "weekend_day": "saturday",
        # Phrases with no inherent day. Editing this list is how "before
        # training" gets a better answer than "today" if the schedule changes.
        "phrase_map": {
            "before training": "today",
            "before the session": "today",
            "after training": "today",
            "first thing": "tomorrow",
        },
    },

    "routing": {
        # The split already in use, and the one that decides what Max does with
        # a task rather than what it is about.
        "owner_projects": {"me": "Actions", "other": "Waiting On"},
        "fallback_project": "Inbox",
        "always_labels": ["Pocket"],
        # Prefer a real project per topic when one exists; fall back to labels.
        "use_topic_projects": True,
    },

    "topics": [
        {"name": "Project V", "label": "ProjectV", "project": "Project V",
         "hint": "Project V, Launchpad, Project Fit, clinics, the business itself"},
        {"name": "HPA", "label": "HPA", "project": "HPA",
         "hint": "High Performance Academy, HPA, Sharks, the academy, contracts, titles"},
        {"name": "Coaching", "label": "Coaching", "project": "Coaching",
         "hint": "individual athletes, sessions, technique, programs, testing, footage review"},
        {"name": "Content", "label": "Content", "project": "Content",
         "hint": "Instagram, reels, video edits, posts, DMs, website, social media"},
        {"name": "Volleyball", "label": "Volleyball", "project": "Volleyball",
         "hint": "the professional season, club, team, travel, competition, playing"},
        {"name": "Personal", "label": "Personal", "project": "Personal",
         "hint": "admin, money, appointments, family, anything not work"},
    ],

    "extract": {
        "backend": "claude",
        "model": "claude-opus-5",
    },

    "todoist": {
        "token_env": "TODOIST_API_TOKEN",
    },

    "calendar": {
        # Off for the voice pipeline. The screenshot path (plan_calendar.py)
        # reads this block regardless -- `enabled` gates only whether a spoken
        # appointment in a Pocket note also becomes a calendar event, which is
        # the change most likely to surprise, so it is opt-in.
        "enabled": False,

        # The schedules are printed in Turkey and read in Turkish time. This is
        # deliberately NOT the top-level `timezone`, which is Brisbane and
        # belongs to the Todoist pipeline: a training session at 19:00 in
        # Istanbul is not 19:00 in Brisbane, and one setting cannot be both.
        # Named, never an offset -- Turkey left DST in 2016 and could rejoin it,
        # and a hardcoded +03:00 would be wrong the day it did.
        "timezone": "Europe/Istanbul",

        "calendar_id": "primary",
        "token_env": "GOOGLE_CALENDAR_TOKEN",

        # What a schedule entry with a start but no end is assumed to run for.
        # 90 minutes is a volleyball session; a spoken appointment gets 60.
        "default_duration_minutes": 90,

        # Keep the printed Turkish and append an English gloss -- "Antrenman
        # (training)". Set false to leave titles exactly as printed.
        "gloss": True,

        # An entry with a date but no time becomes an all-day event rather than
        # being dropped. A match day with no time on the planner is still a fact
        # worth having on the calendar.
        "allow_all_day": True,

        # How far either side of today to read the calendar when working out
        # what is already there.
        "lookback_days": 30,
        "lookahead_days": 180,

        # Where screenshots are dropped. Read by the session, not by this code --
        # nothing here can reach Drive, the same way nothing can reach the vault.
        "drive_folder": "Calendar Inbox",
    },

    "watch": {
        "debounce_seconds": 20,
        "poll_seconds": 60,
    },
}


def _merge(base, override):
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def load(path=None):
    """Load config from `path`, else the first default location that exists."""
    candidates = [path] if path else [
        os.environ.get("POCKET_TODOIST_CONFIG"),
        "./pocket-todoist.config.json",
        os.path.expanduser("~/.config/pocket-todoist/config.json"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        expanded = os.path.expanduser(candidate)
        if os.path.isfile(expanded):
            with open(expanded, "r", encoding="utf-8") as handle:
                return _merge(DEFAULTS, json.load(handle)), expanded
    if path:
        raise FileNotFoundError(f"No config file at {path}")
    return copy.deepcopy(DEFAULTS), None


def topics_for_prompt(config):
    return [(entry["name"], entry.get("hint", "")) for entry in config.get("topics") or []]


def validate(config):
    """Problems worth stopping for, phrased as what to do about them."""
    problems = []
    vault_path = os.path.expanduser((config.get("vault") or {}).get("path") or "")
    if not vault_path:
        problems.append("vault.path is not set -- point it at your Obsidian vault.")
    elif not os.path.isdir(vault_path):
        problems.append(f"vault.path does not exist: {vault_path}")
    if not (config.get("vault") or {}).get("name"):
        problems.append(
            "vault.name is not set -- without it, tasks get no obsidian:// link "
            "back to the note.")
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(config.get("timezone") or "")
    except Exception:
        problems.append(f"timezone is not a valid IANA name: {config.get('timezone')!r}")
    return problems
