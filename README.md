# CoachVoice

A voice-first coaching platform. A coach records a session on their phone,
Whisper transcribes it, GPT-4o-mini condenses it into bullets, and the coach
chooses whether to share it with the athlete.

Around that core loop: a roster, a dual-privacy calendar, real-time messaging,
daily wellness check-ins with low-score alerts, video upload with canvas
annotation, printable session and monthly reports, squads, parent/caretaker
contacts, and email notifications for shared sessions, new messages and new
calendar events.

Production: <https://coach-voice-mvp-pi.vercel.app> (Vercel project
`suppstackd/coach-voice-mvp`).

Note: `coach-voice-mvp.vercel.app` — without the `-pi` — is a *different*, older
static app. Do not confuse the two.

## Stack

| Layer | What |
|-------|------|
| App | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · PWA |
| Data | Supabase — Postgres 17, auth, storage, realtime |
| AI | OpenAI Whisper (transcription) + GPT-4o-mini (summaries) |
| Email | Resend |
| Hosting | Vercel |

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open <http://localhost:3000>.

Every variable in `.env.example` is required. Without `RESEND_API_KEY` the app
still runs — invites and notifications are skipped silently rather than failing.

## Database

Migrations live in `supabase/migrations/` and are numbered in apply order.

Apply schema changes with the Supabase MCP `apply_migration` tool (or
`supabase db push`) so the tracked migration list stays truthful — several
early migrations were applied by hand via the SQL editor and are missing from
Supabase's own history as a result.

Storage buckets, all private: `session-audio`, `session-videos`,
`messages-media`, `athlete-photos`.

## Checks

```bash
npx tsc --noEmit && npm run lint && npm run build
```

CI runs the same three on every push and pull request. There is no test suite
yet — `CLAUDE.md` carries a mandatory pre-commit review checklist derived from
past production incidents, and it is worth reading before changing anything in
the recording or transcription path.

## Deploying

```bash
npm run deploy
```

Pushes straight to `main`; Vercel builds and deploys from there.

Preview deployments are **off for `claude/*` branches** (`vercel.json`,
`git.deploymentEnabled`). Vercel's Git integration deploys every branch it sees
by default, and those previews fail on arrival: the six environment variables
are scoped Production-only, so a Preview build has no Supabase URL and dies
prerendering `/athlete`. The result was a red X on every agent PR that said
nothing about the code. CI still runs typecheck, lint and build on those
branches, which is the check that actually matters.

To get working previews instead of no previews, add the six variables to
Vercel's Preview scope and drop the `git` block. To turn previews off for
*every* branch rather than just `claude/*`, that's Vercel → Settings → Git,
not this file.
