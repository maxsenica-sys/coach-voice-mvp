'use client'

/**
 * /staff/join?token=… — where an assistant-coach invite email lands.
 *
 * Signed out: say what this is and send them to sign in (returning here) or
 * to create a coach account. The token is kept in this browser for the
 * create-account path, because sign-up can take a detour through a
 * confirmation email; the dashboard brings them back here afterwards.
 *
 * Signed in: ask the server whether this person may accept (the rules are
 * lib/staff-invite.ts acceptBlock), say so plainly, and let them join.
 *
 * The token is never printed on the page. The invited address is shown
 * masked, and only once the token has proven itself.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { forgetTeam, PENDING_INVITE_KEY } from '@/lib/team-client'

type Preview = { ok: boolean; block: string | null; message: string | null; headName: string | null; invitedEmail: string | null }
type View =
  | { kind: 'loading' }
  | { kind: 'no-token' }
  | { kind: 'signed-out'; token: string }
  | { kind: 'ready'; token: string; preview: Preview }
  | { kind: 'joined'; headName: string }
  | { kind: 'error'; message: string; token: string }

const WRAP: React.CSSProperties = { minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', justifyContent: 'center', padding: '48px 16px' }
const COL: React.CSSProperties = { width: '100%', maxWidth: 460, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }
const EYEBROW: React.CSSProperties = { fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 13, letterSpacing: '.26em', textTransform: 'uppercase', color: 'var(--text-2)', margin: 0 }
const TITLE: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 28, lineHeight: 1.2, margin: 0, overflowWrap: 'anywhere' }
const BODY: React.CSSProperties = { fontSize: 'var(--fs-3)', lineHeight: 1.55, color: 'var(--text-2)', margin: 0, overflowWrap: 'anywhere' }

function readToken(): string {
  if (typeof window === 'undefined') return ''
  const t = new URLSearchParams(window.location.search).get('token') ?? ''
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? t : ''
}

export default function StaffJoinPage() {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const token = readToken()
    if (!token) { setView({ kind: 'no-token' }); return }
    let live = true
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!live) return
      if (!user) { setView({ kind: 'signed-out', token }); return }
      try {
        const preview = await apiJson<Preview>(`/api/staff/accept?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
        if (live) setView({ kind: 'ready', token, preview })
      } catch (e: unknown) {
        if (live) setView({ kind: 'error', token, message: errorMessage(e, 'Could not read this invite.') })
      }
    })
    return () => { live = false }
  }, [])

  const rememberForSignup = (token: string) => {
    try { window.localStorage.setItem(PENDING_INVITE_KEY, token) } catch { /* private mode: they can reopen the email link */ }
  }

  const join = async (token: string) => {
    setJoining(true)
    try {
      const out = await apiJson<{ ok: true; headName: string }>('/api/staff/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      try { window.localStorage.removeItem(PENDING_INVITE_KEY) } catch { /* nothing to clear */ }
      forgetTeam()
      setView({ kind: 'joined', headName: out.headName })
    } catch (e: unknown) {
      setView({ kind: 'error', token, message: errorMessage(e, 'Could not accept the invite.') })
    } finally {
      setJoining(false)
    }
  }

  const nextHere = (token: string) => `/?next=${encodeURIComponent(`/staff/join?token=${token}`)}`

  return (
    <main style={WRAP}>
      <div style={COL}>
        <p style={EYEBROW}>CoachVoice · Coaching team</p>

        {view.kind === 'loading' && <p style={BODY} role="status">Reading your invite…</p>}

        {view.kind === 'no-token' && (
          <>
            <h1 style={TITLE}>This invite link is incomplete</h1>
            <p style={BODY}>Open the link from your invite email again. If it still does not work, ask your head coach to send a new one.</p>
          </>
        )}

        {view.kind === 'signed-out' && (
          <>
            <h1 style={TITLE}>You have been invited to join a coaching team</h1>
            <p style={BODY}>
              Sign in, or create a coach account, with the email address the invite was sent to. As an assistant coach you will coach
              the athletes the head coach chose for you: you will see their sessions, messages and wellness check-ins, and you can record
              sessions, message them, and add notes, injuries and videos.
            </p>
            <Link href={nextHere(view.token)} className="btn btn-primary" style={{ minHeight: 44, justifyContent: 'center' }}>
              I have an account — sign in
            </Link>
            <Link href="/signup" onClick={() => rememberForSignup(view.token)} className="btn btn-ghost" style={{ minHeight: 44, justifyContent: 'center' }}>
              Create a coach account
            </Link>
            <p style={{ ...BODY, fontSize: 'var(--fs-2)' }}>If you create an account, choose <strong style={{ color: 'var(--text)' }}>Coach</strong>. You will come back here to finish joining.</p>
          </>
        )}

        {view.kind === 'ready' && (
          <>
            <h1 style={TITLE}>
              {view.preview.headName ? `Join ${view.preview.headName}’s coaching team` : 'Coaching team invite'}
            </h1>
            {view.preview.invitedEmail && <p style={BODY}>This invite was sent to {view.preview.invitedEmail}.</p>}
            {view.preview.ok ? (
              <>
                <p style={BODY}>
                  As an assistant coach you will coach the athletes {view.preview.headName ?? 'the head coach'} chose for you: you will see their
                  sessions, messages and wellness check-ins, and you can record sessions, message them, and add notes, injuries and videos.
                  Those athletes will be told you have joined.
                </p>
                <button type="button" className="btn btn-primary" disabled={joining} onClick={() => void join(view.token)} style={{ minHeight: 44 }}>
                  {joining ? 'Joining…' : 'Join the team'}
                </button>
              </>
            ) : (
              <p role="alert" style={{ ...BODY, color: 'var(--text)' }}>{view.preview.message}</p>
            )}
          </>
        )}

        {view.kind === 'joined' && (
          <>
            <h1 style={TITLE}>You are on {view.headName}&rsquo;s team</h1>
            <p style={BODY}>The athletes they chose for you are on your home screen now.</p>
            <Link href="/dashboard" className="btn btn-primary" style={{ minHeight: 44, justifyContent: 'center' }}>Go to the dashboard</Link>
          </>
        )}

        {view.kind === 'error' && (
          <>
            <h1 style={TITLE}>That did not work</h1>
            <p role="alert" style={{ ...BODY, color: 'var(--text)' }}>{view.message}</p>
            <a href={`/staff/join?token=${view.token}`} className="btn btn-ghost" style={{ minHeight: 44, justifyContent: 'center' }}>Try again</a>
          </>
        )}
      </div>
    </main>
  )
}
