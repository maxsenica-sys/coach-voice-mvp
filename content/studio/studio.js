// studio.js: the five slide templates, the six UI cards and the reel timeline.
// Every frame is a pure function of (row, kind, time), so a renderer can step
// through time and capture each frame exactly.

(function () {
  const C = window.PAL
  const FONT = "'Pindar Sans', 'Plus Jakarta Sans', system-ui, sans-serif"
  const HOOK = 92   // the only two type sizes
  const BODY = 48
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x))
  const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3)
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const textOn = (bg) => (bg === C.moss || bg === C.ink ? C.cream : C.ink)
  function pickBg(prefs, who) {
    const top = who ? window.COSTUME[who].top : null
    return prefs.find((c) => c !== top) || prefs[0]
  }
  const whoOf = (pose) => (window.POSES[pose] || {}).who

  // Words appear one by one across [t0, t0+dur].
  function typed(text, t, t0 = 0, dur = 0.7) {
    const words = String(text).split(' ')
    if (t === Infinity) return esc(text)
    const n = Math.ceil(words.length * clamp((t - t0) / dur))
    return words.map((w, i) => `<span style="opacity:${i < n ? 1 : 0}">${esc(w)}</span>`).join(' ')
  }

  // ── the mark ──────────────────────────────────────────────────────────
  function laurel(size, color, grow = 1) {
    const L = window.LAUREL
    const n = L.leaves.length
    const leaves = L.leaves.map(([cx, cy, rx, ry, deg], i) => {
      // leaves arrive bottom to top, left and right together
      const k = clamp(grow * (n / 2 + 1) - (i % (n / 2)))
      return k <= 0 ? '' : `<ellipse cx="${cx}" cy="${cy}" rx="${rx * k}" ry="${ry * k}" transform="rotate(${deg} ${cx} ${cy})" fill="${color}"/>`
    }).join('')
    const stems = L.stems.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${L.stemWidth}" stroke-linecap="round" opacity="${clamp(grow * 3)}"/>`).join('')
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 48">${stems}${leaves}</svg>`
  }
  function lockup(bg, x = 64, y = null, H = 1350) {
    const col = textOn(bg)
    return `<div style="position:absolute;left:${x}px;top:${(y ?? H - 120)}px;display:flex;align-items:center;gap:14px;color:${col};font:700 ${BODY}px/1 ${FONT};letter-spacing:-0.01em">${laurel(64, col)}<span>Pindar</span></div>`
  }

  // ── UI cards, drawn into a phone screen of w×h, animated by p (0..1) ──
  function card(name, w, h, p, ctx = {}) {
    const ink = C.ink, cream = C.cream, sage = C.sage, moss = C.moss
    let s = `<rect width="${w}" height="${h}" fill="${cream}"/>`
    const pad = w * 0.08
    const line = (y, len, op = 1, col = ink, hh = 16) => `<rect x="${pad}" y="${y}" width="${len}" height="${hh}" rx="${hh / 2}" fill="${col}" opacity="${op}"/>`
    const label = (x, y, txt, size = 30, weight = 700, col = ink, anchor = 'start') => `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${col}" text-anchor="${anchor}">${esc(txt)}</text>`
    const v = VARIANT[ctx.feature]
    if (v && v.card === name) return s + v.draw({ w, h, p, pad, line, label, ink, cream, sage, moss, ctx })
    if (name === 'ui-recording') {
      const secs = Math.floor(8 + p * 33)
      s += label(pad, 92, 'Recording', 34)
      s += `<circle cx="${w - pad - 14}" cy="80" r="${12 + 3 * Math.sin(p * 40)}" fill="${moss}"/>`
      s += label(w / 2, 250, `0:${String(secs).padStart(2, '0')}`, 96, 800, ink, 'middle')
      const bars = 13
      for (let i = 0; i < bars; i++) {
        const amp = 0.25 + 0.75 * Math.abs(Math.sin(p * 18 + i * 1.7) * Math.cos(i * 0.9 + p * 7))
        const bh = 30 + amp * 170, bw = (w - pad * 2) / bars * 0.55
        s += `<rect x="${pad + i * (w - pad * 2) / bars}" y="${470 - bh / 2}" width="${bw}" height="${bh}" rx="${bw / 2}" fill="${i % 3 === 0 ? moss : sage}"/>`
      }
      s += `<rect x="${pad}" y="${h - 190}" width="${w - pad * 2}" height="92" rx="46" fill="${ink}"/>`
      s += label(w / 2, h - 132, 'Stop and transcribe', 30, 700, cream, 'middle')
    } else if (name === 'ui-transcript') {
      // waveform → typed lines → five bullets and one takeaway
      const phase = p < 0.45 ? 0 : 1
      if (phase === 0) {
        s += label(pad, 92, 'Transcript', 34)
        const k = clamp(p / 0.45)
        for (let i = 0; i < 9; i++) {
          const show = clamp(k * 10 - i)
          s += line(150 + i * 50, (w - pad * 2) * (0.55 + 0.4 * ((i * 37) % 10) / 10) * show, 0.85)
        }
      } else {
        const k = clamp((p - 0.45) / 0.4)
        s += label(pad, 92, 'Summary', 34)
        const gap = Math.min(70, (h - 400) / 5)
        for (let i = 0; i < 5; i++) {
          const show = clamp(k * 6 - i)
          s += `<circle cx="${pad + 9}" cy="${158 + i * gap}" r="${8 * show}" fill="${moss}"/>`
          s += line(150 + i * gap, (w - pad * 2 - 40) * (0.6 + 0.35 * ((i * 53) % 10) / 10) * show, 0.85, ink, 16)
            .replace(`x="${pad}"`, `x="${pad + 32}"`)
        }
        const tk = clamp((p - 0.82) / 0.15)
        s += `<rect x="${pad}" y="${h - 220}" width="${(w - pad * 2)}" height="150" rx="22" fill="${sage}" opacity="${tk}"/>`
        s += label(pad + 24, h - 174, 'Take into next session', 24, 700, ink).replace('<text', `<text opacity="${tk}"`)
        s += line(h - 146, (w - pad * 2 - 48) * tk, tk, ink, 14).replace(`x="${pad}"`, `x="${pad + 24}"`)
        s += line(h - 118, (w - pad * 2 - 140) * tk, tk, ink, 14).replace(`x="${pad}"`, `x="${pad + 24}"`)
      }
    } else if (name === 'ui-athlete-list') {
      s += label(pad, 92, 'Least attention', 34)
      const rows = [['Ana P.', 0], ['Leo M.', 1], ['Jai T.', 2], ['Sophie G.', 4], ['Mia R.', 5]]
      const rh = Math.min(118, (h - 280) / 5)
      rows.forEach(([nm, n], i) => {
        const y = 150 + i * rh
        const hi = i === 0 ? clamp(p * 3 - 1) : 0
        s += `<rect x="${pad}" y="${y}" width="${w - pad * 2}" height="${rh - 18}" rx="20" fill="${i === 0 ? (hi > 0.5 ? sage : '#e9dfc6') : '#efe5cd'}"/>`
        s += `<circle cx="${pad + 44}" cy="${y + (rh - 18) / 2}" r="26" fill="${i === 0 && hi < 0.5 ? '#b9b4a4' : moss}"/>`
        s += label(pad + 44, y + (rh - 18) / 2 + 8, nm.split(' ').map((x) => x[0]).join(''), 22, 800, cream, 'middle')
        s += label(pad + 84, y + (rh - 18) / 2 + 10, nm, 28, 700)
        s += label(w - pad - 20, y + (rh - 18) / 2 + 11, `${n}`, 32, 800, ink, 'end')
      })
      s += label(w / 2, h - 60, 'sessions in the last 30 days', 22, 600, ink, 'middle')
    } else if (name === 'ui-calendar-week') {
      s += label(pad, 92, 'November', 34)
      const cols = 7, cw = (w - pad * 2) / cols
      'MTWTFSS'.split('').forEach((d, i) => { s += label(pad + i * cw + cw / 2, 150, d, 24, 700, ink, 'middle') })
      const fills = [[0, 1, 'MR'], [1, 3, 'JT'], [2, 0, 'SG'], [2, 4, 'AP'], [3, 2, 'MR'], [3, 5, 'LM'], [4, 1, 'SG'], [4, 6, 'JT'], [5, 3, 'MR']]
      for (let r = 0; r < 6; r++) for (let c = 0; c < cols; c++) {
        const y = 180 + r * 108
        s += `<rect x="${pad + c * cw + 4}" y="${y}" width="${cw - 8}" height="98" rx="12" fill="#efe5cd"/>`
        s += label(pad + c * cw + 14, y + 30, String(r * 7 + c + 1).slice(-2), 20, 600, ink)
      }
      fills.forEach(([r, c, ini], i) => {
        const k = easeOut(clamp(p * (fills.length + 2) - i))
        if (k <= 0) return
        const cx = pad + c * cw + cw / 2, cy = 180 + r * 108 + 66
        s += `<circle cx="${cx}" cy="${cy - (1 - k) * 60}" r="${22 * k}" fill="${moss}"/>`
        s += label(cx, cy - (1 - k) * 60 + 7, ini, 18, 800, cream, 'middle').replace('<text', `<text opacity="${k}"`)
      })
    } else if (name === 'ui-video-thumb') {
      const vh = h * 0.55
      s += `<rect x="0" y="80" width="${w}" height="${vh}" fill="${moss}"/>`
      s += `<rect x="0" y="${80 + vh * 0.62}" width="${w}" height="${vh * 0.38}" fill="${sage}"/>`
      s += `<rect x="${w * 0.08}" y="${80 + vh * 0.42}" width="${w * 0.84}" height="10" fill="${cream}"/>`
      s += `<g transform="translate(${w * 0.46} ${80 + vh * 0.92}) scale(1.35)">${window.drawCharacter(window.POSES['athlete-spiking'], { t: 0 })}</g>`
      // the stroke drawn on the frame, then fading as the clip resumes
      const draw = clamp(p / 0.45), fade = p > 0.7 ? 1 - clamp((p - 0.7) / 0.25) : 1
      const len = 520
      s += `<path d="M${w * 0.2},${80 + vh * 0.3} Q${w * 0.45},${80 + vh * 0.02} ${w * 0.62},${80 + vh * 0.2}" fill="none" stroke="${cream}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - draw)}" opacity="${fade}"/>`
      s += `<circle cx="${w * 0.62}" cy="${80 + vh * 0.2}" r="${26 * draw}" fill="none" stroke="${cream}" stroke-width="8" opacity="${fade}"/>`
      const play = p > 0.62
      s += `<rect x="${pad}" y="${80 + vh + 40}" width="${w - pad * 2}" height="12" rx="6" fill="#d8ceb4"/>`
      s += `<rect x="${pad}" y="${80 + vh + 40}" width="${(w - pad * 2) * (0.38 + (play ? (p - 0.62) * 0.8 : 0))}" height="12" rx="6" fill="${moss}"/>`
      s += label(pad, 80 + vh + 120, play ? 'Playing' : 'Paused · drawing', 30, 700)
      s += label(pad, 80 + vh + 170, 'Fades after 2s', 24, 600, ink)
    } else if (name === 'ui-understood-tick') {
      s += label(pad, 92, 'Take into next session', 28)
      s += `<rect x="${pad}" y="120" width="${w - pad * 2}" height="190" rx="24" fill="${sage}"/>`
      s += `<foreignObject x="${pad + 24}" y="140" width="${w - pad * 2 - 48}" height="160"><div xmlns="http://www.w3.org/1999/xhtml" style="font:700 30px/1.25 ${FONT};color:${ink}">${esc(ctx.takeaway || 'Load the hip before you swing.')}</div></foreignObject>`
      const chips = ['Got it', 'Working on it', 'Not sure what you mean']
      const choice = ctx.choice ?? 2
      const tap = clamp((p - 0.35) / 0.12)
      const cy0 = 340, cgap = Math.min(116, (h - 500) / 3)
      chips.forEach((c, i) => {
        const y = cy0 + i * cgap
        const on = i === choice && tap > 0.5
        s += `<rect x="${pad}" y="${y}" width="${w - pad * 2}" height="${cgap - 18}" rx="${(cgap - 18) / 2}" fill="${on ? ink : cream}" stroke="${ink}" stroke-width="4"/>`
        s += label(w / 2, y + (cgap - 18) / 2 + 9, c, 24, 700, on ? cream : ink, 'middle')
      })
      // the thumb arrives, taps, leaves
      const fy = cy0 + choice * cgap + 50
      const thumbIn = clamp(p / 0.3), thumbOut = clamp((p - 0.55) / 0.2)
      const fx = w * 0.72 + (1 - easeOut(thumbIn)) * 260 + easeOut(thumbOut) * 300
      const press = tap > 0 && tap < 1 ? 0.92 : 1
      s += `<g transform="translate(${fx} ${fy + (1 - easeOut(thumbIn)) * 200}) scale(${press})"><ellipse cx="0" cy="0" rx="38" ry="50" fill="${cream}" stroke="${ink}" stroke-width="5"/><ellipse cx="0" cy="-22" rx="20" ry="14" fill="none" stroke="${ink}" stroke-width="3" opacity="0.5"/></g>`
      const sent = clamp((p - 0.75) / 0.15)
      s += `<g opacity="${sent}"><circle cx="${pad + 26}" cy="${h - 80}" r="24" fill="${moss}"/><path d="M${pad + 14},${h - 80} l9,9 l16,-18" fill="none" stroke="${cream}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>${label(pad + 64, h - 71, 'Sent to your coach', 24, 700)}</g>`
    }
    return s
  }


  // ── feature-specific screens inside the six cards ─────────────────────
  // The library has six cards; what each shows depends on the feature, so a
  // card never shows a screen that belongs to a different feature.
  function bodyMap(x, y, sc, hit, ink, cream, moss, sage, k = 1) {
    const r = (cx, cy, rx, ry, on) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${on ? moss : cream}" stroke="${ink}" stroke-width="3"/>`
    let s = `<g transform="translate(${x} ${y}) scale(${sc})">`
    s += r(0, -150, 22, 24, false) + r(0, -88, 40, 48, false) + r(0, -30, 34, 20, false)
    s += r(-56, -96, 13, 40, false) + r(56, -96, 13, 40, false) + r(-62, -40, 11, 30, false) + r(62, -40, 11, 30, false)
    s += r(-18, 30, 16, 46, hit === 'thigh') + r(18, 30, 16, 46, false) + r(-18, 102, 13, 40, hit === 'knee' && k > 0.5) + r(18, 102, 13, 40, false)
    s += r(-46, -118, 16, 14, hit === 'shoulder' && k > 0.5)
    return s + `</g>`
  }
  const chipRow = (o, y, opts, chosen, k) => opts.map((t, i) => {
    const cw = (o.w - o.pad * 2 - 20) / opts.length
    const x = o.pad + i * (cw + 10)
    const on = i === chosen && k > 0.5
    return `<rect x="${x}" y="${y}" width="${cw}" height="74" rx="37" fill="${on ? o.ink : o.cream}" stroke="${o.ink}" stroke-width="4"/>` + o.label(x + cw / 2, y + 47, t, opts.length >= 3 ? 22 : 26, 700, on ? o.cream : o.ink, 'middle')
  }).join('')
  const tick = (o, x, y, on) => `<rect x="${x}" y="${y}" width="44" height="44" rx="10" fill="${on ? o.moss : o.cream}" stroke="${o.ink}" stroke-width="4"/>` + (on ? `<path d="M${x + 10},${y + 23} l8,8 l16,-17" fill="none" stroke="${o.cream}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : '')
  const VARIANT = {}
  const wellness = (o) => {
    let s = o.label(o.pad, 92, 'Wellness', 34)
    const rows = [['Mia R.', 'Flat', 'Sore: left knee'], ['Jai T.', 'Good', ''], ['Sophie G.', 'OK', ''], ['Ana P.', 'Good', '']]
    const rh = Math.min(116, (o.h - 340) / 4)
    rows.forEach(([nm, st, why], i) => {
      const y = 140 + i * rh
      s += `<rect x="${o.pad}" y="${y}" width="${o.w - o.pad * 2}" height="${rh - 14}" rx="20" fill="${i === 0 ? '#e9dfc6' : '#efe5cd'}"/>`
      s += `<circle cx="${o.pad + 34}" cy="${y + (rh - 14) / 2}" r="14" fill="${st === 'Flat' ? o.ink : st === 'OK' ? o.sage : o.moss}"/>`
      s += o.label(o.pad + 62, y + (why ? 40 : (rh - 14) / 2 + 10), nm, 28, 700) + o.label(o.w - o.pad - 18, y + (rh - 14) / 2 + 10, st, 26, 700, o.ink, 'end')
      if (why) s += o.label(o.pad + 62, y + 76, why, 22, 600)
    })
    if (o.ctx.feature === 'wellness-alert-notify-parent') {
      const sent = o.p > 0.6
      s += `<rect x="${o.pad}" y="${o.h - 170}" width="${o.w - o.pad * 2}" height="84" rx="42" fill="${sent ? o.moss : o.ink}"/>`
      s += o.label(o.w / 2, o.h - 118, sent ? 'Sent to Mia’s mum' : 'Email update to parent', 26, 700, o.cream, 'middle')
    }
    return s
  }
  VARIANT['wellness-alert-notify-parent'] = { card: 'ui-athlete-list', draw: wellness }
  VARIANT['roster-wellness-driver'] = { card: 'ui-athlete-list', draw: wellness }
  VARIANT['pre-session-brief'] = { card: 'ui-athlete-list', draw: (o) => {
    let s = o.label(o.pad, 92, 'Training in 20 min', 32)
    const rows = [['Leo M.', 'Not checked in', ''], ['Mia R.', 'Flat', 'Sore: left knee'], ['Jai T.', 'Good', 'Last time: Not sure'], ['Ana P.', 'OK', 'Last time: Got it']]
    const rh = Math.min(120, (o.h - 200) / 4)
    rows.forEach(([nm, st, why], i) => {
      const y = 140 + i * rh, k = clamp(o.p * 6 - i)
      s += `<g opacity="${k}"><rect x="${o.pad}" y="${y}" width="${o.w - o.pad * 2}" height="${rh - 14}" rx="20" fill="#efe5cd"/>`
      s += o.label(o.pad + 22, y + 40, nm, 28, 700) + o.label(o.w - o.pad - 18, y + 40, st, 24, 700, o.ink, 'end')
      if (why) s += o.label(o.pad + 22, y + 78, why, 22, 600)
      s += `</g>`
    })
    return s } }
  const checkin = (o) => {
    let s = o.label(o.pad, 92, 'How are you today', 32)
    s += chipRow(o, 130, ['Flat', 'OK', 'Good'], 1, clamp(o.p * 4))
    const sore = o.p > 0.35
    // two answers that need the full width, stacked
    s += chipRow(o, 222, ['Nothing sore'], sore ? -1 : 0, 1) + chipRow(o, 306, ['Something’s sore'], sore ? 0 : -1, 1)
    const sc = Math.max(0.55, Math.min(1.0, (o.h - 440) / 330))
    if (sore) s += bodyMap(o.w / 2, 400 + 174 * sc, sc, 'knee', o.ink, o.cream, o.moss, o.sage, clamp((o.p - 0.5) / 0.1))
    return s }
  VARIANT['two-tap-checkin'] = { card: 'ui-athlete-list', draw: checkin }
  VARIANT['body-map-soreness'] = { card: 'ui-athlete-list', draw: checkin }
  VARIANT['injury-body-map'] = { card: 'ui-athlete-list', draw: (o) => {
    let s = o.label(o.pad, 92, 'Mia R. · Injury', 32)
    s += bodyMap(o.w / 2, o.h * 0.44, Math.min(1.1, o.h / 800), 'shoulder', o.ink, o.cream, o.moss, o.sage, clamp(o.p * 3))
    s += chipRow(o, o.h - 170, ['Out', 'Modified', 'Cleared'], 1, clamp((o.p - 0.4) * 4))
    return s } }
  VARIANT['assistant-coach-invites'] = { card: 'ui-athlete-list', draw: (o) => {
    let s = o.label(o.pad, 92, 'Coach Jess can see', 30)
    const names = ['Mia R.', 'Jai T.', 'Sophie G.', 'Ana P.', 'Leo M.']
    const rh = Math.min(104, (o.h - 220) / 5)
    names.forEach((nm, i) => {
      const y = 140 + i * rh
      const on = [0, 2, 3].includes(i) && o.p * 5 > i
      s += tick(o, o.pad, y, on) + o.label(o.pad + 66, y + 32, nm, 28, 700)
    })
    s += o.label(o.pad, o.h - 70, 'Invite link: single use, 7 days', 22, 600)
    return s } }
  VARIANT['coach-invite-code-qr'] = { card: 'ui-athlete-list', draw: (o) => {
    let s = o.label(o.w / 2, 92, 'Join my team', 32, 700, o.ink, 'middle')
    const q = Math.min(o.w - o.pad * 2, o.h * 0.48), x0 = (o.w - q) / 2, y0 = 130, n = 21, c = q / n
    let seed = 7
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
    const finder = (fx, fy) => `<rect x="${x0 + fx * c}" y="${y0 + fy * c}" width="${7 * c}" height="${7 * c}" fill="${o.ink}"/><rect x="${x0 + (fx + 1) * c}" y="${y0 + (fy + 1) * c}" width="${5 * c}" height="${5 * c}" fill="${o.cream}"/><rect x="${x0 + (fx + 2) * c}" y="${y0 + (fy + 2) * c}" width="${3 * c}" height="${3 * c}" fill="${o.ink}"/>`
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const inF = (i < 8 && j < 8) || (i > n - 9 && j < 8) || (i < 8 && j > n - 9)
      if (!inF && rnd() > 0.52) s += `<rect x="${x0 + i * c}" y="${y0 + j * c}" width="${c}" height="${c}" fill="${o.ink}"/>`
    }
    s += finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7)
    s += o.label(o.w / 2, y0 + q + 70, 'SHARKS24', 44, 800, o.ink, 'middle')
    s += o.label(o.w / 2, y0 + q + 116, 'Scan to sign up, code filled in', 22, 600, o.ink, 'middle')
    return s } }
  VARIANT['safeguarding-rls-gate'] = { card: 'ui-athlete-list', draw: (o) => {
    let s = o.label(o.pad, 92, 'What Mia can see', 30)
    const rows = [['Her sessions', true], ['Her check-ins', true], ['Teammates’ sessions', false], ['Other coaches’ athletes', false]]
    const rh = Math.min(110, (o.h - 220) / 4)
    rows.forEach(([t, ok], i) => {
      const y = 140 + i * rh
      s += `<rect x="${o.pad}" y="${y}" width="${o.w - o.pad * 2}" height="${rh - 16}" rx="20" fill="${ok ? '#efe5cd' : o.ink}"/>`
      s += o.label(o.pad + 22, y + (rh - 16) / 2 + 9, t, 24, 700, ok ? o.ink : o.cream)
      s += o.label(o.w - o.pad - 20, y + (rh - 16) / 2 + 9, ok ? 'Yes' : 'No', 24, 800, ok ? o.ink : o.sage, 'end')
    })
    return s } }
  VARIANT['insight-recurring-cues'] = { card: 'ui-athlete-list', draw: (o) => {
    let s = o.label(o.pad, 92, 'What you keep saying', 30)
    const rows = [['"load the hip"', 5], ['"eyes on the setter"', 4], ['"finish high"', 3]]
    rows.forEach(([t, n], i) => {
      const y = 150 + i * 120, k = clamp(o.p * 4 - i)
      s += `<g opacity="${k}"><rect x="${o.pad}" y="${y}" width="${o.w - o.pad * 2}" height="100" rx="20" fill="#efe5cd"/>` + o.label(o.pad + 22, y + 60, t, 28, 700) + o.label(o.w - o.pad - 20, y + 60, `${n} weeks`, 22, 700, o.ink, 'end') + `</g>`
    })
    return s } }
  const player = (o) => {
    let s = o.label(o.pad, 92, o.ctx.feature === 'messaging-voice' ? 'Voice note from Coach Sam' : 'Coach Sam · 1:1', 28)
    const bars = 22, y = o.h * 0.42
    for (let i = 0; i < bars; i++) {
      const hgt = 20 + 90 * Math.abs(Math.sin(i * 1.9) * Math.cos(i * 0.7))
      const done = i / bars < o.p
      s += `<rect x="${o.pad + i * (o.w - o.pad * 2) / bars}" y="${y - hgt / 2}" width="${(o.w - o.pad * 2) / bars * 0.6}" height="${hgt}" rx="5" fill="${done ? o.moss : '#d8ceb4'}"/>`
    }
    s += `<circle cx="${o.w / 2}" cy="${o.h * 0.68}" r="64" fill="${o.ink}"/>`
    s += o.p > 0.05 ? `<rect x="${o.w / 2 - 20}" y="${o.h * 0.68 - 26}" width="13" height="52" rx="4" fill="${o.cream}"/><rect x="${o.w / 2 + 7}" y="${o.h * 0.68 - 26}" width="13" height="52" rx="4" fill="${o.cream}"/>` : `<path d="M${o.w / 2 - 18},${o.h * 0.68 - 28} l44,28 l-44,28 z" fill="${o.cream}"/>`
    s += o.label(o.w / 2, o.h * 0.68 + 120, `0:${String(Math.floor(o.p * 42)).padStart(2, '0')} / 0:42`, 26, 700, o.ink, 'middle')
    return s }
  VARIANT['coach-recording-playback'] = { card: 'ui-recording', draw: player }
  VARIANT['messaging-voice'] = { card: 'ui-recording', draw: player }
  VARIANT['training-rhythm'] = { card: 'ui-calendar-week', draw: (o) => {
    let s = o.label(o.pad, 92, 'Your last 12 weeks', 30)
    const vals = [1, 2, 1, 3, 2, 2, 0, 3, 2, 3, 2, 3]
    const bw = (o.w - o.pad * 2) / 12, base = o.h * 0.7
    vals.forEach((v, i) => {
      const k = easeOut(clamp(o.p * 14 - i))
      s += `<rect x="${o.pad + i * bw + 4}" y="${base - v * 90 * k}" width="${bw - 8}" height="${Math.max(6, v * 90 * k)}" rx="6" fill="${i === 11 ? o.moss : o.sage}"/>`
    })
    s += o.label(o.pad, base + 60, 'Sessions a week, this week in green', 22, 600)
    return s } }
  VARIANT['video-compare'] = { card: 'ui-video-thumb', draw: (o) => {
    let s = o.label(o.pad, 70, 'Week 1  ·  Week 8', 28)
    const fw = (o.w - o.pad * 2 - 16) / 2, fh = o.h * 0.5, y = 110
    ;[0, 1].forEach((i) => {
      const x = o.pad + i * (fw + 16)
      const slide = (1 - ease(clamp(o.p * 2))) * (i ? 120 : -120)
      s += `<g transform="translate(${slide} 0)"><rect x="${x}" y="${y}" width="${fw}" height="${fh}" rx="16" fill="${o.moss}"/><rect x="${x}" y="${y + fh * 0.65}" width="${fw}" height="${fh * 0.35}" fill="${o.sage}"/>`
      s += `<g transform="translate(${x + fw / 2} ${y + fh * 0.95}) scale(0.85)">${window.drawCharacter(window.POSES[i ? 'athlete-spiking' : 'athlete-receiving'], { t: o.p * 4 })}</g></g>`
    })
    s += `<rect x="${o.pad}" y="${y + fh + 50}" width="${o.w - o.pad * 2}" height="12" rx="6" fill="#d8ceb4"/><rect x="${o.pad}" y="${y + fh + 50}" width="${(o.w - o.pad * 2) * o.p}" height="12" rx="6" fill="${o.moss}"/>`
    s += o.label(o.pad, y + fh + 120, 'One clock · offset 0.4s · 0.5x', 22, 600)
    return s } }

  // Cards are drawn on a fixed 440-wide screen and scaled into the frame, so
  // their text keeps its proportions at any phone size, like a screenshot.
  const LW = 440
  const screenH = (w, h) => Math.round((LW * h) / w)
  function phone(x, y, w, h, inner) {
    const b = 22, lh = screenH(w, h)
    return `<g transform="translate(${x} ${y})">
      <rect x="-${b}" y="-${b}" width="${w + b * 2}" height="${h + b * 2}" rx="64" fill="${C.ink}"/>
      <svg x="0" y="0" width="${w}" height="${h}" viewBox="0 0 ${LW} ${lh}"><clipPath id="sc${x}${y}"><rect width="${LW}" height="${lh}" rx="${44 * LW / w}"/></clipPath><g clip-path="url(#sc${x}${y})">${inner}</g></svg>
      <rect x="${w / 2 - 70}" y="-6" width="140" height="26" rx="13" fill="${C.ink}"/></g>`
  }

  function figure(pose, x, groundY, scale, t, facing = 1) {
    const p = window.POSES[pose]
    if (!p) return ''
    return `<g transform="translate(${x} ${groundY}) scale(${scale})">${window.drawCharacter(p, { t, facing })}</g>`
  }

  // A pose arriving: interpolate from standing over the first 0.45s.
  function figureIn(pose, x, groundY, scale, t, facing = 1, start = 0) {
    const target = window.POSES[pose]
    if (!target) return ''
    const k = ease((t - start) / 0.45)
    const mixed = window.mixPose({ ...window.STAND, who: target.who }, target, k)
    return `<g transform="translate(${x} ${groundY}) scale(${scale})">${window.drawCharacter(mixed, { t, facing })}</g>`
  }

  // ── templates ─────────────────────────────────────────────────────────
  // Pose columns map to the slides that carry a character, in queue order:
  //   pose_1 title card (hook) · pose_2 old way · pose_3 cost · pose_4 mechanic (holds the phone)
  //   · pose_5 change. The ask is the logo frame and has no character.
  const W = 1080
  // Reels keep clear of Instagram's own overlays: top bar and the bottom caption area.
  const SAFE = (H) => (H > 1500 ? { T: 210, B: 330 } : { T: 0, B: 0 })
  function frame(H, bg, inner) {
    return `<div style="position:relative;width:${W}px;height:${H}px;background:${bg};overflow:hidden;font-family:${FONT}">${inner}</div>`
  }
  const textBox = (x, y, w, size, col, html, extra = '') =>
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;font:${size === HOOK ? 800 : 600} ${size}px/1.08 ${FONT};letter-spacing:${size === HOOK ? '-0.025em' : '-0.01em'};color:${col};${extra}">${html}</div>`

  function slideHook(row, H, t = Infinity) {
    const { T, B } = SAFE(H), HB = H - B
    const bg = pickBg([C.moss, C.sage, C.cream], whoOf(row.pose_1))
    const col = textOn(bg)
    const tt = t === Infinity ? 9 : t
    return frame(H, bg,
      `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${figureIn(row.pose_1, 250, HB - 230, 3.3, tt)}</svg>` +
      textBox(470, T + (HB - T) * 0.24, 560, HOOK, col, typed(row.hook, t, 0.15, 0.8)) + lockup(bg, 64, null, HB))
  }
  function slideProblem(row, text, pose, H, t = Infinity) {
    const { T, B } = SAFE(H), HB = H - B
    const bg = pickBg([C.cream, C.sage], whoOf(pose))
    const col = textOn(bg)
    const tt = t === Infinity ? 9 : t
    return frame(H, bg,
      textBox(64, T + 120, 952, BODY, col, typed(text, t, 0.1, 0.8)) +
      `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${figureIn(pose, W / 2, HB - 200, 3.6, tt)}</svg>` + lockup(bg, 64, null, HB))
  }
  function mechanicScene(row, t, H, p, T = 0) {
    // feature-specific mechanic animations
    const f = row.feature_id
    if (f === 'mode-several-split' || f === 'mode-squad') return splitScene(row, t, H, p)
    if (f === 'understanding-reply') return understoodScene(row, t, H, p, T)
    return ''
  }
  function slideMechanic(row, H, t = Infinity) {
    const { T, B } = SAFE(H), HB = H - B
    const bg = pickBg([C.sage, C.cream], whoOf(row.pose_4))
    const col = textOn(bg)
    const tt = t === Infinity ? 9 : t
    const p = t === Infinity ? 0.92 : clamp((t - 0.3) / 3.2)
    const special = mechanicScene(row, tt, HB, p, T)
    if (special) return frame(H, bg, special + textBox(64, HB - 330, 952, BODY, col, typed(row.mechanic, t, 0.1, 0.8)) + lockup(bg, 64, null, HB))
    const pw = 420, ph = 760
    return frame(H, bg,
      `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${figureIn(row.pose_4, 230, HB - 380, 3.0, tt)}${phone(560, T + 90, pw, ph, card(row.ui_card, LW, screenH(pw, ph), p, { takeaway: row.change, feature: row.feature_id }))}</svg>` +
      textBox(64, HB - 330, 952, BODY, col, typed(row.mechanic, t, 0.1, 0.8)) + lockup(bg, 64, null, HB))
  }
  function slideOutcome(row, H, t = Infinity) {
    const { T, B } = SAFE(H), HB = H - B
    const a = row.pose_5, b = row.pose_4
    const two = whoOf(b) && whoOf(b) !== whoOf(a)
    const bg = pickBg([C.cream, C.sage], whoOf(a))
    const col = textOn(bg)
    const tt = t === Infinity ? 9 : t
    return frame(H, bg,
      textBox(64, T + 120, 952, BODY, col, typed(row.change, t, 0.1, 0.8)) +
      `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${figureIn(a, two ? 360 : W / 2, HB - 200, 3.4, tt)}${two ? figureIn(b, 720, HB - 200, 3.4, tt, -1, 0.2) : ''}</svg>` + lockup(bg, 64, null, HB))
  }
  function slideCta(row, H, t = Infinity) {
    const { T, B } = SAFE(H), HB = H - B
    const bg = C.ink, col = C.cream
    const g = t === Infinity ? 1 : clamp(t / 1.2)
    return frame(H, bg,
      `<div style="position:absolute;left:0;right:0;top:${T + (HB - T) * 0.2}px;display:flex;justify-content:center">${laurel(300, C.sage, g)}</div>` +
      textBox(64, T + (HB - T) * 0.2 + 360, 952, HOOK, col, typed(row.ask, t, 0.5, 0.7), 'text-align:center') +
      textBox(64, T + (HB - T) * 0.2 + 600, 952, BODY, C.sage, 'Link in bio', `text-align:center;opacity:${t === Infinity ? 1 : clamp((t - 1.2) / 0.4)}`) + lockup(bg, 64, null, HB))
  }
  function slideStill(row) {
    const H = 1350, HB = H
    const bg = pickBg([C.sage, C.cream], whoOf(row.pose_4))
    const col = textOn(bg)
    const pw = 360, ph = 650
    return frame(H, bg,
      `<div style="position:absolute;left:64px;top:90px;width:952px;display:flex;flex-direction:column;gap:30px;color:${col}">
         <div style="font:800 ${HOOK}px/1.08 ${FONT};letter-spacing:-0.025em">${esc(row.hook)}</div>
         <div style="font:600 ${BODY}px/1.08 ${FONT};letter-spacing:-0.01em;width:520px">${esc(row.mechanic)}</div></div>` +
      `<svg width="${W}" height="${H}" style="position:absolute;inset:0">${figure(row.pose_4, 250, H - 170, 2.55, 0.6)}${phone(620, 470, pw, ph, card(row.ui_card, LW, screenH(pw, ph), 0.92, { takeaway: row.change, feature: row.feature_id }))}</svg>` +
      lockup(bg, 64, null, HB))
  }

  // One recording, three athletes: a waveform ribbon splits and flies.
  function splitScene(row, t, H, p) {
    let s = `<svg width="${W}" height="${H}" style="position:absolute;inset:0">`
    s += figure('coach-phone-talking', 190, H * 0.62, 2.7, t)
    const ox = 330, oy = H * 0.62 - 470
    const targets = [[620, H * 0.62 - 330, 'athlete-reading-phone'], [800, H * 0.62 - 330, 'athlete-b-reading-phone'], [960, H * 0.62 - 330, 'athlete-listening']]
    const cols = [C.moss, C.ink, C.cream]
    targets.forEach(([tx, ty, pose], i) => {
      s += figure(pose, tx, H * 0.62, 1.9, t + i * 0.3, -1)
      const k = ease(clamp((p - 0.15 - i * 0.08) / 0.5))
      const mx = ox + (tx - 40 - ox) * k, my = oy + (ty - 40 - oy) * k - Math.sin(k * Math.PI) * 140
      for (let j = 0; j < 7; j++) {
        const amp = 18 + 14 * Math.abs(Math.sin(t * 8 + j + i))
        s += `<rect x="${mx + j * 13}" y="${my - amp / 2}" width="8" height="${amp}" rx="4" fill="${cols[i]}" stroke="${C.ink}" stroke-width="${i === 2 ? 2 : 0}"/>`
      }
      if (k >= 1) s += `<circle cx="${tx - 40}" cy="${ty - 120}" r="26" fill="${C.ink}"/><path d="M${tx - 52},${ty - 120} l8,8 l16,-16" fill="none" stroke="${C.cream}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    return s + `</svg>`
  }

  // The nod and the tick: the athlete nods, taps Not sure, the answer travels to the coach.
  function understoodScene(row, t, H, p, T = 0) {
    const pw = 400, ph = 820
    let s = `<svg width="${W}" height="${H}" style="position:absolute;inset:0">`
    s += figure(p < 0.3 ? 'athlete-nodding' : 'athlete-reading-phone', 170, H - 380, 2.6, t)
    s += phone(330, T + 70, pw, ph, card('ui-understood-tick', LW, screenH(pw, ph), clamp(p / 0.8), { takeaway: row.change }))
    const k = ease(clamp((p - 0.62) / 0.3))
    s += figure(k > 0.95 ? 'coach-phone-showing' : 'coach-watching', 960, H - 380, 2.3, t, -1)
    if (k > 0 && k < 1) {
      const x = 330 + pw * 0.5 + (900 - 330 - pw * 0.5) * k, y = T + 560 - Math.sin(k * Math.PI) * 220
      s += `<g transform="translate(${x} ${y})"><rect x="-150" y="-40" width="300" height="80" rx="40" fill="${C.ink}"/><text x="0" y="12" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${C.cream}">Not sure</text></g>`
    }
    if (k >= 1) s += `<g transform="translate(860 ${H - 860})"><rect x="-150" y="-40" width="300" height="80" rx="40" fill="${C.ink}"/><text x="0" y="12" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${C.cream}">Not sure</text></g>`
    return s + `</svg>`
  }

  // ── the reel: five scenes and the wreath sign-off ─────────────────────
  function reelPlan(row) {
    const words = row.voiceover_script.split(/\s+/).length
    const total = clamp(words / 2.6, 12, 20)
    const share = [0.2, 0.17, 0.3, 0.17, 0.16]
    let at = 0
    const scenes = share.map((s) => { const sc = { start: at, dur: total * s }; at += sc.dur; return sc })
    // The wreath sign-off gets its own time after the five beats, so it always finishes.
    return { total: total + SIGN_OFF, body: total, scenes }
  }
  const SIGN_OFF = 2.8
  function signOff(t, H) {
    // voice bars rise and fly into the wreath, then the name and the line
    const bg = C.ink
    let s = `<svg width="${W}" height="${H}" style="position:absolute;inset:0">`
    const cx = W / 2, cy = H * 0.38
    for (let i = 0; i < 9; i++) {
      const k = ease(clamp((t - i * 0.06) / 0.9))
      const sx = cx - 200 + i * 50, sy = H * 0.8
      const ex = cx + Math.cos((i / 8) * Math.PI) * -130, ey = cy + 60 - Math.sin((i / 8) * Math.PI) * 120
      const x = sx + (ex - sx) * k, y = sy + (ey - sy) * k
      const hgt = (60 + 50 * Math.abs(Math.sin(i * 1.3 + t * 6))) * (1 - k)
      if (k < 1) s += `<rect x="${x - 9}" y="${y - hgt / 2}" width="18" height="${Math.max(hgt, 18)}" rx="9" fill="${C.sage}" opacity="${1 - k * 0.6}"/>`
    }
    s += `</svg>`
    const g = clamp((t - 0.7) / 0.9)
    return frame(H, bg, s +
      `<div style="position:absolute;left:0;right:0;top:${cy - 190}px;display:flex;justify-content:center">${laurel(380, C.sage, g)}</div>` +
      textBox(64, cy + 240, 952, HOOK, C.cream, 'Pindar', `text-align:center;opacity:${clamp((t - 1.4) / 0.4)}`) +
      textBox(64, cy + 360, 952, BODY, C.sage, 'Hear it. Own it.', `text-align:center;opacity:${clamp((t - 1.8) / 0.4)}`))
  }
  function reelFrame(row, t) {
    const H = 1920
    const { body, scenes } = reelPlan(row)
    if (t >= body) return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">${signOff(t - body, H)}</div>`
    const i = scenes.findIndex((s) => t < s.start + s.dur)
    const k = i === -1 ? 4 : i
    const local = t - scenes[k].start
    let inner
    if (k === 0) inner = slideHook(row, H, local)
    else if (k === 1) inner = slideProblem(row, row.cost, row.pose_3, H, local)
    else if (k === 2) inner = slideMechanic(row, H, local)
    else if (k === 3) inner = slideOutcome(row, H, local)
    else inner = slideCta(row, H, local)
    // a quick slide-in at each scene change
    const inT = clamp(local / 0.3)
    const shift = (1 - easeOut(inT)) * 80
    return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden">
      <div style="transform:translateX(${shift}px);opacity:${0.4 + 0.6 * inT}">${inner}</div></div>`
  }

  window.STUDIO = {
    reelPlan,
    carousel: (row) => [slideHook(row, 1350), slideProblem(row, row.old_way, row.pose_2, 1350), slideProblem(row, row.cost, row.pose_3, 1350),
                        slideMechanic(row, 1350), slideOutcome(row, 1350), slideCta(row, 1350)],
    still: slideStill,
    reelFrame,
    card, phone, laurel,
  }
})()
