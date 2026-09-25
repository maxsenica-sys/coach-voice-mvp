'use client'

/**
 * The Spine — twelve weeks of training, as one small bar chart.
 *
 * The app has never had a longitudinal view of anything. An athlete gets a
 * reverse-chronological list and an integer ("14 sessions"); a coach gets a
 * count for the current week and, on an athlete's profile, a list. Neither side
 * can see a shape: whether the work is accumulating, whether it stopped three
 * weeks ago, whether this month looks like last month.
 *
 * The data was already loaded and paid for on both render sites — the athlete
 * home holds its own sessions array, and the coach's athlete profile fetches
 * every session for that athlete and then renders none of them on the overview.
 * So this is a picture of data the app already had, not a new capture surface.
 *
 * Deliberate choices, all of them arguable:
 *
 * - **Weeks, not days.** A GitHub-style daily grid would be 84 cells with about
 *   24 filled at two sessions a week — a mostly empty board, which reads as
 *   failure to a fifteen-year-old. Twelve bars read as accumulation. If this
 *   cohort turns out to train five or six days a week, a daily grid becomes
 *   dense enough to read as rhythm and this decision should be revisited.
 * - **No streak counter.** "You have a 4-week streak" makes a coach's holiday
 *   the athlete's failure. Consistency without a scoreboard.
 * - **Nothing under three sessions.** A chart of two bars is decoration.
 * - **The coach's version names the gap; the athlete's never does.** A coach
 *   needs "last session 19 days ago" to act on. Telling a child the same thing
 *   tells them their coach has forgotten them, which is not theirs to carry.
 *
 * The arithmetic lives in `lib/training-spine.ts`, not here. Node can strip
 * TypeScript but cannot parse JSX, so anything exported from this file is
 * unreachable from `tools/clock-rig.mjs` — and the bucketing had a real DST bug
 * that only running it could find. This file draws; that file computes.
 *
 * Stadium Night, 2026-09-25. The completed weeks are sage; the week that is
 * running is the one floodlit object, because it is *now* — and it is drawn
 * OPEN: a dashed outline with a dashed riser above it, not a filled bar. A
 * part-finished week drawn solid is a short bar at the right-hand end, and to
 * a fifteen-year-old opening this on a Tuesday that shape reads as "down"
 * long before any caption is read. Open says "still being filled in". The
 * caption says it too: THIS WEEK · N SO FAR.
 *
 * Contrast (WCAG 1.4.11 wants 3:1 for a graphic whose distinction carries
 * meaning): --primary on --card is 8:1 at full strength and stays above 5:1
 * at the 0.78 the bars are drawn at; an empty past week is a 3px --text-muted
 * rule, 5.3:1, so a gap is a visible gap and not a hole; --flood is 12:1.
 */
import {
  buildSpine,
  SPINE_GAP_DAYS,
  SPINE_MIN_SESSIONS,
  SPINE_WEEKS,
  startOfWeek,
  type SessionDateFields,
} from '@/lib/training-spine'

const CAST: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
  letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-2)',
}
const MONO: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 'var(--t-data)',
  letterSpacing: '0.04em',
}

/** The chart area, in px. The bars get 62; the rest is the open week's riser headroom. */
const CHART_H = 72
const BAR_MAX = 62

/**
 * Where a month name goes under the chart: the first column, and every column
 * whose week starts in a different month from the column before it. Week
 * starts are stepped back with setDate, never by subtracting milliseconds, for
 * the DST reason lib/training-spine.ts documents.
 */
function monthTicks(now: Date): { col: number; label: string }[] {
  const current = startOfWeek(now)
  const starts = Array.from({ length: SPINE_WEEKS }, (_, i) => {
    const d = new Date(current)
    d.setDate(d.getDate() - 7 * (SPINE_WEEKS - 1 - i))
    return d
  })
  const ticks: { col: number; label: string }[] = []
  starts.forEach((d, i) => {
    if (i === 0 || d.getMonth() !== starts[i - 1].getMonth()) {
      ticks.push({ col: i, label: d.toLocaleDateString(undefined, { month: 'short' }) })
    }
  })
  // A first-column label two columns from the next one would collide with it.
  if (ticks.length > 1 && ticks[1].col - ticks[0].col < 3) ticks.shift()
  return ticks
}

