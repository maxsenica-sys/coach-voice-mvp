# Visual Design agent — memory

Append-only. Newest entry at the top, under the heading. One entry per review.
Read this before proposing anything: an idea recorded as REJECTED here does not
come back unless new evidence exists, the app has materially changed, or another
change has created a reason to revisit it.

Entry shape:

```
## YYYY-MM-DD — DESIGN-0NN — <one line>
Status: PROPOSED | TESTING | APPROVED | IMPLEMENTED | BACKLOG | REJECTED | SUPERSEDED
Verdict at proposal: BUILD NOW / TEST / BACKLOG / REJECT
Priority: (I × UV × MVP × C) / E = _
Grounded in: <files and lines the claim rests on>
Evidence: <source, or "judgement">
Outcome: <filled in when Max decides — and why, which is the part that matters>
```

---

## 2026-09-24 — DESIGN-013 — Stadium Night drawn end to end: eighteen screens, and the nine decisions they surfaced
Status: PROPOSED (concept complete, nothing built)
Verdict at proposal: DECIDE — Max, 2026-09-24: *"i want you to fully design the
stadium night one, all pages within as a concept for me to look at. we may
integrate this one soon, had a lot of good responses for it."*
Priority: not scored — this is a direction being taken to a decision.
Grounded in: every route under `app/`, `app/components/*`, `lib/session-response.ts`,
`lib/wellness-config.ts`, `lib/injury.ts`, `lib/body-map.ts`, `lib/attention.ts`
Evidence: eighteen screens rendered in real Chromium at 390x844, every text run
measured against its own composited ground. Canvas:
https://claude.ai/artifact/TwCKGvyW52EG4imprFYAT4

Six builders worked from one written specification rather than inventing in
parallel, which is why the set is a system and not eighteen interpretations.
The screens: roster, athlete record, invite · recorder setup, recording, review ·
saved session, month, annotator · athlete session, check-in, twelve-week spine ·
messages coach-side, messages athlete-side, injury · sign-in, signup, edge states.
The two approved home screens (DESIGN-010) are the reference and were not redrawn.

### What drawing the whole app proved about the direction

It holds. The chartreuse discipline — record, live/unread, the now-bar — survived
eighteen screens without a fourth use, which is the test that mattered, because
that restraint *is* the direction and it is the first thing a large surface
breaks. Screens with no hero number were allowed not to invent one. The
scoreboard/reading type pairing carried a month grid, a body map and a chat
thread without any of them becoming generic.

### The nine decisions it surfaced — none of them are drawing problems

1. **The summary should be generated at stop-and-transcribe, not at save.** The
   review screen only works if the coach can read the draft before it sends, and
   the shipped modal says the summary is generated on save. A pipeline change.
2. **The athlete-facing takeaway becomes a written field**, with its own counter,
   editable before send. This is the same conclusion four rejected directions
   reached from the outside (DESIGN-012) and it is cheaper from inside the
   recorder than from inside the prompt.
3. **Reduced motion makes a stopped recording look identical to a running one.**
   The frozen VU is the only proof of life. It needs a second one that is not
   luminance — a ticking seconds digit, free, since the clock is already there.
   This is a correctness bug in the design, not a preference.
4. **The twelve-week chart ends on an incomplete week**, so it reads as *down* to
   a teenager who sees the shape before the caption. Either hold the current week
   back until it closes, or end the window at the last completed week. Neither is
   obviously right and it should be tested on a real athlete.
5. **The roster's quiet column is coach-only data on a handed-over phone.**
   `28d QUIET` beside a fourteen-year-old's name, sortable, in the alarm colour,
   courtside where a parent can read it. `lib/attention.ts` deliberately says
   "Inactive" and says the ranking is coach-only. The marker needs to vanish when
   the phone is handed over.
6. **A day cell is 48px at 390px width** — a numeral and three marks, nothing
   else. A busy month under-reports on exactly the days that matter most.
7. **The body map cannot show a whole body at phone width.** At 0.91 scale the
   ankle target is 20x20px, under the 24px WCAG 2.5.8 floor, so the map has to
   zoom to a band. Five band chips, every region then >= 33x43px.
8. **The five-metric check-in no longer ships.** It was replaced on 2026-09-16 by
   the two-tap `CheckIn.tsx`, the five columns surviving as the derived scoring
   input. That screen is therefore a proposal to bring the long form back, not a
   repaint of what is live, and should be read as one.
9. **The annotator's nine stock drawing colours are all outside the system.**
   Replaced with five system colours, and floodlight deliberately not offered as
   a drawing colour. A product change, not a restyle.

### Two defects in the approved reference, found by drawing around it

- **Contrast.** See the correction on DESIGN-010 above: `--cream-3` is not a text
  colour on this ground, and the grain is the dominant contributor.
- **The weekdays are wrong.** `dirA-coach` says `TUE 23 SEP` and `dirA-athlete`
  says `FRI 19 SEP`; in 2026 those are a Wednesday and a Saturday. Trivial, and it
  would have shipped, because nothing type-checks a date written into a mockup.
- Naming is inconsistent between the reference (`M. SENICA`) and the eighteen new
  screens (`Marcus Reyes`). The eighteen are internally consistent. A
  find-and-replace, once Max says which.

### Cost, unchanged and still the honest number

