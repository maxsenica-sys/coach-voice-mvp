'use client'

import { useEffect, useState } from 'react'
import BrandMark from './BrandMark'
import {
  INSTALL_KEY, NUDGE_KEY, SNOOZE_MS, isIosDevice, shouldShowReinstallNudge,
} from '@/lib/reinstall-nudge'
import { checkinQueueSupported, listCheckins } from '@/lib/checkin-queue'
import { queueSupported, listRecordings } from '@/lib/recording-queue'

/**
 * The one-time "get the new icon" card for iPhones that installed the app as
 * CoachVoice. Who sees it and why is lib/reinstall-nudge.ts. `?nudge=1` shows
 * it anywhere, so it can be checked without an old install.
 */
export default function ReinstallNudge() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (new URLSearchParams(location.search).get('nudge') === '1') { setShow(true); return }
        const nav = navigator as Navigator & { standalone?: boolean }
        const isIos = isIosDevice(nav.userAgent, nav.platform ?? '', nav.maxTouchPoints ?? 0)
        const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
        let install: string | null = null
        let nudge: string | null = null
        try { install = localStorage.getItem(INSTALL_KEY); nudge = localStorage.getItem(NUDGE_KEY) } catch { return }
        // Cheap checks first; only open the queues for someone who could be asked.
        if (!shouldShowReinstallNudge({ isIos, standalone, install, nudge, pending: 0, now: Date.now() })) return
        const [checkins, recordings] = await Promise.all([
          checkinQueueSupported() ? listCheckins() : Promise.resolve([]),
          queueSupported() ? listRecordings() : Promise.resolve([]),
        ])
        const pending = checkins.filter((c) => c.status === 'queued').length + recordings.length
        if (!cancelled && shouldShowReinstallNudge({ isIos, standalone, install, nudge, pending, now: Date.now() })) setShow(true)
      } catch {
        // Anything unexpected: say nothing. Never ask someone to delete the
        // app on a guess.
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!show) return null

  const close = (value: string) => {
    try { localStorage.setItem(NUDGE_KEY, value) } catch { /* the card still goes */ }
    setShow(false)
  }
  const site = typeof location !== 'undefined' ? location.host : 'the Pindar website'

  return (
    <section aria-labelledby="pindar-nudge-title" style={{
      marginBottom: 16, padding: 16, borderRadius: 16,
      background: 'var(--card)', border: '1px solid var(--line-2)', color: 'var(--text)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div aria-hidden style={{
          width: 44, height: 44, borderRadius: 12, flex: 'none',
          background: 'linear-gradient(135deg, #6F8E6B 0%, #4F6B4B 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BrandMark size={32} color="#FBF6EA" />
        </div>
        <h2 id="pindar-nudge-title" style={{ margin: 0, fontSize: 'var(--t-body)', fontWeight: 800, lineHeight: 1.3 }}>
          Get the new Pindar icon
        </h2>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 'var(--t-body-tight)', lineHeight: 1.5, color: 'var(--text-2)' }}>
        CoachVoice is now Pindar. Your Home Screen still shows the old icon, and an iPhone only
        swaps it if you add the app again. Nothing you have sent is lost: it is all saved to your account.
      </p>
      <ol style={{ margin: '0 0 14px', paddingLeft: 22, listStyle: 'decimal', fontSize: 'var(--t-body-tight)', lineHeight: 1.55, color: 'var(--text-2)' }}>
        <li>Press and hold the old CoachVoice icon on your Home Screen and delete it.</li>
        <li>Open Safari and go to <strong style={{ color: 'var(--text)', overflowWrap: 'anywhere' }}>{site}</strong>.</li>
        <li>Tap Share, then Add to Home Screen.</li>
        <li>Open Pindar and sign in. If you use notifications, turn them back on.</li>
      </ol>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => close('done')} className="btn btn-primary"
          style={{ minHeight: 44, padding: '0 18px', flex: '1 1 120px' }}>
          Got it
        </button>
        <button type="button" onClick={() => close(String(Date.now() + SNOOZE_MS))} className="btn btn-ghost"
          style={{ minHeight: 44, padding: '0 18px', flex: '1 1 120px' }}>
          Remind me later
        </button>
      </div>
    </section>
  )
}
