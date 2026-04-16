// app/api/athletes/[id]/route.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

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

// GET /api/athletes/[id]
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createRouteClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await ctx.params

    const { data, error } = await supabase
      .from('athletes')
      .select('id, first_name, last_name, email, athlete_user_id, invited_at, created_at')
      .eq('id', id)
      .eq('coach_id', user.id)
      .single()

    if (error || !data) {
      return NextResponse.json({ error: 'Athlete not found' }, { status: 404 })
    }

    return NextResponse.json({
      athlete: {
        id: data.id,
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        invited_at: data.invited_at,
        created_at: data.created_at,
        status: data.athlete_user_id ? 'ACTIVE' : 'INVITED',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unknown error' }, { status: 500 })
  }
}