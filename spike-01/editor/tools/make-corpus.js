// Builds a realistic ~1 MB notebook stream out of real prose, with equations,
// tables and images injected at realistic density. Disposable spike artifact.
//
// Run with no arguments and it fetches its own source text; pass a path to use
// a different one. The source is pinned so the corpus is reproducible byte for
// byte, which is what makes a later latency comparison meaningful.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, '..', 'public')
const SOURCE = 'https://www.gutenberg.org/cache/epub/2701/pg2701.txt'  // Moby Dick, public domain
const cache = path.join(here, '.corpus-source.txt')
let srcText = process.argv[2]
if (!srcText) {
  if (!fs.existsSync(cache)) {
    process.stdout.write(`fetching ${SOURCE} …\n`)
    const res = await fetch(SOURCE)
    if (!res.ok) throw new Error(`could not fetch source text: ${res.status}`)
    fs.writeFileSync(cache, await res.text())
  }
  srcText = cache
}

fs.mkdirSync(path.join(out, 'img'), { recursive: true })

// ── source prose ────────────────────────────────────────────────────────────
let raw = fs.readFileSync(srcText, 'utf8')
// strip Gutenberg header/footer
const s = raw.indexOf('*** START OF THE PROJECT GUTENBERG')
const e = raw.indexOf('*** END OF THE PROJECT GUTENBERG')
if (s > 0 && e > s) raw = raw.slice(raw.indexOf('\n', s) + 1, e)

// unwrap hard-wrapped lines into single-line paragraphs (how a notebook stores prose)
const paras = raw
  .split(/\n\s*\n/)
  .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
  .filter(p => p.length > 120 && !/^CHAPTER/i.test(p) && !p.includes('_'))

// ── fixtures ────────────────────────────────────────────────────────────────
const INLINE_MATH = [
  '$E = mc^2$', '$\\nabla \\cdot \\mathbf{B} = 0$', '$\\chi^2_{\\nu}$',
  '$\\alpha_s(M_Z) = 0.1179 \\pm 0.0010$', '$\\int_0^\\infty e^{-x^2}\\,dx = \\tfrac{\\sqrt\\pi}{2}$',
  '$O(n \\log n)$', '$\\hat{\\rho} = \\sum_i p_i |\\psi_i\\rangle\\langle\\psi_i|$',
]
const DISPLAY_MATH = [
  '$$\\mathcal{L} = -\\tfrac{1}{4} F_{\\mu\\nu}F^{\\mu\\nu} + i\\bar\\psi \\gamma^\\mu D_\\mu \\psi + \\text{h.c.}$$',
  '$$\\frac{\\partial u}{\\partial t} = \\alpha \\frac{\\partial^2 u}{\\partial x^2}$$',
  '$$P(A \\mid B) = \\frac{P(B \\mid A)\\,P(A)}{P(B)}$$',
]
const TABLE = `| Run | Condition | Median (ms) | p99 (ms) | Notes |
| --- | --- | --- | --- | --- |
| 01 | baseline | 4.1 | 11.8 | no widgets in viewport |
| 02 | widgets on | 4.4 | 13.2 | three equations visible |
| 03 | burst | 5.0 | 18.6 | 300 WPM synthetic |
| 04 | scrolled | 4.3 | 12.9 | mid-document |`

// ── a minimal PNG writer, so the corpus has real raster images ──────────────
function crc32(buf) {
  let c, table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function writePng(file, w, h, pixel) {
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y)
      row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

// plot-like figure (what a pasted screenshot of a chart looks like)
writePng(path.join(out, 'img', 'plot.png'), 900, 420, (x, y) => {
  const w = 900, h = 420
  if (x < 60 || y > h - 50) return [245, 245, 244]           // margins
  const t = (x - 60) / (w - 80)
  const yv = h - 50 - (h - 110) * (0.5 + 0.42 * Math.sin(t * 7) * Math.exp(-t * 1.2))
  if (Math.abs(y - yv) < 2.2) return [5, 150, 105]           // curve
  if ((x - 60) % 90 < 1 || (h - 50 - y) % 60 < 1) return [231, 229, 228]  // grid
  return [250, 250, 249]
})
// scribble-like figure
writePng(path.join(out, 'img', 'scribble.png'), 620, 300, (x, y) => {
  const d1 = Math.abs(y - (150 + 90 * Math.sin(x / 40)))
  const d2 = Math.hypot(x - 420, y - 150) - 80
  if (d1 < 3 || Math.abs(d2) < 3) return [41, 37, 36]
  return [250, 250, 249]
})
const IMAGES = [
  '![Latency against document size, three widget densities](img/plot.png)',
  '![Sketch of the window-stitching idea](img/scribble.png)',
]

// ── assemble the stream ─────────────────────────────────────────────────────
const TARGET = 1_050_000
const chunks = []
let size = 0, i = 0, day = new Date(Date.UTC(2024, 0, 3))
let sinceDay = 0, n = 0

const SUBJECTS = ['tephra', 'house deal', 'physics', 'hiring', 'reading', 'talk prep']

while (size < TARGET && i < paras.length) {
  if (sinceDay === 0) {
    const iso = day.toISOString().slice(0, 10)
    chunks.push(`\n## ${iso}\n`)
    sinceDay = 6 + (n % 9)
    day = new Date(day.getTime() + (1 + (n % 3)) * 86400000)
  }
  let p = paras[i++]
  n++; sinceDay--

  if (n % 11 === 0) p = p.replace(/\. /, `. ${INLINE_MATH[n % INLINE_MATH.length]} `)
  if (n % 23 === 0) p = `[[${SUBJECTS[n % SUBJECTS.length]}]] ` + p

  chunks.push(p + '\n')
  if (n % 37 === 0) chunks.push('\n' + DISPLAY_MATH[n % DISPLAY_MATH.length] + '\n')
  if (n % 53 === 0) chunks.push('\n' + IMAGES[n % IMAGES.length] + '\n')
  if (n % 71 === 0) chunks.push('\n' + TABLE + '\n')
  if (n % 17 === 0) chunks.push(`\n### ${p.split(/[,.;]/)[0].slice(0, 60).trim()}\n`)

  size = chunks.reduce((a, c) => a + c.length, 0)
}

// A dedicated fixture block at the very top: the vim-over-widget test bench.
const bench = `# Tephra spike A — scratch bench

The lines below exist to be attacked with vim. Try \`dd\`, \`x\`, \`cw\`, \`v\` + motion,
\`u\`, and plain \`h\`/\`l\` across each widget.

Inline equation mid-line: the correction term $\\alpha_s(M_Z) = 0.1179 \\pm 0.0010$ sits here, with text after it.
Inline image mid-line: see ![plot](img/plot.png) for the shape, text continues after the image.
Two widgets one line: $E = mc^2$ and $\\nabla \\cdot \\mathbf{B} = 0$ with prose between and after.

$$\\frac{\\partial u}{\\partial t} = \\alpha \\frac{\\partial^2 u}{\\partial x^2}$$

${TABLE}

Ordinary prose line, for contrast, so that motion into and out of the block above is easy to judge.
`

fs.writeFileSync(path.join(out, 'corpus.md'), bench + chunks.join('\n'))
const bytes = fs.statSync(path.join(out, 'corpus.md')).size
console.log(`corpus.md: ${(bytes / 1e6).toFixed(2)} MB, ${n} paragraphs`)
