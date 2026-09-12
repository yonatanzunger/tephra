// The document service: one Document, many window handles, and a serial queue.
//
// DELIBERATELY FREE OF ELECTRON. The one rule here that matters more than the
// rest is that edits apply in the order they were composed, and that ordering
// is exactly the kind of thing that is subtly wrong in a way no manual test
// notices. Keeping this module importable from plain Node is what lets it be
// tested at all.
//
// IPC *delivery* is ordered per channel, but `ipcMain.handle` runs handlers
// concurrently — a handler that awaits durability yields, and the next edit can
// start before it finishes. Two keystrokes would then interleave and the
// document would be reordered relative to what the typist saw.

import type { Anomaly } from '../shared/anomalies.ts'
import type { LinkRow } from '../shared/nav-api.ts'
import { isOutside, isStream, ONLY_SEGMENT, TASKS_ID, type Unsubscribe } from '../shared/document-api.ts'
import { CHANNEL, type Attached, type Base, type DayProse, type DocketRow, type ImageAttachment, type ChangeAck, type DocumentInfo, type EditAck, type EditRequest, type ExtendRequest, type ReadRequest, type SpansRequest, type WindowChangedMessage, type WindowId, type WindowSnapshot, type ZoneNotice } from '../shared/ipc.ts'
import type { DateKey, DocumentId, DocumentPosition, DocumentText, SegmentKey, Span, TypedSpan, VersionId } from '../shared/document-api.ts'
import type { CommentId, CommentThread } from '../shared/comments.ts'
import type { Notebook } from './w/notebook.ts'
import { Wal, type WalRecord } from './w/wal.ts'
import { GitRepository } from './w/git-repository.ts'
import type { Repository } from './w/repository.ts'
import { StreamHistory } from './x/history.ts'
import type { RestoreReport, Version } from '../shared/history-api.ts'
import {
  dayFile, documentRoot, kindOf, noteFile, NOTES_DIR, parseDayFile, relativePath,
  resolveInsideNotebook, DOCKETS_DIR, SECTIONS_DIR, slug, STREAM_DIR,
  type RelPath,
} from './w/layout.ts'
import { attach } from './x/documents/attachments.ts'
import { nameOf } from '../shared/slug.ts'
import { DocketDocument } from './x/documents/kinds/docket.ts'
import {
  dueOn, MODES, parseInterval, UNSCHEDULED,
  type Matter, type Mode, type NewMatter, type Schedule, type Section, type StepKind,
} from '../shared/kinds/docket.ts'
import { outsideExists, readOutside } from './w/outside.ts'
import { DayClock } from './x/day-clock.ts'
import { systemZone } from './system-zone.ts'
import { isKnownZone } from '../shared/dates.ts'
import { readSettings, writeSettings } from './w/settings.ts'
import { TodoDocument } from './x/documents/kinds/todo.ts'
import { RESOLVED_DAYS } from '../shared/kinds/todo.ts'
import type { ResolvedItem, TodoItem, TodoStatus, WalkState } from '../shared/kinds/todo.ts'
import { basename, isAbsolute, join } from 'node:path'
import { LOCAL } from './w/layout.ts'
import { parseUiState, type UiState } from '../shared/ui-state.ts'
import { addDays, asDateKey, compareDateKeys, dateKeyAt, nowSeconds } from '../shared/dates.ts'
import { StreamDocument } from './x/documents/kinds/stream.ts'
import { CorpusIndex } from './x/documents/corpus-index.ts'
import { Scanner } from './x/documents/search.ts'
import type { Search } from '../shared/search-api.ts'
import { Corpus, STREAM_ID } from './x/documents/corpus.ts'
import { Filesets } from './x/fileset.ts'
import { applyEdits } from './x/text-edits.ts'
import type { LocalWindow } from './x/window.ts'

/** Anything that can carry a pushed message to a renderer. */
export interface MessageSink {
  send(channel: string, message: unknown): void
}

/**
 * The file-write tier (D32 M2): quiescence OR a ceiling, never quiescence alone.
 *
 * Quiescence alone fails under exactly the condition this notebook exists for —
 * writing continuously for an hour never reaches quiescence, so the file is
 * never written and everything lives in memory until something goes wrong. The
 * ceiling closes that, and it is why both numbers are here rather than one.
 *
 * Durability belongs in main, not in the renderer: the renderer is the process
 * most likely to die, and asking it to remember to save is asking the least
 * reliable component to own the most important guarantee.
 */
const QUIESCE_MS = 1_000

