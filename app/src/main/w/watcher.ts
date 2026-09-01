// Watching the notebook for changes made outside the app.
//
// TWO RULES, both of which fail silently if broken.
//
// 1. WATCH DIRECTORIES, NEVER FILE DESCRIPTORS. An fd-based watcher dies
//    *without erroring* when a file is atomically replaced by rename — which is
//    how every well-behaved writer updates a file, including ours. It simply
//    stops firing, and the editor and the disk drift apart with nothing
//    reported. This is T5, and it is the reason hand-editing works at all.
//
// 2. RECOGNISE OUR OWN WRITES BY CONTENT, NOT BY TIME. Every atomic write fires
//    the watcher. If those events reached X they would look like external edits
//    and trigger a reload, which would fight the editor. The obvious fix — a
//    time window after each write during which events for that path are
//    ignored — silently drops a genuine hand-edit that lands inside the window.
//    Comparing content hashes has no window and no race: an event whose content
//    is exactly what we last wrote is ours, and anything else is not.

import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { hashContent, readText } from './atomic.ts'
import { isMachinery, type RelPath } from './layout.ts'

/**
 * Deliberately not 'created' vs 'modified'. A recursive watcher cannot reliably
 * tell them apart, and claiming to would be inventing information; X reloads
 * either way, and enumeration answers "is this new" better than a guess.
 */
export type FileChangeKind = 'changed' | 'deleted'

export interface FileChange {
  readonly rel: RelPath
  readonly kind: FileChangeKind
}

export interface WatcherOptions {
  /** Coalescing window. A single save can fire several raw events. */
  readonly debounceMs?: number
  /** Called when the watcher itself fails, which must never be silent. */
  readonly onError?: (err: Error) => void
}

const DEFAULT_DEBOUNCE_MS = 60

export class NotebookWatcher {
  readonly #root: string
  readonly #onChange: (changes: readonly FileChange[]) => void
  readonly #debounceMs: number
  readonly #onError: ((err: Error) => void) | undefined

  /** What we last wrote, per path. The basis of self-write suppression. */
  readonly #ourWrites = new Map<RelPath, string>()

  /**
   * Paths the app has actually touched — read or written.
   *
   * A DELETION is only reported for one of these. macOS reports events whose
   * filename is the watched root's own basename, which resolves to a path that
   * does not exist and would otherwise be announced as a deleted file at every
   * startup. More generally, the disappearance of something we never knew about
   * changes nothing for anyone above us, while the disappearance of a file we
   * have open is exactly what X must hear about.
   */
  readonly #known = new Set<RelPath>()

  #watcher: FSWatcher | null = null
  #pending = new Set<RelPath>()
  #timer: NodeJS.Timeout | null = null

  constructor(
    root: string,
    onChange: (changes: readonly FileChange[]) => void,
    options: WatcherOptions = {},
  ) {
    this.#root = root
    this.#onChange = onChange
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.#onError = options.onError
  }

  /**
   * Record that we just wrote `rel` with content hashing to `hash`. Events
   * matching it are ours and are suppressed.
   */
  noteOwnWrite(rel: RelPath, hash: string): void {
    this.#ourWrites.set(rel, hash)
    this.#known.add(rel)
  }

  /** Reading counts as touching: a file we have open may later be deleted. */
  noteRead(rel: RelPath): void {
    this.#known.add(rel)
  }

  start(): void {
    if (this.#watcher !== null) return
    // recursive: on macOS this is FSEvents, which reports paths relative to the
    // watched root and survives the rename in an atomic replace.
    this.#watcher = watch(this.#root, { recursive: true, persistent: true }, (_event, filename) => {
      if (filename === null) return
      const rel = filename.split(/[\\/]/).join('/')
      if (this.#ignored(rel)) return
      this.#pending.add(rel)
      this.#schedule()
    })
    this.#watcher.on('error', err => {
      this.#onError?.(err instanceof Error ? err : new Error(String(err)))
    })
  }

  stop(): void {
    this.#watcher?.close()
    this.#watcher = null
    if (this.#timer !== null) clearTimeout(this.#timer)
    this.#timer = null
    this.#pending.clear()
  }

  #ignored(rel: RelPath): boolean {
    // `.tephra/` is machine-local and we write it constantly — the WAL alone
    // would be a permanent event storm. `.git/` is worse than an event storm:
    // committing rewrites it, so reporting it as an external change makes the
    // commit tier feed itself forever. Temp files are ours mid-write.
    if (isMachinery(rel)) return true
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    return name.startsWith('.') && name.includes('.tmp-')
  }

  #schedule(): void {
    if (this.#timer !== null) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.#drain()
    }, this.#debounceMs)
  }

  async #drain(): Promise<void> {
    const batch = [...this.#pending]
    this.#pending.clear()
    if (batch.length === 0) return

    const changes: FileChange[] = []
    for (const rel of batch) {
      const abs = join(this.#root, rel)

      // Stat before reading, and for a reason found by a test: creating a
      // directory fires an event for it, and reading a directory fails. Folding
      // that failure into "content is null" reported every new `notebook.stream/2026/03`
      // as a DELETED FILE — the loudest possible wrong answer, on the ordinary
      // path of writing the first note of a month.
      const info = await stat(abs).catch(() => null)

      if (info === null) {
        // Gone. If we had a record of writing it, it is no longer true.
        this.#ourWrites.delete(rel)
        if (this.#known.delete(rel)) changes.push({ rel, kind: 'deleted' })
        continue
      }

      // Directory events describe structure, not content. The files inside
      // arrive as their own events.
      if (!info.isFile()) continue

      const content = await readText(abs)
      if (content === null) continue // vanished between stat and read; its own event will follow

      this.#known.add(rel)
      const hash = hashContent(content)
      if (this.#ourWrites.get(rel) === hash) continue // our own write, echoed back

      // Someone else's. Forget what we thought was there — the next comparison
      // must be against reality, not against a write that has been overwritten.
      this.#ourWrites.delete(rel)
      changes.push({ rel, kind: 'changed' })
    }

    if (changes.length > 0) this.#onChange(changes)
  }
}
