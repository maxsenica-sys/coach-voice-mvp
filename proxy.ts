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
  // No role lookup either: the destination checks the role anyway and sends an
  // athlete onward, so asking here would just be a third round trip.
  const q = request.nextUrl.searchParams
  if (pathname === '/' && !q.has('next') && q.get('intro') !== '1' && looksSignedIn(request)) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
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

    if (isCoachRoute && role !== 'coach') {
      return NextResponse.redirect(new URL('/athlete', request.url))
    }

    if (isAthleteRoute && role !== 'athlete') {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/', '/dashboard/:path*', '/athletes/:path*', '/athlete/:path*', '/sessions/:path*', '/dev/:path*', '/reset'],
}
