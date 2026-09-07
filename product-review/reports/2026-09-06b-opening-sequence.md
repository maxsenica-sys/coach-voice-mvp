COACH VOICE — DESIGN REVIEW: THE OPENING SEQUENCE

Date: 2026-09-06 (second run of the day — single-topic, all four agents)
Reviewed against: e3be391
Deliverable: https://claude.ai/code/artifact/f29ad8a2-b5cd-49e8-aedb-be70dd315cef
             (four playable candidates, flash-safety numbers, order of work)

THE ASK
Max: stop opening onto the login form. Give it an intro — "some form of coaching
thing, whether it's like flashing of all different sports with like a 0.1 second
background shadow silhouette into the coach thing." Go wild, come back with
options.

────────────────────────────────────────────────────────────
THE CONVERGENCE — all four agents, independently
────────────────────────────────────────────────────────────

Every one of the four opened by finding the same defect, in separate contexts,
before any of them discussed design. Orchestrator verified all of it:

**A signed-in user is shown the login form on every cold start.**
- `proxy.ts:97` puts `/` in the matcher; `:50-52` resolves the user on every
  matched request — including `/`.
- `/` is in none of `COACH_ROUTES` / `ATHLETE_ROUTES` / `SHARED_ROUTES`
  (`proxy.ts:13-17`), so `isProtectedRoute` is false and `:93` returns the
  response untouched.
- `app/page.tsx` has **no session check of any kind** — no `useEffect`, no
  `getUser`, no `getSession`.
- `public/manifest.webmanifest:5` sets `"start_url": "/"` with
  `display: standalone`.

So the middleware holds the user object at the edge, before first paint, and
throws it away — and the home-screen icon of the installed PWA opens onto a
password field. Max felt this as an aesthetic complaint. It is a defect.

**Second, compounding:** every notification email CTA points at a protected
route (`lib/notify.ts:169,235,255,319` → `/athlete`, `/dashboard`,
`/athletes/[id]`). A lapsed session hits `proxy.ts:62`, which redirects to `/`
and **discards the destination** — there is no `next` param anywhere except
password reset. Put an intro at `/` naively and it plays in front of a
15-year-old who tapped a link to a specific session.

────────────────────────────────────────────────────────────
TWO MORE DEFECTS THE REQUEST SURFACED
────────────────────────────────────────────────────────────

**The intro already exists, and it is the wrong brand.**
`public/manifest.webmanifest` declares `background_color: "#0f2042"` (navy) and
`theme_color: "#2563eb"` (blue) — a palette CoachVoice retired.
`app/layout.tsx:17` separately declares `themeColor: '#1F2421'`.
`app/manifest.ts` holds the **correct** values (`#FBF8F3` / `#1F2421`) and is
**dead code**, because `app/layout.tsx:23` links the static `public/` file.
Result on a cold PWA launch: navy splash → brown page (`app/page.tsx:54`) →
parchment card, three unrelated hues in ~900ms, none of them tokens. Nobody
designed that sequence; it is three files disagreeing.
Also `app/layout.tsx:46` uses a 512px square icon as `apple-touch-startup-image`,
stretched to a phone screen.

**There is no motion-safety layer at all.**
`grep -rn "prefers-reduced-motion" app/ lib/` returns **zero results** across
every `.css`, `.ts` and `.tsx`. `app/globals.css` ships 7 keyframe sets,
including `pulse-ring 1.2s ease-out infinite` driving `.recording-dot` on
`QuickSessionModal`, `MessagingPanel` and `app/athlete/page.tsx` — an infinite
animation on the teenager-facing page with no opt-out.

────────────────────────────────────────────────────────────
FLASH SAFETY — the hard constraint on Max's idea
────────────────────────────────────────────────────────────

0.1s cuts = **10 flashes/second**. WCAG 2.3.1 (Level A) permits **3**. A general
flash is a pair of opposing relative-luminance changes of ≥10% of maximum, with
the darker state below 0.80, over more than the permitted area.

Computed (WCAG 2.2 sRGB formula), against the ink ground `#1F2421` (L 0.01663):

