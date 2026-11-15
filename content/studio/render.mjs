// content/studio/render.mjs: turns rows of the content queue into finished posts.
//
//   npm run content:render -- P001 P042        named posts
//   npm run content:render -- --day 3          the three posts the plan puts on day 3
//   npm run content:render -- --all            every post in the queue
//
// Each post becomes one folder under content/studio/out/ (git-ignored), named
// for its day and post id: the slides (carousel), still.png (still) or reel.mp4
// and cover.jpg (reel), plus caption.txt and script.txt. That folder is the
// handover the brief describes: anything that posts reads it as it is.
//
// A reel is silent until its voiceover exists: record the script and put it in
// the post's folder as voiceover.m4a, then render again and it is laid under.
//
// Everything is drawn by cast.js and studio.js in a real browser and captured
// frame by frame, so a reel is exact and repeatable. The wreath comes from
// lib/brand-mark.ts and the type from app/fonts, never a copy of either.

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = process.env.OUT || path.join(HERE, 'out')
const FPS = Number(process.env.FPS || 30)

const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/CONTENT_QUEUE.json'), 'utf8'))
// POSTING_PLAN.csv: day,week,slot,format,post_id,... (week names contain commas, so match the id)
const planRows = fs.readFileSync(path.join(ROOT, 'content/POSTING_PLAN.csv'), 'utf8').split('\n').slice(1).filter(Boolean)
const dayOf = {}
for (const line of planRows) {
  const id = (line.match(/,(P\d{3}),/) || [])[1]
  const day = line.split(',')[0]
  if (id && day) dayOf[id] = day
}

const brand = await import(path.join(ROOT, 'lib/brand-mark.ts'))
const laurel = { stems: brand.LAUREL_STEMS, leaves: brand.LAUREL_LEAVES, stemWidth: brand.LAUREL_STEM_WIDTH }
const font = fs.readFileSync(path.join(ROOT, 'app/fonts/PlusJakartaSans-latin-var.woff2')).toString('base64')
const js = `window.LAUREL=${JSON.stringify(laurel)};\n` + ['cast.js', 'studio.js'].map((f) => fs.readFileSync(path.join(HERE, f), 'utf8')).join(';\n')
const shell = `<html><head><style>@font-face{font-family:'Pindar Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}
html,body{margin:0;background:#000}</style><script>${js}</script></head><body><div id="f"></div></body></html>`

function pickIds(argv) {
  if (argv.includes('--all')) return queue.map((r) => r.post_id)
  const d = argv.indexOf('--day')
  if (d !== -1) return Object.entries(dayOf).filter(([, day]) => day === argv[d + 1]).map(([id]) => id)
  return argv.filter((a) => /^P\d{3}$/.test(a))
}

const ids = pickIds(process.argv.slice(2))
if (ids.length === 0) {
  console.error('Name posts (P001 P042), a day (--day 3) or --all.')
  process.exit(1)
}

const browser = await chromium.launch()
fs.mkdirSync(OUT, { recursive: true })
let failed = 0
for (const id of ids) {
  const row = queue.find((r) => r.post_id === id)
  if (!row) { console.error(`${id}: not in CONTENT_QUEUE.json`); failed++; continue }
  const day = dayOf[id] ? `day${String(dayOf[id]).padStart(2, '0')}` : 'backlog'
  const dir = path.join(OUT, `${day}_${id}_${row.format}_${row.feature_id}`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'caption.txt'), row.caption + '\n\n' + row.hashtags + '\n')
  fs.writeFileSync(path.join(dir, 'script.txt'), row.voiceover_script + '\n')
  const H = row.format === 'reel' ? 1920 : 1350
  const page = await browser.newPage({ viewport: { width: 1080, height: H } })
  await page.setContent(shell)
  await page.evaluate(() => document.fonts.ready)
  const shot = async (html, file, type = 'png') => {
    await page.evaluate((h) => { document.getElementById('f').innerHTML = h }, html)
    await page.screenshot({ path: file, type, ...(type === 'jpeg' ? { quality: 92 } : {}), clip: { x: 0, y: 0, width: 1080, height: H } })
  }
  if (row.format === 'carousel') {
    const slides = await page.evaluate((r) => window.STUDIO.carousel(r), row)
    for (let i = 0; i < slides.length; i++) await shot(slides[i], path.join(dir, `slide-${i + 1}.png`))
  } else if (row.format === 'still') {
    await shot(await page.evaluate((r) => window.STUDIO.still(r), row), path.join(dir, 'still.png'))
  } else {
    const { total } = await page.evaluate((r) => window.STUDIO.reelPlan(r), row)
    const frames = fs.mkdtempSync(path.join(dir, 'frames-'))
    const n = Math.round(total * FPS)
    for (let i = 0; i < n; i++) {
      const html = await page.evaluate(([r, t]) => window.STUDIO.reelFrame(r, t), [row, i / FPS])
      await shot(html, path.join(frames, `${String(i).padStart(4, '0')}.jpg`), 'jpeg')
    }
    const vo = path.join(dir, 'voiceover.m4a')
    const args = ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%04d.jpg')]
    if (fs.existsSync(vo)) args.push('-i', vo, '-c:a', 'aac', '-shortest')
    else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest', '-c:a', 'aac')
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'medium', '-movflags', '+faststart', path.join(dir, 'reel.mp4'))
    try {
      execFileSync('ffmpeg', args)
    } catch (e) {
      console.error(`${id}: ffmpeg failed (is it installed?): ${e.message}`)
      failed++
    }
    const cover = path.join(frames, `${String(Math.min(45, n - 1)).padStart(4, '0')}.jpg`)
    if (fs.existsSync(cover)) fs.copyFileSync(cover, path.join(dir, 'cover.jpg'))
    fs.rmSync(frames, { recursive: true, force: true })
  }
  await page.close()
  console.log(`rendered ${path.relative(ROOT, dir)}`)
}
await browser.close()
if (failed) process.exit(1)
