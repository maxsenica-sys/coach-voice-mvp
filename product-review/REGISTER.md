# Recommendation register

Every recommendation any agent has made, with its current status. Agents read
this before proposing, so it is what stops the same idea arriving every Tuesday.

**Only agent output goes in the table below.** A pre-seeded guess is worse than
an empty register: on the first run the register was seeded with predicted
findings, and the design agent correctly declined to re-propose two items it
believed were already on the record. Observations that have not been through an
agent go under "Not yet reviewed", where they are visible without being counted
as proposals.

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

| ID | Date | Status | One line | Verdict at proposal | Priority |
|---|---|---|---|---|---|
| UX-001 | 2026-09-05 | PROPOSED | The recorder silently pre-selects the most recently added athlete, and a mis-targeted session can be neither deleted nor reassigned | BUILD NOW | 250 |
| DATA-001 | 2026-09-05 | PROPOSED | Extract one "what to work on next" line from the transcript the coach already recorded, and show it on the athlete's home card | BUILD NOW | 200 |
| DESIGN-001 | 2026-09-05 | PROPOSED | Replace the raw-Tailwind wellness palette with four tokens in the app's own colour family; every wellness number currently fails AA | BUILD NOW | 67.5 |

## Not yet reviewed

Real observations, recorded so they are not lost, but **not** agent proposals.
An agent may pick any of these up as its own recommendation on a later run.

| Noted | Area | Observation |
|---|---|---|
| 2026-09-05 setup | Design | `--text-muted` `#9BA29B` is 2.47:1 on `--bg` and carries dates, stat sub-labels and empty-state copy at 10–13 px across every page. `--text-2` at 5.49:1 is the drop-in. |
| 2026-09-05 setup | Design | `/` sign-in is visually a different product: dark browns `#1A0E06 → #2C1810` with amber and indigo glows, all inline, none of them tokens. |
| 2026-09-05 DESIGN-001 | Design | Wellness metric toggle pills (`WellnessGraph.tsx:248-262`) render 11 px text in the five identity hues: 2.00–3.78:1, all failing. The design agent scoped this out deliberately rather than bundling two colour decisions. |
| 2026-09-05 DATA-001 | Correctness | `app/athlete/page.tsx:181` orders the athlete's sessions by `created_at`, while the coach side now orders by `session_date` (`020fc70`). A backdated session appears at the top of the athlete's list as if it happened tonight. This is a bug, not a recommendation. |
| 2026-09-05 UX-001 | UX | `QuickSessionModal`'s backdrop has no `overflow-y` and `.card-lg` no max-height; the review step is ~600 px and may clip unscrollably on a short viewport or with the keyboard raised. |

## Coverage

How many reviews since each area was the *primary* subject of a
recommendation. 4+ means it is due an unprompted audit even if nothing there
has changed. The orchestrator bumps these when it files a report.

| Area | Reviews since last primary |
|---|---|
| Recorder / QuickSessionModal | 0 |
| Session save + summariser | 0 |
| Wellness (submit, graph, alerts) | 0 |
| Athlete home + sessions | 0 |
| Session page `/sessions/[id]` | 1 |
| Coach dashboard home | 1 |
| Athlete profile `/athletes/[id]` | 1 |
| Messaging | 1 |
| Calendar / DayWheel | 1 |
| Groups / squads | 1 |
| Onboarding: signup, join, invite | 1 |
| Sign-in `/` | 1 |
| PDF reports | 1 |
| Video annotation | 1 |
