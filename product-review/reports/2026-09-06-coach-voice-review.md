COACH VOICE — DAILY PRODUCT REVIEW

Date: 2026-09-06
Reviewed against: 5b1a6c5 (app code at d033ef8)
Run: second review. First run with four agents, and the first with the three
original agents sharpened to owe a STRETCH proposal, a challenge and a cut.

────────────────────────────────────────────────────────────
📊 DATA & PERFORMANCE
────────────────────────────────────────────────────────────

**ID** DATA-002 — Show the coach the last focus point, at the moment they press record.

**Observation**
DATA-001 shipped and works: `app/api/sessions/route.ts:104-134` splits a `NEXT:`
line off the summary and writes it to `focus_points` (`:250`); the athlete sees it
on their home card (`app/athlete/page.tsx:779-816`).

Then the loop stops dead. `focus_points` appears on `/sessions/[id]` and **nowhere
else** — zero matches in `app/athletes/[id]/page.tsx`, zero in
`app/dashboard/page.tsx`, absent from `/api/sessions/all`'s select
(`app/api/sessions/all/route.ts:37-49`), absent from the monthly PDF. And absent
from the recorder: between picking an athlete chip
(`app/components/QuickSessionModal.tsx:363-396`) and pressing record (`:495-502`)
the coach is shown nothing at all about that athlete.

The app extracts a forward-looking instruction, shows it to the 14-year-old, and
hides it from the only person who can act on it next time.

**Recommendation**
Individual mode only: when an athlete chip is selected, fetch
`apiJson('/api/sessions?athlete_id=' + athleteId)` — which **already returns
`focus_points`** (`app/api/sessions/route.ts:164`) — and render the most recent
non-empty one as a single quiet line above Start Recording. No migration, no new
route, no new capture.

Rules that make it signal rather than noise: individual mode only (group members
differ); suppress if the last session is over 30 days old; suppress if empty
(common and correct); **read-only** — no checkbox, no "did they do it?". The
coach's response goes where every other coaching judgement goes: into the
recording. The next summariser pass then extracts the follow-up focus for free.
The loop closes itself.

Scope note: this touches `QuickSessionModal`, which `CLAUDE.md` protects. It is
step-1 presentational UI only — not `startRecording`, not `stopAndTranscribe`,
not MIME detection, not FormData. It needs Max's explicit go-ahead.

**Why it matters**
It tells the coach, at the moment before they speak, what they told this athlete
to work on last time, so the recording can say whether it moved. Right now the
focus point is a note; this makes it a goal with a follow-up, and that difference
is the entire value of the field. An instruction issued once and never referenced
again is indistinguishable from one never issued.

**What the athlete sees**
Nothing new on the day it ships — and the agent was candid about that. The payoff
arrives in the *next* session's summary, in the coach's own words: *"Platform is
holding much better than two weeks ago."* That clause cannot exist today, because
the coach did not have the previous focus in front of them when they pressed record.

**Coach use case**
8:40pm, court emptying. Taps "Mia", reads *Last session (26 Aug): Get the platform
out early on the low serve.* Two seconds. Presses record and opens with "Mia — the
platform's early now, that's fixed, so tonight we're onto footwork."

**Complexity** Low · **Impact** High · **Confidence** Medium-High

**Evidence**
Locke & Latham, *Building a Practically Useful Theory of Goal Setting*, American
Psychologist 57(9), 2002: feedback is a **moderator** of the goal–performance
relationship — "for goals to be effective, people need summary feedback that
reveals progress in relation to their goals." CoachVoice ships the goal with no
mechanism for progress against it. This adds no feedback machinery; it puts the
goal in front of the person already generating the feedback.
The 30-day cutoff and read-only choice are judgement, not research.

**Scores** Impact 4 · User value 4 · Effort 2 · MVP 4 · Confidence 4
**Priority** (4 × 4 × 4 × 4) / 2 = **128**
**MVP verdict** BUILD NOW

