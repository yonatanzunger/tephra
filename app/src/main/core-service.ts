// **Layer 0 — the core.** Everything in `main/` may call this; it calls nothing
// above it (D83).
//
// What lives here is what every service needs and no service may have a second
// copy of: the store, the one mutation queue, and the bus that reaches the
// renderer. The layers above — domain services on layer 1, composing services on
// layer 2 — reach the corpus **only** through here, because a second path to a
// document is a second path around the queue.
//
// **The queue is the reason this class exists.** Idempotence has to hold
// *concurrently*, not merely repeatedly (note 51: two overlapping reconciliation
// passes generated the same task, because each read a world the other was
// halfway through changing). Per-service queues would break that silently, and a
// data race is the failure this project's tests are worst at catching.
//
// **Electron-free, deliberately.** Pushed messages go to a `MessageSink` rather
// than to a `BrowserWindow`, which is what lets the part most likely to be
// subtly wrong be tested in plain Node.
//
// Extracted from `DocumentService` on 2026-09-13, bottom-first, so that
// everything above it moves onto an interface already proven by the suites.
// `Corpus` and `CorpusIndex` are peers beneath it — both built over the
// notebook, neither over the other — and this class is the single interface onto
// the pair.

import { Corpus } from './x/documents/corpus.ts'
import { CorpusIndex } from './x/documents/corpus-index.ts'
import type { StreamDocument } from './x/documents/kinds/stream.ts'
import type { Notebook } from './w/notebook.ts'
import type { DocumentId } from '../shared/document-api.ts'
import { CHANNEL } from '../shared/ipc.ts'
import { STREAM_ID } from '../shared/document-api.ts'

/**
 * Where a pushed message goes.
 *
 * An interface rather than a `BrowserWindow` so this whole layer stays free of
 * Electron.
 */
export interface MessageSink {
  send(channel: string, message: unknown): void
}

export class CoreService {
  readonly #notebook: Notebook
  readonly #corpus: Corpus
  readonly #index: CorpusIndex

  /**
   * The stream, borrowed once and held for as long as the app lives.
   *
   * **Held because it is watched, not instead of borrowing it.** The core is
   * what keeps the stream open — every window over it, the write tiers, the
   * journal — so it takes a watch at construction and the Corpus may never let
   * go of it. The borrow is how it gets the reference the first time; the watch
   * is what makes keeping it safe (D54).
   *
   * A promise rather than a value because opening is asynchronous in general,
   * even where this kind's construction is not.
   */
  readonly #stream: Promise<StreamDocument>

  /**
   * Every mutation of a document chains onto this; reads do not.
   *
   * **Named for what it orders, because the app holds more than one queue.** It
   * is not *the* queue: the reconciliation pass queue is the other, and they
   * order different things at different grains — this one puts individual edits
   * in sequence, that one keeps whole passes from overlapping. A single pass
   * makes many mutations and they interleave with everybody else's through here
   * quite happily.
   */
  #documentMutationQueue: Promise<unknown> = Promise.resolve()

  #sinks: MessageSink[] = []

  constructor(notebook: Notebook) {
    this.#notebook = notebook
    this.#corpus = new Corpus(notebook)
    this.#corpus.watch(STREAM_ID) // the stream is open for as long as the app is
    this.#stream = this.#corpus.use(STREAM_ID, async doc => doc as StreamDocument)
    // The two point at each other by construction order: the index reads days
    // through the document so a loaded one answers from memory, and the
    // document answers corpus-wide questions through the index (D52).
    // The index is handed a way to REACH the stream rather than the stream
    // itself: opening is asynchronous in general, and a constructor cannot wait.
    this.#index = new CorpusIndex(notebook, () => this.#stream)
  }

  // ── the store ────────────────────────────────────────────────

  get notebook(): Notebook {
    return this.#notebook
  }

  get corpus(): Corpus {
    return this.#corpus
  }

  get index(): CorpusIndex {
    return this.#index
  }

  get stream(): Promise<StreamDocument> {
    return this.#stream
  }

  // ── the write path ───────────────────────────────────────────

  /**
   * Put this work in line behind every other mutation.
   *
   * The chain is kept alive across a rejection, or one failed edit would wedge
   * every edit after it.
   */
  mutate<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#documentMutationQueue.then(work, work)
    this.#documentMutationQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  // ── the bus ──────────────────────────────────────────────────

  addSink(sink: MessageSink): () => void {
    this.#sinks.push(sink)
    return () => {
      this.#sinks = this.#sinks.filter(s => s !== sink)
    }
  }

  /** To every renderer listening. */
  announce(channel: string, message: unknown): void {
    for (const sink of this.#sinks) sink.send(channel, message)
  }

  /**
   * This document in particular changed, so anything holding it should re-ask.
   *
   * **For surfaces that read through verbs rather than hold a window** — a
   * docket or a task list asks what a document contains and redraws from the
   * answer, so without this a docket left open would sit there stale while
   * generation changed it underneath.
   */
  changed(id: DocumentId): void {
    this.announce(CHANNEL.documentsChanged, { documents: [id] })
  }
}
