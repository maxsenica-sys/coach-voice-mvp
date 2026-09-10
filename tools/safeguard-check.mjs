#!/usr/bin/env node
/**
 * tools/safeguard-check.mjs — the safeguarding rules, as a build gate.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * CoachVoice is used by children. Roughly 13 to 18, many of them minors, and
 * the app holds their voice recordings, their photographs, their coach's
 * candid remarks about them, and five daily numbers about how they are
 * sleeping and feeling.
 *
 * The rules protecting all of that are real, considered, and written down in
 * three places: `CLAUDE.md`, `product-review/PROJECT-STATE.md`, and prose
 * comments at the top of the files that implement them. Every one of those is
 * a sentence asking a human to remember something.
 *
 * Nothing enforced any of it. A new API route could ship with no auth check
 * and every check in this repo would pass. A component could import the
 * service-role key into a browser bundle and `next build` would say nothing.
 * The one time a private bucket was nearly exposed through `getPublicUrl`, it
 * was caught by a person reading a diff, and the evidence is a comment in
 * `MessagingPanel.tsx` reading "FIX 2".
 *
 * This file turns the sentences into checks. Each rule cites where the rule is
 * written, so a failure explains itself rather than just refusing.
 *
 * ── The honest limits ─────────────────────────────────────────────────────
 *
 * This is a static scanner. It reads source text; it cannot run the app, log
 * in as a child, or reason about what a query returns. Several of the most
 * important safeguarding properties in this product are therefore out of its
 * reach, and pretending otherwise would be worse than not having it — a green
 * tick that means less than the reader assumes is a liability. So the gaps are
 * printed on every run, under KNOWN GAPS, and they are not counted as passes.
 *
 * Usage:  node tools/safeguard-check.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

// ── source collection ─────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'lib'))].map((full) => {
  const text = readFileSync(full, 'utf8')
  return {
    rel: path.relative(ROOT, full),
    text,
    lines: text.split('\n'),
    isClient: /^\s*['"]use client['"]/m.test(text),
    isRoute: /\/route\.ts$/.test(full),
  }
})

/** Line number (1-indexed) of the first line matching `re`, or 0. */
function lineOf(file, re) {
  const i = file.lines.findIndex((l) => re.test(l))
  return i === -1 ? 0 : i + 1
}

/**
 * Strip `//` and block comments so a rule cannot be tripped, or satisfied, by
 * prose. `MessagingPanel.tsx` contains the words "instead of getPublicUrl" in a
 * comment explaining a past fix; a scanner that counted that as a violation
 * would be teaching people not to write comments.
 */
