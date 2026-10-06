/**
 * The Pindar mark — a laurel wreath — as data, so every place that draws it
 * draws the same one.
 *
 * Pindar wrote a victory ode for each athlete who won at the Games, and the
 * winners were crowned with a wreath. The app writes each athlete their own
 * summary of the session; the wreath is the honour that went with the ode.
 *
 * It lives in lib/ rather than in a component because it is drawn in places
 * that are not React: the inline boot shell in app/layout.tsx, the launch
 * images and app icons (tools/build-launch-images.mjs, tools/build-icons.mjs),
 * and the Focus Card's canvas. Those tools run under plain Node, which can
 * strip TypeScript but cannot parse JSX, so this file has no imports and no
 * JSX — keep it that way.
 *
 * Geometry is a 48×48 box: two branch stems (stroked arcs) and twenty-four
 * leaves (filled ellipses, rotated). Each leaf is [cx, cy, rx, ry, degrees].
 */

export const LAUREL_VIEWBOX = '0 0 48 48'

/** Stroke width of the two stems, in viewBox units. */
export const LAUREL_STEM_WIDTH = 1.6

export const LAUREL_STEMS: readonly string[] = [
  'M21.97 39.06A14.6 14.6 0 0 1 18.06 11.26',
  'M26.03 39.06A14.6 14.6 0 0 0 29.94 11.26',
]

export const LAUREL_LEAVES: readonly (readonly [number, number, number, number, number])[] = [
  [14.19, 38.76, 4.3, 1.75, 168],
  [9.55, 33.6, 4.0, 1.63, 192],
  [12.77, 30.71, 4.0, 1.63, 264],
  [7.36, 27.11, 3.7, 1.5, 216],
  [11.17, 25.88, 3.7, 1.5, 288],
  [7.92, 20.37, 3.4, 1.38, 240],
  [11.57, 20.75, 3.4, 1.38, 312],
  [11.06, 14.47, 3.1, 1.26, 264],
  [13.96, 16.14, 3.1, 1.26, 336],
  [15.72, 10.62, 2.79, 1.14, 286],
  [17.58, 13.01, 2.79, 1.14, 358],
  [20.69, 10.09, 3.2, 1.4, 336],
  [33.81, 38.76, 4.3, 1.75, 12],
  [38.45, 33.6, 4.0, 1.63, -12],
  [35.23, 30.71, 4.0, 1.63, -84],
  [40.64, 27.11, 3.7, 1.5, -36],
  [36.83, 25.88, 3.7, 1.5, -108],
  [40.08, 20.37, 3.4, 1.38, -60],
  [36.43, 20.75, 3.4, 1.38, -132],
  [36.94, 14.47, 3.1, 1.26, -84],
  [34.04, 16.14, 3.1, 1.26, -156],
  [32.28, 10.62, 2.79, 1.14, -106],
  [30.42, 13.01, 2.79, 1.14, -178],
  [27.31, 10.09, 3.2, 1.4, -156],
]

/**
 * The wreath's shapes as SVG markup, for the places that build a string
 * rather than JSX. `color` is any CSS colour, including `currentColor`.
 */
export function laurelShapes(color: string): string {
  const stems = LAUREL_STEMS.map((d) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${LAUREL_STEM_WIDTH}" stroke-linecap="round"/>`,
  ).join('')
  const leaves = LAUREL_LEAVES.map(([x, y, rx, ry, deg]) =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${deg} ${x} ${y})" fill="${color}"/>`,
  ).join('')
  return stems + leaves
}

/** A complete inline <svg> of the wreath at `size` CSS pixels. */
export function laurelSvg(color: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LAUREL_VIEWBOX}" width="${size}" height="${size}" aria-hidden="true">${laurelShapes(color)}</svg>`
}

/** The product's name, in the one place it is spelled. */
export const BRAND = 'Pindar'
