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
  // Both role homes are now migrated — every value in app/athlete/page.tsx and
  // app/dashboard/page.tsx comes from app/globals.css — so the glob covers
  // both with no existing violations. Widen it one page at a time as each is
  // migrated; it only works if the glob never covers a page that has not been
  // done, because a rule that fails on arrival gets switched off.
  //
  // Still outside: app/athletes/[id]/page.tsx (14 literals),
  // app/sessions/[id]/page.tsx (2), and the components.
  //
  // If you need a colour that is not in the token set, add the token. That is
  // the point: it makes the palette a decision rather than an accident. And if
  // what you have is colour *data* rather than a token — a palette a user picks
  // from, persisted per row — put it in lib/ like lib/group-colors.ts, rather
  // than adding an exception here.
  {
    files: ["app/athlete/**/*.tsx", "app/dashboard/**/*.tsx"],
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
