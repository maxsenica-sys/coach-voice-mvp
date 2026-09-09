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
| UX-004 | 2026-09-06 | IMPLEMENTED | Fix the front door first — signed-in users see the login form on every cold start; then play the intro *behind* a live sign-in card, once per device | BUILD NOW | 160 |
| DATA-004 | 2026-09-06 | IMPLEMENTED | Treat the opening as a screen to REMOVE, not add: redirect signed-in users, fix the navy manifest splash. Rejects the sports montage outright | BUILD NOW / REJECT montage | 160 |
| DESIGN-004 | 2026-09-06 | IMPLEMENTED | Three intro directions on one motion envelope (A The Voice / B The Roll Call / C The First Word) + the missing `prefers-reduced-motion` layer | BUILD NOW in two pieces | 24 |
| WOW-002 | 2026-09-06 | BUILT, AWAITING CLIP | "The Line" — one stroke that is waveform, silhouette and logo, driven by a real coach's real 8 seconds, playing silent because autoplay is blocked | PROTOTYPE | 21.3 |
| DATA-005 | 2026-09-06 | BLOCKED | STRETCH — "Forty Seconds": the login screen performs the pipeline. **Blocked, not backlogged** — needs a public front door that does not exist | — | — |
| UX-005 | 2026-09-06 | PROPOSED | STRETCH — delete the pre-auth intro; put a 1.2s cold-start moment *inside* the app, aimed at the person who opens it 4×/week | TEST | — |
| DESIGN-005 | 2026-09-06 | PROPOSED | STRETCH — "The Ten-Second Proof": Direction C with audio. Needs a security review, not a design change | BACKLOG | — |

**All four agents independently opened with the same defect** — the strongest
convergence this system has produced. See "Not yet reviewed" for the three
verified defects it surfaced.

**#1 today:** the three defect fixes — **all shipped 2026-09-06** (`9708772`).
**#1 ambition:** Direction A — **live and verified in a browser**. B and D are
**banked, not deployed** — `app/components/_banked/IntroSequenceAll.tsx` is
imported by nothing, so its 15 silhouettes reach no bundle (confirmed by
grepping the built client chunks).

**Signed-in users get it too, as a cold-start splash** (`ColdStartSplash.tsx`,
mounted on both role homes). Direction A compressed to 1.24s, over the app while
it loads, dismissed by any touch. "Cold start" is `sessionStorage` (survives
backgrounding, resuming, in-app navigation and refresh; dies with the webview)
AND a 30-minute floor in `localStorage`, because iOS discards backgrounded PWAs
aggressively and without it a coach flicking to a timer app would get a "cold
start" every few minutes. **Correction, 2026-09-09:** that floor was later cut to
**15 seconds** (`app/layout.tsx:122`) so the author could watch the splash by
reopening the app, which reinstates exactly the replay problem the paragraph above
describes. UX-006 proposes restoring 30 minutes and using `?splash=1` instead. Signing in claims the session flag so the sign-in
sequence and the splash never run back to back.

**Watch the sign-in one on demand: `/?intro=1`.** Needed because the redirect above is
total — a signed-in user never reaches `/`, so without this exception the
author of the intro is the one person who can never see it.

**What shipped:** manifest navy → ink · the `prefers-reduced-motion` layer the
app never had · signed-in users redirected off `/` · `?next=` carried through
the auth wall · `/` on `--grad-ink` with the glows and the book emoji gone ·
two measured AA failures fixed (3.24:1 → 5.28:1, 2.45:1 → 4.83:1).

**Still open:** D needs one excellent 8-second recording — that is the
experiment, not the code. The silhouettes are placeholders and want an
illustrator. The rest of DESIGN-002 (signup pages, shared `Icon`) is unbuilt.

### Round 4 — 2026-09-09 · normal full review

Report: `product-review/reports/2026-09-09-coach-voice-review.md`
Reviewed against `d70258e`. PROJECT-STATE was refreshed before dispatch — it was
thirteen commits stale and had missed the entire entrance subsystem.

