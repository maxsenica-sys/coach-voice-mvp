# Memory Bank — CoachVoice

Running log of work done via Claude Code sessions. Read this file first before
starting new work to avoid re-investigating things already resolved. Append a
new dated entry per session/PR — don't rewrite history above.

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
