'use client'

/**
 * Horizontally scrollable day strip for the coach's home tab.
 *
 * Replaces a fixed seven-column grid that only ever showed the current week —
 * you couldn't look back at what you'd done or forward at what's coming. This
 * scrolls both ways, snaps to days, opens centred on today, and surfaces a
 * "Today" control the moment today scrolls out of view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

export type WheelEvent = {
  id: string
  title: string
  event_date: string
  event_time?: string | null
  event_type?: string | null
  session_id?: string | null
  /** Joined from calendar_events.athlete_id; null for the coach's own events. */
  athletes?: { first_name: string; last_name: string } | null
}

const DAYS_BACK = 56
const DAYS_FORWARD = 56
const DAY_LETTERS = 'SMTWTFS'

/** Local YYYY-MM-DD. Never use toISOString here — it shifts the date in any timezone behind UTC. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The YYYY-MM keys the wheel's range spans, so the caller knows what to fetch. */
export function wheelMonths(): string[] {
  const months = new Set<string>()
  const today = new Date()
  for (let i = -DAYS_BACK; i <= DAYS_FORWARD; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return Array.from(months)
}

type Props = {
  events: WheelEvent[]
  selectedDay: string | null
  onSelectDay: (dateStr: string | null) => void
  /** Rendered at the end of the header row — kept inside the wheel's own flex
   *  row so it can never be overlapped by the Today pill. */
  headerAction?: React.ReactNode
}

export default function DayWheel({ events, selectedDay, onSelectDay, headerAction }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const todayRef = useRef<HTMLButtonElement | null>(null)
  const [todayOffScreen, setTodayOffScreen] = useState<'left' | 'right' | null>(null)

  const todayStr = toDateStr(new Date())

  const days = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() + (i - DAYS_BACK))
      const dateStr = toDateStr(d)
      return {
        dateStr,
        letter: DAY_LETTERS[d.getDay()],
        num: d.getDate(),
        monthLabel: d.toLocaleDateString(undefined, { month: 'short' }),
        isFirstOfMonth: d.getDate() === 1,
        isToday: dateStr === todayStr,
        isPast: dateStr < todayStr,
      }
    })
  }, [todayStr])

  // Per day: how many events, and whether any of them is a recorded session.
  // Sessions get their own green marker — the thing you scan the strip for is
  // "which days did I actually coach", not "which days have anything on them".
  const byDay = useMemo(() => {
    const map = new Map<string, { total: number; sessions: number }>()
    for (const e of events) {
      const entry = map.get(e.event_date) ?? { total: 0, sessions: 0 }
      entry.total += 1
      if (e.session_id || e.event_type === 'session') entry.sessions += 1
      map.set(e.event_date, entry)
    }
    return map
  }, [events])

  const centreOnToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current
    const el = todayRef.current
    if (!scroller || !el) return
    scroller.scrollTo({
      left: el.offsetLeft - scroller.clientWidth / 2 + el.clientWidth / 2,
      behavior,
    })
  }, [])

  // Open centred on today. 'auto' so it doesn't animate on first paint.
  useEffect(() => { centreOnToday('auto') }, [centreOnToday])

  const handleScroll = useCallback(() => {
    const scroller = scrollerRef.current
    const el = todayRef.current
    if (!scroller || !el) return
    const left = el.offsetLeft - scroller.scrollLeft
    if (left < 0) setTodayOffScreen('left')
    else if (left > scroller.clientWidth - el.clientWidth) setTodayOffScreen('right')
    else setTodayOffScreen(null)
  }, [])

  const dayEvents = selectedDay ? events.filter((e) => e.event_date === selectedDay) : []

  return (
    <div style={{ minWidth: 0 }}>
      {/* One flex row: label, then the Today pill, then whatever the page wants
          at the end. The pill used to be absolutely the same corner as the
          dashboard's Calendar link and covered it whenever it appeared. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <div style={{
          fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
          color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.24em',
        }}>
          Your days
        </div>

        <span style={{ flex: 1 }} />

        {todayOffScreen && (
          <button
            onClick={() => centreOnToday()}
            style={{
              fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'var(--text)', background: 'var(--surface-2)',
              border: '1px solid var(--border)', borderRadius: 999, padding: '0 14px', minHeight: 44,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {todayOffScreen === 'left' ? '←' : ''} Today {todayOffScreen === 'right' ? '→' : ''}
          </button>
        )}

        {headerAction}
      </div>

      {/* The strip is the one deliberate sideways scroller: it is its own
          overflow box, so the page itself never moves sideways. */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="day-wheel"
        style={{
          display: 'flex', gap: 5, overflowX: 'auto', overflowY: 'hidden',
          scrollSnapType: 'x proximity', paddingBottom: 4,
          scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
        }}
      >
        {days.map((day) => {
          const { total: count, sessions: sessionCount } = byDay.get(day.dateStr) ?? { total: 0, sessions: 0 }
          const isSelected = selectedDay === day.dateStr
          // Today is the one floodlit cell — it is "now" — and everything on it
          // is drawn in ink. A past day steps its type down a tier instead of
          // fading the whole cell: an opacity of 0.62 took the weekday letter
          // to 3.3:1, under the 4.5 a 13px label needs.
          const ink = day.isToday ? 'var(--on-primary)' : null
          return (
            <button
              key={day.dateStr}
              ref={day.isToday ? todayRef : undefined}
              onClick={() => onSelectDay(isSelected ? null : day.dateStr)}
              aria-current={day.isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              style={{
                flex: '0 0 auto', width: 46, scrollSnapAlign: 'center',
                background: day.isToday ? 'var(--flood)' : (isSelected ? 'var(--surface-2)' : 'transparent'),
                border: day.isToday ? '1px solid var(--flood)' : `1px solid ${isSelected ? 'var(--text-muted)' : 'var(--border)'}`,
                borderRadius: 10, padding: '8px 0 6px', textAlign: 'center',
                cursor: 'pointer', position: 'relative',
              }}
            >
              {/* The month name was 7.5px absolutely positioned over the cell's
                  top edge. At --t-furniture it needs real room, so every cell
                  reserves the band whether or not it is the 1st. Reserving it
                  on every cell is also what keeps the numerals on one line
                  across a month boundary: the old `marginTop: isFirstOfMonth ?
                  6 : 0` made the 1st of the month 6px taller than its
                  neighbours and nudged its numeral down. */}
              <div style={{
                height: 16, lineHeight: '16px',
                fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: ink ?? 'var(--text)',
              }}>
                {day.isFirstOfMonth ? day.monthLabel : ''}
              </div>
              <div style={{
                fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700, lineHeight: 1,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                color: ink ?? (day.isPast ? 'var(--text-muted)' : 'var(--text-2)'),
              }}>
                {day.letter}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: day.isToday ? 600 : 500, lineHeight: 1,
                marginTop: 3, letterSpacing: -0.4, fontVariantNumeric: 'tabular-nums',
                color: ink ?? (day.isPast ? 'var(--text-2)' : 'var(--text)'),
              }}>
                {day.num}
              </div>
              {/* A solid sage tab means "a session was recorded on this day" —
                  the thing worth scanning for. Other events stay as a small
                  hollow mark so they don't compete with it — the same filled /
                  hollow code as the month calendar. */}
              <div style={{ marginTop: 6, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {sessionCount > 0 ? (
                  // One pill per session, up to three. A numeral inside a 5px
                  // bar was unreadable and just looked like a gap in the bar.
                  Array.from({ length: Math.min(sessionCount, 3) }).map((_, j) => (
                    <span key={j} style={{
                      width: sessionCount === 1 ? 18 : 7, height: 5, borderRadius: 3,
                      background: ink ?? 'var(--primary)',
                      display: 'inline-block',
                    }} />
                  ))
                ) : count > 0 ? (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    boxShadow: `inset 0 0 0 1.5px ${ink ?? 'var(--text-muted)'}`,
                  }} />
                ) : (
                  <span style={{ width: 4, height: 1, background: ink ?? 'var(--border)', opacity: day.isToday ? 0.35 : 1, borderRadius: 1 }} />
                )}
              </div>
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontFamily: 'var(--font-cast)', fontSize: 15, fontWeight: 700, color: 'var(--text)',
            marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.14em',
          }}>
            {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          {dayEvents.length === 0 ? (
            <div style={{
              fontSize: 'var(--t-body)', color: 'var(--text-2)', padding: '12px 0',
              borderTop: '1px solid var(--text-muted)',
            }}>Nothing on this day</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {dayEvents.map((ev, idx) => {
                const isSession = Boolean(ev.session_id) || ev.event_type === 'session'
                const who = ev.athletes
                  ? `${ev.athletes.first_name} ${ev.athletes.last_name}`.trim()
                  : null
                const initials = ev.athletes
                  ? `${ev.athletes.first_name?.[0] ?? ''}${ev.athletes.last_name?.[0] ?? ''}`.toUpperCase()
                  : null

                // Two parts: who it was with, then what it was. Enough to know
                // whether to open it, without becoming a panel. Both WRAP —
                // a name is never cut with an ellipsis.
                const body = (
                  <>
                    {initials ? (
                      <span style={{
                        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                        background: isSession ? 'var(--primary)' : 'var(--surface-2)',
                        color: isSession ? 'var(--on-primary)' : 'var(--text-2)',
                        border: isSession ? 'none' : '1px solid var(--border)',
                        fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 800,
                        letterSpacing: '0.04em',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{initials}</span>
                    ) : (
                      <span style={{ width: 3, alignSelf: 'stretch', minHeight: 26, borderRadius: 2, background: isSession ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />
                    )}

                    <span style={{ flex: 1, minWidth: 0 }}>
                      {who && (
                        <span style={{
                          display: 'block', fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 17,
                          letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.15,
                          color: 'var(--text)', overflowWrap: 'anywhere',
                        }}>
                          {who}
                        </span>
                      )}
                      <span style={{
                        display: 'block', fontSize: 'var(--t-body-tight)',
                        lineHeight: 1.35, marginTop: who ? 2 : 0,
                        fontWeight: who ? 500 : 700,
                        color: who ? 'var(--text-2)' : 'var(--text)',
                        overflowWrap: 'anywhere',
                      }}>
                        {ev.title}
                      </span>
                    </span>

                    {ev.event_time && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)', flexShrink: 0 }}>{ev.event_time}</span>}
                    {/* The chevron promises a destination, so only draw it when
                        there is one. A planned session has no session_id yet —
                        it has not been recorded — and it was rendering the
                        chevron and the green accent anyway, then falling
                        through to an inert <div>. The affordance said "tap me"
                        and nothing happened. */}
                    {ev.session_id && (
                      <span aria-hidden="true" style={{ fontSize: 20, color: 'var(--primary)', flexShrink: 0, lineHeight: 1 }}>›</span>
                    )}
                  </>
                )

                // Hairline rows, not boxes: the first rule is a step brighter
                // so the list reads as starting under its date.
                const style: React.CSSProperties = {
                  display: 'flex', alignItems: 'center', gap: 11, padding: '9px 2px',
                  minHeight: 48,
                  borderTop: `1px solid ${idx === 0 ? 'var(--text-muted)' : 'var(--border)'}`,
                  textDecoration: 'none', color: 'inherit',
                }

                // Session events open the session; everything else is just a note.
                //
                // `next/link`, not a raw <a>. This is the most-tapped control on
                // the coach's home screen and a bare href threw away the whole
                // React tree and re-downloaded the app on every tap — a full
                // document load where a client transition would do. It was the
                // only navigational raw anchor left in the app.
                return ev.session_id
                  ? <Link key={ev.id} href={`/sessions/${ev.session_id}`} style={style}>{body}</Link>
                  : <div key={ev.id} style={style}>{body}</div>
              })}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
