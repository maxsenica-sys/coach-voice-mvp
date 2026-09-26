'use client'

import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase-browser'
import Calendar, { type CalendarEvent } from '@/app/components/Calendar'
import VideoAnnotator, { type AnnotationStroke } from '@/app/components/VideoAnnotator'
import AthleteClipUpload from '@/app/components/AthleteClipUpload'
import CheckIn from '@/app/components/CheckIn'
import { currentMonth, toMonthStr } from '@/lib/calendar-month'
import { markAppReady } from '@/lib/boot-shell'
import { getDailyQuote } from '@/lib/quotes'
import {
  WELLNESS_METRICS, metricColor,
  overallWellnessScore, overallScoreColor,
  type WellnessCheckin,
} from '@/lib/wellness-config'
import { fmtDateDivider } from '@/lib/date-utils'
import ListState from '@/app/components/ListState'
import SessionAudioPlayer from '@/app/components/SessionAudioPlayer'
import { buildSpine, SPINE_MIN_SESSIONS, SPINE_WEEKS } from '@/lib/training-spine'
import { READINESS_OPTIONS } from '@/lib/readiness'
import { apiMutate, apiJson } from '@/lib/api-client'
import { drainCheckins } from '@/lib/checkin-queue'
import { readCachedProfile, writeCachedProfile, displayName, clearCachedProfile } from '@/lib/profile-cache'
import { formatSessionDate, parseISODate, sessionISODate, todayISODate } from '@/lib/session-date'
import { errorMessage } from '@/lib/errors'
import type { MessageRow, RsvpEvent } from '@/lib/api-types'
import { SESSION_RESPONSES, responseOption, type SessionResponse } from '@/lib/session-response'
import { injuryStatusOption, openInjuries, type Injury } from '@/lib/injury'
import { regionLabel } from '@/lib/body-map'
import { SUPPORTED_RECORDING_TYPES, audioExtension } from '@/lib/audio-mime'
import { buildDigest, isDigestDay, trainingToday, formatEventTime, takeawayPlacement, firstTakeaway } from '@/lib/digest'
import TakeawayReminder from '@/app/components/TakeawayReminder'
import AthleteDigest, { DigestLink } from '@/app/components/AthleteDigest'

type Tab = 'home' | 'sessions' | 'calendar' | 'notes' | 'messages' | 'wellness'

type WellnessRow = WellnessCheckin

type SessionRow = {
  id: string
  session_name: string | null
  title: string | null
  summary: string | null
  /**
   * The squad this session was recorded for, if any.
   *
   * The transcript itself is deliberately NOT in this type. A group recording
   * writes one row per member carrying the coach's whole talk to the squad,
   * which names other children — so the athlete's client does not select that
   * column at all any more. Selecting it and then declining to render it would
   * not be a fix: a column this browser can query is a column it has.
   * Individual transcripts are loaded one at a time from the detail route,
   * which withholds squad transcripts server-side.
   */
  group_id: string | null
  focus_points?: string[] | null
  /** How this athlete answered — null until they tap one. See lib/session-response.ts. */
  athlete_response?: string | null
  session_date?: string | null
  shared_with_athlete: boolean
  created_at: string | null
  sport_context: string | null
  audio_path?: string | null
  audio_mime?: string | null
}

type AthleteNote = {
  id: string
  session_id: string | null
  content: string
  note_type: 'typed' | 'voice'
  created_at: string
  updated_at: string
}

type SessionVideo = {
  id: string
  session_id: string
  storage_path: string
  file_name: string | null
  annotations: AnnotationStroke[]
  created_at: string
  signedUrl: string | null
  /** 'athlete' on a clip this athlete sent. Absent before migration 032. */
  uploaded_by_role?: 'coach' | 'athlete'
  shared_with_athlete?: boolean
}

function AthleteIcon({ name, size = 20, strokeWidth = 2 }: { name: string; size?: number; strokeWidth?: number }) {
  const s: React.CSSProperties = { width: size, height: size, display: 'block', flexShrink: 0 }
  const p = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: s }
  switch (name) {
    case 'home':     return <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    case 'book':     return <svg {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
    case 'calendar': return <svg {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'messages': return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    case 'mic':      return <svg {...p}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    /* A pulse line. The check-in button used the mic glyph, in the coach's rust
       gradient, at the exact size and position where the coach's own app puts
       the recorder — so the largest control in the athlete's app promised the
       one thing this product deliberately does not do. Athletes do not record
       for their coach; PROJECT-STATE says so. The same file uses `mic` 600
       lines further up to mean "your coach recorded this", correctly, which is
       what made the FAB read as recording rather than as anything else. */
    case 'pulse':    return <svg {...p}><path d="M2 12h4l2.5-7 4 14L15.5 12H22"/></svg>
    case 'video':    return <svg {...p}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    case 'pencil':   return <svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    default:         return null
  }
}

/**
 * A text link that has to sit on a type baseline but still be tappable.
 *
 * The padding takes the box to the 44px touch minimum and the matching negative
 * margin gives it back to the layout, so the row keeps the height and the
 * baseline it had while the finger target stops being a 20px-tall word.
 */
const TAP_INLINE: React.CSSProperties = { padding: '12px 4px', margin: '-12px -4px', minHeight: 44, whiteSpace: 'nowrap', flexShrink: 0 }

/* ── Stadium Night, the athlete's side: the dispatch ─────────────────────
 *
 * The coach gets a scoreboard; the athlete gets a dispatch. Read with
 * scratchpad dirA-athlete.html, the approved reference, whose class shapes
 * these follow.
 *
 * A stylesheet rather than inline styles because the structure needs what
 * inline styles cannot say: pseudo-elements for the hairlines, attribute
 * selectors for pressed and current state, and a wrap point for the check-in
 * card. Every class is prefixed `ah-` and lives only on this page.
 *
 * The four translucent values below are the Stadium Night spec's panel and
 * hairline steps, scoped to this page because globals.css does not carry them
 * yet. They are cream at low alpha, not new hues, and nothing that is TEXT uses
 * them: text is --text, --text-2 or --text-muted only.
 *
 * Floodlight (--flood) is spent on state and nothing else. On this page that
 * is three things: NEWEST on the latest session, the spine bar that is this
 * week, and the tab you are on. A fourth use is a regression.
 *
 * Nothing here animates. Grain is 0.065 effective alpha, under the 0.13 at
 * which it started pulling real text below 4.5:1. */
const SN_CSS = `
.ah-root{
  --panel:rgba(245,236,215,0.045);
  --line:rgba(245,236,215,0.11);
  --line-2:rgba(245,236,215,0.19);
  --ember:var(--coach-on-light);
  position:relative;isolation:isolate;min-height:100vh;background:var(--bg);color:var(--text);
}
.ah-stage{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
.ah-stage>i{position:absolute;inset:0}
.ah-beam-b{background:radial-gradient(640px 520px at 50% 116%,rgba(58,79,56,0.5) 0%,rgba(31,36,33,0) 66%)}
.ah-beam-a{background:
  radial-gradient(720px 440px at -12% -8%,rgba(125,168,120,0.26) 0%,rgba(125,168,120,0) 62%),
  radial-gradient(500px 360px at 116% 22%,rgba(227,154,122,0.11) 0%,rgba(227,154,122,0) 60%)}
.ah-grid{
  background-image:
    repeating-linear-gradient(to right,rgba(245,236,215,0.045) 0 1px,transparent 1px 39px),
    repeating-linear-gradient(to bottom,rgba(245,236,215,0.03) 0 1px,transparent 1px 39px);
  -webkit-mask-image:linear-gradient(164deg,#000 0%,rgba(0,0,0,0.22) 52%,rgba(0,0,0,0.8) 100%);
  mask-image:linear-gradient(164deg,#000 0%,rgba(0,0,0,0.22) 52%,rgba(0,0,0,0.8) 100%)}
.ah-grain{opacity:.5;background-image:radial-gradient(rgba(245,236,215,0.13) 0.5px,transparent 0.5px);background-size:13px 13px}

.ah-cast{font-family:var(--font-cast);text-transform:uppercase}
.ah-root .num{font-family:var(--font-mono);font-weight:500;letter-spacing:.02em}

/* Header */
.ah-head{position:sticky;top:0;z-index:100;background:rgba(21,25,22,0.88);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.ah-head-in{max-width:1000px;margin:0 auto;padding:8px 20px;display:flex;align-items:center;gap:10px}
.ah-me{width:36px;height:36px;border-radius:11px;flex:none;background:var(--primary);color:var(--on-primary);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-cast);font-weight:800;font-size:16px;letter-spacing:.06em}
.ah-wordmark{font-family:var(--font-cast);font-weight:700;font-size:16px;letter-spacing:.2em;line-height:1;color:var(--text);text-transform:uppercase}
.ah-rolecap{font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.26em;line-height:1;color:var(--primary);margin-top:4px;text-transform:uppercase}
.ah-iconbtn{width:44px;height:44px;border-radius:12px;flex:none;padding:0;cursor:pointer;
  border:1px solid var(--line-2);background:rgba(245,236,215,0.04);color:var(--text-2);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.14em;text-transform:uppercase}

/* Ticker: date, name, sport. It wraps rather than truncates; a name is never cut. */
.ah-ticker{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:8px 0;margin-bottom:18px;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  font-family:var(--font-cast);font-weight:600;font-size:13px;letter-spacing:.16em;line-height:1.35;
  color:var(--text-2);text-transform:uppercase}
.ah-ticker>span{min-width:0;overflow-wrap:anywhere}
.ah-sep{width:3px;height:3px;border-radius:50%;background:var(--line-2);flex:none}

/* Desktop tabs */
.ah-dtabs{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:22px;border-bottom:1px solid var(--line)}
.ah-dtab{position:relative;min-height:44px;padding:0 14px;background:none;border:none;cursor:pointer;
  font-family:var(--font-cast);font-weight:700;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--text-2)}
.ah-dtab[aria-current=page]{color:var(--text)}
.ah-dtab[aria-current=page]::after{content:'';position:absolute;left:14px;right:14px;bottom:-1px;height:2.5px;border-radius:2px;background:var(--flood)}

/* Home */
.ah-home{display:flex;flex-direction:column;gap:20px;max-width:620px}
.ah-hello h1{margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--fs-6);line-height:1.06;letter-spacing:-.6px;color:var(--text)}
.ah-hello h1 em{font-style:italic;font-weight:500}
.ah-hello p{margin:8px 0 0;font-size:var(--fs-2);line-height:1.5;color:var(--text-2)}

.ah-panel{position:relative;display:block;border-radius:20px;overflow:hidden;background:var(--panel);border:1px solid var(--line)}
.ah-eyebrow{font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.22em;line-height:1.25;color:var(--text-2);text-transform:uppercase}
.ah-link{background:none;border:none;cursor:pointer;font-family:var(--font-cast);font-weight:700;font-size:13px;
  letter-spacing:.14em;text-transform:uppercase;color:var(--text-2)}
.ah-link.lit{color:var(--primary)}
.ah-when{font-family:var(--font-mono);font-weight:500;font-size:13px;letter-spacing:.06em;color:var(--text-2);text-transform:uppercase}

/* The check-in card: today's readiness over the twelve-week spine */
.ah-ci{padding:14px 16px 15px}
.ah-ci-beam{position:absolute;top:-40px;right:-58px;width:150px;height:150px;pointer-events:none;
  background:linear-gradient(180deg,rgba(168,203,160,0.13),rgba(168,203,160,0));transform:skewX(-20deg)}
.ah-ci-top{position:relative;display:flex;align-items:center;gap:8px}
/* Hero and metrics sit side by side where the metrics keep 180px, and stack
   where they would not — at 320px a track beside the numeral was ~40px long,
   too short for five steps to be told apart. */
.ah-ci-body{position:relative;display:flex;flex-wrap:wrap;gap:16px 20px;margin-top:12px}
.ah-hero{flex:0 0 auto}
.ah-score{font-family:var(--font-display);font-weight:500;font-size:56px;line-height:.82;letter-spacing:-2.8px;
  color:var(--text);font-variant-numeric:tabular-nums;margin-left:-3px}
.ah-score .of{font-size:17px;letter-spacing:0;color:var(--text-2);margin-left:2px}
.ah-score-lbl{font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.2em;color:var(--text-2);margin-top:10px;text-transform:uppercase}
.ah-score-say{font-family:var(--font-cast);font-weight:700;font-size:15px;letter-spacing:.12em;color:var(--primary);margin-top:4px;text-transform:uppercase}
/* One grid, not five rows: the label column is as wide as the longest label
   (SORENESS, in full) and every track shares the one remaining column, so an
   equal score draws an equal bar. minmax(0,1fr), never a bare 1fr. */
.ah-metrics{flex:1 1 180px;min-width:0;display:grid;grid-template-columns:max-content minmax(0,1fr) max-content;
  gap:9px 10px;align-items:center;align-content:start}
.ah-m-lbl{font-family:var(--font-cast);font-weight:700;font-size:13px;line-height:1;letter-spacing:.08em;color:var(--text-2);text-transform:uppercase}
.ah-track{display:block;height:6px;border-radius:3px;background:rgba(245,236,215,0.13);overflow:hidden}
.ah-track i{display:block;height:100%;border-radius:3px}
.ah-m-val{font-family:var(--font-mono);font-weight:500;font-size:13px;line-height:1;color:var(--text);text-align:right;min-width:1ch}
.ah-ask{position:relative;font-family:var(--font-display);font-weight:400;font-size:24px;line-height:1.15;letter-spacing:-.3px;color:var(--text);margin-top:10px}
.ah-ask-why{position:relative;margin:8px 0 0;font-size:var(--fs-2);line-height:1.5;color:var(--text-2)}
.ah-ci-go{position:relative;width:100%;min-height:46px;margin-top:14px}
.ah-ci-note{position:relative;margin-top:10px;font-size:13px;line-height:1.5;color:var(--text-2);text-align:center}

.ah-spine{position:relative;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
.ah-bars{display:flex;align-items:flex-end;gap:4px;height:26px}
.ah-bars i{flex:1;border-radius:2px;background:var(--primary);opacity:.62}
.ah-bars i.zero{background:var(--line-2);opacity:1}
.ah-bars i.now{background:var(--flood);opacity:1}
.ah-spine-cap{margin-top:9px;font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.14em;line-height:1.4;color:var(--text-2);text-transform:uppercase}

/* Section heads */
.ah-sec{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.ah-sec h2{margin:0;font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.26em;color:var(--text-2);text-transform:uppercase}

/* From your coach: the newest session set as a feature */
.ah-dispatch{padding:0 16px 14px;text-decoration:none;color:inherit}
.ah-edge{position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--ember) 0%,rgba(227,154,122,0.15) 62%,transparent 100%)}
.ah-d-top{display:flex;align-items:center;gap:10px;padding-top:15px}
.ah-new{margin-left:auto;flex:none;padding:3px 9px;border-radius:999px;background:var(--flood);color:var(--on-primary);
  font-family:var(--font-cast);font-weight:800;font-size:13px;line-height:1.2;letter-spacing:.18em;text-transform:uppercase}
.ah-d-title{margin:8px 0 0;font-family:var(--font-cast);font-weight:700;font-size:23px;line-height:1.05;letter-spacing:.02em;
  color:var(--text);text-transform:uppercase;overflow-wrap:anywhere}
.ah-d-body{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.ah-d-body li{display:grid;grid-template-columns:13px minmax(0,1fr);gap:9px;align-items:start}
.ah-d-body li>span{width:5px;height:5px;border-radius:50%;background:var(--primary);margin:9px 0 0 2px}
.ah-d-body li p{margin:0;font-family:var(--font-display);font-weight:400;font-size:var(--t-body);line-height:1.5;color:var(--text);overflow-wrap:anywhere}
/* TAKE INTO NEXT SESSION: the brightest thing on the card without spending
   floodlight on it. The only filled field, the largest body type, and the
   coach's ember edge, because this line is the coach's instruction. */
.ah-take{position:relative;overflow:hidden;margin-top:14px;border-radius:16px;padding:12px 14px 13px 17px;
  background:linear-gradient(0deg,rgba(21,25,22,0.34),rgba(21,25,22,0.34)),rgba(227,154,122,0.16);
  border:1px solid rgba(227,154,122,0.38)}
.ah-take::after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--ember)}
.ah-take .k{font-family:var(--font-cast);font-weight:800;font-size:13px;letter-spacing:.22em;color:var(--ember);text-transform:uppercase}
.ah-take .v{margin-top:6px;font-size:17px;font-weight:700;line-height:1.38;letter-spacing:-.1px;color:var(--text);overflow-wrap:anywhere}
/* Three equal rows, not three pills. As pills the third label is nearly twice
   the width of the first, wraps onto a line of its own and reads as the
   leftover option, which is fatal for the one that exists so a fifteen-year-old
   can say they did not follow. Same width, weight, target and selected state
   for all three; only the words differ. */
.ah-reply{margin-top:15px}
.ah-chips{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.ah-chip{display:flex;align-items:center;gap:12px;width:100%;min-height:46px;padding:8px 16px;border-radius:999px;cursor:pointer;
  text-align:left;border:1px solid var(--line-2);background:rgba(245,236,215,0.035);
  font-family:var(--font-sans);font-size:15px;font-weight:700;line-height:1.25;color:var(--text)}
.ah-chip>i{width:18px;height:18px;border-radius:50%;flex:none;border:1.5px solid var(--text-muted);
  display:flex;align-items:center;justify-content:center}
.ah-chip[aria-pressed=true]{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.ah-chip[aria-pressed=true]>i{background:var(--on-primary);border-color:var(--on-primary);color:var(--primary)}
.ah-reply p{margin:9px 0 0;font-size:14px;line-height:1.45;color:var(--text-2)}
.ah-d-foot{display:flex;align-items:center;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);
  font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.14em;color:var(--primary);text-transform:uppercase}
.ah-audio{display:inline-flex;align-items:center;gap:5px;color:var(--ember);font-family:var(--font-cast);font-weight:800;font-size:13px;letter-spacing:.14em;text-transform:uppercase}

/* The two sessions before it: hairline rows, the record rather than the news */
.ah-row{display:block;padding:14px 2px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.ah-row-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ah-row-title{margin-top:5px;font-family:var(--font-cast);font-weight:700;font-size:18px;line-height:1.12;letter-spacing:.03em;
  color:var(--text);text-transform:uppercase;overflow-wrap:anywhere}
.ah-row-sum{margin-top:6px;font-family:var(--font-display);font-size:var(--t-body);line-height:1.5;color:var(--text-2);
  overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.ah-row-go{margin-top:8px;font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.14em;color:var(--primary);text-transform:uppercase}

.ah-note{width:100%;min-height:52px;padding:12px 14px;border-radius:14px;border:1px dashed var(--line-2);background:transparent;cursor:pointer;
  display:flex;align-items:center;gap:10px;color:var(--text-2);font-family:var(--font-sans);font-size:var(--fs-2);font-weight:600;text-align:left}

/* Messages: one correspondent, voice picks the type */
.ah-corr{position:relative;padding-top:13px;margin-bottom:6px}
.ah-corr .nm{margin:0;font-family:var(--font-cast);font-weight:700;font-size:26px;line-height:1.05;letter-spacing:.045em;color:var(--text);text-transform:uppercase}
.ah-corr .sub{margin-top:6px;font-size:var(--fs-2);line-height:1.45;color:var(--text-2)}
.ah-day{display:flex;align-items:center;gap:10px;margin:14px 0 10px;font-family:var(--font-cast);font-weight:700;font-size:13px;
  letter-spacing:.26em;color:var(--text-2);text-transform:uppercase;text-align:center}
.ah-day i{flex:1;min-width:16px;height:1px;background:var(--line)}
.ah-msg{display:flex;flex-direction:column;margin-bottom:8px;min-width:0}
.ah-msg.in{align-items:flex-start}
.ah-msg.out{align-items:flex-end}
.ah-bub{max-width:85%;min-width:0;padding:10px 13px;color:var(--text);overflow-wrap:anywhere}
.ah-bub.media{padding:6px}
.ah-msg.in .ah-bub{border-radius:4px 16px 16px 16px;background:var(--coach-light);border:1px solid var(--coach-border);
  font-family:var(--font-display);font-size:16px;line-height:1.42}
.ah-msg.out .ah-bub{border-radius:16px 4px 16px 16px;background:var(--card);border:1px solid var(--border-soft);border-left:2px solid var(--primary);
  font-family:var(--font-sans);font-size:var(--t-body);font-weight:500;line-height:1.46}
.ah-vlabel{margin-bottom:6px;font-family:var(--font-cast);font-weight:700;font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:var(--text-2)}
.ah-msg.in .ah-vlabel{color:var(--ember)}
.ah-stamp{margin-top:4px;padding:0 4px;font-family:var(--font-mono);font-weight:500;font-size:13px;letter-spacing:.04em;color:var(--text-2)}
.ah-composer{position:sticky;z-index:160;display:flex;align-items:flex-end;gap:8px;padding:8px;
  border:1px solid var(--line-2);border-radius:24px;background:rgba(21,25,22,0.92);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.ah-composer textarea{flex:1;min-width:0;resize:none;min-height:44px;max-height:100px;padding:11px 8px;border:none;border-radius:12px;
  background:transparent;color:var(--text);font-family:var(--font-sans);font-size:16px;line-height:1.4;outline:none}
.ah-composer textarea::placeholder{color:var(--text-2)}
.ah-composer textarea:focus-visible{box-shadow:inset 0 0 0 1.5px var(--primary)}
.ah-cbtn{width:44px;height:44px;flex:none;padding:0;border-radius:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--line-2);background:rgba(245,236,215,0.05);color:var(--text-2);font-size:18px;font-weight:800}
.ah-cbtn:disabled{cursor:not-allowed}
.ah-cbtn.go{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}

/* Bottom nav: floating, five equal tracks */
.ah-veil{position:fixed;left:0;right:0;bottom:0;height:calc(110px + env(safe-area-inset-bottom));z-index:150;pointer-events:none;
  background:linear-gradient(180deg,rgba(31,36,33,0) 0%,rgba(24,28,25,0.8) 48%,#181C19 100%)}
.ah-nav{position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));height:64px;z-index:200;
  border-radius:21px;border:1px solid var(--line-2);background:rgba(21,25,22,0.9);
  -webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 -2px 30px rgba(0,0,0,0.45);
  display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:0 2px}
.ah-tab{position:relative;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  padding:0;border:none;background:none;cursor:pointer;color:var(--text-2)}
.ah-tab>span{font-family:var(--font-cast);font-weight:700;font-size:13px;line-height:1;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.ah-tab[aria-current=page]{color:var(--text)}
.ah-tab[aria-current=page]::before{content:'';position:absolute;top:6px;left:50%;width:18px;height:2.5px;margin-left:-9px;border-radius:2px;background:var(--flood)}
`

/** The lit ground under every athlete screen: two beams, the 39px pitch grid, grain. */
function SnStage() {
  return (
    <>
      <style>{SN_CSS}</style>
      <div className="ah-stage" aria-hidden>
        <i className="ah-beam-b" /><i className="ah-beam-a" /><i className="ah-grid" /><i className="ah-grain" />
      </div>
    </>
  )
}

/** Local date key (YYYY-MM-DD), matching what the API stores in check_date. */
function dateKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(d)
}

