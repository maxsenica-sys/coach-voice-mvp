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

## Not yet reviewed

Real observations, recorded so they are not lost, but **not** agent proposals.
An agent may pick any of these up as its own recommendation on a later run.

| Noted | Area | Observation |
|---|---|---|
| ~~2026-09-05 setup~~ | ~~Design~~ | **DONE 2026-09-05** — token raised to `#6B736D` (4.61:1 on `--bg`, 4.89:1 on `--card`); 23 hardcoded `#9BA29B` instances repointed at the token. |
| ~~2026-09-06 synthesis~~ | ~~Correctness~~ | **DONE 2026-09-06** — quotation marks removed with UX-002. |
| 2026-09-06 DESIGN-002 | Design | `--primary` is used as **text** at 10 sites at 3.24–3.65:1, all failing 1.4.3. DESIGN-002 fixes two; eight remain. |
| 2026-09-09 orchestrator | Correctness | Raw `fetch` with no `res.ok` check at `app/athlete/page.tsx:256` (the wellness mount fetch) — a live violation of checklist item 1 in `CLAUDE.md`, which exists because a non-2xx silently becomes empty data. Found while verifying DATA-006; folded into that build outline. |
| 2026-09-09 orchestrator | Dead code | `COOLDOWN_MS` and `SPLASH_LAST_KEY` (`ColdStartSplash.tsx:45,51`) are declared and never used — the live cooldown and storage key are literals in `app/layout.tsx:121-123`. `npm run lint` does not flag either. |
| 2026-09-09 DESIGN-006 | Accessibility | The installed PWA disables zoom entirely (`app/layout.tsx:15-16` `maximumScale: 1`, `userScalable: false`, manifest `display: standalone`) while carrying 66 sites of sub-11 px text — no mechanism by which a user can enlarge any of it. WCAG 2.2 SC 1.4.4 requires 200%. `globals.css:590` already solves the iOS form-field auto-zoom this was presumably for. Two-line fix. Raised as a challenge, never proposed against. |
| 2026-09-09 DESIGN-006 | Design | `--coach-color` has no safe use as text on its own light tint: 3.56:1 on `--coach-light` versus 4.60:1 on white. A gap in the token set rather than a mistake on one line. `--coach-on-light: #8E3F27` (5.62:1) is the proposed fill. |
| ~~2026-09-09 build~~ | ~~Correctness~~ | **RESOLVED 2026-09-09 (`4d0929e`) — it was not a contradiction to decide, it was a bug.** `inverted: true` means "a higher raw score is worse" by the flag's own definition, but both hints ask the athlete the other way round, so `6 - raw` flipped answers that were already correct. Because `overallWellnessScore` feeds `computeWellnessAlert`, **the safeguarding alert ran backwards**: 4/4/4 with no soreness and no stress scored 2.8 and tripped the coach email; 2/2/2 while very sore and very stressed scored 3.2 and did not. Fixed by deleting the flag, not by rewriting the hints — the hints predate it (initial commit vs `e32ac64`), so stored data is already right and needs no migration. Original note: **the app contradicts itself about which way soreness runs.** `WELLNESS_METRICS` marks `soreness` and `stress` `inverted: true`, and every scoring function (`metricColor`, `metricTint`, `scoreLabel`, `overallWellnessScore`) computes `6 - raw` — so a raw 5 scores as *bad*. But the form's own hint tells the athlete "1 = very sore, 5 = no soreness", i.e. raw 5 is *good*, and PROJECT-STATE records the same reading. One of the two is wrong. This decides the colour of a dot, the coach's alert threshold and whether a caretaker email fires, so it is not cosmetic. Not fixed in the DATA-006 build: flipping it either way changes alerting behaviour and needs a decision, not a guess. The new athlete-facing sentence sidesteps it by naming only `energy` and `sleep_q`. |
| 2026-09-09 build | Process | `npm run lint` reports **135 pre-existing errors** across 53 files (mostly `no-explicit-any` in API routes). CLAUDE.md lists lint as a mandatory pre-commit gate, but a gate that has been red for a long time cannot fail a bad commit — which is part of why the `#9BA29B` regression got in. The DESIGN-006 rule works only because it is scoped to a file with zero violations. |
| 2026-09-09 orchestrator | Process | PROJECT-STATE is 316 lines against its own ~250-line budget after today's refresh, and wants a deliberate trim rather than further growth. |
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
| Entrance / splash / boot shell | 0 |
| Wellness (submit, graph, alerts) | 0 |
| Athlete home + sessions | 0 |
| Recorder / QuickSessionModal | 1 |
| Session save + summariser | 1 |
| Sign-in `/` | 1 |
| Session page `/sessions/[id]` | 2 |
| Coach dashboard home | 2 |
| Athlete profile `/athletes/[id]` | 2 |
| Messaging | 2 |
| Calendar / DayWheel | 2 |
| Groups / squads | 2 |
| Onboarding: signup, join, invite | 2 |
| PDF reports | 2 |
| Video annotation | 2 |

Areas at 2 after this round. Nothing has hit the 4+ audit trigger yet, but
messaging, calendar, groups, PDF and video annotation have now gone four rounds
without being anyone's primary subject and are the obvious candidates for the
next deliberate untouched-area audit.
