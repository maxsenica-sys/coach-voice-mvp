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
   *  the session it came from. */
  session_id?: string | null
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

const EVENT_TYPE_COLOR: Record<string, string> = {
  session:  '#16a34a',
  homework: '#d97706',
  goal:     '#7c3aed',
  reminder: '#ea580c',
  other:    '#64748b',
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  session:  'Session',
  homework: 'Homework / Task',
  goal:     'Goal',
  reminder: 'Reminder',
  other:    'Other',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] ?? []) : []

  // Grid helpers
  const days = daysInMonth(ym)
  const firstDay = firstWeekday(ym)
  const totalCells = Math.ceil((firstDay + days) / 7) * 7

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* Month grid header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => goToMonth(shiftMonth(ym, -1))}
            aria-label="Previous month"
            style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >‹</button>
          <span style={{ fontSize: 16, fontWeight: 800, minWidth: 160, textAlign: 'center' }}>
            {formatMonthYear(ym)}
          </span>
          <button
            onClick={() => goToMonth(shiftMonth(ym, 1))}
            aria-label="Next month"
            style={{ width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >›</button>
        </div>
        <button
          onClick={() => { const now = currentMonth(); setSelectedDate(todayStr); onMonthChange(toMonthStr(now)) }}
          style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary-dark)', background: 'var(--primary-light)', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}
        >
          Today
        </button>
      </div>

      {/* Loading is shown here, in place, and never by unmounting the grid.
          The hosts used to render `{calLoading ? <div>Loading…</div> :
          <Calendar/>}`, which threw away the month the user had just chosen —
          see lib/calendar-month.ts. */}
      <div aria-live="polite" style={{ height: 14, marginTop: -8, marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {loading ? 'Loading…' : ''}
      </div>

      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DAY_LABELS.map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div aria-busy={loading ? true : undefined} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, opacity: loading ? 0.45 : 1, transition: 'opacity 0.12s ease' }}>
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - firstDay + 1
          const isValid = dayNum >= 1 && dayNum <= days
          if (!isValid) return <div key={i} />

          const dateStr = toDateStr(ym, dayNum)
          const dayEvents = eventsByDate[dateStr] ?? []
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selectedDate
          const hasEvents = dayEvents.length > 0

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              style={{
                minHeight: 52,
                border: `1.5px solid ${isSelected ? '#0d9488' : isToday ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 8,
                background: isSelected ? '#f0fdfa' : isToday ? '#f0f9ff' : 'var(--card)',
                cursor: 'pointer', padding: '6px 4px 4px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                transition: 'all 0.1s ease',
              }}
            >
              <span style={{
                fontSize: 13,
                fontWeight: isToday ? 900 : isSelected ? 700 : 500,
                color: (isToday && !isSelected) ? '#fff' : isToday ? 'var(--primary)' : isSelected ? '#0d9488' : 'var(--text)',
                width: 24, height: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                background: isToday && !isSelected ? 'var(--primary)' : 'transparent',
              }}>
                {dayNum}
              </span>
              {hasEvents && (
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 40 }}>
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div key={ev.id} style={{ width: 6, height: 6, borderRadius: '50%', background: EVENT_TYPE_COLOR[ev.event_type] ?? '#64748b', opacity: ev.created_by_role === 'athlete' ? 0.7 : 1 }} />
                  ))}
                  {dayEvents.length > 3 && <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>+{dayEvents.length - 3}</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected day events */}
      {selectedDate && (
        <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--border-soft)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            {onAddEvent && (
              <button className="btn btn-primary" onClick={() => onAddEvent(selectedDate)} style={{ padding: '5px 12px', fontSize: 12 }}>
                + Add event
              </button>
            )}
          </div>

          {selectedEvents.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
              No events on this day.
              {onAddEvent && <span> Click <strong>+ Add event</strong> to add one.</span>}
            </div>
          ) : (
            <div style={{ padding: '8px' }}>
              {selectedEvents.map((ev) => (
                <div
                  key={ev.id}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 4, background: 'var(--card)', border: '1px solid var(--border-soft)' }}
                >
                  <div style={{ width: 4, height: '100%', minHeight: 36, borderRadius: 2, background: EVENT_TYPE_COLOR[ev.event_type], flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{ev.title}</span>
                      <span className={`badge badge-${ev.event_type}`}>{EVENT_TYPE_LABEL[ev.event_type]}</span>
                      {ev.created_by_role === 'coach' && <span className="badge badge-coach" style={{ fontSize: 10 }}>From coach</span>}
                      {ev.created_by_role === 'athlete' && <span className="badge badge-athlete" style={{ fontSize: 10 }}>My event</span>}
                    </div>
                    {ev.event_time && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>⏰ {formatTime(ev.event_time)}</div>}
                    {ev.description && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.5 }}>{ev.description}</div>}
                  </div>
                  {onDeleteEvent && ev.created_by_role === role && (
                    <button onClick={() => onDeleteEvent(ev.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: '0 4px', flexShrink: 0, lineHeight: 1 }} title="Delete event">×</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
        {Object.entries(EVENT_TYPE_LABEL).map(([type, label]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: EVENT_TYPE_COLOR[type] }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
