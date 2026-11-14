# Rename audit: CoachVoice → Pindar

Run 14 Nov 2026 on `main` at `bd23f75`. Searched every tracked file (excluding
`node_modules`, `.next`, `.git`) for `CoachVoice`, `coach-voice`, `coachvoice`,
`coach_voice` and `coach voice`, case-insensitive.

**Short answer:** the user-facing rename is already done. It shipped on
2026-10-06 (the Pindar rebrand: name, laurel mark, icons, launch images,
emails, push text, "nod" language). What is left is one latent email
fallback, a few internal identifiers kept on purpose, and infrastructure.

**Total:** 94 occurrences in 32 files. 57 of them are in historical notes
(`product-review/`, `.claude/`), which are records of what happened and are
not changed.

## 1. User-facing (must change)

| File:line | What | A user sees it when |
|---|---|---|
| `app/api/email/route.ts:98` | `fromEmail` fallback `reports@coachvoice.app` | Only if email is ever switched from Gmail SMTP to Resend **without** `RESEND_FROM_EMAIL` set. Today mail goes through Gmail, which ignores `fromEmail` (`lib/notify.ts:109`), so nobody sees it. Latent, not live. |
| The production address `coach-voice-mvp-pi.vercel.app` | The URL in the browser bar, invite links and email buttons (`app/api/athletes/route.ts:111` and `lib/notify.ts:174` use it as a fallback host) | Every visit. This is the one visible "coach-voice" left, and it can only be fixed with a domain (see 3). |

**Deliberately kept, user-facing but correct:** `app/components/ReinstallNudge.tsx:72,76`. "CoachVoice is now Pindar … press and hold the old CoachVoice icon" names the icon an old iPhone install still shows, so it has to say CoachVoice.

## 2. Internal identifiers (optional)

| File | Identifier | Why it stays |
|---|---|---|
| `lib/checkin-queue.ts:54,59` | IndexedDB `coachvoice-checkins`, event `coachvoice:checkin-queue` | Renaming the database orphans check-ins queued offline on athletes' phones. Kept on purpose (CLAUDE.md, "Kept as CoachVoice deliberately"). |
| `lib/recording-queue.ts:51` | IndexedDB `coachvoice-recordings` | Same reason: a coach's unsent recordings live in it. |
| `package.json:2`, `package-lock.json` | package name `coach-voice-mvp` | Never shown to anyone. |
| `tools/email-rig.mjs:97,159,160` | test fixtures (`coachvoice.rig.invalid`, `reports@coachvoice.app`) | Test strings. They change if and when the fallback in section 1 does. |
| Code comments | `app/layout.tsx:312`, `app/dashboard/page.tsx:1918`, `app/athlete/page.tsx:1606`, `lib/reinstall-nudge.ts:2`, `public/sw.js:36`, `supabase/migrations/024_*.sql:7`, `025_*.sql:7` | Comments describing history. Applied migrations are never edited. |

**Env var names:** none contain CoachVoice. **Supabase tables and columns:** none contain CoachVoice.

## 3. Infrastructure (expensive to change)

| Thing | Current | Cost to change |
|---|---|---|
| GitHub repo | `maxsenica-sys/coach-voice-mvp` | Low. GitHub redirects the old name, but the Vercel Git link and every Claude Code session config point at it. |
| Vercel project | `suppstackd/coach-voice-mvp`, served at `coach-voice-mvp-pi.vercel.app` | Renaming the project does **not** change the `-pi.vercel.app` URL users already have. Installed home-screen apps are bound to the old URL, so moving them to a new `*.vercel.app` URL would mean every athlete reinstalls. |
| Supabase project | `cposdedvstdzxftcaucq`, named "Max's Project" | Nothing to change. The ref is random and the name is not "coach-voice". |
| Database identifiers | none | None. |

## Recommendation

**Rename user-facing only, which is essentially done, and solve the one visible leftover with a custom domain rather than a rename.**

- **Code:** change one line, the email fallback at `app/api/email/route.ts:98`, from `reports@coachvoice.app` to the same neutral fallback `lib/notify.ts` uses. That is about 5 minutes of work and touches nothing else. Not done in this run, as asked.
- **The address:** buy a domain (for example `pindar.app` or `getpindar.com`, around A$20–40 a year) and add it to the Vercel project. This removes "coach-voice" from every link and email. It also gets past school and home routers that block `*.vercel.app`, which is why the site failed to load for you on 29 Oct.
  - Cost: the domain fee, plus about 30 minutes of DNS setup.
  - Catch: an iPhone installed on the old URL keeps it until re-added. Keep the old URL live, redirecting to the new one, so nothing breaks.
- **Not worth it:** a full rename including the repo, the Vercel project and the IndexedDB names. It is about a day of careful work, risks orphaning offline queues, and buys nothing a user can see.

## Exact files and lines for the user-facing change

1. `app/api/email/route.ts:98`: `'reports@coachvoice.app'` → `'onboarding@resend.dev'` (matches `lib/notify.ts:68`).
2. `tools/email-rig.mjs:159-160`: update the fixture address to match, so the email rig keeps testing the real fallback.

Nothing else in the code shows "CoachVoice" to a user.
