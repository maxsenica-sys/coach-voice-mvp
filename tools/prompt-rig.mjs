#!/usr/bin/env node
/**
 * tools/prompt-rig.mjs — put the summariser under test.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The prompt in `lib/summary-prompt.ts` is the product. Everything else in
 * CoachVoice moves a recording from a phone to a database; that text is the
 * only thing that turns it into something a fifteen-year-old reads. It decides
 * what a child is told their coach said about them.
 *
 * It had no test of any kind. Not a weak one — none. It could be edited in any
 * direction and `tsc`, `eslint`, `next build` and the boot harness would all
 * pass, because a prompt is a string and every string type-checks. The only
 * gate was a human reading the diff, on a file that also contained a fetch
 * call, cookie plumbing and an insert.
 *
 * The risk that makes this urgent rather than tidy: personalisation. A squad
 * recording is saved once per member, so the same transcript is summarised N
 * times, once "for" each child. If the name gate is wrong in either direction,
 * the failure is a fabricated coaching instruction addressed to a named minor,
 * or one child's criticism appearing on another child's screen. That is not a
 * bug you find by reading.
 *
 * ── The two modes ─────────────────────────────────────────────────────────
 *
 * **Offline (default).** Deterministic, free, no network, runs in CI on every
 * commit. It builds the real prompt over recorded transcripts and asserts the
 * properties that must hold, and it pins the un-personalised prompt against a
 * golden file so that no edit to the most important text in the app can happen
 * silently. It also runs the response parser over recorded model replies.
 *
 * **Live (`--live`).** Opt-in, needs `OPENAI_API_KEY`, costs pennies, and is
 * deliberately not in CI. It calls the real model and checks what comes back:
 * that a squad summary never names another child, that bullets look like
 * bullets, that a NEXT line is short enough to act on. Non-deterministic by
 * nature, so it reports rather than gates.
 *
 * Usage:
 *   node tools/prompt-rig.mjs                  # offline, gates
 *   node tools/prompt-rig.mjs --live           # also call the model
 *   node tools/prompt-rig.mjs --update-golden  # after a deliberate prompt edit
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// pathToFileURL, not the bare path. A dynamic import of "C:\Users\…" is
// rejected outright as an unsupported URL scheme 'c:', so this rig could only
// ever run on Linux — and CI is the only place that is, which makes it a gate
// the person who just changed the code cannot run before opening the PR. Same
// lesson as the boot harness and its `npx` spawn.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = path.join(ROOT, 'tools/prompt-fixtures/transcripts.json')

/**
 * Both prompts the app can send are pinned, not just one.
 *
 * The un-personalised prompt is what every individually-recorded athlete gets,
 * and it must not drift as a side effect of a personalisation change. The
 * personalised prompt contains the instructions that keep one child's
 * criticism off another child's screen — "never mention any other athlete by
 * name" — and an edit that weakened that sentence would otherwise be caught by
 * nothing at all.
 */
const GOLDENS = [
  {
    file: path.join(ROOT, 'tools/prompt-fixtures/golden-prompt.txt'),
    caseId: 'individual-unnamed',
    athlete: 'Ana',
    label: 'un-personalised (the coach never said the name)',
  },
  {
    file: path.join(ROOT, 'tools/prompt-fixtures/golden-prompt-personalised.txt'),
    caseId: 'squad-two-named',
    athlete: 'Ana',
    label: 'personalised (a squad talk that named her)',
  },
]

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const { readinessToMetrics, sorenessFromAreas } =
  await import(pathToFileURL(path.join(ROOT, 'lib/readiness.ts')).href)

const { overallWellnessScore, computeWellnessAlert } =
  await import(pathToFileURL(path.join(ROOT, 'lib/wellness-config.ts')).href)

const { preflightVideo, looksLikeHevc } =
  await import(pathToFileURL(path.join(ROOT, 'lib/video-preflight.ts')).href)

const { assessTranscript } =
  await import(pathToFileURL(path.join(ROOT, 'lib/transcript-quality.ts')).href)

const { ALL_SPORTS, SPORT_TERMINOLOGY, getSportTerminologyHint } =
  await import(pathToFileURL(path.join(ROOT, 'lib/sports.ts')).href)

const { buildSummaryPrompt, transcriptNames, mayPersonalise, parseSummaryResponse, MAX_NEXT_LENGTH, TARGET_BULLETS } =
  await import(pathToFileURL(path.join(ROOT, 'lib/summary-prompt.ts')).href)

const { buildSplitSummaryPrompt, parseSplitSummaryResponse, splitEligibility, assembleSplit, SplitParseError, MAX_SPLIT_ATHLETES } =
  await import(pathToFileURL(path.join(ROOT, 'lib/split-summary.ts')).href)

const { sessionBodies, narrowAfterPartialSave } =
  await import(pathToFileURL(path.join(ROOT, 'lib/recording-sync.ts')).href)

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8'))

const failures = []
let checks = 0
function check(ok, name, detail = '') {
  checks++
  if (!ok) failures.push({ name, detail })
  return ok
}

console.log(`\n  ${DIM}Prompt rig — the summariser, checked without calling it${OFF}\n`)

// ── 1 · the golden pins ───────────────────────────────────────────────────

console.log(`   ${BOLD}Golden prompts${OFF} ${DIM}— the exact text sent to the model${OFF}`)

const updating = process.argv.includes('--update-golden')

