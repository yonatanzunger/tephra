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

// REGRESSION. Redo of a grouped typing run replayed the entry's original
// forward edits, which after an undo point into a state that no longer exists —
// and for a grouped run describe only the last keystroke, because `#push`
// merges the `inverse` maps but keeps the newest `change`. In the app it threw
// `span 141..141 outside text of 135`. The old redo test passed throughout,
// because it uses a single `operation` edit and operations never group: the one
// shape a person actually produces was the one shape untested.
test('redo puts back a grouped typing run', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'start\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(5), to: bp(5), insert: ' one' }], 'user')
  await w.edit([{ from: bp(9), to: bp(9), insert: ' two' }], 'user')
  assert.equal(w.text, 'start one two\n')

  await doc.undo()
  assert.equal(w.text, 'start\n', 'undo of a grouped run is correct')

  await doc.redo()
  assert.equal(w.text, 'start one two\n', 'and redo should put the whole run back')
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

test('extend earlier prepends, as an ordinary change rather than a reset', async t => {
  // A prepend arriving as an insertion at offset zero is what lets the editor
  // map the cursor and scroll through it. Replacing the whole document would
  // throw both away — the fiddly part of every upward-infinite-scroll.
  const { doc } = await fixture(t, {
    [dayFile(d('2026-03-12'))]: dayText('2026-03-12', 'oldest\n'),
    [dayFile(d('2026-03-13'))]: dayText('2026-03-13', 'middle\n'),
    [dayFile(DAY)]: dayText('2026-03-14', 'newest\n'),
  })
  const w = (await windowOver(doc, DAY)) as never as {
    text: string
    onChanged(h: (edits: readonly { from: number; to: number; insert: string }[], o: string) => void): () => void
    extend(direction: 'earlier' | 'later', chars?: number): Promise<void>
    readonly boundaries: { earlier: boolean; later: boolean }
  }
  assert.equal(w.text, 'newest\n')
  assert.deepEqual(w.boundaries, { earlier: true, later: false })

  const seen: { from: number; insert: string }[] = []
  w.onChanged(edits => seen.push(...edits.map(e => ({ from: e.from, insert: e.insert }))))

  await w.extend('earlier', 1)
  assert.equal(w.text, 'middle\nnewest\n')
  assert.deepEqual(seen, [{ from: 0, insert: 'middle\n' }], 'an insertion at zero, not a wholesale replace')

  await w.extend('earlier', 1)
  assert.equal(w.text, 'oldest\nmiddle\nnewest\n')
  assert.deepEqual(w.boundaries, { earlier: false, later: false })
})

test('extend gathers whole days until the character budget is met', async t => {
  const { doc } = await fixture(t, {
    [dayFile(d('2026-03-11'))]: dayText('2026-03-11', 'a'.repeat(50) + '\n'),
    [dayFile(d('2026-03-12'))]: dayText('2026-03-12', 'b'.repeat(50) + '\n'),
    [dayFile(d('2026-03-13'))]: dayText('2026-03-13', 'c'.repeat(50) + '\n'),
    [dayFile(DAY)]: dayText('2026-03-14', 'today\n'),
  })
  const w = (await windowOver(doc, DAY)) as never as { text: string; extend(d: 'earlier', c?: number): Promise<void> }
  await w.extend('earlier', 80) // two days' worth, so two days load
  assert.equal(w.text.length, 'today\n'.length + 102)
})

test('extend at the end of the corpus is a no-op, not an error', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'only\n') })
  const w = (await windowOver(doc, DAY)) as never as { text: string; extend(d: 'earlier'): Promise<void> }
  await w.extend('earlier')
  assert.equal(w.text, 'only\n')
})

test('typing at the end of the window goes to the last day, not the one before', async t => {
  // The failure this caught: at a boundary both segments matched, the payload
  // went to the earlier one, and text typed with the caret visibly at the start
  // of today was written into yesterday's file.
  const { doc, root } = await fixture(t, {
    [dayFile(d('2026-03-13'))]: dayText('2026-03-13', 'yesterday\n'),
    [dayFile(DAY)]: dayText('2026-03-14', ''),
  })
  const w = await windowOver(doc, d('2026-03-13'), DAY)
  assert.equal(w.text, 'yesterday\n')

  // The very end of the buffer is also the boundary, since today is empty.
  await w.edit([{ from: bp(w.text.length), to: bp(w.text.length), insert: 'today!\n' }], 'user')
  await doc.flush()

  assert.equal(await readFile(join(root, dayFile(d('2026-03-13'))), 'utf8'), dayText('2026-03-13', 'yesterday\n'))
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), dayText('2026-03-14', 'today!\n'))
})

