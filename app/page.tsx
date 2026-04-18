'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '../lib/supabase-browser'

type Mode = 'login' | 'forgot'

export default function Home() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

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

    router.push(profile?.role === 'athlete' ? '/athlete' : '/dashboard')
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
      background: 'linear-gradient(160deg, #1A0E06 0%, #2C1810 35%, #1E1208 65%, #120C06 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle warm glow accents */}
      <div style={{ position: 'absolute', top: '10%', right: '10%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(245,158,11,.08) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '15%', left: '5%', width: 300, height: 300, background: 'radial-gradient(circle, rgba(91,99,245,.07) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>

        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          {/* Notebook icon */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 60,
            height: 60,
            background: 'linear-gradient(135deg, rgba(245,158,11,.25) 0%, rgba(91,99,245,.25) 100%)',
            borderRadius: 18,
            marginBottom: 14,
            border: '1px solid rgba(245,158,11,.3)',
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{ fontSize: 30 }}>📖</span>
          </div>
          <h1 style={{ color: '#F5ECD7', fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.4 }}>
            CoachVoice
          </h1>
          <p style={{ color: 'rgba(245,236,215,0.5)', marginTop: 6, fontSize: 13, fontWeight: 500, fontStyle: 'italic' }}>
            Your private training journal
          </p>
        </div>

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
                <Link href="/signup" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>
                  Create an account
                </Link>
              </p>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(245,236,215,0.3)', fontSize: 12, marginTop: 20 }}>
          © 2025 CoachVoice. All rights reserved.
        </p>
      </div>
    </div>
  )
}