| Fill | L | Δ | Verdict as a full-screen figure |
|---|---|---|---|
| `#3A4F38` gradient top | 0.06777 | 5.1% | safe at any cadence |
| `#445C42` proposed figure | 0.09277 | **7.6%** | safe at any cadence |
| `#4F6B4B` `--primary-dark` | 0.12686 | 11.0% | **fails** |
| `#6F8E6B` `--primary` | 0.23787 | 22.1% | **fails badly** |
| `#FBF8F3` `--bg` | 0.94115 | 92.5% | catastrophic |

Max's literal proposal — white silhouette hard-cut on the current brown
`#1A0E06` (L 0.00547) — is a **93.6% delta at 10Hz**: roughly 9× the threshold
amplitude at 3× the legal rate, in front of an audience of 13–18 year olds.

**Area exemption, computed for phone geometry:** a 10° field at 30cm spans
5.25cm (27.6cm²); 25% of that is 6.89cm²; at ~54.6 CSS px/cm that is
**~143 × 143 CSS px**. Anything changing luminance by >10% must stay under it.
The sage mic tile at 36×36px is 6.3% of the exemption area — legal with a wide
margin, and it appears once and stays.

**THE RULE, one sentence:**
> An element may be big or bright — never both. And if it is both, never faster
> than 2.5Hz.

**The consequence that matters to Max:** figures at `#445C42` never reach the
10% threshold, so **no flash occurs at any frequency** — his 0.1s cadence is
legal provided the images never brighten. The honest cost is visibility:
`#445C42` on `#1F2421` is 2.14:1, genuinely subtle in daylight, with motion
doing the work contrast used to. Decorative, so no SC applies, and no 1.4.11
pass is claimed.

Also binding: **SC 2.2.2** (auto-motion >5s needs a pause mechanism — all
candidates are ≤4.5s *and* skippable) and **SC 2.2.1** (never gate interaction —
the form is focusable from frame 1).

`prefers-reduced-motion: reduce` behaviour, all candidates: the intro becomes
its **final frame, held**, reached by one 200ms opacity cross-fade. Opacity only
— vestibular triggers are motion of position and scale, not alpha. The user
keeps the brand moment and loses the movement.

────────────────────────────────────────────────────────────
📊 DATA-004 · "Stop treating the opening as a screen to add"
────────────────────────────────────────────────────────────
Priority (4×4×4×5)/2 = **160** · BUILD NOW (items 1-2) · REJECT the montage

Nobody arrives at `/` cold. CoachVoice has no public surface
(`app/api/share/clip/[videoId]/route.ts:15` returns 401). Every athlete arrives
through a coach's invite email; every coach because someone told them. An intro
at `/` is a sales pitch delivered to people who have already bought.

