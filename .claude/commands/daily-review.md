---
description: Run the three CoachVoice product-review agents and write the morning report
argument-hint: "[optional focus, e.g. 'athlete home' or 'no research']"
allowed-tools: Task, Read, Write, Edit, Grep, Glob, Bash
---

# CoachVoice — daily product review

You are the **orchestrator**. You do not have opinions about the product; the
four agents do. Your job is context, dispatch, synthesis and filing.

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

## 2. Run the four agents independently and in parallel

Launch all four in a **single message** so they run concurrently and cannot
influence each other. Each gets its own subagent:

- `data-performance`
- `ux-usability`
- `visual-design`
- `wow-factor` — the ambition agent. It ignores MVP caution on purpose and its
  ideas are meant to lose the priority arithmetic. Do not moderate it on the way
  in, and do not let the other three see it before they report: its whole value
  is that it did not sit in the same room as the brakes.

If those subagent types are not registered in this session, launch four
general-purpose agents instead and tell each one to read its brief first:
`.claude/agents/data-performance.md`, `.claude/agents/ux-usability.md`,
`.claude/agents/visual-design.md`, `.claude/agents/wow-factor.md`.

Give every agent the same short preamble and nothing else:

> Read your agent brief, then `product-review/PROJECT-STATE.md`, your own
> memory file under `product-review/memory/`, and `product-review/REGISTER.md`.
> Run `bash product-review/context.sh` for what has changed. Then produce one
> primary recommendation in exactly the output shape your brief specifies.
> Do not modify any CoachVoice application file. Return your report as text —
> the orchestrator files it. `[focus: $ARGUMENTS]`

**Do not** tell one agent what another is thinking. Independence before
synthesis is the point of running four of them.

## 3. Synthesise — this part is yours

Once all three have reported:

1. Look for genuine relationships. Do several recommendations touch the same
   screen, the same data, the same component? If so say whether they collapse
   into one change. **Do not force it.** "These are unrelated" is a perfectly
   good synthesis and is more common than not.
   Pay particular attention to where the wow agent's idea and a conservative
   agent's idea are the same insight at two different sizes — that pairing is
   the most useful thing this system produces, because it gives the user a cheap
   version and an ambitious version of one bet.
2. Sanity-check every priority score. The formula
   `(Impact × User value × MVP relevance × Confidence) / Effort` is decision
   support, not a verdict — if an agent's arithmetic points somewhere your
   judgement does not, say so and explain.
3. Pick **#1 today** on the combination of user value, MVP importance,
   implementation effort and confidence.
4. Pick **#1 ambition** separately — the wow agent's idea, or one of the STRETCH
   proposals from the other three, that you think is most worth the user's
   attention. These compete with each other, never with #1 today. Say plainly
   that it is a bet and what it would cost.
5. Collect every **"What I'd challenge"** and **"What I'd cut"** line into one
   short list. Do not resolve them — they are for the user to react to.
6. Give a recommended action: **BUILD / INVESTIGATE / TEST / IGNORE**. If
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
🚀 WOW FACTOR
<agent output verbatim, including its "Three more, unargued" list>

────────────────────────────────
CHALLENGES TO THE STATUS QUO
<the collected "What I'd challenge" / "What I'd cut" lines, unresolved>

────────────────────────────────
TODAY'S PRIORITY
<cross-agent relationships, or a clear statement that there are none>

#1 Recommendation today: <ID> — <one line>
Why it wins: <user value · MVP importance · effort · confidence>
Recommended action: BUILD / INVESTIGATE / TEST / IGNORE
<implementation outline if BUILD>

#1 Ambition: <ID> — <one line>
Why this bet over the others: <one paragraph>
Cheapest way to find out if it is right: <the one-day test>
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
- "Nothing to change today" is a valid outcome for the three MVP agents. File
  it as such rather than promoting a weak idea to fill the page. It is **not** a
  valid outcome for the wow agent — if it has nothing, it has not looked hard
  enough, and you should send it back once.
- Never soften the wow agent's idea into something reasonable. Its job is to be
  unreasonable; yours is to label the cost accurately and let the user decide.
