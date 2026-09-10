// Images into the corpus (R7).
//
// **What a picture costs is a file and a link**, and the claims worth pinning
// are about the file: that it is written as bytes rather than as text, that
// pasting the same one twice costs one file, and that the link a caller is
// handed actually resolves from where they said they were.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { attach } from '../../src/main/x/documents/attachments.ts'
import { dayFile, relativePath, type RelPath } from '../../src/main/w/layout.ts'
import type { DateKey } from '../../src/shared/document-api.ts'

const DAY = '2026-03-09' as DateKey

/** A one-pixel PNG. Real bytes, because the point is that they survive. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
])

async function notebook(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-attach-'))
  await mkdir(join(root, 'notebook.stream', '2026', '03'), { recursive: true })
  await writeFile(join(root, dayFile(DAY)), `---\ntephra: 1\ndate: ${DAY}\n---\n\nA day.\n`)
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'aside.md'), `---\ntephra: 1\n---\n\nA note.\n`)
  const nb = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => nb.close())
  return { root, nb }
}

test('THE POINT: the bytes arrive unchanged', async t => {
  // A PNG put through a UTF-8 encoder is a corrupt PNG that looks like a
  // successful write, which is why `writeAtomic` learned to take bytes.
  const { root, nb } = await notebook(t)
  const rel = await attach(nb, DAY, 'clipboard', 'png', PNG)
  const back = await readFile(join(root, rel))
  assert.deepEqual(new Uint8Array(back), PNG)
})

test('and it is filed under the day it arrived, browsably', async t => {
  const { nb } = await notebook(t)
  const rel = await attach(nb, DAY, 'clipboard', 'png', PNG)
  assert.match(rel, /^attachments\/2026\/03\/2026-03-09-clipboard-[0-9a-f]{6}\.png$/)
})

test('the same picture twice costs one file', async t => {
  const { nb } = await notebook(t)
  const first = await attach(nb, DAY, 'clipboard', 'png', PNG)
  const second = await attach(nb, DAY, 'clipboard', 'png', PNG)
  assert.equal(first, second)
  const files = await nb.list('attachments' as RelPath)
  assert.equal(files.length, 1)
})

test('and two different pictures do not collide', async t => {
  const { nb } = await notebook(t)
  const other = new Uint8Array([...PNG.slice(0, -1), 0x83])
  const a = await attach(nb, DAY, 'clipboard', 'png', PNG)
  const b = await attach(nb, DAY, 'clipboard', 'png', other)
  assert.notEqual(a, b)
})

test('the name somebody gave it survives, slugged', async t => {
  const { nb } = await notebook(t)
  const rel = await attach(nb, DAY, 'Kitchen Plan v2', 'png', PNG)
  assert.match(rel, /2026-03-09-kitchen-plan-v2-[0-9a-f]{6}\.png$/)
})

// ── the link ───────────────────────────────────────────────

test('THE LINK: it resolves from the day it was written in', async t => {
  const { root, nb } = await notebook(t)
  const rel = await attach(nb, DAY, 'clipboard', 'png', PNG)
  const link = relativePath(dayFile(DAY), rel)
  assert.equal(link, '../../../attachments/2026/03/' + rel.split('/').pop())
  // And it is a real path, not merely a plausible one.
  const from = dirname(join(root, dayFile(DAY)))
  assert.equal(resolve(from, link), join(root, rel))
})

test('and from a note, which has no day of its own', async t => {
  // The picture is filed under the day it arrived; the LINK is relative to
  // wherever it was written, which for a note is the note (D54, print's `Base`).
  const { root, nb } = await notebook(t)
  const rel = await attach(nb, DAY, 'clipboard', 'png', PNG)
  const link = relativePath('notes/aside.md' as RelPath, rel)
  assert.equal(link, '../attachments/2026/03/' + rel.split('/').pop())
  assert.equal(resolve(dirname(join(root, 'notes/aside.md')), link), join(root, rel))
})
