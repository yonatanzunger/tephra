// Curated sections (D53): a fileset is a list of links, and the link says what
// kind of thing the entry is.
//
// The parsing claims are about LENIENCE as much as about correctness — a
// section file is hand-edited, so prose between the entries is ordinary and an
// entry nobody can resolve is still an entry.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseSection, referenceOf } from '../../../../src/main/x/fileset.ts'
import type { RelPath } from '../../../../src/main/w/layout.ts'

const PATH = 'sections/house-deal.fileset.md' as RelPath
/** A section's body, as a document hands it over: frontmatter already off. */
const file = (body: string): string => body

test('the entries are the list, in the order the list has them', () => {
  const section = parseSection(
    file(
      '- [Mortgage contact](tephra:mark/mortgage%20contact) — call before Thursday\n' +
        '- [Offer letter](../notes/offer.md)\n' +
        '- [The listing](https://example.com/listing)\n',
    ),
    PATH,
    'House deal',
  )
  assert.equal(section.title, 'House deal')
  assert.deepEqual(section.entries.map(e => e.label), ['Mortgage contact', 'Offer letter', 'The listing'])
  assert.deepEqual(section.entries.map(e => e.target.kind), ['anchor', 'file', 'url'])
})

test('the text after the link is the summary, and it is left alone', () => {
  // R20: human-authored, and the place regeneration must never clobber.
  const [entry] = parseSection(file('- [A thing](../notes/a.md) — why it matters, in my words\n'), PATH, 'House deal').entries
  assert.equal(entry?.summary, 'why it matters, in my words')
})

test('an entry with no summary has none, rather than an empty one', () => {
  const [entry] = parseSection(file('- [A thing](../notes/a.md)\n'), PATH, 'House deal').entries
  assert.equal(entry?.summary, null)
})

test('prose between the entries is prose, not an error', () => {
  // A person may explain what a section is for. The parser has nothing to do
  // with that, which is not the same as it being wrong.
  const section = parseSection(file('This is what I am tracking about the house.\n\n- [A thing](../notes/a.md)\n\nStill me talking.\n'), PATH, 'House deal')
  assert.equal(section.entries.length, 1)
})

test('every reference kind is written the way the format says (D53)', () => {
  assert.deepEqual(referenceOf('tephra:mark/the%20spot'), { kind: 'anchor', name: 'the spot' })
  assert.deepEqual(referenceOf('tephra:tag/House Deal'), { kind: 'tag', subject: 'House Deal' })
  assert.deepEqual(referenceOf('tephra:day/2026-08-24'), { kind: 'date', date: '2026-08-24' })
  assert.deepEqual(referenceOf('tephra:section/reading'), { kind: 'section', name: 'reading' })
  assert.deepEqual(referenceOf('../notes/a.md'), { kind: 'file', path: '../notes/a.md' })
  assert.deepEqual(referenceOf('https://example.com/x'), { kind: 'url', href: 'https://example.com/x' })
})

test('the authority form works too, since a person may type either', () => {
  assert.deepEqual(referenceOf('tephra://mark/the%20spot'), { kind: 'anchor', name: 'the spot' })
})

test('an unknown scheme is not a guess worth making', () => {
  assert.equal(referenceOf('tephra:nonsense/x'), null)
  assert.equal(referenceOf('mailto:someone@example.com'), null)
})

test('a title comes from frontmatter, and falls back to the filename', () => {
  assert.equal(parseSection('- [x](../a.md)\n', PATH, null).title, 'house-deal')
})

// ── the tree, which is where the rules that keep it finite live ─────────────

import { test as it } from 'node:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../../../src/main/w/notebook.ts'
import { Filesets } from '../../../../src/main/x/fileset.ts'
import { Corpus } from '../../../../src/main/x/documents/corpus.ts'
import { dirname } from 'node:path'
import { asFileset, type FilesetDocument } from '../../../../src/main/x/documents/kinds/fileset.ts'
import {
  ONLY_SEGMENT, type DocumentId, type DocumentOffset, type DocumentPosition,
  type SegmentKey, type SessionGeneration,
} from '../../../../src/shared/document-api.ts'
import type { TestContext } from 'node:test'

