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

## 2026-09-06 — WOW-001 — Hear It: the coach's actual voice, cut to the sentence
Status: PROPOSED
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
Outcome: awaiting Max

## 2026-09-06 — Three more, unargued
1. One squad recording split by the model into eleven individually-targeted sessions.
2. `/` sign-in becomes one consenting coach's real eight-second clip, playing on tap.
3. The athlete's first authored artefact: a 15-second voice reply on a focus point, sealed
   until the coach next opens the recorder for them.

