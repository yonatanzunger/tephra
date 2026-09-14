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
import { CHANNEL, type Attached, type Base, type DayProse, type DocketRow, type ImageAttachment, type ChangeAck, type DocumentInfo, type EditAck, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowChangedMessage, type WindowId, type WindowSnapshot, type ZoneNotice } from '../../shared/ipc.ts'
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

  readonly #search: Scanner
  readonly #filesets: Filesets
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
    this.#durable = new DurabilityService(this.#store, options)
    // Beside the index rather than in the core: only search uses the Scanner,
    // so it belongs to the search service when that is split out (D83).
    this.#search = new Scanner(notebook, this.#index)
    this.#filesets = new Filesets(this.#corpus)
    this.#day = new DayService(this.#store, this.#durable, this.#bus, this.#fixed, options)
    this.#systemZone = options.systemZone ?? systemZone
    // **The one upward edge left, inverted.** Every poll has to re-offer the
    // zone, which is session UI state and lives above the day service — so it
    // announces and this subscribes (D83). The roll used to be a second such
    // edge; it publishes a `day:` key now, which the reconciler's trigger picks
    // up like any other change.
    this.#day.onChecked(() => this.#tellAboutTheZone())
    this.#registerReconcilers()
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
   * hundred and fifty did, and `todoAdd` was not among them — so a write racing
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
    await this.reconcile().catch(() => undefined)
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

  async versions(limit = 50): Promise<readonly Version[]> {
    return (await this.history?.versions(limit)) ?? []
  }

  /**
   * Every document a person could open, with what it is called (MC6).
   *
   * The stream comes first and is called the notebook: it is the one document
   * that is not a file and the one everybody means by "the notebook".
   *
   * Borrowed for READING and not retained — a chooser is a sweep over the
   * corpus, and a sweep that displaced the document being written in would be
   * the buffer-cache mistake this borrow mode exists to avoid (D54).
   */
  async documents(): Promise<readonly { id: DocumentId; title: string }[]> {
    const out: { id: DocumentId; title: string }[] = [{ id: STREAM_ID, title: 'Notebook' }]
    for (const id of await this.#corpus.list()) {
      if (id === STREAM_ID) continue
      const title = await this.#corpus.use(id, doc => doc.titleOf(ONLY_SEGMENT), {
        mode: 'read',
        retain: false,
      })
      out.push({ id, title: title ?? basename(id as string) })
    }
    return out
  }

  /** The curated sections (D53) — the hand-made half of the sidebar. */
  get sections(): Filesets {
    return this.#filesets
  }

  /** The corpus index (D52) — what the sidebar asks, and what repairs it. */
  get index(): CorpusIndex {
    return this.#index
  }

  /** v1's answer to a query, and not the only possible one (D65, D23). */
  get search(): Search {
    return this.#search
  }

  /** Every written day in a range, as prose — what printing and export read. */
  async proseIn(from: DateKey, to: DateKey): Promise<readonly DayProse[]> {
    return (await this.#stream).proseIn(from, to)
  }

  async readDay(version: VersionId, date: DateKey): Promise<string | null> {
    return (await this.history?.readDay(version, date)) ?? null
  }

  /**
   * Put the stream back the way it was at a version.
   *
   * **Flushed immediately, and a version taken straight away.** A restore that
   * lived only in memory would be undone by a crash, and the one thing someone
   * doing a restore cannot afford is for it not to have happened. Committing it
   * at once also makes the restore itself a point to come back FROM, which is
   * what makes "the way back from a bad restore is another restore" true.
   */
  async restore(version: VersionId): Promise<RestoreReport> {
    const history = this.history
    if (history === null) throw new Error('this notebook has no history to restore from')
    // Through the Corpus, which is what knows which documents are open: a
    // restore that wrote files under one would be undone by its buffer (MC7).
    const report = await this.#serial(() => history.restore(version, this.#corpus))
    this.#durable.unsaved()
    await this.flush()
    await this.#durable.saveVersionNamed(`Restored to ${version.slice(0, 7)}`)
    return report
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
      await this.#filesets.pin({ kind: 'file', path: relativePath(section as RelPath, id as string as RelPath) },
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
    await this.#filesets.retarget(id as string as RelPath, to as string as RelPath)
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
    await this.#corpus.use(made, doc => (doc as TodoDocument).carry(this.today, this.#takenIds))
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
    const today = this.today
    await this.#corpus.use(id, doc => (doc as TodoDocument).carry(today, this.#takenIds))
    this.#touched()
    const keys = await this.#corpus.use(id, doc => doc.keys(), { mode: 'read' })
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
    return this.#corpus.use(id, async doc => [...(await doc.keys())] as DateKey[], { mode: 'read' })
  }

  async todoItems(id: DocumentId, date: DateKey): Promise<readonly TodoItem[]> {
    return this.#corpus.use(id, doc => (doc as TodoDocument).itemsOn(date), { mode: 'read' })
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
    return this.#corpus.use(id, doc => (doc as TodoDocument).chosenOn(date), { mode: 'read' })
  }

  async todoChoose(id: DocumentId, date: DateKey, item: string, chosen: boolean): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as TodoDocument).choose(date, item, chosen)))
    this.#touched()
  }

  async todoAdd(id: DocumentId, text: string): Promise<string> {
    const made = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as TodoDocument).add(text, this.today, this.#takenIds)),
    )
    this.#touched()
    return made
  }

  /** Rewrite what is written under an item. Nothing in a note is parsed. */
  async todoSetNotes(id: DocumentId, item: string, notes: readonly string[]): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as TodoDocument).setNotes(item, notes)))
    this.#touched()
  }

  async todoSetStatus(id: DocumentId, item: string, status: TodoStatus, note?: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as TodoDocument).setStatus(item, status, note)),
    )
    // **Completion flows back to whatever asked for it** (H7a). Finishing the
    // task is the act a person performs; the step it came from has to hear,
    // because that is what unblocks the next one and what a recurrence measures
    // from. Without this the chain only advances if somebody also went to the
    // docket and said so, which is asking them to do it twice.
    if (status === 'done') await this.#finished(item)
    // **And putting one down flows back too**, which finishing had covered and
    // nothing else did. *Nevermind* on a generated task left the step pointing
    // at an item nobody could see any more and never done — so a recurring
    // matter's clock never turned and it went quiet for ever, while the docket
    // still showed it as live work. The reconciler now reads *outstanding* from
    // the list rather than from the step, so all this has to do is ask it to
    // look: the resolution is derived, and what changed is only that the
    // derivation is out of date.
    // **No explicit reconcile here any more.** This line used to read
    // `if (!isLive(status)) await this.reconcile()` — right about the need and
    // wrong about the mechanism: the docket clause reads the task list, so a
    // write to the list is one of its inputs moving and its trigger now says so
    // (D83). `#wrote` below reports the write and waits for what derives from
    // it, which is the same guarantee without a verb having to remember.
    await this.#wrote(id)
  }

  /**
   * Tell the step that made this item that it is done.
   *
   * **Found by scanning, because a handful of dockets is a handful.** An index
   * would be the right answer at a hundred and is a second thing to keep true
   * at five; `CorpusIndex` is where it goes if that day comes.
   */
  async #finished(item: string): Promise<void> {
    for (const docket of await this.#corpus.list('docket')) {
      for (const matter of await this.docketMatters(docket)) {
        const step = matter.steps.find(one => one.made === item)
        if (step?.id === undefined || step.id === null || matter.id === null) continue
        await this.#serial(async () =>
          this.#corpus.use(docket, doc =>
            (doc as DocketDocument).completeStep(matter.id as string, step.id as string, this.#moment)))
        await this.#wrote(docket)
        return
      }
    }
  }

  /**
   * Do one thing to many items (MH4).
   *
   * **One write below, and the same flow-back above.** Whatever a bulk gesture
   * resolves, the dockets have to hear it: a generated task put down in a batch
   * of nine is as resolved as one put down on its own, and a matter that missed
   * it would go quiet exactly as D79 describes. So this finishes the way the
   * single verb does — tell the steps, then reconcile.
   */
  async todoBulk(
    id: DocumentId,
    items: readonly string[],
    action: TodoStatus | 'remove',
  ): Promise<number> {
    const many = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as TodoDocument).bulk(items, action)))
    this.#touched()
    if (action === 'done') for (const item of items) await this.#finished(item)
    // **Removal resolves too, and is the case a status-shaped test would miss**:
    // a deleted item is not live, so anything waiting on it is waiting for ever.
    if (action === 'remove' || !isLive(action)) await this.reconcile()
    return many
  }

  /**
   * Which matter made this item, if any (MH4).
   *
   * **The link is one-directional in the file and traversable both ways here**,
   * which is the split D79 settled: the step records what it made, and the
   * reverse is a question rather than a second stored copy that could drift.
   * By scanning, because a handful of dockets is a handful — `CorpusIndex` is
   * where this goes if that day comes.
   */
  async matterFor(item: string): Promise<{ docket: DocumentId; matter: string } | null> {
    for (const docket of await this.#corpus.list('docket')) {
      for (const one of await this.docketMatters(docket)) {
        if (one.id === null) continue
        if (one.steps.some(step => step.made === item)) return { docket, matter: one.id }
      }
    }
    return null
  }

  async todoRemove(id: DocumentId, item: string): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as TodoDocument).remove(item)))
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
  readonly #takenIds = (): Promise<ReadonlySet<string>> => this.#index.itemIds()

  /**
   * The link directory, dated (R10a, ML3).
   *
   * **The index finds them; this says what day each was seen on.** A day file's
   * day is exact and the index already knows it; everything else is its stamp,
   * turned into a date in the notebook's zone — which the index does not have
   * and should not, because there is one answer about what day it is and it
   * lives here (D62, D63).
   */
  async links(): Promise<readonly LinkRow[]> {
    const zone = this.zone
    return (await this.#index.links()).map(row => ({
      ...row,
      appearances: row.appearances.map(at => ({
        ...at,
        on: at.at.date ?? dateKeyAt(new Date(at.when), zone),
        ...whereWritten(at.at.file as RelPath),
      })),
    }))
  }

  /**
   * What was finished under each tag before today (T8's tail, MT6).
   *
   * **`today` is the service's**, because there is one answer about what day it
   * is and it lives here (D62). The index knows which day a file is; it does
   * not know which day it is now, and should not.
   */
  async todoResolved(): Promise<Record<string, readonly ResolvedItem[]>> {
    const byTag = await this.#index.resolvedByTag(this.today, RESOLVED_DAYS)
    return Object.fromEntries(byTag)
  }

  /** Everything put down and not picked up again (T14). */
  async todoBacklog(): Promise<readonly ResolvedItem[]> {
    return this.#index.backlog()
  }

  /** Every tag that has ever been on a task (T6). The full set; live is today's. */
  async todoTags(): Promise<readonly string[]> {
    return this.#index.todoTags()
  }

  /** What the walk knows about a day (T11). A read: it decides nothing. */
  async todoWalk(id: DocumentId, date: DateKey): Promise<WalkState> {
    return this.#corpus.use(id, doc => (doc as TodoDocument).walkOf(date), { mode: 'read' })
  }

  /** End a pass. Serialised with every other write, for the reason D37 gives. */
  async todoFinishWalk(id: DocumentId, date: DateKey, drop: readonly string[]): Promise<number> {
    const dropped = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as TodoDocument).finishWalk(date, drop)),
    )
    this.#touched()
    return dropped
  }

  async todoEdit(id: DocumentId, item: string, text: string): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as TodoDocument).edit(item, text)))
    this.#touched()
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

  // ── comments (D47) ─────────────────────────────────────────
  //
  // Serial like every mutation, and flushed on the ordinary schedule. Reading
  // is not serialised: a thread list is derived from bodies already in memory.

  async comments(): Promise<readonly CommentThread[]> {
    return (await this.#stream).comments()
  }

  async startComment(span: Span, body: string): Promise<CommentId> {
    const id = await this.#serial(async () => (await this.#stream).startComment(span, body))
    this.#touched()
    return id
  }

  async addComment(id: CommentId, body: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).addComment(id, body))
    this.#touched()
  }

  async editComment(id: CommentId, index: number, body: string): Promise<void> {
    await this.#serial(async () => (await this.#stream).editComment(id, index, body))
    this.#touched()
  }

  async deleteComment(id: CommentId, index: number): Promise<void> {
    await this.#serial(async () => (await this.#stream).deleteComment(id, index))
    this.#touched()
  }

  async setCommentResolved(id: CommentId, resolved: boolean): Promise<void> {
    await this.#serial(async () => (await this.#stream).setCommentResolved(id, resolved))
    this.#touched()
  }

  async setCommentAssignee(id: CommentId, to: string | null): Promise<void> {
    await this.#serial(async () => (await this.#stream).setCommentAssignee(id, to))
    this.#touched()
  }

  async reactToComment(id: CommentId, index: number, emoji: string, on: boolean): Promise<void> {
    await this.#serial(async () => (await this.#stream).reactToComment(id, index, emoji, on))
    this.#touched()
  }

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

  // ── dockets (MH1, D68) ─────────────────────────────────────

  /**
   * Every docket, by title.
   *
   * **Derived from the directory, not from a list somebody maintains** — the
   * same rule the sidebar's directory sections follow: a docket is there because
   * its file is there, which cannot be wrong.
   */
  async dockets(): Promise<readonly DocketRow[]> {
    const ids = await this.#corpus.list('docket')
    const rows = await Promise.all(ids.map(async id => ({
      id,
      // **What it is CALLED, falling back to what it is named.** The frontmatter
      // title is the person's words; the filename is a slug of them and the only
      // other name a document has (D59's rule, as `info()` applies it).
      title: (await this.#corpus.use(id, doc => doc.titleOf(ONLY_SEGMENT))) ?? nameOf(id as string),
    })))
    return rows.sort((a, b) => a.title.localeCompare(b.title))
  }

  async docketMatters(id: DocumentId): Promise<readonly Matter[]> {
    return this.#corpus.use(id, doc => (doc as DocketDocument).matters())
  }

  /**
   * Put a matter on a docket.
   *
   * **`when` arrives as text, and is parsed here.** The notation is the one a
   * person types into the field — `2026-11-12`, `every 90d`, nothing at all —
   * and the renderer has no business owning a second copy of it (T16's rule,
   * applied to a second grammar).
   */
  async docketAdd(
    id: DocumentId,
    name: string,
    shape?: NewMatter,
    section?: string,
  ): Promise<string> {
    const when = scheduleFor(shape)
    const made = await this.#serial(async () =>
      this.#corpus.use(id, doc =>
        (doc as DocketDocument).add(name, when, this.#takenMatterIds, section, shape?.mode)),
    )
    // **The template's first step, made here rather than by the caller.** The
    // shape and the step it implies are one decision — *something happening*
    // means a reminder on the day, *something to get done* means a task when
    // work starts — so they are one call, and a matter cannot come into being
    // half-shaped.
    const mode = MODES.find(one => one.key === shape?.mode)
    if (mode !== undefined) {
      const first = await this.#serial(async () =>
        this.#corpus.use(id, doc =>
          (doc as DocketDocument).addStep(made, '+0d', name, mode.kind)))
      // A recurring task measures from a step being done, and on a matter one
      // step old there is only one it could be.
      if (mode.fromCompletion && shape?.every !== undefined) {
        await this.#serial(async () =>
          this.#corpus.use(id, doc => (doc as DocketDocument).setAfter(made, first)))
      }
    }
    await this.#wrote(id)
    return made
  }

  /** Change what kind of thing a matter is — the four a person chooses between. */
  async docketSetMode(id: DocumentId, matter: string, mode: Mode): Promise<void> {
    if (!MODES.some(one => one.key === mode)) {
      throw new Error(`${mode} is not one of the four kinds of matter`)
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setMode(matter, mode)))
    await this.#wrote(id)
  }

  /** The date of the next instance, or none — which is the whole of *inactive*. */
  async docketSetStart(id: DocumentId, matter: string, start: string | null): Promise<void> {
    const said = start === null || start.trim() === '' ? null : asDateKey(start.trim())
    if (start !== null && start.trim() !== '' && said === null) {
      throw new Error(`${start} is not a date`)
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setStart(matter, said)))
    await this.#wrote(id)
  }

  /** How often it comes round. `every` as typed: `90d`, `1m on 31`, or nothing. */
  async docketSetEvery(id: DocumentId, matter: string, every: string | null): Promise<void> {
    const said = every === null || every.trim() === '' ? null : parseInterval(every)
    if (every !== null && every.trim() !== '' && said === null) {
      throw new Error(`${every} is not an interval like 90d, 6 months, or 1m on 31`)
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setEvery(matter, said)))
    await this.#wrote(id)
  }

  /** Which step's completion starts the next instance, or none (D76, Qa). */
  async docketSetAfter(id: DocumentId, matter: string, after: string | null): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setAfter(matter, after)))
    await this.#wrote(id)
  }

  /** Move a recurring matter on to its next instance. */
  async docketAdvance(id: DocumentId, matter: string): Promise<DateKey | null> {
    const next = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).advanceInstance(matter)))
    if (next !== null) this.#touched()
    return next
  }

  async docketRename(id: DocumentId, matter: string, name: string): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).rename(matter, name)))
    await this.#wrote(id)
  }



  async docketSetOwner(id: DocumentId, matter: string, owner: string | null): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).setOwner(matter, owner)))
    await this.#wrote(id)
  }

  async docketSetLink(id: DocumentId, matter: string, link: string | null): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).setLink(matter, link)))
    await this.#wrote(id)
  }

  async docketTag(id: DocumentId, matter: string, subject: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).tagMatter(matter, subject)))
    await this.#wrote(id)
  }

  async docketUntag(id: DocumentId, matter: string, subject: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).untagMatter(matter, subject)))
    await this.#wrote(id)
  }

  /** The prose under a matter. Nothing in it is parsed (D56's rule, carried). */
  async docketSetNotes(id: DocumentId, matter: string, notes: readonly string[]): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setNotes(matter, notes)))
    await this.#wrote(id)
  }

  // ── sections on a docket (MH1) ──────────────────────────────

  /** The docket divided into its sections, which is how it is read. */
  async docketSections(id: DocumentId): Promise<readonly Section[]> {
    return this.#corpus.use(id, doc => (doc as DocketDocument).sections())
  }

  async docketAddSection(id: DocumentId, name: string): Promise<string> {
    const made = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).addSection(name)))
    await this.#wrote(id)
    return made
  }

  async docketRenameSection(id: DocumentId, name: string, to: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).renameSection(name, to)))
    await this.#wrote(id)
  }

  /** Take the heading away and keep everything that was under it. */
  async docketRemoveSection(id: DocumentId, name: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).removeSection(name)))
    await this.#wrote(id)
  }

  /**
   * A whole section one place up or down among the others. False at the ends.
   *
   * **Nothing derived depends on the order of sections**, which is why this
   * touches without reconciling: the reading changes and the generated tasks do
   * not. Same as `docketNudgeMatter`, for the same reason.
   */
  async docketNudgeSection(id: DocumentId, name: string, delta: number): Promise<boolean> {
    const moved = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).nudgeSection(name, delta)))
    if (moved) this.#touched()
    return moved
  }

  /**
   * Move a matter to another docket (MH5).
   *
   * **Written whole and then removed**, which is the same shape the move from
   * the task list has: the thing exists in the new place before it stops
   * existing in the old one, so a failure between the two leaves a duplicate
   * rather than a hole. A duplicate is visible and correctable; a hole is not.
   *
   * **A new id in the new docket**, because a matter's id is unique across the
   * corpus and the old block is going away — what travels is the matter, not its
   * name in a file. What it was moved from travels too, so the trail survives.
   */
  async docketMoveTo(from: DocumentId, matter: string, to: DocumentId): Promise<string | null> {
    if (from === to) return matter
    const found = (await this.docketMatters(from)).find(one => one.id === matter)
    if (found === undefined) return null

    const made = await this.docketAdd(to, found.name, { mode: found.mode })
    for (const tag of found.tags) await this.docketTag(to, made, tag)
    if (found.owner !== null) await this.docketSetOwner(to, made, found.owner)
    if (found.link !== null) await this.docketSetLink(to, made, found.link)
    if (found.notes.length > 0) await this.docketSetNotes(to, made, found.notes)
    // **By index, not by id**, since every step is being made afresh: an `after`
    // pointing at the old docket's id would point at nothing. `spellStepWhen`
    // already renders the index when given one, and `addStep` reads it back.
    const place = (id: string): number | null => {
      const at = found.steps.findIndex(one => one.id === id)
      return at < 0 ? null : at + 1
    }
    for (const step of found.steps.slice(1)) {
      await this.docketAddStep(to, made, spellStepWhen(step.when, place), step.text, step.kind)
    }
    if (found.when.start !== null) await this.docketSetStart(to, made, found.when.start)
    if (found.when.every !== null) await this.docketSetEvery(to, made, spellInterval(found.when.every))
    if (found.when.dates !== null) await this.docketSetDates(to, made, found.when.dates)
    if (found.from !== null) {
      await this.#serial(async () =>
        this.#corpus.use(to, doc => (doc as DocketDocument).cameFrom(made, found.from as string)))
    }

    await this.docketRemove(from, matter)
    await this.#wrote(to)
    return made
  }

  /** Into a section — `''` is the undivided run — optionally above one matter. */
  async docketMoveMatter(
    id: DocumentId,
    matter: string,
    section: string,
    before?: string,
  ): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).moveMatter(matter, section, before)))
    await this.#wrote(id)
  }

  /** One place up or down inside its own section. False at the ends. */
  async docketNudgeMatter(id: DocumentId, matter: string, delta: number): Promise<boolean> {
    const moved = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).nudgeMatter(matter, delta)))
    if (moved) this.#touched()
    return moved
  }

  /**
   * A step on a matter: *at this moment, this happens* (H4, D76).
   *
   * **The schedule arrives as text and is parsed here**, the same rule the
   * `when` field follows: the notation is what a person types — `2w`, `+3d`,
   * `right away`, `after <step>` — and the renderer has no business owning a
   * second copy of it (T16's rule, applied to a third grammar).
   */
  async docketAddStep(
    id: DocumentId,
    matter: string,
    when: string,
    text: string,
    kind?: StepKind,
  ): Promise<string> {
    const made = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).addStep(matter, when, text, kind)))
    await this.#wrote(id)
    return made
  }

  /** Fix what a step says, keeping its id and its completion stamp. */
  async docketEditStep(
    id: DocumentId,
    matter: string,
    step: string,
    text: string,
  ): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).editStep(matter, step, text)))
    await this.#wrote(id)
  }

  /** Reschedule one step. `when` as typed, parsed here. */
  async docketSetStepWhen(
    id: DocumentId,
    matter: string,
    step: string,
    when: string,
  ): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setStepWhen(matter, step, when)))
    await this.#wrote(id)
  }

  /** Change a step's kind — the only way to author a `reschedule` (D76). */
  async docketSetStepKind(
    id: DocumentId,
    matter: string,
    step: string,
    kind: StepKind,
  ): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setStepKind(matter, step, kind)))
    await this.#wrote(id)
  }

  async docketRemoveStep(id: DocumentId, matter: string, step: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).removeStep(matter, step)))
    await this.#wrote(id)
  }

  /** Stamp a step done, or undo that. What a dependency reads (D76). */
  async docketCompleteStep(
    id: DocumentId,
    matter: string,
    step: string,
    done: boolean,
  ): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc =>
        (doc as DocketDocument).completeStep(matter, step, done ? this.#moment : null)))
    await this.#wrote(id)
  }

  /**
   * Start work on a matter — the start date that makes its first step due today.
   *
   * **Today comes from the service, not the document**, because the clock is the
   * service's (D62/D63) and a document that read one would be a second source of
   * truth about what day it is.
   */
  async docketActivate(id: DocumentId, matter: string): Promise<DateKey> {
    const when = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).activate(matter, this.today)))
    await this.#wrote(id)
    return when
  }

  /** The instances, listed outright — an alternative to the interval (H7). */
  async docketSetDates(id: DocumentId, matter: string, dates: readonly DateKey[]): Promise<void> {
    const today = this.today
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setDates(matter, dates, today)))
    await this.#wrote(id)
  }

  /**
   * Put a task down: mark it transferred, and give it a home (MH5, T14).
   *
   * **One keystroke and zero decisions**, which is the rule this whole design is
   * named against breaking. *"Which container does this go in?"* is precisely the
   * friction that sank the system before this one, so it goes to the backlog
   * docket unless the caller already knows better. The review is
   * where filing happens, because that is the moment routing is cheap: the
   * backlog is regathered **from**, never routed **into**.
   *
   * **The item stays and says what happened to it.** `[>]` means *transferred to
   * a docket* — resolved rather than waiting — and the line keeps its id, so its
   * history stays continuous and `tephra:todo/<id>` still resolves. Nothing is
   * deleted and no day file is rewritten, which is what makes this a move rather
   * than a migration.
   *
   * **A task a docket already made is not given a second home.** It has a matter
   * — putting it down is that matter's business (D79), and a misc entry beside it
   * would be the same commitment in two places, which is the failure the
   * horizon's two sources are kept disjoint to avoid.
   */
  async todoPutDown(list: DocumentId, item: string, docket?: DocumentId): Promise<string | null> {
    await this.#day.ready()
    const found = (await this.todoItems(list, this.today)).find(one => one.id === item)
    // **Already put down is already housed.** The provenance check below only
    // catches a task a docket MADE; one that was put down has a matter nothing
    // points at, so asking twice would make a second copy of it — which is the
    // sort of thing a repeated keystroke does by accident.
    if (found === undefined || found.status === 'backlog') return null
    const already = await this.matterFor(item)
    if (already !== null) {
      await this.todoSetStatus(list, item, 'backlog')
      return null
    }
    const where = docket ?? BACKLOG_DOCKET
    // **Named on first use**, so the sidebar has something to call it other than
    // a slug. A docket nobody named is one nobody recognises tomorrow (MH1's
    // first reported fault, in a different place).
    if (where === BACKLOG_DOCKET) {
      await this.#serial(async () => this.#corpus.use(where, async doc => {
        if ((await doc.titleOf(ONLY_SEGMENT)) === null) await doc.setTitleOf(ONLY_SEGMENT, 'Backlog')
      }))
    }
    // **Its subjects and its owner come with it**, being facts about the thing
    // rather than about the list it was on; the due date does not, because a
    // deadline you have just declined is not one.
    const made = await this.docketAdd(where, withoutMarks(found), { mode: 'task' })
    await this.#serial(async () =>
      this.#corpus.use(where, doc => (doc as DocketDocument).cameFrom(made, item)))
    for (const tag of found.tags) await this.docketTag(where, made, tag)
    if (found.owner !== null) await this.docketSetOwner(where, made, found.owner)
    // **And the line is handed over**, last, so it names a docket that exists.
    // One direction, one instant: from here the matter is the docket's, the line
    // is a record of what happened, and nothing on the task list can act on it.
    const title = (await this.#corpus.use(where, doc => doc.titleOf(ONLY_SEGMENT)))
      ?? nameOf(where as string)
    await this.#serial(async () =>
      this.#corpus.use(list, doc => (doc as TodoDocument).handOver(item, title)))
    this.#touched()
    await this.#wrote(where)
    return made
  }

  /** Stop work on it, keeping what it has already done (D76). */
  async docketSuspend(id: DocumentId, matter: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).suspend(matter)))
    await this.#wrote(id)
    // **And then reconcile, rather than withdrawing by hand.** Suspending is
    // only *clear the start date*; what follows from that — the task it put on
    // the list no longer being wanted — is something the tick already knows how
    // to work out. This is the reconciler paying for itself: one rule about
    // what should be true, instead of a bespoke undo beside every verb that
    // could make it false.
    await this.reconcile()
  }

  async docketRemove(id: DocumentId, matter: string): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).remove(matter)))
    await this.#wrote(id)
  }

  /**
   * The move: off one docket and onto another, keeping the id (D71).
   *
   * **Both halves in one serialised turn**, because a matter that is out of the
   * first and not yet in the second exists nowhere, and a crash in the gap loses
   * it. The id surviving is the whole promise — history stays continuous and a
   * reference still resolves.
   */
  async docketMove(id: DocumentId, matter: string, to: DocumentId): Promise<void> {
    await this.#serial(async () => {
      const taken = await this.#corpus.use(id, doc => (doc as DocketDocument).remove(matter))
      await this.#corpus.use(to, doc => (doc as DocketDocument).adopt(taken))
    })
    await this.#wrote(id)
  }

  /**
   * Matter ids taken anywhere in the corpus.
   *
   * **Every docket, because an id names a matter and not a docket** — the same
   * reason `#takenIds` reads every task list. Scanned rather than indexed: a few
   * hundred matters over a lifetime is not a thing to build an index for
   * (`solution/horizon.md`), and the index would be the second copy of a truth
   * the files already hold.
   */
  readonly #takenMatterIds = async (): Promise<ReadonlySet<string>> => {
    const out = new Set<string>()
    for (const id of await this.#corpus.list('docket')) {
      for (const matter of await this.docketMatters(id)) {
        if (matter.id !== null) out.add(matter.id)
      }
    }
    return out
  }

  // ── reconciliation: the clock tick (MH3a, MH3b, D76) ───────

  /**
   * Bring everything derived back into agreement with what it derives from.
   *
   * **A reconciliation, not a sequence of events** — and that distinction is the
   * whole design. An event-shaped pass has to fire at the right moment and
   * exactly once: it asks *what just happened* and patches accordingly, so a
   * missed midnight, a crash between two writes, a laptop shut for a fortnight
   * or two ticks racing each other all leave the derived state wrong in a way
   * nothing afterwards notices. This asks a different question — *what should be
   * true?* — and makes it so.
   *
   * **Named for the whole job, not for the dockets**, which are only the first
   * thing it has to do. Tephra keeps a widening collection of state that is a
   * function of other state — tasks a docket implies, the horizon MH2 will
   * derive from dates ahead, indices, anything cached from a file somebody can
   * edit behind our back — and every one of them has the same failure mode and
   * therefore wants the same answer: not a notification that fires when the
   * source changes, but a pass that can be run at any time and leaves the
   * derived side correct. So this is the place they go. A new derived thing adds
   * a clause here rather than a private sweep of its own, and everything that
   * already calls this — startup, the day boundary, a verb that invalidates
   * something — keeps it up to date without knowing it exists.
   *
   * **Which buys idempotence by construction rather than by bookkeeping.**
   * Running it twice, or thirty times, or after a month away, converges on the
   * same answer, so nothing needs a record of when it last ran — and *that* is
   * the field whose absence made the old design safe against a machine that was
   * asleep at midnight.
   *
   * Two things are reconciled so far, in this order because the first changes
   * what the second should conclude:
   *
   * 1. **Instances.** A matter that recurs moves on when its instance is
   *    settled — for a recurring task, when the step its clock reads is done;
   *    for a recurring event, when its date has passed and nothing is left
   *    owing. A matter with something still owed **does not move on** (H7a):
   *    outstanding is shown as overdue, never quietly reissued.
   * 2. **Items.** Every task step that is due and unfinished should have one on
   *    the list; every step that is not should not. Both directions, because a
   *    reconciler that only adds is an event handler wearing a hat.
   *
   * The return value names what actually changed, which is for logging and for
   * tests; a caller that acts on it is treating this as an event again.
   */
  async reconcile(): Promise<void> {
    // **The explicit door — and it goes through the same one as everything
    // else.** Startup and the day boundary are D77's other two triggers and
    // neither is a data change, so each reports a synthetic key instead of
    // reaching past the machinery. One path in, and a divergence report whose
    // first round reads `asked:` says the run began because somebody asked.
    //
    // The ORDINARY trigger is not this method at all: it is a write, reported by
    // the corpus and routed to whichever functions care (D83).
    //
    // **Returns nothing, and used to return what it had made and withdrawn.**
    // That existed for one `console.log` at startup and for tests to use as a
    // handle on the item just generated — and keeping it meant bolting a side
    // channel onto a mechanism built precisely so that a pass reports nothing
    // and its writes are observed instead. What the run did is now said by the
    // runner, which has the rounds and their keys already (`onRun`); what the
    // run *achieved* is read from the world, which is the better assertion
    // anyway, since it fails for a pass that reports honestly and writes
    // nothing.
    await this.#fixed.changed(ASKED_KEY)
  }

  /**
   * The most rounds any one key has needed, across every pass this session.
   *
   * **Exposed so the divergence threshold can be argued about from evidence.** A
   * limit chosen against no data is the position the task list's soft cap has
   * been stuck in since MT5c; this is what real flows actually reach.
   */
  get reconciliationHighWater(): number {
    return this.#fixed.highWater
  }

  /**
   * Told what each reconciliation run did — for the log, and for a run that
   * would not settle.
   *
   * **This replaced `reconcile()`'s return value.** That said what one forced
   * run had made and withdrawn; this says what *every* run did, including the
   * implicit ones, which is both more and better information — and it costs the
   * clause nothing, because the runner already holds the rounds and their keys.
   */
  onReconciled(told: (report: RunReport) => void): Unsubscribe {
    return this.#fixed.onRun(told)
  }

  #registerReconcilers(): void {
    this.#fixed.register({
      name: 'dockets',
      /**
       * **Everything this clause reads**, which is more than the dockets.
       *
       * A docket write, obviously. But the pass also reads the task list — to
       * know which generated items are still *outstanding*, which is what
       * decides whether an instance is settled and may advance. So resolving a
       * task changes an input, and a task finished is what unblocks the step
       * that follows it.
       *
       * **Routed rather than remembered.** `todoSetStatus` used to end with
       * `if (!isLive(status)) await this.reconcile()` — correct, and an
       * invariant kept by memory at one door out of many, which is the shape
       * note 61 records decaying. The trigger says it once instead.
       *
       * **And the day**, which is an input as much as either document: what is
       * due depends on what day it is, so a roll wakes this the same way a write
       * does. `asked:` covers startup and an explicit request — the triggers
       * that are not changes to anything (`change-keys.ts` has the format).
       */
      trigger: '^(docket|todo|day|asked):',
      pass: () => this.#reconcileDockets(),
    })
  }

  /**
   * What the dockets imply, made true: instances advanced, items in step.
   *
   * **Returns nothing, which is what a fixed-point function is** (D83): its
   * writes are observed by the corpus and reported as keys, so a pass that also
   * described its own changes would be saying the same thing twice — and the
   * second saying is the one somebody eventually forgets to keep true.
   */
  async #reconcileDockets(): Promise<void> {
    await this.#day.ready()
    const today = this.today
    const list = await this.todoList()

    /**
     * Which of the items dockets made are still being asked of somebody.
     *
     * **Outstanding is a computed fact, not a stored one**, and that is what
     * keeps *nevermind* from wedging a matter for ever. A step that made an item
     * somebody then dropped is not owed — it is resolved, just not by being
     * done — and the alternative was a fourth field in the step marker recording
     * the same thing the task list already knows. D77's rule applied one level
     * down: do not persist what can be derived from the source of truth.
     *
     * An id absent from the live set is resolved however it was resolved:
     * finished, dropped, backlogged, or deleted outright. All four mean *stop
     * waiting*, and none of them means *ask again*.
     */
    const live = new Set(
      (await this.todoItems(list, today))
        .filter(one => isLive(one.status))
        .flatMap(one => (one.id === null ? [] : [one.id])),
    )
    for (const docket of await this.#corpus.list('docket')) {
      let touched = false
      // **What the docket is CALLED**, for the tag every task it generates
      // carries. The same rule `dockets()` uses: the person's words, falling
      // back to the slug of them, which is the only other name a document has.
      const domain = (await this.#corpus.use(docket, doc => doc.titleOf(ONLY_SEGMENT)))
        ?? nameOf(docket as string)
      // Re-read after each matter: advancing one rewrites the block, and what
      // this loop holds would be the version from before that.
      for (const id of (await this.docketMatters(docket)).flatMap(m => (m.id === null ? [] : [m.id]))) {
        if (await this.#advanceDocket(docket, id, today, live)) touched = true
        const matter = (await this.docketMatters(docket)).find(one => one.id === id)
        if (matter === undefined) continue
        for (const step of matter.steps) {
          if (step.id === null || step.kind !== 'task') continue
          const due = dueOn(step, matter, addDays, this.zone)
          const wanted = step.done === null && due !== null && compareDateKeys(due, today) <= 0
          if (wanted && step.made === null) {
            // **Composed once, rather than added and then tagged.** Two writes
            // would be two undo steps for one act, which is the rule `bulk` and
            // `finishWalk` already keep.
            // **And a due date, because the schedule already knows one.** A
            // generated task arrived with no deadline, so it sorted with the
            // undated and said nothing about the rhythm it belongs to — an air
            // filter due every 120 days is not the same as a note to self. The
            // date is the step's own: the day the schedule says it should
            // happen, which for a run-up step is its own day and not the
            // occasion's. Being overdue afterwards is correct and is what H7a
            // asks for — outstanding is shown, never quietly reissued.
            // **The DOCKET is always a tag; the matter only when it adds
            // something.** The docket is the durable grouping — the house, work,
            // games — so tagging with it is the conceptual link back to where the
            // task came from, and it is the tag somebody would actually pivot on.
            //
            // The matter is dropped when its name IS the step's text, which is
            // the common single-step case (D76 seeds exactly that): *Change the
            // water filter #'Change the water filter'* says one thing twice, and
            // a chip repeating the sentence beside it reads as a fault.
            // **Whoever has the matter has the work it makes.** The owner is a
            // fact about the task and travels as a marker rather than as words in
            // its title, for the reason the matter's name became a tag: text in
            // the sentence cannot be filtered on or taken off for a summary.
            const marks = [
              matter.name.trim() === step.text.trim() ? null : spellTag(matter.name),
              spellTag(domain),
              matter.owner === null ? null : spellOwner(matter.owner),
            ]
            const item = await this.todoAdd(list, [step.text, ...marks, `DUE ${due}`]
              .filter(one => one !== null && one !== '')
              .join(' '))
            // **The matter is a TAG, not a prefix.** On the list a step's text
            // stands alone — *find a general mechanic* says nothing about which
            // car — and the first cut solved that by writing the matter's name
            // into the title. That was the wrong shape: *which matter this
            // belongs to* is exactly what a tag says, and as a tag it is drawn
            // as a chip, it groups the by-tag view by matter, and it can be
            // taken off without editing the sentence. A prefix is a tag with no
            // machinery and no way out of it.
            //
            // The seeded first step is tagged too, even though its text IS the
            // matter's name (D76): a chip beside it is redundant to read and
            // still correct to group by, which is the opposite trade from the
            // prefix, where the redundancy was in the sentence itself.

            await this.#setStepMade(docket, id, step.id, item)
            touched = true
          } else if (!wanted && step.made !== null && step.done === null && live.has(step.made)) {
            // **Only what it made, and only while it is still being asked.**
            // Three exemptions, and they are all the same exemption: a task
            // somebody typed is nobody else's business, one already finished is
            // a true statement about the past, and one they *dropped* is as much
            // their decision as one they ticked. Taking any of them back would
            // be overruling somebody — which is what the finished-item rule was
            // always really about, stated too narrowly.
            await this.todoRemove(list, step.made)
            await this.#setStepMade(docket, id, step.id, null)
            touched = true
          }
        }
      }
      if (touched) await this.#wrote(docket)
    }
  }

  /**
   * Move a matter on while its instance is settled and behind.
   *
   * **Named for the docket, unlike `reconcile`**, because this one genuinely is
   * docket logic and nothing else will ever want it: what *settled* means, and
   * what the next instance is counted from, are facts about the four modes of
   * D76. The generic thing above is the pass; the specific thing is each clause
   * in it, and the names should say which is which.
   *
   *
   * **A loop, because a year away is a year of instances.** Each turn advances
   * one and the next asks again, so coming back after a long absence converges
   * on the current instance and generates that one — a month away yielding one
   * air-filter task rather than thirty. Bounded, because an interval this
   * cannot make progress on would otherwise spin.
   */
  async #advanceDocket(
    docket: DocumentId,
    id: string,
    today: DateKey,
    live: ReadonlySet<string>,
  ): Promise<boolean> {
    let moved = false
    for (let guard = 0; guard < 500; guard += 1) {
      const matter = (await this.docketMatters(docket)).find(one => one.id === id)
      // **A recurrence is an interval OR a list**, and this asked only about the
      // interval — so a listed matter never moved on at all, which is the one
      // thing a list is for.
      const recurs = matter !== undefined && (matter.when.every !== null || matter.when.dates !== null)
      if (matter === undefined || !recurs || matter.when.start === null) break
      // **Settled, and what the next one is measured from, are the same
      // question asked of the two repeating shapes** — so they are answered
      // together rather than in two places that could come to differ.
      const clock = matter.steps.find(one => one.id === matter.when.after)
      const [settled, from] = matter.when.after === null
        // A recurring EVENT is on the calendar: it moves on once its date is
        // behind us and nothing it asked for is still owed, counting from the
        // instance that has just passed so the anchored day survives.
        // Owed means *this instance put something on the list and it is still
        // being asked of somebody* — not merely that a step is undone. A step
        // that never came due (the app was shut for the whole of 2020) was never
        // asked for, so it cannot be outstanding; and one whose item was
        // dropped is resolved, just not by being done. Treating either as owed
        // wedges the matter — on an instance nobody was told about in the first
        // case, and for ever in the second.
        ? [compareDateKeys(matter.when.start, today) < 0
            && matter.steps.every(one => one.made === null || !live.has(one.made)),
          matter.when.start]
        // A recurring TASK reads one step, and that step being over is the
        // instance being over — whatever the calendar says. **Over two ways, and
        // they count from different days.** Done: from the day it was done,
        // which for a matter years overdue is the difference between *next
        // spring* and *overdue again immediately*. Dropped: from the day it was
        // **scheduled**, because *this one did not happen* says nothing about
        // when the next one is owed — an air filter you skipped in March is due
        // in June, not three months after you gave up on it.
        : clock?.done != null
          ? [true, dateKeyAt(new Date(clock.done * 1000), this.zone)]
          : [clock?.made != null && !live.has(clock.made), matter.when.start]
      if (!settled || from === null) break
      await this.#serial(async () =>
        this.#corpus.use(docket, doc => (doc as DocketDocument).advanceInstance(id, from)))
      moved = true
    }
    return moved
  }

  /** Same rule as `#advanceDocket`: *step* and *made* are the docket's words. */
  async #setStepMade(
    docket: DocumentId,
    matter: string,
    step: string,
    item: string | null,
  ): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(docket, doc => (doc as DocketDocument).setMade(matter, step, item)))
  }

  // ── the horizon (MH2, H8, D74) ─────────────────────────────

  /**
   * Everything bearing down between two days, in date order.
   *
   * **One computation, read by both surfaces.** The full view and the compact
   * strip differ only in the window they ask for, and a second copy of *what
   * counts as coming up* living in the renderer is the failure T16 is named
   * against — the more so here, where the docket half needs `dueOn`, interval
   * arithmetic and the anchor rule, none of which belong in a view.
   *
   * **Computed, never stored**, which is why it needs no clause in `reconcile`
   * (D77): there is no derived copy to fall out of step. It is the one kind of
   * derived state that shape does not apply to, and saying so is worth a line —
   * the temptation with a reconciler in hand is to persist everything.
   *
   * **Both sources, from the start.** Six times over, `notes.md` records the
   * failure of building a view against one source and fitting the second in
   * afterwards; the horizon spans dockets and the task list, so it is built
   * against both or it is built wrong.
   */
  async horizon(from: DateKey, to: DateKey): Promise<readonly HorizonRow[]> {
    await this.#day.ready()
    const window: HorizonWindow = { from, to }
    const rows: HorizonRow[] = []

    // **Dockets: what is coming.** A step already on the list is the other
    // source's business, which `horizonOf` is what enforces.
    for (const docket of await this.#corpus.list('docket')) {
      for (const matter of await this.docketMatters(docket)) {
        for (const step of matterHorizon(matter, window, addDays, this.zone)) {
          rows.push({
            on: step.on,
            // **The same treatment, by the rung that fits**: a step is free
            // prose with no spans to consult, so it composes the two rungs
            // `plain.ts` describes rather than using the item version.
            text: flattenLinks(plainLine(step.text)),
            doc: docket,
            kind: step.kind,
            // And the name gets it too, or a matter called after a link would
            // be compared against a flattened row text and never match.
            matter: flattenLinks(plainLine(matter.name)),
            instance: step.instance,
            item: null,
            id: matter.id,
          })
        }
      }
    }

    // **The task list: what is already here and dated.** Read from today's
    // items, which is the live set — an undone item carries forward, so a
    // deadline that has gone by is still in front of somebody, and that is
    // precisely the row H8 asks the horizon to keep showing.
    const list = await this.todoList()
    for (const item of await this.todoItems(list, this.today)) {
      if (item.due === null || !isLive(item.status)) continue
      if (!inHorizon(item.due, window)) continue
      rows.push({
        on: item.due,
        // **The short version** (`shortLine`): no tags, no due date, no link
        // markup. The row has already put the date in its own column, so
        // `DUE 2026-09-15` under a heading that says *15 Sep* is the same fact
        // twice in two notations — and a raw markdown link is a URL sprawling
        // across three lines of a strip that is supposed to be glanced at.
        text: shortLine(item),
        doc: list,
        kind: 'due',
        matter: null,
        instance: null,
        item: item.id,
        id: null,
      })
    }

    // The order is the horizon's own rule, not this method's (`horizon-api.ts`).
    return orderHorizon(rows)
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
  async #wrote(id: DocumentId): Promise<void> {
    this.#touched()
    this.#changed(id)
    // **Awaited, so the verb's promise means what it says.** Fired and
    // forgotten, `docketActivate` resolved before the task existed — which is
    // the bug this was written to fix, merely made harder to see: the list was
    // empty for however long the pass took. A verb that has returned has
    // finished, derived state included.
    //
    // **The corpus already reported this write**, unforgettably, and that report
    // had nobody to hand a promise to. This is the same key again, and asking
    // twice costs nothing — a key repeated inside one round is one key. What it
    // buys is the waiting.
    //
    // **The reconciler's own writes need no exemption here**, which is the whole
    // gain: the runner knows whether a call is descended from a pass, so a
    // pass's writes are recorded for the next round instead of asking the pass
    // to wait for itself (D83). The flag this method used to keep is gone.
    await this.#fixed.changed(documentKey(id))
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
 * What *Add a matter* asked for, as the three variables.
 *
 * **The mode is spent here and never stored** (D76, amended). It decides the
 * shape of the schedule and the kind of the first step, and after that a matter
 * is described entirely by `start`, `every` and `after` — so a job that later
 * gets a date does not have to be relabelled as an event, because there is no
 * label. A dated shape with no date given is simply not started yet, which is a
 * state the model already had.
 */
function scheduleFor(shape: NewMatter | undefined): Schedule {
  if (shape === undefined) return UNSCHEDULED
  const mode = MODES.find(one => one.key === shape.mode)
  if (mode === undefined) throw new Error(`${shape.mode} is not one of the four kinds of matter`)
  const given = (said: string | undefined): string | null =>
    said === undefined || said.trim() === '' ? null : said.trim()
  const start = given(shape.start) === null ? null : asDateKey(given(shape.start) as string)
  if (given(shape.start) !== null && start === null) {
    throw new Error(`${shape.start} is not a date`)
  }
  const every = given(shape.every) === null ? null : parseInterval(given(shape.every) as string)
  if (mode.repeating && given(shape.every) !== null && every === null) {
    throw new Error(`${shape.every} is not an interval like 90d, 6 months, or 1m on 31`)
  }
  return {
    start,
    every: mode.repeating ? every : null,
    // Set once the first step exists, since it names one (see `docketAdd`).
    after: null,
    dates: null,
  }
}

function whereWritten(file: RelPath): { doc: DocumentId; segment: string; source: string } {
  const root = documentRoot(file)
  if (root === null) {
    return {
      doc: file as unknown as DocumentId,
      segment: ONLY_SEGMENT as unknown as string,
      source: nameOf(file),
    }
  }
  return {
    doc: root as unknown as DocumentId,
    segment: parseDayFile(file)?.date ?? (ONLY_SEGMENT as unknown as string),
    // The notebook is called the notebook; a list is called what it is named.
    source: root === STREAM_DIR ? 'notebook' : nameOf(root),
  }
}

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
