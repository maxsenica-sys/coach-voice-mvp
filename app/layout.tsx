import type { Metadata, Viewport } from 'next'
import {
  SPORT_COUNT, DRAW_MS, COLLAPSE_AT, MARK_AT, WORD_AT, SEQUENCE_MS,
  montageKeyframesCss, at, PEAKS,
} from '@/lib/montage-schedule'
import { Plus_Jakarta_Sans, Newsreader, JetBrains_Mono } from 'next/font/google'
import './globals.css'

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
const jakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'], // headings use both; see --font-display
  display: 'swap',
  // Not preloaded. Newsreader ships normal *and* italic — 123KB — at the same
  // priority as the document's own CSS and ahead of the app bundle, and the
  // first painted frame reads neither: #cv-boot .w hardcodes the system stack
  // on purpose. `display: swap` means the cost is a late swap on headings, not
  // invisible text. Blocking these on a slow-3G profile moved first paint
  // 1252ms -> 840ms. Plus Jakarta Sans, which carries the body copy, stays
  // preloaded at 27KB. tools/boot-smoke.mjs enforces the 40KB budget.
  preload: false,
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  weight: ['400', '500'],
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
  themeColor: '#1F2421',   // matches manifest + globals.css --text
}

export const metadata: Metadata = {
  title: 'CoachVoice — AI-Powered Coaching Platform',
  description: 'Voice-first coaching sessions, athlete management, and performance tracking.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CoachVoice',
  },
  formatDetection: { telephone: false },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-icon.png',
  },
}

/** How long the shell takes to fade off once the app says it is ready. */
const OUT_MS = 460

/* The earliest the shell may leave.
 *
 * This was COLLAPSE_AT + 520 — about 2.6 seconds — for one day, and it was
 * wrong. The reasoning was that being cut short is what killed the montage, so
 * the montage should always finish. But the montage was never cut short by the
 * floor; it was cut short by a clock it could not keep up with, and that is
 * fixed elsewhere. Holding the shell for the full sequence just turned a fix
 * for a missing animation into a second and a half of new waiting, on an app
 * whose actual complaint is that it takes too long to open.
 *
 * A splash covers a wait. Where there is no wait it has no job, and the right
 * length is "long enough not to be a flash". So: one second, about five sports,
 * and then it dissolves into whatever is ready underneath. The full sequence —
 * all fourteen, the collapse, the mark rising — still plays in full whenever
 * the app is genuinely slow to arrive, which is the only time anyone was ever
 * going to watch it. A tap leaves immediately, as before. */
const FLOOR_MS = 1000

/* The montage's frame schedule, generated from lib/montage-schedule.ts so the
 * CSS below and the JavaScript that has to know how long the sequence lasts
 * cannot drift apart. It is fourteen step-end stops at their real offsets,
 * because the cadence accelerates and steps() is even. */
const MONTAGE_KEYFRAMES = montageKeyframesCss()

