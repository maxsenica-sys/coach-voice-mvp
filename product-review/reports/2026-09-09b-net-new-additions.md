COACH VOICE — PRODUCT REVIEW, ROUND 5

Date: 2026-09-09 (second run of the day)
Reviewed against: 9f5a84d Record the round-4 follow-through and close the soreness note
Brief: net-new additions only, 3–4 of them, 30–60 minutes each

This run was scoped differently from every previous one. Max asked for
capabilities that **do not exist yet** — not contrast fixes, not tap-count
reductions on flows that already work, not token migrations. Each of the four
agents was given the same constraint: two new capabilities, nothing already on
the register, each costed honestly at 30–60 minutes of coding.

The wow agent was constrained in the way it is normally told *not* to be. Its
standing brief is to ignore MVP caution; this time it was asked for the most
remarkable thing that genuinely fits in an hour. Its "cheapest version that
still wows" framing became the whole proposal rather than a footnote.

────────────────────────────────
📊 DATA & PERFORMANCE

**DATA-008 — "Quiet lately"** · priority 128 · BUILD NOW · 45–55 min

The coach's home says how many sessions they recorded this week. Nothing
anywhere says *who got none*, so the next recording goes to whoever is top of
the list rather than whoever has gone longest without hearing anything.

The agent then found the part that made this a server-side job rather than a
client-side reduce. `fetchAllSessions` requests `limit: '50'`, so `allSessions`
is the 50 most recent sessions across the *whole roster*. The roster cards
compute "Last session" with `allSessions.find(s => s.athlete_id === a.id)` and a
total with `.filter(...).length`. For any athlete whose last session falls
outside that window, `find` returns undefined and the card reads **"No sessions
yet" for an athlete who has plenty** — and that is exactly the athlete this
feature exists to surface. A twelve-player squad recorded twice a week exhausts
50 sessions in about three weeks.

Evidence offered, and the agent was careful about what it does not say: the
coach-expectancy literature (Rejeski, Darracott & Hutslar 1979; Horn 1984)
supports "coach–athlete interaction is unevenly distributed and invisible to the
coach making it". It does **not** support any claim about which way the skew
runs. That supports showing the coach the distribution, nothing more.

**DATA-009 — "How they came in"** · priority 96 · BUILD NOW · 30–40 min

Verified: `grep -rn "wellness" app/sessions/ app/api/sessions/` returns zero
matches. The athlete answers five questions a day; on the coach's side that data
has exactly two destinations, a graph on a separate page and the caretaker alert
email. It never informs the reading of a single session. Put the check-in from
the morning of a session next to that session, so a coach reviewing a flat
performance can tell a technique problem from a fatigue problem.

Three metrics only — `mood` and `stress` excluded, because putting a teenager's
mood score next to a coach's performance note invites a causal reading a coach
is not qualified to make. Nothing rendered on a day with no check-in, because a
"did not check in" row turns a coaching tool into a compliance report about a
child.

────────────────────────────────
⚡ UX & USABILITY

**UX-009 — "The Receipt"** · priority 150 · BUILD NOW · 35–45 min

The app's most consequential action happens in silence. `QuickSessionModal`'s
entire post-save experience is `onSaved(); onClose()`. In that instant the
server inserted a session row, created a calendar event and — because
`shared_with_athlete` **defaults to true** — sent an email to a minor. The coach
is told none of it. The modal disappears and returns them to an unchanged
screen. The app already has a toast system; the session save is the one action
that never uses it.

The agent corrected its own memory file in the process: an earlier entry claimed
the save emails "the athlete and caretakers". It emails the athlete only.
Caretakers are on the wellness-alert path. Any copy built on that note would
have been wrong.

It also declined to offer an Undo, on the grounds that there is no DELETE on
`/api/sessions/[id]` and a receipt offering an undo it cannot honour is a worse
lie than silence.

**UX-008 — "Record next"** · priority 128 · BUILD NOW · 45–55 min

A strip of the athletes the coach has recorded nothing for, ordered by how long
it has been, each tapping straight into the recorder pre-targeted. Four taps
become two. The property the agent cared about most: **it renders nothing when
the list is empty**. No "all caught up!" panel, no praise. The absence is the
reward.

