#!/usr/bin/env node
/**
 * Boot smoke test — does the app actually open correctly?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * `tsc --noEmit` and `next build` both pass on every bug this file checks for.
 * They are the only gates the project has, and they are blind to the entire
 * class of defect that keeps coming back: what the user sees in the first
 * second. Three real examples, all of which built and typechecked cleanly:
 *
 *   · IntroSequence shipped its *resolved* frame in the server markup and only
 *     rewound it to invisible inside useEffect, so the wordmark painted with the
 *     HTML, sat there for the whole JS download, then blinked out and animated
 *     back in.
 *   · globals.css opened with an `@import url(fonts.googleapis.com/…)` that the
 *     Tailwind v4 build dropped on the floor. Two of three fonts silently never
 *     loaded in production, and nothing anywhere said so.
 *   · The boot shell's inline script matched its route with a regex inside a
 *     template literal, which ate the backslashes, so it armed on nothing.
 *
 * Every check below is a bug that actually shipped. Adding to this file is how
 * a fix stops being re-fixed: if a regression cannot fail a check here, it will
 * come back. When you fix something about how the app opens, add the check.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   npm run verify:boot          # build if needed, then check
 *   npm run verify:boot -- --build   # force a fresh production build first
 *
 * Exits non-zero on the first failing group, and prints what it saw either way.
 */

import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'

const ROOT = process.cwd()
const NEXT_DIR = join(ROOT, '.next')
const FORCE_BUILD = process.argv.includes('--build')

/* The opening's own timing and geometry, from the real module — never a copy.
 * A harness that kept its own WORD_AT would go on passing against a schedule
 * the app no longer has. lib/opening.ts imports through the app's @/ alias,
 * which plain Node learns from tools/alias-register.mjs; registering it here
 * rather than in package.json keeps `node tools/boot-smoke.mjs` working bare. */
await import('./alias-register.mjs')
const OPENING = await import('../lib/opening.ts')
const { BAR_COUNT, STEMS_AT, LEAVES_AT, WORD_AT, SLOGAN_AT, SEQUENCE_MS, SLOGAN } = OPENING

/* Placeholders only. The build prerenders /athlete, which builds a Supabase
 * client at module scope and throws without these; nothing here makes a network
 * call, so no real secrets belong in this file or in CI. */
const BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-role-key',
  OPENAI_API_KEY: 'placeholder-openai-key',
}

/* ── reporting ─────────────────────────────────────────────────────────────*/
const results = []
let group = ''
const heading = (g) => { group = g; console.log(`\n── ${g} ${'─'.repeat(Math.max(0, 70 - g.length))}`) }
const check = (name, ok, detail = '') => {
  results.push({ group, name, ok })
  console.log(`   ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `\n         ${detail}` : ''}`)
  return ok
}

/* ── helpers ───────────────────────────────────────────────────────────────*/
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

async function freePort() {
  return new Promise((res) => {
    const s = net.createServer()
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)) })
  })
}

/* ── luminance, and WCAG 2.3.1 general flashes ─────────────────────────────
 *
 * The audience is 13-18 and the cold start is full-screen. "It should be
 * calmer now" is a claim about pixels, so it is measured on pixels: every
 * frame is decoded to WCAG relative luminance and the sequence is run through
 * the general-flash definition —
 *
 *   a flash is a pair of opposing changes in relative luminance of 10% or more
 *   of the maximum, where the darker state is below 0.80; more than three in
 *   any one second, over more than 25% of a 10° visual field, fails.
 *
 * 25% of a 10° field is WCAG's 341x256-at-1024x768 rectangle: 21,824 px². At
 * arm's length on a phone a 10° field is ~52mm, about 320 CSS px across, which
 * lands in the same place. This harness is stricter than the rule on purpose:
 * it sums failing area over the whole screen, not per rectangle, and it rounds
 * a half-flash up. */
const FLASH_AREA_PX = 21_824
const LUM_LUT = Float32Array.from({ length: 256 }, (_, c) => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
async function lumaFrame(png, w, h) {
  const { default: sharp } = await import('sharp')
  const raw = await sharp(png).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer()
  const L = new Float32Array(w * h)
  for (let i = 0, j = 0; i < L.length; i++, j += 3) {
    L[i] = 0.2126 * LUM_LUT[raw[j]] + 0.7152 * LUM_LUT[raw[j + 1]] + 0.0722 * LUM_LUT[raw[j + 2]]
  }
  return L
}
const hexLum = (hex) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  return 0.2126 * LUM_LUT[n >> 16 & 255] + 0.7152 * LUM_LUT[n >> 8 & 255] + 0.0722 * LUM_LUT[n & 255]
}
const flatFrame = (hex, n) => new Float32Array(n).fill(hexLum(hex))
/** One step between two frames: how much of the screen swung by a flash's worth. */
function swing(a, b) {
  let area = 0, sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]); sum += d
    if (d >= 0.1 && Math.min(a[i], b[i]) < 0.8) area++
  }
  return { area, frac: area / a.length, mean: sum / a.length }
}
/** Streaming general-flash counter. Feed frames in time order; memory is a
 *  few arrays per pixel however long the film is. */
function flashMeter(n, w) {
  const dir = new Int8Array(n), ref = new Float32Array(n), lo = new Float32Array(n), hi = new Float32Array(n)
  const K = 8, times = new Float32Array(n * K), count = new Uint16Array(n), worst = new Uint8Array(n)
  let started = false, frames = 0, movedUp = 0, movedDn = 0
  const events = []   // frames at which a large area transitioned at once
  const mark = (i, t, d, v) => {
    if (d > 0) movedUp++; else movedDn++
    dir[i] = d; ref[i] = v
    times[i * K + (count[i] % K)] = t; count[i]++
    let inWin = 0
    for (let k = 0; k < Math.min(count[i], K); k++) if (t - times[i * K + k] < 1000) inWin++
    if (inWin > worst[i]) worst[i] = inWin
  }
  return {
    push(t, L) {
      frames++
      if (!started) { ref.set(L); lo.set(L); hi.set(L); started = true; return }
      movedUp = 0; movedDn = 0
      for (let i = 0; i < n; i++) {
        const v = L[i]
        if (dir[i] === 0) {
          if (v < lo[i]) lo[i] = v
          if (v > hi[i]) hi[i] = v
          if (v - lo[i] >= 0.1 && Math.min(v, lo[i]) < 0.8) mark(i, t, 1, v)
          else if (hi[i] - v >= 0.1 && v < 0.8) mark(i, t, -1, v)
        } else if (dir[i] === 1) {
          if (v > ref[i]) ref[i] = v
          else if (ref[i] - v >= 0.1 && v < 0.8) mark(i, t, -1, v)
        } else {
          if (v < ref[i]) ref[i] = v
          else if (v - ref[i] >= 0.1 && ref[i] < 0.8) mark(i, t, 1, v)
        }
      }
      if (movedUp + movedDn >= FLASH_AREA_PX) events.push({ t, up: movedUp, dn: movedDn })
    },
    result() {
      // Transitions in the worst one-second window, per pixel. Seven is three
      // and a half flashes: failing, rounded against us. Expect a handful of
      // pixels to reach it legitimately: a thin stroke that MOVES — the mic
      // glyph as the mark rises — passes on and off the same few pixels
      // several times. That is motion, not a flash, and the area limit is
      // exactly what tells the two apart; `where` says which it is.
      let failing = 0, anyFlash = 0, peak = 0
      const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
      for (let i = 0; i < n; i++) {
        if (worst[i] >= 7) {
          failing++
          const x = i % w, y = (i / w) | 0
          box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x)
          box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y)
        }
        if (worst[i] >= 2) anyFlash++
        if (worst[i] > peak) peak = worst[i]
      }
      const where = failing ? `x ${box.x0}-${box.x1}, y ${box.y0}-${box.y1}` : 'nowhere'
      /* The other half of the definition. The count above asks whether one
       * place flashes repeatedly; this asks whether the SCREEN does — a large
       * area changing at once, even when each change lands on different
       * pixels. A riffle of light figures is exactly that: every change
       * swaps one silhouette for another, so no single pixel repeats often
       * but the region as a whole flickers. The per-pixel count alone passed
       * that mutation. */
      let bursts = 0
      for (const e of events) bursts = Math.max(bursts, events.filter((f) => f.t >= e.t && f.t - e.t < 1000).length)
      /* And stricter still: a large area going light and coming back at all —
       * one flash, not four. WCAG permits that; this app should not have one
       * between the icon and the app, and a single stray light frame (a
       * default white canvas, a stylesheet late by one frame) is exactly one
       * flash, so the three-a-second rule would wave it through. A page's
       * content arriving is one transition and does not count; it takes a
       * large brightening and a large darkening within a second. */
      const U = events.filter((e) => e.up >= FLASH_AREA_PX), D = events.filter((e) => e.dn >= FLASH_AREA_PX)
      const pairs = []
      for (const u of U) for (const d of D) if (Math.abs(u.t - d.t) < 1000) pairs.push(`${Math.round(u.t)}ms up ${u.up}px² / ${Math.round(d.t)}ms down ${d.dn}px²`)
      return { failing, anyFlash, peakFlashesPerSecond: peak / 2, frames, where, bursts, events: events.length, pairs }
    },
  }
}
const toHex = (rgb) => {
  const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/)
  if (!m) return String(rgb)
  if (m[4] !== undefined && Number(m[4]) === 0) return 'transparent'
  return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}
