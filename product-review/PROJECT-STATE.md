# CoachVoice — Project State

**Purpose of this file:** the shared, cheap context every review agent reads
*instead of* re-reading the repo. Keep it under ~250 lines. Update it when the
architecture changes, not when a line of CSS changes.

Last verified against the codebase: **2026-09-06** (commit `d033ef8`).

---

## What CoachVoice is

A voice-first coaching platform. The core loop is one sentence:

> A coach speaks into their phone after a session → Whisper transcribes →
> GPT-4o-mini condenses it into 2–5 bullets → the coach chooses whether the
> athlete sees it.

Everything else in the product orbits that loop. Real use is with young
athletes (roughly 13–18), primarily volleyball, on phones, often courtside.

Production: `https://coach-voice-mvp-pi.vercel.app`

## Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 + a hand-written
token layer in `app/globals.css` · Supabase (Postgres 17, auth, storage,
realtime) · OpenAI Whisper + GPT-4o-mini · Resend email · Vercel · PWA.

No test suite. `CLAUDE.md` carries a mandatory pre-commit checklist derived
from real production incidents. Checks are `npx tsc --noEmit && npm run lint
&& npm run build`.

---

## Pages (the whole surface area)

| Route | Who | What it is |
|---|---|---|
| `/` | anyone | Sign-in / forgot password. **Visually a different app** — dark-brown gradient, amber+indigo glows, none of it from the token set. |
| `/signup`, `/signup/confirm` | anyone | Account creation, coach-code join |
| `/dashboard` | coach | Everything for the coach. 7 tabs: `home · athletes · groups · sessions · calendar · messages · settings`. 1,793 lines, one file. Bottom nav on mobile with a centre FAB. |
| `/athletes/[id]` | coach | One athlete. 6 tabs: `overview · sessions · wellness · calendar · profile · notes`. 1,285 lines. |
| `/sessions/[id]` | coach **and** athlete | The session page. Summary, focus points, coach notes, audio, videos, image attachments. 622 lines. |
| `/athlete` | athlete | The athlete's whole app. 6 tabs: `home · sessions · calendar · notes · messages · wellness`. 1,499 lines. Bottom nav on mobile. |
| `/pdf/session/[id]`, `/pdf/monthly/[athleteId]` | coach | Printable reports |
| `/share/clip/[videoId]` | signed-in | Shared video clip. **Not public** — `app/api/share/clip/[videoId]/route.ts:15` returns 401 without a session. CoachVoice has no public surface at all. |
| `/reset`, `/auth/callback` | anyone | Password reset |

Route protection is `proxy.ts` (middleware): matcher `['/', '/dashboard/*',
'/athletes/*', '/athlete/*', '/sessions/*', '/reset']`, role-checked against
`profiles.role`. `/sessions/*` is signed-in but role-agnostic.

## Components (`app/components/`)

`QuickSessionModal` (the recorder — 22 KB) · `MessagingPanel` (28 KB) ·
`VideoAnnotator` · `Calendar` · `DayWheel` (home day strip) ·
`WellnessGraph` · `WellnessSubmit` · `SessionAudioPlayer` · `SportWheelPicker`.

Almost all styling is **inline `style={{}}` objects**, not the token classes in
`globals.css`. The token classes exist and are good; the pages mostly bypass
them. Any design recommendation has to reckon with that.

## Shared logic (`lib/`)

`api-client.ts` (`apiMutate` / `apiJson` — always use these, never raw fetch) ·
`session-date.ts` (**the** answer to "when did this session happen") ·
`athlete-status.ts` (ACTIVE vs INVITED) · `wellness-config.ts` (the 5 metrics) ·
`sports.ts` (sport list + terminology hints fed to Whisper and the summariser) ·
`notify.ts` (Resend emails) · `session-calendar-sync.ts` · `profile-cache.ts`
(sessionStorage identity cache so pages paint a real name on frame 1) ·
`quotes.ts` · `date-utils.ts` · three Supabase client factories.

---

## The data model, in the terms that matter for review

### What a session actually holds
`sessions`: `id, coach_id, athlete_id, session_name, title, summary,
transcript, coach_notes, focus_points (jsonb array of short strings),
shared_with_athlete, sport_context, audio_path, audio_mime, session_date,
created_at`.