**STRETCH — DATA-003: The Thread.**
Months of a coach talking about the same athlete, already transcribed, are used
exactly once each and then re-served as a reverse-chron list. The monthly PDF
proves it — `app/pdf/monthly/[athleteId]/page.tsx:87` selects three fields and
prints them in order. It is a photocopier. It cannot answer the only question a
parent has: "is she getting better?" The bet: send the last 6–10 transcripts to
GPT-4o-mini, identify themes the coach returned to more than once, state in three
sentences what changed. Prose, not metrics. Coach-gated in draft before the
athlete sees it. Refuses to run below 6 sessions across 4 weeks.
**The serious risk:** a transcript corpus contains no ground truth about
improvement, only about what was said. A confidently wrong "your passing has
improved" shown to a 14-year-old is worse than silence and worse than a wrong
`NEXT:` line, because it is a *verdict* rather than an instruction. The coach gate
is the whole safety mechanism. **Check first, before building anything:** do
coaches record the same athlete 6× a month? That is queryable today. If not, moot.

**What I'd challenge**
Wellness collects five numbers to make a decision that uses one:
`computeWellnessAlert` (`lib/wellness-config.ts:133-160`) flattens all five into
an unweighted mean and thresholds at 3, so the coach is told "2.6/5" without being
told *which* metric dragged it there. Naming the two worst metrics is a ten-line
change.

**What I'd cut**
The duplicated summary on the athlete's sessions-tab hero card — the same session
is already on the home card at 120 chars and reappears at 140 one tap later. Two
truncations of one text teach the athlete that neither is the real thing.

────────────────────────────────────────────────────────────
⚡ UX & USABILITY
────────────────────────────────────────────────────────────

**ID** UX-002 — "Read full session" does not open the session.

**Friction identified**
Every labelled affordance on the athlete's home screen names a destination it does
not deliver, and the worst case is the product's core loop. The primary CTA on the
"New from Coach" card reads **"Read full session →"**
(`app/athlete/page.tsx:818-820`) and its handler is `onClick={() =>
setTab('sessions')}`. It does not open the session. It switches tab.

The tab it switches to opens on a hero card (`:865-888`) that re-renders the same
session the athlete just tapped away from — same title, same summary, truncated at
140 instead of 120. It is a bare `<div>`: no `onClick`, no `href`, no `role`. The
largest, most decorated element on the screen they were just sent to is not
clickable, and the scroll-to-top effect (`:82-84`) guarantees they land looking at
it. The real session is two more taps down (`:908-940`, then `:947-960`).

Three more on the same screen:
- "See your trends →" (`:742-744`) → `setTab('wellness')`, which renders **only**
  `<WellnessSubmit>` (`:1155-1159`) — a blank check-in form. There are no trends:
  `WellnessGraph` renders in exactly one place, the coach's page
  (`app/athletes/[id]/page.tsx:1075`).
- The five metric buttons (`:764-768`) look like the rating control and are
  navigation. The athlete taps "Energy", lands on a form, and hunts for Energy.
- The header messages button (`:635-638`) has **no `onClick` at all**, and carries
  an unread dot whose condition is `sessions.length > 0` — a badge meaning "you
  have a session", permanently lit, on a control that does nothing.

**Current workflow** home → "Read full session" → Sessions tab, dead hero card →
accordion header → "Open full session" → `/sessions/[id]`. **3 taps, 2 screens.**
**Proposed workflow** home → "Read full session" → `/sessions/[id]`. **1 tap.**

**Change recommended**
Two edit sites, one file, no API, no schema.
1. `app/athlete/page.tsx:818-820` — make it a `Link` to `/sessions/${sessions[0].id}`.
   Identical position and styling. The return path already exists and is correct:
   `/sessions/[id]` renders a back link reading "My portal" for non-coaches
   (`app/sessions/[id]/page.tsx:290,326-331`).
2. `app/athlete/page.tsx:865-888` — **delete the hero card.** The first accordion
   row below it is the same session and is interactive. If it must stay, it becomes
   the same `Link` — a card that large must not be inert.

The destination is a strict content upgrade: `/sessions/[id]` renders the
recording, the untruncated summary, "Take into next session", coach notes,
attachments, video and the full transcript. Nothing is lost; the accordion stays
for older sessions, so per-session private notes remain reachable.

