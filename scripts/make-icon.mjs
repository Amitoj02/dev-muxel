/**
 * Generates the application icon.
 *
 *   npm run icon
 *
 * The mark is a D built out of the product: a narrow pane (the stem), the
 * gutter between them, and a wide pane crossed by its header rule (the bowl).
 * The bowl's deep right radius closes the letter; the stem's shallow radius
 * keeps it a pane rather than a pill. Two radii, never one — that asymmetry is
 * what makes the silhouette read as a letter at 16px.
 *
 * Every measure below is a fraction of the canvas, straight off the 64-unit
 * construction grid in brand-kit/DevLobby-Brand-Guide.html, so the whole set is
 * redrawn natively at each size rather than downscaled from one bitmap: the
 * 16px Start Menu entry gets its own layout, with its own 1px gutter, instead
 * of the mush a resampler would make of one.
 *
 * Written by hand (a PNG encoder and an ICO container are about eighty lines
 * between them) rather than pulling in an image library for one build artefact.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const BUILD = path.join(here, '..', 'build')
const PUBLIC = path.join(here, '..', 'src', 'renderer', 'public')

// --- palette, straight from tokens.css --------------------------------------
const CHASSIS = [0x0b, 0x0e, 0x13] // --bg-chassis, the ground
const RED = [0xe5, 0x37, 0x2a] // --red, the mark
const LINE_STRONG = [0x2b, 0x34, 0x42] // --line-strong, the band across the bowl

// --- the 64-unit construction grid ------------------------------------------
const U = 64
const PAD = 0.115 // icon padding, as a fraction of the whole canvas
const STEM_W = 22.5
const GUTTER_W = 4
const BOWL_W = 37.5
const BAND_H = 16
const R_STEM = 7.5
const R_BOWL = 17.5

// ---------------------------------------------------------------------------
// A tiny RGBA canvas
// ---------------------------------------------------------------------------

function canvas(size) {
  const px = Buffer.alloc(size * size * 4)
  return {
    size,
    px,
    fill(rgb) {
      for (let i = 0; i < size * size; i += 1) {
        px[i * 4] = rgb[0]
        px[i * 4 + 1] = rgb[1]
        px[i * 4 + 2] = rgb[2]
        px[i * 4 + 3] = 255
      }
    },
    /** Paint `rgb` over the pixel at `x,y` with coverage `a` (0..1). */
    blend(x, y, rgb, a) {
      if (a <= 0) return
      const i = (y * size + x) * 4
      if (a >= 1) {
        px[i] = rgb[0]
        px[i + 1] = rgb[1]
        px[i + 2] = rgb[2]
        return
      }
      px[i] += Math.round((rgb[0] - px[i]) * a)
      px[i + 1] += Math.round((rgb[1] - px[i + 1]) * a)
      px[i + 2] += Math.round((rgb[2] - px[i + 2]) * a)
    }
  }
}

/**
 * Coverage of one rounded rectangle, sampled on an 8x8 grid inside each pixel.
 *
 * Only the four corners are ever fractional: the layout below keeps every
 * straight edge on a whole pixel, so the flat sides stay as crisp as the rest
 * of the chassis and the sampling is spent entirely on the two radii — which
 * are the whole point of the shape.
 */
const SUB = 8

function paintRounded(c, rgb, x, y, w, h, radii) {
  // A radius can never eat more than half the box it turns.
  const cap = Math.min(w, h) / 2
  const [rTL, rTR, rBR, rBL] = radii.map((r) => Math.min(r, cap))

  const inside = (px, py) => {
    if (px < x || px > x + w || py < y || py > y + h) return false
    let cx, cy, r
    if (rTL && px < x + rTL && py < y + rTL) [cx, cy, r] = [x + rTL, y + rTL, rTL]
    else if (rTR && px > x + w - rTR && py < y + rTR) [cx, cy, r] = [x + w - rTR, y + rTR, rTR]
    else if (rBR && px > x + w - rBR && py > y + h - rBR)
      [cx, cy, r] = [x + w - rBR, y + h - rBR, rBR]
    else if (rBL && px < x + rBL && py > y + h - rBL) [cx, cy, r] = [x + rBL, y + h - rBL, rBL]
    else return true
    const dx = px - cx
    const dy = py - cy
    return dx * dx + dy * dy <= r * r
  }

  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(c.size, Math.ceil(x + w))
  const y1 = Math.min(c.size, Math.ceil(y + h))

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      let hits = 0
      for (let j = 0; j < SUB; j += 1) {
        for (let i = 0; i < SUB; i += 1) {
          if (inside(px + (i + 0.5) / SUB, py + (j + 0.5) / SUB)) hits += 1
        }
      }
      c.blend(px, py, rgb, hits / (SUB * SUB))
    }
  }
}

/**
 * The mark's layout at a given canvas size, in whole device pixels.
 *
 * Rounding here rather than at paint time is what keeps the stem, the gutter
 * and the band on exact pixel boundaries. The gutter is the one measure with a
 * floor: below one pixel it closes up, and the D becomes a blob.
 */