~2 weeks for the design work, **plus** the second-theme cost recorded on
DESIGN-010: `color-scheme: light` and the twelve native controls that depend on
it, each needing a hand check on iOS and Android. Four weeks is the realistic
figure, not two. And the gate has not moved and is not a nicety: **neither of us
has seen this outdoors at 10am**, and the chartreuse is the risk.

Outcome: concept complete 2026-09-24, waiting on Max. Nothing in `app/` changed.

---

## 2026-09-23 — DESIGN-012 — Twenty-one directions explored, two kept. The other nineteen are REJECTED
Status: REJECTED (nineteen of twenty-one)
Verdict at proposal: REJECT — Max, 2026-09-23, after seeing every one of them as
rendered images: *"nothing that i'm liking apart from the two that i've kept."*
Priority: not scored — this is a record so the ground is not re-walked.
Grounded in: the canvas, https://claude.ai/artifact/TwCKGvyW52EG4imprFYAT4
Evidence: two full phone mockups per direction (coach home + athlete portal),
each rendered in real Chromium at 390x844 with the real fonts rasterised, every
text/ground pair measured against its composited background rather than estimated.

**Kept:** A · Stadium Night (DESIGN-010) and K · Floodlit (DESIGN-011).

**Rejected — do not propose again without new evidence.** In the order they were
shown: B Chalk & Field, C Kinetic, D Tape, E Clinic, F Progression, G Courtside,
H Dossier, I Terrain, J Nocturne, L Monolith, M Honours, N Instrument, O Ember,
P Highlight, Q Sodium, R One Light, S Constellation, T Thread, U Vault.
V Margin and X Tide were rendered but never shown — the round was called before
they landed — and W Contact Sheet was commissioned in the same batch. None of the
three reached the canvas and none was seen by Max, so none of them is rejected on
its merits; they are simply not in play.

**What the rejections actually say**, which is the useful part:

- **Light grounds are out, decisively.** Chalk & Field, Clinic, Dossier and
  Progression are four different good arguments for paper, cream and daylight,
  and all four lost. Both survivors are near-black. Stop pitching light.
- **A metaphor is not a direction.** Tape (a tape deck), Terrain (a contour map),
  Constellation (a night sky), Vault (a strongroom), Contact Sheet, Tide — each
  was internally coherent and none survived. The two that did are *grades of the
  app as it already is*, not the app dressed as something else.
- **Restyling a winner does not produce a second winner.** P, Q and R were three
  redos of Floodlit commissioned at Max's own suggestion — remove the light, keep
  the palette. All three were rejected while the original was kept. The tacky
  thing he named was not the reason the original worked.

**The one finding worth carrying forward, and it is not a visual one.** Three
independent directions (P Highlight, R One Light, T Thread) each arrived at the
same structural bet: make the session's key takeaway the single most important
object on the screen. All three then hit the same wall — **that takeaway does not
exist as a field.** It is `focus_points[0]`, whichever bullet the summariser
happened to emit first. Any direction that leans on it, including a future one,
needs it to become a real field: asked for explicitly in the summariser prompt,
pinned with its own case in `tools/prompt-rig.mjs`, and coach-editable for a few
minutes after recording. That is roughly a day of work and it is a prerequisite,
not a detail. It survives the rejection of all three designs that surfaced it.

A second, smaller one from the same three: rules like "two marks per screen" or
"one light per screen" are design disciplines the data can break — a bad week
could qualify six roster rows, and six highlights mark nothing. If such a cap is
ever adopted it belongs in `lib/` with a rig, not as a number typed into a
component. Same reason the montage timing had to leave `IntroSequence.tsx`.

Outcome: recorded 2026-09-23. Work paused at Max's request, to resume 2026-09-24.

---

## 2026-09-23 — DESIGN-011 — "Floodlit": attention directed by light instead of by boxes, banked
Status: APPROVED (banked, not built)
Verdict at proposal: BUILD — Max, 2026-09-23: *"stadium night keep, also keep
floodlit"*, and after the full round, *"nothing that i'm liking apart from the two
that i've kept. let's bank those."*
Priority: not scored — this is a direction, not a finding.
Grounded in: app/globals.css (`--grad-ink`, `--ink-base #1F2421`, `--on-ink
#F5ECD7`, `--energy`), app/dashboard/page.tsx, app/athlete/page.tsx,
lib/session-response.ts, lib/wellness-config.ts
Evidence: two phone mockups rendered in real Chromium at 390x844; every text run
measured against the brightest pixel actually under its glyph box.
Canvas: https://claude.ai/artifact/TwCKGvyW52EG4imprFYAT4

### Why this is written here and not in the tree

Same reason as DESIGN-010. CLAUDE.md forbids banked alternatives in the
repository, so the specification lives here in enough detail to rebuild from
without the mockups, and nothing about this entry belongs in `app/`.

### The idea

Night-sport photography as an interface. One warm floodlight off-frame, a pool of
light where it lands, and everything else falling into a cold green-black that
still has detail in it — so **attention is directed by illumination, not by
boxes, rules or card borders.** On the coach's screen the lit things are the
record control and the athletes who need him tonight; the ones already dealt with
sit in shadow. On the athlete's screen the lit thing is the coach's message, and
the brightest object on the entire screen is the one forward-looking line, "Take
into next session".

Nothing in it is a photograph. Every bloom, shaft, falloff, cast shadow, motion
trail and grain field is a CSS gradient, a CSS `box-shadow`, an SVG
`feGaussianBlur` or an SVG `feTurbulence`.

