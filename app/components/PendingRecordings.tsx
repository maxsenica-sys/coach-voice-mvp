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
  listRecordings,
  patchRecording,
  type PendingRecording,
} from '@/lib/recording-queue'
import { syncRecording } from '@/lib/recording-sync'
import { describePending, type FinishAthlete, type FinishGroup } from '@/lib/recording-finish'
import FinishRecordingSheet, { type FinishOutcome } from '@/app/components/FinishRecordingSheet'

function ago(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function PendingRecordings({ onSynced, athletes = [], groups = [], coachSport = null }: {
  onSynced?: () => void
  /** Who an unsaved recording can be finished for. */
  athletes?: FinishAthlete[]
  groups?: FinishGroup[]
  coachSport?: string | null
}) {
  const [pending, setPending] = useState<PendingRecording[]>([])
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState<PendingRecording | null>(null)
  // Guards against two drains overlapping — the online event and the mount
  // effect can fire within milliseconds of each other, and a double drain
  // could attempt the same non-idempotent save twice.
  const drainingRef = useRef(false)

  const refresh = useCallback(async () => {
    // Nothing is swept. Recordings nobody saved used to be deleted after 14
    // days, which threw away the only copy of something a coach said. They
    // now stay until the coach finishes or discards them (lib/recording-finish.ts).
    const live = await listRecordings()
    setPending(live)
    return live
  }, [])

  // onSynced is an inline arrow on the dashboard, so it is a new function on
  // every render. It used to be a dependency of drain, which made drain new on
  // every render, which re-ran the effect below: every toast or unread poll
  // started another drain, and a row left `ready` was POSTed again each time,
  // creating duplicate sessions. Read it through a ref instead.
  const onSyncedRef = useRef(onSynced)
  useEffect(() => { onSyncedRef.current = onSynced }, [onSynced])

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
      if (anySaved) onSyncedRef.current?.()
    } finally {
      drainingRef.current = false
      setBusy(false)
    }
  }, [refresh])

  /* Finishing a recording runs under the same lock as the drain, so the two
   * can never send the same row at once: saving is not idempotent, and a
   * double send is a duplicate session an athlete can see. */
  const exclusive = async <T,>(fn: () => Promise<T>, whenBusy: T): Promise<T> => {
    if (drainingRef.current) return whenBusy
    drainingRef.current = true
    setBusy(true)
    try { return await fn() } finally { drainingRef.current = false; setBusy(false) }
  }

  const transcribeOne = (id: string) => exclusive(async () => {
    const rec = (await listRecordings()).find((r) => r.id === id)
    if (!rec) return { rec: null, error: 'This recording is no longer on this phone.' }
    // Not ready, so syncRecording uploads and transcribes and stops there.
    const out = await syncRecording(rec)
    const after = (await listRecordings()).find((r) => r.id === id) ?? null
    await refresh()
    return { rec: after, error: out.error }
  }, { rec: null, error: 'Another recording is sending. Try again in a moment.' })

  const finishOne = (id: string, patch: Partial<PendingRecording>) => exclusive<FinishOutcome>(async () => {
    await patchRecording(id, patch)
    const rec = (await listRecordings()).find((r) => r.id === id)
    if (!rec) return { done: false, error: 'This recording is no longer on this phone.' }
    const out = await syncRecording(rec)
    await refresh()
    if (out.done) onSyncedRef.current?.()
    return { done: out.done, error: out.error }
  }, { done: false, error: 'Another recording is sending. Try again in a moment.' })

  useEffect(() => {
    void drain()
    const onOnline = () => { void drain() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [drain])

  if (pending.length === 0) return null

  return (
    <section aria-label="Recordings waiting on this device">
      {/* The section head, as every Stadium Night section is set: the name in
          the cast face on the left, the count in mono on the right. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 10, flexWrap: 'wrap', marginBottom: 9,
      }}>
        <div style={{
          fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
          color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.24em',
        }}>
          On this phone
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', fontWeight: 500,
          color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {pending.length} waiting
        </div>
      </div>

      <div className="card" style={{ padding: 16, borderRadius: 'var(--radius-lg)' }}>
        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginBottom: 12, lineHeight: 1.5 }}>
          {pending.length === 1 ? 'One recording is' : `${pending.length} recordings are`} saved
          on this device and not sent yet. Ones you saved send themselves when you have signal;
          ones you did not can be finished here.
        </div>

        {pending.map((rec) => (
          <div
            key={rec.id}
            style={{
              // flex-start, not centre: an error long enough to run to three
              // lines used to leave Discard floating in the middle of it.
              display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
              paddingTop: 12, paddingBottom: 12, borderTop: '1px solid var(--border)',
            }}
          >
            {/* 200px, not 160. The basis decides when the row wraps, and 160
                was measured against 12px meta type and a smaller Discard: at
                13px/14px it leaves a 170px column on a 320px phone, which the
                error string then has to be read down. At 200 the button drops
                to its own line there and the text gets the full width. */}
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                gap: 10, flexWrap: 'wrap',
              }}>
                {/* Wraps, never truncates: this is whose recording it is. */}
                <span style={{
                  fontFamily: 'var(--font-cast)', fontSize: 19, fontWeight: 700, lineHeight: 1.1,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0,
                }}>
                  {rec.targetLabel}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)',
                  textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
                }}>
                  {ago(rec.createdAt)}
                </span>
              </div>
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 5 }}>
                {describePending(rec)}
              </div>
              {rec.lastError && (
                // `overflowWrap: anywhere` only ever acts on a token that
                // cannot fit the column on its own — a signed storage URL, a
                // Postgres error code, an athlete id. Those are exactly what a
                // server error carries, and without this the token runs under
                // the Discard button and off the side of the card, where the
                // page's horizontal clip eats the rest of it silently.
                // Everything still renders; nothing is shortened. It sits on
                // the ground colour, one step darker than the card, so the
                // warm text keeps its contrast whatever the card is lit by.
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  marginTop: 8, padding: '8px 11px', borderRadius: 10,
                  background: 'var(--bg)', border: '1px solid var(--border-soft)',
                }}>
                  <span aria-hidden="true" style={{
                    width: 7, height: 7, borderRadius: '50%', background: 'var(--danger)',
                    flexShrink: 0, marginTop: 7,
                  }} />
                  <span style={{
                    fontSize: 'var(--fs-2)', color: 'var(--danger)', lineHeight: 1.45,
                    overflowWrap: 'anywhere', minWidth: 0,
                  }}>
                    {rec.lastError}
                  </span>
                </div>
              )}
            </div>
            {!rec.ready && (
              <button
                className="btn btn-primary"
                onClick={() => setFinishing(rec)}
                disabled={busy}
                style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, fontSize: 'var(--fs-2)', marginLeft: 'auto', flexShrink: 0 }}
              >
                Finish
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={async () => {
                // Discarding is deliberate and destructive, so it asks. The
                // audio exists nowhere else.
                if (!window.confirm(`Delete this recording for ${rec.targetLabel}? It is not saved anywhere else.`)) return
                await deleteRecording(rec.id)
                await refresh()
              }}
              style={{
                minHeight: 44, padding: '0 16px', borderRadius: 999,
                fontSize: 'var(--fs-2)', marginLeft: rec.ready ? 'auto' : 0, flexShrink: 0,
              }}
            >
              Discard
            </button>
          </div>
        ))}

        {/* Sage, not floodlight. Retrying a send is an action, not a state —
            the floodlight is kept for record, live, unread and now. */}
        <button
          className="btn btn-primary"
          onClick={() => void drain()}
          disabled={busy}
          style={{
            width: '100%', justifyContent: 'center', marginTop: 4, minHeight: 44,
            borderRadius: 999, fontSize: 'var(--fs-3)',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>↻</span>
          {busy ? 'Sending…' : 'Try again now'}
        </button>
      </div>
      {finishing && (
        <FinishRecordingSheet
          rec={finishing}
          athletes={athletes}
          groups={groups}
          coachSport={coachSport}
          busy={busy}
          onTranscribe={() => transcribeOne(finishing.id)}
          onSave={(patch) => finishOne(finishing.id, patch)}
          onClose={() => setFinishing(null)}
        />
      )}
    </section>
  )
}
