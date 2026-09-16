// The Document over real day files. Integration rather than unit: it crosses X
// and W, and the properties worth pinning down are about what lands on disk.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/documents/kinds/stream.ts'
import { Corpus } from '../../src/main/x/documents/corpus.ts'
import { STREAM_ID } from '../../src/shared/document-api.ts'
import { dayFile, resolveInsideNotebook } from '../../src/main/w/layout.ts'
import type { WindowPosition, DateKey, DocumentWindow } from '../../src/shared/document-api.ts'
import { pt, rt } from '../support/text.ts'

const d = (s: string): DateKey => s as DateKey
const wp = (n: number): WindowPosition => n as WindowPosition
const DAY = d('2026-03-14')
const NEXT = d('2026-03-15')

async function fixture(t: TestContext, files: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-doc-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(root, rel, '..'), { recursive: true })
    await writeFile(join(root, rel), text)
  }
  // Through the Corpus, which is how the app builds every document — and the
  // only thing that can hand one a way to create another, which `branch` needs
  // (MC7).
  const corpus = new Corpus(nb)
  const doc = (await corpus.use(STREAM_ID, async d => d)) as StreamDocument
  t.after(() => nb.close())
  return { nb, doc, corpus, root }
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
  await w.edit([{ from: wp(6), to: wp(6), insert: pt(' World.') }], 'user')
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
  await w.edit([{ from: wp(4), to: wp(4), insert: pt('!') }], 'user')
  await doc.flush()
  const onDisk = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.equal(onDisk, '---\ntephra:   1\ndate: 2026-03-14\nauthor: someone\n#  note\n---\nbody!\n')
})

test('a file whose frontmatter cannot be parsed is never rewritten', async t => {
  const broken = '---\nnested:\n  - cannot round-trip\n---\nbody\n'
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: broken })
  const w = await windowOver(doc, DAY)
  await assert.rejects(() => w.edit([{ from: wp(0), to: wp(0), insert: pt('x') }], 'user'), /could not be parsed/)
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), broken)
})

test('a day with no file yet is writable, and the file appears on flush', async t => {
  const { doc, root } = await fixture(t)
  const w = await windowOver(doc, DAY)
  assert.equal(w.text, '')
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('First words.\n') }], 'user')
  await doc.flush()
  const onDisk = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.match(onDisk, /^---\ntephra: 1\ndate: 2026-03-14\nkind: stream\n---\nFirst words\.\n$/)
})

test('generation advances on every change and positions carry it', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abc\n') })
  const w = await windowOver(doc, DAY)
  const before = doc.generation
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('x') }], 'user')
  assert.ok(doc.generation > before)
  assert.equal(w.toDocument(wp(0)).generation, doc.generation)
})

test('a stale position is refused rather than applied to moved text', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abcdef\n') })
  const w = await windowOver(doc, DAY)
  const stale = w.toDocument(wp(3))
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('XX') }], 'user')
  await assert.rejects(
    () => doc.replace([{ span: { begin: stale, end: stale }, payload: rt('boom') }], 'operation'),
    /generation/,
  )
})

test('undo restores the text, and is non-destructive about generations', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: wp(0), to: wp(8), insert: pt('replaced') }], 'operation')
  assert.equal(w.text, 'replaced\n')

  const generationBeforeUndo = doc.generation
  await doc.undo()
  assert.equal(w.text, 'original\n')
  assert.ok(doc.generation > generationBeforeUndo, 'a rewind is itself a change, emitted forward')
})

test('redo puts it back', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'original\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: wp(0), to: wp(8), insert: pt('replaced') }], 'operation')
  await doc.undo()
  await doc.redo()
  assert.equal(w.text, 'replaced\n')
})

test('a typed run is one undo step, not one per keystroke', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', '\n') })
  const w = await windowOver(doc, DAY)
  for (const [i, ch] of [...'hello'].entries()) {
    await w.edit([{ from: wp(i), to: wp(i), insert: pt(ch) }], 'user')
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
  await w.edit([{ from: wp(5), to: wp(5), insert: pt(' one') }], 'user')
  await w.edit([{ from: wp(9), to: wp(9), insert: pt(' two') }], 'user')
  assert.equal(w.text, 'start one two\n')

  await doc.undo()
  assert.equal(w.text, 'start\n', 'undo of a grouped run is correct')

  await doc.redo()
  assert.equal(w.text, 'start one two\n', 'and redo should put the whole run back')
})