**Why**
*Label–destination integrity*: a control's label is a promise about where it goes.
"Read full session" that does not open the session teaches the athlete that this
app's buttons are approximate. *Perceived affordance*: the largest, most decorated
element is inert while the small text link below it works — shape and prominence
inverted against actual interactivity.

**Coach scenario**
The coach speaks for ninety seconds, edits, saves, and the app emails the athlete.
That is the entire product. The athlete opens it on the bus, sees 120 characters,
taps the big dark button that says "Read full session", and gets 140 characters of
the same paragraph on a card they cannot tap. The realistic outcome is that they
read the teaser, decide they have read it, and close the app. The coach's ninety
seconds reach the athlete as one sentence.

**Tap/time reduction** 3 taps → 1 on the most-performed action in the athlete app.
One transit screen and one duplicate render removed. ~4–6 seconds and one scroll.

**Complexity** Low · **Impact** High · **Confidence** High
**Scores** Impact 4 · User value 5 · Effort 1 · MVP 5 · Confidence 5
**Priority** (4 × 5 × 5 × 5) / 1 = **500**
**MVP verdict** BUILD NOW

**STRETCH — UX-003: delete the athlete's home and wellness tabs.**
Every control on the athlete's home tab is a router — six of them, all `setTab`
calls. The screen holds no content of its own except a 120-character truncation.
It is a hub whose entire job is to point at the other tabs: a wasted first screen
for someone who looks at their phone for three seconds between reps. Instead
`/athlete` opens on one vertical page ordered by obligation — check in (inline,
not two taps behind a tab), then what the coach said (full, tappable), then
history, note composer at the bottom. Bottom nav 5 slots → 3.
**Cost** ~250 lines out of a 1,528-line file, and the mic FAB disappears.
**Risks, all real:** after submitting, the top of Today becomes a dead "✓ complete"
band unless the order inverts; session history drops below the fold; and
`WellnessSubmit` initialises from `{}` while the API upserts on
`(athlete_id, check_date)`, so an always-visible form makes silent overwrite of
today's answers much easier to trigger. **Cheap test first:** log tab transitions
for a week. If `home` is only ever transit and never a destination, it should not
exist.

**What I'd challenge**
We ask a 15-year-old for five numbers every day and give them nothing back —
`WellnessGraph` is coach-only, and the athlete's own "See your trends →" opens a
blank entry form. A daily habit with no visible return to the person performing it
is an assumption nobody has tested.

**What I'd cut**
The sessions-tab hero card (`app/athlete/page.tsx:865-888`) — a non-interactive
`<div>` re-showing, twenty characters longer, the session just tapped away from.

*Also checked and found fine:* the messages composer (Enter-to-send, disabled-until-text,
auto-scroll), the RSVP row (three states, colour + weight, failures surface), the
notes filter chips (zero-note sessions correctly hidden, so the filter never offers
an empty result).

────────────────────────────────────────────────────────────
🎨 VISUAL DESIGN
────────────────────────────────────────────────────────────

**ID** DESIGN-002 — One auth shell, built from a gradient the app already draws.

**Design issue/opportunity**
The register listed one open palette divergence. There are **four grounds in the
same ninety-second funnel**, and I verified every one:
- `app/page.tsx:54` — brown `#1A0E06 → #2C1810 → #1E1208 → #120C06`, plus amber
  `rgba(245,158,11,.08)` and indigo `rgba(91,99,245,.07)` glows (`:63-64`)
- `app/signup/page.tsx:293` — slate→indigo→violet `#0f172a → #6366f1`
- `app/signup/confirm/page.tsx:9` — mid blue `#1e3a5f → #1d4ed8`
- `app/reset/page.tsx:28` — parchment `var(--bg)`

The brand mark is four different objects across those screens: a 60px amber/indigo
glass tile with `📖` (`page.tsx:71-84`); a bare `🎙️` at 24px (`signup:303-307`); a
36px `--text` tile with `🎙` (`reset:37-46`); and the app's *actual* logo — a 36px
sage tile with a real stroked SVG (`dashboard:807-812`).