for (const g of GOLDENS) {
  const c = fixtures.cases.find((x) => x.id === g.caseId)
  const built = buildSummaryPrompt(c.transcript, c.sport, g.athlete)

  if (updating) {
    writeFileSync(g.file, built)
    console.log(`   ${YELLOW}rewritten${OFF}  ${path.basename(g.file)} ${DIM}— review the diff before committing${OFF}`)
    continue
  }

  if (!existsSync(g.file)) {
    failures.push({ name: `golden missing: ${path.basename(g.file)}`, detail: 'run --update-golden' })
    console.log(`   ${RED}FAIL${OFF}  ${path.basename(g.file)} does not exist — run --update-golden`)
    continue
  }

  const recorded = readFileSync(g.file, 'utf8')
  if (check(recorded === built, `golden prompt unchanged: ${g.label}`)) {
    console.log(`   ${GREEN}PASS${OFF}  ${g.label} ${DIM}· ${built.length} characters${OFF}`)
  } else {
    console.log(`   ${RED}FAIL${OFF}  ${g.label} has changed`)
    const a = recorded.split('\n')
    const b = built.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`         ${DIM}line ${i + 1}${OFF}`)
        console.log(`         ${RED}- ${a[i] ?? '(end of file)'}${OFF}`)
        console.log(`         ${GREEN}+ ${b[i] ?? '(end of file)'}${OFF}`)
      }
    }
    console.log(`         ${DIM}If deliberate: node tools/prompt-rig.mjs --update-golden${OFF}`)
  }
}

/* The split prompt is pinned too. It is the text that decides whether Kai
 * reads what the coach said about Mia, and "never copy it into another
 * athlete's section" is exactly the kind of sentence an edit can weaken
 * without anything else noticing. Built over the eligible athletes only,
 * which is what the route sends. */
const SPLIT_GOLDEN = path.join(ROOT, 'tools/prompt-fixtures/golden-prompt-split.txt')
{
  const c = fixtures.splits.cases.find((x) => x.id === 'two-named-one-silent')
  const built = buildSplitSummaryPrompt(c.transcript, c.sport, splitEligibility(c.transcript, c.athletes).eligible)
  if (updating) {
    writeFileSync(SPLIT_GOLDEN, built)
    console.log(`   ${YELLOW}rewritten${OFF}  ${path.basename(SPLIT_GOLDEN)} ${DIM}— review the diff before committing${OFF}`)
  } else if (!existsSync(SPLIT_GOLDEN)) {
    failures.push({ name: 'golden missing: golden-prompt-split.txt', detail: 'run --update-golden' })
    console.log(`   ${RED}FAIL${OFF}  golden-prompt-split.txt does not exist — run --update-golden`)
  } else if (check(readFileSync(SPLIT_GOLDEN, 'utf8') === built, 'golden prompt unchanged: split between several athletes')) {
    console.log(`   ${GREEN}PASS${OFF}  split between several athletes ${DIM}· ${built.length} characters${OFF}`)
  } else {
    console.log(`   ${RED}FAIL${OFF}  split between several athletes has changed`)
    const a = readFileSync(SPLIT_GOLDEN, 'utf8').split('\n')
    const b = built.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`         ${DIM}line ${i + 1}${OFF}`)
        console.log(`         ${RED}- ${a[i] ?? '(end of file)'}${OFF}`)
        console.log(`         ${GREEN}+ ${b[i] ?? '(end of file)'}${OFF}`)
      }
    }
    console.log(`         ${DIM}If deliberate: node tools/prompt-rig.mjs --update-golden${OFF}`)
  }
}

if (updating) {
  console.log('')
  process.exit(0)
}

// ── 2 · the name gate, per fixture ────────────────────────────────────────

console.log(`\n   ${BOLD}The name gate${OFF} ${DIM}— who gets a personalised summary${OFF}`)

