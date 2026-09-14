// The horizon — everything bearing down, whatever its source (MH2, H8, D74).
//
// **Its own object, tested on its own**, with the docket as one of the things
// that implements it rather than the thing it is made of. The claims worth making
// are about what is *not* on it as much as what is: a commitment counted twice,
// or a date invented for a step that has not earned one, are the two ways this
// stops being trustworthy.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../../src/main/w/notebook.ts'
import { inHorizon, orderHorizon, type HorizonRow } from '../../src/shared/horizon-api.ts'
import type { DateKey } from '../../src/shared/document-api.ts'
import { withoutMarks } from '../../src/shared/kinds/todo.ts'

async function serviced(t: TestContext, at = '2026-03-10T09:00:00Z') {
  const root = await mkdtemp(join(tmpdir(), 'tephra-horizon-'))
  const nb = await Notebook.open({ root, lock: false, watch: false })
  const { DocumentService } = await import('../../src/main/services/document-service.ts')
  let clock = new Date(at)
  const service = new DocumentService(nb, {
    now: () => clock,
    history: false,
    dayCheckMs: 24 * 60 * 60_000,
  })
  t.after(async () => {
    await service.stop()
    await nb.close()
  })
  await service.info()
  return {
    root,
    service,
    async on(day: string): Promise<void> {
      clock = new Date(`${day}T09:00:00Z`)
      await service.crossTheDay()
    },
  }
}

// ── the horizon's own rules ─────────────────────────────────

test('THE WINDOW IS INCLUSIVE AT BOTH ENDS, and runs behind as well as ahead', async () => {
  const window = { from: '2026-03-03' as DateKey, to: '2026-03-17' as DateKey }
  assert.equal(inHorizon('2026-03-03' as DateKey, window), true)
  assert.equal(inHorizon('2026-03-17' as DateKey, window), true)
  assert.equal(inHorizon('2026-03-02' as DateKey, window), false)
  assert.equal(inHorizon('2026-03-18' as DateKey, window), false)
})

test('AND THE ORDER IS THE WORLD BEFORE YOUR OWN COMMITMENTS, within a day', async () => {
  // The volition/imposition cut H8 draws, applied to the sort rather than to a
  // second region — which is the shape MT5a rejected.
  const row = (kind: HorizonRow['kind'], text: string, on = '2026-03-10'): HorizonRow => ({
    on: on as DateKey, text, kind, doc: 'x' as never,
    matter: null, instance: null, item: null, id: null,
  })
  const order = orderHorizon([
    row('due', 'a deadline I set'),
    row('task', 'work asked of me'),
    row('status', 'something happening to me'),
    row('status', 'yesterday', '2026-03-09'),
  ])
  assert.deepEqual(order.map(one => one.text),
    ['yesterday', 'something happening to me', 'work asked of me', 'a deadline I set'])
})

test('and the order is TOTAL, so a redraw cannot shuffle rows about', async () => {
  const row = (text: string): HorizonRow => ({
    on: '2026-03-10' as DateKey, text, kind: 'task', doc: 'x' as never,
    matter: null, instance: null, item: null, id: null,
  })
  const one = orderHorizon([row('b'), row('a'), row('c')]).map(r => r.text)
  const two = orderHorizon([row('c'), row('b'), row('a')]).map(r => r.text)
  assert.deepEqual(one, two)
  assert.deepEqual(one, ['a', 'b', 'c'])
})

// ── the sources, joined ─────────────────────────────────────

test('THE POINT OF THE PHASE: dated matters and dated tasks are one list', async t => {
  // Built against both sources from the start, which `notes.md` records failing
  // six times over when a view is built against one and fitted to the second.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'The ACM talk', { mode: 'event', start: '2026-03-20' })
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'file the return DUE 2026-03-15')

  const rows = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  // **And the DUE marker is off the task row**: the horizon has already put the
  // date in its own column, so `DUE 2026-03-15` beside a heading that says
  // *15 Mar* is the same fact twice in two notations. Stripped by the todo
  // module, which owns that grammar, rather than by a second copy of the regex.
  assert.deepEqual(rows.map(one => [one.on, one.kind, one.text]), [
    ['2026-03-15', 'due', 'file the return'],
    ['2026-03-20', 'status', 'The ACM talk'],
  ])
  assert.equal(rows[0]?.item, item)
  assert.equal(rows[1]?.matter, 'The ACM talk')
  void item
})

