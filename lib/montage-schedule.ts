// lib/montage-schedule.ts
//
// The cold-start sequence's timing, in one place, because two things now need
// it and they must not disagree: the CSS keyframes inlined into the document
// head by app/layout.tsx, and anything in JavaScript that has to know how long
// the sequence lasts.
//
// ── Why this moved out of the component ───────────────────────────────────
//
// It used to live in app/components/ColdStartSplash.tsx, and living there is
// what broke it. The montage of fourteen sports — the thing Max calls "the
// animation of all the people" — was drawn by a React effect, so it could not
// start until roughly a megabyte of JavaScript had downloaded, parsed and
// hydrated. Its clock, meanwhile, was anchored to the start of the navigation.
//
// Those two facts cannot both be satisfied. The montage occupied 240ms-2090ms
// on a clock that started before the request was even sent, and the code that
// drew it could not run until well after 2090ms on the cold start it existed
// for. By the time the component was alive, its own timeline said the montage
// was over, so it drew the frame *after* it: the mark, rising. And on a fast
// launch the other end closed too, because `leaveWhenReady` explicitly jumped
// the clock to the collapse, skipping the montage on purpose to avoid making
// the user wait.
//
// Slow start: the people had already gone. Fast start: the people were skipped.
// The band in between where they were visible was, in practice, empty. Nothing
// was deleted and nothing type-checked wrong; the animation simply never ran.
//
// So the sequence no longer runs in JavaScript at all. It is CSS in the boot
// shell, it starts with the document's first paint, and there is nothing left
// that can be late for it. CLAUDE.md asks that a computation whose correctness
// is not obvious by reading it lives in lib/ where a rig can import it — this
// is that computation.

/** The sports in the montage, in order. Must match SPORTS in
 *  app/components/sportSilhouettes.tsx; tools/build-montage-sprite.mjs
 *  regenerates the sprite from that file and fails loudly if this disagrees. */
export const SPORT_COUNT = 14

/** The hairline drawing across, before any figure appears. */
export const DRAW_MS = 240

/**
 * How long each sport holds, in order: a geometric decay from 220ms to 70ms.
 *
 * The Marvel title card. The first few turn over slowly enough to read, and by
 * the end it is a thumb riffling a book. The tail must not bottom out lower:
 * at 40ms — two frames — the last third is a smear rather than a run of
 * sports. 70ms is four frames, still a riffle, and you can still tell what
 * went past. If the montage needs to be shorter, drop sports, not this number.
 */
export const FIG_MS: number[] = (() => {
  const first = 220, last = 70
  const r = Math.pow(last / first, 1 / (SPORT_COUNT - 1))
  return Array.from({ length: SPORT_COUNT }, (_, i) => Math.round(first * Math.pow(r, i)))
})()

/** Total montage length, ~1850ms across 14 sports. */
export const MONTAGE_MS = FIG_MS.reduce((a, b) => a + b, 0)

/** When each sport appears, measured from the start of the sequence. */
export const FIG_AT: number[] = FIG_MS.reduce<number[]>((acc, d, i) => {
  acc.push(i === 0 ? DRAW_MS : acc[i - 1] + FIG_MS[i - 1])
  return acc
}, [])

export const COLLAPSE_AT = DRAW_MS + MONTAGE_MS      // ~2090
export const MARK_AT = COLLAPSE_AT + 100             // the logo rises
export const WORD_AT = MARK_AT + 300
/** The sequence has fully resolved; everything after this is a held frame. */
export const SEQUENCE_MS = WORD_AT + 520             // ~3010

/**
 * The montage as CSS keyframes.
 *
 * The fourteen figures are one image — a horizontal strip, `SPORT_COUNT` frames
 * wide — scrolled by `background-position`. That is the whole reason this can
 * run without JavaScript: one element, one background, one animation, and no
 * component that has to exist first.
 *
 * `steps()` cannot express it, because the cadence accelerates and `steps()` is
 * even. So each frame gets its own stop, at its real offset on the timeline,
 * held with `step-end`. The percentages come from FIG_AT, so the CSS and any
 * JavaScript reading the same constants cannot drift apart.
 *
 * `background-position-x` is a percentage of (container width - image width),
 * which for a strip of N frames means frame i sits at i/(N-1) * 100%. This is
 * the standard sprite arithmetic and it is exact — not i/N.
 */
export function montageKeyframesCss(name = 'cv-riffle'): string {
  const total = SEQUENCE_MS
  const stops: string[] = []
  for (let i = 0; i < SPORT_COUNT; i++) {
    const pct = ((FIG_AT[i] / total) * 100).toFixed(3)
    const x = ((i / (SPORT_COUNT - 1)) * 100).toFixed(4)
    stops.push(`  ${pct}% { background-position-x: ${x}% }`)
  }
  return `@keyframes ${name} {\n  0% { background-position-x: 0% }\n${stops.join('\n')}\n}`
}

/** A percentage of the whole sequence, for hand-written keyframes below. */
export const at = (ms: number): string => ((ms / SEQUENCE_MS) * 100).toFixed(3) + '%'

/**
 * Amplitude envelope of a real 8-second coaching clip, reduced to 64 peaks.
 *
 * It lived in app/components/IntroSequence.tsx, which carries 'use client'.
 * The boot shell in app/layout.tsx is server-rendered and has to draw the same
 * waveform, and a server component cannot reach into a client module for a
 * constant without dragging the component in behind it. So the data lives
 * here, where all three callers — the layout, the sign-in intro and anything
 * else — read the same numbers.
 */
export const PEAKS = [
  3, 6, 4, 9, 14, 10, 18, 26, 20, 32, 24, 16, 22, 30, 38, 30,
  22, 14, 20, 28, 22, 15, 10, 17, 25, 34, 27, 19, 12, 8, 14, 21,
  29, 23, 16, 11, 7, 12, 18, 26, 20, 13, 9, 15, 22, 17, 11, 7,
  10, 14, 9, 6, 4, 7, 5, 3, 5, 8, 5, 3, 4, 6, 3, 2,
]
