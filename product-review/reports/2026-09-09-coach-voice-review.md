COACH VOICE — DAILY PRODUCT REVIEW

Date: 2026-09-09
Reviewed against: d70258e Merge origin/main into the athlete design pass

Orchestrator note: PROJECT-STATE.md was stale on entry (last verified `d033ef8`,
thirteen commits behind HEAD) and was refreshed before dispatch. What it had
missed: the entire entrance subsystem (`IntroSequence`, `ColdStartSplash`, the
113 KB `sportSilhouettes`, the inline boot shell in `layout.tsx`), the entrance
token block and the `prefers-reduced-motion` layer in `globals.css`, and a
verified colour regression introduced by `199761b`. The file is now 316 lines
against its own ~250-line budget and wants a trim.

All four agents ran in parallel and in isolation; none saw another's report.
Every factual claim below was independently re-verified by the orchestrator
against the code, and two numbers were corrected — see CORRECTIONS.

────────────────────────────────
📊 DATA & PERFORMANCE

DATA AGENT

**ID** DATA-006

**Observation**

The athlete gives CoachVoice five numbers a day and gets nothing back. Three
verified facts, all in `app/athlete/page.tsx`:

1. **The "Trends →" button is a dead end.** `app/athlete/page.tsx:755-756`
   renders a button labelled `Trends →` whose only action is `setTab('wellness')`.
   The wellness tab, at `app/athlete/page.tsx:1200-1202`, renders exactly one
   thing: `<WellnessSubmit athleteId={athleteId} onSaved={() => {}} />`. There is
   no history, no chart, no yesterday. An athlete who taps "Trends" is shown a
   form.

2. **It is a *blank* form, even if they already checked in.**
   `app/components/WellnessSubmit.tsx:15` initialises
   `useState<Record<string, number>>({})` with no prefill, and `handleSubmit`
   refuses to save until all five are re-entered (`WellnessSubmit.tsx:27`). So the
   athlete who checked in at 8am and taps "Trends →" at 6pm is shown five empty
   rows — the app's own record of the day, presented as if it never happened.

3. **Submitting never updates the home card.** `setTodayWellness` is called in
   exactly one place — the mount effect at `app/athlete/page.tsx:253-263`, deps
   `[athleteId]` — and `onSaved` is a literal no-op at line 1202. Check in, tap
   Home, and the card still says "How are you feeling today?" with a "Check in"
   button. Within one app session the athlete cannot make the product acknowledge
   that they complied.

Two supporting facts. `WellnessGraph.tsx` — 285 lines, a real chart, bars, notes
— is mounted at `app/athletes/[id]/page.tsx:1075` for the **coach only**. And the
RLS policy at `supabase/migrations/017_rls_initplan_and_roles.sql:223-226` is
`for all to authenticated` scoped by `athlete_user_id = auth.uid()`, so the
athlete has always been permitted to read their own history. The data is there,
the permission is there, the API is there (`GET /api/wellness?athlete_id=…&days=N`,
`app/api/wellness/route.ts:20-51`). Only the screen is missing.

One more, smaller: the reassurance under the check-in button
(`app/athlete/page.tsx:794-795`) reads *"Your coach sees the scores, not who said
what to whom."* That sentence describes messaging, not wellness. It is the only
thing a 13-year-old is told about where their health data goes, and it is about
the wrong feature.

**Opportunity**

This is the highest-frequency athlete interaction in the product — the only thing
the athlete is asked to do on a day with no session — and it is the only one with
a zero-return loop. Fixing it needs no new capture surface, no migration, no new
route, and no change to the recording path. It is entirely a question of showing
the athlete data they already own.

**Recommendation**

On the athlete's wellness tab, **above** the existing form, render a self-history
block, and fix the two state defects that make the tab lie:

- Change the mount fetch at `app/athlete/page.tsx:256` from `days=1` to `days=21`.
  Keep deriving `todayWellness` from the same array; add `wellnessHistory`.
- Pass a real `onSaved` at line 1202 that re-runs that fetch, so the home card and
  the tab agree.
- Prefill `WellnessSubmit` from today's row when one exists, and change its
  heading to "Change your answers" in that case.
- Above the form, render **a 14-day dot strip and exactly one sentence.**

The sentence is computed deterministically — no model call:

- Require ≥5 check-ins in 14 days. Otherwise show the dots and *"Keep checking in
  — after a week we can show you what's changing."*
- Compare each metric's mean over the last 7 days against the 7 before. Take the
  largest adverse move. Show the sentence only if that move is ≥0.75 (15% of a
  5-point scale); otherwise *"Nothing much has moved this week. That's usually a
  good sign."*
- **Restrict the flagged metric to `energy`, `sleep_q` and `soreness`.** `mood`
  and `stress` still appear in the dots, still count toward the coach's alert, and
  still reach the coach's inbox via `notifyWellnessAlert` — but the app does not
  tell an unaccompanied 14-year-old that their mood is their worst number and
  falling. That is a clinical statement, and the channel for it already exists and
  has an adult on the other end.
- Replace the copy at `app/athlete/page.tsx:794-795` with what is actually true:
  *"Your coach sees these scores. If they stay low, your coach gets an email."*
  (Verified: `app/api/wellness/route.ts:92-105` fires `notifyWellnessAlert` to the
  coach automatically; the caretaker email at `app/api/wellness/alert/route.ts` is
  a separate, manual coach action.)

**Explicitly not recommended: mounting `WellnessGraph` on the athlete side.** The
register calls that "close to a one-line change" and it is — which is why it is
tempting and why it is wrong. `WellnessGraph.tsx:17-104` plots five ordinal 1–5
series, two of them inverted, as continuous lines in a 520×150 box. That is a
five-line spaghetti chart on a phone. A coach with context can read it; a
14-year-old cannot answer "so what do I do?" from it. One sentence beats it.

**Why it matters**

Self-monitoring changes behaviour only when it is fed back. The specific failure
mode here is documented: athletes show poor compliance with daily monitoring when
there is no feedback or when they perceive the data is not used, and that produces
not just missing data but *dishonest* data — athletes satisfice the form. Neupert,
Cotterill & Jobson (IJSPP, 2019) found that frequent, open feedback and visible
use of the data are what athletes name as the conditions for adherence. Right now
CoachVoice is running the exact configuration that research describes as the one
that fails: daily self-report, zero visible return.

Every downstream thing the wellness feature is for — the coach's alert, the
caretaker email, the safeguarding case — rests on the numbers being honest. The
return loop is not a nice-to-have on top of the alert; it is the alert's data
quality.

**What the athlete sees**

Wellness tab, top of screen:

```
YOUR CHECK-INS                              Last 14 days

 M  T  W  T  F  S  S    M  T  W  T  F  S  S
 ●  ●  ●  ○  ●  ●  ●    ●  ●  ○  ●  ●  ●  ◐
                                         today

 Sleep is your lowest score this week.
 You've averaged 2.4 out of 5, down from 3.6 last week.

────────────────────────────────────────────────────

 You checked in today. Change your answers below.

 Energy    1  2  3 [4] 5
 Mood      1  2 [3] 4  5
 Sleep     1 [2] 3  4  5
 Soreness  1  2  3 [4] 5
 Stress    1  2 [3] 4  5

 Anything else to note? (optional)
 [ sore left knee still                      ]

 [ Save changes ]
```

Filled dots are days checked in, tinted by score; hollow dots are missed days.
And on the home card, after saving, the "Daily check-in / How are you feeling
today?" panel actually flips to "Checked in today" without a reload.

**Coach use case**

