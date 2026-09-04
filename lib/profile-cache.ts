// lib/profile-cache.ts
//
// Keeps the signed-in user's identity available synchronously so navigating
// between pages doesn't visibly reset it.
//
// The problem this solves: every page mount ran `auth.getUser()` (a network
// round trip) and then a `profiles` query before it could render a name. So
// moving from the dashboard to an athlete and back flashed the "Coach"
// placeholder for a few hundred milliseconds each time, and the whole app felt
// like it reloaded on every click.
//
// This caches the small, non-sensitive bits of the profile in sessionStorage so
// the next mount can paint the correct name on the first frame, then revalidate
// in the background. Nothing here is trusted for access control — every API
// route re-checks the user server-side and RLS scopes the data regardless.
// sessionStorage (not localStorage) so it clears when the tab closes and can't
// outlive a sign-out on a shared device.

export type CachedProfile = {
  userId: string
  role: 'coach' | 'athlete' | ''
  firstName: string
  lastName: string
  sport: string
  email: string
}

const KEY = 'cv_profile_v1'

export const EMPTY_PROFILE: CachedProfile = {
  userId: '', role: '', firstName: '', lastName: '', sport: '', email: '',
}

/** Read the cached profile. Safe on the server and in private-mode browsers. */
export function readCachedProfile(): CachedProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedProfile>
    if (!parsed || typeof parsed.userId !== 'string' || !parsed.userId) return null
    return { ...EMPTY_PROFILE, ...parsed } as CachedProfile
  } catch {
    // Private browsing, disabled site data, or corrupt JSON — behave as a miss.
    return null
  }
}

export function writeCachedProfile(profile: CachedProfile): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(profile))
  } catch {
    /* storage unavailable — the app still works, just without the fast path */
  }
}

export function clearCachedProfile(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}

/** "Max Senica" — falls back to the email so the header is never blank. */
export function displayName(p: Pick<CachedProfile, 'firstName' | 'lastName' | 'email'>): string {
  const full = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()
  return full || p.email || ''
}

/** "MS" — two letters where possible, one from the email otherwise. */
export function initialsFor(p: Pick<CachedProfile, 'firstName' | 'lastName' | 'email'>): string {
  if (p.firstName && p.lastName) return `${p.firstName[0]}${p.lastName[0]}`.toUpperCase()
  if (p.firstName) return p.firstName[0].toUpperCase()
  return (p.email?.[0] ?? '?').toUpperCase()
}