What makes this cheap: `app/globals.css:558-570` already ships
`.bg-gradient-sport/coach/athlete`. A grep across `app/**/*.tsx` returns **zero**
usages of any of them — verified. The design system already offered a house
gradient and all three auth pages invented their own instead.

**Recommended change**
Add `--grad-ink: linear-gradient(180deg, #1F2421 0%, #3A4F38 100%)` plus `--on-ink`
/ `--on-ink-2`. This is **not a new colour**: `#1F2421` is `--text`, and the pair is
the exact gradient already painting the coach sidebar (`dashboard:802`). Delete the
three dead classes. Apply it to `/`, `/signup`, `/signup/confirm`; drop both glow
divs; unify all four marks to the dashboard's; extract `Icon` to
`app/components/Icon.tsx` so the auth pages can use it (`AthleteIcon` at
`athlete:52-63` is a six-glyph copy of the same paths — fold it in); repoint
`dashboard:802` at the token so there is one definition.

Deliberately **not** `.bg-gradient-coach`, though it exists and is in-family: its
light stop `#6F8E6B` gives cream text 3.10:1 — fine for a 28px headline, failing at
13px. The sidebar gradient's light end `#3A4F38` gives 7.58:1, safe at every size.

**Visual hierarchy**
Today the 60px amber/indigo tile wins — the only chromatic, backdrop-blurred object
on a near-black field, above the card. The inputs come fourth. The most decorative
element wins. After: the card first (the sole light rectangle, carrying both inputs
and the sage CTA), then the wordmark, then the mark. Correct for a screen whose
only job is "type here".

**Research/design rationale**
EVIDENCE (computed this run, alpha composited against the underlying stop):

| Site | Ratio | Verdict |
|---|---|---|
| `page.tsx:206` footer 12px, `rgba(245,236,215,.3)` | **2.45:1** | fails 1.4.3 |
| `page.tsx:198` "Create an account" 14px/700, `--primary` on composited card | **3.24:1** | fails |
| `signup:639` same link on white | **3.65:1** | fails |
| `page.tsx:88` tagline 13px | 4.52:1 | **passes** — no failure claimed |
| `page.tsx:85` headline | 14.34:1 | passes |

Proposed, measured at the gradient's *lightest* point (`#3A4F38`, worst case):
`#F5ECD7` **7.58:1** (13.40:1 at the dark end); `--on-ink-2` **4.83:1**, so the
footer goes 2.45 → 4.83; `--primary-dark` **5.28:1** on the card and **5.94:1** on
white, so both links go fail → pass. White mic on `--primary` is 3.65:1 — as a
non-text graphic that is SC 1.4.11 (3:1), so it passes as an icon, not as text.

DESIGN OPINION, labelled: an entry screen that changes ground three times in ninety
seconds reads as unfinished, and "unfinished" is the one thing a product asking a
coach for children's wellbeing data cannot afford. The amber-plus-indigo pairing is
the least defensible thing in the codebase — two accent hues that appear nowhere
else, at 7–8% alpha, imperceptible at arm's length in daylight. *What would change
my mind:* if the dark entry screen tests better **because** it feels unlike the app
— a deliberate threshold — keep dark grounds but still make them one gradient. And
if Max's view is that the glow is the brand and the parchment is the compromise,
this proposal is backwards.

**Honest note on the three-second test:** the current screen does not fail it. A
user finds the email field today. This is brand coherence and contrast, not task
completion, and I would rather say so than inflate it.

**Consistency impact** Grounds in the unauthenticated funnel 4 → 1. Brand marks
4 → 1. Gradient definitions: 3 dead + 1 inline duplicate → 1 live token. Icon
components 2 → 1. Every edit deletes a literal or replaces one with a token.

**Complexity** Low–Medium — eight sites across five files, six of them one-line
swaps. The real work is extracting `Icon` and repointing `AthleteIcon`'s six call
sites inside a 1,499-line file.
**Scores** Impact 3 · User value 3 · Effort 2 · MVP 3 · Confidence 5
**Priority** (3 × 3 × 3 × 5) / 2 = **67.5**
**MVP verdict** BUILD NOW — yielding to anything with genuine task-completion value
competing for the same slot this week.

