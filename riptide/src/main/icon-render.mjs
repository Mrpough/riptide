/**
 * Dependency-free PNG / ICO rendering for the Riptide app and tray icons.
 *
 * This module is deliberately plain ESM JavaScript (not TypeScript) so it can
 * be imported both by the Electron main process bundle and by the standalone
 * `scripts/gen-assets.mjs` build script. It has no side effects on import.
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

/**
 * Encode raw non-premultiplied RGBA bytes as a PNG.
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgba
 * @returns {Buffer}
 */
export function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function inRoundedRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(u, x1 - r))
  const cy = Math.max(y0 + r, Math.min(v, y1 - r))
  const dx = u - cx
  const dy = v - cy
  return dx * dx + dy * dy <= r * r
}

function sign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px, py, ax, ay, bx, by)
  const d2 = sign(px, py, bx, by, cx, cy)
  const d3 = sign(px, py, cx, cy, ax, ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** The download glyph: a bold downward arrow over a baseline bar. */
function inGlyph(u, v) {
  // Arrow stem
  if (u >= 0.41 && u <= 0.59 && v >= 0.10 && v <= 0.50) return true
  // Arrow head (base at top, apex at bottom)
  if (inTriangle(u, v, 0.5, 0.76, 0.235, 0.44, 0.765, 0.44)) return true
  // Baseline "tray"
  if (u >= 0.195 && u <= 0.805 && v >= 0.83 && v <= 0.905) return true
  return false
}

function mix(a, b, t) {
  return a + (b - a) * t
}

const GLYPH_RGB = [255, 106, 43]
const BG_TOP = [35, 40, 48]
const BG_BOTTOM = [21, 24, 29]

/**
 * Render the Riptide mark into an RGBA buffer.
 * @param {number} size
 * @param {boolean} withBackground
 * @returns {Buffer}
 */
export function renderIcon(size, withBackground) {
  const rgba = Buffer.alloc(size * size * 4)
  const SS = 3
  const total = SS * SS

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let glyph = 0
      let bg = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size
          const v = (y + (sy + 0.5) / SS) / size
          if (inGlyph(u, v)) glyph += 1
          if (withBackground && inRoundedRect(u, v, 0.03, 0.03, 0.97, 0.97, 0.225)) bg += 1
        }
      }

      const ga = glyph / total
      const ba = bg / total
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      if (withBackground && ba > 0) {
        const vv = (y + 0.5) / size
        r = mix(BG_TOP[0], BG_BOTTOM[0], vv)
        g = mix(BG_TOP[1], BG_BOTTOM[1], vv)
        b = mix(BG_TOP[2], BG_BOTTOM[2], vv)
        a = ba
      }

      if (ga > 0) {
        const outA = ga + a * (1 - ga)
        if (outA > 0) {
          r = (GLYPH_RGB[0] * ga + r * a * (1 - ga)) / outA
          g = (GLYPH_RGB[1] * ga + g * a * (1 - ga)) / outA
          b = (GLYPH_RGB[2] * ga + b * a * (1 - ga)) / outA
        }
        a = outA
      }

      const i = (y * size + x) * 4
      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  return rgba
}

/**
 * Pack PNG images into a Windows .ico container.
 * @param {{ size: number, png: Buffer }[]} entries
 * @returns {Buffer}
 */
export function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const directory = Buffer.alloc(16 * count)
  const blobs = []
  let offset = 6 + 16 * count

  entries.forEach((entry, index) => {
    const o = index * 16
    const dimension = entry.size >= 256 ? 0 : entry.size
    directory[o] = dimension
    directory[o + 1] = dimension
    directory[o + 2] = 0
    directory[o + 3] = 0
    directory.writeUInt16LE(1, o + 4)
    directory.writeUInt16LE(32, o + 6)
    directory.writeUInt32LE(entry.png.length, o + 8)
    directory.writeUInt32LE(offset, o + 12)
    offset += entry.png.length
    blobs.push(entry.png)
  })

  return Buffer.concat([header, directory, ...blobs])
}
