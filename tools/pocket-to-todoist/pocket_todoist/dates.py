"""Natural-language due dates, resolved against the note's own date.

Two rules govern everything here, and both come from bugs rather than taste:

1.  **Dates are resolved relative to the note, not to the run.** The pipeline
    runs nightly and can run days late. A Monday note saying "tomorrow" means
    Tuesday, whatever day the parser happens to execute.

2.  **All arithmetic is on `date` objects in a named timezone.** Nothing here
    divides milliseconds by 86,400,000, and nothing hardcodes 28/30/31. "End of
    the month" is `first of next month, minus one day`, which is right in
    February and right in a leap year without knowing either fact.

Every resolved due carries a time as well as a date. That is not decoration:
Todoist Free only fires an automatic reminder when a task has both, which is
why the existing pipeline set one on every task it ever wrote.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

WEEKDAYS = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

# Cues that mean "the evening of that day" rather than "the morning of".
EVENING_CUES = re.compile(
    r"\b(tonight|this evening|tomorrow evening|tomorrow night|"
    r"after training|after practice|after the session|"
    r"end of (?:the )?day|eod|before bed|this afternoon)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Due:
    """A resolved due date. `phrase` is the text that produced it."""

    on: date
    at: time
    phrase: str

    def local_datetime(self) -> str:
        """The due moment as the speaker means it, with no zone attached."""
        return f"{self.on.isoformat()}T{self.at.strftime('%H:%M:%S')}"

    def utc_datetime(self, tz_name: str) -> str:
        """The same moment in RFC3339 UTC, which is what Todoist stores.

        This conversion is the entire reason the clock rig exists. "Friday 8am"
        is a different instant in Brisbane and in London, and a pipeline that
        skips this step files a morning task in the middle of the night for
        half the year.
        """
        local = datetime.combine(self.on, self.at, tzinfo=ZoneInfo(tz_name))
        return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000000Z")


def _end_of_month(d: date) -> date:
    """Last day of d's month.

    First of next month, minus one day. Never a hardcoded day count -- that is
    the bug that put a NaN in the calendar's month range.
    """
    first_of_next = date(d.year + (d.month // 12), (d.month % 12) + 1, 1)
    return first_of_next - timedelta(days=1)


def _weekday_delta(anchor: date, target_wd: int, is_next: bool) -> int:
    """Days from `anchor` to the named weekday.

    Bare "Friday" means the coming Friday, and means today if today is Friday.
    "Next Friday" always means the one in the following week, including when
    today is Friday.
    """
    base = (target_wd - anchor.weekday()) % 7
    return base + 7 if is_next else base


def _week_delta(anchor: date, target_wd: int, is_next: bool) -> int:
    """Days to the week anchor for "this week" / "next week".

    Distinct from `_weekday_delta` because a bare weekday and a week reference
    behave differently when today is the day in question: "Friday" said on a
    Friday means today, but "next week" said on a Monday means the Monday after.
    """
    base = (target_wd - anchor.weekday()) % 7
    if is_next and base == 0:
        return 7
    return base


def _match_span(m: "re.Match[str]") -> tuple:
    # Longest match wins, earliest position breaks ties. This is what makes
    # "next week" beat "week" and "this weekend" beat "weekend".
    return (-(m.end() - m.start()), m.start())


def resolve_due(phrase, anchor, config=None):
    """Resolve a natural-language phrase to a Due, or None if it names no day.

    `anchor` is the date the note was recorded -- see rule 1 in the module
    docstring. Returns None rather than guessing: a task with no due date is
    correct far more often than a task due on the wrong day.
    """
    if not phrase:
        return None
    config = config or {}
    text = phrase.lower()

    # Phrases with no inherent day, which the user maps to one. "before
    # training" is the motivating case: it is a real deadline to Max and an
    # unparseable string to every date library.
    for custom, meaning in (config.get("phrase_map") or {}).items():
        if custom.lower() in text:
            text = text.replace(custom.lower(), meaning.lower())

    week_anchor = (config.get("next_week_anchor") or "monday").lower()
    weekend_day = (config.get("weekend_day") or "saturday").lower()
    default_at = _parse_time(config.get("default_time"), time(8, 0))
    evening_at = _parse_time(config.get("evening_time"), time(18, 0))

    candidates = []

    def offer(pattern, resolver):
        for m in re.finditer(pattern, text, re.IGNORECASE):
            candidates.append((m, resolver))

    offer(r"\b(?:the )?day after tomorrow\b", lambda m: anchor + timedelta(days=2))
    offer(r"\btomorrow(?: morning| afternoon| evening| night)?\b",
          lambda m: anchor + timedelta(days=1))
    offer(r"\b(?:today|tonight|this (?:morning|afternoon|evening)|"
          r"end of (?:the )?day|eod|asap|right away|straight away)\b",
          lambda m: anchor)

    offer(r"\b(next|this)?\s*weekend\b",
          lambda m: anchor + timedelta(days=_weekday_delta(
              anchor, WEEKDAYS[weekend_day],
              (m.group(1) or "").lower() == "next")))

    # "Next week" means the next time that week-anchor day comes round -- said
    # on a Wednesday it is five days away, not twelve. Only when today IS the
    # anchor day does it mean the one after.
    offer(r"\b(next|this)\s+week\b",
          lambda m: anchor + timedelta(days=_week_delta(
              anchor,
              WEEKDAYS[week_anchor] if m.group(1).lower() == "next"
              else WEEKDAYS[(config.get("this_week_anchor") or "friday").lower()],
              m.group(1).lower() == "next")))

    offer(r"\b(next|this|coming)?\s*(" + "|".join(sorted(WEEKDAYS, key=len, reverse=True)) + r")\b",
          lambda m: anchor + timedelta(days=_weekday_delta(
              anchor, WEEKDAYS[m.group(2).lower()],
              (m.group(1) or "").lower() == "next")))

    offer(r"\bin (\d+|a|an|one|two|three|four|five|six|seven) (day|week|month)s?\b",
          lambda m: _relative(anchor, m.group(1), m.group(2)))

    offer(r"\b(?:by |before |at )?(?:the )?end of (?:the |this )?month\b",
          lambda m: _end_of_month(anchor))

    offer(r"\b(\d{4})-(\d{2})-(\d{2})\b",
          lambda m: date(int(m.group(1)), int(m.group(2)), int(m.group(3))))

    offer(r"\b(\d{1,2})(?:st|nd|rd|th)? (" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\b",
          lambda m: _day_month(anchor, int(m.group(1)), MONTHS[m.group(2).lower()]))

    offer(r"\b(" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r") (\d{1,2})(?:st|nd|rd|th)?\b",
          lambda m: _day_month(anchor, int(m.group(2)), MONTHS[m.group(1).lower()]))

    if not candidates:
        return None

    best_match, resolver = min(candidates, key=lambda pair: _match_span(pair[0]))
    try:
        resolved = resolver(best_match)
    except (ValueError, KeyError):
        return None
    if resolved is None:
        return None

    at = evening_at if EVENING_CUES.search(phrase) else default_at
    return Due(on=resolved, at=at, phrase=best_match.group(0).strip())


def _relative(anchor: date, count: str, unit: str):
    words = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3,
             "four": 4, "five": 5, "six": 6, "seven": 7}
    n = words.get(count.lower(), None)
    if n is None:
        n = int(count)
    if unit.startswith("day"):
        return anchor + timedelta(days=n)
    if unit.startswith("week"):
        return anchor + timedelta(weeks=n)
    # Months, walked one at a time so the last-day rule stays correct.
    d = anchor
    for _ in range(n):
        d = _end_of_month(d) + timedelta(days=1)
    try:
        return date(d.year, d.month, min(anchor.day, _end_of_month(d).day))
    except ValueError:
        return _end_of_month(d)


def _day_month(anchor: date, day: int, month: int):
    """A bare day+month means the next such date, this year or next."""
    for year in (anchor.year, anchor.year + 1):
        try:
            candidate = date(year, month, day)
        except ValueError:
            return None
        if candidate >= anchor:
            return candidate
    return None


def _parse_time(raw, fallback: time) -> time:
    if not raw:
        return fallback
    try:
        hh, mm = str(raw).split(":")[:2]
        return time(int(hh), int(mm))
    except (ValueError, TypeError):
        return fallback
