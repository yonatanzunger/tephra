// **Domain. Depends on `CorpusService`, `DurabilityService`, `DayService` and
// `Bus`.**
//
// A window over a document, and every verb that changes what is in it: open,
// read, edit, extend, undo, redo (D54).
//
// **The other half of the word.** `tephra:win:` was two different things and
// D83 split the vocabulary: **frame** is an OS window, which is
// `shell/frame-service.ts`; **text** is a region of a document that a renderer
// is showing, which is this. A frame may hold several of these; a document may
// be open in several frames.
//
// **The invariant that matters more than the rest**: edits apply in the order
// they were composed. IPC *delivery* is ordered per channel, but `ipcMain.handle`
// runs handlers concurrently — a handler that awaits durability yields, and the
// next edit can start before it finishes. Two keystrokes would then interleave
// and the document would be reordered relative to what the typist saw. The one
// mutation queue is what prevents it, and every write here goes through it.
//
// **A window holds its document directly**, so the corpus must know a window
// exists or it could let go of a document something is still pointing at.

import type { Anomaly } from '../../shared/anomalies.ts'
import type { CorpusService } from './corpus-service.ts'
import type { DurabilityService } from './durability-service.ts'
import type { DayService } from './day-service.ts'
import type { Bus } from './bus.ts'
import { serve, type Served, type Serves } from './serves.ts'
import { CHANNEL, type ChangeAck, type DayProse, type DocumentInfo, type EditAck, type EditRequest, type ExtendRequest, type ReadRequest, type WindowChangedMessage, type WindowId, type WindowSnapshot } from '../../shared/ipc.ts'
import { isStream, ONLY_SEGMENT, type DateKey, type DocumentId, type Unsubscribe } from '../../shared/document-api.ts'
import { STREAM_ID } from '../x/documents/corpus.ts'
import type { LocalWindow } from '../x/window.ts'

export class TextService implements Serves {
  readonly #store: CorpusService
  readonly #durable: DurabilityService
  readonly #day: DayService
  readonly #bus: Bus

  constructor(store: CorpusService, durable: DurabilityService, day: DayService, bus: Bus) {
    this.#store = store
    this.#durable = durable
    this.#day = day
    this.#bus = bus
  }

