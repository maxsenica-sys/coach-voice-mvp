// lib/staff-invite.ts
//
// The rules for inviting an assistant coach, as pure functions, so
// tools/staff-rig.mjs can run them. The routes (app/api/staff/*) do the reads
// and writes; everything that decides "may this happen" lives here.
//
// Max, 2026-09-27: assistants are invited by an email link.
//
// ── The token ─────────────────────────────────────────────────────────────
//
// 32 random bytes, sent once in the email and never stored: the table holds
// its sha256. A leaked database row cannot be turned back into a working
// link, and a link is single-use because accepting clears the hash.
//
// ── Who may accept ────────────────────────────────────────────────────────
//
// The person signed in with the address the invite was sent to — so a
// forwarded email is useless to whoever it was forwarded to — on a coach
// account that has no roster of its own and is on no other team. One team per
// assistant is what makes "whose athletes are these?" a single answer.

import { createHash, randomBytes } from 'node:crypto'

/** How long an invite link works. */
export const INVITE_TTL_DAYS = 7
/** Most assistants one head coach can have at once (invited or active). */
export const MAX_STAFF = 10

/** A fresh token (for the email) and its hash (for the table). */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashInviteToken(token) }
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** A token as it must look: 43 base64url characters. Anything else is not tried. */
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

/** Trimmed and lower-cased; null when it is not an address at all. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  if (e.length < 3 || e.length > 320) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  return e
}

export function inviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString()
}

/** Text for HTML email bodies. Names are typed by people. One definition, in lib/escape-html.ts. */
export { escapeHtml } from '@/lib/escape-html'

export type AcceptBlock =
  | 'not-found'       // no invite with that token (never existed, or already used)
  | 'expired'
  | 'not-pending'     // revoked, or accepted already
  | 'wrong-email'     // signed in as someone other than the invited address
  | 'not-a-coach'     // an athlete account can never be staff
  | 'own-roster'      // this account already coaches its own athletes or squads
  | 'other-team'      // already an active assistant elsewhere
  | 'own-team'        // the head coach opening their own invite

export interface AcceptInput {
  invite: { status: string; invited_email: string; invite_expires_at: string | null; head_coach_id: string } | null
  userId: string
  userEmail: string | null | undefined
  role: string | null | undefined
  ownsAthletes: boolean
  ownsGroups: boolean
  activeElsewhere: boolean
  now?: Date
}

/** Why this person may not accept this invite, or null when they may. Pure. */
export function acceptBlock(i: AcceptInput): AcceptBlock | null {
  if (!i.invite) return 'not-found'
  if (i.invite.status !== 'invited') return 'not-pending'
  const exp = i.invite.invite_expires_at ? Date.parse(i.invite.invite_expires_at) : NaN
  if (!Number.isFinite(exp) || exp <= (i.now ?? new Date()).getTime()) return 'expired'
  if (i.invite.head_coach_id === i.userId) return 'own-team'
  if (normaliseEmail(i.userEmail) !== normaliseEmail(i.invite.invited_email)) return 'wrong-email'
  if (i.role !== 'coach') return 'not-a-coach'
  if (i.ownsAthletes || i.ownsGroups) return 'own-roster'
  if (i.activeElsewhere) return 'other-team'
  return null
}

/** What the person is told, per reason. Plain, and says what to do. */
export const ACCEPT_MESSAGES: Record<AcceptBlock, string> = {
  'not-found': 'This invite link is not valid. It may already have been used — ask your head coach to send a new one.',
  expired: 'This invite has expired. Ask your head coach to send a new one.',
  'not-pending': 'This invite is no longer open. Ask your head coach to send a new one.',
  'wrong-email': 'You are signed in with a different email from the one this invite was sent to. Sign out, then sign in or create an account with that address.',
  'not-a-coach': 'This is an athlete account. Assistant coaches need a coach account — sign out and create one with the invited email.',
  'own-roster': 'This account already coaches its own athletes, so it cannot join another coach’s team. Use a separate coach account for this invite.',
  'other-team': 'You are already an assistant coach on another team. Leave that team first.',
  'own-team': 'This is your own invite — send the link to your assistant instead.',
}

/**
 * Hide most of an address for the person opening an invite link, so the page
 * can say which account to use without printing someone's full email to
 * whoever the link was forwarded to.
 */
export function maskEmail(email: string): string {
  const e = normaliseEmail(email)
  if (!e) return ''
  const [local, domain] = e.split('@')
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${shown}${'•'.repeat(Math.max(1, Math.min(6, local.length - shown.length)))}@${domain}`
}

// ── Which athletes an assistant is given (migration 035) ─────────────────
//
// Max, 2026-09-28: the head ticks each athlete; a new athlete is never given
// to anyone automatically; an athlete is told when an assistant is given
// access to them.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Most athletes one request may name — far above any roster, below abuse. */
export const MAX_ASSIGN = 500

/**
 * The athlete ids a request asked for: an array of uuids, deduplicated, in
 * order. Null when it is not one — a malformed list is refused, never
 * trimmed down to the valid part, so a typo cannot silently give someone
 * access to fewer (or different) athletes than the head saw ticked.
 */
export function parseAthleteIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ASSIGN) return null
  if (!raw.every((x) => typeof x === 'string' && UUID.test(x))) return null
  return [...new Set((raw as string[]).map((x) => x.toLowerCase()))]
}

/** What changes when an assistant's list goes from `current` to `next`. Pure. */
export function assignmentDiff(current: readonly string[], next: readonly string[]): { add: string[]; remove: string[] } {
  const cur = new Set(current.map((x) => x.toLowerCase()))
  const nxt = new Set(next.map((x) => x.toLowerCase()))
  return {
    add: [...nxt].filter((id) => !cur.has(id)),
    remove: [...cur].filter((id) => !nxt.has(id)),
  }
}

/**
 * The message an athlete gets, in their thread, when an assistant is given
 * access to them. Plain: who, whose team, and what they can see.
 */
export function assignedNoticeText(assistantName: string, headName: string): string {
  return `${assistantName} is an assistant coach on ${headName}’s coaching team on Pindar, and can now see your sessions, messages and check-ins, and message you here.`
}
