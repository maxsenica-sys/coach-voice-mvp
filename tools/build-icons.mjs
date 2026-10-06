#!/usr/bin/env node
/**
 * tools/build-icons.mjs — the app icons, generated from the one laurel.
 *
 *   node tools/build-icons.mjs        # write public/icon.svg and the PNGs
 *
 * The mark is lib/brand-mark.ts. The icon is the same picture the boot shell
 * paints (app/layout.tsx #cv-boot .m) and the iOS launch images show: the
 * cream laurel on the sage tile. Home screen → launch screen → app is then one
 * picture growing, not three different ones.
 *
 * Written files, and why each exists:
 *   icon.svg               browsers that take SVG (manifest "any", tab icon)
 *   icon-192.png, -512     Android / desktop install, rounded like the SVG
 *   icon-maskable-512.png  Android adaptive icon: full-bleed ground, wreath
 *                          inside the 80% safe zone so no launcher crops it
 *   apple-icon.png (180)   iOS home screen: full-bleed square, because iOS
 *                          rounds the corners itself and a pre-rounded icon
 *                          shows a dark ring inside its own mask
 *
 * Do not hand-edit the outputs; change lib/brand-mark.ts or this file and run
 * it again (`npm run build:splash` runs it too).
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { laurelShapes } from '../lib/brand-mark.ts'

const PUBLIC = join(process.cwd(), 'public')
const FROM = '#6F8E6B'
const TO = '#4F6B4B'
const LEAF = '#FBF6EA'

/** An icon `size` px square; `rounded` false for full-bleed; `scale` is the wreath's share of the side. */
function iconSvg({ size, rounded, scale }) {
  const r = rounded ? Math.round(size * 0.215) : 0
  const wreath = size * scale
  const off = (size - wreath) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${FROM}"/><stop offset="1" stop-color="${TO}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <svg x="${off}" y="${off + size * 0.01}" width="${wreath}" height="${wreath}" viewBox="0 0 48 48">${laurelShapes(LEAF)}</svg>
</svg>`
}

async function png(file, opts) {
  const buf = await sharp(Buffer.from(iconSvg(opts))).png({ compressionLevel: 9 }).toBuffer()
  writeFileSync(join(PUBLIC, file), buf)
  console.log(`  ${file}  ${opts.size}px  ${(buf.length / 1024).toFixed(1)}KB`)
}

writeFileSync(join(PUBLIC, 'icon.svg'), iconSvg({ size: 512, rounded: true, scale: 0.7 }) + '\n')
console.log('  icon.svg')
await png('icon-192.png', { size: 192, rounded: true, scale: 0.7 })
await png('icon-512.png', { size: 512, rounded: true, scale: 0.7 })
await png('icon-maskable-512.png', { size: 512, rounded: false, scale: 0.58 })
await png('apple-icon.png', { size: 180, rounded: false, scale: 0.7 })

/* The browser tab. Next serves app/favicon.ico for every page; an ICO may
 * carry PNG data directly, so this is one 32px PNG behind a 22-byte header. */
{
  const data = await sharp(Buffer.from(iconSvg({ size: 32, rounded: true, scale: 0.78 }))).png().toBuffer()
  const head = Buffer.alloc(22)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4)   // ICONDIR: icon, 1 image
  head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9)
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12)                          // planes, bpp
  head.writeUInt32LE(data.length, 14); head.writeUInt32LE(22, 18)                // size, offset
  writeFileSync(join(process.cwd(), 'app', 'favicon.ico'), Buffer.concat([head, data]))
  console.log('  app/favicon.ico  32px')
}
