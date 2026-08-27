// Rebuild the app icon from one source image.
//
// macOS wants ten PNGs at five sizes and their doubles, packed into an `.icns`.
// Doing that by hand is ten `sips` invocations with a naming convention where
// `icon_32x32@2x.png` must be 64 pixels — which is exactly the kind of thing to
// get subtly wrong at two in the morning and not notice until the Dock looks
// soft.
//
// **`package.mjs` needs no change when this runs.** It points at
// `design/icon/Tephra` with NO extension, because packager appends the
// platform's own; the file this writes is what it picks up.
//
// Usage:  node scripts/icon.mjs [path/to/source.png]
//   with no argument it reuses design/icon/source.png, which is whatever was
//   passed last time — so regenerating never needs the original again.

import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ICON_DIR = resolve(process.cwd(), '..', 'design', 'icon')
const KEPT = join(ICON_DIR, 'source.png')
const SET = join(ICON_DIR, 'Tephra.iconset')
const ICNS = join(ICON_DIR, 'Tephra.icns')

/** [pixels, name] — the doubles are the same nominal size at twice the pixels. */
const SIZES = [
  [16, 'icon_16x16'],
  [32, 'icon_16x16@2x'],
  [32, 'icon_32x32'],
  [64, 'icon_32x32@2x'],
  [128, 'icon_128x128'],
  [256, 'icon_128x128@2x'],
  [256, 'icon_256x256'],
  [512, 'icon_256x256@2x'],
  [512, 'icon_512x512'],
  [1024, 'icon_512x512@2x'],
]

const source = resolve(process.argv[2] ?? KEPT)
if (!existsSync(source)) {
  console.error(
    `no source image at ${source}\n` +
      `pass one:  node scripts/icon.mjs ~/Downloads/whatever.png`,
  )
  process.exit(1)
}

/** One `sips` query, since it prints "key: value" under the filename. */
const measure = (key) =>
  Number(
    execFileSync('sips', ['-g', key, source], { encoding: 'utf8' })
      .split('\n')
      .find(line => line.includes(key))
      ?.split(':')[1] ?? 0,
  )

const width = measure('pixelWidth')
const height = measure('pixelHeight')

// **Refused rather than upscaled.** A source under 1024 makes a soft icon at
// the size the Dock actually shows, and nothing downstream complains — the
// build succeeds and the app just looks slightly wrong forever.
if (width < 1024 || height < 1024) {
  console.error(`source is ${width}×${height}; the largest icon needs 1024×1024 or more`)
  process.exit(1)
}
if (width !== height) {
  console.error(`source is ${width}×${height}; an icon is square, and sips would stretch it`)
  process.exit(1)
}

if (source !== KEPT) await copyFile(source, KEPT)
await rm(SET, { recursive: true, force: true })
await mkdir(SET, { recursive: true })

for (const [pixels, name] of SIZES) {
  execFileSync('sips', [
    '-s', 'format', 'png',
    '-z', String(pixels), String(pixels),
    KEPT,
    '--out', join(SET, `${name}.png`),
  ], { stdio: 'ignore' })
}

execFileSync('iconutil', ['-c', 'icns', SET, '-o', ICNS], { stdio: 'inherit' })

const size = execFileSync('du', ['-h', ICNS], { encoding: 'utf8' }).split('\t')[0]
console.log(`${SIZES.length} sizes → ${ICNS} (${size.trim()})`)
console.log('Now:  npm run package')
