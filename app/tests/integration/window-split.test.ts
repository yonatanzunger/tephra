// FALSIFICATION: the boundary-crossing edit split (`DocumentWindow.#toDocumentEdits`).
//
// The comment on that function says the quiet part out loud: "A single deletion
// sweeping across midnight is two edits, one per file, and getting that wrong
// writes half of it to the wrong day." That is a claim about every range in a
// multi-day window, and the existing suite only ever exercised a handful of
// hand-chosen ones.
//
// So this checks a PROPERTY rather than examples: for any edit at all, the
// window's text afterwards must equal applying that same edit to the text
// beforehand. If the split drops a piece, duplicates one, or files it under the
// wrong date, the two disagree — and the sweep tries every offset, including
// every offset that is exactly a day boundary, which is where this can go wrong
// and where a person would never think to click.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { StreamDocument } from '../../src/main/x/stream-document.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { WindowPosition, DateKey, DocumentWindow } from '../../src/shared/document-api.ts'
import { pt } from '../support/text.ts'

const d = (s: string): DateKey => s as DateKey
const wp = (n: number): WindowPosition => n as WindowPosition
const DAYS = [d('2026-03-14'), d('2026-03-15'), d('2026-03-16')]
const BODIES = ['alpha bravo\n', 'charlie\n', 'delta echo foxtrot\n']

const dayText = (date: string, body: string): string =>
  `---\ntephra: 1\ndate: ${date}\nkind: stream\n---\n${body}`

async function threeDays(t: TestContext): Promise<{
  doc: StreamDocument
  root: string
  window: () => Promise<DocumentWindow>
}> {
  const root = await mkdtemp(join(tmpdir(), 'tephra-split-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  for (const [i, day] of DAYS.entries()) {
    const rel = dayFile(day)
    await mkdir(join(root, rel, '..'), { recursive: true })
    await writeFile(join(root, rel), dayText(day, BODIES[i] as string))
  }
  const doc = new StreamDocument(nb)
  t.after(() => nb.close())
  return {
    doc,
    root,
    window: () =>
      doc.read({
        begin: doc.positionAt(DAYS[0] as DateKey, 0),
        end: doc.positionAt(DAYS[2] as DateKey, 0),
      }),
  }
}

/** The whole buffer, as the reader sees it across all three days. */
const WHOLE = BODIES.join('')

function applyOne(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to)
}

test('the window shows the days end to end', async t => {
  const { window } = await threeDays(t)
  const w = await window()
  assert.equal(w.text, WHOLE)
})

test('EVERY range in the window edits exactly as if the buffer were one string', async t => {
  // The sweep. Every from<=to over the whole buffer, which includes both day
  // boundaries and both zero-length positions at each boundary.
  const failures: string[] = []
  for (let from = 0; from <= WHOLE.length; from++) {
    for (let to = from; to <= WHOLE.length; to++) {
      const { doc, window } = await threeDays(t)
      const w = await window()
      const insert = pt(from === to ? 'X' : 'Y')
      try {
        await w.edit([{ from: wp(from), to: wp(to), insert }], 'user')
      } catch (err) {
        failures.push(`${from}..${to} threw ${(err as Error).message}`)
        continue
      }
      const expected = applyOne(WHOLE, from, to, insert)
      if (w.text !== expected) {
        failures.push(`${from}..${to}: got ${JSON.stringify(w.text)} want ${JSON.stringify(expected)}`)
      }
      void doc
      if (failures.length > 6) break
    }
    if (failures.length > 6) break
  }
  assert.deepEqual(failures, [], 'boundary-crossing edits must not lose or misfile text')
})

test('a deletion sweeping across midnight rewrites BOTH files, each correctly', async t => {
  // The named case. "alpha bravo\n" + "charlie\n": delete from inside day one
  // to inside day two and check what landed on disk, not just what the buffer
  // says — the whole point is which FILE each half went to.
  const { doc, root, window } = await threeDays(t)
  const w = await window()
  const from = 'alpha '.length //  inside day 1
  const to = (BODIES[0] as string).length + 'char'.length // inside day 2
  await w.edit([{ from: wp(from), to: wp(to), insert: pt('MERGED') }], 'user')
  // Writes are tiered and debounced (D32); without this the files on disk still
  // hold their original text and the assertions below test nothing at all.
  await doc.flush()

  assert.equal(w.text, 'alpha MERGEDlie\n' + BODIES[2], 'the buffer reads as one stream')

  const one = await readFile(join(root, dayFile(DAYS[0] as DateKey)), 'utf8')
  const two = await readFile(join(root, dayFile(DAYS[1] as DateKey)), 'utf8')
  assert.match(one, /\nalpha MERGED$/, 'the insertion belongs to the first day touched')
  assert.equal(two.endsWith('lie\n'), true, 'the second day keeps only its surviving suffix')
  assert.equal(one.includes('MERGED') && two.includes('MERGED'), false, 'inserted once, not twice')
})

test('an insertion exactly at a day boundary lands in the LATER day', async t => {
  // The convention from `toDocument`, and the one that has already been got
  // wrong once: text typed with the caret visibly in today went into a file
  // from seven months earlier, because two implementations of one rule
  // disagreed about which side of a boundary owns the offset.
  const { doc, root, window } = await threeDays(t)
  const w = await window()
  const boundary = (BODIES[0] as string).length
  await w.edit([{ from: wp(boundary), to: wp(boundary), insert: pt('HERE') }], 'user')
  await doc.flush()

  const one = await readFile(join(root, dayFile(DAYS[0] as DateKey)), 'utf8')
  const two = await readFile(join(root, dayFile(DAYS[1] as DateKey)), 'utf8')
  assert.equal(one.includes('HERE'), false, 'not the earlier day')
  assert.equal(two.includes('HERE'), true, 'the later day owns a boundary offset')
  assert.equal(w.text, 'alpha bravo\nHEREcharlie\n' + BODIES[2])
})

test('an edit covering a whole day removes that day’s body entirely', async t => {
  const { doc, root, window } = await threeDays(t)
  const w = await window()
  const start = (BODIES[0] as string).length
  const end = start + (BODIES[1] as string).length
  await w.edit([{ from: wp(start), to: wp(end), insert: pt('') }], 'user')
  await doc.flush()

  assert.equal(w.text, (BODIES[0] as string) + (BODIES[2] as string))

  // **Changed deliberately.** This used to require the file to survive with an
  // empty body and its frontmatter intact. A day with nothing in it is not a
  // day: it reads back as one, draws its own seam in the stream, and
  // accumulates one per day the notebook was merely opened. Nothing is lost by
  // removing it — there is no text, and every version is in the repository.
  assert.equal(
    existsSync(join(root, dayFile(DAYS[1] as DateKey))),
    false,
    'a day emptied of everything should not be left behind as frontmatter',
  )
  // The days on either side are untouched, which is the actual claim here.
  assert.match(await readFile(join(root, dayFile(DAYS[0] as DateKey)), 'utf8'), /kind: stream/)
  assert.match(await readFile(join(root, dayFile(DAYS[2] as DateKey)), 'utf8'), /kind: stream/)
})
