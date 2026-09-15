// **The notebook, composed as services** — and the Electron-free half of the
// app's two composition roots (`shell/shell-service.ts` is the other).
//
// It builds the foundation, builds every service over it, and hands the list to
// whatever wires the process boundary (D83).
//
// **It answers no IPC channel.** Every verb the renderer can reach belongs to
// the service that owns it — text, marks, the library, intake, the session,
// comments, nav, history, search, and the agenda over its two stores. What is
// here is the three things none of them can do for itself: **construction**, in
// an order that makes the DAG visible; **naming**, so a caller says which
// service it means; and the notebook's **lifecycle**, which is the app's own
// business rather than any one surface's.
//
// **Why one object builds them all.** The foundation is shared — one bus, one
// corpus with one mutation queue, one set of write tiers, one clock, one
// fixed-point runner — and *shared* is the whole point: idempotence has to hold
// concurrently, not merely repeatedly (note 51), and per-service queues would
// break that silently. So something has to own the foundation, and whatever owns
// it is the natural place to build the services that take it.
//
// **Why `NotebookService` and not `DataService`.** The symmetry with
// `ShellService` would be tidier, and it would be a lie: this side holds the
// order guarantee on edits, reconciliation to a fixed point, the day boundary and
// the agenda. Calling that *data* is the same vagueness that made `CoreService`
// four objects instead of one — and there is exactly one notebook per app, which
// is what this is the root of.
//
// **Deliberately free of Electron, like every service under this directory.**
// Three integration suites drive this object under plain Node, which is what
// makes the ordering guarantees testable at all — and ordering is exactly the
// kind of thing that is subtly wrong in a way no manual test notices.

import type { DateKey, VersionId } from '../../shared/document-api.ts'
import type { Notebook } from '../w/notebook.ts'
import type { Repository } from '../w/repository.ts'
import type { StreamHistory } from '../x/history.ts'
import type { CorpusIndex } from '../x/documents/corpus-index.ts'
import { type Corpus } from '../x/documents/corpus.ts'
import { Bus, type MessageSink } from './bus.ts'
import { CorpusService } from './corpus-service.ts'
import { FixedPoints } from './fixed-point.ts'
import { DurabilityService } from './durability-service.ts'
import { DayService } from './day-service.ts'
import { CommentsService } from './comments-service.ts'
import { NavService } from './nav-service.ts'
import { HistoryService } from './history-service.ts'
import { SearchService } from './search-service.ts'
import { MarksService } from './marks-service.ts'
import { LibraryService } from './library-service.ts'
import { IntakeService } from './intake-service.ts'
import { SessionService } from './session-service.ts'
import { TextService } from './text-service.ts'
import { Dockets } from './dockets.ts'
import { Tasks } from './tasks.ts'
import { AgendaService } from './agenda-service.ts'
import { type Serves } from './serves.ts'

/** Anything that can carry a pushed message to a renderer. */
export type { MessageSink }

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
  /** How long writing has to have stopped before the day may end (D62). */
  readonly idleMs?: number
  /**
   * The file tier's quiescence. Verification lengthens it so that "the file
   * tier has not written yet" is a fact rather than a race — but the VALUE
   * arrives from the caller, because reading it means reading the environment
   * through the verify gate, and that gate imports Electron.
   */
  readonly quiesceMs?: number
  readonly maxIntervalMs?: number
  readonly versionQuiesceMs?: number
  readonly versionMaxMs?: number
  /** Off for tests that only want the document. */
  readonly history?: boolean
}

export class NotebookService {
  /**
   * **The foundation, shared by everything above it** (D83).
   *
   * Four focused objects rather than one vague one: the bus pushes, the corpus
   * service owns the store and the one mutation queue, the durability service
   * owns the three write tiers, and `FixedPoints` runs derived state to a fixed
   * point. They form a DAG — durability over the corpus, the corpus over the bus
   * — and nothing points back up.
   */
  readonly #bus: Bus
  readonly #fixed: FixedPoints
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  /** What day it is, and what zone that is computed in (D62, D63). */
  readonly #day: DayService

  /** A window over a document, and every verb that changes it (D54). */
  readonly #text: TextService
  /** Bookmarks, subjects and branches over a span (R11, D44, D13). */
  readonly #marks: MarksService
  /** Documents as files: made, renamed, copied, deleted, imported (D54, MC6). */
  readonly #library: LibraryService
  /** What arrives from outside: pasted text, an image's bytes (R7). */
  readonly #intake: IntakeService
  /** The day, the zone offer, and where the reader was (D62, D63). */
  readonly #session: SessionService
  /** Margin notes on a passage (D47). */
  readonly #comments: CommentsService
  /** What the sidebar asks (D52). */
  readonly #nav: NavService
  /** Reading the past, and putting it back (D32). */
  readonly #history: HistoryService
  /** Searching the corpus — and it owns the `Scanner` (D65). */
  readonly #search: SearchService
  /** The dockets (MH1, D68). */
  readonly #docket: Dockets
  /** The task list (MT3, D55). */
  readonly #todo: Tasks
  /** The agenda: one construct with two forms, over both stores (D84). */
  readonly #agenda: AgendaService

  readonly #notebook: Notebook

