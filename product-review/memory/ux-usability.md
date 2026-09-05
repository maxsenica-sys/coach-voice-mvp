# UX & Usability agent — memory

Append-only. Newest entry at the top, under the heading. One entry per review.
Read this before proposing anything: an idea recorded as REJECTED here does not
come back unless new evidence exists, the app has materially changed, or another
change has created a reason to revisit it.

Entry shape:

```
## YYYY-MM-DD — UX-0NN — <one line>
Status: PROPOSED | TESTING | APPROVED | IMPLEMENTED | BACKLOG | REJECTED | SUPERSEDED
Verdict at proposal: BUILD NOW / TEST / BACKLOG / REJECT
Priority: (I × UV × MVP × C) / E = _
Grounded in: <files and lines the claim rests on>
Evidence: <source, or "judgement">
Outcome: <filled in when Max decides — and why, which is the part that matters>
```

---

## 2026-09-05 — UX-001 — The recorder silently pre-selects the most recently added athlete, and the result cannot be undone
Status: PROPOSED
Verdict at proposal: BUILD NOW
Priority: (5 x 5 x 5 x 4) / 2 = 250
Grounded in: `app/components/QuickSessionModal.tsx:32-33` (the `?? athletes[0]?.id`
  fallback) · `app/dashboard/page.tsx:1586, 821, 1052, 1213, 1431` (every generic entry
  point passes no defaultAthleteId) · `app/api/athletes/route.ts:27` (ordered
  `created_at desc`, so athletes[0] is the newest athlete and changes identity whenever
  the roster grows) · `QuickSessionModal.tsx:44` (share defaults true) ·
  `app/api/sessions/route.ts:242-243` (save emails the athlete and caretakers) ·
  `app/api/sessions/[id]/route.ts:40` (athlete_id not in the PATCH allow-list) and the
  same file exporting only PATCH (no session delete exists anywhere in the app)
Evidence: a silently wrong default converts an omission into a confident assertion;
  destructive-by-default without undo. Native `<select>` is the wrong control for a
  small known one-of-N set. All four load-bearing code claims independently verified by
  the orchestrator.
Synthesis note: the proposal is bigger than the finding. The defect is the fallback; the
  chip-picker is a separate, larger change. Ship (1) alone first — the agent said so
  itself.
Carried forward: **there is no session delete and no reassign.** That survives this fix
  and is arguably the larger gap — a coach who picks the right athlete and misspeaks has
  the same problem. Deserves its own ID on a later run.
Outcome: awaiting Max

## 2026-09-05 — Checked and explicitly found fine
- Recorder empty-roster state (`QuickSessionModal.tsx:344-347`) — real explanation, correct.
- Session date affordance (`:390-402`, `:505-518`) — defaults to today, capped at today,
  echoes Today/Yesterday/weekday, editable on both steps.
- Share-with-athlete default (`:44`) — the *right* default (27 of 40 sessions once reached
  nobody); dangerous only because it rides on the wrong athlete default.
- Re-record (`:461-475`) — correctly clears transcript, audio path, mime, and stops the
  lingering mic stream.

## 2026-09-05 — Noted, below the bar for its own ID
`QuickSessionModal`'s backdrop (`:283-293`) has no `overflow-y` and `.card-lg`
(`globals.css:95-100`) no max-height. The ~600 px review step may clip unscrollably on a
short viewport or with the keyboard raised. Could not be confirmed from code alone; a
one-line fix for whoever next touches the file.

Not examined this run: `/athlete`, messaging, wellness, calendar, onboarding.
