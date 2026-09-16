'use client'

import Link from 'next/link'

export default function SignupConfirmPage() {
  return (
    <div style={{
      minHeight: '100vh',
      // Matches app/signup/page.tsx — this is the screen immediately after it,
      // and the two were in different palettes from different systems.
      background: 'linear-gradient(135deg, #1F2421 0%, #46603F 50%, #5D7F59 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div className="card-lg" style={{ maxWidth: 440, width: '100%', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Check your email</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.7, marginBottom: 24 }}>
          We&apos;ve sent a confirmation link to your inbox. Click it to activate your account, then come back to sign in.
        </p>
        <Link href="/" className="btn btn-primary btn-lg" style={{ width: '100%', display: 'flex' }}>
          Go to sign in →
        </Link>
      </div>
    </div>
  )
}