const BOOT_CSS = `/* ── The boot shell ────────────────────────────────────────────────────────
 *
 * This is the cold-start sequence. All of it. It is inline CSS over markup the
 * server already sent, it starts with the document's first paint, and no
 * JavaScript is involved in playing it.
 *
 * ── Why it is not a React component any more ──────────────────────────────
 *
 * It was one, and that is how Max's "you have completely removed the animation
 * of all the people" happened. Nothing was removed. /dashboard and /athlete are
 * client components, so their server HTML is a Suspense bail-out and anything
 * they render waits for roughly a megabyte of JavaScript. The montage of
 * fourteen sports was drawn by an effect inside that megabyte, on a clock
 * anchored to the start of the navigation — so on the slow launch it existed
 * for, its own timeline said the montage was over before the code that draws it
 * was alive, and on a fast launch the ready-handler jumped the clock past it
 * deliberately. Both ends closed. The full reasoning is in
 * lib/montage-schedule.ts.
 *
 * So the sequence moved to where the first paint is: here. The fourteen
 * figures are one image, scrolled by background-position. The timings are
 * generated from lib/montage-schedule.ts, so the CSS below and anything in
 * JavaScript that needs to know how long this lasts read the same numbers.
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
 * Inline, unconditional, and it cannot be late. */
html { background: #FBF8F3 }

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
}
/* The way out. Set by the inline script — on app-ready, on a tap, or by the
 * dead-man's switch — then the element is removed a beat later. */
html[data-boot-out] #cv-boot { opacity: 0; pointer-events: none }

/* ── The montage: the people ──────────────────────────────────────────────
 *
 * One image, ${SPORT_COUNT} frames wide, generated from the app's own artwork by
 * tools/build-montage-sprite.mjs and precached by public/sw.js. The frames are
 * stepped through by background-position, which is why this needs no script
 * and cannot be late.
 *
 * The figures are --ink-figure and that is a safeguarding constraint, not a
 * style choice: WCAG 2.3.1 permits three flashes a second, a flash being a
 * luminance swing of 10% or more over a large area, and these are full-height
 * and change as fast as every 70ms. --ink-figure sits at 7.6% against the ink
 * ground. --primary-dark is 11.0% and --primary 22.1%; either would flash, for
 * an audience aged 13-18. If they need to read harder, make them bigger or
 * slower. Never lighter. The colour is baked into the sprite because a
 * background-image cannot inherit currentColor; tools/boot-smoke.mjs asserts
 * the baked value still matches the token.
 */
#cv-boot .figs {
  position: absolute; top: 50%; left: 50%;
  width: min(62vw, 260px); height: min(84vw, 350px);
  transform: translate(-50%, -54%);
  background-image: url(/splash/montage.svg);
  background-repeat: no-repeat;
  background-size: ${SPORT_COUNT * 100}% 100%;
  background-position: 0% 50%;
  opacity: 0;
  animation: cv-riffle ${SEQUENCE_MS}ms step-end both,
             cv-figs ${SEQUENCE_MS}ms linear both;
}
${MONTAGE_KEYFRAMES}
/* On for the montage, off as it collapses into the mark. */
@keyframes cv-figs {
  0%, ${at(DRAW_MS - 1)} { opacity: 0 }
  ${at(DRAW_MS)}, ${at(COLLAPSE_AT - 60)} { opacity: 1 }
  ${at(COLLAPSE_AT + 120)}, 100% { opacity: 0 }
}

/* ── The stroke: the voice ────────────────────────────────────────────────
 *
 * The amplitude envelope of a real coaching clip, drawn once across the
 * montage's own clock so sound and sport accelerate together. It is revealed
 * by a clip-path wipe rather than by animating sixty-four bars, because sixty
 * bars times sixty frames a second is work for nothing on a phone — and
 * because one element is one thing that can go wrong.
 */
#cv-boot .wave {
  position: absolute; top: 50%; left: 50%;
  width: min(86vw, 440px); height: 170px;
  transform: translate(-50%, -50%);
  color: #5D7F59;
  animation: cv-wave ${SEQUENCE_MS}ms linear both;
}
@keyframes cv-wave {
  0%            { clip-path: inset(0 100% 0 0); opacity: 1 }
  ${at(DRAW_MS)}   { clip-path: inset(0 92% 0 0); opacity: 1 }
  ${at(COLLAPSE_AT)} { clip-path: inset(0 0 0 0); opacity: 1 }
  ${at(COLLAPSE_AT + 280)}, 100% { clip-path: inset(0 0 0 0); opacity: 0 }
}

/* ── What it all arrives at ───────────────────────────────────────────────
 *
 * The mark and the wordmark are the app's resting frame, and they are also the
 * picture in the iOS launch images, so the handoff from the OS screen to this
 * one is a repaint of the same pixels. They start invisible and are handed
 * back by the animation's "both" fill mode, which is what guarantees they can
 * never be left hidden — the failure the "never leave the brand invisible"
 * rule in CLAUDE.md exists for.
 */
#cv-boot .m {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, calc(-50% - 34px));
  width: 118px; height: 118px; border-radius: 34px;
  background: linear-gradient(135deg, #6F8E6B 0%, #4F6B4B 100%);
  box-shadow: 0 20px 56px rgba(111, 142, 107, .48);
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  animation: cv-mark ${SEQUENCE_MS}ms cubic-bezier(.22, 1, .36, 1) both;
}
@keyframes cv-mark {
  0%, ${at(MARK_AT)} {
    opacity: 0; transform: translate(-50%, calc(-50% - 34px + 46px)) scale(.55);
  }
  ${at(MARK_AT + 420)}, 100% {
    opacity: 1; transform: translate(-50%, calc(-50% - 34px)) scale(1);
  }
}
#cv-boot .w {
  position: absolute; top: calc(50% + 62px); left: 0; right: 0;
  text-align: center; color: #F5ECD7;
  font-weight: 800; font-size: 38px; letter-spacing: -0.04em;
  /* The system stack, with no var(--font-jakarta) in front of it. Inheriting
     put the wordmark in the browser's default serif — the brand's first
     impression in a typeface it does not use — and naming the variable first
     did not fix it: the variable is still unresolved at this instant, and an
     empty var() makes the whole font-family declaration invalid at computed
     value time, taking the fallbacks down with it. This paints before the
     webfont by definition, so it asks for what is already on the device. */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  opacity: 0;
  animation: cv-word ${SEQUENCE_MS}ms cubic-bezier(.22, 1, .36, 1) both;
}
@keyframes cv-word {
  0%, ${at(WORD_AT)} { opacity: 0; transform: translateY(14px) }
  ${at(WORD_AT + 380)}, 100% { opacity: 1; transform: translateY(0) }
}
#cv-boot .t {
  position: absolute; left: 0; right: 0;
  bottom: calc(env(safe-area-inset-bottom) + 34px);
  text-align: center; color: rgba(245, 236, 215, .72);
  font-size: 13px; font-style: italic;
  opacity: 0;
  animation: cv-word ${SEQUENCE_MS}ms cubic-bezier(.22, 1, .36, 1) both;
}

/* ── Reduced motion ───────────────────────────────────────────────────────
 *
 * No montage, no wipe, no rise: the resting frame, immediately. Note this has
 * to hand the mark and wordmark back explicitly — they are opacity: 0 in
 * their own rules and only the animation makes them visible, so cancelling the
 * animation without this would leave an ink screen with nothing on it. That is
 * the worst failure available here and it is one line away at all times.
 */
@media (prefers-reduced-motion: reduce) {
  #cv-boot .figs, #cv-boot .wave { animation: none; opacity: 0 }
  #cv-boot .m, #cv-boot .w, #cv-boot .t {
    animation: none; opacity: 1; transform: none;
  }
  #cv-boot .m { transform: translate(-50%, calc(-50% - 34px)) }
}

/* ── The intro's pre-animation frame ───────────────────────────────────────
 *
 * IntroSequence renders the frame it *resolves into* — the mark and the
 * wordmark, fully opaque — because that is also the resting state of "/" for
 * anyone who has already seen the sequence. That markup is what the server
 * sends, so on a cold start the browser paints "CoachVoice" the moment the
 * HTML lands and then holds it there for the whole JavaScript download. Only
 * once the component hydrated did its effect rewind the two elements to
 * invisible and start the animation — so the wordmark appeared, sat, blinked
 * out, and animated back in. That is the title flashing before the intro.
 *
 * Hiding them here costs nothing and cannot be late: the attribute is set by
 * the script below, before the body paints, and the rule applies at first
 * paint. The effect then owns the two elements through inline styles and drops
 * the attribute. */
html[data-intro] .cv-intro-figure { opacity: 0 }`

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
    // Anchored to when the NAVIGATION started, not to when this script finally
    // ran. Everything before this line — the "/" hop, the middleware's auth
    // round trips, the document transfer, the stylesheet this script used to
    // wait behind — is screen the user has already spent staring at nothing.
    // performance.now() here is exactly that elapsed time.
    //
    // Anchoring to parse time made the sequence start afresh at the end of the
    // wait, so the dead time and the 2.1s sequence added up instead of
    // overlapping. That is the difference between "3s of black, then the intro
    // from frame 1" and "the intro is already most of the way through by the
    // time you see it". Measured against a 2500ms held document: the user
    // reached the app at 5.8s before, 3.1s after.
    window.__cvBootAt = Date.now() - Math.round(performance.now())
    d.setAttribute('data-boot', '1')

    /* ── The only way out ──────────────────────────────────────────────────
     *
     * One function, three callers: the app saying it has something to show,
     * a tap, and the dead-man's switch. They used to be three code paths
     * removing two attributes each, which is three chances to disagree.
     *
     * The floor is what guarantees the montage is actually seen. The previous
     * design had the opposite rule — when the app became ready early it
     * jumped the animation's clock forward to skip straight to the logo — and
     * skipping the montage on a fast launch was half of why the fourteen
     * sports had stopped appearing at all. A cold start is the one moment
     * this app has to look like something; it is worth ${FLOOR_MS}ms. A tap
     * overrides it, because someone who taps wants to be in the app.
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
      var waited = Date.now() - window.__cvBootAt
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
    <html lang="en" className={`${jakartaSans.variable} ${newsreader.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* PWA / Apple home screen */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CoachVoice" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon.png" />
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
        {/* The montage image, asked for as early as the document can ask. It
            is the first thing the cold-start sequence draws, and it is the one
            part of that sequence that is not already in this document. The
            service worker precaches it too, so after the first launch it comes
            off disk; this is what covers the first launch. */}
        <link rel="preload" as="image" href="/splash/montage.svg" type="image/svg+xml" />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
      </head>
      <body>
        {/* The first painted frame on a cold start, and the whole sequence that
            follows it. Server-rendered and driven by the inline CSS above, so
            it plays whether or not the bundle ever arrives. See BOOT_CSS. */}
        <div id="cv-boot" aria-hidden="true">
          {/* The people. One image, fourteen frames, stepped by
              background-position — see BOOT_CSS and
              tools/build-montage-sprite.mjs. */}
          <div className="figs" />

          {/* The voice: the amplitude envelope of a real coaching clip, wiped
              in from the left across the montage's own clock. Static bars
              revealed by a clip-path, not sixty-four animated elements — one
              thing to go wrong instead of sixty-four, and no per-frame layout
              work on a phone that is already busy booting. */}
          <svg className="wave" viewBox="0 0 440 170" preserveAspectRatio="none" aria-hidden="true">
            {PEAKS.map((peak, i) => {
              const h = Math.max(3, peak * 2.6)
              return (
                <rect
                  key={i}
                  x={i * (440 / PEAKS.length) + 1}
                  y={85 - h / 2}
                  width={440 / PEAKS.length - 2}
                  height={h}
                  rx={2}
                  fill="currentColor"
                />
              )
            })}
          </svg>

          <div className="m">
            <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
            </svg>
          </div>
          <div className="w">CoachVoice</div>
          <div className="t">Your private training journal</div>
        </div>
        {children}
      </body>
    </html>
  )
}
