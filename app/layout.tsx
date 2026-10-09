import type { Metadata, Viewport } from 'next'
import { SEQUENCE_MS, WORD_AT, openingCss, fullScreenFrameCss } from '@/lib/opening'
import localFont from 'next/font/local'
import './globals.css'
import OpeningMark from './components/OpeningMark'
import UpdateWatcher from './components/UpdateWatcher'
import './fonts/subsets.css'

/* ── Type ──────────────────────────────────────────────────────────────────
 *
 * All three families are loaded here, self-hosted, rather than through the
 * `@import url(fonts.googleapis.com/…)` that used to sit at the top of
 * globals.css. That import had two problems, and they pulled in opposite
 * directions:
 *
 *   In production it did not survive the build at all. An `@import url()` after
 *   `@import "tailwindcss"` is dropped by the Tailwind v4 / Lightning CSS
 *   pipeline — `grep -r fonts.googleapis .next` returns nothing — so the only
 *   family that ever loaded was Plus Jakarta Sans, which next/font was already
 *   serving. Every `var(--font-display)` heading on the dashboard, the athlete
 *   pages and the session pages was silently falling back to Georgia, and
 *   `var(--font-mono)` to the system monospace. Production did not look like
 *   development, where the import does load.
 *
 *   In development, where it does load, it is the worst thing on the critical
 *   path: an `@import` nested inside the stylesheet is invisible to the browser's
 *   preload scanner, so it is only discovered after the app CSS has downloaded
 *   and parsed, and it then blocks rendering while a fresh DNS lookup, TCP
 *   connection and TLS handshake to fonts.googleapis.com resolve — followed by a
 *   second connection to fonts.gstatic.com for the files themselves.
 *
 * Self-hosting fixes both. The files come from our own origin as part of the
 * build, they are cached by the service worker in public/sw.js, and `display:
 * swap` means text paints immediately in the fallback regardless.
 *
 * That sentence used to cite the `runtimeCaching` array in next.config.ts, and
 * this is the exact failure that array is now deleted for: it never ran — a
 * webpack plugin under a Turbopack build — so for as long as this comment
 * claimed the fonts were cached, nothing was caching anything. Dead
 * configuration gets cited; keep the citation pointing at code that runs.
 *
 * Only Plus Jakarta Sans is preloaded, and it is the one that carries the body
 * copy on every screen. Newsreader used to be preloaded on the reasoning that
 * it carries the first heading, so a swap there is visible — true, but it ships
 * normal *and* italic, and 123KB at the same priority as the document's own CSS
 * is 123KB taken from the two things the brand moment actually depends on: the
 * first paint, and the JavaScript that starts the animation. A visible swap on
 * a heading is a smaller cost than a blank screen. JetBrains Mono appears on a
 * handful of 10-11px labels and never deserved a request competing with the
 * bundle. tools/boot-smoke.mjs holds the critical-path font budget at 40KB.
 */
/* Every family is a file in app/fonts/, not a request to Google at build time.
 *
 * next/font/google fetched the stylesheet from fonts.googleapis.com on every
 * build and parsed it. On 2026-09-27 Google answered one CI runner with a
 * different URL shape (fonts.gstatic.com/l/font?kit=…) that the loader could
 * not parse, and the build failed on a PR that did not touch a font — while
 * main, minutes apart, built fine. Vercel's production build makes the same
 * request. A deploy that can fail because of how a third party answered one
 * HTTP request is not a deploy we control, so the files are ours now: the same
 * files Google served next/font's own loader, byte for byte — latin here, and
 * latin-ext, vietnamese, cyrillic and greek in ./fonts/subsets.css, which the
 * Google build also carried (`subsets` only ever chose what was preloaded) —
 * under their SIL Open Font Licences in app/fonts/OFL-*.txt.
 *
 * next/font/local names each @font-face after the constant below, so the
 * families are jakartaSans, newsreader, bigShoulders and jetbrainsMono — and
 * tools/boot-smoke.mjs asserts on exactly those names. Do not add a
 * `declarations` override for font-family: the variable keeps the constant's
 * name, so the two would disagree and every font would silently fall back.
 * (That was tried first. The boot harness went red on it.)
 *
 * Each file is variable-weight, so one file covers every weight the app uses.
 * The latin faces carry Google's unicode-range so the browser composes them
 * with the other subsets exactly as it did before. */
