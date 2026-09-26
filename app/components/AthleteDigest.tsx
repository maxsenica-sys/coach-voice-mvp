'use client'

// The athlete's weekly digest, inside the app — no push, no email.
//
// A look back at one Monday-to-Sunday week: what the coach shared, the lines
// they asked the athlete to carry forward, how the athlete answered, how many
// days they checked in, and anything the coach changed about their
// availability. Which week, and on which days it shows by itself, is
// lib/digest.ts, where the clock rig can run it.
//
// What it will not do, on purpose: count a streak, set a goal, score anything
// the athlete did not give, or mention anyone else. Check-ins are a count of
// days, never "4 of 7" — a denominator turns a recap into a mark.
//
// Rendered inside the athlete page's `.ah-root`, so the page's `ah-` classes
// are available; colours are tokens only.

import type { WeeklyDigest } from '@/lib/digest'
import { digestWeekName, formatWeekRange, replySentence } from '@/lib/digest'
import { regionLabel } from '@/lib/body-map'
import { injuryStatusOption } from '@/lib/injury'

const SUB: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)', letterSpacing: '.18em',
  textTransform: 'uppercase', color: 'var(--text-2)', margin: '14px 0 6px',
}
const BODY: React.CSSProperties = {
  margin: 0, fontSize: 'var(--fs-3)', lineHeight: 1.5, color: 'var(--text)', overflowWrap: 'anywhere',
}
const BTN: React.CSSProperties = { minHeight: 44, minWidth: 44, padding: '0 6px' }

function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' }).replace(',', '')
}

export interface AthleteDigestProps {
  digest: WeeklyDigest
  /** 'auto' = shown by itself on Sun–Tue, and dismissible for the week. 'opened' = from the link. */
  mode: 'auto' | 'opened'
  onDismiss: () => void
  onClose: () => void
}

export default function AthleteDigest({ digest, mode, onDismiss, onClose }: AthleteDigestProps) {
  const name = digestWeekName(digest.week)
  const range = formatWeekRange(digest.week)
  const n = digest.sessions.length
  const replies = replySentence(digest)
  const lower = name.toLowerCase()

  return (
    <section aria-label={`${name}, ${range}`} className="ah-panel" style={{ padding: '14px 16px 8px', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px' }}>
        <span className="ah-eyebrow">{name}</span>
        <span className="ah-when">{range}</span>
      </div>

      <h2 style={{
        margin: '8px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 24,
        lineHeight: 1.15, color: 'var(--text)', overflowWrap: 'anywhere',
      }}>
        {n > 0
          ? `${n} session${n === 1 ? '' : 's'} from your coach`
          : digest.isEmpty ? `Nothing was logged ${lower}.` : `No sessions shared ${lower}.`}
      </h2>

      {n > 0 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {digest.sessions.map((s) => (
            <li key={s.id} style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: 10, alignItems: 'baseline' }}>
              <span className="ah-when">{shortDay(s.iso)}</span>
              <a href={`/sessions/${s.id}`} style={{ ...BODY, fontWeight: 600, textDecoration: 'none', minWidth: 0, display: 'block', padding: '11px 0', margin: '-11px 0' }}>
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      )}

      {digest.takeaways.length > 0 && (
        <>
          <div style={SUB}>What your coach asked you to work on</div>
          <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {digest.takeaways.map((t, i) => (
              <li key={i} style={BODY}>{t}</li>
            ))}
          </ul>
        </>
      )}

      {replies && (
        <>
          <div style={SUB}>Your replies</div>
          <p style={BODY}>{replies}</p>
        </>
      )}

      {/* An empty week has already said so in the heading. */}
      {!digest.isEmpty && (
        <>
          <div style={SUB}>Check-ins</div>
          <p style={BODY}>
            {digest.checkinDays > 0
              ? `You checked in on ${digest.checkinDays} day${digest.checkinDays === 1 ? '' : 's'}.`
              : `No check-ins ${lower}.`}
          </p>
        </>
      )}

      {digest.injuryChanges.length > 0 && (
        <>
          <div style={SUB}>Your availability</div>
          <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {digest.injuryChanges.map((c) => {
              const opt = injuryStatusOption(c.status)
              const where = regionLabel(c.bodyArea)
              const text =
                c.kind === 'cleared' ? `${where}: cleared, back to normal.`
                : `Your coach ${c.kind === 'logged' ? 'noted' : 'updated'} your ${where.toLowerCase()}${opt ? `: ${opt.meaning}` : ''}.`
              return <li key={c.id} style={BODY}>{text}</li>
            })}
          </ul>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, borderTop: '1px solid var(--line)' }}>
        {mode === 'auto' ? (
          <button type="button" className="ah-link" onClick={onDismiss} style={BTN}>
            Hide until next week
          </button>
        ) : (
          <button type="button" className="ah-link" onClick={onClose} style={BTN}>
            Close
          </button>
        )}
      </div>
    </section>
  )
}

/** The way back to the digest on any day: one row, opens the card in place. */
export function DigestLink({ digest, onOpen }: { digest: WeeklyDigest; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="ah-note"
      onClick={onOpen}
      style={{ justifyContent: 'space-between', flexWrap: 'wrap', minHeight: 44 }}
    >
      <span style={{ minWidth: 0 }}>
        {digestWeekName(digest.week)} <span className="ah-when" style={{ marginLeft: 6 }}>{formatWeekRange(digest.week)}</span>
      </span>
      <span aria-hidden style={{ color: 'var(--primary)' }}>→</span>
    </button>
  )
}
