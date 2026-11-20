'use client'

// app/components/VideoGrid.tsx
//
// A session's videos as small stills, three across a phone. Tapping one opens
// it, full width, under its own row.
//
// Max, 2026-11-20: "there is no preview. So the videos just look blank ... the
// videos are stacked one on top of each other. So I would much rather be the
// video preview and blocks of videos that are submitted are much smaller. So
// across the phone, you should see maybe 3 videos."
//
// Before this, every video was a full-width player, one under another: three
// clips were three screens of scrolling, and on an iPhone each was a blank
// rectangle until played (lib/video-preview.ts says why).
//
// Nothing is dropped to make it smaller (CLAUDE.md, "Never remove data"): a
// tile carries its still, its length and any marks the page gives it, and the
// file name, the tools and everything else are on the opened video.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GRID_COLUMNS, clipLength, openPanelAfter, previewSrc } from '@/lib/video-preview'

export interface GridVideo {
  id: string
  signedUrl: string | null
  file_name?: string | null
}

/** A short line under a tile: "Shared", "From Mia", "2 moments". */
export interface TileMark {
  text: string
  /** `on` for a state that is switched on (shared), `plain` for a fact. */
  tone?: 'on' | 'plain'
}

const SCRIM = 'color-mix(in srgb, black 62%, transparent)'

function Still({ video, name }: { video: GridVideo; name: string }) {
  const [failed, setFailed] = useState(false)
  const [length, setLength] = useState('')
  const src = video.signedUrl

  return (
    <span style={{
      position: 'relative', display: 'block', width: '100%', aspectRatio: '1 / 1',
      background: 'color-mix(in srgb, var(--bg), black 35%)', borderRadius: 10, overflow: 'hidden',
    }}>
      {/* Behind the still: what shows while it loads, and if it never does. */}
      <span aria-hidden style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: 6, color: 'var(--text-2)', textAlign: 'center',
      }}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" />
        </svg>
        {(failed || !src) && (
          <span style={{ fontSize: 'var(--t-furniture)', lineHeight: 1.25, overflowWrap: 'anywhere', minWidth: 0, maxWidth: '100%' }}>
            {src ? name : 'Could not be opened'}
          </span>
        )}
      </span>

      {src && !failed && (
        <video
          src={previewSrc(src)}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden
          onLoadedMetadata={(e) => {
            const el = e.currentTarget
            setLength(clipLength(el.duration))
            // Belt and braces for Safari: a seek on a clip that has never
            // played is the other thing that makes it paint a frame.
            if (el.currentTime < 0.05 && Number.isFinite(el.duration) && el.duration > 0.2) {
              try { el.currentTime = Math.min(0.1, el.duration / 2) } catch { /* the fragment already asked */ }
            }
          }}
          onError={() => setFailed(true)}
          // Never hidden until an event says it is ready: iOS does not promise
          // one before play, and a still gated on it would be blank again.
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }}
        />
      )}

      {length && !failed && (
        <span style={{
          position: 'absolute', right: 4, bottom: 4, padding: '1px 5px', borderRadius: 6,
          background: SCRIM, color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', lineHeight: 1.3,
        }}>
          {length}
        </span>
      )}
    </span>
  )
}

export default function VideoGrid<V extends GridVideo>({
  videos, openId, onOpen, marks, nameFor, renderOpen,
}: {
  videos: V[]
  /** The opened video, or null. Held by the page, so it can open one itself. */
  openId: string | null
  onOpen: (id: string | null) => void
  marks?: (video: V) => TileMark[]
  /** What a tile is called aloud, and what it shows if its still fails. */
  nameFor?: (video: V, index: number) => string
  /** The opened video: the player and its tools. */
  renderOpen: (video: V) => ReactNode
}) {
  const openIndex = videos.findIndex((v) => v.id === openId)
  const panelAfter = openPanelAfter(videos.length, openIndex)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Bring the opened video into view: on a phone it opens below the row, and
  // the row may be at the bottom of the screen.
  useEffect(() => {
    if (!openId) return
    const el = panelRef.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    // To the top, not "nearest": the player has no height until its video
    // loads, so "nearest" settles on a place the player then grows out of.
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [openId])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gap: 8, minWidth: 0 }}>
      {videos.map((v, i) => {
        const isOpen = v.id === openId
        const name = nameFor ? nameFor(v, i) : (v.file_name || `Video ${i + 1}`)
        const tileMarks = marks ? marks(v) : []
        return (
          <FragmentWithPanel
            key={v.id}
            panel={i === panelAfter && openIndex >= 0 ? (
              // scrollMarginTop clears the tallest sticky header in the app.
              <div ref={panelRef} style={{ gridColumn: '1 / -1', minWidth: 0, scrollMarginTop: 116 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => onOpen(null)}
                    style={{
                      minHeight: 44, padding: '0 4px 0 14px', background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-2)', font: 'inherit', fontSize: 'var(--t-body-tight)',
                    }}
                  >
                    Close video
                  </button>
                </div>
                {renderOpen(videos[openIndex])}
              </div>
            ) : null}
          >
            <button
              type="button"
              onClick={() => onOpen(isOpen ? null : v.id)}
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Close' : 'Open'} ${name}`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, padding: 3, margin: 0, alignSelf: 'start',
                background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer',
                borderRadius: 13,
                border: `2px solid ${isOpen ? 'var(--primary)' : 'transparent'}`,
              }}
            >
              <Still video={v} name={name} />
              {tileMarks.map((m) => (
                <span key={m.text} style={{
                  fontSize: 'var(--t-furniture)', lineHeight: 1.25, overflowWrap: 'anywhere', minWidth: 0,
                  color: m.tone === 'on' ? 'var(--primary)' : 'var(--text-2)', padding: '0 2px',
                }}>
                  {m.text}
                </span>
              ))}
            </button>
          </FragmentWithPanel>
        )
      })}
    </div>
  )
}

/** A tile, then the opened video when this tile ends its row. */
function FragmentWithPanel({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  return <>{children}{panel}</>
}