export default function TrainingSpine({
  sessions,
  variant = 'athlete',
  label = 'Training rhythm',
}: {
  sessions: SessionDateFields[]
  variant?: 'athlete' | 'coach'
  label?: string
}) {
  const { weeks, total, thisWeek, daysSinceLast } = buildSpine(sessions)

  // A chart of one or two bars says nothing. Render nothing instead.
  if (total < SPINE_MIN_SESSIONS) return null

  const peak = Math.max(...weeks, 1)
  const ticks = monthTicks(new Date())
  const last = weeks.length - 1

  const sentence =
    `${total} session${total === 1 ? '' : 's'} over ${SPINE_WEEKS} weeks` +
    (thisWeek > 0 ? ` · ${thisWeek} this week` : '')

  // Coach-only. See the note at the top of this file about why the athlete
  // never sees their own gap.
  const gapNote =
    variant === 'coach' && daysSinceLast !== null && daysSinceLast >= SPINE_GAP_DAYS
      ? `Last session ${daysSinceLast} days ago`
      : null

  return (
    <section aria-label={`${label}. ${sentence}.`}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={CAST}>{label}</div>
        <div style={{ ...MONO, color: 'var(--text-2)', textTransform: 'uppercase' }}>{SPINE_WEEKS} weeks</div>
      </div>

      <div
        role="img"
        aria-label={sentence}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: CHART_H }}
      >
        {weeks.map((n, i) => {
          const isNow = i === last
          const h = Math.max(3, Math.round((n / peak) * BAR_MAX))
          if (isNow) {
            // Open: a dashed outline the height of what is in it so far (never
            // less than a readable 12px), and a dashed riser above it to the
            // top of the chart — the week is not over.
            const openH = Math.max(12, h)
            return (
              <div key={i} aria-hidden style={{
                flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column',
                alignItems: 'stretch',
              }}>
                <div style={{
                  flex: 1, alignSelf: 'center', width: 0,
                  borderLeft: '1.5px dashed var(--flood)', opacity: 0.55,
                }} />
                <div style={{
                  height: openH, borderRadius: 3,
                  border: '1.5px dashed var(--flood)', background: 'transparent',
                }} />
              </div>
            )
          }
          return (
            <div key={i} aria-hidden style={{
              flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column',
              justifyContent: 'flex-end',
            }}>
              <div style={{
                height: n > 0 ? h : 3,
                background: n > 0 ? 'var(--primary)' : 'var(--text-muted)',
                opacity: n > 0 ? 0.78 : 1,
                borderRadius: n > 0 ? 3 : 2,
              }} />
            </div>
          )
        })}
      </div>

      {/* The month rule under the chart. Positioned by column, so a label is
          under the week it names; the last two columns anchor right so a name
          there cannot run past the chart's edge. */}
      <div aria-hidden style={{ position: 'relative', height: 24, marginTop: 6, borderTop: '1px solid var(--border)' }}>
        {ticks.map(({ col, label: m }) => {
          const pct = (col / SPINE_WEEKS) * 100
          const anchorRight = col >= SPINE_WEEKS - 2
          return (
            <span key={col} style={{
              ...CAST, letterSpacing: '0.12em', position: 'absolute', top: 5,
              ...(anchorRight ? { right: 0 } : { left: `${pct}%` }),
              whiteSpace: 'nowrap',
            }}>
              {m}
            </span>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
        <span style={{ ...CAST, letterSpacing: '0.14em' }}>
          <span style={{ ...MONO, color: 'var(--text)' }}>{total}</span> session{total === 1 ? '' : 's'}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ ...CAST, letterSpacing: '0.14em', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span aria-hidden style={{
            width: 9, height: 9, borderRadius: 2, border: '1.5px dashed var(--flood)', flexShrink: 0,
          }} />
          This week · <span style={{ ...MONO, color: 'var(--text)' }}>{thisWeek}</span> so far
        </span>
      </div>

      {gapNote && (
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--coach-on-light)', fontWeight: 700, marginTop: 8, lineHeight: 1.45 }}>
          {gapNote}
        </div>
      )}
    </section>
  )
}