### Palette — measured, not estimated

Ratios are given as `on --night #0B0E0C / on --ink-base #1F2421`.

Three shadow stops, the same green-black family `--grad-ink` already paints,
pushed darker so the pools have somewhere to fall off to:
`--night #0B0E0C` (relative luminance 0.41%), `--night-2 #141815`, and the app's
existing `--ink-base #1F2421`.

Inks: `--on-ink #F5ECD7` (existing) **16.50 / 13.40**, `--on-ink-2 #C4C0B0`
**10.64 / 8.64**, `--on-ink-3 #A8A395` **7.70 / 6.26**.

Light: `--sodium #F6B860` **11.03 / 8.96** — and `#1F2421` reads **8.96:1 on it**,
which is the mic glyph inside the record disc; `--sodium-hot #FFE0AE`
**15.27 / 12.40**.

**The one new hue is `--mercury #7FC6D6`, hue 191°, 10.12 / 8.22.** A floodlit
ground needs two lights or the warm key has nothing to be warm against. The
palette holds sage 114°, rust 15° and amber 38° — nothing within 77° of cyan — so
this is genuinely new rather than a restyled token, and it carries meaning as
well as contrast: **warm is the coach speaking, cold is the athlete answering
back.** It marks the athlete's response on the coach's roster and the selected
chip on hers, where it measures **5.87:1 sampled off the rendered pixels**, on
its own tint plus the cold pool.

`--sodium` is deliberately **not** claimed as a new hue: at 35° it is a light stop
of the existing `--energy` amber (38°), which at `#966E28` measures only 4.21:1 on
this ground and cannot carry an accent.

Wellness states are lightness-lifted members of the existing families, preserving
the ordering the daylight palette already encodes: good `#93C97C` **10.06**,
ok `#E8BE72` **11.12**, low `#F2988A` **8.90**.

### Typography — a re-grade, not a re-brand

The app's own three families. Newsreader Light/Italic carries the two moments
addressed to a person ("Good evening, *Marcus.*" at 37px; "Evening, *Mathilde.*"
at 36px), the session title, and the coach's readiness figures — old-style
numerals in a serif read as an assessment rather than a metric. JetBrains Mono at
13px, 0.13–0.20em tracking, does every eyebrow, clock and date: in a dark
cinematic register a sparse tracked mono label is the caption burnt into the
bottom of a documentary frame. Plus Jakarta Sans does all running text at 13–15px.

**No type below 13px anywhere.** A graded ground eats small type first, and the
app's usual 11px eyebrow was not survivable here.

### How text stays legible inside a heavy grade

Two rules, one method, and the method is the transferable part.

1. Every light wash reaches *zero* alpha inside its own box, so a gradient never
   leaves a visible rectangle edge. That is what makes "no borders" actually hold
   rather than being a claim.
2. Any wash with text on it is capped, and the cap was found by measurement.

The method: render the screen, collect every text node's exact glyph boxes via
`Range.getClientRects()`, re-render with all ink set to `transparent`, sample the
**brightest** background pixel under each glyph box, and compute the true ratio.
The first pass failed 9 runs — the bloom and the record disc's glow were reaching
relative luminance 0.15–0.20 where the arithmetic had predicted 0.05. Blooms,
shafts, pools and disc glow were roughly halved and two labels moved to
`--sodium-hot`. **Final state: 42/42 text runs pass on the coach screen, 38/38 on
the athlete screen, worst case 4.75:1 against a 4.5:1 floor**, with nothing
relying on the 3:1 large-text allowance.

This is the same lesson as the rigs in CLAUDE.md, in a new place: a contrast
ratio computed from declared hex values is a guess about a composited screen.
Sample the pixels.

### Motion

One 11s and one 13s `opacity: .90 → 1` breath on the lamp bloom and the record
disc, plus a 17s/19s ±7px horizontal drift on the motion-trail layer. That is
0.09 Hz against WCAG 2.3.1's 3 Hz, a ~0.055 relative-luminance swing over about
2.7% of the viewport against a threshold requiring 25%. Confirmed off under
`prefers-reduced-motion: reduce` by rendering with `reducedMotion: 'reduce'` and
asserting `document.getAnimations()` is empty — not by trusting the media query.

### The two things to be nervous about

**A photograph has one subject, and this direction asserts a coach's screen does
too.** That holds on the night drawn — three athletes need him, four are done. It
stops holding when nine need him at once, or when none do: with nothing to light,
the screen is a dark rectangle with a mic on it; with everything lit, the
metaphor flattens into a normal list on a dark background. **This needs a
designed empty state and a designed overflow state before it is a system rather
than a hero shot.** That is the first work to do if it is ever built.

**A graded dark UI is punishing outdoors**, and this is an app used courtside,
some of it in daylight, where the sodium pool carrying the hierarchy is the first
thing to disappear. Test both screens outside before anything else — the same
caveat DESIGN-010 carries, and for both survivors it is now the single largest
untested assumption.

### Build cost, and the honest GPU answer

Layout is cheap: flex columns, no JS, no images, ~14KB per screen before fonts.
The atmosphere is where the money goes — two SVG `feGaussianBlur` filters on the
light shaft (stdDeviation 22 and 12), two more on the motion trails, and one
full-screen `feTurbulence` grain compositing in `mix-blend-mode: soft-light`. On a
mid-range Android a full-screen turbulence plus large-radius blurs costs real
milliseconds on the *first* paint, and a soft-light blend over the whole viewport
forces an extra compositing pass on every frame anything above it animates.