test('a hand-edit to a clean day is adopted, as an ordinary external change', async t => {
  // Hand-editing is a feature, so this needs no ceremony: reload, emit, and let
  // the editor map its cursor through it like any other edit.
  const { doc, root, nb } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)
  const seen: string[] = []
  w.onChanged((_edits, origin) => seen.push(origin))

  await writeFile(join(root, dayFile(DAY)), dayText('2026-03-14', 'edited by hand\n'))
  await doc.externalChanged(dayFile(DAY))

  assert.equal(w.text, 'edited by hand\n')
  assert.deepEqual(seen, ['external'])
  void nb
})

test('a hand-edit onto unsaved edits diverges, and NOTHING is overwritten', async t => {
  // The one case where both automatic answers lose something: our write
  // destroys their hand-edit, their reload destroys our typing. D12 asks for
  // correct, visible and recoverable rather than seamless.
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)

  const divergences: string[] = []
  doc.onDiverged(d => divergences.push(d.date))

  await w.edit([{ from: bp(0), to: bp(0), insert: 'MINE ' }], 'user') // now dirty
  await writeFile(join(root, dayFile(DAY)), dayText('2026-03-14', 'THEIRS\n'))
  await doc.externalChanged(dayFile(DAY))

  assert.deepEqual(divergences, [DAY], 'the divergence was surfaced')

  // Their file is untouched by us...
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), dayText('2026-03-14', 'THEIRS\n'))
  // ...and our text is still in the buffer, not silently discarded.
  assert.equal(w.text, 'MINE original\n')
})

test('a diverged day refuses further writes rather than failing quietly', async t => {
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: bp(0), to: bp(0), insert: 'MINE ' }], 'user')
  await writeFile(join(root, dayFile(DAY)), dayText('2026-03-14', 'THEIRS\n'))
  await doc.externalChanged(dayFile(DAY))

  await assert.rejects(
    () => w.edit([{ from: bp(0), to: bp(0), insert: 'more' }], 'user'),
    /changed on disk/,
  )
})

// ── tagging (M2.2) ───────────────────────────────────────────
//
// The interval arithmetic itself is pinned down in tag-edits.test.ts. What can
// only be tested here is what the document adds on top: that a range crossing
// midnight becomes one span per day and still one undo step, and that the
// markers reach the files.

test('tagging writes markers into the day file', async t => {
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The house deal closed on Tuesday.\n'),
  })
  await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  const body = 'The house deal closed on Tuesday.\n'
  const from = body.indexOf('house deal')
  await doc.tag(
    { begin: doc.positionAt(DAY, from), end: doc.positionAt(DAY, from + 'house deal'.length) },
    'House Deal',
  )
  await doc.flush()

  const written = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.match(written, /<!--tephra:tag-start House Deal-->house deal<!--tephra:tag-end House Deal-->/)
  assert.deepEqual((await doc.spans('tag')).map(s => s.name), ['House Deal'])
})

test('untagging puts the file back exactly as it was', async t => {
  const original = dayText('2026-03-14', 'The house deal closed on Tuesday.\n')
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: original })
  await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  const span = { begin: doc.positionAt(DAY, 4), end: doc.positionAt(DAY, 14) }
  await doc.tag(span, 'House Deal')

  // Positions are stamped with a generation, so the span from before the tag
  // is stale by construction (D11) — which is the point. Ask again.
  const after = { begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 60) }
  await doc.untag(after, 'house deal') // and by the other capitalisation
  await doc.flush()

  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), original)
  assert.deepEqual(await doc.spans('tag'), [])
})

test('a range crossing midnight tags both days, and undoes in one step', async t => {
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'Tuesday evening thoughts.\n'),
    [dayFile(NEXT)]: dayText('2026-03-15', 'Wednesday morning thoughts.\n'),
  })
  await windowOver(doc, DAY, NEXT)
  const before = doc.currentGeneration()
  await doc.tag({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(NEXT, 26) }, 'overnight')

  const tags = await doc.spans('tag')
  assert.equal(tags.length, 2, 'one span per day: markers cannot pair across files')
  assert.deepEqual([...new Set(tags.map(s => s.name))], ['overnight'])

  await doc.undo()
  assert.deepEqual(await doc.spans('tag'), [], 'one operation, one undo')
  assert.equal(doc.currentGeneration() > before, true)
})

