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

const { buildSummaryPrompt, transcriptNames, parseSummaryResponse, MAX_NEXT_LENGTH, TARGET_BULLETS } =
  await import(pathToFileURL(path.join(ROOT, 'lib/summary-prompt.ts')).href)

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
