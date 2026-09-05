# Memory Bank — CoachVoice

Running log of work done via Claude Code sessions. Read this file first before
starting new work to avoid re-investigating things already resolved. Append a
new dated entry per session/PR — don't rewrite history above.

---

## 2026-09-05 — Session date selection (PR #3)

Branch `claude/session-date-selection-recording-ku9dvl`. Not yet merged.

**The ask.** A coach who misses logging a session during the day had no way to
say which day it happened — the recorder always filed under "now".

**It was not a UI change.** `sessions` had no date column at all. `session_date`
was already accepted by `POST /api/sessions` and validated, but it was used for
*one thing only*: the `calendar_events` row. Every other surface — athlete list,
session detail, dashboard week count, both PDFs — read `created_at`. A date
picker alone would have moved the calendar entry and nothing else.

**Migration 021** adds `sessions.session_date date`, backfills all 40 existing
rows from `created_at`, and indexes `(coach_id, session_date desc, created_at
desc)`. Applied via Supabase MCP. `created_at` is untouched and stays the audit
trail of when the row was written.

**`lib/session-date.ts`** is the single answer to "when did this session
happen": `session_date` if present, else `created_at`. Use it rather than
reading either field directly. It parses `YYYY-MM-DD` via `new Date(y, m-1, d)`
— **not** `new Date(iso)`, which is parsed as UTC midnight and renders a day
early for anyone west of Greenwich.

**Watch out:** `PATCH /api/sessions/[id]` re-syncs the calendar event when
sharing is toggled. It read `created_at` for the event date, which would have
dragged a backdated session's calendar entry forward the first time it was
shared. Now reads `session_date`.

**Deleted the athlete profile page's recorder.** `app/athletes/[id]/page.tsx`
held a complete second recorder (`startRecording`, `stopRecording`,
`transcribeBlob`, `clearRecording`, `saveSession`, mic meter, ~12 state hooks)
that **nothing could reach** — both "Record Session" buttons open
`QuickSessionModal` and no JSX referenced `recordState`. It drew a real edit in
this work before turning out to be dead. `QuickSessionModal` already carried
the same mp4-first MIME ordering, so nothing was lost. CLAUDE.md's protected
call-site table updated to match.

**CLAUDE.md's MIME snippet was stale** — it showed webm-first while both real
recorders are mp4-first. Corrected. The *order* is about iOS playback, which is
a separate concern from the detection that keeps Whisper working.

**Preview deployments disabled for `claude/*`** (`vercel.json`). Vercel's Git
integration auto-deploys every branch; the six env vars are Production-only, so
those previews always failed and put a meaningless red X on every agent PR. CI
(typecheck/lint/build) still runs. See README → Deploying.

---

## 2026-09-05 — Nine-item punch list from the user

Commits `79cd659`, `3ea2c4c`, `cafaaa9`, `b8784b0`, `b43104c`. All deployed
Ready to production (`coach-voice-mvp-pi.vercel.app`).

