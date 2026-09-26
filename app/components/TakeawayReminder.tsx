'use client'

// The takeaway reminder, inside the app — no push, no email.
//
// On a day the athlete trains, the one line the coach asked them to carry into
// the next session is pinned at the top of their home, with the day's training
// time and the reply chips. Where it goes and when is decided in lib/digest.ts
// (takeawayPlacement); this file only draws it.
//
// The takeaway appears ONCE on the screen. When this card is showing, the
// latest-session card below leaves its "Take into next session" block and its
// reply chips out, and says where they went.
//
// Rendered inside the athlete page's `.ah-root`, so it uses that page's chip
// classes (`ah-chip`, `ah-chips`, `ah-eyebrow`): the three reply options must
// look and behave identically wherever they appear.

import { useState } from 'react'
import { SESSION_RESPONSES, responseOption, type SessionResponse } from '@/lib/session-response'

export interface TakeawayReminderProps {
  takeaway: string
  sessionTitle: string
  sessionHref: string
  /** "4:30pm", or null when the planned session has no time. */
  trainingTime: string | null
  response: SessionResponse | null
  onRespond: (value: SessionResponse) => void
}

export default function TakeawayReminder({
  takeaway, sessionTitle, sessionHref, trainingTime, response, onRespond,
}: TakeawayReminderProps) {
  // Replied already: the answer is shown, and the chips are one tap away so it
  // can still be changed or undone, as it can on the session card.
  const [changing, setChanging] = useState(false)
  const said = responseOption(response)
  const showChips = !said || changing

  return (
    <section
      aria-label="Today’s reminder from your coach"
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20,
        background: 'var(--coach-light)', border: '1px solid var(--coach-border)',
        padding: '14px 16px 15px 19px', minWidth: 0,
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--ember)' }} />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
        <span className="ah-eyebrow" style={{ color: 'var(--ember)', fontWeight: 800 }}>Today: remember —</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text)', letterSpacing: '.04em' }}>
          {trainingTime ? `Training at ${trainingTime} today` : 'Training today'}
        </span>
      </div>

      <p style={{
        margin: '8px 0 0', fontSize: 17, fontWeight: 700, lineHeight: 1.38,
        color: 'var(--text)', overflowWrap: 'anywhere',
      }}>
        {takeaway}
      </p>

      <a
        href={sessionHref}
        style={{
          display: 'inline-flex', alignItems: 'center', minHeight: 44, maxWidth: '100%',
          fontSize: 'var(--fs-2)', color: 'var(--text-2)', textDecoration: 'none', overflowWrap: 'anywhere',
        }}
      >
        From “{sessionTitle}” →
      </a>

      <div style={{ marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--coach-border)' }}>
        {said && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 12px' }}>
            <span style={{ flex: '1 1 160px', minWidth: 0, fontSize: 'var(--fs-3)', color: 'var(--text)' }}>
              You told your coach: <strong>{said.label}</strong>
            </span>
            <button
              type="button"
              className="ah-link lit"
              aria-expanded={changing}
              onClick={() => setChanging((v) => !v)}
              style={{ minHeight: 44, minWidth: 44, padding: '0 4px' }}
            >
              {changing ? 'Done' : 'Change'}
            </button>
          </div>
        )}
        {showChips && (
          <>
            {!said && <div className="ah-eyebrow">Tell your coach</div>}
            <div className="ah-chips">
              {SESSION_RESPONSES.map((opt) => {
                const on = response === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className="ah-chip"
                    aria-pressed={on}
                    onClick={() => { onRespond(opt.value); setChanging(false) }}
                  >
                    <i aria-hidden>
                      {on && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12.5 10 17.5 19 7" /></svg>
                      )}
                    </i>
                    {opt.label}
                  </button>
                )
              })}
            </div>
            <p style={{ margin: '9px 0 0', fontSize: 'var(--fs-2)', lineHeight: 1.45, color: 'var(--text-2)' }}>
              {said
                ? 'Your coach can see this. Tap it again to undo.'
                : 'One tap. Your coach sees which one you picked, and nothing else.'}
            </p>
          </>
        )}
      </div>
    </section>
  )
}