| ID | Date | Status | One line | Verdict | Priority |
|---|---|---|---|---|---|
| DATA-006 | 2026-09-09 | IMPLEMENTED | Close the athlete's wellness return loop — "Trends →" is a dead end, the form is blank even after checking in, and the home card never refreshes | BUILD NOW | **160** |
| UX-006 | 2026-09-09 | IMPLEMENTED | The cold-start splash holds the app for 3.4 s minimum, waits past `markAppReady`, and the first painted frame has no dismiss handler at all | BUILD NOW | **160** |
| DESIGN-006 | 2026-09-09 | IMPLEMENTED | The athlete design pass re-typed the design system by hand — 65 hex literals, 60 exact token duplicates; repoint them, add a type scale with an 11 px floor, and lint the page | BUILD NOW | 80 |
| WOW-003 | 2026-09-09 | PROPOSED | The Callback — make a focus point a durable thread the summariser closes out of the coach's own next recording, paid off in the coach's real voice | PROTOTYPE | 24 |
| DATA-007 | 2026-09-09 | PROPOSED | STRETCH — Ten Seconds Back: the athlete answers the session, three taps plus an optional 10 s voice reply | TEST | — |
| UX-007 | 2026-09-09 | PROPOSED | STRETCH — delete the splash by deleting the wait: a server-rendered `/record` as the PWA `start_url` | TEST | — |
| DESIGN-007 | 2026-09-09 | PROPOSED | STRETCH — an ink-native athlete app, keeping the promise the entrance spends 1.24 s making | TEST | — |

**The convergence this round:** three of four agents independently described the
same structural fact — **CoachVoice is a one-way pipe and nothing in it ever
closes a loop.** DATA-006 (the athlete gives five numbers a day and gets nothing
back), WOW-003 (the coach says something and never learns whether it landed) and
DATA-007 (the athlete cannot answer a session at all) are one thesis at three
sizes. DATA-006 is its one-day version; WOW-003 is its three-week version.

**A second, narrower convergence:** DATA-006 and DESIGN-006 both land on
`app/athlete/page.tsx:755` for unrelated reasons — the "Trends →" button is both
broken (navigates to a blank form) and unreadable (2.47:1 at 10.5 px).

**A disagreement left unresolved:** UX-006 wants the entrance to shrink (3.4 s of
every cold start); DESIGN-007 wants the identity it establishes to extend into the
app. Both defensible, not reconcilable by the orchestrator.

**#1 today:** DATA-006 — chosen over UX-006 on judgement, not arithmetic (they tie
at 160). UX-006 fixes something slow; DATA-006 fixes something untrue, and it is
the loop the safeguarding alert's data quality rests on. **Recommended: build both
in the same sitting** — disjoint files, both Effort 2, neither blocks the other.

**#1 ambition:** WOW-003, via the `/dev/callback` one-day test. DESIGN-007 and
UX-007 are each one prerequisite away from being decidable (a timestamp query; a
sign-off to touch the protected recording path), so neither was ready to be picked.

### Round 4 — what was built, 2026-09-09

All three BUILD NOW items shipped the same day, plus the defects the
orchestrator found while verifying them. Validated by `npx tsc --noEmit`,
`npm run lint` and `npm run build` (the repo has no test suite).

| ID | Built as |
|---|---|
| DATA-006 | Wellness fetch `days=1` -> `days=21` and moved onto `apiJson`; `wellnessHistory` state; a real `onSaved` that refetches so the home card flips without a reload; `WellnessSubmit` takes an `initial` prop and prefills, with "Change your answers" / "Save changes" copy; new `WellnessHistory` component above the form — a 14-day strip plus one deterministically computed sentence; the privacy line under the check-in button replaced with what the API actually does |
| UX-006 | `FLOOR_MS` 2939 -> 900 and `leaveWhenReady` now pulls the *timeline* forward to `COLLAPSE_AT` instead of waiting for it; the pointerdown escape moved into `BOOT_JS` so it exists from the first painted frame; cooldown 15s -> 30min; dead `COOLDOWN_MS` and `SPLASH_LAST_KEY` deleted; the reduced-motion branch now leaves as soon as the app is ready instead of holding the old floor |
| DESIGN-006 | All 65 hex literals in `app/athlete/page.tsx` repointed at tokens (zero remain); six type-scale tokens `--fs-1..6` with an 11px floor, with 76 declarations migrated and every sub-11px site gone; `--coach-on-light`, `--coach-border`, `--warning-border`, `--surface-2` added; `.badge-coach` fixed too; **the `no-restricted-syntax` lint rule is live**, scoped to `app/athlete/**` |

