"""Turning a printed schedule into calendar events, in Turkish or English.

This is the deterministic half of the screenshot pipeline. A session reads the
image and reports what it saw; everything below decides whether what it saw is
good enough to put in a calendar, and nothing here touches a network.

Three rules govern the file, and each one comes from a way this can go wrong
rather than from taste:

1.  **A date is never invented.** Every other module in this package already
    works this way -- `resolve_due` returns None rather than guess -- and a
    calendar earns it twice over. A missing training session is visible the
    moment Max looks at Tuesday and sees nothing. A session sitting confidently
    on the wrong Tuesday is not visible at all, and he plans his week around it.
    Anything unresolvable goes to `needs_review`, never to the calendar.

2.  **Turkish text is folded before it is matched, never lowercased.** Python
    lowercases "SALI" to "sali" and "Salı" to "salı", which do not compare
    equal, so a schedule printed in capitals -- which is most of them -- matches
    nothing at all while looking perfectly fine in the logs. `fold` is the only
    sanctioned way to normalise a label here.

3.  **Names match only on whole-word boundaries, longest first.** "Pazar"
    (Sunday) is a prefix of "Pazartesi" (Monday), and "Cuma" (Friday) of
    "Cumartesi" (Saturday) -- the same bug class as the name test that matched
    "Ana" inside "Anastasia", and here it silently moves every Monday session
    to Sunday. Two separate things prevent it, and it is worth knowing which
    does what, because a rig run proved the docstring wrong on exactly this:

    - The `(?<![a-z])...(?![a-z])` guard is what stops a prefix matching inside
      a longer name. It, alone, is what saves Monday. Remove it and shortening
      the list cannot help.
    - `_by_length` decides between two names that *both* match as whole words.
      That is a real case, but a glossary one: "Video Analiz" contains "analiz"
      as a genuine word, so shortest-first glosses it "analysis" instead of
      "video analysis".

    For weekday names the two are redundant: with longest-first ordering
    intact, "pazartesi" is tested before "pazar" and wins even on a plain
    substring match, and with the guard intact the ordering is irrelevant.
    Either alone saves Monday. That redundancy is deliberate and the rig pins
    the combined property -- removing both is caught -- but it is the reason
    no single-mutation test can isolate the guard here, and the reason this
    paragraph exists rather than a confident claim about which one matters.

The day names are also the cross-check that makes the whole thing trustworthy.
A screenshot column header says "SALI"; the session reports a date. If that
date is not a Tuesday, one of the two is wrong and the event is held back --
see `verify_weekday`. That check costs nothing and catches the failure this
pipeline is most likely to have: a model reading the column above or below.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

# Turkish letters that lowercase into something a naive comparison cannot match,
# plus the accented forms, mapped to the plain ASCII letter. Applied after
# casefold so both "İ" and "i" arrive at "i".
TR_FOLD = {
    "ı": "i", "İ": "i", "i̇": "i",
    "ş": "s", "Ş": "s",
    "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
    "â": "a", "î": "i", "û": "u",
}


def fold(text: str) -> str:
    """Normalise a label for comparison. The only sanctioned way in this file.

    `str.lower()` is wrong for Turkish in both directions -- see rule 2 in the
    module docstring -- so this casefolds, strips combining marks, and maps the
    Turkish-specific letters onto ASCII. "SALI", "Salı", "salı" and "SALİ" all
    arrive at "sali".
    """
    if not text:
        return ""
    out = []
    for char in unicodedata.normalize("NFC", str(text)):
        if char in TR_FOLD:
            out.append(TR_FOLD[char])
            continue
        lowered = char.casefold()
        # Casefold can expand one character into several ("İ" -> "i" + a
        # combining dot). Re-check each piece rather than trusting the length.
        for piece in lowered:
            if piece in TR_FOLD:
                out.append(TR_FOLD[piece])
            elif unicodedata.combining(piece):
                continue
            else:
                out.append(piece)
    return "".join(out).strip()


# Monday is 0, matching date.weekday().
WEEKDAYS = {
    "pazartesi": 0, "pzt": 0, "monday": 0, "mon": 0,
    "sali": 1, "sal": 1, "tuesday": 1, "tue": 1, "tues": 1,
    "carsamba": 2, "crs": 2, "car": 2, "wednesday": 2, "wed": 2,
    "persembe": 3, "prs": 3, "per": 3, "thursday": 3, "thu": 3, "thurs": 3,
    "cuma": 4, "cum": 4, "friday": 4, "fri": 4,
    "cumartesi": 5, "cmt": 5, "saturday": 5, "sat": 5,
    "pazar": 6, "paz": 6, "sunday": 6, "sun": 6,
}

MONTHS = {
    "ocak": 1, "oca": 1, "january": 1, "jan": 1,
    "subat": 2, "sub": 2, "february": 2, "feb": 2,
    "mart": 3, "mar": 3, "march": 3,
    "nisan": 4, "nis": 4, "april": 4, "apr": 4,
    "mayis": 5, "may": 5,
    "haziran": 6, "haz": 6, "june": 6, "jun": 6,
    "temmuz": 7, "tem": 7, "july": 7, "jul": 7,
    "agustos": 8, "agu": 8, "august": 8, "aug": 8,
    "eylul": 9, "eyl": 9, "september": 9, "sep": 9, "sept": 9,
    "ekim": 10, "eki": 10, "october": 10, "oct": 10,
    "kasim": 11, "kas": 11, "november": 11, "nov": 11,
    "aralik": 12, "ara": 12, "december": 12, "dec": 12,
}

# Words that appear on a Turkish team's wall planner, with the English a reader
# who does not speak Turkish needs. The original is always kept -- the calendar
# has to match the printed schedule it came from, so this appends rather than
# translates. Longest first for the same reason as the day names.
GLOSSARY = {
    "antrenman": "training",
    "idman": "training",
    "kondisyon": "conditioning",
    "kuvvet": "strength",
    "agirlik": "weights",
    "toplanti": "meeting",
    "mac": "match",
    "deplasman": "away",
    "ic saha": "home",
    "hazirlik": "preparation",
    "isinma": "warm-up",
    "taktik": "tactical",
    "video analiz": "video analysis",
    "analiz": "analysis",
    "fizyoterapi": "physio",
    "masaj": "massage",
    "dinlenme": "rest",
    "izin": "day off",
    "serbest": "free",
    "seyahat": "travel",
    "ucus": "flight",
    "otobus": "bus",
    "salon": "gym",
    "saha": "court",
    "kamp": "camp",
    "olcum": "testing",
    "test": "testing",
}


def _by_length(mapping):
    """Keys longest first, so a longer name always wins over its own prefix.

    Rule 3 in the module docstring. Without this, "Pazartesi" matches "Pazar"
    and every Monday session moves to Sunday.
    """
    return sorted(mapping, key=len, reverse=True)


def weekday_index(label):
    """The weekday a label names, or None if it names none.

    Matches inside a longer string, so "SALI 16.09" and "Salı Günü" both work.
    """
    folded = fold(label)
    if not folded:
        return None
    for name in _by_length(WEEKDAYS):
        if re.search(rf"(?<![a-z]){re.escape(name)}(?![a-z])", folded):
            return WEEKDAYS[name]
    return None


def month_index(label):
    folded = fold(label)
    if not folded:
        return None
    for name in _by_length(MONTHS):
        if re.search(rf"(?<![a-z]){re.escape(name)}(?![a-z])", folded):
            return MONTHS[name]
    return None


def gloss(title):
    """The title as printed, plus an English gloss when one is recognised.

    "Antrenman" becomes "Antrenman (training)". The Turkish stays first and
    unaltered: the calendar entry has to be recognisable against the schedule
    on the wall, and a translated title is not.
    """
    folded = fold(title)
    if not folded:
        return (title or "").strip()
    for term in _by_length(GLOSSARY):
        if re.search(rf"(?<![a-z]){re.escape(term)}(?![a-z])", folded):
            english = GLOSSARY[term]
            # Already English, or already glossed. Leave it alone.
            if re.search(rf"(?<![a-z]){re.escape(english)}(?![a-z])", folded):
                return (title or "").strip()
            return f"{(title or '').strip()} ({english})"
    return (title or "").strip()


# DD.MM.YYYY and DD/MM/YYYY. Turkish convention is day first, and so is
# Australian -- there is no reading of these screenshots where MM/DD is right,
# so it is never attempted.
_DMY = re.compile(r"^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$")
_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
# "16 Eylül", "16 Eylül 2026", "Eylül 16"
_DAY_MONTH = re.compile(r"^(\d{1,2})\s+([^\d\s]+)(?:\s+(\d{4}))?$")
_MONTH_DAY = re.compile(r"^([^\d\s]+)\s+(\d{1,2})(?:\s+(\d{4}))?$")


def parse_date(value, anchor=None):
    """A printed date, or None if it is not one.

    `anchor` supplies the year when the schedule omits it, which wall planners
    routinely do. The year is chosen as the one that puts the date nearest the
    anchor, so a January date read from a December screenshot lands next year
    rather than ten months ago.
    """
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()

    text = str(value).strip()
    if not text:
        return None

    iso = _ISO.match(text)
    if iso:
        return _safe_date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))

    dmy = _DMY.match(text)
    if dmy:
        day, month = int(dmy.group(1)), int(dmy.group(2))
        year = dmy.group(3)
        if year:
            year = int(year)
            if year < 100:
                year += 2000
            return _safe_date(year, month, day)
        return _nearest_year(day, month, anchor)

    for pattern, day_group, month_group in ((_DAY_MONTH, 1, 2), (_MONTH_DAY, 2, 1)):
        match = pattern.match(text)
        if not match:
            continue
        month = month_index(match.group(month_group))
        if month is None:
            continue
        day = int(match.group(day_group))
        if match.group(3):
            return _safe_date(int(match.group(3)), month, day)
        return _nearest_year(day, month, anchor)

    return None


def _safe_date(year, month, day):
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _nearest_year(day, month, anchor):
    """The year that puts day/month closest to the anchor.

    Candidates are the anchor's year and its neighbours, so a schedule
    screenshotted in December that lists January dates resolves forwards.
    """
    anchor = anchor or date.today()
    best = None
    for year in (anchor.year - 1, anchor.year, anchor.year + 1):
        candidate = _safe_date(year, month, day)
        if candidate is None:
            continue
        if best is None or abs((candidate - anchor).days) < abs((best - anchor).days):
            best = candidate
    return best


# 09:00, 09.00, 9h00, 0900. The separator varies by who printed the schedule.
_TIME = re.compile(r"^(\d{1,2})\s*[:.hH]?\s*(\d{2})?$")
_RANGE_SPLIT = re.compile(r"\s*(?:-|–|—|until|to|ile|;)\s*")


def parse_time(value):
    """A printed time of day, or None. 24-hour only; these schedules never use am/pm."""
    if value is None:
        return None
    if isinstance(value, time):
        return value
    text = str(value).strip()
    if not text:
        return None
    match = _TIME.match(text)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    # A bare "0900" arrives as hour=900. Re-split it rather than rejecting.
    if hour > 23 and match.group(2) is None:
        return None
    if hour > 23 or minute > 59:
        return None
    return time(hour, minute)


def parse_time_range(value):
    """"09.00 - 10.30" as a pair. The second half is None when only one time is printed."""
    if value is None:
        return (None, None)
    text = str(value).strip()
    if not text:
        return (None, None)
    parts = [p for p in _RANGE_SPLIT.split(text) if p]
    if len(parts) >= 2:
        return (parse_time(parts[0]), parse_time(parts[1]))
    return (parse_time(text), None)


def verify_weekday(on, label):
    """Does `on` fall on the weekday `label` names?

    Returns None when the label names no weekday, which means "cannot check"
    and must not be read as "checked and fine". The caller decides; `build`
    holds the event back only on an outright contradiction.

    This is the cheapest guard in the pipeline and the one most likely to fire.
    A schedule is a grid, and the way a reader misreads a grid is by taking the
    row above or below -- which changes the date while leaving everything else
    looking entirely correct.
    """
    index = weekday_index(label)
    if index is None or on is None:
        return None
    return on.weekday() == index


@dataclass(frozen=True)
class Event:
    """One calendar entry, resolved. Times are wall-clock in `tz`, never UTC."""

    title: str
    on: date
    start: "time | None" = None
    end: "time | None" = None
    location: str = ""
    notes: str = ""
    source: str = ""
    printed_day: str = ""
    printed_time: str = ""

    @property
    def all_day(self):
        return self.start is None

    def start_datetime(self):
        return f"{self.on.isoformat()}T{self.start.strftime('%H:%M:%S')}"

    def end_datetime(self):
        end_on, end_at = self.on, self.end
        # An end before the start means it crossed midnight -- a late match
        # finishing at 00:30. Rolling the date forward is right; leaving it
        # produces a negative-length event that Google rejects outright.
        if end_at < self.start:
            end_on = self.on + timedelta(days=1)
        return f"{end_on.isoformat()}T{end_at.strftime('%H:%M:%S')}"

    def end_date_exclusive(self):
        """All-day events are half-open in the Google API: end is the next day."""
        return (self.on + timedelta(days=1)).isoformat()


@dataclass
class Problem:
    """An event that was read but not resolved, and the reason, for review."""

    raw: dict = field(default_factory=dict)
    reason: str = ""


def build(raw, config=None, anchor=None, source=""):
    """One reported row into an Event, or a Problem explaining why not.

    Returns `(event, problem)` with exactly one of them set. Nothing here
    guesses: a row missing a resolvable date is a Problem, not an event on a
    plausible day.
    """
    config = config or {}
    raw = raw or {}

    title = (raw.get("title") or "").strip()
    if not title:
        return None, Problem(raw, "no title")

    on = parse_date(raw.get("date"), anchor=anchor)
    if on is None:
        return None, Problem(raw, f"could not read a date from {raw.get('date')!r}")

    printed_day = (raw.get("printed_day") or raw.get("day") or "").strip()
    agrees = verify_weekday(on, printed_day)
    if agrees is False:
        # The one hard stop. See verify_weekday.
        return None, Problem(
            raw,
            f"{on.isoformat()} is a {on.strftime('%A')}, but the schedule says "
            f"{printed_day!r} -- the date or the row was misread")

    printed_time = (raw.get("time") or raw.get("printed_time") or "").strip()
    start = parse_time(raw.get("start")) if raw.get("start") else None
    end = parse_time(raw.get("end")) if raw.get("end") else None
    if start is None:
        start, parsed_end = parse_time_range(printed_time)
        end = end or parsed_end

    if start is not None and end is None:
        minutes = int(config.get("default_duration_minutes") or 90)
        finish = datetime.combine(on, start) + timedelta(minutes=minutes)
        end = finish.time()

    if start is None and not config.get("allow_all_day", True):
        return None, Problem(raw, f"no time, and all-day events are disabled")

    return Event(
        title=gloss(title) if config.get("gloss", True) else title,
        on=on,
        start=start,
        end=end,
        location=(raw.get("location") or "").strip(),
        notes=(raw.get("notes") or "").strip(),
        source=source,
        printed_day=printed_day,
        printed_time=printed_time,
    ), None
