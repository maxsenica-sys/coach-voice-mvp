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
    style: { cursor: 'pointer', outline: 'none' } as React.CSSProperties,
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
                flex: 1, minHeight: 40, borderRadius: 'var(--radius-sm)',
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
        style={{ width: '100%', maxWidth: 260, display: 'block', margin: '0 auto', touchAction: 'manipulation' }}
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
      <div style={{ marginTop: 10, fontSize: 'var(--fs-2)', color: 'var(--text-2)', lineHeight: 1.5 }}>
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
