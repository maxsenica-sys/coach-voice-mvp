'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { formatSessionDate } from '@/lib/session-date'

interface SessionData {
  id: string
  session_name: string | null
  summary: string | null
  transcript: string | null
  session_date?: string | null
  shared_with_athlete: boolean
  created_at: string
  sport_context: string | null
  athletes?: {
    first_name: string
    last_name: string
    email: string
  } | null
}

interface CoachProfile {
  first_name: string | null
  last_name: string | null
  sport: string | null
}

export default function SessionPDFPage() {
  const params = useParams()
  const id = params?.id as string
  const supabase = createSupabaseBrowserClient()

  const [session, setSession] = useState<SessionData | null>(null)
  const [coach, setCoach] = useState<CoachProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not authenticated'); setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, sport')
        .eq('id', user.id)
        .single()
      setCoach(profile)

      const { data: s, error: sErr } = await supabase
        .from('sessions')
        .select('*, athletes(first_name, last_name, email)')
        .eq('id', id)
        .single()

      if (sErr || !s) { setError('Session not found'); setLoading(false); return }
      setSession(s)
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!loading && session) {
      // Small delay to ensure styles are applied
      setTimeout(() => window.print(), 400)
    }
  }, [loading, session])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: '#666' }}>
      Preparing report…
    </div>
  )

  if (error || !session) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Georgia, serif', color: '#666' }}>
      {error || 'Session not found'}
    </div>
  )

  const athleteName = session.athletes
    ? `${session.athletes.first_name} ${session.athletes.last_name}`
    : 'Athlete'
  const coachName = coach
    ? [coach.first_name, coach.last_name].filter(Boolean).join(' ')
    : 'Coach'
  const sessionDate = formatSessionDate(session, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          @page { margin: 20mm; }
        }
        body {
          font-family: 'Georgia', 'Times New Roman', serif;
          color: #1a1a2e;
          background: #fff;
          margin: 0;
        }
        .page { max-width: 720px; margin: 0 auto; padding: 40px 32px; }
        .header { border-bottom: 3px solid #7c3aed; padding-bottom: 24px; margin-bottom: 28px; }
        .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #7c3aed; margin-bottom: 14px; }
        .title { font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 0 0 6px; }
        .subtitle { font-size: 14px; color: #64748b; margin: 0; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
        .meta-card { background: #f8fafc; border-radius: 10px; padding: 14px 16px; border: 1px solid #e2e8f0; }
        .meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; margin-bottom: 4px; }
        .meta-value { font-size: 15px; font-weight: 600; color: #1a1a2e; }
        .section { margin-bottom: 28px; }
        .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #7c3aed; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 14px; }
        .summary-box { background: #f5f3ff; border-left: 4px solid #7c3aed; border-radius: 4px; padding: 16px 18px; font-size: 15px; line-height: 1.75; color: #1a1a2e; white-space: pre-wrap; }
        .transcript-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; font-size: 13px; line-height: 1.8; color: #475569; white-space: pre-wrap; font-family: 'Georgia', serif; }
        .footer { border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
      `}</style>

      <div className="page">
        {/* Print button — hidden in print */}
        <div className="no-print" style={{ marginBottom: 20, display: 'flex', gap: 10 }}>
          <button
            onClick={() => window.print()}
            style={{
              background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Print / Save PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{
              background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* Header */}
        <div className="header">
          <div className="brand">CoachVoice · Session Report</div>
          <h1 className="title">{session.session_name ?? 'Session Report'}</h1>
          <p className="subtitle">{sessionDate}</p>
        </div>

        {/* Meta */}
        <div className="meta-grid">
          <div className="meta-card">
            <div className="meta-label">Athlete</div>
            <div className="meta-value">{athleteName}</div>
            {session.athletes?.email && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{session.athletes.email}</div>
            )}
          </div>
          <div className="meta-card">
            <div className="meta-label">Coach</div>
            <div className="meta-value">{coachName}</div>
            {coach?.sport && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{coach.sport}</div>
            )}
          </div>
          {session.sport_context && (
            <div className="meta-card">
              <div className="meta-label">Sport / Context</div>
              <div className="meta-value">{session.sport_context}</div>
            </div>
          )}
          <div className="meta-card">
            <div className="meta-label">Shared with Athlete</div>
            <div className="meta-value" style={{ color: session.shared_with_athlete ? '#16a34a' : '#94a3b8' }}>
              {session.shared_with_athlete ? 'Yes' : 'No'}
            </div>
          </div>
        </div>

        {/* Summary */}
        {session.summary && (
          <div className="section">
            <div className="section-title">AI Session Summary</div>
            <div className="summary-box">{session.summary}</div>
          </div>
        )}

        {/* Transcript */}
        {session.transcript && (
          <div className="section">
            <div className="section-title">Full Transcript</div>
            <div className="transcript-box">{session.transcript}</div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          <span>Generated by CoachVoice · {new Date().toLocaleDateString()}</span>
          <span>Confidential — {athleteName}</span>
        </div>
      </div>
    </>
  )
}
