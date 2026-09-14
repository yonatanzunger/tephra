// The document service: one Document, many window handles, and every verb the
// app can do.
//
// **Layers 1 and 2, not yet separated** (D83). This class is being split into
// services that follow the IPC channels, over the `CoreService` it already
// holds — so what is here is *everything that has not moved yet*, and the plan
// for where each part goes is `solution/service-layers.md`. It reaches the
// corpus only through the core, because a second path to a document would be a
// second path around the queue.
//
// The queue and the three write tiers are the core's now. The private names
// this file still uses for them — `#corpus`, `#stream`, `#index`, `#serial`,
// `#touched` — are forwarders, kept so that extracting the core moved no call
// site; they go as each service starts naming the foundation directly.
//
// DELIBERATELY FREE OF ELECTRON. The one rule that matters more than the rest
// is that edits apply in the order they were composed, and that ordering is
// exactly the kind of thing that is subtly wrong in a way no manual test
// notices. Keeping this module importable from plain Node is what lets it be
// tested at all.
//
// IPC *delivery* is ordered per channel, but `ipcMain.handle` runs handlers
// concurrently — a handler that awaits durability yields, and the next edit can
// start before it finishes. Two keystrokes would then interleave and the
// document would be reordered relative to what the typist saw.

import type { Anomaly } from '../../shared/anomalies.ts'
import type { LinkRow } from '../../shared/nav-api.ts'
import { inHorizon, orderHorizon, type HorizonRow, type HorizonWindow } from '../../shared/horizon-api.ts'
import { isOutside, isStream, BACKLOG_DOCKET, ONLY_SEGMENT, TASKS_ID, type Unsubscribe } from '../../shared/document-api.ts'
import { CHANNEL, type DocketCommand, type TodoCommand, type Attached, type Base, type DayProse, type DocketRow, type ImageAttachment, type ChangeAck, type DocumentInfo, type EditAck, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowChangedMessage, type WindowId, type WindowSnapshot, type ZoneNotice } from '../../shared/ipc.ts'
import type { DateKey, DocumentId, DocumentPosition, DocumentText, SegmentKey, Span, TypedSpan, VersionId } from '../../shared/document-api.ts'
import type { CommentId, CommentThread } from '../../shared/comments.ts'
import type { Notebook } from '../w/notebook.ts'
import type { Repository } from '../w/repository.ts'
import type { StreamHistory } from '../x/history.ts'
import type { RestoreReport, Version } from '../../shared/history-api.ts'
import {
  dayFile, documentRoot, kindOf, noteFile, NOTES_DIR, parseDayFile, relativePath,
  resolveInsideNotebook, DOCKETS_DIR, SECTIONS_DIR, slug, STREAM_DIR,
  type RelPath,
} from '../w/layout.ts'
import { attach } from '../x/documents/attachments.ts'
import { nameOf } from '../../shared/slug.ts'
import { spellTag } from '../../shared/tags.ts'
import { flattenLinks } from '../../shared/links.ts'
import { plainLine } from '../../shared/plain.ts'
import { DocketDocument } from '../x/documents/kinds/docket.ts'
import {
  dueOn, matterHorizon, MODES, parseInterval, spellInterval, spellStepWhen, UNSCHEDULED,
  type Matter, type Mode, type NewMatter, type Schedule, type Section, type StepKind,
} from '../../shared/kinds/docket.ts'
import { outsideExists, readOutside } from '../w/outside.ts'
import { DayClock } from '../x/day-clock.ts'
import { systemZone } from '../system-zone.ts'
import { isKnownZone } from '../../shared/dates.ts'
import { readSettings, writeSettings } from '../w/settings.ts'
import { TodoDocument } from '../x/documents/kinds/todo.ts'
import { isLive, RESOLVED_DAYS, shortLine, spellOwner, withoutMarks } from '../../shared/kinds/todo.ts'
import type { ResolvedItem, TodoItem, TodoStatus, WalkState } from '../../shared/kinds/todo.ts'
import { basename, isAbsolute, join } from 'node:path'
import { LOCAL } from '../w/layout.ts'
import { parseUiState, type UiState } from '../../shared/ui-state.ts'
import { addDays, asDateKey, compareDateKeys, dateKeyAt } from '../../shared/dates.ts'
import { StreamDocument } from '../x/documents/kinds/stream.ts'
import type { CorpusIndex } from '../x/documents/corpus-index.ts'
import { Scanner } from '../x/documents/search.ts'
import type { Search } from '../../shared/search-api.ts'
import { STREAM_ID, type Corpus } from '../x/documents/corpus.ts'
import { Filesets } from '../x/fileset.ts'
import type { LocalWindow } from '../x/window.ts'
import { Bus, type MessageSink } from './bus.ts'
import { CorpusService } from './corpus-service.ts'
import { documentKey, ASKED_KEY } from './change-keys.ts'
import { FixedPoints, type RunReport } from './fixed-point.ts'
import { DurabilityService } from './durability-service.ts'
import { DayService } from './day-service.ts'
import { CommentsService } from './comments-service.ts'
import { NavService } from './nav-service.ts'
import { HistoryService } from './history-service.ts'
import { SearchService } from './search-service.ts'
import { Dockets } from './dockets.ts'
import { Tasks } from './tasks.ts'
import { AgendaService } from './agenda-service.ts'
import { serve, serveKinds, type Served, type Serves } from './serves.ts'

/**
 * Anything that can carry a pushed message to a renderer.
 *
 * **Declared by the core now** (D83) and re-exported here so that nothing
 * importing it has to move while the layers are being separated.
 */
export type { MessageSink }


/**
 * How often the service checks whether the day has changed.
 *
 * Well below noticing, well above costing anything — and a poll rather than a
 * timer to the boundary because the case that matters most is a machine that
 * was asleep when the boundary passed.
 */
const DAY_CHECK_MS = 30_000

