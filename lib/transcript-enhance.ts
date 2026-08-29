// lib/transcript-enhance.ts
// Cleans up a raw Whisper transcript's grammar, punctuation, and false
// starts — without changing wording or meaning — so a coach reviews an
// already-tidy transcript instead of hand-fixing commas after every
// recording. Called in the same request as transcription (see
// /api/transcribe and /api/sessions/audio), not a separate round trip.
//
// Never throws and never blocks the transcript on failure: this always runs
// in the hot path of "did my recording work," so any error just falls back
// to the raw Whisper text.

export async function enhanceTranscript(raw: string): Promise<string> {
  const text = raw.trim()
  if (!text) return raw

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return raw

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You clean up raw speech-to-text transcripts of a sports coach speaking notes aloud. ' +
              'Fix grammar, punctuation, and capitalization, and remove clear stutters/false starts ' +
              '(e.g. "the the ball" -> "the ball"). ' +
              "Do NOT summarize, paraphrase, add information, remove information, or change any word's " +
              'meaning — including names, numbers, and sport-specific terms. If a sentence is already ' +
              'grammatically fine, leave it unchanged. Output only the cleaned transcript text, nothing else.',
          },
          { role: 'user', content: text },
        ],
      }),
    })

    if (!res.ok) return raw
    const json: any = await res.json()
    const cleaned = String(json?.choices?.[0]?.message?.content ?? '').trim()
    return cleaned || raw
  } catch {
    return raw
  }
}
