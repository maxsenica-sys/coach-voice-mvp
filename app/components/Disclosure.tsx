'use client'

// app/components/Disclosure.tsx
//
// One row that opens to show more. The one way this app tucks something away.
//
// Max, 2026-11-20: "there seems to be quite a cluster of information ... put
// them in categories ... allocating a lot less room so that the coach sees a
// lot simpler screen ... if people want to go in greater detail" they can.
//
// The rule it serves is CLAUDE.md's "Never remove data": simpler here means a
// thing is one tap away, never that it is gone. So a closed row always says
// what is inside it and how much (`summary`: "3 notes", "2 shared · 6
// private"), and a row whose contents need the reader now is opened by the
// page (`open`), not left for them to find.
//
// What is inside stays mounted while closed, so a list keeps loading, a
// half-typed form keeps its text and an upload keeps its queue. It is only
// hidden. That also means an alert inside a closed row is not seen: a page
// that can show one passes `open` when it does.

import { useId, useState, type ReactNode } from 'react'

export default function Disclosure({
  label, summary, children, defaultOpen = false, open, onToggle, flush = false,
}: {
  label: ReactNode
  /** What is inside, in a few words, shown while closed and open alike. */
  summary?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** Set to take control: the page decides, e.g. to open on an error. */
  open?: boolean
  onToggle?: (open: boolean) => void
  /** No hairline above: for the first row under a heading. */
  flush?: boolean
}) {
  const [own, setOwn] = useState(defaultOpen)
  const isOpen = open ?? own
  const id = useId()
  const toggle = () => { const next = !isOpen; setOwn(next); onToggle?.(next) }

  return (
    <div style={{ minWidth: 0, borderTop: flush ? 'none' : '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={id}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48, minWidth: 0,
          padding: '8px 0', margin: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text)', font: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{
          flex: '1 1 0', minWidth: 0, overflowWrap: 'break-word',
          fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em',
          fontSize: 'var(--t-furniture)', lineHeight: 1.3,
        }}>
          {label}
        </span>
        {summary != null && summary !== '' && (
          // Up to half the row is the summary's own: a long label wraps beside
          // it instead of squeezing a short count until it breaks mid-word.
          <span style={{ flex: '0 0 auto', maxWidth: '50%', minWidth: 0, overflowWrap: 'break-word', textAlign: 'right', fontSize: 'var(--t-furniture)', lineHeight: 1.3, color: 'var(--text-2)' }}>
            {summary}
          </span>
        )}
        <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, color: 'var(--text-2)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div id={id} hidden={!isOpen} style={{ minWidth: 0, paddingBottom: isOpen ? 14 : 0 }}>
        {children}
      </div>
    </div>
  )
}