test('an operation is its own undo step even among typing', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'x\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: wp(1), to: wp(1), insert: pt('y') }], 'user')
  await w.edit([{ from: wp(2), to: wp(2), insert: pt('OP') }], 'operation')
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
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('prepended\n') }], 'user')
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
  await w.edit([{ from: wp(2), to: wp(7), insert: pt('') }], 'user')
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
  // DocumentOffset 5 is both the end of day one and the start of day two. Day one ends
  // with a newline, so that offset renders at the first column of day two —
  // and text typed there must land in the file the reader can see it under.
  assert.equal(w.toDocument(wp(5)).segment, NEXT)
  assert.equal(w.toDocument(wp(5)).offset as number, 0)

  // The end of the window still belongs to the last day, which is what makes
  // appending to today work at all.
  assert.equal(w.toDocument(wp(w.text.length)).segment, NEXT)
  assert.equal(w.toDocument(wp(w.text.length)).offset as number, 5)
})

test('the window is not told about changes it originated', async t => {
  // Re-applying a change the editor has already made is exactly how text gets
  // duplicated.
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abc\n') })
  const w = await windowOver(doc, DAY)
  let echoes = 0
  w.onChanged(() => echoes++)
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('X') }], 'user')
  assert.equal(echoes, 0)
  assert.equal(w.text, 'Xabc\n')
})

test('a change from elsewhere does reach the window', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'abc\n') })
  const w = await windowOver(doc, DAY)
  let seen = 0
  w.onChanged(() => seen++)
  const at = doc.positionAt(DAY, 0)
  await doc.replace([{ span: { begin: at, end: at }, payload: rt('Z') }], 'operation')
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
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('X') }], 'user')
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
  await w.edit([{ from: wp(w.text.length), to: wp(w.text.length), insert: pt('today!\n') }], 'user')
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

  await w.edit([{ from: wp(0), to: wp(0), insert: pt('MINE ') }], 'user') // now dirty
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
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('MINE ') }], 'user')
  await writeFile(join(root, dayFile(DAY)), dayText('2026-03-14', 'THEIRS\n'))
  await doc.externalChanged(dayFile(DAY))

  await assert.rejects(
    () => w.edit([{ from: wp(0), to: wp(0), insert: pt('more') }], 'user'),
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
    return { begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + text.length)) }
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
    { begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + text.length)) },
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
    return { begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + text.length)) }
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
  await doc.branch({ begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 10)) }, 'That')
  await doc.undo()
  await doc.flush()

  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), original, 'the stream is back')
  // D13's ordering deliberately prefers duplicated content over lost content,
  // and undoing into that state is the same trade: the branched file stays.
  assert.equal(await readFile(join(root, 'notes/that.md'), 'utf8') !== '', true)
})

// ── markers are not text (D44) ───────────────────────────────
//
// Each of these is one of the faults that made markers-in-the-buffer
// untenable. They are written against a real window and a real file, because
// every one of them was a disagreement between what the editor held and what
// was on disk.

const TAGGED = dayText(
  '2026-03-14',
  'One two <!--tephra:tag-start subject-->three four five<!--tephra:tag-end subject--> six seven.\n',
)

test('the buffer holds prose: no marker syntax reaches the editor', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: TAGGED })
  const w = await windowOver(doc, DAY)
  assert.equal(w.text, `One two ${'￼'}three four five six seven.\n`)
  assert.equal(w.text.includes('tephra'), false, 'a copy of this buffer cannot carry a marker')
})

test('positions cross both ways, including inside a marker', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: TAGGED })
  const w = await windowOver(doc, DAY)
  for (let i = 0; i <= w.text.length; i++) {
    assert.equal(w.toWindow(w.toDocument(wp(i))), i, `buffer position ${i}`)
  }
  // A document position in the middle of the marker's bytes has no place of its
  // own in prose, so it lands on the handle.
  const insideMarker = TAGGED.indexOf('tag-start') + 3 - TAGGED.indexOf('One')
  assert.equal(w.toWindow(doc.positionAt(DAY, insideMarker)), w.text.indexOf('￼'))
})

