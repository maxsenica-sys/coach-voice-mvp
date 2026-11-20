'use client'

/* VideoUploader: add one or several videos to a session, from a phone or a
 * computer.
 *
 * Max, 2026-11-20: "i want the ability to select + upload multiple videos from
 * the iphone or other phone. Video load also failed".
 *
 * The button opens the phone's own picker with multi-select on. Every clip
 * picked gets a line that stays until it is saved or dismissed: waiting,
 * uploading with its own progress, saved, or what went wrong with a Retry.
 * Clips go one at a time, which is what a phone on mobile data can carry,
 * and more can be picked while one is uploading: they join the queue.
 *
 * The rules (what a retry does, what is remembered across a reload) are
 * lib/video-queue.ts; the three network steps are lib/video-upload.ts.
 *
 * While anything is uploading the root carries data-uploading, which
 * lib/app-update.ts counts as "something in progress", so the app never
 * reloads itself onto a new version in the middle of an upload.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { preflightVideo, formatBytes } from '@/lib/video-preflight'
import {
  planQueue, nextWaiting, isBusy, queueSummary, uploadFailureNote, type QueueItem,
} from '@/lib/video-queue'
import { uploadSessionVideo, finishSavedVideo, resumePendingVideos, SavedToStorageError } from '@/lib/video-upload'

interface Props<V> {
  sessionId: string
  /** Called once per video saved, with the row the server returned. */
  onSaved: (video: V) => void
  /** The trigger's label when idle. */
  label?: string
  /** Applied to the trigger, so it matches the buttons around it. */
  buttonStyle?: React.CSSProperties
  buttonClassName?: string
  icon?: React.ReactNode
  /** Called when the coach taps the trigger, before the picker opens. */
  onOpen?: () => void
}

const LINE = 'color-mix(in srgb, var(--text) 13%, transparent)'

let seq = 0

