// lib/group-colors.ts
//
// The palette a coach picks from when naming a squad, and the colour that then
// gets written to `groups.color` and read back on every render.
//
// This lives here rather than in app/dashboard/page.tsx for the same reason
// the wellness palette lives in lib/wellness-config.ts: it is **data**, not a
// design token. The values are persisted per row, they are chosen by a user
// rather than by us, and old groups keep whatever hex they were created with.
// A page that hardcodes a design token has drifted from the system; a module
// that names a picker palette has not.
//
// It also keeps app/dashboard/page.tsx free of hex literals, which is what the
// no-restricted-syntax rule in eslint.config.mjs enforces. That rule is aimed
// at hand-copied tokens, not at colour data — moving this out is the honest
// way to satisfy it, rather than adding an exception to the rule.
//
// A note for whoever picks this up: these are stock Tailwind hues and they do
// not belong to the "Letter Edition" palette the rest of the app uses — the
// same complaint DESIGN-001 made about the wellness colours before they were
// replaced with brand tokens. Rebranding them is a real improvement and a real
// decision: existing rows keep their stored hex, so for a while the swatch a
// coach sees on an old squad would not appear in the picker offered for a new
// one. That needs a product call (and probably a backfill), which is why this
// commit moved the palette without changing it.

/** The swatches offered when creating or editing a group. */
export const GROUP_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#dc2626',
  '#d97706',
  '#0891b2',
  '#db2777',
  '#65a30d',
] as const

/** The swatch a new group starts on. */
export const DEFAULT_GROUP_COLOR: string = GROUP_COLORS[0]

/**
 * A stable accent colour derived from a row's id.
 *
 * It used to be `_toneColors[i % 3]` — the athlete's **index in whatever array
 * was being rendered**. So the same person was sage in the roster strip and
 * rust in the recent-sessions list, and adding one athlete re-coloured
 * everybody. An identity colour that changes identity is worse than no colour
 * at all: it teaches the eye a pattern and then breaks it.
 *
 * Hashing the id fixes both. The colour is stable for the life of the row, the
 * same in every list, and unaffected by what else is on screen. Pass an athlete
 * id for an athlete; the coach's calendar strip keys off the event id, because
 * a calendar row carries a name but no athlete id.
 *
 * These three are brand tokens rather than hexes because, unlike GROUP_COLORS
 * above, nobody picks them and nothing persists them — they are presentation
 * derived from a key, so they should follow the design system.
 */
const TONES = ['var(--coach-color)', 'var(--primary-dark)', 'var(--energy-dark)'] as const

export function stableTone(key: string): string {
  // FNV-1a. Any stable hash would do; this one is short, has no dependencies
  // and spreads short similar strings (uuids differing in one character) far
  // better than summing char codes.
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return TONES[Math.abs(h) % TONES.length]
}
