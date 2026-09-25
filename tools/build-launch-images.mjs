#!/usr/bin/env node
/**
 * tools/build-launch-images.mjs — the screen iOS paints before the app exists.
 *
 *   node tools/build-launch-images.mjs            # write public/splash/*.png
 *   node tools/build-launch-images.mjs --links    # print the <link> tags for app/layout.tsx
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * On an installed iOS PWA the home-screen tap is answered by the OS, not by
 * the app: SpringBoard paints an apple-touch-startup-image it stored when the
 * app was added, and only then does the webview start. Nothing the app does
 * can put a pixel on screen before that, and no service worker can help —
 * the worker lives inside the webview that has not started yet.
 *
 * iOS matches these by exact device geometry. There is no fallback and no
 * nearest match: a device whose width, height and pixel ratio are not named by
 * one of these media queries gets **black**, for the whole time the document
 * is in flight. That is the "black screen delay when I open the app" in its
 * most literal form, and the only fix is to name every device.
 *
 * The set below covers every iPhone from the 5s to the 17 Pro Max and the
 * current iPads. It is written as geometry rather than as marketing names
 * because that is what the media query matches; the names are comments so the
 * next person can tell what is missing.
 *
 * ── Why it is generated ───────────────────────────────────────────────────
 *
 * The picture has to be the resting frame of the boot shell in app/layout.tsx,
 * pixel for pixel, or the handoff from the OS screen to the document is a
 * visible jump. Hand-making eighteen of those and keeping them in step with a
 * CSS gradient is not a thing anyone will do twice, so this renders them from
 * the same values, in the browser, at each device's real pixel ratio.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

const ROOT = process.cwd()
const OUT_DIR = join(ROOT, 'public', 'splash')

/** width x height in CSS pixels, and the device pixel ratio. */
const DEVICES = [
  { w: 320, h: 568, dpr: 2, note: 'iPhone SE 1st gen, 5s' },
  { w: 375, h: 667, dpr: 2, note: 'iPhone SE 2nd/3rd gen, 6-8' },
  { w: 414, h: 736, dpr: 3, note: 'iPhone 6-8 Plus' },
  { w: 375, h: 812, dpr: 3, note: 'iPhone X, XS, 11 Pro, 12/13 mini' },
  { w: 390, h: 844, dpr: 3, note: 'iPhone 12, 13, 14, 16e' },
  { w: 393, h: 852, dpr: 3, note: 'iPhone 14 Pro, 15, 16' },
  { w: 402, h: 874, dpr: 3, note: 'iPhone 16 Pro' },
  { w: 414, h: 896, dpr: 2, note: 'iPhone XR, 11' },
  { w: 414, h: 896, dpr: 3, note: 'iPhone XS Max, 11 Pro Max' },
  { w: 428, h: 926, dpr: 3, note: 'iPhone 12/13/14 Pro Max' },
  { w: 430, h: 932, dpr: 3, note: 'iPhone 14 Pro Max, 15/16 Plus & Pro Max' },
  { w: 440, h: 956, dpr: 3, note: 'iPhone 16 Pro Max, 17 Pro Max' },
  { w: 768, h: 1024, dpr: 2, note: 'iPad 9.7, Mini 4/5' },
  { w: 810, h: 1080, dpr: 2, note: 'iPad 10.2' },
  { w: 820, h: 1180, dpr: 2, note: 'iPad Air 10.9' },
  { w: 834, h: 1112, dpr: 2, note: 'iPad Pro 10.5' },
  { w: 834, h: 1194, dpr: 2, note: 'iPad Pro 11' },
  { w: 1024, h: 1366, dpr: 2, note: 'iPad Pro 12.9' },
]

const name = (d) => `launch-${d.w * d.dpr}x${d.h * d.dpr}.png`

/* The resting frame, written out in literals rather than read from
 * globals.css, for the same reason the boot shell inlines them: this picture
 * is painted by an operating system that has never heard of a CSS variable.
 * They must match #cv-boot in app/layout.tsx.
 *
 * INK_FROM is also the app's own ground — globals.css --bg, the manifest's
 * background_color and the inline html background in app/layout.tsx. Since
 * Stadium Night (2026-09-25) the app itself is ink, so this picture, the
 * Android launch colour, the shell and the app are one ground end to end.
 *
 * tools/boot-smoke.mjs holds all of that: it renders the shell's resting
 * frame at every geometry below, at the device's own pixel ratio, and fails if
 * a launch image differs from it; and it fails if a launch image's corner is
 * not the ground the browser computes for --bg. (This comment claimed that
 * comparison for a week before it existed. In that week the shell's wordmark
 * sat 7px lower than it does here, because it inherited body's line-height.) */