for (const c of fixtures.cases) {
  const wrong = []
  for (const [name, expected] of Object.entries(c.expectPersonalised ?? {})) {
    const got = transcriptNames(c.transcript, name)
    if (got !== expected) wrong.push(`${name}: expected ${expected}, got ${got}`)
    checks++
  }
  if (wrong.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${c.id.padEnd(20)} ${DIM}${c.why ?? ''}${OFF}`)
  } else {
    failures.push({ name: `name gate · ${c.id}`, detail: wrong.join('; ') })
    console.log(`   ${RED}FAIL${OFF}  ${c.id.padEnd(20)} ${RED}${wrong.join('; ')}${OFF}`)
  }
}

// ── 0 · the check-in feeds the safeguarding path ──────────────────────────
//
// The five-slider form is replaced by two taps. computeWellnessAlert, the
// caretaker escalation email and the coach's roster dot all read the five 1-5
// columns through overallWellnessScore — and that path decides whether a parent
// is told their child is struggling. So the new check-in DERIVES those columns
// rather than replacing them, and this is where that is proven rather than
// assumed.
//
// The direction of these assertions is the point. This repo has already shipped
// a bug where `inverted: true` made computeWellnessAlert run backwards: an
// athlete answering 4/4/4 with no soreness tripped the alert, and one answering
// 2/2/2 while very sore did not. Every check below pins a direction.

console.log(`\n   ${BOLD}The check-in${OFF} ${DIM}— two taps must not break the alert${OFF}`)

{
  const row = (extra) => ({
    id: 'x', athlete_id: 'a', check_date: '2027-01-01',
    energy: null, mood: null, sleep_q: null, soreness: null, stress: null, notes: null,
    ...extra,
  })

  const flat = row(readinessToMetrics(1, []))
  const ok = row(readinessToMetrics(2, []))
  const good = row(readinessToMetrics(3, []))

  const sFlat = overallWellnessScore(flat)
  const sOk = overallWellnessScore(ok)
  const sGood = overallWellnessScore(good)

  const assert = (cond, name, detail) => {
    checks++
    if (cond) {
      console.log(`   ${GREEN}PASS${OFF}  ${name}`)
    } else {
      failures.push({ name: `check-in · ${name}`, detail })
      console.log(`   ${RED}FAIL${OFF}  ${name}   ${RED}${detail}${OFF}`)
    }
  }

  assert(sFlat < sOk && sOk < sGood, 'Flat scores lower than OK, which scores lower than Good',
    `${sFlat} / ${sOk} / ${sGood}`)

  // Soreness runs 5 = no soreness, like every other metric in this schema.
  assert(sorenessFromAreas([]) === 5, 'marking nothing means no soreness',
    `got ${sorenessFromAreas([])}`)
  assert(sorenessFromAreas(['knee_l']) < 5, 'marking one area lowers soreness',
    `got ${sorenessFromAreas(['knee_l'])}`)
  assert(
    sorenessFromAreas(['knee_l', 'hamstring_r', 'lower_back']) < sorenessFromAreas(['knee_l']),
    'marking more areas lowers it further',
    `${sorenessFromAreas(['knee_l', 'hamstring_r', 'lower_back'])} vs ${sorenessFromAreas(['knee_l'])}`,
  )
  assert(sorenessFromAreas(Array.from({ length: 12 }, (_, i) => `r${i}`)) >= 2,
    'soreness never floors below 2 however much is marked',
    `got ${sorenessFromAreas(Array.from({ length: 12 }, (_, i) => `r${i}`))}`)

  // A sore Good day must still score below a painless Flat day is NOT asserted:
  // that is a product judgement, not an invariant. What IS asserted is that
  // soreness moves the score in the right direction at a fixed readiness.
  const goodSore = row(readinessToMetrics(3, ['knee_l', 'lower_back']))
  assert(overallWellnessScore(goodSore) < sGood,
    'being sore lowers the score at the same readiness',
    `${overallWellnessScore(goodSore)} vs ${sGood}`)

  // The alert must still fire, and must still not fire, on the same evidence.
  const week = (r, areas) => Array.from({ length: 7 }, () => row(readinessToMetrics(r, areas)))
  const alertFlat = computeWellnessAlert(week(1, ['knee_l', 'lower_back']))
  const alertGood = computeWellnessAlert(week(3, []))
  assert(alertFlat.active === true, 'a week of Flat and sore raises the alert',
    JSON.stringify(alertFlat))
  assert(alertGood.active === false, 'a week of Good and painless does not',
    JSON.stringify(alertGood))

  // sleep_q is deliberately not derived — inventing a number would put
  // fabricated data into a chart the coach reads.
  assert(readinessToMetrics(2, []).sleep_q === undefined,
    'readiness never invents a sleep score',
    JSON.stringify(readinessToMetrics(2, [])))
}

// ── 1 · the video pre-flight ──────────────────────────────────────────────
//
// Two failures, both silent. There was no size limit anywhere on the upload
// path that actually runs — the 500MB guard lives in a FormData branch with no
// caller — so a 4K60 iPhone clip at roughly 400MB a minute could upload for
// minutes on pitch-side data with nothing objecting. And an HEVC clip uploads
// perfectly and is then a black rectangle in the coach's own Chrome, with no
// error raised anywhere, because nothing failed.

console.log(`\n   ${BOLD}Video pre-flight${OFF} ${DIM}— decided before a byte leaves the phone${OFF}`)

{
  const MB = 1024 * 1024
  const cases = [
    {
      id: 'oversized-4k',
      why: 'Two minutes of 4K60 from an iPhone. Must be refused before the upload starts, with advice a coach can act on.',
      file: { size: 800 * MB, type: 'video/mp4', name: 'IMG_1234.mp4' },
      expectOk: false,
    },
    {
      id: 'at-the-limit',
      why: 'Exactly the bucket limit set in migration 023 is allowed; one byte over is not. An off-by-one here means the client and the bucket disagree and the user sees a raw storage error.',
      file: { size: 500 * MB, type: 'video/mp4', name: 'clip.mp4' },
      expectOk: true,
    },
    {
      id: 'one-byte-over',
      why: 'The other side of the same boundary.',
      file: { size: 500 * MB + 1, type: 'video/mp4', name: 'clip.mp4' },
      expectOk: false,
    },
    {
      id: 'empty-file',
      why: 'A zero-byte pick, which happens when a file is still syncing from iCloud.',
      file: { size: 0, type: 'video/mp4', name: 'clip.mp4' },
      expectOk: false,
    },
    {
      id: 'not-a-video',
      why: 'A PDF picked by mistake. Refused here rather than after the upload.',
      file: { size: 2 * MB, type: 'application/pdf', name: 'plan.pdf' },
      expectOk: false,
    },
    {
      id: 'ordinary-clip',
      why: 'A normal 40MB 1080p clip. Must upload with NO warning — a warning on every clip trains the coach to ignore warnings.',
      file: { size: 40 * MB, type: 'video/mp4', name: 'clip.mp4' },
      expectOk: true,
      expectWarning: false,
    },
    {
      id: 'large-but-allowed',
      why: 'Under the limit and big enough that the coach should know it will take a while on mobile data.',
      file: { size: 200 * MB, type: 'video/mp4', name: 'clip.mp4' },
      expectOk: true,
      expectWarning: true,
    },
  ]

  for (const c of cases) {
    const v = preflightVideo(c.file)
    checks++
    let bad = null
    if (v.ok !== c.expectOk) bad = `expected ok=${c.expectOk}, got ok=${v.ok}`
    else if (c.expectWarning !== undefined && v.ok && Boolean(v.warning) !== c.expectWarning) {
      bad = `expected warning=${c.expectWarning}, got ${JSON.stringify(v.warning)}`
    } else if (!v.ok && !/[.!?]$/.test(v.reason.trim())) {
      bad = 'refusal is not a written sentence'
    }
    if (bad) {
      failures.push({ name: `video pre-flight · ${c.id}`, detail: bad })
      console.log(`   ${RED}FAIL${OFF}  ${c.id.padEnd(20)} ${RED}${bad}${OFF}`)
    } else {
      console.log(`   ${GREEN}PASS${OFF}  ${c.id.padEnd(20)} ${DIM}${c.why}${OFF}`)
    }
  }

  // HEVC is a judgement about the container, not about this browser: the clip
  // plays fine on the phone that shot it and fails on the coach's laptop.
  checks++
  const hevc = looksLikeHevc({ type: 'video/quicktime', name: 'IMG_0042.MOV' })
  const plain = looksLikeHevc({ type: 'video/mp4', name: 'clip.mp4' })
  if (hevc && !plain) {
    console.log(`   ${GREEN}PASS${OFF}  ${'hevc-detection'.padEnd(20)} ${DIM}A .mov is flagged, an .mp4 is not.${OFF}`)
  } else {
    failures.push({ name: 'video pre-flight · hevc-detection', detail: `mov=${hevc}, mp4=${plain}` })
    console.log(`   ${RED}FAIL${OFF}  ${'hevc-detection'.padEnd(20)} ${RED}mov=${hevc}, mp4=${plain}${OFF}`)
  }
}

// ── 1a · the transcript quality gate ──────────────────────────────────────
//
// whisper-1 hallucinates fluent text from silence. The only guard was
// `blob.size < 1000`, which forty seconds of a muted microphone exceeds — so a
// recording of nothing became a paid API call, a confident transcript, a
// summary, and an email to a child and their caretakers, with nothing in the
// chain able to tell that the coach never spoke.

console.log(`\n   ${BOLD}Transcript quality${OFF} ${DIM}— silence must not become a summary${OFF}`)

{
  const seg = (no_speech_prob, avg_logprob) => ({ no_speech_prob, avg_logprob })
  const cases = [
    {
      id: 'silence-hallucinated',
      why: 'Whisper inventing a plausible sentence from a silent room. Every segment is flagged as non-speech; the words are fluent and mean nothing.',
      text: 'Thank you for watching. Please subscribe to the channel.',
      segments: [seg(0.95, -0.4), seg(0.92, -0.5), seg(0.97, -0.3)],
      expect: 'no-speech',
    },
    {
      id: 'empty-ish',
      why: 'Below four words there is nothing to summarise, whatever the confidence says.',
      text: 'Okay.',
      segments: [seg(0.1, -0.2)],
      expect: 'no-speech',
    },
    {
      id: 'noisy-hall',
      why: 'A real session in a loud hall: half the segments are guesses. Usable, but the coach should read it before a child does.',
      text: 'right so the platform is holding but you are dropping the elbow on follow through keep it locked',
      segments: [seg(0.1, -1.4), seg(0.7, -0.9), seg(0.2, -1.6), seg(0.1, -0.3)],
      expect: 'low-confidence',
    },
    {
      id: 'clean',
      why: 'An ordinary clear recording. Must produce no warning at all — a warning on every session trains the coach to ignore warnings.',
      text: 'Good session today, the platform is holding up much better under pressure, keep working the elbow.',
      segments: [seg(0.02, -0.25), seg(0.03, -0.3), seg(0.01, -0.2)],
      expect: 'ok',
    },
    {
      id: 'one-cough',
      why: 'A single non-speech segment in an otherwise clean recording is a cough, not a failure.',
      text: 'Good work on the turns today, keep the tempo through the middle of the set.',
      segments: [seg(0.9, -0.4), seg(0.02, -0.25), seg(0.03, -0.3), seg(0.01, -0.22)],
      expect: 'ok',
    },
    {
      id: 'no-segment-data',
      why: 'An older client, or a provider that returned no segments. Absence of evidence must not become a warning.',
      text: 'Good session today, keep working that elbow through the follow through.',
      segments: [],
      expect: 'ok',
    },
  ]

  for (const c of cases) {
    const got = assessTranscript(c.text, c.segments).quality
    checks++
    if (got === c.expect) {
      console.log(`   ${GREEN}PASS${OFF}  ${c.id.padEnd(20)} ${DIM}${c.why}${OFF}`)
    } else {
      failures.push({ name: `transcript quality · ${c.id}`, detail: `expected ${c.expect}, got ${got}` })
      console.log(`   ${RED}FAIL${OFF}  ${c.id.padEnd(20)} ${RED}expected ${c.expect}, got ${got}${OFF}`)
    }
  }
}

// ── 1b · the sport vocabulary table ───────────────────────────────────────
//
// This value is spliced into a Whisper context prompt AND into the summariser's
// instruction to read ambiguous words as terminology for that sport. Both bias
// decoding toward the words they contain, so a wrong entry is worse than none.
//
// Two things had gone wrong and neither was visible:
//   · a partial matcher mapped Ice Dancing to Ice Hockey, so an ice dancer was
//     transcribed with "slap shot, power play, penalty kill" in the prompt
//   · two keys were not sports at all, reachable only by that partial match

console.log(`\n   ${BOLD}The sport vocabulary${OFF} ${DIM}— exact match or nothing${OFF}`)

{
  const keys = Object.keys(SPORT_TERMINOLOGY)
  const notASport = keys.filter((k) => !ALL_SPORTS.includes(k))
  checks++
  if (notASport.length) {
    failures.push({ name: 'sport vocabulary', detail: `keys that are not sports: ${notASport.join(', ')}` })
    console.log(`   ${RED}FAIL${OFF}  every key is a real sport   ${RED}${notASport.join(', ')}${OFF}`)
  } else {
    console.log(`   ${GREEN}PASS${OFF}  every key is a real sport   ${DIM}${keys.length} keys, all in ALL_SPORTS${OFF}`)
  }

  // No sport may borrow another sport's vocabulary. The check is blunt on
  // purpose: a hint must be either this sport's own entry, or empty.
  const borrowed = []
  for (const sport of ALL_SPORTS) {
    const hint = getSportTerminologyHint(sport)
    if (hint && hint !== SPORT_TERMINOLOGY[sport]) borrowed.push(sport)
  }
  checks++
  if (borrowed.length) {
    failures.push({ name: 'sport vocabulary', detail: `sports given another sport's terms: ${borrowed.slice(0, 6).join(', ')}` })
    console.log(`   ${RED}FAIL${OFF}  no sport borrows another's   ${RED}${borrowed.slice(0, 6).join(', ')}${OFF}`)
  } else {
    console.log(`   ${GREEN}PASS${OFF}  no sport borrows another's   ${DIM}${ALL_SPORTS.filter((s) => getSportTerminologyHint(s)).length}/${ALL_SPORTS.length} have their own${OFF}`)
  }

  // And a sport without an entry says nothing, rather than describing coaching
  // in general and calling it terminology.
  checks++
  const generic = ALL_SPORTS.filter((s) => /athletic performance, coaching cues/.test(getSportTerminologyHint(s)))
  if (generic.length) {
    failures.push({ name: 'sport vocabulary', detail: `${generic.length} sports get the generic filler as "terminology"` })
    console.log(`   ${RED}FAIL${OFF}  no generic filler            ${RED}${generic.length} sports${OFF}`)
  } else {
    console.log(`   ${GREEN}PASS${OFF}  no generic filler            ${DIM}a sport with no entry contributes nothing${OFF}`)
  }
}

