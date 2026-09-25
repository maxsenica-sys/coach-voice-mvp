'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '../lib/supabase-browser'
import IntroSequence from '@/app/components/IntroSequence'
import { SPLASH_SESSION_KEY } from '@/lib/boot-shell'

type Mode = 'login' | 'forgot'

/* ── Stadium Night — the front door ──────────────────────────────────────────
 *
 * The one screen with no data on it, so it is carried by the stage and by
 * type: the ink ground with its pitch grid, a skewed beam behind the brand, the
 * Newsreader line, two hairline fields, and the primary action drawn as the
 * record bar — the only floodlight on the screen.
 *
 * Two constraints shape everything decorative here:
 *
 * - The brand itself (mark + wordmark) is IntroSequence's, not this file's.
 *   It is held invisible before first paint by the boot script in
 *   app/layout.tsx and handed back by the component. A second wordmark drawn
 *   here would paint in the first frame — exactly the title flash
 *   tools/boot-smoke.mjs exists to catch — so there is not one.
 * - Every decorative box stays inside the viewport. The mockup's beam and rake
 *   were skewed elements hanging off the screen edge; html/body clip hides
 *   that, and boot-smoke's sideways probe measures element geometry precisely
 *   because the clip hides it. So the skew is drawn inside boxes (an SVG, a
 *   mask) rather than by transforming boxes past the edge.
 *
 * Everything moving here is small-area and low-alpha (the 22s rake, a 2.4s
 * status dot) and stops under prefers-reduced-motion. Nothing large changes
 * luminance: the intro's flash-safety depends on that. */