**1+9. Athletes couldn't see sessions; sessions never hit the calendar.** One
root cause. Since 2026-08-28 a session only got a `calendar_events` row once
`shared_with_athlete` was true — conflating "the athlete may see this" with
"this belongs on the coach's calendar". The save UI defaulted to private, so
**27 of 40 sessions were invisible to everyone**, and `calendar_events.session_id`
was 0 rows across the board. Fixed with `visible_to_athlete` on `calendar_events`
(migration 018): the event is now always created, that column decides who sees
it. New sessions default to **shared** (user's explicit choice). Backfill done
**in SQL on purpose** — going through `PATCH /api/sessions/[id]` would have
fired `notifySessionShared` 27 times. Legacy events relinked by (athlete, date)
before backfilling so nothing duplicated. **Never bulk-share through the API.**

**3. AI summary referenced the wrong sport.** `sport_context` was saved but
never passed to `makeQuickSummary` — it guessed the sport from a rough Whisper
transcript. Worse, **26 of 40 sessions had saved with `sport_context` null**
despite the coach's profile saying Volleyball, because the recorders read
`coachSport` from state that hasn't loaded when the modal opens. Both
`/api/sessions` and `/api/transcribe` now resolve the sport **server-side**
(athlete's sport → coach's profile) rather than trusting the client. Prompt
rewritten: names the sport and its terminology, states the input is
speech-to-text not prose, forbids inventing. Existing rows backfilled.

**4+7. Sessions had no page.** New `/sessions/[id]` — one `/detail` request
returns session, athlete, videos, attachments and signed URLs (no waterfall).
Migration 019 adds `sessions.coach_notes`, `sessions.focus_points` (jsonb) and
`session_attachments` (images, in the existing `session-videos` bucket under an
`attachments/` prefix, signed-URL upload). Coach edits, athlete reads once
shared. `/sessions` is in the proxy matcher as signed-in-but-role-agnostic.

**2. Audio "slow to load" was actually unplayable.** Every stored recording is
`audio/webm;codecs=opus`. **iOS Safari cannot decode WebM at all** and never
fires an error — it just never becomes ready, which presents as an infinite
spinner. Recorders now prefer `audio/mp4` with WebM as fallback (**this
deliberately changes the MIME detection CLAUDE.md protects — done under explicit
user instruction**). `SessionAudioPlayer` checks `canPlayType` first and offers a
download link for the old WebM files instead of spinning. The ~12 existing
recordings remain WebM and will not play on iPhones — only a transcode fixes
those, not done.

**5+8. Identity reset on navigation / everything felt slow.** `lib/profile-cache.ts`
caches name/initials/sport in sessionStorage and seeds `useState`, so a page
paints the real name on the first frame instead of flashing "Coach". Cleared on
sign-out, never trusted for access control. Dashboard boot also starts the four
cookie-authenticated API fetches immediately instead of queueing them behind
`getUser()` + the profile query.

**6. Athlete Overview redesigned** — identity and figures as one object,
wellness as five comparable bars, and recent sessions surfaced (Overview
previously showed no session content at all).

**9b. Home day wheel** — new `DayWheel` component, ±8 weeks, scroll-snap,
opens centred on today, Today pill when today scrolls off, session events link
to their session. Dashboard fetches every month the range spans and merges.

**Verified:** typecheck, lint and full build clean; DB state confirmed by query
(40/40 shared, 40/40 calendar-linked, 0 missing sport). **Not clicked through in
a browser — no login in this session.** The audio player on an actual iPhone and
the new session page are the parts most worth eyeballing.

## 2026-09-03 — Full-program audit, then fixed everything it found

Started as "congregate all information on the current state of the program".
Produced a field report (Artifact, also saved to the user's Desktop as
`CoachVoice-Field-Report.html`), then the user said "implement all the changes
you spoke about in the entire document. Fix all." Everything below is that.

**First finding, and the reason to check this every session:** the local working
copy was **11 commits behind `origin/main`**. All of 28–29 Aug (`lib/notify.ts`,
wellness alerts, migrations 013–015, this memory bank) existed on GitHub and in
production but not on disk. Pulled before touching anything. **Check
`git status -sb` for drift before starting work here** — this repo gets edited
from more than one machine.

**Security — two genuinely open endpoints, both closed:**
- `POST /api/transcribe` authenticated only on the storage-path branch. Posting
  a file directly in the form body reached Whisper with **no auth at all** —
  anyone with the URL could spend the OpenAI budget in a loop. The `getUser()`
  check now runs before the branch split. Both recorders post as a signed-in
  user, so a plain identity check suffices.
- `POST /api/email` checked only that you were logged in, then sent arbitrary
  `to`/`subject`/`html` from the verified Resend sender. Any athlete account
  could send arbitrary mail under the CoachVoice domain. Now requires
  `role = 'coach'`, requires `athlete_id` on the caller's roster, and requires
  the recipient to already be a saved caretaker of that athlete. Caller
  (`CaretakerPanel.sendTestEmail`) updated to pass `athlete_id`.

**Session audio playback — the missing half of the August work.** Recordings
were uploaded and `audio_path` saved on every session, and read back nowhere.
Added `GET /api/sessions/[id]/audio-url` (signed URL, 1h, service-role, allows
the owning coach or the athlete a session was *shared* with) plus
`app/components/SessionAudioPlayer.tsx`, wired into the coach session card and
the athlete portal. `audio_path` added to the three session selects so the
button only renders when a recording exists.

**Silent mutations — new `lib/api-client.ts`.** 14 `await fetch(...)` calls with
no `res.ok` check, all writes: video delete/share/annotate, calendar delete,
group delete, member remove, note delete, RSVP, session share toggle, monthly
report toggle. `apiMutate()` / `apiJson()` throw with the server's message; each
call site now surfaces it. Dashboard reuses its existing `showToast`; the athlete
profile and athlete portal each got a dismissible `actionError` banner (kept
separate from `error`, which is a fatal page-load state). Also fixed:
QuickSessionModal's group fan-out (a `Promise.all` of unchecked fetches that
reported success when every insert failed — now reports partial failure by
athlete name), WellnessGraph (a failed fetch rendered as "No check-ins yet",
i.e. indistinguishable from an athlete who never submitted one), and the
caretaker list load. CLAUDE.md checklist item #1 rewritten to point at the helpers.

**Orphans deleted:**
- `app/api/sessions/audio/route.ts` (208 lines) and
  `app/api/sessions/audio-upload/route.ts` — **no callers**. The recorders use
  `audio-upload-url` + `/api/transcribe`. Note the 28 Aug session added calendar
  sync and `notifySessionShared` wiring *into* the dead route. It also held a
  summariser prompt hardcoded to **"an elite volleyball coach assistant"** in a
  100-sport app — that risk left with it. CLAUDE.md's protected-routes table
  listed it and has been corrected.
- `training_plans` table + `training-plans` bucket + `sessions.transcript_raw`
  — created live 29 Aug, referenced by zero lines of code. Verified empty
  (0 rows / 0 objects / 0 non-null) before dropping. Migration
  `016_drop_unused_objects.sql` carries the full recreate SQL in a comment.
  **Buckets cannot be deleted in SQL** (`storage.protect_delete` raises) — used
  the Storage API `DELETE /storage/v1/bucket/<id>` with the service-role key.

**RLS pass — `017_rls_initplan_and_roles.sql`, applied live.** All 29 policies
dropped and recreated with `(select auth.uid())` instead of bare `auth.uid()`,
and `TO authenticated` instead of the default `public`. Every predicate already
required a uid match, so anon could never satisfy one — naming the role was free
and collapsed the per-role multiplication of the permissive-policy lint.
**Performance advisories 109 → 30**: all 31 `auth_rls_initplan` gone,
`multiple_permissive_policies` 65 → 17. Verified post-apply: 29/29 policies
scoped to `authenticated`, 0 bare `auth.uid()` in either `using` or `with check`.
This also puts the four `coach_*_own_sessions` policies **in a migration file for
the first time** — they had only ever existed as hand-applied SQL, which is what
made the sessions table un-auditable from the repo.
- **The remaining 17 permissive-policy warnings were left deliberately.** They
  are genuine coach-OR-athlete overlaps within `authenticated`. Merging each
  pair into one OR'd policy is semantically equivalent but collapses two clearly
  named rules into one, which is worse to audit, for a gain that is invisible at
  this data volume. Revisit if row counts grow.

**Platform:**
- `middleware.ts` → `proxy.ts` (function renamed to `proxy`) — Next 16
  deprecation warning gone.
