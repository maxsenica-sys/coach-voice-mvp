# UX & Usability agent — memory

Append-only. Newest entry at the top, under the heading. One entry per review.
Read this before proposing anything: an idea recorded as REJECTED here does not
come back unless new evidence exists, the app has materially changed, or another
change has created a reason to revisit it.

Entry shape:

```
## YYYY-MM-DD — UX-0NN — <one line>
Status: PROPOSED | TESTING | APPROVED | IMPLEMENTED | BACKLOG | REJECTED | SUPERSEDED
Verdict at proposal: BUILD NOW / TEST / BACKLOG / REJECT
Priority: (I × UV × MVP × C) / E = _
Grounded in: <files and lines the claim rests on>
Evidence: <source, or "judgement">
Outcome: <filled in when Max decides — and why, which is the part that matters>
```

---

## 2026-09-06 — UX-004 — Fix the front door, then the intro is free
Status: PROPOSED · Verdict: BUILD NOW (parts 1-2) · TEST (part 3, Option A)
Priority: (4 x 4 x 4 x 5) / 2 = 160
Grounded in: `proxy.ts:54-57,68,93` + `app/page.tsx` (no session check) +
  `public/manifest.webmanifest:5` — returning coach pays 3 taps + 2 round trips to sign in
  to a live session. Also `lib/notify.ts:169,235,255,319` link to protected routes and
  `proxy.ts:62` discards the destination. Verified by the orchestrator.
The three parts: (1) redirect signed-in users off `/` — GUARD on role being exactly
  'coach'/'athlete' or you build a redirect loop; (2) carry `?next=` through the auth wall,
  which is ALSO what makes the intro safe (when `next` is present the intro does not play —
  that person is interrupted, not a visitor); (3) the intro itself, Option A: montage as
  BACKGROUND behind an interactive card. Nothing to skip because nothing blocks.
Gating rule (conjunction, every clause load-bearing): no session AND no `?next=` AND
  `localStorage['cv_intro_v1']` absent. localStorage NOT profile-cache (that is
  sessionStorage and dies with the tab). Never cleared on sign-out.
Rejected: a pre-auth "coach or athlete?" fork — `app/signup/page.tsx:340-347` already is
  one, and a fork answer contradicting `profiles` is either theatre or a mis-route.
  Also rejected: a corner "Skip" pill — undercuts the drama AND signals that what follows
  is worth escaping.
Outcome: awaiting Max

## 2026-09-06 — UX-005 — STRETCH: move the theatre inside the app
Status: PROPOSED · Verdict: TEST
Delete the pre-auth intro; build a 1.2s cold-start moment answering "what changed since I
last opened this". Same craft, aimed at the person who opens it 4x/week rather than the one
who opens it once. Only legitimate if strictly non-blocking, <=1.2s, never repeated inside
6 hours. Test first by logging tab transitions.

## 2026-09-06 — Challenge and cut
Challenge: the app has demanded a re-login on every cold start since it shipped, and the
request that surfaced it was about a splash screen.
Cut: the `mode === 'forgot'` state on `/` (`app/page.tsx:11,102-138`) — 37 lines making the
front door a two-state screen for the app's rarest action.

## 2026-09-06 — UX-002 — "Read full session" does not open the session
Status: IMPLEMENTED (2026-09-06, same day)
Verdict at proposal: BUILD NOW
Priority: (4 x 5 x 5 x 5) / 1 = 500 — the highest this system has produced
Grounded in: `app/athlete/page.tsx:818-820` — the primary CTA on the core loop's card is
  `onClick={() => setTab('sessions')}`, verified by the orchestrator. It lands on an inert
  `<div>` hero (`:865-888`) re-showing the same session at 140 chars instead of 120, with
  scroll-to-top (`:82-84`) guaranteeing they look at it. Real session is 2 more taps.
  Same defect at `:742` (See your trends -> a blank form; WellnessGraph is coach-only,
  `app/athletes/[id]/page.tsx:1075`), `:764-768` (five rating-shaped nav buttons), and
  `:635-638` (messages button with NO onClick and a permanently-lit dot).
Evidence: label-destination integrity; perceived affordance inverted against actual
  interactivity. No explanatory text added — the fix is the destination.
Outcome: APPROVED and BUILT. The CTA is a Link to /sessions/[id]; the inert hero card
  is deleted; and two items from the register's "Not yet reviewed" list went with it —
  the quotation marks around the AI summary, and the header messages button (wired to
  the messages tab, dot removed).
  NOT built, deliberately: the "See your trends ->" lie. Fixing it properly means showing
  the athlete their own wellness graph, which is the product decision both DATA and UX
  raised as a challenge — not an agent's call, and not mine.

