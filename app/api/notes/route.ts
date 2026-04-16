// app/api/notes/route.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type CookieLike = { name: string; value: string }

async function createRouteClient() {
  const cookieStore: any = await cookies()

  const safeGetAll = (): CookieLike[] => {
    if (typeof cookieStore.getAll === 'function') {
      const all = cookieStore.getAll()
      return (all ?? []).map((c: any) => ({ name: c.name, value: c.value }))
    }

    const names = ['sb-access-token', 'sb-refresh-token', 'sb-auth-token', 'supabase-auth-token']
    const found: CookieLike[] = []
    for (const name of names) {
      const c = cookieStore.get?.(name)
      if (c?.value) found.push({ name, value: c.value })
    }
    return found
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return safeGetAll()
        },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value, options }: any) => {
            cookieStore.set?.(name, value, options)
          })
        },
      },
    },
  )
}

// GET /api/notes?athlete_id=...
export async function GET(req: Request) {
  try {
    const supabase = await createRouteClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(req.url)
    const athleteId = url.searchParams.get('athlete_id')
    if (!athleteId) {
      return NextResponse.json({ error: 'athlete_id is required' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    // Ensure athlete belongs to coach
    const { data: athleteRow, error: athleteErr } = await admin
      .from('athletes')
      .select('id')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .single()

    if (athleteErr || !athleteRow) {
      return NextResponse.json({ error: 'Athlete not found (or not yours)' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('notes')
      .select('id, summary, shared_with_athlete, created_at')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ notes: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}

// POST /api/notes
// body: { athlete_id, summary, shared_with_athlete? }
export async function POST(req: Request) {
  try {
    const supabase = await createRouteClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({} as any))
    const athlete_id = String(body?.athlete_id ?? '').trim()
    const summary = String(body?.summary ?? '').trim()
    const shared_with_athlete = Boolean(body?.shared_with_athlete ?? false)

    if (!athlete_id || !summary) {
      return NextResponse.json({ error: 'athlete_id and summary are required' }, { status: 400 })
    }

    const admin = createSupabaseAdminClient()

    // Ensure athlete belongs to coach
    const { data: athleteRow, error: athleteErr } = await admin
      .from('athletes')
      .select('id')
      .eq('id', athlete_id)
      .eq('coach_id', user.id)
      .single()

    if (athleteErr || !athleteRow) {
      return NextResponse.json({ error: 'Athlete not found (or not yours)' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('notes')
      .insert({
        athlete_id,
        coach_id: user.id,
        summary,
        shared_with_athlete,
      })
      .select('id, summary, shared_with_athlete, created_at')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ note: data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}