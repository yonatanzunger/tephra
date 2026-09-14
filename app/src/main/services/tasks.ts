// **The asked store of the agenda** (D84). Depends on `CorpusService`,
// `DurabilityService`, `DayService` and `FixedPoints`.
//
// The task list: one line per item, carrying its text, its status, its tags, its
// due date, its notes and its identity (MT3, D55, D56).
//
// **Formats and files, and nothing above them.** This is the agenda's *asked*
// form — what is being requested of somebody now. Some of it is a projection of
// standing work and some is native, typed by hand and belonging to no matter;
// this store cannot tell the two apart and does not need to, because which is
// which is a fact the docket holds (`step.made`).
//
// **A list is a document like any other**, which is why almost nothing here is
// special: the verbs write lines and the ordinary machinery does the rest. What
// is peculiar to a list is the *day* — an item lives on a day, carried forward
// until it is answered (D55, T11) — and that is why this service knows what day
// it is where the comments service does not.
//
// **Nothing here reaches into a docket.** Resolving an item has to tell the step
// that asked for it, moving one down has to make a matter, and finding which
// matter an item came from means reading every docket — all operations on the
// *pair*, so they belong to the construct and not to either store (D84).

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { DayService } from './day-service.ts'
import type { FixedPoints } from './fixed-point.ts'
import type { TodoDocument } from '../x/documents/kinds/todo.ts'
import type { ResolvedItem, TodoItem, TodoStatus, WalkState } from '../../shared/kinds/todo.ts'
import { ONLY_SEGMENT, TASKS_ID, type DateKey, type DocumentId, type SegmentKey } from '../../shared/document-api.ts'

/** How far back the resolved-by-tag question looks (T8's tail, MT6). */
const RESOLVED_DAYS = 30

export class Tasks {
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  readonly #day: DayService
  readonly #fixed: FixedPoints

  constructor(
    store: CorpusService,
    durable: DurabilityService,
    day: DayService,
    fixed: FixedPoints,
  ) {
    this.#store = store
    this.#durable = durable
    this.#day = day
    this.#fixed = fixed
  }

