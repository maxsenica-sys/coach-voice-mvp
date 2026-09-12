"""Deciding which Todoist project and labels a task gets.

Routing runs in two layers, and the order is the whole point.

The FIRST layer is ownership, and it is the one already in use: tasks Max owes
go to "Actions", tasks other people owe him go to "Waiting On". That split
exists in his Todoist today and the projects document it themselves. It is
orthogonal to subject matter, and it is the split that changes what he does
each morning, so it keeps the projects.

The SECOND layer is topic -- Project V, HPA, content, volleyball, personal.
Topic becomes a label, not a project, unless a project of that name actually
exists. That is not a preference: Todoist Free caps an account at five personal
projects, and the requested topic list would need six on top of the two that
are there. Labels carry the same filtering with no cap, and if the account ever
goes Pro, creating the projects is enough to switch a topic over -- the router
prefers a real project whenever it finds one.
"""

from __future__ import annotations

# Todoist counts priority backwards from the UI: 4 is p1, 1 is p4.
PRIORITY_TO_TODOIST = {"urgent": 4, "high": 3, "normal": 2, "low": 1}


class Route:
    def __init__(self, project_name, project_id, labels, priority):
        self.project_name = project_name
        self.project_id = project_id
        self.labels = labels
        self.priority = priority

    def __repr__(self):
        return (f"Route(project={self.project_name!r}, labels={self.labels!r}, "
                f"priority={self.priority})")


def topic_config(topic_name, config):
    for entry in config.get("topics") or []:
        if entry.get("name", "").lower() == (topic_name or "").lower():
            return entry
    return None


def route(action, projects_by_name, config):
    """Pick a project and labels for one action.

    `projects_by_name` maps a lowercased Todoist project name to its id, so the
    router can tell a project that exists from one that was merely configured.
    """
    routing = config.get("routing") or {}
    topic = topic_config(action.topic, config)

    candidates = []
    if routing.get("use_topic_projects", True) and topic and topic.get("project"):
        candidates.append(topic["project"])
    owner_projects = routing.get("owner_projects") or {}
    if owner_projects.get(action.owner):
        candidates.append(owner_projects[action.owner])
    if routing.get("fallback_project"):
        candidates.append(routing["fallback_project"])

    project_name, project_id = None, None
    for name in candidates:
        found = projects_by_name.get(name.lower())
        if found:
            project_name, project_id = name, found
            break
    if project_name is None:
        # Nothing configured exists. Todoist puts an unrouted task in Inbox,
        # which is the documented "if uncertain" destination anyway.
        project_name = "Inbox"

    labels = list(routing.get("always_labels") or [])
    if topic and topic.get("label"):
        if topic["label"] not in labels:
            labels.append(topic["label"])

    return Route(
        project_name=project_name,
        project_id=project_id,
        labels=labels,
        priority=PRIORITY_TO_TODOIST.get(action.priority, 2),
    )
