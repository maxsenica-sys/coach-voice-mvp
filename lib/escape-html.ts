// lib/escape-html.ts
//
// Text going into an HTML email. Every value a person typed — a name, a
// message, a session title, a check-in note — passes through this before it
// is interpolated into markup, because an email client renders what it is
// given: an athlete who types <a href="…">tap here</a> into a message would
// otherwise put a working link in their coach's inbox, under CoachVoice's name.
//
// Pure, and in lib/ so tools/email-rig.mjs can run it.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A display name for a From header: "Jordan Lee via CoachVoice". A name is
 * typed by a person, and inside `Name <address>` the characters < > " \ and a
 * line break are syntax — `Coach <someone@else.com>` would try to make the
 * mail claim a different sender. Those are dropped, whitespace is collapsed,
 * and the result is quoted.
 */
export function fromHeader(name: string | null | undefined, address: string): string {
  const clean = (name ?? '').replace(/[\r\n]+/g, ' ').replace(/[<>"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `"${clean || 'CoachVoice'}" <${address}>`
}