**STRETCH — DESIGN-003: retire emoji as iconography.**
39 pictographic emoji across 11 files; `app/athlete/page.tsx` alone has 19 spanning
14 glyphs — and that is the teenager-facing surface. They coexist with a properly
drawn 17-glyph stroked SVG set that is *duplicated in miniature* as `AthleteIcon`.
The app maintains two icon systems and one of them is the operating system's.
EVIDENCE: emoji render as different artwork per platform, cannot inherit
`currentColor`, ignore `strokeWidth`, have no stable optical size, and screen
readers announce them by CLDR name — `🎙` reads as "studio microphone" next to the
word CoachVoice. **Risk, and it is the interesting one:** emoji are why the athlete
side feels warm to a 15-year-old; a fully monochrome set could make `/athlete` read
as an enterprise dashboard. **What I will not defend is shipping both.**

**What I'd challenge**
The "Letter Edition" identity itself — parchment, serif, "Your private training
journal" — is a diary, while the brief asks for athletic and high-performance. The
codebase quietly voted against it three times: whoever built `/`, `/signup` and
`/signup/confirm` each reached for a dark tech gradient rather than the house
parchment. Three independent defections from your own design system is a signal
about the system, not the pages.

**What I'd cut**
`/signup/confirm` — a full page, a third palette and a redirect that exist to
display the sentence "check your email". Make it a state on `/`.

────────────────────────────────────────────────────────────
🚀 WOW FACTOR
────────────────────────────────────────────────────────────

**ID** WOW-001 — Hear It: the coach's actual voice, cut to the sentence.

**The gap**
CoachVoice records a coach's real human voice — the scarce, irreplaceable thing a
notes app cannot hold — and throws it away twice.

*Literally.* `/api/transcribe` asks Whisper for `verbose_json` and returns
`segments` with timestamps (`app/api/transcribe/route.ts:75,102`). **Nothing
consumes them** — those two lines are the only occurrences of `segments` in the
repo, and `QuickSessionModal` reads `json.text` and drops the rest
(`:174`). The app pays for a word-aligned map of every recording and discards it
before the response is parsed. *(Orchestrator: verified by grep across app/ and lib/.)*

*Rhetorically.* The athlete's home card renders the GPT-4o-mini summary inside
curly quotation marks (`app/athlete/page.tsx:797`). It is not the coach speaking.
It is a language model's paraphrase of a mishearing of the coach speaking, in
quotation marks, shown to a 14-year-old. Meanwhile the real sentence, in the real
voice, sits in the private bucket with a working signed-URL route already built.

So the product's one-sentence story is "it records stuff and an AI writes it up" —
which also describes Speakwise and Feedz, all of which turn the coach's voice into
a **report for the coach**. Hudl points at parents and does 12 million athlete
highlights a year, but the coach is silent in every one. Nobody delivers the
coach's *unedited voice, cut to the sentence, addressed to one named kid,
retrievable a year later.*

And that is what moves the needle on why kids quit: the top reason is that it
stopped being fun, tied to feeling "not good enough" (29%), and young athletes'
confidence is shaped by repeated experiences of being told they did something well
enough to feel capable. A paraphrased bullet is not that experience. Hearing your
coach say "that's the best you've served all year" is.

**The idea — three layers, in build order**
1. **Anchors.** Persist what is already computed and discarded. Migration `022`
   adds `transcript_segments` and `summary_anchors`. The summariser emits, after
   each bullet, the verbatim transcript span it came from; a deterministic
   server-side matcher aligns it to the segment list. Below a confidence threshold,
   nothing is stored and the bullet renders exactly as today. **Fail silent, never
   wrong.**
2. **The tap.** Each bullet and focus point gets a small play affordance. Opens the
   existing signed URL, seeks to `start`, stops at `end`. No ffmpeg, no server-side
   audio, no new dependency. (The mp4-first MIME order becomes load-bearing for a
   second reason: Range seeking is reliable in mp4/AAC, flaky in WebM/Opus.)