function layout(size) {
  const pad = Math.max(1, Math.round(size * PAD))
  const box = size - pad * 2
  const gutter = Math.max(1, Math.round((box * GUTTER_W) / U))
  // Whatever the gutter took comes out of the two panes, split in their own
  // ratio, so the three of them still fill the box exactly.
  const panes = box - gutter
  const stem = Math.round((panes * STEM_W) / (STEM_W + BOWL_W))
  const bowl = panes - stem
  const band = Math.max(1, Math.round((box * BAND_H) / U))

  return {
    pad,
    box,
    stem,
    gutter,
    bowl,
    band,
    bandY: pad + Math.round((box - band) / 2),
    rStem: (box * R_STEM) / U,
    rBowl: (box * R_BOWL) / U
  }
}

/** Draw the mark on the chassis ground at an arbitrary size. */
function drawIcon(size) {
  const c = canvas(size)
  c.fill(CHASSIS)

  const l = layout(size)
  const bowlX = l.pad + l.stem + l.gutter

  // stem — left corners only
  paintRounded(c, RED, l.pad, l.pad, l.stem, l.box, [l.rStem, 0, 0, l.rStem])
  // bowl — right corners only
  paintRounded(c, RED, bowlX, l.pad, l.bowl, l.box, [0, l.rBowl, l.rBowl, 0])
  // The header rule, centred, spanning the whole bowl. It sits well inside the
  // bowl's straight flank, so it needs no clipping to the radii.
  paintRounded(c, LINE_STRONG, bowlX, l.bandY, l.bowl, l.band, [0, 0, 0, 0])

  return c
}

/**
 * The same construction as vector geometry, for the surfaces that take an SVG.
 *
 * Drawn from the nominal 64-unit grid rather than a rounded pixel layout:
 * there are no pixels to land on, so the true fractions are the honest ones.
 */
function drawSvg() {
  const inset = U * PAD
  const scale = (U - inset * 2) / U
  const at = (v) => +(inset + v * scale).toFixed(3)
  const of = (v) => +(v * scale).toFixed(3)

  const rs = of(R_STEM)
  const rb = of(R_BOWL)
  const bowlX = at(STEM_W + GUTTER_W)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${U}" height="${U}" viewBox="0 0 ${U} ${U}">`,
    `  <rect width="${U}" height="${U}" fill="#0b0e13"></rect>`,
    `  <path d="M${at(R_STEM)},${at(0)} H${at(STEM_W)} V${at(U)} H${at(R_STEM)} A${rs},${rs} 0 0 1 ${at(0)},${at(U - R_STEM)} V${at(R_STEM)} A${rs},${rs} 0 0 1 ${at(R_STEM)},${at(0)} Z" fill="#e5372a"></path>`,
    `  <path d="M${bowlX},${at(0)} H${at(U - R_BOWL)} A${rb},${rb} 0 0 1 ${at(U)},${at(R_BOWL)} V${at(U - R_BOWL)} A${rb},${rb} 0 0 1 ${at(U - R_BOWL)},${at(U)} H${bowlX} Z" fill="#e5372a"></path>`,
    `  <rect x="${bowlX}" y="${at((U - BAND_H) / 2)}" width="${of(BOWL_W)}" height="${of(BAND_H)}" fill="#2b3442"></rect>`,
    `</svg>`,
    ''
  ].join('\n')
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(c) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(c.size, 0)
  ihdr.writeUInt32BE(c.size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // One filter byte (0 = None) per scanline.
  const stride = c.size * 4
  const raw = Buffer.alloc((stride + 1) * c.size)
  for (let y = 0; y < c.size; y += 1) {
    raw[y * (stride + 1)] = 0
    c.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------------------
// ICO (PNG-compressed entries, which Windows has read since Vista)
// ---------------------------------------------------------------------------

function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length

  entries.forEach((e, i) => {
    const at = i * 16
    // 256 is encoded as 0 in the single width/height byte.
    dir[at] = e.size >= 256 ? 0 : e.size
    dir[at + 1] = e.size >= 256 ? 0 : e.size
    dir[at + 2] = 0 // palette size
    dir[at + 3] = 0 // reserved
    dir.writeUInt16LE(1, at + 4) // colour planes
    dir.writeUInt16LE(32, at + 6) // bits per pixel
    dir.writeUInt32LE(e.png.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += e.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// ---------------------------------------------------------------------------

const SIZES = [16, 24, 32, 48, 64, 128, 256]

fs.mkdirSync(BUILD, { recursive: true })
fs.mkdirSync(PUBLIC, { recursive: true })

const entries = SIZES.map((size) => ({ size, png: encodePng(drawIcon(size)) }))
const ico = encodeIco(entries)

const wrote = (file, bytes, note) =>
  console.log(`${file.padEnd(32)} ${String(bytes).padStart(6)} bytes  (${note})`)

// electron-builder reads this one for the exe, the installer, the shortcuts
// and the taskbar.
fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico)
wrote('build/icon.ico', ico.length, SIZES.join(', '))

// Some electron-builder targets want a large PNG instead, and it is the one to
// look at when checking a change to the mark.
const png = encodePng(drawIcon(512))
fs.writeFileSync(path.join(BUILD, 'icon.png'), png)
wrote('build/icon.png', png.length, '512')

// The renderer's own, for the tab `electron-vite dev` opens in a real browser.
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico)
wrote('src/renderer/public/favicon.ico', ico.length, SIZES.join(', '))

const svg = drawSvg()
fs.writeFileSync(path.join(PUBLIC, 'favicon.svg'), svg)
wrote('src/renderer/public/favicon.svg', svg.length, 'vector')