async function sections(t: TestContext, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-sections-'))
  await mkdir(join(root, 'sections'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    // A fixture may bring its own frontmatter — a title is part of what is
    // being tested when the panel shows one.
    const text = body.startsWith('---\n') ? body : `---\ntephra: 1\nkind: fileset\n---\n${body}`
    await writeFile(join(root, 'sections', name), text)
  }
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  const corpus = new Corpus(notebook)
  return {
    root,
    notebook,
    corpus,
    filesets: new Filesets(corpus),
    /**
     * Write what the documents are holding.
     *
     * A pin is a document edit now, so it lands in memory and the write tiers
     * put it on disk (D54). A test that reads the FILE has to say when it
     * expects that to have happened — which is the honest shape, because it is
     * what the app does.
     */
    flush: () => corpus.flushAll(),
  }
}

it('the top level is a fileset of filesets (D53)', async t => {
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [The house](tephra:section/house)\n- [Something pinned](tephra:tag/Physics)\n',
    'house.fileset.md': '- [The listing](https://example.com/x)\n',
  })
  const tree = await filesets.tree()
  assert.deepEqual(tree.entries.map(e => e.target.kind), ['section', 'tag'])
  assert.deepEqual(tree.entries[0]?.children?.entries.map(e => e.label), ['The listing'])
})

it('a section naming itself does not recurse forever', async t => {
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [Loop](tephra:section/loop)\n',
    'loop.fileset.md': '- [Loop again](tephra:section/loop)\n',
  })
  const tree = await filesets.tree()
  const inner = tree.entries[0]?.children?.entries[0]
  assert.equal(inner?.label, 'Loop again')
  assert.equal(inner?.children, null, 'shown as a plain entry rather than expanded again')
})

it('nesting stops at three deep', async t => {
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [A](tephra:section/a)\n',
    'a.fileset.md': '- [B](tephra:section/b)\n',
    'b.fileset.md': '- [C](tephra:section/c)\n',
    'c.fileset.md': '- [D](../notes/d.md)\n',
  })
  const tree = await filesets.tree()
  assert.notEqual(tree.entries[0]?.children, null)
  assert.notEqual(tree.entries[0]?.children?.entries[0]?.children, null)
  assert.equal(tree.entries[0]?.children?.entries[0]?.children?.entries[0]?.children, null)
})

it('THE POINT: an entry that resolves to nothing is still an entry', async t => {
  // Hiding it would make a hand-edit look like data loss, and the entry is the
  // only remaining record of what was meant (D53).
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [A section that went away](tephra:section/gone)\n- [A file that moved](../notes/moved.md)\n',
  })
  const tree = await filesets.tree()
  assert.equal(tree.entries.length, 2)
  assert.deepEqual(tree.entries.map(e => e.missing), [true, true])
  assert.deepEqual(tree.entries.map(e => e.label), ['A section that went away', 'A file that moved'])
})

it('a notebook with no sections yet is empty, not broken', async t => {
  const { filesets } = await sections(t, {})
  const tree = await filesets.tree()
  assert.deepEqual(tree.entries, [])
  assert.equal(tree.path, null, 'and says the file is not there')
})

// ── pinning, and the bug that a name is not a path ─────────────────────────

it('a pin is a line appended to a markdown file', async t => {
  const { notebook, filesets, flush } = await sections(t, {})
  assert.equal(await filesets.pin({ kind: 'tag', subject: 'House Deal' }, 'House Deal'), 'pinned')
  await flush()
  const written = await notebook.read('sections/pinned.fileset.md' as RelPath)
  assert.match(written ?? '', /^- \[House Deal\]\(tephra:tag\/House%20Deal\)$/m)
  assert.match(written ?? '', /^---\ntephra: 1\nkind: fileset\ntitle: Pinned\n---/)
})

it('pinning the same reference twice does not double it', async t => {
  const { filesets } = await sections(t, {})
  await filesets.pin({ kind: 'anchor', name: 'the spot' }, 'the spot')
  assert.equal(await filesets.pin({ kind: 'anchor', name: 'the spot' }, 'again'), 'already')
})

