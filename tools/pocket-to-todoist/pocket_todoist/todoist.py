"""A small Todoist REST v2 client.

Deliberately stdlib-only. This script has to run unattended on a laptop for
months; every dependency is something that can break between runs, and the
whole surface needed here is four endpoints.

The one rule worth stating: every response is status-checked. A non-2xx from
Todoist is not an exception in urllib's eyes if you do not ask, and a pipeline
that carries on after a failed create is how you get a note marked processed
with nothing in the task list.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

API_ROOT = "https://api.todoist.com/rest/v2"
RETRY_STATUSES = {429, 500, 502, 503, 504}


class TodoistError(RuntimeError):
    pass


class TodoistClient:
    def __init__(self, token, api_root=API_ROOT, max_retries=4, sleep=time.sleep):
        if not token:
            raise TodoistError(
                "No Todoist API token. Put it in TODOIST_API_TOKEN "
                "(Todoist -> Settings -> Integrations -> Developer).")
        self.token = token
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
            request = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    raw = response.read().decode("utf-8").strip()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", "replace")[:300]
                if exc.code in RETRY_STATUSES and attempt < self.max_retries:
                    last_error = f"HTTP {exc.code}: {detail}"
                    self._sleep(2 ** attempt)
                    continue
                raise TodoistError(f"{method} {path} failed -- HTTP {exc.code}: {detail}") from exc
            except urllib.error.URLError as exc:
                if attempt < self.max_retries:
                    last_error = str(exc.reason)
                    self._sleep(2 ** attempt)
                    continue
                raise TodoistError(f"{method} {path} failed -- {exc.reason}") from exc
        raise TodoistError(f"{method} {path} failed after retries -- {last_error}")

    # --- reads ---

    def projects(self):
        return self._request("GET", "/projects") or []

    def projects_by_name(self):
        return {p["name"].lower(): p["id"] for p in self.projects()}

    def labels(self):
        return self._request("GET", "/labels") or []

    def tasks_with_label(self, label):
        return self._request("GET", "/tasks", params={"label": label}) or []

    # --- writes ---

    def ensure_label(self, name):
        """Create the label if it is missing.

        Todoist creates unknown labels implicitly when a task names one, but
        only as a task property -- it does not always become a personal label
        that can be picked from the sidebar. Creating it explicitly means the
        label is there to filter on from the first task.
        """
        for label in self.labels():
            if label["name"].lower() == name.lower():
                return label["id"]
        created = self._request("POST", "/labels", payload={"name": name})
        return (created or {}).get("id")

    def create_task(self, content, description=None, project_id=None,
                    labels=None, priority=None, due_datetime=None):
        payload = {"content": content}
        if description:
            payload["description"] = description
        if project_id:
            payload["project_id"] = project_id
        if labels:
            payload["labels"] = list(labels)
        if priority:
            payload["priority"] = priority
        if due_datetime:
            # RFC3339 in UTC -- the only form the REST API documents. The
            # local-to-UTC conversion happens in dates.py, where it is tested.
            payload["due_datetime"] = due_datetime
        return self._request("POST", "/tasks", payload=payload)
