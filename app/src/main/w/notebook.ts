// The notebook directory as W presents it to X: relative paths in, text out,
// atomic writes, and a change feed for edits made outside the app.
//
// X asks for `stream/2026/03/2026-03-14.md`; W knows where the root is and what
// atomic means. Nothing above this layer opens a file, and nothing below it
// knows what a day is.

import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Unsubscribe } from '../../shared/document-api.ts'
import { exists, readText, remove, writeAtomic } from './atomic.ts'
import { LOCAL, REQUIRED_DIRS, STATE_VERSION, isLocal, type RelPath } from './layout.ts'
import { NotebookLock } from './lock.ts'
import { NotebookWatcher, type FileChange } from './watcher.ts'

/**
 * A stable, visible path — not an opaque store inside an application support
 * directory (D5). That is what makes the exit structural rather than
 * aspirational: the files are where a person would look for them.
 */
export const DEFAULT_ROOT = join(homedir(), 'Tephra')

/** `.tephra/` is machine-local and disposable; it must never reach the repository. */
const GITIGNORE = `# Machine-local state: WAL, derived index, caches, UI position.
# Disposable by design (D7) — deleting it costs a rebuild and nothing else.
${LOCAL.version.split('/')[0]}/
`

export interface OpenOptions {
  readonly root?: string
  /** Off for tests that only want the filesystem surface. */
  readonly lock?: boolean
  readonly watch?: boolean
}

export class Notebook {
  readonly root: string
  readonly #lock: NotebookLock | null
  #watcher: NotebookWatcher | null = null
  readonly #listeners = new Set<(changes: readonly FileChange[]) => void>()

  private constructor(root: string, lock: NotebookLock | null) {
    this.root = root
    this.#lock = lock
  }

  /**
   * Create the tree if absent, take the lock, and start watching.
   *
   * Creating on open is deliberate: Q7(d) asks what a first launch against an
   * empty directory does, and the answer that costs nothing is *make it work*.
   */
  static async open(options: OpenOptions = {}): Promise<Notebook> {
    const root = resolve(options.root ?? DEFAULT_ROOT)

    for (const dir of REQUIRED_DIRS) await mkdir(join(root, dir), { recursive: true })

    const notebook = new Notebook(root, options.lock === false ? null : new NotebookLock(join(root, LOCAL.lock)))
    await notebook.#lock?.acquire()

    if (!(await notebook.has(LOCAL.version))) {
      await notebook.write(LOCAL.version, `${STATE_VERSION}\n`)
    }
    if (!(await notebook.has('.gitignore'))) {
      await notebook.write('.gitignore', GITIGNORE)
    }

    if (options.watch !== false) notebook.#startWatching()
    return notebook
  }

  /** Absolute path for a relative one. Not exported to X — W owns the root. */
  #abs(rel: RelPath): string {
    return join(this.root, rel)
  }

  async read(rel: RelPath): Promise<string | null> {
    return readText(this.#abs(rel))
  }

  /**
   * Atomic, and self-identifying: the watcher is told the content hash so the
   * event this write is about to cause is recognised as ours rather than
   * mistaken for a hand-edit.
   */
  async write(rel: RelPath, content: string): Promise<void> {
    const { hash } = await writeAtomic(this.#abs(rel), content)
    this.#watcher?.noteOwnWrite(rel, hash)
  }

  async remove(rel: RelPath): Promise<void> {
    await remove(this.#abs(rel))
  }

  async has(rel: RelPath): Promise<boolean> {
    return exists(this.#abs(rel))
  }

  /**
   * Every file under `subdir`, relative to the root, sorted.
   *
   * Only ever called for enumeration — never on the hot path. `.tephra/` is
   * excluded because it is not part of the corpus.
   */
  async list(subdir: RelPath = ''): Promise<readonly RelPath[]> {
    const out: RelPath[] = []
    const walk = async (rel: RelPath): Promise<void> => {
      let entries
      try {
        entries = await readdir(this.#abs(rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const child = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (isLocal(child) || entry.name.startsWith('.')) continue
        if (entry.isDirectory()) await walk(child)
        else out.push(child)
      }
    }
    await walk(subdir)
    return out.sort()
  }

  async sizeOf(rel: RelPath): Promise<number | null> {
    try {
      return (await stat(this.#abs(rel))).size
    } catch {
      return null
    }
  }

  /** External changes only — our own writes never reach here (see watcher.ts). */
  onExternalChange(handler: (changes: readonly FileChange[]) => void): Unsubscribe {
    this.#listeners.add(handler)
    return () => this.#listeners.delete(handler)
  }

  #startWatching(): void {
    this.#watcher = new NotebookWatcher(
      this.root,
      changes => {
        for (const listener of this.#listeners) listener(changes)
      },
      {
        onError: err => {
          // A dead watcher is T5 exactly: the app keeps working while quietly
          // ceasing to notice the disk. It must be loud.
          console.error('[tephra] notebook watcher failed:', err)
        },
      },
    )
    this.#watcher.start()
  }

  async close(): Promise<void> {
    this.#watcher?.stop()
    this.#watcher = null
    this.#listeners.clear()
    await this.#lock?.release()
  }
}
