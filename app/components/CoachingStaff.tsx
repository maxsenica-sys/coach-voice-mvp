'use client'

/**
 * Settings → Coaching staff.
 *
 * Head coach: who is on the team, invite an assistant by email, remove one.
 * Assistant:  whose team they are on, and a way to leave it.
 *
 * Max, 2026-09-27: an assistant sees all the head's athletes and everything
 * the head sees in check-ins, and is invited by an email link. The card says
 * that in plain words before the invite is sent, so nobody adds an assistant
 * without knowing what that person will see.
 *
 * Every action here is decided by /api/staff and /api/staff/accept; this card
 * only asks. See lib/coach-scope.ts and migration 034.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { apiJson, apiMutate } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { forgetTeam } from '@/lib/team-client'

type StaffRow = { id: string; status: 'invited' | 'active'; email: string; name: string | null; invitedAt: string; acceptedAt: string | null }
type StaffGet =
  | { role: 'head'; staff: StaffRow[] }
  | { role: 'assistant'; staffId: string | null; head: { id: string; name: string } }
type InviteReply = { ok: true; id: string; emailed: boolean; link?: string; warning?: string }

const HEAD: CSSProperties = {
  margin: 0, fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 13,
  letterSpacing: '.26em', textTransform: 'uppercase', lineHeight: 1.15, color: 'var(--text-2)',
}
const SUB: CSSProperties = { margin: '8px 0 16px', fontSize: 'var(--fs-3)', lineHeight: 1.5, color: 'var(--text-2)', overflowWrap: 'anywhere' }

export default function CoachingStaff() {
  const [data, setData] = useState<StaffGet | null>(null)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ name: '', email: '' })
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [manualLink, setManualLink] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoadError('')
      setData(await apiJson<StaffGet>('/api/staff', { cache: 'no-store' }))
    } catch (e: unknown) {
      setLoadError(errorMessage(e, 'Could not load your coaching team.'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const invite = async () => {
    setSending(true); setNote(null); setManualLink('')
    try {
      const out = await apiJson<InviteReply>('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, email: form.email }),
      })
      if (out.emailed) {
        setNote({ tone: 'ok', text: `Invite sent to ${form.email.trim()}. It works for 7 days.` })
      } else {
        setNote({ tone: 'bad', text: out.warning ?? 'The invite email could not be sent.' })
        if (out.link) setManualLink(out.link)
      }
      setForm({ name: '', email: '' })
      await load()
    } catch (e: unknown) {
      setNote({ tone: 'bad', text: errorMessage(e, 'Could not send the invite.') })
    } finally {
      setSending(false)
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
          You are an assistant coach on <strong style={{ color: 'var(--text)' }}>{data.head.name}</strong>’s team. You see their athletes,
          sessions, messages and check-ins, and can record sessions and message athletes. Adding or removing athletes, caretakers
          and squads stays with {data.head.name}.
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

  const canSend = form.name.trim().length > 0 && /\S+@\S+\.\S+/.test(form.email.trim()) && !sending

  return (
    <section className="card" style={{ padding: 22 }} aria-label="Coaching staff">
      <h2 style={HEAD}>Coaching staff</h2>
      <p style={SUB}>
        An assistant coach sees all of your athletes and everything you see — sessions, messages and check-ins — and can record
        sessions and message athletes. They cannot add or remove athletes, caretakers or squads. Your athletes are told in their
        messages when someone joins.
      </p>

      {data.staff.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.staff.map((s) => (
            <li key={s.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, minWidth: 0 }}>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'var(--fs-3)', overflowWrap: 'anywhere' }}>{s.name ?? s.email}</div>
                <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
                  {s.status === 'active' ? 'Assistant coach' : 'Invite sent — not accepted yet'}{s.name ? ` · ${s.email}` : ''}
                </div>
              </div>
              <button type="button" className="btn btn-ghost" disabled={busyId !== null} onClick={() => void remove(s)}
                style={{ minHeight: 44, color: 'var(--danger)' }}>
                {busyId === s.id ? '…' : s.status === 'active' ? 'Remove' : 'Cancel invite'}
              </button>
            </li>
          ))}
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
        <div>
          <button type="button" className="btn btn-primary" onClick={() => void invite()} disabled={!canSend} style={{ minHeight: 44 }}>
            {sending ? 'Sending…' : 'Send invite'}
          </button>
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
