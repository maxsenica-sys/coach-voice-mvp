/**
 * tools/alias-hooks.mjs — teach plain Node the `@/` import alias.
 *
 * The app writes `import { … } from '@/lib/session-date'`. That alias is
 * declared in `tsconfig.json` and understood by Next.js and by `tsc`; Node
 * knows nothing about it, so a test rig importing a real `lib/` module hits
 * ERR_MODULE_NOT_FOUND the moment that module imports another one.
 *
 * The alternative was to make `lib/` use relative imports so the rigs could
 * read it — which is letting the test tail wag the source dog. This hook keeps
 * the app's convention intact and puts the compatibility in the tooling, where
 * it belongs. It also means any future rig can import any `lib/` module without
 * anybody having to remember a rule.
 *
 * Extensionless specifiers are resolved by trying the same extension list
 * TypeScript would, in the same order. Node's own TypeScript stripping handles
 * the `.ts` file itself once it has been located.
 *
 * Register it with:  node --import ./tools/alias-register.mjs <script>
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The order tsconfig's moduleResolution would use. `.ts` first because that is
// what `lib/` actually contains.
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json']

function locate(basePath) {
  if (existsSync(basePath) && path.extname(basePath)) return basePath
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext
    if (existsSync(candidate)) return candidate
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(basePath, 'index' + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const target = locate(path.join(ROOT, specifier.slice(2)))
    if (target) {
      return { url: pathToFileURL(target).href, shortCircuit: true }
    }
    throw new Error(
      `alias-hooks: could not resolve "${specifier}" under ${ROOT}. ` +
        `Tried extensions ${EXTENSIONS.join(', ')}.`,
    )
  }
  return next(specifier, context)
}
