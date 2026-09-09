/**
 * tools/alias-register.mjs — the `--import` entry point for the `@/` alias hook.
 *
 * Kept separate from the hook itself because `module.register` loads the hook
 * into its own thread; the two cannot live in one file.
 *
 * Usage:  node --import ./tools/alias-register.mjs tools/whatever-rig.mjs
 */
import { register } from 'node:module'

register(new URL('./alias-hooks.mjs', import.meta.url))
