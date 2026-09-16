/* One athlete's profile.
 *
 * This route has the worst cold navigation in the app: four serial round trips
 * behind a blank screen (getUser -> profiles -> /api/athletes/[id] ->
 * /api/sessions). The waterfall is being shortened separately; until every hop
 * is gone, the screen should at least show its own shape while it waits.
 */
export default function AthleteProfileLoading() {
  return (
    <div aria-busy="true" aria-label="Loading athlete" style={{ padding: '20px 16px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div className="cv-skeleton" style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="cv-skeleton" style={{ height: 22, width: '45%', borderRadius: 7 }} />
          <div className="cv-skeleton" style={{ height: 13, width: '28%', borderRadius: 6, marginTop: 8 }} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="cv-skeleton" style={{ height: 84, borderRadius: 14 }} />
        ))}
      </div>
    </div>
  )
}
