'use client'

/* AthleteSwitcher — go from one athlete's profile to another's without the
 * round trip through the roster.
 *
 * A coach with fifteen to twenty athletes working down a list after training
 * used to tap back to the dashboard, find the next name, and tap in again —
 * twice the taps per athlete, and the profile tab they were on was lost every
 * time. This is a sheet over the profile holding the same AthletePicker the
 * recorder uses (search from seven athletes up, squad filter, every name in
 * alphabetical order, nothing truncated), so the way a coach finds an athlete
 * is the same wherever they are.
 *
 * It owns only the sheet and its data. What a pick DOES — which URL, which tab
 * survives — is the page's decision, passed in as `onPick`. Mount it only while
 * it is open: the roster is read fresh on every open, so an athlete added on
 * another device is there the next time the coach looks.
 *
 * Three states, never conflated (see ListState): a roster we could not read is
 * said so, with a retry, and is never drawn as an empty squad. A squad list we
 * could not read is simply left out — the filter is a convenience, and every
 * athlete is still in the list without it.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import AthletePicker, { type PickerSquad } from '@/app/components/AthletePicker'
import ListState from '@/app/components/ListState'
import { apiJson } from '@/lib/api-client'
import { byName, type NamedAthlete } from '@/lib/athlete-filter'
import { errorMessage } from '@/lib/errors'

interface Props {
  /** The athlete whose profile is on screen. */
  currentId: string
  /** Their name as the page shows it, for the "Viewing" line. */
  currentName: string
  onPick: (id: string) => void
  onClose: () => void
}

const CAST: CSSProperties = { fontFamily: 'var(--font-cast)', textTransform: 'uppercase' }

/* Layout only — a bottom sheet on a phone, a centred sheet on a wider screen.
 * Inline styles cannot hold a media query. Same geometry as the recorder's
 * sheet so the two feel like one family. */
const LAYOUT_CSS = `
.as-scrim { align-items: flex-end; padding: 56px 0 0; }
.as-sheet { height: 100%; border-radius: 28px 28px 0 0; }
@media (min-width: 640px) {
  .as-scrim { align-items: center; padding: 24px; }
  .as-sheet { height: min(820px, 100%); border-radius: 28px; border: 1px solid var(--border); }
}
`

export default function AthleteSwitcher({ currentId, currentName, onPick, onClose }: Props) {
  const [athletes, setAthletes] = useState<NamedAthlete[] | null>(null)
  const [squads, setSquads] = useState<PickerSquad[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Parent callbacks held in a ref, so a parent that re-creates them on every
  // render cannot re-fire the effects below (CLAUDE.md checklist #3).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // ── Roster + squads, fetched when the sheet opens and on Retry ─────────
  // A roster already on screen stays visible while it refreshes; only a first
  // load shows the loading line.
  const retry = () => { setLoading(true); setError(null); setReload((n) => n + 1) }
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [roster, groups] = await Promise.allSettled([
        apiJson<{ athletes?: NamedAthlete[] }>('/api/athletes', { cache: 'no-store' }),
        apiJson<{ groups?: { id: string; name: string; member_ids?: string[] }[] }>('/api/groups', { cache: 'no-store' }),
      ])
      if (cancelled) return
      if (roster.status === 'fulfilled') {
        setAthletes([...(roster.value.athletes ?? [])].sort(byName))
      } else {
        setError(errorMessage(roster.reason, 'Could not load your athletes.'))
      }
      // Squads are optional: on failure the filter is left out, not faked.
      setSquads(groups.status === 'fulfilled'
        ? (groups.value.groups ?? []).map((g) => ({ id: g.id, name: g.name, member_ids: g.member_ids ?? [] }))
        : [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [reload])

  // ── Escape closes; the page behind does not scroll; focus comes back ────
  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current() }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      returnTo?.focus?.()
    }
  }, [])

  // ── Where focus lands ──────────────────────────────────────────────────
  // With a keyboard and a mouse, straight into the search box: typing two
  // letters is the whole interaction. On a phone that would throw up the
  // keyboard over half the list before the coach has decided to search, so
  // focus goes to the dialog itself instead.
  const ready = athletes !== null
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const desktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const search = sheet.querySelector<HTMLInputElement>('input[type="search"]')
    if (desktop && search) search.focus()
    else if (!sheet.contains(document.activeElement)) sheet.focus()
  }, [ready])

  return (
    <div
      className="as-scrim"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--ink-deep) 72%, transparent)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <style>{LAYOUT_CSS}</style>
      <div
        ref={sheetRef}
        className="as-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="as-title"
        tabIndex={-1}
        style={{
          width: '100%', maxWidth: 560, minWidth: 0, outline: 'none',
          background: 'var(--bg)', color: 'var(--text)',
          borderTop: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          padding: '10px 8px 10px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="as-title" style={{ ...CAST, margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '0.08em', lineHeight: 1.1, color: 'var(--text)' }}>
              Switch athlete
            </h2>
            <div style={{ marginTop: 3, fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
              Viewing {currentName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0, width: 44, height: 44, border: 'none', background: 'none', borderRadius: 12,
              color: 'var(--text-2)', fontSize: 24, lineHeight: 1, cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* One scroll, the sheet's own: every athlete is reachable by a
            vertical flick, and the page underneath stays put. */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain',
          padding: '4px 16px calc(24px + env(safe-area-inset-bottom))',
        }}>
          {athletes === null || (error && athletes.length === 0) ? (
            <div style={{ marginTop: 14 }}>
              <ListState
                loading={loading}
                error={error}
                isEmpty={false}
                emptyTitle=""
                loadingLabel="Loading your athletes…"
                onRetry={retry}
                compact
              />
            </div>
          ) : athletes.length === 0 ? (
            <div style={{ marginTop: 14 }}>
              <ListState
                loading={false}
                error={null}
                isEmpty
                emptyTitle="No athletes on your roster yet."
                emptyHint="Add athletes from your dashboard, then switch between them here."
                compact
              />
            </div>
          ) : (
            <>
              {error && (
                // A refresh failed but an earlier roster is on screen: say so,
                // and keep every name visible rather than blanking the list.
                <div role="alert" style={{ marginTop: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.45 }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>Could not refresh — this list may be out of date. {error}</span>
                  <button
                    type="button"
                    onClick={retry}
                    style={{ minHeight: 44, padding: '0 6px', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: 'var(--t-body-tight)', cursor: 'pointer' }}
                  >
                    Try again
                  </button>
                </div>
              )}
              {/* foldOnPick off: here the list IS the point, so the current
                  athlete stays in it, highlighted, rather than folding the
                  picker into a single "Change" row. */}
              <AthletePicker
                athletes={athletes}
                squads={squads}
                value={currentId}
                foldOnPick={false}
                onChange={(id) => { if (id === currentId) onClose(); else onPick(id) }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
