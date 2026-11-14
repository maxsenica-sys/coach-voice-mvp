'use client'

/**
 * FinishRecordingSheet: finish a recording that was stopped but never saved.
 *
 * Opened from a row under "On this phone" (PendingRecordings). Transcribe it
 * if that has not happened yet, say who it is for, check the summary, save.
 * The rules (what a recording may be finished as, what a complete answer is)
 * are lib/recording-finish.ts; the network legs are the queue's own
 * (lib/recording-sync.ts), run by the panel that owns the queue lock.
 *
 * role="dialog", so an app update never reloads over it (lib/app-update.ts).
 */
import { useState } from 'react'
import { apiJson } from '@/lib/api-client'
import { errorMessage } from '@/lib/errors'
import type { PendingRecording } from '@/lib/recording-queue'
import {
  allowedFinishModes, describePending, finishPatch,
  type FinishAthlete, type FinishGroup, type RecordingMode,
} from '@/lib/recording-finish'
import { MAX_SPLIT_ATHLETES, MIN_SPLIT_ATHLETES } from '@/lib/split-summary'
import { newSharedRecordingId } from '@/lib/recording-queue'

const MODE_LABEL: Record<RecordingMode, string> = {
  athlete: 'One athlete',
  group: 'A squad',
  several: 'Several athletes, split',
}

