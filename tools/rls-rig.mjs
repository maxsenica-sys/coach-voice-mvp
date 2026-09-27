#!/usr/bin/env node
/**
 * RLS rig — runs the database's access rules for real, against Postgres.
 *
 * Every other rig reads source. None of them can tell whether a policy lets an
 * assistant coach read another coach's athlete, because that is decided inside
 * Postgres by rules that are just strings to every tool we have. This rig
 * builds a throwaway database with production's schema, applies every
 * migration after the baseline, and then acts as real users against it.
 *
 * Steps, in a fresh database each run:
 *   1. supabase/tests/supabase-stub.sql   roles, auth.users, auth.uid()
 *   2. supabase/tests/baseline-033.sql    production's public schema after 033
 *   3. supabase/migrations/NNN_*.sql      every migration numbered above 033
 *   4. supabase/tests/*.test.sql          each fails the run on any FAIL
 *
 * Needs a Postgres it may create databases on, and psql on the PATH. It reads
 * the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD). CI provides
 * a postgres:16 service; locally, any Postgres 15+ will do.
 *
 * Every case in the test files was proven by breaking the migration on
 * purpose — see the header of each test file.
 *
 * Usage:  npm run verify:rls
 */

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', BOLD = '\x1b[1m', OFF = '\x1b[0m'
const BASELINE = 33
const DB = `cv_rls_${process.pid}`

function psql(args, { db = 'postgres', quiet = true } = {}) {
  return execFileSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', ...(quiet ? ['-q'] : []), '-d', db, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function fail(msg, detail = '') {
  console.log(`\n  ${RED}✗ ${msg}${OFF}`)
  if (detail) console.log(detail.split('\n').map((l) => `      ${l}`).join('\n'))
  try { psql(['-c', `drop database if exists ${DB}`]) } catch { /* best effort */ }
  process.exit(1)
}

console.log(`\n  ${BOLD}RLS rig${OFF} ${DIM}— the database's access rules, run as real users${OFF}\n`)

try {
  psql(['-c', `drop database if exists ${DB}`, '-c', `create database ${DB}`])
} catch (e) {
  fail('could not create a database — is Postgres running and are PGHOST/PGUSER set?', String(e.stderr || e.message))
}

const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
  .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > BASELINE)
  .sort()

const setup = [
  'supabase/tests/supabase-stub.sql',
  `supabase/tests/baseline-0${BASELINE}.sql`,
  ...migrations.map((f) => `supabase/migrations/${f}`),
]
for (const file of setup) {
  try {
    psql(['-f', join(ROOT, file)], { db: DB })
    console.log(`  ${GREEN}✓${OFF} applied ${file}`)
  } catch (e) {
    fail(`${file} did not apply`, String(e.stderr || e.message))
  }
}

// Applying every migration a second time must also succeed: production has
// already run some of them, and a migration that is not idempotent breaks the
// day it is re-applied.
for (const f of migrations) {
  try {
    psql(['-f', join(ROOT, 'supabase/migrations', f)], { db: DB })
  } catch (e) {
    fail(`supabase/migrations/${f} is not safe to apply twice`, String(e.stderr || e.message))
  }
}
console.log(`  ${GREEN}✓${OFF} every migration after ${BASELINE} applies twice`)

const tests = readdirSync(join(ROOT, 'supabase/tests')).filter((f) => f.endsWith('.test.sql')).sort()
if (tests.length === 0) fail('no supabase/tests/*.test.sql found')

let failed = 0
for (const t of tests) {
  let out = ''
  let ok = true
  try {
    out = psql(['-tA', '-f', join(ROOT, 'supabase/tests', t)], { db: DB })
  } catch (e) {
    ok = false
    out = String(e.stdout || '') + String(e.stderr || '')
  }
  const lines = out.split('\n').filter((l) => /^(PASS|FAIL)\s/.test(l))
  const bad = lines.filter((l) => l.startsWith('FAIL'))
  console.log(`\n  ${BOLD}${t}${OFF} ${DIM}— ${lines.length} cases${OFF}`)
  for (const l of bad) console.log(`    ${RED}${l}${OFF}`)
  if (!ok || bad.length || lines.length === 0) {
    failed++
    if (!bad.length) console.log(out.split('\n').slice(-8).map((l) => `    ${l}`).join('\n'))
  } else {
    console.log(`    ${GREEN}all pass${OFF}`)
  }
}

psql(['-c', `drop database if exists ${DB}`])

console.log('')
if (failed) {
  console.log(`  ${RED}✗ ${failed} of ${tests.length} RLS test file(s) failed.${OFF}\n`)
  process.exit(1)
}
console.log(`  ${GREEN}✓ ${tests.length} RLS test file(s) pass against production's schema plus ${migrations.length} new migration(s).${OFF}\n`)