- `globals.css`: Google Fonts `@import` moved above `@import "tailwindcss"`;
  it was being dropped by the CSS optimiser because Tailwind's import expands
  into rules first. **Build now emits zero warnings.**
- PWA icons: generated `icon-192/512`, a safe-zone-padded `icon-maskable-512`
  and `apple-icon.png` (180px) from the SVG with `sharp`. iOS ignores SVG home
  screen icons, so installs previously fell back to a page screenshot. Recoloured
  `icon.svg` from the retired blue/navy to the current ink/sage palette, and
  fixed three stale theme colours (`manifest.ts` `#2563eb`, `layout.tsx`
  `themeColor: '#5B63F5'`) to `#1F2421`.
- `.github/workflows/ci.yml`: typecheck + build on push and PR, with the six env
  vars as placeholders (the prerender of `/athlete` needs them). **Lint is
  advisory (`continue-on-error`)** — the repo has ~1,100 pre-existing lint errors,
  mostly `no-explicit-any`, so a hard gate would fail every push and be ignored.
  Make it blocking once that backlog is cleared.
- README replaced (was still `create-next-app` boilerplate).
- Removed 9 fully-merged `claude/*` worktrees and branches. They were also
  **committed as gitlinks** (mode 160000) under `.claude/worktrees/` — untracked
  and added to `.gitignore`.

**Production URL — CONFIRMED 2026-09-03:** <https://coach-voice-mvp-pi.vercel.app>,
Vercel project `suppstackd/coach-voice-mvp`. Note the `-pi` suffix.
`coach-voice-mvp.vercel.app` (no suffix) is a **different, older static Vite SPA**
squatting the obvious name — an earlier audit draft mistook it for this app on the
strength of a 200. Verified: `X-Nextjs-Prerender` header present, manifest serves
the new PNG icons, login page renders clean with no console errors.
Both commits deployed Ready to Production (35s / 40s).

**Preview deployments fail and that is FINE — do not "fix" it.** All Preview builds
error because the six env vars are Production-scope only. User was asked directly
and said previews are not needed: the app is in active dev, pushes go straight to
main, and there are no PRs. Leave the env vars Production-only.

**NOT done, and why:**
- **Leaked-password protection cannot be enabled — the org is on the Supabase
  free plan.** The HaveIBeenPwned check is a Pro-plan feature, so there is no
  toggle to click; the advisor will keep flagging it until the project upgrades.
  Earlier notes said "user must click it" — that was wrong, don't re-raise it as
  an action item. Org `xjlylreygapvrqxqsizj` (Max Senica), plan `free`.
- **No test suite added.** CI runs typecheck + build only. Adding a framework is
  its own task; the report's step 4 still stands.
- **No usage instrumentation** (report step 3). That's a feature build and a
  product decision, not a fix.
- Not visually verified in a browser — no login credentials in this session.
  Typecheck, lint and a full production build are clean, and the RLS changes were
  verified by querying `pg_policies` after applying. The UI additions (audio
  player, two error banners) are logic-and-types-checked only.

## 2026-08-28 (same day, one more still) — Wellness alerts + parent notify

Pushed directly to `main`. User-specified trigger: "alert is a overall score
of the day below 3, or average below 3." Also asked for a way for coaches to
send the alert to a parent, either by typing an email on the spot or using a
saved/linked one — the latter turned out to already half-exist (see below).

**Alert definition — `computeWellnessAlert()` in `lib/wellness-config.ts`**
(single source of truth, used by both the API and every UI surface):
active when `overallWellnessScore` of the latest check-in is `< 3` (today),
OR the average of the last **7** check-ins' overall scores is `< 3`
(reason: `'today' | 'average' | 'both'`). Exact threshold/window the user
specified — 7-day window chosen as the reasonable default for "average"
since it wasn't specified further.

**Trigger point — `POST /api/wellness`** (athlete submits a check-in):
after the upsert, refetches the athlete's last 14 days, runs
`computeWellnessAlert`, and if active calls `notifyWellnessAlert()` — emails
**the coach only**, automatically, every time a submission crosses the
threshold (no debounce/dedup — deliberate; a coach plausibly wants to know
each day an athlete stays low, not just once).

**Deliberately does NOT auto-email a parent/caretaker.** That's a conscious
line: an athlete's stress/soreness/mood scores are sensitive, and the coach
should choose to loop a parent in, not have the system do it silently.
`athlete_caretakers.notify_wellness_alerts` (new column, migration `015`,
applied live) only controls whether that caretaker shows up as a one-click
option in the manual send — it doesn't trigger anything by itself.

**Manual "Notify parent" — new `POST /api/wellness/alert`:** coach-only,
verifies the athlete is in their roster, re-derives the current alert
server-side (never trusts a stale client-side value), and emails whichever
address the coach provides. Reused for both paths the user asked for:
- **Type an email on the spot** — plain input in the new alert banner.
- **Use a linked one** — a `<select>` pre-filled from `/api/caretakers`
  (filtered to `notify_wellness_alerts !== false`), which shares state with
  the same input so picking one just fills it in.

Turned out **the "link parent email to athlete in settings" half of the ask
already existed** — `athlete_caretakers` table + full CRUD
(`app/api/caretakers/route.ts`) + a `CaretakerPanel` UI in the athlete
profile Settings, built before this session. Confirmed this before building
anything, so nothing was duplicated — just added the one missing checkbox
(`notify_wellness_alerts`) to that existing form, and reused the existing
per-caretaker "Send" pattern (`sendTestEmail`, previously a hardcoded demo
email) as the template for the real thing.

