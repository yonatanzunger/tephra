// **Domain. Depends on `CorpusService` and `DurabilityService`.**
//
// Margin notes on a passage of the notebook (D47): the threads, and the eight
// verbs that change them.
//
// **The first service split out of `DocumentService`** (D83), chosen as the
// pilot because it is small, its domain is clean, and — the part that mattered —
// **it writes**. A read-only service would have proved only that the channel
// declaration works; this exercises the whole of it: the store, the one mutation
// queue, and the write tiers.
//
// **Eight channels, declared not dispatched.** `serves()` is the list, and
// `ipc.ts` wires it without knowing what any of them mean. They are still eight
// rather than one command union like `docket` and `todo`; collapsing them is a
// change to the preload and the renderer, and does not belong in a move.
//
// **No day.** Every other writing service needs to know what day it is; this one
// does not, because a comment is anchored to a *span* and the span names its
// segment. So it does not take `DayService`, and its writes do not wait on the
// clock being seeded.
//
// > **A thread's timestamp does NOT come from here**, and should. `#newMessage`
// > in `x/documents/segmented.ts` stamps `new Date().toISOString()` — the wall
// > clock, in UTC — where the rest of the app takes both the instant and the zone
// > from `DayService` (D62, D63). That is the third of a family: completion
// > stamps and `dueOn` were both fixed the same way. Left alone deliberately, so
// > that this move changes no behaviour and the suites can say so; fixing it
// > will give this service a reason to know the day after all.

import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL } from '../../shared/ipc.ts'
import type { CommentId, CommentThread } from '../../shared/comments.ts'
import type { Span } from '../../shared/document-api.ts'

export class CommentsService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService

  constructor(store: CorpusService, durable: DurabilityService) {
    this.#store = store
    this.#durable = durable
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.comments, () => this.comments()),
      serve(CHANNEL.startComment, (span: Span, body: string) => this.startComment(span, body)),
      serve(CHANNEL.addComment, (id: CommentId, body: string) => this.addComment(id, body)),
      serve(CHANNEL.editComment, (id: CommentId, at: number, body: string) =>
        this.editComment(id, at, body),
      ),
      serve(CHANNEL.deleteComment, (id: CommentId, at: number) => this.deleteComment(id, at)),
      serve(CHANNEL.setCommentResolved, (id: CommentId, on: boolean) =>
        this.setCommentResolved(id, on),
      ),
      serve(CHANNEL.setCommentAssignee, (id: CommentId, to: string | null) =>
        this.setCommentAssignee(id, to),
      ),
      serve(CHANNEL.reactToComment, (id: CommentId, at: number, emoji: string, on: boolean) =>
        this.reactToComment(id, at, emoji, on),
      ),
    ]
  }

  /**
   * Every thread in the notebook.
   *
   * **Not serialised, unlike the writes below.** A thread list is derived from
   * bodies already in memory, so there is nothing for it to race with — the
   * queue orders mutations, and a read that took a turn in it would be waiting
   * for other people's writes to answer a question it already knows.
   */
  async comments(): Promise<readonly CommentThread[]> {
    return (await this.#store.stream).comments()
  }

  /**
   * Every write: a turn in the queue, then the file tier is told.
   *
   * **One helper rather than eight copies of two lines**, which is the lesson
   * `touched` itself carries: nine copies were nine chances for the next one to
   * do the work and forget to say so, leaving a document that saves only when
   * something else happens to save.
   */
  async #wrote<T>(work: () => Promise<T>): Promise<T> {
    const done = await this.#store.mutate(work)
    this.#durable.touched()
    return done
  }

  async startComment(span: Span, body: string): Promise<CommentId> {
    return this.#wrote(async () => (await this.#store.stream).startComment(span, body))
  }

  async addComment(id: CommentId, body: string): Promise<void> {
    await this.#wrote(async () => (await this.#store.stream).addComment(id, body))
  }

  async editComment(id: CommentId, index: number, body: string): Promise<void> {
    await this.#wrote(async () => (await this.#store.stream).editComment(id, index, body))
  }

  async deleteComment(id: CommentId, index: number): Promise<void> {
    await this.#wrote(async () => (await this.#store.stream).deleteComment(id, index))
  }

  async setCommentResolved(id: CommentId, resolved: boolean): Promise<void> {
    await this.#wrote(async () => (await this.#store.stream).setCommentResolved(id, resolved))
  }

  async setCommentAssignee(id: CommentId, to: string | null): Promise<void> {
    await this.#wrote(async () => (await this.#store.stream).setCommentAssignee(id, to))
  }

  async reactToComment(id: CommentId, index: number, emoji: string, on: boolean): Promise<void> {
    await this.#wrote(async () => (await this.#store.stream).reactToComment(id, index, emoji, on))
  }
}
