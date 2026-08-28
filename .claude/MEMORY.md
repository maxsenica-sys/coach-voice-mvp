# Memory Bank — CoachVoice

Running log of work done via Claude Code sessions. Read this file first before
starting new work to avoid re-investigating things already resolved. Append a
new dated entry per session/PR — don't rewrite history above.

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
