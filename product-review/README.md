# CoachVoice product review — three agents

A small advisory team that looks at CoachVoice each morning from three angles
and tells you what it would change. It **never changes anything itself**. You
decide what gets built.

## Run it

```
/daily-review
```

Optionally point it somewhere:

```
/daily-review athlete home screen
```

Or run one agent on its own, when you only want that lens:

```
Use the visual-design agent to review the new session page.
```

## What happens

1. The orchestrator reads three small files — `PROJECT-STATE.md`,
   `REGISTER.md`, and the output of `context.sh`. It does **not** read the app.
2. It launches the three agents in parallel, in separate contexts, so none of
   them can see what the others are thinking. Each reads the same shared state
   file, its own memory, and then opens only the specific app files it needs to
   check a specific claim.
3. Each returns one primary recommendation in a fixed shape, with an ID,
   scores, and a BUILD NOW / TEST / BACKLOG / REJECT verdict.
4. The orchestrator synthesises — looks for real overlap between the three,
   sanity-checks the priority arithmetic, picks #1 for the day, and files
   `reports/YYYY-MM-DD-coach-voice-review.md`.

## The three

| Agent | Owns | Asks |
|---|---|---|
| `data-performance` | Whether CoachVoice uses data to make athletes better | "Will this help the athlete or coach make a better decision?" |
| `ux-usability` | Taps, screens, flows, states, affordance | "Could three taps be one? Could this screen not exist?" |
| `visual-design` | One coherent design system, built up over time | "In three seconds, does the athlete know what matters?" |

They are meant to stay separate thinkers. Only the synthesis step is allowed
to join them up, and only where a real relationship exists.

## Files

```
.claude/agents/data-performance.md      the three briefs — what each agent is,
.claude/agents/ux-usability.md          what it examines, its output shape
.claude/agents/visual-design.md

.claude/commands/daily-review.md        the orchestrator

product-review/
  README.md                             this file
  PROJECT-STATE.md                      shared context — the thing that keeps
                                        this cheap. Agents read it instead of
                                        the repo.
  REGISTER.md                           every recommendation, its ID, its status
  context.sh                            what changed since the last review
  memory/*.md                           one append-only log per agent
  reports/YYYY-MM-DD-*.md               the morning reports
```

## Why it costs so little

The expensive way to do this is three agents reading a 6,000-line codebase
every morning. Instead:

- `PROJECT-STATE.md` holds the architecture, the data model, the workflows, the
  palette inventory and the measured contrast ratios. It is written once and
  amended when the architecture moves — not when a line of CSS changes.
- `context.sh` prints commit subjects, changed filenames and churn since the
  last saved report. Names and counts only, no file contents.
- Agents then open individual files, deliberately, to verify one claim at a
  time — and are told to cite `file:line`, which is also what stops them
  inventing things.

## Memory, and not repeating themselves

Every recommendation gets an ID (`DATA-014`, `UX-021`, `DESIGN-008`) and a row
in `REGISTER.md` with a status: `PROPOSED · TESTING · APPROVED · IMPLEMENTED ·
BACKLOG · REJECTED · SUPERSEDED`.

Agents read the register before proposing. Something rejected does not come
back unless there is new evidence, the app has materially changed, or another
change has created a reason to revisit it.

**When you decide on something, say so** — the register and the agent memory
are only as good as the outcomes written into them. "REJECTED — too many taps
for the coach" teaches the agents more than the recommendation itself did.

## Change-driven, but not blindly

Recently touched screens get weighted. But `REGISTER.md` also carries a
coverage table — how many reviews since each area was last the primary subject.
Anything at 4+ is due an unprompted audit even if nothing there has changed, so
long-standing problems in quiet corners do not become invisible.

## What they will not do

- Modify anything under `app/`, `lib/` or `supabase/`. The report is advisory.
- Recommend a change every day. Three "nothing worth changing" verdicts is a
  valid morning, and is filed as such.
- Manufacture criticism. The instruction to all three is constructive
  scepticism: challenge the app, but do not invent problems to look useful.
