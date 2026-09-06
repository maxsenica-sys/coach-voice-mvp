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
