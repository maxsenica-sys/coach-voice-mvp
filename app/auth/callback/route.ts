import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * Where an emailed Supabase link lands: a password reset (`next=/reset`) or an
 * email confirmation after signup (`next=/signup?finish=1`).
 *
 * The client reads EVERY cookie, the way lib/supabase-route.ts and proxy.ts
 * do. It used to hand @supabase/ssr only four legacy names (sb-access-token,
 * sb-auth-token, …). The browser client stores the PKCE verifier as
 * `sb-<project-ref>-auth-token-code-verifier`, which is none of those, so
 * exchangeCodeForSession never saw it and every reset link failed with "code
 * verifier not found".
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next') ?? '/reset'
  // Same-origin paths only. `new URL('//evil.com', origin)` is evil.com, so an
  // unchecked `next` made this an open redirect behind our own domain.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/\\') ? rawNext : '/reset'
  const isReset = next === '/reset' || next.startsWith('/reset?')

  // Where a failure goes. A reset link that fails shows /reset's own "this
  // link didn't work" state; any other link (signup confirmation) goes to
  // sign in, which says what to do next.
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(
      isReset ? `/reset?error=${encodeURIComponent(reason)}` : `/?error=${encodeURIComponent(reason)}`,
      url.origin,
    ))

  if (!code) {
    return fail('missing_code')
  }

  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    },
  )

  // ✅ Exchange the code for a cookie session
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    // A signup confirmation opened on another device has no verifier here, but
    // Supabase has already confirmed the address by this point — so the next
    // step is simply to sign in. /'s message for `confirm_link` says so.
    return fail(isReset ? error.message : 'confirm_link')
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
