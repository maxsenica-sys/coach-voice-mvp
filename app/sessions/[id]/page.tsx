'use client'

/**
 * Session detail — /sessions/[id]
 *
 * Sessions used to be accordion rows inside the athlete page: tapping one took
 * you to the athlete, and a session had nowhere to grow. This gives a session
 * its own page, with room to add what makes it worth revisiting — the coach's
 * own notes, the points to carry into next time, and images.
 *
 * Reads everything in one request (/detail) so the page doesn't waterfall.
 * Serves both roles: the coach edits, the athlete reads.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiJson, apiMutate } from '@/lib/api-client'
import SessionAudioPlayer from '@/app/components/SessionAudioPlayer'

type FocusPoint = string

type SessionDetail = {
  id: string
  athlete_id: string
  session_name: string | null
  title: string | null
  summary: string | null
  transcript: string | null
  coach_notes: string | null
  focus_points: FocusPoint[]
  shared_with_athlete: boolean
  sport_context: string | null
  created_at: string
  audio_url: string | null
  audio_mime: string | null
}

type AthleteLite = {
  id: string
  first_name: string
  last_name: string
  sport: string | null
  photo_url: string | null
} | null

type VideoRow = {
  id: string
  file_name: string | null
  mime_type: string | null
  shared_with_athlete: boolean
  signedUrl: string | null
}

type AttachmentRow = {
  id: string
  file_name: string | null
  mime_type: string | null
  caption: string | null
  created_at: string
  signedUrl: string | null
}

type DetailResponse = {
  viewerRole: 'coach' | 'athlete'
  session: SessionDetail
  athlete: AthleteLite
  videos: VideoRow[]
  attachments: AttachmentRow[]
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const p = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    style: { width: size, height: size, display: 'block', flexShrink: 0 },
  }
  switch (name) {
    case 'back':   return <svg {...p}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
    case 'mic':    return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
    case 'spark':  return <svg {...p}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
    case 'target': return <svg {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
    case 'note':   return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
    case 'image':  return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
    case 'video':  return <svg {...p}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
    case 'text':   return <svg {...p}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
    case 'plus':   return <svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'x':      return <svg {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
    case 'check':  return <svg {...p}><polyline points="20 6 9 17 4 12" /></svg>
    default:       return null
  }
}

/** Section shell — one consistent frame so the page reads as a sequence, not a pile of cards. */
function Section({
  icon, label, accent, children, action,
}: {
  icon: string; label: string; accent?: string
  children: React.ReactNode; action?: React.ReactNode
}) {
  const tone = accent ?? 'var(--primary)'
  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <span style={{ color: tone, display: 'flex' }}><Icon name={icon} size={14} /></span>
        <h2 style={{
          margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.09em',
          textTransform: 'uppercase', color: 'var(--text-2, #5D6661)', flex: 1,
        }}>{label}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function SessionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = String(params?.id ?? '')

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [actionError, setActionError] = useState('')
  const [savedFlash, setSavedFlash] = useState('')

  const [notesDraft, setNotesDraft] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [newFocus, setNewFocus] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const isCoach = data?.viewerRole === 'coach'
  const session = data?.session
  const athlete = data?.athlete

  const load = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const json = await apiJson<DetailResponse>(`/api/sessions/${sessionId}/detail`, { cache: 'no-store' })
      setData(json)
      setNotesDraft(json.session.coach_notes ?? '')
      setNotesDirty(false)
    } catch (e: any) {
      setPageError(e?.message ?? 'Could not open this session.')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { if (sessionId) void load() }, [sessionId, load])

  const flash = (msg: string) => {
    setSavedFlash(msg)
    window.setTimeout(() => setSavedFlash(''), 2200)
  }

  const patchSession = async (updates: Record<string, unknown>, okMsg?: string) => {
    try {
      await apiMutate(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (okMsg) flash(okMsg)
      return true
    } catch (e: any) {
      setActionError(e?.message ?? 'That change did not save.')
      return false
    }
  }

  const saveNotes = async () => {
    if (!session) return
    const ok = await patchSession({ coach_notes: notesDraft }, 'Notes saved')
    if (ok) {
      setNotesDirty(false)
      setData((d) => (d ? { ...d, session: { ...d.session, coach_notes: notesDraft } } : d))
    }
  }

  const setFocusPoints = async (points: FocusPoint[]) => {
    if (!session) return
    const previous = session.focus_points
    setData((d) => (d ? { ...d, session: { ...d.session, focus_points: points } } : d))
    const ok = await patchSession({ focus_points: points })
    if (!ok) {
      setData((d) => (d ? { ...d, session: { ...d.session, focus_points: previous } } : d))
    }
  }

  const addFocus = async () => {
    const text = newFocus.trim()
    if (!text || !session) return
    setNewFocus('')
    await setFocusPoints([...session.focus_points, text])
  }

  const toggleShare = async () => {
    if (!session) return
    const next = !session.shared_with_athlete
    setData((d) => (d ? { ...d, session: { ...d.session, shared_with_athlete: next } } : d))
    const ok = await patchSession({ shared_with_athlete: next }, next ? 'Shared with athlete' : 'Set to private')
    if (!ok) setData((d) => (d ? { ...d, session: { ...d.session, shared_with_athlete: !next } } : d))
  }

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setActionError('Only images can be attached to a session.')
      return
    }
    setUploading(true)
    setActionError('')
    try {
      const { signedUrl, path } = await apiJson<{ signedUrl: string; path: string }>(
        `/api/sessions/${sessionId}/attachments?` +
        new URLSearchParams({ file_name: file.name, mime_type: file.type }),
      )
      const put = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('The image could not be uploaded.')

      const { attachment } = await apiJson<{ attachment: AttachmentRow }>(
        `/api/sessions/${sessionId}/attachments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storage_path: path, file_name: file.name, mime_type: file.type }),
        },
      )
      setData((d) => (d ? { ...d, attachments: [...d.attachments, attachment] } : d))
    } catch (e: any) {
      setActionError(e?.message ?? 'The image could not be uploaded.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const deleteAttachment = async (attachmentId: string) => {
    if (!confirm('Remove this image from the session?')) return
    try {
      await apiMutate(`/api/sessions/${sessionId}/attachments?attachment_id=${attachmentId}`, { method: 'DELETE' })
      setData((d) => (d ? { ...d, attachments: d.attachments.filter((a) => a.id !== attachmentId) } : d))
    } catch (e: any) {
      setActionError(e?.message ?? 'Could not remove that image.')
    }
  }

  // ── States ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '28px 18px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div style={{ height: 13, width: 120, background: 'var(--border-soft)', borderRadius: 6 }} />
          <div style={{ height: 34, width: '62%', background: 'var(--border-soft)', borderRadius: 9, marginTop: 16 }} />
          <div style={{ height: 132, background: 'var(--border-soft)', borderRadius: 'var(--radius)', marginTop: 22 }} />
          <div style={{ height: 92, background: 'var(--border-soft)', borderRadius: 'var(--radius)', marginTop: 14 }} />
        </div>
      </div>
    )
  }

  if (pageError || !session) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ padding: 24, maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 8 }}>Session unavailable</div>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', margin: '0 0 16px' }}>
            {pageError || 'This session could not be opened.'}
          </p>
          <button className="btn btn-primary" onClick={() => router.back()}>Go back</button>
        </div>
      </div>
    )
  }

  const dateLabel = new Date(session.created_at).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const heading = session.session_name || session.title || 'Coaching session'
  const athleteName = athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Athlete'
  const backHref = isCoach && athlete ? `/athletes/${athlete.id}` : '/athlete'

  return (
    <div className="bg-grain" style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 72 }}>

      {actionError && (
        <div role="alert" style={{
          position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 2000, maxWidth: 520, margin: '0 auto',
          background: 'var(--danger)', color: '#fff', borderRadius: 12, padding: '12px 14px',
          display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, boxShadow: 'var(--shadow-lg)',
        }}>
          <span style={{ flex: 1 }}>{actionError}</span>
          <button onClick={() => setActionError('')} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0 }}>
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {savedFlash && (
        <div style={{
          position: 'fixed', top: 14, left: 0, right: 0, zIndex: 2000, display: 'flex', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{
            background: 'var(--text)', color: 'var(--bg)', fontSize: 12, fontWeight: 600,
            padding: '7px 14px', borderRadius: 999, boxShadow: 'var(--shadow)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="check" size={12} /> {savedFlash}
          </span>
        </div>
      )}

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '22px 18px 0' }}>

        <Link href={backHref} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
          color: 'var(--text-2)', fontSize: 12.5, fontWeight: 600, marginBottom: 18,
        }}>
          <Icon name="back" size={14} /> {isCoach ? athleteName : 'My portal'}
        </Link>

        {/* ── Masthead ── */}
        <header style={{ marginBottom: 4 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 9,
          }}>
            {dateLabel}
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(26px, 5.5vw, 36px)',
            lineHeight: 1.1, letterSpacing: '-0.015em', margin: 0, color: 'var(--text)',
            textWrap: 'balance' as any,
          }}>
            {heading}
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 13 }}>
            {isCoach && athlete && (
              <Link href={`/athletes/${athlete.id}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
                color: 'var(--text)', fontSize: 13, fontWeight: 700,
              }}>
                <span style={{
                  width: 26, height: 26, borderRadius: '50%', background: 'var(--coach-light)',
                  color: 'var(--coach-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10.5, fontWeight: 800, overflow: 'hidden',
                }}>
                  {athlete.photo_url
                    ? <img src={athlete.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : `${athlete.first_name[0] ?? ''}${athlete.last_name[0] ?? ''}`.toUpperCase()}
                </span>
                {athleteName}
              </Link>
            )}

            {session.sport_context && (
              <span className="badge badge-session" style={{ fontSize: 10 }}>{session.sport_context}</span>
            )}

            {isCoach ? (
              <button
                onClick={toggleShare}
                className={session.shared_with_athlete ? 'badge badge-active' : 'badge badge-invited'}
                style={{ fontSize: 10, cursor: 'pointer', border: 'none', font: 'inherit', fontWeight: 700, padding: '4px 9px' }}
                title={session.shared_with_athlete ? 'Visible to the athlete — tap to make private' : 'Private — tap to share with the athlete'}
              >
                {session.shared_with_athlete ? 'Shared' : 'Private'}
              </button>
            ) : (
              <span className="badge badge-active" style={{ fontSize: 10 }}>From your coach</span>
            )}
          </div>
        </header>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '20px 0 0' }} />

        {/* ── Recording ── */}
        {session.audio_url && (
          <Section icon="mic" label="Recording" accent="var(--coach-color)">
            <div className="card" style={{ padding: '13px 15px' }}>
              <SessionAudioPlayer
                sessionId={session.id}
                initialUrl={session.audio_url}
                mime={session.audio_mime}
              />
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '9px 0 0' }}>
                Streams on demand — nothing downloads until you press play.
              </p>
            </div>
          </Section>
        )}

        {/* ── Summary: the reason to open the page ── */}
        <Section icon="spark" label="Session summary">
          {session.summary ? (
            <div className="coach-summary" style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.72 }}>
              {session.summary}
            </div>
          ) : (
            <div className="card" style={{ padding: 15, fontSize: 13.5, color: 'var(--text-muted)' }}>
              No summary was generated for this session.
            </div>
          )}
        </Section>

        {/* ── Focus points ── */}
        {(isCoach || session.focus_points.length > 0) && (
          <Section icon="target" label="Take into next session" accent="var(--energy)">
            <div className="card" style={{ padding: session.focus_points.length ? '8px 8px 10px' : 14 }}>
              {session.focus_points.length === 0 && !isCoach && (
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>Nothing noted yet.</div>
              )}

              {session.focus_points.map((point, i) => (
                <div key={`${point}-${i}`} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 8px',
                  borderBottom: i < session.focus_points.length - 1 ? '1px solid var(--border-soft)' : 'none',
                }}>
                  <span style={{
                    width: 19, height: 19, borderRadius: '50%', background: 'var(--energy-light)',
                    color: '#8B6621', fontSize: 10.5, fontWeight: 800, flexShrink: 0, marginTop: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 14, lineHeight: 1.55 }}>{point}</span>
                  {isCoach && (
                    <button
                      onClick={() => setFocusPoints(session.focus_points.filter((_, j) => j !== i))}
                      aria-label="Remove point"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              ))}

              {isCoach && (
                <div style={{ display: 'flex', gap: 7, padding: session.focus_points.length ? '10px 8px 0' : 0 }}>
                  <input
                    value={newFocus}
                    onChange={(e) => setNewFocus(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addFocus() } }}
                    placeholder="Something to work on next time…"
                    style={{
                      flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      padding: '8px 11px', font: 'inherit', fontSize: 13.5,
                      background: 'var(--bg)', color: 'var(--text)',
                    }}
                  />
                  <button className="btn btn-ghost" onClick={() => void addFocus()} disabled={!newFocus.trim()}
                    style={{ padding: '8px 12px', gap: 5, fontSize: 12.5 }}>
                    <Icon name="plus" size={13} /> Add
                  </button>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Coach notes ── */}
        {(isCoach || session.coach_notes) && (
          <Section
            icon="note"
            label={isCoach ? 'Your notes' : 'Notes from your coach'}
            action={isCoach && notesDirty ? (
              <button className="btn btn-primary" onClick={saveNotes} style={{ padding: '5px 12px', fontSize: 12 }}>
                Save
              </button>
            ) : undefined}
          >
            {isCoach ? (
              <textarea
                value={notesDraft}
                onChange={(e) => { setNotesDraft(e.target.value); setNotesDirty(true) }}
                onBlur={() => { if (notesDirty) void saveNotes() }}
                placeholder="Anything worth remembering — context, what you tried, what to watch for."
                rows={4}
                style={{
                  width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  padding: '13px 15px', font: 'inherit', fontSize: 14, lineHeight: 1.65,
                  background: 'var(--card)', color: 'var(--text)', resize: 'vertical', minHeight: 96,
                }}
              />
            ) : (
              <div className="card" style={{ padding: '13px 15px', fontSize: 14, lineHeight: 1.68, whiteSpace: 'pre-wrap' }}>
                {session.coach_notes}
              </div>
            )}
          </Section>
        )}

        {/* ── Images ── */}
        {(isCoach || (data?.attachments.length ?? 0) > 0) && (
          <Section
            icon="image"
            label="Images"
            action={isCoach ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }}
                />
                <button className="btn btn-ghost" disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  style={{ padding: '5px 11px', fontSize: 12, gap: 5 }}>
                  <Icon name="plus" size={12} /> {uploading ? 'Uploading…' : 'Add'}
                </button>
              </>
            ) : undefined}
          >
            {(data?.attachments.length ?? 0) === 0 ? (
              <div className="card" style={{ padding: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                {isCoach
                  ? 'Add a whiteboard shot, a still from video, or a drill diagram.'
                  : 'No images for this session.'}
              </div>
            ) : (
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 10,
              }}>
                {data!.attachments.map((a) => (
                  <figure key={a.id} className="card" style={{ margin: 0, padding: 0, overflow: 'hidden', position: 'relative' }}>
                    {a.signedUrl && (
                      <a href={a.signedUrl} target="_blank" rel="noreferrer">
                        <img
                          src={a.signedUrl}
                          alt={a.caption ?? a.file_name ?? 'Session image'}
                          loading="lazy"
                          style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                        />
                      </a>
                    )}
                    {a.caption && (
                      <figcaption style={{ fontSize: 11.5, color: 'var(--text-2)', padding: '7px 9px' }}>
                        {a.caption}
                      </figcaption>
                    )}
                    {isCoach && (
                      <button
                        onClick={() => deleteAttachment(a.id)}
                        aria-label="Remove image"
                        style={{
                          position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: '50%',
                          background: 'rgba(31,36,33,0.62)', color: '#fff', border: 'none', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </figure>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Videos ── */}
        {(data?.videos.length ?? 0) > 0 && (
          <Section icon="video" label={`Video (${data!.videos.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data!.videos.map((v) => v.signedUrl && (
                <div key={v.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <video controls preload="none" src={v.signedUrl} style={{ width: '100%', display: 'block', background: '#000' }} />
                  <div style={{ padding: '9px 13px', fontSize: 12.5, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.file_name ?? 'Video'}
                    </span>
                    {isCoach && (
                      <span className={v.shared_with_athlete ? 'badge badge-active' : 'badge badge-invited'} style={{ fontSize: 9.5 }}>
                        {v.shared_with_athlete ? 'Shared' : 'Private'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Transcript, last: reference material, not the headline ── */}
        {session.transcript && (
          <Section icon="text" label="Full transcript">
            <details className="card" style={{ padding: '12px 15px' }}>
              <summary style={{
                cursor: 'pointer', fontSize: 13, fontWeight: 700, color: 'var(--text-2)',
                listStyle: 'none', display: 'flex', alignItems: 'center', gap: 7,
              }}>
                Read what was recorded
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 500 }}>
                  {session.transcript.split(/\s+/).filter(Boolean).length} words
                </span>
              </summary>
              <div style={{
                marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-soft)',
                fontSize: 13.5, lineHeight: 1.75, color: 'var(--text-2)', whiteSpace: 'pre-wrap',
              }}>
                {session.transcript}
              </div>
            </details>
          </Section>
        )}
      </div>
    </div>
  )
}
