// app/api/sessions/audio/route.ts
export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { createRouteClient } from '@/lib/supabase-route'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { syncSessionCalendarEvent } from '@/lib/session-calendar-sync'

async function transcribeWithOpenAI(file: File) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing in .env.local')

  const form = new FormData()
  form.append('model', 'whisper-1')
  form.append('file', file, file.name || 'audio.webm')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI transcription failed (${res.status}): ${text || res.statusText}`)
  }

  const json: any = await res.json()
  const transcript = (json?.text ?? json?.transcript ?? '').toString()
  if (!transcript) throw new Error('OpenAI returned no transcript text')
  return transcript
}

async function summariseTranscript(transcript: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing in .env.local')

  // Keep it scannable + table-friendly
  const system =
    `You are an elite volleyball coach assistant. ` +
    `Create a concise session summary for a coach to scan later in a history table.`

  const user =
    `Summarise the following training session transcript.\n\n` +
    `Rules:\n` +
    `- Output 3–6 short bullet points.\n` +
    `- Each bullet starts with a verb.\n` +
    `- Include: key focus, 1–3 coaching cues, 1–2 wins, 1–2 fixes/next steps.\n` +
    `- No fluff, no emojis.\n\n` +
    `Transcript:\n${transcript}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI summary failed (${res.status}): ${text || res.statusText}`)
  }

  const json: any = await res.json()
  const summary = String(json?.choices?.[0]?.message?.content ?? '').trim()
  if (!summary) throw new Error('OpenAI returned no summary')
  return summary
}

export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const form = await req.formData()
    const mode = String(form.get('mode') ?? 'transcribe')

    const athlete_id = String(form.get('athlete_id') ?? '').trim()
    if (!athlete_id) return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })

    // Ensure athlete belongs to coach
    const { data: athleteRow, error: athleteErr } = await supabase
      .from('athletes')
      .select('id')
      .eq('id', athlete_id)
      .eq('coach_id', user.id)
      .single()

    if (athleteErr || !athleteRow) {
      return NextResponse.json({ error: 'Athlete not found (or not yours)' }, { status: 404 })
    }

    // =========================
    // MODE: TRANSCRIBE (+ SUMMARY)
    // =========================
    if (mode === 'transcribe') {
      const file = form.get('file')
      if (!file || !(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })

      const admin = createSupabaseAdminClient()

      const ext = (file.name?.split('.').pop() || 'webm').toLowerCase()
      const path = `coach/${user.id}/athlete/${athlete_id}/${Date.now()}.${ext}`

      const arrayBuffer = await file.arrayBuffer()
      const uploadRes = await admin.storage.from('session-audio').upload(path, arrayBuffer, {
        contentType: file.type || 'audio/webm',
        upsert: false,
      })

      if (uploadRes.error) {
        return NextResponse.json({ error: `Storage upload failed: ${uploadRes.error.message}` }, { status: 500 })
      }

      const transcript = await transcribeWithOpenAI(file)
      const summary = await summariseTranscript(transcript)

      return NextResponse.json({
        transcript,
        summary,
        audio_path: path,
        audio_mime: file.type || 'audio/webm',
      })
    }

    // =========================
    // MODE: SAVE (FINAL COMMIT)
    // =========================
    if (mode === 'save') {
      const shared_with_athlete = String(form.get('shared_with_athlete') ?? 'false') === 'true'
      const title = String(form.get('title') ?? '').trim() || null

      // summary = short table-friendly
      const summary = String(form.get('summary') ?? '').trim()
      // transcript = full raw transcript
      const transcript = String(form.get('transcript') ?? '').trim() || null

      const audio_path = String(form.get('audio_path') ?? '').trim() || null
      const audio_mime = String(form.get('audio_mime') ?? '').trim() || null

      if (!summary) return NextResponse.json({ error: 'summary is required' }, { status: 400 })

      const { data: inserted, error: insertErr } = await supabase
        .from('sessions')
        .insert({
          coach_id: user.id,
          athlete_id,
          title,
          summary,
          transcript,
          shared_with_athlete,
          audio_path,
          audio_mime,
        })
        .select('id, title, summary, shared_with_athlete, created_at')
        .single()

      if (insertErr) {
        return NextResponse.json({ error: `Failed to save session: ${insertErr.message}` }, { status: 500 })
      }

      // Auto-create a calendar event, same as the text-note save path
      // (/api/sessions POST), so this session shows up on the athlete's
      // calendar once it's actually shared with them.
      if (inserted?.id && shared_with_athlete) {
        const dateStr = new Intl.DateTimeFormat('en-CA').format(new Date())
        await syncSessionCalendarEvent({
          supabase,
          sessionId: inserted.id,
          athleteId: athlete_id,
          coachUserId: user.id,
          title,
          summary,
          eventDate: dateStr,
        })
      }

      return NextResponse.json({ session: inserted })
    }

    return NextResponse.json({ error: `Invalid mode: ${mode}` }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}