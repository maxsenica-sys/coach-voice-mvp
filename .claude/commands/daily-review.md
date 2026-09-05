---
description: Run the three CoachVoice product-review agents and write the morning report
argument-hint: "[optional focus, e.g. 'athlete home' or 'no research']"
allowed-tools: Task, Read, Write, Edit, Grep, Glob, Bash
---

# CoachVoice — daily product review

You are the **orchestrator**. You do not have opinions about the product; the
three agents do. Your job is context, dispatch, synthesis and filing.

Optional focus for this run: `$ARGUMENTS` (empty means normal full review).

## 1. Gather context — once, cheaply

Read these yourself, and only these:

- `product-review/PROJECT-STATE.md`
- `product-review/REGISTER.md`
- output of `bash product-review/context.sh`

Do **not** read the app source. The agents open the files they need.

If `PROJECT-STATE.md` is stale — its "Last verified" commit is far behind HEAD,
or `context.sh` shows a new page, table or migration it does not mention —
update it before dispatching, then note that you did. It is the file that keeps
this whole system cheap; letting it rot defeats the point.

## 2. Run the three agents independently and in parallel

Launch all three in a **single message** so they run concurrently and cannot
influence each other. Each gets its own subagent:

- `data-performance`
- `ux-usability`
- `visual-design`

If those subagent types are not registered in this session, launch three
general-purpose agents instead and tell each one to read its brief first:
`.claude/agents/data-performance.md`, `.claude/agents/ux-usability.md`,
`.claude/agents/visual-design.md`.

Give every agent the same short preamble and nothing else:

> Read your agent brief, then `product-review/PROJECT-STATE.md`, your own
> memory file under `product-review/memory/`, and `product-review/REGISTER.md`.
> Run `bash product-review/context.sh` for what has changed. Then produce one
> primary recommendation in exactly the output shape your brief specifies.
> Do not modify any CoachVoice application file. Return your report as text —
> the orchestrator files it. `[focus: $ARGUMENTS]`

**Do not** tell one agent what another is thinking. Independence before
synthesis is the point of running three of them.

## 3. Synthesise — this part is yours

Once all three have reported:

1. Look for genuine relationships. Do three recommendations touch the same
   screen, the same data, the same component? If so say whether they collapse
   into one change. **Do not force it.** "These three are unrelated" is a
   perfectly good synthesis and is more common than not.
2. Sanity-check every priority score. The formula
   `(Impact × User value × MVP relevance × Confidence) / Effort` is decision
   support, not a verdict — if an agent's arithmetic points somewhere your
   judgement does not, say so and explain.
3. Pick **#1 today** on the combination of user value, MVP importance,
   implementation effort and confidence.
4. Give a recommended action: **BUILD / INVESTIGATE / TEST / IGNORE**. If
   BUILD, add a five-line implementation outline — files, the change, the check.

## 4. File it

Write `product-review/reports/YYYY-MM-DD-coach-voice-review.md`:

```
COACH VOICE — DAILY PRODUCT REVIEW

Date: YYYY-MM-DD
Reviewed against: <short sha> <subject>

────────────────────────────────
📊 DATA & PERFORMANCE
<agent output verbatim>

────────────────────────────────
⚡ UX & USABILITY
<agent output verbatim>

────────────────────────────────
🎨 VISUAL DESIGN
<agent output verbatim>

────────────────────────────────
TODAY'S PRIORITY
<cross-agent relationships, or a clear statement that there are none>

#1 Recommendation today: <ID> — <one line>
Why it wins: <user value · MVP importance · effort · confidence>
Recommended action: BUILD / INVESTIGATE / TEST / IGNORE
<implementation outline if BUILD>
```

Then update, if the agents have not already:

- `product-review/REGISTER.md` — one row per new ID, status `PROPOSED`, plus
  the coverage counters
- `product-review/memory/*.md` — one entry per agent

## 5. Report back in the chat

Post a short summary: the three headlines, the #1 pick and the action. Link
the report path. Then stop.

## Hard rules

- **Advisory only.** Never modify a CoachVoice application file from this
  command — not `app/`, not `lib/`, not `supabase/`. Writing under
  `product-review/` is the whole of your write access. The user decides what
  gets built, in a separate conversation.
- Do not let an agent report on another agent's territory.
- Three "nothing to change today" verdicts is a valid outcome. File it as such
  rather than promoting a weak idea to fill the page.
