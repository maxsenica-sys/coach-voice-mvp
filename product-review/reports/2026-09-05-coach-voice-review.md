COACH VOICE — DAILY PRODUCT REVIEW

Date: 2026-09-05
Reviewed against: 020fc70 "Let a coach choose the date a session happened (#3)"
Run: initial review — first time the three agents have looked at CoachVoice.

────────────────────────────────────────────────────────────
📊 DATA & PERFORMANCE
────────────────────────────────────────────────────────────

**ID** DATA-001

**Observation**
`focus_points` is the only structured, forward-looking, athlete-actionable
field in the system, and the migration comment agrees: *"what the athlete
should carry into the next session"*
(`supabase/migrations/019_session_detail_fields.sql:19-22`). In practice the
field is almost certainly empty, and if it is not empty nobody it is meant for
can see it.

Three checks, all confirmed in code:

1. **Nothing ever writes it except a coach typing.** The save path
   `POST /api/sessions` inserts ten columns and `focus_points` is not one of
   them (`app/api/sessions/route.ts:201-218`). The only writer is the text
   input on the session page (`app/sessions/[id]/page.tsx:451-467` → `PATCH` at
   `app/api/sessions/[id]/route.ts:40-56`). So to produce one focus point the
   coach must: finish the session, save it, navigate to `/sessions/[id]`, and
   type a sentence with their thumbs. That is the exact behaviour CoachVoice
   exists to remove.
2. **It renders in exactly one place.** `app/sessions/[id]/page.tsx:420-470`.
   A repo-wide grep for `focus_points` returns only that page, the two API
   routes and the migration.
3. **The athlete's two main screens cannot show it even if they wanted to.**
   The athlete page's session query selects eleven columns and `focus_points`
   is not among them (`app/athlete/page.tsx:178`). Neither is it in the coach's
   list query (`app/api/sessions/all/route.ts:37-49`). What the athlete gets on
   home is `summary.slice(0, 120)` (`app/athlete/page.tsx:786`) and on the
   Sessions tab `summary.slice(0, 140)` (`app/athlete/page.tsx:854`) — the same
   paragraph, truncated twice, mid-sentence.

So the athlete's entire performance feed is a truncated recap of what already
happened. The one field that says what to do next is behind a manual typing
step that the product's own value proposition discourages, and behind two taps
if it survives.

**Opportunity**
The transcript already contains the "next time" instruction — coaches say it
out loud, it is how they talk. The summariser is already reading that
transcript with a sport-aware prompt (`app/api/sessions/route.ts:31-90`). The
one thing to work on next is being spoken, transcribed, read by a model, and
then averaged away into a recap paragraph. It can be lifted out at zero cost to
the coach — no extra tap, no extra API call, no new capture surface.

**Recommendation**
Make the existing summariser emit one extra line, and put that line where the
athlete already looks.

1. **Extract it, don't capture it.** In `makeQuickSummary`
   (`app/api/sessions/route.ts:31-90`), after the bullets, ask for one final
   line in the form `NEXT: <one thing to work on next session>` — under 90
   characters, imperative, in the coach's own words, and **omitted entirely if
   the coach did not say anything forward-looking**. Split it off the response
   server-side; the bullets before the `NEXT:` line stay the `summary` exactly
   as today. Keep it in the same `gpt-4o-mini` call — no second request. Write
   the result as `focus_points: next ? [next] : []` in the insert at
   `app/api/sessions/route.ts:203-216`. If the line is missing or the call
   fails, the array is `[]` and behaviour is identical to today.
2. **Show it in one place on the athlete side.** Add `focus_points` to the
   athlete's select (`app/athlete/page.tsx:178`) and render it as a single line
   inside the existing "New from Coach" card (`app/athlete/page.tsx:771-793`),
   directly under the truncated summary. One line. Not a list, not a checklist,
   not a new card.
