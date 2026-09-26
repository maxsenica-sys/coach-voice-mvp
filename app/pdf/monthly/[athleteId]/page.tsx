'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import { formatSessionDate, parseISODate, todayISODate } from '@/lib/session-date'
import { WELLNESS_METRICS } from '@/lib/wellness-config'
import { errorMessage } from '@/lib/errors'

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

/**
 * One check-in's overall score, 1–5, five is good.
 *
 * Normalised through WELLNESS_METRICS rather than by hand. This file used to
 * compute `6 - soreness` and `6 - stress` itself — the flip lib/wellness-config
 * deleted on 2026-09-09, because both columns are already stored 5-is-good
 * ("1 = very sore, 5 = no soreness"). The printed report, the one a parent
 * keeps, was the last place still reading them upside down.
 */
function normalised(c: Checkin, key: (typeof WELLNESS_METRICS)[number]['key']): number | null {
  const raw = c[key]
  if (raw === null) return null
  const cfg = WELLNESS_METRICS.find((m) => m.key === key)
  return cfg?.inverted ? 6 - raw : raw
}

function wellnessScore(c: Checkin): number | null {
  const metrics = WELLNESS_METRICS.map(({ key }) => normalised(c, key)).filter((v): v is number => v !== null)
  if (metrics.length === 0) return null
  return +(metrics.reduce((a, b) => a + b, 0) / metrics.length).toFixed(1)
}

/** `YYYY-MM-DD` for a local calendar day. */
function isoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(d)
}

/** A `YYYY-MM-DD` day as "26 AUG", read as a local date, never as UTC midnight. */
function shortDay(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  const d = parseISODate(iso)
  return d ? d.toLocaleDateString(undefined, opts).toUpperCase() : iso
}

/** A CSS string literal. Names are data, and these ones go inside `content:`. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r\f]+/g, ' ').replace(/</g, '\\3c ')}"`
}

/** The summary as its bullets when it is written as bullets; otherwise null and it prints as written. */
function summaryPoints(summary: string): string[] | null {
  const lines = summary.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0 || !lines.every((l) => /^[•\-*]\s*/.test(l))) return null
  return lines.map((l) => l.replace(/^[•\-*]\s*/, ''))
}

const CHIP_URL = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<rect width='24' height='24' rx='7' fill='#1F2421'/>" +
  "<g transform='translate(5 5) scale(0.5833)' fill='none' stroke='#A8CBA0' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'>" +
  "<rect x='9' y='2' width='6' height='11' rx='3'/><path d='M5 10.5v.5a7 7 0 0 0 14 0v-.5'/><path d='M12 18.5V21'/></g></svg>",
)}")`

/* ── Print, not screen ────────────────────────────────────────────────────
 *
 * Stadium Night flips the app to an ink ground at the token layer. None of it
 * may reach paper: an ink ground on A4 is a page of toner, and cream text on
 * white is invisible. This document scopes its own paper palette under `.pdf`
 * and reads no screen colour token. The ink survives as the page-1 nameplate
 * only; floodlight is absent (1.35:1 on white, and paper has no "now").
 * Where the app would light the bar that is today, the strip marks it by
 * weight instead — one solid ink bar among sage ones.
 */
