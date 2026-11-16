// content/studio/poses.mjs: draws the pose library onto one sheet.
//
//   npm run content:poses                 every pose  -> content/studio/out/poses.png
//   npm run content:poses -- coach        only poses whose name matches (a regular
//                                         expression) -> poses-coach.png, drawn larger
//
// The sheet is how a character change is reviewed: edit a pose or a costume in
// cast.js, run this, and look before rendering any post.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = process.env.OUT || path.join(HERE, 'out')
const only = process.argv[2] || ''
const cell = only ? 400 : 300
const cols = only ? 4 : 6
const font = fs.readFileSync(path.join(ROOT, 'app/fonts/PlusJakartaSans-latin-var.woff2')).toString('base64')
const html = `<html><head><style>
@font-face{font-family:'Pindar Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}
body{margin:0;background:#F5ECD7;font-family:'Pindar Sans'}
.grid{display:grid;grid-template-columns:repeat(${cols},${cell}px)}
.cell{width:${cell}px;height:${Math.round(cell * 1.16)}px;position:relative;border:1px solid #1F242122;box-sizing:border-box}
.cell span{position:absolute;bottom:6px;left:8px;font-size:15px;font-weight:600;color:#1F2421}
</style><script>${fs.readFileSync(path.join(HERE, 'cast.js'), 'utf8')}</script></head><body><div class="grid" id="g"></div>
<script>
for (const [name, p] of Object.entries(POSES)) {
  if (!new RegExp(${JSON.stringify(only)}).test(name)) continue
  const d = document.createElement('div'); d.className = 'cell'
  d.innerHTML = '<svg width="${cell}" height="${Math.round(cell * 1.06)}" viewBox="-140 -290 280 297">' + drawCharacter(p, { t: 0.3 }) + '</svg><span>' + name + '</span>'
  document.getElementById('g').appendChild(d)
}
</script></body></html>`
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: cell * cols, height: 800 } })
page.on('pageerror', (e) => { console.error('cast.js failed:', e.message); process.exitCode = 1 })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
const file = path.join(OUT, only ? `poses-${only.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png` : 'poses.png')
await page.screenshot({ path: file, fullPage: true })
await browser.close()
console.log(`wrote ${path.relative(ROOT, file)}`)