// ── 2b · the roster gate ──────────────────────────────────────────────────
//
// transcriptNames answers "is this name in the transcript". That is not the
// same question as "may this be personalised", and the difference is a
// safeguarding bug: on a squad save the same transcript is written once per
// member, so a roster with two Jacks had "Jack, you're dropping your elbow"
// delivered to BOTH of them as their coach addressing them by name. The gate
// reported success each time, because it was only ever shown one name.

console.log(`\n   ${BOLD}The roster gate${OFF} ${DIM}— a first name is not an identifier${OFF}`)

for (const c of fixtures.cases) {
  const roster = c.roster ?? []
  const wrong = []
  for (const name of roster) {
    const inTranscript = transcriptNames(c.transcript, name)
    const shared = roster.filter((n) => n.toLowerCase() === name.toLowerCase()).length
    const allowed = mayPersonalise(c.transcript, name, roster)
    checks++

    // Named and unique on the roster -> personalise.
    // Named but shared with a teammate -> refuse, every time.
    const expected = inTranscript && shared <= 1
    if (allowed !== expected) {
      wrong.push(`${name}: expected ${expected} (inTranscript=${inTranscript}, sharing=${shared}), got ${allowed}`)
    }

    // And the prompt must actually follow the gate: a refused name must not
    // appear in the instruction half.
    if (!allowed) {
      const prompt = buildSummaryPrompt(c.transcript, c.sport, null)
      checks++
      if (prompt.includes('WHO THIS IS FOR')) {
        wrong.push(`${name}: refused by the roster gate but the prompt still personalises`)
      }
    }
  }
  if (wrong.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${c.id.padEnd(20)} ${DIM}${c.why ?? ''}${OFF}`)
  } else {
    failures.push({ name: `roster gate · ${c.id}`, detail: wrong.join('; ') })
    console.log(`   ${RED}FAIL${OFF}  ${c.id.padEnd(20)} ${RED}${wrong.join('; ')}${OFF}`)
  }
}

// ── 3 · properties every prompt must have ─────────────────────────────────

console.log(`\n   ${BOLD}Prompt invariants${OFF} ${DIM}— true for every transcript${OFF}`)

const invariantFails = []
for (const c of fixtures.cases) {
  for (const name of c.roster ?? []) {
    const prompt = buildSummaryPrompt(c.transcript, c.sport, name)
    const named = transcriptNames(c.transcript, name)
    const tag = `${c.id}/${name}`

    // The transcript always arrives whole. A truncated transcript would make
    // the model summarise half a session without anyone noticing.
    if (!check(prompt.includes(c.transcript), 'transcript included verbatim', tag)) {
      invariantFails.push(`${tag}: transcript not included verbatim`)
    }

    // Personalisation appears if and only if the gate opened.
    const hasBlock = prompt.includes('WHO THIS IS FOR')
    if (!check(hasBlock === named, 'personal block iff name in transcript', tag)) {
      invariantFails.push(`${tag}: block=${hasBlock} but gate=${named}`)
    }

    // The instruction half of the prompt must never name a different athlete.
    // Only the transcript may contain other names — the instructions must not,
    // or the model is being told about a child who is not its reader.
    const instructions = prompt.slice(0, prompt.indexOf('TRANSCRIPT'))
    for (const other of c.roster) {
      if (other === name) continue
      // Skip names that are substrings of the addressee (Ana inside Anastasia):
      // the addressee's own name legitimately appears.
      if (named && name.toLowerCase().includes(other.toLowerCase())) continue
      if (transcriptNames(instructions, other)) {
        invariantFails.push(`${tag}: instructions name another athlete (${other})`)
        check(false, 'instructions never name another athlete', tag)
      } else {
        check(true, 'instructions never name another athlete', tag)
      }
    }

    // The sport branch is the one the caller asked for.
    const wantsSport = Boolean((c.sport ?? '').trim())
    const sportOk = wantsSport
      ? prompt.includes(`SPORT: ${c.sport}`)
      : prompt.includes('SPORT: not specified')
    if (!check(sportOk, 'sport branch matches the input', tag)) {
      invariantFails.push(`${tag}: wrong sport branch`)
    }

    // How many bullets the summary asks for. It said "2-5" and, against a
    // 300-character budget, produced three or four; Max asked for five, so the
    // range is gone and the number is stated. A range invites the cheap end.
    if (!check(/^Five bullets, each starting with/m.test(prompt), 'the prompt asks for five bullets', tag)) {
      invariantFails.push(`${tag}: the prompt no longer asks for five bullets`)
    }
    // The sentence that stops five becoming a quota. Without it a firm number
    // is an instruction to invent a fifth point on a two-minute recording, and
    // a fabricated coaching instruction addressed to a named child is the worst
    // output this product can produce. It is not decoration; do not drop it
    // while tuning the count.
    if (!check(prompt.includes('Five is a target, not a quota'), 'five is a target and not a quota', tag)) {
      invariantFails.push(`${tag}: the anti-padding sentence is gone`)
    }

    // The rules that keep the output safe must survive every edit.
    for (const clause of [
      'Never state anything the coach did not say',
      'Never invent drills, numbers, scores or names',
    ]) {
      if (!check(prompt.includes(clause), 'safety clause present', `${tag} · ${clause}`)) {
        invariantFails.push(`${tag}: missing safety clause "${clause}"`)
      }
    }
  }
}

if (invariantFails.length === 0) {
  console.log(`   ${GREEN}PASS${OFF}  every invariant holds for all fixtures`)
} else {
  for (const f of [...new Set(invariantFails)]) console.log(`   ${RED}FAIL${OFF}  ${f}`)
}

// ── 4 · the response parser ───────────────────────────────────────────────

console.log(`\n   ${BOLD}Response parsing${OFF} ${DIM}— recorded model replies${OFF}`)

for (const r of fixtures.replies) {
  const got = parseSummaryResponse(r.content)
  const okSummary = Boolean(got.summary) === r.expect.hasSummary
  const okNext = got.next === r.expect.next
  checks += 2
  if (okSummary && okNext) {
    console.log(`   ${GREEN}PASS${OFF}  ${r.id.padEnd(20)} ${DIM}${r.why ?? ''}${OFF}`)
  } else {
    failures.push({ name: `parse · ${r.id}`, detail: `summary=${JSON.stringify(got.summary)} next=${JSON.stringify(got.next)}` })
    console.log(`   ${RED}FAIL${OFF}  ${r.id.padEnd(20)} got next=${JSON.stringify(got.next)}, wanted ${JSON.stringify(r.expect.next)}`)
  }
}

// A NEXT line is rendered to a child as an instruction, so the ceiling is a
// safety property, not a formatting one.
check(MAX_NEXT_LENGTH <= 200, 'the NEXT ceiling stays short enough to act on', String(MAX_NEXT_LENGTH))
check(TARGET_BULLETS === 5, 'the bullet target is five', String(TARGET_BULLETS))

/* ── The coach's edit survives the save ───────────────────────────────────
 *
 * From 2026-09-25 the summary is drafted at stop-and-transcribe and shown to
 * the coach, who may rewrite it before anything sends. The save route must
 * therefore use what it is given and regenerate ONLY when nothing was sent.
 *
 * Delete that branch and nothing breaks loudly: the save still succeeds, the
 * athlete still receives a summary, and tsc, eslint and next build are all
 * happy. What changes is that a coach who corrected something the model got
 * wrong about a named child has their correction quietly replaced by a second
 * call to the model. That is the shape this rig exists for — a join between
 * two files where both files are individually fine. */
const saveRoute = readFileSync(new URL('../app/api/sessions/route.ts', import.meta.url), 'utf8')
check(
  /body\?\.summary/.test(saveRoute) && /body\?\.next/.test(saveRoute),
  'the save route reads the summary and takeaway the coach was shown',
)
check(
  /coachSupplied\s*$|coachSupplied\s*\n?\s*\?/m.test(saveRoute) ||
    /\bcoachSupplied\b[\s\S]{0,120}makeQuickSummary/.test(saveRoute),
  'the save route regenerates only when the coach sent nothing',
)
check(
  /MAX_NEXT_LENGTH/.test(saveRoute),
  'a coach-typed takeaway is held to the same ceiling as the model\'s',
)

const draftRoute = readFileSync(new URL('../app/api/sessions/summary/route.ts', import.meta.url), 'utf8')
check(
  /coach_id/.test(draftRoute) && /who\.userId/.test(draftRoute),
  'the draft route scopes the athlete to the caller\'s own roster',
)


// ── 4b · one recording, several athletes ──────────────────────────────────
//
// Max, 2026-09-26: "Splitting the summary just has to be careful." Careful
// means Kai never reads what the coach said about Mia. Three guards, all run
// here: the name gate decides who the model may write for at all, the prompt
// says what may go in a section, and the parser checks what comes back.

console.log(`\n   ${BOLD}Splitting one recording${OFF} ${DIM}— each athlete gets only their own part${OFF}`)

{
  const pass = (ok, name, detail = '') => {
    checks++
    if (ok) console.log(`   ${GREEN}PASS${OFF}  ${name}`)
    else {
      failures.push({ name: `split · ${name}`, detail })
      console.log(`   ${RED}FAIL${OFF}  ${name}   ${RED}${detail}${OFF}`)
    }
  }

  // The gate: who the model is even asked about.
  for (const c of fixtures.splits.cases) {
    const { eligible, skipped } = splitEligibility(c.transcript, c.athletes)
    const gotEligible = eligible.map((a) => a.id)
    const gotSkipped = Object.fromEntries(skipped.map((s) => [s.athlete_id, s.reason]))
    pass(
      JSON.stringify(gotEligible) === JSON.stringify(c.expectEligible) &&
        JSON.stringify(gotSkipped) === JSON.stringify(c.expectSkipped),
      `gate · ${c.id}`,
      `eligible=${JSON.stringify(gotEligible)} skipped=${JSON.stringify(gotSkipped)}`,
    )
    // An athlete the gate skipped is never named in the prompt, so the model
    // is never invited to write for someone the coach did not speak to.
    const prompt = buildSplitSummaryPrompt(c.transcript, c.sport, eligible)
    const athletesBlock = prompt.slice(prompt.indexOf('THE ATHLETES'), prompt.indexOf('SPORT:'))
    const leaked = c.athletes.filter((a) => !gotEligible.includes(a.id) && athletesBlock.includes(a.id))
    pass(leaked.length === 0, `prompt · ${c.id} lists only the athletes the coach named`, leaked.map((a) => a.id).join(', '))
    const sections = assembleSplit(c.athletes, skipped, [])
    pass(
      sections.length === c.athletes.length && sections.every((s, i) => s.athlete_id === c.athletes[i].id && s.summary === null),
      `assemble · ${c.id} gives every athlete a section, empty when skipped`,
      JSON.stringify(sections),
    )
  }

  // What the prompt must always say.
  const c0 = fixtures.splits.cases[0]
  const eligible0 = splitEligibility(c0.transcript, c0.athletes).eligible
  const p0 = buildSplitSummaryPrompt(c0.transcript, c0.sport, eligible0)
  for (const [needle, name] of [
    ['Never copy it into another athlete\'s section', 'forbids copying one athlete\'s point to another'],
    ['Never mention any other athlete by name', 'forbids naming another athlete'],
    ['Never compare one athlete with another', 'forbids comparisons'],
    ['give that athlete an empty summary', 'asks for an empty summary rather than an invented one'],
    ['Never state anything the coach did not say', 'forbids invention'],
  ]) pass(p0.includes(needle), `prompt ${name}`)
  pass(p0.trim().endsWith(c0.transcript.trim()), 'prompt ends with the transcript')
  pass(eligible0.every((a) => p0.includes(`id "${a.id}"`)), 'prompt lists every eligible athlete by id')

  // Parity with the single summariser, so the two cannot drift apart on the
  // parts that protect a child: the body rule, and the sport handling.
  const single = buildSummaryPrompt(c0.transcript, c0.sport, null)
  const block = (t, from, to) => t.slice(t.indexOf(from), t.indexOf(to, t.indexOf(from)))
  pass(block(p0, 'ABOUT THEIR BODY', '\n\n') === block(single, 'ABOUT THEIR BODY', '\n\n') && p0.includes('ABOUT THEIR BODY'),
    'body rule is word for word the single summariser\'s')
  for (const sport of [c0.sport, null]) {
    const a = buildSplitSummaryPrompt(c0.transcript, sport, eligible0)
    const b = buildSummaryPrompt(c0.transcript, sport, null)
    pass(block(a, 'SPORT:', 'WHAT YOU ARE READING') === block(b, 'SPORT:', 'WHAT YOU ARE READING'),
      `sport block matches the single summariser's (${sport ?? 'no sport'})`)
  }
  pass(MAX_SPLIT_ATHLETES === 5, 'a split is capped at five athletes', String(MAX_SPLIT_ATHLETES))

  // The parser, over recorded replies.
  for (const r of fixtures.splits.replies) {
    let got = null
    let err = null
    try { got = parseSplitSummaryResponse(r.content, r.requested) } catch (e) { err = e }
    if (r.expectError) {
      pass(err instanceof SplitParseError, `parse · ${r.id}`, err ? String(err) : `parsed: ${JSON.stringify(got)}`)
      continue
    }
    if (err) { pass(false, `parse · ${r.id}`, String(err)); continue }
    const wrong = []
    for (const [id, want] of Object.entries(r.expect)) {
      const s = got.find((x) => x.athlete_id === id)
      if (!s) { wrong.push(`${id}: missing`); continue }
      if (s.reason !== want.reason) wrong.push(`${id}: reason ${s.reason}, wanted ${want.reason}`)
      if (Boolean(s.summary) !== want.hasSummary) wrong.push(`${id}: summary ${JSON.stringify(s.summary)}`)
      if (s.next !== want.next) wrong.push(`${id}: next ${JSON.stringify(s.next)}, wanted ${JSON.stringify(want.next)}`)
    }
    pass(wrong.length === 0, `parse · ${r.id}`, wrong.join('; '))

    // The property, on every reply: exactly the requested athletes come back,
    // in request order, and nothing written for anyone else survives.
    const ids = got.map((s) => s.athlete_id)
    const requested = r.requested.map((a) => a.id)
    const text = JSON.stringify(got)
    const surfaced = (r.forbidden ?? []).filter((f) => text.includes(f))
    pass(
      JSON.stringify(ids) === JSON.stringify(requested) && surfaced.length === 0,
      `parse · ${r.id} returns only the requested athletes`,
      `ids=${JSON.stringify(ids)} surfaced=${JSON.stringify(surfaced)}`,
    )
  }

  // The save, offline path: one session per athlete, the same shared id on
  // every one, and only that athlete's own summary on it.
  const rec = {
    id: 'r1', mode: 'several', athleteIds: ['a-kai', 'a-mia'], athleteId: null, groupId: null, groupName: null,
    memberIds: [], sharedRecordingId: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
    drafts: { 'a-kai': { summary: '• KAI-ONLY', next: 'kai next' }, 'a-mia': { summary: '', next: '' } },
    sessionName: 'Hitting', sessionDate: '2026-09-26', coachSport: 'Volleyball', shareWithAthlete: true, mimeType: 'audio/mp4',
  }
  const bodies = sessionBodies(rec, 'the whole transcript', 'coach/x.mp4')
  pass(
    bodies.length === 2 &&
      bodies.every((b) => b.shared_recording_id === rec.sharedRecordingId && !b.group_id) &&
      bodies[0].athlete_id === 'a-kai' && bodies[0].summary === '• KAI-ONLY' &&
      bodies[1].athlete_id === 'a-mia' && bodies[1].summary === null && !JSON.stringify(bodies[1]).includes('KAI-ONLY'),
    'queued save: one body per athlete, same shared id, each with only their own summary',
    JSON.stringify(bodies),
  )
  let threw = false
  try { sessionBodies({ ...rec, sharedRecordingId: null }, 't', null) } catch { threw = true }
  pass(threw, 'queued save refuses a several-athlete recording with no shared id')
  const narrowed = narrowAfterPartialSave(rec, [true, false])
  pass(JSON.stringify(narrowed) === JSON.stringify({ athleteIds: ['a-mia'] }), 'a partial save narrows the queue to whoever is missing', JSON.stringify(narrowed))

  // The joins between files that each look fine alone.
  const saveSrc = readFileSync(new URL('../app/api/sessions/route.ts', import.meta.url), 'utf8')
  pass(/coachSupplied\s*=\s*Boolean\(shared_recording_id\)\s*\|\|/.test(saveSrc),
    'the save route never regenerates a shared recording\'s summary from the combined transcript')
  const splitRoute = readFileSync(new URL('../app/api/sessions/split-summary/route.ts', import.meta.url), 'utf8')
  pass(/\.in\(\s*'id',\s*ids\s*\)/.test(splitRoute) && /\.eq\(\s*'coach_id',\s*who\.userId\s*\)/.test(splitRoute) &&
    /ids\.some\(\(id\)\s*=>\s*!found\.has\(id\)\)/.test(splitRoute),
    'the split route scopes every athlete id to the caller\'s roster and rejects any it cannot find')
  pass(/splitEligibility\(/.test(splitRoute) && /buildSplitSummaryPrompt\(transcript,\s*sport,\s*eligible\)/.test(splitRoute),
    'the split route prompts for the gated athletes only')
}

// ── 5 · live mode ─────────────────────────────────────────────────────────

if (process.argv.includes('--live')) {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    console.log(`\n   ${YELLOW}--live needs OPENAI_API_KEY; skipping the model calls.${OFF}`)
  } else {
    console.log(`\n   ${BOLD}Live model output${OFF} ${DIM}— reports, does not gate${OFF}`)
    const c = fixtures.cases.find((x) => x.id === 'squad-two-named')
    for (const name of ['Ana', 'Jonas']) {
      const prompt = buildSummaryPrompt(c.transcript, c.sport, name)
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) {
        console.log(`   ${RED}the API returned ${res.status}${OFF}`)
        continue
      }
      const json = await res.json()
      const parsed = parseSummaryResponse(json?.choices?.[0]?.message?.content ?? '')
      const others = c.roster.filter((r) => r !== name)
      const leaked = others.filter((o) => transcriptNames(parsed.summary ?? '', o))
      console.log(`\n   ${BOLD}for ${name}${OFF}`)
      for (const line of (parsed.summary ?? '(no summary)').split('\n')) console.log(`     ${line}`)
      if (parsed.next) console.log(`     ${DIM}NEXT: ${parsed.next}${OFF}`)
      console.log(
        leaked.length === 0
          ? `     ${GREEN}names no other athlete${OFF}`
          : `     ${RED}LEAKED another athlete's name: ${leaked.join(', ')}${OFF}`,
      )
    }
  }
}

// ── result ────────────────────────────────────────────────────────────────

console.log('')
if (failures.length === 0) {
  console.log(`  ${GREEN}✓ ${checks} checks passed over ${fixtures.cases.length} transcripts and ${fixtures.replies.length} replies.${OFF}\n`)
  process.exit(0)
}
console.log(`  ${RED}✗ ${failures.length} failure${failures.length === 1 ? '' : 's'} of ${checks} checks.${OFF}\n`)
process.exit(1)