Thursday, 5:40pm, twenty minutes before training. Mara has been flat in two
sessions and the coach has an amber wellness dot on her roster row but no idea
which metric caused it. Instead of opening with a number — which lands as
surveillance — the coach asks "how's your sleep been?" and Mara says "bad, yeah,
the app said it's my worst one this week." She brought it. The coach moves her out
of the jump-heavy block and says why. That is the whole mechanism: the athlete
arrives at the conversation already holding the same fact as the coach, so the
conversation is not an ambush.

**Complexity** Low
**Expected impact** Medium
**Confidence** High

**Evidence**

Neupert, Cotterill & Jobson, *Training-Monitoring Engagement: An Evidence-Based
Approach in Elite Sport*, IJSPP 2019 — athlete non-compliance with daily
self-report monitoring is driven by absence of feedback and perceived non-use of
the data, and athletes name frequent open feedback as the condition for adherence.
Supported by Saw, Main & Gastin's implementation work (JSSM 2015) on the same
barrier, and by the 2023 *Sports Medicine* qualitative study of world-class
team-sport athletes framing visibility of the data back to the athlete as the key
ingredient. Saw, Main & Gastin (BJSM 2016;50:281–291) is the underlying reason to
care about subjective measures at all: they outperform common objective measures
in responsiveness to training load — which is only true if they are answered
honestly.

The one-sentence-not-a-chart rendering, the 0.75 threshold and the mood/stress
exclusion are **design and safeguarding judgement, not research.** What would test
them: after four weeks, check-in rate before vs after, and whether any athlete's
flagged metric moves in the following week.

**Scores** Impact 4/5 · User value 5/5 · Effort 2/5 · MVP relevance 4/5 · Confidence 4/5
**Priority** (4 × 5 × 4 × 4) / 2 = **160**

**MVP verdict** BUILD NOW

**STRETCH — the bolder alternative**

**DATA-007 — "Ten Seconds Back": let the athlete answer the session.** CoachVoice
is a voice product in which exactly one person is allowed to speak. The coach
records; the athlete receives. The stretch bet is to open the return channel at
*session* level rather than day level: when a session is shared, the athlete's
home card carries one question — "How did that go?" — with three taps (**tough /
okay / good**) and an optional **10-second voice reply** that lands next to the
coach's own audio on `/sessions/[id]`. This is the first athlete-authored data in
the product and the first thing that makes a session a two-sided artefact instead
of a broadcast. It also produces the one comparison nothing in CoachVoice can
currently make: the coach's read of a session against the athlete's, on the same
row. Cost: a `session_athlete_response` table (migration 022), reuse of the
signed-upload path for audio — which touches the protected recording
infrastructure and therefore needs explicit approval, not an agent's judgement —
plus a coach notification and a retention decision. Risk: it is audio from minors,
so it needs a safeguarding review before a line is written, and if response rates
are low the coach gets a feature that is empty most weeks. What would have to be
true: that coaches want the athlete's read at all — some will experience it as
noise or as being marked. Test the tap-only version first, with no audio and no
new table (three values on the session row), and only build the voice half if the
taps get used and the coach asks what the athlete meant.

**What I'd challenge**

The check-in is **daily** for athletes who train three times a week — I said in my
2026-09-05 review that the check-in "earns its place as it stands", and the
compliance evidence above changes my mind on cadence specifically: ask on training
days and the morning after, not on a Sunday with nothing on, because a form nobody
has a reason to fill produces the low-effort answers that poison the alert.

**What I'd cut**

The composite `overallWellnessScore` — a plain mean of five non-commensurate
ordinal items, two of them inverted (`lib/wellness-config.ts`, used in the coach's
header, in `computeWellnessAlert` at `:143-161`, and in the alert email) — which
lets 5/5 energy cancel 1/5 soreness and hands the coach "2.6/5" with no indication
of what is wrong; replace it, and the alert threshold, with the worst metric and
its name.

Sources: Neupert, Cotterill & Jobson — Training Monitoring Engagement (IJSPP 2019)
· Saw, Main & Gastin — Monitoring Athletes Through Self-Report · A Qualitative
Study of 11 World-Class Team-Sport Athletes' Experiences Answering Subjective
Questionnaires (Sports Medicine, 2023) · Neupert, Holder & Jobson (2025).

────────────────────────────────
⚡ UX & USABILITY

UX AGENT

**ID** UX-006

**Friction identified**

The cold-start splash blocks the app for a **minimum of 3.4 seconds** on every
cold launch, on both sides of the app, and for the first part of that window it
swallows taps with no way out.

(Orchestrator: the agent computed 3.53 s from `SPORTS.length = 15`. The array has
14 entries. Corrected figures are used throughout this section — see CORRECTIONS.
The finding is unaffected.)

Five facts, all measured from the code:

1. **The floor is 2,939 ms, not 1.2 s.** `app/components/ColdStartSplash.tsx:82` —
   `FLOOR_MS = MARK_AT + 750`. Resolving the constants at `:53,68-84` with
   `SPORTS.length = 14`: `MONTAGE_MS = 1849`, `COLLAPSE_AT = 2089`,
   `MARK_AT = 2189`, `FLOOR_MS = 2939`, plus `OUT_MS = 460` (`:84`) = **3,399 ms
   before the app is touchable**. Ceiling is `5600 + 460 = 6,060 ms` (`:83`), with
   a 6,400 ms dead-man's switch at `app/layout.tsx:130`.

2. **It waits even when the app is ready.** `:155-157` — `leaveWhenReady`
   schedules `dismiss` at `max(0, FLOOR_MS - waited)`. If `markAppReady()` fires at
   700 ms (`app/athlete/page.tsx:229`, `app/dashboard/page.tsx:513`, both in a
   `finally`), the splash still holds the screen for another 2.2 s. The comment at
   `app/athlete/page.tsx:594-595` reads "Any touch dismisses it; **it never delays
   anything**." Both clauses are false.

3. **The first-painted frame has no dismiss handler at all.** The `pointerdown`
   escape is attached to the React component's root (`ColdStartSplash.tsx:168`) —
   which only exists after hydration. The thing actually on screen first is
   `#cv-boot`, server-rendered at `app/layout.tsx:164-173`, `position: fixed;
   inset: 0; z-index: 9000` (`:58-61`) with no `pointer-events` and no listener.
   That is precisely the window the shell was built to cover — the "roughly a
   megabyte of JavaScript" its own comment names at `:42` — and during it every tap
   lands on an inert div and is discarded.

4. **The cooldown was cut to 15 seconds.** `app/layout.tsx:122`
   (`Date.now() - last < 15000`). The comment at `ColdStartSplash.tsx:47-51` says
   it was reduced from 3 minutes because "closing the app and reopening it to look
   at the splash showed nothing." Cold-start is otherwise `sessionStorage`, which
   iOS destroys when it evicts a backgrounded PWA webview — so any return after 15
   seconds away is a full replay. `COOLDOWN_MS` at `:51` is now dead: the live value
   is the literal in `layout.tsx`.

5. **Reduced-motion users get the worst version.** `:159-161` schedule the floor
   and ceiling *before* the `prefers-reduced-motion` branch at `:179-184` returns
   early. Someone who asked their OS for less motion gets a frozen ink screen with
   a static logo for 2.94 s.

**Current workflow**

Cold launch → **3.4 s ink** (taps swallowed for the first ~1–2 s of it) →
Dashboard → FAB (`app/dashboard/page.tsx:1591`) → athlete chip
(`QuickSessionModal.tsx:375`) → Start Recording (`:497`)

