'use client'

import Link from 'next/link'

/* Stadium Night — the screen straight after /signup when the project asks for
 * email confirmation. Same ground and lockup as signup and reset.
 *
 * No floodlight here. Nothing on this screen is live: the next thing that
 * happens is in the user's inbox, not on this page, so the way back to sign in
 * is the record bar's shape without its light. Every decorative box stays
 * inside the viewport — see the note in app/page.tsx. */
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
@media (prefers-reduced-motion: reduce) {
  .sn-rake { animation: none; }
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
.sn-sec {
  display: flex; align-items: center; gap: 12px; padding-top: 14px; border-top: 1px solid var(--border);
  font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em;
  text-transform: uppercase; color: var(--text-2);
}
.sn-state {
  margin-top: 9px; border-radius: 17px; padding: 18px 15px 16px;
  border: 1px solid var(--border); background: color-mix(in srgb, var(--text) 7.5%, transparent);
}
.sn-quiet {
  position: relative; display: flex; align-items: center; width: 100%; min-height: 64px; margin-top: 18px;
  padding: 12px 104px 12px 18px; border-radius: 18px; overflow: hidden; text-decoration: none;
  background: color-mix(in srgb, var(--text) 4.5%, transparent); box-shadow: inset 0 0 0 1px var(--border);
  color: var(--text); font-family: var(--font-cast); font-weight: 800; font-size: 20px; line-height: 1.05;
  letter-spacing: .045em; text-transform: uppercase;
}
.sn-quiet:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }
.sn-quiet .sn-cut {
  position: absolute; right: 0; top: 0; bottom: 0; width: 96px; background: var(--bg);
  clip-path: polygon(30% 0, 100% 0, 100% 100%, 0 100%);
  display: flex; align-items: center; justify-content: flex-end; padding-right: 17px;
}
.sn-quiet .sn-ring {
  width: 36px; height: 36px; border-radius: 50%; flex: none;
  border: 2px solid var(--primary); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}
`

export default function SignupConfirmPage() {
  return (
    <div className="sn-page">
      <style>{SN_CSS}</style>
      <div className="sn-stage" aria-hidden="true">
        <div style={{ background: 'radial-gradient(660px 540px at 50% 118%, color-mix(in srgb, var(--ink-mid) 55%, transparent) 0%, transparent 66%)' }} />
        <div style={{ background: 'radial-gradient(780px 470px at 108% -14%, color-mix(in srgb, var(--primary) 14%, transparent) 0%, transparent 62%), radial-gradient(560px 420px at -16% 12%, color-mix(in srgb, var(--flood) 8%, transparent) 0%, transparent 60%)' }} />
        <div className="sn-rake" />
        <div style={{
          backgroundImage: 'repeating-linear-gradient(to right, color-mix(in srgb, var(--text) 4.5%, transparent) 0 1px, transparent 1px 39px), repeating-linear-gradient(to bottom, color-mix(in srgb, var(--text) 3%, transparent) 0 1px, transparent 1px 39px)',
          WebkitMaskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
          maskImage: 'linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%)',
        }} />
        <div style={{ opacity: 0.5, backgroundImage: 'radial-gradient(color-mix(in srgb, var(--text) 13%, transparent) 0.5px, transparent 0.5px)', backgroundSize: '13px 13px' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 460, margin: '0 auto', padding: '0 20px 32px' }}>
        <header className="sn-head">
          <span className="sn-mark" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" /><path d="M12 18.5V21" />
            </svg>
          </span>
          <div>
            <div className="sn-wordmark">COACHVOICE</div>
            <div className="sn-rolecap">New account</div>
          </div>
        </header>

        <div className="sn-sec">Check your email</div>
        <div className="sn-state">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ color: 'var(--primary)' }} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2.6" y="4.8" width="18.8" height="14.4" rx="3" /><path d="m3.4 7.2 8.6 6 8.6-6" />
          </svg>
          <h1 style={{
            margin: '12px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400,
            fontSize: 29, lineHeight: 1.1, letterSpacing: '-.6px', color: 'var(--text)',
          }}>
            Check your <em style={{ fontStyle: 'italic', fontWeight: 500 }}>email.</em>
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 15, color: 'var(--text-2)', lineHeight: 1.6 }}>
            We&apos;ve sent a confirmation link to your inbox. Click it to activate your account, then come back to sign in.
          </p>
          <Link href="/" className="sn-quiet">
            Go to sign in
            <span className="sn-cut" aria-hidden="true">
              <span className="sn-ring">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4.5 12h14" /><path d="m12.8 6 5.7 6-5.7 6" />
                </svg>
              </span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}
