// The renderer's handle on the Document that lives in main (D37).
//
// Everything here is a forward. The one piece of real behaviour is routing a
// pushed change to the window it belongs to — main addresses windows by handle,
// because a live object cannot cross a process boundary.

import type {
  DateKey, Document, DocumentChange, DocumentId, DocumentMeta, DocumentPosition,
  DocumentWindow, Edit, EditOrigin, SegmentKey, SessionGeneration, Span, SpanKind,
  StreamDocumentApi, TypedSpan, Unsubscribe, Divergence,
} from '../../../shared/document-api.ts'
import type { CommentId, CommentThread } from '../../../shared/comments.ts'
import type { DocumentInfo } from '../../../shared/ipc.ts'
import { RemoteWindow } from './remote-window.ts'

export class RemoteDocument implements StreamDocumentApi {
  readonly id = 'stream' as DocumentId
  readonly meta: DocumentMeta & { readonly kind: 'stream' }
  #generation: SessionGeneration
  #today: DateKey

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

  private constructor(info: DocumentInfo) {
    // The stream is what `doc.open()` opens; when this class learns to open
    // others (MC5) the kind decides which implementation is built, and this
    // narrowing moves there rather than being asserted here.
    this.meta = { ...info.meta, kind: 'stream' }
    this.#generation = info.generation
    this.#today = info.today
  }

  static async open(): Promise<RemoteDocument> {
    const doc = new RemoteDocument(await window.tephra.doc.open())
    window.tephra.doc.onWindowChanged(message => {
      doc.#generation = message.generation
      doc.#windows
        .get(message.id)
        ?.applyRemote(
          message.edits,
          message.origin,
          message.text,
          message.generation,
          message.spans,
          message.placement,
          message.boundaries,
        )
      doc.#settle(message.generation)
    })
    window.tephra.doc.onWindowReset(message => doc.#windows.get(message.id)?.remoteReset())
    return doc
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
    let newest = this.#generation as number
    for (const window of this.#windows.values()) {
      newest = Math.max(newest, window.generation as number)
    }
    return newest as SessionGeneration
  }

  get isDirty(): boolean {
    return false // main owns this; nothing in Z reads it yet
  }

  get today(): DateKey {
    return this.#today
  }

  /** Same answer as `generation`; kept because the API declares both. */
  currentGeneration(): SessionGeneration {
    return this.generation
  }

  async read(span: Span): Promise<DocumentWindow> {
    const snapshot = await window.tephra.doc.read({
      first: span.begin.segment as DateKey,
      last: span.end.segment as DateKey,
    })
    const remote = new RemoteWindow(this, snapshot)
    this.#windows.set(snapshot.id, remote)
    this.#generation = snapshot.generation
    return remote
  }

  /** Sugar for the highest-frequency action: open at the end of today. */
  async readToday(): Promise<DocumentWindow> {
    this.#today = await window.tephra.doc.today()
    const at: DocumentPosition = {
      segment: this.#today as SegmentKey,
      offset: 0 as never,
      generation: this.#generation,
    }
    return this.read({ begin: at, end: at })
  }

  async undo(): Promise<DocumentChange | null> {
    const ack = await window.tephra.doc.undo()
    await this.#windowsCaughtUp(ack.generation)
    this.#generation = ack.generation
    if (ack.change !== null) for (const handler of this.#changeHandlers) handler(ack.change)
    return ack.change
  }

  async redo(): Promise<DocumentChange | null> {
    const ack = await window.tephra.doc.redo()
    await this.#windowsCaughtUp(ack.generation)
    this.#generation = ack.generation
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
    return window.tephra.doc.spans(kind === undefined ? {} : { kind })
  }

  async resolveAnchor(name: string): Promise<DocumentPosition | null> {
    return window.tephra.doc.resolveAnchor(name)
  }

  async extent(): Promise<{ readonly first: DateKey; readonly last: DateKey } | null> {
    return window.tephra.doc.extent()
  }

  dateAt(at: DocumentPosition): DateKey {
    return at.segment as DateKey
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
  startComment(_span: Span, _body: string): Promise<CommentId> {
    return this.#notYet('startComment')
  }
  addComment(_id: CommentId, _body: string): Promise<void> {
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
