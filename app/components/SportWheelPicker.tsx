'use client'
import { useState } from 'react'
import { ALL_SPORTS } from '@/lib/sports'
export default function SportWheelPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = ALL_SPORTS.filter(s =>
    s.toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input"
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <span style={{ color: value ? 'var(--text)' : 'var(--text-muted)' }}>
          {value || 'Select sport…'}
        </span>
        <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
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
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            marginTop: 4,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border-soft)',
            }}
          >
            <input
              className="input"
              style={{ fontSize: 12, padding: '6px 10px' }}
              placeholder="Search sports…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); setSearch('') }}
              style={{
                width: '100%',
                padding: '9px 12px',
                border: 'none',
                background: !value ? 'var(--primary-light)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                color: 'var(--text-muted)',
              }}
            >
              — None —
            </button>
            {filtered.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => { onChange(s); setOpen(false); setSearch('') }}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  border: 'none',
                  background: value === s ? 'var(--primary-light)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  color: value === s ? 'var(--primary)' : 'var(--text)',
                  fontWeight: value === s ? 700 : 400,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
