/**
 * Draft a summary from a transcript, before anything is saved.
 *
 * Max, 2026-09-25, asked for the summary to be generated at stop-and-transcribe
 * rather than at save. The reason is not speed. Until now the modal said "AI
 * summary will be generated automatically when you save", which meant the first
 * person to read what the model wrote about a named child was the child. The
 * coach saw it afterwards, on the session page, if they went looking.
 *
 * This route exists so the coach reads the draft first and can change it. It
 * writes nothing. The save route still generates its own summary when one is
 * not supplied, so nothing that posts there today behaves differently.
 *
 * `runtime = 'nodejs'` for the same reason as its siblings — the Edge runtime
 * is a different fetch and a different set of environment guarantees, and this
 * route reads OPENAI_API_KEY.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { routeIdentity } from '@/lib/route-identity'
import { makeQuickSummary } from '@/lib/quick-summary'
import type { CookieToSet } from '@/lib/supabase-route'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const cookiesToSet: CookieToSet[] = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (c) => c.forEach((x) => cookiesToSet.push(x)),
      },
    },
  )

  const who = await routeIdentity(supabase)
  if (!who.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : ''
  const athleteId = typeof body?.athlete_id === 'string' ? body.athlete_id : ''
  const sport = typeof body?.sport === 'string' ? body.sport : null

  if (!transcript) {
    return NextResponse.json({ error: 'No transcript to summarise' }, { status: 400 })
  }

  /* Authenticating is not authorising — the gap SG1 cannot see, and the one
   * that already shipped once on this codebase. A coach may only draft against
   * an athlete on their own roster, because the athlete's first name is what
   * decides whether the summary is written to them personally. Without this
   * check any signed-in coach could name any athlete id and have the model
   * address another coach's child by name. */
  let firstName: string | null = null
  const rosterFirstNames: string[] = []
  if (athleteId) {
    const { data: athlete } = await supabase
      .from('athletes')
      .select('first_name')
      .eq('id', athleteId)
      .eq('coach_id', who.userId)
      .maybeSingle()

    if (!athlete) {
      return NextResponse.json({ error: 'Athlete not found on your roster' }, { status: 404 })
    }
    firstName = athlete.first_name ?? null
    if (firstName) rosterFirstNames.push(firstName)
  }

  const { summary, next } = await makeQuickSummary(transcript, sport, firstName, rosterFirstNames)

  const res = NextResponse.json({ summary, next })
  cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
  return res
}