it('THE BUG: unpinning from the top-level list, whose name does not survive slugging', async t => {
  // `sectionFile('_index')` is `sections/index.fileset.md` — `slug` strips the
  // underscore, because slug exists to turn a person's TITLE into a filename.
  // Taking a name meant unpinning wrote to a file that did not exist and
  // reported nothing: the button did nothing, silently, and every test passed
  // because they all used a name that survives slugging.
  const { notebook, filesets, flush } = await sections(t, {
    '_index.fileset.md': '- [Kept](tephra:tag/Kept)\n- [Removed](tephra:mark/removed)\n',
  })
  const path = 'sections/_index.fileset.md' as RelPath
  assert.equal(await filesets.unpin({ kind: 'anchor', name: 'removed' }, path), true)
  await flush()

  const written = (await notebook.read(path)) ?? ''
  assert.match(written, /Kept/)
  assert.doesNotMatch(written, /removed/)
})

it('a reference is matched however it was written down', async t => {
  // The app escapes a space to `%20`; a person writes `<…>`, which is what
  // markdown requires of a destination with a space in it. One pin, two hands.
  const { notebook, filesets, flush } = await sections(t, {
    'pinned.fileset.md': '- [House Deal](<tephra:tag/House Deal>)\n',
  })
  assert.equal(
    await filesets.unpin({ kind: 'tag', subject: 'House Deal' }, 'sections/pinned.fileset.md' as RelPath),
    true,
  )
  await flush()
  assert.doesNotMatch((await notebook.read('sections/pinned.fileset.md' as RelPath)) ?? '', /House Deal/)
})

it('unpinning something that is not there says so rather than pretending', async t => {
  const { filesets } = await sections(t, { 'pinned.fileset.md': '- [Kept](tephra:tag/Kept)\n' })
  assert.equal(
    await filesets.unpin({ kind: 'tag', subject: 'Absent' }, 'sections/pinned.fileset.md' as RelPath),
    false,
  )
})

it('THE GAP: a pin into a notebook that already has a top-level order', async t => {
  // Every earlier test had either NO `_index` — where the tree lists whatever
  // filesets exist — or one that already named the section being pinned into.
  // A real notebook is neither: it has an order, written before the section
  // existed. The pin wrote its file and the panel never showed it, because the
  // order did not mention it.
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [The house](tephra:section/house)\n',
    'house.fileset.md': '- [The listing](https://example.com/x)\n',
  })
  assert.equal(await filesets.pin({ kind: 'tag', subject: 'Recurring' }, 'Recurring'), 'pinned')

  const tree = await filesets.tree()
  const titles = tree.entries.map(e => e.label)
  assert.ok(titles.includes('Pinned'), `the new section should be in the order, got ${titles.join(', ')}`)
})

it('and a pin into a section already in the order does not name it twice', async t => {
  const { notebook, filesets, flush } = await sections(t, {
    '_index.fileset.md': '- [Pinned](tephra:section/pinned)\n',
    'pinned.fileset.md': '- [Kept](tephra:tag/Kept)\n',
  })
  await filesets.pin({ kind: 'tag', subject: 'Another' }, 'Another')
  await flush()
  const index = (await notebook.read('sections/_index.fileset.md' as RelPath)) ?? ''
  assert.equal((index.match(/tephra:section\/pinned/g) ?? []).length, 1)
})

it('THE LIVE BUG: an order that does not name a section must not hide it', async t => {
  // The state a real notebook was actually in: an order with nothing in it, and
  // a section file full of pins. Every pin was written correctly and the panel
  // showed nothing, because the order was being read as a whitelist.
  const { filesets } = await sections(t, {
    '_index.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: Sections\n---\n',
    'pinned.fileset.md':
      '---\ntephra: 1\nkind: fileset\ntitle: Pinned\n---\n' +
      '- [COBRA!!](tephra:tag/COBRA!!)\n- [Foo](tephra:tag/Foo)\n',
  })
  const tree = await filesets.tree()
  assert.deepEqual(tree.entries.map(e => e.label), ['Pinned'])
  assert.deepEqual(tree.entries[0]?.children?.entries.map(e => e.label), ['COBRA!!', 'Foo'])
})

