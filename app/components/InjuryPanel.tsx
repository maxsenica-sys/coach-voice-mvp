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
import { useEffect, useRef, useState } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { parseISODate } from '@/lib/session-date'
import { regionLabel } from '@/lib/body-map'
import BodyMap from '@/app/components/BodyMap'
import {
  INJURY_STATUSES,
  injuryStatusOption,
  openInjuries,
  type Injury,
  type InjuryStatus,
} from '@/lib/injury'

const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase',
}
const EYEBROW: React.CSSProperties = {
  ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.24em', color: 'var(--text-2)',
}

/* Calm and factual. The three statuses keep the system's own warm three-step
 * from lib/injury.ts — no red, no pulse, no floodlight: a child being hurt is
 * not a live moment, it is a fact about what they can do today. */
function StatusChip({ status }: { status: InjuryStatus }) {
  const opt = injuryStatusOption(status)
  if (!opt) return null
  return (
    <span style={{
      ...CAST, padding: '4px 11px', borderRadius: 999, background: opt.tint, color: opt.color,
      border: `1px solid ${opt.color}`,
      fontSize: 'var(--fs-1)', letterSpacing: '0.14em', whiteSpace: 'nowrap', lineHeight: 1.2,
    }}>
      {opt.label}
    </span>
  )
}

/* "Sun 20 Sep" for a `YYYY-MM-DD`. parseISODate builds local midnight, so the
 * weekday is the one on the coach's own calendar; `new Date('2026-09-20')` is
 * UTC midnight and names the 19th west of Greenwich. An unparseable value is
 * shown as stored rather than dropped. */