test('deleting across the end of a range shrinks it instead of orphaning it', async t => {
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: TAGGED })
  const w = await windowOver(doc, DAY)
  // Sweep from inside the tag to past its end — the deletion contains the
  // `tag-end` marker's bytes. Left alone, the unmatched `tag-start` would run
  // to the end of the DAY, silently tagging everything after it.
  const from = w.text.indexOf('four')
  const to = w.text.indexOf('seven')
  await w.edit([{ from: wp(from), to: wp(to), insert: pt('') }], 'user')
  await doc.flush()

  const written = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.equal((written.match(/tag-start/g) ?? []).length, 1)
  assert.equal((written.match(/tag-end/g) ?? []).length, 1, 'the pair survived the deletion')
  const tags = await doc.spans('tag')
  assert.equal(tags.length, 1)
  // 'three', not 'three ': resolved spans are trimmed to the text they cover,
  // so a range never ends on the whitespace a deletion happened to leave.
  assert.equal(await tagged(doc, w), 'three', 'the range simply got shorter')
})

test('deleting the handle removes the whole tag, in one undo step', async t => {
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: TAGGED })
  const w = await windowOver(doc, DAY)
  const handle = w.text.indexOf('￼')

  // Backspace over the mark. Nothing here knows about a keymap: this is the
  // edit any keymap produces — a delete of one character, from wherever it came.
  await w.edit([{ from: wp(handle), to: wp(handle + 1), insert: pt('') }], 'user')
  await doc.flush()

  assert.deepEqual(await doc.spans('tag'), [], 'the tag is gone, not half gone')
  const written = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.equal(written.includes('tephra:tag'), false, 'and so are both markers')
  assert.match(written, /One two three four five six seven\./, 'the prose is untouched')

  await doc.undo()
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), TAGGED, 'one operation, one undo')
})

test('typing at the trailing boundary extends the range', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: TAGGED })
  const w = await windowOver(doc, DAY)
  const end = w.text.indexOf(' six')
  await w.edit([{ from: wp(end), to: wp(end), insert: pt(' and six') }], 'user')
  assert.equal(await tagged(doc, w), 'three four five and six')
})

test('a handle pasted in from outside is not written to the file', async t => {
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'Clean.\n') })
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: wp(0), to: wp(0), insert: pt(`pasted ￼ text `) }], 'user')
  await doc.flush()
  const written = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.equal(written.includes('￼'), false)
  assert.match(written, /pasted {2}text Clean\./)
})

/** The text a tag actually covers, with any marker syntax taken back out. */
async function tagged(doc: StreamDocument, w: DocumentWindow): Promise<string> {
  const span = (await doc.spans('tag'))[0]
  if (span === undefined) return ''
  const from = w.toWindow(span.span.begin)
  const to = w.toWindow(span.span.end)
  return w.text.slice(from as number, to as number).replace(/￼/g, '')
}

test('a day arriving through growth arrives as prose, not as bytes', async t => {
  // The bug this exists for: `extend` inserted the segment's BODY into a buffer
  // that holds prose, so every day loaded by growth showed raw
  // `<!--tephra:tag-start …-->` on screen. Growth is how a notebook with any
  // history at all gets loaded, so it appeared on opening and nowhere else —
  // and no test caught it because every extend test used days with no markers
  // in them.
  const { doc } = await fixture(t, {
    [dayFile(d('2026-03-12'))]: dayText(
      '2026-03-12',
      'Older day, <!--tephra:tag-start subject-->already tagged<!--tephra:tag-end subject--> before.\n',
    ),
    [dayFile(DAY)]: dayText('2026-03-14', 'Today.\n'),
  })
  const w = await windowOver(doc, DAY)
  const arrived: string[] = []
  w.onChanged(edits => arrived.push(...edits.map(e => e.insert)))

  await w.extend('earlier')

  assert.equal(w.text.includes('tephra:'), false, `raw syntax in the buffer: ${w.text}`)
  assert.equal(
    arrived.some(insert => insert.includes('tephra:')),
    false,
    'the editor was handed marker syntax to insert',
  )
  assert.match(w.text, /Older day, ￼already tagged before\./)

  // And the spans that came with it still land on the right words.
  const tag = (await doc.spans('tag'))[0]
  assert.notEqual(tag, undefined)
  const from = w.toWindow(tag!.span.begin) as number
  const to = w.toWindow(tag!.span.end) as number
  assert.equal(w.text.slice(from, to), 'already tagged')
})

// ── what the mark's popover does (MB.4, MB.5) ────────────────

