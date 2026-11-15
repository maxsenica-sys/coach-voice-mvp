// cast.js — the three-person cast as a rig, drawn in code.
//
// One skeleton, three costumes. A pose is a handful of joint angles, so the
// same face and proportions hold across every post, and any two poses can be
// interpolated: that is the animation, for free.
//
// Angles are degrees from straight down; positive swings toward the way the
// character faces. Lower limbs are relative to the upper ones.

(function () {
  const C = { ink: '#1F2421', cream: '#F5ECD7', sage: '#A8CBA0', moss: '#3A4F38' }
  window.PAL = C

  const COSTUME = {
    coach:     { top: C.sage,  bottom: C.ink,  hair: 'cap',   shoes: C.ink,  number: null },
    athleteA:  { top: C.cream, bottom: C.moss, hair: 'pony',  shoes: C.ink,  number: '7', kneepads: true },
    athleteB:  { top: C.moss,  bottom: C.ink,  hair: 'curls', shoes: C.ink,  number: '12', kneepads: true, numberColor: C.cream },
  }
  window.COSTUME = COSTUME

  // Proportions, in rig units (a standing figure is about 200 tall).
  const L = { torso: 64, neck: 7, headR: 15, upperArm: 31, foreArm: 29, thigh: 44, shin: 44, foot: 15,
              limb: 13, line: 3.2 }

  const rad = (d) => (d * Math.PI) / 180
  const at = (p, deg, len) => [p[0] + Math.sin(rad(deg)) * len, p[1] + Math.cos(rad(deg)) * len]
  const pts = (arr) => arr.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')

  // ── poses ─────────────────────────────────────────────────────────────
  // torso: lean forward; head: tilt (+ = nod forward); arms/legs: [upper, lowerRel]
  // lift: raise the whole body off the ground (jumps); props: what is in hand.
  const STAND = { torso: 2, head: 0, armB: [-8, 10], armF: [8, 12], legB: [-4, 3], legF: [6, -3], lift: 0 }
  const POSES = {
    // Coach
    'coach-phone-talking': { who: 'coach', torso: 3, head: -4, armB: [-6, 12], armF: [14, 150], legB: [-5, 3], legF: [7, -3], props: { phone: 'ear' }, fx: 'talk' },
    'coach-phone-showing': { who: 'coach', torso: 2, head: 4, armB: [-8, 10], armF: [40, 60], legB: [-5, 3], legF: [7, -3], props: { phone: 'show' } },
    'coach-watching':      { who: 'coach', torso: -2, head: -6, armB: [-20, 40], armF: [-18, 38], legB: [-9, 4], legF: [10, -4], props: { whistle: true } },
    'coach-pointing':      { who: 'coach', torso: 4, head: -2, armB: [-10, 14], armF: [100, -8], legB: [-6, 3], legF: [10, -4], hand: 'point' },
    'coach-head-in-hands': { who: 'coach', torso: 22, head: 34, armB: [48, 112], armF: [56, 104], legB: [-4, 3], legF: [6, -3] },
    'coach-kneeling':      { who: 'coach', torso: 6, head: 6, armB: [10, 30], armF: [45, 50], legB: [8, -108], legF: [88, -88], props: { clipboard: true }, kneel: true },
    'coach-thumbs-up':     { who: 'coach', torso: 1, head: -6, armB: [-8, 10], armF: [36, 118], legB: [-5, 3], legF: [7, -3], hand: 'thumb' },
    'coach-walking':       { who: 'coach', torso: 6, head: 0, armB: [26, 24], armF: [-24, 30], legB: [-24, 10], legF: [26, -18], props: { phone: 'low' } },
    'coach-phone-ear':     { who: 'coach', torso: 2, head: 6, armB: [-6, 12], armF: [18, 152], legB: [-5, 3], legF: [7, -3], props: { phone: 'ear' }, fx: 'listen' },
    'coach-clipboard':     { who: 'coach', torso: 4, head: 14, armB: [22, 70], armF: [30, 64], legB: [-5, 3], legF: [7, -3], props: { clipboard: true } },
    // Athlete A
    'athlete-listening':     { who: 'athleteA', torso: 0, head: -3, armB: [-6, 8], armF: [6, 10], legB: [-6, 3], legF: [6, -3] },
    'athlete-nodding':       { who: 'athleteA', torso: 2, head: 14, armB: [-6, 8], armF: [6, 10], legB: [-6, 3], legF: [6, -3], fx: 'nod' },
    'athlete-confused':      { who: 'athleteA', torso: -2, head: -10, armB: [-6, 8], armF: [30, 140], legB: [-6, 3], legF: [6, -3], fx: 'question' },
    'athlete-spiking':       { who: 'athleteA', torso: -10, head: -14, armB: [40, 20], armF: [168, 6], legB: [-30, 70], legF: [18, 60], lift: 70, props: { ball: 'spike' } },
    'athlete-receiving':     { who: 'athleteA', torso: 26, head: -14, armB: [62, 0], armF: [66, 0], legB: [-30, 60], legF: [46, -70], props: { ball: 'pass' }, low: true },
    'athlete-reading-phone': { who: 'athleteA', torso: 4, head: 18, armB: [-6, 10], armF: [26, 104], legB: [-6, 3], legF: [6, -3], props: { phone: 'read' } },
    'athlete-thumbs-up':     { who: 'athleteA', torso: 0, head: -8, armB: [-6, 8], armF: [34, 120], legB: [-6, 3], legF: [6, -3], hand: 'thumb' },
    'athlete-sitting':       { who: 'athleteA', torso: -4, head: 4, armB: [-12, 20], armF: [40, 80], legB: [84, -86], legF: [92, -96], props: { bottle: true, bench: true }, sit: true },
    // Athlete B
    'athlete-b-beside':        { who: 'athleteB', torso: 0, head: -2, armB: [-8, 8], armF: [8, 8], legB: [-6, 3], legF: [6, -3] },
    'athlete-b-group':         { who: 'athleteB', torso: 2, head: 4, armB: [-30, 20], armF: [44, 20], legB: [-8, 3], legF: [8, -3] },
    'athlete-b-jumping':       { who: 'athleteB', torso: -4, head: -10, armB: [150, 10], armF: [160, 8], legB: [-20, 50], legF: [16, 40], lift: 60, fx: 'jump' },
    'athlete-b-blocking':      { who: 'athleteB', torso: -2, head: -12, armB: [172, 0], armF: [176, 0], legB: [-8, 20], legF: [8, 14], lift: 46 },
    'athlete-b-reading-phone': { who: 'athleteB', torso: 4, head: 18, armB: [-6, 10], armF: [26, 104], legB: [-6, 3], legF: [6, -3], props: { phone: 'read' } },
    'athlete-b-celebrating':   { who: 'athleteB', torso: -6, head: -16, armB: [150, 20], armF: [158, 14], legB: [-14, 8], legF: [14, -6], lift: 22, fx: 'cheer' },
  }
  window.POSES = POSES

  // Interpolate two poses (for the animation).
  function mix(a, b, t) {
    const n = (x, y) => (x ?? 0) + ((y ?? 0) - (x ?? 0)) * t
    const pair = (x, y) => [n(x[0], y[0]), n(x[1], y[1])]
    return { ...b, torso: n(a.torso, b.torso), head: n(a.head, b.head), lift: n(a.lift, b.lift),
             armB: pair(a.armB, b.armB), armF: pair(a.armF, b.armF), legB: pair(a.legB, b.legB), legF: pair(a.legF, b.legF) }
  }
  window.mixPose = mix
  window.STAND = STAND

  // ── drawing ───────────────────────────────────────────────────────────
  function limb(points, fill, width) {
    const d = pts(points)
    return `<polyline points="${d}" fill="none" stroke="${C.ink}" stroke-width="${width + L.line * 2}" stroke-linecap="round" stroke-linejoin="round"/>` +
           `<polyline points="${d}" fill="none" stroke="${fill}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
  }

  function seg(a, b, frac) { return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac] }

  function arm(shoulder, ang, cos, side, hand) {
    const elbow = at(shoulder, ang[0], L.upperArm)
    const wrist = at(elbow, ang[0] + ang[1], L.foreArm)
    let s = limb([shoulder, elbow, wrist], C.cream, L.limb - 1)
    // short sleeve over the top of the upper arm
    s += limb([shoulder, seg(shoulder, elbow, 0.42)], cos.top, L.limb + 2)
    // hand
    const handAng = ang[0] + ang[1]
    if (hand === 'thumb' && side === 'F') {
      s += `<circle cx="${wrist[0]}" cy="${wrist[1]}" r="7.5" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>`
      s += limb([at(wrist, 180, 3), at(wrist, 180, 13)], C.cream, 5)
    } else if (hand === 'point' && side === 'F') {
      s += limb([wrist, at(wrist, handAng, 12)], C.cream, 5)
      s += `<circle cx="${wrist[0]}" cy="${wrist[1]}" r="6.5" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>`
    } else {
      s += `<circle cx="${wrist[0]}" cy="${wrist[1]}" r="6.5" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>`
    }
    return { svg: s, wrist, elbow }
  }

  function leg(hip, ang, cos) {
    const knee = at(hip, ang[0], L.thigh)
    const ankle = at(knee, ang[0] + ang[1], L.shin)
    let s = limb([hip, knee, ankle], C.cream, L.limb + 1)
    // shorts or trousers
    const cover = cos.kneepads ? 0.55 : 1.0
    s += limb([hip, seg(hip, knee, cover)], cos.bottom, L.limb + 5)
    if (cover === 1.0) s += limb([knee, seg(knee, ankle, 0.92)], cos.bottom, L.limb + 3)
    if (cos.kneepads) s += limb([seg(hip, knee, 0.86), seg(knee, ankle, 0.14)], C.ink, L.limb + 4)
    // shoe: pointing the way the character faces
    const toe = [ankle[0] + L.foot * 1, ankle[1] + 2]
    s += limb([[ankle[0] - 3, ankle[1] + 1], toe], cos.shoes, 9)
    return { svg: s, knee, ankle }
  }

  function head(center, tilt, cos) {
    const r = L.headR
    let s = `<g transform="rotate(${tilt} ${center[0]} ${center[1]})">`
    if (cos.hair === 'pony') {
      s += `<path d="M${center[0] - r * 0.6},${center[1] - r * 0.5} q-22,6 -20,30 q10,-8 22,-20 z" fill="${C.ink}" stroke="${C.ink}" stroke-width="${L.line}" stroke-linejoin="round"/>`
    }
    // head with a small nose toward the front
    s += `<path d="M${center[0] + r * 0.92},${center[1] - 2} l6,5 l-5,3" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}" stroke-linejoin="round"/>`
    s += `<circle cx="${center[0]}" cy="${center[1]}" r="${r}" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>`
    // one dot of an eye toward the front, and an ear toward the back
    s += `<circle cx="${center[0] + r * 0.5}" cy="${center[1] - 1}" r="2.3" fill="${C.ink}"/>`
    s += `<path d="M${center[0] - r * 0.28},${center[1] - 3} a4,4 0 1 0 0,8" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>`
    if (cos.hair === 'cap') {
      s += `<path d="M${center[0] - r - 1},${center[1] - 1} a${r + 1},${r + 1} 0 0 1 ${2 * r + 2},0 z" fill="${C.ink}"/>`
      s += `<path d="M${center[0] + r * 0.3},${center[1] - 2} l${r + 6},2" stroke="${C.ink}" stroke-width="5.5" stroke-linecap="round"/>`
    } else if (cos.hair === 'pony') {
      s += `<path d="M${center[0] - r - 1},${center[1] + 2} a${r + 1},${r + 1} 0 0 1 ${2 * r - 2},-${r * 0.9} q-6,8 -${r * 0.9},${r * 0.55} z" fill="${C.ink}"/>`
      s += `<path d="M${center[0] - r - 1},${center[1] + 2} a${r + 1},${r + 1} 0 0 1 ${r + 4},-${r + 1} l0,${r * 0.7} z" fill="${C.ink}"/>`
    } else if (cos.hair === 'curls') {
      for (const [dx, dy, rr] of [[-10, -9, 6.5], [-3, -13, 6.5], [5, -12, 6], [-13, -1, 6], [11, -7, 5]]) {
        s += `<circle cx="${center[0] + dx}" cy="${center[1] + dy}" r="${rr}" fill="${C.ink}"/>`
      }
    }
    s += `</g>`
    return s
  }

  function torsoShape(hip, top, cos, lean) {
    const dirUp = rad(180 - lean)
    const px = Math.cos(dirUp), py = -Math.sin(dirUp) // perpendicular
    const w1 = 17, w2 = 21
    const p = [
      [hip[0] - px * w1, hip[1] - py * w1], [hip[0] + px * w1, hip[1] + py * w1],
      [top[0] + px * w2, top[1] + py * w2], [top[0] - px * w2, top[1] - py * w2],
    ]
    let s = `<path d="M${pts([p[0]])} L${pts([p[1]])} L${pts([p[2]])} Q${top[0]},${top[1] - 6} ${pts([p[3]])} Z" fill="${cos.top}" stroke="${C.ink}" stroke-width="${L.line}" stroke-linejoin="round"/>`
    if (cos.number) {
      const mid = seg(hip, top, 0.55)
      s += `<text x="${mid[0]}" y="${mid[1] + 7}" text-anchor="middle" font-family="Pindar Sans" font-weight="800" font-size="19" fill="${cos.numberColor || C.ink}" transform="rotate(${lean} ${mid[0]} ${mid[1]})">${cos.number}</text>`
    }
    return s
  }

  function phoneSvg(x, y, rot, scale, screen) {
    return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${scale})">` +
      `<rect x="-11" y="-20" width="22" height="40" rx="5" fill="${C.ink}" stroke="${C.ink}" stroke-width="2"/>` +
      `<rect x="-8" y="-16" width="16" height="31" rx="2.5" fill="${screen || C.sage}"/>` +
      `<rect x="-5" y="-11" width="10" height="2.6" rx="1.3" fill="${C.ink}"/>` +
      `<rect x="-5" y="-6" width="7" height="2.6" rx="1.3" fill="${C.ink}"/>` +
      `<rect x="-5" y="-1" width="9" height="2.6" rx="1.3" fill="${C.ink}"/></g>`
  }

  function ballSvg(x, y, r) {
    return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>` +
      `<path d="M${x - r},${y} q${r},-${r * 0.7} ${2 * r},0 M${x},${y - r} q-${r * 0.6},${r} 0,${2 * r} M${x - r * 0.7},${y + r * 0.7} q${r * 0.9},-${r * 0.2} ${r * 1.4},-${r * 1.4}" fill="none" stroke="${C.ink}" stroke-width="2.4"/></g>`
  }

  /**
   * Draw a character. pose: a POSES entry (or a mix). Returns SVG markup for a
   * <g> whose origin is the point on the ground between the feet.
   * opts: { t (seconds, for idle motion), facing (1|-1) }
   */
  function draw(pose, opts = {}) {
    const cos = COSTUME[pose.who]
    const t = opts.t ?? 0
    const facing = opts.facing ?? 1
    let p = pose
    // idle and loop motion
    let headTilt = p.head
    if (p.fx === 'nod') headTilt += Math.sin(t * 6.2) * 9
    const breathe = Math.sin(t * 2.2) * 1.2
    const lean = p.torso + breathe * 0.4
    let lift = p.lift || 0
    if (p.fx === 'jump' || p.fx === 'cheer') lift += Math.abs(Math.sin(t * 3)) * 18

    const hip = [0, 0]
    const legB = leg([hip[0] - 4, hip[1]], p.legB, cos)
    const legF = leg([hip[0] + 4, hip[1]], p.legF, cos)
    const top = at(hip, 180 - lean, L.torso)
    const shoulder = seg(hip, top, 0.9)
    const neckTop = at(top, 180 - lean, L.neck)
    const headC = at(neckTop, 180 - (lean + headTilt * 0.6), L.headR - 2)
    const armB = arm(shoulder, p.armB, cos, 'B', p.hand)
    const armF = arm(shoulder, p.armF, cos, 'F', p.hand)

    // ground: lowest point of the legs sits on y = 0 (minus any lift)
    const lows = [legB.ankle[1] + 6, legF.ankle[1] + 6]
    if (p.kneel) lows.push(legB.knee[1] + 7)
    let ground = Math.max(...lows)
    if (p.sit) ground = Math.max(legB.ankle[1], legF.ankle[1]) + 6
    const dy = -ground - lift

    let s = ''
    // props behind the body
    let body = ''
    if (p.props?.bench) body += `<rect x="-30" y="8" width="58" height="12" rx="3" fill="${C.moss}" stroke="${C.ink}" stroke-width="${L.line}"/><rect x="-24" y="18" width="7" height="${-dy - 20}" fill="${C.ink}"/><rect x="16" y="18" width="7" height="${-dy - 20}" fill="${C.ink}"/>`
    body += armB.svg + legB.svg
    body += `<rect x="${neckTop[0] - 5}" y="${Math.min(top[1], neckTop[1]) - 2}" width="10" height="${Math.abs(neckTop[1] - top[1]) + 6}" rx="4" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}" transform="rotate(${lean} ${top[0]} ${top[1]})"/>`
    body += torsoShape(hip, top, cos, lean) + legF.svg
    if (p.props?.whistle) body += `<path d="M${top[0] - 9},${top[1] + 2} Q${top[0] + 2},${top[1] + 26} ${top[0] + 12},${top[1] + 4}" fill="none" stroke="${C.ink}" stroke-width="2.2"/><rect x="${top[0] - 2}" y="${top[1] + 18}" width="10" height="6" rx="2" fill="${C.ink}"/>`
    body += head(headC, headTilt + lean * 0.4, cos)
    body += armF.svg
    const w = armF.wrist
    if (p.props?.phone === 'ear') body += phoneSvg(w[0] + 2, w[1] - 4, -12, 0.85)
    if (p.props?.phone === 'show') body += phoneSvg(w[0] + 8, w[1] - 14, 0, 1.25, C.cream)
    if (p.props?.phone === 'read') body += phoneSvg(w[0] + 6, w[1] - 8, 18, 0.95)
    if (p.props?.phone === 'low') body += phoneSvg(w[0] + 2, w[1] + 2, 10, 0.8)
    if (p.props?.clipboard) body += `<g transform="translate(${w[0] + 6} ${w[1] - 10}) rotate(14)"><rect x="-14" y="-18" width="28" height="36" rx="3" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/><rect x="-6" y="-21" width="12" height="6" rx="2" fill="${C.ink}"/><path d="M-8,-6 h16 M-8,1 h12 M-8,8 h14" stroke="${C.ink}" stroke-width="2.4"/></g>`
    if (p.props?.bottle) body += `<g transform="translate(${w[0] + 3} ${w[1] - 12}) rotate(-10)"><rect x="-6" y="-14" width="12" height="28" rx="4" fill="${C.sage}" stroke="${C.ink}" stroke-width="${L.line}"/><rect x="-3.5" y="-19" width="7" height="6" rx="2" fill="${C.ink}"/></g>`
    if (p.props?.ball === 'spike') body += ballSvg(w[0] + 14, w[1] - 16, 13)
    if (p.props?.ball === 'pass') body += ballSvg(w[0] + 12, w[1] - 34 - Math.abs(Math.sin(t * 2.5)) * 30, 13)
    // effect marks, drawn in ink
    const hc = headC
    if (p.fx === 'question') body += `<text x="${hc[0] + 10}" y="${hc[1] - 26}" font-family="Pindar Sans" font-weight="800" font-size="34" fill="${C.ink}">?</text>`
    if (p.fx === 'talk' || p.fx === 'listen') {
      const k = p.fx === 'talk' ? 0.5 + 0.5 * Math.sin(t * 9) : 1
      body += `<path d="M${hc[0] + 26},${hc[1] - 12} q8,10 0,22 M${hc[0] + 34},${hc[1] - 18} q12,16 0,34" fill="none" stroke="${C.ink}" stroke-width="3" stroke-linecap="round" opacity="${k.toFixed(2)}"/>`
    }
    if (p.fx === 'cheer') body += `<path d="M${hc[0] - 30},${hc[1] - 30} l-10,-10 M${hc[0]},${hc[1] - 40} l0,-14 M${hc[0] + 30},${hc[1] - 30} l10,-10" stroke="${C.ink}" stroke-width="3.2" stroke-linecap="round"/>`
    if (p.fx === 'jump' || (p.lift || 0) > 30) body += `<path d="M-18,${ground + 20} h-16 M4,${ground + 26} h-20" stroke="${C.ink}" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`
    s += `<g transform="translate(0 ${dy.toFixed(1)})">${body}</g>`
    // ground shadow (an ink ellipse, flat)
    const shadowW = Math.max(18, 40 - lift * 0.25)
    const shadow = `<ellipse cx="2" cy="1" rx="${shadowW}" ry="5" fill="${C.ink}" opacity="0.18"/>`
    return `<g transform="scale(${facing} 1)">${shadow}${s}</g>`
  }
  window.drawCharacter = draw
})()
