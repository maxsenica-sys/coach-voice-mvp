'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
function ResetForm() {
  const router = useRouter()
  const sp = useSearchParams()
  const supabase = createSupabaseBrowserClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
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
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 20px',
    }}>
      <div className="card-lg" style={{ width: '100%', maxWidth: 440, padding: '40px 36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{
            width: 36, height: 36,
            background: 'var(--text)',
            borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>🎙</div>
          <span style={{ fontWeight: 900, fontSize: 15, letterSpacing: -0.3, color: 'var(--text)' }}>
            CoachVoice
          </span>
        </div>
        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22, fontWeight: 500,
              marginBottom: 8, color: 'var(--text)',
            }}>
              Password set!
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-2)' }}>
              Taking you to your portal…
            </p>
          </div>
        ) : (
          <>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26, fontWeight: 500,
              letterSpacing: -0.4,
              color: 'var(--text)',
              margin: '0 0 6px',
            }}>
              Set your password
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 28, lineHeight: 1.6 }}>
              Choose a secure password to access your CoachVoice portal.
            </p>
            {error && (
              <div style={{
                background: 'var(--danger-light)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--danger)',
                marginBottom: 20,
                fontWeight: 600,
              }}>
                {error}
              </div>
            )}
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="label">New password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  autoFocus
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Confirm password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Same password again"
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading || !password || !confirm}
                style={{ marginTop: 4, width: '100%' }}
              >
                {loading ? 'Saving…' : 'Save password & continue →'}
              </button>
            </form>
          </>
        )}
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
