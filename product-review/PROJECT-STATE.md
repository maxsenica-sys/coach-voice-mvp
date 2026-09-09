# CoachVoice — Project State

**Purpose of this file:** the shared, cheap context every review agent reads
*instead of* re-reading the repo. Keep it under ~250 lines. Update it when the
architecture changes, not when a line of CSS changes.

Last verified against the codebase: **2026-09-09**, after the round-4 build
(working tree on top of `d70258e`).

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

`CLAUDE.md` carries a mandatory pre-commit checklist derived from real
production incidents. Checks are `npx tsc --noEmit && npm run lint &&
npm run verify && npm run build`, plus `npm run verify:boot` for anything on the
startup path.

**There is still no unit-test suite, but there are now four rigs**, and they are
the shape this project's failures actually take — every bug it has shipped
passed the type checker, the linter and the build:

| Rig | Runs |
|---|---|
| `verify:safeguard` | 5 static rules over `app/` and `lib/`: every route authenticates, the service-role key never reaches a browser bundle, private buckets are never made public, coach-attention data never reaches an athlete surface, wellness reads are always scoped. Prints its KNOWN GAPS and its one justified auth exemption on every run |
| `verify:clock` | The real date logic under 9 timezones, every day of a year — 37,035 assertions. CI runs in UTC, which is exactly why this exists |
| `verify:prompt` | The summariser: two pinned golden prompts, the name gate over recorded transcripts, and the response parser over recorded model replies. `--live` calls the real model, opt-in, not in CI |
| `verify:boot` | Real Chromium against a production build, asserting the cold-start timeline |

Every rule in all three new rigs was verified by breaking the code on purpose
and watching that specific rule go red.

A consequence worth knowing when reading the tree: **pure logic now lives in
`lib/`, not in components or routes.** Node can strip TypeScript but cannot
parse JSX, so anything exported from a `.tsx` is unreachable from a rig.
`lib/training-spine.ts`, `lib/attention.ts` and `lib/summary-prompt.ts` were
extracted for exactly that reason — the last of these took the prompt out of
`app/api/sessions/route.ts`, which had made the most consequential text in the
product impossible to execute outside a running server.

---

## Pages (the whole surface area)

| Route | Who | What it is |
|---|---|---|
| `/` | anyone | Sign-in / forgot password. Rebuilt 2026-09-06 on `--grad-ink`; the brown gradient, the amber/indigo glows and the book emoji are gone. Plays `IntroSequence` behind a live sign-in card, once per device. Signed-in users are redirected off it entirely — watch it on demand at `/?intro=1`. |
| `/signup`, `/signup/confirm` | anyone | Account creation, coach-code join |
| `/dashboard` | coach | Everything for the coach. 7 tabs: `home · athletes · groups · sessions · calendar · messages · settings`. 1,798 lines, one file. Bottom nav on mobile with a centre FAB. |
| `/athletes/[id]` | coach | One athlete. 6 tabs: `overview · sessions · wellness · calendar · profile · notes`. 1,285 lines. |
| `/sessions/[id]` | coach **and** athlete | The session page. Summary, focus points, coach notes, audio, videos, image attachments. 622 lines. |
| `/athlete` | athlete | The athlete's whole app. 6 tabs: `home · sessions · calendar · notes · messages · wellness` (home is labelled "Today" in the nav). 1,573 lines after the 2026-09-07 design pass. Bottom nav on mobile. |
| `/pdf/session/[id]`, `/pdf/monthly/[athleteId]` | coach | Printable reports |
| `/share/clip/[videoId]` | signed-in | Shared video clip. **Not public** — `app/api/share/clip/[videoId]/route.ts:15` returns 401 without a session. CoachVoice has no public surface at all. |
| `/reset`, `/auth/callback` | anyone | Password reset |

Route protection is `proxy.ts` (middleware): matcher `['/', '/dashboard/*',
'/athletes/*', '/athlete/*', '/sessions/*', '/reset']`, role-checked against
`profiles.role`. `/sessions/*` is signed-in but role-agnostic.

## Components (`app/components/`)

`QuickSessionModal` (the recorder — 26 KB) · `MessagingPanel` (28 KB) ·
`VideoAnnotator` · `Calendar` · `DayWheel` (home day strip) ·
`WellnessGraph` · `WellnessSubmit` · `SessionAudioPlayer` · `SportWheelPicker`.

**The entrance subsystem, added 2026-09-06/07.** This is the newest and least
reviewed surface in the app:

- `IntroSequence.tsx` (209 lines) — Direction A, the sign-in intro. Imported by
  `app/page.tsx` only.
