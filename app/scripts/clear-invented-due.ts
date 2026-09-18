// **Disposable.** Brings every generated item's due date into line with D93.
//
//     cd app && npx tsx scripts/clear-invented-due.ts [--write] [root]
//
// Delete this file once the notebooks that matter have been swept. It exists
// because D93 changed *which* generated items have a due date, and the pass
// deliberately does not fix the ones it already wrote: a date the person typed
// and a date the old rule invented are indistinguishable once in the file, so
// clearing them automatically would eventually clear somebody's deadline. A
// one-off with a dry run is the honest way to do it once.
//
// ## What it does
//
// For every step on every live docket that has generated an item, it computes
// what D93 says that item's due date should be —
//
//   - an explicit `DUE` written on the step, or
//   - the occasion's date, if the step is a run-up (*N days before*),
//   - otherwise none
//
// — and sets it, through `Tasks.setDue`, when the item disagrees. So a `+0d`
// step's item loses the date the old rule gave it, and a run-up's item **gains**
// the right one, since the old rule gave it its own day instead of the
// occasion's.
//
// **Archived dockets are left alone** (D91): their matters are finished, their
// items resolved, and a date on a resolved item is a true statement about how
// something was worked rather than a claim about the future.
//
// **Items nothing generated are never touched.** If it has no step pointing at
// it, its date is the person's and this script has no opinion about it.
//
// ## Safety
//
// A dry run by default, the lock honoured, and a version saved before the first
// write — the same three as `migrate-items.ts`, for the same reasons.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../src/main/w/notebook.ts'
import { NotebookService } from '../src/main/services/notebook-service.ts'
import { readDue } from '../src/shared/kinds/todo.ts'
import { dueOn } from '../src/shared/kinds/docket.ts'
import { addDays } from '../src/shared/dates.ts'
import { isArchive, type RelPath } from '../src/main/w/layout.ts'
import type { DateKey, DocumentId } from '../src/shared/document-api.ts'

const args = process.argv.slice(2)
const write = args.includes('--write')
const root = args.find(a => !a.startsWith('--')) ?? join(homedir(), 'Tephra')

async function main(): Promise<void> {
  console.log(`${write ? 'SWEEPING' : 'dry run over'} ${root}`)
  const notebook = await Notebook.open({ root, lock: true, watch: false })
  const service = new NotebookService(notebook, { history: write })
  try {
    if (write) {
      const recovered = await service.recover()
      if (recovered > 0) console.log(`  recovered ${recovered} unsaved edit(s) first`)
    }

    const lists = await service.corpus.list('todo')
    // **Every day of every list, because a generated item lives on the day it
    // was generated** and stays there once it is resolved; only the live ones
    // carry forward. Looking at today alone would leave the rest as they are,
    // which for a date that is simply wrong is not good enough.
    const where = new Map<string, { list: DocumentId; day: DateKey; due: DateKey | null; text: string }>()
    for (const list of lists) {
      for (const day of await service.todo.days(list)) {
        for (const item of await service.todo.items(list, day)) {
          if (item.id !== null) where.set(item.id, { list, day, due: item.due, text: item.text })
        }
      }
    }

    const plan: {
      list: DocumentId
      item: string
      was: DateKey | null
      want: DateKey | null
      why: string
      /** Its date is NOT what the old rule computed — so it may be a person's. */
      mine: boolean
      text: string
    }[] = []

    for (const docket of await service.corpus.list('docket')) {
      if (isArchive(docket as string as RelPath)) continue
      for (const matter of await service.docket.matters(docket)) {
        for (const step of matter.steps) {
          if (step.made === null) continue
          const item = where.get(step.made)
          if (item === undefined) continue // generated, then deleted outright
          const said = readDue(step.text)
          const runUp = step.when.kind === 'at' && step.when.offset.startsWith('-')
          const want = said.due ?? (runUp ? matter.when.start : null)
          if ((want ?? null) === (item.due ?? null)) continue
          // **Is the date on this item one the OLD rule computed?** That rule
          // was `dueOn` — the step's own day — so a generated item whose date
          // equals it was almost certainly written by the pass, and one that
          // differs may be a date the person typed afterwards. This script
          // cannot tell the two apart with certainty and does not pretend to;
          // what it can do is say which is which, so the dry run is a decision
          // rather than a leap.
          const byTheOldRule = dueOn(step, matter, addDays)
          plan.push({
            list: item.list,
            item: step.made,
            was: item.due,
            want: want ?? null,
            why: said.due !== null ? 'DUE on the step' : runUp ? 'run-up: the occasion' : 'no clock',
            mine: item.due !== null && item.due !== byTheOldRule,
            text: item.text.slice(0, 54),
          })
        }
      }
    }

    console.log(`  ${where.size} item(s) across ${lists.length} list(s); ${plan.length} to correct`)
    for (const one of plan) {
      console.log(`    ${one.mine ? '!' : ' '} ${String(one.was ?? '—').padEnd(11)} → ` +
        `${String(one.want ?? '—').padEnd(11)} ${one.why.padEnd(20)} ${one.text}`)
    }
    const mine = plan.filter(one => one.mine).length
    console.log(mine === 0
      ? '  every date here is exactly what the old rule computed: none of them was typed'
      : `  ${mine} marked ! do NOT match the old rule and may be dates somebody typed`)
    if (!write || plan.length === 0) {
      if (!write && plan.length > 0) console.log('\n  --write to apply')
      return
    }

    await service.openHistory()
    const [back] = await service.pastVersions.versions(1)
    console.log(
      back === undefined
        ? '  NO HISTORY in this notebook — there is no way back but a copy'
        : `  the way back: restore to ${back.id} (${back.reason ?? 'unnamed'})`,
    )

    for (const one of plan) await service.todo.setDue(one.list, one.item, one.want)
    await service.flush()
    console.log(`  corrected ${plan.length} item(s)`)
  } finally {
    await service.stop()
    await notebook.close()
  }
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
