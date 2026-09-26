'use client'

/**
 * Two videos of one athlete, side by side, on one clock.
 *
 * The coach picks two recordings — the same drill a month apart — and plays
 * them together. A is the master: one play button, one scrubber, and B follows
 * at A + offset. The offset is how the coach lines up the moment that matters
 * (the plant, the release) when one recording started three seconds earlier
 * than the other: pause, nudge B until the frames match, play.
 *
 * Stacked on a phone, side by side from 640px. Below that two 16:9 videos next
 * to each other are each ~150px wide, which is too small to see a wrist in —
 * and the page must never scroll sideways (CLAUDE.md).
 *
 * The time arithmetic is lib/video-clip.ts, where tools/video-rig.mjs holds it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampOffset, compareTimeForB, formatClipTime, needsResync, offsetFromPositions,
} from '@/lib/video-clip'

export type CompareVideo = {
  id: string
  signedUrl: string | null
  /** What the coach picks by: the session name or "Sent by Mia". */
  label: string
  /** The date, in the coach's words. */
  sublabel?: string | null
}

type Props = {
  videos: CompareVideo[]
  initialA?: string
  initialB?: string
}

const LINE = 'color-mix(in srgb, var(--text) 11%, transparent)'
const LINE_2 = 'color-mix(in srgb, var(--text) 19%, transparent)'
const PANEL = 'color-mix(in srgb, var(--text) 4.5%, transparent)'
const STAGE_FLOOR = 'color-mix(in srgb, var(--bg), black 35%)'

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: 44, minWidth: 44, padding: '0 12px', borderRadius: 11,
  border: `1px solid ${LINE_2}`, background: PANEL, color: 'var(--text)',
  fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
  letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap',
}
const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'var(--t-furniture)',
  letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-2)',
}
const selectStyle: React.CSSProperties = {
  width: '100%', minWidth: 0, minHeight: 44, borderRadius: 11, border: `1px solid ${LINE_2}`,
  background: PANEL, color: 'var(--text)', padding: '0 10px', font: 'inherit', fontSize: 16,
}

const SPEEDS = [0.25, 0.5, 1]

