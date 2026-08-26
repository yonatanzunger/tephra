// Where the corpus index is kept (D52).
//
// **A cache, and nothing else.** Everything here is derived from files that are
// authoritative, machine-local, never committed and never synced. Deleting
// `.tephra/index` must cost nothing but the time to scan again — which is why
// this file has no repair path, no versioning and no migration: a shape it does
// not recognise is a cache it throws away.
//
// It knows nothing about what it stores. The payload is opaque, because spans
// belong to X and this is W: the store's job is files, stamps and atomicity.

import type { Notebook } from './notebook.ts'
import { indexFile, type RelPath } from './layout.ts'

/** What `stat` says, and what makes a cached entry trustworthy or not. */
export interface Stamp {
  readonly size: number
  readonly mtime: number
}

export interface Cached<T> {
  readonly stamp: Stamp
  readonly payload: T
}

/** One directory's worth, keyed by file name within that directory. */
export type Entries<T> = ReadonlyMap<string, Cached<T>>

export class IndexStore<T> {
  readonly #notebook: Notebook

  constructor(notebook: Notebook) {
    this.#notebook = notebook
  }

  /**
   * What is cached for one directory.
   *
   * **A file that will not parse comes back empty rather than throwing.** A
   * corrupt cache is not a corrupt corpus: the honest response is to have
   * nothing and rebuild, and an exception here would turn a disposable file
   * into an application error.
   */
  async read(dir: RelPath): Promise<Entries<T>> {
    const text = await this.#notebook.read(indexFile(dir))
    if (text === null) return new Map()
    try {
      const parsed = JSON.parse(text) as Record<string, Cached<T>>
      const out = new Map<string, Cached<T>>()
      for (const [name, entry] of Object.entries(parsed)) {
        if (
          typeof entry?.stamp?.size === 'number' &&
          typeof entry.stamp.mtime === 'number' &&
          entry.payload !== undefined
        ) {
          out.set(name, entry)
        }
      }
      return out
    } catch {
      return new Map()
    }
  }

  /**
   * Replace one directory's entries.
   *
   * Atomic, through the notebook's own write: a reader never sees half a
   * directory, which is what lets a rebuild run in the background beside
   * someone reading the sidebar.
   */
  async write(dir: RelPath, entries: Entries<T>): Promise<void> {
    if (entries.size === 0) {
      await this.drop(dir)
      return
    }
    const object: Record<string, Cached<T>> = {}
    for (const [name, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      object[name] = entry
    }
    await this.#notebook.write(indexFile(dir), `${JSON.stringify(object, null, 1)}\n`)
  }

  async drop(dir: RelPath): Promise<void> {
    await this.#notebook.remove(indexFile(dir))
  }

  /** Every directory this store holds something for. */
  async directories(): Promise<readonly RelPath[]> {
    const home = indexFile('').replace(/\/_root\.json$/, '') as RelPath
    const found = await this.#notebook.listMachinery(home)
    return found
      .filter(rel => rel.endsWith('.json'))
      .map(rel => rel.slice(home.length + 1).replace(/\.json$/, ''))
      .map(dir => (dir === '_root' ? '' : dir)) as RelPath[]
  }

  /** Throw the whole cache away. The corpus is untouched; this costs time. */
  async clear(): Promise<void> {
    for (const dir of await this.directories()) await this.drop(dir)
  }
}
