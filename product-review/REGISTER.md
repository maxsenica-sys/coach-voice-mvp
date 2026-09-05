# Recommendation register

Every recommendation any agent has made, with its current status. Agents read
this before proposing, so it is what stops the same idea arriving every Tuesday.

## Statuses

| Status | Meaning |
|---|---|
| `PROPOSED` | Made, not yet decided on |
| `TESTING` | Being tried in some form |
| `APPROVED` | Max said build it; not built yet |
| `IMPLEMENTED` | In the product |
| `BACKLOG` | Good, but after MVP |
| `REJECTED` | No. Does not come back without new evidence, a material change in the app, or another change creating a reason to revisit. |
| `SUPERSEDED` | Replaced by a later ID (name it) |

## Register

| ID | Date | Status | One line | Verdict at proposal |
|---|---|---|---|---|
| DATA-001 | 2026-09-05 | PROPOSED | Surface focus points on the athlete's home and session list, not two taps deep on `/sessions/[id]` | BUILD NOW |
| UX-001 | 2026-09-05 | PROPOSED | The recorder silently pre-selects the first athlete on the roster when opened from the FAB | BUILD NOW |
| DESIGN-001 | 2026-09-05 | PROPOSED | `--text-muted` is 2.47:1 on the app background and carries dates, labels and empty-state copy | BUILD NOW |
| DESIGN-002 | 2026-09-05 | PROPOSED | Sign-in page is a different visual product from the rest of the app | BACKLOG |

## Coverage

How many reviews since each area was the *primary* subject of a
recommendation. 4+ means it is due an unprompted audit even if nothing there
has changed. The orchestrator bumps these when it files a report.

| Area | Reviews since last primary |
|---|---|
| Recorder / QuickSessionModal | 0 |
| Session page `/sessions/[id]` | 0 |
| Athlete home + sessions | 0 |
| Coach dashboard home | 1 |
| Athlete profile `/athletes/[id]` | 1 |
| Wellness (submit, graph, alerts) | 1 |
| Messaging | 1 |
| Calendar / DayWheel | 1 |
| Groups / squads | 1 |
| Onboarding: signup, join, invite | 1 |
| Sign-in `/` | 0 |
| PDF reports | 1 |
| Video annotation | 1 |
