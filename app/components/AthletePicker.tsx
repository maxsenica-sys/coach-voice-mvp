'use client'

/* AthletePicker — choosing one athlete (or, with `multiple`, a few) from a
 * roster of any size.
 *
 * What it replaces: a wrap of name chips inside a 132px scroll box, nested in a
 * sheet that itself scrolls. At five athletes that was fine. At fifteen to
 * twenty it was a three-row window a coach had to flick through with a thumb,
 * courtside, to find one name, and the inner box fought the outer one for the
 * gesture.
 *
 * What it does instead:
 *  - A search box (from seven athletes up). Two letters usually find anyone;
 *    matching is by word start, so "ana" finds Ana and not Diana. The rule
 *    lives in lib/athlete-filter.ts and verify:roster R5 holds it.
 *  - A squad filter, when the coach has squads, to cut twenty names to six.
 *  - Every match in a grid that flows with the page. No inner scroll box, so
 *    one scroll gesture reaches every athlete.
 *  - Once someone is picked, the list folds into one row saying who, with a
 *    Change button, so the rest of the form comes up the screen instead of
 *    sitting below twenty names.
 *
 * Nothing is truncated: a long name wraps inside its tile. Tiles are at least
 * 48px tall. Selected is sage, not floodlight, because in the recorder
 * chartreuse means the microphone.
 */

import { useId, useMemo, useState, type CSSProperties } from 'react'
import { filterAthletes, type NamedAthlete } from '@/lib/athlete-filter'

export interface PickerSquad {
  id: string
  name: string
  member_ids: string[]
}

interface SingleProps<T extends NamedAthlete> {
  athletes: T[]
  squads?: PickerSquad[]
  multiple?: false
  value: string
  onChange: (id: string) => void
  /** Rosters at or above this size get the search box. */
  searchFrom?: number
  /** Fold to a one-row "who" summary once someone is picked. Off where the
   *  picker is itself the whole surface, e.g. the profile's switch sheet,
   *  so the current athlete stays highlighted in the list. */
  foldOnPick?: boolean
}

/**
 * Several athletes at once — the recorder's "Several" mode, where one recording
 * is split between two to five athletes. Same search, squad filter and tiles;
 * a tile toggles instead of picking, and the choice folds to every chosen name
 * in full once the coach taps Done.
 */
interface MultiProps<T extends NamedAthlete> {
  athletes: T[]
  squads?: PickerSquad[]
  multiple: true
  value: string[]
  onChange: (ids: string[]) => void
  /** The most that may be chosen. Tiles beyond it are disabled, with a reason. */
  max?: number
  searchFrom?: number
}

type Props<T extends NamedAthlete> = SingleProps<T> | MultiProps<T>

const CAST: CSSProperties = { fontFamily: 'var(--font-cast)', textTransform: 'uppercase' }

function initials(a: NamedAthlete) {
  return `${a.first_name.trim()[0] ?? ''}${a.last_name.trim()[0] ?? ''}`.toUpperCase()
}

export default function AthletePicker<T extends NamedAthlete>(props: Props<T>) {
  // Two components rather than one with branches, so single mode is exactly the
  // picker it was and neither mode's hooks depend on the other's.
  return props.multiple ? <MultiAthletePicker {...props} /> : <SingleAthletePicker {...props} />
}