3. **Then / Now.** When the coach saves a new session, the model is handed the last
   focus point and asked whether the coach addressed it. If yes, store a then/now
   pair. The athlete's card shows *"Three weeks ago"* ▶ and *"Tuesday"* ▶. Same
   voice, same subject, audibly different verdict. Progress made **hearable**.
4. **The Tape.** Season's end: the coach picks eight anchors, the browser stitches
   them (`OfflineAudioContext` + canvas + `captureStream()` → `MediaRecorder`, all
   shipped since 2020), and out comes a 45-second vertical video that is nothing
   but a coach's voice across four months about one kid.

**The moment**
9:02pm, Maya opens the app on the bus. Under the second bullet is a small waveform
pill. She taps it. Her coach's voice comes out of her phone — not a summary of him,
**him**, hall echo behind it, slightly out of breath: *"that's the best read you've
made all season, that's the one."* Six seconds. She taps it again. Below it, a
second pill labelled **Three weeks ago**: the same man, different hall, *"you're
reading the middle too late, you're waiting for the ball."*

That is the "oh, that's good". A fifteen-year-old on a bus hearing evidence, in a
voice she trusts, that she is not the player she was in August.

**Why anyone would talk about it**
*Coach to coach:* the pitch stops being "it writes up your notes" and becomes "the
kids hear me — the bit where I said it, and the bit three weeks before where I said
the opposite." Coaches evangelise tools that make them look like better coaches to
parents. *Parent to parent:* a parent will not forward an AI bullet list. A parent
will absolutely forward forty-five seconds of a real coach's voice saying their kid
got better — and testimony *about* a child is something parents are far more
comfortable sending to relatives than footage *of* one. **The moat:** after two
seasons, a coach with 200 anchored sessions cannot migrate, because a rival with
twice the funding cannot retroactively record 200 hours of that specific human
being. The asset is the archive, and only time makes it.

**What it takes**
Migration `022`; the summariser prompt and parser widened; a new ~80-line
deterministic alignment function; one new client component reusing the existing
audio-url route. **No new API cost** — `verbose_json` is already requested.
**The one real conflict, stated plainly:** getting `segments` from the transcribe
response into the save call means editing `stopAndTranscribe`, a function
`CLAUDE.md` protects by name. There is a path that avoids the file entirely —
`POST /api/sessions` already receives `audio_path`, so it can make its own aligned
Whisper call server-side (~$0.006 per ten-minute session, a few seconds of save
latency, zero protected files touched). Start there. Layers 1+2: 2–3 days. Layer 3:
~2 days. Layer 4: 1.5–2 weeks. About three weeks for all four.

**What could go wrong**
**The taste risk is the big one.** The AI summary launders the coach; raw audio does
not. Coaches sigh, swear, and use a tone that reads as coaching in a sports hall and
as something uglier in a kitchen on a Sunday. Some fraction will be embarrassed and
a smaller fraction will be right to be. Not solvable, only gated: every clip
previewable by the coach first, and the existing `shared_with_athlete` toggle must
**not** carry audio clips by default — voice needs its own consent, defaulting off.
Also: wrong-clip failure (hence threshold-or-nothing), and bandwidth on 4G.

**Safeguarding check**
*Killed outright:* an athlete-facing "share your Tape to Instagram/TikTok" button —
a minor pushing a video carrying her name and an adult's assessment into public.
Dead, not softened. *The version that survives, and it is better:* the Tape is
rendered and released by the **coach**, an adult, and delivered to the athlete and
their registered caretaker through the existing Resend path — not to a URL. Only
that athlete's own sessions; never another child's name or voice. Then/Now compares
an athlete only to their earlier self: no ranking, no cross-athlete visibility.
Anchors come from session transcripts only, so wellness data never enters an audio
artefact. No streak, no nudge, no variable reward.
*One question the limits don't cover, raised deliberately:* "stored for
transcription" and "playable by a fifteen-year-old and embeddable in a video sent
to her mother" are not the same consent. The coach needs a real, informed opt-in —
not buried, not defaulted on.

