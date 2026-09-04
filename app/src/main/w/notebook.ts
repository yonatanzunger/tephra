// The notebook directory as W presents it to X: relative paths in, text out,
// atomic writes, and a change feed for edits made outside the app.
//
// X asks for `notebook.stream/2026/03/2026-03-14.md`; W knows where the root is
// and what
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
  /**
   * Take the lock even if somebody appears to hold it.
   *
   * **Only ever from a person saying so** (see `lock.ts`). Pid liveness cannot
   * tell a crashed Tephra from an unrelated process that inherited its pid, and
   * the person is the only one who knows whether they have another window open.
   */
  readonly seize?: boolean
  /**
   * How often a holder checks the lock is still its own. Tests make it small.
   *
   * Overridable for the reason `dayCheckMs` is: a suite that waits out the real
   * interval spends seconds of wall clock on milliseconds of work, and this one
   * has already been made to pay that once.
   */
  readonly lockCheckMs?: number
}

/**
 * Another Tephra has taken the notebook while we were holding it.
 *
 * Thrown from every write, so nothing reaches a corpus this process no longer
 * owns — the corruption the lock exists to prevent, arriving through the door
 * that taking over opened.
 */
export class NotebookLostError extends Error {
  constructor() {
    super('another copy of Tephra has taken over this notebook')
    this.name = 'NotebookLostError'
  }
}

/** How often a holder checks that the lock is still its own. */
const LOCK_CHECK_MS = 3_000

export class Notebook {
  readonly root: string
  readonly #lock: NotebookLock | null
  #watcher: NotebookWatcher | null = null
  readonly #listeners = new Set<(changes: readonly FileChange[]) => void>()
  /** Set once somebody else's name is on the lock. Never unset: it is terminal. */
  #lost = false
  #lockTimer: ReturnType<typeof setInterval> | null = null
  readonly #lostListeners = new Set<() => void>()

  readonly #lockCheckMs: number

  private constructor(root: string, lock: NotebookLock | null, lockCheckMs: number) {
    this.root = root
    this.#lock = lock
    this.#lockCheckMs = lockCheckMs
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

    const notebook = new Notebook(
      root,
      options.lock === false ? null : new NotebookLock(join(root, LOCAL.lock)),
      options.lockCheckMs ?? LOCK_CHECK_MS,
    )
    if (options.seize === true) await notebook.#lock?.seize()
    else await notebook.#lock?.acquire()
    notebook.#watchTheLock()

    // Watch BEFORE bootstrapping, not after. The writes below are ours, and a
    // watcher started afterwards has no record of them — so the events they
    // already queued arrive looking like someone else's hand-edits, and X
    // reloads at startup for no reason. Ordering, not filtering, is the fix.
    if (options.watch !== false) notebook.#startWatching()

    if (!(await notebook.has(LOCAL.version))) {
      await notebook.write(LOCAL.version, `${STATE_VERSION}\n`)
    }
    if (!(await notebook.has('.gitignore'))) {
      await notebook.write('.gitignore', GITIGNORE)
    }

    return notebook
  }

  /**
   * Notice if the lock stops being ours, and say so once.
   *
   * **Polled rather than watched**, because the question is about a file this
   * process did not write and the answer has to be right even if the watcher is
   * off — and because one small read every few seconds is not worth being
   * clever about. Terminal by design: there is no coming back from another
   * process owning the notebook, so this fires once and stops asking.
   */
  #watchTheLock(): void {
    if (this.#lock === null) return
    this.#lockTimer = setInterval(() => {
      void this.#lock?.stillMine().then(mine => {
        if (mine || this.#lost) return
        this.#lost = true
        this.#stopWatchingTheLock()
        for (const listener of this.#lostListeners) listener()
      })
    }, this.#lockCheckMs)
    this.#lockTimer.unref?.()
  }

  #stopWatchingTheLock(): void {
    if (this.#lockTimer !== null) clearInterval(this.#lockTimer)
    this.#lockTimer = null
  }

  /** Somebody else has the notebook. Nothing this process does may reach disk. */
  get lost(): boolean {
    return this.#lost
  }

  onLost(handler: () => void): () => void {
    this.#lostListeners.add(handler)
    return () => this.#lostListeners.delete(handler)
  }

  /** Absolute path for a relative one. Not exported to X — W owns the root. */
  #abs(rel: RelPath): string {
    return join(this.root, rel)
  }

  async read(rel: RelPath): Promise<string | null> {
    const text = await readText(this.#abs(rel))
    // Reading counts as touching: a file the app has open is one whose deletion
    // it must hear about.
    if (text !== null) this.#watcher?.noteRead(rel)
    return text
  }

  /**
   * Atomic, and self-identifying: the watcher is told the content hash so the
   * event this write is about to cause is recognised as ours rather than
   * mistaken for a hand-edit.
   */
  async write(rel: RelPath, content: string): Promise<void> {
    // **The gate is here, on the one path everything writes through.** Stopping
    // the tiers and closing the windows is the tidy half of losing the lock; a
    // write that slips past while that happens is the half that costs a corpus.
    if (this.#lost) throw new NotebookLostError()
    const { hash } = await writeAtomic(this.#abs(rel), content)
    this.#watcher?.noteOwnWrite(rel, hash)
  }

  async remove(rel: RelPath): Promise<void> {
    if (this.#lost) throw new NotebookLostError()
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
    return this.#walk(subdir, false)
  }

  /**
   * The same, INSIDE `.tephra/` — the only way to enumerate the machinery.
   *
   * `list` excludes it on purpose: the corpus is what a person wrote, and a
   * caller asking for the notebook's files does not mean the write-ahead log.
   * But the machinery has to be enumerable by the code that owns it — the index
   * cannot sweep a cache it cannot list — so it gets its own door rather than a
   * flag on the front one.
   */
  async listMachinery(subdir: RelPath): Promise<readonly RelPath[]> {
    return isLocal(subdir) ? this.#walk(subdir, true) : []
  }

  async #walk(subdir: RelPath, machinery: boolean): Promise<readonly RelPath[]> {
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
        if (!machinery && (isLocal(child) || entry.name.startsWith('.'))) continue
        if (machinery && entry.name.startsWith('.')) continue // a torn temp file
        if (entry.isDirectory()) await walk(child)
        else out.push(child)
      }
    }
    await walk(subdir)
    return out.sort()
  }

  /**
   * Size and modification time, in one call and without reading the file.
   *
   * **This is the whole staleness check for the index** (D52): a cached entry
   * whose stamp still matches is trusted, and one that does not is rescanned.
   * Two numbers from a `stat` rather than a hash of the contents, because the
   * point is to avoid reading seven thousand files to find the three that moved.
   */
  async stamp(rel: RelPath): Promise<{ size: number; mtime: number } | null> {
    try {
      const info = await stat(this.#abs(rel))
      return { size: info.size, mtime: info.mtimeMs }
    } catch {
      return null
    }
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
    this.#stopWatchingTheLock()
    await this.#lock?.release()
  }
}