test('removing a bookmark takes its marker and nothing else', async t => {
  const original = dayText('2026-03-14', 'A passage <!--tephra:mark keep-this-->worth marking.\n')
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: original })
  await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  assert.equal((await doc.spans('anchor')).length, 1)

  await doc.removeAnchor('keep-this')
  await doc.flush()

  assert.deepEqual(await doc.spans('anchor'), [])
  assert.equal(
    await readFile(join(root, dayFile(DAY)), 'utf8'),
    dayText('2026-03-14', 'A passage worth marking.\n'),
  )
})

test('removing a bookmark that is not there does nothing, loudly or otherwise', async t => {
  const original = dayText('2026-03-14', 'Nothing marked.\n')
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: original })
  await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  await doc.removeAnchor('absent')
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), original)
})

test('renaming a span changes that passage and leaves the others alone', async t => {
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The house closed. A separate mention of the house.\n'),
  })
  const w = await windowOver(doc, DAY)
  const reach = (text: string) => {
    const from = w.text.indexOf(text)
    assert.notEqual(from, -1, `"${text}" is not in the window`)
    return { begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + text.length)) }
  }
  await doc.tag(reach('The house closed'), 'House Deal')
  await doc.tag(reach('separate mention of the house'), 'House Deal')
  assert.equal((await doc.spans('tag')).length, 2)

  // Rename only the first of them.
  const first = (await doc.spans('tag'))[0]!
  const before = doc.currentGeneration()
  await doc.renameTag(first.span, 'House Deal', 'Mortgage')

  const after = (await doc.spans('tag')).map(s => s.name).sort()
  assert.deepEqual(after, ['House Deal', 'Mortgage'], 'one span moved, one did not')
  assert.equal(doc.currentGeneration(), before + 1, 'one operation, one undo step')

  // And what each covers is unchanged.
  const spans = await doc.spans('tag')
  const covered = (name: string) => {
    const span = spans.find(s => s.name === name)!
    return w.text.slice(w.toWindow(span.span.begin) as number, w.toWindow(span.span.end) as number)
  }
  assert.equal(covered('Mortgage'), 'The house closed')
  assert.equal(covered('House Deal'), 'separate mention of the house')
})

test('renaming a span to what it is already called is not a change', async t => {
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The house closed.\n'),
  })
  const w = await windowOver(doc, DAY)
  const from = w.text.indexOf('house')
  await doc.tag({ begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 5)) }, 'House Deal')
  const settled = doc.currentGeneration()
  const span = (await doc.spans('tag'))[0]!
  await doc.renameTag(span.span, 'House Deal', 'house  deal')
  assert.equal(doc.currentGeneration(), settled, 'the same subject, differently typed, is the same subject')
})

test('a change that alters no prose is still announced', async t => {
  // Renaming a span rewrites marker NAMES, which are invisible in prose: same
  // handle, same character, identical buffer. The announcement used to be
  // skipped when the prose diff came back null, so the file was right and the
  // renderer went on showing the old subject — visible by clicking its mark.
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The house closed on Tuesday.\n'),
  })
  const w = await windowOver(doc, DAY)
  const from = w.text.indexOf('house')
  await doc.tag({ begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 5)) }, 'House Deal')

  const announcements: number[] = []
  w.onChanged(edits => announcements.push(edits.length))
  const before = w.text

  const span = (await doc.spans('tag'))[0]!
  await doc.renameTag(span.span, 'House Deal', 'Mortgage')

  assert.equal(w.text, before, 'the prose is untouched — that is the point')
  assert.deepEqual(announcements, [0], 'announced once, carrying no edits')
  assert.deepEqual((await doc.spans('tag')).map(s => s.name), ['Mortgage'])
})

// ── comments (M2.6, D47) ─────────────────────────────────────

/** A window's prose, and the file's bytes, are different things here. */
async function commented(t: TestContext) {
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The premise is stated here.\n\nAnd the day continues.\n'),
  })
  const w = await windowOver(doc, DAY)
  const from = w.text.indexOf('premise is stated')
  const span = { begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 17)) }
  return { doc, root, w, span }
}

const fileOf = async (root: string) => readFile(join(root, dayFile(DAY)), 'utf8')

/**
 * The byline's instant, supplied rather than read from the clock.
 *
 * **Which is the whole point of it being a parameter.** The document layer used
 * to stamp `new Date().toISOString().slice(0, 16)` — the wall clock, in UTC — so
 * a comment written at 18:30 in a Los Angeles notebook was written down as
 * `2026-09-14T01:30`, and no test could assert on the value at all. Now it can.
 */
