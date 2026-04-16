import { NextResponse } from 'next/server'
import { getSportTerminologyHint } from '@/lib/sports'

export const runtime = 'nodejs'

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

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded. Expected form field 'file'." }, { status: 400 })
    }

    const fd = new FormData()
    fd.append('file', file, file.name || 'audio.webm')
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
      return NextResponse.json({ error: 'OpenAI transcription failed', details: text }, { status: 500 })
    }

    const json = await r.json()
    const transcriptText = (json?.text ?? '').toString()

    return NextResponse.json({ text: transcriptText, segments: json?.segments ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error in /api/transcribe' }, { status: 500 })
  }
}
