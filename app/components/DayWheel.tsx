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
}

export default function DayWheel({ events, selectedDay, onSelectDay }: Props) {
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

  // Count events per day once, rather than filtering the list inside every cell.
  const countByDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of events) map.set(e.event_date, (map.get(e.event_date) ?? 0) + 1)
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#5D6661', textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Your days
        </div>

        {todayOffScreen && (
          <button
            onClick={() => centreOnToday()}
            style={{
              fontSize: 10, fontWeight: 700, color: '#FBF8F3', background: '#1F2421',
              border: 'none', borderRadius: 999, padding: '4px 10px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            {todayOffScreen === 'left' ? '←' : ''} Today {todayOffScreen === 'right' ? '→' : ''}
          </button>
        )}
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
          const count = countByDay.get(day.dateStr) ?? 0
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
              <div style={{ marginTop: 6, height: 14, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 1.5 }}>
                {count > 0
                  ? Array.from({ length: Math.min(count, 5) }).map((_, j) => (
                      <div key={j} style={{
                        width: 2, height: 4 + j * 2, borderRadius: 1,
                        background: day.isToday ? '#E8B4A0' : (day.isPast ? '#9BA29B' : '#6F8E6B'),
                      }} />
                    ))
                  : <div style={{ width: 4, height: 1, background: '#E3DED2', borderRadius: 1 }} />}
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
                const body = (
                  <>
                    <div style={{ width: 3, height: 24, borderRadius: 2, background: '#6F8E6B', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: 12, color: '#1F2421', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.title}
                    </span>
                    {ev.event_time && <span style={{ fontSize: 11, color: '#9BA29B' }}>{ev.event_time}</span>}
                  </>
                )
                const style: React.CSSProperties = {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: '#E6ECDF', borderRadius: 8, border: '1px solid #CBD7C0',
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
