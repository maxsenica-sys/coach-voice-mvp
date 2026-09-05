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
const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
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
- Push directly to `main` (no branches or PRs)

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