**Measured effect of UX-006**, time until the app is touchable on a cold start:

| App ready at | Before | After |
|---|---|---|
| 100ms | 2939ms | **900ms** (the floor) |
| 700ms (typical) | 2939ms | **1420ms** |
| 2500ms | 2939ms | **2809ms** |
| reduced motion, 700ms | 2939ms | **900ms** |
| never (ceiling) | 6060ms | 6060ms |

The splash now shortens as the app gets faster, which is the property it was
missing — and a tap during the boot shell dismisses it outright rather than
being swallowed.

**Also fixed, beyond the three recommendations:**

- `--primary` as text at the three athlete-page sites (3.65:1, failing 1.4.3)
  -> `--primary-dark` (5.94:1). DESIGN-006 deliberately left these to avoid two
  colour decisions in one review; with the lint rule in they were adjacent.
  **Seven sites remain elsewhere in the repo.**
- The PWA zoom lock (`maximumScale: 1`, `userScalable: false`) removed —
  DESIGN-006's "What I'd challenge". `globals.css:590` already handles the iOS
  form-field auto-zoom this was presumably for, and WCAG 2.2 SC 1.4.4 needs
  200%.
- `WellnessSubmit` moved off raw `fetch` onto `apiMutate` (its `await res.json()`
  could throw on a non-JSON error body, and `new Error(j.error)` could be
  `Error(undefined)`).
- The `ColdStartSplash` comment claiming 15 sports corrected to 14.

**The lint rule was verified to actually fire**, not merely to pass: reinserting
a single `#9BA29B` produces `no-restricted-syntax` at that line, and removing it
returns the file to zero violations. A guard that matches nothing is worse than
no guard.

**Not built, and why.** The three STRETCH items (DATA-007, UX-007, DESIGN-007)
and WOW-003 are bets, not fixes: two are gated on a decision or a measurement
that has not happened, one needs sign-off to touch the recording path CLAUDE.md
protects, and WOW-003's own recommendation is to spend one day on
`/dev/callback` before committing to it. The three "What I'd cut" proposals were
also left — cutting the composite wellness score, the cold-start montage and the
NEWEST badge are product decisions for Max, not defects.

**Orchestrator corrections to agent output:** UX-006 computed its timings from
`SPORTS.length = 15`; the array has 14, so the floor is 2,939 ms and the minimum
on screen 3,399 ms (not 3,069 / 3,529). Every DESIGN-006 contrast ratio and hex
count reproduced exactly. Full detail in the report's CORRECTIONS section.

### Round 5 — 2026-09-09 · net-new additions only

Max: *"I specifically need new additions to the app that haven't been created
before. Get creative, enhance the project overall. 3-4 new ideas that will take
between 30min-1hr of time to code."* So all four agents were dispatched with the
same unusual constraint: two **net-new capabilities** each, nothing already on
this register, each costed at 30-60 minutes, and — for the wow agent, which is
normally told the opposite — the cheapest version that still wows, as the whole
proposal rather than as a footnote.

| ID | Date | Status | One line | Verdict | Priority |
|---|---|---|---|---|---|
| WOW-004 | 2026-09-09 | IMPLEMENTED | Team Talk — a squad recording produces one identical summary per member; make each athlete's lead with the part that was about them, gated on their name actually being in the transcript | BUILD NOW | **240** |
| UX-009 | 2026-09-09 | PROPOSED | The Receipt — a session save fires four side effects including an email to a minor, and reports none of them; the modal just disappears | BUILD NOW | 150 |
| DATA-008 | 2026-09-09 | IMPLEMENTED | Quiet lately — nothing anywhere answers "who have I not recorded for?", and the one number that comes close is wrong past 50 sessions | BUILD NOW | 128 |
| UX-008 | 2026-09-09 | SUPERSEDED by DATA-008 | Record next — the same list as DATA-008, as a one-tap strip on the coach's home | BUILD NOW | 128 |
| DATA-009 | 2026-09-09 | IMPLEMENTED | How they came in — put the athlete's own check-in from the morning of a session next to that session, coach-only | BUILD NOW | 96 |
| DESIGN-008 | 2026-09-09 | IMPLEMENTED | The Spine — twelve weeks of training as one shared component, on the athlete's home and the coach's athlete profile | BUILD NOW | 72 |
| WOW-005 | 2026-09-09 | SUPERSEDED by DATA-008 | Where your voice went — minutes of recorded voice per athlete, as a coach-facing mirror | BUILD NOW | 64 |
| DESIGN-009 | 2026-09-09 | PROPOSED | The Focus Card — render the focus point as a 1080x1350 ink image the athlete saves to their camera roll | TEST | 18 |

