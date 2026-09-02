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
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocumentService } from '../../src/main/document-service.ts'
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
      const svc = new DocumentService(nb, {
        history: false,
        now: () => now,
        dayCheckMs: 5,
      })
      return { svc, root }
    },
  }
}

/** Everything the renderer would hear. */
function listen(svc: DocumentService): { of: (channel: string) => unknown[] } {
  const heard: { channel: string; value: unknown }[] = []
  svc.addSink({ send: (channel, value) => heard.push({ channel, value }) })
  return { of: channel => heard.filter(h => h.channel === channel).map(h => h.value) }
}

const tick = (ms = 30): Promise<void> => new Promise(r => setTimeout(r, ms))

test('the day rolling is announced, once, to whoever is listening', async t => {
  // 23:59 in the reference zone, which is where this bug lives.
  const clock = fixture(t, new Date('2026-08-28T06:59:00Z'))
  const { svc } = await clock.service()
  const heard = listen(svc)

  await tick()
  assert.deepEqual(heard.of('tephra:doc:dayRolled'), [], 'nothing yet: it is still today')

  clock.move(msUntilNextDay(clock.at()) + 1_000)
  await tick()
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
  await tick()
  assert.deepEqual(heard.of('tephra:doc:dayRolled'), [dateKeyAt(clock.at())])
})

test('and the service files into the new day afterwards, not the old one', async t => {
  const clock = fixture(t, new Date('2026-08-28T06:59:00Z'))
  const { svc } = await clock.service()
  const before = (await svc.info()).today

  clock.move(msUntilNextDay(clock.at()) + 1_000)
  await tick()

  const after = (await svc.info()).today
  assert.notEqual(after, before)
  assert.equal(after, dateKeyAt(clock.at()))
})
