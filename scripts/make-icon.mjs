/**
 * Generates the application icon.
 *
 *   npm run icon
 *
 * The mark is the app itself: a 2x2 tiling with the design's 1.24:1 column
 * ratio, drawn on the chassis blue-black, with the top-left pane in signal red —
 * the pane that wants you. It is rendered natively at every size rather than
 * downscaled from one bitmap, so the 16px Start Menu entry has the same crisp
 * 1px edges as the 256px one.
 *
 * Written by hand (a PNG encoder and an ICO container are about eighty lines
 * between them) rather than pulling in an image library for one build artefact.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'build')

// --- palette, straight from tokens.css --------------------------------------
const CHASSIS = [0x0b, 0x0e, 0x13]
const RED = [0xe5, 0x37, 0x2a]
const SLATE = [0x3b, 0x47, 0x57]
const SLATE_DIM = [0x2b, 0x34, 0x42]

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
    rect(x, y, w, h, rgb) {
      const x0 = Math.max(0, Math.round(x))
      const y0 = Math.max(0, Math.round(y))
      const x1 = Math.min(size, Math.round(x + w))
      const y1 = Math.min(size, Math.round(y + h))
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * size + xx) * 4
          px[i] = rgb[0]
          px[i + 1] = rgb[1]
          px[i + 2] = rgb[2]
          px[i + 3] = 255
        }
      }
    }
  }
}

/** Draw the mark at an arbitrary size. */
function drawIcon(size) {
  const c = canvas(size)
  c.fill(CHASSIS)

  // Padding and gutter scale with the icon, but never below one pixel — at
  // 16px the gutter is what makes it read as four panes rather than a blob.
  const pad = Math.max(1, Math.round(size * 0.14))
  const gut = Math.max(1, Math.round(size * 0.055))
  const box = size - pad * 2

  // The design's 1.24fr / 1fr columns, halved rows.
  const colW = box - gut
  const left = Math.round(colW * 0.554)
  const right = colW - left
  const rowH = box - gut
  const top = Math.round(rowH / 2)
  const bottom = rowH - top

  const x0 = pad
  const x1 = pad + left + gut
  const y0 = pad
  const y1 = pad + top + gut

  c.rect(x0, y0, left, top, RED)
  c.rect(x1, y0, right, top, SLATE)
  c.rect(x0, y1, left, bottom, SLATE)
  c.rect(x1, y1, right, bottom, SLATE_DIM)

  return c
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
    dir.writeUInt32BE(0, at + 8)
    dir.writeUInt32LE(e.png.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += e.png.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// ---------------------------------------------------------------------------

const SIZES = [16, 24, 32, 48, 64, 128, 256]

fs.mkdirSync(OUT, { recursive: true })

const entries = SIZES.map((size) => ({ size, png: encodePng(drawIcon(size)) }))

const ico = encodeIco(entries)
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico)
console.log(`build/icon.ico   ${ico.length} bytes  (${SIZES.join(', ')})`)

// electron-builder also uses a large PNG for some targets, and it is handy to
// have one to look at.
const png = encodePng(drawIcon(512))
fs.writeFileSync(path.join(OUT, 'icon.png'), png)
console.log(`build/icon.png   ${png.length} bytes  (512)`)
