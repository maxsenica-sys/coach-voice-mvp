'use client'

/**
 * PendingRecordings — what is still on this phone.
 *
 * The visible half of the offline queue. It drains automatically when the
 * browser regains a connection and on every mount, and it shows the coach
 * exactly what is waiting rather than leaving them to trust that something,
 * somewhere, will send.
 *
 * ── Why it is visible at all ─────────────────────────────────────────────
 *
 * A silent background queue is worse than no queue, because the coach's mental
 * model becomes "I recorded it, it is fine" with nothing to check. If a
 * recording cannot be sent — a deleted athlete, a transcription that keeps
 * failing — the only honest thing is to say so on the screen they open every
 * day, next to a button that tries again.
 *
 * ── Renders nothing when the queue is empty ──────────────────────────────
 *
 * Which is almost always. This is the same rule as the "Quiet lately" strip:
 * a panel that exists to say "nothing to report" is a panel that gets ignored,
 * and then it is still ignored on the one day it matters.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteRecording,
  isAbandoned,
  listRecordings,
  type PendingRecording,
} from '@/lib/recording-queue'
import { syncRecording } from '@/lib/recording-sync'

function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function describe(rec: PendingRecording): string {
  if (!rec.ready) return 'Recorded, not saved yet'
  if (!rec.transcript) return 'Waiting to transcribe'
  return 'Waiting to send'
}

export default function PendingRecordings({ onSynced }: { onSynced?: () => void }) {
  const [pending, setPending] = useState<PendingRecording[]>([])
  const [busy, setBusy] = useState(false)
  // Guards against two drains overlapping — the online event and the mount
  // effect can fire within milliseconds of each other, and a double drain
  // could attempt the same non-idempotent save twice.
  const drainingRef = useRef(false)

  const refresh = useCallback(async () => {
    const all = await listRecordings()
    // Sweep recordings the coach abandoned long ago before showing anything,
    // so a forgotten blob does not sit in the panel forever asking to be dealt
    // with. Only ever applies to rows that were never marked ready.
    const live: PendingRecording[] = []
    for (const rec of all) {
      if (isAbandoned(rec)) await deleteRecording(rec.id)
      else live.push(rec)
    }
    setPending(live)
    return live
  }, [])

  const drain = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    setBusy(true)
    try {
      const live = await refresh()
      let anySaved = false
      for (const rec of live) {
        // Only rows the coach has actually asked to save are pushed all the
        // way. An unsaved recording still gets its upload and transcription
        // done in the background, which is what makes reopening it fast.
        const result = await syncRecording(rec)
        if (result.done) anySaved = true
      }
      await refresh()
      if (anySaved) onSynced?.()
    } finally {
      drainingRef.current = false
      setBusy(false)
    }
  }, [refresh, onSynced])

  useEffect(() => {
    void drain()
    const onOnline = () => { void drain() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [drain])

  if (pending.length === 0) return null

  return (
    <section aria-label="Recordings waiting on this device">
      <div style={{
        fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)',
        textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 9,
      }}>
        On this phone
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginBottom: 11, lineHeight: 1.5 }}>
          {pending.length === 1 ? 'One recording is' : `${pending.length} recordings are`} saved
          on this device and not sent yet. They send themselves when you have signal.
        </div>

        {pending.map((rec) => (
          <div
            key={rec.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              paddingTop: 10, borderTop: '1px solid var(--border-soft)',
            }}
          >
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text)' }}>
                {rec.targetLabel}
              </div>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-muted)', marginTop: 2 }}>
                {describe(rec)} · {ago(rec.createdAt)}
              </div>
              {rec.lastError && (
                <div style={{ fontSize: 'var(--fs-2)', color: 'var(--wellness-low)', marginTop: 3, lineHeight: 1.45 }}>
                  {rec.lastError}
                </div>
              )}
            </div>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                // Discarding is deliberate and destructive, so it asks. The
                // audio exists nowhere else.
                if (!window.confirm(`Delete this recording for ${rec.targetLabel}? It is not saved anywhere else.`)) return
                await deleteRecording(rec.id)
                await refresh()
              }}
              style={{ padding: '5px 11px', fontSize: 'var(--fs-2)' }}
            >
              Discard
            </button>
          </div>
        ))}

        <button
          className="btn btn-ghost"
          onClick={() => void drain()}
          disabled={busy}
          style={{ width: '100%', justifyContent: 'center', marginTop: 12, fontSize: 'var(--fs-2)' }}
        >
          {busy ? 'Sending…' : 'Try again now'}
        </button>
      </div>
    </section>
  )
}
