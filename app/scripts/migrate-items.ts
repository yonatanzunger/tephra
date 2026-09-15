// **Disposable.** Converts a notebook's task items to the field form (D85, MT8).
//
//     cd app && npx tsx scripts/migrate-items.ts [--write] [root]
//
// Delete this file once the notebooks that matter have been converted. It exists
// because D85 changed how an item is written, not what an item is — and the one
// thing a format change owes you is a way to see exactly what it will do before
// it does it.
//
// ## Why it is nearly nothing
//
// `parseBlock` reads the old inline form as well as the new field form, so
// converting a file is **reading it and writing it**. The app's own `adopt` does
// precisely that — it rewrites any block whose bytes would differ, mints ids for
// hand-written lines, and resolves relative dates — so this drives the real verb
// rather than reimplementing it. Which means:
//
//   - it is **idempotent**: a second run rewrites nothing, and a partial run is
//     finished by running again;
//   - it goes through the **journal and the write tiers**, so a crash mid-way
//     leaves a recoverable notebook rather than half a file;
//   - and it is exercised every day by the tests that cover `adopt`.
//
// ## Safety
//
// **A dry run by default.** Without `--write` it reports what would change and
// touches nothing — which took a fix: recovering the journal is itself a write,
// so that step is now gated on `--write` like everything else. With it, a **version is saved first** (D32), so the way back
// is a restore rather than a backup somebody has to remember to take.
//
// **The lock is honoured**, so it refuses to run while Tephra has the notebook
// open — two writers on one corpus is the one failure that is not recoverable.

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Notebook } from '../src/main/w/notebook.ts'
import { NotebookService } from '../src/main/services/notebook-service.ts'
import { itemBlock, scanItems } from '../src/shared/kinds/todo.ts'
import { TodoDocument } from '../src/main/x/documents/kinds/todo.ts'
import type { DocumentId, SegmentKey } from '../src/shared/document-api.ts'

const args = process.argv.slice(2)
const write = args.includes('--write')
const root = args.find(a => !a.startsWith('--')) ?? join(homedir(), 'Tephra')

async function main(): Promise<void> {
  console.log(`${write ? 'CONVERTING' : 'dry run over'} ${root}`)
  const notebook = await Notebook.open({ root, lock: true, watch: false })
  const service = new NotebookService(notebook, { history: write })
  try {
    // **Only when writing**, because recovery *is* a write: it replays the
    // journal into the documents and flushes. A dry run that did it would have
    // changed the notebook it claimed to be only looking at — which it did, on
    // the first run of this script, and is the reason for this comment.
    //
    // It touches the stream and not the task lists, so a dry run's plan is
    // unaffected by skipping it.
    if (write) {
      const recovered = await service.recover()
      if (recovered > 0) console.log(`  recovered ${recovered} unsaved edit(s) first`)
    }

    const lists = await service.corpus.list('todo')
    if (lists.length === 0) console.log('  no task lists in this notebook')

    let items = 0
    let converting = 0
    const plan: { list: DocumentId; day: SegmentKey; blocks: number }[] = []

    for (const list of lists) {
      await service.corpus.use(list, async doc => {
        const todo = doc as TodoDocument
        for (const day of await todo.keys()) {
          const body = await todo.bodyOf(day)
          let differ = 0
          for (const found of scanItems(body)) {
            items += 1
            if (itemBlock(found.item) !== body.slice(found.from, found.blockTo)) differ += 1
          }
          if (differ > 0) plan.push({ list, day, blocks: differ })
          converting += differ
        }
      }, { mode: 'read' })
    }

    console.log(`  ${items} item(s) across ${lists.length} list(s); ${converting} to convert`)
    for (const one of plan) console.log(`    ${one.list as string} ${one.day as string}: ${one.blocks}`)
    if (!write || converting === 0) {
      if (!write && converting > 0) console.log('\n  --write to apply')
      return
    }

    // **The way back.** A restore, rather than a backup somebody has to
    // remember to take (D32) — and recorded before a single byte moves.
    //
    // `openHistory` is what does it: it opens the repository and commits
    // whatever was outstanding, as *Changes made outside Tephra*. Asking
    // `saveVersion()` afterwards reports nothing, because by then there is
    // nothing to commit — which the first version of this script printed as *no
    // history in this notebook*, a sentence that was wrong in the one place it
    // most needed to be right. So it names the version you would restore TO.
    await service.openHistory()
    const [back] = await service.pastVersions.versions(1)
    console.log(
      back === undefined
        ? '  NO HISTORY in this notebook — there is no way back but a copy'
        : `  the way back: restore to ${back.id} (${back.reason ?? "unnamed"})`,
    )

    let written = 0
    for (const { list, day } of plan) {
      // **`adopt` is the conversion**: it rewrites any block whose bytes would
      // differ, which is exactly what reading the old form and writing the new
      // one comes to.
      written += await service.corpus.use(list, async doc => (doc as TodoDocument).adopt(day))
    }
    await service.flush()
    console.log(`  converted ${written} block(s)`)
  } finally {
    await service.stop()
    await notebook.close()
  }
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
