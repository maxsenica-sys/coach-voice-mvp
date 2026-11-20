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
import { MAX_VIDEO_BYTES, preflightVideo } from '@/lib/video-preflight'
import {
  isNetworkError, isRetryableStatus, RETRY_DELAYS_MS,
  parsePending, addPending, removePending, pendingFor, PENDING_MAX_AGE_MS,
  planQueue, nextWaiting, isBusy, queueSummary, uploadFailureNote,
} from '@/lib/video-queue'
import {
  pickScreenMime, extensionFor, shouldStartNewPart, PART_LIMIT_BYTES, partFileName, canRecordScreen,
  VIDEO_BITS_PER_SECOND, AUDIO_BITS_PER_SECOND,
} from '@/lib/screen-recording'

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
check('V9', 'A recorded call plays on an iPhone where it can, and never outgrows the upload limit', () => {
  const p = []
  const only = (...ok) => (t) => ok.includes(t)
  // mp4 first: an iPhone cannot play WebM (the same rule as the audio recorders).
  if (pickScreenMime(() => true) !== 'video/mp4;codecs=avc1.42E01E,mp4a.40.2') p.push('mp4 is not preferred when the browser offers it')
  if (pickScreenMime(only('video/webm')) !== 'video/webm') p.push('no fallback to plain WebM')
  if (pickScreenMime(() => false) !== '') p.push('a browser with no supported type must get "" (let it choose)')
  if (pickScreenMime(() => { throw new Error('x') }) !== '') p.push('a throwing isTypeSupported must not break the pick')
  // The filename names the container actually used — the transcription rule, for video.
  if (extensionFor('video/mp4;codecs=avc1') !== 'mp4' || extensionFor('video/webm;codecs=vp9,opus') !== 'webm') p.push('extension does not follow the real container')
  // Parts: under the bucket limit, with headroom, and a part starts before it is reached.
  if (!(PART_LIMIT_BYTES < MAX_VIDEO_BYTES)) p.push('a part can reach the upload limit')
  if (shouldStartNewPart(PART_LIMIT_BYTES - 1) || !shouldStartNewPart(PART_LIMIT_BYTES)) p.push('the new-part threshold is off by one')
  // A part at the chosen bitrates must last long enough to be useful (> 30 min).
  const bytesPerSecond = (VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) / 8
  if (PART_LIMIT_BYTES / bytesPerSecond < 30 * 60) p.push(`a part lasts only ${Math.round(PART_LIMIT_BYTES / bytesPerSecond / 60)} min at these bitrates`)
  if (partFileName('14 Nov', 1, 1, 'mp4') !== 'Call recording 14 Nov.mp4') p.push('a single part is numbered')
  if (partFileName('14 Nov', 2, null, 'webm') !== 'Call recording 14 Nov — part 2.webm') p.push('parts are not numbered')
  if (canRecordScreen(undefined) || canRecordScreen({ mediaDevices: {} })) p.push('offered where the screen cannot be shared (phones)')
  if (!canRecordScreen({ mediaDevices: { getDisplayMedia: () => {} } })) p.push('not offered where it can be')
  return p
})

// ── V10 ────────────────────────────────────────────────────────────────────
// The failure of 2026-11-20: a clip reached storage and was never recorded,
// because the request that records it died on the phone's network ("Load
// failed") and nothing tried again.
check('V10', 'A request that died on the network is tried again, and the coach is not shown the browser\'s words', () => {
  const p = []
  expect(p, isNetworkError(new TypeError('Load failed')), 'Safari\'s "Load failed" is not seen as a network failure')
  expect(p, isNetworkError(new TypeError('Failed to fetch')), 'Chrome\'s "Failed to fetch" is not seen as a network failure')
  expect(p, isNetworkError(new Error('The network connection was lost.')), 'iOS\'s "connection was lost" is not seen as a network failure')
  expect(p, !isNetworkError(new Error('Session not found or access denied.')), 'a refusal from the server would be retried')
  expect(p, !isNetworkError(new Error('Upload failed (413)')), 'a too-large answer would be retried')
  expect(p, RETRY_DELAYS_MS.length >= 2, `only ${RETRY_DELAYS_MS.length + 1} attempt(s) at a request that died`)
  expect(p, [502, 503, 504, 429].every(isRetryableStatus), 'a busy server is not retried')
  expect(p, ![400, 401, 403, 404, 409, 413, 500].some(isRetryableStatus), 'an answer that will not change is retried')
  const saved = uploadFailureNote(new TypeError('Load failed'), true)
  const unsent = uploadFailureNote(new TypeError('Load failed'), false)
  expect(p, !/load failed/i.test(saved) && !/load failed/i.test(unsent), 'the coach is shown "Load failed"')
  expect(p, /without sending it again/i.test(saved), 'a clip already in storage does not say it will not be sent again')
  expect(p, uploadFailureNote(new Error('Session not found or access denied.'), false) === 'Session not found or access denied.', 'the server\'s own reason is lost')
  return p
})

