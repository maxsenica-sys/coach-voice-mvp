/**
 * tools/alias-register.mjs — the `--import` entry point for the `@/` alias hook.
 *
 * Kept separate from the hook itself because `module.register` loads the hook
 * into its own thread; the two cannot live in one file.
 *
 * Usage:  node --import ./tools/alias-register.mjs tools/whatever-rig.mjs
 */
import { register } from 'node:module'

/* Every rig that loads this hook imports a real `lib/*.ts` module, which needs
 * Node's built-in TypeScript stripping. That is unflagged from v22.18 and
 * v23.6 onwards; before that the import dies with `ERR_UNKNOWN_FILE_EXTENSION:
 * Unknown file extension ".ts"` and a stack trace that says nothing about what
 * to do — and, in the clock rig, does it nine times in child processes, so the
 * report reads "9 of 9 timezones failed" as though the app's date logic were
 * broken.
 *
 * CI pins Node 24, so this only ever bites the person running the gate by hand
 * before opening a PR — which is exactly who CLAUDE.md asks to run it. Say what
 * is wrong and how to get past it. */
if (!process.features.typescript) {
  process.stderr.write(
    `\n  This rig imports the app's TypeScript directly, which needs Node 22.18+ ` +
    `(you have ${process.version}).\n` +
    `  Upgrade Node, or run it once with:  node --experimental-strip-types --import ./tools/alias-register.mjs <rig>\n\n`,
  )
  process.exit(1)
}

register(new URL('./alias-hooks.mjs', import.meta.url))
