// lib/supabase-route.ts
// Shared Supabase server client for Next.js Route Handlers.
// Replaces the duplicated createRouteClient() boilerplate across 28+ API files.

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

type CookieLike = { name: string; value: string }

/**
 * One cookie Supabase wants written back, as its `setAll` hands it over.
 *
 * `options` was `any` here and in 25 route files that each redeclared this
 * shape inline. `CookieOptions` is exported by @supabase/ssr and is what
 * `setAll` actually passes, so it costs nothing to say so — and it is what
 * makes `res.cookies.set(name, value, options)` a checked call rather than an
 * unchecked one at 35 call sites.
 */
export type CookieToSet = { name: string; value: string; options?: CookieOptions }

/**
 * The parts of the Next cookie store this file touches.
 *
 * Deliberately structural rather than Next's own `ReadonlyRequestCookies`:
 * the whole reason for `safeGetAll` below is that the shape has differed
 * across Next versions, so the code feature-detects. Naming only what it
 * probes keeps that honest — and keeps it from being `any`, which silenced
 * every typo in this file along with the version differences.
 */
type CookieStore = {
  getAll?: () => readonly CookieLike[]
  get?: (name: string) => { value?: string } | undefined
  set?: (name: string, value: string, options?: CookieOptions) => void
}

/**
 * Creates a Supabase client suitable for Route Handlers (async cookies context).
 * Handles the Next.js cookie store API differences across versions.
 */
export async function createRouteClient() {
  const cookieStore = (await cookies()) as unknown as CookieStore

  const safeGetAll = (): CookieLike[] => {
    if (typeof cookieStore.getAll === 'function') {
      const all = cookieStore.getAll()
      return (all ?? []).map((c) => ({ name: c.name, value: c.value }))
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
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
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