**Cheapest version that still wows — one day, no migration, no protected file**
Build `/dev/hearit`, coach-only. Post an existing session's `audio_path` to
`/api/transcribe` exactly as the route already accepts it, read the `segments` array
it already returns and nothing has ever consumed, fetch the playback URL from the
existing audio-url route, and render the transcript as clickable sentences — tap
one, the audio seeks to that segment and stops at its end. Two existing routes,
unmodified, plus one throwaway page.
Then put it in front of three coaches and watch their faces at the moment they hear
themselves played back from the sentence they are pointing at. If nothing changes in
the room, close the idea. If someone says "wait, do that again", layers 1–4 have
earned their cost — and the hardest technical assumption is already validated.

**Scores** Impact 5 · User value 5 · Effort 4 · MVP 2 · Confidence 3
**Priority** (5 × 5 × 2 × 3) / 4 = **37.5**
The agent argued with its own number, and the argument is fair: the term dragging
it down is MVP relevance, which scores closeness to the product *as currently
conceived* — a conservatism term, correct for three agents whose job is keeping the
thing shippable, and the wrong term for "what would make this remarkable". Layer 1
alone is a 2–3 day change using data the app already pays for and deletes.
**Verdict** PROTOTYPE.

**Three more, unargued**
1. The coach records **once for the whole squad** on the walk to the car — "Maya,
   platform late, good dig in the third; Jess, serve is back; Amira, don't chase
   that ball again" — and the model splits one four-minute recording into eleven
   individually-targeted sessions. One recording, eleven athletes, zero taps each.
2. The `/` sign-in screen becomes **one consenting coach's real eight-second clip**,
   playing on tap above the form. The product demonstrated before anyone has an
   account — and the redesign nobody could authorise gets a target design for free.
3. The **first thing an athlete ever authors for their coach**: a 15-second voice
   reply attached to a focus point — *"I tried the platform thing, it felt weird on
   the first ten"* — sealed until the coach opens the recorder for that athlete,
   then played as the first thing they hear before they start talking.

────────────────────────────────────────────────────────────
CHALLENGES TO THE STATUS QUO
────────────────────────────────────────────────────────────

Unresolved on purpose. These are for Max to react to, not for me to settle.

| Agent | Challenge |
|---|---|
| DATA | Wellness collects five numbers and the alert uses one flattened mean, so the coach is told "2.6/5" without being told which metric caused it. |
| UX | We ask a 15-year-old for five numbers daily and give them **nothing** back — the graph is coach-only and their "See your trends" opens a blank form. |
| DESIGN | The "Letter Edition" diary identity may simply be wrong for an athletic product — and the codebase defected from it three times in the auth funnel. |
| WOW | The summary is a model's paraphrase rendered **inside quotation marks** as though the coach said it, to a child. |

**Cuts proposed**

| Agent | Cut |
|---|---|
| DATA | The duplicated truncated summary on the sessions hero card. |
| UX | The sessions-tab hero card itself — inert, and a 20-character-longer repeat. |
| DESIGN | `/signup/confirm` — a whole page and a third palette to say "check your email". |

────────────────────────────────────────────────────────────
TODAY'S PRIORITY
────────────────────────────────────────────────────────────

## Cross-agent relationships

**Two agents independently proposed the same cut.** DATA and UX ran in separate
contexts and both landed on the athlete's sessions-tab hero card. When two
specialists with different briefs converge on deleting the same 24 lines, that is
the strongest signal this system has produced. UX-002 already deletes it.

**Two agents independently found the same hole.** DATA's challenge (five wellness
numbers, one flattened output) and UX's challenge (five numbers a day, nothing
returned to the athlete) are the same finding from opposite ends — the coach gets
an undifferentiated signal and the athlete gets nothing at all. Neither made it
their primary. Together they are a stronger case than either alone, and the
athlete-facing half is arguably the more serious: it is a daily ask of a teenager
with no reciprocity.

**DATA-002 and WOW-001 layer 3 are one bet at two sizes.** Both attack "nothing
carries a focus point forward". DATA-002 shows the coach the last focus point
before recording — half a day, no schema. WOW's Then/Now detects whether it was
addressed and plays both moments back in the coach's voice — two days on top of
anchors. This is exactly the pairing the four-agent setup exists to produce: a
cheap version to ship now and an ambitious version to aim at, of the same insight.
**Do DATA-002 first regardless** — it is the prerequisite behaviour, and if coaches
never speak to the prior focus, Then/Now has nothing to detect.