**A first-run intro already exists — twice — and PROJECT-STATE missed both:**
the athlete's at `app/athlete/page.tsx:540-586` (gated on `hasOnboarded === false
&& sessions.length === 0`, personalised by name, self-dismissing to
localStorage) and the coach's onboarding checklist at
`app/dashboard/page.tsx:1149-1180+`. Both sit **after** auth, where the app
knows who you are. They are the right design, already built.

**Does the app know who is arriving pre-auth?** The browser: no —
`lib/profile-cache.ts:16` deliberately uses sessionStorage, so a standalone PWA
cold launch is a guaranteed cache miss. The edge: yes, and discards it.

**Could an intro show something true?** Pre-auth, no number and nothing
personal. RLS scopes every table, there is no unauthenticated aggregate, and an
MVP rendering "112 sessions recorded" is worse than silence. The only true,
non-embarrassing thing is the *mechanism*.

**On silhouettes:** `lib/sports.ts` holds **154 sports across 11 categories, as
strings**. Zero silhouette assets exist (`public/` holds only icons — verified).
The montage would be the largest asset payload in the product, in front of the
one screen the daily user wants to skip, to render decoratively a list the app
already has as text.

REJECT the flashing-sports intro. BUILD the `proxy.ts` redirect and the manifest
fix. Fold the copy change into DESIGN-002.

**Explicit overlap flagged:** do not also show the last focus point at launch —
DATA-002 already places it at the recorder, which is the better moment. Same
line twice dilutes it.

**STRETCH DATA-005 — "Forty Seconds":** the login screen performs the product —
one real consented 8s clip, waveform moving, transcript typing at Whisper's own
timing, collapsing into the three bullets the athlete actually received. Frozen
as static JSON + ~120KB mp4, zero API calls. **Blocked, not backlogged:** it
requires a public front door that does not exist. Build the door first or don't
build this.

**Challenge:** the athlete's first-run screen (`app/athlete/page.tsx:560`) makes
"Check in daily — your coach tracks your energy, mood, sleep, soreness and
stress" the FIRST thing a 14-year-old learns about CoachVoice. That ordering
teaches the athlete the product is surveillance before it teaches them it is
coaching.
**Cut:** `lib/quotes.ts` — 218 lines, of which ~100 `COACH_QUOTES` have **zero
call sites**, in a product whose only real asset is that the words come from the
athlete's actual coach.

────────────────────────────────────────────────────────────
⚡ UX-004 · "Fix the front door, then the intro is free"
────────────────────────────────────────────────────────────
Priority (4×4×4×5)/2 = **160** · BUILD NOW (parts 1-2) · TEST (part 3)

Three parts, and part 1 is not the intro.

1. **Redirect signed-in users off `/`** in the middleware, reusing the role
   query already written at `proxy.ts:69-73`. **Guard:** only redirect on role
   exactly `'coach'` or `'athlete'` — a roleless profile must stay, mirroring
   the escape at `:80-82`, or you build a redirect loop. Both sign-outs await
   `signOut()` before pushing `/`, so no bounce-back race.
2. **Carry the destination through the auth wall** — `proxy.ts:62` gains
   `?next=`, `app/page.tsx:33` prefers it over the role home. This is what makes
   the intro safe: **when `next` is present, the intro does not play.** That
   person is not a visitor, they are an interrupted user.
3. **The intro — three placements:**
   - **Option A (recommended):** the montage is the page *background*; the
     sign-in card is opaque and interactive from frame 1. **0 extra taps, 0
     extra seconds, for everyone.** There is nothing to skip because nothing
     blocks — tapping the email field *is* the skip. This dissolves the
     visible-vs-discoverable skip dilemma rather than trading one bad option for
     another.
   - **Option B:** full-bleed, tap-anywhere-to-enter, no Skip pill. A corner
     "Skip" is the worst of both — it undercuts the drama *and* signals that
     what follows is worth escaping.
   - **Option C (pre-roll every launch):** rejected outright.

**The gating rule** — a conjunction, every clause load-bearing: no Supabase
session · no `?next=` · `localStorage['cv_intro_v1']` absent. **localStorage,
not profile-cache** (that is sessionStorage, `lib/profile-cache.ts:28,38`, and
dies with the tab). Precedent already in the app:
`app/athlete/page.tsx:161,544`. **Never cleared on sign-out** — replaying a
montage at someone who just deliberately signed out is punishment. Effect: once
per device, ever.

**Where it ends: the sign-in card, not a role fork.**
`app/signup/page.tsx:340-347` already IS that fork, one tap away. Duplicating it
pre-auth can be silently wrong: sign-in derives role from `profiles`, so a fork
answer contradicting the profile is either theatre or a mis-route.

**Measured cost:**
| | Today | Option A | Option B |
|---|---|---|---|
| First-time visitor | 1 tap, 4-8s scanning past 4 wrong controls | 1 tap, faster to the right control | 2 taps, +0.3-4s |
| Returning coach, live session | **3 taps + 2 round trips** | **0 taps at `/`** | 0 taps |
| Athlete from email | 3 taps, lands on wrong tab | 0 taps, lands on the session | same |

Bundled with part 1 the intro is not a cost to the returning coach — it is a
**2-tap refund**.

**STRETCH UX-005 — put the theatre where it is earned.** Delete the pre-auth
intro; build a 1.2s cold-start moment *inside* the app answering "what happened
since I last opened this". Same craft, aimed at the person who opens it four
times a week instead of the person who opens it once. Only legitimate if
strictly non-blocking, ≤1.2s, never repeated inside 6 hours.

**Challenge:** `start_url: "/"` plus a middleware that never redirects a
signed-in user off `/` means the app has been demanding a re-login on every cold
start since it shipped — and the request that surfaced it was about a splash
screen.
**Cut:** the `mode === 'forgot'` state on `/` (`app/page.tsx:11, 102-138`) — 37
lines making the front door a two-state screen for the app's rarest action.

────────────────────────────────────────────────────────────
🎨 DESIGN-004 · Three directions, one motion envelope
────────────────────────────────────────────────────────────
Priority (3×2×3×4)/3 = **24** · BUILD NOW in two pieces, in order

Seven new tokens in `globals.css` (not inline styles — that is the point):
`--grad-ink`, `--ink-base`, `--ink-figure #445C42`, `--on-ink #F5ECD7`,
`--intro-beat 400ms`, `--intro-total`, `--ease-brand`. Plus the
`prefers-reduced-motion` block, unconditionally and first — with
`.recording-dot::after` handled *deliberately* rather than swept up by the
wildcard, because killing it entirely would remove the only indication the mic
is live (it goes to a steady 45% halo).

