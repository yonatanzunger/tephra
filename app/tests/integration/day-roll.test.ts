// Midnight, while the app is open.
//
// **Reported from use**: leave Tephra running overnight, come back and type,
// and the words continue YESTERDAY. Quitting and restarting then files the new
// day after text that belonged in it — so the mistake is not only invisible at
// the time, it is preserved in the order of the file.
//
// The day a notebook files into was decided when its window opened, and nothing
// ever asked again.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { NotebookService } from '../../src/main/services/notebook-service.ts'
import { msUntilNextDay, dateKeyAt } from '../../src/shared/dates.ts'

/** A clock the test moves by hand, so no test waits for a real midnight. */
function fixture(t: TestContext, start: Date) {
  let now = start
  return {
    at: (): Date => now,
    move: (ms: number): void => void (now = new Date(now.getTime() + ms)),
    async service() {
      const root = await mkdtemp(join(tmpdir(), 'tephra-day-'))
      const nb = await Notebook.open({ root, lock: false, watch: false })
      t.after(async () => {
    // **Stop the service, then close the notebook.** The write tiers are
    // timers; one nobody cancels holds the process open for its whole
    // interval after the tests have passed — which for a fixture that sets
    // a long one is a minute of wall clock for half a second of work. The
    // app does this on quit (D32); a test that starts a service is a
    // process that has to do it too.
    await svc.stop()
    await nb.close()
  })
      const svc = new NotebookService(nb, {
        history: false,
        now: () => now,
        dayCheckMs: 5,
      })
      return { svc, root }
    },
  }
}

/** Everything the renderer would hear. */
function listen(svc: NotebookService): { of: (channel: string) => unknown[] } {
  const heard: { channel: string; value: unknown }[] = []
  svc.addSink({ send: (channel, value) => heard.push({ channel, value }) })
  return { of: channel => heard.filter(h => h.channel === channel).map(h => h.value) }
}

const tick = (ms = 30): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * Wait for something to have happened, rather than for long enough.
 *
 * **Crossing a boundary became asynchronous** when main took on closing off the
 * day that ended before announcing it (D62) — so a single microtask flush no
 * longer covers a poll's work, and a fixed sleep would only move the flake
 * around.
 */
async function until(ready: () => boolean, capMs = 3000): Promise<void> {
  for (let waited = 0; waited < capMs && !ready(); waited += 20) await tick(20)
}

test('the day rolling is announced, once, to whoever is listening', async t => {
  // 23:59 in the reference zone, which is where this bug lives.
  const clock = fixture(t, new Date('2026-08-28T06:59:00Z'))
  const { svc } = await clock.service()
  const heard = listen(svc)

  await tick()
  assert.deepEqual(heard.of('tephra:doc:dayRolled'), [], 'nothing yet: it is still today')

  clock.move(msUntilNextDay(clock.at()) + 1_000)
  await until(() => heard.of('tephra:doc:dayRolled').length > 0)
  assert.deepEqual(heard.of('tephra:doc:dayRolled'), [dateKeyAt(clock.at())])

  clock.move(60_000)
  await tick()
  assert.equal(heard.of('tephra:doc:dayRolled').length, 1, 'and not again for the same day')
})

test('a machine asleep through midnight hears about it on waking', async t => {
  // The case a timer set FOR the boundary is worst at: it fires late and alone.
  // A poll simply notices, whenever the machine comes back.
  const clock = fixture(t, new Date('2026-08-28T06:00:00Z'))
  const { svc } = await clock.service()
  const heard = listen(svc)

  clock.move(9 * 60 * 60_000) // asleep from before midnight until morning
  await until(() => heard.of('tephra:doc:dayRolled').length > 0)
  assert.deepEqual(heard.of('tephra:doc:dayRolled'), [dateKeyAt(clock.at())])
})

test('and the service files into the new day afterwards, not the old one', async t => {
  const clock = fixture(t, new Date('2026-08-28T06:59:00Z'))
  const { svc } = await clock.service()
  const before = (await svc.text.info()).today

  clock.move(msUntilNextDay(clock.at()) + 1_000)
  let after = before
  await until(() => {
    void svc.text.info().then(info => (after = info.today))
    return after !== before
  })
  after = (await svc.text.info()).today
  assert.notEqual(after, before)
  assert.equal(after, dateKeyAt(clock.at()))
})

// ── the day has to be REAL before anything writes with it ───────────────────

test('THE SEED LANDS BEFORE A WRITE PICKS A DAY', async t => {
  // **The claim above this code used to be false.** It said *every door into
  // this object awaits `#seeded` first, so nothing can observe the wrong
  // answer*; six of about a hundred and fifty actually did, and `todoAdd`,
  // `todoToday` and `todoList` were not among them.
  //
  // The day cannot be known without I/O — it takes the newest written day, that
  // file's mtime and the notebook's zone — so a synchronous `today` is a guess
  // until the seed lands. A write racing startup filed its item under the guess
  // while every later read looked under the real day, and the item simply was
  // not there: no error, nothing in the file, an empty list.
  const root = await mkdtemp(join(tmpdir(), 'tephra-seed-'))
  // **A notebook whose newest written day is not the calendar day**, which is
  // what makes the guess and the truth differ at all. Written before the
  // service exists, so the seed has something to find.
  await mkdir(join(root, 'notebook.stream', '2026', '03'), { recursive: true })
  await writeFile(
    join(root, 'notebook.stream', '2026', '03', '2026-03-09.md'),
    '---\ndate: 2026-03-09\n---\n\nWriting late.\n',
  )
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const svc = new NotebookService(nb, {
    history: false,
    now: () => new Date('2026-03-10T09:00:00Z'),
    dayCheckMs: 24 * 60 * 60_000,
  })
  t.after(async () => {
    await svc.stop()
    await nb.close()
  })

  // **Nothing is awaited that would seed it first.** The other suites' helper
  // happens to call `info()`, which does await the seed — which is why this was
  // invisible everywhere except in the running app.
  const list = await svc.todo.list()
  const made = await svc.todo.add(list, 'Ring the dentist')

  // The day the write used and the day a read looks under are the same day.
  const today = await svc.todo.today(list)
  const items = await svc.todo.items(list, today)
  // **What the days ARE is the informative thing**, not what `today` says now:
  // by the time this line runs the seed has landed, so the service and the read
  // agree and only the file disagrees. The first version of this message
  // printed the same date twice and explained nothing.
  const days = await svc.todo.days(list).catch(() => [])
  assert.ok(
    items.some(one => one.id === made),
    `filed under a day nothing reads back: read ${String(today)}, list holds ${JSON.stringify(days)}`,
  )
})
