'use client'

/**
 * The coach's invite code as a QR code, for holding up at training.
 *
 * It encodes `${origin}/signup?code=<code>`, so a phone camera opens sign-up
 * with the code filled in and the athlete role chosen — no typing a code off a
 * screen across a hall.
 *
 * ── Why the colours are literal ─────────────────────────────────────────
 *
 * Everything else in the app takes its colours from app/globals.css, and those
 * tokens flip with the theme. A QR code must not: scanners expect dark modules
 * on a light field, and an inverted code on the ink UI is one many phone
 * cameras will not read. So the tile is `white` and the modules are `black`,
 * CSS keywords rather than tokens, on purpose.
 *
 * The four-module quiet zone is part of the SVG itself, not padding around it,
 * so no parent style can eat into it.
 */

import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'

/** Modules of white border the QR spec requires around the symbol. */
export const QR_QUIET_ZONE = 4

/** The link a scanned code opens. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/signup?code=${encodeURIComponent(code)}`
}

function useQr(text: string) {
  return useMemo(() => {
    // Type 0 picks the smallest version that fits; M recovers ~15% damage,
    // which covers glare on a phone screen held up outdoors.
    const qr = qrcode(0, 'M')
    qr.addData(text, 'Byte')
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + QR_QUIET_ZONE} ${r + QR_QUIET_ZONE}h1v1h-1z`
      }
    }
    return { modules: n, path: d }
  }, [text])
}

export function QrSvg({ text, label }: { text: string; label: string }) {
  const { modules, path } = useQr(text)
  const size = modules + QR_QUIET_ZONE * 2
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-qr-modules={modules}
      data-qr-quiet={QR_QUIET_ZONE}
      data-qr-text={text}
      style={{ display: 'block', width: '100%', height: 'auto', background: 'white' }}
    >
      <rect x="0" y="0" width={size} height={size} fill="white" />
      <path d={path} fill="black" />
    </svg>
  )
}

type WakeLockLike = { release: () => Promise<void> }

/**
 * A dialog with the QR, the code under it, and a Full screen mode. In full
 * screen the display is kept awake where the browser supports it, and nothing
 * happens where it does not.
 */
export default function InviteQR({ code, onClose }: { code: string; onClose: () => void }) {
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  // Only ever mounted after a tap, so there is no server render to disagree with.
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const url = origin ? inviteLink(origin, code) : ''

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (full) setFull(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full, onClose])

  // Keep the screen on while the code is being held up. The lock is dropped by
  // the browser whenever the page is hidden, so it is asked for again on
  // return. Any failure — no API, no permission, low battery — is silent.
  useEffect(() => {
    if (!full) return
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }
    if (!nav.wakeLock) return
    let lock: WakeLockLike | null = null
    let live = true
    const acquire = () => {
      nav.wakeLock?.request('screen')
        .then((l) => { if (live) lock = l; else void l.release().catch(() => {}) })
        .catch(() => {})
    }
    const onVis = () => { if (document.visibilityState === 'visible') acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVis)
      void lock?.release().catch(() => {})
    }
  }, [full])

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied('done') } catch { setCopied('failed') }
  }

  if (!url) return null

  if (full) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Invite QR code, full screen" data-qr-view="full"
        style={{ position: 'fixed', inset: 0, zIndex: 420, background: 'var(--bg)', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))' }}>
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setFull(false)} className="btn btn-ghost" style={{ minHeight: 44 }}>Exit full screen</button>
        </div>
        <div style={{ margin: 'auto 0', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '8px 0' }}>
          <div style={{ fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 'clamp(18px, 5vw, 28px)', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text)', textAlign: 'center' }}>Scan to join</div>
          <div style={{ width: 'min(100%, 72vh, 640px)', borderRadius: 16, overflow: 'hidden' }}>
            <QrSvg text={url} label={`QR code to join with invite code ${code}`} />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'clamp(24px, 8vw, 48px)', letterSpacing: '.12em', color: 'var(--text)', textAlign: 'center', overflowWrap: 'anywhere', maxWidth: '100%' }}>{code}</div>
          <div style={{ fontSize: 'var(--t-body)', color: 'var(--text-2)', textAlign: 'center', maxWidth: 420 }}>Point your phone camera at the code. It opens sign-up with this code filled in.</div>
        </div>
      </div>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Invite QR code" data-qr-view="sheet"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 410, background: 'color-mix(in srgb, black 55%, transparent)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', overflowX: 'hidden', padding: '16px 16px calc(16px + env(safe-area-inset-bottom))' }}>
      <div className="card-lg" style={{ width: '100%', maxWidth: 400, minWidth: 0, padding: '14px 16px 16px', margin: 'auto 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-cast)', fontWeight: 700, fontSize: 19, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text)' }}>Scan to join</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, marginRight: -8, background: 'none', border: 'none', color: 'var(--text-2)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ width: 'min(100%, 320px)', margin: '10px auto 0', borderRadius: 14, overflow: 'hidden' }}>
          <QrSvg text={url} label={`QR code to join with invite code ${code}`} />
        </div>
        <div style={{ marginTop: 12, textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 24, letterSpacing: '.12em', color: 'var(--text)', overflowWrap: 'anywhere' }}>{code}</div>
        <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 'var(--t-body-tight)', lineHeight: 1.45, color: 'var(--text-2)' }}>
          An athlete points their phone camera at this. Sign-up opens with your code filled in.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setFull(true)} className="btn btn-primary" style={{ flex: '2 1 150px', minHeight: 48 }}>Full screen</button>
          <button type="button" onClick={() => void copy()} className="btn btn-ghost" style={{ flex: '1 1 110px', minHeight: 48 }}>
            {copied === 'done' ? 'Link copied' : 'Copy link'}
          </button>
        </div>
        {copied === 'failed' && (
          <p role="alert" style={{ margin: '8px 0 0', fontSize: 'var(--t-furniture)', fontWeight: 600, color: 'var(--danger)', overflowWrap: 'anywhere' }}>
            Could not copy. The link is {url}
          </p>
        )}
      </div>
    </div>
  )
}
