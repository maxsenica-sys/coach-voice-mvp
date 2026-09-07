import type { Metadata, Viewport } from 'next'
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
 * build, they are covered by the service worker's `/_next/static/*` CacheFirst
 * rule (the custom `runtimeCaching` array in next.config.ts replaces next-pwa's
 * defaults, so Google Fonts were never cached by it either), and `display:
 * swap` means text paints immediately in the fallback regardless.
 *
 * Only Newsreader is preloaded. It carries the first heading on every screen,
 * so a swap there is visible. JetBrains Mono appears on a handful of 10-11px
 * labels and does not deserve a request competing with the app bundle.
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
  maximumScale: 1,
  userScalable: false,
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

const BOOT_CSS = `/* ── The boot shell ────────────────────────────────────────────────────────
 *
 * This exists because the splash it matches could not possibly be the first
 * thing you see. /dashboard and /athlete are client components, so their
 * server HTML is a Suspense bail-out — a full-screen "Loading…" — and
 * ColdStartSplash only unhides itself inside useEffect. That put roughly a
 * megabyte of JavaScript between opening the app and the brand moment: down-
 * load, parse, hydrate, and only then does anything branded appear. The
 * complaint that the app shows a long blank screen and *then* an animation was
 * exactly right, and no amount of tuning the animation could have fixed it.
 *
 * So the resting frame of the splash is server-rendered here in the layout and
 * shown by CSS alone. It paints with the first paint of the document. The
 * animated splash then takes over from it after hydration, at whatever point
 * in its own timeline the wall clock has already reached — see __cvBootAt.
 *
 * Nothing in this block may depend on JavaScript, on the CSS chunk, or on the
 * webfont. It is inline, it is unconditional, and its whole job is to be early.
 */
#cv-boot { display: none }
html[data-boot] #cv-boot { display: block }
html[data-boot-anim] #cv-boot { display: none }
#cv-boot {
  position: fixed; inset: 0; z-index: 9000;
  background: linear-gradient(160deg, #1F2421 0%, #3A4F38 100%);
}
#cv-boot .m {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, calc(-50% - 34px));
  width: 118px; height: 118px; border-radius: 34px;
  background: linear-gradient(135deg, #6F8E6B 0%, #4F6B4B 100%);
  box-shadow: 0 20px 56px rgba(111, 142, 107, .48);
  display: flex; align-items: center; justify-content: center;
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
}
#cv-boot .t {
  position: absolute; left: 0; right: 0;
  bottom: calc(env(safe-area-inset-bottom) + 34px);
  text-align: center; color: rgba(245, 236, 215, .72);
  font-size: 13px; font-style: italic;
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
 * It owns the cold-start decision outright. ColdStartSplash used to make it and
 * consume the storage keys itself, which cannot work now: by the time that
 * component runs, the shell has been on screen for a second or more and the
 * answer has to already be known. The component reads data-boot instead.
 *
 * Scoped to the two app pages on purpose. "/" runs its own intro and claims the
 * same session key when you sign in, and arming the shell there would both
 * double up and consume the key the sign-in flow depends on.
 *
 * The timeout is a dead-man's switch. If the bundle never arrives or throws
 * during hydration, nothing else would ever take the shell down, and an ink
 * screen with no way past it is a worse failure than the one being fixed. */
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
     * arrangement ColdStartSplash has with data-boot.
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
      if (Date.now() - last < 15000) return
      localStorage.setItem('cv_splash_at', String(Date.now()))
    }
    window.__cvBootAt = Date.now()
    d.setAttribute('data-boot', '1')
    setTimeout(function () {
      d.removeAttribute('data-boot')
      d.removeAttribute('data-boot-anim')
    }, 6400)
  } catch (e) { /* blocked storage: no shell, no splash, app still opens */ }
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
        {/* iOS launch images. This used to be one 512px square icon, which iOS
            stretched across the whole phone — the "black screen" before the app
            appeared. These are the resting frame of the splash at each device
            size, so the OS launch screen and the animation that follows are the
            same picture and the handoff is invisible. Generated, not hand-made;
            see the note in ColdStartSplash. */}
        <link rel="apple-touch-startup-image" href="/splash/launch-750x1334.png" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-828x1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1125x2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1170x2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1179x2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1206x2622.png" media="(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1284x2778.png" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1290x2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/launch-1320x2868.png" media="(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <style dangerouslySetInnerHTML={{ __html: BOOT_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: BOOT_JS }} />
      </head>
      <body>
        {/* The first painted frame on a cold start. See BOOT_CSS. */}
        <div id="cv-boot" aria-hidden="true">
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
