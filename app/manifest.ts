import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CoachVoice',
    short_name: 'CoachVoice',
    description: 'AI-powered voice coaching platform — record sessions, track athletes, build squads.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#2563eb',
    categories: ['sports', 'productivity', 'health'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
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