function code(file) {
  return file.text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

// ── the rules ─────────────────────────────────────────────────────────────

/**
 * Routes that are unauthenticated on purpose, each with the reason.
 *
 * An exemption list is the honest way to do this: the alternative is a rule
 * loose enough that the callback passes, which is a rule that would also pass
 * a route that simply forgot. Anything added here is a deliberate decision
 * someone has to write a sentence to justify, and it is printed on every run.
 */
const UNAUTHENTICATED_BY_DESIGN = {
  'app/auth/callback/route.ts':
    'The Supabase auth code exchange. It is what creates the session, so it cannot require one. It accepts only a `code` and redirects; it reads no table.',
}

const RULES = [
  {
    id: 'SG1',
    title: 'Every API route authenticates before it answers',
    why: 'A route that forgets `auth.getUser()` serves a child\'s sessions, wellness scores or messages to anyone who guesses the URL. There is no public surface in this product and there must not be one by accident.',
    cite: 'PROJECT-STATE.md — "CoachVoice has no public surface at all"',
    check(files) {
      const found = []
      for (const f of files) {
        if (!f.isRoute) continue
        const src = code(f)
        const handlers = [...src.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)/g)]
        if (handlers.length === 0) continue
        if (f.rel in UNAUTHENTICATED_BY_DESIGN) continue
        const authed = /auth\.getUser\(\)/.test(src)
        const guards401 = /401/.test(src)
        if (!authed) {
          found.push({ file: f.rel, line: lineOf(f, /export\s+async\s+function/), msg: 'no auth.getUser() anywhere in the file' })
        } else if (!guards401) {
          found.push({ file: f.rel, line: lineOf(f, /auth\.getUser\(\)/), msg: 'calls auth.getUser() but never returns 401' })
        }
      }
      return found
    },
  },

  {
    id: 'SG2',
    title: 'The service-role key never reaches a browser bundle',
    why: 'The service role bypasses every row-level security policy in the database. In a client component it would be shipped to every phone that opens the app, handing any user the whole table of every coach\'s athletes.',
    cite: 'lib/supabase-admin.ts — server-only by construction',
    check(files) {
      const found = []
      for (const f of files) {
        if (!f.isClient) continue
        const src = code(f)
        if (/from\s+['"]@\/lib\/supabase-admin['"]/.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, /supabase-admin/), msg: 'imports the admin (service-role) client' })
        }
        if (/SERVICE_ROLE/.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, /SERVICE_ROLE/), msg: 'references the service-role key' })
        }
        for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
          if (!m[1].startsWith('NEXT_PUBLIC_') && m[1] !== 'NODE_ENV') {
            found.push({ file: f.rel, line: lineOf(f, new RegExp(m[1])), msg: `reads server env var ${m[1]}` })
          }
        }
      }
      return found
    },
  },

  {
    id: 'SG3',
    title: 'Private buckets are never made public',
    why: 'All four storage buckets — session audio, session video, message media and athlete photos — hold identifiable material about minors and are private. `getPublicUrl` mints a URL that needs no session at all, so one call turns a child\'s photograph into an open link. This has already been caught once by hand.',
    cite: 'app/components/MessagingPanel.tsx — the "FIX 2" comment; PROJECT-STATE.md — "Storage buckets, all private"',
    check(files) {
      const found = []
      for (const f of files) {
        const src = code(f)
        if (/\.getPublicUrl\s*\(/.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, /getPublicUrl\s*\(/), msg: 'mints a public storage URL' })
        }
      }
      return found
    },
  },

  {
    id: 'SG4',
    title: 'Coach-attention data never reaches an athlete surface',
    why: 'The coverage ranking answers "which of these children has the coach spent least time on". Shown to a coach it is a prompt to act. Shown to a child it is either a wound or a league table of who the coach likes best, which is the comparison-between-kids this product forbids outright.',
    cite: 'lib/attention.ts — "Coach-only, always"; PROJECT-STATE.md safeguarding limits',
    check(files) {
      const found = []
      const forbidden = /@\/lib\/attention|athletes\/coverage/
      for (const f of files) {
        // Athlete-facing surfaces: the athlete app, and the athlete's own
        // shared session view is role-agnostic so it is included too.
        if (!/^app\/athlete\//.test(f.rel)) continue
        const src = code(f)
        if (forbidden.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, forbidden), msg: 'athlete surface imports coach-attention data' })
        }
      }
      return found
    },
  },

  {
    id: 'SG5',
    title: 'Wellness rows are always scoped to one athlete or one coach',
    why: 'wellness_checkins is the most sensitive table in the database: five daily health numbers per child, and the input to the caretaker alert. An unscoped read is every child in the system.',
    cite: 'PROJECT-STATE.md — health data is limited to the athlete, their coach and their registered caretaker',
    check(files) {
      const found = []
      for (const f of files) {
        const src = code(f)
        if (!/wellness_checkins/.test(src)) continue
        const scoped = /\.eq\(\s*['"](athlete_id|coach_id|id)['"]/.test(src)
        if (!scoped) {
          found.push({ file: f.rel, line: lineOf(f, /wellness_checkins/), msg: 'queries wellness_checkins with no athlete_id/coach_id scope' })
        }
      }
      return found
    },
  },

  {
    id: 'SG6',
    title: 'The athlete client never selects a session transcript',
    why: 'A group recording writes the coach\'s whole squad talk to one row per member, and it names other children. The athlete app used to select that column and render it, so every member could read what the coach said about every other member. Withholding it in the UI is not a fix — a column the browser can query is a column it has. Transcripts now come only from the detail route, which withholds squad ones server-side.',
    cite: 'supabase/migrations/023_sessions_group_id.sql; the note on SessionRow.group_id in app/athlete/page.tsx',
    check(files) {
      const found = []
      for (const f of files) {
        if (!/^app\/athlete\//.test(f.rel)) continue
        const src = code(f)
        // Any Supabase select on `sessions` from the athlete client that names
        // the transcript column. The detail-route fetch is a plain HTTP call
        // and does not match.
        for (const m of src.matchAll(/\.from\(\s*['"]sessions['"]\s*\)([\s\S]{0,400}?)\)/g)) {
          if (/\btranscript\b/.test(m[1])) {
            found.push({
              file: f.rel,
              line: lineOf(f, /\.from\(\s*['"]sessions['"]/),
              msg: 'athlete client selects the transcript column directly',
            })
          }
        }
      }
      return found
    },
  },

  {
    id: 'SG7',
    title: 'A recording never carries a hardcoded audio type or extension',
    why: 'Chrome records audio/webm and iOS records audio/mp4, and Whisper reads the codec from the FILENAME EXTENSION. A hardcoded extension means the transcription silently fails or mis-transcribes on Apple devices only — so a child\'s session is lost, the coach is told nothing useful, and it looks like a flake. This is checklist item 4 in CLAUDE.md, which until now was a sentence asking a human to remember.',
    cite: 'CLAUDE.md — "Protected recording call sites"; lib/audio-mime.ts',
    check(files) {
      const found = []
      for (const f of files) {
        // lib/audio-mime.ts is where the mapping is allowed to name the types.
        if (f.rel === 'lib/audio-mime.ts') continue
        const src = code(f)
        // A literal audio type passed into a File, Blob or MediaRecorder.
        //
        // A FALLBACK is allowed and is what CLAUDE.md's own example does:
        // `recorder.mimeType || 'audio/webm'` reads the real type and only
        // names one when the browser reported nothing. What must never happen
        // is the literal being the *only* source of the type. So a match is a
        // violation only when it is not preceded by `||` or `??`.
        for (const m of src.matchAll(/new\s+(File|Blob|MediaRecorder)\s*\([\s\S]{0,240}?\)/g)) {
          const literal = /(\|\||\?\?)\s*['"]audio\/|['"]audio\/(webm|mp4|ogg)/.exec(m[0])
          const isFallback = /(\|\||\?\?)\s*['"]audio\//.test(m[0])
          if (literal && !isFallback) {
            found.push({
              file: f.rel,
              line: lineOf(f, /new\s+(File|Blob|MediaRecorder)/),
              msg: `hardcodes an audio type in new ${m[1]}(...) with no detected type behind it`,
            })
          }
        }
        // A filename with a baked-in audio extension.
        if (/`recording\.(webm|mp4|ogg)`|['"]recording\.(webm|mp4|ogg)['"]/.test(src)) {
          found.push({
            file: f.rel,
            line: lineOf(f, /recording\.(webm|mp4|ogg)/),
            msg: 'hardcodes the recording filename extension',
          })
        }
      }
      return found
    },
  },
]

/**
 * Properties that matter as much as the rules above and that a static scanner
 * cannot decide. Printed every run so the gate is never mistaken for coverage
 * it does not have.
 */
const KNOWN_GAPS = [
  'Whether the transcript withholding is correct for sessions saved BEFORE `sessions.group_id` existed. Those rows are null, so they are not identifiable as squad sessions. They are covered from the other end — the athlete client no longer selects transcripts at all — but SG6 is what enforces that, and a future direct fetch could reintroduce the leak for historic rows without tripping the group check.',
  'Whether a route\'s ownership check is *correct* — SG1 proves a route authenticates, not that it then scopes the query to the right coach.',
  'Whether row-level security policies in Supabase actually match what the routes assume. The policies live in migrations and are enforced by the database, not by anything this scanner reads.',
  'Whether the offline recording queue actually works in a browser. It is IndexedDB, the `online` event and a resumable three-stage upload, none of which a static scanner or a Node rig can exercise. The boot harness drives real Chromium but only asserts on the cold-start timeline. This is the largest untested surface in the app and it is the one holding the only copy of a recording.',
  'What the Focus Card image actually contains. It is built to carry the coaching sentence, the date and the wordmark and nothing else — no name, no photo, no URL, no session id — because it is designed to leave the app. That constraint lives in canvas drawing code and cannot be checked by reading source shape, so it has to be re-read by a human whenever app/components/FocusCard.tsx changes.',
  'What the AI summariser writes about a child. `tools/prompt-rig.mjs` covers the prompt; nothing covers a model\'s output on an unseen transcript.',
]

// ── run ───────────────────────────────────────────────────────────────────

console.log(`\n  ${DIM}Safeguarding check — the rules that protect a minor's data, enforced${OFF}\n`)

let failed = 0
for (const rule of RULES) {
  const violations = rule.check(FILES)
  if (violations.length === 0) {
    console.log(`   ${GREEN}PASS${OFF}  ${rule.id}  ${rule.title}`)
  } else {
    failed += violations.length
    console.log(`   ${RED}FAIL${OFF}  ${rule.id}  ${rule.title}`)
    console.log(`         ${DIM}Why this rule exists:${OFF} ${rule.why}`)
    console.log(`         ${DIM}Written down at:${OFF} ${rule.cite}`)
    for (const v of violations) {
      console.log(`         ${RED}${v.file}:${v.line}${OFF} — ${v.msg}`)
    }
  }
}

const exemptions = Object.entries(UNAUTHENTICATED_BY_DESIGN)
if (exemptions.length) {
  console.log(`\n  ${BOLD}DELIBERATE EXEMPTIONS${OFF} ${DIM}— unauthenticated on purpose${OFF}`)
  for (const [file, reason] of exemptions) {
    console.log(`   ${YELLOW}·${OFF} ${file}`)
    console.log(`     ${DIM}${reason}${OFF}`)
  }
}

console.log(`\n  ${BOLD}KNOWN GAPS${OFF} ${DIM}— real risks this check cannot see${OFF}`)
for (const gap of KNOWN_GAPS) {
  const wrapped = gap.match(/.{1,74}(\s|$)/g) ?? [gap]
  console.log(`   ${YELLOW}·${OFF} ${wrapped.map((l, i) => (i ? '     ' + l.trim() : l.trim())).join('\n')}`)
}

console.log('')
if (failed === 0) {
  console.log(`  ${GREEN}✓ ${RULES.length} safeguarding rules hold across ${FILES.length} source files.${OFF}`)
  console.log(`  ${DIM}  ${KNOWN_GAPS.length} known gaps remain unchecked — see above.${OFF}\n`)
  process.exit(0)
}
console.log(`  ${RED}✗ ${failed} safeguarding violation${failed === 1 ? '' : 's'}.${OFF}\n`)
process.exit(1)
