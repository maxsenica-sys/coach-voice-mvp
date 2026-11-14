// lib/onboarding.ts
//
// The coach's first-run checklist on Home: set an invite code, add an
// athlete, record a session.
//
// Found 2026-11-14: steps two and three were drawn with a hardcoded "not
// done", and the card only rendered while the roster was empty. So it read
// "1 of 3" for ever, and vanished the moment step two happened, leaving a
// coach with athletes and no sessions without the one prompt that mattered.
// It now stays until the first session is recorded, and each step ticks from
// real state.
//
// Pure, so tools/roster-rig.mjs runs the real thing.

export interface OnboardingInput {
  /** The coach has an invite code saved. */
  hasInviteCode: boolean
  /** Athletes on the roster, of any status (an invited athlete counts: the
   *  step is "add", not "activate"). */
  athleteCount: number
  /** Whether Home's session read has come back. Until it has, the coach's
   *  session count is unknown, not zero. */
  sessionsKnown: boolean
  sessionCount: number
}

export interface OnboardingSteps {
  code: boolean
  athlete: boolean
  session: boolean
  /** How many of the three are done. */
  completed: number
  /** Whether the card shows at all. */
  show: boolean
}

export function onboardingSteps(i: OnboardingInput): OnboardingSteps {
  const code = i.hasInviteCode
  const athlete = i.athleteCount > 0
  const session = i.sessionsKnown && i.sessionCount > 0
  // An empty roster is always a new coach. With athletes on it, the card
  // stays only while we KNOW there is no session yet: an unknown count must
  // not flash a checklist at a coach with a year of sessions while Home loads.
  const show = !session && (!athlete || i.sessionsKnown)
  return { code, athlete, session, completed: [code, athlete, session].filter(Boolean).length, show }
}