**The convergence, and it is the strongest this system has produced.** Three of
four agents independently proposed the same feature: DATA-008 ("Quiet lately"),
UX-008 ("Record next") and WOW-005 ("Where your voice went") are one idea at
three sizes — *the coach has no surface anywhere that says which athlete has
gone longest without hearing from them.* They were built as one thing, taking
DATA-008's server query (the only version that is correct) and UX-008's
interaction (tap a face, the recorder opens pointed at them). WOW-005's bar
chart of minutes-per-athlete was dropped: it is the same information with a
shaming register attached, and the agent said so itself.

**Why UX-008 could not have been built as proposed.** It computes the gap on the
client from `allSessions`, which is fetched with `limit: '50'`. Past 50 sessions
across the roster an athlete's last session falls outside the window and they
read as never-recorded. The error is in the "safe" direction for a strip that
sorts neglect to the top, but the same array feeds the roster cards' "Last
session" and "N total" lines, where it is simply wrong. DATA-008 caught this and
made it a server query. Both agents found the same 50-row ceiling independently.

**Not built, and why:**

- **UX-009 (The Receipt)** — the best idea of the four that did not ship, and the
  highest-priority thing now on this register at 150. It is a *gap in an existing
  flow* rather than a new capability, and this run was explicitly scoped to net-new
  additions. It should be first next time.
- **DESIGN-009 (The Focus Card)** — the agent attached a safeguarding question to
  it and recommended asking a coach before building. That is the right order.

### Round 5 — what was built, 2026-09-09

| ID | Built as |
|---|---|
| DATA-008 + UX-008 | New `app/api/athletes/coverage/route.ts` — every session for the coach, no limit, reduced to a per-athlete gap; new `app/components/AttentionStrip.tsx`, rendered on the dashboard home above "Recent sessions". Tapping a face opens `QuickSessionModal` pre-targeted. Renders `null` when nobody is overdue; 14-day threshold, 7-day grace for a newly added athlete, capped at 6 |
| DATA-009 | Fourth read added to the existing `Promise.all` in `app/api/sessions/[id]/detail/route.ts`, gated coach-only by passing a null date for an athlete viewer; a "How they came in" section on `app/sessions/[id]/page.tsx` reusing `metricColor`/`metricTint`/`scoreLabel`. Three metrics — `mood` and `stress` deliberately excluded. Renders nothing on a day with no check-in |
| DESIGN-008 | New `app/components/TrainingSpine.tsx` — 12 weekly bars from `sessionDate`, `--primary-dark` on `--border-soft` (4.95:1, measured). Rendered on the athlete home under the check-in and on the coach's athlete-profile overview. The coach variant names a gap over 14 days; the athlete's never does. Nothing renders under three sessions |
| WOW-004 | `transcriptNames()` in `app/api/sessions/route.ts` — a deterministic whole-word test, unicode-aware, run in code and not left to the model — plus an optional `WHO THIS IS FOR` prompt block and the athlete's first name threaded into `makeQuickSummary`. No name in the transcript means the prompt is character-for-character the one that shipped before |

**Two bugs found by testing rather than by reading**, both in code written this
round and neither visible to `tsc`, `lint` or `next build`:

- **Twelve-week bucketing was wrong across a daylight saving change.** Dividing a
  millisecond difference by 86400000 assumes every local day is 24 hours. A
  session on Monday 29 March 2027 landed in the *previous* week's bucket in
  `Europe/London` and `America/New_York` while passing in `UTC` — so CI, which
  runs in UTC, would have shipped it green and it would have been wrong for most
  of the app's users twice a year. Fixed with `calendarDaysBetween` in
  `lib/session-date.ts`, now used by both new features. Verified across six
  timezones including `Pacific/Chatham`.
