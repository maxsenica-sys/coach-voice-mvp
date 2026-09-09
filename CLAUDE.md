# CoachVoice — Claude Code Guidelines

## ⚠️ CRITICAL: Audio Recording & Transcription Pipeline

The following files contain the audio recording and transcription pipeline.
**Do NOT modify the MediaRecorder, MIME type detection, or FormData construction
in these files without explicit user instruction.** Breaking this will silently
cause recording and transcription to fail.

### Protected recording call sites

| File | Function | Notes |
|------|----------|-------|
| `app/components/QuickSessionModal.tsx` | `startRecording`, `stopAndTranscribe` | Coach session recorder |
| `app/athlete/page.tsx` | `startNoteRecording` | Athlete voice notes |
| `app/components/MessagingPanel.tsx` | `startAudio`, `sendAudio` | Voice messages |

> **Updated 2026-09-05:** The athlete profile page's own recorder
> (`startRecording`, `stopRecording`, `transcribeBlob`, `clearRecording`,
> `saveSession` in `app/athletes/[id]/page.tsx`) was deleted. It had been
> unreachable for some time — both "Record Session" buttons on that page open
> `QuickSessionModal`, and nothing rendered the local recorder's UI. Recording
> from an athlete's profile still works; it goes through the modal like
> everywhere else.

> **Updated after Round 1:** The re-record `onClick` handler in
> `QuickSessionModal` was intentionally modified to stop lingering mic streams.
> Protection applies to `startRecording`, `stopAndTranscribe`, MIME detection,
> and FormData construction — not UI state handlers.

### Why MIME type detection matters

All MediaRecorder instances MUST use dynamic MIME type detection:

```ts
// mp4/AAC first: iOS Safari cannot decode WebM at all, so a WebM recording made
// in Chrome plays back as an endless spinner on an iPhone. Every browser that
// can play WebM can also play mp4, so preferring it makes a recording playable
// everywhere. WebM stays as the fallback for browsers that can't record mp4.
const supported = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
const mimeType = supported.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {})
```

And the File sent to `/api/transcribe` MUST use the actual extension:

```ts
const actualMime = rec.mimeType || 'audio/webm'
const ext = actualMime.includes('mp4') ? 'mp4' : actualMime.includes('ogg') ? 'ogg' : 'webm'
fd.append('file', new File([blob], `recording.${ext}`, { type: actualMime }))
```

**Why:** Chrome uses `audio/webm`, Safari/iOS uses `audio/mp4`. Hardcoding
`audio/webm` causes OpenAI Whisper to silently fail or reject files on Apple
devices. The file extension in the filename is how Whisper detects the codec.

The *order* of the list matters separately from the detection: it decides
playback, not transcription. Recording mp4 wherever the browser supports it is
what makes a saved session playable on an iPhone later.

### Protected API routes

| Route | Purpose |
|-------|---------|
| `app/api/transcribe/route.ts` | Whisper-1 transcription (used everywhere) |
| `app/api/sessions/audio-upload-url/route.ts` | Signed upload URL — browser sends audio straight to storage |
| `app/api/sessions/[id]/audio-url/route.ts` | Signed playback URL for a saved recording |
| `app/api/sessions/route.ts` | Save session with AI summary |

Do NOT change `export const runtime = 'nodejs'` on these routes — removing it
switches to the Edge runtime which has no FormData file support.

> **Updated 2026-09-03:** `app/api/sessions/audio/route.ts` and
> `app/api/sessions/audio-upload/route.ts` were deleted. Neither had a caller —
> the recorders upload via `audio-upload-url` and transcribe via `/api/transcribe`.
> The deleted `sessions/audio` route also carried a summariser prompt hardcoded to
> volleyball, which would have applied to every sport had it ever been re-wired.
> If a new session-save path is added, reuse `lib/session-calendar-sync.ts` and
> `lib/notify.ts` rather than re-inlining that logic.

## General rules

- Never modify `app/api/` files when working on UI features
- Never modify component files (QuickSessionModal, MessagingPanel, WellnessSubmit,
  Calendar, VideoAnnotator) unless the task is specifically a bug fix in that component
- Always run `npx tsc --noEmit` before committing
- Work on a branch, open a PR, and **merge it yourself once it is green** — see
  the merge policy below. (This line used to read "push directly to `main`, no
  branches or PRs". That stopped being true once CI existed; the gate is the
  point.)

## ⚠️ Merge policy — merge your own green PRs without asking

Max asked for this explicitly on 2026-09-07: *"instead of waiting for me, why
don't you just merge automatically?"* Treat it as standing authorization. Do not
open a PR and then sit waiting for a human to press the button.

**`main` is production.** There is no staging; Vercel deploys `main` on merge. So
this authorization is to merge *green* work, not to merge faster. Every condition
below must hold, and you check them yourself rather than assuming:

- The PR is one **you** opened in this session.
- **CI is green on the current head commit** — read the check run, and if a green
  result looks implausible (finished suspiciously fast, a step you added has
  never run here before) read the job log and confirm the steps actually
  executed. A green you have not understood is not green.
- `mergeable_state` is `clean` — no conflict.
- No unaddressed review comment or requested change.
- For anything touching startup, `npm run verify:boot` passes (see above).

**Updated 2026-09-09.** Max: *"you can merge at any time"* — given in response to
being asked to eyeball a visible design change before it merged. So the
"needs a human eye" carve-out is **gone**: a visible design change, a schema
migration or a security-relevant decision is no longer a reason to stop and ask.
Land it, and say clearly in the PR what the judgement was, so it can be reviewed
after the fact rather than blocking on being reviewed before.