= 3 taps and ≥3.4 s. A coach who taps to escape spends a 4th tap, consumed by
`{ once: true }` at `:168`.

**Proposed workflow**

Cold launch → **~1.4 s ink, or one tap from the first painted frame** → Dashboard
→ FAB → chip → Start Recording

**Change recommended**

Three edits, two files. Nothing added to the screen.

1. **Make ready mean ready.** Drop `FLOOR_MS` to ~900 ms (enough that it is not a
   flash) and, when `markAppReady()` fires before the sequence ends, *jump the
   timeline* to `MARK_AT` rather than waiting for it — set
   `start = performance.now() - MARK_AT` in `leaveWhenReady`. The mark rises, the
   word lands, it leaves. The brand moment survives at full quality; the wait does
   not.

2. **Move the escape to the first frame.** Add the dismiss to `BOOT_JS`
   (`app/layout.tsx:106-132`), which already runs pre-paint: on `pointerdown` on
   `#cv-boot`, remove `data-boot`/`data-boot-anim`. Three lines, zero bundle cost.
   Keep the React listener as-is for the post-hydration case; both funnel to the
   same attribute removal, so they cannot disagree.

3. **Put the cooldown back to 30 minutes** at `app/layout.tsx:122`, and delete the
   dead `COOLDOWN_MS` at `ColdStartSplash.tsx:51` so there is one source of truth.
   The author's need that motivated the cut is already served by `?splash=1` at
   `app/layout.tsx:109`.

**Why**

Two named principles. **A splash is a cover for a wait, not a wait of its own** —
the moment it outlives the thing it covers it stops being craft and becomes a
toll. And **user control and freedom (Nielsen #3)**: an interruption the user
cannot leave is not an interruption, it is a modal. Note that the fix is not a
"Tap to skip" label — per the interaction rule, the escape becomes real by
existing from the first painted pixel, which is what a full-bleed splash already
affords; the current build breaks the affordance by having none.

**Coach scenario**

Warm-up, court 3. The coach films eight seconds of a serve on the camera app,
comes back to CoachVoice to record the note while it is still in their head. iOS
has evicted the webview. They get ink. They tap — nothing, because the shell has
no handler. They tap again — still the montage. At 3.4 s the dashboard appears,
they hit the FAB, pick the athlete, start recording, and the thing they were going
to say has moved on. Between two reps that is the whole window.

**Tap/time reduction**

**2.0 s saved per cold start** (3.40 s → ~1.4 s) when data is ready, more when the
coach taps. Up to **4.7 s** in the ceiling case. One wasted tap removed. Frequency
is the number I cannot measure from code and would not guess — but the design
currently has *no* protection against a replay after 15 seconds away, and that is
the part worth fixing regardless of the true rate.

**Complexity** Low
**Expected impact** High
**Confidence** High

**Scores** Impact 4/5 · User value 4/5 · Effort 2/5 · MVP relevance 4/5 · Confidence 5/5
**Priority** (4 × 4 × 4 × 5) / 2 = **160**

**MVP verdict** BUILD NOW

**STRETCH — the bolder alternative**

**UX-007 — Delete the splash by deleting the wait.** The splash exists to cover a
~1 MB client bundle on two client-component routes (`app/layout.tsx:42`). The
different bet is to attack the wait instead of the cover: ship `/record` as a
**server-rendered** route and make it the PWA `start_url` — one server component,
the athlete chips already in the HTML, one Start Recording button, the recorder's
audio logic behind a dynamic import. The app becomes usable at first paint, the
dashboard bundle streams in behind it, and `ColdStartSplash`, `#cv-boot` and the
113 KB `sportSilhouettes.tsx` (whose only importer is the splash,
`ColdStartSplash.tsx:38`) all stop needing to exist. **Cost:** a new route, a
server-side athlete fetch, splitting `QuickSessionModal`, and re-testing the
protected recording path — which `CLAUDE.md` forbids touching without explicit
instruction, so this needs Max's sign-off before a line is written. **Risk:** it
makes the recorder the app and demotes the dashboard to a second destination; it
also removes the brand moment the last three rounds were spent building, which is
a real loss if first impressions matter more than the 40th launch. **What would
have to be true:** that the coach's dominant intent on opening the app is to record
rather than to browse. Cheap test first — log the first user action after each
launch for a week. If "record" is under half, this is the wrong bet and UX-006 is
the whole answer.

**What I'd challenge**

Holding the splash *until the app is ready* (`ColdStartSplash.tsx:155-161`) means
the worse the network, the longer the coach stares at ink — the design spends the
user's worst moment on branding, when a splash should shorten under stress, not
lengthen.

**What I'd cut**

The 14-sport montage from the **cold-start** splash (keep it at sign-in, where the
person is genuinely new): it is 1,849 ms of the 2,939 ms floor, and
`ColdStartSplash.tsx:38` is the *only* importer of the 113 KB
`sportSilhouettes.tsx`, so cutting it takes that file off the critical path of
every authenticated cold start on both sides of the app.

**Also checked this run, and found fine:** the athlete home CTA is still a real
`Link` to `/sessions/[id]` (`app/athlete/page.tsx:823`) — UX-002 survived the
design pass; the recorder's chip pickers and gated step-1 exits
(`QuickSessionModal.tsx:375,410,497`) — UX-001 survived; the boot script's path
scoping and `try/catch` storage guard (`app/layout.tsx:115-131`) are correct, and
the non-regex path match is deliberate and documented.

**Not examined this run:** messaging, calendar/DayWheel, groups, PDF reports,
video annotation, `/athletes/[id]`.

────────────────────────────────
🎨 VISUAL DESIGN

DESIGN AGENT

**ID** DESIGN-006

**Design issue/opportunity**

The 2026-09-07 athlete design pass (`199761b`) did not use the design system — it
re-typed it by hand. `app/athlete/page.tsx` now contains **65 six-digit hex
literals**, of which **60 are byte-for-byte copies of tokens that already exist in
`app/globals.css`**:

| Literal | Count | The token it duplicates |
|---|---|---|
| `#5D6661` | 12 | `--text-2` |
| `#1F2421` | 12 | `--text` |
| `#B55C3E` | 8 | `--coach-color` |
| `#9BA29B` | 8 | **the deleted value of `--text-muted`** |
| `#E3DED2` | 6 | `--border` |
| `#FFFFFF` | 4 | `--card` |
| `#6F8E6B` | 4 | `--primary` |
| `#FBF8F3` / `#EFEAE0` / `#4F6B4B` | 2 each | `--bg` / `--border-soft` / `--primary-dark` |

The eight `#9BA29B` (lines 755, 768, 784, 794, 813, 835, 893, 914) are the
regression PROJECT-STATE already records at 2.47:1. **That is the symptom, not the
finding.** The finding is the mechanism: when the value is hand-copied rather than
referenced, the page silently forks from the system, and nothing catches it. Three
failures nobody has recorded came in through the same door:

1. **`app/athlete/page.tsx:861-862`** — "Take into next session",
   `color: '#B55C3E'` at `fontSize: 9`, `fontWeight: 800`, uppercase, sitting on
   `background: 'var(--coach-light)'` (`#F4DED3`). **3.56:1 — fails WCAG 1.4.3
   (AA, 4.5:1).** This is the single forward-looking line the product has — the
   thing DATA-001 was built to produce — rendered at 9 px in the one place on the
   page where `--coach-color` does not clear AA. Every *other* `--coach-color`
   label (`:1010`, `:1021`) sits on white at 4.60:1 and passes. The design pass
   placed the one instance that doesn't.
2. **`app/athlete/page.tsx:1514` and `:1498`** — the bottom-nav labels,
   `fontSize: 9`. This is the athlete app's primary navigation.
3. **`app/athlete/page.tsx:922`** — the empty-state icon at `#C4C9C2`, **1.68:1 on
   `--card`**, `strokeWidth: 1.5`.

And the size dimension has the same shape as the colour one. There are **no
font-size tokens in `globals.css` at all** — only font *families*. Across the four
page files there are **361 inline `fontSize` declarations spanning 26 distinct
values** (8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15,
16, 17, 18, 19, 20, 22, 24, 28, 30, 34, 36). **66 of them are below 11 px** — 22 of
those on `/athlete`, the surface a 13-year-old opens daily.

**Recommended change**

Make `/athlete` the first page that *cannot* state a colour or a size except
through a token, and install the one guard that stops the next pass undoing it.
Four parts, in this order:

1. **Add a type scale to `globals.css`, with an 11 px floor.** `--fs-1: 11px`
   (eyebrow/micro) · `--fs-2: 12px` · `--fs-3: 13px` (body) · `--fs-4: 16px` ·
   `--fs-5: 19px` · `--fs-6: 30px` (display). On `/athlete`, every
   8.5/9/9.5/10/10.5 px site collapses to `--fs-1`. That is 22 edits and it deletes
   five sizes from the app's vocabulary in one file.

2. **Repoint the 60 token-duplicating literals at their tokens.** Mechanical. The
   eight `#9BA29B` become `var(--text-muted)` (`#6B736D`, 4.61:1 on `--bg`, 4.89:1
   on `--card`) — which is the DESIGN-001 fix landing again, but this time in a
   form that cannot silently revert.

3. **Add `--coach-on-light: #8E3F27`** and use it at `:862`. **5.62:1 on
   `--coach-light`** versus 3.56:1 today. Not a new hue — `#8E3F27` is already in
   this file at `:1488`, as the dark stop of the wellness FAB gradient. Also swap
   `:922`'s `#C4C9C2` for `var(--text-muted)` (4.89:1).

4. **Add the lint rule, scoped to what has been migrated.** In
   `eslint.config.mjs`, a `no-restricted-syntax` entry banning
   `/#[0-9a-fA-F]{6}/` string literals, applied to `files: ['app/athlete/**/*.tsx']`
   only. `npm run lint` is already step 2 of the mandatory pre-commit checklist in
   `CLAUDE.md`, so this costs nothing to run and fails the commit that reintroduces
   a hex. Widen the glob one page at a time as each is migrated —
   `app/dashboard/page.tsx` carries 96 literals and turning the rule on repo-wide
   today would just break lint and get switched off.

**Before**

The athlete page looks correct and is drifting. Eight strings of muted text sit at
2.47:1 — below even the 3:1 large-text floor — on the screen the teenager reads.
The one instruction the coach left for them is 9 px at 3.56:1. The nav that gets
them around the app is labelled at 9 px. And the system that would have prevented
all three is present, complete, and bypassed 65 times in one file.

**After**

One definition per colour, one scale for size, nothing below 11 px, and a lint
rule that means the next design pass cannot re-fork the page by hand. The visible
change is small and boring — slightly larger micro-labels, muted grey that is
actually readable, one rust label darkened. That is the point: it should look like
nothing happened and never regress again.

**Visual hierarchy**

*What the eye should catch, on the athlete's home card:* first, the session name
(16 px Newsreader, `--text`); second, "Take into next session" and its content —
the only line that says what to *do*; third, everything else — dates, "AUDIO",
"NEWEST", wellness labels.

*What it catches today:* first and second are right. Third has quietly overtaken
second. The eyebrow at `:862` is `fontWeight: 800`, uppercase and letter-spaced
`0.11em` — three emphasis signals — but at 9 px and 3.56:1 it reads as texture, not
as a heading, so the coach-light panel arrives as a decorated block rather than as
*the instruction*. Meanwhile "NEWEST" at `:832` gets a coloured dot, weight 800 and
`0.1em` tracking to announce that the top item in a reverse-chronological list is
the newest one. Emphasis is being spent on the least informative element on the
card and withheld from the most.

Weight and letter-spacing are being used as substitutes for size. They are not: at
9 px, `fontWeight: 800` on a 4-unit stem thickens strokes into each other, and
`letterSpacing: 0.11em` on uppercase spreads a short label past the eye's
word-shape span. The fix is size, and 11 px is the floor.

**Research/design rationale**

**EVIDENCE**

- Contrast, computed here (sRGB, WCAG 2.2 formula). My method reproduces
  PROJECT-STATE's recorded table exactly (`#9BA29B` 2.47:1, `#6F8E6B` 3.65:1,
  `#4F6B4B` 5.94:1), so these new numbers are on the same footing:

  | Pair | Ratio | Verdict |
  |---|---|---|
  | `#B55C3E` on `--coach-light` `#F4DED3` (`:861-862`) | **3.56:1** | **fails 1.4.3** at 9 px |
  | `#B55C3E` on `--card` `#FFFFFF` (`:1010`, `:1021`) | 4.60:1 | passes AA, narrowly |
  | `#8E3F27` on `--coach-light` (proposed) | **5.62:1** | passes AA |
  | `#8E3F27` on `--card` | 7.27:1 | passes AAA |
  | `#C4C9C2` on `--card` (`:922`) | **1.68:1** | see the opinion note below |
  | `#E4CE9A` on `--card` (`:665`, border) | 1.54:1 | non-text, decorative border |
  | `#EBCBBC` on `--coach-light` (`:861`, border) | 1.18:1 | non-text, decorative border |

