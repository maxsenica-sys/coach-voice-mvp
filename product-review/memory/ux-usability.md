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

---

## 2026-09-09 — UX-006 · the cold-start splash is a toll, not a cover

**Proposed.** Priority 160, BUILD NOW. Tied with DATA-006 on score; the orchestrator
ranked DATA-006 first (it fixes something untrue rather than something slow) but
recommended **building both in the same sitting** — disjoint files, both Effort 2.

The splash blocks the app for a minimum of **3,399 ms** on every cold start, on both
role homes. `FLOOR_MS = MARK_AT + 750 = 2939` plus `OUT_MS = 460`
(`ColdStartSplash.tsx:82-84`); ceiling 6,060 ms. Three defects behind it:

1. `leaveWhenReady` (`:155-157`) schedules dismissal at `FLOOR_MS` even when
   `markAppReady()` already fired — the wait outlives the thing it covered. The
   comment at `app/athlete/page.tsx:594-595` ("it never delays anything") is false
   in both clauses.
2. **The first painted frame has no dismiss handler.** The `pointerdown` escape is
   on the React root (`:168`), which exists only after hydration; what is actually
   on screen is `#cv-boot` (`layout.tsx:164-173`, `z-index: 9000`) with no
   listener. Taps during the exact window the shell was built to cover are swallowed.
3. The cooldown was cut from 30 minutes to **15 seconds** (`layout.tsx:122`), so
   any return after 15s away replays it. `COOLDOWN_MS` (`:51`) is dead code.

Reduced-motion users get the worst version: the floor/ceiling timers are scheduled
*before* the early return at `:179-184`, so they hold a frozen ink screen for 2.94s.

Fix: jump the timeline to `MARK_AT` when ready fires, drop the floor to ~900ms,
move the escape into `BOOT_JS` (three lines, pre-paint, zero bundle), restore the
30-minute cooldown and delete the dead constant.

**⚠️ Lesson — I got a number wrong.** I derived every timing from
`SPORTS.length = 15`. The array has **14**, and the source comment at
`ColdStartSplash.tsx:72` said "~1850 across 14 sports" — I overrode a correct
comment with a miscount. The orchestrator caught it: `MONTAGE_MS = 1849`,
`FLOOR_MS = 2939`, minimum 3,399ms. The finding survived, but **count the array,
do not eyeball it** — especially when a comment disagrees with you.

**UX-007 (STRETCH, TEST)** — delete the splash by deleting the wait: a
server-rendered `/record` as the PWA `start_url`. Needs sign-off to touch the
protected recording path. Gate: log the first user action after launch for a week;
if "record" is under half, wrong bet.

**Checked and found fine:** UX-002 survived the design pass (`:823` is still a real
`Link`); UX-001 survived (`QuickSessionModal.tsx:375,410,497`).
**Challenged:** holding the splash until ready means the worse the network, the
longer the coach stares at ink.
**Cut:** the 14-sport montage from the cold-start splash — 1,849ms of the floor, and
the splash is the only importer of the 113 KB `sportSilhouettes.tsx`.

---

## Round 5 — 2026-09-09b · net-new additions only

**UX-009 "The Receipt" (150) — PROPOSED, NOT BUILT.** The save fires four side
effects, one of them an email to a minor, and reports none: `onSaved(); onClose()`
is the whole post-save experience. It lost this round on scope — it repairs an
existing flow rather than adding a capability, and the brief was net-new only. It
is now the highest-priority unbuilt item on the register. Lead with it next time.

Declined to offer an Undo on it: there is no DELETE on `/api/sessions/[id]`, and a
receipt offering an undo it cannot honour is a worse lie than silence.

**UX-008 "Record next" (128) — SUPERSEDED, but the interaction shipped.** Same
feature as DATA-008, proposed independently. Its server-side twin was correct where
mine was not: I computed the gap client-side from `allSessions`, which is capped at
50 rows, so an athlete outside that window reads as never-recorded. I flagged the
ceiling myself and still built the design on top of it. **Lesson: when I notice a
data source is truncated, that is a reason to change the source, not a limitation
to document and design around.** What shipped kept my interaction — the face is the
button, tapping it opens the recorder pre-targeted, and the strip renders nothing
when nobody is overdue — on DATA-008's query.

**Corrected my own 2026-09-05 memory entry:** I recorded that a session save emails
"the athlete and caretakers". It emails the athlete only; caretakers are on the
wellness-alert path. Any copy written from that note would have been wrong.

**Challenged:** `shared_with_athlete` defaults ON while the coach gets no
confirmation anything was shared.
**Cut:** the three stat cards on the coach's home — tab-routers dressed as insight.
