import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── No raw hex colours on migrated pages ─────────────────────────────────
  //
  // This exists because the fix it protects has already been undone once. In
  // September the muted-text token was raised from #9BA29B (2.47:1, failing AA
  // and even the 3:1 large-text floor) to #6B736D, and all 23 hardcoded copies
  // were repointed at the token. Two days later a design pass on the athlete
  // portal reintroduced eight of them, at 9-11px, on the screen a teenager
  // opens daily. Nobody noticed, because nothing was watching.
  //
  // Every value in app/athlete/page.tsx now comes from app/globals.css, so the
  // rule can be turned on there without a single existing violation. It is
  // scoped to that one file on purpose: app/dashboard/page.tsx still carries
  // 96 literals, and switching this on repo-wide today would just break lint
  // and get switched off again. Widen the glob one page at a time, as each is
  // migrated — that is the whole plan, and it only works if the glob never
  // covers a page that has not been done.
  //
  // If you need a colour that is not in the token set, add the token. That is
  // the point: it makes the palette a decision rather than an accident.
  {
    files: ["app/athlete/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{6}\\b/]",
          message:
            "Hardcoded hex colour. Use a token from app/globals.css (var(--text-muted), var(--coach-on-light), …). If the colour you need has no token, add one — see the note in eslint.config.mjs.",
        },
      ],
    },
  },
]);

export default eslintConfig;