The mitigation is structural, not lucky: **every expensive layer is static.** The
turbulence, shafts and blurs rasterise once and are then textures; the only
animated properties are `opacity` and `transform`, which stay on the compositor.

If it still stutters on a real device, cut in this order: (1) bake the grain to a
small tiling `data:` URI instead of live turbulence, (2) drop the duplicate
blur passes and keep the single tight one, (3) drop the grain entirely. The
direction survives all three, because the bloom, the pools and the falloff are
plain CSS radial gradients and cost nothing. **What it does not survive is losing
the pools** — those are the layer to defend.

Also, as with Stadium Night: `app/globals.css` declares `color-scheme: light`,
and roughly a dozen native controls inherit from it. A dark direction is not a
token swap; that declaration and every control under it has to move too.

### Content is real, and the strings are the product's own

Mathilde Ross, Nicholas Chuang, Cayden Laurie, Sophie Grabovac, Kai Liang,
Wyatt Hickson (Leo Bridgeford on the roster, off-screen that night). The five
metrics and their order are `lib/wellness-config.ts` — Energy, Mood, Sleep,
Soreness, Stress, all 5-is-good. The three chips are `SESSION_RESPONSES`
verbatim: "Got it", "Working on it", "Not sure what you mean", with the coach's
third-person reading "Not clear to them" exactly as `coachLabel` defines it.
"Take into next session" and "From your coach" are the athlete portal's own
strings.

Outcome: banked 2026-09-23 alongside DESIGN-010. Not built. Neither direction is
scheduled; both are waiting on a decision about which one the app becomes, and
on the daylight test above.

---

## 2026-09-23 — DESIGN-010 — "Stadium Night": the whole app on the ink ground, banked
Status: APPROVED (banked, not built)
Verdict at proposal: BUILD — Max, 2026-09-23: *"i like the sydney night. BANK that
entire design, it's really good, keep it in the memory."* (He said "Sydney night";
three directions were on the table and this is the one called Stadium Night.)
Priority: not scored — this is a direction, not a finding.
Grounded in: app/globals.css (every base value below is already in it),
app/dashboard/page.tsx, app/athlete/page.tsx, lib/session-response.ts
Evidence: three full phone mockups per direction, rendered in real Chromium at
390x844. Canvas: https://claude.ai/artifact/TwCKGvyW52EG4imprFYAT4

### Why this is written here and not in the tree

CLAUDE.md is unambiguous: no prototypes, no banked alternatives, no `_banked/`,
no `/dev/*`. "An idea is either built into the product properly or it is written
down in `product-review/` and not built." So the mockups stay on the canvas and
the *specification* lives here, in enough detail to rebuild from without them.
Nothing about this entry belongs in `app/`.

### The idea, one line

The app stops being a parchment notebook and becomes a broadcast: ink ground
everywhere, floodlit sage, one enormous number per screen, and the coach's own
words set like a magazine feature. The coach gets a scoreboard; the athlete gets
a dispatch.

### Palette — every value, with its measured ratio

Ground and text are already shipped and already pass:

| Token | Value | On | Ratio |
|---|---|---|---|
| `--ink-base` | `#1F2421` | — | ground |
| `--on-ink` | `#F5ECD7` | ink | 13.56:1 |
| stage floor (new) | `#151916` | — | a step under the ink |
| secondary text (new) | `rgba(245,236,215,.72)` | ink | 7.60:1 |
| ~~tertiary text (new)~~ | ~~`rgba(245,236,215,.58)`~~ | ~~ink~~ | ~~5.41:1~~ |

An `.46` tertiary step was tried and **dropped at 4.02:1** for failing 1.4.3. Do
not reinstate it.

> **CORRECTED 2026-09-24 — the `.58` tertiary step is not usable as text either,
> and the two boards banked above ship the failure.** Both figures in this table
> were computed against *flat* `--ink`. The ground is not flat: it carries a
> skewed beam, a 39px grid and a grain field, and a glyph sits on whatever pixel
> is under it. Measured on the real composited pixels — render, render again with
> every glyph `transparent`, sample the ground only where a glyph actually
> covered it, take the worst — `--cream-3` lands at **3.76–4.48:1**, and on the
> approved boards themselves `TUE 23 SEP` measures **3.74:1** and `TRENDS →`
> **3.07:1**. Six independent builders reproduced it on their own screens.
>
> **The dominant contributor is the grain, not the beam.** `rgba(245,236,215,.22)`
> dots on a 13px pitch lift individual pixels to roughly `rgb(84,82,66)`, and at
> that value even `--cream-2` fails, at 4.37:1.
>
> The fix, applied across all eighteen concept screens and verified there:
> **retire `.58` as a text colour** (it survives as hairlines and dots), move
> every label on a lit region to `--cream-2`, and **damp the grain dot to `.13`**.
> After that the worst glyph pixel across eighteen screens is 4.90:1 against a
> 4.5 floor.
>
> Two method notes worth keeping, because both produced false results first:
> sampling inside the glyph *box* is corrupted by antialiased edges and fails
> clean screens; and both captures must have animations frozen, or the drifting
> rake reads as glyph coverage. `snE-contrast.mjs` in the design scratchpad is
> the working implementation.
>
> **The general rule, for the third time in this file:** a contrast ratio
> computed from declared hex values is a guess about a composited screen. It was
> `--energy-dark` on a tint, then Floodlit's blooms, now this. Measure pixels.