3. **Change nothing on the session page.** The coach edit/delete UI at
   `app/sessions/[id]/page.tsx:427-467` already handles a populated array — a
   coach who disagrees deletes it in one tap, or adds their own. Reuse the
   existing wording, "Take into next session".

Do not touch the recording path, `runtime`, MIME detection or FormData. This is
a prompt string, one insert field, one select column and one render block.
`app/api/sessions/route.ts` is a protected route under `CLAUDE.md`, so the diff
should be reviewed as carefully as the audio routes even though it goes nowhere
near the audio.

**Why it matters**
A summary answers "how did I go". It does not answer "what do I do on
Thursday". Those are different jobs, and only the second one changes what the
athlete does at the next training. Today the product does the first one well
and the second one not at all — the field for it exists and sits empty.

**What the athlete sees**

```
● NEW FROM COACH · Tue 2 Sep
Setting session

"• Good hands on the high ball, quieter feet though — you're
arriving late and reaching. • Contact in front of your fore…"

▸ TAKE INTO NEXT SESSION
  Get your feet there before the ball, then set — don't reach.

            [ Read full session → ]
```

One sentence. No number, no score, no chart, nothing to interpret. A
14-year-old reads it on the bus and knows what they are doing first on
Thursday.

**Coach use case**
Tuesday, 7:40pm, packing up the net. The coach records forty seconds: *"Mia was
good tonight, hands were clean on the high ball, but she's arriving late and
reaching for it — I want her getting her feet there before she sets, that's the
thing for Thursday."* They hit save and drive home. They type nothing. Mia
opens the app at 9pm and the last line of the card says: *Get your feet there
before the ball, then set — don't reach.* Thursday, the coach opens Mia's last
session on the sideline and reads the same line back before the first drill.

**Complexity** Low
**Expected impact** High
**Confidence** Medium-High

**Evidence**
Hattie & Timperley, *The Power of Feedback*, Review of Educational Research
77(1), 2007 — feedback operates on three questions, "Where am I going?", "How
am I going?" and "Where to next?", and the review's finding is that the
*feed-forward* question is the one most often omitted and the one most strongly
associated with improved performance; feedback at the task and process level
outperforms feedback about the person. CoachVoice currently answers question
two and leaves question three in a field nobody fills in. Choosing exactly one
point rather than a list is consistent with the augmented-feedback literature
on limiting information to what the learner can act on in the next practice
bout (Wulf & Shea), but the specific "one line, on the home card" rendering is
**design/coaching judgement, not research**. What would settle it: after four
weeks, what share of sessions produce a non-empty extracted line, and what
share of those a coach deletes or rewrites. If coaches rewrite most of them,
the extraction is wrong and this becomes a coach-review step in the recorder's
step 2 instead.

**Scores** Impact 4/5 · User value 5/5 · Effort 2/5 · MVP relevance 5/5 · Confidence 4/5
**Priority** (4 × 5 × 5 × 4) / 2 = 200

**MVP verdict** BUILD NOW

*No secondary recommendation. Nothing else in the data surface justifies adding
anything: there is no quantitative session data and the agent explicitly
declined to propose a capture surface to create some; the wellness check-in
earns its place as it stands.*

*Filed as an observation, not a recommendation:* the athlete's session list
orders by `created_at` only (`app/athlete/page.tsx:181`), while every coach-side
query now orders by `session_date` first (`app/api/sessions/route.ts:126-128`,
`app/api/sessions/all/route.ts:50-52`). After `020fc70` a coach who backdates a
session sees it in the right place; the athlete sees it at the top of their list
as if it happened tonight.

────────────────────────────────────────────────────────────
⚡ UX & USABILITY
────────────────────────────────────────────────────────────

**ID** UX-001

**Friction identified**
The recorder pre-selects an athlete the coach never chose, and there is no way
to undo the result.

`app/components/QuickSessionModal.tsx:32`
```ts
const [athleteId, setAthleteId] = useState(defaultAthleteId ?? athletes[0]?.id ?? '')
```

