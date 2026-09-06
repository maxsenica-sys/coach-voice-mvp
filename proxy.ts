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

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // ✅ Let invite/reset callbacks pass without middleware interference
  if (pathname.startsWith('/reset') || pathname.startsWith('/auth/callback')) {
    return NextResponse.next()
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

  // ✅ Logged in and standing on the sign-in page: send them home.
  // `start_url` is "/" (manifest), so every cold start of the installed app
  // landed here — and this middleware already had the user object in hand and
  // did nothing with it. A coach with a live session was being asked for their
  // password on the way to a screen they were already entitled to.
  if (pathname === '/') {
    // ?intro=1 is the deliberate exception: it is how the opening sequence gets
    // watched at all once you are signed in, since this redirect is otherwise
    // total. It only ever shows the sign-in screen — no data, no access.
    if (request.nextUrl.searchParams.get('intro') === '1') return response

    // Deliberately no role query here. Asking for the role costs a round trip
    // on the critical path of every cold start, and the redirect target then
    // asks for it again — two lookups before anything paints. Send everyone to
    // /dashboard and let the role check below bounce an athlete onward: same
    // number of lookups for an athlete, one fewer for a coach, and one fewer
    // before the first byte for both.
    return NextResponse.redirect(new URL('/dashboard', request.url))
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