test('AND THE TWO SOURCES DO NOT OVERLAP: a generated step is on the list, not here', async t => {
  // The rule that keeps one commitment from being counted twice. A task step
  // that has generated *is* the item in front of you; a horizon row beside it
  // would be the same thing said again in a place that means *not yet*.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  // **A step that is not due yet**, so there is something on the horizon to
  // watch cross over. Activating generates whatever is due *as part of the act*
  // now (MH4), so a step due today is on the list before this test can look.
  const soon = await service.docketAddStep(id, car, '+5d', 'collect it')
  await service.docketActivate(id, car)

  // The seeded step generated on activation, so it is the LIST's row and carries
  // a date; the step five days out has not, so it is the DOCKET's. One each, on
  // opposite sides, which is the disjointness this is about.
  const before = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  assert.deepEqual(before.map(one => [one.kind, one.text]), [
    ['due', 'The car needs fixing'],
    ['task', 'collect it'],
  ])

  // Bring its day round, and it crosses from the horizon to the list — where it
  // reappears as a `due` row, since a generated task carries its date now. The
  // claim is that it is on ONE side at a time, not that it vanishes.
  await service.docketSetStepWhen(id, car, soon, '+0d')
  const after = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  assert.deepEqual(after.map(one => one.kind), ['due', 'due'], 'the list\'s, not the docket\'s')
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks).sort(),
    ['The car needs fixing', 'collect it'])
})

test('A ROW IS THE SHORT LINE: no link markup, no tags, no due date', async t => {
  // **Reported from use**, with a Google Docs URL sprawling across three lines
  // of a strip meant to be glanced at — and the tag and the due date beside it,
  // both of which the row says elsewhere or not at all. Every summarising
  // surface in the app had been assembling this for itself, which is why it is
  // now one function (`shortLine`) at the top of `plain.ts`'s ladder.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  await service.todoAdd(list,
    "Review Steve's [bio draft](https://docs.google.com/document/d/1t8me/edit) #career DUE 2026-03-15")
  // And a docket step, which has no spans to consult and takes the other rung.
  const talk = await service.docketAdd(id, 'The ACM talk', { mode: 'event', start: '2026-03-20' })
  await service.docketAddStep(id, talk, '2d', 'read the [programme](https://acm.example/p)', 'status')

  const rows = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  assert.deepEqual(rows.map(one => one.text), [
    "Review Steve's bio draft",
    'read the programme',
    'The ACM talk',
  ])
  assert.equal(rows.some(one => one.text.includes('http')), false, 'no URL anywhere')
})

test('A REMINDER FINALLY HAS SOMEWHERE TO GO (H6), which MH3a left inert', async t => {
  // The phase's other end condition: awareness with no task is a thing no TODO
  // item can express, and until now it was authored and went nowhere.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const day = await service.docketAdd(id, 'Ada’s birthday',
    { mode: 'recurring-event', every: '1y', start: '2026-11-15' })
  await service.docketAddStep(id, day, '90d', 'work out what the plan is', 'status')

  const rows = await service.horizon('2026-08-01' as DateKey, '2026-12-01' as DateKey)
  assert.deepEqual(rows.map(one => [one.on, one.kind, one.text]), [
    ['2026-08-17', 'status', 'work out what the plan is'],
    ['2026-11-15', 'status', 'Ada’s birthday'],
  ])
  await service.reconcile()
  const list = await service.todoList()
  assert.deepEqual(
    (await service.todoItems(list, service.today)).map(one => one.text),
    [],
    'and it generates nothing, ever',
  )
})

test('A STANDING MATTER IS NOT ON THE HORIZON AT ALL, having no date to be on', async t => {
  // H7b's third kind. Giving it a date is the point of the review, and a horizon
  // that guessed one would be inventing a commitment.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Repaint the house', { mode: 'task' })
  assert.deepEqual(await service.horizon('2020-01-01' as DateKey, '2030-01-01' as DateKey), [])
})

test('AND NOR IS A STEP WHOSE ANTECEDENT IS UNFINISHED', async t => {
  // Not shown as undated, not guessed at: its moment has not been earned.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const car = await service.docketAdd(id, 'The car needs fixing', { mode: 'task' })
  await service.docketAddStep(id, car, 'then', 'have the car fixed')
  await service.docketActivate(id, car)
  // The first step is on the LIST, having been generated by the activation; the
  // dependent one is on neither, its moment not having been earned.
  const rows = await service.horizon('2026-03-01' as DateKey, '2027-01-01' as DateKey)
  assert.deepEqual(rows.map(one => one.kind), ['due'], 'the generated one, as a dated task')
  const list = await service.todoList()
  assert.deepEqual((await service.todoItems(list, service.today)).map(withoutMarks),
    ['The car needs fixing'])
})

