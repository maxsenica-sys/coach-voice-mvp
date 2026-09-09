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
 * Contrast: the --primary-dark fill on the --border-soft track measures 4.95:1.
 * WCAG 1.4.11 requires 3:1 for a graphical object whose distinction carries
 * meaning, and fill-versus-track is the entire message here.
 */
import {
  buildSpine,
  SPINE_GAP_DAYS,
  SPINE_MIN_SESSIONS,
  SPINE_WEEKS,
  type SessionDateFields,
} from '@/lib/training-spine'

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
      <div style={{
        fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)',
        textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 9,
      }}>
        {label}
      </div>

      <div
        role="img"
        aria-label={sentence}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48 }}
      >
        {weeks.map((n, i) => (
          <div key={i} aria-hidden style={{
            flex: 1, height: '100%', display: 'flex', flexDirection: 'column',
            justifyContent: 'flex-end',
          }}>
            <div style={{
              // Floor of 3px so an empty week is a visible flat line rather
              // than a hole in the chart.
              height: `${Math.max(3, Math.round((n / peak) * 44))}px`,
              background: n > 0 ? 'var(--primary-dark)' : 'var(--border-soft)',
              borderRadius: 2,
            }} />
            {/* Every column reserves the same 4px footer so the marker on the
                current week cannot push that one bar out of alignment with the
                other eleven. Only the last one is painted. */}
            <div style={{
              height: 2, marginTop: 2, borderRadius: 1,
              background: i === weeks.length - 1 ? 'var(--coach-color)' : 'transparent',
            }} />
          </div>
        ))}
      </div>

      <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 9 }}>
        {sentence}
        {gapNote && (
          <span style={{ color: 'var(--coach-on-light)', fontWeight: 700 }}> · {gapNote}</span>
        )}
      </div>
    </section>
  )
}