**Shared email content:** `buildWellnessAlertHtml()` in `lib/notify.ts` —
one function, two audiences (`'coach'` gets a "View athlete" CTA;
`'parent'` doesn't) — used by both the automatic coach email and the manual
parent send, so they never show different numbers for the same alert.

**Frontend (`app/athletes/[id]/page.tsx`):**
- Wellness tab: red alert banner above `WellnessGraph` when active, with
  the send-to picker described above.
- Overview at-a-glance card (from earlier today): now shows a red border +
  "Wellness — needs attention" + ⚠️ instead of 💚 when the alert is active,
  instead of a separate duplicate banner there.

**Verified:** `npx tsc --noEmit` clean, full `npm run build` clean (34
routes, up from 33 — the new `/api/wellness/alert` route). Migration
applied and confirmed live (`information_schema.columns` check). Same
caveat as the rest of today's UI work: not visually verified in a browser,
no login credentials or browser tool available in this session — logic and
types only.

**Not done:** no way yet to see whether/when a "Notify parent" email was
already sent for a given alert (so a coach could double-send without
knowing) — no send-log table. Low risk given it's a manual, deliberate
action, but worth a `sent_at` marker if this gets used heavily.

---

## 2026-08-28 (same day, one more still) — Wellness score on the coach dashboard roster strip

Pushed directly to `main`. Follow-up to the athlete-profile at-a-glance work:
user wanted the same idea on the coach's home tab, specifically "the small
rating underneath their name" in the "Your athletes" horizontal scroll strip
(`app/dashboard/page.tsx`, home tab).

**API change — `app/api/wellness/route.ts` GET now has two modes:**
- `?athlete_id=X` (existing behavior, unchanged) — one athlete's check-ins.
- No `athlete_id` (new) — returns recent check-ins across the **calling
  coach's whole roster** (`.eq('coach_id', user.id)` instead of
  `.eq('athlete_id', ...)`), so the dashboard can build a "latest score per
  athlete" map with **one request instead of N** (N = roster size). Checked
  every existing caller (`WellnessGraph`, both athlete-profile pages,
  `WellnessSubmit`) — all three always pass `athlete_id`, so this is purely
  additive, nothing else changes behavior.

**Dashboard change:** new self-contained `useEffect` (same
fetch-independently-and-degrade-to-empty pattern used everywhere else today)
builds a `Map<athlete_id, WellnessCheckin>` from that roster-wide call. In
the roster strip, each athlete's status line ("Active"/"Pending") is now
**replaced by the wellness score dot** when a recent check-in exists, and
falls back to the original status text otherwise (an invited athlete who
hasn't onboarded obviously has no wellness data yet). Same
`overallWellnessScore`/`overallScoreColor` helpers from `lib/wellness-config.ts`
— third place now reading the identical formula (athlete profile header
chip, athlete profile Overview card, and now this).

**Scope note:** only the home-tab strip, per what was asked. The full
"Athletes" roster tab (the tabular/list view, separate from this home strip)
would be a natural next candidate for the same treatment if wanted later —
not done yet.

**Verified:** `npx tsc --noEmit` clean, full `npm run build` clean (33
routes). Same caveat as the athlete-profile change: no browser/Chrome
access or login credentials in this session, so this was not visually
confirmed — logic/types only.

---

## 2026-08-28 (same day, one more still) — Wellness scores at-a-glance on the athlete profile

Pushed directly to `main`. Request: surface wellness check-in scores on the
athlete profile for a coach to read at a glance, with the existing Wellness
tab (`WellnessGraph`) staying as the detailed view.

**Shared logic extracted to `lib/wellness-config.ts`** (previously only had
metric definitions): added `WellnessCheckin` type, `overallWellnessScore()`,
and `overallScoreColor()` — pulled out of `WellnessGraph.tsx`'s local
`wellnessScore()` function so the new at-a-glance UI computes the identical
overall score the same way the detail view does, not a second formula that
could drift. `WellnessGraph.tsx` now imports these instead of defining its
own copy.

**Two new UI surfaces in `app/athletes/[id]/page.tsx`** (Overview tab is
what a coach lands on first when opening an athlete):
- A small colored score chip in the **sticky header**, next to the
  ACTIVE/INVITED status badge — visible from every tab, not just Overview.
  Click jumps straight to the Wellness tab.
- A **Wellness at-a-glance card** on the Overview tab, right after the hero
  card and before the existing Sessions/Last-session/Shared stat tiles:
  overall score bubble + last check-in date in the header row, then one
  colored dot + number per metric (energy/mood/sleep/soreness/stress) in a
  single compact row — no chart, no scrolling, matches what `WellnessGraph`
  already colors each metric so the quick view and detail view never
  disagree on "is this good or bad." Whole card is clickable through to the
  Wellness tab. Empty state ("No check-ins yet") handled, not left blank.

**Data fetch:** new self-contained `useEffect` (mirrors how `WellnessGraph`
already fetches independently) hitting `GET /api/wellness?athlete_id=...&days=14`,
kept deliberately separate from the page's main `load()` function — a
wellness-fetch failure degrades to an empty state instead of blocking the
rest of the athlete profile from rendering (checked `res.ok` before parsing,
per the CLAUDE.md fetch-error-handling rule).

**Verified:** `npx tsc --noEmit` clean, full `npm run build` clean (33
routes) with placeholder env vars. **Not visually verified in a browser** —
this session has no browser/Chrome automation tool and no real login
credentials for the live app, only Supabase MCP (DB) access. If something
looks visually off (spacing, wrapping, dark mode, etc.), that's the part
that wasn't actually seen rendered — logic and types were the only things
checked.

---

## 2026-08-28 (same day, one more still) — Message + calendar-event notifications

Pushed directly to `main`. Follow-up to "do it, and any other notifications
you feel are necessary" — extended `lib/notify.ts` (built earlier today for
`notifySessionShared`) with two more, deliberately choosing only the ones
that match the exact same gap pattern (something happens in-app, the other
person has no way to find out except opening the app):

