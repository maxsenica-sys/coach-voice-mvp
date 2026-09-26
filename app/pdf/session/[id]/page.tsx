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
  /** Arrives with `select('*')`. A list of short strings; checked before use. */
  focus_points?: unknown
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

/* ── Print, not screen ────────────────────────────────────────────────────
 *
 * The app is Stadium Night: an ink ground and cream text, set at the token
 * layer in globals.css. A printed sheet must not inherit any of it. An ink
 * ground on A4 is a page of toner and reads as a printing fault, and cream
 * text on white paper is invisible. So this document scopes its own paper
 * palette under `.pdf` and never reads --bg, --text or --card.
 *
 * The ink survives as a 140px nameplate at the head of page 1 only. Later
 * sheets carry a slim running head (the @page margin boxes below), and every
 * sheet carries the footer with PAGE N OF M, drawn by the print engine so the
 * numbers are the engine's own and cannot disagree with the paper.
 *
 * Floodlight is absent on purpose: #CBEF5E is 1.35:1 on white, and a printed
 * sheet has no live, unread or "now" state for it to mark.
 */

/** A CSS string literal. Names are data, and these ones go inside `content:`. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]+/g, ' ').replace(/</g, '\\3c ')}"`
}

/**
 * The summary as its separate points, when it is written as bullets.
 *
 * The summariser writes "• point" lines. A coach can edit that into prose, so
 * the list form is used only when every non-empty line is a bullet; anything
 * else prints as written. No line is dropped either way.
 */
function summaryPoints(summary: string): string[] | null {
  const lines = summary.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0 || !lines.every((l) => /^[•\-*]\s*/.test(l))) return null
  return lines.map((l) => l.replace(/^[•\-*]\s*/, ''))
}

/** The mic mark, as the nameplate and the running-head chip both draw it. */
const MIC_PATH = (
  <>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" />
    <path d="M12 18.5V21" />
  </>
)

/** The running-head chip: the nameplate shrunk to a stamp. */
const CHIP_URL = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<rect width='24' height='24' rx='7' fill='#1F2421'/>" +
  "<g transform='translate(5 5) scale(0.5833)' fill='none' stroke='#A8CBA0' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'>" +
  "<rect x='9' y='2' width='6' height='11' rx='3'/><path d='M5 10.5v.5a7 7 0 0 0 14 0v-.5'/><path d='M12 18.5V21'/></g></svg>",
)}")`

