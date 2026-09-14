// **Foundation. Depends on `Bus`.**
//
// The corpus, and the discipline for writing to it. That one sentence is the
// whole scope: everything in `main/` that touches a document reaches it through
// here, and every mutation of one goes through the queue below.
//
// **No IPC channels, and that is the rule rather than an omission** (D83).
// Channels belong to domain services, because a channel is a thing the renderer
// has a name for — and there is nothing on the far side of the fence that
// corresponds to a corpus or a queue. A foundation service exists to be
// depended on, not to be called from outside the process.
//
// **`Corpus` and `CorpusIndex` are peers**, both built over the notebook and
// both reaching the same per-document objects, neither over the other. This
// class is the single interface onto the pair.
//
// **Lower things emit; higher things subscribe.** `DurabilityService` needs to
// know when a document changed, and it learns by subscribing here — this class
// has never heard of it. That keeps the dependency pointing down while the data
// flows up, and it is the same inversion the reconciler uses (D77, D83).

import { Corpus, STREAM_ID } from '../x/documents/corpus.ts'
import { CorpusIndex } from '../x/documents/corpus-index.ts'
import type { StreamDocument } from '../x/documents/kinds/stream.ts'
import type { Notebook } from '../w/notebook.ts'
import { parseDayFile } from '../w/layout.ts'
import type { Bus } from './bus.ts'
import type { FixedPoints } from './fixed-point.ts'
import { documentKey } from './change-keys.ts'
import type { DocumentId, Unsubscribe } from '../../shared/document-api.ts'
import { CHANNEL } from '../../shared/ipc.ts'


export class CorpusService {
  readonly #notebook: Notebook
  readonly #corpus: Corpus
  readonly #index: CorpusIndex
  readonly #bus: Bus

  /**
   * The stream, borrowed once and held for as long as the app lives.
   *
   * **Held because it is watched, not instead of borrowing it.** This service is
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
   * **This is why the class exists.** Idempotence has to hold *concurrently*,
   * not merely repeatedly (note 51: two overlapping reconciliation passes
   * generated the same task, because each read a world the other was halfway
   * through changing). A second queue anywhere would break that silently, and a
   * data race is the failure this project's tests are worst at catching.
   *
   * **Named for what it orders, because the app holds more than one queue.** The
   * reconciliation pass queue is the other, and they order different things at
   * different grains — this one puts individual edits in sequence, that one
   * keeps whole passes from overlapping. A single pass makes many mutations and
   * they interleave with everybody else's through here quite happily.
   */
  #documentMutationQueue: Promise<unknown> = Promise.resolve()

  /** Told after the reload, so a subscriber sees a corpus already caught up. */
  #onExternal: ((rels: readonly string[]) => void)[] = []

  readonly #fixed: FixedPoints

  constructor(notebook: Notebook, bus: Bus, fixed: FixedPoints) {
    this.#notebook = notebook
    this.#bus = bus
    this.#fixed = fixed
    this.#corpus = new Corpus(notebook)
    this.#corpus.watch(STREAM_ID) // the stream is open for as long as the app is
    this.#stream = this.#corpus.use(STREAM_ID, async doc => doc as StreamDocument)
    // The two point at each other by construction order: the index reads days
    // through the document so a loaded one answers from memory, and the
    // document answers corpus-wide questions through the index (D52).
    // The index is handed a way to REACH the stream rather than the stream
    // itself: opening is asynchronous in general, and a constructor cannot wait.
    this.#index = new CorpusIndex(notebook, () => this.#stream)

    // Hand-editing is a feature, so the app has to notice. Queued with the
    // edits, because a reload racing a write is the corruption this whole layer
    // exists to avoid.
    notebook.onExternalChange(changes => {
      void this.mutate(async () => {
        for (const change of changes) await (await this.#stream).externalChanged(change.rel)

        // **What the document did not take, the sidebar still needs.** A day
        // file becomes a DocumentChange and travels the ordinary way; a section
        // file edited by hand is a change to something no window is holding, so
        // it is announced as itself and whoever cares re-asks (D53).
        const elsewhere = changes.map(c => c.rel).filter(rel => parseDayFile(rel) === null)
        if (elsewhere.length > 0) this.#bus.announce(CHANNEL.corpusChanged, elsewhere)
        // And whoever is keeping the version tier's message honest wants to
        // know the notebook was edited from outside.
        const rels = changes.map(c => c.rel)
        for (const told of this.#onExternal) told(rels)
      })
    })

    this.#corpus.onDiverged((_id, divergence) => {
      this.#bus.announce(CHANNEL.diverged, divergence)
    })

    // **Every write is reported, and no write site has to remember to do it.**
    // What derives from a document has to be rebuilt when that document moves,
    // and the alternative — asking each of a hundred and fifty verbs to say so —
    // is the invariant-by-memory that note 61 records decaying. This is the one
    // place every change already passes through.
    //
    // **Not awaited here**, because a change subscription is synchronous and has
    // nobody to hand a promise to. A verb that must not resolve until derived
    // state has caught up waits by asking again itself; asking twice costs
    // nothing, since a key repeated inside one round is one key.
    this.#corpus.onChanged((id) => {
      void this.#fixed.changed(documentKey(id))
    })
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

  // ── the queue ────────────────────────────────────────────────

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

  // ── what happened, for whoever is listening ──────────────────

  /** Every edit, as the journal sees it — what the write-ahead log reads. */
  onJournal(...args: Parameters<Corpus['onJournal']>): Unsubscribe {
    return this.#corpus.onJournal(...args)
  }

  /** Every change to any document, whoever asked for it. */
  onChanged(...args: Parameters<Corpus['onChanged']>): Unsubscribe {
    return this.#corpus.onChanged(...args)
  }

  /**
   * The notebook was edited from outside, and the corpus has caught up.
   *
   * Announced after the reload rather than before, so a subscriber never sees a
   * corpus that disagrees with the files it is being told about.
   */
  onExternalChange(told: (rels: readonly string[]) => void): Unsubscribe {
    this.#onExternal.push(told)
    return () => {
      this.#onExternal = this.#onExternal.filter(one => one !== told)
    }
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
    this.#bus.announce(CHANNEL.documentsChanged, { documents: [id] })
  }
}