- **Type size.** On iOS 1 CSS px maps to 1 pt; on Android 1 CSS px is 1 dp. Apple
  HIG's smallest built-in text style is **Caption 2 at 11 pt**; iOS's own tab-bar
  label is **10 pt**. Material 3's smallest type role is **`labelSmall` at 11 sp**.
  The athlete nav labels at 9 px (`:1498`, `:1514`) are below all three, including
  the platform's own tab-bar convention. 66 sites across the four page files are
  below 11 px.
- **Touch target.** The nav buttons at `:1505-1506` compute to roughly 43 px tall
  (`6 + 18 icon + 4 gap + 9 label + 6`). That clears WCAG 2.5.8 (24×24) but sits
  under Apple HIG 44 pt, Material 48 dp — **and under the app's own house rule at
  `globals.css:590`**, which they miss because they are bare `<button>`s rather
  than `.btn`. Worth verifying in a browser rather than from arithmetic, but the
  mechanism is real: the rule is attached to a class the nav does not use.
- **The regression is a process fact, not a taste fact.** DESIGN-001 removed
  `#9BA29B` from 23 sites; a pass 48 hours later reintroduced 8. `npm run lint`
  runs on every commit already. A `no-restricted-syntax` rule is the cheapest
  available proof that this class of change stays made.

**DESIGN OPINION** — this is my judgement, labelled:

- **The 11 px floor is a preference dressed in a platform citation, and I want to
  be honest about the seam.** HIG and Material define minimums for *their* type
  systems; neither is a conformance requirement, and no WCAG SC sets an absolute
  font size. What I actually believe is that a product whose stated feel is "clean,
  simple, deliberate" should not have 26 font sizes including seven half-pixel
  values, and that 8.5 px uppercase is a designer signalling refinement to other
  designers rather than communicating to a fifteen-year-old on a bus. **What would
  change my mind:** a teenager reading the home card aloud, in daylight, without
  squinting or zooming. If they can, the floor is 10 px and I was over-cautious. I
  have not watched anyone do this, and PROJECT-STATE records no such observation
  either.
