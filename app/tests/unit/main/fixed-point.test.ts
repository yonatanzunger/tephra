// The fixed-point machinery, on synthetic functions.
//
// **Several of these carry an explicit timeout.** A re-entrancy regression does
// not fail — it HANGS, because a function would be waiting on the run that is
// waiting on it. Proven by removing the guard: the file wedged rather than
// reporting anything, and it wedged in an earlier test than the one written to
// catch it. A timeout turns a hang back into a failure.
//
// **Synthetic on purpose.** The case this exists for — two functions undoing
// each other's work — cannot be produced from the real reconciler, which is
// exactly why it has to be produced here. Same for a legitimate long catch-up,
// which must NOT be mistaken for one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FixedPoints,
  type RunReport,
  type FixedPointFunction,
} from '../../../src/main/fixed-point.ts'

/** The registration shape, so a test spells out only what it cares about. */
const fn = (
  name: string,
  trigger: FixedPointFunction['trigger'],
  pass: () => Promise<void>,
): FixedPointFunction => ({ name, trigger, pass })

// ── routing ────────────────────────────────────────────────────────────────

test('A KEY NOBODY WAITS FOR costs nothing', async () => {
  const table = new FixedPoints()
  const ran: string[] = []
  table.register(fn('dockets', '^docket:', async () => void ran.push('dockets')))
  await table.changed('todo:tasks.todo.md')
  assert.deepEqual(ran, [])
})

test('THE POINT: a function runs when its key changes, and the caller waits', async () => {
  const table = new FixedPoints()
  const order: string[] = []
  table.register(
    fn('dockets', '^docket:', async () => {
      await new Promise(r => setTimeout(r, 5))
      order.push('pass')
    }),
  )
  await table.changed('docket:house')
  order.push('caller resumed')
  // **The verb's promise has to mean the work is done.** Fire-and-forget was
  // tried: `docketActivate` resolved before the task it implied existed, so a
  // caller reading the list straight afterwards got the old answer.
  assert.deepEqual(order, ['pass', 'caller resumed'])
})

test('a string trigger is a pattern, not a prefix', async () => {
  const table = new FixedPoints()
  const woken: string[] = []
  table.register(fn('any docket', 'docket:', async () => void woken.push('a')))
  table.register(fn('one docket', '^docket:house$', async () => void woken.push('b')))
  await table.changed('docket:house')
  assert.deepEqual(woken.sort(), ['a', 'b'])
  woken.length = 0
  await table.changed('docket:shed')
  assert.deepEqual(woken, ['a'], 'the anchored one did not match')
})

test('and a function trigger does what a pattern cannot', async () => {
  const table = new FixedPoints()
  let woke = 0
  table.register(fn('even ids', key => Number(key.split(':')[1]) % 2 === 0, async () => void woke++))
  await table.changed('doc:4')
  await table.changed('doc:7')
  assert.equal(woke, 1)
})

test('A NAME IS AN IDENTITY: registering one twice is refused', () => {
  const table = new FixedPoints()
  table.register(fn('dockets', '^d:', async () => undefined))
  assert.throws(
    () => table.register(fn('dockets', '^d:', async () => undefined)),
    /already registered/,
  )
})

test('UNREGISTERING STOPS IT, which is what a closed notebook needs', async () => {
  // The reason this is one table per notebook and not one per process: the
  // integration suites build a fresh service per test, in one process, and a
  // table nothing ever left would invoke every closed notebook's functions.
  const table = new FixedPoints()
  let woke = 0
  const off = table.register(fn('gone', '^k$', async () => void woke++))
  await table.changed('k')
  off()
  await table.changed('k')
  assert.equal(woke, 1)
})

// ── running to a fixed point ───────────────────────────────────────────────

test('A FUNCTION THAT WAKES ITSELF gets another round, then stops', { timeout: 5_000 }, async () => {
  // The shape of the real reconciler: writing is how it works, and its own
  // writes come back through the same door as anybody else's.
  const table = new FixedPoints()
  let left = 3
  let rounds = 0
  table.register(
    fn('countdown', '^k:', async () => {
      rounds += 1
      if (left > 0) {
        left -= 1
        await table.changed('k:one') // a write made by the work itself
      }
    }),
  )
  await table.changed('k:one')
  // Three rounds that did work, and one that found nothing left to do.
  assert.equal(rounds, 4)
  assert.equal(left, 0)
})

test("a function's own write does not deadlock the run awaiting it", { timeout: 5_000 }, async () => {
  // **Why re-entrancy is asked with async context and not a boolean.** The run
  // waits for the work; work waiting for the run would wait for itself.
  const table = new FixedPoints()
  table.register(fn('self', '^k:', async () => void (await table.changed('k:one'))))
  const settled = await Promise.race([
    table.changed('k:one').then(() => 'settled'),
    new Promise(r => setTimeout(() => r('hung'), 2_000)),
  ])
  assert.equal(settled, 'settled')
})