const SN_CSS = `
.sn-page { min-height: 100vh; min-height: 100dvh; position: relative; background: var(--bg); color: var(--text); }
.sn-stage { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.sn-stage > * { position: absolute; inset: 0; }
.sn-rake {
  width: calc(100% - 46px); /* left + width + right: right yields, so the drift ends at the edge */
  background: linear-gradient(180deg, color-mix(in srgb, var(--flood) 5.5%, transparent), color-mix(in srgb, var(--flood) 2%, transparent) 46%, transparent 84%);
  -webkit-mask-image: linear-gradient(107deg, transparent 0, black 40px, black 250px, transparent 300px);
          mask-image: linear-gradient(107deg, transparent 0, black 40px, black 250px, transparent 300px);
  animation: sn-rake 22s ease-in-out infinite alternate;
}
@keyframes sn-rake {
  from { transform: translateX(0) }
  to { transform: translateX(46px) }
}
.sn-dot-now { animation: sn-breathe 2.4s ease-in-out infinite; }
@keyframes sn-breathe {
  0%, 100% { opacity: 1 }
  50% { opacity: .4 }
}
@media (prefers-reduced-motion: reduce) {
  .sn-rake, .sn-dot-now { animation: none; }
}
.sn-k {
  display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;
  font-family: var(--font-cast); font-weight: 700; font-size: 13px; line-height: 1.2;
  letter-spacing: .26em; text-transform: uppercase; color: var(--text-2);
}
.sn-box {
  display: flex; align-items: center; gap: 11px; min-height: 56px; padding: 0 4px 0 15px;
  border-radius: 16px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--text) 4.5%, transparent);
  transition: border-color .15s, box-shadow .15s, background-color .15s;
}
.sn-box:focus-within {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--text) 7.5%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}
.sn-box > svg { flex: none; color: var(--text-2); }
.sn-box input {
  flex: 1; min-width: 0; height: 54px; padding: 0; margin: 0;
  background: transparent; border: 0; outline: 0; border-radius: 0;
  color: var(--text); font-family: var(--font-sans); font-size: 16px; font-weight: 500;
}
.sn-box input::placeholder { color: var(--text-muted); font-weight: 400; }
.sn-eye {
  flex: none; width: 44px; height: 44px; border-radius: 12px; border: 0; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: var(--text-2); cursor: pointer;
}
.sn-eye:focus-visible, .sn-act:focus-visible, .sn-ghost:focus-visible, .sn-link:focus-visible {
  outline: 2px solid var(--text); outline-offset: 3px;
}
.sn-act {
  position: relative; display: flex; align-items: center; width: 100%; min-height: 64px;
  padding: 12px 104px 12px 18px; border: 0; border-radius: 18px; overflow: hidden;
  background: var(--flood); color: var(--ink-base); text-align: left; cursor: pointer;
  font-family: var(--font-cast); font-weight: 800; font-size: 20px; line-height: 1.05;
  letter-spacing: .045em; text-transform: uppercase;
}
.sn-act:disabled { cursor: progress; }
.sn-act .sn-cut {
  position: absolute; right: 0; top: 0; bottom: 0; width: 96px; background: var(--bg);
  clip-path: polygon(30% 0, 100% 0, 100% 100%, 0 100%);
  display: flex; align-items: center; justify-content: flex-end; padding-right: 17px;
}
.sn-ring {
  width: 36px; height: 36px; border-radius: 50%; flex: none;
  border: 2px solid var(--flood); color: var(--flood);
  background: color-mix(in srgb, var(--flood) 10%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.sn-ghost {
  display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px;
  margin-top: 10px; padding: 0 12px; border: 0; background: transparent; cursor: pointer;
  font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--text-2);
}
.sn-link {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 2px;
  border: 0; background: transparent; cursor: pointer; text-decoration: none;
  font-family: var(--font-sans); font-size: 14px; font-weight: 700; color: var(--primary);
}
.sn-sec {
  display: flex; align-items: center; gap: 12px; padding-top: 14px; border-top: 1px solid var(--border);
  font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em;
  text-transform: uppercase; color: var(--text-2);
}
.sn-sec .sn-of {
  margin-left: auto; display: flex; align-items: center; gap: 7px; white-space: nowrap;
  font-family: var(--font-mono); font-weight: 500; letter-spacing: .06em;
}
.sn-sec .sn-of i { width: 5px; height: 5px; border-radius: 50%; flex: none; background: var(--text-muted); }
.sn-sec .sn-of i.sn-dot-now { background: var(--primary); }
.sn-state {
  margin-top: 9px; border-radius: 17px; padding: 15px 15px 16px;
  border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 7.5%, transparent);
}
.sn-title { font-family: var(--font-display); font-weight: 400; font-size: 22px; line-height: 1.15; letter-spacing: -.3px; color: var(--text); margin: 0; }
.sn-title em { font-style: italic; font-weight: 500; }
.sn-body { font-size: 14px; line-height: 1.5; color: var(--text-2); margin: 6px 0 0; }
.sn-err { margin: 12px 0 0; font-size: 14px; font-weight: 600; line-height: 1.45; color: var(--danger); overflow-wrap: anywhere; }
`

const MailIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.6" y="4.8" width="18.8" height="14.4" rx="3" /><path d="m3.4 7.2 8.6 6 8.6-6" />
  </svg>
)
const LockIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.2" y="10.4" width="15.6" height="9.8" rx="3" /><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
  </svg>
)
const EyeIcon = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z" /><circle cx="12" cy="12" r="3" />
    {!open && <path d="M4 20 20 4" />}
  </svg>
)
const Arrow = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 12h14" /><path d="m12.8 6 5.7 6-5.7 6" />
  </svg>
)

/** The ground: ink, two soft beams, the 22s rake, the 39px pitch grid, grain
 *  at an effective 0.065 alpha. Fixed to the viewport, so the form scrolls
 *  over it on a short phone instead of stretching it. */