It flagged its own limitation honestly — the client-side computation inherits
the same 50-session ceiling, and an athlete outside that window reads as
never-recorded.

────────────────────────────────
🎨 VISUAL DESIGN

**DESIGN-008 — "The Spine"** · priority 72 · BUILD NOW · 40 min

The app has never had a longitudinal view of anything. The athlete gets three
cards and an integer; the coach gets a count for the current week. The coach's
athlete profile fetches *every* session for that athlete and the overview tab
renders none of them.

Twelve weekly bars, from data both render sites already hold. Contrast computed
and stated: `--primary-dark` on `--border-soft` is 4.95:1 against the 3:1 that
WCAG 1.4.11 requires for a graphical object whose distinction carries meaning.
The agent validated its own method by reproducing `--primary-dark` on white at
5.94:1, the figure already recorded in PROJECT-STATE.

Two judgements it labelled as judgements rather than findings. Weeks, not a
GitHub-style daily grid: at two sessions a week that grid is 84 cells with 24
filled, and a mostly-empty board reads as failure to a fifteen-year-old. And no
streak counter, because a coach's holiday should not become the athlete's
failure.

**DESIGN-009 — "The Focus Card"** · priority 18 · TEST · 55 min

Render the focus point as a 1080×1350 image in the ink palette, for the
athlete's lock screen. The product's single most important sentence currently
has the visual weight of a caption. CoachVoice has no *object* — nothing anyone
can hold up or keep — and a generated image is the only way to have one without
opening a public surface.

The agent attached the safeguarding question itself rather than being asked: the
image carries no name, no photo, no URL and no session id, but it is still a
coaching note about a minor that can be sent anywhere, and that is a
duty-of-care call for Max, not a design call.

────────────────────────────────
🚀 WOW FACTOR

**WOW-004 — "Team Talk"** · priority 240 · BUILD NOW · 35–45 min

A squad recording fans out to one `POST /api/sessions` per member. Each call
runs the same summariser over **the same transcript** with **the same prompt**.
A coach who talks for four minutes about eleven athletes pays for eleven
GPT-4o-mini calls and receives eleven copies of one paragraph. Eleven emails go
out saying the same thing. To Ana, the summary is about the squad; nothing in it
is about Ana.

The app was already spending the money. It was producing one answer eleven
times.

Make each athlete's summary lead with the part of the talk that was about them,
gated on their name actually appearing in the transcript — a deterministic test
in code, not an instruction to the model, because asking a model to "write this
for Ana" over a transcript that never mentions Ana invites it to invent a point
and attribute it to a named child.

This is the highest priority score any idea has received on this register except
UX-002, and the arithmetic is not wrong: the expensive part was already built
and was being wasted.

**WOW-005 — "Where your voice went"** · priority 64 · BUILD NOW · 50–60 min

Minutes of recorded voice per athlete, as a mirror of the coach's own behaviour.
Precedent: TeachFX does this for classrooms and teachers evangelise it because
the number is about *them* and is uncomfortable in a useful way.

The agent named the risk itself: a bar chart of a volunteer coach's neglect is
not a gift, and words-per-minute is a poor proxy that must never be presented as
a quality measure. It also cut its own first sketch — a "your rank in the club"
line — because comparison between coaches invites comparison between their kids.

*Three more, unargued:* pre-select the athlete chip by scanning the returned
transcript for roster names · one line on the athlete's home telling them how
many minutes their coach has recorded about them, their own number only · the
athlete's sport silhouette filling from the feet up as the season accrues.

────────────────────────────────
CHALLENGES TO THE STATUS QUO

Collected, unresolved, for Max to react to.

- The 50-session ceiling on `fetchAllSessions` is treated as "all sessions" by
  three derived values, and the roster cards silently misreport for busy
  coaches. *(data-performance, and independently ux-usability)*
- `overallWellnessScore` averages five non-commensurate ordinal items, so 5/5
  energy cancels 1/5 soreness — and it is the input to the caretaker alert. The
  round-4 fix corrected the *sign* of that mean; it did not make the mean a
  defensible thing to compute. *(data-performance, repeated from round 4)*
- `shared_with_athlete` defaults ON while the coach gets no confirmation
  anything was shared: the most irreversible default paired with the least
  visible outcome. *(ux-usability)*