test('tagging text that already carries the subject is not an undo step', async t => {
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The house deal closed on Tuesday.\n'),
  })
  const w = await windowOver(doc, DAY)
  await doc.tag({ begin: doc.positionAt(DAY, 4), end: doc.positionAt(DAY, 14) }, 'House Deal')

  // Offsets are read off the window rather than counted by hand: once markers
  // are in the body, the text has moved, which is the whole reason positions
  // carry a generation.
  const reach = (text: string) => {
    const from = w.text.indexOf(text)
    assert.notEqual(from, -1, `"${text}" is not in the window`)
    return { begin: w.toDocument(bp(from)), end: w.toDocument(bp(from + text.length)) }
  }

  const settled = doc.currentGeneration()
  await doc.tag(reach('Tuesday'), 'House Deal')
  assert.notEqual(doc.currentGeneration(), settled, 'a second span IS a change')
  assert.equal((await doc.spans('tag')).length, 2)

  const now = doc.currentGeneration()
  await doc.tag(reach('Tuesday'), 'House Deal')
  assert.equal(doc.currentGeneration(), now, 'the same tag twice changes nothing')
})

// ── branching (M2.3) ─────────────────────────────────────────

test('branching creates the file, then leaves a link where the text was', async t => {
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText(
      '2026-03-14',
      'Before.\n\nThe long argument about titration curves, which deserves its own\nplace to live.\n\nAfter.\n',
    ),
  })
  const w = await windowOver(doc, DAY)
  const text = 'The long argument about titration curves, which deserves its own\nplace to live.'
  const from = w.text.indexOf(text)
  const id = await doc.branch(
    { begin: w.toDocument(bp(from)), end: w.toDocument(bp(from + text.length)) },
    'Titration curves',
  )
  await doc.flush()

  assert.equal(id, 'notes/titration-curves.md')
  const branched = await readFile(join(root, 'notes/titration-curves.md'), 'utf8')
  assert.match(branched, /^---\ntephra: 1\nkind: markdown\ntitle: Titration curves\n---\n/)
  assert.match(branched, /The long argument about titration curves/)
  assert.doesNotMatch(branched, /^date:/m, 'a branched file is not in the dated stream (D27)')

  const stream = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.match(stream, /\[Titration curves\]\(\.\.\/\.\.\/\.\.\/notes\/titration-curves\.md\)/)
  assert.doesNotMatch(stream, /deserves its own/, 'the text moved; it was not copied')
  assert.match(stream, /Before\./)
  assert.match(stream, /After\./)
})

test('branching twice under one name does not overwrite the first', async t => {
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'One thought here.\n\nAnother thought here.\n'),
  })
  const w = await windowOver(doc, DAY)
  const reach = (text: string) => {
    const from = w.text.indexOf(text)
    assert.notEqual(from, -1, `"${text}" is not in the window`)
    return { begin: w.toDocument(bp(from)), end: w.toDocument(bp(from + text.length)) }
  }
  await doc.branch(reach('One thought here.'), 'Thoughts')
  const second = await doc.branch(reach('Another thought here.'), 'Thoughts')
  await doc.flush()

  assert.equal(second, 'notes/thoughts-2.md')
  assert.match(await readFile(join(root, 'notes/thoughts.md'), 'utf8'), /One thought here\./)
  assert.match(await readFile(join(root, 'notes/thoughts-2.md'), 'utf8'), /Another thought here\./)
})

test('branching is one undo step, and undo leaves the file rather than the hole', async t => {
  const original = dayText('2026-03-14', 'Keep this.\n\nMove that.\n')
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: original })
  const w = await windowOver(doc, DAY)
  const from = w.text.indexOf('Move that.')
  await doc.branch({ begin: w.toDocument(bp(from)), end: w.toDocument(bp(from + 10)) }, 'That')
  await doc.undo()
  await doc.flush()

  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), original, 'the stream is back')
  // D13's ordering deliberately prefers duplicated content over lost content,
  // and undoing into that state is the same trade: the branched file stays.
  assert.equal(await readFile(join(root, 'notes/that.md'), 'utf8') !== '', true)
})
