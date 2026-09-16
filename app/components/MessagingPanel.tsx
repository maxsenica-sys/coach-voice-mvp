'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { apiJson } from '@/lib/api-client'
import { SUPPORTED_RECORDING_TYPES } from '@/lib/audio-mime'
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
  /** Signed by the API on every read from `media_path`. Never persisted. */
  media_url: string | null
  /** The durable storage key. See migration 024. */
  media_path?: string | null
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

  /* Whether this device has no Shift key to hold.
   *
   * Deliberately a pointer-capability query rather than a width check: a
   * tablet with a keyboard is wide AND touch, and an iPad user with a Magic
   * Keyboard should still get Enter-to-send. `coarse` means the primary
   * pointer is a finger. */
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

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
  // Kept separate from msgError: one is "this thread would not load", the
  // other is "what you just typed did not go". They appear in different places
  // and a load failure must not wipe an unsent draft's error.
  const [sendError, setSendError] = useState<string | null>(null)

  const [coachId, setCoachId] = useState<string | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const unreadChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const onUnreadChangeRef = useRef(onUnreadChange)
  useEffect(() => { onUnreadChangeRef.current = onUnreadChange }, [onUnreadChange])

  // Fetch coach identity once on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCoachId(user.id)
    })
  }, [supabase])

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
        onUnreadChangeRef.current?.(next)
        return next
      })
    } catch {
      setMsgError('Could not load messages. Try again.')
    } finally {
      setLoadingMsgs(false)
    }
  }, [])

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
        // Mark inbound messages read immediately without awaiting.
        //
        // This used to call GET, which re-downloads the whole conversation —
        // up to 300 rows and a freshly minted signed URL for every piece of
        // media in it — solely to trigger the read-marking side effect inside
        // that handler. One inbound message, one full thread transfer. PATCH
        // does the write and nothing else.
        if (msg.sender_role === 'athlete' && !msg.read_at) {
          fetch(`/api/messages?athlete_id=${selectedId}`, { method: 'PATCH' }).catch(() => null)
        }
      })
      .subscribe()

    channelRef.current = channel
    return () => { channel.unsubscribe() }
  }, [selectedId, supabase])

  // Second channel: listen to ALL new messages for this coach — used solely for badge counting
  useEffect(() => {
    if (!coachId) return
    unreadChannelRef.current?.unsubscribe()

    const unreadChannel = supabase
      .channel('all-messages-unread')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `coach_id=eq.${coachId}`,
      }, (payload) => {
        const msg = payload.new as { athlete_id: string; sender_role: string }
        // Only count inbound athlete messages for athletes not currently open
        if (msg.sender_role === 'athlete' && msg.athlete_id !== selectedId) {
          setLocalUnread((prev) => ({
            ...prev,
            [msg.athlete_id]: (prev[msg.athlete_id] ?? 0) + 1,
          }))
        }
      })
      .subscribe()

    unreadChannelRef.current = unreadChannel
    return () => { unreadChannel.unsubscribe() }
  }, [coachId, selectedId, supabase])

  // Send text message
  /* A message that does not send must never look like one that did.
   *
   * This used to clear the textarea first and then, on any failure, write to
   * console.error and stop. The coach saw an empty box and an empty thread and
   * had every reason to believe they had sent something. On the only channel in
   * the product whose entire purpose is one person telling another person
   * something, a lost message is the worst possible failure, and it was silent.
   *
   * The comment that sat here said "Optimistic update — add to local state
   * immediately" and was positioned AFTER the await, so it was neither
   * optimistic nor immediate. Genuine optimism is not safe here either: the
   * send can fail, and a bubble that appears and then vanishes is worse than a
   * brief wait. So the rule is the honest one — the draft is held until the
   * server confirms, and handed back with the reason if it does not.
   */
  const sendText = async () => {
    if (!selectedId || !text.trim() || sending) return
    setSending(true)
    setSendError(null)
    const content = text.trim()
    try {
      const json = await apiJson<{ message?: Message }>('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: selectedId, content, msg_type: 'text' }),
      })
      if (!json.message) throw new Error('The message did not save. Try again.')
      setMessages((prev) => (prev.some((m) => m.id === json.message!.id) ? prev : [...prev, json.message!]))
      setText('')
    } catch (e) {
      // The draft stays exactly where the coach left it.
      setSendError(e instanceof Error ? e.message : 'Could not send. Try again.')
    } finally {
      setSending(false)
    }
  }

  // Upload media file
  /** Returns true only if the message was actually saved. */
  const uploadMedia = async (file: File, msgType: 'image' | 'video' | 'audio'): Promise<boolean> => {
    if (!selectedId) return false
    setMediaUploading(true)
    setSendError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Your session has expired. Sign in again and retry.')
      const ext = file.name.split('.').pop() ?? 'bin'
      // First segment is the uploader's auth id — that is what the
      // messages-media storage policy scopes on (migration 023).
      const path = `${user.id}/${selectedId}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('messages-media').upload(path, file)
      if (upErr) throw new Error(`Could not upload that file — ${upErr.message}`)

      // Send the PATH, never a URL. A signed URL expires in an hour and cannot
      // be re-derived from itself, so persisting one made every photo and voice
      // note in the thread a dead link an hour after sending, with the object
      // left unreachable and still billed. The API signs the path on read
      // instead, fresh every request. See migration 024.
      const json = await apiJson<{ message?: Message }>('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: selectedId, content: null, msg_type: msgType, media_path: path, media_name: file.name }),
      })
      if (!json.message) throw new Error('The file uploaded but the message did not save. Try again.')
      const saved = json.message
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]))
      return true
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not send that file. Try again.')
      return false
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
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : ''
      setMsgError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access denied. Allow microphone access for this site and try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Check that one is connected, then try again.'
            : name === 'NotReadableError'
              ? 'Another app is using the microphone. Close it and try again.'
              : 'Could not start recording. Reload the page and try again.',
      )
      return
    }
    streamRef.current = stream
    // mp4/AAC first: iOS Safari cannot decode WebM at all, so a WebM recording
    // made in Chrome played back as an endless spinner on an iPhone. Every
    // browser that can play WebM can also play mp4, so preferring it makes a
    // recording playable everywhere. isTypeSupported still guards the choice,
    // and WebM stays as the fallback for browsers that can't record mp4.
    // The list and its order live in lib/audio-mime.ts, which exists precisely
    // so the four capture sites cannot drift apart. This one re-declared it
    // inline — identical today, and one edit away from not being. The order is
    // load-bearing and unchanged.
    const mimeType = SUPPORTED_RECORDING_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? ''
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {})
    mediaRecRef.current = rec
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const actualMime = rec.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: actualMime })
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
    const ext = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm'
    const file = new File([audioBlob], `voice-${Date.now()}.${ext}`, { type: audioBlob.type || 'audio/webm' })
    const sent = await uploadMedia(file, 'audio')
    // Only discard the recording once it is safely sent. This used to clear
    // unconditionally, so a failed upload destroyed the only copy of a voice
    // note the coach had just spoken, with nothing on screen to say so.
    if (!sent) return
    if (audioUrl) URL.revokeObjectURL(audioUrl)
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
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
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
                <div style={{ textAlign: 'center', color: 'var(--danger)', fontSize: 13, padding: 40 }}>
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
                    <span style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
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

            {/* A failed send says so, above the box still holding the draft. */}
            {sendError && (
              <div
                role="alert"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 16px', background: 'var(--danger-light)',
                  borderTop: '1px solid var(--border)', flexShrink: 0,
                  fontSize: 14, color: 'var(--text)', lineHeight: 1.4,
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>⚠</span>
                <span style={{ flex: 1, overflowWrap: 'anywhere' }}>
                  {sendError} <strong>Your message has not been sent.</strong>
                </span>
                <button
                  onClick={() => setSendError(null)}
                  aria-label="Dismiss"
                  style={{
                    minWidth: 44, minHeight: 44, border: 'none', background: 'transparent',
                    cursor: 'pointer', fontSize: 18, color: 'var(--text-2)', flexShrink: 0,
                  }}
                >
                  ×
                </button>
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
                /* Enter sends on a keyboard, where Shift+Enter gives a line
                 * break. On a phone there is no Shift, so Enter-to-send made a
                 * paragraph break physically impossible — and `enterKeyHint`
                 * was unset, so the key did not even say what it would do.
                 *
                 * On touch the key now reads "enter" and inserts a newline; the
                 * send button is right there and is the obvious way to send.
                 * On a keyboard nothing changes. */
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return
                  if (isTouch) return
                  e.preventDefault()
                  sendText()
                }}
                enterKeyHint={isTouch ? 'enter' : 'send'}
                autoCapitalize="sentences"
                autoCorrect="on"
                spellCheck
                maxLength={4000}
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