- `ColdStartSplash.tsx` (338 lines) — Direction A compressed to 1.24s, played
  over the app while it loads. Imported by **both** role homes
  (`app/athlete/page.tsx:10`, `app/dashboard/page.tsx:9`); exports
  `markAppReady` and `SPLASH_SESSION_KEY`.
- `sportSilhouettes.tsx` — **64 lines but 113 KB**: fourteen sports as inline
  SVG path data. Generated by `node tools/register-silhouettes.mjs` from
  `tools/silhouette-art/`; the header forbids hand-editing. `ColdStartSplash`
  imports it and both role homes import that, so this file sits on the critical
  path of **every authenticated cold start on both sides of the app**. What it
  costs after minify+gzip has not been measured — do not assert a number
  without measuring one.
- `_banked/IntroSequenceAll.tsx` (19 KB) — Directions B and D. Imported by
  nothing; confirmed absent from the client chunks.

The silhouettes render in `--ink-figure`, which is a **safeguarding constraint,
not a style choice**: at montage speed they are large-area elements changing
more than three times a second, and WCAG 2.3.1 only permits that below a 10%
relative-luminance swing. `--ink-figure` sits at 7.6% against `--ink-base`;
`--primary-dark` is 11.0% and `--primary` 22.1%, and either would flash for an
audience aged 13–18. Detail may grow; brightness may not.

**The boot shell** (`app/layout.tsx`, 178 lines). The splash could not be the
first thing anyone saw: both role homes are client components, so their server
HTML was a Suspense "Loading…" and `ColdStartSplash` only unhid itself inside
`useEffect` — roughly a megabyte of JavaScript between opening the app and the
brand moment. So the splash's *resting frame* is now server-rendered inline in
the layout as `#cv-boot` and shown by CSS alone, with an inline pre-paint
script owning the cold-start decision through `data-boot` / `data-boot-anim`.
Scoped to `/dashboard` and `/athlete` only, forced with `?splash=1`, and
carrying a dead-man's-switch timeout so a bundle that never arrives cannot
strand a user on an ink screen. Nothing in that block may depend on JavaScript,
the CSS chunk, or the webfont.

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
`soreness` and `stress` read 5 = good, like every other metric — the scale was
written so 5 is always the good end. They carried `inverted: true` in
`lib/wellness-config.ts` until 2026-09-09, which made every scoring function
compute `6 - raw` on answers that were already the right way round and ran the
safeguarding alert backwards. Deleted, not migrated: the hints predate the flag,
so the stored data was always 5-is-good. Athlete submits; coach reads.
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

**Both role homes are now fully tokenised** and `eslint.config.mjs` bans
six-digit hex literals under `app/athlete/**` and `app/dashboard/**` — verified
to fire, not merely to pass. Still outside the glob: `app/athletes/[id]`,
`app/sessions/[id]` and the components. Type sizes come from `--fs-1`..`--fs-6`
with an 11px floor; neither role home has text below 11px. `--primary` is no
longer used as text anywhere (it was 3.65:1 at 10 sites).

`app/globals.css` defines a coherent "Letter Edition" token set: ivory/parchment
surfaces (`--bg #FBF8F3`, `--card #FFFFFF`, `--border #E3DED2`), sage primary
(`--primary #6F8E6B`, `--primary-dark #4F6B4B`), rust for coach
(`--coach-color #B55C3E`), amber energy, Newsreader serif for display + Plus
Jakarta Sans for UI + JetBrains Mono. Component classes: `.card`, `.card-lg`,
`.card-journal`, `.btn` + 6 variants, `.input`, `.label`, `.badge` + 9 variants,
`.stat-card`, `.nav-pill`, `.hero-bar`, animations, PWA/safe-area handling,
44 px minimum tap targets under 768 px.

**The token set, plus four different grounds in the unauthenticated funnel.**
A new coach walks `/` → `/signup` → `/signup/confirm` in about ninety seconds
and sees three unrelated dark gradients; password reset then shows parchment:

1. the token set (most of the app), which now also carries an eight-token
   wellness scale — `--wellness-good|ok|low|none` plus paired `-tint` values,
2. `/` — browns `#1A0E06 → #120C06` with amber and indigo glows (`app/page.tsx:54,63-64`),
3. `/signup` — slate→indigo→violet `#0f172a → #6366f1` (`app/signup/page.tsx:293`),
4. `/signup/confirm` — mid blue `#1e3a5f → #1d4ed8` (`app/signup/confirm/page.tsx:9`),
   against `/reset` on `var(--bg)` (`app/reset/page.tsx:28`).

The brand mark is **four different objects** across those screens. The app's real
logo is the sage tile with a stroked SVG at `app/dashboard/page.tsx:807-812`.

`app/globals.css:558-570` ships `.bg-gradient-sport/coach/athlete` and **nothing
uses any of them** — the system offered a house gradient and all three auth pages
invented their own instead.

