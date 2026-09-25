'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'

/* Stadium Night — step three of the password reset. Steps one and two (ask
 * for a link, sent) live on `/`; the emailed link lands here. The step rail
 * says THREE OF THREE so someone who is locked out can see the shape of the
 * thing they are in the middle of.
 *
 * The ground and the components are the same ones app/page.tsx draws. Every
 * decorative box stays inside the viewport (see the note there): the skew is
 * drawn inside boxes, never by transforming a box past the screen edge. */
const SN_CSS = `
.sn-page { min-height: 100vh; min-height: 100dvh; position: relative; background: var(--bg); color: var(--text); }
.sn-stage { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.sn-stage > * { position: absolute; inset: 0; }
.sn-rake {
  width: calc(100% - 46px);
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
.sn-head { display: flex; align-items: center; gap: 10px; padding: 18px 0 16px; }
.sn-mark {
  width: 30px; height: 30px; border-radius: 10px; flex: none;
  border: 1.5px solid var(--primary); color: var(--primary);
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  display: flex; align-items: center; justify-content: center;
}
.sn-wordmark { font-family: var(--font-cast); font-weight: 700; font-size: 16px; letter-spacing: .22em; line-height: 1; color: var(--text); }
.sn-rolecap { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .24em; line-height: 1; color: var(--primary); margin-top: 3px; text-transform: uppercase; }
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
.sn-box input::placeholder { color: var(--text-2); font-weight: 400; }
.sn-eye {
  flex: none; width: 44px; height: 44px; border-radius: 12px; border: 0; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: var(--text-2); cursor: pointer;
}
.sn-tail { flex: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; color: var(--primary); }
.sn-eye:focus-visible, .sn-act:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }
.sn-act {
  position: relative; display: flex; align-items: center; width: 100%; min-height: 64px;
  padding: 12px 104px 12px 18px; border: 0; border-radius: 18px; overflow: hidden;
  background: var(--flood); color: var(--ink-base); text-align: left; cursor: pointer;
  font-family: var(--font-cast); font-weight: 800; font-size: 20px; line-height: 1.05;
  letter-spacing: .045em; text-transform: uppercase;
}
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
/* Not ready yet: the bar is not live, so it does not wear the floodlight. It
   lights when both fields are filled — the flood marks the action that is
   live, and an action you cannot take is not. */
.sn-act:disabled { background: color-mix(in srgb, var(--text) 7.5%, transparent); color: var(--text-2); cursor: not-allowed; box-shadow: inset 0 0 0 1px var(--border); }
.sn-act:disabled .sn-ring { border-color: var(--border); color: var(--text-2); background: transparent; }
.sn-act.sn-busy:disabled { background: var(--flood); color: var(--ink-base); box-shadow: none; cursor: progress; }
.sn-act.sn-busy:disabled .sn-ring { border-color: var(--flood); color: var(--flood); }
.sn-sec {
  display: flex; align-items: center; gap: 12px; padding-top: 14px; border-top: 1px solid var(--border);
  font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em;
  text-transform: uppercase; color: var(--text-2);
}
.sn-sec .sn-of {
  margin-left: auto; display: flex; align-items: center; gap: 7px; white-space: nowrap;
  font-family: var(--font-mono); font-weight: 500; letter-spacing: .06em;
}
.sn-sec .sn-of i { width: 5px; height: 5px; border-radius: 50%; flex: none; background: var(--primary); }
.sn-state {
  margin-top: 9px; border-radius: 17px; padding: 15px 15px 16px;
  border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 4.5%, transparent);
}
.sn-title { font-family: var(--font-display); font-weight: 400; font-size: 22px; line-height: 1.15; letter-spacing: -.3px; color: var(--text); margin: 0; }
.sn-body { font-size: 14px; line-height: 1.5; color: var(--text-2); margin: 6px 0 0; }
.sn-rules { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.sn-rules .sn-segs { display: flex; gap: 3px; width: 64px; flex: none; }
.sn-rules .sn-segs i { height: 4px; flex: 1; border-radius: 2px; background: var(--border); }
.sn-rules .sn-segs i.on { background: var(--primary); }
.sn-rules .sn-rk { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-2); min-width: 0; }
`

function Stage() {
  return (
    <div className="sn-stage" aria-hidden="true">
      <div style={{ background: 'radial-gradient(660px 540px at 50% 118%, color-mix(in srgb, var(--ink-mid) 55%, transparent) 0%, transparent 66%)' }} />
      <div style={{ background: 'radial-gradient(780px 470px at 108% -14%, color-mix(in srgb, var(--primary) 10%, transparent) 0%, transparent 62%), radial-gradient(560px 420px at -16% 12%, color-mix(in srgb, var(--flood) 8%, transparent) 0%, transparent 60%)' }} />
      <div className="sn-rake" />
      <div style={{
        backgroundImage: 'repeating-linear-gradient(to right, color-mix(in srgb, var(--text) 4.5%, transparent) 0 1px, transparent 1px 39px), repeating-linear-gradient(to bottom, color-mix(in srgb, var(--text) 3%, transparent) 0 1px, transparent 1px 39px)',
        WebkitMaskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
        maskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
      }} />
      <div style={{ opacity: 0.5, backgroundImage: 'radial-gradient(color-mix(in srgb, var(--text) 13%, transparent) 0.5px, transparent 0.5px)', backgroundSize: '13px 13px' }} />
    </div>
  )
}

const LockIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.2" y="10.4" width="15.6" height="9.8" rx="3" /><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
  </svg>
)

function ResetForm() {
  const router = useRouter()
  const sp = useSearchParams()
  const supabase = createSupabaseBrowserClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(sp.get('error'))
  const [done, setDone] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) return setError(err.message)
    setDone(true)
    setTimeout(() => router.push('/athlete'), 1800)
  }

  // What the rule strip says — read off the two fields, never stored.
  const longEnough = password.length >= 8
  const matches = confirm.length > 0 && password === confirm
  const lengthText = longEnough
    ? `${password.length} characters`
    : `${password.length} of 8 characters`
  const matchText = !confirm ? 'confirm below' : matches ? 'both match' : 'not matching yet'

  return (
    <div className="sn-page">
      <style>{SN_CSS}</style>
      <Stage />
      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 460, margin: '0 auto', padding: '0 20px 32px' }}>

        <header className="sn-head">
          <span className="sn-mark" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" /><path d="M12 18.5V21" />
            </svg>
          </span>
          <div>
            <div className="sn-wordmark">COACHVOICE</div>
            <div className="sn-rolecap">Password reset</div>
          </div>
        </header>

        <div className="sn-sec">
          <span>{done ? 'Done' : 'Set a new one'}</span>
          <span className="sn-of"><i aria-hidden="true" className={done ? undefined : 'sn-dot-now'} />THREE OF THREE</span>
        </div>

        {done ? (
          <div className="sn-state" role="status" style={{ borderColor: 'var(--success-border)' }}>
            <h1 className="sn-title">Password set.</h1>
            <p className="sn-body">Taking you to your portal…</p>
          </div>
        ) : (
          <div className="sn-state">
            <h1 className="sn-title">Choose a password.</h1>
            <p className="sn-body">Choose a secure password to access your CoachVoice portal.</p>
            {error && (
              <div role="alert" style={{
                marginTop: 14,
                background: 'var(--danger-light)',
                border: '1px solid var(--danger)',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 14,
                lineHeight: 1.45,
                color: 'var(--danger)',
                fontWeight: 600,
                overflowWrap: 'anywhere',
              }}>
                {error}
              </div>
            )}
            <form onSubmit={submit} style={{ marginTop: 16 }}>
              <label htmlFor="sn-new-password" className="sn-k">New password</label>
              <div className="sn-box">
                <LockIcon />
                <input
                  id="sn-new-password"
                  type={show ? 'text' : 'password'}
                  placeholder="At least 8 characters"
                  value={password}
                  autoFocus
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="sn-eye"
                  aria-label={show ? 'Hide passwords' : 'Show passwords'}
                  aria-pressed={show}
                  onClick={() => setShow((v) => !v)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12Z" /><circle cx="12" cy="12" r="3" />
                    {show && <path d="M4 20 20 4" />}
                  </svg>
                </button>
              </div>

              <label htmlFor="sn-confirm-password" className="sn-k" style={{ marginTop: 16 }}>Confirm password</label>
              <div className="sn-box">
                <LockIcon />
                <input
                  id="sn-confirm-password"
                  type={show ? 'text' : 'password'}
                  placeholder="Same password again"
                  value={confirm}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <span className="sn-tail" aria-hidden="true">
                  {matches && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.8 12.6l4.6 4.4 9.8-10" /></svg>
                  )}
                </span>
              </div>

              <div className="sn-rules" aria-live="polite">
                <div className="sn-segs" aria-hidden="true">
                  <i className={longEnough ? 'on' : undefined} />
                  <i className={matches ? 'on' : undefined} />
                </div>
                <div className="sn-rk">{lengthText} · {matchText}</div>
              </div>

              <button
                className={`sn-act${loading ? ' sn-busy' : ''}`}
                type="submit"
                disabled={loading || !password || !confirm}
                style={{ marginTop: 16 }}
              >
                {loading ? 'Saving…' : 'Save and go in'}
                <span className="sn-cut" aria-hidden="true">
                  <span className="sn-ring">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 12h14" /><path d="m12.8 6 5.7 6-5.7 6" />
                    </svg>
                  </span>
                </span>
              </button>
            </form>
          </div>
        )}

        <p style={{
          margin: '20px 0 0', paddingTop: 12, borderTop: '1px solid var(--border)', textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--t-furniture)', letterSpacing: '.07em', color: 'var(--text-2)',
        }}>
          © 2026 COACHVOICE
        </p>
      </div>
    </div>
  )
}
export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  )
}
