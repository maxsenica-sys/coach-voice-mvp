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
      background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #1d4ed8 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 16,
            marginBottom: 14,
            backdropFilter: 'blur(8px)',
          }}>
            <span style={{ fontSize: 28 }}>🎙️</span>
          </div>
          <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>
            CoachVoice
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6, fontSize: 14 }}>
            AI-powered coaching, simplified.
          </p>
        </div>

        {/* Card */}
        <div className="card-lg" style={{ padding: 32 }}>
          {mode === 'forgot' ? (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Reset password</h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24 }}>
                We'll send a link to your inbox.
              </p>
              <label className="label">Email address</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKey}
              />
              {message && (
                <p style={{ marginTop: 12, fontSize: 13, color: message.includes('sent') ? 'var(--success)' : 'var(--danger)' }}>
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
                ← Back to login
              </button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Welcome back</h2>
              <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 24 }}>
                Sign in to your account.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="label">Email address</label>
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
                <p style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)' }}>{message}</p>
              )}

              <button
                className="btn btn-primary btn-lg"
                onClick={signIn}
                disabled={loading}
                style={{ width: '100%', marginTop: 20 }}
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                className="btn btn-ghost"
                onClick={() => { setMode('forgot'); setMessage('') }}
                style={{ width: '100%', marginTop: 10, fontSize: 13 }}
              >
                Forgot password?
              </button>

              <div className="divider" style={{ margin: '20px 0' }} />

              <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--text-2)' }}>
                New to CoachVoice?{' '}
                <Link href="/signup" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>
                  Create an account
                </Link>
              </p>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 20 }}>
          © 2025 CoachVoice. All rights reserved.
        </p>
      </div>
    </div>
  )
}
