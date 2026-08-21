// The Document over real day files. Integration rather than unit: it crosses X
// and W, and the properties worth pinning down are about what lands on disk.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/stream-document.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { BufferPosition, DateKey, DocumentWindow } from '../../src/shared/document-api.ts'

const d = (s: string): DateKey => s as DateKey
const bp = (n: number): BufferPosition => n as BufferPosition
const DAY = d('2026-03-14')
const NEXT = d('2026-03-15')

async function fixture(t: TestContext, files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-doc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(root, rel, '..'), { recursive: true })
    await writeFile(join(root, rel), text)
  }
  const doc = new StreamDocument(nb)
  t.after(() => nb.close())
  return { nb, doc, root }
}

const dayText = (date: string, body: string) =>
  `---\ntephra: 1\ndate: ${date}\nkind: stream\n---\n${body}`

async function windowOver(doc: StreamDocument, first: DateKey, last = first): Promise<DocumentWindow> {
  return doc.read({ begin: doc.positionAt(first, 0), end: doc.positionAt(last, 0) })
}

test('reads a day file, showing the body and not the frontmatter', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'Hello.\n') })
  const w = await windowOver(doc, DAY)
  assert.equal(w.text, 'Hello.\n', 'frontmatter is metadata, not text being edited')
})

test('typing lands in the file, with the frontmatter untouched', async t => {
  const original = dayText('2026-03-14', 'Hello.\n')
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: original })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(6), to: bp(6), insert: ' World.' }], 'user')
  await doc.flush()

  const onDisk = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.equal(onDisk, dayText('2026-03-14', 'Hello. World.\n'))
  assert.ok(onDisk.startsWith(original.slice(0, original.indexOf('---\n', 4) + 4)))
})

test('a hand-edited file with odd frontmatter round-trips byte for byte', async t => {
  // Splice, never serialise: rewriting from a parsed model reformats silently
  // and turns every save into a diff against itself.
  const odd = '---\ntephra:   1\ndate: 2026-03-14\nauthor: someone\n#  note\n---\nbody\n'
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: odd })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(4), to: bp(4), insert: '!' }], 'user')
  await doc.flush()
  const onDisk = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.equal(onDisk, '---\ntephra:   1\ndate: 2026-03-14\nauthor: someone\n#  note\n---\nbody!\n')
})

test('a file whose frontmatter cannot be parsed is never rewritten', async t => {
  const broken = '---\nnested:\n  - cannot round-trip\n---\nbody\n'
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: broken })
  const w = await windowOver(doc, DAY)
  await assert.rejects(() => w.edit([{ from: bp(0), to: bp(0), insert: 'x' }], 'user'), /could not be parsed/)
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), broken)
})

test('a day with no file yet is writable, and the file appears on flush', async t => {
  const { doc, root } = await fixture(t)
  const w = await windowOver(doc, DAY)
  assert.equal(w.text, '')
  await w.edit([{ from: bp(0), to: bp(0), insert: 'First words.\n' }], 'user')
  await doc.flush()
  const onDisk = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.match(onDisk, /^---\ntephra: 1\ndate: 2026-03-14\nkind: stream\n---\nFirst words\.\n$/)
})

test('generation advances on every change and positions carry it', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abc\n') })
  const w = await windowOver(doc, DAY)
  const before = doc.generation
  await w.edit([{ from: bp(0), to: bp(0), insert: 'x' }], 'user')
  assert.ok(doc.generation > before)
  assert.equal(w.toDocument(bp(0)).generation, doc.generation)
})

test('a stale position is refused rather than applied to moved text', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abcdef\n') })
  const w = await windowOver(doc, DAY)
  const stale = w.toDocument(bp(3))
  await w.edit([{ from: bp(0), to: bp(0), insert: 'XX' }], 'user')
  await assert.rejects(
    () => doc.replace([{ span: { begin: stale, end: stale }, payload: 'boom' }], 'operation'),
    /generation/,
  )
})

test('undo restores the text, and is non-destructive about generations', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(0), to: bp(8), insert: 'replaced' }], 'operation')
  assert.equal(w.text, 'replaced\n')

  const generationBeforeUndo = doc.generation
  await doc.undo()
  assert.equal(w.text, 'original\n')
  assert.ok(doc.generation > generationBeforeUndo, 'a rewind is itself a change, emitted forward')
})

test('redo puts it back', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(0), to: bp(8), insert: 'replaced' }], 'operation')
  await doc.undo()
  await doc.redo()
  assert.equal(w.text, 'replaced\n')
})

test('a typed run is one undo step, not one per keystroke', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', '\n') })
  const w = await windowOver(doc, DAY)
  for (const [i, ch] of [...'hello'].entries()) {
    await w.edit([{ from: bp(i), to: bp(i), insert: ch }], 'user')
  }
  assert.equal(w.text, 'hello\n')
  await doc.undo()
  assert.equal(w.text, '\n', 'the whole run went back together')
})