const contrast = (a, b) => {
  const [x, y] = [hexLum(a), hexLum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/* Set in assertMiddleware, read in assertBoot: the manifest as served. */
let SERVED_MANIFEST = null

async function waitForServer(base, ms = 90_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try { await fetch(base, { redirect: 'manual' }); return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/**
 * An explicit executablePath ONLY when playwright cannot find the browser
 * itself. Returning null is the good case: it means "let playwright launch its
 * own browser its own way".
 *
 * This used to return `playwrightChromium.executablePath()` whenever that file
 * existed, which is almost always — so the launch nearly always went through
 * the explicit path. On Windows that fails outright with `spawn UNKNOWN`, even
 * though the string is byte-for-byte the path playwright would have used, and
 * even though launching with no executablePath at all works fine on the same
 * machine. The override was doing nothing except breaking one platform.
 *
 * The fallback below is the case it was actually written for: a sandboxed CI
 * image that ships browsers under PLAYWRIGHT_BROWSERS_PATH in a versioned
 * directory playwright's own resolver may not match.
 */
function findChromium(playwrightChromium) {
  try {
    if (existsSync(playwrightChromium.executablePath())) return null
  } catch { /* fall through to the shared install below */ }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  if (!existsSync(base)) return null
  for (const d of readdirSync(base)) {
    if (!d.startsWith('chromium-')) continue
    const p = join(base, d, 'chrome-linux', 'chrome')
    if (existsSync(p)) return p
  }
  return null
}

/* The @font-face family behind each design token. next/font/local names a face
 * after the constant it is assigned to in app/layout.tsx — `const jakartaSans =
 * localFont(…)` emits `font-family:jakartaSans` — so renaming a constant there
 * renames the family, and this table has to follow. (Under next/font/google
 * these were the Google names: Plus Jakarta Sans, Newsreader, JetBrains Mono,
 * Big Shoulders. Those survive in globals.css only as literal fallbacks.) */
const FAMILY = { sans: 'jakartaSans', display: 'newsreader', mono: 'jetbrainsMono', cast: 'bigShoulders' }

/* How many @font-face rules each family has in the build: one per subset per
 * style, exactly what next/font/google used to emit. latin comes from
 * next/font/local in layout.tsx, the rest from app/fonts/subsets.css. A family
 * that loses a subset renders the letters in that range — the ć in a surname —
 * in a fallback face, which nothing else here would notice. */
const FACES = { jakartaSans: 4, newsreader: 6, bigShoulders: 3, jetbrainsMono: 6 }

/* ── 1. build output ───────────────────────────────────────────────────────
 *
 * Checks that can only be made against the compiled bundle. A stylesheet rule
 * or a font family can vanish between source and build with no error anywhere,
 * which is exactly how two fonts went missing in production for weeks. */
function assertBuildOutput() {
  heading('Source rules')

  // Checked in the *source*, not the build, and this distinction matters more
  // than it looks. A third-party @import in globals.css is dropped outright by
  // the Tailwind v4 pipeline, so the built CSS looks innocent either way — the
  // build-output check below can never see this regression. Meanwhile in
  // development the same line does load, render-blocking, behind a fresh DNS +
  // TLS handshake it hides from the preload scanner. That combination is how
  // two fonts went missing from production while looking fine locally.
  // Fonts belong in next/font, which self-hosts them onto our own origin.
  for (const f of walk(join(ROOT, 'app')).filter((f) => f.endsWith('.css'))) {
    const bad = readFileSync(f, 'utf8').match(/@import\s+url\(["']?\s*(?:https?:)?\/\//g) || []
    check(`${f.replace(ROOT + '/', '')} has no third-party @import`, bad.length === 0, bad.join(', '))
  }

  /* ── Every :root font alias points at a variable next/font actually defines ──
   *
   * globals.css turns each next/font variable into a design token:
   *
   *     --font-display: var(--font-newsreader), 'Georgia', serif;
   *
   * and the whole declaration is only as good as that variable name. A var()
   * that resolves to nothing where a custom property is declared makes the
   * property guaranteed-invalid, so `font-family: var(--font-display)` is
   * invalid at computed-value time and the literal fallbacks — Georgia, serif —
   * go down with it. The screen does not fall back; it inherits, which on this
   * app means the body font everywhere and the browser default serif anywhere
   * body has not reached. That is the failure that once dropped every heading
   * in the product, and it is two correct-looking lines in two different files.
   *
   * Adding Big Shoulders reproduced it exactly: `variable: '--font-cast'` in
   * layout.tsx and `--font-cast: var(--font-cast), …` in globals.css, so the
   * alias referenced itself and nothing defined the name it wanted. It built,
   * typechecked and linted.
   *
   * Source, not build, and not the browser either: the browser check further
   * down can only ask about a page it loaded, whereas the mismatch is a fact
   * about two files and is worth failing on before anything is compiled. The
   * two checks are deliberately redundant — this one names the mechanism, that
   * one proves the outcome.
   */
  {
    const layout = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8')
    const defined = new Set([...layout.matchAll(/variable:\s*'(--font-[a-z0-9-]+)'/g)].map((m) => m[1]))
    const cssSrc = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8')
    const root = (cssSrc.match(/:root\s*\{[\s\S]*?\n\}/) || [''])[0]
    const aliases = [...root.matchAll(/(--font-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
      .map(([, name, value]) => ({ name, value, refs: [...value.matchAll(/var\(\s*(--font-[a-z0-9-]+)/g)].map((m) => m[1]) }))
      .filter((a) => a.refs.length > 0)

    check(
      'every :root font token aliases a next/font variable',
      aliases.length > 0 && aliases.every((a) => a.refs.every((r) => defined.has(r) && r !== a.name)),
      aliases.length === 0
        ? 'no :root --font-* alias found at all — the tokens moved, so this rule stopped looking'
        : aliases.map((a) => {
          const broken = a.refs.filter((r) => !defined.has(r) || r === a.name)
          return `${a.name} -> ${a.refs.join(', ')}${broken.length ? `  ✗ ${broken.map((r) => r === a.name ? `${r} references itself` : `${r} is not a next/font variable`).join('; ')}` : ''}`
        }).join('\n         ') + `\n         next/font defines: ${[...defined].join(', ')}`,
    )
  }

  // No font is fetched from a third party at build time. next/font/google
  // downloads Google's stylesheet during `next build` and parses it; on
  // 2026-09-27 Google answered one CI runner with a URL shape the loader could
  // not parse and a PR that touched no font failed to build. Vercel's
  // production build makes the same request, so a deploy could fail on how
  // Google felt that minute. The files live in app/fonts/ now.
  {
    const src = walk(join(ROOT, 'app')).filter((f) => /\.(tsx?|jsx?)$/.test(f))
    const google = src.filter((f) => /from\s+['"]next\/font\/google['"]/.test(readFileSync(f, 'utf8')))
    check('no font is fetched from Google at build time (next/font/local only)', google.length === 0,
      google.map((f) => f.replace(ROOT + '/', '')).join(', '))
  }

  heading('Build output')

  const cssFiles = walk(join(NEXT_DIR, 'static')).filter((f) => f.endsWith('.css'))
  const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  check('a stylesheet was emitted', cssFiles.length > 0, `${cssFiles.length} file(s)`)

  // Every family the design tokens name must be in the build as a real
  // @font-face. Naming one in globals.css is not evidence that it loads.
  // next/font/local names each face after its constant in layout.tsx, which is
  // why these are jakartaSans and not "Plus Jakarta Sans" — see FAMILY above.
  for (const [token, fam] of Object.entries(FAMILY)) {
    check(`${fam} (--font-${token}) is self-hosted in the build`, css.includes(`font-family:${fam}`))
    const faces = (css.match(/@font-face\{[^}]*\}/g) || []).filter((f) => new RegExp(`font-family:["']?${fam}["']?[;}]`).test(f))
    const ranges = faces.map((f) => (f.match(/unicode-range:([^;}]+)/) || [, 'no unicode-range'])[1].split(',')[0].trim())
    // …and every one says which characters it is for. A face without a
    // unicode-range claims every character, so the browser would stop looking
    // for the subset that actually has the glyph.
    check(`${fam} carries all ${FACES[fam]} of its subsets, each with a unicode-range`,
      faces.length === FACES[fam] && !ranges.includes('no unicode-range'),
      `${faces.length} @font-face rule(s), first ranges: ${ranges.join(' | ')}`)
  }

  // Nothing render-blocking may come from a third party. An @import nested in
  // the stylesheet is invisible to the preload scanner and blocks paint behind
  // a fresh DNS + TLS handshake — and, on this toolchain, may be dropped
  // silently instead. Either outcome is a bug; ban the construct.
  const external = css.match(/@import\s+url\(["']?https?:[^)]*\)/g) || []
  check('no third-party @import survives into the CSS', external.length === 0, external.join(', '))

  // ── The launch screen ───────────────────────────────────────────────────
  //
  // The manifest's background_color is the very first frame of a cold start:
  // the OS paints it, with the app icon on it, before any of this app exists.
  // It was near-black for months because a stale hand-written copy of the
  // manifest sat in public/ and silently shadowed app/manifest.ts — a static
  // file wins over a route of the same name, with no warning from the build,
  // the type system or the linter. Nothing could have caught it except asking
  // what is actually served, which is what the served-manifest check below
  // does. This one bans the shadow at source.
  const shadow = join(ROOT, 'public', 'manifest.webmanifest')
  check(
    'no static manifest shadows app/manifest.ts',
    !existsSync(shadow),
    existsSync(shadow) ? 'public/manifest.webmanifest overrides the route — delete it' : '',
  )

  // The service worker is hand-written in public/sw.js precisely because the
  // generated one never existed: next-pwa is a webpack plugin and this project
  // builds with Turbopack, so /sw.js answered 404 in production while a
  // forty-line runtimeCaching array in next.config.ts looked authoritative.
  const sw = join(ROOT, 'public', 'sw.js')
  if (check('a service worker is present', existsSync(sw))) {
    const src = readFileSync(sw, 'utf8')
    // Caching a document is how a PWA bricks itself: the prerendered HTML
    // names content-hashed chunks, so a shell served from cache after a deploy
    // fetches chunks that no longer exist and the app opens to nothing. There
    // is no staging environment to catch that here.
    check("the worker refuses navigations", src.includes("req.mode === 'navigate'"))
    check('the worker never claims /api', src.includes("url.pathname.startsWith('/api/')"))
    /* Every precached URL must exist. install() adds them one at a time and
     * swallows each failure, deliberately, so that one missing file cannot
     * empty the whole precache — which also means a stale entry (the deleted
     * montage sprite is the one this was written for) is a 404 on every
     * install that nothing anywhere reports. This is the only thing that
     * would notice. */
    const list = (src.match(/const PRECACHE\s*=\s*\[([\s\S]*?)\]/) || [, null])[1]
    const entries = list === null ? null : [...list.replace(/\/\/.*$/gm, '').matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
    const dead = (entries ?? []).filter((u) => !existsSync(join(ROOT, 'public', u.replace(/^\//, ''))))
    check(
      'every PRECACHE entry in the worker is a file that exists',
      entries !== null && dead.length === 0,
      entries === null ? 'no PRECACHE array found — the rule stopped looking' : dead.length ? `missing: ${dead.join(', ')}` : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${entries.length ? ': ' + entries.join(', ') : ''}`,
    )
    check('the worker no longer references the montage', !src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').includes('montage'))
  }

  const htmlFiles = walk(join(NEXT_DIR, 'server', 'app')).filter((f) => f.endsWith('.html'))
  const index = htmlFiles.find((f) => f.endsWith('index.html'))
  check('"/" is prerendered to static HTML', Boolean(index), index ? '' : 'no index.html — "/" went dynamic')

  if (index) {
    const html = readFileSync(index, 'utf8')

    /* ── The opening is in the server markup, twice, whole ──
     *
     * The opening is CSS over markup the server sent: once in #cv-boot, once
     * in the sign-in intro (.cv-intro). Every rule in lib/opening.ts selects by
     * class, so a renamed or missing class does not fail anything — the rule
     * simply stops matching and that piece shows its plain style for ever. So
     * count the pieces the CSS addresses, in the HTML as shipped. */
    const count = (re) => (html.match(re) || []).length
    const pieces = {
      wreaths: count(/class="op-wreath"/g),
      stems: count(/class="op-stem"/g),
      leaves: new Set([...html.matchAll(/class="op-leaf (l\d+)"/g)].map((m) => m[1])).size,
      bars: new Set([...html.matchAll(/class="op-bar (b\d+)"/g)].map((m) => m[1])).size,
      words: count(/class="op-word">Pindar</g),
      slogans: count(new RegExp(`class="op-slogan">${SLOGAN.replace(/\./g, '\\.')}<`, 'g')),
    }
    check(
      'the opening is server-rendered whole, in the shell and in the intro',
      pieces.wreaths === 2 && pieces.stems === 4 && pieces.leaves === BAR_COUNT && pieces.bars === BAR_COUNT &&
        pieces.words === 2 && pieces.slogans === 2,
      `${JSON.stringify(pieces)} — expected 2 wreaths, 4 stems, ${BAR_COUNT} distinct leaves and bars, 2 × "Pindar", 2 × "${SLOGAN}"`,
    )
    check('the boot shell markup is server-rendered', html.includes('id="cv-boot"'))
    check('the intro\'s animation is inlined in <head>, gated on data-intro', html.includes('html[data-intro] .cv-intro .op-word { animation'))

    /* ── Every animation is behind the reduced-motion gate ──
     *
     * The opening's safety rests on one arrangement in lib/opening.ts: each
     * element's plain style is its resting frame, and every animation sits
     * inside `@media (prefers-reduced-motion: no-preference)`. One animation
     * declared outside that block plays for someone who asked the OS for no
     * motion, and nothing about the page looks broken to anyone else. Read
     * out of the inline <style> the browser will actually get, with a brace
     * counter rather than a regex, because the blocks nest. */
    {
      const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).filter((s) => s.includes('#cv-boot'))
      const ungated = []
      let gatedAnims = 0
      for (const css of inline) {
        const stack = []
        let i = 0
        const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
        while (i < src.length) {
          const open = src.indexOf('{', i), close = src.indexOf('}', i)
          if (open !== -1 && open < close) {
            const prelude = src.slice(i, open).split(/[;}]/).pop().trim()
            stack.push(prelude)
            const body = src.slice(open + 1, Math.min(...[src.indexOf('{', open + 1), src.indexOf('}', open + 1)].filter((n) => n !== -1)))
            if (/(^|[;\s])animation(-name)?\s*:/.test(body) && !prelude.startsWith('@keyframes') && !/^\d|^from|^to/.test(prelude)) {
              if (stack.some((p) => /@media\s*\(prefers-reduced-motion:\s*no-preference\)/.test(p))) gatedAnims++
              else ungated.push(prelude.slice(0, 60))
            }
            i = open + 1
          } else if (close !== -1) {
            stack.pop(); i = close + 1
          } else break
        }
      }
      check(
        'every animation in the inline shell CSS is behind prefers-reduced-motion: no-preference',
        gatedAnims > 0 && ungated.length === 0,
        ungated.length ? `ungated: ${ungated.slice(0, 4).join(' | ')}` : `${gatedAnims} animated rule(s), all gated`,
      )
    }

    /* ── The first frame needs nothing but the document ──
     *
     * The montage this replaced was an image, preloaded here and precached by
     * the worker, because without it the shell's centrepiece was a blank
     * rectangle. The opening is inline SVG and CSS. A url() or an image
     * preload creeping back into the shell is a second request the first
     * frame waits on — and a reference to the deleted sprite is a 404 on every
     * cold start. */
    {
      const shellCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).filter((s) => s.includes('#cv-boot')).join('\n')
      const urls = shellCss.replace(/\/\*[\s\S]*?\*\//g, '').match(/url\([^)]*\)/g) || []
      const imgPreloads = (html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) || [])
      check(
        'the opening fetches nothing: no url() in the shell CSS, no image preload',
        urls.length === 0 && imgPreloads.length === 0,
        urls.length || imgPreloads.length ? [...urls, ...imgPreloads].slice(0, 3).join(', ') : 'inline SVG and CSS only',
      )
      check('nothing still asks for the deleted montage sprite', !html.includes('montage.svg'), html.includes('montage.svg') ? 'montage.svg is referenced in the HTML — a 404 on every cold start' : '')
    }
    const ext = (html.match(/<link[^>]+rel="stylesheet"[^>]+href="https?:[^"]*"/g) || [])
    check('no third-party stylesheet in <head>', ext.length === 0, ext.join(', '))

    // ── Nothing render-blocking that the first frame does not need ─────────
    //
    // The shell paints at first paint, and first paint is whatever the browser
    // has to finish first. A `<link rel="stylesheet">` is render-blocking by
    // definition, so if one is emitted the shell — which needs no stylesheet
    // at all, its CSS is inline in the same document — waits for a second
    // request before a single pixel appears. Measured on a slow-3G profile:
    // the HTML was complete at 606ms and first paint was at 1568ms, the whole
    // gap spent on a 37KB stylesheet the first frame does not read one rule
    // from. `experimental.inlineCss` in next.config.ts is what removes it.
    //
    // Same-origin, not third-party: the check above bans a *foreign*
    // stylesheet, which is a different bug. This one bans the extra round trip.
    const blocking = (html.match(/<link[^>]+rel="stylesheet"[^>]*>/g) || [])
    check(
      'no render-blocking stylesheet delays the boot shell',
      blocking.length === 0,
      blocking.length
        ? `${blocking.length} <link rel=stylesheet> in the document — first paint cannot happen before it lands`
        : 'CSS is inlined',
    )

    // ── The font budget on the critical path ──────────────────────────────
    //
    // `<link rel="preload" as="font">` is fetched at the same priority as the
    // stylesheet and ahead of the app bundle, so every byte here is a byte
    // taken from the two things the brand moment actually depends on: the
    // document's own paint, and the JavaScript that starts the animation.
    //
    // This shipped at 150,824 bytes — Newsreader normal *and* italic (123KB)
    // plus Plus Jakarta Sans — while the first painted frame deliberately uses
    // neither: the boot shell hardcodes the system stack precisely because no
    // webfont can be relied on that early. Blocking those three requests on a
    // slow-3G profile moved first paint 412ms earlier and the whole bundle
    // more than two seconds earlier. `display: 'swap'` means the cost of not
    // preloading is a late swap, not invisible text.
    const FONT_PRELOAD_BUDGET = 40_000
    const fontPreloads = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /as="font"/.test(tag))
      .map((tag) => (tag.match(/href="([^"]+)"/) || [])[1])
      .filter(Boolean)
    let fontBytes = 0
    for (const href of fontPreloads) {
      const onDisk = join(NEXT_DIR, href.replace(/^\/_next\//, ''))
      if (existsSync(onDisk)) fontBytes += statSync(onDisk).size
    }
    check(
      'preloaded fonts stay inside the critical-path budget',
      fontBytes <= FONT_PRELOAD_BUDGET,
      `${fontPreloads.length} file(s), ${fontBytes}B (budget ${FONT_PRELOAD_BUDGET}B) — ${fontPreloads.join(', ') || 'none'}`,
    )

    /* ── which family, not just how many bytes ────────────────────────────
     *
     * The budget above is a number standing in for a decision, and the decision
     * is narrower than the number: exactly one family is preloaded, the one that
     * carries body copy on every screen, because the first painted frame is the
     * boot shell and the boot shell hardcodes the system stack. Three families
     * say `preload: false` for that reason and a fourth family is a fourth
     * chance to forget.
     *
     * A byte budget can only catch a family that is big enough. This one is
     * pinned by name instead, so it catches a small one too. Changing the pin
     * is the deliberate act of changing the decision — and it is one line, with
     * the reason next to it.
     *
     * Families are matched back through the built CSS rather than guessed from
     * the hashed filename, because the hash says nothing and next/font emits
     * several files per family. (Which one gets preloaded is not predictable
     * either: Big Shoulders ships a 9,840B latin file and a 36,480B one, and it
     * is the 36,480B one that is preloaded. That is exactly why this asserts a
     * name and leaves the arithmetic to the budget.)
     *
     * NOTE — the first version of this check read `preload: false` out of
     * layout.tsx and compared it with the document. It passed the mutation it
     * was written for, because deleting `preload: false` moves both sides of
     * that comparison together: it could only ever prove next/font obeyed the
     * source, never that the source was right. A check that cannot fail on the
     * regression it names is worse than no check, because it reads like cover.
     */
    const PRELOADED_FAMILIES = [FAMILY.sans]
    const preloadedFamilies = [...new Set(fontPreloads.map((href) => {
      const face = (css.match(new RegExp(`@font-face\\{[^}]*${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*\\}`)) || [''])[0]
      return (face.match(/font-family:([^;}]+)/) || [, `unknown (${href})`])[1].trim()
    }))].sort()
    check(
      `only ${PRELOADED_FAMILIES.join(' + ')} is on the critical path`,
      preloadedFamilies.join(', ') === PRELOADED_FAMILIES.join(', '),
      `preloaded: ${preloadedFamilies.join(', ') || 'nothing'} — expected exactly ${PRELOADED_FAMILIES.join(', ')}.` +
      ' Every other family must carry `preload: false`: the first painted frame is the boot shell, which reads none of them.',
    )
  }
}

/* ── 2. middleware routing ─────────────────────────────────────────────────
 *
 * The "/" fast path decides where a cold start lands before any network call.
 * Getting it wrong costs a whole extra navigation plus two Supabase round trips
 * on every launch, which is invisible in code review and very visible on a
 * phone. No auth server is needed: the fast path returns before one is built. */
async function assertMiddleware(base) {
  heading('Cold-start routing ("/" fast path)')
  const go = async (cookie, url = '/') => {
    const r = await fetch(base + url, { redirect: 'manual', headers: cookie ? { cookie } : {} })
    return { status: r.status, to: r.headers.get('location') || '' }
  }
  const AUTH = 'sb-proj-auth-token=x'

  let r = await go(null)
  check('signed out renders the sign-in page', r.status === 200, `got ${r.status} ${r.to}`)

  r = await go(AUTH)
  check('signed in, no hint → /dashboard', r.status === 307 && r.to.endsWith('/dashboard'), `${r.status} ${r.to}`)

  // A session too large for one cookie arrives chunked as .0, .1, … and is
  // still a session.
  r = await go('sb-proj-auth-token.0=x; sb-proj-auth-token.1=y')
  check('a chunked session cookie still takes the fast path', r.status === 307 && r.to.endsWith('/dashboard'), `${r.status} ${r.to}`)

  // A password-reset or signUp request leaves a PKCE code verifier named
  // sb-<ref>-auth-token-code-verifier on a visitor who is NOT signed in. The
  // prefix test matched it, so that visitor was sent to /dashboard and
  // bounced straight back to /?next=/dashboard.
  r = await go('sb-proj-auth-token-code-verifier=x')
  check('a PKCE code verifier alone is not a session', r.status === 200, `${r.status} ${r.to}`)

  r = await go(`${AUTH}; cv_role_hint=athlete`)
  check('hint=athlete → /athlete (no wasted hop)', r.status === 307 && r.to.endsWith('/athlete'), `${r.status} ${r.to}`)

  r = await go(`${AUTH}; cv_role_hint=coach`)
  check('hint=coach → /dashboard', r.status === 307 && r.to.endsWith('/dashboard'), `${r.status} ${r.to}`)

  // The hint is attacker-controllable. It must only ever select between two
  // known destinations — never be interpolated into a URL.
  r = await go(`${AUTH}; cv_role_hint=${encodeURIComponent('//evil.example')}`)
  const safe = r.status === 307 && (r.to.endsWith('/dashboard') || r.to.endsWith('/athlete'))
  check('a forged hint cannot redirect off-origin', safe, `${r.status} ${r.to}`)

  r = await go(`${AUTH}; cv_role_hint=athlete`, '/?next=%2Fsessions%2Fabc')
  check('?next= is not hijacked by the fast path', r.status === 200, `${r.status} ${r.to}`)

  r = await go(`${AUTH}; cv_role_hint=athlete`, '/?intro=1')
  check('?intro=1 still renders "/"', r.status === 200, `${r.status} ${r.to}`)

  // ── What the browser is actually handed ─────────────────────────────────
  //
  // Asking the server, not reading the source. app/manifest.ts had the right
  // background_color the whole time; a stale public/manifest.webmanifest was
  // being served instead, and the only way to see that is to fetch the URL.
  heading('The launch screen the OS paints')
  const mres = await fetch(base + '/manifest.webmanifest')
  const manifest = await mres.json().catch(() => null)
  check('the manifest is served', mres.ok && !!manifest, `${mres.status}`)
  if (manifest) {
    /* The invariant is "what app/manifest.ts says is what the browser gets",
     * not any particular colour. A static public/manifest.webmanifest shadowed
     * the route for months and served a different background — the near-black
     * the app opened to — and nothing anywhere could see it happen. So this
     * reads the value out of the source and compares, which keeps failing if
     * the shadow returns while leaving the colour itself a design decision
     * anyone can change in one place.
     *
     * The stale value used to be banned by name here as well — "the launch
     * screen is not the old near-black", #1F2421. That encoded the bug's
     * symptom, not its mechanism, and the redesign turned it inside out:
     * #1F2421 is now the app's ground and is exactly right, while the ivory
     * that check was protecting had become the launch screen that did not
     * match. The property was always "the launch screen is the app's own
     * ground", and that needs a browser to know what the ground computes to,
     * so it is asserted in assertBoot — see "One ground". */
    SERVED_MANIFEST = manifest
    const src = readFileSync(join(ROOT, 'app', 'manifest.ts'), 'utf8')
    const intended = (src.match(/background_color:\s*'(#[0-9A-Fa-f]{3,8})'/) || [])[1]
    check('app/manifest.ts declares a background_color', Boolean(intended), String(intended))
    check(
      'the served background_color is the one in app/manifest.ts',
      Boolean(intended) && manifest.background_color === intended,
      `served ${manifest.background_color}, source says ${intended} — a public/ file shadowing the route is how this diverges`,
    )
    check(
      'the maskable icon survived',
      (manifest.icons ?? []).some((i) => String(i.purpose ?? '').includes('maskable')),
    )
    check('start_url is "/"', manifest.start_url === '/', String(manifest.start_url))

    /* ── Every device, or a black screen for the ones missed ──
     *
     * On an installed iOS PWA the home-screen tap is answered by SpringBoard,
     * which paints an apple-touch-startup-image and only then starts the
     * webview. iOS matches these by exact geometry: no nearest match, no
     * fallback. A device whose width, height and pixel ratio are not named
     * gets BLACK for the whole time the document is in flight — which is what
     * "a black screen delay when I open the app" is, literally, and no amount
     * of work inside the app can reach it.
     *
     * The list named nine geometries and missed the XS Max and 11 Pro Max, the
     * Plus phones, the SE 1st gen and every iPad. Nothing could have noticed:
     * a missing <link> is not a build error, and the device that needs it is
     * not the device anyone is testing on.
     *
     * So the generator is the source of truth and this asserts the document
     * agrees with it, file by file. */
    const devices = JSON.parse(execFileSync(process.execPath,
      [join(ROOT, 'tools', 'build-launch-images.mjs'), '--list'], { encoding: 'utf8' }))
    const home = await (await fetch(base + '/')).text()
    const missingLink = devices.filter((d) =>
      !home.includes(`/splash/${d.file}`) ||
      !new RegExp(`device-width:\\s*${d.w}px[^"]*device-height:\\s*${d.h}px[^"]*pixel-ratio:\\s*${d.dpr}`).test(home))
    check(
      `every one of the ${devices.length} device geometries has a launch image declared`,
      missingLink.length === 0,
      missingLink.length
        ? `missing: ${missingLink.map((d) => `${d.w}x${d.h}@${d.dpr} (${d.note})`).join(', ')}`
        : devices.map((d) => d.note).join(' · ').slice(0, 150),
    )
    const heads = await Promise.all(devices.map((d) =>
      fetch(`${base}/splash/${d.file}`, { method: 'HEAD' }).then((r) => ({ f: d.file, s: r.status })).catch(() => ({ f: d.file, s: 0 }))))
    const missingFile = heads.filter((h) => h.s !== 200)
    check(
      'every declared launch image is actually served',
      missingFile.length === 0,
      missingFile.length ? missingFile.map((h) => `${h.f} -> ${h.s}`).join(', ') : `${heads.length} files, all 200`,
    )
  }

  const swres = await fetch(base + '/sw.js')
  check('/sw.js is served (it 404d for months)', swres.status === 200, `${swres.status}`)

  // Exercises the identity branch. The middleware reads the session with
  // getClaims() rather than getUser() — local signature verification instead of
  // a round trip to the Auth server — and getClaims returns {data:null,
  // error:null} rather than throwing when there is no session at all. If that
  // case is ever mishandled, a signed-out visitor either 500s here or, worse,
  // is treated as signed in; both look like "the app opens" until someone
  // checks. The `next` parameter is what carries an emailed session link
  // through the sign-in page, so it must survive the bounce.
  for (const path of ['/dashboard', '/athlete']) {
    r = await go(null, path)
    const bounced = r.status === 307 && r.to.includes(`/?next=${encodeURIComponent(path)}`)
    check(`signed out, ${path} bounces to sign-in carrying ?next=`, bounced, `${r.status} ${r.to}`)
  }
}

/* ── 3. what the eye actually sees ─────────────────────────────────────────
 *
 * A real browser against the production build. The timeline is recorded inside
 * the page from the first animation frame, so it measures paint rather than the
 * latency of asking about it. */
const TIMELINE_INIT = `
window.__cv = { frames: [], fcp: 0 }
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__cv.fcp = e.startTime
  }).observe({ type: 'paint', buffered: true })
} catch (e) {}
;(function sample() {
  const root = document.querySelector('.cv-intro')
  const word = root && root.querySelector('.op-word')
  if (word) {
    const op = (el) => parseFloat(getComputedStyle(el).opacity)
    const leaves = [...root.querySelectorAll('.op-leaf')].map(op)
    const bars = [...root.querySelectorAll('.op-bar')].map(op)
    const stems = [...root.querySelectorAll('.op-stem')].map((s) => parseFloat(getComputedStyle(s).strokeOpacity))
    window.__cv.frames.push({
      t: performance.now(),
      word: op(word),
      slogan: op(root.querySelector('.op-slogan')),
      leafMin: Math.min(...leaves), leafMax: Math.max(...leaves), leaves: leaves.length,
      barMax: Math.max(...bars), bars: bars.length,
      stemMax: Math.max(...stems),
      attr: document.documentElement.hasAttribute('data-intro'),
    })
  }
  if (performance.now() < 4000) requestAnimationFrame(sample)
})()
`
/* The resting frame, as the sampler above sees it: the name, the line and the
 * whole wreath, with the voice bars gone (they exist only to become leaves). */
const atRest = (f) => !!f && f.word === 1 && f.slogan === 1 && f.leafMin === 1 && f.leaves === BAR_COUNT &&
  f.barMax === 0 && f.stemMax === 1
const restDetail = (f) => f
  ? `word=${f.word} slogan=${f.slogan} leaves ${f.leafMin}..${f.leafMax} (${f.leaves}) bars max ${f.barMax} stems ${f.stemMax} data-intro=${f.attr}`
  : 'no frames'

async function assertBoot(base) {
  let chromium
  try { ({ chromium } = await import('playwright')) } catch {
    heading('First paint (browser)')
    check('playwright is installed', false, 'run: npm i -D playwright && npx playwright install chromium')
    return
  }
  const exe = findChromium(chromium)
  const launch = { args: ['--no-sandbox'], ...(exe ? { executablePath: exe } : {}) }
  const browser = await chromium.launch(launch)

  const timelineFor = async (ctx, url, ms = 3400) => {
    const page = await ctx.newPage()
    await page.addInitScript(TIMELINE_INIT)
    await page.goto(base + url, { waitUntil: 'commit' })
    await page.waitForTimeout(ms)
    const data = await page.evaluate(() => window.__cv)
    return { page, ...data }
  }

  try {
    /* ── the flash ── */
    heading('First paint — the cold start on "/"')
    const fresh = await browser.newContext()
    const cold = await timelineFor(fresh, '/')
    const first = cold.frames[0]
    /* "Painted" is any opacity at all, not "more than half". The old version of
     * this check used 0.5 and a wordmark fading in early at 0.4 is still a
     * wordmark on screen before its moment. */
    const early = cold.frames.filter((f) => f.t < 500 && (f.word > 0.02 || f.slogan > 0.02 || f.leafMax > 0.02))
    const settled = cold.frames[cold.frames.length - 1]

    check('the intro\'s opening was found and sampled', cold.frames.length > 20 && first?.leaves === BAR_COUNT && first?.bars === BAR_COUNT,
      `${cold.frames.length} frames sampled; ${first?.leaves} leaves, ${first?.bars} bars`)
    check(
      'the name, the line and the wreath are NOT painted in the first 500ms (the title flash)',
      early.length > 0 ? false : cold.frames.some((f) => f.t < 500),
      early.length
        ? `visible at ${early.slice(0, 3).map((f) => `${Math.round(f.t)}ms word=${f.word.toFixed(2)} slogan=${f.slogan.toFixed(2)} leaves≤${f.leafMax.toFixed(2)}`).join('; ')}`
        : cold.frames.some((f) => f.t < 500) ? `first frame at ${Math.round(first.t)}ms: ${restDetail(first)}` : 'no frame was sampled before 500ms, so nothing was proved',
    )
    check('the sequence resolves to the full lockup', atRest(settled), `at ${Math.round(settled?.t ?? 0)}ms: ${restDetail(settled)}`)
    check('the name does animate rather than snapping on', cold.frames.some((f) => f.word > 0.05 && f.word < 0.95))
    check('the voice bars play before the wreath forms', cold.frames.some((f) => f.barMax > 0.9 && f.leafMax === 0),
      `bars peaked at ${Math.max(...cold.frames.map((f) => f.barMax)).toFixed(2)}`)
    /* The rewind bug, asked as a property of the whole timeline: once the name
     * has been on screen it never goes away again. The old intro painted the
     * wordmark with the HTML, then hydration rewound it to invisible and
     * animated it back — a dip this catches wherever in the film it happens. */
    {
      let peak = 0, dip = null
      for (const f of cold.frames) {
        if (f.word > peak) peak = f.word
        if (peak > 0.3 && f.word < peak - 0.2 && !dip) dip = f
      }
      check('once the name appears it never blinks out again (no rewind)', !dip,
        dip ? `word fell to ${dip.word.toFixed(2)} at ${Math.round(dip.t)}ms after reaching ${peak.toFixed(2)}` : `word rose once, to ${peak.toFixed(2)}`)
    }
    /* The round caps. A stem drawn by stroke-dashoffset is "invisible" at
     * offset 1 only along its length: each end still paints its round cap, so
     * for the 900ms before the stems start there are four stray cream dots on
     * the ink where the wreath will be. The fix is a stroke-opacity ramp in the
     * keyframes, which the backwards fill holds at 0 through the delay. This is
     * asked of the browser's computed style; the boot shell section asks the
     * pixels. */
    {
      const beforeStems = cold.frames.filter((f) => f.t < STEMS_AT)
      const lit = beforeStems.filter((f) => f.stemMax > 0)
      check(`no stem is painted before the stems start (${STEMS_AT}ms) — the round-cap dots`,
        beforeStems.length > 0 && lit.length === 0,
        lit.length ? `stroke-opacity ${lit[0].stemMax} at ${Math.round(lit[0].t)}ms` : `${beforeStems.length} frames before ${STEMS_AT}ms, stroke-opacity 0 in all`)
    }
    console.log(`         first contentful paint: ${Math.round(cold.fcp)}ms`)
    await cold.page.close()

    /* ── the resting state ── */
    heading('The resting state and the ways out')
    const seen = await timelineFor(fresh, '/', 700)   // same context: intro already consumed
    const rest = seen.frames[0]
    check('a returning visit shows the resting frame at once', atRest(rest) && !rest.attr, restDetail(rest))
    check('a returning visit never hides the brand', seen.frames.length > 0 && seen.frames.every(atRest))
    await seen.page.close()

    const replay = await timelineFor(fresh, '/?intro=1')
    check('?intro=1 replays the sequence', replay.frames[0]?.word === 0 && replay.frames[0]?.attr && atRest(replay.frames.at(-1)),
      `first ${restDetail(replay.frames[0])}; last ${restDetail(replay.frames.at(-1))}`)
    await replay.page.close()

    const interrupted = await browser.newContext()
    const nx = await timelineFor(interrupted, '/?next=%2Fsessions%2Fabc', 700)
    check('?next= skips the intro and shows the resting frame', atRest(nx.frames[0]) && !nx.frames[0]?.attr, restDetail(nx.frames[0]))
    await nx.page.close(); await interrupted.close()

    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    const rm = await timelineFor(reduced, '/', 700)
    check('prefers-reduced-motion shows the resting frame from the first sample, and never moves',
      rm.frames.length > 0 && rm.frames.every((f) => atRest(f) && !f.attr),
      `${rm.frames.length} frames; first ${restDetail(rm.frames[0])}`)
    await rm.page.close(); await reduced.close()

    /* Reduced motion with the attribute forced on. The inline script declines
     * to set data-intro under reduced motion, so the check above passes even if
     * the CSS has lost its own gate — which is the second, independent half of
     * the arrangement. Force the attribute and ask the CSS alone. */
    {
      const rctx = await browser.newContext({ reducedMotion: 'reduce' })
      const rp = await rctx.newPage()
      await rp.goto(base + '/?next=%2Fx', { waitUntil: 'domcontentloaded' })
      const r = await rp.evaluate(async () => {
        document.documentElement.setAttribute('data-intro', '1')
        document.documentElement.setAttribute('data-boot', '1')
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
        const n = (sel) => document.querySelectorAll(sel).length
        return {
          introAnims: document.getAnimations().filter((a) => a.effect?.target?.closest?.('.cv-intro')).length,
          shellAnims: document.getAnimations().filter((a) => a.effect?.target?.closest?.('#cv-boot')).length,
          introPieces: n('.cv-intro .op-leaf'), shellPieces: n('#cv-boot .op-leaf'),
        }
      })
      check('the CSS itself plays nothing under reduced motion, in the intro or the shell',
        r.introPieces === BAR_COUNT && r.shellPieces === BAR_COUNT && r.introAnims === 0 && r.shellAnims === 0,
        JSON.stringify(r))
      await rctx.close()
    }

    // If the bundle never arrives, nothing must be left invisible. With
    // JavaScript off the inline script does not run either, so this is the
    // markup's plain style alone — which must be the whole lockup.
    const nojs = await browser.newContext({ javaScriptEnabled: false })
    const p = await nojs.newPage()
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' })
    await p.waitForTimeout(300)
    const noJs = await p.evaluate(() => {
      const root = document.querySelector('.cv-intro')
      if (!root) return null
      const op = (el) => parseFloat(getComputedStyle(el).opacity)
      const leaves = [...root.querySelectorAll('.op-leaf')].map(op)
      return { word: op(root.querySelector('.op-word')), slogan: op(root.querySelector('.op-slogan')), leafMin: Math.min(...leaves), leaves: leaves.length }
    }).catch(() => null)
    check('with JavaScript dead the name, the line and the wreath are shown',
      !!noJs && noJs.word === 1 && noJs.slogan === 1 && noJs.leafMin === 1 && noJs.leaves === BAR_COUNT, JSON.stringify(noJs))
    await nojs.close()

    /* The "/" intro with the bundle dead but the inline script alive — the
     * slow phone, not the disabled-JS one. data-intro is set, so the CSS plays;
     * nothing will ever hydrate to remove the attribute. The opening must still
     * resolve on its own (its fill mode holds the end frame), not sit at its
     * first frame waiting for an effect. */
    {
      const dctx = await browser.newContext()
      const dp = await dctx.newPage()
      await dp.route('**/_next/static/chunks/**', () => { /* hang */ })
      await dp.addInitScript(TIMELINE_INIT)
      await dp.goto(base + '/?intro=1', { waitUntil: 'commit' })
      await dp.waitForTimeout(SEQUENCE_MS + 700)
      const d = await dp.evaluate(() => window.__cv)
      const last = d.frames.at(-1)
      check('with every chunk hung, the "/" intro still plays and resolves',
        d.frames[0]?.attr === true && d.frames[0]?.word === 0 && d.frames.some((f) => f.barMax > 0.9) && last?.word === 1 && last?.slogan === 1 && last?.leafMin === 1,
        `first ${restDetail(d.frames[0])}; last ${restDetail(last)}`)
      await dctx.close()
    }

    /* ── fonts ── */
    heading('Typography actually resolves')
    const fp = await fresh.newPage()
    await fp.goto(base + '/', { waitUntil: 'load' })
    const fonts = await fp.evaluate(async () => {
      await document.fonts.ready
      const probe = (v) => {
        const d = document.createElement('div'); d.style.fontFamily = v
        document.body.appendChild(d); const c = getComputedStyle(d).fontFamily; d.remove(); return c
      }
      const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

      /* Nothing on the page consumes --font-cast yet, so its face is registered
       * but never activated and `document.fonts.ready` says nothing about it.
       * Force the load, then ask whether a real face answered. */
      const castToken = token('--font-cast')
      const castFirst = (castToken.split(',')[0] || '').trim().replace(/^["']|["']$/g, '')
      let castFaceStatus = 'no family named'
      if (castFirst) {
        try { await document.fonts.load(`700 100px "${castFirst}"`) } catch { /* reported below */ }
        const faces = [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === castFirst)
        castFaceStatus = faces.length ? (faces.some((f) => f.status === 'loaded') ? 'loaded' : faces.map((f) => f.status).join('/')) : 'no @font-face in the document'
      }

      /* The same question for every token: does the first family it names have
       * a real @font-face in the document, and does that face load? This is
       * what catches the face and the variable disagreeing about a name — a
       * next/font/local `declarations` font-family override does exactly that,
       * and every substring check above still passes on it. */
      const faceStatus = async (name, weight) => {
        const first = (token(name).split(',')[0] || '').trim().replace(/^["']|["']$/g, '')
        if (!first) return { first, status: 'no family named' }
        try { await document.fonts.load(`${weight} 20px "${first}"`) } catch { /* reported below */ }
        const faces = [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === first)
        return { first, status: faces.length ? (faces.some((f) => f.status === 'loaded') ? 'loaded' : faces.map((f) => f.status).join('/')) : 'no @font-face in the document' }
      }
      const faces = {
        '--font-sans': await faceStatus('--font-sans', 400),
        '--font-display': await faceStatus('--font-display', 400),
        '--font-mono': await faceStatus('--font-mono', 400),
      }

      /* A surname outside latin-1 is set in the family it was styled in, not
       * half in a fallback. Loading the text makes the browser fetch whichever
       * subsets it needs; then a face of this family must be loaded whose
       * unicode-range covers each of these letters. */
      const covers = (range, cp) => range.split(',').some((part) => {
        const body = part.trim().replace(/^U\+/i, '')
        // U+?? is the minified form of U+0000-00FF: ? is a wildcard hex digit
        const [lo, hi] = body.includes('?')
          ? [parseInt(body.replace(/\?/g, '0'), 16), parseInt(body.replace(/\?/g, 'F'), 16)]
          : body.split('-').map((h) => parseInt(h, 16))
        return cp >= lo && cp <= (Number.isFinite(hi) ? hi : lo)
      })
      const NAMES = 'Kovačević Nguyễn'
      const extended = {}
      for (const [name, weight] of [['--font-sans', 400], ['--font-display', 400], ['--font-mono', 400], ['--font-cast', 700]]) {
        const fam = (token(name).split(',')[0] || '').trim().replace(/^["']|["']$/g, '')
        try { await document.fonts.load(`${weight} 20px "${fam}"`, NAMES) } catch { /* reported below */ }
        const loaded = [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === fam && f.status === 'loaded')
        extended[name] = { fam, missing: [...new Set(NAMES.replace(/\s/g, ''))].filter((ch) => !loaded.some((f) => covers(f.unicodeRange, ch.codePointAt(0)))) }
      }

      /* Width of one string set in several families. A family that is not
       * present renders in the browser's default font, so two families that
       * measure the same are the same used font — which is how "it resolves"
       * is told apart from "it fell through to the end of the list". */
      const widthIn = (fam) => {
        const s = document.createElement('span')
        s.textContent = 'HAMBURGEFONSTIV'
        s.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:100px;font-weight:700;white-space:nowrap'
        s.style.fontFamily = fam
        document.body.appendChild(s)
        const w = Math.round(s.getBoundingClientRect().width)
        s.remove()
        return w
      }

      return {
        display: probe('var(--font-display)'),
        sans: probe('var(--font-sans)'),
        mono: probe('var(--font-mono)'),
        cast: probe('var(--font-cast)'),
        castToken,
        castFirst,
        castFaceStatus,
        widths: castFirst
          ? { cast: widthIn('var(--font-cast)'), named: widthIn(`"${castFirst}"`), genericTail: widthIn('sans-serif'), body: widthIn('var(--font-sans)') }
          : null,
        loaded: [...new Set([...document.fonts].map((f) => f.family))],
        faces,
        extended,
      }
    })
    // A var() that is unresolved where the token is declared invalidates the
    // whole declaration and takes the literal fallbacks with it — the screen
    // silently drops to the browser default serif. Ask the browser, not the CSS.
    check(`--font-display resolves to ${FAMILY.display}`, fonts.display.includes(FAMILY.display), fonts.display)
    check(`--font-sans resolves to ${FAMILY.sans}`, fonts.sans.includes(FAMILY.sans), fonts.sans)
    check(`--font-mono resolves to ${FAMILY.mono}`, fonts.mono.includes(FAMILY.mono), fonts.mono)
    for (const [name, f] of Object.entries(fonts.faces)) {
      check(`the family ${name} names ("${f.first}") is a loaded @font-face`, f.status === 'loaded',
        `status: ${f.status}. Loaded faces: ${fonts.loaded.join(', ')}`)
    }
    for (const [name, e] of Object.entries(fonts.extended)) {
      check(`${name}: "Kovačević Nguyễn" is set entirely in ${e.fam}`, e.missing.length === 0,
        `no loaded ${e.fam} face covers: ${e.missing.join(' ')}`)
    }
    check('no token collapsed to the default serif', !/^(serif|Times)/.test(fonts.display.trim()))

    /* ── The fourth family, asked four different ways ──────────────────────
     *
     * --font-cast is the scoreboard voice, and it arrived with the same bug the
     * three above are checked for: the next/font `variable` and the :root alias
     * were both called --font-cast, so the alias referenced a name nothing
     * defined. A custom property whose value contains an unresolvable var() is
     * guaranteed-invalid, which makes every `font-family: var(--font-cast)`
     * invalid at computed-value time. Crucially that does NOT fall back to the
     * literals written right next to it — it inherits, so the text lands on
     * whatever the parent was using and looks merely wrong rather than broken.
     *
     * So a substring check on the computed font-family, on its own, is weak: it
     * passes whenever the token happens to inherit something whose name
     * contains the word. Four legs instead:
     *
     *   1. the custom property itself computes to something. Guaranteed-invalid
     *      reads back as the empty string, which is the bug's own fingerprint.
     *   2. no literal `var(` survives in the computed value — a substitution
     *      that never happened.
     *   3. the family the token actually names has a real @font-face in the
     *      document and that face loads. This is the leg that catches the build
     *      dropping the font, and it reads the name out of the browser rather
     *      than hardcoding it, so Google renaming the family again cannot make
     *      it lie.
     *   4. the used font is the named family and not the tail of the list. Two
     *      families that measure identically are the same used font; a fallback
     *      chain that ran to `sans-serif` measures as `sans-serif`.
     */
    check(
      '--font-cast computes to a real value (not guaranteed-invalid)',
      fonts.castToken.length > 0 && !fonts.castToken.includes('var('),
      fonts.castToken
        ? `--font-cast = ${fonts.castToken}`
        : '--font-cast computed to the empty string — its var() resolved to nothing, so every font-family using it is invalid at computed value time and silently inherits',
    )
    check(`--font-cast resolves to ${FAMILY.cast}`, fonts.cast.includes(FAMILY.cast), fonts.cast)
    check(
      `the family --font-cast names ("${fonts.castFirst}") is a loaded @font-face`,
      fonts.castFaceStatus === 'loaded',
      `status: ${fonts.castFaceStatus}`,
    )
    check(
      '--font-cast renders in that family, not in the fallback tail',
      Boolean(fonts.widths) && fonts.widths.cast === fonts.widths.named && fonts.widths.cast !== fonts.widths.genericTail,
      fonts.widths
        ? `HAMBURGEFONSTIV @100px/700: var(--font-cast)=${fonts.widths.cast}px, "${fonts.castFirst}"=${fonts.widths.named}px, sans-serif=${fonts.widths.genericTail}px, body=${fonts.widths.body}px`
        : 'no family to measure',
    )
    console.log(`         faces loaded: ${fonts.loaded.filter((f) => !f.includes('Fallback')).join(', ')}`)
    await fp.close()

    /* ── the boot shell ── */
    heading('The boot shell (cold start on the app pages)')
    const shellState = async (ctx, url) => {
      const pg = await ctx.newPage()
      await pg.goto(base + url, { waitUntil: 'domcontentloaded' })
      const s = await pg.evaluate(() => {
        const el = document.getElementById('cv-boot')
        return {
          boot: document.documentElement.hasAttribute('data-boot'),
          intro: document.documentElement.hasAttribute('data-intro'),
          display: el ? getComputedStyle(el).display : 'MISSING',
        }
      })
      await pg.close()
      return s
    }
    const forced = await shellState(await browser.newContext(), '/?splash=1')
    check('?splash=1 arms the shell and paints it', forced.boot && forced.display === 'block', JSON.stringify(forced))
    const notApp = await shellState(await browser.newContext(), '/signup')
    check('a non-app page arms nothing', !notApp.boot && !notApp.intro && notApp.display === 'none', JSON.stringify(notApp))

    /* ── the way out of the first painted frame ──
     *
     * The shell is fixed, full-bleed and z-index 9000, and it is on screen
     * before any of the app's JavaScript has run. ColdStartSplash attaches a
     * pointerdown handler that dismisses it — but only once React has
     * hydrated, which is the whole megabyte this shell exists to cover. So for
     * the entire window that matters, a tap landed on an inert div and was
     * thrown away: the user pressed the screen, nothing happened, and they
     * pressed it again.
     *
     * The escape now lives in the inline pre-paint script, so it exists from
     * the first frame. This check is deliberately hostile to that fix: it taps
     * without ever waiting for hydration or for the React splash to mount. If
     * the handler goes back to being attached in the component, this fails. */
    const escCtx = await browser.newContext()
    const esc = await escCtx.newPage()
    await esc.goto(base + '/?splash=1', { waitUntil: 'commit' })
    await esc.waitForSelector('#cv-boot', { state: 'attached' })
    const armed = await esc.evaluate(() => document.documentElement.hasAttribute('data-boot'))
    await esc.mouse.down()
    await esc.mouse.up()
    const afterTap = await esc.evaluate(() => ({
      boot: document.documentElement.hasAttribute('data-boot'),
      display: getComputedStyle(document.getElementById('cv-boot')).display,
    }))
    check('the boot shell arms before hydration', armed)
    check(
      'one tap on the first painted frame dismisses the shell',
      !afterTap.boot && afterTap.display === 'none',
      JSON.stringify(afterTap),
    )
    await escCtx.close()

    /* ── the shell must not be waiting on a second request ──
     *
     * The build-output check bans a `<link rel="stylesheet">` in the document.
     * This is the same rule asked of the browser instead of the HTML, because
     * the HTML is not the only way a render-blocking request can appear, and
     * because what actually matters is the observable behaviour: is the brand
     * on screen when the network has given us nothing but the document?
     *
     * The mechanism this exists for. app/layout.tsx states that the boot shell
     * "may not depend on JavaScript, on the CSS chunk, or on the webfont" —
     * and it did depend on the CSS chunk, in two ways at once. A stylesheet
     * link blocks rendering, so no pixel of the shell could paint until it
     * landed; and it also parser-blocks the inline <script> that arms the
     * shell, which is emitted after it, so `data-boot` was not even set. The
     * entire body — shell included — was still unparsed. Measured on a
     * slow-3G/6x-CPU profile: document complete at 606ms, first paint 1568ms.
     * Delaying only the stylesheet by two seconds on a fast connection moved
     * first paint to 2056ms with every script already on disk at 145ms, which
     * is the causal proof.
     *
     * So: stall every stylesheet, forever, and ask whether the shell is up.
     * If this fails, the app opens to a blank screen for as long as one extra
     * request takes, on every cold start, and no amount of tuning the
     * animation that follows can cover it. */
    heading('The boot shell does not wait for a second request')
    const stallCtx = await browser.newContext()
    const stall = await stallCtx.newPage()
    // Never fulfilled and never continued: the request hangs for the life of
    // the page, which is the worst case a real network can produce.
    await stall.route('**/*.css', () => { /* hang */ })
    await stall.goto(base + '/?splash=1', { waitUntil: 'commit' })
    await stall.waitForTimeout(1500)
    const stalled = await stall.evaluate(() => {
      const el = document.getElementById('cv-boot')
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      return {
        armed: document.documentElement.hasAttribute('data-boot'),
        display: el ? getComputedStyle(el).display : 'MISSING',
        wordmark: el ? (el.querySelector('.op-word')?.textContent ?? '') : '',
        ground: el ? getComputedStyle(el).backgroundColor : '',
        groundImage: el ? getComputedStyle(el).backgroundImage : '',
        htmlGround: getComputedStyle(document.documentElement).backgroundColor,
        fcp: fcp ? Math.round(fcp.startTime) : 0,
      }
    }).catch((e) => ({ error: String(e) }))
    check(
      'the shell arms with every stylesheet stalled',
      stalled.armed === true,
      JSON.stringify(stalled),
    )
    check(
      'the shell is painted with every stylesheet stalled',
      stalled.display === 'block' && stalled.wordmark === 'Pindar' && stalled.fcp > 0,
      JSON.stringify(stalled),
    )
    /* And it is painted in the brand's ink, not in nothing.
     *
     * The old React splash set its own background to var(--grad-ink), which is
     * declared in globals.css — the request being stalled here. An unresolved
     * var() makes the declaration invalid, so a fixed, full-bleed, z-index
     * 9000 element painted transparent over an html element that also had no
     * background yet. That is a black screen on a phone in dark mode, made
     * entirely out of correct-looking lines. */
    check(
      'the ground is the brand ink with no stylesheet at all',
      /rgb\(31, ?36, ?33\)/.test(stalled.ground ?? '') && /linear-gradient/.test(stalled.groundImage ?? ''),
      `#cv-boot background-color = ${stalled.ground}, image = ${(stalled.groundImage ?? '').slice(0, 60)}, html = ${stalled.htmlGround}`,
    )
    await stallCtx.close()

    /* ── One ground, from the tap on the icon to the app ─────────────────────
     *
     * A cold start is painted by four different things in turn: the operating
     * system (the manifest's background_color on Android, an
     * apple-touch-startup-image on iOS), the document before its stylesheet
     * (the inline html rule in app/layout.tsx), the boot shell, and the app.
     * Each is a separate literal in a separate file, three of them written in
     * hex because they paint before any CSS variable exists — so each one can
     * drift from the app on its own, and every drift has shipped:
     *
     *   · the launch screen was near-black for months against an ivory app, via
     *     a stale public/manifest.webmanifest;
     *   · when the app went to Stadium Night ink on 2026-09-25, the manifest and
     *     the inline html rule stayed ivory — a full-screen ~92% luminance
     *     jump on every Android launch — and the html rule also pinned the
     *     canvas to ivory for the life of the page, because body's background
     *     only propagates to the canvas when html has none of its own.
     *
     * Nothing about either is visible to tsc, eslint or next build, and a
     * check that names a colour ("not the old near-black") inverts the moment
     * the design does. So every surface is compared with what the browser
     * computes the app's ground to be, and the whole handoff is measured as
     * luminance. */
    heading('One ground, from the tap on the icon to the app')
    const { default: sharp } = await import('sharp').catch(() => ({ default: null }))
    if (!sharp) check('sharp is available to decode frames', false, 'it ships with next; run npm ci')
    const gCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const gPage = await gCtx.newPage()
    await gPage.goto(base + '/signup', { waitUntil: 'load' })
    const ground = await gPage.evaluate(() => {
      const cs = (e) => getComputedStyle(e)
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--bg)'
      document.body.appendChild(probe)
      const token = cs(probe).backgroundColor
      probe.remove()
      const loaded = { token, body: cs(document.body).backgroundColor, html: cs(document.documentElement).backgroundColor }
      const meta = {
        theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
        scheme: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? null,
      }
      // The document as it is before any app stylesheet: only the boot CSS in
      // force. With inlineCss the app's CSS arrives in the same response, but
      // the inline html rule exists for the case where it does not, and that
      // is the case this reproduces.
      let off = 0
      for (const sh of document.styleSheets) {
        const n = sh.ownerNode
        if (n && n.textContent && n.textContent.includes('#cv-boot')) continue
        sh.disabled = true; off++
      }
      const bare = { html: cs(document.documentElement).backgroundColor, scheme: cs(document.documentElement).colorScheme, off }
      for (const sh of document.styleSheets) sh.disabled = false
      // Expose the canvas: a body shorter than the screen, then look below it.
      document.body.style.cssText += ';height:120px;min-height:0;overflow:hidden'
      return { loaded, meta, bare }
    })
    const canvasPx = sharp ? await sharp(await gPage.screenshot({ clip: { x: 8, y: 700, width: 1, height: 1 } })).raw().toBuffer() : null
    const canvas = canvasPx ? '#' + [...canvasPx.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() : '?'
    await gCtx.close()

    const APP = toHex(ground.loaded.body)
    console.log(`         app ground: body ${APP}, --bg ${toHex(ground.loaded.token)}`)
    check(
      'the app ground is the --bg token (body paints it)',
      APP === toHex(ground.loaded.token) && APP !== 'transparent',
      `body ${APP}, --bg ${toHex(ground.loaded.token)}`,
    )
    const bgc = String(SERVED_MANIFEST?.background_color ?? '').toUpperCase()
    check(
      "the launch screen is the app's own ground",
      bgc === APP,
      `served background_color ${bgc || 'none'}, app ground ${APP} — this is the whole first frame of an Android cold start; any difference is a full-screen jump into the app`,
    )
    const tc = String(SERVED_MANIFEST?.theme_color ?? '').toUpperCase()
    check(
      'theme_color and the theme-color meta are the app ground too',
      tc === APP && String(ground.meta.theme ?? '').toUpperCase() === APP,
      `manifest theme_color ${tc || 'none'}, <meta theme-color> ${ground.meta.theme}, app ground ${APP}`,
    )
    check(
      'before any stylesheet, html is already the app ground',
      toHex(ground.bare.html) === APP,
      `html with only the boot CSS in force (${ground.bare.off} sheet(s) disabled): ${toHex(ground.bare.html)} vs ${APP}`,
    )
    check(
      'the canvas is the app ground, not a colour html pinned it to',
      canvas === APP,
      `pixel below a shortened body ${canvas}, html ${toHex(ground.loaded.html)}, body ${APP} — html having its own background stops body's from reaching the canvas: overscroll, short pages and the pre-hydration bail-out all show it`,
    )
    check(
      "the browser's own defaults are dark before any stylesheet",
      ground.bare.scheme.includes('dark') && String(ground.meta.scheme ?? '').includes('dark'),
      `html color-scheme with only the boot CSS: ${ground.bare.scheme}; <meta name=color-scheme> ${ground.meta.scheme}`,
    )

    /* ── The shell's first and last frames, frozen ──
     *
     * The boot shell is pure CSS animation, so its frames can be seeked
     * exactly rather than sampled against a wall clock: pause every animation
     * and set its currentTime. Chunks are hung so the app never dismisses it,
     * and the three dismissals are neutralised so the dead-man's switch cannot
     * fire mid-measurement. */
    const openShell = async (w, h, dpr = 1) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr })
      const pg = await ctx.newPage()
      await pg.route('**/_next/static/chunks/**', () => { /* hang */ })
      await pg.goto(base + '/?splash=1', { waitUntil: 'commit' })
      await pg.waitForSelector('#cv-boot .op-slogan', { state: 'attached' })
      const end = await pg.evaluate(async () => {
        window.__cvBootLeave = () => {}
        // Only the shell's own animations. The page underneath has looping
        // ones with an infinite end time, and they are not this film.
        window.__cvShellAnims = () => document.getAnimations()
          .filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#cv-boot'))
        const anims = window.__cvShellAnims()
        anims.forEach((a) => a.pause())
        return Math.max(0, ...anims.map((a) => a.effect.getComputedTiming().endTime))
      })
      // Opacity and transform animations run on the compositor, so a seek
      // from script is on screen only once a frame has committed. Two
      // animation frames, so what is captured is the seek.
      const seek = (t) => pg.evaluate((tt) => {
        window.__cvShellAnims().forEach((a) => { a.pause(); a.currentTime = Math.min(tt, a.effect.getComputedTiming().endTime) })
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }, t)
      // Straight from the compositor. page.screenshot() first waits on
      // document.fonts.ready, and with the chunks hung and several hundred
      // captures per run that wait timed out once on a loaded machine. The
      // shell uses only the system stack, so there is nothing to wait for.
      //
      // The clip is not optional. Without it, under an emulated pixel ratio,
      // the capture comes back at CSS-pixel size — 320x568 for a 640x1136
      // device — and comparing that, upscaled, with a launch image read as a
      // 0.86% drift on three geometries that was really resampling blur.
      const cdp = await ctx.newCDPSession(pg)
      const shot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', {
        format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: dpr },
      })).data, 'base64')
      return { ctx, pg, end, seek, shot }
    }

    /* ── Every launch image is the shell's resting frame ──
     *
     * The OS paints the launch image; the webview then paints the shell. They
     * are supposed to be the same picture — tools/build-launch-images.mjs
     * renders them from literals that "must match #cv-boot", and its header
     * said this harness compared the two. It did not; nothing did. A change of
     * ground, a moved mark or a regenerated set from a stale generator would
     * have been a visible jump on every iPhone, green. */
    let devices = []
    try {
      devices = JSON.parse(execFileSync(process.execPath,
        [join(ROOT, 'tools', 'build-launch-images.mjs'), '--list'], { encoding: 'utf8' }))
    } catch { /* reported below */ }
    const drift = []
    let worstDrift = { frac: 0, mean: 0, file: '' }
    const ownGround = []
    if (sharp) {
      for (const d of devices) {
        const png = join(ROOT, 'public', 'splash', d.file)
        if (!existsSync(png)) { drift.push(`${d.file} missing`); continue }
        // At the device's own pixel ratio, as the generator renders it, so
        // the comparison is pixel for pixel rather than through a resample.
        const pw = d.w * d.dpr, ph = d.h * d.dpr
        const { ctx, end, seek, shot } = await openShell(d.w, d.h, d.dpr)
        await seek(end)
        const rest = await lumaFrame(await shot(), pw, ph)
        await ctx.close()
        const launch = await lumaFrame(readFileSync(png), pw, ph)
        const s = swing(launch, rest)
        if (s.frac > worstDrift.frac) worstDrift = { ...s, file: d.file }
        // 0.5% of pixels / mean ΔL 0.006. The regenerated set measures 0.08% and
        // 0.0028 — palette dither on a 32-colour PNG. The 7px wordmark drift
        // this was written against measured 1.4-2.4%.
        if (s.frac > 0.005 || s.mean > 0.006) drift.push(`${d.file}: ${(s.frac * 100).toFixed(2)}% of the screen swings ≥10%, mean ΔL ${s.mean.toFixed(4)}`)
        // And the ground itself, read straight out of the file: the top-left
        // corner is the gradient's near stop, which is the app ground.
        const { data } = await sharp(png).extract({ left: 2, top: 2, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        const corner = '#' + [...data.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
        if (Math.abs(hexLum(corner) - hexLum(APP)) >= 0.02) ownGround.push(`${d.file} corner ${corner}`)
      }
    }
    check(
      `every one of the ${devices.length} launch images is the boot shell's resting frame`,
      devices.length > 0 && drift.length === 0,
      drift.length ? drift.slice(0, 4).join('; ') + (drift.length > 4 ? ` (+${drift.length - 4} more) — regenerate with npm run build:splash` : ' — regenerate with npm run build:splash')
        : `worst ${worstDrift.file}: ${(worstDrift.frac * 100).toFixed(2)}% of pixels ≥10% apart, mean ΔL ${worstDrift.mean.toFixed(4)}`,
    )
    check(
      'every launch image is grounded in the app ground',
      devices.length > 0 && ownGround.length === 0,
      ownGround.length ? `${ownGround.slice(0, 4).join(', ')} vs app ${APP}` : `all ${devices.length} within ΔL 0.02 of ${APP} at the corner`,
    )

    /* ── The handoff, and the whole cold start, as luminance ──
     *
     * iOS: the launch image for this geometry, then the shell's frames.
     * Android: a flat field of the served background_color (the icon on it is
     * the same on either ground and is left out), then the same frames. The
     * shell is filmed every 20ms across its whole sequence — the bars' fastest
     * pulse is ~180ms, so every swing is seen — then its fade-out, then what
     * it reveals.
     *
     * Two properties. The handoff from the OS into the webview is a single
     * change, not a flash, but a full-screen jump there is the opposite of the
     * calm first second this audience needs, so it is held under the WCAG
     * large-area figure on its own. And the film as a whole must contain no
     * general flash: no area over that figure changing by ≥10% more than
     * three times in any second. Measured on pixels, never asserted from a
     * hex. */
    if (sharp) {
      const W = 390, H = 844, N = W * H
      const iosPng = join(ROOT, 'public', 'splash', 'launch-1170x2532.png')
      const iosFrame = existsSync(iosPng) ? await lumaFrame(readFileSync(iosPng), W, H) : null
      const androidFrame = flatFrame(bgc || '#FFFFFF', N)
      const meters = { ios: flashMeter(N, W), android: flashMeter(N, W) }
      if (iosFrame) meters.ios.push(-1, iosFrame)
      meters.android.push(-1, androidFrame)

      const { ctx, pg, end, seek, shot } = await openShell(W, H)
      let prev = null, firstShell = null, worstStep = { area: 0, frac: 0, mean: 0, at: '' }
      const feed = async (t, label) => {
        const L = await lumaFrame(await shot(), W, H)
        if (!firstShell) firstShell = L
        if (prev) {
          const s = swing(prev, L)
          if (s.area > worstStep.area) worstStep = { ...s, at: label }
        }
        prev = L
        meters.ios.push(t, L); meters.android.push(t, L)
      }
      for (let t = 0; t <= end; t += 20) { await seek(t); await feed(t, `${t}ms`) }
      await seek(end)
      // The way out: the shell's own fade, seeked the same way.
      await pg.evaluate(() => document.documentElement.setAttribute('data-boot-out', '1'))
      const fade = await pg.evaluate(() => {
        const fx = window.__cvShellAnims().filter((a) => a instanceof CSSTransition)
        fx.forEach((a) => a.pause())
        return Math.max(0, ...fx.map((a) => a.effect.getComputedTiming().endTime))
      })
      for (let t = 0; t <= fade; t += 20) {
        await pg.evaluate((tt) => {
          window.__cvShellAnims().filter((a) => a instanceof CSSTransition).forEach((a) => { a.pause(); a.currentTime = tt })
          return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        }, t)
        await feed(end + t, `fade +${t}ms`)
      }
      await pg.evaluate(() => {
        document.documentElement.removeAttribute('data-boot'); document.documentElement.removeAttribute('data-boot-out')
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      await feed(end + fade + 20, 'the page under the shell')
      await ctx.close()

      const hIos = iosFrame ? swing(iosFrame, firstShell) : null
      const hAnd = swing(androidFrame, firstShell)
      const pct = (s) => `${(s.frac * 100).toFixed(1)}% of the screen (${s.area}px²) swings ≥10%, mean ΔL ${s.mean.toFixed(3)}`
      check(
        'iOS: launch image → first shell frame is not a large-area swing',
        Boolean(hIos) && hIos.area < FLASH_AREA_PX,
        hIos ? `${pct(hIos)} — limit ${FLASH_AREA_PX}px²` : 'no launch image for 390x844@3',
      )
      check(
        'Android: background_color → first shell frame is not a large-area swing',
        hAnd.area < FLASH_AREA_PX,
        `${bgc} → shell: ${pct(hAnd)} — limit ${FLASH_AREA_PX}px²`,
      )
      const rI = meters.ios.result(), rA = meters.android.result()
      check(
        'no general flash anywhere in the cold start (WCAG 2.3.1)',
        rI.failing < FLASH_AREA_PX && rA.failing < FLASH_AREA_PX && rI.bursts < 7 && rA.bursts < 7,
        `${rI.frames} frames. Large-area transitions (≥${FLASH_AREA_PX}px² at once): ${rI.events} in the whole film, at most ${Math.max(rI.bursts, rA.bursts)} in any second (limit 6). ` +
        `Worst: ${Math.max(rI.peakFlashesPerSecond, rA.peakFlashesPerSecond)} flashes/s at any pixel; ` +
        `area over 3/s: iOS ${rI.failing}px² (${rI.where}), Android ${rA.failing}px² (limit ${FLASH_AREA_PX}); ` +
        `area with any flash at all: iOS ${rI.anyFlash}px², Android ${rA.anyFlash}px²`,
      )
      check(
        'no large area goes light and back in the shell cold start — not even once',
        rI.pairs.length === 0 && rA.pairs.length === 0,
        rI.pairs.length || rA.pairs.length ? [...new Set([...rI.pairs, ...rA.pairs])].slice(0, 3).join('; ') : `${rI.events} large-area transition(s) in the film, none reversed`,
      )
      console.log(`         largest single step inside the shell: ${pct(worstStep)} at ${worstStep.at}`)

      /* ── The opening's flicker is small, measured as area ──
       *
       * Stricter than 2.3.1, and on purpose. The montage this replaced was held
       * to "no pixel changes by 10% between frames", because its figures were
       * full-height and turned over every 70ms. The opening cannot meet that
       * and does not need to: its voice bars are sage on ink — a ~50% swing —
       * but they are thin, and what keeps it calm is that they are SMALL.
       * Everything else in it (the leaves, the stems, the name, the line)
       * arrives once and stays, which is one transition, not a flash.
       *
       * So the rule is asserted on area: film the shell's own sequence alone,
       * count every pixel that goes through even ONE flash — a ≥10% swing and
       * back within a second — and sum that over the whole screen, not per 10°
       * field. That total must stay under WCAG's large-area figure.
       *
       * Measured 2026-10-09, each group filmed alone: the bars 6,565px² — it
       * is their FLIGHT that flickers, a rotated bar sweeping its length
       * across the ground, so bar length matters and bar width barely does
       * (2.7× wider: 7,793) — the leaves' overshoot rim 3,172, the name 1,434,
       * the stems 442, the line 0. Together ~10,000 of 21,824, so there is
       * about 2× headroom: bars 2.5× longer measured 15,103 and passed. The
       * opening drawn at 380px instead of 210 measured 27,737 and failed —
       * while the WCAG 2.3.1 check above stayed green on the same film, which
       * is the sense in which this one is stricter. Flicker area scales with
       * the size of the picture; a bigger wreath is the change to watch. */
      {
        const { ctx: fctx, end: fend, seek: fseek, shot: fshot } = await openShell(W, H)
        const solo = flashMeter(N, W)
        let fFrames = 0
        for (let t = 0; t <= fend; t += 20) {
          await fseek(t)
          solo.push(t, await lumaFrame(await fshot(), W, H))
          fFrames++
        }
        await fctx.close()
        const r = solo.result()
        check(
          'the opening\'s flicker stays small: the area that flashes even once is under the WCAG large-area figure',
          fFrames > 50 && r.anyFlash > 0 && r.anyFlash < FLASH_AREA_PX,
          `${fFrames} frames of the shell's sequence alone: ${r.anyFlash}px² goes through at least one flash (limit ${FLASH_AREA_PX}px², summed over the whole screen); ` +
          `worst ${r.peakFlashesPerSecond} flashes/s at any pixel` + (r.anyFlash === 0 ? ' — NOTHING flashed, so the bars were not filmed and nothing was measured' : ''),
        )
      }

      /* ── No stray dots before the stems draw ──
       *
       * Each stem is drawn by animating stroke-dashoffset from 1 to 0, and at
       * offset 1 its length is all gap — but a round line cap is painted at
       * the end of every dash, including an empty one, so the "invisible" stem
       * still put a cream dot at each end: four dots on the ink for the 900ms
       * before the stems start, where nothing else has appeared yet. The fix is
       * a stroke-opacity ramp in the keyframes, held at 0 through the delay by
       * the backwards fill.
       *
       * Asked of the pixels, not the stylesheet: the shell frozen at 150ms,
       * once as it is and once with the stems hidden. Any pixel that differs is
       * a stem pixel on screen before its time. */
      {
        const { ctx: sctx, pg: spg, seek: sseek, shot: sshot } = await openShell(W, H)
        // The bars are hidden in BOTH captures. They are not what is under
        // test, and the SVG re-rasterising between the two captures moved
        // their antialiased edges by up to ΔL 0.06 — noise that, left in,
        // would make this check either flaky or too blunt to see a dot.
        await spg.evaluate(() => document.querySelectorAll('#cv-boot .op-bar').forEach((e) => { e.style.visibility = 'hidden' }))
        await sseek(150)
        const withStems = await lumaFrame(await sshot(), W, H)
        const ends = await spg.evaluate(() => [...document.querySelectorAll('#cv-boot .op-stem')].flatMap((p) => {
          const m = p.getScreenCTM()
          return [0, p.getTotalLength()].map((l) => {
            const q = p.getPointAtLength(l).matrixTransform(m)
            return [Math.round(q.x), Math.round(q.y)]
          })
        }))
        await spg.evaluate(() => {
          document.querySelectorAll('#cv-boot .op-stem').forEach((e) => { e.style.visibility = 'hidden' })
          return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        })
        const noStems = await lumaFrame(await sshot(), W, H)
        await sctx.close()
        let lit = 0, maxD = 0
        const hits = []
        for (let i = 0; i < N; i++) {
          const d = Math.abs(withStems[i] - noStems[i])
          if (d > maxD) maxD = d
          if (d >= 0.03) { lit++; if (hits.length < 4) hits.push(`(${i % W},${(i / W) | 0})`) }
        }
        check(
          `no stem pixel is painted at 150ms, before the stems start at ${STEMS_AT}ms (the round-cap dots)`,
          ends.length === 4 && lit === 0,
          lit ? `${lit} px differ when the stems are hidden (max ΔL ${maxD.toFixed(3)}), e.g. ${hits.join(' ')}; stem ends at ${ends.map((e) => e.join(',')).join(' / ')}`
            : `stems hidden vs shown at 150ms: max ΔL ${maxD.toFixed(4)} over the whole screen; ends at ${ends.map((e) => e.join(',')).join(' / ')}`,
        )
      }
    }

    /* ── The other cold start: "/" and its intro ──
     *
     * A signed-out launch — which is every first launch after install — goes
     * from the OS screen to "/", not to the shell, and "/" plays its own intro.
     * The intro is CSS now and could be seeked like the shell, but it is
     * filmed in real time from the compositor with a CDP screencast instead,
     * because the thing worth catching here is the page around it: the sign-in
     * card arriving, hydration, anything that repaints the ground. Same
     * analysis as the shell.
     *
     * The film is what the compositor delivered, so its resolution is
     * reported. A dropped frame merges two steps into one, which can only
     * make the per-frame area look larger (conservative) but could hide a
     * very fast on-off at a single pixel; the intro has none by design.
     *
     * Its voice bars are #A8CBA0 — about a 52% swing against the ink. Each
     * pulses three times and flies off, on a few px² apiece; that is measured
     * here rather than reasoned. */
    if (sharp) {
      const W = 390, H = 844, N = W * H
      const ictx = await browser.newContext({ viewport: { width: W, height: H } })
      const ipg = await ictx.newPage()
      const cdp = await ictx.newCDPSession(ipg)
      const film = []
      cdp.on('Page.screencastFrame', (f) => {
        film.push({ t: f.metadata.timestamp * 1000, data: f.data })
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
      })
      await cdp.send('Page.startScreencast', { format: 'png', maxWidth: W, maxHeight: H, everyNthFrame: 1 })
      await ipg.goto(base + '/', { waitUntil: 'commit' })
      await ipg.waitForTimeout(3600)
      await cdp.send('Page.stopScreencast').catch(() => {})
      const { played, paintAt } = await ipg.evaluate(() => {
        const fp = performance.getEntriesByName('first-paint')[0] || performance.getEntriesByName('first-contentful-paint')[0]
        return {
          played: localStorage.getItem('cv_intro_v1') === '1',
          // Epoch ms of the document's own first paint. The screencast's
          // timestamps are epoch seconds on the same clock.
          paintAt: fp ? performance.timeOrigin + fp.startTime : null,
        }
      })
      await ictx.close()

      const iosPng = join(ROOT, 'public', 'splash', 'launch-1170x2532.png')
      const iosFrame = existsSync(iosPng) ? await lumaFrame(readFileSync(iosPng), W, H) : null
      const androidFrame = flatFrame(bgc || '#FFFFFF', N)
      const mI = flashMeter(N, W), mA = flashMeter(N, W)
      if (iosFrame) mI.push(-1, iosFrame)
      mA.push(-1, androidFrame)
      /* Headless opens every page on about:blank, which is white, and the
       * screencast films it. No user ever sees that frame: on a device the OS
       * launch screen stays up until the document's first paint. So frames
       * from before that paint are dropped — by timestamp, not by colour,
       * because a genuinely white first frame from the document is exactly
       * what this must still catch. */
      const cut = paintAt === null ? Infinity : paintAt - 4
      const dropped = film.filter((f) => f.t < cut).length
      const kept = film.filter((f) => f.t >= cut)
      film.length = 0; film.push(...kept)
      let first = null, gaps = [], prevT = null
      for (const f of film) {
        const L = await lumaFrame(Buffer.from(f.data, 'base64'), W, H)
        if (!first) first = L
        const t = f.t - film[0].t
        if (prevT !== null) gaps.push(t - prevT)
        prevT = t
        mI.push(t, L); mA.push(t, L)
      }
      gaps.sort((a, b) => a - b)
      const med = gaps.length ? Math.round(gaps[gaps.length >> 1]) : 0
      const worstGap = gaps.length ? Math.round(gaps[gaps.length - 1]) : 0
      const pct = (s) => `${(s.frac * 100).toFixed(1)}% of the screen (${s.area}px²) swings ≥10%, mean ΔL ${s.mean.toFixed(3)}`
      /* Not held to the shell's handoff limit, deliberately. The shell's
       * first frame is designed to be the launch image; the first frame of
       * "/" is the sign-in page itself, and its content arriving — once — is
       * the app appearing, not a flash. The ground under it is held by the
       * canvas and --bg checks above, and a light frame on the way in is
       * held by the check below. The number is printed so it is seen. */
      if (first) {
        const hI = iosFrame ? swing(iosFrame, first) : null
        const hA = swing(androidFrame, first)
        console.log(`         launch → first frame of "/" (the page's content arriving): iOS ${hI ? pct(hI) : 'no image'}; Android ${pct(hA)}`)
      }
      const rI = mI.result(), rA = mA.result()
      check(
        'no general flash in the "/" cold start, intro included (WCAG 2.3.1)',
        film.length > 20 && played && rI.failing < FLASH_AREA_PX && rA.failing < FLASH_AREA_PX && rI.bursts < 7 && rA.bursts < 7,
        `${film.length} compositor frames from the document's first paint (${dropped} about:blank frame(s) before it dropped; median ${med}ms apart, worst gap ${worstGap}ms), intro ${played ? 'played' : 'DID NOT PLAY — nothing was measured'}. ` +
        `Large-area transitions: ${rI.events}, at most ${Math.max(rI.bursts, rA.bursts)} in any second (limit 6). ` +
        `Worst ${Math.max(rI.peakFlashesPerSecond, rA.peakFlashesPerSecond)} flashes/s at any pixel; area over 3/s: iOS ${rI.failing}px² (${rI.where}), Android ${rA.failing}px²`,
      )
      check(
        'no large area goes light and back in the "/" cold start — not even once',
        film.length > 20 && rI.pairs.length === 0 && rA.pairs.length === 0,
        rI.pairs.length || rA.pairs.length ? [...new Set([...rI.pairs, ...rA.pairs])].slice(0, 3).join('; ') : `${rI.events} large-area transition(s) from the launch screen on, none reversed`,
      )
    }

    /* ── The opening is legible on its own ground ──
     *
     * Stadium Night lifted --primary so it could be read on ink, and the intro's
     * mark on "/" kept a hard-coded white microphone on it: 1.79:1 and 1.47:1,
     * so the brand's own glyph all but disappeared, and nothing failed. The
     * opening has no tile: the wreath, the name and the line sit straight on
     * whatever ground is behind them, which in the shell is its own gradient
     * and on "/" is the page. So each is measured against every stop of the
     * nearest ground the browser actually paints, with the line's alpha
     * composited — rgba(…, .8) is not the colour it reads as. The wreath is a
     * graphic (3:1, WCAG 1.4.11); "Pindar" is large text (3:1); the line is
     * 20px regular italic, which is body text (4.5:1). */
    const mCtx = await browser.newContext()
    const mPage = await mCtx.newPage()
    await mPage.goto(base + '/?next=%2Fx', { waitUntil: 'load' })
    const marks = await mPage.evaluate(() => {
      const groundOf = (el) => {
        for (let a = el; a; a = a.parentElement) {
          const cs = getComputedStyle(a)
          const stops = cs.backgroundImage.match(/rgba?\([^)]*\)/g)
          if (stops) return stops
          if (!/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.backgroundColor)) return [cs.backgroundColor]
        }
        return [getComputedStyle(document.documentElement).backgroundColor]
      }
      const read = (root) => {
        const r = document.querySelector(root)
        if (!r) return null
        const leaf = r.querySelector('.op-leaf ellipse'), word = r.querySelector('.op-word'), slogan = r.querySelector('.op-slogan')
        if (!leaf || !word || !slogan) return null
        return {
          ground: groundOf(r),
          leaf: getComputedStyle(leaf).fill, word: getComputedStyle(word).color, slogan: getComputedStyle(slogan).color,
        }
      }
      document.documentElement.setAttribute('data-boot', '1')
      return { shell: read('#cv-boot'), intro: read('.cv-intro') }
    })
    await mCtx.close()
    /* Composite an rgba() foreground over an opaque ground, in sRGB, the way
     * the browser does, and return hex. */
    const over = (fg, bg) => {
      const f = String(fg).match(/[\d.]+/g).map(Number), b = String(bg).match(/[\d.]+/g).map(Number)
      const al = f.length > 3 ? f[3] : 1
      return '#' + [0, 1, 2].map((k) => Math.round(f[k] * al + b[k] * (1 - al)).toString(16).padStart(2, '0')).join('').toUpperCase()
    }
    for (const [name, m] of [['boot shell', marks.shell], ['intro on "/"', marks.intro]]) {
      for (const [part, min] of [['leaf', 3], ['word', 3], ['slogan', 4.5]]) {
        const ratios = m ? m.ground.map((g) => contrast(over(m[part], g), toHex(g))) : []
        const label = { leaf: 'wreath', word: '"Pindar"', slogan: `"${SLOGAN}"` }[part]
        check(
          `the ${name}'s ${label} is ≥${min}:1 on its ground`,
          ratios.length > 0 && ratios.every((r) => r >= min),
          m ? `${m[part]} on ${m.ground.map(toHex).join(' → ')}: ${ratios.map((r) => r.toFixed(2) + ':1').join(', ')}` : 'opening not found',
        )
      }
    }

    /* ── the opening plays with the bundle dead ──
     *
     * The montage this replaced stopped playing and every check this project
     * owned stayed green. It was drawn by a React effect inside the page
     * bundle, on a clock anchored to the start of the navigation, so by the
     * time the code could run its own timeline said the sequence was over.
     * tsc, eslint and next build could not have an opinion about any of that.
     *
     * So the hostile version of the question, asked of the opening: kill the
     * bundle outright and ask whether a coach's voice still becomes the
     * wreath — bars pulse, bars fly, leaves sprout bottom to tip, stems draw,
     * the name lands, the line lands. If this passes with every chunk hanging,
     * the opening cannot be late for itself. That is the property.
     */
    heading('The opening plays with every chunk dead')

    const deadCtx = await browser.newContext()
    const dead = await deadCtx.newPage()
    const fetched = []
    dead.on('request', (r) => {
      const u = new URL(r.url())
      if (!u.pathname.startsWith('/_next/static/') && r.resourceType() !== 'document') fetched.push(`${r.resourceType()} ${u.pathname}`)
    })
    // Every page chunk hangs for the life of the page: hydration never starts,
    // which is the worst case a real phone on a real network produces and the
    // exact condition the old implementation could not survive.
    await dead.route('**/_next/static/chunks/**', () => { /* hang */ })
    await dead.goto(base + '/?splash=1', { waitUntil: 'commit' })
    await dead.waitForSelector('#cv-boot .op-slogan', { state: 'attached' })
    const film = await dead.evaluate(async (ms) => {
      const root = document.querySelector('#cv-boot')
      const word = root && root.querySelector('.op-word')
      if (!word) return { error: 'no #cv-boot .op-word' }
      window.__cvBootLeave = () => {}   // nothing may take the shell down mid-film
      const bars = [...root.querySelectorAll('.op-bar')], leaves = [...root.querySelectorAll('.op-leaf')]
      const stems = [...root.querySelectorAll('.op-stem')]
      const slogan = root.querySelector('.op-slogan')
      const centre = (el) => { const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2, b.height] }
      // Where each bar starts and where its leaf ends up, in screen space.
      const barStart = bars.map(centre)
      const op = (el) => Number(getComputedStyle(el).opacity)
      const seen = []
      const t0 = performance.now()
      // The opening's own clock: timeline time since the name's animation
      // started, which is when the shell was first styled. Not
      // performance.now(), which also counts the wait for the document, and
      // not currentTime, which stops when that one animation finishes.
      const wa = word.getAnimations()[0]
      const clock = () => (wa && wa.startTime !== null ? document.timeline.currentTime - wa.startTime : performance.now())
      while (performance.now() - t0 < ms) {
        seen.push({
          t: Math.round(clock()),
          bars: bars.map((b) => { const c = centre(b); return [op(b), c[0], c[1], Math.round(c[2] * 10) / 10] }),
          leaves: leaves.map(op),
          stemOff: stems.map((s) => Number.parseFloat(getComputedStyle(s).strokeDashoffset)),
          stemOp: stems.map((s) => Number(getComputedStyle(s).strokeOpacity)),
          word: op(word), slogan: op(slogan),
        })
        await new Promise((r) => requestAnimationFrame(r))
      }
      return { seen, barStart, leafEnd: leaves.map(centre), clocked: !!wa }
    }, SEQUENCE_MS + 700)

    const frames = film.seen ?? []
    const anim = 0   // t is already opening time
    check('the shell is animating at all (the name has a running animation)', film.clocked === true && frames.length > 60,
      film.error ?? (film.clocked ? `${frames.length} frames on the opening's own clock` : 'no animation on #cv-boot .op-word'))
    const last = frames.at(-1)
    {
      // The bars pulse: each one's rendered height takes several values while
      // it is on screen, not one.
      const heights = new Set()
      for (const f of frames) for (const b of f.bars) if (b[0] > 0.9) heights.add(b[3])
      const firstBar = frames.find((f) => f.bars.some((b) => b[0] > 0.5))
      check('the voice bars appear early and pulse', !!firstBar && firstBar.t - anim < 400 && heights.size >= 6,
        firstBar ? `first bar at +${firstBar.t - anim}ms; ${heights.size} distinct bar heights while fully visible` : 'no bar ever became visible')

      // The bars fly to the wreath: every bar's centre gets at least halfway
      // from where it started to the leaf nearest its final heading.
      let flown = 0
      const worst = []
      film.barStart?.forEach((s, i) => {
        let best = 0
        for (const f of frames) {
          const b = f.bars[i]
          if (b[0] < 0.05) continue
          const d = Math.hypot(b[1] - s[0], b[2] - s[1])
          if (d > best) best = d
        }
        const nearestLeaf = Math.min(...film.leafEnd.map((l) => Math.hypot(l[0] - s[0], l[1] - s[1])))
        if (best >= nearestLeaf * 0.5) flown++
        else worst.push(`b${i} moved ${best.toFixed(0)}px of ${nearestLeaf.toFixed(0)}`)
      })
      check(`all ${BAR_COUNT} bars fly toward the wreath`, flown === BAR_COUNT, worst.length ? worst.slice(0, 4).join('; ') : `${flown} of ${BAR_COUNT}`)

      // Leaves sprout, bottom to tip: none before LEAVES_AT, all by the end,
      // and the tip leaves after the bottom ones.
      const firstLit = (i) => (frames.find((f) => f.leaves[i] > 0.5) ?? { t: Infinity }).t - anim
      const lit = Array.from({ length: BAR_COUNT }, (_, i) => firstLit(i))
      const half = BAR_COUNT / 2
      const early = lit.filter((t) => t < LEAVES_AT - 100)
      check('the leaves sprout after the voice, bottom to tip',
        lit.every(Number.isFinite) && early.length === 0 && lit[half - 1] > lit[0] && lit[BAR_COUNT - 1] > lit[half],
        `first leaf at +${Math.min(...lit)}ms (LEAVES_AT ${LEAVES_AT}); bottom ${lit[0]}/${lit[half]}ms, tips ${lit[half - 1]}/${lit[BAR_COUNT - 1]}ms`)

      // The stems draw: the dash offset passes through the middle of its range.
      const drawing = frames.some((f) => f.stemOff.some((o) => o > 0.2 && o < 0.8) && f.stemOp.every((o) => o > 0.5))
      check('the stems draw', drawing && last?.stemOff.every((o) => o === 0))

      const wordAt = (frames.find((f) => f.word > 0.5) ?? { t: Infinity }).t - anim
      const sloganAt = (frames.find((f) => f.slogan > 0.5) ?? { t: Infinity }).t - anim
      check('the name lands after the wreath, then the line',
        wordAt >= WORD_AT - 100 && Number.isFinite(sloganAt) && sloganAt > wordAt && sloganAt >= SLOGAN_AT - 100,
        `"Pindar" at +${wordAt}ms (WORD_AT ${WORD_AT}), "${SLOGAN}" at +${sloganAt}ms (SLOGAN_AT ${SLOGAN_AT})`)

      check('it resolves to the whole lockup with the bars gone',
        !!last && last.word === 1 && last.slogan === 1 && last.leaves.every((o) => o === 1) && last.bars.every((b) => b[0] === 0) && last.stemOp.every((o) => o === 1),
        last ? `word=${last.word} slogan=${last.slogan} leaves min ${Math.min(...last.leaves)} bars max ${Math.max(...last.bars.map((b) => b[0]))}` : film.error)

      /* And it asked the network for nothing to do it. The montage needed an
       * image the shell could not paint without; the opening is the document.
       * Requests here exclude the hung chunks and the document itself. */
      const media = fetched.filter((f) => /^(image|media|font|stylesheet) /.test(f) && !/favicon|icon/.test(f))
      check('the opening needs no request beyond the document', media.length === 0,
        media.length ? media.slice(0, 4).join(', ') : `other requests: ${fetched.join(', ') || 'none'}`)
    }
    await deadCtx.close()

    /* Reduced motion: the resting frame, at once, with nothing moving — never
     * an empty ink screen. Sampled on the first animation frame the page has,
     * not after a settle: "eventually shows the brand" is not the property. */
    const rmCtx = await browser.newContext({ reducedMotion: 'reduce' })
    const rmPage = await rmCtx.newPage()
    await rmPage.route('**/_next/static/chunks/**', () => { /* hang */ })
    await rmPage.goto(base + '/?splash=1', { waitUntil: 'commit' })
    await rmPage.waitForSelector('#cv-boot .op-slogan', { state: 'attached' })
    const rmState = await rmPage.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(r))
      const root = document.querySelector('#cv-boot')
      const op = (el) => Number(getComputedStyle(el).opacity)
      const leaves = [...root.querySelectorAll('.op-leaf')].map(op)
      const bars = [...root.querySelectorAll('.op-bar')].map(op)
      return {
        t: Math.round(performance.now()),
        word: op(root.querySelector('.op-word')), slogan: op(root.querySelector('.op-slogan')),
        leafMin: Math.min(...leaves), barMax: Math.max(...bars),
        anims: document.getAnimations().filter((a) => a.effect?.target?.closest?.('#cv-boot') && !(a instanceof CSSTransition)).length,
      }
    })
    check(
      'reduced motion shows the whole lockup on the first frame, and nothing moves',
      rmState.word === 1 && rmState.slogan === 1 && rmState.leafMin === 1 && rmState.barMax === 0 && rmState.anims === 0,
      JSON.stringify(rmState),
    )
    await rmCtx.close()

    /* ── The shell holds until the name has landed ──
     *
     * The floor (FLOOR_MS in app/layout.tsx) is the earliest the shell may
     * leave when the app says it is ready. It was one second under the
     * montage; for the opening it is the name — leaving earlier cuts it off
     * with the bars in the air. It is asserted as that property, not as a
     * number read back out of the HTML, which would move with the source and
     * prove nothing: the app says "ready" at once, and when the shell starts
     * to leave "Pindar" must already be on screen.
     *
     * Twice: once on a fast document, and once with the document held back
     * 1.2s. The floor used to be measured from navigation start, which was
     * right for the JS-timed montage and wrong for a CSS opening that only
     * starts once the document is here — on the slow document the shell left
     * 767ms into its own animation with the name at opacity 0. The slow
     * launch is the one somebody is actually watching. */
    heading('The shell holds until the name has landed')
    for (const delay of [0, 1200]) {
      const fctx = await browser.newContext()
      const fpg = await fctx.newPage()
      await fpg.route('**/_next/static/chunks/**', () => { /* hang: only our own "ready" below */ })
      if (delay) await fpg.route((u) => new URL(u).pathname === '/', async (r) => { await new Promise((s) => setTimeout(s, delay)); await r.continue() })
      await fpg.goto(base + '/?splash=1', { waitUntil: 'commit' })
      await fpg.waitForSelector('#cv-boot .op-slogan', { state: 'attached' })
      const fl = await fpg.evaluate(async () => {
        await new Promise((r) => requestAnimationFrame(r))
        const word = document.querySelector('#cv-boot .op-word')
        const a = word.getAnimations()[0]
        const clock = () => (a && a.startTime !== null ? document.timeline.currentTime - a.startTime : null)
        const readyAt = a ? a.currentTime : null   // pending on the first frame: 0
        window.__cvBootLeave()   // the app reports ready immediately
        while (!document.documentElement.hasAttribute('data-boot-out') && performance.now() < 9000) {
          await new Promise((r) => requestAnimationFrame(r))
        }
        const leftAt = clock()
        return {
          readyAt: Math.round(readyAt ?? -1),
          leftAt: leftAt === null ? null : Math.round(leftAt),
          word: Number(getComputedStyle(word).opacity),
          out: document.documentElement.hasAttribute('data-boot-out'),
        }
      })
      check(
        `${delay ? `document held ${delay}ms` : 'fast document'}: an early "ready" waits for the name, then goes`,
        fl.out && fl.word >= 0.9 && fl.leftAt !== null && fl.leftAt >= WORD_AT && fl.leftAt < SEQUENCE_MS + 600,
        `ready at ${fl.readyAt}ms into the opening; began leaving at ${fl.leftAt}ms with "Pindar" at opacity ${fl.word.toFixed(2)} (WORD_AT ${WORD_AT})`,
      )
      await fctx.close()
    }

    /* ── nothing scrolls sideways ────────────────────────────────────────────
     *
     * Max, 2026-09-25: "make sure there's no ability to scroll sideways so we
     * can maximise usage."
     *
     * globals.css answers that with `html, body { max-width: 100%; overflow-x:
     * hidden; overflow-x: clip }`. That is containment, not a fix: an element
     * wider than the viewport is still a bug, the clip rule only stops the page
     * lurching while nobody notices. So this measures the cause, not the
     * symptom, and it has to, because the clip rule destroys every convenient
     * symptom there was — `document.documentElement.scrollWidth` reads back
     * clamped to the viewport with clip in force (measured: a 900px div in a
     * 390px viewport leaves documentElement.scrollWidth at 390), so the usual
     * one-line scrollWidth assertion is guaranteed to pass here and prove
     * nothing. Element geometry is unaffected by clipping, which is why this
     * walks the box tree instead.
     *
     * Deliberate horizontal scrollers are exempt: a row inside `overflow-x:
     * auto` is a UI pattern, not a layout escape. Only overflow that reaches
     * the page counts.
     *
     * The narrow viewport is the iPhone SE 1st gen, 320px — the smallest
     * geometry in the launch-image list, so it is a device this app claims to
     * support, not a hypothetical.
     */
    heading('Nothing scrolls sideways')

    const OVERFLOW_PROBE = `(() => {
      const vw = document.documentElement.clientWidth
      const TOL = 1                      /* subpixel layout, not overflow */
      const bad = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const over = Math.max(r.right - vw, -r.left)
        if (over <= TOL) continue
        /* Inside something that is meant to scroll horizontally? Not a bug. */
        let exempt = false
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX
          if (ox === 'auto' || ox === 'scroll') { exempt = true; break }
          if (ox === 'hidden' || ox === 'clip') break
        }
        if (exempt) continue
        const id = el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')
        bad.push({ id, left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), over: Math.round(over) })
      }
      bad.sort((a, b) => b.over - a.over)
      /* Does the page actually move? scroll-behavior is smooth in globals.css,
       * so this must be an instant scroll or it measures an animation. */
      const before = window.scrollX
      window.scrollTo({ left: 99999, top: window.scrollY, behavior: 'instant' })
      const shifted = Math.round(window.scrollX)
      window.scrollTo({ left: before, top: window.scrollY, behavior: 'instant' })
      return {
        vw, shifted,
        bodyScrollW: document.body.scrollWidth,
        htmlOx: getComputedStyle(document.documentElement).overflowX,
        bodyOx: getComputedStyle(document.body).overflowX,
        count: bad.length, worst: bad.slice(0, 6),
      }
    })()`

    const SIDEWAYS_ROUTES = [
      { url: '/', settle: 3600, what: 'the intro resolved' },
      { url: '/?splash=1', settle: 700, what: 'the boot shell mid-opening, bars in flight' },
      { url: '/signup', settle: 500, what: 'the longest form in the app' },
    ]
    const SIDEWAYS_VIEWPORTS = [
      { width: 320, height: 568, label: 'iPhone SE 1st gen' },
      { width: 390, height: 844, label: 'iPhone 14' },
    ]
    for (const vp of SIDEWAYS_VIEWPORTS) {
      for (const route of SIDEWAYS_ROUTES) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
        const pg = await ctx.newPage()
        await pg.goto(base + route.url, { waitUntil: 'load' })
        await pg.waitForTimeout(route.settle)
        const m = await pg.evaluate(OVERFLOW_PROBE)
        check(
          `${vp.width}px (${vp.label}) — nothing on ${route.url} is wider than the viewport`,
          m.count === 0 && m.shifted === 0 && m.bodyScrollW <= m.vw + 1,
          m.count === 0 && m.shifted === 0 && m.bodyScrollW <= m.vw + 1
            ? `${route.what}; body content ${m.bodyScrollW}px in ${m.vw}px`
            : `${m.count} element(s) overflow, body content ${m.bodyScrollW}px in ${m.vw}px, scrollX after a sideways scroll ${m.shifted}` +
              m.worst.map((b) => `\n           ${b.over}px out: ${b.id}  [${b.left} → ${b.right}, width ${b.w}]`).join(''),
        )
        await ctx.close()
      }
    }

    /* ── and the clip must stay `clip` ──
     *
     * `overflow-x: hidden` is listed first only as the fallback for iOS Safari
     * before 16; `clip` immediately after it is what every current browser
     * uses. The difference is not cosmetic. `hidden` makes the element a scroll
     * container, and a scroll container that never scrolls is the scrollport
     * its `position: sticky` descendants stick to — so every sticky header in
     * the app stops sticking. Measured in this harness's own Chromium against
     * /signup with a sticky element at top:0 and the page scrolled 900px:
     * with `clip` it stays at top 0; with `hidden` forced on html and body it
     * is dragged to top -900. Four headers depend on this (app/dashboard two,
     * app/athlete, app/athletes/[id]).
     *
     * So: assert the browser resolved `clip`, and prove the consequence rather
     * than trusting the string. The sticky element is injected, because the
     * four real ones are behind a session this harness has no way to create —
     * this checks the CSS mechanism they all rely on, not those four headers.
     */
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 600 } })
      const pg = await ctx.newPage()
      await pg.goto(base + '/signup', { waitUntil: 'load' })
      const st = await pg.evaluate(async () => {
        const wrap = document.createElement('div')
        wrap.innerHTML = '<div id="cv-sticky-probe" style="position:sticky;top:0;height:40px"></div><div style="height:3000px"></div>'
        document.body.prepend(wrap)
        await new Promise((r) => requestAnimationFrame(r))
        const el = document.getElementById('cv-sticky-probe')
        const top0 = Math.round(el.getBoundingClientRect().top)
        window.scrollTo({ top: 900, behavior: 'instant' })
        await new Promise((r) => setTimeout(r, 150))
        const out = {
          htmlOx: getComputedStyle(document.documentElement).overflowX,
          bodyOx: getComputedStyle(document.body).overflowX,
          top0, top1: Math.round(el.getBoundingClientRect().top), scrollY: Math.round(window.scrollY),
        }
        wrap.remove()
        window.scrollTo({ top: 0, behavior: 'instant' })
        return out
      })
      check(
        'the sideways clamp resolved to `clip`, not `hidden`',
        st.htmlOx === 'clip' && st.bodyOx === 'clip',
        `html overflow-x=${st.htmlOx}, body overflow-x=${st.bodyOx} — \`hidden\` makes both a scroll container and unsticks every sticky header`,
      )
      check(
        'a position: sticky header still sticks under the clamp',
        st.top0 === 0 && st.scrollY === 900 && st.top1 === 0,
        `sticky top ${st.top0} → ${st.top1} after scrolling to ${st.scrollY}; it must not move`,
      )
      await ctx.close()
    }

    /* ── the service worker ──
     *
     * Registration is the half that was missing entirely, so it is checked in
     * a real browser rather than by grepping for the call. The cache contents
     * are checked too: a worker that installs and caches nothing looks exactly
     * like a working one from the outside. */
    heading('The service worker registers and caches')
    const swCtx = await browser.newContext()
    const swPage = await swCtx.newPage()
    await swPage.goto(base + '/', { waitUntil: 'load' })
    const swState = await swPage.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/').catch(() => null)
      if (!reg) return { registered: false }
      // Raced, because .ready never settles for a worker that fails to
      // install, and a hung harness reports nothing at all.
      const ready = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))])
      // .ready resolves while the worker is still 'activating'; give the
      // activate handler (old caches deleted, clients claimed) time to finish.
      const t0 = performance.now()
      while (reg.active && reg.active.state !== 'activated' && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50))
      return { registered: true, ready, state: reg.active?.state ?? reg.installing?.state ?? 'none' }
    })
    check('the worker registers and activates', swState.registered === true && swState.ready === true && swState.state === 'activated', JSON.stringify(swState))
    if (swState.ready) {
      /* With nothing precached, the worker's whole value is the fetch handler
       * caching the content-hashed assets as the page uses them. A worker that
       * activates and caches nothing looks exactly like a working one from the
       * outside, so load the page again under its control and look. */
      await swPage.reload({ waitUntil: 'load' })
      await swPage.waitForTimeout(1200)
      const cacheState = await swPage.evaluate(async () => {
        const keys = await caches.keys()
        const cached = []
        for (const k of keys) for (const r of await (await caches.open(k)).keys()) cached.push(new URL(r.url).pathname)
        return { controlled: !!navigator.serviceWorker.controller, keys, cached }
      })
      const statics = cacheState.cached.filter((p) => p.startsWith('/_next/static/'))
      check(
        'under the worker, the page\'s static assets are cached',
        cacheState.controlled && statics.length > 0,
        `controlled=${cacheState.controlled}, caches ${cacheState.keys.join(', ') || 'none'}: ${statics.length} /_next/static entries of ${cacheState.cached.length}`,
      )
      check('nothing in the cache is the deleted montage sprite', !cacheState.cached.some((p) => p.includes('montage')))
      // The one thing this worker must never do. A cached document names
      // content-hashed chunks that stop existing on the next deploy.
      check(
        'no HTML document was cached',
        !cacheState.cached.some((p) => p === '/' || p === '/dashboard' || p === '/athlete'),
        cacheState.cached.filter((p) => !p.startsWith('/_next/static/')).join(', ').slice(0, 200) || 'only /_next/static assets',
      )
    }
    await swCtx.close()

    /* ── nothing broken on the way in ── */
    heading('Console and network on "/"')
    const clean = await browser.newContext()
    const cp = await clean.newPage()
    const errors = []; const failed = []
    cp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    cp.on('requestfailed', (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`))
    cp.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`) })
    await cp.goto(base + '/', { waitUntil: 'load' })
    await cp.waitForTimeout(2500)
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    check('no failed or 4xx/5xx requests', failed.length === 0, failed.slice(0, 3).join(' | '))
    await clean.close()
  } finally {
    await browser.close()
  }
}

