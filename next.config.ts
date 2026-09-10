import type { NextConfig } from 'next'

/* The @ducanh2912/next-pwa wrapper that used to be here is gone, along with a
 * forty-line `runtimeCaching` array that read as if it were the app's caching
 * policy.
 *
 * It never ran. next-pwa installs itself as a webpack plugin, this project
 * builds with Turbopack, so the hook was never called: a production build
 * emitted no `public/sw.js` and no workbox chunk, and `/sw.js` answered 404.
 * Every rule in that array was dead — the NetworkOnly rules for Supabase and
 * /api were describing a worker that did not exist, and the `/_next/static/*`
 * CacheFirst rule is the one the comment in app/layout.tsx cites when it says
 * the self-hosted fonts are covered by the service worker. Nothing was
 * covering them.
 *
 * Dead configuration that reads as policy is worse than none, because it gets
 * cited. The caching now lives in public/sw.js, registered from
 * app/layout.tsx, where it can be read and where a build cannot quietly stop
 * producing it. tools/boot-smoke.mjs checks that it is served and registered.
 */
const nextConfig: NextConfig = {
  turbopack: {},
}

export default nextConfig
