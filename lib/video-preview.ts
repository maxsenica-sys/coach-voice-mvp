// lib/video-preview.ts
//
// What a video shows before anyone presses play. Pure, so tools/video-rig.mjs
// can run it.
//
// Max, 2026-11-20: "if I upload the videos ... there is no preview. So the
// videos just look blank. So I don't actually know what is being shown."
//
// Every <video> here loads `preload="metadata"`, so that opening a session
// with six clips does not start six downloads. On an iPhone that is exactly
// why they were blank: Safari reads the metadata and stops, and paints
// nothing until play. Asking for a moment a little way in, with a media
// fragment on the URL, is what makes it fetch and paint that one frame.
//
// A little way in rather than zero: the first frame of a phone clip is very
// often black or a blur of the phone being raised.

/** Seconds into the clip the still is taken from. */
export const PREVIEW_AT_S = 0.1

/**
 * The URL to give a <video> so it shows a still before play.
 * A URL that already names a time (`#t=12`) is left alone: a shared moment
 * must open on its own frame.
 */
export function previewSrc(url: string): string {
  if (!url) return url
  if (url.includes('#')) return url
  return `${url}#t=${PREVIEW_AT_S}`
}

/** "0:07", "1:05", "12:40", "1:02:03". Empty when the length is not known. */
export function clipLength(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Videos per row on a phone. Max: "across the phone, you should see maybe 3 videos". */
export const GRID_COLUMNS = 3

/**
 * Where the opened video goes in the grid: after the last tile of the row
 * the opened tile is in, so it opens beside the thing that was tapped and not
 * below every other row. Returns the index of the tile it follows, or -1.
 */
export function openPanelAfter(count: number, openIndex: number, columns: number = GRID_COLUMNS): number {
  if (openIndex < 0 || openIndex >= count || columns < 1) return -1
  const rowEnd = Math.floor(openIndex / columns) * columns + (columns - 1)
  return Math.min(rowEnd, count - 1)
}