The existing hues cannot be used as text on ink and are re-cut, not replaced —
these are additions to `globals.css`, so the light theme keeps working while this
is built:

| Purpose | Shipped | On ink | Lifted to | Ratio |
|---|---|---|---|---|
| sage, text weight | `--primary #5D7F59` | 3.53:1 ✗ | `#A8CBA0` | 8.79:1 |
| sage, secondary | — | — | `#7FA878` | 5.85:1 |
| rust | `--coach-color #B55C3E` | 3.43:1 ✗ | `#E39A7A` | 6.83:1 |
| amber | `--energy` | — | `#E4BC6B` | 8.70:1 |

`--primary` survives as a bar or fill and **never** as text on ink.

**The one new hue: floodlight chartreuse `#CBEF5E`.** 12.06:1 against ink *and*
12.06:1 under ink — it works as text on the ground and as a ground under ink text
with the same arithmetic, which is what earns it. It is spent on exactly three
things: the record action, the live/new state, and the one bar in a chart that is
*now*. Nothing decorative wears it. That discipline is the direction; a fourth
use of it is a regression.

### Typography

Three of four families are already self-hosted, so this ships **one** new font:

- **Newsreader** — the reading, and every oversized numeral. The app already sets
  stat values in the display serif.
- **Plus Jakarta Sans** — controls and body.
- **JetBrains Mono** — timecodes.
- **Big Shoulders Display** (new) — a condensed grotesque for all uppercase
  furniture: eyebrows, tickers, surnames, session titles, nav.

That pairing *is* the direction: a scoreboard voice and a reading voice on one
page.

### Structure

A 20px gutter and a 39px pitch-marking grid run under everything, and the hero
band deliberately violates it: a skewed translucent beam with a floodlight
hairline behind the scoreboard, a diagonal clip splitting the record bar, a 100px
numeral overhanging its own optical margin. Hairline rules on the session rows
keep it from becoming noise. The coach screen leads on an attention headline
("Three athletes haven't heard from you in ten days"); the athlete screen leads
on a readiness hero over the twelve-week spine.

### Motion

Small-area only: a 22s light rake, a 2.4s status dot, a 1.5s VU meter 3px wide.
Nothing large changes luminance, which is the flash-safety property
`IntroSequence.tsx` and the boot shell already depend on. All of it dies under
`prefers-reduced-motion`.

### The risk, in the agent's own words

The chartreuse will look like a highlighter on a bright touchline, and the dark
ground is gorgeous in a gym at 8pm and **unproven at 10am outdoors**. DESIGN-003
already warned that a colder, more monochrome system could make `/athlete` read
as an enterprise dashboard to a teenager. **Test both screens outside before
anything else is decided.** That test is the gate on this entry, not a nicety.

### Cost, and what it drags with it

~2 weeks, and it is the most expensive of the three directions — not because of
the design but because `app/dashboard/page.tsx` and `app/athlete/page.tsx` carry
**161 hex literals** between them (96 and 65) that no theme switch can reach.
1 day tokens, ~3 days repointing those literals (work the register already
wants), ~4 days rebuilding the two home screens, 1 day font and icon pass.

### The cost nobody had counted: this app is declared light

Added 2026-09-23, from the "Honours" exploration, and it applies to **every**
dark direction including this one.

`app/globals.css:13` declares `color-scheme: light`, and it is deliberate —
`verify:palette` has a check protecting it, whose failure message says that
without it "UA-styled date and select controls render dark chrome on a white
card". Twelve native controls depend on that declaration today, counted:

    QuickSessionModal.tsx   1 select, 2 date
    InjuryPanel.tsx         1 date
    athlete/page.tsx        1 time
    athletes/[id]/page.tsx  2 select, 1 date, 1 time
    dashboard/page.tsx      2 select, 1 time

So moving the app onto an ink ground is not a token swap with a new accent. It
is a **real second theme**, and every one of those twelve controls has to be
re-checked in a browser on both iOS and Android, because the native picker is
drawn by the platform and not by anything in this repo. That is the sort of
work that turns a two-week estimate into a four-week one in week three.

The ~2 weeks above does not include it. Count it separately, and do the
daylight test before either.

### What it deliberately does not touch

Not the intro, not the recorder, not any protected route. It keeps every piece of
real content those screens already render: the ACTIVE/PENDING split, the five
wellness metrics, the twelve-week spine, the `NEXT:` line, and the three-word
response vocabulary from `lib/session-response.ts`, verbatim.

### Carried out of this round regardless of direction

`--coach-color #B55C3E` is **3.43:1 on ink** and fails wherever rust text sits on
the ink ground. `#E39A7A` (6.83:1) is the re-derived value. This is a live defect,
independent of whether Stadium Night is ever built. See "Not yet reviewed".


## 2026-09-06 — ROUND 3 SHIPPED (commit 9708772)

All three defect fixes built, plus all three intro directions. Direction A is
live; B and D switch via `INTRO_VARIANT` in `app/page.tsx`.

Two things worth carrying forward:

