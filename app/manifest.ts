import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CoachVoice',
    short_name: 'CoachVoice',
    description: 'AI-powered voice coaching platform — record sessions, track athletes, build squads.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    // Matches the Letter/Ivory palette in globals.css (--bg and --text).
    background_color: '#FBF8F3',
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
