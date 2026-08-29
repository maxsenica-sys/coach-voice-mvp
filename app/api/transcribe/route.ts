import { NextResponse } from 'next/server'
import { getSportTerminologyHint } from '@/lib/sports'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createRouteClient } from '@/lib/supabase-route'
import { enhanceTranscript } from '@/lib/transcript-enhance'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY in .env.local' }, { status: 500 })
    }

    const form = await req.formData()
    const file = form.get('file')
    const sport = String(form.get('sport') ?? '').trim()       // optional sport context
    const language = String(form.get('language') ?? '').trim() // optional language hint

    const audioPath = String(form.get('audio_path') ?? '').trim()

    // Preferred path: the browser uploaded straight to Supabase Storage with a
    // signed URL, so only the path travels through Vercel. Sidesteps the 4.5MB
    // serverless request body limit that 413s on longer sessions.
    let audioFile: File | null = file instanceof File ? file : null

    if (!audioFile && audioPath) {
      // audio_path is read with the service-role key, so it must be proven to belong
      // to the caller. Without this any signed-in user could name another coach's
      // path and read their recording.
      const routeClient = await createRouteClient()
      const { data: { user } } = await routeClient.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (!audioPath.startsWith(`coach/${user.id}/`)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const admin = createSupabaseAdminClient()
      const { data: blob, error: dlErr } = await admin.storage.from('session-audio').download(audioPath)
      if (dlErr || !blob) {
        return NextResponse.json({ error: `Could not read audio from storage: ${dlErr?.message ?? 'not found'}` }, { status: 400 })
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

    // Sport-specific vocabulary hint boosts accuracy for jargon
    const sportHint = getSportTerminologyHint(sport)
    if (sportHint) {
      // Whisper "prompt" primes the vocabulary (max ~224 tokens)
      const prompt = `Coaching session. Sport: ${sport}. Key terms: ${sportHint.slice(0, 400)}.`
      fd.append('prompt', prompt)
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

    // Same call, same process: grammar/punctuation cleanup runs right here so
    // the caller gets both versions back in one round trip. textEnhanced is
    // what review UIs should pre-fill; text (raw) is kept for the record.
    const textEnhanced = await enhanceTranscript(transcriptText)

    return NextResponse.json({ text: transcriptText, textEnhanced, segments: json?.segments ?? [] })
  } catch (e: any) {
    console.error('[transcribe] caught error', e?.message)
    return NextResponse.json({ error: e?.message ?? 'Unknown error in /api/transcribe' }, { status: 500 })
  }
}