**The flash margin is the fill, not the cadence.** Max asked for B with 15
sports and D at half time, which puts them at 7.5Hz and 5.8Hz — both far past
the 3-flashes-per-second limit, and both safe, because `--ink-figure` sits at a
7.6% luminance delta and a general flash needs 10%. That margin is the entire
safety mechanism. `IntroSequence.tsx` says so at the top. Anyone who "improves"
the figures by brightening them re-introduces a seizure risk for teenagers.

**The silhouettes are mine and they are placeholders.** Recognisable at 150px,
consistent in weight, not illustration. The design agent called this an
illustration job, not a coding task, and it was right. Redraw before B or D
ships for real.

**Still open:** D is built and waiting on one excellent 8-second recording. That
recording is the experiment; the code is done. If the clip is bland, do not ship
D — the wow agent named that as a kill condition and it still holds.

## 2026-09-06 — DESIGN-004 — Three intro directions on one motion envelope
Status: PROPOSED · Verdict: BUILD NOW in two pieces, in order
Priority: (3 x 2 x 3 x 4) / 3 = 24 — deliberately not inflated; the intro is a brand
  decision Max asked for, not a problem the product has. The MOTION-SAFETY layer is the
  part that would score high on its own, and it is the part that ships this week.
THE FLASH ANALYSIS (computed, WCAG 2.2 sRGB, against #1F2421 L 0.01663):
  #3A4F38 5.1% safe · #445C42 7.6% safe · #4F6B4B 11.0% FAILS · #6F8E6B 22.1% FAILS ·
  #FBF8F3 92.5% catastrophic. Max's literal proposal (white on brown #1A0E06) = 93.6% delta
  at 10Hz = ~9x threshold amplitude at 3x the legal rate, audience aged 13-18.
  Area exemption computed for phone geometry: 10deg field at 30cm = 5.25cm, 25% = 6.89cm2
  = ~143x143 CSS px. Sage mic tile 36x36 = 6.3% of that, legal with wide margin.
  THE RULE: "big or bright, never both — and if both, never faster than 2.5Hz."
  CONSEQUENCE FOR MAX: figures at #445C42 never reach the 10% threshold, so no flash occurs
  at ANY frequency — his 0.1s cadence is legal provided the images never brighten. Honest
  cost: 2.14:1, genuinely subtle in daylight, motion doing the work contrast used to.
Directions: A "The Voice" (hairline -> 64-bar waveform -> mic tile, 2.1s, ZERO assets,
  NOMINATED) · B "The Roll Call" (Max's idea made safe, 5 figures at 400ms = 2.5Hz, 3.2s,
  needs 5 commissioned SVGs) · C "The First Word" (6 words -> 2 bullets, 2.35s, no assets).
Says Max's idea is the SECOND-best: 154 sports means a 5-figure montage is 3.2% of the list
  and asserts breadth the roster lacks; sports silhouettes are the most commoditised visual
  in the category and cannot be CoachVoice's, only sport's. A waveform CAN be, because it is
  the literal raw material. Changes its mind if the growth story is "any sport, one tool".
WOULD NOT FUSE: "a waveform that becomes a silhouette that becomes a sentence is three ideas
  at 700ms each, which is how intros become gimmicks." (WOW-002 proposes exactly that fusion
  — the disagreement is filed unresolved in the report.)
HARD SEQUENCING: do not build the intro before DESIGN-002 ships, or it hardcodes an ending
  you are about to delete.
Rider, 2 lines, ship regardless: manifest background_color and theme_color -> #1F2421.
Outcome: awaiting Max

## 2026-09-06 — DESIGN-005 — STRETCH: "The Ten-Second Proof"
Status: PROPOSED · Verdict: BACKLOG. Direction C with the audio on. Requires a public
unauthenticated read, which is a security review rather than a design change. "Right
eventually and premature now — but the only version that would make someone forward the URL."

## 2026-09-06 — Challenge and cut
Challenge: before designing what happens on `/`, decide who should ever see it. An intro
playing for a coach opening the app courtside for the ninth time is a tax, not a brand.
Cut: the book emoji at `app/page.tsx:83` — the first mark a voice-recording product shows
the world is a picture of a book.

## 2026-09-06 — DESIGN-002 — One auth shell from a gradient the app already draws
Status: PROPOSED
Verdict at proposal: BUILD NOW
Priority: (3 x 3 x 3 x 5) / 2 = 67.5
Grounded in: FOUR grounds in the ninety-second funnel, not one as the register claimed —
  `app/page.tsx:54` brown, `app/signup/page.tsx:293` slate-indigo,
  `app/signup/confirm/page.tsx:9` blue, `app/reset/page.tsx:28` parchment. All verified by
  the orchestrator. Four different brand marks across those screens. And
  `globals.css:558-570` ships three gradient utility classes with ZERO usages anywhere.