test('NOR ACROSS FUNCTIONS: A waking B mid-work does not deadlock', { timeout: 5_000 }, async () => {
  // **The case a per-runner flag would have missed.** B is not running, so a
  // flag local to B says *go ahead and wait* — while the turnstile is held by A.
  // The async context is shared for exactly this.
  const table = new FixedPoints()
  const ran: string[] = []
  table.register(
    fn('a', '^a$', async () => {
      ran.push('a')
      await table.changed('b')
    }),
  )
  table.register(fn('b', '^b$', async () => void ran.push('b')))
  const settled = await Promise.race([
    table.changed('a').then(() => 'settled'),
    new Promise(r => setTimeout(() => r('hung'), 2_000)),
  ])
  assert.equal(settled, 'settled')
  assert.deepEqual(ran, ['a', 'b'], 'and B did run')
})

test('AN OUTSIDE WRITE DURING A PASS STILL WAITS', { timeout: 5_000 }, async () => {
  // **The test that decides whether async context is worth its weight.**
  //
  // A boolean *is a pass in flight?* is true for the whole DURATION of a pass —
  // and other work genuinely interleaves in that window, because the pass awaits
  // its own writes and the queue serves other writers meanwhile. So a boolean
  // tells a second window's write *you are inside the work*, and it returns
  // without waiting: `docketActivate` resolving before the task it implied
  // existed, which is the reported bug, reproduced under a race.
  //
  // Async context asks the narrower question that is the real one: *is this call
  // descended from the work?* This one is not, so it waits.
  const table = new FixedPoints()
  let bRan = false
  table.register(fn('slow', '^a$', async () => void (await new Promise(r => setTimeout(r, 40)))))
  table.register(fn('b', '^b$', async () => void (bRan = true)))
  const slow = table.changed('a')
  await new Promise(r => setTimeout(r, 10)) // now inside slow's pass, from outside it
  await table.changed('b')
  assert.equal(bRan, true, 'the caller waited for its own function to run')
  await slow
})

test('MONOTONE SATURATION: a cycle of keys converges rather than spinning', { timeout: 5_000 }, async () => {
  // The real convergence argument in miniature: steps unblock steps, so even a
  // cycle among them merely makes every member active — and then there is
  // nothing further to change. Monotone accumulation on a finite set reaches a
  // fixed point whatever order it runs in.
  const table = new FixedPoints()
  const active = new Set<string>()
  const unblocks: Record<string, string> = { a: 'b', b: 'c', c: 'a' } // a cycle
  let rounds = 0
  table.register(
    fn('steps', '^step:', async () => {
      rounds += 1
      for (const [from, to] of Object.entries(unblocks)) {
        if (active.has(from) && !active.has(to)) {
          active.add(to)
          await table.changed(`step:${to}`)
        }
      }
    }),
  )
  active.add('a')
  await table.changed('step:a')
  assert.deepEqual([...active].sort(), ['a', 'b', 'c'])
  assert.ok(rounds < 10, `saturated in ${rounds} rounds`)
})

test('ONE TURN AT A TIME, because read-then-write must not interleave', async () => {
  // Note 51: two overlapping passes each read *this step has made nothing*
  // before either wrote, and both generated. Two DIFFERENT functions reading and
  // writing the same document race in exactly the same way — so state is per
  // function and execution is not.
  const table = new FixedPoints()
  let inside = 0
  let overlapped = false
  const slow = async (): Promise<void> => {
    inside += 1
    if (inside > 1) overlapped = true
    await new Promise(r => setTimeout(r, 5))
    inside -= 1
  }
  table.register(fn('one', '^k$', slow))
  table.register(fn('two', '^k$', slow))
  await table.changed('k')
  assert.equal(overlapped, false)
})

test('A FUNCTION THAT THROWS does not take the run with it', async () => {
  const table = new FixedPoints()
  const ran: string[] = []
  table.register(
    fn('angry', '^k$', async () => {
      ran.push('angry')
      throw new Error('no')
    }),
  )
  table.register(fn('calm', '^k$', async () => void ran.push('calm')))
  await table.changed('k')
  assert.deepEqual(ran.sort(), ['angry', 'calm'])
})

test('ASKING THOUGH NOTHING MOVED is an ordinary key', async () => {
  // Startup and the day boundary: nothing changed, and the question is still
  // *what should be true now*. A synthetic key rather than a side door, so
  // there is one path into the machinery — and so a divergence report says
  // which round began because somebody asked.
  const table = new FixedPoints()
  const ran: string[] = []
  table.register(fn('a', '^(docket|asked):', async () => void ran.push('a')))
  table.register(fn('b', '^docket:', async () => void ran.push('b')))
  await table.changed('asked:reconcile')
  assert.deepEqual(ran, ['a'], 'and it is routed like any other key')
})

