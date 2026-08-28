# Memory Bank — CoachVoice

Running log of work done via Claude Code sessions. Read this file first before
starting new work to avoid re-investigating things already resolved. Append a
new dated entry per session/PR — don't rewrite history above.

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