export interface ServiceOptions {
  /** The clock, so a test can be at any hour it likes without waiting. */
  readonly now?: () => Date
  /**
   * Where this machine says it is. Injected for the same reason `now` is: a
   * test cannot change the operating system's timezone, and the interesting
   * cases are all about that answer changing under a running app.
   */
  readonly systemZone?: () => string
  /** How often to notice midnight. Tests make it small. */
  readonly dayCheckMs?: number
  /**
   * Overridable so the tiers can be tested in milliseconds rather than by
   * waiting half an hour. **Both tiers, because they are chained**: a commit is
   * scheduled by a file write, so a test that compresses only the commit tier
   * is still waiting on the file tier's one-second quiescence and concludes,
   * wrongly, that the commit never happens.
   */
  readonly walBatchMs?: number
  /**
   * The file tier's quiescence. Verification lengthens it so that "the file
   * tier has not written yet" is a fact rather than a race — but the VALUE
   * arrives from the caller, because reading it means reading the environment
   * through the verify gate, and that gate imports Electron.
   */
  /** How long writing has to have stopped before the day may end (D62). */
  readonly idleMs?: number
  readonly quiesceMs?: number
  readonly maxIntervalMs?: number
  readonly versionQuiesceMs?: number
  readonly versionMaxMs?: number
  /** Off for tests that only want the document. */
  readonly history?: boolean
}

export class DocumentService {
  /**
   * **The foundation, held rather than inherited** (D83).
   *
   * Three focused services rather than one vague one: the bus pushes, the corpus
   * service owns the store and the one mutation queue, and the durability
   * service owns the three write tiers. They form a DAG — durability depends on
   * the corpus, the corpus on the bus, and nothing points back up.
   *
   * What is left in this class is domain and composing work that has not been
   * split out yet, and it reaches the corpus **only** through `#store`, because
   * a second path to a document would be a second path around the queue.
   */
  readonly #bus: Bus
  readonly #fixed: FixedPoints
  readonly #store: CorpusService
  readonly #durable: DurabilityService