const BASE_CSS = `
.pdf {
  --p-paper:  #FFFFFF;
  --p-wash:   #F4F2EA;
  --p-ink:    #1F2421;               /* 14.70:1 */
  --p-ink-2:  #4A544C;               /*  7.90:1 */
  --p-sage:   #3A5237;               /*  8.60:1 — furniture */
  --p-ember:  #8A4A2C;               /*  6.78:1 */
  --p-rule:   rgba(31,36,33,0.16);
  --p-rule-2: rgba(31,36,33,0.30);
  --p-tick:   rgba(58,82,55,0.42);
  --p-bar:    rgba(58,82,55,0.40);
  --n-ink:    #1F2421;
  --n-cream:  #F5ECD7;
  --n-cream-2: rgba(245,236,215,0.72);
  --n-sage:   #A8CBA0;
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
.pdf .tb-btn { min-height: 44px; padding: 0 20px; border-radius: 10px; cursor: pointer; font-family: var(--font-sans); font-size: 15px; font-weight: 700; }
.pdf .tb-print { background: var(--p-ink); color: #FFFFFF; border: 1px solid var(--p-ink); }
.pdf .tb-close { background: var(--p-paper); color: var(--p-ink); border: 1px solid var(--p-rule-2); }
.pdf .tb-btn:focus-visible { outline: 2px solid var(--p-sage); outline-offset: 2px; }
.pdf .state {
  display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 0 var(--gut);
  font-family: var(--font-display); font-size: 17px; color: var(--p-ink-2); text-align: center;
}

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
.pdf .plate .inner { position: relative; z-index: 2; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px 13px; padding: 29px var(--gut) 0; }
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
.pdf .ticks { height: 9px; margin: 0 var(--gut); background-image: linear-gradient(to right, var(--p-tick) 0 1px, transparent 1px); background-size: 39px 9px; background-repeat: repeat-x; }

.pdf .doc { padding: 0 var(--gut) 40px; }

.pdf .titleblock { padding: 19px 0 14px; border-bottom: 2px solid var(--p-ink); }
.pdf .eyebrow { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em; color: var(--p-sage); text-transform: uppercase; }
.pdf h1 {
  font-family: var(--font-cast); font-weight: 800; font-size: 42px; letter-spacing: .015em; line-height: .98;
  color: var(--p-ink); margin: 10px 0 0; text-transform: uppercase; overflow-wrap: anywhere;
}
.pdf .byline { font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .05em; color: var(--p-ink-2); margin: 9px 0 0; text-transform: uppercase; overflow-wrap: anywhere; }

/* The one enormous number, and the three beside it. */
.pdf .hero { display: flex; flex-wrap: wrap; gap: 16px 24px; padding: 16px 0 14px; border-bottom: 1px solid var(--p-rule); break-inside: avoid; page-break-inside: avoid; }
.pdf .hero .big { flex: 0 0 150px; }
.pdf .huge { font-family: var(--font-display); font-weight: 500; font-size: 84px; line-height: .78; letter-spacing: -5px; color: var(--p-ink); font-variant-numeric: tabular-nums; margin-left: -5px; padding-top: 6px; }
.pdf .huge-cap { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .22em; color: var(--p-sage); margin-top: 12px; }
.pdf .huge-sub { font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .04em; color: var(--p-ink-2); margin-top: 5px; }
.pdf .trio { flex: 1 1 360px; min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; }
.pdf .trio > .cell { padding: 0 14px; border-left: 1px solid var(--p-rule); min-width: 0; }
.pdf .trio > .cell:first-child { padding-left: 0; border-left: 0; }
.pdf .mid { font-family: var(--font-display); font-weight: 500; font-size: 40px; line-height: 1; letter-spacing: -1.6px; color: var(--p-ink); font-variant-numeric: tabular-nums; }
.pdf .mid .of { font-size: 16px; letter-spacing: 0; color: var(--p-ink-2); margin-left: 2px; }
.pdf .lbl { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .2em; color: var(--p-sage); margin-top: 8px; }
.pdf .sub { font-family: var(--font-mono); font-weight: 400; font-size: 13px; color: var(--p-ink-2); margin-top: 5px; }
.pdf .strip { grid-column: 1 / -1; margin-top: 14px; }
.pdf .strip .bars { display: flex; align-items: flex-end; gap: 2px; height: 28px; border-bottom: 1px solid var(--p-rule); }
.pdf .strip .bars i { flex: 1 1 0; min-width: 0; background: var(--p-bar); border-radius: 1px 1px 0 0; }
.pdf .strip .bars i.none { background: none; }
.pdf .strip .bars i.now { background: var(--p-ink); }
.pdf .strip .cap { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .16em; color: var(--p-sage); }
.pdf .strip .cap b { margin-left: auto; font-weight: 700; color: var(--p-ink-2); }

/* A section is a real table so its head is a <thead>: when the section runs
   onto another sheet, the print engine repeats the head there itself. Only a
   real <thead> does this in Chromium — a div with display: table-header-group
   was measured and does not repeat. */
.pdf .section { width: 100%; table-layout: fixed; border-collapse: collapse; border-spacing: 0; }
.pdf .section > thead > tr > th { padding: 0; text-align: left; font-weight: inherit; }
.pdf .section > tbody > tr > td { padding: 0; vertical-align: top; }
.pdf .sechead .in { display: flex; align-items: baseline; gap: 10px; padding: 22px 0 7px; border-bottom: 1px solid var(--p-rule-2); }
.pdf .sechead h2 { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .26em; color: var(--p-sage); margin: 0; }
.pdf .sechead .of { margin-left: auto; font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .05em; color: var(--p-ink-2); text-align: right; }

/* Every session row, every note and the wellness table is atomic. */
.pdf .srow, .pdf .nrow, .pdf .atomic { break-inside: avoid; page-break-inside: avoid; }
.pdf .section > tbody > tr.srow > td, .pdf .section > tbody > tr.nrow > td { border-bottom: 1px solid var(--p-rule); }
.pdf .section > tbody > tr.srow > td { padding: 10px 0 11px; }
.pdf .section > tbody > tr.nrow > td { padding: 8px 0 9px; }
.pdf .entry { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 16px; align-items: start; }
.pdf .when { font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .02em; color: var(--p-ink-2); padding-top: 3px; text-transform: uppercase; }
.pdf .sname { font-family: var(--font-cast); font-weight: 700; font-size: 17px; letter-spacing: .04em; line-height: 1.1; color: var(--p-ink); text-transform: uppercase; overflow-wrap: anywhere; }
.pdf .bul { margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.pdf .bul li { list-style: none; display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: start; }
.pdf .bul li s { text-decoration: none; font-family: var(--font-display); font-size: 15px; line-height: 1.4; color: var(--p-sage); }
.pdf .bul li p, .pdf .sprose { font-family: var(--font-display); font-weight: 400; font-size: 15px; line-height: 1.4; color: var(--p-ink-2); margin: 0; overflow-wrap: anywhere; }
.pdf .sprose { margin-top: 6px; white-space: pre-wrap; }

.pdf .tablewrap { padding-top: 6px; }
.pdf .wtable { width: 100%; border-collapse: collapse; }
.pdf .wtable th { font-family: var(--font-cast); font-weight: 700; font-size: 13px; letter-spacing: .18em; text-transform: uppercase; color: var(--p-sage); text-align: right; padding: 7px 10px 6px 0; border-bottom: 1px solid var(--p-rule-2); white-space: nowrap; }
.pdf .wtable th:first-child { text-align: left; }
.pdf .wtable th:last-child { padding-right: 0; }
.pdf .wtable td { font-family: var(--font-mono); font-weight: 500; font-size: 14px; color: var(--p-ink); padding: 6px 10px 6px 0; border-bottom: 1px solid var(--p-rule); text-align: right; }
.pdf .wtable td.m { font-family: var(--font-sans); font-weight: 700; text-align: left; }
.pdf .wtable td.t { width: 30%; padding-right: 0; }
.pdf .track { height: 6px; background: var(--p-wash); border: 1px solid var(--p-rule); border-radius: 3px; overflow: hidden; }
.pdf .track i { display: block; height: 100%; background: var(--p-sage); }
.pdf .scale { font-family: var(--font-mono); font-weight: 400; font-size: 13px; letter-spacing: .03em; color: var(--p-ink-2); margin: 9px 0 0; text-transform: uppercase; }

.pdf .said { font-family: var(--font-display); font-style: italic; font-weight: 400; font-size: 15px; line-height: 1.44; color: var(--p-ink); margin: 0; overflow-wrap: anywhere; }
.pdf .notes-left { font-family: var(--font-display); font-style: italic; font-size: 15px; line-height: 1.44; color: var(--p-ink-2); margin: 0; padding-top: 10px; }
.pdf .withheld { padding-top: 22px; break-inside: avoid; page-break-inside: avoid; }
.pdf .withheld p { font-family: var(--font-display); font-style: italic; font-size: 15px; line-height: 1.44; color: var(--p-ink-2); margin: 0; padding-top: 8px; border-top: 1px solid var(--p-rule-2); }

/* The coach's choice, per note. On screen only: none of it prints. */
.pdf .pick-intro { font-family: var(--font-sans); font-size: 14px; line-height: 1.5; color: var(--p-ink-2); margin: 10px 0 2px; }
.pdf .pick {
  display: inline-flex; align-items: center; gap: 10px; min-height: 44px; margin-top: 4px; padding-right: 8px;
  font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--p-ink); cursor: pointer;
}
.pdf .pick input {
  -webkit-appearance: none; appearance: none; flex: none; margin: 0; cursor: pointer;
  width: 22px; height: 22px; border-radius: 5px; border: 1.5px solid var(--p-ink-2); background: var(--p-paper);
  display: inline-grid; place-content: center;
}
.pdf .pick input::after { content: ''; width: 11px; height: 6px; border-left: 2px solid transparent; border-bottom: 2px solid transparent; transform: translateY(-1px) rotate(-45deg); }
.pdf .pick input:checked { background: var(--p-ink); border-color: var(--p-ink); }
.pdf .pick input:checked::after { border-color: #FFFFFF; }
.pdf .pick input:focus-visible { outline: 2px solid var(--p-sage); outline-offset: 2px; }
.pdf .pick-state { font-family: var(--font-mono); font-size: 13px; color: var(--p-ink-2); }

.pdf .endmark { padding-top: 26px; display: flex; align-items: center; gap: 14px; break-before: avoid; page-break-before: avoid; }
.pdf .endmark i { flex: 1; height: 1px; background: var(--p-rule-2); min-width: 16px; }
.pdf .endmark span { font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .05em; color: var(--p-ink-2); text-align: center; }

.pdf .screen-foot {
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px;
  margin-top: 36px; padding-top: 12px; border-top: 1px solid var(--p-rule);
  font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .04em; color: var(--p-ink-2);
}
.pdf .screen-foot b { font-weight: 500; color: var(--p-ink); letter-spacing: .07em; }

.print-only, .print-only-row { display: none; }
@media print {
  html, body { overflow: visible !important; max-width: none !important; padding: 0 !important; margin: 0 !important; }
  .pdf { --gut: 56px; min-height: 0; }
  .no-print, .not-in-report { display: none !important; }
  .print-only { display: block; }
  .print-only-row { display: table-row; }
  .pdf .doc { padding-bottom: 0; }
}
`