`focus_points` is now **written automatically**: `makeQuickSummary` in
`app/api/sessions/route.ts` asks the model for a trailing `NEXT:` line and, when
the coach said something forward-looking, stores it as a single-element array.
The coach edits or deletes it on `/sessions/[id]` like any point they typed.

**There are no quantitative session fields.** No reps, no attempts, no
success/failure counts, no scores, no ratings, no drill records. Every session
is qualitative: a voice recording, its transcript, an AI summary, optional
typed notes, an optional ordered list of focus points, optional videos and
images. This is a deliberate shape, not an oversight — but it means any "track
the numbers" recommendation is a **new data-capture surface**, not a
visualisation of data already sitting there.

`focus_points` is the only structured, forward-looking, athlete-actionable
field in the system. It renders on `/sessions/[id]` and, since 2026-09-06, as a
single line on the athlete's home card under "Take into next session".

### What wellness holds
`wellness_checkins`: one row per `(athlete_id, check_date)` —
`energy, mood, sleep_q, soreness, stress`, each 1–5, plus free `notes`.
`soreness` and `stress` are inverted (5 = good). Athlete submits; coach reads.
Low scores fire caretaker alerts (`/api/wellness/alert`).

**Wellness and session data never meet.** Nothing joins a check-in to a
session, on either side of the app.

### Other tables
`profiles` (role, name, sport, position, experience, goals, invite_code) ·
`athletes` (roster row owned by a coach; `athlete_user_id` links to an account
once they sign up; `first_login_at` drives ACTIVE/INVITED) · `athlete_notes`
(private to the athlete — **coaches cannot see these**) · `calendar_events`
(dual-privacy, `visible_to_athlete` decides) · `messages` · `groups` ·
`athlete_caretakers` · `session_videos` · `session_attachments`.

Storage buckets, all private: `session-audio`, `session-videos`,
`messages-media`, `athlete-photos`.

### API routes (`app/api/`)
`transcribe · sessions · sessions/all · sessions/[id] · sessions/[id]/detail ·
sessions/[id]/audio-url · sessions/[id]/videos(+upload-url) ·
sessions/[id]/attachments · sessions/audio-upload-url · athletes ·
athletes/[id](+photo, hard-delete) · athlete/activate · athlete-notes · notes ·
wellness · wellness/alert · calendar · messages(+unread) · groups ·
groups/[id]/members · caretakers · coach-profile · coach-code · join · rsvp ·
complete-signup · email · share/clip/[videoId]`

---

## The two workflows that matter most

### Coach records a session
Dashboard → FAB (or "Record Session" on three other surfaces) → `QuickSessionModal`.

Step 1 "record": *Session for* (Individual / Group toggle) → athlete `<select>`
→ session name (optional) → session date (defaults today) → **Start Recording**
→ Stop & Transcribe → uploads audio to storage via signed URL and posts the
file to `/api/transcribe`.
Step 2 "review": editable transcript → share-with-athlete toggle (defaults ON)
→ Save. `POST /api/sessions` resolves the sport server-side, generates the
summary, writes the session, creates the calendar event, sends the email.

Since 2026-09-06 the athlete and group pickers are **one-tap chips, with no
default**. Opened from the FAB the modal opens with no target, and both step-1
exits (Start Recording, Skip) are disabled until one is picked. There is still
**no way to delete or reassign a session** once saved — `/api/sessions/[id]`
exports only `PATCH` and `athlete_id` is not in its allow-list.

### Athlete receives a session
`/athlete` home shows "New from Coach" — the session name plus the **first 120
characters of the AI summary**, truncated. Tapping goes to the Sessions tab,
which shows a hero card for the same most-recent session (**again**, at 140
chars) and below it an accordion list of every session. Opening an accordion
row reveals: an "Open full session" link, the audio player, the full summary,
a collapsed transcript, videos, and the athlete's own notes.

The extracted next-session line now appears on the home card, unquoted and
under its own label (the summary above it is presented as the coach speaking).
The full focus-point list still lives on `/sessions/[id]`.

---

## Design system, as it actually is

