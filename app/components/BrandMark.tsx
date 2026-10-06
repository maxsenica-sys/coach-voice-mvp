import { LAUREL_LEAVES, LAUREL_STEMS, LAUREL_STEM_WIDTH, LAUREL_VIEWBOX } from '@/lib/brand-mark'

/**
 * The Pindar laurel, drawn from lib/brand-mark.ts. Colour comes from
 * `currentColor` unless `color` is given, so it takes the text colour of
 * whatever it sits in, the same way the stroke icons do.
 */
export default function BrandMark({ size = 24, color = 'currentColor', style }: {
  size?: number
  color?: string
  style?: React.CSSProperties
}) {
  return (
    <svg viewBox={LAUREL_VIEWBOX} width={size} height={size} aria-hidden="true"
      style={{ display: 'block', flexShrink: 0, ...style }}>
      {LAUREL_STEMS.map((d) => (
        <path key={d} d={d} fill="none" stroke={color} strokeWidth={LAUREL_STEM_WIDTH} strokeLinecap="round" />
      ))}
      {LAUREL_LEAVES.map(([x, y, rx, ry, deg]) => (
        <ellipse key={`${x},${y}`} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${deg} ${x} ${y})`} fill={color} />
      ))}
    </svg>
  )
}