const jakartaSans = localFont({
  src: './fonts/PlusJakartaSans-latin-var.woff2',
  variable: '--font-jakarta',
  // latin only; every other subset is in ./fonts/subsets.css (next/font needs a literal here)
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  weight: '400 800',
  style: 'normal',
  display: 'swap',
})

const newsreader = localFont({
  src: [
    { path: './fonts/Newsreader-latin-var.woff2', weight: '400 500', style: 'normal' },
    // headings use both styles; see --font-display
    { path: './fonts/Newsreader-Italic-latin-var.woff2', weight: '400 500', style: 'italic' },
  ],
  variable: '--font-newsreader',
  // latin only; every other subset is in ./fonts/subsets.css (next/font needs a literal here)
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  display: 'swap',
  // Not preloaded: the first painted frame is the boot shell, which hardcodes
  // the system stack. See the note above on the critical path.
  preload: false,
})

const bigShoulders = localFont({
  src: './fonts/BigShoulders-latin-var.woff2',
  variable: '--font-bigshoulders',
  // latin only; every other subset is in ./fonts/subsets.css (next/font needs a literal here)
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  weight: '600 800',
  style: 'normal',
  display: 'swap',
  // The scoreboard voice. Not preloaded, for the same reason Newsreader is not.
  preload: false,
})

const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono-latin-var.woff2',
  variable: '--font-jetbrains',
  // latin only; every other subset is in ./fonts/subsets.css (next/font needs a literal here)
  declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' }],
  weight: '400 500',
  style: 'normal',
  display: 'swap',
  preload: false,
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximumScale / userScalable. Locking zoom is normally done to stop iOS
  // auto-zooming when a form field is focused, but globals.css:590 already
  // solves that properly by setting .input to 16px — below which is the only
  // thing that triggers the auto-zoom. The lock bought nothing and cost a lot:
  // the app is a `display: standalone` PWA, so there is no browser zoom UI to
  // fall back on, and with text-size-adjust: 100% there is no inflation
  // either. That left dozens of sites of sub-11px text with no mechanism of
  // any kind by which a user could enlarge them. WCAG 2.2 SC 1.4.4 requires
  // 200%. Do not put these back without solving 1.4.4 another way.
  // The ink ground, not a contrast colour: this is the status bar and the
  // task-switcher header, and it has to read as the same surface as the app
  // underneath it. Equal to globals.css --bg and to theme_color in
  // app/manifest.ts; tools/boot-smoke.mjs asserts all three agree.
  themeColor: '#1F2421',
  // Before the inline <style> below has been parsed the browser paints with
  // its own defaults, and those follow the page's declared colour scheme. The
  // meta tag is the only way to declare it that early. It says the same thing
  // as color-scheme: dark in globals.css and in BOOT_CSS.
  colorScheme: 'dark',
}

export const metadata: Metadata = {
  title: 'Pindar — the private journal between coach and athlete',
  description: 'Your coach talks, Pindar writes it up: every athlete gets their own words from every session.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pindar',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: '/icon.svg?v=pindar1',
    apple: '/apple-icon.png?v=pindar1',
  },
}

/** How long the shell takes to fade off once the app says it is ready. */
const OUT_MS = 460

/* The earliest the shell may leave: once the name has landed.
 *
 * The montage this replaced held for one second, on the reasoning that a splash
 * only covers a wait. The opening is different in kind: it is the brand, a
 * coach's voice becoming the wreath, and leaving at one second would cut it off
 * with the bars still in the air — the wreath never closes and the name never
 * arrives. So the floor is the name (WORD_AT, plus enough to read it). It only
 * plays on a cold start, at most once every thirty minutes (cv_splash_at below),
 * and a tap still leaves at once. */
const FLOOR_MS = WORD_AT + 400

