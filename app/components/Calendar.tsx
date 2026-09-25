'use client'

import { useState, useMemo } from 'react'
import {
  carrySelection, currentMonth, daysInMonth, firstWeekday, parseMonth,
  shiftMonth, toDateStr, todayDateStr, toMonthStr, type MonthStr,
} from '@/lib/calendar-month'

export type CalendarEvent = {
  id: string
  athlete_id: string
  created_by_role: 'coach' | 'athlete'
  title: string
  description?: string | null
  event_type: 'session' | 'homework' | 'goal' | 'reminder' | 'other'
  event_date: string // "YYYY-MM-DD"
  event_time?: string | null
  /** Set on session-linked events (migration 013) — lets a calendar entry open
   *  the session it came from. Null on a session the coach has planned but not
   *  yet recorded, which is how an upcoming session is represented. */
  session_id?: string | null
  /** The coach asked this athlete to complete their pre-session check-in on
   *  the day (migration 028). Whether they did is answered by their wellness
   *  check-in for `event_date`, never stored on the event. */
  checkin_requested?: boolean | null
  /** Joined athlete on coach-facing queries; null for the coach's own events. */
  athletes?: { first_name: string; last_name: string } | null
}

type Props = {
  events: CalendarEvent[]
  role: 'coach' | 'athlete'
  /**
   * The month on screen, "YYYY-MM". Required, and owned by the host.
   *
   * It used to be this component's own `useState`, which meant the grid and
   * the host's fetch key were two copies of one fact — and the hosts unmounted
   * the component while fetching, so every arrow press threw away the month it
   * had just set and the grid snapped back to today while the events belonged
   * to the month you asked for. See lib/calendar-month.ts. Required rather
   * than optional on purpose: an optional month would let a future host fall
   * back to local state and quietly reintroduce the whole bug.
   */
  month: MonthStr
  onMonthChange: (monthStr: MonthStr) => void
  onAddEvent?: (date: string) => void
  onDeleteEvent?: (id: string) => void
  /**
   * Dim and disable rather than disappear. Hosts must pass this instead of
   * swapping the calendar out for a "Loading…" line — that unmount is the bug
   * lib/calendar-month.ts describes.
   */
  loading?: boolean
}

/* Two shapes and a glyph, not five colours.
 *
 * These were five stock Tailwind hues carrying meaning in a 6x6px dot with no
 * second channel. Homework and reminder measured ΔE 6.7 apart to NORMAL vision,
 * and 4.4 under tritanopia — a coach was being asked to tell amber from orange
 * at six pixels.
 *
 * A session is the thing the app exists for, so in the month grid it is a
 * FILLED sage mark and every other event is a HOLLOW outlined one. Shape, not
 * colour, is the channel: it survives greyscale, sunlight and every form of
 * colour blindness. A glyph cannot do that job in the grid — at the ~40px a day
 * cell gets on a phone, ✎ and ◆ are the same smudge — so the glyph lives in the
 * day list below, beside the event it names, where it has room to be read. */
const isSessionType = (t: string) => t === 'session'

/** The second channel the dots never had — drawn in the day list. */
export const EVENT_TYPE_GLYPH: Record<string, string> = {
  session:  '●',
  homework: '✎',
  goal:     '◆',
  reminder: '!',
  other:    '·',
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  session:  'Session',
  homework: 'Homework / Task',
  goal:     'Goal',
  reminder: 'Reminder',
  other:    'Other',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* Stadium Night furniture, local to this file. Uppercase labels are the cast
 * face, tracked; dates and times are mono; numerals that are read are the
 * reading face. Nothing here is under 13px. */
const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, textTransform: 'uppercase',
}
const MONO: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 'var(--t-data)',
}

/** A month-grid mark: filled for a session, hollow for anything else. */
function Mark({ session, dim }: { session: boolean; dim?: boolean }) {
  return (
    <span aria-hidden style={{
      width: 8, height: 6, flexShrink: 0, display: 'inline-block',
      transform: 'skewX(-14deg)',
      background: session ? 'var(--primary)' : 'transparent',
      boxShadow: session ? 'none' : 'inset 0 0 0 1.5px var(--text-muted)',
      opacity: dim ? 0.7 : 1,
    }} />
  )
}

