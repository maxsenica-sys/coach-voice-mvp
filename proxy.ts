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

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    const role = (profile?.role ?? '').toLowerCase()

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