  serves(): readonly Served[] {
    return [
      serve(CHANNEL.open, (id?: DocumentId) => this.info(id)),
      serve(CHANNEL.read, (request: ReadRequest) => this.openWindow(request)),
      serve(CHANNEL.edit, (request: EditRequest) => this.edit(request)),
      serve(CHANNEL.extend, (request: ExtendRequest) => this.extend(request)),
      serve(CHANNEL.release, (id: WindowId) => this.releaseWindow(id)),
      serve(CHANNEL.undo, (id?: DocumentId) => this.undo(id)),
      serve(CHANNEL.redo, (id?: DocumentId) => this.redo(id)),
      serve(CHANNEL.anomalies, () => this.anomalies()),
      serve(CHANNEL.extent, () => this.extent()),
      serve(CHANNEL.proseIn, (from: DateKey, to: DateKey) => this.proseIn(from, to)),
      // **A durability door on the text service's channel list**, because the
      // surface that asks is the editor: *write what I have typed, now*. The
      // tiers themselves are the foundation's and own no channels (D83).
      serve(CHANNEL.flush, () => this.#durable.flush()),
    ]
  }

  /**
   * A turn in the one mutation queue, with the day real first.
   *
   * **The gate on the day being real.** A synchronous `today` is a lie until the
   * clock is seeded, and a write racing startup would file under the guessed day
   * while every later read looked under the real one (note 61). Reads are
   * deliberately not gated: a read that is a day stale corrects itself on the
   * next poll, and a write does not.
   */
  async #mutate<T>(work: () => Promise<T>): Promise<T> {
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
    return this.#store.corpus.use(
      id,
      async doc => ({
        id,
        meta: doc.meta,
        // A stream is not a document anybody named; every other kind keeps its
        // name where a person can edit it, which is the frontmatter.
        title: isStream(doc) ? null : await doc.titleOf(ONLY_SEGMENT),
        generation: doc.generation,
        today: this.#day.today,
        clockDay: this.#day.clockDay,
        zone: this.#day.zone,
        extent: isStream(doc) ? await doc.extent() : null,
      }),
      { mode: 'read' },
    )
  }

  async openWindow(request: ReadRequest): Promise<WindowSnapshot> {
    await this.#day.ready()
    const docId = request.doc ?? STREAM_ID
    const window = await this.#store.corpus.use(
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
    this.#windows.set(id, { window, release: this.#store.corpus.watch(docId) })
    window.onChanged((edits, origin) => {
      this.#broadcast({
        id,
        edits,
        origin,
        generation: window.generation,
        heard: window.heard,
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
      heard: window.heard,
      spans: window.spans(),
      placement: window.placement(),
      boundaries: window.boundaries,
    }
  }

  /** Growing the region is a mutation, so it queues with the edits. */
  async extend(request: ExtendRequest): Promise<void> {
    await this.#mutate(async () => {
      const window = this.#windows.get(request.id)?.window
      if (window === undefined) throw new Error(`no such window ${request.id}`)
      await window.extend(request.direction, request.chars)
    })
  }

  /**
   * Apply what a renderer typed — or **refuse it**, if the buffer it was
   * composed against has been overtaken (D88).
   *
   * **The refusal is the whole of this method's care.** An edit carries window
   * offsets, and offsets mean nothing without the text they were computed
   * against. A change the renderer has not applied yet — a comment main wrote, a
   * tag, a file edited outside — moves that text, and applying the edit anyway
   * puts the characters somewhere else. Reported from use: a comment's own
   * byline was joined to the paragraph above it by the keystroke that followed
   * it, which stopped the block being a blockquote, which un-concealed 210
   * characters, which desynchronised the window and misplaced everything typed
   * afterwards.
   *
   * `heard` counts only announcements, so several edits in flight on one
   * generation are all fine — see `EditRequest.heard`.
   */
  async edit(request: EditRequest): Promise<EditAck> {
    return this.#mutate(async () => {
      const window = this.#windows.get(request.id)?.window
      if (window === undefined) throw new Error(`no such window ${request.id}`)
      if (request.heard !== window.heard) {
        // **Refused, not thrown.** The renderer re-reads and carries on; a
        // keystroke is lost, which is the cheap half of this trade. Throwing
        // would put an error in front of somebody for a state the app can
        // recover from without them.
        return {
          generation: window.generation,
          heard: window.heard,
          refused: true as const,
          // **With the truth attached**, because a refusal the renderer cannot
          // recover from is worse than the misplaced character it prevents.
          text: window.text,
          length: window.text.length,
          spans: window.spans(),
          placement: window.placement(),
        }
      }
      await window.edit(request.edits, request.origin)
      // The idle rule's only input, and it is free here: every keystroke
      // already passes through this method (D62).
      if (request.origin === 'user') this.#day.wrote()
      this.#durable.writeSoon()
      return {
        generation: window.generation,
        heard: window.heard,
        length: window.text.length,
        spans: window.spans(),
        placement: window.placement(),
      }
    })
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
    return (await this.#store.stream).anomalies()
  }

  /**
   * Undo, on the document that asked.
   *
   * **Whose stack a keystroke means is a question about FOCUS**, and focus is
   * the renderer's to know — so the id comes in rather than being decided here.
   * It defaults to the stream, which is what the only focusable surface holds.
   */
  async undo(id: DocumentId = STREAM_ID): Promise<ChangeAck> {
    const ack = await this.#mutate(() =>
      this.#store.corpus.use(id, async doc => {
        const change = await doc.undo()
        this.#durable.writeSoon()
        return { change, generation: doc.generation }
      }),
    )
    // **Still reconciles, and now it is routed rather than called.** An undo IS a
    // change to a source of truth and the derived side has to catch up — a
    // step's completion put back, a date restored. This used to reach for
    // `AgendaService.reconcile()`, which is the one place the text contract
    // would have had to know that reconciliation exists; saying *this document
    // changed* instead lets the registered trigger decide, exactly as every
    // write does (D77, D83). An undo in the stream no longer pays for a pass
    // that can find nothing, because `stream:` is not one of the keys the
    // docket clause listens for.
    //
    // What it no longer has to repair is a half-undone *move*: that is written
    // as a `transfer` and undo does not reach it at all (MH5).
    await this.#durable.wrote(id)
    return ack
  }

  async redo(id: DocumentId = STREAM_ID): Promise<ChangeAck> {
    return this.#mutate(() =>
      this.#store.corpus.use(id, async doc => {
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

  releaseWindow(id: WindowId): void {
    const held = this.#windows.get(id)
    held?.window.release()
    // And tell the Corpus that one fewer thing is pointing at the document. The
    // stream stays open regardless — the service watches it too — but for every
    // other document this is what "closed" means.
    held?.release()
    this.#windows.delete(id)
  }

  /** Every written day in a range, as prose — what printing and export read. */
  async proseIn(from: DateKey, to: DateKey): Promise<readonly DayProse[]> {
    return (await this.#store.stream).proseIn(from, to)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    return (await this.#store.stream).extent()
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

  #broadcast(message: WindowChangedMessage): void {
    this.#bus.announce(CHANNEL.windowChanged, message)
  }

  #broadcastReset(id: WindowId): void {
    this.#bus.announce(CHANNEL.windowReset, { id })
  }
}
