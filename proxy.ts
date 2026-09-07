import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Segment-safe matching:
// - matches "/athlete" and "/athlete/..."
// - does NOT match "/athletes"
function startsWithRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(route + '/')
}

// /dev holds the Hear It prototype — coach-only, same as the dashboard.
const COACH_ROUTES = ['/dashboard', '/athletes', '/dev']
const ATHLETE_ROUTES = ['/athlete']
// Signed-in but role-agnostic: a session page serves the owning coach and the
// athlete it was shared with. The route itself checks which of the two you are.
const SHARED_ROUTES = ['/sessions']

/** Is there a Supabase auth cookie at all? Cheap, local, no network. */
function looksSignedIn(request: NextRequest) {
  return request.cookies.getAll().some((c) => /^sb-.*-auth-token/.test(c.name))
}

/** Which home to send someone to from "/", remembered from the last time this
 *  middleware actually looked the role up.
 *
 *  A routing hint, never a permission. It only ever chooses between two
 *  destinations that both run the full authoritative check below, so a stale or
 *  hand-edited value costs one redirect and grants nothing — the same bargain
 *  `looksSignedIn` already makes. Access control still comes from
 *  `getUser()` plus the `profiles` lookup, and from RLS underneath that. */
const ROLE_HINT = 'cv_role_hint'

function rememberRole(response: NextResponse, role: string) {
  if (role !== 'coach' && role !== 'athlete') return response
  response.cookies.set(ROLE_HINT, role, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180,
  })
  return response
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // ✅ Let invite/reset callbacks pass without middleware interference
  if (pathname.startsWith('/reset') || pathname.startsWith('/auth/callback')) {
    return NextResponse.next()
  }

  // ✅ The app's entry point, handled before any network call.
  //
  // `start_url` is "/", so this runs on every cold start. Validating the
  // session here cost a round trip to Supabase's auth server, and then
  // /dashboard immediately did the same again — two auth calls before a single
  // pixel. The cookie's presence is enough to redirect optimistically; if it
  // turns out to be stale, /dashboard bounces back to /?next=… below, and the
  // `next` guard stops that becoming a loop.
  //
  // Still no role *lookup* here — that would be a third round trip, and the
  // destination re-checks the role regardless. Which home to guess at is the
  // hint's job instead. Sending everyone to /dashboard meant every
  // athlete cold start was "/" → /dashboard → /athlete: three navigations and
  // four Supabase round trips (getUser + profiles, twice) before the first byte
  // of paintable HTML. Nothing branded can cover that wait, because the boot
  // shell in the layout is inside HTML that has not been sent yet — which is
  // the blank screen the shell was built to remove. With the hint an athlete
  // goes straight to /athlete, and the wasted hop and half those round trips
  // disappear.
  const q = request.nextUrl.searchParams
  if (pathname === '/' && !q.has('next') && q.get('intro') !== '1' && looksSignedIn(request)) {
    const home = request.cookies.get(ROLE_HINT)?.value === 'athlete' ? '/athlete' : '/dashboard'
    return NextResponse.redirect(new URL(home, request.url))
  }

  // Supabase response must be returned so cookies are forwarded
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))

          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  // ── Identity, without a round trip where possible ────────────────────────
  //
  // `getUser()` ALWAYS calls the Auth server — that is its contract, and it is
  // why it was the first half of the cold-start stall. `getClaims()` verifies
  // the token's signature locally against a cached JWKS instead, and only falls
  // back to a network call when the project still signs with the legacy shared
  // secret. So this is never slower than what it replaces, and once the project
  // is on asymmetric (ECC/RSA) signing keys it costs nothing at all.
  //
  // This is not a weaker check. The token is still cryptographically verified
  // and its expiry enforced; the verification simply happens here rather than
  // in Supabase. What it cannot see is a session revoked in the last few
  // minutes — the trade the whole Supabase SSR guidance makes for middleware,
  // and RLS still refuses that token's data on every actual query.
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  const userId = typeof claims?.sub === 'string' ? claims.sub : ''
  const user = userId ? { id: userId } : null

  const isCoachRoute = COACH_ROUTES.some((r) => startsWithRoute(pathname, r))
  const isAthleteRoute = ATHLETE_ROUTES.some((r) => startsWithRoute(pathname, r))
  const isSharedRoute = SHARED_ROUTES.some((r) => startsWithRoute(pathname, r))
  const isProtectedRoute = isCoachRoute || isAthleteRoute || isSharedRoute

  // ✅ Not logged in: block protected routes only
  if (!user) {
    if (isProtectedRoute) {
      // Carry where they were going. Every notification email links to a
      // protected route, so without this an athlete who taps "see your session"
      // on a lapsed session lands on the sign-in form and the session they
      // asked for is discarded. `next` is also what tells the sign-in page not
      // to play the intro: that person is interrupted, not a visitor.
      const next = pathname + request.nextUrl.search
      return NextResponse.redirect(
        new URL(`/?next=${encodeURIComponent(next)}`, request.url),
      )
    }
    return response
  }

  // ✅ Logged in: only role-check on protected routes
  if (isProtectedRoute) {
    // The role travels in the token, put there by the custom access token hook
    // in migration 022. That removes the second blocking call: a `profiles`
    // lookup that measured 501ms on average and 1088ms at p95 on this project,
    // paid before any HTML could be sent.
    //
    // The fallback is not decoration. The claim is absent until the hook is
    // enabled in the dashboard, and absent from tokens minted before it was —
    // every already-signed-in user, until their token next refreshes. Without
    // the fallback this would lock all of them out of their own app. It also
    // means this file can ship and be correct before anyone touches Supabase.
    const claimedRole = typeof claims?.user_role === 'string' ? claims.user_role : ''
    let role = claimedRole.toLowerCase()

    if (!role) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      role = (profile?.role ?? '').toLowerCase()
    }

    // Role check passed — allow through

    // If profile not created yet, do nothing (prevents redirect loops)
    if (!role) {
      return response
    }

    // Written on whatever we return, so the hint is refreshed by the very
    // request that proved it — including the redirects, which is how someone
    // who lands on the wrong home once never lands there again.
    if (isCoachRoute && role !== 'coach') {
      return rememberRole(NextResponse.redirect(new URL('/athlete', request.url)), role)
    }

    if (isAthleteRoute && role !== 'athlete') {
      return rememberRole(NextResponse.redirect(new URL('/dashboard', request.url)), role)
    }

    return rememberRole(response, role)
  }

  return response
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/athletes/:path*', '/athlete/:path*', '/sessions/:path*', '/dev/:path*', '/reset'],
}
