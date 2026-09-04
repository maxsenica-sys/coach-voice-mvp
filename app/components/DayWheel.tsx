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
    <div>
      {/* One flex row: label, then the Today pill, then whatever the page wants
          at the end. The pill used to be absolutely the same corner as the
          dashboard's Calendar link and covered it whenever it appeared. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#5D6661', textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Your days
        </div>

        <span style={{ flex: 1 }} />

        {todayOffScreen && (
          <button
            onClick={() => centreOnToday()}
            style={{
              fontSize: 10, fontWeight: 700, color: '#FBF8F3', background: '#1F2421',
              border: 'none', borderRadius: 999, padding: '4px 10px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {todayOffScreen === 'left' ? '←' : ''} Today {todayOffScreen === 'right' ? '→' : ''}
          </button>
        )}

        {headerAction}
      </div>

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
          return (
            <button
              key={day.dateStr}
              ref={day.isToday ? todayRef : undefined}
              onClick={() => onSelectDay(isSelected ? null : day.dateStr)}
              aria-current={day.isToday ? 'date' : undefined}
              style={{
                flex: '0 0 auto', width: 46, scrollSnapAlign: 'center',
                background: day.isToday ? '#1F2421' : (isSelected ? '#E6ECDF' : '#FFFFFF'),
                border: day.isToday ? 'none' : `1px solid ${isSelected ? '#CBD7C0' : '#E3DED2'}`,
                borderRadius: 10, padding: '8px 0 6px', textAlign: 'center',
                opacity: day.isPast && !day.isToday ? 0.62 : 1,
                cursor: 'pointer', position: 'relative',
              }}
            >
              {day.isFirstOfMonth && (
                <span style={{
                  position: 'absolute', top: -1, left: 0, right: 0,
                  fontSize: 7.5, fontWeight: 800, letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  color: day.isToday ? 'rgba(255,255,255,0.6)' : '#B55C3E',
                }}>
                  {day.monthLabel}
                </span>
              )}
              <div style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                color: day.isToday ? 'rgba(255,255,255,0.55)' : '#9BA29B',
                marginTop: day.isFirstOfMonth ? 6 : 0,
              }}>
                {day.letter}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 500, lineHeight: 1,
                marginTop: 3, letterSpacing: -0.4,
                color: day.isToday ? '#FBF8F3' : '#1F2421',
              }}>
                {day.num}
              </div>
              {/* A solid green tab means "a session was recorded on this day" —
                  the thing worth scanning for. Other events stay as small grey
                  dots so they don't compete with it. */}
              <div style={{ marginTop: 6, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                {sessionCount > 0 ? (
                  <span style={{
                    minWidth: 18, height: 5, borderRadius: 3,
                    background: '#6F8E6B',
                    boxShadow: day.isToday ? '0 0 0 1.5px #1F2421' : 'none',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {sessionCount > 1 && (
                      <span style={{ fontSize: 7, fontWeight: 800, color: '#FBF8F3', lineHeight: 1 }}>
                        {sessionCount}
                      </span>
                    )}
                  </span>
                ) : count > 0 ? (
                  <span style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: day.isToday ? 'rgba(255,255,255,0.5)' : '#C4C9C2',
                  }} />
                ) : (
                  <span style={{ width: 4, height: 1, background: day.isToday ? 'rgba(255,255,255,0.2)' : '#E3DED2', borderRadius: 1 }} />
                )}
              </div>
            </button>
          )
        })}
      </div>

      {selectedDay && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #EFEAE0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9BA29B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          {dayEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9BA29B', textAlign: 'center', padding: '6px 0' }}>Nothing on this day</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {dayEvents.map((ev) => {
                const isSession = Boolean(ev.session_id) || ev.event_type === 'session'
                const who = ev.athletes
                  ? `${ev.athletes.first_name} ${ev.athletes.last_name}`.trim()
                  : null
                const initials = ev.athletes
                  ? `${ev.athletes.first_name?.[0] ?? ''}${ev.athletes.last_name?.[0] ?? ''}`.toUpperCase()
                  : null

                // Two lines at most: who it was with, then what it was. Enough
                // to know whether to open it, without becoming a panel.
                const body = (
                  <>
                    {initials ? (
                      <span style={{
                        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                        background: isSession ? '#6F8E6B' : '#C4C9C2', color: '#FBF8F3',
                        fontSize: 9, fontWeight: 800,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{initials}</span>
                    ) : (
                      <span style={{ width: 3, height: 22, borderRadius: 2, background: '#C4C9C2', flexShrink: 0 }} />
                    )}

                    <span style={{ flex: 1, minWidth: 0 }}>
                      {who && (
                        <span style={{ display: 'block', fontWeight: 700, fontSize: 11.5, color: '#1F2421', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {who}
                        </span>
                      )}
                      <span style={{
                        display: 'block', fontSize: who ? 11 : 12,
                        fontWeight: who ? 500 : 700,
                        color: who ? '#5D6661' : '#1F2421',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {ev.title}
                      </span>
                    </span>

                    {ev.event_time && <span style={{ fontSize: 10.5, color: '#9BA29B', flexShrink: 0 }}>{ev.event_time}</span>}
                    {isSession && (
                      <span style={{ fontSize: 12, color: '#6F8E6B', flexShrink: 0, lineHeight: 1 }}>›</span>
                    )}
                  </>
                )

                const style: React.CSSProperties = {
                  display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px',
                  background: isSession ? '#E6ECDF' : '#FFFFFF',
                  borderRadius: 8,
                  border: `1px solid ${isSession ? '#CBD7C0' : '#E3DED2'}`,
                  textDecoration: 'none',
                }

                // Session events open the session; everything else is just a note.
                return ev.session_id
                  ? <a key={ev.id} href={`/sessions/${ev.session_id}`} style={style}>{body}</a>
                  : <div key={ev.id} style={style}>{body}</div>
              })}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
