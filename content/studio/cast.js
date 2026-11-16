// cast.js: the cast as a rig, drawn in code.
//
// One skeleton, six costumes. A pose is a set of joint angles, so the same
// face and proportions hold across every post, and any two poses can be
// interpolated: that is the animation.
//
// The poses are built from how the skill is actually performed (see
// README.md, "Where the poses come from"), not from what looks tidy:
//   · the spine has two segments, so a back can arch in a swing and slump in
//     a bad moment;
//   · shoulders rotate against the hips (`twist`), which is what makes a
//     swing or a walk read as one;
//   · a knee only bends one way, and a foot is either planted flat or given
//     an angle (toes pointed in the air, heel raised pushing off).
//
// Angles are degrees from straight down; positive swings toward the way the
// character faces. A forearm or shin is relative to the limb above it.
//
//   arm: [upperArm, elbow]            elbow: + folds the forearm forward/up
//   leg: [thigh, knee, foot?]         knee: always <= 0 (the shin folds back)
//                                     foot: omit = planted flat; else the
//                                     foot's own angle (90 = toes down)

(function () {
  const C = { ink: '#1F2421', cream: '#F5ECD7', sage: '#A8CBA0', moss: '#3A4F38' }
  window.PAL = C

  // ── who they are ──────────────────────────────────────────────────────
  // Four colours only, so each character is told apart by silhouette as much
  // as by kit: cap, ponytail, curls and headband, crop, beard, bun and bag.
  const COSTUME = {
    coach:     { top: C.sage,  bottom: C.ink,  legs: 'long', stripe: C.sage, hair: 'cap', collar: 'polo', whistle: true, watch: true, build: 1.04 },
    assistant: { top: C.cream, bottom: C.moss, legs: 'long', hair: 'short', beard: true, collar: 'polo', lanyard: true, build: 1.06 },
    athleteA:  { top: C.cream, bottom: C.moss, legs: 'shorts', kneepads: true, hair: 'pony', collar: 'v', number: '7', sock: C.sage, wristband: C.sage, build: 0.96 },
    athleteB:  { top: C.moss,  bottom: C.ink,  legs: 'shorts', kneepads: true, hair: 'curls', headband: C.sage, collar: 'v', number: '12', numberColor: C.cream, sock: C.cream, build: 1.0 },
    athleteC:  { top: C.ink,   bottom: C.sage, legs: 'shorts', kneepads: true, hair: 'crop', collar: 'v', number: '4', numberColor: C.cream, sock: C.cream, armSleeves: true, build: 1.08 },
    parent:    { top: C.moss,  bottom: C.cream, legs: 'long', hair: 'bun', glasses: true, sleeves: 'long', scarf: C.sage, bag: true, hem: 12, build: 0.98 },
  }
  window.COSTUME = COSTUME

  // Proportions in rig units; a standing figure is about 205 tall.
  const L = { low: 26, up: 38, neck: 7, headRx: 13, headRy: 14.5, upperArm: 30, foreArm: 27, thigh: 46, shin: 44, line: 3 }
  const W = { upperArm: 10.5, foreArm: 9, thigh: 15, shin: 11.5 }
  const SOLE = 10.5 // ankle to the ground when the foot is flat

  const rad = (d) => (d * Math.PI) / 180
  const at = (p, deg, len) => [p[0] + Math.sin(rad(deg)) * len, p[1] + Math.cos(rad(deg)) * len]
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
  const f1 = (n) => n.toFixed(1)
  const pts = (arr) => arr.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')

  const stroke = (points, color, w, extra = '') =>
    `<polyline points="${pts(points)}" fill="none" stroke="${color}" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`
  /** A stroke with an ink outline. */
  const part = (points, color, w) => stroke(points, C.ink, w + L.line * 2) + stroke(points, color, w)
  /** A thin ink detail line. */
  const detail = (points, w = 2) => stroke(points, C.ink, w)

  /** A smooth closed shape through the points (Catmull-Rom). */
  function blob(points, fill) {
    const n = points.length
    let d = `M${f1(points[0][0])},${f1(points[0][1])}`
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n]
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
      d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`
    }
    return `<path d="${d}Z" fill="${fill}" stroke="${C.ink}" stroke-width="${L.line}" stroke-linejoin="round"/>`
  }

  // ── hands ─────────────────────────────────────────────────────────────
  // ang is the forearm's direction; the hand continues it.
  function hand(wrist, ang, type = 'relaxed') {
    const c = at(wrist, ang, 4.5)
    const finger = (from, a, len, w = 3) => part([from, at(from, a, len)], C.cream, w)
    const knuckle = `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="5.6" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>`
    if (type === 'fist' || type === 'hold') return knuckle + detail([at(c, ang + 60, 3), at(c, ang - 30, 3.5)], 1.6)
    if (type === 'point') return finger(c, ang, 13, 3.2) + knuckle
    if (type === 'thumb') return part([c, [c[0], c[1] - 11.5]], C.cream, 3.4) + knuckle
    if (type === 'open') {
      // Splayed: a block, a set, a hand calling for the ball.
      const tip = at(wrist, ang, 6.5)
      return [-33, -11, 11, 33].map((d) => finger(tip, ang + d, 10.5, 3.2)).join('') + finger(at(wrist, ang, 2.5), ang + 72, 8, 3.2) +
        `<circle cx="${f1(c[0])}" cy="${f1(c[1])}" r="5.8" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>`
    }
    if (type === 'flat') {
      // Fingers together: a platform, a high five, a palm turned up mid-sentence.
      return finger(at(wrist, ang, 1), ang + 58, 6) + part([wrist, at(wrist, ang, 12.5)], C.cream, 6.4)
    }
    // relaxed: a loose curl
    return finger(at(wrist, ang, 2), ang + 50, 4.5, 2.6) + part([at(wrist, ang, 1.5), at(wrist, ang, 8.5)], C.cream, 6.2)
  }

  // ── limbs ─────────────────────────────────────────────────────────────
  function arm(shoulder, a, cos, handType, near) {
    const elbow = at(shoulder, a[0], L.upperArm)
    const fa = a[0] + a[1]
    const wrist = at(elbow, fa, L.foreArm)
    const long = cos.sleeves === 'long'
    const sleeveEnd = lerp(shoulder, elbow, 0.52)
    let s = ''
    // outlines first, so no ink shows at the elbow
    s += stroke([shoulder, elbow], C.ink, W.upperArm + (long ? 2 : 0) + L.line * 2) + stroke([elbow, wrist], C.ink, W.foreArm + (long ? 1.5 : 0) + L.line * 2)
    if (!long) s += stroke([shoulder, sleeveEnd], C.ink, W.upperArm + 3 + L.line * 2)
    s += stroke([shoulder, elbow], long ? cos.top : C.cream, W.upperArm + (long ? 2 : 0)) + stroke([elbow, wrist], long ? cos.top : C.cream, W.foreArm + (long ? 1.5 : 0))
    if (!long) {
      s += stroke([shoulder, sleeveEnd], cos.top, W.upperArm + 3)
      // the cuff: one line across the arm where the sleeve ends
      const n = at([0, 0], a[0] + 90, (W.upperArm + 3) / 2)
      s += detail([add(sleeveEnd, n), add(sleeveEnd, [-n[0], -n[1]])], 2.2)
    }
    if (cos.armSleeves) s += stroke([lerp(elbow, wrist, 0.12), lerp(elbow, wrist, 0.86)], cos.top === C.ink ? C.ink : cos.top, W.foreArm + 1)
    const band = near && (cos.watch ? C.ink : cos.wristband)
    if (band) s += stroke([lerp(elbow, wrist, 0.84), lerp(elbow, wrist, 0.93)], band, W.foreArm + 1.2, ' stroke-linecap="butt"')
    if (long) s += detail([add(wrist, at([0, 0], fa + 90, 5)), add(wrist, at([0, 0], fa - 90, 5))], 2)
    return { svg: s, hand: hand(wrist, fa, handType), wrist, elbow, fa }
  }

  function leg(hip, a, cos) {
    const knee = at(hip, a[0], L.thigh)
    const sa = a[0] + a[1]
    const ankle = at(knee, sa, L.shin)
    const long = cos.legs === 'long'
    let s = ''
    s += stroke([hip, knee], C.ink, W.thigh + (long ? 2 : 0) + L.line * 2) + stroke([knee, ankle], C.ink, W.shin + (long ? 3 : 0) + L.line * 2)
    const shortsEnd = lerp(hip, knee, 0.42)
    if (!long) s += stroke([hip, shortsEnd], C.ink, W.thigh + 5 + L.line * 2)
    s += stroke([hip, knee], long ? cos.bottom : C.cream, W.thigh + (long ? 2 : 0)) + stroke([knee, ankle], long ? cos.bottom : C.cream, W.shin + (long ? 3 : 0))
    if (long) {
      if (cos.stripe) s += stroke([lerp(hip, knee, 0.1), knee, lerp(knee, ankle, 0.94)], cos.stripe, 2.2)
      const n = at([0, 0], sa + 90, (W.shin + 3) / 2)
      const cuff = lerp(knee, ankle, 0.95)
      s += detail([add(cuff, n), add(cuff, [-n[0], -n[1]])], 2)
    } else {
      s += stroke([hip, shortsEnd], cos.bottom, W.thigh + 5)
      const n = at([0, 0], a[0] + 90, (W.thigh + 5) / 2)
      s += detail([add(shortsEnd, n), add(shortsEnd, [-n[0], -n[1]])], 2.2)
      if (cos.sock) {
        const top = lerp(knee, ankle, 0.78)
        s += stroke([top, ankle], cos.sock, W.shin + 0.6, ' stroke-linecap="butt"')
        const m = at([0, 0], sa + 90, (W.shin + 0.6) / 2)
        s += detail([add(top, m), add(top, [-m[0], -m[1]])], 2)
      }
      if (cos.kneepads) s += stroke([lerp(hip, knee, 0.88), knee, lerp(knee, ankle, 0.12)], C.ink, W.thigh + 3)
    }
    // the shoe turns about the ankle: flat unless the pose gives it an angle
    const f = a[2] ?? 0
    const r = ([x, y]) => [ankle[0] + x * Math.cos(rad(f)) - y * Math.sin(rad(f)), ankle[1] + x * Math.sin(rad(f)) + y * Math.cos(rad(f))]
    s += stroke([r([-5, 5.2]), r([14.5, 6])], C.ink, 9.4)
    s += stroke([r([-6.5, 7.6]), r([15.5, 7.8])], C.cream, 1.9)
    s += stroke([r([4, 1.6]), r([9, 2.6])], C.cream, 1.4)
    const low = Math.max(r([-6, SOLE])[1], r([15, SOLE])[1], ankle[1] + 4)
    return { svg: s, knee, ankle, low }
  }

  // ── head ──────────────────────────────────────────────────────────────
  const FACES = {
    neutral: { brow: [-8.6, -8.8], mouth: 'line' },
    smile:   { brow: [-9.4, -9.6], mouth: 'smile' },
    grin:    { brow: [-10, -10.2], mouth: 'grin' },
    focus:   { brow: [-9.6, -7.4], mouth: 'line' },
    worried: { brow: [-7.6, -10.6], mouth: 'frown' },
    puzzled: { brow: [-10.4, -11.6], mouth: 'skew' },
    talk:    { brow: [-9, -9.2], mouth: 'talk' },
    shout:   { brow: [-9.8, -8.2], mouth: 'shout' },
    pained:  { brow: [-7.4, -10.2], mouth: 'frown', eye: 'shut' },
    listen:  { brow: [-9, -9.4], mouth: 'line', eye: 'shut' },
  }

  function head(c, rot, cos, faceName, pony) {
    const [x, y] = c
    const rx = L.headRx, ry = L.headRy
    const face = FACES[faceName] || FACES.neutral
    const ink = C.ink
    let s = `<g transform="rotate(${f1(rot)} ${f1(x)} ${f1(y)})">`
    // hair that sits behind the head
    if (cos.hair === 'pony') {
      // the tail swings: `pony` is its angle from straight back
      const root = [x - 9.5, y - 9.5]
      const a = pony ?? 28
      const mid = at(root, -90 + a - 14, 15), tip = at(root, -90 + a + 16, 30)
      s += `<path d="M${f1(root[0])},${f1(root[1] - 4)} Q${f1(mid[0])},${f1(mid[1] - 7)} ${f1(tip[0])},${f1(tip[1])} Q${f1(mid[0] + 2)},${f1(mid[1] + 6)} ${f1(root[0] + 2)},${f1(root[1] + 5)} Z" fill="${ink}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`
    }
    if (cos.hair === 'bun') s += `<circle cx="${f1(x - 13.5)}" cy="${f1(y - 9)}" r="7" fill="${ink}"/>`
    // nose, then the head over its root so the profile is one line
    s += `<path d="M${f1(x + rx - 1.5)},${f1(y - 3.5)} q7.5,5.5 1,8.5" fill="${C.cream}" stroke="${ink}" stroke-width="${L.line}" stroke-linejoin="round" stroke-linecap="round"/>`
    s += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${rx}" ry="${ry}" fill="${C.cream}" stroke="${ink}" stroke-width="${L.line}"/>`
    // ear
    s += `<path d="M${f1(x - 3.4)},${f1(y - 3)} a4,4.6 0 1 0 0.6,8.4" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`
    // eye and brow
    if (face.eye === 'shut') s += `<path d="M${f1(x + 4.4)},${f1(y - 2.6)} q2.4,2 4.8,0" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`
    else s += `<circle cx="${f1(x + 6.8)}" cy="${f1(y - 2.6)}" r="1.9" fill="${ink}"/>`
    s += `<path d="M${f1(x + 3.4)},${f1(y + face.brow[0])} L${f1(x + 10.4)},${f1(y + face.brow[1])}" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`
    // mouth
    const mx = x + 5, my = y + 6.8
    const mouths = {
      line: `<path d="M${f1(mx)},${f1(my)} l5.4,-0.4" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round"/>`,
      smile: `<path d="M${f1(mx - 0.6)},${f1(my - 1.2)} q3.6,4 7,-0.8" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round"/>`,
      grin: `<path d="M${f1(mx - 1)},${f1(my - 1.6)} q4,6.4 7.8,-0.6 z" fill="${ink}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`,
      frown: `<path d="M${f1(mx)},${f1(my + 1)} q3,-3 6,-0.4" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round"/>`,
      skew: `<path d="M${f1(mx)},${f1(my + 0.6)} l2.6,-1.2 l3,1.4" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`,
      talk: `<ellipse cx="${f1(mx + 3.2)}" cy="${f1(my)}" rx="2.7" ry="2.1" fill="${ink}"/>`,
      shout: `<ellipse cx="${f1(mx + 3)}" cy="${f1(my + 0.6)}" rx="3.3" ry="3.9" fill="${ink}"/>`,
    }
    s += mouths[face.mouth]
    if (cos.beard) s += `<path d="M${f1(x - 5.5)},${f1(y + 6)} Q${f1(x - 1)},${f1(y + 16.4)} ${f1(x + 9)},${f1(y + 11.2)}" fill="none" stroke="${ink}" stroke-width="5.4" stroke-linecap="round"/>`
    if (cos.glasses) s += `<circle cx="${f1(x + 6.8)}" cy="${f1(y - 2.4)}" r="4.5" fill="none" stroke="${ink}" stroke-width="1.7"/><path d="M${f1(x + 2.3)},${f1(y - 2.8)} L${f1(x - 3)},${f1(y - 2.2)}" stroke="${ink}" stroke-width="1.7"/>`
    // hair over the head
    const cap = (frontX, frontY, backY) =>
      `<path d="M${f1(x + frontX)},${f1(y + frontY)} A${rx + 1},${ry + 1} 0 0 0 ${f1(x - rx - 0.8)},${f1(y + backY)} L${f1(x - rx + 3)},${f1(y + backY + 0.5)} Q${f1(x - 4)},${f1(y - 5)} ${f1(x + frontX)},${f1(y + frontY)} Z" fill="${ink}"/>`
    if (cos.hair === 'cap') {
      s += `<path d="M${f1(x - rx - 1)},${f1(y - 2.5)} A${rx + 1},${ry + 1} 0 0 1 ${f1(x + rx + 0.6)},${f1(y - 4.5)} Z" fill="${ink}"/>`
      s += stroke([[x + 8, y - 5], [x + rx + 12, y - 2.6]], ink, 4.8)
      s += `<path d="M${f1(x - rx + 0.5)},${f1(y - 1.5)} q-0.5,6 3,9.5 l2.5,-9.5 z" fill="${ink}"/>`
      s += `<circle cx="${f1(x - 0.5)}" cy="${f1(y - ry - 0.6)}" r="1.9" fill="${ink}"/>`
    } else if (cos.hair === 'pony') {
      s += cap(10.5, -9.5, 5)
      s += `<circle cx="${f1(x - 10.8)}" cy="${f1(y - 9.6)}" r="2.7" fill="${C.sage}" stroke="${ink}" stroke-width="1.4"/>`
    } else if (cos.hair === 'curls') {
      for (const [dx, dy, r] of [[-11.5, 1, 5.6], [-12.5, -6.5, 6.2], [-7, -12.5, 6.4], [0.5, -14.5, 6.2], [7.5, -12, 5.4], [-3.5, -8.5, 6]]) {
        s += `<circle cx="${f1(x + dx)}" cy="${f1(y + dy)}" r="${r}" fill="${ink}"/>`
      }
      if (cos.headband) s += stroke([[x + 11.6, y - 6.6], [x + 2, y - 9], [x - 11.4, y - 2.6]], cos.headband, 3.4)
    } else if (cos.hair === 'crop') {
      s += cap(11, -8.6, -0.5) + `<path d="M${f1(x - 4)},${f1(y - 5)} l0.5,4.5" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`
    } else if (cos.hair === 'short') {
      s += cap(10.2, -9.8, 1.5)
    } else if (cos.hair === 'bun') {
      s += cap(10.8, -9, 5.5)
    }
    return s + `</g>`
  }

  // ── things in hand and in play ────────────────────────────────────────
  function phone(x, y, rot, scale = 1, screen = C.sage) {
    return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${scale})">` +
      `<rect x="-9.5" y="-18" width="19" height="36" rx="4.5" fill="${C.ink}"/>` +
      `<rect x="-7" y="-14.5" width="14" height="28" rx="2" fill="${screen}"/>` +
      `<rect x="-4.4" y="-10" width="8.8" height="2.2" rx="1.1" fill="${C.ink}"/><rect x="-4.4" y="-5.8" width="6" height="2.2" rx="1.1" fill="${C.ink}"/><rect x="-4.4" y="-1.6" width="7.6" height="2.2" rx="1.1" fill="${C.ink}"/></g>`
  }
  function ball(x, y, spin = 0) {
    const r = 12.5
    return `<g transform="rotate(${f1(spin)} ${f1(x)} ${f1(y)})"><circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/>` +
      `<path d="M${f1(x - r)},${f1(y - 1)} q${r},-9 ${2 * r},1 M${f1(x - 9)},${f1(y + 8.6)} q8,-9 6,-20.6 M${f1(x + 2)},${f1(y + 12.2)} q9,-7 10,-17" fill="none" stroke="${C.ink}" stroke-width="2"/></g>`
  }
  const PROPS = {
    phone: (p, o) => phone(p[0], p[1], o.rot ?? 0, o.scale ?? 0.95, o.screen),
    ball: (p, o) => ball(p[0], p[1], o.spin ?? 0),
    clipboard: (p, o) => `<g transform="translate(${f1(p[0])} ${f1(p[1])}) rotate(${o.rot ?? 0})"><rect x="-13" y="-17" width="26" height="34" rx="3" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}"/><rect x="-5.5" y="-20" width="11" height="6" rx="2" fill="${C.ink}"/>` +
      `<rect x="-8" y="-8" width="16" height="12" rx="1.5" fill="none" stroke="${C.ink}" stroke-width="1.6"/><path d="M-8,-2 h16 M-3,-6 l3,3 M3,1 l-2.4,-2.4 M-8,9 h11" fill="none" stroke="${C.ink}" stroke-width="1.6" stroke-linecap="round"/></g>`,
    pen: (p, o) => `<g transform="translate(${f1(p[0])} ${f1(p[1])}) rotate(${o.rot ?? 0})"><path d="M0,-9 L0,9" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/></g>`,
    bottle: (p, o) => `<g transform="translate(${f1(p[0])} ${f1(p[1])}) rotate(${o.rot ?? 0})"><rect x="-5.5" y="-13" width="11" height="26" rx="4" fill="${C.sage}" stroke="${C.ink}" stroke-width="${L.line}"/><rect x="-3.2" y="-18.5" width="6.4" height="6.5" rx="2" fill="${C.ink}"/><path d="M-5.5,-3 h11" stroke="${C.ink}" stroke-width="1.6"/></g>`,
    cup: (p, o) => `<g transform="translate(${f1(p[0])} ${f1(p[1])}) rotate(${o.rot ?? 0})"><path d="M-6.5,-9 h13 l-1.6,19 h-9.8 z" fill="${C.cream}" stroke="${C.ink}" stroke-width="${L.line}" stroke-linejoin="round"/><rect x="-7.6" y="-12" width="15.2" height="4.4" rx="2" fill="${C.ink}"/><path d="M-5.6,-1 h11.2" stroke="${C.ink}" stroke-width="3.4"/></g>`,
  }

  // ── the figure ────────────────────────────────────────────────────────
  const DEFAULTS = { lean: 2, bend: 2, head: 0, twist: 3, shrug: 0, lift: 0, armF: [6, 14], armB: [-10, 12], legF: [9, -10], legB: [-3, -2] }
  const STAND = { ...DEFAULTS }
  window.STAND = STAND

  /** Interpolate two poses. Numbers blend; everything else comes from the target. */
  function mix(a, b, t) {
    const A = { ...DEFAULTS, ...a }, B = { ...DEFAULTS, ...b }
    const n = (x, y) => x + (y - x) * t
    const out = { ...B }
    for (const k of ['lean', 'bend', 'head', 'twist', 'shrug', 'lift']) out[k] = n(A[k], B[k])
    for (const k of ['armF', 'armB', 'legF', 'legB']) {
      out[k] = [n(A[k][0], B[k][0]), n(A[k][1], B[k][1])]
      // a foot angle only blends once the target has one; planted stays planted
      if (B[k][2] != null) out[k][2] = n(A[k][2] ?? 0, B[k][2])
    }
    if (t < 0.5) { out.props = A.props; out.face = A.face ?? B.face; out.fx = undefined }
    return out
  }
  window.mixPose = mix

  /**
   * Draw a character. Returns SVG for a <g> whose origin is the point on the
   * ground under the hips. opts: { t (seconds, for idle motion), facing (1|-1) }
   */
  function draw(pose, opts = {}) {
    const p = { ...DEFAULTS, ...pose }
    const cos = COSTUME[p.who] || COSTUME.coach
    const t = opts.t ?? 0
    const facing = opts.facing ?? 1
    const breathe = Math.sin(t * 2.2)
    let headTilt = p.head
    if (p.fx === 'nod') headTilt += 5 + Math.sin(t * 6.2) * 8
    let lift = p.lift
    if (p.fx === 'cheer') lift += Math.abs(Math.sin(t * 3.4)) * 10

    // spine
    const hip = [0, 0]
    const lean = p.lean + breathe * 0.35
    const upAng = lean + p.bend
    const waist = at(hip, 180 - lean, L.low)
    const chest = at(waist, 180 - upAng, L.up)
    const nLow = [Math.cos(rad(lean)), Math.sin(rad(lean))]
    const nUp = [Math.cos(rad(upAng)), Math.sin(rad(upAng))]
    const nMid = [(nLow[0] + nUp[0]) / 2, (nLow[1] + nUp[1]) / 2]
    const off = (pt, n, d) => [pt[0] + n[0] * d, pt[1] + n[1] * d]
    const b = cos.build ?? 1

    // shoulders turn against the hips; the far one sits a little behind
    const shBase = lerp(waist, chest, 0.93)
    const shNear = [shBase[0] + p.twist, shBase[1] - p.shrug + breathe * 0.5]
    const shFar = [shBase[0] - p.twist * 1.15, shBase[1] - p.shrug - 0.6 + breathe * 0.5]
    const hipNear = [hip[0] + 2.6 - p.twist * 0.25, hip[1]]
    const hipFar = [hip[0] - 2.6 + p.twist * 0.25, hip[1]]

    const legNear = leg(hipNear, p.legF, cos)
    const legFar = leg(hipFar, p.legB, cos)
    const armNear = arm(shNear, p.armF, cos, p.handF, true)
    const armFar = arm(shFar, p.armB, cos, p.handB, false)

    const headAng = upAng * 0.5 + headTilt
    const neckTop = at(chest, 180 - (upAng * 0.6 + headTilt * 0.4), L.neck)
    const headC = at(neckTop, 180 - headAng, L.headRy - 4)

    // where the ground is
    const lows = [legNear.low, legFar.low]
    if (p.kneel) lows.push(legFar.knee[1] + 8.5)
    const ground = Math.max(...lows)
    const dy = -ground - lift

    // props, by layer
    const anchor = { F: armNear.wrist, B: armFar.wrist, chest, head: headC, hip }
    const prop = (layer) => (p.props || []).filter((o) => (o.layer || 'front') === layer).map((o) => {
      const a = anchor[o.at || 'F']
      return PROPS[o.type]([a[0] + (o.dx || 0), a[1] + (o.dy || 0) + (o.bob ? -Math.abs(Math.sin(t * 2.6)) * o.bob : 0)], o)
    }).join('')

    let s = ''
    if (p.bench) {
      const top = hip[1] + 12
      s += `<rect x="-34" y="${f1(top)}" width="62" height="9" rx="3" fill="${C.moss}" stroke="${C.ink}" stroke-width="${L.line}"/>` +
        stroke([[-26, top + 9], [-26, ground]], C.ink, 5.5) + stroke([[20, top + 9], [20, ground]], C.ink, 5.5)
    }
    if (p.net) {
      // the top of the net, turned a little toward us so it reads as a net:
      // the tape, an antenna, and mesh that fades out below
      const nx = chest[0] + p.net[0], ny = chest[1] + p.net[1], nw = 44
      for (let i = 1; i <= 5; i++) s += `<path d="M${f1(nx)},${f1(ny + i * 10)} h${nw}" stroke="${C.ink}" stroke-width="1.5" opacity="${f1(0.62 - i * 0.1)}"/>`
      for (let i = 0; i <= 4; i++) s += `<path d="M${f1(nx + i * 11)},${f1(ny + 4)} v50" stroke="${C.ink}" stroke-width="1.5" opacity="0.3"/>`
      s += stroke([[nx + 4, ny - 30], [nx + 4, ny]], C.ink, 2.6)
      s += `<rect x="${f1(nx - 2)}" y="${f1(ny - 3.5)}" width="${nw + 4}" height="8" rx="2" fill="${C.cream}" stroke="${C.ink}" stroke-width="2.4"/>`
    }
    s += prop('back')
    s += armFar.svg + armFar.hand
    s += legFar.svg
    if (cos.bag) {
      const strap = shNear, bag = [hip[0] - 13, hip[1] - 2]
      s += stroke([strap, [bag[0] + 4, bag[1] - 12]], C.ink, 2.6)
      s += `<rect x="${f1(bag[0] - 13)}" y="${f1(bag[1] - 12)}" width="26" height="28" rx="4" fill="${C.sage}" stroke="${C.ink}" stroke-width="${L.line}"/>`
    }
    // hips and seat, in the colour of the shorts or trousers
    s += part([off(hip, [0, 1], 2), lerp(hip, waist, 0.34)], cos.bottom, 23.5 * b)
    // neck
    s += part([lerp(chest, waist, 0.08), neckTop], C.cream, 8.4)
    // torso: back up, over the shoulders, front down
    const hem = cos.hem ?? 0
    const base = off(lerp(hip, waist, 0.16), [-nLow[1], nLow[0]], hem)
    s += blob([
      off(base, nLow, -13.6 * b), off(waist, nMid, -11.6 * b), off(lerp(waist, chest, 0.66), nUp, -14.6 * b), off(chest, nUp, -9.4 * b),
      off(chest, [nUp[1], -nUp[0]], 2.6),
      off(chest, nUp, 9.6 * b), off(lerp(waist, chest, 0.6), nUp, 15.4 * b), off(waist, nMid, 11.8 * b), off(base, nLow, 13.4 * b),
    ], cos.top)
    // kit details
    const mid = lerp(waist, chest, 0.42)
    if (cos.number) s += `<text x="${f1(mid[0])}" y="${f1(mid[1] + 6.5)}" text-anchor="middle" font-family="Pindar Sans" font-weight="800" font-size="18" fill="${cos.numberColor || C.ink}" transform="rotate(${f1(upAng)} ${f1(mid[0])} ${f1(mid[1])})">${cos.number}</text>`
    const neckFront = off(chest, nUp, 6)
    const vInk = cos.top === C.ink ? C.cream : C.ink
    if (cos.collar === 'v') s += stroke([off(chest, nUp, -2), off(lerp(chest, waist, 0.2), nUp, 5), off(chest, nUp, 9)], vInk, 2)
    if (cos.collar === 'polo') {
      s += `<path d="M${pts([off(chest, nUp, -3)])} L${pts([off(lerp(chest, waist, 0.24), nUp, 8)])} L${pts([neckFront])} Z" fill="${cos.top}" stroke="${C.ink}" stroke-width="2.2" stroke-linejoin="round"/>`
      s += detail([off(lerp(chest, waist, 0.24), nUp, 8), off(lerp(chest, waist, 0.44), nUp, 9.5)], 1.8)
    }
    if (cos.whistle || cos.lanyard) {
      const hang = off(lerp(chest, waist, 0.5), nUp, 12)
      s += `<path d="M${pts([off(chest, nUp, -4)])} Q${pts([off(lerp(chest, waist, 0.5), nUp, 2)])} ${pts([hang])}" fill="none" stroke="${C.ink}" stroke-width="1.8"/>`
      s += cos.whistle
        ? `<rect x="${f1(hang[0] - 2)}" y="${f1(hang[1] - 1)}" width="9" height="5.6" rx="2.4" fill="${C.ink}"/>`
        : `<circle cx="${f1(hang[0] + 1)}" cy="${f1(hang[1] + 3)}" r="4.4" fill="${C.cream}" stroke="${C.ink}" stroke-width="2"/>`
    }
    if (cos.scarf) {
      s += part([off(chest, nUp, -6), off(chest, nUp, 8)], cos.scarf, 6.5)
      s += part([off(chest, nUp, 7), off(lerp(chest, waist, 0.42), nUp, 10)], cos.scarf, 5.5)
    }
    s += legNear.svg
    s += prop('mid')
    s += head(headC, headAng, cos, p.face, p.pony)
    s += armNear.svg
    s += prop('front')
    s += armNear.hand
    if (p.gripB) s += hand(armFar.wrist, armFar.fa, 'hold')

    // marks around the figure, in ink
    const hc = headC
    if (p.fx === 'question') s += `<text x="${f1(hc[0] + 14)}" y="${f1(hc[1] - 22)}" font-family="Pindar Sans" font-weight="800" font-size="32" fill="${C.ink}">?</text>`
    if (p.fx === 'talk') {
      const k = 0.45 + 0.55 * Math.abs(Math.sin(t * 7))
      const m = [hc[0] + 17, hc[1] + 6]
      s += `<path d="M${f1(m[0])},${f1(m[1] - 5)} q5,5 0,10 M${f1(m[0] + 6)},${f1(m[1] - 9)} q9,9 0,18" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round" opacity="${f1(k)}"/>`
    }
    if (p.fx === 'cheer') s += `<path d="M${f1(hc[0] - 26)},${f1(hc[1] - 26)} l-8,-8 M${f1(hc[0] + 2)},${f1(hc[1] - 36)} l0,-12 M${f1(hc[0] + 28)},${f1(hc[1] - 24)} l8,-8" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/>`
    if (p.fx === 'sigh') s += `<path d="M${f1(hc[0] + 20)},${f1(hc[1] + 8)} q6,-2 9,3 M${f1(hc[0] + 24)},${f1(hc[1] + 15)} q5,-1 7,3" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>`
    if (lift > 24) s += `<path d="M-16,${f1(ground + 22)} h-15 M3,${f1(ground + 29)} h-19" stroke="${C.ink}" stroke-width="2.8" stroke-linecap="round" opacity="0.6"/>`

    const shadowW = Math.max(16, (p.wide ?? 40) - lift * 0.3)
    const shadow = `<ellipse cx="${f1(p.shadowX ?? 4)}" cy="1.5" rx="${f1(shadowW)}" ry="5" fill="${C.ink}" opacity="0.16"/>`
    return `<g transform="scale(${facing} 1)">${shadow}<g transform="translate(0 ${f1(dy)})">${s}</g></g>`
  }
  window.drawCharacter = draw

  // ── the poses ─────────────────────────────────────────────────────────
  const POSES = {
    // ── the coach ───────────────────────────────────────────────────────
    // Recording a voice note: phone held flat in front of the mouth, the way
    // people dictate, free hand talking with them.
    'coach-phone-talking': { who: 'coach', lean: 2, bend: 3, head: 2, armF: [30, 112], handF: 'hold', armB: [22, 64], handB: 'flat', face: 'talk',
      props: [{ type: 'phone', at: 'F', rot: 114, dx: -3, dy: -8, layer: 'front' }] },
    // Turning the screen to the athlete and pointing at the line that matters.
    'coach-phone-showing': { who: 'coach', lean: 9, bend: 3, head: 4, twist: 5, armF: [64, 20], handF: 'hold', armB: [44, 46], handB: 'point', legF: [15, -8], legB: [-9, -3], face: 'smile',
      props: [{ type: 'phone', at: 'F', rot: -6, dx: 9, dy: -9, scale: 1.2, screen: C.cream, layer: 'front' }] },
    // Watching a rep: one arm across, chin on the other hand, weight back.
    'coach-watching': { who: 'coach', lean: -1, bend: 5, head: 7, armF: [30, 140], handF: 'fist', armB: [-4, 90], handB: 'relaxed', legF: [10, -8], legB: [-4, -1], face: 'focus' },
    // Pointing to a spot on court, ball on the hip.
    'coach-pointing': { who: 'coach', lean: 7, bend: 2, head: -2, twist: 6, armF: [84, 5], handF: 'point', armB: [-10, 42], handB: 'hold', legF: [17, -7], legB: [-13, -5, 14], face: 'talk',
      props: [{ type: 'ball', at: 'B', dx: 9, dy: -3, layer: 'mid' }] },
    // The bad moment: hand over the eyes, the other on the hip, shoulders down.
    'coach-head-in-hands': { who: 'coach', lean: 6, bend: 16, head: 26, shrug: -2, armF: [62, 122], handF: 'flat', armB: [-30, 64], handB: 'fist', legF: [8, -8], legB: [-4, -2], face: 'pained' },
    // Timeout: down on one knee at the athletes' eye level, board on the thigh.
    'coach-kneeling': { who: 'coach', lean: 12, bend: 6, head: -6, kneel: true, armF: [34, 20], handF: 'point', armB: [42, 22], handB: 'hold', gripB: true, legF: [92, -94], legB: [-5, -95, 80], face: 'talk', wide: 58, shadowX: 6,
      props: [{ type: 'clipboard', at: 'B', rot: -64, dx: 2, dy: -7, layer: 'mid' }] },
    'coach-thumbs-up': { who: 'coach', lean: -1, bend: 1, head: -4, armF: [30, 96], handF: 'thumb', armB: [-9, 14], legF: [10, -9], legB: [-3, -2], face: 'grin' },
    // Mid-stride along the sideline, glancing at the phone.
    'coach-walking': { who: 'coach', lean: 5, bend: 2, head: 9, twist: -5, armF: [-20, 24], handF: 'relaxed', armB: [32, 74], handB: 'hold', gripB: true, legF: [25, -7, -14], legB: [-21, -24, 32], face: 'neutral', wide: 46,
      props: [{ type: 'phone', at: 'B', rot: 24, dx: 6, dy: -9, layer: 'mid' }] },
    // Listening back: phone to the ear, other arm folded under.
    'coach-phone-ear': { who: 'coach', lean: 1, bend: 3, head: 6, armF: [60, 163], handF: 'hold', armB: [-4, 88], handB: 'relaxed', legF: [10, -8], legB: [-4, -1], face: 'listen',
      props: [{ type: 'phone', at: 'head', rot: 14, dx: -2, dy: 5, scale: 0.74, layer: 'front' }] },
    // Writing: board cradled on the forearm, pen hand working, eyes down.
    'coach-clipboard': { who: 'coach', lean: 3, bend: 7, head: 17, armF: [22, 82], handF: 'hold', armB: [6, 92], handB: 'hold', legF: [9, -8], legB: [-3, -2], face: 'focus',
      props: [{ type: 'clipboard', at: 'B', rot: -22, dx: 6, dy: -10, layer: 'mid' }, { type: 'pen', at: 'F', rot: 28, dx: 4, dy: -3, layer: 'front' }] },

    // ── athlete A: outside hitter ───────────────────────────────────────
    // Listening the way players do: hands on hips, weight on one leg, chin up.
    'athlete-listening': { who: 'athleteA', lean: 0, bend: 2, head: -3, armF: [-30, 64], handF: 'fist', armB: [-34, 66], handB: 'fist', legF: [12, -13], legB: [-2, -2], face: 'neutral' },
    'athlete-nodding': { who: 'athleteA', lean: 2, bend: 2, head: 2, armF: [5, 10], armB: [-12, 50], handB: 'hold', legF: [10, -10], legB: [-3, -2], face: 'smile', fx: 'nod',
      props: [{ type: 'ball', at: 'B', dx: 9, dy: -2, layer: 'mid' }] },
    // Not following: shoulders up, both palms turned up, head back a touch.
    'athlete-confused': { who: 'athleteA', lean: -2, bend: 1, head: -8, shrug: 5, armF: [10, 86], handF: 'flat', armB: [20, 78], handB: 'flat', legF: [11, -12], legB: [-3, -2], face: 'puzzled', fx: 'question' },
    // The swing, cocked: the whole body a bow, head right back on the ball,
    // hitting elbow high above the shoulder with the hand laid back behind
    // the head, the other arm already pulling in to the chest.
    'athlete-spiking': { who: 'athleteA', lean: -10, bend: -22, head: -16, twist: 8, lift: 62, pony: 70, armF: [184, 78], handF: 'flat', armB: [38, 98], handB: 'relaxed', legF: [-22, -34, 106], legB: [4, -80, 124], face: 'shout',
      props: [{ type: 'ball', at: 'chest', dx: 34, dy: -74, layer: 'front' }] },
    // The pass: shoulders over knees, knees over toes, arms long and locked,
    // the ball met on the forearms.
    'athlete-receiving': { who: 'athleteA', lean: 34, bend: 8, head: -30, twist: 1, armF: [50, 2], handF: 'fist', armB: [54, 2], handB: 'fist', legF: [50, -62], legB: [34, -70, 10], face: 'focus', wide: 46, shadowX: 14,
      props: [{ type: 'ball', at: 'F', dx: -11, dy: -17, layer: 'front', bob: 26 }] },
    'athlete-reading-phone': { who: 'athleteA', lean: 2, bend: 7, head: 19, armF: [14, 100], handF: 'hold', armB: [18, 96], handB: 'hold', legF: [11, -11], legB: [-3, -2], face: 'smile',
      props: [{ type: 'phone', at: 'F', rot: 20, dx: 5, dy: -9, layer: 'front' }] },
    'athlete-thumbs-up': { who: 'athleteA', lean: 0, bend: 1, head: -5, armF: [30, 98], handF: 'thumb', armB: [-12, 50], handB: 'hold', legF: [10, -10], legB: [-3, -2], face: 'grin',
      props: [{ type: 'ball', at: 'B', dx: 9, dy: -2, layer: 'mid' }] },
    // On the bench between sets: forearms on thighs, bottle hanging, eyes up.
    'athlete-sitting': { who: 'athleteA', lean: 36, bend: 10, head: -20, bench: true, armF: [8, 78], handF: 'hold', armB: [12, 74], handB: 'relaxed', legF: [88, -86], legB: [84, -80], face: 'neutral', wide: 52, shadowX: 22,
      props: [{ type: 'bottle', at: 'F', rot: 6, dx: 4, dy: 9, layer: 'front' }] },

    // ── athlete B: middle blocker ───────────────────────────────────────
    'athlete-b-beside': { who: 'athleteB', lean: 1, bend: 2, head: -2, armF: [10, 72], handF: 'hold', armB: [14, 68], handB: 'hold', legF: [9, -8], legB: [-4, -2], face: 'smile',
      props: [{ type: 'ball', at: 'F', dx: 7, dy: -1, layer: 'mid' }] },
    // Hands in: leaning to the middle of the huddle.
    'athlete-b-group': { who: 'athleteB', lean: 15, bend: 4, head: -8, twist: 5, armF: [74, 8], handF: 'flat', armB: [-12, 22], legF: [17, -10], legB: [-9, -4, 10], face: 'grin' },
    // Leaving the floor: both arms driving up, legs long, toes last.
    'athlete-b-jumping': { who: 'athleteB', lean: -3, bend: -7, head: -13, lift: 44, armF: [166, -12], handF: 'flat', armB: [150, -22], handB: 'flat', legF: [5, -22, 104], legB: [-12, -46, 116], face: 'focus' },
    // The block at its top: arms long over the tape, fingers wide, shoulders
    // to the ears, a slight pike so the hands get across.
    'athlete-b-blocking': { who: 'athleteB', lean: 4, bend: -2, head: -12, shrug: 6, lift: 40, armF: [168, -5], handF: 'open', armB: [158, -6], handB: 'open', legF: [6, -9, 84], legB: [0, -12, 90], face: 'focus', net: [20, -30] },
    'athlete-b-reading-phone': { who: 'athleteB', lean: 1, bend: 6, head: 17, armF: [14, 100], handF: 'hold', armB: [-30, 64], handB: 'fist', legF: [12, -13], legB: [-2, -2], face: 'neutral',
      props: [{ type: 'phone', at: 'F', rot: 20, dx: 5, dy: -9, layer: 'front' }] },
    // The point is won: one fist up by the head, the other pulled in, a shout.
    'athlete-b-celebrating': { who: 'athleteB', lean: -6, bend: -6, head: -13, twist: 6, armF: [118, 96], handF: 'fist', armB: [-30, 110], handB: 'fist', legF: [20, -28], legB: [-16, -4], face: 'shout', fx: 'cheer', wide: 46 },

    // ── athlete C: libero and setter, in the off-colour jersey ──────────
    // The set: hands above the forehead, elbows out, knees soft, eyes up.
    'athlete-c-setting': { who: 'athleteC', lean: -2, bend: -7, head: -22, armF: [112, 92], handF: 'open', armB: [104, 96], handB: 'open', legF: [20, -34], legB: [-4, -22, 10], face: 'focus',
      props: [{ type: 'ball', at: 'F', dx: 1, dy: -21, layer: 'front' }] },
    // The dig: a long low lunge, platform out in front of the lead knee.
    'athlete-c-digging': { who: 'athleteC', lean: 52, bend: 8, head: -40, armF: [44, 3], handF: 'fist', armB: [48, 3], handB: 'fist', legF: [84, -98], legB: [-38, -56, 74], face: 'focus', wide: 70, shadowX: 4,
      props: [{ type: 'ball', at: 'F', dx: -8, dy: -17, layer: 'front' }] },
    // The float serve: toss arm long in front, hitting hand open by the ear.
    'athlete-c-serving': { who: 'athleteC', lean: -2, bend: -5, head: -11, twist: 6, armF: [216, -96], handF: 'flat', armB: [102, 4], handB: 'flat', legF: [16, -8], legB: [-12, -10, 20], face: 'focus',
      props: [{ type: 'ball', at: 'B', dx: 5, dy: -24, layer: 'front' }] },
    // Waiting for the serve: low, weight forward, hands loose in front.
    'athlete-c-ready': { who: 'athleteC', lean: 30, bend: 6, head: -25, armF: [30, 50], handF: 'flat', armB: [36, 46], handB: 'flat', legF: [44, -58], legB: [30, -60, 8], face: 'focus', wide: 46, shadowX: 10 },
    'athlete-c-high-five': { who: 'athleteC', lean: 4, bend: 0, head: -8, twist: 5, armF: [152, 10], handF: 'flat', armB: [-10, 16], legF: [14, -8], legB: [-8, -6, 16], face: 'grin' },
    // Filming a rep to send the coach.
    'athlete-c-filming': { who: 'athleteC', lean: 1, bend: 3, head: 1, armF: [70, 60], handF: 'hold', armB: [66, 62], handB: 'hold', legF: [12, -9], legB: [-6, -3], face: 'focus',
      props: [{ type: 'phone', at: 'F', rot: 90, dx: 4, dy: -7, scale: 1.05, layer: 'front' }] },

    // ── the parent ──────────────────────────────────────────────────────
    'parent-reading-phone': { who: 'parent', lean: 2, bend: 6, head: 17, armF: [14, 100], handF: 'hold', armB: [-6, 12], legF: [9, -8], legB: [-3, -2], face: 'smile',
      props: [{ type: 'phone', at: 'F', rot: 20, dx: 5, dy: -9, layer: 'front' }] },
    // At the side of the court with a coffee, arm folded under.
    'parent-watching': { who: 'parent', lean: -1, bend: 3, head: 1, armF: [12, 104], handF: 'hold', armB: [-4, 88], handB: 'relaxed', legF: [9, -8], legB: [-3, -2], face: 'smile',
      props: [{ type: 'cup', at: 'F', rot: 4, dx: 5, dy: -6, layer: 'front' }] },
    'parent-talking': { who: 'parent', lean: 4, bend: 2, head: -2, armF: [36, 62], handF: 'flat', armB: [-6, 14], legF: [11, -9], legB: [-4, -2], face: 'talk' },
    // Good news on the phone: hand to the chest.
    'parent-relieved': { who: 'parent', lean: 0, bend: 3, head: 9, armF: [24, 96], handF: 'hold', armB: [16, 126], handB: 'flat', legF: [9, -8], legB: [-3, -2], face: 'grin',
      props: [{ type: 'phone', at: 'F', rot: 18, dx: 5, dy: -9, layer: 'front' }] },
    // Something is off and nobody has said what: hand to the cheek, arm folded under.
    'parent-worried': { who: 'parent', lean: 3, bend: 7, head: 9, armF: [32, 142], handF: 'relaxed', armB: [-4, 90], handB: 'relaxed', legF: [9, -8], legB: [-3, -2], face: 'worried' },
    'parent-waving': { who: 'parent', lean: 2, bend: 0, head: -5, armF: [150, 26], handF: 'open', armB: [-6, 12], legF: [10, -9], legB: [-4, -2], face: 'grin' },

    // ── the assistant coach ─────────────────────────────────────────────
    // Keeping the stats: board hugged in, pen ready.
    'assistant-clipboard': { who: 'assistant', lean: 2, bend: 5, head: 12, armF: [22, 82], handF: 'hold', armB: [6, 92], handB: 'hold', legF: [9, -8], legB: [-3, -2], face: 'focus',
      props: [{ type: 'clipboard', at: 'B', rot: -22, dx: 6, dy: -10, layer: 'mid' }, { type: 'pen', at: 'F', rot: 28, dx: 4, dy: -3, layer: 'front' }] },
    'assistant-watching': { who: 'assistant', lean: 5, bend: 3, head: -1, armF: [-30, 64], handF: 'fist', armB: [-34, 66], handB: 'fist', legF: [12, -9], legB: [-8, -4], face: 'focus' },
    'assistant-reading-phone': { who: 'assistant', lean: 2, bend: 6, head: 17, armF: [14, 100], handF: 'hold', armB: [-6, 12], legF: [9, -8], legB: [-3, -2], face: 'neutral',
      props: [{ type: 'phone', at: 'F', rot: 20, dx: 5, dy: -9, layer: 'front' }] },
    // Feeding a drill: ball up at the shoulder, about to toss it in.
    'assistant-feeding': { who: 'assistant', lean: 6, bend: 1, head: -4, twist: 5, armF: [70, 84], handF: 'flat', armB: [20, 40], handB: 'hold', legF: [16, -8], legB: [-12, -6, 14], face: 'talk',
      props: [{ type: 'ball', at: 'F', dx: 3, dy: -15, layer: 'front' }, { type: 'ball', at: 'B', dx: 8, dy: 2, layer: 'mid' }] },
  }
  window.POSES = POSES
})()