// ── V11 ────────────────────────────────────────────────────────────────────
check('V11', 'An upload is remembered until its row exists, and a stale or broken note is dropped', () => {
  const p = []
  const now = 1_800_000_000_000
  const a = { sessionId: 's1', path: 'u/s1/1.mov', fileName: 'IMG_1.MOV', mimeType: 'video/quicktime', startedAt: now - 1000 }
  const b = { sessionId: 's2', path: 'u/s2/2.mp4', fileName: 'two.mp4', mimeType: 'video/mp4', startedAt: now - 2000 }
  let list = addPending(addPending([], a), b)
  expect(p, list.length === 2, 'two uploads are not both remembered')
  expect(p, addPending(list, a).length === 2, 'the same upload is remembered twice')
  expect(p, pendingFor(list, 's1').length === 1 && pendingFor(list, 's1')[0].path === a.path, 'pending uploads leak across sessions')
  expect(p, removePending(list, a.path).length === 1 && removePending(list, a.path)[0].path === b.path, 'recording one upload forgets another')
  const round = parsePending(JSON.stringify(list), now)
  expect(p, round.length === 2 && round[0].fileName === 'IMG_1.MOV', 'the list does not survive storage')
  expect(p, parsePending('not json', now).length === 0 && parsePending(null, now).length === 0 && parsePending('{"a":1}', now).length === 0, 'a broken stored value is not treated as empty')
  expect(p, parsePending(JSON.stringify([{ sessionId: 's1' }, a]), now).length === 1, 'a malformed entry is kept')
  const old = { ...a, startedAt: now - PENDING_MAX_AGE_MS - 1 }
  expect(p, parsePending(JSON.stringify([old, b]), now).length === 1, 'an upload from over a week ago is still chased')
  return p
})

// ── V12 ────────────────────────────────────────────────────────────────────
check('V12', 'Several clips: every one picked gets a line, in order, and one goes at a time', () => {
  const p = []
  const mb = 1024 * 1024
  const files = [
    { name: 'IMG_0001.MOV', size: 12 * mb, type: 'video/quicktime' },
    { name: 'too-big.mp4', size: MAX_VIDEO_BYTES + 1, type: 'video/mp4' },
    { name: 'notes.pdf', size: 1 * mb, type: 'application/pdf' },
    { name: 'IMG_0002.MP4', size: 30 * mb, type: 'video/mp4' },
    { name: 'empty.mp4', size: 0, type: 'video/mp4' },
  ]
  const items = planQueue(files, (f) => preflightVideo(f), (i) => `id${i}`)
  expect(p, items.length === files.length, `${files.length} picked became ${items.length} lines: a clip was dropped`)
  expect(p, items.map((i) => i.name).join() === files.map((f) => f.name).join(), 'the order picked is not kept')
  expect(p, items.map((i) => i.status).join() === 'waiting,refused,refused,waiting,refused', `statuses are ${items.map((i) => i.status).join()}`)
  expect(p, items.filter((i) => i.status === 'refused').every((i) => i.note.length > 10), 'a refused clip does not say why')
  expect(p, nextWaiting(items)?.name === 'IMG_0001.MOV', 'the first clip picked is not the first sent')
  expect(p, isBusy(items), 'waiting clips are not counted as in progress')
  // one at a time: with the first uploading, the next to start is the second waiting one
  const mid = items.map((i) => (i.id === 'id0' ? { ...i, status: 'uploading' } : i))
  expect(p, nextWaiting(mid)?.name === 'IMG_0002.MP4', 'two clips would be sent at once, or the queue stalls')
  expect(p, queueSummary(mid) === 'Uploading 4 of 5', `summary mid-queue reads "${queueSummary(mid)}"`)
  const end = items.map((i) => (i.status === 'waiting' ? { ...i, status: 'done' } : i))
  expect(p, !isBusy(end), 'a finished queue still reads as in progress, which would hold app updates back for ever')
  expect(p, queueSummary(end) === '2 of 5 added · 3 need attention', `summary at the end reads "${queueSummary(end)}"`)
  expect(p, queueSummary(planQueue([files[0]], () => ({ ok: true, warning: null }), () => 'x').map((i) => ({ ...i, status: 'done' }))) === '1 clip added', 'one clip is not singular')
  expect(p, planQueue([{ name: '', size: 5 }], () => ({ ok: true, warning: null }), () => 'x')[0].name === 'Clip 1', 'a clip with no name has an empty line')
  return p
})