function Stage() {
  return (
    <div className="sn-stage" aria-hidden="true">
      <div style={{ background: 'radial-gradient(660px 540px at 50% 118%, color-mix(in srgb, var(--ink-mid) 55%, transparent) 0%, transparent 66%)' }} />
      <div style={{ background: 'radial-gradient(780px 470px at 108% -14%, color-mix(in srgb, var(--primary) 22%, transparent) 0%, transparent 62%), radial-gradient(560px 420px at -16% 12%, color-mix(in srgb, var(--flood) 8%, transparent) 0%, transparent 60%)' }} />
      <div className="sn-rake" />
      <div style={{
        backgroundImage: 'repeating-linear-gradient(to right, color-mix(in srgb, var(--text) 4.5%, transparent) 0 1px, transparent 1px 39px), repeating-linear-gradient(to bottom, color-mix(in srgb, var(--text) 3%, transparent) 0 1px, transparent 1px 39px)',
        // Mask alpha, not a colour: the grid is strongest top-left, fades
        // through the middle of the screen and returns toward the foot.
        WebkitMaskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
        maskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
      }} />
      <div style={{ opacity: 0.5, backgroundImage: 'radial-gradient(color-mix(in srgb, var(--text) 13%, transparent) 0.5px, transparent 0.5px)', backgroundSize: '13px 13px' }} />
    </div>
  )
}