  /**
   * **Innermost first, so the DAG is visible in the construction.**
   *
   * The bus depends on nothing; `FixedPoints` depends on nothing either, and
   * both the bottom and the top depend on it — the corpus reports change keys
   * into it and the reconciliation clause registers with it. A leaf mediating
   * between the two is what keeps that edge from pointing upward (D83).
   */
  constructor(notebook: Notebook, options: ServiceOptions = {}) {
    this.#notebook = notebook
    this.#bus = new Bus()
    this.#fixed = new FixedPoints()
    this.#store = new CorpusService(notebook, this.#bus, this.#fixed)
    this.#durable = new DurabilityService(this.#store, this.#fixed, options)
    this.#day = new DayService(this.#store, this.#durable, this.#bus, this.#fixed, options)

    this.#session = new SessionService(this.#store, this.#day, this.#bus, options)
    this.#text = new TextService(this.#store, this.#durable, this.#day, this.#bus)
    this.#marks = new MarksService(this.#store, this.#durable, this.#day)
    this.#library = new LibraryService(this.#store, this.#durable)
    this.#intake = new IntakeService(this.#store, this.#durable, this.#day)
    this.#comments = new CommentsService(this.#store, this.#durable, this.#day)
    this.#nav = new NavService(this.#store, this.#day)
    this.#history = new HistoryService(this.#store, this.#durable)
    this.#search = new SearchService(this.#store)
    this.#docket = new Dockets(this.#store, this.#durable, this.#day, this.#fixed)
    this.#todo = new Tasks(this.#store, this.#durable, this.#day, this.#fixed)
    // **Last, because it is the only one that knows about both stores** (D84).
    this.#agenda = new AgendaService(
      this.#store, this.#durable, this.#day, this.#fixed, this.#docket, this.#todo,
    )
  }

  /**
   * Every service that answers the renderer, for the wiring to walk (D83).
   *
   * The order is immaterial — `claim` refuses two services that want one
   * channel, so a collision is an error at startup rather than a question of
   * which registration won.
   */
  services(): readonly Serves[] {
    return [
      this.#text, this.#marks, this.#library, this.#intake, this.#session,
      this.#comments, this.#nav, this.#history, this.#search, this.#agenda,
    ]
  }

  // ── the services, by name ──────────────────────────────────
  //
  // So that a caller says which service it means. Nothing here forwards a verb:
  // a forwarder would claim the work is this class's, and it is not.

  /** A window over a document: read it, type in it, undo. */
  get text(): TextService {
    return this.#text
  }

  /** Marks over a span: bookmarks, subjects, branches. */
  get marks(): MarksService {
    return this.#marks
  }

  /** Documents as files, rather than as buffers. */
  get library(): LibraryService {
    return this.#library
  }

  /** What arrives from outside the notebook. */
  get intake(): IntakeService {
    return this.#intake
  }

  /** The day, the zone offer, and where the reader was. */
  get session(): SessionService {
    return this.#session
  }

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

  /** The docket store: `service.docket.add(…)`, `service.docket.matters(…)`. */
  get docket(): Dockets {
    return this.#docket
  }

  /** The task store: `service.todo.add(…)`, `service.todo.items(…)`. */
  get todo(): Tasks {
    return this.#todo
  }

  /** The agenda — the construct the dockets and the task list are two forms of. */
  get agenda(): AgendaService {
    return this.#agenda
  }

  // ── the foundation's answers, for callers that legitimately want them ──

  /**
   * The document table, for callers that legitimately hold one document.
   *
   * Not a way around the services — every write still goes through a borrowed
   * document, which is the invariant (D54). It exists because this object is the
   * thing that HAS the corpus, and a test or a tool asking about a document
   * should not have to build a second one beside it.
   */
  get corpus(): Corpus {
    return this.#store.corpus
  }

  /** The corpus index (D52) — what the sidebar asks, and what repairs it. */
  get index(): CorpusIndex {
    return this.#store.index
  }

  /** Where the notebook is. Printing resolves relative links against it. */
  get notebookRoot(): string {
    return this.#notebook.root
  }

  /** What day the app is filing into (D62). */
  get today(): DateKey {
    return this.#day.today
  }

  /** What the calendar says, as against what the notebook is writing into. */
  get clockDay(): DateKey {
    return this.#day.clockDay
  }

  /** What zone this notebook's dates are computed in (D63). */
  get zone(): string {
    return this.#day.zone
  }

  /** Where pushed messages go: the bus, for whoever can carry one to a window. */
  addSink(sink: MessageSink): () => void {
    return this.#bus.addSink(sink)
  }

  // ── the notebook's lifecycle ───────────────────────────────
  //
  // Opening, recovering, crossing a day, quitting. None of these is a surface's
  // verb — they are the app's own, and `main/index.ts` is what calls them.

  /** Cross a boundary if there is one to cross, and say so (D62). */
  async crossTheDay(): Promise<void> {
    return this.#day.crossTheDay()
  }

  /**
   * Write anything outstanding, now (D32's file tier).
   *
   * A lifecycle door, where `recover` and `stop` are: quitting flushes, and so
   * does a test that wants to look at the disk. The *channel* is the text
   * service's, because the surface that asks for it is the editor.
   */
  async flush(): Promise<void> {
    return this.#durable.flush()
  }

  /** Replay whatever the last session did not manage to write. */
  async recover(): Promise<number> {
    return this.#durable.recover()
  }

  /**
   * Open the notebook's history, if it has one (D32's version tier).
   *
   * Separate from the constructor because it does real I/O and can legitimately
   * be skipped — a test that only wants the document should not pay for a git
   * repository.
   */
  async openHistory(): Promise<void> {
    return this.#durable.openHistory()
  }

  /** Record a version of the notebook now. */
  async saveVersion(): Promise<VersionId | null> {
    return this.#durable.saveVersion()
  }

  /** The repository, for the few callers that reach it directly. */
  get repository(): Repository | null {
    return this.#durable.repository
  }

  /** Days and versions, rather than paths and object ids (D32). */
  get history(): StreamHistory | null {
    return this.#durable.history
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
}
