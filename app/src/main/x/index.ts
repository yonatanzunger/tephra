// The corpus index: what is written down, and where (D52).
//
// **A cache of the scan, and never a source of truth.** The files are
// authoritative; this holds what a scan of them found, keyed by file and stamped
// with size and mtime, so verifying it is one `stat` per file and no reads.
// Deleting `.tephra/index` costs nothing but the time to look again — which is
// the property every method here has to preserve.
//
// It exists because the sidebar asks questions about the WHOLE corpus — every
// subject, every bookmark, the outline — and answering those by loading every
// segment is a gigabyte through memory at twenty years (D8's measured scale).
// D7 put an index in v3; the sidebar is the feature that could not wait.

import type { Notebook } from '../w/notebook.ts'
import { IndexStore, type Entries, type Cached } from '../w/index-store.ts'
import { dayFile, parseDayFile, type RelPath } from '../w/layout.ts'
import { scanMarkers, scanSpans, type ScannedSpan } from './markers.ts'
import { parseFile } from './frontmatter.ts'
import type { StreamDocument } from './stream-document.ts'
import type { DateKey } from '../../shared/document-api.ts'

/** Where something is: the file it is in, and the offsets within that file's body. */
export interface Located {
  readonly file: RelPath
  /** The day, when the file is one. Null for notes and filesets. */
  readonly date: DateKey | null
  readonly from: number
  readonly to: number
}

/**
 * A row's identity, with no position in it (D11, D51).
 *
 * This is what a pinned entry stores and what `occurrences` resolves. It is an
 * annotation's identity without its location, which is why a curated row and a
 * built-in row are the same row.
 */
export type Reference =
  | { readonly kind: 'anchor'; readonly name: string }
  | { readonly kind: 'tag'; readonly subject: string }
  | { readonly kind: 'date'; readonly date: DateKey }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'file'; readonly path: RelPath }

export interface Subject {
  readonly subject: string
  readonly count: number
  readonly first: Located
}

export interface OutlineNode {
  readonly at: Located
  readonly title: string
  readonly level: number
  readonly children: readonly OutlineNode[]
}

export interface IndexStatus {
  /** Files whose spans are known: either cached and fresh, or scanned. */
  readonly known: number
  readonly total: number
  readonly building: boolean
}

/** What one file contributes. The unit of both the cache and the sweep. */
interface Scanned {
  readonly file: RelPath
  readonly date: DateKey | null
  readonly spans: readonly ScannedSpan[]
}

export class StreamIndex {
  readonly #notebook: Notebook
  readonly #doc: StreamDocument
  readonly #store: IndexStore<readonly ScannedSpan[]>

  /** Everything known, by file. Rebuilt lazily; never the authority. */
  #known = new Map<RelPath, Scanned>()
  #status: IndexStatus = { known: 0, total: 0, building: false }
  #sweeping: Promise<void> | null = null

  constructor(notebook: Notebook, doc: StreamDocument) {
    this.#notebook = notebook
    this.#doc = doc
    this.#store = new IndexStore(notebook)
  }

  status(): IndexStatus {
    return this.#status
  }

  // ── the questions the sidebar asks ─────────────────────────

  async subjects(): Promise<readonly Subject[]> {
    const byName = new Map<string, { count: number; first: Located }>()
    for (const { file, date, spans } of await this.#all()) {
      for (const span of spans) {
        if (span.kind !== 'tag') continue
        const at: Located = { file, date, from: span.from, to: span.to }
        const held = byName.get(span.name)
        if (held === undefined) byName.set(span.name, { count: 1, first: at })
        else byName.set(span.name, { count: held.count + 1, first: held.first })
      }
    }
    return [...byName]
      .map(([subject, { count, first }]) => ({ subject, count, first }))
      .sort((a, b) => a.subject.localeCompare(b.subject))
  }

  async bookmarks(): Promise<readonly { name: string; at: Located }[]> {
    const out: { name: string; at: Located }[] = []
    for (const { file, date, spans } of await this.#all()) {
      for (const span of spans) {
        if (span.kind !== 'anchor') continue
        out.push({ name: span.name, at: { file, date, from: span.from, to: span.to } })
      }
    }
    return out
  }

  /**
   * Days with their headings nested, newest last.
   *
   * The tree comes out of the ranges rather than out of a second structure: a
   * heading whose span contains another's is its parent (D51), which is exactly
   * what "equal or greater precedence" already arranged.
   */
  async outline(): Promise<readonly OutlineNode[]> {
    const out: OutlineNode[] = []
    for (const { file, date, spans } of await this.#all()) {
      const day = spans.find(s => s.kind === 'date')
      const headings = spans.filter(s => s.kind === 'heading')
      const nodes = nest(headings.map(h => ({
        at: { file, date, from: h.from, to: h.to },
        title: h.name,
        level: h.level,
        children: [] as OutlineNode[],
      })))
      if (day === undefined) {
        out.push(...nodes)
        continue
      }
      out.push({
        at: { file, date, from: day.from, to: day.to },
        title: day.name,
        level: 0,
        children: nodes,
      })
    }
    return out
  }