- An athlete's avatar colour comes from their index in an array, so the same
  person is a different colour in different lists and everyone shifts when one
  athlete is added. *(visual-design)*
- **Cut:** the three stat cards on the coach's home — three tab-routers dressed
  as insight, on the most valuable strip of the screen. *(ux-usability)*
- **Cut:** the "Unread" stat tile — one of the three loudest objects on the
  screen, spending that weight to say "0". *(visual-design)*

────────────────────────────────
TODAY'S PRIORITY

**The convergence is the finding.** Three of the four agents, in separate
contexts, proposed the same feature:

| Agent | Called it | Shape |
|---|---|---|
| data-performance | Quiet lately | Server query, a card, threshold 14 days |
| ux-usability | Record next | Client reduce, a tappable strip, 4 taps → 2 |
| wow-factor | Where your voice went | Minutes per athlete, as a bar chart |

One question at three sizes: **the coach has no surface anywhere that says which
athlete has gone longest without hearing from them.** This is the second time
this system has produced a three-or-four-way convergence, and both times the
convergent item was the right thing to build.

They were built as one feature, not three. DATA-008 supplied the server query —
the only version that is correct, because both other agents' client-side
computation inherits the 50-session ceiling that makes the existing numbers
wrong. UX-008 supplied the interaction: the face *is* the button, and tapping it
opens the recorder already pointed at that athlete. WOW-005's minutes-per-athlete
bar chart was dropped — it is the same information with a shaming register
attached, which its own author identified as the real risk.

**Built today: four features.**

1. **Quiet lately** (DATA-008 + UX-008) — a new coverage route and a strip on
   the coach's home. Renders nothing when nobody is overdue.
2. **How they came in** (DATA-009) — the athlete's own morning check-in beside
   the session, coach-only, three metrics, silent on a missing day.
3. **The Spine** (DESIGN-008) — twelve weeks of training on both sides of the
   app, from one shared component.
4. **Team Talk** (WOW-004) — a squad recording now produces a different summary
   for each athlete, gated on their name being in the transcript.

**Not built: UX-009 (The Receipt), at priority 150.** It is the strongest thing
now sitting unbuilt on the register, and it lost this round on a technicality —
it repairs a gap in an existing flow rather than adding a capability, and this
run was explicitly scoped to net-new additions. It should be first next time.

**Two bugs were found by testing rather than by reading**, both in code written
this round, and neither would have been caught by `tsc`, `lint` or `next build`:

- The twelve-week bucketing was wrong across a daylight saving transition. A
  session on Monday 29 March 2027 landed in the previous week's bucket in
  `Europe/London` and `America/New_York` while passing in `UTC` — so CI, which
  runs in UTC, would have shipped it green and it would have been wrong for most
  users twice a year. Fixed with a `calendarDaysBetween` helper now shared by
  both new features, and verified across six timezones.
- The name gate matched substrings, so "Ana" would have matched "Anastasia" and
  "banana". Caught before shipping and covered by tests for substrings, accents,
  Cyrillic, possessives and regex metacharacters in a name.

The pattern is worth recording: **this project's checks pass on every bug it has
ever had.** That was already true of the startup bugs, which is why the boot
harness exists. It is equally true of date arithmetic and of anything whose
correctness depends on the timezone the code happens to run in.

────────────────────────────────
ONE FINDING THAT IS NOT A PROPOSAL

Surfaced by the wow agent while verifying Team Talk, and filed to the register's
"Not yet reviewed" list as **safeguarding**:

> **A group session shows every member the whole squad transcript.** The
> identical `transcript` is written to one session row per member, and the
> athlete page renders it under "View full transcript". If a coach says "Ellie,
> that block was lazy, you switched off", ten other teenagers can read that
> sentence about Ellie. Today.

Team Talk reduces the *summary* half of this — the prompt now forbids naming any
other athlete — but it does not touch the transcript underneath. Fixing that
needs a way to tell a group session from an individual one, which does not exist
(`sessions.group_id`), and a decision about whether athletes should see squad
transcripts at all. **It is arguably more urgent than anything built today, and
it is a product decision, so it was named rather than smuggled into the hour.**
