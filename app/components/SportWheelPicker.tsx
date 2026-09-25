'use client'
import { useState } from 'react'
import { ALL_SPORTS } from '@/lib/sports'
export default function SportWheelPicker({
  value,
  onChange,
  sports,
}: {
  value: string
  onChange: (v: string) => void
  /**
   * The list to choose from. Optional, defaulting to every sport.
   *
   * The signup page has always passed its own filtered list here and this
   * component has always ignored it, reading ALL_SPORTS directly — so typing in
   * the page's sport filter narrowed nothing. It only decided whether the wheel
   * rendered at all, while the wheel itself still showed all 154.
   */
  sports?: string[]
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const source = sports ?? ALL_SPORTS
  const filtered = source.filter(s =>
    s.toLowerCase().includes(search.toLowerCase())
  )
  const CAST: React.CSSProperties = {
    fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase',
  }
  const pick = (v: string) => { onChange(v); setOpen(false); setSearch('') }

  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {/* The current value as a trigger row: what it is for, in the cast face,
          over the sport itself. The tick is sage — a chosen value is not one
          of the floodlight's states. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="input"
        style={{
          width: '100%',
          minHeight: 56,
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          borderRadius: 14,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ ...CAST, display: 'block', fontSize: 'var(--t-furniture)', letterSpacing: '0.2em', color: 'var(--text-2)' }}>
            Your sport
          </span>
          <span style={{
            ...CAST, display: 'block', marginTop: 2, fontSize: 18, letterSpacing: '0.05em', lineHeight: 1.15,
            color: value ? 'var(--text)' : 'var(--text-muted)', overflowWrap: 'anywhere',
          }}>
            {value || 'Select sport…'}
          </span>
        </span>
        {value && (
          <span aria-hidden="true" style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            background: 'var(--primary)', color: 'var(--on-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800,
          }}>✓</span>
        )}
        <span aria-hidden="true" style={{
          fontSize: 18, lineHeight: 1, color: 'var(--text-2)', flexShrink: 0,
          transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform .12s',
        }}>›</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 300,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 12px 32px -4px rgb(0 0 0 / .5)',
            marginTop: 6,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '10px 12px 8px' }}>
            <input
              className="input"
              style={{ fontSize: 'var(--t-body)', padding: '10px 12px', minHeight: 44, background: 'var(--bg)', borderRadius: 12 }}
              placeholder={`Search ${source.length} sports…`}
              aria-label="Search sports"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
              marginTop: 10, paddingBottom: 6, borderBottom: '1px solid var(--text-muted)',
            }}>
              <span style={{ ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.2em', color: 'var(--text-2)' }}>
                {value ? 'Change it to' : 'Choose one'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {filtered.length} of {source.length}
              </span>
            </div>
          </div>
          <div style={{ maxHeight: 264, overflowY: 'auto', padding: '0 12px 6px' }}>
            <button
              type="button"
              onClick={() => pick('')}
              style={{
                width: '100%',
                minHeight: 44,
                padding: '8px 4px',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: !value ? 'var(--primary-light)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 'var(--t-body-tight)',
                color: 'var(--text-2)',
              }}
            >
              — None —
            </button>
            {filtered.length === 0 && (
              <div style={{ padding: '14px 4px', fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                No sport matches “{search}”. Try a shorter word.
              </div>
            )}
            {filtered.map(s => {
              const on = value === s
              return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => pick(s)}
                style={{
                  ...CAST,
                  width: '100%',
                  minHeight: 44,
                  padding: '8px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 16,
                  letterSpacing: '0.06em',
                  color: on ? 'var(--primary)' : 'var(--text)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s}</span>
                {on
                  ? <span aria-hidden="true" style={{ fontSize: 15, color: 'var(--primary)' }}>✓</span>
                  : <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, color: 'var(--text-muted)' }}>›</span>}
              </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