/* ── main ──────────────────────────────────────────────────────────────────*/
// Run Next through node against its own entrypoint rather than through `npx`.
//
// `npx` cannot be spawned on Windows: there is no extensionless `npx` for the
// OS to exec (ENOENT), and reaching for `npx.cmd` instead trades that for
// EINVAL, because current Node refuses to execFile/spawn a .cmd without
// `shell: true`. Either way the harness dies before a single check runs and
// reports "1 of 1 checks failed" for a reason that has nothing to do with the
// app. CI is ubuntu-latest so this never surfaced there — but the person most
// likely to run verify:boot by hand is the one who just changed startup, and
// CLAUDE.md asks them to run it locally before opening the PR, so a harness
// that only works on Linux is a gate that gets skipped.
//
// Resolving the binary is also more correct than `npx` was: it runs the `next`
// this project installed, with no PATH lookup and no shell to quote through.
const require = createRequire(import.meta.url)
const NEXT_BIN = require.resolve('next/dist/bin/next')

let server
try {
  if (FORCE_BUILD || !existsSync(join(NEXT_DIR, 'server', 'app'))) {
    console.log('Building (production)…')
    execFileSync(process.execPath, [NEXT_BIN, 'build'], { stdio: 'inherit', env: { ...process.env, ...BUILD_ENV } })
  } else {
    console.log('Using the existing .next build (pass --build to rebuild).')
  }

  assertBuildOutput()

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    env: { ...process.env, ...BUILD_ENV }, stdio: 'ignore', detached: true,
  })
  if (!(await waitForServer(base))) throw new Error(`server never came up on ${base}`)

  await assertMiddleware(base)
  await assertBoot(base)
} catch (err) {
  console.error(`\n\x1b[31mharness error:\x1b[0m ${err.message}`)
  results.push({ group: 'harness', name: err.message, ok: false })
} finally {
  if (server?.pid) { try { process.kill(-server.pid) } catch { /* already gone */ } }
}

const failures = results.filter((r) => !r.ok)
console.log(`\n${'═'.repeat(74)}`)
if (failures.length === 0) {
  console.log(`\x1b[32m✓ ${results.length} checks passed — the app opens correctly.\x1b[0m`)
  process.exit(0)
}
console.log(`\x1b[31m✗ ${failures.length} of ${results.length} checks failed:\x1b[0m`)
for (const f of failures) console.log(`   · [${f.group}] ${f.name}`)
process.exit(1)
