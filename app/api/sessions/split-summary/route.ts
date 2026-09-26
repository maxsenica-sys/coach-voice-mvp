/**
 * POST /api/sessions/split-summary
 *
 * One recording about several athletes, split into one draft per athlete,
 * before anything is saved. The coach reads and edits every draft on the review
 * step; the save then writes one session per athlete with THEIR summary.
 *
 * Writes nothing. Body: { transcript, athlete_ids: string[2..5], sport }.
 * Returns { sections: [{ athlete_id, summary, next, reason }] }, one per
 * requested athlete, in request order.
 *
 * Auth mirrors /api/sessions/summary exactly: routeIdentity, then every athlete
 * id scoped to the caller's own roster with .eq('coach_id', userId). An id that
 * is not on the roster rejects the whole request — a split that silently
 * dropped one athlete would look like "nothing specific for them".
 *
 * The careful part — who the model may write for, what it is told, and what is
 * done with the reply — lives in lib/split-summary.ts, where the prompt rig can
 * run it.
 */
import { guardSummary } from '@/lib/summary-guard'
import { checkContent, BLOCKED_MESSAGE } from '@/lib/content-gate'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { routeIdentity } from '@/lib/route-identity'
import type { CookieToSet } from '@/lib/supabase-route'
import {
  MAX_SPLIT_ATHLETES,
  MIN_SPLIT_ATHLETES,
  SplitParseError,
  assembleSplit,
  buildSplitSummaryPrompt,
  parseSplitSummaryResponse,
  splitEligibility,
  type SplitAthlete,
  type SplitSection,
} from '@/lib/split-summary'

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
  const reply = (body: unknown, status = 200) => {
    const res = NextResponse.json(body, { status })
    cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
    return res
  }

  const who = await routeIdentity(supabase)
  if (!who.ok) return reply({ error: 'Unauthorized' }, 401)

  const body = await req.json().catch(() => ({}))
  const transcript = typeof body?.transcript === 'string' ? body.transcript.trim() : ''
  const sport = typeof body?.sport === 'string' ? body.sport : null
  const rawIds: unknown[] = Array.isArray(body?.athlete_ids) ? body.athlete_ids : []
  const ids = [...new Set(rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))]

  if (!transcript) return reply({ error: 'No transcript to split' }, 400)
  if (ids.length < MIN_SPLIT_ATHLETES || ids.length > MAX_SPLIT_ATHLETES) {
    return reply({ error: `Choose between ${MIN_SPLIT_ATHLETES} and ${MAX_SPLIT_ATHLETES} athletes.` }, 400)
  }

  /* Every id on the caller's own roster, or nothing. Same rule and same reason
   * as the single draft route: the first name decides who the model writes
   * to, so an id from another coach's roster would have it address another
   * coach's child by name. */
  const { data: rows, error } = await supabase
    .from('athletes')
    .select('id, first_name, last_name')
    .in('id', ids)
    .eq('coach_id', who.userId)
  if (error) return reply({ error: 'Could not read your roster' }, 500)
  const found = new Map((rows ?? []).map((r) => [r.id as string, r]))
  if (ids.some((id) => !found.has(id))) {
    return reply({ error: 'Athlete not found on your roster' }, 404)
  }

  // Request order, not the database's.
  const athletes: SplitAthlete[] = ids.map((id) => {
    const r = found.get(id)!
    return { id, first_name: (r.first_name as string | null) ?? '', last_name: (r.last_name as string | null) ?? '' }
  })

  const { eligible, skipped } = splitEligibility(transcript, athletes)

  // Nobody was named: no model call, everyone empty, and the UI says why.
  if (eligible.length === 0) {
    return reply({ sections: assembleSplit(athletes, skipped, []) })
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) return reply({ error: 'Summaries are not configured on this server. You can write each one.' }, 503)

  // Same gate as the single summary: some recordings must not be summarised
  // for any athlete at all (lib/content-gate.ts).
  const gate = await checkContent(transcript)
  if (gate.blocked) {
    console.warn('[split-summary] not summarised:', gate.reasons.join(', '))
    return reply({ error: BLOCKED_MESSAGE, blocked: true }, 422)
  }

  let drafted: SplitSection[]
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildSplitSummaryPrompt(transcript, sport, eligible) }],
      }),
    })
    if (!res.ok) return reply({ error: 'Could not draft the summaries. You can write each one.' }, 502)
    const json = await res.json()
    const content: string = json?.choices?.[0]?.message?.content ?? ''
    // Each athlete's section is held to the same rules as a single summary: at
    // most five points, and only what the coach actually said.
    drafted = parseSplitSummaryResponse(content, athletes).map((sec) => {
      if (sec.reason !== 'drafted') return sec
      const g = guardSummary({ summary: sec.summary, next: sec.next }, transcript)
      return g.summary || g.next
        ? { ...sec, summary: g.summary, next: g.next }
        : { athlete_id: sec.athlete_id, summary: null, next: null, reason: 'nothing-specific' as const }
    })
  } catch (e: unknown) {
    return reply(
      { error: e instanceof SplitParseError
          ? 'The summaries came back unreadable. You can write each one.'
          : 'Could not draft the summaries. You can write each one.' },
      502,
    )
  }

  return reply({ sections: assembleSplit(athletes, skipped, drafted) })
}