/**
 * How often the service checks whether the day has changed.
 *
 * Well below noticing, well above costing anything — and a poll rather than a
 * timer to the boundary because the case that matters most is a machine that
 * was asleep when the boundary passed.
 */
const DAY_CHECK_MS = 30_000

const MAX_INTERVAL_MS = 5_000

/**
 * The third tier (D32) — recording a recoverable VERSION of the notebook, not
 * "committing", which is one store's word for it. Same shape as the file tier
 * and for the same reason:
 * **quiescence alone fails under precisely the condition this notebook exists
 * for.** Writing continuously for an hour never reaches quiescence, so without
 * a ceiling the commit would never happen and the whole hour would live in one
 * commit — or in none, if the process died.
 */
/**
 * The first tier (D32). Small enough that what it can lose is a few keystrokes;
 * large enough that a burst of typing is one write rather than thirty.
 */
const WAL_BATCH_MS = 50

const VERSION_QUIESCE_MS = 5 * 60_000
const VERSION_MAX_MS = 30 * 60_000

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
  readonly #corpus: Corpus
  /**
   * The stream, borrowed once and held for as long as the service lives.
   *
   * **Held because it is watched, not instead of borrowing it.** The service is
   * what keeps the stream open — every window over it, the write tiers, the
   * journal — so it takes a watch at construction and the Corpus may never let
   * go of it. The borrow below is how it gets the reference the first time; the
   * watch is what makes keeping it safe (D54).
   *
   * A promise rather than a value because opening is asynchronous in general,
   * even where this kind's construction is not. Documents OTHER than this one
   * are borrowed per operation and tracked by nobody, which is MC3 onward.
   */
  readonly #stream: Promise<StreamDocument>
  readonly #index: CorpusIndex
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

  /** The serial queue. Every mutation chains onto it; reads do not need to. */
  #queue: Promise<unknown> = Promise.resolve()

  #flushTimer: ReturnType<typeof setTimeout> | null = null
  #dirtySince: number | null = null

  #repo: Repository | null = null
  #versionTimer: ReturnType<typeof setTimeout> | null = null
  #versionDirtySince: number | null = null
  readonly #quiesceMs: number
  readonly #maxIntervalMs: number
  readonly #versionQuiesceMs: number
  readonly #versionMaxMs: number
  readonly #wantsHistory: boolean

  /** The day the app believes it is in, and the poll that keeps it honest. */
  #clock: DayClock
  /** The day through which every earlier one is known to be closed off. */
  #closedThrough: DateKey | null = null
  /** The last writing day anybody was told about. */
  #announced: DateKey | null = null
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
  readonly #seeded: Promise<void>
  readonly #idleMs: number | undefined
  #dayTimer: ReturnType<typeof setInterval> | null = null
  readonly #now: () => Date

  /** Something is unwritten or unversioned; the tiers have work to do. */
  #unsavedWork = false
  /** Whether anything outside the app changed since the last version. */
  #sawExternal = false

  /**
   * One log per document (D32, D54).
   *
   * `walFile(docId)` has always taken an id and has only ever been given
   * `'stream'`. Making it real here rather than when the second writable kind
   * arrives means a pin's durability is not a thing anybody has to remember to
   * add.
   */
  readonly #wals = new Map<DocumentId, Wal>()
  readonly #walBatchMs: number
  readonly #walPending = new Map<DocumentId, WalRecord[]>()
  #walTimer: ReturnType<typeof setTimeout> | null = null

  /** Dates touched since the last version, for its reason. */
  readonly #pendingDates = new Set<string>()
  /** The first line of the most recent insertion, for the message. */
  #headline = ''

  readonly #notebook: Notebook

  constructor(notebook: Notebook, options: ServiceOptions = {}) {
    this.#notebook = notebook
    this.#corpus = new Corpus(notebook)
    this.#corpus.watch(STREAM_ID) // the stream is open for as long as the app is
    this.#stream = this.#corpus.use(STREAM_ID, async doc => doc as StreamDocument)
    // The two point at each other by construction order: the index reads days
    // through the document so a loaded one answers from memory, and the
    // document answers corpus-wide questions through the index (D52).
    // The index is handed a way to REACH the stream rather than the stream
    // itself: opening is asynchronous in general, and a constructor cannot wait.
    // In MC3 this becomes the Corpus, and the closure goes away.
    this.#index = new CorpusIndex(notebook, () => this.#stream)
    this.#search = new Scanner(notebook, this.#index)
    this.#filesets = new Filesets(this.#corpus)
    this.#walBatchMs = options.walBatchMs ?? WAL_BATCH_MS
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS
    this.#maxIntervalMs = options.maxIntervalMs ?? MAX_INTERVAL_MS
    this.#versionQuiesceMs = options.versionQuiesceMs ?? VERSION_QUIESCE_MS
    this.#versionMaxMs = options.versionMaxMs ?? VERSION_MAX_MS
    this.#wantsHistory = options.history !== false
    this.#now = options.now ?? (() => new Date())
    this.#idleMs = options.idleMs
    // Seeded properly once the stream can be asked what the newest day is; a
    // clock with no seed is on today, which is right for a notebook with
    // nothing in it and is corrected by `#seedTheClock` for one that has.
    this.#clock = new DayClock(null, { now: this.#now, ...(this.#idleMs === undefined ? {} : { idleMs: this.#idleMs }) })
    // **Seeding is I/O and a constructor is not**, so the clock starts on today
    // and is corrected the moment the corpus can be read. Every door into this
    // object awaits `#seeded` first, so nothing can observe the wrong answer —
    // which is not hypothetical: the first draft raced, and a caller asking the
    // date immediately got the unseeded one.
    // What the unseeded clock says is the baseline. **If the seed moves the
    // writing day, that IS a boundary** — the app was closed when it happened
    // and this is the moment it is noticed — so it has to be announced like any
    // other, which it will be, because it will differ from this.
    this.#announced = this.#clock.writingDay
    this.#seeded = this.#seedTheClock()
    this.#systemZone = options.systemZone ?? systemZone
    this.#watchTheClock(options.dayCheckMs ?? DAY_CHECK_MS)

    // What went into the commit message, gathered as it happens. Reconstructing
    // it later would mean diffing, and the point of quoting the text is that it
    // is right there at the moment of the change.
    // Into the log before the file tier gets to it: that gap is the whole
    // reason the log exists.
    // Through the Corpus rather than from a document: with documents opening
    // and being let go, a subscription against one of them has no lifetime to
    // live in (D54). The id says which document an edit belongs to.
    this.#corpus.onJournal((id, segment, baseLen, edits) => {
      const pending = this.#walPending.get(id) ?? []
      for (const edit of edits) {
        pending.push({
          doc: id as string,
          date: segment as string,
          baseLen,
          from: edit.from,
          to: edit.to,
          insert: edit.insert,
        })
      }
      this.#walPending.set(id, pending)
      this.#scheduleWal()
    })

    this.#corpus.onChanged((_id, change) => {
      // **Any document changing schedules a write.** The service used to say so
      // at each of its own mutating methods, which was complete while it was
      // the only writer — then a pin became a document edit made through
      // another object, and nothing scheduled anything: the text sat in memory
      // until the app quit. A change is a change, whoever asked for it (D54).
      if (change.origin !== 'external') this.#touched()

      // An external change must not colour OUR commit message. Measured before
      // this guard existed: a hand-edit set the headline, and the next commit
      // triggered by typing quoted text its author never wrote.
      if (change.origin === 'external') return
      for (const edit of change.edits) {
        this.#pendingDates.add(edit.span.begin.segment as string)
        const line = edit.payload.split('\n').find(l => l.trim() !== '')
        if (line !== undefined) this.#headline = line.trim()
      }
    })

    // Hand-editing is a feature, so the app has to notice. Queued with the
    // edits, because a reload racing a write is the corruption this whole
    // layer exists to avoid.
    notebook.onExternalChange(changes => {
      void this.#serial(async () => {
        for (const change of changes) await (await this.#stream).externalChanged(change.rel)

        // **What the document did not take, the sidebar still needs.** A day
        // file becomes a DocumentChange and travels the ordinary way; a section
        // file edited by hand is a change to something no window is holding, so
        // it is announced as itself and whoever cares re-asks (D53).
        const elsewhere = changes.map(c => c.rel).filter(rel => parseDayFile(rel) === null)
        if (elsewhere.length > 0) {
          for (const sink of this.#sinks) sink.send(CHANNEL.corpusChanged, elsewhere)
        }
        // Nothing to collect: the commit scans for itself. All that is needed
        // is that a commit becomes worth scheduling, and that the message
        // admits the notebook was edited from outside.
        this.#sawExternal = true
        this.#versionable()
      })
    })

    this.#corpus.onDiverged((_id, divergence) => {
      for (const sink of this.#sinks) sink.send(CHANNEL.diverged, divergence)
    })
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
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work)
    // Keep the chain alive even when a link rejects, or one failed edit would
    // wedge every edit after it.
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
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
    await this.#seeded
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
    await this.#seeded
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
      if (request.origin === 'user') this.#clock.wrote()
      this.#scheduleFlush()
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
    return this.#serial(() =>
      this.#corpus.use(id, async doc => {
        const change = await doc.undo()
        this.#scheduleFlush()
        return { change, generation: doc.generation }
      }),
    )
  }

  async redo(id: DocumentId = STREAM_ID): Promise<ChangeAck> {
    return this.#serial(() =>
      this.#corpus.use(id, async doc => {
        const change = await doc.redo()
        this.#scheduleFlush()
        return { change, generation: doc.generation }
      }),
    )
  }

  async flush(): Promise<void> {
    this.#cancelFlush()
    // Everything with unsaved work, not only the stream: the tiers are the
    // corpus's, not one document's (D54, MC2c).
    const written = await this.#serial(() => this.#corpus.flushAll())
    // ORDER MATTERS: files first, then the log. A crash between the two replays
    // edits the files already contain, which is exactly what `baseLen` makes
    // harmless. The other order would lose them outright.
    if (this.#walTimer !== null) clearTimeout(this.#walTimer)
    this.#walTimer = null
    this.#walPending.clear()
    for (const wal of this.#wals.values()) await wal.clear()
    if (written.length > 0) {
      this.#versionable()
    }
  }

  // ── the day, which changes whether or not anyone is looking ──

  /**
   * What day the app is filing into.
   *
   * **One place decides this.** `StreamDocument.today()` reads the system clock
   * afresh, which is right for a static helper and wrong for an app that has to
   * agree with itself: the service polls, announces, and answers from what it
   * announced, so a window opened at 23:59 and the message that arrives at
   * 00:00 cannot disagree about which day it is now.
   */
  get today(): DateKey {
    return this.#clock.writingDay
  }

  /**
   * What the calendar says, as against what the notebook is writing into (D62).
   *
   * The interface counts from this — a due date's *in three days*, the
   * sidebar's marker — while the filing date is `today` above. They differ
   * exactly while somebody is still writing past midnight, and a band that
   * still says *tomorrow* at 00:30 is telling the truth about the evening they
   * are still in.
   */
  get clockDay(): DateKey {
    return this.#clock.clockDay
  }

  /**
   * Notice midnight, and say so.
   *
   * **Polled rather than scheduled to the boundary**, for the case a scheduled
   * timer is worst at: a laptop asleep at midnight wakes at nine, and a timer
   * set for the boundary fires late and alone while a poll simply notices on
   * its next tick. Thirty seconds is far below what anyone would perceive and
   * far above what it costs.
   *
   * The announcement is all main does. Where the caret should go is the
   * renderer's — it is the only side that knows whether someone is in the
   * middle of a sentence (D35: the editor reports facts, Z owns policy).
   */
  /**
   * What day the notebook was on when it was last closed.
   *
   * **Read from the corpus, because the ordinary case is an app that was not
   * running** (D62). The newest day with a file, and when that file was last
   * written, is enough to reconstruct the answer — after a close, a crash, a
   * sleeping laptop or a week away, none of which a live timer survives.
   */
  async #seedTheClock(): Promise<void> {
    const { zone } = await readSettings(this.#notebook)
    const stream = await this.#stream
    const days = await stream.dates()
    const newest = days[days.length - 1]
    const stamp = newest === undefined ? null : await this.#notebook.stamp(dayFile(newest))
    this.#clock = new DayClock(
      newest === undefined ? null : { day: newest, writtenAt: stamp?.mtime ?? 0 },
      { now: this.#now, zone, ...(this.#idleMs === undefined ? {} : { idleMs: this.#idleMs }) },
    )
  }

  /** What zone this notebook's dates are computed in (D63). */
  get zone(): string {
    return this.#clock.zone
  }

  /**
   * Say where you are now, and keep it with the notebook.
   *
   * **Chosen, never detected.** The system's zone is offered when it differs
   * and applied only here, because a zone that changes itself is what D38
   * rightly rejected — travel would otherwise re-date the day you are in.
   */
  async setZone(zone: string): Promise<void> {
    if (!isKnownZone(zone)) throw new Error(`this machine does not know the zone ${zone}`)
    await this.#seeded
    await writeSettings(this.#notebook, { zone })
    this.#clock.moveTo(zone)
    this.#touched()
    // A zone somebody chose is not a zone somebody declined.
    this.#declined = null
    this.#tellAboutTheZone()
    // A zone change can put the calendar past the writing day, which is an
    // ordinary boundary and crossed the ordinary way.
    await this.crossTheDay()
    for (const sink of this.#sinks) sink.send(CHANNEL.dayRolled, this.#clock.writingDay)
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
    for (const sink of this.#sinks) sink.send(CHANNEL.zoneNotice, notice)
  }

  /**
   * Cross a boundary if there is one to cross, and say so.
   *
   * **Main does the infrastructural half before it announces**, which is what
   * keeps three windows from racing to do it and what means no window ever
   * sees a half-crossed boundary (D62). The announcement is still all the
   * renderer gets: where the caret should go is the renderer's, because it is
   * the only side that knows whether somebody is mid-sentence (D35).
   */
  async crossTheDay(): Promise<void> {
    await this.#seeded
    const advanced = this.#clock.tick()
    const writing = this.#clock.writingDay

    // **Not "did it just advance" — "is every day before this one closed".**
    // The tick is an edge and the invariant is a level, which is the whole
    // shape of D62; asking the edge missed the commonest case of all, an app
    // opened the next morning where the seed had already moved the writing day
    // and no tick was ever going to fire.
    if (this.#closedThrough === null || compareDateKeys(writing, this.#closedThrough) > 0) {
      const stream = await this.#stream
      const before = (await stream.dates()).filter(day => compareDateKeys(day, writing) < 0)
      const last = before[before.length - 1]
      if (last !== undefined && (await this.#serial(() => stream.endDay(last)))) this.#touched()
      // A memo, not the truth: the files are the truth, and this only saves the
      // scan on the ninety-nine polls out of a hundred with nothing to do.
      this.#closedThrough = writing
    }

    // **Announced when it DIFFERS, not when it just moved.** Using the tick's
    // edge lost the announcement whenever the seed landed after a boundary had
    // already passed: the seeded clock was born on the new day, so nothing ever
    // "advanced" and nobody was told. The same level-rather-than-edge mistake
    // this design was written to avoid, made in the one place that was still an
    // event (D62).
    if (writing !== this.#announced) {
      this.#announced = writing
      for (const sink of this.#sinks) sink.send(CHANNEL.dayRolled, writing)
      // **Unattended, at the boundary** (H5): generation is not contingent on
      // anybody doing a thing, because the whole point is that it happens while
      // nobody is looking. Failures are swallowed here on purpose — a
      // background pass that throws must not take the day roll with it, and the
      // next pass will try again, since nothing depends on this one having run.
      void this.generate().catch(() => undefined)
    }

    // The same poll notices the machine moving. Changing the system zone is not
    // an event anything reports, so noticing it means looking — and the thing
    // that already looks at the clock every thirty seconds is this.
    this.#tellAboutTheZone()
    void advanced
  }

  #watchTheClock(everyMs: number): void {
    this.#dayTimer = setInterval(() => void this.crossTheDay(), everyMs)
    // The clock must never be the reason a process stays alive.
    this.#dayTimer.unref?.()
  }

  // ── the write-ahead log (D32) ────────────────────────────────

  /** The log for one document, made on first use. */
  #walFor(id: DocumentId): Wal {
    const held = this.#wals.get(id)
    if (held !== undefined) return held
    const made = new Wal(this.#notebook, id as string)
    this.#wals.set(id, made)
    return made
  }

  #scheduleWal(): void {
    if (this.#walTimer !== null) return
    this.#walTimer = setTimeout(() => {
      this.#walTimer = null
      for (const [id, batch] of [...this.#walPending]) {
        this.#walPending.delete(id)
        void this.#walFor(id).append(batch)
      }
    }, this.#walBatchMs)
  }

  /**
   * Replay whatever the last session did not manage to write, and write it.
   *
   * Called once at startup, before any window opens. A record whose day is not
   * the length that record expected is skipped: it is already in the file,
   * because the crash landed after the write and before the log was cleared.
   * Later records then match again, so recovery resumes wherever the files
   * actually got to rather than refusing wholesale.
   */
  async recover(): Promise<number> {
    // One log per document, so recovery asks each of them. Only the stream is
    // writable today; a record naming anything else is from a build that could
    // write more, and is skipped rather than guessed at.
    const records = await this.#walFor(STREAM_ID).read()
    if (records.length === 0) return 0

    let applied = 0
    for (const record of records) {
      if (record.doc !== (STREAM_ID as string)) continue
      const segment = await (await this.#stream).segment(record.date as DateKey)
      if (segment.readOnly || segment.diverged) continue
      if (segment.length !== record.baseLen) continue // already on disk
      const body = segment.body
      segment.setBody(applyEdits(body, [{ from: record.from, to: record.to, insert: record.insert }]))
      applied++
    }

    if (applied > 0) await this.flush()
    else await this.#walFor(STREAM_ID).clear()
    return applied
  }

  // ── the version tier (D32) ───────────────────────────────────

  /**
   * Open the repository and reconcile whatever happened while the app was not
   * running. Separate from the constructor because it does real I/O and can
   * legitimately be skipped — a test that only wants the document should not
   * pay for a git repository.
   */
  async openHistory(): Promise<void> {
    if (!this.#wantsHistory) return
    this.#repo = await GitRepository.open(this.#notebook.root)
    const first = (await this.#repo.latest()) === null
    await this.#repo.save(first ? 'Opened the notebook' : 'Changes made outside Tephra')
  }

  /**
   * Record a version of the notebook now.
   *
   * Flushes first: saving a file the editor has not written yet records the
   * previous state and quietly loses the newest work from the history — the one
   * place it was supposed to be safe.
   */
  async saveVersion(): Promise<VersionId | null> {
    this.#cancelVersion()
    if (this.#repo === null) return null
    await this.flush()

    const message = this.#reason()
    this.#pendingDates.clear()
    this.#headline = ''
    this.#sawExternal = false
    this.#unsavedWork = false
    // The store finds what changed for itself. Nothing is tracked here on its
    // behalf, and nothing here knows how it is stored.
    return this.#repo.save(message)
  }

  /**
   * The reason a version was recorded: the first line of what changed, prefixed
   * by the dates touched — chosen because the job is finding a lost paragraph a year later,
   * and a timestamp does not help with that.
   *
   * NOTE for the purge procedure (T10): this puts content in the version's
   * reason as well as in the file, so deleted text lives in two places per commit
   * and a purge must rewrite messages too.
   */
  #reason(): string {
    const dates = [...this.#pendingDates].sort()
    const where =
      dates.length === 0
        ? 'notebook'
        : dates.length === 1
          ? (dates[0] as string)
          : `${dates[0] as string}..${dates[dates.length - 1] as string}`
    const text = this.#headline.length > 72 ? `${this.#headline.slice(0, 71)}\u2026` : this.#headline
    // One scan means a commit may carry work from elsewhere alongside ours.
    // Saying so is the honest version of the earlier attempt to separate them:
    // the message quotes only what WE wrote, and admits when that is not the
    // whole story.
    if (text === '') return this.#sawExternal ? 'Changes made outside Tephra' : where
    return `${where} \u00b7 ${text}${this.#sawExternal ? ' (with changes made outside Tephra)' : ''}`
  }

  #scheduleVersion(): void {
    if (this.#repo === null) return
    if (!this.#unsavedWork) return
    const now = Date.now()
    this.#versionDirtySince ??= now
    if (this.#versionTimer !== null) clearTimeout(this.#versionTimer)
    const remaining = this.#versionMaxMs - (now - this.#versionDirtySince)
    this.#versionTimer = setTimeout(
      () => void this.saveVersion(),
      Math.max(0, Math.min(this.#versionQuiesceMs, remaining)),
    )
  }

  #cancelVersion(): void {
    if (this.#versionTimer !== null) clearTimeout(this.#versionTimer)
    this.#versionTimer = null
    this.#versionDirtySince = null
  }

  /** The history, for reading. Null when history is off. */
  get repository(): Repository | null {
    return this.#repo
  }

  /** Days and versions, rather than paths and object ids (D32). */
  get history(): StreamHistory | null {
    return this.#repo === null ? null : new StreamHistory(this.#repo)
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
    this.#unsavedWork = true
    await this.flush()
    await this.#repo?.save(`Restored to ${version.slice(0, 7)}`)
    return report
  }

  /**
   * Write after a second of quiet, but never later than five seconds after the
   * first unsaved change — whichever comes first.
   */
  #scheduleFlush(): void {
    const now = Date.now()
    this.#dirtySince ??= now
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    const remaining = this.#maxIntervalMs - (now - this.#dirtySince)
    this.#flushTimer = setTimeout(
      () => void this.flush(),
      Math.max(0, Math.min(this.#quiesceMs, remaining)),
    )
  }

  #cancelFlush(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer)
    this.#flushTimer = null
    this.#dirtySince = null
  }

  /**
   * Quiesce: write anything outstanding, commit it, and stop the timers.
   *
   * Session end is the third of the commit tier's three triggers (D32), and the
   * important one — it is what makes "I wrote for ten minutes and quit" land in
   * the history rather than waiting for a quiescence that will never come.
   */
  async stop(): Promise<void> {
    await this.flush()
    await this.saveVersion()
    this.#cancelFlush()
    this.#cancelVersion()
    if (this.#walTimer !== null) clearTimeout(this.#walTimer)
    this.#walTimer = null
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
    this.#unsavedWork = true
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
    this.#touched()
    // **Completion flows back to whatever asked for it** (H7a). Finishing the
    // task is the act a person performs; the step it came from has to hear,
    // because that is what unblocks the next one and what a recurrence measures
    // from. Without this the chain only advances if somebody also went to the
    // docket and said so, which is asking them to do it twice.
    if (status === 'done') await this.#finished(item)
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
            (doc as DocketDocument).completeStep(matter.id as string, step.id as string, nowSeconds())))
        this.#wrote(docket)
        return
      }
    }
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
    this.#unsavedWork = true
    this.#scheduleFlush()
  }

  /** The same, for the version tier's much longer clock (D32). */
  #versionable(): void {
    this.#unsavedWork = true
    this.#scheduleVersion()
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
    await this.#seeded
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
    await this.#seeded
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
    this.#wrote(id)
    return made
  }

  /** Change what kind of thing a matter is — the four a person chooses between. */
  async docketSetMode(id: DocumentId, matter: string, mode: Mode): Promise<void> {
    if (!MODES.some(one => one.key === mode)) {
      throw new Error(`${mode} is not one of the four kinds of matter`)
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setMode(matter, mode)))
    this.#wrote(id)
  }

  /** The date of the next instance, or none — which is the whole of *inactive*. */
  async docketSetStart(id: DocumentId, matter: string, start: string | null): Promise<void> {
    const said = start === null || start.trim() === '' ? null : asDateKey(start.trim())
    if (start !== null && start.trim() !== '' && said === null) {
      throw new Error(`${start} is not a date`)
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setStart(matter, said)))
    this.#wrote(id)
  }

  /** How often it comes round. `every` as typed: `90d`, `1m on 31`, or nothing. */
  async docketSetEvery(id: DocumentId, matter: string, every: string | null): Promise<void> {
    const said = every === null || every.trim() === '' ? null : parseInterval(every)
    if (every !== null && every.trim() !== '' && said === null) {
      throw new Error(`${every} is not an interval like 90d, 6 months, or 1m on 31`)
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setEvery(matter, said)))
    this.#wrote(id)
  }

  /** Which step's completion starts the next instance, or none (D76, Qa). */
  async docketSetAfter(id: DocumentId, matter: string, after: string | null): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setAfter(matter, after)))
    this.#wrote(id)
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
    this.#wrote(id)
  }



  async docketSetOwner(id: DocumentId, matter: string, owner: string | null): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).setOwner(matter, owner)))
    this.#wrote(id)
  }

  async docketSetLink(id: DocumentId, matter: string, link: string | null): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).setLink(matter, link)))
    this.#wrote(id)
  }

  async docketTag(id: DocumentId, matter: string, subject: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).tagMatter(matter, subject)))
    this.#wrote(id)
  }

  async docketUntag(id: DocumentId, matter: string, subject: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).untagMatter(matter, subject)))
    this.#wrote(id)
  }

  /** The prose under a matter. Nothing in it is parsed (D56's rule, carried). */
  async docketSetNotes(id: DocumentId, matter: string, notes: readonly string[]): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).setNotes(matter, notes)))
    this.#wrote(id)
  }

  // ── sections on a docket (MH1) ──────────────────────────────

  /** The docket divided into its sections, which is how it is read. */
  async docketSections(id: DocumentId): Promise<readonly Section[]> {
    return this.#corpus.use(id, doc => (doc as DocketDocument).sections())
  }

  async docketAddSection(id: DocumentId, name: string): Promise<string> {
    const made = await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).addSection(name)))
    this.#wrote(id)
    return made
  }

  async docketRenameSection(id: DocumentId, name: string, to: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).renameSection(name, to)))
    this.#wrote(id)
  }

  /** Take the heading away and keep everything that was under it. */
  async docketRemoveSection(id: DocumentId, name: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).removeSection(name)))
    this.#wrote(id)
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
    this.#wrote(id)
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
    this.#wrote(id)
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
    this.#wrote(id)
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
    this.#wrote(id)
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
    this.#wrote(id)
  }

  async docketRemoveStep(id: DocumentId, matter: string, step: string): Promise<void> {
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).removeStep(matter, step)))
    this.#wrote(id)
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
        (doc as DocketDocument).completeStep(matter, step, done ? nowSeconds() : null)))
    this.#wrote(id)
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
    this.#wrote(id)
    return when
  }

  /** Stop work on it, keeping what it has already done (D76). */
  async docketSuspend(id: DocumentId, matter: string): Promise<void> {
    // **Withdraw what it put on the list, and only that.** Suspending means the
    // work is not happening now, so a task generated for it has no business
    // still sitting on today's list — and provenance is what makes *only that*
    // possible: an item somebody typed themselves is untouched, and so is one
    // that was already finished, because finishing it was true.
    const found = (await this.docketMatters(id)).find(one => one.id === matter)
    const list = await this.todoList()
    for (const step of found?.steps ?? []) {
      if (step.made === null || step.done !== null || step.id === null) continue
      await this.todoRemove(list, step.made)
      await this.#serial(async () =>
        this.#corpus.use(id, doc => (doc as DocketDocument).setMade(matter, step.id as string, null)))
    }
    await this.#serial(async () =>
      this.#corpus.use(id, doc => (doc as DocketDocument).suspend(matter)))
    this.#wrote(id)
  }

  async docketRemove(id: DocumentId, matter: string): Promise<void> {
    await this.#serial(async () => this.#corpus.use(id, doc => (doc as DocketDocument).remove(matter)))
    this.#wrote(id)
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
    this.#wrote(id)
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

  // ── generation (MH3a, D76) ─────────────────────────────────

  /**
   * Put on the task list whatever a docket says is due, and nothing twice.
   *
   * **This is the whole point of a docket** — until now one described work and
   * produced none. A step comes due when its moment has arrived (`T±N` from the
   * matter's start, or after the step it waits on was finished) and it has not
   * already made something.
   *
   * **Idempotence is the load-bearing rule** (H5), and it is bought with
   * provenance rather than with a diary of what ran: a step records the item it
   * made, so running the pass twice, or ten times, or after a month away, makes
   * one task and not thirty. Nothing consults a *last run* date, which is the
   * thing that goes wrong when the app was not running at midnight.
   *
   * **Status steps are authored and inert**, because the horizon does not exist
   * yet (MH2). The same bargain MH1 made with triggers, which worked.
   */
  async generate(): Promise<readonly string[]> {
    const today = this.today
    const list = await this.todoList()
    const made: string[] = []
    for (const docket of await this.#corpus.list('docket')) {
      const matters = await this.docketMatters(docket)
      for (const matter of matters) {
        if (matter.id === null) continue
        for (const step of matter.steps) {
          if (step.id === null || step.kind !== 'task') continue
          // **Already done, or already made something**: either way this step
          // has had its turn in this instance of the matter.
          if (step.done !== null || step.made !== null) continue
          const due = dueOn(step, matter, addDays)
          if (due === null || compareDateKeys(due, today) > 0) continue
          const item = await this.todoAdd(list, step.text)
          await this.#serial(async () =>
            this.#corpus.use(docket, doc => (doc as DocketDocument).setMade(matter.id as string, step.id as string, item)))
          made.push(item)
        }
      }
      if (made.length > 0) this.#wrote(docket)
    }
    return made
  }

  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    return (await this.#stream).resolveAnchor(name)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    return (await this.#stream).extent()
  }

  // ── pushing to the renderer ────────────────────────────────

  #sinks: MessageSink[] = []

  /**
   * Where pushed messages go. An interface rather than a BrowserWindow so this
   * whole class stays free of Electron — which is what lets its serial queue,
   * the part most likely to be subtly wrong, be tested in plain Node.
   */
  addSink(sink: MessageSink): () => void {
    this.#sinks.push(sink)
    return () => {
      this.#sinks = this.#sinks.filter(s => s !== sink)
    }
  }

  #broadcast(message: WindowChangedMessage): void {
    for (const sink of this.#sinks) sink.send(CHANNEL.windowChanged, message)
  }

  /**
   * Written to: the notebook is dirty, and this document in particular changed.
   *
   * **One call, because forgetting the second half is silent.** A verb that
   * marks the notebook dirty without naming what it wrote leaves any surface
   * holding that document showing yesterday's answer, with nothing to say so.
   */
  #wrote(id: DocumentId): void {
    this.#touched()
    this.#changed(id)
  }

  /**
   * Say that a document was written to, so surfaces holding it can re-read.
   *
   * **Named, not blanket.** A surface asks *is this mine?* and ignores the rest,
   * which keeps a docket from redrawing every time anybody types in the stream.
   */
  #changed(id: DocumentId): void {
    for (const sink of this.#sinks) {
      sink.send(CHANNEL.documentsChanged, { documents: [id] })
    }
  }

  #broadcastReset(id: WindowId): void {
    for (const sink of this.#sinks) sink.send(CHANNEL.windowReset, { id })
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