- **`#C4C9C2` at 1.68:1 — I am not claiming a 1.4.11 failure.** SC 1.4.11 governs
  graphics *required to understand content*; this empty-state icon sits directly
  above the words "No sessions yet", so the content survives without it. It is
  nonetheless a 1.5 px stroke at 1.68:1, which means it is not drawing anything. My
  view is that an invisible illustration is worse than none. **What would change my
  mind:** if it is meant to be a ghost, say so and take it to `--border-soft`
  deliberately rather than landing at an unowned value.
- **The lint rule is the part I would fight for.** Everything else here is 90
  mechanical edits any competent pass would eventually make. The rule is what makes
  this the last time this recommendation gets written.

**Consistency impact**

Strongly reductive, which is why I picked it over the eight-line hex revert:

- Colour definitions on `/athlete`: 65 → 5 (four orphans plus one new token). One
  name per colour again.
- Font sizes on `/athlete`: 21 distinct → 6, with a floor. First type tokens the
  app has ever had; `/dashboard` (19 sizes), `/athletes/[id]` (19) and
  `/sessions/[id]` (13) inherit the vocabulary for free when their turn comes.
- Moves ~90 sites from inline literals *toward* the token layer, which my brief
  flags as the change that pays off again. The dashboard is the obvious next
  payment.
- Adds exactly one new token (`--coach-on-light`), and its value is already in the
  file.
- Adds one enforcement mechanism where there were zero.

