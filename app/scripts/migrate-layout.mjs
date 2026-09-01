// Move `stream/` to `notebook.stream/` (MT1, D59).
//
// **A directory carries its kind in its name, exactly as a file does.** Until
// this ran, the stream was the one document whose id was not a path and whose
// kind had to be special-cased everywhere a path was classified. Renaming the
// directory retires that: `kindOf('notebook.stream')` answers `'stream'` the
// same way `kindOf('sections/x.fileset.md')` answers `'fileset'`.
//
// **What this does NOT do is fix history.** The notebook is git-versioned and
// `StreamHistory` reads past versions by path, so versions committed before
// this ran are unreachable through Tephra's restore afterwards. That is a
// deliberate, recorded trade (D59): closing the seam would mean a compatibility
// branch carried forever, and there is nothing critical behind it. Git still
// has every one of those versions.
//
// Run it with Tephra closed, against the notebook directory:
//
//     node scripts/migrate-layout.mjs ~/Notebook
//
// `--dry-run` says what it would do and touches nothing.

import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const root = args.find(a => !a.startsWith('-'))

if (root === undefined) {
  console.error('usage: node scripts/migrate-layout.mjs <notebook-dir> [--dry-run]')
  process.exit(2)
}

const from = join(root, 'stream')
const to = join(root, 'notebook.stream')

const exists = async path => {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

if (!(await exists(join(root, '.tephra')))) {
  console.error(`${root} does not look like a Tephra notebook (no .tephra/).`)
  process.exit(1)
}

// Already done is a success, not an error: this must be safe to run twice.
if (!(await exists(from))) {
  console.log(
    (await exists(to))
      ? `Already migrated: ${to} exists and there is no stream/ left.`
      : `Nothing to do: neither stream/ nor notebook.stream/ is in ${root}.`,
  )
  process.exit(0)
}
if (await exists(to)) {
  console.error(`Both stream/ and notebook.stream/ exist in ${root}. Sort that out by hand.`)
  process.exit(1)
}

/**
 * **Refuse while the log has anything in it.**
 *
 * A WAL record names the document it belongs to (`doc`), and after this the
 * stream is called something else — so unreplayed records would be addressed to
 * a document that no longer exists, and the edits in them are by definition the
 * ones that never reached a file. Opening and closing Tephra replays them,
 * which costs a few seconds and is the whole fix.
 */
const wal = join(root, '.tephra', 'wal')
const pending = []
for (const name of await readdir(wal).catch(() => [])) {
  if (!name.endsWith('.jsonl')) continue
  const text = await readFile(join(wal, name), 'utf8').catch(() => '')
  if (text.trim() !== '') pending.push(name)
}
if (pending.length > 0) {
  console.error(
    `The write-ahead log is not empty (${pending.join(', ')}).\n` +
      'Those are edits that never reached a file, and they name the stream by its old id.\n' +
      'Open Tephra once and quit it — that replays them — then run this again.',
  )
  process.exit(1)
}

const index = join(root, '.tephra', 'index')

if (dry) {
  console.log(`would rename ${from} → ${to}`)
  if (await exists(index)) console.log(`would delete ${index} (a cache, keyed by path)`)
  process.exit(0)
}

await rename(from, to)
// The index is keyed by file path, so every entry in it now names a file that
// is not there. It is a cache and throwing it away is free (D52) — which is
// exactly the property that makes this a two-line migration.
await rm(index, { recursive: true, force: true })

console.log(
  `Migrated ${root}\n` +
    `  stream/ → notebook.stream/\n` +
    '  .tephra/index cleared; it rebuilds on the next open\n' +
    '\nThe rename is uncommitted. Tephra commits it on its next version tier.\n' +
    'Restore cannot reach versions from before this point (D59); git still can.',
)
