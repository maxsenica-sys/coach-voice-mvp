'use client'

/**
 * Settings → Coaching staff.
 *
 * Head coach: who is on the team, which athletes each assistant coaches,
 * invite an assistant by email with their athletes chosen, remove one.
 * Assistant:  whose team they are on, how many athletes they were given, and
 *             a way to leave it.
 *
 * Max, 2026-09-27: an assistant is invited by an email link and sees
 * everything the head sees in check-ins. Max, 2026-09-28: an assistant has
 * only the athletes the head ticks — nobody is given a new athlete
 * automatically — with every submission tool for those athletes, and each
 * athlete is told in their messages when an assistant is given access. The
 * card says all of that in plain words before the invite is sent.
 *
 * Every action here is decided by /api/staff and /api/staff/accept; this card
 * only asks. See lib/coach-scope.ts and migrations 034 and 035.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { forgetTeam } from '@/lib/team-client'

type StaffRow = { id: string; status: 'invited' | 'active'; email: string; name: string | null; invitedAt: string; acceptedAt: string | null; athleteIds: string[] }
type StaffGet =
  | { role: 'head'; staff: StaffRow[] }
  | { role: 'assistant'; staffId: string | null; head: { id: string; name: string }; athleteIds: string[] }
type InviteReply = { ok: true; id: string; emailed: boolean; link?: string; warning?: string }
type Athlete = { id: string; first_name: string | null; last_name: string | null }
type Squad = { id: string; name: string; member_ids: string[] }

const HEAD: CSSProperties = {
  margin: 0, fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 13,
  letterSpacing: '.26em', textTransform: 'uppercase', lineHeight: 1.15, color: 'var(--text-2)',
}
const SUB: CSSProperties = { margin: '8px 0 16px', fontSize: 'var(--fs-3)', lineHeight: 1.5, color: 'var(--text-2)', overflowWrap: 'anywhere' }

const fullName = (a: Athlete) => [a.first_name, a.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') || 'Unnamed athlete'
const countLabel = (n: number) => (n === 1 ? '1 athlete' : `${n} athletes`)

/**
 * Tick the athletes an assistant coaches. Every name is shown in full and
 * wraps — two athletes must never become indistinguishable — and each row is
 * a 44px target. A squad chip ticks every member of that squad at once.
 */
function AthletePicker({ athletes, squads, value, onChange, idPrefix }: {
  athletes: Athlete[]
  squads: Squad[]
  value: Set<string>
  onChange: (next: Set<string>) => void
  idPrefix: string
}) {
  if (athletes.length === 0) {
    return <p style={{ ...SUB, margin: 0, color: 'var(--text)' }}>You have no athletes yet. Add an athlete first, then choose who this assistant coaches.</p>
  }
  const toggle = (id: string) => {
    const next = new Set(value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  const allOn = athletes.every((a) => value.has(a.id))
  const usefulSquads = squads.filter((g) => g.member_ids.some((m) => athletes.some((a) => a.id === m)))
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }}
          onClick={() => onChange(allOn ? new Set() : new Set(athletes.map((a) => a.id)))}>
          {allOn ? 'Clear all' : 'Tick all'}
        </button>
        {usefulSquads.map((g) => (
          <button key={g.id} type="button" className="btn btn-ghost" style={{ minHeight: 44, maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left', height: 'auto' }}
            onClick={() => onChange(new Set([...value, ...g.member_ids.filter((m) => athletes.some((a) => a.id === m))]))}>
            + {g.name}
          </button>
        ))}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 }}>
        {athletes.map((a) => {
          const id = `${idPrefix}-${a.id}`
          return (
            <li key={a.id} style={{ minWidth: 0 }}>
              <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--line)', cursor: 'pointer', minWidth: 0 }}>
                <input id={id} type="checkbox" checked={value.has(a.id)} onChange={() => toggle(a.id)}
                  style={{ accentColor: 'var(--primary)', width: 20, height: 20, flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--fs-3)', color: 'var(--text)', overflowWrap: 'anywhere', minWidth: 0 }}>{fullName(a)}</span>
              </label>
            </li>
          )
        })}
      </ul>
      <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-2)', color: 'var(--text-2)' }}>{countLabel(value.size)} ticked</p>
    </div>
  )
}