  #mutate<T>(work: () => Promise<T>): Promise<T> {
    return this.#store.mutate(work)
  }

  #touched(): void {
    this.#durable.touched()
  }

  /** Every item id in the corpus — an id names an item, not a list. */
  readonly #takenIds = (): Promise<ReadonlySet<string>> => this.#store.index.itemIds()



  // ── the task list (MT3) ──────────────────────────────────────

  /**
   * The notebook's TODO list, made if there is not one yet.
   *
   * **The `.todo` directory at the root is *the* list** (T1, D59) — the same
   * way one stream is the notebook. It falls out of the layout rather than
   * being named anywhere, and a second one at the root is an anomaly rather
   * than a choice this has to arbitrate.
   *
   * Made on demand, because a notebook that has never had a task list should
   * not carry an empty directory for one, and the first time you open the list
   * is a perfectly good moment to decide you have one.
   */
  async todoList(): Promise<DocumentId> {
    await this.#day.ready()
    // **Named, not searched for** (D55 as amended, MT7). This used to return
    // whichever root-level `.todo` came first, which with two lists means one
    // silently wins — and `tasks.todo` is *the* task list the way
    // `notebook.stream` is *the* notebook, so it answers the way that does.
    const made = TASKS_ID
    // No `create`: a directory document has no single file to be created, and
    // the day the carry materialises IS what brings it into being.
    await this.#store.corpus.use(made, doc => (doc as TodoDocument).carry(this.#day.today, this.#takenIds))
    this.#touched()
    return made
  }

  /**
   * Today's working set, materialised if this is the day's first touch (D55).
   *
   * **The carry is here rather than in the walk**, which is the correction D55
   * records: the walk is offered and never compelled, so a list whose survival
   * depended on it would come apart the first week away from the desk. Opening
   * the list is enough, and opening it twice does nothing the second time.
   */
  /**
   * Which segment of this list to show, and the carry that materialises it.
   *
   * **The writing day, not the calendar's** (D62). A list fetched at 00:30
   * while somebody is still going shows the evening they are still in, and
   * carries when they have stopped — the same boundary the notebook uses,
   * asked at the moment the list is looked at.
   *
   * **Named `SegmentKey` rather than `DateKey`** (MT7), which the compiler does
   * not care about — `DateKey` is an alias for `SegmentKey`, not a brand of its
   * own — and a reader does: an overall list has one segment and no days, so a
   * signature promising a date would be promising something this cannot always
   * give. The carry answers for both shapes: for a daily list it materialises
   * today, and for an overall one there is nothing to carry, so it adopts and
   * stops.
   */
  async todoToday(id: DocumentId): Promise<SegmentKey> {
    await this.#day.ready()
    const today = this.#day.today
    await this.#store.corpus.use(id, doc => (doc as TodoDocument).carry(today, this.#takenIds))
    this.#touched()
    const keys = await this.#store.corpus.use(id, doc => doc.keys(), { mode: 'read' })
    // The day for a daily list; the one segment for an overall one.
    return keys.includes(ONLY_SEGMENT) ? ONLY_SEGMENT : (today as unknown as SegmentKey)
  }

  /**
   * Which days this list has, oldest first (T7's flow 7, MT6).
   *
   * **Scrubbing is nearly free and this is why**: a past working set is not
   * reconstructed, it is a file. That is the property flow 7 was said to
   * constrain the format for — "if flow 3's designated set is persisted per
   * day, this is nearly free" — and D55 persisted it, so here is the bill.
   */
  async todoDays(id: DocumentId): Promise<readonly DateKey[]> {
    return this.#store.corpus.use(id, async doc => [...(await doc.keys())] as DateKey[], { mode: 'read' })
  }
  async todoItems(id: DocumentId, date: DateKey): Promise<readonly TodoItem[]> {
    return this.#store.corpus.use(id, doc => (doc as TodoDocument).itemsOn(date), { mode: 'read' })
  }

  /** Serialised with every other write, for the reason D37 gives. */
  /**
   * What was chosen for a day, and choosing (H9, MH4).
   *
   * **A mark on the day, not a status and not a tag** — see `CHOSEN` in the
   * document for why both of those are wrong. Nothing about this is contingent
   * on reorient: the ritual is offered and never required (H10), so choosing has
   * to be a thing you can simply do.
   */
  async todoChosen(id: DocumentId, date: DateKey): Promise<readonly string[]> {
    return this.#store.corpus.use(id, doc => (doc as TodoDocument).chosenOn(date), { mode: 'read' })
  }
  async todoChoose(id: DocumentId, date: DateKey, item: string, chosen: boolean): Promise<void> {
    await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as TodoDocument).choose(date, item, chosen)))
    this.#touched()
  }
  async todoAdd(id: DocumentId, text: string): Promise<string> {
    const made = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as TodoDocument).add(text, this.#day.today, this.#takenIds)),
    )
    this.#touched()
    return made
  }

  /** Rewrite what is written under an item. Nothing in a note is parsed. */
  async todoSetNotes(id: DocumentId, item: string, notes: readonly string[]): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as TodoDocument).setNotes(item, notes)))
    this.#touched()
  }
  async todoRemove(id: DocumentId, item: string): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as TodoDocument).remove(item)))
    this.#touched()
  }

  /**
   * Ids already spoken for anywhere in the corpus (MT5b, D56).
   *
   * **Handed to the document rather than looked up by it.** A `TodoDocument`
   * knows one list; `tephra:todo/<id>` resolves without naming a list, so the
   * id has to be unique across all of them, and only the index can say. Held as
   * a field so it is one function rather than a closure made at each call site,
   * and called only when an id is actually being minted.
   */


  /**
   * What was finished under each tag before today (T8's tail, MT6).
   *
   * **`today` is the service's**, because there is one answer about what day it
   * is and it lives here (D62). The index knows which day a file is; it does
   * not know which day it is now, and should not.
   */
  async todoResolved(): Promise<Record<string, readonly ResolvedItem[]>> {
    const byTag = await this.#store.index.resolvedByTag(this.#day.today, RESOLVED_DAYS)
    return Object.fromEntries(byTag)
  }

  /** Everything put down and not picked up again (T14). */
  async todoBacklog(): Promise<readonly ResolvedItem[]> {
    return this.#store.index.backlog()
  }

  /** Every tag that has ever been on a task (T6). The full set; live is today's. */
  async todoTags(): Promise<readonly string[]> {
    return this.#store.index.todoTags()
  }

  /** What the walk knows about a day (T11). A read: it decides nothing. */
  async todoWalk(id: DocumentId, date: DateKey): Promise<WalkState> {
    return this.#store.corpus.use(id, doc => (doc as TodoDocument).walkOf(date), { mode: 'read' })
  }

  /** End a pass. Serialised with every other write, for the reason D37 gives. */
  async todoFinishWalk(id: DocumentId, date: DateKey, drop: readonly string[]): Promise<number> {
    const dropped = await this.#mutate(async () =>
      this.#store.corpus.use(id, doc => (doc as TodoDocument).finishWalk(date, drop)),
    )
    this.#touched()
    return dropped
  }
  async todoEdit(id: DocumentId, item: string, text: string): Promise<void> {
    await this.#mutate(async () => this.#store.corpus.use(id, doc => (doc as TodoDocument).edit(item, text)))
    this.#touched()
  }
}
