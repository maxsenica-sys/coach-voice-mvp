'use client'

/**
 * InjuryPanel — what this athlete can do right now.
 *
 * Coach-facing and coach-writable. The athlete sees the same facts on their
 * own home, read-only; see the note in `app/api/injuries/route.ts` for why the
 * write is one-directional.
 *
 * ── What it deliberately is not ──────────────────────────────────────────
 *
 * Not a medical record. There is no diagnosis field, no treatment field, and
 * no free-text body description — the area comes from the same fixed
 * vocabulary the athlete taps on their check-in. A coach is not a
 * physiotherapist, and a product used by minors should not invite one to write
 * down what they think is wrong with a child's knee.
 *
 * What it records is **availability**: out, modified, or back. That is the
 * thing a coach decides, and the thing the rest of the app should respect.
 */
import { useEffect, useState } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { regionLabel } from '@/lib/body-map'
import BodyMap from '@/app/components/BodyMap'
import {
  INJURY_STATUSES,
  injuryStatusOption,
  openInjuries,
  type Injury,
  type InjuryStatus,
} from '@/lib/injury'

function StatusChip({ status }: { status: InjuryStatus }) {
  const opt = injuryStatusOption(status)
  if (!opt) return null
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 999, background: opt.tint, color: opt.color,
      fontSize: 'var(--fs-1)', fontWeight: 800, letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {opt.label}
    </span>
  )
}

