'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { fmtTime, fmtDateDivider } from '@/lib/date-utils'

// ─── Types ──────────────────────────────────────────────────────────────────
interface Athlete {
  id: string
  first_name: string
  last_name: string
  email: string
  athlete_user_id: string | null
  status?: 'ACTIVE' | 'INVITED'
}

interface Message {
  id: string
  athlete_id: string
  sender_id: string
  sender_role: 'coach' | 'athlete'
  content: string | null
  msg_type: 'text' | 'image' | 'video' | 'audio'
  media_url: string | null
  media_name: string | null
  read_at: string | null
  created_at: string
}

interface Props {
  athletes: Athlete[]
  unreadCounts: Record<string, number>
  preselectedAthleteId?: string | null
  onUnreadChange?: (counts: Record<string, number>) => void
}

function initials(a: Athlete) {
  return `${a.first_name?.[0] ?? ''}${a.last_name?.[0] ?? ''}`.toUpperCase()
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function MessagingPanel({ athletes, unreadCounts, preselectedAthleteId, onUnreadChange }: Props) {
  // FIX 7: stable supabase client — prevent Realtime channel thrash on re-render
  const supabaseRef = useRef(createSupabaseBrowserClient())
  const supabase = supabaseRef.current

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(preselectedAthleteId ?? null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [localUnread, setLocalUnread] = useState<Record<string, number>>(unreadCounts)
  const [mediaUploading, setMediaUploading] = useState(false)
  const [recordingAudio, setRecordingAudio] = useState(false)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [msgError, setMsgError] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const selectedAthlete = athletes.find((a) => a.id === selectedId) ?? null

  // Update local unread counts when prop changes
  useEffect(() => { setLocalUnread(unreadCounts) }, [unreadCounts])

  // Pre-selection from parent
  useEffect(() => {
    if (preselectedAthleteId) setSelectedId(preselectedAthleteId)
  }, [preselectedAthleteId])

  // Load messages when athlete selected
  const loadMessages = useCallback(async (athleteId: string) => {
    setLoadingMsgs(true)
    setMsgError(null)
    try {
      const res = await fetch(`/api/messages?athlete_id=${athleteId}`)
      // FIX 6: handle non-ok responses instead of silently showing empty chat
      if (!res.ok) {
        setMsgError('Could not load messages. Try again.')
        return
      }
      const json = await res.json()
      setMessages(json.messages ?? [])
      // Clear unread for this athlete
      setLocalUnread((prev) => {
        const next = { ...prev, [athleteId]: 0 }
        onUnreadChange?.(next)
        return next
      })
    } catch {
      setMsgError('Could not load messages. Try again.')
    } finally {
      setLoadingMsgs(false)
    }
  }, [onUnreadChange])

  useEffect(() => {
    if (!selectedId) return
    loadMessages(selectedId)
  }, [selectedId, loadMessages])

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Realtime subscription
  useEffect(() => {
    if (!selectedId) return
    channelRef.current?.unsubscribe()

    const channel = supabase
      .channel(`messages-${selectedId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `athlete_id=eq.${selectedId}`,
      }, (payload) => {
        const msg = payload.new as Message
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev
          return [...prev, msg]
        })
        // FIX 8: increment unread badge for athletes not currently in view
        if (msg.athlete_id !== selectedId) {
          setLocalUnread((prev) => ({
            ...prev,
            [msg.athlete_id]: (prev[msg.athlete_id] ?? 0) + 1,
          }))
        }
      })
      .subscribe()

    channelRef.current = channel
    return () => { channel.unsubscribe() }
  }, [selectedId, supabase])

  // Send text message
  const sendText = async () => {
    if (!selectedId || !text.trim() || sending) return
    setSending(true)
    const content = text.trim()
    setText('')
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: selectedId, content, msg_type: 'text' }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.message) {
        // Optimistic update — add to local state immediately
        setMessages((prev) => {
          if (prev.some((m) => m.id === json.message.id)) return prev
          return [...prev, json.message]
        })
      } else if (!res.ok) {
        console.error('[MessagingPanel] send failed:', json?.error)
      }
    } catch (e) {
      console.error('[MessagingPanel] send error:', e)
    }
    setSending(false)
  }

  // Upload media file
  const uploadMedia = async (file: File, msgType: 'image' | 'video' | 'audio') => {
    if (!selectedId) return
    setMediaUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${user!.id}/${selectedId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('messages-media').upload(path, file)
      if (upErr) { alert('Upload failed: ' + upErr.message); return }

      // FIX 2: messages-media is a private bucket — use signed URL (1h TTL) instead of getPublicUrl
      const { data: signedData, error: signErr } = await supabase.storage.from('messages-media').createSignedUrl(path, 3600)
      if (signErr || !signedData?.signedUrl) { alert('Failed to get media URL'); return }
      const mediaUrl = signedData.signedUrl

      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: selectedId, content: null, msg_type: msgType, media_url: mediaUrl, media_name: file.name }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === json.message.id)) return prev
          return [...prev, json.message]
        })
      }
    } finally {
      setMediaUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio'
    uploadMedia(file, type as 'image' | 'video' | 'audio')
    e.target.value = ''
  }

  // Audio recording
  const startAudio = async () => {
    chunksRef.current = []
    // FIX 5: wrap in try/catch so mic denial doesn't cause unhandled rejection
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setMsgError('Microphone access denied. Please allow microphone access and try again.')
      return
    }
    streamRef.current = stream
    const rec = new MediaRecorder(stream)
    mediaRecRef.current = rec
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      setAudioBlob(blob)
      setAudioUrl(URL.createObjectURL(blob))
      stream.getTracks().forEach((t) => t.stop())
    }
    rec.start()
    setRecordingAudio(true)
  }

  const stopAudio = () => {
    mediaRecRef.current?.stop()
    setRecordingAudio(false)
  }

  const sendAudio = async () => {
    if (!audioBlob || !selectedId) return
    const file = new File([audioBlob], `voice-${Date.now()}.webm`, { type: 'audio/webm' })
    await uploadMedia(file, 'audio')
    setAudioBlob(null)
    setAudioUrl(null)
  }

  const discardAudio = () => {
    setAudioBlob(null)
    setAudioUrl(null)
    setRecordingAudio(false)
    mediaRecRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  // ─── Filtered athletes ─────────────────────────────────────────────────────
  const filtered = athletes.filter((a) => {
    const q = search.toLowerCase()
    return (
      a.first_name.toLowerCase().includes(q) ||
      a.last_name.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q)
    )
  })

  // ─── Date dividers ─────────────────────────────────────────────────────────
  const messagesWithDividers: ({ type: 'divider'; label: string; key: string } | { type: 'msg'; msg: Message })[] = []
  let lastDate = ''
  for (const msg of messages) {
    const dateStr = new Date(msg.created_at).toDateString()
    if (dateStr !== lastDate) {
      messagesWithDividers.push({ type: 'divider', label: fmtDateDivider(msg.created_at), key: `div-${dateStr}` })
      lastDate = dateStr
    }
    messagesWithDividers.push({ type: 'msg', msg })
  }

  // On mobile: show list when no athlete selected, show chat when one is selected
  const showList = !isMobile || !selectedId
  const showChat = !isMobile || !!selectedId

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* ── Athlete list ── */}
      <div style={{
        width: isMobile ? '100%' : 260,
        flexShrink: 0,
        borderRight: isMobile ? 'none' : '1px solid var(--border)',
        display: showList ? 'flex' : 'none',
        flexDirection: 'column',
        background: 'var(--card)',
      }}>
        <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--border-soft)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Messages</div>
          <input
            className="input"
            style={{ fontSize: 13, padding: '8px 12px' }}
            placeholder="Search athletes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No athletes found
            </div>
          )}
          {filtered.map((a) => {
            const unread = localUnread[a.id] ?? 0
            const active = a.id === selectedId
            return (
              <button
                key={a.id}
                onClick={() => { setSelectedId(a.id) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '11px 14px', border: 'none',
                  background: active ? 'var(--primary-light)' : 'transparent',
                  borderLeft: active ? '3px solid var(--primary)' : '3px solid transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  background: active ? 'var(--primary)' : 'var(--coach-color)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                }}>
                  {initials(a)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--primary)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.first_name} {a.last_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {a.status === 'ACTIVE' ? 'Active' : 'Invited'}
                  </div>
                </div>
                {unread > 0 && (
                  <div style={{
                    background: 'var(--primary)', color: '#fff', borderRadius: 99,
                    minWidth: 18, height: 18, fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                  }}>
                    {/* FIX 4: cap badge at 10+ */}
                    {unread > 10 ? '10+' : unread}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Chat panel ── */}
      <div style={{ flex: 1, display: showChat ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, background: '#f8fafc' }}>
        {!selectedAthlete ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 40 }}>💬</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Select an athlete to start messaging</div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: 'var(--card)',
              borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              {isMobile && (
                <button
                  onClick={() => setSelectedId(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, padding: '0 4px 0 0', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                  aria-label="Back to athlete list"
                >
                  ‹
                </button>
              )}
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                background: 'var(--coach-color)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>
                {initials(selectedAthlete)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedAthlete.first_name} {selectedAthlete.last_name}</div>
                {!isMobile && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedAthlete.email}</div>}
              </div>
            </div>

            {/* Messages area */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {loadingMsgs && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 20 }}>Loading…</div>
              )}
              {/* FIX 6: show error state instead of empty chat on fetch failure */}
              {!loadingMsgs && msgError && (
                <div style={{ textAlign: 'center', color: '#ef4444', fontSize: 13, padding: 40 }}>
                  {msgError}
                </div>
              )}
              {!loadingMsgs && !msgError && messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 40 }}>
                  No messages yet. Say hello!
                </div>
              )}

              {messagesWithDividers.map((item, i) => {
                if (item.type === 'divider') {
                  return (
                    <div key={item.key} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      margin: '14px 0 10px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                      {item.label}
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                  )
                }

                const { msg } = item
                const isCoach = msg.sender_role === 'coach'

                return (
                  <div key={msg.id} style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: isCoach ? 'flex-end' : 'flex-start',
                    marginBottom: 4,
                  }}>
                    <div style={{
                      maxWidth: '72%', padding: msg.msg_type === 'text' ? '9px 14px' : 6,
                      borderRadius: isCoach ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isCoach ? 'var(--coach-color)' : 'var(--card)',
                      color: isCoach ? '#fff' : 'var(--text)',
                      border: isCoach ? 'none' : '1px solid var(--border)',
                      boxShadow: 'var(--shadow-sm)',
                      fontSize: 14, lineHeight: 1.5,
                    }}>
                      {msg.msg_type === 'text' && <span>{msg.content}</span>}

                      {msg.msg_type === 'image' && msg.media_url && (
                        <img
                          src={msg.media_url}
                          alt={msg.media_name ?? 'image'}
                          style={{ maxWidth: 260, maxHeight: 220, borderRadius: 10, display: 'block', cursor: 'pointer' }}
                          onClick={() => window.open(msg.media_url!, '_blank')}
                        />
                      )}

                      {msg.msg_type === 'video' && msg.media_url && (
                        <video
                          src={msg.media_url}
                          controls
                          style={{ maxWidth: 300, maxHeight: 200, borderRadius: 10, display: 'block' }}
                        />
                      )}

                      {msg.msg_type === 'audio' && msg.media_url && (
                        <div style={{ padding: '6px 4px' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: isCoach ? 'rgba(255,255,255,0.8)' : 'var(--text-2)' }}>
                            🎤 Voice message
                          </div>
                          <audio controls src={msg.media_url} style={{ height: 36, width: 220 }} />
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, paddingLeft: isCoach ? 0 : 4, paddingRight: isCoach ? 4 : 0 }}>
                      {fmtTime(msg.created_at)}
                      {isCoach && msg.read_at && ' · Read'}
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Audio preview bar */}
            {(audioUrl || recordingAudio) && (
              <div style={{
                background: 'var(--coach-light)', borderTop: '1px solid var(--border)',
                padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
              }}>
                {recordingAudio ? (
                  <>
                    <span style={{ color: '#ef4444', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="recording-dot" /> Recording…
                    </span>
                    <button className="btn btn-danger" style={{ padding: '6px 14px', fontSize: 13 }} onClick={stopAudio}>Stop</button>
                    <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }} onClick={discardAudio}>Cancel</button>
                  </>
                ) : (
                  <>
                    <audio controls src={audioUrl!} style={{ height: 32, flex: 1 }} />
                    <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: 13 }} onClick={sendAudio} disabled={mediaUploading}>
                      {mediaUploading ? 'Sending…' : 'Send'}
                    </button>
                    <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 13 }} onClick={discardAudio}>Discard</button>
                  </>
                )}
              </div>
            )}

            {/* Input bar */}
            <div style={{
              display: 'flex', alignItems: 'flex-end', gap: 8,
              padding: '12px 16px', background: 'var(--card)',
              borderTop: '1px solid var(--border)', flexShrink: 0,
            }}>
              {/* Attach media */}
              <button
                title="Send photo or video"
                onClick={() => fileInputRef.current?.click()}
                disabled={mediaUploading || recordingAudio}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)',
                  background: 'transparent', cursor: 'pointer', fontSize: 18, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  opacity: mediaUploading || recordingAudio ? 0.4 : 1,
                }}
              >
                📎
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              {/* Voice record */}
              <button
                title={recordingAudio ? 'Stop recording' : 'Record voice message'}
                onClick={recordingAudio ? stopAudio : startAudio}
                disabled={mediaUploading || !!audioUrl}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)',
                  background: recordingAudio ? '#fef2f2' : 'transparent',
                  cursor: 'pointer', fontSize: 18, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  opacity: mediaUploading || !!audioUrl ? 0.4 : 1,
                  transition: 'all 0.1s',
                }}
              >
                🎤
              </button>

              {/* Text input */}
              <textarea
                style={{
                  flex: 1, resize: 'none', borderRadius: 18, border: '1px solid var(--border)',
                  padding: '9px 14px', fontSize: 14, lineHeight: 1.4, minHeight: 38, maxHeight: 120,
                  background: 'var(--bg)', outline: 'none', fontFamily: 'inherit',
                }}
                placeholder={mediaUploading ? 'Uploading…' : 'Type a message…'}
                value={text}
                onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() } }}
                disabled={mediaUploading || recordingAudio || !!audioUrl}
                rows={1}
              />

              {/* Send button */}
              <button
                onClick={sendText}
                disabled={!text.trim() || sending || mediaUploading || recordingAudio || !!audioUrl}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none',
                  background: text.trim() ? 'var(--primary)' : 'var(--border)',
                  color: '#fff', cursor: text.trim() ? 'pointer' : 'not-allowed',
                  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all 0.15s',
                }}
              >
                ↑
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
