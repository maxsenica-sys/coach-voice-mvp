/**
 * One call to the summariser, used by both routes that need one.
 *
 * The prompt, its name gate and its response parser live in
 * `lib/summary-prompt.ts` — they moved out of the route because that file
 * imports `next/server`, which meant the most consequential text in the product
 * could not be executed, let alone checked, outside a running server. What
 * lives here is the part that genuinely needs a server: the API key and the
 * fetch.
 *
 * It is in `lib/` rather than inside a route for the reason CLAUDE.md gives:
 * two routes now generate a summary — `/api/sessions/summary` when the coach
 * stops recording, and `/api/sessions` when a save arrives without one — and a
 * second copy of this would drift from the first the day either changed. A rig
 * can import this; it cannot import a function declared inside a route file.
 *
 * See tools/prompt-rig.mjs for what is asserted about the prompt on every commit.
 */
import {
  buildSummaryPrompt,
  mayPersonalise,
  parseSummaryResponse,
  EMPTY_SUMMARY,
  type QuickSummary,
} from '@/lib/summary-prompt'
import { guardSummary } from '@/lib/summary-guard'
import { checkContent } from '@/lib/content-gate'

export async function makeQuickSummary(
  transcript: string,
  sport?: string | null,
  athleteName?: string | null,
  /** Every first name this recording is saved against — see mayPersonalise. */
  rosterFirstNames: readonly string[] = [],
): Promise<QuickSummary> {
  const key = process.env.OPENAI_API_KEY
  if (!key) return EMPTY_SUMMARY

  // Not every recording is coaching, and not everything said may reach a
  // child. A blocked recording gets no summary at all — not a softened one —
  // and the caller is told why (lib/content-gate.ts).
  const gate = await checkContent(transcript)
  if (gate.blocked) {
    console.warn('[summary] not summarised:', gate.reasons.join(', '))
    return { ...EMPTY_SUMMARY, blocked: true }
  }

  /* The name reaches the prompt only if it can safely identify one child.
   *
   * On a squad save the same transcript is posted once per member, so "Jack,
   * you're dropping your elbow" used to be delivered to BOTH Jacks as their
   * coach speaking to them by name. buildSummaryPrompt gates on the name being
   * present; mayPersonalise additionally refuses when the roster makes that
   * name ambiguous, and falls back to the generic summary. */
  const safeName = mayPersonalise(transcript, athleteName, rosterFirstNames)
    ? athleteName
    : null

  const prompt = buildSummaryPrompt(transcript, sport, safeName)

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) return EMPTY_SUMMARY

    const json = await res.json()
    const content: string = json?.choices?.[0]?.message?.content?.trim() || ''
    // Enforced, not requested: at most five bullets, and only what was said
    // (lib/summary-guard.ts). A bullet or takeaway the coach never said is
    // dropped before anyone reads it.
    const guarded = guardSummary(parseSummaryResponse(content), transcript)
    return { summary: guarded.summary, next: guarded.next }
  } catch {
    return EMPTY_SUMMARY
  }
}
