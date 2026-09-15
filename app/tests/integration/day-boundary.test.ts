// Crossing a day boundary (MD1, D62).
//
// The bug this exists for: a day that ends mid-line makes the separator below
// it unplaceable, so `days.ts` skipped the widget and the break between two
// days vanished — silently, and only when somebody stopped typing mid-sentence
// at the wrong moment. `branch` carried a clamp for the same missing rule.
// Defended twice, enforced nowhere; enforced here.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { NotebookService } from '../../src/main/services/notebook-service.ts'
import { dayFile } from '../../src/main/w/layout.ts'
import type { DateKey, ProseText, WindowPosition } from '../../src/shared/document-api.ts'

const MINUTE = 60_000
/** 08:00Z is midnight in the reference zone (D38), so these are evening times. */
const EVENING = '2026-09-01T05:00:00Z' // 21:00 on 2026-08-31
const LATE = '2026-09-01T08:20:00Z' // 00:20 on 2026-09-01
const MORNING = '2026-09-01T17:00:00Z' // 09:00 on 2026-09-01

const YESTERDAY = '2026-08-31' as DateKey
const TODAY = '2026-09-01' as DateKey

/**
 * A notebook whose day files were written *when they say they were*.
 *
 * **The mtime is the fixture's whole point.** The clock seeds from the newest
 * day and when it was last written, so a file created a millisecond ago says
 * somebody is mid-sentence — and the first draft of these tests wrote yesterday
 * evening's page at the instant the test ran, then wondered why the day had not
 * ended. `writtenAt` is when the person actually stopped.
 */
async function notebook(
  t: TestContext,
  days: Record<string, string> = {},
  at = MORNING,
  writtenAt = EVENING,
) {
  const root = await mkdtemp(join(tmpdir(), 'tephra-boundary-'))
  for (const [date, body] of Object.entries(days)) {
    const rel = dayFile(date as DateKey)
    await mkdir(join(root, rel, '..'), { recursive: true })
    await writeFile(join(root, rel), `---\ntephra: 1\ndate: ${date}\n---\n\n${body}`)
    const when = new Date(writtenAt)
    await utimes(join(root, rel), when, when)
  }
  const nb = await Notebook.open({ root, lock: false, watch: false })
  let clock = new Date(at)
  const svc = new NotebookService(nb, {
    now: () => clock,
    history: false,
    // Never on its own: these tests drive the boundary by hand so the moment it
    // is crossed is the moment being tested.
    dayCheckMs: 24 * 60 * 60_000,
  })
  t.after(async () => {
    await svc.stop()
    await nb.close()
  })
  // The seed is read asynchronously at construction; let it land.
  await svc.text.info()
  return {
    root,
    svc,
    set: (to: string) => (clock = new Date(to)),
    async type(text: string): Promise<void> {
      const info = await svc.text.info()
      const w = await svc.text.openWindow({ first: info.today, last: info.today })
      await svc.text.edit({
        id: w.id,
        edits: [{ from: w.text.length as WindowPosition, to: w.text.length as WindowPosition, insert: text as ProseText }],
        origin: 'user',
        generation: w.generation,
      })
    },
    async fileOn(date: DateKey): Promise<string> {
      await svc.flush()
      return readFile(join(root, dayFile(date)), 'utf8').catch(() => '')
    },
  }
}

test('THE BUG: a day that ended mid-line is closed off with a newline', async t => {
  const { svc, fileOn } = await notebook(t, { [YESTERDAY]: '- a list I was in the middle of' })
  // Written last night, opened this morning: the boundary has been crossed.
  assert.equal(svc.today, TODAY, 'and the notebook knows what day it is')

  const before = await fileOn(YESTERDAY)
  assert.ok(!before.endsWith('\n'), 'the fixture really does end mid-line')

  await svc.crossTheDay()
  const after = await fileOn(YESTERDAY)
  assert.ok(after.endsWith('\n'), 'and now it does not')
  assert.ok(after.includes('- a list I was in the middle of'), 'with the line itself untouched')
})

test('closing off a day twice costs nothing', async t => {
  const { svc, fileOn } = await notebook(t, { [YESTERDAY]: 'A sentence with no stop' })
  await svc.crossTheDay()
  const once = await fileOn(YESTERDAY)
  await svc.crossTheDay()
  assert.equal(await fileOn(YESTERDAY), once)
})

test('a day with nothing in it is left alone', async t => {
  // A newline would make a file out of a day nobody wrote in — and the file
  // already ends with the blank line frontmatter puts there, so what is being
  // tested is that nothing was added to it.
  const { svc, fileOn } = await notebook(t, { [YESTERDAY]: '' })
  const before = await fileOn(YESTERDAY)
  await svc.crossTheDay()
  assert.equal(await fileOn(YESTERDAY), before)
})

test('the terminator is not in anybody\'s undo stack', async t => {
  const { svc, fileOn } = await notebook(t, { [YESTERDAY]: 'Mid-sentence' })
  await svc.crossTheDay()
  assert.ok((await fileOn(YESTERDAY)).endsWith('\n'))

  // Undo with nothing of the person's own to undo must not reach back and pull
  // the day open again: a terminator you can undo into a mid-line day is a
  // control with no meaning (D62).
  await svc.text.undo()
  assert.ok((await fileOn(YESTERDAY)).endsWith('\n'), 'still closed')
})

test('THE POINT: writing past midnight files under the evening it started in', async t => {
  const { svc, set, type, fileOn } = await notebook(t, { [YESTERDAY]: 'Started in the evening.\n' }, EVENING, EVENING)
  assert.equal(svc.today, YESTERDAY)

  // 00:20, five minutes after the last sentence. The calendar has rolled.
  set(LATE)
  await type('Still going.\n')
  assert.equal(svc.clockDay, TODAY, 'the calendar says today')
  assert.equal(svc.today, YESTERDAY, 'and the notebook is still in last night')
  assert.match(await fileOn(YESTERDAY), /Still going\./)
  assert.equal(await fileOn(TODAY), '', 'nothing was filed under the new date')
})

test('and the boundary lands once they have stopped', async t => {
  const { svc, set, type, fileOn } = await notebook(t, { [YESTERDAY]: 'Evening.\n' }, EVENING, EVENING)
  set(LATE)
  await type('A line with no stop')

  set('2026-09-01T09:30:00Z') // seventy minutes later, nothing typed
  await svc.crossTheDay()
  assert.equal(svc.today, TODAY)
  assert.ok((await fileOn(YESTERDAY)).endsWith('\n'), 'the day they left is closed off')

  await type('A new morning.\n')
  assert.match(await fileOn(TODAY), /A new morning\./)
})

test('a boundary that is not there is not crossed', async t => {
  const { svc, set, type } = await notebook(t, { [YESTERDAY]: 'Evening.\n' }, EVENING, EVENING)
  set(LATE)
  await type('Still going.')
  set(new Date(new Date(LATE).getTime() + 20 * MINUTE).toISOString())
  await svc.crossTheDay()
  assert.equal(svc.today, YESTERDAY, 'twenty minutes is not getting up from the desk')
})
