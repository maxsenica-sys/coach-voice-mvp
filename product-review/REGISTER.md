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
| UX-001 | 2026-09-05 | IMPLEMENTED | The recorder silently pre-selects the most recently added athlete, and a mis-targeted session can be neither deleted nor reassigned | BUILD NOW | 250 |
| DATA-001 | 2026-09-05 | IMPLEMENTED | Extract one "what to work on next" line from the transcript the coach already recorded, and show it on the athlete's home card | BUILD NOW | 200 |
| DESIGN-001 | 2026-09-05 | IMPLEMENTED | Replace the raw-Tailwind wellness palette with four tokens in the app's own colour family; every wellness number currently fails AA | BUILD NOW | 67.5 |

All three were approved and built the same day, in commit `feat: act on the
first daily review`. The scores below are what the agents assigned at proposal;
they are not re-scored after the fact.

| ID | Built as |
|---|---|
| UX-001 | Fallbacks removed; `<select>`s replaced with one-tap chips; both step-1 exits gated on having a target; modal made scrollable |
| DATA-001 | `makeQuickSummary` returns `{summary, next}`; `NEXT:` line extracted and written to `focus_points`; rendered on the athlete's home card under "Take into next session" |
| DESIGN-001 | Eight wellness tokens in `globals.css`; `colorMap` deleted; `metricTint`/`overallScoreTint` added; hex-alpha concatenation retired; slate neutrals swapped; 9.5→11 px; 40→44 px |

Also built in the same pass, from the "Not yet reviewed" list below:
`--text-muted` raised to `#6B736D` (4.61:1) with all 23 hardcoded instances
pointed at the token; the athlete session ordering bug; the metric-pill contrast
failure; the modal scroll clip.

### Round 2 — 2026-09-06 (first four-agent run)

| ID | Date | Status | One line | Verdict | Priority |
|---|---|---|---|---|---|
| UX-002 | 2026-09-06 | IMPLEMENTED | "Read full session" doesn't open the session — it switches tab, onto an inert hero card duplicating what the athlete just tapped away from | BUILD NOW | **500** |
| DATA-002 | 2026-09-06 | PROPOSED | Show the coach the athlete's last focus point at the moment they press record; `GET /api/sessions` already returns it | BUILD NOW | 128 |
| DESIGN-002 | 2026-09-06 | PROPOSED | One auth shell — promote the coach sidebar's ink gradient to a token, apply across the four-ground funnel, unify four brand marks, fix two AA failures | BUILD NOW | 67.5 |
| WOW-001 | 2026-09-06 | PROTOTYPING | Hear It — persist the Whisper segments the app already computes and discards; every coaching point becomes playable in the coach's real voice | PROTOTYPE | 37.5 |
| DATA-003 | 2026-09-06 | PROPOSED | STRETCH — The Thread: synthesise 6–10 transcripts into three sentences of what changed, coach-gated | TEST | — |
| UX-003 | 2026-09-06 | PROPOSED | STRETCH — delete the athlete's home and wellness tabs; one scrolling "Today", nav 5 → 3 | TEST | — |
| DESIGN-003 | 2026-09-06 | PROPOSED | STRETCH — retire the 39 emoji used as iconography; one shared Icon component | BACKLOG | — |

**#1 today:** UX-002 — **BUILT 2026-09-06**. **#1 ambition:** WOW-001 — prototype
**BUILT 2026-09-06** at `/dev/hearit`, awaiting three coaches' reactions. That
reaction is the decision point: if nobody asks to hear it again, close WOW-001
rather than backlogging it.

Folded into the UX-002 build from the "Not yet reviewed" list: the quotation
marks around the AI summary, and the dead header messages button.

### Round 3 — 2026-09-06 · single topic: the opening sequence

Deliverable: https://claude.ai/code/artifact/f29ad8a2-b5cd-49e8-aedb-be70dd315cef

| ID | Date | Status | One line | Verdict | Priority |
|---|---|---|---|---|---|
| UX-004 | 2026-09-06 | PROPOSED | Fix the front door first — signed-in users see the login form on every cold start; then play the intro *behind* a live sign-in card, once per device | BUILD NOW | 160 |
| DATA-004 | 2026-09-06 | PROPOSED | Treat the opening as a screen to REMOVE, not add: redirect signed-in users, fix the navy manifest splash. Rejects the sports montage outright | BUILD NOW / REJECT montage | 160 |
| DESIGN-004 | 2026-09-06 | PROPOSED | Three intro directions on one motion envelope (A The Voice / B The Roll Call / C The First Word) + the missing `prefers-reduced-motion` layer | BUILD NOW in two pieces | 24 |
| WOW-002 | 2026-09-06 | PROPOSED | "The Line" — one stroke that is waveform, silhouette and logo, driven by a real coach's real 8 seconds, playing silent because autoplay is blocked | PROTOTYPE | 21.3 |
| DATA-005 | 2026-09-06 | BLOCKED | STRETCH — "Forty Seconds": the login screen performs the pipeline. **Blocked, not backlogged** — needs a public front door that does not exist | — | — |
| UX-005 | 2026-09-06 | PROPOSED | STRETCH — delete the pre-auth intro; put a 1.2s cold-start moment *inside* the app, aimed at the person who opens it 4×/week | TEST | — |
| DESIGN-005 | 2026-09-06 | PROPOSED | STRETCH — "The Ten-Second Proof": Direction C with audio. Needs a security review, not a design change | BACKLOG | — |

