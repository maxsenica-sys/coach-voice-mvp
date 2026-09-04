import { NextResponse } from 'next/server'
import { getSportTerminologyHint } from '@/lib/sports'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createRouteClient } from '@/lib/supabase-route'

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

    return NextResponse.json({ text: transcriptText, segments: json?.segments ?? [] })
  } catch (e: any) {
    console.error('[transcribe] caught error', e?.message)
    return NextResponse.json({ error: e?.message ?? 'Unknown error in /api/transcribe' }, { status: 500 })
  }
}