const AT = '2026-03-10T14:07'

test('a comment anchors a range and writes a thread into the file', async t => {
  const { doc, root, w, span } = await commented(t)
  const id = await doc.startComment(span, 'This assumes the reader accepts it.', AT)
  await doc.flush()

  const file = await fileOf(root)
  assert.match(file, new RegExp(`<!--tephra:comment-start ${id}-->`))
  assert.match(file, new RegExp(`<!--tephra:comment-end ${id}-->`))
  assert.match(file, new RegExp(`> \\*\\*.+\\*\\* ${AT} <!--tephra:comment`))
  assert.match(file, /> This assumes the reader accepts it\./)

  // The gloss sits after the paragraph it is about, so a plain reader gets
  // passage-then-gloss with no tooling at all.
  assert.ok(file.indexOf('> This assumes') > file.indexOf('The premise'))
  assert.ok(file.indexOf('> This assumes') < file.indexOf('And the day continues'))
})

test('the body is NOT in the buffer, and the prose is otherwise untouched', async t => {
  const { doc, w, span } = await commented(t)
  await doc.startComment(span, 'A note that must not appear in the text.', AT)
  assert.equal(w.text.includes('A note that must not appear'), false, 'the body reached the buffer')
  assert.equal(w.text.includes('tephra:'), false)
  // One handle for the anchor's start; the end and the whole block are silent.
  assert.equal([...w.text].filter(c => c === '￼').length, 1)
  assert.match(w.text, /The ￼?premise is stated here\.\n\nAnd the day continues\./)
})

test('a thread reads back with its author, time and body', async t => {
  const { doc, span } = await commented(t)
  const id = await doc.startComment(span, 'First thought.', AT)
  await doc.addComment(id, 'Second thought.', AT)

  const threads = await doc.comments()
  assert.equal(threads.length, 1)
  const thread = threads[0]!
  assert.equal(thread.id, id)
  assert.equal(thread.resolved, false)
  assert.deepEqual(thread.messages.map(m => m.body), ['First thought.', 'Second thought.'])
  assert.ok(thread.messages.every(m => m.author !== ''))
  // **The instant it was given, exactly** — not the shape of one. This could
  // only be a pattern while the stamp came from the wall clock.
  assert.deepEqual(thread.messages.map(m => m.at), [AT, AT])
})

test('editing a message changes that message and nothing else', async t => {
  const { doc, span } = await commented(t)
  const id = await doc.startComment(span, 'First thought.', AT)
  await doc.addComment(id, 'Second thought.', AT)
  const before = doc.currentGeneration()

  await doc.editComment(id, 0, 'First thought, reconsidered.')
  assert.equal(doc.currentGeneration(), before + 1, 'one operation, one undo step')
  assert.deepEqual(
    (await doc.comments())[0]!.messages.map(m => m.body),
    ['First thought, reconsidered.', 'Second thought.'],
  )
})

test('resolving and assigning live on the thread, not on every message', async t => {
  const { doc, root, span } = await commented(t)
  const id = await doc.startComment(span, 'A question.', AT)
  await doc.addComment(id, 'An answer.', AT)
  await doc.setCommentResolved(id, true)
  await doc.setCommentAssignee(id, 'Rivka')
  await doc.flush()

  const thread = (await doc.comments())[0]!
  assert.equal(thread.resolved, true)
  assert.equal(thread.assignee, 'Rivka')
  const file = await fileOf(root)
  assert.equal((file.match(/resolved/g) ?? []).length, 1, 'state is written once, on the first block')
  assert.equal((file.match(/→ \*\*Rivka\*\*/g) ?? []).length, 1)

  // And the span says so, which is what lets the editor collapse it.
  const span2 = (await doc.spans('comment'))[0]!
  assert.equal(span2.kind === 'comment' && span2.resolved, true)
})

test('reactions keep the order they were first used in', async t => {
  const { doc, span } = await commented(t)
  const id = await doc.startComment(span, 'A thought.', AT)
  for (const emoji of ['🎉', '👀', '👍']) await doc.reactToComment(id, 0, emoji, true)

  const reactions = (await doc.comments())[0]!.messages[0]!.reactions
  assert.deepEqual(Object.keys(reactions), ['🎉', '👀', '👍'], 'three in a row are a sentence')

  // Removing the middle one leaves the others where they were.
  await doc.reactToComment(id, 0, '👀', false)
  assert.deepEqual(Object.keys((await doc.comments())[0]!.messages[0]!.reactions), ['🎉', '👍'])
})