test('an operation is its own undo step even among typing', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'x\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(1), to: bp(1), insert: 'y' }], 'user')
  await w.edit([{ from: bp(2), to: bp(2), insert: 'OP' }], 'operation')
  await doc.undo()
  assert.equal(w.text, 'xy\n', 'only the operation came back')
})

test('spans are inferred from the text', async t => {
  const body = '# Title\n\n<!--tephra:mark idea-->prose <!--tephra:tag-start house-->tagged<!--tephra:tag-end house-->\n'
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', body) })
  const w = await windowOver(doc, DAY)
  assert.deepEqual(w.spans('heading').map(s => s.name), ['Title'])
  assert.deepEqual(w.spans('anchor').map(s => s.name), ['idea'])
  assert.deepEqual(w.spans('tag').map(s => s.name), ['house'])
})

test('an anchor resolves to a position, and travels when text is inserted above', async t => {
  const body = 'first\n<!--tephra:mark here-->second\n'
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', body) })
  const w = await windowOver(doc, DAY)
  const before = await doc.resolveAnchor('here')
  assert.ok(before !== null)
  await w.edit([{ from: bp(0), to: bp(0), insert: 'prepended\n' }], 'user')
  const after = await doc.resolveAnchor('here')
  assert.equal((after!.offset as number), (before!.offset as number) + 'prepended\n'.length)
})

test('a window spans several days as one continuous text', async t => {
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'day one\n'),
    [dayFile(NEXT)]: dayText('2026-03-15', 'day two\n'),
  })
  const w = await windowOver(doc, DAY, NEXT)
  assert.equal(w.text, 'day one\nday two\n')
})

test('an edit spanning midnight is written correctly to both files', async t => {
  // components.md names this as an acceptance criterion for the windowed
  // document, and getting it wrong writes half an edit to the wrong day.
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'aaaa\n'),
    [dayFile(NEXT)]: dayText('2026-03-15', 'bbbb\n'),
  })
  const w = await windowOver(doc, DAY, NEXT)
  assert.equal(w.text, 'aaaa\nbbbb\n')

  // Delete from the middle of day one through the middle of day two.
  await w.edit([{ from: bp(2), to: bp(7), insert: '' }], 'user')
  await doc.flush()

  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), dayText('2026-03-14', 'aa'))
  assert.equal(await readFile(join(root, dayFile(NEXT)), 'utf8'), dayText('2026-03-15', 'bb\n'))
  assert.equal(w.text, 'aabb\n')
})

test('a buffer position on a day boundary resolves to the later day', async t => {
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'aaaa\n'),
    [dayFile(NEXT)]: dayText('2026-03-15', 'bbbb\n'),
  })
  const w = await windowOver(doc, DAY, NEXT)
  // Offset 5 is both the end of day one and the start of day two. Day one ends
  // with a newline, so that offset renders at the first column of day two —
  // and text typed there must land in the file the reader can see it under.
  assert.equal(w.toDocument(bp(5)).segment, NEXT)
  assert.equal(w.toDocument(bp(5)).offset as number, 0)

  // The end of the window still belongs to the last day, which is what makes
  // appending to today work at all.
  assert.equal(w.toDocument(bp(w.text.length)).segment, NEXT)
  assert.equal(w.toDocument(bp(w.text.length)).offset as number, 5)
})

test('the window is not told about changes it originated', async t => {
  // Re-applying a change the editor has already made is exactly how text gets
  // duplicated.
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abc\n') })
  const w = await windowOver(doc, DAY)
  let echoes = 0
  w.onChanged(() => echoes++)
  await w.edit([{ from: bp(0), to: bp(0), insert: 'X' }], 'user')
  assert.equal(echoes, 0)
  assert.equal(w.text, 'Xabc\n')
})

test('a change from elsewhere does reach the window', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abc\n') })
  const w = await windowOver(doc, DAY)
  let seen = 0
  w.onChanged(() => seen++)
  const at = doc.positionAt(DAY, 0)
  await doc.replace([{ span: { begin: at, end: at }, payload: 'Z' }], 'operation')
  assert.equal(seen, 1)
  assert.equal(w.text, 'Zabc\n')
})

test('flush writes only the days that were touched', async t => {
  const { doc, nb, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'one\n'),
    [dayFile(NEXT)]: dayText('2026-03-15', 'two\n'),
  })
  const w = await windowOver(doc, DAY, NEXT)
  const untouchedBefore = await nb.read(dayFile(NEXT))
  await w.edit([{ from: bp(0), to: bp(0), insert: 'X' }], 'user')
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(NEXT)), 'utf8'), untouchedBefore)
})
