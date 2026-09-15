// **Domain. Depends on `CorpusService`, `DurabilityService` and `DayService`.**
//
// What is written *over* a passage rather than *in* it: a bookmark on a point
// (R11), a subject over a range (D44), and a range lifted out into a file of
// its own (D13).
//
// **One service because they are one kind of thing.** A mark names a span and
// nothing else: every verb here takes a `Span` or a mark's own name, every one
// of them is a single call into the stream, and the one question that is not a
// write — *where do marks of this kind live?* — is answered by the index rather
// than by a document, because asking the stream would mean loading twenty years
// of days to build a list of dates (D52).
//
// **`branch` is the odd one and belongs anyway.** It makes a document, which
// looks like the library's business — but what it leaves behind is a marker in
// the stream, and the document is the far end of it. It is the same shape as
// putting a task down as a matter (D79): a transfer, written as a mark.

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { DayService } from './day-service.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL, type SpansRequest } from '../../shared/ipc.ts'
import type { DocumentId, DocumentPosition, Span, TypedSpan } from '../../shared/document-api.ts'

export class MarksService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  readonly #day: DayService

  constructor(store: CorpusService, durable: DurabilityService, day: DayService) {
    this.#store = store
    this.#durable = durable
    this.#day = day
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.setAnchor, (at: DocumentPosition, name: string) => this.setAnchor(at, name)),
      serve(CHANNEL.removeAnchor, (name: string) => this.removeAnchor(name)),
      serve(CHANNEL.resolveAnchor, (name: string) => this.resolveAnchor(name)),
      serve(CHANNEL.tag, (span: Span, subject: string) => this.tag(span, subject)),
      serve(CHANNEL.untag, (span: Span, subject: string) => this.untag(span, subject)),
      serve(CHANNEL.renameTag, (span: Span, from: string, to: string) =>
        this.renameTag(span, from, to),
      ),
      serve(CHANNEL.branch, (span: Span, name: string) => this.branch(span, name)),
      serve(CHANNEL.spans, (request: SpansRequest) => this.spans(request)),
    ]
  }

  /**
   * A turn in the one mutation queue, with the day real first.
   *
   * The same pair every writing service opens with: the queue is what keeps
   * edits in the order they were composed, and `ready()` is what keeps a write
   * racing startup from filing under a guessed day (note 61).
   */
  async #mutate<T>(work: () => Promise<T>): Promise<T> {
    await this.#day.ready()
    return this.#store.mutate(work)
  }

  /** Bookmark a point (R11's degenerate range). Serial, like every mutation. */
  async setAnchor(at: DocumentPosition, name: string): Promise<void> {
    await this.#mutate(async () => (await this.#store.stream).setAnchor(at, name))
    this.#durable.touched()
  }

  async removeAnchor(name: string): Promise<void> {
    await this.#mutate(async () => (await this.#store.stream).removeAnchor(name))
    this.#durable.touched()
  }

  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    return (await this.#store.stream).resolveAnchor(name)
  }

  /**
   * Put a subject over a range, or take it off one. Serial, like every mutation.
   *
   * Z asks for both through the same door because they are the same operation
   * with opposite signs — see `StreamDocument.#retag`.
   */
  async tag(span: Span, subject: string): Promise<void> {
    await this.#mutate(async () => (await this.#store.stream).tag(span, subject))
    this.#durable.touched()
  }

  async untag(span: Span, subject: string): Promise<void> {
    await this.#mutate(async () => (await this.#store.stream).untag(span, subject))
    this.#durable.touched()
  }

  /** Change what one span is tagged as. Not a corpus-wide rename (D44). */
  async renameTag(span: Span, from: string, to: string): Promise<void> {
    await this.#mutate(async () => (await this.#store.stream).renameTag(span, from, to))
    this.#durable.touched()
  }

  /**
   * Branch a range into its own file. Serial, and flushed straight away: the
   * new file is already on disk, so leaving the stream's half of the operation
   * sitting in memory is the one window where the two disagree (D13).
   */
  async branch(span: Span, name: string): Promise<DocumentId> {
    const id = await this.#mutate(async () => (await this.#store.stream).branch(span, name))
    // Not `touched()`: the branched file is already on disk, so the window
    // where the two halves disagree is closed now rather than in a second (D13).
    this.#durable.unsaved()
    await this.#durable.flush()
    return id
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
    const stream = await this.#store.stream
    const out: TypedSpan[] = []
    for (const { at, span } of await this.#store.index.spansOf(request.kind)) {
      if (at.date === null) continue
      out.push(stream.typed(at.date, span))
    }
    return out
  }
}
