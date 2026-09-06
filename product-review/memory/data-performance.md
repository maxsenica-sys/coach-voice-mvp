# Data & Performance agent — memory

Append-only. Newest entry at the top, under the heading. One entry per review.
Read this before proposing anything: an idea recorded as REJECTED here does not
come back unless new evidence exists, the app has materially changed, or another
change has created a reason to revisit it.

Entry shape:

```
## YYYY-MM-DD — DATA-0NN — <one line>
Status: PROPOSED | TESTING | APPROVED | IMPLEMENTED | BACKLOG | REJECTED | SUPERSEDED
Verdict at proposal: BUILD NOW / TEST / BACKLOG / REJECT
Priority: (I × UV × MVP × C) / E = _
Grounded in: <files and lines the claim rests on>
Evidence: <source, or "judgement">
Outcome: <filled in when Max decides — and why, which is the part that matters>
```

---

## 2026-09-06 — DATA-002 — Show the coach the last focus point at the moment they press record
Status: PROPOSED
Verdict at proposal: BUILD NOW
Priority: (4 x 4 x 4 x 4) / 2 = 128
Grounded in: `focus_points` renders on `/sessions/[id]` and nowhere else — zero matches in
  `app/athletes/[id]/page.tsx`, `app/dashboard/page.tsx`, `/api/sessions/all` and the
  monthly PDF (orchestrator verified all four). `GET /api/sessions` already returns the
  column (`app/api/sessions/route.ts:164`), so no new route is needed.
Evidence: Locke & Latham 2002 — feedback moderates the goal-performance relationship;
  goals without progress feedback do not change behaviour. The 30-day staleness cutoff and
  the read-only choice are judgement.
Note: touches QuickSessionModal (protected). Step-1 presentational UI only. Needs explicit
  approval, not an agent's judgement.
Outcome: awaiting Max

## 2026-09-06 — DATA-003 — STRETCH: The Thread
Status: PROPOSED · Verdict: TEST
The bet: 6-10 transcripts to GPT-4o-mini, three sentences on what changed, coach-gated in
draft. The monthly PDF is a photocopier and cannot answer "is she getting better?".
Serious risk: a transcript corpus has no ground truth about improvement, only about what
was said. A confidently wrong verdict to a 14-year-old is worse than silence.
**Check before building anything:** do coaches record the same athlete 6x a month? That is
queryable today. If not, the whole idea is moot.
Outcome: awaiting Max

## 2026-09-06 — Challenge and cut
Challenge: wellness collects five numbers and `computeWellnessAlert` flattens them to one
mean, so the coach is told "2.6/5" without being told which metric caused it.
Cut: the duplicated truncated summary on the athlete's sessions hero card.
(UX independently proposed cutting the same card. Two agents, separate contexts.)

## 2026-09-05 — DATA-001 — Extract one "what to work on next" line from the transcript and show it on the athlete's home card
Status: IMPLEMENTED (2026-09-05, same day)
Verdict at proposal: BUILD NOW
Priority: (4 x 5 x 5 x 4) / 2 = 200
Grounded in: `supabase/migrations/019_session_detail_fields.sql:19-22` (focus_points is
  meant to be the carry-forward field) · `app/api/sessions/route.ts:201-218` (the save
  path never writes it) · `app/sessions/[id]/page.tsx:420-470` (its only render site) ·
  `app/athlete/page.tsx:178` (not in the athlete's select), `:786` and `:854` (the athlete
  gets the same summary truncated at 120 and 140 chars)
Evidence: Hattie & Timperley, *The Power of Feedback*, RER 77(1) 2007 — "where to next"
  is the most-omitted and most performance-associated of the three feedback questions.
  One point rather than a list follows Wulf & Shea on augmented-feedback load. The
  "one line on the home card" rendering is judgement, not research.
Open risk (raised in synthesis, not by this agent): the extracted line is LLM-written but
  appears in the coach's voice with no provenance marker, and the coach may never see it
  before the athlete does. Resolve before build — surface it in the recorder's step 2, or
  mark it as a suggestion.
Validation proposed: after four weeks, what share of sessions produce a non-empty line,
  and what share of those a coach deletes or rewrites. Heavy rewriting means the
  extraction is wrong and this becomes a coach-review step instead.
Outcome: APPROVED and BUILT. `makeQuickSummary` now returns `{summary, next}`; the
  prompt asks for a trailing `NEXT:` line and to omit it entirely when the coach said
  nothing forward-looking. The line is dropped server-side if empty, over 120 chars, or a
  "none"/"n/a" placeholder — a bad instruction shown to a 14-year-old is worse than none.
  Written to `focus_points` on insert and rendered on the athlete's home card under
  "Take into next session".
  Provenance was handled by *not* presenting it as the coach speaking: the summary above
  it is rendered in quotation marks, the next-session line is unquoted and under its own
  label. The coach's existing edit/delete path on /sessions/[id] is unchanged.
  **Still to do: the four-week validation this agent proposed** — what share of sessions
  produce a line, and what share a coach rewrites. Nobody has run it yet. If coaches
  rewrite most of them, revisit as a coach-review step in the recorder's step 2.

## 2026-09-05 — Considered and NOT proposed
- **A quantitative capture surface** (reps, attempts, success rates). There is no
  quantitative session data in CoachVoice and the agent declined to propose creating
  any: it costs the coach taps in the exact moment they have none, and usually produces
  data nobody reads. The voice loop is the asset. Revisit only with evidence a coach
  wants it.
- **Changing the wellness check-in.** Five 1-5 taps, athlete-entered, drives the
  caretaker alert. Earns its place as it stands.

## 2026-09-05 — Observation, not a recommendation
`app/athlete/page.tsx:181` orders the athlete's sessions by `created_at`, while the coach
side orders by `session_date` (`app/api/sessions/route.ts:126-128`,
`app/api/sessions/all/route.ts:50-52`). Since `020fc70` a backdated session appears at the
top of the athlete's list as if it happened tonight. This is a bug for whoever owns it.