Every generic entry point passes no `defaultAthleteId` — the mobile FAB
(`app/dashboard/page.tsx:1586`), the sidebar Record button (`:821`), and the
three home/sessions CTAs (`:1052`, `:1213`, `:1431`) all call
`setQuickSessionAthleteId(undefined)` first. Only the athlete row on the
Athletes tab (`:1299`) and the athlete profile page
(`app/athletes/[id]/page.tsx:608`) pass a real id.

So from the FAB — the single most-used control in the app — the `<select>` at
`QuickSessionModal.tsx:349-357` opens already showing a real athlete's name,
fully valid, styled exactly as a deliberate choice. `athletes[0]` is not a
stable or meaningful athlete: `app/api/athletes/route.ts:27` orders by
`created_at` descending, and `app/dashboard/page.tsx:511` stores that order
verbatim. The silent default is therefore *the most recently added athlete*,
and it changes identity every time the coach adds someone to the roster. Groups
have the same defect (`QuickSessionModal.tsx:33`, `app/api/groups/route.ts:34`).

Three things make this the highest-severity item on the surface rather than a
papercut:

1. `shareWithAthlete` defaults to `true` (`QuickSessionModal.tsx:44`), so on
   save `app/api/sessions/route.ts:242-243` immediately emails the wrong
   athlete and their caretakers.
2. `athlete_id` is not in the PATCH allow-list at
   `app/api/sessions/[id]/route.ts:40` — a session cannot be reassigned.
3. There is **no session delete anywhere in the app**.
   `app/api/sessions/[id]/route.ts` exports only `PATCH`; the only DELETE
   routes under `app/api/sessions/` are `videos` and `attachments`.

A mis-targeted session is permanent, visible to the wrong 14-year-old, and
already in their inbox. The guard that exists (`QuickSessionModal.tsx:195`,
`setError('Select an athlete.')`) is unreachable in exactly the case that
matters, because the default guarantees `athleteId` is truthy.

**Current workflow**
Dashboard → FAB (`dashboard/page.tsx:1586`) → modal opens with a name already
in the field → tap `<select>` → drag the wheel → tap Done → Start Recording
(`QuickSessionModal.tsx:434`) → Stop & Transcribe (`:424`) → Save (`:539`)
= **6 taps + 1 drag** (7 discrete touches on iOS, where a `<select>` is a wheel
plus a Done button).

**Proposed workflow**
Dashboard → FAB → tap the athlete's name → Start Recording → Stop & Transcribe
→ Save = **5 taps, no drag.**

**Change recommended**
In `QuickSessionModal.tsx`, all outside the protected recording path
(`startRecording`, `stopAndTranscribe`, MIME detection and FormData
construction are untouched):

1. `:32` and `:33` — drop the `?? athletes[0]?.id` and `?? groups[0]?.id`
   fallbacks. Opened without a target, the modal opens with no target.
2. `:349-357` — replace the native `<select>` with a wrapping row of athlete
   name chips inside a fixed-height scrollable region (~120 px), one tap to
   select, selected chip filled in `--primary` like the existing
   Individual/Group toggle at `:311-339` so the pattern is already familiar in
   this modal. Same treatment for the group `<select>` at `:361-369`.
3. `:434` — disable Start Recording while no target is selected. The chips are
   then the only live control in the modal, which is what makes the required
   choice self-evident. No instructional sentence is added; the existing
   empty-roster message at `:344-347` already covers the zero-athlete case.
4. `defaultAthleteId` / `defaultGroupId` behaviour is unchanged — from an
   athlete row the chip arrives pre-selected and, unlike today, *visible
   without opening a control*.

If only one half ships, it is (1). The pre-selection is the defect; the chips
are what stop the fix from costing a tap.

**Why**
A default that is silently wrong is worse than no default — it converts an
omission into a confident assertion. Compounding it: **destructive-by-default
without an undo**. The interface makes an irreversible, externally-published
choice on the user's behalf, at the one moment they are least able to check it.
Secondarily, a native `<select>` is the wrong control for a small, known,
one-of-N set: it hides the current value's meaning behind an interaction and
costs a drag.

