# CoachVoice — Project State

**Purpose of this file:** the shared, cheap context every review agent reads
*instead of* re-reading the repo. Keep it under ~250 lines. Update it when the
architecture changes, not when a line of CSS changes.

Last verified against the codebase: **2026-09-09**, after the round-6 fixes
(on top of `13a7bdd`).

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
startup path. **Lint blocks CI as of 2026-09-09** — the backlog is zero, so a
new error fails the build rather than joining a pile.

**There is still no unit-test suite, but there are four rigs**, and they are the
shape this project's failures actually take — every bug it has shipped passed
the type checker, the linter and the build. `verify:safeguard` enforces six
static safeguarding rules (every route authenticates; the service-role key never
reaches a browser; private buckets stay private; coach-attention data never
reaches an athlete; wellness reads stay scoped; the athlete client never selects
a transcript) and prints its known gaps and its one justified auth exemption
every run. `verify:clock` runs the real date logic under 9 timezones for every
day of a year, 37,035 assertions — CI runs in UTC, which is why it exists.
`verify:prompt` pins two golden prompts, runs the name gate over recorded
transcripts and the parser over recorded replies; `--live` calls the real model,
opt-in. `verify:boot` drives real Chromium against a production build.

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

**The entrance subsystem.** `IntroSequence.tsx` (the sign-in intro, imported by
`app/page.tsx` only) · `ColdStartSplash.tsx` (the same idea compressed to 1.24s,
played over the app while it loads; imported by both role homes, exports
`markAppReady`) · `sportSilhouettes.tsx` — **64 lines but 113 KB** of inline SVG
for fourteen sports, generated from `tools/silhouette-art/` and not to be
hand-edited. That file sits on the critical path of every authenticated cold
start on both sides of the app; what it costs after minify+gzip has never been
measured, so do not assert a number. `_banked/IntroSequenceAll.tsx` is imported
by nothing.

The silhouettes render in `--ink-figure`, which is a **safeguarding constraint,
not a style choice**: at montage speed they are large-area elements changing
more than three times a second, and WCAG 2.3.1 only permits that below a 10%
relative-luminance swing. `--ink-figure` sits at 7.6% against `--ink-base`;
`--primary-dark` is 11.0% and `--primary` 22.1%, and either would flash for an
audience aged 13–18. Detail may grow; brightness may not.

**The boot shell** (`app/layout.tsx`). Both role homes are client components, so
their server HTML was a Suspense "Loading…" and the splash only unhid itself
inside `useEffect` — roughly a megabyte of JavaScript between opening the app
and the brand moment. So the splash's *resting frame* is server-rendered inline
as `#cv-boot` and shown by CSS alone, with an inline pre-paint script owning the
cold-start decision through `data-boot` / `data-boot-anim`. Scoped to
`/dashboard` and `/athlete`, forced with `?splash=1`, with a dead-man's-switch
timeout so a bundle that never arrives cannot strand a user on an ink screen.
Nothing in that block may depend on JavaScript, the CSS chunk, or the webfont.

**Recording is offline-first as of 2026-09-09.** The blob is written to
IndexedDB the instant the recorder stops, before any network call
(`lib/recording-queue.ts`), and upload/transcribe/save are retryable stages
resumed by `lib/recording-sync.ts` and drained by `PendingRecordings` on the
dashboard. Saving is the one non-idempotent leg — no idempotency key on
`POST /api/sessions` — so it is attempted once per drain and the row is deleted
on success. **None of this is covered by an automated check**, which makes it
the largest untested surface in the app and the one holding the only copy of a
recording.

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
group_id, created_at`.

`group_id` (migration 023) marks a squad recording — a group save writes one row
per member, all carrying the same transcript. **The athlete client never selects
`transcript` at all**, and the detail route withholds it from an athlete viewer
when `group_id` is set, because a squad transcript is the coach talking about
other children. Safeguard rule SG6 enforces the first half.

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
`wellness_checkins` also carries the soreness follow-up: `soreness_score`
(0-10, **more is worse** — the opposite direction to everything else here) and
`soreness_areas` (region ids). Asked only when the athlete says they are sore,
and the body map appears only from 4 up. Nothing averages `soreness_score` with
the five metrics below, deliberately; see migration 026.

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

### Injuries and availability
`injuries`: one row per injury — `athlete_id, coach_id, body_area, status
(active|recovering|cleared), severity, started_on, expected_return, cleared_on,
note`. `body_area` is a region id from `lib/body-map.ts`, the same vocabulary
the athlete taps on their check-in. Records **availability, not medicine**:
there is no diagnosis or treatment field anywhere, and the coach writes while
the athlete can only read (enforced in the route and in RLS).

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
Dashboard → FAB (or "Record Session" on three other surfaces) →
`QuickSessionModal`. Step 1 "record": target (Individual / Group, one-tap chips
with **no default** — both step-1 exits are disabled until one is picked) →
optional name → date (defaults today) → Start Recording → Stop & Transcribe,
which uploads audio via a signed URL and posts the file to `/api/transcribe`.
Step 2 "review": editable transcript → share-with-athlete toggle (**defaults
ON**) → Save. `POST /api/sessions` resolves the sport server-side, generates the
summary, writes the session, creates the calendar event and sends the email. A
group save fans out to one POST per member, each carrying `group_id`.

Since 2026-09-09 the coach gets a **receipt** naming who it went to and whether
it was shared, with one tap to the session. There is still **no way to delete or
reassign a session** once saved — `/api/sessions/[id]` exports only `PATCH` and
`athlete_id` is not in its allow-list, which is why the receipt offers no Undo.


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

**Three grounds in the unauthenticated funnel.** A new coach walks `/` →
`/signup` → `/signup/confirm` and sees unrelated dark gradients; `/reset` then
shows parchment. `/` is on `--grad-ink`; `/signup` (`#0f172a → #6366f1`) and
`/signup/confirm` (`#1e3a5f → #1d4ed8`) still invent their own. The brand mark
is a different object on each. `globals.css` ships
`.bg-gradient-sport/coach/athlete` and **nothing uses any of them**. This is the
unbuilt remainder of DESIGN-002.