test('removing the last message removes the thread, anchors included', async t => {
  const original = dayText('2026-03-14', 'The premise is stated here.\n\nAnd the day continues.\n')
  const { doc, root, span } = await commented(t)
  const id = await doc.startComment(span, 'A thought.', AT)
  await doc.addComment(id, 'Another.', AT)

  await doc.deleteComment(id, 1)
  assert.equal((await doc.comments())[0]!.messages.length, 1, 'the thread survives its second message')
  assert.equal((await doc.spans('comment')).length, 1, 'and keeps its anchor')

  await doc.deleteComment(id, 0)
  await doc.flush()
  assert.deepEqual(await doc.comments(), [], 'a thread with no messages is not a thread')
  assert.deepEqual(await doc.spans('comment'), [])
  assert.equal(await fileOf(root), original, 'the file is exactly as it started')
})

test('deleting the first message carries the thread state to the next', async t => {
  const { doc, span } = await commented(t)
  const id = await doc.startComment(span, 'First.', AT)
  await doc.addComment(id, 'Second.', AT)
  await doc.setCommentResolved(id, true)

  await doc.deleteComment(id, 0)
  const thread = (await doc.comments())[0]!
  assert.deepEqual(thread.messages.map(m => m.body), ['Second.'])
  assert.equal(thread.resolved, true, 'state lived on the block that just left')
})

test('two callers asking for the same day get the same object', async t => {
  // The bug this exists for, which cost an evening: `segment()` checked the
  // cache and filled it on either side of an `await`, so two callers arriving
  // in that window each built a Segment and the second overwrote the first.
  // Whoever held the first then had an orphan — a window rebuilding from an
  // object the document had stopped mutating. About one run in five, a comment
  // reached the file, the announcement fired, and the editor never changed.
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'A day.\n') })
  const [a, b, c] = await Promise.all([doc.segment(DAY), doc.segment(DAY), doc.segment(DAY)])
  assert.equal(a, b, 'two concurrent loads produced two objects')
  assert.equal(b, c)
  assert.equal(await doc.segment(DAY), a, 'and the cache holds that same one')
})

test('a window built during a concurrent load still sees later edits', async t => {
  // The symptom, rather than the mechanism: whatever the window is holding has
  // to be the thing the document edits.
  const { doc } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'The premise is stated here.\n'),
  })
  // Open the window while other work asks for the same day, which is what
  // startup does: growth, the anomaly scan and the margin all arrive at once.
  const [w] = await Promise.all([
    windowOver(doc, DAY),
    doc.comments(),
    doc.spans('tag'),
    doc.segment(DAY),
  ])
  const before = w.text
  const from = w.text.indexOf('premise')
  await doc.startComment(
    { begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 7)) },
    'A note.',
    AT,
  )

  assert.notEqual(w.text, before, 'the window is rebuilding from an orphan')
  assert.equal([...w.text].filter(ch => ch === '￼').length, 1, 'the handle should have arrived')
})

// ── import (M2.7, R28) ───────────────────────────────────────

test('importing keeps the original untouched and gives you a copy to write on', async t => {
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'Before.\n\nAfter.\n'),
  })
  const w = await windowOver(doc, DAY)
  const html = '<p>The <b>hold-up problem</b> of Klein, Crawford and Alchian.</p>'
  const text = 'The hold-up problem of Klein, Crawford and Alchian.'

  const at = doc.positionAt(DAY, w.text.indexOf('After.'))
  const rel = await doc.importText(at, text, { content: html, ext: 'html' })
  await doc.flush()

  // The artifact worth citing is the bytes that arrived, byte for byte.
  assert.match(rel, /^attachments\/2026\/03\/2026-03-14-clipboard-[0-9a-f]{6}\.html$/)
  assert.equal(await readFile(join(root, rel), 'utf8'), html)

  // And what landed in the day is ordinary prose with a provenance line.
  const file = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.match(file, /\*Imported 2026-03-14 from \[the clipboard\]\(\.\.\/\.\.\/\.\.\/attachments\//)
  assert.match(file, /The hold-up problem of Klein, Crawford and Alchian\./)
  assert.match(file, /Before\./)
  assert.match(file, /After\./)
})

