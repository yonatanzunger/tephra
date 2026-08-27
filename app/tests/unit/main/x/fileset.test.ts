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
const file = (body: string): string => `---\ntephra: 1\nkind: fileset\ntitle: House deal\n---\n${body}`

test('the entries are the list, in the order the list has them', () => {
  const section = parseSection(
    file(
      '- [Mortgage contact](tephra:mark/mortgage%20contact) — call before Thursday\n' +
        '- [Offer letter](../notes/offer.md)\n' +
        '- [The listing](https://example.com/listing)\n',
    ),
    PATH,
  )
  assert.equal(section.title, 'House deal')
  assert.deepEqual(section.entries.map(e => e.label), ['Mortgage contact', 'Offer letter', 'The listing'])
  assert.deepEqual(section.entries.map(e => e.target.kind), ['anchor', 'file', 'url'])
})

test('the text after the link is the summary, and it is left alone', () => {
  // R20: human-authored, and the place regeneration must never clobber.
  const [entry] = parseSection(file('- [A thing](../notes/a.md) — why it matters, in my words\n'), PATH).entries
  assert.equal(entry?.summary, 'why it matters, in my words')
})

test('an entry with no summary has none, rather than an empty one', () => {
  const [entry] = parseSection(file('- [A thing](../notes/a.md)\n'), PATH).entries
  assert.equal(entry?.summary, null)
})

test('prose between the entries is prose, not an error', () => {
  // A person may explain what a section is for. The parser has nothing to do
  // with that, which is not the same as it being wrong.
  const section = parseSection(
    file('This is what I am tracking about the house.\n\n- [A thing](../notes/a.md)\n\nStill me talking.\n'),
    PATH,
  )
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
  assert.equal(parseSection('---\ntephra: 1\n---\n- [x](../a.md)\n', PATH).title, 'house-deal')
})

// ── the tree, which is where the rules that keep it finite live ─────────────

import { test as it } from 'node:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../../../src/main/w/notebook.ts'
import { Filesets } from '../../../../src/main/x/fileset.ts'
import type { TestContext } from 'node:test'

async function sections(t: TestContext, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-sections-'))
  await mkdir(join(root, 'sections'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(root, 'sections', name), `---\ntephra: 1\nkind: fileset\n---\n${body}`)
  }
  const notebook = await Notebook.open({ root, lock: false, watch: false })
  t.after(() => notebook.close())
  return { root, notebook, filesets: new Filesets(notebook) }
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
