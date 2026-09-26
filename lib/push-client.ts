// lib/push-client.ts — Web Push, browser side.
//
// Subscribing, unsubscribing and working out whether this device can do either.
// The server half is lib/push.ts; the card is app/components/PushOptIn.tsx.
//
// Nothing here registers a service worker. app/layout.tsx owns that (production
// only, on load), and a second registration path is how an app ends up with a
// worker in development that serves stale bundles. This file waits for the one
// that exists, with a time limit, and says so if there is none.

import { apiMutate } from '@/lib/api-client'

/** The VAPID public key, inlined at build time. Null when push is not set up. */
export function pushPublicKey(): string | null {
  const k = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  return k && k.trim() ? k.trim() : null
}

export type PushSupport =
  | 'ok'
  /** iPhone/iPad in Safari: push exists only for an app added to the Home Screen. */
  | 'ios-needs-install'
  /** Installed on iOS, but older than 16.4 — no Web Push at all. */
  | 'ios-too-old'
  | 'unsupported'

function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (isIOS()) {
    if (!isStandalone()) return 'ios-needs-install'
    return hasApis ? 'ok' : 'ios-too-old'
  }
  return hasApis ? 'ok' : 'unsupported'
}

/** The worker, or null if none becomes active within `ms`. */
async function readyRegistration(ms = 8000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ])
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

/** This device's current subscription, if it has one. */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  // getRegistration, not `ready`: a device with a subscription necessarily has
  // a registration already, and `ready` never settles where there is no worker
  // (development) — which would stall sign-out behind forgetPushOnSignOut.
  const reg = await navigator.serviceWorker.getRegistration('/').catch(() => undefined)
  if (!reg) return null
  return reg.pushManager.getSubscription().catch(() => null)
}

async function saveOnServer(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  await apiMutate('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  })
}

/**
 * Turn notifications on for this device. Must be called from a tap: Safari
 * only shows the permission prompt in direct response to one, which is why the
 * prompt is the FIRST await here and not behind the worker lookup.
 *
 * Resolves 'on', or 'denied' when the person said no. Throws with a sentence
 * for anything else.
 */
export async function subscribeToPush(): Promise<'on' | 'denied'> {
  const key = pushPublicKey()
  if (!key) throw new Error('Notifications are not set up on CoachVoice yet.')
  if (pushSupport() !== 'ok') throw new Error('This browser cannot show notifications from CoachVoice.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const reg = await readyRegistration()
  if (!reg) throw new Error('CoachVoice is still starting up on this device. Try again in a moment.')

  const serverKey = keyBytes(key)
  let sub = await reg.pushManager.getSubscription()
  // Subscribed under an old key (the keys were rotated): the push service will
  // refuse every send, so replace it rather than re-saving a dead one.
  if (sub && !sameKey(sub.options?.applicationServerKey, serverKey)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })

  await saveOnServer(sub)
  return 'on'
}

/**
 * Turn notifications off for this device.
 *
 * The local unsubscribe comes first because it is the part that actually stops
 * notifications arriving — the person asked for silence, and that must not
 * depend on the network. The server row is then deleted; if that request
 * fails, the row is removed anyway the next time a send reaches it, because
 * the push service answers 410 for a subscription the browser dropped.
 */
export async function unsubscribeFromPush(): Promise<void> {
  const sub = await currentPushSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  const ok = await sub.unsubscribe().catch(() => false)
  if (!ok) throw new Error('Notifications could not be turned off. Try again.')
  try {
    await apiMutate('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
  } catch {
    // See above: the device is already off, and the stale row is cleaned up by
    // the 410 on the next send. Reporting an error here would tell the person
    // something failed when the thing they asked for happened.
  }
}

/**
 * Re-save an existing subscription for whoever is signed in now. Idempotent.
 * Browsers rotate subscriptions, and a second person may have signed in on
 * this device since; either way the server row should match what is here.
 */
export async function syncPushSubscription(): Promise<boolean> {
  if (!pushPublicKey() || pushSupport() !== 'ok') return false
  if (Notification.permission !== 'granted') return false
  const sub = await currentPushSubscription()
  if (!sub) return false
  await saveOnServer(sub)
  return true
}

/**
 * For sign-out: stop this device receiving the signed-out person's
 * notifications. Never throws — signing out must not be blockable by this.
 */
export async function forgetPushOnSignOut(): Promise<void> {
  try { await unsubscribeFromPush() } catch { /* signing out regardless */ }
}