export default function InjuryPanel({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const [area, setArea] = useState<string | null>(null)
  const [status, setStatus] = useState<InjuryStatus>('active')
  const [expected, setExpected] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    try {
      const j = await apiJson<{ injuries?: Injury[] }>(`/api/injuries?athlete_id=${athleteId}`, { cache: 'no-store' })
      setInjuries(j.injuries ?? [])
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not load injuries'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [athleteId])

  const reset = () => { setArea(null); setStatus('active'); setExpected(''); setNote(''); setAdding(false) }

  const save = async () => {
    if (!area) { setError('Pick where the injury is.'); return }
    setSaving(true)
    setError('')
    try {
      await apiMutate('/api/injuries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          body_area: area,
          status,
          expected_return: expected || null,
          note: note.trim() || null,
        }),
      })
      reset()
      await load()
    } catch (e: unknown) {
      setError(errorMessage(e, 'Could not save that'))
    } finally {
      setSaving(false)
    }
  }

  const setInjuryStatus = async (id: string, next: InjuryStatus) => {
    const previous = injuries
    // Optimistic, and reverted on failure — a status chip that lies about
    // whether a child is cleared to play is the worst thing this panel could do.
    setInjuries((prev) => prev.map((i) => (i.id === id ? { ...i, status: next } : i)))
    try {
      await apiMutate(`/api/injuries?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      await load()
    } catch (e: unknown) {
      setInjuries(previous)
      setError(errorMessage(e, 'Could not change that'))
    }
  }

  const open = openInjuries(injuries)
  /* Cleared injuries, most recent first.
   *
   * `openInjuries` filters `cleared` out, and this panel renders only the open
   * ones — so marking a child Cleared removed the record from the screen with
   * no UI path back to it, from a single tap, with no confirmation. A coach who
   * mis-taps has lost the injury and cannot tell you it ever existed.
   *
   * Two changes, and the second is the one that matters: clearing now asks, and
   * cleared injuries remain reachable and reopenable below. A confirmation
   * prevents the mistake; recoverability survives it. */
  const cleared = injuries
    .filter((i) => i.status === 'cleared')
    .sort((a, b) => b.started_on.localeCompare(a.started_on))
  const [showCleared, setShowCleared] = useState(false)
  const [confirmClear, setConfirmClear] = useState<string | null>(null)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <div style={{ fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
          Availability
        </div>
        {!adding && (
          <button
            className="btn btn-ghost"
            onClick={() => setAdding(true)}
            style={{ padding: '5px 11px', fontSize: 'var(--fs-2)', minHeight: 44 }}
          >
            Log an injury
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 15 }}>
        {loading ? (
          <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-muted)' }}>Loading…</div>
        ) : open.length === 0 && !adding ? (
          // No injuries is the normal state and gets one quiet line, not a
          // celebration and not an empty panel asking to be filled in.
          <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)' }}>
            {athleteName} is available. Nothing logged.
          </div>
        ) : null}

        {open.map((i) => (
          <div key={i.id} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text)' }}>
                {regionLabel(i.body_area)}
              </span>
              <StatusChip status={i.status} />
            </div>
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-muted)', marginTop: 4 }}>
              Since {i.started_on}
              {i.expected_return ? ` · back around ${i.expected_return}` : ''}
            </div>
            {i.note && (
              <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                {i.note}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
              {INJURY_STATUSES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={i.status === opt.value}
                  onClick={() => {
                    // Out and Modified are both visible and reversible on this
                    // screen. Cleared is the one that removes the record.
                    if (opt.value === 'cleared' && i.status !== 'cleared') {
                      setConfirmClear(i.id)
                      return
                    }
                    void setInjuryStatus(i.id, opt.value)
                  }}
                  title={opt.meaning}
                  style={{
                    padding: '6px 11px', minHeight: 44, borderRadius: 999,
                    border: `1px solid ${i.status === opt.value ? opt.color : 'var(--border)'}`,
                    background: i.status === opt.value ? opt.tint : 'var(--card)',
                    color: i.status === opt.value ? opt.color : 'var(--text-2)',
                    fontFamily: 'inherit', fontSize: 'var(--fs-2)',
                    fontWeight: i.status === opt.value ? 800 : 600, cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {confirmClear === i.id && (
              <div
                role="alertdialog"
                aria-label="Confirm clearing this injury"
                style={{
                  marginTop: 10, padding: 11, borderRadius: 10,
                  background: 'var(--wellness-good-tint)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text)', lineHeight: 1.5 }}>
                  Mark this as cleared? It comes off the availability list. You can
                  reopen it from <strong>Cleared</strong> below.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    style={{ minHeight: 44, paddingInline: 16, fontSize: 'var(--fs-3)' }}
                    onClick={() => { setConfirmClear(null); void setInjuryStatus(i.id, 'cleared') }}
                  >
                    Yes, cleared
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ minHeight: 44, paddingInline: 16, fontSize: 'var(--fs-3)' }}
                    onClick={() => setConfirmClear(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {adding && (
          <div>
            <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, marginBottom: 8 }}>Where is it?</div>
            <BodyMap
              // One area per injury, so the map is used single-select here:
              // the last tap wins rather than accumulating.
              selected={area ? [area] : []}
              onChange={(next) => setArea(next.length ? next[next.length - 1] : null)}
            />

            <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, marginTop: 14, marginBottom: 7 }}>
              What can they do?
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {INJURY_STATUSES.filter((o) => o.value !== 'cleared').map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={status === opt.value}
                  onClick={() => setStatus(opt.value)}
                  style={{
                    flex: 1, minWidth: 0, minHeight: 44, borderRadius: 8, padding: '6px 10px',
                    border: `1.5px solid ${status === opt.value ? opt.color : 'var(--border)'}`,
                    background: status === opt.value ? opt.tint : 'var(--card)',
                    color: status === opt.value ? opt.color : 'var(--text-2)',
                    fontFamily: 'inherit', fontSize: 'var(--fs-3)',
                    fontWeight: status === opt.value ? 800 : 600, cursor: 'pointer',
                  }}
                >
                  {opt.label}
                  <div style={{ fontSize: 'var(--fs-1)', fontWeight: 600, marginTop: 2, opacity: 0.85 }}>
                    {opt.meaning}
                  </div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px' }}>
                <label className="label" style={{ display: 'block', marginBottom: 5 }}>
                  Back around (optional)
                </label>
                <input
                  className="input"
                  type="date"
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>
                Note (optional)
              </label>
              <textarea
                className="input"
                rows={2}
                style={{ resize: 'none', fontSize: 13 }}
                placeholder="Tweaked it landing. Physio Thursday."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving} style={{ flex: '1 1 auto', minWidth: 0, justifyContent: 'center' }}>
                {saving ? 'Saving…' : 'Log it'}
              </button>
              <button className="btn btn-ghost" onClick={reset} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}

        {cleared.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <button
              onClick={() => setShowCleared((v) => !v)}
              aria-expanded={showCleared}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, minHeight: 44,
                fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--text-2)',
                fontFamily: 'inherit',
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', transform: showCleared ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
              Cleared ({cleared.length})
            </button>

            {showCleared && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {cleared.map((i) => (
                  <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', minWidth: 0, overflowWrap: 'anywhere' }}>
                      {regionLabel(i.body_area)}{i.note ? ` — ${i.note}` : ''}
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => void setInjuryStatus(i.id, 'recovering')}
                      style={{ minHeight: 44, paddingInline: 14, fontSize: 'var(--fs-2)', flexShrink: 0 }}
                    >
                      Reopen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-2)', marginTop: 10 }}>{error}</div>
        )}
      </div>
    </div>
  )
}