const label: React.CSSProperties = {
  display: 'block', fontSize: 'var(--t-furniture)', fontWeight: 700, color: 'var(--text-2)',
  textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 6,
}
const field: React.CSSProperties = {
  display: 'block', width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid var(--border)',
  borderRadius: 12, padding: '11px 13px', font: 'inherit', fontSize: 16, lineHeight: 1.5,
  background: 'var(--surface-2, var(--bg))', color: 'var(--text)',
}
const note: React.CSSProperties = { fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', lineHeight: 1.5 }

export interface FinishOutcome { done: boolean; error: string | null }

export default function FinishRecordingSheet({
  rec, athletes, groups, coachSport, busy, onTranscribe, onSave, onClose,
}: {
  rec: PendingRecording
  athletes: FinishAthlete[]
  groups: FinishGroup[]
  coachSport: string | null
  /** The queue is sending something else right now. */
  busy: boolean
  /** Upload and transcribe this row now. Resolves to the row as it is after. */
  onTranscribe: () => Promise<{ rec: PendingRecording | null; error: string | null }>
  /** Apply the patch and push the row through the queue's save. */
  onSave: (patch: Partial<PendingRecording>) => Promise<FinishOutcome>
  onClose: () => void
}) {
  const modes = allowedFinishModes(rec.mode)
  const [mode, setMode] = useState<RecordingMode>(rec.mode)
  const [transcript, setTranscript] = useState(rec.transcript ?? '')
  const [transcribing, setTranscribing] = useState(false)
  const [athleteId, setAthleteId] = useState(rec.athleteId ?? '')
  const [groupId, setGroupId] = useState(rec.groupId ?? '')
  const [severalIds, setSeveralIds] = useState<string[]>(rec.athleteIds ?? [])
  const firstDraft = rec.athleteId ? rec.drafts?.[rec.athleteId] : undefined
  const [summary, setSummary] = useState(firstDraft?.summary ?? '')
  const [next, setNext] = useState(firstDraft?.next ?? '')
  const [splitDrafts, setSplitDrafts] = useState<Record<string, { summary: string; next: string }>>(
    rec.mode === 'several' ? { ...(rec.drafts ?? {}) } : {},
  )
  const [drafting, setDrafting] = useState(false)
  const [share, setShare] = useState(rec.shareWithAthlete)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const athlete = athletes.find((a) => a.id === athleteId) ?? null
  const group = groups.find((g) => g.id === groupId) ?? null
  const chosen = athletes.filter((a) => severalIds.includes(a.id))
  const recordedOn = new Date(rec.createdAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

  const transcribeNow = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setMessage('You are offline. It transcribes by itself when you have signal, or type what was said below.')
      return
    }
    setTranscribing(true); setMessage('')
    const out = await onTranscribe()
    setTranscribing(false)
    if (out.rec?.transcript) setTranscript((typed) => (typed.trim() ? typed : out.rec?.transcript ?? ''))
    else setMessage(out.error ?? 'It did not transcribe. Try again, or type what was said below.')
  }

  const draftOne = async () => {
    if (!athlete || !transcript.trim()) return
    setDrafting(true); setMessage('')
    try {
      const out = await apiJson<{ summary: string | null; next: string | null; blocked?: boolean; message?: string }>('/api/sessions/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, athlete_id: athlete.id, sport: coachSport || null }),
      })
      if (out.blocked) { setShare(false); setMessage(out.message ?? "This recording can't be summarised or shared with an athlete."); return }
      setSummary((typed) => (typed.trim() ? typed : out.summary ?? ''))
      setNext((typed) => (typed.trim() ? typed : out.next ?? ''))
      if (!out.summary && !out.next) setMessage('No summary drafted: nothing in this recording matched a coaching point. Write your own, or leave it blank.')
    } catch (e: unknown) {
      setMessage(errorMessage(e, 'Could not draft a summary. You can write one, or save without.'))
    } finally { setDrafting(false) }
  }

  const draftSplit = async () => {
    if (chosen.length < MIN_SPLIT_ATHLETES || !transcript.trim()) return
    setDrafting(true); setMessage('')
    try {
      const out = await apiJson<{ sections?: { athlete_id: string; summary: string | null; next: string | null }[]; blocked?: boolean; error?: string }>('/api/sessions/split-summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, athlete_ids: chosen.map((a) => a.id), sport: coachSport || null }),
      })
      setSplitDrafts((prev) => {
        const nextDrafts = { ...prev }
        for (const sec of out.sections ?? []) {
          const typed = prev[sec.athlete_id]
          nextDrafts[sec.athlete_id] = {
            summary: typed?.summary.trim() ? typed.summary : sec.summary ?? '',
            next: typed?.next.trim() ? typed.next : sec.next ?? '',
          }
        }
        return nextDrafts
      })
    } catch (e: unknown) {
      // The split route refuses content that must not reach an athlete with
      // its own message (lib/content-gate.ts); it arrives here as the error.
      setMessage(errorMessage(e, 'Could not split this recording. Try again.'))
    } finally { setDrafting(false) }
  }

  const save = async () => {
    const result = finishPatch(rec, {
      mode, transcript, share,
      athlete, summary, next,
      group,
      athletes: chosen, drafts: splitDrafts, newSharedRecordingId: rec.sharedRecordingId ? undefined : newSharedRecordingId(),
    })
    if ('error' in result) { setMessage(result.error); return }
    setSaving(true); setMessage('')
    const out = await onSave(result.patch)
    setSaving(false)
    if (out.done) { onClose(); return }
    setMessage(out.error
      ? `${out.error} It is kept on this phone, marked to send, and tries again when you have signal.`
      : 'It is kept on this phone, marked to send, and tries again when you have signal.')
  }

  const toggleSeveral = (id: string) => setSeveralIds((ids) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= MAX_SPLIT_ATHLETES ? ids : [...ids, id])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(11,13,12,0.62)', overflowY: 'auto', overflowX: 'hidden' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-rec-title"
        style={{
          width: '100%', maxWidth: 560, margin: '0 auto', minHeight: '100%', boxSizing: 'border-box',
          background: 'var(--bg)', color: 'var(--text)', padding: '18px 16px 28px',
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="finish-rec-title" style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 26, lineHeight: 1.15 }}>
              Finish this recording
            </h2>
            <div style={{ ...note, marginTop: 6, overflowWrap: 'anywhere' }}>
              Recorded {recordedOn} for {rec.targetLabel}. {describePending(rec).replace(/\.$/, '')}.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-2)', fontSize: 22, lineHeight: 1, cursor: 'pointer',
          }}>×</button>
        </div>

        {/* What was said */}
        <div>
          <label htmlFor="finish-rec-transcript" style={label}>What was said</label>
          {!transcript.trim() && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <button className="btn btn-primary" onClick={() => void transcribeNow()} disabled={transcribing || busy} style={{ minHeight: 44 }}>
                {transcribing ? 'Transcribing…' : 'Transcribe it now'}
              </button>
              <span style={note}>Or type it below.</span>
            </div>
          )}
          <textarea
            id="finish-rec-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            placeholder="The transcript appears here."
            style={{ ...field, resize: 'vertical' }}
          />
        </div>

        {/* Who it is for */}
        <div>
          <span style={label}>Who it is for</span>
          {modes.length > 1 && (
            <div role="radiogroup" aria-label="Kind of session" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {modes.map((m) => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={mode === m ? 'btn btn-primary' : 'btn btn-ghost'} style={{ minHeight: 44 }}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          )}
          {modes.length === 1 && rec.mode !== 'athlete' && (
            <div style={{ ...note, marginBottom: 10 }}>
              Recorded as {rec.mode === 'group' ? 'a squad talk' : 'several athletes, split'}, so it saves that way: nobody reads what was said about the others.
            </div>
          )}

          {mode === 'athlete' && (athletes.length === 0 ? (
            <div style={note}>You have no athletes on your roster yet. Add one, then finish this recording.</div>
          ) : (
            <select aria-label="Athlete" value={athleteId} onChange={(e) => { setAthleteId(e.target.value); setSummary(''); setNext('') }} style={{ ...field, minHeight: 44 }}>
              <option value="">Choose an athlete…</option>
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.first_name} {a.last_name}</option>)}
            </select>
          ))}

          {mode === 'group' && (groups.length === 0 ? (
            <div style={note}>You have no squads yet. Make one in Squads, then finish this recording.</div>
          ) : (
            <select aria-label="Squad" value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ ...field, minHeight: 44 }}>
              <option value="">Choose a squad…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.member_ids.length})</option>)}
            </select>
          ))}

          {mode === 'several' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ ...note, marginBottom: 6 }}>Choose {MIN_SPLIT_ATHLETES} to {MAX_SPLIT_ATHLETES}. {chosen.length} chosen.</div>
              {athletes.map((a) => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 'var(--t-body)', overflowWrap: 'anywhere' }}>
                  <input type="checkbox" checked={severalIds.includes(a.id)} onChange={() => toggleSeveral(a.id)} style={{ width: 20, height: 20, flexShrink: 0 }} />
                  {a.first_name} {a.last_name}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* What they read */}
        {mode === 'athlete' && athlete && (
          <div>
            <span style={label}>What {athlete.first_name} reads</span>
            <button className="btn btn-ghost" onClick={() => void draftOne()} disabled={drafting || !transcript.trim()} style={{ minHeight: 44, marginBottom: 10 }}>
              {drafting ? 'Drafting…' : summary.trim() || next.trim() ? 'Draft again' : 'Draft the summary'}
            </button>
            <textarea aria-label="Summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="Summary (optional: drafted for you when it saves if left empty)" style={{ ...field, resize: 'vertical', marginBottom: 8 }} />
            <textarea aria-label="Take into next session" value={next} onChange={(e) => setNext(e.target.value)} rows={2} placeholder="Take into next session (optional)" style={{ ...field, resize: 'vertical' }} />
          </div>
        )}
        {mode === 'group' && group && (
          <div style={note}>Each member of {group.name} gets their own summary, written when it saves, the same as from the recorder.</div>
        )}
        {mode === 'several' && chosen.length >= MIN_SPLIT_ATHLETES && (
          <div>
            <span style={label}>What each athlete reads</span>
            <button className="btn btn-ghost" onClick={() => void draftSplit()} disabled={drafting || !transcript.trim()} style={{ minHeight: 44, marginBottom: 10 }}>
              {drafting ? 'Splitting…' : chosen.every((a) => splitDrafts[a.id]) ? 'Split again' : 'Split it per athlete'}
            </button>
            {chosen.map((a) => splitDrafts[a.id] ? (
              <div key={a.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 'var(--t-body)', fontWeight: 700, marginBottom: 6, overflowWrap: 'anywhere' }}>{a.first_name} {a.last_name}</div>
                <textarea aria-label={`Summary for ${a.first_name}`} value={splitDrafts[a.id].summary} onChange={(e) => setSplitDrafts((d) => ({ ...d, [a.id]: { ...d[a.id], summary: e.target.value } }))} rows={3} placeholder="Nothing for this athlete (leave empty on purpose)" style={{ ...field, resize: 'vertical', marginBottom: 6 }} />
                <textarea aria-label={`Take into next session for ${a.first_name}`} value={splitDrafts[a.id].next} onChange={(e) => setSplitDrafts((d) => ({ ...d, [a.id]: { ...d[a.id], next: e.target.value } }))} rows={2} placeholder="Take into next session (optional)" style={{ ...field, resize: 'vertical' }} />
              </div>
            ) : null)}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 'var(--t-body)' }}>
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} style={{ width: 20, height: 20, flexShrink: 0 }} />
          Share with {mode === 'athlete' ? (athlete?.first_name ?? 'the athlete') : 'the athletes'}
        </label>

        {message && (
          <div role="status" style={{ fontSize: 'var(--t-body-tight)', color: 'var(--text)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{message}</div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || busy} style={{ minHeight: 48, flex: '1 1 160px' }}>
            {saving ? 'Saving…' : busy ? 'Sending another…' : 'Save'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving} style={{ minHeight: 48, flex: '1 1 120px' }}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
