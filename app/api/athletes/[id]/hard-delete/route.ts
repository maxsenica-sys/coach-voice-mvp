import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

async function createRouteClient() {
  const cookieStore: any = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          if (typeof cookieStore.getAll === 'function') {
            return (cookieStore.getAll() ?? []).map((c: any) => ({ name: c.name, value: c.value }))
          }
          return []
        },
        setAll(list: any[]) {
          list.forEach(({ name, value, options }: any) => cookieStore.set?.(name, value, options))
        },
      },
    }
  )
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createRouteClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createSupabaseAdminClient()

    // Verify profile role
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'coach') return NextResponse.json({ error: 'Not a coach' }, { status: 403 })

    const { id: athleteId } = await params

    // Verify athlete belongs to this coach
    const { data: athleteRow, error: athleteErr } = await admin
      .from('athletes')
      .select('id, athlete_user_id')
      .eq('id', athleteId)
      .eq('coach_id', user.id)
      .single()

    if (athleteErr || !athleteRow) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    }

    // Delete in dependency order to avoid FK conflicts
    // 1. Session videos
    const { data: sessionRows } = await admin
      .from('sessions')
      .select('id')
      .eq('athlete_id', athleteId)

    const sessionIds = (sessionRows ?? []).map((s: any) => s.id)

    if (sessionIds.length > 0) {
      await admin.from('session_videos').delete().in('session_id', sessionIds)
    }

    // 2. Sessions
    await admin.from('sessions').delete().eq('athlete_id', athleteId)

    // 3. Notes
    await admin.from('notes').delete().eq('athlete_id', athleteId)

    // 4. Calendar events
    await admin.from('calendar_events').delete().eq('athlete_id', athleteId)

    // 5. Wellness check-ins (if table exists)
    await admin.from('wellness_checkins').delete().eq('athlete_id', athleteId).catch(() => null)

    // 6. Messages (if table exists)
    await admin.from('messages').delete().eq('athlete_id', athleteId).catch(() => null)

    // 7. Caretakers (if table exists)
    await admin.from('athlete_caretakers').delete().eq('athlete_id', athleteId).catch(() => null)

    // 8. Delete athlete row
    const { error: delErr } = await admin
      .from('athletes')
      .delete()
      .eq('id', athleteId)
      .eq('coach_id', user.id)

    if (delErr) return NextResponse.json({ error: `Failed to delete athlete: ${delErr.message}` }, { status: 500 })

    // 9. Delete Supabase auth user if they had an account
    if (athleteRow.athlete_user_id) {
      await admin.auth.admin.deleteUser(athleteRow.athlete_user_id).catch(() => null)
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}