test('A RECURRENCE SWEEPS ITS INSTANCES, and each row says which one it is', async t => {
  // Two occurrences of one recurrence can land in one window, and an unlabelled
  // pair of them is worse than either alone.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Pay the water bill',
    { mode: 'recurring-event', every: '1m', start: '2026-03-15' })
  const rows = await service.horizon('2026-03-01' as DateKey, '2026-06-01' as DateKey)
  assert.deepEqual(rows.map(one => one.on), ['2026-03-15', '2026-04-15', '2026-05-15'])
  assert.deepEqual(rows.map(one => one.instance), ['2026-03-15', '2026-04-15', '2026-05-15'])
})

test('and the sweep keeps the anchored day, rather than drifting off a clamp', async t => {
  // The same rule the tick obeys, in the place it would be quietly reimplemented:
  // a horizon that swept from a clamped February would show the 28th for ever.
  const { service } = await serviced(t, '2026-01-05T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Read the meter',
    { mode: 'recurring-event', every: '1m', start: '2026-01-31' })
  const rows = await service.horizon('2026-01-01' as DateKey, '2026-05-01' as DateKey)
  assert.deepEqual(rows.map(one => one.on),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
})

test('A COMPLETION-DRIVEN RECURRENCE SHOWS ONE INSTANCE, not a guessed sequence', async t => {
  // The next one depends on a day that has not happened. Sweeping it would be
  // asserting when somebody is going to get round to something.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'Change the air filter',
    { mode: 'recurring-task', every: '3m', start: '2026-03-20' })
  const rows = await service.horizon('2026-03-01' as DateKey, '2027-03-01' as DateKey)
  assert.deepEqual(rows.map(one => one.on), ['2026-03-20'])
})

test('THE WINDOW RUNS BEHIND AS WELL AS AHEAD, because overdue is bearing down too', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  await service.docketAdd(id, 'The ACM talk', { mode: 'event', start: '2026-03-06' })
  const list = await service.todoList()
  await service.todoAdd(list, 'file the return DUE 2026-03-02')
  const rows = await service.horizon('2026-03-03' as DateKey, '2026-03-17' as DateKey)
  assert.deepEqual(rows.map(one => one.on), ['2026-03-06'], 'and the window is a window both ways')
})

test('and a finished task is off it, an item being dated only while it is live', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  await service.newDocument('The house', undefined, 'docket')
  const list = await service.todoList()
  const item = await service.todoAdd(list, 'file the return DUE 2026-03-15')
  assert.equal((await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)).length, 1)
  await service.todoSetStatus(list, item, 'done')
  assert.deepEqual(await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey), [])
})

test('AND IT IS DATE-ORDERED ACROSS DOCKETS, which is the restored spreadsheet', async t => {
  // What no single docket's view can give: every major commitment in one list.
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const house = await service.newDocument('The house', undefined, 'docket')
  const work = await service.newDocument('Work', undefined, 'docket')
  await service.docketAdd(house, 'The boiler service', { mode: 'event', start: '2026-03-25' })
  await service.docketAdd(work, 'The ACM talk', { mode: 'event', start: '2026-03-18' })
  await service.docketAdd(house, 'The survey', { mode: 'event', start: '2026-03-12' })
  const rows = await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)
  assert.deepEqual(rows.map(one => one.text),
    ['The survey', 'The ACM talk', 'The boiler service'])
  assert.deepEqual([...new Set(rows.map(one => one.doc))].length, 2)
})

test('and a suspended matter drops off it, which is what suspending MEANS', async t => {
  const { service } = await serviced(t, '2026-03-10T09:00:00Z')
  const id = await service.newDocument('The house', undefined, 'docket')
  const talk = await service.docketAdd(id, 'The ACM talk', { mode: 'event', start: '2026-03-20' })
  assert.equal((await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey)).length, 1)
  await service.docketSuspend(id, talk)
  assert.deepEqual(await service.horizon('2026-03-01' as DateKey, '2026-04-01' as DateKey), [])
})
