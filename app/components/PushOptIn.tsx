'use client'

// Turn notifications on or off for this device.
//
// Push covers a new message, and (for an athlete) a session the coach shared.
// The weekly digest and the takeaway reminder are never pushed. A notification
// names who it is from and nothing else — see lib/push.ts.
//
// Renders NOTHING when push is not configured (no VAPID public key in this
// build), and nothing while it is still finding out, so there is no card that
// flashes in and changes its mind. Every other state says one thing plainly:
// this browser cannot, this iPhone needs the app on the Home Screen first,
// notifications are blocked in settings, or here is the switch.

import { useCallback, useEffect, useState } from 'react'
import {
  currentPushSubscription, pushPublicKey, pushSupport, subscribeToPush,
  syncPushSubscription, unsubscribeFromPush,
} from '@/lib/push-client'
import { errorMessage } from '@/lib/errors'

type View =
  | 'hidden' | 'checking'
  | 'ios-needs-install' | 'ios-too-old' | 'unsupported'
  | 'denied' | 'off' | 'on'

const COPY = {
  athlete: {
    title: 'Get a notification when your coach messages you',
    sub: 'And when they share a session with you. It only says who it’s from — never what they wrote.',
  },
  coach: {
    title: 'Get a notification when an athlete messages you',
    sub: 'It only says who it’s from — never what they wrote.',
  },
} as const

const NOTE: Partial<Record<View, string>> = {
  'ios-needs-install': 'On iPhone and iPad this works once CoachVoice is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.',
  'ios-too-old': 'Notifications need iOS 16.4 or later on this iPhone or iPad.',
  unsupported: 'This browser can’t show notifications from CoachVoice.',
  denied: 'Notifications are blocked for CoachVoice on this device. Allow them in your browser or phone settings, then come back here.',
}

export default function PushOptIn({ audience }: { audience: 'athlete' | 'coach' }) {
  const [view, setView] = useState<View>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const evaluate = useCallback(async (): Promise<View> => {
    if (!pushPublicKey()) return 'hidden'
    const support = pushSupport()
    if (support !== 'ok') return support
    if (Notification.permission === 'denied') return 'denied'
    const sub = await currentPushSubscription()
    return sub && Notification.permission === 'granted' ? 'on' : 'off'
  }, [])

  useEffect(() => {
    let live = true
    const refresh = () => {
      evaluate().then((v) => { if (live) setView(v) }).catch(() => { if (live) setView('hidden') })
    }
    refresh()
    // Re-saves an existing subscription for whoever is signed in now, which
    // also catches a subscription the browser rotated. A failure here changes
    // nothing on screen: the row saved when it was turned on is still there,
    // and pretending otherwise would show an error for something not asked for.
    syncPushSubscription().catch(() => { /* see above */ })
    // Coming back from the settings app after unblocking should not need a reload.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [evaluate])

  const turnOn = async () => {
    setBusy(true); setError(null)
    try {
      const result = await subscribeToPush()
      setView(result === 'on' ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off')
      // The prompt was dismissed rather than refused: say why nothing changed.
      if (result === 'denied' && Notification.permission !== 'denied') {
        setError('Notifications were not allowed, so they are still off.')
      }
    } catch (e: unknown) {
      setError(errorMessage(e, 'Notifications could not be turned on. Try again.'))
    } finally { setBusy(false) }
  }

  const turnOff = async () => {
    setBusy(true); setError(null)
    try {
      await unsubscribeFromPush()
      setView('off')
    } catch (e: unknown) {
      setError(errorMessage(e, 'Notifications could not be turned off. Try again.'))
    } finally { setBusy(false) }
  }

  if (view === 'hidden' || view === 'checking') return null

  const copy = COPY[audience]
  const note = NOTE[view]

  return (
    <section
      aria-label="Notifications"
      style={{
        minWidth: 0, padding: '16px 18px', borderRadius: 'var(--radius-lg)',
        background: 'var(--panel)', border: '1px solid var(--line)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 'var(--fs-4)', fontWeight: 700, lineHeight: 1.35, color: 'var(--text)', overflowWrap: 'anywhere' }}>
        {copy.title}
      </h3>
      <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-2)', lineHeight: 1.45, color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
        {copy.sub}
      </p>

      {note ? (
        <p style={{ margin: '12px 0 0', fontSize: 'var(--fs-3)', lineHeight: 1.45, color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {note}
        </p>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          {view === 'on' ? (
            <>
              <span role="status" style={{ flex: '1 1 140px', minWidth: 0, fontSize: 'var(--fs-3)', color: 'var(--success)', fontWeight: 600 }}>
                On for this device.
              </span>
              <button type="button" className="btn btn-ghost" onClick={turnOff} disabled={busy} style={{ minHeight: 44, minWidth: 44 }}>
                {busy ? 'Turning off…' : 'Turn off'}
              </button>
            </>
          ) : (
            <>
              <span role="status" style={{ flex: '1 1 140px', minWidth: 0, fontSize: 'var(--fs-3)', color: 'var(--text-2)' }}>
                Off for this device.
              </span>
              <button type="button" className="btn btn-primary" onClick={turnOn} disabled={busy} style={{ minHeight: 44, minWidth: 44 }}>
                {busy ? 'Turning on…' : 'Turn on'}
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', fontSize: 'var(--fs-3)', lineHeight: 1.45, color: 'var(--danger)', overflowWrap: 'anywhere' }}>
          {error}
        </p>
      )}
    </section>
  )
}
