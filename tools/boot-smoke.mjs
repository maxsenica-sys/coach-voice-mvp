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

  heading('Build output')

  const cssFiles = walk(join(NEXT_DIR, 'static')).filter((f) => f.endsWith('.css'))
  const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  check('a stylesheet was emitted', cssFiles.length > 0, `${cssFiles.length} file(s)`)

  // Every family the design tokens name must be in the build as a real
  // @font-face. Naming one in globals.css is not evidence that it loads.
  for (const fam of ['Plus Jakarta Sans', 'Newsreader', 'JetBrains Mono']) {
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
      return {
        display: probe('var(--font-display)'),
        sans: probe('var(--font-sans)'),
        mono: probe('var(--font-mono)'),
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
      check(
        'the launch images are precached',
        (swState.cached ?? []).some((p) => p.startsWith('/splash/')),
        `${(swState.cached ?? []).length} entries`,
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
