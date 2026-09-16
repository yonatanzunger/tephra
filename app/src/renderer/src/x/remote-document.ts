// The renderer's handle on a Document that lives in main (D37).
//
// Everything here is a forward. The one piece of real behaviour is routing a
// pushed change to the window it belongs to — main addresses windows by handle,
// because a live object cannot cross a process boundary.
//
// **Any document, not the stream.** What is stream-shaped — today, the extent
// in dates, the date at a position — is `RemoteStream` in `kinds/`, chosen by
// kind when the handle is made (D54). This class is what every kind can do.

import type {
  Document, DocumentChange, DocumentId, DocumentMeta, DocumentOffset, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, SegmentKey, SessionGeneration, Span, SpanKind,
  TypedSpan, Unsubscribe, Divergence,
} from '../../../shared/document-api.ts'
import type { CommentId, CommentThread } from '../../../shared/comments.ts'
import type { DocumentInfo, WindowChangedMessage } from '../../../shared/ipc.ts'
import { RemoteWindow } from './remote-window.ts'

export class RemoteDocument implements Document {
  readonly id: DocumentId
  readonly meta: DocumentMeta
  /** What the document calls itself, for a title bar. Null when nobody named it. */
  readonly title: string | null
  protected generationSeen: SessionGeneration

  readonly #windows = new Map<number, RemoteWindow>()
  readonly #changeHandlers = new Set<(c: DocumentChange) => void>()

  /**
   * Callers waiting for a pushed change to land.
   *
   * undo() is answered by an IPC reply, but the WINDOW is updated by a separate
   * pushed message — so without this, `await doc.undo()` resolves while the
   * buffer still shows the old text, and anything that reads it immediately
   * afterwards gets a stale answer. That is a race a caller cannot see and
   * cannot reasonably be asked to work around.
   */
  #waiters: { generation: SessionGeneration; resolve: () => void }[] = []

  constructor(info: DocumentInfo) {
    this.id = info.id
    this.meta = info.meta
    this.title = info.title
    this.generationSeen = info.generation
  }

  /** Whether a pushed message is about one of THIS document's windows. */
  holds(windowId: number): boolean {
    return this.#windows.has(windowId)
  }

  /**
   * A change main pushed, delivered to the window it names.
   *
   * Dispatched from one place rather than subscribed to here, because with more
   * than one document open a per-document subscription would see every other
   * document's messages — and the generation carried in them is not this
   * document's to adopt (D33: two mirrors of one number always drift).
   */
  deliver(message: WindowChangedMessage): void {
    this.generationSeen = message.generation
    this.#windows
      .get(message.id)
      ?.applyRemote(
        message.edits,
        message.origin,
        message.text,
        message.generation,
        message.heard,
        message.spans,
        message.placement,
        message.boundaries,
      )
    this.#settle(message.generation)
  }

  reset(windowId: number): void {
    this.#windows.get(windowId)?.remoteReset()
  }

  /**
   * The newest generation this process knows about.
   *
   * **Not just `#generation`.** That field is only refreshed at open and on
   * undo/redo; ordinary edits travel through `RemoteWindow`, which learns the
   * new generation from its own ack and has no reason to report it here. So the
   * renderer held two mirrors of one number and they disagreed the moment
   * anyone typed — and any position built from the document's copy was born
   * stale. Measured, as `StalePositionError: position is from generation 1,
   * expected 2`, the first time a bookmark was written after a keystroke.
   *
   * Taking the maximum makes the two agree by construction rather than by a
   * notification that can be forgotten. D33's warning is about exactly this: a
   * version axis is worth nothing if two objects each keep their own idea of it.
   */
  get generation(): SessionGeneration {
    let newest = this.generationSeen as number
    for (const window of this.#windows.values()) {
      newest = Math.max(newest, window.generation as number)
    }
    return newest as SessionGeneration
  }

  get isDirty(): boolean {
    return false // main owns this; nothing in Z reads it yet
  }

  /** Same answer as `generation`; kept because the API declares both. */
  currentGeneration(): SessionGeneration {
    return this.generation
  }

  positionAt(segment: SegmentKey, offset: number): DocumentPosition {
    return { segment, offset: offset as DocumentOffset, generation: this.generation }
  }

  async read(span: Span): Promise<DocumentWindow> {
    const snapshot = await window.tephra.doc.read({
      doc: this.id,
      first: span.begin.segment,
      last: span.end.segment,
    })
    const remote = new RemoteWindow(this, snapshot)
    this.#windows.set(snapshot.id, remote)
    this.generationSeen = snapshot.generation
    return remote
  }

