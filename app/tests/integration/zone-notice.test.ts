// The offer to follow the machine to a new zone (D63).
//
// **Reported from use**: change the system timezone from Los Angeles to Tel
// Aviv with two Tephra windows open, and the two windows offer to move the
// notebook in OPPOSITE directions — one proposes Jerusalem, the other proposes
// Los Angeles. Each renderer had resolved the machine's zone for itself, and a
// renderer's `Intl` is fixed when its context is created, so the window opened
// before the change and the window opened after it disagreed forever.
//
// The cure is the rule the published `zone` already followed: main answers, and
// every window is told the same thing.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { DocumentService } from '../../src/main/document-service.ts'
import { CHANNEL } from '../../src/shared/ipc.ts'
import type { ZoneNotice } from '../../src/shared/ipc.ts'

const HOME = 'America/Los_Angeles'
const AWAY = 'Asia/Jerusalem'

/** A service whose machine can be picked up and put down somewhere else. */
async function fixture(t: TestContext, start = HOME) {
  let machine = start
  const root = await mkdtemp(join(tmpdir(), 'tephra-zone-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const svc = new DocumentService(nb, {
    history: false,
    systemZone: () => machine,
    dayCheckMs: 24 * 60 * 60_000,
  })
  t.after(async () => {
    await svc.stop()
    await nb.close()
  })
  await svc.setZone(HOME)

  // Two windows, which is where the bug lived. Each takes what main sends it.
  const heard: ZoneNotice[][] = [[], []]
  for (const [i] of heard.entries()) {
    svc.addSink({
      send: (channel: string, payload: unknown) => {
        if (channel === CHANNEL.zoneNotice) heard[i]?.push(payload as ZoneNotice)
      },
    } as never)
  }
  return { svc, heard, fly: (to: string) => (machine = to) }
}

test('a machine in the same zone as the notebook has nothing to say', async t => {
  const { svc } = await fixture(t)
  assert.equal(svc.zoneNotice, null)
})

test('THE OFFER: moving the machine names both zones, in one direction', async t => {
  const { svc, fly } = await fixture(t)
  fly(AWAY)
  assert.deepEqual(svc.zoneNotice, { notebook: HOME, system: AWAY })
})

test('THE BUG: every window is told the same thing, at the same time', async t => {
  // Not "each window works it out": that is what produced two windows proposing
  // opposite moves. One answer, pushed to all of them.
  const { svc, heard, fly } = await fixture(t)
  fly(AWAY)
  await svc.crossTheDay()
  assert.deepEqual(heard[0], [{ notebook: HOME, system: AWAY }])
  assert.deepEqual(heard[1], heard[0], 'and the second window heard exactly the first')
})

test('the offer is not repeated at every poll', async t => {
  const { svc, heard, fly } = await fixture(t)
  fly(AWAY)
  await svc.crossTheDay()
  await svc.crossTheDay()
  await svc.crossTheDay()
  assert.equal(heard[0]?.length, 1)
})

test('taking it moves the notebook, and the offer goes away everywhere', async t => {
  const { svc, heard, fly } = await fixture(t)
  fly(AWAY)
  await svc.crossTheDay()

  await svc.setZone(AWAY)
  assert.equal(svc.zone, AWAY, 'the notebook files there now')
  assert.equal(svc.zoneNotice, null)
  assert.deepEqual(heard[0]?.at(-1), null, 'and both windows were told to put the row away')
  assert.deepEqual(heard[1]?.at(-1), null)
})

test('declining it is shared too: dismissing in one window dismisses in both', async t => {
  // Three windows each asking the same question is the same defect as three
  // windows asking different ones.
  const { svc, heard, fly } = await fixture(t)
  fly(AWAY)
  await svc.crossTheDay()

  svc.dismissZone()
  assert.equal(svc.zoneNotice, null, 'and the notebook did not move')
  assert.equal(svc.zone, HOME)
  assert.deepEqual(heard[1]?.at(-1), null)

  await svc.crossTheDay()
  assert.equal(heard[1]?.length, 2, 'and it does not come back on the next poll')
})

test('a window that learned by ASKING is still told to put the row away', async t => {
  // Found in acceptance, not here: a window opening between two polls gets the
  // notice from its opening question rather than from a push, so nothing was
  // recorded as sent — and adopting the zone then computed "nothing changed"
  // and told nobody. The row stayed up over a notebook that had already moved.
  const { svc, heard, fly } = await fixture(t)
  fly(AWAY)
  assert.deepEqual(svc.askZoneNotice(), { notebook: HOME, system: AWAY })

  // And asking on behalf of one window answers for all of them, which is the
  // same defect seen from the other side: a window opening between two polls
  // learns something main had no reason to look for yet.
  assert.deepEqual(heard[1]?.at(-1), { notebook: HOME, system: AWAY })

  await svc.setZone(AWAY)
  assert.deepEqual(heard[0]?.at(-1), null, 'and the row is taken down everywhere')
  assert.deepEqual(heard[1]?.at(-1), null)
})

test('but declining Jerusalem is not declining everywhere else', async t => {
  const { svc, fly } = await fixture(t)
  fly(AWAY)
  svc.dismissZone()
  assert.equal(svc.zoneNotice, null)

  fly('Europe/Zurich')
  assert.deepEqual(svc.zoneNotice, { notebook: HOME, system: 'Europe/Zurich' }, 'a new place asks again')
})

test('a zone this build cannot compute in is not offered', async t => {
  const { svc, fly } = await fixture(t)
  fly('Mars/Olympus_Mons')
  assert.equal(svc.zoneNotice, null)
})
