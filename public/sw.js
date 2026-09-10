/* CoachVoice service worker.
 *
 * ── Why this file is written by hand ──────────────────────────────────────
 *
 * next.config.ts wraps the config in @ducanh2912/next-pwa and hands it a
 * careful `runtimeCaching` array. None of it has ever run. next-pwa is a
 * webpack plugin, this project builds with Turbopack, so the plugin's hook is
 * never called and no service worker is emitted: `/sw.js` returned 404 in
 * production and `public/` contained no sw.js or workbox chunk after a build.
 * Every rule in that array was dead, including the `/_next/static/*`
 * CacheFirst rule that the comment in app/layout.tsx relies on when it says
 * the self-hosted fonts are covered by the service worker. They were not
 * covered by anything.
 *
 * So the caching is written here, where it can be read and where it cannot
 * silently stop existing.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 *
 * It never caches an HTML document, and it never caches /api or Supabase.
 *
 * Caching the app shell would paint sooner, and it is the obvious next idea.
 * It is also how a PWA bricks itself: the prerendered /dashboard HTML names
 * content-hashed chunk URLs, so a shell served from cache after a deploy asks
 * for chunks that no longer exist and the app opens to nothing. There is no
 * staging environment here to catch that. Assets are safe to cache forever
 * precisely because their URLs change when their content does; documents are
 * not, so documents go to the network every time.
 *
 * Anything this file does not explicitly claim is left alone — no respondWith,
 * no interception, identical behaviour to having no service worker at all.
 */

// Bump to invalidate everything this worker has cached. The asset URLs are
// content-hashed, so this is for changing the *rules*, not the contents.
const VERSION = 'v1'
const STATIC_CACHE = `cv-static-${VERSION}`

/* The OS launch images and the home-screen icons. Precached on install so the
 * very first cold start after installing already has them on disk — they are
 * the frame the user looks at while the document is still in flight. */
const PRECACHE = [
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-icon.png',
  '/splash/launch-750x1334.png',
  '/splash/launch-828x1792.png',
  '/splash/launch-1125x2436.png',
  '/splash/launch-1170x2532.png',
  '/splash/launch-1179x2556.png',
  '/splash/launch-1206x2622.png',
  '/splash/launch-1284x2778.png',
  '/splash/launch-1290x2796.png',
  '/splash/launch-1320x2868.png',
]

/** Immutable, content-hashed, safe to keep for as long as the URL exists. */
function isCacheable(url) {
  if (url.pathname.startsWith('/_next/static/')) return true
  if (url.pathname.startsWith('/splash/')) return true
  return /^\/(icon|apple-icon)[^/]*\.(png|svg)$/.test(url.pathname)
}

/* An upper bound on entries, because these URLs are content-hashed.
 *
 * That is what makes them safe to cache forever, and it is also why the cache
 * would otherwise grow forever: every deploy mints new chunk names, the old
 * ones stop being requested, and nothing ever asks for them again — so nothing
 * would ever evict them. Over months of deploys that is tens of megabytes of
 * JavaScript no version of the app can use, on a phone.
 *
 * `cache.keys()` returns insertion order, so dropping from the front evicts
 * the oldest, which is the least likely to belong to the current deploy. The
 * limit is generous: a full page load of this app is well under a hundred
 * requests, so the live set is never at risk of being trimmed.
 */
const MAX_ENTRIES = 240

async function trim(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_ENTRIES) return
  for (const req of keys.slice(0, keys.length - MAX_ENTRIES)) {
    await cache.delete(req)
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      // Individually, not addAll: addAll rejects as a unit, so one missing
      // image would throw away the whole precache and leave the worker
      // installed with nothing in it.
      await Promise.all(
        PRECACHE.map((p) => cache.add(p).catch(() => { /* skip this one */ })),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('cv-') && key !== STATIC_CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return
  // Belt and braces. isCacheable already excludes both, but a document or an
  // API response must never end up in this cache even if that changes.
  if (req.mode === 'navigate' || req.destination === 'document') return
  if (url.pathname.startsWith('/api/')) return
  if (!isCacheable(url)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      // Only a clean, complete, same-origin 200 is worth keeping. An opaque or
      // partial response cached here would be served forever.
      if (res.ok && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone()).then(() => trim(cache)).catch(() => { /* quota, most likely */ })
      }
      return res
    })(),
  )
})

/* An escape hatch that does not need a deploy. If this worker ever has to be
 * taken out of the field, `navigator.serviceWorker.controller.postMessage
 * ({ type: 'cv-sw-reset' })` from the console drops every cache and
 * unregisters it. */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cv-sw-reset') return
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('cv-')) await caches.delete(key)
      }
      await self.registration.unregister()
    })(),
  )
})
