'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '../lib/supabase-browser'
import IntroSequence from '@/app/components/IntroSequence'
import { SPLASH_SESSION_KEY } from '@/app/components/ColdStartSplash'

type Mode = 'login' | 'forgot'

/** Once per device, ever. Deliberately not cleared on sign-out — replaying an
 *  intro at someone who just signed out is punishment, not branding.
 *
 *  To watch it again at any time: /?intro=1 — which is also the only way to see
 *  it once you are signed in, since the middleware sends a signed-in user
 *  straight to their role home and `/` never renders for them. */
const INTRO_SEEN = 'cv_intro_v1'

export default function Home() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  // `next` is set by the middleware when someone was sent here from a page they
  // were already trying to open — a session shared by their coach, usually.
  // They are interrupted, not arriving: no intro plays, and sign-in returns
  // them to what they asked for rather than to their role's home tab.
  const [nextPath] = useState(() => {
    if (typeof window === 'undefined') return ''
    const raw = new URLSearchParams(window.location.search).get('next') ?? ''
    // Same-origin paths only — '//evil.com' or 'https://…' would make this an
    // open redirect.
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : ''
  })

  const [playIntro] = useState(() => {
    if (typeof window === 'undefined') return false
    const q = new URLSearchParams(window.location.search)
    // ?intro=1 always plays it, ignoring the once-per-device flag. This is how
    // the sequence gets watched on demand rather than once and never again.
    if (q.get('intro') === '1') return true
    if (q.get('next')) return false
    try {
      return !localStorage.getItem(INTRO_SEEN)
    } catch {
      return true // private mode: play it, just don't remember
    }
  })

  useEffect(() => {
    if (!playIntro) return
    try { localStorage.setItem(INTRO_SEEN, '1') } catch { /* nothing to do */ }
  }, [playIntro])

  const signIn = async () => {
    if (!email.trim() || !password.trim()) return setMessage('Please enter your email and password.')
    setLoading(true)
    setMessage('')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) return setMessage(error.message)

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single()

    // Claim the cold-start splash before leaving. Whoever just watched the
    // sign-in sequence should not land on the dashboard and immediately watch a
    // compressed version of the same thing.
    try { sessionStorage.setItem(SPLASH_SESSION_KEY, '1') } catch { /* nothing to do */ }

    router.push(nextPath || (profile?.role === 'athlete' ? '/athlete' : '/dashboard'))
  }

  const sendResetEmail = async () => {
    if (!email.trim()) return setMessage('Enter your email first.')
    setLoading(true)
    setMessage('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset`,
    })
    setLoading(false)
    setMessage(error ? error.message : 'Reset email sent — check your inbox.')
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') mode === 'login' ? signIn() : sendResetEmail()
  }

  return (
    <div style={{
      minHeight: '100vh',
      // The ground the intro resolves into, and the one the coach sidebar
      // already paints. Replaces four unrelated browns.
      background: 'var(--grad-ink)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* The amber and indigo radial glows that used to sit here were the only
          two accent hues in the app that appeared nowhere else, at 7-8% alpha,
          imperceptible at arm's length on a phone. */}

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>

        {/* Brand. The mark and wordmark are drawn by the intro, which renders
            its resolved final frame when it is not animating — so this is the
            resting state of the screen as well as the end of the sequence.
            It never blocks: pointer-events: none, and the card below is live
            from the first frame. Tapping the email field is the skip. */}
        <div style={{ position: 'relative', height: 168 }}>
          <IntroSequence play={playIntro} />
        </div>
        <p style={{
          color: 'var(--on-ink-2)', textAlign: 'center', margin: '0 0 22px',
          fontSize: 13, fontWeight: 500, fontStyle: 'italic',
        }}>
          Your private training journal
        </p>

        {/* Card */}
        <div style={{
          background: 'rgba(253,250,245,0.96)',
          border: '1px solid rgba(221,213,198,.6)',
          borderRadius: 20,
          padding: 32,
          boxShadow: '0 20px 60px rgba(0,0,0,.5), 0 4px 12px rgba(0,0,0,.3)',
          backdropFilter: 'blur(12px)',
        }}>
          {mode === 'forgot' ? (
            <>
              <h2 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6, color: 'var(--text)' }}>Reset password</h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
                We'll send a reset link to your inbox.
              </p>
              <label className="label">Email address</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKey}
                style={{ marginBottom: 4 }}
              />
              {message && (
                <p style={{ marginTop: 10, fontSize: 13, color: message.includes('sent') ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                  {message}
                </p>
              )}
              <button
                className="btn btn-primary btn-lg"
                onClick={sendResetEmail}
                disabled={loading}
                style={{ width: '100%', marginTop: 16 }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => { setMode('login'); setMessage('') }}
                style={{ width: '100%', marginTop: 10 }}
              >
                ← Back to sign in
              </button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 19, fontWeight: 800, marginBottom: 4, color: 'var(--text)' }}>Welcome back</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
                Sign in to open your journal.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="label">Email</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={handleKey}
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Your password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKey}
                  />
                </div>
              </div>

              {message && (
                <p style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>{message}</p>
              )}

              <button
                className="btn btn-primary btn-lg"
                onClick={signIn}
                disabled={loading}
                style={{ width: '100%', marginTop: 20 }}
              >
                {loading ? 'Signing in…' : 'Open my journal →'}
              </button>

              <button
                className="btn btn-ghost"
                onClick={() => { setMode('forgot'); setMessage('') }}
                style={{ width: '100%', marginTop: 10, fontSize: 13 }}
              >
                Forgot password?
              </button>

              <div className="divider" style={{ margin: '18px 0' }} />

              <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-2)' }}>
                New to CoachVoice?{' '}
                <Link href="/signup" style={{ color: 'var(--primary-dark)', fontWeight: 700, textDecoration: 'none' }}>
                  Create an account
                </Link>
              </p>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: 'var(--on-ink-2)', fontSize: 12, marginTop: 20 }}>
          © 2026 CoachVoice. All rights reserved.
        </p>
      </div>
    </div>
  )
}
