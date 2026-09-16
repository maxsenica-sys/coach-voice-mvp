/* A single session.
 *
 * The page itself is the reference implementation in this app — one /detail
 * request, a real skeleton, optimistic response chips with rollback. This file
 * only covers the gap before that page's own code is running, which is exactly
 * what a route-level boundary is for.
 */
export default function SessionLoading() {
  return (
    <div aria-busy="true" aria-label="Loading session" style={{ padding: '20px 16px', maxWidth: 720, margin: '0 auto' }}>
      <div className="cv-skeleton" style={{ height: 24, width: '60%', borderRadius: 8 }} />
      <div className="cv-skeleton" style={{ height: 13, width: '32%', borderRadius: 6, marginTop: 9 }} />
      <div className="cv-skeleton" style={{ height: 150, borderRadius: 16, marginTop: 22 }} />
      <div className="cv-skeleton" style={{ height: 13, width: '90%', borderRadius: 6, marginTop: 20 }} />
      <div className="cv-skeleton" style={{ height: 13, width: '84%', borderRadius: 6, marginTop: 10 }} />
      <div className="cv-skeleton" style={{ height: 13, width: '71%', borderRadius: 6, marginTop: 10 }} />
    </div>
  )
}