## 2026-09-06 — UX-003 — STRETCH: delete the athlete's home and wellness tabs
Status: PROPOSED · Verdict: TEST
All six controls on the athlete home tab are `setTab` routers; the screen holds no content
but a 120-char truncation. Replace with one scrolling "Today" ordered by obligation; nav
5 slots -> 3. Risks named honestly: the post-submit dead band, history below the fold, and
`WellnessSubmit` initialising from `{}` against an upsert on (athlete_id, check_date),
making silent overwrite easier. Cheap test first: log tab transitions for a week and see
whether `home` is ever a destination or only ever transit.
Outcome: awaiting Max

## 2026-09-06 — Challenge and cut
Challenge: we ask a 15-year-old for five numbers daily and give them nothing back.
Cut: the sessions-tab hero card. (DATA independently proposed the same cut.)
Also checked and found fine: messages composer, RSVP row, notes filter chips.

## 2026-09-05 — UX-001 — The recorder silently pre-selects the most recently added athlete, and the result cannot be undone
Status: IMPLEMENTED (2026-09-05, same day)
Verdict at proposal: BUILD NOW
Priority: (5 x 5 x 5 x 4) / 2 = 250
Grounded in: `app/components/QuickSessionModal.tsx:32-33` (the `?? athletes[0]?.id`
  fallback) · `app/dashboard/page.tsx:1586, 821, 1052, 1213, 1431` (every generic entry
  point passes no defaultAthleteId) · `app/api/athletes/route.ts:27` (ordered
  `created_at desc`, so athletes[0] is the newest athlete and changes identity whenever
  the roster grows) · `QuickSessionModal.tsx:44` (share defaults true) ·
  `app/api/sessions/route.ts:242-243` (save emails the athlete and caretakers) ·
  `app/api/sessions/[id]/route.ts:40` (athlete_id not in the PATCH allow-list) and the
  same file exporting only PATCH (no session delete exists anywhere in the app)
Evidence: a silently wrong default converts an omission into a confident assertion;
  destructive-by-default without undo. Native `<select>` is the wrong control for a
  small known one-of-N set. All four load-bearing code claims independently verified by
  the orchestrator.
Synthesis note: the proposal is bigger than the finding. The defect is the fallback; the
  chip-picker is a separate, larger change. Ship (1) alone first — the agent said so
  itself.
Carried forward: **there is no session delete and no reassign.** That survives this fix
  and is arguably the larger gap — a coach who picks the right athlete and misspeaks has
  the same problem. Deserves its own ID on a later run.
Outcome: APPROVED and BUILT — **both halves**, not just the fallback removal the
  synthesis argued for. `athletes[0]`/`groups[0]` fallbacks gone; both `<select>`s replaced
  with one-tap chips (44px-ish targets, wrapping, scroll-capped at 132px so a large roster
  still works); Start Recording *and* "Skip — type transcript manually" both disabled until
  a target is picked; a "Select a group." error added, since the group branch previously
  reported an unpicked group as "This group has no members."
  **The larger gap this agent surfaced is NOT fixed and is still live:** there is no session
  DELETE route and `athlete_id` is not in the PATCH allow-list. A session recorded against
  the right athlete but misspoken still cannot be removed. Worth its own ID.

## 2026-09-05 — Checked and explicitly found fine
- Recorder empty-roster state (`QuickSessionModal.tsx:344-347`) — real explanation, correct.
- Session date affordance (`:390-402`, `:505-518`) — defaults to today, capped at today,
  echoes Today/Yesterday/weekday, editable on both steps.
- Share-with-athlete default (`:44`) — the *right* default (27 of 40 sessions once reached
  nobody); dangerous only because it rides on the wrong athlete default.
- Re-record (`:461-475`) — correctly clears transcript, audio path, mime, and stops the
  lingering mic stream.

## 2026-09-05 — Noted, below the bar for its own ID
`QuickSessionModal`'s backdrop (`:283-293`) has no `overflow-y` and `.card-lg`
(`globals.css:95-100`) no max-height. The ~600 px review step may clip unscrollably on a
short viewport or with the keyboard raised. Could not be confirmed from code alone; a
one-line fix for whoever next touches the file.

Not examined this run: `/athlete`, messaging, wellness, calendar, onboarding.