it('what is named comes first, in the order it is named; the rest follow', async t => {
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [The house](tephra:section/house)\n',
    'house.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [x](../a.md)\n',
    'pinned.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: Pinned\n---\n- [y](../b.md)\n',
    'reading.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: Reading\n---\n- [z](../c.md)\n',
  })
  // Named first in its stated order; then pinned, then the rest by title.
  assert.deepEqual((await filesets.tree()).entries.map(e => e.label), ['The house', 'Pinned', 'Reading'])
})

it('a section made by hand appears without anyone editing the order', async t => {
  // R26 in the sidebar: a file dropped into `sections/` is a section, whatever
  // the app knew about it.
  const { filesets } = await sections(t, {
    '_index.fileset.md': '- [Pinned](tephra:section/pinned)\n',
    'pinned.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: Pinned\n---\n- [y](../b.md)\n',
    'by-hand.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: Made by hand\n---\n- [z](../c.md)\n',
  })
  assert.deepEqual((await filesets.tree()).entries.map(e => e.label), ['Pinned', 'Made by hand'])
})

// ── the fileset as a document, whose verbs are edits (MC4) ────────────────

/** The document itself, borrowed the way anything else borrows one. */
/** A position at the start of the one segment, which is all this window needs. */
const whereIs = (segment: SegmentKey): DocumentPosition =>
  ({ segment, offset: 0 as DocumentOffset, generation: 1 as SessionGeneration })

const fileset = <T,>(corpus: Corpus, path: string, work: (doc: FilesetDocument) => Promise<T>): Promise<T> =>
  corpus.use(path as DocumentId, doc => work(asFileset(doc)))

it('THE POINT OF MC4: a pin is undone by the ordinary undo', async t => {
  // D53 said this from the start, and it was not true while pinning wrote the
  // file behind the document's back: there was nothing on any undo stack.
  const { corpus, filesets, notebook, flush } = await sections(t, {
    'pinned.fileset.md': '- [Kept](tephra:tag/Kept)\n',
  })
  await filesets.pin({ kind: 'tag', subject: 'House Deal' }, 'House Deal')

  const undone = await fileset(corpus, 'sections/pinned.fileset.md', doc => doc.undo())
  assert.notEqual(undone, null, 'the pin was on the undo stack')
  await flush()

  const written = (await notebook.read('sections/pinned.fileset.md' as RelPath)) ?? ''
  assert.match(written, /Kept/, 'and undoing it took back only the pin')
  assert.doesNotMatch(written, /House Deal/)
})

it('a pin reaches a window that has the same fileset open', async t => {
  // The second half of the same claim: two views of one document, so the panel
  // and the editor cannot disagree about what is pinned.
  const { corpus, filesets } = await sections(t, { 'pinned.fileset.md': '- [Kept](tephra:tag/Kept)\n' })
  const whole = { begin: whereIs(ONLY_SEGMENT), end: whereIs(ONLY_SEGMENT) }
  const window = await fileset(corpus, 'sections/pinned.fileset.md', doc => doc.read(whole))

  await filesets.pin({ kind: 'anchor', name: 'the spot' }, 'The spot')
  assert.match(window.text, /The spot/, 'the open window saw the pin without being told')
})

it('an entry is removed by position, and the line goes with its newline', async t => {
  const { corpus, notebook, flush } = await sections(t, {
    'pinned.fileset.md': '- [One](../a.md)\n- [Two](../b.md)\n- [Three](../c.md)\n',
  })
  assert.equal(await fileset(corpus, 'sections/pinned.fileset.md', doc => doc.remove(1)), true)
  await flush()
  assert.match(
    (await notebook.read('sections/pinned.fileset.md' as RelPath)) ?? '',
    /- \[One\]\(\.\.\/a\.md\)\n- \[Three\]\(\.\.\/c\.md\)\n$/,
    'no blank line left where the entry was',
  )
})

