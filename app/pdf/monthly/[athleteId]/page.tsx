'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { formatSessionDate } from '@/lib/session-date'

interface Session {
  id: string
  session_name: string | null
  summary: string | null
  session_date?: string | null
  created_at: string
}

interface Checkin {
  check_date: string
  energy: number | null
  mood: number | null
  sleep_q: number | null
  soreness: number | null
  stress: number | null
  notes: string | null
}

interface Athlete {
  first_name: string
  last_name: string
  email: string
}

interface CoachProfile {
  first_name: string | null
  last_name: string | null
  sport: string | null
}

function avg(vals: (number | null)[]): string {
  const nums = vals.filter((v): v is number => v !== null)
  if (nums.length === 0) return '—'
  return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)
}

function wellnessScore(c: Checkin): number | null {
  const metrics = [
    c.energy,
    c.mood,
    c.sleep_q,
    c.soreness !== null ? 6 - c.soreness : null,
    c.stress !== null ? 6 - c.stress : null,
  ].filter((v): v is number => v !== null)
  if (metrics.length === 0) return null
  return +(metrics.reduce((a, b) => a + b, 0) / metrics.length).toFixed(1)
}

export default function MonthlyReportPage() {
  const params = useParams()
  const athleteId = params?.athleteId as string
  const supabase = createSupabaseBrowserClient()

  const [athlete, setAthlete] = useState<Athlete | null>(null)
  const [coach, setCoach] = useState<CoachProfile | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(true)
  const [reportMonth, setReportMonth] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: profile } = await supabase.from('profiles').select('first_name, last_name, sport').eq('id', user.id).single()
      setCoach(profile)

      const { data: ath } = await supabase.from('athletes').select('first_name, last_name, email').eq('id', athleteId).single()
      setAthlete(ath)

      // Last 30 days
      const since = new Date()
      since.setDate(since.getDate() - 30)
      const sinceStr = since.toISOString()
      const sinceDate = new Intl.DateTimeFormat('en-CA').format(since)

      const { data: sess } = await supabase
        .from('sessions')
        .select('id, session_name, summary, session_date, created_at')
        .eq('athlete_id', athleteId)
        // Backdated sessions belong in the window they happened in, so filter
        // on session_date and keep created_at only for rows that predate it.
        .or(`session_date.gte.${sinceDate},and(session_date.is.null,created_at.gte.${sinceStr})`)
        .order('session_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      setSessions(sess ?? [])

      const { data: chk } = await supabase
        .from('wellness_checkins')
        .select('check_date, energy, mood, sleep_q, soreness, stress, notes')
        .eq('athlete_id', athleteId)
        .gte('check_date', since.toISOString().split('T')[0])
        .order('check_date')
      setCheckins(chk ?? [])

      const now = new Date()
      setReportMonth(now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
      setLoading(false)
    }
    load()
  }, [athleteId])

  useEffect(() => {
    if (!loading && athlete) setTimeout(() => window.print(), 400)
  }, [loading, athlete])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: '#666' }}>
      Preparing monthly report…
    </div>
  )

  const athleteName = athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Athlete'
  const coachName = coach ? [coach.first_name, coach.last_name].filter(Boolean).join(' ') : 'Coach'

  const avgWellness = checkins.length > 0
    ? avg(checkins.map(wellnessScore))
    : '—'

  const metrics = [
    { label: 'Energy',   key: 'energy'   as const },
    { label: 'Mood',     key: 'mood'     as const },
    { label: 'Sleep',    key: 'sleep_q'  as const },
    { label: 'Soreness', key: 'soreness' as const, inverted: true },
    { label: 'Stress',   key: 'stress'   as const, inverted: true },
  ]

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          @page { margin: 18mm; }
        }
        body { font-family: 'Georgia', serif; color: #1a1a2e; background: #fff; margin: 0; }
        .page { max-width: 720px; margin: 0 auto; padding: 36px 32px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 28px; }
        .brand { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #2563eb; margin-bottom: 10px; }
        .title { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
        .subtitle { font-size: 13px; color: #64748b; margin: 0; }
        .badge { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; border-radius: 8px; padding: '8px 14px'; font-size: 13px; font-weight: 600; text-align: center; }
        .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
        .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; text-align: center; }
        .stat-num { font-size: 28px; font-weight: 800; color: #2563eb; line-height: 1; }
        .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
        .section { margin-bottom: 28px; }
        .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #2563eb; border-bottom: 1px solid #e2e8f0; padding-bottom: 7px; margin-bottom: 14px; }
        .session-row { padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .session-name { font-size: 14px; font-weight: 600; color: #1a1a2e; }
        .session-date { font-size: 11px; color: #94a3b8; margin-bottom: 4px; }
        .session-summary { font-size: 13px; color: #475569; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #f8fafc; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #e2e8f0; }
        td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; color: #475569; }
        .footer { border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 36px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
      `}</style>

      <div className="page">
        <div className="no-print" style={{ marginBottom: 20, display: 'flex', gap: 10 }}>
          <button
            onClick={() => window.print()}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Print / Save PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Close
          </button>
        </div>

        {/* Header */}
        <div className="header">
          <div>
            <div className="brand">CoachVoice · Monthly Progress Report</div>
            <h1 className="title">{athleteName}</h1>
            <p className="subtitle">{reportMonth} · Prepared by {coachName}{coach?.sport ? ` · ${coach.sport}` : ''}</p>
          </div>
        </div>

        {/* Summary stats */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-num">{sessions.length}</div>
            <div className="stat-label">Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-num">{checkins.length}</div>
            <div className="stat-label">Check-ins</div>
          </div>
          <div className="stat-card">
            <div className="stat-num" style={{ fontSize: 22 }}>{avgWellness}</div>
            <div className="stat-label">Avg Wellness</div>
          </div>
          <div className="stat-card">
            <div className="stat-num" style={{ fontSize: 18, color: '#16a34a' }}>
              {checkins.length > 0 ? Math.round((checkins.length / 30) * 100) + '%' : '—'}
            </div>
            <div className="stat-label">Check-in Rate</div>
          </div>
        </div>

        {/* Session summaries */}
        {sessions.length > 0 && (
          <div className="section">
            <div className="section-title">Sessions This Month</div>
            {sessions.map((s) => (
              <div key={s.id} className="session-row">
                <div className="session-date">
                  {formatSessionDate(s, { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="session-name">{s.session_name ?? 'Session'}</div>
                {s.summary && <div className="session-summary">{s.summary}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Wellness summary table */}
        {checkins.length > 0 && (
          <div className="section">
            <div className="section-title">Wellness Overview</div>
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Average</th>
                  <th>Best</th>
                  <th>Lowest</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map(({ label, key, inverted }) => {
                  const rawVals = checkins.map((c) => c[key]).filter((v): v is number => v !== null)
                  const normVals = inverted ? rawVals.map((v) => 6 - v) : rawVals
                  return (
                    <tr key={key}>
                      <td style={{ fontWeight: 600 }}>{label}</td>
                      <td>{avg(normVals)}</td>
                      <td>{normVals.length ? Math.max(...normVals) : '—'}</td>
                      <td>{normVals.length ? Math.min(...normVals) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Notes from athlete */}
        {checkins.some((c) => c.notes) && (
          <div className="section">
            <div className="section-title">Athlete Notes</div>
            {checkins.filter((c) => c.notes).map((c, i) => (
              <div key={i} style={{ fontSize: 13, color: '#475569', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginRight: 8 }}>
                  {new Date(c.check_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {c.notes}
              </div>
            ))}
          </div>
        )}

        <div className="footer">
          <span>CoachVoice · {new Date().toLocaleDateString()} · Monthly Report</span>
          <span>{athleteName} — Confidential</span>
        </div>
      </div>
    </>
  )
}
