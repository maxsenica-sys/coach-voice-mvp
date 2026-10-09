'use client'

/**
 * The opening on `/`: a coach's voice becomes the wreath, then "Pindar" and
 * "Hear it. Own it." The same picture as the cold-start shell in
 * app/layout.tsx and the iOS launch images; all three come from lib/opening.ts.
 *
 * Max chose it on 2026-10-09 from five mock-ups ("Voice Becomes the Wreath …
 * my favourite by a long shot"). The others, and the earlier waveform-into-mic
 * and sport-silhouette directions, are not kept in this repo — see the note on
 * prototypes in CLAUDE.md.
 *
 * ── How it plays ───────────────────────────────────────────────────────────
 *
 * It is CSS, not an effect. The animation rules live in the inline BOOT_CSS in
 * app/layout.tsx, gated on `html[data-intro]`, which the inline script there
 * sets before the body paints. So the opening starts with the first frame and
 * needs none of this file's JavaScript. That is why the old "wordmark paints,
 * blinks out, animates back in" bug cannot come back: there is no rewind.
 *
 * Without the attribute (a returning visitor, someone arriving on a `next`
 * link, or reduced motion) the same markup is simply the resting frame.
 *
 * **It never blocks.** `pointer-events: none`, behind a sign-in card that is
 * interactive from the first frame. Tapping the email field is the skip.
 */

import { useEffect, useRef } from 'react'
import OpeningMark from './OpeningMark'
import { SEQUENCE_MS } from '@/lib/opening'

/** Total run time, ms. */
export const INTRO_MS = SEQUENCE_MS

/* Where the pieces sit in the sign-in hero. Inline so it arrives with the
 * server markup and the first frame is already laid out. Unlike the boot shell,
 * this page's stylesheet and fonts are present, so the tokens are safe here. */
const INTRO_LAYOUT_CSS = `
.cv-intro .op-wreath { position: absolute; left: 50%; top: 0; width: 132px; height: 132px; transform: translateX(-50%); overflow: visible }
.cv-intro .op-word { position: absolute; left: 0; right: 0; top: 140px; text-align: center; color: var(--on-ink, #F5ECD7); font-weight: 800; font-size: 34px; letter-spacing: -0.035em; line-height: 1.1 }
.cv-intro .op-slogan { position: absolute; left: 0; right: 0; top: 186px; text-align: center; color: var(--text, #F5ECD7); font-family: var(--font-display); font-style: italic; font-size: 20px; line-height: 1.3 }
`

export default function IntroSequence({
  play = true,
  onDone,
}: {
  /** False shows the resting frame at once — a returning visitor, or someone
   *  sent here from a link they were already trying to open. */
  play?: boolean
  onDone?: () => void
}) {
  // Held in a ref so a caller passing an inline callback cannot restart the
  // sequence on every render.
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

  useEffect(() => {
    // The attribute is what runs the CSS. Leave it in place for the length of
    // the opening, then drop it; by then every element is at its resting
    // frame, so dropping it changes nothing on screen.
    const release = () => document.documentElement.removeAttribute('data-intro')
    if (!play) { release(); return }
    const t = setTimeout(() => { release(); done.current?.() }, INTRO_MS + 100)
    return () => clearTimeout(t)
  }, [play])

  return (
    <div className="cv-intro" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <style>{INTRO_LAYOUT_CSS}</style>
      <OpeningMark />
    </div>
  )
}