function signed(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}s`
}

export default function VideoCompare({ videos, initialA, initialB }: Props) {
  const playable = videos.filter((v) => v.signedUrl)
  const [aId, setAId] = useState(() => initialA && playable.some((v) => v.id === initialA) ? initialA : playable[0]?.id ?? '')
  const [bId, setBId] = useState(() => {
    if (initialB && initialB !== aId && playable.some((v) => v.id === initialB)) return initialB
    return playable.find((v) => v.id !== (initialA ?? playable[0]?.id))?.id ?? ''
  })
  const a = playable.find((v) => v.id === aId) ?? null
  const b = playable.find((v) => v.id === bId) ?? null

  const aRef = useRef<HTMLVideoElement>(null)
  const bRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [offset, setOffset] = useState(0)
  const offsetRef = useRef(0)
  useEffect(() => { offsetRef.current = offset }, [offset])
  const [aTime, setATime] = useState(0)
  const [bTime, setBTime] = useState(0)
  const [aDur, setADur] = useState(0)
  const [speed, setSpeed] = useState(1)

  /** Put B where it belongs for A's current frame. */
  const alignB = useCallback(() => {
    const av = aRef.current, bv = bRef.current
    if (!av || !bv) return
    const target = compareTimeForB(av.currentTime, offsetRef.current, bv.duration)
    if (Math.abs(bv.currentTime - target) > 0.02) bv.currentTime = target
  }, [])

  useEffect(() => {
    for (const v of [aRef.current, bRef.current]) if (v) v.playbackRate = speed
  }, [speed, aId, bId])

  // The clock. While playing, B is corrected whenever it drifts past the
  // allowance; otherwise the readouts just follow the elements.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const av = aRef.current, bv = bRef.current
      if (av && bv) {
        if (playing) {
          if (needsResync(av.currentTime, bv.currentTime, offsetRef.current, bv.duration)) alignB()
          if (av.ended || (Number.isFinite(av.duration) && av.currentTime >= av.duration)) {
            av.pause(); bv.pause(); setPlaying(false)
          }
        }
        setATime(av.currentTime)
        setBTime(bv.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, alignB])

  const play = async () => {
    const av = aRef.current, bv = bRef.current
    if (!av || !bv) return
    alignB()
    try {
      await Promise.all([av.play(), bv.play()])
      setPlaying(true)
    } catch {
      av.pause(); bv.pause(); setPlaying(false)
    }
  }
  const pause = () => {
    aRef.current?.pause(); bRef.current?.pause()
    setPlaying(false)
    alignB()
  }
  const seekA = (t: number) => {
    const av = aRef.current
    if (!av) return
    av.currentTime = Math.max(0, Math.min(t, Number.isFinite(av.duration) ? av.duration : t))
    alignB()
  }
  const nudge = (delta: number) => {
    const next = clampOffset(offsetRef.current + delta)
    offsetRef.current = next
    setOffset(next)
    alignB()
  }

  if (playable.length < 2) {
    return (
      <div style={{ padding: 14, borderRadius: 14, border: `1px solid ${LINE}`, background: PANEL, fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--text-2)' }}>
        Compare needs two videos of this athlete. {playable.length === 1 ? 'There is one so far' : 'There are none yet'} —
        add videos to their sessions, or ask them to send you a clip, and they will appear here.
      </div>
    )
  }

  // A new pair: stop, and start from a clean line-up.
  function choose(which: 'A' | 'B', id: string) {
    aRef.current?.pause(); bRef.current?.pause()
    setPlaying(false)
    offsetRef.current = 0
    setOffset(0)
    if (which === 'A') setAId(id)
    else setBId(id)
  }

  const pick = (which: 'A' | 'B', value: string, other: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={eyebrow}>Video {which}</span>
      <select value={value} onChange={(e) => choose(which, e.target.value)} style={selectStyle}>
        {playable.map((v) => (
          <option key={v.id} value={v.id} disabled={v.id === other}>
            {v.sublabel ? `${v.sublabel} · ${v.label}` : v.label}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <style>{`
        .cv-compare-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
        @media (min-width: 640px) { .cv-compare-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
      `}</style>

      <div className="cv-compare-grid">
        {pick('A', aId, bId)}
        {pick('B', bId, aId)}
      </div>

      <div className="cv-compare-grid">
        {[{ v: a, ref: aRef, tag: 'A', t: aTime }, { v: b, ref: bRef, tag: 'B', t: bTime }].map(({ v, ref, tag, t }) => (
          <figure key={tag} style={{ margin: 0, minWidth: 0, borderRadius: 12, overflow: 'hidden', background: STAGE_FLOOR, border: `1px solid ${LINE}` }}>
            {v?.signedUrl && (
              <video
                key={v.id}
                ref={ref}
                src={v.signedUrl}
                preload="metadata"
                playsInline
                /* B is muted: two soundtracks a second apart are noise. */
                muted={tag === 'B'}
                onLoadedMetadata={tag === 'A' ? (e) => setADur(e.currentTarget.duration) : () => alignB()}
                onClick={() => (playing ? pause() : void play())}
                style={{ width: '100%', display: 'block', maxHeight: 360, background: STAGE_FLOOR }}
              />
            )}
            <figcaption style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', padding: '8px 10px', minWidth: 0 }}>
              <span style={{ ...eyebrow, color: 'var(--text)' }}>{tag}</span>
              <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 'var(--t-body-tight)', color: 'var(--text-2)', overflowWrap: 'anywhere' }}>
                {v?.sublabel ? `${v.sublabel} · ` : ''}{v?.label}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-data)', color: 'var(--text-2)' }}>{formatClipTime(t)}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Transport: one play for both, one scrubber on A. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 16, border: `1px solid ${LINE}`, background: PANEL, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => (playing ? pause() : void play())} style={{ ...btn, background: 'var(--coach-on-light)', color: 'var(--on-primary)', border: 'none', minWidth: 88 }} aria-label={playing ? 'Pause both' : 'Play both'}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => seekA(aTime - 0.1)} style={btn} aria-label="Back a tenth of a second">−0.1s</button>
          <button onClick={() => seekA(aTime + 0.1)} style={btn} aria-label="Forward a tenth of a second">+0.1s</button>
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }} role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} onClick={() => setSpeed(s)} aria-pressed={speed === s}
                style={{ ...btn, padding: '0 10px', background: speed === s ? 'color-mix(in srgb, var(--text) 12%, transparent)' : PANEL, borderColor: speed === s ? 'var(--text-2)' : LINE_2 }}>
                {s}×
              </button>
            ))}
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={aDur > 0 ? aDur : 0}
          step={0.1}
          value={Math.min(aTime, aDur || 0)}
          onChange={(e) => seekA(Number(e.target.value))}
          aria-label="Position in video A"
          style={{ width: '100%', minWidth: 0, minHeight: 44, accentColor: 'var(--coach-on-light)' }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
          <span style={{ ...eyebrow, flex: '1 1 100%' }}>
            Line up — B runs <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', color: 'var(--text)' }}>{signed(offset)}</span> from A
          </span>
          <button onClick={() => nudge(-1)} style={btn} aria-label="Move B back one second">B −1s</button>
          <button onClick={() => nudge(-0.1)} style={btn} aria-label="Move B back a tenth">B −0.1s</button>
          <button onClick={() => nudge(0.1)} style={btn} aria-label="Move B forward a tenth">B +0.1s</button>
          <button onClick={() => nudge(1)} style={btn} aria-label="Move B forward one second">B +1s</button>
          <button onClick={() => { offsetRef.current = 0; setOffset(0); alignB() }} disabled={offset === 0}
            style={{ ...btn, opacity: offset === 0 ? 0.5 : 1, cursor: offset === 0 ? 'not-allowed' : 'pointer' }}>
            Reset
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--text-2)' }}>
          Pause on the moment in A, then move B until the two frames match. They play together from there.
          {' '}Current gap: {signed(offsetFromPositions(aTime, bTime))}.
        </p>
      </div>
    </div>
  )
}
