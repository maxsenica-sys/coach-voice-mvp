"""A small Google Calendar v3 client.

Stdlib-only, for the same reason as `todoist.py`: this runs unattended, and
every dependency is something that can break between runs.

Two things differ from the Todoist client and both matter.

**Every write carries a timezone.** Google accepts a naive `dateTime` and
interprets it in the calendar's default zone, which is a silent way to file a
19:00 Istanbul training session at 19:00 Brisbane. Nothing here ever sends a
time without saying which zone it is in.

**Every write carries an idempotency key.** Calendar has no natural duplicate
check, so `iCalUID` is set from the pipeline's own ref. Importing the same
event twice with the same UID updates it rather than making a second copy,
which turns a re-run from a hazard into a no-op.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

API_ROOT = "https://www.googleapis.com/calendar/v3"
RETRY_STATUSES = {403, 429, 500, 502, 503, 504}


class CalendarError(RuntimeError):
    pass


class CalendarClient:
    def __init__(self, token, calendar_id="primary", api_root=API_ROOT,
                 max_retries=4, sleep=time.sleep):
        if not token:
            raise CalendarError(
                "No Google access token. Put an OAuth token in "
                "GOOGLE_CALENDAR_TOKEN, or run the phone path (plan_calendar.py) "
                "which needs no credentials at all.")
        self.token = token
        self.calendar_id = calendar_id
        self.api_root = api_root.rstrip("/")
        self.max_retries = max_retries
        self._sleep = sleep

    def _request(self, method, path, payload=None, params=None):
        url = f"{self.api_root}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Authorization": f"Bearer {self.token}"}
        if body is not None:
            headers["Content-Type"] = "application/json"

        last_error = None
        for attempt in range(self.max_retries + 1):
            request = urllib.request.Request(url, data=body, headers=headers,
                                             method=method)
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    raw = response.read().decode("utf-8").strip()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:400]
                last_error = f"{exc.code} {exc.reason}: {detail}"
                if exc.code in RETRY_STATUSES and attempt < self.max_retries:
                    self._sleep(2 ** attempt)
                    continue
                raise CalendarError(f"{method} {path} failed -- {last_error}") from exc
            except urllib.error.URLError as exc:
                last_error = str(exc)
                if attempt < self.max_retries:
                    self._sleep(2 ** attempt)
                    continue
                raise CalendarError(f"{method} {path} failed -- {last_error}") from exc
        raise CalendarError(f"{method} {path} failed -- {last_error}")

    def _path(self, suffix=""):
        return f"/calendars/{urllib.parse.quote(self.calendar_id, safe='')}/events{suffix}"

    def events_between(self, start_iso, end_iso, query=None):
        """Events in a window. Used to see what is already on the calendar."""
        params = {
            "timeMin": start_iso,
            "timeMax": end_iso,
            "singleEvents": "true",
            "maxResults": "2500",
        }
        if query:
            params["q"] = query
        found, page = [], None
        while True:
            if page:
                params["pageToken"] = page
            payload = self._request("GET", self._path(), params=params) or {}
            found.extend(payload.get("items") or [])
            page = payload.get("nextPageToken")
            if not page:
                return found

    def create_event(self, summary, start, end, description=None, location=None,
                     ical_uid=None, timezone=None):
        """Create one event. `start`/`end` are dicts already shaped for the API.

        Uses `import` rather than `insert` when an iCalUID is supplied: import
        is the endpoint that treats the UID as an identity, so running the same
        plan twice updates rather than duplicates.
        """
        payload = {"summary": summary, "start": dict(start), "end": dict(end)}
        if description:
            payload["description"] = description
        if location:
            payload["location"] = location
        if timezone:
            payload["start"].setdefault("timeZone", timezone)
            payload["end"].setdefault("timeZone", timezone)
        if ical_uid:
            payload["iCalUID"] = ical_uid
            return self._request("POST", self._path("/import"), payload=payload)
        return self._request("POST", self._path(), payload=payload)