export default function CoachingStaff() {
  const [data, setData] = useState<StaffGet | null>(null)
  const [loadError, setLoadError] = useState('')
  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [squads, setSquads] = useState<Squad[]>([])
  const [form, setForm] = useState({ name: '', email: '' })
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [manualLink, setManualLink] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // The assistant whose athletes are being changed, and the edit in progress.
  const [editing, setEditing] = useState<{ id: string; value: Set<string> } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoadError('')
      const staff = await apiJson<StaffGet>('/api/staff', { cache: 'no-store' })
      setData(staff)
      if (staff.role === 'head') {
        const [a, g] = await Promise.all([
          apiJson<{ athletes: Athlete[] }>('/api/athletes', { cache: 'no-store' }),
          apiJson<{ groups: Squad[] }>('/api/groups', { cache: 'no-store' }),
        ])
        setAthletes(a.athletes ?? [])
        setSquads(g.groups ?? [])
      }
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Could not load your coaching team.'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes])

  const invite = async () => {
    setSending(true); setNote(null); setManualLink('')
    try {
      const out = await apiJson<InviteReply>('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, email: form.email, athlete_ids: [...chosen] }),
      })
      if (out.emailed) {
        setNote({ tone: 'ok', text: `Invite sent to ${form.email.trim()}. It works for 7 days.` })
      } else {
        setNote({ tone: 'bad', text: out.warning ?? 'The invite email could not be sent.' })
        if (out.link) setManualLink(out.link)
      }
      setForm({ name: '', email: '' })
      setChosen(new Set())
      await load()
    } catch (e: unknown) {
      setNote({ tone: 'bad', text: errorMessage(e, 'Could not send the invite.') })
    } finally {
      setSending(false)
    }
  }

  const saveAthletes = async () => {
    if (!editing) return
    setBusyId(editing.id); setNote(null)
    try {
      await apiMutate(`/api/staff?id=${encodeURIComponent(editing.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_ids: [...editing.value] }),
      })
      setEditing(null)
      await load()
    } catch (e: unknown) {
      setNote({ tone: 'bad', text: errorMessage(e, 'Could not change this assistant’s athletes.') })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (row: StaffRow) => {
    const who = row.name ?? row.email
    const q = row.status === 'active'
      ? `Remove ${who} from your coaching team? They will lose access to your athletes straight away. Everything they recorded stays.`
      : `Cancel the invite to ${who}? The link in their email will stop working.`
    if (!window.confirm(q)) return
    setBusyId(row.id); setNote(null)
    try {
      await apiMutate(`/api/staff?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      await load()
    } catch (e: unknown) {
      setNote({ tone: 'bad', text: errorMessage(e, 'Could not change the team.') })
    } finally {
      setBusyId(null)
    }
  }

  const leave = async (staffId: string, headName: string) => {
    if (!window.confirm(`Leave ${headName}’s coaching team? You will lose access to their athletes straight away.`)) return
    setBusyId(staffId); setNote(null)
    try {
      await apiMutate(`/api/staff?id=${encodeURIComponent(staffId)}`, { method: 'DELETE' })
      forgetTeam()
      window.location.assign('/dashboard')
    } catch (e: unknown) {
      setNote({ tone: 'bad', text: errorMessage(e, 'Could not leave the team.') })
      setBusyId(null)
    }
  }

  if (loadError) {
    return (
      <section className="card" style={{ padding: 22 }} aria-label="Coaching staff">
        <h2 style={HEAD}>Coaching staff</h2>
        <p role="alert" style={{ ...SUB, color: 'var(--danger)', marginBottom: 12 }}>{loadError}</p>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} style={{ minHeight: 44 }}>Try again</button>
      </section>
    )
  }
  if (!data) return null

  if (data.role === 'assistant') {
    return (
      <section className="card" style={{ padding: 22 }} aria-label="Coaching staff">
        <h2 style={HEAD}>Coaching staff</h2>
        <p style={SUB}>
          You are an assistant coach on <strong style={{ color: 'var(--text)' }}>{data.head.name}</strong>’s team, coaching{' '}
          {data.athleteIds.length === 0 ? 'no athletes yet' : countLabel(data.athleteIds.length)}. For each of them you can see sessions,
          messages and check-ins, record sessions, message them, and add notes, injuries and videos. {data.head.name} chooses which
          athletes you coach, and adding athletes, caretakers and squads stays with them.
        </p>
        {data.staffId && (
          <button type="button" className="btn btn-ghost" disabled={busyId !== null}
            onClick={() => void leave(data.staffId!, data.head.name)}
            style={{ minHeight: 44, color: 'var(--danger)' }}>
            {busyId ? 'Leaving…' : 'Leave this team'}
          </button>
        )}
        {note && <p role={note.tone === 'bad' ? 'alert' : 'status'} style={{ margin: '12px 0 0', fontSize: 'var(--fs-3)', color: note.tone === 'bad' ? 'var(--danger)' : 'var(--success)', overflowWrap: 'anywhere' }}>{note.text}</p>}
      </section>
    )
  }

  const canSend = form.name.trim().length > 0 && /\S+@\S+\.\S+/.test(form.email.trim()) && chosen.size > 0 && !sending

  return (
    <section className="card" style={{ padding: 22 }} aria-label="Coaching staff">
      <h2 style={HEAD}>Coaching staff</h2>
      <p style={SUB}>
        An assistant coach coaches the athletes you tick — nobody else, and never a new athlete unless you tick them. For those athletes
        they see everything you see (sessions, messages and check-ins) and can record sessions, message them, and add notes, injuries
        and videos. Parents and caretakers, squads and your roster stay with you. Each athlete is told in their messages when an
        assistant is given access to them.
      </p>

      {data.staff.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.staff.map((s) => {
            const theirs = s.athleteIds.map((id) => byId.get(id)).filter((a): a is Athlete => Boolean(a))
            const isEditing = editing?.id === s.id
            return (
              <li key={s.id} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px', minWidth: 0 }}>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'var(--fs-3)', overflowWrap: 'anywhere' }}>{s.name ?? s.email}</div>
                    <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
                      {s.status === 'active' ? 'Assistant coach' : 'Invite sent — not accepted yet'}{s.name ? ` · ${s.email}` : ''}
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost" disabled={busyId !== null} onClick={() => void remove(s)}
                    style={{ minHeight: 44, color: 'var(--danger)' }}>
                    {busyId === s.id && !isEditing ? '…' : s.status === 'active' ? 'Remove' : 'Cancel invite'}
                  </button>
                </div>

                <div style={{ marginTop: 8, fontSize: 'var(--fs-2)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
                  {theirs.length === 0
                    ? 'Coaches no athletes yet.'
                    : `Coaches ${countLabel(theirs.length)}: ${theirs.map(fullName).join(', ')}.`}
                </div>

                {isEditing ? (
                  <div style={{ marginTop: 10, minWidth: 0 }}>
                    <AthletePicker athletes={athletes} squads={squads} value={editing.value} idPrefix={`edit-${s.id}`}
                      onChange={(value) => setEditing({ id: s.id, value })} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      <button type="button" className="btn btn-primary" disabled={busyId !== null} onClick={() => void saveAthletes()} style={{ minHeight: 44 }}>
                        {busyId === s.id ? 'Saving…' : 'Save athletes'}
                      </button>
                      <button type="button" className="btn btn-ghost" disabled={busyId !== null} onClick={() => setEditing(null)} style={{ minHeight: 44 }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost" disabled={busyId !== null || editing !== null}
                    onClick={() => setEditing({ id: s.id, value: new Set(s.athleteIds) })} style={{ minHeight: 44, marginTop: 6 }}>
                    Change athletes
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p style={{ ...SUB, margin: '0 0 16px', color: 'var(--text)' }}>No assistant coaches yet.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <label className="label" htmlFor="staff-name">Their name</label>
          <input id="staff-name" className="input" value={form.name} autoComplete="off"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={{ minWidth: 0, minHeight: 44 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label className="label" htmlFor="staff-email">Their email</label>
          <input id="staff-email" className="input" type="email" inputMode="email" autoComplete="off" value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={{ minWidth: 0, minHeight: 44 }} />
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <legend className="label" style={{ padding: 0 }}>Athletes they will coach</legend>
          <AthletePicker athletes={athletes} squads={squads} value={chosen} onChange={setChosen} idPrefix="invite" />
        </fieldset>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => void invite()} disabled={!canSend} style={{ minHeight: 44 }}>
            {sending ? 'Sending…' : 'Send invite'}
          </button>
          {chosen.size === 0 && athletes.length > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-2)', color: 'var(--text-2)' }}>Tick at least one athlete to send the invite.</p>
          )}
        </div>
      </div>

      {note && (
        <p role={note.tone === 'bad' ? 'alert' : 'status'} style={{ margin: '12px 0 0', fontSize: 'var(--fs-3)', lineHeight: 1.45, color: note.tone === 'bad' ? 'var(--danger)' : 'var(--success)', overflowWrap: 'anywhere' }}>
          {note.text}
        </p>
      )}
      {manualLink && (
        <div style={{ marginTop: 10, minWidth: 0 }}>
          <label className="label" htmlFor="staff-link">Invite link — send it to them yourself</label>
          <textarea id="staff-link" className="input" readOnly rows={3} value={manualLink}
            style={{ width: '100%', minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-2)', wordBreak: 'break-all', resize: 'none' }} />
          <button type="button" className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(manualLink)} style={{ minHeight: 44, marginTop: 6 }}>Copy link</button>
        </div>
      )}
    </section>
  )
}