**All four agents independently opened with the same defect** — the strongest
convergence this system has produced. See "Not yet reviewed" for the three
verified defects it surfaced.

**#1 today:** the three defect fixes (~25 lines), not the intro.
**#1 ambition:** Direction A behind a live form; park D until the clip exists.

## Not yet reviewed

Real observations, recorded so they are not lost, but **not** agent proposals.
An agent may pick any of these up as its own recommendation on a later run.

| Noted | Area | Observation |
|---|---|---|
| ~~2026-09-05 setup~~ | ~~Design~~ | **DONE 2026-09-05** — token raised to `#6B736D` (4.61:1 on `--bg`, 4.89:1 on `--card`); 23 hardcoded `#9BA29B` instances repointed at the token. |
| ~~2026-09-06 synthesis~~ | ~~Correctness~~ | **DONE 2026-09-06** — quotation marks removed with UX-002. |
| 2026-09-06 DESIGN-002 | Design | `--primary` is used as **text** at 10 sites at 3.24–3.65:1, all failing 1.4.3. DESIGN-002 fixes two; eight remain. |
| 2026-09-06 DATA+UX | Product | **STILL OPEN — the biggest thing this review found that nobody has acted on.** Both agents independently challenged the wellness loop: the coach gets one flattened mean with no indication which metric caused it, and the athlete gets nothing back at all for five taps a day. Neither made it their primary. The athlete's "See your trends →" still opens a blank form; `WellnessGraph` already exists and takes `athleteId`, so showing it there is close to a one-line change — but whether an athlete should see their own trends is a product decision, not a bug fix, so it was left for Max. |
| ~~2026-09-06 UX-002~~ | ~~UX~~ | **DONE 2026-09-06** — wired to the messages tab, dot removed. |
| 2026-09-06 ALL FOUR | Defect | **A signed-in user is shown the login form on every cold start.** `/` is in the proxy matcher but no protected-route list (`proxy.ts:13-17,93`), `app/page.tsx` has no session check at all, and the PWA `start_url` is `/`. The middleware holds the user object at the edge and discards it. Verified. |
| 2026-09-06 UX-004 | Defect | Notification email CTAs point at protected routes (`lib/notify.ts:169,235,255,319`); a lapsed session redirects to `/` and **discards the destination** — no `next` param except password reset. |
| 2026-09-06 DATA-004 | Defect | `public/manifest.webmanifest` paints navy `#0f2042` / blue `#2563eb` — a retired palette — while `app/manifest.ts` holds the correct `#FBF8F3` / `#1F2421` and is **dead code**. Cold launch shows navy → brown → parchment. 2-line fix, cheapest win in the report. |
| 2026-09-06 DESIGN-004 | Accessibility | **Zero `prefers-reduced-motion` in the entire codebase.** 7 keyframe sets including a 1.2s *infinite* pulse on the athlete page teenagers open daily. |
| 2026-09-06 DATA-004 | Product | Two first-run intros already exist post-auth and PROJECT-STATE missed both: `app/athlete/page.tsx:540-586` and `app/dashboard/page.tsx:1149-1180+`. |
| 2026-09-05 setup | Design | `/` sign-in is visually a different product: dark browns `#1A0E06 → #2C1810` with amber and indigo glows, all inline, none of them tokens. **Superseded by DESIGN-002** (2026-09-06), which proposes a target design and finds the divergence is four grounds, not one. |
| ~~2026-09-05 DESIGN-001~~ | ~~Design~~ | **DONE 2026-09-05** — identity hue moved to a 7 px dot; pill label now `--text`/`--text-2`. The five series hues are untouched as chart fills. |
| ~~2026-09-05 DATA-001~~ | ~~Correctness~~ | **DONE 2026-09-05** — athlete query now orders `session_date desc nullsFirst:false`, then `created_at desc`, matching the coach side. |
| ~~2026-09-05 UX-001~~ | ~~UX~~ | **DONE 2026-09-05** — `overflowY: auto` on the backdrop, `maxHeight: 100%` + `overflowY: auto` on the card. |

## Coverage

How many reviews since each area was the *primary* subject of a
recommendation. 4+ means it is due an unprompted audit even if nothing there
has changed. The orchestrator bumps these when it files a report.

| Area | Reviews since last primary |
|---|---|
| Ambition / wow factor | 0 |
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
| Sign-in `/` | 0 |
| PDF reports | 1 |
| Video annotation | 1 |