export default function Home() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  // The address a reset link actually went to. Set only on success, so the
  // "It's on its way" block can never appear for a request that failed.
  const [sentTo, setSentTo] = useState('')
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

  // Decided before the document painted, by the inline script in app/layout.tsx
  // — once per device, ever, and never for someone arriving on a `next` link.
  // Read rather than recomputed for the reason the boot shell owns data-boot:
  // the answer had to be known long before this component existed, and two
  // independent answers would disagree exactly when it matters. The `cv_intro_v1`
  // key is consumed there and nowhere else.
  //
  // To watch it again at any time: /?intro=1 — which is also the only way to see
  // it once you are signed in, since the middleware sends a signed-in user
  // straight to their role home and `/` never renders for them.
  const [playIntro] = useState(() => {
    if (typeof window === 'undefined') return false
    return document.documentElement.getAttribute('data-intro') === '1'
  })

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
    setMessage(error ? error.message : '')
    setSentTo(error ? '' : email.trim())
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    if (mode === 'login') signIn()
    else sendResetEmail()
  }

  const toMode = (m: Mode) => { setMode(m); setMessage(''); setSentTo('') }

  return (
    <div className="sn-page">
      <style>{SN_CSS}</style>
      <Stage />

      <div style={{
        position: 'relative', zIndex: 1,
        width: '100%', maxWidth: 460, margin: '0 auto', padding: '0 20px',
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '44px 0 32px' }}>

          {/* ── Hero band ── the one place the pitch grid is broken. The beam
              and its floodlight hairline are drawn inside an SVG that spans
              the column exactly, so the skew never makes a box wider than the
              screen. The hairline is stage lighting at 22% — the same weight
              the approved coach screen gives it — not a use of the flood. */}
          <div style={{ position: 'relative' }}>
            <svg
              aria-hidden="true"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', top: -26, left: -20, width: 'calc(100% + 40px)', height: 'calc(100% + 48px)', pointerEvents: 'none' }}
            >
              <defs>
                <linearGradient id="sn-beam" x1="0" y1="0" x2="1" y2="0.18">
                  <stop offset="0" style={{ stopColor: 'var(--text)', stopOpacity: 0.075 }} />
                  <stop offset="0.62" style={{ stopColor: 'var(--text)', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <polygon points="17,0 100,0 100,100 1,100" fill="url(#sn-beam)" />
              <line x1="17" y1="0" x2="1" y2="100" vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--flood)', strokeOpacity: 0.22, strokeWidth: 1.5 }} />
            </svg>

            {/* Brand. The mark and wordmark are drawn by the intro, which renders
                its resolved final frame when it is not animating — so this is the
                resting state of the screen as well as the end of the sequence.
                It never blocks: pointer-events: none, and the form below is live
                from the first frame. Tapping the email field is the skip. */}
            <div style={{ position: 'relative', height: 224 }}>
              <IntroSequence play={playIntro} />
            </div>
            <p style={{
              position: 'relative', margin: '-30px 0 0', textAlign: 'center',
              fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400,
              fontSize: 20, lineHeight: 1.3, color: 'var(--text)',
            }}>
              Your private training journal.
            </p>
          </div>

          {mode === 'forgot' ? (
            /* ── Password reset, steps one and two of three. Step three is
                /reset, where the emailed link lands. */
            <div style={{ marginTop: 40 }}>
              {sentTo ? (
                <>
                  <div className="sn-sec">
                    <span>Sent</span>
                    <span className="sn-of"><i aria-hidden="true" className="sn-dot-now" />TWO OF THREE</span>
                  </div>
                  <div className="sn-state" role="status">
                    <h2 className="sn-title">It&rsquo;s on its way.</h2>
                    <p className="sn-body">
                      Sent to{' '}
                      <b style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 14, color: 'var(--text)', overflowWrap: 'anywhere' }}>{sentTo}</b>.
                      {' '}Not there in a minute? Look in spam &mdash; nothing is wrong.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0 16px', marginTop: 6 }}>
                      <button type="button" className="sn-link" onClick={sendResetEmail} disabled={loading}>
                        {loading ? 'Sending…' : 'Send it again'}
                      </button>
                      <button type="button" className="sn-link" style={{ color: 'var(--text-2)', fontWeight: 600 }} onClick={() => toMode('login')}>
                        Sign in instead
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="sn-sec">
                    <span>Ask for a link</span>
                    <span className="sn-of"><i aria-hidden="true" className="sn-dot-now" />ONE OF THREE</span>
                  </div>
                  <div className="sn-state">
                    <h2 className="sn-title">You can&rsquo;t get in. <em>That&rsquo;s fixable.</em></h2>
                    <p className="sn-body">Tell us the email you sign in with. Asking again costs nothing.</p>
                    <label htmlFor="sn-reset-email" className="sn-k" style={{ marginTop: 16 }}>Email</label>
                    <div className="sn-box">
                      <MailIcon />
                      <input
                        id="sn-reset-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        autoComplete="email"
                        inputMode="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={handleKey}
                      />
                    </div>
                    {message && <p className="sn-err" role="alert">{message}</p>}
                    <button type="button" className="sn-act" onClick={sendResetEmail} disabled={loading} style={{ marginTop: 16 }}>
                      {loading ? 'Sending…' : 'Email me a link'}
                      <span className="sn-cut" aria-hidden="true"><span className="sn-ring"><Arrow /></span></span>
                    </button>
                    <button type="button" className="sn-ghost" onClick={() => toMode('login')}>
                      &larr; Back to sign in
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 40 }}>
              <label htmlFor="sn-email" className="sn-k">Email</label>
              <div className="sn-box">
                <MailIcon />
                <input
                  id="sn-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKey}
                />
              </div>

              <label htmlFor="sn-password" className="sn-k" style={{ marginTop: 20 }}>Password</label>
              <div className="sn-box">
                <LockIcon />
                <input
                  id="sn-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  value={password}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKey}
                />
                <button
                  type="button"
                  className="sn-eye"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <EyeIcon open={!showPassword} />
                </button>
              </div>

              {message && <p className="sn-err" role="alert">{message}</p>}

              {/* The primary action is the record bar: 64px, the diagonal cut
                  over ink, the flood ring. The screen's one floodlight. */}
              <button type="button" className="sn-act" onClick={signIn} disabled={loading} style={{ marginTop: 28 }}>
                {loading ? 'Signing in…' : 'Open my journal'}
                <span className="sn-cut" aria-hidden="true"><span className="sn-ring"><Arrow /></span></span>
              </button>

              <button type="button" className="sn-ghost" onClick={() => toMode('forgot')}>
                Forgot password?
              </button>
            </div>
          )}
        </div>

        <footer style={{ paddingBottom: 'max(28px, env(safe-area-inset-bottom))' }}>
          {mode === 'login' && (
            <p style={{ margin: 0, paddingTop: 10, borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 14, color: 'var(--text-2)', lineHeight: 1.4 }}>
              New to CoachVoice?{' '}
              <Link href="/signup" className="sn-link">Create an account</Link>
            </p>
          )}
          <p style={{
            margin: '8px 0 0', textAlign: 'center', textTransform: 'uppercase',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--t-furniture)', letterSpacing: '.08em', color: 'var(--text-2)',
          }}>
            © 2026 CoachVoice. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  )
}
