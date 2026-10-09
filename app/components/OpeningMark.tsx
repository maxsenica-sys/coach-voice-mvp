import { LAUREL_LEAVES, LAUREL_STEMS, LAUREL_STEM_WIDTH } from '@/lib/brand-mark'
import { BAR_COUNT, BAR_H, BAR_W, BAR_Y, SLOGAN, barX } from '@/lib/opening'

/**
 * The opening's picture: the voice bars, the wreath they become, the name and
 * the line. Markup only — no hooks, no state — so the boot shell in
 * app/layout.tsx (a server component) and the sign-in intro render the very
 * same elements, and lib/opening.ts animates both with the same CSS. The
 * launch images draw the same thing from openingSvgMarkup() in that file.
 *
 * Every element's plain style is its resting frame; the motion is CSS that
 * only runs when allowed. See lib/opening.ts.
 */
export default function OpeningMark({ color = '#F5ECD7', barColor = '#A8CBA0' }: { color?: string; barColor?: string }) {
  return (
    <>
      <svg className="op-wreath" viewBox="0 0 48 48" aria-hidden="true">
        {LAUREL_STEMS.map((d) => (
          <path key={d} className="op-stem" d={d} pathLength={1} fill="none" stroke={color} strokeWidth={LAUREL_STEM_WIDTH} strokeLinecap="round" />
        ))}
        {LAUREL_LEAVES.map(([x, y, rx, ry, deg], i) => (
          <g key={i} className={`op-leaf l${i}`}>
            <ellipse cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${deg} ${x} ${y})`} fill={color} />
          </g>
        ))}
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <rect key={i} className={`op-bar b${i}`} x={+(barX(i) - BAR_W / 2).toFixed(2)} y={BAR_Y - BAR_H / 2}
            width={BAR_W} height={BAR_H} rx={BAR_W / 2} fill={barColor} />
        ))}
      </svg>
      <div className="op-word">Pindar</div>
      <div className="op-slogan">{SLOGAN}</div>
    </>
  )
}