// ── V13 ────────────────────────────────────────────────────────────────────
// The joins between files, which tsc cannot see.
check('V13', 'The pickers take several clips, the record step is safe to repeat, and an upload holds app updates back', () => {
  const p = []
  const src = (f) => readFileSync(join(ROOT, f), 'utf8')
  const uploader = src('app/components/VideoUploader.tsx')
  expect(p, /<input[\s\S]{0,200}accept="video\/\*"[\s\S]{0,40}multiple/.test(uploader), 'the video picker does not allow several clips')
  // More can be picked while one uploads: the trigger is never disabled, and a
  // clip added as the queue winds down still starts.
  const trigger = (uploader.match(/<button[\s\S]{0,260}inputRef\.current\?\.click\(\)[\s\S]{0,400}<\/button>/) || [''])[0]
  expect(p, trigger !== '' && !/disabled/.test(trigger), 'the picker is blocked while a clip uploads')
  expect(p, /busy \? 'Add more'/.test(uploader), 'nothing says more clips can be added during an upload')
  expect(p, /if \(nextWaiting\(itemsRef\.current\)\) void runRef\.current\(\)/.test(uploader), 'a clip picked as the queue finishes is left waiting')
  expect(p, /resumePendingVideos/.test(uploader), 'an upload left in storage by an earlier visit is never finished')
  expect(p, /finishSavedVideo/.test(uploader), 'Retry would send a clip again that is already in storage')
  for (const page of ['app/sessions/[id]/page.tsx', 'app/athletes/[id]/page.tsx']) {
    expect(p, /<VideoUploader/.test(src(page)), `${page} does not use the uploader`)
    expect(p, !/accept="video\/\*"/.test(src(page)), `${page} still has its own single-clip picker`)
  }
  const lib = src('lib/video-upload.ts')
  expect(p, /writePending\(addPending\([\s\S]{0,200}\)\)[\s\S]{0,400}putFile\(/.test(lib), 'the upload is not written down before the file is sent')
  expect(p, /fetchWithRetry\(`\/api\/sessions\/\$\{sessionId\}\/videos`/.test(lib), 'the record step is not retried')
  const route = src('app/api/sessions/[id]/videos/route.ts')
  expect(p, /\.eq\('storage_path', storagePath\)[\s\S]{0,600}status: 200/.test(route), 'recording the same file twice would make two rows')
  expect(p, /code: 'not_uploaded'[\s\S]{0,40}status: 409/.test(route), 'a file that is not in storage can be recorded')
  expect(p, /startsWith\(`\$\{user\.id\}\/\$\{sessionId\}\/`\)/.test(route), 'the own-folder check on the path is gone')
  // The athlete's own clip takes the same three steps and gets the same care.
  const clipRoute = src('app/api/athlete/clips/route.ts')
  expect(p, /\.eq\('storage_path', storagePath\)[\s\S]{0,400}status: 200/.test(clipRoute), 'an athlete clip recorded twice would make two rows and two messages to the coach')
  expect(p, clipRoute.indexOf("status: 200") < clipRoute.indexOf('notifyNewMessage({'), 'a repeated record would message the coach again')
  // Two requests arriving together both find no row. The database refuses the
  // second (migration 039) and each route answers it with the first one's row.
  expect(p, /create unique index[\s\S]{0,80}session_videos \(storage_path\)/.test(src('supabase/migrations/039_session_video_path_unique.sql')), 'nothing stops one file being recorded twice')
  expect(p, /insertErr\?\.code === '23505'[\s\S]{0,300}status: 200/.test(route), 'a retry racing its own first attempt is told the clip failed')
  expect(p, /insertErr\?\.code === '23505'[\s\S]{0,400}status: 200/.test(clipRoute), 'an athlete retry racing its own first attempt is told the clip failed')
  expect(p, clipRoute.indexOf("insertErr?.code === '23505'") < clipRoute.indexOf('notifyNewMessage({'), 'the losing request of a race would message the coach as well')
  const clipUi = src('app/components/AthleteClipUpload.tsx')
  expect(p, /fetchWithRetry\('\/api\/athlete\/clips'/.test(clipUi), 'the athlete clip record step is not retried')
  expect(p, /isNetworkError\(e\) \? 'The connection dropped/.test(clipUi), 'an athlete is shown the browser\'s "Load failed"')
  return p
})

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
