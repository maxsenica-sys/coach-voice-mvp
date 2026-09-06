'use client'

/**
 * The 15 sport silhouettes, shared by any opening sequence that uses them.
 *
 * Hand-authored placeholders: recognisable at speed and consistent in weight,
 * but not illustration. They are shown for ~170ms each behind a moving stroke,
 * which is forgiving — scrutinised at rest they would not hold up, and a real
 * illustrator should redraw them before they are ever shown slowly or large.
 *
 * They render in --ink-figure, which is a safety constraint rather than a
 * style choice: at a montage cadence these are large-area elements changing
 * faster than three times a second, and WCAG 2.3.1 only permits that below a
 * 10% relative-luminance swing. --ink-figure sits at 7.6% against the ink
 * ground. --primary-dark is 11.0% and --primary is 22.1%; either would flash,
 * for an audience aged 13-18. Bigger or slower, never lighter.
 */

import type { ReactNode } from 'react'

export const SPORTS: { name: string; d: ReactNode }[] = [
  { name: 'Volleyball', d: (<>
    <circle cx="64" cy="34" r="9.5" />
    <path d="M55 44c-4 9-5 21-2 34l16 2c4-14 4-26 2-36z" />
    <path d="M68 46c8-8 16-22 20-34l9 5c-5 15-13 31-23 40z" />
    <path d="M55 49c-10 2-20 0-28-6l-2 9c9 8 21 10 30 8z" />
    <path d="M55 78c-4 13-10 23-16 31l9 7c11-9 17-22 19-35z" />
    <path d="M67 80c4 12 8 24 6 36h11c4-15 0-29-6-39z" />
    <circle cx="99" cy="8" r="7" /></>) },
  { name: 'Sprinting', d: (<>
    <circle cx="66" cy="26" r="9.5" />
    <path d="M57 36c-4 10-4 22 0 33l16-3c3-12 2-22-1-31z" />
    <path d="M72 42c9-3 17-9 22-17l7 7c-6 11-16 18-27 21z" />
    <path d="M58 44c-9 4-15 12-18 21l9 5c3-7 8-13 14-16z" />
    <path d="M58 68c-3 12-12 20-22 26l7 9c14-7 24-18 28-31z" />
    <path d="M70 68c6 9 8 20 5 31l11 3c4-15 1-29-7-39z" />
    <path d="M36 94c-5 5-11 8-18 9l2 9c11-1 20-6 26-13z" /></>) },
  { name: 'Swimming', d: (<>
    <circle cx="52" cy="76" r="9.5" />
    <path d="M60 68c14-2 30-1 44 3l-2 15c-14 3-29 3-43 1z" />
    <path d="M60 70c8-11 18-20 30-26l6 8c-10 6-18 14-24 23z" />
    <path d="M104 74c6-2 12-2 18 0l-1 12c-6 1-12 1-18-1z" />
    <path d="M46 82c-9 2-17 7-23 14l8 7c5-5 11-9 18-11z" />
    <path d="M8 100c-4 3-6 7-7 12l11 2c1-3 3-6 6-8z" /></>) },
  { name: 'Boxing', d: (<>
    <circle cx="60" cy="32" r="10" />
    <path d="M50 44c-4 10-5 24-2 37l22 1c4-14 4-28 1-38z" />
    <path d="M68 50c8 1 15 6 19 13l-9 7c-3-4-7-7-12-8z" />
    <path d="M52 52c-8 2-13 8-15 16l10 4c1-4 4-7 8-9z" />
    <path d="M48 82c-3 14-4 27-2 39h12c1-13 2-26 4-38z" />
    <path d="M66 82c4 13 8 25 12 36l11-4c-4-13-8-25-13-35z" />
    <circle cx="83" cy="66" r="8" /><circle cx="42" cy="70" r="8" /></>) },
  { name: 'Gymnastics', d: (<>
    <circle cx="60" cy="24" r="9" />
    <path d="M53 34c-3 10-3 22 0 32h16c3-11 3-22 0-32z" />
    <path d="M55 40c-13-3-25-9-35-17l-5 9c11 10 25 17 40 20z" />
    <path d="M66 40c13-3 25-9 35-17l5 9c-11 10-25 17-40 20z" />
    <path d="M55 66c-2 16-2 32 0 48h11c1-16 2-32 3-48z" />
    <path d="M67 66c9 10 20 16 32 19l3-11c-9-3-17-8-24-15z" /></>) },
  { name: 'Football', d: (<>
    <circle cx="56" cy="28" r="9.5" />
    <path d="M47 38c-3 11-3 23 0 35l18-1c3-12 3-24 1-34z" />
    <path d="M64 44c8 3 14 9 18 17l-9 6c-3-6-8-10-13-12z" />
    <path d="M48 46c-8 3-14 9-18 17l9 5c3-6 8-10 13-12z" />
    <path d="M47 72c-2 14-2 27 1 39l11-1c0-13 1-26 3-38z" />
    <path d="M63 72c8 9 17 15 27 19l4-11c-8-3-15-8-21-14z" />
    <circle cx="99" cy="98" r="10" /></>) },
  { name: 'Basketball', d: (<>
    <circle cx="58" cy="36" r="9.5" />
    <path d="M49 46c-4 10-4 23-1 35l19-1c4-13 3-25 1-35z" />
    <path d="M66 48c6-9 13-17 22-23l7 8c-8 6-15 14-20 23z" />
    <path d="M50 52c-9 1-16 6-21 14l9 6c3-5 8-8 14-9z" />
    <path d="M49 80c-4 13-10 23-17 31l9 7c11-9 18-21 21-34z" />
    <path d="M64 80c3 13 4 26 2 38h11c3-14 3-28-1-40z" />
    <circle cx="97" cy="18" r="10" /></>) },
  { name: 'Tennis', d: (<>
    <circle cx="58" cy="34" r="9.5" />
    <path d="M49 44c-4 10-4 23-1 35l19-1c4-13 3-25 1-35z" />
    <path d="M66 46c5-10 12-19 21-25l7 8c-8 6-14 14-18 24z" />
    <path d="M50 50c-9 3-15 9-18 18l10 4c2-5 6-9 11-11z" />
    <path d="M49 80c-3 13-5 26-4 38h11c1-13 3-25 5-37z" />
    <path d="M64 80c5 12 11 23 18 32l9-7c-7-8-12-18-15-28z" />
    <ellipse cx="98" cy="14" rx="9" ry="12" transform="rotate(24 98 14)" /></>) },
  { name: 'Rugby', d: (<>
    <circle cx="60" cy="30" r="9.5" />
    <path d="M51 40c-4 11-4 24-1 36l19-1c4-13 3-25 1-35z" />
    <path d="M68 52c7 1 13 4 18 9l-7 9c-4-3-8-5-13-6z" />
    <path d="M52 54c-8 4-13 11-15 20l10 3c2-6 6-10 11-13z" />
    <path d="M51 76c-4 14-11 25-19 33l9 7c12-10 20-23 24-38z" />
    <path d="M67 76c4 13 6 26 4 38h11c3-15 1-29-5-41z" />
    <ellipse cx="76" cy="62" rx="11" ry="7" transform="rotate(-18 76 62)" /></>) },
  { name: 'Cycling', d: (<>
    <circle cx="46" cy="40" r="9" />
    <path d="M54 44c14 2 27 8 38 17l-8 11c-10-8-21-13-33-15z" />
    <path d="M88 60c6 2 11 5 15 10l-9 8c-3-3-7-6-11-7z" />
    <path d="M56 62c-2 12-2 24 2 35l12-3c-3-9-3-19-2-28z" />
    <path d="M68 92c7 6 12 13 15 21l-11 5c-2-6-6-11-11-15z" />
    <circle cx="30" cy="122" r="22" fill="none" strokeWidth="6" stroke="currentColor" />
    <circle cx="96" cy="122" r="22" fill="none" strokeWidth="6" stroke="currentColor" /></>) },
  { name: 'Rowing', d: (<>
    <circle cx="54" cy="44" r="9.5" />
    <path d="M45 54c-3 10-3 21 0 31h19c3-11 3-22 1-31z" />
    <path d="M62 60c11 1 21 5 30 12l-7 10c-8-6-16-9-25-10z" />
    <path d="M46 62c-9 2-16 7-20 15l10 5c3-5 7-9 13-11z" />
    <path d="M45 86c1 12 5 22 12 30l10-7c-5-7-8-15-9-24z" />
    <path d="M62 86c8 9 18 15 29 18l3-11c-8-3-15-7-21-13z" />
    <path d="M18 40l92 62-5 8-92-62z" /></>) },
  { name: 'Skiing', d: (<>
    <circle cx="58" cy="38" r="9.5" />
    <path d="M49 48c-4 10-5 22-2 33l20-1c4-12 3-23 1-33z" />
    <path d="M67 56c9-3 18-3 27 0l-3 12c-8-2-16-2-23 0z" />
    <path d="M50 58c-9 0-17 3-24 9l8 9c5-4 11-6 17-6z" />
    <path d="M48 82c-1 13 1 24 6 34l11-5c-3-8-5-17-5-27z" />
    <path d="M65 82c6 11 14 20 24 27l7-10c-8-5-14-12-19-20z" />
    <path d="M24 130h84v8H24z" transform="rotate(-8 66 134)" /></>) },
  { name: 'Golf', d: (<>
    <circle cx="58" cy="30" r="9.5" />
    <path d="M49 40c-4 10-4 23-1 35l19-1c4-13 3-25 1-35z" />
    <path d="M65 44c9-4 19-5 29-3l-2 12c-8-1-16 0-24 3z" />
    <path d="M53 46c-9 0-16 4-21 12l10 6c3-5 7-8 12-9z" />
    <path d="M49 76c-3 14-4 27-2 39h11c0-13 2-26 5-38z" />
    <path d="M65 76c5 12 7 25 6 38h11c1-15-2-29-8-41z" />
    <path d="M92 42l24-24 6 6-24 24z" /></>) },
  { name: 'Cricket', d: (<>
    <circle cx="60" cy="32" r="9.5" />
    <path d="M51 42c-4 10-5 23-2 35l20-1c4-13 3-25 1-35z" />
    <path d="M68 48c8-2 15-7 21-14l8 8c-8 9-17 15-28 18z" />
    <path d="M52 50c-9 1-15 6-19 14l10 5c2-5 6-8 11-10z" />
    <path d="M50 78c-2 14-2 27 1 39h11c0-13 2-26 4-38z" />
    <path d="M66 78c5 12 8 25 8 38h11c0-15-3-29-9-41z" />
    <path d="M96 20l8 4-22 44-8-4z" /></>) },
  { name: 'Martial arts', d: (<>
    <circle cx="46" cy="40" r="9.5" />
    <path d="M37 50c-3 11-3 24 0 36l19-1c3-13 3-25 1-35z" />
    <path d="M54 56c9-1 17 2 24 8l-8 9c-4-3-9-5-15-5z" />
    <path d="M38 58c-8 3-13 9-15 18l10 3c2-5 5-9 10-11z" />
    <path d="M37 86c0 13 3 24 9 34l11-6c-4-8-6-17-6-26z" />
    <path d="M54 84c14 0 27-5 38-14l7 10c-13 12-30 18-47 18z" /></>) },
]