export default function VideoUploader<V = unknown>({ sessionId, onSaved, label = 'Add video', buttonStyle, buttonClassName, icon, onOpen }: Props<V>) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [notice, setNotice] = useState('')
  /* The File objects, by item id. Kept out of state: they are not rendered,
   * and a retry needs the same File the coach picked. */
  const filesRef = useRef(new Map<string, File>())
  const runningRef = useRef(false)
  const itemsRef = useRef<QueueItem[]>([])
  const onSavedRef = useRef(onSaved)
  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  useEffect(() => { itemsRef.current = items }, [items])

  const patch = useCallback((id: string, change: Partial<QueueItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...change } : i)))
  }, [])

  /* Work through the queue, one clip at a time. */
  const run = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    // Keep the screen awake while clips upload: a phone that locks pauses the
    // page, and the upload with it. Not every browser has it; none needs it.
    let lock: { release: () => Promise<void> } | null = null
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
      lock = (await nav.wakeLock?.request('screen')) ?? null
    } catch { lock = null }
    try {
      for (;;) {
        const next = nextWaiting(itemsRef.current)
        if (!next) break
        const file = filesRef.current.get(next.id)
        const mark = (change: Partial<QueueItem>) => {
          itemsRef.current = itemsRef.current.map((i) => (i.id === next.id ? { ...i, ...change } : i))
          patch(next.id, change)
        }
        // 'refused' offers no Retry: there is no file left to send
        if (!file) { mark({ status: 'refused', note: 'That clip is no longer available. Pick it again.' }); continue }
        mark({ status: 'uploading', pct: 0, eta: 'Preparing…' })
        try {
          const video = await uploadSessionVideo<V>(sessionId, file, {
            onProgress: (p) => mark({ pct: p.pct, eta: p.eta }),
            onSaving: () => mark({ status: 'saving', pct: 100, eta: 'Saving…' }),
          })
          mark({ status: 'done', pct: 100, eta: '' })
          filesRef.current.delete(next.id)
          onSavedRef.current(video)
        } catch (e: unknown) {
          const inStorage = e instanceof SavedToStorageError
          mark({ status: 'failed', eta: '', path: inStorage ? e.path : null, note: uploadFailureNote(e, inStorage) })
        }
      }
    } finally {
      runningRef.current = false
      try { await lock?.release() } catch { /* already released */ }
    }
    // More clips can be picked at any moment, including the instant the last
    // one finished. Anything that arrived while this pass was winding down
    // starts a new pass, so a clip is never left waiting with nothing running.
    if (nextWaiting(itemsRef.current)) void runRef.current()
  }, [sessionId, patch])
  const runRef = useRef(run)
  useEffect(() => { runRef.current = run }, [run])

  /* Picking is never blocked by an upload in progress (Max, 2026-11-20:
   * "the ability to select OTHER videos while one uploads"). New clips join
   * the end of the queue; the one being sent carries on. */
  const add = (picked: FileList | null) => {
    const files = Array.from(picked ?? [])
    if (files.length === 0) return
    const fresh = planQueue(files, (f) => preflightVideo(f), () => `v${++seq}`)
    fresh.forEach((item, i) => { if (item.status === 'waiting') filesRef.current.set(item.id, files[i]) })
    setNotice('')
    // set the ref with the state, so run() sees the new clips at once
    itemsRef.current = [...itemsRef.current, ...fresh]
    setItems(itemsRef.current)
    void run()
  }

  const retry = async (item: QueueItem) => {
    if (item.path) {
      // Already in storage: record it, without sending the file again.
      const file = filesRef.current.get(item.id)
      patch(item.id, { status: 'saving', eta: 'Saving…', note: '' })
      itemsRef.current = itemsRef.current.map((i) => (i.id === item.id ? { ...i, status: 'saving' } : i))
      try {
        const video = await finishSavedVideo<V>(sessionId, item.path, item.name, file?.type || 'video/mp4')
        patch(item.id, { status: 'done', eta: '' })
        itemsRef.current = itemsRef.current.map((i) => (i.id === item.id ? { ...i, status: 'done' } : i))
        filesRef.current.delete(item.id)
        onSavedRef.current(video)
      } catch (e: unknown) {
        patch(item.id, { status: 'failed', eta: '', note: uploadFailureNote(e, true) })
        itemsRef.current = itemsRef.current.map((i) => (i.id === item.id ? { ...i, status: 'failed' } : i))
      }
      return
    }
    itemsRef.current = itemsRef.current.map((i) => (i.id === item.id ? { ...i, status: 'waiting', note: '', pct: 0 } : i))
    setItems(itemsRef.current)
    void run()
  }

  const dismiss = (id: string) => {
    filesRef.current.delete(id)
    itemsRef.current = itemsRef.current.filter((i) => i.id !== id)
    setItems(itemsRef.current)
  }
  const clearFinished = () => {
    itemsRef.current = itemsRef.current.filter((i) => i.status !== 'done')
    setItems(itemsRef.current)
  }

  /* Finish anything an earlier visit left in storage without a row: the
   * connection died, the phone locked, or the page was reloaded. */
  useEffect(() => {
    let cancelled = false
    void resumePendingVideos<V>(sessionId).then(({ recovered, lost }) => {
      if (cancelled) return
      recovered.forEach((v) => onSavedRef.current(v))
      const parts: string[] = []
      if (recovered.length) parts.push(`${recovered.length === 1 ? 'A clip' : `${recovered.length} clips`} you uploaded earlier ${recovered.length === 1 ? 'has' : 'have'} now been saved.`)
      if (lost.length) parts.push(`${lost.length === 1 ? 'A clip' : `${lost.length} clips`} from earlier did not finish uploading: ${lost.join(', ')}. Pick ${lost.length === 1 ? 'it' : 'them'} again.`)
      if (parts.length) setNotice(parts.join(' '))
    })
    return () => { cancelled = true }
  }, [sessionId])

  const busy = isBusy(items)
  const finished = items.filter((i) => i.status === 'done').length

  return (
    // display: contents keeps the trigger in its row of buttons; the list
    // below takes a full line of that row (flex-basis: 100%).
    <span style={{ display: 'contents' }} {...(busy ? { 'data-uploading': '' } : {})}>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: 'none' }}
        // Cleared on every change, so picking the same clip again after a
        // failure still fires onChange.
        onChange={(e) => { const picked = e.target.files; add(picked); e.target.value = '' }}
      />
      <button
        type="button"
        className={buttonClassName}
        onClick={() => { onOpen?.(); inputRef.current?.click() }}
        // 44px is the floor for a tap target, whatever style the page passes
        style={{ minHeight: 44, ...buttonStyle, cursor: 'pointer' }}
      >
        {icon}{busy ? 'Add more' : label}
      </button>

      {(items.length > 0 || notice) && (
        <div style={{ flexBasis: '100%', width: '100%', minWidth: 0, display: 'grid', gap: 8, marginTop: 8 }}>
          {notice && (
            <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--wellness-ok-tint)', fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--text)' }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{notice}</span>
              <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" style={{ minWidth: 44, minHeight: 44, margin: '-10px -8px -10px 0', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--text-2)', flexShrink: 0 }}>×</button>
            </div>
          )}
          {items.length > 0 && (
            <div role="status" aria-live="polite" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 'var(--t-furniture)', fontWeight: 700, color: 'var(--text-2)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>{queueSummary(items)}</span>
              {!busy && finished > 0 && (
                <button type="button" onClick={clearFinished} style={{ minHeight: 44, padding: '0 10px', border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', color: 'var(--text-2)', textDecoration: 'underline' }}>Clear saved</button>
              )}
            </div>
          )}
          {items.map((item) => {
            const live = item.status === 'uploading' || item.status === 'saving'
            const bad = item.status === 'failed' || item.status === 'refused'
            const state =
              item.status === 'waiting' ? 'Waiting'
              : item.status === 'uploading' ? `${item.pct}%${item.eta ? ` · ${item.eta}` : ''}`
              : item.status === 'saving' ? 'Saving…'
              : item.status === 'done' ? 'Saved'
              : item.status === 'refused' ? 'Not uploaded'
              : 'Did not finish'
            return (
              <div key={item.id} style={{ border: `1px solid ${bad ? 'var(--danger)' : LINE}`, borderRadius: 12, padding: '10px 12px', background: bad ? 'var(--danger-light)' : 'transparent', minWidth: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, minWidth: 0 }}>
                  {/* The name wraps: a clipped file name is how two clips become indistinguishable. */}
                  <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: 'var(--t-body-tight)', fontWeight: 600, color: 'var(--text)', overflowWrap: 'anywhere' }}>
                    {item.name} <span style={{ fontWeight: 500, color: 'var(--text-2)' }}>· {formatBytes(item.size)}</span>
                  </span>
                  <span style={{ fontSize: 'var(--t-furniture)', fontWeight: 700, color: bad ? 'var(--danger)' : item.status === 'done' ? 'var(--primary)' : 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{state}</span>
                </div>
                {live && (
                  <div aria-hidden style={{ marginTop: 8, height: 6, borderRadius: 3, background: LINE, overflow: 'hidden' }}>
                    <div style={{ width: `${item.status === 'saving' ? 100 : item.pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 3, transition: 'width .25s linear' }} />
                  </div>
                )}
                {item.note && (
                  <p style={{ margin: '6px 0 0', fontSize: 'var(--t-furniture)', lineHeight: 1.5, color: 'var(--text)', overflowWrap: 'anywhere' }}>{item.note}</p>
                )}
                {bad && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {item.status === 'failed' && (
                      <button type="button" onClick={() => void retry(item)} style={{ minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: 'var(--on-primary)', fontWeight: 700, fontSize: 'var(--t-furniture)', cursor: 'pointer' }}>Retry</button>
                    )}
                    <button type="button" onClick={() => dismiss(item.id)} style={{ minHeight: 44, padding: '0 14px', borderRadius: 10, border: `1px solid ${LINE}`, background: 'transparent', color: 'var(--text)', fontWeight: 600, fontSize: 'var(--t-furniture)', cursor: 'pointer' }}>Dismiss</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </span>
  )
}