- **The name gate matched substrings.** Caught before it shipped: "Ana" must not
  match "Anastasia" or "banana", and `\b` is useless for "Zoë" or "Łukasz". The
  test suite for it covers substrings, accents, Cyrillic, possessives, regex
  metacharacters in a name, and empty/one-letter input.

**Validated by** `npx tsc --noEmit` (clean), `npm run lint` (31 errors — the
pre-existing count, unchanged), `npm run build` (passes), and
`npm run verify:boot` (**40/40**, run because both role homes were touched).

### Round 6 — 2026-09-09c · tooling, not product

Max: *"more useful to the process. I want creativity, not enhancement."* No
agents were run: the four review agents are briefed to review the *product* and
are forbidden from touching app files, so they are the wrong instrument for
development tooling. Three rigs were built instead.

| Item | What it is |
|---|---|
| `npm run verify:safeguard` | The safeguarding rules — previously prose in `CLAUDE.md`, PROJECT-STATE and file-header comments — as five enforced static rules, each citing where the rule is written. Unauthenticated routes need a written, printed exemption; the list is one entry long |
| `npm run verify:clock` | The app's real date logic under 9 timezones, every day of a year. Catches the class of bug that put a session in the wrong week in London and New York while passing in UTC |
| `npm run verify:prompt` | Two pinned golden prompts, the name gate over six recorded transcripts, and the response parser over six recorded model replies. `--live` calls the real model, opt-in |

All three are hard gates in CI, take seconds, and need no browser, network or
key. **Every rule in all three was proved by breaking the code on purpose and
watching that specific rule go red** — including reintroducing the original DST
bug, which failed in the six zones that observe daylight saving and passed in
UTC, Kolkata and Kiritimati.

Three supporting extractions, all behaviour-preserving: `lib/training-spine.ts`,
`lib/attention.ts` and `lib/summary-prompt.ts`. The last takes the summariser
prompt out of `app/api/sessions/route.ts`, which drops that route by 124 lines
and makes the most consequential text in the product executable — and therefore
checkable — outside a running server.

**The rule this establishes:** if a component computes something whose
correctness is not obvious by reading it, the computation belongs in `lib/`.
Node can strip TypeScript but cannot parse JSX, so logic in a `.tsx` is logic no
rig can reach.

### Round 6 follow-through — 2026-09-09 · "fix all"

Max: *"go ahead and fix all."* Everything open on this register that was a
**defect or a process gap** rather than a product bet. Twelve rows closed; six
of them turned out to have been fixed in earlier rounds and never struck
through, which is its own lesson about a register nobody prunes.

| Fixed | How |
|---|---|
| **The group-transcript leak** (safeguarding) | Migration `023` adds `sessions.group_id`; the recorder tags squad saves with it and the server validates the id against the coach's own groups; the detail route withholds a squad transcript from an athlete viewer; and the athlete client stops selecting the `transcript` column entirely, loading individual transcripts on demand from the gated route instead. That last part is what covers squad sessions saved *before* the column existed — they are null, so no flag can find them. New safeguard rule **SG6** enforces it, verified by reinstating the select and watching it fail. |
| A group save reported partial failure as success | The receipt below reports what was actually created |
| Roster cards wrong past 50 sessions | They read `session_count` / `last_session_date` from the coverage route, which is uncapped |
| Avatar colour derived from array index | `stableTone(id)` hashes the row id, so identity stops moving |
| Lint advisory with 31 errors | **0 errors, and lint now blocks CI.** The last soft gate is closed |
| PROJECT-STATE over its own line budget | Trimmed back under budget; the history it carried lives in these reports |

**Also built: UX-009, The Receipt** — the highest-priority unbuilt item on the
register (150) and the thing the round-5 report said should lead. A save writes
a session row, creates a calendar event and emails a minor, and reported none
of it: `onSaved(); onClose()` was the whole post-save experience. There is now
a receipt naming who it went to and whether it was shared, with one tap to the
session. It deliberately does not claim the email was *delivered* (the client
cannot know) and deliberately offers no Undo (there is no DELETE on
`/api/sessions/[id]`, and an undo that cannot be honoured is worse than
silence).