**UX-002 and WOW-001 attack the same card from different sides.** UX says the
button lies about where it goes. WOW says the quotation marks lie about who is
speaking. Both are about the athlete's home card telling a small untruth.

**DESIGN-002 and WOW's second unargued idea are compatible, not competing.** The
ink shell gives `/` a coherent ground; the coach's clip gives it something to
demonstrate. Shell first, clip later.

## Where I disagree with the agents

**The quotation marks are the cheapest real fix in this report and nobody made it
their primary.** `app/athlete/page.tsx:797` wraps a GPT-4o-mini paraphrase in
`&ldquo;…&rdquo;`, presenting a model's words to a 14-year-old as their coach's
direct speech. I am partly responsible: yesterday's DATA-001 work leaned on that
framing to justify leaving the focus line unquoted. The quotes predate this
session, but I read them and did not question them. Removing two HTML entities
makes the card honest. Do it with UX-002; it is the same file and the same card.

**DESIGN-002's real value is not the one it scores.** It is priced as brand
coherence, but it also fixes two AA failures on the only route a new coach has to
signup. That is a correctness argument sitting inside an aesthetics recommendation,
and it deserves more weight than 67.5 suggests.

**WOW-001's one-day prototype is the only part I would commit to now.** The Tape is
a product-identity decision, not a feature, and layer 1's dependency on a protected
file has a clean server-side workaround the agent found itself. The `/dev/hearit`
page risks a day and answers the only question that matters.

**Two errors in my own state file, both caught by agents.** The design agent found
I had recorded two live palettes when there are four in the auth funnel — verified,
`/signup` is slate-indigo and `/signup/confirm` is blue. And that `--primary` is
used as *text* at exactly 10 sites at 3.24–3.65:1, all failing 1.4.3, where my file
said "fine as a fill" — true of the token, not of what the code does. The wow agent
found `/share/clip` documented as public when its route returns 401. All three are
now corrected. The system caught its own briefing document being wrong, which is
worth more than any single recommendation in this report.

## #1 Recommendation today

**UX-002** — make "Read full session" open the session, and delete the dead hero card.

**Why it wins:** priority 500, the highest this system has produced, and the
arithmetic is right for once. It is a two-line change on the single most-performed
action in the athlete-facing app, it removes a screen rather than adding one, and
the destination is strictly better content than the origin. Effort 1, confidence 5.
Every other recommendation here improves something; this one stops the core loop
from quietly failing at its last step.

**Recommended action: BUILD**

**Implementation outline**
1. `app/athlete/page.tsx:818-820` — `<button onClick={setTab('sessions')}>` becomes
   a `Link` to `/sessions/${sessions[0].id}`, same styling.
2. `app/athlete/page.tsx:865-888` — delete the inert hero card.
3. Same file `:797` — drop the `&ldquo;`/`&rdquo;` around the AI summary.
4. `:635-638` — wire the header messages button to `setTab('messages')` and remove
   the `sessions.length > 0` dot; there is no athlete-side unread source
   (`app/api/messages/unread/route.ts:24-26` filters `sender_role = 'athlete'`).
5. `npx tsc --noEmit && npm run build`; confirm the back link from `/sessions/[id]`
   reads "My portal" and returns correctly.

## #1 Ambition

**WOW-001** — the one-day `/dev/hearit` prototype.

**Why this bet over the others:** it is the only proposal in this report that would
change what CoachVoice *is* rather than how well it does what it already does, and
its central claim is verified fact, not speculation — the app really does compute
and discard a timestamped map of every recording. It needs no migration, no schema,
no protected file and no new dependency to test. Against it: the taste risk is real
and unquantifiable from here, and the full four-layer build is three weeks.

**Cheapest way to find out if it is right:** build `/dev/hearit` in a day, show it
to three coaches, and watch whether anyone says "do that again". That single
reaction decides a three-week programme, and costs a day.