const BOOT_CSS = `/* ── The boot shell ────────────────────────────────────────────────────────
 *
 * This is the cold-start sequence. All of it. It is inline CSS over markup the
 * server already sent, it starts with the document's first paint, and no
 * JavaScript is involved in playing it.
 *
 * ── Why it is not a React component ───────────────────────────────────────
 *
 * /dashboard and /athlete are client components, so their server HTML is a
 * Suspense bail-out and anything they render waits for roughly a megabyte of
 * JavaScript. An opening drawn by that JavaScript would play to nobody: on a
 * slow launch it would arrive after the wait it exists to cover. (That is
 * exactly how the old montage of fourteen sports went missing.) So the opening
 * is CSS over markup the server already sent, generated from lib/opening.ts.
 *
 * Nothing in this block may depend on JavaScript, on the CSS chunk, or on the
 * webfont. It is inline, it is unconditional, and its whole job is to be early.
 */
/* Nothing on this app is ever allowed to be the browser's default background.
 *
 * This is one line and it is the other half of "a black screen when I open the
 * app". The app's own ground colour lives in globals.css, which is a separate
 * request: until it lands, html has no background at all, and a full-bleed
 * element whose own background is an unresolved var() — which is what the old
 * React splash had, sitting on var(--grad-ink) with the stylesheet still in
 * flight — paints nothing over nothing. On a phone in dark mode that is a
 * black screen, produced by two things that are each individually correct.
 *
 * Inline, unconditional, and it cannot be late.
 *
 * ── It is the app's own ground, and must stay equal to --bg ──────────────
 *
 * This was #FBF8F3, the ivory the app used to be, and after the switch to the
 * Stadium Night ink it was the last light pixel in the cold start. Not only
 * for a frame: globals.css paints --bg on body, and body's background only
 * propagates to the canvas when html has none of its own. Giving html a
 * colour here therefore pinned the canvas to ivory for the life of the page —
 * everything outside the body box (the rubber-band overscroll on iOS, a page
 * shorter than the screen, the empty Suspense bail-out /dashboard is between
 * the shell leaving and hydration) was a cream slab in an ink app. Measured
 * in Chromium: body rgb(31, 36, 33), html rgb(251, 248, 243), and the pixel
 * under a shortened body #FBF8F3.
 *
 * So the literal is the value of --bg, the same value as background_color in
 * app/manifest.ts and the ground of the launch images. A literal, because this
 * paints before any stylesheet; tools/boot-smoke.mjs reads the browser's
 * computed --bg and fails if this, the manifest or the launch images drift
 * from it. color-scheme rides with it so the UA's own defaults are dark from
 * the same instant. */
html { background: #1F2421; color-scheme: dark }

#cv-boot { display: none }
html[data-boot] #cv-boot { display: block }
#cv-boot {
  position: fixed; inset: 0; z-index: 9000;
  /* Colour and gradient declared separately on purpose. A gradient is a
     background-IMAGE; on its own it leaves background-color transparent, so
     anything that stops the image painting leaves a full-bleed z-index 9000
     element showing whatever is behind it. Naming the near stop as a colour
     underneath costs nothing and means the worst case is a flat ink screen
     rather than a black one. */
  background-color: #1F2421;
  background-image: linear-gradient(160deg, #1F2421 0%, #3A4F38 100%);
  opacity: 1; transition: opacity ${OUT_MS}ms ease-out;
  /* The shell's own type metrics, so nothing in it inherits from body.
     globals.css gives body line-height 1.55 and var(--font-sans), and the
     wordmark and tagline were picking both up: the wordmark sat 7px lower
     than in the launch images (which render without globals.css), the
     tagline was in a different face, and both shifted again depending on
     whether the stylesheet had landed yet — a dependency on the CSS chunk,
     which the rule at the top of this block forbids. The launch image and
     this frame are meant to be the same pixels; tools/boot-smoke.mjs now
     compares them for every device geometry. */
  line-height: normal;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
}
/* The way out. Set by the inline script — on app-ready, on a tap, or by the
 * dead-man's switch — then the element is removed a beat later. */
html[data-boot-out] #cv-boot { opacity: 0; pointer-events: none }

/* ── The opening: a coach's voice becomes the wreath ────────────────────────
 *
 * A line of voice bars pulses like a coach talking, then each bar flies up and
 * becomes one leaf of the laurel, the stems draw, the name rises and the line
 * lands. Generated from lib/opening.ts, which the sign-in intro and the iOS
 * launch images share, so all three are one picture.
 *
 * Every element's plain style is the resting frame and every animation sits
 * inside prefers-reduced-motion: no-preference. So reduced motion shows the
 * finished lockup at once, and nothing here can leave the brand invisible —
 * the failure the "never leave the brand invisible" rule in CLAUDE.md exists
 * for. The bars are small and sage on ink: no large-area flash (WCAG 2.3.1).
 */
${fullScreenFrameCss('#cv-boot')}
${openingCss('#cv-boot', '', 'cv-op')}

/* ── The sign-in intro ─────────────────────────────────────────────────────
 *
 * The same opening on "/", inside app/components/IntroSequence.tsx. It used to
 * be drawn by an effect after hydration, which is why the wordmark once painted,
 * sat, blinked out and animated back in. Now it is this CSS, gated on the
 * data-intro attribute the script below sets before the body paints, so it
 * plays from the first frame and needs no JavaScript at all. Without the
 * attribute (a returning visitor, a ?next link) the same markup simply shows
 * its resting frame. */
${openingCss('.cv-intro', 'html[data-intro] ', 'cv-in')}`