it('reordering is one edit, so one undo puts it back', async t => {
  const { corpus } = await sections(t, {
    'pinned.fileset.md': '- [One](../a.md)\n- [Two](../b.md)\n- [Three](../c.md)\n',
  })
  const labels = async (doc: FilesetDocument): Promise<string[]> =>
    (await doc.entries()).map(e => e.label)

  await fileset(corpus, 'sections/pinned.fileset.md', async doc => {
    assert.equal(await doc.reorder(2, 0), true, 'the third goes to the front')
    assert.deepEqual(await labels(doc), ['Three', 'One', 'Two'])

    // A move that came back as two edits would let an undo leave the entry
    // deleted and never reinserted — a pin lost to a gesture meant to be free.
    await doc.undo()
    assert.deepEqual(await labels(doc), ['One', 'Two', 'Three'])
  })
})

it('reorder says no rather than pretending, when there is nothing to do', async t => {
  const { corpus } = await sections(t, { 'pinned.fileset.md': '- [One](../a.md)\n- [Two](../b.md)\n' })
  await fileset(corpus, 'sections/pinned.fileset.md', async doc => {
    assert.equal(await doc.reorder(0, 0), false, 'to where it already is')
    assert.equal(await doc.reorder(0, 1), false, 'and to just before the next one, which is the same place')
    assert.equal(await doc.reorder(5, 0), false, 'and there is no fifth entry')
  })
})

it('a fileset borrowed for reading refuses to be pinned into', async t => {
  // The read borrow is what makes a sweep safe (D54). A verb that edits has to
  // be on the wrong side of it, or "read" means nothing.
  const { corpus } = await sections(t, { 'pinned.fileset.md': '- [Kept](tephra:tag/Kept)\n' })
  await assert.rejects(
    () =>
      corpus.use(
        'sections/pinned.fileset.md' as DocumentId,
        doc => asFileset(doc).pin({ kind: 'tag', subject: 'No' }, 'No'),
        { mode: 'read' },
      ),
    /borrowed for reading/,
  )
})

it('a note is not a fileset, and says so instead of being coerced', async t => {
  const { corpus, root } = await sections(t, {})
  await writeFile(join(root, 'a-note.md'), '---\ntephra: 1\nkind: markdown\n---\nJust a note.\n')
  await assert.rejects(
    () => corpus.use('a-note.md' as DocumentId, async doc => asFileset(doc).entries()),
    /is not a fileset/,
  )
})

// ── a section per directory, so a file that arrives can be found ───────────

/** A notebook with documents in directories, not only in `sections/`. */
async function withFiles(t: TestContext, files: Record<string, string>) {
  const made = await sections(t, {})
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(made.root, dirname(rel)), { recursive: true })
    await writeFile(join(made.root, rel), body)
  }
  return made
}

it('THE POINT: a file nobody pinned is still findable, under its directory', async t => {
  // An imported or branched note lands in `notes/` and nothing in the panel
  // names it: the curated sections list what someone CHOSE, and a file nobody
  // has chosen yet is a file nobody can see.
  const { filesets } = await withFiles(t, {
    'notes/offer.md': '---\ntephra: 1\nkind: markdown\n---\nThe offer.\n',
    'notes/spec.md': '---\ntephra: 1\nkind: markdown\n---\nA spec.\n',
  })
  const tree = await filesets.tree()
  const notes = tree.entries.find(e => e.label === 'Notes')

  assert.notEqual(notes, undefined, 'the directory is a section')
  assert.deepEqual(notes?.children?.entries.map(e => e.label), ['offer', 'spec'])
  assert.deepEqual(notes?.children?.entries.map(e => e.target.kind), ['file', 'file'])
})

it('and a file that arrives later is simply there, with nothing to notice it', async t => {
  // Derived rather than written: a file can arrive while the app is closed, so
  // anything that had to SEE it arrive would already be wrong.
  const { filesets, root } = await withFiles(t, {
    'notes/first.md': '---\ntephra: 1\nkind: markdown\n---\nOne.\n',
  })
  await writeFile(join(root, 'notes', 'later.md'), '---\ntephra: 1\nkind: markdown\n---\nTwo.\n')

  const notes = (await filesets.tree()).entries.find(e => e.label === 'Notes')
  assert.deepEqual(notes?.children?.entries.map(e => e.label), ['first', 'later'])
})