const BASE_CSS = `
.pdf {
  /* The paper ramp: the app's ink ramp, reflected. Measured on white. */
  --p-paper:  #FFFFFF;
  --p-wash:   #F4F2EA;
  --p-ink:    #1F2421;               /* 14.70:1 */
  --p-ink-2:  #4A544C;               /*  7.90:1 */
  --p-sage:   #3A5237;               /*  8.60:1 — furniture */
  --p-ember:  #8A4A2C;               /*  6.78:1 — the coach's mark */
  --p-rule:   rgba(31,36,33,0.16);
  --p-rule-2: rgba(31,36,33,0.30);
  --p-tick:   rgba(58,82,55,0.42);
  /* The nameplate: the app's own ink, fixed here so it prints the same
     whatever the screen theme is doing. */
  --n-ink:    #1F2421;
  --n-cream:  #F5ECD7;               /* 13.56:1 on the plate */
  --n-cream-2: rgba(245,236,215,0.72);
  --n-sage:   #A8CBA0;               /*  8.79:1 on the plate */
  --gut: clamp(20px, 7vw, 56px);
  background: var(--p-paper);
  color: var(--p-ink);
  font-family: var(--font-sans);
  min-height: 100vh;
}
:root { color-scheme: light; }
html, body { background: #FFFFFF !important; color: #1F2421; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { box-shadow: none !important; }

.pdf .sheet { max-width: 794px; margin: 0 auto; background: var(--p-paper); }
.pdf .toolbar { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px var(--gut); max-width: 794px; margin: 0 auto; }
.pdf .tb-btn {
  min-height: 44px; padding: 0 20px; border-radius: 10px; cursor: pointer;
  font-family: var(--font-sans); font-size: 15px; font-weight: 700;
}
.pdf .tb-print { background: var(--p-ink); color: #FFFFFF; border: 1px solid var(--p-ink); }
.pdf .tb-close { background: var(--p-paper); color: var(--p-ink); border: 1px solid var(--p-rule-2); }
.pdf .tb-btn:focus-visible { outline: 2px solid var(--p-sage); outline-offset: 2px; }
.pdf .state {
  display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 0 var(--gut);
  font-family: var(--font-display); font-size: 17px; color: var(--p-ink-2); text-align: center;
}

/* ═══ The nameplate — the only ink on the document ═══ */
.pdf .plate {
  position: relative; min-height: 140px; padding-bottom: 40px; overflow: hidden;
  color: var(--n-cream);
  /* The skewed beam and its sage hairline, drawn as fixed-size backgrounds so
     nothing inside the plate is wider than the plate. */
  background:
    linear-gradient(106deg, transparent 472px, rgba(168,203,160,0.34) 472px, rgba(168,203,160,0.34) 473.5px, transparent 473.5px) 0 0 / 794px 140px no-repeat,
    linear-gradient(100deg, rgba(245,236,215,0.085), rgba(245,236,215,0) 62%) 0 0 / 520px 100% no-repeat,
    var(--n-ink);
  /* The diagonal clip. Content sits above 82% of the height at any width. */
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 82%);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.pdf .plate .gridlines {
  position: absolute; inset: 0;
  background-image: repeating-linear-gradient(to right, rgba(245,236,215,0.055) 0 1px, transparent 1px 39px);
  -webkit-mask-image: linear-gradient(196deg, #000 0%, rgba(0,0,0,0.2) 70%);
  mask-image: linear-gradient(196deg, #000 0%, rgba(0,0,0,0.2) 70%);
}
.pdf .plate .inner {
  position: relative; z-index: 2; display: flex; flex-wrap: wrap; align-items: flex-start;
  gap: 10px 13px; padding: 29px var(--gut) 0;
}
.pdf .mark {
  width: 34px; height: 34px; border-radius: 11px; flex: none;
  border: 1.5px solid var(--n-sage); color: var(--n-sage); background: rgba(168,203,160,0.12);
  display: flex; align-items: center; justify-content: center;
}
.pdf .wordmark { font-family: var(--font-cast); font-weight: 800; font-size: 22px; letter-spacing: .22em; line-height: 1; color: var(--n-cream); }
.pdf .rolecap { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em; line-height: 1; color: var(--n-sage); margin-top: 5px; }
.pdf .plate .sp { flex: 1 1 0; min-width: 0; }
.pdf .plate .stamp { text-align: right; padding-top: 3px; }
.pdf .plate .stamp .k { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .24em; color: var(--n-cream-2); }
.pdf .plate .stamp .v { font-family: var(--font-mono); font-weight: 500; font-size: 14px; letter-spacing: .04em; color: var(--n-cream); margin-top: 5px; }
/* The 39px pitch marking, quoted as one row of ticks under the plate. */
.pdf .ticks { height: 9px; margin: 0 var(--gut); background-image: linear-gradient(to right, var(--p-tick) 0 1px, transparent 1px); background-size: 39px 9px; background-repeat: repeat-x; }

.pdf .doc { padding: 0 var(--gut) 40px; }

/* ═══ Blocks. Spaced with padding only: margins collapse between siblings
   and are truncated at a page break, which is where print and screen part. ═══ */
.pdf .titleblock { padding: 19px 0 14px; border-bottom: 2px solid var(--p-ink); }
.pdf .eyebrow { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em; color: var(--p-sage); text-transform: uppercase; overflow-wrap: anywhere; }
.pdf h1 {
  font-family: var(--font-cast); font-weight: 800; font-size: 42px; letter-spacing: .015em; line-height: .98;
  color: var(--p-ink); margin: 10px 0 0; text-transform: uppercase; overflow-wrap: anywhere;
}
.pdf .deck { font-family: var(--font-display); font-style: italic; font-weight: 400; font-size: 18px; line-height: 1.32; color: var(--p-ink); margin: 9px 0 0; }

.pdf .meta {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  border-bottom: 1px solid var(--p-rule); break-inside: avoid; page-break-inside: avoid;
}
.pdf .meta > div { padding: 12px 14px 13px; border-left: 1px solid var(--p-rule); min-width: 0; }
.pdf .meta > div:first-child { border-left: 0; padding-left: 0; }
.pdf .meta .k { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .2em; color: var(--p-sage); }
.pdf .meta .v { font-family: var(--font-cast); font-weight: 700; font-size: 20px; letter-spacing: .035em; line-height: 1.05; color: var(--p-ink); margin-top: 7px; text-transform: uppercase; overflow-wrap: anywhere; }
.pdf .meta .s { font-family: var(--font-mono); font-weight: 400; font-size: 13px; letter-spacing: .02em; color: var(--p-ink-2); margin-top: 6px; overflow-wrap: anywhere; }

/* A section is a real table so its head is a <thead>: when the section runs
   onto another sheet, the print engine repeats the head there itself. Only a
   real <thead> does this in Chromium — a div with display: table-header-group
   was measured and does not repeat. */
.pdf .section { width: 100%; table-layout: fixed; border-collapse: collapse; border-spacing: 0; }
.pdf .section > thead > tr > th { padding: 0; text-align: left; font-weight: inherit; }
.pdf .section > tbody > tr > td { padding: 0; vertical-align: top; }
.pdf .sechead .in { display: flex; align-items: baseline; gap: 10px; padding: 22px 0 7px; border-bottom: 1px solid var(--p-rule-2); }
.pdf .sechead h2 { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em; color: var(--p-sage); margin: 0; }
.pdf .sechead .of { margin-left: auto; font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .05em; color: var(--p-ink-2); white-space: nowrap; }

.pdf .pt { display: grid; grid-template-columns: 26px minmax(0, 1fr); align-items: start; padding-top: 10px; break-inside: avoid; page-break-inside: avoid; }
.pdf .pt .n { font-family: var(--font-mono); font-weight: 500; font-size: 14px; color: var(--p-sage); padding-top: 3px; }
.pdf .pt p, .pdf .prose { font-family: var(--font-display); font-weight: 400; font-size: 16px; line-height: 1.44; color: var(--p-ink); margin: 0; overflow-wrap: anywhere; }
.pdf .prose { white-space: pre-wrap; padding-top: 10px; }

.pdf .takewrap { padding-top: 16px; break-inside: avoid; page-break-inside: avoid; }
.pdf .take { padding: 13px 20px 14px; background: var(--p-wash); border-left: 4px solid var(--p-ember); }
.pdf .take .k { font-family: var(--font-cast); font-weight: 800; font-size: 13px; letter-spacing: .22em; color: var(--p-ember); }
.pdf .take .v { font-family: var(--font-display); font-weight: 500; font-size: 21px; line-height: 1.28; color: var(--p-ink); margin: 7px 0 0; overflow-wrap: anywhere; }

/* Transcript paragraphs are NOT atomic. A Whisper transcript is often one
   paragraph of a thousand words; held whole, it would leave page 1 blank
   under the summary. Orphans and widows keep the break tidy instead. */
.pdf .tp { padding-top: 10px; font-family: var(--font-display); font-weight: 400; font-size: 15px; line-height: 1.54; color: var(--p-ink-2); margin: 0; orphans: 3; widows: 3; overflow-wrap: anywhere; }

.pdf .endmark { padding-top: 26px; display: flex; align-items: center; gap: 14px; break-before: avoid; page-break-before: avoid; }
.pdf .endmark i { flex: 1; height: 1px; background: var(--p-rule-2); }
.pdf .endmark span { font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .05em; color: var(--p-ink-2); text-align: center; }

/* On screen the footer is part of the page; in print the engine draws it. */
.pdf .screen-foot {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px;
  margin-top: 36px; padding-top: 12px; border-top: 1px solid var(--p-rule);
  font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .04em; color: var(--p-ink-2);
}
.pdf .screen-foot b { font-weight: 500; color: var(--p-ink); letter-spacing: .07em; }

@media print {
  html, body { overflow: visible !important; max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .pdf { --gut: 56px; min-height: 0; }
  .no-print { display: none !important; }
  .pdf .doc { padding-bottom: 0; }
}
`

