// The corpus index: what is written down, and where (D52).
//
// **Inside the floor, because it reads files.** It is a cache OF the corpus and
// not a reader of it: answering "every subject in twenty years" by opening
// twenty years of documents is the one thing it exists to avoid, so it scans
// bytes and stamps directly — which it may do here and could not do above (D54).
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

import type { Notebook } from '../../w/notebook.ts'
import { IndexStore, type Entries, type Cached } from '../../w/index-store.ts'
import { dayFile, kindOf, parseDayFile, STREAM_DIR, type RelPath } from '../../w/layout.ts'
import { scanItems } from '../../../shared/kinds/todo.ts'
import { scanMarkers, scanSpans, type ScannedSpan } from '../markers.ts'
import { parseFile } from '../frontmatter.ts'
import type { StreamDocument } from './kinds/stream.ts'
import type { DateKey } from '../../../shared/document-api.ts'
import type {
  IndexStatus, Located, OutlineNode, Reference, Subject, ThreadRow, TimelineDay,
} from '../../../shared/nav-api.ts'

export type { IndexStatus, Located, OutlineNode, Reference, Subject, ThreadRow, TimelineDay }

/**
 * A task item, as the corpus knows it (MT5b).
 *
 * **Two facts, and neither of them is status.** The index answers what is
 * *in* the corpus; whether a tag has live items is a question about today, and
 * today's items are already on screen (MT3 found this, MT4a relies on it). So
 * the live set needs no index and the full set is exactly what does.
 */
interface IndexedItem {
  readonly id: string
  readonly tags: readonly string[]
}

/** What one file contributes. The unit of both the cache and the sweep. */
interface Scanned {
  readonly file: RelPath
  readonly date: DateKey | null
  readonly spans: readonly ScannedSpan[]
  readonly blank: boolean
  /** Empty for everything that is not a day of a task list. */
  readonly items: readonly IndexedItem[]
}

/**
 * The cached shape, and its guard.
 *
 * The store keeps payloads opaque, so recognising a payload from an older shape
 * is this file's job — and the answer is the one D52 chose: **a shape it does
 * not recognise is a cache it throws away**, rescanned on the spot. That is
 * what a cache with no versioning and no migration has to do to stay honest.
 */
type Payload = {
  readonly spans: readonly ScannedSpan[]
  readonly blank: boolean
  readonly items: readonly IndexedItem[]
}
// **`items` is required, and that is how every existing cache gets rebuilt.**
// An entry written before MT5b has no `items`, fails here, and is rescanned on
// the spot — which is the rule this guard was already written to follow, doing
// the migration that a versioned cache would have needed code for.
const isPayload = (value: unknown): value is Payload =>
  typeof value === 'object' && value !== null &&
  Array.isArray((value as Payload).spans) && typeof (value as Payload).blank === 'boolean' &&
  Array.isArray((value as Payload).items)

export class CorpusIndex {
  readonly #notebook: Notebook
  readonly #stream: () => Promise<StreamDocument>
  readonly #store: IndexStore<Payload>

  /** Everything known, by file. Rebuilt lazily; never the authority. */
  #known = new Map<RelPath, Scanned>()
  #status: IndexStatus = { known: 0, total: 0, building: false }
  #sweeping: Promise<void> | null = null