  /** Comment anchors, open first. The bodies live in the document (D47). */
  async threads(): Promise<readonly { id: string; resolved: boolean; at: Located }[]> {
    const out: { id: string; resolved: boolean; at: Located }[] = []
    for (const { file, date, spans } of await this.#all()) {
      for (const span of spans) {
        if (span.kind !== 'comment') continue
        out.push({
          id: span.name,
          resolved: span.resolved === true,
          at: { file, date, from: span.from, to: span.to },
        })
      }
    }
    return out.sort((a, b) => Number(a.resolved) - Number(b.resolved))
  }

  /**
   * Every span of a kind, with where it is — what `Document.spans()` is built on.
   *
   * The document maps the stream's share of these into `TypedSpan`s with real
   * positions; the rest belong to files no document is holding open, and are
   * the sidebar's business rather than the document's.
   */
  async spansOf(kind?: ScannedSpan['kind']): Promise<readonly { at: Located; span: ScannedSpan }[]> {
    const out: { at: Located; span: ScannedSpan }[] = []
    for (const { file, date, spans } of await this.#all()) {
      for (const span of spans) {
        if (kind !== undefined && span.kind !== kind) continue
        out.push({ at: { file, date, from: span.from, to: span.to }, span })
      }
    }
    return out
  }

  /** Every place a reference resolves to, in corpus order. */
  async occurrences(reference: Reference): Promise<readonly Located[]> {
    const out: Located[] = []
    for (const { file, date, spans } of await this.#all()) {
      if (reference.kind === 'file') {
        if (file === reference.path) out.push({ file, date, from: 0, to: 0 })
        continue
      }
      for (const span of spans) {
        const hit =
          (reference.kind === 'anchor' && span.kind === 'anchor' && span.name === reference.name) ||
          (reference.kind === 'tag' && span.kind === 'tag' && span.name === reference.subject) ||
          (reference.kind === 'date' && span.kind === 'date' && span.name === reference.date) ||
          (reference.kind === 'heading' && span.kind === 'heading' && span.name === reference.text)
        if (hit) out.push({ file, date, from: span.from, to: span.to })
      }
    }
    return out
  }

  // ── maintenance ────────────────────────────────────────────