/* The page box. Zero side margins so the nameplate can bleed; the content's
   56px sides are the gutter above. Running head and footer live in the
   margin boxes, so they appear on every sheet and number themselves. */
function pageCss(runRight: string, footLeft: string, footRight: string): string {
  const box = `font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .04em; color: #4A544C;`
  const ticks = `background-image: linear-gradient(to right, rgba(58,82,55,0.42) 0 1px, transparent 1px); background-size: 39px 9px; background-repeat: repeat-x; background-position: 0 calc(100% - 12px);`
  return `
@page {
  size: A4;
  margin: 105px 0 89px;
  @top-left {
    content: ${CHIP_URL} "  COACHVOICE  ·  SESSION REPORT";
    font-family: var(--font-cast); font-weight: 800; font-size: 15px; letter-spacing: .2em; color: #1F2421;
    vertical-align: bottom; margin-left: 56px; width: 351px; padding-bottom: 32px; ${ticks}
  }
  @top-right {
    content: ${cssString(runRight)};
    ${box} text-align: right; vertical-align: bottom; margin-right: 56px; width: 331px; padding-bottom: 34px; ${ticks}
  }
  @bottom-left {
    content: ${cssString(footLeft)};
    ${box} vertical-align: top; margin-left: 56px; width: 320px; padding-top: 12px; border-top: 1px solid rgba(31,36,33,0.16);
  }
  @bottom-right {
    content: ${cssString(footRight)} " · PAGE " counter(page) " OF " counter(pages);
    ${box} text-align: right; vertical-align: top; margin-right: 56px; width: 362px; padding-top: 12px; border-top: 1px solid rgba(31,36,33,0.16);
  }
}
/* Page 1 opens on the nameplate, flush to the top edge, with no running head. */
@page :first {
  margin-top: 0;
  @top-left { content: none; background: none; }
  @top-right { content: none; background: none; }
}
`
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

      /* The coach's own sessions only. This report prints the full
       * transcript, and the RLS policy an athlete reads through used to hand
       * them the whole row — so an athlete who opened this URL for a squad
       * recording, or one recording about several athletes, got a printable
       * transcript of the coach talking about other children. The athlete's
       * copy of a session is the session page, whose detail route decides the
       * transcript per viewer. Pinned here as well as in migration 033 so the
       * page is correct whichever of the two is live. */
      const { data: s, error: sErr } = await supabase
        .from('sessions')
        .select('*, athletes(first_name, last_name, email)')
        .eq('id', id)
        .eq('coach_id', user.id)
        .maybeSingle()

      if (sErr) { setError(`Could not load this session: ${sErr.message}`); setLoading(false); return }
      if (!s) { setError('Session not found. Only the coach who recorded a session can print its report.'); setLoading(false); return }
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

  if (loading || error || !session) return (
    <div className="pdf">
      <style>{BASE_CSS}</style>
      <div className="state">{loading ? 'Preparing report…' : (error || 'Session not found')}</div>
    </div>
  )

  const athleteName = session.athletes
    ? `${session.athletes.first_name} ${session.athletes.last_name}`
    : 'Athlete'
  const coachName = (coach
    ? [coach.first_name, coach.last_name].filter(Boolean).join(' ')
    : '') || 'Coach'
  const sessionDate = formatSessionDate(session, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const sessionDateShort = formatSessionDate(session, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).toUpperCase()
  const generated = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()

  const points = session.summary ? summaryPoints(session.summary) : null
  const focus = Array.isArray(session.focus_points)
    ? session.focus_points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : []
  const paragraphs = session.transcript
    ? session.transcript.split(/\n+/).map((p) => p.trim()).filter(Boolean)
    : []

  const css = BASE_CSS + pageCss(
    `${athleteName} · ${sessionDateShort}`.toUpperCase(),
    `COACHVOICE · GENERATED ${generated}`,
    `CONFIDENTIAL — ${athleteName.toUpperCase()}`,
  )

  return (
    <div className="pdf">
      <style>{css}</style>

      {/* Print button — hidden in print */}
      <div className="toolbar no-print">
        <button type="button" className="tb-btn tb-print" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <button type="button" className="tb-btn tb-close" onClick={() => window.close()}>
          Close
        </button>
      </div>

      <div className="sheet">
        {/* Nameplate */}
        <div className="plate">
          <div className="gridlines" />
          <div className="inner">
            <div className="mark" aria-hidden>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{MIC_PATH}</svg>
            </div>
            <div>
              <div className="wordmark">COACHVOICE</div>
              <div className="rolecap">SESSION REPORT</div>
            </div>
            <div className="sp" />
            <div className="stamp">
              <div className="k">SESSION</div>
              <div className="v">{sessionDateShort}</div>
            </div>
          </div>
        </div>
        <div className="ticks" />

        <div className="doc">
          {/* Header */}
          <div className="titleblock">
            <div className="eyebrow">{athleteName}</div>
            <h1>{session.session_name ?? 'Session Report'}</h1>
            <p className="deck">{sessionDate}</p>
          </div>

          {/* Meta */}
          <div className="meta">
            <div>
              <div className="k">ATHLETE</div>
              <div className="v">{athleteName}</div>
              {session.athletes?.email && <div className="s">{session.athletes.email}</div>}
            </div>
            <div>
              <div className="k">COACH</div>
              <div className="v">{coachName}</div>
              {coach?.sport && <div className="s">{coach.sport}</div>}
            </div>
            {session.sport_context && (
              <div>
                <div className="k">SPORT / CONTEXT</div>
                <div className="v">{session.sport_context}</div>
              </div>
            )}
            <div>
              <div className="k">SHARED</div>
              <div className="v">{session.shared_with_athlete ? `Yes — with ${session.athletes?.first_name || 'the athlete'}` : 'No'}</div>
            </div>
          </div>

          {/* Summary */}
          {session.summary && (
            <table className="section" role="presentation">
              <thead className="sechead">
                <tr><th>
                  <div className="in">
                    <h2>AI SESSION SUMMARY</h2>
                    {points && <span className="of">{points.length} {points.length === 1 ? 'POINT' : 'POINTS'}</span>}
                  </div>
                </th></tr>
              </thead>
              <tbody>
                <tr><td>
                  {points
                    ? points.map((p, i) => (
                        <div key={i} className="pt">
                          <span className="n">{String(i + 1).padStart(2, '0')}</span>
                          <p>{p}</p>
                        </div>
                      ))
                    : <p className="prose">{session.summary}</p>}
                </td></tr>
              </tbody>
            </table>
          )}

          {/* The focus point — the coach's own forward-looking line */}
          {focus.length > 0 && (
            <div className="takewrap">
              <div className="take">
                <div className="k">TAKE INTO NEXT SESSION</div>
                {focus.map((f, i) => <p key={i} className="v">{f}</p>)}
              </div>
            </div>
          )}

          {/* Transcript */}
          {paragraphs.length > 0 && (
            <table className="section" role="presentation">
              <thead className="sechead">
                <tr><th><div className="in"><h2>FULL TRANSCRIPT</h2></div></th></tr>
              </thead>
              <tbody>
                <tr><td>
                  {paragraphs.map((p, i) => <p key={i} className="tp">{p}</p>)}
                </td></tr>
              </tbody>
            </table>
          )}

          <div className="endmark"><i /><span>END OF REPORT</span><i /></div>

          {/* Footer — on screen only; in print the page's margin boxes carry it */}
          <div className="screen-foot no-print">
            <span>COACHVOICE · GENERATED {generated}</span>
            <span><b>CONFIDENTIAL</b> — {athleteName.toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