Evidence: measured — footer 2.45:1, "Create an account" 3.24:1 and 3.65:1, all failing
  1.4.3; the tagline at 4.52:1 passes and no failure was claimed for it. Proposed
  `--grad-ink` (#1F2421 -> #3A4F38, already the coach sidebar) gives 7.58:1 at its
  lightest point; `--on-ink-2` 4.83:1; `--primary-dark` 5.28-5.94:1. Explicitly rejected
  `.bg-gradient-coach` because its light stop gives cream only 3.10:1.
Opinion, labelled: an entry screen changing ground three times in ninety seconds reads as
  unfinished. Would change its mind if the dark entry is a deliberate "threshold", or if
  Max thinks the glow is the brand and the parchment is the compromise.
Honest note the agent volunteered: this does NOT fail the three-second test. Users find the
  email field today. Brand coherence and contrast, not task completion.
Outcome: awaiting Max

## 2026-09-06 — DESIGN-003 — STRETCH: retire emoji as iconography
Status: PROPOSED · Verdict: BACKLOG
39 pictographic emoji across 11 files, 19 of them on the teenager-facing page, coexisting
with a 17-glyph stroked SVG set that is duplicated in miniature as `AthleteIcon`. Two icon
systems, one of them the operating system's. Evidence: per-platform artwork, no
`currentColor`, no `strokeWidth`, no stable optical size, CLDR screen-reader names.
Risk the agent named itself: emoji are why /athlete feels warm to a 15-year-old; a
monochrome set could make it read as an enterprise dashboard. "What I will not defend is
shipping both."
Outcome: awaiting Max

## 2026-09-06 — Challenge and cut
Challenge: the Letter Edition diary identity may be wrong for an athletic product — and
the codebase defected from it three times in the auth funnel, which is a signal about the
system rather than the pages.
Cut: `/signup/confirm` — a whole page and a third palette to say "check your email".

## 2026-09-06 — Corrected the briefing document
This agent found PROJECT-STATE recorded two live palettes where there are four, and said
`--primary` was "fine as a fill" when the code uses it as text at 10 sites at 3.24-3.65:1.
Both corrected. Eight of those ten sites remain open after DESIGN-002.

## 2026-09-05 — DESIGN-001 — Replace the raw-Tailwind wellness palette with four tokens in the app's own colour family
Status: IMPLEMENTED (2026-09-05, same day)
Verdict at proposal: BUILD NOW
Priority: (3 x 3 x 3 x 5) / 2 = 67.5
Grounded in: `lib/wellness-config.ts:45-52, 90-95` (the four state hexes) and
  `:21,26,31,36,41` (25 colorMap literals that only ever render as a selected-button
  fill) · rendered as *text* at `app/dashboard/page.tsx:1131`,
  `app/athletes/[id]/page.tsx:647` and `:778`, `WellnessGraph.tsx:98-100` and `:179-180`
Evidence: measured WCAG 2.2 ratios. Current: `#10b981` 2.54:1, `#f59e0b` 2.15:1,
  `#ef4444` 3.76:1, `#94a3b8` 2.56:1 on white — every render site fails 1.4.3, including
  the two that qualify as large text and need only 3:1. Selected check-in digit measures
  2.99-3.48:1 versus 5.93:1 unselected, so selection degrades legibility from pass to
  fail. Proposed `#4F6B4B` 5.94, `#7E5A1C` 6.24, `#A54034` 6.21, `#5D6661` 5.93 on white,
  4.80-5.18 on their paired tints. 9.5 px at `dashboard:1131` is below Apple HIG Caption 2
  (11 pt) and Material label small (11 sp). `WellnessSubmit.tsx:70` is 40 px against
  HIG 44 / Material 48 — and against the app's own `globals.css:528` house rule.
  Orchestrator spot-checked `#10b981`, `#4F6B4B` and `#7E5A1C`: all correct.
  Explicitly NOT claimed: SC 1.4.1 (colour is redundant, the numeral is always printed).
Opinion, labelled: saturated web-default green/amber/red on parchment reads as a
  dashboard widget dropped into a letter; muted rust says "noted" where `#ef4444` says
  "alarm". Would change its mind if the real complaint is that low wellness is too *easy
  to miss* — then the answer is structural (surface that athlete first), not a different
  hue. That call is Max's.
Outcome: APPROVED and BUILT, in full, including both riders and the scoped-out pill fix.
  Eight tokens added to globals.css (four roles + four paired tints); `colorMap`'s 25
  literals deleted; `metricColor`/`overallScoreColor` return `var(--wellness-*)`;
  `metricTint`/`overallScoreTint` added and the three hex-alpha concatenation sites
  (`+ '22'`, `+ '15'`, `+ '18'`/`{color}40`) retired; slate neutrals `#e2e8f0`/`#94a3b8`/
  `#f1f5f9` and the stray Tailwind green-200 border swapped for warm tokens;
  `dashboard:1131` 9.5→11px; `WellnessSubmit` 40→44px.
  Built at the same time, as this agent recommended: **DESIGN-001's sibling** — the
  `--text-muted` failure. Rather than editing hundreds of call sites the token itself was
  raised `#9BA29B` → `#6B736D` (2.47:1 → 4.61:1 on --bg), and the 23 places that hardcoded
  the old hex inline were repointed at the token, so there is one definition again.
  Also built: the metric toggle pills this agent deliberately held back — identity hue
  moved to a 7px dot, label to `--text`/`--text-2`. The five series hues are untouched as
  chart fills, which is what this agent argued for.
  **Not built, deliberately:** the sign-in page's separate visual identity. No agent has
  proposed it and there is no agreed target, so restyling it would be a redesign on
  nobody's authority. It stays in "Not yet reviewed".

## 2026-09-05 — Deliberately scoped out, do not rediscover
The five per-metric identity hues (`lib/wellness-config.ts:19,24,29,34,39`) stay for now.
As chart strokes and fills they are governed by 3:1 (SC 1.4.11), and the chart sits behind
a toggle. The one place they are *text* is the metric pills (`WellnessGraph.tsx:248-262`)
at 2.00-3.78:1, all failing — the fix is to move identity colour onto a dot or border and
set pill text to `--text`/`--text-2`. Separate, smaller recommendation, held back rather
than bundling two colour decisions into one review.

## 2026-09-05 — Register contamination, first run
The register was pre-seeded with two predicted design findings before any agent ran, so
this agent numbered itself DESIGN-003 and declined to re-propose either. Corrected: the
register now holds agent output only, and unreviewed observations sit in a separate
section. Both seeded items (`--text-muted` at 2.47:1; the sign-in page's separate visual
identity) are there, unproposed, and available to pick up.

---

## 2026-09-09 — DESIGN-006 · the design pass re-typed the system by hand

**Proposed.** Priority 80, BUILD NOW.

The 2026-09-07 athlete design pass (`199761b`) did not use the token layer — it
copied it. `app/athlete/page.tsx` holds **65 hex literals, 60 of them
byte-for-byte duplicates of existing tokens** (`#5D6661`×12, `#1F2421`×12,
`#B55C3E`×8, `#9BA29B`×8, `#E3DED2`×6, …). Repo-wide: 96 in
`app/dashboard/page.tsx`, 177 across the four page files. All counts verified by
the orchestrator.

The eight `#9BA29B` at 2.47:1 are the symptom PROJECT-STATE already recorded.
**The finding is the mechanism** — a hand-copied value forks silently and nothing
catches it. Three unrecorded failures arrived through the same door:

| Site | Pair | Ratio |
|---|---|---|
| `:861-862` "Take into next session", 9px | `#B55C3E` on `--coach-light` | **3.56:1 — fails 1.4.3** |
| `:1010`, `:1021` (for contrast) | `#B55C3E` on white | 4.60:1 passes |
| `:922` empty-state icon | `#C4C9C2` on `--card` | 1.68:1 |

The 3.56:1 one is the single forward-looking line the product has — what DATA-001
was built to produce — placed in the one spot on the page where `--coach-color`
does not clear AA.

Also: **no font-size tokens exist at all.** 361 inline `fontSize` declarations
across 26 distinct values; **66 below 11px**, 22 of them on `/athlete`.

Recommended, in order: a type scale with an 11px floor · repoint the 60 duplicates ·
add `--coach-on-light: #8E3F27` (5.62:1, a value already in the file at `:1488`) ·
**and a `no-restricted-syntax` lint rule banning hex literals, scoped to the athlete
page and widened one page at a time.** The rule is the part worth fighting for —
everything else is 90 mechanical edits any pass would eventually make; the rule is
what makes this the last time this recommendation is written.

Kept the evidence/opinion split honest: the 11px floor is **opinion** dressed in
HIG/Material citations (neither is a conformance requirement, no WCAG SC sets an
absolute size) — what would change my mind is watching a teenager read the home card
in daylight without squinting, which nobody has done.

Orchestrator reproduced every ratio and count exactly, including against the recorded
table. Deliberately left `--primary`-as-text (3.65:1, 10 sites) alone — two colour
decisions in one review is one too many, and the lint rule surfaces them next.

**DESIGN-007 (STRETCH, TEST)** — an ink-native `/athlete`. `--on-ink` on
`--ink-base` is 13.40:1 and composited `--on-ink-2` 7.60:1, so secondary text gains
2 points where the app keeps failing. Risk: `--coach-color` is 3.43:1 on ink and
must be re-derived. Gated on one unrun query — when athletes actually open the app.

**Challenged:** the PWA disables zoom entirely (`layout.tsx:15-16`,
`display: standalone`) with 66 sites of sub-11px text — WCAG 2.2 SC 1.4.4, and
`globals.css:590` already solves the iOS auto-zoom it was for. Two-line fix.
**Cut:** the "NEWEST" badge (`:831-832`) — the smallest type in the app, spent
saying the first item in a reverse-chronological list is the newest.

---

## Round 5 — 2026-09-09b · net-new additions only

**DESIGN-008 "The Spine" (72) — BUILT.** Twelve weekly bars, on the athlete's home
and the coach's athlete-profile overview, from sessions both sites already held.
The app's first chart rendered from a shared component rather than inline in a page
file — that shape matters more than the chart, given almost everything is inline
styles in four large files.

Contrast stated and verified: `--primary-dark` on `--border-soft` is 4.95:1 against
the 3:1 WCAG 1.4.11 asks for a meaningful graphical object. I validated my method
first by reproducing `--primary-dark` on white at 5.94:1, the figure already in
PROJECT-STATE — worth continuing to do before quoting any new number.

Two labelled judgements, not findings: weeks rather than a daily grid (84 cells with
24 filled reads as failure to a fifteen-year-old), and no streak counter (a coach's
holiday must not become the athlete's failure). The build added a third I did not
propose — the coach variant names a gap over 14 days and the athlete's version never
does.

**DESIGN-009 "The Focus Card" (18) — PROPOSED, TEST.** The one artefact that could
leave the app, as an image rather than a URL, so it needs no public surface. I
attached the safeguarding question myself and recommended asking a coach first.
That was the right order and it is why this did not ship today.

**Challenged:** avatar colour derived from array index, so identity changes when the
array does — `lib/group-colors.ts` already shows how to hash an id instead.
**Cut:** the "Unread" stat tile, spending full-bleed colour to say "0".