/* The arrow buttons and the Today control: 44px targets, hairline, no fill
 * louder than the ground they sit on. */
const NAV_BTN: React.CSSProperties = {
  width: 44, height: 44, flexShrink: 0,
  border: '1px solid var(--border)', borderRadius: 12,
  background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'var(--font-cast)', fontSize: 20, fontWeight: 700, lineHeight: 1,
}

function formatMonthYear({ year, month }: { year: number; month: number }) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function formatTime(time: string | null | undefined) {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')}${period}`
}

export default function Calendar({ events, role, month, onMonthChange, onAddEvent, onDeleteEvent, loading }: Props) {
  // Derived from the prop every render — no copy, nothing to fall out of step,
  // and an unmount cannot lose it.
  const ym = parseMonth(month)
  const todayStr = todayDateStr()
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr)

  /* The selection only counts while it is in the visible month.
   *
   * `goToMonth` carries it across an arrow press, but the month can also
   * change from outside — the host setting `month`, which is what "Jump to
   * their most recent session" does. That left the detail panel headed
   * "Thursday, September 10" below an August grid, reading "No events on this
   * day" about a day not on screen: incoherent, and worst on the one control
   * whose whole job is "your sessions are over here". */
  const monthPrefix = toMonthStr(ym) + '-'
  const selected = selectedDate?.startsWith(monthPrefix) ? selectedDate : null

  const goToMonth = (to: { year: number; month: number }) => {
    // The selection is this component's own — it is a cursor, not data — so it
    // is carried here rather than pushed up to the host.
    setSelectedDate((prev) => carrySelection(prev, to))
    onMonthChange(toMonthStr(to))
  }

  // Index events by date — useMemo so it recomputes only when events change
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const ev of events) {
      if (!map[ev.event_date]) map[ev.event_date] = []
      map[ev.event_date].push(ev)
    }
    return map
  }, [events])

  const selectedEvents = selected ? (eventsByDate[selected] ?? []) : []

  // Grid helpers
  const days = daysInMonth(ym)
  const firstDay = firstWeekday(ym)
  const totalCells = Math.ceil((firstDay + days) / 7) * 7

  /* The one numeral this component carries: how many sessions are in the
   * month on screen. Counted only from events dated inside that month, and
   * withheld while the month is loading — the host keeps the previous month's
   * rows until the new ones land, and a confident "0" about a month we have
   * not fetched yet is the same lie as "No events on this day". */
  const monthEvents = events.filter((e) => e.event_date.startsWith(monthPrefix))
  const sessionCount = monthEvents.filter((e) => isSessionType(e.event_type)).length
  const monthName = new Date(ym.year, ym.month, 1).toLocaleDateString(undefined, { month: 'long' })

  return (
    <div style={{ fontFamily: 'inherit', minWidth: 0 }}>
      {/* Month band: the count, the month, the year, the arrows. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 180px', minWidth: 0 }}>
          <span
            aria-label={loading ? undefined : `${sessionCount} session${sessionCount === 1 ? '' : 's'} in ${formatMonthYear(ym)}`}
            style={{
              fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 48, lineHeight: 0.85,
              letterSpacing: '-0.04em', color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
              opacity: loading ? 0.35 : 1,
            }}
          >
            {loading ? '—' : sessionCount}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ ...CAST, display: 'block', fontSize: 'var(--t-furniture)', letterSpacing: '0.2em', color: 'var(--text-2)' }}>
              Session{sessionCount === 1 && !loading ? '' : 's'} · <span style={{ ...MONO, letterSpacing: '0.04em' }}>{ym.year}</span>
            </span>
            <span style={{ ...CAST, display: 'block', fontSize: 26, letterSpacing: '0.05em', color: 'var(--text)', lineHeight: 1, marginTop: 3, overflowWrap: 'anywhere' }}>
              {monthName}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={() => goToMonth(shiftMonth(ym, -1))} aria-label="Previous month" style={NAV_BTN}>‹</button>
          <button onClick={() => goToMonth(shiftMonth(ym, 1))} aria-label="Next month" style={NAV_BTN}>›</button>
          <button
            onClick={() => { const now = currentMonth(); setSelectedDate(todayStr); onMonthChange(toMonthStr(now)) }}
            style={{ ...NAV_BTN, width: 'auto', paddingInline: 12, fontSize: 'var(--t-furniture)', letterSpacing: '0.16em', borderRadius: 999 }}
          >
            Today
          </button>
        </div>
      </div>

      {/* Loading is shown here, in place, and never by unmounting the grid.
          The hosts used to render `{calLoading ? <div>Loading…</div> :
          <Calendar/>}`, which threw away the month the user had just chosen —
          see lib/calendar-month.ts. */}
      <div aria-live="polite" style={{ ...MONO, height: 18, lineHeight: '18px', marginBottom: 2, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {loading ? 'Loading…' : ''}
      </div>

      {/* Weekday rail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2, marginBottom: 2 }}>
        {DAY_LABELS.map((d) => (
          <div key={d} style={{ ...CAST, minWidth: 0, textAlign: 'center', fontSize: 'var(--t-furniture)', letterSpacing: '0.1em', color: 'var(--text-2)', padding: '4px 0 6px' }}>{d}</div>
        ))}
      </div>

      {/* The month: hairline week rules, not a grid of boxes. */}
      <div aria-busy={loading ? true : undefined} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2, opacity: loading ? 0.45 : 1, transition: 'opacity 0.12s ease' }}>
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - firstDay + 1
          const isValid = dayNum >= 1 && dayNum <= days
          const col = i % 7
          const weekend = col === 0 || col === 6
          // Longhands only: a `border` shorthand beside a `borderTop` is the
          // combination React warns about on re-render.
          const rule: React.CSSProperties = {
            minWidth: 0,
            borderStyle: 'solid', borderColor: 'var(--border)', borderWidth: '1px 0 0 0',
            // The weekend columns carry a faint lift so the shape of the week
            // is visible before anything is read.
            background: weekend ? 'linear-gradient(180deg, var(--surface-2), transparent 80%)' : 'transparent',
          }
          if (!isValid) return <div key={i} aria-hidden style={rule} />

          const dateStr = toDateStr(ym, dayNum)
          const dayEvents = eventsByDate[dateStr] ?? []
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selected
          const hasEvents = dayEvents.length > 0

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              aria-pressed={isSelected}
              aria-current={isToday ? 'date' : undefined}
              aria-label={`${new Date(ym.year, ym.month, dayNum).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${hasEvents ? `, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}` : ''}`}
              style={{
                ...rule,
                minHeight: 56, borderRadius: 0,
                // The selected day is a panel fill and an inset hairline —
                // never colour — so it can never be mistaken for today.
                ...(isSelected ? { background: 'var(--surface-2)', boxShadow: 'inset 0 0 0 1px var(--text-muted)' } : null),
                cursor: 'pointer', padding: '7px 2px 8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                color: 'inherit',
              }}
            >
              {/* Today is the one floodlit cell: it is "now". */}
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                fontWeight: isToday ? 600 : hasEvents ? 500 : 400,
                color: isToday ? 'var(--on-primary)' : hasEvents || isSelected ? 'var(--text)' : 'var(--text-2)',
                background: isToday ? 'var(--flood)' : 'transparent',
                padding: isToday ? '3px 6px 4px' : '3px 0 4px',
                transform: isToday ? 'skewX(-10deg)' : undefined,
              }}>
                {dayNum}
              </span>
              {hasEvents && (
                <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', maxWidth: '100%' }}>
                  {dayEvents.slice(0, 3).map((ev) => (
                    <Mark key={ev.id} session={isSessionType(ev.event_type)} dim={ev.created_by_role === 'athlete'} />
                  ))}
                  {dayEvents.length > 3 && (
                    <span style={{ ...MONO, lineHeight: 1, color: 'var(--text-2)' }}>+{dayEvents.length - 3}</span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Legend — shape is the whole code, so the legend is two shapes. */}
      <div style={{ ...CAST, display: 'flex', gap: '8px 16px', flexWrap: 'wrap', alignItems: 'center', marginTop: 12, fontSize: 'var(--t-furniture)', letterSpacing: '0.12em', color: 'var(--text-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Mark session /> {EVENT_TYPE_LABEL.session}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Mark session={false} /> {['homework', 'goal', 'reminder', 'other'].map((t) => EVENT_TYPE_LABEL[t]).join(', ')}
        </span>
      </div>

      {/* Selected day events */}
      {selected && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingBottom: 10 }}>
            <span style={{ ...CAST, fontSize: 17, letterSpacing: '0.14em', color: 'var(--text)', minWidth: 0 }}>
              {new Date(selected + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}
            </span>
            {onAddEvent && (
              <button
                onClick={() => onAddEvent(selected)}
                style={{ ...NAV_BTN, width: 'auto', paddingInline: 14, fontSize: 'var(--t-furniture)', letterSpacing: '0.14em', borderRadius: 999, color: 'var(--text)', whiteSpace: 'nowrap' }}
              >
                + Add event
              </button>
            )}
          </div>

          {selectedEvents.length === 0 ? (
            <div style={{ padding: '14px 0', borderTop: '1px solid var(--text-muted)', fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.5 }}>
              {/* Only once this month's events have actually arrived. Saying
                  "no events" while they are in flight is a confident claim
                  about data we do not have, and it flashed on every single
                  month change. */}
              {loading ? 'Loading…' : (
                <>
                  No events on this day.
                  {onAddEvent && <span> Click <strong style={{ color: 'var(--text)' }}>+ Add event</strong> to add one.</span>}
                </>
              )}
            </div>
          ) : (
            <div>
              {selectedEvents.map((ev, idx) => {
                const session = isSessionType(ev.event_type)
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '16px 64px minmax(0, 1fr) auto', gap: 10,
                      alignItems: 'start', padding: '11px 0',
                      borderTop: `1px solid ${idx === 0 ? 'var(--text-muted)' : 'var(--border)'}`,
                    }}
                  >
                    <span aria-hidden style={{ ...CAST, fontSize: 16, lineHeight: 1.3, textAlign: 'center', color: session ? 'var(--primary)' : 'var(--text-2)' }}>
                      {EVENT_TYPE_GLYPH[ev.event_type] ?? '·'}
                    </span>
                    <span style={{ ...MONO, color: 'var(--text-2)', lineHeight: 1.6, textTransform: 'uppercase' }}>
                      {formatTime(ev.event_time)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...CAST, fontSize: 18, letterSpacing: '0.04em', lineHeight: 1.1, color: 'var(--text)', overflowWrap: 'anywhere' }}>
                        {ev.title}
                      </div>
                      {ev.description && (
                        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 5, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{ev.description}</div>
                      )}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        <Tag tone={session ? 'sage' : 'plain'}>{EVENT_TYPE_LABEL[ev.event_type]}</Tag>
                        {ev.created_by_role === 'coach' && <Tag tone="coach">From coach</Tag>}
                        {ev.created_by_role === 'athlete' && <Tag tone="plain">My event</Tag>}
                      </div>
                    </div>
                    {onDeleteEvent && ev.created_by_role === role ? (
                      <button
                        onClick={() => onDeleteEvent(ev.id)}
                        aria-label={`Delete ${ev.title}`}
                        title="Delete event"
                        style={{ width: 44, height: 44, marginTop: -10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-2)', fontSize: 20, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >×</button>
                    ) : <span />}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The type and provenance chips in the day list: cast face, hairline pill. */
function Tag({ tone, children }: { tone: 'sage' | 'coach' | 'plain'; children: React.ReactNode }) {
  const palette = {
    sage:  { color: 'var(--primary)',         background: 'var(--primary-light)', border: 'var(--success-border)' },
    coach: { color: 'var(--coach-on-light)',  background: 'var(--coach-light)',   border: 'var(--coach-border)' },
    plain: { color: 'var(--text-2)',          background: 'transparent',          border: 'var(--border)' },
  }[tone]
  return (
    <span style={{
      ...CAST, fontSize: 'var(--t-furniture)', letterSpacing: '0.12em', lineHeight: 1.2,
      padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
      color: palette.color, background: palette.background, border: `1px solid ${palette.border}`,
    }}>
      {children}
    </span>
  )
}