const BOOT_JS = `/* Runs before the body paints, so the shell is either up or never was — there
 * is no frame in which the wrong thing is on screen.
 *
 * It owns the cold-start decision outright. The old splash component used to
 * make it and consume the storage keys itself, which cannot work: by the time
 * a component in the page bundle runs, the shell has been on screen for a
 * second or more and the answer has to already be known. That component is
 * gone; the sequence is CSS above and this script is what arms it.
 *
 * Scoped to the two app pages on purpose. "/" runs its own intro and claims the
 * same session key when you sign in, and arming the shell there would both
 * double up and consume the key the sign-in flow depends on.
 *
 * The timeout is a dead-man's switch. If the bundle never arrives or throws
 * during hydration, nothing else would ever take the shell down, and an ink
 * screen with no way past it is a worse failure than the one being fixed.
 *
 * Note this script no longer decides only whether to ARM the shell. Since the
 * cold-start sequence became CSS, it also owns the way out — see
 * window.__cvBootLeave below, which is the single path all three dismissals
 * take. */
(function () {
  /* ── Was this installed before the rename? ────────────────────────────────
   *
   * Asked once, on the first launch of this version, and the answer kept: an
   * install that has never written here is new and already has the laurel; one
   * that has was installed as CoachVoice. It has to be decided here, before the
   * lines below write cv_intro_v1 / cv_splash_at, because this is the only code
   * that runs before a fresh install has written anything. The iPhone prompt
   * that uses it is lib/reinstall-nudge.ts. */
  try {
    if (!localStorage.getItem('pindar_install')) {
      var had = localStorage.getItem('cv_intro_v1') || localStorage.getItem('cv_splash_at') || localStorage.getItem('cv_profile_v1')
      localStorage.setItem('pindar_install', had ? 'before-rename' : 'after-rename')
    }
  } catch (e) { /* blocked storage: never asked, which is the safe answer */ }
  try {
    var d = document.documentElement
    var forced = location.search.indexOf('splash=1') > -1
    var path = location.pathname

    /* ── The intro on "/" ──────────────────────────────────────────────────
     *
     * Decided here for exactly the reason the shell is: IntroSequence ships
     * its resolved frame in the server markup, so if this waited for
     * hydration the wordmark would already have been on screen for the whole
     * download. See the data-intro rule in BOOT_CSS.
     *
     * The storage key is consumed here and nowhere else — the page reads the
     * attribute rather than asking the same question a second time, the same
     * arrangement lib/boot-shell.ts has with the shell.
     *
     * Reduced motion is checked here rather than in the component so that the
     * resolved frame simply paints and is never hidden at all. */
    if (path === '/' && !forced) {
      var q = new URLSearchParams(location.search)
      var play
      if (q.get('intro') === '1') play = true        // watch it again, on demand
      else if (q.get('next')) play = false           // interrupted, not arriving
      else {
        // Blocked storage plays it and simply cannot remember, which is what
        // the page did before this moved here.
        try { play = !localStorage.getItem('cv_intro_v1') } catch (e) { play = true }
      }
      if (play && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try { localStorage.setItem('cv_intro_v1', '1') } catch (e) { /* nothing to do */ }
        d.setAttribute('data-intro', '1')
        // Dead-man's switch, as below. Never leave the brand invisible.
        setTimeout(function () { d.removeAttribute('data-intro') }, 6400)
      }
      return
    }

    // Deliberately not a regular expression: this whole script lives inside a
    // template literal, which eats a backslash before the JavaScript engine
    // ever sees it. The first version used /^\\/(dashboard|athlete)\\b/ here and
    // silently matched nothing, so the shell never armed at all.
    var onAppPage = path === '/dashboard' || path.indexOf('/dashboard/') === 0
      || path === '/athlete' || path.indexOf('/athlete/') === 0
    if (!forced && !onAppPage) return
    if (!forced) {
      if (sessionStorage.getItem('cv_splash_session')) return
      sessionStorage.setItem('cv_splash_session', '1')
      var last = Number(localStorage.getItem('cv_splash_at') || 0)
      // Thirty minutes, not fifteen seconds. sessionStorage alone does not
      // draw the line it looks like it draws: iOS discards a backgrounded PWA
      // webview aggressively, so a coach who flicks to a timer app and comes
      // back gets a brand new session and a full replay. The floor was cut to
      // 15s so the splash could be watched by closing and reopening the app,
      // which reinstated exactly that. Use ?splash=1 for that instead — it is
      // right there on the line above and it does not consume the keys.
      if (Date.now() - last < 1800000) return
      localStorage.setItem('cv_splash_at', String(Date.now()))
    }
    // The floor is measured on the OPENING's clock, not the navigation's.
    //
    // It used to be anchored to navigation start (window.__cvBootAt), which was
    // right for the montage: that was timed by JavaScript from the same anchor,
    // so time already spent waiting for the document was time the montage had
    // already "played". The opening is CSS, and a CSS animation starts when the
    // shell is first styled — after the document has arrived, however long that
    // took. Kept on the navigation clock, every millisecond of document latency
    // came straight out of the floor: with the document held 1.2s the shell
    // began to leave 767ms into its own animation, with "Pindar" at opacity 0 —
    // exactly the cut-off the floor exists to prevent, on exactly the slow
    // launch where anyone is watching. So the floor reads the name's own
    // animation clock, and falls back to the moment the shell armed.
    var armedAt = Date.now()
    var openingAt = function () {
      var w = document.querySelector('#cv-boot .op-word')
      var a = w && w.getAnimations ? w.getAnimations()[0] : null
      return a && a.currentTime !== null ? a.currentTime : Date.now() - armedAt
    }
    d.setAttribute('data-boot', '1')

    /* ── The only way out ──────────────────────────────────────────────────
     *
     * One function, three callers: the app saying it has something to show,
     * a tap, and the dead-man's switch. They used to be three code paths
     * removing two attributes each, which is three chances to disagree.
     *
     * The floor is what guarantees the opening is actually seen: the wreath
     * closes and the name lands before the shell hands over, even when the app
     * is ready sooner. A cold start is the one moment this app has to look like
     * something; it is worth ${FLOOR_MS}ms. A tap overrides it, because someone
     * who taps wants to be in the app.
     *
     * With reduced motion there is no sequence to protect, so there is no
     * floor beyond not being a flash.
     */
    var gone = false
    var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    var FLOOR = REDUCED ? 600 : ${FLOOR_MS}
    var drop = function () {
      d.removeAttribute('data-boot')
      d.removeAttribute('data-boot-out')
    }
    window.__cvBootLeave = function (force, instant) {
      if (gone) return
      var waited = openingAt()
      if (!force && waited < FLOOR) {
        setTimeout(function () { window.__cvBootLeave(true) }, FLOOR - waited)
        return
      }
      gone = true
      // A tap, and the dead-man's switch, leave at once. Fading out over
      // ${OUT_MS}ms is right when the app has finished loading and the shell is
      // handing over; it is latency the user explicitly asked to skip when they
      // tapped, and it is the last thing you want on the path that exists
      // because hydration has already failed.
      if (instant) return drop()
      d.setAttribute('data-boot-out', '1')
      setTimeout(drop, ${OUT_MS})
    }

    // The escape has to exist from the first painted frame.
    //
    // The old animated splash attached its own pointerdown handler, but only
    // after hydration — roughly a megabyte of JavaScript too late. Until then
    // the thing on screen was #cv-boot, a fixed, full-bleed, z-index 9000 div
    // with no listener on it, so every tap during precisely the window this
    // shell exists to cover landed on an inert element and was thrown away.
    window.addEventListener('pointerdown', function () {
      window.__cvBootLeave(true, true)
    }, { once: true, capture: true })
    // The dead-man's switch. If the bundle never arrives or throws during
    // hydration, nothing else would ever take the shell down, and an ink
    // screen with no way past it is a worse failure than the one being fixed.
    // It has to sit clear of the sequence's own length (${SEQUENCE_MS}ms).
    setTimeout(function () { window.__cvBootLeave(true, true) }, 6400)
  } catch (e) { /* blocked storage: no shell, no splash, app still opens */ }
})()

/* ── The service worker ────────────────────────────────────────────────────
 *
 * public/sw.js caches the content-hashed assets — the bundle, the stylesheet,
 * the self-hosted fonts, the launch images — so a cold start reads them off
 * disk instead of the network. It deliberately never caches a document; the
 * reasoning is in that file.
 *
 * This registration is why it exists at all. next.config.ts wraps the config
 * in @ducanh2912/next-pwa, which is a webpack plugin, and this project builds
 * with Turbopack — so no worker was ever emitted and /sw.js returned 404 in
 * production. Nothing was being cached by anything, including the fonts that
 * the comment above claims the worker covers.
 *
 * Registered on load rather than here at the top of <head>: registration is
 * async and cheap, but it still costs a fetch, and nothing about the first
 * paint depends on it. Outside the IIFE above on purpose — that one returns
 * early on "/" and on every non-app page, and the worker is wanted everywhere.
 */
;(function () {
  if (!('serviceWorker' in navigator)) return
  /* Production only. next-pwa carried a disable-in-development flag and
   * dropping that wrapper dropped the guard with it. Dev chunk URLs under
   * /_next/static/ are not content-hashed the way the build's are, so
   * cache-first would serve a developer their own stale bundle after every
   * edit until they cleared site data — and the cv-sw-reset escape hatch needs
   * a console to reach. An existing worker is unregistered too, so a dev
   * session that already installed one recovers by reloading rather than by
   * knowing about any of this.
   *
   * The value is decided on the server and baked into the HTML, which is why
   * it is an interpolation and not a runtime lookup: process.env does not
   * exist in the browser. Note there are no backticks anywhere in this script
   * — it lives inside a template literal, and one would end it early. */
  var isProd = ${process.env.NODE_ENV === 'production'}
  if (!isProd) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister() })
    }).catch(function () { /* nothing to undo */ })
    return
  }
  addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {
      /* An unavailable worker must never be visible: no cache, same app. */
    })
  })
})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The font variables go on <html>, not <body>. globals.css resolves
    // --font-display/-sans/-mono from them in a `:root` block, and a var() that
    // is unresolved at that point makes the whole declaration invalid at
    // computed value time — taking the literal fallbacks down with it and
    // dropping every screen into the browser's default serif. Same trap the
    // boot shell's wordmark hit; see BOOT_CSS above.
    //
    // suppressHydrationWarning: the inline script in <head> sets data-boot,
    // data-intro and data-boot-out on <html> before React exists, on purpose
    // (see BOOT_JS), and React would otherwise report a mismatch on every cold
    // start. It covers this element's own attributes only, nothing inside it.
    <html lang="en" suppressHydrationWarning className={`${jakartaSans.variable} ${newsreader.variable} ${jetbrainsMono.variable} ${bigShoulders.variable}`}>
      <head>
        {/* PWA / Apple home screen */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Pindar" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png?v=pindar1" />
        {/* iOS launch images — the screen the OS paints before the app exists.
            This is the "black screen delay when I open the app" in its most
            literal form. On an installed PWA the home-screen tap is answered by
            SpringBoard, not by us: it paints one of these, and only then does
            the webview start. No service worker can help — the worker lives
            inside the webview that has not started yet.

            iOS matches them by exact device geometry, with no nearest match and
            no fallback: a device whose width, height and pixel ratio are not
            named below gets BLACK for the whole time the document is in flight.
            The list used to name nine geometries and missed, among others, the
            XS Max and 11 Pro Max, the Plus phones, the SE 1st gen and every
            iPad ever made.

            Generated by tools/build-launch-images.mjs from the same values as
            the boot shell above, so the OS screen and the first painted frame
            are the same picture and the handoff is invisible. Regenerate with
            that script rather than editing this list by hand. */}
        <link rel="apple-touch-startup-image" href="/splash/launch-640x1136.png" media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-750x1334.png" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1242x2208.png" media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1125x2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1170x2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1179x2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1206x2622.png" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-828x1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1242x2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1284x2778.png" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1320x2868.png" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1536x2048.png" media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1620x2160.png" media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1640x2360.png" media="(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1668x2224.png" media="(device-width: 834px) and (device-height: 1112px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1668x2388.png" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-2048x2732.png" media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
      </head>
      <body>
        {/* The first painted frame on a cold start, and the whole sequence that
            follows it. Server-rendered and driven by the inline CSS above, so
            it plays whether or not the bundle ever arrives. See BOOT_CSS. */}
        <div id="cv-boot" aria-hidden="true">
          <OpeningMark />
        </div>
        {children}
        {/* Brings an installed app up to the latest deploy without deleting
            it from the Home Screen. Renders nothing. lib/app-update.ts. */}
        <UpdateWatcher />
      </body>
    </html>
  )
}
