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
// Rebranded 2026-09-16, and the note that used to sit here called it correctly:
// these were eight stock Tailwind hues in a palette the rest of the app does
// not use. The product call it was waiting for has been made.
//
// ── Eight became six, and that is the finding, not a rounding ────────────
//
// This is the only place in the product where a user PICKS a colour, so it is
// the one place the colours must be tellable apart. Three of the old eight
// pairs were not, to a deuteranopic coach: blue/violet at ΔE 0.8, amber/lime
// at 1.3.
//
// Fixing that turned out to be impossible at eight. Solving the swatches onto
// an even lightness ladder under deuteranopia — the channel that survives —
// still left two pairs 1.1 L* apart, and every arrangement that separated one
// form of colour blindness collapsed another: optimise for deuteranopia and
// tritanopia closes to 0.6. That is the same structural result the wellness
// scale produced. A muted palette cannot carry many roles by colour, and
// adding swatches makes it strictly worse.
//
// So: six, spread across 25 L*, all above 4.5:1 on white. And the honest part —
// colour here is a SECONDARY cue. A squad is identified by its name everywhere
// it appears; the swatch reinforces that and is never the only way to tell two
// squads apart. Any future surface that shows a squad by colour alone is a bug,
// however good the palette is.
//
// Existing rows keep their stored hex, deliberately and with no backfill. A
// squad's colour is something a coach chose; silently rewriting it would be the
// app overruling them. Old squads keep their swatch, new ones come from this
// list, and the two converge as squads are created.

/** The swatches offered when creating or editing a group. */
export const GROUP_COLORS = [
  '#5F7C50',  // sage      L* 48.8
  '#894324',  // clay      L* 36.9
  '#6C4F13',  // amber     L* 35.6
  '#3D667B',  // slate     L* 41.1
  '#4A2D4D',  // plum      L* 23.2
  '#323639',  // graphite  L* 22.3
] as const

/** The swatch a new group starts on. */
export const DEFAULT_GROUP_COLOR: string = GROUP_COLORS[0]
