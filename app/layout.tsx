import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const jakartaSans = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#5B63F5',
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
    apple: '/icon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* PWA / Apple home screen */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CoachVoice" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <link rel="apple-touch-startup-image" href="/icon.svg" />
      </head>
      <body className={jakartaSans.variable}>
        {children}
      </body>
    </html>
  )
}
