'use client'

import { useEffect, useRef, useState, useCallback, useMemo, useId, Suspense, Fragment } from 'react'
import { byName, matchesName } from '@/lib/athlete-filter'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import Calendar, { type CalendarEvent } from '@/app/components/Calendar'
import QuickSessionModal from '@/app/components/QuickSessionModal'
import { markAppReady } from '@/lib/boot-shell'
import MessagingPanel from '@/app/components/MessagingPanel'
import SportWheelPicker from '@/app/components/SportWheelPicker'
import AthletePicker from '@/app/components/AthletePicker'
import { overallWellnessScore, overallScoreColor, type WellnessCheckin } from '@/lib/wellness-config'
import { apiJson, apiMutate } from '@/lib/api-client'
import ListState from '@/app/components/ListState'
import PendingRecordings from '@/app/components/PendingRecordings'
import { gapLabel, isQuiet, QUIET_AFTER_DAYS, type CoverageRow } from '@/lib/attention'
import DayWheel, { wheelMonths, toDateStr, type WheelEvent } from '@/app/components/DayWheel'
import { readCachedProfile, writeCachedProfile, clearCachedProfile, displayName, initialsFor } from '@/lib/profile-cache'
import { activeCount } from '@/lib/athlete-status'
import { formatSessionDate, sessionDate, sessionISODate, todayISODate } from '@/lib/session-date'
import { buildSpine, completeSpineWeeks, SPINE_WEEKS, SPINE_MIN_SESSIONS } from '@/lib/training-spine'
import { GROUP_COLORS, DEFAULT_GROUP_COLOR } from '@/lib/group-colors'
import { errorMessage } from '@/lib/errors'

type Tab = 'home' | 'athletes' | 'groups' | 'sessions' | 'calendar' | 'messages' | 'settings'
type CalMode = 'personal' | 'athlete' | 'group'

/** /api/sessions/all is read in one page of this many rows, newest first,
 *  across the whole roster — not per athlete. */
const SESSIONS_WINDOW = 50

interface Athlete {
  id: string; first_name: string; last_name: string
  email: string; athlete_user_id: string | null; status?: 'INVITED' | 'ACTIVE'
  /** Set the first time they open their portal — the basis for ACTIVE. */
  first_login_at?: string | null
  /** When the coach sent the invite. Returned by /api/athletes. */
  invited_at?: string | null
}
interface Group {
  id: string; name: string; color: string; description: string | null
  member_count: number; member_ids: string[]
}
interface Session {
  id: string; session_name: string | null; summary: string | null
  shared_with_athlete: boolean; session_date?: string | null; created_at: string
  athlete_id: string; athletes?: { id: string; first_name: string; last_name: string; email: string }
}


// ── SVG Icon system ──────────────────────────────────────────────
function Icon({ name, size = 20, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const s: React.CSSProperties = { width: size, height: size, display: 'block', flexShrink: 0 }
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: s }
  switch (name) {
    case 'home':     return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    case 'athletes': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    // Three figures, not a star. A star reads as "favourite" or "rating" and
    // said nothing at all about a squad of people.
    case 'groups':   return <svg {...p}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 14.5a4.5 4.5 0 0 1 4.5 4.5"/></svg>
    case 'sessions': return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    case 'calendar': return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'messages': return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    case 'mic':      return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    case 'plus':     return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    case 'arrow':    return <svg {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    case 'trash':    return <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    case 'copy':     return <svg {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
    case 'edit':     return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    case 'signout':  return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
    case 'refresh':  return <svg {...p}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.9-6.32"/></svg>
    default:         return null
  }
}

// ── Nav definitions ──────────────────────────────────────────────
const NAV_ITEMS: { key: Tab; icon: string; label: string }[] = [
  { key: 'home',     icon: 'home',     label: 'Home'     },
  { key: 'athletes', icon: 'athletes', label: 'Athletes' },
  { key: 'groups',   icon: 'groups',   label: 'Squads'   },
  { key: 'sessions', icon: 'sessions', label: 'Sessions' },
  { key: 'calendar', icon: 'calendar', label: 'Calendar' },
  { key: 'messages', icon: 'messages', label: 'Messages' },
  { key: 'settings', icon: 'settings', label: 'Settings' },
]
// 5-column Instagram-style nav: 2 | FAB | 2
const BOTTOM_NAV_ITEMS: ({ key: Tab; icon: string; label: string } | { fab: true })[] = [
  { key: 'home',     icon: 'home',     label: 'Home'     },
  { key: 'athletes', icon: 'athletes', label: 'Athletes' },
  { fab: true },
  { key: 'calendar', icon: 'calendar', label: 'Calendar' },
  // "Messages", not "Inbox". The sidebar, the page heading and every other
  // reference in the app say Messages; only this label said Inbox.
  { key: 'messages', icon: 'messages', label: 'Messages' },
]

/* ── STADIUM NIGHT furniture ─────────────────────────────────────
 *
 * The coach's home is a scoreboard now (the approved dirA-coach screen), and
 * everything on this page is built from the handful of pieces below.
 *
 * Every colour is a token from app/globals.css, or a token mixed toward
 * transparent with color-mix — there is no literal colour in this file, and
 * the no-restricted-syntax rule in eslint.config.mjs keeps it that way. What
 * the mockups wrote as 11%-cream hairlines and 4.5%-cream panels are the
 * existing --border-soft / --border steps and the cream text token at a few
 * percent, so a change to the ramp reaches them without anyone editing here.
 *
 * --flood is spent on exactly: the record action, the active nav tab, the
 * one spark bar that is this week, and an invite that has just gone. Unread
 * counts are ember (--coach-on-light), as they are on the approved coach
 * screen: waiting on the coach, not a live state. Nothing decorative wears it.
 */
const INK_DEEP = 'color-mix(in srgb, var(--bg) 62%, black)'
const HAIR = '1px solid var(--border-soft)'
const HAIR_2 = '1px solid var(--border)'
const GUTTER = 'clamp(16px, 5vw, 20px)'
/** A token at `pct`% over whatever is underneath it. */
const tint = (token: string, pct: number) => `color-mix(in srgb, ${token} ${pct}%, transparent)`
/** The panel the mockups draw as 4.5% cream: the beam and grid show through it. */
const PANEL = tint('var(--text)', 4.5)
const PANEL_2 = tint('var(--text)', 7.5)

/** Big Shoulders, uppercase, tracked — the scoreboard voice. Sizes are px and
 *  never below the 13px floor. */
function cast(size: number, weight = 700, tracking = '.16em'): React.CSSProperties {
  return {
    fontFamily: 'var(--font-cast)', fontWeight: weight, fontSize: size,
    letterSpacing: tracking, textTransform: 'uppercase', lineHeight: 1.15,
  }
}
const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: '.02em' }

const initialsOf = (first?: string | null, last?: string | null) =>
  `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?'

const ICON_BTN: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 12, flex: 'none', position: 'relative',
  border: HAIR_2, background: tint('var(--text)', 4), color: 'var(--text-2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
}

/** Keyframes, the stage lighting and the few rules inline styles cannot say
 *  (pseudo-elements, :focus-within, reduced motion). */
const STADIUM_CSS = `
.sn-stage{position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(760px 420px at 112% -12%, color-mix(in srgb, var(--primary) 20%, transparent) 0%, transparent 62%),
    radial-gradient(620px 520px at 50% 118%, color-mix(in srgb, var(--ink-mid) 55%, transparent) 0%, transparent 66%);}
.sn-stage::after{content:'';position:absolute;inset:0;
  background-image:
    repeating-linear-gradient(to right, color-mix(in srgb, var(--text) 4.5%, transparent) 0 1px, transparent 1px 39px),
    repeating-linear-gradient(to bottom, color-mix(in srgb, var(--text) 3%, transparent) 0 1px, transparent 1px 39px);
  -webkit-mask-image:linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%);
  mask-image:linear-gradient(196deg, black 0%, color-mix(in srgb, black 25%, transparent) 48%, color-mix(in srgb, black 85%, transparent) 100%);}
