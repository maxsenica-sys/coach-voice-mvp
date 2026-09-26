'use client'

/**
 * BodyMap — tap where it hurts.
 *
 * Front and back, every region a real button. Multi-select, because soreness
 * rarely respects one region, and toggling off is the same tap that toggled on.
 *
 * ── Accessibility is not optional here ───────────────────────────────────
 *
 * An SVG diagram is the easiest thing in an app to make unusable. Every region
 * is a `<button>` inside a foreign-object-free SVG — rendered as SVG shapes
 * with `role="button"`, `tabIndex`, `aria-pressed` and a real `aria-label`
 * naming the side ("Left hamstring") — so it is operable by keyboard and
 * announced correctly by a screen reader. A selected region is never signalled
 * by fill alone: it also gets a heavier stroke, which is what carries the
 * state for anyone who cannot distinguish the two colours.
 *
 * The chosen regions are also listed as text under the diagram. That list is
 * the accessible source of truth, and it is genuinely useful for everyone —
 * "Left hamstring, Lower back" is faster to check than re-reading a picture.
 *
 * ── Sides ────────────────────────────────────────────────────────────────
 *
 * Labels are from the athlete's own point of view, which is the opposite of
 * what the viewer sees in a front view. `lib/body-map.ts` derives that rather
 * than trusting anyone to type it per region.
 */
import { useState } from 'react'
import {
  BODY_VIEWBOX,
  regionLabel,
  regionsFor,
  type BodyRegion,
  type BodyView,
} from '@/lib/body-map'

function RegionShape({
  region,
  selected,
  onToggle,
}: {
  region: BodyRegion
  selected: boolean
  onToggle: () => void
}) {
  const common = {
    role: 'button',
    tabIndex: 0,
    'aria-pressed': selected,
    'aria-label': regionLabel(region.id),
    onClick: onToggle,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
    },
    /* The focus ring stays.
     *
     * This read `outline: 'none'`, directly under a docblock stating that
     * accessibility is not optional here — and the component does everything
     * else right: role, tabIndex, aria-pressed, aria-label, Enter and Space.
     * It built a fully keyboard-operable body map and then made it impossible
     * to see where you were on it.
     *
     * `outline: 'none'` is usually written to kill an ugly default ring. The
     * fix for an ugly ring is a better ring, so this draws one that matches the
     * rest of the app and only appears for keyboard users. */
    style: { cursor: 'pointer' } as React.CSSProperties,
    className: 'cv-region',
    fill: selected ? 'var(--wellness-low-tint)' : 'var(--surface-2)',
    // An unselected region's edge is the boundary of a control, so it needs
    // 3:1 against the card (WCAG 1.4.11). --border is 1.3:1 on the ink card —
    // the figure dissolved into it. --text-muted at 0.7 is ~3.6:1 and still
    // reads as an outline rather than a drawing.
    stroke: selected ? 'var(--wellness-low)' : 'var(--text-muted)',
    strokeOpacity: selected ? 1 : 0.7,
    // Selection is carried by weight as well as colour, so it survives a
    // colour-blind reader and a bright phone screen outdoors.
    strokeWidth: selected ? 2.5 : 1,
  }

  return region.shape.kind === 'rect' ? (
    <rect
      {...common}
      x={region.shape.x}
      y={region.shape.y}
      width={region.shape.w}
      height={region.shape.h}
      rx={region.shape.r}
    />
  ) : (
    <ellipse
      {...common}
      cx={region.shape.cx}
      cy={region.shape.cy}
      rx={region.shape.rx}
      ry={region.shape.ry}
    />
  )
}