it('the entries are relative to the directory, so clicking one resolves', async t => {
  const { filesets } = await withFiles(t, {
    'notes/deep/buried.md': '---\ntephra: 1\nkind: markdown\n---\nDown here.\n',
  })
  const notes = (await filesets.tree()).entries.find(e => e.label === 'Notes')
  const [entry] = notes?.children?.entries ?? []

  assert.equal(entry?.target.kind === 'file' ? entry.target.path : null, 'deep/buried.md')
})

it("A DIRECTORY'S OWN ORDER ORDERS IT, and does not gate it (D53)", async t => {
  // The same rule as the top level. What is named comes first, in the order it
  // is named and under the label someone gave it; everything else follows.
  const { filesets } = await withFiles(t, {
    'notes/a.md': '---\ntephra: 1\nkind: markdown\n---\nA.\n',
    'notes/b.md': '---\ntephra: 1\nkind: markdown\n---\nB.\n',
    'notes/z.md': '---\ntephra: 1\nkind: markdown\n---\nZ.\n',
    'notes/_index.fileset.md':
      '---\ntephra: 1\nkind: fileset\ntitle: My notes\n---\n- [The last one](z.md) — read this first\n',
  })
  const notes = (await filesets.tree()).entries.find(e => e.label === 'My notes')

  assert.notEqual(notes, undefined, 'and the directory takes the name its index gives it')
  assert.deepEqual(
    notes?.children?.entries.map(e => e.label),
    ['The last one', 'a', 'b'],
    'the named one first, under its own label; the rest after it, by name',
  )
  assert.equal(notes?.children?.entries[0]?.summary, 'read this first')
})

it('a curated entry is not listed twice, however it was written', async t => {
  const { filesets } = await withFiles(t, {
    'notes/a.md': '---\ntephra: 1\nkind: markdown\n---\nA.\n',
    'notes/_index.fileset.md': '---\ntephra: 1\nkind: fileset\n---\n- [A](./a.md)\n',
  })
  const notes = (await filesets.tree()).entries.find(e => e.children?.entries.length === 1)
  assert.deepEqual(notes?.children?.entries.map(e => e.label), ['A'])
})

it('the stream is not a directory section, because it is the Timeline', async t => {
  // And `sections/` is not one either: a section listing the sections is the
  // list twice.
  const { filesets } = await withFiles(t, {
    'notes/a.md': '---\ntephra: 1\nkind: markdown\n---\nA.\n',
    'sections/house.fileset.md': '---\ntephra: 1\nkind: fileset\ntitle: The house\n---\n- [x](../notes/a.md)\n',
  })
  const labels = (await filesets.tree()).entries.map(e => e.label)

  assert.equal(labels.includes('Stream'), false)
  assert.equal(labels.includes('Sections'), false)
  assert.deepEqual(labels, ['The house', 'Notes'], 'curated first, then the directories')
})

it('a directory with nothing a document in it is not a section', async t => {
  // Attachments and config are files, not documents. An empty section would be
  // a row that says nothing and opens nothing.
  const { filesets } = await withFiles(t, {
    'attachments/2026/03/scan.png': 'not a document',
    'config/whatever.json': '{}',
  })
  assert.deepEqual((await filesets.tree()).entries, [])
})

it('a derived listing offers no unpin, because there is no line to remove', async t => {
  const { filesets } = await withFiles(t, {
    'notes/a.md': '---\ntephra: 1\nkind: markdown\n---\nA.\n',
  })
  const notes = (await filesets.tree()).entries.find(e => e.label === 'Notes')
  assert.equal(notes?.children?.path, null, 'no file yet, so nothing to edit')
})

it('a derived entry resolves from the directory, not from the stream', async t => {
  // THE TRAP: `path` is null for a derived listing (nothing to unpin), and if
  // that is also what the links resolve from, they resolve from a day file's
  // depth instead — outside the notebook, reported as missing. A correct link
  // to a real file, in a row that says "not found".
  const { filesets } = await withFiles(t, {
    'notes/offer.md': '---\ntephra: 1\nkind: markdown\n---\nThe offer.\n',
  })
  const notes = (await filesets.tree()).entries.find(e => e.label === 'Notes')

  assert.equal(notes?.children?.path, null, 'no file to edit')
  assert.equal(notes?.children?.base, 'notes/_index.fileset.md', 'but a place to resolve from')
})
