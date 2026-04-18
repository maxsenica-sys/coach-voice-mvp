// lib/supabase-route.ts
// Shared Supabase server client for Next.js Route Handlers.
// Replaces the duplicated createRouteClient() boilerplate across 28+ API files.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

type CookieLike = { name: string; value: string }
export type CookieToSet = { name: string; value: string; options?: any }

/**
 * Creates a Supabase client suitable for Route Handlers (async cookies context).
 * Handles the Next.js cookie store API differences across versions.
 */
export async function createRouteClient() {
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
        getAll() { return safeGetAll() },
        setAll(cookiesToSet: any[]) {
          cookiesToSet.forEach(({ name, value, options }: any) => {
            cookieStore.set?.(name, value, options)
          })
        },
      },
    },
  )
}

/**
 * Creates a Supabase client that collects cookies-to-set for manual response attachment.
 * Use when you need to return a NextResponse with Set-Cookie headers.
 */
export function createRouteClientWithResponse() {
  const cookiesToSet: CookieToSet[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return [] },
        setAll(toSet: CookieToSet[]) { cookiesToSet.push(...toSet) },
      },
    },
  )

  return { supabase, cookiesToSet }
}

/**
 * Attaches collected Set-Cookie headers to a NextResponse.
 */
export function attachCookies(res: NextResponse, cookiesToSet: CookieToSet[]): NextResponse {
  for (const { name, value, options } of cookiesToSet) {
    res.cookies.set(name, value, options)
  }
  return res
}