test('the imported copy is annotatable like anything else', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'A day.\n') })
  const w = await windowOver(doc, DAY)
  await doc.importText(doc.positionAt(DAY, 0), 'An imported passage worth tagging.', {
    content: 'An imported passage worth tagging.',
    ext: 'txt',
  })

  // No special case: the same gesture that tags anything tags this.
  const from = w.text.indexOf('imported passage')
  await doc.tag({ begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 16)) }, 'sources')
  assert.deepEqual((await doc.spans('tag')).map(s => s.name), ['sources'])
})

test('the link in the provenance line resolves inside the notebook', async t => {
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'A day.\n') })
  const rel = await doc.importText(doc.positionAt(DAY, 0), 'Some text.', {
    content: 'Some text.',
    ext: 'txt',
  })
  await doc.flush()
  const file = await readFile(join(root, dayFile(DAY)), 'utf8')
  const target = /\]\(([^)]+)\)/.exec(file)?.[1] as string
  assert.equal(resolveInsideNotebook(root, target), rel, 'the link does not lead where it says')
})

test('importing nothing is refused rather than writing an empty attachment', async t => {
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'A day.\n') })
  await assert.rejects(
    () => doc.importText(doc.positionAt(DAY, 0), '   ', { content: '', ext: 'txt' }),
    /nothing to import/,
  )
})

test('two whole-paragraph edits in quick succession still undo', async t => {
  // Found by the restore tests, latent since M0. Adjacent user edits are
  // grouped into one undo step, and the merge CONCATENATED the two inverses
  // into a single batch — but they are expressed against different texts, so
  // the batch overlapped itself and undo threw instead of undoing. Typing never
  // hit it, because appending characters produces inverses that do not overlap.
  const { doc } = await fixture(t, { [dayFile(DAY)]: dayText('2026-03-14', 'First.\n') })
  const whole = async (body: string): Promise<void> => {
    const segment = await doc.segment(DAY)
    await doc.replace(
      [
        {
          span: { begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, segment.length) },
          payload: rt(body),
        },
      ],
      'user',
    )
  }

  await whole('Second.\n')
  await whole('Third.\n')
  assert.equal((await doc.segment(DAY)).body, 'Third.\n')

  // One step, because the two were grouped — and it goes all the way back.
  assert.notEqual(await doc.undo(), null)
  assert.equal((await doc.segment(DAY)).body, 'First.\n')
})

test('a day with nothing in it is not written, and one that empties is removed', async t => {
  // Opening the app creates a segment for today whether or not anything is
  // written. Writing that out leaves a file of pure frontmatter, which reads
  // back as a real day, draws its own seam in the stream, and accumulates one
  // per day the notebook was merely opened.
  const { doc, root } = await fixture(t)
  await doc.segment(DAY) // as opening does
  await doc.flush()
  assert.equal(existsSync(join(root, dayFile(DAY))), false, 'an untouched day should leave no file')

  // Written once there is something to write.
  const w = await windowOver(doc, DAY)
  await w.edit([{ from: wp(0), to: wp(0), insert: pt('Something.\n') }], 'user')
  await doc.flush()
  assert.equal(existsSync(join(root, dayFile(DAY))), true)

  // …and removed again when emptied. Nothing is lost: every version is in the
  // repository.
  await w.edit([{ from: wp(0), to: wp(w.text.length as number), insert: pt('') }], 'user')
  await doc.flush()
  assert.equal(existsSync(join(root, dayFile(DAY))), false)
})

test('an empty day written by an older version is collected when it is loaded', async t => {
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', '\n'),
    [dayFile(d('2026-03-15'))]: dayText('2026-03-15', 'Real content.\n'),
  })
  await doc.segment(DAY)
  await doc.flush()
  assert.equal(existsSync(join(root, dayFile(DAY))), false, 'the contentless day should be gone')
  assert.equal(existsSync(join(root, dayFile(d('2026-03-15')))), true)
})

test('but a contentless day carrying hand-written frontmatter is left alone', async t => {
  // "Unknown keys are preserved verbatim" (format-spec) would be an odd promise
  // to keep on rewrite and break by deletion. Somebody put that there.
  const original = '---\ntephra: 1\ndate: 2026-03-14\nkind: stream\nmood: bleak\n---\n\n'
  const { doc, root } = await fixture(t, { [dayFile(DAY)]: original })
  await doc.segment(DAY)
  await doc.flush()
  assert.equal(await readFile(join(root, dayFile(DAY)), 'utf8'), original)
})

// ── a day must not lose the newline that ends it ──────────────────────────