  /**
   * Bring the cache into agreement with the files, and swap it in.
   *
   * **One entry point, for every situation that needs one**: opening, a timer, a
   * history restore, crash recovery, a month that will not parse, or a person
   * asking. Because every entry carries its own stamp, a half-finished rebuild
   * is INCOMPLETE AND NEVER WRONG — the files it has not reached still hold
   * entries that are either valid or fail their check and get scanned on demand.
   * That is what makes it safe to start at any moment.
   */
  async rebuild(under: RelPath = ''): Promise<{ files: number }> {
    const files = (await this.#notebook.list(under)).filter(rel => rel.endsWith('.md'))
    const byDir = new Map<RelPath, Map<string, Cached<readonly ScannedSpan[]>>>()
    let done = 0

    this.#status = { ...this.#status, building: true, total: files.length }
    try {
      for (const file of files) {
        const scanned = await this.#scan(file)
        if (scanned === null) continue
        this.#known.set(file, scanned)

        const stamp = await this.#stampOf(file)
        if (stamp !== null) {
          const dir = dirOf(file)
          const entries = byDir.get(dir) ?? new Map()
          entries.set(nameOf(file), { stamp, payload: scanned.spans })
          byDir.set(dir, entries)
        }
        done += 1
        this.#status = { ...this.#status, known: done }
        // Chunked, because the writing path may not stutter (R1.1).
        if (done % 25 === 0) await new Promise(resolve => setImmediate(resolve))
      }
      for (const [dir, entries] of byDir) await this.#store.write(dir, entries)
    } finally {
      this.#status = { ...this.#status, building: false }
    }
    return { files: done }
  }

  /** Files whose cached spans no longer match a fresh scan. A diagnostic. */
  async verify(under: RelPath = ''): Promise<readonly RelPath[]> {
    const wrong: RelPath[] = []
    for (const file of (await this.#notebook.list(under)).filter(rel => rel.endsWith('.md'))) {
      const cached = (await this.#store.read(dirOf(file))).get(nameOf(file))
      const fresh = await this.#scan(file)
      if (fresh === null) continue
      if (JSON.stringify(cached?.payload ?? null) !== JSON.stringify(fresh.spans)) wrong.push(file)
    }
    return wrong
  }

  /** Throw the cache away. Costs time, and nothing else. */
  async clear(): Promise<void> {
    this.#known.clear()
    await this.#store.clear()
  }

  // ── internals ──────────────────────────────────────────────

  /**
   * Everything, from the cheapest source that is still correct.
   *
   * Per file: a loaded day answers from memory, a fresh cache entry is trusted,
   * and anything else is read and scanned. The sweep runs at most once at a
   * time, and its results are held so a sidebar redraw is not a second sweep.
   */
  async #all(): Promise<readonly Scanned[]> {
    if (this.#sweeping !== null) await this.#sweeping
    else {
      this.#sweeping = this.#sweep()
      try {
        await this.#sweeping
      } finally {
        this.#sweeping = null
      }
    }
    return [...this.#known.values()].sort((a, b) => a.file.localeCompare(b.file))
  }

  async #sweep(): Promise<void> {
    const files = (await this.#notebook.list('')).filter(rel => rel.endsWith('.md'))
    const dirty = new Map<RelPath, Map<string, Cached<readonly ScannedSpan[]>>>()
    this.#status = { ...this.#status, total: files.length, building: true }
    let known = 0

    try {
      for (const dir of new Set(files.map(dirOf))) {
        const cached = await this.#store.read(dir)
        for (const file of files.filter(f => dirOf(f) === dir)) {
          const stamp = await this.#stampOf(file)
          const held = cached.get(nameOf(file))
          const loaded = this.#loadedDate(file)

          // A loaded day answers for itself, whatever the cache believes: it may
          // hold edits that have not reached the file at all.
          if (loaded !== null) {
            this.#known.set(file, { file, date: loaded, spans: await this.#doc.scan(loaded) })
          } else if (held !== undefined && stamp !== null && same(held.stamp, stamp)) {
            this.#known.set(file, { file, date: dateOf(file), spans: held.payload })
          } else {
            const scanned = await this.#scan(file)
            if (scanned === null) continue
            this.#known.set(file, scanned)
            if (stamp !== null) {
              const entries = dirty.get(dir) ?? new Map(cached)
              entries.set(nameOf(file), { stamp, payload: scanned.spans })
              dirty.set(dir, entries)
            }
          }
          known += 1
          this.#status = { ...this.#status, known }
        }
      }
      // Files that have gone away take their entries with them.
      for (const file of [...this.#known.keys()]) if (!files.includes(file)) this.#known.delete(file)
      for (const [dir, entries] of dirty) await this.#store.write(dir, entries)
    } finally {
      this.#status = { ...this.#status, building: false }
    }
  }

  /** The day a file belongs to, if the editor is holding it. */
  #loadedDate(file: RelPath): DateKey | null {
    const date = dateOf(file)
    if (date === null) return null
    return this.#doc.heldSegment(date) === null ? null : date
  }

  async #stampOf(file: RelPath): Promise<{ size: number; mtime: number } | null> {
    return this.#notebook.stamp(file)
  }

  /**
   * One file, scanned from disk.
   *
   * A day goes through the document, so that a loaded one answers from memory
   * and split parts are joined; anything else is markdown, and the shared span
   * scan does not care whether it is a note, a fileset or something a person
   * put there by hand.
   */
  async #scan(file: RelPath): Promise<Scanned | null> {
    const date = dateOf(file)
    if (date !== null) {
      // Later parts belong to their day's first file, which has already covered
      // them; indexing them separately would double every span in a long day.
      if (parseDayFile(file)?.part !== 1) return null
      return { file, date, spans: await this.#doc.scan(date) }
    }
    const text = await this.#notebook.read(file)
    if (text === null) return null
    const body = parseFile(text).body
    return { file, date: null, spans: scanSpans(body, scanMarkers(body)) }
  }
}

const dirOf = (file: RelPath): RelPath => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '') as RelPath
const nameOf = (file: RelPath): string => file.slice(file.lastIndexOf('/') + 1)
const dateOf = (file: RelPath): DateKey | null => parseDayFile(file)?.date ?? null
const same = (a: { size: number; mtime: number }, b: { size: number; mtime: number }): boolean =>
  a.size === b.size && a.mtime === b.mtime

/** Headings into a tree, by the containment their ranges already describe. */
function nest(nodes: readonly OutlineNode[]): OutlineNode[] {
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const node of nodes) {
    while (stack.length > 0 && (stack[stack.length - 1] as OutlineNode).level >= node.level) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent === undefined) roots.push(node)
    else (parent.children as OutlineNode[]).push(node)
    stack.push(node)
  }
  return roots
}