function pageCss(runRight: string, footLeft: string, footRight: string): string {
  const box = `font-family: var(--font-mono); font-weight: 500; font-size: 13px; letter-spacing: .04em; color: #4A544C;`
  const ticks = `background-image: linear-gradient(to right, rgba(58,82,55,0.42) 0 1px, transparent 1px); background-size: 39px 9px; background-repeat: repeat-x; background-position: 0 calc(100% - 12px);`
  return `
@page {
  size: A4;
  margin: 105px 0 89px;
  @top-left {
    content: ${CHIP_URL} "  COACHVOICE  ·  MONTHLY REPORT";
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
@page :first {
  margin-top: 0;
  @top-left { content: none; background: none; }
  @top-right { content: none; background: none; }
}
`
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
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  // Which check-in notes the coach has chosen to print, by their position in
  // the list below (the list is fixed once loaded).
  //
  // Max, 2026-09-25: an athlete writes a check-in note to their coach, having
  // been told only "Your coach will see this before your next session" — and
  // parents receive this report. So no note prints unless the coach includes
  // it, one at a time. Held in component state for this pass: nothing is
  // remembered between prints, so every report starts from none.
  const [included, setIncluded] = useState<Set<number>>(() => new Set())

  // Set when the report could not be built. The report is not printed then:
  // a blank "0 sessions, no check-ins" page handed to a parent reads as a
  // quiet month, when the truth is the query failed.
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('You are signed out. Sign in again, then reopen this report.')

        const { data: profile, error: profileErr } = await supabase.from('profiles').select('first_name, last_name, sport').eq('id', user.id).single()
        if (profileErr) throw new Error(`Could not load your profile: ${profileErr.message}`)
        setCoach(profile)

        const { data: ath, error: athErr } = await supabase.from('athletes').select('first_name, last_name, email').eq('id', athleteId).single()
        if (athErr || !ath) throw new Error(`Could not load this athlete${athErr ? `: ${athErr.message}` : '.'}`)
        setAthlete(ath)

        // Last 30 days, as a local calendar date. Both queries use the same
        // one: check-ins were cut at since.toISOString(), a UTC date, which a
        // day either side of midnight is a different day from the sessions'.
        const since = new Date()
        since.setDate(since.getDate() - 30)
        const sinceStr = since.toISOString()
        const sinceDate = new Intl.DateTimeFormat('en-CA').format(since)

        const { data: sess, error: sessErr } = await supabase
          .from('sessions')
          .select('id, session_name, summary, session_date, created_at')
          .eq('athlete_id', athleteId)
          // Backdated sessions belong in the window they happened in, so filter
          // on session_date and keep created_at only for rows that predate it.
          .or(`session_date.gte.${sinceDate},and(session_date.is.null,created_at.gte.${sinceStr})`)
          .order('session_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
        if (sessErr) throw new Error(`Could not load sessions: ${sessErr.message}`)
        setSessions(sess ?? [])

        const { data: chk, error: chkErr } = await supabase
          .from('wellness_checkins')
          .select('check_date, energy, mood, sleep_q, soreness, stress, notes')
          .eq('athlete_id', athleteId)
          .gte('check_date', sinceDate)
          .order('check_date')
        if (chkErr) throw new Error(`Could not load check-ins: ${chkErr.message}`)
        setCheckins(chk ?? [])

        const now = new Date()
        setReportMonth(now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
        setPeriodFrom(sinceDate)
        setPeriodTo(todayISODate())
      } catch (e: unknown) {
        setLoadError(errorMessage(e, 'Could not build this report.'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [athleteId])

  useEffect(() => {
    if (!loading && athlete && !loadError) setTimeout(() => window.print(), 400)
  }, [loading, athlete, loadError])

  if (loadError) return (
    <div className="pdf">
      <style>{BASE_CSS}</style>
      <div className="state" role="alert" style={{ flexDirection: 'column', gap: 16 }}>
        <span>This report could not be built, so it has not been printed.</span>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--t-body)', overflowWrap: 'anywhere' }}>{loadError}</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          <button type="button" className="tb-btn tb-print" onClick={() => window.location.reload()}>Try again</button>
          <button type="button" className="tb-btn tb-close" onClick={() => window.close()}>Close</button>
        </span>
      </div>
    </div>
  )

  if (loading) return (
    <div className="pdf">
      <style>{BASE_CSS}</style>
      <div className="state">Preparing monthly report…</div>
    </div>
  )

  const athleteName = athlete ? `${athlete.first_name} ${athlete.last_name}` : 'Athlete'
  const firstName = athlete?.first_name || 'the athlete'
  const coachName = (coach ? [coach.first_name, coach.last_name].filter(Boolean).join(' ') : '') || 'Coach'

  const avgWellness = checkins.length > 0
    ? avg(checkins.map(wellnessScore))
    : '—'

  // The 30-day strip: one bar per local calendar day from the start of the
  // window to today, so every check-in the query returned has a day to sit on.
  const byDay = new Map(checkins.map((c) => [c.check_date, c]))
  const from = parseISODate(periodFrom)
  const days: { iso: string; score: number | null }[] = []
  if (from) {
    for (let i = 0; ; i++) {
      const iso = isoDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i))
      const c = byDay.get(iso)
      days.push({ iso, score: c ? wellnessScore(c) : null })
      if (iso >= periodTo || i > 400) break
    }
  }

  const notes = checkins.filter((c) => c.notes)
  const includedNotes = notes.filter((_, i) => included.has(i))
  const toggle = (key: number) => setIncluded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const periodLabel = periodFrom && periodTo
    ? `${shortDay(periodFrom)} – ${shortDay(periodTo, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : reportMonth.toUpperCase()
  const generated = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase()

  const endParts = [`END OF REPORT · ${sessions.length} OF ${sessions.length} ${sessions.length === 1 ? 'SESSION' : 'SESSIONS'}`]
  if (checkins.length > 0) endParts.push(`${checkins.length} ${checkins.length === 1 ? 'CHECK-IN' : 'CHECK-INS'}`)
  const endScreen = endParts.join(' · ')
  const endPrint = includedNotes.length > 0
    ? `${endScreen} · ${includedNotes.length} ${includedNotes.length === 1 ? 'NOTE' : 'NOTES'} INCLUDED`
    : endScreen

  const css = BASE_CSS + pageCss(
    `${athleteName} · ${periodLabel}`.toUpperCase(),
    `COACHVOICE · GENERATED ${generated}`,
    `CONFIDENTIAL — ${athleteName.toUpperCase()}`,
  )

  return (
    <div className="pdf">
      <style>{css}</style>

      <div className="toolbar no-print">
        <button type="button" className="tb-btn tb-print" onClick={() => window.print()}>
          Print / Save PDF
        </button>
        <button type="button" className="tb-btn tb-close" onClick={() => window.close()}>
          Close
        </button>
      </div>

      <div className="sheet">
        <div className="plate">
          <div className="gridlines" />
          <div className="inner">
            <div className="mark" aria-hidden>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="11" rx="3" /><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5" /><path d="M12 18.5V21" />
              </svg>
            </div>
            <div>
              <div className="wordmark">COACHVOICE</div>
              <div className="rolecap">MONTHLY PROGRESS REPORT</div>
            </div>
            <div className="sp" />
            {periodFrom && periodTo && (
              <div className="stamp">
                <div className="k">PERIOD</div>
                <div className="v">{periodFrom} → {periodTo}</div>
              </div>
            )}
          </div>
        </div>
        <div className="ticks" />

        <div className="doc">
          {/* Header */}
          <div className="titleblock">
            <div className="eyebrow">{reportMonth}</div>
            <h1>{athleteName}</h1>
            <p className="byline">Prepared by {coachName}{coach?.sport ? ` · ${coach.sport}` : ''}</p>
          </div>

          {/* Summary stats */}
          <div className="hero">
            <div className="big">
              <div className="huge">{sessions.length}</div>
              <div className="huge-cap">{sessions.length === 1 ? 'SESSION' : 'SESSIONS'}</div>
              <div className="huge-sub">IN 30 DAYS</div>
            </div>
            <div className="trio">
              <div className="cell">
                <div className="mid">{checkins.length}</div>
                <div className="lbl">CHECK-INS</div>
                <div className="sub">of 30 days</div>
              </div>
              <div className="cell">
                <div className="mid">{avgWellness}{avgWellness !== '—' && <span className="of">/5</span>}</div>
                <div className="lbl">AVG WELLNESS</div>
              </div>
              <div className="cell">
                <div className="mid">
                  {checkins.length > 0 ? <>{Math.round((checkins.length / 30) * 100)}<span className="of">%</span></> : '—'}
                </div>
                <div className="lbl">CHECK-IN RATE</div>
              </div>
              {checkins.length > 0 && days.length > 0 && (
                <div className="strip">
                  <div className="bars" aria-hidden>
                    {days.map((d, i) => (
                      <i
                        key={d.iso}
                        className={d.score === null ? 'none' : i === days.length - 1 ? 'now' : undefined}
                        style={d.score === null ? undefined : { height: `${Math.max(8, (d.score / 5) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <div className="cap">
                    <span>DAILY WELLNESS, {periodLabel}</span>
                    <b>{days[days.length - 1].score !== null ? 'LAST BAR IS TODAY' : 'ENDS TODAY'}</b>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Session summaries */}
          {sessions.length > 0 && (
            <table className="section" role="presentation">
              <thead className="sechead">
                <tr><th>
                  <div className="in">
                    <h2>SESSIONS THIS PERIOD</h2>
                    <span className="of">{sessions.length} RECORDED</span>
                  </div>
                </th></tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const pts = s.summary ? summaryPoints(s.summary) : null
                  return (
                    <tr key={s.id} className="srow">
                      <td>
                        <div className="entry">
                          <div className="when">
                            {formatSessionDate(s, { weekday: 'short' })}<br />
                            {formatSessionDate(s, { month: 'short', day: 'numeric' })}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="sname">{s.session_name ?? 'Session'}</div>
                            {pts
                              ? <ul className="bul">{pts.map((p, i) => <li key={i}><s aria-hidden>–</s><p>{p}</p></li>)}</ul>
                              : s.summary && <p className="sprose">{s.summary}</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {/* Wellness summary table */}
          {checkins.length > 0 && (
            <table className="section" role="presentation">
              <thead className="sechead">
                <tr><th>
                  <div className="in">
                    <h2>WELLNESS OVERVIEW</h2>
                    <span className="of">{checkins.length} {checkins.length === 1 ? 'CHECK-IN' : 'CHECK-INS'}</span>
                  </div>
                </th></tr>
              </thead>
              <tbody>
                <tr className="atomic"><td>
                  <div className="tablewrap">
                    <table className="wtable">
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Average</th>
                          <th>Best</th>
                          <th>Lowest</th>
                          <th>Of 5</th>
                        </tr>
                      </thead>
                      <tbody>
                        {WELLNESS_METRICS.map(({ label, key }) => {
                          const normVals = checkins.map((c) => normalised(c, key)).filter((v): v is number => v !== null)
                          const mean = avg(normVals)
                          return (
                            <tr key={key}>
                              <td className="m">{label}</td>
                              <td>{mean}</td>
                              <td>{normVals.length ? Math.max(...normVals) : '—'}</td>
                              <td>{normVals.length ? Math.min(...normVals) : '—'}</td>
                              <td className="t">
                                <div className="track" aria-hidden>
                                  <i style={{ width: mean === '—' ? 0 : `${(parseFloat(mean) / 5) * 100}%` }} />
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <p className="scale">Self-scored 1–5 by {firstName}. Five is good in every row.</p>
                  </div>
                </td></tr>
              </tbody>
            </table>
          )}

          {/* Notes from athlete.
              On screen the coach sees every note and chooses, one at a time,
              which to print. In print only the chosen ones appear; if none are
              chosen the section does not print at all, and one line says the
              notes were left out, so the report does not imply there were
              none. */}
          {notes.length > 0 && (
            <table className={`section${includedNotes.length === 0 ? ' not-in-report' : ''}`} role="presentation">
              <thead className="sechead">
                <tr><th>
                  <div className="in">
                    <h2>ATHLETE NOTES</h2>
                    <span className="of no-print">{includedNotes.length} OF {notes.length} INCLUDED</span>
                    <span className="of print-only">
                      {includedNotes.length} INCLUDED BY {coachName.toUpperCase()}
                    </span>
                  </div>
                </th></tr>
              </thead>
              <tbody>
                <tr className="no-print"><td>
                  <p className="pick-intro">
                    {firstName} wrote these to you, not for a report. None of them prints unless you include it.
                  </p>
                </td></tr>
                {notes.map((c, i) => {
                  const on = included.has(i)
                  return (
                    <tr key={i} className={`nrow${on ? '' : ' not-in-report'}`}>
                      <td>
                        <div className="entry">
                          <div className="when">{shortDay(c.check_date)}</div>
                          <div style={{ minWidth: 0 }}>
                            <p className="said">“{c.notes}”</p>
                            <label className="pick no-print">
                              <input type="checkbox" checked={on} onChange={() => toggle(i)} />
                              Include in report
                              <span className="pick-state">{on ? '· will print' : '· not printed'}</span>
                            </label>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {includedNotes.length > 0 && includedNotes.length < notes.length && (
                  <tr className="print-only-row"><td>
                    <p className="notes-left">{firstName}’s other check-in notes are not included in this report.</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
          {notes.length > 0 && includedNotes.length === 0 && (
            <div className="withheld print-only">
              <p>{firstName}’s check-in notes are not included in this report.</p>
            </div>
          )}

          <div className="endmark">
            <i />
            <span className="no-print">{endScreen}</span>
            <span className="print-only">{endPrint}</span>
            <i />
          </div>

          <div className="screen-foot no-print">
            <span>COACHVOICE · {generated} · MONTHLY REPORT</span>
            <span>{athleteName.toUpperCase()} — <b>CONFIDENTIAL</b></span>
          </div>
        </div>
      </div>
    </div>
  )
}