New file `app/components/IntroSequence.tsx`. Does not touch the four large page
files.

**Direction A — "The Voice"** (nominated). Hairline draws 0-450ms → 64 bars rise
staggered 8ms, real amplitude envelope, 450-1100 → collapses inward into the
36px sage mic tile 1100-1500 → wordmark 1500-1800 → card rises 1800-2100.
**2.1s, zero external assets.**

**Direction B — "The Roll Call"** (Max's idea, made safe). Five figures at
400ms each (120 cross-fade in / 160 hold / 120 out) = 2.5Hz, 20% headroom under
the 333ms floor. The fifth does not fade — the mic tile scales from its chest.
**3.2s.** Needs five commissioned SVGs — an illustration job, not a coding task.
Choosing 5 of 154 is a positioning statement; choose for silhouette legibility
at 320px, not popularity.

**Direction C — "The First Word"**. Six words at 190ms apart in `--on-ink`
(13.40:1) → sentence dims to 30%, two bullets write beneath → collapses upward
into the wordmark. **2.35s, no assets at all.** Weakest on athletic energy,
strongest on comprehension.

**On silhouettes, the agent says Max's idea is the second-best one.** Checkable:
154 sports, a five-figure montage represents 3.2% and asserts a breadth the
roster does not have (real use is primarily volleyball). Judgement: sports
silhouettes are the most commoditised visual in the category — a montage cannot
be *CoachVoice's*, only *sport's*. A waveform can be, because it is the literal
raw material. **What would change its mind:** if the growth story is "any sport,
one tool" rather than "your voice, kept", breadth IS the pitch and B is correct.
**One thing it would not do: fuse them.** "A waveform that becomes a silhouette
that becomes a sentence is three ideas at 700ms each, which is how intros become
gimmicks."

**Hard sequencing constraint: do not build the intro before DESIGN-002 ships.**
Built today it resolves into `#1A0E06` brown — hardcoding an ending you are
about to delete, in a new file, in inline styles.

**Rider, 2 lines, ship regardless:** set the manifest's `background_color` and
`theme_color` to `#1F2421`. Cheapest win in the report.

**STRETCH DESIGN-005 — "The Ten-Second Proof":** Direction C with the audio on.
Requires a public unauthenticated read — a security review, not a design change.
"Right eventually and premature now."

**Challenge:** before designing what happens on `/`, decide who should ever see
it — an intro playing for a coach opening the app courtside for the ninth time
is a tax, not a brand.
**Cut:** the 📖 book emoji at `app/page.tsx:83` — the first mark a
voice-recording product shows the world is a picture of a book.

────────────────────────────────────────────────────────────
🚀 WOW-002 · "The Line"
────────────────────────────────────────────────────────────
Priority (4×2×2×4)/3 = **21.3** · PROTOTYPE

One continuous stroke that is a waveform, a silhouette and the logo, in that
order, in 4.5 seconds, driven by a real coach's real eight-second recording —
**and it plays silent, because it has to, and the silence is the hook.**

0.0-0.5s: ink ground, one hairline, nothing else. Half a second of nothing —
the confidence move. 0.5-4.5s: the hairline moves left to right at real-time
speed, the actual amplitude envelope of a real clip precomputed to 240 peaks,
with the coach's words appearing at Whisper's real timestamps. You are watching
a person speak with the sound off; it reads like a voicemail you have not been
allowed to hear. At the three loudest peaks the stroke swells into an athlete
silhouette, holds ~350ms, relaxes back — **sound and sport are literally the
same line.** 4.5s: collapses into the mark. Then one pill: *▶ Hear Marta say it
· 8s · volleyball, Ljubljana.*

**The autoplay constraint is the mechanism, not a workaround.** Browsers require
a gesture before sound. A silent app treats that as a tax; a voice-first app
treats it as a cliffhanger — the silent version shows you *that* someone is
speaking and *what* they said, and withholds *how*. The gesture that unlocks the
audio is the gesture that opens the door.

**Flash-safe by construction:** no luminance transitions at all, only a stroke
morphing on a static ground, ~0.7 shape-changes/second.

**Spread mechanism:** not "cool animation" — animations get a screenshot and
die. This gets **screen-recorded**, because the payload is not the app, it is
*Marta's sentence*. What the coach sends to the WhatsApp group is "listen to how
she says this." He is sharing coaching craft; the app is the wrapper. Phase two:
coaches submit their own eight seconds, a human picks one a week, and "that's me
on the login screen" goes into the club chat. **The moat:** a rival can shoot a
beautiful ad but cannot have two hundred real coaches' sentences, and cannot
make appearing on their login screen mean anything.

**Safeguarding — it killed its own first version.** The clip was originally
*"Ana — that third set, you stopped waiting…"*: naming a real minor, in an
adult's assessment of her performance, on the one unauthenticated page in the
product, permanently. Dead. What survives: **second person only, no athlete name
ever**; written consent from the athlete *and* registered caretaker for the
specific clip, on top of the coach's; **the named party is the adult**; no club,
squad or age-group identifier; coach-only submission; human review before
anything goes live; zero wellness data, zero faces, zero minors' names; no
engagement mechanic of any kind.

**Kill condition, stated plainly:** if Max cannot find one genuinely excellent
eight seconds, this should not ship at all. The clip IS the thesis statement; if
it is bland — "great session today lads, really good energy" — the entire
product looks bland, permanently, on its most-viewed screen.

**Cheapest version (one day):** `/dev/frontdoor`, already covered by the `/dev`
coach-only route. Record one clip, push it through the existing
`POST /api/transcribe` for segments, hand-write one JSON, build the silent half
with three silhouettes and a cross-fade instead of a true morph. Hand a phone to
two coaches **with the sound already off** and watch whether they tap. Worth the
other 90% only if someone taps a second time.

**Argues with its own score:** "user value 2 is correct — this screen does not
make an athlete better. But the formula has **no term for acquisition**, and
this is the only screen in CoachVoice whose user is someone who does not yet
have an account."

**Three more, unargued:** (1) a returning coach's cold launch draws the waveform
of **the last thing they said to an athlete**, silent, 1.2s, as the loading
state — their own voice as the splash screen; (2) coaches submit their own eight
seconds, one picked weekly; (3) an invite link carries `?s=volleyball` so the
front door morphs into *their* sport before they type a character.

────────────────────────────────────────────────────────────
SYNTHESIS
────────────────────────────────────────────────────────────

## The disagreement, left unresolved for Max

The design agent: never fuse — three ideas at 700ms each is how intros become
gimmicks. The wow agent's Direction D **is** that fusion, and is also the only
candidate that executes Max's literal ask ("sports into the coach thing") while
being flash-safe by construction.

Orchestrator's read: the design agent is right that three ideas in sequence is a
gimmick; the wow agent is right that D is not three ideas but one stroke doing
three jobs. The real difference is cost and risk. A is two days and safe. D is a
week and lives or dies on one clip.

## Four-way convergence

All four agents independently opened with the same defect. That is the strongest
signal this system has produced — stronger than round 2's two-agent convergence
on the hero card. When four specialists with different briefs all refuse to
answer the question asked until they have flagged the same bug, the bug is the
answer.

## #1 today — the defect fixes, not the intro

1. **Manifest colours** — navy `#0f2042` → ink `#1F2421`. 2 lines.
2. **The `prefers-reduced-motion` block** — ~15 lines, ships regardless.
3. **Redirect signed-in users off `/`, and carry `?next=`** — ~10 lines.

Roughly 25 lines. They are worth doing if Max never builds an intro at all, and
they make the intro free: afterwards the only people who see it are genuinely
signed out.

## #1 ambition — Direction A behind a live form, then D when the clip exists

Direction A, playing behind an interactive sign-in card, gated once per device.
Then park D until Max has recorded one eight-second sentence worth putting on
the front door. That recording is the experiment, not the code.

**Nothing was built this round.** Advisory only, as the four-agent contract
requires.
