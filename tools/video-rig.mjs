#!/usr/bin/env node
/**
 * tools/video-rig.mjs — the numbers and the access rule behind video moments,
 * side-by-side compare and athlete clips.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * lib/video-clip.ts decides three things tsc sees as "a number" or "a boolean":
 *
 *   * WHICH SECONDS. A moment the coach clips onto a takeaway opens under the
 *     coach's drawing. A range rounded past the video's end, or one a tenth
 *     over the limit the database CHECK enforces, fails to save or opens on a
 *     black frame — and both type-check.
 *   * WHERE THE SECOND VIDEO IS. Compare plays B at A + offset. A seek past
 *     either end is silently ignored by the browser, so an unclamped time
 *     leaves the two players out of step with nothing on screen saying so.
 *   * WHO SEES WHICH VIDEO. One clause missing from athleteMayViewVideo and a
 *     child sees another child's video — a squad clip, or a clip another
 *     athlete sent their coach. Every video route calls this one function.
 *
 * It imports the real module. Nothing here is a copy of the logic.
 *
 * ── Proven by breaking it ─────────────────────────────────────────────────
 *
 * Each rule was watched going red against a deliberate break in
 * lib/video-clip.ts (or the migration), then the break was reverted:
 *   V1  validateClipRange with the minimum-length check disabled (a 0.2s mis-tap saves)
 *   V1  validateClipRange with the duration check removed
 *   V2  momentAround without the slide at the end of the video
 *   V3  migration 032's CHECK changed to `<= 90`
 *   V4  compareTimeForB without the upper clamp
 *   V5  athleteClipVerdict letting a null (unmeasurable) duration through
 *   V6  isAthleteClipPath without the `${athleteId}` segment
 *   V7  athleteMayViewVideo without the `video.shared_with_athlete` clause
 *   V7  athleteMayViewVideo own-upload branch without the athlete-row check
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateClipRange, momentAround, formatClipTime, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS,
  compareTimeForB, offsetFromPositions, clampOffset, needsResync, COMPARE_DRIFT_S, MAX_COMPARE_OFFSET_S,
  athleteClipVerdict, athleteDurationOk, MAX_ATHLETE_CLIP_SECONDS,
  athleteClipPath, isAthleteClipPath, safeVideoExt,
  athleteMayViewVideo, athleteSeesAnnotations,
} from '@/lib/video-clip'
import { MAX_VIDEO_BYTES } from '@/lib/video-preflight'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', OFF = '\x1b[0m'

const results = []
const check = (id, title, fn) => {
  let problems
  try { problems = fn() ?? [] } catch (e) { problems = [`threw: ${e.message}`] }
  results.push({ id, title, problems })
}
const expect = (problems, cond, msg) => { if (!cond) problems.push(msg) }

// ── V1 ─────────────────────────────────────────────────────────────────────
check('V1', 'A saved moment is a real range, inside the video, at most 60s', () => {
  const p = []
  const ok = (r, d = null) => validateClipRange(r, d).ok
  expect(p, ok({ start_s: 2, end_s: 8 }, 30), '2→8 of a 30s video refused')
  expect(p, !ok({ start_s: 8, end_s: 8 }, 30), 'zero-length moment accepted')
  expect(p, !ok({ start_s: 8, end_s: 3 }, 30), 'end before start accepted')
  expect(p, !ok({ start_s: -1, end_s: 3 }, 30), 'negative start accepted')
  expect(p, !ok({ start_s: 10, end_s: 10.2 }, 30), `moment under ${MIN_CLIP_SECONDS}s accepted`)
  expect(p, ok({ start_s: 0, end_s: MAX_CLIP_SECONDS }, 120), `exactly ${MAX_CLIP_SECONDS}s refused`)
  expect(p, !ok({ start_s: 0, end_s: MAX_CLIP_SECONDS + 0.1 }, 120), `${MAX_CLIP_SECONDS + 0.1}s accepted`)
  expect(p, !ok({ start_s: 20, end_s: 31 }, 30), 'end past the video accepted')
  expect(p, ok({ start_s: 20, end_s: 30 }, 30), 'end exactly at the video end refused')
  // The browser reports 30.04; the coach pressed "end here" at the last frame.
  expect(p, ok({ start_s: 25, end_s: 30.04 }, 30.04), 'end at a fractional duration refused')
  expect(p, !ok({ start_s: 1, end_s: 3 }, Number.NaN), 'NaN duration (not loaded) accepted')
  expect(p, ok({ start_s: 1, end_s: 3 }, null), 'unknown duration refused a valid range')
  expect(p, !ok({ start_s: '1', end_s: 3 }), 'a string start accepted')
  // Rounded to what is stored, and judged on that: 0.04→60.04 rounds to 0→60.
  const r = validateClipRange({ start_s: 0.04, end_s: 60.04 }, 100)
  expect(p, r.ok && r.start_s === 0 && r.end_s === 60, `rounding not applied before judging: ${JSON.stringify(r)}`)
  return p
})

// ── V2 ─────────────────────────────────────────────────────────────────────
check('V2', '"Around now" stays inside the video and keeps its width at the edges', () => {
  const p = []
  const inside = (r, d) => r.start_s >= 0 && r.end_s <= d && r.end_s > r.start_s
  for (const d of [4, 6.5, 30, 30.04, 600]) {
    for (let t = 0; t <= d; t += 0.37) {
      const r = momentAround(t, d, 3)
      if (!inside(r, d)) { p.push(`t=${t.toFixed(2)} d=${d}: ${JSON.stringify(r)} outside the video`); break }
      if (!validateClipRange(r, d).ok && d >= 1) { p.push(`t=${t.toFixed(2)} d=${d}: produced an unsaveable range ${JSON.stringify(r)}`); break }
    }
  }
  const mid = momentAround(15, 30, 3)
  expect(p, mid.start_s === 12 && mid.end_s === 18, `mid-video moment wrong: ${JSON.stringify(mid)}`)
  const start = momentAround(1, 30, 3)
  expect(p, start.start_s === 0 && start.end_s === 6, `near the start it should slide to 0→6, got ${JSON.stringify(start)}`)
  const end = momentAround(29, 30, 3)
  expect(p, end.start_s === 24 && end.end_s === 30, `near the end it should slide to 24→30, got ${JSON.stringify(end)}`)
  return p
})

// ── V3 ─────────────────────────────────────────────────────────────────────
check('V3', 'The database CHECK and the app agree on the longest moment', () => {
  const p = []
  const sql = readFileSync(join(ROOT, 'supabase/migrations/032_video_clips.sql'), 'utf8')
  const m = sql.match(/end_s\s*-\s*start_s\s*<=\s*(\d+(?:\.\d+)?)/)
  expect(p, !!m, 'no `end_s - start_s <= N` CHECK found in migration 032')
  if (m) expect(p, Number(m[1]) === MAX_CLIP_SECONDS, `migration allows ${m[1]}s, lib/video-clip.ts allows ${MAX_CLIP_SECONDS}s`)
  expect(p, /end_s\s*>\s*start_s/.test(sql), 'migration 032 does not require end_s > start_s')
  expect(p, /enable row level security/i.test(sql), 'video_clips is created without RLS')
  return p
})

// ── V4 ─────────────────────────────────────────────────────────────────────
check('V4', 'Compare keeps B inside its own video and in step with A', () => {
  const p = []
  expect(p, compareTimeForB(5, 2, 30) === 7, 'B = A + offset')
  expect(p, compareTimeForB(5, -8, 30) === 0, 'B clamped below 0')
  expect(p, compareTimeForB(29, 3, 30) === 30, 'B clamped to its own duration')
  expect(p, compareTimeForB(5, 2, Number.NaN) === 7, 'unknown B duration should not clamp to 0')
  for (const [a, b] of [[3, 7.2], [10, 1.5], [0, 0]]) {
    const off = offsetFromPositions(a, b)
    expect(p, Math.abs(compareTimeForB(a, off, 60) - b) < 0.051, `line-up at A=${a}, B=${b} does not round-trip (offset ${off})`)
  }
  expect(p, clampOffset(1e9) === MAX_COMPARE_OFFSET_S && clampOffset(-1e9) === -MAX_COMPARE_OFFSET_S, 'offset not clamped')
  expect(p, clampOffset(Number.NaN) === 0, 'NaN offset not reset to 0')
  expect(p, !needsResync(10, 12 + COMPARE_DRIFT_S / 2, 2, 60), 'resyncs inside the drift allowance (seek storm)')
  expect(p, needsResync(10, 12.5, 2, 60), 'does not resync half a second out')
  return p
})

// ── V5 ─────────────────────────────────────────────────────────────────────
check('V5', 'An athlete clip is at most 60 seconds and within the coach upload limits', () => {
  const p = []
  const f = (size, type = 'video/mp4', name = 'clip.mp4') => ({ size, type, name })
  expect(p, athleteClipVerdict(f(20e6), 45).ok, 'a 45s 20MB clip refused')
  expect(p, athleteClipVerdict(f(20e6), 60.3).ok, 'a clip the phone reports as 60.3s refused')
  expect(p, !athleteClipVerdict(f(20e6), 61).ok, 'a 61s clip accepted')
  expect(p, !athleteClipVerdict(f(20e6), null).ok, 'an unmeasurable clip accepted')
  expect(p, !athleteClipVerdict(f(MAX_VIDEO_BYTES + 1), 10).ok, 'a clip over the bucket limit accepted')
  expect(p, !athleteClipVerdict(f(1e6, 'image/png', 'x.png'), 10).ok, 'an image accepted as a clip')
  expect(p, athleteDurationOk(MAX_ATHLETE_CLIP_SECONDS) && !athleteDurationOk(61) && !athleteDurationOk('30') && !athleteDurationOk(0),
    'server duration rule disagrees with the client rule')
  return p
})

// ── V6 ─────────────────────────────────────────────────────────────────────
check('V6', 'An athlete can register a clip only inside their own folder', () => {
  const p = []
  const me = 'user-aaa', mine = 'ath-111', theirs = 'ath-222', other = 'user-bbb'
  const path = athleteClipPath(me, mine, 'mp4', 1700000000000)
  expect(p, isAthleteClipPath(path, me, mine), 'own path refused')
  expect(p, !isAthleteClipPath(path, other, mine), 'path accepted for a different user')
  expect(p, !isAthleteClipPath(athleteClipPath(me, theirs, 'mp4', 1), me, mine), "another athlete row's folder accepted")
  expect(p, !isAthleteClipPath(`${me}/athlete/${mine}/../${theirs}/1.mp4`, me, mine), 'traversal accepted')
  expect(p, !isAthleteClipPath(`${me}/sess-1/1.mp4`, me, mine), "a coach-shaped path accepted")
  expect(p, !isAthleteClipPath(`${me}/athlete/${mine}/1.html`, me, mine), 'non-video extension accepted')
  expect(p, !isAthleteClipPath(null, me, mine), 'null path accepted')
  expect(p, safeVideoExt('../../evil.sh', 'video/mp4') === 'mp4', 'unsafe extension passed through')
  expect(p, safeVideoExt('IMG_0001.MOV', '') === 'mov', '.MOV not kept')
  expect(p, safeVideoExt('noext', 'video/webm') === 'webm', 'webm mime not honoured')
  return p
})

// ── V7 ─────────────────────────────────────────────────────────────────────
check('V7', 'An athlete sees only their own clips and videos their coach sent them', () => {
  const p = []
  const mia = { userId: 'u-mia', athleteIds: ['a-mia'] }
  const miaSession = { athlete_id: 'a-mia', shared_with_athlete: true }
  const kaiSession = { athlete_id: 'a-kai', shared_with_athlete: true } // a squad sibling row
  const coachVid = (shared) => ({ shared_with_athlete: shared, uploaded_by_role: 'coach', uploaded_by: 'u-coach', athlete_id: null })
  const may = (v, s, who = mia) => athleteMayViewVideo(v, s, who)

  expect(p, may(coachVid(true), miaSession), 'shared video on her shared session hidden')
  expect(p, !may(coachVid(false), miaSession), 'UNSHARED video on her session visible')
  expect(p, !may(coachVid(true), { ...miaSession, shared_with_athlete: false }), 'video on an UNSHARED session visible')
  expect(p, !may(coachVid(true), kaiSession), "video on a squad-mate's session row visible")
  expect(p, !may(coachVid(true), null), 'coach video with no session visible')

  const miaClip = { shared_with_athlete: false, uploaded_by_role: 'athlete', uploaded_by: 'u-mia', athlete_id: 'a-mia' }
  const kaiClip = { shared_with_athlete: false, uploaded_by_role: 'athlete', uploaded_by: 'u-kai', athlete_id: 'a-kai' }
  expect(p, may(miaClip, null), 'her own general clip hidden from her')
  expect(p, may(miaClip, { ...miaSession, shared_with_athlete: false }), 'her own clip hidden when the session is unshared')
  expect(p, !may(kaiClip, null), "another athlete's clip visible")
  expect(p, !may(kaiClip, miaSession), "another athlete's clip visible via her session")
  expect(p, !may({ ...miaClip, athlete_id: 'a-kai' }, null), 'own-user upload into an athlete row she does not hold visible')
  expect(p, !may({ ...miaClip, uploaded_by_role: 'coach' }, null), 'coach upload treated as her own')
  expect(p, !may(miaClip, null, { userId: 'u-mia', athleteIds: [] }), 'visible to a user holding no athlete row')

  expect(p, !athleteSeesAnnotations(miaClip), "coach's draft strokes shown before the clip is sent back")
  expect(p, athleteSeesAnnotations({ ...miaClip, shared_with_athlete: true }), 'strokes hidden after the clip is sent back')
  return p
})

check('V8', 'Clip times read the way a coach says them', () => {
  const p = []
  const cases = [[0, '0:00'], [7.5, '0:07.5'], [62, '1:02'], [720, '12:00'], [59.96, '1:00'], [-1, '0:00']]
  for (const [s, want] of cases) {
    const got = formatClipTime(s)
    expect(p, got === want, `formatClipTime(${s}) = ${got}, want ${want}`)
  }
  return p
})

// ── report ────────────────────────────────────────────────────────────────
console.log(`\n  ${DIM}Video rig — moments, compare and athlete clips, against lib/video-clip.ts${OFF}\n`)
let failed = 0
for (const r of results) {
  if (r.problems.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${r.id}  ${r.title}`)
  } else {
    failed++
    console.log(`   ${RED}FAIL${OFF}  ${r.id}  ${r.title}`)
    for (const m of r.problems) console.log(`         ${RED}·${OFF} ${m}`)
  }
}
console.log('')
if (failed) {
  console.log(`  ${RED}✗ ${failed} of ${results.length} video checks failed.${OFF}\n`)
  process.exit(1)
}
console.log(`  ${GREEN}✓ ${results.length} video checks hold.${OFF}\n`)