Direct pushes to `main` are allowed again on the same authority. Prefer a branch
and a PR when CI can usefully run first — that is what the gate is for — but a
push to `main` is not something to ask permission for.

**Still never auto-merge:** someone else's PR, or one you were only asked to
watch — those are not yours. And still never merge or push **red or
still-running CI**: that is not a permission question, it is the difference
between shipping and breaking production, and there is no staging to catch it.
If CI is red, say what is failing.

Use a **merge commit**, not squash — that is how #3 and #5 landed and it keeps
the individual commits readable.

After merging: confirm it merged, delete nothing else, and stop the PR watch.

## ⚠️ Startup / first-paint changes must be verified in a browser

`tsc --noEmit`, `eslint` and `next build` **all pass on every startup bug this
project has had**. They cannot see a wordmark that flashes before the intro, a
stylesheet whose fonts the build silently dropped, or a boot script whose route
match never matched. Each of those shipped green.

So if a change touches what the user sees in the first second, run:

```bash
npm run verify:boot            # reuses the current .next
npm run verify:boot -- --build # forces a fresh production build first
```

`tools/boot-smoke.mjs` drives real Chromium against a production build and
asserts on the cold-start timeline: the brand must not be painted in the first
500ms, the sequence must resolve, a returning visit must show the resting frame,
reduced motion and dead JavaScript must never leave the brand invisible, the
font tokens must resolve to real families, the `/` fast path must route
correctly, and the console and network must be clean.

**Files that require it:** `app/layout.tsx`, `app/page.tsx`, `app/globals.css`,
`proxy.ts`, `app/components/IntroSequence.tsx`,
`app/components/ColdStartSplash.tsx`, `next.config.ts`, and anything touching
fonts, routing, caching or the service worker.

**When you fix a startup bug, add the check that would have caught it**, then
prove the check works by breaking the fix on purpose and watching that check go
red. A check that has never failed is not known to work — this is how we learned
that the "no third-party `@import`" check had to inspect the *source*, because
the Tailwind build drops the import before any check of the build output can see
it. The `boot-verifier` subagent (`.claude/agents/boot-verifier.md`) does all of
this; hand it the change rather than re-deriving the method.

Two rules that came out of these bugs and are easy to re-break:

- **Never put an `@import url(https://…)` in a CSS file.** Fonts go through
  `next/font` in `app/layout.tsx`, which self-hosts them onto our own origin.
- **`next/font` variable classes go on `<html>`, not `<body>`.** `globals.css`
  resolves `--font-display/-sans/-mono` in a `:root` block, and a `var()` that is
  unresolved there is invalid at computed value time — it takes the literal
  fallbacks down with it and drops the whole app into the default serif.

---

## ⚠️ MANDATORY: Pre-commit code review checklist

Before committing **any** edit, run through this checklist for every file touched.
These are the bug classes that have already caused production issues.

### 1. fetch() error handling
Every `fetch()` call MUST check `res.ok` — including ones whose only job is a
side effect. `await fetch(url, { method: 'DELETE' })` with no check is the bug
this rule exists for: a non-2xx response is not an exception, so the UI carries
on and tells the user it worked.

**Use the helpers in `lib/api-client.ts` instead of raw `fetch` for API calls:**
`apiMutate(url, init)` for side effects and `apiJson(url, init)` when you need
the body. Both throw an Error carrying the server's message, so an existing
catch block surfaces it.
```ts
// ❌ WRONG — non-2xx silently produces empty/undefined data
const json = await res.json().catch(() => ({}))
if (json.text) setTranscript(json.text)

// ✅ CORRECT — throw on failure so the catch block surfaces the error
const json = await res.json().catch(() => ({}))
if (!res.ok) throw new Error(json.error ?? 'Request failed')
if (json.text) setTranscript(json.text)
```
**Applies to:** all `fetch` calls in QuickSessionModal, athlete/page, athletes/[id]/page, MessagingPanel.

### 2. Empty/null state in UI
When rendering a list or dropdown from async data, always handle the empty case visibly.
Never render an empty `<select>` — show a message explaining why it's empty and what to do.

### 3. Infinite fetch / stale closure loops
`useEffect` with fetch inside must list all dependencies correctly.
Callbacks passed as dependencies should be wrapped in `useRef` (not `useCallback`) when
they would otherwise cause the effect to re-fire on every render.
Known past incident: `onUnreadChange` in MessagingPanel caused infinite polling loop.

### 4. MediaRecorder MIME type
See "Protected recording call sites" above. Never hardcode `'audio/webm'` as the mimeType
argument to `new MediaRecorder(...)` or `new Blob(...)` or `new File(...)`.

### 5. Calendar date arithmetic
`new Date(year, month - 1, 32)` is the correct pattern for finding last day of a month.
`new Date(year, month, 0)` also works. Never use hardcoded day counts (28/30/31).
Known past incident: 30-day months caused `NaN` date in monthRange.

### 6. TypeScript narrowing
After any async call, re-check nullability before using the result.
If a value is `T | null`, narrow it before passing to a function expecting `T`.

### Review agent instruction
**After every implementation task**, before writing the commit message, re-read each modified
file from top to bottom and verify all 6 checklist items above. Log any issues found and fix
them before committing. Do not skip this even for "small" changes — the silent fetch bug in
QuickSessionModal was introduced alongside a "small" MIME fix.
