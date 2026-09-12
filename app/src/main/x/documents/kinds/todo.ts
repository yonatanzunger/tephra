// A TODO list: days for segments, the working set carried forward (D55).
//
// **The same shape as the stream, and that is the whole discovery.**
// `file-documents.md` predicted this kind would be record-shaped — an edit is a
// field, history is per item — which is what you conclude from listing what an
// item has. Asking instead what anybody DOES with a task list gives three
// motions, none of which asks when one item's status last flipped; they all ask
// what the list looked like. So an item is a line, history is per day, and
// everything below `load` and `keys` is inherited: edits, undo, spans, the
// journal, the WAL, windows, divergence, versioning, restore.
//
// **Each day's file holds that day's working set in full**, and the carry is
// automatic (D55 as revised). The morning walk reviews a file that already
// exists rather than producing it — because the walk is offered and never
// compelled (T11), and a storage invariant that depends on an optional habit is
// one that comes apart the first week away from the desk. The carry protects
// the data; the walk protects the attention.
//
// Every verb here is one `replace()` on one line, which is what makes each an
// ordinary edit: undoable, journalled, and visible to a window with the same
// day open. The one exception is `carry`, which writes a whole segment because
// materialising a day IS writing a whole segment.

import type { Notebook } from '../../../w/notebook.ts'
import { compareDateKeys, dateKeyAt } from '../../../../shared/dates.ts'
import { dayFile, parseDayFile, type RelPath } from '../../../w/layout.ts'
import { SegmentedDocument } from '../segmented.ts'
import { Segment } from '../../segment.ts'
import { frontmatterFor, renderFrontmatter } from '../../frontmatter.ts'
import {
  isLive, itemBlock, itemLine, nowSeconds, parseItem, resolveDue, scanItems, unusedItemId, type WalkState,
  type ScannedItem, type TodoItem, type TodoStatus,
} from '../../../../shared/kinds/todo.ts'
import { ONLY_SEGMENT } from '../../../../shared/document-api.ts'
import type {
  DateKey, DocumentId, DocumentMeta, DocumentPosition, DocumentText, SegmentKey, Span,
} from '../../../../shared/document-api.ts'

/** An item, and which day's file it was read from. */
/**
 * Frontmatter keys the walk keeps on a day (T11).
 *
 * **In the day's own frontmatter, because it is metadata about that precise
 * day.** Whether Tuesday has been reviewed is a fact about Tuesday; it travels
 * with the corpus the way the day's date does, and a second device opening the
 * same notebook is looking at a day that has or has not been walked rather than
 * at its own opinion of one. Unknown keys are preserved verbatim, so a person
 * who wants them gone deletes the lines.
 */
const WALKED = 'walked'
const CARRIED_FROM = 'carriedFrom'

/**
 * The day's selection (H9, MH4) — what you decided you are actually doing.
 *
 * **The same place and for the same reason as `walked`.** *These are the ones I
 * chose on Tuesday* is a fact about Tuesday: it belongs to the day, not to the
 * items, and so it cannot travel when they do.
 *
 * **Which rules out the two tempting implementations.** Not a status — statuses
 * carry forward, and a selection that carried would silently become a
 * permanent label. Not a tag either, for exactly the same reason: `#today`
 * would travel with the item into tomorrow and mean nothing there. Reported
 * from use in an earlier era, where the alternative — a separate *today* list —
 * meant either keeping two lists in sync or losing the tagging.
 *
 * So it is a **mark**, and the section that shows it is a view over the mark
 * rather than a second list. An item that is chosen still sits where it always
 * sat, in creation order, under its own tags: *a selection, never a relocation*
 * (H9).
 */
const CHOSEN = 'today'

/**
 * Ids taken somewhere this document cannot see (MT5b, D56).
 *
 * **A thunk, because the answer is expensive and almost never needed.** An id
 * has to be unique across the corpus for `tephra:todo/<id>` to resolve without
 * naming a list, and a document knows only itself — so whoever holds the index
 * hands this in, and it is called only at the moment an id is actually minted.
 * Absent, the document is still correct about itself, which is what keeps it
 * drivable in a test with no corpus behind it.
 */
export type TakenIds = () => Promise<ReadonlySet<string>>

