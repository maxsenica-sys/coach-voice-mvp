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
    stroke: selected ? 'var(--wellness-low)' : 'var(--border)',
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
}: {
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [view, setView] = useState<BodyView>('front')

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  }

  return (
    <div>
      {/* Front / back. Two buttons rather than a swipe: a swipe on a diagram
          competes with the page scroll and cannot be found by a keyboard. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['front', 'back'] as BodyView[]).map((v) => {
          const on = view === v
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              onClick={() => setView(v)}
              style={{
                flex: 1, minHeight: 44, borderRadius: 'var(--radius-sm)',
                border: `1px solid ${on ? 'var(--primary-dark)' : 'var(--border)'}`,
                background: on ? 'var(--primary-light)' : 'var(--card)',
                color: on ? 'var(--primary-dark)' : 'var(--text-2)',
                fontFamily: 'inherit', fontSize: 'var(--fs-3)', fontWeight: on ? 800 : 600,
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {v}
            </button>
          )
        })}
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
         * every region but the achilles clears 24. The achilles is 13 units
         * wide in the geometry and cannot be fixed from here; see the note in
         * lib/body-map.ts before widening it. */
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
      <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', color: 'var(--text-2)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
        {selected.length === 0
          ? 'Nothing selected yet — tap the areas that are sore.'
          : (
            <>
              <span style={{ fontWeight: 700 }}>Selected: </span>
              {selected.map(regionLabel).join(', ')}
            </>
          )}
      </div>
    </div>
  )
}