const INK_FROM = '#FBF8F3'
const INK_TO = '#F4F1EB'
const MARK_FROM = '#6F8E6B'
const MARK_TO = '#4F6B4B'
const ON_INK = '#F5ECD7'

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body {
    background: linear-gradient(160deg, ${INK_FROM} 0%, ${INK_TO} 100%);
    position: relative; overflow: hidden;
    /* Explicit, and equal to #cv-boot's: the shell pins its own metrics so
       that neither side inherits them from anywhere. */
    line-height: normal;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
  }
  .m {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, calc(-50% - 34px));
    width: 118px; height: 118px; border-radius: 34px;
    background: linear-gradient(135deg, ${MARK_FROM} 0%, ${MARK_TO} 100%);
    box-shadow: 0 20px 56px rgba(111, 142, 107, .48);
    display: flex; align-items: center; justify-content: center;
  }
  .w {
    position: absolute; top: calc(50% + 62px); left: 0; right: 0;
    text-align: center; color: ${ON_INK};
    font-weight: 800; font-size: 38px; letter-spacing: -0.04em;
  }
  .t {
    position: absolute; left: 0; right: 0; bottom: 34px;
    text-align: center; color: rgba(245, 236, 215, .72);
    font-size: 13px; font-style: italic;
  }
</style></head><body>
  <div class="m"><svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round">
    <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
    <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>
  </svg></div>
  <div class="w">CoachVoice</div>
  <div class="t">Your private training journal</div>
</body></html>`

if (process.argv.includes('--links')) {
  for (const d of DEVICES) {
    console.log(
      `        <link rel="apple-touch-startup-image" href="/splash/${name(d)}" ` +
      `media="(device-width: ${d.w}px) and (device-height: ${d.h}px) and ` +
      `(-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)" />`,
    )
  }
  process.exit(0)
}

if (process.argv.includes('--list')) {
  console.log(JSON.stringify(DEVICES.map((d) => ({ file: name(d), ...d }))))
  process.exit(0)
}

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return undefined
  for (const d of readdirSync(base)) {
    if (!d.startsWith('chromium-')) continue
    const p = join(base, d, 'chrome-linux', 'chrome')
    if (existsSync(p)) return p
  }
  return undefined
}

const { chromium } = await import('playwright')
let exe
try { if (!existsSync(chromium.executablePath())) exe = findChromium() } catch { exe = findChromium() }
const browser = await chromium.launch({ args: ['--no-sandbox'], ...(exe ? { executablePath: exe } : {}) })

mkdirSync(OUT_DIR, { recursive: true })
let total = 0
for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h },
    deviceScaleFactor: d.dpr,
  })
  const page = await ctx.newPage()
  await page.setContent(html, { waitUntil: 'load' })
  const raw = await page.screenshot({ type: 'png' })
  /* Chromium writes 24-bit PNG and dithers the gradient, which is ~750KB a
   * picture and 12MB across the set — on a phone, for a screen shown for half
   * a second. The committed images were 16-colour palette PNGs at ~100KB and
   * are indistinguishable at arm's length, because the whole picture is one
   * ink ramp, a rounded square and two words. Quantising here keeps that.
   *
   * 32 rather than 16: the extra sixteen go to the mark's own gradient and the
   * soft shadow under it, which at 16 banded visibly against the ground. */
  const buf = await sharp(raw).png({ palette: true, colours: 32, dither: 1, effort: 10 }).toBuffer()
  writeFileSync(join(OUT_DIR, name(d)), buf)
  total += buf.length
  console.log(`  ${name(d).padEnd(22)} ${String(Math.round(buf.length / 1024)).padStart(5)}KB   ${d.note}`)
  await ctx.close()
}
await browser.close()
console.log(`\n  ${DEVICES.length} launch images, ${(total / 1024 / 1024).toFixed(1)}MB total\n`)