  async undo(): Promise<DocumentChange | null> {
    const ack = await window.tephra.doc.undo(this.id)
    await this.#windowsCaughtUp(ack.generation)
    this.generationSeen = ack.generation
    if (ack.change !== null) for (const handler of this.#changeHandlers) handler(ack.change)
    return ack.change
  }

  async redo(): Promise<DocumentChange | null> {
    const ack = await window.tephra.doc.redo(this.id)
    await this.#windowsCaughtUp(ack.generation)
    this.generationSeen = ack.generation
    if (ack.change !== null) for (const handler of this.#changeHandlers) handler(ack.change)
    return ack.change
  }

  #settle(generation: SessionGeneration): void {
    this.#waiters = this.#waiters.filter(waiter => {
      if (generation >= waiter.generation) {
        waiter.resolve()
        return false
      }
      return true
    })
  }

  /**
   * Resolve once every open window has seen `target`, so that a caller awaiting
   * undo() can read the buffer immediately afterwards and get the new text.
   *
   * Bounded by a timeout rather than waiting forever: a change that lands
   * entirely outside every open window produces no push, and blocking on a
   * message that is never coming would be worse than answering slightly early.
   */
  async #windowsCaughtUp(target: SessionGeneration, timeoutMs = 500): Promise<void> {
    const behind = [...this.#windows.values()].some(w => w.generation < target)
    if (!behind) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, timeoutMs)
      this.#waiters.push({
        generation: target,
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
      })
    })
  }

  async flush(): Promise<void> {
    await window.tephra.doc.flush()
  }

  async spans(kind?: SpanKind): Promise<readonly TypedSpan[]> {
    return window.tephra.doc.spans({ doc: this.id, ...(kind === undefined ? {} : { kind }) })
  }

  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    return window.tephra.doc.resolveAnchor(name)
  }

  onChanged(handler: (change: DocumentChange) => void): Unsubscribe {
    this.#changeHandlers.add(handler)
    return () => this.#changeHandlers.delete(handler)
  }

  releaseWindow(id: number): void {
    this.#windows.delete(id)
  }

  // ── not in M0; explicit rather than silently absent ────────

  #notYet(name: string): never {
    throw new Error(`Document.${name} is not implemented in M0`)
  }
  snap(_span: Span): Promise<Span> {
    return this.#notYet('snap')
  }
  advance(_from: DocumentPosition, _chars: number): Promise<DocumentPosition | null> {
    return this.#notYet('advance')
  }
  distance(_a: DocumentPosition, _b: DocumentPosition): Promise<number | null> {
    return this.#notYet('distance')
  }
  spansAt(_at: DocumentPosition): Promise<readonly TypedSpan[]> {
    return this.#notYet('spansAt')
  }
  replace(_edits: readonly Edit[], _origin?: EditOrigin): Promise<void> {
    return this.#notYet('replace')
  }
  rewindTo(_to: SessionGeneration): Promise<DocumentChange | null> {
    return this.#notYet('rewindTo')
  }
  history(_since?: SessionGeneration): Promise<readonly DocumentChange[]> {
    return this.#notYet('history')
  }
  tag(_span: Span, _subject: string): Promise<void> {
    return this.#notYet('tag')
  }
  untag(_span: Span, _subject: string): Promise<void> {
    return this.#notYet('untag')
  }
  // Comments (D47). The margin drives these through the bridge, not through
  // this object, which exists so the editor has a Document to hold.
  comments(): Promise<readonly CommentThread[]> {
    return this.#notYet('comments')
  }
  commentsAt(_at: DocumentPosition): Promise<readonly CommentThread[]> {
    return this.#notYet('commentsAt')
  }
  startComment(_span: Span, _body: string, _at: string): Promise<CommentId> {
    return this.#notYet('startComment')
  }
  addComment(_id: CommentId, _body: string, _at: string): Promise<void> {
    return this.#notYet('addComment')
  }
  editComment(_id: CommentId, _index: number, _body: string): Promise<void> {
    return this.#notYet('editComment')
  }
  deleteComment(_id: CommentId, _index: number): Promise<void> {
    return this.#notYet('deleteComment')
  }
  setCommentResolved(_id: CommentId, _resolved: boolean): Promise<void> {
    return this.#notYet('setCommentResolved')
  }
  setCommentAssignee(_id: CommentId, _to: string | null): Promise<void> {
    return this.#notYet('setCommentAssignee')
  }
  reactToComment(_id: CommentId, _index: number, _emoji: string, _on: boolean): Promise<void> {
    return this.#notYet('reactToComment')
  }

  importText(
    _at: DocumentPosition,
    _text: string,
    _original: { readonly content: string; readonly ext: string },
  ): Promise<string> {
    return this.#notYet('importText')
  }
  renameTag(_span: Span, _from: string, _to: string): Promise<void> {
    return this.#notYet('renameTag')
  }
  setAnchor(_at: DocumentPosition, _name: string): Promise<void> {
    return this.#notYet('setAnchor')
  }
  removeAnchor(_name: string): Promise<void> {
    return this.#notYet('removeAnchor')
  }
  branch(_span: Span, _name: string): Promise<DocumentId> {
    return this.#notYet('branch')
  }
  onDiverged(_handler: (d: Divergence) => void): Unsubscribe {
    return () => undefined
  }
  mapPosition(_at: DocumentPosition, _through: DocumentChange): DocumentPosition | null {
    return this.#notYet('mapPosition')
  }
  reload(): Promise<void> {
    return this.#notYet('reload')
  }
  release(): Promise<void> {
    return this.#notYet('release')
  }
}