**Coach scenario**
Third set, timeout called. The coach lifts the phone, thumbs the FAB, hits
record, says twelve seconds about Mia's approach angle, stops, saves, pockets
the phone, and is back on the bench before play resumes. Total attention on the
screen: about four seconds, none of it on a small grey line of text that
already said a name. Two days ago they added a new player. That new player —
and her parents — now have an email containing a coaching note about Mia's
approach, and neither the coach nor anyone else can take it back or move it.
The coach will not find out; Mia will just never receive the session.

**Tap/time reduction**
6 taps + 1 drag → 5 taps on the FAB path. Roughly 1.5–2 s per session on iOS.
The wrong-athlete failure mode goes from silent and unrecoverable to
structurally impossible.

**Complexity** Low
**Expected impact** High
**Confidence** High

**Scores** Impact 5/5 · User value 5/5 · Effort 2/5 · MVP relevance 5/5 · Confidence 4/5
**Priority** (5 × 5 × 5 × 4) / 2 = **250**

**MVP verdict** BUILD NOW

*Also checked, not proposing:* the recorder's empty-roster state
(`:344-347`, correct); session date affordance (`:390-402`, `:505-518`, good);
the share-with-athlete default (`:44` — the right default, dangerous only
because it rides on the wrong athlete default); re-record (`:461-475`, correctly
clears transcript, audio path and mime). *Noted:* the modal backdrop
(`:283-293`) has no `overflow-y` and `.card-lg` (`globals.css:95-100`) no
max-height — the ~600 px review step may clip unscrollably on a short viewport
or with the keyboard raised. Real but unconfirmed from code alone; fold into
whoever next touches the file. *Not examined this run:* `/athlete`, messaging,
wellness, calendar, onboarding.

────────────────────────────────────────────────────────────
🎨 VISUAL DESIGN
────────────────────────────────────────────────────────────

**ID** DESIGN-001

**Design issue/opportunity**
The third live palette is not spread across the four big page files. It is
almost entirely inside one 135-line config, and it is the only palette in
CoachVoice whose colours are used as *text*.

`lib/wellness-config.ts:45-52` and `:90-95` define an eight-value
green/amber/red/grey scale in raw Tailwind defaults (`#10b981`, `#f59e0b`,
`#ef4444`, `#94a3b8`). Those four values are rendered as **type, not fill**, on
five surfaces: `app/dashboard/page.tsx:1131` (roster strip, 9.5 px/800);
`app/athletes/[id]/page.tsx:647` (11 px/800) and `:778` (30 px display serif);
`app/components/WellnessGraph.tsx:179-180` (20 px/800 and 10 px, both on a
`overallColor + '15'` tint) and `:98-100` (12 px/700).

Separately, `WELLNESS_METRICS[].colorMap` is **25 hex literals — 62% of the
whole palette — that render one at a time and only when a button is selected**
(`WellnessSubmit.tsx:64`, `:72`). At rest the athlete's check-in row is five
identical white buttons. The map is not a legibility aid; it is a
selected-state fill. And the value it maps to is already computed elsewhere:
`metricColor` (`:45-52`) buckets exactly the same way `colorMap` is ordered.
Two implementations of one idea, in one file, 40 lines apart.

**Recommended change**

1. **Add a four-role wellness scale to `app/globals.css`**, chosen so every
   site above clears AA on white *and* on its paired tint:

```
--wellness-good: #4F6B4B;  /* = --primary-dark */  pair --success-light #E6ECDF
--wellness-ok:   #7E5A1C;  /* deep ochre       */  pair --warning-light #F6E9CC
--wellness-low:  #A54034;  /* deep rust        */  pair --danger-light  #F4DED3
--wellness-none: #5D6661;  /* = --text-2       */  pair --border-soft   #EFEAE0
```

   Two of the four are existing tokens reused verbatim. The other two are
   deeper members of hue families the app already ships. **No new hue family is
   introduced.**
