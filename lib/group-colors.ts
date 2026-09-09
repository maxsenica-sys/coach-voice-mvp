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