`app/globals.css` defines a coherent "Letter Edition" token set: ivory/parchment
surfaces (`--bg #FBF8F3`, `--card #FFFFFF`, `--border #E3DED2`), sage primary
(`--primary #6F8E6B`, `--primary-dark #4F6B4B`), rust for coach
(`--coach-color #B55C3E`), amber energy, Newsreader serif for display + Plus
Jakarta Sans for UI + JetBrains Mono. Component classes: `.card`, `.card-lg`,
`.card-journal`, `.btn` + 6 variants, `.input`, `.label`, `.badge` + 9 variants,
`.stat-card`, `.nav-pill`, `.hero-bar`, animations, PWA/safe-area handling,
44 px minimum tap targets under 768 px.

**Two palettes are live** (was three until 2026-09-06):
1. the token set above (most of the app), which now also carries an
   eight-token wellness scale — `--wellness-good|ok|low|none` plus paired
   `-tint` values, all clearing AA as text,
2. `/` sign-in — dark browns `#1A0E06 → #2C1810`, amber `rgba(245,158,11)` and
   indigo `rgba(91,99,245)` glows, all inline, none of them tokens. **This is
   the one remaining palette divergence, and it is the first screen every user
   sees.** Nobody has proposed a target design for it.

The five per-metric identity hues in `lib/wellness-config.ts` (`#10b981`,
`#3b82f6`, `#8b5cf6`, `#f59e0b`, `#ef4444`) survive as **chart fills only**,
where 3:1 governs. They no longer render as text anywhere.

**Known contrast measurements** (computed, sRGB, WCAG 2.2 formula):

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` `#1F2421` on `--bg` `#FBF8F3` | ~15.4:1 | passes everything |
| `--text-2` `#5D6661` on `--bg` | **5.49:1** | passes AA normal text |
| `--text-muted` `#6B736D` on `--bg` | **4.61:1** | passes AA (was `#9BA29B` at 2.47:1 until 2026-09-06) |
| `--primary` `#6F8E6B` on white | **3.65:1** | fails AA normal text; fine as a fill |
| `--primary-dark` `#4F6B4B` on white | 5.94:1 | passes AA normal text |

`--text-muted` is used at 10–13 px for session dates, stat sub-labels, "delta"
strings, quote strips and empty-state copy across every page. As of 2026-09-06
nothing hardcodes the old hex — every site reads the token.

---

## Constraints any recommendation must respect

- **Do not touch the recording/transcription path** without explicit user
  instruction. `CLAUDE.md` lists the protected call sites and why. MIME
  detection order (mp4 first) is load-bearing for iPhone playback.
- `export const runtime = 'nodejs'` stays on the audio API routes.
- Migrations are numbered and applied via Supabase MCP; the next one is `022`.
- No test suite — every change is validated by typecheck + lint + build and by
  reading the diff.
- Pages are large single files with inline styles. A "small" visual change can
  mean 40 edit sites. Estimate complexity against that reality, not against an
  idealised component library.

## Where the app is thin (state this honestly rather than rediscovering it)

- No quantitative performance data of any kind.
- No session goal set *before* a session, only notes captured after.
- No athlete self-assessment tied to a session (wellness is the only athlete
  input, and it is day-level, not session-level).
- No trend or progress view over sessions — the athlete sees a reverse-chron
  list, the coach sees a count.
- A focus point is extracted into a session but **nothing carries it forward** —
  the next session does not know the last one set a focus, and nobody ever
  closes the loop on whether it was worked on.
- No session delete and no reassign.
- Nothing an athlete sees is shareable, and nothing in the product is visible to
  anyone who does not already have an account. There is **no public surface**,
  which is good for safeguarding and means any growth mechanism has to run
  through email to adults rather than a link.
- `/api/transcribe` requests `verbose_json` and returns Whisper's `segments`
  array with per-sentence timestamps (`app/api/transcribe/route.ts:75,102`).
  **Nothing consumes it** — those two lines are the only occurrences of
  `segments` in the repo, and `QuickSessionModal` reads `json.text` only. The
  app pays for a timestamped map of every recording and discards it.
- No streaks, no habit loop, no reason to open the app on a day with no session.
- The coach is the only author. An athlete cannot record anything for their
  coach, only private notes for themselves.