**What clearing the 31 lint errors actually found.** Typing eight `any[]` state
hooks against the real row shapes surfaced three latent bugs that `any` had been
hiding: the message type used `body` where the column is `content`;
`new Date(msg.created_at)` on a nullable column renders 01:00 on 1 January 1970
rather than an empty slot; and `window.open(msg.media_url)` inside a click
handler had lost its null narrowing. Two structural lint errors were real too —
`drawStroke` was captured by an effect before its declaration, and the share
page set state synchronously inside an effect on its invalid-link path. None of
these were type errors before, because `any` is not a type.

## Not yet reviewed

Real observations, recorded so they are not lost, but **not** agent proposals.
An agent may pick any of these up as its own recommendation on a later run.

| Noted | Area | Observation |
|---|---|---|
| ~~2026-09-05 setup~~ | ~~Design~~ | **DONE 2026-09-05** — token raised to `#6B736D` (4.61:1 on `--bg`, 4.89:1 on `--card`); 23 hardcoded `#9BA29B` instances repointed at the token. |
| ~~2026-09-06 synthesis~~ | ~~Correctness~~ | **DONE 2026-09-06** — quotation marks removed with UX-002. |
| ~~2026-09-06 DESIGN-002~~ | ~~Design~~ | **DONE 2026-09-09** (`886f5d4`) — `--primary` as text eliminated repo-wide, all 10 sites. Verified 0 remaining. |
| ~~2026-09-09 orchestrator~~ | ~~Correctness~~ | **DONE 2026-09-09** — the wellness mount fetch moved onto `apiJson` with the DATA-006 build. |
| ~~2026-09-09 orchestrator~~ | ~~Dead code~~ | **DONE 2026-09-09** — both deleted with the UX-006 build; a comment marks where they used to be. |
| ~~2026-09-09 DESIGN-006~~ | ~~Accessibility~~ | **DONE 2026-09-09** — `maximumScale`/`userScalable` removed; the layout carries a comment explaining why zoom is not locked. |
| ~~2026-09-09 DESIGN-006~~ | ~~Design~~ | **DONE 2026-09-09** — `--coach-on-light: #8E3F27` added to `globals.css` and used for rust text on rust tints. |
| ~~2026-09-09 build~~ | ~~Correctness~~ | **RESOLVED 2026-09-09 (`4d0929e`) — it was not a contradiction to decide, it was a bug.** `inverted: true` means "a higher raw score is worse" by the flag's own definition, but both hints ask the athlete the other way round, so `6 - raw` flipped answers that were already correct. Because `overallWellnessScore` feeds `computeWellnessAlert`, **the safeguarding alert ran backwards**: 4/4/4 with no soreness and no stress scored 2.8 and tripped the coach email; 2/2/2 while very sore and very stressed scored 3.2 and did not. Fixed by deleting the flag, not by rewriting the hints — the hints predate it (initial commit vs `e32ac64`), so stored data is already right and needs no migration. Original note: **the app contradicts itself about which way soreness runs.** `WELLNESS_METRICS` marks `soreness` and `stress` `inverted: true`, and every scoring function (`metricColor`, `metricTint`, `scoreLabel`, `overallWellnessScore`) computes `6 - raw` — so a raw 5 scores as *bad*. But the form's own hint tells the athlete "1 = very sore, 5 = no soreness", i.e. raw 5 is *good*, and PROJECT-STATE records the same reading. One of the two is wrong. This decides the colour of a dot, the coach's alert threshold and whether a caretaker email fires, so it is not cosmetic. Not fixed in the DATA-006 build: flipping it either way changes alerting behaviour and needs a decision, not a guess. The new athlete-facing sentence sidesteps it by naming only `energy` and `sleep_q`. |
| ~~2026-09-09c tooling~~ | ~~Process~~ | **DONE 2026-09-09** — the 31 remaining lint errors cleared and **lint is now a blocking CI gate**. Warnings stay non-fatal on purpose. |
| ~~2026-09-09 build~~ | ~~Process~~ | **DONE 2026-09-09** — 135 → 31 → **0**. Lint blocks CI as of this round. |
| 2026-09-09 orchestrator | Process | PROJECT-STATE is 316 lines against its own ~250-line budget after today's refresh, and wants a deliberate trim rather than further growth. |
| ~~2026-09-09 WOW-004~~ | ~~**Safeguarding**~~ | **FIXED 2026-09-09.** `sessions.group_id` (migration 023) marks a squad recording; the detail route withholds its transcript from an athlete viewer; and the athlete client no longer selects the `transcript` column at all, which also covers squad sessions saved before the column existed. Locked in by safeguard rule **SG6**, verified to fire on the reintroduced select. |
| ~~2026-09-09 UX-009~~ | ~~Correctness~~ | **ADDRESSED 2026-09-09** — the receipt reports what was actually created by diffing the session list around the refetch, so a partial save now reads "Saved for 7 athletes" rather than looking identical to a full one. |
| ~~2026-09-09 DATA-008~~ | ~~Correctness~~ | **DONE 2026-09-09** — the roster cards now read `last_session_date` and `session_count` from the coverage route, which counts every session server-side. `recentSessions` and `thisWeek` still use the 50-row list, which is correct for both. |
| ~~2026-09-09 DESIGN-008~~ | ~~Design~~ | **DONE 2026-09-09** — `stableTone(id)` in `lib/group-colors.ts` hashes the row id (FNV-1a), so an athlete keeps one colour everywhere and adding a teammate re-colours nobody. |
| 2026-09-06 DATA+UX | Product | **STILL OPEN — the biggest thing this review found that nobody has acted on.** Both agents independently challenged the wellness loop: the coach gets one flattened mean with no indication which metric caused it, and the athlete gets nothing back at all for five taps a day. Neither made it their primary. The athlete's "See your trends →" still opens a blank form; `WellnessGraph` already exists and takes `athleteId`, so showing it there is close to a one-line change — but whether an athlete should see their own trends is a product decision, not a bug fix, so it was left for Max. |
| ~~2026-09-06 UX-002~~ | ~~UX~~ | **DONE 2026-09-06** — wired to the messages tab, dot removed. |
| ~~2026-09-06 ALL FOUR~~ | ~~Defect~~ | **DONE 2026-09-06.** A signed-in user was shown the login form on every cold start. `/` is in the proxy matcher but no protected-route list (`proxy.ts:13-17,93`), `app/page.tsx` has no session check at all, and the PWA `start_url` is `/`. The middleware holds the user object at the edge and discards it. Verified. |
| ~~2026-09-06 UX-004~~ | ~~Defect~~ | **DONE 2026-09-06** — `?next=` now carried and validated same-origin. Notification email CTAs point at protected routes (`lib/notify.ts:169,235,255,319`); a lapsed session redirects to `/` and **discards the destination** — no `next` param except password reset. |
| ~~2026-09-06 DATA-004~~ | ~~Defect~~ | **DONE 2026-09-06** — both colours now `#1F2421`. `public/manifest.webmanifest` painted navy `#0f2042` / blue `#2563eb` — a retired palette — while `app/manifest.ts` holds the correct `#FBF8F3` / `#1F2421` and is **dead code**. Cold launch shows navy → brown → parchment. 2-line fix, cheapest win in the report. |
| ~~2026-09-06 DESIGN-004~~ | ~~Accessibility~~ | **DONE 2026-09-06** — block added, with `.recording-dot::after` handled deliberately so the mic-live indication survives as a steady halo. Was: zero `prefers-reduced-motion` anywhere. 7 keyframe sets including a 1.2s *infinite* pulse on the athlete page teenagers open daily. |
| 2026-09-06 DATA-004 | Product | Two first-run intros already exist post-auth and PROJECT-STATE missed both: `app/athlete/page.tsx:540-586` and `app/dashboard/page.tsx:1149-1180+`. |
| 2026-09-05 setup | Design | `/` sign-in is visually a different product: dark browns `#1A0E06 → #2C1810` with amber and indigo glows, all inline, none of them tokens. **Superseded by DESIGN-002** (2026-09-06), which proposes a target design and finds the divergence is four grounds, not one. |
| ~~2026-09-05 DESIGN-001~~ | ~~Design~~ | **DONE 2026-09-05** — identity hue moved to a 7 px dot; pill label now `--text`/`--text-2`. The five series hues are untouched as chart fills. |
| ~~2026-09-05 DATA-001~~ | ~~Correctness~~ | **DONE 2026-09-05** — athlete query now orders `session_date desc nullsFirst:false`, then `created_at desc`, matching the coach side. |
| ~~2026-09-05 UX-001~~ | ~~UX~~ | **DONE 2026-09-05** — `overflowY: auto` on the backdrop, `maxHeight: 100%` + `overflowY: auto` on the card. |