  /**
   * The core's parts under the names this class has always called them.
   *
   * **Forwarders, so that extracting the core moved no call site.** There are
   * sixty-eight `#serial` calls alone; rewriting them in the same change that
   * moves the queue would have meant proving two things at once, with the
   * acceptance suites unable to say which of them had gone wrong. These go away
   * as each service is split out and names the foundation directly.
   */
  get #corpus(): Corpus {
    return this.#store.corpus
  }

  get #stream(): Promise<StreamDocument> {
    return this.#store.stream
  }

  get #index(): CorpusIndex {
    return this.#store.index
  }

  /**
   * The windows, and what keeps each one's document open.
   *
   * **A window holds its document directly**, so the Corpus must know a window
   * exists or it could let go of a document something is still pointing at.
   * That is what `watch` is for, and why the release is kept beside the window
   * rather than being derivable: it ends when the window does (D54).
   */
  readonly #windows = new Map<WindowId, { window: LocalWindow; release: Unsubscribe }>()
  #nextId: WindowId = 1


  /**
   * A system zone somebody has already declined to adopt.
   *
   * Held by main rather than by a window, so dismissing the offer in one window
   * dismisses it everywhere — three windows each asking the same question is
   * the same defect as three windows asking different ones.
   */
  #declined: string | null = null
  /**
   * The last zone notice anybody was told about, so a poll does not repeat it.
   *
   * **`undefined` is "nobody has been told anything", and null is "told there
   * is nothing to say"** — two different states, and collapsing them cost the
   * first bug this found: a window that got its notice from the opening
   * question rather than from a push left this at its initial value, so
   * adopting the zone computed the same value, decided nothing had changed, and
   * never told the window to put the row away.
   */
  #offered: string | null | undefined = undefined
  readonly #systemZone: () => string
  /** What day it is, and what zone that is computed in (D62, D63, D83). */
  readonly #day: DayService
  /** Margin notes, extracted (D47, D83). */
  readonly #comments: CommentsService
  /** What the sidebar asks, extracted (D52, D83). */
  readonly #nav: NavService
  /** Reading the past and putting it back, extracted (D32, D83). */
  readonly #history: HistoryService
  /** Searching the corpus, extracted — and it owns the Scanner (D65, D83). */
  readonly #search: SearchService
  /** Dockets, extracted (MH1, D68, D83). */
  readonly #docket: Dockets
  /** The task list, extracted (MT3, D55, D83). */
  readonly #todo: Tasks
  /** The agenda: one construct with two forms (D84). */
  readonly #agenda: AgendaService

  readonly #notebook: Notebook

  constructor(notebook: Notebook, options: ServiceOptions = {}) {
    this.#notebook = notebook
    // **The core first**, because everything below this line reaches through it:
    // the corpus, the index and the stream are its, and so is the queue (D83).
    // **The foundation, innermost first.** The bus depends on nothing, the
    // corpus service on the bus, and durability on the corpus — so they are
    // built in that order and the DAG is visible in the construction (D83).
    this.#bus = new Bus()
    // **Depends on nothing, like the bus** — and both the bottom and the top
    // depend on it: the corpus reports change keys into it, and the
    // reconciliation clause registers with it. A leaf mediating between the two
    // is what keeps the edge from pointing upward (D83).
    this.#fixed = new FixedPoints()
    this.#store = new CorpusService(notebook, this.#bus, this.#fixed)
    this.#durable = new DurabilityService(this.#store, this.#fixed, options)
    // Beside the index rather than in the core: only search uses the Scanner,
    // so it belongs to the search service when that is split out (D83).
    this.#day = new DayService(this.#store, this.#durable, this.#bus, this.#fixed, options)
    this.#systemZone = options.systemZone ?? systemZone
    // **The one upward edge left, inverted.** Every poll has to re-offer the
    // zone, which is session UI state and lives above the day service — so it
    // announces and this subscribes (D83). The roll used to be a second such
    // edge; it publishes a `day:` key now, which the reconciler's trigger picks
    // up like any other change.
    this.#day.onChecked(() => this.#tellAboutTheZone())
    this.#comments = new CommentsService(this.#store, this.#durable, this.#day)
    this.#nav = new NavService(this.#store, this.#day)
    this.#history = new HistoryService(this.#store, this.#durable)
    this.#search = new SearchService(this.#store)
    this.#docket = new Dockets(this.#store, this.#durable, this.#day, this.#fixed)
    this.#todo = new Tasks(this.#store, this.#durable, this.#day, this.#fixed)
    // **The construct, over its two stores** (D84). Built last, because it is
    // the only one that knows about both.
    this.#agenda = new AgendaService(
      this.#store, this.#durable, this.#day, this.#fixed, this.#docket, this.#todo,
    )
  }

  /**
   * The services split out so far, for `ipc.ts` to wire (D83).
   *
   * **This class builds them because it owns the foundation**, which nothing
   * else can reach yet. As groups move out they are constructed here and added
   * to this list; when the last one has gone, what builds the foundation moves
   * up to `index.ts` and this class is finished.
   */

  services(): readonly Serves[] {
    return [this.#comments, this.#nav, this.#history, this.#search, this.#agenda]
  }

  /**
   * The extracted services, by name, for whoever still reaches through here.
   *
   * **Transitional and deliberately plain.** The integration suites construct a
   * `DocumentService` and ask it things; as a group moves out, the suite's route
   * to it moves too, and naming the service is more honest than leaving a
   * forwarder on this class that pretends the verb is still its own. Both go
   * away together when composition moves up to `index.ts`.
   */
  get comments(): CommentsService {
    return this.#comments
  }

  get nav(): NavService {
    return this.#nav
  }

  get pastVersions(): HistoryService {
    return this.#history
  }

  get searches(): SearchService {
    return this.#search
  }

  /**
   * The docket store: `service.docket.add(…)`, `service.docket.matters(…)`.
   *
   * **The prefixes are gone.** Inside one enormous class `docketAdd` had to say
   * which half of the notebook it belonged to; once the halves became classes
   * the prefix said twice what the accessor says once, and the strip was its own
   * change (some four hundred call sites) rather than a rider on the move that
   * made it redundant.
   */
  get docket(): Dockets {
    return this.#docket
  }

  /** The task store, the same way: `service.todo.add(…)`, `service.todo.items(…)`. */
  get todo(): Tasks {
    return this.#todo
  }

  /** The agenda — the construct the dockets and the task list are two forms of. */
  get agenda(): AgendaService {
    return this.#agenda
  }

  // ── UI state: where the reader was ─────────────────────────

  async loadUiState(): Promise<UiState> {
    return parseUiState(await this.#notebook.read(LOCAL.uiState))
  }

  /**
   * Written straight through rather than queued behind edits: losing a cursor
   * position is cheap and self-correcting, and making it wait behind the write
   * tiers would spend a real guarantee on a soft one.
   */
  async saveUiState(state: UiState): Promise<void> {
    await this.#notebook.write(LOCAL.uiState, JSON.stringify(state, null, 2) + '\n')
  }

  /**
   * The document table, for callers that legitimately hold one document.
   *
   * Not a way around the service — every write still goes through a borrowed
   * document, which is the invariant (D54). It exists because the service is
   * the thing that HAS the corpus, and a test or a tool asking about a document
   * should not have to build a second one beside it.
   */
  get corpus(): Corpus {
    return this.#corpus
  }

  /** The stream itself, for the few callers that legitimately want it. */
  document(): Promise<StreamDocument> {
    return this.#stream
  }

  /** Run `work` after everything already queued, and before anything queued later. */
  /**
   * The corpus service's queue, under the name this class's callers use — and
   * **the one gate on the day being real**.
   *
   * A synchronous `today` is a lie until the clock is seeded, because the day
   * cannot be known without reading the newest written day and the notebook's
   * zone. The old comment claimed every door awaited the seed; six of about a
   * hundred and fifty did, and `todo.add` was not among them — so a write racing
   * startup could file an item under the guessed day while every later read
   * looked under the real one, and the item simply was not there.
   *
   * **Gated here because every mutation already comes through here**, and a
   * hundred and fifty remembered `await`s is exactly the arrangement that was
   * already wrong. Reads are deliberately not gated: a read that is a day stale
   * corrects itself on the next poll, and a write does not.
   */
  async #serial<T>(work: () => Promise<T>): Promise<T> {
    await this.#day.ready()
    return this.#store.mutate(work)
  }

  /**
   * What the renderer needs to build a handle on a document.
   *
   * Defaults to the stream, because that is what opening the app opens — but
   * it takes an id now, so a sidebar row naming a note can be followed (D54).
   * `extent` is a stream's question and comes back null for anything else:
   * "not applicable", said in the one vocabulary the wire has for it.
   */
  async info(id: DocumentId = STREAM_ID): Promise<DocumentInfo> {
    await this.#day.ready()
    return this.#corpus.use(
      id,
      async doc => ({
        id,
        meta: doc.meta,
        // A stream is not a document anybody named; every other kind keeps its
        // name where a person can edit it, which is the frontmatter.
        title: isStream(doc) ? null : await doc.titleOf(ONLY_SEGMENT),
        generation: doc.generation,
        today: this.today,
        clockDay: this.clockDay,
        zone: this.zone,
        extent: isStream(doc) ? await doc.extent() : null,
      }),
      { mode: 'read' },
    )
  }

  async openWindow(request: ReadRequest): Promise<WindowSnapshot> {
    await this.#day.ready()
    const docId = request.doc ?? STREAM_ID
    const window = await this.#corpus.use(
      docId,
      async doc =>
        (await doc.read({
          begin: doc.positionAt(request.first, 0),
          end: doc.positionAt(request.last, 0),
        })) as LocalWindow,
    )

    const id = this.#nextId++
    // The watch is what keeps the document open for as long as something is
    // looking at it — a borrow ends when the call does, and a window outlives
    // the call that made it (D54).
    this.#windows.set(id, { window, release: this.#corpus.watch(docId) })
    window.onChanged((edits, origin) => {
      this.#broadcast({
        id,
        edits,
        origin,
        generation: window.generation,
        text: window.text,
        spans: window.spans(),
        placement: window.placement(),
        boundaries: window.boundaries,
      })
    })
    window.onReset(() => this.#broadcastReset(id))
    return this.#snapshot(id, window)
  }

  #snapshot(id: WindowId, window: LocalWindow): WindowSnapshot {
    return {
      id,
      text: window.text,
      span: window.span,
      generation: window.generation,
      spans: window.spans(),
      placement: window.placement(),
      boundaries: window.boundaries,
    }
  }

  /** Growing the region is a mutation, so it queues with the edits. */
  async extend(request: ExtendRequest): Promise<void> {
    await this.#serial(async () => {
      const window = this.#windows.get(request.id)?.window
      if (window === undefined) throw new Error(`no such window ${request.id}`)
      await window.extend(request.direction, request.chars)
    })
  }

  async edit(request: EditRequest): Promise<EditAck> {
    return this.#serial(async () => {
      const window = this.#windows.get(request.id)?.window
      if (window === undefined) throw new Error(`no such window ${request.id}`)
      await window.edit(request.edits, request.origin)
      // The idle rule's only input, and it is free here: every keystroke
      // already passes through this method (D62).
      if (request.origin === 'user') this.#day.wrote()
      this.#durable.writeSoon()
      return {
        generation: window.generation,
        length: window.text.length,
        spans: window.spans(),
        placement: window.placement(),
      }
    })
  }

  /** Where the notebook is. Printing resolves relative links against it. */
  get notebookRoot(): string {
    return this.#notebook.root
  }

  /** Self-check only. What every open window is holding, and whether it agrees. */
  diagnose(): unknown {
    return [...this.#windows.entries()].map(([id, { window }]) => ({
      id,
      text: window.text.length,
      segments: window.diagnose(),
    }))
  }

  async anomalies(): Promise<readonly Anomaly[]> {
    return (await this.#stream).anomalies()
  }

  /**
   * Undo, on the document that asked.
   *
   * **Whose stack a keystroke means is a question about FOCUS**, and focus is
   * the renderer's to know — so the id comes in rather than being decided here.
   * It defaults to the stream, which is what the only focusable surface holds.
   */
  async undo(id: DocumentId = STREAM_ID): Promise<ChangeAck> {
    const ack = await this.#serial(() =>
      this.#corpus.use(id, async doc => {
        const change = await doc.undo()
        this.#durable.writeSoon()
        return { change, generation: doc.generation }
      }),
    )
    // **Still reconciles**, because an undo IS a change to a source of truth and
    // the derived side has to catch up — a step's completion put back, a date
    // restored. What it no longer has to repair is a half-undone *move*: that is
    // written as a `transfer` and undo does not reach it at all (MH5).
    await this.#agenda.reconcile().catch(() => undefined)
    return ack
  }

  async redo(id: DocumentId = STREAM_ID): Promise<ChangeAck> {
    return this.#serial(() =>
      this.#corpus.use(id, async doc => {
        const change = await doc.redo()
        this.#durable.writeSoon()
        return { change, generation: doc.generation }
      }),
    )
  }

  /** Write anything outstanding — the core's file tier (D83). */
  async flush(): Promise<void> {
    return this.#durable.flush()
  }

  // ── the day, which changes whether or not anyone is looking ──

  /** What day the app is filing into — the day service's (D62, D83). */
  get today(): DateKey {
    return this.#day.today
  }

  /** The moment to stamp a completion with: the same clock that answers `today`. */
  get #moment(): number {
    return this.#day.moment
  }

  /** What the calendar says, as against what the notebook is writing into. */
  get clockDay(): DateKey {
    return this.#day.clockDay
  }

  /** What zone this notebook's dates are computed in (D63). */
  get zone(): string {
    return this.#day.zone
  }

  /** Say where you are now, and keep it with the notebook (D63). */
  async setZone(zone: string): Promise<void> {
    await this.#day.setZone(zone)
    // A zone somebody chose is not a zone somebody declined.
    this.#declined = null
    this.#tellAboutTheZone()
  }

  /**
   * What to say about the zone, if anything (D63).
   *
   * **Main answers this, not a window.** The zone is offered and never applied,
   * and the offer is only useful if it is the same offer everywhere: two
   * windows each resolving the system zone in their own process got two
   * answers — a renderer's `Intl` is fixed when its context is created — and
   * sat side by side proposing to move the notebook in opposite directions.
   *
   * Null while they agree, while the machine's zone is one this build cannot
   * compute in, and while somebody has already said no to this one.
   */
  get zoneNotice(): ZoneNotice | null {
    const system = this.#systemZone()
    if (system === this.zone || system === this.#declined || !isKnownZone(system)) return null
    return { notebook: this.zone, system }
  }

  /**
   * No thanks — travelling, or the machine is wrong, and either way the
   * notebook stays where it is. Silent until the machine moves somewhere new.
   */
  dismissZone(): void {
    this.#declined = this.#systemZone()
    this.#tellAboutTheZone()
  }

  /**
   * The same answer, for a window that is asking on its way in.
   *
   * **Asking reconciles.** A window opening between two polls is the one moment
   * main is asked a question it has not yet had a reason to ask itself, and the
   * answer has to reach the OTHER windows too — otherwise the window that asked
   * is the only one that is right, which is the entire defect this exists to
   * fix, rebuilt out of new parts.
   */
  askZoneNotice(): ZoneNotice | null {
    this.#tellAboutTheZone()
    return this.zoneNotice
  }

  /**
   * Push the notice when it has changed, from wherever noticed it.
   *
   * Every window is told the same thing at the same time, which is the property
   * that was missing. Repeating an unchanged notice on every poll would be
   * harmless and is still not done: a window that redraws itself twice a minute
   * for no reason is a window somebody will eventually have to debug.
   */
  #tellAboutTheZone(): void {
    const notice = this.zoneNotice
    const key = notice === null ? null : `${notice.notebook} ${notice.system}`
    if (key === this.#offered) return
    this.#offered = key
    this.#bus.announce(CHANNEL.zoneNotice, notice)
  }

  /** Cross a boundary if there is one to cross, and say so (D62). */
  async crossTheDay(): Promise<void> {
    return this.#day.crossTheDay()
  }

  // ── durability, which is the core's (D32, D83) ───────────────
  //
  // The three tiers — log, file, version — live in `CoreService` now. What is
  // left here is the doors into them, kept so that `main/index.ts` and the
  // suites need not know the split has happened yet, and the READS over the
  // history, which belong to a history service when that is split out.

  /** Replay whatever the last session did not manage to write. */
  async recover(): Promise<number> {
    return this.#durable.recover()
  }

  /**
   * Open the repository and reconcile whatever happened while the app was not
   * running. Separate from the constructor because it does real I/O and can
   * legitimately be skipped — a test that only wants the document should not
   * pay for a git repository.
   */
  /** Open the notebook's history, if it has one — the core's version tier. */
  async openHistory(): Promise<void> {
    return this.#durable.openHistory()
  }

  /** Record a version of the notebook now. */
  async saveVersion(): Promise<VersionId | null> {
    return this.#durable.saveVersion()
  }

  /** The history, for reading. Null when history is off. */
  get repository(): Repository | null {
    return this.#durable.repository
  }

  /** Days and versions, rather than paths and object ids (D32). */
  get history(): StreamHistory | null {
    return this.#durable.history
  }



  /** The corpus index (D52) — what the sidebar asks, and what repairs it. */
  get index(): CorpusIndex {
    return this.#index
  }


  /** Every written day in a range, as prose — what printing and export read. */
  async proseIn(from: DateKey, to: DateKey): Promise<readonly DayProse[]> {
    return (await this.#stream).proseIn(from, to)
  }





  /**
   * Quiesce: write anything outstanding, commit it, and stop the timers.
   *
   * Session end is the third of the commit tier's three triggers (D32), and the
   * important one — it is what makes "I wrote for ten minutes and quit" land in
   * the history rather than waiting for a quiescence that will never come.
   */
  async stop(): Promise<void> {
    return this.#durable.stop()
  }

  releaseWindow(id: WindowId): void {
    const held = this.#windows.get(id)
    held?.window.release()
    // And tell the Corpus that one fewer thing is pointing at the document. The
    // stream stays open regardless — the service watches it too — but for every
    // other document this is what "closed" means.
    held?.release()
    this.#windows.delete(id)
  }

  /**
   * Spans across the corpus, answered by the INDEX rather than by a document.
   *
   * **A document answers about itself; the index answers about everything.**
   * Asking the stream would mean loading every day it has ever had to build a
   * list of dates — instant at a fortnight, a gigabyte at twenty years (D52).
   * The index holds exactly that answer and refreshes it by borrowing.
   *
   * Spans in files no document is holding open have no `DocumentPosition` to be
   * given, so they are left out here; the sidebar asks the index directly and
   * gets them (D54).
   */
  async spans(request: SpansRequest): Promise<readonly TypedSpan[]> {
    const stream = await this.#stream
    const out: TypedSpan[] = []
    for (const { at, span } of await this.#index.spansOf(request.kind)) {
      if (at.date === null) continue
      out.push(stream.typed(at.date, span))
    }
    return out
  }

  /** Bookmark a point (R11's degenerate range). Serial, like every mutation. */
  async setAnchor(at: DocumentPosition, name: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).setAnchor(at, name))
    this.#touched()
  }

  /**
   * Put a subject over a range, or take it off one. Serial, like every mutation.
   *
   * Z asks for both through the same door because they are the same operation
   * with opposite signs — see `StreamDocument.#retag`.
   */
  async tag(span: Span, subject: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).tag(span, subject))
    this.#touched()
  }

  async untag(span: Span, subject: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).untag(span, subject))
    this.#touched()
  }

  /**
   * Branch a range into its own file. Serial, and flushed straight away: the
   * new file is already on disk, so leaving the stream's half of the operation
   * sitting in memory is the one window where the two disagree (D13).
   */
  async branch(span: Span, name: string): Promise<DocumentId> {
    const id = await this.#serial(async () => (await this.#stream).branch(span, name))
    // Not `#touched()`: the branched file is already on disk, so the window
    // where the two halves disagree is closed now rather than in a second (D13).
    this.#durable.unsaved()
    await this.flush()
    return id
  }

  /**
   * Where a link found in the text points, or null if it will not be followed.
   *
   * Containment is `resolveInsideNotebook`'s job and is tested there; a link
   * that leads out of the notebook, or names a file that is not there, resolves
   * to nothing.
   *
   * **This returns a path rather than opening it**, because opening is
   * Electron's and this object is deliberately free of Electron — three test
   * suites drive it under plain node, and an `import { shell }` at the top of
   * this file broke all three at module load. That is the same fault as reading
   * `app.isPackaged` at module scope (see `verify-mode.ts`), and it is the
   * layering telling the truth: what a link means is a question about the
   * notebook, and opening a file is a question about the desktop.
   */
  // ── the file lifecycle ───────────────────────────────────────

  /**
   * A new document, named for what it is not yet.
   *
   * `untitled`, `untitled-2`: a name is the one thing deferred, because it is
   * the one thing you do not know before writing the thing. Everything else
   * about it is real from the first keystroke — versioned, journalled,
   * recoverable — which an unsaved buffer would not be.
   */
  /**
   * A new document, of whichever kind was asked for (MT7).
   *
   * **The same gesture makes both**, which is the whole of what "just like we
   * create new md files" asks for: a `.todo.md` is an overall task list, a
   * `.md` is a note, and the only difference between making them is the suffix.
   * A DAILY list is not made this way and could not be — a directory document
   * has no single file to create, and the day its first carry materialises is
   * what brings it into being (D59).
   */
  async newDocument(
    label?: string,
    section?: string,
    kind?: 'markdown' | 'todo' | 'docket',
  ): Promise<DocumentId> {
    const wanted = label?.trim() ?? ''
    // **One rule, read both ways: every docket lives in `dockets/`** (MH1).
    //
    // *Directory → kind*: a file made from the dockets listing is a docket, so
    // the sidebar's *New File* needs no separate gesture and getting a markdown
    // file out of that listing would be a surprise nobody asked for.
    //
    // *Kind → directory*: a docket asked for by name — File ▸ New Docket — goes
    // to `dockets/` even though no section was named, because there is nowhere
    // else it could go. Without this half the FIRST docket was impossible from
    // the UI: with no `dockets/` on disk the sidebar shows no section, so there
    // was no listing to make one from.
    const made = kind ?? (directoryFor(section) === DOCKETS_DIR ? 'docket' : 'markdown')
    const into = made === 'docket' && section === undefined ? DOCKETS_DIR : directoryFor(section)
    const id = await this.#freeNoteName(
      wanted === '' ? 'untitled' : slug(wanted),
      into,
      made === 'todo' ? '.todo.md' : made === 'docket' ? '.docket.md' : '.md',
    )
    await this.#corpus.create(id, wanted === '' ? undefined : wanted)

    // **Made where you asked for it, which for a list means IN the list.** A
    // file made from a directory's listing is in that directory and shows up
    // because it is there; a file made from a curated section is in `notes/`
    // and shows up because a line was written for it. The gesture is the same
    // one and the answer to "where did it go" is the same: the section you were
    // looking at. Only a section with a file has a line to write (D53).
    if (section !== undefined && (await this.#corpus.exists(section as DocumentId))) {
      await this.#store.filesets.pin({ kind: 'file', path: relativePath(section as RelPath, id as string as RelPath) },
        wanted === '' ? nameOf(id) : wanted, section)
    }
    this.#touched()
    // **A new document announces itself**, which it did not: `#touched` marks
    // the corpus dirty for the write tiers and tells no surface anything. Any
    // view holding a list of documents — the row menu's *put down in…*, a
    // sidebar — could not know a docket had just been made, so the first thing
    // somebody did with a new docket was find it missing from the one place
    // they would look for it.
    this.#changed(id)
    return id
  }

  /**
   * Rename a document, and fix what pointed at it.
   *
   * **The references are the point.** A fileset links by relative path, so a
   * rename without this leaves every section that names the document pointing
   * at nothing — and D7 says such an entry dangles visibly, which is right for
   * a file somebody deleted and wrong for one they merely renamed.
   *
   * Returns the new id. The caller moves whatever was looking at the old one: a
   * document's identity is its path, so the old id is genuinely gone.
   */
  async renameDocument(id: DocumentId, label: string): Promise<DocumentId> {
    const wanted = label.trim()
    if (wanted === '') throw new Error('a document needs a name')
    if (isOutside(id)) throw new Error('a file outside the notebook is not ours to rename')

    const to = await this.#freeName(id, wanted)
    if (to === id) return id
    await this.#corpus.rename(id, to)
    // **A titled document is renamed too, not only moved.** The filename is the
    // identity and the frontmatter title is what it is CALLED; leaving the old
    // title behind would make Rename appear to do nothing, since the panel
    // shows the title when there is one.
    await this.#corpus.use(to, async doc => {
      if ((await doc.titleOf(ONLY_SEGMENT)) !== null) await doc.setTitleOf(ONLY_SEGMENT, wanted)
    })
    await this.#store.filesets.retarget(id as string as RelPath, to as string as RelPath)
    this.#touched()
    return to
  }

  /** The same content under a new name; the original is left alone. */
  async duplicateDocument(id: DocumentId, label: string): Promise<DocumentId> {
    const wanted = label.trim()
    if (wanted === '') throw new Error('a copy needs a name')
    const to = await this.#freeName(id, wanted)
    await this.#corpus.duplicate(id, to)
    this.#touched()
    return to
  }

  /**
   * Delete a document. Entries that named it are left to dangle, VISIBLY (D7).
   *
   * Deliberately not the same as rename: an entry pointing at a document
   * somebody deleted is a true statement about the notebook, and quietly
   * removing it would edit a list they curated on the strength of a guess about
   * what they meant.
   */
  async deleteDocument(id: DocumentId): Promise<void> {
    if (id === STREAM_ID) throw new Error('the notebook itself cannot be deleted')
    if (isOutside(id)) throw new Error('a file outside the notebook is not ours to delete')
    await this.#corpus.remove(id)
    this.#touched()
  }

  /** A name nobody is using, in the directory the document already lives in. */
  async #freeName(id: DocumentId, label: string): Promise<DocumentId> {
    const rel = id as string as RelPath
    const cut = rel.lastIndexOf('/')
    const dir = cut < 0 ? '' : rel.slice(0, cut)
    // **A rename must not change what the document IS.**
    //
    // This read `.fileset.md` or else `.md`, so renaming an overall task list
    // turned it into a plain markdown file — silently, since the content is
    // markdown either way and nothing errors. A docket renamed the same way
    // stopped being a docket, which is how it was found (reported from use,
    // MH1): *"selecting rename on a docket does nothing"*, because what it
    // actually did was take the kind off.
    //
    // Type is declared by the name (D3), so the name is the one thing a rename
    // may not invent. Asked as a list rather than a chain of tests, because the
    // next kind to arrive is the one that would have been forgotten.
    const suffix = KIND_SUFFIXES.find(end => rel.endsWith(end)) ?? '.md'

    for (let n = 1; ; n++) {
      const name = n === 1 ? slug(label) : `${slug(label)}-${n}`
      const candidate = (dir === '' ? `${name}${suffix}` : `${dir}/${name}${suffix}`) as string as DocumentId
      if (candidate === id || !(await this.#corpus.exists(candidate))) return candidate
    }
  }



  /**
   * What DOCUMENT a link names, if it names one.
   *
   * The other half of `linkTarget`, and the half that had no answer until there
   * were documents other than the stream: a `.md` file inside the notebook is
   * not a file for the OS to open in some other editor, it is a document this
   * app opens (D54). Anything the corpus does not recognise as a document — an
   * attachment, a PDF — is not one, and falls through to the desktop.
   */
  async documentAt(target: string, from?: RelPath): Promise<DocumentId | null> {
    const rel = resolveInsideNotebook(this.#notebook.root, target, from)
    if (rel === null || kindOf(rel) === null) return null
    const id = rel as string as DocumentId
    return (await this.#corpus.exists(id)) ? id : null
  }

  /**
   * What document a FILE PICKER's answer names — inside the notebook or not.
   *
   * **Deliberately not `documentAt`.** That one answers about a link found in a
   * document's text, which is untrusted data: `../../../..` in a line of prose
   * can reach anywhere on the machine, and it is refused for exactly that
   * reason. A person choosing a file in a dialog is an intention, not data, so
   * this one may say yes to a path outside the notebook — and what comes back
   * is an outside document, which is read-only and says so (MC6).
   */
  async documentForFile(path: string): Promise<DocumentId | null> {
    const inside = await this.documentAt(path)
    if (inside !== null) return inside
    if (!isAbsolute(path) || kindOf(path as RelPath) === null) return null
    return (await outsideExists(path)) ? (path as string as DocumentId) : null
  }

  /**
   * Bring an outside file in: a COPY, and the original left alone.
   *
   * D47's rule, applied one level up. The import gesture keeps the file it came
   * from untouched and puts a copy where this app can keep its promises — from
   * the moment it lands it is versioned, indexed, watched and undoable, none of
   * which is true of a file Tephra merely opened.
   *
   * The provenance goes in the frontmatter rather than in the text: it is a
   * fact about the document, not a sentence somebody wrote, and `source:` is
   * preserved verbatim on every rewrite like any other unknown key.
   */
  async importFile(id: DocumentId): Promise<DocumentId> {
    if (!isOutside(id)) return id // already ours; importing it would be a second copy

    const from = id as string
    const text = await readOutside(from)
    if (text === null) throw new Error(`${from} could not be read`)

    const rel = await this.#freeNoteName(basename(from).replace(/\.md$/i, ''))
    await this.#corpus.use(rel, async doc => {
      await doc.setBodyOf(ONLY_SEGMENT, text as DocumentText)
      await doc.setTitleOf(ONLY_SEGMENT, basename(from).replace(/\.md$/i, ''))
      await doc.setSourceOf(ONLY_SEGMENT, from)
    })
    this.#touched()
    return rel
  }

  /** A name nobody is using. Importing twice makes two notes, not one overwrite. */
  async #freeNoteName(name: string, directory = NOTES_DIR, suffix = '.md'): Promise<DocumentId> {
    for (let n = 1; ; n++) {
      const wanted = n === 1 ? name : `${name} ${n}`
      const rel = (
        directory === NOTES_DIR && suffix === '.md'
          ? noteFile(wanted)
          : `${directory}/${slug(wanted)}${suffix}`
      ) as DocumentId
      if (!(await this.#corpus.exists(rel))) return rel
    }
  }

  async linkTarget(target: string, from?: RelPath): Promise<string | null> {
    const rel = resolveInsideNotebook(this.#notebook.root, target, from)
    if (rel === null) return null
    if (!(await this.#notebook.has(rel))) return null
    return join(this.#notebook.root, rel)
  }

  /** Change what one span is tagged as. Not a corpus-wide rename (D44). */
  async renameTag(span: Span, from: string, to: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).renameTag(span, from, to))
    this.#touched()
  }

  async removeAnchor(name: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).removeAnchor(name))
    this.#touched()
  }

  // ── comments: extracted (D47, D83) ─────────────────────────
  //
  // The eight verbs and their channels are `services/comments-service.ts` now —
  // the first group out, chosen as the pilot because it writes, so the move
  // exercised the store, the queue and the write tiers rather than only the
  // channel declaration. Nothing else in main called them, so nothing here
  // forwards to them: the service is wired beside this one in `ipc.ts`.
  //
  // **This class no longer serves any channel of its own.** It will again as
  // groups are moved out and the switch shrinks; what is left in the switch is
  // what has not moved.

  /**
   * Something changed that has to reach the file tier.
   *
   * Every mutation ends with this pair, and for a while every mutation wrote it
   * out again — nine copies of two lines, which is nine chances for the next
   * one to set the flag and forget the timer, and a document that then saves
   * only when something else happens to save.
   */
  #touched(): void {
    this.#durable.touched()
  }

  /** The same, for the version tier's much longer clock (D32). */
  #versionable(): void {
    this.#durable.versionable()
  }

  /**
   * Import text at a point. **The clipboard is read by `ipc.ts`**, not here —
   * reading it means importing Electron, and this object stays free of it
   * (`tests/unit/main/no-electron.test.ts`).
   */
  async importText(
    at: DocumentPosition,
    text: string,
    original: { readonly content: string; readonly ext: string },
  ): Promise<string> {
    const rel = await this.#serial(async () => (await this.#stream).importText(at, text, original))
    this.#touched()
    return rel
  }

  /**
   * An image into `attachments/`, and a relative link back to it (R7).
   *
   * **The bytes are written and nothing is inserted**, which is the whole of
   * the split. Where the link goes is a caret in some document, and the surface
   * that has the caret already knows how to put text at it — through the
   * ordinary edit path, so undo works, the journal records it, and this needs no
   * per-kind knowledge of what it is being pasted into. `importText` predates
   * that idea and reaches into the stream to place a block; an image should not
   * have to.
   *
   * **Filed under the day it ARRIVED**, whatever it is being pasted into. A
   * picture pasted into a note has no date of its own, and the day it turned up
   * is the only honest one — which is also what makes `attachments/YYYY/MM/`
   * browsable in a file manager.
   *
   * **The hash is the deduplication.** The same screenshot pasted twice writes
   * the same path with the same bytes, which is a no-op rather than a second
   * copy — and two different images cannot collide into one name unless they
   * are the same image.
   */
  async attachImage(request: ImageAttachment): Promise<Attached> {
    await this.#day.ready()
    // **Written by the floor**, because writing files is the floor's job and an
    // attachment is the one kind of corpus content with no document to write it
    // (`x/documents/attachments.ts`). The layering test is what said so.
    const rel = await attach(this.#notebook, this.today, request.name, request.ext, request.bytes)
    this.#touched()
    return { rel, link: relativePath(fileOfBase(request.base), rel) }
  }

  /**
   * Which directory a document's relative links resolve from (R7).
   *
   * **Asked of main because it is layout knowledge** (D59): which file a day
   * lives in, and how deep that is, is exactly what `w/layout.ts` exists to be
   * the only answer to. The renderer needs it to point an `<img>` at a file in
   * `attachments/`, and it needs it synchronously per image — so it is fetched
   * once per document rather than once per picture.
   *
   * **Any day of the stream will do**, which is not a coincidence: every day
   * file sits at the same depth, which is the same fact printing relies on for
   * its own relative links (Spike B).
   */
  async linkBase(base: Base): Promise<string> {
    await this.#day.ready()
    const file = fileOfBase(base.kind === 'day' ? base : base, this.today)
    return file.split('/').slice(0, -1).join('/')
  }




  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    return (await this.#stream).resolveAnchor(name)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    return (await this.#stream).extent()
  }

  // ── pushing to the renderer ────────────────────────────────

  /** Where pushed messages go — the core's bus (D83). */
  addSink(sink: MessageSink): () => void {
    return this.#bus.addSink(sink)
  }

  #broadcast(message: WindowChangedMessage): void {
    this.#bus.announce(CHANNEL.windowChanged, message)
  }

  /**
   * Written to: the notebook is dirty, and this document in particular changed.
   *
   * **One call, because forgetting the second half is silent.** A verb that
   * marks the notebook dirty without naming what it wrote leaves any surface
   * holding that document showing yesterday's answer, with nothing to say so.
   */
  /**
   * A docket was written to, so what derives from dockets may now be wrong.
   *
   * **Reconcile on every docket write, rather than on a list of the writes that
   * count.** The list was the bug: `suspend` reconciled and `activate` did not,
   * so activating a matter put nothing on the task list until the next startup
   * or midnight — while the horizon, which is computed live, showed the step as
   * still coming. Reported from use as *I see it in the horizon but not in the
   * list*, which is exactly what that asymmetry looks like from outside.
   *
   * **Suspend got one only because it had a bespoke withdrawal loop to delete.**
   * Nothing prompted the same thought for the twenty-six verbs that never had
   * one — which is the argument for asking *what should be true?* after any
   * write, instead of deciding per verb whether this one could have changed it
   * (D77). A verb that cannot is merely paying for a pass that finds nothing.
   */
  /**
   * Written to: dirty, announced, and reconciled — the durability service's now.
   *
   * **It was three lines here and three lines in every other service that
   * writes.** One copy, where the cost of a write is already known (D83).
   */
  async #wrote(id: DocumentId): Promise<void> {
    await this.#durable.wrote(id)
  }



  /**
   * Say that a document was written to, so surfaces holding it can re-read.
   *
   * **Named, not blanket.** A surface asks *is this mine?* and ignores the rest,
   * which keeps a docket from redrawing every time anybody types in the stream.
   */
  #changed(id: DocumentId): void {
    this.#store.changed(id)
  }

  #broadcastReset(id: WindowId): void {
    this.#bus.announce(CHANNEL.windowReset, { id })
  }
}