function SingleAthletePicker<T extends NamedAthlete>({ athletes, squads = [], value, onChange, searchFrom = 7, foldOnPick = true }: SingleProps<T>) {
  const [open, setOpen] = useState(!value || !foldOnPick)
  const [query, setQuery] = useState('')
  const [squadId, setSquadId] = useState('')
  const searchId = useId()

  const squad = squads.find((s) => s.id === squadId) ?? null
  const shown = useMemo(
    () => filterAthletes(athletes, query, squad ? squad.member_ids : null),
    [athletes, query, squad],
  )
  const selected = athletes.find((a) => a.id === value) ?? null

  const pick = (id: string) => {
    onChange(id)
    if (foldOnPick) setOpen(false)
    setQuery('')
  }

  // ── Folded: who this is for, and a way to change it ─────────────────────
  if (selected && !open) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginTop: 10,
        padding: '8px 8px 8px 12px', minHeight: 56, borderRadius: 14,
        border: '1.5px solid var(--primary)', background: 'var(--primary-light)',
      }}>
        <span aria-hidden style={monogram(true)}>{initials(selected)}</span>
        <span style={{ ...CAST, flex: 1, minWidth: 0, fontSize: 17, fontWeight: 800, letterSpacing: '0.06em', lineHeight: 1.15, color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {selected.first_name} {selected.last_name}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Change athlete (currently ${selected.first_name} ${selected.last_name})`}
          style={{
            ...CAST, flexShrink: 0, minHeight: 44, padding: '0 14px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
            fontSize: 14, fontWeight: 700, letterSpacing: '0.12em', cursor: 'pointer',
          }}
        >
          Change
        </button>
      </div>
    )
  }

  const showSearch = athletes.length >= searchFrom

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {showSearch && (
        <div style={{ position: 'relative' }}>
          <label htmlFor={searchId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Find an athlete
          </label>
          <input
            id={searchId}
            className="input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={`Find one of ${athletes.length} athletes…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // One match left: Enter takes it, so typing "so" + Enter is a pick.
            onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) { e.preventDefault(); pick(shown[0].id) } }}
            style={{ width: '100%', minHeight: 48, fontSize: 16, paddingRight: query ? 52 : undefined }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 2, top: 2, width: 44, height: 44, border: 'none', background: 'none',
                color: 'var(--text-2)', fontSize: 20, lineHeight: 1, cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      {squads.length > 0 && (
        <div role="group" aria-label="Filter by squad" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[{ id: '', name: 'All', member_ids: athletes.map((a) => a.id) }, ...squads].map((s) => {
            const on = squadId === s.id
            return (
              <button
                key={s.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setSquadId(on && s.id ? '' : s.id)}
                style={{
                  ...CAST, minHeight: 44, maxWidth: '100%', padding: '4px 13px', borderRadius: 999,
                  border: '1px solid', borderColor: on ? 'var(--text-2)' : 'var(--border)',
                  background: on ? 'var(--surface-2)' : 'transparent', color: on ? 'var(--text)' : 'var(--text-2)',
                  fontSize: 14, fontWeight: 700, letterSpacing: '0.1em', overflowWrap: 'anywhere', cursor: 'pointer',
                }}
              >
                {s.name} <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>{s.member_ids.length}</span>
              </button>
            )
          })}
        </div>
      )}

      {(query || squad) && (
        <div aria-live="polite" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)' }}>
          {shown.length} of {athletes.length}{squad ? ` · ${squad.name}` : ''}
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--border)', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.45 }}>
          {query ? <>Nobody matches “{query}”{squad ? ` in ${squad.name}` : ''}.</> : <>{squad?.name ?? 'This squad'} has no athletes yet.</>}{' '}
          <button
            type="button"
            onClick={() => { setQuery(''); setSquadId('') }}
            style={{ minHeight: 44, padding: '0 6px', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: 'var(--t-body-tight)', cursor: 'pointer' }}
          >
            Show everyone
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 7 }}>
          {shown.map((a) => {
            const on = a.id === value
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => pick(a.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, minHeight: 52,
                  padding: '7px 10px', borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                  border: '1.5px solid', borderColor: on ? 'var(--primary)' : 'var(--border)',
                  background: on ? 'var(--primary)' : 'var(--card)',
                  color: on ? 'var(--on-primary)' : 'var(--text)',
                }}
              >
                <span aria-hidden style={monogram(on)}>{initials(a)}</span>
                <span style={{ ...CAST, minWidth: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>
                  {a.first_name} {a.last_name}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {selected && foldOnPick && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 4px', border: 'none', background: 'none', color: 'var(--text-2)', fontSize: 'var(--t-body-tight)', cursor: 'pointer' }}
        >
          Keep {selected.first_name}
        </button>
      )}
    </div>
  )
}

function MultiAthletePicker<T extends NamedAthlete>({ athletes, squads = [], value, onChange, max = Infinity, searchFrom = 7 }: MultiProps<T>) {
  const [open, setOpen] = useState(value.length === 0)
  const [query, setQuery] = useState('')
  const [squadId, setSquadId] = useState('')
  const searchId = useId()

  const squad = squads.find((s) => s.id === squadId) ?? null
  const shown = useMemo(
    () => filterAthletes(athletes, query, squad ? squad.member_ids : null),
    [athletes, query, squad],
  )
  // In the order they were chosen, which is the order their cards appear in.
  const chosen = value
    .map((id) => athletes.find((a) => a.id === id))
    .filter((a): a is T => Boolean(a))
  const full = value.length >= max

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id))
    else if (!full) onChange([...value, id])
    setQuery('')
  }

  const count = (
    <div aria-live="polite" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', letterSpacing: '0.04em' }}>
      {value.length} chosen{Number.isFinite(max) ? ` · up to ${max}` : ''}
    </div>
  )

  // Every chosen name in full, each removable. Wraps onto as many lines as it
  // takes: this is the coach's confirmation of who the recording is split
  // between, so nothing here is truncated.
  const chosenList = chosen.length > 0 && (
    <div role="list" aria-label="Chosen athletes" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {chosen.map((a) => (
        <span
          key={a.id}
          role="listitem"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', minWidth: 0,
            minHeight: 44, padding: '0 0 0 12px', borderRadius: 999,
            border: '1.5px solid var(--primary)', background: 'var(--primary-light)', color: 'var(--text)',
          }}
        >
          <span style={{ ...CAST, minWidth: 0, fontSize: 15, fontWeight: 800, letterSpacing: '0.05em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>
            {a.first_name} {a.last_name}
          </span>
          <button
            type="button"
            onClick={() => toggle(a.id)}
            aria-label={`Remove ${a.first_name} ${a.last_name}`}
            style={{ flexShrink: 0, width: 44, height: 44, border: 'none', background: 'none', color: 'var(--text-2)', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )

  if (!open && chosen.length > 0) {
    return (
      <div style={{
        marginTop: 10, padding: '10px 8px 10px 12px', borderRadius: 14,
        border: '1.5px solid var(--primary)', background: 'var(--primary-light)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 0 }}>{count}</span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Change who this recording is for"
            style={{
              ...CAST, flexShrink: 0, minHeight: 44, padding: '0 14px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
              fontSize: 14, fontWeight: 700, letterSpacing: '0.12em', cursor: 'pointer',
            }}
          >
            Change
          </button>
        </div>
        <div style={{ ...CAST, fontSize: 17, fontWeight: 800, letterSpacing: '0.06em', lineHeight: 1.3, color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {chosen.map((a) => `${a.first_name} ${a.last_name}`).join(', ')}
        </div>
      </div>
    )
  }

  const showSearch = athletes.length >= searchFrom

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {count}
      {chosenList}

      {showSearch && (
        <div style={{ position: 'relative' }}>
          <label htmlFor={searchId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Find an athlete
          </label>
          <input
            id={searchId}
            className="input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={`Find one of ${athletes.length} athletes…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) { e.preventDefault(); toggle(shown[0].id) } }}
            style={{ width: '100%', minHeight: 48, fontSize: 16, paddingRight: query ? 52 : undefined }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 2, top: 2, width: 44, height: 44, border: 'none', background: 'none',
                color: 'var(--text-2)', fontSize: 20, lineHeight: 1, cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>
      )}

      {squads.length > 0 && (
        <div role="group" aria-label="Filter by squad" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[{ id: '', name: 'All', member_ids: athletes.map((a) => a.id) }, ...squads].map((s) => {
            const on = squadId === s.id
            return (
              <button
                key={s.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setSquadId(on && s.id ? '' : s.id)}
                style={{
                  ...CAST, minHeight: 44, maxWidth: '100%', padding: '4px 13px', borderRadius: 999,
                  border: '1px solid', borderColor: on ? 'var(--text-2)' : 'var(--border)',
                  background: on ? 'var(--surface-2)' : 'transparent', color: on ? 'var(--text)' : 'var(--text-2)',
                  fontSize: 14, fontWeight: 700, letterSpacing: '0.1em', overflowWrap: 'anywhere', cursor: 'pointer',
                }}
              >
                {s.name} <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: 0 }}>{s.member_ids.length}</span>
              </button>
            )
          })}
        </div>
      )}

      {full && (
        <div style={{ fontSize: 'var(--t-body-tight)', lineHeight: 1.4, color: 'var(--text-2)' }}>
          That is {max} — the most one recording can be split between. Remove someone to choose another.
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px dashed var(--border)', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.45 }}>
          {query ? <>Nobody matches “{query}”{squad ? ` in ${squad.name}` : ''}.</> : <>{squad?.name ?? 'This squad'} has no athletes yet.</>}{' '}
          <button
            type="button"
            onClick={() => { setQuery(''); setSquadId('') }}
            style={{ minHeight: 44, padding: '0 6px', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: 'var(--t-body-tight)', cursor: 'pointer' }}
          >
            Show everyone
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 7 }}>
          {shown.map((a) => {
            const on = value.includes(a.id)
            const blocked = !on && full
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                disabled={blocked}
                onClick={() => toggle(a.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, minHeight: 52,
                  padding: '7px 10px', borderRadius: 12, textAlign: 'left',
                  cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.55 : 1,
                  border: '1.5px solid', borderColor: on ? 'var(--primary)' : 'var(--border)',
                  background: on ? 'var(--primary)' : 'var(--card)',
                  color: on ? 'var(--on-primary)' : 'var(--text)',
                }}
              >
                <span aria-hidden style={monogram(on)}>{initials(a)}</span>
                <span style={{ ...CAST, minWidth: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.05em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>
                  {a.first_name} {a.last_name}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {chosen.length > 0 && (
        <button
          type="button"
          onClick={() => { setOpen(false); setQuery('') }}
          style={{
            ...CAST, alignSelf: 'flex-start', minHeight: 44, padding: '0 16px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
            fontSize: 14, fontWeight: 700, letterSpacing: '0.12em', cursor: 'pointer',
          }}
        >
          Done
        </button>
      )}
    </div>
  )
}

function monogram(on: boolean): CSSProperties {
  return {
    flexShrink: 0, width: 32, height: 32, borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-cast)', fontSize: 13, fontWeight: 800, letterSpacing: '0.04em',
    background: on ? 'var(--on-primary)' : 'var(--primary-light)',
    color: on ? 'var(--primary)' : 'var(--primary)',
  }
}
