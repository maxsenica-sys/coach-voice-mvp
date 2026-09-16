import { NextResponse } from 'next/server'
import { getSportTerminologyHint } from '@/lib/sports'
import { assessTranscript } from '@/lib/transcript-quality'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createRouteClient } from '@/lib/supabase-route'
import { errorMessage } from '@/lib/errors'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY in .env.local' }, { status: 500 })
    }

    // Whisper calls cost money on every request, so the caller must be signed in
    // before we reach OpenAI at all — not only on the storage-path branch below.
    // Both recorders (coach sessions and athlete voice notes) post as a logged-in
    // user, so a plain identity check is enough here.
    const routeClient = await createRouteClient()
    const { data: { user } } = await routeClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get('file')
    let sport = String(form.get('sport') ?? '').trim()         // optional sport context
    const language = String(form.get('language') ?? '').trim() // optional language hint

    const audioPath = String(form.get('audio_path') ?? '').trim()
    /* Who this recording is about.
     *
     * Comma-separated first names, sent by the recorder. Proper nouns are what
     * Whisper mangles hardest — and the entire personalisation feature depends
     * on getting them right, because lib/summary-prompt.ts gates on the coach's
     * spoken name matching the roster. "Ana" coming back as "Anna" means the
     * gate misses and a child who WAS addressed gets the generic summary. */
    const rosterRaw = String(form.get('roster') ?? '').trim()

    // The sport primes Whisper's vocabulary, which is what stops jargon coming
    // back mangled. The recorders read it from client state that isn't always
    // loaded yet, so fall back to the caller's own profile rather than
    // transcribing blind.
    if (!sport) {
      const { data: profile } = await routeClient
        .from('profiles').select('sport').eq('id', user.id).maybeSingle()
      sport = (profile?.sport ?? '').trim()
    }

    // Preferred path: the browser uploaded straight to Supabase Storage with a
    // signed URL, so only the path travels through Vercel. Sidesteps the 4.5MB
    // serverless request body limit that 413s on longer sessions.
    let audioFile: File | null = file instanceof File ? file : null

    if (!audioFile && audioPath) {
      // audio_path is read with the service-role key, so it must be proven to belong
      // to the caller. Without this any signed-in user could name another coach's
      // path and read their recording.
      if (!audioPath.startsWith(`coach/${user.id}/`)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const admin = createSupabaseAdminClient()
      const { data: blob, error: dlErr } = await admin.storage.from('session-audio').download(audioPath)
      if (dlErr || !blob) {
        return NextResponse.json({ error: `Could not read audio from storage: ${errorMessage(dlErr, 'not found')}` }, { status: 400 })
      }
      const name = audioPath.split('/').pop() || 'audio.webm'
      audioFile = new File([blob], name, { type: blob.type || 'audio/webm' })
    }

    if (!audioFile) {
      return NextResponse.json(
        { error: "No audio provided. Expected form field 'file' or 'audio_path'." },
        { status: 400 },
      )
    }

    const fd = new FormData()
    fd.append('file', audioFile, audioFile.name || 'audio.webm')
    fd.append('model', 'whisper-1')
    fd.append('response_format', 'verbose_json') // get segments + timestamps

    if (language) fd.append('language', language)

    /* The context prompt: names first, then sport vocabulary.
     *
     * Whisper's prompt is a token prefix that biases decoding, capped around
     * 224 tokens. It was carrying sport jargon and no names at all, which is
     * backwards — jargon is guessable from context, a fifteen-year-old's name
     * is not.
     *
     * Names go first because the cap truncates the end.
     *
     * The counter-risk is real and is why only the names for THIS recording are
     * sent: prompt bleed can make Whisper insert a primed word that was never
     * spoken, and an inserted name would falsely open the personalisation gate.
     * Restricting the list to the athletes this recording is actually being
     * saved for means a hallucinated name is always a child who was in the
     * room — the same failure mode as a coach being misheard, rather than a new
     * one. lib/summary-prompt.ts then refuses ambiguous names on top of that.
     *
     * getSportTerminologyHint returns '' for a sport we have no real vocabulary
     * for, and that empty string is deliberate: priming with a generic
     * description of coaching biased transcripts toward generic sports
     * commentary for 123 of 154 sports. */
    const rosterNames = rosterRaw
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 1 && n.length < 40)
      .slice(0, 30)

    const sportHint = getSportTerminologyHint(sport)
    const promptParts = ['Coaching session.']
    if (rosterNames.length) promptParts.push(`Athletes: ${rosterNames.join(', ')}.`)
    if (sport) promptParts.push(`Sport: ${sport}.`)
    if (sportHint) promptParts.push(`Key terms: ${sportHint.slice(0, 400)}.`)
    if (promptParts.length > 1) {
      fd.append('prompt', promptParts.join(' '))
    }

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    })

    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[transcribe] OpenAI error', r.status, text)
      return NextResponse.json({ error: 'OpenAI transcription failed', details: text }, { status: 500 })
    }

    const json = await r.json()
    const transcriptText = (json?.text ?? '').toString()
    const segments = Array.isArray(json?.segments) ? json.segments : []

    /* A verdict, computed where the segments actually are.
     *
     * The route has always requested verbose_json and returned `segments`, and
     * no client has ever read them — so a recording of forty seconds of silence
     * was uploaded, paid for, hallucinated into fluent text by whisper-1,
     * accepted by `if (json.text)`, summarised, and emailed to a child. The
     * only guard was `blob.size < 1000`, which silence exceeds easily.
     *
     * See lib/transcript-quality.ts. `segments` is still returned unchanged,
     * so nothing that reads it today breaks. */
    const verdict = assessTranscript(transcriptText, segments)

    return NextResponse.json({
      text: transcriptText,
      segments,
      quality: verdict.quality,
      qualityReason: 'reason' in verdict ? verdict.reason : null,
    })
  } catch (e: unknown) {
    console.error('[transcribe] caught error', errorMessage(e))
    return NextResponse.json({ error: errorMessage(e, 'Unknown error in /api/transcribe') }, { status: 500 })
  }
}