The five per-metric identity hues in `lib/wellness-config.ts` (`#10b981`,
`#3b82f6`, `#8b5cf6`, `#f59e0b`, `#ef4444`) survive as **chart fills only**,
where 3:1 governs. They no longer render as text anywhere.

**Known contrast measurements** (computed, sRGB, WCAG 2.2 formula):

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` `#1F2421` on `--bg` `#FBF8F3` | ~15.4:1 | passes everything |
| `--text-2` `#5D6661` on `--bg` | **5.49:1** | passes AA normal text |
| `--text-muted` `#6B736D` on `--bg` | **4.61:1** | passes AA (was `#9BA29B` at 2.47:1 until 2026-09-06) |
| `--primary` `#6F8E6B` on white | **3.65:1** | fails AA normal text. Fine as a fill — but the code uses it as **text at 10 sites**, several at 11–12px, all failing 1.4.3. `--primary-dark` is the drop-in. |
| `--primary-dark` `#4F6B4B` on white | 5.94:1 | passes AA normal text |

`--text-muted` is used at 10–13 px for session dates, stat sub-labels, "delta"
strings, quote strips and empty-state copy across every page.

**Regression, found and FIXED 2026-09-09** (round-4 build). This paragraph used to end "nothing
hardcodes the old hex — every site reads the token". That is no longer true.
The 2026-09-07 athlete design pass (`199761b`) reintroduced **eight hardcoded
`#9BA29B`** instances into `app/athlete/page.tsx` — lines 755, 768, 784, 794,
813, 835, 893 and 914 — at font sizes 9, 9.5, 10.5 and 11 px. `#9BA29B`
measures **2.47:1** on `--bg`: it fails AA (4.5:1) and even the 3:1 large-text
floor, on the screen a teenager opens daily. `--text-muted` (`#6B736D`,
4.61:1) is the drop-in.

**Fixed, and this time guarded.** All 65 hex literals in `app/athlete/page.tsx`
now read tokens — the count is zero, not eight — and `eslint.config.mjs` carries
a `no-restricted-syntax` rule banning six-digit hex literals under
`app/athlete/**`, verified to fire on a reintroduced `#9BA29B`. The glob is
deliberately one page wide: `app/dashboard/page.tsx` still has 96 literals and
widening the rule before migrating a page just breaks lint and gets it switched
off. **Widen it one page at a time; that is the plan.**

The second-order fact is still the interesting one: DESIGN-001 was built, and a
later pass quietly undid part of it, because nothing in the pipeline was
watching. The rule is the part that makes this the last time.

**The type scale now exists** (`--fs-1` 11px … `--fs-6` 30px). 76 declarations
on `/athlete` read it and **no text on that page is below 11px** any more.
Fifteen sites (14, 15, 17, 18, 22, 34, 36px) were deliberately left as literals
— those are emoji, avatars and body copy where snapping to a step is a visual
decision rather than a migration, and 14px body versus a 13px `--fs-3` is a real
open question nobody has looked at side by side.

**Entrance tokens, added 2026-09-06** (`globals.css:68-86`): `--grad-ink`
(`linear-gradient(160deg, #1F2421 0%, #3A4F38 100%)` — the gradient the coach
sidebar already painted, promoted to a token), `--ink-base #1F2421`,
`--ink-figure #445C42`, `--on-ink #F5ECD7`, `--on-ink-2`, `--intro-beat 400ms`,
`--ease-brand`. This is DESIGN-002's "one auth shell" landing partially: `/`
now uses it, `/signup` and `/signup/confirm` still do not. The four-ground
funnel is now a three-ground funnel.

**`prefers-reduced-motion` now exists** (`globals.css:519-541`) — the app
shipped seven keyframe sets with no opt-out until 2026-09-06.
`.recording-dot::after` is handled deliberately rather than swept up by the
wildcard: it goes from pulsing to a steady halo, so the mic-live indication
survives as a visible state with no motion.

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
- **The wellness return loop is now closed** (round-4 build): the athlete's
  wellness tab shows a 14-day strip of their own check-ins and one computed
  sentence above the form, the form prefills from today's row, and saving
  refreshes the home card. `mood` and `stress` are deliberately never narrated
  back to the athlete, and `soreness` is held out until the inversion
  contradiction in `lib/wellness-config.ts` is settled — see REGISTER.md.
  `WellnessGraph` remains coach-only by choice, not by omission.
- The entrance subsystem is around 900 lines and 130 KB of the newest code in
  the app, it runs before anything else on every cold start, and **no agent has
  reviewed what was actually built**. Round 3 reviewed the *idea* of an opening;
  the shipped implementation has never been through a review.
- The coach is the only author. An athlete cannot record anything for their
  coach, only private notes for themselves.
