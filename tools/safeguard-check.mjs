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
  /* Line endings are normalised, and this is not cosmetic — it decides
   * whether the rules below run at all.
   *
   * On a Windows checkout the files arrive with CRLF, so every line handed to
   * `code()` ends in a carriage return. In a JavaScript regex \r is a line
   * terminator, so `.` does not match it: the //-stripping pattern never
   * reaches the end of the line, never matches, and silently strips nothing.
   * Every rule that greps for a table or an API name then finds that name in a
   * comment *about* it. SG5 fired on lib/body-map.ts, which contains no query
   * at all — only a sentence mentioning wellness_checkins — and SG7 fired on
   * lib/audio-mime.ts, which is its own documented exemption.
   *
   * Both were false, and both had been failing for anyone running this outside
   * CI. That is worse than a missing rule: two red lines make the whole report
   * look untrustworthy, so the real ones stop being read.
   */
  const text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  return {
    // Forward slashes, always. The exemptions below compare `rel` against
    // literal paths like 'lib/audio-mime.ts', and path.relative yields
    // backslashes on Windows — so an exemption stops applying on exactly the
    // machine the author is sitting at.
    rel: path.relative(ROOT, full).split(path.sep).join('/'),
    text,
    lines: text.split('\n'),
    isClient: /^\s*['"]use client['"]/m.test(text),
    isRoute: /\/route\.ts$/.test(full),
  }
})

/* ── migrations, as the database will hold them ─────────────────────────────
 *
 * The routes are only half the access model; row-level security is the other
 * half, and every hole closed by migration 033 was in the half this scanner
 * never read. A policy that says "coach_id = auth.uid()" and nothing about WHO
 * the row is about type-checks, builds and passes every route rule here.
 *
 * So the migrations are replayed, in filename order, into the set of policies,
 * triggers and function bodies that the LAST migration leaves standing. That is
 * what the database holds if every file has been applied — and it is only that:
 * a policy created by hand in the dashboard (see migration 017's header) is
 * invisible here, which is why that is listed under KNOWN GAPS.
 */
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')

function replayMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const policies = new Map() // `${table}::${name}` -> { table, name, cmd, using, check, file }
  const triggers = new Map() // `${table}::${name}` -> { table, name, timing, fn, file }
  const functions = new Map() // name -> { body, file }
  for (const file of files) {
    let sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n')
    sql = sql.replace(/--[^\n]*/g, '')
    // Function bodies first: they contain semicolons, and they are what a
    // trigger actually runs.
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/gi)) {
      functions.set(m[1].toLowerCase(), { body: m[2], file })
    }
    sql = sql.replace(/\$\$[\s\S]*?\$\$/g, '')
    for (const raw of sql.split(';')) {
      const stmt = raw.replace(/\s+/g, ' ').trim()
      const table = (s) => s.replace(/^public\./i, '').toLowerCase()
      let m
      if ((m = stmt.match(/^drop policy (?:if exists )?"([^"]+)" on ([\w.]+)/i))) {
        policies.delete(`${table(m[2])}::${m[1]}`)
      } else if ((m = stmt.match(/^create policy "([^"]+)" on ([\w.]+)(.*)$/i))) {
        const rest = m[3]
        const cmd = (rest.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? 'all').toLowerCase()
        const checkIdx = rest.search(/\bwith check\b/i)
        const usingIdx = rest.search(/\busing\b/i)
        const using = usingIdx === -1 ? '' : rest.slice(usingIdx, checkIdx > usingIdx ? checkIdx : undefined)
        const check = checkIdx === -1 ? '' : rest.slice(checkIdx)
        policies.set(`${table(m[2])}::${m[1]}`, { table: table(m[2]), name: m[1], cmd, using, check, file })
      } else if ((m = stmt.match(/^drop trigger (?:if exists )?(\w+) on ([\w.]+)/i))) {
        triggers.delete(`${table(m[2])}::${m[1].toLowerCase()}`)
      } else if ((m = stmt.match(/^create trigger (\w+) (before|after) (.*?) on ([\w.]+) .*execute (?:function|procedure) (?:public\.)?(\w+)/i))) {
        triggers.set(`${table(m[4])}::${m[1].toLowerCase()}`, { table: table(m[4]), name: m[1], timing: `${m[2]} ${m[3]}`.toLowerCase(), fn: m[5].toLowerCase(), file })
      }
    }
  }
  return { policies: [...policies.values()], triggers: [...triggers.values()], functions }
}

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

/**
 * A route file's exported handlers, each as its own chunk of source.
 *
 * Rules about routes must judge GET and POST separately, and two rules here
 * learned that the hard way. SG8's first version tested whole files and was
 * proven useless by its own mutation test: the vulnerable GET was reinstated
 * and it stayed green, because POST in the same file carried a correct check.
 * SG1 had the identical flaw and had had it from the start — deleting the auth
 * call from one handler left the file passing on the strength of its siblings.
 *
 * One handler's correctness standing in for another's absence is precisely the
 * bug these rules exist to catch, so the split lives here and both use it.
 */
