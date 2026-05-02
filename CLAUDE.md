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
| `app/athletes/[id]/page.tsx` | `startRecording`, `transcribeBlob` | Athlete profile recorder |
| `app/athlete/page.tsx` | `startNoteRecording` | Athlete voice notes |
| `app/components/MessagingPanel.tsx` | `startAudio`, `sendAudio` | Voice messages |

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
| `app/api/sessions/audio/route.ts` | Full pipeline: upload to storage + transcribe + summarise |
| `app/api/sessions/route.ts` | Save session with AI summary |

Do NOT change `export const runtime = 'nodejs'` on these routes — removing it
switches to the Edge runtime which has no FormData file support.

## General rules

- Never modify `app/api/` files when working on UI features
- Never modify component files (QuickSessionModal, MessagingPanel, WellnessSubmit,
  Calendar, VideoAnnotator) unless the task is specifically a bug fix in that component
- Always run `npx tsc --noEmit` before committing
- Push directly to `main` (no branches or PRs)