  constructor(notebook: Notebook, stream: () => Promise<StreamDocument>) {
    this.#notebook = notebook
    this.#stream = stream
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
  /**
   * The days, oldest first, each with the headings written in it.
   *
   * **Days, and only days** — the name used to be `outline`, and that name is
   * what let the bug in: a corpus outline plausibly includes a note's headings,
   * and for a while this pushed them in as top-level entries whenever a file
   * had no date span. With a handful of day files that was invisible. Import a
   * few hundred markdown documents and the Timeline fills with their headings,
   * formatted as dates, reading `NaN driven, market`.
   *
   * A note's headings are a real thing to want in a sidebar. They are not the
   * Timeline, and whatever shows them will ask a differently-named question.
   */
  async timeline(): Promise<readonly TimelineDay[]> {
    const out: TimelineDay[] = []
    const all = await this.#all()
    // **A day nobody wrote in is not in the timeline — unless it is the latest
    // one**, which is where you are about to write. Exactly the rule the day
    // seam already uses on screen (`days.ts`), because it is the same question.
    const latest = all.filter(f => f.date !== null).at(-1)?.file
    for (const { file, date, spans, blank } of all) {
      // Not a day: a note, a fileset, a task list. It has no place here at all,
      // and `date` is the fact that says so — `dateOf` already answers null for
      // anything outside the stream.
      if (date === null) continue
      if (blank && file !== latest) continue
      const day = spans.find(s => s.kind === 'date')
      if (day === undefined) continue
      const headings = spans.filter(s => s.kind === 'heading')
      out.push({
        date,
        at: { file, date, from: day.from, to: day.to },
        headings: nest(headings.map(h => ({
          at: { file, date, from: h.from, to: h.to },
          title: h.name,
          level: h.level,
          children: [] as OutlineNode[],
        }))),
      })
    }
    return out
  }

  /**
   * Every item id in the corpus (MT5b, D56).
   *
   * **What makes eight characters certain rather than merely likely.** An id
   * used to be minted against one day's items, which is unique enough within a
   * list and says nothing about a second one — and `tephra:todo/<id>` resolves
   * without naming a list, so the id has to be unique across everything or the
   * address is ambiguous. Minting checks here now.
   */
  async itemIds(): Promise<ReadonlySet<string>> {
    const out = new Set<string>()
    for (const scanned of await this.#all()) for (const item of scanned.items) out.add(item.id)
    return out
  }

  /**
   * Every tag that has ever been on a task, sorted (T6).
   *
   * **The full set, and only the full set.** T6 asks the interface to
   * distinguish tags with live items from tags without, and offer the live ones
   * by default — but the live set is exactly the tags on today's items, which
   * are already on screen and needed no index at all (MT3). So the half worth
   * building is this one, and *dormant* is a subtraction done where both halves
   * are known.
   *
   * Per-tag recency is deliberately absent: it belongs to Q3a's backlog
   * resurfacing, which is deferred by decision.
   */
  async todoTags(): Promise<readonly string[]> {
    const out = new Set<string>()
    for (const scanned of await this.#all()) {
      for (const item of scanned.items) for (const tag of item.tags) out.add(tag)
    }
    return [...out].sort((a, b) => a.localeCompare(b))
  }

  /** Comment anchors, open first. The bodies live in the document (D47). */
  async threads(): Promise<readonly ThreadRow[]> {
    const out: ThreadRow[] = []
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
    const byDir = new Map<RelPath, Map<string, Cached<Payload>>>()
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
          entries.set(nameOf(file), { stamp, payload: { spans: scanned.spans, blank: scanned.blank, items: scanned.items } })
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
      const payload = { spans: fresh.spans, blank: fresh.blank, items: fresh.items }
      if (JSON.stringify(cached?.payload ?? null) !== JSON.stringify(payload)) wrong.push(file)
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
    const dirty = new Map<RelPath, Map<string, Cached<Payload>>>()
    this.#status = { ...this.#status, total: files.length, building: true }
    let known = 0

    try {
      for (const dir of new Set(files.map(dirOf))) {
        const cached = await this.#store.read(dir)
        for (const file of files.filter(f => dirOf(f) === dir)) {
          const stamp = await this.#stampOf(file)
          const held = cached.get(nameOf(file))
          const loaded = await this.#loadedDate(file)

          // A loaded day answers for itself, whatever the cache believes: it may
          // hold edits that have not reached the file at all.
          if (loaded !== null) {
            // A stream day holds prose, never task items.
            this.#known.set(file, { file, date: loaded, items: [], ...(await (await this.#stream()).scan(loaded)) })
          } else if (
            held !== undefined && stamp !== null && same(held.stamp, stamp) && isPayload(held.payload)
          ) {
            this.#known.set(file, { file, date: dateOf(file), ...held.payload })
          } else {
            const scanned = await this.#scan(file)
            if (scanned === null) continue
            this.#known.set(file, scanned)
            if (stamp !== null) {
              const entries = dirty.get(dir) ?? new Map(cached)
              entries.set(nameOf(file), { stamp, payload: { spans: scanned.spans, blank: scanned.blank, items: scanned.items } })
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
  async #loadedDate(file: RelPath): Promise<DateKey | null> {
    const date = dateOf(file)
    if (date === null) return null
    return (await this.#stream()).heldSegment(date) === null ? null : date
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
      return { file, date, items: [], ...(await (await this.#stream()).scan(date)) }
    }
    const text = await this.#notebook.read(file)
    if (text === null) return null
    const body = parseFile(text).body
    return {
      file,
      date: null,
      spans: scanSpans(body, scanMarkers(body)),
      blank: body.trim() === '',
      // **Asked of the kind, not of the text.** `- [ ] something #house` is a
      // markdown task list wherever it appears, and `#house` is a tag only
      // inside a task list — TODO tags are their own namespace (T5), so reading
      // them out of prose would invent tags nobody wrote. `scanSpans` is
      // deliberately left alone for the same reason: it is generic.
      items: kindOf(file) === 'todo' ? itemsIn(body) : [],
    }
  }
}

const dirOf = (file: RelPath): RelPath => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '') as RelPath
const nameOf = (file: RelPath): string => file.slice(file.lastIndexOf('/') + 1)
/**
 * The day of the STREAM this file is, if it is one.
 *
 * **The root check is the whole of it, and its absence was visible.** Every
 * directory document lays its days out identically (D59), so `parseDayFile`
 * answers for a task list's file exactly as it answers for the stream's — and
 * without asking which, the index handed a todo day to `StreamDocument.scan`
 * and the sidebar's Timeline showed today twice, once for each document that
 * had a file for it.
 */
const dateOf = (file: RelPath): DateKey | null => {
  const ref = parseDayFile(file)
  return ref === null || ref.root !== STREAM_DIR ? null : ref.date
}
/**
 * The items in one day of a task list, through the shared grammar.
 *
 * One parse, for the reason `shared/kinds/todo.ts` exists: main reads day files
 * off disk and the renderer parses the one in the editor, and two
 * implementations of one grammar is the failure this codebase keeps meeting.
 * Unadopted lines have no id yet and contribute nothing — they get one the next
 * time the day is written, and are indexed then.
 */
function itemsIn(body: string): readonly IndexedItem[] {
  return scanItems(body).flatMap(found =>
    found.item.id === null ? [] : [{ id: found.item.id, tags: found.item.tags }],
  )
}

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