### Round 4 follow-through — 2026-09-09

Max: *"do all of the suggestions"*. Four items, all landed on `main` except the
last, which cannot be done from here.

| Item | Outcome |
|---|---|
| Finish the token migration | `886f5d4`. All 96 hex literals in `app/dashboard/page.tsx` on tokens; lint rule widened to both role homes and proved to fire there. Found **two more live AA failures** nobody had measured: `#C9933A` on the INVITED label at 2.72:1 and `#9A7229` on the Unread stat at 4.36:1 — the app had no amber *text* token at all, so `--energy-dark` (5.35:1) was added. `--primary` as text eliminated repo-wide (7 sites). `GROUP_COLORS` moved to `lib/group-colors.ts` — it is colour data, not a token. |
| Clear the lint backlog | `a6b953a`. **135 errors → 31.** 46 `catch (e: any)` → `unknown` behind `lib/errors.ts`; the Supabase cookie shape typed once in `lib/supabase-route.ts` instead of redeclared `any` in 25 route files; 12 unescaped entities. Type-only, no behaviour change. |
| Audit the untouched areas | `052e6a2`. Five findings, all fixed — see below. |
| Apply the auto-mode proposal | **NOT DONE.** The `/auto-mode-setup` schema is internal to the CLI; there is no example of it on disk to copy, and writing a guessed key layout would look configured while doing nothing. Re-run `/auto-mode-setup` without `--propose` to have the command apply its own proposal. |