function handlerBlocks(src) {
  return src
    .split(/(?=export\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE)\b)/)
    .filter((b) => /^export\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/.test(b))
    .map((b) => ({ name: (b.match(/function\s+(\w+)/) || [])[1] ?? '?', src: b }))
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
    why: 'A route that forgets to establish who is calling serves a child\'s sessions, wellness scores or messages to anyone who guesses the URL. There is no public surface in this product and there must not be one by accident.',
    cite: 'PROJECT-STATE.md — "CoachVoice has no public surface at all"; lib/route-identity.ts',
    check(files) {
      const found = []
      for (const f of files) {
        if (!f.isRoute) continue
        const src = code(f)
        const handlers = handlerBlocks(src)
        if (handlers.length === 0) continue
        if (f.rel in UNAUTHENTICATED_BY_DESIGN) continue
        /* Two accepted ways to establish the caller, and no third.
         *
         * `auth.getUser()` asks the Auth server. `routeIdentity()` verifies the
         * token's signature and expiry locally against a cached JWKS, falling
         * back to the network only while the project signs with the legacy
         * shared secret — the same mechanism proxy.ts has used since the
         * cold-start work, moved into lib/route-identity.ts so routes stop
         * paying two round trips to learn what the token already says.
         *
         * Both are real authentication. What is NOT accepted is reading a user
         * id out of a body, a query string or a header, which is why this
         * matches on the two helpers by name rather than on anything looser.
         */
        // Module scope counts: a file may resolve the caller once in a helper
        // and every handler call it. What must not count is a SIBLING handler's
        // check — see handlerBlocks above.
        const moduleScope = src.split(/export\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/)[0]
        const ESTABLISHES = /auth\.getUser\(\)|\brouteIdentity\s*\(/
        const helperNames = [...moduleScope.matchAll(/(?:async\s+)?function\s+(\w+)[\s\S]{0,900}?\n\}/g)]
          .filter((m) => ESTABLISHES.test(m[0]))
          .map((m) => m[1])

        for (const h of handlers) {
          const viaHelper = helperNames.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(h.src))
          const authed = ESTABLISHES.test(h.src) || viaHelper
          const guards401 = /401/.test(h.src) || (viaHelper && /401/.test(moduleScope))
          if (!authed) {
            found.push({
              file: f.rel,
              line: lineOf(f, new RegExp(`export\\s+async\\s+function\\s+${h.name}\\b`)),
              msg: `${h.name} never establishes the caller (no auth.getUser() or routeIdentity())`,
            })
          } else if (!guards401) {
            found.push({
              file: f.rel,
              line: lineOf(f, new RegExp(`export\\s+async\\s+function\\s+${h.name}\\b`)),
              msg: `${h.name} establishes the caller but never returns 401`,
            })
          }
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
      // Extended 2026-09-26 with every coach-only figure batch 1 added: the
      // repeated-phrase and reply insights, the roster coverage ranking, the
      // pre-session brief (who has not checked in) and the access log (when a
      // child opened something). Each is about one child as seen by the coach.
      const forbidden = /@\/lib\/attention|athletes\/coverage|@\/lib\/insights|coach\/insights|coach\/brief|coach\/access-log|CoverageInsight|CoachInsights|PreSessionBrief|components\/AccessLog/
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
    title: 'The athlete client never selects a session transcript, and the detail route withholds squad and shared-recording ones',
    why: 'A group recording writes the coach\'s whole squad talk to one row per member, and it names other children. The athlete app used to select that column and render it, so every member could read what the coach said about every other member. Withholding it in the UI is not a fix — a column the browser can query is a column it has. Transcripts now come only from the detail route, which withholds squad ones server-side. A recording about several athletes (shared_recording_id, migration 029) is the same shape — one transcript naming every athlete in it — and is withheld by the same expression.',
    cite: 'supabase/migrations/023_sessions_group_id.sql; supabase/migrations/029_shared_recording.sql; the note on SessionRow.group_id in app/athlete/page.tsx',
    check(files) {
      const found = []

      /* The other end: the one route that serves a transcript to an athlete.
       *
       * Its rule is one expression, and it is the whole of the protection for
       * two kinds of recording that name other children — a squad talk
       * (group_id, migration 023) and one recording split between several
       * athletes (shared_recording_id, migration 029). Drop either condition
       * and the route type-checks, builds, and serves the combined transcript
       * to every athlete in it. So the expression must name both, and the
       * shared-recording flag must actually be read from the column. */
      const DETAIL = 'app/api/sessions/[id]/detail/route.ts'
      const detail = files.find((f) => f.rel === DETAIL)
      if (!detail) {
        found.push({ file: DETAIL, line: 0, msg: 'the session detail route is missing — nothing withholds squad or shared-recording transcripts' })
      } else {
        const src = code(detail)
        const expr = src.match(/\btranscript\s*:\s*([^\n]*\bsession\.transcript\b[^\n]*)/)
        const line = lineOf(detail, /\btranscript\s*:.*\bsession\.transcript\b/)
        if (!expr) {
          found.push({ file: DETAIL, line, msg: 'cannot find the expression that decides whether the transcript is sent' })
        } else {
          if (!/\bgroup_id\b/.test(expr[1])) {
            found.push({ file: DETAIL, line, msg: 'transcript is not withheld from athletes for squad sessions (no group_id condition)' })
          }
          // Either the column itself, or a local whose value is read from it.
          const sharedVar = expr[1].match(/!\s*([A-Za-z_$][\w$]*)/g)?.map((m) => m.replace(/^!\s*/, '')) ?? []
          const selectsColumn = (text) => /\.select\(\s*['"`][^'"`]*\bshared_recording_id\b/.test(text)
          // The local must be assigned from the column: either a select of it
          // on the same line, or a call to a function whose body selects it.
          // `const sharedRecording = false` satisfies the expression and
          // protects nobody, and was the first mutation this rule let through.
          const derivedFromColumn = (v) => {
            const rhs = src.match(new RegExp(`\\b${v}\\s*=(?!=)([^\\n]*)`))?.[1] ?? ''
            if (selectsColumn(rhs)) return true
            return [...rhs.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].some(([, fn]) => {
              const body = src.match(new RegExp(`function\\s+${fn}\\s*\\([\\s\\S]*?\\n\\}`))?.[0] ?? ''
              return selectsColumn(body)
            })
          }
          const conditioned =
            (/\bshared_recording_id\b/.test(expr[1]) && selectsColumn(src)) ||
            sharedVar.some((v) => derivedFromColumn(v))
          if (!conditioned) {
            found.push({ file: DETAIL, line, msg: 'transcript is not withheld from athletes for shared recordings (no shared_recording_id condition)' })
          }
        }
      }

      // The audio of a squad or shared recording is the transcript spoken. The
      // signed-URL route decides athlete access on its own, so it must refuse
      // both kinds: select both columns and gate the athlete branch on them.
      const AUDIO = 'app/api/sessions/[id]/audio-url/route.ts'
      const audio = files.find((f) => f.rel === AUDIO)
      if (audio) {
        const asrc = code(audio)
        const sel = asrc.match(/\.select\(\s*['"`]([^'"`]*)['"`]/)?.[1] ?? ''
        const gate = asrc.match(/const\s+(\w+)\s*=\s*Boolean\(\s*session\.group_id\s*\|\|\s*session\.shared_recording_id\s*\)/)
        const used = gate && new RegExp(`shared_with_athlete\\s*&&\\s*!${gate[1]}\\b`).test(asrc)
        if (!/\bgroup_id\b/.test(sel) || !/\bshared_recording_id\b/.test(sel) || !used) {
          found.push({ file: AUDIO, line: lineOf(audio, /shared_with_athlete/), msg: 'signs audio for an athlete on a squad or shared recording (athlete branch not gated on group_id and shared_recording_id)' })
        }
      }

      // The detail route signs the same audio for an athlete viewer, so it must
      // gate on the same two columns. It gated on shared_recording_id only, and
      // a squad member was handed the whole squad talk as a signed URL while
      // its transcript was withheld two lines below.
      if (detail) {
        const dsrc = code(detail)
        const signIdx = dsrc.search(/createSignedUrl\(\s*session\.audio_path/)
        const lead = signIdx === -1 ? '' : dsrc.slice(Math.max(0, signIdx - 600), signIdx)
        const guard = lead.match(/if\s*\(\s*session\.audio_path\s*&&([^\n]*)\)\s*\{\s*$/m)?.[1] ?? ''
        // Either both columns in the guard, or a local assigned from both.
        const locals = [...guard.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1])
        const namesBoth = (t) => /\bgroup_id\b/.test(t) && /\bsharedRecording\b|\bshared_recording_id\b/.test(t)
        const ok = namesBoth(guard) || locals.some((v) => namesBoth(lead.match(new RegExp(`const\\s+${v}\\s*=([^\\n]*)`))?.[1] ?? ''))
        if (signIdx === -1 || !ok) {
          found.push({ file: DETAIL, line: lineOf(detail, /createSignedUrl\(\s*session\.audio_path/), msg: 'signs session audio for an athlete without gating on BOTH group_id and shared_recording_id' })
        }
      }

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
  {
    id: 'SG8',
    title: 'A session route that signs storage compares the session to the caller',
    why: 'This is the KNOWN GAP below, realised in production. GET /api/sessions/[id]/videos authenticated the caller, read their global `role`, and then queried session_videos filtered by nothing but the id in the URL — through the service-role client, so RLS was not a backstop either. Any signed-in coach could name any session id and receive every video of another coach\'s athletes, each with an hour-long signed URL that outlives the request. SG1 passed it the whole time, because authenticating is not authorising. A route that mints a signed URL for a child\'s video or audio must first prove the session belongs to the caller.',
    cite: 'app/api/sessions/[id]/detail/route.ts — the ownership check this rule generalises',
    check(files) {
      const found = []
      for (const f of files) {
        if (!f.isRoute) continue
        // Only the session-scoped routes: the id in the path is the thing that
        // has to be checked against the caller.
        if (!/^app\/api\/(sessions|share)\//.test(f.rel)) continue
        const src = code(f)

        /* Per HANDLER, not per file.
         *
         * The first version of this rule tested the whole file and was proven
         * useless by its own mutation test: the vulnerable GET was reinstated
         * and the rule stayed green, because POST in the same file carries a
         * correct `.eq('coach_id', user.id)`. One handler's check was standing
         * in for another handler's missing one — which is the precise shape of
         * the bug being guarded against, so the rule was passing the thing it
         * existed to catch.
         *
         * Split on the exported handlers and judge each one alone. */
        const STORAGE = /createSignedUrl|createSignedUploadUrl|\.storage\s*\.\s*from\(/

        // Helpers defined at module scope that sign on a handler's behalf.
        // `generateSignedUrls(admin, …)` is the one here: the handler that
        // calls it hands out URLs without the word `createSignedUrl` in it.
        const OWNS = /\.eq\(\s*['"](?:coach_id|athlete_user_id)['"]\s*,\s*user(Id)?\.?(id)?\s*\)|(?:coach_id|athlete_user_id)\s*===\s*user(Id)?\.?(id)?/

        const moduleFns = [...src.matchAll(/(?:async\s+)?function\s+(\w+)[\s\S]{0,900}?\n\}/g)]

        // Helpers defined at module scope that sign on a handler's behalf.
        // `generateSignedUrls(admin, …)` is the one here: the handler that
        // calls it hands out URLs without the word `createSignedUrl` in it.
        const signingHelpers = moduleFns.filter((m) => STORAGE.test(m[0])).map((m) => m[1])

        // Helpers defined at module scope that do the ownership comparison for
        // a handler. Recognised by what they CONTAIN, not by what they are
        // called — `requireOwnedSession` and `authorize` are the same idea with
        // different names, and a rule keyed on names would fail the next one.
        const authorizingHelpers = moduleFns.filter((m) => OWNS.test(m[0])).map((m) => m[1])

        for (const { name: handler, src: block } of handlerBlocks(src)) {
          const callsHelper = signingHelpers.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(block))
          if (!STORAGE.test(block) && !callsHelper) continue

        // An upload-url route proves ownership to mint the path; a read route
        // proves it to mint the URL. Either way the proof looks the same: the
        // caller's id is compared against the session's coach, or against the
        // athlete row's athlete_user_id.
        //
        // Deliberately shape-based rather than clever. A route that scopes
        // correctly some other way will trip this and should then either be
        // written in the house shape or given a named exemption here — an
        // unexplained third way of proving ownership is itself the risk.
          const comparesCoach = /\.eq\(\s*['"]coach_id['"]\s*,\s*user\.id\s*\)|\.coach_id\s*===\s*user(Id)?\.?(id)?/.test(block)
          const comparesAthlete = /\.eq\(\s*['"]athlete_user_id['"]\s*,\s*user(Id)?\.?(id)?\s*\)|athlete_user_id\s*===\s*user(Id)?\.?(id)?/.test(block)

          // A third shape, and the strongest of the three: the object's path is
          // *built* from the caller's id, so there is no way to name someone
          // else's object in the first place. app/api/sessions/audio-upload-url
          // does this — it mints `coach/${user.id}/${Date.now()}.${ext}` before
          // any session exists, so there is no session to compare against and
          // nothing weaker about it. Requiring a session check here would mean
          // asking for a worse guarantee than the one already in place.
          const pathScopedToCaller = /(storagePath|path)\s*=\s*`[^`]*\$\{user\.id\}/.test(block)

          // A fourth: the handler delegates to a module-level helper that does
          // the comparison itself. Those helpers are identified above by their
          // contents rather than their names.
          const delegates = authorizingHelpers.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(block))

          // A fifth: the handler validates that a client-supplied path sits
          // under the caller's own prefix. This is how both POST handlers that
          // register an already-uploaded file prove scope — there is no session
          // row to compare at that point, only a string from the client, and
          // refusing anything outside `${user.id}/…` is the check.
          const prefixChecked = /startsWith\(\s*`[^`]*\$\{user\.id\}/.test(block)

          if (!comparesCoach && !comparesAthlete && !pathScopedToCaller && !delegates && !prefixChecked) {
            found.push({
              file: f.rel,
              line: lineOf(f, new RegExp(`export\\s+async\\s+function\\s+${handler}\\b`)),
              msg: `${handler} signs or reads a storage object without comparing the session to the caller (no coach_id or athlete_user_id check against user.id)`,
            })
          }
        }
      }
      return found
    },
  },
  {
    id: 'SG9',
    title: 'A child\'s check-in words reach the coach, not a parent, unless the coach chooses',
    why: 'An athlete writing a note on their daily check-in is told "Your coach will see this". The automatic wellness-drop email to PARENTS — sent when a score crosses a threshold, with nobody choosing to send it — was carrying that note verbatim. A thirteen-year-old writing "slept badly, stuff at home" to their coach had it arrive in a parent\'s inbox because a number moved. Max decided on 2026-09-25 that notes stay out of anything a parent receives unless the coach includes them. The scores still go; the words do not.',
    cite: 'lib/notify.ts — the wellness alert builder; product-review/REGISTER.md 2026-09-25',
    check(files) {
      const found = []
      for (const f of files) {
        const src = code(f)
        // Any email body that interpolates a check-in note must be gated on
        // the coach being the audience. The gate has to be IN the expression
        // that emits the note, not merely somewhere in the file: an email
        // builder takes `audience` as a parameter for other reasons too (the
        // CTA), and its mere presence proves nothing about the note.
        //
        // A note is usually interpolated twice — once in the condition and once
        // in the template that condition protects — so a pattern that only
        // looks inside the nearest `${` sees the inner one as ungated. The first
        // version of this rule did exactly that and failed the FIXED code. So
        // each occurrence is judged against the text leading up to it: the gate
        // must appear within the same few lines, which is where it lives when
        // it governs that expression.
        for (const m of src.matchAll(/\bcheckin\.notes\b/g)) {
          const lead = src.slice(Math.max(0, m.index - 240), m.index)
          if (!/audience\s*===\s*['"]coach['"]/.test(lead)) {
            found.push({
              file: f.rel,
              line: lineOf(f, /checkin\.notes/),
              msg: 'interpolates a check-in note into an email without gating it on audience === "coach"',
            })
          }
        }
      }
      return found
    },
  },
  {
    id: 'SG10',
    title: 'The access log records only the athlete, is written only by the server, and is never shown to the athlete',
    why: 'Max asked to see when an athlete opens what they were sent (2026-09-26). A log about a child is only worth anything if it is true: a route that wrote a row without first proving the caller IS the athlete on that session would record a coach\'s own view — or anyone\'s — as the child\'s. A client that could write the table could forge or back-date it. And the log is a coaching aid disclosed to athletes in words; showing a teenager a feed of their own opens turns it into surveillance they are made to watch.',
    cite: 'lib/access-log.ts; supabase/migrations/030_access_log.sql — no client insert policy',
    check(files) {
      const found = []
      const ATHLETE_CHECK = /\.eq\(\s*['"]athlete_user_id['"]\s*,\s*user\.id\s*\)|athlete_user_id\s*===\s*user\.id/
      for (const f of files) {
        const src = code(f)

        // (a) Every handler that logs must prove the caller is the athlete,
        //     in that handler. Per handler, for the reason handlerBlocks gives.
        if (f.isRoute) {
          for (const h of handlerBlocks(src)) {
            if (/\brecordAccess\s*\(/.test(h.src) && !ATHLETE_CHECK.test(h.src)) {
              found.push({
                file: f.rel,
                line: lineOf(f, /recordAccess\s*\(/),
                msg: `${h.name} writes to the access log without checking athlete_user_id against user.id`,
              })
            }
          }
        }

        // (b) One writer. A direct insert anywhere else skips the duplicate
        //     window and the never-throw guarantee, and is not seen by (a).
        if (f.rel !== 'lib/access-log.ts' && /\.from\(\s*['"]access_log['"]\s*\)[\s\S]{0,300}?\.(insert|upsert|update|delete)\s*\(/.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, /access_log/), msg: 'writes access_log directly instead of through recordAccess()' })
        }

        // (c) No browser code touches the table at all.
        if (f.isClient && /\.from\(\s*['"]access_log['"]/.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, /access_log/), msg: 'client code queries access_log directly' })
        }

        // (d) Athlete surfaces never read the log.
        const READS = /components\/AccessLog|\/api\/coach\/access-log|['"]access_log['"]/
        if (/^app\/athlete\//.test(f.rel) && READS.test(src)) {
          found.push({ file: f.rel, line: lineOf(f, READS), msg: 'athlete surface reads the coach\'s access log' })
        }
      }
      return found
    },
  },
  {
    id: 'SG11',
    title: 'The database, not just the routes, decides who a row may be about',
    why: 'Every rule above reads route code, and PostgREST does not go through a route: anyone holding a token can call the database with the anon key. Until migration 033 an athlete could PATCH their own profiles row to role = "coach" — which the proxy, every coach route and the access-token hook all trust — and read the transcript of a squad talk naming other children; a coach could write a session, a message or a squad membership onto another coach\'s athlete. Each policy said "you own this row" and none said "and it is about someone you may write about".',
    cite: 'supabase/migrations/033_security_integrity.sql',
    check() {
      const found = []
      const M = 'supabase/migrations'
      const { policies, triggers, functions } = replayMigrations()

      // (a) profiles: a trigger refuses a client changing role, coach_id or
      //     invite_code, on UPDATE and INSERT, and no client INSERT policy.
      const guard = triggers.find((t) => {
        if (t.table !== 'profiles' || !/before/.test(t.timing) || !/update/.test(t.timing) || !/insert/.test(t.timing)) return false
        const body = functions.get(t.fn)?.body ?? ''
        return ['role', 'coach_id', 'invite_code'].every((c) => new RegExp(`new\\.${c}\\s+is\\s+distinct\\s+from\\s+old\\.${c}`, 'i').test(body)) &&
          /raise\s+exception/i.test(body) && /current_user\s+in\s*\(\s*'authenticated'/i.test(body)
      })
      if (!guard) {
        found.push({ file: M, line: 0, msg: 'no BEFORE INSERT OR UPDATE trigger on profiles refuses a client changing role, coach_id and invite_code — any user can make themselves a coach' })
      } else if (/auth\.role\(\)/i.test(functions.get(guard.fn)?.body ?? '')) {
        // Found by running 033 against a real Postgres: auth.role() casts an
        // empty request.jwt.claims to jsonb and throws, which inside this
        // trigger fails signups and ON DELETE SET NULL cascades.
        found.push({ file: M, line: 0, msg: `${guard.fn}() calls auth.role(), which throws on an empty claims setting — test current_user instead` })
      }
      for (const p of policies) {
        if (p.table === 'profiles' && (p.cmd === 'insert' || p.cmd === 'all')) {
          found.push({ file: `${M}/${p.file}`, line: 0, msg: `profiles policy "${p.name}" lets a client insert its own profile row — the signup trigger makes every one` })
        }
      }

      // (b) An athlete never reads a squad or shared-recording session row.
      for (const p of policies) {
        if (p.table !== 'sessions' || !(p.cmd === 'select' || p.cmd === 'all')) continue
        if (!/athlete_user_id/i.test(p.using)) continue
        if (!/group_id\s+is\s+null/i.test(p.using) || !/shared_recording_id\s+is\s+null/i.test(p.using)) {
          found.push({ file: `${M}/${p.file}`, line: 0, msg: `sessions policy "${p.name}" lets an athlete read squad or shared-recording rows, transcript included (needs group_id is null and shared_recording_id is null)` })
        }
      }

      // (c) Every coach write policy pins the athlete (or session) to the
      //     caller's own roster, not just coach_id to the caller.
      const PINNED = {
        sessions: /athletes\s+where\s+coach_id\s*=/i,
        messages: /athletes\s+where\s+coach_id\s*=/i,
        group_members: /athletes\s+where\s+coach_id\s*=/i,
        athlete_caretakers: /athletes\s+where\s+coach_id\s*=/i,
        injuries: /athletes\s+where\s+coach_id\s*=/i,
        notes: /athletes\s+where\s+coach_id\s*=/i,
        session_attachments: /sessions\s+where\s+coach_id\s*=/i,
      }
      const COACH_WRITER = /coach_id\s*=\s*\(?\s*(?:select\s+)?auth\.uid\(\)|auth\.uid\(\)\s*\)?\s*=\s*coach_id|groups\s+where\s+coach_id/i
      for (const p of policies) {
        if (!(p.table in PINNED) || !['all', 'insert', 'update'].includes(p.cmd)) continue
        const check = p.check || p.using // no WITH CHECK means USING is the check
        if (!COACH_WRITER.test(check)) continue
        if (!PINNED[p.table].test(check)) {
          found.push({ file: `${M}/${p.file}`, line: 0, msg: `${p.table} policy "${p.name}" lets a coach write a row about someone else's athlete (WITH CHECK never compares the athlete to the caller's roster)` })
        }
      }

      // (d) A stored recording path is always its own coach's.
      const insertSessions = policies.filter((p) => p.table === 'sessions' && ['all', 'insert', 'update'].includes(p.cmd) && COACH_WRITER.test(p.check || p.using))
      for (const p of insertSessions) {
        if (!/audio_path\s+is\s+null\s+or\s+audio_path\s+like\s+'coach\/'/i.test(p.check)) {
          found.push({ file: `${M}/${p.file}`, line: 0, msg: `sessions policy "${p.name}" accepts any audio_path — the audio routes sign it with the service-role key` })
        }
      }

      // (e) Messages: a client never gets FOR ALL — they are append-only
      //     except the read marker.
      for (const p of policies) {
        if (p.table === 'messages' && (p.cmd === 'all' || p.cmd === 'delete')) {
          found.push({ file: `${M}/${p.file}`, line: 0, msg: `messages policy "${p.name}" is FOR ${p.cmd.toUpperCase()} — either side can rewrite or delete the other's messages` })
        }
      }

      // (f) athletes: a client never links athlete_user_id itself.
      const link = triggers.find((t) => t.table === 'athletes' && /before/.test(t.timing) && /insert/.test(t.timing) &&
        /new\.athlete_user_id/i.test(functions.get(t.fn)?.body ?? '') && /raise\s+exception/i.test(functions.get(t.fn)?.body ?? ''))
      if (!link) {
        found.push({ file: M, line: 0, msg: 'no trigger on athletes refuses a client setting athlete_user_id — a coach can put any user on their roster' })
      }
      for (const p of policies) {
        if (p.table === 'athletes' && /athlete_user_id\s*=/i.test(p.using) && ['all', 'update'].includes(p.cmd)) {
          found.push({ file: `${M}/${p.file}`, line: 0, msg: `athletes policy "${p.name}" lets an athlete rewrite their own roster row, coach_id included` })
        }
      }
      return found
    },
  },
  {
    id: 'SG12',
    title: 'A route that writes on the service-role key proves who and what first',
    why: 'The service-role client skips every policy SG11 checks, so on these routes the route IS the policy. POST /api/athletes generated auth invites and roster rows for any signed-in user — athletes included; POST /api/caretakers attached a "parent" to any athlete id; POST /api/sessions stored a client-supplied audio_path that two routes later sign with the service-role key; the clip route ignored whether the session was shared; and the session PDF printed whatever row RLS returned, squad transcripts included.',
    cite: 'supabase/migrations/033_security_integrity.sql — the route half of the same fixes',
    check(files) {
      const found = []
      for (const f of files) {
        if (!f.isRoute) continue
        const src = code(f)
        for (const h of handlerBlocks(src)) {
          const at = lineOf(f, new RegExp(`export\\s+async\\s+function\\s+${h.name}\\b`))
          // (a) Creating an auth user or an invite is a coach's act.
          if (/auth\.admin\.(generateLink|inviteUserByEmail|createUser)\s*\(/.test(h.src) &&
              !/role\s*!==\s*['"]coach['"]/.test(h.src)) {
            found.push({ file: f.rel, line: at, msg: `${h.name} creates an auth invite without refusing non-coaches (no role !== 'coach' check)` })
          }
          // (b) A client-supplied audio_path must be under the caller's prefix.
          if (/(?:body\??\.audio_path|form\.get\(\s*['"]audio_path['"]\s*\))/.test(h.src) &&
              !/startsWith\(\s*`coach\/\$\{user\.id\}\//.test(h.src)) {
            found.push({ file: f.rel, line: at, msg: `${h.name} accepts audio_path from the client without checking it starts with coach/\${user.id}/` })
          }
          // (c) A caretaker row names an athlete on the caller's roster.
          if (/\.from\(\s*['"]athlete_caretakers['"]\s*\)[\s\S]{0,200}?\.(insert|upsert)\s*\(/.test(h.src) &&
              !/\.from\(\s*['"]athletes['"]\s*\)[\s\S]{0,200}?\.eq\(\s*['"]coach_id['"]\s*,\s*user\.id\s*\)/.test(h.src)) {
            found.push({ file: f.rel, line: at, msg: `${h.name} writes a caretaker without checking the athlete is on the caller's roster` })
          }
        }
      }

      // (d) The clip route's athlete branch requires the SESSION to be shared.
      const CLIP = 'app/api/share/clip/[videoId]/route.ts'
      const clip = files.find((f) => f.rel === CLIP)
      if (clip) {
        const csrc = code(clip)
        const sel = [...csrc.matchAll(/\.from\(\s*['"]sessions['"]\s*\)\s*\.select\(\s*['"`]([^'"`]*)/g)].map((m) => m[1]).join(',')
        if (!/\bshared_with_athlete\b/.test(sel) || !/!\s*session\.shared_with_athlete/.test(csrc)) {
          found.push({ file: CLIP, line: lineOf(clip, /shared_with_athlete/), msg: 'serves a clip to an athlete without checking the session itself is shared' })
        }
      }

      // (e) The session PDF prints a transcript, so it is the coach's own only.
      const PDF = 'app/pdf/session/[id]/page.tsx'
      const pdf = files.find((f) => f.rel === PDF)
      if (pdf) {
        const psrc = code(pdf)
        const q = psrc.match(/\.from\(\s*['"]sessions['"]\s*\)[\s\S]{0,300}?\.(?:single|maybeSingle)\(\)/)?.[0] ?? ''
        if (!/\.eq\(\s*['"]coach_id['"]\s*,\s*user\.id\s*\)/.test(q)) {
          found.push({ file: PDF, line: lineOf(pdf, /\.from\(\s*['"]sessions['"]/), msg: 'loads the session to print without .eq(\'coach_id\', user.id) — an athlete can print a squad transcript' })
        }
      }

      // (f) The athlete portal reads no session row directly; its list comes
      //     from /api/athlete/sessions, which has no transcript column.
      for (const f of files) {
        if (!/^app\/athlete\//.test(f.rel)) continue
        if (/\.from\(\s*['"]sessions['"]\s*\)/.test(code(f))) {
          found.push({ file: f.rel, line: lineOf(f, /\.from\(\s*['"]sessions['"]/), msg: 'athlete portal queries sessions directly — use /api/athlete/sessions' })
        }
      }
      return found
    },
  },
  {
    id: 'SG13',
    title: 'A route that hands out video URLs proves the caller, and gates an athlete through the shared rule',
    why: 'Athletes can now send their coach clips, and moments of a coach\'s video open beside a takeaway. That puts video on the athlete side of more routes than ever, and the leak is one missing clause: a route that signs every video on a session, or every clip of an athlete row, shows one child another child\'s video — a squad clip showing ten other children, or a clip a teammate sent their coach. SG8 only reads routes under app/api/sessions and app/api/share; the new routes live under app/api/athlete and app/api/athletes. A handler that signs a video URL must compare the caller to the session\'s coach or the athlete row\'s athlete_user_id, and if it can serve an athlete it must apply athleteMayViewVideo (lib/video-clip.ts, held by tools/video-rig.mjs V7) or test the video\'s own shared_with_athlete flag.',
    cite: 'lib/video-clip.ts athleteMayViewVideo; supabase/migrations/032_video_clips.sql',
    check(files) {
      const found = []
      // In scope: a file that reads the video tables or names the bucket they
      // live in. The upload-URL minters never touch the tables — they sign a
      // path — and they are exactly where a path in someone else's folder
      // would be handed out.
      const TABLE = /\.from\(\s*['"](?:session_videos|video_clips)['"]\s*\)|['"]session-videos['"]/
      const SIGNS = /createSigned(?:Upload)?Urls?\s*\(/
      const OWNS = /\.eq\(\s*['"](?:coach_id|athlete_user_id)['"]\s*,\s*user(?:Id|\.id)\s*\)|(?:coach_id|athlete_user_id)\s*===\s*user(?:Id|\.id)/
      const ATHLETE_BRANCH = /athlete_user_id/
      // The shared rule, or the legacy per-video flag read as a property —
      // `v.shared_with_athlete`, `.eq('shared_with_athlete', true)` — never the
      // column name sitting in a select string, which proves nothing.
      // As a GATE: inside a filter, or an if. A `shared_with_athlete: v.shared_with_athlete`
      // in an output mapping reads the flag and gates nothing — the first
      // version of this rule accepted that and passed with the filter deleted.
      //
      // And on the VIDEO, not the session: `if (session.shared_with_athlete)`
      // in an authorize() helper is a real check, but a shared session is not
      // a shared video, and counting it let the videos route pass with its
      // per-video filter deleted.
      const GATED = /\bathleteMayViewVideo\s*\(|\.filter\(\s*\(?\w+\)?\s*=>[^\n]*\b(?!session\b)\w+\.shared_with_athlete\b|\bif\s*\(\s*!?\s*(?!session\b)\w+\.shared_with_athlete\b|\.eq\(\s*['"]shared_with_athlete['"]\s*,\s*true\s*\)/
      for (const f of files) {
        if (!f.isRoute) continue
        const src = code(f)
        if (!TABLE.test(src)) continue
        const moduleScope = src.split(/export\s+async\s+function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/)[0]
        const helpers = [...moduleScope.matchAll(/(?:async\s+)?function\s+(\w+)[\s\S]{0,1400}?\n\}/g)]
        for (const h of handlerBlocks(src)) {
          // The handler plus every module-level helper it calls: authorize(),
          // generateSignedUrls() and friends do the work on its behalf.
          const called = helpers.filter((m) => new RegExp(`\\b${m[1]}\\s*\\(`).test(h.src)).map((m) => m[0])
          const body = [h.src, ...called].join('\n')
          if (!SIGNS.test(body)) continue
          const line = lineOf(f, new RegExp(`export\\s+async\\s+function\\s+${h.name}\\b`))
          if (!OWNS.test(body)) {
            found.push({ file: f.rel, line, msg: `${h.name} signs video URLs without comparing coach_id or athlete_user_id to the caller` })
          } else if (ATHLETE_BRANCH.test(body) && !GATED.test(body)) {
            found.push({ file: f.rel, line, msg: `${h.name} can serve an athlete but never applies athleteMayViewVideo or the video's shared_with_athlete flag` })
          }
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
  'The audio-url gate (SG6) is read as source: it proves the route selects group_id and shared_recording_id and gates the athlete branch on them, not that no other route signs the same bucket for an athlete.',
  'Whether the transcript withholding is correct for sessions saved BEFORE `sessions.group_id` existed. Those rows are null, so they are not identifiable as squad sessions. They are covered from the other end — the athlete client no longer selects transcripts at all — but SG6 is what enforces that, and a future direct fetch could reintroduce the leak for historic rows without tripping the group check.',
  'Whether a route\'s ownership check is *correct* — SG1 proves a route authenticates, not that it then scopes the query to the right coach.',
  'Whether row-level security policies in Supabase actually match what the routes assume. The policies live in migrations and are enforced by the database, not by anything this scanner reads.',
  'Whether the offline recording queue actually works in a browser. It is IndexedDB, the `online` event and a resumable three-stage upload, none of which a static scanner or a Node rig can exercise. The boot harness drives real Chromium but only asserts on the cold-start timeline. This is the largest untested surface in the app and it is the one holding the only copy of a recording.',
  'What the Focus Card image actually contains. It is built to carry the coaching sentence, the date and the wordmark and nothing else — no name, no photo, no URL, no session id — because it is designed to leave the app. That constraint lives in canvas drawing code and cannot be checked by reading source shape, so it has to be re-read by a human whenever app/components/FocusCard.tsx changes.',
  'Whether an access-log call sits on the athlete branch of its handler. SG10 proves a handler that logs also checks athlete_user_id against the caller, not that the log call is guarded by the result — the detail route serves the coach too, and only its `if (isAthlete)` keeps a coach\'s view out of the log.',
  'What the AI summariser writes about a child. `tools/prompt-rig.mjs` covers the prompt; nothing covers a model\'s output on an unseen transcript.',
  'Whether the LIVE database matches the migrations SG11 replays. Policies have been created by hand in the dashboard before (017\'s header), and a migration that exists in the repo may not have been applied. SG11 proves what the files would leave standing; only `select * from pg_policies` against the project proves what is standing. Run it after every migration that touches access.',
  'Whether a policy SG11 does not know the shape of is safe. It checks the tables that had holes (profiles, sessions, messages, group_members, athletes, caretakers, injuries, notes, attachments); a new table with a coach_id-only WITH CHECK passes until it is added to PINNED. event_rsvps is one today: an athlete may RSVP to any event id, and it shows on that event\'s coach\'s list.',
  'Sessions saved as squad talks BEFORE sessions.group_id existed carry a null group_id, so the narrowed athlete policy (033) still returns their transcript to the athlete over PostgREST. None was found on 2026-09-26 (no shared, unflagged transcript is duplicated across athletes), but nothing enforces that.',
  'Whether an athlete\'s clip is really 60 seconds or less. The server cannot decode video; it checks the duration the athlete\'s browser measured (lib/video-clip.ts athleteDurationOk). A modified client can lie about it — the 500MB bucket limit is the hard ceiling, not the 60 seconds.',
  'Whether migration 032\'s RLS policies match athleteMayViewVideo. Every route here uses the service role and the shared rule; the policies only matter to a direct client query, and nothing reads them but the database.',
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