2. `lib/wellness-config.ts:45-52, 90-95` — return `var(--wellness-*)` instead
   of hexes; add a paired `…Tint()` returning the light token.
3. **Retire the alpha-string trick** at `WellnessGraph.tsx:158` (`+ '22'`),
   `:177` (`+ '15'`), `athletes/[id]/page.tsx:642` (`+ '18'`, `${wellnessColor}40`)
   in favour of the paired light token. Tokens rather than `color-mix()`:
   `color-mix` is Safari 16.2+, and this is a PWA young athletes open on
   whatever phone they have.
4. **Delete `colorMap`** from the interface (`:14`) and all five entries.
   −25 literals, −1 duplicated bucketing rule, and the selected button now means
   the same thing as the dot on the coach's roster.
5. **Neutrals in `WellnessGraph`**: `:36` `#e2e8f0`, `:37`/`:46` `#94a3b8`,
   `:90`/`:158` `#f1f5f9` → token equivalents. Cool slate greys in a warm ivory
   app.
6. **Two riders, droppable independently:** `dashboard/page.tsx:1131`
   `fontSize: 9.5 → 11`; `WellnessSubmit.tsx:70` `height: 40 → 44` (these are
   bare `<button>` elements with no `.btn` class, so the 44 px rule at
   `globals.css:528` never reaches them).

**Before**
Wellness numbers printed in saturated web-default green, amber and red that
belong to no CoachVoice palette, at 9.5–12 px, several on a tint of themselves.
On the athlete's daily check-in, tapping a score makes the digit *harder* to
read than leaving it untapped.

**After**
One scale, four roles, from the sage/ochre/rust family the rest of the app uses.
Every wellness number legible at its rendered size. The selected check-in
button, the dot on the coach's roster, the bar on the athlete profile and the
overall score chip are the same three colours meaning the same three things.
Palette count drops from three to two.

**Visual hierarchy**
*Coach roster strip (`dashboard/page.tsx:1114-1137`)* — the only at-a-glance
wellness read in the product. Should be: name and face, then "is anyone
struggling", then the unread badge. Today the 42 px avatar wins, then the
`#B55C3E` unread badge, and the wellness signal — a 6 px dot plus a 9.5 px
numeral — lands fourth, in the one colour on the card that isn't from the app's
palette. The saturation says "urgent", the size says "footnote", the hue says
"different product". Three signals disagreeing is why it reads as noise.

*Athlete check-in (`WellnessSubmit.tsx:54-86`)* — ordering is already right.
The failure is purely at the moment of interaction: the answer the athlete just
gave becomes the least legible thing on screen.

**Research/design rationale**

EVIDENCE (ratios computed by the agent, sRGB, WCAG 2.2 relative-luminance
formula; spot-checked independently by the orchestrator and confirmed):

Current values as text on `--card #FFFFFF`:

| Value | Role | On white | On `--bg` |
|---|---|---|---|
| `#10b981` | good | **2.54:1** | 2.39:1 |
| `#f59e0b` | ok | **2.15:1** | 2.03:1 |
| `#ef4444` | low | **3.76:1** | 3.55:1 |
| `#94a3b8` | no data | **2.56:1** | 2.42:1 |

On the self-tinted chips they actually sit on (`WellnessGraph.tsx:177`):
good 2.34:1, ok 2.02:1, low 3.39:1.

WCAG 2.2 SC 1.4.3 requires 4.5:1 normal, 3:1 large (≥18.66 px bold or ≥24 px).
Every site fails — including the two that qualify as large text
(`athletes/[id]:778` at 30 px, `WellnessGraph:179` at 20 px bold), which still
fall short of 3:1.

Proposed values, measured:

| Role | Value | On white | On paired tint | Today |
|---|---|---|---|---|
| good | `#4F6B4B` | **5.94:1** | 4.93:1 | 2.54 / 2.34 |
| ok | `#7E5A1C` | **6.24:1** | 5.18:1 | 2.15 / 2.02 |
| low | `#A54034` | **6.21:1** | 4.80:1 | 3.76 / 3.39 |
| none | `#5D6661` | **5.93:1** | 4.95:1 | 2.56 / — |

