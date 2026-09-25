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

  heading('Build output')

  const cssFiles = walk(join(NEXT_DIR, 'static')).filter((f) => f.endsWith('.css'))
  const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  check('a stylesheet was emitted', cssFiles.length > 0, `${cssFiles.length} file(s)`)

  // Every family the design tokens name must be in the build as a real
  // @font-face. Naming one in globals.css is not evidence that it loads.
  // Big Shoulders is the fourth. Google renamed the family from "Big Shoulders
  // Display", and next/font follows the new name — the export is
  // `Big_Shoulders` and the @font-face it emits says `font-family:Big
  // Shoulders`. The old name survives in globals.css only as a literal fallback
  // for a machine that happens to have it installed locally.
  for (const fam of ['Plus Jakarta Sans', 'Newsreader', 'JetBrains Mono', 'Big Shoulders']) {
    check(`${fam} is self-hosted in the build`, css.includes(`font-family:${fam}`))
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
  }

  const htmlFiles = walk(join(NEXT_DIR, 'server', 'app')).filter((f) => f.endsWith('.html'))
  const index = htmlFiles.find((f) => f.endsWith('index.html'))
  check('"/" is prerendered to static HTML', Boolean(index), index ? '' : 'no index.html — "/" went dynamic')

  if (index) {
    const html = readFileSync(index, 'utf8')
    // The two elements the pre-paint rule hides. If the class is gone the rule
    // silently stops matching and the flash returns with nothing failing.
    const figures = (html.match(/class="cv-intro-figure"/g) || []).length
    check('the intro figures carry cv-intro-figure', figures === 2, `found ${figures}, expected 2`)
    check('the pre-paint rule is inlined in <head>', html.includes('html[data-intro] .cv-intro-figure'))
    check('the boot shell markup is server-rendered', html.includes('id="cv-boot"'))
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
     * The stale value is banned by name as well, because that specific colour
     * coming back is the regression, whatever route it takes. */
    const src = readFileSync(join(ROOT, 'app', 'manifest.ts'), 'utf8')
    const intended = (src.match(/background_color:\s*'(#[0-9A-Fa-f]{3,8})'/) || [])[1]
    check('app/manifest.ts declares a background_color', Boolean(intended), String(intended))
    check(
      'the served background_color is the one in app/manifest.ts',
      Boolean(intended) && manifest.background_color === intended,
      `served ${manifest.background_color}, source says ${intended} — a public/ file shadowing the route is how this diverges`,
    )
    check(
      'the launch screen is not the old near-black',
      manifest.background_color !== '#1F2421',
      `got ${manifest.background_color} — this is the whole cold start's first frame`,
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
  const els = document.querySelectorAll('.cv-intro-figure')
  if (els.length >= 2) {
    window.__cv.frames.push({
      t: performance.now(),
      mark: parseFloat(getComputedStyle(els[0]).opacity),
      word: parseFloat(getComputedStyle(els[1]).opacity),
      attr: document.documentElement.hasAttribute('data-intro'),
    })
  }
  if (performance.now() < 4000) requestAnimationFrame(sample)
})()
`

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
    const early = cold.frames.filter((f) => f.t < 500 && (f.word > 0.5 || f.mark > 0.5))
    const settled = cold.frames[cold.frames.length - 1]

    check('the intro figures were found', cold.frames.length > 0, `${cold.frames.length} frames sampled`)
    check(
      'brand is NOT painted in the first 500ms (the title flash)',
      early.length === 0,
      early.length ? `visible at ${early.map((f) => Math.round(f.t) + 'ms').slice(0, 4).join(', ')}` : `first frame at ${Math.round(first?.t ?? 0)}ms had mark=${first?.mark} word=${first?.word}`,
    )
    check('the sequence resolves to a visible brand', settled && settled.mark > 0.9 && settled.word > 0.9,
      settled ? `at ${Math.round(settled.t)}ms mark=${settled.mark.toFixed(2)} word=${settled.word.toFixed(2)}` : 'no frames')
    check('the brand does animate rather than snapping on', cold.frames.some((f) => f.word > 0.05 && f.word < 0.95))
    console.log(`         first contentful paint: ${Math.round(cold.fcp)}ms`)
    await cold.page.close()

    /* ── the resting state ── */
    heading('The resting state and the ways out')
    const seen = await timelineFor(fresh, '/', 700)   // same context: intro already consumed
    const rest = seen.frames[0]
    check('a returning visit shows the brand at once', rest && rest.word === 1 && rest.mark === 1 && !rest.attr,
      rest ? `mark=${rest.mark} word=${rest.word} data-intro=${rest.attr}` : 'no frames')
    check('a returning visit never hides the brand', seen.frames.every((f) => f.word === 1))
    await seen.page.close()

    const replay = await timelineFor(fresh, '/?intro=1')
    check('?intro=1 replays the sequence', replay.frames[0]?.word === 0 && replay.frames.at(-1)?.word > 0.9)
    await replay.page.close()

    const interrupted = await browser.newContext()
    const nx = await timelineFor(interrupted, '/?next=%2Fsessions%2Fabc', 700)
    check('?next= skips the intro and shows the brand', nx.frames[0]?.word === 1 && !nx.frames[0]?.attr)
    await nx.page.close(); await interrupted.close()

    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    const rm = await timelineFor(reduced, '/', 700)
    check('prefers-reduced-motion never hides the brand', rm.frames.every((f) => f.word === 1 && !f.attr))
    await rm.page.close(); await reduced.close()

    // The pre-paint rule hides the brand and hands it back in an effect. If the
    // bundle never arrives, nothing must be left invisible.
    const nojs = await browser.newContext({ javaScriptEnabled: false })
    const p = await nojs.newPage()
    await p.goto(base + '/', { waitUntil: 'domcontentloaded' })
    const noJsWord = await p.evaluate(() => {
      const e = document.querySelectorAll('.cv-intro-figure')
      return e.length >= 2 ? parseFloat(getComputedStyle(e[1]).opacity) : null
    }).catch(() => null)
    check('with JavaScript dead the brand is still shown', noJsWord === 1, `opacity=${noJsWord}`)
    await nojs.close()

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
      }
    })
    // A var() that is unresolved where the token is declared invalidates the
    // whole declaration and takes the literal fallbacks with it — the screen
    // silently drops to the browser default serif. Ask the browser, not the CSS.
    check('--font-display resolves to Newsreader', fonts.display.includes('Newsreader'), fonts.display)
    check('--font-sans resolves to Plus Jakarta Sans', fonts.sans.includes('Plus Jakarta Sans'), fonts.sans)
    check('--font-mono resolves to JetBrains Mono', fonts.mono.includes('JetBrains Mono'), fonts.mono)
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
    check('--font-cast resolves to Big Shoulders', fonts.cast.includes('Big Shoulders'), fonts.cast)
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
        wordmark: el ? (el.querySelector('.w')?.textContent ?? '') : '',
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
      stalled.display === 'block' && stalled.wordmark === 'CoachVoice' && stalled.fcp > 0,
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

    /* ── the montage: the people ──
     *
     * This section exists because the montage stopped playing and every check
     * this project owned stayed green. It was not deleted, not broken and not
     * misconfigured: it was drawn by a React effect inside the page bundle, on
     * a clock anchored to the start of the navigation, so by the time the code
     * could run its own timeline said the sequence was over — and when the app
     * loaded quickly the ready-handler skipped the montage on purpose. tsc,
     * eslint and next build could not have an opinion about any of that, and
     * nothing here was looking.
     *
     * So the hostile version of the question: kill the bundle outright, and
     * ask whether the fourteen sports still go past. If this passes with every
     * chunk hanging, the montage cannot be late for itself again — which is
     * the property, not the pixel.
     */
    heading('The montage — the fourteen sports actually go past')

    const sprite = JSON.parse(execFileSync(process.execPath,
      [join(ROOT, 'tools', 'build-montage-sprite.mjs'), '--json'], { encoding: 'utf8' }))
    check(
      'the sprite is in step with the artwork and the palette',
      sprite.upToDate,
      sprite.upToDate ? `${sprite.frames} frames, ${sprite.colour}` : sprite.why,
    )
    check(
      'the figure colour is still flash-safe against the ink ground',
      sprite.colour.toLowerCase() === sprite.token.toLowerCase(),
      `sprite ${sprite.colour} vs --ink-figure ${sprite.token} — WCAG 2.3.1 caps a large-area luminance swing at 10%; this one is 7.6%`,
    )

    const deadCtx = await browser.newContext()
    const dead = await deadCtx.newPage()
    const assets = []
    dead.on('response', (r) => {
      if (r.url().includes('/splash/montage.svg')) assets.push(r.status())
    })
    // Every page chunk hangs for the life of the page: hydration never starts,
    // which is the worst case a real phone on a real network produces and the
    // exact condition the old implementation could not survive.
    await dead.route('**/_next/static/chunks/**', () => { /* hang */ })
    await dead.goto(base + '/?splash=1', { waitUntil: 'commit' })
    const film = await dead.evaluate(async () => {
      const seen = []
      const el = document.querySelector('#cv-boot .figs')
      if (!el) return { error: 'no .figs element' }
      const t0 = performance.now()
      while (performance.now() - t0 < 3300) {
        const cs = getComputedStyle(el)
        seen.push({
          t: Math.round(performance.now() - t0),
          x: cs.backgroundPositionX,
          o: Number(cs.opacity),
        })
        await new Promise((r) => requestAnimationFrame(r))
      }
      const mark = document.querySelector('#cv-boot .m')
      const word = document.querySelector('#cv-boot .w')
      return {
        seen,
        hydrated: !!document.querySelector('#cv-boot')?.isConnected && document.readyState,
        markEnd: mark ? Number(getComputedStyle(mark).opacity) : null,
        wordEnd: word ? Number(getComputedStyle(word).opacity) : null,
      }
    })

    const visible = (film.seen ?? []).filter((f) => f.o > 0.9)
    const positions = new Set(visible.map((f) => f.x))
    check(
      'the sprite is served',
      assets.length > 0 && assets.every((s) => s === 200),
      assets.length ? `status ${assets.join(', ')}` : 'never requested — the montage would be a blank rectangle',
    )
    check(
      'the figures are painted at all',
      visible.length > 0,
      visible.length ? `visible from ${visible[0].t}ms to ${visible[visible.length - 1].t}ms` : 'opacity never rose above 0.9 — this is the bug',
    )
    check(
      `all ${sprite.frames} sports go past, with the bundle dead`,
      positions.size >= sprite.frames,
      `${positions.size} distinct frames of ${sprite.frames}`,
    )
    check(
      'the montage is not over before it is seen',
      visible.length > 0 && visible[0].t < 600,
      visible.length ? `first figure at ${visible[0].t}ms` : 'never',
    )
    check(
      'it resolves into the brand rather than stopping on a stranger',
      film.markEnd > 0.9 && film.wordEnd > 0.9 && (film.seen ?? []).at(-1)?.o < 0.1,
      `mark=${film.markEnd} word=${film.wordEnd} figures=${(film.seen ?? []).at(-1)?.o}`,
    )
    await deadCtx.close()

    /* Reduced motion gets the resting frame and no riffle. Fourteen full-height
     * figures changing every 70ms is exactly what that setting is asked for. */
    const rmCtx = await browser.newContext({ reducedMotion: 'reduce' })
    const rmPage = await rmCtx.newPage()
    await rmPage.goto(base + '/?splash=1', { waitUntil: 'commit' })
    await rmPage.waitForTimeout(700)
    const rmState = await rmPage.evaluate(() => {
      const g = (sel) => {
        const el = document.querySelector(sel)
        return el ? Number(getComputedStyle(el).opacity) : null
      }
      return { figs: g('#cv-boot .figs'), mark: g('#cv-boot .m'), word: g('#cv-boot .w') }
    })
    check(
      'reduced motion shows the brand and never riffles',
      rmState.figs === 0 && rmState.mark === 1 && rmState.word === 1,
      JSON.stringify(rmState),
    )
    await rmCtx.close()

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
      { url: '/?splash=1', settle: 700, what: 'the boot shell mid-montage' },
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
      await navigator.serviceWorker.ready
      // Give the install handler's precache a moment to settle.
      await new Promise((r) => setTimeout(r, 1200))
      const keys = await caches.keys()
      const cache = keys.length ? await caches.open(keys[0]) : null
      const cached = cache ? (await cache.keys()).map((r) => new URL(r.url).pathname) : []
      return { registered: true, keys, cached }
    })
    check('the worker registers', swState.registered === true, JSON.stringify(swState.keys ?? {}))
    if (swState.registered) {
      /* The montage, and not the launch images.
       *
       * The launch images used to be precached here and it can never have
       * done anything: the OS paints those before the webview exists, so this
       * worker is not in that path. The montage is — it is fetched by the
       * webview on every cold start and it is the first thing the shell
       * draws, so a miss is a blank rectangle where the sports should be. */
      check(
        'the montage is precached',
        (swState.cached ?? []).includes('/splash/montage.svg'),
        `${(swState.cached ?? []).length} entries: ${(swState.cached ?? []).join(', ').slice(0, 120)}`,
      )
      // The one thing this worker must never do. A cached document names
      // content-hashed chunks that stop existing on the next deploy.
      check(
        'no HTML document was cached',
        !(swState.cached ?? []).some((p) => p === '/' || p === '/dashboard' || p === '/athlete'),
        (swState.cached ?? []).join(', ').slice(0, 200),
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
