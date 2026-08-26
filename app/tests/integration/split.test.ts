// The day-file split, end to end (format-spec.md, D20).
//
// THE POINT OF FORCING IT: at ~100 KB a day a 1 MB threshold means this path
// fires perhaps once in a career, and **a path that fires once every few years
// is broken when it fires**. So these tests grow a day past the threshold on
// purpose and check the two things that matter — the files on disk are right,
// and nothing above the storage layer can tell.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/stream-document.ts'
import { SPLIT_THRESHOLD } from '../../src/main/x/split.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { WindowPosition, DateKey } from '../../src/shared/document-api.ts'
import { pt } from '../support/text.ts'

const wp = (n: number): WindowPosition => n as WindowPosition
const DAY = '2026-03-14' as DateKey

async function notebook(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-split-e2e-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const doc = new StreamDocument(nb)
  t.after(async () => {
    await nb.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, nb, doc }
}

/** Type `text` at the end of the day, as the editor would. */
async function append(doc: StreamDocument, text: string): Promise<void> {
  const w = await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  await w.edit([{ from: wp(w.text.length), to: wp(w.text.length), insert: pt(text) }], 'user')
}

const paragraph = (i: number): string => `Paragraph ${i}. ${'word '.repeat(40)}\n\n`

/** Enough paragraphs to pass the real 1 MB threshold. */
function oversizedDay(): string {
  let body = ''
  let i = 0
  while (body.length <= SPLIT_THRESHOLD + 50_000) body += paragraph(i++)
  return body
}

test('an ordinary day is still exactly one file, byte for byte', async t => {
  // The common path must not pay for the rare one. This also guards the
  // format-spec rule that a rewrite preserves what it did not change.
  const { root, doc } = await notebook(t)
  await append(doc, 'A normal day.\n')
  await doc.flush()

  const files = (await readdir(join(root, 'stream', '2026', '03'))).sort()
  assert.deepEqual(files, ['2026-03-14.md'])
  const text = await readFile(join(root, dayFile(DAY)), 'utf8')
  assert.match(text, /^---\n/, 'frontmatter intact')
  assert.match(text, /A normal day\./)
})

test('FORCED: a day past 1 MB writes several parts, and they are numbered', async t => {
  const { root, doc } = await notebook(t)
  await append(doc, oversizedDay())
  await doc.flush()

  const files = await readdir(join(root, 'stream', '2026', '03'))
  assert.ok(files.length > 1, `expected a split, got ${JSON.stringify(files)}`)
  // Membership, not sort position: '2026-03-14.2.md' sorts BEFORE
  // '2026-03-14.md', because '2' precedes 'm'. Ordering parts by filename is a
  // trap, and the format does not ask anyone to — `part` in the frontmatter is
  // what orders them.
  assert.ok(files.includes('2026-03-14.md'), 'part 1 keeps the plain name')
  assert.ok(files.includes('2026-03-14.2.md'), 'later parts carry their number')

  const second = await readFile(join(root, dayFile(DAY, 2)), 'utf8')
  assert.match(second, /^---\n/, 'a later part is a real day file, with frontmatter')
  assert.match(second, /\npart: 2\n/, 'and says which part it is')
  assert.match(second, /\ndate: 2026-03-14\n/, 'sharing the date')
})

test('THE INVARIANT ACROSS A RELOAD: a split day reads back as one day', async t => {
  // D20 says parts coalesce above storage. If they do not, the split is visible
  // to every layer above and the "one continuous stream" promise is broken by
  // an implementation detail.
  const { root, nb, doc } = await notebook(t)
  const body = oversizedDay()
  await append(doc, body)
  await doc.flush()

  const reopened = new StreamDocument(nb)
  const w = await reopened.read({
    begin: reopened.positionAt(DAY, 0),
    end: reopened.positionAt(DAY, 0),
  })
  assert.equal(w.text, body, 'every byte, in order, as though it were never split')
  void root
})

test('appending to a split day does not move the existing boundary', async t => {
  // Prefix-stability where it actually matters: on disk. A boundary that moved
  // would rewrite part 1 for a change that only touched the end, and under sync
  // that is a conflict manufactured from nothing.
  const { root, doc } = await notebook(t)
  await append(doc, oversizedDay())
  await doc.flush()
  const firstPart = await readFile(join(root, dayFile(DAY)), 'utf8')

  await append(doc, 'One more thought, added later.\n\n')
  await doc.flush()

  assert.equal(
    await readFile(join(root, dayFile(DAY)), 'utf8'),
    firstPart,
    'part 1 is untouched by an append at the end',
  )
})

test('a day that shrinks back removes the parts it no longer needs', async t => {
  // An orphaned part 2 would be read back as part of the day forever, silently
  // restoring text that was deleted — the worst kind of leftover.
  const { root, doc } = await notebook(t)
  await append(doc, oversizedDay())
  await doc.flush()
  assert.ok((await readdir(join(root, 'stream', '2026', '03'))).length > 1)

  const w = await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  await w.edit([{ from: wp(0), to: wp(w.text.length), insert: pt('Almost nothing left.\n') }], 'operation')
  await doc.flush()

  assert.deepEqual(
    (await readdir(join(root, 'stream', '2026', '03'))).sort(),
    ['2026-03-14.md'],
    'the tail is gone, not orphaned',
  )
  const back = await doc.read({ begin: doc.positionAt(DAY, 0), end: doc.positionAt(DAY, 0) })
  assert.equal(back.text, 'Almost nothing left.\n')
})