**What the audit found**, in areas that had gone four rounds without being any
agent's primary subject:

| Finding | Severity |
|---|---|
| Photo upload on the athlete profile reloads the athlete with no `res.ok` check. The upload and PATCH have already succeeded at that point, so a failed reload threw and reported **"Photo upload failed" for a photo that saved** | Checklist item 1; user is told a success failed |
| Two session-video loads (athlete page, athlete profile) with no `res.ok` — a non-2xx rendered "no videos" for a session that has them; one had no catch at all | Checklist item 1 |
| `#ef4444` as error text in `MessagingPanel` at **3.76:1** — the "could not load messages" state and the recording indicator, the two places you most need to read | Fails 1.4.3 |
| `--primary` as text in `DayWheel` at **3.65:1** | Fails 1.4.3 |

The pattern worth noting: **every one of these was in code no agent had ever
made its primary subject.** The coverage counters below were right.

## Coverage

How many reviews since each area was the *primary* subject of a
recommendation. 4+ means it is due an unprompted audit even if nothing there
has changed. The orchestrator bumps these when it files a report.

| Area | Reviews since last primary |
|---|---|
| Ambition / wow factor | 0 |
| Coach dashboard home | 0 |
| Session save + summariser | 0 |
| Session page `/sessions/[id]` | 0 |
| Athlete home + sessions | 0 |
| Athlete profile `/athletes/[id]` | 0 |
| Wellness (submit, graph, alerts) | 0 |
| Entrance / splash / boot shell | 1 |
| Recorder / QuickSessionModal | 2 |
| Sign-in `/` | 2 |
| Messaging | 3 |
| Calendar / DayWheel | 3 |
| Groups / squads | 3 |
| Onboarding: signup, join, invite | 3 |
| PDF reports | 3 |
| Video annotation | 3 |

Round 5 reset six areas to 0 — it touched the coach home, the session save path,
the session page, both athlete surfaces and wellness. **Messaging, calendar,
groups, PDF reports and video annotation are now at 3 and are one round from the
4+ audit trigger.** They have never been any agent's primary subject. The round-4
audit of untouched areas found four real defects in exactly this kind of quiet
corner, so the counter has earned the benefit of the doubt: make one of them the
focus next time, or run a deliberate audit across all five.