The check-in button (`WellnessSubmit.tsx:72-74`): the selected digit is
`--primary` at 15 px/800 on a `colorMap` tint. 15 px bold is *not* large text,
so it needs 4.5:1 and measures **2.99–3.48:1** across the seven tints in use.
Unselected it is `--text-2` on white = **5.93:1**. Selection degrades
legibility from pass to fail. Under the proposal: 4.80–5.18:1.

Type size: 9.5 px at `dashboard:1131` is below Apple HIG's smallest standard
style (Caption 2, 11 pt) and Material's label small (11 sp) — and it carries
the only health signal on the card. Touch target: `WellnessSubmit.tsx:70` is
40 px; Apple HIG 44, Material 48. WCAG 2.5.8 (24 px) is met, AAA 2.5.5 is not —
and the app's own `globals.css:528` asserts 44 px as the house rule, so this is
an internal inconsistency, not just a guideline miss.

The agent explicitly checked for and **did not claim** a SC 1.4.1 (Use of
Colour) failure: every colour-coded wellness site prints the numeral alongside,
so colour is redundant encoding, not sole encoding.

DESIGN OPINION (the agent's judgement, labelled as such): saturated
`#10b981`/`#f59e0b`/`#ef4444` on a parchment ground reads as a dashboard widget
dropped into a letter. The Letter Edition palette is CoachVoice's actual
differentiator, and the wellness screens are the one place a 13–18 year old
touches the product *daily*. Deeper, desaturated values also carry the right
tone for a teenager reporting they slept badly: a muted rust says "noted";
`#ef4444` says "alarm".

*What would change the agent's mind:* if the coach's real complaint is that low
wellness is too **easy to miss**, desaturating is the wrong direction and the
answer is structural — surfacing that athlete first in the strip, or a border on
the card — not a louder hue. That call belongs to Max, not to the pixels.

**Deliberately out of scope, named so it isn't rediscovered next week**
The five per-metric identity hues stay for now. They are strokes and fills in
the 30-day chart behind a toggle (`WellnessGraph.tsx:233-242`), the least-seen
surface in the area, and as fills they are governed by 3:1 (SC 1.4.11). The one
place they *are* text is the metric toggle pills (`:248-262`), measuring
2.00–3.78:1 — all failing. The clean fix moves the identity colour onto a dot or
border and sets pill text to `--text`/`--text-2`. Separate, smaller
recommendation; the agent chose to land the state scale first rather than bundle
two colour decisions into one review.

**Consistency impact**
Net reduction. Palettes 3 → 2. Non-token hex literals in the wellness surface
40 → 8. Implementations of "good / ok / low" 2 → 1. Ways of producing a
translucent status tint: string-concatenated alpha in three places → one token
pair. It also moves styling *toward* the token layer: afterwards, changing the
wellness scale is a four-line edit in `globals.css` instead of a hunt through a
config and three page files. And `#7E5A1C` gives the app the text-safe ochre it
has already needed twice — `globals.css:289` and `:293` both hardcode `#8B6621`
precisely because `--warning` is too light for type.

**Complexity** Low — roughly 14 lines across 5 files. Unusually cheap for
CoachVoice **because the wellness palette is the one part of the app that was
already centralised**; contrast `--text-muted`, scattered inline across four
1,200–1,800-line pages. No API route, no migration, nothing near the recording
path.

**Expected impact** Medium
**Confidence** High

**Scores** Impact 3/5 · User value 3/5 · Effort 2/5 · MVP relevance 3/5 · Confidence 5/5
**Priority** (3 × 3 × 3 × 5) / 2 = **67.5**

**MVP verdict** BUILD NOW

────────────────────────────────────────────────────────────
TODAY'S PRIORITY
────────────────────────────────────────────────────────────

## Cross-agent relationships

**DATA-001 and UX-001 are not the same change, but the order matters and it is
not the order the scores suggest.**

DATA-001 makes every saved session push *more* content to the athlete: a
directive line, in the coach's voice, on the athlete's home card. UX-001
establishes that a session can be attributed to the wrong athlete silently, and
that once that happens it can be neither deleted nor reassigned. Those two facts
compound. Shipping DATA-001 first widens the blast radius of a bug that is
already live — it means the wrong 14-year-old receives not just a recap but a
personal instruction, apparently from their coach.

Neither agent could see this; each is right within its own lane. This is the
one place the three reports genuinely join up.

**DESIGN-001 is independent** and should be treated as such. It touches the
wellness surface, which neither of the other two goes near. No merge, no
sequencing constraint — it can be built any time, by anyone, without waiting.

## Where I disagree with the agents

**UX-001's score is right; its proposal is bigger than its finding.** The defect
is the `?? athletes[0]?.id` fallback. The chip-picker is a real improvement but
it is a different, larger change, and bundling them means the two-character fix
waits on a UI decision. Split it: land the fallback removal now, treat the chips
as a follow-up.

**UX-001 also under-sells its own strongest finding.** "No session delete, no
reassign" is not context for the default bug — it is arguably the more important
gap, and it survives the proposed fix. A coach who records against the right
athlete and simply misspeaks has the same problem. That deserves its own ID on a
later run; the agent stayed in its lane, which was correct, but the synthesis
should not lose it.

**DATA-001's real risk is not the one it names.** The agent worried about
extraction accuracy and proposed a sensible four-week measurement. The sharper
risk is provenance: an LLM-derived imperative rendered on the athlete's home
card, in the coach's voice, with no visual signal that a model wrote it. The
coach may never see the line before the athlete does — the "delete it in one
tap" escape hatch at `/sessions/[id]` assumes the coach goes and looks, and the
whole premise of the recommendation is that they don't. Worth resolving before
build: either surface the extracted line in the recorder's step 2 where the
coach is already reviewing the transcript, or mark it visibly as a suggestion.

**All three priority scores are arithmetically sound** and I spot-checked the
design agent's contrast maths on three of its values (`#10b981`, `#4F6B4B`,
`#7E5A1C`) — all correct to two decimal places. The ranking they produce
matches my judgement, with the sequencing caveat above.

