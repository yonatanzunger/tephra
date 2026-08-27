// The corpus: W's file system, as X is allowed to see it (D54).
//
// **X reaches a document only through here, and a file only through a
// document.** There is no second path and no "unless it is not open" clause —
// opening is cheap, so there is nothing for a second path to do. The version of
// that rule with a hole in it, *an open document answers for itself and the disk
// answers otherwise*, is two implementations of one question, and the hedge is
// where they drift apart.
//
// Not called `Repository`: that names the version store (D32, D43), and a third
// meaning of one word is how the coordinate bugs started (D48). `Corpus` is what
// the design documents have always called the body of text, and this is its face.
//
// **This is the floor of X.** Everything in `x/` outside this directory is built
// on documents; only what is here may see the notebook.
//
// A NOTE ON THE NAME `Document`: it is also a DOM global, and Electron's own
// type definitions pull the DOM's into scope even in the main process — so a
// bare `Document` here binds silently to a browser type and fails several lines
// later complaining about `createElement`. Import ours explicitly. This is D35's
// `Window` lesson, arriving through the other half of the same door.

import type { Notebook } from '../../w/notebook.ts'
import { kindOf, type RelPath } from '../../w/layout.ts'
import { StreamDocument } from '../stream-document.ts'
import type {
  Divergence, DocumentChange, DocumentId, DocumentKind, SegmentKey, Unsubscribe,
} from '../../../shared/document-api.ts'
import type { JournalEdit, StoredDocument } from './stored.ts'

/** The stream is a document whose id is not a path, because it is not a file. */
export const STREAM_ID = 'stream' as DocumentId

/**
 * What kind of access a borrow is.
 *
 * **The lesson storage systems learned about buffer caches**, and the answer to
 * eviction rather than a refinement of it: a batch pass and an interactive open
 * want opposite things from a cache, and only the caller knows which it is. An
 * interactive borrow is the default, because the safe answer should be what you
 * get by not thinking; a scan is the one that has to say so.
 */
export interface Borrow {
  /** `read` refuses edits, so nothing opened for a scan can dirty anything. */
  readonly mode?: 'read' | 'write'
  /** Whether this opening should stay in the cache. */
  readonly retain?: boolean
}

/** How many documents the cache holds. Large enough that ordinary use never evicts. */
const CACHE = 32

/** What a read-only borrow refuses. Everything that can change a document. */
const MUTATORS = new Set([
  'replace', 'undo', 'redo', 'writeDirty', 'flush', 'reload', 'branch', 'importText',
  'tag', 'untag', 'renameTag', 'setAnchor', 'removeAnchor', 'restoreTo',
  'startComment', 'reply', 'editComment', 'resolveComment', 'react', 'assign', 'removeComment',
])

export class Corpus {
  readonly #notebook: Notebook
  readonly #limit: number

  /**
   * **The OPENING, not the opened.**
   *
   * Two borrows racing on a cold id must not both construct a document, and the
   * obvious shape — check the map, await the open, store the result — is
   * check-then-act across an await. The segment cache did exactly that once and
   * two reads of one day raced; holding the promise is what fixed it there and
   * is what this map holds for the same reason.
   */
  readonly #opened = new Map<DocumentId, Promise<StoredDocument>>()

  /** Borrows in flight, per id: a document in use is never evicted. */
  readonly #borrowed = new Map<DocumentId, number>()

  /** Windows pointing at a document. The only meaning "open" has (D54). */
  readonly #watched = new Map<DocumentId, number>()

  /**
   * What a document's own events are unsubscribed by when it is evicted.
   *
   * **Subscription has no lifetime of its own here**, which is why this exists.
   * The service used to subscribe once, at construction, to the one document
   * there was. With documents opening and being let go, that is not a place a
   * subscription can live — so the Corpus subscribes when it opens, drops the
   * subscription when it evicts, and re-emits everything with the document's
   * id. Whoever cares subscribes once, to this.
   */
  readonly #unsubscribe = new Map<DocumentId, Unsubscribe[]>()

  readonly #changed = new Set<(id: DocumentId, change: DocumentChange) => void>()
  readonly #journal = new Set<
    (id: DocumentId, segment: SegmentKey, baseLen: number, edits: readonly JournalEdit[]) => void
  >()
  readonly #diverged = new Set<(id: DocumentId, divergence: Divergence) => void>()

  constructor(notebook: Notebook, options: { cache?: number } = {}) {
    this.#notebook = notebook
    this.#limit = options.cache ?? CACHE
  }

