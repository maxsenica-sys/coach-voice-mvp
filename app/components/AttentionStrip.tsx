'use client'

/**
 * "Quiet lately" — the athletes the coach has not recorded anything for.
 *
 * The whole product is "a coach speaks and an athlete gets feedback". The
 * largest single determinant of how much feedback an athlete gets is not
 * summary quality — it is whether the coach pressed record for them at all.
 * Nothing on the coach's home answered that. The stat cards say how much the
 * coach has done; the roster says who exists. Neither says who is missing out,
 * so the next recording goes to whoever is top of the list rather than whoever
 * has gone longest without hearing anything.
 *
 * Three properties that make this a tool rather than another dashboard widget:
 *
 * 1. **It renders nothing when the list is empty.** No "all caught up!" panel,
 *    no praise, no empty state to read past. A coach on top of their roster
 *    never sees this component at all. That absence is the reward.
 * 2. **Each face is the action.** Tapping opens the recorder already pointed at
 *    that athlete, so noticing and acting are the same gesture. The alternative
 *    today is home → athletes tab → find them → open → record.
 * 3. **The copy is not a scold.** "Quiet lately", not "you have neglected
 *    these athletes". A part-time volunteer coach with 24 athletes will always
 *    have a long tail, and a reprimand is not a gift.
 *
 * Coach-only, always. No athlete sees this component or anything derived from
 * it — a ranking of a coach's attention across a squad of children is exactly
 * the comparison between kids the product forbids. If this ever becomes
 * athlete-facing it becomes "who does coach like best". Do not move it.
 */
import type { CoverageRow } from '@/app/api/athletes/coverage/route'

/**
 * How long a silence has to be before it is worth mentioning. Judgement, not a
 * finding: a fortnight is long enough that a coach would agree it had been a
 * while, and short enough to still be actionable within a season.
 */
const QUIET_AFTER_DAYS = 14

/**
 * A never-recorded athlete only appears once they have been on the roster this
 * long. Without it, adding an athlete puts them straight into a list of people
 * you are neglecting, which is both untrue and annoying.
 */
const GRACE_DAYS = 7

/** Never show more than this many. A queue you cannot finish is a nag. */
const MAX_SHOWN = 6

/** The athletes worth surfacing, already ordered longest-gap first by the API. */
export function selectQuiet(coverage: CoverageRow[]): CoverageRow[] {
  return coverage
    .filter((r) =>
      r.days_since === null
        ? (r.days_on_roster ?? 0) >= GRACE_DAYS
        : r.days_since >= QUIET_AFTER_DAYS,
    )
    .slice(0, MAX_SHOWN)
}

function initials(r: CoverageRow): string {
  return `${r.first_name[0] ?? ''}${r.last_name[0] ?? ''}`.toUpperCase() || '?'
}

/** "24 days" / "no sessions yet" — the label under a face. */
function gapLabel(r: CoverageRow): string {
  if (r.days_since === null) return 'no sessions yet'
  if (r.days_since === 1) return '1 day'
  return `${r.days_since} days`
}

export default function AttentionStrip({
  coverage,
  onSelect,
}: {
  coverage: CoverageRow[]
  onSelect: (athleteId: string) => void
}) {
  const quiet = selectQuiet(coverage)
  if (quiet.length === 0) return null

  return (
    <section aria-label="Athletes you have not recorded for recently">
      <div style={{
        fontSize: 'var(--fs-1)', fontWeight: 800, color: 'var(--text-2)',
        textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 9,
      }}>
        Quiet lately
      </div>

      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4,
        WebkitOverflowScrolling: 'touch',
      }}>
        {quiet.map((r) => (
          <button
            key={r.athlete_id}
            onClick={() => onSelect(r.athlete_id)}
            aria-label={
              r.days_since === null
                ? `Record a session for ${r.first_name} ${r.last_name}. No sessions yet.`
                : `Record a session for ${r.first_name} ${r.last_name}. Last session ${gapLabel(r)} ago.`
            }
            style={{
              flex: '0 0 auto', width: 76, background: 'none', border: 'none',
              padding: '2px 0 0', cursor: 'pointer', display: 'flex',
              flexDirection: 'column', alignItems: 'center', gap: 6,
              font: 'inherit', color: 'inherit',
            }}
          >
            <span style={{
              width: 54, height: 54, borderRadius: '50%',
              background: 'var(--coach-light)', color: 'var(--coach-on-light)',
              border: '1px solid var(--coach-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 'var(--fs-4)', fontWeight: 800, letterSpacing: '0.01em',
            }}>
              {initials(r)}
            </span>
            <span style={{
              fontSize: 'var(--fs-1)', fontWeight: 700, color: 'var(--text)',
              maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r.first_name}
            </span>
            <span style={{
              fontSize: 'var(--fs-1)', color: 'var(--text-muted)', textAlign: 'center',
              lineHeight: 1.25,
            }}>
              {gapLabel(r)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
