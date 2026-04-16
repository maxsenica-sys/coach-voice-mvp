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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) return setError(error.message)

    router.push('/athlete')
  }

  return (
    <div style={{ padding: 40, maxWidth: 520 }}>
      <h1>Set your password</h1>

      {error && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #444' }}>
          {error}
        </div>
      )}

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <label style={{ display: 'block', marginBottom: 10 }}>
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 10, marginTop: 6 }}
          />
        </label>

        <button style={{ padding: '10px 14px', border: '1px solid #444' }} disabled={loading}>
          {loading ? 'Saving…' : 'Save password'}
        </button>
      </form>
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