test('EVERY RUN IS REPORTED, which is where the log comes from', async () => {
  // **One report for both endings**, because the useful information is the
  // same: the rounds and their keys read as a log line when it went well and as
  // a debugging trail when it did not. This replaced `reconcile()`'s return
  // value, which existed for one `console.log` and for tests.
  const table = new FixedPoints()
  const reports: RunReport[] = []
  table.onRun(r => void reports.push(r))
  table.register(fn('dockets', '^docket:', async () => undefined))
  await table.changed('docket:house')
  assert.equal(reports.length, 1)
  const report = reports[0] as RunReport
  assert.equal(report.pass, 'dockets')
  assert.equal(report.rounds, 1)
  assert.equal(report.diverged, null, 'it settled')
  assert.deepEqual(report.history, [['docket:house']])
  assert.equal(report.summary, 'dockets: settled in 1 round')
})

// ── divergence ─────────────────────────────────────────────────────────────

test('A LEGITIMATE CATCH-UP IS NOT DIVERGENCE, however many writes', { timeout: 5_000 }, async () => {
  // **The false alarm this design has to avoid.** A recurring matter whose
  // notebook was shut for a year advances through every interval it missed —
  // hundreds of real writes to the same field, all inside one round. Counting
  // reports would condemn it; counting ROUNDS sees one round, once.
  const table = new FixedPoints()
  const reports: RunReport[] = []
  table.onRun(r => void (r.diverged !== null && reports.push(r)))
  let caught = false
  table.register(
    fn('advance', '^docket:', async () => {
      if (caught) return
      caught = true
      for (let i = 0; i < 400; i += 1) await table.changed('docket:house#start')
    }),
  )
  await table.changed('docket:house#start')
  assert.deepEqual(reports, [], 'four hundred writes in one round is one round')
  assert.ok(table.highWater <= 2, `high water ${table.highWater}`)
})

test('DIVERGENCE IS CAUGHT AND REPORTED, rather than spun for ever', { timeout: 5_000 }, async () => {
  const table = new FixedPoints()
  const reports: RunReport[] = []
  table.onRun(r => void (r.diverged !== null && reports.push(r)))
  let flag = false
  table.register(
    fn('sets it', '^flag$', async () => {
      flag = true
      await table.changed('flag')
    }),
  )
  table.register(
    fn('clears it', '^flag$', async () => {
      flag = false
      await table.changed('flag')
    }),
  )
  await table.changed('flag')
  assert.ok(reports.length >= 1, `reported ${reports.length}`)
  const report = reports[0] as RunReport
  assert.equal(report.diverged, 'flag')
  assert.ok(report.rounds > 20, `gave up after ${report.rounds} rounds`)
  assert.equal(report.history.length, report.rounds, 'the trail is one entry per round')
  assert.deepEqual(report.history[0], ['flag'], 'and each entry is that round’s keys')
  assert.match(report.summary, /gave up after \d+ rounds — flag kept changing/)
  void flag
})

test('and the run ENDS when abandoned — the write is not undone', { timeout: 5_000 }, async () => {
  // A function that will not converge must not make every write fail: the write
  // succeeded, and what failed is rebuilding what derives from it.
  const table = new FixedPoints()
  table.register(fn('never settles', '^k$', async () => void (await table.changed('k'))))
  await table.changed('k') // resolves rather than rejecting or hanging
})

test('ONE FUNCTION DIVERGING LEAVES ANOTHER WORKING', { timeout: 5_000 }, async () => {
  // **What the split buys.** Each runner keeps its own queue, rounds and
  // threshold, so one giving up neither blames nor wedges the other.
  //
  // Note they must watch DIFFERENT keys for this to mean anything. A first
  // version had both triggering on the spinner's key, and the innocent function
  // diverged too — correctly, because it really was being told the same thing
  // twenty-six times. Routing is what isolates; the split is what keeps the
  // books apart.
  const table = new FixedPoints()
  const reports: RunReport[] = []
  table.onRun(r => void (r.diverged !== null && reports.push(r)))
  let calm = 0
  table.register(fn('spinner', '^spin$', async () => void (await table.changed('spin'))))
  table.register(fn('calm', '^calm$', async () => void calm++))

  await table.changed('spin')
  assert.ok(reports.length >= 1, 'the spinner gave up')
  assert.ok(
    reports.every(one => one.pass === 'spinner'),
    `blamed ${JSON.stringify(reports.map(one => one.pass))}`,
  )

  // And the machinery still works afterwards, which a merged "is running" state
  // would not have guaranteed.
  await table.changed('calm')
  assert.equal(calm, 1, 'ran once and settled')
})