## #1 Recommendation today

**UX-001** — remove the silent athlete pre-selection in `QuickSessionModal`.

**Why it wins:** highest score (250), but that is not why. It is the only one of
the three where the current behaviour can do harm that cannot be undone — a
coaching note about one child, emailed to a different child and their parents,
with no delete and no reassign. It is also the cheapest: deleting
`?? athletes[0]?.id` and `?? groups[0]?.id` from two lines. High confidence,
directly on the MVP's core loop, and it is a precondition for shipping DATA-001
safely.

**Recommended action: BUILD** — the fallback removal only. Everything else on
this page stays advisory.

**Implementation outline**
1. `app/components/QuickSessionModal.tsx:32-33` — drop the `?? athletes[0]?.id`
   and `?? groups[0]?.id` fallbacks; both states start `''`.
2. Same file `:434` — disable Start Recording when the active mode has no
   target selected, so the required choice is visible rather than enforced at
   save time.
3. Verify the existing guard at `:195` now actually fires, and that the
   empty-roster branch at `:344-347` still renders.
4. Nothing in `startRecording`, `stopAndTranscribe`, MIME detection or FormData
   is touched — the protected path is untouched by design.
5. `npx tsc --noEmit && npm run lint && npm run build`, then open the modal from
   the FAB and confirm no athlete is pre-selected, and from an athlete row and
   confirm that one still is.

**Then, in order:** resolve DATA-001's provenance question and build it;
DESIGN-001 whenever convenient, ideally alongside the `--text-muted` item in
"Not yet reviewed" since both are "a colour in this app is too light to read"
and share a token block and a visual sweep.