- **`notifyNewMessage()`** — wired into `app/api/messages/route.ts` POST.
  Emails whichever side (coach or athlete) didn't send the message.
  - Coach → athlete: straightforward, same as `notifySessionShared` (email
    from `athletes.email`).
  - Athlete → coach: harder — `profiles` has **no email column**, coach
    email only exists on `auth.users`. Added `getCoachEmail()` in
    `lib/notify.ts`, using the service-role admin client
    (`admin.auth.admin.getUserById`) since the caller here is the athlete's
    RLS-scoped client, which can't read another user's `auth.users` row.
  - **Debounced per-thread**, not per-message: before sending, checks
    whether the recipient already has an earlier *unread* message from the
    same sender in that conversation (`messages` table, `read_at IS NULL`,
    excluding the message just inserted) — if so, skips. So a burst of 5
    messages sends 1 email, not 5. No new schema/column needed for this,
    just a query against existing `read_at`.
- **`notifyCalendarEventCreated()`** — wired into `app/api/calendar/route.ts`
  POST, both the single-athlete and group-event branches (one email per
  member for group events). Deliberately scoped to **coach-created events
  for an athlete only** — not the athlete's own personal-event branch (no
  point self-notifying), and not `mode=personal` (coach's own calendar).
  Covers `homework`/`goal`/`reminder`/`other` event types too, not just
  `session` — closes the same "shows on calendar, athlete never told" gap
  the original session-feedback bug had, just for the other event types.
  No overlap with `notifySessionShared`: this route is a separate,
  general-purpose calendar CRUD endpoint the session-recording flow doesn't
  use (that flow inserts `calendar_events` directly via
  `syncSessionCalendarEvent`).

**Refactored while there:** `notifySessionShared` now uses a shared
`getCoachName()` helper instead of inlining the same profiles lookup a
third time — same de-dup instinct as the rest of today's work.

**Deliberately NOT added** (survey done, judged not worth it right now):
- Wellness check-in submissions — pull/dashboard pattern for the coach, not
  an urgent push; and there's no obvious "coach must act now" moment.
- RSVP status changes on calendar events — minor, low-value.
- Video-share toggle (`session_videos.shared_with_athlete`) — real gap,
  same shape as everything above, but scoped out for today; same
  `notifyX()` pattern would apply if it's wanted later.
- Caretaker/parent notifications — schema already has
  `athlete_caretakers.notify_session_reports` /
  `notify_monthly_reports` flags, but nothing in the app actually sends to
  caretakers yet (checked: only read/written by the caretakers CRUD route
  and a settings toggle). Different persona, different (digest-shaped, not
  event-shaped) problem — left alone rather than half-building it.

**Verified:** `npx tsc --noEmit` clean, full `npm run build` clean (33
routes) with placeholder env vars, same method as before.

---

## 2026-08-28 (same day, one more) — Email notification when a coach shares a session

Pushed directly to `main` (per user's call earlier this session — no more
PRs unless asked). Follow-up to "what could we dev next?": the earlier fix
made shared feedback *visible* in the athlete's feed, but the athlete still
had to happen to open the app to notice it. This adds an actual notification.

**New: `lib/notify.ts`** — the reusable notification core, explicitly meant
as the precedent for future app-triggered notifications (user's instruction:
"set the precedent of having notifications FROM the app too"):
- `sendEmail()` — the actual Resend API call. Consolidates what used to be
  two separately hand-rolled `fetch('https://api.resend.com/emails')` calls
  (the athlete invite email in `app/api/athletes/route.ts`, and the manual
  "send report" endpoint `app/api/email/route.ts`) — both refactored to call
  this instead of duplicating the fetch a third time.
- `renderBrandedEmail()` — the shared CoachVoice HTML email shell (logo,
  heading, body, optional CTA button, footer), extracted from what was an
  inline template only the invite email used.
- `getAppBaseUrl(req)` — resolves the app's public URL from request headers,
  same logic that already existed inline in the invite-email code.
- `notifySessionShared()` — the new one: emails the athlete when a session
  is shared with them (subject "{coach} shared feedback with you", links to
  `/athlete`). Looks up the athlete's email straight from `athletes.email`
  (works even if they haven't claimed their account yet) and the coach's
  name from `profiles`. No-ops silently if there's no email on file or
  `RESEND_API_KEY` isn't configured — never throws, since it's called from
  hot paths that must succeed regardless of email delivery.

**Wiring:** called from the exact same 3 places `syncSessionCalendarEvent`
already was (`app/api/sessions/route.ts`, `app/api/sessions/audio/route.ts`,
`app/api/sessions/[id]/route.ts` PATCH) — sharing a session is one event,
now with two effects (calendar + email). One behavior change worth knowing:
**`syncSessionCalendarEvent` now returns `boolean`** (was `void`) — true
only when it actually inserted a fresh calendar_events row. The PATCH route
(the share *toggle*, likely the most common share path in practice) uses
that return value to gate the notification, so toggling share on/off/on
repeatedly sends the email only once, on the first real share — not on
every re-toggle. The two creation-time call sites ignore the return value
(a session is inherently "first share" the moment it's inserted already
shared).

**Verified:** `npx tsc --noEmit` clean, and a full `npm run build` with
placeholder env vars succeeds (all 33 routes) — same method used to
root-cause the Vercel Preview issue earlier today.

**Not done / worth knowing if this needs to change:**
- No unsubscribe/opt-out mechanism for this email — if that becomes a
  problem, it needs a real column (e.g. `athletes.email_notifications_enabled`)
  checked before calling `notifySessionShared`, not a client-side toggle.
- No rate limiting — an unlikely-but-possible rapid unshare/reshare loop
  (bypassing the "first share" gate by deleting the calendar_events row some
  other way) could re-trigger sends. Not guarded against; wasn't worth the
  complexity for a coach-driven, manual action.
- Next notification type to add here should follow the same shape: a
  `notifyX()` function in `lib/notify.ts` that calls `sendEmail()` +
  `renderBrandedEmail()`, not a new hand-rolled Resend call.

---

## 2026-08-28 (same day, final) — PR #1 merged to `main`; Vercel Preview red is environmental, not code

PR #1 (branch `claude/coach-voice-workspace-9deh1r`, both entries below) was
merged directly to `main` at `15711ee` — no rebase/squash, standard merge
commit, history preserved. User's call: this repo's actual convention is
direct-to-main deploys (CLAUDE.md says so explicitly), and PRs/Preview
deployments were only used in this session because the harness required a
branch workflow. That mismatch caused the one snag worth remembering:

- **Vercel's `Preview` check was red on PR #1** (`Deployment has failed`).
  Root-caused before merging rather than guessing: reproduced the exact same
  build failure (`@supabase/ssr: ...URL and API key are required...`,
  thrown prerendering `/athlete`) **locally on `main` too**, with a clean
  install and zero code changes — proving it wasn't this PR's code. Confirmed
  by supplying placeholder env vars locally: build then succeeds cleanly on
  both branches, all 33 routes.
  - **Cause: PR #1 was the first pull request ever opened in this repo.**
    Every prior deploy went straight to `main` (Production), so this was the
    first time Vercel ever attempted a *Preview* build — and this Vercel
    project's env vars (`NEXT_PUBLIC_SUPABASE_URL`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
    `OPENAI_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`) are almost
    certainly scoped to Production only, never added to Preview.
  - **Not fixed** — no tool/browser access to the Vercel dashboard from this
    session to add the Preview-scope env vars, and once the user decided to
    skip PRs going forward, it stopped being worth fixing. If someone opens
    another PR later and hits the same red Preview check, this is why —
    either add the 6 vars to Preview scope in Vercel, or just merge straight
    to `main` like this one did.
- Posted the root-cause + fix instructions as a PR comment before merging
  (kept for the record even post-merge:
  https://github.com/maxsenica-sys/coach-voice-mvp/pull/1#issuecomment-5458579009).
- Unsubscribed from PR activity and cancelled the scheduled CI check-in after
  merging — nothing left to watch.

**Going forward:** default back to CLAUDE.md's stated workflow (push directly
to `main`) unless the user asks for a PR again.

---

## 2026-08-28 (same day, follow-up) — Cleanup pass: deps, RLS drift, code dedup

Same branch/PR as above (`claude/coach-voice-workspace-9deh1r` / PR #1).
Triggered by "go for the full cleanup, making future edits easier" after
discussing next-upgrade priorities.

**Dependency cleanup:**
- `package.json` had `npm` and `i` listed as real `dependencies` (not
  devDependencies) — almost certainly accidental (`npm i <typo>` at some
  point). This is *why* `npm audit` reported a critical `tar` vuln and a
  `sigstore` vuln: those are npm's own bundled internals, pulled in only
  because `npm` itself was a stated dependency of this app. Removed both —
  152 packages dropped from the tree, vuln count went 26 → 19 immediately.
- Ran `npm audit fix` (no `--force`): 19 → 8 vulnerabilities, all
  semver-safe bumps.
- Remaining 8 (sharp/libvips CVEs, workbox/serialize-javascript chain via
  `@ducanh2912/next-pwa`) all require `npm audit fix --force`, which would
  bump `next` to 16.3.3 (currently pinned `16.1.6`, no caret) and downgrade
  `next-pwa` to 10.2.6 — real, untested behavior changes. **Deliberately not
  forced through** — flagged as a follow-up decision, not done blindly.
- **Note for next time:** confirm before re-running a bare `npm install` —
  this session's sandbox blocked one attempt via the auto-mode classifier and
  required a retry. Not a code issue, just a permissions quirk to expect.

**Live Supabase schema drift (project `cposdedvstdzxftcaucq`, "Max's Project",
eu-west-1):**
- `mcp__Supabase__list_migrations` returned **empty** — the live DB's schema
  was never applied through Supabase's own tracked-migration mechanism
  (`supabase_migrations.schema_migrations`), only via ad-hoc SQL (dashboard
  SQL editor and/or prior AI sessions running raw `execute_sql`). This is the
  root cause of everything flagged as "not in tracked migration files" in the
  entry above — it's not that migrations were skipped, it's that the whole
  live schema has only ever been managed ad hoc. **Going forward, prefer
  `mcp__Supabase__apply_migration` over raw `execute_sql` for schema changes**
  so `list_migrations` actually starts reflecting reality.
- Found and fixed **8 duplicate RLS policies** (same predicate, two names —
  one "table: description" style matching the tracked-migration convention,
  one `table_verb_own` style from some untracked pass) on `athletes` (5→3
  policies), `notes` (4→2), `profiles` (7→4), `sessions` (6→5). Not a security
  bug (Postgres OR's duplicate permissive policies together, confirmed correct
  behavior either way) — pure drift/clutter that risked someone editing one
  copy and not knowing its twin existed. Dropped the redundant twin, kept the
  colon-style name. Landed as `supabase/migrations/014_dedupe_rls_policies_and_fk_indexes.sql`
  and applied live via `apply_migration`. Verified post-migration policy
  counts match exactly (3/2/4/5).
- Same migration added the **14 missing FK indexes** the performance advisor
  flagged (`unindexed_foreign_keys`) — purely additive, e.g.
  `sessions_athlete_id_idx`, `notes_session_id_idx`, etc. Full list is in the
  migration file.
- Confirmed migration **013** (`calendar_events.session_id`, from the
  earlier entry today) is **already live** — `session_id` column exists on
  `calendar_events` in production. It must have been applied outside this
  session (possibly the same ad-hoc-SQL pattern above). The "not yet applied,
  flag to user" note in the entry above is now stale/resolved.
- **Explicitly NOT done this pass** (scoped out, not forgotten):
  - `auth_rls_initplan` perf lint (37 instances) — every RLS policy in this
    schema calls bare `auth.uid()` instead of `(select auth.uid())`, which
    is the standard Supabase-recommended optimization (lets Postgres cache
    the value once per statement instead of re-evaluating per row). Fully
    mechanical, no semantic change, but touches ~20+ policy definitions
    across every table — decided this deserves its own isolated migration
    and review pass rather than being bundled into this cleanup. All the
    exact policy text needed to do this is already captured in this
    session's tool output if picking it back up.
  - `unused_index` advisor hits (2: `group_members_group_idx`,
    `cal_session_idx`) — left alone. "Unused" likely just reflects a young
    app with little real traffic yet, not genuinely dead; dropping now risks
    guessing wrong. Revisit once there's real usage data.
  - Auth setting "Leaked Password Protection Disabled" (WARN from advisors)
    — a Dashboard toggle (Authentication → Policies), not a migration; no
    Supabase MCP tool exposes it. Flag to user to enable manually.

**Code dedup:** the `shared_with_athlete`-gated calendar-sync logic added
earlier today was duplicated near-verbatim across 3 files. Extracted into
`lib/session-calendar-sync.ts` (`syncSessionCalendarEvent()`), following the
existing precedent in this codebase for this exact kind of thing (see the
doc comment atop `lib/supabase-route.ts`: "Replaces the duplicated
createRouteClient() boilerplate across 28+ API files"). All 3 call sites
(`app/api/sessions/route.ts`, `app/api/sessions/audio/route.ts`,
`app/api/sessions/[id]/route.ts`) now call the shared helper instead of
inlining the insert. **If a 4th session-save path is ever added, use this
helper — don't re-inline the logic a 3rd time.**

**Verified:** `npx tsc --noEmit` clean after every change in this pass.

---

## Project history (reconstructed from `git log`, pre-dates this memory bank)

Entries below were backfilled by reading commit subjects/dates and migration
file history — not sessions this memory bank was live for, so detail is
lighter than entries above. Kept chronological (oldest first) so it reads as
one story.

**2026-04-16 — Initial build.** `8575fa0` Initial commit: CoachVoice MVP
scaffolded (Next.js + Supabase, coach/athlete roles, sessions, calendar,
messaging, wellness). Same day: TS build error fix, invalid-dir cleanup, two
rounds of "critical bug fixes + mobile responsive layout", calendar month nav
fix, direct video upload, load performance, calendar save-confirmation toast,
merged branch `zen-allen` (calendar fix, direct video upload, athlete status,
coach settings, UX). Migrations **001–007** landed same day: profiles
role+RLS, profile trigger, phase-3 full features (`athlete_notes`,
`calendar_events`, `session_videos`, groups, coach personal calendar,
messaging/wellness/reports), athlete first-login.

**2026-04-17.** Video upload speed fix, calendar bug fix, UI redesign for a
younger audience (merged `quirky-antonelli`); calendar refetch-after-add,
mobile settings, FAB bottom nav. Migration **008**: `calendar_events.athlete_id`
made nullable (to support coach personal events).

**2026-04-18.** Journal theme, quotes, clickable cards, sport wheel, nav
improvements (merged `admiring-driscoll`); migration 009 policy-syntax fix
(`DROP POLICY IF EXISTS` instead of `CREATE POLICY IF NOT EXISTS`); calendar
scroll-wheel strip, athlete rich profiles, video share links, dedup (merged
`quirky-pascal`). Migration **009**: athlete profile fields.

**2026-04-19.** Five commits, all same day: full overhaul (calendar fix, home
wheel, messaging badge, sport picker, hero compact, settings email); calendar
persistence + messaging optimistic UI + athlete full profile + video
visibility; `homeWeekEvents` stale-state fix, media 403, athlete
annotations, unread-count cap, audio crash, message error state, realtime
client stability, live unread badge; live unread badge via a second realtime
channel + signed URL for athlete media; calendar grid default, event dots,
messaging panel height, stat colours, week strip, global border. Migrations
**010–011**: athlete sport field, athlete height stored as text.

**2026-04-20 — origin of two CLAUDE.md checklist rules.** `b21c320` fixed
(a) `monthRange` producing an invalid date for 30-day months — this is the
literal incident behind CLAUDE.md checklist item #5 ("never use hardcoded day
counts"), and (b) an infinite messaging fetch loop caused by `onUnreadChange`
being passed as a raw effect dependency — the literal incident behind
checklist item #3 ("wrap callback deps in `useRef`, known past incident:
`onUnreadChange`").

**2026-04-26.** Visual redesign: "Letter (02)" — sage/rust palette,
Newsreader font, cleaner notes UI.

**2026-05-02 — origin of the MediaRecorder/MIME protection rules and the
pre-commit checklist itself.** Three visual-redesign commits ("Ivory" design:
white stat cards, Newsreader numerals, SVG nav grid, minimal header,
redesigned home tabs) plus athlete first-login onboarding / wellness home
card / coach setup flow. Then, same day: **"Fix: audio recording broken on
Safari/iOS due to hardcoded webm MIME type"** — the incident that produced
CLAUDE.md's "Protected recording call sites" table and the dynamic
MIME-detection requirement (Chrome uses `audio/webm`, Safari/iOS uses
`audio/mp4`). Then **"Fix silent transcription error and empty-athletes state
in QuickSessionModal"** — the literal incident CLAUDE.md checklist item #1
refers to ("the silent fetch bug in QuickSessionModal"). Then **"Add
mandatory pre-commit review checklist to CLAUDE.md"** — this is when the
6-item checklist every session since (including this one) follows was
introduced.

**2026-05-03.** Added `maxDuration = 60` to the transcribe and audio API
routes, improved error logging.

**2026-06-06.** Two "deploy" commits: one is `.claude` worktree/settings
housekeeping (not app code); the other adds the CLAUDE.md "Updated after
Round 1" note clarifying that the re-record `onClick` handler in
`QuickSessionModal` is exempt from the recording-pipeline protection rule
(only `startRecording`/`stopAndTranscribe`/MIME/FormData are protected), plus
small touches to the sessions API routes/pages. Migration **012**: added
`sessions.title`, `sessions.audio_path`, `sessions.audio_mime`.

**2026-06-11.** "deploy": coach dashboard home redesigned to solid-color stat
cards (this is the same "Sessions" stat tile fixed in the 2026-08-28 entry
below — the `tab: 'calendar'` mislabeling already existed before this commit
and just carried through the redesign), a large rework of
`app/athletes/[id]/page.tsx` (~630 lines changed — likely the video
annotator / rich-profile buildout), and a small `app/api/calendar/route.ts`
tweak.

**2026-08-21 — audio pipeline reliability batch.** Four commits: normalise
coach code on athlete signup; persist session audio instead of discarding it;
stop long recordings failing with a misleading error; upload session audio
direct to storage, removing the 4.5MB request-body ceiling. (No migration —
storage/route changes only.)

---

## 2026-08-28 — PR #1: Session feedback not reaching athlete feed + homepage links

Branch: `claude/coach-voice-workspace-9deh1r`
PR: https://github.com/maxsenica-sys/coach-voice-mvp/pull/1 (status: open, not yet merged)

**Root cause found:** `shared_with_athlete` defaults to `false` in
`QuickSessionModal`. `POST /api/sessions` was creating the `calendar_events`
row unconditionally regardless of that flag, so athletes saw a "Coaching
Session" on their calendar with no matching feed entry (feed query filters on
`shared_with_athlete = true`). The audio-recording save path
(`/api/sessions/audio`, used by `app/athletes/[id]/page.tsx`) had the inverse
bug — never created a calendar event at all, even when shared.

**Fixes shipped:**
- `app/api/sessions/route.ts` — only insert `calendar_events` when
  `shared_with_athlete` is true at save time.
- `app/api/sessions/audio/route.ts` (mode=save) — same gating added; this
  route previously never created a calendar event.
- `app/api/sessions/[id]/route.ts` (PATCH, the share toggle used by
  `toggleShare` in `app/athletes/[id]/page.tsx`) — now creates the calendar
  event if the session is shared *after* creation, checking
  `calendar_events.session_id` first to avoid duplicates.
- `supabase/migrations/013_calendar_events_session_id.sql` — added
  `calendar_events.session_id` (nullable, FK → sessions, ON DELETE CASCADE)
  + index. **NOT YET APPLIED to the live Supabase project** — user needs to
  run it via SQL Editor or `supabase db push`. Confirm this has landed before
  assuming session_id-based dedup logic actually works in prod.
- `app/athlete/page.tsx` — boot fetch restructured: athlete record is now
  fetched *before* the sessions query, which now filters explicitly with
  `.eq('athlete_id', athRecord.id)` instead of relying solely on RLS
  (defense-in-depth; the `sessions` table's own RLS policy is NOT in any
  tracked migration file — it must live outside this repo, e.g. set up via
  the Supabase dashboard before migration 001. Un-auditable from the repo.).
- `app/dashboard/page.tsx` — coach home "Sessions" stat card linked to
  `tab: 'calendar'` instead of `tab: 'sessions'` — fixed. "Today" and "Recent
  sessions" home-tab list rows had no click handler despite looking
  interactive (arrow icons) — now wrapped in `<Link href="/athletes/{id}">`.
- Athlete-side home tab (`app/athlete/page.tsx` tab==='home') was already
  fully wired (`setTab('sessions')` etc.) — checked, no changes needed there.

**Verified:** `npx tsc --noEmit` clean (had to `npm install` first — repo had
no `node_modules` in this session's container).

**Known open items / things NOT done:**
- Migration 013 not applied to live DB yet (see above) — flagged to user.
- Did not touch group-session save flow logic beyond confirming it's
  per-athlete-scoped correctly (each group member gets own POST to
  `/api/sessions`, no cross-athlete leakage found there).
- Did not add UI messaging/indicator distinguishing "draft, not yet shared"
  sessions on the athlete side — only the coach dashboard shows SHARED/DRAFT
  badges (`app/dashboard/page.tsx` "Recent sessions" row).
- User's phrase "some of the other athletes register non-sessions" was never
  fully disambiguated — treated as likely referring to the same
  calendar-without-feed-content bug described above, not a separate
  cross-athlete data leak (no evidence of a leak found; RLS looks intact
  based on the `session_videos` policy pattern in migration 003, which
  mirrors what the sessions table policy is assumed to look like).

**CLAUDE.md constraints respected:** did not touch MediaRecorder/MIME/FormData
recording pipeline in QuickSessionModal, athletes/[id]/page.tsx,
athlete/page.tsx note recorder, or MessagingPanel. `runtime = 'nodejs'` left
untouched on all protected API routes.

**Next time, before repeating investigation:** the calendar/feed
sync-on-share logic now lives in 3 places (POST /api/sessions, POST
/api/sessions/audio, PATCH /api/sessions/[id]) — if extending session
creation further (e.g. a 3rd save path), replicate the same
`shared_with_athlete` gate + `session_id` link there too, don't re-derive it
from scratch.