export interface LocatedItem {
  readonly item: TodoItem
  readonly date: DateKey
}

export class TodoDocument extends SegmentedDocument {
  readonly id: DocumentId
  readonly meta: DocumentMeta & { readonly kind: 'todo' } = { kind: 'todo' }

  /** The `.todo` directory this list lives in — its id, and its files' root. */
  readonly #root: RelPath
  /**
   * Whether this list is paged by day (D55 as amended, MT7).
   *
   * **Two shapes of one kind, and the filename says which.** A `.todo`
   * directory is a DAILY list: carried, walked, with a working set that turns
   * over. A single `.todo.md` is an OVERALL one — the blog posts you mean to
   * write — which does not turn over, so the carry has nothing to carry and
   * *today's working set* is a meaningful idea for the first and a meaningless
   * one for the second.
   *
   * Everything else is shared: the item grammar, every verb, the surface. What
   * differs is `keys()`, which is what `SegmentedDocument` was built to allow.
   */
  readonly #daily: boolean

  constructor(notebook: Notebook, id: DocumentId) {
    super(notebook)
    this.id = id
    this.#root = id as string as RelPath
    this.#daily = !(id as string).endsWith('.md')
  }

  /**
   * The segment a caller means, whichever shape this list is (MT7).
   *
   * **An overall list has ONE segment and callers pass a date anyway**, because
   * `DocumentService` asks every list to work in the writing day and does not
   * know the difference — which is right, and is why normalising belongs here.
   *
   * Getting this wrong is silent and expensive: `load` ignores the key for an
   * overall list, so a verb given a date wrote to the correct FILE under a
   * segment named for a day, and the next read under `content` loaded a second
   * segment from the same file and found it empty. The item was on disk and not
   * on screen.
   */
  #key(key: SegmentKey): SegmentKey {
    return this.#daily ? key : ONLY_SEGMENT
  }

  protected async load(key: SegmentKey): Promise<Segment> {
    const rel = this.#daily ? dayFile(key, 1, this.#root) : (this.id as string as RelPath)
    const text = await this.notebook.read(rel)
    if (text !== null) return Segment.load(key, rel, text)
    // An overall list has no date, and its frontmatter says so by omission.
    return Segment.empty(
      key,
      rel,
      renderFrontmatter(frontmatterFor(this.#daily ? (key as unknown as DateKey) : null, 'todo')),
    )
  }

  /** Every day this list has a file for, ascending. A scan; never on the hot path. */
  async keys(): Promise<readonly SegmentKey[]> {
    // **One segment, which is what every single-file kind answers** (D27). No
    // scan, because there is nothing to scan: the list is the file.
    if (!this.#daily) return [ONLY_SEGMENT]
    const found: DateKey[] = []
    for (const rel of await this.notebook.list(this.#root)) {
      const ref = parseDayFile(rel)
      // Its own days only. A list nested inside another document's directory
      // would otherwise claim that document's days as its own.
      if (ref !== null && ref.part === 1 && ref.root === this.#root) found.push(ref.date)
    }
    for (const [date, segment] of this.segments) {
      if (segment.dirty && !found.includes(date)) found.push(date)
    }
    return found.sort(compareDateKeys)
  }

  // ── reading ────────────────────────────────────────────────

  /** What one day held. The working view is this, for today. */
  async itemsOn(date: DateKey): Promise<readonly TodoItem[]> {
    return (await this.#scan(this.#key(date))).map(found => found.item)
  }

  /**
   * Where an item is NOW: its newest instance, which is its current state.
   *
   * The inverse of `tephra:mark/<name>`, which resolves to the first in date
   * order — a bookmark means where something was first said and an item means
   * what it is now (D56).
   */
  async find(id: string): Promise<LocatedItem | null> {
    for (const date of [...(await this.keys())].reverse()) {
      const found = (await this.#scan(date as DateKey)).find(s => s.item.id === id)
      if (found !== undefined) return { item: found.item, date: date as DateKey }
    }
    return null
  }

  // ── the carry (D55) ────────────────────────────────────────


  /**
   * Materialise a day from the most recent one before it, and adopt what is there.
   *
   * **Automatic and idempotent.** It runs on the first touch of a day and does
   * nothing on the second, so opening the list twice, or walking it twice, or
   * skipping three days and opening on the fourth all reach the same place —
   * Thursday's set from Monday's, once.
   *
   * What carries is what is still yours: done, nevermind and backlogged items
   * stay in the day they were finished. **Nothing evicts them** — they simply
   * are not carried, which is the answer copy-forward gives to a question the
   * design would otherwise have had to invent a rule for (Q3b).
   *
   * Returns the number of items carried, or -1 when the day already existed.
   */
  async carry(date: DateKey, elsewhere?: TakenIds): Promise<number> {
    // **An overall list does not turn over, so there is nothing to carry.** Its
    // items are simply there until they are not, which is the whole difference
    // between the two shapes — and `adopt` still runs, because a hand-written
    // line wants its identity whichever shape it was written into (flow 9).
    if (!this.#daily) {
      await this.adopt(ONLY_SEGMENT as unknown as DateKey, elsewhere)
      return -1
    }
    const already = await this.#exists(date)
    if (already) {
      await this.adopt(date, elsewhere)
      return -1
    }

    const source = [...(await this.keys())]
      .filter(key => compareDateKeys(key as DateKey, date) < 0)
      .sort(compareDateKeys)
      .pop() as DateKey | undefined

    // **Adopt the source before reading it**, which fixes a defect older than
    // the walk that found it. A line somebody typed into yesterday's file by
    // hand has no identity (flow 9); carried as-is it was given a fresh one
    // *today*, so an item that first appeared on Monday claimed a ctime of
    // Tuesday — D56's "first day this line appears", quietly wrong. Giving it
    // its identity where it was actually written makes the copy a copy, and is
    // what lets the walk say which of today's items are yesterday's at all.
    if (source !== undefined) await this.adopt(source, elsewhere)
    const carried =
      source === undefined
        ? []
        : (await this.#scan(source)).filter(found => isLive(found.item.status)).map(found => found.item)

    // One write, so it is one undo step: a carry that came back as thirty edits
    // would let an undo leave the day half-materialised, which is a working set
    // that silently lost items.
    // **Verbatim.** A carried item keeps its identity, its ctime and its mtime;
    // the only thing that changed is which day it is in, and that is the file
    // it is written to. Copying is not modifying.
    // **Blocks, not lines** — a carried item brings what was written about it,
    // so today's list holds the running record and each past day keeps the
    // notes as they stood that day.
    const body = carried.map(item => itemBlock(item)).join('\n')
    await this.setBodyOf(date, (body === '' ? '' : `${body}\n`) as DocumentText)
    // **Where it came from, so the walk can say which of these is yesterday's**
    // (T11). Recorded rather than derived: an item's ctime says which day it
    // was created, which is *almost* the same question and differs on the one
    // that matters — a line typed at 00:30 belongs to the evening it was
    // written in (D62) and its ctime does not know that. The carry is the one
    // moment that knows for certain, so it writes it down.
    if (source !== undefined) (await this.segment(date)).setExtra(CARRIED_FROM, source)
    await this.adopt(date, elsewhere)
    return carried.length
  }

  /**
   * Rewrite what is written UNDER an item.
   *
   * **The whole block, because the notes are part of it** — every other verb
   * replaces the line and leaves them alone, which is what makes them survive
   * a status change or a re-tag. Changing the notes themselves is the one
   * operation that has to reach past the line's end.
   *
   * Nothing in a note is parsed: no `#tag`, no `DUE`, no status. A note is
   * prose about the task and not more task.
   */
  async setNotes(id: string, notes: readonly string[]): Promise<boolean> {
    for (const key of [...(await this.keys())].reverse()) {
      const date = key as DateKey
      const found = (await this.#scan(date)).find(s => s.item.id === id)
      if (found === undefined) continue
      const kept = notes.map(n => n.trim()).filter(n => n !== '')
      await this.replace(
        [{
          // **The block, not the line** — `to` would leave the old notes
          // sitting after the new ones.
          span: { begin: this.at(date, found.from), end: this.at(date, found.blockTo) },
          payload: itemBlock({ ...found.item, notes: kept, mtime: nowSeconds() }) as DocumentText,
        }],
        'operation',
      )
      return true
    }
    return false
  }

  // ── the walk (T11) ─────────────────────────────────────────

  /**
   * What the walk knows about a day.
   *
   * **Two facts, not a display rule.** Whether the day has been reviewed, and
   * which of its items arrived from an earlier one — the surface decides what
   * to draw from those, because "highlight the unreviewed carried ones" is a
   * sentence about pixels and these are sentences about the list.
   */
  async walkOf(date: DateKey): Promise<WalkState> {
    // **Nothing arrived from an earlier day, because there are no earlier
    // days.** The walk reviews what the carry brought (T11), so a list with no
    // carry has no walk — and the surface asks this rather than asking the
    // shape, so it needs to know nothing about the difference.
    if (!this.#daily) return { walked: false, carried: [], carriedFrom: null }
    const segment = await this.segment(date)
    const extra = (key: string): string | undefined =>
      segment.extra.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]?.trim()

    const from = extra(CARRIED_FROM)
    const here = new Set((await this.#scan(date)).flatMap(s => (s.item.id === null ? [] : [s.item.id])))
    // Intersected rather than trusted: an item carried in this morning and
    // deleted since is not in this day any more, and the walk must not offer to
    // review a line that is not there.
    const carried =
      from === undefined
        ? []
        : (await this.#scan(from as DateKey)).flatMap(s =>
            s.item.id !== null && here.has(s.item.id) ? [s.item.id] : [],
          )
    return { walked: extra(WALKED) === 'true', carried, carriedFrom: (from ?? null) as DateKey | null }
  }

  /**
   * What was chosen for this day, in the order it was chosen.
   *
   * **Intersected with what is actually there**, the way `walkOf` intersects
   * the carry: an item chosen this morning and deleted since is not in the day
   * any more, and a selection cannot point at a line that is gone.
   */
  async chosenOn(date: DateKey): Promise<readonly string[]> {
    if (!this.#daily) return []
    const segment = await this.segment(date)
    const said = segment.extra.find(([k]) => k.toLowerCase() === CHOSEN)?.[1]?.trim()
    if (said === undefined || said === '') return []
    const here = new Set((await this.#scan(date)).flatMap(s => (s.item.id === null ? [] : [s.item.id])))
    return said.split(/\s+/).filter(one => here.has(one))
  }

  /**
   * Choose an item for a day, or unchoose it.
   *
   * **Order of choosing is kept**, because it is the only order the selection
   * has that means anything — the list beneath stays in creation order, so if
   * this sorted as well there would be nothing left saying *this is the one I
   * picked first*.
   */
  async choose(date: DateKey, item: string, chosen: boolean): Promise<void> {
    if (!this.#daily) return
    const was = await this.chosenOn(date)
    const now = chosen ? (was.includes(item) ? was : [...was, item]) : was.filter(one => one !== item)
    if (now.length === was.length && now.every((one, at) => one === was[at])) return
    ;(await this.segment(date)).setExtra(CHOSEN, now.join(' '))
    // **An operation and not an edit**, for `walked`'s reason: it is a fact
    // about the day rather than text somebody typed, so it is kept where the
    // title and the source are kept and written the way they are.
    this.touch('operation')
  }

  /**
   * Finish a pass: drop what was marked, and record that the day was walked.
   *
   * **The drops are one write and therefore one undo step**, for the reason the
   * carry is: a bulk delete that came back as eleven edits would let an undo
   * leave the list half-groomed, and would cost eleven gestures to change your
   * mind about one act.
   *
   * **The `walked` bit is NOT in that undo step**, because it is not text
   * somebody typed — it is a fact about the day, kept where the title and the
   * source are kept and written the way they are. Undoing the drops therefore
   * brings the lines back and leaves the day marked reviewed, which is true:
   * you did review it. The pass can always be entered again.
   */
  async finishWalk(key: SegmentKey, drop: readonly string[]): Promise<number> {
    const date = this.#key(key)
    const wanted = new Set(drop)
    const found = (await this.#scan(date)).filter(s => s.item.id !== null && wanted.has(s.item.id))
    if (found.length > 0) {
      await this.replace(
        found.map(one => ({
          span: { begin: this.at(date, one.from), end: this.at(date, one.end) },
          payload: '' as DocumentText,
        })),
        'operation',
      )
    }
    ;(await this.segment(date)).setExtra(WALKED, 'true')
    this.touch('operation')
    return found.length
  }

  /**
   * Give an id to every line that has not got one (flow 9, D56).
   *
   * **This is what "adopted on the next read" means.** A line somebody typed
   * into the file by hand is an item; it becomes one the app can act on when
   * the day is next written, because every verb addresses an item by id and an
   * unmarked line cannot be addressed at all.
   *
   * Relative due dates resolve here too, for the same reason and at the same
   * moment: `DUE FRIDAY` sitting in a file would mean something different every
   * week (T16).
   */
  async adopt(key: SegmentKey, elsewhere?: TakenIds): Promise<number> {
    const date = this.#key(key)
    const found = await this.#scan(date)
    const taken = this.#taken(found, elsewhere)
    const now = nowSeconds()
    const edits: { span: Span; payload: DocumentText }[] = []

    for (const scanned of found) {
      const resolved = resolveDue(scanned.item.text, date)
      const needsId = scanned.item.id === null
      if (!needsId && resolved === scanned.item.text) continue

      let id = scanned.item.id
      if (id === null) {
        const pool = await taken()
        id = unusedItemId(pool)
        pool.add(id)
      }
      const line = itemLine({
        ...scanned.item,
        text: resolved,
        id,
        ctime: scanned.item.ctime ?? now,
        mtime: scanned.item.mtime ?? now,
      })
      edits.push({
        span: { begin: this.at(date, scanned.from), end: this.at(date, scanned.to) },
        payload: line as DocumentText,
      })
    }
    if (edits.length === 0) return 0
    await this.replace(edits, 'operation')
    return edits.length
  }

  // ── the verbs, each one line ───────────────────────────────

  /**
   * A new item, from a single string — the one verb flow 1 calls from outside.
   *
   * Everything else about it is defaulted because none of it is known at the
   * moment of noticing: status is *not started*, ctime is now, and the tags and
   * the due date are whatever the string already said (T13, T16).
   */
  async add(text: string, key: SegmentKey, elsewhere?: TakenIds): Promise<string> {
    const date = this.#key(key)
    await this.carry(key, elsewhere)
    const now = nowSeconds()
    const found = await this.#scan(date)
    const id = unusedItemId(await this.#taken(found, elsewhere)())
    // **Flattened first.** A quick-add box and a share sheet both hand over
    // whatever was selected, and an item is a line — a newline in the middle of
    // one would silently become two items, the second of them unmarked.
    const flat = resolveDue(text.replace(/\s*\n\s*/g, ' ').trim(), date)
    const parsed = parseItem(`- [ ] ${flat}`)
    const item: TodoItem = { ...(parsed ?? EMPTY_ITEM), id, ctime: now, mtime: now }

    const body = await this.bodyOf(date)
    // Appended after what is WRITTEN, not at the end of the file: a day may end
    // in blank lines, and pushing the item past them puts a gap in the list.
    const written = body.replace(/\s*$/, '')
    const payload = `${written === '' ? '' : '\n'}${itemLine(item)}${body.slice(written.length).includes('\n') ? '' : '\n'}`
    await this.replace(
      [{ span: { begin: this.at(date, written.length), end: this.at(date, written.length) }, payload: payload as DocumentText }],
      'operation',
    )
    return id
  }

  /** Check it off, start it, block it, put it down. One line, one edit. */
  async setStatus(id: string, status: TodoStatus, reason?: string): Promise<boolean> {
    return this.#rewrite(id, item => ({
      ...item,
      status,
      // A reason is kept only where it means something, which is the same rule
      // the grammar reads by (T4).
      reason: status === 'blocked' ? (reason ?? item.reason) : null,
    }))
  }

  /**
   * Give it a date, or take one away.
   *
   * The date lives IN the line (T16), so this edits the text rather than a
   * field beside it — which is what keeps the file what it appears to be.
   */
  async setDue(id: string, due: DateKey | null): Promise<boolean> {
    return this.#rewrite(id, item => {
      const without =
        item.dueSpan === null ? item.text : cut(item.text, item.dueSpan.from, item.dueSpan.to)
      return { ...item, text: due === null ? without : `${without} DUE ${due}`.trim() }
    })
  }

  /**
   * Tag an item, and untag it. **`tagItem`, not `tag`**, and the name matters.
   *
   * `SegmentedDocument` already has `tag(span, subject)`: that is prose
   * tagging, which marks a RANGE of writing with a subject somebody will look
   * for years later. A TODO tag applies to a whole item, is its own namespace,
   * and turns over on a timescale of about a week (T5, R17). Overriding the
   * inherited verb would be claiming the two are one act, and the requirement
   * exists precisely because they are not.
   */
  async tagItem(id: string, name: string): Promise<boolean> {
    return this.#rewrite(id, item =>
      item.tags.includes(name) ? item : { ...item, text: `${item.text} ${written(name)}`.trim() },
    )
  }

  async untagItem(id: string, name: string): Promise<boolean> {
    return this.#rewrite(id, item => {
      const at = item.tags.indexOf(name)
      const span = item.tagSpans[at]
      if (at < 0 || span === undefined) return item
      return { ...item, text: cut(item.text, span.from, span.to) }
    })
  }

  /**
   * The committed row edit: text, tags and date together, in one `replace()`.
   *
   * **This is why mtime can be exact without anybody paying for it** (D56). A
   * row is edited by a gesture that commits once rather than being a live text
   * field, so a text change is an operation like any other and the stamp rides
   * along — where keeping it exact through free-text typing would mean writing
   * into the line the cursor is in, on every keystroke.
   */
  async edit(id: string, text: string): Promise<boolean> {
    return this.#rewrite(id, (item, date) => ({ ...item, text: resolveDue(text.trim(), date) }))
  }

  /**
   * Take an item off the list — the one case T2 does not cover.
   *
   * **T2 says items are never destroyed, only restatused, and this does not
   * break it.** What is cut is the line from the day the item is live in;
   * every earlier day keeps its copy, because those days are the record of
   * what those days looked like and editing them would be editing history.
   * An item deleted the day it was made is gone entirely, which is right: the
   * case this exists for is a mis-hit `Add` and a line of garbage, and asking
   * somebody to carry that forever in the name of a principle about work would
   * be applying the principle to something that is not work.
   *
   * *Nevermind* is the status for a task you decided against; this is for one
   * that was never a task.
   */
  async remove(id: string): Promise<boolean> {
    for (const key of [...(await this.keys())].reverse()) {
      const date = key as DateKey
      const found = (await this.#scan(date)).find(s => s.item.id === id)
      if (found === undefined) continue
      await this.replace(
        [{ span: { begin: this.at(date, found.from), end: this.at(date, found.end) }, payload: '' as DocumentText }],
        'operation',
      )
      return true
    }
    return false
  }

  // **No `today()` here, and that is the point of D62.** A document holds the
  // day it has open and is *told* which day to work in; one that asked a clock
  // would be a fourth answer to a question that now has one, and would go on
  // believing the calendar while the notebook was still in last night.

  /**
   * The ids that are already spoken for, this day's and the corpus's.
   *
   * **Asked only when something is actually being minted**, which is why it is
   * a thunk and not a set: `adopt` runs on every carry and mints on almost none
   * of them, and answering it means sweeping the corpus.
   */
  #taken(
    found: readonly ScannedItem[],
    elsewhere: TakenIds | undefined,
    // Mutable on purpose: `adopt` mints a batch and each new id has to be
    // spoken for before the next one is drawn.
  ): () => Promise<Set<string>> {
    let pool: Set<string> | null = null
    // **Resolved on the first mint and not before.** The first cut awaited this
    // at the top of `adopt` — which runs on every carry and mints on almost
    // none of them, so every list fetch paid for a sweep of the corpus to
    // answer a question nobody asked. A thunk that is called eagerly is a set.
    return async () => {
      if (pool !== null) return pool
      const mine = new Set<string>(found.flatMap(s => (s.item.id === null ? [] : [s.item.id])))
      if (elsewhere !== undefined) for (const id of await elsewhere()) mine.add(id)
      pool = mine
      return mine
    }
  }

  // ── internals ──────────────────────────────────────────────

  /**
   * Find an item by id in the day it is live in, and rewrite its line.
   *
   * **The newest instance**, because that is what the item IS now (D56); the
   * older ones are its history and are never edited in place.
   */
  /**
   * Do one thing to many items at once (MH4).
   *
   * **One write, and therefore one undo step**, which is the rule `finishWalk`
   * already follows and for the same reason: a bulk act that came back as
   * eleven edits would let an undo leave the list half-changed, and would cost
   * eleven gestures to change your mind about one act. That argument was made
   * about deleting; it is not about deleting, it is about *bulk*.
   *
   * `'remove'` cuts the lines; anything else is a status. Both shapes are here
   * rather than in two verbs because the caller has one gesture — *do this to
   * these* — and a surface that had to know which of two calls to make would be
   * knowing something about the file format.
   *
   * Returns how many were actually changed, which is what the surface reports
   * back: asked of five and changed three is a true thing worth saying.
   */
  async bulk(ids: readonly string[], action: TodoStatus | 'remove'): Promise<number> {
    const wanted = new Set(ids)
    if (wanted.size === 0) return 0
    const edits: { span: { begin: DocumentPosition; end: DocumentPosition }; payload: DocumentText }[] = []
    let touched = 0
    for (const key of [...(await this.keys())].reverse()) {
      const date = key as DateKey
      for (const found of await this.#scan(date)) {
        const id = found.item.id
        if (id === null || !wanted.has(id)) continue
        wanted.delete(id)
        touched += 1
        if (action === 'remove') {
          edits.push({
            span: { begin: this.at(date, found.from), end: this.at(date, found.end) },
            payload: '' as DocumentText,
          })
          continue
        }
        const line = itemLine({
          ...found.item,
          status: action,
          // Same rule the single verb reads by: a reason is kept only where it
          // means something (T4), and a bulk gesture has no room to ask for one.
          reason: action === 'blocked' ? found.item.reason : null,
          mtime: nowSeconds(),
        })
        edits.push({
          span: { begin: this.at(date, found.from), end: this.at(date, found.to) },
          payload: line as DocumentText,
        })
      }
    }
    if (edits.length > 0) await this.replace(edits, 'operation')
    return touched
  }

  async #rewrite(id: string, change: (item: TodoItem, date: DateKey) => TodoItem): Promise<boolean> {
    for (const key of [...(await this.keys())].reverse()) {
      const date = key as DateKey
      const found = (await this.#scan(date)).find(s => s.item.id === id)
      if (found === undefined) continue

      const next = change(found.item, date)
      const line = itemLine({ ...next, mtime: nowSeconds() })
      const body = await this.bodyOf(date)
      if (line === body.slice(found.from, found.to)) return true

      await this.replace(
        [{ span: { begin: this.at(date, found.from), end: this.at(date, found.to) }, payload: line as DocumentText }],
        'operation',
      )
      return true
    }
    return false
  }

  async #scan(date: DateKey): Promise<readonly ScannedItem[]> {
    return scanItems(await this.bodyOf(date))
  }

  /** Is there a file, or a segment somebody has written to but not flushed? */
  async #exists(date: DateKey): Promise<boolean> {
    if (this.segments.get(date)?.dirty === true) return true
    return this.notebook.has(dayFile(date, 1, this.#root))
  }

  // ── the two that make new documents, which this kind does not ──

  async branch(_span: Span, _name: string): Promise<DocumentId> {
    throw new Error('branching out of a todo list is not a thing')
  }

  async importText(): Promise<string> {
    throw new Error('importing into a todo list is not built yet')
  }
}

const EMPTY_ITEM: TodoItem = {
  id: null, status: 'todo', ctime: null, mtime: null,
  text: '', tags: [], due: null, reason: null, notes: [], tagSpans: [], dueSpan: null,
}

/** How a tag is written down. The inverse of the grammar's two spellings. */
const written = (name: string): string => (/\s/.test(name) ? `#'${name}'` : `#${name}`)

/**
 * Take a piece out of a line's text, and close the gap it leaves.
 *
 * Removing `#house` from `ring the bank #house today` must not leave two
 * spaces where it was: the file is read by people, and a verb that tidies after
 * itself is the difference between a list and a list with scars.
 */
const cut = (text: string, from: number, to: number): string =>
  `${text.slice(0, from)}${text.slice(to)}`.replace(/\s{2,}/g, ' ').trim()
