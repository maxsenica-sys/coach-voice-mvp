# Wow Factor agent — memory

Append-only. Newest entry at the top. One entry per review.

This agent is scored differently from the other three: its ideas are *expected*
to lose on the priority formula. Judge its entries on whether any of them turned
out to be the thing that made CoachVoice matter — not on hit rate.

Entry shape:

```
## YYYY-MM-DD — WOW-0NN — <one line>
Status: PROPOSED | PROTOTYPING | APPROVED | IMPLEMENTED | BACKLOG | REJECTED | SUPERSEDED
Verdict at proposal: BUILD NOW / PROTOTYPE / BACKLOG / REJECT
Cheapest version: <the one-day test>
Safeguarding: <how it sits with the minors rules, and what changed to get there>
Outcome: <filled in when Max decides — especially WHY, so the idea can evolve
          rather than just die>
```

---

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

## 2026-09-06 — WOW-002 — "The Line"
Status: PROPOSED · Verdict: PROTOTYPE
Priority: (4 x 2 x 2 x 4) / 3 = 21.3 — and it argued with the score correctly: "user value
2 is right, this screen does not make an athlete better. But the formula has NO TERM FOR
ACQUISITION, and this is the only screen whose user does not yet have an account."
The idea: one continuous stroke that is a waveform, a silhouette and the logo in that order,
4.5s, driven by a real coach's real 8s recording — playing SILENT, and the silence is the
hook. At the three loudest peaks the stroke swells into an athlete silhouette and relaxes
back: sound and sport are literally the same line.
THE MECHANISM (this is the good part): browsers block autoplay audio until a gesture. A
silent app treats that as a tax; a voice-first app treats it as a CLIFFHANGER — the silent
version shows you THAT someone is speaking and WHAT they said, and withholds HOW. The
gesture that unlocks the audio is the gesture that opens the door.
Flash-safe BY CONSTRUCTION: no luminance transitions at all, only a stroke morphing on a
static ground, ~0.7 shape-changes/second.
Spread: not the animation — animations get a screenshot and die. This gets SCREEN-RECORDED,
because the payload is the coach's sentence, not the app. What gets sent to the WhatsApp
group is "listen to how she says this" — sharing coaching craft, with the app as wrapper.
Phase 2: coaches submit their own 8 seconds, a human picks one a week, "that's me on the
login screen" goes in the club chat. Moat: a rival can shoot an ad but cannot have 200 real
coaches' sentences.
Safeguarding: KILLED its own first version again — the clip named a real minor ("Ana — that
third set...") in an adult's assessment of her performance on the one unauthenticated page,
permanently. Dead. Survivors: second person only, NO athlete name ever; consent from athlete
AND registered caretaker for the specific clip on top of the coach's; the named party is the
adult; no club/squad/age identifier; coach-only submission; human review; zero wellness data,
faces or minors' names; no engagement mechanic at all.
KILL CONDITION, stated plainly: if Max cannot find one genuinely excellent 8 seconds, this
should not ship AT ALL. The clip IS the thesis statement — if it is bland, the product looks
bland permanently on its most-viewed screen.
Cheapest version: /dev/frontdoor, one day, already covered by the /dev coach-only route.
Hand a phone to two coaches WITH THE SOUND OFF and watch whether they tap. Worth the other
90% only if someone taps a second time.
Outcome: awaiting Max — and the real blocker is a recording, not code.

## 2026-09-06 — Three more, unargued (round 3)
1. A returning coach's cold launch draws the waveform of the last thing THEY said to an
   athlete, silent, 1.2s, as the loading state. Their own voice as the splash screen.
2. Coaches submit their own 8 seconds to the front door; a human picks one a week.
3. An invite link carries `?s=volleyball` so the front door morphs into THEIR sport before
   they have typed a character.

## 2026-09-06 — WOW-001 — Hear It: the coach's actual voice, cut to the sentence
Status: PROTOTYPING (prototype built 2026-09-06)
Verdict at proposal: PROTOTYPE
Priority: (5 x 5 x 2 x 3) / 4 = 37.5 — and the agent argued with the MVP-relevance term
rather than the formula, correctly.
The verified fact the whole idea rests on: `/api/transcribe` asks Whisper for
`verbose_json` and returns `segments` with timestamps
(`app/api/transcribe/route.ts:75,102`), and NOTHING consumes them — those two lines are the
only occurrences of `segments` in the repo; `QuickSessionModal:174` reads `json.text` and
drops the rest. Orchestrator verified by grep across app/ and lib/.
Second observation: `app/athlete/page.tsx:797` renders the model's paraphrase inside curly
quotation marks, as the coach's direct speech, to a child.
Cheapest version: `/dev/hearit`, one day, two existing routes unmodified plus one throwaway
page — tap a transcript sentence, hear that sentence. Show three coaches. If nobody says
"do that again", close it.
Safeguarding: KILLED its own first version (athlete-facing share-to-Instagram button —
a minor pushing her name and an adult's assessment of her into public). The surviving
version is coach-rendered, coach-released, delivered by email to athlete and registered
caretaker, never a URL, only that athlete's own sessions, no cross-athlete comparison, no
wellness data in any audio artefact, no streaks or nudges. It also raised a consent
question the hard limits did not cover: "stored for transcription" is not the same consent
as "playable by a fifteen-year-old and embeddable in a video sent to her mother".
Risk it named and could not solve: raw audio does not launder the coach. Some coaches will
be embarrassed to hear themselves played back to a teenager, and a few will be right to be.
Gateable, not solvable — voice sharing needs its own consent, defaulting off, separate from
the existing `shared_with_athlete` toggle.
Outcome: PROTOTYPE BUILT the same day at /dev/hearit (coach-only, added to the proxy's
  COACH_ROUTES). It stands on the two existing routes unmodified: POST /api/transcribe
  already accepts `audio_path` and enforces `coach/<uid>/` ownership, and
  GET /api/sessions/[id]/audio-url returns the signed URL and mime. No migration, no
  schema change, no write, nothing in the protected recording path. It guards the known
  iOS failure with a canPlayType check rather than showing a dead player, and it says
  plainly in the UI that it re-transcribes and costs a Whisper call.
  **The decision point is now three coaches' faces, not another agent run.** If nobody
  asks to hear it again, close this rather than backlogging it.

## 2026-09-06 — Three more, unargued
1. One squad recording split by the model into eleven individually-targeted sessions.
2. `/` sign-in becomes one consenting coach's real eight-second clip, playing on tap.
3. The athlete's first authored artefact: a 15-second voice reply on a focus point, sealed
   until the coach next opens the recorder for them.

---

## 2026-09-09 — WOW-003 · The Callback

**Proposed, PROTOTYPE.** Priority 24 — and it is meant to lose the arithmetic.
**Chosen as #1 ambition by the orchestrator.**

The gap: CoachVoice has no memory. A `NEXT:` line is written to `focus_points`
(`app/api/sessions/route.ts:242,256`), rendered twice, and then dies.
`QuickSessionModal` fetches no prior session data at all. Nobody ever finds out
whether what the coach said landed. So the honest description is "it turns my talking
into notes for the kid" — a transcription utility, and CoachNow already does that at
a million users.

The idea: make a focus point a durable thread. `sessions.segments jsonb` (022) +
`focus_threads` (023); teach `makeQuickSummary` to receive 1–3 open threads and
return `TOUCHED: <id> | landed|progress|struggling | <verbatim sentence>`. **The
verbatim requirement is the mechanism, not a style rule** — a quote that is not a
substring of the transcript is dropped (fabrication guard), and one that is maps
straight onto a Whisper segment and therefore an audio offset. No alignment work.
Payoff: after Save the coach lands on the Callback — three to five dated rows of her
*own voice*, each playable, all about one thing. One button: send it.

Moat: everyone else in this market competes on video, which requires the coach to
deliberately shoot and tag. Nobody threads the spoken cue, because nobody else has a
per-athlete longitudinal voice corpus accruing as a byproduct of normal behaviour.
And it backfills from `transcript` rows already in Postgres — full on day one.

Safeguarding: my first version was a shareable vertical video. **Killed outright on
the first hard limit** — a minor's name plus an adult's assessment of her performance,
pushed to a public surface by the minor herself. What survives is email-only to
athlete + registered caretakers, coach-gated, athlete's own content only, zero
wellness data, no streaks, adults carry the virality. `struggling` is coach-only and
phrased as a note about the coaching, never about the kid.

**Cheapest version: `/dev/callback`, one day.** `/dev` auth already exists from
WOW-001. One gpt-4o-mini call over one real athlete's existing transcripts, text only,
no schema, no writes. It answers the only question that gates the build: does the
model find a real thread, or invent a flattering one? Then show one coach her own
athlete. **The test is not whether she likes it — it is whether she asks to send it to
the athlete's mum.** If she doesn't, close this rather than backlog it.

Absorbs rather than competes with the register: DATA-002 (128, unbuilt) is its step 1;
WOW-001's segment persistence is its dependency; DATA-003 is aiming at the same
territory and thinking too small — a season summary is a document nobody asked for,
while closing *one* loop is an event.

**The orchestrator's synthesis put this and DATA-006 on the same thesis** — CoachVoice
is a one-way pipe and nothing in it closes a loop — with DATA-006 as the one-day
version and this as the three-week version. Worth remembering: the strongest case for
an ambitious idea here was that a conservative agent independently found the same
structural fact on a different screen.

---

## Round 5 — 2026-09-09b · net-new additions, one-hour budget

Constrained the way I am normally told not to be: the cheapest version that still
wows, as the whole proposal. It worked better than my usual output — the top idea
scored 240 and shipped the same day.

**WOW-004 "Team Talk" (240) — BUILT.** A squad recording fans out to one save per
member, each running the same summariser over the same transcript with the same
prompt: eleven model calls, eleven copies of one paragraph, eleven emails saying
the same thing. The expensive part was already built and was being wasted. Each
athlete's summary now leads with the part of the talk that was about them.

The load-bearing piece is the gate, and it belongs in code rather than in the
prompt: no name in the transcript, no personalisation, and the prompt reverts
character-for-character to the one that shipped before. Asking a model to "write
this for Ana" over a transcript that never mentions Ana is an invitation to invent
a coaching instruction and address it to a named child. The implementation caught
something I did not specify — a naive word-boundary test matches "Ana" inside
"Anastasia" and "banana", and `\b` is useless for "Zoë" or "Łukasz".

**WOW-005 "Where your voice went" (64) — SUPERSEDED by DATA-008.** Two other agents
proposed the same underlying question this round. Mine was the version with a bar
chart of a volunteer coach's neglect attached, and the shaming risk I flagged as
"the real one" is exactly why the simpler framing won. Keep flagging it; also
notice that the flag was a reason to change the design, not just to caveat it.

**The finding I am most pleased with is not a proposal:** a group session shows
every member the whole squad transcript, so a critical remark about one named child
is readable by ten others. Team Talk reduces the summary half and does not touch
it. Named rather than smuggled into the hour.