  /**
   * Borrow a document for the length of one piece of work.
   *
   * **A borrow, not a handle to keep.** The scoped form is the API because it
   * cannot leak: it ends when the work does, returned or thrown. A front end
   * opening a handle per window and closing it later would make correctness
   * depend on a message arriving — and a close dropped on the way is a document
   * held forever.
   *
   * Two guarantees, and they are the whole contract: two callers asking for one
   * id get the SAME object, and it stays valid while the work runs.
   */
  async use<T>(id: DocumentId, work: (doc: StoredDocument) => Promise<T>, how: Borrow = {}): Promise<T> {
    const opening = this.#opened.get(id) ?? this.#openDocument(id)
    // A `retain: false` borrow uses the cache if the document is already there
    // — one object per id is the contract — it just does not ADD to it.
    if (how.retain !== false || this.#opened.has(id)) this.#remember(id, opening)

    this.#borrowed.set(id, (this.#borrowed.get(id) ?? 0) + 1)
    try {
      const doc = await opening
      return await work(how.mode === 'read' ? readOnly(doc) : doc)
    } finally {
      const left = (this.#borrowed.get(id) ?? 1) - 1
      if (left <= 0) this.#borrowed.delete(id)
      else this.#borrowed.set(id, left)
      await this.#evict()
    }
  }

  /**
   * A window is pointing at this document; do not let go of it.
   *
   * Returns the release. This is not a lease on validity — a borrow gives that
   * — it is what keeps a document in the cache while something outside holds a
   * reference to it, which windows do.
   */
  watch(id: DocumentId): Unsubscribe {
    this.#watched.set(id, (this.#watched.get(id) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (this.#watched.get(id) ?? 1) - 1
      if (left <= 0) this.#watched.delete(id)
      else this.#watched.set(id, left)
    }
  }

  /** Every document there is, or every one of a kind. */
  async list(kind?: DocumentKind): Promise<readonly DocumentId[]> {
    const out: DocumentId[] = []
    if (kind === undefined || kind === 'stream') out.push(STREAM_ID)
    for (const rel of await this.#notebook.list()) {
      const found = kindOf(rel)
      if (found === null || found === 'stream') continue // stream files are the stream's
      if (kind !== undefined && found !== kind) continue
      out.push(rel as string as DocumentId)
    }
    return out
  }

  async exists(id: DocumentId): Promise<boolean> {
    if (id === STREAM_ID) return true
    return this.#notebook.has(id as string as RelPath)
  }

  // ── what documents say, said once for all of them ──────────

  onChanged(handler: (id: DocumentId, change: DocumentChange) => void): Unsubscribe {
    this.#changed.add(handler)
    return () => this.#changed.delete(handler)
  }

  onJournal(
    handler: (id: DocumentId, segment: SegmentKey, baseLen: number, edits: readonly JournalEdit[]) => void,
  ): Unsubscribe {
    this.#journal.add(handler)
    return () => this.#journal.delete(handler)
  }

  onDiverged(handler: (id: DocumentId, divergence: Divergence) => void): Unsubscribe {
    this.#diverged.add(handler)
    return () => this.#diverged.delete(handler)
  }

  /** For tests and diagnostics: what is being held, and why it cannot go. */
  held(): readonly { id: DocumentId; watched: boolean; borrowed: boolean }[] {
    return [...this.#opened.keys()].map(id => ({
      id,
      watched: (this.#watched.get(id) ?? 0) > 0,
      borrowed: (this.#borrowed.get(id) ?? 0) > 0,
    }))
  }

  // ── internals ──────────────────────────────────────────────

  #openDocument(id: DocumentId): Promise<StoredDocument> {
    // A factory keyed by kind, with one entry. The other kinds arrive as lines
    // here rather than as a place someone has to find (MC3).
    if (id !== STREAM_ID) {
      return Promise.reject(new Error(`documents other than the stream are not built yet: ${id}`))
    }
    const doc = new StreamDocument(this.#notebook)
    this.#unsubscribe.set(id, [
      doc.onChanged(change => {
        for (const handler of this.#changed) handler(id, change)
      }),
      doc.onJournal((segment, baseLen, edits) => {
        for (const handler of this.#journal) handler(id, segment, baseLen, edits)
      }),
      doc.onDiverged(divergence => {
        for (const handler of this.#diverged) handler(id, divergence)
      }),
    ])
    return Promise.resolve(doc)
  }

  /** Move an id to the most-recent end, which is what makes the cache an LRU. */
  #remember(id: DocumentId, opening: Promise<StoredDocument>): void {
    this.#opened.delete(id)
    this.#opened.set(id, opening)
  }

  /**
   * Let go of what may be let go of, oldest first.
   *
   * **Never what is dirty, never what a window points at, never what is being
   * used.** The first is the rule that matters: a document dropped dirty is the
   * failure this whole layer exists to prevent, and eviction is an
   * optimisation that may not buy itself at that price.
   */
  async #evict(): Promise<void> {
    if (this.#opened.size <= this.#limit) return
    for (const [id, opening] of [...this.#opened]) {
      if (this.#opened.size <= this.#limit) return
      if ((this.#watched.get(id) ?? 0) > 0 || (this.#borrowed.get(id) ?? 0) > 0) continue
      let doc: StoredDocument
      try {
        doc = await opening
      } catch {
        this.#opened.delete(id) // an opening that failed is not worth keeping
        continue
      }
      if (doc.isDirty) continue
      // Let go of what it says as well as of it: a document nobody holds must
      // not go on reporting to a listener that outlives it.
      for (const off of this.#unsubscribe.get(id) ?? []) off()
      this.#unsubscribe.delete(id)
      this.#opened.delete(id)
    }
  }
}

/** One read view per document, so identity is stable within a mode. */
const readViews = new WeakMap<StoredDocument, StoredDocument>()

/**
 * The same document, refusing to change.
 *
 * A proxy rather than a second implementation: there is one document underneath
 * and both borrows see it, which is the contract. What differs is what this one
 * will let you do — so a batch pass cannot dirty what it only meant to read,
 * and cannot leave a flush obligation behind it.
 *
 * **The receiver is the target, not the proxy**, and that is not a detail: a
 * getter reached through a proxy runs with `this` bound to the receiver, and a
 * class with private fields throws when `this` is not the instance that
 * declared them. Forwarding the receiver made `isDirty` — a getter over
 * `#segments` — fail on every read borrow.
 *
 * **Memoised per document**, so two read borrows are the same object even
 * though a read view and a write view are not. The contract is one document
 * underneath; the views are how a borrow says what it is for.
 */
function readOnly(doc: StoredDocument): StoredDocument {
  const held = readViews.get(doc)
  if (held !== undefined) return held

  const view = new Proxy(doc, {
    get(target, property) {
      if (typeof property === 'string' && MUTATORS.has(property)) {
        return () => {
          throw new Error(`this document was borrowed for reading: ${property} is not allowed`)
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  readViews.set(doc, view)
  return view
}
