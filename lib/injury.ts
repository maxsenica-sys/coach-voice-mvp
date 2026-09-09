// lib/injury.ts
//
// An injury's vocabulary, in one place.
//
// The three statuses describe **availability**, not medicine. A coach is not a
// physiotherapist, and this app must never invite one to record a diagnosis
// about a child. "Can they train, and how" is the coach's actual job and the
// only question this feature answers.

export type InjuryStatus = 'active' | 'recovering' | 'cleared'

export interface Injury {
  id: string
  athlete_id: string
  /** A region id from lib/body-map.ts. */
  body_area: string
  status: InjuryStatus
  /** 0-10 Numeric Rating Scale, more is worse. Often null. */
  severity: number | null
  started_on: string
  expected_return: string | null
  cleared_on: string | null
  note: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface InjuryStatusOption {
  value: InjuryStatus
  label: string
  /** What it means for the next session, in the coach's terms. */
  meaning: string
  color: string
  tint: string
}

export const INJURY_STATUSES: InjuryStatusOption[] = [
  {
    value: 'active',
    label: 'Out',
    meaning: 'Not training this',
    color: 'var(--wellness-low)',
    tint: 'var(--wellness-low-tint)',
  },
  {
    value: 'recovering',
    label: 'Modified',
    meaning: 'Training, with changes',
    color: 'var(--energy-dark)',
    tint: 'var(--wellness-ok-tint)',
  },
  {
    value: 'cleared',
    label: 'Cleared',
    meaning: 'Back to normal',
    color: 'var(--wellness-good)',
    tint: 'var(--wellness-good-tint)',
  },
]

export function isInjuryStatus(v: unknown): v is InjuryStatus {
  return typeof v === 'string' && INJURY_STATUSES.some((s) => s.value === v)
}

export function injuryStatusOption(v: string | null | undefined): InjuryStatusOption | null {
  if (!v) return null
  return INJURY_STATUSES.find((s) => s.value === v) ?? null
}

/** An injury still affecting what the athlete can do today. */
export function isOpen(i: Injury): boolean {
  return i.status !== 'cleared'
}

/** The open injuries, worst first, so a screen showing one shows the right one. */
export function openInjuries(injuries: Injury[]): Injury[] {
  const rank: Record<InjuryStatus, number> = { active: 0, recovering: 1, cleared: 2 }
  return injuries
    .filter(isOpen)
    .sort((a, b) => rank[a.status] - rank[b.status] || b.started_on.localeCompare(a.started_on))
}
