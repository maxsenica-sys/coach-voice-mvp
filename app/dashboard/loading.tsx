/* The coach's home, drawn empty, while the real one arrives.
 *
 * Two things this buys, and the second is the one that gets missed.
 *
 * Visibly: a navigation into /dashboard used to swap to a blank document and
 * hold it until the data landed. There was no loading.tsx anywhere in the app,
 * so every route transition was a hard cut to nothing.
 *
 * Invisibly, and worth more: App Router `<Link>` prefetch on a dynamic route
 * only fetches as far as the nearest loading boundary. With no boundary in the
 * tree, all nineteen prefetches in this app resolved to almost nothing. Adding
 * the file switches prefetch on as a side effect.
 *
 * The shapes below deliberately match the real layout's geometry — the greeting
 * block, the day strip, the cards — so the transition is a fill rather than a
 * reflow. A skeleton whose boxes land somewhere else is worse than none.
 */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading your dashboard" style={{ padding: '20px 16px', maxWidth: 1100, margin: '0 auto' }}>
      <div className="cv-skeleton" style={{ height: 30, width: '48%', borderRadius: 8 }} />
      <div className="cv-skeleton" style={{ height: 15, width: '30%', borderRadius: 6, marginTop: 10 }} />

      {/* day strip */}
      <div style={{ display: 'flex', gap: 8, marginTop: 22, overflow: 'hidden' }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="cv-skeleton" style={{ flex: '0 0 62px', height: 78, borderRadius: 12 }} />
        ))}
      </div>

      {/* cards */}
      <div style={{ display: 'grid', gap: 12, marginTop: 22 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="cv-skeleton" style={{ height: 88, borderRadius: 14 }} />
        ))}
      </div>
    </div>
  )
}