export default function BodyMap({
  selected,
  onChange,
  perspective = 'self',
  showSelection = true,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  /** Whose body this is to the reader: the athlete's own ("your left") on the
   *  check-in, someone else's ("their left") on the coach's injury panel. */
  perspective?: 'self' | 'other'
  /** The "Selected: …" line under the figure. On by default, which is what
   *  InjuryPanel relies on. CheckIn turns it off because it states the same
   *  fact in its own words directly underneath — two lines that disagreed
   *  about what an empty map meant ("Nothing selected yet" over "Nothing
   *  marked — nothing hurts") were one line too many. Whoever turns this off
   *  owns the accessible list of what is selected. */
  showSelection?: boolean
}) {
  const [view, setView] = useState<BodyView>('front')

  /* Which of the athlete's sides is on the viewer's left in this view. Read
   * from the regions themselves — every paired region's `_l` twin is authored
   * on the viewer's left and lib/body-map.ts derives its side from the view —
   * so the caption cannot disagree with the aria-labels. */
  const viewerLeft = regionsFor(view).find((r) => r.id.endsWith('_l'))?.side ?? 'right'
  const whose = perspective === 'self' ? 'Your' : 'Their'
  const captionLeft = `${whose} ${viewerLeft === 'right' ? 'right' : 'left'}`
  const captionRight = `${whose} ${viewerLeft === 'right' ? 'left' : 'right'}`

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  return (
    <div>
      {/* Front / back. Two buttons rather than a swipe: a swipe on a diagram
          competes with the page scroll and cannot be found by a keyboard. */}
      <div
        role="group"
        aria-label="Which side of the body"
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12,
        }}
      >
        {(['front', 'back'] as BodyView[]).map((v, i) => {
          const on = view === v
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => setView(v)}
              style={{
                minWidth: 0, minHeight: 44, border: 'none',
                borderRadius: i === 0 ? '11px 0 0 11px' : '0 11px 11px 0',
                borderLeft: i === 1 ? '1px solid var(--border)' : 'none',
                background: on ? 'var(--surface-2)' : 'transparent',
                color: on ? 'var(--text)' : 'var(--text-2)',
                fontFamily: 'var(--font-cast)', fontSize: 16, fontWeight: 700,
                letterSpacing: '0.16em', textTransform: 'uppercase',
                cursor: 'pointer',
                // Selection is not colour alone: the chosen half also carries
                // an inset rule along its foot.
                boxShadow: on ? 'inset 0 -2px 0 var(--primary)' : 'none',
              }}
            >
              {v}
            </button>
          )
        })}
      </div>

      {/* The mirroring, stated on the screen rather than left in a comment:
          in a front view the shape on the viewer's left is the athlete's
          RIGHT. Positioned over the arms, not the edges, so each caption sits
          above the side it names. */}
      <div aria-hidden="true" style={{
        display: 'flex', justifyContent: 'space-between', gap: 8,
        width: '100%', maxWidth: 'min(100%, 320px)', margin: '0 auto 4px', padding: '0 14%',
        fontFamily: 'var(--font-cast)', fontSize: 'var(--t-furniture)', fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-2)',
      }}>
        <span>{captionLeft}</span>
        <span>{captionRight}</span>
      </div>

      <svg
        viewBox={`0 0 ${BODY_VIEWBOX.w} ${BODY_VIEWBOX.h}`}
        role="group"
        aria-label={`Body map, ${view} view. Tap where you are sore.`}
        /* maxWidth is the scale control for every tap target in here: the
         * viewBox is 200 wide, so a region's real size is its authored size
         * times (rendered width / 200) and the number in lib/body-map.ts is
         * not what a thumb gets. At 260 on a 390px phone the figure rendered
         * at 1.3x and left 60px of the card unused, which put the neck at
         * 28.6x20.8 — under the 24px WCAG 2.5.8 minimum on its short side —
         * and the achilles at 16.9 wide. 320 spends that slack: 1.6x, and
         * every region but the achilles clears 24 at 390px. The achilles is
         * 13 units wide and would need 15 to clear it; that is geometry, it
         * lives in lib/body-map.ts, and it is a decision about the drawing
         * rather than something this file can fix. */
        style={{ width: '100%', maxWidth: 320, display: 'block', margin: '0 auto', touchAction: 'manipulation' }}
      >
        {regionsFor(view).map((r) => (
          <RegionShape
            key={r.id}
            region={r}
            selected={selected.includes(r.id)}
            onToggle={() => toggle(r.id)}
          />
        ))}
      </svg>

      {/* The accessible source of truth, and the fastest way for anyone to
          check what they picked. */}
      {showSelection && <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', color: 'var(--text-2)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
        {selected.length === 0
          ? 'Nothing selected yet — tap the areas that are sore.'
          : (
            <>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>Selected: </span>
              {selected.map(regionLabel).join(', ')}
            </>
          )}
      </div>}
    </div>
  )
}
