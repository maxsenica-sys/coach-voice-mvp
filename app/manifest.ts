import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CoachVoice',
    short_name: 'CoachVoice',
    description: 'AI-powered voice coaching platform — record sessions, track athletes, build squads.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    // background_color is the first frame of every cold start on Android: the
    // OS paints it, with the icon on it, before a byte of the app exists. It
    // is therefore always the app's own ground — globals.css --bg — and
    // nothing else. Since Stadium Night that is ink, #1F2421.
    //
    // Note what that means for the history below. #1F2421 was the wrong
    // answer then because the app was ivory: the bug was never the colour, it
    // was a launch screen that did not match the app it launched, followed by
    // a full-screen jump to a different ground. The same jump, inverted —
    // ivory launch, ink app — is what this line was until 2026-09-25, and a
    // ~92% relative-luminance swing across the whole screen is the opposite
    // of what an audience of 13-18 year olds should get on every launch.
    // tools/boot-smoke.mjs asserts the served value equals the browser's
    // computed --bg, which catches the mismatch in either direction.
    //
    // theme_color is the same ink: it colours the status bar and the task
    // switcher header, which sit directly against the app's ground.
    //
    // This value was being thrown away. `public/manifest.webmanifest` — a
    // stale, hand-written copy of this file, committed and never updated —
    // shadows this route: a static file in public/ wins, so the manifest the
    // browser actually fetched was that one, with `background_color:
    // "#1F2421"`. That colour is the launch screen the OS paints for the whole
    // cold start, before a single byte of the app exists, which is the
    // "completely black screen for 2-3 seconds" the app opens with. It also
    // carried a different description, no maskable icon, and shortcuts
    // pointing at ?tab= URLs the dashboard no longer reads.
    //
    // The static copy is deleted. Do not add one back: there is no warning
    // when it shadows this, and nothing in the build or the type system can
    // see it happen.
    background_color: '#1F2421',
    theme_color: '#1F2421',
    categories: ['sports', 'productivity', 'health'],
    // iOS ignores SVG icons on the home screen, so PNGs must be present or the
    // install falls back to a screenshot of the page. The maskable copy is
    // padded to the safe zone so Android doesn't crop the microphone.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    screenshots: [],
    shortcuts: [
      {
        name: 'Dashboard',
        url: '/dashboard',
        description: 'Coach dashboard',
      },
      {
        name: 'My Portal',
        url: '/athlete',
        description: 'Athlete portal',
      },
    ],
  }
}