The one thing it does *not* fix: `--primary` as text still fails at 10 sites
repo-wide (3.65:1), three of them on this page (`:751`, `:780`, and the "Read
session →" row). That is the open item PROJECT-STATE already tracks; bundling it
here would put two colour decisions in one review. I am deliberately leaving it —
but note that once the lint rule exists, those three sites become the obvious next
commit, because the migration will surface them.

**Complexity** Medium — one file, ~90 mechanical edit sites, 6 new tokens, 1 lint
rule. Verifiable by `git diff` and by grep returning zero.
**Expected impact** Medium — no new capability; the daily athlete surface becomes
readable and stops drifting.
**Confidence** High — every colour claim is computed and reproduces the recorded
table; every line is cited.

**Scores** Impact 4/5 · User value 3/5 · Effort 3/5 · MVP relevance 4/5 · Confidence 5/5
**Priority** (4 × 3 × 4 × 5) / 3 = **80**

**MVP verdict** **BUILD NOW** — parts 1–3 are a single afternoon; part 4 is fifteen
minutes and is the reason to do it now rather than after the next design pass adds
a fourth fork.

**STRETCH — the bolder alternative**

**DESIGN-007 — Keep the promise the entrance makes: an ink-native athlete app.**
CoachVoice now spends 1.24 s of every cold start establishing an identity — deep
ink ground, cream type, a sage stroke — and then throws it away for parchment. The
ink tokens already exist (`globals.css:68-86`) and are used for roughly two seconds
a day. The bet: `/athlete` becomes ink-native. Not "dark mode" as a toggle — a
single committed palette, because the athlete app is used courtside under
floodlights and in a bedroom at 10 pm, and parchment at full brightness is the
wrong object in both. The contrast headroom is better, not worse: `--on-ink` on
`--ink-base` is **13.40:1**, `--on-ink-2` composited (`#B9B4A4`) is **7.60:1** —
against 15.4:1 and 5.49:1 for the parchment pair, so secondary text gains a full 2
points of margin, which is precisely where the app keeps failing. **Cost:** a full
second palette — every card, border, input, badge and chart fill in a 1,573-line
file, plus `WellnessGraph` and `SessionAudioPlayer`; call it 3–4× DESIGN-006.
**Risk, and it is real:** `--coach-color` measures **3.43:1** on ink and fails, so
the coach's rust — the app's one signal for "this came from a person" — has to be
re-derived lighter, and if that goes wrong the athlete app stops feeling like the
same product as the coach's. Two grounds is also exactly the sin DESIGN-002 is
still trying to undo in the auth funnel, and I would be reintroducing it
deliberately on the argument that coach and athlete are two products sharing a
database. **What would have to be true:** that athletes open this app mostly in the
evening. That is one query against `first_login_at` and session timestamps, and
nobody has run it. If the answer is "after training, outdoors, 5–7 pm", parchment
wins and this idea dies cheaply.

**What I'd challenge**

`app/layout.tsx:15-16` ships `maximumScale: 1, userScalable: false`,
`globals.css:561-562` sets `text-size-adjust: 100%`, and the manifest declares
`"display": "standalone"` — so in the installed PWA there is no browser zoom UI, no
pinch-zoom, and no text inflation, which means **no mechanism of any kind by which
a user can enlarge the 66 sites of sub-11 px text** (WCAG 2.2 SC 1.4.4 requires
200%); the lock was presumably added to stop iOS auto-zooming form fields, but
`globals.css:590` already solves that properly by setting `.input` to 16 px, so
deleting `maximumScale` and `userScalable` is a two-line change that costs nothing
and buys back the accessibility floor.

**What I'd cut**

The "NEWEST" badge at `app/athlete/page.tsx:831-832` — a coloured dot plus an
8.5 px letter-spaced word, the smallest type in the entire app, spent announcing
that the first item in a reverse-chronological list is the most recent one.

────────────────────────────────
🚀 WOW FACTOR

WOW AGENT

**ID** WOW-003

**The gap**

CoachVoice has no memory. Every session is an orphan.

The app extracts one forward-looking line per recording and writes it to
`focus_points` (`app/api/sessions/route.ts:242,256`), renders it on the athlete's
newest home card (`app/athlete/page.tsx:855-870`) and on `/sessions/[id]:420-451` —
and then nothing. The next recording does not know it exists. `QuickSessionModal`
fetches no prior session data at all (its only network calls are the audio upload
URL at `:138`, `/api/transcribe` at `:163`, and the POST at `:202`). No screen
anywhere shows one coaching point across two sessions. Nobody — not the coach, not
the kid, not the parent — ever finds out whether the thing the coach said actually
landed.

So the honest sentence a coach uses to describe CoachVoice today is *"it turns my
talking into notes for the kid."* That is a transcription utility. CoachNow already
does voice feedback in a private coach-athlete channel, at a million users.
Transcription is not a product; it is a feature of someone else's product.

And the emotional core of youth sport — a kid seeing themselves get better — is
currently represented in this app by a reverse-chronological list.

**The idea**

**The Callback.** Make a focus point a durable object with a lifetime, let the
summariser close it out of the coach's own next recording, and turn the closing
into an artefact made of the coach's real voice.

Four pieces:

1. **Persist what the app already computes.** `/api/transcribe` returns Whisper's
   timestamped `segments` (`app/api/transcribe/route.ts:75,102`) and
   `QuickSessionModal:163-174` reads `json.text` and drops the rest. Migration 022
   adds `sessions.segments jsonb`; the POST body carries them through. This is
   WOW-001's dependency and the reason the two should ship as one thing rather than
   two.

2. **A `focus_threads` table.** `id, coach_id, athlete_id, text,
   opened_session_id, status ('open'|'landed'|'dropped'), touches jsonb` — where
   `touches` is an ordered list of
   `{session_id, session_date, quote, segment_start, segment_end, verdict}`. A
   `NEXT:` line opens a thread instead of dying in a jsonb array.

3. **Teach the summariser to look backwards.** `makeQuickSummary`
   (`app/api/sessions/route.ts:47`) today receives transcript + sport. Give it a
   fourth block: this athlete's 1–3 open threads. Ask for one more trailing line per
   touched thread, parsed with exactly the same defensiveness as the existing
   `NEXT:` handling (`route.ts:113-133`):

   `TOUCHED: <thread_id> | landed|progress|struggling | <the coach's own sentence, verbatim>`

   The verbatim requirement is not a style preference — it is the mechanism. A
   quote that is not a substring of the transcript gets dropped (fabrication
   guard), and a quote that *is* a substring maps straight onto a Whisper segment
   and therefore onto an audio offset. No alignment work, no forced-alignment
   dependency. The existing 120-char/placeholder rejection at `route.ts:126-131` is
   the template.

4. **The payoff screen.** When a thread flips to `landed`, the coach does not land
   back on the dashboard after Save. They land on the Callback: the athlete's first
   name, the thread text, and three to five dated rows — each row the coach's *own
   verbatim sentence*, each with a play button on the exact segment of the exact
   recording. Twenty-two seconds of audio spanning three weeks, all about one thing.
   One button: **Send this to Maya.**

On the athlete side the home card stops being a floating instruction and becomes a
state: *"Working on: keep your platform still"* with a dot per session it's been
mentioned in — and when it closes, the card turns over.

**The moment**

Tuesday, 8:40pm. Coach Dee is in the car park at Bexley Leisure Centre with the
engine off, thumb on the FAB.

Above the mic, one line she has never seen before: *"Last time you told Maya — keep
your platform still on the low ball."*

She hadn't remembered. She records forty seconds. Second nineteen: *"...and that
low ball in the third, that's the one, that's exactly it, that's what we've been
chasing."*

Stop. Transcribe. Review. Save.

The screen doesn't go back to the dashboard. It goes dark-ink and holds one word —
**Maya** — and under it, in Newsreader, *keep your platform still on the low ball.*

Then three rows fade in, oldest first, each a play triangle and a date:

> **19 Aug** — "your platform's collapsing the second the ball's under your knee" ▶
> **28 Aug** — "better tonight, but only when you weren't tired" ▶
> **9 Sep** — "that's the one, that's exactly it, that's what we've been chasing" ▶

Dee taps the first. It's her, three weeks ago, sounding tired and a bit annoyed.
She taps the third. It's her, tonight, and you can hear her grinning.

She sits in the car park and plays all three in a row.

That is where it lands. Not the technology — the fact that a coach who says two
hundred things a week has just been handed proof that one of them worked, in her
own voice, without doing anything except her job.

Then: **Send this to Maya.** Which also goes to Maya's mum, because she's a
registered caretaker.

**Why anyone would talk about it**

Two adult channels, and the kid is never the distributor.

*Coach to coach.* The sentence changes from "it records stuff" to **"it remembers
what I told her three weeks ago and tells me whether it stuck."** That is a
sentence a coach repeats at a tournament, because it describes something the person
they're talking to has personally failed to do since they started coaching. Nobody
remembers what they said three weeks ago. Everyone feels guilty about it.

*Parent to parent.* The Callback email is the only thing this product has ever
produced that a parent would forward. Not a summary — a parent doesn't forward a
summary. A forty-second recording of their daughter's coach's voice changing from
"your platform's collapsing" to "that's the one" is a thing a mother sends to the
child's father, and then to the grandmother, and then mentions to another parent on
the sideline on Saturday. That is a coaching-club-sized viral loop that runs
entirely through consenting adults and never exposes the child to anyone who wasn't
already going to see her play.

The moat is real and it compounds. The competitive progress story in this market is
*video*: CoachNow's skeleton tracking and side-by-side comparison, Onform's clip
review. All of it requires the coach to deliberately shoot, tag and align footage.
Nobody threads the **spoken cue**, because nobody else has a per-athlete
longitudinal voice corpus accumulating as a byproduct of the coach's normal
behaviour. A notes app structurally cannot: there is no thread and no voice. A
funded rival can build the feature in a month and still have nothing to run it on.
And because it computes from `transcript` rows already in Postgres, CoachVoice can
backfill — the moat is full on day one, not in a year.

**What it takes**

No hiding it: this is the biggest thing anyone has proposed here.

- Migration 022: `sessions.segments jsonb`. Migration 023: `focus_threads` + RLS
  mirroring `sessions`.
- `QuickSessionModal` passes `segments` through to the POST — this is one line, but
  it is one line in the file `CLAUDE.md` protects. It needs the explicit instruction
  the constraint demands.
- `makeQuickSummary` gains a thread block, a second parse path, and a
  verbatim-substring guard. Roughly doubles the most delicate function in the app.
- Thread open/touch/close writes inside the existing `/api/sessions` POST
  transaction (`route.ts:242-265`).
- `GET /api/threads`, `PATCH /api/threads/[id]` (coach confirms/overrides a
  verdict).
- One new full-screen coach surface (the Callback), reusing `SessionAudioPlayer`
  and `/api/sessions/[id]/audio-url`.
- Athlete home card rework (`app/athlete/page.tsx:855-870`) — and note the reality
  PROJECT-STATE flags: inline styles, one 1,573-line file.
- One new email template on `notifySessionShared`'s machinery (`lib/notify.ts:143`),
  fanned to `athlete_caretakers` (`app/api/caretakers/route.ts:24`).
- Cost: one extra ~300-token block per summarise call on gpt-4o-mini. Negligible.

Rough size: **two to three weeks**, and the tail risk is not the code — it's tuning
the model's `landed` judgement until it is right often enough to trust.

**What could go wrong**

- **The verdict is a machine making a claim about a child's competence.** If the
  model says "landed" and Dee disagrees, she has to unsay it to a fourteen-year-old.
  Non-negotiable mitigation: the Callback is *never* auto-published. It is generated
  for the coach, and the coach sends or discards — the same gate as
  `shared_with_athlete`.
- **The shame surface.** The natural inverse of "landed" is "still struggling after
  eight sessions." An athlete must never see that. Ever. The athlete's states are
  `open` and `landed`, full stop. `struggling` is coach-only, and even for the coach
  it should be phrased as *"this cue isn't landing — try saying it differently"*,
  which is a note about the coaching, not about the kid.
- **Inflation kills it.** If every session closes a thread, a Callback means nothing
  and the whole thing reads like a participation certificate. Hard caps: minimum
  three touches before a thread can close, one Callback per thread ever.
- **Whisper mishearings make "verbatim" a lie.** The substring check catches the
  model fabricating; it cannot catch Whisper mistranscribing. A coach could be
  played back saying something she didn't say. Coach review before send is the only
  real answer, and it is sufficient because she is the one who said it.
- **Taste.** Ink-and-Newsreader gravity applied to "keep your platform still" is one
  design decision away from being funny. The restraint has to be total.

**Safeguarding check**

My first version of this had the Callback as a shareable vertical video with a link
— the athlete's name, three dated coach quotes, a save-to-camera-roll button.
**Dead on the first hard limit**: a minor's name plus an adult's assessment of her
performance, pushed to a public surface by the minor herself, permanently. Killed
outright, not softened.

What survives:

- Coach-generated, coach-gated, **delivered by email only** — to the athlete and to
  registered caretakers in `athlete_caretakers`. No URL, no token, no public route.
  Consistent with the app having no public surface at all
  (`app/api/share/clip/[videoId]/route.ts:15` returns 401 without a session).
- **The athlete's own content only.** A thread is one athlete against her own past.
  No cross-athlete comparison, no squad ranking, no leaderboard — not as a v2, not
  ever. This is the mechanic most likely to be requested and it must be refused.
- **Zero wellness data.** Threads and wellness would join beautifully and it is the
  single most tempting join in the schema. It does not happen: soreness and mood are
  health data about a child and they do not enter an artefact that leaves the app,
  even to a parent, even bundled with good news.
- **No engagement mechanic.** A Callback fires on a real coaching event, never on a
  schedule. No streak, no "you haven't closed a thread in 9 days", no push. If a
  coach records nothing for a month, the app says nothing.
- **Adults carry the virality.** The distributor is the coach or the parent. The
  child is the subject, never the sender.

The one consent question this raises that the hard limits don't cover, and it's the
same one WOW-001 hit: *"stored for transcription"* is not *"replayable by a
fifteen-year-old and forwardable by her mother."* Audio in a Callback needs its own
opt-in, defaulting off, separate from `shared_with_athlete`.

**Cheapest version that still wows**

One day. No migration, no writes, no schema, one throwaway page.

`/dev/callback` — the coach-only `/dev` scaffolding already exists from WOW-001
(`proxy.ts:12-13,126`, `app/dev/hearit`), so auth is free. Pick one real athlete
with five or more sessions. `GET /api/sessions?athlete_id=` already returns
`transcript` and `focus_points` for every one of them
(`app/api/sessions/route.ts:164`). Send the whole set to gpt-4o-mini in a single
call: *"find one coaching point this coach returned to across these sessions; quote
the coach verbatim each time, in date order."* Render it as the Callback screen.
**Text only — no audio, no segments, no persistence.**

Then show it to one coach, about her own athlete, and watch her face.

The test is not whether she likes it. The test is whether she says some version of
***"can I send that to her mum?"*** If she doesn't, the other 90% is a daydream and
this should be closed rather than backlogged.

That one call also answers the only question that actually gates the build: **does
gpt-4o-mini find a real thread in real coach transcripts, or does it invent a
flattering one?** If it invents, everything above is dead and it cost a day.

**Complexity** High
**Wow potential** High
**Confidence** Medium

**Scores** Impact 5 · User value 4 · Effort 5 · MVP relevance 2 · Confidence 3
**Priority** (5 × 4 × 2 × 3) / 5 = **24**

I'll argue with one term. MVP relevance 2 is the honest score against the MVP *as
scoped*, and I won't inflate it. But the formula has no term for **retention**, and
PROJECT-STATE states the problem outright: *"no reason to open the app on a day with
no session."* A live thread is that reason, and — unlike every mechanic that usually
solves it — it is not a streak, it does not nag, and it cannot be gamed by opening
the app. It also has no term for **what the product is**. DATA-002 (priority 128,
still unbuilt) is the front half of this and should be built as this feature's step
1 rather than separately; DATA-003 ("The Thread", synthesise 6–10 transcripts into
three sentences) is aiming at the same territory and thinking too small — a season
summary is a document nobody asked for, while closing *one* loop is an event with a
payoff and a moment.

**Verdict** PROTOTYPE — the `/dev/callback` day, before anything else.

**Three more, unargued**

1. One 90-second squad recording, split by the model on athlete names, advancing
   eleven separate threads at once — each athlete receiving only the sentence about
   them.
2. `session_date` is already nullable and already backdated, so let a coach record a
   session *before* it happens: twenty seconds of "here's what I want out of
   tonight," which opens the thread that the post-session recording closes the same
   evening.
3. The end-of-season Callback for a whole squad, one page per athlete, printed on
   the existing `/pdf/monthly/[athleteId]` machinery, handed to parents at the
   awards night.

Sources: CoachNow · Onform · Best Youth Sports Coaching Apps 2026 · How to Track
Athlete Progress 2026.

────────────────────────────────
CORRECTIONS — orchestrator verification

Every agent claim in this report was re-checked against the code. Two numbers were
wrong; both findings survive the correction.

1. **UX-006 used `SPORTS.length = 15`. The array has 14 entries**
   (`app/components/sportSilhouettes.tsx`, counted). Recomputing `FIG_MS` from
   `first = 220, last = 70, n = 14`: `MONTAGE_MS = 1849` (not 1979),
   `COLLAPSE_AT = 2089`, `MARK_AT = 2189`, `FLOOR_MS = 2939` (not 3069), minimum on
   screen **3399 ms** (not 3529). The ceiling figure of 6060 ms was correct. The
   source comment at `ColdStartSplash.tsx:72` ("~1850 across 14 sports") is accurate
   and the agent overrode a correct comment with a wrong count. All figures in the
   UX section above have been corrected.

2. **DESIGN-006's contrast numbers all reproduce exactly** — independently computed
   with the sRGB WCAG 2.2 formula: `#B55C3E` on `#F4DED3` = 3.56:1, on `#FFFFFF` =
   4.60:1; `#8E3F27` on `#F4DED3` = 5.62:1, on `#FFFFFF` = 7.27:1; `#C4C9C2` on
   `#FFFFFF` = 1.68:1; `#F5ECD7` on `#1F2421` = 13.40:1. The method also reproduces
   PROJECT-STATE's recorded table (2.47, 3.65, 4.61), so the new rows are on the
   same footing. Hex-literal counts confirmed: **65** in `app/athlete/page.tsx`,
   **96** in `app/dashboard/page.tsx`, 14 in `app/athletes/[id]/page.tsx`, 2 in
   `app/sessions/[id]/page.tsx` — 177 across the four page files, as claimed.

3. **DATA-006 verified in full** — the wellness tab renders only `WellnessSubmit`
   with `onSaved={() => {}}` (`app/athlete/page.tsx:1200-1202`); the mount fetch is
   `days=1` with deps `[athleteId]`; `WellnessSubmit` initialises `{}` with no
   prefill and gates on all five; `WellnessGraph` is imported only by
   `app/athletes/[id]/page.tsx`; `setTodayWellness` has exactly one call site.

4. **UX-006's dead-constant claim verified** — `COOLDOWN_MS` and `SPLASH_LAST_KEY`
   (`ColdStartSplash.tsx:45,51`) are each referenced exactly once, at their own
   declaration. The live cooldown and storage key are string/number literals in
   `app/layout.tsx:121-123`. Two dead constants that lint does not catch.

5. **DESIGN-006's zoom-lock challenge verified** — `app/layout.tsx:13-16` ships
   `maximumScale: 1, userScalable: false`.

────────────────────────────────
CHALLENGES TO THE STATUS QUO

Collected, unresolved, for Max to react to.

**What I'd challenge**

- **DATA** — The check-in is *daily* for athletes who train three times a week. Ask
  on training days and the morning after, not on a Sunday with nothing on: a form
  nobody has a reason to fill produces the low-effort answers that poison the alert.
  (This agent reverses its own 2026-09-05 position on cadence.)
- **UX** — Holding the splash until the app is ready means the worse the network,
  the longer the coach stares at ink. The design spends the user's worst moment on
  branding; a splash should shorten under stress, not lengthen.
- **DESIGN** — The installed PWA disables zoom entirely (`maximumScale: 1`,
  `userScalable: false`, `display: standalone`), so there is no mechanism by which a
  user can enlarge the 66 sites of sub-11 px text. WCAG 2.2 SC 1.4.4 requires 200%.
  The lock was presumably for iOS form-field auto-zoom, which `globals.css:590`
  already solves by setting `.input` to 16 px. Two-line fix.
- **WOW** — The priority formula has no term for retention and no term for what the
  product *is*, so it will always rank a screen fix above a change to the product's
  identity. WOW-003 reports its honest 24 and argues the formula, not the score.

**What I'd cut**

- **DATA** — The composite `overallWellnessScore`: a mean of five non-commensurate
  ordinal items, two inverted, which lets 5/5 energy cancel 1/5 soreness and hands
  the coach "2.6/5" with no indication of what is wrong. Replace it and the alert
  threshold with the worst metric and its name.
- **UX** — The 14-sport montage from the *cold-start* splash (keep it at sign-in).
  It is 1,849 ms of the 2,939 ms floor, and the splash is the only importer of the
  113 KB `sportSilhouettes.tsx`.
- **DESIGN** — The "NEWEST" badge (`app/athlete/page.tsx:831-832`): a coloured dot
  plus an 8.5 px letter-spaced word — the smallest type in the app — spent
  announcing that the first item in a reverse-chronological list is the newest.

────────────────────────────────
TODAY'S PRIORITY

**The relationship, and it is a real one.** Three of the four agents converged on a
single theme without seeing each other: **CoachVoice is a one-way pipe, and nothing
in it ever closes a loop.**

- DATA-006: the athlete submits five numbers a day and the product returns nothing.
- WOW-003: the coach says something and never finds out whether it landed.
- DATA-007 (stretch): the athlete has no way to answer a session at all.

That is the same structural fact observed from three positions — and it is the
cheap-version/ambitious-version pairing this system exists to produce. DATA-006 is
the one-day version of the thesis; WOW-003 is the three-week version. They are not
alternatives and they do not compete: one closes the athlete's daily loop with no
schema change, the other closes the coach's multi-session loop and needs two
migrations.

**A second, narrower convergence.** DATA-006 and DESIGN-006 both land on
`app/athlete/page.tsx:755` — the "Trends →" button — independently and for
unrelated reasons. DATA says it navigates to a dead end; DESIGN says it is rendered
in 2.47:1 grey at 10.5 px. The same control is both broken and unreadable. Whoever
touches that line should fix both, which they will, because the fixes are in
different files.

**A genuine disagreement, left unresolved.** UX-006 and DESIGN-007 point in
opposite directions on the entrance. UX says the splash costs 3.4 s of every cold
start and should shrink; DESIGN says the identity it establishes is thrown away one
second later and should extend into the app. Both are defensible. They are not
reconcilable by an orchestrator, and neither should be built before the other is
argued.

**Sanity check on the arithmetic.** UX-006 and DATA-006 tie at 160. The formula
cannot separate them, so judgement does.

**#1 Recommendation today: DATA-006** — close the athlete's wellness return loop:
`days=1` → `days=21`, a real `onSaved`, prefill the form, and a 14-day dot strip
with one computed sentence.

Why it wins over UX-006, which scores identically: UX-006 fixes something *slow*.
DATA-006 fixes something *untrue*. "Trends →" navigates to a blank form; an athlete
who checked in this morning is shown five empty rows and told, in effect, that it
never happened. The register has carried this as "STILL OPEN — the biggest thing
this review found that nobody has acted on" since 2026-09-06 and two rounds have
now passed it over. It is also the loop the safeguarding alert's data quality
depends on, which makes it the only item today with a duty-of-care argument behind
it.

**Recommended action: BUILD** — and build UX-006 in the same sitting. They touch
disjoint files (`app/athlete/page.tsx` + `WellnessSubmit.tsx` versus
`ColdStartSplash.tsx` + `layout.tsx`), both are Effort 2, and neither blocks the
other. Ranking them was necessary; choosing between them is not.

Implementation outline — DATA-006, defect subset first:

1. `app/athlete/page.tsx:256` — `days=1` → `days=21`; keep `todayWellness` derived
   from the same array, add `wellnessHistory` state. **Use `apiJson` from
   `lib/api-client.ts`** — the current call is a raw `fetch().then(r => r.json())`
   with no `res.ok` check, which is a live violation of checklist item 1 in
   `CLAUDE.md`.
2. `app/athlete/page.tsx:1202` — replace `onSaved={() => {}}` with a callback that
   re-runs that fetch, so the home card flips to "Checked in today" without a reload.
3. `app/components/WellnessSubmit.tsx:15` — accept an optional `initial` prop and
   seed `scores`/`notes` from today's row; change the heading to "Change your
   answers" when it is present.
4. Add the 14-day dot strip above the form. Deterministic, no model call. Hold the
   computed sentence and the mood/stress exclusion for a separate decision — that
   part is a product and safeguarding call, not a defect fix, and it is the one
   piece of DATA-006 that is genuinely Max's to make.
5. Check: `npx tsc --noEmit && npm run lint && npm run build`; then check in as an
   athlete, tap Home, and confirm the card flips without a reload.

**#1 Ambition: WOW-003 — The Callback.**

Why this bet over the others: DESIGN-007 is gated on a query nobody has run (when do
athletes actually open the app), and UX-007 requires opening the recording path that
`CLAUDE.md` protects — both are one prerequisite away from being decidable, so
neither is ready to be chosen. WOW-003 is the only ambition on the table that
changes the sentence a coach uses to describe the product, and it is the only one
whose central risk can be retired for a day's work without writing a schema. It also
absorbs two items already in the register rather than competing with them: DATA-002
(priority 128, still unbuilt) is its step 1, and WOW-001's segment persistence is its
dependency. It is honestly scored at 24 and it should be: it loses the arithmetic on
purpose.

Cheapest way to find out if it is right: the `/dev/callback` day. One throwaway
coach-only page, one gpt-4o-mini call over one real athlete's existing transcripts,
text only — no audio, no segments, no persistence. It answers the one question that
gates everything else: does the model find a real thread in real coach transcripts,
or invent a flattering one? Then show it to one coach about her own athlete. The
test is not whether she likes it. It is whether she asks to send it to the athlete's
mum. If she doesn't, close WOW-003 rather than backlogging it.

────────────────────────────────
NOT YET REVIEWED — new observations from this run

Recorded so they are not lost. Not agent proposals; any agent may pick one up later.

- **Raw `fetch` with no `res.ok` check** at `app/athlete/page.tsx:256` (the wellness
  mount fetch) — a live violation of checklist item 1 in `CLAUDE.md`, which exists
  because a non-2xx silently becomes empty data. Orchestrator-found while verifying
  DATA-006; folded into that build outline.
- **Two dead constants** — `COOLDOWN_MS` and `SPLASH_LAST_KEY`
  (`ColdStartSplash.tsx:45,51`) are declared and never used; the live values are
  literals in `app/layout.tsx:121-123`. `npm run lint` does not flag them, which is
  worth knowing independently of the splash work.
- **The PWA disables zoom** (`app/layout.tsx:15-16`, `display: standalone`) with 66
  sites of sub-11 px text and no way to enlarge any of it. WCAG 2.2 SC 1.4.4.
  Two-line fix. Raised by DESIGN-006 as a challenge, not proposed against.
- **PROJECT-STATE understates the regression.** It records eight bad `#9BA29B`. The
  real figure is 65 hex literals in `app/athlete/page.tsx`, 60 of them exact token
  duplicates, and 177 across the four page files. Stating it as "eight bad hexes"
  invites an eight-line fix that leaves the mechanism intact.
- **`--coach-color` has no safe use as text on its own light tint** (3.56:1 on
  `--coach-light` vs 4.60:1 on white). That is a gap in the token set rather than a
  mistake on one line.
- **PROJECT-STATE is 316 lines against its own ~250-line budget** after today's
  refresh and wants a deliberate trim, not further growth.