The five per-metric hues in `lib/wellness-config.ts` survive as **chart fills
only**, where 3:1 governs. They no longer render as text anywhere.

**Known contrast measurements** (computed, sRGB, WCAG 2.2 formula):

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` `#1F2421` on `--bg` `#FBF8F3` | ~15.4:1 | passes everything |
| `--text-2` `#5D6661` on `--bg` | **5.49:1** | passes AA normal text |
| `--text-muted` `#6B736D` on `--bg` | **4.61:1** | passes AA (was `#9BA29B` at 2.47:1 until 2026-09-06) |
| `--primary` `#6F8E6B` on white | **3.65:1** | fails AA normal text. Fill only — it is no longer used as text anywhere; `--primary-dark` is the text form. |
| `--primary-dark` `#4F6B4B` on white | 5.94:1 | passes AA normal text |

`--text-muted` is used at 10–13 px for session dates, stat sub-labels, "delta"
strings, quote strips and empty-state copy across every page.

**Contrast discipline is now enforced, not remembered.** `eslint.config.mjs`
bans six-digit hex literals under `app/athlete/**` and `app/dashboard/**`, and
the rule is verified to fire rather than merely to pass. Both role homes read
tokens for every colour. The glob is deliberately narrow — widening it before
migrating a page just breaks lint and gets it switched off. **Widen it one page
at a time; that is the plan.** Still outside: `app/athletes/[id]`,
`app/sessions/[id]` and the components.

**A type scale exists** (`--fs-1` 11px … `--fs-6` 30px, an 11px floor). No text
on either role home is below 11px. Fifteen sites keep literal sizes on purpose
— emoji, avatars and body copy where snapping to a step is a visual decision.

**Entrance tokens** (`globals.css`): `--grad-ink`, `--ink-base`, `--ink-mid`,
`--ink-figure`, `--on-ink`, `--on-ink-2`, `--intro-beat`, `--ease-brand`. `/`
uses them; `/signup` and `/signup/confirm` still do not, so DESIGN-002's "one
auth shell" is landed only partly and the funnel shows three grounds, not one.

**`prefers-reduced-motion` exists** (`globals.css`). `.recording-dot::after` is
handled deliberately rather than swept up by the wildcard: it goes from pulsing
to a steady halo, so the mic-live indication survives as a visible state.

The narrative of how each of these was found and fixed lives in
`reports/` and `REGISTER.md`. This file states what is true now.
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

- No quantitative performance data of any kind. Every session is qualitative.
- No session goal set *before* a session, only notes captured after.
- No athlete self-assessment tied to a session. Wellness is day-level, and the
  coach now sees the morning check-in beside a session, but the athlete cannot
  answer a session at all.
- A focus point is extracted into a session and **nothing carries it forward** —
  the next session does not know the last one set a focus, and nobody ever
  closes the loop on whether it was worked on.
- No session delete and no reassign. `/api/sessions/[id]` exports only `PATCH`
  and `athlete_id` is not in its allow-list.
- Nothing an athlete sees is shareable and there is **no public surface at all**,
  which is good for safeguarding and means any growth mechanism has to run
  through email to adults rather than a link.
- `/api/transcribe` requests `verbose_json` and returns Whisper's `segments`
  array with per-sentence timestamps. **Nothing consumes it** — the app pays for
  a timestamped map of every recording and discards it.
- No streaks, no habit loop, no reason to open the app on a day with no session.
  `TrainingSpine` shows twelve weeks of shape, deliberately without a streak.
- The coach is the only author. An athlete cannot record anything for their
  coach, only private notes for themselves.
- The three auth pages still use three different grounds; only `/` is on the
  entrance tokens.