test('THE BUG: branching to the end of a day joins it to the next one', async t => {
  // Reported from use: branch something out of an earlier day, and the date
  // seam above today stops rendering — permanently, and typing does not bring
  // it back. The window flattens segments with nothing between them, so a day
  // whose body no longer ends in a newline runs into the first line of the day
  // after it; the seam is then skipped, because a block widget cannot sit
  // mid-line. The file was right the whole time, which is why it looked like a
  // rendering fault rather than an edit that took one character too many.
  const { doc, corpus } = await fixture(t, {
    [dayFile(d('2026-03-01'))]: dayText('2026-03-01', 'Yesterday, all of it.\n'),
    [dayFile(d('2026-03-02'))]: dayText('2026-03-02', 'Today, being written.\n'),
  })
  const first = await doc.segment(d('2026-03-01'))

  // To the very end of the day, newline and all — which is what selecting a
  // day's last paragraph and branching it does.
  await doc.branch(
    {
      begin: doc.positionAt(d('2026-03-01'), 0),
      end: doc.positionAt(d('2026-03-01'), first.length),
    },
    'Titration curves',
  )

  const at = doc.positionAt(d('2026-03-01'), 0)
  const to = doc.positionAt(d('2026-03-02'), 0)
  const window = await doc.read({ begin: at, end: to })
  const text = window.text as string

  assert.ok(
    text.includes('Today, being written'),
    'both days are in the window',
  )
  const todayAt = text.indexOf('Today, being written')
  assert.equal(
    text[todayAt - 1],
    '\n',
    'and the day after starts on a line of its own, so its seam can be drawn',
  )
  assert.equal(corpus !== undefined, true)
})

// ── typing where a comment card appears (D89) ───────────────────────────────

test('TYPING AFTER A COMMENT lands after it, not inside its byline', async t => {
  // **Reported from use as a crash, three times in one evening.** The sequence:
  // comment on a phrase, press Done, type. The character landed at the START of
  // the comment's byline — `S> **zunger** …` — which stopped the block being a
  // blockquote, un-elided its two hundred and ten characters into the prose, and
  // desynchronised the window by exactly that many.
  //
  // The cause was a rule about apparatus applied to content. A zero-width marker
  // is one visual place and two document offsets, and `toDocument` answers
  // *leftmost* so that text typed at the end of a tagged range stays inside the
  // range (D44). A thread block is also zero-width — and is a paragraph of
  // somebody's writing, where leftmost means *inside the comment*.
  const { doc, root, w, span } = await commented(t)
  await doc.startComment(span, 'A note that lives in the margin.', AT)

  // Where a person is when the card is on screen: the paragraph after it.
  const reopened = await windowOver(doc, DAY)
  const at = reopened.text.indexOf('And the day continues')
  await reopened.edit([{ from: wp(at), to: wp(at), insert: pt('X') }], 'user')
  await doc.flush()

  const file = await fileOf(root)
  assert.match(file, /^> \*\*.+\*\* .+ <!--tephra:comment/m, 'the byline still starts a line')
  assert.match(file, /^XAnd the day continues\./m, 'and the character landed where the caret was')
  assert.equal(file.includes('X>'), false, 'nothing landed on the byline')

  // And the two halves still agree about how long the passage is, which is the
  // arithmetic that surfaced this as a desync.
  const after = await windowOver(doc, DAY)
  assert.equal(after.text.includes('A note that lives in the margin'), false, 'still elided')
})

test('and a tagged range still keeps text typed at its end (D44 is unchanged)', async t => {
  // The rule this narrows: `tag-end` is apparatus, two characters of it, and a
  // position at it belongs BEFORE it so that continuing a tagged sentence keeps
  // the subject. Only elided CONTENT changed sides.
  const { doc, root } = await fixture(t, {
    [dayFile(DAY)]: dayText('2026-03-14', 'Nothing here yet.\n'),
  })
  const w = await windowOver(doc, DAY)
  const from = w.text.indexOf('here')
  await doc.tag({ begin: w.toDocument(wp(from)), end: w.toDocument(wp(from + 4)) }, 'subject')
  const again = await windowOver(doc, DAY)
  const end = again.text.indexOf('here') + 4
  await again.edit([{ from: wp(end), to: wp(end), insert: pt('!') }], 'user')
  await doc.flush()
  const file = await fileOf(root)
  assert.match(file, /here!<!--tephra:tag-end/, 'the text stayed inside the range')
})
