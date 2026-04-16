import { createServerClient } from '@supabase/ssr'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

async function createRouteClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        },
      },
    },
  )
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 1) Confirm the current user is logged in (coach)
  const { id } = await params
  const supabase = await createRouteClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()

  // 2) Fetch athlete row (must belong to this coach)
  const { data: athlete, error: athleteError } = await admin
    .from('athletes')
    .select('id, coach_id, athlete_user_id')
    .eq('id', id)
    .single()

  if (athleteError || !athlete) {
    return NextResponse.json({ error: athleteError?.message ?? 'Athlete not found' }, { status: 404 })
  }

  if (athlete.coach_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 3) Wipe notes linked to this athlete row
  //    (This assumes notes.athlete_id references athletes.id)
  const { error: notesError } = await admin
    .from('notes')
    .delete()
    .eq('athlete_id', athlete.id)

  if (notesError) {
    return NextResponse.json({ error: notesError.message }, { status: 500 })
  }

  // 4) Delete the athlete row (coach <-> athlete relationship)
  const { error: delAthleteError } = await admin
    .from('athletes')
    .delete()
    .eq('id', athlete.id)

  if (delAthleteError) {
    return NextResponse.json({ error: delAthleteError.message }, { status: 500 })
  }

  // 5) Delete profile row (optional but requested)
  const { error: profileError } = await admin
    .from('profiles')
    .delete()
    .eq('id', athlete.athlete_user_id)

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 })
  }

  // 6) Delete the auth user (this permanently removes login/email)
  const { error: authDelError } = await admin.auth.admin.deleteUser(athlete.athlete_user_id)

  if (authDelError) {
    return NextResponse.json({ error: authDelError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}