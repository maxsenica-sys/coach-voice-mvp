// content/studio/poses.mjs: draws every pose in the library onto one sheet.
//
//   npm run content:poses     -> content/studio/out/poses.png
//
// The sheet is how a character change is reviewed: edit a pose or a costume in
// cast.js, run this, and look at all 24 at once before rendering any post.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = process.env.OUT || path.join(HERE, 'out')
const font = fs.readFileSync(path.join(ROOT, 'app/fonts/PlusJakartaSans-latin-var.woff2')).toString('base64')
const html = `<html><head><style>
@font-face{font-family:'Pindar Sans';src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:200 800}
body{margin:0;background:#F5ECD7;font-family:'Pindar Sans'}
.grid{display:grid;grid-template-columns:repeat(6,300px)}
.cell{width:300px;height:340px;position:relative;border:1px solid #1F242122}
.cell span{position:absolute;bottom:6px;left:8px;font-size:15px;font-weight:600;color:#1F2421}
</style><script>${fs.readFileSync(path.join(HERE, 'cast.js'), 'utf8')}</script></head><body><div class="grid" id="g"></div>
<script>
for (const [name, p] of Object.entries(POSES)) {
  const d = document.createElement('div'); d.className = 'cell'
  d.innerHTML = '<svg width="300" height="310" viewBox="-110 -300 220 310">' + drawCharacter(p, { t: 0.3 }) + '</svg><span>' + name + '</span>'
  document.getElementById('g').appendChild(d)
}
</script></body></html>`
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 1360 } })
await page.setContent(html)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: path.join(OUT, 'poses.png'), fullPage: true })
await browser.close()
console.log(`wrote ${path.relative(ROOT, path.join(OUT, 'poses.png'))}`)
