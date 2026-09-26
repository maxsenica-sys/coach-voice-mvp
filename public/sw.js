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

/* What the webview actually fetches on a cold start.
 *
 * This list used to hold the nine iOS launch images and the home-screen icons,
 * on the reasoning that they are "the frame the user looks at while the
 * document is still in flight". They are — and that is exactly why a service
 * worker cannot help with them. The OS paints the launch image before the
 * webview exists, from a copy it stored when the app was added to the home
 * screen; this worker runs inside that webview. It was never in the path. With
 * the launch images now covering every iPhone and iPad rather than nine
 * geometries, keeping them here would have been 1.5MB of a user's phone spent
 * on files this code can never serve.
 *
 * The montage is different, and it is the one thing here that matters. It is
 * fetched by the webview, on every cold start, and it is the first thing the
 * boot shell draws — so its absence is a blank rectangle where the fourteen
 * sports should be, rather than merely a slower load. Everything else the app
 * needs is content-hashed under /_next/static/ and is cached on first use by
 * the fetch handler below.
 */
const PRECACHE = [
  '/splash/montage.svg',
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
  // The precache is inserted first at install, so dropping from the front
  // would evict the launch images and icons before anything else — exactly
  // backwards, and invisible to the boot check, which only ever looks at a
  // fresh install. Skip them.
  const protectedPaths = new Set(PRECACHE)
  const evictable = keys.filter((r) => {
    try { return !protectedPaths.has(new URL(r.url).pathname) } catch { return true }
  })
  for (const req of evictable.slice(0, keys.length - MAX_ENTRIES)) {
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
      // Any failure here falls through to the network. The header above
      // promises behaviour identical to having no worker at all, and without
      // this that promise breaks in the worst possible place: caches.open()
      // rejecting under blocked or partitioned storage would reject the
      // response for /_next/static/chunks/*.js, which is a blank app — worse
      // than no caching.
      let cache
      try {
        cache = await caches.open(STATIC_CACHE)
        const hit = await cache.match(req)
        if (hit) return hit
      } catch {
        return fetch(req)
      }
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

/* ── Push notifications ──────────────────────────────────────────────────
 *
 * Sent by lib/push.ts for a new message and for a session shared with an
 * athlete — never for the weekly digest or the takeaway reminder, which stay
 * in the app.
 *
 * A notification shows a TITLE ("New message from Max") and nothing else. The
 * server never puts message text, a transcript, a summary or anything about
 * wellness or injury in the payload, and this handler would not show it if it
 * did: it reads `title`, `url` and `tag` by name and builds the options object
 * itself, with no `body`. Lock screens are read by whoever holds the phone, and
 * many of the people these reach are children.
 *
 * Neither handler touches a cache or a fetch, so nothing above changes.
 */

/** A same-origin path to open, or "/" for anything else. */
function pushTarget(raw) {
  try {
    const u = new URL(typeof raw === 'string' && raw ? raw : '/', self.location.origin)
    if (u.origin !== self.location.origin) return '/'
    return u.pathname + u.search
  } catch {
    return '/'
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  if (!data || typeof data !== 'object') data = {}
  const title = typeof data.title === 'string' && data.title.trim()
    ? data.title.trim().slice(0, 120)
    : 'CoachVoice'
  const options = {
    tag: typeof data.tag === 'string' && data.tag ? data.tag.slice(0, 80) : 'cv',
    data: { url: pushTarget(data.url) },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }
  // Every push must show something: a push that shows nothing is treated by
  // the browser as abuse and can cost the subscription.
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = pushTarget(event.notification.data && event.notification.data.url)
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of wins) {
        let sameOrigin = false
        try { sameOrigin = new URL(c.url).origin === self.location.origin } catch { /* skip */ }
        if (!sameOrigin) continue
        // Focus first, while the tap still counts as a user gesture; then move
        // the already-open app to the right page rather than opening a second.
        try { await c.focus() } catch { /* still navigate */ }
        try {
          if ('navigate' in c) { await c.navigate(target); return }
        } catch { /* an uncontrolled window cannot be navigated — open one */ }
        break
      }
      await self.clients.openWindow(target)
    })(),
  )
})