/**
 * Which directory a section's new files go in.
 *
 * A directory's listing is the directory, so a file made there belongs in it. A
 * curated section is a LIST rather than a place — `sections/` holds the lists
 * themselves, and a note dropped in beside them would read as another section —
 * so its files go where notes go, and the section names one.
 */
function directoryFor(section?: string): string {
  if (section === undefined) return NOTES_DIR
  const cut = section.lastIndexOf('/')
  const dir = cut < 0 ? '' : section.slice(0, cut)
  return dir === '' || dir === SECTIONS_DIR ? NOTES_DIR : dir
}



/**
 * Which document a file belongs to, and what to call it.
 *
 * **A file is not an id.** For a directory document — the notebook, a task list
 * (D59) — the document is the directory and the file is one of its segments, so
 * a caller handed `tasks.todo/2026/09/2026-09-05.md` and told it was a document
 * asks to open a path that is not one. That was the error a link row produced
 * when clicked. A note is its own file and answers the same way, so nothing
 * downstream has to branch.
 */

/**
 * Which file a relative link is written FROM.
 *
 * A day's links resolve from its own file in `notebook.stream/YYYY/MM/`; every
 * other document's resolve from wherever that document is. The same two cases
 * printing has, and the reason `Base` is one type (`ipc.ts`).
 */
function fileOfBase(base: Base, _today?: DateKey): RelPath {
  return base.kind === 'day' ? dayFile(base.date) : (base.id as string as RelPath)
}

/**
 * Every suffix that declares a kind, longest first.
 *
 * **Longest first matters**: `.todo.md` ends with `.md`, so a shorter match
 * would win and take the kind off. One list, and `nameOf` in `shared/slug.ts`
 * is the other half of the same fact — what comes off a name, and what must
 * stay on it.
 */
const KIND_SUFFIXES: readonly string[] = ['.fileset.md', '.docket.md', '.todo.md', '.md']