function fmtInjuryDate(iso: string): string {
  const d = parseISODate(iso)
  if (!d) return iso
  // Assembled from parts: en-GB's own short form is "Sun, 20 Sept" in current
  // ICU, and the comma and fourth letter are exactly what does not fit a chip.
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' })
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday} ${d.getDate()} ${month}`
}

export default function InjuryPanel({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const [injuries, setInjuries] = useState<Injury[]>([])
  const [loading, setLoading] = useState(true)
  /* A failed READ is kept apart from a failed action. It used to share `error`
   * with the save/patch paths, and the list stayed at its initial [] — so the
   * panel said "{name} is available. Nothing logged." about a child whose
   * record it had not been able to read. That is a clearance to play, issued
   * on no information. `loaded` says whether the list on screen is real. */
  const [loadError, setLoadError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  // Only the newest request for the newest athlete may write the list.
  const loadSeq = useRef(0)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const [area, setArea] = useState<string | null>(null)
  const [status, setStatus] = useState<InjuryStatus>('active')
  const [expected, setExpected] = useState('')
  const [note, setNote] = useState('')

  const load = async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const j = await apiJson<{ injuries?: Injury[] }>(`/api/injuries?athlete_id=${encodeURIComponent(athleteId)}`, { cache: 'no-store' })
      if (seq !== loadSeq.current) return
      setInjuries(j.injuries ?? [])
      setLoaded(true)
    } catch (e: unknown) {
      if (seq !== loadSeq.current) return
      setLoadError(errorMessage(e, 'Could not load injuries'))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }

  useEffect(() => {
    // A different athlete: nothing on screen belongs to them yet.
    setInjuries([]); setLoaded(false); setError('')
    void load()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [athleteId])

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 9 }}>
        <div style={EYEBROW}>
          Availability
        </div>
        {!adding && (
          <button
            className="btn btn-ghost"
            onClick={() => setAdding(true)}
            style={{ padding: '0 16px', fontSize: 'var(--fs-3)', minHeight: 44, borderRadius: 999, color: 'var(--text)' }}
          >
            Log an injury
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 16, borderRadius: 'var(--radius-lg)' }}>
        {loadError ? (
          // We could not find out. Never say "available" on no information,
          // and if an older list is still on screen, say it may be out of date.
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginBottom: open.length > 0 || adding ? 14 : 0 }}>
            <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              {loaded
                ? <>Could not refresh {athleteName}&rsquo;s injuries, so this may be out of date. {loadError}</>
                : <>Could not load {athleteName}&rsquo;s injuries, so their availability is unknown. {loadError}</>}
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => void load()}
              disabled={loading}
              style={{ minHeight: 44, paddingInline: 16, fontSize: 'var(--fs-3)', borderRadius: 999, color: 'var(--text)', background: 'var(--bg)' }}
            >
              {loading ? 'Trying…' : 'Try again'}
            </button>
          </div>
        ) : loading && !loaded ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Loading…</div>
        ) : open.length === 0 && !adding ? (
          // No injuries is the normal state and gets one quiet line, not a
          // celebration and not an empty panel asking to be filled in.
          <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.5 }}>
            {athleteName} is available. Nothing logged.
          </div>
        ) : null}

        {open.map((i, idx) => {
          const opt = injuryStatusOption(i.status)
          return (
          <div key={i.id} style={
            idx > 0 ? { paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--border)' } : undefined
          }>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ ...CAST, fontSize: 24, letterSpacing: '0.03em', lineHeight: 1.05, color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>
                {regionLabel(i.body_area)}
              </span>
              <StatusChip status={i.status} />
            </div>
            {/* What the status means, verbatim from lib/injury.ts. */}
            {opt && (
              <div style={{ fontSize: 'var(--fs-4)', fontWeight: 600, color: 'var(--text)', marginTop: 5 }}>
                {opt.meaning}
              </div>
            )}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5 }}>
              {/* Each date is kept whole: a wrapped line breaks between
                  phrases, never inside "Sun 20 Sep". */}
              <span style={{ whiteSpace: 'nowrap' }}>Since {fmtInjuryDate(i.started_on)}</span>
              {i.expected_return && <> · <span style={{ whiteSpace: 'nowrap' }}>back around {fmtInjuryDate(i.expected_return)}</span></>}
            </div>
            {i.note && (
              // The coach's words, in the reading face.
              <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 'var(--fs-4)', color: 'var(--text-2)', marginTop: 7, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                {i.note}
              </div>
            )}
            <div role="group" aria-label={`Availability for ${regionLabel(i.body_area)}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
              {INJURY_STATUSES.map((o) => {
                const on = i.status === o.value
                return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    // Out and Modified are both visible and reversible on this
                    // screen. Cleared is the one that removes the record.
                    if (o.value === 'cleared' && i.status !== 'cleared') {
                      setConfirmClear(i.id)
                      return
                    }
                    void setInjuryStatus(i.id, o.value)
                  }}
                  title={o.meaning}
                  style={{
                    ...CAST, minWidth: 0, padding: '6px 4px', minHeight: 44, borderRadius: 14,
                    border: `1px solid ${on ? o.color : 'var(--border)'}`,
                    background: on ? o.tint : 'transparent',
                    color: on ? o.color : 'var(--text-2)',
                    fontSize: 17, letterSpacing: '0.1em', cursor: 'pointer',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {o.label}
                </button>
                )
              })}
            </div>

            {confirmClear === i.id && (
              <div
                role="alertdialog"
                aria-label="Confirm clearing this injury"
                style={{
                  marginTop: 10, padding: 12, borderRadius: 12,
                  background: 'var(--wellness-good-tint)',
                  border: '1px solid var(--success-border)',
                }}
              >
                <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text)', lineHeight: 1.5 }}>
                  Mark this as cleared? It comes off the availability list. You can
                  reopen it from <strong>Cleared</strong> below.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary"
                    style={{ minHeight: 44, paddingInline: 16, fontSize: 'var(--fs-3)', borderRadius: 999 }}
                    onClick={() => { setConfirmClear(null); void setInjuryStatus(i.id, 'cleared') }}
                  >
                    Yes, cleared
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ minHeight: 44, paddingInline: 16, fontSize: 'var(--fs-3)', borderRadius: 999, color: 'var(--text)', background: 'var(--bg)' }}
                    onClick={() => setConfirmClear(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          )
        })}

        {adding && (
          <div style={open.length > 0 ? { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' } : undefined}>
            <div style={{ ...EYEBROW, marginBottom: 10 }}>Where is it?</div>
            <BodyMap
              perspective="other"
              // One area per injury, so the map is used single-select here:
              // the last tap wins rather than accumulating.
              selected={area ? [area] : []}
              onChange={(next) => setArea(next.length ? next[next.length - 1] : null)}
            />

            <div style={{ ...EYEBROW, marginTop: 18, marginBottom: 9 }}>
              What can they do?
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {INJURY_STATUSES.filter((o) => o.value !== 'cleared').map((opt) => {
                const on = status === opt.value
                return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setStatus(opt.value)}
                  style={{
                    flex: 1, minWidth: 0, minHeight: 56, borderRadius: 14, padding: '8px 10px',
                    border: `1px solid ${on ? opt.color : 'var(--border)'}`,
                    background: on ? opt.tint : 'transparent',
                    color: on ? opt.color : 'var(--text-2)',
                    fontFamily: 'var(--font-cast)', fontSize: 17, fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
                  }}
                >
                  {opt.label}
                  {/* Colour, not opacity: an 0.85 fade is the step that took
                      small text under 4.5:1 elsewhere on the ink ground. */}
                  <div style={{
                    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-1)', fontWeight: 600,
                    letterSpacing: 0, textTransform: 'none', marginTop: 3,
                    color: on ? 'var(--text)' : 'var(--text-2)',
                  }}>
                    {opt.meaning}
                  </div>
                </button>
                )
              })}
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
                // No inline fontSize: the .input rule sets 16px on phones, and
                // anything smaller makes iOS zoom the page on focus.
                style={{ resize: 'none' }}
                placeholder="Tweaked it landing. Physio Thursday."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => void save()} disabled={saving} style={{ flex: '1 1 auto', minWidth: 0, minHeight: 44, justifyContent: 'center', borderRadius: 999 }}>
                {saving ? 'Saving…' : 'Log it'}
              </button>
              <button className="btn btn-ghost" onClick={reset} disabled={saving} style={{ minHeight: 44, borderRadius: 999, color: 'var(--text)' }}>Cancel</button>
            </div>
          </div>
        )}

        {cleared.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button
              onClick={() => setShowCleared((v) => !v)}
              aria-expanded={showCleared}
              style={{
                ...CAST, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, minHeight: 44,
                fontSize: 15, letterSpacing: '0.14em', color: 'var(--text-2)',
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', transform: showCleared ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>›</span>
              Cleared <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', letterSpacing: 0 }}>({cleared.length})</span>
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
                      style={{ minHeight: 44, paddingInline: 14, fontSize: 'var(--fs-2)', flexShrink: 0, borderRadius: 999, color: 'var(--text)' }}
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
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-2)', marginTop: 10, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{error}</div>
        )}
      </div>
    </div>
  )
}