/**
 * The athlete's own fourteen days, and one sentence about them.
 *
 * This is the return half of the wellness loop. Until now the athlete gave the
 * app five numbers a day and got nothing back at all: "Trends →" led to a
 * blank form. That is the configuration the monitoring literature describes as
 * the one that fails — athletes stop answering honestly when they cannot see
 * the data being used — so this is not decoration on top of the alert, it is
 * the alert's data quality.
 *
 * Deliberately NOT WellnessGraph, which is mounted for the coach on the
 * athlete profile. That chart plots five ordinal series, two of them inverted,
 * as continuous lines in a 520x150 box. A coach with context can read it. A
 * fourteen-year-old cannot answer "so what do I do?" from it. One sentence
 * beats it.
 */
function WellnessHistory({ rows }: { rows: WellnessRow[] }) {
  const DAYS = 14

  const cells = useMemo(() => {
    const byDate = new Map(rows.map((r) => [r.check_date, r]))
    const out: { key: string; date: Date; row: WellnessRow | undefined }[] = []
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date()
      d.setHours(12, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const key = dateKey(d)
      out.push({ key, date: d, row: byDate.get(key) })
    }
    return out
  }, [rows])

  const sentence = useMemo(() => {
    const present = cells.filter((c) => c.row)
    // Below this there is not enough to say anything true about a trend.
    if (present.length < 5) {
      return { text: 'Keep checking in — after a week we can show you what is changing.', tone: 'quiet' as const }
    }

    // Only energy and sleep are eligible to be named.
    //
    // `mood` and `stress` are excluded on purpose: telling an unaccompanied
    // teenager that their mood is their worst number and falling is a clinical
    // statement, and the channel for that already exists and has an adult on
    // the other end (the coach alert, and the caretaker email). They still
    // count toward the dots and toward the coach's alert — they are just not
    // narrated back to the child.
    //
    // `soreness` is included. It was held out while WELLNESS_METRICS marked it
    // `inverted` and every scoring function computed `6 - raw` against a hint
    // that said the opposite — a sentence built on that would have told an
    // athlete the reverse of the truth. That flag was wrong and is gone, so a
    // raw score now means what the athlete was asked, and 5 is the good end of
    // all three of these.
    const ELIGIBLE = ['energy', 'sleep_q', 'soreness'] as const

    // Legacy five-slider rows only. A two-tap row's energy and soreness are
    // DERIVED (lib/readiness.ts) — "Energy is your biggest drop, averaging
    // 3.0" would be quoting a number back to an athlete who never gave it.
    const meanOf = (subset: typeof cells, key: (typeof ELIGIBLE)[number]) => {
      const vals = subset
        .filter((c) => c.row && c.row.readiness == null)
        .map((c) => c.row?.[key])
        .filter((v): v is number => typeof v === 'number')
      return vals.length >= 2 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }

    const recent = cells.slice(7)
    const prior = cells.slice(0, 7)

    let worst: { key: (typeof ELIGIBLE)[number]; now: number; was: number; drop: number } | null = null
    let compared = false
    for (const key of ELIGIBLE) {
      const now = meanOf(recent, key)
      const was = meanOf(prior, key)
      if (now === null || was === null) continue
      compared = true
      const drop = was - now
      if (drop >= 0.75 && (!worst || drop > worst.drop)) worst = { key, now, was, drop }
    }

    // Five check-ins is enough to be worth saying something, but they can all
    // sit in the same week — in which case there is no previous week to
    // compare against and "nothing much has moved" would be an assertion we
    // have not earned. Say the true thing instead.
    if (!compared) {
      // Two-tap check-ins never feed the comparison above, so for an athlete
      // who only uses the current form "a few more days" would be a promise
      // that never comes true. Say what is true instead.
      if (present.some((c) => c.row?.readiness != null)) {
        return { text: `You checked in on ${present.length} of the last ${DAYS} days.`, tone: 'quiet' as const }
      }
      return { text: 'A few more days and we can show you what is changing week to week.', tone: 'quiet' as const }
    }
    if (!worst) {
      return { text: 'Nothing much has moved this week. That is usually a good sign.', tone: 'quiet' as const }
    }
    const label = WELLNESS_METRICS.find((m) => m.key === worst.key)?.label ?? worst.key
    return {
      text: `${label} is your biggest drop this week — averaging ${worst.now.toFixed(1)} out of 5, down from ${worst.was.toFixed(1)} the week before.`,
      tone: 'flag' as const,
    }
  }, [cells])

  return (
    <div className="ah-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <span className="ah-eyebrow">
          Your check-ins
        </span>
        <span style={{ flex: 1 }} />
        <span className="ah-when">Last 14 days</span>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {cells.map((c, i) => {
          const score = overallWellnessScore(c.row ?? null)
          const isToday = i === cells.length - 1
          return (
            <div key={c.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                title={`${c.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${c.row ? '' : ' — no check-in'}`}
                style={{
                  width: '100%', height: 26, borderRadius: 5,
                  background: c.row ? overallScoreColor(score) : 'transparent',
                  border: c.row ? 'none' : '1.5px dashed var(--border)',
                  boxShadow: isToday ? '0 0 0 2px var(--bg), 0 0 0 3.5px var(--text-2)' : 'none',
                }}
              />
            </div>
          )
        })}
      </div>

      <div style={{
        fontSize: 'var(--fs-3)',
        lineHeight: 1.5,
        fontWeight: sentence.tone === 'flag' ? 600 : 500,
        color: sentence.tone === 'flag' ? 'var(--text)' : 'var(--text-2)',
      }}>
        {sentence.text}
      </div>
    </div>
  )
}

export default function AthletePage() {
  const router = useRouter()
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const [tab, setTab] = useState<Tab>('home')
  const mainRef = useRef<HTMLElement>(null)

  // Scroll to top whenever tab changes.
  //
  // The window, not <main>: main grows with its content, so the document is
  // what scrolls, and scrolling main alone was a no-op — a tab opened wherever
  // the last one had been left. main also no longer declares overflowY:auto,
  // which made it a scroll container that never scrolled: that silently
  // disabled position:sticky for everything inside it (the message composer)
  // and made main, not the clipped body, the box a too-wide child would
  // scroll sideways.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [tab])

  const [loading, setLoading] = useState(true)
  // Seeded from cache so the athlete's own name doesn't flash blank on every
  // tab change or return to the portal.
  const [athleteName, setAthleteName] = useState(() => { const c = readCachedProfile(); return c ? displayName(c) : '' })
  const [athleteId, setAthleteId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null)
  const [todayWellness, setTodayWellness] = useState<WellnessRow | null>(null)
  const [wellnessHistory, setWellnessHistory] = useState<WellnessRow[]>([])
  const [sport, setSport] = useState(() => readCachedProfile()?.sport ?? '')
  const [error, setError] = useState('')
  // Failures from actions that used to fail silently (RSVP, deletes, annotation
  // saves). Separate from `error`, which is a fatal load failure for the page.
  const [actionError, setActionError] = useState('')

  // Sessions
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [openSession, setOpenSession] = useState<string | null>(null)

  // Notes
  const [notes, setNotes] = useState<AthleteNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteFilter, setNoteFilter] = useState<string | null>(null) // session_id or null for all
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteEditId, setNoteEditId] = useState<string | null>(null)
  const [noteEditText, setNoteEditText] = useState('')
  const [noteRecording, setNoteRecording] = useState(false)
  const [noteTranscribing, setNoteTranscribing] = useState(false)
  // A failed voice note has to be visible: the athlete has already spoken, and
  // silence here is indistinguishable from success.
  const [noteError, setNoteError] = useState<string | null>(null)
  const mediaRecRef = useRef<MediaRecorder | null>(null)
  const noteChunksRef = useRef<BlobPart[]>([])

  // Calendar
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([])
  const [calLoading, setCalLoading] = useState(false)
  /* ── "Your coach has a session with you today" ──────────────────────────
   *
   * ITEM 7, the athlete half. When the coach plans a session and ticks the
   * box, this is what the athlete sees: the check-in card they already use,
   * with the reason for doing it before training rather than at some point
   * today.
   *
   * No second form and no separate pre-session questionnaire — it is the same
   * five questions and the same wellness_checkins row, which is also why the
   * coach's side can answer "have they?" by looking for that row rather than
   * tracking a state.
   *
   * Its own small fetch because the check-in card is on the home tab and the
   * calendar fetch only runs on the calendar tab. Same route, one request, and
   * a failure leaves the card exactly as it was — the nudge is an addition, so
   * losing it costs nothing.
   */
  const [sessionToday, setSessionToday] = useState<CalendarEvent | null>(null)
  /* Any session the coach has planned for today, check-in asked for or not —
   * the takeaway reminder's "Training at 4:30pm today". Same fetch; which
   * event counts is lib/digest.ts (trainingToday). */
  const [trainingEvent, setTrainingEvent] = useState<CalendarEvent | null>(null)
  useEffect(() => {
    if (!athleteId) return
    void (async () => {
      try {
        const json = await apiJson<{ events: CalendarEvent[] }>(
          '/api/calendar?month=' + toMonthStr(currentMonth()),
        )
        const today = todayISODate()
        setTrainingEvent(trainingToday(json.events ?? [], today))
        setSessionToday(
          (json.events ?? []).find(
            (e) => e.created_by_role === 'coach'
              && e.event_type === 'session'
              && e.checkin_requested === true
              && e.event_date === today,
          ) ?? null,
        )
      } catch {
        setSessionToday(null)
        setTrainingEvent(null)
      }
    })()
  }, [athleteId])

  const [calError, setCalError] = useState('')
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [addEventModal, setAddEventModal] = useState<string | null>(null) // date string
  const [eventForm, setEventForm] = useState({ title: '', description: '', event_type: 'reminder', event_time: '' })
  const [eventSaving, setEventSaving] = useState(false)
  const [calSaveMsg, setCalSaveMsg] = useState('')

  // Videos
  const [sessionVideos, setSessionVideos] = useState<Record<string, SessionVideo[]>>({})
  // Transcripts are fetched one at a time, on request, rather than arriving
  // with the session list — see the note on SessionRow.group_id. `null` means
  // "asked for and the server declined", which is what a squad session gets.
  const [transcripts, setTranscripts] = useState<Record<string, string | null>>({})
  const [transcriptBusy, setTranscriptBusy] = useState<string | null>(null)

  /**
   * What the coach has recorded about this athlete's availability.
   *
   * Read-only here, and shown without being asked for. An athlete finding out
   * from a team sheet that they have been marked unavailable is the failure
   * the injury feature exists to prevent, so the record has to be visible to
   * the person it is about.
   */
  const [injuries, setInjuries] = useState<Injury[]>([])

  // Messaging (athlete → coach)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [msgText, setMsgText] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const [msgSendError, setMsgSendError] = useState<string | null>(null)
  // Pointer capability, not width: a tablet with a keyboard is wide and touch.
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => { setIsTouch(window.matchMedia('(pointer: coarse)').matches) }, [])
  const [msgLoadError, setMsgLoadError] = useState<string | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)
  const msgBottomRef = useRef<HTMLDivElement>(null)
  const msgFileInputRef = useRef<HTMLInputElement>(null)

  // RSVP
  const [rsvpMap, setRsvpMap] = useState<Record<string, string>>({}) // event_id → status
  const [rsvpEvents, setRsvpEvents] = useState<RsvpEvent[]>([])

  // Join coach by code
  const [joinCode, setJoinCode] = useState('')
  const [joinMsg, setJoinMsg] = useState('')
  const [joinLoading, setJoinLoading] = useState(false)
  // Set once a join succeeds, and never cleared in this visit. It lives apart
  // from `error` on purpose: the join card is shown BY `error`, so a success
  // message written into that card vanished the moment `error` was cleared.
  const [joinedCoach, setJoinedCoach] = useState(false)

  // Loads that used to fail into an empty state. A failed notes or sessions
  // load said "No notes yet" / "No sessions yet" — untrue, and to a teenager
  // indistinguishable from their coach never having shared anything.
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)

  // ── Boot ──────────────────────────────────────────────────
  /* A named function rather than the body of the effect, so joining a coach
   * from inside the portal can run it again. Before, a successful join set an
   * athleteId and nothing else: the sessions, notes and name that depend on
   * the athlete row were never fetched, and the screen said "Refresh to see
   * your sessions".
   *
   * `quiet` skips the full-screen "Loading your portal…" — a reload after a
   * join must not blank the page that is telling them it worked. */
  const loadPortal = useCallback(async (
    { quiet = false, isCancelled = () => false }: { quiet?: boolean; isCancelled?: () => boolean } = {},
  ) => {
    const cancelled = isCancelled
    try {
      if (!quiet) setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/'); return }
      if (cancelled()) return

      setUserId(user.id)
      const onboardKey = `cv_onboarded_${user.id}`
      setHasOnboarded(localStorage.getItem(onboardKey) === 'true')

      // Fetch profile + athlete record first — the sessions query needs the
      // athlete's own id so it can't leak or miss rows if it ever runs
      // outside the intended RLS scope.
      const [{ data: profile }, { data: athRecord }] = await Promise.all([
        supabase.from('profiles').select('role, first_name, last_name, sport').eq('id', user.id).single(),
        supabase.from('athletes').select('id, first_name, last_name').eq('athlete_user_id', user.id).maybeSingle(),
      ])

      if (cancelled()) return

      if (profile?.role === 'coach') { router.push('/dashboard'); return }

      // A reload after a join must clear the 'no-athlete-record' marker, or
      // the join card would still be showing over a linked account.
      setError('')

      setSport(profile?.sport ?? '')

      const [sessResult, notesResult] = await Promise.all([
        athRecord
          ? supabase.from('sessions')
              .select('id, session_name, title, summary, focus_points, shared_with_athlete, session_date, created_at, sport_context, audio_path, audio_mime, group_id, athlete_response')
              .eq('athlete_id', athRecord.id)
              .eq('shared_with_athlete', true)
              // By when the session happened, not when the row was written —
              // matching the coach side. Ordering by created_at alone put a
              // backdated session at the top of the athlete's list as though
              // it had happened tonight.
              .order('session_date', { ascending: false, nullsFirst: false })
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] as SessionRow[], error: null }),
        // apiJson, not raw fetch: a non-2xx here used to parse to `{}` and
        // render as "No notes yet". Settled rather than thrown so a notes
        // failure does not take the sessions down with it.
        apiJson<{ notes?: AthleteNote[] }>('/api/athlete-notes', { cache: 'no-store' })
          .then((j) => ({ notes: j.notes ?? [], error: null as string | null }))
          .catch((e: unknown) => ({ notes: [] as AthleteNote[], error: errorMessage(e, 'Could not load your notes.') })),
      ])

      if (cancelled()) return

      if (athRecord) {
        setAthleteId(athRecord.id)
        const first = profile?.first_name ?? athRecord.first_name ?? ''
        const last = profile?.last_name ?? athRecord.last_name ?? ''
        setAthleteName(`${first} ${last}`.trim() || (user.email ?? 'Athlete'))
        writeCachedProfile({
          userId: user.id,
          role: 'athlete',
          firstName: first,
          lastName: last,
          sport: profile?.sport ?? '',
          email: user.email ?? '',
        })
        // Mark this athlete as ACTIVE on their first portal visit.
        //
        // Deliberately not awaited — nothing on this screen depends on it —
        // but no longer silently swallowed. A raw fetch with an empty catch
        // is CLAUDE.md checklist item #1, and the cost of it here is not
        // cosmetic: a failure means an athlete who is looking at their own
        // portal reads PENDING on their coach's roster, for ever, with
        // nothing anywhere to say why.
        void apiMutate('/api/athlete/activate', { method: 'POST' })
          .catch((e) => console.error('[athlete] activate failed:', errorMessage(e, 'unknown')))
      } else {
        const first = profile?.first_name ?? ''
        const last = profile?.last_name ?? ''
        setAthleteName(`${first} ${last}`.trim() || (user.email ?? 'Athlete'))
        setError('no-athlete-record')
      }

      // The query error was destructured away, so a failed load became an
      // empty list and "No sessions yet".
      if (sessResult.error) {
        console.error('[athlete] sessions load failed:', errorMessage(sessResult.error, 'unknown'))
        setSessionsError('Could not load your sessions. Check your connection and try again.')
      } else {
        setSessionsError(null)
        setSessions((sessResult.data ?? []) as SessionRow[])
      }

      setNotesError(notesResult.error)
      if (!notesResult.error) setNotes(notesResult.notes)

    } catch (e: unknown) {
      if (!cancelled()) setError(errorMessage(e, 'Failed to load'))
    } finally {
      if (!cancelled()) setLoading(false)
      markAppReady()
    }
  }, [router, supabase])

  useEffect(() => {
    let cancelled = false
    void loadPortal({ isCancelled: () => cancelled })
    return () => { cancelled = true }
  }, [loadPortal])

  // ── Calendar ──────────────────────────────────────────────
  /** Only the newest request may write — see the note on the coach's copy in
   *  app/dashboard/page.tsx. Two quick arrow presses otherwise let the older
   *  month's response land last and win. */
  const calReqRef = useRef(0)
  /** The RSVP list shares `calMonth` with the grid, so it races on the same
   *  arrow presses and needs the same guard. */
  const rsvpReqRef = useRef(0)

  const fetchCalendar = useCallback(async (month: string) => {
    const seq = ++calReqRef.current
    setCalLoading(true)
    setCalError('')
    try {
      // apiJson, not raw fetch: `if (res.ok)` with no else swallowed every
      // failure here, so a 500 left last month's events on screen and said
      // nothing. Checklist item 1 in CLAUDE.md.
      const json = await apiJson<{ events: CalendarEvent[] }>(`/api/calendar?month=${month}`, { cache: 'no-store' })
      if (seq !== calReqRef.current) return
      setCalEvents(json.events ?? [])
    } catch (e: unknown) {
      if (seq !== calReqRef.current) return
      setCalEvents([])
      setCalError(errorMessage(e, 'Could not load this month.'))
    } finally {
      if (seq === calReqRef.current) setCalLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'calendar' && athleteId) void fetchCalendar(calMonth)
  }, [tab, athleteId, calMonth, fetchCalendar])

  // ── The athlete's own wellness history ────────────────────
  //
  // This used to fetch `days=1` and keep only today's row, which is why the
  // athlete could give this app five numbers a day and never be shown one
  // back. Three weeks is enough for a 14-day strip plus the previous week to
  // compare against, and the API has always allowed it — the RLS policy is
  // scoped to the athlete's own rows, so this is their data, not a new
  // permission.
  //
  // It also used a raw `fetch().then(r => r.json())` with no `res.ok` check:
  // CLAUDE.md checklist item 1, the bug class where a non-2xx silently becomes
  // empty data and the UI reports it as "no check-ins yet".
  const loadInjuries = useCallback(async () => {
    if (!athleteId) return
    try {
      const j = await apiJson<{ injuries?: Injury[] }>(
        `/api/injuries?athlete_id=${athleteId}`,
        { cache: 'no-store' },
      )
      setInjuries(j.injuries ?? [])
    } catch {
      // Not worth an error banner on the athlete's home: the panel simply
      // does not render, which is the same as having no injuries logged.
      setInjuries([])
    }
  }, [athleteId])

  useEffect(() => { void loadInjuries() }, [loadInjuries])

  const loadWellness = useCallback(async () => {
    if (!athleteId) return
    try {
      const j = await apiJson<{ checkins?: WellnessRow[] }>(
        `/api/wellness?athlete_id=${athleteId}&days=21`,
      )
      const rows = j.checkins ?? []
      const today = new Intl.DateTimeFormat('en-CA').format(new Date())
      setWellnessHistory(rows)
      setTodayWellness(rows.find((c) => c.check_date === today) ?? null)
    } catch {
      // Non-fatal: the card falls back to its "check in" state.
    }
  }, [athleteId])

  useEffect(() => { void loadWellness() }, [loadWellness])
  // Check-ins saved on the phone while there was no signal (lib/checkin-queue)
  // are sent as soon as the portal opens; reload wellness if any went through.
  useEffect(() => { void drainCheckins().then((r) => { if (r.sent) void loadWellness() }) }, [loadWellness])

  // ── Load messages ─────────────────────────────────────────
  /* Named, so the error state can offer a real retry.
   *
   * `.then(r => r.json())` with no ok check turned every server error into an
   * empty thread, and the screen then told a teenager "No messages yet. Send
   * your coach a message below!" — untrue, and if they had just sent something
   * difficult, actively distressing. */
  const loadMessages = useCallback(async () => {
    if (!athleteId) return
    setMsgLoading(true)
    setMsgLoadError(null)
    try {
      const j = await apiJson<{ messages?: MessageRow[] }>(`/api/messages?athlete_id=${athleteId}`)
      setMessages(j.messages ?? [])
    } catch (e) {
      setMsgLoadError(e instanceof Error ? e.message : 'Could not load your messages.')
    } finally {
      setMsgLoading(false)
    }
  }, [athleteId])

  useEffect(() => {
    if (tab !== 'messages' || !athleteId) return
    void loadMessages()
  }, [tab, athleteId, loadMessages])

  useEffect(() => {
    msgBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Load RSVP events ──────────────────────────────────────
  useEffect(() => {
    if (tab !== 'calendar' || !athleteId) return
    // Load upcoming coach events with rsvp_enabled for this athlete
    // No `.catch` and no res.ok check here previously: a network failure or an
    // HTML error page became an unhandled rejection during a month change,
    // which is precisely when this fires. It shares its month with the grid,
    // so it must not be able to take the tab down with it.
    const seq = ++rsvpReqRef.current
    void (async () => {
      try {
        const j = await apiJson<{ events: RsvpEvent[] }>(`/api/calendar?month=${calMonth}`)
        if (seq !== rsvpReqRef.current) return
        // Only events that have not happened. This list is headed "Events
        // needing your response", and month navigation reaching the past —
        // which it now does, because the arrows work — would otherwise ask a
        // fourteen-year-old to RSVP to something last March.
        const today = todayISODate()
        setRsvpEvents((j.events ?? []).filter(
          (e) => e.created_by_role === 'coach' && e.rsvp_enabled && e.event_date >= today,
        ))
      } catch {
        if (seq !== rsvpReqRef.current) return
        // The grid's own error line already reports a failed month. An RSVP
        // list that cannot load is not worth a second message.
        setRsvpEvents([])
      }
    })()
  }, [tab, athleteId, calMonth])

  /* An athlete's message that does not send must say so.
   *
   * This cleared the textarea first, had no catch at all, and no else branch —
   * so a 500, a 401 or a dropped connection deleted what a teenager had just
   * written and showed them nothing. `await res.json()` on an HTML error page
   * threw, and the throw went nowhere. If a child writes something difficult to
   * their coach and the app quietly eats it, they have no way of knowing it
   * never arrived, and no reason to think it didn't.
   *
   * The draft is now held until the server confirms the write.
   */
  const sendMessage = async () => {
    if (!athleteId || !msgText.trim() || msgSending) return
    setMsgSending(true)
    setMsgSendError(null)
    const content = msgText.trim()
    try {
      const j = await apiJson<{ message?: MessageRow }>('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, content, msg_type: 'text' }),
      })
      if (!j.message) throw new Error('Your message did not save. Try sending it again.')
      const saved = j.message
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]))
      setMsgText('')
    } catch (e) {
      setMsgSendError(e instanceof Error ? e.message : 'Could not send. Try again.')
    } finally {
      setMsgSending(false)
    }
  }

  const sendRsvp = async (eventId: string, status: string) => {
    if (!athleteId) return
    try {
      await apiMutate('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, athlete_id: athleteId, status }),
      })
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not send your reply — your coach did not get it.'))
      return
    }
    setRsvpMap((prev) => ({ ...prev, [eventId]: status }))
  }

  const uploadMsgMedia = async (file: File) => {
    if (!athleteId) return
    const msgType = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio'
    if (!userId) { setMsgSendError('Your session has expired. Sign in again and retry.'); return }
    const ext = file.name.split('.').pop() ?? 'bin'
    // First segment must be the uploader's auth id — that is what the
    // messages-media storage policy scopes on, and it is what the coach side
    // has always used. The old `athlete/${athleteId}/…` prefix was scoped to
    // nobody: any athlete could write into any other athlete's folder, and no
    // policy could tell the difference.
    const path = `${userId}/${athleteId}/${Date.now()}.${ext}`
    setMsgSendError(null)
    try {
      const { error } = await supabase.storage.from('messages-media').upload(path, file)
      if (error) throw new Error(`Could not upload that file — ${error.message}`)

      // The PATH, not a URL. A signed URL dies in an hour and cannot be
      // re-derived from itself; the API signs the path fresh on every read.
      const j = await apiJson<{ message?: MessageRow }>('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete_id: athleteId, content: null, msg_type: msgType, media_path: path, media_name: file.name }),
      })
      if (!j.message) throw new Error('The file uploaded but the message did not save. Try again.')
      const saved = j.message
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]))
    } catch (e) {
      setMsgSendError(e instanceof Error ? e.message : 'Could not send that file. Try again.')
    }
  }

  // ── Session videos ────────────────────────────────────────
  const loadVideos = async (sessionId: string) => {
    if (sessionVideos[sessionId]) return
    try {
      // apiJson, not raw fetch: on a non-2xx this used to fall through to
      // `json.videos ?? []` and render "no videos" for a session that has
      // them. Checklist item 1 — a failure that looks like an empty result is
      // worse than one that looks like a failure.
      const json = await apiJson<{ videos?: SessionVideo[] }>(
        `/api/sessions/${sessionId}/videos`, { cache: 'no-store' },
      )
      setSessionVideos((prev) => ({ ...prev, [sessionId]: json.videos ?? [] }))
    } catch {
      // Left non-fatal deliberately: videos are an enhancement to the session
      // card, and the card is still useful without them.
    }
  }

  const openSessionToggle = (id: string) => {
    if (openSession === id) { setOpenSession(null); return }
    setOpenSession(id)
    loadVideos(id)
    // Tells the coach this session was opened (lib/access-log.ts). Best effort
    // by design: logging must never surface to the athlete, so a failure is
    // swallowed rather than shown.
    void apiMutate(`/api/sessions/${id}/seen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'summary_viewed' }) }).catch(() => {})
  }

  // ── Notes ─────────────────────────────────────────────────
  const saveNote = async (sessionId: string | null = null) => {
    if (!noteText.trim()) return
    setNoteSaving(true)
    try {
      // apiJson, not raw fetch: this used to check res.ok and do nothing
      // otherwise, so a failed save left the text in the box with no word that
      // it had not been kept.
      const json = await apiJson<{ note: AthleteNote }>('/api/athlete-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: noteText.trim(), session_id: sessionId, note_type: 'typed' }),
      })
      setNotes((prev) => [...prev, json.note])
      setNoteText('')
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not save your note. It is still in the box.'))
    } finally {
      setNoteSaving(false)
    }
  }

  const updateNote = async (id: string) => {
    if (!noteEditText.trim()) return
    try {
      const json = await apiJson<{ note: AthleteNote }>('/api/athlete-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, content: noteEditText.trim() }),
      })
      setNotes((prev) => prev.map((n) => n.id === id ? { ...n, content: json.note.content } : n))
      setNoteEditId(null)
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not save that change. Your edit is still open.'))
    }
  }

  const deleteNote = async (id: string) => {
    try {
      await apiMutate(`/api/athlete-notes?id=${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not delete that note'))
      return
    }
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  // Voice note recording
  const startNoteRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // The candidate list and its order live in lib/audio-mime.ts. It was
      // duplicated here and in QuickSessionModal, which is how two recorders
      // eventually start disagreeing about which browser gets mp4. Order
      // unchanged and still load-bearing — mp4 first because iOS Safari cannot
      // decode WebM at all.
      const mimeType = SUPPORTED_RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 })
      mediaRecRef.current = recorder
      noteChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) noteChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(noteChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        setNoteTranscribing(true)
        try {
          const fd = new FormData()
          // Same extension mapping as every other capture path — Whisper
          // reads the codec from the filename.
          fd.append('file', new File([blob], `note.${audioExtension(blob.type)}`, { type: blob.type }))
          if (sport) fd.append('sport', sport)
          /* A voice note that fails must say so.
           *
           * `if (res.ok && json.text)` with no else meant a failed
           * transcription — or a transcription that came back empty — did
           * nothing at all: no error, no message, the spinner cleared and the
           * note silently never existed. The athlete has already spoken; they
           * have no way to know it did not land, and nothing to retry.
           *
           * This is CLAUDE.md checklist item 1, on a child-facing path. */
          const json = await apiJson<{ text?: string }>('/api/transcribe', { method: 'POST', body: fd })
          const text = (json.text ?? '').trim()
          if (!text) {
            throw new Error('We could not make out any words in that recording. Try again somewhere quieter.')
          }
          const savedJson = await apiJson<{ note?: AthleteNote }>('/api/athlete-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: text, session_id: noteFilter, note_type: 'voice' }),
          })
          if (!savedJson.note) throw new Error('That note did not save. Try again.')
          const saved = savedJson.note
          setNotes((prev) => [...prev, saved])
          setNoteError(null)
        } catch (e: unknown) {
          setNoteError(e instanceof Error ? e.message : 'Could not save that voice note. Try again.')
        } finally {
          setNoteTranscribing(false)
        }
      }
      recorder.start()
      setNoteRecording(true)
      setNoteError(null)
    } catch (e: unknown) {
      // Was `catch {}`: a denied microphone, or a phone with none, made the
      // Voice note button do nothing at all.
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      const missing = e instanceof DOMException && e.name === 'NotFoundError'
      setNoteError(
        denied
          ? 'CoachVoice is not allowed to use your microphone. Allow it in your browser or phone settings, then try again.'
          : missing
            ? 'No microphone was found on this device.'
            : errorMessage(e, 'Could not start recording. Try again.'),
      )
    }
  }

  const stopNoteRecording = () => {
    mediaRecRef.current?.stop()
    setNoteRecording(false)
  }

  /**
   * Fetch one session's transcript on demand.
   *
   * The detail route is the only path that serves it, and it withholds the
   * transcript of a squad session from an athlete viewer. So this can be
   * called without the client having to be trusted to know the rule.
   */
  const loadTranscript = async (sessionId: string) => {
    if (sessionId in transcripts) return
    setTranscriptBusy(sessionId)
    try {
      const data = await apiJson<{ session?: { transcript?: string | null } }>(
        `/api/sessions/${sessionId}/detail`,
        { cache: 'no-store' },
      )
      setTranscripts((prev) => ({ ...prev, [sessionId]: data.session?.transcript ?? null }))
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not load that transcript'))
    } finally {
      setTranscriptBusy(null)
    }
  }

  /**
   * Answer a session, or take the answer back by tapping the same chip again.
   *
   * Optimistic: the chip fills immediately and reverts if the write fails.
   * This is a one-tap gesture on a phone, often on a bus with bad signal, and
   * a chip that waits for a round trip before acknowledging a tap gets tapped
   * twice.
   */
  const respondToSession = async (sessionId: string, next: SessionResponse) => {
    const current = sessions.find((s) => s.id === sessionId)?.athlete_response ?? null
    const value = current === next ? null : next
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, athlete_response: value } : s)))
    try {
      await apiMutate(`/api/sessions/${sessionId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: value }),
      })
    } catch (e: unknown) {
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, athlete_response: current } : s)))
      setActionError(errorMessage(e, 'Could not send that to your coach'))
    }
  }

  // ── Calendar event ─────────────────────────────────────────
  const saveCalendarEvent = async () => {
    if (!addEventModal || !eventForm.title.trim()) return
    if (!athleteId) {
      setCalSaveMsg('You need to join a coach before adding calendar events.')
      return
    }
    setEventSaving(true)
    setCalSaveMsg('')
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athlete_id: athleteId,
          title: eventForm.title,
          description: eventForm.description || null,
          event_type: eventForm.event_type,
          event_date: addEventModal,
          event_time: eventForm.event_time || null,
        }),
      })
      if (res.ok) {
        setAddEventModal(null)
        setEventForm({ title: '', description: '', event_type: 'reminder', event_time: '' })
        setCalSaveMsg('Event added!')
        setTimeout(() => setCalSaveMsg(''), 3000)
        // Refetch from DB so the calendar grid updates immediately
        await fetchCalendar(calMonth)
      } else {
        const json = await res.json().catch(() => ({}))
        setCalSaveMsg(json?.error ?? 'Failed to save event')
      }
    } catch {
      setCalSaveMsg('Failed to save event')
    } finally {
      setEventSaving(false)
    }
  }

  const deleteCalEvent = async (id: string) => {
    try {
      await apiMutate(`/api/calendar?id=${id}`, { method: 'DELETE' })
    } catch (e: unknown) {
      setActionError(errorMessage(e, 'Could not delete that event'))
      return
    }
    setCalEvents((prev) => prev.filter((e) => e.id !== id))
  }

  // ── Join coach ─────────────────────────────────────────────
  const joinCoach = async () => {
    if (!joinCode.trim()) return
    setJoinLoading(true)
    setJoinMsg('')
    try {
      // apiJson throws with the server's own message on a non-2xx, which the
      // catch below shows in the card.
      const json = await apiJson<{ athleteId?: string }>('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinCode.trim().toLowerCase() }),
      })
      if (json.athleteId) setAthleteId(json.athleteId)
      setJoinCode('')
      // The confirmation has its own state and its own card. It used to be
      // written into the join card and then `setError('')` hid that card in
      // the same tick, so the athlete saw the form disappear and nothing else.
      setJoinedCoach(true)
      // Belt and braces on top of the route's own insert, and on top of the
      // reload below (which also calls activate). Without it, an athlete who
      // joins from inside the portal could be recorded as never having opened
      // it. See lib/athlete-status.ts.
      void apiMutate('/api/athlete/activate', { method: 'POST' })
        .catch((e) => console.error('[athlete] activate after join failed:', errorMessage(e, 'unknown')))
      // Fetch what the new athlete row unlocks — name, sessions, notes — rather
      // than telling them to refresh.
      await loadPortal({ quiet: true })
    } catch (e: unknown) {
      // A dropped connection rejects rather than returning a status, and this
      // had no catch, so the button stopped spinning and nothing was said.
      setJoinMsg(errorMessage(e, 'Could not reach CoachVoice. Check your connection and try again.'))
    } finally {
      setJoinLoading(false)
    }
  }

  const logout = async () => {
    clearCachedProfile()
    await supabase.auth.signOut()
    router.push('/')
  }
  // "Out" sat next to Messages in the header and signed out on one tap — a
  // thumb aiming for Messages on a moving bus logged a teenager out, and the
  // way back in is a password they may not remember. Two steps now.
  const [confirmOut, setConfirmOut] = useState(false)

  // ── Derived data ──────────────────────────────────────────
  const filteredNotes = noteFilter ? notes.filter((n) => n.session_id === noteFilter) : notes
  // Twelve weeks for the check-in card's spine. The same lib/training-spine.ts
  // arithmetic the clock rig runs under nine timezones.
  const spine = useMemo(() => buildSpine(sessions), [sessions])

  /* ── Takeaway reminder and weekly digest ──
   * Both in-app only (no push, no email), both decided in lib/digest.ts so the
   * clock rig runs the real week and placement logic under nine timezones.
   *
   * The newest takeaway is shown ONCE. On a training day (the coach has a
   * session planned today, and the takeaway is from before today) it moves to
   * the top of Today as the reminder, chips and all, and the latest-session
   * card leaves it out. Every other day it stays in that card, where it is on
   * the home every day until the next session replaces it. */
  const newestSession = sessions[0] ?? null
  const newestTakeaway = firstTakeaway(newestSession?.focus_points)
  const takeawayWhere = takeawayPlacement({
    takeaway: newestTakeaway,
    newestSessionISO: newestSession ? sessionISODate(newestSession) : null,
    todayISO: todayISODate(),
    trainsToday: trainingEvent !== null,
  })
  const digest = useMemo(
    () => buildDigest({ sessions, checkins: wellnessHistory, injuries }),
    [sessions, wellnessHistory, injuries],
  )
  // Opened from the "Last week" link, on any day.
  const [digestOpen, setDigestOpen] = useState(false)
  // Hidden for this week: remembered per athlete and per week in this browser.
  // Storage can be absent or throw (private mode, blocked site data), and the
  // card must still render correctly without it, so every access is guarded
  // and the in-memory key covers this visit either way.
  const digestKey = userId ? `cv_digest_hidden_${userId}_${digest.week.startISO}` : null
  const [digestHiddenKey, setDigestHiddenKey] = useState<string | null>(null)
  const digestHidden = digestKey !== null && (digestHiddenKey === digestKey || (() => {
    try { return localStorage.getItem(digestKey) === '1' } catch { return false }
  })())
  const hideDigest = () => {
    if (!digestKey) return
    setDigestHiddenKey(digestKey)
    setDigestOpen(false)
    try { localStorage.setItem(digestKey, '1') } catch { /* this visit still honours it */ }
  }
  const digestAuto = isDigestDay() && !digest.isEmpty && !digestHidden

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-2)' }}>Loading your portal…</div>
      </div>
    )
  }

  // ── First-login onboarding ─────────────────────────────────
  // Only for an athlete who is linked to a coach. Without an athlete row there
  // is no coach, so "your coach has set up your training profile" was untrue —
  // and this full-screen welcome stood between them and the one thing they
  // can do, which is enter the invite code. Not straight after joining,
  // either: that would cover the confirmation that the join worked.
  if (hasOnboarded === false && sessions.length === 0 && athleteId && !joinedCoach) {
    const onboardFirstName = athleteName.split(' ')[0] || 'Athlete'
    const onboardDate = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
    const dismissOnboarding = () => {
      if (userId) localStorage.setItem(`cv_onboarded_${userId}`, 'true')
      setHasOnboarded(true)
    }
    return (
      <div className="ah-root" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}>
        <SnStage />
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div style={{ marginBottom: 32 }}>
            <div className="ah-when" style={{ marginBottom: 10 }}>{onboardDate}</div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 34, letterSpacing: -0.8, lineHeight: 1.1, color: 'var(--text)' }}>
              Welcome to CoachVoice,<br/>
              <span style={{ fontStyle: 'italic', fontWeight: 500 }}>{onboardFirstName}.</span>
            </h1>
            <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, maxWidth: 340 }}>
              You&apos;re connected to your coach. Here&apos;s how it works.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
            {[
              { icon: 'pulse', title: 'Check in daily', desc: 'Say how ready you feel, and mark anywhere that hurts. Two taps on a normal day.' },
              { icon: 'book', title: 'View your sessions', desc: 'After each session, your coach will share notes and feedback here.' },
              { icon: 'messages', title: 'Message your coach', desc: "Ask questions, share how you're feeling, stay connected." },
            ].map((step, i) => (
              <div key={i} className="ah-panel" style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <AthleteIcon name={step.icon} size={20} strokeWidth={2} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="ah-cast" style={{ fontWeight: 700, fontSize: 17, letterSpacing: '0.06em', color: 'var(--text)', marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.55 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-lg"
            style={{ width: '100%', fontSize: 'var(--fs-4)', padding: '14px 0', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={dismissOnboarding}
          >
            Let&apos;s go →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ah-root">
      <SnStage />

      {/* Shows only on a genuinely cold launch, over the page while it loads.
          Any touch dismisses it; it never delays anything. */}

      {/* Action failure banner */}
      {actionError && (
        <div
          role="alert"
          style={{
            // Above the floating nav (64px + its 10px inset + safe area).
            position: 'fixed', left: 12, right: 12, bottom: 'calc(86px + env(safe-area-inset-bottom))', zIndex: 2000,
            maxWidth: 520, margin: '0 auto',
            background: 'var(--danger-light)', color: 'var(--text)',
            border: '1px solid var(--danger)',
            borderRadius: 14, padding: '4px 4px 4px 14px',
            display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 8px 30px rgba(0,0,0,0.45)', fontSize: 'var(--fs-3)', lineHeight: 1.5,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, padding: '8px 0', overflowWrap: 'anywhere' }}>{actionError}</span>
          <button
            onClick={() => setActionError('')}
            aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0, width: 44, height: 44, flexShrink: 0 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header — the wordmark and the two controls. The date, name and sport
          it used to carry are the ticker at the top of every tab now. */}
      <header className="ah-head">
        <div className="ah-head-in">
          <div className="ah-me" aria-hidden>
            {(athleteName.split(' ')[0]?.[0] ?? 'A').toUpperCase()}{(athleteName.split(' ')[1]?.[0] ?? '').toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="ah-wordmark">CoachVoice</div>
            <div className="ah-rolecap">Athlete</div>
          </div>
          <span style={{ flex: 1 }} />
          {/* Had no onClick at all, under a dot conditioned on
              sessions.length > 0 — an unread badge that meant "you have a
              session" and stayed lit forever. There is no athlete-side unread
              source: /api/messages/unread filters sender_role = 'athlete'
              against the caller's coach_id, so it is coach-only by
              construction. Button wired up, dot removed — and it stays
              removed: the approved mockup's "1 NEW" and ember ping have no
              data behind them on this side. */}
          <button className="ah-iconbtn" onClick={() => setTab('messages')} aria-label="Messages">
            <AthleteIcon name="messages" size={17} strokeWidth={1.8} />
          </button>
          <button className="ah-iconbtn" onClick={() => setConfirmOut((v) => !v)} aria-label="Sign out" aria-expanded={confirmOut}>
            Out
          </button>
        </div>
        {/* The confirm drops in under the bar rather than replacing "Out" in
            it: at 320px the bar has no room for two worded buttons beside the
            wordmark and Messages, and it wraps rather than going off the edge. */}
        {confirmOut && (
          <div role="group" aria-label="Sign out?" style={{ maxWidth: 1000, margin: '0 auto', padding: '0 20px 10px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: 'var(--fs-3)', color: 'var(--text)', fontWeight: 600 }}>
              Sign out of CoachVoice?
            </span>
            <button className="btn btn-ghost" onClick={() => setConfirmOut(false)} style={{ minHeight: 44 }}>
              Stay
            </button>
            <button className="btn btn-danger" onClick={() => void logout()} style={{ minHeight: 44 }}>
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* 20px gutter. The bottom pad clears the floating nav — 64px tall,
          10px up from the edge or the safe area — plus room for the last row
          to sit above the veil rather than under it. */}
      <main ref={mainRef} style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '14px 20px' : '24px 20px', paddingBottom: isMobile ? 'calc(112px + env(safe-area-inset-bottom))' : 40 }}>
        <div className="ah-ticker">
          <span className="num">
            {new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}
          </span>
          <i className="ah-sep" aria-hidden />
          <span>{athleteName || 'Athlete'}</span>
          {sport && (
            <>
              <i className="ah-sep" aria-hidden />
              <span>{sport}</span>
            </>
          )}
        </div>

        {/* No athlete record — show join form */}
        {error === 'no-athlete-record' && !joinedCoach && (
          // Was a saturated amber gradient from the retired palette.
          <div style={{ background: 'var(--warning-light)', border: '1px solid var(--warning-border)', borderRadius: 14, padding: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--fs-5)', marginBottom: 6, color: 'var(--text)' }}>
              Connect to your coach
            </div>
            <p style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 16px' }}>
              Your account isn&rsquo;t linked to a coach yet. Enter the invite code they gave you to get started.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder="Coach invite code (e.g. smithjohn4821)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toLowerCase().trim())}
                style={{ maxWidth: 280, minWidth: 0, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
              />
              <button className="btn btn-energy" onClick={joinCoach} disabled={joinLoading || !joinCode.trim()}>
                {joinLoading ? 'Joining…' : 'Join Team →'}
              </button>
            </div>
            {/* Only ever an error now — success has its own card below. */}
            {joinMsg && <p role="alert" style={{ marginTop: 10, fontSize: 'var(--fs-3)', color: 'var(--danger)', fontWeight: 600, overflowWrap: 'anywhere' }}>{joinMsg}</p>}
          </div>
        )}

        {joinedCoach && (
          <div role="status" style={{ background: 'var(--success-light)', border: '1px solid var(--success-border)', borderRadius: 14, padding: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'var(--fs-5)', marginBottom: 6, color: 'var(--text)' }}>
              You&rsquo;ve joined your coach.
            </div>
            <p style={{ fontSize: 'var(--fs-3)', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              Anything they share with you will show up here, and you can check in and message them now.
            </p>
          </div>
        )}

        {/* Tabs (desktop only — mobile uses bottom nav) */}
        {!isMobile && (
          <div className="ah-dtabs">
            {([
              { key: 'home',     label: 'Home'     },
              { key: 'sessions', label: 'Sessions' },
              { key: 'messages', label: 'Messages' },
              { key: 'wellness', label: 'Wellness' },
              { key: 'calendar', label: 'Calendar' },
              { key: 'notes',    label: 'My Notes' },
            ] as { key: Tab; label: string }[]).map((t) => (
              <button
                key={t.key}
                className="ah-dtab"
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* ─── Tab: Home ─── */}
        {/* Stadium Night: the dispatch. Today's check-in as the hero over the
            twelve-week spine, then the coach's latest words set like a feature,
            with TAKE INTO NEXT SESSION as the brightest thing on the card. */}
        {tab === 'home' && (
          <div className="ah-home">

            {/* ── Greeting ── */}
            <div className="ah-hello">
              <h1>
                Welcome back,<br/>
                <em>{athleteName.split(' ')[0] || 'Athlete'}.</em>
              </h1>
              <p>
                {sessionsError
                  ? 'Your sessions did not load.'
                  : sessions.length === 0
                  ? 'Nothing from your coach yet.'
                  : `${sessions.length} session${sessions.length !== 1 ? 's' : ''} from your coach`}
              </p>
            </div>

            {/* ── Today: remember — ──
                The takeaway reminder, on a training day only. See the note on
                takeawayWhere: when this shows, the card below leaves the
                takeaway and the reply chips out, so they appear once. */}
            {takeawayWhere === 'top' && newestSession && newestTakeaway && (
              <TakeawayReminder
                takeaway={newestTakeaway}
                sessionTitle={newestSession.session_name ?? newestSession.title ?? 'Coaching session'}
                sessionHref={`/sessions/${newestSession.id}`}
                trainingTime={formatEventTime(trainingEvent?.event_time)}
                response={responseOption(newestSession.athlete_response)?.value ?? null}
                onRespond={(v) => { void respondToSession(newestSession.id, v) }}
              />
            )}

            {/* ── Today's check-in: the one thing to do here each day ──
                The metric bars keep the coach's colours (metricColor), so a
                score means the same thing on both sides of the app. The numeral
                is this athlete's own average for today and is never set beside
                anyone else's. */}
            {athleteId && (
              <section className="ah-panel ah-ci" aria-label="Today’s check-in">
                <div className="ah-ci-beam" aria-hidden />
                {todayWellness ? (() => {
                  // What she answered on the two-tap form, in its own words.
                  // Absent on rows from the old five-slider form.
                  const said = READINESS_OPTIONS.find((o) => o.value === todayWellness.readiness)?.label ?? null
                  const top = (
                    <div className="ah-ci-top">
                      <span className="ah-eyebrow">
                        {sessionToday ? 'Checked in for today’s session' : 'Checked in today'}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button className="ah-link" onClick={() => setTab('wellness')} style={TAP_INLINE}>
                        Trends →
                      </button>
                    </div>
                  )
                  /* A two-tap check-in is shown as what was said, not as five
                     numbers. lib/readiness.ts derives energy, mood, stress and
                     soreness from it so the coach's scoring keeps one code
                     path — but the athlete never gave those numbers, and
                     reading "Stress 3" and "Average today 3.8/5" back to a
                     child who tapped "OK" is putting words in their mouth. */
                  if (said) {
                    const sore = todayWellness.sore_areas ?? []
                    return (
                      <>
                        {top}
                        <div className="ah-ci-body">
                          <div className="ah-hero">
                            <div className="ah-score-lbl" style={{ marginTop: 0 }}>You said</div>
                            <div className="ah-score" style={{ marginTop: 8 }}>{said}</div>
                          </div>
                          <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 'var(--fs-3)', lineHeight: 1.5, color: 'var(--text)', overflowWrap: 'anywhere', alignSelf: 'center' }}>
                            {sore.length === 0
                              ? 'Nothing sore.'
                              : <><strong>Sore: </strong>{sore.map(regionLabel).join(', ')}</>}
                          </div>
                        </div>
                      </>
                    )
                  }
                  const overall = overallWellnessScore(todayWellness)
                  return (
                    <>
                      {top}
                      <div className="ah-ci-body">
                        {overall !== null && (
                          <div className="ah-hero">
                            <div className="ah-score">{overall.toFixed(1)}<span className="of">/5</span></div>
                            <div className="ah-score-lbl">Average today</div>
                          </div>
                        )}
                        {/* Every label spelled out in full, every track the
                            same length. See .ah-metrics. Legacy five-slider
                            rows only — those are numbers the athlete gave. */}
                        <div className="ah-metrics">
                          {WELLNESS_METRICS.map(({ key, label }) => {
                            const score = todayWellness[key] as number | null
                            const pct = score ? (score / 5) * 100 : 0
                            return (
                              <Fragment key={key}>
                                <span className="ah-m-lbl">{label}</span>
                                <span className="ah-track" aria-hidden>
                                  <i style={{ width: `${pct}%`, background: metricColor(key, score) }} />
                                </span>
                                <span className="ah-m-val">{score ?? '—'}</span>
                              </Fragment>
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )
                })() : (
                  <>
                    <div className="ah-ci-top">
                      <span className="ah-eyebrow">Daily check-in</span>
                      <span style={{ flex: 1 }} />
                      <span className="ah-when">
                        {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    {/* Same card, same form, one sentence of reason. The
                        coach asked for this before training starts, so say so
                        — an athlete who knows why answers more carefully than
                        one filling in a daily form. */}
                    <div className="ah-ask">How are you feeling today?</div>
                    {sessionToday && (
                      <p className="ah-ask-why">
                        You have a session with your coach today
                        {sessionToday.event_time ? ' at ' + sessionToday.event_time.slice(0, 5) : ''}. They have asked
                        you to check in first, so they know how your body is before you start.
                      </p>
                    )}
                    <button className="btn btn-primary ah-ci-go" onClick={() => setTab('wellness')}>
                      Check in
                    </button>
                    <div className="ah-ci-note">
                      {/* Was: "Your coach sees the scores, not who said what to
                          whom." That sentence describes messaging, not
                          wellness — and it was the only thing a 13-year-old
                          was told about where their health data goes. What
                          actually happens, verified in
                          app/api/wellness/route.ts:92-105: the coach can read
                          every score, and a low run emails them automatically. */}
                      Takes about twenty seconds. Your coach can see these scores, and if they stay low your coach gets an email.
                    </div>
                  </>
                )}

                {/* ── Training rhythm ──
                    Twelve weeks of work, so the athlete can see it
                    accumulating. The arithmetic is lib/training-spine.ts — the
                    same buildSpine the coach's profile draws — and the
                    same rules: nothing under three sessions, no streak, no
                    average, and the athlete is never told the gap since the
                    last session. The only lit bar is this week, because it is
                    now, not because it is big. */}
                {spine.total >= SPINE_MIN_SESSIONS && (() => {
                  const peak = Math.max(...spine.weeks, 1)
                  const sentence =
                    `${spine.total} session${spine.total === 1 ? '' : 's'} over ${SPINE_WEEKS} weeks` +
                    (spine.thisWeek > 0 ? ` · ${spine.thisWeek} this week` : '')
                  return (
                    <div className="ah-spine">
                      <div className="ah-bars" role="img" aria-label={`Training rhythm. ${sentence}.`}>
                        {spine.weeks.map((n, i) => (
                          <i
                            key={i}
                            className={i === spine.weeks.length - 1 ? 'now' : n > 0 ? undefined : 'zero'}
                            style={{ height: Math.max(3, Math.round((n / peak) * 26)) }}
                          />
                        ))}
                      </div>
                      {/* Numerals in mono: Big Shoulders' 1 is a bare stem, and
                          "12 weeks" set in it reads as "I2 weeks". */}
                      <div className="ah-spine-cap" aria-hidden>
                        Training rhythm · <span className="num">{spine.total}</span> session{spine.total === 1 ? '' : 's'} over{' '}
                        <span className="num">{SPINE_WEEKS}</span> weeks
                        {spine.thisWeek > 0 && <> · <span className="num">{spine.thisWeek}</span> this week</>}
                      </div>
                    </div>
                  )
                })()}
              </section>
            )}

            {/* ── Your availability ──
                Only when there is something open. It states the coach's
                decision plainly rather than softening it, because an athlete
                who has been marked out should not have to work that out from a
                euphemism — and it never uses the word injury as a verdict on
                them, only on a body part. */}
            {(() => {
              const open = openInjuries(injuries)
              if (open.length === 0) return null
              return (
                <section>
                  <div className="ah-sec"><h2>Your availability</h2></div>
                  <div className="ah-panel" style={{ padding: '14px 16px' }}>
                    {open.map((i, idx) => {
                      const opt = injuryStatusOption(i.status)
                      return (
                        <div key={i.id} style={idx === 0 ? undefined : { marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text)' }}>
                              {regionLabel(i.body_area)}
                            </span>
                            {opt && (
                              <span style={{
                                padding: '3px 10px', borderRadius: 999,
                                background: opt.tint, color: opt.color,
                                fontSize: 'var(--fs-1)', fontWeight: 800,
                              }}>
                                {opt.meaning}
                              </span>
                            )}
                          </div>
                          {i.expected_return && (
                            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 4 }}>
                              {/* Was the raw column — "back around 2026-10-04". */}
                              Your coach has you back around{' '}
                              {parseISODate(i.expected_return)
                                ?.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
                                .replace(',', '') ?? i.expected_return}.
                            </div>
                          )}
                        </div>
                      )
                    })}
                    <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 12, lineHeight: 1.5 }}>
                      Your coach set this. Talk to them if it does not match how you feel.
                    </div>
                  </div>
                </section>
              )
            })()}

            {/* ── The week, looked back on ──
                Shows by itself Sunday to Tuesday (lib/digest.ts) until hidden
                for the week; every other day, and after hiding, it is one tap
                away on the "Last week" row. A recap, so it sits under today's
                check-in and availability and above the coach's latest words. */}
            {athleteId && (digestAuto || digestOpen ? (
              <AthleteDigest
                digest={digest}
                mode={digestOpen ? 'opened' : 'auto'}
                onDismiss={hideDigest}
                onClose={() => setDigestOpen(false)}
              />
            ) : (
              <DigestLink digest={digest} onOpen={() => setDigestOpen(true)} />
            ))}

            {/* ── From your coach ──
                This is the reason the app exists. The newest session is set as
                the feature and opens in full; the two before it are hairline
                rows; the rest are one tap away on the Sessions tab. */}
            {sessions.length > 0 && (
              <section>
                <div className="ah-sec">
                  <h2>From your coach</h2>
                  <span style={{ flex: 1 }} />
                  {sessions.length > 3 && (
                    <button className="ah-link lit" onClick={() => setTab('sessions')} style={TAP_INLINE}>
                      All {sessions.length} →
                    </button>
                  )}
                </div>

                {(() => {
                  const s = sessions[0]
                  // One line per bullet, as the summariser writes them. Not in
                  // quotation marks: this is the model's summary of the
                  // recording, not words the coach said.
                  const bullets = (s.summary ?? '')
                    .split('\n')
                    .map((l) => l.replace(/^[•\s]+/, '').trim())
                    .filter(Boolean)
                  // The one thing to work on next. Everything else here recaps
                  // what happened; this is the only line that says what to do
                  // about it, so it belongs where the athlete already looks.
                  const points = s.focus_points
                  const next = Array.isArray(points) && typeof points[0] === 'string' && points[0].trim()
                    ? points[0].trim()
                    : null
                  return (
                    <a href={`/sessions/${s.id}`} className="ah-panel ah-dispatch">
                      <span className="ah-edge" aria-hidden />
                      <div className="ah-d-top">
                        <span className="ah-when">{formatSessionDate(s)}</span>
                        {/* The newest one is the only thing marked. In flow, so
                            the date line reserves exactly what the badge takes. */}
                        <span className="ah-new">Newest</span>
                      </div>
                      <h3 className="ah-d-title">{s.session_name ?? s.title ?? 'Coaching session'}</h3>
                      {bullets.length > 0 && (
                        <ul className="ah-d-body">
                          {bullets.map((b, j) => (
                            <li key={j}><span aria-hidden /><p>{b}</p></li>
                          ))}
                        </ul>
                      )}

                      {/* Pinned at the top as today's reminder instead —
                          said here so it never reads as missing. */}
                      {takeawayWhere === 'top' && (
                        <p style={{ margin: '14px 0 0', fontSize: 'var(--fs-2)', lineHeight: 1.45, color: 'var(--text-2)' }}>
                          Your takeaway from this session is at the top of the page for today&rsquo;s training.
                        </p>
                      )}

                      {next && takeawayWhere !== 'top' && (
                        <div className="ah-take">
                          <div className="k">Take into next session</div>
                          <div className="v">{next}</div>
                        </div>
                      )}

                      {/* ── Answer your coach ──
                          The first thing an athlete can say back in this
                          product. Everything else here is the coach speaking.

                          Buttons inside a link, so each one stops the card's
                          navigation: tapping a chip must answer, not open the
                          session. Only on the newest session — a list of old
                          sessions each asking to be rated is homework, and the
                          point of this is that it costs ten seconds once. */}
                      {takeawayWhere !== 'top' && (
                      <div className="ah-reply" onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
                        <div className="ah-eyebrow">
                          {s.athlete_response ? 'You told your coach' : 'Tell your coach'}
                        </div>
                        <div className="ah-chips">
                          {SESSION_RESPONSES.map((opt) => {
                            const on = s.athlete_response === opt.value
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                className="ah-chip"
                                aria-pressed={on}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void respondToSession(s.id, opt.value) }}
                              >
                                <i aria-hidden>
                                  {on && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12.5 10 17.5 19 7" /></svg>
                                  )}
                                </i>
                                {opt.label}
                              </button>
                            )
                          })}
                        </div>
                        <p>
                          {s.athlete_response
                            ? 'Your coach can see this. Tap again to undo.'
                            : 'One tap. Your coach sees which one you picked, and nothing else.'}
                        </p>
                      </div>
                      )}

                      <div className="ah-d-foot">
                        {s.audio_path && (
                          <span className="ah-audio">
                            <AthleteIcon name="mic" size={14} strokeWidth={2.4} />
                            Audio
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto' }}>Read session →</span>
                      </div>
                    </a>
                  )
                })()}

                {sessions.length > 1 && (
                  <div style={{ marginTop: 6 }}>
                    {sessions.slice(1, 3).map((s) => (
                      <a key={s.id} href={`/sessions/${s.id}`} className="ah-row">
                        <div className="ah-row-top">
                          <span className="ah-when">{formatSessionDate(s)}</span>
                          {s.audio_path && (
                            <span className="ah-audio" style={{ marginLeft: 'auto' }}>
                              <AthleteIcon name="mic" size={14} strokeWidth={2.4} />
                              Audio
                            </span>
                          )}
                        </div>
                        <div className="ah-row-title">{s.session_name ?? s.title ?? 'Coaching session'}</div>
                        {s.summary && (
                          <div className="ah-row-sum">{s.summary.replace(/^[•\s]+/, '')}</div>
                        )}
                        <div className="ah-row-go">Read session →</div>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Private notes ── */}
            <button className="ah-note" onClick={() => setTab('notes')}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)', flexShrink: 0 }}>
                <AthleteIcon name="pencil" size={14} strokeWidth={2} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                Add a private note
                {notes.length > 0 && <span style={{ color: 'var(--text-2)', fontWeight: 500 }}> · {notes.length} saved</span>}
              </span>
              <span className="ah-audio" style={{ flexShrink: 0 }}>
                <AthleteIcon name="mic" size={14} strokeWidth={2.4} /> Voice
              </span>
            </button>

          </div>
        )}

        {/* ─── Tab: Sessions ─── */}
        {tab === 'sessions' && (
          <div>
            {/* Clips for the coach — the athlete's one way to send video the
                other way. A general clip here; a clip about one session is
                sent from inside that session below. */}
            {athleteId && (
              <div className="ah-panel" style={{ padding: '14px 16px', marginBottom: 16, minWidth: 0 }}>
                <div className="ah-sec" style={{ margin: '0 0 10px' }}><h2>Clips for your coach</h2></div>
                <AthleteClipUpload athleteId={athleteId} />
              </div>
            )}
            {/* The newest session used to be repeated in a hero card directly
                above the list that starts with it. Home surfaces what's new;
                this tab is the full record, so it's just the record. */}
            {sessions.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
                <div className="ah-sec" style={{ margin: 0 }}><h2>From your coach</h2></div>
                <div className="ah-eyebrow" style={{ letterSpacing: '0.14em' }}>
                  <span className="num">{sessions.length}</span> session{sessions.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}
            {/* Said plainly, because it is true: opening a session is logged
                for the coach (lib/access-log.ts). A young athlete should not
                find that out later. */}
            {sessions.length > 0 && (
              <p style={{ margin: '0 0 12px', fontSize: 'var(--t-body-tight)', lineHeight: 1.45, color: 'var(--text-2)' }}>
                Your coach can see when you&apos;ve opened a session, so they know it reached you.
              </p>
            )}

            {sessionsError ? (
              <ListState
                loading={false}
                error={sessionsError}
                isEmpty={false}
                emptyTitle=""
                onRetry={() => { void loadPortal({ quiet: true }) }}
              />
            ) : sessions.length === 0 ? (
              <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                <div style={{ color: 'var(--text-muted)', display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <AthleteIcon name="book" size={30} strokeWidth={1.5} />
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text)', marginBottom: 6 }}>
                  No sessions yet
                </div>
                <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-3)', maxWidth: 290, margin: '0 auto', lineHeight: 1.6 }}>
                  After a training session your coach records their notes here. You&rsquo;ll see the summary, and can play back what they said.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sessions.map((s) => {
                  const isOpen = openSession === s.id
                  const sNotes = notes.filter((n) => n.session_id === s.id)
                  const sVideos = sessionVideos[s.id] ?? []

                  return (
                    <div key={s.id} className="ah-panel">
                      {/* Session header */}
                      <button
                        onClick={() => openSessionToggle(s.id)}
                        style={{
                          width: '100%',
                          padding: '16px 18px',
                          minHeight: 72,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {/* minWidth: 0 on both, so a long session name wraps
                            inside this group instead of setting a floor under
                            it. The card clips (overflow: hidden), so anything
                            this group pushes past the card's edge — the chevron
                            included — is cut rather than scrolled to. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                          {/* Was an emoji microphone in a gradient tile. The
                              coach side uses drawn icons throughout; matching
                              that keeps one visual language across both. */}
                          <div style={{ width: 40, height: 40, borderRadius: 11, background: isOpen ? 'var(--primary)' : 'var(--athlete-light)', color: isOpen ? 'var(--on-primary)' : 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.18s ease' }}>
                            <AthleteIcon name="mic" size={17} strokeWidth={2} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="ah-cast" style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.12, letterSpacing: '0.03em', color: 'var(--text)', overflowWrap: 'anywhere' }}>{s.session_name ?? s.title ?? 'Session'}</div>
                            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{formatSessionDate(s)}</span>
                              {s.sport_context && <span>· {s.sport_context}</span>}
                              {sNotes.length > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  · <AthleteIcon name="pencil" size={10} strokeWidth={2.2} /> {sNotes.length}
                                </span>
                              )}
                              {sVideos.length > 0 && (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  · <AthleteIcon name="video" size={10} strokeWidth={2.2} /> {sVideos.length}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: isOpen ? 'var(--primary)' : 'var(--border-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', flexShrink: 0 }}>
                          <span aria-hidden style={{ color: isOpen ? 'var(--on-primary)' : 'var(--text)', fontSize: 'var(--fs-1)', fontWeight: 900, lineHeight: 1 }}>{isOpen ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {/* Session body */}
                      {isOpen && (
                        <div style={{ padding: '0 18px 20px', borderTop: '1px solid var(--line)' }}>
                          {/* Full session — focus points, images and coach notes
                              live on the session page, not in this quick view. */}
                          <a
                            href={`/sessions/${s.id}`}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              gap: 8, marginTop: 14, padding: '11px 13px', minHeight: 44, borderRadius: 10,
                              background: 'var(--primary-light)', color: 'var(--primary)',
                              textDecoration: 'none', fontSize: 'var(--fs-3)', fontWeight: 700,
                            }}
                          >
                            Open full session
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                            </svg>
                          </a>

                          {/* Recording from the session */}
                          {s.audio_path && (
                            <div style={{ marginTop: 16 }}>
                              <div className="ah-eyebrow" style={{ color: 'var(--coach-on-light)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--coach-on-light)', display: 'inline-block' }} />
                                Recording
                              </div>
                              <SessionAudioPlayer sessionId={s.id} mime={s.audio_mime ?? null} />
                            </div>
                          )}

                          {/* Coach summary */}
                          {s.summary && (
                            <div style={{ marginTop: 16 }}>
                              <div className="ah-eyebrow" style={{ color: 'var(--coach-on-light)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--coach-on-light)', display: 'inline-block' }} />
                                Coach Summary
                              </div>
                              <div className="coach-summary" style={{ whiteSpace: 'pre-wrap' }}>
                                {s.summary}
                              </div>
                            </div>
                          )}

                          {/* Full transcript — individual sessions only.
                              A squad recording is the coach talking to the
                              whole group and routinely names other athletes,
                              so it is never sent here. The summary above was
                              written for this athlete alone. */}
                          {s.group_id ? (
                            <div style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', marginTop: 12, lineHeight: 1.6 }}>
                              This was a squad session. Your summary above is yours — the full
                              recording is your coach talking to the whole group, so it stays
                              with them.
                            </div>
                          ) : (
                            <details style={{ marginTop: 12 }} onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void loadTranscript(s.id) }}>
                              <summary style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text-2)', cursor: 'pointer', padding: '12px 0', minHeight: 44 }}>
                                View full transcript
                              </summary>
                              <div style={{ fontSize: 'var(--fs-3)', lineHeight: 1.7, color: 'var(--text-2)', marginTop: 8, padding: '12px 14px', background: 'var(--border-soft)', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
                                {transcriptBusy === s.id
                                  ? 'Loading…'
                                  : transcripts[s.id] ?? 'No transcript was saved for this session.'}
                              </div>
                            </details>
                          )}

                          {/* Videos */}
                          {sVideos.some((v) => v.uploaded_by_role !== 'athlete') && (
                            <div style={{ marginTop: 16 }}>
                              <div className="ah-eyebrow" style={{ marginBottom: 10 }}>
                                Videos from your coach ({sVideos.filter((v) => v.uploaded_by_role !== 'athlete').length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {/* The athlete's own clips are listed under "Show
                                    your coach" below, with their status, and
                                    refresh there after a send — not twice. */}
                                {sVideos.filter((v) => v.uploaded_by_role !== 'athlete').map((v) => v.signedUrl && (
                                  <div key={v.id} style={{ minWidth: 0 }}>
                                  <VideoAnnotator
                                    videoUrl={v.signedUrl}
                                    initialAnnotations={v.annotations ?? []}
                                    sessionId={v.session_id}
                                    videoId={v.id}
                                    /* Read-only, because that is what it has always
                                     * been.
                                     *
                                     * The drawing tools were wired up under a comment
                                     * reading "FIX 3: athletes can now annotate", and
                                     * the PATCH they save through requires
                                     * coach_id === user.id — so every stroke an
                                     * athlete drew 403'd, silently until this release
                                     * and with an error message after it. The control
                                     * has never once worked.
                                     *
                                     * Enabling it is not a permission tweak: coach and
                                     * athlete would share one `annotations` column, so
                                     * an athlete saving would erase their coach's
                                     * marks. If athlete annotations are wanted they
                                     * need their own column and their own decision
                                     * about who sees them. Until then this shows the
                                     * coach's drawings, which is the point of the
                                     * feature for the athlete anyway. */
                                    readOnly
                                  />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Send the coach a clip about this session. Only on a
                              session the coach has shared, which is every one
                              this list shows — the route checks it again. */}
                          {athleteId && s.shared_with_athlete && (
                            <div style={{ marginTop: 16 }}>
                              <div className="ah-eyebrow" style={{ marginBottom: 8 }}>Show your coach</div>
                              <AthleteClipUpload athleteId={athleteId} sessionId={s.id} />
                            </div>
                          )}

                          {/* My private notes for this session */}
                          <div style={{ marginTop: 20 }}>
                            {/* Wraps rather than squeezing: at 13/14px the two
                                together measure more than a 320px card, and
                                neither of them is droppable. */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                              <div className="ah-eyebrow">
                                My Private Notes
                              </div>
                              <span style={{ fontSize: 'var(--fs-1)', color: 'var(--text-2)' }}>Only you can see these</span>
                            </div>

                            {sNotes.map((n) => (
                              <NoteCard
                                key={n.id}
                                note={n}
                                editId={noteEditId}
                                editText={noteEditText}
                                onStartEdit={() => { setNoteEditId(n.id); setNoteEditText(n.content) }}
                                onEditChange={setNoteEditText}
                                onSaveEdit={() => updateNote(n.id)}
                                onCancelEdit={() => setNoteEditId(null)}
                                onDelete={() => deleteNote(n.id)}
                              />
                            ))}

                            {/* Add note inline */}
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <textarea
                                className="input"
                                placeholder="Add a private note about this session…"
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                rows={2}
                                style={{ flex: 1, minWidth: 0 }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <button
                                  className="btn btn-athlete"
                                  onClick={() => saveNote(s.id)}
                                  disabled={noteSaving || !noteText.trim()}
                                  style={{ padding: '8px 12px', fontSize: 'var(--fs-3)' }}
                                >
                                  {noteSaving ? '…' : 'Save'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Tab: Messages ───
            Stadium Night, the athlete's side of the thread (snE-2). She has
            exactly one correspondent, so there is no list, no search and no
            back button: the room goes to who she is talking to, under the
            coach's ember rule, and to the thread.

            Voice picks the type, not direction — the same rule MessagingPanel
            follows on the coach's side, so a bubble reads the same in both
            apps. The coach's words are set in Newsreader on the ember tint;
            hers are in Plus Jakarta on the card with a sage edge. There is no
            floodlight here: unread is the only thing that may wear it, and the
            athlete side has no unread source (see the header button). */}
        {tab === 'messages' && (() => {
          // Day dividers, so each message carries only its clock time.
          // created_at is nullable in the schema; a row without one gets no
          // divider and no time rather than one stamped 1970.
          const thread: ({ kind: 'day'; key: string; label: string } | { kind: 'msg'; msg: MessageRow })[] = []
          let lastDay = ''
          for (const m of messages) {
            if (m.created_at) {
              const day = new Date(m.created_at).toDateString()
              if (day !== lastDay) {
                thread.push({ kind: 'day', key: 'day-' + day, label: fmtDateDivider(m.created_at) })
                lastDay = day
              }
            }
            thread.push({ kind: 'msg', msg: m })
          }
          return (
          <div style={{ maxWidth: 620 }}>
            <div className="ah-corr">
              <span className="ah-edge" aria-hidden />
              <h2 className="nm">Your coach</h2>
              <div className="sub">All messages between you and your coach stay private here.</div>
            </div>

            {/* Message list */}
            <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14, minHeight: 120 }}>
              {msgLoading && <div style={{ textAlign: 'center', color: 'var(--text-2)', fontSize: 'var(--fs-3)', padding: 20 }}>Loading…</div>}
              {!msgLoading && messages.length === 0 && (
                <ListState
                  loading={false}
                  error={msgLoadError}
                  isEmpty={!msgLoadError}
                  emptyTitle="No messages yet."
                  emptyHint="Send your coach a message below."
                  compact
                  onRetry={msgLoadError ? () => { void loadMessages() } : undefined}
                />
              )}
              {thread.map((item) => {
                if (item.kind === 'day') {
                  return (
                    <div key={item.key} className="ah-day"><i aria-hidden />{item.label}<i aria-hidden /></div>
                  )
                }
                const { msg } = item
                const isAthlete = msg.sender_role === 'athlete'
                // Bound once so the narrowing survives into the onClick
                // closure below — inside a callback TypeScript can no longer
                // prove the field is still non-null, and it is right to
                // insist: `messages` is state and could be replaced mid-click.
                const mediaUrl = msg.media_url
                return (
                  <div key={msg.id} className={isAthlete ? 'ah-msg out' : 'ah-msg in'}>
                    <div className={msg.msg_type === 'text' ? 'ah-bub' : 'ah-bub media'}>
                      {msg.msg_type === 'text' && <span>{msg.content}</span>}
                      {msg.msg_type === 'image' && msg.media_url && <img src={msg.media_url} alt="image" style={{ maxWidth: 'min(240px, 100%)', maxHeight: 200, borderRadius: 10, display: 'block', cursor: 'pointer' }} onClick={() => { if (mediaUrl) window.open(mediaUrl, '_blank') }} />}
                      {msg.msg_type === 'video' && msg.media_url && <video src={msg.media_url} controls style={{ maxWidth: 'min(280px, 100%)', maxHeight: 180, borderRadius: 10, display: 'block' }} />}
                      {msg.msg_type === 'audio' && msg.media_url && (
                        <div style={{ padding: '6px 4px' }}>
                          <div className="ah-vlabel">Voice message</div>
                          <audio controls src={msg.media_url} style={{ display: 'block', height: 40, width: 240, maxWidth: '100%' }} />
                        </div>
                      )}
                    </div>
                    <div className="ah-stamp">
                      {/* created_at is nullable in the schema, and
                          `new Date(null)` is the epoch — a message stamped
                          01:00 in 1970 rather than an empty slot. */}
                      {msg.created_at
                        ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : ''}
                    </div>
                  </div>
                )
              })}
              <div ref={msgBottomRef} />
            </div>

            {/* A failed send says so, above the box that still holds the text. */}
            {msgSendError && (
              <div
                role="alert"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                  padding: '4px 4px 4px 12px', borderRadius: 14,
                  background: 'var(--danger-light)', border: '1px solid var(--danger)', fontSize: 'var(--fs-3)',
                  color: 'var(--text)', lineHeight: 1.45,
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0, color: 'var(--danger)' }}>⚠</span>
                <span style={{ flex: 1, minWidth: 0, padding: '8px 0', overflowWrap: 'anywhere' }}>
                  {msgSendError} <strong>Your coach has not seen this yet.</strong>
                </span>
                <button
                  onClick={() => setMsgSendError(null)}
                  aria-label="Dismiss"
                  style={{
                    minWidth: 44, minHeight: 44, border: 'none', background: 'transparent',
                    cursor: 'pointer', fontSize: 18, color: 'var(--text-2)', flexShrink: 0,
                  }}
                >×</button>
              </div>
            )}

            {/* Input — held above the floating nav while the thread scrolls,
                so there is always somewhere to answer. */}
            <div className="ah-composer" style={{ bottom: isMobile ? 'calc(84px + env(safe-area-inset-bottom))' : 16 }}>
              <button
                title="Attach photo or video"
                aria-label="Attach photo or video"
                className="ah-cbtn"
                onClick={() => msgFileInputRef.current?.click()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
              </button>
              <input ref={msgFileInputRef} type="file" accept="image/*,video/*,audio/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMsgMedia(f); e.target.value = '' }} />
              <textarea
                aria-label="Message your coach"
                placeholder="Type a message…"
                value={msgText}
                onChange={(e) => { setMsgText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
                /* See MessagingPanel: Enter-to-send with no Shift key made a
                 * paragraph break impossible on a phone. This side matters more
                 * — it is a teenager writing to an adult about training, and
                 * they should be able to write more than one paragraph. */
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return
                  if (isTouch) return
                  e.preventDefault()
                  sendMessage()
                }}
                enterKeyHint={isTouch ? 'enter' : 'send'}
                autoCapitalize="sentences"
                autoCorrect="on"
                spellCheck
                maxLength={4000}
                rows={1}
              />
              <button
                onClick={sendMessage}
                disabled={!msgText.trim() || msgSending}
                aria-label="Send"
                className={msgText.trim() ? 'ah-cbtn go' : 'ah-cbtn'}
              >↑</button>
            </div>
          </div>
          )
        })()}

        {/* ─── Tab: Wellness ─── */}
        {tab === 'wellness' && athleteId && (
          <div style={{ maxWidth: 520 }}>
            {/* The history goes above the form on purpose: this tab is reached
                from a control labelled "Trends →", and it used to answer that
                with a blank form and nothing else. */}
            {/* …once they have checked in today. Before that, the check-in
                goes first: the history panel pushed Done below the fold on a
                390x844 phone, and "Check in" (nav) and the home card's Check
                in button both land here. "Trends →" only shows after a
                check-in, so it still opens on the history. */}
            {todayWellness && <WellnessHistory rows={wellnessHistory} />}
            {/* Two taps, attached to the session when the coach scheduled one.
                sessionToday is already resolved above from the calendar; when
                it is null the athlete is checking in proactively, which is
                explicitly allowed — a coach forgetting to schedule must not
                cost the signal. */}
            <CheckIn
              athleteId={athleteId}
              sessionEventId={sessionToday?.id ?? null}
              sessionLabel={sessionToday?.title ?? null}
              openInjuries={openInjuries(injuries).map((i) => ({ id: i.id, body_area: i.body_area, status: i.status }))}
              initial={todayWellness}
              // Was `() => {}`. Because nothing re-read the data after a save,
              // an athlete could check in and then find the home card still
              // asking them to check in — the app refusing to acknowledge, in
              // the same session, something it had just stored.
              onSaved={() => { void loadWellness() }}
            />
            {!todayWellness && <div style={{ marginTop: 14 }}><WellnessHistory rows={wellnessHistory} /></div>}
          </div>
        )}

        {/* ─── Tab: Calendar ─── */}
        {tab === 'calendar' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Daily quote */}
            <p className="quote-strip">&quot;{getDailyQuote('athlete')}&quot;</p>

          <div className="ah-panel" style={{ padding: 18, overflow: 'visible' }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div className="section-title">My Calendar</div>
                <div className="section-sub">
                  Coach-scheduled events (in blue/coloured) plus your own personal entries. Coaches only see what they&apos;ve added.
                </div>
              </div>
              {calSaveMsg && (
                <div style={{
                  fontSize: 'var(--fs-3)', fontWeight: 700,
                  color: calSaveMsg.includes('Failed') ? 'var(--danger)' : 'var(--success)',
                  background: calSaveMsg.includes('Failed') ? 'var(--danger-light)' : 'var(--success-light)',
                  border: `1px solid ${calSaveMsg.includes('Failed') ? 'var(--danger)' : 'var(--success)'}`,
                  borderRadius: 8, padding: '6px 12px',
                }}>
                  {calSaveMsg.includes('Failed') ? '' : '✓ '}{calSaveMsg}
                </div>
              )}
            </div>
            {/* The `!athleteId` branch is a real empty state and stays. The
                `calLoading` branch that used to sit in front of it did not:
                it unmounted the calendar on every month change and threw away
                the month just chosen. See lib/calendar-month.ts. */}
            {calError && (
              <div style={{ background: 'var(--danger-light)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-2)', fontWeight: 600, marginBottom: 12 }}>
                {calError}
              </div>
            )}
            {!athleteId ? (
              <div style={{ textAlign: 'center', color: 'var(--text-2)', padding: 32 }}>Connect to a coach first to see your calendar.</div>
            ) : (
              <Calendar
                events={calEvents}
                role="athlete"
                month={calMonth}
                loading={calLoading}
                onAddEvent={(date) => setAddEventModal(date)}
                onDeleteEvent={deleteCalEvent}
                onMonthChange={setCalMonth}
              />
            )}

            {/* RSVP Section */}
            {rsvpEvents.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Events needing your response</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rsvpEvents.map((evt) => {
                    const status = rsvpMap[evt.id]
                    return (
                      // The three answers drop onto their own line rather than
                      // being crushed against the event title. On a 320px
                      // screen the row measured 357px wide — 37px of it, most
                      // of the "✗ No" button, sat past the right edge of the
                      // viewport where the horizontal clip makes it invisible
                      // rather than reachable. The buttons had also been
                      // squeezed narrower than their own labels, so "✗ No" was
                      // stacking its tick above its word.
                      <div key={evt.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, overflowWrap: 'anywhere' }}>{evt.title}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-1)', color: 'var(--text-2)' }}>{(parseISODate(evt.event_date) ?? new Date(evt.event_date)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{evt.event_time ? ` at ${evt.event_time}` : ''}</div>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {(['yes', 'maybe', 'no'] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => sendRsvp(evt.id, s)}
                              style={{
                                padding: '5px 12px', minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap',
                                borderRadius: 6, border: '1.5px solid',
                                borderColor: status === s ? (s === 'yes' ? 'var(--success)' : s === 'no' ? 'var(--danger)' : 'var(--warning)') : 'var(--border)',
                                background: status === s ? (s === 'yes' ? 'var(--success-light)' : s === 'no' ? 'var(--danger-light)' : 'var(--warning-light)') : 'transparent',
                                color: status === s ? (s === 'yes' ? 'var(--success)' : s === 'no' ? 'var(--danger)' : 'var(--warning)') : 'var(--text-2)',
                                fontWeight: status === s ? 700 : 400, fontSize: 'var(--fs-2)', cursor: 'pointer',
                              }}
                            >
                              {s === 'yes' ? '✓ Going' : s === 'maybe' ? '? Maybe' : '✗ No'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          </div>
        )}

        {/* ─── Tab: All Notes ─── */}
        {tab === 'notes' && (
          <div style={{ display: isMobile ? 'flex' : 'grid', flexDirection: isMobile ? 'column' : undefined, gridTemplateColumns: isMobile ? undefined : '220px 1fr', gap: isMobile ? 12 : 20 }}>
            {/* Filter sidebar */}
            <div className="card" style={{ padding: 16, height: 'fit-content' }}>
              {!isMobile && <div style={{ fontSize: 'var(--fs-3)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>Filter by session</div>}
              {isMobile && <div style={{ fontSize: 'var(--fs-2)', fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Filter by session</div>}
              <div style={isMobile ? { display: 'flex', flexWrap: 'wrap', gap: 6 } : undefined}>
                <button
                  onClick={() => setNoteFilter(null)}
                  style={{
                    display: isMobile ? 'inline-block' : 'block',
                    width: isMobile ? 'auto' : '100%',
                    // 11px, not 6: at 15px a 6px pad gave a 37px control,
                    // under the 44px touch minimum.
                    padding: isMobile ? '11px 12px' : '9px 12px',
                    borderRadius: 8,
                    border: `1.5px solid ${!noteFilter ? 'var(--athlete-color)' : 'var(--border)'}`,
                    background: !noteFilter ? 'var(--athlete-light)' : 'transparent',
                    color: !noteFilter ? 'var(--athlete-color)' : 'var(--text)',
                    fontWeight: !noteFilter ? 700 : 400,
                    fontSize: 'var(--fs-3)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    marginBottom: isMobile ? 0 : 6,
                  }}
                >
                  All notes ({notes.length})
                </button>
                {sessions.map((s) => {
                  const count = notes.filter((n) => n.session_id === s.id).length
                  if (count === 0) return null
                  return (
                    <button
                      key={s.id}
                      onClick={() => setNoteFilter(s.id)}
                      style={{
                        display: isMobile ? 'inline-block' : 'block',
                        width: isMobile ? 'auto' : '100%',
                        padding: isMobile ? '11px 12px' : '9px 12px',
                        borderRadius: 8,
                        border: `1.5px solid ${noteFilter === s.id ? 'var(--athlete-color)' : 'var(--border)'}`,
                        background: noteFilter === s.id ? 'var(--athlete-light)' : 'transparent',
                        color: noteFilter === s.id ? 'var(--athlete-color)' : 'var(--text)',
                        fontWeight: noteFilter === s.id ? 700 : 400,
                        fontSize: 'var(--fs-3)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        marginBottom: isMobile ? 0 : 4,
                        // A session name the coach typed without spaces has no
                        // wrap opportunity, and this button is sized by its
                        // content — so it ran off the side of the screen, where
                        // the horizontal clip hides it rather than letting the
                        // athlete scroll to it. Break it instead of losing it.
                        maxWidth: '100%',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {s.session_name ?? 'Session'} ({count})
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Notes list */}
            <div>
              {/* Add note form */}
              <div className="card" style={{ padding: 20, marginBottom: 16 }}>
                <div className="section-title" style={{ marginBottom: 6, fontSize: 'var(--fs-4)' }}>Add a note</div>
                <div className="section-sub" style={{ marginBottom: 12 }}>
                  Your notes are 100% private — coaches cannot see them.
                </div>
                <textarea
                  className="input"
                  placeholder="Write a note about your training, how you felt, what you want to remember…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  style={{ marginBottom: 10 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-athlete btn-lg"
                    onClick={() => saveNote(noteFilter)}
                    disabled={noteSaving || !noteText.trim()}
                    style={{ flex: 1 }}
                  >
                    {noteSaving ? 'Saving…' : '✍️ Save note'}
                  </button>
                  <button
                    className={`btn ${noteRecording ? 'btn-danger' : 'btn-ghost'}`}
                    onClick={noteRecording ? stopNoteRecording : startNoteRecording}
                    disabled={noteTranscribing}
                    style={{ gap: 6 }}
                  >
                    {noteTranscribing ? '…transcribing' : noteRecording ? <><span className="recording-dot" /> Stop recording</> : '🎙️ Voice note'}
                  </button>
                </div>

                {noteError && (
                  <div
                    role="alert"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
                      padding: '10px 12px', borderRadius: 10,
                      background: 'var(--danger-light)', color: 'var(--text)',
                      fontSize: 'var(--fs-3)', lineHeight: 1.45,
                    }}
                  >
                    <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
                    <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{noteError}</span>
                    <button
                      onClick={() => setNoteError(null)}
                      aria-label="Dismiss"
                      style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, color: 'var(--text-2)', flexShrink: 0 }}
                    >×</button>
                  </div>
                )}
              </div>

              {notesError ? (
                <ListState
                  loading={false}
                  error={notesError}
                  isEmpty={false}
                  emptyTitle=""
                  onRetry={() => { void loadPortal({ quiet: true }) }}
                />
              ) : filteredNotes.length === 0 ? (
                <div className="card" style={{ padding: 40, textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-2)', display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                    <AthleteIcon name="pencil" size={28} strokeWidth={1.5} />
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text)', marginBottom: 6 }}>No notes yet</div>
                  <div style={{ color: 'var(--text-2)', fontSize: 'var(--t-body-tight)' }}>Your private notes will appear here.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filteredNotes.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      editId={noteEditId}
                      editText={noteEditText}
                      onStartEdit={() => { setNoteEditId(n.id); setNoteEditText(n.content) }}
                      onEditChange={setNoteEditText}
                      onSaveEdit={() => updateNote(n.id)}
                      onCancelEdit={() => setNoteEditId(null)}
                      onDelete={() => deleteNote(n.id)}
                      showSession={!noteFilter}
                      sessions={sessions}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Add Calendar Event Modal */}
      {addEventModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(21,25,22,0.78)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 }}>
          <div className="card-lg" style={{ width: '100%', maxWidth: 420, padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div className="section-title" style={{ fontSize: 17 }}>Add Personal Event</div>
                <div className="section-sub">
                  {new Date(addEventModal + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <button onClick={() => setAddEventModal(null)} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '-11px -11px -11px 0', flexShrink: 0 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label className="label">Title *</label>
                <input className="input" placeholder="e.g. Rest day, Self-training, Goal check" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} autoFocus />
              </div>
              <div>
                <label className="label">Type</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['reminder', 'goal', 'other'].map((t) => (
                    <button key={t} onClick={() => setEventForm({ ...eventForm, event_type: t })} className={`badge badge-${t}`} style={{ cursor: 'pointer', border: `1.5px solid ${eventForm.event_type === t ? 'currentColor' : 'transparent'}`, padding: '5px 12px', minHeight: 44, fontSize: 'var(--fs-2)' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Time (optional)</label>
                <input className="input" type="time" value={eventForm.event_time} onChange={(e) => setEventForm({ ...eventForm, event_time: e.target.value })} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input" rows={2} value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} />
              </div>
            </div>
            {calSaveMsg && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: calSaveMsg.includes('added') ? 'var(--success-light)' : 'var(--danger-light)', color: calSaveMsg.includes('added') ? 'var(--success)' : 'var(--danger)', fontSize: 'var(--fs-3)', fontWeight: 600 }}>
                {calSaveMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="btn btn-ghost" onClick={() => { setAddEventModal(null); setCalSaveMsg('') }} style={{ flex: 1 }}>Cancel</button>
              <button className="btn btn-athlete btn-lg" onClick={saveCalendarEvent} disabled={eventSaving || !eventForm.title.trim()} style={{ flex: 2 }}>
                {eventSaving ? 'Saving…' : 'Add event'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════ MOBILE BOTTOM NAV ════════
          Floating, five equal tracks, the Stadium Night nav. Check in is a
          tab like the others now rather than a raised button in the middle:
          the pulse glyph still marks it, and it lights up when you are on it,
          which the old centre button never did.

          minmax(0, 1fr), not 1fr: a bare 1fr takes its longest word as a
          minimum, so CALENDAR and MESSAGES would widen their tracks and shunt
          the row off a 320px screen. The tracks are equal and every label
          renders in full. The tab you are on carries the floodlight bar. */}
      {isMobile && (
        <>
          <div className="ah-veil" aria-hidden />
          <nav className="ah-nav" aria-label="Sections">
            {([
              { key: 'home'     as Tab, icon: 'home',     label: 'Today'    },
              { key: 'sessions' as Tab, icon: 'book',     label: 'Sessions' },
              { key: 'wellness' as Tab, icon: 'pulse',    label: 'Check in' },
              { key: 'calendar' as Tab, icon: 'calendar', label: 'Calendar' },
              { key: 'messages' as Tab, icon: 'messages', label: 'Messages' },
            ]).map((item) => {
              const active = tab === item.key
              return (
                <button
                  key={item.key}
                  className="ah-tab"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setTab(item.key)}
                >
                  <AthleteIcon name={item.icon} size={20} strokeWidth={active ? 2.2 : 1.8} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </>
      )}
    </div>
  )
}

// ── Note card component ───────────────────────────────────────
function NoteCard({
  note, editId, editText, onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onDelete, showSession, sessions,
}: {
  note: AthleteNote
  editId: string | null
  editText: string
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  showSession?: boolean
  sessions?: { id: string; session_name: string | null }[]
}) {
  const isEditing = editId === note.id
  // Private notes have no undo and no copy anywhere else — the coach cannot
  // see them, so nobody can restore one. A one-tap Delete beside Edit lost a
  // note to a mis-tap. Two steps, inline.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const sessionName = showSession && sessions ? sessions.find((s) => s.id === note.session_id)?.session_name : null

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: isEditing ? 10 : 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-1)', color: 'var(--text-2)' }}>
            {new Date(note.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          {note.note_type === 'voice' && <span className="badge badge-session" style={{ fontSize: 'var(--fs-1)' }}>🎙️ Voice</span>}
          {/* Same reason as the filter button above: the badge is content-sized
              and a spaceless session name took it past the edge of the screen. */}
          {sessionName && <span className="badge badge-athlete" style={{ fontSize: 'var(--fs-1)', maxWidth: '100%', overflowWrap: 'anywhere' }}>{sessionName}</span>}
        </div>
        {!isEditing && !confirmDelete && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn btn-ghost" onClick={onStartEdit} style={{ padding: '4px 8px', minHeight: 44, fontSize: 'var(--fs-2)' }}>Edit</button>
            <button className="btn btn-danger" onClick={() => setConfirmDelete(true)} style={{ padding: '4px 8px', minHeight: 44, fontSize: 'var(--fs-2)' }}>Delete</button>
          </div>
        )}
      </div>

      {!isEditing && confirmDelete && (
        <div role="group" aria-label="Delete this note?" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, padding: '8px 10px', borderRadius: 10, background: 'var(--danger-light)' }}>
          <span style={{ flex: '1 1 120px', minWidth: 0, fontSize: 'var(--fs-3)', fontWeight: 600, color: 'var(--text)' }}>Delete this note?</span>
          <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)} style={{ minHeight: 44, fontSize: 'var(--fs-3)' }} autoFocus>Keep</button>
          <button className="btn btn-danger" onClick={() => { setConfirmDelete(false); onDelete() }} style={{ minHeight: 44, fontSize: 'var(--fs-3)' }}>Yes, delete</button>
        </div>
      )}

      {isEditing ? (
        <>
          <textarea className="input" value={editText} onChange={(e) => onEditChange(e.target.value)} rows={3} autoFocus style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-athlete" onClick={onSaveEdit} disabled={!editText.trim()} style={{ flex: 1 }}>Save</button>
            <button className="btn btn-ghost" onClick={onCancelEdit} style={{ flex: 1 }}>Cancel</button>
          </div>
        </>
      ) : (
        <div className="note-content">{note.content}</div>
      )}
    </div>
  )
}
