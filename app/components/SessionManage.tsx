'use client'

// app/components/SessionManage.tsx
//
// Editing a saved session's title, date and summary, and deleting it, from
// the coach's session page. Found 2026-11-14: neither was possible.
//
// Both are dialogs (role="dialog"), so the self-update watcher never reloads
// over one (lib/app-update.ts BUSY_SELECTOR). The rules live in
// lib/session-edit.ts and run on the server too; the client runs them first
// only so a coach sees the problem before they press Save.

import { useEffect, useId, useRef, useState } from 'react'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import { todayISODate } from '@/lib/session-date'
import { MAX_BULLETS, bulletLines } from '@/lib/summary-guard'
import { checkSessionEdits, deleteWarning, MAX_TITLE_LENGTH, type DeleteWarningInput } from '@/lib/session-edit'

/** The shared shell: a sheet over a dimmed page, scrolling vertically inside. */
function Dialog({
  title, onClose, busy, children,
}: { title: string; onClose: () => void; busy: boolean; children: React.ReactNode }) {
  const titleId = useId()
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) closeRef.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2100, background: 'color-mix(in srgb, var(--bg) 72%, transparent)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width: '100%', maxWidth: 520, maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto',
          background: 'var(--bg)', color: 'var(--text)', borderRadius: 18,
          border: '1px solid color-mix(in srgb, var(--text) 19%, transparent)', boxShadow: 'var(--shadow-lg)',
          padding: '18px 18px 16px', minWidth: 0,
        }}
      >
        <h2 id={titleId} style={{
          fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, lineHeight: 1.2,
          margin: '0 0 12px', overflowWrap: 'anywhere',
        }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}

const label: React.CSSProperties = {
  display: 'block', fontSize: 'var(--t-furniture)', fontWeight: 600, color: 'var(--text-2)', margin: '14px 0 6px',
}
const field: React.CSSProperties = {
  display: 'block', width: '100%', minWidth: 0, boxSizing: 'border-box', minHeight: 44,
  border: '1px solid color-mix(in srgb, var(--text) 19%, transparent)', borderRadius: 12,
  padding: '10px 12px', font: 'inherit', fontSize: 16, lineHeight: 1.5,
  background: 'color-mix(in srgb, var(--text) 4.5%, transparent)', color: 'var(--text)',
}
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }
const secondary: React.CSSProperties = {
  minHeight: 44, padding: '0 18px', borderRadius: 12, cursor: 'pointer', fontSize: 'var(--t-body-tight)', fontWeight: 600,
  background: 'transparent', color: 'var(--text)', border: '1px solid color-mix(in srgb, var(--text) 19%, transparent)',
}

export interface EditableSession {
  id: string
  session_name: string | null
  session_date: string | null
  summary: string | null
}

/** Title, date and summary, saved together. Only what changed is sent. */
export function SessionEditSheet({
  session, onClose, onSaved,
}: {
  session: EditableSession
  onClose: () => void
  onSaved: (warnings: string[]) => void
}) {
  const [title, setTitle] = useState(session.session_name ?? '')
  const [date, setDate] = useState(session.session_date ?? todayISODate())
  const [summary, setSummary] = useState(session.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const changes: Record<string, unknown> = {}
  if (title.trim() !== (session.session_name ?? '').trim()) changes.session_name = title
  if (date !== (session.session_date ?? '')) changes.session_date = date
  if (summary.trim() !== (session.summary ?? '').trim()) changes.summary = summary
  const check = checkSessionEdits(changes)
  const points = bulletLines(summary).length
  const nothingChanged = Object.keys(changes).length === 0

  const save = async () => {
    if (!check.ok || nothingChanged) return
    setSaving(true)
    setError('')
    try {
      const json = await apiJson<{ warnings?: string[] }>(`/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      onSaved(json.warnings ?? [])
    } catch (e: unknown) {
      setError(errorMessage(e, 'That change did not save.'))
      setSaving(false)
    }
  }

  return (
    <Dialog title="Edit session" onClose={onClose} busy={saving}>
      <label style={label} htmlFor="edit-session-title">Title</label>
      <input
        id="edit-session-title"
        type="text"
        value={title}
        maxLength={MAX_TITLE_LENGTH}
        placeholder="Coaching session"
        onChange={(e) => setTitle(e.target.value)}
        style={field}
      />

      <label style={label} htmlFor="edit-session-date">Date</label>
      <input
        id="edit-session-date"
        type="date"
        value={date}
        max={todayISODate()}
        onChange={(e) => setDate(e.target.value)}
        style={field}
      />

      <label style={label} htmlFor="edit-session-summary">
        Summary · {points} of {MAX_BULLETS} points
      </label>
      <textarea
        id="edit-session-summary"
        value={summary}
        rows={7}
        onChange={(e) => setSummary(e.target.value)}
        style={{ ...field, resize: 'vertical', minHeight: 160 }}
      />
      <p style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', margin: '6px 0 0' }}>
        One point per line. The athlete reads this, so it is checked like any shared summary.
      </p>

      {(!check.ok || error) && (
        <p role="alert" style={{ fontSize: 'var(--t-body-tight)', color: 'var(--danger)', fontWeight: 600, margin: '12px 0 0', overflowWrap: 'anywhere' }}>
          {!check.ok ? check.error : error}
        </p>
      )}

      <div style={row}>
        <button
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving || nothingChanged || !check.ok}
          style={{ minHeight: 44, padding: '0 18px', cursor: saving ? 'progress' : 'pointer' }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button onClick={onClose} disabled={saving} style={secondary}>Cancel</button>
      </div>
    </Dialog>
  )
}

/** The confirm step: everything that goes and everything that stays, named. */
export function SessionDeleteDialog({
  sessionId, facts, onClose, onDeleted,
}: {
  sessionId: string
  facts: DeleteWarningInput
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const { goes, stays } = deleteWarning(facts)

  const remove = async () => {
    setDeleting(true)
    setError('')
    try {
      await apiJson(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      onDeleted()
    } catch (e: unknown) {
      setError(errorMessage(e, 'The session was not deleted.'))
      setDeleting(false)
    }
  }

  const list: React.CSSProperties = { margin: '6px 0 0', paddingLeft: 20, fontSize: 'var(--t-body)', lineHeight: 1.5 }
  return (
    <Dialog title="Delete this session?" onClose={onClose} busy={deleting}>
      <p style={{ ...label, margin: 0 }}>This deletes, and it cannot be undone:</p>
      <ul style={list}>{goes.map((g) => <li key={g} style={{ overflowWrap: 'anywhere' }}>{g}</li>)}</ul>
      <p style={{ ...label, marginTop: 14 }}>This stays:</p>
      <ul style={list}>{stays.map((s) => <li key={s} style={{ overflowWrap: 'anywhere' }}>{s}</li>)}</ul>

      {error && (
        <p role="alert" style={{ fontSize: 'var(--t-body-tight)', color: 'var(--danger)', fontWeight: 600, margin: '12px 0 0', overflowWrap: 'anywhere' }}>
          {error}
        </p>
      )}

      <div style={row}>
        <button
          onClick={() => void remove()}
          disabled={deleting}
          style={{
            minHeight: 44, padding: '0 18px', borderRadius: 12, border: 'none', fontWeight: 700,
            fontSize: 'var(--t-body-tight)', background: 'var(--danger)', color: 'var(--on-primary)',
            cursor: deleting ? 'progress' : 'pointer',
          }}
        >
          {deleting ? 'Deleting…' : 'Delete session'}
        </button>
        <button onClick={onClose} disabled={deleting} style={secondary}>Keep it</button>
      </div>
    </Dialog>
  )
}