@keyframes sn-breathe{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes sn-vu{0%,100%{transform:scaleY(.27)}50%{transform:scaleY(1)}}
.sn-livedot{animation:sn-breathe 2.4s ease-in-out infinite}
.sn-vu i{animation:sn-vu 1.5s ease-in-out infinite;transform-origin:center}
.sn-field{border-bottom:1px solid var(--border-soft)}
.sn-field:focus-within{border-bottom-color:var(--text-2)}
.sn-field input::placeholder{color:var(--text-muted)}
@media (prefers-reduced-motion: reduce){
  .sn-livedot,.sn-vu i{animation:none}
  .sn-vu i{transform:scaleY(.6)}
}
`
function StadiumStyles() {
  return <style>{STADIUM_CSS}</style>
}

/** The brand lockup. The mark is sage, not floodlight: it is chrome, not state. */
function Brand({ rolecap }: { rolecap: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <div aria-hidden style={{
        width: 30, height: 30, borderRadius: 10, flex: 'none',
        border: '1.5px solid var(--primary)', color: 'var(--primary)', background: tint('var(--primary)', 9),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="mic" size={15} strokeWidth={2.2} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...cast(16, 700, '.22em'), lineHeight: 1, color: 'var(--text)' }}>CoachVoice</div>
        <div style={{ ...cast(13, 700, '.26em'), lineHeight: 1, color: 'var(--primary)', marginTop: 4 }}>{rolecap}</div>
      </div>
    </div>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...cast(13, 700, '.26em'), color: 'var(--text-2)' }}>
      <i aria-hidden style={{ width: 7, height: 7, background: 'var(--text-2)', flex: 'none', transform: 'skewX(-14deg)' }} />
      {children}
    </div>
  )
}

/** A section rule: the title, and either a side note or a way through. */
function SecHead({ title, side, action }: {
  title: React.ReactNode; side?: React.ReactNode; action?: { label: string; onClick: () => void }
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 2, minHeight: 24 }}>
      <h2 style={{ margin: 0, ...cast(13, 700, '.26em'), color: 'var(--text-2)' }}>{title}</h2>
      {side && <div style={{ marginLeft: 'auto', ...cast(13, 600, '.16em'), color: 'var(--text-2)' }}>{side}</div>}
      {action && (
        <button onClick={action.onClick} style={{
          marginLeft: 'auto', minHeight: 44, padding: '0 0 0 12px', background: 'none', border: 'none', cursor: 'pointer',
          ...cast(13, 700, '.12em'), color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          {action.label} <Icon name="arrow" size={13} />
        </button>
      )}
    </div>
  )
}

/** A monogram. Solid sage = here; a dashed amber ring = invited, not yet
 *  arrived. The two states are legible before a word is read, and neither
 *  looks like an error. */
function Mono({ initials, pending = false, size = 36, ring }: { initials: string; pending?: boolean; size?: number; ring?: string }) {
  return (
    <div aria-hidden style={{
      width: size, height: size, borderRadius: '50%', flex: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...cast(13, 800, '.04em'), lineHeight: 1,
      ...(pending
        ? { background: ring ?? 'transparent', border: `1px dashed ${tint('var(--energy-dark)', 60)}`, color: 'var(--energy-dark)' }
        : { background: 'var(--primary)', color: 'var(--on-primary)', border: ring ? `2px solid ${ring}` : 'none' }),
    }}>{initials}</div>
  )
}

/** SHARED is sage; DRAFT and PENDING are amber — unfinished, never broken. */
function Chip({ tone, children }: { tone: 'shared' | 'amber'; children: React.ReactNode }) {
  const c = tone === 'shared' ? 'var(--primary)' : 'var(--energy-dark)'
  return (
    <span style={{
      ...cast(13, 700, '.14em'), padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap', display: 'inline-block',
      color: c, border: `1px solid ${tint(c, 42)}`, background: tint(c, 9),
    }}>{children}</span>
  )
}

/** The tape under the header: today, who, and anything waiting. Wraps rather
 *  than clipping — the mockup's nowrap would cut a long name off at 320px. */
function Ticker({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 9, rowGap: 2,
      padding: '7px 0', borderTop: HAIR, borderBottom: HAIR,
      ...cast(13, 600, '.16em'), color: 'var(--text-2)',
    }}>{children}</div>
  )
}
const TickSep = () => <span aria-hidden style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--text-muted)', flex: 'none' }} />

/* The door Squads never had on a phone.
 *
 * Rendered at the top of both the Athletes and the Squads view, so the two
 * halves of "who do I coach" sit behind one destination and each can reach the
 * other. The bottom nav keeps Athletes lit across both.
 *
 * "Squad", not "Group": the app called the same thing Groups & Squads, Group /
 * Squad, "No squads yet", "That squad was not found" and "Join Team" in five
 * different places. One noun.
 */
function PeopleSwitch({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const opt = (key: Tab, label: string) => {
    const on = tab === key
    return (
      <button
        key={key}
        onClick={() => setTab(key)}
        aria-pressed={on}
        style={{
          flex: 1, minHeight: 44, borderRadius: 999, cursor: 'pointer',
          border: '1px solid', borderColor: on ? tint('var(--text)', 40) : 'var(--border-soft)',
          background: on ? tint('var(--text)', 10) : 'transparent',
          color: on ? 'var(--text)' : 'var(--text-2)',
          ...cast(15, 700, '.14em'),
          transition: 'background .12s, border-color .12s',
        }}
      >
        {label}
      </button>
    )
  }
  return (
    <div role="group" aria-label="Athletes or squads" style={{ display: 'flex', gap: 8 }}>
      {opt('athletes', 'Athletes')}
      {opt('groups', 'Squads')}
    </div>
  )
}

// ── Calendar target list item ────────────────────────────────────
/* The active target used to fill with its own colour under white text —
 * which on the ink ground meant white on the lifted --primary, 1.6:1. The
 * colour is now the left rule only, and the text is always cream. */
/** An email that wraps after its @ and dots instead of mid-word.
 *  overflow-wrap: anywhere keeps a long address from pushing the page
 *  sideways, but on its own it breaks wherever the line runs out
 *  ("westlake.schoo / l"). A <wbr> after each separator gives the browser
 *  better places to break, and it takes those before an arbitrary one. */
function BreakableEmail({ email }: { email: string }) {
  const parts = email.split(/(?<=[@.])/)
  return <>{parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <wbr />}</Fragment>)}</>
}

function sideItem(active: boolean, color?: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
    padding: '8px 12px', borderRadius: 8, border: 'none', width: '100%',
    borderLeft: `3px solid ${active ? (color ?? 'var(--primary)') : 'transparent'}`,
    background: active ? tint('var(--text)', 8) : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-2)',
    fontWeight: active ? 700 : 500, fontSize: 'var(--fs-3)', overflowWrap: 'anywhere',
    cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s',
  }
}

/** A page title for the tabs that have no scoreboard of their own. */
function TabTitle({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 30, lineHeight: 1.1, letterSpacing: -0.6, color: 'var(--text)' }}>{title}</h1>
      {sub && <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── Squad builder ────────────────────────────────────────────────
/* Adding people to a squad, many at a time.
 *
 * It was one <select> and one Add tap per athlete: building a squad of twelve
 * was twelve round trips through a native dropdown. Now it is a checklist of
 * everyone not already in the squad, and one "Add N".
 *
 * `onAdd` resolves to the ids that did NOT go in. Those stay ticked, and the
 * list says so, so a partial failure can be retried in one tap rather than
 * being reported once in a toast and then forgotten. */
function SquadAdder({ squadName, candidates, onAdd }: {
  squadName: string
  candidates: Athlete[]
  onAdd: (ids: string[]) => Promise<string[]>
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notAdded, setNotAdded] = useState<string[]>([])
  const searchId = useId()

  const sorted = useMemo(() => [...candidates].sort(byName), [candidates])
  const showSearch = candidates.length > 7
  const shown = showSearch ? sorted.filter((a) => matchesName(a, query)) : sorted
  // Anyone who has since joined the squad is no longer a candidate.
  const live = picked.filter((id) => candidates.some((a) => a.id === id))
  const failedNames = notAdded
    .map((id) => candidates.find((a) => a.id === id))
    .filter((a): a is Athlete => !!a)
    .map((a) => `${a.first_name} ${a.last_name}`)
  const allShownPicked = shown.length > 0 && shown.every((a) => live.includes(a.id))

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = async () => {
    if (live.length === 0 || busy) return
    setBusy(true)
    try {
      const failed = await onAdd(live)
      setNotAdded(failed)
      setPicked(failed)
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SecHead title={`Add to ${squadName}`} />
      {showSearch && (
        <div>
          <label htmlFor={searchId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            Find an athlete to add to {squadName}
          </label>
          <input
            id={searchId}
            className="input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder={`Find one of ${candidates.length}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', minWidth: 0, minHeight: 44 }}
          />
        </div>
      )}
      {shown.length > 1 && (
        <button
          type="button"
          onClick={() => setPicked((prev) => allShownPicked
            ? prev.filter((id) => !shown.some((a) => a.id === id))
            : Array.from(new Set([...prev, ...shown.map((a) => a.id)])))}
          style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 4px', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: 'var(--fs-2)', cursor: 'pointer' }}
        >
          {allShownPicked ? 'Untick all shown' : `Tick all ${shown.length}${query ? ' shown' : ''}`}
        </button>
      )}
      {shown.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', padding: '6px 0' }}>
          Nobody matches “{query}”.{' '}
          <button type="button" onClick={() => setQuery('')} style={{ minHeight: 44, padding: '0 6px', border: 'none', background: 'none', color: 'var(--primary)', fontWeight: 700, fontSize: 'var(--fs-2)', cursor: 'pointer' }}>Show everyone</button>
        </div>
      ) : (
        <div role="group" aria-label={`Athletes not in ${squadName}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 190px), 1fr))', columnGap: 12 }}>
          {shown.map((a) => {
            const on = live.includes(a.id)
            return (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, minWidth: 0, padding: '6px 4px', borderTop: HAIR, cursor: 'pointer', color: 'var(--text)', fontSize: 'var(--fs-3)' }}>
                <input type="checkbox" checked={on} onChange={() => toggle(a.id)} style={{ width: 20, height: 20, flexShrink: 0, accentColor: 'var(--primary)' }} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{a.first_name} {a.last_name}</span>
              </label>
            )
          })}
        </div>
      )}
      {failedNames.length > 0 && (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--fs-2)', fontWeight: 600, overflowWrap: 'anywhere' }}>
          Not added: {failedNames.join(', ')}. They are still ticked — press Add to try again.
        </div>
      )}
      <button
        className="btn btn-primary"
        onClick={() => void submit()}
        disabled={busy || live.length === 0}
        style={{ minHeight: 44, alignSelf: 'stretch' }}
      >
        {busy ? 'Adding…' : live.length === 0 ? 'Tick athletes to add' : `Add ${live.length} to ${squadName}`}
      </button>
    </div>
  )
}

// ── Toasts ───────────────────────────────────────────────────────
/* All three were light fills under white text — the ink-side --success under
 * white is 2.0:1 on the ink palette. They are ink panels now, with the state
 * carried by a coloured rule and the icon. */
const TOAST_BOX: React.CSSProperties = {
  background: 'var(--card)', color: 'var(--text)', borderRadius: 12, overflow: 'hidden',
  border: HAIR_2, boxShadow: `0 8px 32px ${tint('black', 45)}`,
  minWidth: 240, maxWidth: 340, width: '100%',
}
const TOAST_CLOSE: React.CSSProperties = {
  width: 44, height: 44, margin: '-10px -10px -10px 0', background: 'none', border: 'none',
  color: 'var(--text-2)', cursor: 'pointer', fontSize: 20, lineHeight: 1, flexShrink: 0,
}

// ── Simple Toast (success / error) ───────────────────────────────
interface SimpleToastData { id: string; message: string; type: 'success' | 'error' }

function SimpleToast({ data, onDismiss }: { data: SimpleToastData; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const dismiss = () => { setLeaving(true); setTimeout(onDismiss, 320) }
  useEffect(() => { const t = setTimeout(dismiss, 4000); return () => clearTimeout(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isSuccess = data.type === 'success'
  const tone = isSuccess ? 'var(--success)' : 'var(--danger)'
  return (
    <div style={{
      ...TOAST_BOX, borderLeft: `3px solid ${tone}`,
      animation: leaving ? 'toastOut 0.32s ease forwards' : 'toastIn 0.35s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span aria-hidden style={{ fontSize: 'var(--fs-4)', color: tone }}>{isSuccess ? '✓' : '✕'}</span>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--fs-3)', fontWeight: 700 }}>{data.message}</span>
        <button onClick={dismiss} aria-label="Dismiss" style={TOAST_CLOSE}>×</button>
      </div>
      <div style={{ height: 3, background: tint('var(--text)', 10) }}>
        <div style={{ height: '100%', background: tone, animation: 'toastProgress 4s linear forwards' }} />
      </div>
    </div>
  )
}

// ── Receipt Toast ────────────────────────────────────────────────
/**
 * What happened when the coach pressed Save.
 *
 * Saving a session is the app's most consequential action and it used to
 * happen in silence: `onSaved(); onClose()` — the sheet drops away and the
 * coach is returned to an unchanged dashboard. In that same instant the server
 * inserted a session row, created a calendar event and, because
 * `shared_with_athlete` defaults to on, **sent an email to a minor**. None of
 * it was reported. The coach's only way to check was to open the Sessions tab
 * and read the list.
 *
 * Deliberately NOT claimed here: that the email was delivered. The client
 * cannot know — `notifySessionShared` swallows its own failures — and a
 * receipt asserting an unverified send is worse than no receipt.
 *
 * Also deliberately not offered: an Undo. There is no DELETE on
 * `/api/sessions/[id]`, and an undo that cannot be honoured is a worse lie
 * than silence.
 *
 * It lives longer than `SimpleToast`'s four seconds because it carries a tap
 * target, and it does not auto-dismiss while the pointer is over it.
 */
interface ReceiptToastData { id: string; message: string; href: string | null }

function ReceiptToast({ data, onDismiss }: { data: ReceiptToastData; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [held, setHeld] = useState(false)
  const dismiss = () => { setLeaving(true); setTimeout(onDismiss, 320) }
  useEffect(() => {
    if (held) return
    const t = setTimeout(dismiss, 9000)
    return () => clearTimeout(t)
  }, [held]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      style={{
        ...TOAST_BOX, borderLeft: '3px solid var(--success)',
        animation: leaving ? 'toastOut 0.32s ease forwards' : 'toastIn 0.35s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span aria-hidden style={{ fontSize: 'var(--fs-4)', color: 'var(--success)' }}>✓</span>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--fs-3)', fontWeight: 700 }}>{data.message}</span>
        {data.href && (
          <Link href={data.href} style={{ color: 'var(--primary)', fontSize: 'var(--fs-2)', fontWeight: 800, textDecoration: 'underline', whiteSpace: 'nowrap', minHeight: 44, display: 'inline-flex', alignItems: 'center', margin: '-10px 0' }}>
            View
          </Link>
        )}
        <button onClick={dismiss} aria-label="Dismiss" style={TOAST_CLOSE}>×</button>
      </div>
    </div>
  )
}

// ── Join Toast ───────────────────────────────────────────────────
interface JoinToastData { toastId: string; athlete: Athlete }

function JoinToast({ data, onDismiss }: { data: JoinToastData; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const dismiss = () => { setLeaving(true); setTimeout(onDismiss, 320) }

  useEffect(() => {
    const t = setTimeout(dismiss, 7000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{
      ...TOAST_BOX, borderRadius: 14, minWidth: 290,
      animation: leaving ? 'toastOut 0.32s ease forwards' : 'toastIn 0.35s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px 12px' }}>
        <div style={{ width: 4, background: 'var(--primary)', borderRadius: 2, alignSelf: 'stretch', flexShrink: 0 }} />
        <Mono initials={initialsOf(data.athlete.first_name, data.athlete.last_name)} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...cast(17, 700, '.04em'), overflowWrap: 'anywhere' }}>{data.athlete.first_name} {data.athlete.last_name}</div>
          <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 3 }}>accepted your invite</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Link href={`/athletes/${data.athlete.id}`} style={{ fontSize: 'var(--fs-2)', color: 'var(--primary)', fontWeight: 700, textDecoration: 'none', background: tint('var(--primary)', 12), padding: '0 12px', minHeight: 44, borderRadius: 8, display: 'inline-flex', alignItems: 'center' }}>
            View
          </Link>
          <button onClick={dismiss} aria-label="Dismiss" style={{ ...TOAST_CLOSE, margin: 0 }}>×</button>
        </div>
      </div>
      <div style={{ height: 3, background: tint('var(--text)', 8) }}>
        <div style={{ height: '100%', background: 'var(--primary)', animation: 'toastProgress 7s linear forwards', borderRadius: 0 }} />
      </div>
    </div>
  )
}

// ── Settings Tab ─────────────────────────────────────────────────
function SettingsTab({ coachName, coachSport, coachEmail, inviteCode, codeEditing, codeDraft, codeSaving, codeMsg, setCodeDraft, setCodeEditing, setCodeMsg, saveCode, onNameChange, logout }: {
  coachName: string; coachSport: string; coachEmail: string; inviteCode: string | null
  codeEditing: boolean; codeDraft: string; codeSaving: boolean; codeMsg: string
  setCodeDraft: (v: string) => void; setCodeEditing: (v: boolean) => void; setCodeMsg: (v: string) => void
  saveCode: () => void; onNameChange: (f: string, l: string, s: string, e?: string) => void; logout: () => void
}) {
  const [profileForm, setProfileForm] = useState(() => {
    const parts = coachName.trim().split(' ')
    return { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' ') ?? '', sport: coachSport, email: coachEmail }
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')

  const saveProfile = async () => {
    if (!profileForm.first_name.trim() || !profileForm.last_name.trim()) {
      setProfileMsg('First and last name are required.'); return
    }
    setProfileSaving(true); setProfileMsg('')
    try {
      const res = await fetch('/api/coach-profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: profileForm.first_name, last_name: profileForm.last_name, sport: profileForm.sport, email: profileForm.email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      onNameChange(json.first_name, json.last_name, json.sport ?? '', profileForm.email)
      setProfileMsg('Profile updated!')
      setTimeout(() => setProfileMsg(''), 3000)
    } catch (e: unknown) { setProfileMsg(errorMessage(e, 'Failed')) }
    finally { setProfileSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 560 }}>
      <TabTitle title="Settings" />

      {/* ── Profile ── */}
      <div className="card" style={{ padding: 22 }}>
        <SecHead title="Your profile" />
        <div className="section-sub" style={{ marginBottom: 18, color: 'var(--text-2)' }}>How you appear to athletes and in session reports.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <label className="label">First name</label>
              <input className="input" value={profileForm.first_name} onChange={e => setProfileForm(f => ({ ...f, first_name: e.target.value }))} style={{ minWidth: 0, minHeight: 44 }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label className="label">Last name</label>
              <input className="input" value={profileForm.last_name} onChange={e => setProfileForm(f => ({ ...f, last_name: e.target.value }))} style={{ minWidth: 0, minHeight: 44 }} />
            </div>
          </div>
          <div>
            <label className="label">Email address</label>
            <input className="input" type="email" value={profileForm.email} onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))} style={{ minHeight: 44 }} />
            <p style={{ fontSize: 'var(--fs-1)', color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>Changing email updates your login credentials.</p>
          </div>
          <div>
            <label className="label">Sport / discipline (optional)</label>
            <SportWheelPicker value={profileForm.sport} onChange={v => setProfileForm(f => ({ ...f, sport: v }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={saveProfile} disabled={profileSaving} style={{ minWidth: 120, minHeight: 44 }}>
              {profileSaving ? 'Saving…' : 'Save profile'}
            </button>
            {profileMsg && (
              <span style={{ fontSize: 'var(--fs-3)', fontWeight: 600, color: profileMsg.includes('updated') ? 'var(--success)' : 'var(--danger)' }}>
                {profileMsg}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Invite Code ── */}
      <div className="card" style={{ padding: 22 }}>
        <SecHead title="Athlete invite code" />
        <div className="section-sub" style={{ marginBottom: 16, color: 'var(--text-2)' }}>Share this so athletes can join your roster during sign-up.</div>
        {inviteCode && !codeEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {/* Was rust on its own tint — --coach-color on the ink-side --coach-light
                measures 2.7:1. The code is the thing being read, so it is cream. */}
            <div style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere', padding: '12px 15px', background: PANEL_2, border: HAIR_2, borderRadius: 14, ...MONO, fontWeight: 700, fontSize: 22, letterSpacing: '.12em', color: 'var(--text)', lineHeight: 1.2 }}>{inviteCode}</div>
            <button onClick={() => { setCodeDraft(inviteCode); setCodeEditing(true); setCodeMsg('') }} style={ICON_BTN} title="Edit" aria-label="Edit invite code"><Icon name="edit" size={15} /></button>
            <button onClick={() => { navigator.clipboard.writeText(inviteCode); setCodeMsg('Copied!') }} style={ICON_BTN} title="Copy" aria-label="Copy invite code"><Icon name="copy" size={15} /></button>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <label className="label">Invite code</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input className="input" value={codeDraft} onChange={e => setCodeDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="coachsmith4821" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, flex: '1 1 160px', minWidth: 0, minHeight: 44 }} />
              <button className="btn btn-primary" onClick={saveCode} disabled={codeSaving} style={{ minHeight: 44 }}>{codeSaving ? '…' : 'Save'}</button>
              {codeEditing && <button className="btn btn-ghost" onClick={() => { setCodeEditing(false); setCodeMsg('') }} style={{ minHeight: 44 }}>Cancel</button>}
            </div>
            <p style={{ fontSize: 'var(--fs-2)', color: 'var(--text-muted)', marginTop: 5 }}>Letters, numbers, hyphens, underscores · 4–32 chars</p>
          </div>
        )}
        {codeMsg && <p style={{ fontSize: 'var(--fs-3)', fontWeight: 600, color: codeMsg.includes('Copied') || codeMsg.includes('updated') ? 'var(--success)' : 'var(--danger)' }}>{codeMsg}</p>}
        <div className="divider" />
        <SecHead title="How athletes join" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginTop: 10 }}>
          {[['Invite via email', 'Use "Add Athlete" on the Athletes tab.'], ['Share your code', 'Athletes enter it at sign-up to auto-join your roster.']].map(([t, d], i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ background: 'var(--primary)', color: 'var(--on-primary)', borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', ...cast(13, 800, '0'), lineHeight: 1, flexShrink: 0 }}>{i + 1}</span>
              <span><strong style={{ color: 'var(--text)' }}>{t}</strong> — {d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Account ── */}
      <div className="card" style={{ padding: 18 }}>
        <SecHead title="Account" />
        <div className="section-sub" style={{ marginBottom: 14, color: 'var(--text-2)', overflowWrap: 'anywhere' }}>Signed in as {coachName}</div>
        <button onClick={logout} className="btn btn-ghost" style={{ gap: 6, fontSize: 'var(--fs-3)', color: 'var(--danger)', minHeight: 44 }}>
          <Icon name="signout" size={14} /> Sign Out
        </button>
      </div>
    </div>
  )
}

function DashboardPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createSupabaseBrowserClient()

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Read ?tab= and ?athlete= from URL to support deep linking (e.g. from athlete profile Message button)
  const urlTab = searchParams.get('tab') as Tab | null
  const urlAthlete = searchParams.get('athlete')
  const [tab, setTabState] = useState<Tab>(urlTab ?? 'home')
  /* The tab lives in the URL as well as in state. It used to be state alone,
   * so opening an athlete from the roster and pressing back landed on Home:
   * with twenty athletes, every switch cost a trip back to the Athletes tab
   * and a retyped search. replace, not push, so tabs do not pile up history. */
  const setTab = useCallback((t: Tab) => {
    setTabState(t)
    router.replace(t === 'home' ? '/dashboard' : `/dashboard?tab=${t}`, { scroll: false })
  }, [router])
  const mainRef = useRef<HTMLElement>(null)

  // Scroll to top whenever tab changes
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [tab])

  // Seeded from the session cache so returning to the dashboard paints the
  // coach's real name on the first frame instead of flashing "Coach" while the
  // profile query round-trips. Revalidated in boot() below.
  const cachedProfile = readCachedProfile()
  const [coachName, setCoachName] = useState(() => (cachedProfile ? displayName(cachedProfile) : ''))
  const [coachInitials, setCoachInitials] = useState(() => (cachedProfile ? initialsFor(cachedProfile) : ''))
  const [coachSport, setCoachSport] = useState(cachedProfile?.sport ?? '')
  const [coachEmail, setCoachEmail] = useState(cachedProfile?.email ?? '')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [codeEditing, setCodeEditing] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [codeMsg, setCodeMsg] = useState('')
  const [codeSaving, setCodeSaving] = useState(false)

  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(false)
  /* "Nothing here" and "we could not find out" are different sentences.
   *
   * These fetchers all did `if (res.ok) setX(...)` with no else, so a 500 or a
   * dropped connection left the list at its initial [] and the screen said
   * "No athletes yet. Add one to get started." to a coach with thirty athletes.
   * The advice is wrong, the state is wrong, and there is no way back except a
   * refresh the user has no reason to attempt. */
  const [athletesError, setAthletesError] = useState<string | null>(null)
  const [wellnessByAthlete, setWellnessByAthlete] = useState<Map<string, WellnessCheckin>>(new Map())
  // Kept for the browser tab's session, so a search survives opening a
  // profile and coming back. sessionStorage can throw in private modes.
  const [athleteSearch, setAthleteSearchState] = useState(() => {
    try { return sessionStorage.getItem('cv:roster-q') ?? '' } catch { return '' }
  })
  const setAthleteSearch = (q: string) => {
    setAthleteSearchState(q)
    try { sessionStorage.setItem('cv:roster-q', q) } catch { /* not kept */ }
  }
  // 'INACTIVE' is not a status like the other two, and it deliberately overlaps
  // both. It asks "has anything been recorded for this person lately", which
  // is true of an ACTIVE athlete nobody has recorded for in a fortnight AND of
  // an INVITED athlete who has been on the roster a week with no session at
  // all. That is why it is a filter and not a fourth badge: it is a different
  // question about the same roster, not another value of the same field. The
  // rule and its thresholds are in lib/attention.ts.
  const [athleteFilter, setAthleteFilter] = useState<'all' | 'ACTIVE' | 'INVITED' | 'INACTIVE'>('all')
  const [addForm, setAddForm] = useState({ firstName: '', lastName: '', email: '' })
  const [addMsg, setAddMsg] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [showAddAthlete, setShowAddAthlete] = useState(false)
  /** The invite that has just gone, shown at the top of the sheet until it closes. */
  const [lastInvite, setLastInvite] = useState<{ firstName: string; lastName: string; email: string; at: Date } | null>(null)
  const [onboardStep, setOnboardStep] = useState({ code: false, athlete: false, session: false })

  const [groups, setGroups] = useState<Group[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [newGroupForm, setNewGroupForm] = useState({ name: '', color: DEFAULT_GROUP_COLOR, description: '' })
  const [groupMsg, setGroupMsg] = useState('')
  const [groupSaving, setGroupSaving] = useState(false)

  const [allSessions, setAllSessions] = useState<Session[]>([])
  /* The same newest-N list with no search or athlete filter applied, which is
   * what Home counts from. The Sessions tab's search used to replace the one
   * list both screens read, so searching "serve" and going back to Home turned
   * "sessions this week", the spark and Latest into counts of the matches. */
  const [homeSessions, setHomeSessions] = useState<Session[]>([])
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  /* Whether the coverage read has come back at all — not the same question as
   * whether it is empty.
   *
   * The Inactive filter is computed from it, so before it lands the list is
   * empty for want of data. Saying "nobody has gone more than 14 days without
   * a recording" at that moment states as fact something we do not know yet,
   * and it is the wrong way round: the answer today is four of eight. */
  const [coverageLoaded, setCoverageLoaded] = useState(false)
  /** Separate from "loaded", because a failed read is not an empty roster and
   *  must not be reported as one. */
  const [coverageFailed, setCoverageFailed] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsSearch, setSessionsSearch] = useState('')
  const [sessionsAthleteFilter, setSessionsAthleteFilter] = useState('')
  /** The search and athlete that produced `allSessions` — not whatever is typed
   *  in the box now. "Load older" continues THIS list. */
  const [sessionsQuery, setSessionsQuery] = useState({ search: '', athleteId: '' })
  /** The route returned a full page, so there may be older sessions. */
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState<string | null>(null)

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [msgPreselectedId, setMsgPreselectedId] = useState<string | null>(urlAthlete ?? null)

  const [deleteConfirmAthlete, setDeleteConfirmAthlete] = useState<Athlete | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Join notifications
  const [joinToasts, setJoinToasts] = useState<JoinToastData[]>([])
  const athletesRef = useRef<Athlete[]>([])
  const [coachUserId, setCoachUserId] = useState<string | null>(null)

  // Simple toasts (success/error)
  const [simpleToasts, setSimpleToasts] = useState<SimpleToastData[]>([])
  const [receipts, setReceipts] = useState<ReceiptToastData[]>([])
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setSimpleToasts(prev => [...prev, { id, message, type }])
  }

  const [quickSessionOpen, setQuickSessionOpen] = useState(false)
  const [quickSessionAthleteId, setQuickSessionAthleteId] = useState<string | undefined>()
  const [quickSessionGroupId, setQuickSessionGroupId] = useState<string | undefined>()

  const [calMode, setCalMode] = useState<CalMode>('personal')
  const [calTargetId, setCalTargetId] = useState('')
  /** Phone only: whether the "Showing: …" control is open. */
  const [calPickerOpen, setCalPickerOpen] = useState(false)
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [calLoading, setCalLoading] = useState(false)
  const [calError, setCalError] = useState('')
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [addEventModal, setAddEventModal] = useState<{ date: string } | null>(null)
  const [eventForm, setEventForm] = useState({ title: '', description: '', event_type: 'session', event_time: '' })
  const [eventSaving, setEventSaving] = useState(false)
  const [alsoAddToCoach, setAlsoAddToCoach] = useState(false)

  // Today's events for home tab
  const [todayEvents, setTodayEvents] = useState<CalendarEvent[]>([])
  const [homeWeekEvents, setHomeWeekEvents] = useState<CalendarEvent[]>([])
  const [homeSelectedDay, setHomeSelectedDay] = useState<string | null>(null)

  const [homeEventsError, setHomeEventsError] = useState<string | null>(null)
  /** What the wheel last showed, so a month that fails to load keeps it. */
  const homeEventsRef = useRef<CalendarEvent[]>([])
  const homeEventsReqRef = useRef(0)

  // The day wheel spans roughly eight weeks either side of today, which can
  // cross three or four calendar months — fetch each one the range touches and
  // merge, rather than the single current month the old seven-day strip needed.
  //
  // A month that fails is NOT "no events". It used to be read as
  // `r.ok ? r.json() : { events: [] }`, so one 500 emptied a month of the
  // wheel and the coach saw a free fortnight that was actually booked. Now a
  // failed month keeps whatever the wheel already had for it, and the wheel
  // says it could not refresh.
  const refreshHomeEvents = useCallback(async () => {
    const seq = ++homeEventsReqRef.current
    const months = wheelMonths()
    const results = await Promise.allSettled(
      months.map((m) =>
        apiJson<{ events?: CalendarEvent[] }>(`/api/calendar?mode=personal&month=${m}`, { cache: 'no-store' }),
      ),
    )
    if (seq !== homeEventsReqRef.current) return
    const failed = new Set<string>()
    const byId = new Map<string, CalendarEvent>()
    results.forEach((r, i) => {
      if (r.status === 'rejected') { failed.add(months[i]); return }
      for (const ev of r.value.events ?? []) byId.set(ev.id, ev)
    })
    for (const ev of homeEventsRef.current) {
      if (failed.has(ev.event_date.slice(0, 7)) && !byId.has(ev.id)) byId.set(ev.id, ev)
    }
    const allEvs = Array.from(byId.values())
    homeEventsRef.current = allEvs
    const todayStr = toDateStr(new Date())
    setHomeWeekEvents(allEvs)
    setTodayEvents(allEvs.filter((e) => e.event_date === todayStr))
    setHomeEventsError(
      failed.size === 0 ? null
        : failed.size === months.length ? 'Could not load your calendar.'
        : 'Some of your calendar could not be loaded.',
    )
  }, [])

  useEffect(() => {
    const boot = async () => {
      // The roster, groups, sessions and unread counts are all cookie-authenticated
      // API routes — they don't need the user id on the client, so they start
      // immediately instead of queueing behind getUser() and the profile query.
      // That removes two serial round trips from every arrival on the dashboard.
      const dataReady = Promise.all([
        fetchAthletes(), fetchGroups(), fetchAllSessions(), fetchUnreadCounts(), fetchCoverage(),
      ])

      // The day strip starts here too, not after `await dataReady`.
      //
      // refreshHomeEvents fires five calendar requests and is the main content
      // of the default tab — the first thing the coach looks at. It was queued
      // behind the roster, the groups, the sessions, the unread counts AND the
      // coverage read, none of which it uses. It is cookie-authenticated like
      // the rest, so there was never anything to wait for.
      const homeEventsReady = refreshHomeEvents()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }

      const { data: profile } = await supabase
        .from('profiles').select('role,first_name,last_name,sport,invite_code')
        .eq('id', user.id).single()

      if (profile?.role === 'athlete') { router.push('/athlete'); return }

      const name = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || (user.email ?? '')
      const initials = profile?.first_name && profile?.last_name
        ? `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase()
        : (user.email?.[0] ?? '?').toUpperCase()

      setCoachUserId(user.id)
      setCoachName(name); setCoachInitials(initials)
      setCoachSport(profile?.sport ?? '')
      setCoachEmail(user.email ?? '')

      // Keep the cache fresh so the next navigation paints instantly.
      writeCachedProfile({
        userId: user.id,
        role: 'coach',
        firstName: profile?.first_name ?? '',
        lastName: profile?.last_name ?? '',
        sport: profile?.sport ?? '',
        email: user.email ?? '',
      })
      setInviteCode(profile?.invite_code ?? null)
      if (profile?.invite_code) setCodeDraft(profile.invite_code)

      await Promise.all([dataReady, homeEventsReady])
    }
    void boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wellness roster summary (home tab strip + athletes tab) — self-contained
  // fetch, same pattern as the athlete profile's at-a-glance card: a failure
  // here just means no scores show, it shouldn't block anything else.
  useEffect(() => {
    let cancelled = false
    fetch('/api/wellness?days=14', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load wellness'))))
      .then(json => {
        if (cancelled) return
        const list: WellnessCheckin[] = json.checkins ?? []
        const map = new Map<string, WellnessCheckin>()
        for (const c of list) map.set(c.athlete_id, c) // ascending by check_date, so last write wins = latest
        setWellnessByAthlete(map)
      })
      .catch(() => { if (!cancelled) setWellnessByAthlete(new Map()) })
    return () => { cancelled = true }
  }, [])

  const fetchAthletes = async () => {
    setLoadingAthletes(true)
    setAthletesError(null)
    try {
      const json = await apiJson<{ athletes?: Athlete[] }>('/api/athletes', { cache: 'no-store' })
      // The route always answers { athletes: [...] }. Anything else is an error,
      // not an empty roster: a coach shown no athletes would reasonably believe
      // their athletes had been deleted.
      if (!Array.isArray(json.athletes)) throw new Error('Could not load your athletes.')
      // Alphabetical, once, here. The API returns newest-invited first, and
      // every list on this screen, the recorder and Messages inherited that
      // accident: twenty names in the order they were invited.
      setAthletes([...json.athletes].sort(byName))
    } catch (e) {
      setAthletesError(e instanceof Error ? e.message : 'Could not load your athletes.')
    } finally { setLoadingAthletes(false); markAppReady() }
  }

  const fetchUnreadCounts = async () => {
    try {
      const res = await fetch('/api/messages/unread', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setUnreadCounts(json.counts ?? {})
    } catch {}
  }

  const fetchGroups = async () => {
    setLoadingGroups(true)
    setGroupsError(null)
    try {
      const json = await apiJson<{ groups?: Group[] }>('/api/groups', { cache: 'no-store' })
      setGroups(json.groups ?? [])
    } catch (e) {
      setGroupsError(e instanceof Error ? e.message : 'Could not load your squads.')
    } finally { setLoadingGroups(false) }
  }

  /* One page of /api/sessions/all. `hasMore` is the route's own answer (it
   * returned a full page), so "50 newest" is only said when there may be more. */
  const getSessionsPage = (search: string, athleteId: string, offset: number) => {
    const p = new URLSearchParams({ limit: String(SESSIONS_WINDOW), offset: String(offset) })
    if (search) p.set('search', search)
    if (athleteId) p.set('athlete_id', athleteId)
    return apiJson<{ sessions?: Session[]; hasMore?: boolean }>(`/api/sessions/all?${p}`, { cache: 'no-store' })
  }

  /* Only the newest request may write — the same rule as calReqRef below.
   *
   * Every search, every athlete pick, a save, a synced upload and the boot read
   * all call fetchAllSessions, with no ordering guarantee between them. Without
   * a guard the boot's unfiltered read could land after the coach had filtered
   * to one athlete and replace their list with everyone's, under a filter box
   * still naming that athlete. Two counters, because the Sessions list and
   * Home's unfiltered copy are different lists: a stale response can be stale
   * for one and still the newest word for the other. */
  const sessionsReqRef = useRef(0)
  const homeSessionsReqRef = useRef(0)
  /** Where the next "Load older" page starts. Tracked separately from the list
   *  length because rows already on screen are de-duplicated out of a page. */
  const sessionsNextOffsetRef = useRef(SESSIONS_WINDOW)

  const fetchAllSessions = async (search = '', athleteId = '') => {
    const seq = ++sessionsReqRef.current
    const homeSeq = !search && !athleteId ? ++homeSessionsReqRef.current : null
    setLoadingSessions(true)
    setSessionsError(null)
    setOlderError(null)
    setLoadingOlder(false)
    try {
      const json = await getSessionsPage(search, athleteId, 0)
      const rows: Session[] = json.sessions ?? []
      if (homeSeq !== null && homeSeq === homeSessionsReqRef.current) setHomeSessions(rows)
      if (seq === sessionsReqRef.current) {
        setAllSessions(rows)
        setSessionsHasMore(json.hasMore === true)
        setSessionsQuery({ search, athleteId })
        sessionsNextOffsetRef.current = SESSIONS_WINDOW
      }
      // Returned so a caller can diff before/after and work out what a save
      // actually created — see the receipt in onSaved.
      return rows
    } catch (e) {
      // The list is left exactly as it was. Replacing it with [] here is how
      // "we could not reach the server" turned into "you have no sessions".
      if (seq === sessionsReqRef.current) setSessionsError(errorMessage(e, 'Could not load sessions.'))
      return [] as Session[]
    } finally {
      if (seq === sessionsReqRef.current) setLoadingSessions(false)
    }
  }

  /** Home's unfiltered newest-N only; leaves the Sessions tab's list alone. */
  const fetchHomeSessions = async () => {
    const seq = ++homeSessionsReqRef.current
    try {
      const json = await getSessionsPage('', '', 0)
      const rows: Session[] = json.sessions ?? []
      if (seq === homeSessionsReqRef.current) setHomeSessions(rows)
      return rows
    } catch {
      // Home keeps what it had. The Sessions list refresh that runs beside
      // this one surfaces the failure where there is room to say it.
      return [] as Session[]
    }
  }

  /* After something changed the data underneath (a save, a synced upload, a
   * deleted athlete): refresh Home, and refresh the Sessions tab AS IT IS
   * FILTERED. These callers used to run an unfiltered fetch, which replaced a
   * coach's filtered list with everyone's while the filter box still showed
   * the filter. Returns Home's unfiltered rows, which is what onSaved diffs. */
  const refreshSessions = async (): Promise<Session[]> => {
    const { search, athleteId } = sessionsQuery
    if (!search && !athleteId) return fetchAllSessions()
    const [home] = await Promise.all([fetchHomeSessions(), fetchAllSessions(search, athleteId)])
    return home
  }

  /* The Sessions tab past its first page. Appends; never touches Home. A page
   * that lands after the list was re-queried (new search, new athlete) belongs
   * to a list that no longer exists and is dropped. */
  const loadOlderSessions = async () => {
    if (loadingOlder) return
    const seq = sessionsReqRef.current
    const { search, athleteId } = sessionsQuery
    const offset = sessionsNextOffsetRef.current
    setLoadingOlder(true)
    setOlderError(null)
    try {
      const json = await getSessionsPage(search, athleteId, offset)
      if (seq !== sessionsReqRef.current) return
      const rows: Session[] = json.sessions ?? []
      sessionsNextOffsetRef.current = offset + SESSIONS_WINDOW
      // A session saved since the first page shifts every offset down by one,
      // so the new page can repeat the last row already shown. Drop repeats by
      // id rather than show one session twice.
      setAllSessions(prev => {
        const seen = new Set(prev.map(s => s.id))
        return [...prev, ...rows.filter(s => !seen.has(s.id))]
      })
      setSessionsHasMore(json.hasMore === true)
    } catch (e) {
      if (seq === sessionsReqRef.current) setOlderError(errorMessage(e, 'Could not load older sessions.'))
    } finally {
      if (seq === sessionsReqRef.current) setLoadingOlder(false)
    }
  }

  // Who has gone longest without a recording. Server-computed on purpose: the
  // same numbers derived on the client from `allSessions` are wrong past 50
  // sessions across the roster, and wrong in the direction that hides a
  // neglected athlete. See app/api/athletes/coverage/route.ts.
  const fetchCoverage = async () => {
    try {
      const { coverage: rows } = await apiJson<{ coverage: CoverageRow[] }>(
        '/api/athletes/coverage',
        { cache: 'no-store' },
      )
      setCoverage(rows ?? [])
      setCoverageFailed(false)
    } catch {
      // A failed coverage read must not break the dashboard. The Inactive
      // filter then reports that it could not work it out, rather than
      // claiming the roster is fine.
      setCoverage([])
      setCoverageFailed(true)
    } finally {
      setCoverageLoaded(true)
    }
  }

  const handleUnreadChange = useCallback((counts: Record<string, number>) => {
    setUnreadCounts(counts)
  }, [])

  /**
   * Only the newest request may write. Pressing ‹ twice quickly fires two
   * fetches with no ordering guarantee, so without this the older month's
   * response can land last and win — the grid then shows one month and the
   * dots belong to another, which looks exactly like the unmount bug it sits
   * next to. The same counter owns `calLoading`, because a plain boolean is
   * cleared by whichever request finishes first while the other is still out.
   */
  const calReqRef = useRef(0)

  /* Switching whose calendar you are looking at.
   *
   * The events must be dropped in the same breath as the target, or the
   * previous athlete's dots and detail entries keep rendering under the new
   * athlete's name until the fetch lands — one child's session showing as
   * another's. The athlete profile host guards this explicitly; this host did
   * not, and three separate onClicks set the mode and target without it.
   * Funnelled through one function so a fourth cannot be added without it. */
  const showCalendarFor = (mode: CalMode, targetId: string) => {
    setCalMode(mode)
    setCalTargetId(targetId)
    setCalEvents([])
    setCalError('')
  }

  const pickCalendar = (mode: CalMode, targetId: string) => {
    showCalendarFor(mode, targetId)
    setCalPickerOpen(false)
  }

  const fetchCalendar = useCallback(async (mode: CalMode, targetId: string, month: string) => {
    // Don't fetch athlete/group calendars until a target is selected
    if ((mode === 'athlete' || mode === 'group') && !targetId) {
      // Claim the sequence on the way out too. Without this an older request
      // still in flight passes its own guard and writes the previous athlete's
      // events back over the cleared state — the one asymmetry in the counter.
      calReqRef.current++
      setCalEvents([])
      setCalError('')
      setCalLoading(false)
      return
    }
    const seq = ++calReqRef.current
    setCalLoading(true)
    setCalError('')
    try {
      const p = new URLSearchParams({ month })
      if (mode === 'personal') p.set('mode', 'personal')
      else if (mode === 'group') p.set('group_id', targetId)
      else p.set('athlete_id', targetId)
      // apiJson, not raw fetch: a non-2xx used to be swallowed here, leaving
      // the previous month's events on screen with nothing said. Checklist
      // item 1 in CLAUDE.md.
      const json = await apiJson<{ events: CalendarEvent[] }>(`/api/calendar?${p}`, { cache: 'no-store' })
      if (seq !== calReqRef.current) return
      setCalEvents(json.events ?? [])
    } catch (e: unknown) {
      if (seq !== calReqRef.current) return
      // Say so rather than showing a stale month as if it were this one.
      setCalEvents([])
      setCalError(errorMessage(e, 'Could not load this month.'))
    } finally {
      if (seq === calReqRef.current) setCalLoading(false)
    }
  }, [])

  // Keep ref in sync so Realtime closure always sees fresh athletes
  useEffect(() => { athletesRef.current = athletes }, [athletes])

  // Realtime: detect when invited athlete accepts and becomes active
  useEffect(() => {
    if (!coachUserId) return
    const channel = supabase
      .channel(`athlete-joins-${coachUserId}`)
      // Supabase types the realtime payload generically; this names only the
      // two columns the handler reads. Both sides are partial because an UPDATE
      // payload carries whatever the replica identity includes, not the row.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'athletes' }, (payload: {
        old?: { athlete_user_id?: string | null }
        new?: { id?: string; athlete_user_id?: string | null }
      }) => {
        const prev = payload.old
        const next = payload.new
        // Athlete just activated: had no user_id before, now has one
        if (!prev?.athlete_user_id && next?.athlete_user_id) {
          const match = athletesRef.current.find(a => a.id === next.id)
          if (match) {
            setJoinToasts(t => [...t, { toastId: `${next.id}-${Date.now()}`, athlete: match }])
            void fetchAthletes() // refresh status
          }
        }
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachUserId])

  useEffect(() => {
    if (tab === 'calendar') void fetchCalendar(calMode, calTargetId, calMonth)
  }, [tab, calMode, calTargetId, calMonth, fetchCalendar])

  useEffect(() => {
    setOnboardStep(prev => ({ ...prev, code: !!inviteCode }))
  }, [inviteCode])

  const saveCode = async () => {
    setCodeSaving(true); setCodeMsg('')
    try {
      const res = await fetch('/api/coach-code', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeDraft }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      setInviteCode(json.inviteCode); setCodeEditing(false); setCodeMsg('Code updated!')
    } catch (e: unknown) { setCodeMsg(errorMessage(e, 'Failed')) }
    finally { setCodeSaving(false) }
  }

  const createAthlete = async () => {
    if (!addForm.firstName.trim() || !addForm.lastName.trim() || !addForm.email.trim()) {
      setAddMsg('All fields are required.'); return
    }
    setAddLoading(true); setAddMsg('')
    try {
      const res = await fetch('/api/athletes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: addForm.firstName, last_name: addForm.lastName, email: addForm.email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      // The sheet stays open: it now shows the row this created and what
      // PENDING will mean for them, with the form reset for the next one.
      setLastInvite({ firstName: addForm.firstName.trim(), lastName: addForm.lastName.trim(), email: addForm.email.trim(), at: new Date() })
      setAddForm({ firstName: '', lastName: '', email: '' })
      setAddMsg('')
      await fetchAthletes()
    } catch (e: unknown) { setAddMsg(errorMessage(e, 'Failed')) }
    finally { setAddLoading(false) }
  }

  const createGroup = async () => {
    if (!newGroupForm.name.trim()) { setGroupMsg('Name is required.'); return }
    setGroupSaving(true); setGroupMsg('')
    try {
      const res = await fetch('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupForm.name.trim(), color: newGroupForm.color, description: newGroupForm.description.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error)
      setGroups(prev => [json.group, ...prev])
      setNewGroupForm({ name: '', color: DEFAULT_GROUP_COLOR, description: '' })
    } catch (e: unknown) { setGroupMsg(errorMessage(e, 'Failed')) }
    finally { setGroupSaving(false) }
  }

  const deleteGroup = async (id: string) => {
    if (!confirm('Delete this group? Athletes are not removed.')) return
    try {
      await apiMutate(`/api/groups?id=${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Could not delete the group'), 'error')
      return
    }
    setGroups(prev => prev.filter(g => g.id !== id))
    if (expandedGroup === id) setExpandedGroup(null)
  }

  /** Adds each athlete; resolves to the ids that failed. Reports honestly:
   *  "2 of 3 added" is a different sentence from "added". */
  const addMembersToGroup = async (group: Group, athleteIds: string[]): Promise<string[]> => {
    const results = await Promise.allSettled(athleteIds.map((athleteId) =>
      apiMutate(`/api/groups/${group.id}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId }),
      }),
    ))
    const failed = athleteIds.filter((_, i) => results[i].status === 'rejected')
    const firstReason = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason
    const added = athleteIds.length - failed.length
    if (failed.length === 0) {
      showToast(`Added ${added} to ${group.name}`)
    } else if (added === 0) {
      showToast(`Could not add ${failed.length === 1 ? 'that athlete' : `any of the ${failed.length}`} to ${group.name}: ${errorMessage(firstReason, 'try again.')}`, 'error')
    } else {
      showToast(`Added ${added} of ${athleteIds.length} to ${group.name}. ${failed.length} could not be added: ${errorMessage(firstReason, 'try again.')}`, 'error')
    }
    if (added > 0) await fetchGroups()
    return failed
  }

  const removeMemberFromGroup = async (groupId: string, athleteId: string) => {
    try {
      await apiMutate(`/api/groups/${groupId}/members?athlete_id=${athleteId}`, { method: 'DELETE' })
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Could not remove that athlete'), 'error')
      return
    }
    await fetchGroups()
  }

  const saveEvent = async () => {
    if (!addEventModal || !eventForm.title.trim()) return
    setEventSaving(true)
    try {
      const base = {
        title: eventForm.title, description: eventForm.description || null,
        event_type: eventForm.event_type, event_date: addEventModal.date,
        event_time: eventForm.event_time || null,
      }
      const body: Record<string, unknown> = { ...base }
      if (calMode === 'athlete') body.athlete_id = calTargetId
      else if (calMode === 'group') body.group_id = calTargetId

      const res = await fetch('/api/calendar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        showToast(json?.error ?? 'Failed to save event', 'error')
        return
      }

      // Optionally also add the same event to coach's personal calendar.
      // The athlete's copy is already saved at this point, so a failure here is
      // reported but doesn't discard that.
      let coachCopyFailed = false
      if (alsoAddToCoach && (calMode === 'athlete' || calMode === 'group')) {
        try {
          await apiMutate('/api/calendar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(base), // no athlete_id/group_id = personal event
          })
        } catch {
          coachCopyFailed = true
        }
      }

      setAddEventModal(null)
      setEventForm({ title: '', description: '', event_type: 'session', event_time: '' })
      setAlsoAddToCoach(false)
      await fetchCalendar(calMode, calTargetId, calMonth)

      // Refresh the wheel so a new event shows without a page reload.
      await refreshHomeEvents()

      const label = calMode === 'group' ? 'Event added for group' : 'Event added to calendar'
      if (coachCopyFailed) {
        showToast(`${label}, but it could not be added to your own calendar`, 'error')
      } else {
        showToast(`✓ ${label}${alsoAddToCoach ? ' + your calendar' : ''}`)
      }
    } catch {
      showToast('Failed to save event', 'error')
    } finally { setEventSaving(false) }
  }

  const deleteEvent = async (id: string) => {
    try {
      await apiMutate(`/api/calendar?id=${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      showToast(errorMessage(e, 'Could not delete the event'), 'error')
      return
    }
    setCalEvents(prev => prev.filter(e => e.id !== id))
  }

  const confirmDelete = async () => {
    const target = deleteConfirmAthlete
    if (!target) return
    setDeleteLoading(true)
    setDeleteError(null)
    try {
      // apiMutate: a dropped connection used to escape this try/finally as an
      // unhandled rejection, and the dialog just stopped saying "Deleting…"
      // with nothing to tell the coach whether a child's record was gone.
      await apiMutate(`/api/athletes/${target.id}/hard-delete`, { method: 'POST' })
    } catch (e: unknown) {
      setDeleteError(errorMessage(e, 'Could not delete this athlete. Try again.'))
      setDeleteLoading(false)
      return
    }
    setDeleteLoading(false)
    setDeleteConfirmAthlete(null)
    showToast(`Deleted ${target.first_name} ${target.last_name}`)
    // Their sessions and squad places went with them; Home and Squads were
    // still counting them.
    await Promise.all([fetchAthletes(), fetchGroups(), refreshSessions(), fetchCoverage()])
  }

  const closeDeleteConfirm = () => { setDeleteConfirmAthlete(null); setDeleteError(null) }

  const logout = async () => { clearCachedProfile(); await supabase.auth.signOut(); router.push('/') }

  /**
   * Per-athlete session totals, from the coverage route rather than from
   * `allSessions`.
   *
   * `allSessions` is fetched with `limit: '50'` — the 50 newest sessions
   * across the WHOLE roster, not per athlete. The roster cards were deriving
   * "Last session" and "N total" from it, so once a coach passed 50 sessions
   * the cards started reporting "No sessions yet" for athletes with twenty,
   * silently, and worst for the busiest coaches. The coverage route counts
   * every session server-side, which is what it was built for.
   */
  const coverageByAthlete = useMemo(
    () => new Map(coverage.map((c) => [c.athlete_id, c])),
    [coverage],
  )

  /** Inactive: nobody has recorded for them in a fortnight. lib/attention.ts
   *  owns the threshold; this only asks the question. Uncomputable until the
   *  coverage read lands, which is why it is keyed off the same map the roster
   *  cards use rather than off the truncated `allSessions` window — deriving
   *  it from that would report "no sessions yet" for an athlete with twenty
   *  and put them in this list wrongly. */
  const inactiveIds = useMemo(
    () => new Set(coverage.filter(isQuiet).map((c) => c.athlete_id)),
    [coverage],
  )

  const filteredAthletes = athletes.filter(a => {
    // The fallback used to be `a.athlete_user_id ? 'ACTIVE' : 'INVITED'` — the
    // old, wrong definition kept as a default in three places on this screen.
    // `athlete_user_id` is written at invite time, so it made "we have not heard
    // from them" render as Active. If the API ever stops sending `status`, the
    // honest guess about someone we have no evidence for is INVITED.
    const status = a.status ?? 'INVITED'
    if (athleteFilter === 'INACTIVE') {
      if (!inactiveIds.has(a.id)) return false
    } else if (athleteFilter !== 'all' && status !== athleteFilter) return false
    // "Sophie G" and an autocompleted "Sophie " both used to match nobody:
    // first and last name were tested separately against the raw string.
    const s = athleteSearch.trim()
    return !s || matchesName(a, s) || a.email.toLowerCase().includes(s.toLowerCase())
  })

  const recentSessions = homeSessions.slice(0, 3)
  const totalUnreadAll = Object.values(unreadCounts).reduce((a: number, b: number) => a + b, 0)

  const calTitle = calMode === 'personal'
    ? 'My Calendar'
    : calMode === 'group'
      ? (groups.find(g => g.id === calTargetId)?.name ?? 'Group') + ' Calendar'
      : (() => { const a = athletes.find(a => a.id === calTargetId); return a ? `${a.first_name}'s Calendar` : 'Calendar' })()
  const calTargetLabel = calMode === 'personal'
    ? 'My calendar'
    : calMode === 'group'
      ? (groups.find(g => g.id === calTargetId)?.name ?? 'Squad')
      : (() => { const a = athletes.find(a => a.id === calTargetId); return a ? `${a.first_name} ${a.last_name}` : 'Athlete' })()
  const calSubtitle = calMode === 'personal'
    ? 'Personal events only you can see'
    : calMode === 'group'
      ? `Event is added for all ${groups.find(g => g.id === calTargetId)?.member_count ?? 0} athletes in this group`
      : 'Only what you add here is visible to the athlete'

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = coachName.split(' ')[0]

  // ── The scoreboard's numbers ──────────────────────────────────
  /* The big number and its twelve-week spark both come from buildSpine
   * (lib/training-spine.ts): calendar weeks, bucketed by local midnight, the
   * version the clock rig runs under nine timezones. The home stat used to
   * count a rolling 7 x 86,400,000ms instead, which is the arithmetic that rig
   * exists to catch — and a spark whose "now" bar disagreed with the number
   * printed above it would be worse than either. */
  const spine = buildSpine(homeSessions)
  /* homeSessions is the SESSIONS_WINDOW newest rows across the whole roster. Once
   * that window is full, the oldest weeks in it are only partly inside it, and
   * a spark drawn from them would show a busy coach's record tapering away
   * when it did not. So only the weeks the window wholly contains are drawn:
   * the ones after the week of its oldest session. */
  const windowFull = homeSessions.length >= SESSIONS_WINDOW
  const completeWeeks = completeSpineWeeks(homeSessions, windowFull)
  const sparkWeeks = completeWeeks > 0 ? spine.weeks.slice(SPINE_WEEKS - completeWeeks) : []
  const sparkTotal = sparkWeeks.reduce((a, b) => a + b, 0)
  const sparkMax = Math.max(1, ...sparkWeeks)
  const showSpark = sparkWeeks.length >= 2 && sparkTotal >= SPINE_MIN_SESSIONS
  // A full window that is entirely this week cannot say how many this week had.
  const weekCountLabel = `${spine.thisWeek}${windowFull && completeWeeks === 0 ? '+' : ''}`
  const hugeSize = weekCountLabel.length <= 2 ? 100 : weekCountLabel.length === 3 ? 72 : 56

  // Wellness across the roster: the mean of each athlete's latest check-in in
  // the last fortnight (the same map the roster cards read). An aggregate, so
  // it compares no child with another.
  const wellnessScores = athletes
    .map((a) => overallWellnessScore(wellnessByAthlete.get(a.id) ?? null))
    .filter((n): n is number => n !== null)
  const wellnessAvg = wellnessScores.length
    ? Math.round((wellnessScores.reduce((a, b) => a + b, 0) / wellnessScores.length) * 10) / 10
    : null

  // The roster's one split. `status` comes from lib/athlete-status via the API;
  // INVITED is the honest default for a row we have no evidence about.
  const statusOf = (a: Athlete) => a.status ?? 'INVITED'
  const activeN = athletes.filter((a) => statusOf(a) === 'ACTIVE').length
  const pendingN = athletes.length - activeN

  /* The attention headline. Coach-only, like everything derived from
   * lib/attention.ts, and worded as a fact about sessions rather than a
   * verdict on the coach. It names nobody when nobody qualifies, and it says
   * nothing at all until the coverage read has landed — or if it failed —
   * because "nobody is quiet" is a claim, and the greeting is not. */
  const quietAthletes = coverageLoaded && !coverageFailed ? athletes.filter((a) => inactiveIds.has(a.id)) : []
  const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']
  const quietWord = NUMBER_WORDS[quietAthletes.length] ?? String(quietAthletes.length)
  const quietWeeks: number = QUIET_AFTER_DAYS / 7
  const quietSpan = Number.isInteger(quietWeeks)
    ? `${(NUMBER_WORDS[quietWeeks] ?? String(quietWeeks)).toLowerCase()} week${quietWeeks === 1 ? '' : 's'}`
    : `${QUIET_AFTER_DAYS} days`
  const quietNames = (() => {
    const names = quietAthletes.map((a) => a.first_name)
    return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  })()

  const ROLECAP: Record<Tab, string> = {
    home: 'Coach desk', athletes: 'Athletes', groups: 'Squads', sessions: 'Sessions',
    calendar: 'Calendar', messages: 'Messages', settings: 'Settings',
  }
  const tickerDate = new Date()
    .toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(/,/g, '')

  const openRecorder = (athleteId?: string, groupId?: string) => {
    setQuickSessionAthleteId(athleteId); setQuickSessionGroupId(groupId); setQuickSessionOpen(true)
  }
  const closeAddAthlete = () => { setShowAddAthlete(false); setAddMsg(''); setLastInvite(null) }

  /** Floating nav geometry, shared with the Messages panel's height so the two
   *  cannot drift apart: bar height + its offset from the bottom edge. */
  const NAV_H = 62
  const NAV_BOTTOM = 'max(12px, env(safe-area-inset-bottom))'
  const TOPBAR_H = 65 // 44px controls + 10px padding each side + the hairline

  /** One session, as a hairline row. The whole row opens the session. */
  const sessionRow = (s: Session, i: number, opts: { summary: boolean; meta: string | null }) => {
    const a = s.athletes
    const d = sessionDate(s)
    return (
      <Link key={s.id} href={`/sessions/${s.id}`} style={{
        display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) auto', gap: 13, alignItems: 'start',
        padding: '13px 0', borderTop: i === 0 ? HAIR_2 : HAIR, textDecoration: 'none', color: 'inherit',
      }}>
        <div aria-hidden>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 24, lineHeight: 0.9, letterSpacing: -1, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{d ? d.getDate() : '—'}</div>
          {d && <div style={{ ...cast(13, 700, '.14em'), color: 'var(--text-2)', marginTop: 4 }}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...cast(19, 700, '.04em'), lineHeight: 1.05, color: 'var(--text)', overflowWrap: 'anywhere' }}>{a ? `${a.first_name} ${a.last_name}` : 'Unknown'}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 400, fontSize: 'var(--t-body)', lineHeight: 1.4, color: 'var(--text-2)', marginTop: 5, overflowWrap: 'anywhere' }}>{s.session_name ?? 'Session'}</div>
          {opts.summary && s.summary && (
            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflowWrap: 'anywhere' }}>{s.summary}</div>
          )}
          {opts.meta && <div style={{ ...MONO, fontSize: 13, color: 'var(--text-2)', marginTop: 6 }}>{opts.meta}</div>}
        </div>
        <div style={{ marginTop: 1 }}>
          <Chip tone={s.shared_with_athlete ? 'shared' : 'amber'}>{s.shared_with_athlete ? 'Shared' : 'Draft'}</Chip>
        </div>
      </Link>
    )
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', position: 'relative' }}>
      <StadiumStyles />
      {/* The stage: a sage beam from the top corner and the 39px pitch grid.
          Fixed, static and behind everything — nothing large here moves or
          changes luminance, which the boot shell's flash-safety depends on. */}
      <div className="sn-stage" aria-hidden />

      {/* ════════ DESKTOP SIDEBAR ════════ */}
      {!isMobile && (
        <nav style={{
          width: 220, minWidth: 220,
          background: 'linear-gradient(180deg, var(--ink-base) 0%, var(--ink-mid) 100%)',
          borderRight: HAIR,
          display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', zIndex: 100,
        }}>
          <div style={{ padding: '22px 18px 18px' }}>
            <Brand rolecap="Coach desk" />
          </div>

          {/* Record — the one floodlit control on this rail. */}
          <div style={{ padding: '0 12px 12px' }}>
            <button
              onClick={() => openRecorder()}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                minHeight: 48, padding: '10px 12px', ...cast(16, 800, '.06em'),
                background: 'var(--flood)', color: 'var(--on-primary)', border: 'none', borderRadius: 14, cursor: 'pointer',
                transition: 'all 0.18s ease',
              }}
            >
              <Icon name="mic" size={16} strokeWidth={2.3} /> Record session
            </button>
          </div>

          <div style={{ flex: 1, padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
            {NAV_ITEMS.map(item => {
              const unread = item.key === 'messages' ? totalUnreadAll : 0
              const active = tab === item.key
              return (
                <button key={item.key} onClick={() => { if (item.key === 'messages') setMsgPreselectedId(null); setTab(item.key) }} aria-current={active ? 'page' : undefined} style={{
                  display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
                  padding: '8px 12px', borderRadius: 9, border: 'none', width: '100%',
                  background: active ? tint('var(--text)', 7) : 'transparent',
                  color: active ? 'var(--flood)' : 'var(--text-2)',
                  ...cast(15, 700, '.12em'),
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s',
                  borderLeft: `3px solid ${active ? 'var(--flood)' : 'transparent'}`,
                }}>
                  <Icon name={item.icon} size={17} />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {unread > 0 && (
                    <span style={{ background: 'var(--coach-on-light)', color: 'var(--on-primary)', borderRadius: 99, minWidth: 20, minHeight: 20, lineHeight: 1, ...cast(13, 800, '0'), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
                      {unread}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div style={{ padding: '14px', borderTop: HAIR }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Mono initials={coachInitials || '?'} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-3)', overflowWrap: 'anywhere', color: 'var(--text)' }}>{coachName}</div>
                {coachSport && <div style={{ fontSize: 'var(--fs-1)', color: 'var(--text-2)' }}>{coachSport}</div>}
              </div>
            </div>
            <button onClick={logout} style={{ width: '100%', minHeight: 44, fontSize: 'var(--fs-3)', padding: '8px', background: 'transparent', border: HAIR_2, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-2)', transition: 'all 0.12s' }}>
              <Icon name="signout" size={13} /> Sign Out
            </button>
          </div>
        </nav>
      )}

      {/* ════════ MAIN CONTENT ════════ */}
      {/* overflowX hidden: the scoreboard's beam is skewed out past its own
          cells on purpose, and must never become a sideways scroll. */}
      <main ref={mainRef} style={{
        flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative', zIndex: 1,
        maxHeight: isMobile ? '100dvh' : '100vh',
        paddingBottom: isMobile && tab !== 'messages' ? `calc(${NAV_H + 44}px + ${NAV_BOTTOM})` : 0,
      }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 100,
            background: tint('var(--bg)', 92),
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
            borderBottom: HAIR,
            padding: `10px ${GUTTER}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Brand rolecap={ROLECAP[tab]} />
            <span style={{ flex: 1 }} />
            <button onClick={() => { setMsgPreselectedId(null); setTab('messages') }} aria-label={totalUnreadAll > 0 ? `Messages, ${totalUnreadAll} unread` : 'Messages'} style={ICON_BTN}>
              <Icon name="messages" size={17} strokeWidth={1.8} />
              {totalUnreadAll > 0 && <span style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: 'var(--coach-on-light)', border: '1.5px solid var(--bg)' }} />}
            </button>
            {/* The coach's own monogram is the way into Settings, as on the
                approved screen; it still says so to a screen reader. */}
            <button onClick={() => setTab('settings')} aria-label="Settings" title={coachName ? `${coachName} · Settings` : 'Settings'} style={{
              width: 44, height: 44, borderRadius: 12, flex: 'none', border: 'none', cursor: 'pointer',
              background: 'var(--primary)', color: 'var(--on-primary)', ...cast(15, 800, '.06em'), lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}>
              {coachInitials || <Icon name="settings" size={17} strokeWidth={1.8} />}
            </button>
          </div>
        )}

        <div style={{ padding: tab === 'messages' ? 0 : isMobile ? `12px ${GUTTER} 0` : '28px' }}>

          {tab !== 'messages' && (
            <div style={{ marginBottom: 18 }}>
              <Ticker>
                <span>{tickerDate}</span>
                {coachName && <><TickSep /><span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{coachName}</span></>}
                {coachSport && <><TickSep /><span style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{coachSport}</span></>}
                <span style={{ flex: 1 }} />
                {totalUnreadAll > 0 && (
                  <span style={{ color: 'var(--coach-on-light)', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <i className="sn-livedot" aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--coach-on-light)' }} />
                    {totalUnreadAll} unread
                  </span>
                )}
              </Ticker>
            </div>
          )}

          {/* ════ HOME TAB ════ */}
          {tab === 'home' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: isMobile ? undefined : 760 }}>

              {/* Recordings still on this device. Renders nothing when the
                  queue is empty, which is almost always — and sits above
                  everything else when it is not, because an unsent recording
                  is more urgent than any summary of past ones. */}
              <PendingRecordings onSynced={() => { void refreshSessions(); void fetchCoverage() }} />

              {/* Attention headline, or the greeting when there is nothing to say. */}
              <section>
                {quietAthletes.length > 0 ? (
                  <>
                    <Eyebrow>Inactive</Eyebrow>
                    <h1 style={{ margin: '11px 0 0', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 30, lineHeight: 1.12, letterSpacing: -0.6, color: 'var(--text)' }}>
                      {quietWord} athlete{quietAthletes.length === 1 ? ' hasn’t' : 's haven’t'} had a session in{' '}
                      <em style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(transparent 68%, ${tint('var(--primary)', 26)} 68%)` }}>{quietSpan}</em>.
                    </h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
                      <div aria-hidden style={{ display: 'flex' }}>
                        {quietAthletes.slice(0, 3).map((a, i) => (
                          <div key={a.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                            <Mono initials={initialsOf(a.first_name, a.last_name)} pending={statusOf(a) === 'INVITED'} size={30} ring="var(--bg)" />
                          </div>
                        ))}
                      </div>
                      <p style={{ flex: '1 1 120px', minWidth: 0, margin: 0, fontSize: 'var(--fs-2)', color: 'var(--text-2)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{quietNames}</p>
                      <button onClick={() => { setAthleteFilter('INACTIVE'); setTab('athletes') }} style={{ minHeight: 44, background: 'none', border: 'none', padding: '0 0 0 6px', color: 'var(--primary)', fontWeight: 700, fontSize: 'var(--fs-2)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        Open <Icon name="arrow" size={13} />
                      </button>
                    </div>
                  </>
                ) : (
                  <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 30, lineHeight: 1.12, letterSpacing: -0.6, color: 'var(--text)' }}>
                    {greeting}, <em style={{ fontStyle: 'italic', fontWeight: 500 }}>{firstName || 'Coach'}.</em>
                  </h1>
                )}
              </section>

              {/* The scoreboard. One enormous number: sessions this week. */}
              <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1.32fr) minmax(0, 1fr)', gap: 9 }}>
                <div aria-hidden style={{
                  position: 'absolute', inset: '-10px 30px -10px -14px', zIndex: 0, pointerEvents: 'none',
                  background: `linear-gradient(100deg, ${tint('var(--text)', 5)}, transparent 58%)`,
                  transform: 'skewX(-11deg)', borderLeft: `1px solid ${tint('var(--primary)', 32)}`,
                }} />
                <button onClick={() => setTab('sessions')} aria-label={`${weekCountLabel} sessions this week. Open all sessions`} style={{
                  position: 'relative', zIndex: 1, background: PANEL, border: HAIR, borderRadius: 17, padding: '12px 13px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', overflow: 'hidden',
                  textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', minWidth: 0,
                }}>
                  <div style={{ marginTop: 2 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: hugeSize, lineHeight: 0.74, letterSpacing: -hugeSize * 0.06, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', margin: '2px 0 0 -4px', paddingTop: hugeSize * 0.06 }}>{weekCountLabel}</div>
                    <div style={{ ...cast(13, 700, '.2em'), color: 'var(--text-2)', marginTop: 10 }}>Sessions</div>
                    <div style={{ ...cast(13, 600, '.2em'), color: 'var(--text-2)', marginTop: 2 }}>This week</div>
                  </div>
                  {showSpark && (
                    <div style={{ width: '100%' }}>
                      <div aria-hidden style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28, marginTop: 10 }}>
                        {sparkWeeks.map((n, i) => {
                          const now = i === sparkWeeks.length - 1
                          return <i key={i} style={{ flex: 1, minWidth: 0, height: `${Math.max(7, (n / sparkMax) * 100)}%`, borderRadius: 1, background: now ? 'var(--flood)' : tint('var(--primary)', 55) }} />
                        })}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 8, marginTop: 8, ...cast(13, 700, '.14em'), color: 'var(--text-2)' }}>
                        <span>{sparkWeeks.length} weeks</span>
                        <span style={{ marginLeft: 'auto' }}>Avg {Math.round(sparkTotal / sparkWeeks.length)} / wk</span>
                      </div>
                    </div>
                  )}
                </button>
                <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
                  <button onClick={() => setTab('athletes')} style={{ background: PANEL, border: HAIR, borderRadius: 17, padding: '12px 13px', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit', minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, letterSpacing: -1.8, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{athletes.length}</div>
                    <div style={{ ...cast(13, 700, '.2em'), color: 'var(--text-2)', marginTop: 5 }}>Athletes</div>
                    {/* "active" counts athletes who have actually opened their
                        portal, matching the ACTIVE/PENDING split on the roster. */}
                    <div style={{ ...cast(13, 700, '.1em'), color: 'var(--primary)', marginTop: 4 }}>{athletes.length > 0 ? `${activeCount(athletes)} active` : 'None yet'}</div>
                  </button>
                  <div style={{ background: PANEL, border: HAIR, borderRadius: 17, padding: '12px 13px', minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 40, lineHeight: 1, letterSpacing: -1.8, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                      {wellnessAvg ?? '—'}<span style={{ fontSize: 15, letterSpacing: 0, color: 'var(--text-2)', marginLeft: 2 }}>/5</span>
                    </div>
                    <div style={{ ...cast(13, 700, '.2em'), color: 'var(--text-2)', marginTop: 5 }}>Wellness</div>
                    {wellnessAvg !== null && (
                      <div aria-hidden style={{ display: 'flex', gap: 3, marginTop: 8 }}>
                        {[1, 2, 3, 4, 5].map((n) => <i key={n} style={{ height: 4, flex: 1, borderRadius: 2, background: n <= Math.round(wellnessAvg) ? 'var(--primary)' : tint('var(--text)', 14) }} />)}
                      </div>
                    )}
                    <div style={{ ...cast(13, 600, '.1em'), color: 'var(--text-2)', marginTop: 7 }}>{wellnessScores.length} checked in · 14d</div>
                  </div>
                </div>
              </div>

              {/* Record — the floodlight is spent here. */}
              <button onClick={() => openRecorder()} style={{
                position: 'relative', minHeight: 64, borderRadius: 18, overflow: 'hidden', background: 'var(--flood)',
                border: 'none', display: 'flex', alignItems: 'stretch', cursor: 'pointer', padding: 0, width: '100%', textAlign: 'left',
              }}>
                <span style={{ flex: '1 1 auto', minWidth: 0, padding: '12px 8px 12px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ display: 'block', ...cast(20, 800, '.045em'), lineHeight: 1, color: 'var(--on-primary)' }}>Record a session</span>
                  <span style={{ display: 'block', ...MONO, fontSize: 13, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--on-primary)', marginTop: 6 }}>Tap to start</span>
                </span>
                <span aria-hidden style={{
                  flex: 'none', width: 112, background: INK_DEEP, clipPath: 'polygon(30% 0, 100% 0, 100% 100%, 0 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9, paddingRight: 15,
                }}>
                  <span className="sn-vu" style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 26 }}>
                    {[0, 1, 2, 3, 4, 5, 6].map((i) => <i key={i} style={{ width: 2.5, height: 22, borderRadius: 2, background: 'var(--flood)', opacity: 0.85, animationDelay: `${i * 0.12}s` }} />)}
                  </span>
                  <span style={{ width: 36, height: 36, borderRadius: '50%', flex: 'none', border: '2px solid var(--flood)', color: 'var(--flood)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: tint('var(--flood)', 10) }}>
                    <Icon name="mic" size={17} strokeWidth={2.2} />
                  </span>
                </span>
              </button>

              {/* Invite code banner */}
              {!inviteCode && (
                <div style={{ background: PANEL_2, border: HAIR_2, borderRadius: 20, padding: '14px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ ...cast(17, 700, '.06em'), color: 'var(--text)' }}>Set your invite code</div>
                    <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginTop: 4 }}>Athletes need your code to join your roster.</div>
                  </div>
                  <button className="btn btn-primary" onClick={() => setTab('settings')} style={{ flexShrink: 0, minHeight: 44 }}>
                    Settings
                  </button>
                </div>
              )}

              {/* Latest sessions */}
              <section>
                <SecHead title="Latest" action={{ label: 'All', onClick: () => setTab('sessions') }} />
                <div style={{ marginTop: 6 }}>
                  {loadingSessions && recentSessions.length === 0 ? (
                    <div style={{ color: 'var(--text-2)', textAlign: 'center', padding: 20, fontSize: 'var(--fs-3)', borderTop: HAIR_2 }}>Loading…</div>
                  ) : sessionsError && recentSessions.length === 0 ? (
                    <ListState loading={false} error={sessionsError} isEmpty={false} emptyTitle="" onRetry={() => fetchAllSessions()} />
                  ) : recentSessions.length === 0 ? (
                    <div style={{ borderTop: HAIR_2, padding: '22px 0 4px', textAlign: 'center' }}>
                      <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-3)', marginBottom: 12 }}>No sessions yet.</div>
                      <button className="btn btn-primary" onClick={() => openRecorder()} style={{ gap: 6, minHeight: 44 }}>
                        <Icon name="mic" size={15} /> Record your first session
                      </button>
                    </div>
                  ) : (
                    <div>
                      {recentSessions.map((s, i) => {
                        const ago = (() => {
                          // A session recorded today keeps the precise "3h";
                          // a backdated one counts whole days from the day it
                          // happened, not the minute it was typed up.
                          const happened = sessionDate(s)
                          const sameDay = sessionISODate(s) === todayISODate()
                          const from = happened && !sameDay ? happened : new Date(s.created_at)
                          const diff = Date.now() - from.getTime()
                          const h = Math.floor(diff / 3600000)
                          if (h < 1) return 'just now'
                          if (h < 24) return `${h}h`
                          const d = Math.floor(h / 24)
                          return d === 1 ? 'Yesterday' : `${d}d`
                        })()
                        // Opens the session, not its athlete.
                        return sessionRow(s, i, { summary: false, meta: ago })
                      })}
                    </div>
                  )}
                </div>
              </section>

              {/* Today's sessions — time-based list */}
              {todayEvents.length > 0 && (
                <section>
                  <SecHead title="Today" side={`${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''}`} />
                  <div style={{ marginTop: 8 }}>
                    {todayEvents.map((ev, i) => {
                      const m = ev.event_time?.match(/^(\d+):(\d+)/)
                      const hrs = m ? parseInt(m[1]) : null
                      const mins = m ? m[2] : null
                      const ampm = hrs !== null ? (hrs >= 12 ? 'pm' : 'am') : null
                      const dh = hrs !== null ? (hrs > 12 ? hrs - 12 : hrs === 0 ? 12 : hrs) : null
                      return (
                        <Link key={ev.id} href={ev.athlete_id ? `/athletes/${ev.athlete_id}` : '#'} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) auto', alignItems: 'center', gap: 12, minHeight: 44, padding: '11px 0', borderTop: i === 0 ? HAIR_2 : HAIR, textDecoration: 'none', color: 'inherit', cursor: ev.athlete_id ? 'pointer' : 'default' }}>
                          <div>
                            {dh !== null ? (
                              <>
                                <div style={{ ...MONO, fontSize: 15, color: 'var(--text)', lineHeight: 1 }}>{dh}:{mins}</div>
                                <div style={{ ...cast(13, 700, '.14em'), color: 'var(--text-2)', marginTop: 3 }}>{ampm}</div>
                              </>
                            ) : <div style={{ ...MONO, fontSize: 15, color: 'var(--text-2)' }}>—</div>}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ ...cast(17, 700, '.04em'), color: 'var(--text)', overflowWrap: 'anywhere' }}>{ev.title}</div>
                            {ev.event_type && <div style={{ ...cast(13, 600, '.14em'), color: 'var(--text-2)', marginTop: 3 }}>{ev.event_type}</div>}
                          </div>
                          <span style={{ color: 'var(--text-2)' }}><Icon name="arrow" size={14} strokeWidth={1.8} /></span>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              )}

              {/* Day wheel — scrolls back through what you've done and
                  forward through what's booked, with a Today control. */}
              <div>
                {homeEventsError && (
                  <div role="alert" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8, padding: '6px 6px 6px 12px', borderRadius: 8, background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--fs-2)', fontWeight: 600 }}>
                    <span style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{homeEventsError} Events below may be missing or out of date.</span>
                    <button onClick={() => void refreshHomeEvents()} className="btn btn-ghost" style={{ minHeight: 44, padding: '0 14px' }}>Retry</button>
                  </div>
                )}
                <DayWheel
                  events={homeWeekEvents as WheelEvent[]}
                  selectedDay={homeSelectedDay}
                  onSelectDay={setHomeSelectedDay}
                  headerAction={
                    <button onClick={() => setTab('calendar')} style={{ ...cast(13, 700, '.12em'), color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0, minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      Calendar <Icon name="arrow" size={13} />
                    </button>
                  }
                />
              </div>

              {/* Your athletes. A wrapping grid rather than the sideways strip
                  it was: nothing on this page scrolls horizontally. */}
              {athletes.length > 0 && (
                <section>
                  <SecHead title="Athletes" action={{ label: 'Roster', onClick: () => setTab('athletes') }} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))', gap: 9, marginTop: 6 }}>
                    {athletes.map((a) => {
                      const status = statusOf(a)
                      const unread = (unreadCounts[a.id] ?? 0) as number
                      const wellnessScore = overallWellnessScore(wellnessByAthlete.get(a.id) ?? null)
                      const wellnessColor = overallScoreColor(wellnessScore)
                      return (
                        /* A real <button>, so it is keyboard reachable and
                         * announced as a control. A coach tapping their own
                         * athlete gets their profile. */
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => router.push(`/athletes/${a.id}`)}
                          aria-label={`Open ${a.first_name} ${a.last_name ?? ''}`.trim() + (unread > 0 ? `, ${unread} unread` : '')}
                          style={{ minWidth: 0, background: PANEL, borderRadius: 14, border: HAIR, padding: '12px 6px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, position: 'relative', cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'center' }}>
                          {unread > 0 && <div style={{ position: 'absolute', top: 5, right: 5, minWidth: 20, minHeight: 20, lineHeight: 1, borderRadius: 99, background: 'var(--coach-on-light)', color: 'var(--on-primary)', ...cast(13, 800, '0'), padding: '0 5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</div>}
                          <Mono initials={initialsOf(a.first_name, a.last_name)} pending={status === 'INVITED'} size={40} />
                          <div style={{ ...cast(15, 700, '.04em'), color: 'var(--text)', overflowWrap: 'anywhere', maxWidth: '100%' }}>{a.first_name}{a.last_name ? ` ${a.last_name.trim()[0]}.` : ''}</div>
                          {wellnessScore !== null ? (
                            <div title={`Wellness ${wellnessScore}/5`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: wellnessColor, flexShrink: 0 }} />
                              <span style={{ ...MONO, fontSize: 13, fontWeight: 700, color: wellnessColor }}>{wellnessScore}</span>
                            </div>
                          ) : (
                            <div style={{ ...cast(13, 700, '.12em'), color: status === 'INVITED' ? 'var(--energy-dark)' : 'var(--text-2)' }}>{status === 'INVITED' ? 'Pending' : 'Active'}</div>
                          )}
                        </button>
                      )
                    })}
                    <button onClick={() => { setTab('athletes'); setShowAddAthlete(true) }} style={{ minWidth: 0, background: 'transparent', borderRadius: 14, border: '1px dashed var(--border)', padding: '12px 6px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--text-2)', cursor: 'pointer', font: 'inherit' }}>
                      <div style={{ width: 40, height: 40, borderRadius: '50%', border: '1px dashed var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="plus" size={18} />
                      </div>
                      <div style={{ ...cast(13, 700, '.12em') }}>Invite</div>
                    </button>
                  </div>
                </section>
              )}

              {/* Onboarding flow (empty state) */}
              {athletes.length === 0 && !loadingAthletes && (() => {
                const completedCount = onboardStep.code ? 1 : 0
                const stepNum = (done: boolean, n: number) => (
                  <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', ...cast(15, 800, '0'), lineHeight: 1, ...(done ? { background: 'var(--primary)', color: 'var(--on-primary)' } : { border: HAIR_2, color: 'var(--text-2)' }) }}>
                    {done ? '✓' : n}
                  </div>
                )
                const stepRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 0', borderTop: HAIR }
                return (
                  <section style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ marginBottom: 12 }}>
                      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 28, letterSpacing: -0.6, fontStyle: 'italic', color: 'var(--text)' }}>
                        You&apos;re all set up.
                      </h2>
                      <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-3)', color: 'var(--text-2)' }}>
                        Complete these steps to get started with your first athlete.
                      </p>
                      <div style={{ ...cast(13, 700, '.16em'), color: completedCount > 0 ? 'var(--primary)' : 'var(--text-2)', marginTop: 8 }}>
                        {completedCount} of 3 complete
                      </div>
                    </div>

                    {/* Step 1 — Set invite code */}
                    <div style={{ ...stepRow, borderTop: HAIR_2 }}>
                      {stepNum(onboardStep.code, 1)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...cast(17, 700, '.04em'), color: 'var(--text)', marginBottom: 4 }}>Set your invite code</div>
                        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginBottom: 10 }}>Athletes enter this code when signing up to join your roster automatically.</div>
                        {onboardStep.code ? (
                          <div style={{ ...MONO, fontWeight: 700, fontSize: 'var(--fs-4)', letterSpacing: '.1em', color: 'var(--text)', background: PANEL_2, border: HAIR_2, borderRadius: 10, padding: '8px 12px', display: 'inline-block', maxWidth: '100%', overflowWrap: 'anywhere' }}>{inviteCode}</div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input
                              className="input"
                              value={codeDraft}
                              onChange={e => setCodeDraft(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                              placeholder="coachsmith4821"
                              aria-label="Invite code"
                              style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, flex: '1 1 140px', minWidth: 0, maxWidth: 220, minHeight: 44 }}
                            />
                            <button className="btn btn-primary" onClick={saveCode} disabled={codeSaving || !codeDraft.trim()} style={{ minHeight: 44 }}>
                              {codeSaving ? '…' : 'Save'}
                            </button>
                          </div>
                        )}
                        {codeMsg && <div style={{ fontSize: 'var(--fs-2)', color: codeMsg.includes('updated') || codeMsg.includes('Copied') ? 'var(--success)' : 'var(--danger)', marginTop: 6, fontWeight: 600 }}>{codeMsg}</div>}
                      </div>
                    </div>

                    {/* Step 2 — Add first athlete */}
                    <div style={stepRow}>
                      {stepNum(false, 2)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...cast(17, 700, '.04em'), color: 'var(--text)', marginBottom: 4 }}>Add your first athlete</div>
                        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginBottom: 10 }}>Invite them by email — they&apos;ll get a link to set up their account.</div>
                        <button className="btn btn-primary" onClick={() => setShowAddAthlete(true)} style={{ gap: 6, minHeight: 44 }}>
                          <Icon name="plus" size={14} /> Add Athlete →
                        </button>
                      </div>
                    </div>

                    {/* Step 3 — Record first session */}
                    <div style={stepRow}>
                      {stepNum(false, 3)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...cast(17, 700, '.04em'), color: 'var(--text)', marginBottom: 4 }}>Record your first session</div>
                        <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', marginBottom: 10 }}>After a training session, hit record and speak your notes. AI transcribes and summarises.</div>
                        <button className="btn btn-primary" onClick={() => openRecorder()} style={{ gap: 6, minHeight: 44 }}>
                          <Icon name="mic" size={14} /> Record Session →
                        </button>
                      </div>
                    </div>

                    {/* Share card — only if invite code is set */}
                    {inviteCode && (
                      <div style={{ position: 'relative', marginTop: 8, background: PANEL_2, border: HAIR_2, borderRadius: 20, padding: '13px 15px', overflow: 'hidden' }}>
                        <div style={{ ...cast(13, 700, '.2em'), color: 'var(--text-2)', marginBottom: 10 }}>Share this with your athletes</div>
                        <div style={{ ...MONO, fontSize: 26, fontWeight: 700, letterSpacing: '.14em', lineHeight: 1.1, marginBottom: 12, color: 'var(--text)', overflowWrap: 'anywhere' }}>{inviteCode}</div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => { navigator.clipboard.writeText(inviteCode); setCodeMsg('Copied!'); setTimeout(() => setCodeMsg(''), 2000) }}
                            style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: HAIR_2, background: tint('var(--text)', 4), color: 'var(--text-2)', ...cast(13, 700, '.16em'), display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
                          >
                            <Icon name="copy" size={14} /> Copy code
                          </button>
                          <span style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)' }}>Or go to Athletes tab to invite by email</span>
                        </div>
                      </div>
                    )}
                  </section>
                )
              })()}

            </div>
          )}

          {/* ════ ATHLETES TAB — the roster ════ */}
          {tab === 'athletes' && (() => {
            const activeList = filteredAthletes.filter((a) => statusOf(a) === 'ACTIVE')
            const pendingList = filteredAthletes.filter((a) => statusOf(a) !== 'ACTIVE')
            const FILTERS: { key: typeof athleteFilter; label: string; count: number | null }[] = [
              { key: 'all', label: 'All', count: athletes.length },
              { key: 'ACTIVE', label: 'Active', count: activeN },
              // PENDING is the word the roster uses for INVITED everywhere a
              // coach reads it: invited, not yet arrived — waiting, not broken.
              { key: 'INVITED', label: 'Pending', count: pendingN },
              // Only once it is known. Before the coverage read lands, or if it
              // failed, a count would state something we do not know.
              { key: 'INACTIVE', label: 'Inactive', count: coverageLoaded && !coverageFailed ? inactiveIds.size : null },
            ]
            const rows = (list: Athlete[], pending: boolean) => (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(340px, 1fr))', columnGap: 32, marginTop: 6 }}>
                {list.map((a, i) => {
                  // Uncapped counts. Falls back to the truncated client list
                  // only while coverage is still loading, so the first paint
                  // is never blank.
                  const cov = coverageByAthlete.get(a.id)
                  const lastDate = cov
                    ? cov.last_session_date
                    : homeSessions.find(s => s.athlete_id === a.id)?.session_date ?? null
                  const count = cov
                    ? cov.session_count
                    : homeSessions.filter(s => s.athlete_id === a.id).length
                  const quiet = !!cov && isQuiet(cov)
                  const unread = unreadCounts[a.id] ?? 0
                  const name = `${a.first_name} ${a.last_name}`
                  const invited = a.invited_at ? new Date(a.invited_at) : null
                  return (
                    <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) auto', columnGap: 12, rowGap: 10, alignItems: 'center', padding: '12px 0', borderTop: i === 0 ? HAIR_2 : HAIR }}>
                      <Link href={`/athletes/${a.id}`} tabIndex={-1} aria-hidden style={{ display: 'flex', textDecoration: 'none' }}>
                        <Mono initials={initialsOf(a.first_name, a.last_name)} pending={pending} />
                      </Link>
                      <div style={{ minWidth: 0 }}>
                        <div>
                          <Link href={`/athletes/${a.id}`} style={{ ...cast(18, 700, '.04em'), lineHeight: 1.1, color: 'var(--text)', textDecoration: 'none', overflowWrap: 'anywhere' }}>{name}</Link>
                          {unread > 0 && <span role="img" aria-label={`${unread} unread`} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--coach-on-light)', display: 'inline-block', marginLeft: 8, verticalAlign: 2 }} />}
                        </div>
                        <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', overflowWrap: 'anywhere', marginTop: 4 }}><BreakableEmail email={a.email} /></div>
                        {pending && (
                          <div style={{ ...cast(13, 600, '.1em'), color: 'var(--text-2)', marginTop: 4, lineHeight: 1.35 }}>
                            {invited && <>Invited <span style={{ ...MONO, textTransform: 'none' }}>{invited.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> · </>}Waiting to arrive
                          </div>
                        )}
                        <div style={{ ...cast(13, 600, '.1em'), color: 'var(--text-2)', marginTop: 4, lineHeight: 1.35 }}>
                          {lastDate
                            ? <>Last session <span style={{ ...MONO, textTransform: 'none' }}>{formatSessionDate({ session_date: lastDate }, { day: 'numeric', month: 'short' })}</span></>
                            : 'No sessions yet'}
                          {count > 0 && ` · ${count} session${count === 1 ? '' : 's'}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 42, textAlign: 'right' }}>
                        {pending && <Chip tone="amber">Pending</Chip>}
                        {/* Days since the last session, and QUIET past the
                            lib/attention.ts threshold. Coach-only, as the
                            Inactive filter is: this screen is the coach's
                            dashboard and nothing here reaches an athlete. */}
                        {cov && (cov.days_since !== null || quiet) && (
                          <div aria-label={quiet ? `Quiet · ${gapLabel(cov)}` : `${gapLabel(cov)} since the last session`}>
                            {cov.days_since !== null && <div aria-hidden style={{ ...MONO, fontSize: 15, lineHeight: 1, color: quiet ? 'var(--coach-on-light)' : 'var(--text-2)' }}>{cov.days_since}d</div>}
                            {quiet && <div aria-hidden style={{ ...cast(13, 700, '.16em'), color: 'var(--coach-on-light)', marginTop: 4 }}>Quiet</div>}
                          </div>
                        )}
                      </div>
                      <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => openRecorder(a.id)} style={{ ...ICON_BTN, color: 'var(--primary)', borderColor: tint('var(--primary)', 45), background: tint('var(--primary)', 9) }} title="Record session" aria-label={`Record a session for ${name}`}>
                          <Icon name="mic" size={16} />
                        </button>
                        <button onClick={() => { setMsgPreselectedId(a.id); setTab('messages') }} style={ICON_BTN} title="Message" aria-label={`Message ${name}${unread > 0 ? `, ${unread} unread` : ''}`}>
                          <Icon name="messages" size={16} />
                          {unread > 0 && <span style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, background: 'var(--coach-on-light)', borderRadius: '50%' }} />}
                        </button>
                        <button onClick={() => { setTab('calendar'); showCalendarFor('athlete', a.id) }} style={ICON_BTN} title="Calendar" aria-label={`${a.first_name}'s calendar`}>
                          <Icon name="calendar" size={16} />
                        </button>
                        <button onClick={() => { setDeleteError(null); setDeleteConfirmAthlete(a) }} style={{ ...ICON_BTN, color: 'var(--danger)', borderColor: tint('var(--danger)', 35) }} title="Remove athlete" aria-label={`Remove ${name}`}>
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <PeopleSwitch tab={tab} setTab={setTab} />

                {/* The roll call — deliberately not a score. */}
                <section>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <Eyebrow>Every athlete</Eyebrow>
                    <button className="btn btn-primary" onClick={() => setShowAddAthlete(true)} style={{ gap: 6, marginLeft: 'auto', minHeight: 44 }}>
                      <Icon name="plus" size={14} /> Add Athlete
                    </button>
                  </div>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12, rowGap: 6, marginTop: 10, paddingBottom: 9 }}>
                    <div aria-hidden style={{ position: 'absolute', inset: '-9px 30px 0 -14px', zIndex: 0, pointerEvents: 'none', background: `linear-gradient(100deg, ${tint('var(--text)', 5)}, transparent 58%)`, transform: 'skewX(-11deg)', borderLeft: `1px solid ${tint('var(--primary)', 32)}` }} />
                    {([[activeN, 'Active', 'var(--text)'], [pendingN, 'Pending', 'var(--text)'], [athletes.length, 'Total', 'var(--text-2)']] as const).map(([n, label, color], i) => (
                      <div key={label} style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'baseline', gap: 7, marginLeft: i === 2 ? 'auto' : 0, paddingLeft: i === 1 ? 12 : 0, borderLeft: i === 1 ? HAIR_2 : 'none' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 31, lineHeight: 1, letterSpacing: -1.4, color, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                        <span style={{ ...cast(13, 700, '.2em'), color: 'var(--text-2)' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Search + filters */}
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, maxWidth: isMobile ? 'none' : 360 }}>
                      <span aria-hidden style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-2)', display: 'flex' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
                      </span>
                      <input className="input" placeholder="Search…" aria-label="Search athletes" type="search" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={athleteSearch} onChange={e => setAthleteSearch(e.target.value)} style={{ minWidth: 0, minHeight: 44, paddingLeft: 36, borderRadius: 12, border: HAIR_2, background: tint('var(--text)', 4) }} />
                    </div>
                    <button onClick={fetchAthletes} disabled={loadingAthletes} style={{ ...ICON_BTN, opacity: loadingAthletes ? 0.5 : 1 }} title="Refresh" aria-label="Refresh the roster">
                      <Icon name="refresh" size={15} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {FILTERS.map(({ key, label, count }) => {
                      const on = athleteFilter === key
                      return (
                        <button key={key} onClick={() => setAthleteFilter(key)} aria-pressed={on} style={{
                          minHeight: 44, padding: '0 13px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
                          border: '1px solid', borderColor: on ? tint('var(--text)', 40) : 'var(--border-soft)',
                          background: on ? tint('var(--text)', 10) : 'transparent',
                          color: on ? 'var(--text)' : 'var(--text-2)', ...cast(13, 700, '.14em'),
                        }}>
                          {label}{count !== null && ` ${count}`}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {athletesError ? (
                  /* The roster could not be read. Saying "No athletes yet. Add
                     one to get started." here tells a coach with thirty athletes
                     that their roster is empty AND gives them an action premised
                     on it. Highest-priority branch for that reason. */
                  <ListState
                    loading={false}
                    error={athletesError}
                    isEmpty={false}
                    emptyTitle=""
                    onRetry={fetchAthletes}
                  />
                ) : filteredAthletes.length === 0 ? (
                  <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--text-2)', fontSize: 'var(--fs-3)', borderTop: HAIR_2 }}>
                    {athletes.length === 0
                      ? loadingAthletes ? 'Loading…' : 'No athletes yet. Add one to get started.'
                      : athleteFilter === 'INACTIVE' && !athleteSearch
                        // An empty Inactive list is the answer, not a dead end —
                        // but only once we know it. Until the coverage read
                        // lands the list is empty for want of data, and saying
                        // nobody is overdue would be asserting the opposite of
                        // the truth.
                        ? coverageFailed
                          // A read that failed is not a roster that is fine.
                          ? 'Could not work out who has been quiet. Refresh to try again.'
                          : coverageLoaded
                            ? `Nobody has gone more than ${QUIET_AFTER_DAYS} days without a recording.`
                            : 'Working out who has been quiet…'
                        : athleteFilter === 'INACTIVE'
                          ? 'Nobody inactive matches your search.'
                          : 'No athletes match your search.'}
                  </div>
                ) : (
                  <>
                    {/* ACTIVE and PENDING are two sections under their own
                        rules, not a badge repeated on every row. */}
                    {activeList.length > 0 && (
                      <section>
                        <SecHead title={`Active · ${activeList.length}`} />
                        {rows(activeList, false)}
                      </section>
                    )}
                    {pendingList.length > 0 && (
                      <section>
                        <SecHead title={`Pending · ${pendingList.length}`} side="Invited, not yet arrived" />
                        {rows(pendingList, true)}
                      </section>
                    )}
                  </>
                )}
              </div>
            )
          })()}

          {/* ════ GROUPS TAB ════ */}
          {tab === 'groups' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <PeopleSwitch tab={tab} setTab={setTab} />
              <TabTitle title="Squads" sub="Record one session for a whole squad at once" />
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  {loadingGroups || groupsError || groups.length === 0 ? (
                    <ListState
                      loading={loadingGroups}
                      error={groupsError}
                      isEmpty={groups.length === 0}
                      emptyTitle="No squads yet."
                      emptyHint="Create one to record a single session for a whole squad at once."
                      onRetry={fetchGroups}
                    />
                  ) : groups.map(g => {
                    const isExp = expandedGroup === g.id
                    const members = athletes.filter(a => g.member_ids.includes(a.id))
                    const nonMembers = athletes.filter(a => !g.member_ids.includes(a.id))
                    return (
                      <div key={g.id} style={{ overflow: 'hidden', background: PANEL, border: HAIR, borderRadius: 17 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 15px', flexWrap: 'wrap' }}>
                          {/* A squad's colour is data the coach chose, and some
                              of the stored swatches sit close to the ink. The
                              cream ring keeps every one of them visible; the
                              name, never the colour, is what identifies it. */}
                          <div style={{ width: 14, height: 14, borderRadius: '50%', background: g.color, flexShrink: 0, boxShadow: '0 0 0 1.5px var(--text-muted)' }} />
                          {/* A 160px basis, not `flex: 1`: it is what decides whether the
                              controls below fit on this line or wrap to their own. With a
                              bare `flex: 1` they always fit, and the squad name is left
                              wrapping one letter per line on a phone. */}
                          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                            <div style={{ ...cast(19, 700, '.04em'), color: 'var(--text)', overflowWrap: 'anywhere' }}>{g.name}</div>
                            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', overflowWrap: 'anywhere', marginTop: 3 }}>{g.member_count} athlete{g.member_count !== 1 ? 's' : ''}{g.description ? ` · ${g.description}` : ''}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                            <button onClick={() => openRecorder(undefined, g.id)} className="btn btn-primary" style={{ fontSize: 'var(--fs-2)', padding: '0 14px', minHeight: 44, gap: 5 }}>
                              <Icon name="mic" size={14} /> Record
                            </button>
                            <button onClick={() => { setTab('calendar'); showCalendarFor('group', g.id) }} style={ICON_BTN} title="Group calendar" aria-label={`${g.name} calendar`}>
                              <Icon name="calendar" size={15} />
                            </button>
                            <button onClick={() => setExpandedGroup(isExp ? null : g.id)} style={ICON_BTN} aria-expanded={isExp} aria-label={isExp ? `Hide ${g.name} members` : `Show ${g.name} members`}>
                              {isExp ? '▲' : '▼'}
                            </button>
                            <button onClick={() => deleteGroup(g.id)} style={{ ...ICON_BTN, color: 'var(--danger)', borderColor: tint('var(--danger)', 35) }} title="Delete squad" aria-label={`Delete ${g.name}`}>
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        </div>
                        {isExp && (
                          <div style={{ borderTop: HAIR, padding: '12px 15px 14px', background: tint('var(--bg)', 60) }}>
                            <SecHead title="Members" />
                            {members.length === 0
                              ? <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', margin: '6px 0 10px' }}>No members yet.</div>
                              : (
                                <div style={{ margin: '6px 0 12px' }}>
                                  {members.map((a, i) => (
                                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, borderTop: i === 0 ? HAIR_2 : HAIR }}>
                                      <span style={{ fontSize: 'var(--fs-3)', minWidth: 0, overflowWrap: 'anywhere', color: 'var(--text)' }}>{a.first_name} {a.last_name}</span>
                                      <button onClick={() => removeMemberFromGroup(g.id, a.id)} aria-label={`Remove ${a.first_name} ${a.last_name} from ${g.name}`} style={{ width: 44, height: 44, background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 20, lineHeight: 1, flexShrink: 0 }}>×</button>
                                    </div>
                                  ))}
                                </div>
                              )
                            }
                            {nonMembers.length > 0
                              ? <SquadAdder squadName={g.name} candidates={nonMembers} onAdd={(ids) => addMembersToGroup(g, ids)} />
                              : athletes.length > 0 && <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)' }}>Everyone on your roster is in this squad.</div>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="card" style={{ padding: 20 }}>
                  <SecHead title="Create squad" />
                  <div className="section-sub" style={{ marginBottom: 16, color: 'var(--text-2)' }}>Record one session for all members at once.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label className="label" htmlFor="new-squad-name">Name *</label>
                      <input id="new-squad-name" className="input" placeholder="Sprint Squad, U18 Boys…" value={newGroupForm.name} onChange={e => setNewGroupForm(f => ({ ...f, name: e.target.value }))} style={{ minHeight: 44 }} />
                    </div>
                    <div>
                      <label className="label">Colour</label>
                      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        {GROUP_COLORS.map((c, i) => {
                          const on = newGroupForm.color === c
                          return (
                            <button key={c} onClick={() => setNewGroupForm(f => ({ ...f, color: c }))} aria-label={`Colour ${i + 1}`} aria-pressed={on} style={{ width: 44, height: 44, padding: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ width: 28, height: 28, borderRadius: '50%', background: c, boxShadow: on ? '0 0 0 3px var(--text)' : '0 0 0 1.5px var(--text-muted)' }} />
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor="new-squad-desc">Description (optional)</label>
                      <input id="new-squad-desc" className="input" placeholder="Tue/Thu sprint group…" value={newGroupForm.description} onChange={e => setNewGroupForm(f => ({ ...f, description: e.target.value }))} style={{ minHeight: 44 }} />
                    </div>
                    {groupMsg && <p style={{ fontSize: 'var(--fs-3)', color: 'var(--danger)', fontWeight: 600, margin: 0 }}>{groupMsg}</p>}
                    <button className="btn btn-primary btn-lg" onClick={createGroup} disabled={groupSaving || !newGroupForm.name.trim()}>
                      {groupSaving ? 'Creating…' : 'Create Group'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ════ SESSIONS TAB ════ */}
          {tab === 'sessions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
                {/* "50 newest", not "50 sessions", while the route says there may be
                    more: a coach with 180 sessions was told they had 50. */}
                <TabTitle
                  title="All sessions"
                  sub={sessionsHasMore
                    ? `${allSessions.length} newest${sessionsQuery.search || sessionsQuery.athleteId ? ' matching' : ''} · older below`
                    : `${allSessions.length} session${allSessions.length !== 1 ? 's' : ''}`}
                />
                <button className="btn btn-primary" onClick={() => openRecorder()} style={{ gap: 6, minHeight: 44 }}>
                  <Icon name="mic" size={15} /> Record Session
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="input" placeholder="Search sessions…" aria-label="Search sessions" value={sessionsSearch} onChange={e => setSessionsSearch(e.target.value)} style={{ flex: '1 1 180px', minWidth: 0, maxWidth: isMobile ? 'none' : 260, minHeight: 44 }} onKeyDown={e => e.key === 'Enter' && fetchAllSessions(sessionsSearch, sessionsAthleteFilter)} />
                <select className="input" aria-label="Filter by athlete" value={sessionsAthleteFilter} onChange={e => { setSessionsAthleteFilter(e.target.value); fetchAllSessions(sessionsSearch, e.target.value) }} style={{ flex: '1 1 160px', minWidth: 0, maxWidth: isMobile ? 'none' : 200, minHeight: 44 }}>
                  <option value="">All athletes</option>
                  {athletes.map(a => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
                </select>
                <button className="btn btn-primary" onClick={() => fetchAllSessions(sessionsSearch, sessionsAthleteFilter)} style={{ padding: '0 16px', minHeight: 44 }}>Search</button>
                {(sessionsSearch || sessionsAthleteFilter) && <button className="btn btn-ghost" onClick={() => { setSessionsSearch(''); setSessionsAthleteFilter(''); fetchAllSessions('','') }} style={{ padding: '0 14px', minHeight: 44 }}>Clear</button>}
              </div>
              {loadingSessions || sessionsError || allSessions.length === 0
                ? <ListState
                    loading={loadingSessions}
                    error={sessionsError}
                    isEmpty={allSessions.length === 0}
                    emptyTitle={sessionsSearch || sessionsAthleteFilter ? 'No sessions match that search.' : 'No sessions yet.'}
                    emptyHint={sessionsSearch || sessionsAthleteFilter ? 'Try a different name or clear the filters.' : 'Record one and it will appear here.'}
                    onRetry={() => fetchAllSessions(sessionsSearch, sessionsAthleteFilter)}
                  />
                : (
                    // The whole row is the link — tapping a session opens that
                    // session, not its athlete.
                    <div>
                      {allSessions.map((s, i) => sessionRow(s, i, {
                        summary: true,
                        meta: formatSessionDate(s, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }),
                      }))}
                      {olderError && (
                        <div role="alert" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--fs-2)', fontWeight: 600, overflowWrap: 'anywhere' }}>
                          {olderError}
                        </div>
                      )}
                      {sessionsHasMore && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => void loadOlderSessions()}
                          disabled={loadingOlder}
                          aria-busy={loadingOlder}
                          style={{ marginTop: 12, width: '100%', minHeight: 44 }}
                        >
                          {loadingOlder ? 'Loading…' : olderError ? 'Try again' : 'Load older'}
                        </button>
                      )}
                    </div>
                  )
              }
            </div>
          )}

          {/* ════ CALENDAR TAB ════ */}
          {tab === 'calendar' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <TabTitle title="Calendar" />
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '220px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
                {/* On a phone the sidebar stacked every athlete as a 44px row
                    ABOVE the calendar — about a thousand pixels at twenty
                    athletes — so the calendar a coach had just chosen was a
                    long scroll below the list they chose it from. One line
                    says whose calendar this is; the full choice opens on
                    demand, with search and squad filtering from AthletePicker. */}
                {isMobile ? (
                  <div className="card" style={{ padding: 10, minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => setCalPickerOpen(o => !o)}
                      aria-expanded={calPickerOpen}
                      aria-controls="cal-target-picker"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '6px 8px', border: 'none', background: 'none', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ ...cast(13, 700, '.16em'), color: 'var(--text-2)', flexShrink: 0 }}>Showing</span>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 'var(--fs-3)', overflowWrap: 'anywhere' }}>{calTargetLabel}</span>
                      <span style={{ ...cast(13, 700, '.12em'), color: 'var(--primary)', flexShrink: 0 }}>{calPickerOpen ? 'Close' : 'Change'}</span>
                    </button>
                    {calPickerOpen && (
                      <div id="cal-target-picker" style={{ borderTop: HAIR, marginTop: 6, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <button onClick={() => pickCalendar('personal', '')} aria-pressed={calMode === 'personal'} style={sideItem(calMode === 'personal', 'var(--primary)')}>
                          <Icon name="calendar" size={15} /> My calendar
                        </button>
                        {groups.length > 0 && (
                          <>
                            <div style={{ ...cast(13, 700, '.16em'), color: 'var(--text-2)', padding: '10px 12px 2px' }}>Squad calendars</div>
                            {groups.map(g => (
                              <button key={g.id} onClick={() => pickCalendar('group', g.id)} aria-pressed={calMode === 'group' && calTargetId === g.id} style={sideItem(calMode === 'group' && calTargetId === g.id, g.color)}>
                                <span style={{ width: 12, height: 12, borderRadius: '50%', background: g.color, flexShrink: 0, boxShadow: '0 0 0 1.5px var(--text-muted)' }} />
                                {g.name}
                              </button>
                            ))}
                          </>
                        )}
                        {athletes.length > 0 && (
                          <>
                            <div style={{ ...cast(13, 700, '.16em'), color: 'var(--text-2)', padding: '10px 12px 0' }}>An athlete&apos;s calendar</div>
                            {/* value="" so it opens straight onto the list rather
                                than folded onto the current athlete behind a
                                second Change; "Showing" above already says who. */}
                            <AthletePicker
                              athletes={athletes}
                              squads={groups.map(g => ({ id: g.id, name: g.name, member_ids: g.member_ids }))}
                              value=""
                              onChange={id => pickCalendar('athlete', id)}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="card" style={{ padding: 10, minWidth: 0 }}>
                    <button onClick={() => showCalendarFor('personal', '')} style={sideItem(calMode === 'personal', 'var(--primary)')}>
                      <Icon name="calendar" size={15} /> My Calendar
                    </button>
                    {athletes.length > 0 && (
                      <>
                        <div style={{ ...cast(13, 700, '.16em'), color: 'var(--text-2)', padding: '12px 12px 4px' }}>Athletes</div>
                        {athletes.map(a => (
                          <button key={a.id} onClick={() => showCalendarFor('athlete', a.id)} style={sideItem(calMode === 'athlete' && calTargetId === a.id, 'var(--coach-on-light)')}>
                            <Mono initials={initialsOf(a.first_name, a.last_name)} pending={statusOf(a) === 'INVITED'} size={28} />
                            {a.first_name} {a.last_name}
                          </button>
                        ))}
                      </>
                    )}
                    {groups.length > 0 && (
                      <>
                        <div style={{ ...cast(13, 700, '.16em'), color: 'var(--text-2)', padding: '12px 12px 4px' }}>Squads</div>
                        {groups.map(g => (
                          <button key={g.id} onClick={() => showCalendarFor('group', g.id)} style={sideItem(calMode === 'group' && calTargetId === g.id, g.color)}>
                            <span style={{ width: 12, height: 12, borderRadius: '50%', background: g.color, flexShrink: 0, boxShadow: '0 0 0 1.5px var(--text-muted)' }} />
                            {g.name}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
                <div className="card" style={{ padding: 18, minWidth: 0 }}>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ ...cast(19, 700, '.04em'), color: 'var(--text)', overflowWrap: 'anywhere' }}>{calTitle}</div>
                    <div className="section-sub" style={{ color: 'var(--text-2)' }}>{calSubtitle}</div>
                  </div>
                  {calError && (
                    <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-2)', fontWeight: 600, marginBottom: 12 }}>
                      {calError}
                    </div>
                  )}
                  {/* Rendered unconditionally. The `calLoading ? … : <Calendar/>`
                      that used to be here unmounted the calendar on every
                      month change, which is what made the grid snap back to
                      today while the events belonged to the month the coach
                      had asked for. lib/calendar-month.ts has the full trace. */}
                  <Calendar
                    events={calEvents}
                    role="coach"
                    month={calMonth}
                    loading={calLoading}
                    onAddEvent={date => setAddEventModal({ date })}
                    onDeleteEvent={deleteEvent}
                    onMonthChange={setCalMonth}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ════ MESSAGES TAB ════ */}
          {/* Sized to end just above the floating nav: the viewport, less the
              top bar, less the nav and its offset from the bottom edge. */}
          {tab === 'messages' && (
            <div style={{ height: isMobile ? `calc(100dvh - ${TOPBAR_H + NAV_H + 8}px - ${NAV_BOTTOM})` : '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <MessagingPanel
                athletes={athletes}
                unreadCounts={unreadCounts}
                preselectedAthleteId={msgPreselectedId}
                onUnreadChange={handleUnreadChange}
              />
            </div>
          )}

          {/* ════ SETTINGS TAB ════ */}
          {tab === 'settings' && (
            <SettingsTab
              coachName={coachName}
              coachSport={coachSport}
              coachEmail={coachEmail}
              inviteCode={inviteCode}
              codeEditing={codeEditing}
              codeDraft={codeDraft}
              codeSaving={codeSaving}
              codeMsg={codeMsg}
              setCodeDraft={setCodeDraft}
              setCodeEditing={setCodeEditing}
              setCodeMsg={setCodeMsg}
              saveCode={saveCode}
              onNameChange={(first, last, sport, email) => {
                setCoachName(`${first} ${last}`.trim())
                setCoachSport(sport)
                if (email) setCoachEmail(email)
              }}
              logout={logout}
            />
          )}
        </div>
      </main>

      {/* ════════ MOBILE BOTTOM NAV ════════ */}
      {isMobile && (
        <>
          {/* The veil: content fades out under the floating bar rather than
              stopping at a hard edge. Pointer-transparent. */}
          <div aria-hidden style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 199, pointerEvents: 'none',
            height: `calc(${NAV_H + 56}px + ${NAV_BOTTOM})`,
            background: `linear-gradient(180deg, transparent 0%, ${tint(INK_DEEP, 80)} 48%, ${INK_DEEP} 100%)`,
          }} />
          <nav aria-label="Coach" style={{
            position: 'fixed', left: 8, right: 8, bottom: NAV_BOTTOM, height: NAV_H, zIndex: 200,
            borderRadius: 21, border: HAIR_2,
            background: tint(INK_DEEP, 88),
            backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            boxShadow: `0 -2px 30px ${tint('black', 45)}`,
            /* Five equal tracks that content cannot widen. `1fr` without the
               minmax let the labels size the tracks. The labels are Big
               Shoulders now, which is ~30% narrower than the face they
               replaced — measured at 320px in the build harness. */
            display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            alignItems: 'stretch', padding: 0,
          }}>
            {BOTTOM_NAV_ITEMS.map((item) => {
              if ('fab' in item) {
                return (
                  <button key="fab"
                    onClick={() => openRecorder()}
                    aria-label="Record a session"
                    style={{
                      background: 'none', border: 'none', padding: 0, minWidth: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      width: 48, height: 32, borderRadius: 11, background: 'var(--flood)', color: 'var(--on-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon name="mic" size={18} strokeWidth={2.4} />
                    </span>
                    <span style={{ ...cast(13, 700, '.05em'), color: 'var(--text)', whiteSpace: 'nowrap' }}>Record</span>
                  </button>
                )
              }
              /* Squads live behind the Athletes destination, so the tab stays lit
               * while the coach is in them. Before this, `setTab('groups')` was
               * never called from anywhere on a phone: the only entry was the
               * desktop sidebar, gated behind `!isMobile`. The tab rendered and
               * had no door.
               *
               * That silently removed squad recording from the product on the
               * only device it is used on — QuickSessionModal only offers
               * "Group / Squad" when groups.length > 0, so a phone-only coach
               * could never create a squad, never saw the mode, and never learned
               * one recording can reach twelve athletes. */
              const active = tab === item.key || (item.key === 'athletes' && tab === 'groups')
              const unread = item.key === 'messages' ? totalUnreadAll : 0
              return (
                <button key={item.key} onClick={() => { if (item.key === 'messages') setMsgPreselectedId(null); setTab(item.key) }} aria-current={active ? 'page' : undefined} style={{
                  background: 'none', border: 'none', padding: 0, position: 'relative', minWidth: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5,
                  color: active ? 'var(--flood)' : 'var(--text-2)',
                  cursor: 'pointer',
                }}>
                  {active && <span aria-hidden style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 18, height: 2.5, background: 'var(--flood)', borderRadius: 2 }} />}
                  <span style={{ position: 'relative', display: 'flex' }}>
                    <Icon name={item.icon} size={19} strokeWidth={active ? 2.2 : 1.9} />
                    {unread > 0 && (
                      <span style={{ position: 'absolute', top: -7, right: -11, minWidth: 18, minHeight: 18, lineHeight: 1, borderRadius: 99, background: 'var(--coach-on-light)', color: 'var(--on-primary)', ...cast(13, 800, '0'), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 9 ? '9+' : unread}</span>
                    )}
                  </span>
                  <span style={{ ...cast(13, 700, '.05em'), whiteSpace: 'nowrap' }}>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </>
      )}

      {/* ════════ MODALS ════════ */}

      {/* Add an athlete. After a send it stays open and says what just
          happened — the row it created, and what PENDING will mean for them —
          with the form reset under it for the next one. It used to close
          with nothing said, on the coach's most consequential roster action. */}
      {showAddAthlete && (
        <div role="dialog" aria-modal="true" aria-label="Add athlete" style={isMobile
          ? { position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg)', overflowY: 'auto', overflowX: 'hidden' }
          : { position: 'fixed', inset: 0, background: tint('black', 50), backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }}>
          <div className={isMobile ? undefined : 'card-lg'} style={isMobile
            ? { minHeight: '100%', padding: `10px ${GUTTER} calc(32px + env(safe-area-inset-bottom))` }
            : { width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isMobile ? (
                <>
                  <button onClick={closeAddAthlete} aria-label="Back" style={ICON_BTN}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 5 8 12l6.5 7" /></svg>
                  </button>
                  <Brand rolecap="Add athlete" />
                </>
              ) : (
                <>
                  <div style={{ ...cast(19, 700, '.08em'), color: 'var(--text)', flex: 1 }}>Add athlete</div>
                  <button onClick={closeAddAthlete} aria-label="Close" style={{ width: 44, height: 44, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-2)' }}>×</button>
                </>
              )}
            </div>

            {lastInvite && (
              <div role="status" style={{ position: 'relative', marginTop: 14, borderRadius: 20, overflow: 'hidden', background: PANEL, border: HAIR, padding: '12px 15px 13px' }}>
                <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, var(--flood) 0%, ${tint('var(--flood)', 16)} 62%, transparent 100%)` }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...cast(13, 700, '.26em'), color: 'var(--flood)' }}>
                  <i className="sn-livedot" aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--flood)', flex: 'none' }} />
                  Invite sent
                  <span style={{ marginLeft: 'auto', ...MONO, fontSize: 13, color: 'var(--text-2)' }}>
                    {lastInvite.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: HAIR }}>
                  <Mono initials={initialsOf(lastInvite.firstName, lastInvite.lastName)} pending />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...cast(18, 700, '.04em'), color: 'var(--text)', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{lastInvite.firstName} {lastInvite.lastName}</div>
                    <div style={{ ...MONO, fontSize: 13, color: 'var(--text-2)', marginTop: 5, overflowWrap: 'anywhere' }}><BreakableEmail email={lastInvite.email} /></div>
                  </div>
                  <Chip tone="amber">Pending</Chip>
                </div>
                {/* athleteStatus() in lib/athlete-status.ts, said in English. */}
                <p style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--t-body)', lineHeight: 1.42, color: 'var(--text)', margin: '11px 0 0' }}>
                  {lastInvite.firstName} is on your roster now. They read{' '}
                  <em style={{ fontStyle: 'italic', fontWeight: 500, background: `linear-gradient(transparent 68%, ${tint('var(--energy-dark)', 28)} 68%)` }}>Pending</em>{' '}
                  until the first time they open the app — then they turn Active on their own.
                </p>
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <SecHead title={lastInvite ? 'Add another' : 'Invite by email'} side="By email" />
            </div>
            <div style={{ marginTop: 4, borderTop: HAIR_2 }}>
              {([['First name', 'Alex', 'firstName', 'text'], ['Last name', 'Johnson', 'lastName', 'text'], ['Email address', 'alex@example.com', 'email', 'email']] as const).map(([label, ph, key, type]) => (
                <div key={key} className="sn-field" style={{ padding: '9px 0 2px' }}>
                  <label htmlFor={`add-${key}`} style={{ display: 'block', ...cast(13, 700, '.2em'), color: 'var(--text-2)' }}>{label}</label>
                  <input
                    id={`add-${key}`}
                    type={type}
                    placeholder={ph}
                    value={addForm[key]}
                    onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                    autoComplete="off"
                    style={{ width: '100%', minWidth: 0, minHeight: 44, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 500, padding: 0 }}
                  />
                </div>
              ))}
            </div>
            <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.42, marginTop: 10 }}>An invite email will be sent with a link to set their password.</div>
            {addMsg && <p role="alert" style={{ fontSize: 'var(--fs-3)', fontWeight: 600, color: 'var(--danger)', margin: '10px 0 0' }}>{addMsg}</p>}
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={closeAddAthlete} style={{ flex: '1 1 110px', minHeight: 48 }}>{lastInvite ? 'Done' : 'Cancel'}</button>
              <button onClick={createAthlete} disabled={addLoading} style={{
                flex: '2 1 180px', minHeight: 48, borderRadius: 16, border: 'none', cursor: addLoading ? 'not-allowed' : 'pointer', opacity: addLoading ? 0.6 : 1,
                background: 'var(--primary)', color: 'var(--on-primary)', ...cast(18, 800, '.1em'),
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
              }}>
                <Icon name="arrow" size={16} strokeWidth={2.2} /> {addLoading ? 'Inviting…' : 'Send invite'}
              </button>
            </div>

            <div style={{ marginTop: 22 }}>
              <SecHead title="Or share your code" />
            </div>
            {inviteCode ? (
              <div style={{ position: 'relative', marginTop: 8, borderRadius: 20, overflow: 'hidden', background: PANEL_2, border: HAIR_2, padding: '13px 15px' }}>
                <div style={{ ...MONO, fontWeight: 700, fontSize: 26, letterSpacing: '.14em', color: 'var(--text)', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{inviteCode}</div>
                <div style={{ fontSize: 'var(--fs-3)', lineHeight: 1.4, color: 'var(--text-2)', marginTop: 8 }}>Athletes enter it at sign-up to auto-join your roster.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 11, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { navigator.clipboard.writeText(inviteCode); setCodeMsg('Copied!'); setTimeout(() => setCodeMsg(''), 2000) }}
                    style={{ flex: '1 1 120px', minHeight: 44, borderRadius: 12, border: HAIR_2, background: tint('var(--text)', 4), color: 'var(--text-2)', ...cast(13, 700, '.16em'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer' }}
                  >
                    <Icon name="copy" size={14} /> Copy
                  </button>
                  {codeMsg && <span role="status" style={{ fontSize: 'var(--fs-2)', fontWeight: 600, color: codeMsg.includes('Copied') || codeMsg.includes('updated') ? 'var(--success)' : 'var(--danger)' }}>{codeMsg}</span>}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 'var(--fs-3)', color: 'var(--text-2)' }}>
                <span style={{ flex: '1 1 180px' }}>You have not set a code yet. Athletes enter it at sign-up to auto-join your roster.</span>
                <button className="btn btn-ghost" onClick={() => { closeAddAthlete(); setTab('settings') }} style={{ minHeight: 44 }}>Set it in Settings</button>
              </div>
            )}
          </div>
        </div>
      )}

      {addEventModal && (
        <div style={{ position: 'fixed', inset: 0, background: tint('black', 50), backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16 }}>
          <div className="card-lg" style={{ width: '100%', maxWidth: 440, maxHeight: '92vh', overflowY: 'auto', padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...cast(19, 700, '.04em'), color: 'var(--text)', overflowWrap: 'anywhere' }}>Add Event — {calTitle}</div>
                <div style={{ ...MONO, fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
                  {new Date(addEventModal.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <button onClick={() => setAddEventModal(null)} aria-label="Close" style={{ width: 44, height: 44, margin: '-10px -10px 0 0', background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-2)', flexShrink: 0 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <div>
                <label className="label" htmlFor="event-title">Title *</label>
                <input id="event-title" className="input" placeholder="e.g. Team meeting, Speed drills, Rest day" value={eventForm.title} onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))} autoFocus style={{ minHeight: 44 }} />
              </div>
              <div>
                <label className="label">Type</label>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {['session','homework','goal','reminder','other'].map(t => (
                    <button key={t} onClick={() => setEventForm(f => ({ ...f, event_type: t }))} aria-pressed={eventForm.event_type === t} className={`badge badge-${t}`} style={{ cursor: 'pointer', border: `1.5px solid ${eventForm.event_type === t ? 'currentColor' : 'transparent'}`, padding: '0 12px', minHeight: 44, fontSize: 'var(--fs-1)' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="event-time">Time (optional)</label>
                <input id="event-time" className="input" type="time" value={eventForm.event_time} onChange={e => setEventForm(f => ({ ...f, event_time: e.target.value }))} style={{ minHeight: 44 }} />
              </div>
              <div>
                <label className="label" htmlFor="event-notes">Notes (optional)</label>
                <textarea id="event-notes" className="input" rows={3} value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} placeholder="Extra details…" />
              </div>
              {calMode === 'group' && (
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-2)', color: 'var(--text-2)', border: HAIR_2 }}>
                  This event will be added to all {groups.find(g => g.id === calTargetId)?.member_count ?? 0} athletes in this group.
                </div>
              )}
              {(calMode === 'athlete' || calMode === 'group') && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: 'pointer', fontSize: 'var(--fs-3)', minHeight: 44, padding: '10px 12px', background: alsoAddToCoach ? 'var(--primary-light)' : 'var(--bg)', border: `1.5px solid ${alsoAddToCoach ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8 }}>
                  <input type="checkbox" checked={alsoAddToCoach} onChange={e => setAlsoAddToCoach(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
                  <span style={{ fontWeight: alsoAddToCoach ? 700 : 400 }}>Also add to my personal calendar</span>
                  <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-1)', color: 'var(--text-2)' }}>prevents double-booking</span>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={() => { setAddEventModal(null); setAlsoAddToCoach(false) }} style={{ flex: '1 1 120px', minHeight: 44 }}>Cancel</button>
              <button className="btn btn-primary btn-lg" onClick={saveEvent} disabled={eventSaving || !eventForm.title.trim()} style={{ flex: '2 1 180px' }}>
                {eventSaving ? 'Saving…' : calMode === 'group' ? 'Add for Group' : 'Add to Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ DELETE CONFIRM MODAL ════════ */}
      {deleteConfirmAthlete && (
        <div style={{ position: 'fixed', inset: 0, background: tint('black', 55), backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 20 }}>
          <div className="card-lg" role="alertdialog" aria-modal="true" aria-label="Remove athlete?" style={{ width: '100%', maxWidth: 400, padding: 26 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--danger-light)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Icon name="trash" size={22} strokeWidth={2} />
            </div>
            <div style={{ ...cast(22, 700, '.04em'), color: 'var(--text)', marginBottom: 8 }}>Remove athlete?</div>
            <p style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', margin: '0 0 20px', lineHeight: 1.6 }}>
              This will permanently delete <strong style={{ color: 'var(--text)' }}>{deleteConfirmAthlete.first_name} {deleteConfirmAthlete.last_name}</strong> and all their sessions, notes, and data. This cannot be undone.
            </p>
            {deleteError && (
              <div role="alert" style={{ margin: '-6px 0 16px', padding: '10px 12px', borderRadius: 8, background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--fs-2)', fontWeight: 600, overflowWrap: 'anywhere' }}>
                {deleteError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={closeDeleteConfirm} disabled={deleteLoading} style={{ flex: '1 1 120px', minHeight: 44 }}>
                Cancel
              </button>
              <button className="btn btn-danger btn-lg" onClick={confirmDelete} disabled={deleteLoading} style={{ flex: '1 1 150px', fontWeight: 800 }}>
                {deleteLoading ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ TOASTS ════════ */}
      {(joinToasts.length > 0 || simpleToasts.length > 0 || receipts.length > 0) && (
        <div style={{
          position: 'fixed',
          bottom: isMobile ? `calc(${NAV_H + 10}px + ${NAV_BOTTOM})` : 24,
          right: isMobile ? 12 : 24,
          left: isMobile ? 12 : 'auto',
          zIndex: 500,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-end',
        }}>
          {simpleToasts.map(t => (
            <SimpleToast
              key={t.id}
              data={t}
              onDismiss={() => setSimpleToasts(prev => prev.filter(x => x.id !== t.id))}
            />
          ))}
          {receipts.map(r => (
            <ReceiptToast
              key={r.id}
              data={r}
              onDismiss={() => setReceipts(prev => prev.filter(x => x.id !== r.id))}
            />
          ))}
          {joinToasts.map(t => (
            <JoinToast
              key={t.toastId}
              data={t}
              onDismiss={() => setJoinToasts(prev => prev.filter(x => x.toastId !== t.toastId))}
            />
          ))}
        </div>
      )}

      {quickSessionOpen && (
        <QuickSessionModal
          athletes={athletes}
          groups={groups}
          defaultAthleteId={quickSessionAthleteId}
          defaultGroupId={quickSessionGroupId}
          coachSport={coachSport}
          onClose={() => { setQuickSessionOpen(false); setQuickSessionAthleteId(undefined); setQuickSessionGroupId(undefined) }}
          onSaved={async () => {
            // Diff the session list around the refetch: whatever is new is what
            // this save created. The modal reports nothing back, and reading it
            // from the list means the receipt describes what the server
            // actually wrote rather than what the client asked for.
            const before = new Set(homeSessions.map((s) => s.id))
            const [after] = await Promise.all([refreshSessions(), fetchAthletes(), fetchCoverage()])
            const created = (after ?? []).filter((s) => !before.has(s.id))
            if (created.length === 0) return

            const shared = created.filter((s) => s.shared_with_athlete).length
            const first = created[0]
            const who = first.athletes
              ? first.athletes.first_name
              : 'your athlete'
            const message =
              created.length > 1
                ? (shared === created.length
                    ? `Shared with ${created.length} athletes`
                    : `Saved for ${created.length} athletes · ${shared} shared`)
                : (first.shared_with_athlete
                    ? `Shared with ${who}`
                    : `Saved to ${who}'s record`)

            setReceipts((prev) => [
              ...prev,
              {
                id: `receipt-${first.id}`,
                message,
                // One session opens directly; a squad save has no single page
                // to open, so it offers no link rather than a misleading one.
                href: created.length === 1 ? `/sessions/${first.id}` : null,
              },
            ])
          }}
        />
      )}
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: 'var(--text-muted)' }}>Loading…</div></div>}>
      <DashboardPageInner />
    </Suspense>
  )
}
